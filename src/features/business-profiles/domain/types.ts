/**
 * Business Profile Manager: shared types (client + server).
 *
 * The CRM keeps its own record of each business profile (the "source of truth" the team edits).
 * External listings such as Google Business Profile are linked to it and only changed through an
 * explicit, previewed and confirmed publish.
 */

export const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
export type Day = (typeof DAYS)[number];

export interface TimePeriod { open: string; close: string } // "HH:MM"; close may be "24:00"; close <= open means it runs past midnight
export interface DayHours { closed: boolean; periods: TimePeriod[] }
export interface SpecialHours { date: string; closed: boolean; periods: TimePeriod[]; note?: string }

export interface PostalAddress { line1: string; line2?: string; city: string; region?: string; postalCode?: string; country: string }
export interface ServiceItem { name: string; description?: string }
export interface MediaItem { kind: 'logo' | 'cover' | 'photo'; url: string; caption?: string; addedAt: string }

/** Everything a user can edit on a profile. */
export interface BusinessProfileData {
  name: string;
  legalName?: string;
  description: string;
  primaryCategory: string;
  additionalCategories: string[];
  phone: string;
  additionalPhones: string[];
  email?: string;
  website?: string;
  /** Storefront address. Optional for service-area businesses. */
  address?: PostalAddress;
  /** True when customers are served at their location and the street address should not be shown. */
  hideAddress: boolean;
  serviceAreas: string[];
  hours: Partial<Record<Day, DayHours>>;
  specialHours: SpecialHours[];
  services: ServiceItem[];
  attributes: string[];
  media: MediaItem[];
  openingDate?: string; // YYYY-MM-DD
}

/**
 * Server-enforced roles, per profile.
 *   viewer   read the profile, audits and history
 *   editor   + edit, run audits, request AI suggestions
 *   manager  + link listings, publish to external listings, archive/restore
 *   owner    + manage members, delete
 */
export const ROLES = ['viewer', 'editor', 'manager', 'owner'] as const;
export type Role = (typeof ROLES)[number];
export const roleRank = (r: Role | undefined) => (r ? ROLES.indexOf(r) : -1);
export const can = {
  view: (r?: Role) => roleRank(r) >= 0,
  edit: (r?: Role) => roleRank(r) >= 1,
  publish: (r?: Role) => roleRank(r) >= 2,
  manageMembers: (r?: Role) => r === 'owner',
};

export type ProfileStatus = 'draft' | 'active' | 'archived';

/** Where a value or finding came from. Shown on every audit finding and suggestion in the UI. */
export type Provenance = 'verified' | 'algorithmic' | 'ai';

export type FindingStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Level = 'high' | 'medium' | 'low';
export type FindingCategory = 'completeness' | 'accuracy' | 'content' | 'freshness' | 'media' | 'consistency';

export interface AuditFinding {
  checkId: string;
  category: FindingCategory;
  status: FindingStatus;
  severity: Severity;
  impact: Level;
  effort: Level;
  title: string;
  /** Plain-language explanation of what was found. */
  explanation: string;
  /** What to do about it (empty when passed). */
  recommendation: string;
  /** Form field to jump to when fixing. */
  field?: string;
  /** Short evidence string, e.g. the conflicting values. */
  evidence?: string;
  source: Provenance;
  priority: number;
}

export interface AuditResult {
  engineVersion: string;
  ranAt: string;
  profileVersion: number;
  /** 0–100 health score over the checks that could be run. This app's diagnostic, not a Google metric. */
  score: number;
  /** 0–100 share of core fields filled in. */
  completeness: number;
  /** Share of checks that could be evaluated (unknown = could not be checked). */
  coverage: number;
  categoryScores: Partial<Record<FindingCategory, number>>;
  counts: { pass: number; warn: number; fail: number; unknown: number };
  findings: AuditFinding[];
  /** Failed and warning findings, highest priority first. */
  priorities: AuditFinding[];
  listing?: { provider: string; externalId: string; snapshotAt?: string };
}

export interface AuditSummary {
  id: string;
  ranAt: string;
  ranBy: string;
  profileVersion: number;
  score: number;
  completeness: number;
  coverage: number;
  counts: AuditResult['counts'];
  topIssues: string[];
}

export interface FieldChange { field: string; before: string; after: string }
export type ChangeSource = 'manual' | 'ai_suggestion' | 'import' | 'review' | 'system';
export interface ChangeEntry {
  id: string;
  at: string;
  by: string;
  action: 'create' | 'update' | 'status' | 'members' | 'link' | 'unlink' | 'publish' | 'review';
  source: ChangeSource;
  version: number;
  summary: string;
  fields?: FieldChange[];
}

export type SuggestionKind = 'description' | 'services';
export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  createdAt: string;
  createdBy: string;
  basedOnVersion: number;
  /** Proposed text (description) or proposed service descriptions keyed by service name. */
  text?: string;
  services?: ServiceItem[];
  /** Deterministic grounding and policy checks run on the AI output. */
  flags: string[];
  /** Facts from the profile the model said it used (for the reviewer). */
  factsUsed: string[];
  status: 'pending' | 'applied' | 'dismissed';
  model: string;
}

/** Fields of a linked listing as read from the provider's API. */
export interface ListingSnapshot {
  name?: string;
  primaryCategory?: string;
  additionalCategories?: string[];
  phone?: string;
  website?: string;
  description?: string;
  addressLines?: string[];
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  hours?: { day: string; open: string; close: string }[];
  hasSpecialHours?: boolean;
  serviceCount?: number;
  mapsUri?: string;
}

export type PublishableField = 'phone' | 'website' | 'description';
export interface ListingLink {
  provider: 'google_business_profile';
  externalId: string;
  title: string;
  linkedAt: string;
  linkedBy: string;
  snapshot?: ListingSnapshot;
  snapshotAt?: string;
}

export interface PublishRecord {
  id: string;
  at: string;
  by: string;
  provider: string;
  externalId: string;
  fields: PublishableField[];
  outcome: 'success' | 'failed';
  message: string;
}

export interface BusinessProfile {
  id: string;
  status: ProfileStatus;
  version: number;
  data: BusinessProfileData;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  members: Record<string, Role>;
  memberIds: string[];
  lastReviewedAt?: string;
  lastReviewedBy?: string;
  hoursVerifiedAt?: string;
  audits: AuditSummary[];
  lastAudit?: AuditResult;
  changes: ChangeEntry[];
  suggestions: Suggestion[];
  listings: ListingLink[];
  publishLog: PublishRecord[];
}

/** List-row view returned by GET /api/business-profiles. */
export interface ProfileSummaryView {
  id: string;
  name: string;
  primaryCategory: string;
  city?: string;
  status: ProfileStatus;
  role: Role;
  version: number;
  updatedAt: string;
  score: number;
  completeness: number;
  counts: AuditResult['counts'];
  topIssue?: string;
  lastAuditAt?: string;
  auditStale: boolean;
  stale: string[];
  linked: boolean;
}

export const emptyProfileData = (): BusinessProfileData => ({
  name: '', description: '', primaryCategory: '', additionalCategories: [], phone: '', additionalPhones: [],
  hideAddress: false, serviceAreas: [], hours: {}, specialHours: [], services: [], attributes: [], media: [],
});
