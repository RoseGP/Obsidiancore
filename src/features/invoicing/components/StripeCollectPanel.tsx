/**
 * "Collect with Stripe" on the invoice page: creates a Stripe invoice from this CRM invoice (amounts come from
 * the stored invoice on the server), and finalizes + emails it only when the user confirms. Shows the Stripe
 * status, identifiers, pay link and any payment failure; webhooks keep it current, "Refresh" re-reads Stripe.
 *
 * States: loading · couldn't load · Stripe not set up on the server · not connected · can't collect yet (reason)
 * · ready to create · draft · open (sent) · payment failed / action required · paid · void.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, ExternalLink, FileText, RefreshCw, Send, Trash2, Ban, Copy } from 'lucide-react';
import { formatMoney } from '../domain/money';
import { formatDateTime } from '../domain/status';
import { ConfirmDialog, useToast } from '../ui/overlays';
import { Badge, Button, InlineAlert } from '../ui/primitives';

type StripeStatus = 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
interface ProviderInvoice {
  id: string; status: StripeStatus; provider_invoice_id: string; provider_customer_id?: string; provider_account_id?: string;
  currency: string; total: number; amount_due_minor?: number; amount_paid_minor?: number; hosted_invoice_url?: string; invoice_pdf_url?: string;
  payment_failure?: { message: string; at: string } | null; action_required?: boolean;
  finalized_at?: string; sent_at?: string; paid_at?: string; voided_at?: string; created_at: string; updated_at: string;
}
interface StripeState {
  configured: boolean; mode: 'test' | 'live' | 'unknown';
  account: { connected: boolean; accountId: string; businessName: string; email?: string };
  invoices: ProviderInvoice[]; blocker: string | null; balanceDue: string; currency: string;
}

const STATUS: Record<StripeStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft in Stripe', tone: 'draft' },
  open: { label: 'Sent · awaiting payment', tone: 'sent' },
  paid: { label: 'Paid in Stripe', tone: 'paid' },
  uncollectible: { label: 'Uncollectible', tone: 'overdue' },
  void: { label: 'Void', tone: 'void' },
};
const CONNECT_URL = '/?view=proposals&subtab=payment_providers';

async function call<T>(method: 'GET' | 'POST', url: string): Promise<T> {
  const res = await fetch(url, { method, headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw Object.assign(new Error(data.error || 'Stripe request failed. Try again.'), { code: data.code, status: res.status });
  return data as T;
}

function IdRow({ label, value }: { label: string; value?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <>
      <dt className="inv-muted">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1">
        <code className="truncate text-[11.5px]" title={value}>{value}</code>
        <button type="button" className="inv-btn inv-btn-ghost inv-btn-sm inv-btn-icon" aria-label={`Copy ${label}`} title={copied ? 'Copied' : 'Copy'}
          onClick={() => { navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>
          <Copy size={13} aria-hidden />
        </button>
      </dd>
    </>
  );
}

/** `onCrmChanged`: reload the CRM invoice after Stripe changed it (sent, paid). */
export function StripeCollectPanel({ billingInvoiceId, onCrmChanged }: { billingInvoiceId: string; onCrmChanged?: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<StripeState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'send' | 'resend' | 'void' | 'discard'>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try { setState(await call<StripeState>('GET', `/api/integrations/stripe/billing-invoices/${encodeURIComponent(billingInvoiceId)}`)); }
    catch (e: any) { setLoadError(e.status === 403 ? 'Your role can’t view billing.' : e.message); }
  }, [billingInvoiceId]);
  useEffect(() => { setState(null); void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, success: { title: string; body?: string }, alsoReloadCrm = false) => {
    setBusy(key);
    try {
      await fn();
      toast({ tone: 'success', ...success });
      await load();
      if (alsoReloadCrm) onCrmChanged?.();
    } catch (e: any) {
      toast({ tone: 'error', title: 'Stripe didn’t complete this', body: e.message });
      await load();
    } finally { setBusy(null); setConfirm(null); }
  };

  const live = state?.invoices.find((i) => i.status === 'draft' || i.status === 'open' || i.status === 'uncollectible');
  const latest = live ?? state?.invoices[0];
  const older = state?.invoices.filter((i) => i.id !== latest?.id) ?? [];
  const money = (minor?: number, currency?: string) => (typeof minor === 'number' ? formatMoney(BigInt(minor), (currency || state?.currency || 'USD').toUpperCase()) : '—');

  return (
    <section className="inv-card" aria-labelledby="stripe-panel-title" aria-busy={!state && !loadError}>
      <h2 id="stripe-panel-title" className="inv-h3 flex items-center gap-2 px-4 pt-4 pb-2">
        <CreditCard size={15} aria-hidden /> Collect with Stripe
        {state?.mode === 'test' && <span className="inv-pill" title="Uses your Stripe test keys: no real money moves">Test mode</span>}
      </h2>
      <div className="space-y-3 px-4 pb-4 text-[13px]">
        {!state && !loadError && <p className="inv-muted" role="status">Checking Stripe…</p>}

        {loadError && (
          <InlineAlert tone="danger" title="Couldn’t load the Stripe status" action={<Button size="sm" onClick={() => void load()}>Retry</Button>}>
            <span className="text-[12.5px]">{loadError}</span>
          </InlineAlert>
        )}

        {state && !state.configured && (
          <InlineAlert tone="info" title="Stripe isn’t set up on this server">
            <span className="text-[12.5px]">An administrator adds the Stripe platform keys (see docs/invoicing/STRIPE.md). Until then you can still send the invoice by email.</span>
          </InlineAlert>
        )}

        {state && state.configured && !state.account.connected && (
          <div className="space-y-2">
            <p className="inv-muted">Connect your organization’s Stripe account to email this invoice with a secure pay link. Payments mark it paid here automatically.</p>
            <Button icon={<ExternalLink size={15} />} onClick={() => { window.location.href = CONNECT_URL; }}>Connect Stripe</Button>
            {latest && <p className="inv-faint text-[12px]">Earlier Stripe invoice {latest.provider_invoice_id} is kept below for reference.</p>}
          </div>
        )}

        {state && state.configured && state.account.connected && (
          <p className="inv-faint text-[12px]">Connected: {state.account.businessName || state.account.email || state.account.accountId}</p>
        )}

        {state && state.configured && state.account.connected && !live && (
          state.blocker ? (
            <InlineAlert tone="warning" title="Can’t collect this invoice with Stripe yet"><span className="text-[12.5px]">{state.blocker}</span></InlineAlert>
          ) : (
            <div className="space-y-2">
              <p className="inv-muted">Creates a <strong>draft</strong> Stripe invoice for {money(Number(state.balanceDue), state.currency)} with these line items, tax, discount and fees. Nothing is emailed until you send it.</p>
              <Button variant="primary" loading={busy === 'create'} icon={<FileText size={15} />}
                onClick={() => run('create', () => call('POST', `/api/integrations/stripe/billing-invoices/${encodeURIComponent(billingInvoiceId)}`), { title: 'Stripe draft created', body: 'Review it, then finalize and email it.' })}>
                Create Stripe invoice
              </Button>
            </div>
          )
        )}

        {latest && (
          <div className="space-y-2.5">
            <p className="flex items-center justify-between gap-2"><Badge tone={STATUS[latest.status].tone}>{STATUS[latest.status].label}</Badge>
              <span className="num font-semibold">{money(latest.status === 'paid' ? latest.amount_paid_minor : latest.amount_due_minor, latest.currency)}</span></p>

            {latest.payment_failure && latest.status !== 'paid' && (
              <InlineAlert tone="danger" title="Payment failed"><span className="text-[12.5px]">{latest.payment_failure.message} ({formatDateTime(latest.payment_failure.at)})</span></InlineAlert>
            )}
            {latest.action_required && latest.status === 'open' && (
              <InlineAlert tone="warning" title="The customer needs to confirm the payment"><span className="text-[12.5px]">Their bank asked for an extra step. They can finish it from the payment page.</span></InlineAlert>
            )}

            <dl className="num grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
              <IdRow label="Stripe invoice" value={latest.provider_invoice_id} />
              <IdRow label="Stripe customer" value={latest.provider_customer_id} />
              {latest.sent_at && <><dt className="inv-muted">Emailed</dt><dd className="text-right">{formatDateTime(latest.sent_at)}</dd></>}
              {latest.paid_at && <><dt className="inv-muted">Paid</dt><dd className="text-right">{formatDateTime(latest.paid_at)}</dd></>}
              {latest.voided_at && <><dt className="inv-muted">Voided</dt><dd className="text-right">{formatDateTime(latest.voided_at)}</dd></>}
              <dt className="inv-muted">Updated</dt><dd className="text-right">{formatDateTime(latest.updated_at)}</dd>
            </dl>

            {(latest.hosted_invoice_url || latest.invoice_pdf_url) && (
              <p className="flex flex-wrap gap-3 text-[12.5px]">
                {latest.hosted_invoice_url && <a className="inv-link inline-flex items-center gap-1" href={latest.hosted_invoice_url} target="_blank" rel="noopener noreferrer">Payment page <ExternalLink size={12} aria-hidden /></a>}
                {latest.invoice_pdf_url && <a className="inv-link inline-flex items-center gap-1" href={latest.invoice_pdf_url} target="_blank" rel="noopener noreferrer">Stripe PDF <ExternalLink size={12} aria-hidden /></a>}
              </p>
            )}

            {state?.account.connected && (
              <div className="grid grid-cols-2 gap-2">
                {latest.status === 'draft' && <>
                  <Button variant="primary" className="col-span-2" icon={<Send size={15} />} loading={busy === 'send'} onClick={() => setConfirm('send')}>Finalize &amp; email via Stripe</Button>
                  <Button variant="ghost" icon={<Trash2 size={15} />} loading={busy === 'discard'} onClick={() => setConfirm('discard')}>Discard draft</Button>
                </>}
                {latest.status === 'open' && <>
                  <Button icon={<Send size={15} />} loading={busy === 'resend'} onClick={() => setConfirm('resend')}>Email again</Button>
                  <Button variant="ghost" icon={<Ban size={15} />} loading={busy === 'void'} onClick={() => setConfirm('void')}>Void</Button>
                </>}
                {latest.status !== 'void' && (
                  <Button variant="ghost" icon={<RefreshCw size={15} />} loading={busy === 'refresh'}
                    onClick={() => run('refresh', () => call('POST', `/api/integrations/invoices/${encodeURIComponent(latest.id)}/refresh`), { title: 'Status refreshed from Stripe' }, true)}>
                    Refresh status
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {older.length > 0 && (
          <details className="text-[12px]">
            <summary className="inv-muted cursor-pointer">Earlier Stripe invoices ({older.length})</summary>
            <ul className="mt-1.5 space-y-1">{older.map((o) => <li key={o.id} className="flex justify-between gap-2"><code className="truncate">{o.provider_invoice_id}</code><span>{STATUS[o.status].label}</span></li>)}</ul>
          </details>
        )}
      </div>

      {latest && (
        <>
          <ConfirmDialog open={confirm === 'send' || confirm === 'resend'} onClose={() => setConfirm(null)} loading={busy === 'send' || busy === 'resend'}
            title={confirm === 'resend' ? 'Email the Stripe invoice again?' : 'Finalize and email this invoice through Stripe?'}
            confirmLabel={confirm === 'resend' ? 'Email again' : 'Finalize & email'}
            body={confirm === 'resend' ? <>Stripe emails the invoice and its payment link to the customer again.</>
              : <>Stripe finalizes the invoice (its amounts can’t change afterwards) and emails it with a payment link{state?.mode === 'test' ? ' (test mode: no real money moves)' : ''}. This CRM invoice is marked as sent.</>}
            onConfirm={() => run(confirm === 'resend' ? 'resend' : 'send', () => call('POST', `/api/integrations/invoices/${encodeURIComponent(latest.id)}/send`), { title: 'Sent through Stripe', body: 'You’ll see the payment here when it arrives.' }, true)} />
          <ConfirmDialog open={confirm === 'void' || confirm === 'discard'} tone="danger" onClose={() => setConfirm(null)} loading={busy === 'void' || busy === 'discard'}
            title={confirm === 'discard' ? 'Discard the Stripe draft?' : 'Void the Stripe invoice?'}
            confirmLabel={confirm === 'discard' ? 'Discard draft' : 'Void in Stripe'}
            body={confirm === 'discard' ? <>The draft is deleted in Stripe. The CRM invoice stays as it is; you can create a new Stripe invoice later.</>
              : <>The customer can no longer pay it through Stripe. The CRM invoice isn’t changed; void it separately if needed.</>}
            onConfirm={() => run(confirm === 'discard' ? 'discard' : 'void', () => call('POST', `/api/integrations/invoices/${encodeURIComponent(latest.id)}/void`), { title: confirm === 'discard' ? 'Stripe draft discarded' : 'Stripe invoice voided' })} />
        </>
      )}
    </section>
  );
}
