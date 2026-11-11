/**
 * Second step of signing in, for accounts with two-step sign-in (Firebase TOTP multi-factor).
 * Shown after the password or Google step succeeded; asks for the authenticator app's code.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function TwoStepSignInPrompt({ onSuccess }: { onSuccess?: () => void }) {
  const { mfaPending, completeMfaSignIn, cancelMfaSignIn } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (mfaPending) { setCode(''); setError(null); setTimeout(() => inputRef.current?.focus(), 50); } }, [mfaPending]);
  if (!mfaPending) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s+/g, ''))) { setError('Enter the 6-digit code.'); return; }
    setBusy(true); setError(null);
    try { await completeMfaSignIn(code); onSuccess?.(); }
    catch (err: any) { setError(err?.message || 'That code didn’t work.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-labelledby="two-step-title">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 space-y-4 text-neutral-100 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          <h2 id="two-step-title" className="text-base font-bold">Two-step sign-in</h2>
        </div>
        {mfaPending.factor === 'totp' ? (
          <>
            <p className="text-xs text-neutral-300">Open your authenticator app ({mfaPending.hint}) and enter the 6-digit code for this account.</p>
            <label htmlFor="two-step-code" className="block text-xs font-semibold text-neutral-300">Code</label>
            <input
              id="two-step-code" ref={inputRef} inputMode="numeric" autoComplete="one-time-code" maxLength={7}
              value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              className="w-full rounded-xl border border-white/10 bg-neutral-950/80 p-3 text-center font-mono text-lg tracking-[0.4em] text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </>
        ) : (
          <p className="text-xs text-neutral-300">This account uses a second step ({mfaPending.hint}) that this app can’t ask for yet. Ask your administrator to switch you to an authenticator app.</p>
        )}
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cancelMfaSignIn} className="px-4 py-2 rounded-xl border border-white/10 text-xs font-semibold text-neutral-300 hover:bg-white/5">Cancel</button>
          {mfaPending.factor === 'totp' && (
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Checking…' : 'Verify'}</button>
          )}
        </div>
      </form>
    </div>
  );
}
