/** Subscriptions billed through the business's own Stripe account. */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CreditCard, MoreHorizontal, Plus, Repeat, Search, TrendingUp, Users } from 'lucide-react';
import { CURRENCIES } from '../domain/money';
import { formatDate } from '../domain/status';
import { useBillingData } from '../state/BillingStore';
import { useNav } from '../state/navigation';
import { SUBSCRIPTION_STATUS_LABEL, countsTowardMrr, decimalToMinor, isBillingSubscription, minorToDecimal, monthlyValue, mrrByCurrency, type BillingInterval, type CrmSubscription, type SubscriptionStatus } from '../stripe/model';
import { useStripe } from '../stripe/StripeStore';
import { DataTable, type Column } from '../ui/data';
import { ConfirmDialog, Dialog, Menu, useToast } from '../ui/overlays';
import { Badge, Button, EmptyState, InlineAlert, Input, SectionCard, Select, Skeleton } from '../ui/primitives';

const TONE: Record<SubscriptionStatus, string> = {
  active: 'paid', trialing: 'sent', past_due: 'overdue', unpaid: 'failed', incomplete: 'pending', incomplete_expired: 'void', canceled: 'void', paused: 'draft',
};
const INTERVAL_LABEL: Record<BillingInterval, string> = { week: 'week', month: 'month', quarter: 'quarter', year: 'year' };

const money = (minor: number, currency: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(minorToDecimal(minor, currency))); }
  catch { return `${minorToDecimal(minor, currency)} ${currency}`; }
};

function NewSubscriptionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useBillingData();
  const s = useStripe();
  const toast = useToast();
  const clients = data.clients.filter((c) => !c.archived);
  const [clientId, setClientId] = useState('');
  const [planName, setPlanName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<string>(data.settings.defaultCurrency);
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [quantity, setQuantity] = useState('1');
  const [trialDays, setTrialDays] = useState('0');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const client = clients.find((c) => c.id === clientId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!client) err.client = 'Choose a client.';
    else if (!client.email) err.client = 'This client has no email address. Add one on the Clients page first.';
    if (!planName.trim()) err.planName = 'Name the plan, e.g. “Monthly retainer”.';
    const minor = decimalToMinor(amount, currency);
    if (!minor || minor <= 0) err.amount = `Enter a price above zero, e.g. 250${CURRENCIES.find((c) => c.code === currency)?.decimals ? '.00' : ''}.`;
    const q = Number(quantity); if (!Number.isInteger(q) || q < 1) err.quantity = 'Whole number, 1 or more.';
    const t = Number(trialDays); if (!Number.isInteger(t) || t < 0 || t > 730) err.trialDays = '0 to 730 days.';
    setErrors(err);
    if (Object.keys(err).length) return;
    try {
      const sub = await s.createSubscription({ clientId, planName: planName.trim(), amount, currency, interval, quantity: q, trialDays: t });
      toast({ tone: 'success', title: `${sub.planName} created`, body: `Stripe will email each invoice to ${client!.email}.` });
      setPlanName(''); setAmount(''); setClientId(''); onClose();
    } catch (ex: any) { toast({ tone: 'error', title: 'Subscription not created', body: ex.message }); }
  };

  const minor = decimalToMinor(amount, currency) ?? 0;
  return (
    <Dialog open={open} onClose={onClose} title="New subscription" description="Bills the client automatically through your Stripe account." width={560}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-sub" loading={s.busy === 'subscribe'}>Create subscription</Button></>}>
      <form id="new-sub" onSubmit={submit} className="grid gap-3 @lg:grid-cols-2" noValidate>
        <div className="@lg:col-span-2">
          <Select label="Client" required value={clientId} onChange={setClientId} error={errors.client}
            options={[{ value: '', label: clients.length ? 'Choose a client' : 'No clients yet' }, ...clients.map((c) => ({ value: c.id, label: `${c.company || c.name}${c.email ? ` · ${c.email}` : ' · no email'}` }))]} />
        </div>
        <div className="@lg:col-span-2"><Input label="Plan name" required value={planName} onChange={(e) => setPlanName(e.target.value)} error={errors.planName} placeholder="Monthly retainer" maxLength={120} /></div>
        <Input label="Price" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} placeholder="250.00" />
        <Select label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))} />
        <Select label="Bill every" value={interval} onChange={(v) => setInterval(v as BillingInterval)}
          options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter (3 months)' }, { value: 'year', label: 'Year' }]} />
        <Input label="Quantity" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} error={errors.quantity} />
        <Input label="Free trial (days)" inputMode="numeric" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} error={errors.trialDays} hint="0 = bill from today" />
        <div className="flex items-end">
          <p className="inv-muted text-[13px]">
            {minor > 0 ? <>Client pays <strong className="num">{money(minor * Math.max(1, Number(quantity) || 1), currency)}</strong> per {INTERVAL_LABEL[interval]}.</> : 'Enter a price to see the total.'}
          </p>
        </div>
      </form>
    </Dialog>
  );
}

export function SubscriptionsPage() {
  const s = useStripe();
  const toast = useToast();
  const { navigate } = useNav();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'billing' | 'canceled'>('billing');
  const [confirm, setConfirm] = useState<{ sub: CrmSubscription; action: 'cancel_at_period_end' | 'cancel_now' } | null>(null);

  const subs = s.state?.subscriptions ?? [];
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return subs.filter((x) => (filter === 'all' || (filter === 'billing' ? isBillingSubscription(x) || x.status === 'incomplete' : !isBillingSubscription(x)))
      && (!t || `${x.customerName} ${x.customerEmail} ${x.planName}`.toLowerCase().includes(t)));
  }, [subs, q, filter]);
  const mrr = mrrByCurrency(subs);
  const mrrText = Object.keys(mrr).length ? Object.entries(mrr).map(([c, v]) => money(v, c)).join(' + ') : money(0, 'USD');
  const counts = { active: subs.filter((x) => x.status === 'active').length, trialing: subs.filter((x) => x.status === 'trialing').length, pastDue: subs.filter((x) => x.status === 'past_due' || x.status === 'unpaid').length };

  if (!s.available) {
    return <div className="mx-auto max-w-[900px] p-4 @3xl:p-6"><SectionCard title="Subscriptions"><EmptyState icon={<Repeat size={20} />} title="Subscriptions need the billing server" body={s.unavailableReason} /></SectionCard></div>;
  }
  if (!s.state) return <div className="mx-auto max-w-[1400px] space-y-4 p-4 @3xl:p-6"><Skeleton style={{ height: 110 }} /><Skeleton style={{ height: 320 }} /></div>;

  const connected = s.state.connection.status === 'connected';
  const run = async (fn: () => Promise<unknown>, title: string) => {
    try { await fn(); toast({ tone: 'success', title }); } catch (e: any) { toast({ tone: 'error', title: 'Stripe', body: e.message }); }
  };

  const columns: Column<CrmSubscription>[] = [
    { key: 'customer', header: 'Customer', sortValue: (x) => x.customerName, render: (x) => (
      <span className="block min-w-0"><span className="block truncate font-medium">{x.customerName || '—'}</span><span className="inv-faint block truncate text-[12px]">{x.customerEmail}</span></span>
    ) },
    { key: 'plan', header: 'Plan', sortValue: (x) => x.planName, render: (x) => <span>{x.planName}{x.quantity > 1 && <span className="inv-faint"> × {x.quantity}</span>}</span> },
    { key: 'price', header: 'Price', align: 'right', sortValue: (x) => x.unitAmount * x.quantity, render: (x) => <span className="num font-semibold">{money(x.unitAmount * x.quantity, x.currency)}<span className="inv-faint font-normal"> / {INTERVAL_LABEL[x.interval]}</span></span> },
    { key: 'status', header: 'Status', sortValue: (x) => x.status, render: (x) => (
      <span className="flex flex-wrap items-center gap-1.5"><Badge tone={TONE[x.status]}>{SUBSCRIPTION_STATUS_LABEL[x.status]}</Badge>{x.cancelAtPeriodEnd && x.status !== 'canceled' && <Badge tone="pending">Ends {formatDate(x.currentPeriodEnd?.slice(0, 10))}</Badge>}</span>
    ) },
    { key: 'next', header: 'Next invoice', hideBelow: 'lg', sortValue: (x) => x.currentPeriodEnd ?? '', render: (x) => <span className="num inv-muted">{x.status === 'canceled' || x.cancelAtPeriodEnd ? '—' : x.trialEnd && x.status === 'trialing' ? `Trial ends ${formatDate(x.trialEnd.slice(0, 10))}` : formatDate(x.currentPeriodEnd?.slice(0, 10))}</span> },
    { key: 'mrr', header: 'MRR', align: 'right', hideBelow: 'lg', sortValue: (x) => monthlyValue(x), render: (x) => <span className="num inv-muted">{countsTowardMrr(x) ? money(monthlyValue(x), x.currency) : '—'}</span> },
    { key: 'actions', header: <span className="sr-only-inv">Actions</span>, align: 'right', width: 56, render: (x) => x.status === 'canceled' || x.status === 'incomplete_expired' ? null : (
      <Menu label={`Actions for ${x.planName}`} trigger={(p) => <Button {...p} size="sm" variant="ghost" iconOnly aria-label={`Actions for ${x.planName}`} icon={<MoreHorizontal size={16} />} />}
        items={[
          ...(x.latestInvoiceUrl ? [{ label: 'Open latest invoice', onSelect: () => window.open(x.latestInvoiceUrl!, '_blank', 'noopener') }] : []),
          ...(x.cancelAtPeriodEnd
            ? [{ label: 'Keep subscription', onSelect: () => run(() => s.updateSubscription(x.id, 'resume'), 'Subscription will continue') }]
            : [{ label: 'Cancel at end of period', onSelect: () => setConfirm({ sub: x, action: 'cancel_at_period_end' }) }]),
          { label: 'Cancel now', danger: true, onSelect: () => setConfirm({ sub: x, action: 'cancel_now' }) },
        ]} />
    ) },
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-4 @3xl:p-6">
      {!connected && (
        <InlineAlert tone="warning" title={s.state.connection.status === 'disconnected' ? 'Connect Stripe to start billing subscriptions' : 'Finish Stripe verification to start billing subscriptions'}
          action={<Button size="sm" variant="primary" icon={<CreditCard size={14} />} onClick={() => navigate({ name: 'stripe' })}>Stripe settings</Button>} />
      )}
      <div className="grid grid-cols-2 gap-4 @4xl:grid-cols-4">
        <div className="inv-card p-4"><p className="inv-muted flex items-center gap-1.5 text-[13px]"><TrendingUp size={14} aria-hidden />Monthly recurring revenue</p><p className="num mt-1 text-[22px] font-semibold">{mrrText}</p><p className="inv-faint text-[12px]">active and past due; trials start counting when billed</p></div>
        <div className="inv-card p-4"><p className="inv-muted flex items-center gap-1.5 text-[13px]"><Users size={14} aria-hidden />Active</p><p className="num mt-1 text-[22px] font-semibold">{counts.active}</p><p className="inv-faint text-[12px]">paying subscribers</p></div>
        <div className="inv-card p-4"><p className="inv-muted flex items-center gap-1.5 text-[13px]"><CalendarClock size={14} aria-hidden />In trial</p><p className="num mt-1 text-[22px] font-semibold">{counts.trialing}</p><p className="inv-faint text-[12px]">not billed yet</p></div>
        <div className="inv-card p-4"><p className="inv-muted flex items-center gap-1.5 text-[13px]"><AlertTriangle size={14} aria-hidden />Past due</p><p className="num mt-1 text-[22px] font-semibold" style={{ color: counts.pastDue ? 'var(--inv-danger)' : undefined }}>{counts.pastDue}</p><p className="inv-faint text-[12px]">need follow-up</p></div>
      </div>

      <SectionCard title="Subscriptions" description="Stripe creates and emails each invoice; paid renewals appear on the Invoices page automatically."
        actions={<>
          <Button size="sm" variant="ghost" loading={s.busy === 'sync'} onClick={() => run(s.sync, 'Synced with Stripe')} disabled={s.state.connection.status === 'disconnected'}>Sync</Button>
          <Button size="sm" variant="primary" icon={<Plus size={14} />} disabled={!connected} onClick={() => setOpen(true)}>New subscription</Button>
        </>}
        bodyClassName="p-0">
        <div className="flex flex-wrap items-center gap-2 px-5 py-3" style={{ borderBottom: '1px solid var(--inv-border)' }}>
          <div className="relative min-w-[200px] flex-1">
            <Search size={15} className="inv-faint absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
            <input className="inv-input" style={{ paddingLeft: 34 }} type="search" placeholder="Search customer or plan" aria-label="Search subscriptions" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={filter} onChange={(v) => setFilter(v as any)} inputSize="sm" aria-label="Filter subscriptions"
            options={[{ value: 'billing', label: 'Current' }, { value: 'canceled', label: 'Ended' }, { value: 'all', label: 'All' }]} />
        </div>
        {rows.length ? (
          <DataTable rows={rows} columns={columns} getRowId={(x) => x.id} caption="Subscriptions" resetKey={`${q}|${filter}`} initialSort={{ key: 'customer', dir: 'asc' }} />
        ) : (
          <EmptyState icon={<Repeat size={20} />} title={subs.length ? 'No subscriptions match' : 'No subscriptions yet'}
            body={subs.length ? 'Try a different search or filter.' : 'Set up recurring billing for retainers, memberships or support plans.'}
            action={!subs.length && connected ? <Button variant="primary" icon={<Plus size={15} />} onClick={() => setOpen(true)}>New subscription</Button> : undefined} />
        )}
      </SectionCard>

      <NewSubscriptionDialog open={open} onClose={() => setOpen(false)} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} tone="danger" loading={!!confirm && s.busy === `sub:${confirm.sub.id}`}
        title={confirm?.action === 'cancel_now' ? 'Cancel this subscription now?' : 'Cancel at the end of this period?'}
        confirmLabel={confirm?.action === 'cancel_now' ? 'Cancel now' : 'Cancel at period end'}
        body={confirm?.action === 'cancel_now'
          ? `${confirm.sub.customerName}’s ${confirm.sub.planName} stops immediately and won’t be billed again.`
          : `${confirm?.sub.customerName}’s ${confirm?.sub.planName} runs until ${formatDate(confirm?.sub.currentPeriodEnd?.slice(0, 10))}, then stops. You can undo this until then.`}
        onConfirm={async () => { if (!confirm) return; await run(() => s.updateSubscription(confirm.sub.id, confirm.action), confirm.action === 'cancel_now' ? 'Subscription canceled' : 'Subscription will end at period end'); setConfirm(null); }} />
    </div>
  );
}
