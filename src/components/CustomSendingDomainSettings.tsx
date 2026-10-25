import React, { useState, useEffect } from 'react';
import { 
  Globe, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Copy, 
  Check, 
  RefreshCw, 
  ShieldCheck, 
  Mail, 
  Plus, 
  Trash2, 
  HelpCircle, 
  ArrowRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Info
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';

export interface DNSRecordItem {
  id: string;
  type: 'TXT' | 'MX' | 'CNAME';
  recordType: 'SPF' | 'DKIM' | 'DMARC' | 'MX';
  name: string;
  hostname: string;
  expectedValue: string;
  priority?: number;
  description: string;
  status: 'VERIFIED' | 'PENDING' | 'FAILED';
  detectedValue?: string;
  lastChecked?: string;
}

export interface RegisteredDomain {
  id: string;
  domain: string;
  selector: string;
  registeredAt: string;
  lastVerifiedAt?: string;
  status: 'VERIFIED' | 'PARTIALLY_CONFIGURED' | 'PENDING_VERIFICATION' | 'FAILED';
  records: DNSRecordItem[];
}

export default function CustomSendingDomainSettings() {
  const [domainInput, setDomainInput] = useState('');
  const [selectorInput, setSelectorInput] = useState('cf2026');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [activeDomain, setActiveDomain] = useState<RegisteredDomain | null>(null);
  const [allDomains, setAllDomains] = useState<RegisteredDomain[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [bannerAlert, setBannerAlert] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [showProviderGuide, setShowProviderGuide] = useState(false);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

  // Fetch initial registered domains
  const fetchDomainConfig = async (selectDomain?: string) => {
    try {
      const url = selectDomain 
        ? `/api/crm/email/custom-domain?domain=${encodeURIComponent(selectDomain)}`
        : '/api/crm/email/custom-domain';
      const res = await fetch(url);
      if (!res.ok) {
        return;
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data && data.success) {
        if (data.domains) {
          setAllDomains(data.domains);
        }
        if (data.domain) {
          setActiveDomain(data.domain);
        } else if (data.activeDomain) {
          setActiveDomain(data.activeDomain);
        }
      }
    } catch (err) {
      console.warn('Could not fetch custom domain settings:', err);
    }
  };

  useEffect(() => {
    fetchDomainConfig();
  }, []);

  const handleCopy = async (text: string, key: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  // Register domain
  const handleRegisterDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) {
      setBannerAlert({ type: 'error', message: 'Please enter your business domain name (e.g. acme.com or mail.acme.com).' });
      return;
    }

    setIsRegistering(true);
    setBannerAlert(null);

    try {
      const res = await fetch('/api/crm/email/custom-domain/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: domainInput.trim(),
          selector: selectorInput.trim() || 'cf2026'
        })
      });

      const data = await res.json().catch(() => ({}));
      if (data && data.success && data.domain) {
        setActiveDomain(data.domain);
        setAllDomains(prev => {
          const exists = prev.some(d => d.domain === data.domain.domain);
          if (exists) {
            return prev.map(d => d.domain === data.domain.domain ? data.domain : d);
          }
          return [...prev, data.domain];
        });
        setDomainInput('');
        setBannerAlert({
          type: 'success',
          message: `Custom sending domain ${data.domain.domain} is registered! Add the DNS records below to your DNS provider, then click "Verify DNS".`
        });
      } else {
        throw new Error(data.error || 'Registration failed');
      }
    } catch (err: any) {
      setBannerAlert({ type: 'error', message: err.message || 'Failed to register sending domain.' });
    } finally {
      setIsRegistering(false);
    }
  };

  // Verify DNS records
  const handleVerifyDNS = async () => {
    if (!activeDomain) return;

    setIsVerifying(true);
    setBannerAlert(null);

    try {
      const res = await fetch('/api/crm/email/custom-domain/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: activeDomain.domain,
          selector: activeDomain.selector
        })
      });

      const data = await res.json().catch(() => ({}));
      if (data && data.success && data.domain) {
        setActiveDomain(data.domain);
        setAllDomains(prev => prev.map(d => d.domain === data.domain.domain ? data.domain : d));

        const verified = data.summary?.verifiedRecords || 0;
        const total = data.summary?.totalRecords || data.domain.records.length;

        if (verified === total) {
          setBannerAlert({
            type: 'success',
            message: `🎉 All DNS records for ${data.domain.domain} are fully verified! Outbound emails are now cryptographically signed and authenticated.`
          });
        } else if (verified > 0) {
          setBannerAlert({
            type: 'info',
            message: `DNS Check: ${verified} of ${total} records verified. Please allow 5-15 minutes for remaining DNS changes to propagate across worldwide nameservers.`
          });
        } else {
          setBannerAlert({
            type: 'error',
            message: `No matching DNS records detected on ${data.domain.domain} yet. Please check your DNS provider settings and ensure there are no typos in hostnames.`
          });
        }
      } else {
        throw new Error(data.error || 'Verification check failed');
      }
    } catch (err: any) {
      setBannerAlert({ type: 'error', message: err.message || 'DNS verification request failed.' });
    } finally {
      setIsVerifying(false);
    }
  };

  // Delete domain
  const handleDeleteDomain = async (domainName: string) => {
    if (!confirm(`Are you sure you want to remove ${domainName}? Outbound email deliverability may be affected.`)) {
      return;
    }

    try {
      const res = await fetch('/api/crm/email/custom-domain', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainName })
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.success) {
        setAllDomains(prev => prev.filter(d => d.domain !== domainName));
        if (activeDomain?.domain === domainName) {
          const remaining = allDomains.filter(d => d.domain !== domainName);
          setActiveDomain(remaining[0] || null);
        }
        setBannerAlert({ type: 'info', message: `Domain ${domainName} was removed.` });
      }
    } catch (err) {
      console.error('Failed to delete domain:', err);
    }
  };

  const verifiedRecordsCount = activeDomain?.records.filter(r => r.status === 'VERIFIED').length || 0;
  const totalRecordsCount = activeDomain?.records.length || 0;
  const isFullyVerified = totalRecordsCount > 0 && verifiedRecordsCount === totalRecordsCount;

  return (
    <div className="space-y-6 max-w-5xl mx-auto font-sans" id="custom-domain-settings-container">
      
      {/* Header Banner */}
      <div className="bg-neutral-900/90 border border-white/10 rounded-2xl p-6 shadow-xl relative overflow-hidden backdrop-blur-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-blue-400 text-xs font-bold tracking-wider uppercase">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              <span>Deliverability &amp; Email Authentication</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">Custom Sending Domain &amp; DNS Verification</h2>
            <p className="text-xs text-neutral-400 max-w-2xl leading-relaxed">
              Connect your company domain to send professional, authenticated emails directly from your CRM with 99.9% inbox placement.
            </p>
          </div>

          {activeDomain && (
            <div className="flex items-center gap-2 self-start md:self-auto">
              <button
                id="btn-verify-dns-primary"
                type="button"
                onClick={handleVerifyDNS}
                disabled={isVerifying}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-blue-900/30 flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                <span>{isVerifying ? 'Verifying DNS...' : 'Verify DNS'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Global Notification Banner */}
        {bannerAlert && (
          <div className={`mt-4 p-3.5 rounded-xl border text-xs font-medium flex items-start gap-2.5 animate-fadeIn ${
            bannerAlert.type === 'success' 
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' 
              : bannerAlert.type === 'error'
              ? 'bg-rose-950/40 border-rose-500/30 text-rose-300'
              : 'bg-blue-950/40 border-blue-500/30 text-blue-300'
          }`}>
            {bannerAlert.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
            {bannerAlert.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />}
            {bannerAlert.type === 'info' && <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />}
            <span className="flex-1 leading-relaxed">{bannerAlert.message}</span>
            <button 
              type="button" 
              onClick={() => setBannerAlert(null)}
              className="text-neutral-400 hover:text-white text-xs font-bold ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Domain Registration Card */}
      <div className="bg-neutral-900/80 border border-white/5 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Globe className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Add Custom Business Domain</h3>
              <p className="text-[11px] text-neutral-400">Enter your company sending domain or subdomain (e.g. acme.com or mail.acme.com)</p>
            </div>
          </div>

          {allDomains.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-neutral-400 font-medium">Registered:</span>
              <div className="flex flex-wrap gap-1">
                {allDomains.map((d) => (
                  <button
                    key={d.domain}
                    type="button"
                    onClick={() => setActiveDomain(d)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                      activeDomain?.domain === d.domain
                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40 ring-1 ring-blue-500/30'
                        : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200 border border-white/5'
                    }`}
                  >
                    <span>{d.domain}</span>
                    {d.status === 'VERIFIED' && (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleRegisterDomain} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-8">
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5" htmlFor="input-sending-domain">
                Sending Domain
              </label>
              <div className="relative">
                <input
                  id="input-sending-domain"
                  type="text"
                  placeholder="e.g. company.com or mail.company.com"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  className="w-full bg-neutral-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all font-mono"
                />
              </div>
            </div>

            <div className="md:col-span-4 flex items-center gap-2">
              <button
                id="btn-register-domain"
                type="submit"
                disabled={isRegistering || !domainInput.trim()}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md shadow-blue-900/20 cursor-pointer"
              >
                {isRegistering ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Registering Domain...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    <span>Register Domain</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[11px] text-neutral-400 hover:text-neutral-200 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span>{showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options (Key Selector)'}</span>
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            <button
              type="button"
              onClick={() => setShowProviderGuide(!showProviderGuide)}
              className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1 cursor-pointer font-medium"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>DNS Setup Instructions by Provider</span>
            </button>
          </div>

          {showAdvanced && (
            <div className="p-3.5 bg-neutral-950/60 border border-white/5 rounded-xl space-y-2 text-xs">
              <label className="block text-neutral-400 text-[11px] font-semibold">
                DKIM Selector Tag (Default: cf2026)
              </label>
              <input
                type="text"
                value={selectorInput}
                onChange={(e) => setSelectorInput(e.target.value)}
                placeholder="cf2026"
                className="w-full max-w-xs bg-neutral-900 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
              />
              <p className="text-[10px] text-neutral-500">The selector creates the DNS record name: <code className="text-neutral-300 font-mono">{selectorInput || 'cf2026'}._domainkey.{domainInput || 'yourdomain.com'}</code></p>
            </div>
          )}
        </form>
      </div>

      {/* Provider Guide Accordion */}
      {showProviderGuide && (
        <div className="bg-neutral-900/90 border border-blue-500/20 rounded-2xl p-5 shadow-lg space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-400" />
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">How to Add These Records in Your DNS Host</h4>
            </div>
            <button
              type="button"
              onClick={() => setShowProviderGuide(false)}
              className="text-xs text-neutral-400 hover:text-white"
            >
              ✕ Close Guide
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="bg-neutral-950 p-3.5 rounded-xl border border-white/5 space-y-1.5">
              <h5 className="font-bold text-blue-300">Cloudflare / Route 53</h5>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                1. Navigate to <strong>DNS &gt; Records</strong><br/>
                2. Click <strong>Add record</strong><br/>
                3. Choose type <code className="text-white">TXT</code> or <code className="text-white">MX</code><br/>
                4. For Root hostnames use <code className="text-white">@</code><br/>
                5. Set TTL to <strong>Auto</strong> or <strong>300 seconds</strong>.
              </p>
            </div>
            <div className="bg-neutral-950 p-3.5 rounded-xl border border-white/5 space-y-1.5">
              <h5 className="font-bold text-amber-300">GoDaddy / Namecheap</h5>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                1. Open <strong>Domain Management &gt; DNS</strong><br/>
                2. Click <strong>Add Record</strong><br/>
                3. Enter the Host name (e.g. <code className="text-white">cf2026._domainkey</code>)<br/>
                4. Paste the expected value into the TXT Value field<br/>
                5. Save and wait 5 minutes for TTL sync.
              </p>
            </div>
            <div className="bg-neutral-950 p-3.5 rounded-xl border border-white/5 space-y-1.5">
              <h5 className="font-bold text-emerald-300">Google Domains / Squarespace</h5>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                1. Open <strong>Custom DNS Records</strong><br/>
                2. Add SPF, DKIM, and DMARC as <code className="text-white">TXT</code> records<br/>
                3. Add Mail Exchange as <code className="text-white">MX</code> with Priority 10<br/>
                4. Click <strong>Save Changes</strong>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active Domain DNS Verification Checklist Table */}
      {activeDomain ? (
        <div className="bg-neutral-900/90 border border-white/5 rounded-2xl overflow-hidden shadow-sm" id="dns-verification-checklist-card">
          
          {/* Table Header Section */}
          <div className="p-5 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-neutral-950/40">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white font-mono">{activeDomain.domain}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-sans uppercase tracking-wider flex items-center gap-1 ${
                  activeDomain.status === 'VERIFIED'
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : activeDomain.status === 'PARTIALLY_CONFIGURED'
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : 'bg-neutral-800 text-neutral-300 border border-white/10'
                }`}>
                  {activeDomain.status === 'VERIFIED' ? (
                    <>
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Verified &amp; Active</span>
                    </>
                  ) : activeDomain.status === 'PARTIALLY_CONFIGURED' ? (
                    <>
                      <Clock className="w-3 h-3 text-amber-400" />
                      <span>Partially Configured ({verifiedRecordsCount}/{totalRecordsCount})</span>
                    </>
                  ) : (
                    <>
                      <Clock className="w-3 h-3 text-neutral-400" />
                      <span>Pending DNS Propagation</span>
                    </>
                  )}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400">
                Configure the following <strong>5 DNS records</strong> at your domain registrar. All records must pass verification.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleVerifyDNS}
                disabled={isVerifying}
                className="px-3.5 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                title="Perform live DNS lookup across all records"
              >
                <RefreshCw className={`w-3 h-3 text-blue-400 ${isVerifying ? 'animate-spin' : ''}`} />
                <span>{isVerifying ? 'Checking Nameservers...' : 'Verify DNS'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleDeleteDomain(activeDomain.domain)}
                className="p-1.5 bg-neutral-800 hover:bg-rose-950/40 text-neutral-400 hover:text-rose-300 border border-white/5 hover:border-rose-500/30 rounded-xl transition-all cursor-pointer"
                title="Remove this domain"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* DNS Checklist Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-neutral-950/60 text-[11px] font-semibold text-neutral-400">
                  <th className="py-3 px-4 w-28">Type</th>
                  <th className="py-3 px-4 w-44">Hostname / Name</th>
                  <th className="py-3 px-4 w-24">Priority</th>
                  <th className="py-3 px-4">Expected Value</th>
                  <th className="py-3 px-4 w-36 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {activeDomain.records.map((rec) => {
                  const isCopiedName = copiedKey === `name_${rec.id}`;
                  const isCopiedVal = copiedKey === `val_${rec.id}`;
                  const isExpanded = expandedRecordId === rec.id;

                  return (
                    <React.Fragment key={rec.id}>
                      <tr className="hover:bg-white/[0.02] transition-colors group">
                        {/* Record Type Badge */}
                        <td className="py-3.5 px-4 align-top">
                          <div className="space-y-1">
                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                              rec.type === 'TXT' 
                                ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                                : rec.type === 'MX'
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            }`}>
                              {rec.type}
                            </span>
                            <div className="text-[10px] font-semibold text-neutral-300">
                              {rec.recordType}
                            </div>
                          </div>
                        </td>

                        {/* Hostname */}
                        <td className="py-3.5 px-4 align-top">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <code className="text-white font-mono text-[11px] bg-neutral-950 px-2 py-0.5 rounded border border-white/5 select-all">
                                {rec.hostname}
                              </code>
                              <button
                                type="button"
                                onClick={() => handleCopy(rec.hostname, `name_${rec.id}`)}
                                className="p-1 text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors cursor-pointer"
                                title="Copy Hostname"
                              >
                                {isCopiedName ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                            <p className="text-[10px] text-neutral-400 font-sans leading-tight">
                              {rec.name}
                            </p>
                          </div>
                        </td>

                        {/* Priority */}
                        <td className="py-3.5 px-4 align-top">
                          {rec.priority !== undefined ? (
                            <span className="font-mono text-neutral-300 bg-neutral-950 px-2 py-0.5 rounded border border-white/5 text-[11px]">
                              {rec.priority}
                            </span>
                          ) : (
                            <span className="text-neutral-600 font-mono text-[11px]">—</span>
                          )}
                        </td>

                        {/* Expected Value */}
                        <td className="py-3.5 px-4 align-top">
                          <div className="space-y-1.5">
                            <div className="flex items-start gap-1.5">
                              <div className="flex-1 bg-neutral-950 p-2 rounded-lg border border-white/5 font-mono text-[11px] text-neutral-300 break-all select-all leading-relaxed max-h-24 overflow-y-auto">
                                {rec.expectedValue}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleCopy(rec.expectedValue, `val_${rec.id}`)}
                                className="p-1.5 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg border border-white/5 transition-colors cursor-pointer shrink-0 mt-0.5"
                                title="Copy Record Value"
                              >
                                {isCopiedVal ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                            <p className="text-[10px] text-neutral-400 leading-tight">
                              {rec.description}
                            </p>
                          </div>
                        </td>

                        {/* Status Badge */}
                        <td className="py-3.5 px-4 align-top text-right">
                          <div className="space-y-1 inline-flex flex-col items-end">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              rec.status === 'VERIFIED'
                                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                : rec.status === 'FAILED'
                                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            }`}>
                              {rec.status === 'VERIFIED' ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span>Verified</span>
                                </>
                              ) : rec.status === 'FAILED' ? (
                                <>
                                  <AlertCircle className="w-3 h-3 text-rose-400" />
                                  <span>Missing</span>
                                </>
                              ) : (
                                <>
                                  <Clock className="w-3 h-3 text-amber-400" />
                                  <span>Pending</span>
                                </>
                              )}
                            </span>

                            {rec.detectedValue && (
                              <button
                                type="button"
                                onClick={() => setExpandedRecordId(isExpanded ? null : rec.id)}
                                className="text-[9px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 font-mono cursor-pointer"
                              >
                                <span>{isExpanded ? 'Hide Live DNS' : 'View Live DNS'}</span>
                                {isExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Live DNS Inspection Detail */}
                      {isExpanded && rec.detectedValue && (
                        <tr className="bg-neutral-950/80">
                          <td colSpan={5} className="py-2.5 px-4 text-[11px] font-mono border-t border-white/5">
                            <div className="flex items-start gap-2 text-neutral-400">
                              <span className="text-neutral-500 shrink-0 font-bold">Detected on Nameserver:</span>
                              <span className="text-amber-300 select-all break-all">{rec.detectedValue}</span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer Controls */}
          <div className="p-4 bg-neutral-950/60 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-neutral-400 text-[11px]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse"></span>
              <span>
                {activeDomain.lastVerifiedAt 
                  ? `Last verified: ${new Date(activeDomain.lastVerifiedAt).toLocaleTimeString()}`
                  : 'Not yet verified'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <button
                id="btn-verify-dns-footer"
                type="button"
                onClick={handleVerifyDNS}
                disabled={isVerifying}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                <span>{isVerifying ? 'Verifying All Records...' : 'Verify DNS Records'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-neutral-900/60 border border-dashed border-white/10 rounded-2xl p-10 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-neutral-800 flex items-center justify-center mx-auto text-neutral-400">
            <Globe className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white">No Custom Sending Domain Configured</h3>
          <p className="text-xs text-neutral-400 max-w-md mx-auto">
            Input your business domain above (e.g. <code className="text-blue-300">acme.com</code>) to generate SPF, DKIM, DMARC, and MX records for your DNS host.
          </p>
        </div>
      )}

      {/* Deliverability Guarantee Badge */}
      <div className="p-4 bg-gradient-to-r from-blue-950/30 to-indigo-950/30 border border-blue-500/15 rounded-2xl flex items-center justify-between gap-4 text-xs text-neutral-300">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="font-bold text-white text-xs">Enterprise Deliverability &amp; Anti-Spoofing Protection</div>
            <div className="text-[11px] text-neutral-400">
              SPF, DKIM, and DMARC alignment protects your brand against spoofing while ensuring your emails bypass spam filters on Gmail, Outlook, and Apple Mail.
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
