/** Browser client for /api/accounts. Only the user's session token is sent; no secrets. */
import type { AccountPlatform, AccountProfile, AccountsOverview, AttemptResult, ConnectNext } from '../shared/types';

export class AccountsApiError extends Error {
  constructor(message: string, public status: number, public code: string, public field?: string) { super(message); }
}

export interface AccountsApi {
  overview(): Promise<AccountsOverview>;
  connect(platform: AccountPlatform, reconnectConnectionId?: string): Promise<ConnectNext>;
  connectDirect(platform: AccountPlatform, input: Record<string, string>, reconnectConnectionId?: string): Promise<AccountProfile>;
  check(attemptId: string, final: boolean): Promise<AttemptResult>;
  cancel(attemptId: string): Promise<AttemptResult>;
  disconnect(connectionId: string): Promise<void>;
}

export function createAccountsApi(getHeaders: () => Promise<Record<string, string>>): AccountsApi {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(`/api/accounts${path}`, {
        ...init, credentials: 'same-origin', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(await getHeaders()), ...(init.headers || {}) },
      });
    } catch (err: any) {
      throw new AccountsApiError(err?.name === 'AbortError' ? 'The server took too long to respond.' : 'Can’t reach the server.', 0, 'network');
    } finally { clearTimeout(t); }
    let body: any = null;
    try { body = await res.json(); } catch { /* */ }
    if (!res.ok) throw new AccountsApiError(body?.error || `Request failed (${res.status}).`, res.status, body?.code || 'server', body?.field);
    return body as T;
  }
  const post = (path: string, body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });
  return {
    overview: () => call('/'),
    connect: (platform, reconnectId) => reconnectId
      ? call(`/${encodeURIComponent(reconnectId)}/reconnect`, post('', {}))
      : call('/connect', post('', { platform })),
    connectDirect: async (platform, credentials, reconnectId) => (await call<{ account: AccountProfile }>(
      reconnectId ? `/${encodeURIComponent(reconnectId)}/reconnect` : '/connect',
      post('', reconnectId ? { credentials } : { platform, credentials }),
    )).account,
    check: (attemptId, final) => call(`/attempts/${encodeURIComponent(attemptId)}/check`, post('', { final })),
    cancel: (attemptId) => call(`/attempts/${encodeURIComponent(attemptId)}/cancel`, { method: 'POST' }),
    disconnect: async (id) => { await call(`/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  };
}
