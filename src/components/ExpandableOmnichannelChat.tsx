import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Maximize2, Minimize2, Paperclip, Smile, Zap, Search, 
  UserCheck, ShieldCheck, CheckCheck, Bot, Sparkles, Phone, Video,
  X, ChevronDown, Check, MoreVertical, RefreshCw, MessageSquare,
  Volume2, VolumeX, Download, Image as ImageIcon, CornerDownLeft
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';

interface ChatMessage {
  id: string;
  sender: 'client' | 'agent' | 'copilot' | 'system';
  author: string;
  avatar?: string;
  content: string;
  timestamp: string;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  channel: 'webchat' | 'whatsapp' | 'sms' | 'linkedin' | 'support';
  attachments?: Array<{ name: string; size: string; type: string }>;
}

interface ChatChannel {
  id: string;
  name: string;
  clientName: string;
  company: string;
  avatar: string;
  channel: 'webchat' | 'whatsapp' | 'sms' | 'linkedin' | 'support';
  lastMessage: string;
  unreadCount: number;
  online: boolean;
  typing?: boolean;
}

interface ExpandableOmnichannelChatProps {
  currentUser?: string;
  className?: string;
  onClose?: () => void;
}

// TO COMPLETE: load the user's connected channels/conversations from /api/messaging/conversations.
const SAMPLE_CHANNELS: ChatChannel[] = [];

const INITIAL_MESSAGES: Record<string, ChatMessage[]> = {
  'chan-1': [
    {
      id: 'm1',
      sender: 'client',
      author: 'Marcus Chen',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120',
      content: 'Hi Kate, we are reviewing the Obsidian architecture document.',
      timestamp: '10:14 AM',
      status: 'read',
      channel: 'webchat'
    },
    {
      id: 'm2',
      sender: 'agent',
      author: 'Kate Smith',
      content: 'Good morning Marcus! Happy to answer any specific security or latency routing questions.',
      timestamp: '10:15 AM',
      status: 'read',
      channel: 'webchat'
    },
    {
      id: 'm3',
      sender: 'client',
      author: 'Marcus Chen',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120',
      content: 'Can we configure multi-region latency fallback for our team?',
      timestamp: '10:17 AM',
      status: 'delivered',
      channel: 'webchat'
    }
  ],
  'chan-2': [
    {
      id: 'm4',
      sender: 'client',
      author: 'Elena Rostova',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120',
      content: 'The proposal was signed by our VP. Sending wire info.',
      timestamp: '09:42 AM',
      status: 'read',
      channel: 'whatsapp'
    }
  ]
};

export default function ExpandableOmnichannelChat({
  currentUser = 'Kate Smith',
  className = '',
  onClose
}: ExpandableOmnichannelChatProps) {
  const [channels, setChannels] = useState<ChatChannel[]>(SAMPLE_CHANNELS);
  const [activeChannelId, setActiveChannelId] = useState<string>('chan-1');
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isCopilotSuggesting, setIsCopilotSuggesting] = useState(false);
  const [suggestedReply, setSuggestedReply] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeChannel = channels.find(c => c.id === activeChannelId) || channels[0];
  const currentMessages = messages[activeChannelId] || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentMessages, activeChannelId]);

  const playChime = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) {
      // Audio context might be restricted before interaction
    }
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      author: currentUser,
      content: inputText.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'delivered',
      channel: activeChannel.channel
    };

    setMessages(prev => ({
      ...prev,
      [activeChannelId]: [...(prev[activeChannelId] || []), newMsg]
    }));

    setInputText('');
    setSuggestedReply(null);
    playChime();

    // Update last message in channels list
    setChannels(prev => prev.map(c => 
      c.id === activeChannelId 
        ? { ...c, lastMessage: newMsg.content, unreadCount: 0 } 
        : c
    ));

    // Simulate auto-client reply after 2.5 seconds if talking to Marcus
    if (activeChannelId === 'chan-1') {
      setTimeout(() => {
        const clientReply: ChatMessage = {
          id: `msg-client-${Date.now()}`,
          sender: 'client',
          author: activeChannel.clientName,
          avatar: activeChannel.avatar,
          content: 'Got it! That aligns with our compliance requirements. Thank you for clarifying.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'read',
          channel: activeChannel.channel
        };
        setMessages(prev => ({
          ...prev,
          [activeChannelId]: [...(prev[activeChannelId] || []), clientReply]
        }));
        playChime();
      }, 2500);
    }
  };

  const handleTriggerCopilot = () => {
    setIsCopilotSuggesting(true);
    setTimeout(() => {
      setIsCopilotSuggesting(false);
      setSuggestedReply(
        `Yes, absolutely! Obsidian supports automated multi-region replication and sub-35ms routing with automatic health-check failover.`
      );
    }, 600);
  };

  const filteredChannels = channels.filter(c => 
    c.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.channel.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div 
      className={`flex flex-col bg-neutral-900/90 text-neutral-100 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl shadow-2xl transition-all duration-300 ${
        isExpanded 
          ? 'fixed inset-4 sm:inset-10 z-50 shadow-2xl' 
          : `${className} h-full min-h-[460px]`
      }`}
      id="expandable-omnichannel-chat-container"
    >
      {/* Top Navigation & Status Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-neutral-950/80 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-black text-xs shadow-md">
            <Zap className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-black text-white tracking-wide">Direct Client Live Hub</h3>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] font-mono font-bold flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live WebSocket
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 font-mono">
              Active Agent: <span className="text-blue-400 font-semibold">{currentUser}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
            title={soundEnabled ? "Mute audio chimes" : "Enable audio chimes"}
          >
            {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
            title={isExpanded ? "Collapse to embedded view" : "Expand to fullscreen canvas"}
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-neutral-800 transition cursor-pointer"
              title="Close chat"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Left Channels Sidebar + Right Live Chat Area */}
      <div className="grid grid-cols-1 md:grid-cols-12 flex-1 min-h-0 overflow-hidden">
        
        {/* Left Channel Directory */}
        <div className="hidden md:flex md:col-span-4 lg:col-span-3 border-r border-white/5 bg-neutral-950/40 flex-col overflow-hidden">
          {/* Search box */}
          <div className="p-3 border-b border-white/5">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-500" />
              <input
                type="text"
                placeholder="Search direct channels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-neutral-900 border border-white/5 rounded-xl pl-8 pr-3 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-500 outline-none focus:border-blue-500/40"
              />
            </div>
          </div>

          {/* Channels list */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {filteredChannels.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setActiveChannelId(c.id);
                  setChannels(prev => prev.map(item => item.id === c.id ? { ...item, unreadCount: 0 } : item));
                }}
                className={`w-full p-3 text-left transition-all flex items-start gap-3 hover:bg-neutral-900/60 cursor-pointer ${
                  activeChannelId === c.id ? 'bg-blue-600/10 border-l-2 border-blue-500' : ''
                }`}
              >
                <div className="relative shrink-0">
                  <img
                    src={c.avatar}
                    alt={c.clientName}
                    className="h-9 w-9 rounded-xl object-cover border border-white/10"
                    referrerPolicy="no-referrer"
                  />
                  {c.online && (
                    <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-neutral-950" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-neutral-200 truncate">{c.clientName}</span>
                    <span className="text-[9px] font-mono text-neutral-500 uppercase">{c.channel}</span>
                  </div>
                  <span className="text-[10px] text-neutral-400 block truncate">{c.company}</span>
                  <p className="text-[10.5px] text-neutral-400 truncate mt-0.5">{c.lastMessage}</p>
                </div>
                {c.unreadCount > 0 && (
                  <span className="h-4 px-1.5 rounded-full bg-blue-600 text-white text-[9px] font-extrabold flex items-center justify-center shrink-0">
                    {c.unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right Active Chat Workspace */}
        <div className="col-span-1 md:col-span-8 lg:col-span-9 flex flex-col h-full overflow-hidden bg-neutral-900/30">
          
          {/* Active Contact Header */}
          <div className="p-3 px-4 bg-neutral-950/60 border-b border-white/5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <img
                src={activeChannel.avatar}
                alt={activeChannel.clientName}
                className="h-8 w-8 rounded-xl object-cover border border-white/10"
                referrerPolicy="no-referrer"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-white">{activeChannel.clientName}</h4>
                  <span className="px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-300 text-[9px] font-mono font-semibold">
                    {activeChannel.company}
                  </span>
                </div>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Connected via {activeChannel.channel.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleTriggerCopilot}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-blue-400 text-xs font-bold transition cursor-pointer"
                title="Trigger AI Copilot drafting"
              >
                <Sparkles className="h-3.5 w-3.5 text-blue-400 animate-spin" />
                <span>AI Draft</span>
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {currentMessages.map(msg => {
              const isMe = msg.sender === 'agent';
              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2.5 ${isMe ? 'justify-end' : 'justify-start'}`}
                >
                  {!isMe && msg.avatar && (
                    <img
                      src={msg.avatar}
                      alt={msg.author}
                      className="h-7 w-7 rounded-xl object-cover border border-white/10 shrink-0 mb-0.5"
                      referrerPolicy="no-referrer"
                    />
                  )}

                  <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-xs space-y-1 shadow-md ${
                    isMe 
                      ? 'bg-blue-600 text-white rounded-br-xs' 
                      : 'bg-neutral-800/90 text-neutral-200 border border-white/5 rounded-bl-xs'
                  }`}>
                    <div className="flex items-center justify-between gap-4 text-[9.5px] opacity-75 font-mono">
                      <span>{msg.author}</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    <p className="leading-relaxed whitespace-pre-wrap font-sans">{msg.content}</p>
                    {isMe && (
                      <div className="flex justify-end pt-0.5">
                        <CheckCheck className="h-3 w-3 text-blue-200" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* AI Copilot Draft Suggestion Banner */}
          {suggestedReply && (
            <div className="p-3 mx-3 mb-2 bg-indigo-950/60 border border-indigo-500/30 rounded-xl flex items-start justify-between gap-3 text-xs animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider font-mono">
                    Suggested Response
                  </span>
                  <p className="text-neutral-200 text-xs mt-0.5">{suggestedReply}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setInputText(suggestedReply);
                    setSuggestedReply(null);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] transition cursor-pointer"
                >
                  Use Draft
                </button>
                <button
                  type="button"
                  onClick={() => setSuggestedReply(null)}
                  className="p-1 text-neutral-400 hover:text-neutral-200"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* Input Box */}
          <div className="p-3 bg-neutral-950/80 border-t border-white/5 shrink-0">
            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 bg-neutral-900 border border-white/5 rounded-xl px-3 py-1.5 focus-within:border-blue-500/40 transition">
                <input
                  type="text"
                  placeholder={`Reply to ${activeChannel.clientName}...`}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  className="w-full bg-transparent border-none outline-none text-xs text-white placeholder:text-neutral-500 font-sans"
                />
              </div>

              <button
                type="submit"
                disabled={!inputText.trim()}
                className={`p-2 px-3.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-md ${
                  inputText.trim() 
                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20' 
                    : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                }`}
              >
                <span>Send</span>
                <CornerDownLeft className="h-3 w-3" />
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}
