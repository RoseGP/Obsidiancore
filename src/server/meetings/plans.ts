/**
 * Meeting plans and organization subscriptions (server side).
 *
 *   platform_config/meeting_plans     plan configuration per tier (edited by platform administrators)
 *   subscriptions/{orgId}             the organization's tier, Enterprise custom limits/features
 *   subscription_events/{id}          history of every tier or custom-limit change
 *   subscription_requests/{id}        upgrade/downgrade requests from organization owners/admins
 *
 * Organizations can't change their own tier (that would bypass the limits); they request a change and a
 * platform administrator applies it. Billing (Phase B) will apply paid changes automatically.
 */
import { z } from 'zod';
import { getDocStore, newId, type DocStore } from '../data/docStore';
import {
  DEFAULT_PLAN_CONFIGS, FEATURE_KEYS, LIMIT_BOUNDS, MEETING_PLAN_TIERS, effectiveLimits, isMeetingPlanTier, normalizeTier,
  type MeetingPlanConfig, type MeetingPlanConfigs, type MeetingPlanTier, type PlanFeatures, type PlanLimits,
} from '../../lib/meetingPlans';

const PLANS_PATH = 'platform_config/meeting_plans';
export const subscriptionPath = (orgId: string) => `subscriptions/${orgId}`;
const legacyPlanPath = (orgId: string) => `organizations/${orgId}/settings/meetings`;

export class PlanError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}

// ---------------------------------------------------------------------------
// Plan configuration
// ---------------------------------------------------------------------------

let cache: { at: number; value: MeetingPlanConfigs } | null = null;
const CACHE_MS = 5_000;
/** Tests and admin writes reset the cache. */
export function clearPlanCache() { cache = null; }

function mergePlan(tier: MeetingPlanTier, stored: any): MeetingPlanConfig {
  const d = DEFAULT_PLAN_CONFIGS[tier];
  const features = { ...d.features };
  for (const k of FEATURE_KEYS) if (typeof stored?.features?.[k] === 'boolean') features[k] = stored.features[k];
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    tier,
    label: typeof stored?.label === 'string' && stored.label.trim() ? stored.label.trim() : d.label,
    limits: {
      maxParticipants: num(stored?.limits?.maxParticipants, d.limits.maxParticipants),
      maxDurationMinutes: num(stored?.limits?.maxDurationMinutes, d.limits.maxDurationMinutes),
    },
    features,
    warnMinutesBefore: num(stored?.warnMinutesBefore, d.warnMinutesBefore),
    capacityWarnPercent: num(stored?.capacityWarnPercent, d.capacityWarnPercent),
  };
}

export async function getPlanConfigs(s?: DocStore): Promise<MeetingPlanConfigs> {
  if (!s && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const doc = await (s ?? await getDocStore()).get(PLANS_PATH);
  const value = Object.fromEntries(MEETING_PLAN_TIERS.map((t) => [t, mergePlan(t, doc?.plans?.[t])])) as MeetingPlanConfigs;
  if (!s) cache = { at: Date.now(), value };
  return value;
}

const intIn = (b: { min: number; max: number }) => z.number().int().min(b.min).max(b.max);
export const planUpdateSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  limits: z.object({
    maxParticipants: intIn(LIMIT_BOUNDS.maxParticipants),
    maxDurationMinutes: intIn(LIMIT_BOUNDS.maxDurationMinutes),
  }).partial().optional(),
  features: z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()]))).partial().optional(),
  warnMinutesBefore: intIn(LIMIT_BOUNDS.warnMinutesBefore).optional(),
  capacityWarnPercent: intIn(LIMIT_BOUNDS.capacityWarnPercent).optional(),
});

export async function updatePlanConfig(tier: MeetingPlanTier, patch: z.infer<typeof planUpdateSchema>, actor: string): Promise<MeetingPlanConfig> {
  const st = await getDocStore();
  const updated = await st.transaction(async (tx) => {
    const doc = (await tx.get(PLANS_PATH)) || { plans: {} };
    const current = mergePlan(tier, doc.plans?.[tier]);
    const next: MeetingPlanConfig = {
      ...current,
      label: patch.label ?? current.label,
      limits: { ...current.limits, ...(patch.limits ?? {}) },
      features: { ...current.features, ...(patch.features ?? {}) } as PlanFeatures,
      warnMinutesBefore: patch.warnMinutesBefore ?? current.warnMinutesBefore,
      capacityWarnPercent: patch.capacityWarnPercent ?? current.capacityWarnPercent,
    };
    if (next.warnMinutesBefore >= next.limits.maxDurationMinutes) {
      throw new PlanError(400, 'invalid_input', 'The warning must come before the time limit.', { field: 'warnMinutesBefore' });
    }
    tx.set(PLANS_PATH, { plans: { ...(doc.plans || {}), [tier]: next }, updatedAt: new Date().toISOString(), updatedBy: actor });
    tx.set(`plan_config_events/${newId('pce')}`, { tier, before: current, after: next, by: actor, at: new Date().toISOString() });
    return next;
  });
  clearPlanCache();
  return updated;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export interface Subscription {
  orgId: string;
  tier: MeetingPlanTier;
  /** Enterprise agreement overrides (ignored on other tiers). */
  customLimits: Partial<PlanLimits> | null;
  customFeatures: Partial<PlanFeatures> | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function getSubscription(orgId: string, s?: DocStore): Promise<Subscription> {
  const st = s ?? await getDocStore();
  const doc = await st.get(subscriptionPath(orgId));
  if (doc) {
    return { orgId, tier: normalizeTier(doc.tier), customLimits: doc.customLimits ?? null, customFeatures: doc.customFeatures ?? null, updatedAt: doc.updatedAt ?? null, updatedBy: doc.updatedBy ?? null };
  }
  // Earlier versions stored only the plan name under the organization ('standard' = Free).
  const legacy = await st.get(legacyPlanPath(orgId));
  return { orgId, tier: normalizeTier(legacy?.plan), customLimits: null, customFeatures: null, updatedAt: legacy?.updatedAt ?? null, updatedBy: legacy?.updatedBy ?? null };
}

export interface ResolvedPlan {
  tier: MeetingPlanTier;
  label: string;
  limits: PlanLimits;
  features: PlanFeatures;
  warnMinutesBefore: number;
  capacityWarnPercent: number;
  custom: boolean;
}

/** The plan that applies to an organization right now (tier config + Enterprise agreement). */
export async function resolveOrgPlan(orgId: string, s?: DocStore): Promise<ResolvedPlan> {
  const [configs, sub] = await Promise.all([getPlanConfigs(s), getSubscription(orgId, s)]);
  return resolveFrom(configs, sub);
}

export function resolveFrom(configs: MeetingPlanConfigs, sub: Pick<Subscription, 'tier' | 'customLimits' | 'customFeatures'>): ResolvedPlan {
  const plan = configs[sub.tier];
  const isEnt = sub.tier === 'enterprise';
  const features = { ...plan.features };
  if (isEnt && sub.customFeatures) for (const k of FEATURE_KEYS) if (typeof sub.customFeatures[k] === 'boolean') features[k] = sub.customFeatures[k]!;
  return {
    tier: sub.tier,
    label: plan.label,
    limits: effectiveLimits(plan, isEnt ? sub.customLimits : null),
    features,
    warnMinutesBefore: plan.warnMinutesBefore,
    capacityWarnPercent: plan.capacityWarnPercent,
    custom: isEnt && !!(sub.customLimits || sub.customFeatures),
  };
}

export const subscriptionChangeSchema = z.object({
  tier: z.enum(['free', 'premium', 'enterprise']),
  customLimits: z.object({
    maxParticipants: intIn(LIMIT_BOUNDS.maxParticipants),
    maxDurationMinutes: intIn(LIMIT_BOUNDS.maxDurationMinutes),
  }).partial().nullable().optional(),
  customFeatures: z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()]))).partial().nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

/** Platform administrators only (checked by the route). Records an event for every change. */
export async function setSubscription(orgId: string, change: z.infer<typeof subscriptionChangeSchema>, actor: string, source: 'admin' | 'request' = 'admin'): Promise<Subscription> {
  const st = await getDocStore();
  if (!(await st.get(`organizations/${orgId}`))) throw new PlanError(404, 'org_not_found', 'That organization doesn\'t exist.');
  if (change.tier !== 'enterprise' && (change.customLimits || change.customFeatures)) {
    throw new PlanError(400, 'invalid_input', 'Custom limits and features are only for Enterprise agreements.', { field: 'customLimits' });
  }
  return st.transaction(async (tx) => {
    const before = await getSubscription(orgId, st);
    const now = new Date().toISOString();
    const next = {
      orgId, tier: change.tier,
      customLimits: change.tier === 'enterprise' ? (change.customLimits === undefined ? before.customLimits : change.customLimits) : null,
      customFeatures: change.tier === 'enterprise' ? (change.customFeatures === undefined ? before.customFeatures : change.customFeatures) : null,
      updatedAt: now, updatedBy: actor,
    };
    tx.set(subscriptionPath(orgId), next);
    tx.set(`subscription_events/${newId('sev')}`, {
      orgId, from: before.tier, to: next.tier, customLimits: next.customLimits, customFeatures: next.customFeatures,
      by: actor, source, reason: change.reason || '', at: now,
      direction: before.tier === next.tier ? 'adjusted' : MEETING_PLAN_TIERS.indexOf(next.tier) > MEETING_PLAN_TIERS.indexOf(before.tier) ? 'upgrade' : 'downgrade',
    });
    return next;
  });
}

// ---------------------------------------------------------------------------
// Change requests (organization owners/admins → platform administrators)
// ---------------------------------------------------------------------------

export async function createChangeRequest(org: { orgId: string; orgName: string }, actor: { userId: string; email: string; name: string }, tier: unknown, note: unknown) {
  if (!isMeetingPlanTier(tier)) throw new PlanError(400, 'invalid_input', 'Choose free, premium or enterprise.', { field: 'tier' });
  const st = await getDocStore();
  const sub = await getSubscription(org.orgId, st);
  if (sub.tier === tier) throw new PlanError(400, 'same_plan', `You're already on ${tier}.`);
  const pending = await st.list('subscription_requests', { where: [['orgId', '==', org.orgId], ['status', '==', 'pending']] });
  if (pending.length) throw new PlanError(409, 'request_pending', 'There is already a pending plan change request. Cancel it first.', { request: pending[0] });
  const req = {
    id: newId('sreq'), orgId: org.orgId, orgName: org.orgName, currentTier: sub.tier, requestedTier: tier,
    direction: MEETING_PLAN_TIERS.indexOf(tier) > MEETING_PLAN_TIERS.indexOf(sub.tier) ? 'upgrade' : 'downgrade',
    note: typeof note === 'string' ? note.trim().slice(0, 500) : '',
    requestedBy: actor.userId, requestedByName: actor.name || actor.email || actor.userId, requestedByEmail: actor.email || '',
    status: 'pending', createdAt: new Date().toISOString(), decidedAt: null, decidedBy: null,
  };
  await st.set(`subscription_requests/${req.id}`, req);
  return req;
}

export async function pendingRequestFor(orgId: string) {
  const list = await (await getDocStore()).list('subscription_requests', { where: [['orgId', '==', orgId], ['status', '==', 'pending']] });
  return list[0] ?? null;
}

export async function cancelChangeRequest(orgId: string, id: string, actor: string) {
  const st = await getDocStore();
  const req = await st.get(`subscription_requests/${id}`);
  if (!req || req.orgId !== orgId) throw new PlanError(404, 'not_found', 'Request not found.');
  if (req.status !== 'pending') throw new PlanError(409, 'not_pending', 'This request was already decided.');
  await st.update(`subscription_requests/${id}`, { status: 'cancelled', decidedAt: new Date().toISOString(), decidedBy: actor });
}

export async function decideChangeRequest(id: string, decision: 'approve' | 'decline', actor: string, reason?: string) {
  const st = await getDocStore();
  const req = await st.get(`subscription_requests/${id}`);
  if (!req) throw new PlanError(404, 'not_found', 'Request not found.');
  if (req.status !== 'pending') throw new PlanError(409, 'not_pending', 'This request was already decided.');
  if (decision === 'approve') {
    await setSubscription(req.orgId, { tier: req.requestedTier, reason: reason || `Approved request ${id}` }, actor, 'request');
  }
  const patch = { status: decision === 'approve' ? 'approved' : 'declined', decidedAt: new Date().toISOString(), decidedBy: actor, decisionNote: reason || '' };
  await st.update(`subscription_requests/${id}`, patch);
  return { ...req, ...patch };
}
