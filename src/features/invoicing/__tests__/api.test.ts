/**
 * Billing API integration test. Run: npx tsx src/features/invoicing/__tests__/api.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';

process.env.BILLING_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'billing-'));
process.env.BILLING_JWT_SECRET = 'test-secret';
process.env.BILLING_SEED_DEMO = 'true';
delete process.env.SMTP_HOST; delete process.env.BILLING_SMTP_HOST;

const { signJwt } = await import('../../../utils/verifyJwt');
const billingRouter = (await import('../../../routes/billing')).default;
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/api/billing', billingRouter);

const token = (role: string, businessId = 'biz_a') => signJwt({ userId: `u_${role}`, email: `${role}@x.com`, name: role, role, businessId } as any, 'test-secret');
const owner = `Bearer ${await token('owner')}`;
const viewer = `Bearer ${await token('viewer')}`;
const other = `Bearer ${await token('owner', 'biz_b')}`;
let passed = 0;
const ok = (n: string) => { passed++; console.log('  ✓', n); };

let r = await request(app).get('/api/billing/session');
assert.equal(r.status, 401); ok('rejects missing token');
r = await request(app).get('/api/billing/session').set('Authorization', 'Bearer admin-jwt-token-2026'); // lint-guards: allow (negative test)
assert.equal(r.status, 401); ok('rejects dev bypass token');

r = await request(app).get('/api/billing/session').set('Authorization', owner);
assert.equal(r.status, 200); assert.equal(r.body.emailConfigured, false); ok('session for owner');

r = await request(app).get('/api/billing/snapshot').set('Authorization', owner);
const snap = r.body; assert.ok(snap.invoices.length > 10); ok('loads tenant snapshot');

const draft = snap.invoices.find((i: any) => i.lifecycle === 'draft');
// Tamper: send an inflated "total" field and an extra lifecycle change; server must ignore both.
r = await request(app).put(`/api/billing/invoices/${draft.id}`).set('Authorization', owner).send({ invoice: { ...draft, lifecycle: 'sent', total: '1' } });
assert.equal(r.status, 200); assert.equal(r.body.invoice.lifecycle, 'draft'); assert.ok(BigInt(r.body.totals.total) > 1n);
ok('server recomputes totals and ignores client lifecycle');
const saved = r.body.invoice;

r = await request(app).put(`/api/billing/invoices/${draft.id}`).set('Authorization', owner).send({ invoice: draft });
assert.equal(r.status, 409); ok('stale version rejected (optimistic concurrency)');

r = await request(app).put(`/api/billing/invoices/${draft.id}`).set('Authorization', owner).send({ invoice: { ...saved, number: snap.invoices[0].number } });
assert.equal(r.status, 422); assert.ok(r.body.fieldErrors.number); ok('duplicate invoice number rejected');

r = await request(app).put(`/api/billing/invoices/${draft.id}`).set('Authorization', viewer).send({ invoice: saved });
assert.equal(r.status, 403); ok('viewer role cannot write');

r = await request(app).get('/api/billing/snapshot').set('Authorization', other);
assert.ok(!r.body.invoices.some((i: any) => i.id === saved.id && i.version === saved.version)); ok('tenants are isolated');

r = await request(app).post(`/api/billing/invoices/${saved.id}/send`).set('Authorization', owner).send({ to: saved.billTo.email, cc: '', subject: 'Invoice', message: 'hi' });
assert.equal(r.status, 503); assert.equal(r.body.delivery.result, 'not_configured'); assert.equal(r.body.invoice.lifecycle, 'draft');
ok('no SMTP → attempt recorded as not configured, invoice not marked sent');

r = await request(app).post(`/api/billing/invoices/${saved.id}/payments`).set('Authorization', owner).send({ payment: { invoiceId: saved.id, amount: '10', currency: 'USD', date: '2026-01-01', method: 'cash', reference: '', note: '', status: 'confirmed' } });
assert.equal(r.status, 409); ok('cannot record payment on unsent draft');

r = await request(app).post(`/api/billing/invoices/${saved.id}/mark-sent`).set('Authorization', owner);
assert.equal(r.body.invoice.lifecycle, 'sent'); ok('mark as sent');

const today = new Date().toISOString().slice(0, 10);
const pay = { invoiceId: saved.id, amount: '25.00', currency: 'USD', date: saved.issueDate > today ? today : saved.issueDate, method: 'bank_transfer', reference: 'T1', note: '', status: 'confirmed' };
const a = await request(app).post(`/api/billing/invoices/${saved.id}/payments`).set('Authorization', owner).set('Idempotency-Key', 'k1').send({ payment: pay });
const b = await request(app).post(`/api/billing/invoices/${saved.id}/payments`).set('Authorization', owner).set('Idempotency-Key', 'k1').send({ payment: pay });
assert.equal(a.status, 201); assert.equal(b.body.payment.id, a.body.payment.id);
r = await request(app).get('/api/billing/snapshot').set('Authorization', owner);
assert.equal(r.body.payments.filter((p: any) => p.invoiceId === saved.id).length, 1); ok('idempotent retry does not double-record payment');

r = await request(app).post(`/api/billing/invoices/${saved.id}/payments`).set('Authorization', owner).send({ payment: { ...pay, amount: '99999999' } });
assert.equal(r.status, 422); assert.ok(r.body.fieldErrors.amount); ok('overpayment rejected');

r = await request(app).post(`/api/billing/invoices/${saved.id}/void`).set('Authorization', owner);
assert.equal(r.status, 409); ok('cannot void invoice with confirmed payments');

console.log(`\n${passed} passed`);
