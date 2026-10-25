import React, { createContext, useContext, useEffect, useState } from 'react';
import type { WeekStart } from '../domain/calendar';
import { ALL_PLATFORMS, type PlatformId } from '../domain/model';

/** View preferences only. Posts and accounts always come from the server. */
export interface PlannerPrefs {
  weekStart: WeekStart;
  hour12: boolean;
  defaultHour: number;
  defaultPlatforms: PlatformId[];
}

const defaults = (): PlannerPrefs => {
  let hour12 = true;
  try { hour12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 ?? true; } catch { /* default */ }
  return { weekStart: 0, hour12, defaultHour: 10, defaultPlatforms: [] };
};

function sanitize(raw: any): PlannerPrefs {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  return {
    weekStart: raw.weekStart === 1 ? 1 : 0,
    hour12: typeof raw.hour12 === 'boolean' ? raw.hour12 : d.hour12,
    defaultHour: Number.isInteger(raw.defaultHour) && raw.defaultHour >= 0 && raw.defaultHour <= 23 ? raw.defaultHour : d.defaultHour,
    defaultPlatforms: Array.isArray(raw.defaultPlatforms) ? raw.defaultPlatforms.filter((p: any) => ALL_PLATFORMS.includes(p)) : [],
  };
}

const Ctx = createContext<{ prefs: PlannerPrefs; setPrefs: (p: PlannerPrefs) => void } | null>(null);

export function PrefsProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const key = `pulse_planner_prefs_${userId}`;
  const [prefs, setPrefsState] = useState<PlannerPrefs>(() => {
    try { return sanitize(JSON.parse(localStorage.getItem(key) || 'null')); } catch { return defaults(); }
  });
  useEffect(() => {
    try { setPrefsState(sanitize(JSON.parse(localStorage.getItem(key) || 'null'))); } catch { setPrefsState(defaults()); }
  }, [key]);
  const setPrefs = (p: PlannerPrefs) => {
    setPrefsState(p);
    try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* storage unavailable */ }
  };
  return <Ctx.Provider value={{ prefs, setPrefs }}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return v;
}
