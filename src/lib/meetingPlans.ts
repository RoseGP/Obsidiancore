/**
 * Meeting subscription plans: types, the first-run defaults, and the pure rules both the server and the UI use.
 *
 * The live plan configuration is stored on the server (platform_config/meeting_plans) and edited by platform
 * administrators; DEFAULT_PLAN_CONFIGS only seeds it. Nothing else in the app should hardcode limits: read the
 * organization's plan from GET /api/meetings/subscription (client) or resolveOrgPlan() (server).
 */

export type MeetingPlanTier = 'free' | 'premium' | 'enterprise';
export const MEETING_PLAN_TIERS: MeetingPlanTier[] = ['free', 'premium', 'enterprise'];
export const DEFAULT_MEETING_PLAN: MeetingPlanTier = 'free';

export interface PlanLimits {
  /** Everyone in the meeting, host included. */
  maxParticipants: number;
  /** Maximum meeting length in minutes. */
  maxDurationMinutes: number;
}

/** Feature flags. Each one is enforced where noted (server = API refuses it; UI = control hidden or disabled). */
export interface PlanFeatures {
  /** Start/stop recording (server + UI). */
  recording: boolean;
  /** Waiting room: guests wait until admitted (server + UI). */
  waitingRoom: boolean;
  /** Mute or remove individual participants, lower hands (server for remove; UI). */
  hostControls: boolean;
  /** Lock the meeting so nobody else can join (server + UI). */
  securityControls: boolean;
  /** Promote participants to co-host (server + UI). */
  coHosts: boolean;
  /** Meeting analytics for the organization (server + UI). */
  analytics: boolean;
  /** Per-meeting attendance reports (server + UI). */
  attendanceReports: boolean;
  /** Organization name and color in the meeting room (server + UI). */
  customBranding: boolean;
  /** Organization meeting dashboard: active meetings, usage by host (server + UI). */
  adminDashboard: boolean;
  /** Priority support entitlement (shown on the plan; no in-app support channel yet). */
  prioritySupport: boolean;
}

export const FEATURE_LABELS: Record<keyof PlanFeatures, string> = {
  recording: 'Meeting recording',
  waitingRoom: 'Waiting room',
  hostControls: 'Advanced host & participant management',
  securityControls: 'Meeting lock & security controls',
  coHosts: 'Multiple hosts & co-hosts',
  analytics: 'Meeting analytics',
  attendanceReports: 'Attendance reports',
  customBranding: 'Custom branding',
  adminDashboard: 'Organization meeting dashboard',
  prioritySupport: 'Priority support',
};
export const FEATURE_KEYS = Object.keys(FEATURE_LABELS) as Array<keyof PlanFeatures>;

export interface MeetingPlanConfig {
  tier: MeetingPlanTier;
  label: string;
  limits: PlanLimits;
  features: PlanFeatures;
  /** Warn the host this many minutes before the time limit. */
  warnMinutesBefore: number;
  /** Warn the host when the room reaches this share of capacity (percent). */
  capacityWarnPercent: number;
}

export type MeetingPlanConfigs = Record<MeetingPlanTier, MeetingPlanConfig>;

const NONE: PlanFeatures = {
  recording: false, waitingRoom: false, hostControls: false, securityControls: false, coHosts: false,
  analytics: false, attendanceReports: false, customBranding: false, adminDashboard: false, prioritySupport: false,
};

/** First-run defaults only (seed for platform_config/meeting_plans). */
export const DEFAULT_PLAN_CONFIGS: MeetingPlanConfigs = {
  free: {
    tier: 'free', label: 'Free', limits: { maxParticipants: 100, maxDurationMinutes: 60 },
    features: { ...NONE }, warnMinutesBefore: 5, capacityWarnPercent: 90,
  },
  premium: {
    tier: 'premium', label: 'Premium', limits: { maxParticipants: 250, maxDurationMinutes: 300 },
    features: { ...NONE, recording: true, waitingRoom: true, hostControls: true, securityControls: true, analytics: true },
    warnMinutesBefore: 5, capacityWarnPercent: 90,
  },
  enterprise: {
    tier: 'enterprise', label: 'Enterprise', limits: { maxParticipants: 500, maxDurationMinutes: 720 },
    features: {
      recording: true, waitingRoom: true, hostControls: true, securityControls: true, coHosts: true, analytics: true,
      attendanceReports: true, customBranding: true, adminDashboard: true, prioritySupport: true,
    },
    warnMinutesBefore: 5, capacityWarnPercent: 90,
  },
};

/** Bounds administrators can configure. */
export const LIMIT_BOUNDS = {
  maxParticipants: { min: 2, max: 10_000 },
  maxDurationMinutes: { min: 5, max: 7 * 24 * 60 },
  warnMinutesBefore: { min: 1, max: 60 },
  capacityWarnPercent: { min: 50, max: 99 },
};

export function isMeetingPlanTier(v: unknown): v is MeetingPlanTier {
  return v === 'free' || v === 'premium' || v === 'enterprise';
}

/** Accepts older stored names ('standard' was the earlier name for Free). */
export function normalizeTier(v: unknown): MeetingPlanTier {
  if (isMeetingPlanTier(v)) return v;
  if (v === 'standard') return 'free';
  return DEFAULT_MEETING_PLAN;
}

export function tierRank(t: MeetingPlanTier): number { return MEETING_PLAN_TIERS.indexOf(t); }

/** The plan's limits with an Enterprise agreement's custom limits applied (custom limits only apply to Enterprise). */
export function effectiveLimits(plan: MeetingPlanConfig, custom?: Partial<PlanLimits> | null): PlanLimits {
  if (plan.tier !== 'enterprise' || !custom) return { ...plan.limits };
  return {
    maxParticipants: custom.maxParticipants && custom.maxParticipants > 0 ? custom.maxParticipants : plan.limits.maxParticipants,
    maxDurationMinutes: custom.maxDurationMinutes && custom.maxDurationMinutes > 0 ? custom.maxDurationMinutes : plan.limits.maxDurationMinutes,
  };
}

/** Never lower a running meeting's limits (downgrades apply to the next meeting); raise them on upgrade. */
export function raiseLimits(current: PlanLimits, next: PlanLimits): PlanLimits {
  return {
    maxParticipants: Math.max(current.maxParticipants, next.maxParticipants),
    maxDurationMinutes: Math.max(current.maxDurationMinutes, next.maxDurationMinutes),
  };
}
export function raiseFeatures(current: PlanFeatures, next: PlanFeatures): PlanFeatures {
  const out = { ...current };
  for (const k of FEATURE_KEYS) out[k] = !!(current[k] || next[k]);
  return out;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
  if (min % 60 === 0) return `${min / 60} hour${min === 60 ? '' : 's'}`;
  if (min > 60) return `${Math.floor(min / 60)} h ${min % 60} min`;
  return `${min} minutes`;
}

export function planSummary(limits: PlanLimits): string {
  return `${limits.maxParticipants} participants · up to ${formatMinutes(limits.maxDurationMinutes)}`;
}

/** The smallest plan whose limits fit, or null. */
export function planForNeeds(configs: MeetingPlanConfigs, needs: { participants?: number; minutes?: number; feature?: keyof PlanFeatures }): MeetingPlanTier | null {
  return MEETING_PLAN_TIERS.find((t) => {
    const p = configs[t];
    return (needs.participants == null || p.limits.maxParticipants >= needs.participants)
      && (needs.minutes == null || p.limits.maxDurationMinutes >= needs.minutes)
      && (needs.feature == null || p.features[needs.feature]);
  }) ?? null;
}

/** Room capacity. `inRoom` counts everyone in the meeting, host included. */
export function roomCapacity(limits: Pick<PlanLimits, 'maxParticipants'>, inRoom: number, adding = 1) {
  const free = Math.max(0, limits.maxParticipants - inRoom);
  const fits = Math.min(Math.max(0, adding), free);
  return { free, fits, full: free === 0, allFit: fits === adding };
}

export type CapacityState = 'ok' | 'near' | 'full';
export function capacityStatus(limits: Pick<PlanLimits, 'maxParticipants'>, inRoom: number, warnPercent = 90): CapacityState {
  if (inRoom >= limits.maxParticipants) return 'full';
  if (inRoom >= Math.ceil((limits.maxParticipants * warnPercent) / 100)) return 'near';
  return 'ok';
}

export type DurationState = 'ok' | 'warning' | 'reached';
/** Where a meeting stands against its time limit. */
export function durationStatus(limits: Pick<PlanLimits, 'maxDurationMinutes'>, elapsedSeconds: number, warnMinutesBefore = 5): { state: DurationState; secondsLeft: number } {
  const secondsLeft = Math.max(0, limits.maxDurationMinutes * 60 - Math.max(0, Math.floor(elapsedSeconds)));
  if (secondsLeft === 0) return { state: 'reached', secondsLeft: 0 };
  if (secondsLeft <= warnMinutesBefore * 60) return { state: 'warning', secondsLeft };
  return { state: 'ok', secondsLeft };
}

// ---------------------------------------------------------------------------
// Large rooms: which video tiles to show
// ---------------------------------------------------------------------------

/** How many video tiles fit on one page at a given container width (your own tile included). */
export function tilesPerPage(width: number): number {
  if (width < 640) return 4;
  if (width < 1024) return 9;
  if (width < 1536) return 16;
  return 25;
}

export interface TileCandidate { id: string; isScreenSharing?: boolean; isSpeaking?: boolean; isHandRaised?: boolean; handRaisedAt?: number }

/** Screen sharers, then speakers, then raised hands (in order raised), then join order. Stable. */
export function prioritizeTiles<T extends TileCandidate>(people: T[]): T[] {
  const rank = (p: T) => (p.isScreenSharing ? 0 : p.isSpeaking ? 1 : p.isHandRaised ? 2 : 3);
  return people
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || (a.p.isHandRaised && b.p.isHandRaised ? (a.p.handRaisedAt ?? 0) - (b.p.handRaisedAt ?? 0) : 0) || a.i - b.i)
    .map((x) => x.p);
}

/** One page of remote tiles; the first page keeps a seat for your own tile. */
export function pageOfTiles<T>(people: T[], page: number, perPage: number): { items: T[]; page: number; pages: number } {
  const firstPage = Math.max(1, perPage - 1);
  const rest = Math.max(1, perPage);
  const pages = people.length <= firstPage ? 1 : 1 + Math.ceil((people.length - firstPage) / rest);
  const p = Math.min(Math.max(0, page), pages - 1);
  const start = p === 0 ? 0 : firstPage + (p - 1) * rest;
  const end = p === 0 ? firstPage : start + rest;
  return { items: people.slice(start, end), page: p, pages };
}

export function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return 5;
}
