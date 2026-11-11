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
const { SupportTicketsWidget } = await import('../SupportTicketsWidget');
// Sales performance, open opportunities and recent leads widgets were removed from the dashboard as duplicates
// of Business Performance and Needs Your Attention (their figures are tested in the dashboard metrics suite).

const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function render(el: any) {
  const host = win.document.createElement('div'); win.document.body.appendChild(host as any);
  const root = createRoot(host as any);
  await act(async () => { root.render(el); });
  await settle();
  return { host, text: () => String((host as any).textContent), unmount: () => act(async () => root.unmount()) };
}
const INVENTED = /94\.2%|98\.4%|undefinedm SLA|NaN|Alex Rivera|Elena Rostova|Liam Vance/;

let v = await render(React.createElement(SupportTicketsWidget, {}));
assert.doesNotMatch(v.text(), INVENTED);
await v.unmount();
ok('an empty organization sees an empty state, not sample tickets');

const orgId = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
await store.set(`organizations/${orgId}/tickets/t1`, { id: 't1', customerName: 'Ada', subject: 'Login help', priority: 'critical', status: 'open', channel: 'email', createdAt: iso(3 * 3600_000) });
const { invalidateDashboard } = await import('../../../lib/dashboardData');
invalidateDashboard();
v = await render(React.createElement(SupportTicketsWidget, {}));
const t = v.text();
assert.match(t, /Login help/); assert.match(t, /3h old/); assert.doesNotMatch(t, INVENTED);
await v.unmount();
ok('support tickets show their real age instead of an invented SLA rate');

user = 'bea';
invalidateDashboard();
v = await render(React.createElement(SupportTicketsWidget, {}));
assert.doesNotMatch(v.text(), /Login help/);
await v.unmount();
ok('another organization sees none of these tickets');

console.log(`\n${passed} passed (dashboard widgets)`);
process.exit(0);
