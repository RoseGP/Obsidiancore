/** Google posts: AI generator, editor + preview, 30-day calendar, scheduling (user-approved), publishing. */
import React, { useMemo, useState } from 'react';
import { CalendarDays, Clock, ExternalLink, Image as ImageIcon, Megaphone, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import type { PlannedPost } from '../api';
import { useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, PageHeader, Skeleton, Tabs, fmtDate, fmtDateTime, useToast } from '../ui';

const KINDS = [['update', 'Business update'], ['promotion', 'Promotion'], ['offer', 'Offer'], ['event', 'Event'], ['announcement', 'Announcement'], ['seasonal', 'Seasonal promotion'], ['product', 'Product update'], ['service', 'Service highlight']] as const;
const CTA = [['NONE', 'No button'], ['LEARN_MORE', 'Learn more'], ['BOOK', 'Book'], ['ORDER', 'Order online'], ['SIGN_UP', 'Sign up'], ['CALL', 'Call now']] as const;
const STATUS_TONE: Record<string, any> = { idea: 'accent', scheduled: 'teal', publishing: 'warn', published: 'ok', failed: 'danger' };
const today = () => new Date().toISOString().slice(0, 10);

type Draft = Partial<PlannedPost> & { kind: string; summary: string; ctaType: string };

export default function PostsPage() {
  const { api, location, dash } = useGrowth();
  const toast = useToast();
  const planned = useLoad(() => api<PlannedPost[]>(`/growth/posts?location=${encodeURIComponent(location!.name)}`), [location?.name]);
  const live = useLoad(() => api<any[]>(`/posts?location=${encodeURIComponent(location!.name)}`), [location?.name]);
  const [view, setView] = useState<'calendar' | 'list' | 'google'>('calendar');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [gen, setGen] = useState<{ kind: string; details: string; busy: boolean }>({ kind: 'update', details: '', busy: false });
  const [calBusy, setCalBusy] = useState(false);
  const ai = !!dash?.aiConfigured;

  const generate = async () => {
    setGen((g) => ({ ...g, busy: true }));
    try { const p = await api<any>('/growth/posts/generate', { method: 'POST', json: { location: location!.name, kind: gen.kind, details: gen.details || undefined } }); setEditing({ ...p, date: today() }); }
    catch (e: any) { toast('danger', e.message); }
    finally { setGen((g) => ({ ...g, busy: false })); }
  };
  const calendar = async () => {
    setCalBusy(true);
    try { const r = await api<PlannedPost[]>('/growth/posts/calendar', { method: 'POST', json: { location: location!.name, startDate: today() } }); toast('ok', `${r.length} post ideas added to your calendar. Nothing is published until you schedule or publish each one.`); planned.reload(); setView('calendar'); }
    catch (e: any) { toast('danger', e.message); }
    finally { setCalBusy(false); }
  };

  const items = planned.data ?? [];
  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Posts & content calendar" description="Write Google posts with AI, plan a month ahead, and publish only what you approve."
        actions={<>
          <Button icon={<Plus size={15} />} onClick={() => setEditing({ kind: 'update', summary: '', ctaType: 'NONE', date: today() })}>Write a post</Button>
          <Button variant="primary" icon={<CalendarDays size={15} />} disabled={!ai} loading={calBusy} onClick={calendar}>Plan next 30 days</Button>
        </>} />

      <Card title={<span className="flex items-center gap-2"><Sparkles size={16} aria-hidden />Generate a post</span>} description={ai ? 'Tell the AI what to write about. You’ll review and edit before anything is published.' : 'AI isn’t configured on the server; you can still write posts yourself.'}>
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
          <Field label="Type">{(id) => <select id={id} className="g-select" value={gen.kind} onChange={(e) => setGen((g) => ({ ...g, kind: e.target.value }))}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>
          <Field label="What’s it about? (optional)">{(id) => <input id={id} className="g-input" value={gen.details} maxLength={800} onChange={(e) => setGen((g) => ({ ...g, details: e.target.value }))} placeholder="e.g. new Saturday hours from December, or 10% off cleanings for new patients in November" />}</Field>
          <Button variant="primary" disabled={!ai} loading={gen.busy} onClick={generate}>Generate</Button>
        </div>
      </Card>

      <Tabs value={view} onChange={setView} label="View" options={[{ value: 'calendar', label: 'Calendar' }, { value: 'list', label: `Planned (${items.length})` }, { value: 'google', label: 'On Google' }]} />

      {planned.loading ? <Skeleton h={300} /> : planned.error ? <Alert tone="danger" title={planned.error} /> : view === 'calendar' ? <Calendar items={items} onOpen={(p) => setEditing(p as Draft)} />
        : view === 'list' ? (
          <Card>{!items.length ? <Empty icon={<Megaphone size={20} />} title="No planned posts" body="Generate a post or plan the next 30 days." /> : (
            <ul className="space-y-2">{items.map((p) => (
              <li key={p.id}><button type="button" onClick={() => setEditing(p as Draft)} className="w-full rounded-xl p-3 text-left" style={{ background: 'var(--g-raised)', border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                <div className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge><span className="g-faint text-[12px]">{p.scheduledFor ? `Scheduled ${fmtDateTime(p.scheduledFor)}` : fmtDate(p.date)}</span><span className="g-faint text-[12px]">{KINDS.find((k) => k[0] === p.kind)?.[1]}</span></div>
                <p className="mt-1 line-clamp-2 text-[13.5px]">{p.title ? <strong>{p.title}. </strong> : null}{p.summary}</p>
                {p.error && <p className="mt-1 text-[12px]" style={{ color: 'var(--g-danger)' }}>{p.error}</p>}
              </button></li>
            ))}</ul>
          )}</Card>
        ) : (
          <Card title="Live on Google">{live.loading ? <Skeleton h={160} /> : live.error ? <Alert tone="warn" title={live.error} /> : !(live.data ?? []).length ? <Empty title="No posts on Google yet" /> : (
            <ul className="space-y-2">{live.data!.map((p: any) => (
              <li key={p.id} className="rounded-xl p-3" style={{ background: 'var(--g-raised)' }}>
                <div className="flex flex-wrap items-center gap-2"><Badge tone="ok">{String(p.state).toLowerCase()}</Badge><span className="g-faint text-[12px]">{fmtDate(p.createTime)} · {String(p.topicType).toLowerCase()}</span>{p.searchUrl && <a className="text-[12px]" href={p.searchUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--g-accent)' }}>View <ExternalLink size={11} className="inline" aria-hidden /></a>}</div>
                <p className="mt-1 text-[13.5px]">{p.summary}</p>
              </li>
            ))}</ul>
          )}</Card>
        )}

      {editing && <Editor draft={editing} onClose={() => setEditing(null)} onSaved={() => { planned.reload(); live.reload(); }} />}
    </div>
  );
}

function Calendar({ items, onOpen }: { items: PlannedPost[]; onOpen: (p: PlannedPost) => void }) {
  const days = useMemo(() => Array.from({ length: 35 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay() + i); return d; }), []);
  const byDay = new Map<string, PlannedPost[]>();
  for (const p of items) { const k = (p.scheduledFor ?? p.date).slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), p]); }
  const t = today();
  return (
    <div className="g-card overflow-x-auto p-3">
      <div className="grid min-w-[700px] grid-cols-7 gap-1.5">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="g-faint px-1 text-[11.5px] font-semibold uppercase">{d}</div>)}
        {days.map((d) => {
          const k = d.toISOString().slice(0, 10);
          const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const ps = byDay.get(local) ?? byDay.get(k) ?? [];
          return (
            <div key={k} className="min-h-[92px] rounded-lg p-1.5" style={{ background: local === t ? 'var(--g-accent-tint)' : 'var(--g-raised)', opacity: local < t ? 0.6 : 1 }}>
              <div className="g-num g-faint mb-1 text-[11.5px] font-semibold">{d.getDate()}</div>
              <div className="space-y-1">{ps.map((p) => (
                <button key={p.id} type="button" onClick={() => onOpen(p)} className="block w-full truncate rounded-md px-1.5 py-1 text-left text-[11.5px]" title={p.summary}
                  style={{ border: 0, cursor: 'pointer', font: 'inherit', background: p.status === 'published' ? 'var(--g-ok-tint)' : p.status === 'scheduled' ? 'var(--g-teal-tint)' : p.status === 'failed' ? 'var(--g-danger-tint)' : 'var(--g-surface)', color: 'var(--g-text)' }}>
                  {p.status === 'scheduled' && <Clock size={10} className="mr-1 inline" aria-hidden />}{p.title || p.summary}
                </button>
              ))}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Editor({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const { api, location } = useGrowth();
  const toast = useToast();
  const [p, setP] = useState<Draft>({ ...draft, topicType: draft.topicType ?? (draft.kind === 'offer' ? 'OFFER' : draft.kind === 'event' ? 'EVENT' : 'STANDARD') });
  const [when, setWhen] = useState(() => (p.scheduledFor ? p.scheduledFor.slice(0, 16) : ''));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const locked = p.status === 'published' || p.status === 'publishing';
  const needsDates = p.topicType !== 'STANDARD';
  const valid = p.summary.trim().length >= 1 && (!needsDates || (p.title && p.startDate && p.endDate)) && (p.ctaType === 'NONE' || p.ctaType === 'CALL' || /^https:\/\//.test(p.ctaUrl ?? ''));
  const set = (k: keyof Draft, v: any) => setP((x) => ({ ...x, [k]: v }));

  const save = async (): Promise<PlannedPost> => api<PlannedPost>('/growth/posts', { method: 'PUT', json: {
    ...(p.id ? { id: p.id } : {}), location: location!.name, kind: p.kind, topicType: p.topicType, summary: p.summary.trim(), ctaType: p.ctaType,
    ...(p.title ? { title: p.title.trim() } : {}), ...(p.ctaUrl ? { ctaUrl: p.ctaUrl.trim() } : {}), ...(p.imageIdea ? { imageIdea: p.imageIdea } : {}),
    ...(p.startDate ? { startDate: p.startDate } : {}), ...(p.endDate ? { endDate: p.endDate } : {}), date: p.date || today(),
  } });
  const run = async (kind: 'save' | 'schedule' | 'unschedule' | 'publish' | 'discard') => {
    setBusy(kind);
    try {
      if (kind === 'discard') { if (p.id) await api(`/growth/posts/${p.id}/discard`, { method: 'POST', json: {} }); toast('info', 'Post discarded.'); onSaved(); onClose(); return; }
      const saved = await save();
      if (kind === 'save') toast('ok', 'Saved as an idea.');
      if (kind === 'schedule') { await api(`/growth/posts/${saved.id}/schedule`, { method: 'POST', json: { at: new Date(when).toISOString() } }); toast('ok', `Scheduled for ${fmtDateTime(new Date(when).toISOString())}. It will be published then.`); }
      if (kind === 'unschedule') { await api(`/growth/posts/${saved.id}/schedule`, { method: 'POST', json: { at: null } }); toast('info', 'Unscheduled.'); }
      if (kind === 'publish') { const r = await api<PlannedPost>(`/growth/posts/${saved.id}/publish`, { method: 'POST', json: { confirm: true } }); toast(r.status === 'published' ? 'ok' : 'danger', r.status === 'published' ? 'Published to Google.' : r.error ?? 'Google rejected the post.'); }
      onSaved(); onClose();
    } catch (e: any) { toast('danger', e.message); }
    finally { setBusy(null); }
  };

  return (
    <Dialog open onClose={onClose} width={860} title={p.id ? 'Edit post' : 'New post'} description={locked ? 'This post is already on Google.' : 'Preview shows roughly how it appears on your profile.'}
      footer={locked ? <Button onClick={onClose}>Close</Button> : <>
        {p.id && <Button variant="ghost" icon={<Trash2 size={15} />} loading={busy === 'discard'} onClick={() => run('discard')}>Discard</Button>}
        <Button disabled={!valid} loading={busy === 'save'} onClick={() => run('save')}>Save idea</Button>
        {p.status === 'scheduled' ? <Button loading={busy === 'unschedule'} onClick={() => run('unschedule')}>Unschedule</Button>
          : <Button icon={<Clock size={15} />} disabled={!valid || !when} loading={busy === 'schedule'} onClick={() => run('schedule')}>Schedule</Button>}
        <Button variant="primary" icon={<Send size={15} />} disabled={!valid || !confirm} loading={busy === 'publish'} onClick={() => run('publish')}>Publish now</Button>
      </>}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">{(id) => <select id={id} className="g-select" disabled={locked} value={p.kind} onChange={(e) => { const k = e.target.value; setP((x) => ({ ...x, kind: k, topicType: k === 'offer' ? 'OFFER' : k === 'event' ? 'EVENT' : 'STANDARD' })); }}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>
            <Field label="Planned for">{(id) => <input id={id} type="date" className="g-input" disabled={locked} value={p.date ?? today()} onChange={(e) => set('date', e.target.value)} />}</Field>
          </div>
          {needsDates && <>
            <Field label={`Title (${(p.title ?? '').length}/58)`}>{(id) => <input id={id} className="g-input" disabled={locked} maxLength={58} value={p.title ?? ''} onChange={(e) => set('title', e.target.value)} />}</Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Starts">{(id) => <input id={id} type="date" className="g-input" disabled={locked} value={p.startDate ?? ''} onChange={(e) => set('startDate', e.target.value)} />}</Field>
              <Field label="Ends">{(id) => <input id={id} type="date" className="g-input" disabled={locked} value={p.endDate ?? ''} onChange={(e) => set('endDate', e.target.value)} />}</Field>
            </div>
          </>}
          <Field label={`Post text (${p.summary.length}/1500)`} hint={p.kind === 'offer' ? 'Only describe terms you really offer.' : undefined}>{(id) => <textarea id={id} className="g-textarea" rows={7} maxLength={1500} disabled={locked} value={p.summary} onChange={(e) => set('summary', e.target.value)} />}</Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Button">{(id) => <select id={id} className="g-select" disabled={locked} value={p.ctaType} onChange={(e) => set('ctaType', e.target.value)}>{CTA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>
            {p.ctaType !== 'NONE' && p.ctaType !== 'CALL' && <Field label="Button link">{(id) => <input id={id} className="g-input" disabled={locked} placeholder="https://" value={p.ctaUrl ?? ''} onChange={(e) => set('ctaUrl', e.target.value)} />}</Field>}
          </div>
          {p.imageIdea && <p className="g-muted flex items-start gap-2 text-[12.5px]"><ImageIcon size={14} className="mt-0.5 flex-none" aria-hidden />Photo idea: {p.imageIdea}. Add the photo to the post in Google; images can’t be attached from here yet.</p>}
          {!locked && <>
            <Field label="Schedule for" hint="Scheduling approves this exact post to be published automatically at that time.">{(id) => <input id={id} type="datetime-local" className="g-input" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
            <label className="flex items-start gap-2.5 rounded-xl p-3 text-[13px]" style={{ background: 'var(--g-raised)' }}><input type="checkbox" className="mt-0.5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /><span>I approve publishing this post on my Google Business Profile now.</span></label>
          </>}
          {p.status === 'published' && p.searchUrl && <a href={p.searchUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--g-accent)' }}>View on Google</a>}
        </div>
        <div>
          <p className="g-label">Preview</p>
          <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--g-line)', background: 'var(--g-surface)' }}>
            <div className="flex aspect-[16/9] items-center justify-center" style={{ background: 'var(--g-raised)' }}><ImageIcon size={28} className="g-faint" aria-hidden /></div>
            <div className="space-y-2 p-3.5">
              <p className="text-[13px] font-semibold">{location!.title}</p>
              {p.title && <p className="text-[15px] font-semibold">{p.title}</p>}
              {needsDates && p.startDate && <p className="g-faint text-[12px]">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</p>}
              <p className="whitespace-pre-wrap text-[13.5px]">{p.summary || <span className="g-faint">Your post text appears here.</span>}</p>
              {p.ctaType !== 'NONE' && <span className="inline-block rounded-lg px-3 py-1.5 text-[13px] font-semibold" style={{ color: 'var(--g-accent)', border: '1px solid var(--g-line-strong)' }}>{CTA.find((c) => c[0] === p.ctaType)?.[1]}</span>}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
