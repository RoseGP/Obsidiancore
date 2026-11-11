/**
 * /api/compliance: Settings › Privacy & compliance (organization admins: compliance › manage).
 * Every change and every export is written to the audit log.
 *
 *   GET  /consents?email=            consent history (and current status per purpose for one email)
 *   POST /consents                   { email, purpose, status, source?, note? }
 *   GET  /requests                   data-subject requests
 *   POST /requests                   { type: access|export|correction|deletion, subjectEmail, details?, corrections? }
 *   GET  /requests/:id/preview       what completing it would change or export (counts per store)
 *   POST /requests/:id/approve       requested → approved
 *   POST /requests/:id/reject        { reason? } requested → rejected
 *   POST /requests/:id/execute       approved → completed; access/export return the JSON bundle
 *   GET  /retention                  policies, data types, last run
 *   PUT  /retention                  { policies: { [type]: { enabled, days, action, autoApply } } }
 *   POST /retention/run              { apply?: boolean, only?: [types] }   dry run unless apply === true
 *   GET  /access-reviews             current members (role, last active, two-step) + past reviews
 *   POST /access-reviews             { notes? } mark a review complete (stores a snapshot)
 *   GET  /incidents · POST /incidents · PATCH /incidents/:id
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { requireAccess } from '../server/security/permissions';
import { auditFromRequest } from '../server/audit/auditLog';
import { rateLimit } from '../features/social-accounts/server/http';
import {
  accessReviewSnapshot, completeAccessReview, createIncident, createPrivacyRequest, decidePrivacyRequest, executePrivacyRequest,
  listAccessReviews, listConsents, listIncidents, listPrivacyRequests, previewPrivacyRequest, recordConsent, updateIncident, CONSENT_PURPOSES, REQUEST_TYPES,
} from '../server/compliance/records';
import { getRetention, runRetention, setRetentionPolicies, RETENTION_TYPES, type RetentionType } from '../server/compliance/retention';

const router = Router();
const limiter = rateLimit({ name: 'compliance', windowMs: 60_000, max: 120, key: (req) => (req as any).accountUser?.id || req.ip || 'anon' });
router.use(limiter, requireTenant, requireAccess('compliance', 'manage'));

const masked = (email: string) => { const [u, d] = String(email).split('@'); return `${(u || '').slice(0, 2)}…@${d || ''}`; };

// ---- Consent ----
router.get('/consents', async (req, res) => {
  try { res.json({ success: true, purposes: CONSENT_PURPOSES, ...(await listConsents(tenantOf(req).orgId, { email: typeof req.query.email === 'string' ? req.query.email : undefined })) }); }
  catch (err) { sendError(res, err, 'compliance.consents'); }
});
router.post('/consents', async (req, res) => {
  try {
    const t = tenantOf(req);
    const rec = await recordConsent(t.orgId, req.body ?? {}, { userId: t.userId });
    await auditFromRequest(req, 'consent.recorded', { type: 'consent', id: rec.id, label: masked(rec.email) }, { purpose: rec.purpose, status: rec.status, source: rec.source });
    res.status(201).json({ success: true, consent: rec });
  } catch (err) { sendError(res, err, 'compliance.recordConsent'); }
});

// ---- Data-subject requests ----
router.get('/requests', async (req, res) => {
  try { res.json({ success: true, types: REQUEST_TYPES, requests: await listPrivacyRequests(tenantOf(req).orgId) }); }
  catch (err) { sendError(res, err, 'compliance.requests'); }
});
router.post('/requests', async (req, res) => {
  try {
    const t = tenantOf(req);
    const r = await createPrivacyRequest(t.orgId, req.body ?? {}, t.userId);
    await auditFromRequest(req, 'privacy_request.created', { type: 'privacy_request', id: r.id, label: masked(r.subjectEmail) }, { requestType: r.type });
    res.status(201).json({ success: true, request: r });
  } catch (err) { sendError(res, err, 'compliance.createRequest'); }
});
router.get('/requests/:id/preview', async (req, res) => {
  try { res.json({ success: true, ...(await previewPrivacyRequest(tenantOf(req).orgId, req.params.id)) }); }
  catch (err) { sendError(res, err, 'compliance.previewRequest'); }
});
for (const decision of ['approve', 'reject'] as const) {
  router.post(`/requests/:id/${decision}`, async (req, res) => {
    try {
      const t = tenantOf(req);
      const r = await decidePrivacyRequest(t.orgId, req.params.id, decision, t.userId, String(req.body?.reason || ''));
      await auditFromRequest(req, `privacy_request.${decision === 'approve' ? 'approved' : 'rejected'}`, { type: 'privacy_request', id: r.id }, { requestType: r.type });
      res.json({ success: true, request: r });
    } catch (err) { sendError(res, err, `compliance.${decision}Request`); }
  });
}
router.post('/requests/:id/execute', async (req, res) => {
  try {
    const t = tenantOf(req);
    const { request, bundle } = await executePrivacyRequest(t.orgId, req.params.id, t.userId);
    const action = request.type === 'deletion' ? 'privacy_request.erased' : request.type === 'correction' ? 'privacy_request.corrected' : 'data.exported';
    await auditFromRequest(req, action, { type: 'privacy_request', id: request.id }, { requestType: request.type, ...(request.result?.counts || {}) });
    res.json({ success: true, request, ...(bundle ? { bundle } : {}) });
  } catch (err) { sendError(res, err, 'compliance.executeRequest'); }
});

// ---- Retention ----
router.get('/retention', async (req, res) => {
  try {
    const types = Object.entries(RETENTION_TYPES).map(([id, d]) => ({ id, label: d.label, actions: d.actions, minDays: d.minDays }));
    res.json({ success: true, types, ...(await getRetention(tenantOf(req).orgId)) });
  } catch (err) { sendError(res, err, 'compliance.retention'); }
});
router.put('/retention', async (req, res) => {
  try {
    const t = tenantOf(req);
    const policies = await setRetentionPolicies(t.orgId, req.body?.policies ?? {}, t.userId);
    await auditFromRequest(req, 'retention.updated', { type: 'settings', id: 'retention' }, Object.fromEntries(Object.entries(policies).map(([k, p]) => [k, p ? `${p.enabled ? 'on' : 'off'} ${p.days}d ${p.action}${p.autoApply ? ' auto' : ''}` : 'off'])));
    res.json({ success: true, policies });
  } catch (err) { sendError(res, err, 'compliance.setRetention'); }
});
router.post('/retention/run', async (req, res) => {
  try {
    const t = tenantOf(req);
    const body = z.object({ apply: z.boolean().optional(), only: z.array(z.string().max(40)).max(10).optional() }).parse(req.body ?? {});
    const run = await runRetention(t.orgId, { apply: body.apply === true, only: body.only as RetentionType[] | undefined });
    if (run.applied) await auditFromRequest(req, 'retention.applied', { type: 'settings', id: 'retention' }, Object.fromEntries(run.results.map((r) => [r.type, r.applied])));
    res.json({ success: true, run });
  } catch (err) { sendError(res, err, 'compliance.runRetention'); }
});

// ---- Access reviews ----
router.get('/access-reviews', async (req, res) => {
  try { const orgId = tenantOf(req).orgId; res.json({ success: true, members: await accessReviewSnapshot(orgId), reviews: await listAccessReviews(orgId) }); }
  catch (err) { sendError(res, err, 'compliance.accessReviews'); }
});
router.post('/access-reviews', async (req, res) => {
  try {
    const t = tenantOf(req);
    const r = await completeAccessReview(t.orgId, t.userId, String(req.body?.notes || ''));
    await auditFromRequest(req, 'access_review.completed', { type: 'access_review', id: r.id }, { members: r.members.length });
    res.status(201).json({ success: true, review: r });
  } catch (err) { sendError(res, err, 'compliance.completeReview'); }
});

// ---- Incidents ----
router.get('/incidents', async (req, res) => {
  try { res.json({ success: true, incidents: await listIncidents(tenantOf(req).orgId) }); }
  catch (err) { sendError(res, err, 'compliance.incidents'); }
});
router.post('/incidents', async (req, res) => {
  try {
    const t = tenantOf(req);
    const i = await createIncident(t.orgId, req.body ?? {}, t.userId);
    await auditFromRequest(req, 'incident.created', { type: 'incident', id: i.id, label: i.title }, { severity: i.severity, status: i.status });
    res.status(201).json({ success: true, incident: i });
  } catch (err) { sendError(res, err, 'compliance.createIncident'); }
});
router.patch('/incidents/:id', async (req, res) => {
  try {
    const t = tenantOf(req);
    const i = await updateIncident(t.orgId, req.params.id, req.body ?? {}, t.userId);
    await auditFromRequest(req, 'incident.updated', { type: 'incident', id: i.id, label: i.title }, { severity: i.severity, status: i.status });
    res.json({ success: true, incident: i });
  } catch (err) { sendError(res, err, 'compliance.updateIncident'); }
});

export default router;
