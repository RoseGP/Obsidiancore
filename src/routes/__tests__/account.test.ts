/**
 * /api/account: signed-in only; "sign out on all devices" is refused honestly for non-Firebase sign-ins.
 * Run: npx tsx src/routes/__tests__/account.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });
const { guard, PUBLIC } = await import('../../server/routeGuards');
const account = (await import('../accountApi')).default;
const app = express(); app.use(express.json());
app.use('/api/account', guard(PUBLIC.none), account);

assert.equal((await request(app).post('/api/account/sessions/revoke-all')).status, 401);
ok('signed-out callers are refused');
const r = await request(app).post('/api/account/sessions/revoke-all').set('X-Dev-User-Id', 'olivia');
assert.equal(r.status, 501); assert.equal(r.body.code, 'not_available');
ok('a development sign-in gets "not available", not a fake success');

console.log(`\n${passed} passed (account)`);
process.exit(0);
