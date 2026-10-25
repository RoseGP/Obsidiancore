/**
 * Social planner data model. API records are normalised here so the UI only
 * deals with one shape, whatever the backend or Firestore returned.
 */

export type PlatformId = 'instagram' | 'x' | 'linkedin' | 'tiktok' | 'facebook' | 'youtube' | 'pinterest' | 'threads' | 'bluesky' | 'mastodon';

export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

export interface PlatformInfo {
  id: PlatformId;
  label: string;
  /** Background for post chips (white text must stay ≥ 4.5:1). */
  chip: string;
  /** Solid accent for dots and icons. */
  dot: string;
  charLimit: number;
  /** Platform rejects text-only posts. */
  requiresMedia: boolean;
  /** A publishing adapter exists on the server (src/services/publisher/adapters). */
  autoPublish: boolean;
  /** Shown as a top-level filter (others appear under "All"). */
  primary: boolean;
}

export const PLATFORMS: Record<PlatformId, PlatformInfo> = {
  instagram: { id: 'instagram', label: 'Instagram', chip: 'linear-gradient(135deg,#b42a6d 0%,#8e2fa8 100%)', dot: '#e1306c', charLimit: 2200, requiresMedia: true, autoPublish: false, primary: true },
  x: { id: 'x', label: 'X', chip: '#1565a6', dot: '#4aa8ec', charLimit: 280, requiresMedia: false, autoPublish: true, primary: true },
  linkedin: { id: 'linkedin', label: 'LinkedIn', chip: '#0a5dad', dot: '#3b82f6', charLimit: 3000, requiresMedia: false, autoPublish: true, primary: true },
  tiktok: { id: 'tiktok', label: 'TikTok', chip: '#c3173f', dot: '#f0445a', charLimit: 2200, requiresMedia: true, autoPublish: false, primary: true },
  facebook: { id: 'facebook', label: 'Facebook', chip: '#1659bd', dot: '#4b8cf0', charLimit: 63206, requiresMedia: false, autoPublish: false, primary: true },
  youtube: { id: 'youtube', label: 'YouTube', chip: '#b91c1c', dot: '#ef4444', charLimit: 5000, requiresMedia: true, autoPublish: false, primary: true },
  pinterest: { id: 'pinterest', label: 'Pinterest', chip: '#991b1b', dot: '#dc2626', charLimit: 500, requiresMedia: true, autoPublish: false, primary: false },
  threads: { id: 'threads', label: 'Threads', chip: '#18181b', dot: '#71717a', charLimit: 500, requiresMedia: false, autoPublish: false, primary: true },
  bluesky: { id: 'bluesky', label: 'Bluesky', chip: '#0f62c4', dot: '#3b9cff', charLimit: 300, requiresMedia: false, autoPublish: true, primary: false },
  mastodon: { id: 'mastodon', label: 'Mastodon', chip: '#5636c7', dot: '#8c6cf5', charLimit: 500, requiresMedia: false, autoPublish: true, primary: false },
};

export const PRIMARY_PLATFORMS: PlatformId[] = ['instagram', 'x', 'linkedin', 'tiktok', 'facebook', 'youtube', 'threads'];
export const ALL_PLATFORMS = Object.keys(PLATFORMS) as PlatformId[];

export function normalizePlatform(raw: string): PlatformId | null {
  const p = String(raw || '').toLowerCase().trim();
  if (p === 'twitter' || p === 'x') return 'x';
  if (p === 'thread' || p === 'threads') return 'threads';
  return (p in PLATFORMS ? p : null) as PlatformId | null;
}

export const STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  failed: 'Failed',
};

export function normalizeStatus(raw: string): PostStatus {
  switch (String(raw || '').toLowerCase()) {
    case 'draft': return 'draft';
    case 'processing': case 'publishing': return 'publishing';
    case 'published': return 'published';
    case 'failed': case 'error': return 'failed';
    default: return 'scheduled'; // 'pending' and unknown queue states
  }
}

/** API status for writes. */
export const toApiStatus = (s: 'draft' | 'scheduled') => (s === 'draft' ? 'draft' : 'pending');

export interface PlannerPost {
  id: string;
  content: string;
  platforms: PlatformId[];
  /** Platform strings the UI doesn't know, kept so edits don't drop them. */
  otherPlatforms: string[];
  mediaUrls: string[];
  scheduledAt: string; // ISO
  status: PostStatus;
  failureReason?: string;
  publishedAt?: string;
  createdAt?: string;
}

export function normalizePost(raw: any): PlannerPost | null {
  if (!raw || !raw.id) return null;
  const at = new Date(raw.scheduledAt ?? raw.scheduled_at ?? '');
  if (Number.isNaN(at.getTime())) return null;
  const rawPlatforms: string[] = Array.isArray(raw.platforms) ? raw.platforms : [];
  const platforms: PlatformId[] = [];
  const otherPlatforms: string[] = [];
  for (const p of rawPlatforms) {
    const n = normalizePlatform(p);
    if (n) { if (!platforms.includes(n)) platforms.push(n); } else otherPlatforms.push(String(p));
  }
  return {
    id: String(raw.id),
    content: String(raw.content ?? raw.caption ?? ''),
    platforms,
    otherPlatforms,
    mediaUrls: Array.isArray(raw.mediaUrls) ? raw.mediaUrls.map(String) : [],
    scheduledAt: at.toISOString(),
    status: normalizeStatus(raw.status),
    failureReason: raw.failureReason || raw.failure_reason || undefined,
    publishedAt: raw.publishedAt || undefined,
    createdAt: raw.createdAt || undefined,
  };
}

export interface ConnectedAccount {
  id: string;
  platform: PlatformId | null;
  rawPlatform: string;
  handle: string;
  instanceUrl?: string;
}

export function normalizeAccount(raw: any): ConnectedAccount | null {
  if (!raw || !raw.platform) return null;
  return {
    id: String(raw.id ?? raw.platform),
    platform: normalizePlatform(raw.platform),
    rawPlatform: String(raw.platform),
    handle: String(raw.handle ?? ''),
    instanceUrl: raw.instanceUrl || undefined,
  };
}

/** Editable posts: not live yet and not mid-publish. */
export const isEditable = (p: PlannerPost) => p.status === 'draft' || p.status === 'scheduled' || p.status === 'failed';

/** The chip colour follows the first platform. */
export const primaryPlatform = (p: PlannerPost): PlatformInfo | null => (p.platforms[0] ? PLATFORMS[p.platforms[0]] : null);

export function postTitle(p: PlannerPost, max = 48): string {
  const first = p.content.split(/\n/).find((l) => l.trim()) ?? '';
  const clean = first.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Untitled post';
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
