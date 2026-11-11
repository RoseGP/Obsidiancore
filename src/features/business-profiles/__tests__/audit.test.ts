/** Unit tests for the deterministic audit, validation and grounding checks. Run: npx tsx src/features/business-profiles/__tests__/audit.test.ts */
import assert from 'node:assert/strict';
import { ZodError } from 'zod';
import { auditProfile, promotionalPhrases, nameSimilarity, normalizeAddress, overlappingPeriods, phoneKey, priorityOf, repeatedTerms, urlKey } from '../domain/audit';
import { diffProfiles } from '../domain/diff';
import { emptyProfileData, type BusinessProfileData } from '../domain/types';
import { cleanText, parseProfileData } from '../domain/validation';
import { groundingFlags } from '../server/assistant';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const NOW = new Date('2026-11-11T12:00:00Z');
const week = (open = '09:00', close = '17:00') => Object.fromEntries(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map((d) => [d, { closed: false, periods: [{ open, close }] }]).concat([['SATURDAY', { closed: true, periods: [] }], ['SUNDAY', { closed: true, periods: [] }]]));
const full = (): BusinessProfileData => ({
  ...emptyProfileData(), name: 'Acme Dental', primaryCategory: 'Dentist', additionalCategories: ['Cosmetic dentist'],
  description: 'Acme Dental is a family dental practice offering check-ups, cleanings, fillings and teeth whitening for children and adults. Our team explains every treatment clearly and works with most dental insurance plans. Located in downtown Austin with step-free access and evening appointments on weekdays.',
  phone: '+1 512 555 0100', website: 'https://acme.example', address: { line1: '1 Main Street', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US' },
  hours: week() as any, services: [{ name: 'Teeth whitening', description: 'In-office whitening.' }, { name: 'Check-ups', description: 'Exam and cleaning.' }],
  attributes: ['Wheelchair accessible entrance'], specialHours: [{ date: '2026-12-25', closed: true, periods: [] }],
  media: [{ kind: 'logo', url: 'https://cdn.example/l.png', addedAt: '2026-10-01T00:00:00Z' }, { kind: 'cover', url: 'https://cdn.example/c.png', addedAt: '2026-10-01T00:00:00Z' }, ...[1, 2, 3].map((i) => ({ kind: 'photo' as const, url: `https://cdn.example/${i}.jpg`, addedAt: '2026-10-01T00:00:00Z' }))],
});
const find = (r: ReturnType<typeof auditProfile>, id: string) => r.findings.find((f) => f.checkId === id)!;

// ---- Helpers ----
assert.equal(nameSimilarity('Acme Dental, LLC', 'ACME Dental'), 1);
assert.ok(nameSimilarity('Acme Dental', 'Acme Dental Downtown') >= 0.6 && nameSimilarity('Acme Dental', 'Acme Dental Downtown') < 1);
assert.ok(nameSimilarity('Acme Dental', 'Bright Smiles Clinic') < 0.4); ok('name similarity normalises legal suffixes/case and scores partial matches');
assert.equal(normalizeAddress('1 Main Street, Suite 4'), normalizeAddress('1 main st ste 4')); ok('address normalisation handles common abbreviations');
assert.equal(phoneKey('+1 (512) 555-0100'), phoneKey('512.555.0100')); assert.equal(urlKey('https://www.acme.example/'), urlKey('https://acme.example')); ok('phone and URL keys compare formatting-insensitively');
assert.equal(overlappingPeriods([{ open: '09:00', close: '13:00' }, { open: '12:00', close: '17:00' }]), true);
assert.equal(overlappingPeriods([{ open: '09:00', close: '12:00' }, { open: '13:00', close: '17:00' }]), false);
assert.equal(overlappingPeriods([{ open: '18:00', close: '02:00' }, { open: '01:00', close: '03:00' }]), false); ok('hour overlap detection (incl. overnight ranges)');
assert.deepEqual(repeatedTerms(Array(6).fill('plumber austin plumbing service for homes').join(' ')).sort(), ['austin', 'homes', 'plumber', 'plumbing', 'service'].sort()); ok('keyword stuffing heuristic');
assert.ok(priorityOf('high', 'critical', 'low') > priorityOf('high', 'critical', 'high') && priorityOf('high', 'high', 'low') > priorityOf('low', 'low', 'low')); ok('priority = impact × severity ÷ effort');

// ---- Audit ----
let r = auditProfile({ data: full(), version: 3, hoursVerifiedAt: '2026-11-01T00:00:00Z', lastReviewedAt: '2026-11-01T00:00:00Z' }, NOW);
assert.equal(r.counts.fail, 0, JSON.stringify(r.priorities.map((f) => f.checkId))); assert.ok(r.score >= 95, String(r.score)); assert.equal(r.completeness, 100); assert.equal(r.profileVersion, 3);
assert.equal(find(r, 'listing-consistency').status, 'unknown'); assert.ok(r.coverage < 100); ok('complete profile: no failures, high score, consistency reported as “not checked” (unknown), not passed');

r = auditProfile({ data: { ...emptyProfileData(), name: 'Joe' }, version: 1 }, NOW);
assert.ok(r.score < 30); assert.equal(r.priorities[0].status, 'fail');
for (const id of ['primary-category', 'phone', 'location', 'hours', 'description']) assert.equal(find(r, id).status, 'fail', id);
assert.ok(r.priorities.every((f, i, a) => i === 0 || a[i - 1].priority >= f.priority)); ok('empty profile: core gaps fail, priorities sorted by impact/effort');
assert.equal(find(r, 'hours-verified').status, 'warn'); assert.match(find(r, 'hours-verified').explanation, /never/); ok('never-confirmed hours flagged as stale');

const bad = full();
bad.name = 'Acme Dental | Best Dentist Austin'; bad.description = 'BEST DENTIST IN AUSTIN! Call +1 512 555 0100 or visit www.acme.example. We guarantee results. ' + bad.description; bad.website = 'http://acme.example';
bad.hours = { ...bad.hours, MONDAY: { closed: false, periods: [{ open: '09:00', close: '13:00' }, { open: '12:00', close: '17:00' }] } };
r = auditProfile({ data: bad, version: 1 }, NOW);
assert.equal(find(r, 'name-keywords').status, 'warn'); assert.equal(find(r, 'description-contact').status, 'fail'); assert.equal(find(r, 'description-claims').status, 'warn');
assert.equal(find(r, 'website-https').status, 'warn'); assert.equal(find(r, 'hours-valid').status, 'fail'); assert.equal(find(r, 'description-caps').status, 'pass');
assert.ok(r.findings.every((f) => f.source === 'algorithmic')); ok('accuracy/content issues: keyword name, links in description, claims, http, overlapping hours');

const listing = { provider: 'google_business_profile' as const, externalId: 'locations/1', title: 'Acme', linkedAt: '2026-11-10T00:00:00Z', linkedBy: 'u', snapshotAt: '2026-11-10T00:00:00Z',
  snapshot: { name: 'ACME Dental LLC', phone: '(512) 555-0199', website: 'https://www.acme.example/', addressLines: ['1 Main St'], postalCode: '78701', city: 'Austin', primaryCategory: 'dentist', hours: [{ day: 'MONDAY', open: '09:00', close: '17:00' }], description: 'Old text' } };
r = auditProfile({ data: full(), version: 1, listing }, NOW);
assert.equal(find(r, 'nap-name').status, 'pass'); assert.equal(find(r, 'nap-phone').status, 'fail'); assert.equal(find(r, 'nap-website').status, 'pass'); assert.equal(find(r, 'nap-address').status, 'pass');
assert.equal(find(r, 'category-match').status, 'pass'); assert.equal(find(r, 'hours-match').status, 'fail'); assert.match(find(r, 'hours-match').evidence!, /Tuesday CRM 09:00-17:00 · Google closed/);
assert.equal(find(r, 'description-published').status, 'warn'); assert.equal(find(r, 'nap-phone').source, 'verified'); assert.match(find(r, 'nap-phone').explanation, /Google data from 1 day ago/); ok('consistency vs listing snapshot: normalised NAP matching, verified provenance with data age');
r = auditProfile({ data: full(), version: 1, listing: { ...listing, snapshotAt: '2026-08-01T00:00:00Z' } }, NOW);
assert.equal(find(r, 'listing-snapshot-age').status, 'warn'); ok('old listing data flagged before acting on mismatches');
r = auditProfile({ data: full(), version: 1, listing: { ...listing, snapshot: undefined } }, NOW);
assert.equal(find(r, 'listing-consistency').status, 'unknown'); ok('linked but not fetched → unknown, excluded from score');

// ---- Validation & diff ----
assert.throws(() => parseProfileData({ name: '' }), ZodError);
assert.throws(() => parseProfileData({ name: 'X', website: 'javascript:alert(1)' }), ZodError);
assert.throws(() => parseProfileData({ name: 'X', website: 'https://user:pw@evil.example' }), ZodError);
assert.throws(() => parseProfileData({ name: 'X', phone: '12' }), ZodError);
assert.throws(() => parseProfileData({ name: 'X', additionalCategories: Array(10).fill('a') }), ZodError);
assert.throws(() => parseProfileData({ name: 'X', hideAddress: true }), ZodError);
assert.throws(() => parseProfileData({ name: 'X', hours: { MONDAY: { closed: false, periods: [{ open: '25:00', close: '17:00' }] } } }), ZodError);
assert.throws(() => parseProfileData({ name: 'X', media: [{ kind: 'logo', url: 'http://x.example/a.png' }] }), ZodError);
assert.throws(() => parseProfileData({ name: 'X', unknownField: 1 }), ZodError);
assert.throws(() => parseProfileData({ name: 'X', description: 'x'.repeat(751) }), ZodError); ok('validation rejects bad URLs, phones, hours, limits, unknown fields');
const parsed = parseProfileData({ name: '  Acme <b>Dental</b>‮ ', description: 'Line one<script>alert(1)</script>\n\n\n\nLine two', email: 'HELLO@Acme.Example' });
assert.equal(parsed.name, 'Acme Dental'); assert.equal(parsed.description, 'Line onealert(1)\n\nLine two'); assert.equal(parsed.email, 'hello@acme.example');
assert.equal(cleanText('a\u0000b​c'), 'abc'); ok('sanitisation strips tags, control and bidi characters');
const d1 = full(); const d2 = { ...full(), phone: '+1 512 555 0199', services: [...full().services, { name: 'Implants' }] };
const ch = diffProfiles(d1, d2);
assert.deepEqual(ch.map((c) => c.field).sort(), ['phone', 'services']); assert.equal(ch.find((c) => c.field === 'phone')!.before, '+1 512 555 0100'); ok('field-level diff for the change history');

// ---- Grounding checks on AI text ----
const facts = { businessName: 'Acme Dental', city: 'Austin', services: [{ name: 'Teeth whitening' }] };
const flags = groundingFlags('Acme Dental has served Austin and Round Rock for 25 years. We are the #1 dentist and guarantee top of Google. Visit https://x.example.', facts);
assert.ok(flags.some((f) => /numbers not found.*25/.test(f))); assert.ok(flags.some((f) => /Round, Rock|Round/.test(f))); assert.ok(flags.some((f) => /guarantee/.test(f)));
assert.ok(flags.some((f) => /link, email or phone/.test(f))); assert.ok(flags.some((f) => /promotional/.test(f)));
assert.deepEqual(groundingFlags('Acme Dental offers teeth whitening in Austin.', facts), []);
assert.deepEqual(promotionalPhrases('Step-free access, gluten-free options and hands-free taps.'), []); assert.deepEqual(promotionalPhrases('Free consultation for new patients.'), ['free']); ok('AI output: invented numbers/places, guarantees, links and promo wording are flagged; grounded text passes');

console.log(`\n${passed} passed (business profiles: audit)`);
