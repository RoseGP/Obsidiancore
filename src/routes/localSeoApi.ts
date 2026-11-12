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
import { z } from 'zod';
import { requireUser, type AuthedRequest } from '../features/social-accounts/server/auth';
import { csrfGuard, ipKey, rateLimit, sendError, userKey } from '../features/social-accounts/server/http';
import { config } from '../features/social-accounts/server/instance';
import { gbp } from '../features/gbp/server/instance';
import { GBP_STATE_COOKIE } from '../features/gbp/server/service';

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

router.use(requireUser, csrfGuard(config.appUrl), rateLimit({ name: 'gbp', windowMs: 60_000, max: 120, key: userKey }));
const heavy = rateLimit({ name: 'gbp-heavy', windowMs: 60_000, max: 10, key: userKey }); // Google quota-sensitive
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

// Opening hours (Business Information v1 regularHours). Up to two periods per day; days left out are closed.
const HHMM = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use 24-hour times like 09:00.');
const DAY = z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);
router.put('/locations/hours', handle('hours', (req) => {
  const b = z.object({ location: locName, hours: z.array(z.object({ day: DAY, open: HHMM, close: HHMM }).strict()).max(14) }).strict()
    .superRefine((x, ctx) => {
      const perDay = new Map<string, number>();
      for (const h of x.hours) {
        perDay.set(h.day, (perDay.get(h.day) || 0) + 1);
        if (h.open === h.close) ctx.addIssue({ code: 'custom', path: ['hours'], message: `${h.day.toLowerCase()}: opening and closing times are the same.` });
        if (h.open === '24:00') ctx.addIssue({ code: 'custom', path: ['hours'], message: 'Opening time can\'t be 24:00.' });
      }
      if ([...perDay.values()].some((n) => n > 2)) ctx.addIssue({ code: 'custom', path: ['hours'], message: 'At most two opening periods per day.' });
    }).parse(req.body ?? {});
  return gbp.updateHours(uid(req), b.location, b.hours);
}));
// Who can manage a location (read live from Google, not stored).
router.get('/locations/access', heavy, handle('access', (req) => gbp.accessReview(uid(req), z.object({ location: locName }).parse(req.query).location)));

router.get('/overview', handle('overview', (req) => gbp.overview(uid(req))));
router.post('/sync', heavy, handle('sync', (req) => gbp.sync(uid(req))));
router.get('/reviews', handle('reviews', (req) => {
  const q = z.object({ location: locName.optional(), status: z.enum(['unanswered', 'answered']).optional() }).parse(req.query);
  return gbp.reviews(uid(req), { locationName: q.location, status: q.status });
}));
router.post('/reviews/:id/draft', aiLimit, handle('draft', (req) => gbp.draftReply(uid(req), reviewId.parse(req.params.id), z.object({ tone: z.enum(['friendly', 'professional', 'casual', 'luxury']).optional() }).strict().parse(req.body ?? {}).tone)));
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

export default router;
