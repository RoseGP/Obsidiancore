/**
 * Centralized role-based access control: one matrix of module × permission per role.
 *
 * It is derived from (and consistent with) the older rank checks in tenancy/orgs.ts:
 * requirePermission('read' | 'write' | 'manage_records' | 'manage_members' | 'manage_org') keeps working
 * everywhere; requireAccess(module, permission) is the finer check for new and sensitive routes
 * (exports, deletions, sharing, compliance, audit).
 *
 * Role names in the product brief map onto these roles (docs/compliance/ACCESS_CONTROL.md):
 *   Super Administrator → platform administrator (PLATFORM_ADMIN_USER_IDS, outside any organization)
 *   Administrator → OWNER / ADMIN      Manager → MANAGER      Sales Representative → SALES_REP
 *   Support Agent → SUPPORT_AGENT      Standard User → MARKETER / READ_ONLY      Guest → GUEST
 */
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../tenancy/orgs';

export const MODULES = [
  'dashboard', 'contacts', 'companies', 'leads', 'deals', 'tasks', 'communication', 'meetings', 'calendar',
  'documents', 'reports', 'automation', 'billing', 'marketing', 'settings', 'members', 'compliance', 'audit',
  // Business profiles & listings (src/features/business-profiles): share = link listings / publish to Google.
  'listings',
] as const;
export type Module = typeof MODULES[number];
export const PERMISSIONS = ['view', 'create', 'edit', 'delete', 'export', 'share', 'manage'] as const;
export type Permission = typeof PERMISSIONS[number];

const ALL: Permission[] = [...PERMISSIONS];
const WORK: Permission[] = ['view', 'create', 'edit', 'share'];
const VIEW: Permission[] = ['view'];
const CRM: Module[] = ['contacts', 'companies', 'leads', 'deals', 'tasks', 'communication', 'meetings', 'calendar', 'documents'];

type Matrix = Partial<Record<Module, Permission[]>>;
const grant = (mods: Module[], perms: Permission[]): Matrix => Object.fromEntries(mods.map((m) => [m, perms]));

export const ROLE_MATRIX: Record<Role, Matrix> = {
  OWNER: grant([...MODULES], ALL),
  ADMIN: grant([...MODULES], ALL),
  MANAGER: {
    ...grant(CRM, ['view', 'create', 'edit', 'delete', 'export', 'share']),
    dashboard: VIEW, reports: ['view', 'export'], automation: ['view', 'create', 'edit', 'delete'],
    billing: ['view', 'create', 'edit', 'export'], marketing: ['view', 'create', 'edit', 'delete'],
    settings: VIEW, members: VIEW,
    listings: ['view', 'create', 'edit', 'delete', 'share'],
  },
  SALES_REP: {
    ...grant(CRM, WORK), tasks: ['view', 'create', 'edit', 'delete', 'share'],
    dashboard: VIEW, reports: VIEW, automation: VIEW, billing: ['view', 'create', 'edit'], marketing: VIEW, members: VIEW, listings: VIEW,
  },
  MARKETER: {
    ...grant(CRM, VIEW), leads: WORK, contacts: WORK, tasks: ['view', 'create', 'edit', 'delete'], calendar: WORK, meetings: WORK,
    dashboard: VIEW, reports: VIEW, marketing: ['view', 'create', 'edit', 'delete', 'share'], automation: VIEW, members: VIEW,
    listings: ['view', 'create', 'edit'],
  },
  SUPPORT_AGENT: {
    ...grant(CRM, VIEW), communication: ['view', 'create', 'edit', 'share'], contacts: ['view', 'edit'], companies: VIEW,
    tasks: ['view', 'create', 'edit', 'delete'], meetings: WORK, calendar: WORK, documents: ['view', 'create'],
    dashboard: VIEW, members: VIEW, listings: VIEW,
  },
  READ_ONLY: { ...grant(CRM, VIEW), dashboard: VIEW, reports: VIEW, members: VIEW, listings: VIEW },
  // Outside collaborators: only what they're invited to (meetings); nothing else in the organization.
  GUEST: { meetings: VIEW },
};

export function canAccess(role: Role | string | undefined, module: Module, permission: Permission): boolean {
  const m = ROLE_MATRIX[role as Role];
  return !!m && (m[module] || []).includes(permission);
}

/** The full table for the Settings › Roles & permissions page. */
export function permissionTable() {
  return {
    modules: [...MODULES], permissions: [...PERMISSIONS],
    roles: (Object.keys(ROLE_MATRIX) as Role[]).map((role) => ({
      role,
      grants: Object.fromEntries(MODULES.map((m) => [m, [...(ROLE_MATRIX[role][m] || [])]])) as Record<Module, Permission[]>,
    })),
  };
}

/** Use after requireTenant. */
export function requireAccess(module: Module, permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const t = (req as any).tenant as { role: Role } | undefined;
    if (!t) return res.status(401).json({ success: false, code: 'unauthorized', error: 'Sign in to continue.' });
    if (!canAccess(t.role, module, permission)) {
      return res.status(403).json({ success: false, code: 'forbidden', error: 'Your role doesn’t allow this action. Ask an admin for access.', required: { module, permission } });
    }
    next();
  };
}
