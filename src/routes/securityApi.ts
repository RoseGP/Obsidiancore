/**
 * /api/security (signed-in members; mounted behind guard()):
 *   GET  /policy      the organization's security policy + this sign-in's status (reachable without two-step
 *                     sign-in, so someone blocked by `requireMfa` can see why)
 *   PUT  /policy      { requireMfa?, maxSessionHours?, idleSignOutMinutes? }               (settings: manage)
 *   GET  /roles       the role × module permission table                                   (any member)
 *   GET  /overview    sign-in monitoring numbers, members' two-step status, header mode    (settings: manage)
 */
import { Router } from 'express';
import { allowWithoutMfa, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { getSecurityPolicy, setSecurityPolicy, securityPolicySchema } from '../server/security/policy';
import { permissionTable, requireAccess } from '../server/security/permissions';
import { loginMonitorStats } from '../server/security/loginMonitor';
import { auditFromRequest } from '../server/audit/auditLog';
import { listMembers } from '../server/tenancy/orgs';
import { rateLimit } from '../features/social-accounts/server/http';

const router = Router();
const limiter = rateLimit({ name: 'security-api', windowMs: 60_000, max: 60, key: (req) => (req as any).accountUser?.id || req.ip || 'anon' });
router.use(limiter);

function signInStatus(req: any) {
  const au = req.accountUser || {};
  return { method: au.via as string, twoStep: !!au.secondFactor, secondFactor: au.secondFactor || null, signedInAt: au.authTime ? new Date(au.authTime * 1000).toISOString() : null };
}

router.get('/policy', allowWithoutMfa, requireTenant, async (req, res) => {
  try {
    const t = tenantOf(req);
    res.json({ success: true, policy: await getSecurityPolicy(t.orgId), me: { role: t.role, ...signInStatus(req) } });
  } catch (err) { sendError(res, err, 'security.policy'); }
});

router.put('/policy', requireTenant, requireAccess('settings', 'manage'), async (req, res) => {
  try {
    const t = tenantOf(req);
    const patch = securityPolicySchema.partial().parse(req.body ?? {});
    const before = await getSecurityPolicy(t.orgId);
    // Don't let an admin lock themselves out: turning on two-step sign-in needs a two-step sign-in.
    if (patch.requireMfa && !before.requireMfa && !(req as any).accountUser?.secondFactor) {
      return res.status(409).json({ success: false, code: 'enroll_first', error: 'Turn on two-step sign-in for your own account and sign in with it before requiring it for everyone.' });
    }
    const policy = await setSecurityPolicy(t.orgId, patch, t.userId);
    const changed = Object.fromEntries(Object.entries(policy).filter(([k, v]) => (before as any)[k] !== v));
    await auditFromRequest(req, 'security.policy_updated', { type: 'settings', id: 'security' }, changed);
    res.json({ success: true, policy });
  } catch (err) { sendError(res, err, 'security.setPolicy'); }
});

router.get('/roles', requireTenant, async (_req, res) => {
  res.json({ success: true, ...permissionTable() });
});

router.get('/overview', requireTenant, requireAccess('settings', 'manage'), async (req, res) => {
  try {
    const t = tenantOf(req);
    const members = await listMembers(t.orgId) as any[];
    const known = members.filter((m) => typeof m.lastSignInMfa === 'boolean');
    res.json({
      success: true,
      signInMonitoring: loginMonitorStats(),
      members: { total: members.length, twoStepAtLastSignIn: known.filter((m) => m.lastSignInMfa).length, unknown: members.length - known.length },
      headers: { contentSecurityPolicy: process.env.CSP_ENFORCE === 'true' ? 'enforced' : 'report-only', hsts: process.env.NODE_ENV === 'production' },
      policy: await getSecurityPolicy(t.orgId),
    });
  } catch (err) { sendError(res, err, 'security.overview'); }
});

export default router;
