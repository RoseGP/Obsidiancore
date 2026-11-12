/**
 * Theme preference: 'system' | 'light' | 'dark', saved in localStorage ('obsidian-theme').
 * Light is the default (DEFAULT_THEME) for everyone who hasn't chosen; a saved choice is always kept.
 * Applies data-theme on <html>; all colors come from styles/obsidian-theme.css.
 * index.html sets the attribute before first paint to avoid a flash of the wrong theme.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'obsidian-theme';
const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);
export const DEFAULT_THEME: ThemePref = 'light';
const readPref = (): ThemePref => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' || v === 'system' ? v : DEFAULT_THEME; } catch { return DEFAULT_THEME; } };

interface ThemeCtx { pref: ThemePref; resolved: 'light' | 'dark'; setPref: (p: ThemePref) => void; toggle: () => void }
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [systemDark, setSystemDark] = useState<boolean>(() => !!media()?.matches);
  useEffect(() => {
    const m = media(); if (!m) return;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener('change', on); return () => m.removeEventListener('change', on);
  }, []);
  const resolved: 'light' | 'dark' = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = resolved;
    el.style.colorScheme = resolved;
  }, [resolved]);
  const setPref = useCallback((p: ThemePref) => { setPrefState(p); try { localStorage.setItem(KEY, p); } catch { /* storage unavailable */ } }, []);
  const toggle = useCallback(() => setPref(resolved === 'dark' ? 'light' : 'dark'), [resolved, setPref]);
  const value = useMemo(() => ({ pref, resolved, setPref, toggle }), [pref, resolved, setPref, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  // Outside a provider (tests, standalone embeds) fall back to the light theme instead of throwing.
  return useContext(Ctx) ?? { pref: 'light', resolved: 'light', setPref: () => {}, toggle: () => {} };
}
