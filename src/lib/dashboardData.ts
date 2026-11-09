/**
 * One request per dashboard endpoint, shared by the dashboard and its widgets.
 * Concurrent callers share the in-flight request; results are reused for a few seconds; any
 * change (new deal, stage moved, ticket resolved) calls invalidateDashboard() so the next read is fresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardData } from './dashboardMetrics';

const TTL_MS = 15_000;
const cache = new Map<string, { at: number; promise: Promise<any> }>();
const listeners = new Set<() => void>();

export async function getDashboardJson<T = any>(url: string, opts: { fresh?: boolean } = {}): Promise<T> {
  const hit = cache.get(url);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = fetch(url).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      const err: any = new Error(data?.error || `Request failed (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return data;
  });
  cache.set(url, { at: Date.now(), promise });
  promise.catch(() => { if (cache.get(url)?.promise === promise) cache.delete(url); });
  return promise;
}

/** Drop cached results and tell every mounted dashboard view to reload. */
export function invalidateDashboard() {
  cache.clear();
  for (const l of [...listeners]) l();
}

export function onDashboardInvalidated(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export interface DashboardBundle extends DashboardData {
  activities: Array<{ id: string; type: string; title: string; description?: string; actor?: string; targetId?: string; targetType?: string; timestamp?: string }>;
}

/** Loads deals, leads, tickets and recent activity together. */
export function useDashboardData() {
  const [data, setData] = useState<DashboardBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const alive = useRef(true);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    setError(null);
    const [deals, leads, tickets, acts] = await Promise.allSettled([
      getDashboardJson('/api/dashboard/deals', { fresh }),
      getDashboardJson('/api/dashboard/leads', { fresh }),
      getDashboardJson('/api/dashboard/tickets', { fresh }),
      getDashboardJson('/api/dashboard/activities', { fresh }),
    ]);
    if (!alive.current) return;
    const pick = (r: PromiseSettledResult<any>, key: string) => (r.status === 'fulfilled' && Array.isArray(r.value?.[key]) ? r.value[key] : []);
    const failed = [deals, leads, tickets, acts].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length === 4) {
      setError(failed[0].reason?.status === 401 || failed[0].reason?.status === 403
        ? 'You don\'t have access to this organization\'s data. Sign in again or ask an admin.'
        : 'The dashboard couldn\'t load. Check your connection and try again.');
    } else if (failed.length) {
      setError('Some dashboard data couldn\'t load; figures may be incomplete.');
    }
    setData({ deals: pick(deals, 'deals'), leads: pick(leads, 'leads'), tickets: pick(tickets, 'tickets'), activities: pick(acts, 'activities') });
    setUpdatedAt(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    alive.current = true;
    load();
    const off = onDashboardInvalidated(() => load(true));
    return () => { alive.current = false; off(); };
  }, [load]);

  return { data, loading, error, updatedAt, refresh: () => load(true) };
}
