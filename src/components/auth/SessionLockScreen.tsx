import React, { useState } from 'react';
import { 
  Lock, 
  Unlock, 
  KeyRound, 
  LogOut, 
  ShieldCheck, 
  Eye, 
  EyeOff, 
  Sparkles, 
  AlertCircle,
  Clock,
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../context/AuthContext';

export default function SessionLockScreen() {
  const { 
    userProfile, 
    sessionSettings, 
    unlockSession, 
    logout 
  } = useAuth();

  const [pinInput, setPinInput] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const success = unlockSession(pinInput);
    if (!success) {
      setError('Incorrect security PIN. Please enter your terminal PIN or password.');
    }
  };

  const handleQuickUnlock = () => {
    unlockSession();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#08090E]/90 backdrop-blur-xl text-white select-none">
      {/* Ambient background glows */}
      <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-indigo-600/20 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-1/3 right-1/3 w-96 h-96 bg-purple-600/15 rounded-full blur-[128px] pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 15 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md bg-slate-900/95 border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl relative z-10 text-center space-y-6"
      >
        {/* Lock Icon Beacon */}
        <div className="relative inline-block">
          <img
            src={userProfile.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120'}
            alt={userProfile.displayName}
            className="h-20 w-20 rounded-3xl object-cover border-2 border-indigo-500/40 mx-auto shadow-xl"
            referrerPolicy="no-referrer"
          />
          <div className="absolute -bottom-2 -right-2 h-8 w-8 rounded-xl bg-indigo-600 border-2 border-[var(--obsidian-1)] flex items-center justify-center text-white shadow-lg">
            <Lock className="h-4 w-4" />
          </div>
        </div>

        {/* User Info */}
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-white tracking-tight">
            {userProfile.displayName || 'Enterprise Director'}
          </h2>
          <p className="text-xs text-neutral-400 font-mono">
            {userProfile.email}
          </p>
          <div className="pt-1.5 flex items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <Clock className="h-3 w-3" />
              <span>Session Locked</span>
            </span>
            <span className="text-[11px] text-neutral-400">
              {userProfile.role || 'Executive User'}
            </span>
          </div>
        </div>

        {/* Unlock Form */}
        <form onSubmit={handleUnlock} className="space-y-4 pt-1">
          <div className="space-y-1.5 text-left">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-neutral-300">Terminal PIN or Password</label>
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                {showPin ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                <span>{showPin ? 'Hide' : 'Show'}</span>
              </button>
            </div>

            <div className="relative">
              <KeyRound className="h-4 w-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPin ? 'text' : 'password'}
                autoFocus
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setError(null);
                }}
                placeholder="Enter 4-digit PIN or password"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500 text-center font-mono tracking-widest text-sm"
              />
            </div>
            <p className="text-[10px] text-neutral-500">Default PIN: {sessionSettings.terminalPin || '1337'}</p>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-center gap-2"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-2 pt-1">
            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Unlock className="h-4 w-4" />
              <span>Unlock Workspace</span>
            </button>

            <button
              type="button"
              onClick={handleQuickUnlock}
              className="w-full py-2 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              <span>Instant Quick Unlock</span>
            </button>
          </div>
        </form>

        {/* Footer: Switch User or Sign Out */}
        <div className="pt-3 border-t border-white/5 flex items-center justify-between text-xs text-neutral-400">
          <div className="flex items-center gap-1 text-[11px] text-neutral-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>Encrypted Session</span>
          </div>

          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 text-rose-400 hover:text-rose-300 text-xs font-semibold cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Switch Account / Sign Out</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
