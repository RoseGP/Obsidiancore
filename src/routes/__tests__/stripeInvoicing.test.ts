/**
 * Stripe invoicing end to end, against a Stripe-shaped fake (no network, no real keys, test mode only):
 *  - Connect: OAuth state bound to the starting browser (cookie) and single use; the connection records who
 *    connected it; one Stripe account can't be connected to two organizations; disconnect deauthorizes.
 *  - Invoices from CRM invoices: amounts from the stored invoice (exact cents incl. discount, tax, fees,
 *    payments received, JPY), items attached to the invoice (no pending items), Stripe-Account header and
 *    idempotency keys on every call, one live Stripe invoice per CRM invoice, customer dedup.
 *  - Sending only on explicit request; CRM invoice marked sent; state conflicts → 409.
 *  - Webhooks: real signatures, idempotent, forward-only status, payment failure shown, account must match,
 *    paid → CRM invoice paid exactly once. Refresh re-reads Stripe.
 *  - Access: role matrix (billing), other organizations, validation errors.
 * Run: npx tsx src/routes/__tests__/stripeInvoicing.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';

Object.assign(process.env, {
  NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', LOG_LEVEL: 'error',
  JWT_SECRET: 'test-secret-for-stripe-suite-0123456789abcdef',
  STRIPE_SECRET_KEY: 'sk_test_fake_platform_key_for_tests', STRIPE_CLIENT_ID: 'ca_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_test_fake_secret',
  APP_URL: 'http://localhost:3000',
});
delete process.env.ALLOW_UNSIGNED_WEBHOOKS;

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const quiet = console.log; const quietWarn = console.warn;
console.log = (...a: any[]) => { if (/✓|passed/.test(String(a[0]))) quiet(...a); }; console.warn = () => {};

// ---------------------------------------------------------------- Stripe fake
type Opts = { stripeAccount?: string; idempotencyKey?: string } | undefined;
const err = (code: string, message: string) => Object.assign(new Error(message), { type: 'StripeInvalidRequestError', code, statusCode: 400 });
class FakeStripe {
  calls: Array<{ op: string; params: any; opts: Opts }> = [];
  customers_db: any[] = []; invoices_db = new Map<string, any>(); items_db: any[] = []; idem = new Map<string, any>(); seq = 0;
  private id(p: string) { return `${p}_${(++this.seq).toString().padStart(6, '0')}`; }
  private rec(op: string, params: any, opts: Opts) { this.calls.push({ op, params, opts }); }
  private once<T>(op: string, opts: Opts, fn: () => T): T {
    const k = opts?.idempotencyKey ? `${op}|${opts.stripeAccount}|${opts.idempotencyKey}` : '';
    if (k && this.idem.has(k)) return this.idem.get(k);
    const r = fn(); if (k) this.idem.set(k, r); return r;
  }
  private inv(id: string, acct?: string) { const i = this.invoices_db.get(id); if (!i || (acct && i.account !== acct)) throw err('resource_missing', `No such invoice: '${id}'`); return i; }
  private view(i: any) { const total = this.items_db.filter((x) => x.invoice === i.id).reduce((s, x) => s + x.amount, 0); return { ...i, total, amount_due: i.status === 'paid' ? 0 : total, amount_paid: i.status === 'paid' ? total : 0 }; }
  oauth = {
    token: async (p: any) => { this.rec('oauth.token', p, undefined); if (p.code === 'good_code') return { stripe_user_id: 'acct_A', access_token: 'acc_token_A', refresh_token: 'rt_A', livemode: false }; if (p.code === 'code_for_acct_A_again') return { stripe_user_id: 'acct_A', access_token: 'x', livemode: false }; throw err('invalid_grant', 'bad code'); },
    deauthorize: async (p: any) => { this.rec('oauth.deauthorize', p, undefined); return { stripe_user_id: p.stripe_user_id }; },
  };
  accounts = { retrieve: async (id: string) => { this.rec('accounts.retrieve', { id }, undefined); return { id, business_profile: { name: 'Harbor Pine (test)' }, email: 'ap@harborpine.test', country: 'US', default_currency: 'usd', charges_enabled: true }; } };
  customers = {
    list: async (p: any, o: Opts) => { this.rec('customers.list', p, o); return { data: this.customers_db.filter((c) => c.account === o?.stripeAccount && c.email === p.email && !c.deleted) }; },
    create: async (p: any, o: Opts) => { this.rec('customers.create', p, o); return this.once('customers.create', o, () => { const c = { id: this.id('cus'), ...p, account: o?.stripeAccount }; this.customers_db.push(c); return c; }); },
    retrieve: async (id: string, _p: any, o: Opts) => { this.rec('customers.retrieve', { id }, o); const c = this.customers_db.find((x) => x.id === id && x.account === o?.stripeAccount); if (!c) throw err('resource_missing', 'No such customer'); return c.deleted ? { id, deleted: true } : c; },
  };
  invoices = {
    create: async (p: any, o: Opts) => { this.rec('invoices.create', p, o); return this.once('invoices.create', o, () => { const i = { id: this.id('in'), object: 'invoice', status: 'draft', account: o?.stripeAccount, hosted_invoice_url: null, status_transitions: {}, ...p }; this.invoices_db.set(i.id, i); return this.view(i); }); },
    retrieve: async (id: string, _p: any, o: Opts) => { this.rec('invoices.retrieve', { id }, o); return this.view(this.inv(id, o?.stripeAccount)); },
    finalizeInvoice: async (id: string, p: any, o: Opts) => { this.rec('invoices.finalizeInvoice', { id, ...p }, o); return this.once('finalize', o, () => { const i = this.inv(id, o?.stripeAccount); if (i.status !== 'draft') throw err('invoice_not_editable', 'already finalized'); i.status = 'open'; i.hosted_invoice_url = `https://invoice.stripe.test/${id}`; i.invoice_pdf = `https://pay.stripe.test/${id}.pdf`; i.status_transitions = { finalized_at: Math.floor(Date.now() / 1000) }; return this.view(i); }); },
    sendInvoice: async (id: string, p: any, o: Opts) => { this.rec('invoices.sendInvoice', { id, ...p }, o); return this.once('send', o, () => { const i = this.inv(id, o?.stripeAccount); if (i.status !== 'open') throw err('invoice_not_open', 'not open'); return this.view(i); }); },
    voidInvoice: async (id: string, p: any, o: Opts) => { this.rec('invoices.voidInvoice', { id, ...p }, o); const i = this.inv(id, o?.stripeAccount); if (i.status !== 'open' && i.status !== 'uncollectible') throw err('invoice_not_voidable', 'cannot void'); i.status = 'void'; return this.view(i); },
    del: async (id: string, _p: any, o: Opts) => { this.rec('invoices.del', { id }, o); const i = this.inv(id, o?.stripeAccount); if (i.status !== 'draft') throw err('invoice_not_deletable', 'only drafts'); this.invoices_db.delete(id); return { id, deleted: true }; },
  };
  invoiceItems = {
    create: async (p: any, o: Opts) => { this.rec('invoiceItems.create', p, o); return this.once('ii.create', o, () => { if (!Number.isInteger(p.amount)) throw err('parameter_invalid_integer', 'amount must be an integer'); const it = { id: this.id('ii'), ...p }; this.items_db.push(it); return it; }); },
  };
}
const fake = new FakeStripe();
const { setStripeClientFactoryForTests } = await import('../../services/payment/stripeClient');
setStripeClientFactoryForTests(() => fake as unknown as Stripe);

// ---------------------------------------------------------------- app
const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../server/routeGuards');
const integrations = (await import('../paymentIntegrations')).default;
const webhooks = (await import('../paymentWebhooks')).default;
const legacyPayments = (await import('../payments')).default;
const paymentDb = await import('../../services/payment/paymentDb');
const { withSnapshot, loadSnapshot } = await import('../../features/invoicing/server/store');
const { createInvoice } = await import('../../features/invoicing/domain/factories');
const { buildInvoiceView, todayISO } = await import('../../features/invoicing/domain/status');
const { makeOrg, addMember, as } = await import('../../server/__tests__/fixtures');

const app = express();
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); } }));
app.use('/api/integrations', guard(PUBLIC.paymentIntegrations), integrations);
app.use('/api/webhooks', webhooks);
app.use('/api/payments', guard(PUBLIC.payments), legacyPayments);

const orgA = (await makeOrg('olive')).id;
const orgB = (await makeOrg('oscar')).id;
for (const [u, r] of [['sam', 'SALES_REP'], ['mark', 'MARKETER'], ['rory', 'READ_ONLY']] as const) await addMember(orgA, u, r);
const A = (u = 'olive') => as(u, orgA);
const I = '/api/integrations';

/** A CRM (Invoicing) invoice in `orgId`. */
async function crmInvoice(orgId: string, patch: (inv: any) => void) {
  return withSnapshot(orgId, (s) => {
    const inv: any = createInvoice(s.settings, s.invoices.map((i) => i.number));
    inv.currency = 'USD'; inv.clientId = 'client_harbor';
    inv.billTo = { ...inv.billTo, name: 'Ana Ruiz', company: 'Harbor Pine Outfitters', email: 'billing@harborpine.test' };
    inv.dueDate = '2030-06-30';
    patch(inv);
    return { snapshot: { ...s, invoices: [...s.invoices, inv] }, result: inv.id as string };
  });
}
const viewOf = async (orgId: string, id: string) => { const s = await loadSnapshot(orgId); return buildInvoiceView(s.invoices.find((i) => i.id === id)!, s.payments, todayISO()); };

// ================================================================ Connect
let r = await request(app).get(`${I}/stripe/connect?format=json`).set(A());
assert.equal(r.status, 200);
const cookie = String(r.headers['set-cookie']?.[0] || '').split(';')[0];
assert.match(cookie, /^obs_oauth_stripe=/); assert.match(String(r.headers['set-cookie']?.[0]), /HttpOnly/i);
const state = new URL(r.body.authUrl).searchParams.get('state')!;
const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
assert.equal(decoded.userId, orgA); assert.equal(decoded.actor, 'olive'); assert.ok(decoded.bind && !decoded.bind.includes(cookie.split('=')[1]), 'state carries a hash, not the cookie');

r = await request(app).get(`${I}/stripe/callback?code=good_code&state=${encodeURIComponent(state)}`);
assert.equal(r.status, 302); assert.match(r.headers.location, /error=/);
assert.equal(await paymentDb.getConnectedAccount(orgA, 'stripe'), null, 'no cookie (another browser) → not connected');
ok('connect: a callback opened in another browser (no binding cookie) can’t attach a Stripe account');

r = await request(app).get(`${I}/stripe/connect?format=json`).set(A());
const cookie2 = String(r.headers['set-cookie']?.[0]).split(';')[0];
const state2 = new URL(r.body.authUrl).searchParams.get('state')!;
r = await request(app).get(`${I}/stripe/callback?code=good_code&state=${encodeURIComponent(state2)}`).set('Cookie', cookie2);
assert.equal(r.status, 302); assert.match(r.headers.location, /connected=stripe/);
const conn = await paymentDb.getConnectedAccount(orgA, 'stripe');
assert.equal(conn?.provider_account_id, 'acct_A'); assert.equal(conn?.provider_metadata?.connected_by, 'olive'); assert.equal(conn?.provider_metadata?.environment, 'sandbox');
assert.ok(conn!.access_token_encrypted && !conn!.access_token_encrypted.includes('acc_token_A'), 'token encrypted at rest');
r = await request(app).get(`${I}/stripe/callback?code=good_code&state=${encodeURIComponent(state2)}`).set('Cookie', cookie2);
assert.match(r.headers.location, /error=/, 'replayed callback refused');
r = await request(app).get(`${I}/status`).set(A());
assert.equal(r.body.providers.stripe.connected, true); assert.equal(r.body.providers.stripe.mode, 'test'); assert.ok(!JSON.stringify(r.body).includes('acc_token'));
ok('connect: same browser + single use → connected for the organization, who connected recorded, token encrypted, test mode shown');

r = await request(app).get(`${I}/stripe/connect?format=json`).set(as('oscar', orgB));
const cB = String(r.headers['set-cookie']?.[0]).split(';')[0], sB = new URL(r.body.authUrl).searchParams.get('state')!;
r = await request(app).get(`${I}/stripe/callback?code=code_for_acct_A_again&state=${encodeURIComponent(sB)}`).set('Cookie', cB);
assert.match(r.headers.location, /error=/); assert.equal(await paymentDb.getConnectedAccount(orgB, 'stripe'), null);
assert.equal((await request(app).get(`${I}/stripe/connect?format=json`).set(as('sam', orgA))).status, 403, 'sales rep can’t connect');
ok('connect: one Stripe account can’t be attached to a second organization; only managers of the org connect');

// ================================================================ Draft from a CRM invoice
const invId = await crmInvoice(orgA, (inv) => {
  inv.items = [
    { id: 'l1', name: 'Store fit-out', description: 'Phase 2', quantity: '1.5', unitPrice: '1200.00', taxRate: '7.5' },
    { id: 'l2', name: 'Signage', description: '', quantity: '3', unitPrice: '199.99', taxRate: '0' },
  ];
  inv.discount = { type: 'percent', value: '10' };
  inv.fees = [{ id: 'f1', label: 'Delivery', amount: '45.00' }];
});
const expectTotal = (await viewOf(orgA, invId)).totals.total;

r = await request(app).get(`${I}/stripe/billing-invoices/${invId}`).set(A());
assert.equal(r.status, 200); assert.equal(r.body.blocker, null); assert.equal(r.body.account.connected, true); assert.deepEqual(r.body.invoices, []);
fake.calls = [];
r = await request(app).post(`${I}/stripe/billing-invoices/${invId}`).set(A()).send({ total: 1, items: [{ unit_price: 0.01 }] });
assert.equal(r.status, 201, JSON.stringify(r.body)); const draft = r.body.invoice;
assert.equal(draft.status, 'draft'); assert.match(draft.provider_invoice_id, /^in_/); assert.match(draft.provider_customer_id, /^cus_/);
const si = fake.invoices_db.get(draft.provider_invoice_id);
const items = fake.items_db.filter((x) => x.invoice === si.id);
assert.equal(items.reduce((s, x) => s + x.amount, 0), Number(expectTotal), 'Stripe total = CRM total to the cent (request body ignored)');
assert.ok(items.some((x) => x.amount < 0 && /^Discount \(10%\)$/.test(x.description)) && items.some((x) => /^Tax 7\.5% on 1620\.00 USD$/.test(x.description)) && items.some((x) => x.description === 'Delivery'));
assert.ok(fake.items_db.every((x) => x.invoice), 'no pending (unattached) invoice items');
assert.equal(si.pending_invoice_items_behavior, 'exclude'); assert.equal(si.collection_method, 'send_invoice'); assert.equal(si.auto_advance, false); assert.equal(si.metadata.billing_invoice_id, invId);
const acctCalls = fake.calls.filter((c) => !c.op.startsWith('oauth') && c.op !== 'accounts.retrieve');
assert.ok(acctCalls.every((c) => c.opts?.stripeAccount === 'acct_A'), 'every call on the connected account');
assert.ok(acctCalls.filter((c) => /create/.test(c.op)).every((c) => c.opts?.idempotencyKey), 'every write has an idempotency key');
assert.ok(!fake.calls.some((c) => /finalize|send/i.test(c.op)), 'creating never finalizes or sends');
ok('draft from a CRM invoice: exact total incl. discount, tax and fees; items attached; connected account + idempotency keys; nothing sent');

r = await request(app).post(`${I}/stripe/billing-invoices/${invId}`).set(A());
assert.equal(r.status, 200); assert.equal(r.body.existing, true); assert.equal(r.body.invoice.id, draft.id);
assert.equal(fake.calls.filter((c) => c.op === 'invoices.create').length, 1);
ok('one live Stripe invoice per CRM invoice (a second click returns the existing draft)');

// Customer dedup: same client → same Stripe customer; another client with an email that already exists in Stripe → reused.
const inv2 = await crmInvoice(orgA, (inv) => { inv.items = [{ id: 'l1', name: 'Repairs', description: '', quantity: '1', unitPrice: '80', taxRate: '0' }]; });
fake.customers_db.push({ id: 'cus_existing_lee', email: 'lee@park.test', name: 'Lee Park', account: 'acct_A', metadata: {} });
const inv3 = await crmInvoice(orgA, (inv) => { inv.clientId = 'client_park'; inv.billTo = { ...inv.billTo, name: 'Lee Park', company: '', email: 'Lee@Park.test' }; inv.items = [{ id: 'l1', name: 'Consulting', description: '', quantity: '2', unitPrice: '150', taxRate: '0' }]; });
fake.calls = [];
assert.equal((await request(app).post(`${I}/stripe/billing-invoices/${inv2}`).set(A())).body.invoice.provider_customer_id, draft.provider_customer_id);
assert.equal((await request(app).post(`${I}/stripe/billing-invoices/${inv3}`).set(A())).body.invoice.provider_customer_id, 'cus_existing_lee');
assert.equal(fake.calls.filter((c) => c.op === 'customers.create').length, 0);
ok('customers: the same CRM client reuses its Stripe customer; an existing Stripe customer with that email is reused, not duplicated');

// Blockers and validation.
const noEmail = await crmInvoice(orgA, (inv) => { inv.billTo = { ...inv.billTo, email: '' }; inv.items = [{ id: 'l1', name: 'X', description: '', quantity: '1', unitPrice: '10', taxRate: '0' }]; });
r = await request(app).post(`${I}/stripe/billing-invoices/${noEmail}`).set(A());
assert.equal(r.status, 400); assert.match(r.body.error, /email/);
assert.match((await request(app).get(`${I}/stripe/billing-invoices/${noEmail}`).set(A())).body.blocker, /email/);
const tiny = await crmInvoice(orgA, (inv) => { inv.items = [{ id: 'l1', name: 'X', description: '', quantity: '1', unitPrice: '0.20', taxRate: '0' }]; });
r = await request(app).post(`${I}/stripe/billing-invoices/${tiny}`).set(A());
assert.equal(r.status, 400); assert.match(r.body.error, /less than 0\.50 USD/);
assert.equal((await request(app).post(`${I}/stripe/billing-invoices/nope..x`).set(A())).status, 400);
assert.equal((await request(app).post(`${I}/stripe/billing-invoices/inv_missing`).set(A())).status, 404);
for (const [body, re] of [
  [{ provider: 'stripe', items: [{ description: 'x', quantity: 0, unit_price: 5 }], customer: { name: 'A', email: 'a@x.test' }, invoiceNumber: 'N1', dueDate: '2030-01-01' }, /quantity/],
  [{ provider: 'stripe', items: [{ description: 'x', quantity: 1, unit_price: -5 }], customer: { name: 'A', email: 'a@x.test' }, invoiceNumber: 'N1', dueDate: '2030-01-01' }, /unit_price|price/],
  [{ provider: 'stripe', items: [{ description: 'x', quantity: 1, unit_price: 5 }], customer: { name: 'A', email: 'a@x.test' }, invoiceNumber: 'N1', dueDate: '2030-01-01', currency: 'SEK' }, /USD/],
  [{ provider: 'stripe', items: [], customer: { name: 'A', email: 'a@x.test' }, invoiceNumber: 'N1', dueDate: '2030-01-01' }, /line item/],
  [{ provider: 'stripe', items: [{ description: 'x', quantity: 1, unit_price: 5 }], customer: { name: 'A', email: 'a@x.test' }, invoiceNumber: 'N1', dueDate: '01/02/2030' }, /YYYY-MM-DD/],
  [{ provider: 'stripe', items: [{ description: 'x', quantity: 1, unit_price: '1.234' }], customer: { name: 'A', email: 'a@x.test' }, invoiceNumber: 'N1', dueDate: '2030-01-01' }, /decimals/],
] as Array<[any, RegExp]>) {
  r = await request(app).post(`${I}/invoices/create`).set(A()).send(body);
  assert.equal(r.status, 400, JSON.stringify(body)); assert.match(r.body.error, re, r.body.error);
}
ok('validation: missing email, below Stripe’s minimum, bad ids, zero quantity, negative price, unsupported currency, no items, bad date, too many decimals → 400 with a clear message');

// JPY: zero-decimal amounts.
const yen = await crmInvoice(orgA, (inv) => { inv.currency = 'JPY'; inv.clientId = 'client_tokyo'; inv.billTo = { ...inv.billTo, email: 'kaikei@tokyo.test' }; inv.items = [{ id: 'l1', name: 'Design', description: '', quantity: '2', unitPrice: '12500', taxRate: '10' }]; });
r = await request(app).post(`${I}/stripe/billing-invoices/${yen}`).set(A());
assert.equal(r.status, 201);
const yItems = fake.items_db.filter((x) => x.invoice === r.body.invoice.provider_invoice_id);
assert.deepEqual(yItems.map((x) => x.amount).sort((a, b) => a - b), [2500, 25000]); assert.equal(fake.invoices_db.get(r.body.invoice.provider_invoice_id).currency, 'jpy');
ok('JPY (zero-decimal): ¥27,500 is sent as 25000 + 2500, not ×100');

// ================================================================ Sending (explicit) and state rules
fake.calls = [];
r = await request(app).post(`${I}/invoices/${draft.id}/send`).set(A());
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.invoice.status, 'open'); assert.match(r.body.invoice.hosted_invoice_url, /invoice\.stripe\.test/);
assert.equal(fake.calls.filter((c) => c.op === 'invoices.finalizeInvoice').length, 1); assert.equal(fake.calls.filter((c) => c.op === 'invoices.sendInvoice').length, 1);
assert.ok(r.body.invoice.sent_at && r.body.invoice.finalized_at);
assert.equal((await viewOf(orgA, invId)).invoice.lifecycle, 'sent', 'CRM invoice marked sent');
ok('send: finalize + email only on the explicit request; Stripe link and dates stored; CRM invoice marked sent');

r = await request(app).post(`${I}/invoices/${draft.id}/send`).set(as('mark', orgA));
assert.equal(r.status, 403, 'marketer has no billing access');
r = await request(app).get(`${I}/stripe/billing-invoices/${invId}`).set(as('rory', orgA));
assert.equal(r.status, 403, 'read-only has no billing access');
r = await request(app).post(`${I}/invoices/${draft.id}/send`).set(as('oscar', orgB));
assert.equal(r.status, 404, 'another organization');
r = await request(app).post(`${I}/stripe/billing-invoices/${inv2}`).set(as('sam', orgA));
assert.equal(r.status, 200, 'sales rep (billing create/edit) can work invoices');
ok('access: role matrix (billing) and organization scoping on every Stripe invoice route');

// ================================================================ Webhooks
const signer = new Stripe('sk_test_signing_only', { apiVersion: '2023-10-16' as any });
const post = (event: any, opts: { secret?: string; sig?: string } = {}) => {
  const payload = JSON.stringify(event);
  const sig = opts.sig ?? signer.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? process.env.STRIPE_WEBHOOK_SECRET! });
  return request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', sig).send(payload);
};
const evt = (id: string, type: string, obj: any, extra: any = {}) => ({ id, type, account: 'acct_A', created: Math.floor(Date.now() / 1000), data: { object: { id: draft.provider_invoice_id, ...obj } }, ...extra });

assert.equal((await post(evt('evt_bad', 'invoice.paid', { status: 'paid' }), { secret: 'whsec_wrong' })).status, 400);
assert.equal((await request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').send(JSON.stringify(evt('evt_nosig', 'invoice.paid', { status: 'paid' })))).status, 400);
assert.equal((await paymentDb.getInvoice(orgA, draft.id))!.status, 'open');
ok('webhooks: wrong or missing signatures are rejected');

r = await post(evt('evt_fail_1', 'invoice.payment_failed', { status: 'open', amount_due: Number(expectTotal) }));
assert.equal(r.status, 200);
let local = (await paymentDb.getInvoice(orgA, draft.id))!;
assert.equal(local.status, 'open'); assert.match(local.payment_failure!.message, /payment attempt failed/);
ok('webhooks: a failed payment is shown on the invoice (status stays open)');

r = await post(evt('evt_evil_1', 'invoice.paid', { status: 'paid' }, { account: 'acct_EVIL' }));
assert.equal(r.status, 200); assert.equal(r.body.result, 'account_mismatch');
assert.equal((await paymentDb.getInvoice(orgA, draft.id))!.status, 'open');
ok('webhooks: an event from another connected account can’t change this organization’s invoice');

r = await post(evt('evt_paid_1', 'invoice.paid', { status: 'paid', amount_paid: Number(expectTotal), status_transitions: { paid_at: Math.floor(Date.now() / 1000) } }));
assert.equal(r.status, 200);
local = (await paymentDb.getInvoice(orgA, draft.id))!;
assert.equal(local.status, 'paid'); assert.equal(local.payment_failure, null); assert.ok(local.paid_at);
let v = await viewOf(orgA, invId);
assert.equal(v.status, 'paid'); assert.equal(v.totals.amountPaid, expectTotal);
assert.equal((await post(evt('evt_paid_1', 'invoice.paid', { status: 'paid' }))).body.duplicate, true);
await post(evt('evt_paid_2', 'invoice.paid', { status: 'paid', amount_paid: Number(expectTotal) }));
const s2 = await loadSnapshot(orgA);
assert.equal(s2.payments.filter((p) => p.invoiceId === invId).length, 1, 'paid once');
ok('webhooks: paid → CRM invoice paid with Stripe’s amount; replays and repeated events never pay twice');

r = await post(evt('evt_old_final', 'invoice.finalized', { status: 'open' }, { created: Math.floor(Date.now() / 1000) - 3600 }));
assert.equal((await paymentDb.getInvoice(orgA, draft.id))!.status, 'paid');
await post(evt('evt_late_fail', 'invoice.payment_failed', { status: 'open' }));
assert.equal((await paymentDb.getInvoice(orgA, draft.id))!.status, 'paid');
r = await request(app).post(`${I}/invoices/${draft.id}/send`).set(A());
assert.equal(r.status, 409);
r = await request(app).post(`${I}/invoices/${draft.id}/void`).set(A());
assert.equal(r.status, 409); assert.match(r.body.error, /Refund/);
ok('status only moves forward: late or older events can’t reopen a paid invoice; paid invoices can’t be sent or voided (409)');

// ================================================================ Refresh, discard, disconnect
const d2 = (await paymentDb.listInvoicesForBillingInvoice(orgA, inv2))[0];
await request(app).post(`${I}/invoices/${d2.id}/send`).set(A());
fake.invoices_db.get(d2.provider_invoice_id).status = 'paid'; // paid at Stripe, webhook missed
r = await request(app).post(`${I}/invoices/${d2.id}/refresh`).set(A());
assert.equal(r.status, 200); assert.equal(r.body.invoice.status, 'paid'); assert.equal((await viewOf(orgA, inv2)).status, 'paid');
ok('refresh re-reads Stripe (a missed webhook still ends up paid in the CRM)');

const d3 = (await paymentDb.listInvoicesForBillingInvoice(orgA, inv3))[0];
r = await request(app).post(`${I}/invoices/${d3.id}/void`).set(A());
assert.equal(r.status, 200); assert.equal(r.body.invoice.status, 'void'); assert.ok(!fake.invoices_db.has(d3.provider_invoice_id), 'draft deleted at Stripe');
r = await request(app).post(`${I}/stripe/billing-invoices/${inv3}`).set(A());
assert.equal(r.status, 201, 'a new draft can be created after discarding');
ok('discarding a draft deletes it in Stripe; a new one can be created');

// Payment link (legacy route): finalizes a draft but never emails; paying through the link still settles the CRM invoice.
const inv5 = await crmInvoice(orgA, (inv) => { inv.clientId = 'client_link'; inv.billTo = { ...inv.billTo, email: 'link@client.test' }; inv.items = [{ id: 'l1', name: 'Audit', description: '', quantity: '1', unitPrice: '300', taxRate: '0' }]; });
const d5 = (await request(app).post(`${I}/stripe/billing-invoices/${inv5}`).set(A())).body.invoice;
fake.calls = [];
r = await request(app).post(`/api/payments/invoices/${d5.id}/payment`).set(A());
assert.equal(r.status, 200); assert.match(r.body.payment_url, /invoice\.stripe\.test/);
assert.equal(fake.calls.filter((c) => c.op === 'invoices.finalizeInvoice').length, 1); assert.equal(fake.calls.filter((c) => c.op === 'invoices.sendInvoice').length, 0, 'no email');
assert.equal((await viewOf(orgA, inv5)).invoice.lifecycle, 'draft');
assert.equal((await request(app).post(`/api/payments/invoices/${d5.id}/payment`).set(as('mark', orgA))).status, 403, 'legacy alias follows the billing matrix');
await post({ id: 'evt_link_paid', type: 'invoice.paid', account: 'acct_A', created: Math.floor(Date.now() / 1000), data: { object: { id: d5.provider_invoice_id, status: 'paid', amount_paid: 30000 } } });
const v5 = await viewOf(orgA, inv5);
assert.equal(v5.invoice.lifecycle, 'sent'); assert.equal(v5.status, 'paid');
ok('payment link: finalizes without emailing; paid through the link → CRM invoice marked sent and paid');

fake.calls = [];
r = await request(app).post(`${I}/stripe/disconnect`).set(A());
assert.equal(r.status, 200);
assert.deepEqual(fake.calls.find((c) => c.op === 'oauth.deauthorize')?.params, { client_id: 'ca_test_fake', stripe_user_id: 'acct_A' });
assert.equal((await request(app).get(`${I}/stripe/billing-invoices/${inv3}`).set(A())).body.account.connected, false);
const live3 = (await paymentDb.listInvoicesForBillingInvoice(orgA, inv3)).find((i) => i.status === 'draft')!;
r = await request(app).post(`${I}/invoices/${live3.id}/send`).set(A());
assert.equal(r.status, 409); assert.equal(r.body.code, 'PROVIDER_NOT_CONNECTED');
assert.equal((await paymentDb.listInvoices(orgA)).length >= 4, true, 'history kept after disconnecting');
ok('disconnect: deauthorized at Stripe, state shows disconnected, sending refused, invoice history kept');

setStripeClientFactoryForTests(null);
console.log = quiet; console.warn = quietWarn;
console.log(`\n${passed} passed (Stripe invoicing)`);
process.exit(0);
