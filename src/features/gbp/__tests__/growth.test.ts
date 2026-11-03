/**
 * Growth platform: audit engine, background audits, approval-based changes,
 * content plan + scheduling, competitors (Places), visibility, assistant,
 * automation inbox and security centre — end to end against the Google stand-in.
 * Run: npx tsx src/features/gbp/__tests__/growth.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { startMockGoogle } from './mockGoogle';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const APP_URL = 'https://crm.test';
const g = await startMockGoogle({ clientId: 'cid.apps.googleusercontent.com', clientSecret: 'gsecret' });

// Places stand-in
const places = express(); places.use(express.json());
let placesKeySeen = ''; let placesMask = '';
places.post('/v1/places:searchText', (req, res) => { placesKeySeen = String(req.headers['x-goog-api-key']); placesMask = String(req.headers['x-goog-fieldmask']); res.json({ places: [
  { id: 'ChIJcompetitorAAAA1', displayName: { text: 'Smile Studio' }, formattedAddress: '5 Oak St, Austin', primaryTypeDisplayName: { text: 'Dentist' }, types: ['dentist'], rating: 4.8, userRatingCount: 212, websiteUri: 'https://smile.example', photos: [{}, {}, {}] },
  { id: 'ChIJacme1001place', displayName: { text: 'Acme Dental Downtown' }, rating: 3.7, userRatingCount: 3 },
] }); });
places.get('/v1/places/:id', (req, res) => res.json({ id: req.params.id, displayName: { text: 'Smile Studio' }, formattedAddress: '5 Oak St, Austin', primaryTypeDisplayName: { text: 'Dentist' }, types: ['dentist'], rating: 4.9, userRatingCount: 220, websiteUri: 'https://smile.example', photos: [{}, {}, {}, {}] }));
const ps = places.listen(0); await new Promise((r) => ps.once('listening', r));

// Fake model: answers by recognising the prompt; records prompts so tests can check grounding.
const prompts: string[] = [];
(globalThis as any).__gbpTestAi = async (p: string) => {
  prompts.push(p);
  if (p.includes('local SEO strategist')) return '```json\n' + JSON.stringify({
    summary: 'Solid basics; expand services and description.', keywords: [{ term: 'dentist austin', intent: 'local', why: 'Real search term from Google.' }],
    categories: [{ name: 'Cosmetic dentist', why: 'You list whitening.' }, { name: 'Space station', why: 'nonsense' }],
    description: { after: 'Acme Dental Downtown is a family dentist in Austin offering cleanings and check-ups for all ages.', notes: ['Mentions the area once.'] },
    services: [{ name: 'Teeth cleaning', description: 'dup', why: 'x' }, { name: 'Teeth whitening', description: 'Professional whitening.', why: 'Check if you offer it.' }],
    attributes: [{ name: 'Restroom', why: 'If true.' }], contentTopics: [{ topic: 'Back-to-school checkups', why: 'Seasonal.' }], questions: ['Do you take new patients?'], competitorInsights: ['Smile Studio has more reviews.'],
  }) + '\n```';
  if (p.includes('Plan 30 days')) return JSON.stringify({ posts: Array.from({ length: 8 }, (_, i) => ({ day: i * 3, kind: i % 2 ? 'service' : 'update', summary: `Post ${i} about cleanings and family dentistry in Austin.`, ctaType: 'BOOK', imageIdea: 'Photo of the treatment room' })) });
  if (p.includes('Write a Google Business Profile post')) return JSON.stringify({ summary: 'We now offer early appointments on Mondays for busy families in Austin.', ctaType: 'BOOK', imageIdea: 'Front desk at 8am' });
  if (p.includes('growth advisor')) return JSON.stringify({ reply: 'Reply to your 2★ review first, then expand your description.', actions: [{ type: 'reply_reviews', label: 'Reply to reviews' }, { type: 'improve_description', label: 'Improve description' }] });
  if (p.includes('Compare this business')) return JSON.stringify({ summary: 'Competitor has more reviews.', strengths: ['Longer hours'], gaps: ['Fewer reviews'], opportunities: [{ title: 'Ask for reviews', detail: 'Share your review link.' }] });
  return 'not json';
};

const dataDir = mkdtempSync(path.join(tmpdir(), 'gbp-growth-'));
Object.assign(process.env, {
  NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', SOCIAL_ACCOUNTS_STORE: 'file', SOCIAL_ACCOUNTS_DATA_DIR: dataDir, SOCIAL_ACCOUNTS_ENCRYPTION_KEY: 'k'.repeat(40),
  APP_URL, GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'gsecret', GOOGLE_GBP_REDIRECT_URI: `${APP_URL}/api/local-seo/callback`,
  GBP_TEST_BASES: JSON.stringify({ auth: g.base, oauth: g.base, accounts: g.base, info: g.base, perf: g.base, v4: g.base, verify: g.base }),
  GOOGLE_PLACES_API_KEY: 'places-key-test', GBP_HEAVY_RATE_LIMIT: '100', GBP_TEST_PLACES_BASE: `http://127.0.0.1:${(ps.address() as any).port}`,
});
const app = express(); app.use(express.json());
app.use('/api/local-seo', (await import('../../../routes/localSeoApi')).default);
const { runAudit, nameStuffingSignals, descriptionProblems } = await import('../server/audit');
const { diffPatch, placeCategories, reviewInsights } = await import('../server/growth');
const { buildLocationPatch } = await import('../server/googleGateway');
const A = { 'X-Dev-User-Id': 'alice', Origin: APP_URL }; const B = { 'X-Dev-User-Id': 'bob', Origin: APP_URL };
const L = 'locations/1001';
const api = (m: 'get' | 'post' | 'put' | 'patch' | 'delete', p: string, who = A) => (request(app) as any)[m](`/api/local-seo${p}`).set(who);
const waitJob = async (id: string, who = A) => { for (let i = 0; i < 100; i++) { const r = await api('get', `/growth/jobs/${id}`, who); if (r.body.status === 'done' || r.body.status === 'failed') return r.body; await new Promise((x) => setTimeout(x, 50)); } throw new Error('job timeout'); };

console.log('🧩 Helpers (pure)');
{
  assert.deepEqual(placeCategories({ primaryType: 'Dentist', types: ['dentist', 'dental_clinic', 'health', 'point_of_interest'] }), ['Dentist', 'Dental clinic']);
  ok('Places categories are readable and not repeated');
  const mk = (rating: number, comment: string): any => ({ name: 'r' + Math.random(), locationName: 'l', rating, comment, createTime: '2026-10-01T00:00:00Z', reviewer: 'x' });
  const ins = reviewInsights([mk(5, 'Friendly staff and fast service!'), mk(2, 'Waited 30 minutes past my appointment.'), mk(4, 'Great quality, a bit pricey.')]);
  assert.ok(!ins.praised.some((t) => t.topic === 'Price'), 'caveated 4★ text is not praise'); assert.ok(!ins.praised.some((t) => t.topic === 'Wait time'), 'complained-about theme is not praise');
  ok('praise comes from 5★ reviews and excludes themes customers complain about');
}

console.log('🧮 Audit engine (pure)');
{
  const base: any = { name: 'locations/1', accountName: 'accounts/1', title: 'Acme', additionalCategories: [], regularHours: [], address: { lines: ['1 Main'], city: 'Austin' } };
  const empty = runAudit({ location: base, reviews: [], media: null, posts: null, attributes: null, verification: null, now: new Date('2026-11-01') });
  assert.ok(empty.overall < 50); assert.ok(empty.checks.some((c) => c.status === 'not_checked' && c.id === 'photos'));
  assert.ok(empty.issues.every((i) => i.issue.whyItMatters && i.issue.solution && /Estimate/.test(i.issue.expectedBenefit) && i.issue.action.type));
  ok('incomplete profile scores low; every issue has why, fix, estimated benefit and an action');
  assert.equal(empty.issues[0].issue.priority, 'critical'); ok('issues are sorted by priority');
  const full = runAudit({
    location: { ...base, title: 'Acme Dental', primaryCategory: 'Dentist', additionalCategories: ['Cosmetic dentist'], phone: '+1 512 555 0100', website: 'https://acme.example',
      description: 'Acme Dental is a family dental practice in Austin. '.repeat(6).trim(), regularHours: [{ day: 'MONDAY', open: '09:00', close: '17:00' }],
      specialHours: [{ startDate: '2026-11-26', endDate: '2026-11-26', closed: true }], serviceItems: Array.from({ length: 6 }, (_, i) => ({ label: `S${i}`, description: 'A plain description of the service.' })), openStatus: 'OPEN', meta: { hasVoiceOfMerchant: true } },
    reviews: Array.from({ length: 12 }, (_, i) => ({ rating: 5, comment: 'Great', createTime: '2026-10-20T00:00:00Z', reply: { updateTime: '2026-10-21T00:00:00Z' } })),
    media: { photos: 14, videos: 1, latestAt: '2026-10-01T00:00:00Z', hasLogo: true, hasCover: true }, posts: { last30: 2, latestAt: '2026-10-25T00:00:00Z' }, attributes: { set: 5, available: 8 }, verification: { state: 'verified' }, now: new Date('2026-11-01'),
  });
  assert.ok(full.overall >= 90, String(full.overall)); assert.ok(Object.values(full.areas).every((v) => v !== null)); ok(`complete profile scores ${full.overall}/100 with all six area scores`);
  assert.ok(nameStuffingSignals('Best Dentist in Austin | Emergency Dental Care Near Me', 'Austin', 'Dentist').length >= 2); assert.equal(nameStuffingSignals('Acme Dental', 'Austin', 'Dentist').length, 0);
  ok('flags keyword-stuffed business names, not normal ones');
  assert.ok(descriptionProblems('Call +1 512 555 0100 or visit https://x.com for 20% off!').length >= 3); ok('flags links, phones and promotions in descriptions');
  const p = buildLocationPatch({ regularHours: [{ day: 'FRIDAY', open: '22:00', close: '02:00' }], specialHours: [{ startDate: '2026-12-25', endDate: '2026-12-25', closed: true }], primaryCategoryId: 'categories/gcid:dentist' });
  assert.deepEqual(p.mask, ['regularHours', 'specialHours', 'categories.primaryCategory']);
  assert.equal(p.body.regularHours.periods[0].closeDay, 'SATURDAY'); assert.equal(p.body.specialHours.specialHourPeriods[0].closed, true);
  ok('overnight hours close the next day; masks list only the changed fields');
}

console.log('\n🔌 Connect & audit');
const s0 = await request(app).post('/api/local-seo/connect').set(A).send({});
const consent = await fetch(s0.body.url, { redirect: 'manual' });
const cb = new URL(consent.headers.get('location')!);
const cookie = String(([] as string[]).concat(s0.headers['set-cookie'] as any).find((c: string) => c.startsWith('gbp_oauth_state='))).split(';')[0];
await request(app).get(cb.pathname + cb.search).set('Cookie', cookie);
await api('post', '/locations/discover').send({});
await api('put', '/locations/selection').send({ locationNames: [L] });

let r = await api('post', '/growth/audits').send({ location: 'locations/1002' });
assert.equal(r.status, 404); ok('can’t audit a location you don’t manage');
r = await api('post', '/growth/audits').send({ location: L });
assert.equal(r.status, 200); assert.ok(['queued', 'running'].includes(r.body.status));
const job = await waitJob(r.body.id);
assert.equal(job.status, 'done', job.error); ok('audit runs as a background job with progress');
r = await api('get', `/growth/jobs/${r.body.id}`, B); assert.equal(r.status, 404); ok('another user can’t read your job');
r = await api('get', `/growth/audit?location=${L}`);
const audit = r.body.audit;
assert.ok(audit.overall > 0 && audit.overall < 100); assert.equal(audit.stats.reviewCount, 3); assert.equal(audit.stats.photos, 2);
assert.ok(audit.issues.some((i: any) => i.id === 'unanswered_negative')); assert.equal(r.body.history.length, 1);
assert.equal(r.body.profile.verification.state, 'verified'); assert.equal(r.body.profile.availableAttributes, 3);
ok(`audit uses Google data: ${audit.overall}/100, reviews, photos, attributes, verification`);

console.log('\n✏️  Approval-based changes');
r = await api('post', '/growth/changes').send({ location: L, patch: { description: 'Family dentist.' } });
assert.equal(r.status, 400); ok('a change identical to the profile is refused');
r = await api('post', '/growth/changes').send({ location: L, patch: { description: 'A new description for Acme Dental in Austin.', regularHours: [{ day: 'MONDAY', open: '08:00', close: '17:00' }] }, attributes: [{ name: 'has_restroom', valueType: 'BOOL', values: [true] }] });
assert.equal(r.status, 200); const chg = r.body;
assert.equal(chg.status, 'draft'); assert.deepEqual(chg.fields.map((f: any) => f.field).sort(), ['attributes', 'description', 'hours']);
assert.equal(g.state.patches.length, 0); ok('proposing a change shows a before/after diff and sends nothing to Google');
r = await api('post', `/growth/changes/${chg.id}/validate`).send({});
assert.equal(r.body.valid, true); assert.equal(g.state.lastPatch.validateOnly, true); ok('validate asks Google with validateOnly');
r = await api('post', `/growth/changes/${chg.id}/publish`).send({});
assert.equal(r.status, 400); ok('publishing needs explicit confirmation');
r = await api('post', `/growth/changes/${chg.id}/publish`, B).send({ confirm: true });
assert.equal(r.status, 404); ok('another user can’t publish your change');
const before = g.state.patches.length;
r = await api('post', `/growth/changes/${chg.id}/publish`).send({ confirm: true });
assert.equal(r.body.status, 'published', JSON.stringify(r.body));
const pub = g.state.patches.slice(before).find((p: any) => !p.validateOnly);
assert.match(pub.mask, /profile\.description/); assert.match(pub.mask, /regularHours/);
assert.equal(g.state.attrPatches[0].mask, 'attributes/has_restroom'); ok('confirmed publish sends only the masked fields and attributes to Google');
r = await api('post', `/growth/changes/${chg.id}/publish`).send({ confirm: true }); assert.equal(r.status, 409); ok('a change can’t be published twice');
r = await api('get', '/growth/categories?q=dent'); assert.ok(r.body.some((c: any) => c.name === 'categories/gcid:cosmetic_dentist')); ok('category search uses Google’s category list');

console.log('\n🖼️  Photos');
{
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20 * 1024, 1)]);
  const up = (buf: Buffer, fields: Record<string, string>, who = A, name = 'shop.jpg') => { let r = (request(app) as any).post('/api/local-seo/growth/photos').set(who); for (const [k, v] of Object.entries(fields)) r = r.field(k, v); return r.attach('file', buf, { filename: name, contentType: 'image/jpeg' }); };
  let r = await up(jpg, { location: L, category: 'EXTERIOR' });
  assert.equal(r.status, 400); assert.equal(g.state.created.length, 0); ok('upload without explicit confirmation is refused and nothing reaches Google');
  r = await up(Buffer.concat([Buffer.from('<?php '), Buffer.alloc(20 * 1024, 1)]), { location: L, category: 'EXTERIOR', confirm: 'true' }, A, 'x.jpg');
  assert.equal(r.status, 400); assert.equal(r.body.code, 'invalid_file'); ok('file type is checked from its bytes, not its name or MIME type');
  r = await up(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100)]), { location: L, category: 'EXTERIOR', confirm: 'true' });
  assert.equal(r.status, 400); assert.match(r.body.error, /10 KB/);
  r = await up(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 + 10)]), { location: L, category: 'EXTERIOR', confirm: 'true' });
  assert.equal(r.status, 413); ok('Google size limits (10 KB to 5 MB) are enforced before upload');
  r = await up(jpg, { location: 'locations/9999', category: 'EXTERIOR', confirm: 'true' }, B);
  assert.ok(r.status >= 400); assert.equal(g.state.created.length, 0); ok('cannot upload to a location you don’t manage');
  r = await up(jpg, { location: L, category: 'INTERIOR', confirm: 'true' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(g.state.created.length, 1);
  assert.equal(g.state.created[0].locationAssociation.category, 'INTERIOR'); assert.equal(g.state.created[0].upload.bytes, jpg.length); assert.equal(g.state.created[0].upload.type, 'image/jpeg');
  ok('confirmed upload runs start → bytes → create at Google with the chosen category');
  const prof = await api('get', `/growth/audit?location=${encodeURIComponent(L)}`);
  const created = g.state.created[0].name as string;
  r = await api('delete', '/growth/photos').send({ location: L, media: created });
  assert.equal(r.status, 400); ok('delete needs confirmation');
  r = await api('delete', '/growth/photos').send({ location: L, media: 'accounts/222/locations/5/media/m1', confirm: true });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'invalid_media'); ok('cannot delete media from another location');
  r = await api('delete', '/growth/photos').send({ location: L, media: created, confirm: true });
  assert.equal(r.status, 200); assert.ok(!(g.state.media.get('1001') ?? []).some((m: any) => m.name === created)); ok('confirmed delete removes the photo at Google');
  void prof;
}

console.log('\n🤖 AI optimizer, posts, assistant');
await api('get', `/growth/visibility?location=${L}`);
r = await api('post', '/growth/optimize').send({ location: L });
assert.equal(r.status, 200);
assert.deepEqual(r.body.categories.map((c: any) => c.displayName), ['Cosmetic dentist']); ok('AI category ideas are matched to real Google categories; unknown ones dropped');
assert.ok(!r.body.services.some((s: any) => s.name === 'Teeth cleaning')); ok('services already on the profile aren’t suggested again');
assert.equal(r.body.description.before, 'Family dentist.'); assert.match(r.body.description.after, /Austin/); ok('description shows Google’s current text (before) and the suggestion (after)');
assert.ok(prompts.at(-1)!.includes('dentist austin')); assert.ok(/Never suggest changing the business name/.test(prompts.at(-1)!)); ok('prompt is grounded in Google search terms and forbids name stuffing');
r = await api('post', '/growth/posts/calendar').send({ location: L, startDate: '2026-11-03' });
assert.equal(r.body.length, 8); assert.ok(r.body.every((p: any) => p.status === 'idea')); ok('30-day calendar creates ideas only (nothing published)');
const idea = r.body[0];
r = await api('post', `/growth/posts/${idea.id}/schedule`).send({ at: new Date(Date.now() - 3_600_000).toISOString() }); assert.equal(r.status, 400); ok('can’t schedule in the past');
r = await api('post', `/growth/posts/${idea.id}/schedule`).send({ at: new Date(Date.now() + 120_000).toISOString() });
assert.equal(r.body.status, 'scheduled'); assert.ok(r.body.approvedAt);
const { growth } = await import('../server/instance');
assert.equal(await growth.publishDuePosts('alice'), 0); ok('scheduled posts wait until their time');
r = await api('post', `/growth/posts/${r.body.id}/publish`).send({}); assert.equal(r.status, 400);
r = await api('post', `/growth/posts/${idea.id}/publish`).send({ confirm: true });
assert.equal(r.body.status, 'published'); assert.equal(g.state.posts.length, 1); ok('publishing a post needs confirmation and reaches Google');
r = await api('post', '/growth/posts/generate').send({ location: L, kind: 'update', details: 'Early Monday appointments' });
assert.match(r.body.summary, /early appointments/); ok('single post generation');
r = await api('post', '/growth/assistant').send({ location: L, message: 'What should I improve first?' });
assert.equal(r.body.actions[0].type, 'reply_reviews'); assert.ok(prompts.at(-1)!.includes('topIssues')); ok('assistant answers from audit data and suggests approvable actions');

console.log('\n🏪 Competitors (Places) & visibility');
r = await api('get', `/growth/competitors/search?location=${L}&q=dentist austin`);
assert.equal(r.body.length, 1); assert.equal(placesKeySeen, 'places-key-test'); assert.match(placesMask, /places\.rating/); ok('Places search uses the API key + field mask and hides your own listing');
r = await api('post', '/growth/competitors').send({ location: L, placeId: 'ChIJcompetitorAAAA1' });
assert.equal(r.body.rating, 4.9); assert.equal(r.body.source, 'places');
r = await api('post', '/growth/competitors').send({ location: L, name: 'Corner Dental', rating: 4.2, reviewCount: 40 });
assert.equal(r.body.source, 'manual'); ok('competitors can be added from Places or by hand');
r = await api('get', `/growth/competitors?location=${L}`, B); assert.equal(r.status, 404); ok('another user can’t see your competitors');
r = await api('post', '/growth/competitors/report').send({ location: L }); assert.ok(r.body.opportunities.length); ok('AI competitor report');
r = await api('get', `/growth/visibility?location=${L}`);
assert.equal(r.body.google.rows[0].keyword, 'dentist austin'); assert.equal(r.body.google.rows[1].threshold, 15); assert.equal(r.body.rankProvider.configured, false);
ok('visibility shows Google search terms (with thresholds) and says rank tracking needs a provider');

console.log('\n🛡️  Security & automation');
g.state.titleOverride = 'Acme Dental Downtown | Best Dentist Austin'; g.state.googleUpdated = true;
await api('post', '/growth/profile/refresh').send({ location: L });
r = await api('get', '/growth/security');
assert.ok(r.body.alerts.some((a: any) => a.kind === 'external_change' && /Business name/.test(a.message))); assert.ok(r.body.alerts.some((a: any) => a.kind === 'google_update'));
ok('detects changes made outside the app and changes made by Google');
assert.equal(r.body.connection.onlyRequiredScopes, true); assert.ok(!JSON.stringify(r.body).includes('ya29.')); assert.ok(!JSON.stringify(r.body).includes('1//'));
ok('security centre reports scopes and token expiry without exposing tokens');
assert.ok(r.body.accessHistory.some((a: any) => a.action.includes('/growth/changes'))); ok('account-changing requests are in the access log');
const writesBefore = { patches: g.state.patches.length, attrs: g.state.attrPatches.length, posts: g.state.posts.length, replies: g.state.replies.size };
r = await api('post', '/growth/automation/run').send({});
assert.ok(r.body.locations === 1);
r = await api('get', '/growth/inbox');
assert.ok(r.body.some((i: any) => i.kind === 'negative_review')); assert.ok(r.body.length > 0);
assert.deepEqual({ patches: g.state.patches.length, attrs: g.state.attrPatches.length, posts: g.state.posts.length, replies: g.state.replies.size }, writesBefore); ok('automation prepares inbox items and writes nothing to Google');
const item = r.body[0];
r = await api('post', `/growth/inbox/${item.id}`).send({ status: 'dismissed' }); assert.equal(r.body.status, 'dismissed');
r = await api('post', '/growth/automation/run').send({});
r = await api('get', '/growth/inbox'); assert.equal(r.body.find((i: any) => i.dedupeKey === item.dedupeKey)?.status, 'dismissed'); ok('dismissed items don’t reappear on the next run');

// Notification settings
r = await api('put', '/growth/automation').send({ notifications: { kinds: { content: false } } }); assert.equal(r.status, 200);
r = await api('get', '/growth/automation'); assert.equal(r.body.notifications.kinds.content, false); assert.equal(r.body.email, undefined); ok('saved notification preferences are readable (in-app only, no email)');
r = await api('put', '/growth/automation').send({ notifications: { email: true } }); assert.equal(r.status, 400); ok('email notification settings are no longer accepted');
r = await api('get', '/growth/automation', B); assert.notEqual(r.body.notifications.kinds.content, false); ok('notification settings are per account');
r = await api('post', '/growth/automation/test-email').send({}); assert.equal(r.status, 404); ok('no email endpoint');
r = await api('get', '/growth/dashboard');
assert.equal(r.body.locations[0].growthAudit.topIssues.length, 5); assert.ok(r.body.security.status); ok('dashboard has health, top 5 recommendations and security status');

console.log(`\n${passed} passed (growth)`);
g.close(); ps.close();
process.exit(0);
