/** Settings › Roles & permissions: the server's role × module permission table (read-only). */
import React, { useEffect, useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { sapi } from './securityApi';

const ROLE_LABEL: Record<string, string> = { OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', SALES_REP: 'Sales rep', MARKETER: 'Marketer', SUPPORT_AGENT: 'Support agent', READ_ONLY: 'Read only', GUEST: 'Guest' };
const MODULE_LABEL: Record<string, string> = {
  dashboard: 'Dashboard', contacts: 'Contacts', companies: 'Companies', leads: 'Leads', deals: 'Deals', tasks: 'Tasks', communication: 'Inbox & messages',
  meetings: 'GREET meetings', calendar: 'Calendar', documents: 'Documents', reports: 'Reports', automation: 'Automation', billing: 'Invoices & billing',
  marketing: 'Marketing', settings: 'Organization settings', members: 'Members', compliance: 'Privacy & compliance', audit: 'Audit log',
};

interface Table { modules: string[]; permissions: string[]; roles: Array<{ role: string; grants: Record<string, string[]> }> }

export default function RolesPermissionsTable() {
  const [t, setT] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState('SALES_REP');
  useEffect(() => { sapi<Table>('/api/security/roles').then(setT).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="rounded-2xl p-6 bg-neutral-900/40 border border-white/5 text-xs text-rose-300">{error}</div>;
  if (!t) return <div className="rounded-2xl p-6 bg-neutral-900/40 border border-white/5 text-xs text-neutral-400">Loading roles…</div>;
  const row = t.roles.find((r) => r.role === role) || t.roles[0];

  return (
    <div className="rounded-2xl p-6 bg-neutral-900/40 border border-white/5 space-y-4">
      <div className="border-b border-white/5 pb-3">
        <h3 className="text-base font-bold text-white">Roles & permissions</h3>
        <p className="text-xs text-neutral-400 mt-0.5">What each role can do. The server checks these on every request; change someone’s role in Organization & plan.</p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Role">
        {t.roles.map((r) => (
          <button key={r.role} type="button" role="tab" aria-selected={r.role === row.role} onClick={() => setRole(r.role)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${r.role === row.role ? 'bg-indigo-600 text-white' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}`}>
            {ROLE_LABEL[r.role] || r.role}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full min-w-[560px] text-xs">
          <caption className="sr-only">Permissions for {ROLE_LABEL[row.role] || row.role}</caption>
          <thead>
            <tr className="text-left text-neutral-400">
              <th scope="col" className="py-2 pr-3 font-semibold">Area</th>
              {t.permissions.map((p) => <th key={p} scope="col" className="py-2 px-2 font-semibold capitalize text-center">{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {t.modules.map((m) => (
              <tr key={m} className="border-t border-white/5">
                <th scope="row" className="py-2 pr-3 text-left font-medium text-neutral-200">{MODULE_LABEL[m] || m}</th>
                {t.permissions.map((p) => {
                  const yes = (row.grants[m] || []).includes(p);
                  return <td key={p} className="py-2 px-2 text-center">{yes ? <Check size={14} className="inline text-emerald-400" aria-label="Allowed" /> : <Minus size={14} className="inline text-neutral-600" aria-label="Not allowed" />}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-neutral-500">Super administrators are platform operators outside any organization. Guests only see GREET meetings they’re invited to.</p>
    </div>
  );
}
