/**
 * Stored shapes for the growth features (per user, inside GbpDoc.growth), plus
 * retention rules. Kept bounded: Firestore documents are capped at 1 MiB.
 */
import type { GAttribute, GSpecialHours, LocationPatch } from './googleGateway';
import type { AuditResult } from './audit';

export interface ProfileSnapshot {
  fetchedAt: string;
  attributes: GAttribute[] | null;
  availableAttributes: number | null;
  media: { photos: number; videos: number; latestAt: string | null; hasLogo: boolean; hasCover: boolean; samples: { url: string; category: string; createTime: string; name?: string }[] } | null;
  posts: { last30: number; latestAt: string | null; total: number } | null;
  verification: { state: string; hasBusinessAuthority: boolean } | null;
  googleUpdated: { diffMask: string[]; pendingMask: string[]; checkedAt: string } | null;
  /** Tracked fields, to notice changes made outside this app. */
  fingerprint: Record<string, string>;
  errors: string[];
}

export interface AuditRecord { at: string; overall: number; areas: AuditResult['areas']; issues: number }

export interface ChangeField { field: string; label: string; before: string; after: string }
export interface ChangeSet {
  id: string;
  location: string;
  locationTitle: string;
  fields: ChangeField[];
  patch: LocationPatch;
  attributes?: { name: string; valueType: string; values?: any[]; uriValues?: string[] }[];
  status: 'draft' | 'published' | 'failed' | 'discarded';
  source: 'user' | 'ai' | 'automation';
  createdAt: string;
  publishedAt?: string;
  error?: string;
  note?: string;
  /** Google asked to review the edit before it appears. */
  pendingReview?: boolean;
}

export type PostTopic = 'STANDARD' | 'OFFER' | 'EVENT';
export type PostKind = 'update' | 'promotion' | 'offer' | 'event' | 'announcement' | 'seasonal' | 'product' | 'service';
export interface PlannedPost {
  id: string;
  location: string;
  kind: PostKind;
  topicType: PostTopic;
  title?: string;
  summary: string;
  ctaType: 'NONE' | 'LEARN_MORE' | 'BOOK' | 'ORDER' | 'SIGN_UP' | 'CALL';
  ctaUrl?: string;
  imageIdea?: string;
  startDate?: string;
  endDate?: string;
  /** Planned calendar day. */
  date: string;
  status: 'idea' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'discarded';
  /** ISO time to publish; set only by the user (that's the approval). */
  scheduledFor?: string;
  approvedAt?: string;
  publishedAt?: string;
  googleName?: string;
  searchUrl?: string;
  error?: string;
  source: 'ai' | 'user';
  createdAt: string;
}

export interface CompetitorSnapshot { at: string; rating: number | null; reviewCount: number | null; photoCount: number | null }
export interface Competitor {
  id: string;
  location: string;
  name: string;
  source: 'manual' | 'places';
  placeId?: string;
  address?: string;
  categories: string[];
  rating: number | null;
  reviewCount: number | null;
  website?: string;
  description?: string;
  services: string[];
  photoCount: number | null;
  postsPerMonth: number | null;
  notes: string;
  addedAt: string;
  refreshedAt?: string;
  snapshots: CompetitorSnapshot[];
}

export type InboxKind = 'missing_info' | 'unanswered_review' | 'negative_review' | 'outdated_hours' | 'services' | 'content' | 'performance' | 'security' | 'audit';
export interface InboxItem {
  id: string;
  dedupeKey: string;
  location: string;
  locationTitle: string;
  kind: InboxKind;
  title: string;
  detail: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  createdAt: string;
  status: 'open' | 'prepared' | 'done' | 'dismissed';
  /** Something the user can approve in one step (a change set, a post or a reply draft). */
  prepared?: { type: 'change' | 'post' | 'reply'; refId: string; label: string };
  action?: { type: string; label: string };
}

export interface SecurityEvent {
  id: string;
  at: string;
  kind: 'connection' | 'token' | 'scope' | 'location_access' | 'external_change' | 'google_update' | 'verification' | 'publish' | 'access';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  location?: string;
}

export interface AccessEntry { at: string; action: string; method: string; ip: string; agent: string }

export interface GrowthData {
  profiles: Record<string, ProfileSnapshot>;
  audits: Record<string, AuditResult>;
  auditHistory: Record<string, AuditRecord[]>;
  changes: ChangeSet[];
  posts: PlannedPost[];
  competitors: Competitor[];
  visibility: { keywords: string[]; areas: string[] };
  inbox: InboxItem[];
  security: SecurityEvent[];
  access: AccessEntry[];
  automation: { enabled: boolean; lastRunAt?: string; lastError?: string };
  notifications: { inApp: boolean; kinds: Partial<Record<InboxKind, boolean>> };
  keywords: Record<string, { at: string; from: string; to: string; rows: { keyword: string; value: number | null; threshold: number | null }[] }>;
  assistant: { role: 'user' | 'assistant'; content: string; at: string }[];
  onboarding: { completedAt?: string; dismissedAt?: string };
}

export const emptyGrowth = (): GrowthData => ({
  profiles: {}, audits: {}, auditHistory: {}, changes: [], posts: [], competitors: [], visibility: { keywords: [], areas: [] },
  inbox: [], security: [], access: [], automation: { enabled: true }, notifications: { inApp: true, kinds: {} },
  keywords: {}, assistant: [], onboarding: {},
});

const DAY = 86_400_000;
/** Places content may be cached for at most 30 days (Google Maps Platform terms). */
export const PLACES_RETENTION_DAYS = 30;

export function pruneGrowth(g: GrowthData, now = Date.now()) {
  g.changes = g.changes.slice(-200);
  g.posts = g.posts.filter((p) => p.status !== 'discarded' || now - Date.parse(p.createdAt) < 30 * DAY).slice(-200);
  g.inbox = g.inbox.filter((i) => i.status === 'open' || i.status === 'prepared' || now - Date.parse(i.createdAt) < 60 * DAY).slice(-200);
  g.security = g.security.slice(-200);
  g.access = g.access.slice(-300);
  g.assistant = g.assistant.slice(-40);
  for (const k of Object.keys(g.auditHistory)) g.auditHistory[k] = g.auditHistory[k].slice(-60);
  for (const c of g.competitors) {
    if (c.source === 'places') {
      c.snapshots = c.snapshots.filter((s) => now - Date.parse(s.at) < PLACES_RETENTION_DAYS * DAY);
      if (c.refreshedAt && now - Date.parse(c.refreshedAt) >= PLACES_RETENTION_DAYS * DAY) {
        // Expired Places content: keep only the place id and the user's own notes.
        Object.assign(c, { rating: null, reviewCount: null, photoCount: null, address: undefined, website: undefined, description: undefined, categories: [], refreshedAt: undefined });
      }
    } else c.snapshots = c.snapshots.slice(-60);
  }
  g.competitors = g.competitors.slice(-50);
  for (const k of Object.keys(g.keywords)) if (now - Date.parse(g.keywords[k].at) > 35 * DAY) delete g.keywords[k];
}

export type { GSpecialHours };
