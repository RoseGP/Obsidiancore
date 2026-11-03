import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { uid } from '../domain/factories';
import { buildInvoiceView, todayISO, type InvoiceView } from '../domain/status';
import type { BillingSnapshot, BusinessSettings, Client, Invoice, Payment } from '../domain/types';
import { connectBillingRepository } from '../services/apiRepository';
import type { BillingRepository } from '../services/repository';

type NewPayment = Omit<Payment, 'id' | 'receiptNumber' | 'createdAt' | 'recordedBy' | 'source'>;

interface BillingContextValue {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  repo: BillingRepository | null;
  data: BillingSnapshot | null;
  views: InvoiceView[];
  viewById: Map<string, InvoiceView>;
  today: string;
  reload(): void;
  isPending(key: string): boolean;
  saveInvoice(inv: Invoice): Promise<Invoice>;
  voidInvoice(id: string): Promise<Invoice>;
  markSent(id: string): Promise<Invoice>;
  recordPayment(p: NewPayment): Promise<{ payment: Payment; invoice: Invoice }>;
  saveClient(c: Client): Promise<Client>;
  archiveClient(id: string, archived: boolean): Promise<Client>;
  saveSettings(s: BusinessSettings): Promise<BusinessSettings>;
  resetPrototype(): Promise<void>;
}

const BillingContext = createContext<BillingContextValue | null>(null);

export function BillingProvider({ children, repository }: { children: React.ReactNode; repository?: BillingRepository }) {
  const [repo, setRepo] = useState<BillingRepository | null>(repository ?? null);
  const [data, setData] = useState<BillingSnapshot | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const idemKeys = useRef(new Map<string, string>());
  const [today, setToday] = useState(todayISO());

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const r = repository ?? (await connectBillingRepository());
      setRepo(r);
      const snap = await r.load();
      setData(snap);
      setStatus('ready');
    } catch (e: any) {
      setError(e?.message ?? 'Billing data couldn’t be loaded.');
      setStatus('error');
    }
  }, [repository]);

  useEffect(() => { void load(); }, [load]);

  // Keep "today" fresh so overdue status flips at midnight without reload.
  useEffect(() => {
    const t = setInterval(() => setToday(todayISO()), 60_000);
    return () => clearInterval(t);
  }, []);

  /**
   * Runs a mutation at most once at a time per key. A stable idempotency key is
   * reused across retries of the same logical action, so the server can
   * de-duplicate if a response was lost; it's released only on success.
   */
  const guarded = useCallback(async <T,>(key: string, fn: (idemKey: string) => Promise<T>): Promise<T> => {
    if (inFlight.current.has(key)) throw Object.assign(new Error('Already in progress'), { code: 'duplicate' });
    inFlight.current.add(key);
    setPending((s) => new Set(s).add(key));
    let idemKey = idemKeys.current.get(key);
    if (!idemKey) { idemKey = uid('idem'); idemKeys.current.set(key, idemKey); }
    try {
      const result = await fn(idemKey);
      idemKeys.current.delete(key);
      return result;
    } finally {
      inFlight.current.delete(key);
      setPending((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }, []);

  const upsertInvoice = (inv: Invoice) => setData((d) => d && ({
    ...d, invoices: d.invoices.some((i) => i.id === inv.id) ? d.invoices.map((i) => (i.id === inv.id ? inv : i)) : [...d.invoices, inv],
  }));
  const upsertClient = (c: Client) => setData((d) => d && ({
    ...d, clients: d.clients.some((x) => x.id === c.id) ? d.clients.map((x) => (x.id === c.id ? c : x)) : [...d.clients, c],
  }));

  const views = useMemo(
    () => (data ? data.invoices.map((i) => buildInvoiceView(i, data.payments, today)) : []),
    [data, today],
  );
  const viewById = useMemo(() => new Map(views.map((v) => [v.invoice.id, v])), [views]);

  const value: BillingContextValue = {
    status, error, repo, data, views, viewById, today,
    reload: () => { void load(); },
    isPending: (k) => pending.has(k),
    saveInvoice: (inv) => guarded(`save:${inv.id}`, async (idempotencyKey) => {
      // Content-based key: an unchanged retry is de-duplicated, a new edit is not.
      const saved = await repo!.saveInvoice(inv, { idempotencyKey: `${idempotencyKey}:${inv.version}:${inv.updatedAt}` });
      upsertInvoice(saved);
      return saved;
    }),
    voidInvoice: (id) => guarded(`void:${id}`, async () => { const r = await repo!.voidInvoice(id); upsertInvoice(r); return r; }),
    markSent: (id) => guarded(`marksent:${id}`, async () => { const r = await repo!.markInvoiceSent(id); upsertInvoice(r); return r; }),
    recordPayment: (p) => guarded(`pay:${p.invoiceId}`, async (idempotencyKey) => {
      const r = await repo!.recordPayment(p, { idempotencyKey });
      setData((d) => d && ({ ...d, payments: [...d.payments, r.payment], invoices: d.invoices.map((i) => (i.id === r.invoice.id ? r.invoice : i)) }));
      return r;
    }),
    saveClient: (c) => guarded(`client:${c.id}`, async () => { const r = await repo!.saveClient(c); upsertClient(r); return r; }),
    archiveClient: (id, archived) => guarded(`archive:${id}`, async () => { const r = await repo!.setClientArchived(id, archived); upsertClient(r); return r; }),
    saveSettings: (s) => guarded('settings', async () => { const r = await repo!.saveSettings(s); setData((d) => d && ({ ...d, settings: r })); return r; }),
    resetPrototype: () => guarded('reset', async () => {
      if (!repo?.resetPrototypeData) return;
      const snap = await repo.resetPrototypeData();
      setData(snap);
    }),
  };

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() {
  const ctx = useContext(BillingContext);
  if (!ctx) throw new Error('useBilling must be used inside <BillingProvider>');
  return ctx;
}

/** Data is guaranteed loaded inside pages rendered by the shell. */
export function useBillingData() {
  const ctx = useBilling();
  return { ...ctx, data: ctx.data!, repo: ctx.repo! };
}
