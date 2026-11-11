#!/usr/bin/env node
/**
 * Generates a 256-bit master API key and stores it in your .env (and, optionally, the local secret files
 * used by the Firebase emulator and `wrangler dev`). The key itself is NOT printed unless you pass --print,
 * so it doesn't end up in terminal scrollback, CI logs or screen shares.
 *
 *   node scripts/generate-api-key.mjs                    # create or replace MASTER_API_KEY in ./.env
 *   node scripts/generate-api-key.mjs --rotate           # keep the old key as MASTER_API_KEY_PREVIOUS (zero-downtime rotation)
 *   node scripts/generate-api-key.mjs --local-secrets    # also write functions/.secret.local and .dev.vars (emulators)
 *   node scripts/generate-api-key.mjs --env path/.env    # a different env file
 *   node scripts/generate-api-key.mjs --print            # print the key (only if you really need it on screen)
 *
 * Then push it to production with the commands in docs/api-key-auth/README.md (they read it from .env, without echoing).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const NAME = 'MASTER_API_KEY';

const key = crypto.randomBytes(32).toString('hex'); // 32 bytes = 256 bits → 64 hex characters
const fingerprint = (k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 12);

/** Sets NAME=value in a dotenv-style file, replacing an existing line; creates the file (mode 600) if needed. */
function upsert(file, name, value) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
  fs.writeFileSync(file, text, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}
function read(file, name) {
  if (!fs.existsSync(file)) return undefined;
  const m = fs.readFileSync(file, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}
/** Refuses to write secrets into a file git would commit. */
function assertIgnored(file) {
  const gi = path.join(process.cwd(), '.gitignore');
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
  const rules = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [];
  const base = path.basename(rel);
  const ignored = rules.some((r) => r === rel || r === base || r === `/${rel}` || (r.endsWith('*') && base.startsWith(r.slice(0, -1))) || r === `${rel.split('/')[0]}/`);
  if (!ignored) {
    fs.appendFileSync(gi, `${fs.existsSync(gi) && !fs.readFileSync(gi, 'utf8').endsWith('\n') ? '\n' : ''}${rel}\n`);
    console.log(`  added ${rel} to .gitignore`);
  }
}

const envFile = path.resolve(opt('--env') || '.env');
assertIgnored(envFile);
const previous = read(envFile, NAME);
if (flag('--rotate')) {
  if (!previous) { console.error(`--rotate: no existing ${NAME} in ${envFile}.`); process.exit(1); }
  upsert(envFile, `${NAME}_PREVIOUS`, previous);
}
upsert(envFile, NAME, key);
console.log(`✓ ${NAME} written to ${path.relative(process.cwd(), envFile) || envFile} (fingerprint ${fingerprint(key)})`);
if (flag('--rotate')) console.log(`  previous key kept as ${NAME}_PREVIOUS (fingerprint ${fingerprint(previous)}); remove it once every client uses the new key.`);
else if (previous) console.log(`  replaced the previous key (fingerprint ${fingerprint(previous)}). Clients using it will stop working; use --rotate for a gradual switch.`);

if (flag('--local-secrets')) {
  for (const f of ['functions/.secret.local', '.dev.vars']) {
    const file = path.resolve(f);
    if (!fs.existsSync(path.dirname(file))) continue;
    assertIgnored(file);
    upsert(file, NAME, key);
    if (flag('--rotate')) upsert(file, `${NAME}_PREVIOUS`, previous);
    console.log(`✓ also written to ${f} (local emulator only)`);
  }
}
if (flag('--print')) console.log(`\n${NAME}=${key}\n`);
console.log('\nNext: push it to Firebase / Cloudflare (docs/api-key-auth/README.md, "Store the secret").');
