/**
 * HTTP client for the billing backend (src/routes/billing.ts).
 * No secrets live here: the browser only holds the user's session token;
 * Payment-provider credentials stay on the server.
 */
import type { CurrentUser } from '../domain/types';
import { createLocalRepository } from './localRepository';
import { BillingError, type BillingRepository } from './repository';

const BASE = '/api/billing';
const TOKEN_KEYS = ['billing_jwt_token', 'bff_jwt_token'];

function getToken(): string | null {
  try {
    for (const k of TOKEN_KEYS) {
      const t = localStorage.getItem(k);
      if (t) return t;
    }
  } catch { /* storage unavailable */ }
  return null;
}

async function request<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new BillingError('Can’t reach the billing server. Check your connection and try again.', 'network');
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const code = body?.code
      ?? (res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found'
        : res.status === 409 ? 'conflict' : res.status === 422 ? 'validation' : res.status === 503 ? 'not_configured' : 'server');
    const err = new BillingError(body?.error ?? `Request failed (${res.status}).`, code, body?.fieldErrors ?? {});
    (err as any).body = body;
    throw err;
  }
  return body as T;
}

interface SessionResponse { user: CurrentUser }

function createApiRepository(session: SessionResponse): BillingRepository {
  return {
    mode: 'remote',
    modeReason: '',
    user: session.user,
    load: () => request('/snapshot'),
    saveInvoice: (invoice, { idempotencyKey }) =>
      request<{ invoice: any }>(`/invoices/${encodeURIComponent(invoice.id)}`, { method: 'PUT', body: JSON.stringify({ invoice }), idempotencyKey }).then((r) => r.invoice),
    voidInvoice: (id) => request<{ invoice: any }>(`/invoices/${encodeURIComponent(id)}/void`, { method: 'POST' }).then((r) => r.invoice),
    markInvoiceSent: (id) => request<{ invoice: any }>(`/invoices/${encodeURIComponent(id)}/mark-sent`, { method: 'POST' }).then((r) => r.invoice),
    recordPayment: (payment, { idempotencyKey }) =>
      request(`/invoices/${encodeURIComponent(payment.invoiceId)}/payments`, { method: 'POST', body: JSON.stringify({ payment }), idempotencyKey }),
    saveClient: (client) =>
      request<{ client: any }>(`/clients/${encodeURIComponent(client.id)}`, { method: 'PUT', body: JSON.stringify({ client }) }).then((r) => r.client),
    setClientArchived: (id, archived) =>
      request<{ client: any }>(`/clients/${encodeURIComponent(id)}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }).then((r) => r.client),
    saveSettings: (settings) =>
      request<{ settings: any }>('/settings', { method: 'PUT', body: JSON.stringify({ settings }) }).then((r) => r.settings),
  };
}

/**
 * Uses the backend when it is reachable, configured and the user is signed
 * in; otherwise falls back to the clearly-labelled prototype store.
 */
export async function connectBillingRepository(): Promise<BillingRepository> {
  try {
    const session = await request<SessionResponse>('/session');
    return createApiRepository(session);
  } catch (err) {
    const e = err as BillingError;
    const reason =
      e.code === 'unauthorized' ? 'You’re not signed in to the billing server, so changes are saved in this browser only.'
      : e.code === 'not_configured' ? 'The billing server isn’t configured yet, so changes are saved in this browser only.'
      : 'The billing server isn’t available, so changes are saved in this browser only.';
    return createLocalRepository(reason);
  }
}
