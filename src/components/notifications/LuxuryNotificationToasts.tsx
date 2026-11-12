import React, { useState, useEffect } from 'react';
import { 
  X, ExternalLink, ArrowRight, MessageSquare, Zap, 
  Sparkles, CheckCircle2, AlertTriangle, Phone, 
  Calendar, FileText, Bell, Users, Flame, Volume2, VolumeX
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNotifications, ToastItem } from '../../context/NotificationContext';
import { ActiveView } from '../../types';

interface LuxuryNotificationToastsProps {
  onNavigateView?: (view: ActiveView, targetId?: string) => void;
}

export const LuxuryNotificationToasts: React.FC<LuxuryNotificationToastsProps> = ({ onNavigateView }) => {
  const { activeToasts, dismissToast, soundEnabled, setSoundEnabled } = useNotifications();

  return (
    <aside 
      aria-live="polite"
      aria-label="Real-time notifications"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm sm:max-w-md w-full pointer-events-none px-3 sm:px-0"
    >
      <AnimatePresence mode="popLayout">
        {activeToasts.map((toast) => (
          <ToastCard 
            key={toast.id} 
            toast={toast} 
            onDismiss={() => dismissToast(toast.id)}
            onNavigate={(view, targetId) => {
              dismissToast(toast.id);
              if (onNavigateView) onNavigateView(view, targetId);
            }}
          />
        ))}
      </AnimatePresence>
    </aside>
  );
};

interface ToastCardProps {
  toast: ToastItem;
  onDismiss: () => void;
  onNavigate: (view: ActiveView, targetId?: string) => void;
}

const ToastCard: React.FC<ToastCardProps> = ({ toast, onDismiss, onNavigate }) => {
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(100);
  const duration = toast.duration || 5500;

  useEffect(() => {
    if (isPaused) return;

    const intervalTime = 50;
    const step = (intervalTime / duration) * 100;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev <= 0) {
          clearInterval(interval);
          onDismiss();
          return 0;
        }
        return prev - step;
      });
    }, intervalTime);

    return () => clearInterval(interval);
  }, [isPaused, duration, onDismiss]);

  const getChannelBadge = () => {
    switch (toast.channel) {
      case 'whatsapp':
        return <span className="text-[10px] font-mono font-bold text-[var(--success)]">WhatsApp</span>;
      case 'email':
        return <span className="text-[10px] font-mono font-bold text-[var(--info)]">Email Inbound</span>;
      case 'instagram':
        return <span className="text-[10px] font-mono font-bold text-[var(--danger)]">Instagram</span>;
      case 'telegram':
        return <span className="text-[10px] font-mono font-bold text-[var(--info)]">Telegram</span>;
      case 'phone':
        return <span className="text-[10px] font-mono font-bold text-[var(--warning)]">Voice SIP</span>;
      default:
        return <span className="text-[10px] font-mono font-bold text-[var(--accent-text)]">Omnichannel Hub</span>;
    }
  };

  const getActionLabel = () => {
    switch (toast.type) {
      case 'lead': return 'Review Lead';
      case 'message': return 'Reply in Chat';
      case 'proposal': return 'View Proposal';
      case 'task': return 'Open Task';
      case 'meeting': return 'Join Meeting';
      default: return 'Open';
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, y: 15 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="pointer-events-auto relative overflow-hidden rounded-2xl bg-[#0B0C10]/95 backdrop-blur-2xl border border-[var(--border)] shadow-[0_20px_50px_rgba(0,0,0,0.85)] p-4 text-[var(--text)] group select-none hover:border-[var(--border)] transition-colors"
    >
      {/* Luxury Obsidian Ambient Accent Glow */}
      <div className={`absolute top-0 right-0 w-36 h-36 rounded-full blur-3xl opacity-20 pointer-events-none ${
        toast.priority === 'urgent' ? 'bg-amber-500' : (toast.type === 'lead' ? 'bg-emerald-500' : 'bg-indigo-500')
      }`} />

      {/* Header Info */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Avatar or Icon */}
          {toast.avatar ? (
            <img 
              src={toast.avatar} 
              alt={toast.title} 
              className="h-8 w-8 rounded-xl object-cover border border-[var(--border)] shrink-0 shadow-xs" 
            />
          ) : (
            <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 border border-[var(--border)] ${
              toast.priority === 'urgent' 
                ? 'bg-amber-500/15 text-[var(--warning)]' 
                : (toast.type === 'lead' ? 'bg-emerald-500/15 text-[var(--success)]' : 'bg-indigo-500/15 text-[var(--accent-text)]')
            }`}>
              {toast.type === 'lead' ? <Flame className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-[var(--text)] truncate max-w-[190px]">
                {toast.title}
              </span>
              <span className="text-[var(--text-subtle)] text-[10px]">•</span>
              {getChannelBadge()}
            </div>
            <span className="text-[10px] text-[var(--text-muted)] font-mono">
              {toast.timestamp}
            </span>
          </div>
        </div>

        {/* Dismiss Button */}
        <button
          type="button"
          onClick={onDismiss}
          className="text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded-lg hover:bg-[var(--surface-sunken)] transition-colors cursor-pointer shrink-0"
          title="Dismiss alert"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body Message */}
      <p className="text-xs text-[var(--text-muted)] mt-2.5 leading-relaxed line-clamp-2">
        {toast.message}
      </p>

      {/* Bottom Action Bar */}
      <div className="mt-3 pt-2.5 border-t border-[var(--border)] flex items-center justify-between gap-2">
        <span className="text-[10px] text-[var(--text-muted)] font-mono flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${
            toast.priority === 'urgent' ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'
          }`} />
          <span>{toast.priority === 'urgent' ? 'Urgent Alert' : 'Real-time Event'}</span>
        </span>

        {toast.targetView && (
          <button
            type="button"
            onClick={() => onNavigate(toast.targetView!, toast.targetId)}
            className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)] hover:text-[var(--accent-text)] transition-colors cursor-pointer group/btn"
          >
            <span>{getActionLabel()}</span>
            <ArrowRight className="h-3 w-3 group-hover/btn:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* Progress countdown line */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--surface-sunken)] overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-75"
          style={{ width: `${progress}%` }}
        />
      </div>
    </motion.div>
  );
};
