/**
 * Settings → Organization & Members. Everything here is enforced on the server (/api/orgs);
 * the UI only hides actions the signed-in role can't perform.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Copy, KeyRound, Loader2, Mail, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react';

type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'SALES_REP' | 'MARKETER' | 'READ_ONLY';
interface Member { userId: string; role: Role; email: string; name: string; joinedAt: string }
interface OrgRow { id: string; name: string; role: Role; isDefault: boolean }

const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', SALES_REP: 'Sales rep', MARKETER: 'Marketer', READ_ONLY: 'Read only',
};
const ROLE_HELP: Record<Role, string> = {
  OWNER: 'Everything, including owner roles',
  ADMIN: 'Manage members, keys and settings',
  MANAGER: 'Bulk changes and deletions',
  SALES_REP: 'Create and edit records',
  MARKETER: 'Create and edit records',
  READ_ONLY: 'View only',
};

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/orgs${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export default function OrganizationSettings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [current, setCurrent] = useState<{ orgId: string; role: Role } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('SALES_REP');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [leadKey, setLeadKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const isAdmin = current?.role === 'OWNER' || current?.role === 'ADMIN';
  const isOwner = current?.role === 'OWNER';
  const orgName = orgs.find((o) => o.id === current?.orgId)?.name || 'Your organization';

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const me = await api('/me');
      setOrgs(me.organizations); setCurrent(me.current);
      setMembers((await api('/current/members')).members);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError(null); setNotice(null);
    try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) { setError('Enter a valid email address.'); return; }
    run('invite', async () => {
      const r = await api('/current/invitations', { method: 'POST', body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }) });
      setInviteLink(r.acceptUrl || r.token);
      setNotice(`Invitation created for ${inviteEmail.trim()}. No email was sent: share the link below. It works once, for 7 days.`);
      setInviteEmail('');
    });
  };

  const changeRole = (m: Member, role: Role) => run(`role-${m.userId}`, async () => {
    await api(`/current/members/${encodeURIComponent(m.userId)}`, { method: 'PATCH', body: JSON.stringify({ role }) });
    setMembers((prev) => prev.map((x) => (x.userId === m.userId ? { ...x, role } : x)));
    setNotice(`${m.name || m.email || m.userId} is now ${ROLE_LABEL[role]}.`);
  });

  const remove = (m: Member) => {
    const label = m.name || m.email || m.userId;
    if (!window.confirm(`Remove ${label} from ${orgName}? They lose access immediately.`)) return;
    run(`remove-${m.userId}`, async () => {
      await api(`/current/members/${encodeURIComponent(m.userId)}`, { method: 'DELETE' });
      setMembers((prev) => prev.filter((x) => x.userId !== m.userId));
      setNotice(`${label} was removed.`);
    });
  };

  const rotateKey = () => {
    if (!window.confirm('Create a new lead-capture key? Website forms using the current key will stop working until you update them.')) return;
    run('key', async () => { setLeadKey((await api('/current/lead-capture-key', { method: 'POST' })).key); });
  };

  const makeDefault = (orgId: string) => run(`default-${orgId}`, async () => {
    await api('/me/default', { method: 'PUT', body: JSON.stringify({ orgId }) });
    window.location.reload(); // every view reloads its data for the new organization
  });

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-neutral-400 py-10 justify-center" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading organization…</div>;
  }

  const card = 'rounded-xl border border-white/5 bg-neutral-900/30 p-5 space-y-4';
  const field = 'rounded-lg bg-neutral-950 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';
  const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="space-y-5" id="organization-settings">
      {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>}

      <section className={card} aria-labelledby="org-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="org-heading" className="flex items-center gap-2 text-base font-semibold text-white"><Building2 className="h-4 w-4 text-sky-400" />{orgName}</h3>
            <p className="text-sm text-neutral-400 mt-1">Your role: <span className="text-neutral-200">{current ? ROLE_LABEL[current.role] : '—'}</span>. Leads, deals and conversations belong to the organization and are never visible to other organizations.</p>
          </div>
          <button type="button" onClick={load} className={`${btn} text-neutral-300 hover:bg-white/5`} aria-label="Refresh"><RefreshCw className="h-4 w-4" /></button>
        </div>
        {orgs.length > 1 && (
          <div className="space-y-2">
            <p className="text-sm text-neutral-300">You belong to {orgs.length} organizations. The default one opens when you sign in.</p>
            <ul className="divide-y divide-white/5 rounded-lg border border-white/5">
              {orgs.map((o) => (
                <li key={o.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-neutral-200">{o.name} <span className="text-neutral-500">· {ROLE_LABEL[o.role]}</span></span>
                  {o.isDefault ? <span className="text-xs text-emerald-300">Default</span>
                    : <button type="button" disabled={!!busy} onClick={() => makeDefault(o.id)} className={`${btn} text-sky-300 hover:bg-sky-500/10`}>Make default</button>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className={card} aria-labelledby="members-heading">
        <h3 id="members-heading" className="flex items-center gap-2 text-base font-semibold text-white"><Users className="h-4 w-4 text-sky-400" />Members ({members.length})</h3>
        {members.length === 0 ? <p className="text-sm text-neutral-400">No members yet.</p> : (
          <ul className="divide-y divide-white/5">
            {members.map((m) => {
              const canEdit = isAdmin && (isOwner || m.role !== 'OWNER');
              return (
                <li key={m.userId} className="flex flex-col sm:flex-row sm:items-center gap-2 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{m.name || m.email || m.userId}</p>
                    <p className="text-xs text-neutral-500 truncate">{m.email || m.userId} · joined {new Date(m.joinedAt).toLocaleDateString()}</p>
                  </div>
                  {canEdit ? (
                    <select aria-label={`Role for ${m.name || m.email || m.userId}`} value={m.role} disabled={busy === `role-${m.userId}`}
                      onChange={(e) => changeRole(m, e.target.value as Role)} className={field}>
                      {(Object.keys(ROLE_LABEL) as Role[]).filter((r) => isOwner || r !== 'OWNER').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : <span className="text-sm text-neutral-300" title={ROLE_HELP[m.role]}>{ROLE_LABEL[m.role]}</span>}
                  {canEdit && (
                    <button type="button" onClick={() => remove(m)} disabled={busy === `remove-${m.userId}`} className={`${btn} text-rose-300 hover:bg-rose-500/10`} aria-label={`Remove ${m.name || m.email || m.userId}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={card} aria-labelledby="invite-heading">
        <h3 id="invite-heading" className="flex items-center gap-2 text-base font-semibold text-white"><UserPlus className="h-4 w-4 text-sky-400" />Invite someone</h3>
        {!isAdmin ? <p className="text-sm text-neutral-400">Only owners and admins can invite people. Ask one of them to add you or a teammate.</p> : (
          <>
            <form onSubmit={invite} className="flex flex-col sm:flex-row gap-2" noValidate>
              <label className="sr-only" htmlFor="invite-email">Email address</label>
              <input id="invite-email" type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@company.com" className={`${field} flex-1`} />
              <label className="sr-only" htmlFor="invite-role">Role</label>
              <select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} className={field}>
                {(Object.keys(ROLE_LABEL) as Role[]).filter((r) => isOwner || r !== 'OWNER').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}: {ROLE_HELP[r]}</option>)}
              </select>
              <button type="submit" disabled={busy === 'invite' || !inviteEmail.trim()} className={`${btn} bg-sky-600 text-white hover:bg-sky-500`}>
                {busy === 'invite' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Create invite link
              </button>
            </form>
            <p className="text-xs text-neutral-500">The person must sign in with this exact email address, and it must be verified.</p>
            {inviteLink && (
              <div className="flex gap-2">
                <input readOnly value={inviteLink} aria-label="Invitation link" className={`${field} flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" onClick={async () => setNotice((await copy(inviteLink)) ? 'Link copied.' : 'Copy failed: select the link and copy it manually.')} className={`${btn} text-sky-300 hover:bg-sky-500/10`}><Copy className="h-4 w-4" />Copy</button>
              </div>
            )}
          </>
        )}
      </section>

      <section className={card} aria-labelledby="leadkey-heading">
        <h3 id="leadkey-heading" className="flex items-center gap-2 text-base font-semibold text-white"><KeyRound className="h-4 w-4 text-sky-400" />Website lead form</h3>
        <p className="text-sm text-neutral-400">Website forms send leads to <code className="text-neutral-300">POST /api/leads/capture</code> with the header <code className="text-neutral-300">X-Lead-Capture-Key</code>. The key decides which organization receives the lead.</p>
        {!isAdmin ? <p className="text-sm text-neutral-400">Only owners and admins can create the key.</p> : (
          <>
            <button type="button" onClick={rotateKey} disabled={busy === 'key'} className={`${btn} bg-neutral-800 text-white hover:bg-neutral-700`}>
              {busy === 'key' ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Create new key
            </button>
            {leadKey && (
              <div className="space-y-1">
                <div className="flex gap-2">
                  <input readOnly value={leadKey} aria-label="Lead-capture key" className={`${field} flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" onClick={async () => setNotice((await copy(leadKey)) ? 'Key copied.' : 'Copy failed: select the key and copy it manually.')} className={`${btn} text-sky-300 hover:bg-sky-500/10`}><Copy className="h-4 w-4" />Copy</button>
                </div>
                <p className="text-xs text-amber-300">Copy it now: it won’t be shown again. Any previous key has stopped working.</p>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** Mount once in the signed-in app: accepts ?invite=<token> links, then removes the token from the URL. */
export function InvitationAcceptor({ onResult }: { onResult: (message: string) => void }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('invite');
    if (!token) return;
    url.searchParams.delete('invite');
    window.history.replaceState(null, '', url.toString()); // don't leave the token in history
    fetch('/api/orgs/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          onResult('You joined the organization. Switch to it in Settings → Organization & Members.');
        } else {
          onResult(data.error || 'This invitation couldn’t be accepted.');
        }
      })
      .catch(() => onResult('Couldn’t reach the server to accept the invitation. Open the link again.'));
  }, [onResult]);
  return null;
}
