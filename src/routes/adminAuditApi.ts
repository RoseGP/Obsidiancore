/**
 * /api/admin/audit-log (organization admins: audit › view):
 *   GET /   ?action=&actorId=&targetType=&from=&to=&limit=&before=   newest first, paginated with `before`
 *           &format=csv downloads the matching entries as CSV (the download itself is audited)
 */
import { Router } from 'express';
import { requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { requireAccess } from '../server/security/permissions';
import { auditFromRequest, auditToCsv, listAudit } from '../server/audit/auditLog';
import { rateLimit } from '../features/social-accounts/server/http';

const router = Router();
const limiter = rateLimit({ name: 'audit-log', windowMs: 60_000, max: 60, key: (req) => (req as any).accountUser?.id || req.ip || 'anon' });
const q = (v: unknown, max = 128) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

router.get('/', limiter, requireTenant, requireAccess('audit', 'view'), async (req, res) => {
  try {
    const t = tenantOf(req);
    const csv = req.query.format === 'csv';
    const query = {
      action: q(req.query.action, 80), actorId: q(req.query.actorId), targetType: q(req.query.targetType, 40),
      from: q(req.query.from, 40), to: q(req.query.to, 40), before: q(req.query.before, 40),
      limit: csv ? 5000 : Number(req.query.limit) || 50,
    };
    const page = await listAudit(t.orgId, query);
    if (csv) {
      await auditFromRequest(req, 'audit.exported', { type: 'audit_log' }, { rows: page.entries.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(auditToCsv(page.entries));
    }
    res.json({ success: true, ...page });
  } catch (err) { sendError(res, err, 'audit.list'); }
});

export default router;
