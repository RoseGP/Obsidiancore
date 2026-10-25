/**
 * Posts and analytics for the current user (server only).
 *
 * Posts live in the user's workspace (Postiz). Every request is scoped to the
 * authenticated user: only channels the user owns are visible or writable, and
 * post ids are checked against the user's server-side post index before any
 * edit or delete — client-supplied ids are never trusted on their own.
 */
import { PLATFORM_DEFINITIONS, type AccountPlatform } from '../shared/types';
import type { SocialAccountsConfig } from './config';
import { GatewayError, type WorkspaceGateway, type WorkspaceMedia, type WorkspacePost } from './gateway';
import type { AccountsService } from './service';
import { AccountsError } from './service';
import type { AccountsStore, StoredConnection, UserDoc } from './store';

export type AppPostStatus = 'draft' | 'scheduled' | 'published' | 'failed';

export interface AppPost {
  id: string;
  accountId: string;
  platform: AccountPlatform;
  accountName: string;
  content: string;
  scheduledAt: string;
  status: AppPostStatus;
  error?: string;
  url?: string;
  editable: boolean;
}

export interface CreatePostInput {
  content: string;
  scheduledAt: string;
  mode: 'draft' | 'schedule';
  accountIds?: string[];
  platforms?: AccountPlatform[];
  mediaUrls: string[];
}

export interface UpdatePostInput { content?: string; scheduledAt?: string; mode?: 'draft' | 'schedule'; mediaUrls?: string[] }

const STATUS: Record<WorkspacePost['state'], AppPostStatus> = { queued: 'scheduled', published: 'published', error: 'failed', draft: 'draft' };
const DAY = 86_400_000;
const platformOf = (identifier: string) => PLATFORM_DEFINITIONS.find((d) => d.postizIdentifier === identifier)?.platform;

export function createPostsService(cfg: SocialAccountsConfig, store: AccountsStore, gateway: WorkspaceGateway, accounts: AccountsService) {
  const nowIso = () => new Date().toISOString();

  async function context(userId: string) {
    if (cfg.postizMode === 'none') throw new AccountsError('Posting isn’t configured on the server (Postiz).', 503, 'not_configured');
    const u = await store.getUser(userId);
    const credential = accounts.credentialFor(u);
    if (!credential) throw new AccountsError('Connect your Postiz workspace in Accounts first.', 409, 'workspace_required');
    return { u, credential };
  }

  /** Channels this user may use: their own Postiz connections, confirmed against the owners table. */
  async function ownedChannels(u: UserDoc, userId: string): Promise<Map<string, StoredConnection>> {
    const conns = u.connections.filter((c) => c.method === 'postiz');
    const owners = await Promise.all(conns.map((c) => store.getOwner(c.externalId)));
    return new Map(conns.filter((_, i) => owners[i] === userId).map((c) => [c.externalId, c]));
  }

  const call = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (err) { throw accounts.mapGatewayError(err); }
  };

  function toApp(p: WorkspacePost, conn: StoredConnection, u: UserDoc): AppPost {
    const status = STATUS[p.state];
    const entry = u.posts?.[p.id];
    return {
      id: p.id, accountId: conn.id, platform: conn.platform, accountName: conn.name, content: p.content,
      scheduledAt: p.publishAt, status, error: status === 'failed' ? p.error || 'Publishing failed.' : undefined,
      url: status === 'published' ? p.releaseUrl : undefined,
      editable: status !== 'published' && !!entry?.createdByApp,
    };
  }

  async function list(userId: string, range: { from: string; to: string }): Promise<AppPost[]> {
    const { u, credential } = await context(userId);
    const owned = await ownedChannels(u, userId);
    const posts = await call(() => gateway.listPosts(credential, range));
    const mine = posts.filter((p) => owned.has(p.channelId));
    // Remember ownership/group for later edits and deletes.
    const updated = await store.updateUser(userId, [], (doc) => {
      doc.posts ??= {};
      for (const p of mine) {
        const prev = doc.posts[p.id];
        doc.posts[p.id] = { connectionId: owned.get(p.channelId)!.id, channelId: p.channelId, group: p.group || prev?.group || '', publishAt: p.publishAt, createdByApp: prev?.createdByApp ?? false, media: prev?.media, updatedAt: nowIso() };
      }
      return doc;
    });
    return mine.map((p) => toApp(p, owned.get(p.channelId)!, updated)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }

  async function uploadAll(credential: string, urls: string[]): Promise<WorkspaceMedia[]> {
    const out: WorkspaceMedia[] = [];
    for (const url of urls) out.push(await call(() => gateway.uploadMediaFromUrl(credential, url)));
    return out;
  }

  async function uploadFile(userId: string, buffer: Buffer, fileName: string, mimeType: string): Promise<WorkspaceMedia> {
    const { credential } = await context(userId);
    if (gateway.uploadMediaFile) {
      return await call(() => gateway.uploadMediaFile!(credential, buffer, fileName, mimeType));
    }
    throw new AccountsError('Direct file upload is not supported by the configured gateway.', 501, 'not_implemented');
  }

  async function create(userId: string, input: CreatePostInput): Promise<AppPost[]> {
    const { u, credential } = await context(userId);
    const owned = await ownedChannels(u, userId);
    const byId = new Map([...owned.values()].map((c) => [c.id, c]));

    // Resolve targets only from the user's own connections.
    let targets: StoredConnection[] = [];
    if (input.accountIds?.length) {
      for (const id of input.accountIds) {
        const c = byId.get(id);
        if (!c) throw new AccountsError('One of the selected accounts isn’t connected to your workspace.', 404, 'account_not_found', 'accountIds');
        targets.push(c);
      }
    } else {
      for (const p of input.platforms ?? []) {
        const c = [...owned.values()].find((x) => x.platform === p);
        if (!c) throw new AccountsError(`Connect a ${PLATFORM_DEFINITIONS.find((d) => d.platform === p)?.label ?? p} account first.`, 409, 'account_required', 'platforms');
        targets.push(c);
      }
    }
    targets = [...new Map(targets.map((t) => [t.id, t])).values()];
    if (!targets.length) throw new AccountsError('Choose at least one account.', 400, 'invalid_input', 'accountIds');

    // The channel must still be in the workspace and enabled.
    const channels = await call(() => gateway.listChannels(credential));
    for (const t of targets) {
      const ch = channels.find((c) => c.id === t.externalId);
      if (!ch) throw new AccountsError(`${t.name} was removed from the workspace. Reconnect it in Accounts.`, 409, 'account_unavailable');
      if (ch.disabled && input.mode === 'schedule') throw new AccountsError(`${t.name} is disabled in Postiz. Reconnect it in Accounts.`, 409, 'account_unavailable');
    }

    const media = await uploadAll(credential, input.mediaUrls);
    const saved = await call(() => gateway.savePosts(credential, {
      mode: input.mode, publishAt: input.scheduledAt,
      items: targets.map((t) => ({ channelId: t.externalId, channelIdentifier: channels.find((c) => c.id === t.externalId)!.identifier, content: input.content, media })),
    }));
    // Read back for ids, groups and states (the create response isn't a stable contract).
    const around = { from: new Date(new Date(input.scheduledAt).getTime() - 60_000).toISOString(), to: new Date(new Date(input.scheduledAt).getTime() + 60_000).toISOString() };
    const fresh = (await call(() => gateway.listPosts(credential, around))).filter((p) => targets.some((t) => t.externalId === p.channelId));
    const savedIds = new Set((saved ?? []).map((p) => p.id));
    const created = savedIds.size ? fresh.filter((p) => savedIds.has(p.id)) : fresh.filter((p) => p.content === input.content);
    const doc = await store.updateUser(userId, [], (d) => {
      d.posts ??= {};
      for (const p of created) {
        d.posts[p.id] = { connectionId: owned.get(p.channelId)!.id, channelId: p.channelId, group: p.group, publishAt: p.publishAt, createdByApp: true, media, updatedAt: nowIso() };
      }
      return d;
    });
    return created.map((p) => toApp(p, owned.get(p.channelId)!, doc));
  }

  /** Finds a post the user owns, re-reading it from the workspace. */
  async function ownedPost(userId: string, postId: string) {
    const { u, credential } = await context(userId);
    const entry = u.posts?.[postId];
    if (!entry) throw new AccountsError('That post wasn’t found.', 404, 'not_found');
    const owned = await ownedChannels(u, userId);
    const conn = owned.get(entry.channelId);
    if (!conn || conn.id !== entry.connectionId) throw new AccountsError('That post wasn’t found.', 404, 'not_found');
    const t = new Date(entry.publishAt).getTime();
    const near = await call(() => gateway.listPosts(credential, { from: new Date(t - 2 * DAY).toISOString(), to: new Date(t + 2 * DAY).toISOString() }));
    const current = near.find((p) => p.id === postId);
    if (!current) throw new AccountsError('That post no longer exists in the workspace.', 404, 'not_found');
    return { u, credential, entry, conn, current, near, owned };
  }

  async function update(userId: string, postId: string, patch: UpdatePostInput): Promise<AppPost> {
    const { credential, entry, conn, current } = await ownedPost(userId, postId);
    if (current.state === 'published') throw new AccountsError('Published posts can’t be edited.', 409, 'published');
    if (!entry.createdByApp && patch.mediaUrls === undefined) {
      // Postiz's post list omits media, so re-saving an outside post could drop its images.
      throw new AccountsError('This post was created outside the app. Edit it in Postiz so its media isn’t lost.', 409, 'external_post');
    }
    const media = patch.mediaUrls !== undefined ? await uploadAll(credential, patch.mediaUrls) : entry.media ?? [];
    const mode = patch.mode ?? (current.state === 'draft' ? 'draft' : 'schedule');
    const publishAt = patch.scheduledAt ?? current.publishAt;
    await call(() => gateway.savePosts(credential, {
      mode, publishAt,
      items: [{ channelId: current.channelId, channelIdentifier: current.channelIdentifier, content: patch.content ?? current.content, media, existingPostId: current.id, group: current.group }],
    }));
    const t = new Date(publishAt).getTime();
    const after = (await call(() => gateway.listPosts(credential, { from: new Date(t - 60_000).toISOString(), to: new Date(t + 60_000).toISOString() }))).find((p) => p.id === postId);
    const doc = await store.updateUser(userId, [], (d) => {
      d.posts ??= {};
      d.posts[postId] = { ...entry, publishAt, media, group: after?.group || entry.group, updatedAt: nowIso() };
      return d;
    });
    return toApp(after ?? { ...current, content: patch.content ?? current.content, publishAt, state: mode === 'draft' ? 'draft' : 'queued' }, conn, doc);
  }

  async function remove(userId: string, postId: string): Promise<{ deletedIds: string[]; wasPublished: boolean }> {
    const { credential, current, near, owned } = await ownedPost(userId, postId);
    // Postiz deletes the whole group: only allow it if every post in it is the user's.
    const group = current.group ? near.filter((p) => p.group === current.group) : [current];
    if (group.some((p) => !owned.has(p.channelId))) throw new AccountsError('This post is shared with channels you don’t own, so it can’t be deleted here.', 403, 'forbidden');
    await call(() => gateway.deletePost(credential, postId));
    const ids = group.map((p) => p.id);
    await store.updateUser(userId, [], (d) => { for (const id of ids) delete d.posts?.[id]; });
    return { deletedIds: ids, wasPublished: current.state === 'published' };
  }

  async function analytics(userId: string, days: number) {
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY);
    const posts = await list(userId, { from: from.toISOString(), to: new Date(to.getTime() + 30 * DAY).toISOString() });
    const past = posts.filter((p) => new Date(p.scheduledAt) <= to);
    const count = (s: AppPostStatus, l = past) => l.filter((p) => p.status === s).length;
    const published = count('published');
    const failed = count('failed');
    const byPlatform: Record<string, { published: number; failed: number }> = {};
    for (const p of past) {
      byPlatform[p.platform] ??= { published: 0, failed: 0 };
      if (p.status === 'published') byPlatform[p.platform].published++;
      if (p.status === 'failed') byPlatform[p.platform].failed++;
    }
    const weeks = Math.ceil(days / 7);
    const weekly = Array.from({ length: weeks }, (_, i) => {
      const start = new Date(to.getTime() - (weeks - i) * 7 * DAY);
      const end = new Date(start.getTime() + 7 * DAY);
      return { weekStart: start.toISOString(), published: past.filter((p) => p.status === 'published' && new Date(p.scheduledAt) >= start && new Date(p.scheduledAt) < end).length };
    });
    return {
      range: { from: from.toISOString(), to: to.toISOString(), days },
      totals: { published, failed, scheduled: count('scheduled', posts), drafts: count('draft', posts) },
      successRate: published + failed ? Math.round((published / (published + failed)) * 1000) / 10 : null,
      byPlatform, weekly,
      engagement: { available: false, reason: 'Postiz’s public API doesn’t provide engagement analytics (likes, reach, clicks).' },
    };
  }

  return { list, create, update, remove, analytics, uploadFile };
}

export type PostsService = ReturnType<typeof createPostsService>;
export { GatewayError };
