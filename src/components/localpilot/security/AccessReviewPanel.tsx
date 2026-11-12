/**
 * Access review: who can manage a Business Profile location, read live from Google's Account Management API
 * (owners, managers, pending invitations). Shown on demand, not stored. This is a review of profile access,
 * not a security audit of anyone's Google account (Google doesn't expose sign-in activity, 2-Step Verification
 * or password status to apps, and this app doesn't claim to check them).
 */
import React, { useState } from 'react';
import { Users, RefreshCw, ShieldAlert, Info, ExternalLink } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useOptionalLocalSeo, type AccessReview } from '../live/localSeoClient';

const ROLE: Record<string, string> = { PRIMARY_OWNER: 'Primary owner', OWNER: 'Owner', MANAGER: 'Manager', SITE_MANAGER: 'Site manager', ROLE_UNSPECIFIED: 'Unknown role' };

export function AccessReviewPanel() {
  const seo = useOptionalLocalSeo();
  const locations = seo?.locations || [];
  const [loc, setLoc] = useState('');
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; data?: AccessReview; error?: string }>({ status: 'idle' });
  const selected = loc || locations[0]?.id || '';

  const run = async () => {
    if (!seo || !selected) return;
    setState({ status: 'loading' });
    try { setState({ status: 'done', data: await seo.accessReview(selected) }); }
    catch (e: any) { setState({ status: 'error', error: e?.message || 'Couldn’t load the access list.' }); }
  };

  return (
    <section aria-labelledby="access-review-title" className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="access-review-title" className="text-sm font-semibold text-slate-900 flex items-center gap-2"><Users className="h-4 w-4 text-slate-500" />Access review</h2>
          <p className="text-xs text-slate-500 max-w-xl">Who can manage this listing on Google, read live from Google when you ask. Nothing is stored.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="access-location" className="sr-only">Location</label>
          <select id="access-location" value={selected} onChange={(e) => { setLoc(e.target.value); setState({ status: 'idle' }); }} disabled={!locations.length}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900">
            {locations.length ? locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>) : <option>No locations</option>}
          </select>
          <Button size="sm" variant="outline" onClick={run} isLoading={state.status === 'loading'} disabled={!selected} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>
            {state.status === 'done' ? 'Check again' : 'Check access'}
          </Button>
        </div>
      </div>

      <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        This is not a security audit of your Google account. Google doesn't share sign-in activity, 2-Step Verification or password status with apps;
        check those at myaccount.google.com/security.
      </p>

      {!locations.length && <p className="text-xs text-slate-500">Connect Google and choose locations to review access.</p>}
      {state.status === 'error' && <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{state.error}</p>}
      {state.status === 'done' && state.data && !state.data.available && (
        <p role="status" className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800"><ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />{'reason' in state.data ? state.data.reason : ''}</p>
      )}
      {state.status === 'done' && state.data?.available && (
        <div className="space-y-4" aria-live="polite">
          <ul className="space-y-2">
            {state.data.findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{f.title}</span>
                  <Badge size="xs" variant={f.severity === 'medium' ? 'warning' : f.severity === 'low' ? 'info' : 'success'}>{f.severity === 'info' ? 'OK' : f.severity === 'medium' ? 'Worth fixing' : 'Check'}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-600"><span className="font-medium text-slate-700">Evidence: </span>{f.evidence}</p>
                <p className="text-xs text-slate-600"><span className="font-medium text-slate-700">What to do: </span>{f.action}</p>
              </li>
            ))}
          </ul>
          <table className="w-full text-left text-xs">
            <caption className="sr-only">People with access</caption>
            <thead><tr className="text-slate-500"><th className="py-1.5 font-medium">Person or group</th><th className="py-1.5 font-medium">Role</th><th className="py-1.5 font-medium">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {state.data.admins.map((a, i) => (
                <tr key={i}><td className="py-2 text-slate-900">{a.who}</td><td className="py-2 text-slate-700">{ROLE[a.role] || a.role}</td><td className="py-2">{a.pendingInvitation ? <Badge size="xs" variant="warning">Invitation pending</Badge> : <Badge size="xs" variant="success">Active</Badge>}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-slate-500">Checked {new Date(state.data.checkedAt).toLocaleString()}. To add or remove people, use{' '}
            <a className="inline-flex items-center gap-0.5 font-semibold text-blue-600 hover:underline" href="https://business.google.com/" target="_blank" rel="noreferrer noopener">Business Profile → People and access <ExternalLink className="h-3 w-3" /></a>.
          </p>
        </div>
      )}
    </section>
  );
}
