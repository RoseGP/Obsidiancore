/**
 * Channels = connected social accounts plus the posts that target their
 * platform. Pure helpers so the Channels page stays a thin view.
 */
import { PLATFORMS, type ConnectedAccount, type PlannerPost, type PlatformId } from './model';

export interface ChannelSummary {
  /** `platform:<id>` — one channel per platform. */
  key: string;
  platform: PlatformId;
  handle: string;
  connected: boolean;
  accountIds: string[];
  queued: number;
  drafts: number;
  failed: number;
  published: number;
  nextPost: PlannerPost | null;
  lastPublished: PlannerPost | null;
}

export const channelKey = (platform: PlatformId) => `platform:${platform}`;

export type ChannelTab = 'queue' | 'drafts' | 'sent' | 'failed';

const by = (a: PlannerPost, b: PlannerPost) => a.scheduledAt.localeCompare(b.scheduledAt);

export function postsForPlatform(posts: PlannerPost[], platform: PlatformId | null): PlannerPost[] {
  return platform ? posts.filter((p) => p.platforms.includes(platform)) : posts;
}

export function filterByTab(posts: PlannerPost[], tab: ChannelTab): PlannerPost[] {
  switch (tab) {
    case 'queue': return posts.filter((p) => p.status === 'scheduled' || p.status === 'publishing').sort(by);
    case 'drafts': return posts.filter((p) => p.status === 'draft').sort(by);
    case 'sent': return posts.filter((p) => p.status === 'published').sort((a, b) => by(b, a));
    case 'failed': return posts.filter((p) => p.status === 'failed').sort((a, b) => by(b, a));
  }
}

function summarise(platform: PlatformId, posts: PlannerPost[], now: number): Omit<ChannelSummary, 'key' | 'handle' | 'connected' | 'accountIds'> {
  const mine = postsForPlatform(posts, platform);
  const queue = filterByTab(mine, 'queue');
  const sent = filterByTab(mine, 'sent');
  return {
    platform,
    queued: queue.length,
    drafts: mine.filter((p) => p.status === 'draft').length,
    failed: mine.filter((p) => p.status === 'failed').length,
    published: sent.length,
    nextPost: queue.find((p) => new Date(p.scheduledAt).getTime() >= now) ?? queue[0] ?? null,
    lastPublished: sent[0] ?? null,
  };
}

/**
 * One channel per platform (accounts on the same platform are merged — posts
 * target platforms, not individual accounts). Connected channels come first,
 * then platforms that only have posts.
 */
export function buildChannels(accounts: ConnectedAccount[], posts: PlannerPost[], now = Date.now()): ChannelSummary[] {
  const byPlatform = new Map<PlatformId, ConnectedAccount[]>();
  for (const a of accounts) {
    if (!a.platform) continue;
    byPlatform.set(a.platform, [...(byPlatform.get(a.platform) ?? []), a]);
  }
  const out: ChannelSummary[] = [];
  for (const [platform, list] of byPlatform) {
    out.push({
      key: channelKey(platform),
      handle: list.map((a) => a.handle).filter(Boolean).join(', ') || PLATFORMS[platform].label,
      connected: true,
      accountIds: list.map((a) => a.id),
      ...summarise(platform, posts, now),
    });
  }
  const orphan = new Set<PlatformId>();
  for (const p of posts) for (const id of p.platforms) if (!byPlatform.has(id)) orphan.add(id);
  for (const platform of orphan) {
    out.push({ key: channelKey(platform), handle: PLATFORMS[platform].label, connected: false, accountIds: [], ...summarise(platform, posts, now) });
  }
  return out.sort((a, b) => Number(b.connected) - Number(a.connected) || PLATFORMS[a.platform].label.localeCompare(PLATFORMS[b.platform].label));
}

/** Workspace totals; counts each post once even when it targets several channels. */
export function channelTotals(channels: ChannelSummary[], posts: PlannerPost[]) {
  return {
    connected: channels.filter((c) => c.connected).length,
    queued: filterByTab(posts, 'queue').length,
    drafts: filterByTab(posts, 'drafts').length,
    failed: filterByTab(posts, 'failed').length,
    published: filterByTab(posts, 'sent').length,
  };
}
