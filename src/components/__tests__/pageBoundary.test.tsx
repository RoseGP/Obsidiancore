/**
 * PageBoundary + lazyPage (happy-dom): a lazily loaded page shows a loading state then renders; a page that
 * throws shows an error instead of blanking the app, and the boundary resets when the user navigates; a
 * missing chunk after a deploy reloads once (not in a loop) and otherwise shows "reload the page".
 * Run: npx tsx src/components/__tests__/pageBoundary.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost/', width: 1280, height: 900 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Node: win.Node, Element: win.Element,
  Event: win.Event, MouseEvent: win.MouseEvent, localStorage: win.localStorage, sessionStorage: win.sessionStorage,
  getComputedStyle: win.getComputedStyle.bind(win),
  requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { PageBoundary, lazyPage, isChunkLoadError } = await import('../PageBoundary');

let passed = 0;
const ok = (m: string) => { passed++; console.log(`  ✓ ${m}`); };
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
const quiet = console.error; console.error = () => {}; // React logs caught render errors; they're expected here

const host = win.document.createElement('div'); win.document.body.appendChild(host as any);
const root = createRoot(host as any);
const text = () => String((host as any).textContent);
const show = async (el: any) => { await act(async () => { root.render(el); }); await settle(); };

// Lazy page: loading state, then the page.
let resolvePage!: (m: any) => void;
const Slow = lazyPage(() => new Promise<any>((res) => { resolvePage = res; }));
await act(async () => { root.render(<PageBoundary resetKey="a"><Slow /></PageBoundary>); });
assert.match(text(), /Loading/); assert.ok((host as any).querySelector('[role="status"]'));
await act(async () => { resolvePage({ default: () => <p>Deals page</p> }); }); await settle();
assert.equal(text(), 'Deals page');
ok('lazy page: accessible loading state (role=status), then the page');

// A page that throws: an error (role=alert) instead of a blank app; navigating away resets the boundary.
const Broken = () => { throw new Error('boom'); };
await show(<PageBoundary resetKey="tasks"><Broken /></PageBoundary>);
assert.match(text(), /Something went wrong while showing this page/); assert.ok((host as any).querySelector('[role="alert"]'));
assert.ok(!text().includes('boom'), 'internal error text is not shown');
await show(<PageBoundary resetKey="calendar"><p>Calendar page</p></PageBoundary>);
assert.equal(text(), 'Calendar page');
ok('a crashing page shows an error (no internal details) and the boundary resets when navigating');

// Chunk errors: recognized across browsers; one reload, then the message instead of a loop.
assert.ok(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js')));
assert.ok(isChunkLoadError(new TypeError('error loading dynamically imported module')));
assert.ok(isChunkLoadError(new TypeError('Importing a module script failed.')));
assert.ok(!isChunkLoadError(new Error('boom')));
let reloads = 0;
Object.defineProperty(win.location, 'reload', { value: () => { reloads++; }, configurable: true });
const missing = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/Old.js'));
win.sessionStorage.removeItem('obsidian:chunk-reload-at');
const Gone1 = lazyPage(missing);
await show(<PageBoundary resetKey="x1"><Gone1 /></PageBoundary>);
assert.equal(reloads, 1, 'first failure reloads to pick up the new build'); assert.match(text(), /Loading/);
const Gone2 = lazyPage(missing);
await show(<PageBoundary resetKey="x2"><Gone2 /></PageBoundary>);
assert.equal(reloads, 1, 'no second reload within a minute (no loop)');
assert.match(text(), /couldn’t be loaded\. A new version may have been released/);
ok('a missing chunk after a deploy reloads once, then asks the user to reload (no reload loop)');

await act(async () => root.unmount());
console.error = quiet;
console.log(`\n${passed} passed (page boundary)`);
process.exit(0);
