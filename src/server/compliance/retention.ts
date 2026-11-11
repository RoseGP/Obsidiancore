/**
 * Data retention policies, per organization:
 *   organizations/{org}/settings/retention  { policies: { [dataType]: { enabled, days, action, autoApply } }, lastRun }
 *
 * Actions never hard-delete:
 *   archive    the record gets archivedAt (kept, can be restored by clearing it)
 *   anonymize  personal fields and free text are cleared; the record and its numbers stay
 *
 * runRetention(orgId, { apply:false }) is a dry run (the default everywhere). The daily sweeper only
 * APPLIES policies an admin marked autoApply; for the rest it stores the dry-run counts for review.
 * Consent records are not subject to retention (they are the proof of consent or withdrawal), and the
 * audit log can only be archived, after at least 365 days.
 *
 * Note: archivedAt is a marker; list views that don't filter on it yet still show archived records.
 */
import { z } from 'zod';
import { assertId, getDocStore } from '../data/docStore';
import { REMOVED } from './dataSubject';

export const RETENTION_TYPES = {
  leads: { label: 'Leads that never converted', actions: ['archive', 'anonymize'], minDays: 30, dateField: (r: any) => r.updatedAt || r.createdAt, include: (r: any) => !r.isConverted && r.status !== 'converted' },
  activities: { label: 'Activity feed entries', actions: ['archive', 'anonymize'], minDays: 30, dateField: (r: any) => r.timestamp || r.createdAt, include: () => true },
  meeting_notes: { label: 'Meeting notes', actions: ['archive', 'anonymize'], minDays: 30, dateField: (r: any) => r.updatedAt || r.createdAt, include: () => true },
  inbound_messages: { label: 'WhatsApp and SMS messages', actions: ['archive', 'anonymize'], minDays: 30, dateField: (r: any) => r.at || r.sentAt, include: () => true },
  voicemails: { label: 'Voicemails', actions: ['archive', 'anonymize'], minDays: 30, dateField: (r: any) => r.at, include: () => true },
  audit_log: { label: 'Audit log', actions: ['archive'], minDays: 365, dateField: (r: any) => r.at, include: () => true },
} as const;
export type RetentionType = keyof typeof RETENTION_TYPES;

const policySchema = z.object({
  enabled: z.boolean(), days: z.coerce.number().int().min(1).max(3650),
  action: z.enum(['archive', 'anonymize']), autoApply: z.boolean().default(false),
});
export type RetentionPolicy = z.infer<typeof policySchema>;

const settingsPath = (orgId: string) => `organizations/${assertId(orgId)}/settings/retention`;

export async function getRetention(orgId: string) {
  const doc = await (await getDocStore()).get(settingsPath(orgId));
  return { policies: (doc?.policies || {}) as Partial<Record<RetentionType, RetentionPolicy>>, lastRun: doc?.lastRun || null };
}

export async function setRetentionPolicies(orgId: string, input: Record<string, unknown>, actorId: string) {
  const policies: Partial<Record<RetentionType, RetentionPolicy>> = {};
  for (const [type, raw] of Object.entries(input || {})) {
    const def = (RETENTION_TYPES as any)[type];
    if (!def) throw Object.assign(new Error(`Unknown data type: ${type}.`), { status: 400, code: 'invalid_input' });
    const p = policySchema.parse(raw);
    if (!def.actions.includes(p.action)) throw Object.assign(new Error(`${def.label}: “${p.action}” isn’t allowed.`), { status: 400, code: 'invalid_input' });
    if (p.days < def.minDays) throw Object.assign(new Error(`${def.label} must be kept at least ${def.minDays} days.`), { status: 400, code: 'invalid_input' });
    policies[type as RetentionType] = p;
  }
  const cur = await getRetention(orgId);
  await (await getDocStore()).set(settingsPath(orgId), { policies, lastRun: cur.lastRun, updatedAt: new Date().toISOString(), updatedBy: actorId });
  return policies;
}

function anonymizePatch(type: RetentionType): Record<string, unknown> {
  const at = new Date().toISOString();
  switch (type) {
    case 'leads': return { name: 'Removed contact', email: '', phone: '', company: '', title: '', notes: '', qualification: { need: '', budget: 0, authority: 'unknown', timeline: 'unknown' }, anonymizedAt: at, anonymizedBy: 'retention' };
    case 'activities': return { description: '', anonymizedAt: at };
    case 'meeting_notes': return { body: REMOVED, anonymizedAt: at };
    case 'inbound_messages': return { from: '', contactName: '', body: REMOVED, anonymizedAt: at };
    case 'voicemails': return { from: '', callerName: '', transcript: REMOVED, recordingUrl: null, anonymizedAt: at };
    default: return {};
  }
}

/** Finds (and with apply=true, processes) records past each enabled policy. `only` limits to some types. */
export async function runRetention(orgId: string, opts: { apply: boolean; only?: RetentionType[]; autoApplyOnly?: boolean; now?: number }) {
  const { policies } = await getRetention(orgId);
  const st = await getDocStore();
  const now = opts.now ?? Date.now();
  const results: Array<{ type: RetentionType; label: string; action: string; days: number; matched: number; applied: number }> = [];
  for (const [type, p] of Object.entries(policies) as Array<[RetentionType, RetentionPolicy]>) {
    if (!p?.enabled || (opts.only && !opts.only.includes(type))) continue;
    const def = RETENTION_TYPES[type];
    const cutoff = now - p.days * 86_400_000;
    const col = `organizations/${assertId(orgId)}/${type}`;
    const rows = (await st.list(col)).filter((r) => {
      if (r.archivedAt && p.action === 'archive') return false;
      if (r.anonymizedAt && p.action === 'anonymize') return false;
      const t = Date.parse(def.dateField(r) || '');
      return Number.isFinite(t) && t < cutoff && def.include(r);
    });
    const doApply = opts.apply && (!opts.autoApplyOnly || p.autoApply);
    let applied = 0;
    if (doApply) {
      for (const r of rows) {
        if (!r?.id) continue;
        const patch = p.action === 'archive' ? { archivedAt: new Date(now).toISOString(), archivedBy: 'retention' } : anonymizePatch(type);
        if (await st.update(`${col}/${assertId(r.id)}`, patch)) applied++;
      }
    }
    results.push({ type, label: def.label, action: p.action, days: p.days, matched: rows.length, applied });
  }
  const run = { at: new Date(now).toISOString(), applied: results.some((r) => r.applied > 0), results };
  const cur = await st.get(settingsPath(orgId));
  if (cur) await st.update(settingsPath(orgId), { lastRun: run });
  return run;
}

/** Daily: applies autoApply policies and records dry-run counts for the rest. Never throws. */
export function startRetentionSweeper(intervalMs = 24 * 3600_000) {
  const tick = async () => {
    try {
      const st = await getDocStore();
      for (const org of await st.list('organizations')) {
        if (!org?.id) continue;
        const { policies } = await getRetention(org.id).catch(() => ({ policies: {} as any }));
        if (!Object.values(policies).some((p: any) => p?.enabled)) continue;
        await runRetention(org.id, { apply: true, autoApplyOnly: true }).catch((e) => console.warn('[retention] run failed:', e?.code || e?.name || 'error'));
      }
    } catch (e: any) { console.warn('[retention] sweep failed:', e?.code || e?.name || 'error'); }
  };
  const t = setInterval(tick, intervalMs); t.unref?.();
  const first = setTimeout(tick, 60_000); first.unref?.();
  return () => { clearInterval(t); clearTimeout(first); };
}
