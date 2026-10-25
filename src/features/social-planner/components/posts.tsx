import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clock, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { formatDateTime, formatTime } from '../domain/calendar';
import { PLATFORMS, isEditable, postTitle, type PlannerPost } from '../domain/model';
import { usePlanner } from '../state/PlannerStore';
import { usePrefs } from '../state/prefs';
import { Button, IconButton, PlatformGlyph, PlatformTile, Portal, StatusBadge, StatusIcon, cx, useToast } from '../ui/kit';

export function chipBackground(p: PlannerPost): string {
  if (p.status === 'draft') return 'transparent';
  const first = p.platforms[0];
  return first ? PLATFORMS[first].chip : '#3a3b47';
}

// ---------- Preview popover (shared, one at a time) ----------

interface PreviewState { post: PlannerPost; rect: DOMRect; pinned: boolean }
type Opener = (post: PlannerPost, el: HTMLElement, pinned: boolean) => void;

const PreviewCtx = React.createContext<{ open: Opener; close: (force?: boolean) => void; current: string | null; onEdit: (p: PlannerPost) => void } | null>(null);
export const usePreview = () => React.useContext(PreviewCtx)!;

export function PreviewProvider({ children, onEdit }: { children: React.ReactNode; onEdit: (p: PlannerPost) => void }) {
  const [state, setState] = useState<PreviewState | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const open: Opener = useCallback((post, el, pinned) => {
    anchorRef.current = el;
    setState((s) => (s && s.pinned && !pinned ? s : { post, rect: el.getBoundingClientRect(), pinned }));
  }, []);
  const close = useCallback((force = false) => {
    setState((s) => (!s || (s.pinned && !force) ? s : null));
  }, []);
  const closeAndRefocus = useCallback(() => {
    setState(null);
    anchorRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <PreviewCtx.Provider value={{ open, close, current: state?.post.id ?? null, onEdit }}>
      {children}
      {state && <PostPreview key={state.post.id} postId={state.post.id} fallback={state.post} rect={state.rect} pinned={state.pinned}
        onClose={closeAndRefocus} onPin={() => setState((s) => s && { ...s, pinned: true })} onEdit={(p) => { setState(null); onEdit(p); }} />}
    </PreviewCtx.Provider>
  );
}

function PostPreview({ postId, fallback, rect, pinned, onClose, onPin, onEdit }: {
  postId: string; fallback: PlannerPost; rect: DOMRect; pinned: boolean; onClose: () => void; onPin: () => void; onEdit: (p: PlannerPost) => void;
}) {
  const { posts, remove, retry, isBusy } = usePlanner();
  const { prefs } = usePrefs();
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const post = posts.find((p) => p.id === postId) ?? fallback;
  const busy = isBusy(post.id);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.right + 10;
    if (left + w > vw - 8) left = rect.left - w - 10;
    if (left < 8) left = Math.max(8, Math.min(vw - w - 8, rect.left + rect.width / 2 - w / 2));
    let top = rect.top;
    if (left === Math.max(8, Math.min(vw - w - 8, rect.left + rect.width / 2 - w / 2))) top = rect.bottom + 8;
    if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    setPos({ left, top });
  }, [rect, confirmDelete]);

  useEffect(() => {
    if (pinned) requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }));
  }, [pinned]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (pinned && !ref.current?.contains(e.target as Node)) onClose(); };
    const onScroll = () => { if (!pinned) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); window.removeEventListener('scroll', onScroll, true); };
  }, [pinned, onClose]);

  const first = post.platforms[0];
  const doDelete = async () => {
    try {
      await remove(post.id);
      toast({ tone: 'success', title: post.status === 'published' ? 'Post removed from calendar' : 'Post deleted', body: postTitle(post, 60) });
      onClose();
    } catch (err: any) {
      if (err?.code !== 'busy') toast({ tone: 'error', title: 'Post not deleted', body: err?.message });
    }
  };
  const doRetry = async () => {
    try {
      await retry(post.id);
      toast({ tone: 'success', title: 'Queued for another try', body: 'The scheduler will pick it up shortly.' });
    } catch (err: any) {
      if (err?.code !== 'busy') toast({ tone: 'error', title: 'Retry failed', body: err?.message });
    }
  };

  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-label={`Preview: ${postTitle(post, 60)}`}
        className="sp-pop animate fixed z-[85] w-[min(320px,calc(100vw-16px))] p-4"
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
        onMouseEnter={onPin}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-white" style={{ background: first ? PLATFORMS[first].chip : '#3a3b47' }}>
            {first && <PlatformGlyph id={first} size={15} color="#fff" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">{first ? `${PLATFORMS[first].label} post` : 'Post'}</p>
            {post.platforms.length > 1 && (
              <p className="sp-faint truncate text-[12px]">Also on {post.platforms.slice(1).map((p) => PLATFORMS[p].label).join(', ')}</p>
            )}
          </div>
          {isEditable(post) && <IconButton label="Edit post" small onClick={() => onEdit(post)}><Pencil size={15} /></IconButton>}
          <IconButton label="Delete post" small onClick={() => setConfirmDelete(true)} disabled={busy || post.status === 'publishing'} style={{ color: 'var(--sp-danger)' }}><Trash2 size={15} /></IconButton>
        </div>

        <p className="mt-3 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed" style={{ color: '#d6d7e0', display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {post.content ? `“${post.content}”` : <span className="sp-faint">No text</span>}
        </p>
        {post.mediaUrls.length > 0 && <p className="sp-faint mt-2 text-[12px]">{post.mediaUrls.length} media attachment{post.mediaUrls.length === 1 ? '' : 's'}</p>}

        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3" style={{ borderColor: 'var(--sp-border-strong)' }}>
          <span className="sp-muted inline-flex items-center gap-1.5 text-[12.5px] num" title={formatDateTime(post.scheduledAt, prefs.hour12)}>
            <Clock size={14} aria-hidden /> {formatTime(post.scheduledAt, prefs.hour12)}
          </span>
          <StatusBadge status={post.status} />
        </div>
        {post.status === 'failed' && (
          <div className="mt-3 rounded-lg p-2.5 text-[12.5px]" style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5' }}>
            {post.failureReason || 'Publishing failed.'}
            <div className="mt-2"><Button size="sm" variant="secondary" icon={<RotateCcw size={14} />} loading={busy} onClick={doRetry}>Retry now</Button></div>
          </div>
        )}
        {confirmDelete && (
          <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--sp-surface-2)' }} role="alertdialog" aria-label="Confirm delete">
            <p className="text-[13px]">{post.status === 'published' ? 'Remove this post from the calendar? It stays live on the platform.' : 'Delete this post? This can’t be undone.'}</p>
            <div className="mt-2.5 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} data-autofocus>Cancel</Button>
              <Button size="sm" variant="danger" loading={busy} onClick={doDelete}>Delete</Button>
            </div>
          </div>
        )}
      </div>
    </Portal>
  );
}

// ---------- Chip ----------

export function PostChip({ post, compact, onDragStart }: { post: PlannerPost; compact?: boolean; onDragStart?: (p: PlannerPost) => void }) {
  const { open, close, current } = usePreview();
  const { isBusy } = usePlanner();
  const { prefs } = usePrefs();
  const hoverTimer = useRef<number | null>(null);
  const draggable = isEditable(post) && !isBusy(post.id);
  const first = post.platforms[0];
  const label = `${postTitle(post, 80)}, ${first ? PLATFORMS[first].label : 'no platform'}, ${post.status}, ${formatTime(post.scheduledAt, prefs.hour12)}`;

  return (
    <button
      type="button"
      className={cx('sp-chip', post.status === 'draft' && 'is-draft', post.status === 'failed' && 'is-failed', isBusy(post.id) && 'is-busy')}
      style={{ background: chipBackground(post) }}
      aria-label={label}
      aria-expanded={current === post.id}
      aria-haspopup="dialog"
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', post.id); close(true); onDragStart?.(post); }}
      onClick={(e) => { e.stopPropagation(); open(post, e.currentTarget, true); }}
      onMouseEnter={(e) => {
        if (window.matchMedia('(hover: none)').matches) return;
        const el = e.currentTarget;
        hoverTimer.current = window.setTimeout(() => open(post, el, false), 450);
      }}
      onMouseLeave={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); setTimeout(() => close(false), 120); }}
    >
      {first && <PlatformTile id={first} size={compact ? 16 : 20} />}
      {!compact && <span className="sp-chip-title">{postTitle(post, 40)}</span>}
      {compact && <span className="sp-chip-title num" style={{ WebkitLineClamp: 1 }}>{formatTime(post.scheduledAt, prefs.hour12)}</span>}
      <StatusIcon status={post.status} size={14} className="flex-none opacity-90" />
    </button>
  );
}
