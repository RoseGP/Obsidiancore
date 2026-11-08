/**
 * Meeting plans: one definition shared by the server (/api/meetings/plan) and the meeting UI.
 *
 *   Standard    up to 100 participants, 60-minute meetings
 *   Premium     up to 250 participants, no time limit
 *   Enterprise  up to 500 participants, no time limit
 *
 * Participant counts include the host. The plan belongs to the organization; a meeting keeps the limits it
 * started with, so changing the plan mid-meeting never cuts anyone off.
 */

export type MeetingPlanTier = 'standard' | 'premium' | 'enterprise';

export interface MeetingPlanConfig {
  tier: MeetingPlanTier;
  label: string;
  /** Everyone in the room, host included. */
  maxParticipants: number;
  /** 0 = no limit. */
  maxDurationMinutes: number;
}

export const MEETING_PLANS: Record<MeetingPlanTier, MeetingPlanConfig> = {
  standard: { tier: 'standard', label: 'Standard', maxParticipants: 100, maxDurationMinutes: 60 },
  premium: { tier: 'premium', label: 'Premium', maxParticipants: 250, maxDurationMinutes: 0 },
  enterprise: { tier: 'enterprise', label: 'Enterprise', maxParticipants: 500, maxDurationMinutes: 0 },
};

export const MEETING_PLAN_TIERS: MeetingPlanTier[] = ['standard', 'premium', 'enterprise'];
export const DEFAULT_MEETING_PLAN: MeetingPlanTier = 'standard';
/** The time-limit warning starts this many minutes before the end. */
export const DURATION_WARNING_MINUTES = 5;

export function isMeetingPlanTier(v: unknown): v is MeetingPlanTier {
  return v === 'standard' || v === 'premium' || v === 'enterprise';
}

export function planSummary(p: MeetingPlanConfig): string {
  return `${p.maxParticipants} participants · ${p.maxDurationMinutes ? `${p.maxDurationMinutes}-minute meetings` : 'no time limit'}`;
}

/** The smallest plan that fits `count` people, or null when even Enterprise is too small. */
export function planForSize(count: number): MeetingPlanTier | null {
  return MEETING_PLAN_TIERS.find((t) => MEETING_PLANS[t].maxParticipants >= count) ?? null;
}

/**
 * Room capacity. `inRoom` counts everyone already in the meeting, host included.
 * Returns how many of `adding` people fit and how many seats are left afterwards.
 */
export function roomCapacity(limits: Pick<MeetingPlanConfig, 'maxParticipants'>, inRoom: number, adding = 1) {
  const free = Math.max(0, limits.maxParticipants - inRoom);
  const fits = Math.min(Math.max(0, adding), free);
  return { free, fits, full: free === 0, allFit: fits === adding };
}

export type DurationState = 'unlimited' | 'ok' | 'warning' | 'reached';

/** Where a meeting stands against its time limit. */
export function durationStatus(limits: Pick<MeetingPlanConfig, 'maxDurationMinutes'>, elapsedSeconds: number): { state: DurationState; secondsLeft: number | null } {
  if (!limits.maxDurationMinutes) return { state: 'unlimited', secondsLeft: null };
  const secondsLeft = Math.max(0, limits.maxDurationMinutes * 60 - Math.max(0, Math.floor(elapsedSeconds)));
  if (secondsLeft === 0) return { state: 'reached', secondsLeft: 0 };
  if (secondsLeft <= DURATION_WARNING_MINUTES * 60) return { state: 'warning', secondsLeft };
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

/**
 * Order for the grid: people sharing their screen, then whoever is speaking, then raised hands
 * (in the order raised), then everyone else in join order. Stable, so tiles don't jump around.
 */
export function prioritizeTiles<T extends TileCandidate>(people: T[]): T[] {
  const rank = (p: T) => (p.isScreenSharing ? 0 : p.isSpeaking ? 1 : p.isHandRaised ? 2 : 3);
  return people
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || (a.p.isHandRaised && b.p.isHandRaised ? (a.p.handRaisedAt ?? 0) - (b.p.handRaisedAt ?? 0) : 0) || a.i - b.i)
    .map((x) => x.p);
}

/** One page of remote tiles; the first page keeps a seat for your own tile. */
export function pageOfTiles<T>(people: T[], page: number, perPage: number): { items: T[]; page: number; pages: number } {
  const firstPage = Math.max(1, perPage - 1); // your own tile takes one seat on page 1
  const rest = Math.max(1, perPage);
  const pages = people.length <= firstPage ? 1 : 1 + Math.ceil((people.length - firstPage) / rest);
  const p = Math.min(Math.max(0, page), pages - 1);
  const start = p === 0 ? 0 : firstPage + (p - 1) * rest;
  const end = p === 0 ? firstPage : start + rest;
  return { items: people.slice(start, end), page: p, pages };
}

/** Grid columns for a page with `count` tiles (keeps tiles close to 16:9). */
export function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return 5;
}
