/**
 * Organization security policy, enforced on the server for every tenant-scoped request.
 *
 *   organizations/{orgId}/settings/security
 *     requireMfa            members must have signed in with a second factor (Firebase multi-factor)
 *     maxSessionHours       sign in again after this many hours (0 = no limit); uses the credential's auth_time
 *     idleSignOutMinutes    the app signs out after this much inactivity (0 = off; enforced in the browser)
 *
 * Also records each member's last activity (throttled) for access reviews.
 */
import { z } from 'zod';
import { assertId, getDocStore } from '../data/docStore';

export const securityPolicySchema = z.object({
  requireMfa: z.boolean(),
  maxSessionHours: z.coerce.number().int().min(0).max(24 * 90),
  idleSignOutMinutes: z.coerce.number().int().min(0).max(24 * 60),
});
export type SecurityPolicy = z.infer<typeof securityPolicySchema>;
export const DEFAULT_POLICY: SecurityPolicy = { requireMfa: false, maxSessionHours: 0, idleSignOutMinutes: 0 };

const policyPath = (orgId: string) => `organizations/${assertId(orgId)}/settings/security`;
const cache = new Map<string, { at: number; policy: SecurityPolicy }>();
const TTL = 30_000;

export async function getSecurityPolicy(orgId: string): Promise<SecurityPolicy> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL) return hit.policy;
  const doc = await (await getDocStore()).get(policyPath(orgId));
  const policy = { ...DEFAULT_POLICY, ...(doc ? securityPolicySchema.partial().parse(doc) : {}) };
  cache.set(orgId, { at: Date.now(), policy });
  return policy;
}

export async function setSecurityPolicy(orgId: string, patch: Partial<SecurityPolicy>, actorId: string): Promise<SecurityPolicy> {
  const next = securityPolicySchema.parse({ ...(await getSecurityPolicy(orgId)), ...patch });
  await (await getDocStore()).set(policyPath(orgId), { ...next, updatedAt: new Date().toISOString(), updatedBy: actorId });
  cache.delete(orgId);
  return next;
}

export function resetPolicyCacheForTests() { cache.clear(); lastSeen.clear(); }

export interface PolicyViolation { status: number; code: string; error: string }

/** Why this credential may not be used for this organization right now, or null if it may. */
export function checkCredentialAgainstPolicy(policy: SecurityPolicy, user: { via?: string; secondFactor?: string; authTime?: number }, now = Date.now()): PolicyViolation | null {
  if (policy.requireMfa && !user.secondFactor) {
    return { status: 403, code: 'mfa_required', error: 'Your organization requires two-step sign-in. Turn it on in Settings › Security, then sign in again.' };
  }
  if (policy.maxSessionHours > 0 && user.authTime && now - user.authTime * 1000 > policy.maxSessionHours * 3600_000) {
    return { status: 401, code: 'session_expired', error: `Your organization asks you to sign in again every ${policy.maxSessionHours} hours. Sign out and sign in again.` };
  }
  return null;
}

// ---- Last activity (for access reviews) ----
const lastSeen = new Map<string, number>();
const SEEN_EVERY = 10 * 60_000;

/** Best effort, at most every 10 minutes per member; never throws. */
export function noteMemberActivity(orgId: string, uid: string, mfa: boolean) {
  const k = `${orgId}:${uid}`;
  const now = Date.now();
  if (now - (lastSeen.get(k) || 0) < SEEN_EVERY) return;
  lastSeen.set(k, now);
  getDocStore()
    .then((st) => st.update(`organizations/${assertId(orgId)}/members/${assertId(uid)}`, { lastActiveAt: new Date(now).toISOString(), lastSignInMfa: mfa }))
    .catch(() => undefined);
}
