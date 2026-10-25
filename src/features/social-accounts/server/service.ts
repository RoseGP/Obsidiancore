/**
 * Connected-accounts business logic (server only).
 *
 * Postiz flows (see docs/social-accounts/POSTIZ_CAPABILITIES.md):
 *  - OAuth mode: the user authorizes their Postiz workspace once (authorization
 *    code + signed single-use state + cookie binding). The pos_ token is stored
 *    encrypted and used for that user's channels.
 *  - API-key mode: one shared workspace; channel ownership is tracked in
 *    store.owners so each channel belongs to exactly one user.
 *  - Channel connection: Postiz returns the provider's consent URL. Postiz
 *    Cloud's public API has no return URL, so the browser opens it in a popup
 *    and the app detects the new channel by diffing the workspace's channel
 *    list against a baseline. Self-hosted Postiz with POSTIZ_ENTERPRISE_JWT_SECRET
 *    uses /enterprise/url, which returns to this app via a validated callback.
 */
import { definitionFor, isAccountPlatform, PLATFORM_DEFINITIONS, type AccountPlatform, type AccountProfile, type AccountsOverview, type AttemptResult, type CardStatus, type ConnectNext, type PlatformCard } from '../shared/types';
import { randomId, seal, signState, unseal, verifyState, type SocialAccountsConfig } from './config';
import { DIRECT_ADAPTERS, DirectAdapterError } from './directAdapters';
import { GatewayError, type WorkspaceChannel, type WorkspaceGateway } from './gateway';
import type { AccountsStore, OwnersTx, StoredAttempt, StoredConnection, UserDoc } from './store';

export class AccountsError extends Error {
  constructor(message: string, public status: number, public code: string, public field?: string) { super(message); }
}

const ATTEMPT_TTL_MS = 15 * 60_000;
export const STATE_COOKIE = 'sa_oauth_state';
/** Public path of the accounts router; the return URL registered with Postiz lives under it. */
export const RETURN_BASE = '/api/accounts';
/** Shared-workspace lock key: one person connects a given platform at a time. */
const lockKey = (p: AccountPlatform) => `lock:${p}`;
const directKey = (p: AccountPlatform, id: string) => `direct:${p}:${id}`;
const lockHeldByOther = (owners: OwnersTx, p: AccountPlatform, userId: string) => {
  const v = owners.get(lockKey(p));
  if (!v) return false;
  const [owner, exp] = v.split('|');
  return owner !== userId && Number(exp) > Date.now();
};
const releaseLock = (owners: OwnersTx, p: AccountPlatform | null, userId: string) => {
  if (!p) return;
  const v = owners.get(lockKey(p));
  if (v && v.split('|')[0] === userId) owners.delete(lockKey(p));
};

const toProfile = (c: StoredConnection): AccountProfile => ({
  connectionId: c.id, name: c.name, handle: c.handle, pictureUrl: c.pictureUrl, connectedAt: c.connectedAt, lastVerifiedAt: c.lastVerifiedAt,
});

export function createAccountsService(cfg: SocialAccountsConfig, store: AccountsStore, postiz: WorkspaceGateway) {
  const nowIso = () => new Date().toISOString();

  function requireCrypto() {
    if (!cfg.encryptionKey || !cfg.stateKey) {
      throw new AccountsError('Account connections aren’t configured on the server (missing SOCIAL_ACCOUNTS_ENCRYPTION_KEY).', 503, 'not_configured');
    }
    return { key: cfg.encryptionKey, stateKey: cfg.stateKey };
  }

  /** The Postiz credential for this user, or null if they haven't authorized a workspace (OAuth mode). */
  function credentialFor(u: UserDoc): string | null {
    if (cfg.apiKey) return cfg.apiKey;
    if (cfg.postizMode === 'api_key') return cfg.apiKey;
    if (u.postizWorkspace && !u.postizWorkspace.revokedAt && cfg.encryptionKey) {
      try { return unseal(u.postizWorkspace.token, cfg.encryptionKey); } catch { return null; }
    }
    return null;
  }

  function appRedirect(params: Record<string, string>) {
    const q = new URLSearchParams({ view: 'social_planner', ...params }).toString();
    return `${cfg.appUrl || ''}${cfg.returnPath}${cfg.returnPath.includes('?') ? '&' : '?'}${q}`;
  }

  function cardStatus(conns: StoredConnection[], problems: Map<string, { status: 'expired' | 'needs_attention'; detail: string }>): { status: CardStatus; detail?: string } {
    if (!conns.length) return { status: 'not_connected' };
    const ps = conns.map((c) => problems.get(c.id)).filter(Boolean) as { status: 'expired' | 'needs_attention'; detail: string }[];
    const expired = ps.find((p) => p.status === 'expired');
    if (expired) return { status: 'expired', detail: expired.detail };
    const na = ps.find((p) => p.status === 'needs_attention');
    if (na) return { status: 'needs_attention', detail: na.detail };
    return { status: 'connected' };
  }

  // ---------- Overview ----------

  async function overview(userId: string): Promise<AccountsOverview> {
    const u0 = await store.getUser(userId);
    const credential = credentialFor(u0);
    let integrations: WorkspaceChannel[] | null = null;
    let workspaceProblem: AccountsOverview['postiz']['problem'];

    if (credential) {
      try {
        integrations = await postiz.listChannels(credential);
      } catch (err) {
        if (err instanceof GatewayError && err.kind === 'unauthorized') {
          workspaceProblem = cfg.postizMode === 'oauth'
            ? { status: 'expired', detail: 'Access to your Postiz workspace was revoked. Reconnect to continue.' }
            : { status: 'expired', detail: 'The server’s Postiz API key was rejected. An admin needs to update POSTIZ_API_KEY.' };
        } else {
          workspaceProblem = { status: 'needs_attention', detail: 'Postiz couldn’t be reached, so statuses may be out of date.' };
        }
      }
    }

    // Direct connections due for re-verification (at most every 6 hours).
    const directChecks = new Map<string, { status: 'expired' | 'needs_attention'; detail: string } | null>();
    if (cfg.encryptionKey) {
      for (const c of u0.connections.filter((x) => x.method === 'direct' && x.secret)) {
        const due = !c.lastVerifiedAt || Date.now() - new Date(c.lastVerifiedAt).getTime() > 6 * 3_600_000;
        const adapter = DIRECT_ADAPTERS[c.platform];
        if (!due || !adapter) continue;
        try { directChecks.set(c.id, await adapter.verify(unseal(c.secret!, cfg.encryptionKey), c.meta ?? {})); }
        catch { directChecks.set(c.id, { status: 'needs_attention', detail: 'This account couldn’t be verified right now.' }); }
      }
    }

    const ownerKeys = cfg.postizMode === 'oauth' ? (integrations ?? []).map((i) => i.id) : [];
    return store.updateUser(userId, ownerKeys, (u, owners) => {
      if (workspaceProblem?.status === 'expired' && cfg.postizMode === 'oauth' && u.postizWorkspace) u.postizWorkspace.revokedAt ??= nowIso();
      const byId = new Map((integrations ?? []).map((i) => [i.id, i]));

      // OAuth mode: the workspace is the user's own, so adopt channels added there directly.
      if (integrations && cfg.postizMode === 'oauth') {
        for (const i of integrations) {
          const def = PLATFORM_DEFINITIONS.find((d) => d.postizIdentifier === i.identifier);
          if (!def || u.connections.some((c) => c.method === 'postiz' && c.externalId === i.id)) continue;
          const owner = owners.get(i.id);
          if (owner && owner !== userId) continue;
          owners.set(i.id, userId);
          u.connections.push({ id: randomId('conn'), platform: def.platform, method: 'postiz', externalId: i.id, name: i.name, handle: i.profile ? `@${i.profile}` : undefined, pictureUrl: i.picture ?? undefined, connectedAt: nowIso(), lastVerifiedAt: nowIso() });
        }
      }

      const problems = new Map<string, { status: 'expired' | 'needs_attention'; detail: string }>();
      for (const c of u.connections) {
        if (c.method === 'postiz') {
          if (workspaceProblem) { problems.set(c.id, workspaceProblem); continue; }
          if (!integrations) { problems.set(c.id, { status: 'needs_attention', detail: cfg.postizMode === 'oauth' ? 'Reconnect your Postiz workspace to check this account.' : 'Postiz isn’t configured on the server.' }); continue; }
          const i = byId.get(c.externalId);
          if (!i) { problems.set(c.id, { status: 'needs_attention', detail: 'This channel was removed from the Postiz workspace. Reconnect it.' }); continue; }
          c.name = i.name || c.name;
          c.handle = i.profile ? `@${i.profile}` : c.handle;
          c.pictureUrl = i.picture ?? c.pictureUrl;
          c.lastVerifiedAt = nowIso();
          if (i.disabled) problems.set(c.id, { status: 'needs_attention', detail: 'Postiz has disabled this channel (often a plan limit or a provider permission change).' });
        } else {
          if (directChecks.has(c.id)) { c.problem = directChecks.get(c.id) ?? undefined; c.lastVerifiedAt = nowIso(); }
          if (c.problem) problems.set(c.id, c.problem);
        }
      }

      const platforms: PlatformCard[] = PLATFORM_DEFINITIONS.map((d) => {
        const conns = u.connections.filter((c) => c.platform === d.platform);
        let available = true;
        let unavailableReason: string | undefined;
        if (d.method === 'postiz' && cfg.postizMode === 'none') { available = false; unavailableReason = 'Postiz isn’t configured on the server.'; }
        if (d.method === 'direct' && (!DIRECT_ADAPTERS[d.platform] || !cfg.encryptionKey)) { available = false; unavailableReason = 'Direct connections aren’t configured on the server.'; }
        const pending = u.attempts.find((a) => a.platform === d.platform && a.status === 'pending' && new Date(a.expiresAt).getTime() > Date.now());
        return {
          platform: d.platform, label: d.label, method: d.method, available, unavailableReason,
          ...cardStatus(conns, problems),
          accounts: conns.map(toProfile),
          pendingAttemptId: pending?.id,
        };
      });

      return {
        postiz: {
          mode: cfg.postizMode,
          workspaceAuthorized: cfg.postizMode === 'api_key' || !!cfg.apiKey || (!!u.postizWorkspace && !u.postizWorkspace.revokedAt),
          workspaceName: u.postizWorkspace?.name || (cfg.apiKey ? 'Self-Hosted Postiz' : undefined),
          returnsToApp: canReturnToApp(),
          problem: workspaceProblem,
        },
        platforms,
        checkedAt: nowIso(),
      };
    });
  }

  const canReturnToApp = () => (cfg.postizMode === 'api_key' || !!cfg.apiKey) && !!cfg.enterpriseSecret && !!cfg.appUrl;

  // ---------- Start connecting ----------

  async function startConnect(userId: string, platformRaw: unknown, opts: { reconnectConnectionId?: string }): Promise<{ result: ConnectNext; cookieState?: string }> {
    if (!isAccountPlatform(platformRaw)) throw new AccountsError('That platform isn’t supported.', 400, 'unsupported_platform');
    const platform = platformRaw;
    const def = definitionFor(platform);
    const { key, stateKey } = requireCrypto();

    if (def.method === 'direct') {
      const adapter = DIRECT_ADAPTERS[platform];
      if (!adapter) throw new AccountsError('Direct connections aren’t available for this platform.', 503, 'not_configured');
      return { result: { next: 'credentials', fields: adapter.fields } };
    }
    if (cfg.postizMode === 'none') throw new AccountsError('Postiz isn’t configured on the server. Set POSTIZ_CLIENT_ID/SECRET or POSTIZ_API_KEY.', 503, 'not_configured');

    const u0 = await store.getUser(userId);
    if (opts.reconnectConnectionId && !u0.connections.some((c) => c.id === opts.reconnectConnectionId && c.platform === platform)) {
      throw new AccountsError('That account isn’t yours to reconnect.', 404, 'not_found');
    }

    // OAuth mode without an authorized workspace: authorize the workspace first.
    const credential = credentialFor(u0);
    if (!credential) {
      if (cfg.postizMode !== 'oauth') throw new AccountsError('Postiz isn’t configured on the server.', 503, 'not_configured');
      if (!cfg.redirectUri && !cfg.appUrl) throw new AccountsError('POSTIZ_REDIRECT_URI isn’t configured on the server.', 503, 'not_configured');
      const attempt: StoredAttempt = {
        id: randomId('att'), platform: null, kind: 'workspace', status: 'pending', baseline: [], resume: platform,
        returnsToApp: true, createdAt: nowIso(), expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS).toISOString(),
      };
      await store.updateUser(userId, [], (u) => { u.attempts.push(attempt); });
      const state = signState({ u: userId, a: attempt.id, k: 'workspace', exp: Date.now() + ATTEMPT_TTL_MS }, stateKey);
      const q = new URLSearchParams({ client_id: cfg.clientId, state });
      if (cfg.redirectUri) q.set('redirect_uri', cfg.redirectUri);
      return { result: { next: 'authorize_workspace', url: `${cfg.postizFrontendUrl}/oauth/authorize?${q}` }, cookieState: state };
    }

    // Snapshot the workspace's channels so the new one can be identified.
    let baseline: WorkspaceChannel[];
    try { baseline = await postiz.listChannels(credential); }
    catch (err) { throw mapPostiz(err); }

    const reconnect = opts.reconnectConnectionId ? u0.connections.find((c) => c.id === opts.reconnectConnectionId) : undefined;

    // Shared workspace: two people connecting the same platform at once would be ambiguous.
    const useLock = cfg.postizMode === 'api_key' && !reconnect;
    if (useLock && await store.updateUser(userId, [lockKey(platform)], (_u, owners) => lockHeldByOther(owners, platform, userId))) {
      throw new AccountsError(`Someone on your team is connecting ${def.label} right now. Try again in a few minutes.`, 409, 'busy');
    }

    const attempt: StoredAttempt = {
      id: randomId('att'), platform, kind: 'channel', status: 'pending', baseline: baseline.map((i) => i.id),
      reconnectOf: reconnect?.id, returnsToApp: canReturnToApp(), createdAt: nowIso(), expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS).toISOString(),
    };
    const state = signState({ u: userId, a: attempt.id, k: 'channel', exp: Date.now() + ATTEMPT_TTL_MS }, stateKey);

    let url: string;
    try {
      url = attempt.returnsToApp
        ? await postiz.connectUrlWithReturn!(cfg.enterpriseSecret, { apiKey: cfg.apiKey, identifier: def.postizIdentifier!, redirectUrl: `${cfg.appUrl}${RETURN_BASE}/return/${state}`, refreshChannelId: reconnect?.externalId })
        : await postiz.connectUrl(credential, def.postizIdentifier!, reconnect?.externalId);
    } catch (err) { throw mapPostiz(err); }

    await store.updateUser(userId, useLock ? [lockKey(platform)] : [], (u, owners) => {
      if (useLock) {
        if (lockHeldByOther(owners, platform, userId)) throw new AccountsError(`Someone on your team is connecting ${def.label} right now. Try again in a few minutes.`, 409, 'busy');
        owners.set(lockKey(platform), `${userId}|${new Date(attempt.expiresAt).getTime()}`);
      }
      for (const a of u.attempts) if (a.platform === platform && a.status === 'pending') { a.status = 'cancelled'; a.detail = 'Replaced by a newer attempt.'; }
      u.attempts.push(attempt);
    });
    void key;
    return {
      result: attempt.returnsToApp ? { next: 'redirect', url, attemptId: attempt.id } : { next: 'popup', url, attemptId: attempt.id },
      cookieState: attempt.returnsToApp ? state : undefined,
    };
  }

  function mapPostiz(err: unknown): AccountsError {
    if (err instanceof AccountsError) return err;
    if (err instanceof GatewayError) {
      if (err.kind === 'unauthorized') return new AccountsError(cfg.postizMode === 'oauth' ? 'Access to your Postiz workspace was revoked. Reconnect it and try again.' : 'Postiz rejected the server’s API key.', 502, 'postiz_unauthorized');
      if (err.kind === 'not_allowed') return new AccountsError(`Postiz can’t connect this platform: ${err.message}`, 502, 'postiz_not_allowed');
      return new AccountsError(err.message, 502, 'postiz_unavailable');
    }
    return new AccountsError('Something went wrong talking to Postiz.', 500, 'server');
  }

  // ---------- Postiz workspace OAuth callback ----------

  async function workspaceCallback(q: { code?: string; state?: string; error?: string }, cookieState: string | undefined): Promise<string> {
    const { key, stateKey } = requireCrypto();
    const payload = q.state ? verifyState(q.state, stateKey) : null;
    if (!payload || payload.k !== 'workspace') return appRedirect({ sa: 'error', sa_reason: 'invalid_state' });
    if (!cookieState || cookieState !== q.state) return appRedirect({ sa: 'error', sa_reason: 'state_mismatch' });

    // Single use: claim the attempt before doing anything else.
    const attempt = await store.updateUser(payload.u, [], (u) => {
      const a = u.attempts.find((x) => x.id === payload.a && x.kind === 'workspace');
      if (!a || a.status !== 'pending' || new Date(a.expiresAt).getTime() < Date.now()) return null;
      a.status = 'failed'; // provisional; set to completed on success
      return { ...a };
    });
    if (!attempt) return appRedirect({ sa: 'error', sa_reason: 'expired' });

    if (q.error) {
      await store.updateUser(payload.u, [], (u) => { const a = u.attempts.find((x) => x.id === attempt.id); if (a) { a.status = 'cancelled'; a.detail = 'Authorization was declined.'; } });
      return appRedirect({ sa: 'workspace_cancelled' });
    }
    if (!q.code) return appRedirect({ sa: 'error', sa_reason: 'missing_code' });

    try {
      const token = await postiz.exchangeCode(q.code, cfg.clientId, cfg.clientSecret, cfg.redirectUri || undefined);
      const me = await postiz.describeWorkspace(token).catch(() => null);
      await store.updateUser(payload.u, [], (u) => {
        u.postizWorkspace = { token: seal(token, key), name: me?.name, authorizedAt: nowIso() };
        const a = u.attempts.find((x) => x.id === attempt.id);
        if (a) a.status = 'completed';
      });
      return appRedirect({ sa: 'workspace_connected', ...(attempt.resume ? { sa_resume: attempt.resume } : {}) });
    } catch (err: any) {
      await store.updateUser(payload.u, [], (u) => { const a = u.attempts.find((x) => x.id === attempt.id); if (a) a.detail = String(err?.message ?? 'Token exchange failed'); });
      return appRedirect({ sa: 'error', sa_reason: 'token_exchange' });
    }
  }

  // ---------- Return from a Postiz channel connection (self-hosted enterprise flow) ----------

  async function channelReturn(state: string, cookieState: string | undefined): Promise<string> {
    const { stateKey } = requireCrypto();
    const payload = verifyState(state, stateKey);
    if (!payload || payload.k !== 'channel') return appRedirect({ sa: 'error', sa_reason: 'invalid_state' });
    if (!cookieState || cookieState !== state) return appRedirect({ sa: 'error', sa_reason: 'state_mismatch' });
    return appRedirect({ sa: 'channel_returned', sa_attempt: payload.a });
  }

  // ---------- Check / finish an attempt ----------

  async function checkAttempt(userId: string, attemptId: string, final: boolean): Promise<AttemptResult> {
    const u0 = await store.getUser(userId);
    const a0 = u0.attempts.find((a) => a.id === attemptId && a.kind === 'channel');
    if (!a0) throw new AccountsError('That connection attempt wasn’t found.', 404, 'not_found');
    if (a0.status !== 'pending') {
      const conn = u0.connections.find((c) => c.platform === a0.platform && a0.status === 'completed');
      return { attemptId, status: a0.status, detail: a0.detail, account: conn ? toProfile(conn) : undefined };
    }
    if (new Date(a0.expiresAt).getTime() < Date.now()) {
      await store.updateUser(userId, a0.platform ? [lockKey(a0.platform)] : [], (u, owners) => { const a = u.attempts.find((x) => x.id === attemptId); if (a && a.status === 'pending') { a.status = 'expired'; a.detail = 'The connection took too long. Start again.'; } releaseLock(owners, a0.platform, userId); });
      return { attemptId, status: 'expired', detail: 'The connection took too long. Start again.' };
    }
    const credential = credentialFor(u0);
    if (!credential) throw new AccountsError('Reconnect your Postiz workspace first.', 409, 'workspace_required');
    let list: WorkspaceChannel[];
    try { list = await postiz.listChannels(credential); } catch (err) { throw mapPostiz(err); }
    const identifier = definitionFor(a0.platform!).postizIdentifier!;

    const candidateIds = list.filter((i) => i.identifier === identifier && !a0.baseline.includes(i.id)).map((i) => i.id);
    return store.updateUser(userId, [...candidateIds, lockKey(a0.platform!)], (u, owners) => {
      const a = u.attempts.find((x) => x.id === attemptId)!;
      if (a.status !== 'pending') return { attemptId, status: a.status, detail: a.detail };
      const settle = <R,>(r: R): R => { if (a.status !== 'pending') releaseLock(owners, a.platform, userId); return r; };

      if (a.reconnectOf) {
        const conn = u.connections.find((c) => c.id === a.reconnectOf);
        const i = conn && list.find((x) => x.id === conn.externalId);
        if (!final) return { attemptId, status: 'pending' as const };
        if (conn && i && !i.disabled) {
          Object.assign(conn, { name: i.name || conn.name, pictureUrl: i.picture ?? conn.pictureUrl, lastVerifiedAt: nowIso() });
          a.status = 'completed';
          return settle({ attemptId, status: 'completed' as const, account: toProfile(conn) });
        }
        a.status = 'failed';
        a.detail = 'The account still needs attention in Postiz. Try reconnecting again.';
        return settle({ attemptId, status: 'failed' as const, detail: a.detail });
      }

      const fresh = list.filter((i) => candidateIds.includes(i.id) && (!owners.get(i.id) || owners.get(i.id) === userId));
      if (fresh.length === 0) {
        if (!final) return { attemptId, status: 'pending' as const };
        a.status = 'cancelled';
        a.detail = 'No new account was connected.';
        return settle({ attemptId, status: 'cancelled' as const, detail: a.detail });
      }
      if (fresh.length > 1 && cfg.postizMode === 'api_key') {
        a.status = 'failed';
        a.detail = 'More than one new account appeared in the shared workspace, so ownership couldn’t be confirmed. Ask an admin to assign it.';
        return settle({ attemptId, status: 'failed' as const, detail: a.detail });
      }
      let last: StoredConnection | undefined;
      for (const i of fresh) {
        owners.set(i.id, userId);
        last = { id: randomId('conn'), platform: a.platform!, method: 'postiz', externalId: i.id, name: i.name, handle: i.profile ? `@${i.profile}` : undefined, pictureUrl: i.picture ?? undefined, connectedAt: nowIso(), lastVerifiedAt: nowIso() };
        u.connections.push(last);
      }
      a.status = 'completed';
      return settle({ attemptId, status: 'completed' as const, account: last && toProfile(last) });
    });
  }

  async function cancelAttempt(userId: string, attemptId: string): Promise<AttemptResult> {
    const u0 = await store.getUser(userId);
    const a0 = u0.attempts.find((x) => x.id === attemptId);
    if (!a0) throw new AccountsError('That connection attempt wasn’t found.', 404, 'not_found');
    return store.updateUser(userId, a0.platform ? [lockKey(a0.platform)] : [], (u, owners) => {
      const a = u.attempts.find((x) => x.id === attemptId)!;
      if (a.status === 'pending') { a.status = 'cancelled'; a.detail = 'Cancelled.'; }
      releaseLock(owners, a.platform, userId);
      return { attemptId, status: a.status, detail: a.detail };
    });
  }

  // ---------- Disconnect ----------

  async function disconnect(userId: string, connectionId: string): Promise<void> {
    const u0 = await store.getUser(userId);
    const c = u0.connections.find((x) => x.id === connectionId);
    if (!c) throw new AccountsError('That account wasn’t found.', 404, 'not_found');
    if (c.method === 'postiz') {
      if (cfg.postizMode === 'api_key' && (await store.getOwner(c.externalId)) !== userId) throw new AccountsError('That account isn’t yours to disconnect.', 403, 'forbidden');
      const credential = credentialFor(u0);
      if (!credential) throw new AccountsError('Reconnect your Postiz workspace before disconnecting channels.', 409, 'workspace_required');
      try { await postiz.deleteChannel(credential, c.externalId); }
      catch (err) { if (!(err instanceof GatewayError && err.status === 404)) throw mapPostiz(err); }
    }
    const key = c.method === 'postiz' ? c.externalId : directKey(c.platform, c.externalId);
    await store.updateUser(userId, [key], (u, owners) => {
      u.connections = u.connections.filter((x) => x.id !== connectionId);
      if (owners.get(key) === userId) owners.delete(key);
    });
  }

  // ---------- Direct connections ----------

  async function connectDirect(userId: string, platformRaw: unknown, input: Record<string, string>, reconnectConnectionId?: string): Promise<AccountProfile> {
    if (!isAccountPlatform(platformRaw)) throw new AccountsError('That platform isn’t supported.', 400, 'unsupported_platform');
    const adapter = DIRECT_ADAPTERS[platformRaw];
    if (!adapter || definitionFor(platformRaw).method !== 'direct') throw new AccountsError('This platform connects through Postiz.', 400, 'wrong_method');
    const { key } = requireCrypto();
    let verified;
    try { verified = await adapter.connect(input); }
    catch (err) {
      if (err instanceof DirectAdapterError) throw new AccountsError(err.message, err.kind === 'unavailable' ? 502 : 422, err.kind, err.field);
      throw err;
    }
    const ownerKey = directKey(platformRaw, verified.externalId);
    return store.updateUser(userId, [ownerKey], (u, owners) => {
      const owner = owners.get(ownerKey);
      if (owner && owner !== userId) throw new AccountsError('This account is already connected by someone else.', 409, 'owned_elsewhere');
      owners.set(ownerKey, userId);
      const existing = u.connections.find((c) => (reconnectConnectionId && c.id === reconnectConnectionId) || (c.platform === platformRaw && c.externalId === verified.externalId));
      const record: StoredConnection = {
        id: existing?.id ?? randomId('conn'), platform: platformRaw, method: 'direct', externalId: verified.externalId,
        name: verified.name, handle: verified.handle, pictureUrl: verified.pictureUrl,
        connectedAt: existing?.connectedAt ?? nowIso(), lastVerifiedAt: nowIso(), secret: seal(verified.secret, key), meta: verified.meta,
      };
      u.connections = existing ? u.connections.map((c) => (c.id === existing.id ? record : c)) : [...u.connections, record];
      return toProfile(record);
    });
  }

  /** Removes this app's stored Postiz token for the user (see docs: token revocation). */
  async function forgetWorkspace(userId: string): Promise<{ hadToken: boolean }> {
    return store.updateUser(userId, [], (u) => {
      const had = !!u.postizWorkspace;
      delete u.postizWorkspace;
      return { hadToken: had };
    });
  }

  return { overview, startConnect, workspaceCallback, channelReturn, checkAttempt, cancelAttempt, disconnect, connectDirect, forgetWorkspace, credentialFor, mapGatewayError: mapPostiz };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
