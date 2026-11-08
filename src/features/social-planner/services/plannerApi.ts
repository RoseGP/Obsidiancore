/**
 * Planner API client for the app's /api/posts routes (backed by the user's
 * Postiz workspace on the server). No client-side sample data.
 */
import { normalizePost, type ConnectedAccount, type PlannerPost, type PlatformId } from '../domain/model';

export class PlannerApiError extends Error {
  constructor(message: string, public status: number, public code = 'server') { super(message); }
}

export interface PlannerApi {
  listPosts(range: { from: Date; to: Date }): Promise<PlannerPost[]>;
  listAccounts(): Promise<ConnectedAccount[]>;
  /** One post per selected platform may be created. */
  createPost(input: { content: string; platforms: PlatformId[]; extraPlatforms?: string[]; scheduledAt: string; mediaUrls: string[]; intent: 'draft' | 'scheduled' | 'now' }): Promise<PlannerPost | PlannerPost[]>;
  updatePost(id: string, patch: Partial<{ content: string; platforms: string[]; scheduledAt: string; mediaUrls: string[]; intent: 'draft' | 'scheduled' }>): Promise<PlannerPost>;
  deletePost(id: string): Promise<void>;
  retryPost(id: string): Promise<void>;
}

const TIMEOUT_MS = 20_000;

/** Maps an /api/posts post to the planner's shape. */
function fromApp(p: any): PlannerPost | null {
  return normalizePost({
    id: p.id, content: p.content, platforms: [p.platform], scheduledAt: p.scheduledAt, mediaUrls: [],
    status: p.status === 'scheduled' ? 'pending' : p.status, failureReason: p.error,
  });
}

export function createPlannerApi(getHeaders: () => Promise<Record<string, string>>): PlannerApi {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(path, { ...init, signal: ctrl.signal, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(await getHeaders()), ...(init.headers || {}) } });
    } catch (err: any) {
      throw new PlannerApiError(err?.name === 'AbortError' ? 'The server took too long to respond.' : 'Can’t reach the server. Check your connection.', 0, 'network');
    } finally { clearTimeout(timer); }
    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw new PlannerApiError(body?.error || `Request failed (${res.status}).`, res.status, body?.code);
    return body as T;
  }
  const one = (raw: any) => { const p = fromApp(raw); if (!p) throw new PlannerApiError('The server returned an unreadable post.', 500); return p; };

  return {
    async listPosts({ from, to }) {
      const q = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
      const body = await call<{ posts: any[] }>(`/api/posts?${q}`);
      return (body.posts ?? []).map(fromApp).filter((p): p is PlannerPost => p !== null);
    },
    async listAccounts() { return []; }, // supplied by the accounts API (see PlannerApp)
    async createPost(input) {
      const body = await call<{ posts: any[] }>('/api/posts', {
        method: 'POST',
        body: JSON.stringify({ content: input.content, scheduledAt: input.scheduledAt, mode: input.intent === 'draft' ? 'draft' : input.intent === 'now' ? 'now' : 'schedule', platforms: input.platforms, mediaUrls: input.mediaUrls }),
      });
      const list = (body.posts ?? []).map(one);
      if (!list.length) throw new PlannerApiError('The post was sent but couldn’t be read back. Refresh the calendar.', 502);
      return list;
    },
    async updatePost(id, patch) {
      const payload: Record<string, unknown> = {};
      if (patch.content !== undefined) payload.content = patch.content;
      if (patch.scheduledAt !== undefined) payload.scheduledAt = patch.scheduledAt;
      if (patch.mediaUrls !== undefined) payload.mediaUrls = patch.mediaUrls;
      if (patch.intent) payload.mode = patch.intent === 'draft' ? 'draft' : 'schedule';
      const body = await call<{ post: any }>(`/api/posts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      return one(body.post);
    },
    async deletePost(id) { await call(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    async retryPost(id) {
      // Postiz has no retry endpoint: reschedule shortly from now.
      await call(`/api/posts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ mode: 'schedule', scheduledAt: new Date(Date.now() + 2 * 60_000).toISOString() }) });
    },
  };
}
