/** Change history (who changed what, from which source) and team roles. */
import React, { useState } from 'react';
import { Bot, History, UserPlus } from 'lucide-react';
import { ROLES, type ChangeEntry, type Role } from '../domain/types';
import { FIELD_LABELS } from '../domain/diff';
import { bpApi, type ProfileView } from '../client/api';
import { Badge, Button, Card, EmptyState, Field, Notice, inputCls, timeAgo, useToast } from './ui';

const SOURCE: Record<ChangeEntry['source'], string> = { manual: 'Manual edit', ai_suggestion: 'Reviewed AI suggestion', import: 'Imported', review: 'Review', system: 'System' };

export function HistoryPanel({ changes }: { changes: ChangeEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!changes.length) return <Card><EmptyState icon={<History className="h-5 w-5" />} title="No changes yet" /></Card>;
  return (
    <Card className="p-5">
      <h3 className="text-[15px] font-semibold text-[var(--text)] mb-2">Change history</h3>
      <ol className="divide-y divide-[var(--border)]">
        {changes.map((c) => (
          <li key={c.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-[var(--text-muted)] w-28">{timeAgo(c.at)}</span>
              <Badge tone={c.source === 'ai_suggestion' ? 'accent' : 'neutral'}>{c.source === 'ai_suggestion' && <Bot className="h-3 w-3" />}{SOURCE[c.source]}</Badge>
              <span className="flex-1 min-w-[200px] text-[var(--text)]">{c.summary}</span>
              <span className="text-[var(--text-subtle)]">{c.by} · v{c.version}</span>
              {c.fields?.length ? <Button size="sm" variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>{open === c.id ? 'Hide' : 'Details'}</Button> : null}
            </div>
            {open === c.id && c.fields && (
              <table className="mt-2 w-full text-[12px]">
                <thead className="text-[var(--text-subtle)] text-left"><tr><th className="py-1 pr-3 font-medium">Field</th><th className="py-1 pr-3 font-medium">Before</th><th className="py-1 font-medium">After</th></tr></thead>
                <tbody>{c.fields.map((f) => (
                  <tr key={f.field} className="align-top border-t border-[var(--border)]">
                    <td className="py-1.5 pr-3 text-[var(--text)] whitespace-nowrap">{FIELD_LABELS[f.field] ?? f.field}</td>
                    <td className="py-1.5 pr-3 text-[var(--text-muted)] break-words">{f.before}</td>
                    <td className="py-1.5 text-[var(--text)] break-words">{f.after}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

const ROLE_HELP: Record<Role, string> = { viewer: 'Read only', editor: 'Edit, audit, AI suggestions', manager: 'Editor + link listings, publish to Google, archive', owner: 'Manager + members, delete' };

export function TeamPanel({ p, onUpdated, onLeft }: { p: ProfileView; onUpdated: (v: ProfileView) => void; onLeft: () => void }) {
  const toast = useToast();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [busy, setBusy] = useState(false);
  const change = async (u: string, r: Role | null) => {
    setBusy(true);
    try { const out = await bpApi.setMember(p.id, u, r); if ('removedSelf' in out) onLeft(); else { onUpdated(out); toast(r ? 'Access updated.' : 'Member removed.'); } }
    catch (e: any) { toast(e.message, 'danger'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="text-[15px] font-semibold text-[var(--text)]">Members</h3>
        <p className="text-[13px] text-[var(--text-muted)] mb-3">Roles are enforced by the server on every request.</p>
        <ul className="divide-y divide-[var(--border)]">
          {Object.entries(p.members).map(([u, r]) => (
            <li key={u} className="py-2.5 flex flex-wrap items-center gap-3">
              <span className="flex-1 min-w-[160px] text-sm text-[var(--text)] font-mono break-all">{u}</span>
              {p.permissions.manageMembers ? (
                <select aria-label={`Role for ${u}`} className={inputCls(false, 'w-40')} value={r} disabled={busy} onChange={(e) => change(u, e.target.value as Role)}>
                  {ROLES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                </select>
              ) : <Badge>{r}</Badge>}
              <span className="text-[12px] text-[var(--text-subtle)] w-64 hidden lg:block">{ROLE_HELP[r]}</span>
              {p.permissions.manageMembers && <Button size="sm" variant="ghost" disabled={busy} onClick={() => change(u, null)}>Remove</Button>}
            </li>
          ))}
        </ul>
      </Card>
      {p.permissions.manageMembers ? (
        <Card className="p-5">
          <h3 className="text-[15px] font-semibold text-[var(--text)] mb-3">Add a member</h3>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="User ID" htmlFor="bp-mem" className="flex-1 min-w-[220px]" hint="The teammate’s sign-in user ID (shown in their profile menu).">
              <input id="bp-mem" className={inputCls()} value={userId} maxLength={128} onChange={(e) => setUserId(e.target.value.trim())} />
            </Field>
            <Field label="Role" htmlFor="bp-role">
              <select id="bp-role" className={inputCls(false, 'w-40')} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
              </select>
            </Field>
            <Button variant="primary" icon={<UserPlus className="h-4 w-4" />} disabled={!/^[A-Za-z0-9_.@-]{1,128}$/.test(userId)} loading={busy} onClick={async () => { await change(userId, role); setUserId(''); }}>Add</Button>
          </div>
        </Card>
      ) : <Notice tone="info">Only owners can change who has access. Your role: {p.role}.</Notice>}
    </div>
  );
}
