/**
 * Pre-join: local preview, camera/microphone controls with their permission state, optional quality check
 * (C++/WebAssembly analysis of the local preview), the meeting code and Join. Nothing is captured until the
 * user turns a device on.
 */
import React, { useEffect, useState } from 'react';
import { CheckCircle2, Info, Loader2, LogIn, ShieldAlert, VideoOff, X } from 'lucide-react';
import { Badge, Button, cx, focusRing } from '../../../components/dashboard/ui';
import { MediaQualityProbe, type ProbeResult } from '../analysis/MediaQualityProbe';
import { loadMediaAnalyzer, type MediaAnalyzer } from '../analysis/wasmAnalyzer';
import type { DeviceKind } from '../media/deviceErrors';
import type { MeetingRoomController } from '../room/MeetingRoomController';
import type { DeviceState, MeetingSnapshot } from '../room/types';
import { DeviceIssueMessage, DeviceSelect, DeviceToggle } from './Controls';
import { TrackVideo } from './TrackMedia';

function permissionBadge(s: DeviceState) {
  if (s.issue?.code === 'insecure_context' || s.issue?.code === 'policy_blocked' || s.issue?.code === 'unsupported') return <Badge tone="danger">Not available here</Badge>;
  if (s.permission === 'denied' || s.issue?.code === 'denied') return <Badge tone="danger">Blocked</Badge>;
  if (s.active) return <Badge tone="success">On</Badge>;
  if (s.permission === 'granted') return <Badge tone="neutral">Allowed · off</Badge>;
  if (s.permission === 'prompt') return <Badge tone="neutral">Not asked yet</Badge>;
  return <Badge tone="neutral">Off</Badge>;
}

function previewPlaceholder(s: DeviceState): string {
  if (s.pending) return 'Starting your camera… If your browser asks, choose Allow.';
  if (s.issue) return s.issue.message;
  if (s.permission === 'prompt' || s.permission === 'unknown') return 'Your camera is off. Turn it on to see a preview; your browser will ask for permission.';
  return 'Your camera is off.';
}

function useQualityCheck(enabled: boolean, snap: MeetingSnapshot) {
  const [analyzer, setAnalyzer] = useState<MediaAnalyzer | null | undefined>(undefined);
  const [result, setResult] = useState<ProbeResult>({ video: [], audio: [] });
  useEffect(() => { let live = true; loadMediaAnalyzer().then((a) => { if (live) setAnalyzer(a); }); return () => { live = false; }; }, []);
  const videoTrack = snap.preview?.track.mediaStreamTrack ?? null;
  const audioTrack = snap.previewAudio?.track.mediaStreamTrack ?? null;
  useEffect(() => {
    if (!enabled || !analyzer || (!videoTrack && !audioTrack)) { setResult({ video: [], audio: [] }); return; }
    const probe = new MediaQualityProbe(analyzer, setResult);
    probe.setVideoTrack(videoTrack);
    probe.setAudioTrack(audioTrack);
    return () => probe.stop();
  }, [enabled, analyzer, videoTrack, audioTrack]);
  return { available: analyzer ? true : analyzer === null ? false : null, result };
}

export function PreJoinScene({ snap, controller, initialRoomCode }: { snap: MeetingSnapshot; controller: MeetingRoomController; initialRoomCode?: string }) {
  const [code, setCode] = useState(snap.roomCode ?? initialRoomCode ?? '');
  const [checkQuality, setCheckQuality] = useState(true);
  const busy = snap.phase === 'joining' || snap.phase === 'waiting';
  const quality = useQualityCheck(checkQuality && !busy, snap);
  const retry = (kind: DeviceKind) => { void controller.retry(kind); };
  const select = (kind: DeviceKind, id: string | null) => { void controller.selectDevice(kind, id); };
  const hints = [...quality.result.video, ...quality.result.audio];

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:py-10">
      <section aria-label="Camera and microphone check" className="space-y-3">
        <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-panel)] bg-neutral-900">
          {snap.preview ? (
            <TrackVideo trackRef={snap.preview} kind="camera" mirror label="Your camera preview (shown mirrored; others see it unmirrored)" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-[14px] text-neutral-300">
              {snap.camera.pending ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" /> : <VideoOff className="h-7 w-7" aria-hidden="true" />}
              <p role="status">{previewPlaceholder(snap.camera)}</p>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 bg-gradient-to-t from-black/60 to-transparent pb-3 pt-8">
            <DeviceToggle state={snap.microphone} onToggle={() => void controller.toggleMicrophone()} />
            <DeviceToggle state={snap.camera} onToggle={() => void controller.toggleCamera()} />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {([snap.camera, snap.microphone] as DeviceState[]).map((s) => (
            <div key={s.kind} className="flex items-center justify-between rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px]">
              <span>{s.kind === 'camera' ? 'Camera' : 'Microphone'}</span>{permissionBadge(s)}
            </div>
          ))}
        </div>
        <DeviceIssueMessage state={snap.camera} onRetry={retry} />
        <DeviceIssueMessage state={snap.microphone} onRetry={retry} />
        <div className="grid gap-3 sm:grid-cols-2">
          <DeviceSelect state={snap.camera} onSelect={select} />
          <DeviceSelect state={snap.microphone} onSelect={select} />
        </div>

        {quality.available && (
          <div className="space-y-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-3">
            <label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
              <input type="checkbox" className="mt-0.5" checked={checkQuality} onChange={(e) => setCheckQuality(e.target.checked)} />
              <span>Check lighting, focus and sound before joining
                <span className="block text-[12px] text-[var(--text-subtle)]">Analyzed in this browser only; your video and audio aren't changed or sent anywhere for this.</span></span>
            </label>
            {checkQuality && hints.length > 0 && (
              <ul className="space-y-1" aria-live="polite">
                {hints.map((h) => (
                  <li key={h.id} className="flex items-start gap-2 text-[13px]">
                    {h.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />}
                    <span>{h.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section aria-label="Join the meeting" className="flex flex-col justify-center gap-4">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-[var(--text)]">Ready to join?</h1>
          <p className="mt-1 text-[14px] text-[var(--text-muted)]">Choose whether to join with your camera and microphone on. You can change them at any time in the meeting.</p>
        </div>
        {snap.notice && snap.phase === 'prejoin' && (
          <p role="status" className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] bg-[var(--info-soft)] px-3 py-2 text-[13px] text-[var(--text)]">
            {snap.notice.text}
            <button type="button" aria-label="Dismiss" className={cx('rounded p-0.5 hover:bg-[var(--surface)]', focusRing)} onClick={() => controller.dismissNotice()}><X className="h-3.5 w-3.5" /></button>
          </p>
        )}
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void controller.join(code); }}>
          <label htmlFor="meeting-room-code" className="block text-[13px] font-medium text-[var(--text)]">Meeting code or link</label>
          <input id="meeting-room-code" value={code} onChange={(e) => { setCode(e.target.value); if (snap.error) controller.dismissError(); }} disabled={busy}
            placeholder="abc-defg-hij" autoComplete="off" spellCheck={false} aria-invalid={snap.error?.code === 'invalid_input'} aria-describedby={snap.error ? 'meeting-join-error' : undefined}
            className={cx('w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-mono text-[15px] text-[var(--text)]', focusRing)} />
          {snap.error && (
            <p id="meeting-join-error" role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--danger-soft)] px-3 py-2 text-[13px] text-[var(--danger)]">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{snap.error.message}
            </p>
          )}
          {busy ? (
            <div className="space-y-2" role="status" aria-live="polite">
              <p className="flex items-center gap-2 text-[14px] text-[var(--text)]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {snap.phase === 'waiting' ? 'Waiting for the host to let you in…' : 'Joining…'}
              </p>
              <Button variant="secondary" onClick={() => void controller.cancelJoin()}>Cancel</Button>
            </div>
          ) : (
            <Button type="submit" variant="primary" className="h-11 w-full text-[15px]" icon={<LogIn className="h-4 w-4" />} disabled={!code.trim()}>Join meeting</Button>
          )}
          <p className="text-[12px] text-[var(--text-subtle)]">
            Joining with {snap.camera.active ? 'camera on' : 'camera off'} and {snap.microphone.active ? 'microphone on' : 'microphone off'}.
          </p>
        </form>
      </section>
    </div>
  );
}
