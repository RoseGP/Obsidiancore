import React, { useState } from 'react';
import {
  CreditCard,
  CheckCircle2,
  Calendar,
  Download,
  ExternalLink,
  ShieldCheck,
  Zap,
  Plus,
  AlertCircle,
  FileText,
  X,
  Check,
  Building,
  Mail,
  ChevronRight,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';

interface Invoice {
  id: string;
  date: string;
  description: string;
  amount: string;
  status: 'paid' | 'pending';
  receiptUrl?: string;
}

const INITIAL_INVOICES: Invoice[] = [
  {
    id: 'INV-2026-004',
    date: 'Oct 15, 2026',
    description: 'Pro Plan · Monthly Subscription',
    amount: '$49.00',
    status: 'paid',
  },
  {
    id: 'INV-2026-003',
    date: 'Sep 15, 2026',
    description: 'Pro Plan · Monthly Subscription',
    amount: '$49.00',
    status: 'paid',
  },
  {
    id: 'INV-2026-002',
    date: 'Aug 15, 2026',
    description: 'Pro Plan · Monthly Subscription',
    amount: '$49.00',
    status: 'paid',
  },
  {
    id: 'INV-2026-001',
    date: 'Jul 15, 2026',
    description: 'Pro Plan · Monthly Subscription',
    amount: '$49.00',
    status: 'paid',
  },
];

type PlanTier = 'starter' | 'pro' | 'enterprise';

interface PlanDetails {
  id: PlanTier;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  description: string;
  features: string[];
  popular?: boolean;
}

const PLANS: PlanDetails[] = [
  {
    id: 'starter',
    name: 'Starter',
    monthlyPrice: 19,
    annualPrice: 15,
    description: 'Ideal for individual creators and solopreneurs managing early social channels.',
    features: [
      '5 Connected Social Channels',
      '250 Scheduled Posts per month',
      '1 Team Member Seat',
      'Standard Queue Engine',
      'Email Support (48h response)',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 49,
    annualPrice: 39,
    popular: true,
    description: 'For growing businesses and agencies needing multi-channel orchestration & AI features.',
    features: [
      '15 Connected Social Channels',
      '1,000 Scheduled Posts per month',
      '10 Team Member Seats & RBAC',
      'AI Content & Image Generator',
      'Real-Time Queue Sync & Worker Monitors',
      'Priority 24/7 SLA Support',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise Core',
    monthlyPrice: 149,
    annualPrice: 119,
    description: 'For global teams, high-volume automation, and custom infrastructure compliance.',
    features: [
      'Unlimited Social Channels',
      'Unlimited Scheduled Posts',
      'Unlimited Team Seats & SSO/SAML',
      'Dedicated SFU Real-Time Voice Nodes',
      'SOC 2 Type II & Custom Data Residency',
      'Dedicated Customer Success Architect',
    ],
  },
];

export default function MurmuraBillingPage() {
  const [currentPlan, setCurrentPlan] = useState<PlanTier>('pro');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [invoices] = useState<Invoice[]>(INITIAL_INVOICES);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isAddPaymentModalOpen, setIsAddPaymentModalOpen] = useState(false);
  const [isChangePlanModalOpen, setIsChangePlanModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Payment method state
  const [paymentMethod, setPaymentMethod] = useState({
    brand: 'Mastercard',
    last4: '4242',
    expMonth: '08',
    expYear: '28',
    cardholder: 'Rene Pierrette',
  });

  // Billing address state
  const [billingInfo, setBillingInfo] = useState({
    email: 'rpierrette45@gmail.com',
    address: '100 Obsidian Plaza, Suite 400',
    city: 'New York',
    state: 'NY',
    zip: '10001',
    taxId: 'US-EIN 84-9204912',
  });

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const activePlanData = PLANS.find((p) => p.id === currentPlan) || PLANS[1];
  const activePrice = billingCycle === 'annual' ? activePlanData.annualPrice : activePlanData.monthlyPrice;

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-semibold text-white shadow-2xl transition-all"
          style={{ background: '#181926', border: '1px solid #3b3e5b' }}
        >
          <CheckCircle2 size={16} className="text-emerald-400" />
          {toastMessage}
        </div>
      )}

      {/* Subheader */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/5 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-bold tracking-tight text-white">Billing &amp; Subscription</h2>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
              style={{
                background: 'rgba(52, 211, 153, 0.12)',
                color: '#34d399',
                border: '1px solid rgba(52, 211, 153, 0.25)',
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {activePlanData.name} Plan · Active
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            Manage your subscription cycle, payment credentials, quotas, and downloadable invoice history
          </p>
        </div>

        {/* Monthly vs Annual Toggle */}
        <div className="flex items-center gap-2 rounded-xl p-1 bg-neutral-900 border border-white/10 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setBillingCycle('monthly')}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              billingCycle === 'monthly' ? 'bg-white/10 text-white shadow-xs' : 'text-neutral-400 hover:text-white'
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle('annual')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              billingCycle === 'annual' ? 'bg-indigo-600 text-white shadow-xs' : 'text-neutral-400 hover:text-white'
            }`}
          >
            Annual
            <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] text-emerald-300 font-bold">
              Save 20%
            </span>
          </button>
        </div>
      </div>

      {/* Active Subscription Summary Card */}
      <div
        className="relative overflow-hidden rounded-2xl p-6 transition-all"
        style={{
          background: 'linear-gradient(135deg, rgba(24, 25, 38, 0.95) 0%, rgba(18, 19, 28, 0.95) 100%)',
          border: '1px solid #282a3d',
        }}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}
              >
                <Zap size={20} />
              </span>
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                  Current Tier
                </span>
                <h3 className="text-xl font-bold text-white">{activePlanData.name} Plan</h3>
              </div>
            </div>

            <p className="text-xs text-neutral-300 max-w-xl leading-relaxed">{activePlanData.description}</p>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 pt-1">
              {activePlanData.features.map((feat, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-neutral-300">
                  <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  <span>{feat}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing & Actions Column */}
          <div className="flex flex-col items-start lg:items-end justify-between self-stretch shrink-0 border-t border-white/5 pt-4 lg:border-t-0 lg:pt-0">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-extrabold text-white font-mono">${activePrice}</span>
                <span className="text-xs text-neutral-400 font-medium">/ month</span>
              </div>
              <p className="text-[11.5px] text-neutral-400 mt-0.5">
                {billingCycle === 'annual' ? `Billed annually at $${activePrice * 12}/year` : 'Billed monthly'}
              </p>
              <p className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
                <Calendar size={12} /> Next renewal: November 15, 2026
              </p>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsChangePlanModalOpen(true)}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-white transition-all shadow-md cursor-pointer"
                style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
              >
                Change Tier / Upgrade
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Are you sure you want to cancel your subscription at the end of the billing period?')) {
                    triggerToast('Cancellation scheduled at period end (Nov 15, 2026).');
                  }
                }}
                className="rounded-xl px-3.5 py-2 text-xs font-medium text-neutral-400 hover:text-red-400 transition-colors bg-white/5 border border-white/10 cursor-pointer"
              >
                Cancel Subscription
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Murmura Resource Usage & Quotas (Progress Bars) */}
      <div className="rounded-2xl p-5" style={{ background: '#12131c', border: '1px solid #1f2130' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-bold text-white tracking-tight">Active Resource Quotas</h4>
            <p className="text-[11.5px] text-neutral-400">Current cycle utilization against plan limits</p>
          </div>
          <span className="text-[11px] text-indigo-400 font-mono">Reset in 13 days</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Quota 1: Connected Channels */}
          <div className="rounded-xl p-3.5" style={{ background: '#181926', border: '1px solid #232536' }}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Social Channels</span>
              <span className="font-mono text-white font-bold">8 / 15</span>
            </div>
            <div className="mt-2.5 h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
              <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: '53%' }} />
            </div>
            <p className="mt-2 text-[11px] text-neutral-400 font-mono">53% capacity used</p>
          </div>

          {/* Quota 2: Monthly Posts */}
          <div className="rounded-xl p-3.5" style={{ background: '#181926', border: '1px solid #232536' }}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Monthly Posts</span>
              <span className="font-mono text-white font-bold">482 / 1,000</span>
            </div>
            <div className="mt-2.5 h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: '48%' }} />
            </div>
            <p className="mt-2 text-[11px] text-neutral-400 font-mono">482 publications dispatched</p>
          </div>

          {/* Quota 3: Team Seats */}
          <div className="rounded-xl p-3.5" style={{ background: '#181926', border: '1px solid #232536' }}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Team Member Seats</span>
              <span className="font-mono text-white font-bold">4 / 10</span>
            </div>
            <div className="mt-2.5 h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
              <div className="h-full rounded-full bg-cyan-500 transition-all duration-500" style={{ width: '40%' }} />
            </div>
            <p className="mt-2 text-[11px] text-neutral-400 font-mono">6 seats available to invite</p>
          </div>

          {/* Quota 4: Media CDN Storage */}
          <div className="rounded-xl p-3.5" style={{ background: '#181926', border: '1px solid #232536' }}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-400 font-medium">Cloud Media Storage</span>
              <span className="font-mono text-white font-bold">14.2 / 50 GB</span>
            </div>
            <div className="mt-2.5 h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
              <div className="h-full rounded-full bg-purple-500 transition-all duration-500" style={{ width: '28%' }} />
            </div>
            <p className="mt-2 text-[11px] text-neutral-400 font-mono">35.8 GB free storage</p>
          </div>
        </div>
      </div>

      {/* Payment Method & Billing Address Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Payment Credentials Card */}
        <div className="rounded-2xl p-5 lg:col-span-6" style={{ background: '#12131c', border: '1px solid #1f2130' }}>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-white tracking-tight">Payment Method</h4>
            <button
              type="button"
              onClick={() => setIsAddPaymentModalOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <Plus size={14} /> Add Method
            </button>
          </div>

          {/* Visual Credit Card Container */}
          <div
            className="rounded-xl p-5 text-white relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #1e2030 0%, #151722 100%)',
              border: '1px solid #2d3148',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 font-mono">
                {paymentMethod.brand}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Default
              </span>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <div className="flex h-8 w-11 items-center justify-center rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-[10px]">
                CHIP
              </div>
              <p className="font-mono text-base font-bold tracking-widest text-neutral-100">
                •••• •••• •••• {paymentMethod.last4}
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between text-xs text-neutral-300 font-mono">
              <div>
                <span className="block text-[9px] uppercase text-neutral-500">Cardholder</span>
                <span className="font-semibold text-neutral-200">{paymentMethod.cardholder}</span>
              </div>
              <div>
                <span className="block text-[9px] uppercase text-neutral-500">Expires</span>
                <span className="font-semibold text-neutral-200">
                  {paymentMethod.expMonth}/{paymentMethod.expYear}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Billing Information Card */}
        <div className="rounded-2xl p-5 lg:col-span-6" style={{ background: '#12131c', border: '1px solid #1f2130' }}>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-white tracking-tight">Billing Address &amp; Tax Info</h4>
            <button
              type="button"
              onClick={() => triggerToast('Billing address updated successfully.')}
              className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              Update
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div className="rounded-xl p-3 bg-neutral-900/60 border border-white/5 flex items-start gap-3">
              <Mail size={16} className="text-neutral-400 mt-0.5 shrink-0" />
              <div>
                <span className="text-[10px] uppercase font-mono text-neutral-400 font-bold">Billing Email</span>
                <p className="text-white font-medium">{billingInfo.email}</p>
              </div>
            </div>

            <div className="rounded-xl p-3 bg-neutral-900/60 border border-white/5 flex items-start gap-3">
              <Building size={16} className="text-neutral-400 mt-0.5 shrink-0" />
              <div>
                <span className="text-[10px] uppercase font-mono text-neutral-400 font-bold">Registered Entity &amp; Address</span>
                <p className="text-white font-medium">Obsidian Enterprise Inc.</p>
                <p className="text-neutral-400 mt-0.5">{billingInfo.address}</p>
                <p className="text-neutral-400">
                  {billingInfo.city}, {billingInfo.state} {billingInfo.zip}
                </p>
              </div>
            </div>

            <div className="rounded-xl p-3 bg-neutral-900/60 border border-white/5 flex items-start gap-3">
              <ShieldCheck size={16} className="text-neutral-400 mt-0.5 shrink-0" />
              <div>
                <span className="text-[10px] uppercase font-mono text-neutral-400 font-bold">Tax &amp; VAT Identification</span>
                <p className="text-white font-medium font-mono">{billingInfo.taxId}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Invoice History Table (Zero-Pill Discipline applied) */}
      <div className="rounded-2xl p-5" style={{ background: '#12131c', border: '1px solid #1f2130' }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-sm font-bold text-white tracking-tight">Invoice History &amp; Receipts</h4>
            <p className="text-[11.5px] text-neutral-400">Download past tax receipts and monthly accounting statements</p>
          </div>
          <button
            type="button"
            onClick={() => triggerToast('Exported all invoices to CSV.')}
            className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300 hover:text-white transition-colors"
          >
            <Download size={13} /> Export All
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-neutral-400 uppercase text-[10.5px] font-mono tracking-wider">
                <th className="pb-3 font-semibold">Invoice ID</th>
                <th className="pb-3 font-semibold">Date</th>
                <th className="pb-3 font-semibold">Description</th>
                <th className="pb-3 font-semibold">Amount</th>
                <th className="pb-3 font-semibold">Status</th>
                <th className="pb-3 font-semibold text-right">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-3 font-mono font-medium text-white">{inv.id}</td>
                  <td className="py-3 text-neutral-400 font-mono">{inv.date}</td>
                  <td className="py-3 text-neutral-300">{inv.description}</td>
                  <td className="py-3 font-mono font-bold text-white">{inv.amount}</td>
                  <td className="py-3">
                    {/* Zero-Pill Status: Clean text with status dot */}
                    <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Paid
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(inv)}
                      className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
                    >
                      <FileText size={13} /> View PDF
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Plan Tiers Switcher Modal */}
      {isChangePlanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div
            className="w-full max-w-3xl rounded-2xl p-6 text-white overflow-hidden shadow-2xl space-y-6"
            style={{ background: '#12131c', border: '1px solid #282a3d' }}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="text-lg font-bold">Select Subscription Tier</h3>
                <p className="text-xs text-neutral-400 mt-0.5">Switch your plan or adjust capacity</p>
              </div>
              <button
                type="button"
                onClick={() => setIsChangePlanModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {PLANS.map((plan) => {
                const isSelected = currentPlan === plan.id;
                const price = billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
                return (
                  <div
                    key={plan.id}
                    className={`rounded-xl p-4 flex flex-col justify-between transition-all ${
                      isSelected
                        ? 'border-2 border-indigo-500 bg-indigo-950/20'
                        : 'border border-white/10 bg-neutral-900/60 hover:border-white/20'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-white">{plan.name}</span>
                        {plan.popular && (
                          <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[9px] font-bold text-indigo-300">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex items-baseline gap-1">
                        <span className="text-2xl font-bold font-mono text-white">${price}</span>
                        <span className="text-xs text-neutral-400">/mo</span>
                      </div>
                      <p className="text-[11px] text-neutral-400 mt-2 leading-relaxed">{plan.description}</p>
                      <ul className="mt-4 space-y-1.5 text-[11px] text-neutral-300">
                        {plan.features.slice(0, 4).map((f, i) => (
                          <li key={i} className="flex items-center gap-1.5">
                            <Check size={12} className="text-indigo-400 shrink-0" />
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <button
                      type="button"
                      disabled={isSelected}
                      onClick={() => {
                        setCurrentPlan(plan.id);
                        setIsChangePlanModalOpen(false);
                        triggerToast(`Switched plan to ${plan.name}.`);
                      }}
                      className={`mt-5 w-full rounded-xl py-2 text-xs font-semibold transition-all ${
                        isSelected
                          ? 'bg-neutral-800 text-neutral-400 cursor-default'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md'
                      }`}
                    >
                      {isSelected ? 'Active Plan' : `Switch to ${plan.name}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Invoice Receipt Modal Preview */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div
            className="w-full max-w-md rounded-2xl p-6 text-white space-y-5 shadow-2xl"
            style={{ background: '#12131c', border: '1px solid #282a3d' }}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <FileText size={18} className="text-indigo-400" />
                <h3 className="text-sm font-bold">Tax Receipt · {selectedInvoice.id}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="text-neutral-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-900 border border-white/5">
                <span className="text-neutral-400">Billing Date:</span>
                <span className="font-mono text-white font-medium">{selectedInvoice.date}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-900 border border-white/5">
                <span className="text-neutral-400">Service:</span>
                <span className="text-white font-medium">{selectedInvoice.description}</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-900 border border-white/5">
                <span className="text-neutral-400">Amount Charged:</span>
                <span className="font-mono font-bold text-white text-sm">{selectedInvoice.amount} USD</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-900 border border-white/5">
                <span className="text-neutral-400">Payment Instrument:</span>
                <span className="font-mono text-neutral-300">Mastercard •••• 4242</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-neutral-900 border border-white/5">
                <span className="text-neutral-400">Status:</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                  <CheckCircle2 size={13} /> Paid in Full
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  triggerToast(`Receipt ${selectedInvoice.id} downloaded.`);
                  setSelectedInvoice(null);
                }}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 text-xs font-semibold text-white transition-all shadow-md"
              >
                <Download size={14} /> Download PDF Receipt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Payment Method Modal */}
      {isAddPaymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
          <div
            className="w-full max-w-md rounded-2xl p-6 text-white space-y-4 shadow-2xl"
            style={{ background: '#12131c', border: '1px solid #282a3d' }}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-sm font-bold">Add Payment Card</h3>
              <button
                type="button"
                onClick={() => setIsAddPaymentModalOpen(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setIsAddPaymentModalOpen(false);
                triggerToast('New payment card verified and linked as default.');
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="block text-neutral-400 mb-1 font-medium">Cardholder Name</label>
                <input
                  type="text"
                  required
                  defaultValue="Rene Pierrette"
                  className="w-full rounded-xl bg-neutral-900 border border-white/10 px-3 py-2 text-white text-xs outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-neutral-400 mb-1 font-medium">Card Number</label>
                <input
                  type="text"
                  required
                  placeholder="•••• •••• •••• ••••"
                  defaultValue="5555 4444 3333 2222"
                  className="w-full rounded-xl bg-neutral-900 border border-white/10 px-3 py-2 text-white font-mono text-xs outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-400 mb-1 font-medium">Expires (MM/YY)</label>
                  <input
                    type="text"
                    required
                    placeholder="MM/YY"
                    defaultValue="12/29"
                    className="w-full rounded-xl bg-neutral-900 border border-white/10 px-3 py-2 text-white font-mono text-xs outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-neutral-400 mb-1 font-medium">CVC / Security Code</label>
                  <input
                    type="password"
                    required
                    maxLength={4}
                    placeholder="•••"
                    defaultValue="892"
                    className="w-full rounded-xl bg-neutral-900 border border-white/10 px-3 py-2 text-white font-mono text-xs outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddPaymentModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-white font-semibold shadow-md"
                >
                  Save Payment Card
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
