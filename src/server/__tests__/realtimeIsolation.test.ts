/**
 * Real-time server (src/utils/signalingServer.ts) with real Socket.IO clients in two organizations:
 *  - unauthenticated and non-member handshakes are refused; guests can't connect;
 *  - presence, schedule, slot and CRM-sync events reach only the sender's organization;
 *  - identity fields in payloads (userId, name, author, updatedBy, bookedBy, sender) are ignored;
 *  - meeting rooms with the same id in two organizations are separate; a socket id from another
 *    organization can't be targeted; untargeted signaling is no longer broadcast to everyone;
 *  - CRM sync writes follow the role matrix (READ_ONLY can't edit, SUPPORT_AGENT can't edit deals)
 *    and malformed patches (prototype keys, non-objects, oversize) are refused.
 * Run: npx tsx src/server/__tests__/realtimeIsolation.test.ts
 */
import assert from 'node:assert/strict';
import http from 'node:http';

Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', LOG_LEVEL: 'error' });
const { io: connect } = await import('socket.io-client');
const { initializeSignalingServer } = await import('../../utils/signalingServer');
const { makeOrg, addMember } = await import('./fixtures');

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const quiet = console.log; console.log = (...a: any[]) => { if (String(a[0]).includes('✓') || String(a[0]).includes('passed')) quiet(...a); };

const orgA = (await makeOrg('alice')).id;
const orgB = (await makeOrg('bob')).id;
await addMember(orgA, 'rita', 'READ_ONLY');
await addMember(orgA, 'sam', 'SUPPORT_AGENT');
await addMember(orgA, 'gus', 'GUEST');

const server = http.createServer();
initializeSignalingServer(server);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const url = `http://127.0.0.1:${(server.address() as any).port}`;

type Client = ReturnType<typeof connect> & { got: Array<[string, any]> };
const sockets: Client[] = [];
function open(auth: Record<string, unknown>): Promise<Client> {
  return new Promise((resolve, reject) => {
    const s = connect(url, { transports: ['websocket'], auth, reconnection: false, forceNew: true }) as Client;
    s.got = [];
    s.onAny((e: string, d: any) => s.got.push([e, d]));
    s.on('connect', () => { sockets.push(s); resolve(s); });
    s.on('connect_error', (e) => { s.close(); reject(e); });
  });
}
const settle = () => new Promise((r) => setTimeout(r, 120));
const events = (s: Client, name: string) => s.got.filter(([e]) => e === name).map(([, d]) => d);
const clear = (...ss: Client[]) => ss.forEach((s) => (s.got = []));

// ---- Handshake ----
await assert.rejects(open({}), /unauthorized/);
await assert.rejects(open({ devUserId: 'alice', orgId: orgB }), /unauthorized/, 'member of A asking for org B');
await assert.rejects(open({ devUserId: 'gus', orgId: orgA }), /unauthorized/, 'guest');
await assert.rejects(open({ token: 'not-a-token' }), /unauthorized/);
ok('handshake: no credentials, invalid token, another organization, or a guest → refused');

const alice = await open({ devUserId: 'alice' });
const alice2 = await open({ devUserId: 'alice' });
const rita = await open({ devUserId: 'rita', orgId: orgA });
const sam = await open({ devUserId: 'sam', orgId: orgA });
const bob = await open({ devUserId: 'bob' });
await settle();

// ---- Presence ----
clear(alice, alice2, rita, sam, bob);
alice.emit('user:online', { userId: 'bob', name: 'Spoofed Bob' });
alice.emit('user:busy', { userId: 'rita', name: 'x', currentMeetingId: 'm_1' });
await settle();
assert.equal(events(bob, 'user:online').length + events(bob, 'user:busy').length, 0, 'org B sees nothing from org A');
assert.ok(!JSON.stringify(bob.got).includes('alice'), 'no org A user ids in org B');
const seen = events(rita, 'user:online').concat(events(rita, 'user:busy'));
assert.ok(seen.length >= 2 && seen.every((p) => p.userId === 'alice' && p.name !== 'Spoofed Bob'));
const roster = events(bob, 'presence:sync').at(-1) ?? [];
assert.ok(roster.every((p: any) => p.userId === 'bob'));
ok('presence: org-scoped, and the payload can’t claim another user or name');

// ---- Schedule and slots ----
clear(alice, rita, bob);
alice.emit('schedule:updated', { meetingId: 'mtg_1', updatedBy: 'CEO', changes: { start: '10:00' } });
alice.emit('slot:booked', { slotId: 'slot_1', date: '2026-11-20', time: '10:00', bookedBy: 'CEO', attendeeEmail: 'private@client.test' });
alice.emit('schedule:updated', { meetingId: '../../etc' });
await settle();
assert.equal(bob.got.length, 0, 'org B receives nothing');
const sched = events(rita, 'schedule:updated');
assert.equal(sched.length, 1); assert.equal(sched[0].updatedBy, 'alice');
const slot = events(rita, 'slot:booked')[0];
assert.equal(slot.bookedBy, 'alice'); assert.equal(slot.attendeeEmail, undefined);
ok('schedule/slot events: org-scoped, author from the verified user, invalid ids dropped, no attendee email broadcast');

// ---- Rooms and signaling ----
clear(alice, alice2, rita, sam, bob);
alice.emit('join-room', { roomId: 'standup' });
bob.emit('join-room', { roomId: 'standup' });
await settle();
assert.equal(events(alice, 'user-connected').length, 0, 'same room id in another org is a different room');
alice2.emit('join-room', { roomId: 'standup' });
await settle();
assert.equal(events(alice, 'user-connected').length, 1);
clear(alice, alice2, bob, rita);
alice.emit('rtc:offer', { roomId: 'standup', offer: { sdp: 'v=0' } });
await settle();
assert.equal(events(alice2, 'rtc:offer').length, 1); assert.equal(events(bob, 'rtc:offer').length, 0);
alice.emit('rtc:offer', { targetSocketId: bob.id, offer: { sdp: 'v=0' } });
alice.emit('offer', { targetSocketId: bob.id, offer: { sdp: 'v=0' } });
rita.emit('rtc:offer', { offer: { sdp: 'v=0' } }); // no room joined, no target: used to reach everyone
await settle();
assert.equal(bob.got.filter(([e]) => /offer/.test(e)).length, 0, 'cross-org target refused');
assert.equal(events(sam, 'rtc:offer').length + events(alice, 'rtc:offer').length, 0, 'untargeted offer not broadcast');
clear(alice2);
alice.emit('chat-message', { text: 'hello', sender: 'Spoofed' });
await settle();
assert.equal(events(alice2, 'chat-message')[0]?.sender, 'alice'); assert.equal(events(bob, 'chat-message').length, 0);
ok('rooms and signaling: separate per organization, no cross-org targets, no global broadcast, verified chat sender');

// ---- CRM sync: role matrix and validation ----
clear(alice, rita, sam, bob);
alice.emit('crm:entity:update', { entityType: 'deal', entityId: 'deal_1', version: 1, patch: { stage: 'proposal' }, author: 'bob' });
await settle();
const upd = events(rita, 'crm:entity:updated');
assert.equal(upd.length, 1); assert.equal(upd[0].updatedBy, 'alice'); assert.equal(events(bob, 'crm:entity:updated').length, 0);
assert.equal(events(alice, 'crm:entity:ack').length, 1);
ok('CRM sync: an owner’s update reaches only their organization, author from the verified user');

clear(alice, rita, sam, bob);
rita.emit('crm:entity:update', { entityType: 'contact', entityId: 'c_1', version: 1, patch: { name: 'x' } });
sam.emit('crm:entity:update', { entityType: 'deal', entityId: 'deal_1', version: 9, patch: { value: 1 } });
sam.emit('crm:entity:delete', { entityType: 'contact', entityId: 'c_1' });
rita.emit('crm:entity:batch_update', { updates: [{ entityType: 'lead', entityId: 'l_1', patch: { status: 'won' } }] });
await settle();
assert.deepEqual(events(rita, 'crm:sync:denied').map((d) => d.reason), ['forbidden', 'forbidden']);
assert.deepEqual(events(sam, 'crm:sync:denied').map((d) => d.reason), ['forbidden', 'forbidden']);
assert.equal(events(alice, 'crm:entity:updated').length + events(alice, 'crm:entity:deleted').length, 0);
sam.emit('crm:entity:update', { entityType: 'contact', entityId: 'c_2', version: 1, patch: { phone: '555' } });
await settle();
assert.equal(events(alice, 'crm:entity:updated').length, 1, 'support agent may edit contacts (matrix)');
ok('CRM sync: READ_ONLY can’t write; SUPPORT_AGENT can’t edit deals or delete contacts but can edit contacts');

clear(alice, rita);
for (const bad of [
  { entityType: 'deal', entityId: 'd', patch: JSON.parse('{"__proto__":{"admin":true}}') },
  { entityType: 'deal', entityId: 'd', patch: { nested: JSON.parse('{"constructor":{"x":1}}') } },
  { entityType: 'deal', entityId: 'd', patch: 'string' },
  { entityType: 'deal', entityId: 'd', patch: [] },
  { entityType: 'deal', entityId: 'd', patch: {} },
  { entityType: 'deal', entityId: 'd', patch: { big: 'x'.repeat(40_000) } },
  { entityType: 'deal', entityId: '../d', patch: { a: 1 } },
  { entityType: 'invoice', entityId: 'd', patch: { a: 1 } },
  { entityType: 'constructor', entityId: 'd', patch: { a: 1 } },
]) alice.emit('crm:entity:update', bad);
await settle();
assert.equal(events(rita, 'crm:entity:updated').length, 0);
assert.equal(events(alice, 'crm:sync:denied').length, 9);
ok('CRM sync: prototype keys, non-objects, empty or oversized patches, bad ids and unknown types → refused');

clear(bob);
bob.emit('crm:sync:request_state');
await settle();
assert.equal(events(bob, 'crm:sync:init')[0].totalEntities, 0, 'org B can’t see org A’s sync state');
ok('CRM sync state is per organization');

sockets.forEach((s) => s.close());
server.close();
console.log = quiet;
console.log(`\n${passed} passed (real-time isolation)`);
process.exit(0);
