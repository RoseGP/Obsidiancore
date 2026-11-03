/**
 * Client state for Stripe Connect: connection, payment links, subscriptions.
 * Talks to /api/billing/stripe (the session's credentials are added by the app's
 * global fetch wrapper). Only available when billing runs against the server.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useBilling } from '../state/BillingStore';
import type { BillingInterval, CrmSubscription, StripeConnection, StripeInvoiceLink } from './model';

export interface SetupStatus { apiKey: boolean; oauth: boolean; webhook: boolean; stateSecret: boolean; appUrl: boolean; livemode: boolean; missing: string[] }
export interface StripeState { setup: SetupStatus; connection: StripeConnection; invoices: Record<string, StripeInvoiceLink>; subscriptions: CrmSubscription[] }

export class StripeApiError extends Error { constructor(message: string, public code: string) { super(message); } }

/** Same session token the billing repository uses; otherwise the app's fetch wrapper adds the CRM sign-in. */
function billingToken(): string | null {
  try { for (const k of ['billing_jwt_token', 'bff_jwt_token']) { const t = localStorage.getItem(k); if (t) return t; } } catch { /* storage unavailable */ }
  return null;
}

async function call<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = billingToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.idempotencyKey) headers.set('Idempotency-Key', init.idempotencyKey);
  let res: Response;
  try { res = await fetch(`/api/billing/stripe${path}`, { ...init, headers }); }
  catch { throw new StripeApiError('Can’t reach the billing server. Check your connection and try again.', 'network'); }
  let body: any = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new StripeApiError(body?.error || `Stripe request failed (${res.status}).`, body?.code || 'server');
  return body as T;
}

const key = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export interface NewSubscription { clientId: string; planName: string; amount: string; currency: string; interval: BillingInterval; quantity: number; trialDays: number }

interface Ctx {
  available: boolean;
  unavailableReason: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  state: StripeState | null;
  busy: string | null;
  refresh(): Promise<void>;
  connectOAuth(): Promise<void>;
  startOnboarding(email?: string): Promise<void>;
  disconnect(): Promise<void>;
  sync(): Promise<void>;
  collect(invoiceId: string, sendEmail: boolean): Promise<StripeInvoiceLink>;
  sendViaStripe(invoiceId: string): Promise<StripeInvoiceLink>;
  createSubscription(input: NewSubscription): Promise<CrmSubscription>;
  updateSubscription(id: string, action: 'cancel_at_period_end' | 'resume' | 'cancel_now'): Promise<CrmSubscription>;
}

const StripeCtx = createContext<Ctx | null>(null);

export function StripeProvider({ children }: { children: React.ReactNode }) {
  const { repo, reload } = useBilling();
  const available = repo?.mode === 'remote';
  const [status, setStatus] = useState<Ctx['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<StripeState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    if (!available) return;
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    try { setState(await call<StripeState>('')); setStatus('ready'); setError(null); }
    catch (e: any) { setError(e.message); setStatus('error'); }
  }, [available]);

  useEffect(() => { if (available && !loaded.current) { loaded.current = true; refresh(); } }, [available, refresh]);

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    setBusy(label);
    try { return await fn(); } finally { setBusy(null); }
  };

  const value: Ctx = {
    available, status, error, state, busy, refresh,
    unavailableReason: available ? '' : 'Stripe needs the billing server. This workspace is running in offline prototype mode.',
    connectOAuth: () => run('connect', async () => { const { url } = await call<{ url: string }>('/connect/oauth', { method: 'POST' }); window.location.assign(url); }),
    startOnboarding: (email) => run('onboarding', async () => { const { url } = await call<{ url: string }>('/connect/onboarding', { method: 'POST', body: JSON.stringify({ email }) }); window.location.assign(url); }),
    disconnect: () => run('disconnect', async () => { await call('/disconnect', { method: 'POST' }); await refresh(); }),
    sync: () => run('sync', async () => { setState(await call<StripeState>('/sync', { method: 'POST' })); reload(); }),
    collect: (invoiceId, sendEmail) => run(`collect:${invoiceId}`, async () => {
      const r = await call<{ link: StripeInvoiceLink }>(`/invoices/${encodeURIComponent(invoiceId)}/collect`, { method: 'POST', body: JSON.stringify({ sendEmail }), idempotencyKey: key() });
      setState((s) => (s ? { ...s, invoices: { ...s.invoices, [invoiceId]: r.link } } : s));
      reload();
      return r.link;
    }),
    sendViaStripe: (invoiceId) => run(`send:${invoiceId}`, async () => {
      const r = await call<{ link: StripeInvoiceLink }>(`/invoices/${encodeURIComponent(invoiceId)}/send`, { method: 'POST' });
      setState((s) => (s ? { ...s, invoices: { ...s.invoices, [invoiceId]: r.link } } : s));
      return r.link;
    }),
    createSubscription: (input) => run('subscribe', async () => {
      const r = await call<{ subscription: CrmSubscription }>('/subscriptions', { method: 'POST', body: JSON.stringify({ subscription: input }), idempotencyKey: key() });
      setState((s) => (s ? { ...s, subscriptions: [r.subscription, ...s.subscriptions.filter((x) => x.id !== r.subscription.id)] } : s));
      return r.subscription;
    }),
    updateSubscription: (id, action) => run(`sub:${id}`, async () => {
      const r = await call<{ subscription: CrmSubscription }>(`/subscriptions/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ action }) });
      setState((s) => (s ? { ...s, subscriptions: s.subscriptions.map((x) => (x.id === id ? r.subscription : x)) } : s));
      return r.subscription;
    }),
  };
  return <StripeCtx.Provider value={value}>{children}</StripeCtx.Provider>;
}

export function useStripe(): Ctx {
  const v = useContext(StripeCtx);
  if (!v) throw new Error('useStripe must be used inside StripeProvider');
  return v;
}
