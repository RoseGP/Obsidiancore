/** Competitor intelligence: add by hand or from Google Places (public data), compare, AI report. */
import React, { useState } from 'react';
import { Plus, RefreshCw, Search, Sparkles, Swords, Trash2 } from 'lucide-react';
import type { Competitor } from '../api';
import { useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Button, Card, Dialog, Empty, Field, PageHeader, Skeleton, fmtDate, fmtNum, useToast } from '../ui';

export default function CompetitorsPage() {
  const { api, location, dash } = useGrowth();
  const toast = useToast();
  const q = useLoad(() => api<{ competitors: Competitor[]; placesConfigured: boolean }>(`/growth/competitors?location=${encodeURIComponent(location!.name)}`), [location?.name]);
  const audit = dash?.locations.find((l) => l.location.name === location?.name);
  const [adding, setAdding] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const comps = q.data?.competitors ?? [];

  const refresh = async () => { setBusy('refresh'); try { q.setData(await api('/growth/competitors/refresh', { method: 'POST', json: { location: location!.name } })); toast('ok', 'Refreshed from Google Places.'); } catch (e: any) { toast('danger', e.message); } finally { setBusy(null); } };
  const runReport = async () => { setBusy('report'); try { setReport(await api('/growth/competitors/report', { method: 'POST', json: { location: location!.name } })); } catch (e: any) { toast('danger', e.message); } finally { setBusy(null); } };
  const remove = async (c: Competitor) => { try { await api(`/growth/competitors/${c.id}`, { method: 'DELETE' }); q.reload(); } catch (e: any) { toast('danger', e.message); } };

  const me = { name: `${location!.title} (you)`, rating: audit?.averageRating ?? null, reviewCount: audit?.reviewCount ?? null, photoCount: null as number | null, categories: [location!.primaryCategory, ...location!.additionalCategories].filter(Boolean) as string[], services: (location!.serviceItems ?? []).map((s) => s.label) };
  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Competitors" description="Compare your profile with nearby businesses using public Google Places data or details you enter. This app has no access to competitors’ private analytics."
        actions={<>
          {q.data?.placesConfigured && comps.some((c) => c.source === 'places') && <Button icon={<RefreshCw size={15} />} loading={busy === 'refresh'} onClick={refresh}>Refresh</Button>}
          <Button icon={<Sparkles size={15} />} disabled={!dash?.aiConfigured || !comps.length} loading={busy === 'report'} onClick={runReport}>AI report</Button>
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Add competitor</Button>
        </>} />
      {q.data && !q.data.placesConfigured && <Alert tone="info" title="Google Places isn’t configured">You can add competitors by hand. An administrator can set GOOGLE_PLACES_API_KEY to look up public ratings and review counts.</Alert>}
      {q.loading ? <Skeleton h={240} /> : q.error ? <Alert tone="danger" title={q.error} /> : !comps.length ? (
        <Card><Empty icon={<Swords size={20} />} title="No competitors yet" body="Add 2–5 businesses customers compare you with." action={<Button variant="primary" onClick={() => setAdding(true)}>Add competitor</Button>} /></Card>
      ) : (
        <Card title="Comparison" pad={false}>
          <div className="overflow-x-auto"><table className="g-table">
            <thead><tr><th>Business</th><th>Rating</th><th>Reviews</th><th>Review trend</th><th>Photos</th><th>Posts / month</th><th>Categories</th><th>Source</th><th /></tr></thead>
            <tbody>
              <tr style={{ background: 'var(--g-accent-tint)' }}><td className="font-semibold">{me.name}</td><td className="g-num">{me.rating ?? '—'}</td><td className="g-num">{fmtNum(me.reviewCount)}</td><td>—</td><td>—</td><td>—</td><td className="g-muted">{me.categories.join(', ')}</td><td><Badge tone="accent">Your profile</Badge></td><td /></tr>
              {comps.map((c) => {
                const first = c.snapshots[0]; const last = c.snapshots[c.snapshots.length - 1];
                const trend = first && last && first !== last && first.reviewCount !== null && last.reviewCount !== null ? last.reviewCount - first.reviewCount : null;
                return (
                  <tr key={c.id}>
                    <td><span className="font-semibold">{c.name}</span>{c.address && <span className="g-faint block text-[12px]">{c.address}</span>}{c.website && <a className="block text-[12px]" style={{ color: 'var(--g-accent)' }} href={c.website} target="_blank" rel="noreferrer">Website</a>}</td>
                    <td className="g-num">{c.rating ?? '—'}</td><td className="g-num">{fmtNum(c.reviewCount)}</td>
                    <td className="g-num">{trend === null ? <span className="g-faint">—</span> : `${trend >= 0 ? '+' : ''}${trend} since ${fmtDate(first.at)}`}</td>
                    <td className="g-num">{fmtNum(c.photoCount)}</td><td className="g-num">{c.postsPerMonth ?? '—'}</td>
                    <td className="g-muted">{c.categories.slice(0, 3).join(', ') || '—'}</td>
                    <td><Badge tone={c.source === 'places' ? 'teal' : undefined}>{c.source === 'places' ? 'Google Places' : 'Entered by you'}</Badge>{c.refreshedAt && <span className="g-faint block text-[11px]">{fmtDate(c.refreshedAt)}</span>}</td>
                    <td><button type="button" className="g-icon-btn" aria-label={`Remove ${c.name}`} onClick={() => remove(c)}><Trash2 size={15} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <p className="g-faint px-5 py-3 text-[12px]">Google Places photo counts show up to the first 10 photos Places returns. Places details are kept for at most 30 days, as Google’s terms require.</p>
        </Card>
      )}

      {report && (
        <Card title="AI competitor report" description="Based only on the data in the table.">
          <p className="text-[14px]">{report.summary}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div><h3 className="mb-1.5 text-[13.5px] font-semibold" style={{ color: 'var(--g-ok)' }}>Where you’re ahead</h3><ul className="list-disc space-y-1 pl-5 text-[13.5px]">{report.strengths.map((s: string) => <li key={s}>{s}</li>)}</ul></div>
            <div><h3 className="mb-1.5 text-[13.5px] font-semibold" style={{ color: 'var(--g-warn)' }}>Where they’re ahead</h3><ul className="list-disc space-y-1 pl-5 text-[13.5px]">{report.gaps.map((s: string) => <li key={s}>{s}</li>)}</ul></div>
            <div><h3 className="mb-1.5 text-[13.5px] font-semibold" style={{ color: 'var(--g-accent)' }}>Opportunities</h3><ul className="space-y-2 text-[13.5px]">{report.opportunities.map((o: any) => <li key={o.title}><strong>{o.title}</strong><span className="g-muted block">{o.detail}</span></li>)}</ul></div>
          </div>
        </Card>
      )}

      {adding && <AddDialog placesOn={!!q.data?.placesConfigured} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); q.reload(); }} />}
    </div>
  );
}

function AddDialog({ placesOn, onClose, onAdded }: { placesOn: boolean; onClose: () => void; onAdded: () => void }) {
  const { api, location } = useGrowth();
  const toast = useToast();
  const [mode, setMode] = useState<'places' | 'manual'>(placesOn ? 'places' : 'manual');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<any[] | null>(null);
  const [m, setM] = useState({ name: '', rating: '', reviewCount: '', website: '', categories: '', services: '', postsPerMonth: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const search = async () => { setBusy(true); try { setHits(await api(`/growth/competitors/search?location=${encodeURIComponent(location!.name)}&q=${encodeURIComponent(query)}`)); } catch (e: any) { toast('danger', e.message); } finally { setBusy(false); } };
  const add = async (body: any) => { setBusy(true); try { await api('/growth/competitors', { method: 'POST', json: { location: location!.name, ...body } }); toast('ok', 'Competitor added.'); onAdded(); } catch (e: any) { toast('danger', e.message); } finally { setBusy(false); } };
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  return (
    <Dialog open onClose={onClose} title="Add a competitor" width={620}>
      {placesOn && <div className="mb-4 flex gap-2"><Button size="sm" variant={mode === 'places' ? 'primary' : 'default'} onClick={() => setMode('places')}>Find on Google</Button><Button size="sm" variant={mode === 'manual' ? 'primary' : 'default'} onClick={() => setMode('manual')}>Enter by hand</Button></div>}
      {mode === 'places' ? (
        <div className="space-y-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}><input className="g-input" aria-label="Search businesses" placeholder={`e.g. ${location!.primaryCategory ?? 'business'} near ${location!.address?.city ?? 'you'}`} value={query} onChange={(e) => setQuery(e.target.value)} /><Button type="submit" icon={<Search size={15} />} loading={busy}>Search</Button></form>
          {hits && (!hits.length ? <p className="g-muted text-[13.5px]">No businesses found.</p> : (
            <ul className="space-y-2">{hits.map((h) => (
              <li key={h.placeId} className="flex flex-wrap items-center gap-3 rounded-xl p-3" style={{ background: 'var(--g-raised)' }}>
                <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold">{h.name}</span><span className="g-muted block text-[12px]">{h.address} · {h.rating ?? '—'}★ ({fmtNum(h.reviewCount)} reviews)</span></span>
                <Button size="sm" onClick={() => add({ placeId: h.placeId })} disabled={busy}>Add</Button>
              </li>
            ))}</ul>
          ))}
        </div>
      ) : (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); add({ name: m.name, rating: num(m.rating), reviewCount: num(m.reviewCount), website: m.website || undefined, categories: m.categories.split(',').map((s) => s.trim()).filter(Boolean), services: m.services.split(',').map((s) => s.trim()).filter(Boolean), postsPerMonth: num(m.postsPerMonth), notes: m.notes }); }}>
          <div className="sm:col-span-2"><Field label="Business name">{(id) => <input id={id} className="g-input" required value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} />}</Field></div>
          <Field label="Rating (1–5)">{(id) => <input id={id} className="g-input" inputMode="decimal" value={m.rating} onChange={(e) => setM({ ...m, rating: e.target.value })} />}</Field>
          <Field label="Number of reviews">{(id) => <input id={id} className="g-input" inputMode="numeric" value={m.reviewCount} onChange={(e) => setM({ ...m, reviewCount: e.target.value })} />}</Field>
          <Field label="Website">{(id) => <input id={id} className="g-input" placeholder="https://" value={m.website} onChange={(e) => setM({ ...m, website: e.target.value })} />}</Field>
          <Field label="Posts per month (approx.)">{(id) => <input id={id} className="g-input" inputMode="decimal" value={m.postsPerMonth} onChange={(e) => setM({ ...m, postsPerMonth: e.target.value })} />}</Field>
          <div className="sm:col-span-2"><Field label="Categories (comma-separated)">{(id) => <input id={id} className="g-input" value={m.categories} onChange={(e) => setM({ ...m, categories: e.target.value })} />}</Field></div>
          <div className="sm:col-span-2"><Field label="Services (comma-separated)">{(id) => <input id={id} className="g-input" value={m.services} onChange={(e) => setM({ ...m, services: e.target.value })} />}</Field></div>
          <div className="sm:col-span-2 flex justify-end"><Button type="submit" variant="primary" loading={busy} disabled={!m.name.trim()}>Add competitor</Button></div>
        </form>
      )}
    </Dialog>
  );
}
