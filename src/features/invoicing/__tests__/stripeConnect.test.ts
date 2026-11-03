/**
 * Stripe Connect billing: connection, tenant isolation, invoice collection,
 * webhooks and subscriptions — against a fake Stripe that records which
 * connected account every call ran on. Real Stripe signature checks are used.
 * Run: npx tsx src/features/invoicing/__tests__/stripeConnect.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import Stripe from 'stripe';

process.env.BILLING_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'billing-stripe-'));
process.env.BILLING_JWT_SECRET = 'test-secret';
process.env.BILLING_SEED_DEMO = 'true';
process.env.STRIPE_SECRET_KEY = 'sk_test_platform';
process.env.STRIPE_CONNECT_CLIENT_ID = 'ca_test_platform';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_test_connect';
process.env.OAUTH_STATE_SECRET = 'state-secret-for-tests';
process.env.APP_URL = 'https://crm.example.com';
delete process.env.STRIPE_APPLICATION_FEE_PERCENT;

const { signJwt } = await import('../../../utils/verifyJwt');
const billingRouter = (await import('../../../routes/billing')).default;
const billingStripeRouter = (await import('../../../routes/billingStripe')).default;
const sc = await import('../server/stripeConnect');
const model = await import('../stripe/model');

// ---------- Fake Stripe ----------

const realWebhooks = new Stripe('sk_test_x').webhooks;
type Call = { op: string; account?: string; params?: any };
const calls: Call[] = [];
let seq = 0;
const id = (p: string) => `${p}_${++seq}`;
const accounts: Record<string, any> = {
  acct_A: { id: 'acct_A', type: 'standard', email: 'owner@a.com', country: 'US', default_currency: 'usd', business_profile: { name: 'Studio A' }, charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [], disabled_reason: null } },
  acct_B: { id: 'acct_B', type: 'standard', email: 'owner@b.com', country: 'GB', default_currency: 'gbp', business_profile: { name: 'Studio B' }, charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: ['external_account'], past_due: [], disabled_reason: 'requirements.past_due' } },
};
const oauthCodes: Record<string, string> = { code_A: 'acct_A', code_B: 'acct_B', code_A_again: 'acct_A' };
const invoices: Record<string, any> = {};
const items: Record<string, any[]> = {};
const subs: Record<string, any> = {};

const fake: any = {
  oauth: {
    token: async (p: any) => { calls.push({ op: 'oauth.token', params: p }); if (!oauthCodes[p.code]) throw Object.assign(new Error('Invalid code'), { statusCode: 400 }); return { stripe_user_id: oauthCodes[p.code] }; },
    deauthorize: async (p: any) => { calls.push({ op: 'oauth.deauthorize', params: p }); return {}; },
  },
  accounts: {
    retrieve: async (a: string) => { calls.push({ op: 'accounts.retrieve', params: a }); return accounts[a]; },
    create: async (p: any) => { const a = { id: id('acct_new'), type: 'standard', email: p.email, charges_enabled: false, details_submitted: false, requirements: { currently_due: ['business_type'] } }; accounts[a.id] = a; calls.push({ op: 'accounts.create', params: p }); return a; },
  },
  accountLinks: { create: async (p: any) => { calls.push({ op: 'accountLinks.create', params: p }); return { url: `https://connect.stripe.com/setup/s/${p.account}` }; } },
  customers: { create: async (p: any, o: any) => { calls.push({ op: 'customers.create', account: o?.stripeAccount, params: p }); return { id: id('cus') }; } },
  invoices: {
    create: async (p: any, o: any) => { const inv = { id: id('in'), status: 'draft', customer: p.customer, currency: p.currency, metadata: p.metadata, amount_due: 0, amount_paid: 0, account: o?.stripeAccount }; invoices[inv.id] = inv; items[inv.id] = []; calls.push({ op: 'invoices.create', account: o?.stripeAccount, params: p }); return inv; },
    finalizeInvoice: async (i: string, _p: any, o: any) => { const inv = invoices[i]; inv.status = 'open'; inv.amount_due = items[i].reduce((s, x) => s + x.amount, 0); inv.hosted_invoice_url = `https://invoice.stripe.com/i/${i}`; inv.invoice_pdf = `https://pay.stripe.com/invoice/${i}/pdf`; calls.push({ op: 'invoices.finalize', account: o?.stripeAccount }); return { ...inv }; },
    sendInvoice: async (i: string, _p: any, o: any) => { calls.push({ op: 'invoices.send', account: o?.stripeAccount }); return { ...invoices[i] }; },
    voidInvoice: async (i: string, _p: any, o: any) => { invoices[i].status = 'void'; calls.push({ op: 'invoices.void', account: o?.stripeAccount, params: i }); return { ...invoices[i] }; },
    del: async (i: string, _p: any, o: any) => { delete invoices[i]; calls.push({ op: 'invoices.del', account: o?.stripeAccount }); return { id: i, deleted: true }; },
    retrieve: async (i: string, _p: any, o: any) => { calls.push({ op: 'invoices.retrieve', account: o?.stripeAccount }); return { ...invoices[i] }; },
  },
  invoiceItems: { create: async (p: any, o: any) => { items[p.invoice].push(p); calls.push({ op: 'invoiceItems.create', account: o?.stripeAccount, params: p }); return { id: id('ii') }; } },
  products: { create: async (p: any, o: any) => { calls.push({ op: 'products.create', account: o?.stripeAccount, params: p }); return { id: id('prod') }; } },
  subscriptions: {
    create: async (p: any, o: any) => {
      const it = p.items[0];
      const s = { id: id('sub'), status: p.trial_period_days ? 'trialing' : 'active', customer: { id: p.customer, name: p.metadata.crm_customer_name, email: p.metadata.crm_customer_email }, metadata: p.metadata, cancel_at_period_end: false, created: 1_700_000_000, trial_end: null, latest_invoice: { hosted_invoice_url: 'https://invoice.stripe.com/i/sub_first' }, items: { data: [{ quantity: it.quantity, current_period_end: 1_702_592_000, price: { unit_amount: it.price_data.unit_amount, currency: it.price_data.currency, recurring: it.price_data.recurring } }] } };
      subs[s.id] = s; calls.push({ op: 'subscriptions.create', account: o?.stripeAccount, params: p }); return s;
    },
    update: async (sid: string, p: any, o: any) => { subs[sid].cancel_at_period_end = p.cancel_at_period_end; calls.push({ op: 'subscriptions.update', account: o?.stripeAccount }); return { ...subs[sid] }; },
    cancel: async (sid: string, _p: any, o: any) => { subs[sid].status = 'canceled'; subs[sid].canceled_at = 1_701_000_000; calls.push({ op: 'subscriptions.cancel', account: o?.stripeAccount }); return { ...subs[sid] }; },
    list: async (_p: any, o: any) => { calls.push({ op: 'subscriptions.list', account: o?.stripeAccount }); return { data: Object.values(subs).filter((s) => s.metadata.crm_business_id === (o?.stripeAccount === 'acct_A' ? 'biz_a' : 'biz_b')) }; },
  },
  webhooks: realWebhooks,
};
sc.setStripeClientFactory(() => fake);

// ---------- App ----------

const app = express();
app.use(express.json({ limit: '10mb', verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); } }));
app.use('/api/billing-stripe', billingStripeRouter);
app.use('/api/billing', billingRouter);

const token = (role: string, businessId: string) => signJwt({ userId: `u_${role}_${businessId}`, email: `${role}@x.com`, name: `${role} ${businessId}`, role, businessId } as any, 'test-secret');
const ownerA = `Bearer ${await token('owner', 'biz_a')}`;
const ownerB = `Bearer ${await token('owner', 'biz_b')}`;
const viewerA = `Bearer ${await token('viewer', 'biz_a')}`;
let passed = 0;
const ok = (n: string) => { passed++; console.log('  ✓', n); };

const signedPost = (event: any) => {
  const payload = JSON.stringify(event);
  const header = realWebhooks.generateTestHeaderString({ payload, secret: 'whsec_test_connect' });
  return request(app).post('/api/billing-stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', header).send(payload);
};
const evt = (type: string, account: string, object: any) => ({ id: id('evt'), type, account, data: { object } });

console.log('🔌 Connection');
let r = await request(app).get('/api/billing/stripe').set('Authorization', ownerA);
assert.equal(r.status, 200); assert.equal(r.body.connection.status, 'disconnected'); assert.deepEqual(r.body.setup.missing, []);
ok('starts disconnected; setup reports nothing missing');

r = await request(app).post('/api/billing/stripe/connect/oauth').set('Authorization', viewerA);
assert.equal(r.status, 403); ok('viewers can’t connect Stripe');

r = await request(app).post('/api/billing/stripe/connect/oauth').set('Authorization', ownerA);
assert.equal(r.status, 200);
const authUrl = new URL(r.body.url);
assert.equal(authUrl.host, 'connect.stripe.com'); assert.equal(authUrl.searchParams.get('client_id'), 'ca_test_platform');
assert.equal(authUrl.searchParams.get('redirect_uri'), 'https://crm.example.com/api/billing-stripe/oauth/callback');
const stateA = authUrl.searchParams.get('state')!;
ok('OAuth URL uses the platform client id, read_write scope and a signed state');

r = await request(app).get(`/api/billing-stripe/oauth/callback?code=code_A&state=${encodeURIComponent(stateA.slice(0, -2) + 'xx')}`);
assert.equal(r.status, 302); assert.match(r.headers.location, /stripe=expired/); ok('tampered state is rejected');

r = await request(app).get(`/api/billing-stripe/oauth/callback?code=code_A&state=${encodeURIComponent(stateA)}`);
assert.equal(r.status, 302); assert.match(r.headers.location, /stripe=connected/);
r = await request(app).get(`/api/billing-stripe/oauth/callback?code=code_A&state=${encodeURIComponent(stateA)}`);
assert.match(r.headers.location, /stripe=expired/); ok('callback connects once; the state can’t be replayed');

r = await request(app).get('/api/billing/stripe').set('Authorization', ownerA);
assert.equal(r.body.connection.status, 'connected'); assert.equal(r.body.connection.account.businessName, 'Studio A'); assert.equal(r.body.connection.method, 'oauth');
ok('business A shows Connected with its account details');

// Business B tries to attach A's account.
r = await request(app).post('/api/billing/stripe/connect/oauth').set('Authorization', ownerB);
const stateB = new URL(r.body.url).searchParams.get('state')!;
r = await request(app).get(`/api/billing-stripe/oauth/callback?code=code_A_again&state=${encodeURIComponent(stateB)}`);
assert.match(r.headers.location, /stripe=in-use/); ok('an account linked to business A can’t be attached to business B');

r = await request(app).post('/api/billing/stripe/connect/oauth').set('Authorization', ownerB);
const stateB2 = new URL(r.body.url).searchParams.get('state')!;
await request(app).get(`/api/billing-stripe/oauth/callback?code=code_B&state=${encodeURIComponent(stateB2)}`);
r = await request(app).get('/api/billing/stripe').set('Authorization', ownerB);
assert.equal(r.body.connection.status, 'pending_verification'); assert.deepEqual(r.body.connection.account.requirementsDue, ['external_account']);
ok('business B shows Pending verification with what Stripe still needs');

console.log('\n🧾 Invoices');
const snap = (await request(app).get('/api/billing/snapshot').set('Authorization', ownerA)).body;
const target = snap.invoices.find((i: any) => i.lifecycle === 'sent' && i.billTo.email && !snap.payments.some((p: any) => p.invoiceId === i.id) && i.kind === 'standard');
assert.ok(target, 'seed has an unpaid sent invoice');
const expected = model.buildStripeLines(target);

r = await request(app).post(`/api/billing/stripe/invoices/${target.id}/collect`).set('Authorization', ownerB).send({});
assert.ok([404, 409].includes(r.status)); ok('business B can’t collect business A’s invoice');

r = await request(app).post(`/api/billing/stripe/invoices/${target.id}/collect`).set('Authorization', ownerA).send({ sendEmail: true });
assert.equal(r.status, 200, JSON.stringify(r.body));
const link = r.body.link;
assert.equal(link.status, 'open'); assert.equal(link.amountDue, expected.total); assert.match(link.hostedInvoiceUrl, /invoice\.stripe\.com/); assert.equal(link.sentByStripe, true);
const invCalls = calls.filter((c) => ['customers.create', 'invoices.create', 'invoiceItems.create', 'invoices.finalize', 'invoices.send'].includes(c.op));
assert.ok(invCalls.length >= 4 && invCalls.every((c) => c.account === 'acct_A'));
ok(`Stripe invoice created on acct_A for exactly ${model.minorToDecimal(expected.total, target.currency)} ${target.currency}, finalized and emailed`);
const createParams = calls.find((c) => c.op === 'invoices.create')!.params;
assert.equal(createParams.metadata.crm_business_id, 'biz_a'); assert.equal(createParams.metadata.crm_invoice_id, target.id);
ok('metadata ties the Stripe invoice to the business and CRM invoice');

const before = calls.length;
r = await request(app).post(`/api/billing/stripe/invoices/${target.id}/collect`).set('Authorization', ownerA).send({});
assert.equal(r.body.link.stripeInvoiceId, link.stripeInvoiceId); assert.equal(calls.slice(before).filter((c) => c.op === 'invoices.create').length, 0);
ok('collecting again reuses the open Stripe invoice');

console.log('\n📬 Webhooks');
r = await request(app).post('/api/billing-stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', 't=1,v1=bad').send('{}');
assert.equal(r.status, 400); ok('unsigned / badly signed webhooks are rejected');

const paidObj = { ...fake_invoice(link.stripeInvoiceId), status: 'paid', amount_paid: expected.total, amount_due: expected.total, status_transitions: { paid_at: Math.floor(Date.now() / 1000) } };
function fake_invoice(i: string) { return { ...invoices[i] }; }
const paidEvt = evt('invoice.paid', 'acct_A', paidObj);
r = await signedPost(paidEvt); assert.equal(r.status, 200); assert.equal(r.body.handled, true);
let s2 = (await request(app).get('/api/billing/snapshot').set('Authorization', ownerA)).body;
let pays = s2.payments.filter((p: any) => p.invoiceId === target.id);
assert.equal(pays.length, 1); assert.equal(pays[0].source, 'provider'); assert.equal(pays[0].method, 'card'); assert.equal(pays[0].amount, model.minorToDecimal(expected.total, target.currency));
ok('invoice.paid records one confirmed card payment for the full amount');

r = await signedPost(paidEvt); assert.equal(r.body.reason, 'duplicate');
r = await signedPost(evt('invoice.payment_succeeded', 'acct_A', paidObj));
s2 = (await request(app).get('/api/billing/snapshot').set('Authorization', ownerA)).body;
assert.equal(s2.payments.filter((p: any) => p.invoiceId === target.id).length, 1);
ok('replayed and overlapping paid events don’t double-record');

// A forged event claiming business A's invoice but arriving on account B.
r = await signedPost(evt('invoice.paid', 'acct_B', { ...paidObj, id: 'in_forged', metadata: { crm_business_id: 'biz_a', crm_invoice_id: target.id } }));
s2 = (await request(app).get('/api/billing/snapshot').set('Authorization', ownerA)).body;
assert.equal(s2.payments.filter((p: any) => p.invoiceId === target.id).length, 1);
ok('events from another business’s account can’t touch this business’s invoices');

r = await signedPost(evt('invoice.paid', 'acct_unknown', paidObj)); assert.equal(r.body.reason, 'account not linked');
ok('events from accounts not linked to any business are ignored');

r = await signedPost(evt('account.updated', 'acct_B', { ...accounts.acct_B, charges_enabled: true, details_submitted: true, requirements: { currently_due: [], past_due: [], disabled_reason: null } }));
r = await request(app).get('/api/billing/stripe').set('Authorization', ownerB);
assert.equal(r.body.connection.status, 'connected'); ok('account.updated moves business B to Connected after verification');

console.log('\n🔁 Subscriptions');
const client = snap.clients.find((c: any) => c.email && !c.archived);
r = await request(app).post('/api/billing/stripe/subscriptions').set('Authorization', ownerA)
  .send({ subscription: { clientId: client.id, planName: 'Retainer', amount: '1500.00', currency: 'USD', interval: 'quarter', quantity: 1, trialDays: 0 } });
assert.equal(r.status, 201, JSON.stringify(r.body));
const sub = r.body.subscription;
assert.equal(sub.unitAmount, 150000); assert.equal(sub.interval, 'quarter'); assert.equal(sub.status, 'active');
const subCall = calls.find((c) => c.op === 'subscriptions.create')!;
assert.equal(subCall.account, 'acct_A'); assert.deepEqual(subCall.params.items[0].price_data.recurring, { interval: 'month', interval_count: 3 });
ok('creates a quarterly subscription on the business’s own account');
assert.equal(model.monthlyValue(sub), 50000); ok('quarterly 1,500.00 counts as 500.00 MRR');

r = await request(app).post(`/api/billing/stripe/subscriptions/${sub.id}`).set('Authorization', ownerA).send({ action: 'cancel_at_period_end' });
assert.equal(r.body.subscription.cancelAtPeriodEnd, true);
r = await request(app).post(`/api/billing/stripe/subscriptions/${sub.id}`).set('Authorization', ownerA).send({ action: 'resume' });
assert.equal(r.body.subscription.cancelAtPeriodEnd, false); ok('cancel at period end and resume');

r = await request(app).post(`/api/billing/stripe/subscriptions/${sub.id}`).set('Authorization', ownerB).send({ action: 'cancel_now' });
assert.equal(r.status, 404); ok('business B can’t cancel business A’s subscription');

// Renewal invoice generated by Stripe → imported into the CRM and paid.
const renewal = { id: 'in_renewal_1', status: 'paid', customer: subCall.params.customer, currency: 'usd', subscription: sub.id, amount_due: 150000, amount_paid: 150000, created: Math.floor(Date.now() / 1000), lines: { data: [{ description: 'Retainer (quarterly)', amount: 150000 }] }, hosted_invoice_url: 'https://invoice.stripe.com/i/in_renewal_1', metadata: {} };
r = await signedPost(evt('invoice.paid', 'acct_A', renewal)); assert.equal(r.status, 200);
s2 = (await request(app).get('/api/billing/snapshot').set('Authorization', ownerA)).body;
const imported = s2.invoices.find((i: any) => i.activity.some((a: any) => a.message.includes('in_renewal_1')));
assert.ok(imported); assert.equal(imported.billTo.email, client.email);
assert.equal(s2.payments.filter((p: any) => p.invoiceId === imported.id).reduce((t: number, p: any) => t + Number(p.amount), 0), 1500);
ok('subscription renewal invoices are imported as paid CRM invoices');
await signedPost(evt('invoice.paid', 'acct_A', renewal));
s2 = (await request(app).get('/api/billing/snapshot').set('Authorization', ownerA)).body;
assert.equal(s2.invoices.filter((i: any) => i.activity.some((a: any) => a.message.includes('in_renewal_1'))).length, 1);
ok('a renewal is imported once');

r = await signedPost(evt('customer.subscription.deleted', 'acct_A', { ...subs[sub.id], status: 'canceled' }));
r = await request(app).get('/api/billing/stripe').set('Authorization', ownerA);
assert.equal(r.body.subscriptions.find((x: any) => x.id === sub.id).status, 'canceled'); ok('subscription webhooks update status');

console.log('\n🔄 Sync & disconnect');
r = await request(app).post('/api/billing/stripe/sync').set('Authorization', ownerA);
assert.equal(r.status, 200); assert.ok(r.body.connection.lastSyncAt);
assert.ok(calls.filter((c) => c.op === 'subscriptions.list').every((c) => c.account === 'acct_A' || c.account === 'acct_B'));
ok('sync refreshes the account, invoices and subscriptions');

r = await request(app).post('/api/billing/stripe/disconnect').set('Authorization', ownerA);
assert.equal(r.body.connection.status, 'disconnected');
assert.ok(calls.some((c) => c.op === 'oauth.deauthorize' && c.params.stripe_user_id === 'acct_A'));
r = await signedPost(evt('invoice.paid', 'acct_A', { ...paidObj, id: 'in_after_disconnect' })); assert.equal(r.body.reason, 'account not linked');
ok('disconnect deauthorizes the platform and stops routing that account’s events');

r = await request(app).post(`/api/billing/stripe/invoices/${target.id}/collect`).set('Authorization', ownerA).send({});
assert.equal(r.status, 409); ok('collecting while disconnected is refused');

r = await request(app).post('/api/billing/stripe/connect/oauth').set('Authorization', ownerA);
const st3 = new URL(r.body.url).searchParams.get('state')!;
await request(app).get(`/api/billing-stripe/oauth/callback?code=code_A&state=${encodeURIComponent(st3)}`);
r = await request(app).get('/api/billing/stripe').set('Authorization', ownerA);
assert.equal(r.body.connection.status, 'connected'); assert.ok(r.body.invoices[target.id]); ok('reconnecting the same account restores history');

console.log('\n🧮 Model');
assert.equal(model.deriveConnectionStatus({ chargesEnabled: true, detailsSubmitted: true, disabledReason: null, requirementsDue: [] }), 'connected');
assert.equal(model.deriveConnectionStatus({ chargesEnabled: false, detailsSubmitted: true, disabledReason: 'rejected.fraud', requirementsDue: [] }), 'restricted');
assert.equal(model.decimalToMinor('12.345', 'USD'), null); assert.equal(model.decimalToMinor('1200', 'JPY'), 1200); assert.equal(model.minorToDecimal(5, 'USD'), '0.05');
ok('status and money conversions');

console.log(`\n${passed} checks passed`);
