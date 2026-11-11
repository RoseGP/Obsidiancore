/**
 * Shared test fixtures: organizations with members in given roles (in-memory store, dev sign-in headers).
 * Set NODE_ENV=test, SOCIAL_ACCOUNTS_DEV_AUTH=true and CRM_STORE=memory before importing.
 */
import { getDocStore } from '../data/docStore';
import { createOrg, type Role } from '../tenancy/orgs';

export async function makeOrg(ownerUid: string, name = `${ownerUid} org`) {
  return createOrg({ userId: ownerUid, email: `${ownerUid}@example.com`, name: ownerUid }, name);
}

/** Adds (or changes) a member directly in the store, as an accepted invitation would. */
export async function addMember(orgId: string, uid: string, role: Role) {
  const st = await getDocStore();
  await st.set(`organizations/${orgId}/members/${uid}`, { userId: uid, role, email: `${uid}@example.com`, name: uid, joinedAt: new Date().toISOString() });
  const idx = (await st.get(`crm_user_memberships/${uid}`)) || { userId: uid, orgs: {}, defaultOrgId: null };
  await st.set(`crm_user_memberships/${uid}`, { ...idx, orgs: { ...idx.orgs, [orgId]: role }, defaultOrgId: idx.defaultOrgId || orgId });
}

/** Headers for a dev sign-in acting in a specific organization. */
export const as = (uid: string, orgId: string, extra: Record<string, string> = {}) => ({ 'X-Dev-User-Id': uid, 'X-Org-Id': orgId, ...extra });
