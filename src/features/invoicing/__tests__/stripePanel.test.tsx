/**
 * "Collect with Stripe" panel (happy-dom, fetch mocked): loading, couldn't load + retry, not set up on the server,
 * not connected, can't collect (reason), create draft, explicit confirmation before finalize + email, payment
 * failure, pay link, Stripe ids, test-mode label, and the CRM invoice reloaded after sending.
 * Run: npx tsx src/features/invoicing/__tests__/stripePanel.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost/', width: 1280, height: 900 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Node: win.Node, Element: win.Element,
  Event: win.Event, MouseEvent: win.MouseEvent, KeyboardEvent: win.KeyboardEvent, localStorage: win.localStorage, getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { StripeCollectPanel } = await import('../components/StripeCollectPanel');

let passed = 0; const ok = (m: string) => { passed++; console.log(`  ✓ ${m}`); };
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };

// ---- fetch mock: a tiny Stripe-backed server ----
type Inv = any;
let server: { configured: boolean; connected: boolean; blocker: string | null; invoices: Inv[]; failGet?: number } = { configured: true, connected: true, blocker: null, invoices: [] };
const calls: string[] = [];
let gate: Promise<void> | null = null;
g.fetch = async (url: string, init: any = {}) => {
  const method = (init.method || 'GET').toUpperCase();
  calls.push(`${method} ${url}`);
  if (gate) await gate;
  const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body });
  if (method === 'GET' && url.startsWith('/api/integrations/stripe/billing-invoices/')) {
    if (server.failGet) { server.failGet--; return json(500, { success: false, error: 'The server had a problem. Try again.' }); }
    return json(200, { success: true, configured: server.configured, mode: 'test', account: { connected: server.connected, accountId: 'acct_A', businessName: 'Harbor Pine (test)' }, invoices: server.invoices, blocker: server.blocker, balanceDue: '268647', currency: 'USD' });
  }
  if (method === 'POST' && url.startsWith('/api/integrations/stripe/billing-invoices/')) {
    server.invoices = [{ id: 'inv_1', status: 'draft', provider_invoice_id: 'in_000123', provider_customer_id: 'cus_000045', currency: 'USD', total: 2686.47, amount_due_minor: 268647, created_at: '2026-11-12T10:00:00Z', updated_at: '2026-11-12T10:00:00Z' }];
    return json(201, { success: true, invoice: server.invoices[0] });
  }
  if (method === 'POST' && url.endsWith('/send')) {
    server.invoices = [{ ...server.invoices[0], status: 'open', hosted_invoice_url: 'https://invoice.stripe.test/in_000123', sent_at: '2026-11-12T10:05:00Z' }];
    return json(200, { success: true, invoice: server.invoices[0] });
  }
  return json(404, { success: false, error: 'not found' });
};

async function mount(onCrmChanged?: () => void) {
  const host = win.document.createElement('div'); win.document.body.appendChild(host as any);
  const root = createRoot(host as any);
  await act(async () => { root.render(React.createElement(StripeCollectPanel, { billingInvoiceId: 'billinv_1', onCrmChanged })); });
  return { host: host as any, text: () => String(win.document.body.textContent), unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const click = async (el: any) => { await act(async () => { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }); await settle(); };
const button = (label: RegExp) => Array.from(win.document.querySelectorAll('button')).find((b: any) => label.test(String(b.textContent))) as any;

// Loading, then error with retry.
let release!: () => void; gate = new Promise<void>((r) => { release = r; });
server.failGet = 1;
let v = await mount();
assert.match(v.text(), /Checking Stripe…/);
assert.equal(v.host.querySelector('section').getAttribute('aria-busy'), 'true');
gate = null; release(); await settle();
assert.match(v.text(), /Couldn’t load the Stripe status/); assert.ok(v.host.querySelector('[role="alert"]'));
await click(button(/^Retry$/));
assert.doesNotMatch(v.text(), /Couldn’t load/); assert.match(v.text(), /Create Stripe invoice/);
await v.unmount();
ok('loading state, then an error with Retry that recovers');

// Not set up on the server / not connected / can't collect.
server = { configured: false, connected: false, blocker: null, invoices: [] };
v = await mount(); await settle();
assert.match(v.text(), /Stripe isn’t set up on this server/); assert.equal(button(/Create Stripe invoice/), undefined);
await v.unmount();
server = { configured: true, connected: false, blocker: null, invoices: [] };
v = await mount(); await settle();
assert.ok(button(/Connect Stripe/)); assert.equal(button(/Create Stripe invoice/), undefined);
await v.unmount();
server = { configured: true, connected: true, blocker: 'Add the client’s email address: Stripe emails the invoice to it.', invoices: [] };
v = await mount(); await settle();
assert.match(v.text(), /Can’t collect this invoice with Stripe yet/); assert.match(v.text(), /client’s email address/); assert.equal(button(/Create Stripe invoice/), undefined);
await v.unmount();
ok('not set up on the server, not connected (Connect Stripe), and can’t-collect reasons are shown; no create button then');

// Create a draft → confirm → send. Nothing is sent before the confirmation.
server = { configured: true, connected: true, blocker: null, invoices: [] };
let reloaded = 0;
v = await mount(() => { reloaded++; }); await settle();
assert.match(v.text(), /Test mode/); assert.match(v.text(), /\$2,686\.47/);
calls.length = 0;
await click(button(/Create Stripe invoice/));
assert.ok(calls.some((c) => c === 'POST /api/integrations/stripe/billing-invoices/billinv_1'));
assert.match(v.text(), /Draft in Stripe/); assert.match(v.text(), /in_000123/); assert.match(v.text(), /cus_000045/);
await click(button(/Finalize & email via Stripe/));
const dialog = win.document.querySelector('[role="dialog"]') as any;
assert.ok(dialog, 'confirmation dialog'); assert.match(String(dialog.textContent), /can’t change afterwards/);
assert.ok(!calls.some((c) => c.endsWith('/send')), 'nothing sent before confirming');
await click(Array.from(dialog.querySelectorAll('button')).find((b: any) => /Finalize & email/.test(String(b.textContent))));
assert.ok(calls.some((c) => c === 'POST /api/integrations/invoices/inv_1/send'));
assert.match(v.text(), /Sent · awaiting payment/);
const link = v.host.querySelector('a[href="https://invoice.stripe.test/in_000123"]');
assert.ok(link); assert.equal(link.getAttribute('rel'), 'noopener noreferrer'); assert.equal(link.getAttribute('target'), '_blank');
assert.equal(reloaded, 1, 'CRM invoice reloaded after sending');
await v.unmount();
ok('create draft → explicit confirmation → finalize & email; Stripe ids, pay link and test-mode label shown; CRM reloaded');

// Payment failure and paid states.
server = { configured: true, connected: true, blocker: null, invoices: [{ id: 'inv_1', status: 'open', provider_invoice_id: 'in_000123', currency: 'USD', total: 10, amount_due_minor: 1000, payment_failure: { message: 'A payment attempt failed.', at: '2026-11-12T11:00:00Z' }, created_at: '2026-11-12T10:00:00Z', updated_at: '2026-11-12T11:00:00Z' }] };
v = await mount(); await settle();
assert.match(v.text(), /Payment failed/); assert.match(v.text(), /A payment attempt failed/); assert.ok(button(/Email again/)); assert.ok(button(/Void/));
await v.unmount();
server.invoices = [{ ...server.invoices[0], status: 'paid', payment_failure: null, amount_paid_minor: 1000, paid_at: '2026-11-12T12:00:00Z' }];
v = await mount(); await settle();
assert.match(v.text(), /Paid in Stripe/); assert.doesNotMatch(v.text(), /Payment failed/); assert.equal(button(/Email again|Finalize/), undefined);
await v.unmount();
ok('payment failure alert with retry options; paid state without send actions');

console.log(`\n${passed} passed (Stripe panel)`);
process.exit(0);
