/** Client for /api/local-seo (Google Business Profile growth platform). Tokens never reach the browser. */
import { getApiAuthHeaders } from '../../../lib/apiAuth';

export class GrowthError extends Error {
  constructor(message: string, public status: number, public code: string, public field?: string) { super(message); }
}

export async function call<T>(devUser: string, path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`/api/local-seo${path}`, {
      ...rest, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(await getApiAuthHeaders(devUser)), ...(rest.headers || {}) },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  } catch { throw new GrowthError('Can’t reach the server. Check your connection.', 0, 'network'); }
  let body: any = null; try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new GrowthError(body?.error || `Request failed (${res.status}).`, res.status, body?.code || 'server', body?.field);
  return body as T;
}

// ---------- Shapes (mirrors of server responses) ----------

export interface Connection { configured: boolean; aiConfigured: boolean; connected: boolean; needsReconnect: boolean; email?: string; connectedAt?: string; selectedCount: number; lastSync?: { at: string; reviews: number; errors: string[] }; settings: { brandVoice: string; signOff: string } }

export interface GLocation {
  name: string; accountName: string; title: string; primaryCategory?: string; primaryCategoryId?: string; additionalCategories: string[]; additionalCategoryIds?: string[];
  address?: { lines: string[]; city?: string; region?: string; postalCode?: string; country?: string };
  phone?: string; website?: string; description?: string; regularHours: { day: string; open: string; close: string }[];
  specialHours?: { startDate: string; endDate: string; closed: boolean; open?: string; close?: string }[];
  serviceItems?: { label: string; description?: string; category?: string }[]; openStatus?: string; mapsUri?: string;
  meta?: { placeId?: string; newReviewUri?: string; hasPendingEdits?: boolean; hasGoogleUpdated?: boolean; hasVoiceOfMerchant?: boolean };
  selected?: boolean;
}

export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Area = 'completeness' | 'localSeo' | 'infoQuality' | 'reputation' | 'content' | 'maintenance';
export interface AuditIssue { title: string; description: string; whyItMatters: string; solution: string; priority: Priority; effort: 'quick' | 'moderate' | 'involved'; effortMinutes: number; expectedBenefit: string; action: { type: string; label: string } }
export interface AuditCheck { id: string; area: Area; label: string; weight: number; status: 'passed' | 'failed' | 'not_checked'; issue?: AuditIssue; note?: string }
export interface AuditResult { overall: number; areas: Record<Area, number | null>; checks: AuditCheck[]; issues: (AuditCheck & { issue: AuditIssue })[]; stats: { reviewCount: number; averageRating: number | null; responseRate: number | null; unanswered: number; unansweredNegative: number; medianReplyHours: number | null; photos: number | null; servicesCount: number; descriptionLength: number }; notes: string[]; generatedAt: string }
export interface ProfileSnapshot { fetchedAt: string; attributes: { name: string; valueType: string; values: any[] }[] | null; availableAttributes: number | null; media: { photos: number; videos: number; latestAt: string | null; hasLogo: boolean; hasCover: boolean; samples: { url: string; category: string; createTime: string }[] } | null; posts: { last30: number; latestAt: string | null; total: number } | null; verification: { state: string } | null; googleUpdated: { diffMask: string[]; pendingMask: string[] } | null; errors: string[] }

export interface DashboardLocation { location: GLocation; reviewCount: number; unanswered: number; averageRating: number | null; growthAudit: { overall: number; areas: Record<Area, number | null>; generatedAt: string; topIssues: (AuditCheck & { issue: AuditIssue })[] } | null; profile: { fetchedAt: string; verification: { state: string } | null } | null }
export interface Dashboard { connection: Connection; locations: DashboardLocation[]; activity: { at: string; type: string; message: string }[]; security: { status: string; alerts: number }; inboxOpen: number; onboarding: { completedAt?: string; dismissedAt?: string }; automation: { enabled: boolean; lastRunAt?: string }; aiConfigured: boolean; placesConfigured: boolean }

export interface ChangeSet { id: string; location: string; locationTitle: string; fields: { field: string; label: string; before: string; after: string }[]; status: 'draft' | 'published' | 'failed' | 'discarded'; source: string; createdAt: string; publishedAt?: string; error?: string; note?: string; pendingReview?: boolean }
export interface PlannedPost { id: string; location: string; kind: string; topicType: 'STANDARD' | 'OFFER' | 'EVENT'; title?: string; summary: string; ctaType: string; ctaUrl?: string; imageIdea?: string; startDate?: string; endDate?: string; date: string; status: 'idea' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'discarded'; scheduledFor?: string; publishedAt?: string; searchUrl?: string; error?: string; source: string }
export interface Review { id: string; locationName: string; locationTitle: string; reviewer: string; reviewerPhoto?: string; rating: number; comment: string; createTime: string; updateTime: string; reply?: { comment: string; updateTime: string }; sentiment: 'Positive' | 'Neutral' | 'Negative'; topics: string[]; draft?: { text: string; tone: string; generatedAt: string; flags: string[] } }
export interface Competitor { id: string; location: string; name: string; source: 'manual' | 'places'; placeId?: string; address?: string; categories: string[]; rating: number | null; reviewCount: number | null; website?: string; description?: string; services: string[]; photoCount: number | null; postsPerMonth: number | null; notes: string; refreshedAt?: string; snapshots: { at: string; rating: number | null; reviewCount: number | null }[] }
export interface InboxItem { id: string; dedupeKey: string; location: string; locationTitle: string; kind: string; title: string; detail: string; priority: Priority; createdAt: string; status: 'open' | 'prepared' | 'done' | 'dismissed'; action?: { type: string; label: string } }

export const AREA_LABEL: Record<Area, string> = { completeness: 'Profile completeness', localSeo: 'Local SEO', infoQuality: 'Information quality', reputation: 'Reputation', content: 'Content', maintenance: 'Maintenance' };
export const PRIORITY_LABEL: Record<Priority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
export const EFFORT_LABEL = { quick: 'Quick fix', moderate: 'Moderate', involved: 'Involved' } as const;
