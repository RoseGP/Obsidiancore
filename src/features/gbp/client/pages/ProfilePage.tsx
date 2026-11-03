/** Profile management with approval: edit → review exact changes → (validate) → confirm → publish to Google. */
import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, History, Image as ImageIcon, Plus, Search, Send, Sparkles, Trash2 } from 'lucide-react';
import type { ChangeSet, GLocation, ProfileSnapshot } from '../api';
import { useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, PageHeader, Skeleton, Tabs, fmtDateTime, useToast } from '../ui';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
type Tab = 'details' | 'hours' | 'special' | 'categories' | 'services' | 'attributes' | 'photos' | 'history';

function ReviewChange({ change, onClose, onDone }: { change: ChangeSet | null; onClose: () => void; onDone: () => void }) {
  const { api } = useGrowth();
  const toast = useToast();
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState<'validate' | 'publish' | 'discard' | null>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  useEffect(() => { setOk(false); setValid(null); }, [change?.id]);
  if (!change) return null;
  const act = async (kind: 'validate' | 'publish' | 'discard') => {
    setBusy(kind);
    try {
      if (kind === 'validate') { await api(`/growth/changes/${change.id}/validate`, { method: 'POST', json: {} }); setValid(true); toast('ok', 'Google accepted these values.'); }
      if (kind === 'publish') {
        const r = await api<ChangeSet>(`/growth/changes/${change.id}/publish`, { method: 'POST', json: { confirm: true } });
        if (r.status === 'failed') toast('danger', r.error ?? 'Google rejected the change.');
        else toast('ok', r.pendingReview ? 'Published. Google is reviewing some edits before they appear.' : 'Published to Google.');
        onDone();
      }
      if (kind === 'discard') { await api(`/growth/changes/${change.id}/discard`, { method: 'POST', json: {} }); toast('info', 'Draft discarded.'); onDone(); }
    } catch (e: any) { if (kind === 'validate') setValid(false); toast('danger', e.message); }
    finally { setBusy(null); }
  };
  return (
    <Dialog open onClose={onClose} width={720} title="Review changes before publishing" description={`These exact changes will be sent to Google for ${change.locationTitle}. Nothing has been published yet.`}
      footer={<>
        <Button variant="ghost" onClick={() => act('discard')} loading={busy === 'discard'}>Discard</Button>
        <Button onClick={onClose}>Keep as draft</Button>
        <Button onClick={() => act('validate')} loading={busy === 'validate'}>Check with Google</Button>
        <Button variant="primary" icon={<Send size={15} />} disabled={!ok} loading={busy === 'publish'} onClick={() => act('publish')}>Publish to Google</Button>
      </>}>
      <div className="space-y-3">
        {change.fields.map((f, i) => (
          <div key={i}>
            <p className="mb-1.5 text-[13px] font-semibold">{f.label}</p>
            <div className="grid gap-2 md:grid-cols-2">
              <div><p className="g-faint mb-1 text-[11.5px] font-semibold uppercase tracking-wide">Now on Google</p><div className="g-diff-before text-[13px]">{f.before || '(empty)'}</div></div>
              <div><p className="g-faint mb-1 text-[11.5px] font-semibold uppercase tracking-wide">After publishing</p><div className="g-diff-after text-[13px]">{f.after || '(empty)'}</div></div>
            </div>
          </div>
        ))}
        {valid === true && <Alert tone="ok" title="Google accepted these values (nothing was applied)." />}
        {valid === false && <Alert tone="danger" title="Google rejected the values. Fix them before publishing." />}
        <label className="flex items-start gap-2.5 rounded-xl p-3 text-[13.5px]" style={{ background: 'var(--g-raised)' }}>
          <input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>I’ve checked these changes are accurate and want to publish them to my Google Business Profile. Google may review some edits before they appear.</span>
        </label>
      </div>
    </Dialog>
  );
}

export default function ProfilePage() {
  const { api, location, focus, dash } = useGrowth();
  const toast = useToast();
  const initial: Tab = focus === 'edit_hours' ? 'hours' : focus === 'edit_special_hours' ? 'special' : focus === 'edit_categories' ? 'categories' : focus === 'edit_services' ? 'services' : focus === 'edit_attributes' ? 'attributes' : focus === 'add_photos' ? 'photos' : 'details';
  const [tab, setTab] = useState<Tab>(initial);
  const data = useLoad(() => api<{ location: GLocation; profile: ProfileSnapshot | null }>(`/growth/audit?location=${encodeURIComponent(location!.name)}`), [location?.name]);
  const changes = useLoad(() => api<ChangeSet[]>(`/growth/changes?location=${encodeURIComponent(location!.name)}`), [location?.name]);
  const [review, setReview] = useState<ChangeSet | null>(null);
  const l = data.data?.location;
  const p = data.data?.profile;

  const propose = async (body: any) => {
    try { const c = await api<ChangeSet>('/growth/changes', { method: 'POST', json: { location: location!.name, ...body } }); setReview(c); changes.reload(); }
    catch (e: any) { toast(e.code === 'no_changes' ? 'info' : 'danger', e.message); }
  };
  const done = () => { setReview(null); changes.reload(); data.reload(); };
  const drafts = (changes.data ?? []).filter((c) => c.status === 'draft');

  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Business profile" description="Edit what customers see on Google. You’ll review the exact changes before anything is published."
        actions={l?.mapsUri ? <Button icon={<ExternalLink size={15} />} onClick={() => window.open(l.mapsUri, '_blank', 'noopener')}>View on Google Maps</Button> : undefined} />
      {drafts.length > 0 && <Alert tone="info" title={`${drafts.length} unpublished draft${drafts.length === 1 ? '' : 's'}`} action={<Button size="sm" onClick={() => setReview(drafts[0])}>Review</Button>}>Drafts aren’t visible on Google until you publish them.</Alert>}
      {l?.meta?.hasPendingEdits && <Alert tone="warn" title="Google is reviewing earlier edits">Some changes may take a while to appear on your profile.</Alert>}
      <div className="overflow-x-auto"><Tabs value={tab} onChange={setTab} label="Profile sections" options={[
        { value: 'details', label: 'Details' }, { value: 'hours', label: 'Hours' }, { value: 'special', label: 'Holiday hours' }, { value: 'categories', label: 'Categories' },
        { value: 'services', label: 'Services' }, { value: 'attributes', label: 'Attributes' }, { value: 'photos', label: 'Photos' }, { value: 'history', label: 'Change history' },
      ]} /></div>
      {data.loading ? <Skeleton h={320} /> : data.error || !l ? <Alert tone="danger" title={data.error ?? 'Profile unavailable'} /> : (
        <>
          {tab === 'details' && <Details l={l} onPropose={propose} aiOn={!!dash?.aiConfigured} />}
          {tab === 'hours' && <Hours l={l} onPropose={propose} />}
          {tab === 'special' && <Special l={l} onPropose={propose} />}
          {tab === 'categories' && <Categories l={l} onPropose={propose} />}
          {tab === 'services' && <Services l={l} onPropose={propose} />}
          {tab === 'attributes' && <Attributes l={l} p={p ?? null} onPropose={propose} />}
          {tab === 'photos' && <Photos l={l} p={p ?? null} />}
          {tab === 'history' && <HistoryList items={changes.data ?? []} onOpen={setReview} />}
        </>
      )}
      <ReviewChange change={review} onClose={() => setReview(null)} onDone={done} />
    </div>
  );
}

function Details({ l, onPropose, aiOn }: { l: GLocation; onPropose: (b: any) => void; aiOn: boolean }) {
  const { api } = useGrowth();
  const toast = useToast();
  const [phone, setPhone] = useState(l.phone ?? '');
  const [website, setWebsite] = useState(l.website ?? '');
  const [desc, setDesc] = useState(l.description ?? '');
  const [ai, setAi] = useState({ open: false, services: '', audience: '', differentiators: '', area: l.address?.city ?? '', busy: false });
  const draft = async () => {
    setAi((s) => ({ ...s, busy: true }));
    try { const r = await api<{ text: string; flags: string[] }>('/description/draft', { method: 'POST', json: { location: l.name, services: ai.services, audience: ai.audience, differentiators: ai.differentiators, area: ai.area } }); setDesc(r.text); setAi((s) => ({ ...s, open: false })); toast('ok', 'Draft added. Review it before submitting.'); }
    catch (e: any) { toast('danger', e.message); }
    finally { setAi((s) => ({ ...s, busy: false })); }
  };
  const patch: any = {};
  if (phone !== (l.phone ?? '')) patch.phone = phone.trim();
  if (website !== (l.website ?? '')) patch.website = website.trim();
  if (desc !== (l.description ?? '')) patch.description = desc.trim();
  return (
    <Card title="Contact details and description" description={<>Business name, address and category changes are best made in Google directly, where Google can verify them. <span className="g-faint">Name: {l.title}</span></>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Phone">{(id) => <input id={id} className="g-input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />}</Field>
        <Field label="Website" hint="Use an https:// link.">{(id) => <input id={id} className="g-input" value={website} onChange={(e) => setWebsite(e.target.value)} inputMode="url" />}</Field>
        <div className="md:col-span-2">
          <Field label={`Description (${desc.length}/750)`} hint="Describe your real services, who you serve and where. No links, phone numbers or promotions.">
            {(id) => <textarea id={id} className="g-textarea" rows={6} maxLength={750} value={desc} onChange={(e) => setDesc(e.target.value)} />}
          </Field>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" disabled={!Object.keys(patch).length} onClick={() => onPropose({ patch })}>Review changes</Button>
        <Button icon={<Sparkles size={15} />} disabled={!aiOn} title={aiOn ? undefined : 'AI isn’t configured on the server'} onClick={() => setAi((s) => ({ ...s, open: true }))}>Write with AI</Button>
      </div>
      <Dialog open={ai.open} onClose={() => setAi((s) => ({ ...s, open: false }))} title="Draft a description" description="The AI uses only the facts you give here."
        footer={<Button variant="primary" loading={ai.busy} disabled={![ai.services, ai.audience, ai.differentiators, ai.area].every((x) => x.trim())} onClick={draft}>Draft description</Button>}>
        <div className="space-y-3">
          {([['services', 'Main services'], ['audience', 'Who you serve'], ['differentiators', 'What makes you different'], ['area', 'Area you serve']] as const).map(([k, label]) => (
            <Field key={k} label={label}>{(id) => <input id={id} className="g-input" value={(ai as any)[k]} onChange={(e) => setAi((s) => ({ ...s, [k]: e.target.value }))} maxLength={500} />}</Field>
          ))}
        </div>
      </Dialog>
    </Card>
  );
}

function Hours({ l, onPropose }: { l: GLocation; onPropose: (b: any) => void }) {
  const init = () => DAYS.map((d) => { const p = l.regularHours.find((h) => h.day === d); return { day: d, open: !!p, from: p?.open ?? '09:00', to: p?.close ?? '17:00' }; });
  const [rows, setRows] = useState(init);
  const set = (i: number, k: string, v: any) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const extra = l.regularHours.length > l.regularHours.filter((h, i, a) => a.findIndex((x) => x.day === h.day) === i).length;
  return (
    <Card title="Opening hours" description="Set the hours for each day. Days left closed show as closed on Google.">
      {extra && <div className="mb-3"><Alert tone="warn" title="Some days have split hours">This editor sets one period per day; publishing will replace split hours. Edit those in Google if you need two periods.</Alert></div>}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.day} className="flex flex-wrap items-center gap-3">
            <label className="flex w-[150px] items-center gap-2 text-[13.5px] font-medium"><input type="checkbox" checked={r.open} onChange={(e) => set(i, 'open', e.target.checked)} />{r.day.charAt(0) + r.day.slice(1).toLowerCase()}</label>
            {r.open ? <>
              <input className="g-input" style={{ width: 120 }} type="time" aria-label={`${r.day} opens`} value={r.from} onChange={(e) => set(i, 'from', e.target.value)} />
              <span className="g-faint">to</span>
              <input className="g-input" style={{ width: 120 }} type="time" aria-label={`${r.day} closes`} value={r.to} onChange={(e) => set(i, 'to', e.target.value)} />
            </> : <span className="g-faint text-[13px]">Closed</span>}
          </div>
        ))}
      </div>
      <div className="mt-4"><Button variant="primary" onClick={() => onPropose({ patch: { regularHours: rows.filter((r) => r.open).map((r) => ({ day: r.day, open: r.from, close: r.to })) } })}>Review changes</Button></div>
    </Card>
  );
}

function Special({ l, onPropose }: { l: GLocation; onPropose: (b: any) => void }) {
  const [rows, setRows] = useState(() => (l.specialHours ?? []).map((p) => ({ ...p, open: p.open ?? '09:00', close: p.close ?? '17:00' })));
  const add = () => setRows((r) => [...r, { startDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), endDate: '', closed: true, open: '09:00', close: '17:00' }]);
  return (
    <Card title="Holiday and special hours" description="Override your regular hours for holidays or one-off closures." actions={<Button size="sm" icon={<Plus size={14} />} onClick={add}>Add date</Button>}>
      {!rows.length ? <p className="g-muted text-[13.5px]">No special hours. Add upcoming holidays so customers don’t make a wasted trip.</p> : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2.5">
              <input className="g-input" style={{ width: 160 }} type="date" aria-label="Date" value={r.startDate} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, startDate: e.target.value } : y)))} />
              <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={r.closed} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, closed: e.target.checked } : y)))} />Closed all day</label>
              {!r.closed && <><input className="g-input" style={{ width: 120 }} type="time" aria-label="Opens" value={r.open} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, open: e.target.value } : y)))} /><span className="g-faint">to</span><input className="g-input" style={{ width: 120 }} type="time" aria-label="Closes" value={r.close} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, close: e.target.value } : y)))} /></>}
              <button type="button" className="g-icon-btn" aria-label="Remove date" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4"><Button variant="primary" onClick={() => onPropose({ patch: { specialHours: rows.filter((r) => r.startDate).map((r) => ({ startDate: r.startDate, endDate: r.endDate || r.startDate, closed: r.closed, ...(r.closed ? {} : { open: r.open, close: r.close }) })) } })}>Review changes</Button></div>
    </Card>
  );
}

function Categories({ l, onPropose }: { l: GLocation; onPropose: (b: any) => void }) {
  const { api } = useGrowth();
  const toast = useToast();
  const [primary, setPrimary] = useState<{ name: string; displayName: string } | null>(l.primaryCategoryId ? { name: l.primaryCategoryId, displayName: l.primaryCategory ?? '' } : null);
  const [extra, setExtra] = useState<{ name: string; displayName: string }[]>(() => (l.additionalCategoryIds ?? []).map((n, i) => ({ name: n, displayName: l.additionalCategories[i] ?? n })));
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ name: string; displayName: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const search = async () => { if (q.trim().length < 2) return; setBusy(true); try { setHits(await api(`/growth/categories?q=${encodeURIComponent(q.trim())}`)); } catch (e: any) { toast('danger', e.message); } finally { setBusy(false); } };
  const names = Object.fromEntries([...(primary ? [primary] : []), ...extra, ...hits].map((c) => [c.name, c.displayName]));
  return (
    <Card title="Categories" description="Choose from Google’s category list. Only pick categories that genuinely describe your business.">
      <div className="space-y-4">
        <div>
          <p className="g-label">Primary category</p>
          <p className="text-[14px] font-semibold">{primary?.displayName || 'Not set'}</p>
        </div>
        <div>
          <p className="g-label">Additional categories ({extra.length}/9)</p>
          <div className="flex flex-wrap gap-2">{extra.length ? extra.map((c) => <span key={c.name} className="g-badge" data-tone="accent">{c.displayName}<button type="button" aria-label={`Remove ${c.displayName}`} onClick={() => setExtra((x) => x.filter((y) => y.name !== c.name))} style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0 }}>×</button></span>) : <span className="g-faint text-[13px]">None</span>}</div>
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input className="g-input" placeholder="Search Google categories, e.g. “cosmetic dentist”" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search categories" />
          <Button type="submit" icon={<Search size={15} />} loading={busy}>Search</Button>
        </form>
        {hits.length > 0 && (
          <ul className="space-y-1.5">{hits.map((h) => (
            <li key={h.name} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--g-raised)' }}>
              <span className="min-w-0 flex-1 text-[13.5px]">{h.displayName}</span>
              <Button size="sm" onClick={() => setPrimary(h)} disabled={primary?.name === h.name}>Make primary</Button>
              <Button size="sm" disabled={extra.some((x) => x.name === h.name) || extra.length >= 9 || primary?.name === h.name} onClick={() => setExtra((x) => [...x, h])}>Add</Button>
            </li>
          ))}</ul>
        )}
        <Button variant="primary" onClick={() => onPropose({ patch: { ...(primary && primary.name !== l.primaryCategoryId ? { primaryCategoryId: primary.name } : {}), additionalCategoryIds: extra.map((c) => c.name) }, categoryNames: names })}>Review changes</Button>
      </div>
    </Card>
  );
}

function Services({ l, onPropose }: { l: GLocation; onPropose: (b: any) => void }) {
  const [items, setItems] = useState(() => (l.serviceItems ?? []).map((s) => ({ label: s.label, description: s.description ?? '' })));
  const cat = l.primaryCategoryId;
  return (
    <Card title="Services" description="List each service you genuinely provide, with a short description." actions={<Button size="sm" icon={<Plus size={14} />} onClick={() => setItems((x) => [...x, { label: '', description: '' }])}>Add service</Button>}>
      {!cat && <div className="mb-3"><Alert tone="warn" title="Set a primary category first">Google files services under a category.</Alert></div>}
      {!items.length ? <p className="g-muted text-[13.5px]">No services yet.</p> : (
        <div className="space-y-2">{items.map((s, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
            <input className="g-input" placeholder="Service name" aria-label="Service name" value={s.label} maxLength={140} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
            <input className="g-input" placeholder="Short description (optional)" aria-label="Service description" value={s.description} maxLength={300} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
            <button type="button" className="g-icon-btn" aria-label="Remove service" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
          </div>
        ))}</div>
      )}
      <div className="mt-4"><Button variant="primary" disabled={!cat} onClick={() => onPropose({ patch: { serviceItems: items.filter((s) => s.label.trim()).map((s) => ({ label: s.label.trim(), ...(s.description.trim() ? { description: s.description.trim() } : {}), category: cat })) } })}>Review changes</Button></div>
    </Card>
  );
}

function Attributes({ l, p, onPropose }: { l: GLocation; p: ProfileSnapshot | null; onPropose: (b: any) => void }) {
  const { api } = useGrowth();
  const avail = useLoad(() => api<{ parent: string; displayName: string; group: string; valueType: string }[]>(`/growth/attributes?location=${encodeURIComponent(l.name)}`), [l.name]);
  const current = useMemo(() => Object.fromEntries((p?.attributes ?? []).map((a) => [a.name.replace(/^.*attributes\//, ''), a.values?.[0]])), [p]);
  const [vals, setVals] = useState<Record<string, boolean | undefined>>({});
  const bools = (avail.data ?? []).filter((a) => a.valueType === 'BOOL');
  const groups = [...new Set(bools.map((a) => a.group || 'Other'))];
  const changed = Object.entries(vals).filter(([k, v]) => v !== undefined && v !== current[k]);
  if (avail.loading) return <Skeleton h={240} />;
  if (avail.error) return <Alert tone="danger" title={avail.error} />;
  return (
    <Card title="Attributes" description="Set the yes/no facts that apply to your business. Only attributes Google offers for your category are shown. Other types (like payment lists) can be edited in Google.">
      {!bools.length ? <Empty title="No yes/no attributes available" body="Google doesn’t offer editable yes/no attributes for this category." /> : (
        <div className="space-y-4">{groups.map((g) => (
          <fieldset key={g}><legend className="g-label">{g}</legend>
            <div className="grid gap-2 sm:grid-cols-2">{bools.filter((a) => (a.group || 'Other') === g).map((a) => {
              const k = a.parent.replace(/^attributes\//, '');
              const v = vals[k] ?? current[k];
              return (
                <label key={k} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px]" style={{ background: 'var(--g-raised)' }}>
                  <select className="g-select" style={{ width: 92, minHeight: 32 }} aria-label={a.displayName} value={v === true ? 'yes' : v === false ? 'no' : ''} onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : undefined }))}>
                    <option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option>
                  </select>
                  <span>{a.displayName}</span>
                </label>
              );
            })}</div>
          </fieldset>
        ))}</div>
      )}
      <div className="mt-4"><Button variant="primary" disabled={!changed.length} onClick={() => onPropose({ attributes: changed.map(([k, v]) => ({ name: k, valueType: 'BOOL', values: [v] })) })}>Review {changed.length || ''} change{changed.length === 1 ? '' : 's'}</Button></div>
    </Card>
  );
}

function Photos({ l, p }: { l: GLocation; p: ProfileSnapshot | null }) {
  return (
    <Card title="Photos and videos" description="Read from Google. Upload new photos in Google Business Profile; Google’s API only accepts photos from a public URL, so uploads here aren’t supported yet."
      actions={<Button size="sm" icon={<ExternalLink size={14} />} onClick={() => window.open('https://business.google.com/', '_blank', 'noopener')}>Add photos in Google</Button>}>
      {!p?.media ? <Alert tone="warn" title="Photos couldn’t be read">Run an audit to refresh profile data.</Alert> : (
        <>
          <p className="g-muted mb-3 text-[13.5px]">{p.media.photos} photos · {p.media.videos} videos · {p.media.hasLogo ? 'logo set' : 'no logo'} · {p.media.hasCover ? 'cover set' : 'no cover photo'}</p>
          {p.media.samples.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">{p.media.samples.map((m) => <img key={m.url} src={m.url} alt={`${m.category.toLowerCase()} photo`} className="aspect-square w-full rounded-lg object-cover" loading="lazy" referrerPolicy="no-referrer" />)}</div>
          ) : <Empty icon={<ImageIcon size={20} />} title="No photos yet" />}
        </>
      )}
      <p className="g-faint mt-3 text-[12px]">{l.title}</p>
    </Card>
  );
}

function HistoryList({ items, onOpen }: { items: ChangeSet[]; onOpen: (c: ChangeSet) => void }) {
  return (
    <Card title="Change history" description="Every change prepared or published through this app.">
      {!items.length ? <Empty icon={<History size={20} />} title="No changes yet" /> : (
        <div className="overflow-x-auto"><table className="g-table">
          <thead><tr><th>When</th><th>Fields</th><th>Status</th><th>From</th><th /></tr></thead>
          <tbody>{items.map((c) => (
            <tr key={c.id}>
              <td className="g-num whitespace-nowrap">{fmtDateTime(c.publishedAt ?? c.createdAt)}</td>
              <td>{c.fields.map((f) => f.label).join(', ')}{c.error && <p className="text-[12px]" style={{ color: 'var(--g-danger)' }}>{c.error}</p>}</td>
              <td><Badge tone={c.status === 'published' ? 'ok' : c.status === 'failed' ? 'danger' : c.status === 'draft' ? 'accent' : undefined}>{c.status}{c.pendingReview ? ' · in review' : ''}</Badge></td>
              <td className="g-muted">{c.source === 'ai' ? 'AI suggestion' : c.source === 'automation' ? 'Automation' : 'You'}</td>
              <td>{(c.status === 'draft' || c.status === 'failed') && <Button size="sm" onClick={() => onOpen(c)}>Review</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}
