/**
 * The organization's security audit log: one append-only record per security-relevant action.
 *
 *   organizations/{orgId}/audit_log/{id}  { id, at, actorId, actorEmail?, action, target, meta, ip? }
 *
 * - Append-only: this module only creates entries; there is no update or delete API. Retention
 *   policies may archive (never delete) entries older than the minimum retention.
 * - No secrets and no message content in `meta`: values are scrubbed (key names that look like
 *   secrets are dropped, strings are truncated) before they are stored.
 * - The IP address is stored as a salted hash (AUDIT_IP_SALT, or a per-process salt) so entries
 *   from the same address can be correlated without keeping the address itself.
 * - Writing an entry never fails the request that triggered it (errors are logged, not thrown).
 *
 * Other modules (for example GREET meetings) may write here with the same shape
 * { at, actorId, action, target, meta }.
 */
import crypto from 'node:crypto';
import type { Request } from 'express';
import { assertId, getDocStore, newId } from '../data/docStore';

export interface AuditTarget { type: string; id?: string; label?: string }
export interface AuditEntry {
  id: string; at: string; orgId: string;
  actorId: string; actorEmail?: string;
  action: string; target: AuditTarget;
  meta: Record<string, string | number | boolean | null>;
  ipHash?: string;
}
export interface AuditInput {
  actorId: string; actorEmail?: string;
  action: string; target?: AuditTarget | string;
  meta?: Record<string, unknown>;
  ip?: string;
}

export const auditPath = (orgId: string) => `organizations/${assertId(orgId)}/audit_log`;

const SECRETISH = /(secret|token|password|passcode|apikey|api_key|authorization|cookie|credential|^otp$|^code$|^key$|privatekey)/i;
const CONTENT = /^(body|content|message|text|notes?|html)$/i;
const PROCESS_SALT = crypto.randomBytes(16).toString('hex');

export function hashIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  return crypto.createHash('sha256').update((process.env.AUDIT_IP_SALT || PROCESS_SALT) + ip).digest('hex').slice(0, 16);
}

/** Keeps flat, short, non-secret values only. */
export function scrubMeta(meta: Record<string, unknown> | undefined): AuditEntry['meta'] {
  const out: AuditEntry['meta'] = {};
  if (!meta) return out;
  for (const [k, v] of Object.entries(meta).slice(0, 25)) {
    if (SECRETISH.test(k) || CONTENT.test(k)) continue;
    if (v === null || typeof v === 'boolean') out[k.slice(0, 40)] = v as null | boolean;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k.slice(0, 40)] = v;
    else if (typeof v === 'string') out[k.slice(0, 40)] = v.slice(0, 200);
    else if (Array.isArray(v)) out[k.slice(0, 40)] = v.slice(0, 20).map((x) => String(x).slice(0, 60)).join(', ');
  }
  return out;
}

function normTarget(t: AuditInput['target']): AuditTarget {
  if (!t) return { type: 'organization' };
  if (typeof t === 'string') return { type: t.slice(0, 40) };
  return { type: String(t.type || 'record').slice(0, 40), ...(t.id ? { id: String(t.id).slice(0, 128) } : {}), ...(t.label ? { label: String(t.label).slice(0, 120) } : {}) };
}

/** Writes one entry. Never throws. Returns the stored entry, or null if it couldn't be written. */
export async function recordAudit(orgId: string, input: AuditInput): Promise<AuditEntry | null> {
  try {
    const entry: AuditEntry = {
      id: newId('aud'), at: new Date().toISOString(), orgId: assertId(orgId),
      actorId: String(input.actorId || 'system').slice(0, 128),
      ...(input.actorEmail ? { actorEmail: String(input.actorEmail).slice(0, 254) } : {}),
      action: String(input.action || 'unknown').slice(0, 80),
      target: normTarget(input.target),
      meta: scrubMeta(input.meta),
      ...(input.ip ? { ipHash: hashIp(input.ip) } : {}),
    };
    await (await getDocStore()).set(`${auditPath(orgId)}/${entry.id}`, entry);
    return entry;
  } catch (err) {
    console.error('[audit] could not write an audit entry:', (err as any)?.code || (err as any)?.name || 'error');
    return null;
  }
}

/** Convenience for route handlers that already resolved the tenant (req.tenant). */
export function auditFromRequest(req: Request, action: string, target?: AuditInput['target'], meta?: Record<string, unknown>) {
  const t = (req as any).tenant as { orgId: string; userId: string; email?: string } | undefined;
  if (!t) return Promise.resolve(null);
  return recordAudit(t.orgId, { actorId: t.userId, actorEmail: t.email, action, target, meta, ip: req.ip });
}

export interface AuditQuery { action?: string; actorId?: string; targetType?: string; from?: string; to?: string; limit?: number; before?: string }

/** Newest first. `before` is the `at` of the last entry of the previous page. */
export async function listAudit(orgId: string, q: AuditQuery = {}): Promise<{ entries: AuditEntry[]; nextBefore: string | null }> {
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 500);
  const where: any[] = [];
  if (q.action) where.push(['action', '==', q.action]);
  if (q.actorId) where.push(['actorId', '==', q.actorId]);
  // Filtering by time and target in memory keeps this to one simple index (orderBy at).
  const rows: AuditEntry[] = await (await getDocStore()).list(auditPath(orgId), { where, orderBy: 'at', direction: 'desc', limit: 5000 });
  const from = q.from ? Date.parse(q.from) : NaN;
  const to = q.to ? Date.parse(q.to) : NaN;
  const filtered = rows.filter((e) => {
    const t = Date.parse(e.at);
    if (q.before && e.at >= q.before) return false;
    if (Number.isFinite(from) && t < from) return false;
    if (Number.isFinite(to) && t > to) return false;
    if (q.targetType && e.target?.type !== q.targetType) return false;
    return true;
  });
  const entries = filtered.slice(0, limit);
  return { entries, nextBefore: filtered.length > limit ? entries[entries.length - 1].at : null };
}

const csvCell = (v: unknown) => {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function auditToCsv(entries: AuditEntry[]): string {
  const head = ['at', 'actorId', 'actorEmail', 'action', 'targetType', 'targetId', 'targetLabel', 'details', 'ipHash'];
  const lines = entries.map((e) => [e.at, e.actorId, e.actorEmail, e.action, e.target?.type, e.target?.id, e.target?.label,
    Object.entries(e.meta || {}).map(([k, v]) => `${k}=${v}`).join('; '), e.ipHash].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}
