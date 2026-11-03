/** Stripe Connect: connect this business's own Stripe account, see its status, sync and disconnect. */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, CreditCard, ExternalLink, Link2, Link2Off, PlugZap, RefreshCw, ShieldCheck, Store, Webhook } from 'lucide-react';
import { CONNECTION_LABEL, type ConnectionStatus } from '../stripe/model';
import { useStripe } from '../stripe/StripeStore';
import { formatDateTime } from '../domain/status';
import { useNav } from '../state/navigation';
import { ConfirmDialog, useToast } from '../ui/overlays';
import { Badge, Button, EmptyState, InlineAlert, Input, SectionCard, Skeleton } from '../ui/primitives';

const TONE: Record<ConnectionStatus, string> = { connected: 'paid', pending_verification: 'pending', restricted: 'overdue', disconnected: 'draft' };

const RETURN_MESSAGES: Record<string, { tone: 'success' | 'warning' | 'danger' | 'info'; text: string }> = {
  connected: { tone: 'success', text: 'Stripe account connected.' },
  'onboarding-return': { tone: 'info', text: 'Back from Stripe. Your account status is refreshed below.' },
  'onboarding-refresh': { tone: 'warning', text: 'The Stripe onboarding link expired. Continue verification to get a new one.' },
  denied: { tone: 'warning', text: 'You cancelled the Stripe authorization. Nothing was connected.' },
  expired: { tone: 'warning', text: 'The Stripe authorization link expired or was already used. Start again.' },
  'in-use': { tone: 'danger', text: 'That Stripe account is already connected to another workspace. Disconnect it there first, or use a different account.' },
  error: { tone: 'danger', text: 'Stripe couldn’t complete the connection. Try again.' },
};

const EVENTS = ['account.updated', 'account.application.deauthorized', 'invoice.finalized', 'invoice.sent', 'invoice.paid', 'invoice.payment_failed', 'invoice.voided', 'invoice.marked_uncollectible', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="inv-faint text-[12px]">{label}</dt>
      <dd className="mt-0.5 break-words text-[13.5px] font-medium">{children}</dd>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[13px]">
      {ok ? <CheckCircle2 size={15} style={{ color: 'var(--inv-success)', flex: 'none', marginTop: 2 }} aria-label="Done" />
        : <AlertTriangle size={15} style={{ color: 'var(--inv-warning)', flex: 'none', marginTop: 2 }} aria-label="Missing" />}
      <span>{children}</span>
    </li>
  );
}

export function StripePage() {
  const s = useStripe();
  const toast = useToast();
  const { navigate } = useNav();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [onboardEmail, setOnboardEmail] = useState('');
  const [returnMsg, setReturnMsg] = useState<string | null>(null);

  // Returning from Stripe (?stripe=…): show the outcome once, refresh, and tidy the URL.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('stripe');
    if (!r) return;
    setReturnMsg(r);
    s.refresh();
    ['stripe', 'billing'].forEach((k) => p.delete(k));
    const q = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try { await fn(); if (done) toast({ tone: 'success', title: done }); }
    catch (e: any) { toast({ tone: 'error', title: 'Stripe', body: e.message }); }
  };

  if (!s.available) {
    return (
      <div className="mx-auto max-w-[900px] p-4 @3xl:p-6">
        <SectionCard title="Stripe">
          <EmptyState icon={<CreditCard size={20} />} title="Stripe isn’t available in prototype mode" body={s.unavailableReason} />
        </SectionCard>
      </div>
    );
  }
  if (s.status === 'loading' || s.status === 'idle') {
    return <div className="mx-auto max-w-[1100px] space-y-4 p-4 @3xl:p-6"><Skeleton style={{ height: 220 }} /><Skeleton style={{ height: 180 }} /></div>;
  }
  if (s.status === 'error' || !s.state) {
    return (
      <div className="mx-auto max-w-[900px] p-4 @3xl:p-6">
        <SectionCard title="Stripe">
          <EmptyState icon={<AlertTriangle size={20} />} title="Couldn’t load Stripe" body={s.error ?? undefined}
            action={<Button variant="primary" icon={<RefreshCw size={15} />} onClick={() => s.refresh()}>Try again</Button>} />
        </SectionCard>
      </div>
    );
  }

  const { setup, connection: c, invoices, subscriptions } = s.state;
  const acc = c.account;
  const isOn = c.status !== 'disconnected';
  const canConnect = setup.apiKey && setup.oauth && setup.stateSecret;
  const canOnboard = setup.apiKey;
  const webhookUrl = `${window.location.origin}/api/billing-stripe/webhook`;
  const links = Object.values(invoices);
  const paidLinks = links.filter((l) => l.status === 'paid').length;
  const msg = returnMsg ? RETURN_MESSAGES[returnMsg] : null;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 p-4 @3xl:p-6">
      {msg && <InlineAlert tone={msg.tone} title={msg.text} action={<Button size="sm" variant="ghost" onClick={() => setReturnMsg(null)}>Dismiss</Button>} />}

      <SectionCard
        title={<span className="flex items-center gap-2">Stripe account <Badge tone={TONE[c.status]}>{CONNECTION_LABEL[c.status]}</Badge>{acc && !acc.livemode && isOn && <Badge tone="draft">Test mode</Badge>}</span>}
        description="Payments go straight to your own Stripe account. This workspace never sees your Stripe password or keys."
        actions={isOn ? (
          <>
            <Button size="sm" icon={<RefreshCw size={14} />} loading={s.busy === 'sync'} onClick={() => act(s.sync, 'Synced with Stripe')}>Sync now</Button>
            <Button size="sm" variant="ghost" icon={<Link2Off size={14} />} onClick={() => setConfirmDisconnect(true)}>Disconnect</Button>
          </>
        ) : undefined}>
        {isOn && acc ? (
          <div className="space-y-4">
            {c.status === 'pending_verification' && (
              <InlineAlert tone="warning" title="Stripe needs more details before you can take payments"
                action={c.method === 'onboarding'
                  ? <Button size="sm" variant="primary" icon={<ExternalLink size={14} />} loading={s.busy === 'onboarding'} onClick={() => act(() => s.startOnboarding())}>Continue verification</Button>
                  : <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => window.open('https://dashboard.stripe.com/account/onboarding', '_blank', 'noopener')}>Open Stripe</Button>}>
                {acc.requirementsDue.length ? <>Still needed: {acc.requirementsDue.map((r) => r.replace(/[._]/g, ' ')).join(', ')}.</> : 'Stripe is reviewing your details.'}
              </InlineAlert>
            )}
            {c.status === 'restricted' && (
              <InlineAlert tone="danger" title="Stripe has restricted this account">
                Reason: {acc.disabledReason?.replace(/[._]/g, ' ') ?? 'not given'}. Resolve it in your Stripe Dashboard, then sync.
              </InlineAlert>
            )}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 @2xl:grid-cols-4">
              <Fact label="Business">{acc.businessName}</Fact>
              <Fact label="Account ID"><span className="num">{acc.accountId}</span></Fact>
              <Fact label="Email">{acc.email || '—'}</Fact>
              <Fact label="Country · currency">{[acc.country, acc.defaultCurrency].filter(Boolean).join(' · ') || '—'}</Fact>
              <Fact label="Card payments">{acc.chargesEnabled ? 'Enabled' : 'Not yet'}</Fact>
              <Fact label="Payouts">{acc.payoutsEnabled ? 'Enabled' : 'Not yet'}</Fact>
              <Fact label="Connected">{c.connectedAt ? formatDateTime(c.connectedAt) : '—'}{c.method && <span className="inv-faint"> · {c.method === 'oauth' ? 'existing account' : 'new account'}</span>}</Fact>
              <Fact label="Last sync">{c.lastSyncAt ? formatDateTime(c.lastSyncAt) : 'Never'}</Fact>
            </dl>
          </div>
        ) : (
          <div className="space-y-4">
            {acc && c.disconnectedAt && (
              <InlineAlert tone="info" title={`Disconnected from ${acc.businessName} on ${formatDateTime(c.disconnectedAt)}`}>
                Reconnect the same account to pick up where you left off. Payment links already sent stay payable in Stripe.
              </InlineAlert>
            )}
            <div className="grid gap-4 @2xl:grid-cols-2">
              <div className="inv-card flex flex-col gap-3 p-4">
                <div className="flex items-center gap-2"><Link2 size={17} aria-hidden /><h3 className="inv-h3">I already have a Stripe account</h3></div>
                <p className="inv-muted text-[13px]">Sign in to Stripe and approve the connection. You stay in control of the account and can revoke access from Stripe at any time.</p>
                <div className="mt-auto"><Button variant="primary" icon={<PlugZap size={15} />} disabled={!canConnect} loading={s.busy === 'connect'}
                  onClick={() => act(s.connectOAuth)}>{acc ? 'Reconnect Stripe' : 'Connect with Stripe'}</Button></div>
              </div>
              <div className="inv-card flex flex-col gap-3 p-4">
                <div className="flex items-center gap-2"><Store size={17} aria-hidden /><h3 className="inv-h3">Create a new Stripe account</h3></div>
                <p className="inv-muted text-[13px]">Stripe walks you through verifying your business and adding a bank account. It takes about 10 minutes.</p>
                <Input label="Business email (optional)" type="email" value={onboardEmail} onChange={(e) => setOnboardEmail(e.target.value)} placeholder="billing@yourcompany.com" />
                <div className="mt-auto"><Button icon={<ExternalLink size={15} />} disabled={!canOnboard} loading={s.busy === 'onboarding'}
                  onClick={() => act(() => s.startOnboarding(onboardEmail.trim()))}>Start Stripe onboarding</Button></div>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      {isOn && (
        <div className="grid gap-4 @2xl:grid-cols-3">
          <button type="button" className="inv-card p-4 text-left" style={{ font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => navigate({ name: 'invoices' })}>
            <p className="inv-muted text-[13px]">Payment links</p>
            <p className="num mt-1 text-[24px] font-semibold">{links.length}</p>
            <p className="inv-faint text-[12px]">{paidLinks} paid through Stripe</p>
          </button>
          <button type="button" className="inv-card p-4 text-left" style={{ font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => navigate({ name: 'subscriptions' })}>
            <p className="inv-muted text-[13px]">Subscriptions</p>
            <p className="num mt-1 text-[24px] font-semibold">{subscriptions.filter((x) => ['active', 'trialing', 'past_due'].includes(x.status)).length}</p>
            <p className="inv-faint text-[12px]">billing now</p>
          </button>
          <div className="inv-card p-4">
            <p className="inv-muted text-[13px]">Last Stripe event</p>
            <p className="mt-1 text-[16px] font-semibold">{c.lastWebhookAt ? formatDateTime(c.lastWebhookAt) : 'None yet'}</p>
            <p className="inv-faint text-[12px]">{setup.webhook ? 'Webhook signing secret set' : 'Webhook not set up'}</p>
          </div>
        </div>
      )}

      <SectionCard title={<span className="flex items-center gap-2"><Webhook size={16} aria-hidden />Real-time updates</span>}
        description="Stripe tells the CRM when invoices are paid, accounts are verified and subscriptions change.">
        <div className="space-y-3 text-[13px]">
          <p>In your <strong>platform’s</strong> Stripe Dashboard, add a <strong>Connect</strong> webhook endpoint (“Events on connected accounts”):</p>
          <div className="flex gap-2">
            <input readOnly className="inv-input num min-w-0 flex-1" value={webhookUrl} aria-label="Webhook endpoint URL" onFocus={(e) => e.currentTarget.select()} />
            <Button icon={<Copy size={14} />} onClick={() => navigator.clipboard.writeText(webhookUrl).then(() => toast({ tone: 'success', title: 'Endpoint copied' })).catch(() => toast({ tone: 'error', title: 'Couldn’t copy', body: 'Select the URL instead.' }))}>Copy</Button>
          </div>
          <p className="inv-muted">Send these events: <span className="num">{EVENTS.join(', ')}</span>. Then put the endpoint’s signing secret in <span className="num">STRIPE_CONNECT_WEBHOOK_SECRET</span>.</p>
        </div>
      </SectionCard>

      {setup.missing.length > 0 && (
        <SectionCard title={<span className="flex items-center gap-2"><ShieldCheck size={16} aria-hidden />Server setup</span>} description="An administrator sets these once on the server. They’re never sent to the browser.">
          <ul className="space-y-2">
            <Check ok={setup.apiKey}><span className="num">STRIPE_SECRET_KEY</span> — your platform’s secret key (sk_test_… while testing)</Check>
            <Check ok={setup.oauth}><span className="num">STRIPE_CONNECT_CLIENT_ID</span> — Connect → Settings → OAuth client id (ca_…), with redirect URI <span className="num">{window.location.origin}/api/billing-stripe/oauth/callback</span></Check>
            <Check ok={setup.webhook}><span className="num">STRIPE_CONNECT_WEBHOOK_SECRET</span> — signing secret of the Connect webhook above (whsec_…)</Check>
            <Check ok={setup.stateSecret}><span className="num">OAUTH_STATE_SECRET</span> — any long random string; signs the connection link</Check>
            <Check ok={setup.appUrl}><span className="num">APP_URL</span> (recommended) — this app’s public address, used for Stripe redirects</Check>
          </ul>
        </SectionCard>
      )}

      <ConfirmDialog open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} tone="danger" confirmLabel="Disconnect Stripe"
        loading={s.busy === 'disconnect'} title="Disconnect Stripe?"
        body="New payment links and subscriptions will stop until you reconnect. Links already sent stay payable in Stripe, but payments won’t be recorded here while disconnected."
        onConfirm={() => act(async () => { await s.disconnect(); setConfirmDisconnect(false); }, 'Stripe disconnected')} />
    </div>
  );
}
