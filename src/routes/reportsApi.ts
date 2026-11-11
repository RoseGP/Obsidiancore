/**
 * /api/reports (signed-in members whose role can view reports: everyone but SUPPORT_AGENT and GUEST)
 *   GET /forecast?months=3      sales forecast per month (commit / best case / pipeline / expected ± ~80% range),
 *                               per-deal probabilities with their basis, notes and a confidence level
 *   GET /pipeline               conversion by stage, typical days in stage, stale deals, lead source conversion
 *   GET /segments               RFM customer segments with members, reasons and the thresholds used
 *   GET /deal-actions?dealId=   next best action per open deal, ranked by expected value × urgency
 * Everything is computed from this organization's own records (src/server/crm/analytics/); nothing is stored.
 * Formulas and limits: docs/analytics/README.md.
 */
import { Router } from 'express';
import { requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { requireAccess } from '../server/security/permissions';
import { assertId } from '../server/data/docStore';
import { dealActionsReport, forecastReport, pipelineReport, segmentsReport } from '../server/crm/analytics/load';

const router = Router();
router.use(requireTenant, requireAccess('reports', 'view'));
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

router.get('/forecast', async (req, res) => {
  try {
    const raw = req.query.months;
    const months = raw === undefined || raw === '' ? 3 : Number(raw);
    if (!Number.isInteger(months) || months < 1 || months > 12) return res.status(400).json({ success: false, code: 'invalid_input', error: 'months must be a whole number from 1 to 12.' });
    res.json({ success: true, ...(await forecastReport(tenantOf(req).orgId, months)) });
  } catch (err) { sendError(res, err, 'reports.forecast'); }
});

router.get('/pipeline', async (req, res) => {
  try { res.json({ success: true, ...(await pipelineReport(tenantOf(req).orgId)) }); } catch (err) { sendError(res, err, 'reports.pipeline'); }
});

router.get('/segments', async (req, res) => {
  try { res.json({ success: true, ...(await segmentsReport(tenantOf(req).orgId)) }); } catch (err) { sendError(res, err, 'reports.segments'); }
});

router.get('/deal-actions', async (req, res) => {
  try {
    const dealId = typeof req.query.dealId === 'string' && req.query.dealId ? assertId(req.query.dealId) : undefined;
    res.json({ success: true, ...(await dealActionsReport(tenantOf(req).orgId, { dealId })) });
  } catch (err) { sendError(res, err, 'reports.dealActions'); }
});

export default router;
