/**
 * Billing store on the CRM document store: per-organization documents, isolation, legacy file import,
 * concurrent writers (version check + retry), deletes. Run: npx tsx src/features/invoicing/__tests__/store.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.BILLING_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'billing-legacy-'));
delete process.env.BILLING_SEED_DEMO;
const { MemoryDocStore, setDocStore } = await import('../../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { loadSnapshot, withSnapshot } = await import('../server/store');

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const inv = (id: string, extra: any = {}) => ({ id, number: id.toUpperCase(), lifecycle: 'draft', items: [], ...extra });

// Empty workspace
let s = await loadSnapshot('org_a');
assert.deepEqual([s.clients.length, s.invoices.length, s.payments.length], [0, 0, 0]); ok('a new organization starts with an empty billing workspace (no demo data)');

// Writes land in per-organization documents
await withSnapshot('org_a', (snap) => ({ snapshot: { ...snap, invoices: [inv('inv_1'), inv('inv_2')], clients: [{ id: 'cl_1', name: 'Acme' } as any] }, result: null }));
assert.ok(await store.get('billing/org_a/invoices/inv_1')); assert.ok(await store.get('billing/org_a/clients/cl_1'));
assert.equal((await store.get('billing/org_a')).version, 1);
s = await loadSnapshot('org_a');
assert.equal(s.invoices.length, 2); ok('invoices and clients are stored as documents under billing/{organization}');
assert.equal((await loadSnapshot('org_b')).invoices.length, 0); ok('another organization sees none of them');

// Only changed documents are written; removed ones are deleted
await withSnapshot('org_a', (snap) => ({ snapshot: { ...snap, invoices: snap.invoices.filter((i: any) => i.id !== 'inv_2').map((i: any) => ({ ...i, lifecycle: 'sent' })) }, result: null }));
assert.equal(await store.get('billing/org_a/invoices/inv_2'), null); assert.equal((await store.get('billing/org_a/invoices/inv_1')).lifecycle, 'sent');
ok('updates rewrite changed documents and delete removed ones');

// A read-only operation doesn't bump the version
await withSnapshot('org_a', (snap) => ({ snapshot: snap, result: null }));
assert.equal((await store.get('billing/org_a')).version, 2); ok('operations that change nothing write nothing');

// Another server instance writes in between: we retry on the fresh data
let calls = 0;
const out = await withSnapshot('org_a', async (snap) => {
  calls++;
  if (calls === 1) await store.update('billing/org_a', { version: 99 }); // someone else saved meanwhile
  return { snapshot: { ...snap, invoices: [...snap.invoices, inv(`inv_new_${calls}`)] }, result: calls };
});
assert.equal(out, 2); assert.equal(calls, 2);
assert.ok(await store.get('billing/org_a/invoices/inv_new_2')); assert.equal(await store.get('billing/org_a/invoices/inv_new_1'), null);
ok('a concurrent write from another instance is detected; the operation re-runs on fresh data (no lost update)');

// Legacy file import
writeFileSync(path.join(process.env.BILLING_DATA_DIR!, 'org_legacy.json'), JSON.stringify({ clients: [], invoices: [inv('old_1')], payments: [], settings: { invoicePrefix: 'OLD-' } }));
s = await loadSnapshot('org_legacy');
assert.equal(s.invoices[0].id, 'old_1');
await withSnapshot('org_legacy', (snap) => ({ snapshot: { ...snap, invoices: [...snap.invoices, inv('new_1')] }, result: null }));
assert.ok(await store.get('billing/org_legacy/invoices/old_1')); assert.equal((await store.get('billing/org_legacy')).settings.invoicePrefix, 'OLD-');
ok('data from the old data/billing file is imported into the store on first save');

// Odd ids can't escape the workspace path
await withSnapshot('../org_a', (snap) => ({ snapshot: { ...snap, invoices: [inv('x/../y')] }, result: null }));
assert.equal((await loadSnapshot('org_a')).invoices.some((i: any) => i.id === 'x/../y'), false);
ok('unsafe ids are confined to their own workspace');

console.log(`\n${passed} passed (billing store)`);
process.exit(0);
