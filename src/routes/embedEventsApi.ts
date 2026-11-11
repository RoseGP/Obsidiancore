/**
 * Public calendar API for the embeddable widget (cross-origin).
 *
 *   GET    /api/v1/events?startDate&endDate     events:read
 *   GET    /api/v1/events/stream                events:read   real-time changes (SSE over fetch; Authorization header)
 *   POST   /api/v1/events                       events:write  publishable keys create *pending* requests only
 *   PATCH  /api/v1/events/:id                   events:write  embed tokens only; send `version` (or If-Match) to avoid overwriting
 *   DELETE /api/v1/events/:id                   events:write  embed tokens only
 *   POST   /api/v1/embed-tokens                 secret key, server-to-server only: mint a short-lived embed token
 *
 * Auth: `Authorization: Bearer <pk_… | et_…>` or `X-API-Key: pk_…`. CORS: the response allows the caller's
 * Origin only if that origin is on the key/token; no cookies are used (no Allow-Credentials).
 * Data: organizations/{orgId}/calendar_events/{id}, isolated per organization by path.
 */
import { EventEmitter } from 'node:events';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { assertId, getDocStore, newId } from '../server/data/docStore';
import { authenticateEmbed, mintEmbedToken, type EmbedPrincipal } from '../server/embed/embedKeys';
import { sendError } from '../server/tenancy/middleware';

export const eventsRouter = Router();
export const embedTokensRouter = Router();

type Req = Request & { embed?: EmbedPrincipal };
const DAY = 86_400_000;
const bus = new EventEmitter(); bus.setMaxListeners(0);

// ---------------------------------------------------------------------------
// CORS + authentication
// ---------------------------------------------------------------------------
const ALLOW_HEADERS = 'Authorization, Content-Type, X-API-Key, If-Match';
const ALLOW_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';

function corsPreflight(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'OPTIONS') return next();
  // Preflights carry no credentials, so the origin is checked on the real request (which then gets
  // Access-Control-Allow-Origin only if the key allows that origin).
  const origin = req.get('origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
    res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);
    res.setHeader('Access-Control-Max-Age', '600');
  }
  res.status(204).end();
}

async function authenticate(req: Req, res: Response, next: NextFunction) {
  try {
    const auth = req.get('authorization') || '';
    const credential = (auth.startsWith('Bearer ') ? auth.slice(7) : req.get('x-api-key') || '').trim();
    const principal = await authenticateEmbed(credential);
    const origin = req.get('origin');
    if (!principal) return res.status(401).json({ success: false, code: 'unauthorized', error: 'A valid publishable key or embed token is required.' });
    const originOk = origin ? principal.allowedOrigins.includes(origin) : principal.via === 'token';
    if (!originOk) {
      // No Access-Control-Allow-Origin here: the browser hides the response from the other site.
      return res.status(403).json({ success: false, code: 'origin_not_allowed', error: 'This website isn’t allowed to use this key.' });
    }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Cache-Control', 'no-store');
    req.embed = principal;
    next();
  } catch (err) { sendError(res, err, 'embed.auth'); }
}

const need = (scope: 'events:read' | 'events:write', tokensOnly = false) => (req: Req, res: Response, next: NextFunction) => {
  const p = req.embed!;
  if (!p.scopes.includes(scope)) return res.status(403).json({ success: false, code: 'forbidden', error: scope === 'events:write' ? 'This calendar is read-only.' : 'This key can’t read events.' });
  if (tokensOnly && p.via !== 'token') return res.status(403).json({ success: false, code: 'token_required', error: 'Editing needs a signed-in session (embed token), not a public key.' });
  next();
};

const keyOf = (req: Req) => `${req.embed?.keyId ?? 'none'}:${req.ip}`;
const readLimit = rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: keyOf as any, validate: false, message: { success: false, code: 'rate_limited', error: 'Too many requests. Try again in a minute.' } });
const writeLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: keyOf as any, validate: false, message: { success: false, code: 'rate_limited', error: 'Too many changes. Try again in a minute.' } });
// Public (publishable-key) requests can come from any visitor: much tighter.
const publicWriteLimit = (req: Req, res: Response, next: NextFunction) => (req.embed?.via === 'publishable' ? publicLimiter(req, res, next) : next());
const publicLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: keyOf as any, validate: false, message: { success: false, code: 'rate_limited', error: 'Too many requests from this device. Try again later.' } });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const iso = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'Use an ISO 8601 date-time.');
const channel = z.string().trim().min(1).max(40).regex(/^[\w .&+-]+$/, 'Channel names may use letters, numbers, spaces and . & + -');
const STATUSES = ['scheduled', 'draft', 'pending', 'cancelled'] as const;
const createBody = z.object({
  title: z.string().trim().min(1, 'Add a title.').max(200),
  scheduledAt: iso,
  endAt: iso.optional(),
  allDay: z.boolean().optional(),
  content: z.string().max(5000).optional().default(''),
  channels: z.array(channel).max(10).optional(),
  platform: channel.optional(),
  status: z.enum(['scheduled', 'draft']).optional(),
}).strict().refine((b) => !b.endAt || Date.parse(b.endAt) >= Date.parse(b.scheduledAt), { message: 'The end must be after the start.', path: ['endAt'] });
const patchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  scheduledAt: iso.optional(),
  endAt: iso.nullable().optional(),
  allDay: z.boolean().optional(),
  content: z.string().max(5000).optional(),
  channels: z.array(channel).max(10).optional(),
  status: z.enum(STATUSES).optional(),
  version: z.number().int().positive().optional(),
}).strict().refine((b) => Object.keys(b).some((k) => k !== 'version'), 'Nothing to change.');
const rangeQuery = z.object({ startDate: iso, endDate: iso }).refine((r) => Date.parse(r.endDate) > Date.parse(r.startDate) && Date.parse(r.endDate) - Date.parse(r.startDate) <= 100 * DAY, 'Use a range of at most 100 days.');

const path = (orgId: string, id?: string) => `organizations/${assertId(orgId)}/calendar_events${id ? `/${assertId(id)}` : ''}`;
/** What leaves the server: no internal fields (key ids, subjects). */
const view = (e: any) => ({ id: e.id, title: e.title, content: e.content ?? '', scheduledAt: e.scheduledAt, endAt: e.endAt ?? null, allDay: !!e.allDay, channels: e.channels ?? [], status: e.status, version: e.version, updatedAt: e.updatedAt });
function publish(orgId: string, type: 'created' | 'updated' | 'deleted', event: any) { bus.emit(orgId, { type, event: type === 'deleted' ? { id: event.id } : view(event) }); }

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
eventsRouter.use(corsPreflight, authenticate);

eventsRouter.get('/', need('events:read'), readLimit, async (req: Req, res) => {
  try {
    const q = rangeQuery.parse({ startDate: req.query.startDate, endDate: req.query.endDate });
    const from = Date.parse(q.startDate), to = Date.parse(q.endDate);
    const all = await (await getDocStore()).list(path(req.embed!.orgId));
    const canSeePending = req.embed!.via === 'token';
    const events = all.filter((e) => e.status !== 'cancelled' && (canSeePending || e.status !== 'pending' && e.status !== 'draft'))
      .filter((e) => { const s = Date.parse(e.scheduledAt), en = e.endAt ? Date.parse(e.endAt) : s; return en >= from && s < to; })
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).map(view);
    res.json({ success: true, events, permissions: { write: req.embed!.scopes.includes('events:write'), manage: req.embed!.via === 'token' && req.embed!.scopes.includes('events:write') } });
  } catch (err) { sendError(res, err, 'embed.list'); }
});

eventsRouter.get('/stream', need('events:read'), readLimit, (req: Req, res) => {
  const { orgId, via } = req.embed!;
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': connected\n\n');
  const onChange = (msg: any) => {
    if (via !== 'token' && (msg.event?.status === 'pending' || msg.event?.status === 'draft')) return; // public viewers see only scheduled events
    res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };
  bus.on(orgId, onChange);
  const beat = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(beat); bus.off(orgId, onChange); });
});

eventsRouter.post('/', need('events:write'), publicWriteLimit, writeLimit, async (req: Req, res) => {
  try {
    const b = createBody.parse(req.body ?? {});
    const p = req.embed!;
    const now = new Date().toISOString();
    const event = {
      id: newId('evt'), title: b.title, content: b.content, scheduledAt: new Date(b.scheduledAt).toISOString(), endAt: b.endAt ? new Date(b.endAt).toISOString() : null,
      allDay: !!b.allDay, channels: [...new Set([...(b.channels ?? []), ...(b.platform ? [b.platform] : [])])],
      // A public key can only *request* a slot; staff (embed token) schedule directly.
      status: p.via === 'token' ? (b.status ?? 'scheduled') : 'pending',
      createdAt: now, updatedAt: now, version: 1, createdVia: p.keyId, createdBy: p.subject ?? null,
    };
    await (await getDocStore()).set(path(p.orgId, event.id), event);
    publish(p.orgId, 'created', event);
    res.status(201).json({ success: true, event: view(event) });
  } catch (err) { sendError(res, err, 'embed.create'); }
});

eventsRouter.patch('/:id', need('events:write', true), writeLimit, async (req: Req, res) => {
  try {
    const b = patchBody.parse(req.body ?? {});
    const p = req.embed!;
    const ifMatch = Number(String(req.get('if-match') || '').replace(/\D/g, '')) || undefined;
    const expected = b.version ?? ifMatch;
    const st = await getDocStore();
    const result = await st.transaction(async (tx) => {
      const cur = await tx.get(path(p.orgId, req.params.id));
      if (!cur) return { status: 404 as const };
      if (expected && cur.version !== expected) return { status: 409 as const, cur };
      const { version: _v, ...changes } = b;
      const next = { ...cur, ...changes, version: cur.version + 1, updatedAt: new Date().toISOString(), updatedBy: p.subject ?? null };
      if (changes.scheduledAt) next.scheduledAt = new Date(changes.scheduledAt).toISOString();
      if (changes.endAt) next.endAt = new Date(changes.endAt).toISOString();
      if (next.endAt && Date.parse(next.endAt) < Date.parse(next.scheduledAt)) return { status: 400 as const };
      tx.set(path(p.orgId, req.params.id), next);
      return { status: 200 as const, next };
    });
    if (result.status === 404) return res.status(404).json({ success: false, code: 'not_found', error: 'Event not found.' });
    if (result.status === 400) return res.status(400).json({ success: false, code: 'invalid_range', error: 'The end must be after the start.' });
    if (result.status === 409) return res.status(409).json({ success: false, code: 'conflict', error: 'Someone else changed this event. The latest version is shown.', event: view(result.cur) });
    publish(p.orgId, 'updated', result.next);
    res.json({ success: true, event: view(result.next) });
  } catch (err) { sendError(res, err, 'embed.update'); }
});

eventsRouter.delete('/:id', need('events:write', true), writeLimit, async (req: Req, res) => {
  try {
    const p = req.embed!;
    const removed = await (await getDocStore()).deleteRecursive(path(p.orgId, req.params.id));
    if (!removed) return res.status(404).json({ success: false, code: 'not_found', error: 'Event not found.' });
    publish(p.orgId, 'deleted', { id: req.params.id });
    res.json({ success: true, id: req.params.id });
  } catch (err) { sendError(res, err, 'embed.delete'); }
});

// ---------------------------------------------------------------------------
// Token minting: server-to-server only
// ---------------------------------------------------------------------------
const mintBody = z.object({ scopes: z.array(z.string()).max(4).optional(), ttlSeconds: z.number().int().min(60).max(3600).optional(), subject: z.string().max(120).optional(), origins: z.array(z.string().max(200)).max(20).optional() }).strict();
const mintLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });
embedTokensRouter.post('/', mintLimit, async (req, res) => {
  try {
    // A browser sending a secret key means the key leaked into front-end code: refuse and say why.
    if (req.get('origin')) return res.status(400).json({ success: false, code: 'server_only', error: 'Call this from your server. Never put a secret key in browser code.' });
    const auth = req.get('authorization') || '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ success: true, ...(await mintEmbedToken(key, mintBody.parse(req.body ?? {}))) });
  } catch (err) { sendError(res, err, 'embed.mint'); }
});
