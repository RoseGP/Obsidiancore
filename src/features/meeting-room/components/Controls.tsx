/** Media controls and device-issue messages shared by the pre-join and in-meeting scenes. */
import React from 'react';
import { AlertTriangle, Loader2, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, RefreshCw, Video, VideoOff } from 'lucide-react';
import { Button, cx, focusRing } from '../../../components/dashboard/ui';
import type { DeviceKind } from '../media/deviceErrors';
import type { DeviceState, ScreenState } from '../room/types';

const roundBtn = (on: boolean, danger = false) => cx(
  'relative inline-flex h-12 min-w-12 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
  danger ? 'bg-[var(--danger)] text-white hover:opacity-90' : on ? 'bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--surface-sunken)]' : 'bg-neutral-800 text-white hover:bg-neutral-700',
  focusRing,
);

export function DeviceToggle({ state, onToggle, showLabel = false }: { state: DeviceState; onToggle: () => void; showLabel?: boolean }) {
  const cam = state.kind === 'camera';
  const name = cam ? 'camera' : 'microphone';
  const label = state.pending ? `Starting ${name}…` : state.active ? `Turn off ${name}` : `Turn on ${name}`;
  const Icon = state.pending ? Loader2 : cam ? (state.active ? Video : VideoOff) : (state.active ? Mic : MicOff);
  return (
    <button type="button" className={roundBtn(state.active)} onClick={onToggle} disabled={state.pending}
      aria-pressed={state.active} aria-label={label} title={label} id={`btn-${cam ? 'camera' : 'mic'}`}>
      <Icon className={cx('h-5 w-5', state.pending && 'animate-spin')} aria-hidden="true" />
      {showLabel && <span>{state.active ? (cam ? 'Camera on' : 'Mic on') : (cam ? 'Camera off' : 'Mic off')}</span>}
      {state.issue && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-[var(--warning)] ring-2 ring-neutral-900" aria-hidden="true" />}
    </button>
  );
}

export function ScreenShareToggle({ state, onToggle }: { state: ScreenState; onToggle: () => void }) {
  if (!state.supported) return null; // phones and tablets: browsers there can't capture the screen
  const label = state.pending ? 'Working on screen sharing…' : state.active ? 'Stop sharing your screen' : 'Share your screen';
  const Icon = state.pending ? Loader2 : state.active ? MonitorOff : MonitorUp;
  return (
    <button type="button" id="btn-screen" className={cx(roundBtn(!state.active), state.active && '!bg-sky-600 !text-white !border-sky-600')} onClick={onToggle}
      disabled={state.pending} aria-pressed={state.active} aria-label={label} title={label}>
      <Icon className={cx('h-5 w-5', state.pending && 'animate-spin')} aria-hidden="true" />
      <span className="hidden sm:inline">{state.active ? 'Stop sharing' : 'Share screen'}</span>
    </button>
  );
}

export function LeaveButton({ onLeave, busy }: { onLeave: () => void; busy?: boolean }) {
  return (
    <button type="button" id="btn-leave" className={roundBtn(false, true)} onClick={onLeave} disabled={busy} aria-label="Leave the meeting" title="Leave the meeting">
      <PhoneOff className="h-5 w-5" aria-hidden="true" /><span className="hidden sm:inline">Leave</span>
    </button>
  );
}

/** A camera/microphone problem with what to do next, and Retry when trying again can help. */
export function DeviceIssueMessage({ state, onRetry }: { state: DeviceState; onRetry: (kind: DeviceKind) => void }) {
  if (!state.issue) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-card)] bg-[var(--warning-soft)] px-3 py-2 text-[13px] text-[var(--text)]">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
      <span className="flex-1">{state.issue.message}</span>
      <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => onRetry(state.kind)} disabled={state.pending}>
        {state.issue.retryable ? 'Try again' : 'Check again'}
      </Button>
    </div>
  );
}

export function DeviceSelect({ state, onSelect }: { state: DeviceState; onSelect: (kind: DeviceKind, id: string | null) => void }) {
  if (state.devices.length < 2) return null;
  const id = `select-${state.kind}`;
  return (
    <label htmlFor={id} className="block text-[12px] text-[var(--text-muted)]">
      <span className="mb-1 block">{state.kind === 'camera' ? 'Camera' : 'Microphone'}</span>
      <select id={id} value={state.deviceId ?? ''} onChange={(e) => onSelect(state.kind, e.target.value || null)}
        className={cx('w-full rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-[13px] text-[var(--text)]', focusRing)}>
        <option value="">System default</option>
        {state.devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
      </select>
    </label>
  );
}
