/** Shared state: who's signed in (dev identity hint), dashboard data, selected location, navigation. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { call, type Dashboard, type GLocation } from './api';

export type Route = 'dashboard' | 'audit' | 'optimize' | 'profile' | 'reviews' | 'posts' | 'competitors' | 'visibility' | 'analytics' | 'assistant' | 'automation' | 'security' | 'settings';

interface Ctx {
  api: <T>(path: string, init?: RequestInit & { json?: unknown; form?: FormData }) => Promise<T>;
  dash: Dashboard | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  reload: () => Promise<void>;
  location: GLocation | null;
  locationName: string;
  setLocation: (name: string) => void;
  route: Route;
  go: (r: Route, opts?: { focus?: string }) => void;
  focus: string | null;
}

const C = createContext<Ctx | null>(null);
const KEY = 'gp_location';

export function GrowthProvider({ devUser, children }: { devUser: string; children: React.ReactNode }) {
  const api = useCallback(<T,>(p: string, i?: RequestInit & { json?: unknown; form?: FormData }) => call<T>(devUser, p, i), [devUser]);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [status, setStatus] = useState<Ctx['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [locationName, setLocationName] = useState<string>(() => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } });
  const [route, setRoute] = useState<Route>('dashboard');
  const [focus, setFocus] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await api<Dashboard>('/growth/dashboard');
      setDash(d); setStatus('ready'); setError(null);
    } catch (e: any) {
      // Not configured / not connected still returns a usable connection object.
      try { const c = await api<any>('/connection'); setDash({ connection: c, locations: [], activity: [], security: { status: 'disconnected', alerts: 0 }, inboxOpen: 0, onboarding: {}, automation: { enabled: true }, aiConfigured: c.aiConfigured, placesConfigured: false }); setStatus('ready'); setError(null); }
      catch { setError(e.message); setStatus('error'); }
    }
  }, [api]);
  useEffect(() => { reload(); }, [reload]);

  const locs = dash?.locations ?? [];
  const location = locs.find((l) => l.location.name === locationName)?.location ?? locs[0]?.location ?? null;
  const setLocation = (name: string) => { setLocationName(name); try { localStorage.setItem(KEY, name); } catch { /* ignore */ } };

  const value = useMemo<Ctx>(() => ({
    api, dash, status, error, reload, location, locationName: location?.name ?? '', setLocation,
    route, go: (r, o) => { setRoute(r); setFocus(o?.focus ?? null); document.getElementById('gp-main')?.scrollTo({ top: 0 }); }, focus,
  }), [api, dash, status, error, reload, location, route, focus]); // eslint-disable-line react-hooks/exhaustive-deps

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useGrowth() {
  const v = useContext(C);
  if (!v) throw new Error('useGrowth outside GrowthProvider');
  return v;
}

/** Fetch-on-mount helper with loading / error / reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); setCode(null); }
    catch (e: any) { setError(e.message); setCode(e.code ?? null); }
    finally { setLoading(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { data, setData, error, code, loading, reload: run };
}

/** Maps an audit/inbox action to the page that handles it. */
export function routeForAction(type: string): Route {
  switch (type) {
    case 'reply_reviews': case 'request_reviews': return 'reviews';
    case 'create_post': return 'posts';
    case 'review_google_updates': case 'verify_profile': return 'security';
    case 'edit_description': case 'edit_contact': case 'edit_hours': case 'edit_special_hours': case 'edit_categories': case 'edit_services': case 'edit_attributes': case 'add_photos': case 'open_in_google': return 'profile';
    case 'add_competitor': return 'competitors';
    case 'run_audit': return 'audit';
    case 'improve_description': return 'optimize';
    case 'draft_post': return 'posts';
    case 'reconnect': return 'settings';
    case 'view_performance': return 'analytics';
    default: return 'dashboard';
  }
}
