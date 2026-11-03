/**
 * Meeting UI state — what's open, layout, theme and view preferences.
 * Kept apart from meeting state (MeetingSessionContext) and media (lib/meetingMedia).
 * View preferences persist per browser; open panels and dialogs do not.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { VideoFilterId } from '../../../lib/meetingMedia';

export type PanelId = 'chat' | 'people' | 'greet' | 'transcript' | 'notes' | 'whiteboard' | 'polls' | 'summary';
export type DialogId = 'settings' | 'info' | 'shortcuts' | 'help' | 'background' | 'invite' | 'leave' | 'record-consent' | null;
export type SettingsTab = 'audio' | 'video' | 'devices' | 'preferences';
export type LayoutMode = 'gallery' | 'speaker';
export type MeetingTheme = 'dark' | 'light';

interface Prefs {
  theme: MeetingTheme;
  layout: LayoutMode;
  showSelfView: boolean;
  videoFilter: VideoFilterId;
  lowBandwidth: boolean;
}

export interface MeetingUi extends Prefs {
  panel: PanelId | null;
  dialog: DialogId;
  settingsTab: SettingsTab;
  backgroundTab: 'effects' | 'virtual';
  pinnedId: string | null;
  captions: boolean;
  handRaised: boolean;
  moreOpen: boolean;
  openPanel: (p: PanelId) => void;
  togglePanel: (p: PanelId) => void;
  closePanel: () => void;
  openDialog: (d: Exclude<DialogId, null>, opts?: { settingsTab?: SettingsTab; backgroundTab?: 'effects' | 'virtual' }) => void;
  closeDialog: () => void;
  setPinned: (id: string | null) => void;
  setCaptions: (on: boolean) => void;
  setHandRaised: (on: boolean) => void;
  setMoreOpen: (on: boolean) => void;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}

const DEFAULTS: Prefs = { theme: 'dark', layout: 'gallery', showSelfView: true, videoFilter: 'none', lowBandwidth: false };
const KEY = 'obsidian_meeting_ui_prefs';

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw);
    return {
      theme: p.theme === 'light' ? 'light' : 'dark',
      layout: p.layout === 'speaker' ? 'speaker' : 'gallery',
      showSelfView: p.showSelfView !== false,
      videoFilter: typeof p.videoFilter === 'string' ? p.videoFilter : 'none',
      lowBandwidth: p.lowBandwidth === true,
    };
  } catch { return DEFAULTS; }
}

const Ctx = createContext<MeetingUi | null>(null);

export function MeetingUiProvider({ children, initialPanel = null }: { children: React.ReactNode; initialPanel?: PanelId | null }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [panel, setPanel] = useState<PanelId | null>(initialPanel);
  const [dialog, setDialog] = useState<DialogId>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('audio');
  const [backgroundTab, setBackgroundTab] = useState<'effects' | 'virtual'>('effects');
  const [pinnedId, setPinned] = useState<string | null>(null);
  const [captions, setCaptions] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ } }, [prefs]);

  const setPref = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => setPrefs((p) => ({ ...p, [key]: value })), []);
  const openDialog = useCallback<MeetingUi['openDialog']>((d, opts) => {
    if (opts?.settingsTab) setSettingsTab(opts.settingsTab);
    if (opts?.backgroundTab) setBackgroundTab(opts.backgroundTab);
    setMoreOpen(false);
    setDialog(d);
  }, []);

  const value = useMemo<MeetingUi>(() => ({
    ...prefs, panel, dialog, settingsTab, backgroundTab, pinnedId, captions, handRaised, moreOpen,
    openPanel: (p) => { setPanel(p); setMoreOpen(false); },
    togglePanel: (p) => setPanel((cur) => (cur === p ? null : p)),
    closePanel: () => setPanel(null),
    openDialog,
    closeDialog: () => setDialog(null),
    setPinned, setCaptions, setHandRaised, setMoreOpen, setPref,
  }), [prefs, panel, dialog, settingsTab, backgroundTab, pinnedId, captions, handRaised, moreOpen, openDialog, setPref]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMeetingUi(): MeetingUi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMeetingUi must be used inside MeetingUiProvider');
  return v;
}

// ---------- Behaviour hooks ----------

/**
 * Active speaker detection: the local user when the mic level is above the
 * threshold, otherwise the first remote participant flagged as speaking.
 * Holds the last speaker for `holdMs` so the highlight doesn't flicker.
 */
export function useActiveSpeaker(remote: { id: string; isSpeaking: boolean }[], localLevel: number, localMuted: boolean, holdMs = 1200, threshold = 32): string | null {
  const [active, setActive] = useState<string | null>(null);
  const last = useRef<{ id: string | null; at: number }>({ id: null, at: 0 });
  const speakingRemote = remote.find((p) => p.isSpeaking)?.id ?? null;
  const localSpeaking = !localMuted && localLevel > threshold;
  const candidate = localSpeaking ? 'local-user' : speakingRemote;
  useEffect(() => {
    const now = Date.now();
    if (candidate) {
      last.current = { id: candidate, at: now };
      setActive(candidate);
      return;
    }
    const t = setTimeout(() => {
      if (Date.now() - last.current.at >= holdMs) setActive(null);
    }, holdMs);
    return () => clearTimeout(t);
  }, [candidate, holdMs]);
  return active;
}

export type NetworkQuality = 'good' | 'fair' | 'poor' | 'offline';

export interface NetworkStatus {
  online: boolean;
  quality: NetworkQuality;
  rttMs: number | null;
  downlinkMbps: number | null;
  /** True while offline or while retrying after coming back online. */
  reconnecting: boolean;
  attempt: number;
  retryNow: () => void;
}

export function rateConnection(c: { effectiveType?: string; rtt?: number; downlink?: number } | undefined, online: boolean): NetworkQuality {
  if (!online) return 'offline';
  if (!c) return 'good';
  if (c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || (c.rtt ?? 0) > 600 || (c.downlink ?? 10) < 0.5) return 'poor';
  if (c.effectiveType === '3g' || (c.rtt ?? 0) > 250 || (c.downlink ?? 10) < 1.5) return 'fair';
  return 'good';
}

/**
 * Network quality from the Network Information API, plus connection recovery:
 * when the browser goes offline it retries with backoff (2s → 30s) until a
 * reachability check passes, then calls `onRecovered`.
 */
export function useNetworkStatus(onRecovered?: () => void): NetworkStatus {
  const conn = typeof navigator !== 'undefined' ? (navigator as any).connection : undefined;
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [info, setInfo] = useState(() => ({ effectiveType: conn?.effectiveType, rtt: conn?.rtt, downlink: conn?.downlink }));
  const [reconnecting, setReconnecting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<number | null>(null);
  const recoveredRef = useRef(onRecovered);
  recoveredRef.current = onRecovered;

  const check = useCallback(async () => {
    if (!navigator.onLine) return false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      await fetch(`${window.location.origin}/?ping=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      return true;
    } catch { return false; }
  }, []);

  const schedule = useCallback((n: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    const delay = Math.min(30_000, 2000 * 2 ** Math.min(n, 4));
    timer.current = window.setTimeout(async () => {
      setAttempt(n + 1);
      if (await check()) {
        setReconnecting(false);
        setOnline(true);
        setAttempt(0);
        recoveredRef.current?.();
      } else schedule(n + 1);
    }, delay);
  }, [check]);

  useEffect(() => {
    const down = () => { setOnline(false); setReconnecting(true); schedule(0); };
    const up = () => { setReconnecting(true); schedule(-1); };
    const change = () => setInfo({ effectiveType: conn?.effectiveType, rtt: conn?.rtt, downlink: conn?.downlink });
    window.addEventListener('offline', down);
    window.addEventListener('online', up);
    conn?.addEventListener?.('change', change);
    return () => {
      window.removeEventListener('offline', down);
      window.removeEventListener('online', up);
      conn?.removeEventListener?.('change', change);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [conn, schedule]);

  return {
    online,
    quality: rateConnection(info, online && !reconnecting),
    rttMs: typeof info.rtt === 'number' ? info.rtt : null,
    downlinkMbps: typeof info.downlink === 'number' ? info.downlink : null,
    reconnecting,
    attempt,
    retryNow: () => schedule(-1),
  };
}

export interface ShortcutDef { keys: string; label: string; }
export const SHORTCUTS: ShortcutDef[] = [
  { keys: 'M', label: 'Mute or unmute microphone' },
  { keys: 'V', label: 'Turn camera on or off' },
  { keys: 'S', label: 'Start or stop screen share' },
  { keys: 'C', label: 'Open or close chat' },
  { keys: 'P', label: 'Open or close participants' },
  { keys: 'H', label: 'Raise or lower hand' },
  { keys: 'L', label: 'Switch gallery / speaker view' },
  { keys: 'F', label: 'Fullscreen' },
  { keys: '.', label: 'Open More options' },
  { keys: '?', label: 'Show keyboard shortcuts' },
  { keys: 'Esc', label: 'Close menu, dialog or panel' },
];

/** Single-key shortcuts, ignored while typing in a field or with a modifier held. */
export function useMeetingShortcuts(handlers: Partial<Record<'m' | 'v' | 's' | 'c' | 'p' | 'h' | 'l' | 'f' | '.' | '?' | 'escape', () => void>>, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
      const key = e.key.toLowerCase() as keyof typeof handlers;
      if (key === 'escape') { ref.current.escape?.(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const fn = ref.current[key];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
