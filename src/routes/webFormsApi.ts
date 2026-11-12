/**
 * /api/web-forms: website forms → CRM.
 *
 * Public (no sign-in; mounted with guard(PUBLIC.webForms); CORS handled here, per organization):
 *   OPTIONS /f/:formId   CORS preflight; only websites in the organization's allowed list get CORS headers
 *   POST    /f/:formId   a submission, as JSON (fetch) or a normal HTML form post (urlencoded); with Turnstile on,
 *                        `cf-turnstile-response` must verify with Cloudflare (400 captcha_failed / 503 captcha_unavailable)
 *     200 { success, message }   accepted (also for spam and duplicates, which aren't sent on)
 *     400 { code: invalid_input, fields: [{ field, message }] }   (visitor input is never echoed back)
 *     403 origin_not_allowed · 404 form_not_found · 429 rate_limited · 503 crm_unavailable
 *   HTML form posts are redirected to the configured thank-you page (?form_status=ok|error) or get a small
 *   accessible confirmation page.
 *
 * Signed-in organization members:
 *   GET  /config          settings (view)   form id, endpoint, allowed websites, destinations, webhook (no secret)
 *   PUT  /config          settings (manage) change them; adding a webhook URL returns its signing secret once
 *   POST /webhook/rotate-secret · /webhook/test · /form-id/rotate   settings (manage)
 *   GET  /submissions     settings (view)   delivery log (no names, emails or messages)
 *   POST /try             settings (manage) send a test submission through the real pipeline (creates a real lead;
 *                         skips only the allowed-websites and Turnstile checks); returns what happened
 */
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, validateBody } from '../server/http/middleware';
import { toErrorResponse } from '../server/http/errors';
import { requireAccess } from '../server/security/permissions';
import { requireTenant, tenantOf } from '../server/tenancy/middleware';
import { recordAudit } from '../server/audit/auditLog';
import * as wf from '../server/webforms/service';

const router = Router();
const FORM_ID = /^wf_[A-Za-z0-9_-]{16}$/;

// ---------------------------------------------------------------------------
// Public submission endpoint
// ---------------------------------------------------------------------------
const limitHandler = (req: Request, res: Response) => {
  res.setHeader('Retry-After', '600');
  if (wantsHtml(req)) return res.status(429).type('html').send(htmlPage('Please wait a moment', 'Too many messages were sent from your network. Please try again in a few minutes.'));
  res.status(429).json({ success: false, code: 'rate_limited', error: 'Too many submissions. Please try again in a few minutes.', retryAfter: 600 });
};
// TODO(more than one server instance): these limiters count in memory per instance. Behind a load balancer, give
// both a shared store (express-rate-limit `store`, e.g. Redis) or add a Cloudflare rate-limiting rule on
// /api/web-forms/f/* so the limits hold across instances. Behind Cloudflare also set TRUST_PROXY (see WEB_FORMS.md).
const perIp = rateLimit({ windowMs: 10 * 60_000, limit: Number(process.env.WEBFORM_IP_LIMIT) || 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: limitHandler });
const perForm = rateLimit({ windowMs: 60 * 60_000, limit: Number(process.env.WEBFORM_FORM_LIMIT) || 300, standardHeaders: false, legacyHeaders: false, keyGenerator: (req) => `form:${req.params.formId}`, handler: limitHandler });

const wantsHtml = (req: Request) => !!req.is('application/x-www-form-urlencoded') || !!req.is('multipart/form-data') ? !String(req.get('accept') || '').includes('application/json') : false;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function htmlPage(title: string, body: string, list: string[] = []) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#f5f5f3;color:#1d1c1b;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:460px;background:#fff;border:1px solid #e5e4e0;border-radius:16px;padding:28px}h1{font-size:20px;margin:0 0 8px}li{margin:4px 0}</style></head>
<body><main role="main"><h1>${esc(title)}</h1><p>${esc(body)}</p>${list.length ? `<ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p>Use your browser's Back button to correct the form.</p>` : ''}</main></body></html>`;
}

async function corsFor(req: Request, res: Response): Promise<boolean> {
  const origin = req.get('origin');
  res.setHeader('Vary', 'Origin');
  if (!origin || !FORM_ID.test(req.params.formId)) return false;
  const orgId = await wf.orgForFormId(req.params.formId);
  if (!orgId) return false;
  const cfg = await wf.getConfig(orgId);
  if (!cfg.allowedOrigins.includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  return true;
}

router.options('/f/:formId', asyncHandler(async (req, res) => {
  if (await corsFor(req, res)) {
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  res.status(204).end();
}));

router.post('/f/:formId', perIp, perForm, async (req, res) => {
  const html = wantsHtml(req);
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!FORM_ID.test(req.params.formId)) throw Object.assign(new Error('This form isn\'t connected. Check the form id in your website code.'), { status: 404, code: 'form_not_found' });
    await corsFor(req, res);
    const out = await wf.submit(req.params.formId, (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>, { origin: req.get('origin') || null, ip: req.ip });
    if (html) {
      if (out.config.redirectUrl) return res.redirect(303, withParam(out.config.redirectUrl, 'form_status', 'ok'));
      return res.status(200).type('html').send(htmlPage('Thank you!', out.message));
    }
    return res.status(200).json({ success: true, message: out.message });
  } catch (err) {
    const r = toErrorResponse(err);
    if (html) {
      const orgId = FORM_ID.test(req.params.formId) ? await wf.orgForFormId(req.params.formId).catch(() => null) : null;
      const redirect = orgId ? (await wf.getConfig(orgId).catch(() => null))?.redirectUrl : null;
      const fields = Array.isArray((r.body as any).fields) ? (r.body as any).fields as Array<{ field: string; message: string }> : [];
      if (redirect && r.status < 500) return res.redirect(303, withParam(withParam(redirect, 'form_status', 'error'), 'form_error', String(r.body.code)));
      return res.status(r.status).type('html').send(htmlPage('Your message wasn\'t sent', r.body.error, fields.map((f) => f.message)));
    }
    for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v);
    return res.status(r.status).json({ ...r.body, requestId: req.id });
  }
});

function withParam(url: string, k: string, v: string) { const u = new URL(url); u.searchParams.set(k, v); return u.toString(); }

// ---------------------------------------------------------------------------
// Admin (signed-in organization members)
// ---------------------------------------------------------------------------
const admin = Router();
admin.use(requireTenant);
admin.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

const endpointFor = (formId: string) => `${(process.env.APP_URL || '').replace(/\/+$/, '') || `http://localhost:${Number(process.env.PORT) || 3000}`}/api/web-forms/f/${formId}`;

admin.get('/config', requireAccess('settings', 'view'), asyncHandler(async (req, res) => {
  const cfg = await wf.getConfig(tenantOf(req).orgId);
  res.json({ success: true, config: wf.publicConfig(cfg), endpoint: endpointFor(cfg.formId), appUrlConfigured: !!process.env.APP_URL });
}));

const ConfigPatch = z.object({
  allowedOrigins: z.array(z.string().max(200)).max(20).optional(),
  redirectUrl: z.string().max(500).nullable().optional(),
  destinations: z.object({ obsidian: z.boolean().optional(), webhook: z.boolean().optional() }).strict().optional(),
  webhookUrl: z.string().max(500).nullable().optional(),
  turnstile: z.object({ siteKey: z.string().max(200), secretKey: z.string().max(200).optional() }).strict().nullable().optional(),
  userId: z.unknown().optional(), // set by guard() from the verified session; ignored
}).strict().transform(({ userId: _ignored, ...rest }) => rest);

admin.put('/config', requireAccess('settings', 'manage'), validateBody(ConfigPatch), asyncHandler(async (req, res) => {
  const t = tenantOf(req);
  const r = await wf.updateConfig(t.orgId, req.body);
  await recordAudit(t.orgId, { actorId: t.userId, action: 'web_forms.config_updated', target: 'web_forms', meta: { origins: r.config.allowedOrigins.length, destinations: r.config.destinations, webhook: !!r.config.webhook, captcha: !!r.config.captcha } });
  res.json({ success: true, config: r.config, endpoint: endpointFor(r.config.formId), ...(r.webhookSecret ? { webhookSecret: r.webhookSecret } : {}) });
}));

admin.post('/webhook/rotate-secret', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const t = tenantOf(req);
  const r = await wf.rotateWebhookSecret(t.orgId);
  await recordAudit(t.orgId, { actorId: t.userId, action: 'web_forms.webhook_secret_rotated', target: 'web_forms' });
  res.json({ success: true, config: r.config, webhookSecret: r.webhookSecret });
}));

admin.post('/webhook/test', requireAccess('settings', 'manage'), rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => tenantOf(req).orgId }), asyncHandler(async (req, res) => {
  res.json({ success: true, result: await wf.testWebhook(tenantOf(req).orgId) });
}));

admin.post('/form-id/rotate', requireAccess('settings', 'manage'), asyncHandler(async (req, res) => {
  const t = tenantOf(req);
  const config = await wf.rotateFormId(t.orgId);
  await recordAudit(t.orgId, { actorId: t.userId, action: 'web_forms.form_id_rotated', target: 'web_forms' });
  res.json({ success: true, config, endpoint: endpointFor(config.formId) });
}));

// A test from the Website Forms page. Same validation, spam rules, duplicate check and delivery as a visitor's
// submission, so the owner sees exactly what their website will get (and the lead it creates in the CRM).
const TRY_FORM_NAME = 'Website Forms test';
admin.post('/try', requireAccess('settings', 'manage'), rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => tenantOf(req).orgId }), asyncHandler(async (req, res) => {
  const t = tenantOf(req);
  const cfg = await wf.getConfig(t.orgId);
  const { userId: _ignored, ...fields } = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const out = await wf.submit(cfg.formId, { ...fields, formName: TRY_FORM_NAME }, { trusted: true, ip: req.ip });
  // This CRM is written before submit() returns; a webhook delivery may still be pending (shown as such).
  const log = out.id ? await wf.submissionLog(t.orgId, out.id) : null;
  await recordAudit(t.orgId, { actorId: t.userId, action: 'web_forms.test_submitted', target: 'web_forms', meta: { result: out.status } });
  res.json({ success: true, result: { status: out.status, reason: out.reason ?? null, visitorMessage: out.message, deliveries: log?.deliveries ?? [] } });
}));

admin.get('/submissions', requireAccess('settings', 'view'), asyncHandler(async (req, res) => {
  res.json({ success: true, submissions: await wf.recentSubmissions(tenantOf(req).orgId) });
}));

router.use(admin);
export default router;
