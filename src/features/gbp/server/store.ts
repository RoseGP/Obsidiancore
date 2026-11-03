/**
 * Per-user Local SEO data (server only): Google connection (encrypted tokens),
 * discovered + selected locations, synced reviews, drafts, settings, activity.
 * Firestore (gbp_users/{uid}) when credentials resolve, else a JSON file.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Sealed } from '../../social-accounts/server/config';
import type { GLocation, GReview } from './googleGateway';
import type { GrowthData } from './growthTypes';
import { emptyGrowth, pruneGrowth } from './growthTypes';

export interface StoredReview extends GReview { locationName: string; syncedAt: string }
export interface GbpDoc {
  userId: string;
  google?: { refreshToken: Sealed; accessToken?: Sealed; accessExpiresAt?: number; email?: string; scope: string; connectedAt: string; revokedAt?: string };
  pending?: { id: string; verifier: Sealed; expiresAt: number; used?: boolean };
  locations: GLocation[];
  selected: string[];
  reviews: Record<string, StoredReview>;
  drafts: Record<string, { text: string; tone: string; generatedAt: string; flags: string[] }>;
  settings: { brandVoice: 'friendly' | 'professional' | 'casual' | 'luxury'; signOff: string };
  activity: { at: string; type: string; message: string }[];
  lastSync?: { at: string; reviews: number; errors: string[] };
  /** Audit, change sets, content plan, competitors, automation, security (see growthTypes.ts). */
  growth: GrowthData;
}

export const emptyDoc = (userId: string): GbpDoc => ({ userId, locations: [], selected: [], reviews: {}, drafts: {}, settings: { brandVoice: 'friendly', signOff: '' }, activity: [], growth: emptyGrowth() });
const normalize = (userId: string, d: any): GbpDoc => {
  const base = { ...emptyDoc(userId), ...(d ?? {}), userId };
  base.growth = { ...emptyGrowth(), ...(d?.growth ?? {}) };
  return base;
};

function prune(d: GbpDoc) {
  d.activity = d.activity.slice(-200);
  pruneGrowth(d.growth);
  // Firestore documents are capped at 1 MiB: keep the 500 most recent reviews.
  const keys = Object.keys(d.reviews);
  if (keys.length > 500) {
    const keep = new Set(keys.sort((a, b) => d.reviews[b].updateTime.localeCompare(d.reviews[a].updateTime)).slice(0, 500));
    for (const k of keys) if (!keep.has(k)) { delete d.reviews[k]; delete d.drafts[k]; }
  }
}

export interface GbpStore { get(userId: string): Promise<GbpDoc>; update<T>(userId: string, fn: (d: GbpDoc) => T): Promise<T>; listUserIds?(): Promise<string[]> }

export function createGbpStore(mode: 'auto' | 'firestore' | 'file', dataDir: string): GbpStore & { ready(): Promise<string> } {
  let resolved: Promise<GbpStore> | null = null;
  const fileStore = (): GbpStore => {
    const file = path.resolve(dataDir, 'gbp.json');
    let chain: Promise<unknown> = Promise.resolve();
    const load = async (): Promise<Record<string, any>> => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e: any) { if (e?.code === 'ENOENT') return {}; throw e; } };
    return {
      async listUserIds() { return Object.keys(await load()); },
      async get(id) { return normalize(id, (await load())[id]); },
      update(id, fn) {
        const run = chain.catch(() => undefined).then(async () => {
          const all = await load(); const d = normalize(id, all[id]); const r = fn(d); prune(d); all[id] = d;
          await fs.mkdir(path.dirname(file), { recursive: true });
          const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
          await fs.writeFile(tmp, JSON.stringify(all), { mode: 0o600 }); await fs.rename(tmp, file);
          return r;
        });
        chain = run; return run;
      },
    };
  };
  const resolve = () => (resolved ??= (async () => {
    const fallbackFileStore = fileStore();
    if (mode === 'file') return fallbackFileStore;
    try {
      const { adminApp, adminDb } = await import('../../../lib/firebaseAdmin');
      const c: any = (adminApp as any).options?.credential;
      if (c?.getAccessToken) {
        await c.getAccessToken();
        // Verify actual Firestore read permissions with a lightweight query
        await (adminDb as any).collection('gbp_users').limit(1).get();
        const col = (adminDb as any).collection('gbp_users');
        const clean = (v: any) => JSON.parse(JSON.stringify(v));
        return {
          async listUserIds() {
            try { const snap = await col.select().limit(5000).get(); return snap.docs.map((x: any) => x.id); }
            catch { return fallbackFileStore.listUserIds!(); }
          },
          async get(id) {
            try {
              const s = await col.doc(id).get();
              return normalize(id, s.exists ? s.data() : null);
            } catch (err: any) {
              if (err?.code === 7 || err?.message?.includes('PERMISSION_DENIED')) {
                console.warn('[gbp] Firestore PERMISSION_DENIED on get; falling back to local file store');
                return fallbackFileStore.get(id);
              }
              throw err;
            }
          },
          update(id, fn) {
            try {
              return (adminDb as any).runTransaction(async (t: any) => {
                const ref = col.doc(id);
                const s = await t.get(ref);
                const d = normalize(id, s.exists ? s.data() : null);
                const r = fn(d);
                prune(d);
                t.set(ref, clean(d));
                return r;
              });
            } catch (err: any) {
              if (err?.code === 7 || err?.message?.includes('PERMISSION_DENIED')) {
                console.warn('[gbp] Firestore PERMISSION_DENIED on update; falling back to local file store');
                return fallbackFileStore.update(id, fn);
              }
              throw err;
            }
          },
        } as GbpStore;
      }
    } catch (probeErr: any) {
      if (mode === 'firestore') {
        throw new Error(`SOCIAL_ACCOUNTS_STORE=firestore but Firestore is unavailable: ${probeErr?.message || probeErr}`);
      }
      console.warn(`[gbp] Firestore unavailable or permissions denied (${probeErr?.message || probeErr}); falling back to local file store`);
      return fallbackFileStore;
    }
    if (mode === 'firestore') {
      throw new Error('SOCIAL_ACCOUNTS_STORE=firestore but Firestore credentials are unavailable.');
    }
    return fallbackFileStore;
  })());
  return {
    ready: async () => { const s = await resolve(); return (s as any).get ? (mode === 'file' ? 'file' : 'resolved') : 'unknown'; },
    get: async (id) => (await resolve()).get(id),
    listUserIds: async () => { const s = await resolve(); return s.listUserIds ? s.listUserIds() : []; },
    update: async (id, fn) => (await resolve()).update(id, fn),
  };
}
