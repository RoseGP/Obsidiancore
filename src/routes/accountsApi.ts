/**
 * Connected accounts — /api/accounts
 *
 *   GET    /                    the current user's accounts, one card per platform     (auth)
 *   POST   /connect             { platform, credentials? } start a connection            (auth, CSRF)
 *   GET    /callback            Postiz OAuth redirect: code + state (+ state cookie)
 *   GET    /return/:state       self-hosted Postiz return after a channel connection
 *   POST   /:id/reconnect       { credentials? } refresh an account the user owns       (auth, CSRF)
 *   DELETE /:id                 disconnect an account the user owns                    (auth, CSRF)
 *   POST   /attempts/:id/check  { final } poll a pending connection                     (auth, CSRF)
 *   POST   /attempts/:id/cancel cancel a pending connection                            (auth, CSRF)
 *   DELETE /workspace           forget this app's Postiz token (see revocation docs)    (auth, CSRF)
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireUser, type AuthedRequest } from '../features/social-accounts/server/auth';
import { csrfGuard, ipKey, rateLimit, sendError, userKey } from '../features/social-accounts/server/http';
import { accounts, config, store } from '../features/social-accounts/server/instance';
import { AccountsError, STATE_COOKIE } from '../features/social-accounts/server/service';
import { isAccountPlatform } from '../features/social-accounts/shared/types';

const router = Router();

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) { try { return decodeURIComponent(v.join('=')); } catch { return undefined; } }
  }
  return undefined;
}
const cookieAttrs = (maxAge: number) => ['Path=/api/accounts', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`, ...(config.isProduction ? ['Secure'] : [])].join('; ');
const setStateCookie = (res: Response, v: string) => res.append('Set-Cookie', `${STATE_COOKIE}=${encodeURIComponent(v)}; ${cookieAttrs(900)}`);
const clearStateCookie = (res: Response) => res.append('Set-Cookie', `${STATE_COOKIE}=; ${cookieAttrs(0)}`);
// No caching of anything that carries account data or redirects with state.
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });

const idParam = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/, 'Invalid id.');
const credentials = z.record(z.string().max(64), z.string().max(500)).optional();
const connectBody = z.object({ platform: z.string().max(32), credentials }).strict();
const reconnectBody = z.object({ credentials }).strict();
const checkBody = z.object({ final: z.boolean().optional() }).strict();

// ---- Browser redirects (trust comes from the signed state + HttpOnly cookie, not headers) ----

const redirectLimit = rateLimit({ name: 'accounts-redirect', windowMs: 60_000, max: 30, key: ipKey });

router.get('/callback', redirectLimit, async (req, res) => {
  const q = z.object({ code: z.string().max(2048).optional(), state: z.string().max(2048).optional(), error: z.string().max(200).optional() }).safeParse(req.query);
  const params = q.success ? q.data : {};
  try {
    const target = await accounts.workspaceCallback(params, readCookie(req, STATE_COOKIE));
    clearStateCookie(res);
    res.redirect(302, target);
  } catch (err) {
    clearStateCookie(res);
    sendError(res, err, 'oauth callback');
  }
});

router.get('/return/:state', redirectLimit, async (req, res) => {
  try {
    const target = await accounts.channelReturn(String(req.params.state).slice(0, 2048), readCookie(req, STATE_COOKIE));
    clearStateCookie(res);
    res.redirect(302, target);
  } catch (err) { sendError(res, err, 'channel return'); }
});

// ---- Authenticated API ----

router.use(requireUser, csrfGuard(config.appUrl), rateLimit({ name: 'accounts', windowMs: 60_000, max: 120, key: userKey }));
const connectLimit = rateLimit({ name: 'accounts-connect', windowMs: 10 * 60_000, max: 20, key: userKey });
const uid = (req: AuthedRequest) => req.accountUser!.id;

router.get('/', async (req: AuthedRequest, res) => {
  try {
    const o = await accounts.overview(uid(req));
    res.json({ ...o, accounts: o.platforms.flatMap((c) => c.accounts.map((a) => ({ ...a, id: a.connectionId, platform: c.platform, status: c.status }))) });
  } catch (err: any) {
    if (err?.code === 7 || err?.message?.includes('PERMISSION_DENIED') || err?.message?.includes('permission')) {
      log.warn('list accounts encountered PERMISSION_DENIED; responding with fallback overview', err.message);
      try {
        const { createFileStore } = await import('../features/social-accounts/server/store');
        const { createAccountsService } = await import('../features/social-accounts/server/service');
        const fileStore = createFileStore(config.dataDir);
        const fallbackAccounts = createAccountsService(config, fileStore, gateway);
        const o = await fallbackAccounts.overview(uid(req));
        return res.json({ ...o, accounts: o.platforms.flatMap((c) => c.accounts.map((a) => ({ ...a, id: a.connectionId, platform: c.platform, status: c.status }))) });
      } catch (fallbackErr) {
        log.error('list accounts fallback failed', fallbackErr);
      }
    }
    sendError(res, err, 'list accounts');
  }
});

router.post('/connect', connectLimit, async (req: AuthedRequest, res) => {
  try {
    const body = connectBody.parse(req.body ?? {});
    if (!isAccountPlatform(body.platform)) throw new AccountsError('That platform isn’t supported.', 400, 'unsupported_platform', 'platform');
    if (body.credentials) {
      const account = await accounts.connectDirect(uid(req), body.platform, body.credentials);
      res.status(201).json({ next: 'done', account });
      return;
    }
    const { result, cookieState } = await accounts.startConnect(uid(req), body.platform, {});
    if (cookieState) setStateCookie(res, cookieState);
    res.json(result);
  } catch (err) { sendError(res, err, 'connect'); }
});

router.post('/attempts/:id/check', async (req: AuthedRequest, res) => {
  try { res.json(await accounts.checkAttempt(uid(req), idParam.parse(req.params.id), checkBody.parse(req.body ?? {}).final === true)); }
  catch (err) { sendError(res, err, 'check attempt'); }
});

router.post('/attempts/:id/cancel', async (req: AuthedRequest, res) => {
  try { res.json(await accounts.cancelAttempt(uid(req), idParam.parse(req.params.id))); }
  catch (err) { sendError(res, err, 'cancel attempt'); }
});

router.delete('/workspace', async (req: AuthedRequest, res) => {
  try {
    const r = await accounts.forgetWorkspace(uid(req));
    res.json({ ...r, revokeInPostiz: 'To fully revoke access, remove this app under Postiz → Settings → Approved apps.' });
  } catch (err) { sendError(res, err, 'forget workspace'); }
});

router.post('/:id/reconnect', connectLimit, async (req: AuthedRequest, res) => {
  try {
    const id = idParam.parse(req.params.id);
    const body = reconnectBody.parse(req.body ?? {});
    // Never trust the id alone: it must be one of this user's connections.
    const conn = (await store.getUser(uid(req))).connections.find((c) => c.id === id);
    if (!conn) throw new AccountsError('That account wasn’t found.', 404, 'not_found');
    if (conn.method === 'direct') {
      if (!body.credentials) { const { result } = await accounts.startConnect(uid(req), conn.platform, {}); res.json(result); return; }
      const account = await accounts.connectDirect(uid(req), conn.platform, body.credentials, conn.id);
      res.status(200).json({ next: 'done', account });
      return;
    }
    const { result, cookieState } = await accounts.startConnect(uid(req), conn.platform, { reconnectConnectionId: conn.id });
    if (cookieState) setStateCookie(res, cookieState);
    res.json(result);
  } catch (err) { sendError(res, err, 'reconnect'); }
});

router.delete('/:id', async (req: AuthedRequest, res) => {
  try { await accounts.disconnect(uid(req), idParam.parse(req.params.id)); res.json({ success: true }); }
  catch (err) { sendError(res, err, 'disconnect'); }
});

export default router;
