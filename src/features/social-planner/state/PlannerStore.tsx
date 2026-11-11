import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectedAccount, PlannerPost } from '../domain/model';
import type { PlannerApi } from '../services/plannerApi';

type LoadState = { status: 'loading' | 'ready' | 'error'; error?: string };

interface PlannerStoreValue {
  api: PlannerApi;
  posts: PlannerPost[];
  /** Fetches the range (cached per range). Returns its load state. */
  useRange(from: Date, to: Date): LoadState & { reload(): void };
  accounts: ConnectedAccount[] | null;
  accountsState: LoadState;
  reloadAccounts(): void;
  isBusy(postId: string): boolean;
  create(input: Parameters<PlannerApi['createPost']>[0]): Promise<PlannerPost>;
  update(id: string, patch: Parameters<PlannerApi['updatePost']>[1], optimistic?: Partial<PlannerPost>): Promise<PlannerPost>;
  remove(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  lastSyncedAt: Date | null;
}

const Ctx = createContext<PlannerStoreValue | null>(null);

export function PlannerStoreProvider({ api, children }: { api: PlannerApi; children: React.ReactNode }) {
  const [byId, setById] = useState<Map<string, PlannerPost>>(new Map());
  const [ranges, setRanges] = useState<Record<string, LoadState>>({});
  const [accounts, setAccounts] = useState<ConnectedAccount[] | null>(null);
  const [accountsState, setAccountsState] = useState<LoadState>({ status: 'loading' });
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const inflight = useRef(new Map<string, Promise<void>>());
  const locks = useRef(new Set<string>());

  // Reset when the user (api) changes.
  useEffect(() => { setById(new Map()); setRanges({}); setAccounts(null); }, [api]);

  const loadRange = useCallback((from: Date, to: Date, force = false) => {
    const key = `${from.toISOString()}|${to.toISOString()}`;
    if (!force && inflight.current.has(key)) return;
    setRanges((r) => ({ ...r, [key]: { status: 'loading' } }));
    const p = api.listPosts({ from, to })
      .then((list) => {
        setById((prev) => {
          const next = new Map(prev);
          // Replace everything in this window with the server's view.
          for (const [id, post] of next) {
            const t = new Date(post.scheduledAt).getTime();
            if (t >= from.getTime() && t <= to.getTime()) next.delete(id);
          }
          for (const post of list) next.set(post.id, post);
          return next;
        });
        setRanges((r) => ({ ...r, [key]: { status: 'ready' } }));
        setLastSyncedAt(new Date());
      })
      .catch((err) => setRanges((r) => ({ ...r, [key]: { status: 'error', error: err?.message ?? 'Posts couldn’t be loaded.' } })))
      .finally(() => { if (inflight.current.get(key) === p) inflight.current.delete(key); });
    inflight.current.set(key, p);
  }, [api]);

  const loadAccounts = useCallback(() => {
    setAccountsState({ status: 'loading' });
    api.listAccounts()
      .then((a) => { setAccounts(a); setAccountsState({ status: 'ready' }); })
      .catch((err) => setAccountsState({ status: 'error', error: err?.message ?? 'Accounts couldn’t be loaded.' }));
  }, [api]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  /** One mutation per post at a time: prevents double submits and racing drags. */
  const guarded = useCallback(async <T,>(id: string, fn: () => Promise<T>): Promise<T> => {
    if (locks.current.has(id)) throw Object.assign(new Error('This post is already being updated.'), { code: 'busy' });
    locks.current.add(id);
    setBusy((s) => new Set(s).add(id));
    try { return await fn(); } finally {
      locks.current.delete(id);
      setBusy((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }, []);

  const value: PlannerStoreValue = {
    api,
    posts: useMemo(() => [...byId.values()].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)), [byId]),
    useRange(from, to) {
      const key = `${from.toISOString()}|${to.toISOString()}`;
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useEffect(() => { loadRange(from, to); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
      const state = ranges[key] ?? { status: 'loading' as const };
      return { ...state, reload: () => loadRange(from, to, true) };
    },
    accounts,
    accountsState,
    reloadAccounts: loadAccounts,
    isBusy: (id) => busy.has(id),
    lastSyncedAt,
    async create(input) {
      // "Now" gets a fresh timestamp per click, so lock on the content instead: a double click can't publish twice.
      const lockKey = input.intent === 'now' ? `create:now:${input.content.slice(0, 80)}` : `create:${input.content.slice(0, 40)}:${input.scheduledAt}`;
      return guarded(lockKey, async () => {
        const created = await api.createPost(input);
        const list = Array.isArray(created) ? created : [created];
        setById((prev) => { const n = new Map(prev); for (const p of list) n.set(p.id, p); return n; });
        setLastSyncedAt(new Date());
        return list[0];
      });
    },
    update(id, patch, optimistic) {
      return guarded(id, async () => {
        const before = byId.get(id);
        if (before && optimistic) setById((prev) => new Map(prev).set(id, { ...before, ...optimistic }));
        try {
          const saved = await api.updatePost(id, patch);
          setById((prev) => new Map(prev).set(id, saved));
          setLastSyncedAt(new Date());
          return saved;
        } catch (err) {
          if (before) setById((prev) => new Map(prev).set(id, before)); // roll back
          throw err;
        }
      });
    },
    remove(id) {
      return guarded(id, async () => {
        const before = byId.get(id);
        setById((prev) => { const n = new Map(prev); n.delete(id); return n; });
        try {
          await api.deletePost(id);
          setLastSyncedAt(new Date());
        } catch (err) {
          if (before) setById((prev) => new Map(prev).set(id, before));
          throw err;
        }
      });
    },
    retry(id) {
      return guarded(id, async () => {
        const before = byId.get(id);
        if (before) setById((prev) => new Map(prev).set(id, { ...before, status: 'scheduled', failureReason: undefined }));
        try {
          await api.retryPost(id);
          setLastSyncedAt(new Date());
        } catch (err) {
          if (before) setById((prev) => new Map(prev).set(id, before));
          throw err;
        }
      });
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlanner() {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePlanner must be used inside <PlannerStoreProvider>');
  return v;
}
