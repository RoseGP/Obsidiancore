/**
 * App-wide enforcement of the organization's security policy in the browser:
 * - when the server refuses a request because two-step sign-in is required or the session is too old,
 *   a banner explains it and links to Security & Access (or offers to sign out);
 * - when the organization sets "sign out after inactivity", the app signs out after that long without
 *   any keyboard, mouse or touch activity.
 * The server enforces two-step and session age on every request; this only makes it understandable.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { SECURITY_POLICY_EVENT } from '../../lib/apiAuth';
import { sapi, type PolicyResponse } from './securityApi';

export default function SecurityPolicyGuard({ onOpenSecurity }: { onOpenSecurity: () => void }) {
  const { isAuthenticated, isDemoSession, logout } = useAuth();
  const [notice, setNotice] = useState<{ code: string; message: string } | null>(null);
  const [idleMinutes, setIdleMinutes] = useState(0);
  const last = useRef(Date.now());

  useEffect(() => {
    const on = (e: Event) => setNotice((e as CustomEvent).detail || null);
    window.addEventListener(SECURITY_POLICY_EVENT, on);
    return () => window.removeEventListener(SECURITY_POLICY_EVENT, on);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || isDemoSession) { setIdleMinutes(0); return; }
    let cancelled = false;
    sapi<PolicyResponse>('/api/security/policy').then((r) => { if (!cancelled) setIdleMinutes(r.policy.idleSignOutMinutes || 0); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isAuthenticated, isDemoSession]);

  useEffect(() => {
    if (!idleMinutes) return;
    const mark = () => { last.current = Date.now(); };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, mark, { passive: true }));
    last.current = Date.now();
    const t = setInterval(() => {
      if (Date.now() - last.current >= idleMinutes * 60_000) {
        clearInterval(t);
        void logout();
      }
    }, 15_000);
    return () => { clearInterval(t); events.forEach((ev) => window.removeEventListener(ev, mark)); };
  }, [idleMinutes, logout]);

  if (!notice) return null;
  const mfa = notice.code === 'mfa_required';
  return (
    <div role="alert" className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] w-[min(640px,calc(100vw-32px))] flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-[var(--surface,#12131c)] p-4 shadow-2xl">
      <ShieldAlert className="text-amber-400 shrink-0 mt-0.5" size={18} aria-hidden="true" />
      <div className="flex-1 min-w-0 text-xs text-[var(--text,#e5e5e5)]">
        <p className="font-semibold">{mfa ? 'Two-step sign-in is required' : 'Please sign in again'}</p>
        <p className="mt-0.5 opacity-80">{notice.message}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {mfa
            ? <button type="button" onClick={() => { setNotice(null); onOpenSecurity(); }} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold">Set it up</button>
            : <button type="button" onClick={() => { setNotice(null); void logout(); }} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold">Sign out</button>}
        </div>
      </div>
      <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100"><X size={16} /></button>
    </div>
  );
}
