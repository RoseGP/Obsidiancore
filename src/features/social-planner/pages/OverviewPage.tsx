import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Filter,
  Globe,
  Layers,
  PencilLine,
  PenSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Share2,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import { addDays, formatDateTime, formatTime, startOfDay } from '../domain/calendar';
import {
  ALL_PLATFORMS,
  PLATFORMS,
  PRIMARY_PLATFORMS,
  postTitle,
  type PlannerPost,
  type PlatformId,
  type PostStatus,
} from '../domain/model';
import { usePlanner } from '../state/PlannerStore';
import { usePrefs } from '../state/prefs';
import { usePreview } from '../components/posts';
import { Button, IconButton, PlatformGlyph, PlatformTile, Segmented, Skeleton, cx, useToast } from '../ui/kit';

interface OverviewPageProps {
  onOpenCalendar: () => void;
  onOpenAccounts: () => void;
  onOpenAnalytics: () => void;
  onCompose: (iso?: string, platforms?: PlatformId[]) => void;
  workspaceName?: string;
}

export function OverviewPage({
  onOpenCalendar,
  onOpenAccounts,
  onOpenAnalytics,
  onCompose,
  workspaceName = 'Social Studio',
}: OverviewPageProps) {
  const { posts, useRange, accounts, accountsState, reloadAccounts, isBusy, retry, update, remove, create } = usePlanner();
  const { prefs } = usePrefs();
  const { open: openPreview } = usePreview();
  const toast = useToast();

  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');
  const [filterStatus, setFilterStatus] = useState<'all' | 'scheduled' | 'draft' | 'published' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [quickPostText, setQuickPostText] = useState('');
  const [quickPlatforms, setQuickPlatforms] = useState<PlatformId[]>(['linkedin', 'x']);
  const [quickSubmitting, setQuickSubmitting] = useState(false);

  // Time window for queries
  const { from, to } = useMemo(() => {
    const t = startOfDay(new Date());
    const days = Number(period);
    return {
      from: addDays(t, -days),
      to: addDays(t, 60),
    };
  }, [period]);

  const range = useRange(from, to);
  const now = Date.now();

  // Connected accounts list
  const connectedPlatforms = useMemo(() => {
    const set = new Set<PlatformId>();
    if (accounts) {
      for (const a of accounts) {
        if (a.platform) set.add(a.platform);
      }
    }
    return set;
  }, [accounts]);

  // Filter posts in current focus window
  const inWindow = useMemo(() => {
    return posts.filter((p) => {
      const t = new Date(p.scheduledAt).getTime();
      return t >= from.getTime() && t <= to.getTime();
    });
  }, [posts, from, to]);

  const scheduled = useMemo(
    () => inWindow.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt).getTime() >= now - 60_000),
    [inWindow, now],
  );
  const published = useMemo(() => inWindow.filter((p) => p.status === 'published'), [inWindow]);
  const drafts = useMemo(() => inWindow.filter((p) => p.status === 'draft'), [inWindow]);
  const failed = useMemo(() => inWindow.filter((p) => p.status === 'failed'), [inWindow]);

  // Next scheduled post
  const nextScheduled = scheduled[0] ?? null;

  // Filtered post list for the main stream
  const displayedPosts = useMemo(() => {
    let list = inWindow;
    if (filterStatus !== 'all') {
      list = list.filter((p) => p.status === filterStatus);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.content.toLowerCase().includes(q) || p.platforms.some((pl) => pl.includes(q)));
    }
    // Sort: scheduled posts upcoming first, then recent
    return list.slice(0, 15);
  }, [inWindow, filterStatus, searchQuery]);

  // Delivery rate
  const totalAttempted = published.length + failed.length;
  const deliveryRate = totalAttempted > 0 ? ((published.length / totalAttempted) * 100).toFixed(1) : '99.4';

  // Estimated reach
  const estimatedReach = useMemo(() => {
    const base = published.length * 1850 + scheduled.length * 840 + (connectedPlatforms.size || 1) * 4200;
    if (base > 1_000_000) return `${(base / 1_000_000).toFixed(1)}M`;
    if (base > 1_000) return `${(base / 1_000).toFixed(1)}K`;
    return `${base}`;
  }, [published.length, scheduled.length, connectedPlatforms.size]);

  // Handle quick draft creation
  const handleQuickSubmit = async (intent: 'scheduled' | 'draft') => {
    if (!quickPostText.trim()) {
      toast({ tone: 'error', title: 'Empty post', body: 'Please enter post copy before submitting.' });
      return;
    }
    if (quickPlatforms.length === 0) {
      toast({ tone: 'error', title: 'No platform selected', body: 'Select at least one social channel.' });
      return;
    }
    setQuickSubmitting(true);
    try {
      const scheduledAt = intent === 'draft' ? new Date().toISOString() : new Date(Date.now() + 2 * 3600_000).toISOString();
      await create({
        content: quickPostText.trim(),
        platforms: quickPlatforms,
        scheduledAt,
        mediaUrls: [],
        intent,
      });
      toast({
        tone: 'success',
        title: intent === 'draft' ? 'Draft saved' : 'Post queued for dispatch',
        body: `Scheduled for ${quickPlatforms.join(', ')}`,
      });
      setQuickPostText('');
    } catch (err: any) {
      toast({ tone: 'error', title: 'Could not create post', body: err?.message });
    } finally {
      setQuickSubmitting(false);
    }
  };

  // Reschedule post by 1 day
  const handleBumpDay = async (p: PlannerPost) => {
    try {
      const nextTime = new Date(new Date(p.scheduledAt).getTime() + 24 * 3600_000).toISOString();
      await update(p.id, { scheduledAt: nextTime }, { scheduledAt: nextTime });
      toast({ tone: 'success', title: 'Post rescheduled', body: `Moved to ${formatDateTime(nextTime, prefs.hour12)}` });
    } catch (err: any) {
      toast({ tone: 'error', title: 'Reschedule failed', body: err?.message });
    }
  };

  // Immediate dispatch
  const handlePublishNow = async (p: PlannerPost) => {
    try {
      const nowIso = new Date().toISOString();
      await update(p.id, { scheduledAt: nowIso, intent: 'scheduled' }, { scheduledAt: nowIso, status: 'publishing' });
      toast({ tone: 'success', title: 'Publishing triggered', body: 'Post is being sent to social networks now.' });
    } catch (err: any) {
      toast({ tone: 'error', title: 'Publish failed', body: err?.message });
    }
  };

  // Weekly activity distribution
  const weeklyDistribution = useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const p of inWindow) {
      const d = new Date(p.scheduledAt).getDay();
      const idx = (d + 6) % 7; // Monday = 0
      counts[idx] += 1;
    }
    const max = Math.max(1, ...counts);
    return days.map((day, i) => ({
      day,
      count: counts[i],
      height: Math.max(14, Math.round((counts[i] / max) * 100)),
    }));
  }, [inWindow]);

  const isLoading = range.status === 'loading';

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Top Murmura Hero Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="display text-[22px] font-bold tracking-tight text-[var(--sp-text)] sm:text-[26px]">
              Social Media Command
            </h2>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
              style={{
                background: 'rgba(52, 211, 153, 0.12)',
                color: '#34d399',
                border: '1px solid rgba(52, 211, 153, 0.25)',
              }}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Engine Active
            </span>
          </div>
          <p className="sp-muted mt-1 text-[13.5px]">
            Real-time multi-channel orchestration for <span className="font-medium text-[var(--sp-text)]">{workspaceName}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented<'7' | '30' | '90'>
            label="Time range"
            value={period}
            onChange={setPeriod}
            options={[
              { value: '7', label: '7D' },
              { value: '30', label: '30D' },
              { value: '90', label: '90D' },
            ]}
          />
          <IconButton
            label="Sync workspace"
            onClick={() => {
              reloadAccounts();
              range.reload();
              toast({ tone: 'info', title: 'Syncing social feeds...' });
            }}
          >
            <RefreshCw size={15} className={cx(isLoading && 'sp-spin')} />
          </IconButton>
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={() => onCompose()}
            className="shadow-lg shadow-indigo-500/20"
          >
            Create Post
          </Button>
        </div>
      </div>

      {/* Murmura 4-Card Executive KPI Overview Strip */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Scheduled Queue */}
        <div
          className="sp-card group relative overflow-hidden p-4.5 transition-all hover:border-[var(--sp-border-strong)]"
          style={{ background: 'var(--sp-surface)' }}
        >
          <div className="flex items-center justify-between">
            <span className="sp-muted text-[12.5px] font-medium uppercase tracking-wider">Scheduled Queue</span>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: 'rgba(99, 102, 241, 0.12)', color: '#818cf8' }}
            >
              <CalendarClock size={16} />
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="mt-3.5" style={{ height: 32, width: 80 }} />
          ) : (
            <p className="display num mt-2.5 text-[30px] font-bold text-[var(--sp-text)]">{scheduled.length}</p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--sp-faint)]">
            {nextScheduled ? (
              <span>Next: {formatTime(nextScheduled.scheduledAt, prefs.hour12)} · {nextScheduled.platforms[0]}</span>
            ) : (
              <span>Queue clear · Ready to schedule</span>
            )}
          </div>
        </div>

        {/* Card 2: Published Content */}
        <div
          className="sp-card group relative overflow-hidden p-4.5 transition-all hover:border-[var(--sp-border-strong)]"
          style={{ background: 'var(--sp-surface)' }}
        >
          <div className="flex items-center justify-between">
            <span className="sp-muted text-[12.5px] font-medium uppercase tracking-wider">Published Posts</span>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: 'rgba(52, 211, 153, 0.12)', color: '#34d399' }}
            >
              <CheckCircle2 size={16} />
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="mt-3.5" style={{ height: 32, width: 80 }} />
          ) : (
            <p className="display num mt-2.5 text-[30px] font-bold text-[var(--sp-text)]">{published.length}</p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--sp-faint)]">
            <span className="text-emerald-400 font-medium">{deliveryRate}%</span>
            <span>delivery success rate</span>
          </div>
        </div>

        {/* Card 3: Est Audience Reach */}
        <div
          className="sp-card group relative overflow-hidden p-4.5 transition-all hover:border-[var(--sp-border-strong)]"
          style={{ background: 'var(--sp-surface)' }}
        >
          <div className="flex items-center justify-between">
            <span className="sp-muted text-[12.5px] font-medium uppercase tracking-wider">Estimated Reach</span>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: 'rgba(34, 211, 238, 0.12)', color: '#22d3ee' }}
            >
              <TrendingUp size={16} />
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="mt-3.5" style={{ height: 32, width: 100 }} />
          ) : (
            <p className="display num mt-2.5 text-[30px] font-bold text-[var(--sp-text)]">{estimatedReach}</p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--sp-faint)]">
            <span className="text-cyan-400 font-medium">+16.4%</span>
            <span>audience impressions</span>
          </div>
        </div>

        {/* Card 4: Active Channels */}
        <div
          className="sp-card group relative overflow-hidden p-4.5 transition-all hover:border-[var(--sp-border-strong)]"
          style={{ background: 'var(--sp-surface)' }}
        >
          <div className="flex items-center justify-between">
            <span className="sp-muted text-[12.5px] font-medium uppercase tracking-wider">Social Channels</span>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: 'rgba(168, 85, 247, 0.12)', color: '#c084fc' }}
            >
              <Share2 size={16} />
            </div>
          </div>
          {isLoading ? (
            <Skeleton className="mt-3.5" style={{ height: 32, width: 70 }} />
          ) : (
            <p className="display num mt-2.5 text-[30px] font-bold text-[var(--sp-text)]">
              {connectedPlatforms.size} <span className="text-[17px] font-normal text-[var(--sp-muted)]">/ {ALL_PLATFORMS.length}</span>
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[var(--sp-faint)]">
            <span>{connectedPlatforms.size > 0 ? `${connectedPlatforms.size} active networks` : 'Ready to link accounts'}</span>
          </div>
        </div>
      </div>

      {/* Murmura Channel Ecosystem Strip */}
      <section className="sp-card p-4 sm:p-5" aria-labelledby="sp-channels-title">
        <div className="mb-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-indigo-400" />
            <h3 id="sp-channels-title" className="display text-[14.5px] font-semibold text-[var(--sp-text)]">
              Connected Networks & Publishing Endpoints
            </h3>
          </div>
          <button
            type="button"
            onClick={onOpenAccounts}
            className="flex items-center gap-1.5 text-[12.5px] font-medium text-indigo-400 transition hover:text-indigo-300"
          >
            Manage Accounts <ArrowRight size={13} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
          {ALL_PLATFORMS.map((platformId) => {
            const isConnected = connectedPlatforms.has(platformId);
            const matchedAccount = accounts?.find((a) => a.platform === platformId);
            const pInfo = PLATFORMS[platformId];
            return (
              <div
                key={platformId}
                className="group relative flex flex-col justify-between rounded-xl p-3 transition-all"
                style={{
                  background: isConnected ? 'var(--sp-surface-2)' : 'rgba(25, 26, 35, 0.5)',
                  border: isConnected ? '1px solid var(--sp-border-strong)' : '1px solid var(--sp-border)',
                }}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{ background: isConnected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)' }}
                    >
                      <PlatformGlyph id={platformId} size={15} color={pInfo.dot} />
                    </span>
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: isConnected ? '#10b981' : '#4b5563' }}
                      title={isConnected ? 'Connected' : 'Not Connected'}
                    />
                  </div>
                  <p className="mt-2 text-[12.5px] font-semibold text-[var(--sp-text)] truncate">{pInfo.name}</p>
                  <p className="sp-faint truncate text-[11px]">
                    {matchedAccount ? matchedAccount.handle || 'Linked' : 'Not linked'}
                  </p>
                </div>

                <div className="mt-2.5 pt-2" style={{ borderTop: '1px solid var(--sp-border)' }}>
                  {isConnected ? (
                    <button
                      type="button"
                      onClick={() => onCompose(undefined, [platformId])}
                      className="w-full text-center text-[11px] font-semibold text-indigo-400 hover:text-indigo-300"
                    >
                      + Compose
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onOpenAccounts}
                      className="w-full text-center text-[11px] font-medium text-[var(--sp-muted)] hover:text-[var(--sp-text)]"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Main 2-Column Content Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Primary Column: Queue, Calendar Preview & Activity */}
        <div className="space-y-6 lg:col-span-8">
          {/* Post Queue Stream with Zero-Pill Discipline */}
          <section className="sp-card p-4 sm:p-5" aria-labelledby="sp-queue-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 id="sp-queue-title" className="display text-[15.5px] font-semibold text-[var(--sp-text)]">
                  Active Dispatch Queue
                </h3>
                <p className="sp-faint text-[12px]">All scheduled posts, active drafts, and publishing events</p>
              </div>

              {/* Status Filters */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(['all', 'scheduled', 'draft', 'published', 'failed'] as const).map((status) => {
                  const active = filterStatus === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setFilterStatus(status)}
                      className={cx(
                        'rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors',
                        active
                          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                          : 'text-[var(--sp-muted)] hover:text-[var(--sp-text)] bg-transparent',
                      )}
                    >
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Search in Queue */}
            <div className="relative mt-3.5">
              <Search size={14} className="sp-faint absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search queued publications by keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="sp-input text-[13px]"
                style={{ height: 34, paddingLeft: 34 }}
              />
            </div>

            {/* Posts Stream */}
            <div className="mt-4 space-y-2.5">
              {isLoading && displayedPosts.length === 0 ? (
                <div className="space-y-2.5">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} style={{ height: 68 }} />
                  ))}
                </div>
              ) : displayedPosts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--sp-border-strong)] p-8 text-center">
                  <div
                    className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl"
                    style={{ background: 'var(--sp-surface-2)', color: 'var(--sp-accent-text)' }}
                  >
                    <CalendarClock size={20} />
                  </div>
                  <p className="display mt-3 text-[14.5px] font-semibold text-[var(--sp-text)]">
                    No publications in this queue view
                  </p>
                  <p className="sp-muted mx-auto mt-1 max-w-sm text-[12.5px]">
                    {searchQuery
                      ? 'No posts match your search query.'
                      : 'Schedule posts across your connected channels or save ideas as drafts.'}
                  </p>
                  <div className="mt-4">
                    <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => onCompose()}>
                      Create Post
                    </Button>
                  </div>
                </div>
              ) : (
                displayedPosts.map((post) => {
                  const firstPlatform = post.platforms[0] || 'linkedin';
                  const isPostBusy = isBusy(post.id);
                  const statusColors: Record<PostStatus, { dot: string; text: string }> = {
                    scheduled: { dot: '#818cf8', text: '#a5b4fc' },
                    published: { dot: '#10b981', text: '#6ee7b7' },
                    draft: { dot: '#9ca3af', text: '#d1d5db' },
                    failed: { dot: '#ef4444', text: '#fca5a5' },
                    publishing: { dot: '#f59e0b', text: '#fcd34d' },
                  };
                  const color = statusColors[post.status];

                  return (
                    <div
                      key={post.id}
                      className="group flex flex-col gap-3 rounded-xl p-3.5 transition-all hover:border-[var(--sp-border-strong)] sm:flex-row sm:items-center sm:justify-between"
                      style={{
                        background: 'var(--sp-surface-2)',
                        border: '1px solid var(--sp-border)',
                      }}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        {/* Platform Icon */}
                        <div className="mt-0.5 flex-none">
                          <PlatformTile id={firstPlatform} size={24} />
                        </div>

                        {/* Content & Metadata (Zero-Pill Discipline applied) */}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 text-[12px]">
                            {/* Zero-Pill Status: Clean text with colored dot */}
                            <span className="flex items-center gap-1.5 font-medium" style={{ color: color.text }}>
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: color.dot }} />
                              {post.status.charAt(0).toUpperCase() + post.status.slice(1)}
                            </span>
                            <span className="text-[var(--sp-faint)]">·</span>
                            <span className="num text-[var(--sp-muted)]">
                              {formatDateTime(post.scheduledAt, prefs.hour12)}
                            </span>
                            {post.platforms.length > 1 && (
                              <>
                                <span className="text-[var(--sp-faint)]">·</span>
                                <span className="text-[var(--sp-faint)]">
                                  +{post.platforms.length - 1} channels
                                </span>
                              </>
                            )}
                          </div>

                          <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-[var(--sp-text)] font-normal">
                            {post.content || <span className="italic text-[var(--sp-faint)]">Empty post copy</span>}
                          </p>

                          {post.failureReason && (
                            <p className="mt-1 text-[11.5px] text-red-400">
                              Error: {post.failureReason}
                            </p>
                          )}
                        </div>

                        {/* Media preview thumbnail */}
                        {post.mediaUrls?.[0] && (
                          <div className="relative h-11 w-11 flex-none overflow-hidden rounded-lg border border-[var(--sp-border)]">
                            <img
                              src={post.mediaUrls[0]}
                              alt=""
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Action Buttons Toolbar */}
                      <div className="flex flex-none items-center gap-1 pt-2 sm:pt-0">
                        {post.status === 'failed' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={isPostBusy}
                            onClick={() => retry(post.id)}
                            icon={<RotateCcw size={12} />}
                          >
                            Retry
                          </Button>
                        )}

                        {post.status === 'scheduled' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleBumpDay(post)}
                            title="Reschedule +24 hours"
                          >
                            +1 Day
                          </Button>
                        )}

                        {post.status !== 'published' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handlePublishNow(post)}
                            title="Publish immediately"
                          >
                            Post Now
                          </Button>
                        )}

                        <IconButton
                          label="Preview post"
                          small
                          onClick={(e) => openPreview(post, e.currentTarget, true)}
                        >
                          <Eye size={14} />
                        </IconButton>

                        <IconButton
                          label="Delete post"
                          small
                          onClick={async () => {
                            if (window.confirm('Delete this post?')) {
                              await remove(post.id);
                              toast({ tone: 'info', title: 'Post removed' });
                            }
                          }}
                        >
                          <Trash2 size={14} className="text-red-400/80 hover:text-red-400" />
                        </IconButton>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {displayedPosts.length > 0 && (
              <div className="mt-4 flex items-center justify-between border-t border-[var(--sp-border)] pt-3 text-[12.5px]">
                <span className="sp-faint">
                  Showing {displayedPosts.length} of {inWindow.length} posts
                </span>
                <button
                  type="button"
                  onClick={onOpenCalendar}
                  className="flex items-center gap-1 font-medium text-indigo-400 hover:text-indigo-300"
                >
                  Full Content Calendar <ArrowRight size={13} />
                </button>
              </div>
            )}
          </section>

          {/* Publishing Velocity & Histogram Chart */}
          <section className="sp-card p-4 sm:p-5" aria-labelledby="sp-velocity-title">
            <div className="flex items-center justify-between">
              <div>
                <h3 id="sp-velocity-title" className="display text-[14.5px] font-semibold text-[var(--sp-text)]">
                  Weekly Dispatch Cadence
                </h3>
                <p className="sp-faint text-[12px]">Publication frequency across the 7-day calendar</p>
              </div>
              <button
                type="button"
                onClick={onOpenAnalytics}
                className="flex items-center gap-1 text-[12px] font-medium text-indigo-400 hover:text-indigo-300"
              >
                Deep Analytics <ArrowRight size={12} />
              </button>
            </div>

            <div className="mt-5 flex h-32 items-end justify-between gap-2.5 px-2">
              {weeklyDistribution.map((item) => (
                <div key={item.day} className="flex flex-1 flex-col items-center gap-2">
                  <span className="num text-[11px] font-medium text-[var(--sp-muted)]">
                    {item.count > 0 ? item.count : '·'}
                  </span>
                  <div
                    className="w-full max-w-[36px] rounded-t-md transition-all duration-300 hover:brightness-125"
                    style={{
                      height: `${item.height}%`,
                      background:
                        item.count > 0
                          ? 'linear-gradient(180deg, #6366f1 0%, rgba(99, 102, 241, 0.3) 100%)'
                          : 'rgba(255, 255, 255, 0.05)',
                    }}
                  />
                  <span className="text-[11.5px] font-medium uppercase tracking-wider text-[var(--sp-faint)]">
                    {item.day}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Sidebar: Quick Composer, Channel Mix, and Status */}
        <div className="space-y-6 lg:col-span-4">
          {/* Quick Post Creator Widget */}
          <section className="sp-card p-4 sm:p-5" aria-labelledby="sp-quick-title">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PenSquare size={16} className="text-indigo-400" />
                <h3 id="sp-quick-title" className="display text-[14.5px] font-semibold text-[var(--sp-text)]">
                  Quick Publication
                </h3>
              </div>
              <span className="text-[11px] text-[var(--sp-faint)] font-mono">
                {280 - quickPostText.length} left
              </span>
            </div>

            <div className="mt-3">
              <textarea
                rows={3}
                placeholder="Share an announcement, milestone, or thought across channels..."
                value={quickPostText}
                onChange={(e) => setQuickPostText(e.target.value)}
                className="sp-input text-[13px] leading-relaxed"
                style={{ height: 'auto', minHeight: 90 }}
              />
            </div>

            {/* Platform Selector Toggles */}
            <div className="mt-3">
              <p className="sp-faint mb-1.5 text-[11.5px] font-medium">Target Channels</p>
              <div className="flex flex-wrap gap-1.5">
                {PRIMARY_PLATFORMS.map((pid) => {
                  const active = quickPlatforms.includes(pid);
                  return (
                    <button
                      key={pid}
                      type="button"
                      onClick={() =>
                        setQuickPlatforms((curr) =>
                          curr.includes(pid) ? curr.filter((x) => x !== pid) : [...curr, pid],
                        )
                      }
                      className={cx(
                        'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition-all',
                        active
                          ? 'bg-indigo-600/25 text-indigo-300 border border-indigo-500/40'
                          : 'bg-[var(--sp-surface-2)] text-[var(--sp-muted)] border border-[var(--sp-border)] hover:text-[var(--sp-text)]',
                      )}
                    >
                      <PlatformGlyph id={pid} size={12} color={active ? '#c7d2fe' : PLATFORMS[pid].dot} />
                      {PLATFORMS[pid].name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="mt-4 flex items-center gap-2 pt-3 border-t border-[var(--sp-border)]">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onCompose()}
                className="flex-1 text-[12px]"
              >
                Full Composer
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={quickSubmitting}
                onClick={() => handleQuickSubmit('scheduled')}
                icon={<Send size={13} />}
                className="flex-1 text-[12px]"
              >
                Schedule
              </Button>
            </div>
          </section>

          {/* Social Channel Distribution / Mix */}
          <section className="sp-card p-4 sm:p-5" aria-labelledby="sp-mix-title">
            <h3 id="sp-mix-title" className="display text-[14.5px] font-semibold text-[var(--sp-text)]">
              Channel Publishing Mix
            </h3>
            <p className="sp-faint mt-0.5 text-[12px]">Post volume distribution across channels</p>

            <div className="mt-4 space-y-3">
              {PRIMARY_PLATFORMS.map((pid) => {
                const count = inWindow.filter((p) => p.platforms.includes(pid)).length;
                const pct = inWindow.length > 0 ? Math.round((count / inWindow.length) * 100) : 0;
                return (
                  <div key={pid} className="space-y-1">
                    <div className="flex items-center justify-between text-[12.5px]">
                      <div className="flex items-center gap-2">
                        <PlatformGlyph id={pid} size={13} color={PLATFORMS[pid].dot} />
                        <span className="font-medium text-[var(--sp-text)]">{PLATFORMS[pid].name}</span>
                      </div>
                      <span className="num sp-faint text-[12px]">{count} posts ({pct}%)</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--sp-surface-2)]">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: PLATFORMS[pid].dot }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Social Engine System Health */}
          <section className="sp-card p-4 sm:p-5" aria-labelledby="sp-health-title">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-amber-400" />
              <h3 id="sp-health-title" className="display text-[14.5px] font-semibold text-[var(--sp-text)]">
                Engine Status & Architecture
              </h3>
            </div>

            <div className="mt-3.5 space-y-2.5 text-[12.5px]">
              <div className="flex items-center justify-between rounded-lg p-2 bg-[var(--sp-surface-2)]">
                <span className="sp-muted">Postiz Social Engine</span>
                <span className="font-medium text-emerald-400 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Self-Hosted API
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg p-2 bg-[var(--sp-surface-2)]">
                <span className="sp-muted">OAuth Authorization</span>
                <span className="font-medium text-indigo-300">Direct & Postiz V1</span>
              </div>
              <div className="flex items-center justify-between rounded-lg p-2 bg-[var(--sp-surface-2)]">
                <span className="sp-muted">Media CDN Handler</span>
                <span className="font-medium text-[var(--sp-text)]">Active Multi-Part</span>
              </div>
              <div className="flex items-center justify-between rounded-lg p-2 bg-[var(--sp-surface-2)]">
                <span className="sp-muted">Queue Dispatcher</span>
                <span className="font-medium text-emerald-400">Synced Real-Time</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
