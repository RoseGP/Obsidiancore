/**
 * Minimal audit trail used by GREET (meeting tokens, recordings, invitations, cancellations).
 *
 *   organizations/{orgId}/audit_log/{id}   { id, at, actorId, action, target, meta }
 *
 * Append-only from the application's point of view. Entries never contain tokens, keys or secrets.
 * A central audit service can adopt this collection and shape as-is.
 */
import { getDocStore, newId, assertId } from '../data/docStore';

export interface AuditEntry { actorId: string; action: string; target?: string; meta?: Record<string, unknown> }

/** Never throws: an audit write failing must not break the action it records (it is logged instead). */
export async function recordAudit(orgId: string, entry: AuditEntry): Promise<void> {
  try {
    const id = newId('aud');
    await (await getDocStore()).set(`organizations/${assertId(orgId)}/audit_log/${id}`, {
      id, at: new Date().toISOString(), actorId: entry.actorId, action: entry.action,
      target: entry.target ?? null, meta: entry.meta ?? {},
    });
  } catch (e) {
    console.warn('[audit] could not record', entry.action, (e as Error)?.name || 'error');
  }
}

export async function listAudit(orgId: string, limit = 200) {
  return (await getDocStore()).list(`organizations/${assertId(orgId)}/audit_log`, { orderBy: 'at', direction: 'desc', limit });
}
