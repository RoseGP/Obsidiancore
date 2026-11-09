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
import { auth } from '../../lib/firebase';
import { initialsAvatar } from '../messaging/avatar';

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

  const [busy, setBusy] = useState(false);
  const usesPassword = !!(auth?.currentUser?.providerData || []).some((p) => p.providerId === 'password');

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const success = await unlockSession(pinInput);
    setBusy(false);
    setPinInput('');
    if (!success) {
      setError(usesPassword ? 'That password is incorrect.' : 'You need to confirm your sign-in to unlock.');
    }
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
            src={userProfile.photoURL || initialsAvatar(userProfile.displayName || userProfile.email)}
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
            {userProfile.displayName || userProfile.email}
          </h2>
          <p className="text-xs text-neutral-400 font-mono">
            {userProfile.email}
          </p>
          <div className="pt-1.5 flex items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <Clock className="h-3 w-3" />
              <span>Screen locked</span>
            </span>
          </div>
        </div>

        {/* Unlock Form */}
        <form onSubmit={handleUnlock} className="space-y-4 pt-1">
          {usesPassword ? (
          <div className="space-y-1.5 text-left">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-neutral-300">Password</label>
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
                autoComplete="current-password"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500 text-center font-mono tracking-widest text-sm"
              />
            </div>
          </div>
          ) : (
            <p className="text-xs text-neutral-400">{auth?.currentUser ? 'Confirm it\'s you with your sign-in provider to unlock.' : 'Unlock to continue.'}</p>
          )}

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
              disabled={busy}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white text-xs font-bold transition-all shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Unlock className="h-4 w-4" />
              <span>{busy ? 'Checking…' : 'Unlock'}</span>
            </button>

          </div>
        </form>

        {/* Footer: Switch User or Sign Out */}
        <div className="pt-3 border-t border-white/5 flex items-center justify-between text-xs text-neutral-400">
          <span />

          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 text-rose-400 hover:text-rose-300 text-xs font-semibold cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
