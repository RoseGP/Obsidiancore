/**
 * /auth/magic#token=…: where an emailed sign-in link lands.
 *
 * The token is read from the URL fragment (never sent to the server by the browser), removed from the address
 * bar and history immediately, then redeemed once with POST /api/auth/magic-link/verify. Redemption needs this
 * script to run, so mail scanners that merely fetch the link don't use it up.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const MAGIC_LINK_PATH = '/auth/magic';

let taken: { value: string | null } | null = null;
/** Reads and strips the token from the current URL. Memoized: StrictMode calls state initializers twice. */
export function takeMagicLinkToken(): string | null {
  if (taken) return taken.value;
  if (typeof window === 'undefined' || window.location.pathname !== MAGIC_LINK_PATH) { taken = { value: null }; return null; }
  const token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
  window.history.replaceState(null, '', '/');
  taken = { value: token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '' };
  return taken.value;
}

export default function MagicLinkLanding({ token, onDone }: { token: string; onDone: () => void }) {
  const { signInWithMagicLink } = useAuth();
  const [state, setState] = useState<'working' | 'done' | 'error'>(token ? 'working' : 'error');
  const [error, setError] = useState<string>(token ? '' : 'This sign-in link is incomplete. Ask for a new one from the sign-in page.');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return; // StrictMode runs effects twice: redeem exactly once
    started.current = true;
    signInWithMagicLink(token)
      .then(() => { setState('done'); window.setTimeout(onDone, 600); })
      .catch((e: Error) => { setState('error'); setError(e.message || 'This sign-in link couldn’t be used. Ask for a new one.'); });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[var(--app-bg)] p-6 text-[var(--text)]">
      <div className="w-full max-w-sm rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-sm" role="status" aria-live="polite">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><ShieldCheck className="h-6 w-6" /></div>
        {state === 'working' && (<><Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--text-muted)]" /><p className="mt-3 text-sm">Signing you in…</p></>)}
        {state === 'done' && (<><CheckCircle2 className="mx-auto h-6 w-6 text-[var(--success)]" /><p className="mt-3 text-sm font-semibold">You're signed in.</p></>)}
        {state === 'error' && (
          <>
            <AlertCircle className="mx-auto h-6 w-6 text-[var(--danger)]" />
            <p className="mt-3 text-sm font-semibold">This link didn't work</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{error}</p>
            <button type="button" onClick={onDone} className="mt-5 w-full rounded-[var(--radius-control)] bg-[var(--accent)] px-4 py-2.5 text-xs font-bold text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]">Go to sign in</button>
          </>
        )}
      </div>
    </div>
  );
}
