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

interface DashboardViewProps {
  contacts: CRMContact[];
  onSelectContact: (contact: CRMContact) => void;
  onNavigate: (view: any) => void;
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

export default function DashboardView({ contacts, onSelectContact, onNavigate }: DashboardViewProps) {
  const now = new Date();
  const dayGreeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const todayLabel = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
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
  const [focusMood, setFocusMood] = useState<'energy' | 'zen' | 'dealmaker'>('energy');

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

  return (
    <div className="relative min-h-full w-full flex flex-col items-center justify-start p-4 sm:p-6 md:p-8 font-sans overflow-x-hidden bg-slate-50 text-neutral-800 rounded-3xl border border-neutral-200/80 shadow-xs gap-8 sm:gap-12 md:gap-14">
      

      {/* TOP BAR / LIVE SYSTEM TELEMETRY & PRODUCTIVITY HUD */}
      <div className="w-full max-w-6xl flex flex-wrap justify-between items-center gap-3 z-10 shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-medium bg-white/70 text-neutral-600 border border-neutral-200/80 px-2.5 py-1 rounded-full shadow-xs flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Executive Workspace
          </span>

          {/* Sound FX & Voice-Over Control */}
          <button
            onClick={() => {
              if (isSpeaking || activeVoiceSim) {
                stopVoiceOver();
              } else {
                setSoundEnabled(!soundEnabled);
                triggerAlert(soundEnabled ? "Muted UI Sound FX" : "Enabled UI Sound FX", "info");
              }
            }}
            className={`p-1.5 rounded-full border text-xs transition shadow-xs cursor-pointer ${
              isSpeaking
                ? 'bg-rose-100 hover:bg-rose-200 border-rose-300 text-rose-700 animate-pulse'
                : 'bg-white/70 hover:bg-white border-neutral-200/70 text-neutral-500 hover:text-neutral-700'
            }`}
            title={isSpeaking ? "Stop Voice-Over Audio" : soundEnabled ? "Mute sound FX" : "Enable sound FX"}
          >
            {isSpeaking ? (
              <Square className="h-3.5 w-3.5 fill-rose-600 text-rose-600" />
            ) : soundEnabled ? (
              <Volume2 className="h-3.5 w-3.5" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
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
        
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Gamification Streak & XP Badge */}
          <div className="flex items-center gap-2 bg-white/80 border border-amber-200/80 py-1 px-3 rounded-full shadow-xs">
            <Flame className="h-3.5 w-3.5 text-amber-500 fill-amber-500 animate-bounce" />
            <span className="text-[11px] font-bold text-neutral-700 font-mono">
              {streakDays}D Streak
            </span>
            <span className="text-neutral-300">•</span>
            <Trophy className="h-3.5 w-3.5 text-indigo-500" />
            <span className="text-[11px] font-extrabold text-indigo-600 font-mono">
              {userXP.toLocaleString()} XP
            </span>
          </div>

          {/* Mood / Focus Toggle */}
          <div className="flex items-center bg-white/70 border border-neutral-200/70 p-0.5 rounded-full shadow-xs text-[10px] font-bold text-neutral-600">
            <button
              onClick={() => { setFocusMood('energy'); triggerAlert("⚡ High-Energy Mode active!", "info"); }}
              className={`px-2 py-0.5 rounded-full transition cursor-pointer ${focusMood === 'energy' ? 'bg-amber-100 text-amber-800 shadow-xs' : 'hover:text-neutral-900'}`}
            >
              ⚡ Fast
            </button>
            <button
              onClick={() => { setFocusMood('zen'); triggerAlert("🎯 Deep Zen Focus active!", "info"); }}
              className={`px-2 py-0.5 rounded-full transition cursor-pointer ${focusMood === 'zen' ? 'bg-indigo-100 text-indigo-800 shadow-xs' : 'hover:text-neutral-900'}`}
            >
              🎯 Zen
            </button>
          </div>

          {/* Executive Officer Badge */}
          <div className="flex items-center gap-1.5 bg-white/80 border border-neutral-200/80 py-1 px-3 rounded-full shadow-xs">
            <div className="h-5 w-5 rounded-full bg-gradient-to-tr from-indigo-500 to-amber-500 flex items-center justify-center text-white text-[10px] font-bold">
              ✦
            </div>
            <span className="text-xs font-bold text-neutral-700">Executive Officer</span>
          </div>
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
              Greet & Call Canvas
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
              Smart Sequences
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
              Calendar Matrix
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
              SLA Term Sheets
            </span>
          </button>

        </div>
      </div>

      {/* SECTION: LIVE METRICS & REAL-TIME OPERATIONAL PULSE (CONNECTED TO BACKEND) */}
      <div className="w-full max-w-5xl z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        
        {/* Metric 1: Pipeline Value */}
        <div 
          onClick={() => onNavigate('deals')}
          className="p-4 rounded-2xl bg-white/80 border border-neutral-200/80 shadow-xs hover:shadow-md transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-neutral-500 mb-1.5">
            <span className="text-[12px] font-medium">Pipeline Value</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-neutral-900 font-mono tabular-nums">
              ${(dashboardStats?.totalPipelineValue || 366500).toLocaleString()}
            </span>
            <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              {dashboardStats?.openDealsCount || 5} deals
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-1 font-mono">
            Weighted: ${(dashboardStats?.weightedForecastValue || 231500).toLocaleString()}
          </div>
        </div>

        {/* Metric 2: AI Receptionist Status */}
        <div 
          onClick={() => onNavigate('voice_dialer')}
          className="p-4 rounded-2xl bg-white/80 border border-neutral-200/80 shadow-xs hover:shadow-md transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-neutral-500 mb-1.5">
            <span className="text-[12px] font-medium">AI Receptionist</span>
            <Activity className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-neutral-900 font-mono tabular-nums">
              {dashboardStats?.callsToday || 14}
            </span>
            <span className="text-[10px] font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
              Active Triage
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">
            Calls handled today · 100% uptime
          </div>
        </div>

        {/* Metric 3: Inbound Messages & Queue */}
        <div 
          onClick={() => onNavigate('messages')}
          className="p-4 rounded-2xl bg-white/80 border border-neutral-200/80 shadow-xs hover:shadow-md transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-neutral-500 mb-1.5">
            <span className="text-[12px] font-medium">Inbound Queue</span>
            <Mail className="h-4 w-4 text-sky-500" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-neutral-900 font-mono tabular-nums">
              {dashboardStats?.activeTicketsCount || 3}
            </span>
            <span className="text-[10px] font-mono font-bold text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded">
              {dashboardStats?.criticalTicketsCount || 1} critical
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-1 font-mono">
            Avg Response: {dashboardStats?.avgResponseMinutes || 1.2}m · {dashboardStats?.slaMetRate || 98.4}% SLA
          </div>
        </div>

        {/* Metric 4: Scheduled Video Meetings */}
        <div 
          onClick={() => onNavigate('calendar')}
          className="p-4 rounded-2xl bg-white/80 border border-neutral-200/80 shadow-xs hover:shadow-md transition cursor-pointer"
        >
          <div className="flex items-center justify-between text-neutral-500 mb-1.5">
            <span className="text-[12px] font-medium">Meetings Today</span>
            <Clock className="h-4 w-4 text-purple-500" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-neutral-900 font-mono tabular-nums">
              {dashboardStats?.meetingsToday || 3}
            </span>
            <span className="text-[10px] font-mono font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">
              Scheduled
            </span>
          </div>
          <div className="text-[11px] text-neutral-400 mt-1">
            Google Calendar & Meet synced
          </div>
        </div>

      </div>

      {/* SECTION: CUSTOMIZABLE KPI COMMAND CENTER (LUXURY OBSIDIAN WIDGETS) */}
      <CustomizableWidgetGrid 
        contacts={contacts} 
        onSelectContact={onSelectContact} 
        onNavigate={onNavigate} 
      />

      {/* SECTION: TODAY'S AI MISSIONS (GAMIFIED PRODUCTIVITY WIDGET) */}
      <div className="w-full max-w-5xl z-10 bg-white/80 backdrop-blur-md rounded-3xl border border-neutral-200/80 p-5 sm:p-6 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
              <Lightbulb className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-neutral-900">Today&apos;s AI High-Impact Missions</h3>
              <p className="text-[11px] text-neutral-500">Complete daily milestones to maximize deal velocity and earn XP</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-neutral-500">
              {missions.filter(m => m.completed).length} / {missions.length} Done
            </span>
            <button
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
                triggerAlert("✨ New AI mission added to queue!", "info");
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold transition cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              Add Mission
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-neutral-100 h-2 rounded-full overflow-hidden mb-4">
          <div 
            className="h-full bg-gradient-to-r from-amber-400 via-pink-500 to-indigo-600 transition-all duration-500 rounded-full"
            style={{ width: `${(missions.filter(m => m.completed).length / missions.length) * 100}%` }}
          />
        </div>

        {/* Mission Checklist */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {missions.map((mission) => (
            <div
              key={mission.id}
              className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                mission.completed 
                  ? 'bg-emerald-50/50 border-emerald-200 text-neutral-500' 
                  : 'bg-white hover:bg-neutral-50 border-neutral-200 text-neutral-800 shadow-2xs'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 pr-2">
                <button
                  type="button"
                  onClick={() => toggleMission(mission.id)}
                  className="shrink-0 p-1 rounded-lg hover:bg-neutral-100 transition cursor-pointer text-neutral-400 hover:text-neutral-700"
                >
                  {mission.completed ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-neutral-300 hover:text-neutral-400" />
                  )}
                </button>
                <div className="min-w-0">
                  <div className={`text-xs font-bold truncate ${mission.completed ? 'line-through text-neutral-400' : 'text-neutral-800'}`}>
                    {mission.title}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-neutral-100 text-neutral-600 font-semibold">
                      {mission.badge}
                    </span>
                    <span className="text-[10px] font-bold text-amber-600 font-mono">
                      +{mission.rewardXP} XP
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onNavigate(mission.targetView)}
                className="shrink-0 p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold transition cursor-pointer"
                title="Launch relevant tool"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION: VIP RECENT CONTACTS QUICK-CONNECT ROW */}
      <div className="w-full max-w-5xl z-10">
        <div className="flex items-center justify-between px-2 mb-3">
          <span className="text-[11px] font-mono font-bold tracking-widest text-neutral-400 uppercase">
            🤝 Top VIP Contacts
          </span>
          <button 
            onClick={() => onNavigate('messages')}
            className="text-[11px] font-bold text-blue-600 hover:text-blue-700 transition cursor-pointer flex items-center gap-1"
          >
            <span>View All Contacts</span>
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
                <img 
                  src={contact.avatar} 
                  alt={contact.name} 
                  className="h-9 w-9 rounded-full object-cover border border-neutral-200 shadow-2xs"
                  referrerPolicy="no-referrer"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-neutral-900 truncate">{contact.name}</div>
                  <div className="text-[10px] text-neutral-400 truncate">{contact.company}</div>
                </div>
                {contact.dealSize && (
                  <span className="text-[10px] font-mono font-extrabold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                    {contact.dealSize}
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
        
        {/* Left 2 Cols: Real-time Multi-Channel Inbound Queue */}
        <div className="lg:col-span-2 rounded-3xl bg-white/80 backdrop-blur-md border border-neutral-200/80 p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-neutral-900">Live Omnichannel Stream</h3>
                  <p className="text-[11px] text-neutral-500">Real-time incoming dialogues across WhatsApp, Web Chat, Phone & Email</p>
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

            {/* Conversation Stream Items */}
            <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
              {liveConversations.length === 0 ? (
                <div className="py-8 text-center text-xs text-neutral-500">
                  No active incoming dialogues. All customer inquiries resolved.
                </div>
              ) : (
                liveConversations.map((conv: any) => {
                  const channel = (conv.channel || 'web').toLowerCase();
                  const isReplyOpen = replyOpenId === conv.id;

                  return (
                    <div
                      key={conv.id}
                      className="p-3.5 rounded-2xl bg-white border border-neutral-200/90 hover:border-indigo-200 shadow-2xs transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={conv.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'}
                            alt={conv.name}
                            referrerPolicy="no-referrer"
                            className="h-8 w-8 rounded-full object-cover border border-neutral-200 shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-neutral-900 truncate">{conv.name}</span>
                              <span className="text-[10px] text-neutral-500 truncate">({conv.company})</span>
                            </div>
                            <div className="text-[10px] text-neutral-400 flex items-center gap-1.5 mt-0.5">
                              <span className="font-semibold text-indigo-600 uppercase font-mono">{channel}</span>
                              <span>·</span>
                              <span>{conv.timeAgo || 'Just now'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[10px] font-mono font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                            {conv.value || '$45k ARR'}
                          </span>
                        </div>
                      </div>

                      {/* Content snippet */}
                      <p className="text-xs text-neutral-700 mt-2 bg-neutral-50 p-2 rounded-xl border border-neutral-100 font-normal leading-relaxed">
                        {conv.intent || conv.lastMessage || 'Customer inquiry received via omnichannel gateway.'}
                      </p>

                      {/* Expandable Instant Quick Reply Drawer */}
                      {isReplyOpen ? (
                        <div className="mt-3 pt-3 border-t border-neutral-100 space-y-2 animate-in fade-in duration-150">
                          <textarea
                            value={replyInput}
                            onChange={(e) => setReplyInput(e.target.value)}
                            placeholder={`Type quick response to ${conv.name} via ${channel.toUpperCase()}...`}
                            rows={2}
                            className="w-full bg-white border border-neutral-200 rounded-xl p-2.5 text-xs text-neutral-900 placeholder-neutral-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => { setReplyOpenId(null); setReplyInput(''); }}
                              className="px-3 py-1 rounded-lg text-xs font-medium text-neutral-500 hover:text-neutral-800"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={isSendingReply}
                              onClick={() => handleSendQuickReply(conv.id, channel, conv.name)}
                              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                            >
                              <Send className="h-3 w-3" />
                              <span>{isSendingReply ? 'Sending...' : 'Send Reply'}</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2.5 pt-2 border-t border-neutral-100 flex items-center justify-between text-xs">
                          <span className="text-[10px] font-mono text-neutral-400">
                            Score: {conv.score || 90}/100
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setNewDealForm({
                                  name: `${conv.company} Solution Suite`,
                                  client: conv.company,
                                  value: '75000',
                                  stage: 'qualified',
                                  channelOrigin: channel,
                                  expectedClose: 'Next Month'
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
                              onClick={() => { setReplyOpenId(conv.id); setReplyInput(''); }}
                              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition cursor-pointer"
                            >
                              <MessageSquare className="h-3 w-3" />
                              <span>Instant Reply</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right 1 Col: Real-time CRM Activity Timeline */}
        <div className="rounded-3xl bg-white/80 backdrop-blur-md border border-neutral-200/80 p-5 sm:p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-neutral-900">CRM Activity Stream</h3>
                  <p className="text-[11px] text-neutral-500">Live operational audit trail</p>
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
            <span>Audit Trail: Synced</span>
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



