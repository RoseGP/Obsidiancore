/** Security center: connection, scopes, token expiry, verification, Google/external changes, history. */
import React from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, Link2Off, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Button, Card, PageHeader, Skeleton, fmtDateTime } from '../ui';

const VERIFY_LABEL: Record<string, [string, any]> = { verified: ['Verified', 'ok'], needs_verification: ['Needs verification', 'danger'], pending: ['Verification pending', 'warn'], ownership_conflict: ['Ownership conflict', 'danger'], suspended_or_guidelines: ['Guideline issue', 'danger'], unknown: ['Unknown', undefined] };

export default function SecurityPage() {
  const { api, go } = useGrowth();
  const q = useLoad(() => api<any>('/growth/security'), []);
  if (q.loading) return <Skeleton h={320} />;
  if (q.error) return <Alert tone="danger" title={q.error} />;
  const s = q.data;
  const head = s.status === 'ok' ? ['All looks good', 'ok', ShieldCheck] : s.status === 'attention' ? ['Needs your attention', 'warn', ShieldAlert] : s.status === 'reconnect_required' ? ['Reconnect required', 'danger', Link2Off] : ['Not connected', undefined, Link2Off];
  const Icon = head[2] as any;
  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Security center" description="What this app can see about your Google connection, permissions and profile changes." />
      <div className="g-card g-card-pad flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: `var(--g-${head[1] === 'ok' ? 'ok' : head[1] === 'warn' ? 'warn' : 'danger'}-tint)`, color: `var(--g-${head[1] === 'ok' ? 'ok' : head[1] === 'warn' ? 'warn' : 'danger'})` }}><Icon size={22} aria-hidden /></span>
        <div className="min-w-0 flex-1"><h2 className="text-[18px] font-bold">{head[0] as string}</h2><p className="g-muted text-[13px]">{s.limits}</p></div>
        {(s.status === 'reconnect_required' || s.status === 'disconnected') && <Button variant="primary" onClick={() => go('settings')}>Reconnect</Button>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><KeyRound size={16} aria-hidden />Google connection</span>}>
          {!s.connection ? <p className="g-muted text-[13.5px]">Not connected.</p> : (
            <dl className="grid grid-cols-[150px_minmax(0,1fr)] gap-y-2 text-[13.5px]">
              <dt className="g-muted">Account</dt><dd>{s.connection.email ?? '—'}</dd>
              <dt className="g-muted">Connected</dt><dd>{fmtDateTime(s.connection.connectedAt)}</dd>
              <dt className="g-muted">Status</dt><dd>{s.connection.revokedAt ? <Badge tone="danger">Access revoked {fmtDateTime(s.connection.revokedAt)}</Badge> : <Badge tone="ok">Active</Badge>}</dd>
              <dt className="g-muted">Permissions</dt><dd className="space-y-1">{s.connection.scopes.map((x: string) => <span key={x} className="g-badge mr-1">{x.replace('https://www.googleapis.com/auth/', '')}</span>)}<p className="g-faint text-[12px]">{s.connection.onlyRequiredScopes ? 'Only the permissions this app needs.' : 'Includes permissions beyond what this app needs.'}</p></dd>
              <dt className="g-muted">Access token</dt><dd>{s.connection.accessTokenExpiresAt ? `Renews automatically; current one expires ${fmtDateTime(s.connection.accessTokenExpiresAt)}` : 'Issued on next request'}</dd>
              <dt className="g-muted">Stored securely</dt><dd>{s.connection.refreshTokenStored ? 'Encrypted refresh token on the server' : 'No token stored'}</dd>
            </dl>
          )}
        </Card>
        <Card title="Locations you manage">
          {!s.locations.length ? <p className="g-muted text-[13.5px]">None selected.</p> : (
            <ul className="space-y-2">{s.locations.map((l: any) => { const v = VERIFY_LABEL[l.verification] ?? VERIFY_LABEL.unknown; return (
              <li key={l.name} className="rounded-lg px-3 py-2" style={{ background: 'var(--g-raised)' }}>
                <div className="flex flex-wrap items-center gap-2"><span className="flex-1 text-[13.5px] font-semibold">{l.title}</span><Badge tone={v[1]}>{v[0]}</Badge>{l.hasGoogleUpdated && <Badge tone="warn">Google edits to review</Badge>}{l.hasPendingEdits && <Badge>Edits in review</Badge>}</div>
                <p className="g-faint text-[12px]">Last checked {fmtDateTime(l.lastChecked)}</p>
              </li>
            ); })}</ul>
          )}
          {s.lostAccess.length > 0 && <div className="mt-3"><Alert tone="danger" title={`Access lost to ${s.lostAccess.length} location${s.lostAccess.length === 1 ? '' : 's'}`}>Your Google account can no longer manage them. If you didn’t expect this, check who manages the profile in Google.</Alert></div>}
          <div className="mt-3"><Button size="sm" onClick={() => go('settings')}>Manage locations</Button></div>
        </Card>
      </div>

      <Card title="Alerts" description="Changes made outside this app, edits Google applied, verification changes and connection problems.">
        {!s.alerts.length ? <p className="g-muted flex items-center gap-2 text-[13.5px]"><CheckCircle2 size={15} style={{ color: 'var(--g-ok)' }} aria-hidden />No alerts.</p> : (
          <ul className="space-y-2">{s.alerts.map((a: any) => <li key={a.id} className="flex gap-3 rounded-lg px-3 py-2 text-[13.5px]" style={{ background: a.severity === 'critical' ? 'var(--g-danger-tint)' : 'var(--g-warn-tint)' }}><AlertTriangle size={15} className="mt-0.5 flex-none" aria-hidden /><span className="flex-1">{a.message}</span><span className="g-faint whitespace-nowrap text-[12px]">{fmtDateTime(a.at)}</span></li>)}</ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Connection history">{!s.connectionHistory.length ? <p className="g-muted text-[13.5px]">No events.</p> : <ul className="space-y-1.5 text-[13px]">{s.connectionHistory.map((e: any, i: number) => <li key={i} className="flex gap-3"><span className="g-faint g-num w-[120px] flex-none">{fmtDateTime(e.at)}</span>{e.message}</li>)}</ul>}</Card>
        <Card title="Account activity" description="Changes requested through this app (IP addresses shortened).">
          {!s.accessHistory.length ? <p className="g-muted text-[13.5px]">No activity yet.</p> : (
            <div className="max-h-[300px] overflow-y-auto"><table className="g-table"><thead><tr><th>When</th><th>Action</th><th>From</th></tr></thead>
              <tbody>{s.accessHistory.map((a: any, i: number) => <tr key={i}><td className="g-num whitespace-nowrap">{fmtDateTime(a.at)}</td><td><code className="text-[12px]">{a.method} {a.action}</code></td><td className="g-faint text-[12px]">{a.ip}</td></tr>)}</tbody></table></div>
          )}
        </Card>
      </div>

      <Card title="How your account is protected">
        <ul className="grid gap-2 text-[13.5px] md:grid-cols-2">{s.protections.map((p: string) => <li key={p} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 flex-none" style={{ color: 'var(--g-ok)' }} aria-hidden />{p}</li>)}</ul>
      </Card>
    </div>
  );
}
