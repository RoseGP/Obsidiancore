/**
 * Prototype store used ONLY when the billing backend is unreachable or not
 * configured. Applies the same domain operations as the server, persists to
 * this browser, and never fakes email delivery or payment processing.
 */
import { generateMockSnapshot } from '../data/mockData';
import {
  DomainError, opArchiveClient, opMarkSent, opRecordPayment,
  opSaveClient, opSaveInvoice, opVoidInvoice,
} from '../domain/operations';
import type { BillingSnapshot, CurrentUser } from '../domain/types';
import { BillingError, type BillingRepository } from './repository';

const STORAGE_KEY = 'obsidian_billing_prototype_v1';
const LATENCY_MS = 220; // lets loading states be seen and tested

const delay = () => new Promise((r) => setTimeout(r, LATENCY_MS));

function read(): BillingSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BillingSnapshot) : null;
  } catch {
    return null;
  }
}

function write(s: BillingSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage full or blocked: the session still works in memory.
  }
}

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof DomainError) throw new BillingError(err.message, err.code, err.fieldErrors);
    throw err;
  }
}

export function createLocalRepository(reason: string): BillingRepository {
  let state: BillingSnapshot = read() ?? generateMockSnapshot();
  const idem = new Map<string, unknown>();
  const user: CurrentUser = { id: 'usr_proto', name: 'Kamisato Aya', email: 'aya@obsidian.studio', role: 'owner' };

  const commit = (s: BillingSnapshot) => { state = s; write(s); };
  async function once<T>(key: string, fn: () => T): Promise<T> {
    await delay();
    if (idem.has(key)) return idem.get(key) as T;
    const result = wrap(fn);
    idem.set(key, result);
    return result;
  }

  return {
    mode: 'local',
    modeReason: reason,
    user,

    async load() {
      await delay();
      return state;
    },
    saveInvoice(invoice, { idempotencyKey }) {
      return once(idempotencyKey, () => {
        const r = opSaveInvoice(state, invoice, user);
        commit(r.snapshot);
        return r.invoice;
      });
    },
    async voidInvoice(id) {
      await delay();
      return wrap(() => { const r = opVoidInvoice(state, id, user); commit(r.snapshot); return r.invoice; });
    },
    async markInvoiceSent(id) {
      await delay();
      return wrap(() => { const r = opMarkSent(state, id, user); commit(r.snapshot); return r.invoice; });
    },
    recordPayment(payment, { idempotencyKey }) {
      return once(idempotencyKey, () => {
        const r = opRecordPayment(state, payment, user);
        commit(r.snapshot);
        return { payment: r.payment, invoice: r.invoice };
      });
    },
    async saveClient(client) {
      await delay();
      return wrap(() => { const r = opSaveClient(state, client, user); commit(r.snapshot); return r.client; });
    },
    async setClientArchived(id, archived) {
      await delay();
      return wrap(() => { const r = opArchiveClient(state, id, archived, user); commit(r.snapshot); return r.client; });
    },
    async saveSettings(settings) {
      await delay();
      commit({ ...state, settings });
      return settings;
    },
    async resetPrototypeData() {
      await delay();
      const fresh = generateMockSnapshot();
      commit(fresh);
      idem.clear();
      return fresh;
    },
  };
}
