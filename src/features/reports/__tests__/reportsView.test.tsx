/**
 * Reports & Analytics page rendered in happy-dom against the real /api/reports routes (in-memory store):
 * the empty state shows no invented numbers, the populated state shows the server's figures with a
 * "How this is calculated" disclosure for every section, a deal action opens the pipeline on that deal, and a role
 * without report access sees a clear message.
 * Run: npx tsx src/features/reports/__tests__/reportsView.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import express from 'express';
import type { AddressInfo } from 'node:net';

Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });
const { MemoryDocStore, setDocStore } = await import('../../../server/data/docStore');
const store = new MemoryDocStore(); setDocStore(store);
const { guard, PUBLIC } = await import('../../../server/routeGuards');
const reports = (await import('../../../routes/reportsApi')).default;
const { addMember } = await import('../../../server/__tests__/fixtures');
const server = express(); server.use(express.json());
server.use('/api/reports', guard(PUBLIC.none), reports);
const http = server.listen(0);
const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
const nodeFetch = globalThis.fetch;

const win = new Window({ url: 'http://localhost/', width: 390, height: 900 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement,
  HTMLTextAreaElement: win.HTMLTextAreaElement, HTMLSelectElement: win.HTMLSelectElement, Node: win.Node, Element: win.Element, Event: win.Event,
  CustomEvent: win.CustomEvent, KeyboardEvent: win.KeyboardEvent, MouseEvent: win.MouseEvent, FocusEvent: win.FocusEvent, localStorage: win.localStorage,
  getComputedStyle: win.getComputedStyle.bind(win), requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;
let user = 'ivy';
g.fetch = (url: string, init: any = {}) => nodeFetch(`${base}${url}`, { ...init, headers: { ...(init.headers || {}), 'X-Dev-User-Id': user } });
(win as any).fetch = g.fetch;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ReportsView = (await import('../ReportsView')).default;

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const text = () => document.body.textContent || '';
const wait = async (cond: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return; await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }
  throw new Error(`Timed out waiting for: ${what}\n${text().slice(0, 1500)}`);
};
const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const host = document.createElement('div'); document.body.appendChild(host);
const root = createRoot(host as any);
const navigations: string[] = [];
const render = async () => { await act(async () => { root.render(React.createElement(ReportsView, { onNavigate: (v: string) => navigations.push(v) })); }); };

// ---- Empty organization ----
user = 'ivy';
await render();
await wait(() => text().includes('No open deals to forecast') && text().includes('No customers to segment yet') && text().includes('Nothing to act on') && text().includes('No deals yet') && text().includes('No leads yet'), 'empty states');
assert.ok(!/\$[1-9]/.test(text()), `no invented amounts in the empty state:\n${text().match(/.{40}\$[1-9].{20}/)?.[0]}`);
assert.ok(!/NaN|undefined|Infinity/.test(text()));
assert.match(text(), /Low confidence/);
assert.match(text(), /No deals were won in the last 3 months/);
assert.equal(document.querySelectorAll('details summary').length >= 5, true);
ok('empty organization: every section shows an empty state, a low-confidence badge and no invented amounts');
await act(async () => { root.render(React.createElement('div')); });

// ---- Populated organization ----
user = 'olivia';
await nodeFetch(`${base}/api/reports/forecast`, { headers: { 'X-Dev-User-Id': 'olivia' } }); // creates olivia's workspace
const orgId = (await store.get('crm_user_memberships/olivia')).defaultOrgId;
const O = `organizations/${orgId}`;
const now = Date.now(), DAY = 86_400_000, iso = (d: number) => new Date(now + d * DAY).toISOString();
for (let i = 0; i < 5; i++) await store.set(`${O}/deals/won${i}`, { id: `won${i}`, name: `Won ${i}`, stage: 'won', value: 1000, contactId: 'c_ann', createdAt: iso(-60 - i), closedAt: iso(-10 - i) });
await store.set(`${O}/deals/open1`, { id: 'open1', name: 'Big renewal', stage: 'negotiation', value: 40000, expectedClose: iso(5).slice(0, 10), createdAt: iso(-20), stageEnteredAt: iso(-2) });
await store.set(`${O}/deals/open2`, { id: 'open2', name: 'Old quote', stage: 'qualified', value: 3000, expectedClose: iso(-12).slice(0, 10), createdAt: iso(-60), stageEnteredAt: iso(-4) });
await store.set(`${O}/contacts/c_ann`, { id: 'c_ann', name: 'Ann Archer', email: 'ann@archer.test' });
await store.set(`${O}/leads/l1`, { id: 'l1', name: 'Lee', source: 'referral', status: 'new' });
const api = await (await nodeFetch(`${base}/api/reports/forecast?months=3`, { headers: { 'X-Dev-User-Id': 'olivia' } })).json();

await render();
await wait(() => text().includes('Big renewal') && text().includes('Ann Archer') && text().includes('Referral'), 'populated report');
assert.match(text(), /Expected/); assert.ok(text().includes(usd(api.total.expected)), `expected ${usd(api.total.expected)} on the page`);
assert.ok(text().includes(usd(api.total.commit))); assert.ok(text().includes(usd(api.total.pipeline)));
assert.ok(text().includes(`${usd(api.total.low)}–${usd(api.total.high)}`), 'the 80% range is shown');
assert.match(text(), /Medium confidence/); // 5 closed deals: enough for history, fewer than 20
assert.ok(text().includes(`you won ${usd(api.history.total)} in the last 3 months`));
ok('populated: the forecast tiles show the server’s expected, commit, pipeline and range');
assert.ok(text().includes('Update the close date or mark it lost'));
assert.ok(text().includes('Champions') && text().includes('Prospects'));
assert.ok(document.querySelectorAll('details summary').length >= 6);
for (const s of [...document.querySelectorAll('details summary')].filter((x) => x.textContent === 'How this is calculated')) assert.ok(s.parentElement!.textContent!.length > 60);
ok('populated: deal actions, segments and lead sources render, each section with a “How this is calculated” disclosure');

const actionBtn = [...document.querySelectorAll('button')].find((b) => /Update the close date or mark it lost: Old quote/.test(b.getAttribute('aria-label') || '')) as HTMLButtonElement;
assert.ok(actionBtn, 'deal action button');
await act(async () => { actionBtn.click(); });
assert.deepEqual(navigations, ['deals']); assert.equal(new URL(win.location.href).searchParams.get('deal'), 'open2');
ok('clicking a deal action opens the pipeline on that deal');
await act(async () => { root.render(React.createElement('div')); });

// ---- Role without report access ----
await addMember(orgId, 'sam', 'SUPPORT_AGENT');
user = 'sam';
await render();
await wait(() => text().includes('Your role can’t view reports'), 'role message');
assert.ok(!/\$[1-9]/.test(text()));
ok('a role without report access sees a clear message, not numbers');

await act(async () => { root.unmount(); });
http.close();
console.log(`\n${passed} passed (reports page)`);
process.exit(0);
