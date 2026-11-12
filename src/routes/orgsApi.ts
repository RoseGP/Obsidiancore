/**
 * /api/orgs: organizations, members, invitations and the website lead-capture key.
 * Mounted behind guard(PUBLIC.none): every call needs a verified user.
 *
 *   GET    /me                          my organizations + the one this request resolves to
 *   POST   /                            create an organization { name } (caller becomes OWNER)
 *   PUT    /me/default                  { orgId } choose my default organization
 *   GET    /current/members             list members                      (any member)
 *   PATCH  /current/members/:uid        { role }                           (ADMIN+, OWNER for owner roles)
 *   DELETE /current/members/:uid        remove a member, or leave (own uid)(ADMIN+, or self)
 *   POST   /current/invitations         { email, role } → share link      (ADMIN+)
 *   POST   /invitations/accept          { token }                          (invited, verified email)
 *   POST   /current/lead-capture-key    rotate; key shown once             (ADMIN+)
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { rotateLeadCaptureKey } from '../server/crm/crmRepository';
import { createEmbedKey, listEmbedKeys, revokeEmbedKey } from '../server/embed/embedKeys';
import { assertId, getDocStore } from '../server/data/docStore';
import { requirePermission, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { acceptInvitation, createInvitation, createOrg, getMember, getMembershipIndex, isRole, listMembers, listMyOrgs, removeMember, setMemberRole, TenancyError } from '../server/tenancy/orgs';
import { auditFromRequest, recordAudit } from '../server/audit/auditLog';
import { requireAccess, ROLE_MATRIX } from '../server/security/permissions';

const router = Router();
const appUrl = () => (process.env.APP_URL || '').replace(/\/+$/, '');
const user = (req: any) => req.accountUser as { id: string; email?: string; emailVerified?: boolean; name?: string };

router.get('/me', requireTenant, async (req, res) => {
  try {
    const t = tenantOf(req);
    // `permissions`: the caller's grants from the role matrix, so screens can hide actions the server would refuse.
    res.json({ success: true, current: { orgId: t.orgId, role: t.role, permissions: ROLE_MATRIX[t.role] || {} }, organizations: await listMyOrgs(t.userId) });
  } catch (err) { sendError(res, err, 'orgs.me'); }
});

const createLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
router.post('/', createLimiter, async (req, res) => {
  try {
    const u = user(req);
    const org = await createOrg({ userId: u.id, email: u.email, name: u.name }, req.body?.name);
    await recordAudit(org.id, { actorId: u.id, actorEmail: u.email, action: 'org.created', target: { type: 'organization', id: org.id, label: org.name }, ip: req.ip });
    res.status(201).json({ success: true, organization: org });
  } catch (err) { sendError(res, err, 'orgs.create'); }
});

router.put('/me/default', async (req, res) => {
  try {
    const u = user(req);
    const orgId = assertId(req.body?.orgId);
    const st = await getDocStore();
    const idx = await getMembershipIndex(u.id, st);
    if (!idx?.orgs?.[orgId]) throw new TenancyError(403, 'not_a_member', 'You don’t have access to this organization.');
    await st.set(`crm_user_memberships/${assertId(u.id)}`, { ...idx, defaultOrgId: orgId });
    res.json({ success: true, defaultOrgId: orgId });
  } catch (err) { sendError(res, err, 'orgs.setDefault'); }
});

router.get('/current/members', requireTenant, requireAccess('members', 'view'), async (req, res) => {
  try { res.json({ success: true, members: await listMembers(tenantOf(req).orgId) }); }
  catch (err) { sendError(res, err, 'orgs.members'); }
});

router.patch('/current/members/:uid', requireTenant, requirePermission('manage_members'), async (req, res) => {
  try {
    const t = tenantOf(req);
    if (!isRole(req.body?.role)) return res.status(400).json({ success: false, error: 'Unknown role.' });
    const target = assertId(req.params.uid);
    const before = await getMember(t.orgId, target);
    await setMemberRole(t.orgId, t, target, req.body.role);
    await auditFromRequest(req, 'member.role_changed', { type: 'member', id: target, label: before?.email || before?.name }, { from: before?.role || null, to: req.body.role });
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'orgs.setRole'); }
});

router.delete('/current/members/:uid', requireTenant, async (req, res) => {
  try {
    const t = tenantOf(req);
    const target = assertId(req.params.uid);
    const self = target === t.userId;
    if (!self && !['OWNER', 'ADMIN'].includes(t.role)) {
      return res.status(403).json({ success: false, code: 'forbidden', error: 'Only admins can remove other members.' });
    }
    // Leaving yourself is allowed for any role (an owner can only leave if another owner remains).
    const before = await getMember(t.orgId, target);
    await removeMember(t.orgId, self ? { userId: t.userId, role: 'OWNER' } : t, target);
    await auditFromRequest(req, self ? 'member.left' : 'member.removed', { type: 'member', id: target, label: before?.email || before?.name }, { role: before?.role || null });
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'orgs.removeMember'); }
});

const inviteLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 50, standardHeaders: 'draft-7', legacyHeaders: false });
router.post('/current/invitations', requireTenant, requirePermission('manage_members'), inviteLimiter, async (req, res) => {
  try {
    const t = tenantOf(req);
    const { invitation, token } = await createInvitation(t.orgId, t, req.body?.email, req.body?.role || 'SALES_REP');
    await auditFromRequest(req, 'member.invited', { type: 'invitation', id: invitation.id, label: invitation.email }, { role: invitation.role });
    // No email is sent from here: the inviter shares this link. It works once, for 7 days, and only
    // for someone signed in with the invited, verified email address.
    const acceptUrl = appUrl() ? `${appUrl()}/?invite=${encodeURIComponent(token)}` : null;
    res.status(201).json({ success: true, invitation, acceptUrl, token: acceptUrl ? undefined : token, delivered: false });
  } catch (err) { sendError(res, err, 'orgs.invite'); }
});

const acceptLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
router.post('/invitations/accept', acceptLimiter, async (req, res) => {
  try {
    const u = user(req);
    const r = await acceptInvitation(String(req.body?.token || ''), { userId: u.id, email: u.email, emailVerified: u.emailVerified, name: u.name });
    await recordAudit(r.orgId, { actorId: u.id, actorEmail: u.email, action: 'member.joined', target: { type: 'member', id: u.id, label: u.email }, meta: { role: r.role }, ip: req.ip });
    res.json({ success: true, ...r });
  } catch (err) { sendError(res, err, 'orgs.acceptInvite'); }
});

router.post('/current/lead-capture-key', requireTenant, requirePermission('manage_org'), async (req, res) => {
  try {
    const key = await rotateLeadCaptureKey(tenantOf(req).orgId);
    await auditFromRequest(req, 'api_key.rotated', { type: 'lead_capture_key' });
    res.json({ success: true, key, note: 'Copy this key now; it won’t be shown again. Any previous key stopped working.' });
  } catch (err) { sendError(res, err, 'orgs.leadKey'); }
});

// ---- Calendar widget keys (Settings → Organization → Website calendar) ----
router.get('/current/embed-keys', requireTenant, requirePermission('manage_org'), async (req, res) => {
  try { res.json({ success: true, keys: await listEmbedKeys(tenantOf(req).orgId) }); }
  catch (err) { sendError(res, err, 'orgs.embedKeys'); }
});
router.post('/current/embed-keys', requireTenant, requirePermission('manage_org'), async (req, res) => {
  try {
    const t = tenantOf(req);
    const { key, secret } = await createEmbedKey(t.orgId, t.userId, req.body || {});
    await auditFromRequest(req, 'api_key.created', { type: 'embed_key', id: (key as any)?.id, label: (key as any)?.label || (key as any)?.name });
    res.status(201).json({ success: true, key, secret, note: 'Copy this key now; it won’t be shown again.' });
  } catch (err) { sendError(res, err, 'orgs.createEmbedKey'); }
});
router.delete('/current/embed-keys/:id', requireTenant, requirePermission('manage_org'), async (req, res) => {
  try { await revokeEmbedKey(tenantOf(req).orgId, req.params.id); await auditFromRequest(req, 'api_key.revoked', { type: 'embed_key', id: req.params.id }); res.json({ success: true }); }
  catch (err) { sendError(res, err, 'orgs.revokeEmbedKey'); }
});

export default router;
