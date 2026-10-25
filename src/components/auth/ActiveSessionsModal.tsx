import React, { useState } from 'react';
import { 
  Laptop, 
  Smartphone, 
  ShieldCheck, 
  Lock, 
  Trash2, 
  RefreshCw, 
  Check, 
  X, 
  Clock, 
  Globe, 
  AlertTriangle,
  KeyRound,
  Eye,
  EyeOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../context/AuthContext';

interface ActiveSessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast?: (msg: string) => void;
}

export default function ActiveSessionsModal({
  isOpen,
  onClose,
  onShowToast
}: ActiveSessionsModalProps) {
  const { 
    userProfile, 
    sessionSettings, 
    updateSessionSettings, 
    activeSessions, 
    terminateSession, 
    terminateAllOtherSessions,
    lockSession 
  } = useAuth();

  const [pin, setPin] = useState(sessionSettings.terminalPin || '1337');
  const [showPin, setShowPin] = useState(false);
  const [autoLockMin, setAutoLockMin] = useState(String(sessionSettings.autoLockMinutes || 30));

  if (!isOpen) return null;

  const handleUpdateTimeout = (val: string) => {
    const mins = parseInt(val, 10);
    setAutoLockMin(val);
    updateSessionSettings({ autoLockMinutes: mins });
    if (onShowToast) {
      onShowToast(`Session auto-lock set to ${mins === 0 ? 'Never' : `${mins} minutes`}.`);
    }
  };

  const handleSavePin = () => {
    if (pin.length < 4) {
      if (onShowToast) onShowToast('PIN code must be at least 4 digits.');
      return;
    }
    updateSessionSettings({ terminalPin: pin });
    if (onShowToast) onShowToast(`Terminal quick-lock PIN updated.`);
  };

  const handleRevoke = (id: string, deviceName: string) => {
    terminateSession(id);
    if (onShowToast) onShowToast(`Session revoked for ${deviceName}.`);
  };

  const handleRevokeAll = () => {
    terminateAllOtherSessions();
    if (onShowToast) onShowToast('All other remote device sessions terminated.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-md select-none">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="obsidian w-full max-w-2xl bg-[var(--obsidian-1)] border border-white/10 rounded-3xl p-6 sm:p-7 shadow-2xl text-white relative z-10 max-h-[92vh] overflow-y-auto space-y-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Active Sessions & Device Security
              </h3>
              <p className="text-xs text-neutral-400">
                Manage authenticated workstations, session timeout rules, and quick-lock PIN
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 1. Inactivity & Auto-Lock Configuration */}
        <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-amber-400" />
                <span>Inactivity Auto-Lock Timeout</span>
              </h4>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                Automatically lock CRM console when no mouse or keyboard activity is detected
              </p>
            </div>

            <select
              value={autoLockMin}
              onChange={(e) => handleUpdateTimeout(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500 font-semibold cursor-pointer"
            >
              <option value="5">5 Minutes</option>
              <option value="15">15 Minutes</option>
              <option value="30">30 Minutes (Recommended)</option>
              <option value="60">1 Hour</option>
              <option value="0">Never (Stay Unlocked)</option>
            </select>
          </div>

          {/* Quick Lock PIN code */}
          <div className="pt-3 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-indigo-400" />
                <span>Quick-Lock PIN Code</span>
              </h4>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                Code required to resume an inactive or manually locked workspace
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-24 px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-center font-mono text-xs tracking-widest text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300 p-0.5"
                >
                  {showPin ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>

              <button
                type="button"
                onClick={handleSavePin}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white transition-colors cursor-pointer"
              >
                Save PIN
              </button>
            </div>
          </div>
        </div>

        {/* 2. Active Authenticated Devices List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
              Authenticated Devices ({activeSessions.length})
            </h4>

            {activeSessions.length > 1 && (
              <button
                type="button"
                onClick={handleRevokeAll}
                className="text-xs font-semibold text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
              >
                Terminate All Other Sessions
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {activeSessions.map((session) => (
              <div
                key={session.id}
                className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-4 ${
                  session.isCurrent
                    ? 'bg-indigo-950/20 border-indigo-500/30'
                    : 'bg-white/5 border-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                    session.isCurrent
                      ? 'bg-indigo-600/20 border border-indigo-500/30 text-indigo-400'
                      : 'bg-white/5 border border-white/10 text-neutral-400'
                  }`}>
                    {session.device.toLowerCase().includes('iphone') || session.device.toLowerCase().includes('mobile') ? (
                      <Smartphone className="h-5 w-5" />
                    ) : (
                      <Laptop className="h-5 w-5" />
                    )}
                  </div>

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h5 className="text-xs font-bold text-white truncate">{session.device}</h5>
                      {session.isCurrent ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold">
                          Current Workstation
                        </span>
                      ) : (
                        <span className="text-[10px] text-neutral-400 font-mono">
                          {session.lastActive}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-neutral-400 truncate">
                      {session.browser} • {session.ip}
                    </p>
                    <p className="text-[10px] text-neutral-500 font-mono">
                      Signed in: {session.signedInAt}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  {session.isCurrent ? (
                    <button
                      type="button"
                      onClick={() => {
                        lockSession();
                        onClose();
                      }}
                      className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-semibold text-neutral-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Lock className="h-3 w-3 text-amber-400" />
                      <span>Lock Now</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRevoke(session.id, session.device)}
                      className="px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-semibold text-rose-300 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Revoke</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Session Security Specs */}
        <div className="p-3.5 rounded-2xl bg-neutral-900/60 border border-white/5 text-[11px] text-neutral-400 space-y-1.5">
          <div className="flex items-center gap-2 font-bold text-neutral-200 text-xs">
            <Lock className="h-3.5 w-3.5 text-emerald-400" />
            <span>SaaS Session Security Protections</span>
          </div>
          <p className="leading-relaxed">
            Firebase Auth automatically rotates bearer tokens every 60 minutes. Device fingerprints and IP headers are checked on every CRM batch operation to prevent session hijacking.
          </p>
        </div>

        {/* Footer */}
        <div className="pt-2 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
}
