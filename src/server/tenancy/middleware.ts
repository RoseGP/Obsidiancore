/**
 * requireTenant: runs after guard() (which verified the user). Resolves the caller's organization
 * from the server-side membership records and attaches req.tenant. The client may ask for an org
 * with the X-Org-Id header, but it is honoured only if the caller is a member of it.
 *
 * A signed-in user with no organization gets a personal one (they become its OWNER), unless
 * CRM_AUTO_PROVISION_ORG=false, in which case they get 403 until someone invites them.
 */
import type { NextFunction, Request, Response } from 'express';
import { InvalidIdError, assertId, getDocStore } from '../data/docStore';
import { can, getMember, getMembershipIndex, TenancyError, type Action, type Role } from './orgs';

export interface Tenant { orgId: string; userId: string; role: Role; email: string; name: string }
export type TenantRequest = Request & { tenant?: Tenant };

/** Logs the real error server-side; the client gets a stable code and a safe message (no stack, no internals). */
export function sendError(res: Response, err: unknown, tag: string) {
  if (err instanceof TenancyError) return res.status(err.status).json({ success: false, code: err.code, error: err.message });
  if (err instanceof InvalidIdError) return res.status(400).json({ success: false, code: 'invalid_id', error: 'Invalid id.' });
  const status = (err as any)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return res.status(status).json({ success: false, code: (err as any).code || 'bad_request', error: (err as any).message || 'Bad request.' });
  }
  console.error(`[${tag}]`, err);
  return res.status(500).json({ success: false, code: 'server_error', error: 'Something went wrong on our side. Please try again.' });
}

async function ensurePersonalOrg(user: { id: string; email?: string; name?: string }): Promise<string> {
  const st = await getDocStore();
  const uid = assertId(user.id);
  const { newId } = await import('../data/docStore');
  // One transaction: concurrent first requests can't create two personal orgs.
  return st.transaction(async (tx) => {
    const idxPath = `crm_user_memberships/${uid}`;
    const idx = await tx.get(idxPath);
    const existing = idx && Object.keys(idx.orgs || {});
    if (existing && existing.length) return (idx.defaultOrgId && idx.orgs[idx.defaultOrgId]) ? idx.defaultOrgId : existing[0];
    const now = new Date().toISOString();
    const orgId = newId('org');
    const label = (user.name || user.email || '').split('@')[0].trim().slice(0, 60);
    tx.set(`organizations/${orgId}`, { id: orgId, name: label ? `${label}’s workspace` : 'My workspace', createdAt: now, createdBy: uid });
    tx.set(`organizations/${orgId}/members/${uid}`, { userId: uid, role: 'OWNER', email: user.email || '', name: user.name || '', joinedAt: now });
    tx.set(idxPath, { userId: uid, orgs: { [orgId]: 'OWNER' }, defaultOrgId: orgId });
    return orgId;
  });
}

export async function resolveTenant(req: Request): Promise<Tenant> {
  const au = (req as any).accountUser as { id: string; email?: string; name?: string } | undefined;
  if (!au?.id) throw new TenancyError(401, 'unauthorized', 'Sign in to continue.');
  const uid = assertId(au.id);
  const requested = typeof req.headers['x-org-id'] === 'string' ? req.headers['x-org-id'].trim() : '';

  let orgId: string;
  if (requested) {
    orgId = assertId(requested);
  } else {
    const idx = await getMembershipIndex(uid);
    const orgs = Object.keys(idx?.orgs || {});
    if (orgs.length) orgId = idx!.defaultOrgId && idx!.orgs[idx!.defaultOrgId] ? idx!.defaultOrgId : orgs[0];
    else if (process.env.CRM_AUTO_PROVISION_ORG !== 'false') orgId = await ensurePersonalOrg(au);
    else throw new TenancyError(403, 'no_organization', 'You aren’t a member of any organization yet. Ask an admin to invite you.');
  }

  // The members/{uid} document is the source of truth for access and role.
  const member = await getMember(orgId, uid);
  if (!member) throw new TenancyError(403, 'not_a_member', 'You don’t have access to this organization.');
  return { orgId, userId: uid, role: member.role, email: member.email || au.email || '', name: member.name || au.name || '' };
}

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  resolveTenant(req).then((t) => { (req as TenantRequest).tenant = t; next(); }, (e) => sendError(res, e, 'tenant'));
}

/** Use after requireTenant. */
export function requirePermission(action: Action) {
  return (req: Request, res: Response, next: NextFunction) => {
    const t = (req as TenantRequest).tenant;
    if (!t) return res.status(401).json({ success: false, code: 'unauthorized', error: 'Sign in to continue.' });
    if (!can(t.role, action)) {
      return res.status(403).json({ success: false, code: 'forbidden', error: 'Your role doesn’t allow this action. Ask an admin for access.' });
    }
    next();
  };
}

/** Permission by HTTP method: reads need 'read', anything else needs 'write'. Routes can demand more. */
export function requireReadOrWrite(req: Request, res: Response, next: NextFunction) {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  return requirePermission(write ? 'write' : 'read')(req, res, next);
}

export function tenantOf(req: Request): Tenant {
  const t = (req as TenantRequest).tenant;
  if (!t) throw new TenancyError(401, 'unauthorized', 'Sign in to continue.');
  return t;
}
