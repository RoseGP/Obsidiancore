/** Local visibility: real Google search terms; rank tracking/heatmaps only via an authorised provider. */
import React, { useEffect, useState } from 'react';
import { MapPinned, Radar, Search } from 'lucide-react';
import { useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Button, Card, Empty, Field, PageHeader, Skeleton, fmtDate, fmtNum, useToast } from '../ui';

export default function VisibilityPage() {
  const { api, location } = useGrowth();
  const toast = useToast();
  const q = useLoad(() => api<any>(`/growth/visibility?location=${encodeURIComponent(location!.name)}`), [location?.name]);
  const [kw, setKw] = useState(''); const [areas, setAreas] = useState('');
  useEffect(() => { if (q.data) { setKw(q.data.tracked.keywords.join('\n')); setAreas(q.data.tracked.areas.join('\n')); } }, [q.data]);
  const save = async () => { try { await api('/growth/visibility', { method: 'PUT', json: { keywords: kw.split('\n'), areas: areas.split('\n') } }); toast('ok', 'Saved.'); q.reload(); } catch (e: any) { toast('danger', e.message); } };
  const g = q.data?.google;
  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Local visibility" description="How people find you on Google Search and Maps." />
      {q.loading ? <Skeleton h={280} /> : q.error ? <Alert tone="danger" title={q.error} /> : (
        <>
          <Card title={<span className="flex items-center gap-2"><Search size={16} aria-hidden />Search terms that showed your profile <Badge tone="ok">From Google</Badge></span>}
            description={g ? `Monthly impressions ${g.from} to ${g.to}, reported by the Business Profile Performance API. Google hides exact numbers for small counts and shows a threshold instead.` : undefined}>
            {!g ? <Alert tone="warn" title="Google search terms aren’t available">{q.data.googleError}</Alert> : !g.rows.length ? <Empty title="No search terms reported yet" body="Google reports search terms once your profile gets enough views." /> : (
              <div className="overflow-x-auto"><table className="g-table">
                <thead><tr><th>Search term</th><th className="text-right">Impressions</th><th>Tracked</th></tr></thead>
                <tbody>{g.rows.slice(0, 50).map((r: any) => (
                  <tr key={r.keyword}><td className="font-medium">{r.keyword}</td><td className="g-num text-right">{r.value !== null ? fmtNum(r.value) : <span className="g-faint">fewer than {r.threshold}</span>}</td>
                    <td>{q.data.tracked.keywords.some((k: string) => k.toLowerCase() === r.keyword.toLowerCase()) && <Badge tone="accent">tracked</Badge>}</td></tr>
                ))}</tbody>
              </table></div>
            )}
            {g && <p className="g-faint mt-2 text-[12px]">Updated {fmtDate(g.at)}.</p>}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Terms and areas to monitor" description="One per line. We’ll match terms against Google’s reported search terms; ranking positions need a provider (below).">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Search terms">{(id) => <textarea id={id} className="g-textarea" rows={6} value={kw} onChange={(e) => setKw(e.target.value)} placeholder={'dentist austin\nemergency dentist'} />}</Field>
                <Field label="Areas">{(id) => <textarea id={id} className="g-textarea" rows={6} value={areas} onChange={(e) => setAreas(e.target.value)} placeholder={'Downtown Austin\nRound Rock'} />}</Field>
              </div>
              <div className="mt-3"><Button variant="primary" onClick={save}>Save</Button></div>
              {q.data.googleTrackedMatches.length > 0 && (
                <ul className="mt-4 space-y-1 text-[13px]">{q.data.googleTrackedMatches.map((m: any) => <li key={m.keyword} className="flex justify-between gap-3"><span>{m.keyword}</span><span className="g-num g-muted">{m.match ? (m.match.value !== null ? `${fmtNum(m.match.value)} impressions` : `< ${m.match.threshold}`) : 'not in Google’s report'}</span></li>)}</ul>
              )}
            </Card>
            <Card title={<span className="flex items-center gap-2"><Radar size={16} aria-hidden />Rankings & geo-grid heatmap <Badge>Third-party</Badge></span>}>
              <Empty icon={<MapPinned size={20} />} title="No rank-tracking provider connected" body={q.data.rankProvider.note} />
              <p className="g-faint text-[12px]">When connected, provider rankings will be labelled as third-party estimates, separate from Google’s own metrics above.</p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
