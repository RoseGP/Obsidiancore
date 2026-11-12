/**
 * Minimal document store used by the tenant-scoped CRM data layer.
 *
 *   FirestoreDocStore  production: Firestore via firebase-admin (server-only collections).
 *   MemoryDocStore     tests and local development without Google credentials.
 *                      Enforces Firestore's transaction rule (all reads before writes) and
 *                      applies a transaction's writes all-or-nothing, so tests catch the same bugs.
 *
 * Paths are slash-separated ("organizations/org_1/leads/lead_9"). Every id segment that comes from
 * a request MUST go through assertId() first: Firestore treats "/" inside .doc() as a nested path.
 *
 * Selection (getDocStore): CRM_STORE=firestore | memory. Default: firestore when NODE_ENV=production,
 * memory otherwise. The memory store loses data on restart and is refused in production unless
 * CRM_STORE=memory is set explicitly.
 */
import crypto from 'node:crypto';

export type Where = [field: string, op: '==', value: unknown];
export interface ListOptions { where?: Where[]; orderBy?: string; direction?: 'asc' | 'desc'; limit?: number }

export interface TxContext {
  get(path: string): Promise<any | null>;
  set(path: string, data: Record<string, any>): void;
  update(path: string, patch: Record<string, any>): void;
  delete(path: string): void;
}

export interface DocStore {
  readonly kind: 'firestore' | 'memory';
  get(path: string): Promise<any | null>;
  set(path: string, data: Record<string, any>): Promise<void>;
  /** Merges fields into an existing document. Returns false if it doesn't exist. */
  update(path: string, patch: Record<string, any>): Promise<boolean>;
  /** Deletes the document and everything under it. Returns false if it didn't exist. */
  deleteRecursive(path: string): Promise<boolean>;
  list(collectionPath: string, opts?: ListOptions): Promise<any[]>;
  transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T>;
}

export class InvalidIdError extends Error {
  status = 400;
  override name = 'InvalidIdError';
  constructor() { super('Invalid id.'); }
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** Rejects anything that isn't a single safe path segment (no "/", "..", spaces, empty). */
export function assertId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new InvalidIdError();
  return id;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

/** Firestore rejects `undefined`; JSON round-trip also drops functions and class instances. */
export function clean<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function segments(path: string): string[] {
  const s = path.split('/');
  if (s.some((x) => !x)) throw new Error(`Invalid store path: ${path}`);
  return s;
}

// ---------------------------------------------------------------------------
// Memory implementation
// ---------------------------------------------------------------------------
export class MemoryDocStore implements DocStore {
  readonly kind = 'memory' as const;
  readonly data = new Map<string, Record<string, any>>();
  private lock: Promise<unknown> = Promise.resolve();

  async get(path: string) {
    if (segments(path).length % 2 !== 0) throw new Error(`Not a document path: ${path}`);
    const v = this.data.get(path);
    return v ? structuredClone(v) : null;
  }
  async set(path: string, data: Record<string, any>) {
    if (segments(path).length % 2 !== 0) throw new Error(`Not a document path: ${path}`);
    this.data.set(path, clean(data));
  }
  async update(path: string, patch: Record<string, any>) {
    const cur = this.data.get(path);
    if (!cur) return false;
    this.data.set(path, { ...cur, ...clean(patch) });
    return true;
  }
  async deleteRecursive(path: string) {
    const existed = this.data.has(path);
    for (const k of [...this.data.keys()]) if (k === path || k.startsWith(path + '/')) this.data.delete(k);
    return existed;
  }
  async list(collectionPath: string, opts: ListOptions = {}) {
    const depth = segments(collectionPath).length + 1;
    let rows = [...this.data.entries()]
      .filter(([k]) => k.startsWith(collectionPath + '/') && k.split('/').length === depth)
      .map(([, v]) => structuredClone(v));
    for (const [f, , val] of opts.where || []) rows = rows.filter((r) => r[f] === val);
    if (opts.orderBy) {
      const f = opts.orderBy, dir = opts.direction === 'desc' ? -1 : 1;
      rows.sort((a, b) => (a[f] < b[f] ? -dir : a[f] > b[f] ? dir : 0));
    }
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }
  async transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    // Serialise transactions so the read-then-write sequence is isolated, like Firestore's retries.
    const run = async () => {
      const writes: [string, Record<string, any> | null, 'set' | 'update' | 'delete'][] = [];
      const tx: TxContext = {
        get: async (p) => {
          if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return this.get(p);
        },
        set: (p, d) => { writes.push([p, clean(d), 'set']); },
        update: (p, d) => { writes.push([p, clean(d), 'update']); },
        delete: (p) => { writes.push([p, null, 'delete']); },
      };
      const result = await fn(tx);
      // Validate before applying anything (all-or-nothing).
      for (const [p, , op] of writes) if (op === 'update' && !this.data.has(p) && !writes.some(([q, , o]) => q === p && o === 'set')) throw new Error(`No document to update: ${p}`);
      for (const [p, d, op] of writes) {
        if (op === 'delete') this.data.delete(p);
        else if (op === 'set') this.data.set(p, d!);
        else this.data.set(p, { ...(this.data.get(p) || {}), ...d! });
      }
      return result;
    };
    const next = this.lock.then(run, run);
    this.lock = next.catch(() => {});
    return next;
  }
}

// ---------------------------------------------------------------------------
// Firestore implementation
// ---------------------------------------------------------------------------
export class FirestoreDocStore implements DocStore {
  readonly kind = 'firestore' as const;
  constructor(private db: FirebaseFirestore.Firestore) {}

  async get(path: string) {
    const s = await this.db.doc(path).get();
    return s.exists ? s.data()! : null;
  }
  async set(path: string, data: Record<string, any>) {
    await this.db.doc(path).set(clean(data));
  }
  async update(path: string, patch: Record<string, any>) {
    try {
      await this.db.doc(path).update(clean(patch));
      return true;
    } catch (e: any) {
      if (e?.code === 5 /* NOT_FOUND */) return false;
      throw e;
    }
  }
  async deleteRecursive(path: string) {
    const ref = this.db.doc(path);
    const existed = (await ref.get()).exists;
    await this.db.recursiveDelete(ref);
    return existed;
  }
  async list(collectionPath: string, opts: ListOptions = {}) {
    let q: FirebaseFirestore.Query = this.db.collection(collectionPath);
    for (const [f, op, v] of opts.where || []) q = q.where(f, op, v);
    if (opts.orderBy) q = q.orderBy(opts.orderBy, opts.direction || 'asc');
    if (opts.limit) q = q.limit(opts.limit);
    const snap = await q.get();
    return snap.docs.map((d) => d.data());
  }
  async transaction<T>(fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (t) => fn({
      get: async (p) => { const s = await t.get(this.db.doc(p)); return s.exists ? s.data()! : null; },
      set: (p, d) => { t.set(this.db.doc(p), clean(d)); },
      update: (p, d) => { t.update(this.db.doc(p), clean(d)); },
      delete: (p) => { t.delete(this.db.doc(p)); },
    }));
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
let current: DocStore | null = null;

export async function getDocStore(): Promise<DocStore> {
  if (current) return current;
  const mode = (process.env.CRM_STORE || '').trim().toLowerCase();
  const prod = process.env.NODE_ENV === 'production';
  if (mode === 'memory' || (!mode && !prod)) {
    if (prod) console.warn('[crm-store] CRM_STORE=memory in production: all CRM data is lost on restart.');
    else console.warn('[crm-store] Using the in-memory store (set CRM_STORE=firestore to use Firestore locally).');
    current = new MemoryDocStore();
  } else {
    const { adminDb } = await import('../../lib/firebaseAdmin');
    current = new FirestoreDocStore(adminDb);
  }
  return current;
}

/** Tests: inject a store. */
export function setDocStore(store: DocStore | null) { current = store; }
