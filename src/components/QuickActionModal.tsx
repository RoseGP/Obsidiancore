import React, { useState, useEffect } from 'react';
import { 
  X, UserPlus, DollarSign, Calendar, Sparkles, Building2, Mail, Phone, 
  Clock, MapPin, Video, CheckCircle2, AlertCircle, ArrowRight, Loader2, Tag
} from 'lucide-react';
import axios from 'axios';
import { CRMLead, CalendarEvent } from '../types';
import { QuickActionType } from './QuickActionButton';

interface QuickActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: QuickActionType;
  onLeadCreated?: (lead: CRMLead) => void;
  onDealCreated?: (deal: any) => void;
  onEventCreated?: (event: CalendarEvent) => void;
  onShowToast: (msg: string) => void;
  onNavigateView?: (view: string) => void;
}

export default function QuickActionModal({
  isOpen,
  onClose,
  initialType = 'lead',
  onLeadCreated,
  onDealCreated,
  onEventCreated,
  onShowToast,
  onNavigateView
}: QuickActionModalProps) {
  const [activeTab, setActiveTab] = useState<QuickActionType>(initialType);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync initial type when opened
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialType);
      setErrorMessage(null);
    }
  }, [isOpen, initialType]);

  // Lead Form State
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadPhone, setLeadPhone] = useState('');
  const [leadCompany, setLeadCompany] = useState('');
  const [leadTitle, setLeadTitle] = useState('');
  const [leadSource, setLeadSource] = useState('website');
  const [leadStatus, setLeadStatus] = useState('new');
  const [leadBudget, setLeadBudget] = useState('');
  const [leadNotes, setLeadNotes] = useState('');

  // Deal Form State
  const [dealName, setDealName] = useState('');
  const [dealClient, setDealClient] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [dealStage, setDealStage] = useState('discovery');
  const [dealExpectedClose, setDealExpectedClose] = useState('This Month');
  const [dealChannel, setDealChannel] = useState('web');
  const [dealNotes, setDealNotes] = useState('');

  // Event Form State
  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [eventTime, setEventTime] = useState('14:00');
  const [eventDuration, setEventDuration] = useState('30');
  const [eventType, setEventType] = useState('demo');
  const [eventContact, setEventContact] = useState('');
  const [eventLocation, setEventLocation] = useState('WebRTC Video Canvas');
  const [eventAutoLink, setEventAutoLink] = useState(true);
  const [eventNotes, setEventNotes] = useState('');

  // Reset helper
  const resetForms = () => {
    setLeadName('');
    setLeadEmail('');
    setLeadPhone('');
    setLeadCompany('');
    setLeadTitle('');
    setLeadBudget('');
    setLeadNotes('');

    setDealName('');
    setDealClient('');
    setDealValue('');
    setDealNotes('');

    setEventTitle('');
    setEventContact('');
    setEventNotes('');
    setErrorMessage(null);
  };

  // Keyboard shortcut: Escape to close, Cmd+Enter to submit
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeTab, leadName, leadEmail, leadCompany, dealName, dealClient, dealValue, eventTitle, eventDate, eventTime]);

  if (!isOpen) return null;

  // 1. Submit Lead
  const handleCreateLead = async () => {
    if (!leadName.trim()) {
      setErrorMessage('Full name is required.');
      return;
    }
    if (!leadEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmail)) {
      setErrorMessage('A valid work email is required.');
      return;
    }
    if (!leadCompany.trim()) {
      setErrorMessage('Company name is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        name: leadName.trim(),
        email: leadEmail.trim(),
        phone: leadPhone.trim() || undefined,
        company: leadCompany.trim(),
        title: leadTitle.trim() || undefined,
        source: leadSource,
        status: leadStatus,
        notes: leadNotes.trim() || undefined,
        qualification: {
          budget: leadBudget ? Number(leadBudget) : undefined,
          authority: 'decision_maker',
          need: leadNotes.trim() || 'Direct quick action entry',
          timeline: '1-3 months'
        }
      };

      const res = await axios.post('/api/leads', payload);
      if (res.data?.success && res.data?.lead) {
        onLeadCreated?.(res.data.lead);
        onShowToast(`Lead "${leadName.trim()}" created successfully.`);
        resetForms();
        onClose();
        if (onNavigateView) onNavigateView('deals');
      } else {
        throw new Error(res.data?.error || 'Failed to create lead');
      }
    } catch (err: any) {
      console.error('[QuickActionModal Lead Error]', err);
      setErrorMessage(err.response?.data?.error || err.message || 'Error creating lead');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 2. Submit Deal
  const handleCreateDeal = async () => {
    if (!dealName.trim()) {
      setErrorMessage('Deal name is required.');
      return;
    }
    if (!dealClient.trim()) {
      setErrorMessage('Client / Company is required.');
      return;
    }
    const val = Number(dealValue);
    if (isNaN(val) || val <= 0) {
      setErrorMessage('Please enter a valid deal value ($).');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        name: dealName.trim(),
        client: dealClient.trim(),
        value: val,
        stage: dealStage,
        expectedClose: dealExpectedClose,
        channelOrigin: dealChannel,
        notes: dealNotes.trim() || undefined
      };

      const res = await axios.post('/api/dashboard/deals', payload);
      if (res.data?.success && res.data?.deal) {
        onDealCreated?.(res.data.deal);
        onShowToast(`Deal "${dealName.trim()}" ($${val.toLocaleString()}) created.`);
        resetForms();
        onClose();
        if (onNavigateView) onNavigateView('deals');
      } else {
        throw new Error(res.data?.error || 'Failed to create deal');
      }
    } catch (err: any) {
      console.error('[QuickActionModal Deal Error]', err);
      setErrorMessage(err.response?.data?.error || err.message || 'Error creating deal');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 3. Submit Calendar Event
  const handleCreateEvent = async () => {
    if (!eventTitle.trim()) {
      setErrorMessage('Event title is required.');
      return;
    }
    if (!eventDate) {
      setErrorMessage('Date is required.');
      return;
    }
    if (!eventTime) {
      setErrorMessage('Time is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const generatedLink = eventAutoLink 
        ? `https://meet.omnichannel.live/room-${Math.random().toString(36).substring(2, 8)}`
        : undefined;

      const newEvent: CalendarEvent = {
        id: `evt-${Date.now()}`,
        title: eventTitle.trim(),
        date: eventDate,
        time: eventTime,
        duration: Number(eventDuration) || 30,
        type: eventType,
        contact: eventContact.trim() || 'Internal Sync',
        invitees: eventContact.trim() || undefined,
        location: eventLocation.trim() || 'Live Call Canvas',
        meetingLink: generatedLink,
        notes: eventNotes.trim() || undefined,
        status: 'upcoming'
      };

      // Schedule through the meetings API: the server checks the organizer's plan (duration, participants).
      // If it refuses, show why and don't add the event.
      try {
        await axios.post('/api/meetings/create', {
          title: eventTitle.trim(),
          date: eventDate,
          time: eventTime,
          duration: Number(eventDuration) || 30,
          locations: [eventLocation.trim() || 'Live Call Canvas'],
          guests: eventContact.includes('@') ? [eventContact.trim()] : [],
          additionalNotes: eventNotes.trim()
        });
      } catch (apiErr: any) {
        const data = apiErr?.response?.data;
        const hint = data?.upgradeLabel ? ` ${data.upgradeLabel} allows it.` : '';
        throw new Error(data?.error ? `${data.error}${hint}` : "Couldn't reach the server. The event wasn't scheduled.");
      }

      onEventCreated?.(newEvent);
      onShowToast(`Event "${eventTitle.trim()}" scheduled for ${eventDate} at ${eventTime}.`);
      resetForms();
      onClose();
      if (onNavigateView) onNavigateView('calendar');
    } catch (err: any) {
      console.error('[QuickActionModal Event Error]', err);
      setErrorMessage(err.message || 'Error scheduling event');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (activeTab === 'lead') handleCreateLead();
    else if (activeTab === 'deal') handleCreateDeal();
    else handleCreateEvent();
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-action-modal-title"
        className="w-full max-w-xl rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl shadow-black/20 flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 id="quick-action-modal-title" className="text-base font-semibold text-neutral-900 dark:text-neutral-100 tracking-tight">
                Quick Action
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Instantly create and route CRM items from anywhere
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segmented Tab Switcher (Functional buttons adhering to frontend-design zero-pill rules) */}
        <div className="px-6 pt-4 pb-2">
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-800/80 rounded-xl border border-neutral-200/60 dark:border-neutral-700/60">
            <button
              type="button"
              onClick={() => { setActiveTab('lead'); setErrorMessage(null); }}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                activeTab === 'lead'
                  ? 'bg-white dark:bg-neutral-900 text-blue-600 dark:text-blue-400 shadow-sm font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>New Lead</span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveTab('deal'); setErrorMessage(null); }}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                activeTab === 'deal'
                  ? 'bg-white dark:bg-neutral-900 text-emerald-600 dark:text-emerald-400 shadow-sm font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              <span>New Deal</span>
            </button>

            <button
              type="button"
              onClick={() => { setActiveTab('event'); setErrorMessage(null); }}
              className={`flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                activeTab === 'event'
                  ? 'bg-white dark:bg-neutral-900 text-purple-600 dark:text-purple-400 shadow-sm font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Calendar Event</span>
            </button>
          </div>
        </div>

        {/* Error notification banner if any */}
        {errorMessage && (
          <div className="mx-6 mt-2 px-3.5 py-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 text-xs flex items-center gap-2 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* Form Body */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-4 text-xs">
          {/* TAB 1: NEW LEAD */}
          {activeTab === 'lead' && (
            <div className="space-y-3.5 animate-in fade-in duration-150">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Contact Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Marcus Chen"
                    value={leadName}
                    onChange={(e) => setLeadName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Work Email <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. m.chen@alphatech.global"
                    value={leadEmail}
                    onChange={(e) => setLeadEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Company Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. AlphaTech Global"
                    value={leadCompany}
                    onChange={(e) => setLeadCompany(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  />
                </div>
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Job Title / Role
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Chief Technology Officer"
                    value={leadTitle}
                    onChange={(e) => setLeadTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={leadPhone}
                    onChange={(e) => setLeadPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  />
                </div>
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Lead Source
                  </label>
                  <select
                    value={leadSource}
                    onChange={(e) => setLeadSource(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  >
                    <option value="website">Website Form</option>
                    <option value="whatsapp">WhatsApp Direct</option>
                    <option value="voice">AI Voice Receptionist</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="referral">Client Referral</option>
                    <option value="inbound_call">Inbound Call</option>
                    <option value="ad_campaign">Ad Campaign</option>
                  </select>
                </div>
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Target Budget ($)
                  </label>
                  <input
                    type="number"
                    placeholder="e.g. 50000"
                    value={leadBudget}
                    onChange={(e) => setLeadBudget(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                  Discovery Notes / Key Requirements
                </label>
                <textarea
                  rows={2}
                  placeholder="Inquired about omnichannel SLA, multi-seat rollout, or custom integration..."
                  value={leadNotes}
                  onChange={(e) => setLeadNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition resize-none"
                />
              </div>
            </div>
          )}

          {/* TAB 2: NEW DEAL */}
          {activeTab === 'deal' && (
            <div className="space-y-3.5 animate-in fade-in duration-150">
              <div>
                <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                  Deal Opportunity Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. AlphaTech OmniRoute Core Migration"
                  value={dealName}
                  onChange={(e) => setDealName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Client / Organization <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. AlphaTech Global"
                    value={dealClient}
                    onChange={(e) => setDealClient(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  />
                </div>
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Deal Value ($ ARR) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-neutral-400 font-medium">$</span>
                    <input
                      type="number"
                      required
                      placeholder="85000"
                      value={dealValue}
                      onChange={(e) => setDealValue(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Pipeline Stage
                  </label>
                  <select
                    value={dealStage}
                    onChange={(e) => setDealStage(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  >
                    <option value="discovery">Discovery (30%)</option>
                    <option value="qualified">Qualified (50%)</option>
                    <option value="proposal">Proposal Sent (70%)</option>
                    <option value="negotiation">Negotiation (85%)</option>
                    <option value="won">Closed Won (100%)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Expected Close
                  </label>
                  <select
                    value={dealExpectedClose}
                    onChange={(e) => setDealExpectedClose(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  >
                    <option value="This Week">This Week</option>
                    <option value="This Month">This Month</option>
                    <option value="Next Month">Next Month</option>
                    <option value="Q3">Q3</option>
                    <option value="Q4">Q4</option>
                  </select>
                </div>
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Channel Origin
                  </label>
                  <select
                    value={dealChannel}
                    onChange={(e) => setDealChannel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="voice">Voice Call</option>
                    <option value="email">Email</option>
                    <option value="web">Web Portal</option>
                    <option value="linkedin">LinkedIn</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                  Deal Notes / Commercial Terms
                </label>
                <textarea
                  rows={2}
                  placeholder="Contract terms, custom SLA provisions, implementation timeframe..."
                  value={dealNotes}
                  onChange={(e) => setDealNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition resize-none"
                />
              </div>
            </div>
          )}

          {/* TAB 3: CALENDAR EVENT */}
          {activeTab === 'event' && (
            <div className="space-y-3.5 animate-in fade-in duration-150">
              <div>
                <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                  Event / Meeting Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Discovery & Architecture Sync"
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  />
                </div>
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Time <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="time"
                    required
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  />
                </div>
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Duration
                  </label>
                  <select
                    value={eventDuration}
                    onChange={(e) => setEventDuration(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  >
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes (1h)</option>
                    <option value="90">90 minutes</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Event Type
                  </label>
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  >
                    <option value="demo">Product Demo</option>
                    <option value="call">Discovery Call</option>
                    <option value="interview">Executive Consultation</option>
                    <option value="contract">Contract & SLA Review</option>
                    <option value="task">Internal Task Review</option>
                  </select>
                </div>
                <div>
                  <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                    Guest / Invitee Email or Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. client@example.com"
                    value={eventContact}
                    onChange={(e) => setEventContact(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/40">
                <div className="flex items-center gap-2.5">
                  <Video className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <div>
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">
                      Auto-generate Video Call Link
                    </div>
                    <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Instant WebRTC room for screen share & recording
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={eventAutoLink}
                  onChange={(e) => setEventAutoLink(e.target.checked)}
                  className="w-4 h-4 rounded text-neutral-900 focus:ring-neutral-900 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-neutral-700 dark:text-neutral-300 font-medium mb-1">
                  Meeting Agenda / Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Discussion points, architecture overview, SLA requirements..."
                  value={eventNotes}
                  onChange={(e) => setEventNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white transition resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-neutral-50 dark:bg-neutral-900/80 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="text-[11px] text-neutral-400 hidden sm:block">
            Press <kbd className="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 font-mono text-[10px]">Ctrl+Enter</kbd> to save
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors text-xs font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors text-xs font-semibold shadow-sm cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>
                    {activeTab === 'lead' ? 'Create Lead' : activeTab === 'deal' ? 'Create Deal' : 'Schedule Event'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
