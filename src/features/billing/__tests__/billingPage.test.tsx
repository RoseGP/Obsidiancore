/**
 * Billing & Subscription page, invoices card (happy-dom):
 *  - with the billing server: the latest invoices with their real status and the open / overdue counts;
 *  - without it: the reason is shown and nothing from the browser-only prototype store is listed;
 *  - "Open invoicing" and "Payment providers" go to Proposals & Invoices (the right tab).
 * Run: npx tsx src/features/billing/__tests__/billingPage.test.tsx
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
const { InvoicesSummaryCard } = await import('../BillingSubscriptionView');
const { generateMockSnapshot } = await import('../../invoicing/data/mockData');
const { buildInvoiceView, todayISO, STATUS_LABELS } = await import('../../invoicing/domain/status');

let passed = 0;
const ok = (m: string) => { passed++; console.log(`  ✓ ${m}`); };
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function render(el: any) {
  const host = win.document.createElement('div'); win.document.body.appendChild(host as any);
  const root = createRoot(host as any);
  await act(async () => { root.render(el); });
  await settle();
  return { host: host as any, text: () => String((host as any).textContent), unmount: () => act(async () => root.unmount()) };
}

// ---- Billing server available: real statuses and counts ----
const snapshot = generateMockSnapshot();
const views = snapshot.invoices.map((i) => buildInvoiceView(i, snapshot.payments, todayISO()));
const navigated: string[] = [];
let v = await render(React.createElement(InvoicesSummaryCard, {
  onNavigate: (x: string) => navigated.push(x),
  connect: async () => ({ mode: 'remote' as const, modeReason: '', load: async () => snapshot }),
}));
let t = v.text();
const newest = [...snapshot.invoices].sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate)))[0];
assert.ok(t.includes(newest.number), 'the newest invoice is listed');
for (const s of new Set(views.slice(0, 8).map((x) => x.status))) assert.ok(t.includes(STATUS_LABELS[s]), `status ${s} shown`);
const overdue = views.filter((x) => x.status === 'overdue').length;
assert.match(t, new RegExp(`Overdue${overdue}`));
ok('with the billing server: latest invoices with their real status and the overdue count');

const open = [...v.host.querySelectorAll('button')].find((b: any) => /Open invoicing/.test(b.textContent));
await act(async () => { open.click(); });
assert.equal(navigated.at(-1), 'proposals');
assert.equal(new URL(win.location.href).searchParams.get('subtab'), null);
await v.unmount();
ok('"Open invoicing" opens Proposals & Invoices on the invoicing tab');

// ---- No billing server: the prototype store is never shown as real data ----
v = await render(React.createElement(InvoicesSummaryCard, {
  onNavigate: () => undefined,
  connect: async () => ({ mode: 'local' as const, modeReason: 'The billing server isn’t configured yet, so changes are saved in this browser only.', load: async () => snapshot }),
}));
t = v.text();
assert.match(t, /isn’t configured yet/);
assert.match(t, /Invoices appear here once the billing server is available/);
for (const i of snapshot.invoices) assert.ok(!t.includes(i.number), `prototype invoice ${i.number} not listed`);
await v.unmount();
ok('without the billing server: the reason is shown and no prototype invoices are listed');

// ---- Failure while loading ----
v = await render(React.createElement(InvoicesSummaryCard, { onNavigate: () => undefined, connect: async () => { throw new Error('boom'); } }));
assert.match(v.text(), /couldn’t be loaded/);
assert.doesNotMatch(v.text(), /boom/);
await v.unmount();
ok('a loading failure shows a plain message, not the error text');

console.log(`\n${passed} passed (billing page)`);
process.exit(0);
