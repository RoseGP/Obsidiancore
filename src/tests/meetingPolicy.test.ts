/**
 * Group meeting policy: 100-participant capacity and the 60-minute session limit.
 */
import {
  GROUP_MEETING_LIMITS,
  admitParticipants,
  closeRoomSession,
  getSessionTimeState,
  gridColumns,
  gridPage,
  openRoomSession,
  parseInviteEmails,
  remainingSeats,
  type RoomRegistry,
} from '../lib/meetingPolicy';

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✅ [PASS] ${name}`); passed++; }
  else { console.error(`  ❌ [FAIL] ${name}${detail ? `: ${detail}` : ''}`); failed++; }
}

const MIN = 60_000;
const person = (i: number, email = `p${i}@example.com`) => ({ id: `p-${i}`, email });

console.log('👥 Capacity (100 people, host included)');
{
  const limits = GROUP_MEETING_LIMITS;
  assert(limits.maxParticipants === 100, 'Group meetings allow 100 participants');
  assert(remainingSeats(limits, 0) === 99, 'Host alone leaves 99 seats');

  const incoming = Array.from({ length: 120 }, (_, i) => person(i));
  const r = admitParticipants([], incoming, limits);
  assert(r.roster.length === 99, 'Roster stops at 99 remote participants', String(r.roster.length));
  assert(r.admitted.length === 99 && r.rejected.length === 21, 'Overflow is rejected, not admitted');
  assert(remainingSeats(limits, r.roster.length) === 0, 'Room reports full at 100 people');

  const again = admitParticipants(r.roster, [person(500)], limits);
  assert(again.rejected.length === 1 && again.roster.length === 99, 'A full room admits nobody else');

  const dup = admitParticipants([person(1)], [person(1), { id: 'x', email: 'P1@EXAMPLE.COM' }], limits);
  assert(dup.duplicates.length === 2 && dup.roster.length === 1, 'Duplicate ids and emails are not double-counted');
}

console.log('\n✉️  Bulk invite parsing');
{
  const { valid, invalid } = parseInviteEmails('a@x.io, b@x.io;\nA@x.io  nope  c@y.com');
  assert(valid.join() === 'a@x.io,b@x.io,c@y.com', 'Splits, lower-cases and de-dupes emails', valid.join());
  assert(invalid.join() === 'nope', 'Flags invalid entries', invalid.join());
}

console.log('\n⏱️  60-minute session limit');
{
  const t0 = 1_700_000_000_000;
  const at = (m: number) => getSessionTimeState(t0, t0 + m * MIN, 60);
  assert(!at(30).isWarning && !at(30).isLimitReached, 'No warning at 30 minutes');
  assert(at(55).isWarning && !at(55).isLimitReached, 'Warning from 55 minutes');
  assert(at(60).isLimitReached && at(60).remainingSeconds === 0, 'Limit reached at exactly 60 minutes');
  assert(at(75).elapsedSeconds === 3600, 'Elapsed time is clamped to the limit');
  assert(at(0).expiresAt === t0 + 60 * MIN, 'Session exposes its expiry time');
  assert(getSessionTimeState(t0, t0 + 300 * MIN, 0).isLimitReached === false, 'Unlimited sessions never expire');
}

console.log('\n🚪 Rejoining cannot reset the clock');
{
  const t0 = 1_700_000_000_000;
  let reg: RoomRegistry = {};
  const first = openRoomSession(reg, 'room-a', GROUP_MEETING_LIMITS, t0);
  assert(first.ok && !first.resumed, 'First open starts the room session');
  if (first.ok) reg = first.registry;

  const rejoin = openRoomSession(reg, 'room-a', { maxParticipants: 500, maxDurationMinutes: 0 }, t0 + 40 * MIN);
  assert(rejoin.ok && rejoin.resumed && rejoin.record.startedAt === t0, 'Rejoin keeps the original start time');
  assert(rejoin.ok && rejoin.record.maxDurationMinutes === 60, 'Rejoin keeps the original limits (plan change does not extend it)');

  const late = openRoomSession(reg, 'room-a', GROUP_MEETING_LIMITS, t0 + 61 * MIN);
  assert(!late.ok && late.reason === 'duration_limit', 'Room cannot be reopened after its 60-minute window');

  const closed = closeRoomSession(reg, 'room-a', 'duration_limit', t0 + 60 * MIN);
  const after = openRoomSession(closed, 'room-a', GROUP_MEETING_LIMITS, t0 + 60 * MIN + 1000);
  assert(!after.ok, 'A room closed at the limit stays closed');

  const other = openRoomSession(closed, 'room-b', GROUP_MEETING_LIMITS, t0 + 61 * MIN);
  assert(other.ok && !other.resumed, 'A new meeting can still be started');

  const stale = openRoomSession({ old: { roomId: 'old', startedAt: t0 - 25 * 60 * MIN, ...GROUP_MEETING_LIMITS } }, 'x', GROUP_MEETING_LIMITS, t0);
  assert(!('old' in stale.registry), 'Records older than a day are pruned');
}

console.log('\n🔲 Grid paging for 100 people');
{
  assert(gridColumns(1) === 1 && gridColumns(4) === 2 && gridColumns(9) === 3 && gridColumns(25) === 5, 'Column counts scale with tile count');
  const p0 = gridPage(99, 0);
  assert(p0.pageCount === 4 && p0.includeLocal && p0.tileCount === 25 && p0.end === 24, 'First page: you + 24 others');
  const p3 = gridPage(99, 3);
  assert(p3.start === 74 && p3.end === 99 && p3.tileCount === 25 && !p3.includeLocal, 'Last page shows the remaining 25');
  assert(gridPage(99, 99).page === 3, 'Out-of-range page is clamped');
  const seen = new Set<number>();
  for (let i = 0; i < p0.pageCount; i++) { const g = gridPage(99, i); for (let k = g.start; k < g.end; k++) seen.add(k); }
  assert(seen.size === 99, 'Every participant appears on exactly one page');
}

console.log(`\nResults: ${passed} Passed, ${failed} Failed\n`);
if (failed > 0) process.exit(1);
