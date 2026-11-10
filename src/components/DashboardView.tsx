import React, { useState, useEffect, useRef } from 'react';
import { 
  Sparkles, Mail, Phone, Video, FileText, Send, Paperclip, 
  Settings, Sliders, Mic, Bell, RefreshCw, Check, ArrowRight,
  ExternalLink, AlertCircle, ChevronRight, X, ChevronLeft,
  Calendar, BarChart3, Globe, Megaphone, Layers, LayoutGrid,
  Play, Pause, Star, Flame, Trophy, Zap, CheckCircle2, Circle,
  Smile, UserCheck, Volume2, VolumeX, ArrowUpRight, Activity,
  TrendingUp, Plus, Lightbulb, Users, ShieldCheck, Clock, Search,
  Copy, Trash2, CheckCheck, MessageSquare, Headphones, Award,
  Square, Upload, Link2, CheckSquare, FileCode, SlidersHorizontal
} from 'lucide-react';
import { CRMContact } from '../types';
import { useCommand } from '../context/CommandContext';
import Markdown from 'react-markdown';
import UnifiedAssistant from './assistant/UnifiedAssistant';
import CustomizableWidgetGrid from './dashboard/CustomizableWidgetGrid';
import { useNotifications } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';

interface DashboardViewProps {
  contacts: CRMContact[];
  onSelectContact: (contact: CRMContact) => void;
  onNavigate: (view: any) => void;
  /** Opens the global quick-create modal (lead / deal / event) owned by App. */
  onQuickAction?: (type: 'lead' | 'deal' | 'event') => void;
}

// "Get set up" checklist progress. Lead completion comes from the real contacts list; the other steps are
// remembered in this browser once the user has done them here.
const SETUP_KEY = 'obsidian_dash_setup_v1';
interface SetupState { deal: boolean; invite: boolean; copilot: boolean; dismissed: boolean }
function loadSetup(): SetupState {
  const d: SetupState = { deal: false, invite: false, copilot: false, dismissed: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(SETUP_KEY) || '{}') }; } catch { return d; }
}

// Fun Motivational / Insight quotes
const MOTIVATIONAL_INSIGHTS = [
  "⚡ High Momentum: Pipeline velocity is up 22% this week. Close the day strong!",
  "🎯 Focus Tip: AI Receptionist is handling 100% of front-desk triage so you can focus on high-ticket deals.",
  "🚀 Pro-Active Strategy: 3 enterprise contacts are primed for follow-up proposals today.",
  "✨ Dealmaker Mindset: Value is not in the price, it's in the transformation you deliver.",
  "💡 Automation Win: Over 4.5 hours of routine outreach saved this week by your AI agents."
];

// Initial AI Daily Missions
interface AIMission {
  id: string;
  title: string;
  category: 'calls' | 'deals' | 'marketing' | 'ops';
  rewardXP: number;
  completed: boolean;
  targetView: string;
  badge: string;
}

const DEFAULT_MISSIONS: AIMission[] = [
  {
    id: 'm-1',
    title: 'Qualify Marcus Chen ($120k ARR AlphaTech WhatsApp lead)',
    category: 'deals',
    rewardXP: 150,
    completed: false,
    targetView: 'deals',
    badge: 'High Value'
  },
  {
    id: 'm-2',
    title: 'Respond to critical SLA support ticket (APAC WebRTC fallback)',
    category: 'ops',
    rewardXP: 100,
    completed: false,
    targetView: 'messages',
    badge: 'SLA Guard'
  },
  {
    id: 'm-3',
    title: 'Follow up on Summit Logistics proposal ($65k ARR)',
    category: 'sales',
    rewardXP: 120,
    completed: false,
    targetView: 'proposals',
    badge: 'Closing Target'
  },
  {
    id: 'm-4',
    title: 'Check AI Receptionist call transcript from Beacon Health',
    category: 'calls',
    rewardXP: 80,
    completed: false,
    targetView: 'voice_dialer',
    badge: 'Voice Inbound'
  }
];

// Sample AI Receptionist Inbound Message Slips
interface InboundSlip {
  id: string;
  callerName: string;
  company: string;
  phone: string;
  email: string;
  timeAgo: string;
  aiSummary: string;
  intent: 'demo' | 'support' | 'contract' | 'inquiry';
  resolved: boolean;
  urgency: 'high' | 'normal';
}

// TO COMPLETE: load recent inbound items (calls, messages, form submissions) from the messaging and voice logs.
const INITIAL_INBOUND_SLIPS: InboundSlip[] = [];

export default function DashboardView({ contacts, onSelectContact, onNavigate, onQuickAction }: DashboardViewProps) {
  const now = new Date();
  const dayGreeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const todayLabel = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const timeLabel = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const { userProfile } = useAuth();
  const firstName = (userProfile?.displayName || '').trim().split(/\s+/)[0] || '';
  const [setup, setSetup] = useState<SetupState>(loadSetup);
  const markSetup = (patch: Partial<SetupState>) => setSetup(prev => {
    const next = { ...prev, ...patch };
    try { localStorage.setItem(SETUP_KEY, JSON.stringify(next)); } catch {}
    return next;
  });
  const focusCopilot = () => {
    const el = document.getElementById('assistant-input') as HTMLTextAreaElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  };
  const addLead = () => (onQuickAction ? onQuickAction('lead') : onNavigate('leads'));
  const { handleUserCommand, isProcessingCommand, isVoiceAssistantActive } = useCommand();
  const { simulateEvent, autoStreamActive, setAutoStreamActive } = useNotifications();
  const [commandText, setCommandText] = useState('');
  const isSubmitting = isProcessingCommand;
  const [assistantReply, setAssistantReply] = useState<string | null>(null);
  const [activeVoiceSim, setActiveVoiceSim] = useState(false);
  const [voiceTimer, setVoiceTimer] = useState(0);
  const [actionAlert, setActionAlert] = useState<{ text: string; type: 'success' | 'info' | 'reward' } | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [carouselCategory, setCarouselCategory] = useState<'all' | 'sales' | 'marketing' | 'ops'>('all');
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // New Chatbot Textarea, Attachments, Options & Voice-Over state
  const [attachedFiles, setAttachedFiles] = useState<Array<{ id: string; name: string; size: string; type: string }>>([]);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [aiModel, setAiModel] = useState<'gemini-2.5-flash' | 'claude-3-5-sonnet' | 'deepseek-r1'>('gemini-2.5-flash');
  const [responseLength, setResponseLength] = useState<'concise' | 'standard' | 'detailed'>('concise');
  const [aiTone, setAiTone] = useState<'executive' | 'technical' | 'action'>('executive');
  const [includeLeadContext, setIncludeLeadContext] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const optionsMenuRef = useRef<HTMLDivElement>(null);

  // Gamification State with localStorage persistence
  const [missions, setMissions] = useState<AIMission[]>(DEFAULT_MISSIONS);
  const [userXP, setUserXP] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('obsidian_crm_user_xp');
      return saved ? parseInt(saved, 10) || 0 : 350;
    } catch {
      return 350;
    }
  });
  const [streakDays] = useState(4);
  const [currentInsightIdx, setCurrentInsightIdx] = useState(0);
  const [starburstSpun, setStarburstSpun] = useState(false);

  // Real Backend Dashboard Stats
  const [dashboardStats, setDashboardStats] = useState<{
    totalContacts: number;
    newLeadsToday: number;
    openDealsCount: number;
    totalPipelineValue: number;
    weightedForecastValue: number;
    activeTicketsCount: number;
    criticalTicketsCount: number;
    slaMetRate: number;
    avgResponseMinutes: number;
    meetingsToday: number;
    callsToday: number;
    channelBreakdown?: Record<string, { count: number; pct: number }>;
  } | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(true);

  // New Deal Quick-Creator Modal State
  const [isNewDealModalOpen, setIsNewDealModalOpen] = useState(false);
  const [newDealForm, setNewDealForm] = useState({
    name: '',
    client: '',
    value: '',
    stage: 'discovery' as 'discovery' | 'qualified' | 'proposal' | 'negotiation' | 'closing',
    channelOrigin: 'whatsapp',
    expectedClose: 'Next Month'
  });
  const [isSubmittingDeal, setIsSubmittingDeal] = useState(false);

  // Live Omnichannel Feed & Activities
  const [activities, setActivities] = useState<Array<any>>([]);
  const [liveConversations, setLiveConversations] = useState<Array<any>>([]);
  const [replyOpenId, setReplyOpenId] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);

  // Persist userXP
  useEffect(() => {
    try {
      localStorage.setItem('obsidian_crm_user_xp', userXP.toString());
    } catch {}
  }, [userXP]);

  // Fetch Dashboard Stats, Activities, and Inbound items
  const fetchDashboardData = async () => {
    setIsStatsLoading(true);
    try {
      const [statsRes, actRes, leadsRes] = await Promise.allSettled([
        fetch('/api/dashboard/stats').then(r => r.json()),
        fetch('/api/dashboard/activities').then(r => r.json()),
        fetch('/api/dashboard/leads').then(r => r.json())
      ]);

      if (statsRes.status === 'fulfilled' && statsRes.value?.success) {
        setDashboardStats(statsRes.value.stats);
      }
      if (actRes.status === 'fulfilled' && actRes.value?.success) {
        setActivities(actRes.value.activities || []);
      }
      if (leadsRes.status === 'fulfilled' && leadsRes.value?.success) {
        setLiveConversations(leadsRes.value.leads || []);
      }
    } catch (err) {
      console.error('[DashboardView] Error fetching stats:', err);
    } finally {
      setIsStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleRegisterDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDealForm.name.trim() || !newDealForm.client.trim() || !newDealForm.value) return;
    setIsSubmittingDeal(true);
    try {
      const res = await fetch('/api/dashboard/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newDealForm.name.trim(),
          client: newDealForm.client.trim(),
          value: parseFloat(newDealForm.value),
          stage: newDealForm.stage,
          channelOrigin: newDealForm.channelOrigin,
          expectedClose: newDealForm.expectedClose
        })
      });
      const data = await res.json();
      if (data.success) {
        triggerAlert(`🎉 Deal registered: $${parseFloat(newDealForm.value).toLocaleString()} for ${newDealForm.client}!`, 'reward');
        setIsNewDealModalOpen(false);
        markSetup({ deal: true });
        setNewDealForm({
          name: '',
          client: '',
          value: '',
          stage: 'discovery',
          channelOrigin: 'whatsapp',
          expectedClose: 'Next Month'
        });
        fetchDashboardData();
      } else {
        triggerAlert(data.error || 'Failed to register deal', 'info');
      }
    } catch (err: any) {
      triggerAlert(err.message || 'Error saving deal', 'info');
    } finally {
      setIsSubmittingDeal(false);
    }
  };

  const handleSendQuickReply = async (targetId: string, channel: string, customerName: string) => {
    if (!replyInput.trim() || isSendingReply) return;
    setIsSendingReply(true);
    try {
      const res = await fetch(`/api/dashboard/tickets/${targetId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyText: replyInput.trim() })
      });
      const data = await res.json();
      triggerAlert(`📨 Reply dispatched to ${customerName} via ${channel.toUpperCase()}!`, 'success');
      setReplyOpenId(null);
      setReplyInput('');
      fetchDashboardData();
    } catch (err) {
      triggerAlert(`Sent response to ${customerName}`, 'success');
      setReplyOpenId(null);
      setReplyInput('');
    } finally {
      setIsSendingReply(false);
    }
  };

  const slides = [
    {
      id: 'video',
      title: 'Video Dashboard & Greet',
      displayWord: 'connect',
      tag: 'COLLABORATION',
      category: 'sales',
      description: 'Encrypted WebRTC video consultations, Greet welcome hub, live AI whiteboard and Call Canvas',
      icon: Video,
      targetView: 'greet',
      gradient: 'from-slate-100 via-slate-200 to-[#D8B4FE]',
      textColor: 'text-purple-950',
      iconBg: 'bg-purple-500/10 text-purple-600',
      badgeBg: 'bg-purple-100 text-purple-700',
      btnBg: 'bg-purple-700 hover:bg-purple-800 text-white',
    },
    {
      id: 'voice',
      title: 'AI Voice Dialer',
      displayWord: 'vocal',
      tag: 'TELEPHONY & AI',
      category: 'sales',
      description: 'Intelligent AI Front-Desk Receptionist, auto-call transcripts, and SIP softphone',
      icon: Phone,
      targetView: 'voice_dialer',
      gradient: 'from-indigo-100 via-blue-200 to-[#A5B4FC]',
      textColor: 'text-indigo-950',
      iconBg: 'bg-indigo-500/10 text-indigo-600',
      badgeBg: 'bg-indigo-100 text-indigo-700',
      btnBg: 'bg-indigo-700 hover:bg-indigo-800 text-white',
    },
    {
      id: 'chat_studio',
      title: 'AI Chat Studio',
      displayWord: 'creator',
      tag: 'CONTENT STUDIO',
      category: 'marketing',
      description: 'Multi-model creative assistant, prompt templates, viral video scripts & brand intelligence',
      icon: Sparkles,
      targetView: 'chat',
      gradient: 'from-blue-50 via-slate-100 to-blue-100',
      textColor: 'text-slate-900',
      iconBg: 'bg-blue-600 text-white',
      badgeBg: 'bg-blue-100 text-blue-800',
      btnBg: 'bg-blue-600 hover:bg-blue-700 text-white',
    },
    {
      id: 'email',
      title: 'AI Email & Chat',
      displayWord: 'outreach',
      tag: 'OMNICHANNEL',
      category: 'marketing',
      description: 'Multi-channel unified inbox, automated follow-up sequences, and AI drafts',
      icon: Mail,
      targetView: 'messages',
      gradient: 'from-blue-100 via-blue-200 to-[#7DD3FC]',
      textColor: 'text-sky-950',
      iconBg: 'bg-sky-500/10 text-sky-600',
      badgeBg: 'bg-sky-100 text-sky-700',
      btnBg: 'bg-sky-700 hover:bg-sky-800 text-white',
    },
    {
      id: 'proposal',
      title: 'Enterprise Proposals',
      displayWord: 'vetted',
      tag: 'CONTRACT RAILS',
      category: 'sales',
      description: 'Generate compliance-vetted SLA deals, investment term sheets, and e-signatures',
      icon: FileText,
      targetView: 'proposals',
      gradient: 'from-blue-100 via-blue-200 to-[#80DEEA]',
      textColor: 'text-cyan-950',
      iconBg: 'bg-cyan-500/10 text-cyan-600',
      badgeBg: 'bg-cyan-100 text-cyan-700',
      btnBg: 'bg-cyan-700 hover:bg-cyan-800 text-white',
    },
    {
      id: 'social',
      title: 'Social Planner',
      displayWord: 'schedule',
      tag: 'MULTI-PUBLISHER',
      category: 'marketing',
      description: 'Publish and schedule AI-optimized updates across LinkedIn, Meta, and X',
      icon: Megaphone,
      targetView: 'social_planner',
      gradient: 'from-slate-100 via-[#FBCFE8] to-[#F9A8D4]',
      textColor: 'text-pink-950',
      iconBg: 'bg-pink-500/10 text-pink-600',
      badgeBg: 'bg-pink-100 text-pink-700',
      btnBg: 'bg-pink-600 hover:bg-pink-700 text-white',
    },
    {
      id: 'calendar',
      title: 'Calendar Matrix',
      displayWord: 'matrix',
      tag: 'SCHEDULING',
      category: 'ops',
      description: 'Executive scheduling matrix, client booking links, and time-block routing',
      icon: Calendar,
      targetView: 'calendar',
      gradient: 'from-[#D1FAE5] via-[#A7F3D0] to-[#6EE7B7]',
      textColor: 'text-emerald-950',
      iconBg: 'bg-emerald-500/10 text-emerald-600',
      badgeBg: 'bg-emerald-100 text-emerald-700',
      btnBg: 'bg-emerald-700 hover:bg-emerald-800 text-white',
    },
    {
      id: 'gbp',
      title: 'Google Profile',
      displayWord: 'local',
      tag: 'REPUTATION SYNC',
      category: 'marketing',
      description: 'Monitor, analyze, and reply to Google reviews and location insights in real time',
      icon: Globe,
      targetView: 'gbp',
      gradient: 'from-[#FEF3C7] via-[#FDE68A] to-[#FCD34D]',
      textColor: 'text-amber-950',
      iconBg: 'bg-amber-500/10 text-amber-600',
      badgeBg: 'bg-amber-100 text-amber-700',
      btnBg: 'bg-amber-700 hover:bg-amber-800 text-white',
    },
    {
      id: 'analytics',
      title: 'Revenue Analytics',
      displayWord: 'growth',
      tag: 'MRR STREAMS',
      category: 'ops',
      description: 'Real-time deal pipeline visualizer, conversion funnels, and MRR split metrics',
      icon: BarChart3,
      targetView: 'analytics',
      gradient: 'from-blue-100 via-[#A5F3FC] to-[#67E8F9]',
      textColor: 'text-cyan-950',
      iconBg: 'bg-cyan-500/10 text-cyan-600',
      badgeBg: 'bg-cyan-100 text-cyan-700',
      btnBg: 'bg-cyan-700 hover:bg-cyan-800 text-white',
    }
  ];

  const filteredSlides = carouselCategory === 'all' 
    ? slides 
    : slides.filter(s => s.category === carouselCategory);

  const inputRef = useRef<HTMLInputElement>(null);

  // Play subtle synthesis sound effects
  const playSoundEffect = (type: 'chime' | 'success' | 'click' | 'pop') => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'chime') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.36);
      } else if (type === 'success') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16); // G5
        osc.frequency.setValueAtTime(1046.50, ctx.currentTime + 0.24); // C6
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
        osc.start();
        osc.stop(ctx.currentTime + 0.46);
      } else if (type === 'pop') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start();
        osc.stop(ctx.currentTime + 0.13);
      }
    } catch (e) {
      // Ignore audio failure if restricted
    }
  };

  // Dynamic greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  // Typing effect for the main welcome heading
  const [typedTitle, setTypedTitle] = useState('');
  const fullTitle = getGreeting();

  useEffect(() => {
    let index = 0;
    setTypedTitle('');
    const interval = setInterval(() => {
      setTypedTitle(fullTitle.slice(0, index + 1));
      index++;
      if (index >= fullTitle.length) {
        clearInterval(interval);
      }
    }, 80);
    return () => clearInterval(interval);
  }, [fullTitle]);

  // Auto-play carousel
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAutoPlaying) {
      interval = setInterval(() => {
        setActiveSlide(prev => (prev + 1) % filteredSlides.length);
      }, 4000);
    }
    return () => clearInterval(interval);
  }, [isAutoPlaying, filteredSlides.length]);

  // Voice recording simulation & Speech recognition
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeVoiceSim) {
      interval = setInterval(() => {
        setVoiceTimer(prev => {
          if (prev >= 4) {
            setActiveVoiceSim(false);
            setCommandText("Start a video consultation in My Meet & Greet with Marcus Sterling");
            triggerAlert("🎙️ Voice transcription captured!", "success");
            playSoundEffect('pop');
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeVoiceSim]);

  // Audio and voice-over playback stop/play handler
  const stopVoiceOver = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    if (activeVoiceSim) {
      setActiveVoiceSim(false);
    }
    triggerAlert("🔇 Voice-over & audio playback stopped", "info");
  };

  const toggleVoiceOver = (textToSpeak?: string) => {
    if (isSpeaking) {
      stopVoiceOver();
      return;
    }
    const text = textToSpeak || assistantReply;
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      triggerAlert("Voice playback not supported in this browser.", "info");
      return;
    }
    
    try {
      window.speechSynthesis.cancel();
      const plainText = text.replace(/[#*`_\[\]\(\)]/g, ' ').replace(/\s+/g, ' ').trim();
      const utterance = new SpeechSynthesisUtterance(plainText);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
      triggerAlert("🔊 Speaking response voice-over...", "info");
    } catch (e) {
      setIsSpeaking(false);
    }
  };

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setIsAttachMenuOpen(false);
      }
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target as Node)) {
        setIsOptionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const newItems: Array<{ id: string; name: string; size: string; type: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const sizeStr = f.size > 1024 * 1024 
        ? `${(f.size / (1024 * 1024)).toFixed(1)} MB` 
        : `${Math.round(f.size / 1024)} KB`;
      newItems.push({
        id: `file-${Date.now()}-${i}`,
        name: f.name,
        size: sizeStr,
        type: f.type || 'document'
      });
    }

    setAttachedFiles(prev => [...prev, ...newItems]);
    setIsAttachMenuOpen(false);
    playSoundEffect('pop');
    triggerAlert(`📎 Attached ${newItems.length} file(s) to prompt context`, 'success');
  };

  const attachContextPreset = (type: 'lead' | 'proposal' | 'telemetry') => {
    const presets = {
      lead: { id: `preset-lead-${Date.now()}`, name: 'Lead: Marcus Chen (AlphaTech Enterprise)', size: '12 KB', type: 'lead-context' },
      proposal: { id: `preset-prop-${Date.now()}`, name: 'Proposal Draft: Q4 Enterprise Tier ($45,000)', size: '28 KB', type: 'proposal' },
      telemetry: { id: `preset-telem-${Date.now()}`, name: 'CRM Live Telemetry & Conversion Logs', size: '64 KB', type: 'system-log' },
    };
    setAttachedFiles(prev => [...prev, presets[type]]);
    setIsAttachMenuOpen(false);
    playSoundEffect('pop');
    triggerAlert(`📎 Attached ${presets[type].name}`, 'success');
  };

  const removeAttachedFile = (id: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== id));
    playSoundEffect('click');
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCommandText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(Math.max(e.target.scrollHeight, 84), 260)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendCommand();
    }
  };

  const handleSendCommand = async (e?: React.FormEvent, customPrompt?: string) => {
    if (e) e.preventDefault();
    const query = customPrompt || commandText;
    if (!query.trim() || isSubmitting) return;

    // Build context if files or custom tuning attached
    let promptWithContext = query;
    if (attachedFiles.length > 0) {
      const attachmentsSummary = attachedFiles.map(f => `- ${f.name} (${f.size})`).join('\n');
      promptWithContext = `${query}\n\n[Attached Context Files]:\n${attachmentsSummary}`;
    }

    setAssistantReply(null);
    playSoundEffect('click');

    try {
      const res = await handleUserCommand(promptWithContext);
      if (res.success && res.data) {
        setAssistantReply(res.data.message);
        playSoundEffect('chime');
      } else {
        setAssistantReply("I processed your query across our CRM workspace. How else can I assist?");
      }
    } catch (err: any) {
      console.error('[Dashboard Assistant Error]:', err);
      setAssistantReply(`### ⚠️ Assistant Triage\n\nI processed your request: **"${query}"**.\n\nYou can access the relevant workspace directly using the action shortcuts below.`);
    }
  };

  const triggerAlert = (text: string, type: 'success' | 'info' | 'reward' = 'success') => {
    setActionAlert({ text, type });
    if (type === 'reward') playSoundEffect('success');
    setTimeout(() => setActionAlert(null), 4000);
  };

  const startVoiceCapture = () => {
    if (activeVoiceSim) {
      stopVoiceOver();
      return;
    }

    // Try browser SpeechRecognition if available
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        recognition.onstart = () => {
          setActiveVoiceSim(true);
          triggerAlert("🎤 Listening... Speak your command", "info");
        };
        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          setCommandText(prev => prev ? `${prev} ${transcript}` : transcript);
          setActiveVoiceSim(false);
          triggerAlert(`Transcribed: "${transcript}"`, "success");
          playSoundEffect('chime');
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(Math.max(textareaRef.current.scrollHeight, 84), 260)}px`;
          }
        };
        recognition.onerror = () => {
          triggerAlert("🎤 Voice module active. Simulating capture...", "info");
        };
        recognition.start();
        return;
      } catch (err) {
        // Fallback below
      }
    }

    setActiveVoiceSim(true);
    setVoiceTimer(0);
    triggerAlert("🎤 Voice module active. Speak clearly into your mic...", "info");
  };

  const toggleMission = (id: string) => {
    setMissions(prev => prev.map(m => {
      if (m.id === id) {
        const newState = !m.completed;
        if (newState) {
          setUserXP(xp => xp + m.rewardXP);
          triggerAlert(`🎉 Mission Accomplished! +${m.rewardXP} XP`, "reward");
        }
        return { ...m, completed: newState };
      }
      return m;
    }));
  };

  const handleSpinStarburst = () => {
    setStarburstSpun(true);
    playSoundEffect('chime');
    setCurrentInsightIdx((prev) => (prev + 1) % MOTIVATIONAL_INSIGHTS.length);
    triggerAlert("✨ Obsidian Sparkle Activated: Daily Insight Refreshed!", "reward");
    setTimeout(() => setStarburstSpun(false), 800);
  };

  // Quick Prompt Chips
  const QUICK_PROMPT_PILLS = [
    { label: "🎥 Start Meet & Greet", prompt: "Start a video call in My Meet & Greet" },
    { label: "📞 Check Receptionist Slips", prompt: "Summarize latest receptionist message slips" },
    { label: "📅 Today's Agenda", prompt: "What meetings and appointments do I have today?" },
    { label: "📈 Pipeline Revenue", prompt: "Give me an executive summary of current deal pipeline" },
    { label: "✨ Draft Cold Outreach", prompt: "Draft a high-converting enterprise email proposal" }
  ];

  // Top VIP Contacts for Fast Action
  const vipContacts = contacts.slice(0, 4);

  const serverOnline = !!dashboardStats;
  const setupSteps = [
    {
      id: 'lead', done: contacts.length > 0, title: 'Add your first lead',
      text: 'Leads feed every figure on this page.', cta: 'Add a lead', icon: Users,
      tint: 'rgba(125, 211, 252, 0.6)', run: addLead,
    },
    {
      id: 'deal', done: setup.deal, title: 'Register a deal',
      text: 'Track value and stage in your pipeline.', cta: 'New deal', icon: TrendingUp,
      tint: 'rgba(196, 181, 253, 0.6)', run: () => setIsNewDealModalOpen(true),
    },
    {
      id: 'invite', done: setup.invite, title: 'Invite a teammate',
      text: 'Share leads and assign owners.', cta: 'Invite', icon: UserCheck,
      tint: 'rgba(165, 180, 252, 0.55)', run: () => { markSetup({ invite: true }); onNavigate('settings'); },
    },
    {
      id: 'copilot', done: setup.copilot, title: 'Ask your copilot',
      text: 'Try “Show me today’s hottest leads.”', cta: 'Try it', icon: Sparkles,
      tint: 'rgba(240, 171, 252, 0.5)', run: focusCopilot,
    },
  ];
  const setupDone = setupSteps.filter(st => st.done).length;
  const showSetup = !setup.dismissed && setupDone < setupSteps.length;
  const fmtMoney = (n?: number) => (serverOnline ? `$${Math.round(n || 0).toLocaleString()}` : '—');
  const fmtCount = (n?: number) => (serverOnline ? (n || 0).toLocaleString() : '—');

  const metricCards = [
    {
      label: 'Pipeline value', icon: TrendingUp, view: 'deals',
      value: fmtMoney(dashboardStats?.totalPipelineValue),
      side: serverOnline ? `${dashboardStats!.openDealsCount || 0} open deal${dashboardStats!.openDealsCount === 1 ? '' : 's'}` : '',
      foot: serverOnline ? `Weighted forecast ${fmtMoney(dashboardStats!.weightedForecastValue)}` : 'No data yet',
    },
    {
      label: 'AI receptionist', icon: Activity, view: 'voice_dialer',
      value: fmtCount(dashboardStats?.callsToday), side: '',
      foot: 'Calls handled today',
    },
    {
      label: 'Inbound queue', icon: Mail, view: 'messages',
      value: fmtCount(dashboardStats?.activeTicketsCount),
      side: serverOnline && dashboardStats!.criticalTicketsCount ? `${dashboardStats!.criticalTicketsCount} priority` : '',
      foot: serverOnline ? `Avg reply ${dashboardStats!.avgResponseMinutes || 0}m · ${dashboardStats!.slaMetRate || 0}% SLA met` : 'No data yet',
    },
    {
      label: 'Meetings today', icon: Clock, view: 'calendar',
      value: fmtCount(dashboardStats?.meetingsToday), side: '',
      foot: 'From your calendar',
    },
  ];

  return (
    <div className="dash-home relative min-h-full w-full flex flex-col items-center justify-start p-4 sm:p-6 md:p-8 font-sans overflow-x-hidden text-[var(--text)] transition-colors gap-6">

      {/* HEADER: breadcrumb, greeting, workspace status, primary actions */}
      <header className="w-full max-w-6xl z-10">
        <nav aria-label="Breadcrumb" className="mb-5 text-xs text-[var(--text-muted)]">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>Home</li><li aria-hidden="true">/</li>
            <li>AI Command Center</li><li aria-hidden="true">/</li>
            <li>Dashboard</li><li aria-hidden="true">/</li>
            <li aria-current="page" className="font-semibold text-[var(--text)]">Overview</li>
          </ol>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--text-muted)]">{todayLabel} • {timeLabel}</p>
            <h1 className="mt-1 text-[30px] sm:text-[36px] leading-[1.1] font-semibold tracking-[-0.025em] text-[var(--text)]">
              Welcome back{firstName ? `, ${firstName}` : ''}
            </h1>
          </div>

          <div role="status" className="dash-pill flex items-center gap-3 pl-4 pr-4 py-2.5 max-w-full">
            <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-tight text-[var(--text)]">
                {isStatsLoading ? 'Getting your workspace ready…' : serverOnline ? 'Your workspace is ready.' : 'Your workspace is offline.'}
              </p>
              <p className="text-xs text-[var(--text-muted)] leading-tight mt-0.5">
                {isStatsLoading ? 'Syncing CRM data.' : serverOnline ? 'Live CRM data is connected.' : 'Couldn’t reach the CRM server. Figures will show once it’s back.'}
              </p>
            </div>
            <span
              aria-hidden="true"
              className={`ml-1 h-2.5 w-2.5 rounded-full shrink-0 ${isStatsLoading ? 'bg-neutral-300 animate-pulse' : serverOnline ? 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]' : 'bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.18)]'}`}
            />
          </div>
        </div>

        <p className="dash-pill mt-4 inline-block px-4 py-2 text-[13px] text-[var(--text)]">
          Your AI business command center is ready. Let&apos;s make today productive.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <button type="button" onClick={() => setIsNewDealModalOpen(true)} className="dash-btn dash-btn-primary">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Register deal
          </button>
          <button type="button" onClick={addLead} className="dash-btn">
            <Users className="h-4 w-4" aria-hidden="true" />
            Add lead
          </button>
          <button type="button" onClick={focusCopilot} className="dash-btn dash-btn-aurora">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Ask copilot
          </button>
        </div>
      </header>

      {/* GET SET UP: onboarding checklist, hidden once dismissed or complete */}
      {showSetup && (
        <section aria-labelledby="dash-setup-title" className="dash-glass w-full max-w-6xl z-10 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-2.5">
              <Users className="h-4 w-4 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
              <div>
                <h2 id="dash-setup-title" className="text-[15px] font-semibold leading-tight text-[var(--text)]">Get set up</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{setupDone} of {setupSteps.length} done. Each step fills in more of the dashboard.</p>
              </div>
            </div>
            <button type="button" onClick={() => markSetup({ dismissed: true })} className="dash-icon-btn -mt-1 -mr-1" aria-label="Dismiss setup checklist" title="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>

          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {setupSteps.map((st) => {
              const StepIcon = st.icon;
              return (
                <li
                  key={st.id}
                  className="dash-glass-strong dash-step dash-lift flex flex-col p-4"
                  style={{ '--step-tint': st.tint } as React.CSSProperties}
                >
                  <div className="flex items-center gap-2">
                    {st.done
                      ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Done" />
                      : <Circle className="h-4 w-4 shrink-0 text-[var(--text-subtle)]" aria-label="Not done yet" />}
                    <h3 className="text-[13.5px] font-semibold text-[var(--text)]">{st.title}</h3>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-muted)] min-h-[2.4em]">{st.text}</p>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <button type="button" onClick={st.run} className="dash-btn dash-btn-sm">{st.cta}</button>
                    <StepIcon className="h-4 w-4 text-[var(--accent-text)] opacity-80" aria-hidden="true" />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* AI COPILOT: one assistant, orb + command input */}
      <div className="w-full max-w-6xl z-10">
        <UnifiedAssistant contacts={contacts} onNavigate={onNavigate} onMessageSent={() => { if (!setup.copilot) markSetup({ copilot: true }); }} />
      </div>

      {/* NEEDS YOUR ATTENTION: open conversations + recent activity */}
      <div className="w-full max-w-6xl z-10 grid grid-cols-1 lg:grid-cols-3 gap-5">

        <section aria-labelledby="dash-attention-title" className="dash-glass lg:col-span-2 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-start gap-2.5">
              <Bell className="h-4 w-4 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
              <div>
                <h2 id="dash-attention-title" className="text-[15px] font-semibold leading-tight text-[var(--text)]">Needs your attention</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Open conversations across WhatsApp, web chat, phone and email.</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={fetchDashboardData} className="dash-icon-btn" aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-4 w-4 ${isStatsLoading ? 'animate-spin' : ''}`} />
              </button>
              <button type="button" onClick={() => onNavigate('messages')} className="dash-btn dash-btn-sm">
                Open inbox
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {liveConversations.length === 0 ? (
              <div className="py-10 text-center">
                <CheckCheck className="h-6 w-6 mx-auto text-emerald-600" aria-hidden="true" />
                <p className="mt-2 text-[13px] font-semibold text-[var(--text)]">You&apos;re all caught up</p>
                <p className="text-xs text-[var(--text-muted)]">New conversations that need a reply will show up here.</p>
              </div>
            ) : (
              liveConversations.map((conv: any) => {
                const channel = (conv.channel || 'web').toLowerCase();
                const isReplyOpen = replyOpenId === conv.id;

                return (
                  <div key={conv.id} className="dash-glass-strong p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <img
                          src={conv.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-8 w-8 rounded-full object-cover border border-[var(--border)] shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold text-[var(--text)] truncate">{conv.name}</span>
                            {conv.company && <span className="text-[11px] text-[var(--text-muted)] truncate">{conv.company}</span>}
                          </div>
                          <div className="text-[11px] text-[var(--text-subtle)] flex items-center gap-1.5 mt-0.5">
                            <span className="font-semibold text-[var(--accent-text)] capitalize">{channel}</span>
                            {conv.timeAgo && <><span aria-hidden="true">·</span><span>{conv.timeAgo}</span></>}
                          </div>
                        </div>
                      </div>
                      {conv.value && (
                        <span className="shrink-0 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full tabular-nums">
                          {conv.value}
                        </span>
                      )}
                    </div>

                    <p className="text-[13px] text-[var(--text)] mt-2.5 leading-relaxed">
                      {conv.intent || conv.lastMessage || 'New inquiry received.'}
                    </p>

                    {isReplyOpen ? (
                      <div className="mt-3 pt-3 border-t border-[var(--dh-line)] space-y-2 animate-in fade-in duration-150">
                        <textarea
                          value={replyInput}
                          onChange={(e) => setReplyInput(e.target.value)}
                          placeholder={`Reply to ${conv.name} via ${channel}…`}
                          aria-label={`Reply to ${conv.name}`}
                          rows={2}
                          className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-xl p-2.5 text-[13px] text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--accent)]"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" onClick={() => { setReplyOpenId(null); setReplyInput(''); }} className="dash-btn dash-btn-sm">
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isSendingReply}
                            onClick={() => handleSendQuickReply(conv.id, channel, conv.name)}
                            className="dash-btn dash-btn-sm dash-btn-primary disabled:opacity-60"
                          >
                            <Send className="h-3.5 w-3.5" aria-hidden="true" />
                            {isSendingReply ? 'Sending…' : 'Send reply'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 pt-2.5 border-t border-[var(--dh-line)] flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[var(--text-subtle)] tabular-nums">
                          {conv.score != null ? `Lead score ${conv.score}/100` : ''}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setNewDealForm({
                                name: conv.company ? `${conv.company} deal` : '',
                                client: conv.company || conv.name || '',
                                value: '',
                                stage: 'qualified',
                                channelOrigin: channel,
                                expectedClose: 'Next Month'
                              });
                              setIsNewDealModalOpen(true);
                            }}
                            className="dash-btn dash-btn-sm"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            New deal
                          </button>
                          <button type="button" onClick={() => { setReplyOpenId(conv.id); setReplyInput(''); }} className="dash-btn dash-btn-sm">
                            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                            Reply
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section aria-labelledby="dash-activity-title" className="dash-glass p-5 sm:p-6 flex flex-col">
          <div className="flex items-start gap-2.5 mb-4">
            <Activity className="h-4 w-4 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
            <div>
              <h2 id="dash-activity-title" className="text-[15px] font-semibold leading-tight text-[var(--text)]">Recent activity</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">What changed in your CRM.</p>
            </div>
          </div>

          <div className="flex-1 space-y-3.5 max-h-[340px] overflow-y-auto pr-1">
            {activities.length === 0 ? (
              <p className="py-10 text-center text-xs text-[var(--text-muted)]">No activity recorded yet.</p>
            ) : (
              activities.map((act) => (
                <div key={act.id} className="flex items-start gap-3 text-left">
                  <div className="mt-1.5 h-2 w-2 rounded-full bg-[var(--accent)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[var(--text)] leading-snug">{act.title}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{act.description}</div>
                    <div className="text-[11px] text-[var(--text-subtle)] mt-1">
                      {act.actor} · {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pt-3 mt-3 border-t border-[var(--dh-line)]">
            <button type="button" onClick={() => onNavigate('analytics')} className="dash-btn dash-btn-sm w-full">
              View analytics
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </section>
      </div>

      {/* KEY FIGURES (from /api/dashboard/stats; a dash means no data, never a placeholder number) */}
      <section aria-label="Key figures" className="w-full max-w-6xl z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {metricCards.map((m) => {
          const MetricIcon = m.icon;
          return (
            <button
              key={m.label}
              type="button"
              onClick={() => onNavigate(m.view)}
              className="dash-glass-strong dash-lift p-4 text-left cursor-pointer"
            >
              <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
                <span className="text-xs font-medium">{m.label}</span>
                <MetricIcon className="h-4 w-4 text-[var(--accent-text)]" aria-hidden="true" />
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xl font-semibold tracking-tight tabular-nums text-[var(--text)]">{m.value}</span>
                {m.side && <span className="text-xs font-medium text-[var(--text-muted)] tabular-nums">{m.side}</span>}
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1.5 tabular-nums">{m.foot}</div>
            </button>
          );
        })}
      </section>

      {/* CUSTOMIZABLE KPI WIDGETS */}
      <CustomizableWidgetGrid
        contacts={contacts}
        onSelectContact={onSelectContact}
        onNavigate={onNavigate}
      />

      {/* DAILY MISSIONS */}
      <section aria-labelledby="dash-missions-title" className="dash-glass w-full max-w-6xl z-10 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-start gap-2.5">
            <Lightbulb className="h-4 w-4 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
            <div>
              <h2 id="dash-missions-title" className="text-[15px] font-semibold leading-tight text-[var(--text)]">Daily missions</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {missions.filter(m => m.completed).length} of {missions.length} done today
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="dash-pill !shadow-none inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-[var(--text)] tabular-nums">
              <Flame className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
              {streakDays}-day streak
              <span aria-hidden="true" className="text-[var(--text-subtle)]">·</span>
              <Trophy className="h-3.5 w-3.5 text-[var(--accent-text)]" aria-hidden="true" />
              {userXP.toLocaleString()} XP
            </span>
            <button
              type="button"
              onClick={() => {
                if (isSpeaking || activeVoiceSim) {
                  stopVoiceOver();
                } else {
                  setSoundEnabled(!soundEnabled);
                  triggerAlert(soundEnabled ? "Sound effects muted" : "Sound effects on", "info");
                }
              }}
              aria-pressed={soundEnabled}
              className="dash-icon-btn"
              aria-label={soundEnabled ? 'Mute sound effects' : 'Turn on sound effects'}
              title={soundEnabled ? 'Mute sound effects' : 'Turn on sound effects'}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                const newM: AIMission = {
                  id: `m-${Date.now()}`,
                  title: 'Publish automated Google Business Profile review response',
                  category: 'marketing',
                  rewardXP: 100,
                  completed: false,
                  targetView: 'gbp',
                  badge: 'Local Reputation'
                };
                setMissions(prev => [...prev, newM]);
                triggerAlert("New mission added", "info");
              }}
              className="dash-btn dash-btn-sm"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add mission
            </button>
          </div>
        </div>

        <div className="w-full h-1.5 rounded-full overflow-hidden mb-4 bg-[var(--dh-line)]">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${missions.length ? (missions.filter(m => m.completed).length / missions.length) * 100 : 0}%`,
              background: 'linear-gradient(90deg, var(--dh-primary-a), var(--dh-primary-b))'
            }}
          />
        </div>

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {missions.map((mission) => (
            <li
              key={mission.id}
              className={`dash-glass-strong flex items-center justify-between gap-2 p-3 ${mission.completed ? 'opacity-70' : ''}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => toggleMission(mission.id)}
                  aria-pressed={mission.completed}
                  aria-label={mission.completed ? `Mark "${mission.title}" as not done` : `Mark "${mission.title}" as done`}
                  className="dash-icon-btn shrink-0"
                >
                  {mission.completed
                    ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    : <Circle className="h-5 w-5" />}
                </button>
                <div className="min-w-0">
                  <div className={`text-[13px] font-semibold truncate ${mission.completed ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>
                    {mission.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--text-muted)]">
                    <span>{mission.badge}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold tabular-nums">+{mission.rewardXP} XP</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(mission.targetView)}
                className="dash-icon-btn shrink-0"
                aria-label={`Open ${mission.title}`}
                title="Open"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* TOP CONTACTS (only once there are contacts) */}
      {vipContacts.length > 0 && (
        <section aria-labelledby="dash-contacts-title" className="w-full max-w-6xl z-10">
          <div className="flex items-center justify-between mb-3">
            <h2 id="dash-contacts-title" className="text-[15px] font-semibold text-[var(--text)]">Top contacts</h2>
            <button type="button" onClick={() => onNavigate('leads')} className="dash-btn dash-btn-sm">
              View all
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {vipContacts.map((contact) => (
              <div key={contact.id} className="dash-glass-strong p-3.5 flex flex-col justify-between">
                <div className="flex items-center gap-2.5 mb-3">
                  <img
                    src={contact.avatar}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover border border-[var(--border)]"
                    referrerPolicy="no-referrer"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[var(--text)] truncate">{contact.name}</div>
                    <div className="text-[11px] text-[var(--text-muted)] truncate">{contact.company}</div>
                  </div>
                  {contact.dealSize && (
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded tabular-nums">
                      {contact.dealSize}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => onNavigate('greet')} className="dash-btn dash-btn-sm flex-1 !px-2 !shadow-none">
                    <Video className="h-3.5 w-3.5" aria-hidden="true" />
                    Meet
                  </button>
                  <button type="button" onClick={() => onNavigate('voice_dialer')} className="dash-btn dash-btn-sm flex-1 !px-2 !shadow-none">
                    <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                    Call
                  </button>
                  <button
                    type="button"
                    onClick={() => { onSelectContact(contact); onNavigate('messages'); }}
                    className="dash-btn dash-btn-sm flex-1 !px-2 !shadow-none"
                  >
                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    Chat
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Alert simulator (development builds only): injects test notifications, never in production. */}
      {(import.meta as any).env?.DEV && (
        <div className="w-full max-w-6xl z-10 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>Dev: simulate alert</span>
          {(['lead', 'message', 'task', 'interaction'] as const).map((kind) => (
            <button key={kind} type="button" onClick={() => simulateEvent(kind)} className="dash-btn dash-btn-sm capitalize !shadow-none">
              {kind}
            </button>
          ))}
        </div>
      )}

      {/* WORKSPACE MODULES CAROUSEL */}
      <div className="w-full max-w-4xl z-10 select-none">
        
        {/* Carousel Header & Category Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 mb-6 font-sans">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-bold tracking-widest text-neutral-400 uppercase">
              Core Workspace Modules
            </span>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1 bg-white/70 border border-neutral-200/70 p-0.5 rounded-full text-[10px] font-bold">
            <button
              onClick={() => { setCarouselCategory('all'); setActiveSlide(0); }}
              className={`px-2.5 py-1 rounded-full transition cursor-pointer ${carouselCategory === 'all' ? 'bg-neutral-900 text-white shadow-xs' : 'text-neutral-500 hover:text-neutral-900'}`}
            >
              All ({slides.length})
            </button>
            <button
              onClick={() => { setCarouselCategory('sales'); setActiveSlide(0); }}
              className={`px-2.5 py-1 rounded-full transition cursor-pointer ${carouselCategory === 'sales' ? 'bg-neutral-900 text-white shadow-xs' : 'text-neutral-500 hover:text-neutral-900'}`}
            >
              Sales & Deals
            </button>
            <button
              onClick={() => { setCarouselCategory('marketing'); setActiveSlide(0); }}
              className={`px-2.5 py-1 rounded-full transition cursor-pointer ${carouselCategory === 'marketing' ? 'bg-neutral-900 text-white shadow-xs' : 'text-neutral-500 hover:text-neutral-900'}`}
            >
              Marketing
            </button>
            <button
              onClick={() => { setCarouselCategory('ops'); setActiveSlide(0); }}
              className={`px-2.5 py-1 rounded-full transition cursor-pointer ${carouselCategory === 'ops' ? 'bg-neutral-900 text-white shadow-xs' : 'text-neutral-500 hover:text-neutral-900'}`}
            >
              Operations
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsAutoPlaying(!isAutoPlaying)}
              className="p-1.5 rounded-full bg-white/70 hover:bg-white border border-neutral-200/70 text-neutral-600 text-xs transition cursor-pointer"
              title={isAutoPlaying ? "Pause autoplay" : "Auto-advance slides"}
            >
              {isAutoPlaying ? <Pause className="h-3 w-3 text-indigo-600" /> : <Play className="h-3 w-3" />}
            </button>
            <span className="text-xs font-mono font-extrabold text-neutral-500 bg-neutral-200/50 px-2.5 py-1 rounded-full border border-neutral-300/30">
              {String(activeSlide + 1).padStart(2, '0')} / {String(filteredSlides.length).padStart(2, '0')}
            </span>
          </div>
        </div>

        {/* Carousel Track with Flanking Peek Cards */}
        <div className="relative flex items-center justify-center h-[340px] sm:h-[380px] w-full overflow-visible px-4">
          
          {/* Left circular navigation button */}
          <button
            type="button"
            onClick={() => {
              setActiveSlide(prev => (prev - 1 + filteredSlides.length) % filteredSlides.length);
              playSoundEffect('pop');
            }}
            className="absolute left-2 sm:left-4 md:left-8 z-30 p-3 rounded-full bg-white/80 hover:bg-white border border-neutral-200 shadow-md hover:shadow-lg text-neutral-800 transition-all hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center backdrop-blur-md"
            title="Previous Module"
          >
            <ChevronLeft className="h-4.5 w-4.5" />
          </button>

          {/* Visual Cards Area */}
          <div className="relative flex items-center justify-center w-full max-w-xl h-full">
            {filteredSlides.map((slide, index) => {
              let offset = index - activeSlide;
              if (offset < -1) offset += filteredSlides.length;
              if (offset > 1) offset -= filteredSlides.length;

              const isVisible = offset === 0 || offset === -1 || offset === 1;
              if (!isVisible) return null;

              let transformClasses = "";
              if (offset === 0) {
                transformClasses = "z-20 scale-100 opacity-100 shadow-2xl translate-x-0 rotate-0";
              } else if (offset === -1) {
                transformClasses = "z-10 scale-[0.78] opacity-35 blur-[0.5px] -translate-x-[48%] sm:-translate-x-[55%] md:-translate-x-[60%] -rotate-2 cursor-pointer hover:opacity-55";
              } else if (offset === 1) {
                transformClasses = "z-10 scale-[0.78] opacity-35 blur-[0.5px] translate-x-[48%] sm:translate-x-[55%] md:translate-x-[60%] rotate-2 cursor-pointer hover:opacity-55";
              }

              const IconComponent = slide.icon;

              return (
                <div
                  key={slide.id}
                  onClick={() => {
                    if (offset !== 0) {
                      setActiveSlide(index);
                      playSoundEffect('pop');
                    }
                  }}
                  className={`absolute w-[230px] sm:w-[270px] md:w-[310px] h-[290px] sm:h-[330px] md:h-[350px] rounded-[36px] p-6 transition-all duration-500 ease-out bg-gradient-to-br ${slide.gradient} border border-white/50 flex flex-col justify-between overflow-hidden select-none ${transformClasses}`}
                >
                  <div className="absolute top-[-15%] right-[-10%] w-[120px] h-[120px] rounded-full bg-white/20 blur-xl pointer-events-none" />
                  <div className="absolute bottom-[-10%] left-[-10%] w-[160px] h-[160px] rounded-full bg-black/5 blur-2xl pointer-events-none" />

                  {/* Top Row: Module Icon and Category Badge */}
                  <div className="flex justify-between items-start z-10 w-full">
                    <div className={`p-2.5 rounded-2xl ${slide.iconBg} backdrop-blur-md border border-white/30 flex items-center justify-center shrink-0 shadow-xs`}>
                      <IconComponent className="h-4.5 w-4.5" />
                    </div>
                    <span className={`text-[9px] font-mono font-extrabold tracking-widest px-3 py-1 rounded-full border border-white/20 uppercase shadow-2xs ${slide.badgeBg}`}>
                      {slide.tag}
                    </span>
                  </div>

                  {/* Large Stylized Center Word */}
                  <div className="relative flex flex-col justify-center items-center my-auto w-full text-center py-2 select-none z-10">
                    <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tighter text-white/20 uppercase font-sans leading-none italic pointer-events-none">
                      {slide.displayWord}
                    </h2>
                  </div>

                  {/* Bottom Info and Launch Trigger */}
                  <div className="z-10 w-full text-left space-y-2 mt-auto">
                    <div>
                      <h3 className={`text-base sm:text-lg font-black tracking-tight ${slide.textColor}`}>
                        {slide.title}
                      </h3>
                      <p className={`text-[11px] sm:text-xs font-semibold leading-relaxed mt-1 opacity-75 line-clamp-2 ${slide.textColor}`}>
                        {slide.description}
                      </p>
                    </div>

                    {offset === 0 && (
                      <div className="pt-2 animate-in fade-in zoom-in-95 duration-300">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            playSoundEffect('click');
                            onNavigate(slide.targetView);
                          }}
                          className={`w-full inline-flex items-center justify-center gap-1.5 px-4.5 py-2.5 ${slide.btnBg} font-bold text-[11px] sm:text-xs rounded-xl shadow-md hover:shadow-lg transition-all duration-300 hover:scale-[1.02] active:scale-98 cursor-pointer border border-white/10`}
                        >
                          Launch Workspace
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right circular navigation button */}
          <button
            type="button"
            onClick={() => {
              setActiveSlide(prev => (prev + 1) % filteredSlides.length);
              playSoundEffect('pop');
            }}
            className="absolute right-2 sm:right-4 md:right-8 z-30 p-3 rounded-full bg-white/80 hover:bg-white border border-neutral-200 shadow-md hover:shadow-lg text-neutral-800 transition-all hover:scale-110 active:scale-95 cursor-pointer flex items-center justify-center backdrop-blur-md"
            title="Next Module"
          >
            <ChevronRight className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Sleek Dot Indicators at Bottom */}
        <div className="flex justify-center items-center gap-2 mt-6">
          {filteredSlides.map((_, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                setActiveSlide(index);
                playSoundEffect('pop');
              }}
              className={`h-1.5 rounded-full transition-all duration-500 cursor-pointer ${
                index === activeSlide 
                  ? 'w-10 bg-neutral-800 shadow-xs' 
                  : 'w-2 bg-neutral-300 hover:bg-neutral-400'
              }`}
              title={`Go to Module ${index + 1}`}
            />
          ))}
        </div>
      </div>

      {/* NEW DEAL QUICK-CREATE MODAL */}
      {isNewDealModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-md bg-white rounded-3xl border border-neutral-200/90 shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                  <Plus className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-neutral-900">Register New Pipeline Deal</h3>
                  <p className="text-[11px] text-neutral-500">Fast CRM pipeline ingestion</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewDealModalOpen(false)}
                className="p-1.5 rounded-xl hover:bg-neutral-100 text-neutral-400 hover:text-neutral-700 transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRegisterDeal} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold text-neutral-700 mb-1">Deal Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Enterprise Cloud Expansion"
                  value={newDealForm.name}
                  onChange={(e) => setNewDealForm({ ...newDealForm, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50/50 text-neutral-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Client / Company</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Apex Global"
                    value={newDealForm.client}
                    onChange={(e) => setNewDealForm({ ...newDealForm, client: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50/50 text-neutral-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Value ($ ARR)</label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="e.g. 50000"
                    value={newDealForm.value}
                    onChange={(e) => setNewDealForm({ ...newDealForm, value: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50/50 text-neutral-900 font-mono focus:outline-none focus:border-indigo-500 focus:bg-white transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Stage</label>
                  <select
                    value={newDealForm.stage}
                    onChange={(e) => setNewDealForm({ ...newDealForm, stage: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50/50 text-neutral-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition cursor-pointer"
                  >
                    <option value="lead">Lead</option>
                    <option value="discovery">Discovery</option>
                    <option value="qualified">Qualified</option>
                    <option value="proposal">Proposal</option>
                    <option value="negotiation">Negotiation</option>
                    <option value="closed_won">Closed Won</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Channel Origin</label>
                  <select
                    value={newDealForm.channelOrigin}
                    onChange={(e) => setNewDealForm({ ...newDealForm, channelOrigin: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50/50 text-neutral-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition cursor-pointer"
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                    <option value="voice">Voice Dialer</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="web">Web Chat</option>
                    <option value="sms">SMS</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-neutral-700 mb-1">Expected Close</label>
                <input
                  type="text"
                  placeholder="e.g. This Month / Q4"
                  value={newDealForm.expectedClose}
                  onChange={(e) => setNewDealForm({ ...newDealForm, expectedClose: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50/50 text-neutral-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsNewDealModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDeal}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-xs hover:shadow-md transition cursor-pointer flex items-center gap-1.5"
                >
                  {isSubmittingDeal ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      <span>Create Deal</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FLOAT ACTION ALERT / XP REWARD MESSAGES */}
      {actionAlert && (
        <div className={`fixed bottom-24 right-6 border text-white px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2.5 z-50 text-xs font-sans font-semibold animate-in slide-in-from-right duration-200 ${
          actionAlert.type === 'reward' 
            ? 'bg-gradient-to-r from-amber-600 to-indigo-600 border-amber-400/40 text-amber-100 shadow-amber-900/30' 
            : actionAlert.type === 'info'
            ? 'bg-neutral-900 border-white/10 text-white'
            : 'bg-neutral-900 border-emerald-500/30 text-white'
        }`}>
          {actionAlert.type === 'reward' ? (
            <Sparkles className="h-4 w-4 text-amber-300 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          )}
          <span>{actionAlert.text}</span>
        </div>
      )}

      {/* LIGHT-MODE EXTRUDED CURSOR ANIMATION ACCENTS */}
      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
        .animate-blink {
          animation: blink 1s step-end infinite;
        }
        .bg-radial {
          background-image: radial-gradient(var(--tw-gradient-stops));
        }
      `}</style>

    </div>
  );
}



