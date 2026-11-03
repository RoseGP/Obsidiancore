/** Main dashboard: health, key Google metrics, top recommendations, quick actions. */
import React from 'react';
import { ArrowRight, BarChart3, Bot, ClipboardCheck, Eye, Megaphone, MessageSquareText, MousePointerClick, Navigation, Phone, ShieldCheck, Star, Swords, Wand2 } from 'lucide-react';
import { AREA_LABEL } from '../api';
import { routeForAction, useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Bar, Button, Card, Empty, PRIORITY_TONE, ScoreRing, Skeleton, Stat, fmtDate, fmtNum } from '../ui';

export default function DashboardPage() {
  const { dash, location, go, api } = useGrowth();
  const entry = dash?.locations.find((l) => l.location.name === location?.name);
  const audit = entry?.growthAudit;
  const perf = useLoad(() => (location ? api<any>(`/growth/analytics?location=${encodeURIComponent(location.name)}&days=30`) : Promise.resolve(null)), [location?.name]);
  const t = perf.data?.current?.totals;
  const greet = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';

  if (!location || !entry) return <Empty title="No location selected" body="Choose the locations you manage in Settings." action={<Button onClick={() => go('settings')}>Open settings</Button>} />;

  const sec = dash!.security.status;
  return (
    <div className="space-y-6 g-fade">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="g-muted text-[13.5px]">{greet}</p>
          <h1 className="text-[26px] font-bold">{location.title}</h1>
          <p className="g-faint mt-1 text-[12.5px]">{[location.primaryCategory, location.address?.city].filter(Boolean).join(' · ')}{audit ? ` · last audit ${fmtDate(audit.generatedAt)}` : ' · not audited yet'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<ClipboardCheck size={15} />} onClick={() => go('audit')}>{audit ? 'Run new audit' : 'Run first audit'}</Button>
          <Button icon={<Bot size={15} />} onClick={() => go('assistant')}>Ask AI</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)]">
        <Card title="Profile Health" description="This app’s assessment of your profile, not a Google score.">
          {audit ? (
            <div className="flex flex-wrap items-center gap-6">
              <ScoreRing value={audit.overall} size={128} label="Profile Health" />
              <ul className="min-w-[180px] flex-1 space-y-2.5">
                {(Object.keys(audit.areas) as (keyof typeof audit.areas)[]).map((a) => (
                  <li key={a}>
                    <div className="mb-1 flex justify-between text-[12.5px]"><span className="g-muted">{AREA_LABEL[a]}</span><span className="g-num font-semibold">{audit.areas[a] ?? '–'}</span></div>
                    <Bar value={audit.areas[a]} />
                  </li>
                ))}
              </ul>
            </div>
          ) : <Empty icon={<ClipboardCheck size={20} />} title="No audit yet" body="Run an audit to get your Profile Health score and a prioritised to-do list." action={<Button variant="primary" onClick={() => go('audit')}>Run audit</Button>} />}
        </Card>

        <Card title="What to do next" description="The five improvements with the most expected benefit." actions={audit?.topIssues.length ? <Button size="sm" variant="ghost" onClick={() => go('audit')}>See all</Button> : undefined}>
          {!audit ? <p className="g-muted text-[13.5px]">Recommendations appear after your first audit.</p>
            : !audit.topIssues.length ? <Alert tone="ok" title="Nothing urgent. Your profile is in great shape." />
            : (
              <ol className="space-y-2">
                {audit.topIssues.map((i, n) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl p-3" style={{ background: 'var(--g-raised)' }}>
                    <span className="g-num g-faint w-4 text-[13px] font-bold">{n + 1}</span>
                    <span className="min-w-0 flex-1 basis-[13rem]"><span className="block text-[14px] font-semibold">{i.issue.title}</span><span className="g-muted block text-[12.5px]">{i.issue.description}</span></span>
                    <Badge tone={PRIORITY_TONE[i.issue.priority]}>{i.issue.priority}</Badge>
                    <Button size="sm" onClick={() => go(routeForAction(i.issue.action.type), { focus: i.issue.action.type })}>{i.issue.action.label}<ArrowRight size={13} aria-hidden /></Button>
                  </li>
                ))}
              </ol>
            )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Local SEO score" value={audit?.areas.localSeo ?? '–'} sub="out of 100" source="app" icon={<Wand2 size={14} aria-hidden />} onClick={() => go('optimize')} />
        <Stat label="Completeness" value={audit?.areas.completeness ?? '–'} sub="out of 100" source="app" icon={<ClipboardCheck size={14} aria-hidden />} onClick={() => go('audit')} />
        <Stat label="Average rating" value={entry.averageRating ?? '–'} sub="from synced reviews" source="google" icon={<Star size={14} aria-hidden />} onClick={() => go('reviews')} />
        <Stat label="Total reviews" value={fmtNum(entry.reviewCount)} sub={entry.unanswered ? <span style={{ color: 'var(--g-warn)' }}>{entry.unanswered} unanswered</span> : 'all answered'} icon={<MessageSquareText size={14} aria-hidden />} onClick={() => go('reviews')} />
        <Stat label="Security" value={sec === 'ok' ? 'Good' : sec === 'attention' ? 'Check' : sec === 'reconnect_required' ? 'Reconnect' : '—'} tone={sec === 'ok' ? 'var(--g-ok)' : 'var(--g-warn)'} sub={dash!.security.alerts ? `${dash!.security.alerts} alerts` : 'no alerts'} icon={<ShieldCheck size={14} aria-hidden />} onClick={() => go('security')} />
        {perf.loading ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={104} />) : perf.error ? (
          <div className="col-span-2 md:col-span-5"><Alert tone="warn" title="Performance data isn’t available">{perf.error}</Alert></div>
        ) : (
          <>
            <Stat label="Profile views" value={fmtNum(t?.impressions)} sub="30 days" source="google" icon={<Eye size={14} aria-hidden />} onClick={() => go('analytics')} />
            <Stat label="Search & Maps visibility" value={fmtNum(t?.searchImpressions)} sub="search views, 30 days" source="google" icon={<BarChart3 size={14} aria-hidden />} onClick={() => go('visibility')} />
            <Stat label="Calls" value={fmtNum(t?.calls)} sub="30 days" source="google" icon={<Phone size={14} aria-hidden />} onClick={() => go('analytics')} />
            <Stat label="Website clicks" value={fmtNum(t?.websiteClicks)} sub="30 days" source="google" icon={<MousePointerClick size={14} aria-hidden />} onClick={() => go('analytics')} />
            <Stat label="Direction requests" value={fmtNum(t?.directions)} sub="30 days" source="google" icon={<Navigation size={14} aria-hidden />} onClick={() => go('analytics')} />
          </>
        )}
      </div>

      <Card title="Quick actions">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {([['Run new audit', ClipboardCheck, 'audit'], ['Optimize my profile', Wand2, 'optimize'], ['Generate Google post', Megaphone, 'posts'], ['Respond to reviews', MessageSquareText, 'reviews'], ['Analyze competitors', Swords, 'competitors'], ['Ask AI assistant', Bot, 'assistant']] as const).map(([label, I, r]) => (
            <button key={label} type="button" onClick={() => go(r)} className="flex flex-col items-start gap-2 rounded-xl p-3.5 text-left" style={{ background: 'var(--g-raised)', border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--g-accent-tint)', color: 'var(--g-accent)' }}><I size={16} aria-hidden /></span>
              <span className="text-[13.5px] font-semibold">{label}</span>
            </button>
          ))}
        </div>
      </Card>

      {!dash!.aiConfigured && <Alert tone="info" title="AI features are off">An administrator can set GEMINI_API_KEY to turn on AI writing, optimisation and the assistant. Audits, reviews, posts and analytics work without it.</Alert>}

      <Card title="Recent activity">
        {dash!.activity.length ? (
          <ul className="space-y-2 text-[13px]">{dash!.activity.slice(0, 8).map((a, i) => <li key={i} className="flex gap-3"><span className="g-faint g-num w-[92px] flex-none">{fmtDate(a.at)}</span><span>{a.message}</span></li>)}</ul>
        ) : <p className="g-muted text-[13.5px]">No activity yet.</p>}
      </Card>
    </div>
  );
}
