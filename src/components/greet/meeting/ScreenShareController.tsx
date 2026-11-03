/** Shared-screen stage: the screen fills the stage with a "you're presenting" bar and a stop button. */
import React, { useEffect, useRef } from 'react';
import { AlertTriangle, MonitorOff, MonitorUp, Volume2, X } from 'lucide-react';

export function ScreenShareController({ stream, hasSystemAudio, onStop, onVideoEl }: {
  stream: MediaStream | null; hasSystemAudio: boolean; onStop: () => void; onVideoEl?: (el: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && stream && v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); }
    onVideoEl?.(v);
    return () => onVideoEl?.(null);
  }, [stream, onVideoEl]);
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[18px]" style={{ background: '#05060a', boxShadow: 'inset 0 0 0 1px var(--m-line)' }}>
      <video ref={ref} autoPlay playsInline muted className="h-full w-full object-contain" aria-label="Your shared screen" />
      <div className="m-glass absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-3 rounded-2xl py-1.5 pl-3.5 pr-1.5 text-[13px]">
        <MonitorUp size={16} style={{ color: 'var(--m-accent)' }} aria-hidden />
        <span className="font-semibold">You’re presenting</span>
        {hasSystemAudio && <span className="m-muted hidden items-center gap-1 sm:inline-flex"><Volume2 size={13} aria-hidden />with audio</span>}
        <button type="button" className="m-btn m-btn-danger m-btn-sm" onClick={onStop}><MonitorOff size={14} aria-hidden />Stop sharing</button>
      </div>
    </div>
  );
}

export function ScreenShareError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="m-glass flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[13px]">
      <AlertTriangle size={16} style={{ color: 'var(--m-warn)' }} aria-hidden />
      <span className="min-w-0 flex-1">{message}</span>
      <button type="button" className="m-icon-btn" aria-label="Dismiss" onClick={onDismiss}><X size={15} /></button>
    </div>
  );
}
