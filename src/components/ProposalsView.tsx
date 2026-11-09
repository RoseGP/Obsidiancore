/**
 * "Proposals & Invoicing" area: three tabs.
 *   Invoicing          → features/invoicing (unchanged; the default tab)
 *   Payment Providers  → Stripe & Square connections
 *   Proposals          → features/proposals (server-stored proposals, sent by secure link)
 */
import React, { useEffect, useState } from 'react';
import { CreditCard, FileText, Layers, Upload } from 'lucide-react';
import InvoicingApp from '../features/invoicing/InvoicingApp';
import PaymentProvidersSettings from './proposals/PaymentProvidersSettings';
import BrandLogoCustomizerModal from './proposals/BrandLogoCustomizerModal';
import ProposalsHub from '../features/proposals/ProposalsHub';

type CRMContact = import('../types').CRMContact;

interface ProposalsViewProps {
  contacts?: CRMContact[];
  onSelectContact?: (contact: CRMContact) => void;
  onNavigate?: (view: any) => void;
}

type Tab = 'invoicing' | 'payment_providers' | 'proposals_hub';

export default function ProposalsView({ contacts = [] }: ProposalsViewProps) {
  const [tab, setTab] = useState<Tab>('invoicing');

  // Company logo & name (used on documents); stored in this browser.
  const [companyLogoUrl, setCompanyLogoUrl] = useState('');
  const [companyLogoHeight, setCompanyLogoHeight] = useState(36);
  const [businessName, setBusinessName] = useState('');
  const [showLogoModal, setShowLogoModal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      const savedLogo = localStorage.getItem('invoice_custom_business_logo');
      const savedName = localStorage.getItem('invoice_custom_business_name');
      if (savedLogo) setCompanyLogoUrl(savedLogo);
      if (savedName) setBusinessName(savedName);
    } catch { /* storage unavailable */ }
    // Deep links: payment provider OAuth returns here; invoice links open Invoicing.
    const params = new URLSearchParams(window.location.search);
    const subtab = params.get('subtab');
    if (subtab === 'payment_providers' || params.get('connected') || params.get('error')) setTab('payment_providers');
    else if (subtab === 'proposals') setTab('proposals_hub');
  }, []);

  const tabBtn = (id: Tab) => `px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
    tab === id ? 'bg-black text-white shadow-xs' : 'text-slate-600 hover:text-black hover:bg-slate-50'
  }`;

  return (
    <div className="space-y-6" id="proposals-tab-container">
      <div className="bg-white p-2 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button type="button" onClick={() => setTab('invoicing')} className={tabBtn('invoicing')}>
            <Layers className="w-3.5 h-3.5 text-indigo-400" /><span>Invoicing</span>
          </button>
          <button type="button" onClick={() => setTab('payment_providers')} className={tabBtn('payment_providers')}>
            <CreditCard className="w-3.5 h-3.5 text-emerald-500" /><span>Payment Providers</span>
            <span className="text-[10px] px-1.5 rounded-full bg-slate-100 text-slate-600 font-semibold">Stripe & Square</span>
          </button>
          <button type="button" onClick={() => setTab('proposals_hub')} className={tabBtn('proposals_hub')}>
            <FileText className="w-3.5 h-3.5 text-slate-400" /><span>Proposals</span>
          </button>
        </div>
        {tab !== 'invoicing' && (
          <button
            type="button"
            onClick={() => setShowLogoModal(true)}
            className="mr-1 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Upload your logo or choose a preset"
          >
            {companyLogoUrl ? <img src={companyLogoUrl} alt="" className="w-4 h-4 object-contain rounded" /> : <Upload className="w-3.5 h-3.5 text-indigo-600" />}
            <span>{companyLogoUrl ? 'Brand logo' : 'Add logo'}</span>
          </button>
        )}
      </div>

      {notice && <p role="status" className="rounded-xl bg-emerald-50 text-emerald-800 px-4 py-2 text-sm">{notice}</p>}

      {tab === 'invoicing' ? (
        <InvoicingApp onOpenPaymentProviders={() => setTab('payment_providers')} />
      ) : tab === 'payment_providers' ? (
        <PaymentProvidersSettings onGoToCreateInvoice={() => setTab('invoicing')} />
      ) : (
        <ProposalsHub contacts={contacts} />
      )}

      <BrandLogoCustomizerModal
        isOpen={showLogoModal}
        onClose={() => setShowLogoModal(false)}
        currentLogoUrl={companyLogoUrl}
        currentLogoHeight={companyLogoHeight}
        currentBusinessName={businessName}
        onSave={(data: { logoUrl: string; logoHeight: number; businessName?: string }) => {
          setCompanyLogoUrl(data.logoUrl);
          setCompanyLogoHeight(data.logoHeight);
          if (data.businessName) setBusinessName(data.businessName);
          setNotice('Logo and business name updated.');
        }}
      />
    </div>
  );
}
