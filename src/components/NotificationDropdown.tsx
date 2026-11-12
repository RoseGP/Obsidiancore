import React, { useState, useRef, useEffect } from 'react';
import { 
  Bell, Check, CheckCheck, Trash2, X, MessageSquare, Calendar, 
  Megaphone, FileText, ShieldCheck, Phone, Sparkles, Filter, 
  ExternalLink, Settings, Flame, Volume2, VolumeX, Radio, ArrowRight,
  SlidersHorizontal
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AppNotification, ActiveView } from '../types';
import { useNotifications } from '../context/NotificationContext';

interface NotificationDropdownProps {
  themeMode?: 'light' | 'dark';
  onNavigateView: (view: ActiveView, targetId?: string) => void;
  onOpenSettings?: () => void;
  onOpenPreferences?: () => void;
  notifications?: AppNotification[];
  onMarkAsRead?: (id: string) => void;
  onMarkAllAsRead?: () => void;
  onDismiss?: (id: string) => void;
  onClearAll?: () => void;
}

export const NotificationDropdown: React.FC<NotificationDropdownProps> = ({
  themeMode = 'dark',
  onNavigateView,
  onOpenSettings,
  onOpenPreferences
}) => {
  const { 
    notifications, 
    unreadCount, 
    soundEnabled, 
    setSoundEnabled,
    autoStreamActive,
    setAutoStreamActive,
    markAsRead, 
    markAllAsRead, 
    deleteNotification, 
    clearAllNotifications, 
    simulateEvent 
  } = useNotifications();

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'lead' | 'message' | 'task'>('all');
  const [showSimulateMenu, setShowSimulateMenu] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Keyboard shortcut ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Filter logic
  const filteredNotifications = notifications.filter(n => {
    if (activeTab === 'unread') return !n.read;
    if (activeTab === 'lead') return n.type === 'lead';
    if (activeTab === 'message') return n.type === 'message';
    if (activeTab === 'task') return n.type === 'task';
    return true;
  });

  const getNotificationIcon = (type: AppNotification['type']) => {
    switch (type) {
      case 'lead':
        return <Flame className="h-4 w-4 text-[var(--success)] shrink-0" />;
      case 'message':
        return <MessageSquare className="h-4 w-4 text-[var(--accent-text)] shrink-0" />;
      case 'task':
        return <CheckCheck className="h-4 w-4 text-[var(--warning)] shrink-0" />;
      case 'meeting':
        return <Calendar className="h-4 w-4 text-[var(--accent-text)] shrink-0" />;
      case 'interaction':
        return <Sparkles className="h-4 w-4 text-[var(--info)] shrink-0" />;
      case 'proposal':
        return <FileText className="h-4 w-4 text-[var(--warning)] shrink-0" />;
      case 'system':
        return <ShieldCheck className="h-4 w-4 text-[var(--success)] shrink-0" />;
      case 'call':
        return <Phone className="h-4 w-4 text-[var(--success)] shrink-0" />;
      default:
        return <Sparkles className="h-4 w-4 text-[var(--accent-text)] shrink-0" />;
    }
  };

  const getNotificationBadgeColor = (type: AppNotification['type']) => {
    switch (type) {
      case 'lead': return 'bg-emerald-500/15 border-emerald-500/30 text-[var(--success)]';
      case 'message': return 'bg-indigo-500/15 border-indigo-500/30 text-[var(--accent-text)]';
      case 'task': return 'bg-amber-500/15 border-amber-500/30 text-[var(--warning)]';
      case 'interaction': return 'bg-cyan-500/15 border-cyan-500/30 text-[var(--info)]';
      case 'system': return 'bg-purple-500/15 border-purple-500/30 text-[var(--accent-text)]';
      default: return 'bg-[var(--border)] border-[var(--border)] text-[var(--text-muted)]';
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block text-left z-40">
      
      {/* BELL TRIGGER BUTTON */}
      <button 
        id="btn-trigger-notifications"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle notifications dropdown"
        aria-expanded={isOpen}
        className={`relative p-2.5 rounded-xl transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/50 border ${
          isOpen
            ? 'bg-[var(--surface-sunken)] text-[var(--text)] border-[var(--border)] shadow-lg'
            : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)] border-[var(--border)]'
        }`}
        title={`Notifications (${unreadCount} unread)`}
      >
        <Bell className="h-4 w-4" />
        
        {/* BADGE COUNTER */}
        {unreadCount > 0 && (
          <motion.span 
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            key={unreadCount}
            className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black tracking-tight text-white bg-indigo-600 shadow-[0_0_12px_rgba(99,102,241,0.5)] border border-[var(--border)] select-none pointer-events-none"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </motion.span>
        )}
      </button>

      {/* LUXURY OBSIDIAN DROPDOWN POPOVER PANEL */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 mt-2.5 w-80 sm:w-96 rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.9)] border border-[var(--border)] bg-[#0B0C10]/95 backdrop-blur-2xl text-[var(--text)] select-none z-50 overflow-hidden flex flex-col max-h-[85vh]"
          >
            {/* 1. Header with Luxury Styling */}
            <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-gradient-to-r from-indigo-950/40 via-transparent to-transparent">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-[var(--accent-text)]">
                  <Bell className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-[var(--text)] tracking-wide">
                    Live Notification Center
                  </h3>
                  <p className="text-[10px] text-[var(--text-muted)] font-mono">
                    {unreadCount} unread • Real-time event stream
                  </p>
                </div>
              </div>

              {/* Quick Controls: Sound & Mark All */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                    soundEnabled 
                      ? 'border-indigo-500/30 bg-indigo-500/10 text-[var(--accent-text)]' 
                      : 'border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                  title={soundEnabled ? 'Mute luxury audio chime' : 'Enable audio chime'}
                >
                  {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                </button>

                {onOpenPreferences && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsOpen(false);
                      onOpenPreferences();
                    }}
                    className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                    title="Customize Notification Preferences (Channels, Types & Sound)"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </button>
                )}

                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllAsRead}
                    className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                    title="Mark all as read"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* 2. Developer tool: inject test notifications (development builds only; these events are invented) */}
            {(import.meta as any).env?.DEV && <div className="px-3 py-2 bg-white/[0.02] border-b border-[var(--border)] flex items-center justify-between text-xs">
              <span className="text-[10px] font-mono text-[var(--text-muted)] flex items-center gap-1.5">
                <Radio className={`h-3 w-3 ${autoStreamActive ? 'text-[var(--success)] animate-pulse' : 'text-[var(--text-subtle)]'}`} />
                <span>Simulate Event:</span>
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => simulateEvent('lead')}
                  className="px-2 py-0.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-[var(--success)] text-[10px] font-mono border border-emerald-500/20 transition-colors cursor-pointer"
                  title="Simulate incoming lead"
                >
                  + Lead
                </button>
                <button
                  type="button"
                  onClick={() => simulateEvent('message')}
                  className="px-2 py-0.5 rounded-md bg-indigo-500/10 hover:bg-indigo-500/20 text-[var(--accent-text)] text-[10px] font-mono border border-indigo-500/20 transition-colors cursor-pointer"
                  title="Simulate new message"
                >
                  + Message
                </button>
                <button
                  type="button"
                  onClick={() => simulateEvent('task')}
                  className="px-2 py-0.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-[var(--warning)] text-[10px] font-mono border border-amber-500/20 transition-colors cursor-pointer"
                  title="Simulate assigned task"
                >
                  + Task
                </button>
                <button
                  type="button"
                  onClick={() => simulateEvent('interaction')}
                  className="px-2 py-0.5 rounded-md bg-cyan-500/10 hover:bg-cyan-500/20 text-[var(--info)] text-[10px] font-mono border border-cyan-500/20 transition-colors cursor-pointer"
                  title="Simulate customer interaction"
                >
                  + Interaction
                </button>
              </div>
            </div>}

            {/* 3. Filter Segment Tabs */}
            <div className="p-2 border-b border-[var(--border)] flex items-center gap-1 bg-[var(--surface)] overflow-x-auto no-scrollbar">
              {[
                { id: 'all', label: 'All', count: notifications.length },
                { id: 'unread', label: 'Unread', count: unreadCount },
                { id: 'lead', label: 'Leads' },
                { id: 'message', label: 'Messages' },
                { id: 'task', label: 'Tasks' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer shrink-0 ${
                    activeTab === tab.id
                      ? 'bg-[var(--border)] text-[var(--text)] font-semibold'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]'
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className="ml-1 text-[9px] font-mono text-[var(--text-muted)]">({tab.count})</span>
                  )}
                </button>
              ))}
            </div>

            {/* 4. Notification List Content */}
            <div className="flex-1 overflow-y-auto max-h-[380px] divide-y divide-[var(--border)] p-1">
              {filteredNotifications.length === 0 ? (
                <div className="py-12 px-4 text-center">
                  <div className="h-10 w-10 rounded-full bg-[var(--surface-sunken)] flex items-center justify-center text-[var(--text-subtle)] mx-auto mb-2">
                    <CheckCheck className="h-5 w-5" />
                  </div>
                  <p className="text-xs text-[var(--text-muted)] font-semibold">All caught up!</p>
                  <p className="text-[11px] text-[var(--text-subtle)] mt-0.5">
                    No notifications match your current filter.
                  </p>
                </div>
              ) : (
                filteredNotifications.map((notif) => (
                  <div
                    key={notif.id}
                    onClick={() => {
                      if (!notif.read) markAsRead(notif.id);
                      if (notif.targetView) {
                        setIsOpen(false);
                        onNavigateView(notif.targetView, notif.targetId);
                      }
                    }}
                    className={`p-3 rounded-xl transition-all cursor-pointer group flex items-start gap-3 hover:bg-white/[0.04] ${
                      !notif.read ? 'bg-[var(--accent-soft)]' : ''
                    }`}
                  >
                    {/* Icon or Avatar */}
                    {notif.avatar ? (
                      <img 
                        src={notif.avatar} 
                        alt={notif.title} 
                        className="h-8 w-8 rounded-lg object-cover border border-[var(--border)] shrink-0" 
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-lg bg-[var(--surface-sunken)] border border-[var(--border)] flex items-center justify-center shrink-0">
                        {getNotificationIcon(notif.type)}
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-xs font-bold truncate ${notif.read ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>
                          {notif.title}
                        </span>
                        <span className="text-[10px] text-[var(--text-subtle)] font-mono shrink-0">
                          {notif.timestamp}
                        </span>
                      </div>

                      <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-2 leading-relaxed">
                        {notif.message}
                      </p>

                      <div className="mt-2 flex items-center justify-between">
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${getNotificationBadgeColor(notif.type)}`}>
                          {notif.channel || notif.type}
                        </span>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!notif.read && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                markAsRead(notif.id);
                              }}
                              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] text-[10px]"
                              title="Mark as read"
                            >
                              <Check className="h-3 w-3" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNotification(notif.id);
                            }}
                            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-rose-500/10 text-[10px]"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 5. Footer */}
            {notifications.length > 0 && (
              <div className="p-3 border-t border-[var(--border)] bg-white/[0.01] flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={clearAllNotifications}
                  className="text-[var(--text-subtle)] hover:text-[var(--danger)] text-[11px] transition-colors cursor-pointer"
                >
                  Clear all history
                </button>
                
                <div className="flex items-center gap-2">
                  {onOpenPreferences && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        onOpenPreferences();
                      }}
                      className="text-[var(--text-muted)] hover:text-[var(--text)] text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <SlidersHorizontal className="h-3 w-3 text-[var(--accent-text)]" />
                      <span>Preferences</span>
                    </button>
                  )}
                  {onOpenSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        onOpenSettings();
                      }}
                      className="text-[var(--text-muted)] hover:text-[var(--text)] text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <span>Settings</span>
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NotificationDropdown;
