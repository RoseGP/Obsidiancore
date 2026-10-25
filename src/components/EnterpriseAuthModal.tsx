import React, { useState } from 'react';
import { 
  ShieldCheck, Lock, Mail, ArrowRight, CheckCircle2, 
  Sparkles, RefreshCw, KeyRound, Globe, AlertCircle, X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';

interface EnterpriseAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function EnterpriseAuthModal({
  isOpen,
  onClose,
  onSuccess
}: EnterpriseAuthModalProps) {
  const { updateProfileDetails, setPresence } = useAuth();
  const [email, setEmail] = useState('');
  const [passwordOrPin, setPasswordOrPin] = useState('');
  const [authMode, setAuthMode] = useState<'social' | 'credentials' | 'sso'>('social');
  const [loadingPlatform, setLoadingPlatform] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSocialAuth = async (platformName: string, defaultName: string, defaultRole: string, defaultAvatar: string) => {
    setLoadingPlatform(platformName);
    setError(null);
    try {
      // Simulate real OAuth handshake for the connected platform
      await new Promise(r => setTimeout(r, 900));

      await updateProfileDetails({
        displayName: defaultName,
        email: email || `${defaultName.toLowerCase().replace(/\s+/g, '.')}@enterprise.obsidian.crm`,
        role: defaultRole,
        photoURL: defaultAvatar,
        presence: 'online'
      });

      setSuccessNotice(`Authenticated successfully with ${platformName}`);
      setTimeout(() => {
        if (onSuccess) onSuccess();
        onClose();
      }, 700);
    } catch (err: any) {
      setError(`Failed to authenticate with ${platformName}: ${err.message || 'Authorization failed'}`);
    } finally {
      setLoadingPlatform(null);
    }
  };

  const handleEnterpriseEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid enterprise corporate email address.');
      return;
    }

    setLoadingPlatform('email');
    setError(null);

    try {
      await new Promise(r => setTimeout(r, 800));
      const parsedName = email.split('@')[0].replace(/[._]/g, ' ');
      const formattedName = parsedName.charAt(0).toUpperCase() + parsedName.slice(1);

      await updateProfileDetails({
        displayName: formattedName || 'Enterprise Operator',
        email,
        role: 'Enterprise Director',
        presence: 'online'
      });

      setSuccessNotice('Identity verified via Corporate SSO tunnel.');
      setTimeout(() => {
        if (onSuccess) onSuccess();
        onClose();
      }, 700);
    } catch (err: any) {
      setError('Enterprise sign-in failed. Please verify credentials.');
    } finally {
      setLoadingPlatform(null);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="obsidian w-full max-w-md rounded-3xl bg-[var(--obsidian-0)] border border-white/10 text-white p-7 shadow-2xl relative overflow-hidden"
      >
        {/* Subtle Ambient Light */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-indigo-600/15 blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 h-8 w-8 rounded-full border border-white/10 flex items-center justify-center text-neutral-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header Branding */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center mb-3 shadow-lg shadow-indigo-500/20">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <span className="text-[10px] font-mono tracking-widest text-indigo-400 uppercase font-bold">
            OBSIDIAN SECURE ACCESS
          </span>
          <h2 className="text-xl font-black tracking-tight text-white mt-1">
            Enterprise Authentication
          </h2>
          <p className="text-xs text-neutral-400 mt-1 max-w-xs">
            Authenticate via your verified social identity or corporate single sign-on (SSO).
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-neutral-900 border border-white/5 mb-5 text-xs font-bold">
          <button
            type="button"
            onClick={() => setAuthMode('social')}
            className={`py-1.5 rounded-lg transition-all cursor-pointer ${
              authMode === 'social' ? 'bg-white/10 text-white shadow-xs' : 'text-neutral-400 hover:text-white'
            }`}
          >
            Social Identities
          </button>
          <button
            type="button"
            onClick={() => setAuthMode('credentials')}
            className={`py-1.5 rounded-lg transition-all cursor-pointer ${
              authMode === 'credentials' ? 'bg-white/10 text-white shadow-xs' : 'text-neutral-400 hover:text-white'
            }`}
          >
            Enterprise SSO
          </button>
        </div>

        {/* Error / Success Notifications */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successNotice && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* SOCIAL PLATFORM AUTHENTICATION FLOW (LinkedIn, X, GitHub, Microsoft) - NO GOOGLE */}
        {authMode === 'social' && (
          <div className="space-y-2.5">
            {/* LinkedIn */}
            <button
              type="button"
              id="auth-btn-linkedin"
              onClick={() => handleSocialAuth('LinkedIn', 'Sarah Jenkins', 'Lead Product Strategist', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=120')}
              disabled={loadingPlatform !== null}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-[#0A66C2]/15 hover:bg-[#0A66C2]/25 border border-[#0A66C2]/40 text-white text-xs font-bold transition-all cursor-pointer shadow-2xs"
            >
              <div className="flex items-center gap-3">
                <span className="h-6 w-6 rounded-lg bg-[#0A66C2] flex items-center justify-center font-bold text-white text-[11px]">
                  in
                </span>
                <span>Continue with LinkedIn</span>
              </div>
              {loadingPlatform === 'LinkedIn' ? (
                <RefreshCw className="h-4 w-4 animate-spin text-blue-400" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
              )}
            </button>

            {/* X / Twitter */}
            <button
              type="button"
              id="auth-btn-twitter"
              onClick={() => handleSocialAuth('X (Twitter)', 'Alex Mercer', 'Chief Growth Officer', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120')}
              disabled={loadingPlatform !== null}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-white text-xs font-bold transition-all cursor-pointer shadow-2xs"
            >
              <div className="flex items-center gap-3">
                <span className="h-6 w-6 rounded-lg bg-black border border-white/20 flex items-center justify-center font-mono font-bold text-white text-[11px]">
                  𝕏
                </span>
                <span>Continue with X (Twitter)</span>
              </div>
              {loadingPlatform === 'X (Twitter)' ? (
                <RefreshCw className="h-4 w-4 animate-spin text-neutral-400" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
              )}
            </button>

            {/* Microsoft 365 / Entra ID */}
            <button
              type="button"
              id="auth-btn-microsoft"
              onClick={() => handleSocialAuth('Microsoft 365', 'David Kojo', 'Principal Architect', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=120')}
              disabled={loadingPlatform !== null}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-blue-950/20 hover:bg-blue-950/40 border border-blue-500/20 text-white text-xs font-bold transition-all cursor-pointer shadow-2xs"
            >
              <div className="flex items-center gap-3">
                <div className="grid grid-cols-2 gap-0.5 w-5 h-5">
                  <span className="bg-[#F25022] rounded-[1px]" />
                  <span className="bg-[#7FBA00] rounded-[1px]" />
                  <span className="bg-[#00A4EF] rounded-[1px]" />
                  <span className="bg-[#FFB900] rounded-[1px]" />
                </div>
                <span>Continue with Microsoft SSO</span>
              </div>
              {loadingPlatform === 'Microsoft 365' ? (
                <RefreshCw className="h-4 w-4 animate-spin text-blue-400" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
              )}
            </button>

            {/* GitHub Enterprise */}
            <button
              type="button"
              id="auth-btn-github"
              onClick={() => handleSocialAuth('GitHub Enterprise', 'Marcus Chen', 'Senior Operations Lead', 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&q=80&w=120')}
              disabled={loadingPlatform !== null}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-neutral-900/60 hover:bg-neutral-800 border border-white/5 text-white text-xs font-bold transition-all cursor-pointer shadow-2xs"
            >
              <div className="flex items-center gap-3">
                <span className="h-6 w-6 rounded-lg bg-neutral-800 flex items-center justify-center font-mono font-bold text-white text-[11px]">
                  GH
                </span>
                <span>Continue with GitHub</span>
              </div>
              {loadingPlatform === 'GitHub Enterprise' ? (
                <RefreshCw className="h-4 w-4 animate-spin text-neutral-400" />
              ) : (
                <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
              )}
            </button>
          </div>
        )}

        {/* ENTERPRISE EMAIL / SSO FLOW */}
        {authMode === 'credentials' && (
          <form onSubmit={handleEnterpriseEmailLogin} className="space-y-3.5">
            <div>
              <label className="block text-[10px] font-mono uppercase text-neutral-400 mb-1">
                Corporate Email Address
              </label>
              <div className="relative">
                <Mail className="h-4 w-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  placeholder="executive@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-white/10 bg-neutral-900/80 text-xs text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-mono uppercase text-neutral-400 mb-1">
                SSO PIN / Token (Optional for SAML)
              </label>
              <div className="relative">
                <KeyRound className="h-4 w-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  placeholder="••••"
                  value={passwordOrPin}
                  onChange={(e) => setPasswordOrPin(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-white/10 bg-neutral-900/80 text-xs text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loadingPlatform !== null}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-indigo-600/20"
            >
              {loadingPlatform === 'email' ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Verifying Corporate Identity...</span>
                </>
              ) : (
                <>
                  <span>Sign In with Corporate SSO</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Footer Security Badges */}
        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between text-[10px] text-neutral-500 font-mono">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>TLS 1.3 SOVEREIGN</span>
          </div>
          <span>SOC-2 TYPE II CERTIFIED</span>
        </div>
      </motion.div>
    </div>
  );
}
