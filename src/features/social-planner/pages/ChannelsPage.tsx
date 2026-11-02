/**
 * Channels — the Social Planner's home. A channel list on the left (every
 * connected account, grouped per platform) and, on the right, either the
 * all-channels board or one channel's queue, drafts, sent and failed posts.
 */
import React, { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Hash, Image as ImageIcon, LayoutGrid, Plug, Plus, RefreshCw, Search, Send } from 'lucide-react';
import { addDays, formatDateTime, startOfDay } from '../domain/calendar';
import { ALL_PLATFORMS, PLATFORMS, postTitle, type PlannerPost, type PlatformId } from '../domain/model';
import { buildChannels, channelTotals, filterByTab, postsForPlatform, type ChannelSummary, type ChannelTab } from '../domain/channels';
import { usePlanner } from '../state/PlannerStore';
import { usePrefs } from '../state/prefs';
import { usePreview } from '../components/posts';
import { Button, EmptyState, ErrorState, PlatformGlyph, PlatformTile, Skeleton, StatusBadge, cx } from '../ui/kit';

const TABS: { id: ChannelTab; label: string }[] = [
  { id: 'queue', label: 'Queue' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'sent', label: 'Sent' },
  { id: 'failed', label: 'Failed' },
];

type Selection = 'all' | string; // channel key

export interface ChannelsPageProps {
  compact?: boolean;
  onCompose: (iso?: string, platforms?: PlatformId[]) => void;
  onOpenAccounts: () => void;
  onOpenCalendar: () => void;
  /** Controlled selection (so the shell's sidebar can open a channel). */
  selected: string;
  onSelect: (key: string) => void;
}

function Stat({ label, value, icon, tone }: { label: string; value: number | string; icon: React.ReactNode; tone?: 'danger' | 'success' }) {
  return (
    <div className="sp-card flex items-center gap-3 p-3.5">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl" aria-hidden
        style={{ background: tone === 'danger' ? 'rgba(239,68,68,.14)' : tone === 'success' ? 'rgba(34,197,94,.14)' : 'var(--sp-accent-tint)', color: tone === 'danger' ? 'var(--sp-danger)' : tone === 'success' ? 'var(--sp-success)' : 'var(--sp-accent-text)' }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="display num text-[20px] font-semibold leading-none">{value}</p>
        <p className="sp-muted mt-1 truncate text-[12px]">{label}</p>
      </div>
    </div>
  );
}

function ChannelAvatar({ platform, size = 34, connected = true }: { platform: PlatformId; size?: number; connected?: boolean }) {
  return (
    <span className="relative flex-none" style={{ width: size, height: size }}>
      <span className="flex h-full w-full items-center justify-center rounded-full" style={{ background: PLATFORMS[platform].chip }} aria-hidden>
        <PlatformGlyph id={platform} size={size * 0.48} color="#fff" />
      </span>
      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full" aria-hidden
        style={{ background: connected ? 'var(--sp-success)' : 'var(--sp-faint)', boxShadow: '0 0 0 2px var(--sp-sidebar)' }} />
    </span>
  );
}

function ChannelList({ channels, selected, onSelect, onConnect, loading }: {
  channels: ChannelSummary[]; selected: Selection; onSelect: (s: Selection) => void; onConnect: () => void; loading: boolean;
}) {
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const shown = term ? channels.filter((c) => c.handle.toLowerCase().includes(term) || PLATFORMS[c.platform].label.toLowerCase().includes(term)) : channels;
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between px-1">
        <p className="display text-[15px] font-semibold">Channels</p>
        <span className="sp-faint num text-[12px]">{channels.filter((c) => c.connected).length} connected</span>
      </div>
      <div className="relative">
        <Search size={14} className="sp-faint absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
        <input className="sp-input" style={{ paddingLeft: 32, height: 36 }} type="search" placeholder="Find a channel" aria-label="Find a channel" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Channel list">
        <li>
          <button type="button" className="sp-nav-item" aria-current={selected === 'all' ? 'page' : undefined} onClick={() => onSelect('all')}>
            <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full" style={{ background: 'var(--sp-surface-3)' }} aria-hidden><LayoutGrid size={16} /></span>
            <span className="min-w-0 flex-1 truncate">All channels</span>
          </button>
        </li>
        {loading && [0, 1, 2].map((i) => <li key={i} className="px-2 py-1.5"><Skeleton style={{ height: 34 }} /></li>)}
        {shown.map((c) => (
          <li key={c.key}>
            <button type="button" className="sp-nav-item" style={{ height: 52 }} aria-current={selected === c.key ? 'page' : undefined} onClick={() => onSelect(c.key)}>
              <ChannelAvatar platform={c.platform} connected={c.connected} />
              <span className="min-w-0 flex-1 text-left leading-tight">
                <span className="block truncate text-[13.5px]" style={{ color: 'var(--sp-text)' }}>{c.handle}</span>
                <span className="sp-faint block truncate text-[11.5px]">{PLATFORMS[c.platform].label}{c.connected ? '' : ' · not connected'}</span>
              </span>
              {c.failed > 0 ? <span className="sp-badge" style={{ background: 'var(--sp-danger-strong)' }} aria-label={`${c.failed} failed`}>{c.failed}</span>
                : c.queued > 0 ? <span className="sp-badge" aria-label={`${c.queued} queued`}>{c.queued}</span> : null}
            </button>
          </li>
        ))}
        {!loading && term && !shown.length && <li className="sp-faint px-3 py-2 text-[12.5px]">No channel matches “{q.trim()}”.</li>}
      </ul>
      <Button icon={<Plus size={15} />} onClick={onConnect} className="w-full justify-center">Connect channel</Button>
    </div>
  );
}

function PostRow({ post, onEdit }: { post: PlannerPost; onEdit: (p: PlannerPost) => void }) {
  const { prefs } = usePrefs();
  const { open } = usePreview();
  const d = new Date(post.scheduledAt);
  return (
    <li className="sp-card flex min-w-0 items-start gap-3 p-3.5">
      <div className="flex w-12 flex-none flex-col items-center rounded-xl py-1.5" style={{ background: 'var(--sp-surface-2)' }} aria-hidden>
        <span className="sp-faint text-[10.5px] font-semibold uppercase">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
        <span className="display num text-[18px] font-semibold leading-none">{d.getDate()}</span>
      </div>
      <button type="button" className="min-w-0 flex-1 text-left" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
        onClick={(e) => open(post, e.currentTarget, true)} aria-label={`Preview: ${postTitle(post, 60)}`}>
        <p className="line-clamp-2 text-[13.5px] leading-snug">{post.content || <span className="sp-faint">Untitled post</span>}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          <StatusBadge status={post.status} />
          <span className="sp-muted num">{formatDateTime(post.scheduledAt, prefs.hour12)}</span>
          <span className="flex items-center gap-1">{post.platforms.map((id) => <PlatformTile key={id} id={id} size={16} />)}</span>
          {post.mediaUrls.length > 0 && <span className="sp-faint flex items-center gap-1"><ImageIcon size={12} aria-hidden />{post.mediaUrls.length}</span>}
        </div>
        {post.status === 'failed' && post.failureReason && <p className="mt-1.5 text-[12px]" style={{ color: '#fca5a5' }}>{post.failureReason}</p>}
      </button>
      {post.status !== 'published' && post.status !== 'publishing' && (
        <Button size="sm" variant="ghost" onClick={() => onEdit(post)}>Edit</Button>
      )}
    </li>
  );
}

function ChannelCard({ c, onOpen, onCompose }: { c: ChannelSummary; onOpen: () => void; onCompose: () => void }) {
  const { prefs } = usePrefs();
  return (
    <li className="sp-card flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <ChannelAvatar platform={c.platform} size={40} connected={c.connected} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{c.handle}</p>
          <p className="sp-faint text-[12px]">{PLATFORMS[c.platform].label}{PLATFORMS[c.platform].autoPublish ? ' · auto-publish' : ' · reminder publish'}</p>
        </div>
        {!c.connected && <span className="sp-status sp-status-draft"><Plug size={12} aria-hidden />Not connected</span>}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {([['Queued', c.queued], ['Sent', c.published], ['Failed', c.failed]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl py-2" style={{ background: 'var(--sp-surface-2)' }}>
            <dt className="sp-faint text-[11px]">{k}</dt>
            <dd className="display num text-[16px] font-semibold" style={k === 'Failed' && v ? { color: 'var(--sp-danger)' } : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="sp-muted truncate text-[12.5px]">
        <CalendarClock size={13} className="mr-1 inline -translate-y-px" aria-hidden />
        {c.nextPost ? <>Next: {formatDateTime(c.nextPost.scheduledAt, prefs.hour12)} — {postTitle(c.nextPost, 36)}</> : 'Nothing queued'}
      </p>
      <div className="mt-auto flex gap-2">
        <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={onCompose}>Create post</Button>
        <Button size="sm" onClick={onOpen}>Open<ChevronRight size={14} aria-hidden /></Button>
      </div>
    </li>
  );
}

export function ChannelsPage({ compact, onCompose, onOpenAccounts, onOpenCalendar, selected, onSelect }: ChannelsPageProps) {
  const { posts, useRange, accounts, accountsState, reloadAccounts } = usePlanner();
  const { onEdit } = usePreview();
  const { from, to } = useMemo(() => { const t = startOfDay(new Date()); return { from: addDays(t, -60), to: addDays(t, 91) }; }, []);
  const range = useRange(from, to);
  const [tab, setTab] = useState<ChannelTab>('queue');

  const inRange = useMemo(() => posts.filter((p) => { const t = new Date(p.scheduledAt).getTime(); return t >= from.getTime() && t <= to.getTime(); }), [posts, from, to]);
  const channels = useMemo(() => buildChannels(accounts ?? [], inRange), [accounts, inRange]);
  const totals = channelTotals(channels, inRange);
  const channel = selected === 'all' ? null : channels.find((c) => c.key === selected) ?? null;
  const unconnected = ALL_PLATFORMS.filter((id) => !channels.some((c) => c.connected && c.platform === id));

  const scoped = postsForPlatform(inRange, channel?.platform ?? null);
  const counts = Object.fromEntries(TABS.map((t) => [t.id, filterByTab(scoped, t.id).length])) as Record<ChannelTab, number>;
  const list = filterByTab(scoped, tab);
  const loading = accountsState.status === 'loading' && !accounts;

  const select = (s: Selection) => { onSelect(s); setTab('queue'); };

  const listPanel = (
    <ChannelList channels={channels} selected={selected} onSelect={select} onConnect={onOpenAccounts} loading={loading} />
  );

  return (
    <div className="flex h-full min-h-0">
      {!compact && (
        <aside className="h-full w-[280px] flex-none" style={{ borderRight: '1px solid var(--sp-border)', background: 'var(--sp-sidebar)' }}>{listPanel}</aside>
      )}
      <section className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6" aria-live="polite">
        {compact && (
          <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Channels">
            <button type="button" role="tab" aria-selected={selected === 'all'} className="sp-pill" aria-pressed={selected === 'all'} onClick={() => select('all')}><LayoutGrid size={14} />All</button>
            {channels.map((c) => (
              <button key={c.key} type="button" role="tab" aria-selected={selected === c.key} className="sp-pill" aria-pressed={selected === c.key} onClick={() => select(c.key)}>
                <PlatformGlyph id={c.platform} size={14} color={PLATFORMS[c.platform].dot} /><span className="max-w-[140px] truncate">{c.handle}</span>
              </button>
            ))}
            <button type="button" className="sp-pill" onClick={onOpenAccounts}><Plus size={14} />Connect</button>
          </div>
        )}

        {accountsState.status === 'error' && !accounts ? (
          <ErrorState title="Couldn’t load your channels" message={accountsState.error} onRetry={reloadAccounts} />
        ) : !channel ? (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="display text-[22px] font-semibold">All channels</h2>
                <p className="sp-muted mt-0.5 text-[13px]">Every connected account in one place. Pick a channel to see its queue.</p>
              </div>
              <div className="flex gap-2">
                <Button icon={<CalendarClock size={15} />} onClick={onOpenCalendar}>Calendar</Button>
                <Button variant="primary" icon={<Plus size={15} />} onClick={() => onCompose()}>Create post</Button>
              </div>
            </div>
            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Channels" value={totals.connected} icon={<Hash size={17} />} />
              <Stat label="Queued" value={totals.queued} icon={<CalendarClock size={17} />} />
              <Stat label="Sent · 60 days" value={totals.published} icon={<CheckCircle2 size={17} />} tone="success" />
              <Stat label="Failed" value={totals.failed} icon={<AlertTriangle size={17} />} tone={totals.failed ? 'danger' : undefined} />
            </div>
            {range.status === 'error' && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-[13px]" role="alert" style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.35)' }}>
                <span>{range.error}</span><Button size="sm" icon={<RefreshCw size={14} />} onClick={range.reload}>Retry</Button>
              </div>
            )}
            {loading ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 210 }} />)}</div>
            ) : !channels.length ? (
              <EmptyState icon={<Send size={20} />} title="Connect your first channel"
                body="Link Instagram, LinkedIn, X and more to schedule and publish from one queue."
                action={<Button variant="primary" icon={<Plus size={15} />} onClick={onOpenAccounts}>Connect a channel</Button>} />
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {channels.map((c) => <ChannelCard key={c.key} c={c} onOpen={() => select(c.key)} onCompose={() => onCompose(undefined, [c.platform])} />)}
              </ul>
            )}
            {!loading && unconnected.length > 0 && (
              <div className="mt-8">
                <p className="sp-faint mb-3 text-[11px] font-semibold uppercase tracking-[0.1em]">Add more channels</p>
                <div className="flex flex-wrap gap-2">
                  {unconnected.map((id) => (
                    <button key={id} type="button" className="sp-pill" onClick={onOpenAccounts}>
                      <PlatformGlyph id={id} size={14} color={PLATFORMS[id].dot} />{PLATFORMS[id].label}<Plus size={13} aria-hidden />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center gap-4">
              <ChannelAvatar platform={channel.platform} size={52} connected={channel.connected} />
              <div className="min-w-0 flex-1">
                <h2 className="display truncate text-[22px] font-semibold">{channel.handle}</h2>
                <p className="sp-muted text-[13px]">
                  {PLATFORMS[channel.platform].label} · {channel.connected ? 'Connected' : 'Not connected'} · {PLATFORMS[channel.platform].charLimit.toLocaleString()} character limit
                  {PLATFORMS[channel.platform].requiresMedia ? ' · media required' : ''}
                </p>
              </div>
              <div className="flex gap-2">
                {!channel.connected && <Button icon={<Plug size={15} />} onClick={onOpenAccounts}>Connect</Button>}
                <Button variant="primary" icon={<Plus size={15} />} onClick={() => onCompose(undefined, [channel.platform])}>Create post</Button>
              </div>
            </div>

            <div role="tablist" aria-label="Posts" className="mb-4 flex gap-1 overflow-x-auto" style={{ borderBottom: '1px solid var(--sp-border)' }}>
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                  className={cx('flex items-center gap-2 px-3.5 pb-2.5 pt-1 text-[13.5px] font-semibold')}
                  style={{ background: 'none', border: 0, borderBottom: `2px solid ${tab === t.id ? 'var(--sp-accent)' : 'transparent'}`, color: tab === t.id ? 'var(--sp-text)' : 'var(--sp-muted)', cursor: 'pointer', font: 'inherit', marginBottom: -1 }}>
                  {t.label}
                  <span className="num rounded-full px-1.5 text-[11px]" style={{ background: t.id === 'failed' && counts.failed ? 'var(--sp-danger-strong)' : 'var(--sp-surface-3)', color: 'var(--sp-text)' }}>{counts[t.id]}</span>
                </button>
              ))}
            </div>

            {range.status === 'loading' && !list.length ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: 84 }} />)}</div>
            ) : range.status === 'error' ? (
              <ErrorState title="Posts couldn’t be loaded" message={range.error} onRetry={range.reload} />
            ) : !list.length ? (
              <EmptyState icon={<CalendarClock size={20} />}
                title={tab === 'queue' ? 'Your queue is empty' : tab === 'drafts' ? 'No drafts' : tab === 'sent' ? 'Nothing sent yet' : 'No failed posts'}
                body={tab === 'queue' ? `Schedule a post for ${channel.handle} and it will show up here.` : undefined}
                action={tab === 'queue' || tab === 'drafts' ? <Button variant="primary" icon={<Plus size={15} />} onClick={() => onCompose(undefined, [channel.platform])}>Create post</Button> : undefined} />
            ) : (
              <ul className="space-y-2.5">{list.map((p) => <PostRow key={p.id} post={p} onEdit={onEdit} />)}</ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
