/**
 * Business Profile Manager API — mounted at /api/business-profiles.
 *
 * Permissions are the organization's RBAC matrix, module `listings` (view/create/edit/share/delete):
 *   GET    /                                 profiles in the caller's organization (live scores)        view
 *   POST   /                                 { data, source? } create                                   create
 *   GET    /integrations                     provider status for the caller                             view
 *   GET    /integrations/:provider/listings  listings the caller can link                               view
 *   POST   /integrations/:provider/import    { externalId } → draft data for review (nothing saved)      create
 *   GET    /:id                              full profile, live audit, history, permissions             view
 *   PUT    /:id                              { version, data, suggestionId?, note? }                     edit
 *   PATCH  /:id/status                       { version, status }                                        edit (archive/restore: share)
 *   POST   /:id/review                       { version, scope: profile|hours }                          edit
 *   DELETE /:id                              { confirmName }                                            delete
 *   POST   /:id/audits                       run + record an audit                                       edit
 *   POST   /:id/suggestions                  { kind, tone, notes? } AI suggestion (pending review)       edit
 *   DELETE /:id/suggestions/:sid             dismiss                                                     edit
 *   POST   /:id/listings                     { version, provider, externalId } link                     share
 *   DELETE /:id/listings/:provider           { version } unlink                                          share
 *   POST   /:id/listings/:provider/refresh   re-read listing from the provider                          edit
 *   POST   /:id/publish/preview              { provider, fields? } → diff + signed confirmToken          share
 *   POST   /:id/publish                      { provider, confirmToken, confirm: true }                   share
 *
 * Mounted behind guard() (verified sign-in), then requireTenant (organization from server-side membership)
 * and requireAccess per route; the service re-checks. Also: CSRF origin check on writes, JSON only, rate
 * limits, strict zod schemas, no-store caching, and errors without internal details.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { csrfGuard, rateLimit } from '../../social-accounts/server/http';
import { AccountsError } from '../../social-accounts/server/service';
import { requireTenant, sendError, tenantOf } from '../../../server/tenancy/middleware';
import { requireAccess, type Permission } from '../../../server/security/permissions';
import { parseProfileData, profileIdSchema } from '../domain/validation';
import { TONES } from './assistant';
import type { Actor, BusinessProfilesService } from './service';

const version = z.number().int().min(1).max(1e9);
const providerId = z.enum(['google_business_profile']);
const externalId = z.string().regex(/^locations\/\d{1,30}$/, 'Invalid listing id.');
const publishable = z.enum(['phone', 'website', 'description']);
const suggestionId = z.string().regex(/^sg_[A-Za-z0-9_-]{8,20}$/);

/** Service errors carry safe, user-facing messages (incl. 502/503 for AI and Google); everything else uses the CRM's sendError. */
function fail(res: Response, err: unknown, tag: string) {
  if (err instanceof AccountsError) return res.status(err.status).json({ success: false, code: err.code, error: err.message, field: err.field });
  return sendError(res, err, tag);
}

export function createBusinessProfilesRouter(svc: BusinessProfilesService, opts: { appUrl: string; limits?: Partial<Record<'all' | 'write' | 'ai' | 'external', number>> }) {
  const L = { all: 120, write: 40, ai: 8, external: 10, ...opts.limits };
  const r = Router();
  // guard() copies the verified user id into req.body.userId for legacy handlers. Identity here comes only
  // from the tenant, so drop it before the strict schemas run (which reject unknown keys).
  r.use((req, _res, next) => { if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) delete req.body.userId; next(); });
  r.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  const key = (req: Request) => { const t = (req as any).tenant; return t ? `${t.orgId}:${t.userId}` : req.ip || 'anon'; };
  r.use(csrfGuard(opts.appUrl), requireTenant, rateLimit({ name: 'bp', windowMs: 60_000, max: L.all, key }));
  const writes = rateLimit({ name: 'bp-write', windowMs: 60_000, max: L.write, key });
  const ai = rateLimit({ name: 'bp-ai', windowMs: 60_000, max: L.ai, key });
  const external = rateLimit({ name: 'bp-ext', windowMs: 60_000, max: L.external, key }); // provider quota-sensitive
  const can = (p: Permission) => requireAccess('listings', p);

  const actor = (req: Request): Actor => { const t = tenantOf(req); return { orgId: t.orgId, userId: t.userId, role: t.role, email: t.email, ip: req.ip }; };
  const id = (req: Request) => profileIdSchema.parse(req.params.id);
  const body = <T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.body ?? {});
  const handle = (ctx: string, fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
    try { const out = await fn(req, res); if (!res.headersSent) res.json(out); } catch (err) { fail(res, err, `business-profiles ${ctx}`); }
  };

  r.get('/', can('view'), handle('list', async (req) => ({ ...(await svc.list(actor(req))), aiConfigured: svc.aiConfigured() })));
  r.post('/', can('create'), writes, handle('create', async (req, res) => {
    const b = body(z.object({ data: z.unknown(), source: z.enum(['manual', 'import']).default('manual') }).strict(), req);
    const out = await svc.create(actor(req), parseProfileData(b.data), b.source);
    res.status(201);
    return out;
  }));

  r.get('/integrations', can('view'), handle('integrations', (req) => svc.integrations(actor(req))));
  r.get('/integrations/:provider/listings', can('view'), handle('linkable', (req) => svc.linkable(actor(req), providerId.parse(req.params.provider))));
  r.post('/integrations/:provider/import', can('create'), external, handle('import', (req) => svc.importDraft(actor(req), providerId.parse(req.params.provider), body(z.object({ externalId }).strict(), req).externalId)));

  r.get('/:id', can('view'), handle('get', (req) => svc.get(actor(req), id(req))));
  r.put('/:id', can('edit'), writes, handle('update', (req) => {
    const b = body(z.object({ version, data: z.unknown(), suggestionId: suggestionId.optional(), note: z.string().trim().max(200).optional() }).strict(), req);
    return svc.update(actor(req), id(req), { version: b.version, data: parseProfileData(b.data), suggestionId: b.suggestionId, note: b.note?.replace(/[\u0000-\u001F\u007F]/g, '') });
  }));
  r.patch('/:id/status', can('edit'), writes, handle('status', (req) => svc.setStatus(actor(req), id(req), body(z.object({ version, status: z.enum(['draft', 'active', 'archived']) }).strict(), req))));
  r.post('/:id/review', can('edit'), writes, handle('review', (req) => svc.markReviewed(actor(req), id(req), body(z.object({ version, scope: z.enum(['profile', 'hours']) }).strict(), req))));
  r.delete('/:id', can('delete'), writes, handle('delete', (req) => svc.remove(actor(req), id(req), body(z.object({ confirmName: z.string().max(200) }).strict(), req).confirmName)));

  r.post('/:id/audits', can('edit'), writes, handle('audit', (req) => svc.runAudit(actor(req), id(req))));
  r.post('/:id/suggestions', can('edit'), ai, handle('suggest', (req) => svc.suggest(actor(req), id(req), body(z.object({ kind: z.enum(['description', 'services']), tone: z.enum(TONES).default('professional'), notes: z.string().trim().max(600).optional() }).strict(), req))));
  r.delete('/:id/suggestions/:sid', can('edit'), writes, handle('dismiss', (req) => svc.dismissSuggestion(actor(req), id(req), suggestionId.parse(req.params.sid))));

  r.post('/:id/listings', can('share'), external, handle('link', (req) => svc.link(actor(req), id(req), body(z.object({ version, provider: providerId, externalId }).strict(), req))));
  r.delete('/:id/listings/:provider', can('share'), writes, handle('unlink', (req) => svc.unlink(actor(req), id(req), { version: body(z.object({ version }).strict(), req).version, provider: providerId.parse(req.params.provider) })));
  r.post('/:id/listings/:provider/refresh', can('edit'), external, handle('refresh', (req) => svc.refreshListing(actor(req), id(req), providerId.parse(req.params.provider))));
  r.post('/:id/publish/preview', can('share'), external, handle('preview', (req) => svc.publishPreview(actor(req), id(req), body(z.object({ provider: providerId, fields: z.array(publishable).max(3).optional() }).strict(), req))));
  r.post('/:id/publish', can('share'), external, handle('publish', (req) => svc.publish(actor(req), id(req), body(z.object({ provider: providerId, confirmToken: z.string().min(20).max(4000), confirm: z.literal(true, { message: 'Confirm the changes before publishing.' }) }).strict(), req))));

  return r;
}
