/**
 * Stripe Connect state per business (server only): connection, customer and
 * invoice links, subscriptions, processed webhook events. One JSON file per
 * business plus an account → business index used to route Connect webhooks.
 *
 * No Stripe secrets are stored: every API call runs on the platform key with the
 * `Stripe-Account` header, which Stripe only honours for accounts connected to
 * this platform.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { emptyConnection, type CrmSubscription, type StripeConnection, type StripeInvoiceLink } from '../stripe/model';

export interface StripeBusinessState {
  connection: StripeConnection;
  /** CRM client id (or "email:<address>") → Stripe customer id on the connected account. */
  customers: Record<string, string>;
  /** CRM invoice id → link. */
  invoices: Record<string, StripeInvoiceLink>;
  /** Stripe subscription id → subscription. */
  subscriptions: Record<string, CrmSubscription>;
  /** Recently processed webhook event ids (bounded). */
  processedEvents: string[];
}

const emptyState = (): StripeBusinessState => ({ connection: emptyConnection(), customers: {}, invoices: {}, subscriptions: {}, processedEvents: [] });

const dir = () => process.env.STRIPE_CONNECT_DATA_DIR || path.join(process.env.BILLING_DATA_DIR || path.join(process.cwd(), 'data', 'billing'), 'stripe');
const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
const fileFor = (businessId: string) => path.join(dir(), `${safe(businessId)}.json`);
const indexFile = () => path.join(dir(), '_accounts.json');

async function readJson<T>(file: string, fallback: () => T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
  catch (err: any) { if (err?.code !== 'ENOENT') throw err; return fallback(); }
}
async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
}

const locks = new Map<string, Promise<unknown>>();
function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks.set(key, run.catch(() => undefined));
  return run;
}

export async function loadStripeState(businessId: string): Promise<StripeBusinessState> {
  const s = await readJson(fileFor(businessId), emptyState);
  return { ...emptyState(), ...s, connection: { ...emptyConnection(), ...s.connection } };
}

/** Exclusive read-modify-write of one business's Stripe state. */
export function withStripeState<T>(businessId: string, fn: (s: StripeBusinessState) => Promise<{ state: StripeBusinessState; result: T }> | { state: StripeBusinessState; result: T }): Promise<T> {
  return locked(`biz:${businessId}`, async () => {
    const current = await loadStripeState(businessId);
    const { state, result } = await fn(current);
    if (state !== current) await writeJson(fileFor(businessId), state);
    return result;
  });
}

// ---------- Account index (connected account → business) ----------

export async function businessForAccount(accountId: string): Promise<string | null> {
  const idx = await readJson<Record<string, string>>(indexFile(), () => ({}));
  return idx[accountId] ?? null;
}

/**
 * Links an account to a business. Refuses if the account is already linked to a
 * different business, so one Stripe account can't be attached to two CRM tenants.
 */
export function linkAccount(accountId: string, businessId: string): Promise<{ ok: true } | { ok: false; ownerBusinessId: string }> {
  return locked('index', async () => {
    const idx = await readJson<Record<string, string>>(indexFile(), () => ({}));
    const owner = idx[accountId];
    if (owner && owner !== businessId) return { ok: false as const, ownerBusinessId: owner };
    if (owner !== businessId) { idx[accountId] = businessId; await writeJson(indexFile(), idx); }
    return { ok: true as const };
  });
}

export function unlinkAccount(accountId: string, businessId: string): Promise<void> {
  return locked('index', async () => {
    const idx = await readJson<Record<string, string>>(indexFile(), () => ({}));
    if (idx[accountId] === businessId) { delete idx[accountId]; await writeJson(indexFile(), idx); }
  });
}

export const MAX_PROCESSED_EVENTS = 500;
export function markProcessed(s: StripeBusinessState, eventId: string): StripeBusinessState {
  return { ...s, processedEvents: [...s.processedEvents.filter((e) => e !== eventId), eventId].slice(-MAX_PROCESSED_EVENTS) };
}
