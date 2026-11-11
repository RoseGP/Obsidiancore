/**
 * Contacts, Companies and Tasks screens rendered in happy-dom against the real API routes (in-memory store):
 * empty states, creating records, the duplicate warning with "Save anyway", the profile drawer and timeline,
 * completing a task, and the dashboard "tasks today" card.
 * Run: npx tsx src/features/crm-records/__tests__/views.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import express from 'express';
import type { AddressInfo } from 'node:net';

Object.assign(process.env, { NODE_ENV: 'test', SOCIAL_ACCOUNTS_DEV_AUTH: 'true', CRM_STORE: 'memory' });
const { MemoryDocStore, setDocStore } = await import('../../../server/data/docStore');
setDocStore(new MemoryDocStore());
const { guard, PUBLIC } = await import('../../../server/routeGuards');
const { contactsRouter, companiesRouter } = await import('../../../routes/contactsApi');
const tasksRouter = (await import('../../../routes/tasksApi')).default;
const server = express(); server.use(express.json());
server.use('/api/contacts', guard(PUBLIC.none), contactsRouter);
server.use('/api/companies', guard(PUBLIC.none), companiesRouter);
server.use('/api/tasks', guard(PUBLIC.none), tasksRouter);
server.get('/api/orgs/current/members', (_q, r) => r.json({ success: true, members: [] }));
const http = server.listen(0);
const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
const nodeFetch = globalThis.fetch;

// ---- DOM ----
const win = new Window({ url: 'http://localhost/', width: 1280, height: 900 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement,
  HTMLTextAreaElement: win.HTMLTextAreaElement, HTMLSelectElement: win.HTMLSelectElement, Node: win.Node, Element: win.Element, Event: win.Event,
  CustomEvent: win.CustomEvent, KeyboardEvent: win.KeyboardEvent, MouseEvent: win.MouseEvent, FocusEvent: win.FocusEvent, localStorage: win.localStorage,
  getComputedStyle: win.getComputedStyle.bind(win), requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;
// The screens call fetch('/api/…'): send it to the test server as a signed-in member.
g.fetch = (url: string, init: any = {}) => nodeFetch(`${base}${url}`, { ...init, headers: { ...(init.headers || {}), 'X-Dev-User-Id': 'olivia' } });
(win as any).fetch = g.fetch;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ContactsView, CompaniesView, TasksView, TasksDueCard } = await import('../index');

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const wait = async (cond: () => boolean, what: string, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return; await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }
  throw new Error(`Timed out waiting for: ${what}\n${document.body.textContent?.slice(0, 800)}`);
};
const text = () => document.body.textContent || '';
const button = (label: string | RegExp) => [...document.querySelectorAll('button')].find((b) => (typeof label === 'string' ? (b.textContent || '').trim() === label || b.getAttribute('aria-label') === label : label.test(b.textContent || '') || label.test(b.getAttribute('aria-label') || ''))) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined, what: string) => { assert.ok(el, `missing ${what}`); await act(async () => { (el as any).click(); }); };
const type = async (el: Element | null | undefined, value: string) => {
  assert.ok(el, 'missing input');
  const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new win.Event('input', { bubbles: true }) as any); });
};
const field = (label: string) => [...document.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(label))?.querySelector('input,textarea,select') ?? null;

const host = document.createElement('div'); document.body.appendChild(host);
const root = createRoot(host as any);

// ---- Tasks ----
await act(async () => { root.render(React.createElement(TasksView, {})); });
await wait(() => text().includes('No tasks here.'), 'tasks empty state');
ok('Tasks: empty state with a "New task" action');
await click(button('New task'), 'new task');
await type(field('Title'), 'Call Hana about the renewal');
const due = new Date(Date.now() - 3600_000); const p = (n: number) => String(n).padStart(2, '0');
await type(field('Due'), `${due.getFullYear()}-${p(due.getMonth() + 1)}-${p(due.getDate())}T${p(due.getHours())}:${p(due.getMinutes())}`);
await click(button('Add task'), 'add task');
await wait(() => text().includes('Call Hana about the renewal') && text().includes('Overdue'), 'task listed as overdue');
assert.match(text(), /1 overdue/);
ok('Tasks: create a task; it shows as overdue and the header counts it');
await click(button(/Mark “Call Hana about the renewal” done/), 'complete');
await wait(() => !text().includes('Call Hana about the renewal'), 'completed task leaves My tasks');
await click([...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Done'), 'done tab');
await wait(() => text().includes('Call Hana about the renewal'), 'task under Done');
ok('Tasks: completing moves it to Done');
await act(async () => { root.render(React.createElement('div')); });

// ---- Dashboard card ----
const r1 = await g.fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Send the proposal', dueDate: new Date(Date.now() - 60_000).toISOString() }) });
assert.equal(r1.status, 201);
await act(async () => { root.render(React.createElement(TasksDueCard, {})); });
await wait(() => text().includes('Send the proposal'), 'dashboard card');
ok('Dashboard card lists my overdue and due-today tasks');
await act(async () => { root.render(React.createElement('div')); });

// ---- Contacts ----
await act(async () => { root.render(React.createElement(ContactsView, {})); });
await wait(() => text().includes('No contacts yet.'), 'contacts empty state');
await click(button('New contact'), 'new contact');
await type(field('Name'), 'Hana Lee');
await type(field('Email'), 'hana@acme.test');
await click(button('Add contact'), 'add contact');
await wait(() => !!document.querySelector('[aria-labelledby="contact-profile-title"]') && text().includes('Contact created'), 'profile drawer with timeline');
ok('Contacts: create a contact; its profile opens with the timeline');
await click(button('Close'), 'close drawer');
await click(button('New contact'), 'new contact again');
await type(field('Name'), 'H. Lee');
await type(field('Email'), 'HANA@acme.test');
await click(button('Add contact'), 'add duplicate');
await wait(() => !!button('Save anyway') && text().includes('Same email'), 'duplicate warning');
ok('Contacts: a duplicate email is flagged, with "Open" and "Save anyway"');
await click(button('Save anyway'), 'save anyway');
await wait(() => text().includes('1 possible duplicate'), 'duplicates button');
await act(async () => { root.render(React.createElement('div')); });
ok('Contacts: "Save anyway" keeps both and the possible-duplicates button appears');

// ---- Companies ----
await act(async () => { root.render(React.createElement(CompaniesView, {})); });
await wait(() => text().includes('No companies yet.'), 'companies empty state');
await click(button('New company'), 'new company');
await type(field('Name'), 'Acme Inc');
await type(field('Website'), 'https://www.acme.test');
await click(button('Add company'), 'add company');
await wait(() => !!document.querySelector('[aria-labelledby="company-profile-title"]') && text().includes('acme.test') && text().includes('Company created'), 'company profile');
ok('Companies: create a company; its profile opens with totals and timeline');

await act(async () => { root.unmount(); });
http.close();
console.log(`\n${passed} passed (crm record screens)`);
process.exit(0);
