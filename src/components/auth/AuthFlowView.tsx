import TwoStepSignInPrompt from './TwoStepSignInPrompt';
import React, { useEffect, useState, useMemo } from 'react';
import { ShieldCheck, Lock, Mail, User, Building2, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, Sparkles, Eye, EyeOff, Loader2, X } from 'lucide-react';
import { CoreEmblem, CoreWordmark } from './CoreVisuals';
import { useAuth } from '../../context/AuthContext';
import { SANDBOX_LOGIN_ENABLED } from '../../context/AuthContext';

/**
 * Sign-in page (design: docs/design/sign-in-board): password sign-in, an email sign-in link ("Send a magic link"),
 * password reset, account creation, Google, and the two-step prompt. Always the dark Obsidian Core look.
 */
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
        return { score: 1, label: 'Weak', color: 'bg-[var(--danger)]', percent: 25 };
      case 2:
        return { score: 2, label: 'Fair', color: 'bg-[var(--warning)]', percent: 50 };
      case 3:
        return { score: 3, label: 'Good', color: 'bg-[var(--oc-cyan)]', percent: 75 };
      case 4:
        return { score: 4, label: 'Strong & Secure', color: 'bg-[var(--success)]', percent: 100 };
      default:
        return { score: 0, label: 'Too Short', color: 'bg-[var(--danger)]', percent: 15 };
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

  const go = (m: AuthMode) => { setMode(m); setLocalError(null); clearAuthError(); setResetSentEmail(null); setMagicSentMessage(null); };
  const error = localError || authError;
  const field = 'w-full h-11 rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-raised)] pl-10 pr-3.5 text-[14px] text-[var(--text)] placeholder:text-[var(--text-subtle)] transition-shadow focus:outline-none focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent-soft)]';
  const label = 'mb-1.5 block text-[12.5px] font-medium text-[var(--text-muted)]';
  const iconCls = 'pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]';
  const heading = { login: ['Welcome back', 'Sign in to your business-AI workspace.'], signup: ['Create your workspace', 'Set up Obsidian Core for your team.'], reset: ['Reset your password', 'We’ll email you a link to choose a new one.'], magic: ['Sign in with a magic link', 'We’ll email you a link that signs you in once.'] }[mode];
  const magicUnavailable = magicStatus && !magicStatus.enabled
    ? (magicStatus.reason === 'email_not_configured' ? 'Magic links aren’t set up on this server (email delivery isn’t configured).' : 'Magic links aren’t available on this server.')
    : null;

  return (
    <div className={`oc-screen oc-grid relative flex w-full flex-col ${isModal ? 'max-h-[92vh] overflow-y-auto rounded-2xl border border-[var(--border-strong)] shadow-2xl' : 'min-h-screen'}`}>
      <TwoStepSignInPrompt onSuccess={onSuccess} />

      <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-[var(--border)] px-5 sm:px-6">
        <CoreWordmark />
        {isModal && onCancel ? (
          <button type="button" onClick={onCancel} aria-label="Close" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)] cursor-pointer"><X className="h-5 w-5" /></button>
        ) : <span className="hidden sm:block text-[13px] text-[var(--text-subtle)]">Business-AI CRM</span>}
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:py-14">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex flex-col items-center gap-3.5">
            <CoreEmblem size={68} />
            <span className="text-[21px] font-semibold tracking-[-0.015em]">Obsidian Core</span>
          </div>
          <h1 className="text-center text-[28px] font-semibold tracking-[-0.025em] text-balance">{heading[0]}</h1>
          <p className="mt-2 text-center text-[14px] text-[var(--text-muted)]">{heading[1]}</p>

          {error && (
            <div role="alert" className="mt-6 flex items-start gap-2.5 rounded-[10px] border border-[var(--danger)]/30 bg-[var(--danger-soft)] p-3 text-[13px] text-[var(--danger)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1 leading-relaxed">{error}</span>
              <button type="button" aria-label="Dismiss" onClick={() => { setLocalError(null); clearAuthError(); }} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}

          {mode === 'magic' && magicSentMessage ? (
            <div className="mt-8 space-y-4 text-center" role="status" aria-live="polite">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--oc-cyan-soft)] text-[var(--oc-cyan)] ring-1 ring-[var(--oc-cyan-line)]"><Mail className="h-6 w-6" /></div>
              <div className="space-y-1.5">
                <h2 className="text-[16px] font-semibold">Check your inbox</h2>
                <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{magicSentMessage}</p>
                <p className="text-[12px] text-[var(--text-subtle)]">Open the link in this browser. If nothing arrives in a few minutes, check your spam folder or ask again.</p>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <button type="button" onClick={() => setMagicSentMessage(null)} className="h-11 w-full rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[13.5px] font-semibold hover:border-[var(--text-subtle)] cursor-pointer">Use a different email</button>
                <button type="button" onClick={() => go('login')} className="text-[13px] text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline cursor-pointer">Back to sign in with a password</button>
              </div>
            </div>
          ) : mode === 'reset' && resetSentEmail ? (
            <div className="mt-8 space-y-4 text-center" role="status" aria-live="polite">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]"><CheckCircle2 className="h-6 w-6" /></div>
              <div className="space-y-1.5">
                <h2 className="text-[16px] font-semibold">Check your inbox</h2>
                <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">We sent a password reset link to <strong className="text-[var(--text)]">{resetSentEmail}</strong>. Follow it to choose a new password.</p>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <button type="button" onClick={() => go('login')} className="h-11 w-full rounded-[10px] bg-[var(--accent)] text-[13.5px] font-semibold text-white hover:bg-[var(--accent-hover)] cursor-pointer">Back to sign in</button>
                <button type="button" onClick={handleSubmit} disabled={isSubmitting} className="text-[13px] text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline disabled:opacity-50 cursor-pointer">Send it again</button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-[18px]" noValidate>
              {mode === 'signup' && (
                <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
                  <div>
                    <label htmlFor="auth-name" className={label}>Full name</label>
                    <div className="relative"><User className={iconCls} aria-hidden="true" /><input id="auth-name" type="text" autoComplete="name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Rene Pierrette" className={field} /></div>
                  </div>
                  <div>
                    <label htmlFor="auth-company" className={label}>Company</label>
                    <div className="relative"><Building2 className={iconCls} aria-hidden="true" /><input id="auth-company" type="text" autoComplete="organization" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Studio" className={field} /></div>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className={label}>Work email</label>
                <div className="relative"><Mail className={iconCls} aria-hidden="true" /><input id="auth-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={field} /></div>
              </div>

              {mode !== 'reset' && mode !== 'magic' && (
                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="auth-password" className={label}>Password</label>
                    {mode === 'login' && <button type="button" onClick={() => go('reset')} className="text-[12.5px] font-medium text-[var(--accent-text)] hover:underline underline-offset-2 cursor-pointer">Forgot password?</button>}
                  </div>
                  <div className="relative">
                    <Lock className={iconCls} aria-hidden="true" />
                    <input id="auth-password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" className={`${field} pr-11`} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--text-subtle)] hover:text-[var(--text-muted)] cursor-pointer">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {mode === 'signup' && password.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex justify-between text-[11.5px]"><span className="text-[var(--text-muted)]">Strength</span><span className={passwordStrength.score >= 3 ? 'font-semibold text-[var(--success)]' : 'font-semibold text-[var(--warning)]'}>{passwordStrength.label}</span></div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-raised)]"><div className={`h-full transition-all duration-300 ${passwordStrength.color}`} style={{ width: `${passwordStrength.percent}%` }} /></div>
                    </div>
                  )}
                </div>
              )}

              {mode === 'signup' && (
                <>
                  <div>
                    <label htmlFor="auth-confirm" className={label}>Confirm password</label>
                    <div className="relative"><Lock className={iconCls} aria-hidden="true" /><input id="auth-confirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••••••" className={field} /></div>
                  </div>
                  <div>
                    <label htmlFor="auth-role" className={label}>Your role</label>
                    <select id="auth-role" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className={`${field} pl-3.5`}>
                      <option value="Executive Director">Executive Director (Full Admin)</option>
                      <option value="VP of Enterprise Sales">VP of Enterprise Sales</option>
                      <option value="Customer Success Lead">Customer Success Lead</option>
                      <option value="Growth & Marketing Director">Growth & Marketing Director</option>
                      <option value="Solutions Architect">Solutions Architect</option>
                    </select>
                  </div>
                  <label htmlFor="terms-check" className="flex items-start gap-2.5 text-[12.5px] text-[var(--text-muted)] cursor-pointer">
                    <input type="checkbox" id="terms-check" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 rounded accent-[var(--accent)]" />
                    <span>I accept the Terms of Service and Privacy Policy</span>
                  </label>
                </>
              )}

              {mode === 'login' && (
                <label className="flex items-center gap-2.5 text-[12.5px] text-[var(--text-muted)] cursor-pointer">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="h-4 w-4 rounded accent-[var(--accent)]" />
                  <span>Keep me signed in on this device</span>
                </label>
              )}

              <button type="submit" disabled={isSubmitting || isLoading}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-gradient-to-b from-[#9284FF] to-[#7262F3] text-[14.5px] font-semibold text-white shadow-[0_8px_24px_-10px_rgb(114_98_243/0.8),inset_0_1px_0_rgb(255_255_255/0.2)] transition-[filter] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
                {isSubmitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{mode === 'reset' ? 'Sending reset link…' : mode === 'magic' ? 'Sending magic link…' : mode === 'signup' ? 'Creating workspace…' : 'Signing in…'}</>
                ) : (
                  <>{mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create workspace' : mode === 'reset' ? 'Send reset link' : 'Send a magic link'}<ArrowRight className="h-4 w-4" aria-hidden="true" /></>
                )}
              </button>

              {mode === 'magic' && <p className="text-center text-[12.5px] text-[var(--text-subtle)]">The link signs you in once and expires in 15 minutes.</p>}
              {(mode === 'reset' || mode === 'magic') && (
                <button type="button" onClick={() => go('login')} className="mx-auto flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Back to sign in</button>
              )}
            </form>
          )}

          {mode === 'login' && (
            <>
              <div className="my-6 flex items-center gap-3 text-[12px] text-[var(--text-subtle)]"><span className="h-px flex-1 bg-[var(--border-strong)]" />or sign in without a password<span className="h-px flex-1 bg-[var(--border-strong)]" /></div>
              <button type="button" id="btn-magic-link" onClick={() => go('magic')} disabled={!magicStatus?.enabled || isSubmitting}
                aria-describedby={magicUnavailable ? 'magic-link-unavailable' : 'magic-link-hint'}
                className="flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-[var(--oc-cyan-line)] bg-[var(--oc-cyan-soft)] text-[14.5px] font-semibold text-[#C9F6FC] transition-colors hover:bg-[rgb(94_224_242/0.14)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
                <Mail className="h-[17px] w-[17px] text-[var(--oc-cyan)]" aria-hidden="true" />Send a magic link
              </button>
              {magicUnavailable
                ? <p id="magic-link-unavailable" className="mt-2.5 text-center text-[12px] text-[var(--text-subtle)]">{magicUnavailable}</p>
                : <p id="magic-link-hint" className="mt-2.5 text-center text-[12.5px] text-[var(--text-subtle)]">We’ll email you a one-time sign-in link. It expires in 15 minutes.</p>}
            </>
          )}

          {(mode === 'login' || mode === 'signup') && (
            <button type="button" onClick={handleGoogleSignIn} disabled={googleLoading || isSubmitting}
              className="mt-3 flex h-11 w-full items-center justify-center gap-2.5 rounded-[10px] border border-[var(--border-strong)] bg-[var(--surface-raised)] text-[13.5px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--text-subtle)] disabled:opacity-50 cursor-pointer">
              {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
              )}
              Continue with Google
            </button>
          )}

          {mode === 'login' && <p className="mt-6 text-center text-[13px] text-[var(--text-muted)]">New to Obsidian Core? <button type="button" onClick={() => go('signup')} className="font-medium text-[var(--accent-text)] hover:underline underline-offset-2 cursor-pointer">Create an account</button></p>}
          {mode === 'signup' && <p className="mt-6 text-center text-[13px] text-[var(--text-muted)]">Already have an account? <button type="button" onClick={() => go('login')} className="font-medium text-[var(--accent-text)] hover:underline underline-offset-2 cursor-pointer">Sign in</button></p>}

          {/* 1-click test personas: development builds only, or VITE_ENABLE_SANDBOX_LOGIN=true (e.g. a staging preview). Never in production. */}
          {SANDBOX_LOGIN_ENABLED && mode === 'login' && (
            <div className="oc-panel mt-6 p-3.5">
              <div className="mb-2 flex items-center justify-between text-[12px]">
                <span className="flex items-center gap-1.5 font-semibold text-[var(--accent-text)]"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Sandbox sign-in</span>
                <span className="text-[var(--text-subtle)]">Development only</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => handleDemoAccess('Class-5 Executive', 'Rene Pierrette', 'sandbox-owner@example.com')} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-left text-[12px] hover:border-[var(--border-strong)] cursor-pointer">
                  <strong className="block">Rene Pierrette</strong><span className="text-[11px] text-[var(--text-muted)]">Executive Director</span>
                </button>
                <button type="button" onClick={() => handleDemoAccess('VP of Enterprise Sales', 'Marcus Chen', 'sandbox-sales@example.com')} className="rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-left text-[12px] hover:border-[var(--border-strong)] cursor-pointer">
                  <strong className="block">Marcus Chen</strong><span className="text-[11px] text-[var(--text-muted)]">VP of Sales</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="flex min-h-[60px] shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-[var(--border)] px-5 py-3 text-[12.5px] text-[var(--text-subtle)] sm:px-6">
        <span className="flex items-center gap-2 text-[var(--text-muted)]"><ShieldCheck className="h-[15px] w-[15px] text-[var(--success)]" aria-hidden="true" />Secure access to your workspace</span>
        <span>Two-step verification supported</span>
      </footer>
    </div>
  );
}
