/** Reviews & reputation: filters, sentiment, recurring complaints, AI replies (approve before publishing). */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, Copy, MessageSquareText, RefreshCw, Send, Sparkles, Star, Trash2 } from 'lucide-react';
import { Bar as RBar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Review } from '../api';
import { useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Button, Card, Dialog, Empty, PageHeader, Skeleton, Stat, fmtDate, fmtDateTime, useToast } from '../ui';

const TONES = [['professional', 'Professional'], ['friendly', 'Friendly'], ['empathetic', 'Empathetic'], ['formal', 'Formal'], ['concise', 'Short and concise']] as const;

function Stars({ n }: { n: number }) {
  return <span className="inline-flex" aria-label={`${n} out of 5 stars`}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={14} fill={i <= n ? 'var(--g-warn)' : 'none'} stroke={i <= n ? 'var(--g-warn)' : 'var(--g-faint)'} aria-hidden />)}</span>;
}

export default function ReviewsPage() {
  const { api, location, dash, reload } = useGrowth();
  const toast = useToast();
  const list = useLoad(() => api<Review[]>(`/reviews?location=${encodeURIComponent(location!.name)}`), [location?.name]);
  const summary = useLoad(() => api<any>(`/growth/reviews/summary?location=${encodeURIComponent(location!.name)}`), [location?.name]);
  const [sort, setSort] = useState<'newest' | 'oldest' | 'lowest' | 'highest'>('newest');
  const [sentiment, setSentiment] = useState<'all' | Review['sentiment']>('all');
  const [status, setStatus] = useState<'all' | 'unanswered' | 'answered'>('all');
  const [open, setOpen] = useState<Review | null>(null);
  const [syncing, setSyncing] = useState(false);

  const rows = useMemo(() => {
    const r = (list.data ?? []).filter((x) => (sentiment === 'all' || x.sentiment === sentiment) && (status === 'all' || (status === 'answered' ? !!x.reply : !x.reply)));
    return [...r].sort((a, b) => sort === 'newest' ? b.createTime.localeCompare(a.createTime) : sort === 'oldest' ? a.createTime.localeCompare(b.createTime) : sort === 'lowest' ? a.rating - b.rating : b.rating - a.rating);
  }, [list.data, sort, sentiment, status]);

  const sync = async () => { setSyncing(true); try { const r = await api<any>('/sync', { method: 'POST', json: {} }); toast(r.errors?.length ? 'warn' : 'ok', `Synced ${r.reviews} reviews${r.errors?.length ? `; ${r.errors.length} location errors` : ''}.`); list.reload(); summary.reload(); reload(); } catch (e: any) { toast('danger', e.message); } finally { setSyncing(false); } };
  const reviewLink = location?.meta?.newReviewUri;
  const s = summary.data;

  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Reviews" description="Read, understand and reply to your Google reviews. Replies are only published when you approve them."
        actions={<>
          {reviewLink && <Button icon={<Copy size={15} />} onClick={() => navigator.clipboard.writeText(reviewLink).then(() => toast('ok', 'Review link copied. Share it with real customers after a good experience.'), () => toast('info', reviewLink))}>Copy review link</Button>}
          <Button variant="primary" icon={<RefreshCw size={15} />} loading={syncing} onClick={sync}>Sync from Google</Button>
        </>} />
      <Alert tone="info">Ask genuine customers for reviews. Never offer incentives, write reviews yourself, or ask for only positive ones; that breaks Google’s policies.</Alert>

      {summary.loading ? <Skeleton h={110} /> : s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Positive" value={s.sentiment.Positive} sub="4–5 stars" source="estimate" />
          <Stat label="Neutral" value={s.sentiment.Neutral} sub="3 stars" source="estimate" />
          <Stat label="Negative" value={s.sentiment.Negative} sub="1–2 stars" source="estimate" tone={s.sentiment.Negative ? 'var(--g-danger)' : undefined} />
          <Stat label="Unanswered" value={s.unanswered} sub={s.unansweredNegative ? `${s.unansweredNegative} negative` : 'none negative'} tone={s.unansweredNegative ? 'var(--g-danger)' : undefined} onClick={() => setStatus('unanswered')} />
        </div>
      )}

      {s && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Recurring complaints" description="Themes that appear in two or more negative reviews (keyword-based estimate).">
            {!s.recurringComplaints.length ? <p className="g-muted text-[13.5px]">No recurring complaints found.</p> : (
              <ul className="space-y-2">{s.recurringComplaints.map((t: any) => <li key={t.topic} className="flex items-center gap-2 text-[13.5px]"><AlertTriangle size={15} style={{ color: 'var(--g-warn)' }} aria-hidden /><span className="flex-1 font-medium">{t.topic}</span><Badge tone="warn">{t.count} reviews</Badge></li>)}</ul>
            )}
            {s.praised.length > 0 && <p className="g-muted mt-3 text-[13px]">Customers praise: {s.praised.map((t: any) => t.topic).join(', ')}.</p>}
          </Card>
          <Card title="Reviews per month">
            {!s.monthly.length ? <p className="g-muted text-[13.5px]">No reviews yet.</p> : (
              <div style={{ height: 170 }}><ResponsiveContainer><BarChart data={s.monthly} margin={{ left: -24, right: 8, top: 4 }}>
                <CartesianGrid stroke="var(--g-line)" vertical={false} /><XAxis dataKey="month" tick={{ fill: 'var(--g-faint)', fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fill: 'var(--g-faint)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: 'var(--g-surface)', border: '1px solid var(--g-line)', borderRadius: 10, color: 'var(--g-text)' }} formatter={(v: any, k: any, p: any) => [`${v} (avg ${p.payload.average}★)`, 'Reviews']} />
                <RBar dataKey="count" fill="var(--g-accent)" radius={[6, 6, 0, 0]} />
              </BarChart></ResponsiveContainer></div>
            )}
          </Card>
        </div>
      )}

      <Card title={`Reviews (${rows.length})`} actions={<div className="flex flex-wrap gap-2">
        <select className="g-select" style={{ width: 'auto', minHeight: 34 }} aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as any)}><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="lowest">Lowest rating</option><option value="highest">Highest rating</option></select>
        <select className="g-select" style={{ width: 'auto', minHeight: 34 }} aria-label="Sentiment" value={sentiment} onChange={(e) => setSentiment(e.target.value as any)}><option value="all">All sentiment</option><option value="Positive">Positive</option><option value="Neutral">Neutral</option><option value="Negative">Negative</option></select>
        <select className="g-select" style={{ width: 'auto', minHeight: 34 }} aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as any)}><option value="all">All</option><option value="unanswered">Unanswered</option><option value="answered">Answered</option></select>
      </div>}>
        {list.loading ? <Skeleton h={200} /> : list.error ? <Alert tone="danger" title={list.error} /> : !rows.length ? <Empty icon={<MessageSquareText size={20} />} title={(list.data ?? []).length ? 'No reviews match' : 'No reviews synced yet'} body={(list.data ?? []).length ? undefined : 'Sync from Google to load your reviews.'} /> : (
          <ul className="space-y-2">{rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r)} className="w-full rounded-xl p-3.5 text-left" style={{ background: 'var(--g-raised)', border: `1px solid ${!r.reply && r.rating <= 3 ? 'var(--g-danger)' : 'transparent'}`, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                <div className="flex flex-wrap items-center gap-2"><span className="text-[13.5px] font-semibold">{r.reviewer}</span><Stars n={r.rating} /><span className="g-faint text-[12px]">{fmtDate(r.createTime)}</span><span className="flex-1" />{r.reply ? <Badge tone="ok">Replied</Badge> : <Badge tone={r.rating <= 3 ? 'danger' : 'warn'}>Needs reply</Badge>}{r.draft && !r.reply && <Badge tone="accent">Draft ready</Badge>}</div>
                <p className="mt-1.5 line-clamp-2 text-[13.5px]">{r.comment || <span className="g-faint">(rating only)</span>}</p>
                {r.topics.length > 0 && <p className="g-faint mt-1 text-[12px]">{r.topics.join(' · ')}</p>}
              </button>
            </li>
          ))}</ul>
        )}
      </Card>

      {s?.replyActivity?.length > 0 && (
        <Card title="Reply activity"><ul className="space-y-1.5 text-[13px]">{s.replyActivity.slice(0, 10).map((a: any, i: number) => <li key={i} className="flex gap-3"><span className="g-faint g-num w-[120px] flex-none">{fmtDateTime(a.at)}</span>{a.message}</li>)}</ul></Card>
      )}

      {open && <ReplyDialog review={open} aiOn={!!dash?.aiConfigured} onClose={() => setOpen(null)} onChanged={(r) => { setOpen(r); list.reload(); summary.reload(); reload(); }} />}
    </div>
  );
}

function ReplyDialog({ review, aiOn, onClose, onChanged }: { review: Review; aiOn: boolean; onClose: () => void; onChanged: (r: Review | null) => void }) {
  const { api } = useGrowth();
  const toast = useToast();
  const [tone, setTone] = useState<string>(review.rating <= 2 ? 'empathetic' : 'friendly');
  const [text, setText] = useState(review.draft?.text ?? review.reply?.comment ?? '');
  const [flags, setFlags] = useState<string[]>(review.draft?.flags ?? []);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'publish' | 'delete' | null>(null);
  const bytes = new TextEncoder().encode(text).length;

  const draft = async () => { setBusy('draft'); try { const d = await api<any>(`/reviews/${review.id}/draft`, { method: 'POST', json: { tone } }); setText(d.text); setFlags(d.flags); setOk(false); } catch (e: any) { toast('danger', e.message); } finally { setBusy(null); } };
  const publish = async () => { setBusy('publish'); try { const r = await api<Review>(`/reviews/${review.id}/reply`, { method: 'PUT', json: { comment: text } }); toast('ok', 'Reply published on Google.'); onChanged(r); } catch (e: any) { toast('danger', e.message); } finally { setBusy(null); } };
  const del = async () => { setBusy('delete'); try { await api(`/reviews/${review.id}/reply`, { method: 'DELETE' }); toast('info', 'Reply removed from Google.'); onChanged(null); } catch (e: any) { toast('danger', e.message); } finally { setBusy(null); } };

  return (
    <Dialog open onClose={onClose} width={680} title={`${review.reviewer} · ${review.rating}★`} description={`${fmtDate(review.createTime)} · ${review.locationTitle}`}
      footer={<>
        {review.reply && <Button variant="ghost" icon={<Trash2 size={15} />} loading={busy === 'delete'} onClick={del}>Delete reply</Button>}
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" icon={<Send size={15} />} disabled={!ok || !text.trim() || bytes > 4096} loading={busy === 'publish'} onClick={publish}>{review.reply ? 'Update reply' : 'Publish reply'}</Button>
      </>}>
      <div className="space-y-4">
        <blockquote className="rounded-xl p-3.5 text-[14px]" style={{ background: 'var(--g-raised)' }}>{review.comment || <span className="g-faint">(The customer left a rating without text.)</span>}</blockquote>
        {review.sentiment === 'Negative' && <Alert tone="warn" title="Negative experience">Acknowledge the issue, apologise where appropriate and invite them to contact you directly. Don’t share personal details publicly.</Alert>}
        <div>
          <p className="g-label">Tone</p>
          <div className="flex flex-wrap gap-1.5">{TONES.map(([v, label]) => <button key={v} type="button" onClick={() => setTone(v)} className="g-btn g-btn-sm" style={tone === v ? { background: 'var(--g-accent-tint)', borderColor: 'var(--g-accent)', color: 'var(--g-accent)' } : undefined} aria-pressed={tone === v}>{label}</button>)}</div>
        </div>
        <div>
          <label htmlFor="reply-text" className="g-label">Your reply {bytes > 4096 && <span style={{ color: 'var(--g-danger)' }}>(too long for Google)</span>}</label>
          <textarea id="reply-text" className="g-textarea" rows={6} value={text} onChange={(e) => { setText(e.target.value); setOk(false); }} placeholder="Write a reply, or draft one with AI." />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<Sparkles size={14} />} disabled={!aiOn} loading={busy === 'draft'} onClick={draft}>{text ? 'Redraft with AI' : 'Draft with AI'}</Button>
            {!aiOn && <span className="g-faint text-[12px]">AI isn’t configured; write your reply yourself.</span>}
          </div>
        </div>
        {flags.length > 0 && <Alert tone="warn" title="Check before publishing">{flags.map((f) => <p key={f}>{f}</p>)}</Alert>}
        <label className="flex items-start gap-2.5 rounded-xl p-3 text-[13.5px]" style={{ background: 'var(--g-raised)' }}>
          <input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>I’ve read this reply and approve publishing it publicly on Google under my business name.</span>
        </label>
      </div>
    </Dialog>
  );
}
