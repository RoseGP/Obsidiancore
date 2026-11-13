/**
 * Sign-in page and the workspace start-up check (happy-dom).
 *   Sign-in: password sign-in, "Forgot password?", the visible "Send a magic link" option (and its message when
 *   email isn't configured on the server).
 *   Start-up: every value comes from the API responses; all-clear opens the workspace by itself, warnings wait
 *   for the person, failed checks offer "Try again".
 * Run: npx tsx src/components/auth/__tests__/signInScreens.test.tsx
 */
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://localhost/', width: 1280, height: 900 });
const g = globalThis as any;
for (const [k, v] of Object.entries({
  window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement,
  HTMLTextAreaElement: win.HTMLTextAreaElement, HTMLSelectElement: win.HTMLSelectElement, Node: win.Node, Element: win.Element, Event: win.Event,
  CustomEvent: win.CustomEvent, KeyboardEvent: win.KeyboardEvent, MouseEvent: win.MouseEvent, FocusEvent: win.FocusEvent, localStorage: win.localStorage,
  getComputedStyle: win.getComputedStyle.bind(win), requestAnimationFrame: (cb: any) => setTimeout(() => cb(Date.now()), 0), cancelAnimationFrame: (id: any) => clearTimeout(id),
})) Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
g.IS_REACT_ACT_ENVIRONMENT = true;

// fetch stub: each test sets the responses by URL.
let routes: Record<string, () => { status: number; body: any }> = {};
const calls: string[] = [];
let hang = false; // true: requests never answer (the checks stay in progress)
g.fetch = async (url: string, init: any = {}) => {
  calls.push(url);
  if (hang) return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  const r = routes[url]?.() ?? { status: 404, body: { success: false } };
  return { ok: r.status < 400, status: r.status, json: async () => r.body } as any;
};

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AuthContext } = await import('../../../context/AuthContext');
const AuthFlowView = (await import('../AuthFlowView')).default;
const WorkspaceStartup = (await import('../WorkspaceStartup')).default;
const { OPEN_DELAY_MS } = await import('../WorkspaceStartup');

let passed = 0; const ok = (n: string) => { passed++; console.log('  ✓', n); };
const wait = async (cond: () => boolean, what: string, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return; await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); }
  throw new Error(`Timed out waiting for: ${what}\n${document.body.textContent?.slice(0, 800)}`);
};
const text = () => document.body.textContent || '';
const button = (label: string | RegExp) => [...document.querySelectorAll('button')].find((b) => (typeof label === 'string' ? (b.textContent || '').trim() === label || b.getAttribute('aria-label') === label : label.test(b.textContent || ''))) as HTMLButtonElement | undefined;
const click = async (el: Element | undefined, what: string) => { assert.ok(el, `missing ${what}`); await act(async () => { (el as any).click(); }); };
const type = async (el: Element | null, value: string) => {
  assert.ok(el, 'missing input');
  await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el!.dispatchEvent(new win.Event('input', { bubbles: true }) as any); });
};
const submit = async () => { await act(async () => { document.querySelector('form')!.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }) as any); }); };

const host = document.createElement('div'); document.body.appendChild(host);
const root = createRoot(host as any);

// ---------------- Sign-in page ----------------
const authCalls: any[] = [];
const authValue: any = {
  user: { email: 'maya@northwind.test', displayName: 'Maya Chen' }, isLoading: false, authError: null, clearAuthError: () => {}, mfaPending: null,
  loginWithEmail: async (...a: any[]) => { authCalls.push(['password', ...a]); },
  requestMagicLink: async (email: string) => { authCalls.push(['magic', email]); return `We sent a sign-in link to ${email}.`; },
  resetPassword: async (email: string) => { authCalls.push(['reset', email]); },
  signUpWithEmail: async () => {}, loginWithGoogle: async () => {}, loginAsDemo: () => {}, completeMfaSignIn: async () => {}, cancelMfaSignIn: () => {},
};
const renderAuth = async () => {
  await act(async () => { root.render(React.createElement(AuthContext.Provider, { value: authValue }, React.createElement(AuthFlowView, {}))); });
};

routes = { '/api/auth/magic-link/status': () => ({ status: 200, body: { enabled: true } }) };
await renderAuth();
await wait(() => text().includes('Welcome back') && !button('Send a magic link')!.disabled, 'sign-in page with magic link enabled');
assert.ok(text().includes('Obsidian Core') && text().includes('Secure access to your workspace'));
assert.ok(button('Sign in') && button('Forgot password?'));
assert.ok(text().includes('We’ll email you a one-time sign-in link'));
ok('Sign-in: heading, Sign in, Forgot password? and a visible "Send a magic link" option');

await type(document.querySelector('#auth-email'), 'maya@northwind.test');
await type(document.querySelector('#auth-password'), 'correct horse');
await submit();
await wait(() => authCalls.some((c) => c[0] === 'password'), 'password sign-in');
assert.deepEqual(authCalls.find((c) => c[0] === 'password'), ['password', 'maya@northwind.test', 'correct horse', true]);
ok('Sign-in: the form signs in with email and password (keep me signed in on by default)');

await click(button('Send a magic link'), 'magic link option');
assert.ok(text().includes('Sign in with a magic link'));
assert.equal(document.querySelector('#auth-password'), null);
await submit();
await wait(() => text().includes('Check your inbox'), 'magic link sent');
assert.deepEqual(authCalls.find((c) => c[0] === 'magic'), ['magic', 'maya@northwind.test']);
ok('Sign-in: "Send a magic link" asks for a link for the typed email and confirms it was sent');

await click(button('Back to sign in with a password'), 'back');
await click(button('Forgot password?'), 'forgot');
assert.ok(text().includes('Reset your password'));
await submit();
await wait(() => authCalls.some((c) => c[0] === 'reset'), 'reset');
ok('Sign-in: "Forgot password?" opens the reset form');
await act(async () => { root.render(React.createElement('div')); });

routes = { '/api/auth/magic-link/status': () => ({ status: 200, body: { enabled: false, reason: 'email_not_configured' } }) };
await renderAuth();
await wait(() => text().includes('aren’t set up on this server'), 'magic link unavailable note');
assert.equal(button('Send a magic link')!.disabled, true);
ok('Sign-in: without email delivery the magic link option is shown disabled, with the reason');
await act(async () => { root.render(React.createElement('div')); });

// ---------------- Workspace start-up ----------------
const org = { success: true, current: { orgId: 'org1', role: 'OWNER' }, organizations: [{ id: 'org1', name: 'Northwind Partners' }] };
const service = (ai = { claude: { configured: true }, gemini: { configured: true } }) => ({ success: true, ai, channels: [
  { id: 'email', label: 'Email', status: 'connected' }, { id: 'sms', label: 'SMS', status: 'connected' }, { id: 'whatsapp', label: 'WhatsApp', status: 'not_configured' },
] });
let done = 0, mount = 0;
const renderStartup = async (props: any = {}) => {
  done = 0; mount++;
  await act(async () => { root.render(React.createElement(AuthContext.Provider, { value: authValue }, React.createElement(WorkspaceStartup, { key: mount, onDone: () => { done++; }, ...props }))); });
};

routes = {
  '/api/orgs/me': () => ({ status: 200, body: org }),
  '/api/security/policy': () => ({ status: 200, body: { success: true, policy: { requireMfa: false, maxSessionHours: 0, idleSignOutMinutes: 30 }, me: { twoStep: true } } }),
  '/api/dashboard/service': () => ({ status: 200, body: service() }),
};
await renderStartup();
await wait(() => text().includes('Your workspace is ready') && !text().includes('Checking your workspace'), 'all checks done');
for (const s of ['Northwind Partners · Owner', '2 of 3 channels connected', 'Signed in with two-step verification', 'Claude and Gemini are ready', 'Two-step optional · sign-out after 30 min idle', '100%', 'Signed in as Maya Chen']) assert.ok(text().includes(s), `missing "${s}"`);
assert.ok(document.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow') === '100');
ok('Start-up: organization, channels, two-step and AI status come from the API responses');
await wait(() => done === 1, 'opens by itself', OPEN_DELAY_MS + 2000);
ok('Start-up: with every check passing, the workspace opens by itself');

routes['/api/security/policy'] = () => ({ status: 200, body: { success: true, policy: { requireMfa: true }, me: { twoStep: false } } });
routes['/api/dashboard/service'] = () => ({ status: 200, body: service({ claude: { configured: false }, gemini: { configured: false } } as any) });
await renderStartup();
await wait(() => text().includes('Your workspace is ready, with notes'), 'warnings');
assert.ok(text().includes('Your organization requires two-step sign-in') && text().includes('No AI provider set up yet'));
await new Promise((r) => setTimeout(r, OPEN_DELAY_MS + 300));
assert.equal(done, 0, 'warnings must not auto-open');
await click(button(/Open workspace/), 'open');
assert.equal(done, 1);
ok('Start-up: warnings are shown and wait for "Open workspace"');

let serviceFails = true;
routes['/api/dashboard/service'] = () => (serviceFails ? { status: 500, body: { success: false } } : { status: 200, body: service() });
routes['/api/security/policy'] = () => ({ status: 200, body: { success: true, policy: { requireMfa: false }, me: { twoStep: true } } });
await renderStartup();
await wait(() => text().includes('Some checks didn’t finish'), 'failed check');
assert.ok(text().includes('Couldn’t load channel status') && text().includes('Channel status isn’t available right now.'));
assert.ok(!text().includes('channels connected'), 'no invented channel numbers on failure');
serviceFails = false;
const before = calls.length;
await click(button(/Try again/), 'try again');
await wait(() => text().includes('2 of 3 channels connected'), 'retry succeeded');
assert.ok(calls.slice(before).includes('/api/dashboard/service'));
await wait(() => done === 1, 'opens after a successful retry', OPEN_DELAY_MS + 2000);
ok('Start-up: a failed check says so (no numbers) and "Try again" re-runs the checks');

hang = true;
await renderStartup();
assert.ok(text().includes('0 of 4 checks complete'));
await click(button('Skip'), 'skip');
assert.equal(done, 1);
ok('Start-up: "Skip" opens the workspace right away');

// A request that never answers: the check fails after the timeout (no endless spinner) and offers "Try again".
await renderStartup({ timeoutMs: 300 });
await wait(() => text().includes('Some checks didn’t finish'), 'timeout');
assert.ok(text().includes('Your organization didn’t answer in 1 s') || text().includes('your organization didn’t answer in 1 s'), 'timeout reason');
assert.ok(button(/Try again/));
ok('Start-up: a request that never answers fails after the timeout, with "Try again"');
hang = false;

await act(async () => { root.unmount(); });
console.log(`\n${passed} passed (sign-in screens)`);
process.exit(0);
