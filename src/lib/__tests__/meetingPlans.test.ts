/**
 * Meeting plans: limits, capacity, time limit and large-room tile paging.
 * Run: npx tsx src/lib/__tests__/meetingPlans.test.ts
 */
import assert from 'node:assert/strict';
import {
  MEETING_PLANS, durationStatus, gridColumns, isMeetingPlanTier, pageOfTiles, planForSize, prioritizeTiles, roomCapacity, tilesPerPage,
} from '../meetingPlans';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };

// Plans
assert.deepEqual([MEETING_PLANS.standard.maxParticipants, MEETING_PLANS.standard.maxDurationMinutes], [100, 60]);
assert.deepEqual([MEETING_PLANS.premium.maxParticipants, MEETING_PLANS.premium.maxDurationMinutes], [250, 0]);
assert.deepEqual([MEETING_PLANS.enterprise.maxParticipants, MEETING_PLANS.enterprise.maxDurationMinutes], [500, 0]);
ok('Standard: 100 people, 60 minutes; Premium: 250, no limit; Enterprise: 500, no limit');
assert.ok(isMeetingPlanTier('premium') && !isMeetingPlanTier('gold') && !isMeetingPlanTier(undefined)); ok('plan names are validated');
assert.deepEqual([planForSize(100), planForSize(101), planForSize(250), planForSize(251), planForSize(500), planForSize(501)], ['standard', 'premium', 'premium', 'enterprise', 'enterprise', null]);
ok('smallest plan for a group size');

// Capacity (counts include the host)
const std = MEETING_PLANS.standard;
assert.deepEqual(roomCapacity(std, 99), { free: 1, fits: 1, full: false, allFit: true }); ok('99 in the room: the 100th person fits');
assert.equal(roomCapacity(std, 100).full, true); assert.equal(roomCapacity(std, 100).fits, 0); ok('100 in the room: Standard is full');
assert.deepEqual(roomCapacity(std, 95, 10), { free: 5, fits: 5, full: false, allFit: false }); ok('admitting a group only seats who fits');
assert.equal(roomCapacity(MEETING_PLANS.premium, 249).fits, 1); assert.equal(roomCapacity(MEETING_PLANS.premium, 250).full, true);
assert.equal(roomCapacity(MEETING_PLANS.enterprise, 499).fits, 1); assert.equal(roomCapacity(MEETING_PLANS.enterprise, 500).full, true);
ok('Premium fills at 250, Enterprise at 500');
assert.equal(roomCapacity(std, 150).free, 0); ok('over capacity never reports negative seats');

// Time limit
assert.deepEqual(durationStatus(std, 0), { state: 'ok', secondsLeft: 3600 });
assert.equal(durationStatus(std, 54 * 60 + 59).state, 'ok');
assert.deepEqual(durationStatus(std, 55 * 60), { state: 'warning', secondsLeft: 300 });
assert.deepEqual(durationStatus(std, 3599), { state: 'warning', secondsLeft: 1 });
assert.deepEqual(durationStatus(std, 3600), { state: 'reached', secondsLeft: 0 });
assert.equal(durationStatus(std, 9000).state, 'reached');
ok('Standard: warning for the last 5 minutes, limit reached at 60:00');
assert.deepEqual(durationStatus(MEETING_PLANS.premium, 10 * 3600), { state: 'unlimited', secondsLeft: null });
assert.equal(durationStatus(MEETING_PLANS.enterprise, 10 * 3600).state, 'unlimited'); ok('Premium and Enterprise have no time limit');

// Large rooms
assert.deepEqual([tilesPerPage(375), tilesPerPage(800), tilesPerPage(1280), tilesPerPage(1920)], [4, 9, 16, 25]); ok('tiles per page by screen width');
const people = Array.from({ length: 99 }, (_, i) => ({ id: `p${i}` }));
let pg = pageOfTiles(people, 0, 25);
assert.equal(pg.items.length, 24); assert.equal(pg.pages, 4); assert.equal(pg.items[0].id, 'p0'); ok('100-person meeting: page 1 has you + 24 others; 4 pages');
pg = pageOfTiles(people, 3, 25);
assert.equal(pg.items.at(-1)!.id, 'p98'); assert.equal(pg.items.length, 99 - 24 - 50); ok('last page holds the remainder');
assert.equal(pageOfTiles(people, 99, 25).page, 3); assert.equal(pageOfTiles(people, -2, 25).page, 0); ok('out-of-range pages are clamped (e.g. after people leave)');
const seen = new Set<string>(); for (let i = 0; i < pg.pages; i++) pageOfTiles(people, i, 25).items.forEach((p) => seen.add(p.id));
assert.equal(seen.size, 99); ok('every participant appears on exactly one page');
const big = Array.from({ length: 499 }, (_, i) => ({ id: `e${i}` }));
assert.equal(pageOfTiles(big, 0, 4).pages, 1 + Math.ceil((499 - 3) / 4)); ok('500-person meeting on a phone pages 4 at a time');
assert.deepEqual(pageOfTiles([], 0, 25), { items: [], page: 0, pages: 1 }); ok('alone in the meeting: one page');

const order = prioritizeTiles([
  { id: 'a' }, { id: 'b', isHandRaised: true, handRaisedAt: 20 }, { id: 'c', isSpeaking: true },
  { id: 'd', isHandRaised: true, handRaisedAt: 10 }, { id: 'e', isScreenSharing: true }, { id: 'f' },
]).map((p) => p.id);
assert.deepEqual(order, ['e', 'c', 'd', 'b', 'a', 'f']); ok('screen sharer, then speaker, then raised hands in order raised, then join order');
assert.deepEqual([gridColumns(1), gridColumns(2), gridColumns(5), gridColumns(10), gridColumns(25)], [1, 2, 3, 4, 5]); ok('grid columns grow with the page');

console.log(`\n${passed} passed (meeting plans)`);
process.exit(0);
