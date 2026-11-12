/**
 * Website forms → CRM: validation and sanitization, spam and duplicates, allowed websites and CORS, HTML form
 * posts, the built-in CRM adapter, the signed webhook adapter (signature, retries, SSRF protection), secrets
 * never returned, the delivery log without personal data, and admin access per organization and role.
 * Run: npx tsx src/server/webforms/__tests__/webForms.test.ts
 */
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';

Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory', WEBFORM_ALLOW_PRIVATE_WEBHOOKS: 'true', WEBFORM_RETRY_DELAY_MS: '5', WEBFORM_IP_LIMIT: '1000', APP_URL: 'https://crm.example.test' });
const { MemoryDocStore, setDocStore } = await import('../../data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../routeGuards');
const { errorHandler, requestContext } = await import('../../http/middleware');
const { setLogSinkForTests } = await import('../../http/logger');
const wf = await import('../service');
const { verifySignature } = await import('../adapters');
const { isPrivateAddress, safePostJson } = await import('../safeHttp');
const { SubmissionSchema, spamVerdict, clean } = await import('../submission');
const { setTurnstileVerifierForTests } = await import('../turnstile');
const { makeOrg, addMember, as } = await import('../../__tests__/fixtures');
await import('../../http/installAsyncErrors');
const logs: string[] = [];
setLogSinkForTests((l) => logs.push(l));

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };

const app = express();
app.use(requestContext()); app.use(express.json()); app.use(express.urlencoded({ extended: false }));
app.use('/api/web-forms', guard(PUBLIC.webForms), (await import('../../../routes/webFormsApi')).default);
app.use(errorHandler());

const A = await makeOrg('owner_a'); const B = await makeOrg('owner_b');
await addMember(A.id, 'mgr', 'MANAGER'); await addMember(A.id, 'rep', 'SALES_REP');
const cfgA = await wf.getConfig(A.id);
const cfgB = await wf.getConfig(B.id);
const submit = (formId: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => request(app).post(`/api/web-forms/f/${formId}`).set(headers).send(body);
const old = () => Date.now() - 10_000; // the form was shown 10 s ago
const leadsOf = (org: string) => store.list(`organizations/${org}/leads`);
const logOf = (org: string) => store.list(`organizations/${org}/web_form_submissions`);

// ---- Validation and sanitization ----
{
  let r = await submit(cfgA.formId, { name: 'A', email: 'nope', _ts: old() });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'invalid_input');
  assert.deepEqual(r.body.fields.map((f: any) => f.field).sort(), ['email', 'name']);
  assert.ok(!JSON.stringify(r.body).includes('nope'), 'input is not echoed back');
  r = await submit(cfgA.formId, { name: 'Ann Lee', email: 'ann@x.test', phone: 'call me maybe', _ts: old() });
  assert.equal(r.status, 400); assert.equal(r.body.fields[0].field, 'phone');
  const s = SubmissionSchema.parse({ name: '  Ann\u0000 ​Lee  ', email: ' ANN@Example.COM ', message: 'Line 1\r\n\r\n\r\n\r\nLine 2‮', extra: 'ignored' });
  assert.equal(s.name, 'Ann Lee'); assert.equal(s.email, 'ann@example.com'); assert.equal(s.message, 'Line 1\n\nLine 2‮'.replace('‮', '‮'));
  assert.ok(!('extra' in s), 'unknown fields are dropped');
  assert.equal(clean('a'.repeat(500), 120).length, 120);
  ok('validation: required fields, formats, lengths; control and zero-width characters stripped; unknown fields dropped; input not echoed');
}

// ---- Accepted → built-in CRM; no personal data in the log ----
{
  const r = await submit(cfgA.formId, { name: 'Ann Lee', email: 'ann@lee.test', phone: '+1 555 0100', company: 'Lee & Co', message: 'Need a quote for 3 offices.', pageUrl: 'https://www.lee.example/contact', formName: 'Contact page', consent: 'true', marketingOptIn: 'false', _ts: old() });
  assert.equal(r.status, 200); assert.equal(r.body.success, true); assert.ok(!('leadId' in r.body), 'no CRM ids for anonymous callers');
  const leads = await leadsOf(A.id);
  assert.equal(leads.length, 1); assert.equal(leads[0].email, 'ann@lee.test'); assert.equal(leads[0].source, 'website');
  assert.equal((await leadsOf(B.id)).length, 0, 'only the form\'s own organization');
  const log = await logOf(A.id);
  assert.equal(log[0].status, 'accepted'); assert.equal(log[0].deliveries[0].status, 'delivered');
  const raw = JSON.stringify(log);
  for (const pii of ['ann@lee.test', 'Ann Lee', '555 0100', 'quote']) assert.ok(!raw.includes(pii), `log contains ${pii}`);
  assert.ok(log[0].expireAt > log[0].at, 'log entries carry an expiry');
  const consents = await store.list(`organizations/${A.id}/consents`);
  assert.deepEqual(consents.map((c: any) => `${c.purpose}:${c.status}`).sort(), ['data_processing:granted', 'marketing_email:withdrawn']);
  assert.ok(!logs.join('\n').includes('ann@lee.test'), 'server logs don\'t contain the email');
  ok('accepted submission → lead in the right organization; consents recorded; log has no name, email, phone or message');
}

// ---- Duplicates and spam ----
{
  const body = { name: 'Ann Lee', email: 'ann@lee.test', message: 'Need a quote for 3 offices.', formName: 'Contact page', _ts: old() };
  const r = await submit(cfgA.formId, body);
  assert.equal(r.status, 200); assert.equal(r.body.success, true);
  const lead = (await leadsOf(A.id))[0];
  assert.equal((lead.notes.match(/Web Re-engagement/g) || []).length, 0, 'a double submit doesn\'t append the same inquiry again');
  assert.ok((await logOf(A.id)).some((x: any) => x.status === 'duplicate'));

  const before = (await leadsOf(A.id)).length;
  for (const spam of [
    { name: 'Bot', email: 'bot@x.test', _hp: 'http://spam', _ts: old() },
    { name: 'Fast Bot', email: 'fast@x.test', _ts: Date.now() - 500 },
    { name: 'Linky', email: 'l@x.test', message: 'http://a http://b http://c www.d', _ts: old() },
    { name: 'Tags', email: 't@x.test', message: '<a href="x">cheap</a>', _ts: old() },
  ]) {
    const s = await submit(cfgA.formId, spam);
    assert.equal(s.status, 200); assert.equal(s.body.success, true, 'spam looks like success to the bot');
  }
  assert.equal((await leadsOf(A.id)).length, before, 'spam never reaches the CRM');
  assert.deepEqual((await logOf(A.id)).filter((x: any) => x.status === 'spam').map((x: any) => x.reason).sort(), ['honeypot', 'markup', 'too_fast', 'too_many_links']);
  assert.equal(spamVerdict({}, SubmissionSchema.parse({ name: 'Real Person', email: 'r@x.test', message: 'See https://my.site please' })).spam, false);
  ok('duplicates (double clicks) and spam (honeypot, too fast, link-stuffed, markup) get a normal response but aren\'t sent on');
}

// ---- Unknown forms and allowed websites (CORS) ----
{
  assert.equal((await submit('wf_doesnotexist1234', { name: 'X Y', email: 'x@y.test' })).status, 404);
  assert.equal((await submit('not-a-form-id', { name: 'X Y', email: 'x@y.test' })).status, 404);
  await wf.updateConfig(A.id, { allowedOrigins: ['https://www.lee.example', 'https://lee.example/'] });
  const pre = await request(app).options(`/api/web-forms/f/${cfgA.formId}`).set('Origin', 'https://www.lee.example').set('Access-Control-Request-Method', 'POST');
  assert.equal(pre.status, 204); assert.equal(pre.headers['access-control-allow-origin'], 'https://www.lee.example');
  const preBad = await request(app).options(`/api/web-forms/f/${cfgA.formId}`).set('Origin', 'https://evil.example');
  assert.equal(preBad.headers['access-control-allow-origin'], undefined);
  const bad = await submit(cfgA.formId, { name: 'Eve E', email: 'eve@x.test', _ts: old() }, { Origin: 'https://evil.example' });
  assert.equal(bad.status, 403); assert.equal(bad.body.code, 'origin_not_allowed');
  const good = await submit(cfgA.formId, { name: 'Bo Ng', email: 'bo@ng.test', _ts: old() }, { Origin: 'https://lee.example' });
  assert.equal(good.status, 200); assert.equal(good.headers['access-control-allow-origin'], 'https://lee.example');
  await assert.rejects(wf.updateConfig(A.id, { allowedOrigins: ['ftp://x'] }), (e: any) => e.code === 'invalid_origin');
  await assert.rejects(wf.updateConfig(A.id, { allowedOrigins: ['http://insecure.example'] }), (e: any) => e.code === 'invalid_origin');
  ok('unknown form ids → 404; only allowed websites get CORS and may submit from a browser; origins validated');
}

// ---- HTML form posts ----
{
  let r = await request(app).post(`/api/web-forms/f/${cfgA.formId}`).type('form').send({ name: 'Cy Doe', email: 'cy@doe.test', _ts: String(old()) });
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /html/); assert.match(r.text, /Thank you!/);
  r = await request(app).post(`/api/web-forms/f/${cfgA.formId}`).type('form').send({ name: '<script>alert(1)</script>', email: 'bad' });
  assert.equal(r.status, 400); assert.ok(!r.text.includes('<script>alert'), 'no reflected markup'); assert.match(r.text, /valid email/);
  await wf.updateConfig(A.id, { redirectUrl: 'https://www.lee.example/thanks' });
  r = await request(app).post(`/api/web-forms/f/${cfgA.formId}`).type('form').send({ name: 'Di Doe', email: 'di@doe.test', _ts: String(old()) });
  assert.equal(r.status, 303); assert.equal(r.headers.location, 'https://www.lee.example/thanks?form_status=ok');
  r = await request(app).post(`/api/web-forms/f/${cfgA.formId}`).type('form').send({ name: 'D', email: 'x' });
  assert.equal(r.status, 303); assert.match(r.headers.location, /form_status=error&form_error=invalid_input/);
  await assert.rejects(wf.updateConfig(A.id, { redirectUrl: 'javascript:alert(1)' }), (e: any) => e.code === 'invalid_redirect');
  ok('plain HTML forms: escaped confirmation/error pages, or a redirect to the https thank-you page');
}

// ---- Webhook adapter ----
{
  const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  let failFirst = 1;
  const hook = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      received.push({ headers: req.headers, body: b });
      if (failFirst-- > 0) { res.statusCode = 503; return res.end('busy'); }
      res.statusCode = 204; res.end();
    });
  });
  await new Promise<void>((r) => hook.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hooks/crm`;

  const res = await request(app).put('/api/web-forms/config').set(as('owner_a', A.id)).send({ webhookUrl: url, destinations: { webhook: true } });
  assert.equal(res.status, 200, JSON.stringify(res.body)); assert.match(res.body.webhookSecret, /^whsec_/);
  const secret = res.body.webhookSecret as string;
  assert.ok(!JSON.stringify(res.body.config).includes(secret), 'config never includes the secret');
  const stored = JSON.stringify(await store.get(`organizations/${A.id}/settings/web_forms`));
  assert.ok(!stored.includes(secret), 'the secret is encrypted at rest');
  const get = await request(app).get('/api/web-forms/config').set(as('owner_a', A.id));
  assert.ok(!JSON.stringify(get.body).includes(secret) && get.body.config.webhook.secretHint.endsWith('…'));

  const r = await submit(cfgA.formId, { name: 'Ed Wu', email: 'ed@wu.test', message: 'Hello', formName: 'Footer', _ts: old() });
  assert.equal(r.status, 200);
  await wf.flushDeliveries();
  assert.equal(received.length, 2, 'retried after a 503');
  const last = received[1];
  assert.ok(verifySignature(secret, last.body, String(last.headers['x-obsidian-signature'])), 'valid HMAC signature');
  assert.ok(!verifySignature('whsec_wrong', last.body, String(last.headers['x-obsidian-signature'])));
  assert.ok(!verifySignature(secret, last.body.replace('Ed Wu', 'Mallory'), String(last.headers['x-obsidian-signature'])), 'tampered body fails');
  const payload = JSON.parse(last.body);
  assert.equal(payload.event, 'form.submission'); assert.equal(payload.version, 1); assert.equal(payload.contact.email, 'ed@wu.test'); assert.equal(payload.form.name, 'Footer'); assert.equal(payload.isTest, false);
  assert.equal(last.headers['x-obsidian-delivery'], payload.id);
  const entry = (await logOf(A.id)).find((x: any) => x.id === payload.id);
  assert.deepEqual(entry.deliveries.map((d: any) => `${d.adapter}:${d.status}:${d.attempts}`).sort(), ['obsidian:delivered:1', 'webhook:delivered:2']);
  ok('webhook: signed JSON (HMAC-SHA256 over timestamp.body), retried on 5xx, results in the log; secret shown once, encrypted at rest');

  const t = await request(app).post('/api/web-forms/webhook/test').set(as('owner_a', A.id));
  assert.equal(t.status, 200); assert.equal(t.body.result.ok, true);
  assert.equal(JSON.parse(received.at(-1)!.body).isTest, true);
  ok('test delivery sends a clearly marked test payload');

  // Built-in CRM off, webhook only (provider-neutral).
  await request(app).put('/api/web-forms/config').set(as('owner_a', A.id)).send({ destinations: { obsidian: false } });
  const nLeads = (await leadsOf(A.id)).length;
  await submit(cfgA.formId, { name: 'Fay Ox', email: 'fay@ox.test', _ts: old() });
  await wf.flushDeliveries();
  assert.equal((await leadsOf(A.id)).length, nLeads);
  assert.equal(JSON.parse(received.at(-1)!.body).contact.email, 'fay@ox.test');
  const none = await request(app).put('/api/web-forms/config').set(as('owner_a', A.id)).send({ destinations: { webhook: false } });
  assert.equal(none.status, 400); assert.equal(none.body.code, 'no_destination');
  await request(app).put('/api/web-forms/config').set(as('owner_a', A.id)).send({ destinations: { obsidian: true } });
  ok('the built-in CRM can be turned off (webhook only); at least one destination must stay on');

  const rot = await request(app).post('/api/web-forms/webhook/rotate-secret').set(as('owner_a', A.id));
  assert.notEqual(rot.body.webhookSecret, secret);
  hook.close();
  ok('the signing secret can be rotated');
}

// ---- SSRF protection ----
{
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
  await assert.rejects(safePostJson('https://127.0.0.1/x', '{}', {}), (e: any) => e.code === 'blocked_address');
  await assert.rejects(safePostJson('https://169.254.169.254/latest/meta-data', '{}', {}), (e: any) => e.code === 'blocked_address');
  await assert.rejects(safePostJson('http://example.com/x', '{}', {}), (e: any) => e.code === 'invalid_url');
  await assert.rejects(safePostJson('https://user:pw@example.com/x', '{}', {}), (e: any) => e.code === 'invalid_url');
  const prev = process.env.WEBFORM_ALLOW_PRIVATE_WEBHOOKS; process.env.WEBFORM_ALLOW_PRIVATE_WEBHOOKS = 'false';
  const r = await request(app).put('/api/web-forms/config').set(as('owner_b', B.id)).send({ webhookUrl: 'http://10.0.0.5/hook' });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'invalid_webhook_url');
  process.env.WEBFORM_ALLOW_PRIVATE_WEBHOOKS = prev;
  ok('webhooks: https only, no credentials in URLs, private/metadata addresses refused (DNS pinned to the checked address)');
}

// ---- Admin access ----
{
  assert.equal((await request(app).get('/api/web-forms/config')).status, 401);
  assert.equal((await request(app).get('/api/web-forms/submissions')).status, 401);
  assert.equal((await request(app).get('/api/web-forms/config').set(as('rep', A.id))).status, 403, 'roles without settings access');
  const m = await request(app).get('/api/web-forms/config').set(as('mgr', A.id));
  assert.equal(m.status, 200); assert.equal(m.body.config.formId, cfgA.formId); assert.equal(m.body.endpoint, `https://crm.example.test/api/web-forms/f/${cfgA.formId}`);
  assert.equal((await request(app).put('/api/web-forms/config').set(as('mgr', A.id)).send({ allowedOrigins: [] })).status, 403, 'managers can view, not change');
  assert.equal((await request(app).get('/api/web-forms/config').set(as('owner_b', A.id))).status, 403, 'another organization\'s owner');
  const b = await request(app).get('/api/web-forms/submissions').set(as('owner_b', B.id));
  assert.equal(b.status, 200); assert.equal(b.body.submissions.length, 0, 'B sees none of A\'s log');
  const a = await request(app).get('/api/web-forms/submissions').set(as('owner_a', A.id));
  assert.ok(a.body.submissions.length > 5); assert.ok(!JSON.stringify(a.body).includes('@lee.test'));
  assert.equal((await request(app).put('/api/web-forms/config').set(as('owner_a', A.id)).send({ unexpected: 1 })).status, 400);
  ok('settings: signed-in only; managers view, owners/admins change; each organization sees only its own');

  const rot = await request(app).post('/api/web-forms/form-id/rotate').set(as('owner_a', A.id));
  assert.notEqual(rot.body.config.formId, cfgA.formId);
  assert.equal((await submit(cfgA.formId, { name: 'Old Form', email: 'o@f.test', _ts: old() })).status, 404, 'the old form id stops working');
  assert.equal((await submit(rot.body.config.formId, { name: 'New Form', email: 'n@f.test', _ts: old() }, { Origin: 'https://lee.example' })).status, 200);
  ok('rotating the form id disables the old one');

  const before = (await wf.recentSubmissions(A.id, 200)).length;
  const purged = await wf.purgeExpiredSubmissions(A.id, Date.now() + 31 * 86_400_000);
  assert.equal(purged, before, 'every entry is past 30 days');
  assert.equal((await wf.recentSubmissions(A.id)).length, 0);
  assert.ok((await wf.recentSubmissions(B.id)).length >= 0);
  ok('the submission log is deleted after 30 days');
  void cfgB;
}

{
  // Cloudflare Turnstile: optional, verified on the server, secret never returned
  const calls: Array<{ secret: string; token: string; ip?: string }> = [];
  let mode: 'pass' | 'reject' | 'down' | 'other-host' = 'pass';
  setTurnstileVerifierForTests(async (secret, token, ip) => {
    calls.push({ secret, token, ip });
    if (mode === 'down') throw new Error('network');
    if (mode === 'reject') return { success: false, 'error-codes': ['invalid-input-response'] };
    return { success: true, hostname: mode === 'other-host' ? 'evil.example' : 'shop.example' };
  });
  const SITE = '0x4AAAAAAAtestSiteKey00'; const SECRET = '0x4AAAAAAAtestSecretKey_abcdEFGH';
  const put = (body: object, who = 'owner_b') => request(app).put('/api/web-forms/config').set(as(who, B.id)).send(body);
  assert.equal((await put({ turnstile: { siteKey: SITE } })).body.code, 'turnstile_secret_missing');
  assert.equal((await put({ turnstile: { siteKey: 'bad key!', secretKey: SECRET } })).status, 400);
  const on = await put({ turnstile: { siteKey: SITE, secretKey: SECRET }, allowedOrigins: ['https://shop.example'] });
  assert.equal(on.status, 200);
  assert.equal(on.body.config.captcha.siteKey, SITE);
  assert.ok(!JSON.stringify(on.body).includes(SECRET), 'secret key never returned');
  assert.ok(!JSON.stringify((await request(app).get('/api/web-forms/config').set(as('owner_b', B.id))).body).includes(SECRET));
  assert.ok(!JSON.stringify(await store.get(`organizations/${B.id}/settings/web_forms`)).includes(SECRET), 'stored encrypted');
  ok('Turnstile keys: secret required, validated, encrypted at rest and never returned');

  const o = { Origin: 'https://shop.example' };
  const r1 = await submit(cfgB.formId, { name: 'No Token', email: 'nt@b.test', _ts: old() }, o);
  assert.equal(r1.status, 400); assert.equal(r1.body.code, 'captcha_failed');
  assert.equal(calls.length, 0, 'no token → no call to Cloudflare');
  mode = 'reject';
  assert.equal((await submit(cfgB.formId, { name: 'Bad Token', email: 'bt@b.test', _ts: old(), 'cf-turnstile-response': 'tok-bad' }, o)).body.code, 'captcha_failed');
  mode = 'other-host';
  assert.equal((await submit(cfgB.formId, { name: 'Other Host', email: 'oh@b.test', _ts: old(), 'cf-turnstile-response': 'tok-x' }, o)).body.code, 'captcha_failed', 'token solved on another site');
  mode = 'down';
  const r4 = await submit(cfgB.formId, { name: 'Cf Down', email: 'cd@b.test', _ts: old(), 'cf-turnstile-response': 'tok-y' }, o);
  assert.equal(r4.status, 503); assert.equal(r4.body.code, 'captcha_unavailable');
  mode = 'pass';
  const r5 = await submit(cfgB.formId, { name: 'Good Token', email: 'gt@b.test', _ts: old(), 'cf-turnstile-response': 'tok-good' }, o);
  assert.equal(r5.status, 200);
  assert.equal(calls.at(-1)!.secret, SECRET, 'the decrypted secret is sent to Cloudflare');
  assert.ok((await leadsOf(B.id)).some((l: any) => l.email === 'gt@b.test'));
  assert.ok(!(await leadsOf(B.id)).some((l: any) => l.email === 'bt@b.test' || l.email === 'nt@b.test'));
  assert.ok(!logs.join('\n').includes('tok-good') && !logs.join('\n').includes(SECRET), 'tokens and secrets never logged');
  ok('Turnstile: missing, rejected or other-site tokens → 400; Cloudflare down → 503 (fails closed); valid → lead');

  assert.equal((await put({ turnstile: null })).body.config.captcha, null);
  assert.equal((await submit(cfgB.formId, { name: 'After Off', email: 'ao@b.test', _ts: old() }, o)).status, 200);
  await addMember(B.id, 'mgr_b', 'MANAGER');
  assert.equal((await put({ turnstile: { siteKey: SITE, secretKey: SECRET } }, 'mgr_b')).status, 403, 'a manager of this organization');
  setTurnstileVerifierForTests(null);
  ok('Turnstile can be turned off; only owners/admins change it');
}

{
  // The form code shown to owners stays in sync with what the endpoint accepts
  const { htmlSnippet, fetchSnippet, reactSnippet } = await import('../../../features/web-forms/snippets');
  const ts = (await import('typescript')).default;
  const fields = Object.keys(SubmissionSchema.shape);
  const ep = 'https://crm.example.test/api/web-forms/f/wf_AAAAAAAAAAAAAAAA';
  for (const [kind, make] of [['html', htmlSnippet], ['js', fetchSnippet], ['react', reactSnippet]] as const) {
    for (const key of [null, '0x4AAAAAAAtestSiteKey00']) {
      const code = make(ep, key);
      for (const f of fields) assert.ok(code.includes(`name="${f}"`), `${kind} snippet has ${f}`);
      assert.ok(code.includes(ep));
      assert.equal(code.includes('cf-turnstile'), !!key, `${kind}: Turnstile widget only when configured`);
      assert.ok(!/secret/i.test(code), 'no secret in browser code');
    }
  }
  const out = ts.transpileModule(reactSnippet(ep, '0x4AAAAAAAtestSiteKey00'), { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 }, fileName: 'ContactForm.tsx' });
  assert.equal(out.diagnostics?.length ?? 0, 0, 'React example is valid TSX');
  ok('form code: every accepted field, Turnstile only when on, no secrets, React example compiles');
}

setLogSinkForTests(null);
console.log(`\n${passed} passed (web forms)`);
process.exit(0);
