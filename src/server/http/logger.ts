/**
 * Server-side structured logging: one JSON object per line (easy to search in Cloud Logging, Datadog, etc.).
 *
 * Never pass secrets or CRM record contents. As a safety net, values under keys that look sensitive
 * (password, token, secret, authorization, cookie, apiKey, email, phone…) are replaced with "[redacted]",
 * and long strings are truncated.
 *
 * LOG_LEVEL=debug|info|warn|error (default info; tests default to warn). LOG_FORMAT=pretty prints
 * "LEVEL event key=value" lines instead of JSON (local development).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|credential|private[-_]?key|email|phone|ssn|card/i;
const MAX_STRING = 500;

type Sink = (line: string, level: LogLevel) => void;
let sink: Sink = (line, level) => { (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line); };
/** Tests: capture log lines (null restores the console). */
export function setLogSinkForTests(s: Sink | null) {
  sink = s ?? ((line, level) => { (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line); });
}

function threshold(): number {
  const env = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'warn' : 'info')).toLowerCase() as LogLevel;
  return ORDER[env] ?? ORDER.info;
}

export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth > 4) return '[depth]';
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1), stack: value.stack };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out;
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < threshold()) return;
  const data = redact(fields) as Record<string, unknown>;
  if ((process.env.LOG_FORMAT || '').toLowerCase() === 'pretty') {
    const kv = Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
    sink(`${level.toUpperCase()} ${event}${kv ? ` ${kv}` : ''}`, level);
    return;
  }
  sink(JSON.stringify({ time: new Date().toISOString(), level, event, ...data }), level);
}

export const logger = {
  debug: (event: string, fields?: Record<string, unknown>) => log('debug', event, fields),
  info: (event: string, fields?: Record<string, unknown>) => log('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => log('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => log('error', event, fields),
};
