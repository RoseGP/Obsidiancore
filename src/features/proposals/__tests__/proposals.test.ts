/**
 * Proposals: organization-scoped CRUD, share links (hash stored, revocable), client choices/accept/decline,
 * server-computed totals, real SHA-256 signature record, escaped documents, no fake checkout, isolation.
 * Run: npx tsx src/features/proposals/__tests__/proposals.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', APP_URL: 'https://crm.example.com' });
delete process.env.STRIPE_SECRET_KEY;

const { MemoryDocStore, setDocStore } = await import('../../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../../server/routeGuards');
const proposals = (await import('../../../routes/proposals')).default;
const { acceptedContent } = await import('../server/proposals');
const app = express(); app.use(express.json()); app.set('trust proxy', false);
app.use('/api/proposals', guard(PUBLIC.proposals), proposals);
const as = (uid: string) => ({
  get: (p: string) => request(app).get(p).set('X-Dev-User-Id', uid),
  post: (p: string, b: any = {}) => request(app).post(p).set('X-Dev-User-Id', uid).send(b),
  put: (p: string, b: any = {}) => request(app).put(p).set('X-Dev-User-Id', uid).send(b),
  del: (p: string) => request(app).delete(p).set('X-Dev-User-Id', uid),
});
const anon = request(app);

const body = {
  title: 'Website redesign', client: { name: 'Ada Lovelace', email: 'ada@acme.test', company: 'Acme' }, currency: 'USD',
  intro: 'Thanks for the call.', terms: '50% upfront.',
  items: [
    { title: 'Design', quantity: 1, unitPrice: 300000 },
    { title: 'Build <script>alert(1)</script>', quantity: 2, unitPrice: 150000 },
    { title: 'SEO audit', quantity: 1, unitPrice: 50000, optional: true },
  ],
};

// ---- Staff ----
assert.equal((await anon.get('/api/proposals')).status, 401);
assert.equal((await anon.post('/api/proposals').send(body)).status, 401); ok('staff endpoints require sign-in');
let r = await as('olivia').post('/api/proposals', body);
assert.equal(r.status, 201); const p = r.body.proposal;
assert.equal(p.number, 'P-0001'); assert.equal(p.status, 'draft'); assert.equal(p.totals.total, 600000); assert.equal(p.totals.required, 600000);
assert.equal(p.items[2].selected, false); assert.equal('shareTokenHash' in p, false);
ok('create: numbered, draft, totals computed on the server (optional items excluded until chosen)');
assert.equal((await as('olivia').post('/api/proposals', { ...body, items: [] })).body.field ?? (await as('olivia').post('/api/proposals', { ...body, items: [] })).status, 'items');
assert.equal((await as('olivia').post('/api/proposals', { ...body, items: [{ title: 'x', unitPrice: 10.5 }] })).status, 400);
assert.equal((await as('olivia').post('/api/proposals', { ...body, client: { name: 'x', email: 'nope' } })).status, 400);
ok('invalid proposals are refused (no items, fractional cents, bad email)');

const orgA = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
await store.set(`organizations/${orgA}/members/rory`, { userId: 'rory', role: 'READ_ONLY', email: '', name: 'rory', joinedAt: new Date().toISOString() });
await store.set('crm_user_memberships/rory', { userId: 'rory', orgs: { [orgA]: 'READ_ONLY' }, defaultOrgId: orgA });
assert.equal((await as('rory').get('/api/proposals')).body.proposals.length, 1);
assert.equal((await as('rory').post('/api/proposals', body)).status, 403);
assert.equal((await as('rory').del(`/api/proposals/${p.id}`)).status, 403);
ok('read-only members can see but not create or delete');
assert.equal((await as('bea').get(`/api/proposals/${p.id}`)).status, 404);
assert.equal((await as('bea').put(`/api/proposals/${p.id}`, body)).status, 404);
assert.equal((await as('bea').get('/api/proposals')).body.proposals.length, 0);
assert.equal((await as('bea').post(`/api/proposals/${p.id}/share`)).status, 404);
ok('another organization can\'t read, edit, list or share it');

// ---- Share link ----
r = await as('olivia').post(`/api/proposals/${p.id}/share`);
assert.equal(r.status, 200); assert.match(r.body.url, /^https:\/\/crm\.example\.com\/\?proposal=[A-Za-z0-9_-]{32}$/);
const token = new URL(r.body.url).searchParams.get('proposal')!;
assert.equal(r.body.proposal.status, 'sent');
const stored = await store.get(`organizations/${orgA}/proposals/${p.id}`);
assert.equal(stored.shareTokenHash, createHash('sha256').update(token).digest('hex'));
assert.equal(JSON.stringify(await store.list('proposal_shares')).includes(token), false);
ok('sharing returns a 32-character link once; only its SHA-256 is stored');

// ---- Client ----
assert.equal((await anon.get('/api/proposals/share/notarealtokenbutlongenough12')).status, 404);
assert.equal((await anon.get(`/api/proposals/${p.id}`)).status, 401); ok('wrong links and direct ids reveal nothing to the public');
r = await anon.get(`/api/proposals/share/${token}`);
assert.equal(r.status, 200); assert.equal(r.body.proposal.from.length > 0, true);
assert.equal('id' in r.body.proposal, false); assert.equal('orgId' in r.body.proposal, false); assert.equal(r.body.proposal.status, 'viewed');
ok('the client opens it by link (marked viewed); no internal ids are exposed');
const opt = r.body.proposal.items.find((i: any) => i.optional).id;
const req1 = r.body.proposal.items.find((i: any) => !i.optional).id;
assert.equal((await anon.patch(`/api/proposals/share/${token}/items/${req1}`).send({ selected: false })).status, 400);
r = await anon.patch(`/api/proposals/share/${token}/items/${opt}`).send({ selected: true });
assert.equal(r.body.proposal.totals.total, 650000); ok('the client can add optional items (total recomputed), not remove included ones');
assert.equal((await anon.post(`/api/proposals/share/${token}/checkout`)).body.code, 'not_accepted');
assert.equal((await anon.post(`/api/proposals/share/${token}/accept`).send({ name: 'Ada', email: 'ada@acme.test' })).status, 400);
r = await anon.post(`/api/proposals/share/${token}/accept`).set('User-Agent', 'TestBrowser').send({ name: 'Ada Lovelace', title: 'CEO', email: 'ada@acme.test', agree: true });
assert.equal(r.status, 200); assert.equal(r.body.proposal.status, 'accepted');
const saved = await store.get(`organizations/${orgA}/proposals/${p.id}`);
assert.equal(saved.signature.contentHash, createHash('sha256').update(acceptedContent(saved as any)).digest('hex'));
assert.equal(saved.signature.userAgent, 'TestBrowser');
ok('accepting needs a name and explicit agreement; the record holds a real SHA-256 of what was accepted');
assert.equal((await anon.post(`/api/proposals/share/${token}/accept`).send({ name: 'Mallory X', email: 'm@x.test', agree: true })).body.code, 'proposal_closed');
assert.equal((await anon.patch(`/api/proposals/share/${token}/items/${opt}`).send({ selected: false })).body.code, 'proposal_closed');
assert.equal((await as('olivia').put(`/api/proposals/${p.id}`, body)).body.code, 'proposal_closed');
ok('an accepted proposal can\'t be changed or signed again');
r = await anon.post(`/api/proposals/share/${token}/checkout`);
assert.equal(r.status, 503); assert.equal(r.body.code, 'payments_not_configured'); assert.equal('checkoutUrl' in r.body, false);
ok('without Stripe, checkout says so (no fake payment link)');
const doc = await anon.get(`/api/proposals/share/${token}/document`);
assert.ok(doc.text.includes('&lt;script&gt;')); assert.ok(!doc.text.includes('<script>alert')); assert.match(doc.text, /SHA-256 [0-9a-f]{64}/);
ok('the printable document escapes text and shows the signature record');

// ---- Revoke / decline / expiry ----
const p2 = (await as('olivia').post('/api/proposals', { ...body, validUntil: '2020-01-01' })).body.proposal;
assert.equal(p2.number, 'P-0002');
const t2 = new URL((await as('olivia').post(`/api/proposals/${p2.id}/share`)).body.url).searchParams.get('proposal')!;
assert.equal((await anon.get(`/api/proposals/share/${t2}`)).body.proposal.expired, true);
assert.equal((await anon.post(`/api/proposals/share/${t2}/accept`).send({ name: 'Ada Lovelace', email: 'ada@acme.test', agree: true })).body.code, 'proposal_expired');
ok('expired proposals can be viewed but not accepted');
const t3 = new URL((await as('olivia').post(`/api/proposals/${p2.id}/share`)).body.url).searchParams.get('proposal')!;
assert.equal((await anon.get(`/api/proposals/share/${t2}`)).status, 404); ok('creating a new link withdraws the old one');
await as('olivia').del(`/api/proposals/${p2.id}/share`);
assert.equal((await anon.get(`/api/proposals/share/${t3}`)).status, 404); ok('links can be withdrawn');
const p3 = (await as('olivia').post('/api/proposals', body)).body.proposal;
const t4 = new URL((await as('olivia').post(`/api/proposals/${p3.id}/share`)).body.url).searchParams.get('proposal')!;
r = await anon.post(`/api/proposals/share/${t4}/decline`).send({ reason: 'Budget' });
assert.equal(r.body.proposal.status, 'declined'); assert.equal((await as('olivia').get(`/api/proposals/${p3.id}`)).body.proposal.declineReason, 'Budget');
ok('the client can decline with a reason the team sees');
await as('olivia').del(`/api/proposals/${p3.id}`);
assert.equal((await anon.get(`/api/proposals/share/${t4}`)).status, 404); ok('deleting a proposal kills its link');

console.log(`\n${passed} passed (proposals)`);
process.exit(0);
