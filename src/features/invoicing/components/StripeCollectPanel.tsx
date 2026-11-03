/** "Collect with Stripe" on an invoice: payment link on the business's own Stripe account. */
import React from 'react';
import { Copy, CreditCard, ExternalLink, FileDown, Mail, RefreshCw } from 'lucide-react';
import type { InvoiceView } from '../domain/status';
import { formatDateTime } from '../domain/status';
import { useNav } from '../state/navigation';
import { formatMoney } from '../domain/money';
import { useStripe } from '../stripe/StripeStore';
import { useToast } from '../ui/overlays';
import { Badge, Button } from '../ui/primitives';

const LINK_TONE = { draft: 'draft', open: 'sent', paid: 'paid', uncollectible: 'overdue', void: 'void' } as const;
const LINK_LABEL = { draft: 'Draft in Stripe', open: 'Awaiting payment', paid: 'Paid in Stripe', uncollectible: 'Uncollectible', void: 'Void in Stripe' } as const;

export function StripeCollectPanel({ view }: { view: InvoiceView }) {
  const s = useStripe();
  const toast = useToast();
  const { navigate } = useNav();
  if (!s.available || !s.state) return null;
  const inv = view.invoice;
  const link = s.state.invoices[inv.id];
  const conn = s.state.connection;
  const balance = view.totals.balanceDue;
  const busy = s.busy === `collect:${inv.id}` || s.busy === `send:${inv.id}`;
  const outdated = link && link.status === 'open' && (link.crmVersion !== inv.version || link.amountDue !== Number(balance));

  const run = async (fn: () => Promise<unknown>, title: string) => {
    try { await fn(); toast({ tone: 'success', title }); } catch (e: any) { toast({ tone: 'error', title: 'Stripe', body: e.message }); }
  };
  const copy = (url: string) => navigator.clipboard.writeText(url)
    .then(() => toast({ tone: 'success', title: 'Payment link copied' }))
    .catch(() => toast({ tone: 'error', title: 'Couldn’t copy', body: url }));

  return (
    <section className="inv-card" aria-labelledby={`stripe-${inv.id}`}>
      <h2 id={`stripe-${inv.id}`} className="inv-h3 flex items-center gap-2 px-4 pt-4 pb-2">
        <CreditCard size={15} aria-hidden />Collect with Stripe
        {link && <Badge tone={LINK_TONE[link.status]}>{LINK_LABEL[link.status]}</Badge>}
      </h2>
      <div className="space-y-3 px-4 pb-4 text-[13px]">
        {conn.status === 'disconnected' ? (
          <>
            <p className="inv-muted">Connect your Stripe account to let clients pay this invoice by card online.</p>
            <Button size="sm" onClick={() => navigate({ name: 'stripe' })}>Connect Stripe</Button>
          </>
        ) : conn.status !== 'connected' ? (
          <>
            <p className="inv-muted">Stripe is still verifying {conn.account?.businessName ?? 'your account'}. Payment links work once card payments are enabled.</p>
            <Button size="sm" onClick={() => navigate({ name: 'stripe' })}>View Stripe status</Button>
          </>
        ) : inv.lifecycle === 'void' ? (
          <p className="inv-muted">This invoice is void.</p>
        ) : link && link.status === 'paid' ? (
          <p>Paid through Stripe ({formatMoney(BigInt(link.amountPaid), link.currency)}). The payment is recorded below.</p>
        ) : balance <= 0n ? (
          <p className="inv-muted">Nothing left to collect.</p>
        ) : link && link.status === 'open' && !outdated ? (
          <>
            <p className="inv-muted">
              Client can pay {formatMoney(BigInt(link.amountDue), link.currency)} online.{' '}
              {link.sentByStripe ? 'Stripe emailed the invoice.' : 'Share the link, or let Stripe email it.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {link.hostedInvoiceUrl && <Button size="sm" variant="primary" icon={<Copy size={14} />} onClick={() => copy(link.hostedInvoiceUrl!)}>Copy payment link</Button>}
              {link.hostedInvoiceUrl && <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => window.open(link.hostedInvoiceUrl!, '_blank', 'noopener')}>Open</Button>}
              {!link.sentByStripe && <Button size="sm" icon={<Mail size={14} />} loading={s.busy === `send:${inv.id}`} onClick={() => run(() => s.sendViaStripe(inv.id), `Stripe emailed ${inv.billTo.email}`)}>Email via Stripe</Button>}
              {link.invoicePdf && <Button size="sm" variant="ghost" icon={<FileDown size={14} />} onClick={() => window.open(link.invoicePdf!, '_blank', 'noopener')}>Stripe PDF</Button>}
            </div>
            <p className="inv-faint text-[12px]">Updated {formatDateTime(link.updatedAt)} · {link.stripeInvoiceId}</p>
          </>
        ) : (
          <>
            <p className="inv-muted">
              {outdated ? 'This invoice changed since the payment link was made. Create a new link; the old one will be cancelled so the client can’t pay the wrong amount.'
                : `Creates a Stripe invoice for the balance due on ${conn.account?.businessName}’s Stripe account, with a secure payment page.`}
              {inv.lifecycle === 'draft' && ' The invoice will be marked as sent.'}
            </p>
            {!inv.billTo.email && <p style={{ color: 'var(--inv-warning)' }}>Add the client’s email address first.</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" icon={outdated ? <RefreshCw size={14} /> : <CreditCard size={14} />} loading={busy} disabled={!inv.billTo.email}
                onClick={() => run(() => s.collect(inv.id, false), 'Payment link ready')}>{outdated ? 'Create new payment link' : 'Create payment link'}</Button>
              <Button size="sm" icon={<Mail size={14} />} disabled={busy || !inv.billTo.email} onClick={() => run(() => s.collect(inv.id, true), `Stripe emailed ${inv.billTo.email}`)}>Create and email via Stripe</Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
