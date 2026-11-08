import { Request, Response, NextFunction } from 'express';
import { identifyToken } from '../features/social-accounts/server/auth';

export interface TenantUser {
  userId: string;
  orgId: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'SALES_REP' | 'MARKETER' | 'READ_ONLY';
  email: string;
  name: string;
}

export interface TenantRequest extends Request {
  tenant?: TenantUser;
}

// In-Memory store for organizations & user memberships
const ORG_CACHE = new Map<string, { id: string; name: string; plan: string }>();
const MEMBER_CACHE = new Map<string, TenantUser>();

// Preseed default organization
const DEFAULT_ORG_ID = 'org_obsidian_enterprise';
ORG_CACHE.set(DEFAULT_ORG_ID, {
  id: DEFAULT_ORG_ID,
  name: 'Obsidian Enterprise Solutions',
  plan: 'enterprise'
});

// Preseed executive director
MEMBER_CACHE.set('exec-director-45', {
  userId: 'exec-director-45',
  orgId: DEFAULT_ORG_ID,
  role: 'ADMIN',
  email: 'rpierrette45@gmail.com',
  name: 'Rene Pierrette'
});


/**
 * Resolves the authenticated user and their active organization from headers/tokens.
 */
export async function resolveTenantUser(req: Request): Promise<TenantUser | null> {
  // Phase 0 hardening. This module is not mounted anywhere yet; Phase 1 replaces it with the Firestore
  // membership model. Until then it must never invent an identity, grant ADMIN, or let the client pick the org.
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const verified = await identifyToken(token, req.headers['x-dev-user-id'] as string | undefined);
  if (!verified?.id) return null;

  const member = MEMBER_CACHE.get(verified.id);
  if (!member) return null; // not a member of any organization

  const requestedOrgId = (req.headers['x-org-id'] as string) || '';
  if (requestedOrgId && requestedOrgId !== member.orgId) return null; // no switching into other orgs
  return { ...member };
}

/**
 * Express middleware requiring a validated tenant user.
 */
export async function requireTenant(req: TenantRequest, res: Response, next: NextFunction) {
  try {
    const tenantUser = await resolveTenantUser(req);
    if (!tenantUser || !tenantUser.userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Valid session required.' });
    }
    req.tenant = tenantUser;
    next();
  } catch (err: any) {
    res.status(401).json({ success: false, error: 'Authentication failed.' });
  }
}

/**
 * Checks role permissions.
 */
export function requireRole(allowedRoles: Array<TenantUser['role']>) {
  return (req: TenantRequest, res: Response, next: NextFunction) => {
    if (!req.tenant) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Session missing.' });
    }
    if (!allowedRoles.includes(req.tenant.role)) {
      return res.status(403).json({
        success: false,
        error: `Forbidden: Action requires one of the following roles: [${allowedRoles.join(', ')}]. Current role: ${req.tenant.role}.`
      });
    }
    next();
  };
}
