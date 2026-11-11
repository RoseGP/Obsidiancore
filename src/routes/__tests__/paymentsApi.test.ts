/**
 * Single payments stack: organization scoping (no business/user ids from the client), honest
 * "not configured" answers, persisted webhook idempotency, and provider payments marking the
 * Invoicing invoice paid.
 * Run: npx tsx src/routes/__tests__/paymentsApi.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', ALLOW_UNSIGNED_WEBHOOKS: 'true', JWT_SECRET: 'test-secret-for-payments-suite-0123456789' });
for (const k of ['STRIPE_SECRET_KEY', 'STRIPE_CLIENT_ID', 'STRIPE_WEBHOOK_SECRET', 'SQUARE_APPLICATION_ID', 'SQUARE_APPLICATION_SECRET', 'SQUARE_WEBHOOK_SIGNATURE_KEY']) delete process.env[k];

const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../server/routeGuards');
const paymentsMod = await import('../payments');
const integrations = (await import('../paymentIntegrations')).default;
const webhooks = (await import('../paymentWebhooks')).default;
const paymentDb = await import('../../services/payment/paymentDb');
const { generateOAuthState } = await import('../../services/payment/encryption');
const { withSnapshot, loadSnapshot } = await import('../../features/invoicing/server/store');
const { createInvoice } = await import('../../features/invoicing/domain/factories');
const { buildInvoiceView, todayISO } = await import('../../features/invoicing/domain/status');

const app = express(); app.use(express.json());
app.use('/api/payments', guard(PUBLIC.payments), paymentsMod.default);
app.use('/api/invoices', guard(PUBLIC.none), paymentsMod.invoicesRouter);
app.use('/api/integrations', guard(PUBLIC.paymentIntegrations), integrations);
app.use('/api/webhooks', webhooks);
app.use('/api', (_req, res) => res.status(404).json({ code: 'not_found' }));

const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
});
const orgOf = async (uid: string) => {
  await as(uid).get('/api/integrations/status'); // first request creates the user's organization
  return (await store.get(`crm_user_memberships/${uid}`)).defaultOrgId as string;
};

// ---- Sign-in, organization scoping ----
assert.equal((await request(app).get('/api/payments/status')).status, 401);
assert.equal((await request(app).get('/api/integrations/status')).status, 401);
assert.equal((await request(app).get('/api/invoices')).status, 401);
ok('payment routes require sign-in');

const orgA = await orgOf('alice');
const orgB = await orgOf('bob');
assert.notEqual(orgA, orgB);

const now = new Date().toISOString();
const invB = {
  id: 'inv_b_1', user_id: orgB, customer_id: 'cust_b', provider: 'stripe' as const, provider_invoice_id: 'in_test_b1', invoice_number: 'B-1',
  currency: 'USD', subtotal: 100, tax: 0, total: 100, status: 'open' as const, due_date: '2030-01-01', description: 'B', hosted_invoice_url: 'https://pay.example/b', created_at: now, updated_at: now,
};
await paymentDb.saveInvoice(invB, []);

for (const q of [`?businessId=${orgB}`, `?userId=bob`, '']) {
  const r = await as('alice').get(`/api/invoices${q}`).set('X-Business-Id', orgB).set('X-User-Id', 'bob');
  assert.equal(r.status, 200); assert.equal(r.body.invoices.length, 0);
}
assert.equal((await as('alice').get('/api/invoices/inv_b_1').set('X-Business-Id', orgB)).status, 404);
assert.equal((await as('alice').get(`/api/payments/invoices/inv_b_1?businessId=${orgB}`)).status, 404);
assert.equal((await as('alice').post('/api/invoices/inv_b_1/payment', { businessId: orgB })).status, 404);
assert.equal((await as('alice').get('/api/integrations/invoices/inv_b_1')).status, 404);
assert.equal((await as('alice').post('/api/integrations/invoices/inv_b_1/void', { userId: 'bob' })).status, 404);
const fake = Buffer.from(JSON.stringify({ businessId: orgB, userId: 'bob' })).toString('base64url');
assert.equal((await as('alice').get('/api/invoices').set('Authorization', `Bearer x.${fake}.y`)).body.invoices?.length ?? 0, 0);
assert.equal((await as('bob').get('/api/invoices')).body.invoices.length, 1);
ok('another organization’s invoices can’t be read or changed by passing businessId/userId (query, header, body, unsigned token)');

// ---- Old bare /api mount is gone ----
assert.equal((await as('alice').get('/api/inv_b_1')).status, 404);
assert.equal((await as('alice').get('/api/status')).status, 404);
ok('payments router no longer answers on the bare /api prefix');

// ---- Honest "not configured" ----
let r = await as('alice').get('/api/integrations/status');
assert.equal(r.status, 200); assert.equal(r.body.providers.stripe.configured, false); assert.equal(r.body.providers.stripe.connected, false);
r = await as('alice').get('/api/integrations/stripe/connect?format=json');
assert.equal(r.status, 503); assert.equal(r.body.code, 'stripe_not_configured');
r = await as('alice').get('/api/payments/stripe/connect?format=json');
assert.equal(r.status, 503); assert.equal(r.body.code, 'stripe_not_configured');
r = await as('alice').get('/api/integrations/square/connect?format=json');
assert.equal(r.status, 503); assert.equal(r.body.code, 'square_not_configured');
r = await as('alice').post('/api/integrations/invoices/create', { provider: 'stripe', items: [{ description: 'x', quantity: 1, unit_price: 5 }], customer: { name: 'A', email: 'a@example.com' }, invoiceNumber: 'A-1', dueDate: '2030-01-01' });
assert.equal(r.status, 503); assert.equal(r.body.code, 'stripe_not_configured');
r = await as('alice').get('/api/payments/status');
assert.equal(r.status, 200); assert.equal(r.body.configured, false); assert.equal(r.body.connected, false);
assert.ok(!JSON.stringify(r.body).includes('Ace Studio'));
ok('without provider keys: 503 <provider>_not_configured, nothing simulated');

// A forged callback can't attach an account: no valid state → nothing saved; a valid state needs real keys.
r = await request(app).get(`/api/integrations/stripe/callback?code=x&state=bogus&businessId=${orgA}`);
assert.equal(r.status, 302); assert.match(r.headers.location, /error=/);
r = await request(app).get(`/api/payments/stripe/callback?account_id=acct_evil&businessId=${orgA}`);
assert.equal(r.status, 400);
r = await request(app).get(`/api/integrations/stripe/callback?code=x&state=${encodeURIComponent(generateOAuthState(orgA, 'stripe'))}`);
assert.equal(r.status, 302); assert.match(r.headers.location, /error=/);
assert.equal(await paymentDb.getConnectedAccount(orgA, 'stripe'), null);
ok('OAuth callbacks never connect an account from query parameters or without provider keys');

// ---- Read-only members can't change payment settings ----
await store.set(`organizations/${orgA}/members/rita`, { userId: 'rita', role: 'READ_ONLY', email: '', name: 'Rita', joinedAt: now });
await store.set('crm_user_memberships/rita', { userId: 'rita', orgs: { [orgA]: 'READ_ONLY' }, defaultOrgId: orgA });
assert.equal((await as('rita').get('/api/integrations/stripe/connect?format=json')).status, 403);
assert.equal((await as('rita').post('/api/integrations/stripe/disconnect')).status, 403);
assert.equal((await as('rita').post('/api/integrations/invoices/create', { provider: 'stripe' })).status, 403);
assert.equal((await as('rita').get('/api/integrations/status')).status, 200);
ok('read-only members can view but not connect, disconnect or create');

// ---- Webhook → provider invoice paid → Invoicing invoice paid (idempotent) ----
const user = { id: 'alice', name: 'Alice', email: 'alice@example.com', role: 'owner' as const };
const billingInvoiceId = await withSnapshot(orgA, (s) => {
  const inv = createInvoice(s.settings, s.invoices.map((i) => i.number));
  inv.lifecycle = 'sent'; inv.sentAt = now; inv.currency = 'USD';
  inv.billTo = { ...inv.billTo, name: 'Cedar Law', email: 'billing@cedar.example' } as any;
  inv.items = [{ id: 'li1', name: 'Website', description: '', quantity: '1', unitPrice: '1240.00', taxRate: '0' }];
  return { snapshot: { ...s, invoices: [...s.invoices, inv] }, result: inv.id };
});
void user;
await paymentDb.saveInvoice({ ...invB, id: 'inv_a_1', user_id: orgA, provider_invoice_id: 'in_test_a1', invoice_number: 'A-1', total: 1240, subtotal: 1240, billing_invoice_id: billingInvoiceId }, []);

const event = { id: 'evt_paid_1', type: 'invoice.paid', data: { object: { id: 'in_test_a1', hosted_invoice_url: 'https://pay.example/a' } } };
r = await request(app).post('/api/webhooks/stripe').send(event);
assert.equal(r.status, 200); assert.equal(r.body.received, true);
assert.equal((await paymentDb.getInvoice(orgA, 'inv_a_1'))!.status, 'paid');
let snap = await loadSnapshot(orgA);
let inv = snap.invoices.find((i) => i.id === billingInvoiceId)!;
assert.equal(buildInvoiceView(inv, snap.payments, todayISO()).status, 'paid');
assert.equal(snap.payments.length, 1); assert.equal(snap.payments[0].source, 'provider'); assert.equal(snap.payments[0].amount, '1240.00');
ok('a confirmed Stripe payment marks the provider invoice and the linked Invoicing invoice paid');

r = await request(app).post('/api/webhooks/stripe').send(event);
assert.equal(r.body.duplicate, true);
r = await request(app).post('/api/webhooks/stripe').send({ ...event, id: 'evt_paid_2' }); // same invoice, new event id
assert.equal(r.status, 200);
snap = await loadSnapshot(orgA);
assert.equal(snap.payments.length, 1);
ok('replayed or repeated webhooks never record the payment twice');

assert.ok(await store.get(`payment_webhook_events/stripe_${(await import('node:crypto')).createHash('sha256').update('evt_paid_1').digest('hex').slice(0, 48)}`));
ok('webhook idempotency is persisted in the document store (survives a restart)');

// Org B's invoice wasn't touched by org A's events, and B has no Invoicing payments.
assert.equal((await paymentDb.getInvoice(orgB, 'inv_b_1'))!.status, 'open');
assert.equal((await loadSnapshot(orgB)).payments.length, 0);
ok('webhooks only change the organization that owns the provider invoice');

// Linking a provider invoice to an Invoicing invoice of another organization is refused (needs keys first, so check the guard order).
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'; process.env.STRIPE_CLIENT_ID = 'ca_dummy';
r = await as('bob').post('/api/integrations/invoices/create', { provider: 'stripe', items: [{ description: 'x', quantity: 1, unit_price: 5 }], customer: { name: 'B', email: 'b@example.com' }, invoiceNumber: 'B-2', dueDate: '2030-01-01', billingInvoiceId });
assert.equal(r.status, 404);
r = await as('bob').get('/api/integrations/stripe/connect?format=json');
assert.equal(r.status, 200); assert.match(r.body.authUrl, /^https:\/\/connect\.stripe\.com\/oauth\/authorize\?/);
const st = new URL(r.body.authUrl).searchParams.get('state')!;
assert.equal(JSON.parse(Buffer.from(st, 'base64url').toString()).userId, orgB);
delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_CLIENT_ID;
ok('with keys: OAuth starts at Stripe with state bound to the organization; cross-organization invoice links are refused');

console.log(`\npayments API: ${passed} checks passed`);
