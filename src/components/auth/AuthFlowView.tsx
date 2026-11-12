import TwoStepSignInPrompt from './TwoStepSignInPrompt';
import React, { useEffect, useState, useMemo } from 'react';
import { 
  ShieldCheck, 
  Lock, 
  Mail, 
  User, 
  Building2, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  ChevronRight, 
  KeyRound, 
  Check, 
  X,
  MessageSquare,
  Share2,
  PhoneCall,
  Globe,
  Layers,
  Zap,
  Shield
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import { SANDBOX_LOGIN_ENABLED } from '../../context/AuthContext';

export type AuthMode = 'login' | 'signup' | 'reset' | 'magic';

interface AuthFlowViewProps {
  initialMode?: AuthMode;
  onSuccess?: () => void;
  onCancel?: () => void;
  isModal?: boolean;
}

export default function AuthFlowView({
  initialMode = 'login',
  onSuccess,
  onCancel,
  isModal = false
}: AuthFlowViewProps) {
  const { 
    loginWithEmail, 
    signUpWithEmail, 
    resetPassword, 
    loginWithGoogle, 
    loginAsDemo,
    requestMagicLink,
    authError, 
    clearAuthError,
    isLoading 
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  
  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [selectedRole, setSelectedRole] = useState('Executive Director');
  const [rememberMe, setRememberMe] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(true);

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [resetSentEmail, setResetSentEmail] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Email sign-in links: whether this server can send them, and the confirmation after asking for one.
  const [magicStatus, setMagicStatus] = useState<{ enabled: boolean; reason?: string } | null>(null);
  const [magicSentMessage, setMagicSentMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/auth/magic-link/status').then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setMagicStatus(d ? { enabled: !!d.enabled, reason: d.reason } : { enabled: false }); }).catch(() => { if (live) setMagicStatus({ enabled: false }); });
    return () => { live = false; };
  }, []);

  // Dynamic Password Strength Meter
  const passwordStrength = useMemo(() => {
    if (!password) return { score: 0, label: 'Empty', color: 'bg-[var(--border)]', percent: 0 };
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    switch (score) {
      case 1:
        return { score: 1, label: 'Weak', color: 'bg-rose-500', percent: 25 };
      case 2:
        return { score: 2, label: 'Fair', color: 'bg-amber-500', percent: 50 };
      case 3:
        return { score: 3, label: 'Good', color: 'bg-blue-500', percent: 75 };
      case 4:
        return { score: 4, label: 'Strong & Secure', color: 'bg-emerald-500', percent: 100 };
      default:
        return { score: 0, label: 'Too Short', color: 'bg-rose-600', percent: 15 };
    }
  }, [password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearAuthError();

    if (!email || !email.includes('@')) {
      setLocalError('Please enter a valid business email address.');
      return;
    }

    if (mode === 'magic') {
      setIsSubmitting(true);
      try {
        setMagicSentMessage(await requestMagicLink(email));
      } catch (err: any) {
        setLocalError(err.message || 'Couldn\u2019t send a sign-in link. Try again.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (mode === 'reset') {
      setIsSubmitting(true);
      try {
        await resetPassword(email);
        setResetSentEmail(email);
      } catch (err: any) {
        setLocalError(err.message || 'Failed to send reset link.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!password || password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }

    if (mode === 'signup') {
      if (!displayName.trim()) {
        setLocalError('Please provide your full name.');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match.');
        return;
      }
      if (!termsAccepted) {
        setLocalError('Please accept the Terms of Service to continue.');
        return;
      }

      setIsSubmitting(true);
      try {
        await signUpWithEmail(email, password, displayName, companyName, selectedRole);
        if (onSuccess) onSuccess();
      } catch (err: any) {
        setLocalError(err.message || 'Sign-up failed.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Login mode
    setIsSubmitting(true);
    try {
      await loginWithEmail(email, password, rememberMe);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      // Two-step sign-in: the code prompt takes over (TwoStepSignInPrompt).
      if (err?.code !== 'mfa_required') setLocalError(err.message || 'Invalid email or password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setLocalError(null);
    clearAuthError();
    try {
      await loginWithGoogle();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'mfa_required') {
        setLocalError(err.message || 'Google sign-in could not be completed.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleDemoAccess = (role: string, name: string, demoEmail: string) => {
    loginAsDemo(role, name, demoEmail);
    if (onSuccess) onSuccess();
  };

  return (
    <div className={`min-h-screen w-full flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-[var(--app-bg)] text-[var(--text)] relative overflow-hidden select-none`}>
      <TwoStepSignInPrompt onSuccess={onSuccess} />
      {/* Background Decorative Ambient Gradients */}
      <div className="absolute top-1/4 -left-48 w-96 h-96 bg-indigo-600/15 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-48 w-96 h-96 bg-purple-600/15 rounded-full blur-[128px] pointer-events-none" />
      <div className="absolute top-0 right-1/4 w-80 h-80 bg-blue-500/10 rounded-full blur-[96px] pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl backdrop-blur-xl relative z-10 overflow-hidden">
        
        {/* LEFT COLUMN: AUTHENTICATION FORM (7 cols on lg) */}
        <div className="lg:col-span-7 p-6 sm:p-10 flex flex-col justify-between">
          <div>
            {/* Header Brand */}
            <div className="flex items-center justify-between pb-6 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-base sm:text-lg font-black tracking-tight text-[var(--text)] flex items-center gap-2">
                    <span>Obsidian</span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-[var(--accent-text)] border border-indigo-400/30">
                      CRM
                    </span>
                  </h1>
                  <p className="text-[11px] text-[var(--text-muted)]">Omnichannel Customer & Social Platform</p>
                </div>
              </div>

              {isModal && onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="p-2 text-[var(--text-muted)] hover:text-[var(--text)] rounded-xl hover:bg-[var(--surface-sunken)] transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            {/* Mode Selector Tabs (Sign In / Register / Reset) */}
            <div className="flex items-center gap-2 mt-6 p-1 rounded-2xl bg-[var(--surface-sunken)] border border-[var(--border)] text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setLocalError(null);
                  setResetSentEmail(null);
                }}
                className={`flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer ${
                  mode === 'login'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20 font-bold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]'
                }`}
              >
                Sign In
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setLocalError(null);
                  setResetSentEmail(null);
                }}
                className={`flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer ${
                  mode === 'signup'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20 font-bold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]'
                }`}
              >
                Create Account
              </button>

              {mode === 'reset' && (
                <button
                  type="button"
                  className="flex-1 py-2 px-3 rounded-xl bg-purple-600 text-white font-bold cursor-default"
                >
                  Password Reset
                </button>
              )}
              {mode === 'magic' && (
                <span className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 text-white font-bold text-center">
                  Email Link
                </span>
              )}
            </div>

            {/* Error Notification Alert */}
            <AnimatePresence>
              {(localError || authError) && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="mt-4 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-[var(--danger)] text-xs flex items-start gap-2.5"
                >
                  <AlertCircle className="h-4 w-4 text-[var(--danger)] shrink-0 mt-0.5" />
                  <div className="flex-1 leading-relaxed">
                    {localError || authError}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setLocalError(null);
                      clearAuthError();
                    }}
                    className="text-[var(--danger)] hover:text-[var(--danger)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* SIGN-IN LINK CONFIRMATION SCREEN */}
            {mode === 'magic' && magicSentMessage ? (
              <div className="py-8 text-center space-y-4" role="status" aria-live="polite">
                <div className="h-16 w-16 rounded-2xl bg-[var(--success-soft)] border border-[var(--border)] text-[var(--success)] flex items-center justify-center mx-auto">
                  <Mail className="h-8 w-8" />
                </div>
                <div className="space-y-1.5 max-w-sm mx-auto">
                  <h3 className="text-base font-bold text-[var(--text)]">Check your inbox</h3>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">{magicSentMessage}</p>
                  <p className="text-[11px] text-[var(--text-subtle)]">Open the link in this browser. If nothing arrives in a few minutes, check your spam folder or ask again.</p>
                </div>
                <div className="pt-2 flex flex-col gap-2 max-w-xs mx-auto">
                  <button type="button" onClick={() => { setMagicSentMessage(null); }} className="w-full py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-sunken)] text-[var(--text)] text-xs font-bold transition-all cursor-pointer">
                    Use a different email
                  </button>
                  <button type="button" onClick={() => { setMode('login'); setMagicSentMessage(null); }} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] underline cursor-pointer">
                    Back to sign in with a password
                  </button>
                </div>
              </div>
            ) : mode === 'reset' && resetSentEmail ? (
              <div className="py-8 text-center space-y-4">
                <div className="h-16 w-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-[var(--success)] flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/10">
                  <CheckCircle2 className="h-8 w-8" />
                </div>
                <div className="space-y-1.5 max-w-sm mx-auto">
                  <h3 className="text-base font-bold text-[var(--text)]">Password Recovery Email Dispatched</h3>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                    We sent a secure password reset link to <strong className="text-[var(--text)]">{resetSentEmail}</strong>. 
                    Please follow the instructions in the email to update your credentials.
                  </p>
                </div>
                <div className="pt-2 flex flex-col gap-2 max-w-xs mx-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setResetSentEmail(null);
                    }}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer"
                  >
                    Return to Sign In
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] underline cursor-pointer"
                  >
                    Resend Email
                  </button>
                </div>
              </div>
            ) : (
              /* PRIMARY AUTH FORM */
              <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                {/* SIGN UP ONLY: Full Name & Company */}
                {mode === 'signup' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-[var(--text-muted)] block">Full Name</label>
                      <div className="relative">
                        <User className="h-4 w-4 text-[var(--text-subtle)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          required
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="e.g. Rene Pierrette"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-indigo-500 transition-colors"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-[var(--text-muted)] block">Company / Workspace</label>
                      <div className="relative">
                        <Building2 className="h-4 w-4 text-[var(--text-subtle)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          placeholder="e.g. Acme Studio Inc."
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-indigo-500 transition-colors"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Email Address */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-[var(--text-muted)] block">Work Email Address</label>
                  <div className="relative">
                    <Mail className="h-4 w-4 text-[var(--text-subtle)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-indigo-500 transition-colors font-mono"
                    />
                  </div>
                </div>

                {/* Password Input (Hidden for Reset and sign-in link modes) */}
                {mode !== 'reset' && mode !== 'magic' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-semibold text-[var(--text-muted)]">Password</label>
                      {mode === 'login' && (
                        <button
                          type="button"
                          onClick={() => setMode('reset')}
                          className="text-[11px] text-[var(--accent-text)] hover:text-[var(--accent-text)] hover:underline cursor-pointer"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock className="h-4 w-4 text-[var(--text-subtle)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-indigo-500 transition-colors font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="p-1 text-[var(--text-subtle)] hover:text-[var(--text-muted)] absolute right-3 top-1/2 -translate-y-1/2"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Password Strength Meter (Signup mode) */}
                    {mode === 'signup' && password.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-[var(--text-muted)]">Strength:</span>
                          <span className={`font-semibold ${
                            passwordStrength.score >= 3 ? 'text-[var(--success)]' : 'text-[var(--warning)]'
                          }`}>
                            {passwordStrength.label}
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-[var(--border)] rounded-full overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-300 ${passwordStrength.color}`}
                            style={{ width: `${passwordStrength.percent}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* SIGN UP ONLY: Confirm Password & Role */}
                {mode === 'signup' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-[var(--text-muted)] block">Confirm Password</label>
                      <div className="relative">
                        <Lock className="h-4 w-4 text-[var(--text-subtle)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••••••"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-indigo-500 transition-colors font-mono"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-semibold text-[var(--text-muted)] block">Operational Role</label>
                      <select
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text)] focus:outline-none focus:border-indigo-500"
                      >
                        <option value="Executive Director">Executive Director (Full Admin)</option>
                        <option value="VP of Enterprise Sales">VP of Enterprise Sales</option>
                        <option value="Customer Success Lead">Customer Success Lead</option>
                        <option value="Growth & Marketing Director">Growth & Marketing Director</option>
                        <option value="Solutions Architect">Solutions Architect</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2 pt-1 text-xs text-[var(--text-muted)]">
                      <input
                        type="checkbox"
                        id="terms-check"
                        checked={termsAccepted}
                        onChange={(e) => setTermsAccepted(e.target.checked)}
                        className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                      />
                      <label htmlFor="terms-check" className="cursor-pointer text-[11px]">
                        I accept the Enterprise SLA, Privacy Protocol & Security Standards
                      </label>
                    </div>
                  </>
                )}

                {/* LOGIN ONLY: Remember Me checkbox */}
                {mode === 'login' && (
                  <div className="flex items-center justify-between text-xs pt-1">
                    <label className="flex items-center gap-2 text-[var(--text-muted)] cursor-pointer text-[11px]">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-indigo-600"
                      />
                      <span>Keep my session active on this workstation</span>
                    </label>
                  </div>
                )}

                {/* PRIMARY SUBMIT BUTTON */}
                <button
                  type="submit"
                  disabled={isSubmitting || isLoading}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/25 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>{mode === 'reset' ? 'Sending Recovery Link...' : mode === 'magic' ? 'Sending Sign-In Link...' : 'Authenticating...'}</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {mode === 'login' && 'Sign In to Workspace'}
                        {mode === 'signup' && 'Create CRM Workspace'}
                        {mode === 'reset' && 'Send Password Recovery Email'}
                        {mode === 'magic' && 'Email Me a Sign-In Link'}
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>

                {mode === 'magic' && (
                  <p className="text-[11px] text-[var(--text-subtle)] leading-relaxed">We'll email you a link that signs you in once. It expires in 15 minutes.</p>
                )}

                {(mode === 'reset' || mode === 'magic') && (
                  <button
                    type="button"
                    onClick={() => setMode('login')}
                    className="w-full text-center text-xs text-[var(--text-muted)] hover:text-[var(--text)] pt-1 cursor-pointer"
                  >
                    ← Back to Sign In
                  </button>
                )}
              </form>
            )}

            {/* OR DIVIDER */}
            {mode !== 'reset' && mode !== 'magic' && (
              <>
                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-px bg-[var(--border)]" />
                  <span className="text-[10px] uppercase font-bold text-[var(--text-subtle)] tracking-wider">or sign in with</span>
                  <div className="flex-1 h-px bg-[var(--border)]" />
                </div>

                {/* EMAIL SIGN-IN LINK (passwordless) */}
                {mode === 'login' && (
                  <div className="mb-2.5">
                    <button
                      type="button"
                      id="btn-magic-link"
                      onClick={() => { setMode('magic'); setLocalError(null); setMagicSentMessage(null); }}
                      disabled={!magicStatus?.enabled || isSubmitting}
                      aria-describedby={magicStatus && !magicStatus.enabled ? 'magic-link-unavailable' : undefined}
                      className="w-full py-2.5 px-4 rounded-xl bg-[var(--surface)] hover:bg-[var(--surface-sunken)] border border-[var(--border)] text-[var(--text)] text-xs font-semibold flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Mail className="h-4 w-4 text-[var(--accent-text)]" />
                      <span>Email me a sign-in link</span>
                    </button>
                    {magicStatus && !magicStatus.enabled && (
                      <p id="magic-link-unavailable" className="mt-1 text-center text-[10.5px] text-[var(--text-subtle)]">
                        {magicStatus.reason === 'email_not_configured' ? 'Email sign-in links aren\u2019t set up on this server (email delivery isn\u2019t configured).' : 'Email sign-in links aren\u2019t available on this server.'}
                      </p>
                    )}
                  </div>
                )}

                {/* GOOGLE SIGN IN BUTTON */}
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading || isSubmitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-[var(--surface-sunken)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text)] text-xs font-semibold flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-xs active:scale-[0.99] disabled:opacity-50"
                >
                  {googleLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin text-[var(--accent-text)]" />
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                  )}
                  <span>Continue with Google OAuth</span>
                </button>

                {/* 1-CLICK DEMO LOGIN: development builds only, or VITE_ENABLE_SANDBOX_LOGIN=true (e.g. a staging preview). Never in production. */}
                {SANDBOX_LOGIN_ENABLED && (
                <div className="mt-5 p-3.5 rounded-2xl bg-[var(--accent-soft)] border border-indigo-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-[var(--accent-text)] flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                      <span>Instant Sandbox Preview</span>
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">1-click test persona</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleDemoAccess('Class-5 Executive', 'Rene Pierrette', 'sandbox-owner@example.com')}
                      className="px-2.5 py-1.5 rounded-xl bg-[var(--surface-sunken)] hover:bg-[var(--border)] border border-[var(--border)] text-left text-[11px] text-[var(--text)] transition-colors cursor-pointer"
                    >
                      <strong className="block text-[var(--text)]">Rene Pierrette</strong>
                      <span className="text-[10px] text-[var(--text-muted)]">Executive Director</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDemoAccess('VP of Enterprise Sales', 'Marcus Chen', 'sandbox-sales@example.com')}
                      className="px-2.5 py-1.5 rounded-xl bg-[var(--surface-sunken)] hover:bg-[var(--border)] border border-[var(--border)] text-left text-[11px] text-[var(--text)] transition-colors cursor-pointer"
                    >
                      <strong className="block text-[var(--text)]">Marcus Chen</strong>
                      <span className="text-[10px] text-[var(--text-muted)]">VP of Sales</span>
                    </button>
                  </div>
                </div>
                )}
              </>
            )}
          </div>

          {/* Footer Security Badges */}
          <div className="pt-6 mt-6 border-t border-[var(--border)] flex items-center justify-between text-[11px] text-[var(--text-subtle)]">
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-[var(--success)]" />
              <span>SOC-2 & GDPR Encrypted</span>
            </div>
            <span>v2.8 Enterprise Cloud</span>
          </div>
        </div>

        {/* RIGHT COLUMN: SAAS PRODUCT CAPABILITIES SHOWCASE (5 cols on lg) */}
        <div className="hidden lg:flex lg:col-span-5 bg-gradient-to-br from-[var(--surface-sunken)] to-[var(--app-bg)] p-8 border-l border-[var(--border)] flex-col justify-between relative overflow-hidden">
          {/* Subtle glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Top Feature Pill */}
          <div className="space-y-4 relative z-10">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-[var(--accent-text)] border border-indigo-400/30">
              <Zap className="h-3.5 w-3.5" />
              <span>Omnichannel Intelligence</span>
            </span>

            <h2 className="text-xl font-bold tracking-tight text-[var(--text)] leading-snug">
              Unify Client Messaging, Telephony & Social Marketing in One Desk.
            </h2>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Consolidate WhatsApp, Email, Instagram, Telephony, and Social campaigns with enterprise audit compliance and live customer sync.
            </p>

            {/* Feature Showcase Grid */}
            <div className="space-y-3 pt-3">
              {[
                {
                  icon: MessageSquare,
                  title: 'Omnichannel Inbox',
                  desc: 'Unified threaded conversations across WhatsApp, SMS & Email.'
                },
                {
                  icon: PhoneCall,
                  title: 'Integrated Softphone',
                  desc: 'WebRTC voice dialing with live consultation notes.'
                },
                {
                  icon: Share2,
                  title: 'Social Planner Hub',
                  desc: 'Multi-account scheduled publishing across 30+ networks.'
                },
                {
                  icon: ShieldCheck,
                  title: 'Session Management',
                  desc: 'Inactivity auto-lock and remote device revocation.'
                }
              ].map((feat, i) => (
                <div key={i} className="p-3 rounded-2xl bg-[var(--surface-sunken)] border border-[var(--border)] flex items-start gap-3">
                  <div className="h-8 w-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[var(--accent-text)] shrink-0">
                    <feat.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-[var(--text)]">{feat.title}</h4>
                    <p className="text-[11px] text-[var(--text-muted)]">{feat.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Security Guarantee */}
          <div className="pt-6 border-t border-[var(--border)] relative z-10">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-[var(--success)]">
                <Check className="h-4 w-4 stroke-[3]" />
              </div>
              <div>
                <span className="text-xs font-bold text-[var(--text)] block">Enterprise Data Locality</span>
                <span className="text-[10px] text-[var(--text-muted)]">Firebase Firestore Enterprise • Hardware AES-256</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
