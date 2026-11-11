/** One business profile: overview, edit, audit, AI assistant, listings, history and team. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArrowLeft, BadgeCheck, Clock, Link2, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import type { BusinessProfileData, ServiceItem, Suggestion } from '../domain/types';
import { diffProfiles, FIELD_LABELS } from '../domain/diff';
import { bpApi, ApiError, type ProfileView } from '../client/api';
import { ProfileForm, validate, type FieldErrors } from './ProfileForm';
import { AuditPanel, FindingRow } from './AuditPanel';
import { AssistantPanel } from './AssistantPanel';
import { ListingsPanel } from './ListingsPanel';
import { HistoryPanel, TeamPanel } from './HistoryTeam';
import { Badge, Button, Card, Field, Meter, Modal, Notice, ScoreRing, inputCls, timeAgo, useToast, cx } from './ui';

type Tab = 'overview' | 'edit' | 'audit' | 'assistant' | 'listings' | 'history' | 'team';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' }, { id: 'edit', label: 'Edit profile' }, { id: 'audit', label: 'Audit' }, { id: 'assistant', label: 'AI assistant' },
  { id: 'listings', label: 'Listings' }, { id: 'history', label: 'History' }, { id: 'team', label: 'Team' },
];
const FIELD_ANCHOR: Record<string, string> = { name: 'bp-name', primaryCategory: 'bp-cat', additionalCategories: 'bp-cats', description: 'bp-desc', phone: 'bp-phone', website: 'bp-web', address: 'bp-a1', hours: 'bp-hours', specialHours: 'bp-special', services: 'bp-services', attributes: 'bp-attrs', media: 'bp-media' };
const statusTone = { draft: 'neutral', active: 'success', archived: 'warning' } as const;

export function ProfileDetail({ id, aiConfigured, onBack, onDeleted, onOpenGbp, onDirtyChange }: { id: string; aiConfigured: boolean; onBack: () => void; onDeleted: () => void; onOpenGbp: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const toast = useToast();
  const [p, setP] = useState<ProfileView | null>(null);
  const [loadErr, setLoadErr] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [draft, setDraft] = useState<BusinessProfileData | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveErr, setSaveErr] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [suggestionId, setSuggestionId] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteName, setDeleteName] = useState('');

  const load = useCallback(async (keepDraft = false) => {
    try {
      const v = await bpApi.get(id); setP(v); setLoadErr(null);
      if (!keepDraft) { setDraft(structuredClone(v.data)); setErrors({}); setSaveErr(null); setSuggestionId(undefined); }
    } catch (e: any) { setLoadErr(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const changes = useMemo(() => (p && draft ? diffProfiles(p.data, draft) : []), [p, draft]);
  const dirty = changes.length > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const accept = (v: ProfileView, msg?: string) => { setP(v); if (!dirty) setDraft(structuredClone(v.data)); if (msg) toast(msg); };
  const act = async (key: string, fn: () => Promise<ProfileView>, msg: string) => {
    setBusy(key);
    try { accept(await fn(), msg); } catch (e: any) { toast(e.message, 'danger'); if (e.code === 'version_conflict') load(true); } finally { setBusy(null); }
  };

  const save = async () => {
    if (!p || !draft) return;
    const errs = validate(draft); setErrors(errs);
    if (Object.keys(errs).length) {
      toast('Fix the highlighted fields before saving.', 'danger');
      const first = Object.keys(errs)[0].split('.')[0];
      goField(first);
      return;
    }
    setSaving(true); setSaveErr(null);
    try {
      const v = await bpApi.update(p.id, p.version, draft, { suggestionId, note: note.trim() || undefined });
      setP(v); setDraft(structuredClone(v.data)); setSuggestionId(undefined); setNote('');
      toast(`Saved (version ${v.version}). The audit has been updated.`);
    } catch (e: any) {
      setSaveErr(e);
      if (e.field) setErrors({ [e.field]: e.message });
    } finally { setSaving(false); }
  };

  const goField = (field: string) => {
    setTab('edit');
    setTimeout(() => { const el = document.getElementById(FIELD_ANCHOR[field] ?? '') ?? document.getElementById(`bp-sec-${field}`); (el as HTMLElement | null)?.focus?.({ preventScroll: true }); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  };
  const applySuggestion = (s: Suggestion, edited: { text?: string; services?: ServiceItem[] }) => {
    if (!draft) return;
    if (s.kind === 'description' && edited.text) setDraft({ ...draft, description: edited.text });
    if (s.kind === 'services' && edited.services) {
      const byName = new Map(edited.services.map((x) => [x.name.toLowerCase(), x.description]));
      setDraft({ ...draft, services: draft.services.map((x) => (byName.has(x.name.toLowerCase()) ? { ...x, description: byName.get(x.name.toLowerCase()) || x.description } : x)) });
    }
    setSuggestionId(s.id); goField(s.kind === 'description' ? 'description' : 'services');
    toast('Copied into the form. Review it, then Save to keep it.', 'info');
  };

  if (loadErr) return (
    <div className="p-6 space-y-3"><Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>All profiles</Button>
      <Notice tone="danger" title={loadErr.status === 404 ? 'Profile not found' : 'Couldn’t load this profile'}>{loadErr.status === 404 ? 'It may have been deleted, or you no longer have access.' : loadErr.message}</Notice>
      {loadErr.status !== 404 && <Button onClick={() => load()}>Try again</Button>}</div>
  );
  if (!p || !draft) return <div className="p-6 space-y-3" aria-busy="true">{[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-[var(--radius-card)] bg-[var(--surface-sunken)] animate-pulse" />)}</div>;

  const a = p.liveAudit;
  const link = p.listings[0];
  return (
    <div className="min-h-full flex flex-col">
      <div className="px-6 pt-5 pb-0 border-b border-[var(--border)] bg-[var(--surface)]">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>All profiles</Button>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <ScoreRing score={a.score} size={56} label="Profile health" />
          <div className="flex-1 min-w-[220px]">
            <h1 className="text-xl font-semibold tracking-tight text-[var(--text)]">{p.data.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-muted)]">
              <Badge tone={statusTone[p.status]}>{p.status[0].toUpperCase() + p.status.slice(1)}</Badge>
              <Badge>Your role: {p.role}</Badge>
              {p.data.primaryCategory && <span>{p.data.primaryCategory}</span>}
              <span>v{p.version} · updated {timeAgo(p.updatedAt)} by {p.updatedBy}</span>
              {link ? <Badge tone="success"><Link2 className="h-3 w-3" />Linked to Google</Badge> : <Badge>No listing linked</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.permissions.edit && <Button size="sm" icon={<Clock className="h-3.5 w-3.5" />} loading={busy === 'hours'} disabled={dirty} title={dirty ? 'Save or discard your edits first' : undefined} onClick={() => act('hours', () => bpApi.review(p.id, p.version, 'hours'), 'Hours confirmed as correct.')}>Confirm hours are correct</Button>}
            {p.permissions.edit && <Button size="sm" icon={<BadgeCheck className="h-3.5 w-3.5" />} loading={busy === 'review'} disabled={dirty} onClick={() => act('review', () => bpApi.review(p.id, p.version, 'profile'), 'Marked as reviewed. Thanks for keeping it accurate.')}>Mark profile as reviewed</Button>}
            {p.permissions.edit && p.status === 'draft' && <Button size="sm" variant="primary" disabled={dirty} loading={busy === 'status'} onClick={() => act('status', () => bpApi.setStatus(p.id, p.version, 'active'), 'Profile marked active.')}>Mark active</Button>}
            {p.permissions.publish && p.status !== 'archived' && <Button size="sm" variant="ghost" icon={<Archive className="h-3.5 w-3.5" />} disabled={dirty} loading={busy === 'archive'} onClick={() => act('archive', () => bpApi.setStatus(p.id, p.version, 'archived'), 'Profile archived.')}>Archive</Button>}
            {p.permissions.publish && p.status === 'archived' && <Button size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} loading={busy === 'restore'} onClick={() => act('restore', () => bpApi.setStatus(p.id, p.version, 'active'), 'Profile restored.')}>Restore</Button>}
            {p.role === 'owner' && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { setDeleteName(''); setConfirmDelete(true); }}>Delete</Button>}
          </div>
        </div>
        <nav className="mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Profile sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cx('px-3 py-2 text-[13px] font-medium border-b-2 -mb-px whitespace-nowrap', tab === t.id ? 'border-[var(--accent)] text-[var(--text)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]')}>
              {t.label}
              {t.id === 'edit' && dirty && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--warning)] align-middle" aria-label="unsaved changes" />}
              {t.id === 'assistant' && p.suggestions.length > 0 && <span className="ml-1.5 text-[11px] text-[var(--accent-text)]">{p.suggestions.length}</span>}
              {t.id === 'audit' && a.counts.fail > 0 && <span className="ml-1.5 text-[11px] text-[var(--danger)]">{a.counts.fail}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="px-6 py-5 max-w-6xl flex-1 w-full">
        {tab === 'overview' && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              {p.stale.length > 0 && <Notice tone="warning" title="Needs attention">{p.stale.join(' · ')}</Notice>}
              {p.status === 'archived' && <Notice tone="info">This profile is archived. It stays in history but is hidden from the default dashboard order.</Notice>}
              <Card className="p-5">
                <div className="flex items-center justify-between"><h3 className="text-[15px] font-semibold text-[var(--text)]">Top actions</h3><Button size="sm" variant="ghost" onClick={() => setTab('audit')}>Full audit</Button></div>
                {a.priorities.length ? <ol className="divide-y divide-[var(--border)]">{a.priorities.slice(0, 4).map((f) => <FindingRow key={f.checkId} f={f} onFix={p.permissions.edit ? goField : undefined} />)}</ol>
                  : <p className="text-sm text-[var(--text-muted)] mt-2">No open issues.</p>}
              </Card>
              <Card className="p-5">
                <h3 className="text-[15px] font-semibold text-[var(--text)] mb-3">Key details</h3>
                <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
                  {([['Phone', p.data.phone], ['Website', p.data.website], ['Address', p.data.hideAddress ? `Hidden · serves ${p.data.serviceAreas.join(', ')}` : p.data.address ? [p.data.address.line1, p.data.address.city, p.data.address.postalCode].filter(Boolean).join(', ') : ''], ['Categories', [p.data.primaryCategory, ...p.data.additionalCategories].filter(Boolean).join(', ')], ['Services', p.data.services.map((s) => s.name).join(', ')], ['Hours confirmed', timeAgo(p.hoursVerifiedAt)], ['Last full review', p.lastReviewedAt ? `${timeAgo(p.lastReviewedAt)} by ${p.lastReviewedBy}` : 'never']] as const).map(([k, v]) => (
                    <div key={k}><dt className="text-[var(--text-subtle)]">{k}</dt><dd className="text-[var(--text)] break-words">{v || <span className="text-[var(--warning)]">Missing</span>}</dd></div>
                  ))}
                </dl>
              </Card>
            </div>
            <div className="space-y-4">
              <Card className="p-5 space-y-3">
                <h3 className="text-[15px] font-semibold text-[var(--text)]">Progress</h3>
                <div><div className="flex justify-between text-[13px] mb-1"><span>Completeness</span><span className="tabular-nums">{a.completeness}%</span></div><Meter value={a.completeness} /></div>
                <div><div className="flex justify-between text-[13px] mb-1"><span>Health</span><span className="tabular-nums">{a.score}</span></div><Meter value={a.score} /></div>
                <div><div className="flex justify-between text-[13px] mb-1"><span>Checks evaluated</span><span className="tabular-nums">{a.coverage}%</span></div><Meter value={a.coverage} tone="info" /></div>
                {p.audits[1] && <p className="text-[12px] text-[var(--text-muted)]">Since previous recorded audit: <strong className={p.audits[0].score >= p.audits[1].score ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>{p.audits[0].score - p.audits[1].score >= 0 ? '+' : ''}{p.audits[0].score - p.audits[1].score}</strong></p>}
              </Card>
              <Card className="p-5 space-y-2 text-[13px]">
                <h3 className="text-[15px] font-semibold text-[var(--text)]">Google listing</h3>
                {link ? <><p className="text-[var(--text)]">{link.title}</p><p className="text-[var(--text-muted)]">Data read {timeAgo(link.snapshotAt)}</p></> : <p className="text-[var(--text-muted)]">Not linked. Consistency checks can’t run.</p>}
                <Button size="sm" onClick={() => setTab('listings')}>Manage listings</Button>
              </Card>
              {aiConfigured && p.permissions.edit && (
                <Card className="p-5 space-y-2 text-[13px]">
                  <h3 className="text-[15px] font-semibold text-[var(--text)] flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-[var(--accent-text)]" />AI assistant</h3>
                  <p className="text-[var(--text-muted)]">Draft a description or service descriptions from this profile’s facts, then review and edit.</p>
                  <Button size="sm" onClick={() => setTab('assistant')}>{p.suggestions.length ? `Review ${p.suggestions.length} suggestion${p.suggestions.length === 1 ? '' : 's'}` : 'Open assistant'}</Button>
                </Card>
              )}
            </div>
          </div>
        )}

        {tab === 'edit' && (
          <div className="space-y-4">
            {!p.permissions.edit && <Notice tone="info">Your role ({p.role}) can view but not edit this profile.</Notice>}
            {suggestionId && <Notice tone="info" title="Contains an AI suggestion">Review the copied text carefully. It will be recorded in the history as a reviewed AI suggestion when you save.</Notice>}
            {saveErr && (
              <Notice tone="danger" title={saveErr.code === 'version_conflict' ? 'Someone else changed this profile' : 'Couldn’t save'}
                action={saveErr.code === 'version_conflict' ? <Button size="sm" onClick={() => { if (window.confirm('Reload the latest version? Your unsaved edits will be lost.')) load(); }}>Reload latest</Button> : undefined}>{saveErr.message}</Notice>
            )}
            <ProfileForm value={draft} onChange={(d) => { setDraft(d); if (Object.keys(errors).length) setErrors(validate(d)); }} errors={errors} readOnly={!p.permissions.edit} />
          </div>
        )}

        {tab === 'audit' && <AuditPanel audit={a} history={p.audits} stale={p.auditStale} canRun={p.permissions.edit} running={busy === 'audit'} onRun={() => act('audit', () => bpApi.runAudit(p.id), 'Audit recorded in history.')} onFix={goField} />}
        {tab === 'assistant' && <AssistantPanel profileId={p.id} version={p.version} aiConfigured={aiConfigured} canEdit={p.permissions.edit} pending={p.suggestions} hasServices={draft.services.length > 0} onApply={applySuggestion} onChanged={() => load(true)} />}
        {tab === 'listings' && <ListingsPanel p={p} onUpdated={(v) => accept(v)} onOpenGbp={onOpenGbp} />}
        {tab === 'history' && <HistoryPanel changes={p.changes} />}
        {tab === 'team' && <TeamPanel p={p} onUpdated={(v) => accept(v)} onLeft={onDeleted} />}
      </div>

      {dirty && p.permissions.edit && (
        <div className="sticky bottom-0 z-[60] border-t border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]" role="region" aria-label="Unsaved changes">
          <div className="max-w-6xl px-6 py-3 flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-[var(--text)] font-medium">Unsaved changes:</span>
            <span className="text-[13px] text-[var(--text-muted)] flex-1 min-w-[200px] truncate">{changes.map((c) => FIELD_LABELS[c.field] ?? c.field).join(', ')}</span>
            <input aria-label="Change note" placeholder="Note for the history (optional)" maxLength={200} className={inputCls(false, 'w-64')} value={note} onChange={(e) => setNote(e.target.value)} />
            <Button variant="ghost" onClick={() => { setDraft(structuredClone(p.data)); setErrors({}); setSaveErr(null); setSuggestionId(undefined); }}>Discard</Button>
            <Button variant="primary" icon={<Save className="h-4 w-4" />} loading={saving} onClick={save}>Save changes</Button>
          </div>
        </div>
      )}

      <Modal open={confirmDelete} title="Delete this profile?" onClose={() => setConfirmDelete(false)}
        footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" disabled={deleteName !== p.data.name} loading={busy === 'delete'} onClick={async () => { setBusy('delete'); try { await bpApi.remove(p.id, deleteName); toast('Profile deleted.'); onDeleted(); } catch (e: any) { toast(e.message, 'danger'); } finally { setBusy(null); } }}>Delete permanently</Button></>}>
        <p className="text-[var(--text-muted)]">This removes the CRM record, its audit history and change log. Linked listings on Google are <strong className="text-[var(--text)]">not</strong> changed. Consider archiving instead.</p>
        <Field label={`Type “${p.data.name}” to confirm`} htmlFor="bp-del" className="mt-4"><input id="bp-del" className={inputCls()} value={deleteName} onChange={(e) => setDeleteName(e.target.value)} autoComplete="off" /></Field>
      </Modal>
    </div>
  );
}
