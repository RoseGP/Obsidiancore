/** Recommendations inbox from periodic analysis (prepare-only) and notification settings. */
import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2, Play, X } from 'lucide-react';
import type { InboxItem } from '../api';
import { routeForAction, useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Button, Card, Empty, PageHeader, PRIORITY_TONE, Skeleton, fmtDateTime, useToast } from '../ui';

const KINDS: [string, string][] = [['missing_info', 'Missing business information'], ['unanswered_review', 'Unanswered reviews'], ['negative_review', 'New negative reviews'], ['outdated_hours', 'Hours and holiday hours'], ['services', 'Incomplete services'], ['content', 'Content opportunities'], ['performance', 'Performance declines'], ['security', 'Security warnings']];

export default function AutomationPage() {
  const { api, dash, go, setLocation, reload } = useGrowth();
  const toast = useToast();
  const q = useLoad(() => api<InboxItem[]>('/growth/inbox'), []);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [running, setRunning] = useState(false);
  const [settings, setSettings] = useState<{ enabled: boolean; kinds: Record<string, boolean> }>({ enabled: dash?.automation.enabled ?? true, kinds: {} });
  type Auto = { automation: { enabled: boolean; lastRunAt?: string }; notifications: { kinds: Record<string, boolean> } };
  const cfg = useLoad(() => api<Auto>('/growth/automation'), []);
  useEffect(() => {
    if (cfg.data) setSettings({ enabled: cfg.data.automation.enabled, kinds: cfg.data.notifications.kinds ?? {} });
  }, [cfg.data]);

  const run = async () => { setRunning(true); try { const r = await api<any>('/growth/automation/run', { method: 'POST', json: {} }); toast('ok', `Checked ${r.locations} location${r.locations === 1 ? '' : 's'}. ${r.items} open recommendation${r.items === 1 ? '' : 's'}.`); q.reload(); reload(); } catch (e: any) { toast('danger', e.message); } finally { setRunning(false); } };
  const setStatus = async (i: InboxItem, status: 'done' | 'dismissed') => { try { await api(`/growth/inbox/${i.id}`, { method: 'POST', json: { status } }); q.reload(); reload(); } catch (e: any) { toast('danger', e.message); } };
  const save = async (next: typeof settings) => { setSettings(next); try { await api('/growth/automation', { method: 'PUT', json: { enabled: next.enabled, notifications: { kinds: next.kinds } } }); reload(); } catch (e: any) { toast('danger', e.message); } };
  const items = (q.data ?? []).filter((i) => filter === 'all' || i.status === 'open' || i.status === 'prepared');

  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Recommendations" description="We regularly re-check your profiles and list what needs attention. Suggestions are prepared for you; nothing is published without your approval."
        actions={<Button variant="primary" icon={<Play size={15} />} loading={running} onClick={run}>Check now</Button>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title={`Inbox (${items.length})`} actions={<div className="g-tabs" role="tablist" aria-label="Filter"><button type="button" role="tab" aria-selected={filter === 'open'} onClick={() => setFilter('open')}>Open</button><button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>All</button></div>}>
          {q.loading ? <Skeleton h={200} /> : q.error ? <Alert tone="danger" title={q.error} /> : !items.length ? <Empty icon={<CheckCircle2 size={20} />} title="You’re all caught up" body="New recommendations appear here after each check." /> : (
            <ul className="space-y-2">{items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start gap-3 rounded-xl p-3" style={{ background: 'var(--g-raised)', opacity: i.status === 'done' || i.status === 'dismissed' ? 0.6 : 1 }}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold">{i.title}</span><Badge tone={PRIORITY_TONE[i.priority]}>{i.priority}</Badge>{i.status !== 'open' && <Badge>{i.status}</Badge>}</div>
                  <p className="g-muted text-[13px]">{i.detail}</p>
                  <p className="g-faint text-[12px]">{i.locationTitle} · {fmtDateTime(i.createdAt)}</p>
                </div>
                {(i.status === 'open' || i.status === 'prepared') && <div className="flex gap-1.5">
                  {i.action && <Button size="sm" variant="primary" onClick={() => { if (i.location) setLocation(i.location); go(routeForAction(i.action!.type), { focus: i.action!.type }); }}>{i.action.label}</Button>}
                  <Button size="sm" onClick={() => setStatus(i, 'done')}>Done</Button>
                  <button type="button" className="g-icon-btn" aria-label="Dismiss" onClick={() => setStatus(i, 'dismissed')}><X size={15} /></button>
                </div>}
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Bell size={16} aria-hidden />Settings</span>}>
          <label className="mb-3 flex items-center gap-2.5 text-[13.5px] font-medium"><input type="checkbox" checked={settings.enabled} onChange={(e) => save({ ...settings, enabled: e.target.checked })} />Automatic checks (every few hours)</label>
          <p className="g-label">Notify me about</p>
          <ul className="space-y-1.5">{KINDS.map(([k, label]) => (
            <li key={k}><label className="flex items-center gap-2.5 text-[13.5px]"><input type="checkbox" checked={settings.kinds[k] !== false} onChange={(e) => save({ ...settings, kinds: { ...settings.kinds, [k]: e.target.checked } })} />{label}</label></li>
          ))}</ul>
          <p className="g-faint mt-3 text-[12px]">Notifications appear in this inbox. {dash?.automation.lastRunAt ? `Last check ${fmtDateTime(dash.automation.lastRunAt)}.` : 'No automatic check yet.'}</p>
        </Card>
      </div>
    </div>
  );
}
