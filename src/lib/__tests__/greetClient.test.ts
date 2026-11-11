/**
 * GREET client helpers: local calendar entries → server schedule requests, server meetings → calendar events.
 * Run: npx tsx src/lib/__tests__/greetClient.test.ts
 */
import assert from 'node:assert/strict';
import { emailsIn, meetingToCalendarEvent, scheduleFromCalendarEvent, type GreetMeeting } from '../greetClient';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };

let s = scheduleFromCalendarEvent({ title: 'Demo', time: '2026-12-01 14:30', contact: 'Ann <ann@client.test>', invitees: 'bob@client.test, ann@client.test', notes: 'Agenda' });
assert.deepEqual(s && { date: s.date, time: s.time, duration: s.duration, guests: s.guests }, { date: '2026-12-01', time: '14:30', duration: 30, guests: ['bob@client.test', 'ann@client.test'] });
ok('calendar form entry → date, time, default 30 min, unique guest emails');

s = scheduleFromCalendarEvent({ title: 'Sync', date: '2026-12-02', time: '2026-12-02 3:30 PM', duration: 45 });
assert.equal(s?.time, '3:30 PM'); assert.equal(s?.duration, 45);
s = scheduleFromCalendarEvent({ title: 'Follow-up', time: '2026-12-03 9:05', contact: 'Jordan (Northwind)' });
assert.equal(s?.time, '09:05'); assert.match(s!.additionalNotes!, /With: Jordan \(Northwind\)/); assert.deepEqual(s?.guests, []);
ok('12-hour times, zero-padding and a non-email contact kept as a note');

assert.equal(scheduleFromCalendarEvent({ title: 'No date', time: '3:30 PM - 4:00 PM' }), null);
assert.equal(scheduleFromCalendarEvent({ title: '', time: '2026-12-01 10:00' }), null);
ok('entries without a date or title are not sent to the server');

assert.deepEqual(emailsIn('a@x.io; B@Y.io, junk'), ['a@x.io', 'b@y.io']);
ok('email extraction');

const m: GreetMeeting = {
  id: 'smt_1', title: 'Review', date: '2026-12-01', time: '14:30', duration: 30, startTime: '2026-12-01T14:30:00.000Z', endTime: '2026-12-01T15:00:00.000Z',
  nextOccurrence: { startTime: '2026-12-08T14:30:00.000Z', endTime: '2026-12-08T15:00:00.000Z' },
  status: 'SCHEDULED', roomCode: 'abc-defg-hij', videoLink: 'https://crm.example.com/?view=greet&meet=abc-defg-hij', guests: ['g@x.io'],
  invitees: [{ userId: 'u1', name: 'Sam', email: 's@a.io' }], associations: { leadId: 'l1', label: 'Avery Lee' }, hostId: 'h', yourRole: 'host', canEdit: true,
};
const ev = meetingToCalendarEvent(m);
assert.equal(ev.id, 'smt_1'); assert.equal(ev.serverMeeting, true); assert.equal(ev.contact, 'Avery Lee');
assert.equal(ev.startTime, '2026-12-08T14:30:00.000Z'); assert.ok(ev.time.startsWith(ev.date!));
assert.equal(ev.invitees, 'Sam, g@x.io'); assert.equal(ev.status, 'upcoming');
assert.equal(meetingToCalendarEvent({ ...m, status: 'CANCELLED' }).status, 'cancelled');
ok('server meeting → calendar event keyed by the meeting id (next occurrence, linked record, people)');

console.log(`\n${passed} passed (GREET client)`);
