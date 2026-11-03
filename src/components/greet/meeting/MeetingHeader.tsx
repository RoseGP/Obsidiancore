/** Slim top bar: title, timer against the session limit, recording, people, connection quality. */
import React from 'react';
import { Info, Lock, Signal, SignalLow, SignalMedium, Users, WifiOff } from 'lucide-react';
import type { NetworkStatus } from './useMeetingUi';

const fmt = (t: number) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n: number) => n.toString().padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
};

export function NetworkIndicator({ net }: { net: NetworkStatus }) {
  const Icon = net.quality === 'offline' ? WifiOff : net.quality === 'poor' ? SignalLow : net.quality === 'fair' ? SignalMedium : Signal;
  const label = net.quality === 'offline' ? 'Offline' : net.reconnecting ? 'Reconnecting' : net.quality === 'good' ? 'Good connection' : net.quality === 'fair' ? 'Fair connection' : 'Poor connection';
  const tone = net.quality === 'offline' || net.quality === 'poor' ? 'danger' : net.quality === 'fair' || net.reconnecting ? 'warn' : undefined;
  const detail = [net.rttMs != null ? `${net.rttMs} ms` : null, net.downlinkMbps != null ? `${net.downlinkMbps} Mbps` : null].filter(Boolean).join(' · ');
  return (
    <span className="m-chip m-tip" data-tone={tone} data-tip={detail ? `${label} · ${detail}` : label} tabIndex={0} aria-label={detail ? `${label}, ${detail}` : label}>
      <Icon size={14} aria-hidden /><span className="hidden md:inline">{label.replace(' connection', '')}</span>
    </span>
  );
}

export function MeetingHeader({ title, elapsed, limitMinutes, warn, recording, recordingPaused, recordingSeconds, people, net, onInfo, onPeople }: {
  title: string; elapsed: number; limitMinutes: number; warn: boolean; recording: boolean; recordingPaused: boolean; recordingSeconds: number;
  people: number; net: NetworkStatus; onInfo: () => void; onPeople: () => void;
}) {
  return (
    <header className="flex flex-none items-center gap-2 px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Lock size={14} className="m-faint flex-none" aria-label="Encrypted" />
        <h1 className="min-w-0 truncate text-[15px] font-semibold">{title}</h1>
        <button type="button" className="m-icon-btn flex-none" aria-label="Meeting information" title="Meeting information" onClick={onInfo}><Info size={16} /></button>
      </div>
      <div className="flex flex-none items-center gap-1.5">
        {recording && (
          <span className="m-chip" data-tone="rec" role="status" aria-label={recordingPaused ? 'Recording paused' : 'Recording'}>
            <span className={`m-dot${recordingPaused ? '' : ' is-live'}`} aria-hidden />{recordingPaused ? 'Paused' : 'REC'} <span className="m-num">{fmt(recordingSeconds)}</span>
          </span>
        )}
        <span className="m-chip m-num" data-tone={warn ? 'warn' : undefined} role="timer" aria-label={`Elapsed ${fmt(elapsed)}${limitMinutes ? ` of ${limitMinutes} minutes` : ''}`}>
          {fmt(elapsed)}{limitMinutes > 0 && <span className="m-faint">/ {limitMinutes}:00</span>}
        </span>
        <button type="button" className="m-chip hidden sm:inline-flex" style={{ cursor: 'pointer', font: 'inherit' }} onClick={onPeople} aria-label={`${people} participants`}>
          <Users size={14} aria-hidden /><span className="m-num">{people}</span>
        </button>
        <NetworkIndicator net={net} />
      </div>
    </header>
  );
}
