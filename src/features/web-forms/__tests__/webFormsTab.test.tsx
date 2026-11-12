/**
 * Website Forms and Local SEO are two separate tabs (happy-dom):
 *  - the app navigation lists each once, as its own page;
 *  - Local SEO's own sidebar no longer contains a forms route;
 *  - the Website Forms page works on its own: no Local SEO provider, no Google connection, and it only calls
 *    /api/web-forms (never /api/local-seo); loading, ready, 403 and error states render.
 * Run: npx tsx src/features/web-forms/__tests__/webFormsTab.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost/', width: 1280, height: 900 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Node: win.Node, Element: win.Element,
  Event: win.Event, MouseEvent: win.MouseEvent, localStorage: win.localStorage, getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { NAV_GROUPS } = await import('../../../components/DynamicSidebar');
const { Sidebar } = await import('../../../components/localpilot/layout/Sidebar');
const { WebFormsView } = await import('../WebFormsView');

let passed = 0;
const ok = (m: string) => { passed++; console.log(`  ✓ ${m}`); };
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function render(el: any) {
  const host = win.document.createElement('div'); win.document.body.appendChild(host as any);
  const root = createRoot(host as any);
  await act(async () => { root.render(el); });
  await settle();
  return { host: host as any, text: () => String((host as any).textContent), unmount: () => act(async () => root.unmount()) };
}

// ---- Navigation: two distinct tabs ----
const ids = NAV_GROUPS.flatMap((grp) => grp.items.map((i) => i.id));
assert.equal(ids.filter((i) => i === 'gbp').length, 1);
assert.equal(ids.filter((i) => i === 'web_forms').length, 1);
const label = (id: string) => NAV_GROUPS.flatMap((grp) => grp.items).find((i) => i.id === id)!.label;
assert.equal(label('gbp'), 'Local SEO'); assert.equal(label('web_forms'), 'Website Forms');
ok('app navigation lists Local SEO and Website Forms once each, as separate pages');

const side = await render(React.createElement(Sidebar, { currentRoute: 'dashboard', onRouteChange: () => {} }));
assert.ok(side.text().includes('Reviews'));
assert.ok(!/website forms/i.test(side.text()), 'no forms route inside Local SEO');
await side.unmount();
ok('Local SEO\'s sidebar has only Google Business Profile pages');

// ---- Website Forms page on its own ----
const calls: string[] = [];
type Reply = { status: number; body: unknown } | 'network';
let routes: Record<string, Reply> = {};
const posts: Array<{ url: string; body: any }> = [];
g.fetch = async (url: string, init?: RequestInit) => {
  calls.push(String(url));
  if (init?.method === 'POST') posts.push({ url: String(url), body: JSON.parse(String(init.body || '{}')) });
  const r = routes[`${init?.method || 'GET'} ${url}`] ?? routes[String(url)];
  if (!r || r === 'network') throw new TypeError('Failed to fetch');
  return { ok: r.status < 400, status: r.status, json: async () => r.body } as any;
};
const config = {
  formId: 'wf_AAAAAAAAAAAAAAAA', allowedOrigins: ['https://www.example.com'], redirectUrl: null,
  destinations: { obsidian: true, webhook: false }, webhook: null, captcha: null, updatedAt: '2026-11-12T10:00:00.000Z',
};
const endpoint = 'https://crm.example.test/api/web-forms/f/wf_AAAAAAAAAAAAAAAA';
routes = {
  '/api/web-forms/config': { status: 200, body: { success: true, config, endpoint, appUrlConfigured: true } },
  '/api/web-forms/submissions': { status: 200, body: { success: true, submissions: [] } },
};
let page = await render(React.createElement(WebFormsView));
assert.ok(page.text().includes('Website forms'));
assert.ok(page.text().includes('1. Add the form to your website'));
assert.ok(page.text().includes(endpoint), 'the real endpoint is shown in the form code');
assert.ok(page.text().includes('https://www.example.com'));
assert.ok(page.text().includes('No submissions yet'));
assert.ok(calls.length > 0 && calls.every((c) => c.startsWith('/api/web-forms/')), 'only the web forms API');
await page.unmount();
ok('Website Forms renders without Local SEO or Google, calling only /api/web-forms');

calls.length = 0;
routes = { '/api/web-forms/config': { status: 403, body: { success: false, code: 'forbidden', error: 'Not allowed.' } } };
page = await render(React.createElement(WebFormsView));
assert.ok(page.text().includes('managed by your organization\'s admins'));
await page.unmount();
routes = { '/api/web-forms/config': 'network' };
page = await render(React.createElement(WebFormsView));
assert.ok(page.text().includes('Website forms couldn\'t load.'));
assert.ok(page.text().includes('Try again'));
await page.unmount();
ok('no access and server-unreachable states are shown instead of a blank page');

// ---- Send a test submission + log filter ----
const { checkTestFields } = await import('../TestSubmissionPanel');
assert.deepEqual(Object.keys(checkTestFields({ name: 'A', email: 'x', phone: 'abc' })).sort(), ['email', 'name', 'phone']);
assert.deepEqual(checkTestFields({ name: 'Ada Lee', email: 'ada@example.com', phone: '+1 555 0100' }), {});

const sample = [
  { id: 's1', at: '2026-11-12T10:00:00.000Z', status: 'accepted', reason: null, formName: 'Contact page', originHost: 'www.example.com', deliveries: [{ adapter: 'obsidian', status: 'delivered', attempts: 1, at: '' }, { adapter: 'webhook', status: 'failed', attempts: 3, detail: 'The webhook answered 500.', at: '' }] },
  { id: 's2', at: '2026-11-12T09:00:00.000Z', status: 'spam', reason: 'honeypot', formName: 'Contact page', originHost: null, deliveries: [] },
];
let logBody: any = { success: true, submissions: sample };
routes = {
  '/api/web-forms/config': { status: 200, body: { success: true, config, endpoint, appUrlConfigured: true } },
  '/api/web-forms/submissions': { status: 200, body: logBody },
  'POST /api/web-forms/try': { status: 200, body: { success: true, result: { status: 'accepted', reason: null, visitorMessage: 'Thank you! We received your message and will get back to you soon.', deliveries: [{ adapter: 'obsidian', status: 'delivered', attempts: 1, detail: 'New lead created.' }] } } },
};
let opened = 0;
page = await render(React.createElement(WebFormsView, { onOpenLeads: () => { opened++; } }));
const host = page.host as any;
const btn = (label: string) => [...host.querySelectorAll('button')].find((b: any) => b.textContent.trim().startsWith(label)) as any;
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as any); }); await settle(); };
assert.ok(btn('Delivery problems (1)'), 'filter counts');
await click(btn('Spam (1)'));
assert.ok(page.text().includes('Spam blocked') && !page.text().includes('The webhook answered 500.'), 'spam filter shows only spam rows');
await click(btn('Delivery problems (1)'));
assert.ok(page.text().includes('The webhook answered 500.'));
await click(btn('Duplicates (0)'));
assert.ok(page.text().includes('Nothing here for this filter.'));
ok('submissions log filters by result and delivery problems, with counts and an empty-filter state');

const form = [...host.querySelectorAll('form')].find((f: any) => f.textContent.includes('Send test')) as any;
await act(async () => { form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }) as any); }); await settle();
assert.equal(posts.length, 0, 'nothing is sent while required fields are missing');
assert.ok(page.text().includes('Please enter your name.') && page.text().includes('Please enter a valid email address.'));
const setVal = async (el: any, v: string) => {
  const proto = Object.getPrototypeOf(el); const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => { setter.call(el, v); el.dispatchEvent(new win.Event('input', { bubbles: true }) as any); });
};
const inputs = [...form.querySelectorAll('input')] as any[];
await setVal(inputs[0], 'Ada Lee'); await setVal(inputs[1], 'ada@example.com');
const before = calls.filter((c) => c === '/api/web-forms/submissions').length;
await act(async () => { form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }) as any); }); await settle();
assert.equal(posts.at(-1)!.url, '/api/web-forms/try');
assert.equal(posts.at(-1)!.body.name, 'Ada Lee'); assert.equal(posts.at(-1)!.body.consent, true);
assert.ok(page.text().includes('Received.') && page.text().includes('CRM: delivered') && page.text().includes('New lead created.'));
assert.ok(calls.filter((c) => c === '/api/web-forms/submissions').length > before, 'the log refreshes after a test');
await click(btn('Open the lead in Sales Pipeline'));
assert.equal(opened, 1);
ok('test submission: validated before sending, result and deliveries shown, log refreshed, link to the lead');

routes['POST /api/web-forms/try'] = { status: 400, body: { success: false, code: 'invalid_input', error: 'Please check the highlighted fields.', fields: [{ field: 'phone', message: 'Please enter a valid phone number.' }] } };
await act(async () => { form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }) as any); }); await settle();
assert.ok(page.text().includes('Please enter a valid phone number.'), 'server field errors appear next to the field');
routes['POST /api/web-forms/try'] = { status: 403, body: { success: false, code: 'forbidden', error: 'Forbidden' } };
await act(async () => { form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }) as any); }); await settle();
assert.ok(page.text().includes('Only owners and admins can send test submissions.'));
await page.unmount();
ok('test submission: server field errors and no-permission answers are shown');

console.log(`\n${passed} passed (website forms tab)`);
process.exit(0);
