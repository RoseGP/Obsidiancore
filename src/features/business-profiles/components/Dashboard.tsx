/** Portfolio dashboard: every profile the user can access, with status, completeness, issues and freshness. */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Building2, Download, Link2, Plus, Search } from 'lucide-react';
import type { BusinessProfileData, ProfileSummaryView } from '../domain/types';
import { emptyProfileData } from '../domain/types';
import { bpApi, type LinkableListing } from '../client/api';
import { Badge, Button, Card, EmptyState, Field, Meter, Modal, Notice, inputCls, scoreTone, timeAgo, useToast, cx } from './ui';

export function Dashboard({ profiles, loading, error, canCreate, onOpen, onCreated, onReload }: { profiles: ProfileSummaryView[]; loading: boolean; error: string | null; canCreate: boolean; onOpen: (id: string) => void; onCreated: (id: string) => void; onReload: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'attention' | 'draft' | 'active' | 'archived'>('all');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [listings, setListings] = useState<LinkableListing[] | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [importChoice, setImportChoice] = useState('');
  const [importDraft, setImportDraft] = useState<(BusinessProfileData & { _source?: unknown }) | null>(null);

  const active = profiles.filter((p) => p.status !== 'archived');
  const kpi = useMemo(() => ({
    total: active.length,
    avg: active.length ? Math.round(active.reduce((a, p) => a + p.score, 0) / active.length) : 0,
    avgComplete: active.length ? Math.round(active.reduce((a, p) => a + p.completeness, 0) / active.length) : 0,
    critical: active.reduce((a, p) => a + p.counts.fail, 0),
    stale: active.filter((p) => p.stale.length).length,
    linked: active.filter((p) => p.linked).length,
  }), [active]);

  const shown = profiles.filter((p) => (!q || `${p.name} ${p.primaryCategory} ${p.city ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    && (filter === 'all' ? p.status !== 'archived' : filter === 'attention' ? p.status !== 'archived' && (p.counts.fail > 0 || p.stale.length > 0) : p.status === filter));

  const create = async (data: BusinessProfileData, source: 'manual' | 'import') => {
    setBusy(true);
    try { const p = await bpApi.create(data, source); toast('Profile created. The first audit is ready.'); setCreating(false); setImportOpen(false); setName(''); setImportDraft(null); onCreated(p.id); }
    catch (e: any) { toast(e.message, 'danger'); } finally { setBusy(false); }
  };
  const openImport = async () => {
    setImportOpen(true); setImportErr(null); setListings(null); setImportDraft(null); setImportChoice('');
    try {
      const st = (await bpApi.integrations()).find((s) => s.provider === 'google_business_profile');
      if (!st?.connected) { setImportErr(st?.detail ?? 'Google Business Profile isn’t connected.'); return; }
      setListings((await bpApi.linkable()).filter((l) => l.selected));
    } catch (e: any) { setImportErr(e.message); }
  };
  const loadDraft = async () => { setBusy(true); setImportErr(null); try { setImportDraft(await bpApi.importDraft(importChoice)); } catch (e: any) { setImportErr(e.message); } finally { setBusy(false); } };

  return (
    <div className="px-6 py-6 max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[260px]">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Business profiles</h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-1">Keep business listings complete, consistent and current. Scores are this app’s own quality checks; they don’t guarantee search rankings.</p>
        </div>
        {canCreate && <Button icon={<Download className="h-4 w-4" />} onClick={openImport}>Import from Google</Button>}
        {canCreate && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New profile</Button>}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        {([['Active profiles', kpi.total, undefined], ['Average health', kpi.total ? kpi.avg : '—', kpi.total ? scoreTone(kpi.avg) : undefined], ['Average completeness', kpi.total ? `${kpi.avgComplete}%` : '—', undefined], ['Issues to fix', kpi.critical, kpi.critical ? 'danger' : 'success'], ['Need re-checking', kpi.stale, kpi.stale ? 'warning' : undefined], ['Linked to Google', `${kpi.linked}/${kpi.total}`, undefined]] as const).map(([label, value, tone]) => (
          <Card key={label} className="p-4">
            <div className="text-[12px] text-[var(--text-muted)]">{label}</div>
            <div className={cx('text-[22px] font-semibold tabular-nums mt-1', tone ? `text-[var(--${tone})]` : 'text-[var(--text)]')}>{value}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" aria-hidden />
          <input aria-label="Search profiles" placeholder="Search by name, category or city" className={cx(inputCls(), 'pl-9')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {(['all', 'attention', 'draft', 'active', 'archived'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cx('h-8 px-3 rounded-full text-[13px] border', filter === f ? 'bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent-text)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]')}>
            {{ all: 'All active', attention: 'Needs attention', draft: 'Drafts', active: 'Active', archived: 'Archived' }[f]}
          </button>
        ))}
      </div>

      {error && <Notice tone="danger" title="Couldn’t load profiles" action={<Button size="sm" onClick={onReload}>Retry</Button>}>{error}</Notice>}
      {loading && !profiles.length ? <div className="space-y-2" aria-busy="true">{[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-[var(--radius-card)] bg-[var(--surface-sunken)] animate-pulse" />)}</div>
        : !profiles.length && !error ? (
          <Card><EmptyState icon={<Building2 className="h-5 w-5" />} title="No business profiles yet" action={canCreate && <div className="flex gap-2 justify-center"><Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Create a profile</Button><Button icon={<Download className="h-4 w-4" />} onClick={openImport}>Import from Google</Button></div>}>
            Create a profile for each business or location you manage. You’ll get an instant audit with prioritized fixes.
          </EmptyState></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[var(--surface-sunken)] text-left text-[var(--text-muted)]">
                  <tr><th className="px-4 py-2.5 font-medium">Business</th><th className="px-4 py-2.5 font-medium w-28">Status</th><th className="px-4 py-2.5 font-medium w-40">Health</th><th className="px-4 py-2.5 font-medium w-36">Completeness</th><th className="px-4 py-2.5 font-medium">Top issue</th><th className="px-4 py-2.5 font-medium w-32">Updated</th></tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id} className="border-t border-[var(--border)] hover:bg-[var(--surface-sunken)] cursor-pointer" onClick={() => onOpen(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(p.id); }} tabIndex={0}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--text)] flex items-center gap-1.5">{p.name}{p.linked && <Link2 className="h-3.5 w-3.5 text-[var(--success)]" aria-label="Linked to Google" />}</div>
                        <div className="text-[12px] text-[var(--text-subtle)]">{[p.primaryCategory || 'No category', p.city].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-4 py-3"><Badge tone={p.status === 'active' ? 'success' : p.status === 'archived' ? 'warning' : 'neutral'}>{p.status}</Badge></td>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><span className={`tabular-nums font-semibold w-7 text-[var(--${scoreTone(p.score)})]`}>{p.score}</span><Meter value={p.score} /></div></td>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="tabular-nums w-9">{p.completeness}%</span><Meter value={p.completeness} tone="info" /></div></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {p.counts.fail > 0 && <Badge tone="danger">{p.counts.fail} to fix</Badge>}
                          {p.stale.length > 0 && <Badge tone="warning" title={p.stale.join('\n')}><AlertTriangle className="h-3 w-3" />Stale</Badge>}
                          {p.auditStale && <Badge title="Profile changed since the last recorded audit">Audit outdated</Badge>}
                          <span className="text-[var(--text-muted)] truncate max-w-[280px]">{p.topIssue ?? 'No open issues'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)]">{timeAgo(p.updatedAt)}</td>
                    </tr>
                  ))}
                  {!shown.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">No profiles match.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        )}

      <Modal open={creating} title="New business profile" onClose={() => setCreating(false)}
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => create({ ...emptyProfileData(), name }, 'manual')}>Create and audit</Button></>}>
        <Field label="Business name" htmlFor="bp-new" hint="Exactly as on signage. You’ll fill in the rest next, guided by the audit.">
          <input id="bp-new" autoFocus className={inputCls()} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) create({ ...emptyProfileData(), name }, 'manual'); }} />
        </Field>
      </Modal>

      <Modal open={importOpen} wide title="Import from Google Business Profile" onClose={() => setImportOpen(false)}
        footer={importDraft ? <><Button variant="ghost" onClick={() => setImportDraft(null)}>Back</Button><Button variant="primary" loading={busy} onClick={() => { const { _source, ...data } = importDraft; create(data as BusinessProfileData, 'import'); }}>Create profile from these details</Button></> : undefined}>
        {importErr ? <Notice tone="warning" title="Import isn’t available">{importErr}</Notice>
          : !listings ? <p className="text-[var(--text-muted)]">Checking your Google connection…</p>
            : !importDraft ? (listings.length === 0 ? <Notice tone="info">No selected Google locations. Choose locations in the Local GBP tab first.</Notice> : (
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Google location" htmlFor="bp-imp" className="flex-1 min-w-[240px]">
                  <select id="bp-imp" className={inputCls()} value={importChoice} onChange={(e) => setImportChoice(e.target.value)}>
                    <option value="">Choose…</option>{listings.map((l) => <option key={l.externalId} value={l.externalId}>{l.title}{l.address ? ` — ${l.address}` : ''}</option>)}
                  </select>
                </Field>
                <Button variant="primary" disabled={!importChoice} loading={busy} onClick={loadDraft}>Read details</Button>
              </div>
            )) : (
              <div className="space-y-3">
                <Notice tone="info">These details were read from Google’s API. Check them before creating the profile; you can edit everything afterwards. The listing is not linked automatically — link it from the profile’s Listings tab.</Notice>
                <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
                  {([['Name', importDraft.name], ['Primary category', importDraft.primaryCategory], ['Phone', importDraft.phone], ['Website', importDraft.website], ['Address', importDraft.address ? [importDraft.address.line1, importDraft.address.city, importDraft.address.postalCode].filter(Boolean).join(', ') : ''], ['Description', importDraft.description]] as const).map(([k, v]) => (
                    <div key={k} className={k === 'Description' ? 'sm:col-span-2' : ''}><dt className="text-[var(--text-subtle)]">{k}</dt><dd className="text-[var(--text)] break-words">{v || <span className="text-[var(--text-subtle)]">Not set</span>}</dd></div>
                  ))}
                </dl>
              </div>
            )}
      </Modal>
    </div>
  );
}
