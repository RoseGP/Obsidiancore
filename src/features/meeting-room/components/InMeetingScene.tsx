/**
 * In the meeting: connection status, screen share stage (source aspect ratio, never cropped) with a participant
 * strip, or a participant grid; remote audio; device problems with Retry; the control bar.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Users, Volume2, WifiOff, X } from 'lucide-react';
import { Button, cx, focusRing } from '../../../components/dashboard/ui';
import type { DeviceKind } from '../media/deviceErrors';
import { computeLayout, stageAspect } from '../room/layout';
import type { MeetingRoomController } from '../room/MeetingRoomController';
import type { MeetingSnapshot } from '../room/types';
import { DeviceIssueMessage, DeviceToggle, LeaveButton, ScreenShareToggle } from './Controls';
import { ParticipantTile } from './ParticipantTile';
import { TrackAudio, TrackVideo } from './TrackMedia';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(1024);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export function InMeetingScene({ snap, controller }: { snap: MeetingSnapshot; controller: MeetingRoomController }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [pinned, setPinned] = useState<string | null>(null);
  const layout = computeLayout(snap.participants, { width, pinnedShareKey: pinned });
  const retry = (kind: DeviceKind) => { void controller.retry(kind); };
  const reconnecting = snap.phase === 'reconnecting';

  return (
    <div className="flex h-full min-h-[520px] w-full flex-col bg-neutral-950 text-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5 text-[13px]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-neutral-300">{snap.roomCode}</span>
          <span className="inline-flex items-center gap-1 text-neutral-400"><Users className="h-3.5 w-3.5" aria-hidden="true" />{snap.participants.length}<span className="sr-only"> in the meeting</span></span>
        </div>
        <span role="status" className={cx('inline-flex items-center gap-1.5', reconnecting ? 'text-amber-300' : 'text-emerald-300')}>
          {reconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true" />}
          {reconnecting ? 'Reconnecting…' : 'Connected'}
        </span>
      </header>

      <div className="space-y-2 px-4 pt-3 empty:hidden">
        {snap.notice && (
          <div role="status" className={cx('flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]', snap.notice.tone === 'warning' ? 'bg-amber-500/15 text-amber-100' : snap.notice.tone === 'error' ? 'bg-red-500/15 text-red-100' : 'bg-white/10 text-neutral-100')}>
            {snap.notice.tone !== 'info' && <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="flex-1">{snap.notice.text}</span>
            <button type="button" aria-label="Dismiss" className={cx('rounded p-0.5 hover:bg-white/10', focusRing)} onClick={() => controller.dismissNotice()}><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        {snap.audioBlocked && (
          <div role="alert" className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-[13px]">
            <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="flex-1">Your browser blocked meeting audio until you interact with the page.</span>
            <Button size="sm" variant="primary" onClick={() => void controller.startAudio()}>Start audio</Button>
          </div>
        )}
        {snap.screen.issue && (
          <div role="alert" className="flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-2 text-[13px] text-amber-100">
            <span className="flex-1">{snap.screen.issue.message}</span>
            {snap.screen.issue.code !== 'unsupported' && <Button size="sm" variant="secondary" onClick={() => void controller.setScreenShareEnabled(true)}>Try again</Button>}
          </div>
        )}
        <DeviceIssueMessage state={snap.camera} onRetry={retry} />
        <DeviceIssueMessage state={snap.microphone} onRetry={retry} />
      </div>

      <main ref={ref} className="min-h-0 flex-1 overflow-auto p-3 sm:p-4" aria-label="Meeting participants">
        {layout.mode === 'stage' && layout.stage ? (
          <div className="flex h-full flex-col gap-3 lg:flex-row">
            <section aria-label={`${layout.stage.isLocal ? 'Your' : `${layout.stage.name}'s`} shared screen`} className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="mx-auto w-full max-h-full overflow-hidden rounded-xl bg-black ring-1 ring-sky-500/40" style={{ aspectRatio: stageAspect(layout.stage.track) }}>
                <TrackVideo trackRef={layout.stage.track} kind="screen" label={`Screen shared by ${layout.stage.name}`} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-neutral-300">
                <span>{layout.stage.isLocal ? 'You are sharing your screen' : `${layout.stage.name} is sharing`}</span>
                {layout.shares.length > 1 && layout.shares.map((s) => (
                  <button key={s.key} type="button" aria-pressed={s.key === layout.stage!.key} onClick={() => setPinned(s.key)}
                    className={cx('rounded-full px-2.5 py-1', s.key === layout.stage!.key ? 'bg-sky-600 text-white' : 'bg-white/10 hover:bg-white/20', focusRing)}>
                    {s.isLocal ? 'Your screen' : s.name}
                  </button>
                ))}
              </div>
            </section>
            <aside aria-label="Participants" className="grid shrink-0 auto-rows-min grid-cols-2 gap-2 sm:grid-cols-3 lg:w-64 lg:grid-cols-1 lg:overflow-y-auto">
              {layout.tiles.map((p) => <ParticipantTile key={p.key} p={p} compact />)}
            </aside>
          </div>
        ) : (
          <div className="mx-auto grid max-w-6xl gap-3" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}>
            {layout.tiles.map((p) => <ParticipantTile key={p.key} p={p} />)}
          </div>
        )}
        {snap.participants.length === 1 && <p className="mt-4 text-center text-[13px] text-neutral-400">You're the only one here. Share the meeting code <span className="font-mono">{snap.roomCode}</span> to invite others.</p>}
      </main>

      {snap.participants.filter((p) => p.audio).map((p) => <TrackAudio key={`${p.key}:${p.audio!.id}`} trackRef={p.audio!} />)}

      <nav aria-label="Meeting controls" className="flex items-center justify-center gap-3 border-t border-white/10 px-4 py-3">
        <DeviceToggle state={snap.microphone} onToggle={() => void controller.toggleMicrophone()} />
        <DeviceToggle state={snap.camera} onToggle={() => void controller.toggleCamera()} />
        <ScreenShareToggle state={snap.screen} onToggle={() => void controller.toggleScreenShare()} />
        <LeaveButton onLeave={() => void controller.leave()} />
      </nav>
    </div>
  );
}
