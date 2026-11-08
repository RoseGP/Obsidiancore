/**
 * GET/PUT /api/meetings/plan: organization meeting plan (who can read it, who can change it, isolation).
 * Run: npx tsx src/routes/__tests__/meetingPlan.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });

const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../server/routeGuards');
const meetings = (await import('../meetings')).default;
const app = express(); app.use(express.json()); app.use('/api/meetings', guard(PUBLIC.none), meetings);
const as = (uid: string) => ({ get: () => request(app).get('/api/meetings/plan').set('X-Dev-User-Id', uid), put: (body: any) => request(app).put('/api/meetings/plan').set('X-Dev-User-Id', uid).send(body) });

assert.equal((await request(app).get('/api/meetings/plan')).status, 401);
assert.equal((await request(app).put('/api/meetings/plan').send({ plan: 'enterprise' })).status, 401);
ok('sign-in required to read or change the plan');

let r = await as('olivia').get();
assert.equal(r.status, 200); assert.equal(r.body.plan, 'standard');
assert.deepEqual([r.body.limits.maxParticipants, r.body.limits.maxDurationMinutes], [100, 60]); assert.equal(r.body.canChange, true);
ok('a new organization starts on Standard (100 people, 60 minutes); its owner can change it');

r = await as('olivia').put({ plan: 'premium' });
assert.equal(r.status, 200); assert.equal(r.body.limits.maxParticipants, 250); assert.equal(r.body.limits.maxDurationMinutes, 0);
assert.equal((await as('olivia').get()).body.plan, 'premium'); ok('owner switches to Premium: 250 people, no time limit');
r = await as('olivia').put({ plan: 'enterprise' });
assert.equal(r.body.limits.maxParticipants, 500); ok('Enterprise: 500 people');

for (const bad of [{ plan: 'gold' }, {}, { plan: 1 }]) {
  const b = await as('olivia').put(bad);
  assert.equal(b.status, 400); assert.equal(b.body.field, 'plan');
}
ok('unknown plans are rejected with the field named');

// Members of the same organization
const orgId = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
const addMember = async (uid: string, role: string) => {
  await store.set(`organizations/${orgId}/members/${uid}`, { userId: uid, role, email: '', name: uid, joinedAt: new Date().toISOString() });
  await store.set(`crm_user_memberships/${uid}`, { userId: uid, orgs: { [orgId]: role }, defaultOrgId: orgId });
};
await addMember('adam', 'ADMIN'); await addMember('sam', 'SALES_REP'); await addMember('rory', 'READ_ONLY');
r = await as('sam').get(); assert.equal(r.body.plan, 'enterprise'); assert.equal(r.body.canChange, false);
assert.equal((await as('rory').get()).status, 200); ok('every member sees the plan; non-admins are told they can\'t change it');
assert.equal((await as('sam').put({ plan: 'standard' })).status, 403);
assert.equal((await as('rory').put({ plan: 'standard' })).status, 403);
assert.equal((await as('olivia').get()).body.plan, 'enterprise'); ok('sales reps and read-only members cannot change the plan');
r = await as('adam').put({ plan: 'standard' }); assert.equal(r.status, 200);
assert.equal((await as('olivia').get()).body.plan, 'standard'); ok('admins can change the plan');

// Another organization is unaffected, and can't change this one
await as('olivia').put({ plan: 'enterprise' });
r = await as('bea').get(); assert.equal(r.body.plan, 'standard');
await as('bea').put({ plan: 'premium' });
assert.equal((await as('olivia').get()).body.plan, 'enterprise'); assert.equal((await as('bea').get()).body.plan, 'premium');
ok('plans are per organization: another org neither sees nor changes this one');

// Body can't pick the organization
await as('bea').put({ plan: 'standard', orgId });
assert.equal((await as('olivia').get()).body.plan, 'enterprise'); ok('an orgId in the request body is ignored (the caller\'s organization is used)');

const stored = await store.get(`organizations/${orgId}/settings/meetings`);
assert.equal(stored.plan, 'enterprise'); assert.equal(stored.updatedBy, 'olivia'); assert.ok(stored.updatedAt);
ok('stored on the organization with who changed it and when');

console.log(`\n${passed} passed (meeting plan api)`);
process.exit(0);
