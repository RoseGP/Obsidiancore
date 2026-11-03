/**
 * Local SEO (Google Business Profile) — /api/local-seo
 *
 *   GET    /connection                    connection status                          (auth)
 *   POST   /connect                       → { url } Google consent (OAuth + PKCE)    (auth, CSRF)
 *   GET    /callback                      Google redirect: code + state (+ cookie)
 *   DELETE /connection                    revoke at Google + delete local data       (auth, CSRF)
 *   GET    /locations                     discovered locations (+ selected flag)     (auth)
 *   POST   /locations/discover            re-read accounts/locations from Google     (auth, CSRF)
 *   PUT    /locations/selection           { locationNames }                         (auth, CSRF)
 *   GET    /overview                      selected locations, audit, activity       (auth)
 *   POST   /sync                          pull reviews for selected locations        (auth, CSRF)
 *   GET    /reviews?location&status       synced reviews                            (auth)
 *   POST   /reviews/:id/draft             AI draft { tone? }                        (auth, CSRF)
 *   PUT    /reviews/:id/reply             publish (human-approved) { comment }      (auth, CSRF)
 *   DELETE /reviews/:id/reply             remove reply                               (auth, CSRF)
 *   GET    /performance?location&days     Business Profile Performance API           (auth)
 *   GET    /posts?location                Google posts                              (auth)
 *   POST   /posts                         publish a Google post                     (auth, CSRF)
 *   PATCH  /locations/profile             { location, phone?, website?, description? } (auth, CSRF)
 *   POST   /description/draft             AI description draft                       (auth, CSRF)
 *   PUT    /settings                      brand voice, sign-off                      (auth, CSRF)
 */
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireUser, type AuthedRequest } from '../features/social-accounts/server/auth';
import { csrfGuard, ipKey, rateLimit, sendError, userKey } from '../features/social-accounts/server/http';
import { config } from '../features/social-accounts/server/instance';
import { gbp, growth } from '../features/gbp/server/instance';
import { GBP_STATE_COOKIE } from '../features/gbp/server/service';
import { PHOTO_CATEGORIES, PHOTO_MAX_BYTES } from '../features/gbp/server/growth';
import { AccountsError } from '../features/social-accounts/server/service';

const router = Router();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });

const cookieAttrs = (maxAge: number) => ['Path=/api/local-seo', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, ...(config.isProduction ? ['Secure'] : [])].join('; ');
function readCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) { try { return decodeURIComponent(v.join('=')); } catch { return undefined; } } }
  return undefined;
}

const locName = z.string().regex(/^locations\/\d{1,30}$/, 'Invalid location.');
const reviewId = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'Invalid review id.');
const httpsUrl = z.string().max(2048).url().refine((u) => u.startsWith('https://'), 'Use an https:// link.');

router.get('/callback', rateLimit({ name: 'gbp-cb', windowMs: 60_000, max: 30, key: ipKey }), async (req, res) => {
  const q = z.object({ code: z.string().max(2048).optional(), state: z.string().max(2048).optional(), error: z.string().max(200).optional() }).safeParse(req.query);
  const target = await gbp.callback(q.success ? q.data : {}, readCookie(req, GBP_STATE_COOKIE));
  res.append('Set-Cookie', `${GBP_STATE_COOKIE}=; ${cookieAttrs(0)}`);
  res.redirect(302, target);
});

router.use(requireUser, csrfGuard(config.appUrl, { multipartPaths: ['/growth/photos'] }), rateLimit({ name: 'gbp', windowMs: 60_000, max: 120, key: userKey }));
// Google quota-sensitive. Google's default Business Profile quota is per project (hundreds of requests/min); this caps one user.
const heavy = rateLimit({ name: 'gbp-heavy', windowMs: 60_000, max: Number(process.env.GBP_HEAVY_RATE_LIMIT) || 30, key: userKey });
const aiLimit = rateLimit({ name: 'gbp-ai', windowMs: 60_000, max: 20, key: userKey });
const uid = (req: AuthedRequest) => req.accountUser!.id;
const handle = (ctx: string, fn: (req: AuthedRequest, res: Response) => Promise<unknown>) => async (req: AuthedRequest, res: Response) => {
  try { const out = await fn(req, res); if (!res.headersSent) res.json(out); } catch (err) { sendError(res, err, `local-seo ${ctx}`); }
};

router.get('/connection', handle('connection', (req) => gbp.connection(uid(req))));
router.post('/connect', rateLimit({ name: 'gbp-connect', windowMs: 10 * 60_000, max: 10, key: userKey }), handle('connect', async (req, res) => {
  const { url, cookieState } = await gbp.startConnect(uid(req));
  res.append('Set-Cookie', `${GBP_STATE_COOKIE}=${encodeURIComponent(cookieState)}; ${cookieAttrs(600)}`);
  return { url };
}));
router.delete('/connection', handle('disconnect', (req) => gbp.disconnect(uid(req))));

router.get('/locations', handle('locations', (req) => gbp.listLocations(uid(req))));
router.post('/locations/discover', heavy, handle('discover', (req) => gbp.discoverLocations(uid(req))));
router.put('/locations/selection', handle('select', (req) => gbp.selectLocations(uid(req), z.object({ locationNames: z.array(locName).max(100) }).strict().parse(req.body ?? {}).locationNames)));
router.patch('/locations/profile', handle('profile', (req) => {
  const b = z.object({ location: locName, phone: z.string().trim().regex(/^[+()\d\s.-]{6,24}$/, 'Enter a valid phone number.').optional(), website: httpsUrl.optional(), description: z.string().trim().max(750).optional() }).strict()
    .refine((x) => x.phone !== undefined || x.website !== undefined || x.description !== undefined, 'Nothing to change.').parse(req.body ?? {});
  return gbp.updateProfile(uid(req), b.location, { phone: b.phone, website: b.website, description: b.description });
}));

router.get('/overview', handle('overview', (req) => gbp.overview(uid(req))));
router.post('/sync', heavy, handle('sync', (req) => gbp.sync(uid(req))));
router.get('/reviews', handle('reviews', (req) => {
  const q = z.object({ location: locName.optional(), status: z.enum(['unanswered', 'answered']).optional() }).parse(req.query);
  return gbp.reviews(uid(req), { locationName: q.location, status: q.status });
}));
const TONES = ['professional', 'friendly', 'empathetic', 'formal', 'concise', 'casual', 'luxury'] as const;
router.post('/reviews/:id/draft', aiLimit, handle('draft', (req) => gbp.draftReply(uid(req), reviewId.parse(req.params.id), z.object({ tone: z.enum(TONES).optional() }).strict().parse(req.body ?? {}).tone)));
router.put('/reviews/:id/reply', handle('reply', (req) => gbp.publishReply(uid(req), reviewId.parse(req.params.id), z.object({ comment: z.string().max(5000) }).strict().parse(req.body ?? {}).comment)));
router.delete('/reviews/:id/reply', handle('delete reply', async (req) => { await gbp.deleteReply(uid(req), reviewId.parse(req.params.id)); return { success: true }; }));

router.get('/performance', heavy, handle('performance', (req) => {
  const q = z.object({ location: locName, days: z.coerce.number().int().min(7).max(540).default(30) }).parse(req.query);
  return gbp.performance(uid(req), q.location, q.days);
}));
router.get('/posts', handle('posts', (req) => gbp.listPosts(uid(req), z.object({ location: locName }).parse(req.query).location)));
router.post('/posts', heavy, handle('create post', (req) => {
  const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const b = z.object({
    location: locName, summary: z.string().trim().min(1).max(1500), topicType: z.enum(['STANDARD', 'OFFER', 'EVENT']).default('STANDARD'),
    ctaType: z.enum(['NONE', 'LEARN_MORE', 'BOOK', 'ORDER', 'SIGN_UP', 'CALL']).default('NONE'), ctaUrl: httpsUrl.optional(),
    title: z.string().trim().max(58).optional(), startDate: ymd.optional(), endDate: ymd.optional(),
  }).strict()
    .refine((x) => x.ctaType === 'NONE' || x.ctaType === 'CALL' || !!x.ctaUrl, { message: 'Add a link for the button.', path: ['ctaUrl'] })
    .refine((x) => x.topicType === 'STANDARD' || (!!x.title && !!x.startDate && !!x.endDate), { message: 'Offers and events need a title, start and end date.', path: ['title'] })
    .parse(req.body ?? {});
  return gbp.createPost(uid(req), b.location, b);
}));
router.post('/description/draft', aiLimit, handle('description', (req) => {
  const s = z.string().trim().min(1).max(500);
  const b = z.object({ location: locName, services: s, audience: s, differentiators: s, area: s }).strict().parse(req.body ?? {});
  return gbp.draftDescription(uid(req), b.location, b);
}));
router.put('/settings', handle('settings', (req) => gbp.saveSettings(uid(req), z.object({ brandVoice: z.enum(['friendly', 'professional', 'casual', 'luxury']).optional(), signOff: z.string().trim().max(80).optional() }).strict().parse(req.body ?? {}))));

// ---------------------------------------------------------------------------
// Growth platform (audit, optimizer, approval-based changes, content, competitors,
// visibility, analytics, assistant, automation, security). See features/gbp/server/growth.ts.
// ---------------------------------------------------------------------------

// Access log for the security centre: account-changing requests only (no bodies, IP truncated).
router.use((req: AuthedRequest, _res, next) => {
  if (req.method !== 'GET' && req.accountUser?.id) {
    const ip = String(req.ip || '').replace(/(\d+\.\d+\.\d+)\.\d+$/, '$1.x').replace(/:[0-9a-f]*:[0-9a-f]*$/i, ':…');
    growth.recordAccess(req.accountUser.id, { action: req.path.replace(/[A-Za-z0-9_-]{16,}/g, ':id'), method: req.method, ip, agent: String(req.headers['user-agent'] || '').slice(0, 120) });
  }
  next();
});

const ymdS = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const DAY = z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);
const patchSchema = z.object({
  phone: z.string().trim().regex(/^[+()\d\s.-]{6,24}$/, 'Enter a valid phone number.').optional(),
  website: httpsUrl.optional(),
  description: z.string().trim().max(750).optional(),
  regularHours: z.array(z.object({ day: DAY, open: hhmm, close: hhmm })).max(28).optional(),
  specialHours: z.array(z.object({ startDate: ymdS, endDate: ymdS, closed: z.boolean(), open: hhmm.optional(), close: hhmm.optional() })).max(50).optional(),
  primaryCategoryId: z.string().regex(/^categories\/[\w:.-]+$/).optional(),
  additionalCategoryIds: z.array(z.string().regex(/^categories\/[\w:.-]+$/)).max(9).optional(),
  serviceItems: z.array(z.object({ label: z.string().trim().min(1).max(140), description: z.string().trim().max(300).optional(), category: z.string().regex(/^categories\/[\w:.-]+$/) })).max(100).optional(),
}).strict();
const attrSchema = z.array(z.object({ name: z.string().regex(/^(attributes\/)?[\w-]+$/), valueType: z.string().max(40), values: z.array(z.any()).max(20).optional(), uriValues: z.array(httpsUrl).max(5).optional() })).max(40);
const id = z.string().regex(/^[a-z]{3,4}_[0-9a-f]{16}$/, 'Invalid id.');
const ctaType = z.enum(['NONE', 'LEARN_MORE', 'BOOK', 'ORDER', 'SIGN_UP', 'CALL']);
const kind = z.enum(['update', 'promotion', 'offer', 'event', 'announcement', 'seasonal', 'product', 'service']);

router.get('/growth/dashboard', handle('dashboard', (req) => growth.dashboard(uid(req))));
router.put('/growth/onboarding', handle('onboarding', (req) => growth.setOnboarding(uid(req), z.object({ completed: z.boolean().optional(), dismissed: z.boolean().optional() }).strict().parse(req.body ?? {}))));

router.post('/growth/audits', heavy, handle('audit', (req) => growth.startAudit(uid(req), z.object({ location: locName }).strict().parse(req.body ?? {}).location)));
router.get('/growth/jobs/:id', handle('job', (req) => growth.jobStatus(uid(req), id.parse(req.params.id))));
router.get('/growth/audit', handle('get audit', (req) => growth.getAudit(uid(req), z.object({ location: locName }).parse(req.query).location)));
router.post('/growth/profile/refresh', heavy, handle('refresh', (req) => growth.refreshProfile(uid(req), z.object({ location: locName }).strict().parse(req.body ?? {}).location)));

router.get('/growth/changes', handle('changes', (req) => growth.listChanges(uid(req), z.object({ location: locName.optional() }).parse(req.query).location)));
router.post('/growth/changes', handle('propose', (req) => {
  const b = z.object({ location: locName, patch: patchSchema.default({}), attributes: attrSchema.optional(), note: z.string().max(300).optional(), source: z.enum(['user', 'ai', 'automation']).optional(), categoryNames: z.record(z.string(), z.string().max(120)).optional() }).strict().parse(req.body ?? {});
  return growth.proposeChange(uid(req), b.location, { patch: b.patch, attributes: b.attributes, note: b.note, source: b.source, categoryNames: b.categoryNames });
}));
router.post('/growth/changes/:id/validate', heavy, handle('validate change', (req) => growth.validateChange(uid(req), id.parse(req.params.id))));
router.post('/growth/changes/:id/publish', heavy, handle('publish change', (req) => growth.publishChange(uid(req), id.parse(req.params.id), z.object({ confirm: z.literal(true) }).strict().parse(req.body ?? {}).confirm)));
router.post('/growth/changes/:id/discard', handle('discard change', (req) => growth.discardChange(uid(req), id.parse(req.params.id))));
router.get('/growth/categories', handle('categories', (req) => growth.searchCategories(uid(req), z.object({ q: z.string().trim().min(2).max(80) }).parse(req.query).q)));
router.get('/growth/attributes', heavy, handle('attributes', (req) => growth.availableAttributes(uid(req), z.object({ location: locName }).parse(req.query).location)));

router.post('/growth/optimize', aiLimit, handle('optimize', (req) => growth.optimize(uid(req), z.object({ location: locName }).strict().parse(req.body ?? {}).location)));

router.get('/growth/posts', handle('planned posts', (req) => growth.listPlannedPosts(uid(req), z.object({ location: locName.optional() }).parse(req.query).location)));
router.post('/growth/posts/generate', aiLimit, handle('generate post', (req) => { const b = z.object({ location: locName, kind, details: z.string().max(800).optional() }).strict().parse(req.body ?? {}); return growth.generatePost(uid(req), b.location, b); }));
router.post('/growth/posts/calendar', aiLimit, handle('calendar', (req) => { const b = z.object({ location: locName, startDate: ymdS }).strict().parse(req.body ?? {}); return growth.generateCalendar(uid(req), b.location, b.startDate); }));
router.put('/growth/posts', handle('save post', (req) => growth.savePlannedPost(uid(req), z.object({
  id: id.optional(), location: locName, kind: kind.optional(), topicType: z.enum(['STANDARD', 'OFFER', 'EVENT']).optional(), title: z.string().trim().max(58).optional(), summary: z.string().trim().max(1500).optional(),
  ctaType: ctaType.optional(), ctaUrl: httpsUrl.optional(), imageIdea: z.string().max(300).optional(), startDate: ymdS.optional(), endDate: ymdS.optional(), date: ymdS.optional(),
}).strict().parse(req.body ?? {}))));
router.post('/growth/posts/:id/schedule', handle('schedule post', (req) => growth.schedulePost(uid(req), id.parse(req.params.id), z.object({ at: z.string().datetime().nullable() }).strict().parse(req.body ?? {}).at)));
router.post('/growth/posts/:id/publish', heavy, handle('publish post', (req) => { z.object({ confirm: z.literal(true) }).strict().parse(req.body ?? {}); return growth.publishPlannedPost(uid(req), id.parse(req.params.id)); }));
router.post('/growth/posts/:id/discard', handle('discard post', (req) => growth.discardPlannedPost(uid(req), id.parse(req.params.id))));

// Photos: held in memory only for the length of the request, then sent to Google. Never written to disk.
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_MAX_BYTES, files: 1, fields: 5 } }).single('file');
const readPhoto = (req: Request, res: Response) => new Promise<void>((resolve, reject) => photoUpload(req, res, (err: any) => {
  if (!err) return resolve();
  reject(err?.code === 'LIMIT_FILE_SIZE' ? new AccountsError('That image is too large. Google accepts up to 5 MB.', 413, 'invalid_file') : new AccountsError('The upload couldn’t be read.', 400, 'invalid_file'));
}));
router.post('/growth/photos', heavy, handle('upload photo', async (req, res) => {
  await readPhoto(req, res);
  const f = z.object({ location: locName, category: z.enum(PHOTO_CATEGORIES), confirm: z.literal('true') }).strict().parse(req.body ?? {});
  const file = (req as any).file as { buffer: Buffer; size: number } | undefined;
  if (!file) throw new AccountsError('Choose an image to upload.', 400, 'invalid_file');
  return growth.uploadPhoto(uid(req), f.location, file, f.category, true);
}));
router.delete('/growth/photos', heavy, handle('delete photo', (req) => {
  const b = z.object({ location: locName, media: z.string().max(300), confirm: z.literal(true) }).strict().parse(req.body ?? {});
  return growth.deletePhoto(uid(req), b.location, b.media, b.confirm);
}));

router.get('/growth/reviews/summary', handle('review summary', (req) => growth.reviewSummary(uid(req), z.object({ location: locName.optional() }).parse(req.query).location)));

router.get('/growth/competitors', handle('competitors', (req) => growth.listCompetitors(uid(req), z.object({ location: locName }).parse(req.query).location)));
router.get('/growth/competitors/search', heavy, handle('places search', (req) => { const q = z.object({ location: locName, q: z.string().max(120).default('') }).parse(req.query); return growth.searchPlaces(uid(req), q.location, q.q); }));
const compFields = { name: z.string().trim().max(120).optional(), categories: z.array(z.string().max(80)).max(10).optional(), rating: z.number().min(1).max(5).nullable().optional(), reviewCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  website: httpsUrl.optional(), description: z.string().max(1000).optional(), services: z.array(z.string().max(80)).max(40).optional(), photoCount: z.number().int().min(0).max(100_000).nullable().optional(), postsPerMonth: z.number().min(0).max(100).nullable().optional(), notes: z.string().max(1000).optional() };
router.post('/growth/competitors', handle('add competitor', (req) => { const b = z.object({ location: locName, placeId: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/).optional(), ...compFields }).strict().parse(req.body ?? {}); return growth.addCompetitor(uid(req), b.location, b); }));
router.patch('/growth/competitors/:id', handle('update competitor', (req) => growth.updateCompetitor(uid(req), id.parse(req.params.id), z.object(compFields).strict().parse(req.body ?? {}))));
router.delete('/growth/competitors/:id', handle('remove competitor', (req) => growth.removeCompetitor(uid(req), id.parse(req.params.id))));
router.post('/growth/competitors/refresh', heavy, handle('refresh competitors', (req) => growth.refreshCompetitors(uid(req), z.object({ location: locName }).strict().parse(req.body ?? {}).location)));
router.post('/growth/competitors/report', aiLimit, handle('competitor report', (req) => growth.competitorReport(uid(req), z.object({ location: locName }).strict().parse(req.body ?? {}).location)));

router.get('/growth/visibility', heavy, handle('visibility', (req) => growth.visibility(uid(req), z.object({ location: locName }).parse(req.query).location)));
router.put('/growth/visibility', handle('save visibility', (req) => growth.saveVisibility(uid(req), z.object({ keywords: z.array(z.string().max(80)).max(25), areas: z.array(z.string().max(80)).max(10) }).strict().parse(req.body ?? {}))));
router.get('/growth/analytics', heavy, handle('analytics', (req) => { const q = z.object({ location: locName, days: z.coerce.number().int().min(7).max(270).default(30) }).parse(req.query); return growth.analytics(uid(req), q.location, q.days); }));

router.get('/growth/assistant', handle('assistant history', (req) => growth.assistantHistory(uid(req))));
router.post('/growth/assistant', aiLimit, handle('assistant', (req) => { const b = z.object({ location: locName, message: z.string().trim().min(1).max(2000) }).strict().parse(req.body ?? {}); return growth.assistant(uid(req), b.location, b.message); }));
router.delete('/growth/assistant', handle('clear assistant', (req) => growth.clearAssistant(uid(req))));

router.get('/growth/inbox', handle('inbox', (req) => growth.inbox(uid(req))));
router.post('/growth/inbox/:id', handle('inbox status', (req) => growth.setInboxStatus(uid(req), id.parse(req.params.id), z.object({ status: z.enum(['done', 'dismissed', 'open']) }).strict().parse(req.body ?? {}).status)));
router.post('/growth/automation/run', heavy, handle('run automation', (req) => growth.runAutomation(uid(req))));
router.get('/growth/automation', handle('automation settings', (req) => growth.getAutomation(uid(req))));
router.post('/growth/automation/test-email', rateLimit({ name: 'gbp-test-email', windowMs: 10 * 60_000, max: 5, key: userKey }), handle('test email', (req) => growth.emailDigest(uid(req), { test: true })));
router.put('/growth/automation', handle('automation settings', (req) => growth.saveAutomation(uid(req), z.object({
  enabled: z.boolean().optional(),
  notifications: z.object({ inApp: z.boolean().optional(), email: z.boolean().optional(), emailTo: z.union([z.string().trim().email('Enter a valid email address.').max(254), z.literal('')]).optional(), kinds: z.record(z.enum(['missing_info', 'unanswered_review', 'negative_review', 'outdated_hours', 'services', 'content', 'performance', 'security', 'audit']), z.boolean()).optional() }).strict().optional(),
}).strict().parse(req.body ?? {}))));

router.get('/growth/security', handle('security', (req) => growth.security(uid(req))));

export default router;
