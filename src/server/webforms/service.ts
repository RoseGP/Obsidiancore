/**
 * Website forms → CRM (organization-scoped).
 *
 * Storage (server-only Firestore paths):
 *   organizations/{org}/settings/web_forms   config: public form id, allowed origins, thank-you URL, destinations,
 *                                            webhook URL + signing secret (AES-256-GCM encrypted)
 *   web_form_ids/{formId}                    public form id → organization
 *   organizations/{org}/web_form_submissions/{id}  delivery log: time, status, delivery results, a fingerprint
 *                                            for duplicate detection, the page host. NO name, email, phone or
 *                                            message (those live only in the CRM). expireAt = +30 days.
 */
import crypto from 'node:crypto';
import { assertId, getDocStore, newId, type DocStore } from '../data/docStore';
import { HttpError, badRequest, notFound } from '../http/errors';
import { logger } from '../http/logger';
import { CONSENT_PURPOSES, recordConsent } from '../compliance/records';
import { hashIp } from '../audit/auditLog';
import { coreSecret } from '../../utils/secrets';
import { ADAPTERS, PAYLOAD_VERSION, type DeliveryResult, type WebFormPayload } from './adapters';
import { OutboundError, validateWebhookUrl } from './safeHttp';
import { SubmissionSchema, fieldErrors, fingerprint, spamVerdict, type Submission } from './submission';

const DAY = 86_400_000;
const LOG_RETENTION_DAYS = 30;
const DUPLICATE_WINDOW_MS = 10 * 60_000;
const RETRY_DELAYS_MS = [2_000, 15_000];

// ---------------------------------------------------------------------------
// Secrets at rest
// ---------------------------------------------------------------------------
const key = () => crypto.createHash('sha256').update(coreSecret(['WEBFORM_ENCRYPTION_KEY', 'ENCRYPTION_KEY'])).digest();
export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}
export function unsealSecret(sealed: string): string {
  const [v, iv, tag, data] = String(sealed).split('.');
  if (v !== 'v1') throw new Error('unsupported secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export interface WebFormConfig {
  formId: string;
  allowedOrigins: string[];
  redirectUrl: string | null;
  destinations: { obsidian: boolean; webhook: boolean };
  webhook: { url: string; secret: string; secretHint: string; updatedAt: string } | null;
  updatedAt: string;
}

const cfgPath = (orgId: string) => `organizations/${assertId(orgId)}/settings/web_forms`;
const newFormId = () => `wf_${crypto.randomBytes(12).toString('base64url')}`;
const allowPrivateWebhooks = () => process.env.NODE_ENV !== 'production' && (process.env.WEBFORM_ALLOW_PRIVATE_WEBHOOKS || '').toLowerCase() === 'true';

export async function getConfig(orgId: string, st?: DocStore): Promise<WebFormConfig> {
  const store = st ?? (await getDocStore());
  const existing = await store.get(cfgPath(orgId));
  if (existing?.formId) return existing as WebFormConfig;
  // First use: create a public form id for the organization.
  const cfg: WebFormConfig = { formId: newFormId(), allowedOrigins: [], redirectUrl: null, destinations: { obsidian: true, webhook: false }, webhook: null, updatedAt: new Date().toISOString() };
  await store.transaction(async (tx) => {
    tx.set(cfgPath(orgId), cfg as any);
    tx.set(`web_form_ids/${cfg.formId}`, { orgId, createdAt: cfg.updatedAt });
  });
  return cfg;
}

/** What the admin screen sees: never the webhook secret, never other organizations. */
export function publicConfig(cfg: WebFormConfig) {
  return {
    formId: cfg.formId, allowedOrigins: cfg.allowedOrigins, redirectUrl: cfg.redirectUrl, destinations: cfg.destinations,
    webhook: cfg.webhook ? { url: cfg.webhook.url, secretHint: cfg.webhook.secretHint, updatedAt: cfg.webhook.updatedAt } : null,
    updatedAt: cfg.updatedAt,
  };
}

export function normalizeOrigin(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw badRequest(`"${raw.slice(0, 80)}" isn't a website address. Use the form https://www.example.com.`, 'invalid_origin'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) throw badRequest('Website addresses must start with https:// (http:// only for localhost).', 'invalid_origin');
  return u.origin;
}

export async function updateConfig(orgId: string, patch: { allowedOrigins?: string[]; redirectUrl?: string | null; destinations?: { obsidian?: boolean; webhook?: boolean }; webhookUrl?: string | null }) {
  const store = await getDocStore();
  const cfg = await getConfig(orgId, store);
  const next: WebFormConfig = { ...cfg, destinations: { ...cfg.destinations } };
  let newSecret: string | null = null;
  if (patch.allowedOrigins) next.allowedOrigins = [...new Set(patch.allowedOrigins.map(normalizeOrigin))].slice(0, 20);
  if (patch.redirectUrl !== undefined) {
    if (patch.redirectUrl) {
      let u: URL; try { u = new URL(patch.redirectUrl); } catch { throw badRequest('The thank-you page must be a full https:// address.', 'invalid_redirect'); }
      if (u.protocol !== 'https:') throw badRequest('The thank-you page must be a full https:// address.', 'invalid_redirect');
      next.redirectUrl = u.toString();
    } else next.redirectUrl = null;
  }
  if (patch.webhookUrl !== undefined) {
    if (patch.webhookUrl) {
      try { validateWebhookUrl(patch.webhookUrl, { allowHttp: allowPrivateWebhooks() }); } catch (e) { throw badRequest((e as OutboundError).message, 'invalid_webhook_url'); }
      if (!cfg.webhook) {
        newSecret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
        next.webhook = { url: patch.webhookUrl, secret: sealSecret(newSecret), secretHint: `${newSecret.slice(0, 10)}…`, updatedAt: new Date().toISOString() };
      } else next.webhook = { ...cfg.webhook, url: patch.webhookUrl, updatedAt: new Date().toISOString() };
    } else { next.webhook = null; next.destinations.webhook = false; }
  }
  if (patch.destinations) {
    if (patch.destinations.obsidian !== undefined) next.destinations.obsidian = patch.destinations.obsidian;
    if (patch.destinations.webhook !== undefined) next.destinations.webhook = patch.destinations.webhook;
  }
  if (next.destinations.webhook && !next.webhook) throw badRequest('Add a webhook URL before turning on webhook delivery.', 'webhook_missing');
  if (!next.destinations.obsidian && !next.destinations.webhook) throw badRequest('Keep at least one destination on, or submissions would go nowhere.', 'no_destination');
  next.updatedAt = new Date().toISOString();
  await store.set(cfgPath(orgId), next as any);
  return { config: publicConfig(next), webhookSecret: newSecret };
}

/** New signing secret (shown once). The old one stops working immediately. */
export async function rotateWebhookSecret(orgId: string) {
  const store = await getDocStore();
  const cfg = await getConfig(orgId, store);
  if (!cfg.webhook) throw badRequest('Add a webhook URL first.', 'webhook_missing');
  const secret = `whsec_${crypto.randomBytes(24).toString('base64url')}`;
  cfg.webhook = { ...cfg.webhook, secret: sealSecret(secret), secretHint: `${secret.slice(0, 10)}…`, updatedAt: new Date().toISOString() };
  await store.set(cfgPath(orgId), cfg as any);
  return { config: publicConfig(cfg), webhookSecret: secret };
}

/** New public form id; forms using the old id stop working (useful if a form is being abused). */
export async function rotateFormId(orgId: string) {
  const store = await getDocStore();
  const cfg = await getConfig(orgId, store);
  const formId = newFormId();
  await store.transaction(async (tx) => {
    tx.delete(`web_form_ids/${cfg.formId}`);
    tx.set(`web_form_ids/${formId}`, { orgId, createdAt: new Date().toISOString() });
    tx.set(cfgPath(orgId), { ...cfg, formId, updatedAt: new Date().toISOString() } as any);
  });
  return publicConfig({ ...cfg, formId });
}

export async function orgForFormId(formId: string): Promise<string | null> {
  if (!/^wf_[A-Za-z0-9_-]{16}$/.test(formId)) return null;
  const row = await (await getDocStore()).get(`web_form_ids/${formId}`);
  return row?.orgId ?? null;
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------
export type SubmissionStatus = 'accepted' | 'duplicate' | 'spam';
interface DeliveryLog { adapter: 'obsidian' | 'webhook'; status: 'delivered' | 'failed' | 'pending'; attempts: number; httpStatus?: number; detail?: string; at: string }
const logPath = (orgId: string, id: string) => `organizations/${assertId(orgId)}/web_form_submissions/${assertId(id)}`;

function payloadFrom(id: string, s: Submission, isTest = false): WebFormPayload {
  return {
    event: 'form.submission', version: PAYLOAD_VERSION, id, submittedAt: new Date().toISOString(), isTest,
    form: { name: s.formName || 'Website form' },
    contact: { name: s.name, email: s.email, phone: s.phone || null, company: s.company || null },
    message: s.message || null,
    consent: { contactAboutRequest: s.consent ?? null, marketing: s.marketingOptIn ?? null },
    source: { pageUrl: s.pageUrl || null, utm: { source: s.utm_source || null, medium: s.utm_medium || null, campaign: s.utm_campaign || null } },
  };
}

const PUBLIC_OK = 'Thank you! We received your message and will get back to you soon.';

export interface SubmitMeta { origin?: string | null; ip?: string; now?: number }
export interface SubmitOutcome { status: SubmissionStatus; message: string; id?: string; config: WebFormConfig; orgId: string }

/**
 * Validates and processes a public submission. Spam and duplicates get the same success message as real
 * submissions (bots learn nothing; double clicks are harmless) but are not sent to the CRM again.
 */
export async function submit(formId: string, raw: Record<string, unknown>, meta: SubmitMeta = {}): Promise<SubmitOutcome> {
  const orgId = await orgForFormId(formId);
  if (!orgId) throw notFound('This form isn\'t connected. Check the form id in your website code.', 'form_not_found');
  const store = await getDocStore();
  const cfg = await getConfig(orgId, store);
  if (meta.origin && cfg.allowedOrigins.length && !cfg.allowedOrigins.includes(meta.origin)) {
    throw new HttpError(403, 'origin_not_allowed', 'This website isn\'t allowed to send this form. Add it under Website forms → Allowed websites.');
  }
  const parsed = SubmissionSchema.safeParse(raw ?? {});
  if (!parsed.success) throw badRequest('Please check the highlighted fields.', 'invalid_input', { fields: fieldErrors(parsed.error) });
  const s = parsed.data;
  const now = meta.now ?? Date.now();
  const at = new Date(now).toISOString();
  const expireAt = new Date(now + LOG_RETENTION_DAYS * DAY).toISOString();
  const originHost = meta.origin ? (() => { try { return new URL(meta.origin!).host; } catch { return null; } })() : null;

  const spam = spamVerdict(raw, s, now);
  if (spam.spam) {
    const id = newId('wfs');
    await store.set(logPath(orgId, id), { id, at, expireAt, status: 'spam', reason: spam.reason, formName: s.formName || 'Website form', originHost, deliveries: [] });
    logger.info('webforms.spam', { org: orgId, reason: spam.reason });
    return { status: 'spam', message: PUBLIC_OK, config: cfg, orgId };
  }

  const fp = fingerprint(orgId, s);
  const recent = await store.list(`organizations/${orgId}/web_form_submissions`, { where: [['fingerprint', '==', fp]], limit: 10 }).catch(() => []);
  if (recent.some((r: any) => r.status === 'accepted' && now - Date.parse(r.at) < DUPLICATE_WINDOW_MS)) {
    const id = newId('wfs');
    await store.set(logPath(orgId, id), { id, at, expireAt, status: 'duplicate', fingerprint: fp, formName: s.formName || 'Website form', originHost, deliveries: [] });
    return { status: 'duplicate', message: PUBLIC_OK, config: cfg, orgId };
  }

  const id = newId('wfs');
  const payload = payloadFrom(id, s);
  const deliveries: DeliveryLog[] = [];
  if (cfg.destinations.obsidian) deliveries.push({ adapter: 'obsidian', status: 'pending', attempts: 0, at });
  if (cfg.destinations.webhook && cfg.webhook) deliveries.push({ adapter: 'webhook', status: 'pending', attempts: 0, at });
  await store.set(logPath(orgId, id), { id, at, expireAt, status: 'accepted', fingerprint: fp, formName: payload.form.name, originHost, deliveries });

  if (s.consent !== undefined || s.marketingOptIn !== undefined) await recordFormConsents(orgId, s, meta.ip);

  // Built-in CRM first and synchronously, so a failure can be reported to the visitor.
  if (cfg.destinations.obsidian) {
    const r = await ADAPTERS.obsidian.deliver(payload, { orgId });
    await recordDelivery(orgId, id, 'obsidian', r);
    if (!r.ok && !(cfg.destinations.webhook && cfg.webhook)) {
      throw new HttpError(503, 'crm_unavailable', 'We couldn\'t save your message just now. Please try again in a few minutes.');
    }
  }
  // Webhook in the background with retries; the visitor doesn't wait for a third-party server.
  if (cfg.destinations.webhook && cfg.webhook) track(deliverWebhook(orgId, id, payload, cfg.webhook, 0));
  logger.info('webforms.accepted', { org: orgId, submission: id, destinations: deliveries.map((d) => d.adapter) });
  return { status: 'accepted', message: PUBLIC_OK, id, config: cfg, orgId };
}

async function recordFormConsents(orgId: string, s: Submission, ip?: string) {
  const entries: Array<[typeof CONSENT_PURPOSES[number], boolean]> = [];
  if (s.consent !== undefined) entries.push(['data_processing', s.consent]);
  if (s.marketingOptIn !== undefined) entries.push(['marketing_email', s.marketingOptIn]);
  for (const [purpose, granted] of entries) {
    try { await recordConsent(orgId, { email: s.email, purpose, status: granted ? 'granted' : 'withdrawn', source: `website_form: ${(s.formName || 'Website form').slice(0, 60)}`, note: '' }, { ipHash: hashIp(ip) }); }
    catch { logger.warn('webforms.consent_not_recorded', { org: orgId, purpose }); }
  }
}

async function recordDelivery(orgId: string, id: string, adapter: 'obsidian' | 'webhook', r: DeliveryResult, attempts = 1) {
  const store = await getDocStore();
  await store.transaction(async (tx) => {
    const rec = await tx.get(logPath(orgId, id));
    if (!rec) return;
    const deliveries: DeliveryLog[] = (rec.deliveries || []).map((d: DeliveryLog) => (d.adapter !== adapter ? d : {
      adapter, attempts, at: new Date().toISOString(),
      status: r.ok ? 'delivered' : (!r.retryable || attempts > RETRY_DELAYS_MS.length) ? 'failed' : 'pending',
      ...(r.httpStatus ? { httpStatus: r.httpStatus } : {}),
      detail: r.ok ? r.detail || 'Delivered.' : r.error,
    }));
    tx.update(logPath(orgId, id), { deliveries });
  });
}

const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
const inflight = new Set<Promise<void>>();
const track = (p: Promise<void>) => { inflight.add(p); p.catch((e) => logger.error('webforms.delivery_crashed', { error: e })).finally(() => inflight.delete(p)); };
/** Tests: wait for background deliveries (including retries). */
export async function flushDeliveries() { while (pendingTimers.size || inflight.size) await new Promise((r) => setTimeout(r, 20)); }

async function deliverWebhook(orgId: string, id: string, payload: WebFormPayload, hook: NonNullable<WebFormConfig['webhook']>, attempt: number): Promise<void> {
  let secret: string;
  try { secret = unsealSecret(hook.secret); } catch {
    await recordDelivery(orgId, id, 'webhook', { ok: false, retryable: false, error: 'The webhook signing secret can\'t be read (encryption key changed?). Rotate the secret.' }, attempt + 1);
    return;
  }
  const r = await ADAPTERS.webhook.deliver(payload, { orgId, webhook: { url: hook.url, secret, allowPrivate: allowPrivateWebhooks() } });
  await recordDelivery(orgId, id, 'webhook', r, attempt + 1);
  if (!r.ok) logger.warn('webforms.webhook_failed', { org: orgId, submission: id, attempt: attempt + 1, httpStatus: r.httpStatus, retryable: r.retryable });
  if (!r.ok && r.retryable && attempt < RETRY_DELAYS_MS.length) {
    const delay = Number(process.env.WEBFORM_RETRY_DELAY_MS) >= 0 && process.env.WEBFORM_RETRY_DELAY_MS ? Number(process.env.WEBFORM_RETRY_DELAY_MS) : RETRY_DELAYS_MS[attempt];
    const t = setTimeout(() => { pendingTimers.delete(t); track(deliverWebhook(orgId, id, payload, hook, attempt + 1)); }, delay);
    pendingTimers.add(t);
  }
}

/** Sends a clearly marked test payload to the configured webhook and reports the result. */
export async function testWebhook(orgId: string) {
  const cfg = await getConfig(orgId);
  if (!cfg.webhook) throw badRequest('Add a webhook URL first.', 'webhook_missing');
  const payload = payloadFrom(newId('wft'), { name: 'Test Person', email: 'test@example.com', message: 'This is a test submission from Obsidian CRM. It is not a real inquiry.', formName: 'Test', phone: undefined, company: 'Example Co' } as Submission, true);
  const r = await ADAPTERS.webhook.deliver(payload, { orgId, webhook: { url: cfg.webhook.url, secret: unsealSecret(cfg.webhook.secret), allowPrivate: allowPrivateWebhooks() } });
  return r.ok ? { ok: true, message: r.detail || 'Delivered.', httpStatus: r.httpStatus } : { ok: false, message: r.error, httpStatus: r.httpStatus };
}

/** Recent submissions for the admin screen: delivery metadata only. */
/** Deletes log entries past their expireAt (oldest first, bounded). Runs whenever the log is read. */
export async function purgeExpiredSubmissions(orgId: string, now = Date.now()) {
  const store = await getDocStore();
  const oldest = await store.list(`organizations/${assertId(orgId)}/web_form_submissions`, { orderBy: 'at', direction: 'asc', limit: 200 });
  const expired = oldest.filter((r: any) => typeof r.expireAt === 'string' && r.expireAt <= new Date(now).toISOString());
  for (const r of expired) await store.deleteRecursive(logPath(orgId, r.id));
  return expired.length;
}

export async function recentSubmissions(orgId: string, limit = 50) {
  await purgeExpiredSubmissions(orgId);
  const rows = await (await getDocStore()).list(`organizations/${assertId(orgId)}/web_form_submissions`, { orderBy: 'at', direction: 'desc', limit: Math.min(200, limit) });
  return rows.map((r: any) => ({ id: r.id, at: r.at, status: r.status, reason: r.reason || null, formName: r.formName, originHost: r.originHost || null, deliveries: r.deliveries || [] }));
}
