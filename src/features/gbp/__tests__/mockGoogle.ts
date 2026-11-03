/** TEST ONLY: a stand-in for Google OAuth + Business Profile APIs (contracts per googleapis@178 / GMB v4 docs). */
import crypto from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';

export async function startMockGoogle(opts: { clientId: string; clientSecret: string }) {
  const s = {
    codes: new Map<string, { challenge: string; redirect: string; scope: string }>(),
    access: new Map<string, number>(), refresh: new Set<string>(), revoked: [] as string[], refreshCalls: 0, accessTtl: 3600, refreshFails: false,
    replies: new Map<string, any>(), lastPatch: null as any, posts: [] as any[], grantScope: 'https://www.googleapis.com/auth/business.manage openid email',
    patches: [] as any[], attrPatches: [] as any[], titleOverride: '' as string, googleUpdated: false, verified: true,
    media: new Map<string, any[]>(), uploads: new Map<string, { bytes: number; type: string } | null>(), created: [] as any[],
  };
  const LOC_1001 = () => ({ name: 'locations/1001', title: s.titleOverride || 'Acme Dental Downtown', categories: { primaryCategory: { name: 'categories/gcid:dentist', displayName: 'Dentist' }, additionalCategories: [] }, storefrontAddress: { addressLines: ['1 Main St'], locality: 'Austin', administrativeArea: 'TX', postalCode: '78701', regionCode: 'US' }, phoneNumbers: { primaryPhone: '+1 512 555 0100' }, websiteUri: 'https://acme.example', profile: { description: 'Family dentist.' }, regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }] }, serviceItems: [{ freeFormServiceItem: { category: 'categories/gcid:dentist', label: { displayName: 'Teeth cleaning' } } }], openInfo: { status: 'OPEN' }, metadata: { mapsUri: 'https://maps.example/1001', placeId: 'ChIJacme1001place', hasGoogleUpdated: s.googleUpdated, hasVoiceOfMerchant: s.verified } });
  const reviews = (loc: string) => [5, 2, 4].map((stars, i) => ({
    name: `accounts/111/${loc}/reviews/r${loc.split('/')[1]}${i}`, reviewId: `r${i}`, reviewer: { displayName: ['Maria Lopez', 'Tom Hale', 'Ana Ruiz'][i], profilePhotoUrl: 'https://lh3.example/p.png' },
    starRating: ['FIVE', 'TWO', 'FOUR'][i], comment: ['Friendly staff and fast service!', 'Waited 30 minutes past my appointment.', 'Great quality, a bit pricey.'][i],
    createTime: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(), updateTime: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
  }));
  const app = express(); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
  const authed = (req: express.Request) => { const t = String(req.headers.authorization || '').replace('Bearer ', ''); const exp = s.access.get(t); return !!exp && exp > Date.now(); };

  app.get('/o/oauth2/v2/auth', (req, res) => {
    if (req.query.client_id !== opts.clientId || req.query.code_challenge_method !== 'S256') return res.status(400).send('bad request');
    const u = new URL(String(req.query.redirect_uri));
    if (req.query.deny) u.searchParams.set('error', 'access_denied');
    else { const code = crypto.randomBytes(8).toString('hex'); s.codes.set(code, { challenge: String(req.query.code_challenge), redirect: String(req.query.redirect_uri), scope: s.grantScope }); u.searchParams.set('code', code); }
    u.searchParams.set('state', String(req.query.state)); res.redirect(302, u.toString());
  });
  const issue = () => { const t = 'ya29.' + crypto.randomBytes(12).toString('hex'); s.access.set(t, Date.now() + s.accessTtl * 1000); return t; };
  app.post('/token', (req, res) => {
    const b = req.body;
    if (b.client_id !== opts.clientId || b.client_secret !== opts.clientSecret) return res.status(401).json({ error: 'invalid_client' });
    if (b.grant_type === 'authorization_code') {
      const c = s.codes.get(b.code); s.codes.delete(b.code);
      if (!c || c.redirect !== b.redirect_uri) return res.status(400).json({ error: 'invalid_grant' });
      if (crypto.createHash('sha256').update(b.code_verifier || '').digest('base64url') !== c.challenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      const rt = '1//' + crypto.randomBytes(10).toString('hex'); s.refresh.add(rt);
      const idt = ['x', Buffer.from(JSON.stringify({ email: 'owner@biz.example' })).toString('base64url'), 'y'].join('.');
      return res.json({ access_token: issue(), expires_in: s.accessTtl, refresh_token: rt, scope: c.scope, id_token: idt });
    }
    if (b.grant_type === 'refresh_token') { s.refreshCalls++; if (s.refreshFails || !s.refresh.has(b.refresh_token)) return res.status(400).json({ error: 'invalid_grant' }); return res.json({ access_token: issue(), expires_in: s.accessTtl, scope: 'x' }); }
    res.status(400).json({ error: 'unsupported_grant_type' });
  });
  app.post('/revoke', (req, res) => { s.revoked.push(String(req.body.token)); s.refresh.delete(String(req.body.token)); res.json({}); });
  app.get('/v1/accounts', (req, res) => authed(req) ? res.json({ accounts: [{ name: 'accounts/111', accountName: 'Acme Dental', type: 'PERSONAL' }] }) : res.status(401).json({ error: { message: 'Request had invalid authentication credentials.' } }));
  app.get('/v1/accounts/111/locations', (req, res) => {
    if (!authed(req)) return res.status(401).json({ error: { message: 'unauthenticated' } });
    if (!req.query.readMask) return res.status(400).json({ error: { message: 'readMask is required' } });
    res.json({ locations: [
      LOC_1001(),
      { name: 'locations/1002', title: 'Acme Dental North', categories: { primaryCategory: { displayName: 'Dentist' } }, storefrontAddress: { addressLines: ['9 North Ave'], locality: 'Austin' } },
    ] });
  });
  // Growth endpoints (Business Information v1, Verifications v1, Performance v1, v4 media).
  app.get(/^\/v1\/locations\/(\d+):getGoogleUpdated$/, (req, res) => authed(req) ? res.json({ location: { ...LOC_1001(), phoneNumbers: { primaryPhone: '+1 512 555 0199' } }, diffMask: s.googleUpdated ? 'phoneNumbers.primaryPhone' : '', pendingMask: '' }) : res.status(401).end());
  app.get(/^\/v1\/locations\/(\d+)\/VoiceOfMerchantState$/, (req, res) => authed(req) ? res.json(s.verified ? { hasVoiceOfMerchant: true, hasBusinessAuthority: true } : { verify: { hasPendingVerification: false } }) : res.status(401).end());
  app.get(/^\/v1\/locations\/(\d+)\/attributes$/, (req, res) => authed(req) ? res.json({ name: `locations/${(req.params as any)[0]}/attributes`, attributes: [{ name: 'attributes/has_wheelchair_accessible_entrance', valueType: 'BOOL', values: [true] }] }) : res.status(401).end());
  app.patch(/^\/v1\/locations\/(\d+)\/attributes$/, (req, res) => { if (!authed(req)) return res.status(401).end(); s.attrPatches.push({ mask: req.query.attributeMask, body: req.body }); res.json(req.body); });
  app.get(/^\/v1\/locations\/(\d+)\/searchkeywords\/impressions\/monthly$/, (req, res) => {
    if (!authed(req)) return res.status(401).end();
    if (!req.query['monthlyRange.startMonth.year']) return res.status(400).json({ error: { message: 'monthlyRange required' } });
    res.json({ searchKeywordsCounts: [{ searchKeyword: 'dentist austin', insightsValue: { value: '120' } }, { searchKeyword: 'emergency dentist', insightsValue: { threshold: '15' } }] });
  });
  app.get(/^\/v1\/locations\/(\d+)$/, (req, res) => {
    if (!authed(req)) return res.status(401).end();
    if (!req.query.readMask) return res.status(400).json({ error: { message: 'readMask is required' } });
    res.json((req.params as any)[0] === '1001' ? LOC_1001() : { name: `locations/${(req.params as any)[0]}`, title: 'Acme Dental North', categories: { primaryCategory: { displayName: 'Dentist' } } });
  });
  app.get('/v1/attributes', (req, res) => authed(req) && req.query.parent ? res.json({ attributeMetadata: [
    { parent: 'attributes/has_wheelchair_accessible_entrance', displayName: 'Wheelchair accessible entrance', groupDisplayName: 'Accessibility', valueType: 'BOOL' },
    { parent: 'attributes/pay_credit_card_types_accepted', displayName: 'Credit cards', groupDisplayName: 'Payments', valueType: 'REPEATED_ENUM' },
    { parent: 'attributes/has_restroom', displayName: 'Restroom', groupDisplayName: 'Amenities', valueType: 'BOOL' },
    { parent: 'attributes/old_thing', displayName: 'Old', valueType: 'BOOL', deprecated: true },
  ] }) : res.status(400).end());
  app.get('/v1/categories', (req, res) => {
    if (!authed(req)) return res.status(401).end();
    const q = String(req.query.filter || '').replace(/^displayName=/, '').toLowerCase();
    const all = [{ name: 'categories/gcid:dentist', displayName: 'Dentist' }, { name: 'categories/gcid:cosmetic_dentist', displayName: 'Cosmetic dentist' }, { name: 'categories/gcid:emergency_dental_service', displayName: 'Emergency dental service' }];
    res.json({ categories: all.filter((c) => c.displayName.toLowerCase().includes(q)) });
  });
  const mediaOf = (loc: string) => {
    if (!s.media.has(loc)) s.media.set(loc, [
      { name: `accounts/111/locations/${loc}/media/m1`, mediaFormat: 'PHOTO', locationAssociation: { category: 'LOGO' }, createTime: new Date(Date.now() - 200 * 86_400_000).toISOString(), thumbnailUrl: 'https://lh3.example/m1.jpg' },
      { name: `accounts/111/locations/${loc}/media/m2`, mediaFormat: 'PHOTO', locationAssociation: { category: 'EXTERIOR' }, createTime: new Date(Date.now() - 150 * 86_400_000).toISOString(), thumbnailUrl: 'https://lh3.example/m2.jpg' },
    ]);
    return s.media.get(loc)!;
  };
  app.get(/^\/v4\/accounts\/111\/locations\/(\d+)\/media$/, (req, res) => authed(req) ? res.json({ mediaItems: mediaOf((req.params as any)[0]) }) : res.status(401).end());
  app.post(/^\/v4\/accounts\/111\/locations\/(\d+)\/media:startUpload$/, (req, res) => {
    if (!authed(req)) return res.status(401).end();
    const rn = 'AF1Qip' + crypto.randomBytes(9).toString('hex'); s.uploads.set(rn, null); res.json({ resourceName: rn });
  });
  app.post(/^\/upload\/v1\/media\/([A-Za-z0-9]+)$/, express.raw({ type: '*/*', limit: '6mb' }), (req, res) => {
    const rn = (req.params as any)[0];
    if (!authed(req)) return res.status(401).end();
    if (req.query.upload_type !== 'media' || !s.uploads.has(rn)) return res.status(400).json({ error: { message: 'bad upload' } });
    s.uploads.set(rn, { bytes: (req.body as Buffer).length, type: String(req.headers['content-type']) }); res.json({});
  });
  app.post(/^\/v4\/accounts\/111\/locations\/(\d+)\/media$/, (req, res) => {
    if (!authed(req)) return res.status(401).end();
    const loc = (req.params as any)[0]; const rn = req.body?.dataRef?.resourceName;
    if (!s.uploads.get(rn)) return res.status(400).json({ error: { message: 'Upload the bytes first.' } });
    if (req.body.mediaFormat !== 'PHOTO' || !req.body.locationAssociation?.category) return res.status(400).json({ error: { message: 'mediaFormat and category required' } });
    const m = { name: `accounts/111/locations/${loc}/media/n${crypto.randomBytes(4).toString('hex')}`, mediaFormat: 'PHOTO', locationAssociation: { category: req.body.locationAssociation.category }, createTime: new Date().toISOString(), thumbnailUrl: 'https://lh3.example/new.jpg' };
    mediaOf(loc).push(m); s.created.push({ ...m, upload: s.uploads.get(rn) }); res.json(m);
  });
  app.delete(/^\/v4\/accounts\/111\/locations\/(\d+)\/media\/([A-Za-z0-9_-]+)$/, (req, res) => {
    if (!authed(req)) return res.status(401).end();
    const list = mediaOf((req.params as any)[0]); const i = list.findIndex((m) => m.name.endsWith('/' + (req.params as any)[1]));
    if (i < 0) return res.status(404).json({ error: { message: 'Not found' } });
    list.splice(i, 1); res.json({});
  });
  app.patch('/v1/locations/:id', (req, res) => { if (!authed(req)) return res.status(401).end(); s.lastPatch = { id: req.params.id, mask: req.query.updateMask, validateOnly: req.query.validateOnly === 'true', body: req.body }; s.patches.push(s.lastPatch); res.json({ name: `locations/${req.params.id}` }); });
  app.get(/^\/v1\/locations\/(\d+):fetchMultiDailyMetricsTimeSeries$/, (req, res) => {
    if (!authed(req)) return res.status(401).end();
    const metrics = ([] as string[]).concat(req.query.dailyMetrics as any);
    if (!req.query['dailyRange.startDate.year']) return res.status(400).json({ error: { message: 'dailyRange required' } });
    res.json({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: metrics.map((m) => ({ dailyMetric: m, timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 1 }, value: '10' }, { date: { year: 2026, month: 10, day: 2 }, value: '5' }] } })) }] });
  });
  app.get(/^\/v4\/accounts\/111\/(locations\/\d+)\/reviews$/, (req, res) => authed(req) ? res.json({ reviews: reviews((req.params as any)[0]).map((r) => ({ ...r, reviewReply: s.replies.get(r.name) })), averageRating: 3.7, totalReviewCount: 3 }) : res.status(401).end());
  app.put(/^\/v4\/(.+\/reviews\/[^/]+)\/reply$/, (req, res) => { if (!authed(req)) return res.status(401).end(); const r = { comment: req.body.comment, updateTime: new Date().toISOString() }; s.replies.set((req.params as any)[0], r); res.json(r); });
  app.delete(/^\/v4\/(.+\/reviews\/[^/]+)\/reply$/, (req, res) => { if (!authed(req)) return res.status(401).end(); s.replies.delete((req.params as any)[0]); res.json({}); });
  app.get(/^\/v4\/(.+)\/localPosts$/, (req, res) => authed(req) ? res.json({ localPosts: s.posts }) : res.status(401).end());
  app.post(/^\/v4\/(.+)\/localPosts$/, (req, res) => { if (!authed(req)) return res.status(401).end(); const p = { name: `${(req.params as any)[0]}/localPosts/p${s.posts.length + 1}`, state: 'LIVE', createTime: new Date().toISOString(), searchUrl: 'https://search.example/p', ...req.body }; s.posts.push(p); res.json(p); });

  const server = app.listen(0); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, state: s, close: () => server.close() };
}
