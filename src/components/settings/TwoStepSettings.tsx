/**
 * Settings › Security: two-step sign-in for your own account (Firebase multi-factor, authenticator app / TOTP)
 * and, for admins, the organization's security policy (enforced on the server).
 *
 * Firebase TOTP multi-factor needs Identity Platform with TOTP enabled on the Firebase project; when it isn't,
 * enrollment fails with auth/operation-not-allowed and this screen says so instead of pretending.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { multiFactor, TotpMultiFactorGenerator, type TotpSecret } from 'firebase/auth';
import { KeyRound, ShieldCheck, ShieldAlert, Trash2 } from 'lucide-react';
import { auth as firebaseAuth } from '../../lib/firebase';
import { sapi, isAdminRole, type PolicyResponse, type SecurityPolicy } from './securityApi';

const card = 'rounded-2xl p-6 bg-neutral-900/40 border border-white/5 space-y-4';
const input = 'w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const btn = 'px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs disabled:opacity-50 disabled:cursor-not-allowed';
const ghost = 'px-4 py-2 rounded-xl border border-white/10 text-neutral-200 hover:bg-white/5 font-semibold text-xs';

function explain(err: any): string {
  switch (err?.code) {
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return 'Two-step sign-in isn’t switched on for this app’s Firebase project yet. An administrator needs to enable Identity Platform with authenticator-app (TOTP) multi-factor. See docs/compliance/SECURITY_CONTROLS.md.';
    case 'auth/requires-recent-login': return 'For your security, sign out and sign in again, then set this up within a few minutes.';
    case 'auth/unverified-email': return 'Verify your email address first (check your inbox for the verification email), then try again.';
    case 'auth/invalid-verification-code': return 'That code didn’t work. Use the newest code from your app.';
    default: return err?.message || 'That didn’t work. Try again.';
  }
}

export function TwoStepCard() {
  const user = firebaseAuth?.currentUser || null;
  const [factors, setFactors] = useState(() => (user ? multiFactor(user).enrolledFactors : []));
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const refresh = () => user && setFactors([...multiFactor(user).enrolledFactors]);

  if (!user) {
    return (
      <div className={card}>
        <h3 className="text-base font-bold text-white">Two-step sign-in</h3>
        <p className="text-xs text-neutral-400">You’re using a sandbox sign-in, which has no account to protect. Sign in with email or Google to set up two-step sign-in.</p>
      </div>
    );
  }

  const start = async () => {
    setBusy(true); setMsg(null);
    try {
      const session = await multiFactor(user).getSession();
      setSecret(await TotpMultiFactorGenerator.generateSecret(session));
    } catch (err) { setMsg({ kind: 'error', text: explain(err) }); }
    finally { setBusy(false); }
  };
  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret) return;
    setBusy(true); setMsg(null);
    try {
      await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code.replace(/\s+/g, '')), 'Authenticator app');
      setSecret(null); setCode(''); refresh();
      setMsg({ kind: 'ok', text: 'Two-step sign-in is on. Sign out and sign in again so this session counts as two-step.' });
    } catch (err) { setMsg({ kind: 'error', text: explain(err) }); }
    finally { setBusy(false); }
  };
  const remove = async (uid: string) => {
    if (!window.confirm('Turn off two-step sign-in for this account? Your organization may require it.')) return;
    setBusy(true); setMsg(null);
    try { await multiFactor(user).unenroll(uid); refresh(); setMsg({ kind: 'ok', text: 'Two-step sign-in is off for this account.' }); }
    catch (err) { setMsg({ kind: 'error', text: explain(err) }); }
    finally { setBusy(false); }
  };

  return (
    <div className={card}>
      <div className="flex items-start gap-3 border-b border-white/5 pb-3">
        {factors.length ? <ShieldCheck className="text-emerald-400 shrink-0" size={18} /> : <ShieldAlert className="text-amber-400 shrink-0" size={18} />}
        <div>
          <h3 className="text-base font-bold text-white">Two-step sign-in</h3>
          <p className="text-xs text-neutral-400 mt-0.5">After your password, you’ll also enter a code from an authenticator app (Google Authenticator, 1Password, Authy…).</p>
        </div>
      </div>
      {factors.length > 0 && (
        <ul className="space-y-2">
          {factors.map((f) => (
            <li key={f.uid} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-neutral-950/40 border border-white/5">
              <span className="text-xs text-white flex items-center gap-2"><KeyRound size={14} className="text-indigo-400" /> {f.displayName || 'Authenticator app'} <span className="text-neutral-500">added {new Date(f.enrollmentTime).toLocaleDateString()}</span></span>
              <button type="button" onClick={() => remove(f.uid)} disabled={busy} className="text-xs text-rose-300 hover:text-rose-200 flex items-center gap-1"><Trash2 size={13} /> Remove</button>
            </li>
          ))}
        </ul>
      )}
      {!factors.length && !secret && <button type="button" onClick={start} disabled={busy} className={btn}>{busy ? 'Starting…' : 'Set up authenticator app'}</button>}
      {secret && (
        <form onSubmit={finish} className="space-y-3">
          <p className="text-xs text-neutral-300">1. In your authenticator app, add an account and enter this key (or open the link on your phone):</p>
          <code className="block break-all p-3 rounded-xl bg-neutral-950/80 border border-white/10 text-sm text-emerald-300 select-all">{secret.secretKey}</code>
          <a href={secret.generateQrCodeUrl(user.email || 'account', 'Obsidian CRM')} className="text-xs text-indigo-300 underline">Open in authenticator app</a>
          <label htmlFor="enroll-code" className="block text-xs text-neutral-300">2. Enter the 6-digit code it shows:</label>
          <input id="enroll-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} className={`${input} max-w-[200px] font-mono tracking-widest`} />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6} className={btn}>{busy ? 'Checking…' : 'Turn on'}</button>
            <button type="button" onClick={() => { setSecret(null); setCode(''); }} className={ghost}>Cancel</button>
          </div>
        </form>
      )}
      {msg && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`text-xs ${msg.kind === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>{msg.text}</p>}
    </div>
  );
}

export function OrgSecurityPolicyCard() {
  const [data, setData] = useState<PolicyResponse | null>(null);
  const [draft, setDraft] = useState<SecurityPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const d = await sapi<PolicyResponse>('/api/security/policy'); setData(d); setDraft(d.policy); setError(null); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (error && !data) return <div className={card}><h3 className="text-base font-bold text-white">Organization security</h3><p className="text-xs text-rose-300">{error}</p></div>;
  if (!data || !draft) return <div className={card}><p className="text-xs text-neutral-400">Loading security settings…</p></div>;
  const admin = isAdminRole(data.me.role);

  const save = async () => {
    setBusy(true); setError(null); setSaved(null);
    try { const r = await sapi<{ policy: SecurityPolicy }>('/api/security/policy', { method: 'PUT', body: JSON.stringify(draft) }); setDraft(r.policy); setData({ ...data, policy: r.policy }); setSaved('Saved. It applies to everyone in the organization from their next request.'); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className={card}>
      <div className="border-b border-white/5 pb-3">
        <h3 className="text-base font-bold text-white">Organization security</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          {admin ? 'Rules for everyone in this organization. The server enforces them on every request.' : 'Set by your organization’s admins.'}
          {' '}This sign-in: {data.me.twoStep ? 'two-step' : 'password or Google only'}.
        </p>
      </div>
      <label className="flex items-start gap-3 text-xs text-neutral-200">
        <input type="checkbox" className="mt-0.5" disabled={!admin} checked={draft.requireMfa} onChange={(e) => setDraft({ ...draft, requireMfa: e.target.checked })} />
        <span><strong className="text-white">Require two-step sign-in</strong><br /><span className="text-neutral-400">Members who haven’t set it up can only open Settings › Security until they do. Turn it on for yourself first.</span></span>
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-neutral-300">Sign in again after (hours, 0 = never)
          <input type="number" min={0} max={2160} disabled={!admin} value={draft.maxSessionHours} onChange={(e) => setDraft({ ...draft, maxSessionHours: Number(e.target.value) })} className={`${input} mt-1.5`} />
        </label>
        <label className="text-xs text-neutral-300">Sign out after inactivity (minutes, 0 = off)
          <input type="number" min={0} max={1440} disabled={!admin} value={draft.idleSignOutMinutes} onChange={(e) => setDraft({ ...draft, idleSignOutMinutes: Number(e.target.value) })} className={`${input} mt-1.5`} />
        </label>
      </div>
      {admin && <div className="flex justify-end"><button type="button" onClick={save} disabled={busy} className={btn}>{busy ? 'Saving…' : 'Save security rules'}</button></div>}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {saved && <p role="status" className="text-xs text-emerald-300">{saved}</p>}
    </div>
  );
}
