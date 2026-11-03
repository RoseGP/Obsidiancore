/**
 * CRM persistence, scoped per workspace (user id).
 *
 *   Firestore:  crm_workspaces/{uid}            { settings }
 *               crm_workspaces/{uid}/{collection}/{id}
 *   File:       <dataDir>/<uid>.json            (development / no Firestore credentials)
 *
 * Reads go through a short per-workspace cache so a page load doesn't re-read
 * the same collection several times; every write updates the cache and storage
 * together. Writes are awaited: callers only report success after they land.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Collection, CrmSettings } from './types';
import { defaultSettings } from './types';

type Rec = { id: string };
const COLLECTIONS: Collection[] = ['contacts', 'leads', 'deals', 'tasks', 'notes', 'activities', 'events', 'views'];
const CACHE_MS = 15_000;

export interface CrmStore {
  mode(): Promise<'firestore' | 'file'>;
  all<T extends Rec>(uid: string, col: Collection): Promise<T[]>;
  get<T extends Rec>(uid: string, col: Collection, id: string): Promise<T | null>;
  put<T extends Rec>(uid: string, col: Collection, recs: T[]): Promise<void>;
  remove(uid: string, col: Collection, ids: string[]): Promise<void>;
  settings(uid: string): Promise<CrmSettings>;
  saveSettings(uid: string, s: CrmSettings): Promise<void>;
  /** Finds the workspace that owns a public capture key (lead form). */
  findByCaptureKey(key: string): Promise<string | null>;
}

interface Backend {
  load(uid: string, col: Collection): Promise<Map<string, any>>;
  write(uid: string, col: Collection, put: any[], del: string[]): Promise<void>;
  settings(uid: string): Promise<CrmSettings | null>;
  saveSettings(uid: string, s: CrmSettings): Promise<void>;
  findByCaptureKey(key: string): Promise<string | null>;
}

const clean = (v: unknown) => JSON.parse(JSON.stringify(v));
const safeUid = (uid: string) => { if (!/^[A-Za-z0-9_.@-]{1,128}$/.test(uid)) throw new Error('invalid workspace id'); return uid; };

function fileBackend(dataDir: string): Backend {
  const dir = path.resolve(dataDir);
  const file = (uid: string) => path.join(dir, `${encodeURIComponent(safeUid(uid))}.json`);
  const chains = new Map<string, Promise<unknown>>();
  const read = async (uid: string): Promise<any> => {
    try { return JSON.parse(await fs.readFile(file(uid), 'utf8')); } catch (e: any) { if (e?.code === 'ENOENT') return {}; throw e; }
  };
  const mutate = (uid: string, fn: (doc: any) => void) => {
    const run = (chains.get(uid) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const doc = await read(uid); fn(doc);
      await fs.mkdir(dir, { recursive: true });
      const tmp = `${file(uid)}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(doc), { mode: 0o600 });
      await fs.rename(tmp, file(uid));
    });
    chains.set(uid, run);
    return run;
  };
  return {
    async load(uid, col) { const d = await read(uid); return new Map(Object.entries(d[col] ?? {})); },
    write: (uid, col, put, del) => mutate(uid, (d) => {
      d[col] ??= {};
      for (const r of put) d[col][r.id] = clean(r);
      for (const id of del) delete d[col][id];
    }),
    async settings(uid) { return (await read(uid)).settings ?? null; },
    saveSettings: (uid, s) => mutate(uid, (d) => { d.settings = clean(s); }),
    async findByCaptureKey(key) {
      let names: string[] = [];
      try { names = await fs.readdir(dir); } catch { return null; }
      for (const n of names) {
        if (!n.endsWith('.json')) continue;
        try { const d = JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')); if (d.settings?.captureKey === key) return decodeURIComponent(n.slice(0, -5)); } catch { /* skip */ }
      }
      return null;
    },
  };
}

async function firestoreBackend(): Promise<Backend | null> {
  try {
    const { adminApp, adminDb } = await import('../../../lib/firebaseAdmin');
    const c: any = (adminApp as any).options?.credential;
    if (!c?.getAccessToken) return null;
    await c.getAccessToken();
    const root = (adminDb as any).collection('crm_workspaces');
    await root.limit(1).get();
    return {
      async load(uid, col) {
        const snap = await root.doc(safeUid(uid)).collection(col).get();
        return new Map(snap.docs.map((d: any) => [d.id, d.data()]));
      },
      async write(uid, col, put, del) {
        const ref = root.doc(safeUid(uid)).collection(col);
        // Firestore batches hold at most 500 operations.
        const ops = [...put.map((r) => ({ t: 'set' as const, r })), ...del.map((id) => ({ t: 'del' as const, id }))];
        for (let i = 0; i < ops.length; i += 450) {
          const b = (adminDb as any).batch();
          for (const op of ops.slice(i, i + 450)) {
            if (op.t === 'set') b.set(ref.doc(op.r.id), clean(op.r)); else b.delete(ref.doc(op.id));
          }
          await b.commit();
        }
      },
      async settings(uid) { const s = await root.doc(safeUid(uid)).get(); return s.exists ? (s.data()?.settings ?? null) : null; },
      async saveSettings(uid, s) { await root.doc(safeUid(uid)).set({ settings: clean(s), updatedAt: new Date().toISOString() }, { merge: true }); },
      async findByCaptureKey(key) {
        const snap = await root.where('settings.captureKey', '==', key).limit(1).get();
        return snap.empty ? null : snap.docs[0].id;
      },
    };
  } catch (e: any) {
    console.warn(`[crm] Firestore unavailable (${e?.message || e}); using the local file store`);
    return null;
  }
}

export function createCrmStore(opts: { mode: 'auto' | 'firestore' | 'file'; dataDir: string }): CrmStore {
  let backend: Promise<{ b: Backend; kind: 'firestore' | 'file' }> | null = null;
  const resolve = () => (backend ??= (async () => {
    if (opts.mode !== 'file') {
      const fsb = await firestoreBackend();
      if (fsb) return { b: fsb, kind: 'firestore' as const };
      if (opts.mode === 'firestore') throw new Error('CRM store is set to Firestore but Firestore is unavailable.');
    }
    return { b: fileBackend(opts.dataDir), kind: 'file' as const };
  })());

  const cache = new Map<string, { at: number; map: Map<string, any> }>();
  const key = (uid: string, col: Collection) => `${uid}\u0000${col}`;
  const loaded = async (uid: string, col: Collection) => {
    if (!COLLECTIONS.includes(col)) throw new Error('unknown collection');
    const k = key(uid, col); const hit = cache.get(k);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.map;
    const map = await (await resolve()).b.load(uid, col);
    cache.set(k, { at: Date.now(), map });
    if (cache.size > 2000) cache.delete(cache.keys().next().value!);
    return map;
  };

  return {
    mode: async () => (await resolve()).kind,
    async all<T extends Rec>(uid: string, col: Collection) { return [...(await loaded(uid, col)).values()] as T[]; },
    async get<T extends Rec>(uid: string, col: Collection, id: string) { return ((await loaded(uid, col)).get(id) ?? null) as T | null; },
    async put(uid, col, recs) {
      if (!recs.length) return;
      await (await resolve()).b.write(uid, col, recs, []);
      const map = await loaded(uid, col);
      for (const r of recs) map.set(r.id, clean(r));
    },
    async remove(uid, col, ids) {
      if (!ids.length) return;
      await (await resolve()).b.write(uid, col, [], ids);
      const map = await loaded(uid, col);
      for (const id of ids) map.delete(id);
    },
    async settings(uid) {
      const s = await (await resolve()).b.settings(uid);
      const d = defaultSettings();
      return s ? { ...d, ...s, customFields: { ...d.customFields, ...(s.customFields ?? {}) } } : d;
    },
    async saveSettings(uid, s) { await (await resolve()).b.saveSettings(uid, s); },
    async findByCaptureKey(k) { return (await resolve()).b.findByCaptureKey(k); },
  };
}
