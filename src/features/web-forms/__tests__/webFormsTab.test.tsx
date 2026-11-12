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
g.fetch = async (url: string) => {
  calls.push(String(url));
  const r = routes[String(url)];
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

console.log(`\n${passed} passed (website forms tab)`);
process.exit(0);
