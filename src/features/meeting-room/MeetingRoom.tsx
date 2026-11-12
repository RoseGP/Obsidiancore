/**
 * GREET meeting room (LiveKit): pre-join → joining/waiting → in the meeting → leave or disconnect.
 *
 * Joins meetings that are running in GREET by their code. The server's roster decides who gets in
 * (capacity, lock, waiting room, plan time limit) and issues the LiveKit token; see
 * src/features/meeting-room/api/meetingTokenClient.ts and src/server/meetings/media.ts.
 */
import React from 'react';
import { ArrowLeft, Loader2, LogOut, RotateCcw } from 'lucide-react';
import { Button } from '../../components/dashboard/ui';
import { InMeetingScene } from './components/InMeetingScene';
import { PreJoinScene } from './components/PreJoinScene';
import { useMeetingRoom } from './useMeetingRoom';
import type { MeetingRoomController } from './room/MeetingRoomController';

export default function MeetingRoom({ initialRoomCode, onExit, controllerFactory }: {
  initialRoomCode?: string;
  /** Back to GREET (shown on the pre-join screen). */
  onExit?: () => void;
  /** Tests inject a controller with fakes. */
  controllerFactory?: () => MeetingRoomController;
}) {
  const { controller, snapshot: snap } = useMeetingRoom(controllerFactory);

  return (
    <div id="meeting-room" className="flex min-h-full w-full flex-col bg-[var(--app-bg)] text-[var(--text)]" data-phase={snap.phase}>
      {(snap.phase === 'prejoin' || snap.phase === 'joining' || snap.phase === 'waiting') && (
        <>
          {onExit && snap.phase === 'prejoin' && (
            <div className="px-4 pt-4 sm:px-6"><Button size="sm" variant="ghost" icon={<ArrowLeft className="h-4 w-4" />} onClick={onExit}>Back to GREET</Button></div>
          )}
          <PreJoinScene snap={snap} controller={controller} initialRoomCode={initialRoomCode} />
        </>
      )}

      {(snap.phase === 'connected' || snap.phase === 'reconnecting') && (
        <div className="h-[calc(100vh-4rem)] min-h-[520px]"><InMeetingScene snap={snap} controller={controller} /></div>
      )}

      {snap.phase === 'leaving' && (
        <div role="status" className="flex flex-1 items-center justify-center gap-2 py-24 text-[14px] text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Leaving the meeting…
        </div>
      )}

      {snap.phase === 'disconnected' && (
        <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
          <h1 className="text-[20px] font-semibold">You're no longer in the meeting</h1>
          <p role="alert" className="text-[14px] text-[var(--text-muted)]">{snap.notice?.text ?? 'The connection to the meeting ended.'}</p>
          <p className="text-[12px] text-[var(--text-subtle)]">Your camera, microphone and screen sharing have been stopped.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => controller.backToPrejoin()}>Rejoin</Button>
            {onExit && <Button variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={onExit}>Back to GREET</Button>}
          </div>
        </div>
      )}
    </div>
  );
}
