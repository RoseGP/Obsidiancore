/**
 * Persistence for business profiles (server only): one document per profile.
 * Firestore collection `business_profiles` when credentials resolve, else a JSON file
 * (same selection rules as the Local SEO store: SOCIAL_ACCOUNTS_STORE=auto|firestore|file).
 * Writes are serialised (file) or transactional (Firestore).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BusinessProfile } from '../domain/types';

export interface ProfileStore {
  get(id: string): Promise<BusinessProfile | null>;
  listForMember(userId: string): Promise<BusinessProfile[]>;
  create(p: BusinessProfile): Promise<void>;
  /** Atomically read-modify-write. `fn` may throw to abort. Returns fn's result. */
  update<T>(id: string, fn: (p: BusinessProfile) => T): Promise<T>;
  remove(id: string): Promise<void>;
  mode(): Promise<'firestore' | 'file'>;
}

export const CAPS = { audits: 30, changes: 300, suggestions: 20, publishLog: 50 };
function prune(p: BusinessProfile) {
  p.audits = p.audits.slice(-CAPS.audits);
  p.changes = p.changes.slice(-CAPS.changes);
  p.suggestions = p.suggestions.slice(-CAPS.suggestions);
  p.publishLog = p.publishLog.slice(-CAPS.publishLog);
  p.memberIds = Object.keys(p.members);
}

export class NotFound extends Error { constructor() { super('not_found'); } }

function fileStore(dataDir: string): ProfileStore {
  const file = path.resolve(dataDir, 'business-profiles.json');
  let chain: Promise<unknown> = Promise.resolve();
  const load = async (): Promise<Record<string, BusinessProfile>> => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e: any) { if (e?.code === 'ENOENT') return {}; throw e; } };
  const save = async (all: Record<string, BusinessProfile>) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all), { mode: 0o600 });
    await fs.rename(tmp, file);
  };
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const run = chain.catch(() => undefined).then(fn); chain = run; return run; };
  return {
    async get(id) { return (await load())[id] ?? null; },
    async listForMember(uid) { return Object.values(await load()).filter((p) => p.memberIds?.includes(uid)); },
    create: (p) => serial(async () => { const all = await load(); prune(p); all[p.id] = p; await save(all); }),
    update: (id, fn) => serial(async () => {
      const all = await load(); const p = all[id]; if (!p) throw new NotFound();
      const r = fn(p); prune(p); all[id] = p; await save(all); return r;
    }),
    remove: (id) => serial(async () => { const all = await load(); delete all[id]; await save(all); }),
    mode: async () => 'file',
  };
}

export function createProfileStore(mode: 'auto' | 'firestore' | 'file', dataDir: string): ProfileStore {
  let resolved: Promise<ProfileStore> | null = null;
  const resolve = () => (resolved ??= (async () => {
    if (mode === 'file') return fileStore(dataDir);
    try {
      const { adminApp, adminDb } = await import('../../../lib/firebaseAdmin');
      const c: any = (adminApp as any).options?.credential;
      if (c?.getAccessToken) {
        await c.getAccessToken();
        const col = (adminDb as any).collection('business_profiles');
        await col.limit(1).get();
        const clean = (v: any) => JSON.parse(JSON.stringify(v));
        const fsStore: ProfileStore = {
          async get(id) { const s = await col.doc(id).get(); return s.exists ? (s.data() as BusinessProfile) : null; },
          async listForMember(uid) { const q = await col.where('memberIds', 'array-contains', uid).limit(500).get(); return q.docs.map((x: any) => x.data() as BusinessProfile); },
          async create(p) { prune(p); await col.doc(p.id).create(clean(p)); },
          update(id, fn) {
            return (adminDb as any).runTransaction(async (t: any) => {
              const ref = col.doc(id); const s = await t.get(ref);
              if (!s.exists) throw new NotFound();
              const p = s.data() as BusinessProfile; const r = fn(p); prune(p); t.set(ref, clean(p)); return r;
            });
          },
          async remove(id) { await col.doc(id).delete(); },
          mode: async () => 'firestore',
        };
        return fsStore;
      }
    } catch (err: any) {
      if (mode === 'firestore') throw new Error(`SOCIAL_ACCOUNTS_STORE=firestore but Firestore is unavailable for business_profiles: ${err?.code ?? 'error'}`);
      console.warn('[business-profiles] Firestore unavailable; using the local file store');
      return fileStore(dataDir);
    }
    if (mode === 'firestore') throw new Error('SOCIAL_ACCOUNTS_STORE=firestore but Firestore credentials are unavailable.');
    return fileStore(dataDir);
  })());
  return {
    get: async (id) => (await resolve()).get(id),
    listForMember: async (u) => (await resolve()).listForMember(u),
    create: async (p) => (await resolve()).create(p),
    update: async (id, fn) => (await resolve()).update(id, fn),
    remove: async (id) => (await resolve()).remove(id),
    mode: async () => (await resolve()).mode(),
  };
}
