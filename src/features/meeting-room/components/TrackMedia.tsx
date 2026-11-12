/**
 * Renders one LiveKit track into a <video>/<audio> element with track.attach(el) and removes it with
 * track.detach(el) when the track changes or the component unmounts (LiveKit uses attached elements for
 * adaptive stream sizing, so detaching matters).
 */
import React, { useEffect, useRef } from 'react';
import { objectFitFor } from '../room/layout';
import type { TrackRef } from '../room/types';

export function TrackVideo({ trackRef, kind, mirror = false, className, label }: {
  trackRef: TrackRef; kind: 'camera' | 'screen'; mirror?: boolean; className?: string; label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const track = trackRef.track;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track, trackRef.id]);
  return (
    <video
      ref={ref}
      aria-label={label}
      autoPlay
      muted
      playsInline
      className={className}
      style={{ objectFit: objectFitFor(kind), transform: mirror ? 'scaleX(-1)' : undefined, width: '100%', height: '100%', background: '#000' }}
    />
  );
}

/** Remote audio. Hidden; volume follows the system. */
export function TrackAudio({ trackRef }: { trackRef: TrackRef }) {
  const ref = useRef<HTMLAudioElement>(null);
  const track = trackRef.track;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track, trackRef.id]);
  return <audio ref={ref} autoPlay hidden />;
}
