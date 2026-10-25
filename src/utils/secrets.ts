/**
 * Central access to secrets. No secret has a value written in the code.
 *
 *  coreSecret(name)      The server can't run safely without it. Production: missing → startup error
 *                        naming the variable. Development: a random value per process (warned once),
 *                        so nothing predictable is ever used, but data encrypted with it won't survive
 *                        a restart. Set real values in .env (see .env.example).
 *  optionalSecret(name)  Integration credentials. Missing → '' and the feature reports "not configured".
 *  devDefault(name, v)   A documented local-development default (e.g. LiveKit dev server "devkey"),
 *                        never used when NODE_ENV=production.
 */
import crypto from 'node:crypto';

const isProd = () => process.env.NODE_ENV === 'production';
const devValues = new Map<string, string>();
const warned = new Set<string>();

export class MissingSecretError extends Error {
  constructor(public names: string[]) {
    super(`Missing required secret ${names.join(' / ')}. Set it in the environment or .env (see .env.example).`);
  }
}

function first(names: string[]): string {
  for (const n of names) { const v = process.env[n]; if (v && v.trim()) return v.trim(); }
  return '';
}

/** `length` (optional): exact length required, e.g. 32 for raw AES-256 keys. */
export function coreSecret(names: string | string[], opts: { length?: number } = {}): string {
  const list = Array.isArray(names) ? names : [names];
  const v = first(list);
  if (v) {
    if (opts.length && v.length !== opts.length) {
      if (isProd()) throw new Error(`${list[0]} must be exactly ${opts.length} characters.`);
      console.warn(`[secrets] ${list[0]} should be exactly ${opts.length} characters.`);
    }
    return v;
  }
  if (isProd()) throw new MissingSecretError(list);
  const key = list[0];
  if (!devValues.has(key)) devValues.set(key, crypto.randomBytes(Math.ceil((opts.length ?? 48) / 2)).toString('hex').slice(0, opts.length ?? 48));
  if (!warned.has(key)) { warned.add(key); console.warn(`[secrets] ${key} not set: using a random development value (data encrypted with it won't survive a restart).`); }
  return devValues.get(key)!;
}

export function optionalSecret(...names: string[]): string { return first(names); }

export function devDefault(name: string, localDefault: string): string {
  const v = first([name]);
  if (v) return v;
  return isProd() ? '' : localDefault;
}

/** Called at startup: lists every missing core secret at once (production only). */
export function assertProductionSecrets(required: (string | string[])[]) {
  if (!isProd()) return;
  const missing = required.filter((n) => !first(Array.isArray(n) ? n : [n])).map((n) => (Array.isArray(n) ? n.join(' or ') : n));
  if (missing.length) {
    console.error(`[secrets] Refusing to start: set ${missing.join(', ')} (see .env.example).`);
    process.exit(1);
  }
}
