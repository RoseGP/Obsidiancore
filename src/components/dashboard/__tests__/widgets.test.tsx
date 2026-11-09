/**
 * Dashboard widgets render this organization's real numbers (or an honest empty state), never invented ones.
 * The real /api/dashboard router runs in process on the in-memory store; the widgets render in happy-dom.
 * Run: npx tsx src/components/dashboard/__tests__/widgets.test.tsx
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
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;
console.warn = () => {}; // recharts warns about zero-size containers in happy-dom

const { MemoryDocStore, setDocStore } = await import('../../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../../server/routeGuards');
const dashboardRouter = (await import('../../../routes/dashboardApi')).default;
const app = express(); app.use(express.json());
app.use('/api/dashboard', guard(PUBLIC.none), dashboardRouter);

let user = 'olivia';
g.fetch = async (url: string, init: any = {}) => {
  const method = String(init.method || 'GET').toLowerCase();
  let r = (request(app) as any)[method](String(url)).set('X-Dev-User-Id', user);
  if (init.body) r = r.set('Content-Type', 'application/json').send(JSON.parse(init.body));
  const res = await r;
  return { ok: res.status < 400, status: res.status, json: async () => res.body };
};

const React = (await import('react')).default;
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const { SalesPerformanceWidget } = await import('../SalesPerformanceWidget');
const { OpenOpportunitiesWidget } = await import('../OpenOpportunitiesWidget');
const { RecentLeadsWidget } = await import('../RecentLeadsWidget');
const { SupportTicketsWidget } = await import('../SupportTicketsWidget');

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function render(el: any) {
  const host = win.document.createElement('div'); win.document.body.appendChild(host as any);
  const root = createRoot(host as any);
  await act(async () => { root.render(el); });
  await settle();
  return { host, text: () => String((host as any).textContent), unmount: () => act(async () => root.unmount()) };
}
const INVENTED = /366,500|\$38,500|16 days|\+28% YoY|34\.8%|68% Win|94\.2%|98\.4%|\+34%|4\.8 \/ hr|1\.2m|4\.9|Alex Rivera|Elena Rostova|Liam Vance|\$45,000 ARR|lead@example\.com/;

// ---- Empty organization: honest empty states, no invented numbers ----
for (const [name, el] of [
  ['sales', React.createElement(SalesPerformanceWidget, {})],
  ['opportunities', React.createElement(OpenOpportunitiesWidget, {})],
  ['leads', React.createElement(RecentLeadsWidget, { contacts: [] })],
  ['tickets', React.createElement(SupportTicketsWidget, {})],
] as const) {
  const v = await render(el);
  assert.doesNotMatch(v.text(), INVENTED, `${name} shows an invented figure`);
  await v.unmount();
}
let v = await render(React.createElement(SalesPerformanceWidget, {}));
assert.match(v.text(), /\$0/); assert.match(v.text(), /No deals won in the last 4 weeks/); assert.match(v.text(), /Win rate: —/);
await v.unmount();
v = await render(React.createElement(RecentLeadsWidget, { contacts: [] }));
assert.match(v.text(), /No leads yet/);
await v.unmount();
ok('an empty organization sees zeros and empty states, not sample numbers');

// ---- Real deals: figures computed from them ----
const orgId = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
const now = Date.now(), iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const deal = (id: string, value: number, stage: string, createdAgo: number, updatedAgo: number, owner = 'Olivia') =>
  store.set(`organizations/${orgId}/deals/${id}`, { id, orgId, name: `Deal ${id}`, client: 'Acme', value, stage, probability: 50, owner, createdAt: iso(createdAgo), updatedAt: iso(updatedAgo) });
const DAY = 86_400_000;
await deal('w1', 10000, 'won', 12 * DAY, 2 * DAY);
await deal('w2', 30000, 'won', 6 * DAY, 1 * DAY, 'Sam');
await deal('l1', 5000, 'lost', 5 * DAY, 3 * DAY);
await deal('o1', 20000, 'proposal', 2 * DAY, 2 * DAY);
await deal('old', 99999, 'won', 400 * DAY, 300 * DAY);
// Records were written straight to the store (not through the API), so drop the dashboard's short-lived cache, as Refresh does.
const { invalidateDashboard } = await import('../../../lib/dashboardData');
invalidateDashboard();

v = await render(React.createElement(SalesPerformanceWidget, {}));
let t = v.text();
assert.match(t, /\$40,000/, 'closed revenue = two recent won deals');
assert.match(t, /Avg deal: \$20,000/);
assert.match(t, /Win rate: 66\.7%/);
assert.match(t, /Sam/); assert.match(t, /Olivia/);
assert.ok(t.indexOf('Sam') < t.indexOf('Olivia'), 'top closer first');
assert.doesNotMatch(t, /99,999/);
assert.doesNotMatch(t, INVENTED);
await v.unmount();
ok('sales performance = won deals in the period (revenue, average, win rate, top closers)');

v = await render(React.createElement(OpenOpportunitiesWidget, {}));
t = v.text();
assert.match(t, /1 open deal(?!s)/); assert.match(t, /\$20,000/); assert.match(t, /75% win rate/);
assert.doesNotMatch(t, INVENTED);
// "Next stage" really moves the deal on the server (it used to send an empty body and fail).
const btn = [...(v.host as any).querySelectorAll('button')].find((b: any) => /Next stage/.test(b.textContent));
assert.ok(btn);
await act(async () => { btn.click(); }); await settle();
assert.equal((await store.get(`organizations/${orgId}/deals/o1`)).stage, 'negotiation');
assert.match(v.text(), /negotiation/i);
await v.unmount();
ok('open opportunities count only open deals; win rate is won ÷ (won + lost); Next stage saves');

// ---- Leads and tickets ----
await store.set(`organizations/${orgId}/leads/ld1`, { id: 'ld1', name: 'Ada Lovelace', company: 'Acme', source: 'web', status: 'new', createdAt: iso(DAY) });
await store.set(`organizations/${orgId}/leads/ld2`, { id: 'ld2', name: 'Grace Hopper', source: 'email', status: 'new', score: 70, createdAt: iso(9 * DAY) });
v = await render(React.createElement(RecentLeadsWidget, { contacts: [] }));
t = v.text();
assert.match(t, /Ada Lovelace/); assert.match(t, /Grace Hopper/); assert.ok(t.indexOf('Ada') < t.indexOf('Grace'), 'newest first');
assert.match(t, /1 lead(?!s)/); assert.match(t, /\+0% vs last week/); assert.match(t, /70\/100/);
assert.doesNotMatch(t, /Score 85|Enterprise Account/);
await v.unmount();
ok('recent leads: real names, newest first, week-over-week from capture dates, no default score or company');

await store.set(`organizations/${orgId}/tickets/t1`, { id: 't1', customerName: 'Ada', subject: 'Login help', priority: 'critical', status: 'open', channel: 'email', createdAt: iso(3 * 3600_000) });
v = await render(React.createElement(SupportTicketsWidget, {}));
t = v.text();
assert.match(t, /Login help/); assert.match(t, /3h old/); assert.doesNotMatch(t, INVENTED); assert.doesNotMatch(t, /undefinedm SLA|NaN/);
await v.unmount();
ok('support tickets show their real age instead of an invented SLA rate');

// ---- Isolation: another organization sees none of it ----
user = 'bea';
v = await render(React.createElement(SalesPerformanceWidget, {}));
assert.doesNotMatch(v.text(), /\$40,000|Sam/);
await v.unmount();
ok('another organization sees none of these figures');

console.log(`\n${passed} passed (dashboard widgets)`);
process.exit(0);
