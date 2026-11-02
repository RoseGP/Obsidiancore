import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, CloudOff, Loader2, PenSquare, Plus } from 'lucide-react';
import {
  addDays, addMonths, dayKey, defaultSlot, formatDayLong, formatTime, isSameDay, monthGrid, moveToDay,
  periodLabel, startOfDay, visibleRange, weekDays, weekdayLabels,
} from '../domain/calendar';
import { PLATFORMS, PRIMARY_PLATFORMS, STATUS_LABEL, isEditable, postTitle, type PlannerPost, type PlatformId, type PostStatus } from '../domain/model';
import { usePlanner } from '../state/PlannerStore';
import { usePrefs } from '../state/prefs';
import { PostChip, usePreview } from '../components/posts';
import { Banner, Button, Dialog, EmptyState, IconButton, PlatformGlyph, PlatformTile, Segmented, Skeleton, StatusBadge, StatusIcon, cx, useToast } from '../ui/kit';

export type CalView = 'month' | 'week' | 'list';
type Filter = 'all' | PlatformId;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(1200);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function groupByDay(posts: PlannerPost[]) {
  const m = new Map<string, PlannerPost[]>();
  for (const p of posts) {
    const k = dayKey(new Date(p.scheduledAt));
    const arr = m.get(k);
    if (arr) arr.push(p); else m.set(k, [p]);
  }
  return m;
}

/** Drag-and-drop reschedule shared by month and week views. */
function useReschedule() {
  const { update, posts } = usePlanner();
  const toast = useToast();
  return async (postId: string, newIso: string) => {
    const post = posts.find((p) => p.id === postId);
    if (!post || !isEditable(post) || post.scheduledAt === newIso) return;
    if (post.status !== 'draft' && new Date(newIso).getTime() < Date.now() + 60_000) {
      toast({ tone: 'error', title: 'Can’t schedule in the past', body: 'Drop it on today or a later day, or save it as a draft.' });
      return;
    }
    const prev = post.scheduledAt;
    try {
      await update(post.id, { scheduledAt: newIso }, { scheduledAt: newIso, ...(post.status === 'failed' ? { status: 'scheduled' as const } : {}) });
      toast({
        tone: 'success', title: 'Post rescheduled',
        body: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(newIso)),
        action: { label: 'Undo', run: () => { void update(post.id, { scheduledAt: prev }, { scheduledAt: prev }).catch(() => {}); } },
      });
    } catch (err: any) {
      if (err?.code !== 'busy') toast({ tone: 'error', title: 'Couldn’t reschedule', body: err?.message });
    }
  };
}

// ---------- Month ----------

function MonthView({ anchor, posts, loading, onCreate, width }: {
  anchor: Date; posts: PlannerPost[]; loading: boolean; onCreate: (day: Date) => void; width: number;
}) {
  const { prefs } = usePrefs();
  const reschedule = useReschedule();
  const days = useMemo(() => monthGrid(anchor, prefs.weekStart), [anchor, prefs.weekStart]);
  const byDay = useMemo(() => groupByDay(posts), [posts]);
  const today = new Date();
  const compact = width < 640;
  const maxChips = width >= 760 ? 2 : 1;
  // Narrow cells can't fit a readable title: show icon + time instead.
  const chipCompact = width / 7 < 125;
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moreDay, setMoreDay] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string>(dayKey(today));
  const labels = weekdayLabels(prefs.weekStart, compact ? 'narrow' : 'short');
  const rows = days.length / 7;

  useEffect(() => {
    // Keep the mobile selection inside the visible month.
    if (!days.some((d) => dayKey(d) === selected)) setSelected(dayKey(days.find((d) => d.getMonth() === anchor.getMonth() && d.getDate() === 1) ?? days[0]));
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveFocus = (e: React.KeyboardEvent, idx: number) => {
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[e.key];
    if (!delta) return;
    const n = idx + delta;
    if (n < 0 || n >= days.length) return;
    e.preventDefault();
    (document.querySelector(`[data-day-index="${n}"]`) as HTMLElement | null)?.focus();
  };

  const header = (
    <div className="grid grid-cols-7 pb-2.5" aria-hidden>
      {labels.map((l, i) => <div key={i} className="sp-faint text-center text-[11.5px] font-semibold uppercase tracking-[0.08em]">{l}</div>)}
    </div>
  );

  if (compact) {
    const selDate = days.find((d) => dayKey(d) === selected) ?? days[0];
    const list = byDay.get(selected) ?? [];
    return (
      <div>
        {header}
        <div role="grid" aria-label={`Calendar, ${periodLabel('month', anchor, prefs.weekStart)}`} className="sp-cal grid-cols-7">
          {days.map((d, i) => {
            const k = dayKey(d);
            const dayPosts = byDay.get(k) ?? [];
            const out = d.getMonth() !== anchor.getMonth();
            return (
              <button key={k} type="button" role="gridcell" data-day-index={i} aria-selected={selected === k}
                aria-label={`${formatDayLong(d)}, ${dayPosts.length} post${dayPosts.length === 1 ? '' : 's'}`}
                onClick={() => setSelected(k)} onKeyDown={(e) => moveFocus(e, i)}
                className={cx('sp-cell flex h-[58px] flex-col items-center gap-1 pt-1.5', out && 'is-out', isSameDay(d, today) && 'is-today', selected === k && 'is-selected')}
                style={{ border: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                <span className="sp-daynum">{d.getDate()}</span>
                <span className="flex gap-0.5">
                  {loading && !dayPosts.length && i % 5 === 2 ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--sp-border-strong)' }} /> : null}
                  {dayPosts.slice(0, 3).map((p) => (
                    <span key={p.id} className="h-1.5 w-1.5 rounded-full" style={{ background: p.status === 'draft' ? 'var(--sp-faint)' : PLATFORMS[p.platforms[0] ?? 'x'].dot }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <section className="mt-4" aria-label={formatDayLong(selDate)}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="display text-[15px] font-semibold">{formatDayLong(selDate)}</h3>
            <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => onCreate(selDate)}>Add post</Button>
          </div>
          {loading && !list.length ? <div className="space-y-2"><Skeleton style={{ height: 56 }} /><Skeleton style={{ height: 56 }} /></div>
            : list.length === 0 ? <p className="sp-muted rounded-xl px-4 py-5 text-center text-[13px]" style={{ background: 'var(--sp-surface)' }}>Nothing planned for this day.</p>
            : <AgendaList posts={list} />}
        </section>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div role="grid" aria-label={`Calendar, ${periodLabel('month', anchor, prefs.weekStart)}. Drag posts to reschedule.`}
        className="sp-cal grid-cols-7" style={{ gridTemplateRows: `repeat(${rows}, minmax(${width >= 760 ? 118 : 100}px, 1fr))` }}>
        {days.map((d, i) => {
          const k = dayKey(d);
          const out = d.getMonth() !== anchor.getMonth();
          const dayPosts = byDay.get(k) ?? [];
          const extra = dayPosts.length - maxChips;
          const isPast = startOfDay(d) < startOfDay(today);
          return (
            <div
              key={k}
              role="gridcell"
              aria-label={`${formatDayLong(d)}${dayPosts.length ? `, ${dayPosts.length} post${dayPosts.length === 1 ? '' : 's'}` : ''}`}
              className={cx('sp-cell group flex flex-col gap-1.5 p-1.5 pt-1', out && 'is-out', isSameDay(d, today) && 'is-today', over === k && 'is-drop')}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setOver(k); } }}
              onDragLeave={() => setOver((o) => (o === k ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain') || dragId;
                setOver(null); setDragId(null);
                const post = posts.find((p) => p.id === id);
                if (post) void reschedule(post.id, moveToDay(post.scheduledAt, d));
              }}
            >
              <div className="flex items-center justify-between">
                <span className="sp-daynum">{d.getDate()}</span>
                <button
                  type="button"
                  data-day-index={i}
                  onKeyDown={(e) => moveFocus(e, i)}
                  aria-label={`New post on ${formatDayLong(d)}`}
                  disabled={isPast}
                  onClick={() => onCreate(d)}
                  className="sp-btn sp-icon-btn sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  style={{ width: 24, height: 24, visibility: isPast ? 'hidden' : undefined }}
                >
                  <Plus size={14} />
                </button>
              </div>
              {loading && !dayPosts.length && (i * 7) % 11 === 3 && <Skeleton style={{ height: 34 }} />}
              {dayPosts.slice(0, maxChips).map((p) => <PostChip key={p.id} post={p} compact={chipCompact} onDragStart={(pp) => setDragId(pp.id)} />)}
              {extra > 0 && (
                <button type="button" onClick={() => setMoreDay(d)}
                  className="h-6 rounded-md text-[11.5px] font-semibold sp-muted" style={{ background: 'var(--sp-surface-2)', border: 0, cursor: 'pointer' }}>
                  + {extra} more
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Dialog open={!!moreDay} onClose={() => setMoreDay(null)} title={moreDay ? formatDayLong(moreDay) : ''} width={460}
        footer={moreDay && startOfDay(moreDay) >= startOfDay(today) ? <Button variant="primary" icon={<Plus size={15} />} onClick={() => { const d = moreDay; setMoreDay(null); onCreate(d); }}>Add post</Button> : undefined}>
        {moreDay && <AgendaList posts={byDay.get(dayKey(moreDay)) ?? []} />}
      </Dialog>
    </div>
  );
}

// ---------- Week ----------

const HOUR_PX = 64;

function WeekView({ anchor, posts, loading, onCreate }: { anchor: Date; posts: PlannerPost[]; loading: boolean; onCreate: (iso: string) => void }) {
  const { prefs } = usePrefs();
  const reschedule = useReschedule();
  const days = useMemo(() => weekDays(anchor, prefs.weekStart), [anchor, prefs.weekStart]);
  const scroller = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState<string | null>(null);
  const today = new Date();
  const now = Date.now();
  const byCell = useMemo(() => {
    const m = new Map<string, PlannerPost[]>();
    for (const p of posts) {
      const d = new Date(p.scheduledAt);
      const k = `${dayKey(d)}|${d.getHours()}`;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [posts]);

  useEffect(() => {
    const hours = posts.map((p) => new Date(p.scheduledAt).getHours());
    const first = hours.length ? Math.max(0, Math.min(...hours) - 1) : 8;
    scroller.current?.scrollTo({ top: first * HOUR_PX });
  }, [anchor]); // eslint-disable-line react-hooks/exhaustive-deps

  const hourLabel = (h: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', hour12: prefs.hour12 }).format(new Date(2024, 0, 1, h));

  return (
    <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid var(--sp-border)' }}>
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))]" style={{ background: 'var(--sp-shell)', borderBottom: '1px solid var(--sp-border)' }}>
            <div />
            {days.map((d) => (
              <div key={dayKey(d)} className="py-2.5 text-center">
                <p className="sp-faint text-[11px] font-semibold uppercase tracking-[0.08em]">{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(d)}</p>
                <p className={cx('display mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[14px] font-semibold')} style={isSameDay(d, today) ? { background: 'var(--sp-accent)', color: '#fff' } : undefined}>{d.getDate()}</p>
              </div>
            ))}
          </div>
          <div ref={scroller} className="relative max-h-[620px] overflow-y-auto">
            <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))]" style={{ gap: 1, background: 'var(--sp-border)' }}>
              {Array.from({ length: 24 }, (_, h) => (
                <React.Fragment key={h}>
                  <div className="sp-faint pr-2 pt-1 text-right text-[11px] num" style={{ background: 'var(--sp-shell)', height: HOUR_PX }}>{hourLabel(h)}</div>
                  {days.map((d) => {
                    const k = `${dayKey(d)}|${h}`;
                    const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
                    const past = slot.getTime() + 3_600_000 < now;
                    const items = byCell.get(k) ?? [];
                    return (
                      <div key={k} className={cx('sp-cell group flex flex-col gap-1 p-1', over === k && 'is-drop')} style={{ minHeight: HOUR_PX }}
                        onDragOver={(e) => { e.preventDefault(); setOver(k); }}
                        onDragLeave={() => setOver((o) => (o === k ? null : o))}
                        onDrop={(e) => {
                          e.preventDefault(); setOver(null);
                          const id = e.dataTransfer.getData('text/plain');
                          const post = posts.find((p) => p.id === id);
                          if (!post) return;
                          const src = new Date(post.scheduledAt);
                          void reschedule(post.id, new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, src.getMinutes()).toISOString());
                        }}>
                        {items.map((p) => <PostChip key={p.id} post={p} />)}
                        {loading && !items.length && (h * 3 + d.getDay()) % 17 === 0 && h > 7 && h < 19 && <Skeleton style={{ height: 34 }} />}
                        {!items.length && !past && (
                          <button type="button" aria-label={`New post ${formatDayLong(d)} at ${hourLabel(h)}`} onClick={() => onCreate(slot.toISOString())}
                            className="sp-btn sp-icon-btn sm m-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100" style={{ width: 26, height: 26 }}>
                            <Plus size={14} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- List ----------

export function AgendaList({ posts }: { posts: PlannerPost[] }) {
  const { open } = usePreview();
  const { prefs } = usePrefs();
  return (
    <ul className="space-y-2">
      {posts.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={(e) => open(p, e.currentTarget, true)}
            className="flex w-full items-center gap-3 rounded-xl p-3 text-left" style={{ background: 'var(--sp-surface)', border: '1px solid var(--sp-border)', font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
            <span className="num w-[74px] flex-none whitespace-nowrap text-[12.5px] font-semibold sp-muted">{formatTime(p.scheduledAt, prefs.hour12)}</span>
            <span className="flex flex-none -space-x-1">{p.platforms.slice(0, 3).map((pl) => <PlatformTile key={pl} id={pl} size={22} />)}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{postTitle(p, 90)}</span>
            <span className="hidden flex-none sm:block"><StatusBadge status={p.status} /></span>
            <span className="flex-none sm:hidden" aria-label={STATUS_LABEL[p.status]}><StatusIcon status={p.status} size={16} /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ListView({ posts, loading, anchor, onCreate }: { posts: PlannerPost[]; loading: boolean; anchor: Date; onCreate: () => void }) {
  const groups = useMemo(() => [...groupByDay(posts.filter((p) => new Date(p.scheduledAt).getMonth() === anchor.getMonth()))], [posts, anchor]);
  if (loading && !groups.length) {
    return <div className="space-y-5">{[0, 1, 2].map((i) => <div key={i} className="space-y-2"><Skeleton style={{ height: 16, width: 180 }} /><Skeleton style={{ height: 56 }} /><Skeleton style={{ height: 56 }} /></div>)}</div>;
  }
  if (!groups.length) {
    return <div className="sp-card"><EmptyState icon={<CalendarPlus size={20} />} title="Nothing planned this month" body="Posts you schedule or save as drafts show up here, grouped by day." action={<Button variant="primary" icon={<Plus size={15} />} onClick={onCreate}>New post</Button>} /></div>;
  }
  const today = dayKey(new Date());
  return (
    <div className="space-y-6">
      {groups.map(([k, list]) => {
        const [y, m, d] = k.split('-').map(Number);
        return (
          <section key={k} aria-label={formatDayLong(new Date(y, m - 1, d))}>
            <h3 className="display mb-2 flex items-center gap-2 text-[14px] font-semibold">
              {formatDayLong(new Date(y, m - 1, d))}
              {k === today && <span className="sp-status sp-status-scheduled">Today</span>}
            </h3>
            <AgendaList posts={list} />
          </section>
        );
      })}
    </div>
  );
}

// ---------- Page ----------

export function CalendarPage({ onCompose, view, setView, anchor, setAnchor }: {
  onCompose: (iso: string) => void; view: CalView; setView: (v: CalView) => void; anchor: Date; setAnchor: (d: Date) => void;
}) {
  const { posts, useRange, lastSyncedAt, isBusy } = usePlanner();
  const { prefs } = usePrefs();
  const [filter, setFilter] = useState<Filter>('all');
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const { from, to } = useMemo(() => visibleRange(view, anchor, prefs.weekStart), [view, anchor, prefs.weekStart]);
  const range = useRange(from, to);
  const loading = range.status === 'loading';

  const inRange = posts.filter((p) => { const t = new Date(p.scheduledAt).getTime(); return t >= from.getTime() && t <= to.getTime(); });
  const visible = filter === 'all' ? inRange : inRange.filter((p) => p.platforms.includes(filter));
  const savingAny = posts.some((p) => isBusy(p.id));
  const monthCount = visible.filter((p) => view !== 'month' || new Date(p.scheduledAt).getMonth() === anchor.getMonth()).length;

  const step = (dir: 1 | -1) => setAnchor(view === 'week' ? addDays(anchor, 7 * dir) : addMonths(anchor, dir));
  const createOn = (day: Date) => onCompose(defaultSlot(day, prefs.defaultHour));

  return (
    <div ref={wrapRef} className="relative flex min-h-full flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton label={view === 'week' ? 'Previous week' : 'Previous month'} small onClick={() => step(-1)}><ChevronLeft size={18} /></IconButton>
          <h2 className="display min-w-[150px] text-center text-[15px] font-semibold num" aria-live="polite">{periodLabel(view, anchor, prefs.weekStart)}</h2>
          <IconButton label={view === 'week' ? 'Next week' : 'Next month'} small onClick={() => step(1)}><ChevronRight size={18} /></IconButton>
          <Button size="sm" variant="ghost" onClick={() => setAnchor(new Date())} className="ml-1">Today</Button>
        </div>
        <Segmented<CalView> label="Calendar view" value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'list', label: 'List' }]} />
      </div>

      <div role="group" aria-label="Filter by platform" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: 'none' }}>
        <button type="button" className="sp-pill" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        {PRIMARY_PLATFORMS.map((p) => (
          <button key={p} type="button" className="sp-pill" aria-pressed={filter === p} onClick={() => setFilter(p)}>
            <PlatformGlyph id={p} size={13} color={filter === p ? '#fff' : PLATFORMS[p].dot} />{PLATFORMS[p].label === 'X' ? 'X (Twitter)' : PLATFORMS[p].label}
          </button>
        ))}
      </div>

      {range.status === 'error' && (
        <Banner tone="danger" action={<Button size="sm" variant="secondary" onClick={range.reload}>Retry</Button>}>
          <b>Posts couldn’t be loaded.</b> <span className="sp-muted">{range.error}</span>
        </Banner>
      )}
      {range.status === 'ready' && monthCount === 0 && view !== 'list' && (
        <Banner tone="info">
          {filter === 'all' ? `Nothing planned for ${periodLabel(view, anchor, prefs.weekStart)} yet. Pick a day to add a post.` : `No ${PLATFORMS[filter as PlatformId].label} posts in this period.`}
        </Banner>
      )}

      <div aria-busy={loading}>
        {view === 'month' && <MonthView anchor={anchor} posts={visible} loading={loading} onCreate={createOn} width={width} />}
        {view === 'week' && <WeekView anchor={anchor} posts={visible} loading={loading} onCreate={onCompose} />}
        {view === 'list' && <ListView anchor={anchor} posts={visible} loading={loading} onCreate={() => createOn(new Date())} />}
      </div>

      <footer className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-[11.5px]">
        <span className="sp-faint font-semibold uppercase tracking-[0.08em]">Platforms</span>
        {PRIMARY_PLATFORMS.map((p) => <span key={p} className="sp-muted flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: PLATFORMS[p].dot }} />{PLATFORMS[p].label}</span>)}
        <span className="sp-faint ml-2 font-semibold uppercase tracking-[0.08em]">Status</span>
        {(['published', 'scheduled', 'draft', 'failed'] as PostStatus[]).map((s) => (
          <span key={s} className="sp-muted flex items-center gap-1.5"><StatusIcon status={s} size={13} />{STATUS_LABEL[s]}</span>
        ))}
        <span className="sp-faint ml-auto flex items-center gap-1.5" aria-live="polite">
          {savingAny ? <><Loader2 size={13} className="sp-spin" /> Saving…</>
            : range.status === 'error' ? <><CloudOff size={13} /> Not synced</>
            : lastSyncedAt ? <><CheckCircle2 size={13} /> All changes synced</> : null}
        </span>
      </footer>

      <div className="pointer-events-none sticky bottom-5 z-20 -mt-[76px] flex justify-end pr-1">
        <button type="button" className="sp-fab pointer-events-auto" aria-label="Create post" title="Create post" onClick={() => createOn(new Date())}>
          <PenSquare size={22} />
        </button>
      </div>
    </div>
  );
}
