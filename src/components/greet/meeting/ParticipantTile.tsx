/** One person in the grid: video (or avatar), name, mic/camera state, hand, speaking ring, pin. */
import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Hand, MessageSquare, MicOff, Pause, Pin, PinOff, VideoOff } from 'lucide-react';

export interface TileModel {
  id: string;
  name: string;
  initials: string;
  avatarGradient?: string;
  isLocal?: boolean;
  isHost?: boolean;
  muted: boolean;
  camOff: boolean;
  paused?: boolean;
  speaking?: boolean;
  handRaised?: boolean;
  /** Local camera stream; remote media plugs in here once WebRTC peers are connected. */
  stream?: MediaStream | null;
  mirror?: boolean;
  filterCss?: string;
}

export function ParticipantTile({ tile, pinned, compact, fill, onPin, onMessage, onVideoEl }: {
  tile: TileModel; pinned?: boolean; compact?: boolean; fill?: boolean;
  onPin?: (id: string | null) => void; onMessage?: (id: string) => void; onVideoEl?: (el: HTMLVideoElement | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const showVideo = Boolean(tile.stream) && !tile.camOff;
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (showVideo && tile.stream && v.srcObject !== tile.stream) {
      v.srcObject = tile.stream;
      v.play().catch(() => {});
    }
    onVideoEl?.(showVideo ? v : null);
  }, [showVideo, tile.stream, onVideoEl]);

  const avatarSize = compact ? 44 : fill ? 112 : 76;
  const label = `${tile.name}${tile.isLocal ? ' (you)' : ''}${tile.isHost ? ', host' : ''}${tile.muted ? ', muted' : ''}${tile.camOff ? ', camera off' : ''}${tile.handRaised ? ', hand raised' : ''}${tile.speaking ? ', speaking' : ''}`;

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className={`m-tile${tile.speaking ? ' is-speaking' : ''}${compact ? ' is-compact' : ''}${fill ? ' is-fill' : ''}`}
      role="group" aria-label={label}>
      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted
          style={{ transform: tile.mirror ? 'scaleX(-1)' : undefined, filter: tile.filterCss && tile.filterCss !== 'none' ? tile.filterCss : undefined }} />
      ) : (
        <div className="m-tile-avatar">
          <span className="m-avatar" style={{ width: avatarSize, height: avatarSize, fontSize: avatarSize * 0.36, background: tile.avatarGradient }} aria-hidden>
            {tile.initials}
          </span>
        </div>
      )}
      {tile.paused && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: 'rgba(8,9,14,.7)', color: '#fff' }}>
          <Pause size={compact ? 18 : 26} aria-hidden /><span className="text-[12px] font-semibold">Video paused</span>
        </div>
      )}
      {tile.handRaised && <span className="m-tile-hand"><Hand size={12} className="mr-1 inline -translate-y-px" aria-hidden />Hand raised</span>}
      <div className="m-tile-name">
        <span>{tile.isLocal ? `${tile.name} (You)` : tile.name}</span>
        {tile.isHost && !compact && <span style={{ opacity: 0.7, fontWeight: 500 }}>Host</span>}
      </div>
      <div className="m-tile-status" aria-hidden>
        {tile.camOff && <span className="m-tile-flag"><VideoOff size={compact ? 11 : 14} /></span>}
        {tile.muted && <span className="m-tile-flag is-off"><MicOff size={compact ? 11 : 14} /></span>}
      </div>
      {(onPin || (onMessage && !tile.isLocal)) && (
        <div className="m-tile-actions">
          {onPin && (
            <button type="button" className="m-tile-action" aria-label={pinned ? `Unpin ${tile.name}` : `Pin ${tile.name}`} title={pinned ? 'Unpin' : 'Pin'}
              onClick={() => onPin(pinned ? null : tile.id)}>
              {pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          )}
          {onMessage && !tile.isLocal && (
            <button type="button" className="m-tile-action" aria-label={`Message ${tile.name}`} title="Private message" onClick={() => onMessage(tile.id)}>
              <MessageSquare size={14} />
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
