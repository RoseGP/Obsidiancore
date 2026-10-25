/**
 * Firestore store test against a strict in-memory fake that enforces Firestore
 * transaction rules (all reads before writes; nothing applied on error).
 * Run: npx tsx src/features/social-accounts/__tests__/firestoreStore.test.ts
 */
import assert from 'node:assert/strict';
import { loadConfig, signState } from '../server/config';
import { createPostizGateway } from '../server/postiz/postizGateway';
import { createAccountsService } from '../server/service';
import { createFirestoreStore, type FirestoreLike } from '../server/store';
import { startMockPostiz } from './mockPostiz';

let passed = 0;
const ok = (n: string) => { passed++; console.log('  ✓', n); };

function fakeFirestore() {
  const data = new Map<string, any>();
  const ref = (path: string) => ({ path, get: async () => ({ exists: data.has(path), data: () => structuredClone(data.get(path)) }) });
  const db: FirestoreLike & { data: Map<string, any> } = {
    data,
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    async runTransaction(fn) {
      const writes: [string, any][] = [];
      const t = {
        async get(r: any) {
          if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
          return { exists: data.has(r.path), data: () => structuredClone(data.get(r.path)) };
        },
        set(r: any, v: any) {
          if (JSON.stringify(v).includes('undefined')) throw new Error('undefined value');
          writes.push([r.path, structuredClone(v)]);
        },
        delete(r: any) { writes.push([r.path, null]); },
      };
      const result = await fn(t);
      for (const [p, v] of writes) { if (v === null) data.delete(p); else data.set(p, v); }
      return result;
    },
  };
  return db;
}

const APP = 'https://crm.test';
const mock = await startMockPostiz({ clientId: 'pca_t', clientSecret: 'pcs_t', appRedirect: `${APP}/api/accounts/callback`, apiKey: 'key', jwtSecret: 'j' });
const cfg = loadConfig({
  NODE_ENV: 'test', POSTIZ_CLIENT_ID: 'pca_t', POSTIZ_CLIENT_SECRET: 'pcs_t', POSTIZ_API_URL: mock.base, POSTIZ_FRONTEND_URL: mock.base,
  POSTIZ_REDIRECT_URI: `${APP}/api/accounts/callback`, APP_URL: APP, SOCIAL_ACCOUNTS_ENCRYPTION_KEY: 'k'.repeat(40),
  SOCIAL_ACCOUNTS_RETURN_PATH: '/dashboard',
} as any);
const db = fakeFirestore();
const store = createFirestoreStore(db);
const svc = createAccountsService(cfg, store, createPostizGateway(cfg.postizApiUrl));

// 1. Logged-in user starts the flow
const start = await svc.startConnect('uid_alice', 'linkedin', {});
assert.equal(start.result.next, 'authorize_workspace');
const authUrl = (start.result as any).url as string;
ok('start: authorize URL created for the signed-in user');

// 2. Postiz consent → redirect with code + state
const consent = await fetch(authUrl, { redirect: 'manual' });
const cb = new URL(consent.headers.get('location')!);
const code = cb.searchParams.get('code')!; const state = cb.searchParams.get('state')!;

// 3. Callback: exchange + save + redirect
const target = await svc.workspaceCallback({ code, state }, start.cookieState);
assert.equal(new URL(target).pathname, '/dashboard');
assert.match(target, /sa=workspace_connected/); ok('callback redirects to the configured dashboard path');

const userDoc = db.data.get('social_account_users/uid_alice');
assert.ok(userDoc?.postizWorkspace?.token?.data, 'token saved in the user document');
assert.ok(!JSON.stringify(userDoc).includes('pos_'), 'token not stored in plain text');
assert.equal(userDoc.postizWorkspace.name, 'Acme Agency'); ok('pos_ token saved encrypted in Firestore under social_account_users/{uid}');

const replay = await svc.workspaceCallback({ code, state }, start.cookieState);
assert.match(replay, /sa_reason=expired/); ok('replayed callback rejected (attempt is single-use in Firestore)');

const forged = signState({ u: 'uid_mallory', a: 'att_x', k: 'workspace', exp: Date.now() + 60000 }, Buffer.alloc(32, 1));
assert.match(await svc.workspaceCallback({ code: 'c', state: forged }, forged), /invalid_state/); ok('state signed with another key rejected');

// 4. Token is usable: connect a channel and save ownership
const ch = await svc.startConnect('uid_alice', 'linkedin', {});
assert.equal(ch.result.next, 'popup');
mock.approve((ch.result as any).url, 'alice');
const done = await svc.checkAttempt('uid_alice', (ch.result as any).attemptId, false);
assert.equal(done.status, 'completed');
const intId = mock.state.integrations[0].id;
assert.equal(db.data.get(`social_account_owners/${intId}`)?.value, 'uid_alice'); ok('channel ownership saved in social_account_owners');

// 5. Atomicity: an error inside the update writes nothing
const before = JSON.stringify([...db.data.entries()]);
await assert.rejects(store.updateUser('uid_alice', [], (u) => { u.connections = []; throw new Error('boom'); }));
assert.equal(JSON.stringify([...db.data.entries()]), before); ok('failed update leaves Firestore unchanged');

// 6. Overview reads back from Firestore
const o = await svc.overview('uid_alice');
assert.equal(o.postiz.workspaceAuthorized, true);
assert.equal(o.platforms.find((p) => p.platform === 'linkedin')!.status, 'connected'); ok('overview reads the saved token and connection back');

console.log(`\n${passed} passed (firestore store)`);
mock.close();
process.exit(0);
