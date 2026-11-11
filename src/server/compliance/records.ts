/**
 * Compliance records kept per organization:
 *   organizations/{org}/consents/{id}            consent given or withdrawn (email, purpose, status, source, at)
 *   organizations/{org}/privacy_requests/{id}    data-subject requests: access/export, correction, deletion
 *   organizations/{org}/security_incidents/{id}  security incident register
 *   organizations/{org}/access_reviews/{id}      completed user access reviews (snapshot of members and roles)
 *
 * Privacy requests follow requested → approved → completed (or rejected). Nothing is changed until an
 * admin approves, and erasure/correction always show a preview first.
 */
import { z } from 'zod';
import { assertId, getDocStore, newId } from '../data/docStore';
import { listMembers, TenancyError } from '../tenancy/orgs';
import { CORRECTABLE, correctSubject, emailHash, eraseSubject, exportSubject, findSubject, subjectCounts } from './dataSubject';

const O = (orgId: string) => `organizations/${assertId(orgId)}`;
const now = () => new Date().toISOString();
const email = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'A valid email address is required.');

// ---------------- Consent ----------------
export const CONSENT_PURPOSES = ['marketing_email', 'sms', 'phone_calls', 'analytics', 'data_processing', 'meeting_recording', 'other'] as const;
export const consentSchema = z.object({
  email, purpose: z.enum(CONSENT_PURPOSES), status: z.enum(['granted', 'withdrawn']),
  source: z.string().trim().max(120).default('manual'), note: z.string().trim().max(500).optional().default(''),
});
export type ConsentInput = z.infer<typeof consentSchema>;

export async function recordConsent(orgId: string, input: ConsentInput, actor: { userId?: string; ipHash?: string } = {}) {
  const c = consentSchema.parse(input);
  const rec = { id: newId('cns'), ...c, at: now(), recordedBy: actor.userId || 'public_form', ...(actor.ipHash ? { ipHash: actor.ipHash } : {}) };
  await (await getDocStore()).set(`${O(orgId)}/consents/${rec.id}`, rec);
  return rec;
}

/** Newest first; with `email`, that person's history and their current status per purpose. */
export async function listConsents(orgId: string, filter: { email?: string; limit?: number } = {}) {
  const rows = await (await getDocStore()).list(`${O(orgId)}/consents`, { orderBy: 'at', direction: 'desc', limit: 2000 });
  const e = filter.email?.trim().toLowerCase();
  const list = e ? rows.filter((r) => r.email === e) : rows;
  const current: Record<string, string> = {};
  if (e) for (const r of [...list].reverse()) current[r.purpose] = r.status;
  return { consents: list.slice(0, Math.min(filter.limit || 200, 1000)), current: e ? current : undefined };
}

// ---------------- Privacy (data-subject) requests ----------------
export const REQUEST_TYPES = ['access', 'export', 'correction', 'deletion'] as const;
export const requestSchema = z.object({
  type: z.enum(REQUEST_TYPES), subjectEmail: email,
  details: z.string().trim().max(2000).optional().default(''),
  corrections: z.object(Object.fromEntries(CORRECTABLE.map((k) => [k, z.string().max(254).optional()])) as Record<typeof CORRECTABLE[number], z.ZodOptional<z.ZodString>>).optional(),
  receivedVia: z.string().trim().max(60).optional().default('email'),
});
const DUE_DAYS = 30; // GDPR: one month (CCPA allows 45 days); shown as the target date.

export async function createPrivacyRequest(orgId: string, input: z.input<typeof requestSchema>, actorId: string) {
  const r = requestSchema.parse(input);
  if (r.type === 'correction' && !Object.values(r.corrections || {}).some((v) => typeof v === 'string' && v.trim())) {
    throw new TenancyError(400, 'invalid_input', 'Say what should be corrected.');
  }
  const rec = { id: newId('dsr'), ...r, status: 'requested', requestedBy: actorId, requestedAt: now(), dueBy: new Date(Date.now() + DUE_DAYS * 86_400_000).toISOString(), approvedBy: null, approvedAt: null, completedAt: null, result: null };
  await (await getDocStore()).set(`${O(orgId)}/privacy_requests/${rec.id}`, rec);
  return rec;
}

export async function listPrivacyRequests(orgId: string) {
  return (await getDocStore()).list(`${O(orgId)}/privacy_requests`, { orderBy: 'requestedAt', direction: 'desc', limit: 500 });
}

export async function getPrivacyRequest(orgId: string, id: string) {
  const r = await (await getDocStore()).get(`${O(orgId)}/privacy_requests/${assertId(id)}`);
  if (!r) throw new TenancyError(404, 'not_found', 'Request not found.');
  return r;
}

/** What completing the request would do (counts per store). Changes nothing. */
export async function previewPrivacyRequest(orgId: string, id: string) {
  const r = await getPrivacyRequest(orgId, id);
  if (r.type === 'deletion') return { request: r, preview: await eraseSubject(orgId, r.subjectEmail, { apply: false }) };
  if (r.type === 'correction') return { request: r, preview: await correctSubject(orgId, r.subjectEmail, r.corrections || {}, { apply: false }) };
  return { request: r, preview: { counts: subjectCounts(await findSubject(orgId, r.subjectEmail)) } };
}

export async function decidePrivacyRequest(orgId: string, id: string, decision: 'approve' | 'reject', actorId: string, reason = '') {
  const r = await getPrivacyRequest(orgId, id);
  if (r.status !== 'requested') throw new TenancyError(409, 'invalid_state', `This request is already ${r.status}.`);
  const patch = decision === 'approve'
    ? { status: 'approved', approvedBy: actorId, approvedAt: now() }
    : { status: 'rejected', rejectedBy: actorId, rejectedAt: now(), rejectionReason: reason.slice(0, 500) };
  await (await getDocStore()).update(`${O(orgId)}/privacy_requests/${assertId(id)}`, patch);
  return { ...r, ...patch };
}

/** Carries out an approved request. Access/export requests return the export bundle. */
export async function executePrivacyRequest(orgId: string, id: string, actorId: string) {
  const r = await getPrivacyRequest(orgId, id);
  if (r.status !== 'approved' && !(r.status === 'completed' && (r.type === 'access' || r.type === 'export'))) {
    throw new TenancyError(409, 'not_approved', r.status === 'requested' ? 'Approve the request first.' : `This request is ${r.status}.`);
  }
  let result: any; let bundle: any = null;
  if (r.type === 'deletion') result = await eraseSubject(orgId, r.subjectEmail, { apply: true, requestId: r.id });
  else if (r.type === 'correction') result = await correctSubject(orgId, r.subjectEmail, r.corrections || {}, { apply: true });
  else { bundle = await exportSubject(orgId, r.subjectEmail); result = { counts: bundle.counts }; }
  const patch = { status: 'completed', completedAt: r.completedAt || now(), completedBy: r.completedBy || actorId, result };
  // After an erasure the request itself shouldn't keep the email in clear: keep only the domain.
  if (r.type === 'deletion') Object.assign(patch, { subjectEmail: `(removed)@${String(r.subjectEmail).split('@')[1] || ''}`, subjectEmailHash: emailHash(r.subjectEmail) });
  await (await getDocStore()).update(`${O(orgId)}/privacy_requests/${assertId(id)}`, patch);
  return { request: { ...r, ...patch }, bundle };
}

// ---------------- Security incidents ----------------
export const incidentSchema = z.object({
  title: z.string().trim().min(1, 'Give the incident a title.').max(200),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['open', 'investigating', 'contained', 'resolved', 'closed']).default('open'),
  detectedAt: z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'Use a valid date.').optional(),
  description: z.string().trim().max(5000).optional().default(''),
  affectedData: z.string().trim().max(1000).optional().default(''),
  personalDataInvolved: z.boolean().optional().default(false),
  notifiedAuthorityAt: z.string().max(40).nullable().optional(),
  notifiedSubjectsAt: z.string().max(40).nullable().optional(),
  actions: z.string().trim().max(5000).optional().default(''),
});

export async function listIncidents(orgId: string) {
  return (await getDocStore()).list(`${O(orgId)}/security_incidents`, { orderBy: 'createdAt', direction: 'desc', limit: 500 });
}
export async function createIncident(orgId: string, input: unknown, actorId: string) {
  const i = incidentSchema.parse(input);
  const rec = { id: newId('inc'), ...i, detectedAt: i.detectedAt || now(), createdBy: actorId, createdAt: now(), updatedAt: now() };
  await (await getDocStore()).set(`${O(orgId)}/security_incidents/${rec.id}`, rec);
  return rec;
}
export async function updateIncident(orgId: string, id: string, input: unknown, actorId: string) {
  const patch = incidentSchema.partial().parse(input);
  const path = `${O(orgId)}/security_incidents/${assertId(id)}`;
  const ok = await (await getDocStore()).update(path, { ...patch, updatedAt: now(), updatedBy: actorId, ...(patch.status === 'resolved' || patch.status === 'closed' ? { resolvedAt: now() } : {}) });
  if (!ok) throw new TenancyError(404, 'not_found', 'Incident not found.');
  return (await getDocStore()).get(path);
}

// ---------------- Access reviews ----------------
export async function accessReviewSnapshot(orgId: string) {
  const members = await listMembers(orgId);
  return members.map((m: any) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, joinedAt: m.joinedAt, lastActiveAt: m.lastActiveAt || null, lastSignInMfa: typeof m.lastSignInMfa === 'boolean' ? m.lastSignInMfa : null }));
}
export async function listAccessReviews(orgId: string) {
  return (await getDocStore()).list(`${O(orgId)}/access_reviews`, { orderBy: 'completedAt', direction: 'desc', limit: 100 });
}
export async function completeAccessReview(orgId: string, actorId: string, notes: string) {
  const rec = { id: newId('arv'), completedAt: now(), completedBy: actorId, notes: String(notes || '').slice(0, 2000), members: await accessReviewSnapshot(orgId) };
  await (await getDocStore()).set(`${O(orgId)}/access_reviews/${rec.id}`, rec);
  return rec;
}
