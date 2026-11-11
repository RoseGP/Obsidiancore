/**
 * Public booking: honest 501 when no host is configured, bookings saved as scheduled meetings of the host
 * organization (never a fake 201), the slot must be free, no double booking, no error text leaks.
 * Run: npx tsx src/routes/__tests__/availability.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { DateTime } from 'luxon';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });
delete process.env.BOOKING_HOST_ORG_ID; delete process.env.BOOKING_HOST_USER_ID;

const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../server/routeGuards');
const availability = (await import('../availability')).default;
const app = express(); app.use(express.json());
app.use('/api/availability', guard(PUBLIC.availability), availability);
const anon = () => request(app);

// A weekday at least 3 days ahead, in the event type's host timezone.
let day = DateTime.now().setZone('America/New_York').plus({ days: 3 });
while (day.weekday > 4) day = day.plus({ days: 1 }); // Mon–Thu (full working hours)
const date = day.toFormat('yyyy-MM-dd');
const slug = 'strategy-session';

// ---- No host configured: honest ----
let r = await anon().get('/api/availability/status');
assert.equal(r.status, 200); assert.equal(r.body.configured, false);
r = await anon().get('/api/availability/event-types');
assert.equal(r.status, 200); assert.ok(r.body.data.length > 0);
r = await anon().get(`/api/availability/${slug}?startDate=${date}&endDate=${date}&visitorTimezone=UTC`);
assert.equal(r.status, 200);
const firstSlot = r.body.data.slots[0];
assert.ok(firstSlot, 'expected a free slot');
r = await anon().post('/api/availability/book').send({ eventTypeSlug: slug, startTimeISO: firstSlot.startTimeUTC, clientName: 'Avery Lee', clientEmail: 'avery@example.com' });
assert.equal(r.status, 501); assert.equal(r.body.code, 'not_available');
assert.equal([...store.data.keys()].some((k) => k.includes('scheduled_meetings')), false);
ok('without a booking host: 501 not_available, nothing pretends to be booked');

// ---- Input errors never leak exception text ----
r = await anon().get(`/api/availability/${slug}?startDate=2026-13-45&endDate=2026-01-01`);
assert.equal(r.status, 400); assert.doesNotMatch(JSON.stringify(r.body), /Error|stack|Invalid date parameters/);
r = await anon().get('/api/availability/no-such-type');
assert.equal(r.status, 404);
ok('bad dates and unknown types get plain messages, no exception text');

// ---- Host configured: bookings are saved and block the slot ----
process.env.BOOKING_HOST_ORG_ID = 'org_host'; process.env.BOOKING_HOST_USER_ID = 'host_user';
await store.set('organizations/org_host', { id: 'org_host', name: 'Host Co' });
r = await anon().post('/api/availability/book').send({ eventTypeSlug: slug, startTimeISO: firstSlot.startTimeUTC, clientName: '', clientEmail: 'nope' });
assert.equal(r.status, 400); assert.ok(r.body.fields.clientName && r.body.fields.clientEmail);
r = await anon().post('/api/availability/book').send({ eventTypeSlug: slug, startTimeISO: firstSlot.startTimeUTC, clientName: 'Avery Lee', clientEmail: 'Avery@Example.com', notes: 'Website rebuild', orgId: 'org_other' });
assert.equal(r.status, 201); assert.equal(r.body.success, true);
const id = r.body.data.id;
const saved = await store.get(`organizations/org_host/scheduled_meetings/${id}`);
assert.ok(saved); assert.equal(saved.source, 'public_booking'); assert.deepEqual(saved.guests, ['avery@example.com']);
assert.equal(Date.parse(saved.startTime), Date.parse(firstSlot.startTimeUTC));
assert.equal(await store.get(`organizations/org_other/scheduled_meetings/${id}`), null);
ok('a booking is saved as a scheduled meeting of the configured host organization (body orgId ignored)');

r = await anon().post('/api/availability/book').send({ eventTypeSlug: slug, startTimeISO: firstSlot.startTimeUTC, clientName: 'Sam Patel', clientEmail: 'sam@example.com' });
assert.equal(r.status, 409); assert.equal(r.body.code, 'slot_unavailable');
r = await anon().get(`/api/availability/${slug}?startDate=${date}&endDate=${date}&visitorTimezone=UTC`);
assert.equal(r.body.data.slots.some((s: any) => Date.parse(s.startTimeUTC) === Date.parse(firstSlot.startTimeUTC)), false);
ok('a booked slot disappears from availability and can’t be booked twice');

r = await anon().post('/api/availability/book').send({ eventTypeSlug: slug, startTimeISO: day.set({ hour: 3, minute: 0 }).toISO(), clientName: 'Night Owl', clientEmail: 'owl@example.com' });
assert.equal(r.status, 409);
ok('times outside working hours are refused');

console.log(`\navailability: ${passed} checks passed`);
process.exit(0);
