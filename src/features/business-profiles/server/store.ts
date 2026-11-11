/**
 * Persistence for business profiles (server only), on the CRM's shared document store
 * (src/server/data/docStore.ts): Firestore in production, the strict in-memory store in tests/dev.
 *
 * Path: organizations/{orgId}/business_profiles/{profileId}. Every id goes through assertId().
 * Updates run in a store transaction so concurrent edits can't interleave.
 */
import { assertId, clean, getDocStore, type DocStore } from '../../../server/data/docStore';
import type { BusinessProfile } from '../domain/types';

export interface ProfileStore {
  get(orgId: string, id: string): Promise<BusinessProfile | null>;
  list(orgId: string): Promise<BusinessProfile[]>;
  create(p: BusinessProfile): Promise<void>;
  /** Atomically read-modify-write. `fn` may throw to abort. Returns fn's result. */
  update<T>(orgId: string, id: string, fn: (p: BusinessProfile) => T): Promise<T>;
  remove(orgId: string, id: string): Promise<void>;
}

export const CAPS = { audits: 30, changes: 300, suggestions: 20, publishLog: 50 };
export const MAX_PROFILES_PER_ORG = 500;

function prune(p: BusinessProfile) {
  p.audits = p.audits.slice(-CAPS.audits);
  p.changes = p.changes.slice(-CAPS.changes);
  p.suggestions = p.suggestions.slice(-CAPS.suggestions);
  p.publishLog = p.publishLog.slice(-CAPS.publishLog);
}

export class NotFound extends Error { constructor() { super('not_found'); } }

const col = (orgId: string) => `organizations/${assertId(orgId)}/business_profiles`;
const doc = (orgId: string, id: string) => `${col(orgId)}/${assertId(id)}`;

export function createProfileStore(storeFor: () => Promise<DocStore> = getDocStore): ProfileStore {
  return {
    async get(orgId, id) { return (await (await storeFor()).get(doc(orgId, id))) as BusinessProfile | null; },
    async list(orgId) { return (await (await storeFor()).list(col(orgId), { limit: MAX_PROFILES_PER_ORG })) as BusinessProfile[]; },
    async create(p) { prune(p); await (await storeFor()).set(doc(p.orgId, p.id), clean(p) as any); },
    async update(orgId, id, fn) {
      const st = await storeFor();
      return st.transaction(async (tx) => {
        const path = doc(orgId, id);
        const p = (await tx.get(path)) as BusinessProfile | null;
        if (!p) throw new NotFound();
        const r = fn(p);
        prune(p);
        tx.set(path, clean(p) as any);
        return r;
      });
    },
    async remove(orgId, id) { await (await storeFor()).deleteRecursive(doc(orgId, id)); },
  };
}
