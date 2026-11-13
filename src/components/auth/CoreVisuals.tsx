/**
 * Obsidian Core brand marks for the sign-in, start-up and workspace-preparation screens
 * (design: docs/design/sign-in-board). Pure SVG, no data.
 */
import React, { useId } from 'react';

/** Hexagon emblem with a lit core. */
export function CoreEmblem({ size = 24, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`oc-eg-${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7EE8F5" /><stop offset="1" stopColor="#8B7CFF" /></linearGradient>
      </defs>
      <polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="#101219" stroke={`url(#oc-eg-${id})`} strokeWidth="2.4" />
      <polygon points="32,14 47.6,23 47.6,41 32,50 16.4,41 16.4,23" fill="none" stroke={`url(#oc-eg-${id})`} strokeWidth="1.4" opacity="0.55" transform="rotate(30 32 32)" />
      <circle cx="32" cy="32" r="7.5" fill={`url(#oc-eg-${id})`} />
      <circle cx="32" cy="32" r="3" fill="#0B0D12" />
    </svg>
  );
}

/** Product name next to the emblem. */
export function CoreWordmark({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em] text-[var(--text)]">
      <CoreEmblem size={size} />Obsidian Core
    </span>
  );
}

const TICKS = Array.from({ length: 120 }, (_, i) => i);
const ORBITS = Array.from({ length: 18 }, (_, i) => i);

/**
 * The core: tick ring, a progress arc for `percent` (0–100), and a slowly turning lattice.
 * `percent` null shows an indeterminate sweep (e.g. while the session is being checked).
 */
export function CoreScan({ percent, size = 300, children }: { percent: number | null; size?: number; children?: React.ReactNode }) {
  const id = useId().replace(/:/g, '');
  const r = 128, c = 2 * Math.PI * r;
  const p = percent == null ? 0.22 : Math.max(0, Math.min(100, percent)) / 100;
  return (
    <div className="relative mx-auto" style={{ width: size, maxWidth: '100%', aspectRatio: '1 / 1' }}>
      <svg viewBox="0 0 300 300" className="h-full w-full" aria-hidden="true">
        <defs>
          <radialGradient id={`oc-glow-${id}`} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#5EE0F2" stopOpacity=".28" /><stop offset=".45" stopColor="#7A6CFF" stopOpacity=".11" /><stop offset="1" stopColor="#7A6CFF" stopOpacity="0" /></radialGradient>
          <linearGradient id={`oc-arc-${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5EE0F2" /><stop offset="1" stopColor="#8B7CFF" /></linearGradient>
          <filter id={`oc-soft-${id}`}><feGaussianBlur stdDeviation="2.2" /></filter>
        </defs>
        <circle cx="150" cy="150" r="148" fill={`url(#oc-glow-${id})`} />
        <g stroke="rgb(170 185 215 / .22)" strokeWidth="1">
          {TICKS.map((i) => {
            const a = (i * 3 * Math.PI) / 180, r2 = i % 10 === 0 ? 147 : 143;
            return <line key={i} x1={150 + 140 * Math.cos(a)} y1={150 + 140 * Math.sin(a)} x2={150 + r2 * Math.cos(a)} y2={150 + r2 * Math.sin(a)} />;
          })}
        </g>
        <circle cx="150" cy="150" r={r} fill="none" stroke="rgb(170 185 215 / .1)" strokeWidth="6" />
        <g className={percent == null ? 'oc-spin-fast' : undefined}>
          <circle cx="150" cy="150" r={r} fill="none" stroke={`url(#oc-arc-${id})`} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${p * c} ${c}`} transform="rotate(-90 150 150)" style={{ transition: 'stroke-dasharray .6s ease' }} />
          <circle cx="150" cy="150" r={r} fill="none" stroke={`url(#oc-arc-${id})`} strokeWidth="10" strokeDasharray={`${p * c} ${c}`} transform="rotate(-90 150 150)" filter={`url(#oc-soft-${id})`} opacity=".5" style={{ transition: 'stroke-dasharray .6s ease' }} />
        </g>
        <g className="oc-spin" fill="none" strokeWidth=".9">
          {ORBITS.map((i) => <ellipse key={i} cx="150" cy="150" rx="104" ry="40" transform={`rotate(${i * 10} 150 150)`} stroke={i % 2 ? 'rgb(139 124 255 / .38)' : 'rgb(94 224 242 / .42)'} />)}
          <circle cx="150" cy="150" r="82" stroke="rgb(94 224 242 / .18)" strokeDasharray="2 5" />
          <circle cx="150" cy="150" r="100" stroke="rgb(94 224 242 / .18)" strokeDasharray="2 5" />
        </g>
        <circle cx="150" cy="150" r="58" fill="#0B0D12" stroke="rgb(94 224 242 / .35)" />
        <circle cx="150" cy="150" r="58" fill={`url(#oc-glow-${id})`} opacity=".55" />
      </svg>
      {children && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>}
    </div>
  );
}
