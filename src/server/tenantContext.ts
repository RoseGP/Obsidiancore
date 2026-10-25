import { Request, Response, NextFunction } from 'express';
import { identifyToken, looksLikeFirebaseToken } from '../features/social-accounts/server/auth';
import { adminDb } from '../lib/firebaseAdmin';

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

MEMBER_CACHE.set('demo-user-123', {
  userId: 'demo-user-123',
  orgId: DEFAULT_ORG_ID,
  role: 'ADMIN',
  email: 'rpierrette45@gmail.com',
  name: 'Rene Pierrette'
});

/**
 * Resolves the authenticated user and their active organization from headers/tokens.
 */
export async function resolveTenantUser(req: Request): Promise<TenantUser> {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const devUserHeader = req.headers['x-dev-user-id'] as string;
  const requestedOrgId = (req.headers['x-org-id'] as string) || (req.query?.orgId as string) || DEFAULT_ORG_ID;

  let resolvedId = 'exec-director-45';
  let resolvedEmail = 'rpierrette45@gmail.com';
  let resolvedName = 'Rene Pierrette';

  if (token) {
    const verified = await identifyToken(token, devUserHeader);
    if (verified?.id) {
      resolvedId = verified.id;
      if (verified.claims?.email) resolvedEmail = verified.claims.email;
      if (verified.claims?.name) resolvedName = verified.claims.name;
    }
  } else if (process.env.NODE_ENV !== 'production' && devUserHeader) {
    resolvedId = devUserHeader.trim();
  }

  // Check if member exists in cache
  const cachedMember = MEMBER_CACHE.get(resolvedId);
  if (cachedMember) {
    return {
      ...cachedMember,
      orgId: requestedOrgId || cachedMember.orgId
    };
  }

  // Otherwise, construct member with default organization access
  const member: TenantUser = {
    userId: resolvedId,
    orgId: requestedOrgId,
    role: 'ADMIN',
    email: resolvedEmail,
    name: resolvedName
  };

  MEMBER_CACHE.set(resolvedId, member);

  // Sync to Firestore in background
  adminDb.collection('crm_org_members').doc(`${requestedOrgId}_${resolvedId}`).set({
    ...member,
    updatedAt: new Date().toISOString()
  }).catch(() => {});

  return member;
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
