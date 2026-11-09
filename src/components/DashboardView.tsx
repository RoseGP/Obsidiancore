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
import Markdown from 'react-markdown';
import UnifiedAssistant from './assistant/UnifiedAssistant';
import CustomizableWidgetGrid from './dashboard/CustomizableWidgetGrid';
import { useNotifications } from '../context/NotificationContext';

interface DashboardViewProps {
  contacts: CRMContact[];
  onSelectContact: (contact: CRMContact) => void;
  onNavigate: (view: any) => void;
}

export default function DashboardView({ contacts, onSelectContact, onNavigate }: DashboardViewProps) {
  const now = new Date();
  const dayGreeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const todayLabel = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const { simulateEvent } = useNotifications();
  const [actionAlert, setActionAlert] = useState<{ text: string; type: 'success' | 'info' | 'reward' | 'error' } | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [carouselCategory, setCarouselCategory] = useState<'all' | 'sales' | 'marketing' | 'ops'>('all');
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Real Backend Dashboard Stats
  const [dashboardStats, setDashboardStats] = useState<{
    totalContacts: number;
    newLeadsToday: number;
    openDealsCount: number;
    totalPipelineValue: number;
    weightedForecastValue: number;
    activeTicketsCount: number;
    criticalTicketsCount: number;
    slaMetRate: number | null;
    avgResponseMinutes: number | null;
    meetingsToday: number | null;
    callsToday: number | null;
    channelBreakdown?: Record<string, { count: number; pct: number }>;
  } | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(true);

  // New Deal Quick-Creator Modal State
  const [isNewDealModalOpen, setIsNewDealModalOpen] = useState(false);
  const [newDealForm, setNewDealForm] = useState({
    name: '',
    client: '',
    value: '',
    stage: 'discovery' as 'lead' | 'discovery' | 'qualified' | 'proposal' | 'negotiation' | 'won',
    channelOrigin: 'whatsapp',
    expectedClose: ''
  });
  const [isSubmittingDeal, setIsSubmittingDeal] = useState(false);

  // Live Omnichannel Feed & Activities
  const [activities, setActivities] = useState<Array<any>>([]);
  const [liveConversations, setLiveConversations] = useState<Array<any>>([]);

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
        triggerAlert(`Deal saved: $${parseFloat(newDealForm.value).toLocaleString()} for ${newDealForm.client}.`, 'success');
        setIsNewDealModalOpen(false);
        setNewDealForm({
          name: '',
          client: '',
          value: '',
          stage: 'discovery',
          channelOrigin: 'whatsapp',
          expectedClose: ''
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

  const slides = [
    {
      id: 'video',
      title: 'Video Meetings',
      displayWord: 'connect',
      tag: 'COLLABORATION',
      category: 'sales',
      description: 'Group video meetings, waiting room and host controls',
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
      description: 'AI receptionist, call transcripts and a softphone',
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
      description: 'AI writing assistant with prompt templates',
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
      description: 'One inbox for chat and email, with AI drafts',
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
      title: 'Proposals',
      displayWord: 'vetted',
      tag: 'PROPOSALS',
      category: 'sales',
      description: 'Build proposals, send a secure link and collect a typed signature',
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
      description: 'Schedule posts to LinkedIn, Meta and X',
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
      title: 'Calendar',
      displayWord: 'calendar',
      tag: 'SCHEDULING',
      category: 'ops',
      description: 'Your schedule and client booking links',
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
      tag: 'REVIEWS',
      category: 'marketing',
      description: 'Read and reply to Google reviews and see location insights',
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
      tag: 'REPORTS',
      category: 'ops',
      description: 'Pipeline and conversion reports from your CRM data',
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

  const triggerAlert = (text: string, type: 'success' | 'info' | 'reward' | 'error' = 'success') => {
    setActionAlert({ text, type });
    if (type === 'reward') playSoundEffect('success');
    setTimeout(() => setActionAlert(null), 4000);
  };

  // Newest leads first (the API returns them unordered).
  const recentLeads = [...liveConversations]
    .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 10);

  // Top VIP Contacts for Fast Action
  const vipContacts = contacts.slice(0, 4);

  return (
    <div className="relative min-h-full w-full flex flex-col items-center justify-start p-4 sm:p-6 md:p-8 font-sans overflow-x-hidden bg-[var(--app-bg)] text-[var(--text)] transition-colors gap-8 sm:gap-10">
      

      {/* TOP BAR / LIVE SYSTEM TELEMETRY & PRODUCTIVITY HUD */}
      <div className="w-full max-w-6xl flex flex-wrap justify-between items-center gap-3 z-10 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-medium bg-white/70 text-neutral-600 border border-neutral-200/80 px-2.5 py-1 rounded-full shadow-xs flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Workspace
          </span>

          {/* Sound effects toggle */}
          <button
            type="button"
            onClick={() => {
              setSoundEnabled(!soundEnabled);
              triggerAlert(soundEnabled ? "Sound effects off" : "Sound effects on", "info");
            }}
            className="p-1.5 rounded-full border text-xs transition shadow-xs cursor-pointer bg-white/70 hover:bg-white border-neutral-200/70 text-neutral-500 hover:text-neutral-700"
            title={soundEnabled ? "Mute sound effects" : "Enable sound effects"}
          >
            {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>

          {/* Alert simulator (development builds only): injects test notifications, never in production. */}
          {(import.meta as any).env?.DEV && (
          <div className="hidden lg:flex items-center gap-1.5 bg-[#0B0C12]/90 border border-white/10 px-2.5 py-1 rounded-full text-xs text-neutral-300 shadow-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="text-[10px] text-neutral-400 font-medium">Live Alerts:</span>
            <button 
              type="button"
              onClick={() => simulateEvent('lead')}
              className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-emerald-500/20 text-emerald-400 font-mono text-[10px] transition cursor-pointer"
              title="Trigger instant incoming lead toast"
            >
              + Lead
            </button>
            <button 
              type="button"
              onClick={() => simulateEvent('message')}
              className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-indigo-500/20 text-indigo-400 font-mono text-[10px] transition cursor-pointer"
              title="Trigger instant new message toast"
            >
              + Message
            </button>
            <button 
              type="button"
              onClick={() => simulateEvent('task')}
              className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-amber-500/20 text-amber-400 font-mono text-[10px] transition cursor-pointer"
              title="Trigger instant assigned task toast"
            >
              + Task
            </button>
            <button 
              type="button"
              onClick={() => simulateEvent('interaction')}
              className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-cyan-500/20 text-cyan-400 font-mono text-[10px] transition cursor-pointer"
              title="Trigger customer interaction alert"
            >
              + Interaction
            </button>
          </div>
          )}
        </div>
        
      </div>

      {/* CENTRAL HERO STATEMENT & INTERACTIVE STARBURST */}
      <div className="w-full max-w-5xl flex flex-col items-center justify-center py-2 sm:py-4 z-10 text-center">
        
        {/* Greeting: quiet and factual. */}
        <div className="flex flex-col items-center gap-1 mb-1">
          <h1 className="text-[26px] sm:text-[30px] leading-tight font-semibold tracking-[-0.02em] text-[var(--text)]">{dayGreeting}</h1>
          <p className="text-[13px] text-[var(--text-muted)]">
            {todayLabel}. {contacts.length ? `${contacts.length.toLocaleString()} contact${contacts.length === 1 ? '' : 's'} in your CRM.` : 'Add or import contacts to get started.'}
          </p>
        </div>

        {/* One AI assistant (merged from DashboardChatbot and the inline co-pilot bar) */}
        <UnifiedAssistant contacts={contacts} onNavigate={onNavigate} />

      </div>

      {/* SECTION: POWER LAUNCHPAD SHORTCUTS (WITH QUICK DEAL REGISTRATION) */}
      <div className="w-full max-w-5xl z-10">
        <div className="flex items-center justify-between px-2 mb-3">
          <h2 className="text-[13px] font-semibold text-[var(--text)]">Quick actions</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('leads')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-xs hover:shadow-md transition cursor-pointer"
            >
              <Users className="h-3.5 w-3.5" />
              <span>Leads Pipeline</span>
            </button>
            <button
              type="button"
              onClick={() => setIsNewDealModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-xs hover:shadow-md transition cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Deal</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          
          {/* 1. New Deal Modal Trigger */}
          <button
            type="button"
            onClick={() => setIsNewDealModalOpen(true)}
            className="flex flex-col items-start p-3.5 rounded-2xl bg-white/80 hover:bg-white border border-emerald-200/60 hover:border-emerald-300 shadow-xs hover:shadow-md transition-all hover:scale-[1.02] text-left group cursor-pointer"
          >
            <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 mb-2 group-hover:scale-110 transition">
              <Plus className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-neutral-800 group-hover:text-emerald-700 transition">
              Register Deal
            </span>
            <span className="text-[10px] text-neutral-400 mt-0.5">
              Pipeline Entry
            </span>
          </button>

          {/* 2. Meet & Greet */}
          <button
            type="button"
            onClick={() => onNavigate('greet')}
            className="flex flex-col items-start p-3.5 rounded-2xl bg-white/80 hover:bg-white border border-purple-200/60 hover:border-purple-300 shadow-xs hover:shadow-md transition-all hover:scale-[1.02] text-left group cursor-pointer"
          >
            <div className="p-2 rounded-xl bg-purple-100 text-purple-700 mb-2 group-hover:scale-110 transition">
              <Video className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-neutral-800 group-hover:text-purple-700 transition">
              Video Dashboard
            </span>
            <span className="text-[10px] text-neutral-400 mt-0.5">
              Video meetings
            </span>
          </button>

          {/* 3. Voice Dialer */}
          <button
            type="button"
            onClick={() => onNavigate('voice_dialer')}
            className="flex flex-col items-start p-3.5 rounded-2xl bg-white/80 hover:bg-white border border-indigo-200/60 hover:border-indigo-300 shadow-xs hover:shadow-md transition-all hover:scale-[1.02] text-left group cursor-pointer"
          >
            <div className="p-2 rounded-xl bg-indigo-100 text-indigo-700 mb-2 group-hover:scale-110 transition">
              <Phone className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-neutral-800 group-hover:text-indigo-700 transition">
              Voice Dialer
            </span>
            <span className="text-[10px] text-neutral-400 mt-0.5">
              AI Receptionist
            </span>
          </button>

          {/* 4. AI Email Outreach */}
          <button
            type="button"
            onClick={() => onNavigate('messages')}
            className="flex flex-col items-start p-3.5 rounded-2xl bg-white/80 hover:bg-white border border-sky-200/60 hover:border-sky-300 shadow-xs hover:shadow-md transition-all hover:scale-[1.02] text-left group cursor-pointer"
          >
            <div className="p-2 rounded-xl bg-sky-100 text-sky-700 mb-2 group-hover:scale-110 transition">
              <Mail className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-neutral-800 group-hover:text-sky-700 transition">
              Email Outreach
            </span>
            <span className="text-[10px] text-neutral-400 mt-0.5">
              Inbox
            </span>
          </button>

          {/* 5. Calendar Scheduling */}
          <button
            type="button"
            onClick={() => onNavigate('calendar')}
            className="flex flex-col items-start p-3.5 rounded-2xl bg-white/80 hover:bg-white border border-teal-200/60 hover:border-teal-300 shadow-xs hover:shadow-md transition-all hover:scale-[1.02] text-left group cursor-pointer"
          >
            <div className="p-2 rounded-xl bg-teal-100 text-teal-700 mb-2 group-hover:scale-110 transition">
              <Calendar className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-neutral-800 group-hover:text-teal-700 transition">
              Book Meeting
            </span>
            <span className="text-[10px] text-neutral-400 mt-0.5">
              Calendar
            </span>
          </button>

          {/* 6. Enterprise Proposals */}
          <button
            type="button"
            onClick={() => onNavigate('proposals')}
            className="flex flex-col items-start p-3.5 rounded-2xl bg-white/80 hover:bg-white border border-cyan-200/60 hover:border-cyan-300 shadow-xs hover:shadow-md transition-all hover:scale-[1.02] text-left group cursor-pointer"
          >
            <div className="p-2 rounded-xl bg-cyan-100 text-cyan-700 mb-2 group-hover:scale-110 transition">
              <FileText className="h-4 w-4" />
            </div>
            <span className="text-xs font-bold text-neutral-800 group-hover:text-cyan-700 transition">
              New Proposal
            </span>
            <span className="text-[10px] text-neutral-400 mt-0.5">
              Send for signature
            </span>
          </button>

        </div>
      </div>

      {/* SECTION: LIVE METRICS & REAL-TIME OPERATIONAL PULSE (CONNECTED TO BACKEND) */}
      <div className="w-full max-w-5xl z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        
        {/* Metric 1: Pipeline Value */}
        <div 
          onClick={() => onNavigate('deals')}
          className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xs hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-2">
            <span className="text-xs font-medium">Pipeline Value</span>
            <TrendingUp className="h-4 w-4 text-emerald-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 font-mono tracking-tight tabular-nums">
              ${(dashboardStats?.totalPipelineValue ?? 0).toLocaleString()}
            </span>
            <span className="text-xs font-mono font-medium text-emerald-600 dark:text-emerald-400">
              {dashboardStats?.openDealsCount ?? 0} deals
            </span>
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1.5 flex items-center gap-1.5">
            <span>Weighted</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-neutral-700 dark:text-neutral-300">
              ${(dashboardStats?.weightedForecastValue ?? 0).toLocaleString()}
            </span>
          </div>
        </div>

        {/* Metric 2: AI Receptionist Status */}
        <div 
          onClick={() => onNavigate('voice_dialer')}
          className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xs hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-2">
            <span className="text-xs font-medium">AI Receptionist</span>
            <Activity className="h-4 w-4 text-indigo-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 font-mono tracking-tight tabular-nums">
              {dashboardStats?.callsToday ?? '—'}
            </span>
            <span className="text-xs font-mono font-medium text-indigo-600 dark:text-indigo-400">
              Calls
            </span>
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1.5 flex items-center gap-1.5">
            <span>{dashboardStats?.callsToday == null ? 'Call tracking not connected yet' : 'Calls handled today'}</span>
          </div>
        </div>

        {/* Metric 3: Inbound Messages & Queue */}
        <div 
          onClick={() => onNavigate('messages')}
          className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xs hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-2">
            <span className="text-xs font-medium">Inbound Queue</span>
            <Mail className="h-4 w-4 text-sky-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 font-mono tracking-tight tabular-nums">
              {dashboardStats?.activeTicketsCount ?? 0}
            </span>
            <span className="text-xs font-mono font-medium text-amber-600 dark:text-amber-400">
              {dashboardStats?.criticalTicketsCount ?? 0} priority
            </span>
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1.5 flex items-center gap-1.5 font-mono">
            {dashboardStats?.avgResponseMinutes == null ? (
              <span>Response-time tracking not connected yet</span>
            ) : (
              <>
                <span>Avg {dashboardStats.avgResponseMinutes}m</span>
                <span aria-hidden="true">·</span>
                <span>{dashboardStats.slaMetRate}% SLA met</span>
              </>
            )}
          </div>
        </div>

        {/* Metric 4: Scheduled Video Meetings */}
        <div 
          onClick={() => onNavigate('calendar')}
          className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-xs hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 mb-2">
            <span className="text-xs font-medium">Meetings Today</span>
            <Clock className="h-4 w-4 text-purple-500 group-hover:scale-110 transition-transform" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 font-mono tracking-tight tabular-nums">
              {dashboardStats?.meetingsToday ?? '—'}
            </span>
            <span className="text-xs font-mono font-medium text-purple-600 dark:text-purple-400">
              Scheduled
            </span>
          </div>
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1.5 flex items-center gap-1.5">
            <span>{dashboardStats?.meetingsToday == null ? 'Meeting tracking not connected yet' : 'From your calendar'}</span>
          </div>
        </div>

      </div>

      {/* SECTION: CUSTOMIZABLE WIDGETS */}
      <CustomizableWidgetGrid 
        contacts={contacts} 
        onSelectContact={onSelectContact} 
        onNavigate={onNavigate} 
      />

      {/* SECTION: VIP RECENT CONTACTS QUICK-CONNECT ROW */}
      <div className="w-full max-w-5xl z-10">
        <div className="flex items-center justify-between px-2 mb-3">
          <span className="text-[11px] font-mono font-bold tracking-widest text-neutral-400 uppercase">
            Recent contacts
          </span>
          <button 
            onClick={() => onNavigate('messages')}
            className="text-[11px] font-bold text-blue-600 hover:text-blue-700 transition cursor-pointer flex items-center gap-1"
          >
            <span>View all</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {vipContacts.map((contact) => (
            <div
              key={contact.id}
              className="p-3.5 rounded-2xl bg-white/80 border border-neutral-200/80 shadow-2xs hover:shadow-md transition flex flex-col justify-between"
            >
              <div className="flex items-center gap-2.5 mb-2.5">
                {contact.avatar ? (
                  <img
                    src={contact.avatar}
                    alt={contact.name}
                    className="h-9 w-9 rounded-full object-cover border border-neutral-200 shadow-2xs"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="h-9 w-9 rounded-full border border-neutral-200 bg-neutral-100 text-[11px] font-bold text-neutral-600 flex items-center justify-center shrink-0">
                    {(contact.name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-neutral-900 truncate">{contact.name}</div>
                  <div className="text-[10px] text-neutral-400 truncate">{contact.company}</div>
                </div>
                {contact.pipelineValue && (
                  <span className="text-[10px] font-mono font-extrabold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                    {contact.pipelineValue}
                  </span>
                )}
              </div>

              {/* 1-Click Connect Actions */}
              <div className="flex items-center gap-1.5 pt-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => onNavigate('greet')}
                  className="flex-1 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
                  title="Video Consultation"
                >
                  <Video className="h-3 w-3" />
                  <span>Meet</span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('voice_dialer')}
                  className="flex-1 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
                  title="Call Contact"
                >
                  <Phone className="h-3 w-3" />
                  <span>Call</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelectContact(contact);
                    onNavigate('messages');
                  }}
                  className="flex-1 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[10px] font-bold flex items-center justify-center gap-1 transition cursor-pointer"
                  title="Message Contact"
                >
                  <Mail className="h-3 w-3" />
                  <span>Chat</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION: LIVE OMNICHANNEL INTERACTION STREAM & INSTANT QUICK REPLY */}
      <div className="w-full max-w-5xl z-10 grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Left 2 Cols: newest leads */}
        <div className="lg:col-span-2 rounded-3xl bg-white/80 backdrop-blur-md border border-neutral-200/80 p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-neutral-900">New leads</h3>
                  <p className="text-[11px] text-neutral-500">The 10 most recent leads from every channel</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchDashboardData}
                  className="p-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-600 text-xs transition cursor-pointer"
                  title="Refresh Stream"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isStatsLoading ? 'animate-spin text-indigo-600' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('messages')}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition"
                >
                  <span>Open Inbox</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Newest leads */}
            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {recentLeads.length === 0 ? (
                <div className="py-8 text-center text-xs text-neutral-500">
                  {isStatsLoading ? 'Loading…' : 'No leads yet. New leads from forms, chat and calls appear here.'}
                </div>
              ) : (
                recentLeads.map((conv: any) => {
                  const channel = String(conv.channel || conv.source || 'web').toLowerCase();
                  const name = String(conv.name || 'Unnamed lead');
                  const created = conv.createdAt ? new Date(conv.createdAt) : null;
                  const note = typeof conv.intent === 'string' && conv.intent.trim() ? conv.intent
                    : typeof conv.notes === 'string' && conv.notes.trim() ? conv.notes
                    : typeof conv.qualification?.need === 'string' ? conv.qualification.need : '';

                  return (
                    <div
                      key={conv.id}
                      className="p-3.5 rounded-2xl bg-white border border-neutral-200/90 hover:border-indigo-200 shadow-2xs transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-8 w-8 rounded-full border border-neutral-200 shrink-0 bg-neutral-100 text-[10px] font-bold text-neutral-600 flex items-center justify-center">
                            {name.split(/\s+/).slice(0, 2).map((w: string) => w[0]?.toUpperCase() || '').join('')}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-neutral-900 truncate">{name}</span>
                              {conv.company && <span className="text-[10px] text-neutral-500 truncate">({conv.company})</span>}
                            </div>
                            <div className="text-[10px] text-neutral-400 flex items-center gap-1.5 mt-0.5">
                              <span className="font-semibold text-indigo-600 uppercase font-mono">{channel}</span>
                              {created && !isNaN(created.getTime()) && (
                                <>
                                  <span>·</span>
                                  <span>{created.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {conv.value && (
                          <div className="text-right shrink-0">
                            <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                              {String(conv.value)}
                            </span>
                          </div>
                        )}
                      </div>

                      {note && (
                        <p className="text-xs text-neutral-700 mt-2 bg-neutral-50 p-2 rounded-xl border border-neutral-100 font-normal leading-relaxed line-clamp-2">
                          {note}
                        </p>
                      )}

                      <div className="mt-2.5 pt-2 border-t border-neutral-100 flex items-center justify-between text-xs">
                        <span className="text-[10px] font-mono text-neutral-400">
                          {typeof conv.score === 'number' ? `Score: ${conv.score}/100` : String(conv.status || 'new')}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setNewDealForm({
                                name: conv.company ? `${conv.company} deal` : `${name} deal`,
                                client: conv.company || name,
                                value: '',
                                stage: 'qualified',
                                channelOrigin: channel,
                                expectedClose: ''
                              });
                              setIsNewDealModalOpen(true);
                            }}
                            className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 transition cursor-pointer"
                          >
                            <Plus className="h-3 w-3" />
                            <span>New Deal</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigate('leads')}
                            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition cursor-pointer"
                          >
                            <ArrowRight className="h-3 w-3" />
                            <span>Open lead</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right 1 Col: CRM activity */}
        <div className="rounded-3xl bg-white/80 backdrop-blur-md border border-neutral-200/80 p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-neutral-900">Recent activity</h3>
                  <p className="text-[11px] text-neutral-500">Changes made in your CRM</p>
                </div>
              </div>
            </div>

            <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
              {activities.length === 0 ? (
                <div className="py-8 text-center text-xs text-neutral-400">
                  No recent activities recorded yet.
                </div>
              ) : (
                activities.map((act) => (
                  <div key={act.id} className="flex items-start gap-3 text-left">
                    <div className="mt-1 h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-neutral-900 leading-snug">
                        {act.title}
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-0.5 line-clamp-2">
                        {act.description}
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono mt-1">
                        {act.actor} · {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-500 font-mono">
            <span>{activities.length ? `Last ${activities.length} activities` : ''}</span>
            <button
              onClick={() => onNavigate('analytics')}
              className="text-indigo-600 hover:text-indigo-700 font-semibold cursor-pointer"
            >
              View Analytics →
            </button>
          </div>
        </div>

      </div>
      <div className="w-full max-w-4xl z-10 select-none">
        
        {/* Carousel Header & Category Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 mb-6 font-sans">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-bold tracking-widest text-neutral-400 uppercase">
              Modules
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
                  <h3 className="text-sm font-bold text-neutral-900">New deal</h3>
                  <p className="text-[11px] text-neutral-500">Adds it to your pipeline</p>
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
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Value ($)</label>
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
                    onChange={(e) => setNewDealForm({ ...newDealForm, stage: e.target.value as typeof newDealForm.stage })}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50/50 text-neutral-900 focus:outline-none focus:border-indigo-500 focus:bg-white transition cursor-pointer"
                  >
                    <option value="lead">Lead</option>
                    <option value="discovery">Discovery</option>
                    <option value="qualified">Qualified</option>
                    <option value="proposal">Proposal</option>
                    <option value="negotiation">Negotiation</option>
                    <option value="won">Won</option>
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

      {/* FLOAT ACTION ALERT */}
      {actionAlert && (
        <div className={`fixed bottom-24 right-6 border text-white px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2.5 z-50 text-xs font-sans font-semibold animate-in slide-in-from-right duration-200 ${
          actionAlert.type === 'reward' 
            ? 'bg-gradient-to-r from-amber-600 to-indigo-600 border-amber-400/40 text-amber-100 shadow-amber-900/30' 
            : actionAlert.type === 'error'
            ? 'bg-rose-900 border-rose-400/40 text-white'
            : actionAlert.type === 'info'
            ? 'bg-neutral-900 border-white/10 text-white'
            : 'bg-neutral-900 border-emerald-500/30 text-white'
        }`}>
          {actionAlert.type === 'reward' ? (
            <Sparkles className="h-4 w-4 text-amber-300 animate-spin" />
          ) : actionAlert.type === 'error' ? null : (
            <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          )}
          <span role={actionAlert.type === 'error' ? 'alert' : 'status'}>{actionAlert.text}</span>
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



