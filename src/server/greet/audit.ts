/**
 * Minimal audit trail used by GREET (meeting tokens, recordings, invitations, cancellations).
 *
 *   organizations/{orgId}/audit_log/{id}   { id, at, actorId, action, target, meta }
 *
 * Append-only from the application's point of view. Entries never contain tokens, keys or secrets.
 * A central audit service can adopt this collection and shape as-is.
 */
import { getDocStore, assertId } from '../data/docStore';
import { recordAudit as centralRecordAudit } from '../audit/auditLog';

export interface AuditEntry { actorId: string; action: string; target?: string; meta?: Record<string, unknown> }

/** Writes through the central audit log service (src/server/audit/auditLog.ts). Never throws. */
export async function recordAudit(orgId: string, entry: AuditEntry): Promise<void> {
  // GREET passes a bare record id; the central log wants { type, id }. The type is the action's first part
  // (greet.recording.deleted → recording, meeting.token_issued → meeting).
  const parts = entry.action.split('.');
  const type = (parts[0] === 'greet' && parts.length > 2 ? parts[1] : parts[0]) || 'meeting';
  await centralRecordAudit(orgId, { actorId: entry.actorId, action: entry.action, target: entry.target ? { type, id: entry.target } : undefined, meta: entry.meta });
}

export async function listAudit(orgId: string, limit = 200) {
  return (await getDocStore()).list(`organizations/${assertId(orgId)}/audit_log`, { orderBy: 'at', direction: 'desc', limit });
}
