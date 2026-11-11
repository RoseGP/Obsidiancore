#!/usr/bin/env node
/**
 * Project-specific guards, run in CI next to the type check (`npm run lint`). Fails if something that was
 * deliberately removed comes back:
 *   1. route handlers whose path contains "simulate"
 *   2. mounts of the removed legacy routers
 *   3. strings that look like real Stripe / Google API secrets
 * A line can opt out with the comment `lint-guards: allow` (for clearly fake test fixtures).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src', 'server.ts', 'functions/src', 'public'];
const EXT = /\.(ts|tsx|js|mjs)$/;
const RULES = [
  { name: 'simulate-route', re: /\b(router|app)\.(get|post|put|patch|delete|all)\(\s*['"`][^'"`]*simulat/i, msg: 'Route paths may not contain "simulate". Build a clearly labeled preview, or remove it.' },
  { name: 'legacy-mount', re: /app\.use\(\s*['"`]\/api\/(social|social-posts|social-auth|social-connection|social-planner|postiz|social\/postiz|auth)['"`]/, msg: 'This legacy router was removed; use /api/accounts, /api/posts (postsApi) or /api/gcal.' },
  { name: 'secret-literal', re: /\b((sk|rk)_(live|test)_[A-Za-z0-9]{24,}|AIza[0-9A-Za-z_-]{35}|GOCSPX-[0-9A-Za-z_-]{20,})/, msg: 'Looks like a real API secret. Secrets belong in environment variables / secret managers.' },
];

function* walk(p) {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isFile()) { if (EXT.test(p)) yield p; return; }
  for (const e of fs.readdirSync(p)) {
    if (e === 'node_modules' || e === 'lib' || e === 'dist' || e.startsWith('.')) continue;
    yield* walk(path.join(p, e));
  }
}

let problems = 0;
for (const root of ROOTS) for (const file of walk(root)) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (line.includes('lint-guards: allow')) return;
    for (const r of RULES) if (r.re.test(line)) { problems++; console.error(`${file}:${i + 1}  [${r.name}] ${r.msg}\n    ${line.trim().slice(0, 160)}`); }
  });
}
if (problems) { console.error(`\n✗ ${problems} problem(s)`); process.exit(1); }
console.log('✓ lint guards passed');
