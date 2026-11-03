/**
 * Adaptive video layout.
 * - Gallery: columns follow the headcount (1 → 5), 25 tiles per page for large groups.
 * - Speaker: the pinned person, else the active speaker, large; everyone else in a filmstrip.
 * - Screen share: the shared screen takes the stage with a filmstrip beside it (see ScreenShareController).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { gridColumns, gridPage } from '../../../lib/meetingPolicy';
import { ParticipantTile, type TileModel } from './ParticipantTile';

export function VideoGrid({ local, remote, layout, pinnedId, activeSpeakerId, showSelfView, onPin, onMessage, onLocalVideoEl, stageOverride }: {
  local: TileModel;
  remote: TileModel[];
  layout: 'gallery' | 'speaker';
  pinnedId: string | null;
  activeSpeakerId: string | null;
  showSelfView: boolean;
  onPin: (id: string | null) => void;
  onMessage: (id: string) => void;
  onLocalVideoEl?: (el: HTMLVideoElement | null) => void;
  /** Replaces the main stage (used for screen share); everyone moves to the filmstrip. */
  stageOverride?: React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  const withSpeaking = (t: TileModel) => ({ ...t, speaking: t.id === activeSpeakerId });

  // Speaker view focus: pinned → active speaker → first remote → you.
  const everyone = useMemo(() => [local, ...remote], [local, remote]);
  const focusId = pinnedId && everyone.some((t) => t.id === pinnedId) ? pinnedId
    : activeSpeakerId && everyone.some((t) => t.id === activeSpeakerId) ? activeSpeakerId
    : remote[0]?.id ?? local.id;

  const hideSelf = !showSelfView && remote.length > 0;
  const g = gridPage(remote.length, page);
  useEffect(() => { if (g.page !== page) setPage(g.page); }, [g.page, page]);

  if (stageOverride || layout === 'speaker') {
    const focus = everyone.find((t) => t.id === focusId)!;
    const strip = (stageOverride ? everyone : everyone.filter((t) => t.id !== focusId)).filter((t) => showSelfView || !t.isLocal || t.id === focusId);
    return (
      <div className="flex h-full min-h-0 w-full flex-col gap-2.5">
        <div className="relative min-h-0 flex-1">
          {stageOverride ?? (
            <ParticipantTile tile={withSpeaking(focus)} fill pinned={pinnedId === focus.id} onPin={onPin} onMessage={onMessage}
              onVideoEl={focus.isLocal ? onLocalVideoEl : undefined} />
          )}
        </div>
        {strip.length > 0 && (
          <div className="m-filmstrip" aria-label="Other participants">
            <AnimatePresence initial={false}>
              {strip.map((t) => (
                <ParticipantTile key={t.id} tile={withSpeaking(t)} compact pinned={pinnedId === t.id} onPin={onPin} onMessage={onMessage}
                  onVideoEl={t.isLocal && stageOverride ? onLocalVideoEl : undefined} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    );
  }

  // Gallery
  const tiles = [...(g.includeLocal && !hideSelf ? [local] : []), ...remote.slice(g.start, g.end)];
  const cols = gridColumns(tiles.length);
  const compact = cols > 3;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2.5">
      <div className="m-grid min-h-0 flex-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: compact ? 6 : 10, maxWidth: cols === 1 ? 1100 : undefined, margin: cols === 1 ? '0 auto' : undefined }}>
        <AnimatePresence initial={false}>
          {tiles.map((t) => (
            <ParticipantTile key={t.id} tile={withSpeaking(t)} compact={compact} pinned={pinnedId === t.id}
              onPin={(id) => onPin(id)} onMessage={onMessage} onVideoEl={t.isLocal ? onLocalVideoEl : undefined} />
          ))}
        </AnimatePresence>
      </div>
      {g.pageCount > 1 && (
        <nav className="m-pager" aria-label="Participant pages">
          <button type="button" className="m-icon-btn" onClick={() => setPage(g.page - 1)} disabled={g.page === 0} aria-label="Previous page"><ChevronLeft size={18} /></button>
          <span className="m-num">Page {g.page + 1} of {g.pageCount} · {remote.length + 1} people</span>
          <button type="button" className="m-icon-btn" onClick={() => setPage(g.page + 1)} disabled={g.page >= g.pageCount - 1} aria-label="Next page"><ChevronRight size={18} /></button>
        </nav>
      )}
    </div>
  );
}
