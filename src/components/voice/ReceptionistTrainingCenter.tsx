import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  BookOpen,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  Search,
  Bot,
  Building2,
  Phone,
  MessageSquare,
  Volume2,
  VolumeX,
  Mic,
  MicOff,
  Send,
  RefreshCw,
  FileText,
  Sliders,
  ShieldCheck,
  Zap,
  PhoneForwarded,
  Layers,
  ArrowRight,
  HelpCircle,
  Clock,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Video,
  Calendar,
  FileSignature,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ReceptionistQA,
  ReceptionistDocument,
  DepartmentRoutingRule,
  ReceptionistCompanyProfile,
  ReceptionistKnowledgeStore
} from '../../utils/receptionistKnowledgeDb';

interface ReceptionistTrainingCenterProps {
  onClose?: () => void;
  onLaunchCallTest?: (promptText: string) => void;
  onNavigate?: (view: any) => void;
}

export default function ReceptionistTrainingCenter({
  onClose,
  onLaunchCallTest,
  onNavigate
}: ReceptionistTrainingCenterProps) {
  // Navigation tabs inside Training Center
  const [activeTab, setActiveTab] = useState<'qas' | 'documents' | 'profile' | 'departments' | 'simulator'>('qas');

  // Knowledge State
  const [store, setStore] = useState<ReceptionistKnowledgeStore | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Q&A Filtering & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Add / Edit Q&A Modal
  const [editingQA, setEditingQA] = useState<Partial<ReceptionistQA> | null>(null);
  const [isAddingQA, setIsAddingQA] = useState<boolean>(false);

  // Document Ingestion State
  const [docTitle, setDocTitle] = useState<string>('');
  const [docCategory, setDocCategory] = useState<string>('Company Policy');
  const [docRawText, setDocRawText] = useState<string>('');
  const [isTrainingDoc, setIsTrainingDoc] = useState<boolean>(false);

  // Simulator / Playground State
  const [simQuery, setSimQuery] = useState<string>('');
  const [simLoading, setSimLoading] = useState<boolean>(false);
  const [simVoiceActive, setSimVoiceActive] = useState<boolean>(false);
  const [autoSpeakReplies, setAutoSpeakReplies] = useState<boolean>(true);
  const [chatMessages, setChatMessages] = useState<Array<{
    id: string;
    sender: 'user' | 'receptionist';
    text: string;
    spokenReply?: string;
    confidenceScore?: number;
    intent?: string;
    actionType?: string;
    executedAction?: any;
    transferDept?: string | null;
    isTakingMsg?: boolean;
    matchedTopic?: string;
    suggestedQuestions?: string[];
    timestamp: string;
  }>>([
    {
      id: 'welcome-msg',
      sender: 'receptionist',
      text: "Hello! I am your trained AI Front-Desk Receptionist. Ask me anything about our business hours, office location, platform pricing, security compliance, or test my autonomous tools: scheduling meetings, launching video rooms, and creating proposals.",
      spokenReply: "Hello! I am your trained AI Front-Desk Receptionist. Ask me any question or ask me to schedule a meeting, start a video call, or prepare a proposal.",
      confidenceScore: 100,
      matchedTopic: 'Front Desk Orientation',
      suggestedQuestions: [
        "Can we jump on a video call right now?",
        "Schedule an executive meeting for tomorrow at 2 PM",
        "Create a contract proposal for enterprise CRM deployment",
        "What are your business hours & location?"
      ],
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  // Auto-scroll chat simulator
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, simLoading]);

  // Fetch current knowledge base
  const fetchKnowledge = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/communication/receptionist/knowledge');
      const data = await res.json();
      if (data.success && data.store) {
        setStore(data.store);
      }
    } catch (err: any) {
      console.error('[Training Center] Failed to load knowledge store:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKnowledge();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Toggle QA enabled state
  const handleToggleQA = async (id: string, currentEnabled: boolean) => {
    if (!store) return;
    try {
      const res = await fetch('/api/communication/receptionist/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_qa',
          qaId: id,
          updates: { enabled: !currentEnabled }
        })
      });
      const data = await res.json();
      if (data.success) {
        setStore(prev => prev ? ({
          ...prev,
          qas: prev.qas.map(q => q.id === id ? { ...q, enabled: !currentEnabled } : q)
        }) : null);
        showToast(currentEnabled ? 'Q&A disabled from voice and chat answers.' : 'Q&A activated for voice and chat answers!');
      }
    } catch (err: any) {
      console.error('Failed to toggle QA:', err);
    }
  };

  // Delete QA
  const handleDeleteQA = async (id: string) => {
    try {
      const res = await fetch(`/api/communication/receptionist/knowledge/qa/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setStore(prev => prev ? ({
          ...prev,
          qas: prev.qas.filter(q => q.id !== id)
        }) : null);
        showToast('Q&A entry removed from receptionist memory.');
      }
    } catch (err: any) {
      console.error('Failed to delete QA:', err);
    }
  };

  // Save Add/Edit QA
  const handleSaveQA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQA?.question || !editingQA?.answer) return;

    try {
      setSaving(true);
      if (editingQA.id) {
        // Update
        const res = await fetch('/api/communication/receptionist/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_qa',
            qaId: editingQA.id,
            updates: {
              question: editingQA.question,
              answer: editingQA.answer,
              category: editingQA.category || 'custom',
              keywords: typeof editingQA.keywords === 'string' 
                ? (editingQA.keywords as string).split(',').map(k => k.trim()).filter(Boolean)
                : editingQA.keywords || ['custom'],
              priority: editingQA.priority || 'medium'
            }
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Q&A updated and synced with AI receptionist!');
          fetchKnowledge();
          setEditingQA(null);
        }
      } else {
        // Add
        const res = await fetch('/api/communication/receptionist/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add_qa',
            qa: {
              question: editingQA.question,
              answer: editingQA.answer,
              category: editingQA.category || 'custom',
              keywords: typeof editingQA.keywords === 'string' 
                ? (editingQA.keywords as string).split(',').map(k => k.trim()).filter(Boolean)
                : ['custom', 'support'],
              priority: editingQA.priority || 'medium',
              enabled: true
            }
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('New Q&A entry trained into AI Receptionist!');
          fetchKnowledge();
          setEditingQA(null);
          setIsAddingQA(false);
        }
      }
    } catch (err: any) {
      console.error('Failed to save QA:', err);
    } finally {
      setSaving(false);
    }
  };

  // Ingest Document with Gemini
  const handleTrainDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docRawText.trim()) return;

    try {
      setIsTrainingDoc(true);
      const res = await fetch('/api/communication/receptionist/ai-train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: docRawText,
          documentTitle: docTitle || 'Custom Training Document',
          category: docCategory || 'Custom Training'
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`🎉 Gemini successfully extracted ${data.qas?.length || 0} training Q&As!`);
        setDocRawText('');
        setDocTitle('');
        fetchKnowledge();
        setActiveTab('qas');
      } else {
        showToast('Failed to train document. Please try again.');
      }
    } catch (err: any) {
      console.error('Failed to train document:', err);
    } finally {
      setIsTrainingDoc(false);
    }
  };

  // Save Company Profile Settings
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store) return;

    try {
      setSaving(true);
      const res = await fetch('/api/communication/receptionist/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_profile',
          profile: store.profile
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast('Company profile & voice persona updated successfully!');
      }
    } catch (err: any) {
      console.error('Failed to update profile:', err);
    } finally {
      setSaving(false);
    }
  };

  // Reset to default training
  const handleResetDefaults = async () => {
    if (!window.confirm('Reset the AI receptionist knowledge base to default enterprise settings?')) return;
    try {
      setLoading(true);
      const res = await fetch('/api/communication/receptionist/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      });
      const data = await res.json();
      if (data.success) {
        setStore(data.store);
        showToast('Knowledge base reset to default enterprise configuration.');
      }
    } catch (err: any) {
      console.error('Failed to reset knowledge:', err);
    } finally {
      setLoading(false);
    }
  };

  // Text-To-Speech Synthesis helper
  const speakSpokenText = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[*_#`]/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    // Pick female voice if available for Sophia
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => 
      v.name.includes('Samantha') || 
      v.name.includes('Google US English') || 
      v.name.includes('Zira') ||
      v.name.includes('Female')
    ) || voices[0];

    if (preferredVoice) utterance.voice = preferredVoice;
    window.speechSynthesis.speak(utterance);
  };

  // Submit query in Simulator Playground
  const handleSendSimulatorQuery = async (queryText?: string) => {
    const textToSend = (queryText || simQuery).trim();
    if (!textToSend || simLoading) return;

    const userMsgId = `user-${Date.now()}`;
    const newMessages = [
      ...chatMessages,
      {
        id: userMsgId,
        sender: 'user' as const,
        text: textToSend,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];

    setChatMessages(newMessages);
    setSimQuery('');
    setSimLoading(true);

    try {
      const res = await fetch('/api/communication/receptionist/chat-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          leadName: 'Lead Tester',
          leadCompany: 'Obsidian Testing Studio'
        })
      });
      const data = await res.json();

      if (data.success) {
        const receptionistMsg = {
          id: `rec-${Date.now()}`,
          sender: 'receptionist' as const,
          text: data.chatReply,
          spokenReply: data.spokenReply,
          confidenceScore: data.confidenceScore,
          intent: data.intent,
          actionType: data.actionType || (data.executedAction ? data.executedAction.type : null),
          executedAction: data.executedAction,
          transferDept: data.transferDepartment,
          isTakingMsg: data.isTakingMessage,
          matchedTopic: data.matchedKnowledgeTopic,
          suggestedQuestions: data.suggestedQuestions || [],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        setChatMessages(prev => [...prev, receptionistMsg]);

        // Trigger TTS Speech if enabled
        if (autoSpeakReplies && data.spokenReply) {
          speakSpokenText(data.spokenReply);
        }
      }
    } catch (err: any) {
      console.error('Simulator query failed:', err);
      setChatMessages(prev => [
        ...prev,
        {
          id: `rec-err-${Date.now()}`,
          sender: 'receptionist',
          text: "I am ready to assist. Please verify your connection or try asking another question.",
          spokenReply: "I am ready to assist. Please try asking again.",
          confidenceScore: 75,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setSimLoading(false);
    }
  };

  // Toggle voice recognition in simulator
  const toggleVoiceRecognition = () => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech Recognition is not supported by your browser.');
      return;
    }

    if (simVoiceActive) {
      recognitionRef.current?.stop();
      setSimVoiceActive(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setSimVoiceActive(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          handleSendSimulatorQuery(transcript);
        }
        setSimVoiceActive(false);
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setSimVoiceActive(false);
      };

      recognition.onend = () => {
        setSimVoiceActive(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e: any) {
      console.error('Failed to start speech recognition:', e);
      setSimVoiceActive(false);
    }
  };

  // Filtered Q&As
  const filteredQAs = (store?.qas || []).filter(qa => {
    const matchesCat = selectedCategory === 'all' || qa.category === selectedCategory;
    const matchesSearch = !searchQuery || 
      qa.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      qa.keywords.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-neutral-950/85 backdrop-blur-md animate-fade-in text-left">
      
      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 z-50 px-4 py-2.5 rounded-2xl bg-blue-600 text-white text-xs font-bold shadow-2xl flex items-center gap-2 border border-blue-400/30"
          >
            <Sparkles className="h-4 w-4 text-blue-200 animate-pulse" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="obsidian w-full max-w-6xl h-[92vh] bg-[var(--obsidian-1)] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden relative">
        
        {/* ========================================================================= */}
        {/* HEADER BAR                                                               */}
        {/* ========================================================================= */}
        <div className="obsidian px-6 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-4 bg-[var(--obsidian-1)]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-900/30">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-white tracking-tight">AI Receptionist Training Studio</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Gemini 3.7 Flash Trained
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                Train your front-desk AI receptionist to answer any custom business questions via chat or live voice
              </p>
            </div>
          </div>

          {/* Quick Metrics & Close Button */}
          <div className="flex items-center gap-2.5">
            <div className="obsidian hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-2xl bg-[var(--obsidian-2)] border border-white/5 text-xs">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-neutral-400">Ready:</span>
                <span className="font-bold text-white">98%</span>
              </div>
              <div className="h-3 w-px bg-white/10" />
              <div className="flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5 text-blue-400" />
                <span className="text-neutral-400">Memory:</span>
                <span className="font-bold text-white">{store?.qas.length || 0} Q&As</span>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('simulator')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Test Chat & Voice</span>
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                title="Close Training Studio"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SUB-NAVIGATION TABS                                                      */}
        {/* ========================================================================= */}
        <div className="obsidian px-6 border-b border-white/10 flex items-center gap-2 overflow-x-auto bg-[var(--obsidian-0)] py-2 scrollbar-none">
          {[
            { id: 'qas', label: 'Q&A Knowledge Base', icon: BookOpen, count: store?.qas.length },
            { id: 'documents', label: 'AI Document Trainer', icon: FileText, count: store?.documents.length },
            { id: 'profile', label: 'Company Profile & Persona', icon: Building2 },
            { id: 'departments', label: 'Routing & Directory', icon: PhoneForwarded, count: store?.departments.length },
            { id: 'simulator', label: 'Live Test Simulator (Chat & Voice)', icon: MessageSquare }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-blue-600/20 border border-blue-500/40 text-blue-300 shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? 'text-blue-400' : 'text-neutral-400'}`} />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    isActive ? 'bg-blue-500/30 text-blue-200' : 'bg-white/10 text-neutral-400'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ========================================================================= */}
        {/* MAIN BODY WORKSPACE                                                      */}
        {/* ========================================================================= */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 text-left">
          
          {/* ----------------------------------------------------------------------- */}
          {/* TAB 1: Q&A KNOWLEDGE BASE                                               */}
          {/* ----------------------------------------------------------------------- */}
          {activeTab === 'qas' && (
            <div className="space-y-4">
              
              {/* Filter & Action Bar */}
              <div className="obsidian flex flex-wrap items-center justify-between gap-3 bg-[var(--obsidian-1)] p-3 rounded-2xl border border-white/5">
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <div className="relative flex-1">
                    <Search className="h-3.5 w-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search questions, answers, or keywords..."
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Category Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto max-w-full">
                  {['all', 'general', 'pricing', 'technical', 'security', 'routing', 'policy', 'custom'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-xl transition-all cursor-pointer uppercase tracking-wider ${
                        selectedCategory === cat
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-[var(--obsidian-2)] text-neutral-400 hover:text-white border border-white/5'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Add QA CTA */}
                <button
                  onClick={() => {
                    setEditingQA({
                      category: 'general',
                      priority: 'high',
                      question: '',
                      answer: '',
                      keywords: ['info', 'faq']
                    });
                    setIsAddingQA(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Training Q&A</span>
                </button>
              </div>

              {/* Q&A Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {filteredQAs.map(qa => (
                  <div
                    key={qa.id}
                    className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                      qa.enabled 
                        ? 'bg-[var(--obsidian-1)] border-white/10 hover:border-blue-500/30' 
                        : 'bg-slate-900/50 border-white/5 opacity-60'
                    }`}
                  >
                    <div>
                      {/* Top Header of Card */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-300 border border-blue-500/20">
                            {qa.category}
                          </span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                            qa.priority === 'high' ? 'text-amber-400 bg-amber-500/10' : 'text-neutral-400 bg-neutral-800'
                          }`}>
                            {qa.priority}
                          </span>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleToggleQA(qa.id, qa.enabled)}
                            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                              qa.enabled ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-neutral-500 hover:bg-neutral-800'
                            }`}
                            title={qa.enabled ? 'Enabled in voice/chat (Click to disable)' : 'Disabled (Click to enable)'}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>

                          <button
                            onClick={() => {
                              setEditingQA(qa);
                              setIsAddingQA(false);
                            }}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-blue-300 hover:bg-blue-500/10 transition-colors cursor-pointer"
                            title="Edit this Q&A"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>

                          <button
                            onClick={() => handleDeleteQA(qa.id)}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Delete Q&A"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Question */}
                      <h4 className="text-xs font-bold text-white mb-1.5 leading-snug">
                        {qa.question}
                      </h4>

                      {/* Spoken Answer */}
                      <p className="obsidian text-xs text-neutral-300 leading-relaxed bg-[var(--obsidian-0)] p-2.5 rounded-xl border border-white/5">
                        {qa.answer}
                      </p>
                    </div>

                    {/* Footer Keywords & Test CTA */}
                    <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-white/5">
                      <div className="flex flex-wrap gap-1">
                        {qa.keywords.slice(0, 3).map((kw, idx) => (
                          <span key={idx} className="text-[10px] text-neutral-400 font-mono">
                            #{kw}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => speakSpokenText(qa.answer)}
                          className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-blue-300 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
                          title="Listen to spoken audio"
                        >
                          <Volume2 className="h-3 w-3" />
                          <span>Hear</span>
                        </button>

                        <button
                          onClick={() => {
                            setActiveTab('simulator');
                            handleSendSimulatorQuery(qa.question);
                          }}
                          className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-semibold px-2 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-all cursor-pointer"
                        >
                          <span>Test</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {filteredQAs.length === 0 && (
                <div className="obsidian p-8 text-center bg-[var(--obsidian-1)] rounded-2xl border border-white/5">
                  <BookOpen className="h-8 w-8 text-neutral-600 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-neutral-300">No Q&As found matching your search.</p>
                  <p className="text-[11px] text-neutral-500 mt-1">Try clearing your filters or click "Add Training Q&A".</p>
                </div>
              )}
            </div>
          )}

          {/* ----------------------------------------------------------------------- */}
          {/* TAB 2: AI DOCUMENT INGESTION TRAINER                                    */}
          {/* ----------------------------------------------------------------------- */}
          {activeTab === 'documents' && (
            <div className="space-y-5 max-w-4xl mx-auto">
              
              <div className="obsidian bg-[var(--obsidian-1)] border border-white/10 rounded-3xl p-5 shadow-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-blue-400" />
                  <h3 className="text-sm font-bold text-white">AI Instant Document & Knowledge Ingestion</h3>
                </div>
                <p className="text-xs text-neutral-400 mb-4 leading-relaxed">
                  Paste raw policy documents, product documentation, onboarding guides, or pricing sheets. Gemini 3.7 Flash will automatically digest the content, extract structured Q&A pairs, and update the voice dialer knowledge base.
                </p>

                <form onSubmit={handleTrainDocument} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                        Document Title
                      </label>
                      <input
                        type="text"
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        placeholder="e.g., 2026 Refund & Cancellation Policy"
                        required
                        className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                        Category
                      </label>
                      <select
                        value={docCategory}
                        onChange={(e) => setDocCategory(e.target.value)}
                        className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                      >
                        <option value="Company Policy">Company Policy</option>
                        <option value="Pricing & Plans">Pricing & Plans</option>
                        <option value="Technical Specs">Technical Specs</option>
                        <option value="Security & Compliance">Security & Compliance</option>
                        <option value="Visitor & Facility Guidelines">Visitor & Facility Guidelines</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Raw Content / Text to Ingest
                    </label>
                    <textarea
                      value={docRawText}
                      onChange={(e) => setDocRawText(e.target.value)}
                      placeholder="Paste paragraphs, employee handbooks, pricing summaries, or customer FAQs here..."
                      rows={6}
                      required
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl p-3 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                      <Zap className="h-3.5 w-3.5 text-amber-400" />
                      <span>Gemini will automatically generate verified spoken answers & keywords</span>
                    </div>

                    <button
                      type="submit"
                      disabled={isTrainingDoc || !docRawText.trim()}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-blue-900/30 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {isTrainingDoc ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Synthesizing Knowledge...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Train AI Receptionist with Gemini</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* List of Ingested Documents */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-neutral-300 uppercase tracking-wider">
                  Ingested Knowledge Documents ({store?.documents.length || 0})
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {store?.documents.map(doc => (
                    <div key={doc.id} className="obsidian p-4 rounded-2xl bg-[var(--obsidian-1)] border border-white/10 text-left space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-300 border border-blue-500/20 uppercase tracking-wider">
                          {doc.category}
                        </span>
                        <span className="text-[10px] text-neutral-400 font-mono">
                          {doc.extractedQAsCount} Q&As learned
                        </span>
                      </div>
                      <h5 className="text-xs font-bold text-white">{doc.title}</h5>
                      <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">{doc.summary || doc.rawContent}</p>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

          {/* ----------------------------------------------------------------------- */}
          {/* TAB 3: COMPANY PROFILE & PERSONA TUNING                                 */}
          {/* ----------------------------------------------------------------------- */}
          {activeTab === 'profile' && store && (
            <form onSubmit={handleSaveProfile} className="space-y-5 max-w-4xl mx-auto">
              
              <div className="obsidian bg-[var(--obsidian-1)] border border-white/10 rounded-3xl p-5 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-blue-400" />
                    <h3 className="text-sm font-bold text-white">Company Identity & Front-Desk Persona</h3>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetDefaults}
                    className="text-[11px] text-neutral-400 hover:text-amber-400 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Reset to Defaults</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={store.profile.companyName}
                      onChange={(e) => setStore({ ...store, profile: { ...store.profile, companyName: e.target.value } })}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Industry / Sector
                    </label>
                    <input
                      type="text"
                      value={store.profile.industry}
                      onChange={(e) => setStore({ ...store, profile: { ...store.profile, industry: e.target.value } })}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Business Hours
                    </label>
                    <input
                      type="text"
                      value={store.profile.businessHours}
                      onChange={(e) => setStore({ ...store, profile: { ...store.profile, businessHours: e.target.value } })}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Timezone
                    </label>
                    <input
                      type="text"
                      value={store.profile.timezone}
                      onChange={(e) => setStore({ ...store, profile: { ...store.profile, timezone: e.target.value } })}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Office / Corporate Address
                    </label>
                    <input
                      type="text"
                      value={store.profile.address}
                      onChange={(e) => setStore({ ...store, profile: { ...store.profile, address: e.target.value } })}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Emergency On-Call Hotline
                    </label>
                    <input
                      type="text"
                      value={store.profile.emergencyPhone}
                      onChange={(e) => setStore({ ...store, profile: { ...store.profile, emergencyPhone: e.target.value } })}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Receptionist Persona Tone
                    </label>
                    <select
                      value={store.profile.voiceTone}
                      onChange={(e) => setStore({ ...store, profile: { ...store.profile, voiceTone: e.target.value as any } })}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="executive">Executive & Professional</option>
                      <option value="friendly">Warm & Friendly Concierge</option>
                      <option value="formal">Formal & Structured</option>
                      <option value="concierge">Luxury Hospitality Concierge</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Default Opening Spoken Greeting
                    </label>
                    <textarea
                      value={store.profile.defaultGreeting}
                      onChange={(e) => setStore({ ...store, profile: { ...store.profile, defaultGreeting: e.target.value } })}
                      rows={2}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Fallback & Unanswered Question Policy
                    </label>
                    <input
                      type="text"
                      value={store.profile.fallbackInstructions}
                      onChange={(e) => setStore({ ...store, profile: { ...store.profile, fallbackInstructions: e.target.value } })}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-3 border-t border-white/5">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-50"
                  >
                    {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    <span>Save Company Settings</span>
                  </button>
                </div>
              </div>

            </form>
          )}

          {/* ----------------------------------------------------------------------- */}
          {/* TAB 4: DEPARTMENTS & WARM TRANSFER DIRECTORY                             */}
          {/* ----------------------------------------------------------------------- */}
          {activeTab === 'departments' && store && (
            <div className="space-y-4 max-w-4xl mx-auto">
              <div className="obsidian bg-[var(--obsidian-1)] border border-white/10 rounded-3xl p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">Department Routing & Spoken Triggers</h3>
                    <p className="text-xs text-neutral-400 mt-0.5">When callers mention these keywords, the AI receptionist initiates warm transfers</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {store.departments.map(dept => (
                    <div key={dept.departmentKey} className="obsidian p-4 rounded-2xl bg-[var(--obsidian-2)] border border-white/5 space-y-2.5 text-left">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-lg border border-blue-500/20">
                            Ext {dept.extension}
                          </span>
                          <h4 className="text-xs font-bold text-white">{dept.name}</h4>
                          <span className="text-xs text-neutral-400">({dept.leadPerson} • {dept.title})</span>
                        </div>

                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                          dept.status === 'available' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                          dept.status === 'in_meeting' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                          'bg-neutral-800 text-neutral-400 border-neutral-700'
                        }`}>
                          {dept.status === 'in_meeting' ? 'In Meeting (Takes Messages)' : dept.status}
                        </span>
                      </div>

                      {/* Trigger keywords */}
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
                          Spoken Transfer Trigger Words:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {dept.triggers.map((trig, idx) => (
                            <span key={idx} className="obsidian text-[11px] px-2 py-0.5 rounded-lg bg-[var(--obsidian-0)] text-neutral-300 border border-white/5">
                              "{trig}"
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------------------------- */}
          {/* TAB 5: MULTI-MODAL AI SIMULATOR PLAYGROUND                              */}
          {/* ----------------------------------------------------------------------- */}
          {activeTab === 'simulator' && (
            <div className="obsidian max-w-4xl mx-auto h-[68vh] flex flex-col bg-[var(--obsidian-1)] border border-white/10 rounded-3xl p-4 shadow-xl overflow-hidden">
              
              {/* Simulator Top Controls */}
              <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-blue-400" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white">Live Receptionist Test Sandbox</h3>
                </div>

                <div className="flex items-center gap-3">
                  {/* Auto-TTS Toggle */}
                  <button
                    onClick={() => setAutoSpeakReplies(!autoSpeakReplies)}
                    className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-xl transition-all cursor-pointer ${
                      autoSpeakReplies ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30' : 'bg-neutral-800 text-neutral-400'
                    }`}
                    title="Read answers out loud using SpeechSynthesis"
                  >
                    {autoSpeakReplies ? <Volume2 className="h-3.5 w-3.5 text-blue-400" /> : <VolumeX className="h-3.5 w-3.5" />}
                    <span>Voice Audio {autoSpeakReplies ? 'ON' : 'OFF'}</span>
                  </button>

                  <button
                    onClick={() => setChatMessages([])}
                    className="text-[11px] text-neutral-400 hover:text-white transition-colors cursor-pointer"
                  >
                    Clear History
                  </button>
                </div>
              </div>

              {/* Chat Message Stream */}
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-2">
                {chatMessages.map(msg => {
                  const isUser = msg.sender === 'user';
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1 px-1">
                        <span className={`text-[10px] font-bold ${isUser ? 'text-emerald-400' : 'text-blue-400'}`}>
                          {isUser ? 'You (Caller / Chat)' : 'Sophia (AI Receptionist)'}
                        </span>
                        <span className="text-[9px] text-neutral-500 font-mono">{msg.timestamp}</span>
                      </div>

                      <div className={`p-3.5 rounded-2xl text-xs leading-relaxed max-w-[85%] ${
                        isUser
                          ? 'bg-blue-600 text-white rounded-tr-sm shadow-md'
                          : 'bg-[var(--obsidian-2)] text-neutral-200 border border-white/5 rounded-tl-sm shadow-sm'
                      }`}>
                        <div className="whitespace-pre-wrap">{msg.text}</div>

                        {/* Autonomous Action Result Card */}
                        {!isUser && msg.executedAction && (
                          <div className="obsidian mt-3 p-3 rounded-xl bg-[var(--obsidian-1)] border border-blue-500/30 space-y-2 text-left shadow-md">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                {msg.executedAction.type === 'video_call' && <Video className="h-4 w-4 text-emerald-400" />}
                                {msg.executedAction.type === 'calendar_event' && <Calendar className="h-4 w-4 text-blue-400" />}
                                {msg.executedAction.type === 'proposal' && <FileSignature className="h-4 w-4 text-amber-400" />}
                                <span className="text-[11px] font-bold text-white uppercase tracking-wider">
                                  {msg.executedAction.type === 'video_call' ? 'Live Video Room Generated' :
                                   msg.executedAction.type === 'calendar_event' ? 'Calendar Meeting Booked' :
                                   'Enterprise Proposal Generated'}
                                </span>
                              </div>
                              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                                Autonomous Tool Executed
                              </span>
                            </div>

                            {/* Video Call Details */}
                            {msg.executedAction.type === 'video_call' && (
                              <div className="space-y-1.5 text-[11px]">
                                <div className="text-neutral-300 font-semibold">{msg.executedAction.data?.roomName || 'GREET meeting'}</div>
                                <div className="text-[10px] text-neutral-400">Encrypted Room ID: <span className="font-mono text-emerald-400">{msg.executedAction.data?.roomId || 'meet-and-greet'}</span> • Destination: <span className="text-blue-300 font-semibold">GREET</span></div>
                                <div className="pt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (onNavigate) {
                                        onNavigate('call_canvas');
                                        onClose?.();
                                      } else if (msg.executedAction.data?.joinUrl) {
                                        window.location.href = msg.executedAction.data.joinUrl;
                                      }
                                    }}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition-all shadow-sm cursor-pointer"
                                  >
                                    <Video className="h-3 w-3" />
                                    <span>Open GREET</span>
                                    <ArrowRight className="h-3 w-3 ml-0.5 opacity-90" />
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Calendar Event Details */}
                            {msg.executedAction.type === 'calendar_event' && (
                              <div className="space-y-1 text-[11px]">
                                <div className="text-neutral-200 font-semibold">{msg.executedAction.data?.title}</div>
                                <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-400">
                                  <span className="text-blue-300 font-mono">📅 {msg.executedAction.data?.date} at {msg.executedAction.data?.time}</span>
                                  <span>•</span>
                                  <span>⏳ {msg.executedAction.data?.duration} mins</span>
                                </div>
                                <div className="text-[10px] text-neutral-400 font-mono truncate">
                                  Invited: {msg.executedAction.data?.attendees?.join(', ')}
                                </div>
                              </div>
                            )}

                            {/* Proposal Details */}
                            {msg.executedAction.type === 'proposal' && (
                              <div className="space-y-1.5 text-[11px]">
                                <div className="flex items-center justify-between">
                                  <span className="text-neutral-200 font-semibold">{msg.executedAction.data?.title}</span>
                                  <span className="text-amber-400 font-bold font-mono text-xs">
                                    ${Number(msg.executedAction.data?.price || 78000).toLocaleString()}
                                  </span>
                                </div>
                                {msg.executedAction.data?.deliverables && (
                                  <ul className="space-y-0.5 text-[10px] text-neutral-400 pl-3 list-disc">
                                    {msg.executedAction.data.deliverables.slice(0, 3).map((item: string, idx: number) => (
                                      <li key={idx}>{item}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Metadata badge tags for AI Receptionist responses */}
                        {!isUser && (
                          <div className="mt-2.5 pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {msg.confidenceScore && (
                                <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                  {msg.confidenceScore}% Confidence
                                </span>
                              )}
                              {msg.matchedTopic && (
                                <span className="text-[10px] text-blue-300 font-semibold bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
                                  {msg.matchedTopic}
                                </span>
                              )}
                            </div>

                            {msg.spokenReply && (
                              <button
                                onClick={() => speakSpokenText(msg.spokenReply!)}
                                className="flex items-center gap-1 text-[10px] text-neutral-400 hover:text-blue-300 cursor-pointer"
                                title="Replay spoken audio"
                              >
                                <Volume2 className="h-3 w-3" />
                                <span>Replay Voice</span>
                              </button>
                            )}
                          </div>
                        )}

                        {/* Suggested Follow-up chips */}
                        {!isUser && msg.suggestedQuestions && msg.suggestedQuestions.length > 0 && (
                          <div className="mt-2.5 pt-2 border-t border-white/5">
                            <span className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                              Suggested Follow-ups:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {msg.suggestedQuestions.map((q, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => handleSendSimulatorQuery(q)}
                                  className="obsidian text-[10px] px-2 py-0.5 rounded-lg bg-[var(--obsidian-0)] hover:bg-blue-600/30 hover:text-white border border-white/10 text-neutral-300 transition-all cursor-pointer"
                                >
                                  {q}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}

                {simLoading && (
                  <div className="obsidian flex items-center gap-2 p-3 rounded-2xl bg-[var(--obsidian-2)] text-neutral-400 text-xs w-fit">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-400" />
                    <span>AI Receptionist is consulting trained memory...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Simulator Input Bar */}
              <div className="mt-3 pt-2 border-t border-white/5">
                <form onSubmit={(e) => { e.preventDefault(); handleSendSimulatorQuery(); }} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleVoiceRecognition}
                    className={`h-9 w-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                      simVoiceActive
                        ? 'bg-rose-600 text-white animate-pulse shadow-lg shadow-rose-900/40'
                        : 'bg-[var(--obsidian-2)] hover:bg-white/10 text-neutral-300'
                    }`}
                    title={simVoiceActive ? 'Listening... click to stop' : 'Speak via microphone'}
                  >
                    {simVoiceActive ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  </button>

                  <input
                    type="text"
                    value={simQuery}
                    onChange={(e) => setSimQuery(e.target.value)}
                    placeholder="Ask any question (e.g., 'What are your hours?', 'Where are you located?', 'Do you have SOC2?')"
                    className="obsidian flex-1 bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                  />

                  <button
                    type="submit"
                    disabled={!simQuery.trim() || simLoading}
                    className="h-9 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Send</span>
                  </button>
                </form>
              </div>

            </div>
          )}

        </div>

      </div>

      {/* ========================================================================= */}
      {/* ADD / EDIT Q&A MODAL                                                     */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {editingQA && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="obsidian w-full max-w-lg bg-[var(--obsidian-1)] border border-white/15 rounded-3xl p-5 shadow-2xl text-left"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <Edit3 className="h-4 w-4 text-blue-400" />
                  <h3 className="text-sm font-bold text-white">
                    {editingQA.id ? 'Edit Trained Q&A' : 'Add New Receptionist Q&A'}
                  </h3>
                </div>
                <button
                  onClick={() => setEditingQA(null)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSaveQA} className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                    Question (What callers or clients will ask)
                  </label>
                  <input
                    type="text"
                    value={editingQA.question || ''}
                    onChange={(e) => setEditingQA({ ...editingQA, question: e.target.value })}
                    placeholder="e.g., What are your holiday hours?"
                    required
                    className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                    Spoken Answer (Keep under 40 words, spoken-friendly)
                  </label>
                  <textarea
                    value={editingQA.answer || ''}
                    onChange={(e) => setEditingQA({ ...editingQA, answer: e.target.value })}
                    placeholder="e.g., We are closed on major federal holidays, but 24/7 on-call DevOps remains active."
                    rows={3}
                    required
                    className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Category
                    </label>
                    <select
                      value={editingQA.category || 'general'}
                      onChange={(e) => setEditingQA({ ...editingQA, category: e.target.value as any })}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="general">General Operations</option>
                      <option value="pricing">Pricing & Plans</option>
                      <option value="technical">Technical & Integrations</option>
                      <option value="security">Security & Compliance</option>
                      <option value="policy">Policy & Guarantees</option>
                      <option value="routing">Department Routing</option>
                      <option value="custom">Custom Policy</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                      Priority
                    </label>
                    <select
                      value={editingQA.priority || 'medium'}
                      onChange={(e) => setEditingQA({ ...editingQA, priority: e.target.value as any })}
                      className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="high">High (Immediate Answer)</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                    Search Trigger Keywords (comma separated)
                  </label>
                  <input
                    type="text"
                    value={Array.isArray(editingQA.keywords) ? editingQA.keywords.join(', ') : editingQA.keywords || ''}
                    onChange={(e) => setEditingQA({ ...editingQA, keywords: e.target.value as any })}
                    placeholder="e.g., holiday, thanksgiving, christmas, schedule, hours"
                    className="obsidian w-full bg-[var(--obsidian-0)] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setEditingQA(null)}
                    className="px-4 py-2 rounded-xl border border-white/10 text-neutral-400 hover:text-white text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50"
                  >
                    {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    <span>Save & Train Receptionist</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
