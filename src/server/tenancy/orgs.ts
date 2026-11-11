/**
 * Organizations (tenants) and memberships.
 *
 * Firestore layout (all server-only: firestore.rules denies clients everything not matched):
 *   organizations/{orgId}                         { id, name, createdAt, createdBy }
 *   organizations/{orgId}/members/{uid}           { userId, role, email, name, joinedAt }   ← source of truth
 *   organizations/{orgId}/invitations/{id}        { id, email, role, tokenHash, expiresAt, ... }
 *   crm_user_memberships/{uid}                    { userId, orgs: { [orgId]: role }, defaultOrgId }
 *
 * crm_user_memberships is deliberately NOT users/{uid}: the existing rules let clients write their own
 * users/{uid} document, which would let anyone grant themselves a role. Both docs are written in one
 * transaction so they never disagree.
 */
import crypto from 'node:crypto';
import { assertId, getDocStore, newId, type DocStore } from '../data/docStore';

export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'SALES_REP', 'MARKETER', 'SUPPORT_AGENT', 'READ_ONLY', 'GUEST'] as const;
export type Role = typeof ROLES[number];

/**
 * Coarse rank used by requirePermission(). GUEST has rank 0: it passes no rank check at all, so a guest
 * can only reach routes that explicitly allow it through requireAccess() (see server/security/permissions.ts).
 */
const RANK: Record<Role, number> = { OWNER: 5, ADMIN: 4, MANAGER: 3, SALES_REP: 2, MARKETER: 2, SUPPORT_AGENT: 2, READ_ONLY: 1, GUEST: 0 };

/** What each action requires. Checked on the server for every request. */
export type Action = 'read' | 'write' | 'manage_records' | 'manage_members' | 'manage_org';
const NEEDS: Record<Action, number> = { read: 1, write: 2, manage_records: 3, manage_members: 4, manage_org: 4 };

export function can(role: Role, action: Action): boolean {
  return (RANK[role] ?? 0) >= NEEDS[action];
}
export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

export class TenancyError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface Member { userId: string; role: Role; email: string; name: string; joinedAt: string }
export interface Org { id: string; name: string; createdAt: string; createdBy: string }
interface MembershipIndex { userId: string; orgs: Record<string, Role>; defaultOrgId: string | null }

const orgPath = (orgId: string) => `organizations/${assertId(orgId)}`;
const memberPath = (orgId: string, uid: string) => `${orgPath(orgId)}/members/${assertId(uid)}`;
const indexPath = (uid: string) => `crm_user_memberships/${assertId(uid)}`;

async function store(s?: DocStore) { return s ?? getDocStore(); }

export async function getMembershipIndex(uid: string, s?: DocStore): Promise<MembershipIndex | null> {
  return (await store(s)).get(indexPath(uid));
}

export async function getMember(orgId: string, uid: string, s?: DocStore): Promise<Member | null> {
  return (await store(s)).get(memberPath(orgId, uid));
}

export async function getOrg(orgId: string, s?: DocStore): Promise<Org | null> {
  return (await store(s)).get(orgPath(orgId));
}

export async function listMyOrgs(uid: string, s?: DocStore): Promise<Array<Org & { role: Role; isDefault: boolean }>> {
  const st = await store(s);
  const idx = await getMembershipIndex(uid, st);
  if (!idx) return [];
  const out: Array<Org & { role: Role; isDefault: boolean }> = [];
  for (const [orgId, role] of Object.entries(idx.orgs || {})) {
    const org = await getOrg(orgId, st);
    if (org) out.push({ ...org, role, isDefault: idx.defaultOrgId === orgId });
  }
  return out;
}

export async function createOrg(owner: { userId: string; email?: string; name?: string }, name: string, s?: DocStore): Promise<Org> {
  const st = await store(s);
  const cleanName = String(name || '').trim().slice(0, 120);
  if (!cleanName) throw new TenancyError(400, 'invalid_name', 'Organization name is required.');
  const uid = assertId(owner.userId);
  const now = new Date().toISOString();
  const org: Org = { id: newId('org'), name: cleanName, createdAt: now, createdBy: uid };
  await st.transaction(async (tx) => {
    const idx: MembershipIndex = (await tx.get(indexPath(uid))) || { userId: uid, orgs: {}, defaultOrgId: null };
    tx.set(orgPath(org.id), org);
    tx.set(memberPath(org.id, uid), { userId: uid, role: 'OWNER', email: owner.email || '', name: owner.name || '', joinedAt: now } satisfies Member);
    tx.set(indexPath(uid), { ...idx, orgs: { ...idx.orgs, [org.id]: 'OWNER' }, defaultOrgId: idx.defaultOrgId || org.id });
  });
  return org;
}

export async function listMembers(orgId: string, s?: DocStore): Promise<Member[]> {
  return (await store(s)).list(`${orgPath(orgId)}/members`, { orderBy: 'joinedAt' });
}

/** Changes a member's role. Only OWNERs can grant or remove OWNER; the last OWNER can't be demoted. */
export async function setMemberRole(orgId: string, actor: { userId: string; role: Role }, targetUid: string, role: Role, s?: DocStore) {
  if (!isRole(role)) throw new TenancyError(400, 'invalid_role', 'Unknown role.');
  const st = await store(s);
  await st.transaction(async (tx) => {
    const target: Member | null = await tx.get(memberPath(orgId, targetUid));
    if (!target) throw new TenancyError(404, 'not_found', 'Member not found.');
    if ((role === 'OWNER' || target.role === 'OWNER') && actor.role !== 'OWNER') throw new TenancyError(403, 'forbidden', 'Only an owner can change owner roles.');
    const idx: MembershipIndex | null = await tx.get(indexPath(targetUid));
    if (target.role === 'OWNER' && role !== 'OWNER') {
      const owners = (await st.list(`${orgPath(orgId)}/members`, { where: [['role', '==', 'OWNER']] })).length;
      if (owners <= 1) throw new TenancyError(409, 'last_owner', 'An organization needs at least one owner.');
    }
    tx.update(memberPath(orgId, targetUid), { role });
    if (idx) tx.set(indexPath(targetUid), { ...idx, orgs: { ...idx.orgs, [orgId]: role } });
  });
}

export async function removeMember(orgId: string, actor: { userId: string; role: Role }, targetUid: string, s?: DocStore) {
  const st = await store(s);
  await st.transaction(async (tx) => {
    const target: Member | null = await tx.get(memberPath(orgId, targetUid));
    if (!target) throw new TenancyError(404, 'not_found', 'Member not found.');
    if (target.role === 'OWNER') {
      if (actor.role !== 'OWNER') throw new TenancyError(403, 'forbidden', 'Only an owner can remove an owner.');
      const owners = (await st.list(`${orgPath(orgId)}/members`, { where: [['role', '==', 'OWNER']] })).length;
      if (owners <= 1) throw new TenancyError(409, 'last_owner', 'An organization needs at least one owner.');
    }
    const idx: MembershipIndex | null = await tx.get(indexPath(targetUid));
    tx.delete(memberPath(orgId, targetUid));
    if (idx) {
      const orgs = { ...idx.orgs }; delete orgs[orgId];
      tx.set(indexPath(targetUid), { ...idx, orgs, defaultOrgId: idx.defaultOrgId === orgId ? (Object.keys(orgs)[0] ?? null) : idx.defaultOrgId });
    }
  });
}

// ---------------------------------------------------------------------------
// Invitations: the inviter shares the link; the invitee must sign in with the invited, verified email.
// ---------------------------------------------------------------------------
const INVITE_TTL_MS = 7 * 24 * 3600_000;
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export async function createInvitation(orgId: string, actor: { userId: string; role: Role }, email: string, role: Role, s?: DocStore) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) throw new TenancyError(400, 'invalid_email', 'A valid email address is required.');
  if (!isRole(role)) throw new TenancyError(400, 'invalid_role', 'Unknown role.');
  if (role === 'OWNER' && actor.role !== 'OWNER') throw new TenancyError(403, 'forbidden', 'Only an owner can invite another owner.');
  const token = crypto.randomBytes(32).toString('base64url');
  const id = newId('inv');
  const invite = { id, orgId, email: e, role, tokenHash: hash(token), invitedBy: actor.userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(), acceptedAt: null as string | null };
  const st = await store(s);
  await st.set(`${orgPath(orgId)}/invitations/${id}`, invite);
  await st.set(`crm_invitation_tokens/${hash(token)}`, { orgId, invitationId: id });
  // The token is returned once (to the inviter) and never stored in plain text.
  return { invitation: { ...invite, tokenHash: undefined }, token };
}

export async function acceptInvitation(token: string, user: { userId: string; email?: string; emailVerified?: boolean; name?: string }, s?: DocStore) {
  const st = await store(s);
  const ref = await st.get(`crm_invitation_tokens/${hash(String(token || ''))}`);
  if (!ref) throw new TenancyError(404, 'invalid_invitation', 'This invitation link is invalid or has already been used.');
  const uid = assertId(user.userId);
  const invPath = `${orgPath(ref.orgId)}/invitations/${assertId(ref.invitationId)}`;
  return st.transaction(async (tx) => {
    const inv = await tx.get(invPath);
    const existing: Member | null = await tx.get(memberPath(ref.orgId, uid));
    const idx: MembershipIndex = (await tx.get(indexPath(uid))) || { userId: uid, orgs: {}, defaultOrgId: null };
    if (!inv || inv.acceptedAt) throw new TenancyError(404, 'invalid_invitation', 'This invitation link is invalid or has already been used.');
    if (Date.parse(inv.expiresAt) < Date.now()) throw new TenancyError(410, 'expired', 'This invitation has expired. Ask for a new one.');
    if (!user.email || !user.emailVerified || user.email.toLowerCase() !== inv.email) {
      throw new TenancyError(403, 'email_mismatch', 'Sign in with the verified email address this invitation was sent to.');
    }
    const now = new Date().toISOString();
    tx.update(invPath, { acceptedAt: now, acceptedBy: uid });
    tx.delete(`crm_invitation_tokens/${hash(String(token || ''))}`);
    if (!existing) {
      tx.set(memberPath(ref.orgId, uid), { userId: uid, role: inv.role, email: user.email.toLowerCase(), name: user.name || '', joinedAt: now } satisfies Member);
      tx.set(indexPath(uid), { ...idx, orgs: { ...idx.orgs, [ref.orgId]: inv.role }, defaultOrgId: idx.defaultOrgId || ref.orgId });
    }
    return { orgId: ref.orgId as string, role: (existing?.role ?? inv.role) as Role };
  });
}
