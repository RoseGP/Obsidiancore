/** One participant: camera (cropped to fill, never stretched) or initials, with name, mic and connection state. */
import React from 'react';
import { MicOff, MonitorUp, WifiOff } from 'lucide-react';
import { cx } from '../../../components/dashboard/ui';
import type { ParticipantView } from '../room/types';
import { TrackVideo } from './TrackMedia';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

export function describeParticipant(p: ParticipantView): string {
  const who = p.isLocal ? `${p.name} (you)` : p.name;
  const parts = [who, p.camera ? 'camera on' : 'camera off', p.micMuted ? 'microphone off' : 'microphone on'];
  if (p.screen) parts.push('sharing screen');
  if (p.isSpeaking) parts.push('speaking');
  if (p.quality === 'poor' || p.quality === 'lost') parts.push(p.quality === 'lost' ? 'connection lost' : 'poor connection');
  return parts.join(', ');
}

export function ParticipantTile({ p, compact = false }: { p: ParticipantView; compact?: boolean }) {
  return (
    <figure
      aria-label={describeParticipant(p)}
      data-participant={p.key}
      className={cx(
        'relative m-0 overflow-hidden rounded-xl bg-neutral-900 text-white aspect-video min-w-0',
        p.isSpeaking ? 'ring-2 ring-[var(--success)]' : 'ring-1 ring-white/10',
      )}
    >
      {p.camera ? (
        <TrackVideo trackRef={p.camera} kind="camera" mirror={p.isLocal} label={`${p.name} camera`} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className={cx('flex items-center justify-center rounded-full bg-neutral-700 font-semibold', compact ? 'h-10 w-10 text-[13px]' : 'h-16 w-16 text-[20px]')}>{initials(p.name)}</span>
        </div>
      )}
      <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-1.5 pt-5 text-[12px]">
        {p.micMuted && <MicOff className="h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden="true" />}
        <span className="truncate font-medium">{p.name}{p.isLocal ? ' (you)' : ''}</span>
        {p.screen && <MonitorUp className="h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden="true" />}
        {(p.quality === 'poor' || p.quality === 'lost') && <WifiOff className={cx('ml-auto h-3.5 w-3.5 shrink-0', p.quality === 'lost' ? 'text-red-300' : 'text-amber-300')} aria-hidden="true" />}
      </figcaption>
    </figure>
  );
}
