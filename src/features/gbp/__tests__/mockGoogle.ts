/** TEST ONLY: a stand-in for Google OAuth + Business Profile APIs (contracts per googleapis@178 / GMB v4 docs). */
import crypto from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';

export async function startMockGoogle(opts: { clientId: string; clientSecret: string }) {
  const s = {
    codes: new Map<string, { challenge: string; redirect: string; scope: string }>(),
    access: new Map<string, number>(), refresh: new Set<string>(), revoked: [] as string[], refreshCalls: 0, accessTtl: 3600, refreshFails: false,
    replies: new Map<string, any>(), lastPatch: null as any, adminsForbidden: false, posts: [] as any[], grantScope: 'https://www.googleapis.com/auth/business.manage openid email',
  };
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
      { name: 'locations/1001', title: 'Acme Dental Downtown', categories: { primaryCategory: { displayName: 'Dentist' }, additionalCategories: [] }, storefrontAddress: { addressLines: ['1 Main St'], locality: 'Austin', administrativeArea: 'TX', postalCode: '78701' }, phoneNumbers: { primaryPhone: '+1 512 555 0100' }, websiteUri: 'https://acme.example', profile: { description: 'Family dentist.' }, regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 9 }, closeDay: 'MONDAY', closeTime: { hours: 17 } }] }, metadata: { mapsUri: 'https://maps.example/1001', hasVoiceOfMerchant: true, hasPendingEdits: true, hasGoogleUpdated: false, placeId: 'ChIJtest' }, openInfo: { status: 'OPEN' } },
      { name: 'locations/1002', title: 'Acme Dental North', categories: { primaryCategory: { displayName: 'Dentist' } }, storefrontAddress: { addressLines: ['9 North Ave'], locality: 'Austin' } },
    ] });
  });
  app.get('/v1/locations/:id/admins', (req, res) => {
    if (!authed(req)) return res.status(401).end();
    if (s.adminsForbidden) return res.status(403).json({ error: { message: 'The caller does not have permission' } });
    res.json({ admins: [
      { name: `locations/${req.params.id}/admins/1`, admin: 'Pat Owner', role: 'PRIMARY_OWNER' },
      { name: `locations/${req.params.id}/admins/2`, admin: 'new.manager@example.com', role: 'MANAGER', pendingInvitation: true },
    ] });
  });
  app.patch('/v1/locations/:id', (req, res) => { if (!authed(req)) return res.status(401).end(); s.lastPatch = { id: req.params.id, mask: req.query.updateMask, body: req.body }; res.json({ name: `locations/${req.params.id}` }); });
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
