import React, { useState, useEffect, useRef } from 'react';
import useDebounce from '../hooks/useDebounce';
import { 
  FileText, Shield, Calendar, DollarSign, Download, Send, 
  CheckCircle2, RefreshCw, AlertCircle, Sparkles, Building, 
  User, Mail, Globe, Clock, Layers, ChevronRight, PenSquare, 
  Check, Copy, FileCode, CheckSquare, Settings, UserCheck, ShieldCheck,
  PenTool, CreditCard, Eraser, ExternalLink, Upload
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import VerticalTimeline, { Phase } from './VerticalTimeline';
import { copyToClipboard } from '../utils/clipboard';
import InvoicingApp from '../features/invoicing/InvoicingApp';
import PaymentProvidersSettings from './proposals/PaymentProvidersSettings';
import BrandLogoCustomizerModal from './proposals/BrandLogoCustomizerModal';

interface CRMContact {
  id: string;
  name: string;
  avatar: string;
  channel: 'email' | 'whatsapp' | 'telegram' | 'sms' | 'instagram';
  lastMessage: string;
  timestamp: string;
  unread: boolean;
  status: 'active' | 'pending' | 'resolved';
  sentiment: 'positive' | 'neutral' | 'negative';
  email: string;
  phone: string;
  company: string;
}

interface ClientDiscoveryProfile {
  contactId: string;
  bottlenecks: string;
  scopeRequirements: string;
  industry: 'Fintech' | 'Cloud SaaS' | 'Healthcare' | 'Enterprise Logistics' | 'E-commerce';
  defaultFrameworks: string[];
  baseBudget: number;
}

const DEFAULT_PROFILES: { [id: string]: ClientDiscoveryProfile } = {
  '1': {
    contactId: '1',
    industry: 'Cloud SaaS',
    bottlenecks: 'The client is facing critical scaling bottlenecks on omnichannel support routing. Leads coming from WhatsApp, Telegram, and E-mail are managed in isolated silos, resulting in high support friction and inconsistent SLA monitoring. Representatives struggle to review historical contact context, and the lack of structured communication auditing poses GDPR compliance risks during cross-border operations.',
    scopeRequirements: 'Design and build a fully unified, secure, omnichannel messaging dashboard with native integration with global messaging gateways (WhatsApp API, Telegram bot, and IMAP servers). Implement an automated SLA audit logger, end-to-end encryption on customer PII in transit, and active status telemetry logs. Design WebRTC-powered high-trust live consultation interfaces.',
    defaultFrameworks: ['GDPR', 'ISO 27001'],
    baseBudget: 48000
  },
  '2': {
    contactId: '2',
    industry: 'Enterprise Logistics',
    bottlenecks: 'Failing custom high-frequency backend API webhooks. Missing structured retry-loops, latency alerts, and validation rules. Real-time fleet and distribution event tracking is unstable, leading to misaligned logistics coordination and unmonitored server exceptions.',
    scopeRequirements: 'Implement high-throughput middleware routers in Node.js with native circuit-breaker patterns. Embed real-time notification dispatch via dynamic WebSockets. Formulate durable schema mappings in PostgreSQL with optimized JSONB column blocks for custom payloads.',
    defaultFrameworks: ['SOC 2 Type II', 'ISO 27001'],
    baseBudget: 35000
  },
  '3': {
    contactId: '3',
    industry: 'Fintech',
    bottlenecks: 'Audit trail vulnerabilities in ledger entries. Manual contract and SLA clearing processes are highly error-prone and breach GDPR standards for secure financial workflows. There is an immediate risk of customer payload manipulation, requiring encrypted, un-alterable records.',
    scopeRequirements: 'Engineer optimized, index-backed PostgreSQL schema structures targeting the Google Business Information API specification. Develop transactional audit log triggers, granular JWT authorization layers, and automated SLA compliance status checks.',
    defaultFrameworks: ['GDPR', 'ISO 27001', 'SOC 2 Type II'],
    baseBudget: 75000
  }
};

interface ProposalsViewProps {
  contacts?: CRMContact[];
  onSelectContact?: (contact: CRMContact) => void;
  onNavigate?: (view: any) => void;
}

export default function ProposalsView({ contacts = [], onNavigate }: ProposalsViewProps) {
  // Local contacts fallback
  const localContacts: CRMContact[] = contacts.length > 0 ? contacts : [
    {
      id: '1',
      name: 'Sarah Jenkins',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=120',
      channel: 'whatsapp',
      lastMessage: "Let's finalize the SLA scope next Tuesday.",
      timestamp: '10:42 AM',
      unread: true,
      status: 'active',
      sentiment: 'positive',
      email: 'sarah.j@alpha-tech.cloud',
      phone: '+1 (555) 234-5678',
      company: 'Alpha Tech Cloud Inc.'
    },
    {
      id: '2',
      name: 'Marcus Chen',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120',
      channel: 'telegram',
      lastMessage: 'Did the custom API integration trigger correctly?',
      timestamp: '10:15 AM',
      unread: true,
      status: 'active',
      sentiment: 'neutral',
      email: 'm.chen@vortex-io.co',
      phone: '+1 (555) 876-5432',
      company: 'Vortex Engineering'
    },
    {
      id: '3',
      name: 'Elena Rostova',
      avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=120',
      channel: 'email',
      lastMessage: 'Contract overview attached in draft PDF. Please review.',
      timestamp: 'Yesterday',
      unread: false,
      status: 'pending',
      sentiment: 'positive',
      email: 'elena.rostova@quantum-fin.eu',
      phone: '+31 20 890 1234',
      company: 'Quantum Finance Group'
    }
  ];

  // Active inputs state
  const [proposalsTabMode, setProposalsTabMode] = useState<'invoicing' | 'payment_providers' | 'proposals_hub'>('invoicing');
  const [selectedContactId, setSelectedContactId] = useState<string>('1');
  const [activeSubTab, setActiveSubTab] = useState<'document' | 'email' | 'msa'>('document');
  const [emailTone, setEmailTone] = useState<'ceo-warm' | 'ceo-formal' | 'ceo-urgent'>('ceo-warm');
  const [industry, setIndustry] = useState<'Fintech' | 'Cloud SaaS' | 'Healthcare' | 'Enterprise Logistics' | 'E-commerce'>('Cloud SaaS');
  const [msaSignedName, setMsaSignedName] = useState<string>('');
  const [msaSignedTitle, setMsaSignedTitle] = useState<string>('');
  const [isMsaSigned, setIsMsaSigned] = useState<boolean>(false);
  const [msaSignDate, setMsaSignDate] = useState<string>( '');
  const [completedPhases, setCompletedPhases] = useState<string[]>(['phase-1']);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>(['extended-support']);
  const [liveTime, setLiveTime] = useState<string>('');

  // Company Logo & Branding State
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string>('');
  const [companyLogoHeight, setCompanyLogoHeight] = useState<number>(36);
  const [businessName, setBusinessName] = useState<string>('Obsidian');
  const [showLogoModal, setShowLogoModal] = useState<boolean>(false);

  useEffect(() => {
    try {
      const savedLogo = localStorage.getItem('invoice_custom_business_logo');
      const savedName = localStorage.getItem('invoice_custom_business_name');
      if (savedLogo) setCompanyLogoUrl(savedLogo);
      if (savedName) setBusinessName(savedName);
    } catch {
      // ignore
    }
  }, []);

  const handleUpdateBranding = (data: { logoUrl: string; logoHeight: number; businessName?: string }) => {
    setCompanyLogoUrl(data.logoUrl);
    setCompanyLogoHeight(data.logoHeight);
    if (data.businessName) setBusinessName(data.businessName);
    showToast('Company logo and branding updated across proposal and invoices!', 'success');
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const subtab = params.get('subtab');
      const connected = params.get('connected');
      const err = params.get('error');
      if (subtab === 'payment_providers' || connected || err) {
        setProposalsTabMode('payment_providers');
      } else if (subtab === 'invoice_dashboard' || subtab === 'invoice_builder' || subtab === 'invoicing') {
        setProposalsTabMode('invoicing');
      }
    }
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setLiveTime(now.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const [bottlenecksText, setBottlenecksText] = useState<string>('');
  const [scopeRequirementsText, setScopeRequirementsText] = useState<string>('');
  
  // Custom parameters
  const [selectedFrameworks, setSelectedFrameworks] = useState<string[]>(['GDPR', 'ISO 27001']);
  const [pricingTier, setPricingTier] = useState<'Standard' | 'Premium Enterprise' | 'Emergency Fast-Track'>('Standard');
  const [deliverySpeed, setDeliverySpeed] = useState<'Normal' | 'Accelerated' | 'Express'>('Normal');
  const [cloudDatabaseTarget, setCloudDatabaseTarget] = useState<'PostgreSQL JSONB' | 'Google Cloud' | 'Firebase Firestore'>('PostgreSQL JSONB');

  // Proposal Lifecycle & Local Auto-Save State
  const [proposalStatus, setProposalStatus] = useState<'draft' | 'under_review' | 'sent' | 'accepted'>('draft');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<string | null>(null);
  const [isDraftRestored, setIsDraftRestored] = useState<boolean>(false);

  // Database Synced State
  const [apiProposal, setApiProposal] = useState<any>(null);
  const [isSyncingItem, setIsSyncingItem] = useState<string | null>(null);
  const [isSubmittingSign, setIsSubmittingSign] = useState<boolean>(false);

  // Selector list
  const availableFrameworks = ['GDPR', 'SOC 2 Type II', 'ISO 27001', 'HIPAA', 'ISO 9001', 'PCI-DSS'];

  // Generator & UX loading state
  const [isCompiling, setIsCompiling] = useState<boolean>(false);
  const [compilingStep, setCompilingStep] = useState<number>(0);
  const [isProposalReady, setIsProposalReady] = useState<boolean>(true); // Pre-default ready to let them see layout
  const [notificationMessage, setNotificationMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const activeContact = localContacts.find(c => c.id === selectedContactId) || localContacts[0];

  // Load backend proposal details
  const fetchProposalFromDb = async (contactId: string) => {
    const pId = `PROP-0${contactId}94`;
    try {
      const response = await fetch(`/api/proposals/${pId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.proposal) {
          setApiProposal(data.proposal);
          // Auto sync signature fields if signed
          if (data.proposal.status === 'accepted') {
            setIsMsaSigned(true);
            setProposalStatus('accepted');
            setMsaSignedName(data.proposal.signature_name || '');
            setMsaSignedTitle(data.proposal.signature_name ? 'Authorized Signatory' : '');
            setMsaSignDate(data.proposal.signed_at ? new Date(data.proposal.signed_at).toLocaleString() : '');
          } else {
            setIsMsaSigned(false);
            setMsaSignedName('');
            setMsaSignedTitle('');
            setMsaSignDate('');
          }
        }
      }
    } catch (err) {
      console.warn('[Proposal DB] Fetch failed, relying on dynamic frontend mock engine', err);
    }
  };

  // Sync profile when selected contact is changed, checking local auto-save draft first
  useEffect(() => {
    const profile = DEFAULT_PROFILES[selectedContactId] || DEFAULT_PROFILES['1'];
    
    // Check if an auto-saved draft exists in localStorage
    try {
      const savedRaw = localStorage.getItem(`crm_proposal_draft_${selectedContactId}`) || 
                       localStorage.getItem(`proposal_profile_${selectedContactId}`);
      if (savedRaw) {
        const saved = JSON.parse(savedRaw);
        if (saved.bottlenecks || saved.scopeRequirements) {
          setIndustry(saved.industry || profile.industry);
          setBottlenecksText(saved.bottlenecks || profile.bottlenecks);
          setScopeRequirementsText(saved.scopeRequirements || profile.scopeRequirements);
          if (Array.isArray(saved.selectedFrameworks)) setSelectedFrameworks(saved.selectedFrameworks);
          if (saved.pricingTier) setPricingTier(saved.pricingTier);
          if (saved.deliverySpeed) setDeliverySpeed(saved.deliverySpeed);
          if (saved.cloudDatabaseTarget) setCloudDatabaseTarget(saved.cloudDatabaseTarget);
          if (saved.status) setProposalStatus(saved.status);
          if (saved.savedAt || saved.updatedAt) {
            const timeStr = new Date(saved.savedAt || saved.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setLastAutoSavedAt(timeStr);
          }
          setIsDraftRestored(true);
          fetchProposalFromDb(selectedContactId);
          return;
        }
      }
    } catch (err) {
      console.warn('[Proposal] Failed to parse local auto-save draft:', err);
    }

    // Default fallback if no draft exists
    setIndustry(profile.industry);
    setBottlenecksText(profile.bottlenecks);
    setScopeRequirementsText(profile.scopeRequirements);
    setSelectedFrameworks(profile.defaultFrameworks);
    setProposalStatus('draft');
    setIsDraftRestored(false);
    fetchProposalFromDb(selectedContactId);
  }, [selectedContactId]);

  // Auto-save inputs (400ms debounce) to local storage so users don't lose progress on navigate or reload
  useEffect(() => {
    if (!bottlenecksText && !scopeRequirementsText) return;
    setAutoSaveStatus('saving');
    const timer = setTimeout(() => {
      try {
        const timestamp = new Date().toISOString();
        const payload = {
          contactId: selectedContactId,
          status: isMsaSigned ? 'accepted' : proposalStatus,
          bottlenecks: bottlenecksText,
          scopeRequirements: scopeRequirementsText,
          industry,
          selectedFrameworks,
          pricingTier,
          deliverySpeed,
          cloudDatabaseTarget,
          savedAt: timestamp
        };
        localStorage.setItem(`crm_proposal_draft_${selectedContactId}`, JSON.stringify(payload));
        localStorage.setItem(`proposal_profile_${selectedContactId}`, JSON.stringify({
          bottlenecks: bottlenecksText,
          scopeRequirements: scopeRequirementsText,
          updatedAt: timestamp
        }));
        setAutoSaveStatus('saved');
        setLastAutoSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (e) {
        console.warn("Could not auto-save proposal draft:", e);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [
    bottlenecksText, 
    scopeRequirementsText, 
    selectedContactId, 
    industry, 
    selectedFrameworks, 
    pricingTier, 
    deliverySpeed, 
    cloudDatabaseTarget, 
    proposalStatus, 
    isMsaSigned
  ]);

  const handleResetToDefaultProfile = () => {
    try {
      localStorage.removeItem(`crm_proposal_draft_${selectedContactId}`);
      localStorage.removeItem(`proposal_profile_${selectedContactId}`);
    } catch {
      // ignore
    }
    const profile = DEFAULT_PROFILES[selectedContactId] || DEFAULT_PROFILES['1'];
    setIndustry(profile.industry);
    setBottlenecksText(profile.bottlenecks);
    setScopeRequirementsText(profile.scopeRequirements);
    setSelectedFrameworks(profile.defaultFrameworks);
    setProposalStatus('draft');
    setIsDraftRestored(false);
    setLastAutoSavedAt(null);
    showToast('Reset proposal editor to default profile.', 'info');
  };

  // Toggle optional items in DB
  const handleToggleOptionalItemLink = async (itemId: string, currentSelected: boolean) => {
    const pId = `PROP-0${selectedContactId}94`;
    setIsSyncingItem(itemId);
    try {
      const response = await fetch(`/api/proposals/${pId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_selected: !currentSelected })
      });
      const resData = await response.json();
      if (response.ok && resData.success) {
        showToast('Optional item status synced with secure database.', 'success');
        await fetchProposalFromDb(selectedContactId);
      } else {
        showToast(resData.error || 'Failed to update item state.', 'error');
      }
    } catch (err) {
      // Fallback update in case of network variance
      if (apiProposal) {
        const updatedItems = apiProposal.items?.map((it: any) => 
          it.id === itemId ? { ...it, is_selected: !currentSelected } : it
        );
        setApiProposal({ ...apiProposal, items: updatedItems });
      }
      showToast('Offline fallback: toggled optional parameters.', 'info');
    } finally {
      setIsSyncingItem(null);
    }
  };

  // Signature Canvas Drawing State
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingSig, setIsDrawingSig] = useState<boolean>(false);
  const [hasCanvasSignature, setHasCanvasSignature] = useState<boolean>(false);

  const startDrawingSig = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#4338ca'; // Indigo-700
    setIsDrawingSig(true);
  };

  const drawSig = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawingSig) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.stroke();
    setHasCanvasSignature(true);
  };

  const stopDrawingSig = () => {
    setIsDrawingSig(false);
  };

  const clearCanvasSig = () => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasCanvasSignature(false);
  };

  const getCanvasDataUrl = () => {
    if (!sigCanvasRef.current || !hasCanvasSignature) return null;
    return sigCanvasRef.current.toDataURL('image/png');
  };

  // Stripe Checkout Flow
  const [isCreatingCheckout, setIsCreatingCheckout] = useState<boolean>(false);

  const handleStripeCheckout = async () => {
    setIsCreatingCheckout(true);
    const pId = `PROP-0${selectedContactId}94`;
    try {
      const response = await fetch(`/api/proposals/${pId}/stripe-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: computedFees.subtotal,
          currency: 'usd',
          successUrl: window.location.href + '?stripe_status=success',
          cancelUrl: window.location.href + '?stripe_status=cancelled'
        })
      });
      const data = await response.json();
      if (response.ok && data.success && data.checkoutUrl) {
        showToast('Stripe Checkout Session created! Opening payment gateway...', 'success');
        window.open(data.checkoutUrl, '_blank');
      } else {
        showToast(data.error || 'Failed to initialize Stripe checkout.', 'error');
      }
    } catch (err: any) {
      showToast('Stripe Checkout test session initialized.', 'info');
    } finally {
      setIsCreatingCheckout(false);
    }
  };

  // Sign Proposal via API
  const handleSignProposalSubmit = async () => {
    if (!msaSignedName.trim()) {
      showToast('Representative signature name is required to execute contract.', 'error');
      return;
    }
    const pId = `PROP-0${selectedContactId}94`;
    setIsSubmittingSign(true);

    const sigVector = getCanvasDataUrl();

    try {
      const response = await fetch(`/api/proposals/${pId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature_name: msaSignedName.trim(),
          signature_title: msaSignedTitle.trim() || 'Authorized Representative',
          signature_vector: sigVector,
          client_email: activeContact.email
        })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setIsMsaSigned(true);
        const dateString = new Date().toLocaleString();
        setMsaSignDate(dateString);
        setMsaSignedTitle(msaSignedTitle.trim() || 'Authorized Representative');
        showToast('Proposal executed successfully! Signature vector & audit IP logged.', 'success');
        await fetchProposalFromDb(selectedContactId);
      } else {
        showToast(data.error || 'Failed to countersign proposal.', 'error');
      }
    } catch (err) {
      // Offline fallback
      setIsMsaSigned(true);
      const dateString = new Date().toLocaleString();
      setMsaSignDate(dateString);
      setMsaSignedTitle(msaSignedTitle.trim() || 'Director & Lead Signatory');
      showToast('Offline Mode: Sovereign Signature Certificate recorded locally.', 'info');
    } finally {
      setIsSubmittingSign(false);
    }
  };

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotificationMessage({ text, type });
    setTimeout(() => setNotificationMessage(null), 4000);
  };

  const handleFrameworkToggle = (framework: string) => {
    if (selectedFrameworks.includes(framework)) {
      setSelectedFrameworks(selectedFrameworks.filter(f => f !== framework));
    } else {
      setSelectedFrameworks([...selectedFrameworks, framework]);
    }
  };

  const compilationSteps = [
    'Parsing dynamic contact profile constraints...',
    'Analyzing custom CRM discovery bottlenecks...',
    'Formulating tactical Scope of Work (SOW) items...',
    'Structuring security compliance regulations...',
    'Compiling chronological roadmap timeline...',
    'Resolving cloud-SQL database parameters and fee allocation...'
  ];

  // Simulation process
  const handleCompileProposalBtn = () => {
    setIsCompiling(true);
    setCompilingStep(0);
    setIsProposalReady(false);

    const interval = setInterval(() => {
      setCompilingStep((prev) => {
        if (prev >= compilationSteps.length - 1) {
          clearInterval(interval);
          setTimeout(() => {
            setIsCompiling(false);
            setIsProposalReady(true);
            showToast('SOW baseline successfully compiled with premium variables.', 'success');
          }, 300);
          return prev;
        }
        return prev + 1;
      });
    }, 400);
  };

  // Optional items list for local state management
  const OPTIONAL_ITEMS = [
    {
      id: 'extended-support',
      name: 'Extended Support',
      price: 8500,
      description: '24/7/365 priority response with 15-minute emergency SLA.'
    },
    {
      id: 'advanced-audit',
      name: 'Advanced Pen-Testing & Vulnerability Auditing',
      price: 7000,
      description: 'Multi-vector white-box penetration auditing with compliance reports.'
    },
    {
      id: 'redundancy',
      name: 'Multi-Region High Availability Synchronous Mirroring',
      price: 12000,
      description: 'Active-active hot state synchronization across secondary cloud nodes.'
    }
  ];

  // Pricing calculations
  const computedFees = (() => {
    const defaultProfile = DEFAULT_PROFILES[selectedContactId] || DEFAULT_PROFILES['1'];
    let base = defaultProfile.baseBudget;

    // Multipliers
    let pricingMultiplier = 1.0;
    if (pricingTier === 'Premium Enterprise') pricingMultiplier = 1.35;
    if (pricingTier === 'Emergency Fast-Track') pricingMultiplier = 1.60;

    let deliveryMultiplier = 1.0;
    if (deliverySpeed === 'Accelerated') deliveryMultiplier = 1.15;
    if (deliverySpeed === 'Express') deliveryMultiplier = 1.30;

    // Optional items price summation
    let optionalCost = 0;
    OPTIONAL_ITEMS.forEach((item) => {
      if (selectedAddonIds.includes(item.id)) {
        optionalCost += item.price;
      }
    });

    const frameworkCost = selectedFrameworks.length * 3500;
    const basePrice = Math.round(base * pricingMultiplier * deliveryMultiplier);
    const subtotal = basePrice + frameworkCost + optionalCost;
    
    return {
      subtotal,
      basePrice,
      frameworkCost,
      architecture: Math.round(subtotal * 0.25),
      development: Math.round(subtotal * 0.45),
      integration: Math.round(subtotal * 0.18),
      deployment: Math.round(subtotal * 0.12),
      optionalCost
    };
  })();

  const getSOWPhases = () => {
    return [
      {
        title: 'Phase 1: Architecture, Threat Modeling & Compliance Checkpoint',
        duration: deliverySpeed === 'Express' ? '1-2 Weeks' : deliverySpeed === 'Accelerated' ? '2 Weeks' : '2-3 Weeks',
        items: [
          `Architect and map enterprise secure components targeted for ${cloudDatabaseTarget} storage environments.`,
          `Formulate rigid encryption, transport controls and credentials mapping to support local regulations (${selectedFrameworks.join(' & ') || 'Standard Security Standards'}).`,
          "Perform initial baseline testing, construct target file system nodes, and sign off security boundary frameworks."
        ]
      },
      {
        title: 'Phase 2: Core Engineering & Database Index Formulations',
        duration: deliverySpeed === 'Express' ? '3 Weeks' : deliverySpeed === 'Accelerated' ? '4-5 Weeks' : '6 Weeks',
        items: [
          `Remediate specific identified constraints: "${bottlenecksText.substring(0, 115)}..."`,
          `Configure structural query maps inside ${cloudDatabaseTarget} utilizing high audit trails to mitigate systemic leaks.`,
          "Develop specialized middleware controllers, endpoint structures, and custom API routes."
        ]
      },
      {
        title: 'Phase 3: System Ingress Integrations & Analytics Sync',
        duration: deliverySpeed === 'Express' ? '1-2 Weeks' : deliverySpeed === 'Accelerated' ? '2 Weeks' : '3 Weeks',
        items: [
          `Integrate modern technical logic with CRM targets: "${scopeRequirementsText.substring(0, 110)}..."`,
          "Enact fault-tolerant webhook processors, network circuit-breakers, and live messaging updates.",
          "Establish high-contrast dashboard feeds revealing real-time logs and regulatory milestones."
        ]
      },
      {
        title: 'Phase 4: Sovereign Deployment Verification & SLA Transfer',
        duration: deliverySpeed === 'Express' ? '1 Week' : deliverySpeed === 'Accelerated' ? '1 Week' : '2 Weeks',
        items: [
          "Package and deploy modules onto target cloud runtime containers under rigid monitoring flags.",
          "Initiate rigorous system stress testing and automated notification alarms.",
          "Complete engineering documentation review, hand back systems keys, and establish primary SLA service agreements."
        ]
      }
    ];
  };

  const sowPhases = getSOWPhases();

  const timelinePhases: Phase[] = [
    {
      id: 'phase-1',
      title: 'Discovery & Threat Modeling Audit',
      duration: deliverySpeed === 'Express' ? '1-2 Weeks' : '2-3 Weeks',
      description: `Formulate compliance and target maps supporting local regulations (${selectedFrameworks.join(' & ') || 'Standard Security Standards'}).`,
      completed: isMsaSigned || completedPhases.includes('phase-1'),
      icon: 'Search'
    },
    {
      id: 'phase-2',
      title: 'Core Database & Middleware Formulation',
      duration: deliverySpeed === 'Express' ? '2 Weeks' : '3-4 Weeks',
      description: `Resolve key index parameters and configure storage queries under high security boundaries.`,
      completed: isMsaSigned || completedPhases.includes('phase-2'),
      icon: 'Layers'
    },
    {
      id: 'phase-3',
      title: 'Global Gateway & Ingress Integrations',
      duration: deliverySpeed === 'Express' ? '1-2 Weeks' : '2 Weeks',
      description: 'Enact microservice circuit-breakers and dispatch real-time dashboard telemetry.',
      completed: isMsaSigned || completedPhases.includes('phase-3'),
      icon: 'Database'
    },
    {
      id: 'phase-4',
      title: 'Cloud Run Orchestration & SLA Handover',
      duration: '1 Week',
      description: 'Package client audit artifacts into standard secure containers and trigger penetration verification filters.',
      completed: isMsaSigned || completedPhases.includes('phase-4'),
      icon: 'Rocket'
    }
  ];

  const getEmailContent = () => {
    const firstName = activeContact.name.split(' ')[0];
    const companyName = activeContact.company;
    const refId = `PROP-0${selectedContactId}94`;
    const docUrl = `https://proposals.obsidian.io/sign/${refId}`;
    
    let valueProp = "modernizing and optimizing your core operational flows";
    if (industry === 'Cloud SaaS') {
      valueProp = "resolving support routing silos and unifying WhatsApp, Telegram, and e-mail leads into a GDPR-secure cockpit";
    } else if (industry === 'Enterprise Logistics') {
      valueProp = "mitigating legacy backend webhook failures and implementing dual circuit-breaker routing configurations";
    } else if (industry === 'Fintech') {
      valueProp = "remediating transaction ledger audit trail gaps and deploying immutable PostgreSQL database parameters";
    }

    if (emailTone === 'ceo-formal') {
      return {
        subject: `Proposal: Workflow Modernization & SLA Framework for ${companyName}`,
        body: `Dear ${firstName},\n\nThank you for your valuable time during our recent discovery technical review. We thoroughly appreciated the opportunity to analyze your requirements at ${companyName}.\n\nOur tailored technical proposal specifically addresses your milestones regarding ${valueProp}. This framework establishes resilient processing loops and rigorous compliance configurations targeting your primary operating parameters.\n\nYou may access the complete scope of work, technical architecture, and legal terms at the secure corporate link listed below, which supports digital signatures to authorize the initiation phase:\n\n${docUrl}\n\nPlease let me know if you would like to arrange a brief call to align on these phases. I personally guarantee that our team will deliver an exceptional standard of performance.\n\nSincerely,\n\nRene Pierrette\nCEO, Obsidian Enterprise Solutions`
      };
    } else if (emailTone === 'ceo-urgent') {
      return {
        subject: `Priority Draft: Technical SOW & Modernization Proposal for ${companyName}`,
        body: `Hi ${firstName},\n\nFollowing our discovery session, I wanted to expedite our tailored strategy directly to your attention.\n\nOur core engineering team has designed a modernization roadmap to address your immediate bottlenecks. This tailored proposal specifically targets ${valueProp}, eliminating operating friction before it impacts performance thresholds.\n\nGiven the time-sensitive nature of your upcoming deployment timeline, we are prepared to allocate technical resources immediately upon authorization. Please review the digital SOW and sign to lock in our current delivery speed:\n\n${docUrl}\n\nI stand behind this implementation and look forward to partnering to deliver a highly robust platform for ${companyName}.\n\nBest regards,\n\nRene Pierrette\nCEO, Obsidian Enterprise Solutions`
      };
    } else {
      return {
        subject: `Tailored Proposal & Workflow Roadmap for ${companyName}`,
        body: `Hi ${firstName},\n\nIt was a pleasure speaking with you during our discovery session. I thoroughly enjoyed learning more about ${companyName} and your operational objectives.\n\nAs discussed, we have synthesized your requirements into a high-resilience architecture. This tailored proposal specifically addresses ${valueProp} to eliminate representative friction, maximize processing speed, and guarantee strict standard compliance.\n\nYou can review the full architecture, itemized phases, and SLA terms directly at the secure link below, where you can also digitally sign to initiate our kickoff:\n\n${docUrl}\n\nI am personally committed to this partnership and look forward to building a bulletproof engineering foundation for your team.\n\nWarm regards,\n\nRene Pierrette\nCEO, Obsidian Enterprise Solutions`
      };
    }
  };

  const triggerExport = async (method: 'markdown' | 'clipboard' | 'download_pdf') => {
    const documentRef = `PROP-0${selectedContactId}94-${Date.now().toString().slice(-4)}`;
    const proposalContent = `========================================================================
ENTERPRISE BUSINESS PROPOSAL: DIGITAL WORKFLOW MODERNIZATION
Reference ID: ${documentRef}
Prepared For: ${activeContact.company}
Target Executive: ${activeContact.name} (${activeContact.email})
Date Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
Author: Rene Pierrette, Enterprise Solutions Architect
========================================================================

1. EXECUTIVE SUMMARY
-------------------
Alpha-level assessment conducted for ${activeContact.company} indicates urgent technical boundaries and bottlenecks. 
Specifically, the client encounters immediate friction related to:
"${bottlenecksText}"

To address these hurdles, we propose an industrial-grade engineering plan focusing on:
"${scopeRequirementsText}"

Our methodology incorporates robust architectural patterns configured cleanly for ${cloudDatabaseTarget} storage with integrated cyber-security and compliance frameworks (${selectedFrameworks.join(', ') || 'Global standards'}).

2. SCOPE OF WORK (SOW) & PHASES
-------------------------------
${sowPhases.map((phase) => `
* ${phase.title} (Est. Duration: ${phase.duration})
  ${phase.items.map(item => `  - ${item}`).join('\n')}
`).join('\n')}

3. COMPLIANCE & UNDERWRITING STANDARDS
-------------------------------------
The proposed platform guarantees absolute runtime alignment with:
${selectedFrameworks.map(f => `* [COMPLIANT] ${f} Security Criteria`).join('\n')}

4. INVESTMENT SCHEDULE & MILESTONES
-----------------------------------
* Phase 1 (Architecture & Security Review): $${computedFees.architecture.toLocaleString()}
* Phase 2 (Core Development & Optimization): $${computedFees.development.toLocaleString()}
* Phase 3 (Integrations & Telemetry Verification): $${computedFees.integration.toLocaleString()}
* Phase 4 (Deployment & Handover): $${computedFees.deployment.toLocaleString()}
-----------------------------------
TOTAL INVESTMENT: $${computedFees.subtotal.toLocaleString()} USD
Pricing Tier Structure: ${pricingTier}
Target Database Layer: ${cloudDatabaseTarget}

========================================================================
END OF DOCUMENT - CONFIDENTIAL ALPHA BUSINESS PROPOSAL
========================================================================`;

    if (method === 'clipboard') {
      await copyToClipboard(proposalContent);
      showToast('Aesthetic Markdown SOW copied securely to your clipboard!', 'success');
    } else if (method === 'markdown') {
      const element = document.createElement('a');
      const file = new Blob([proposalContent], { type: 'text/plain' });
      element.href = URL.createObjectURL(file);
      element.download = `Proposal_${activeContact.company.replace(/\s+/g, '_')}.txt`;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      showToast('Enterprise Proposal Markdown file downloaded successfully!', 'success');
    } else {
      const pId = `PROP-0${selectedContactId}94`;
      window.open(`/api/proposals/${pId}/render-pdf`, '_blank');
      showToast('Rendering server-side dynamic contract PDF document...', 'success');
    }
  };

  return (
    <div className="space-y-6" id="proposals-tab-container">
      <header className="px-1">
        <h1 className="text-[22px] font-bold tracking-tight text-slate-900 dark:text-white">Advanced Invoice, Billing &amp; Subscription Management</h1>
        <p className="mt-0.5 text-[13px] text-slate-500">Invoices, subscriptions and payments through your own Stripe account.</p>
      </header>
      {/* TOP NAVIGATION TABS */}
      <div className="bg-white p-2 rounded-2xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setProposalsTabMode('invoicing')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              proposalsTabMode === 'invoicing'
                ? 'bg-black text-white shadow-xs'
                : 'text-slate-600 hover:text-black hover:bg-slate-50'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>Invoice</span>
          </button>

          <button
            type="button"
            onClick={() => setProposalsTabMode('payment_providers')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              proposalsTabMode === 'payment_providers'
                ? 'bg-black text-white shadow-xs'
                : 'text-slate-600 hover:text-black hover:bg-slate-50'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5 text-emerald-500" />
            <span>Payment Providers</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 font-semibold">
              Square · legacy
            </span>
          </button>

          <button
            type="button"
            onClick={() => setProposalsTabMode('proposals_hub')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              proposalsTabMode === 'proposals_hub'
                ? 'bg-black text-white shadow-xs'
                : 'text-slate-600 hover:text-black hover:bg-slate-50'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>SOW Proposals Hub</span>
          </button>
        </div>

        {proposalsTabMode !== 'invoicing' && (
        <div className="flex items-center gap-2 pr-1">
          <button
            type="button"
            onClick={() => setShowLogoModal(true)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs hover:border-slate-300"
            title="Upload custom logo or choose a preset"
          >
            {companyLogoUrl ? (
              <img src={companyLogoUrl} alt="Logo" className="w-4 h-4 object-contain rounded" />
            ) : (
              <Upload className="w-3.5 h-3.5 text-indigo-600" />
            )}
            <span>{companyLogoUrl ? 'Brand Logo' : '+ Add Logo'}</span>
          </button>
          <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 pl-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Real-time Invoicing Engine</span>
          </div>
        </div>
        )}
      </div>

      {proposalsTabMode === 'invoicing' ? (
        <InvoicingApp
          initialRoute={typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('billing') === 'stripe' ? { name: 'stripe' } : undefined}
          onOpenPaymentProviders={() => setProposalsTabMode('payment_providers')}
        />
      ) : proposalsTabMode === 'payment_providers' ? (
        <PaymentProvidersSettings 
          onGoToCreateInvoice={() => setProposalsTabMode('invoicing')} 
        />
      ) : (
        <div className="bg-slate-50 border border-slate-200/50 rounded-xl p-4 sm:p-6 space-y-6" id="proposal-dashboard-canvas">
          {/* TOAST NOTIFICATION POPUP */}
          <AnimatePresence>
            {notificationMessage && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`fixed top-6 right-6 z-50 p-4 rounded-xl shadow-xl border flex items-center gap-3 text-xs font-semibold ${
                  notificationMessage.type === 'success' 
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                    : notificationMessage.type === 'error' 
                      ? 'bg-rose-50 border-rose-200 text-rose-800' 
                      : 'bg-blue-50 border-blue-200 text-blue-800'
                }`}
              >
                {notificationMessage.type === 'success' ? (
                  <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 shrink-0" />
                ) : notificationMessage.type === 'error' ? (
                  <AlertCircle className="h-4.5 w-4.5 text-rose-600 shrink-0" />
                ) : (
                  <Sparkles className="h-4.5 w-4.5 text-blue-600 shrink-0" />
                )}
                <span>{notificationMessage.text}</span>
              </motion.div>
            )}
          </AnimatePresence>

      {/* HEADER HERO BOARD - DEEP NAVY BLUE PANEL */}
      <div className="rounded-xl bg-slate-950 text-white p-6 shadow-md border border-slate-900 relative overflow-hidden" id="proposals-hero-section">
        {/* Subtle decorative grid background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:14px_24px]" />
        <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
        
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6 z-10">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/20 border border-indigo-400/30 px-2.5 py-0.5 text-[10px] font-mono uppercase font-bold text-indigo-300">
              <Sparkles className="h-3 w-3 animate-pulse" />
              <span>Enterprise Sales Cockpit</span>
            </div>
            <h1 className="font-sans font-extrabold text-xl sm:text-2xl text-white tracking-tight">
              Enterprise SOW & Proposal Hub
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
              Compile tailored technical agreements mapped directly with active CRM leads, interactive databases and security compliance frameworks in real-time.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowLogoModal(true)}
              className="rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-bold px-3.5 py-2.5 transition-all cursor-pointer flex items-center gap-1.5 backdrop-blur-xs"
              title="Customize company logo & branding"
            >
              <Upload className="h-3.5 w-3.5 text-indigo-300" />
              <span>{companyLogoUrl ? 'Change Logo' : 'Add Logo'}</span>
            </button>
            <button
              onClick={() => {
                setSelectedContactId('1');
                setPricingTier('Standard');
                setDeliverySpeed('Normal');
                setIsProposalReady(true);
                showToast('Reset core variables to default parameters.', 'info');
              }}
              className="rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-bold px-3.5 py-2.5 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5 text-indigo-400" />
              <span>Reset</span>
            </button>
            <button
              onClick={handleCompileProposalBtn}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2.5 transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-indigo-600/10"
            >
              <FileCode className="h-3.5 w-3.5" />
              <span>Compile Draft</span>
            </button>
          </div>
        </div>
      </div>

      {/* RESPONSIVE TWO COLUMN DASHBOARD CONTAINER */}
      <div className="flex flex-col lg:flex-row gap-6 relative items-start" id="proposal-dashboard-container">
        
        {/* LEFT COLUMN: MAIN CONTENTS (65-70% width) */}
        <div className="w-full lg:w-[67%] space-y-6" id="proposal-left-column">
          
          <AnimatePresence mode="wait">
            {isCompiling ? (
              /* AESTHETIC COMPILING LOADER OVERLAY */
              <motion.div
                key="compiling"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-white rounded-xl border border-slate-200 p-8 sm:p-12 text-center flex flex-col items-center justify-center min-h-[500px]"
              >
                <div className="relative mb-6">
                  <div className="h-16 w-16 rounded-full border-4 border-indigo-600/10 border-t-indigo-600 animate-spin" />
                  <FileText className="absolute top-5 left-5 h-6 w-6 text-indigo-600 animate-pulse" />
                </div>
                <h3 className="font-sans font-bold text-sm text-slate-800 mb-4">
                  Constructing Custom Service Agreement SOW...
                </h3>

                <div className="w-full max-w-sm space-y-2 mt-4 text-left font-mono text-[10.5px]">
                  {compilationSteps.map((step, idx) => {
                    const isPending = idx > compilingStep;
                    const isActive = idx === compilingStep;
                    const isDone = idx < compilingStep;

                    return (
                      <div 
                        key={idx} 
                        className={`flex items-center gap-2.5 py-1.5 px-3 rounded-lg border transition-all ${
                          isActive 
                            ? 'bg-indigo-50 border-indigo-100 text-indigo-700 font-bold' 
                            : isDone 
                              ? 'bg-slate-50 border-slate-100 text-emerald-600' 
                              : 'bg-transparent border-transparent text-slate-400'
                        }`}
                      >
                        {isDone ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : isActive ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-600 shrink-0" />
                        ) : (
                          <Clock className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                        )}
                        <span className="truncate">{step}</span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ) : !isProposalReady ? (
              /* BLANK STATE INTERACTION SCREEN */
              <motion.div
                key="blank-state"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center flex flex-col items-center justify-center min-h-[420px]"
              >
                <FileText className="h-12 w-12 text-slate-300 mb-4" />
                <h3 className="font-sans font-bold text-slate-800 text-sm">Proposal Assembly Required</h3>
                <p className="text-xs text-slate-500 max-w-md mt-2">
                  Please review client credentials, select compliance checklists or click "Compile SOW Draft" to build your custom timeline structure.
                </p>
                <button
                  onClick={handleCompileProposalBtn}
                  className="mt-6 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 cursor-pointer shadow"
                >
                  Compile Custom SOW
                </button>
              </motion.div>
            ) : (
              /* DUAL SEGMENT LAYOUT */
              <motion.div
                key="proposal-content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                {/* SUB DOCUMENT VIEW SWITCHER */}
                <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                  <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button
                      onClick={() => setActiveSubTab('document')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                        activeSubTab === 'document'
                          ? 'bg-white text-slate-800 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>SOW Agreement</span>
                    </button>
                    <button
                      onClick={() => setActiveSubTab('email')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                        activeSubTab === 'email'
                          ? 'bg-white text-slate-800 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      <span>CEO Cover Mail</span>
                    </button>
                    <button
                      onClick={() => setActiveSubTab('msa')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                        activeSubTab === 'msa'
                          ? 'bg-white text-slate-800 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Shield className="h-3.5 w-3.5" />
                      <span>MSA Contract</span>
                    </button>
                  </div>

                  {/* Middle: Draft Status & Auto-save Status Indicator */}
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border bg-slate-50 border-slate-200">
                      <span className={`w-2 h-2 rounded-full ${
                        proposalStatus === 'accepted' 
                          ? 'bg-emerald-500' 
                          : proposalStatus === 'sent' 
                          ? 'bg-blue-500' 
                          : 'bg-amber-500 animate-pulse'
                      }`} />
                      <span className="text-[10px] font-mono uppercase font-bold text-slate-500">Status:</span>
                      <select
                        value={proposalStatus}
                        onChange={(e) => {
                          const newStatus = e.target.value as any;
                          setProposalStatus(newStatus);
                          showToast(`Proposal status marked as ${newStatus.toUpperCase()}`, 'info');
                        }}
                        className="text-[11px] font-bold text-slate-800 bg-transparent border-none outline-none cursor-pointer pr-1"
                      >
                        <option value="draft">Draft (Unpublished)</option>
                        <option value="under_review">Under Review</option>
                        <option value="sent">Sent to Client</option>
                        <option value="accepted">Accepted / Signed</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                      {autoSaveStatus === 'saving' ? (
                        <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60">
                          <RefreshCw className="h-3 w-3 animate-spin text-amber-500" />
                          <span>Saving draft...</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/60" title="Your edits are saved locally and survive reloads or navigation">
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          <span>Auto-saved {lastAutoSavedAt ? `at ${lastAutoSavedAt}` : 'locally'}</span>
                        </span>
                      )}

                      {isDraftRestored && (
                        <button
                          type="button"
                          onClick={handleResetToDefaultProfile}
                          className="text-[10px] text-slate-400 hover:text-rose-600 underline cursor-pointer ml-1"
                          title="Discard auto-saved draft and restore default template"
                        >
                          Reset Default
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => triggerExport('clipboard')}
                      className="rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[10.5px] font-bold px-3 py-1.5 transition-all text-slate-600 flex items-center gap-1 cursor-pointer font-mono uppercase"
                    >
                      <Copy className="h-3.5 w-3.5 text-slate-400" />
                      <span>Copy</span>
                    </button>
                    <button
                      onClick={() => triggerExport('markdown')}
                      className="rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[10.5px] font-bold px-3 py-1.5 transition-all text-slate-600 flex items-center gap-1 cursor-pointer font-mono uppercase"
                    >
                      <FileCode className="h-3.5 w-3.5 text-indigo-500" />
                      <span>MD Download</span>
                    </button>
                    <button
                      onClick={() => triggerExport('download_pdf')}
                      className="rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 text-[10.5px] font-bold px-3 py-1.5 transition-all text-slate-600 flex items-center gap-1 cursor-pointer font-mono uppercase"
                    >
                      <Download className="h-3.5 w-3.5 text-emerald-500" />
                      <span>PDF</span>
                    </button>
                  </div>
                </div>

                {/* TAB 1: STATEMENT OF WORK (SOW) */}
                {activeSubTab === 'document' && (
                  <div className="space-y-6" id="sow-agreement-pane">
                    
                    {/* SCOPE CARD: CUSTOMER SOW AGREEMENT */}
                    <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 border-b border-slate-100 pb-5">
                        <div className="flex items-start gap-4">
                          {companyLogoUrl ? (
                            <div 
                              onClick={() => setShowLogoModal(true)}
                              className="relative group cursor-pointer shrink-0"
                              title="Click to customize company logo"
                            >
                              <img
                                src={companyLogoUrl}
                                alt={businessName}
                                style={{ height: `${companyLogoHeight || 38}px` }}
                                className="max-w-[130px] object-contain rounded-xl border border-slate-200/90 p-1 bg-white shadow-xs"
                              />
                              <span className="absolute -bottom-1 -right-1 p-1 rounded-full bg-slate-900 text-white text-[9px] opacity-0 group-hover:opacity-100 transition-opacity">
                                <Upload className="w-2.5 h-2.5" />
                              </span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setShowLogoModal(true)}
                              className="h-11 px-3 rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50 hover:bg-indigo-50/50 flex flex-col items-center justify-center text-slate-400 hover:text-indigo-600 transition-all cursor-pointer text-[10px] font-bold shrink-0"
                              title="Add custom company logo"
                            >
                              <Upload className="w-3.5 h-3.5 mb-0.5 text-indigo-500" />
                              <span>+ Add Logo</span>
                            </button>
                          )}
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="p-1 px-2 rounded bg-indigo-50 border border-indigo-100 text-xs font-mono font-bold text-indigo-700">
                                {businessName.toUpperCase()} SOW
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">ID: SOW-PROP-{selectedContactId}94</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wide border ${
                                proposalStatus === 'accepted' 
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                                  : proposalStatus === 'sent' 
                                  ? 'bg-blue-50 text-blue-700 border-blue-200' 
                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}>
                                {proposalStatus === 'draft' ? 'Status: Draft' : `Status: ${proposalStatus.replace('_', ' ')}`}
                              </span>
                              <button
                                type="button"
                                onClick={() => setShowLogoModal(true)}
                                className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer underline underline-offset-2 ml-1"
                              >
                                {companyLogoUrl ? 'Change Logo' : 'Upload Logo'}
                              </button>
                            </div>
                            <h2 className="font-sans font-bold text-lg text-slate-800 mt-1">
                              Technical Scope of Work (SOW) & Client Requirements
                            </h2>
                            <p className="text-xs text-slate-500 font-medium">Prepared for: {activeContact.company} by {businessName}</p>
                          </div>
                        </div>
                        <div className="sm:text-right text-[10.5px] text-slate-500 font-mono leading-none">
                          <p className="font-bold text-slate-700">DATE GENERATED</p>
                          <p className="mt-1 text-slate-900 font-semibold">{new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                        </div>
                      </div>

                      {/* EDITABLE BOTTLENECK DISCOVERY FEEDBACK */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="h-3.5 w-1 bg-indigo-600 rounded" />
                          <h4 className="text-xs font-bold uppercase text-slate-700 tracking-wide font-mono">
                            Client Discovery Findings & Hot Bottlenecks
                          </h4>
                        </div>
                        
                        <div className="relative group">
                          <textarea
                            value={bottlenecksText}
                            onChange={(e) => setBottlenecksText(e.target.value)}
                            rows={3}
                            className="w-full text-xs bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-slate-600 font-sans focus:outline-none focus:ring-1 focus:ring-indigo-500/30 focus:border-indigo-300 leading-relaxed transition-all"
                            placeholder="Current customer operational log bottlenecks..."
                          />
                          <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-mono font-semibold bg-slate-950 text-white rounded px-1.5 py-0.5">
                            Auto-Syncing
                          </div>
                        </div>
                      </div>

                      {/* CLIENT VALUE DELIVERABLES */}
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="h-3.5 w-1 bg-indigo-600 rounded" />
                          <h4 className="text-xs font-bold uppercase text-slate-700 tracking-wide font-mono">
                            Strategic Engineering Solution Blueprint
                          </h4>
                        </div>
                        
                        <div className="relative group">
                          <textarea
                            value={scopeRequirementsText}
                            onChange={(e) => setScopeRequirementsText(e.target.value)}
                            rows={3}
                            className="w-full text-xs bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 text-slate-700 font-medium font-sans focus:outline-none focus:ring-1 focus:ring-indigo-500/30 focus:border-indigo-300 leading-relaxed transition-all"
                            placeholder="Proposed core technical solutions and system designs..."
                          />
                          <div className="absolute right-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-mono font-semibold bg-slate-950 text-white rounded px-1.5 py-0.5">
                            Auto-Syncing
                          </div>
                        </div>
                      </div>

                      {/* COMPLIANCE CHIPS SELECTOR */}
                      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase">Interactive Security Checklist</span>
                          <span className="text-[9px] text-indigo-600 bg-indigo-50 rounded px-1.5 font-semibold">Underwriting active</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {availableFrameworks.map((f) => {
                            const isChecked = selectedFrameworks.includes(f);
                            return (
                              <button
                                key={f}
                                type="button"
                                onClick={() => handleFrameworkToggle(f)}
                                className={`flex items-center gap-1.5 text-[10.5px] p-2 rounded-lg border font-mono font-medium transition-all ${
                                  isChecked 
                                    ? 'bg-indigo-600/10 border-indigo-500/30 text-indigo-700 font-semibold' 
                                    : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'
                                }`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${isChecked ? 'bg-indigo-600' : 'bg-slate-300'}`} />
                                {f}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                    </div>

                    {/* SOW CONTENT CARD: CHRONOLOGICAL PROJECT MILESTONES */}
                    <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6" id="sow-milestone-phases">
                      <div className="space-y-1">
                        <h3 className="font-sans font-bold text-base text-slate-800">
                          SOW Phases & Milestone Estimates
                        </h3>
                        <p className="text-xs text-slate-500">
                          Milestones can be structured with specific functional parameters and checkpoints.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 gap-4">
                        {sowPhases.map((phase, idx) => (
                          <div key={idx} className="p-5 rounded-xl border border-slate-150 bg-slate-50/50 hover:bg-slate-50 transition-colors space-y-3">
                            <div className="flex items-center justify-between border-b border-slate-100 pb-2 flex-wrap gap-2">
                              <span className="text-xs font-bold text-slate-800 font-sans">{phase.title}</span>
                              <span className="rounded-full bg-indigo-50 border border-indigo-100 text-[9.5px] font-mono font-bold uppercase text-indigo-700 px-2.5 py-0.5">
                                Est: {phase.duration}
                              </span>
                            </div>
                            <ul className="space-y-2">
                              {phase.items.map((item, idy) => (
                                <li key={idy} className="text-xs text-slate-600 flex items-start gap-2 leading-relaxed">
                                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>

                    </div>

                    {/* TIMELINE CARD: INTERACTIVE DELIVERY CHRONOLOGY */}
                    <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6" id="timeline-chronology">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-100 pb-4">
                        <div className="space-y-1">
                          <h3 className="font-sans font-bold text-base text-slate-800 flex items-center gap-2">
                            <Clock className="h-5 w-5 text-indigo-500" />
                            <span>Implementation Phases & Critical Paths</span>
                          </h3>
                          <p className="text-xs text-slate-500">
                            Real-time milestone progress tracking for {activeContact.company}.
                          </p>
                        </div>
                        {/* Inline progress status indicators */}
                        <div className="text-xs font-mono font-semibold bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg px-2.5 py-1 flex items-center gap-1.5 shrink-0 shadow-sm">
                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-ping" />
                          <span>Progress: {timelinePhases.filter(p => p.completed).length}/{timelinePhases.length} Done</span>
                        </div>
                      </div>

                      {/* Interactive phase controller to manually toggle completion */}
                      <div className="p-3 bg-slate-50 border border-slate-150 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase">Phase Quality Sign-off Controls</span>
                          <span className="text-[9px] text-slate-400 font-mono italic">Click to sign-off metrics</span>
                        </div>
                        <div className="flex flex-wrap gap-2.5">
                          {timelinePhases.map((phase) => {
                            const isChecked = phase.completed;
                            const isEditable = !isMsaSigned; // If MSA is signed, everything is locked as completed!
                            return (
                              <button
                                key={phase.id}
                                disabled={!isEditable}
                                onClick={() => {
                                  if (completedPhases.includes(phase.id)) {
                                    setCompletedPhases(completedPhases.filter(id => id !== phase.id));
                                    showToast(`${phase.title} completion status revoked.`, 'info');
                                  } else {
                                    setCompletedPhases([...completedPhases, phase.id]);
                                    showToast(`${phase.title} successfully signed off!`, 'success');
                                  }
                                }}
                                className={`flex items-center gap-1.5 text-[10.5px] px-2.5 py-1 rounded-lg border font-medium transition-all ${
                                  isChecked 
                                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold' 
                                    : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800'
                                } ${!isEditable ? 'opacity-80 cursor-not-allowed' : 'cursor-pointer'}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${isChecked ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                                <span>{phase.id.replace('phase-', 'Phase ')}</span>
                              </button>
                            );
                          })}
                        </div>
                        {isMsaSigned && (
                          <div className="text-[9.5px] text-emerald-700 flex items-center gap-1 font-mono pt-0.5 animate-pulse">
                            <CheckSquare className="h-3 w-3 shrink-0" />
                            <span>MSA is fully countersigned — All engineering gates are authorized!</span>
                          </div>
                        )}
                      </div>

                      {/* REUSABLE VERTICAL TIMELINE INSTANCE */}
                      <VerticalTimeline phases={timelinePhases} />

                    </div>

                    {/* FINANCIAL SPREADSHEET CARD */}
                    <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-5" id="sow-financial-split">
                      <div className="space-y-1">
                        <h3 className="font-sans font-bold text-base text-slate-800">
                          Phase-Based Invoice Allocation Table
                        </h3>
                        <p className="text-xs text-slate-500">
                          Reconciled according to specialized engineering metrics under Net-30 invoice rules.
                        </p>
                      </div>

                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-200/50 font-mono text-[9.5px] uppercase tracking-wider text-slate-600">
                              <th className="p-3 font-bold">Chronological Work Phases</th>
                              <th className="p-3 font-bold text-right">Fund Allocation Allocation</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-150">
                            <tr>
                              <td className="p-3">
                                <span className="font-bold text-slate-800 block">Phase 1: Compliance, Threat Models & Architecture</span>
                                <span className="text-[10px] text-slate-500 block">Security review parameters and cloud container initialization</span>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-slate-700">
                                ${computedFees.architecture.toLocaleString()} USD
                              </td>
                            </tr>
                            <tr>
                              <td className="p-3">
                                <span className="font-bold text-slate-800 block">Phase 2: Core Engineering & Database Optimization</span>
                                <span className="text-[10px] text-slate-500 block">High performance controllers, indexes and query formulation</span>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-slate-700">
                                ${computedFees.development.toLocaleString()} USD
                              </td>
                            </tr>
                            <tr>
                              <td className="p-3">
                                <span className="font-bold text-slate-800 block">Phase 3: System Ingress & Analytical Sync</span>
                                <span className="text-[10px] text-slate-500 block">Central webhooks and encrypted notification pipelines</span>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-slate-700">
                                ${computedFees.integration.toLocaleString()} USD
                              </td>
                            </tr>
                            <tr>
                              <td className="p-3">
                                <span className="font-bold text-slate-800 block">Phase 4: Launch Testing & Operations Transfer</span>
                                <span className="text-[10px] text-slate-500 block">Verification checkups, penetration reports and handbacks</span>
                              </td>
                              <td className="p-3 text-right font-mono font-bold text-slate-700">
                                ${computedFees.deployment.toLocaleString()} USD
                              </td>
                            </tr>
                            {computedFees.optionalCost > 0 && (
                              <tr className="bg-amber-50/50">
                                <td className="p-3">
                                  <span className="font-bold text-amber-800 block">Database Optional Add-On Packages</span>
                                  <span className="text-[10px] text-amber-600 block">Custom selected integrations mapped from secure API parameters</span>
                                </td>
                                <td className="p-3 text-right font-mono font-bold text-amber-700">
                                  +${computedFees.optionalCost.toLocaleString()} USD
                                </td>
                              </tr>
                            )}
                            <tr className="bg-indigo-50 font-bold border-t-2 border-indigo-100 uppercase">
                              <td className="p-3 text-indigo-900 font-sans font-extrabold text-xs">Total SOW Framework Cost</td>
                              <td className="p-3 text-right font-mono text-indigo-700 text-sm">
                                ${computedFees.subtotal.toLocaleString()} USD
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                    </div>

                  </div>
                )}

                {/* TAB 2: CEO COVER EMAIL LETTER */}
                {activeSubTab === 'email' && (
                  <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6" id="sow-cover-email-pane">
                    
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                      <div className="space-y-0.5">
                        <h3 className="font-sans font-bold text-sm text-slate-800">CEO Private Transmission Link</h3>
                        <p className="text-[9px] font-mono uppercase tracking-wider text-slate-400">Secure SMTP Pipeline Delivery</p>
                      </div>

                      {/* Tone Switcher */}
                      <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                        <button
                          onClick={() => setEmailTone('ceo-warm')}
                          className={`px-2.5 py-1 rounded font-semibold transition-all cursor-pointer ${
                            emailTone === 'ceo-warm' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          🌟 Warm
                        </button>
                        <button
                          onClick={() => setEmailTone('ceo-formal')}
                          className={`ml-1 px-2.5 py-1 rounded font-semibold transition-all cursor-pointer ${
                            emailTone === 'ceo-formal' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          👔 Formal
                        </button>
                        <button
                          onClick={() => setEmailTone('ceo-urgent')}
                          className={`ml-1 px-2.5 py-1 rounded font-semibold transition-all cursor-pointer ${
                            emailTone === 'ceo-urgent' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          ⚡ Priority
                        </button>
                      </div>
                    </div>

                    {/* Email Headers layout */}
                    <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 text-xs font-mono space-y-2 text-slate-600">
                      <div><strong className="text-slate-400">FROM:</strong> Rene Pierrette <span className="text-slate-500">&lt;rene.pierrette@obsidian.io&gt;</span></div>
                      <div className="border-t border-slate-150 pt-2"><strong className="text-slate-400">TO:</strong> {activeContact.name} <span className="text-slate-500">&lt;{activeContact.email}&gt;</span></div>
                      <div className="border-t border-slate-150 pt-2"><strong className="text-slate-400">SUBJECT:</strong> <span className="text-slate-800 font-bold">{getEmailContent().subject}</span></div>
                    </div>

                    {/* Email Body */}
                    <div className="bg-slate-50 border border-slate-200 p-6 rounded-xl font-sans text-xs text-slate-700 leading-relaxed whitespace-pre-wrap select-text">
                      {getEmailContent().body}
                    </div>

                  </div>
                )}

                {/* TAB 3: MSA CONTRACT REVIEW */}
                {activeSubTab === 'msa' && (
                  <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6" id="sow-msa-pane">
                    
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-4">
                      <div>
                        <h3 className="font-sans font-bold text-sm text-slate-800 flex items-center gap-1.5">
                          <Shield className="h-4 w-4 text-indigo-600" />
                          <span>Mutual Master Services Agreement (MSA)</span>
                        </h3>
                        <p className="text-[10px] uppercase font-mono text-slate-400">Legal Counsel Sovereignty Contract</p>
                      </div>

                      {/* State badge */}
                      <div>
                        {isMsaSigned ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-[10px] font-bold font-mono text-emerald-700 uppercase">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Binding Agreement Sealed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-[10px] font-bold font-mono text-amber-700 uppercase">
                            Pending Signed Authorization
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="bg-slate-50 text-xs font-mono p-4 border border-slate-150 rounded-xl text-slate-600 space-y-1">
                      <div><strong>CONTRACT REF:</strong> PROP-ID-{selectedContactId}094-MSA</div>
                      <div><strong>PROVIDER PARTY:</strong> Obsidian Solutions LLC</div>
                      <div><strong>CLIENT PARTY:</strong> {activeContact.company}</div>
                      <div><strong>STATE COURT LOCATION:</strong> Miami-Dade County, Florida</div>
                    </div>

                    {/* Legal Scrollable Container */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl leading-relaxed font-serif text-slate-700 text-xs p-6 h-[280px] overflow-y-auto space-y-4 select-text relative">
                      
                      <div className="text-center space-y-1.5 border-b border-slate-200 pb-4">
                        <div className="font-sans font-extrabold text-slate-900 tracking-wider text-xs uppercase">MASTER SERVICES COVENANT</div>
                        <div className="text-[9.5px] font-mono text-slate-400">Ref ID: PROP-0{selectedContactId}94-MSA</div>
                      </div>

                      <p className="indent-4">
                        This Master Services Agreement is executed of the primary agreement timeline between the respective providers <span className="font-sans font-bold text-slate-900">Obsidian Solutions LLC</span> and the active logged lead <span className="font-sans font-bold text-slate-900">{activeContact.company}</span>. 
                      </p>

                      <h4 className="font-sans font-bold text-xs uppercase tracking-wide text-slate-800 border-b border-slate-200 mt-4 pb-0.5">
                        SECTION 1: DISCOVERY LOG TRANSFER
                      </h4>
                      <p className="indent-4 text-slate-600">
                        Provider will implement specific secure integrations and databases to remediate technical bottlenecks identified under discovery audits. Both Parties recognize milestones as active indicators of performance variables.
                      </p>

                      <h4 className="font-sans font-bold text-xs uppercase tracking-wide text-slate-800 border-b border-slate-200 mt-4 pb-0.5">
                        SECTION 2: IP TRANSFER RULESET
                      </h4>
                      <p className="indent-4 text-slate-600 underline">
                        All relevant custom target codes, backend configuration files and database files developed under this SOW shall vest fully in client *only and exclusively upon Client's full, cleared payment* of all milestone fees.
                      </p>

                      <h4 className="font-sans font-bold text-xs uppercase tracking-wide text-slate-800 border-b border-slate-200 mt-4 pb-0.5">
                        SECTION 3: DATA JURISDICTION
                      </h4>
                      <p className="indent-4 text-slate-600">
                        Services will stay compliant with rigorous security protocols: {selectedFrameworks.join(', ') || 'Standard Covenants'}. Florida State Jurisdiction governs all disputes.
                      </p>

                      {isMsaSigned && (
                        <div className="absolute top-[35%] left-[50%] -translate-x-[50%] -translate-y-[50%] rotate-6 border-4 border-emerald-500 bg-white text-emerald-600 font-sans tracking-widest uppercase font-black px-6 py-4 text-base rounded shadow-2xl text-center select-none pointer-events-none z-10">
                          <span className="text-[9px] block font-mono text-slate-400 font-normal">Sovereign Validation Seal</span>
                          CONTRACT CERTIFIED
                          <span className="text-[9px] block font-mono text-slate-500 mt-0.5">SHA-256 SECURE COU-ID</span>
                        </div>
                      )}
                    </div>

                  </div>
                )}

              </motion.div>
            )}
          </AnimatePresence>

        </div>

        {/* RIGHT COLUMN: STICKY PARAMETERS & LIVE PRICE GENERATOR (30-35% width) */}
        <div className="w-full lg:w-[33%] lg:sticky lg:top-6 space-y-6 shrink-0" id="proposal-right-column">
          
          {/* CARD 1: DISCOVERY CONTACT PROFILE PICKER */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4" id="lead-selection-widget">
            <div className="flex items-center gap-2 border-b border-slate-150 pb-2.5">
              <UserCheck className="h-4 w-4 text-indigo-600" />
              <h3 className="font-sans font-extrabold text-xs uppercase tracking-wider text-slate-700">
                1. Select Account Lead
              </h3>
            </div>

            {/* List button selectors */}
            <div className="space-y-2">
              {localContacts.map((c) => {
                const isActive = c.id === selectedContactId;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedContactId(c.id)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all ${
                      isActive 
                        ? 'bg-slate-950 border-slate-900 text-white shadow-lg shadow-slate-950/20' 
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img 
                        src={c.avatar} 
                        alt={c.name} 
                        className="h-8 w-8 rounded-lg bg-slate-200 object-cover border border-white/5 shadow-inner shrink-0" 
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0 leading-tight">
                        <span className={`text-[11px] font-bold block truncate ${isActive ? 'text-white' : 'text-slate-800'}`}>
                          {c.name}
                        </span>
                        <span className={`text-[9.5px] block truncate ${isActive ? 'text-slate-400 font-mono' : 'text-slate-500'}`}>
                          {c.company}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className={`h-4.5 w-4.5 shrink-0 transition-transform ${isActive ? 'text-indigo-400 translate-x-0.5' : 'text-slate-400'}`} />
                  </button>
                );
              })}
            </div>

            {/* Advanced target selections */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-150">
              <div className="space-y-1">
                <label className="block text-[9.5px] font-mono font-bold uppercase tracking-wider text-slate-500">Industry Sector</label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value as any)}
                  className="w-full rounded bg-slate-50 border border-slate-200 p-1.5 text-[11px] text-slate-700 outline-none focus:border-indigo-500 cursor-pointer font-sans"
                >
                  <option value="Cloud SaaS">Cloud SaaS</option>
                  <option value="Fintech">Financial Tech</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Enterprise Logistics">Logistics</option>
                  <option value="E-commerce">E-commerce</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[9.5px] font-mono font-bold uppercase tracking-wider text-slate-500">Sovereign DB</label>
                <select
                  value={cloudDatabaseTarget}
                  onChange={(e) => setCloudDatabaseTarget(e.target.value as any)}
                  className="w-full rounded bg-slate-50 border border-slate-200 p-1.5 text-[11px] text-slate-700 outline-none focus:border-indigo-500 cursor-pointer font-mono"
                >
                  <option value="PostgreSQL JSONB">PostgreSQL</option>
                  <option value="Google Cloud">Cloud SQL</option>
                  <option value="Firebase Firestore">Firestore</option>
                </select>
              </div>
            </div>
          </div>

          {/* CARD 2: STICKY LIVE INVESTMENT ESTIMATE & DB CHECKBOXES */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4" id="pricing-calculator-widget">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4.5 w-4.5 text-emerald-600" />
                <h3 className="font-sans font-bold text-xs uppercase tracking-wider text-slate-700">
                  Investment Breakdown
                </h3>
              </div>
              <span className="text-[9px] font-mono font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded uppercase">
                Required & Optional
              </span>
            </div>

            {/* Price Line Items list */}
            <div className="space-y-3">
              {/* Required Base Price */}
              <div className="flex items-start justify-between p-3 rounded-lg border border-slate-200/80 bg-slate-50/50">
                <div className="min-w-0 pr-2">
                  <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1 flex-wrap">
                    Base Project Fee
                    <span className="text-[8.5px] font-mono font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-100 px-1 py-0.5 rounded">Required</span>
                  </span>
                  <p className="text-[9.5px] text-slate-500 mt-1 leading-normal">
                    Target database architecture logic, active verification, and automated notification loops.
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="font-mono text-xs font-bold text-slate-850">
                    ${computedFees.basePrice.toLocaleString()}
                  </span>
                  <span className="text-[9.5px] text-slate-400 block font-mono">USD</span>
                </div>
              </div>

              {/* Dynamic Optional Line Items */}
              <div className="space-y-2">
                <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-indigo-700 mt-2">
                  Optional Add-on Deliverables
                </span>

                <div className="space-y-2">
                  {OPTIONAL_ITEMS.map((item) => {
                    const isChecked = selectedAddonIds.includes(item.id);
                    return (
                      <div 
                        key={item.id}
                        onClick={() => {
                          let newSelected;
                          if (isChecked) {
                            newSelected = selectedAddonIds.filter(id => id !== item.id);
                            showToast(`${item.name} removed from contract total.`, 'info');
                          } else {
                            newSelected = [...selectedAddonIds, item.id];
                            showToast(`${item.name} successfully activated in contract total!`, 'success');
                          }
                          setSelectedAddonIds(newSelected);
                        }}
                        className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all ${
                          isChecked 
                            ? 'bg-indigo-50/40 border-indigo-200 text-slate-900 shadow-sm' 
                            : 'bg-white border-slate-250 text-slate-500 hover:bg-slate-50 hover:border-slate-350 hover:text-slate-800'
                        } cursor-pointer group`}
                      >
                        <div className="mt-0.5 shrink-0">
                          <div className={`h-4.5 w-4.5 rounded flex items-center justify-center border transition-all ${
                            isChecked 
                              ? 'bg-indigo-600 border-indigo-600 text-white' 
                              : 'bg-white border-slate-300 group-hover:border-indigo-400'
                          }`}>
                            {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                          </div>
                        </div>
                        <div className="min-w-0 leading-normal flex-1">
                          <span className="text-[11px] font-bold block text-slate-850 group-hover:text-slate-900">
                            {item.name}
                          </span>
                          <span className="text-[9.5px] block text-slate-400 mt-1 leading-normal">
                            {item.description}
                          </span>
                          <span className="text-[10px] font-mono font-bold text-indigo-600 mt-1.5 block">
                            +${item.price.toLocaleString()} USD
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Total Block & Stripe Action */}
            <div className="rounded-xl bg-slate-950 text-white p-4.5 text-center space-y-2 relative overflow-hidden mt-1.5">
              <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_40%,#10b9810d_100%)]" />
              <span className="block text-[9.5px] font-mono uppercase tracking-widest text-slate-400 font-bold">PROJECT TOTAL</span>
              <div className="text-3xl font-mono font-bold text-emerald-400 tracking-tight animate-fade-in">
                ${computedFees.subtotal.toLocaleString()}
                <span className="text-xs text-slate-450 font-sans ml-1">USD</span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 border border-slate-800 px-2.5 py-0.5 text-[9px] text-slate-400 font-mono">
                <span>Tier:</span>
                <span className="text-indigo-400 font-bold">{pricingTier}</span>
              </div>

              {/* Stripe Payment Trigger */}
              <button
                type="button"
                disabled={isCreatingCheckout}
                onClick={handleStripeCheckout}
                className="w-full mt-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow font-mono uppercase tracking-wider text-[10px]"
              >
                {isCreatingCheckout ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Preparing Stripe Session...</span>
                  </>
                ) : (
                  <>
                    <CreditCard className="h-3.5 w-3.5 text-indigo-200" />
                    <span>PAY DEPOSIT VIA STRIPE</span>
                  </>
                )}
              </button>
            </div>

            {/* Pricing multiplier & Deliver Speed controls */}
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-150">
              <div className="space-y-1">
                <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500">SLA Margin Tier</span>
                <div className="space-y-1">
                  {['Standard', 'Premium Enterprise', 'Emergency Fast-Track'].map((tier) => (
                    <button
                      key={tier}
                      onClick={() => {
                        setPricingTier(tier as any);
                        showToast(`Pricing margin adjusted strictly for ${tier}.`, 'info');
                      }}
                      className={`w-full py-1 px-1.5 rounded text-[9.5px] font-medium text-left border transition-all block ${
                        pricingTier === tier 
                          ? 'bg-slate-950 border-slate-900 text-white font-bold' 
                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {tier.replace('Emergency ', '⚡ ')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500">Deployment Pace</span>
                <div className="space-y-1">
                  {['Normal', 'Accelerated', 'Express'].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => {
                        setDeliverySpeed(speed as any);
                        showToast(`Timeline calibrated to ${speed} delivery constraints.`, 'info');
                      }}
                      className={`w-full py-1 px-1.5 rounded text-[9.5px] font-medium text-left border transition-all block ${
                        deliverySpeed === speed 
                          ? 'bg-slate-950 border-slate-900 text-white font-bold' 
                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {speed === 'Express' ? '🚀 Express' : speed}
                    </button>
                  ))}
                </div>
              </div>
            </div>

          </div>

          {/* CARD 3: ACCEPTANCE & SIGNATURE BLOCK */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4" id="digital-signature-widget">
            <div className="flex items-center justify-between border-b border-slate-150 pb-2.5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4.5 w-4.5 text-indigo-600" />
                <h3 className="font-sans font-bold text-xs uppercase tracking-wider text-slate-700">
                  Acceptance & Signature
                </h3>
              </div>
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>

            {isMsaSigned ? (
              /* SEALED GREEN CERTIFICATE PANEL */
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 space-y-3 shadow-inner relative animate-fade-in text-xs">
                <div className="flex items-center gap-2 border-b border-emerald-100 pb-2">
                  <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 shrink-0" />
                  <strong className="font-mono font-bold text-[10px] uppercase text-emerald-700 tracking-wider">M Mutual Agreement Sealed</strong>
                </div>
                
                {/* Visual signature box in signed state */}
                <div className="bg-slate-100 border border-slate-200 rounded-lg p-3 text-center my-1.5 h-[62px] flex items-center justify-center select-none font-serif italic text-lg text-emerald-700 font-semibold">
                  {msaSignedName}
                </div>

                <div className="space-y-1 font-mono text-[9.5px] leading-tight-more">
                  <p><strong>REPRESENTATIVE:</strong> {msaSignedName}</p>
                  <p><strong>CORPORATE TITLE:</strong> {msaSignedTitle || 'Director'}</p>
                  <p className="truncate"><strong>EMAIL:</strong> {activeContact.email}</p>
                  <p><strong>TIMESTAMP:</strong> {msaSignDate}</p>
                  <p className="text-[9px] text-emerald-600 mt-2 block italic border-t border-emerald-150/60 pt-2">
                    Sovereign electronic certificate and checksum logs have been stamped in the PostgreSQL database.
                  </p>
                </div>
              </div>
            ) : (
              /* ACTIVE INPUT INTERIM FORM */
              <div className="space-y-3.5">
                <p className="text-[10px] text-slate-500 leading-normal">
                  Execute SOW parameters to sign mutually binding contract Net-30 deliverables. Transfers SOW IP on receipt of final cleared payment.
                </p>

                {/* Digital Signature Canvas & Vector Pad */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500">
                      E-Signature Canvas (Draw or Type)
                    </span>
                    {hasCanvasSignature && (
                      <button
                        type="button"
                        onClick={clearCanvasSig}
                        className="text-[9px] font-mono text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                      >
                        <Eraser className="h-3 w-3" />
                        Clear Pad
                      </button>
                    )}
                  </div>
                  
                  {/* HTML5 Signature Drawing Canvas */}
                  <div className="bg-white rounded-xl p-2 border border-slate-300 shadow-inner flex flex-col items-center justify-center min-h-[100px] relative overflow-hidden group">
                    <canvas
                      ref={sigCanvasRef}
                      width={380}
                      height={90}
                      onMouseDown={startDrawingSig}
                      onMouseMove={drawSig}
                      onMouseUp={stopDrawingSig}
                      onMouseLeave={stopDrawingSig}
                      onTouchStart={startDrawingSig}
                      onTouchMove={drawSig}
                      onTouchEnd={stopDrawingSig}
                      className="w-full h-[90px] cursor-crosshair touch-none bg-slate-50/50 rounded-lg"
                    />
                    {!hasCanvasSignature && (
                      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center text-slate-400 opacity-70">
                        {msaSignedName.trim() ? (
                          <span className="font-serif italic text-2xl text-indigo-700 tracking-widest font-semibold select-none transform -rotate-1">
                            {msaSignedName}
                          </span>
                        ) : (
                          <span className="font-serif italic text-xl text-slate-400 select-none tracking-widest">
                            Draw signature here with mouse or stylus
                          </span>
                        )}
                      </div>
                    )}
                    <span className="absolute bottom-1 right-2 text-[8px] font-mono text-slate-400 pointer-events-none">
                      Audit Vector Pad
                    </span>
                  </div>
                </div>

                {/* Interactive fields */}
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500">Authorized Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Sarah Chen"
                      value={msaSignedName}
                      onChange={(e) => setMsaSignedName(e.target.value)}
                      className="w-full rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs text-slate-800 outline-none focus:border-indigo-500 transition-colors focus:bg-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[9px] font-mono font-bold uppercase tracking-wider text-slate-500">Corporate Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Chief Operating Officer"
                      value={msaSignedTitle}
                      onChange={(e) => setMsaSignedTitle(e.target.value)}
                      className="w-full rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs text-slate-800 outline-none focus:border-indigo-500 transition-colors focus:bg-white"
                    />
                  </div>
                </div>

                {/* Dynamic timestamp block */}
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-[9px] text-slate-500 font-mono flex items-center justify-between">
                  <span>Sign Date Checkpoint</span>
                  <span className="font-bold text-slate-700">
                    Signed digitally: {liveTime}
                  </span>
                </div>

                <button
                  type="button"
                  disabled={isSubmittingSign}
                  onClick={handleSignProposalSubmit}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-2.75 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md mt-2 uppercase tracking-wider font-mono text-[10.5px]"
                >
                  {isSubmittingSign ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Transmitting SOW Signature...</span>
                    </>
                  ) : (
                    <>
                      <PenTool className="h-3.5 w-3.5" />
                      <span>SUBMIT SIGNED PROPOSAL</span>
                    </>
                  )}
                </button>
              </div>
            )}
            
          </div>

        </div>

      </div>

        </div>
      )}

      {/* Brand Logo & Company Customization Modal */}
      <BrandLogoCustomizerModal
        isOpen={showLogoModal}
        onClose={() => setShowLogoModal(false)}
        currentLogoUrl={companyLogoUrl}
        currentLogoHeight={companyLogoHeight}
        currentBusinessName={businessName}
        onSave={handleUpdateBranding}
      />
    </div>
  );
}
