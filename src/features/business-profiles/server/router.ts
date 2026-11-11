/**
 * Business Profile Manager API — mounted at /api/business-profiles.
 *
 *   GET    /                                 profiles the caller is a member of (with live scores)     viewer
 *   POST   /                                 { data, source? } create (caller becomes owner)            any signed-in user
 *   GET    /integrations                     provider status for the caller                             any
 *   GET    /integrations/:provider/listings  listings the caller can link                               any
 *   POST   /integrations/:provider/import    { externalId } → draft data for review (nothing saved)      any
 *   GET    /:id                              full profile, live audit, history, role                    viewer
 *   PUT    /:id                              { version, data, suggestionId?, note? }                     editor
 *   PATCH  /:id/status                       { version, status }                                        editor (archive/restore: manager)
 *   POST   /:id/review                       { version, scope: profile|hours }                          editor
 *   DELETE /:id                              { confirmName }                                            owner
 *   POST   /:id/audits                       run + record an audit                                       editor
 *   POST   /:id/suggestions                  { kind, tone, notes? } AI suggestion (pending review)       editor
 *   DELETE /:id/suggestions/:sid             dismiss                                                     editor
 *   PUT    /:id/members                      { userId, role | null }                                    owner
 *   POST   /:id/listings                     { version, provider, externalId } link                     manager
 *   DELETE /:id/listings/:provider           { version } unlink                                          manager
 *   POST   /:id/listings/:provider/refresh   re-read listing from the provider                          editor
 *   POST   /:id/publish/preview              { provider, fields? } → diff + signed confirmToken          manager
 *   POST   /:id/publish                      { provider, confirmToken, confirm: true }                   manager
 *
 * Every route: verified sign-in, CSRF origin check on writes, JSON only, rate limits, strict zod
 * schemas, no-store caching, and errors without internal details.
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthedRequest } from '../../social-accounts/server/auth';
import { requireUser } from '../../social-accounts/server/auth';
import { csrfGuard, rateLimit, sendError, userKey } from '../../social-accounts/server/http';
import { parseProfileData, profileIdSchema, roleSchema, userIdSchema } from '../domain/validation';
import { TONES } from './assistant';
import type { BusinessProfilesService } from './service';

const version = z.number().int().min(1).max(1e9);
const providerId = z.enum(['google_business_profile']);
const externalId = z.string().regex(/^locations\/\d{1,30}$/, 'Invalid listing id.');
const publishable = z.enum(['phone', 'website', 'description']);

export function createBusinessProfilesRouter(svc: BusinessProfilesService, opts: { appUrl: string; limits?: Partial<Record<'all' | 'write' | 'ai' | 'external', number>> }) {
  const L = { all: 120, write: 40, ai: 8, external: 10, ...opts.limits };
  const r = Router();
  r.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  r.use(requireUser, csrfGuard(opts.appUrl), rateLimit({ name: 'bp', windowMs: 60_000, max: L.all, key: userKey }));
  const writes = rateLimit({ name: 'bp-write', windowMs: 60_000, max: L.write, key: userKey });
  const ai = rateLimit({ name: 'bp-ai', windowMs: 60_000, max: L.ai, key: userKey });
  const external = rateLimit({ name: 'bp-ext', windowMs: 60_000, max: L.external, key: userKey }); // provider quota-sensitive

  const uid = (req: AuthedRequest) => req.accountUser!.id;
  const id = (req: AuthedRequest) => profileIdSchema.parse(req.params.id);
  const body = <T extends z.ZodTypeAny>(schema: T, req: AuthedRequest): z.infer<T> => schema.parse(req.body ?? {});
  const handle = (ctx: string, fn: (req: AuthedRequest, res: Response) => Promise<unknown>) => async (req: AuthedRequest, res: Response) => {
    try { const out = await fn(req, res); if (!res.headersSent) res.json(out); } catch (err) { sendError(res, err, `business-profiles ${ctx}`); }
  };

  r.get('/', handle('list', async (req) => ({ profiles: await svc.list(uid(req)), aiConfigured: svc.aiConfigured() })));
  r.post('/', writes, handle('create', async (req, res) => {
    const b = body(z.object({ data: z.unknown(), source: z.enum(['manual', 'import']).default('manual') }).strict(), req);
    res.status(201);
    return svc.create(uid(req), parseProfileData(b.data), b.source);
  }));

  r.get('/integrations', handle('integrations', (req) => svc.integrations(uid(req))));
  r.get('/integrations/:provider/listings', handle('linkable', (req) => svc.linkable(uid(req), providerId.parse(req.params.provider))));
  r.post('/integrations/:provider/import', external, handle('import', (req) => svc.importDraft(uid(req), providerId.parse(req.params.provider), body(z.object({ externalId }).strict(), req).externalId)));

  r.get('/:id', handle('get', (req) => svc.get(uid(req), id(req))));
  r.put('/:id', writes, handle('update', (req) => {
    const b = body(z.object({ version, data: z.unknown(), suggestionId: z.string().regex(/^sg_[A-Za-z0-9_-]{8,20}$/).optional(), note: z.string().trim().max(200).optional() }).strict(), req);
    return svc.update(uid(req), id(req), { version: b.version, data: parseProfileData(b.data), source: 'manual', suggestionId: b.suggestionId, note: b.note?.replace(/[\u0000-\u001F\u007F]/g, '') });
  }));
  r.patch('/:id/status', writes, handle('status', (req) => svc.setStatus(uid(req), id(req), body(z.object({ version, status: z.enum(['draft', 'active', 'archived']) }).strict(), req))));
  r.post('/:id/review', writes, handle('review', (req) => svc.markReviewed(uid(req), id(req), body(z.object({ version, scope: z.enum(['profile', 'hours']) }).strict(), req))));
  r.delete('/:id', writes, handle('delete', (req) => svc.remove(uid(req), id(req), body(z.object({ confirmName: z.string().max(200) }).strict(), req).confirmName)));

  r.post('/:id/audits', writes, handle('audit', (req) => svc.runAudit(uid(req), id(req))));
  r.post('/:id/suggestions', ai, handle('suggest', (req) => svc.suggest(uid(req), id(req), body(z.object({ kind: z.enum(['description', 'services']), tone: z.enum(TONES).default('professional'), notes: z.string().trim().max(600).optional() }).strict(), req))));
  r.delete('/:id/suggestions/:sid', writes, handle('dismiss', (req) => svc.dismissSuggestion(uid(req), id(req), z.string().regex(/^sg_[A-Za-z0-9_-]{8,20}$/).parse(req.params.sid))));

  r.put('/:id/members', writes, handle('members', (req) => { const b = body(z.object({ userId: userIdSchema, role: roleSchema.nullable() }).strict(), req); return svc.setMember(uid(req), id(req), { userId: b.userId, role: b.role ?? null }); }));

  r.post('/:id/listings', external, handle('link', (req) => svc.link(uid(req), id(req), body(z.object({ version, provider: providerId, externalId }).strict(), req))));
  r.delete('/:id/listings/:provider', writes, handle('unlink', (req) => svc.unlink(uid(req), id(req), { version: body(z.object({ version }).strict(), req).version, provider: providerId.parse(req.params.provider) })));
  r.post('/:id/listings/:provider/refresh', external, handle('refresh', (req) => svc.refreshListing(uid(req), id(req), providerId.parse(req.params.provider))));
  r.post('/:id/publish/preview', external, handle('preview', (req) => svc.publishPreview(uid(req), id(req), body(z.object({ provider: providerId, fields: z.array(publishable).max(3).optional() }).strict(), req))));
  r.post('/:id/publish', external, handle('publish', (req) => svc.publish(uid(req), id(req), body(z.object({ provider: providerId, confirmToken: z.string().min(20).max(4000), confirm: z.literal(true, { message: 'Confirm the changes before publishing.' }) }).strict(), req))));

  return r;
}
