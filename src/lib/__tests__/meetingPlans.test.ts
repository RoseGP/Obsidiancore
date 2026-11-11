/**
 * Meeting plan rules (shared by server and UI): defaults, Enterprise custom limits, upgrades never lower a
 * running meeting, capacity and time-limit states, plan suggestions, and large-room tile paging.
 * Run: npx tsx src/lib/__tests__/meetingPlans.test.ts
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_PLAN_CONFIGS as P, capacityStatus, durationStatus, effectiveLimits, formatMinutes, gridColumns, normalizeTier, pageOfTiles,
  planForNeeds, prioritizeTiles, raiseFeatures, raiseLimits, roomCapacity, tilesPerPage,
} from '../meetingPlans';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };

assert.deepEqual(P.free.limits, { maxParticipants: 100, maxDurationMinutes: 60 });
assert.deepEqual(P.premium.limits, { maxParticipants: 250, maxDurationMinutes: 300 });
assert.deepEqual(P.enterprise.limits, { maxParticipants: 500, maxDurationMinutes: 720 });
assert.equal(P.free.warnMinutesBefore, 5);
assert.ok(!P.free.features.recording && P.premium.features.recording && P.premium.features.waitingRoom && P.premium.features.analytics);
assert.ok(!P.premium.features.coHosts && P.enterprise.features.coHosts && P.enterprise.features.attendanceReports && P.enterprise.features.customBranding);
ok('seed defaults: Free 100 / 60 min; Premium 250 / 5 h with recording, waiting room, analytics; Enterprise 500 / 12 h with co-hosts, reports, branding');
assert.deepEqual([normalizeTier('standard'), normalizeTier('premium'), normalizeTier('gold')], ['free', 'premium', 'free']); ok('older "standard" reads as Free; unknown tiers fall back to Free');

assert.deepEqual(effectiveLimits(P.enterprise, { maxParticipants: 800 }), { maxParticipants: 800, maxDurationMinutes: 720 });
assert.deepEqual(effectiveLimits(P.premium, { maxParticipants: 800 }), P.premium.limits); ok('custom limits apply to Enterprise only');
assert.deepEqual(raiseLimits(P.premium.limits, P.free.limits), P.premium.limits);
assert.deepEqual(raiseLimits(P.free.limits, P.premium.limits), P.premium.limits);
assert.equal(raiseFeatures(P.premium.features, P.free.features).recording, true); ok('running meetings only ever gain limits and features');

const std = P.free.limits;
assert.deepEqual(roomCapacity(std, 99), { free: 1, fits: 1, full: false, allFit: true });
assert.equal(roomCapacity(std, 100).full, true);
assert.deepEqual([capacityStatus(std, 89), capacityStatus(std, 90), capacityStatus(std, 99), capacityStatus(std, 100)], ['ok', 'near', 'near', 'full']);
ok('capacity: 100th person fits; near-full from 90%; full at 100 (75/100 is ok)');
assert.deepEqual(durationStatus(std, 54 * 60 + 59), { state: 'ok', secondsLeft: 301 });
assert.deepEqual(durationStatus(std, 55 * 60), { state: 'warning', secondsLeft: 300 });
assert.deepEqual(durationStatus(std, 3600), { state: 'reached', secondsLeft: 0 });
assert.equal(durationStatus(P.premium.limits, 3600).state, 'ok');
assert.equal(durationStatus(P.premium.limits, 296 * 60, 5).state, 'warning');
assert.equal(durationStatus(std, 50 * 60, 15).state, 'warning'); ok('time limit: 5-minute warning (configurable), ends at the limit; Premium runs past 60 minutes');

assert.equal(planForNeeds(P, { participants: 101 }), 'premium');
assert.equal(planForNeeds(P, { minutes: 301 }), 'enterprise');
assert.equal(planForNeeds(P, { feature: 'recording' }), 'premium');
assert.equal(planForNeeds(P, { feature: 'coHosts' }), 'enterprise');
assert.equal(planForNeeds(P, { participants: 501 }), null); ok('suggests the smallest plan that fits a need');
assert.deepEqual([formatMinutes(0), formatMinutes(1), formatMinutes(45), formatMinutes(60), formatMinutes(90), formatMinutes(300)], ['0 minutes', '1 minute', '45 minutes', '1 hour', '1 h 30 min', '5 hours']); ok('durations read naturally');

assert.deepEqual([tilesPerPage(375), tilesPerPage(800), tilesPerPage(1280), tilesPerPage(1920)], [4, 9, 16, 25]);
const people = Array.from({ length: 99 }, (_, i) => ({ id: `p${i}` }));
const pg = pageOfTiles(people, 0, 25);
assert.equal(pg.items.length, 24); assert.equal(pg.pages, 4);
const seen = new Set<string>(); for (let i = 0; i < pg.pages; i++) pageOfTiles(people, i, 25).items.forEach((p) => seen.add(p.id));
assert.equal(seen.size, 99);
assert.deepEqual(prioritizeTiles([{ id: 'a' }, { id: 'b', isHandRaised: true, handRaisedAt: 2 }, { id: 'c', isSpeaking: true }, { id: 'd', isScreenSharing: true }]).map((p) => p.id), ['d', 'c', 'b', 'a']);
assert.deepEqual([gridColumns(1), gridColumns(4), gridColumns(9), gridColumns(16), gridColumns(25)], [1, 2, 3, 4, 5]);
ok('large rooms: paged grid, everyone on exactly one page, most relevant first');

console.log(`\n${passed} passed (meeting plans)`);
process.exit(0);
