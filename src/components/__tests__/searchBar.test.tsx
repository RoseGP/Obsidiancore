/**
 * Global search shows only real records and real destinations: the organization's deals (from the
 * dashboard API), the sidebar's own labels, and no hardcoded sample deals, tasks or recent searches.
 * Run: npx tsx src/components/__tests__/searchBar.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import express from 'express';
import request from 'supertest';

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });
const win = new Window({ url: 'http://localhost/', width: 1280, height: 800 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Node: win.Node, Element: win.Element,
  Event: win.Event, localStorage: win.localStorage, getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;

const { MemoryDocStore, setDocStore } = await import('../../server/data/docStore');
setDocStore(new MemoryDocStore());
const { guard, PUBLIC } = await import('../../server/routeGuards');
const dashboardRouter = (await import('../../routes/dashboardApi')).default;
const app = express(); app.use(express.json());
app.use('/api/dashboard', guard(PUBLIC.none), dashboardRouter);
g.fetch = async (url: string, init: any = {}) => {
  const method = String(init.method || 'GET').toLowerCase();
  let r = (request(app) as any)[method](String(url)).set('X-Dev-User-Id', 'olivia');
  if (init.body) r = r.set('Content-Type', 'application/json').send(JSON.parse(init.body));
  const res = await r;
  return { ok: res.status < 400, status: res.status, json: async () => res.body };
};

// A real deal in this organization.
const created = await request(app).post('/api/dashboard/deals').set('X-Dev-User-Id', 'olivia').send({ name: 'Harbor website rebuild', client: 'Harbor Bakery', value: 6400, stage: 'proposal' });
assert.equal(created.status, 201);

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const UnifiedCommandSearchBar = (await import('../UnifiedCommandSearchBar')).default;

const settle = async (ms = 5) => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const navigated: string[] = [];
const host = win.document.createElement('div'); win.document.body.appendChild(host as any);
const root = createRoot(host as any);
await act(async () => {
  root.render(React.createElement(UnifiedCommandSearchBar, {
    themeMode: 'dark', contacts: [], events: [], activeView: 'dashboard',
    setActiveView: (v: string) => navigated.push(v), onSelectContact: () => {},
  } as any));
});
const input = host.querySelector('input') as any;
const type = async (text: string) => {
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { input.focus(); setter.call(input, text); input.dispatchEvent(new win.Event('input', { bubbles: true })); });
  await settle(60);
};
const text = () => String(host.textContent);
const FAKE = /Acme Corp|Sarah Jenkins|Apex Telecom|Lumina Tech|Elena Rostova|Marcus Vance|SLA Proposal|Revised DPA|Run System AI Intelligence Sync/;

await type('a');
assert.doesNotMatch(text(), FAKE);
await type('sarah');
assert.doesNotMatch(text(), FAKE);
ok('no hardcoded sample deals, tasks, actions or recent searches');

await type('harbor');
assert.match(text(), /Harbor website rebuild/);
assert.match(text(), /\$6,400/);
ok("the organization's real deals are searchable");

await type('pipeline');
assert.match(text(), /Sales Pipeline & Deals/);
await type('copilot');
assert.match(text(), /AI Copilot/);
ok('navigation results use the sidebar labels');

const dealBtn = [...host.querySelectorAll('button')].find((b: any) => /Harbor website rebuild/.test(b.textContent)) as any;
await type('harbor');
const btn = [...host.querySelectorAll('button')].find((b: any) => /Harbor website rebuild/.test(b.textContent)) as any;
assert.ok(btn || dealBtn);
await act(async () => { (btn || dealBtn).click(); });
assert.equal(navigated.at(-1), 'deals');
ok('opening a deal goes to the Sales Pipeline');

await act(async () => root.unmount());
console.log(`\nsearch bar: ${passed} checks passed`);
process.exit(0);
