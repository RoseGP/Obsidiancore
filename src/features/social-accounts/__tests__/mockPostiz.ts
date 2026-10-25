/**
 * TEST ONLY. A stand-in for Postiz that follows the contracts verified in the
 * Postiz source (see docs/social-accounts/POSTIZ_CAPABILITIES.md). It is not
 * used by the application.
 */
import crypto from 'node:crypto';
import express from 'express';
import type { AddressInfo } from 'node:net';

export interface MockState {
  integrations: { id: string; name: string; identifier: string; picture: string | null; disabled: boolean; profile: string | null }[];
  tokens: Set<string>;
  codes: Map<string, string>; // code -> client
  apiKey: string;
  jwtSecret: string;
  pending: Map<string, { identifier: string; refresh?: string; redirect?: string }>;
  deleted: string[];
  lastEnterprisePayload?: any;
  posts: { id: string; group: string; integrationId: string; content: string; publishDate: string; state: 'QUEUE' | 'PUBLISHED' | 'ERROR' | 'DRAFT'; error?: string; image: any[] }[];
  lastPostBody?: any;
}

export async function startMockPostiz(opts: { clientId: string; clientSecret: string; appRedirect: string; apiKey: string; jwtSecret: string }) {
  const s: MockState = { integrations: [], tokens: new Set(), codes: new Map(), apiKey: opts.apiKey, jwtSecret: opts.jwtSecret, pending: new Map(), deleted: [], posts: [] };
  const app = express();
  app.use(express.json());
  let base = '';

  const authed = (req: express.Request) => {
    const a = String(req.headers.authorization || '');
    return a === s.apiKey || s.tokens.has(a);
  };

  // Frontend consent page: simulate the user pressing "Approve" (or deny via ?deny=1 on the URL).
  app.get('/oauth/authorize', (req, res) => {
    if (req.query.client_id !== opts.clientId) return res.status(400).send('unknown client');
    const u = new URL(opts.appRedirect);
    if (req.query.deny) u.searchParams.set('error', 'access_denied');
    else { const code = crypto.randomBytes(8).toString('hex'); s.codes.set(code, String(req.query.client_id)); u.searchParams.set('code', code); }
    if (req.query.state) u.searchParams.set('state', String(req.query.state));
    res.redirect(302, u.toString());
  });

  app.post('/oauth/token', (req, res) => {
    const b = req.body || {};
    if (b.grant_type !== 'authorization_code') return res.status(400).json({ error: 'unsupported_grant_type' });
    if (b.client_id !== opts.clientId || b.client_secret !== opts.clientSecret) return res.status(401).json({ error: 'invalid_client' });
    if (!s.codes.has(b.code)) return res.status(400).json({ error: 'invalid_grant' });
    s.codes.delete(b.code);
    const token = 'pos_' + crypto.randomBytes(20).toString('hex');
    s.tokens.add(token);
    res.json({ access_token: token, token_type: 'bearer' });
  });

  app.get('/public/v1/me', (req, res) => authed(req) ? res.json({ organization: { id: 'org1', name: 'Acme Agency' }, user: null }) : res.status(401).json({ msg: 'Invalid OAuth token' }));
  app.get('/public/v1/integrations', (req, res) => authed(req) ? res.json(s.integrations) : res.status(401).json({ msg: 'Invalid API key' }));
  app.get('/public/v1/social/:integration', (req, res) => {
    if (!authed(req)) return res.status(401).json({ msg: 'Invalid API key' });
    if (!['instagram', 'facebook', 'linkedin', 'x', 'tiktok', 'mastodon'].includes(req.params.integration)) return res.status(400).json({ msg: 'Integration not allowed' });
    const state = crypto.randomBytes(6).toString('hex');
    s.pending.set(state, { identifier: req.params.integration, refresh: req.query.refresh ? String(req.query.refresh) : undefined });
    res.json({ url: `https://provider.example/${req.params.integration}/authorize?state=${state}` });
  });
  app.delete('/public/v1/integrations/:id', (req, res) => {
    if (!authed(req)) return res.status(401).json({ msg: 'Invalid API key' });
    s.integrations = s.integrations.filter((i) => i.id !== req.params.id);
    s.deleted.push(req.params.id);
    res.json({});
  });
  // Posts (public.integrations.controller.ts contracts)
  app.get('/public/v1/posts', (req, res) => {
    if (!authed(req)) return res.status(401).json({ msg: 'Invalid API key' });
    const from = Date.parse(String(req.query.startDate)); const to = Date.parse(String(req.query.endDate));
    if (Number.isNaN(from) || Number.isNaN(to)) return res.status(400).json({ message: ['startDate must be a valid ISO 8601 date string'] });
    const list = s.posts.filter((p) => { const t = Date.parse(p.publishDate); return t >= from && t <= to; }).map((p) => {
      const i = s.integrations.find((x) => x.id === p.integrationId);
      return { id: p.id, content: p.content, publishDate: p.publishDate, releaseURL: p.state === 'PUBLISHED' ? 'https://social.example/p/' + p.id : null, state: p.state, error: p.error ?? null, group: p.group, integration: { id: p.integrationId, providerIdentifier: i?.identifier, name: i?.name, picture: null } };
    });
    res.json({ posts: list });
  });
  app.post('/public/v1/posts', (req, res) => {
    if (!authed(req)) return res.status(401).json({ msg: 'Invalid API key' });
    const b = req.body; s.lastPostBody = b;
    if (!['draft', 'schedule', 'now', 'update'].includes(b?.type) || !Array.isArray(b?.posts)) return res.status(400).json({ message: ['type must be one of the following values: draft, schedule, now, update'] });
    const batchGroup = crypto.randomBytes(4).toString('hex');
    const out: any[] = [];
    for (const p of b.posts) {
      if (!s.integrations.some((i) => i.id === p.integration?.id)) return res.status(400).json({ msg: 'Integration not found' });
      if (b.type !== 'draft' && !p.settings?.__type) return res.status(400).json({ msg: 'settings.__type is required' });
      const v = p.value[0];
      const existing = v.id ? s.posts.find((x) => x.id === v.id) : undefined;
      if (existing && existing.state === 'PUBLISHED' && !b.republish) return res.status(400).json({ msg: 'This post was already published.' });
      const rec = existing ?? { id: 'post_' + crypto.randomBytes(5).toString('hex'), group: p.group || batchGroup, integrationId: p.integration.id, content: '', publishDate: b.date, state: 'QUEUE' as const, image: [] };
      Object.assign(rec, { content: v.content, image: v.image ?? [], publishDate: b.date, state: b.type === 'draft' ? 'DRAFT' : 'QUEUE', error: undefined });
      if (!existing) s.posts.push(rec);
      out.push({ postId: rec.id, integration: p.integration.id });
    }
    res.status(201).json(out);
  });
  app.delete('/public/v1/posts/:id', (req, res) => {
    if (!authed(req)) return res.status(401).json({ msg: 'Invalid API key' });
    const p = s.posts.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ message: 'Not Found' });
    s.posts = s.posts.filter((x) => x.group !== p.group);
    res.json({ error: true });
  });
  app.post('/public/v1/upload-from-url', (req, res) => {
    if (!authed(req)) return res.status(401).json({ msg: 'Invalid API key' });
    if (!/^https:\/\//.test(String(req.body?.url))) return res.status(400).json({ msg: 'Invalid URL' });
    res.json({ id: 'media_' + crypto.randomBytes(3).toString('hex'), path: 'https://uploads.example/' + encodeURIComponent(req.body.url.split('/').pop()) });
  });
  app.post('/public/v1/upload', (req, res) => {
    if (!authed(req)) return res.status(401).json({ msg: 'Invalid API key' });
    res.json({ id: 'media_' + crypto.randomBytes(3).toString('hex'), path: 'https://uploads.example/uploaded_media.png' });
  });

  app.post('/enterprise/url', (req, res) => {
    const [h, b, sig] = String(req.body?.params || '').split('.');
    const expect = crypto.createHmac('sha256', s.jwtSecret).update(`${h}.${b}`).digest('base64url');
    if (!sig || sig !== expect) return res.status(500).send('');
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    s.lastEnterprisePayload = p;
    if (p.apiKey !== s.apiKey) return res.status(500).send('');
    const state = crypto.randomBytes(6).toString('hex');
    s.pending.set(state, { identifier: p.provider, refresh: p.refreshId, redirect: p.redirectUrl });
    res.type('text/html').send(`https://provider.example/${p.provider}/authorize?state=${state}`);
  });

  /** Simulates: provider consent approved + Postiz landing page completing the connection. Returns where Postiz would send the browser. */
  const approve = (providerUrl: string, profile = 'acme') => {
    const state = new URL(providerUrl).searchParams.get('state')!;
    const p = s.pending.get(state);
    if (!p) throw new Error('unknown state');
    s.pending.delete(state);
    if (p.refresh) {
      const i = s.integrations.find((x) => x.id === p.refresh);
      if (i) i.disabled = false;
    } else {
      s.integrations.push({ id: 'int_' + crypto.randomBytes(4).toString('hex'), name: `Acme ${p.identifier}`, identifier: p.identifier, picture: null, disabled: false, profile });
    }
    // ContinueIntegration: push(`${returnURL}?${params}`) when a return URL exists.
    return p.redirect ? `${p.redirect}?added=${p.identifier}` : null;
  };

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, state: s, approve, close: () => server.close() };
}

/** Minimal Bluesky XRPC stand-in for the direct adapter test. */
export async function startMockBluesky() {
  const app = express();
  app.use(express.json());
  app.post('/xrpc/com.atproto.server.createSession', (req, res) => {
    if (req.body?.identifier === 'acme.bsky.social' && req.body?.password === 'abcd-efgh-ijkl-mnop') return res.json({ did: 'did:plc:acme', handle: 'acme.bsky.social', accessJwt: 'jwt' });
    res.status(401).json({ error: 'AuthenticationRequired' });
  });
  app.get('/xrpc/app.bsky.actor.getProfile', (_req, res) => res.json({ displayName: 'Acme on Bluesky', avatar: 'https://cdn.example/a.png' }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}
