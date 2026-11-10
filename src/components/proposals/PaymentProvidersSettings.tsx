import React, { useState, useEffect } from 'react';
import { 
  CreditCard, CheckCircle2, AlertCircle, RefreshCw, 
  ExternalLink, Unplug, ShieldCheck, Zap, ArrowRight,
  Lock, Building2, Store, DollarSign, Clock, Check
} from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard';

export interface ProviderAccountStatus {
  provider: 'stripe' | 'square';
  accountId: string;
  businessName: string;
  email?: string;
  connected: boolean;
  environment: 'sandbox' | 'production';
  connectedAt?: string;
  /** False when this server has no keys for the provider (connecting is then unavailable). */
  configured?: boolean;
}

interface PaymentProvidersSettingsProps {
  onGoToCreateInvoice?: () => void;
}

export default function PaymentProvidersSettings({ onGoToCreateInvoice }: PaymentProvidersSettingsProps) {
  const [providers, setProviders] = useState<{
    stripe: ProviderAccountStatus;
    square: ProviderAccountStatus;
  }>({
    stripe: {
      provider: 'stripe',
      accountId: '',
      businessName: '',
      connected: false,
      environment: 'sandbox'
    },
    square: {
      provider: 'square',
      accountId: '',
      businessName: '',
      connected: false,
      environment: 'sandbox'
    }
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/integrations/status');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.providers) {
        setProviders(prev => ({ ...prev, ...data.providers }));
      } else if (!res.ok) {
        showToast(data.error || 'Couldn’t load payment providers.', 'error');
      }
    } catch {
      showToast('Couldn’t reach the server. Check your connection.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    // Check query params for callback notice
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connected')) {
      const provider = urlParams.get('connected');
      showToast(`${provider === 'square' ? 'Square' : 'Stripe'} connected.`, 'success');
      // Clean query params
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('error')) {
      showToast(`Connection failed: ${urlParams.get('error')}`, 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleConnect = async (provider: 'stripe' | 'square') => {
    setActionLoading(`connect_${provider}`);
    try {
      const res = await fetch(`/api/integrations/${provider}/connect?format=json`, { headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.authUrl) {
        window.location.href = data.authUrl;
        return;
      }
      throw new Error(data.error || 'Couldn’t start the connection. Try again.');
    } catch (err: any) {
      showToast(err.message, 'error');
      setActionLoading(null);
    }
  };

  const handleDisconnect = async (provider: 'stripe' | 'square') => {
    if (!confirm(`Are you sure you want to disconnect ${provider.toUpperCase()}? You will need to reconnect to issue invoices through this provider.`)) {
      return;
    }

    setActionLoading(`disconnect_${provider}`);
    try {
      const res = await fetch(`/api/integrations/${provider}/disconnect`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        showToast(`${provider.toUpperCase()} disconnected.`, 'info');
        await fetchStatus();
      } else {
        throw new Error(data.error || 'Disconnect failed');
      }
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCopyWebhookUrl = async (provider: string) => {
    const url = `${window.location.origin}/api/webhooks/${provider}`;
    const success = await copyToClipboard(url);
    if (success) {
      setCopiedKey(provider);
      setTimeout(() => setCopiedKey(null), 2000);
      showToast(`${provider.toUpperCase()} webhook endpoint copied!`, 'info');
    }
  };

  return (
    <div className="space-y-6 max-w-[1340px] mx-auto py-2 animate-in fade-in duration-200">
      {/* Toast Alert */}
      {toastMessage && (
        <div 
          className={`fixed top-6 right-6 z-50 py-3 px-4 rounded-xl shadow-lg border flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-top-4 duration-200 ${
            toastMessage.type === 'success' 
              ? 'bg-emerald-900 text-white border-emerald-800' 
              : toastMessage.type === 'error'
                ? 'bg-rose-900 text-white border-rose-800'
                : 'bg-slate-900 text-white border-slate-800'
          }`}
        >
          {toastMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : toastMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <Zap className="w-4 h-4 text-indigo-400 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Payment Providers</h1>
          <p className="text-xs text-slate-500 font-medium">Connect your existing Stripe or Square accounts to issue and collect client invoices directly.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading}
            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold px-3 py-2 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync Status</span>
          </button>

          {onGoToCreateInvoice && (
            <button
              type="button"
              onClick={onGoToCreateInvoice}
              className="bg-black hover:bg-slate-800 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all cursor-pointer flex items-center gap-2 shadow-sm"
            >
              <span>Create Invoice</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Security Architecture Guarantee Card */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900">Zero-Secret Security Architecture</h4>
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-2xl">
              We never ask for or store your Stripe Secret Key or Square Access Token. Connection occurs exclusively via OAuth 2.0. Provider credentials are encrypted at rest with AES-256-GCM and never exposed to the client browser.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <span className="text-[10px] font-mono bg-white border border-slate-200 px-2 py-1 rounded-md text-slate-600 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-600" />
            <span>AES-256-GCM Encrypted</span>
          </span>
          <span className="text-[10px] font-mono bg-white border border-slate-200 px-2 py-1 rounded-md text-slate-600">
            CSRF Nonce Verified
          </span>
        </div>
      </div>

      {/* PROVIDERS GRID (STRIPE & SQUARE) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* ======================================================== */}
        {/* STRIPE CARD                                              */}
        {/* ======================================================== */}
        <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-7 shadow-xs flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            {/* Header with Logo and Status Badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-[#635bff]/10 border border-[#635bff]/20 flex items-center justify-center shrink-0">
                  <span className="text-lg font-black text-[#635bff]">S</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-slate-900">Stripe</h3>
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                      {providers.stripe.configured === false ? 'Not set up' : providers.stripe.environment === 'production' ? 'Live' : 'Test mode'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-medium">Stripe Connect and hosted invoices</p>
                </div>
              </div>

              {providers.stripe.connected ? (
                <div className="flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Status: Connected ✓</span>
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500">Mode: {providers.stripe.environment === 'production' ? 'Live' : 'Test'}</span>
                </div>
              ) : (
                <div className="flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    <span>Status: Not Connected</span>
                  </span>
                  <span className="text-[10px] font-semibold text-slate-500">Mode: {providers.stripe.environment === 'production' ? 'Live' : 'Test'}</span>
                </div>
              )}
            </div>

            {/* Description & Capabilities */}
            <p className="text-xs text-slate-500 leading-relaxed">
              Issue global professional invoices with automatic tax, recurring schedules, and test checkout via Credit Cards, Apple Pay, Google Pay, and bank debits.
            </p>

            {/* Test Card Instructions (Stripe's documented test card; only relevant in test mode) */}
            {providers.stripe.environment !== 'production' && <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-900 text-[11px] flex items-center gap-1">
                  <CreditCard className="w-3 h-3 text-amber-700" />
                  <span>Stripe Official Test Card</span>
                </span>
                <span className="text-[10px] text-amber-700 font-mono font-semibold">Test Mode Only</span>
              </div>
              <p className="text-[11px] text-amber-800">
                Number: <code className="bg-white/80 px-1.5 py-0.5 rounded border border-amber-200 text-slate-900 font-mono font-bold">4242 4242 4242 4242</code> &bull; Exp: Any future date &bull; CVC: 123
              </p>
            </div>}

            {/* Connected Details Block */}
            {providers.stripe.connected ? (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium">Business:</span>
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>{providers.stripe.businessName || '—'}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium">Account ID:</span>
                  <span className="font-mono text-slate-700 text-[11px]">{providers.stripe.accountId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium">Environment:</span>
                  <span className="text-slate-700 font-medium capitalize bg-white px-2 py-0.5 rounded border border-slate-200/80 text-[10px]">
                    {providers.stripe.environment}
                  </span>
                </div>
                {providers.stripe.connectedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Connected On:</span>
                    <span className="text-slate-600 text-[11px]">
                      {new Date(providers.stripe.connectedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5 text-xs">
                <p className="font-semibold text-slate-700">What happens when you connect?</p>
                <ul className="space-y-1 text-slate-500 text-[11px] list-disc list-inside">
                  <li>Client payments settle straight into your verified bank account</li>
                  <li>Invoices are cryptographically finalized with hosted payment links</li>
                  <li>Webhooks track paid statuses in real-time</li>
                </ul>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-2">
            {providers.stripe.connected ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleDisconnect('stripe')}
                  disabled={actionLoading === 'disconnect_stripe'}
                  className="flex-1 bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 border border-slate-200 hover:border-rose-200 text-xs font-bold py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Unplug className="w-3.5 h-3.5" />
                  <span>{actionLoading === 'disconnect_stripe' ? 'Disconnecting...' : 'Disconnect'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleCopyWebhookUrl('stripe')}
                  className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl transition-colors cursor-pointer"
                  title="Copy Stripe Webhook URL"
                >
                  {copiedKey === 'stripe' ? <Check className="w-4 h-4 text-emerald-600" /> : <ExternalLink className="w-4 h-4" />}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleConnect('stripe')}
                disabled={actionLoading === 'connect_stripe' || providers.stripe.configured === false}
                title={providers.stripe.configured === false ? 'Stripe isn’t set up on this server yet. An administrator adds the Stripe keys.' : undefined}
                className="w-full bg-[#635bff] hover:bg-[#5346e0] text-white text-xs font-bold py-3 rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-xs"
              >
                <Zap className="w-4 h-4" />
                <span>{providers.stripe.configured === false ? 'Stripe isn’t set up on this server' : actionLoading === 'connect_stripe' ? 'Redirecting to Stripe…' : 'Connect Stripe'}</span>
              </button>
            )}
          </div>
        </div>

        {/* ======================================================== */}
        {/* SQUARE CARD                                              */}
        {/* ======================================================== */}
        <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-7 shadow-xs flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            {/* Header with Logo and Status Badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-black/5 border border-black/10 flex items-center justify-center shrink-0">
                  <div className="w-6 h-6 border-2 border-black rounded-md flex items-center justify-center">
                    <div className="w-2.5 h-2.5 bg-black rounded-xs" />
                  </div>
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">Square</h3>
                  <p className="text-xs text-slate-400 font-medium">Square Orders & Invoice Publishing</p>
                </div>
              </div>

              {providers.square.connected ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Connected ✓</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <span>Not connected</span>
                </span>
              )}
            </div>

            {/* Description & Capabilities */}
            <p className="text-xs text-slate-500 leading-relaxed">
              Create Square Orders and published Invoices. Enable clients to pay seamlessly through Square's hosted checkout portal with instant merchant settlement.
            </p>

            {/* Connected Details Block */}
            {providers.square.connected ? (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium">Business:</span>
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-slate-500" />
                    <span>{providers.square.businessName || '—'}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium">Merchant ID:</span>
                  <span className="font-mono text-slate-700 text-[11px]">{providers.square.accountId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-medium">Environment:</span>
                  <span className="text-slate-700 font-medium capitalize bg-white px-2 py-0.5 rounded border border-slate-200/80 text-[10px]">
                    {providers.square.environment}
                  </span>
                </div>
                {providers.square.connectedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Connected On:</span>
                    <span className="text-slate-600 text-[11px]">
                      {new Date(providers.square.connectedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5 text-xs">
                <p className="font-semibold text-slate-700">Square Architecture Protocol</p>
                <ul className="space-y-1 text-slate-500 text-[11px] list-disc list-inside">
                  <li>Line items generate a linked Square Order via the Orders API</li>
                  <li>Invoices publish directly to customer emails with hosted URLs</li>
                  <li>Real-time webhook signature verification and idempotent sync</li>
                </ul>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-2">
            {providers.square.connected ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleDisconnect('square')}
                  disabled={actionLoading === 'disconnect_square'}
                  className="flex-1 bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 border border-slate-200 hover:border-rose-200 text-xs font-bold py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Unplug className="w-3.5 h-3.5" />
                  <span>{actionLoading === 'disconnect_square' ? 'Disconnecting...' : 'Disconnect'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleCopyWebhookUrl('square')}
                  className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl transition-colors cursor-pointer"
                  title="Copy Square Webhook URL"
                >
                  {copiedKey === 'square' ? <Check className="w-4 h-4 text-emerald-600" /> : <ExternalLink className="w-4 h-4" />}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleConnect('square')}
                disabled={actionLoading === 'connect_square' || providers.square.configured === false}
                title={providers.square.configured === false ? 'Square isn’t set up on this server yet. An administrator adds the Square keys.' : undefined}
                className="w-full bg-black hover:bg-slate-800 text-white text-xs font-bold py-3 rounded-2xl transition-all cursor-pointer flex items-center justify-center gap-2 shadow-xs"
              >
                <Zap className="w-4 h-4 text-amber-400" />
                <span>{providers.square.configured === false ? 'Square isn’t set up on this server' : actionLoading === 'connect_square' ? 'Redirecting to Square…' : 'Connect Square'}</span>
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Webhook Endpoints & Development Testing Panel */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-7 shadow-xs space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Webhook Endpoints & Idempotency Setup</h3>
          <p className="text-xs text-slate-400 font-medium">
            Configure these webhook listener endpoints in your Stripe Dashboard or Square Developer Portal for real-time status synchronization.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-sans font-bold">Stripe Webhook</p>
              <p className="text-slate-800 mt-0.5 truncate max-w-xs">{window.location.origin}/api/webhooks/stripe</p>
            </div>
            <button
              type="button"
              onClick={() => handleCopyWebhookUrl('stripe')}
              className="text-slate-500 hover:text-black font-sans font-semibold text-xs px-2.5 py-1 bg-white border border-slate-200 rounded-lg cursor-pointer"
            >
              {copiedKey === 'stripe' ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-sans font-bold">Square Webhook</p>
              <p className="text-slate-800 mt-0.5 truncate max-w-xs">{window.location.origin}/api/webhooks/square</p>
            </div>
            <button
              type="button"
              onClick={() => handleCopyWebhookUrl('square')}
              className="text-slate-500 hover:text-black font-sans font-semibold text-xs px-2.5 py-1 bg-white border border-slate-200 rounded-lg cursor-pointer"
            >
              {copiedKey === 'square' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
