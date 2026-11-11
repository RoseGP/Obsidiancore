import React, { useEffect, useRef, useState } from "react";
import {
  Phone, PhoneOff, Mic, MicOff, Bot, User, Sparkles,
  AlertCircle, ChevronRight, Activity, Volume2, CornerDownLeft,
  Pause, Play, Radio, ShieldCheck, History, Clock, FileText,
  CheckCircle2, Plus, ArrowUpRight, ArrowRight, Search, Delete, Grid,
  Sliders, UserCheck, Calendar, Zap, MessageSquare, Copy, Check,
  Building2, PhoneForwarded, PhoneCall, Headphones, BellRing,
  Video, FileSignature, ExternalLink, X, Terminal, Server, BarChart3, Network, Inbox, Workflow } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useVoiceAgent, VoiceTranscript, PostCallSummary, ReceptionistMessageSlip } from "@cloudflare/voice/react";
import ReceptionistDirectory from "./voice/ReceptionistDirectory";
import MessageSlipsInbox from "./voice/MessageSlipsInbox";
import ReceptionistFAQKnowledge from "./voice/ReceptionistFAQKnowledge";
import ReceptionistTrainingCenter from "./voice/ReceptionistTrainingCenter";
import DograhIvrConsole from "./voice/DograhIvrConsole";
import CallMonitoringDashboard from "./voice/CallMonitoringDashboard";

/** Shown for telephony features that aren't built yet (nothing simulated). */
function NotAvailablePanel({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div role="status" className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><AlertCircle className="h-4 w-4 text-amber-600" /> {title}</div>
      <p className="text-xs text-slate-600 leading-relaxed">{body}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer">{action.label}</button>
      )}
    </div>
  );
}
import { copyToClipboard } from "../utils/clipboard";

interface LeadItem {
  id: string;
  name: string;
  phone: string;
  company: string;
  dealValue: string;
  stage: string;
  avatarColor: string;
  lastContact: string;
  notes: string;
}

// TO COMPLETE: load dialable contacts (with phone numbers) from the CRM contacts store.
const CRM_LEADS: LeadItem[] = [];

/** Shown when no contact is selected (keeps the dialer usable with an empty CRM). */
const NO_LEAD: LeadItem = { id: 'none', name: 'No contact selected', phone: '', company: '', dealValue: '', stage: '', avatarColor: 'bg-slate-300', lastContact: '', notes: '' };

export interface AlexSkillMode {
  id: string;
  name: string;
  badge: string;
  description: string;
  prompt: string;
}

export const ALEX_SKILL_MODES: AlexSkillMode[] = [
  {
    id: "omni",
    name: "Alex AI (Omni-Executive Concierge)",
    badge: "Omni-Channel",
    description: "Autonomously handles front-desk routing, deal qualification, scheduling, video rooms & proposals.",
    prompt: "Serve as the unified voice concierge: greet callers, qualify deals, answer knowledge base FAQs, execute actions or route to specialized departments."
  },
  {
    id: "reception",
    name: "Alex AI (Front-Desk & Auto-Attendant)",
    badge: "Inbound Routing",
    description: "Screen callers, answer verified FAQ queries, provide office info, and record detailed message slips.",
    prompt: "Front-desk auto-attendant: screen callers, answer verified FAQ queries, provide office info, and take detailed message slips."
  },
  {
    id: "sales",
    name: "Alex AI (Sales & Deal Qualification)",
    badge: "Revenue & Growth",
    description: "Qualify enterprise prospects, present pricing tiers, generate proposals, and book discovery demos.",
    prompt: "Qualify enterprise prospect, discuss pricing tiers, trigger proposal generation, and book strategic calendar briefings."
  },
  {
    id: "support",
    name: "Alex AI (Solutions & Architecture)",
    badge: "Technical & SLA",
    description: "Explain WebRTC latency, API integration, zero-trust security, and warm transfer to DevOps engineers.",
    prompt: "Technical solutions architect: explain infrastructure, sub-50ms WebRTC latency, security compliance, and troubleshoot API setups."
  },
  {
    id: "billing",
    name: "Alex AI (Billing & Financial Operations)",
    badge: "Accounts & Invoices",
    description: "Inquire about Q3 VAT invoices, payment instructions, licensing expansions, and contract renewals.",
    prompt: "Financial operations concierge: assist with invoice reconciliation, payment processing, subscription tiers, and contract renewal terms."
  }
];

export const ALEX_VOICE_PROMPTS = [
  { category: "Actions", prompt: "Can you start a video call with our team right now?", label: "🎥 Launch Video Call" },
  { category: "Actions", prompt: "Let's schedule a calendar event for tomorrow at 2 PM.", label: "📅 Book Calendar Event" },
  { category: "Actions", prompt: "Please create an enterprise contract proposal for $120k.", label: "📄 Draft Enterprise SOW" },
  { category: "Routing", prompt: "Can you transfer me to your sales team?", label: "🔄 Transfer to Sales" },
  { category: "Routing", prompt: "I'm experiencing an API latency issue and need DevOps support.", label: "🛠️ Technical Support" },
  { category: "Routing", prompt: "I'd like to leave an urgent message for Evelyn Sinclair.", label: "📝 Leave Message Slip" },
  { category: "Knowledge", prompt: "What are your business hours and where is your SF office located?", label: "🏢 Hours & Office Address" },
  { category: "Knowledge", prompt: "Can you explain your enterprise pricing tiers and SOC2 security?", label: "🔒 Pricing & Security" }
];

const COUNTRY_CODES = [
  { code: "+1", country: "US / CA", flag: "🇺🇸" },
  { code: "+44", country: "United Kingdom", flag: "🇬🇧" },
  { code: "+33", country: "France", flag: "🇫🇷" },
  { code: "+49", country: "Germany", flag: "🇩🇪" },
  { code: "+81", country: "Japan", flag: "🇯🇵" },
  { code: "+61", country: "Australia", flag: "🇦🇺" },
  { code: "+971", country: "UAE", flag: "🇦🇪" },
  { code: "+91", country: "India", flag: "🇮🇳" },
  { code: "+65", country: "Singapore", flag: "🇸🇬" },
];


interface CallLogEntry {
  id: string;
  leadName: string;
  leadCompany: string;
  phone: string;
  timestamp: string;
  duration: number;
  sentiment: string;
  summary: string;
  status: "completed" | "scheduled_demo" | "voicemail" | "followup";
}

/** Voice Calls tabs. "receptionist" holds everything the former AI Voice Receptionist page had (training, FAQs, call-back slips, routing). */
export type AppMode = "unified" | "receptionist" | "livekit_ivr" | "monitoring" | "sip_trunks" | "twilio_ivr";

interface CRMVoiceDialerProps {
  onAddCalendarEvent?: (newEvent: any) => void;
  onNavigate?: (view: any) => void;
  initialMode?: AppMode;
}

export default function CRMVoiceDialer({ onAddCalendarEvent, onNavigate, initialMode }: CRMVoiceDialerProps) {
  // Mode: Unified Dialer & IVR vs LiveKit IVR vs Analytics vs SIP Trunks
  const [appMode, setAppMode] = useState<AppMode>(initialMode || "unified");
  // Deep links from the navigation (WhatsApp & SMS → monitoring, voice_receptionist → receptionist).
  useEffect(() => { if (initialMode) setAppMode(initialMode); }, [initialMode]);

  // Combined Left Column Tab: Softphone Dialer & Leads vs IVR Directory vs Message Slips
  const [leftPanelTab, setLeftPanelTab] = useState<"dialer" | "directory" | "slips">("dialer");

  // Active Lead & Configuration States
  const [selectedLead, setSelectedLead] = useState<LeadItem>(CRM_LEADS[0] ?? NO_LEAD);
  const [dialNumber, setDialNumber] = useState<string>(CRM_LEADS[0]?.phone ?? '');
  const [selectedCountryCode, setSelectedCountryCode] = useState<string>("+1");
  const [selectedSkillMode, setSelectedSkillMode] = useState<AlexSkillMode>(ALEX_SKILL_MODES[0]);
  const [leadSearchQuery, setLeadSearchQuery] = useState<string>("");

  // Responsive UI Tab for mobile / tablet screens
  const [activeTab, setActiveTab] = useState<"left_panel" | "call" | "transcript" | "history">("call");

  // In-call features & modals
  const [showDTMFDrawer, setShowDTMFDrawer] = useState<boolean>(false);
  const [showTrainingStudio, setShowTrainingStudio] = useState<boolean>(false);
  const [copiedNote, setCopiedNote] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Call Logs History State
  // TO COMPLETE: load call history from your telephony logs (Twilio Call resources or /api/voice/ivr/calls).
  const [callHistory, setCallHistory] = useState<CallLogEntry[]>([]);

  // Hook instance with receptionist support
  const {
    status,
    agentState,
    callMode,
    activeDepartment,
    isTransferring,
    transcripts,
    interimTranscript,
    audioLevel,
    isMuted,
    isOnHold,
    isRecording,
    callDuration,
    sentiment,
    leadScore,
    actionItems,
    activeActions,
    latestAction,
    executeAction,
    clearActiveAction,
    messageSlips,
    postCallSummary,
    isGeneratingSummary,
    startCall,
    disconnect,
    toggleMuted,
    toggleHold,
    toggleRecording,
    setCallMode,
    playDTMFTone,
    triggerDepartmentTransfer,
    addManualMessageSlip,
    markMessageSlipStatus,
    submitVoiceInput,
    generatePostCallReport,
    clearPostCallSummary,
    error,
  } = useVoiceAgent({
    callMode: "receptionist",
    leadId: selectedLead.id,
    leadName: selectedLead.name,
    leadCompany: selectedLead.company,
    leadPhone: selectedLead.phone,
    leadDealValue: selectedLead.dealValue,
    leadStage: selectedLead.stage,
    agentPersona: "Alex AI - Unified Executive Voice Concierge",
    callGoal: selectedSkillMode.prompt,
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [manualTypedText, setManualTypedText] = useState<string>("");

  // Smooth scroll transcripts
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [transcripts, interimTranscript]);

  // When call becomes active, auto-switch to "call" tab on mobile
  useEffect(() => {
    if (status === "active") {
      setActiveTab("call");
    }
  }, [status]);

  // Sync mode changes with hook
  const handleSwitchMode = (mode: AppMode) => {
    setAppMode(mode);
    setCallMode("receptionist");
  };

  // Show toast notification helper
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Notify when video call or autonomous action is triggered
  useEffect(() => {
    if (latestAction) {
      if (latestAction.type === 'video_call') {
        showToast("🎥 Video call ready in GREET");
      } else if (latestAction.type === 'calendar_event') {
        showToast("📅 Calendar meeting booked autonomously by Alex AI");
      } else if (latestAction.type === 'proposal') {
        showToast("📄 Enterprise contract proposal generated by Alex AI");
      }
    }
  }, [latestAction]);

  // Dialpad Keypad handler
  const handleKeypadPress = (key: string) => {
    playDTMFTone(key);
    setDialNumber(prev => prev + key);
  };

  const handleBackspace = () => {
    setDialNumber(prev => prev.slice(0, -1));
  };

  const handleClearDialer = () => {
    setDialNumber("");
  };

  // Launch Outbound Call
  const handleInitiateCall = async (leadToCall?: LeadItem) => {
    const targetLead = leadToCall || selectedLead;
    setSelectedLead(targetLead);
    setDialNumber(targetLead.phone);
    setActiveTab("call");

    await startCall({
      callMode: "dialer",
      leadId: targetLead.id,
      leadName: targetLead.name,
      leadCompany: targetLead.company,
      leadPhone: targetLead.phone,
      leadDealValue: targetLead.dealValue,
      leadStage: targetLead.stage,
      agentPersona: "Alex AI - Unified Executive Voice Concierge",
      callGoal: selectedSkillMode.prompt,
    });
  };


  // Dial back from message slip
  const handleDialBack = (phone: string, name: string) => {
    setDialNumber(phone);
    setSelectedLead(prev => ({
      ...prev,
      name,
      phone,
      company: "Callback Client"
    }));
    handleInitiateCall({
      id: `cb_${Date.now()}`,
      name,
      phone,
      company: "Callback Client",
      dealValue: "$50,000",
      stage: "Callback Follow-up",
      avatarColor: "from-emerald-600 to-teal-600",
      lastContact: "Just now",
      notes: "Direct callback from Receptionist message slip."
    });
  };

  // Manual typed turn submit
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTypedText.trim() || status !== "active") return;
    submitVoiceInput(manualTypedText.trim());
    setManualTypedText("");
  };

  // Format call duration MM:SS
  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Save post-call report into history
  const handleSaveToCRM = () => {
    if (!postCallSummary) return;

    const newLog: CallLogEntry = {
      id: `cl_${Date.now()}`,
      leadName: selectedLead.name,
      leadCompany: selectedLead.company,
      phone: selectedLead.phone,
      timestamp: "Just now",
      duration: callDuration || 45,
      sentiment: postCallSummary.sentimentScore,
      summary: postCallSummary.executiveSummary,
      status: "completed"
    };

    setCallHistory(prev => [newLog, ...prev]);
    showToast("Post-call report successfully synced to CRM Activity Timeline!");
    clearPostCallSummary();
  };

  // Book demo in calendar
  const handleScheduleFollowup = () => {
    if (onAddCalendarEvent) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split("T")[0];

      onAddCalendarEvent({
        title: `Receptionist Follow-up: ${selectedLead.company}`,
        time: `${dateStr} 14:00`,
        type: "demo",
        contact: `${selectedLead.name} (${selectedLead.company})`,
        status: "upcoming",
        notes: postCallSummary?.executiveSummary || "Scheduled via AI Front-Desk Voice Receptionist."
      });
      showToast(`Meeting booked in CRM Calendar for ${selectedLead.name}!`);
    } else {
      showToast(`Appointment confirmed with ${selectedLead.name}!`);
    }
  };

  const copyCRMNote = async () => {
    if (!postCallSummary?.crmNote) return;
    await copyToClipboard(postCallSummary.crmNote);
    setCopiedNote(true);
    setTimeout(() => setCopiedNote(false), 2000);
  };

  // Filter leads
  const filteredLeads = CRM_LEADS.filter(l =>
    l.name.toLowerCase().includes(leadSearchQuery.toLowerCase()) ||
    l.company.toLowerCase().includes(leadSearchQuery.toLowerCase()) ||
    l.phone.includes(leadSearchQuery)
  );

  return (
    <div className="h-full w-full flex flex-col bg-slate-50 text-slate-900 overflow-y-auto" id="crm-voice-dialer-root">

      {/* Top Bar / Header with Mode Switcher */}
      <header className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur-xl px-4 md:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-sm">
            {appMode === "twilio_ivr" ? (
              <Workflow className="h-5 w-5 text-blue-600" />
            ) : appMode === "receptionist" ? (
              <Headphones className="h-5 w-5 text-blue-600" />
            ) : appMode === "livekit_ivr" ? (
              <Server className="h-5 w-5 animate-pulse" />
            ) : appMode === "monitoring" ? (
              <BarChart3 className="h-5 w-5 text-indigo-600" />
            ) : appMode === "sip_trunks" ? (
              <Network className="h-5 w-5 text-emerald-600" />
            ) : (
              <Radio className="h-5 w-5 text-blue-600" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base md:text-lg font-bold text-slate-900 tracking-tight">
                {appMode === "twilio_ivr"
                  ? "Call routing (Twilio IVR)"
                  : appMode === "receptionist"
                  ? "AI Receptionist"
                  : appMode === "livekit_ivr"
                  ? "LiveKit SIP IVR & Telephony Gateway"
                  : appMode === "monitoring"
                  ? "Inbound Messages & Voicemail"
                  : appMode === "sip_trunks"
                  ? "Multi-SIP Trunk Redundancy & Carrier Fallback"
                  : "Voice Calls"}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                {appMode === "twilio_ivr" ? "Programmable Voice" : appMode === "receptionist" ? "Answers and routes calls" : appMode === "livekit_ivr" ? "LiveKit + Failover" : appMode === "monitoring" ? "WhatsApp · SMS · Voicemail" : appMode === "sip_trunks" ? "Zero-Downtime SIP" : "Dialer + IVR + WebRTC"}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {appMode === "receptionist"
                ? "What your AI receptionist knows, the call-back requests it takes, and how calls are routed"
                : appMode === "livekit_ivr"
                ? "Not available yet: LiveKit SIP telephony isn't connected in this app"
                : appMode === "monitoring"
                ? "WhatsApp and SMS messages and voicemails received on your numbers, and where they are routed"
                : appMode === "sip_trunks"
                ? "Not available yet: carrier failover isn't connected in this app"
                : appMode === "twilio_ivr"
                ? "Your Twilio number's menu: greeting, options and where each option sends the caller"
                : "Dial out, take calls, keep transcripts and notes with your CRM"}
            </p>
          </div>
        </div>

        {/* Mode Switcher & Global Triggers */}
        <div className="flex items-center gap-2.5">
          {/* Mode Pill Toggle */}
          <div className="bg-slate-100 border border-slate-200 p-1 rounded-2xl flex items-center gap-1 shadow-inner overflow-x-auto">
            <button
              onClick={() => handleSwitchMode("unified")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                appMode === "unified"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Radio className="h-3.5 w-3.5" />
              <span>Dialer</span>
            </button>
            <button
              onClick={() => handleSwitchMode("receptionist")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                appMode === "receptionist"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Headphones className="h-3.5 w-3.5" />
              <span>AI Receptionist</span>
            </button>
            <button
              onClick={() => handleSwitchMode("livekit_ivr")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                appMode === "livekit_ivr"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Server className="h-3.5 w-3.5" />
              <span>LiveKit IVR</span>
            </button>
            <button
              onClick={() => handleSwitchMode("monitoring")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                appMode === "monitoring"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Live Monitoring</span>
            </button>
            <button
              onClick={() => handleSwitchMode("sip_trunks")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                appMode === "sip_trunks"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Network className="h-3.5 w-3.5" />
              <span>SIP Trunks</span>
            </button>
            <button
              onClick={() => handleSwitchMode("twilio_ivr")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                appMode === "twilio_ivr"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Workflow className="h-3.5 w-3.5" />
              <span>Call routing</span>
            </button>
          </div>

          {/* AI Training Center Trigger */}
          <button
            onClick={() => setShowTrainingStudio(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-xs font-bold text-blue-700 transition-all cursor-pointer shadow-sm active:scale-95"
            title="Train AI Voice Concierge on custom business Q&As, documents, and policies"
          >
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            <span className="hidden sm:inline">Train Knowledge</span>
            <span className="sm:hidden">Train</span>
          </button>

        </div>
      </header>

      {appMode === "twilio_ivr" && (
        <div className="flex-1 overflow-y-auto px-4 md:px-8 py-5">
          <DograhIvrConsole />
        </div>
      )}

      {appMode === "receptionist" && (
        <div className="flex-1 overflow-y-auto px-3 md:px-8 py-5 space-y-5 max-w-7xl mx-auto w-full">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => handleSwitchMode("twilio_ivr")}
              className="text-left bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-blue-300 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Workflow className="h-4 w-4 text-blue-600" /> Call routing</div>
              <p className="text-xs text-slate-500 mt-1">Greeting, menu options and where each option sends the caller.</p>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode("unified")}
              className="text-left bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-blue-300 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Phone className="h-4 w-4 text-blue-600" /> Test a call</div>
              <p className="text-xs text-slate-500 mt-1">Talk to the receptionist in the dialer to hear how it answers.</p>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode("monitoring")}
              className="text-left bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-blue-300 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Inbox className="h-4 w-4 text-blue-600" /> Messages and voicemail</div>
              <p className="text-xs text-slate-500 mt-1">WhatsApp, SMS and voicemails received on your numbers.</p>
            </button>
          </div>

          <ReceptionistTrainingCenter
            inline
            onNavigate={onNavigate}
            onLaunchCallTest={(prompt) => {
              handleSwitchMode("unified");
              submitVoiceInput(prompt);
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">Call-back requests</h3>
              <MessageSlipsInbox
                messageSlips={messageSlips}
                onAddSlip={addManualMessageSlip}
                onUpdateStatus={markMessageSlipStatus}
                onDialBack={(phone, name) => { handleSwitchMode("unified"); handleDialBack(phone, name); }}
              />
            </div>
            <ReceptionistFAQKnowledge
              onSelectPrompt={(prompt) => { handleSwitchMode("unified"); submitVoiceInput(prompt); }}
            />
          </div>
        </div>
      )}


      {/* Mobile / Tablet Tab Navigation Bar */}
      <div className={`${appMode === "twilio_ivr" || appMode === "receptionist" ? "hidden" : "lg:hidden flex"} shrink-0 bg-white border-b border-slate-200 px-3 py-2 items-center justify-between gap-1 overflow-x-auto`}>
        <button
          onClick={() => setActiveTab("left_panel")}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "left_panel"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <Grid className="h-3.5 w-3.5" />
          <span>Dialer & IVR</span>
        </button>

        <button
          onClick={() => setActiveTab("call")}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all relative ${
            activeTab === "call"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <Phone className="h-3.5 w-3.5" />
          <span>Active Line</span>
          {status === "active" && (
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping absolute top-1.5 right-1.5" />
          )}
        </button>

        <button
          onClick={() => setActiveTab("transcript")}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "transcript"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>Transcript & FAQs</span>
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "history"
              ? "bg-blue-600 text-white shadow-sm"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          }`}
        >
          <History className="h-3.5 w-3.5" />
          <span>Call Logs</span>
        </button>
      </div>

      {/* Main Responsive Grid Layout */}
      <div className={`${appMode === "twilio_ivr" || appMode === "receptionist" ? "hidden" : "grid"} flex-1 p-3 md:p-6 max-w-7xl mx-auto w-full grid-cols-1 lg:grid-cols-12 gap-5 items-start`}>

        {/* ========================================================================= */}
        {/* COLUMN 1: COMBINED DIALER & IVR (KEYPAD, LEADS, DIRECTORY & SLIPS)        */}
        {/* ========================================================================= */}
        <div className={`space-y-4 ${activeTab === "left_panel" ? "block" : "hidden lg:block"} lg:col-span-4`}>

          {/* Combined Left Column Navigation Tabs */}
          <div className="bg-slate-100 p-1 rounded-2xl flex items-center gap-1 border border-slate-200 shadow-inner">
            <button
              onClick={() => setLeftPanelTab("dialer")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                leftPanelTab === "dialer"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Dialer & Leads</span>
            </button>
            <button
              onClick={() => setLeftPanelTab("directory")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                leftPanelTab === "directory"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>IVR Directory</span>
            </button>
            <button
              onClick={() => setLeftPanelTab("slips")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-xs font-bold transition-all cursor-pointer relative ${
                leftPanelTab === "slips"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Inbox className="h-3.5 w-3.5" />
              <span>Message Slips</span>
              {messageSlips.filter(s => s.status === 'unread').length > 0 && (
                <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse ml-0.5" />
              )}
            </button>
          </div>

          {/* Tab Content: Outbound Softphone & CRM Leads */}
          {leftPanelTab === "dialer" && (
            <>
              {/* Keypad & Manual Number Input Card */}
              <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <Grid className="h-4 w-4 text-blue-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Softphone Keypad</h3>
                  </div>
                  {dialNumber && (
                    <button
                      onClick={handleClearDialer}
                      className="text-[10px] text-slate-400 hover:text-rose-600 font-semibold transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Country code + Number Display Bar */}
                <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-2xl p-2 mb-3">
                  <select
                    value={selectedCountryCode}
                    onChange={(e) => setSelectedCountryCode(e.target.value)}
                    className="bg-transparent text-xs text-slate-700 font-mono focus:outline-none cursor-pointer pl-1"
                  >
                    {COUNTRY_CODES.map(c => (
                      <option key={c.code} value={c.code} className="bg-white text-slate-900">
                        {c.flag} {c.code}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={dialNumber}
                    onChange={(e) => setDialNumber(e.target.value)}
                    placeholder="Enter phone or lead..."
                    className="flex-1 bg-transparent text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none text-right pr-1"
                  />

                  {dialNumber && (
                    <button
                      onClick={handleBackspace}
                      className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                      title="Backspace"
                    >
                      <Delete className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* DTMF Keypad Grid */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {[
                    { k: "1", sub: "" },
                    { k: "2", sub: "ABC" },
                    { k: "3", sub: "DEF" },
                    { k: "4", sub: "GHI" },
                    { k: "5", sub: "JKL" },
                    { k: "6", sub: "MNO" },
                    { k: "7", sub: "PQRS" },
                    { k: "8", sub: "TUV" },
                    { k: "9", sub: "WXYZ" },
                    { k: "*", sub: "" },
                    { k: "0", sub: "+" },
                    { k: "#", sub: "" }
                  ].map(({ k, sub }) => (
                    <button
                      key={k}
                      onClick={() => handleKeypadPress(k)}
                      className="h-11 rounded-2xl bg-slate-50 hover:bg-blue-50 active:scale-95 border border-slate-200 hover:border-blue-300 flex flex-col items-center justify-center transition-all cursor-pointer group shadow-xs"
                    >
                      <span className="text-sm font-bold text-slate-800 group-hover:text-blue-600 font-mono leading-none">{k}</span>
                      {sub && <span className="text-[7px] text-slate-400 tracking-wider font-semibold leading-tight">{sub}</span>}
                    </button>
                  ))}
                </div>

                {/* Launch Outbound Call CTA */}
                {status !== "active" ? (
                  <button
                    onClick={() => handleInitiateCall()}
                    disabled={status === "connecting"}
                    className="w-full h-11 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Phone className="h-4 w-4" />
                    <span>{status === "connecting" ? "Establishing Carrier Link..." : `Call ${selectedLead.name.split(" ")[0]}`}</span>
                  </button>
                ) : (
                  <button
                    onClick={disconnect}
                    className="w-full h-11 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all cursor-pointer"
                  >
                    <PhoneOff className="h-4 w-4" />
                    <span>Disconnect Active Call</span>
                  </button>
                )}
              </div>

              {/* CRM Leads Quick Dial Queue */}
              <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-emerald-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">CRM Lead Queue</h3>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500">{CRM_LEADS.length} Leads</span>
                </div>

                <div className="relative mb-3">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={leadSearchQuery}
                    onChange={(e) => setLeadSearchQuery(e.target.value)}
                    placeholder="Search leads by name, company..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
                  {filteredLeads.map((lead) => {
                    const isSelected = selectedLead.id === lead.id;
                    return (
                      <div
                        key={lead.id}
                        onClick={() => {
                          setSelectedLead(lead);
                          setDialNumber(lead.phone);
                        }}
                        className={`p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-2.5 ${
                          isSelected
                            ? "bg-blue-50/80 border-blue-300 text-slate-900"
                            : "bg-slate-50/60 hover:bg-slate-100/80 border-slate-200 text-slate-700"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`h-8 w-8 rounded-xl bg-gradient-to-tr ${lead.avatarColor} flex items-center justify-center shrink-0 text-white font-bold text-xs shadow-xs`}>
                            {lead.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-bold text-slate-900 truncate">{lead.name}</p>
                              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-white text-slate-600 border border-slate-200 shrink-0">
                                {lead.dealValue}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 truncate">{lead.company}</p>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInitiateCall(lead);
                          }}
                          className="h-7 w-7 rounded-xl bg-emerald-50 hover:bg-emerald-600 border border-emerald-200 hover:border-emerald-600 text-emerald-600 hover:text-white flex items-center justify-center transition-all shrink-0 cursor-pointer shadow-xs"
                          title={`Instant Dial ${lead.name}`}
                        >
                          <Phone className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* Tab Content: Inbound IVR Company Directory */}
          {leftPanelTab === "directory" && (
            <ReceptionistDirectory
              activeDepartment={activeDepartment}
              isTransferring={isTransferring}
              isCallActive={status === "active"}
              onTransfer={(key, name) => triggerDepartmentTransfer(key, name)}
            />
          )}

          {/* Tab Content: Message Slips Inbox */}
          {leftPanelTab === "slips" && (
            <MessageSlipsInbox
              messageSlips={messageSlips}
              onAddSlip={addManualMessageSlip}
              onUpdateStatus={markMessageSlipStatus}
              onDialBack={handleDialBack}
            />
          )}
        </div>

        {/* ===================================================================== */}
        {/* COLUMN 2: LIVE CALL STUDIO & DYNAMIC AUDIO VISUALIZER (lg:col-span-4) */}
        {/* ===================================================================== */}
        <div className={`space-y-4 ${activeTab === "call" ? "block" : "hidden lg:block"} lg:col-span-4`}>

          {/* Main Visualizer & Live Session Card */}
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm relative overflow-hidden flex flex-col items-center text-center">

            {/* Header Telemetry Pill */}
            <div className="w-full flex items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full ${
                  status === "active" ? (isOnHold ? "bg-amber-500 animate-pulse" : "bg-emerald-500 animate-ping") :
                  status === "connecting" ? "bg-blue-500 animate-pulse" : "bg-slate-400"
                }`} />
                <span className="text-xs font-bold font-mono uppercase tracking-wider text-slate-700">
                  {status === "active" ? (isOnHold ? (isTransferring ? "Warm Transfer in Progress..." : "Call On Hold") : "Line Connected") :
                   status === "connecting" ? "Carrier Handshake..." : "Ready to Receive Call"}
                </span>
              </div>

              {/* Call Timer & Recording indicator */}
              <div className="flex items-center gap-2">
                {isRecording && status === "active" && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-[10px] font-bold text-rose-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                    <span>REC</span>
                  </div>
                )}
                <div className="flex items-center gap-1 font-mono text-xs font-bold text-slate-700 bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-200">
                  <Clock className="h-3 w-3 text-blue-600" />
                  <span>{formatDuration(callDuration)}</span>
                </div>
              </div>
            </div>

            {/* Active Department Routing Badge (If transferred or Receptionist) */}
            {activeDepartment && (
              <div className="w-full bg-blue-50 border border-blue-200 rounded-2xl p-2.5 mb-3 flex items-center justify-between text-left">
                <div className="flex items-center gap-2">
                  <PhoneForwarded className="h-4 w-4 text-blue-600 animate-pulse" />
                  <div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-blue-600 block">Routing Destination</span>
                    <span className="text-xs font-bold text-slate-900">{activeDepartment}</span>
                  </div>
                </div>
                {isTransferring && (
                  <span className="text-[10px] font-bold text-amber-600 animate-pulse">Transferring...</span>
                )}
              </div>
            )}

            {/* Active Autonomous Action Triggered Banner */}
            {latestAction && (
              <div className="w-full bg-slate-50 border border-blue-200 rounded-2xl p-3 mb-3 text-left shadow-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    {latestAction.type === 'video_call' && <Video className="h-4 w-4 text-emerald-600" />}
                    {latestAction.type === 'calendar_event' && <Calendar className="h-4 w-4 text-blue-600" />}
                    {latestAction.type === 'proposal' && <FileSignature className="h-4 w-4 text-amber-600" />}
                    <span className="text-[11px] font-bold text-slate-900 uppercase tracking-wider">
                      {latestAction.type === 'video_call' ? 'Video Room Created by AI' :
                       latestAction.type === 'calendar_event' ? 'Meeting Booked by AI' :
                       'Proposal Generated by AI'}
                    </span>
                  </div>
                  <button
                    onClick={() => clearActiveAction?.()}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {latestAction.type === 'video_call' && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <div>
                      <span className="text-xs font-bold text-emerald-700 block">Routing to GREET</span>
                      <span className="text-[10px] text-slate-500 font-mono">Room: {latestAction.data?.roomId || 'meet-greet-room'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (onNavigate) {
                          onNavigate('call_canvas');
                        } else if (latestAction.data?.joinUrl) {
                          window.location.href = latestAction.data.joinUrl;
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                    >
                      <Video className="h-3.5 w-3.5" />
                      <span>Open GREET</span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {latestAction.type === 'calendar_event' && (
                  <div className="text-[11px] text-slate-700">
                    <div>{latestAction.data?.title}</div>
                    <div className="text-[10px] text-blue-700 font-mono mt-0.5">
                      📅 {latestAction.data?.date} @ {latestAction.data?.time} ({latestAction.data?.duration}m)
                    </div>
                  </div>
                )}

                {latestAction.type === 'proposal' && (
                  <div className="flex items-center justify-between text-[11px] pt-1">
                    <span className="text-slate-700 truncate">{latestAction.data?.title}</span>
                    <span className="text-amber-700 font-bold font-mono">
                      ${Number(latestAction.data?.price || 78000).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Active Contact Information Card */}
            <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 mb-4 flex items-center justify-between text-left">
              <div className="flex items-center gap-3">
                <div className={`h-10 w-10 rounded-2xl bg-gradient-to-tr ${selectedLead.avatarColor} flex items-center justify-center font-bold text-sm text-white shadow-xs`}>
                  {selectedLead.name.charAt(0)}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 tracking-tight">{selectedLead.name}</h4>
                  <p className="text-xs text-slate-500">{selectedLead.company} • <span className="font-mono text-slate-700">{selectedLead.phone}</span></p>
                </div>
              </div>
              <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-blue-50 text-blue-700 border border-blue-200">
                {selectedLead.stage}
              </span>
            </div>

            {/* Central Pulsing Audio Visualizer Ring Canvas */}
            <div className="relative h-44 w-44 my-1 flex items-center justify-center">

              {/* Outer Radial Dynamic Wave Rings */}
              {status === "active" && !isOnHold && (
                <>
                  <motion.div
                    animate={{
                      scale: [1, 1 + (audioLevel / 100) * 0.45, 1],
                      opacity: [0.2, 0.5, 0.2],
                    }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 rounded-full bg-blue-500/20 border border-blue-400/40"
                  />
                  <motion.div
                    animate={{
                      scale: [1, 1 + (audioLevel / 100) * 0.75, 1],
                      opacity: [0.1, 0.3, 0.1],
                    }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: 0.2 }}
                    className="absolute -inset-4 rounded-full bg-indigo-500/15 border border-indigo-400/30"
                  />
                </>
              )}

              {/* Inner Avatar Glow Sphere */}
              <div className={`relative h-28 w-28 rounded-full flex flex-col items-center justify-center shadow-lg transition-all duration-300 border ${
                agentState === "speaking" ? "bg-gradient-to-tr from-blue-600 to-indigo-600 border-blue-400 shadow-blue-500/30" :
                agentState === "listening" ? "bg-gradient-to-tr from-emerald-600 to-teal-700 border-emerald-400 shadow-emerald-500/30" :
                agentState === "thinking" ? "bg-gradient-to-tr from-purple-600 to-pink-600 border-purple-400 shadow-purple-500/30" :
                agentState === "on_hold" ? "bg-gradient-to-tr from-amber-600 to-orange-600 border-amber-400 shadow-amber-500/30" :
                agentState === "muted" ? "bg-gradient-to-tr from-rose-700 to-red-800 border-rose-400 shadow-rose-500/30" :
                "bg-slate-100 border-slate-300"
              }`}>
                {agentState === "speaking" && <Volume2 className="h-8 w-8 text-white animate-bounce" />}
                {agentState === "listening" && <Mic className="h-8 w-8 text-white animate-pulse" />}
                {agentState === "thinking" && <Sparkles className="h-8 w-8 text-white animate-spin" />}
                {agentState === "on_hold" && <Pause className="h-8 w-8 text-white" />}
                {agentState === "muted" && <MicOff className="h-8 w-8 text-white" />}
                {agentState === "idle" && <Bot className="h-8 w-8 text-slate-500" />}

                <span className={`text-[9px] font-bold uppercase tracking-wider mt-1 drop-shadow ${agentState === 'idle' ? 'text-slate-700' : 'text-white'}`}>
                  {agentState === "speaking" ? (activeDepartment ? `Specialist (${activeDepartment})` : "Alex AI Speaking") :
                   agentState === "listening" ? "Listening to Caller" :
                   agentState === "thinking" ? "Alex AI Processing..." :
                   agentState === "on_hold" ? (isTransferring ? "Warm Transfer" : "Call On Hold") :
                   agentState === "muted" ? "Mic Muted" : "Alex AI Ready"}
                </span>
              </div>
            </div>

            {/* Live Mic Activity Bar */}
            <div className="w-full max-w-xs mt-2 mb-3">
              <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1 font-mono font-semibold">
                <span>Microphone Activity</span>
                <span>{audioLevel}%</span>
              </div>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <motion.div
                  className="h-full bg-gradient-to-r from-blue-500 to-emerald-400"
                  style={{ width: `${audioLevel}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>
            </div>

            {/* Unified Alex AI Skill Focus & Intelligence Bar */}
            <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-2.5 mb-4 flex items-center justify-between gap-2 text-left">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">Unified Voice Agent</span>
                  <span className="text-xs font-bold text-slate-900">Alex AI ({selectedSkillMode.badge})</span>
                </div>
              </div>
              <select
                value={selectedSkillMode.id}
                onChange={(e) => {
                  const mode = ALEX_SKILL_MODES.find(x => x.id === e.target.value);
                  if (mode) setSelectedSkillMode(mode);
                }}
                className="bg-white border border-slate-200 rounded-xl px-2.5 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer shadow-xs"
              >
                {ALEX_SKILL_MODES.map(mode => (
                  <option key={mode.id} value={mode.id}>{mode.name}</option>
                ))}
              </select>
            </div>

            {/* Primary In-Call Actions Toolbar */}
            <div className="w-full flex items-center justify-center gap-3 pt-1">
              {/* Mute Button */}
              <button
                onClick={toggleMuted}
                disabled={status !== "active"}
                className={`h-12 w-12 rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
                  isMuted
                    ? "bg-rose-600 border-rose-500 text-white shadow-sm"
                    : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700 hover:text-slate-900"
                } disabled:opacity-40`}
                title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
              >
                {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>

              {/* Hold Button */}
              <button
                onClick={toggleHold}
                disabled={status !== "active"}
                className={`h-12 w-12 rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
                  isOnHold
                    ? "bg-amber-600 border-amber-500 text-white shadow-sm"
                    : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700 hover:text-slate-900"
                } disabled:opacity-40`}
                title={isOnHold ? "Resume Call" : "Hold Call"}
              >
                {isOnHold ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
              </button>

              {/* Main Call / Disconnect Trigger */}
              {status === "active" ? (
                <button
                  onClick={disconnect}
                  className="h-12 px-6 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-2 shadow-sm active:scale-95 transition-all cursor-pointer"
                >
                  <PhoneOff className="h-5 w-5" />
                  <span>End Call</span>
                </button>
              ) : (
                <button
                  onClick={() => handleInitiateCall()}
                  disabled={status === "connecting"}
                  className="h-12 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-sm active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Phone className="h-5 w-5" />
                  <span>Start Call</span>
                </button>
              )}

              {/* Record Toggle */}
              <button
                onClick={toggleRecording}
                disabled={status !== "active"}
                className={`h-12 w-12 rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
                  isRecording
                    ? "bg-blue-50 border-blue-300 text-blue-600"
                    : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-500 hover:text-slate-900"
                } disabled:opacity-40`}
                title="Toggle Call Audio Recording"
              >
                <Radio className={`h-5 w-5 ${isRecording ? "animate-pulse" : ""}`} />
              </button>

              {/* In-Call Keypad Extension Drawer Toggle */}
              <button
                onClick={() => setShowDTMFDrawer(prev => !prev)}
                className={`h-12 w-12 rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${
                  showDTMFDrawer
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700 hover:text-slate-900"
                }`}
                title="Open In-Call DTMF Keypad"
              >
                <Grid className="h-5 w-5" />
              </button>
            </div>

            {/* In-Call DTMF Keypad Drawer */}
            <AnimatePresence>
              {showDTMFDrawer && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="w-full overflow-hidden mt-4 pt-3 border-t border-slate-100"
                >
                  <p className="text-[10px] text-slate-500 mb-2 font-bold uppercase tracking-wider">Send Touch-Tone Digits (IVR)</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map(k => (
                      <button
                        key={k}
                        onClick={() => playDTMFTone(k)}
                        className="py-2 rounded-xl bg-slate-50 hover:bg-blue-600 hover:text-white text-xs font-mono font-bold border border-slate-200 transition-all cursor-pointer active:scale-95"
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mode-Specific Telephony Extensions below Visualizer */}
          {appMode === "livekit_ivr" && (
            <NotAvailablePanel
              title="LiveKit SIP telephony isn't available yet"
              body="Inbound SIP calls through LiveKit, provider failover and transfers to extensions aren't connected in this app. Use Call routing (Twilio) for your phone menu today."
              action={{ label: 'Open call routing', onClick: () => handleSwitchMode("twilio_ivr") }}
            />
          )}

          {appMode === "monitoring" && (
            <div className="space-y-4">
              <CallMonitoringDashboard />
            </div>
          )}

          {appMode === "sip_trunks" && (
            <NotAvailablePanel
              title="SIP trunk failover isn't available yet"
              body="Managing backup carriers and automatic failover isn't connected in this app. Calls use the Twilio number configured on the server."
              action={{ label: 'Open call routing', onClick: () => handleSwitchMode("twilio_ivr") }}
            />
          )}
        </div>

        {/* ========================================================================= */}
        {/* COLUMN 3: LIVE TRANSCRIPT, SPEECH TESTER & FAQS (lg:col-span-4)           */}
        {/* ========================================================================= */}
        <div className={`space-y-4 ${activeTab === "transcript" ? "block" : "hidden lg:block"} lg:col-span-4`}>

          {/* Live Transcript Card */}
          <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm flex flex-col h-[480px]">

            {/* Header with Sentiment & Lead Qualification Gauge */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Live AI Transcript</h3>
              </div>

              {/* Real-time Sentiment Tag & Score */}
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${
                  sentiment === "positive" || sentiment === "enthusiastic" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                  sentiment === "skeptical" ? "bg-amber-50 text-amber-700 border-amber-200" :
                  "bg-blue-50 text-blue-700 border-blue-200"
                }`}>
                  {sentiment}
                </span>
                <span className="text-xs font-mono font-bold text-slate-700 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-200">
                  {leadScore}% Match
                </span>
              </div>
            </div>

            {/* Real-time Conversation Stream */}
            <div
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto space-y-3 pr-1 text-left"
            >
              {transcripts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
                  <Bot className="h-8 w-8 text-slate-300 mb-2" />
                  <p className="text-xs font-medium text-slate-600">No live conversation yet.</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Start call or click a simulated inquiry below.</p>
                </div>
              ) : (
                transcripts.map((t) => {
                  const isAgent = t.sender === "agent";
                  return (
                    <motion.div
                      key={t.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex flex-col ${isAgent ? "items-start" : "items-end"}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 px-1">
                        {isAgent ? (
                          <>
                            <Sparkles className="h-3 w-3 text-blue-600" />
                            <span className="text-[9px] font-bold text-blue-600">
                              {activeDepartment ? `Specialist (${activeDepartment})` : `Alex AI (${selectedSkillMode.badge})`}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-[9px] font-bold text-emerald-700">{selectedLead.name}</span>
                            <User className="h-3 w-3 text-emerald-600" />
                          </>
                        )}
                        <span className="text-[8px] text-slate-400 font-mono">
                          {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>

                      <div className={`p-3 rounded-2xl text-xs leading-relaxed max-w-[90%] ${
                        isAgent
                          ? "bg-slate-100 text-slate-800 border border-slate-200 rounded-tl-sm"
                          : "bg-blue-600 text-white rounded-tr-sm shadow-sm"
                      }`}>
                        {t.text}
                      </div>
                    </motion.div>
                  );
                })
              )}

              {/* Interim Real-time Speech transcription indicator */}
              {interimTranscript && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-end"
                >
                  <span className="text-[9px] font-semibold text-slate-400 mb-0.5">Speaking live...</span>
                  <div className="p-2.5 rounded-2xl bg-blue-50 border border-blue-200 text-blue-900 text-xs italic max-w-[90%]">
                    {interimTranscript}
                  </div>
                </motion.div>
              )}
            </div>

            {/* Suggested Spoken Turn Chips */}
            <div className="pt-2 border-t border-slate-100 mt-2">
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                Suggested Turn Prompts (Click to Test Alex AI)
              </span>
              <div className="flex flex-wrap gap-1.5 mb-2.5 max-h-20 overflow-y-auto">
                {ALEX_VOICE_PROMPTS.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => submitVoiceInput(item.prompt)}
                    disabled={status !== "active"}
                    className="text-[10px] px-2.5 py-1 rounded-xl bg-slate-50 hover:bg-blue-50 hover:border-blue-300 border border-slate-200 text-slate-700 hover:text-blue-700 transition-all cursor-pointer disabled:opacity-40 truncate max-w-full"
                    title={item.prompt}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* Manual Voice Simulator Input */}
              <form onSubmit={handleManualSubmit} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={manualTypedText}
                  onChange={(e) => setManualTypedText(e.target.value)}
                  placeholder={status === "active" ? "Type speech phrase..." : "Start call to speak..."}
                  disabled={status !== "active"}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={status !== "active" || !manualTypedText.trim()}
                  className="h-8 w-8 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-sm"
                  title="Send spoken phrase"
                >
                  <CornerDownLeft className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>

          {/* AI Voice Concierge Knowledge & FAQs Widget */}
          <ReceptionistFAQKnowledge
            onSelectPrompt={(prompt) => submitVoiceInput(prompt)}
            onOpenTrainingStudio={() => setShowTrainingStudio(true)}
          />
        </div>

        {/* ========================================================================= */}
        {/* FULL-WIDTH CALL LOGS & CRM ACTIVITY HISTORY VIEW TAB (Mobile History)     */}
        {/* ========================================================================= */}
        <div className={`space-y-4 ${activeTab === "history" ? "block" : "hidden"} lg:hidden w-full`}>
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-blue-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Call History & Audio Transcripts</h3>
              </div>
              <span className="text-[10px] font-semibold text-slate-500">{callHistory.length} Recorded Sessions</span>
            </div>

            <div className="space-y-3">
              {callHistory.map(call => (
                <div key={call.id} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-left space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">{call.leadName}</h4>
                      <p className="text-xs text-slate-500">{call.leadCompany} • <span className="font-mono">{call.phone}</span></p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {call.sentiment}
                      </span>
                      <p className="text-[10px] text-slate-400 mt-1 font-mono">{formatDuration(call.duration)}</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed bg-white p-2.5 rounded-xl border border-slate-200">
                    {call.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* ========================================================================= */}
      {/* POST-CALL CRM INTELLIGENCE BRIEFING MODAL                                 */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {postCallSummary && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={clearPostCallSummary}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative z-10 w-full max-w-xl bg-white border border-slate-200 rounded-3xl p-6 shadow-2xl text-left max-h-[90vh] overflow-y-auto"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="h-10 w-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900">Post-Call AI Intelligence Briefing</h3>
                    <p className="text-xs text-slate-500">Automated Gemini analysis & receptionist routing record</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {postCallSummary.leadQuality}
                </span>
              </div>

              {/* Lead & Call Duration telemetry */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Caller</span>
                  <p className="text-xs font-bold text-slate-900 mt-0.5">{selectedLead.name} ({selectedLead.company})</p>
                </div>
                <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200">
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Duration & Sentiment</span>
                  <p className="text-xs font-bold text-emerald-700 mt-0.5 font-mono">
                    {formatDuration(callDuration)} • {postCallSummary.sentimentScore}
                  </p>
                </div>
              </div>

              {/* Executive Summary */}
              <div className="mb-4">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                  Executive Briefing
                </label>
                <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-800 leading-relaxed">
                  {postCallSummary.executiveSummary}
                </div>
              </div>

              {/* Key Topics & Action Items */}
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                    Key Topics Covered
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {postCallSummary.keyTopicsDiscussed.map((topic, i) => (
                      <span key={i} className="text-xs px-2.5 py-1 rounded-xl bg-blue-50 text-blue-700 border border-blue-200">
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1.5">
                    Identified Action Items
                  </label>
                  <div className="space-y-1.5">
                    {postCallSummary.actionItems.map((action, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span>{action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Formatted CRM Note Box */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    CRM Audit Log Note
                  </label>
                  <button
                    onClick={copyCRMNote}
                    className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
                  >
                    {copiedNote ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    <span>{copiedNote ? "Copied" : "Copy Note"}</span>
                  </button>
                </div>
                <textarea
                  readOnly
                  value={postCallSummary.crmNote}
                  className="w-full h-20 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 font-mono focus:outline-none resize-none"
                />
              </div>

              {/* Dialog Action Buttons */}
              <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
                <button
                  onClick={clearPostCallSummary}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-xs font-bold transition-all cursor-pointer"
                >
                  Dismiss
                </button>

                <button
                  onClick={handleScheduleFollowup}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 text-xs font-bold transition-all cursor-pointer"
                >
                  <Calendar className="h-3.5 w-3.5 text-blue-600" />
                  <span>Book in Calendar</span>
                </button>

                <button
                  onClick={handleSaveToCRM}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Save to CRM Activity</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>


      {/* AI Receptionist Interactive Training Studio Modal */}
      <AnimatePresence>
        {showTrainingStudio && (
          <ReceptionistTrainingCenter
            onClose={() => setShowTrainingStudio(false)}
            onNavigate={onNavigate}
            onLaunchCallTest={(prompt) => {
              setShowTrainingStudio(false);
              submitVoiceInput(prompt);
            }}
          />
        )}
      </AnimatePresence>

      {/* Floating Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
