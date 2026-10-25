/**
 * Billing persistence (server only). One JSON document per business, written
 * atomically, with a per-business lock so concurrent requests can't interleave.
 * Swap this module for a database adapter (Postgres/D1) without touching routes.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { generateMockSnapshot } from '../data/mockData';
import type { BillingSnapshot, BusinessSettings } from '../domain/types';

const DATA_DIR = process.env.BILLING_DATA_DIR || path.join(process.cwd(), 'data', 'billing');

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

function fileFor(businessId: string) {
  // businessId comes from a verified token, but sanitize anyway.
  const safe = businessId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(DATA_DIR, `${safe}.json`);
}

const locks = new Map<string, Promise<unknown>>();

async function read(businessId: string): Promise<BillingSnapshot> {
  try {
    return JSON.parse(await fs.readFile(fileFor(businessId), 'utf8')) as BillingSnapshot;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
    const seed = process.env.BILLING_SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production';
    return seed ? generateMockSnapshot() : { clients: [], invoices: [], payments: [], settings: emptySettings() };
  }
}

async function write(businessId: string, s: BillingSnapshot) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const target = fileFor(businessId);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(s));
  await fs.rename(tmp, target);
}

export function loadSnapshot(businessId: string) {
  return read(businessId);
}

/** Runs `fn` with exclusive access to the business's data and saves its result. */
export function withSnapshot<T>(businessId: string, fn: (s: BillingSnapshot) => Promise<{ snapshot: BillingSnapshot; result: T }> | { snapshot: BillingSnapshot; result: T }): Promise<T> {
  const prev = locks.get(businessId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    const current = await read(businessId);
    const { snapshot, result } = await fn(current);
    if (snapshot !== current) await write(businessId, snapshot);
    return result;
  });
  locks.set(businessId, run.catch(() => undefined));
  return run;
}
