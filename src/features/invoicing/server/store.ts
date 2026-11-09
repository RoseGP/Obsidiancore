/**
 * Billing persistence (server only), in the CRM document store (Firestore in production), one workspace per
 * organization:
 *
 *   billing/{businessId}                       settings + version
 *   billing/{businessId}/clients/{id}          one document per client
 *   billing/{businessId}/invoices/{id}         one document per invoice
 *   billing/{businessId}/payments/{id}         one document per payment
 *
 * `withSnapshot` gives a request exclusive, consistent access: it reads the workspace, runs the operation,
 * then writes only what changed in a transaction that checks the workspace version (another server instance
 * writing in between makes it retry). The API is unchanged for routes and pages.
 *
 * Earlier builds kept one JSON file per business under data/billing (lost on most hosts). If that file exists
 * when a workspace is first opened, it's imported once.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateMockSnapshot } from '../data/mockData';
import type { BillingSnapshot, BusinessSettings } from '../domain/types';
import { getDocStore, type DocStore } from '../../../server/data/docStore';

const LEGACY_DIR = process.env.BILLING_DATA_DIR || path.join(process.cwd(), 'data', 'billing');
const KINDS = ['clients', 'invoices', 'payments'] as const;
type Kind = typeof KINDS[number];

const emptySettings = (): BusinessSettings => ({
  issuer: {
    name: '', email: '', phone: '', website: '', taxIdLabel: '', taxId: '', logoDataUrl: '',
    address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' },
  },
  invoicePrefix: 'INV-',
  defaultCurrency: 'USD',
  defaultTermsDays: 30,
  defaultTaxRate: '0',
  paymentInstructions: '',
  defaultNotes: '',
  signature: { enabled: false, name: '', title: '', imageDataUrl: '' },
});

/** Ids come from verified tokens or the tenant; keep them to safe document ids anyway. */
const safeId = (v: string) => String(v).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || '_';
const rootPath = (businessId: string) => `billing/${safeId(businessId)}`;
const itemPath = (businessId: string, kind: Kind, id: string) => `${rootPath(businessId)}/${kind}/${safeId(id)}`;

async function readLegacyFile(businessId: string): Promise<BillingSnapshot | null> {
  try { return JSON.parse(await fs.readFile(path.join(LEGACY_DIR, `${safeId(businessId).slice(0, 80)}.json`), 'utf8')) as BillingSnapshot; }
  catch (err: any) { if (err?.code === 'ENOENT') return null; throw err; }
}

async function readAll(st: DocStore, businessId: string): Promise<{ snapshot: BillingSnapshot; version: number; exists: boolean }> {
  const root = await st.get(rootPath(businessId));
  if (!root) {
    const legacy = await readLegacyFile(businessId);
    const seed = process.env.BILLING_SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production';
    const snapshot = legacy ?? (seed ? generateMockSnapshot() : { clients: [], invoices: [], payments: [], settings: emptySettings() });
    return { snapshot, version: 0, exists: false };
  }
  const [clients, invoices, payments] = await Promise.all(KINDS.map((k) => st.list(`${rootPath(businessId)}/${k}`)));
  return {
    snapshot: { clients: clients as any, invoices: invoices as any, payments: payments as any, settings: root.settings ?? emptySettings() },
    version: root.version ?? 0,
    exists: true,
  };
}

export async function loadSnapshot(businessId: string): Promise<BillingSnapshot> {
  return (await readAll(await getDocStore(), businessId)).snapshot;
}

/** Writes only the documents that changed (and deletes removed ones), if nobody else wrote since we read. */
async function save(st: DocStore, businessId: string, before: { snapshot: BillingSnapshot; version: number; exists: boolean }, after: BillingSnapshot): Promise<boolean> {
  return st.transaction(async (tx) => {
    const root = await tx.get(rootPath(businessId));
    if ((root?.version ?? 0) !== before.version || (!!root) !== before.exists) return false;
    for (const k of KINDS) {
      const prev = new Map<string, string>((before.exists ? (before.snapshot[k] as any[]) : []).map((x: any) => [x.id, JSON.stringify(x)] as [string, string]));
      const next = new Map<string, any>((after[k] as any[]).map((x: any) => [x.id, x] as [string, any]));
      for (const [id, item] of next) if (prev.get(id) !== JSON.stringify(item)) tx.set(itemPath(businessId, k, id), item);
      for (const id of prev.keys()) if (!next.has(id)) tx.delete(itemPath(businessId, k, id));
    }
    tx.set(rootPath(businessId), { settings: after.settings, version: before.version + 1, updatedAt: new Date().toISOString() });
    return true;
  });
}

const locks = new Map<string, Promise<unknown>>();

/** Runs `fn` with exclusive access to the business's data and saves its result. */
export function withSnapshot<T>(businessId: string, fn: (s: BillingSnapshot) => Promise<{ snapshot: BillingSnapshot; result: T }> | { snapshot: BillingSnapshot; result: T }): Promise<T> {
  const prev = locks.get(businessId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const st = await getDocStore();
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await readAll(st, businessId);
      const { snapshot, result } = await fn(structuredClone(current.snapshot));
      const unchanged = current.exists && JSON.stringify(snapshot) === JSON.stringify(current.snapshot);
      if (unchanged || await save(st, businessId, current, snapshot)) return result;
    }
    throw Object.assign(new Error('Billing data changed while saving. Try again.'), { status: 409 });
  });
  locks.set(businessId, run.catch(() => undefined));
  return run;
}
