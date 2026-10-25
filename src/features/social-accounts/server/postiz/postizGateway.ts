/**
 * Postiz implementation of WorkspaceGateway (server only).
 *
 * Only endpoints verified in the Postiz source (github.com/gitroomhq/postiz-app,
 * main, Oct 2026) are used — see docs/social-accounts/POSTIZ_CAPABILITIES.md:
 *
 *   POST   /oauth/token                         api/routes/oauth.controller.ts
 *   GET    /public/v1/me                        public-api/routes/v1/public.integrations.controller.ts
 *   GET    /public/v1/integrations              (same)
 *   GET    /public/v1/social/:integration       (same)  → { url } provider consent screen
 *   DELETE /public/v1/integrations/:id          (same)  also deletes that channel's posts
 *   GET    /public/v1/posts?startDate&endDate   (same)  whole workspace, filtered by caller
 *   POST   /public/v1/posts                     (same)  create; with group + value[].id = update in place
 *   DELETE /public/v1/posts/:id                 (same)  deletes the post's whole group
 *   POST   /public/v1/upload-from-url           (same)  → { id, path }
 *   POST   /enterprise/url                      api/routes/enterprise.controller.ts (self-hosted)
 *
 * Auth: raw API key or `pos_…` token in Authorization, no "Bearer" prefix.
 * Postiz has no public analytics endpoint and no API to revoke a pos_ token.
 */
import crypto from 'node:crypto';
import { GatewayError, type SavePostInput, type WorkspaceChannel, type WorkspaceGateway, type WorkspacePost, type WorkspacePostState } from '../gateway';

const TIMEOUT = 15_000;

async function http(url: string, init: RequestInit = {}): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err: any) {
    throw new GatewayError(err?.name === 'AbortError' ? 'Postiz didn’t respond in time.' : 'Postiz couldn’t be reached.', 0, 'unavailable');
  } finally { clearTimeout(t); }
  const text = await res.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* plain text */ }
  if (!res.ok) {
    // Postiz error bodies: { msg } or Nest { message }; validation: { provider, name, error }.
    const raw = (body && (body.msg || body.error || body.message || body.error_description)) || `Postiz returned ${res.status}.`;
    const msg = String(Array.isArray(raw) ? raw.join(', ') : raw).slice(0, 300);
    const kind = res.status === 401 || res.status === 403 ? 'unauthorized' : res.status === 404 ? 'not_found' : res.status === 400 ? 'not_allowed' : res.status >= 500 ? 'unavailable' : 'other';
    throw new GatewayError(msg, res.status, kind);
  }
  return body;
}

const STATE: Record<string, WorkspacePostState> = { QUEUE: 'queued', PUBLISHED: 'published', ERROR: 'error', DRAFT: 'draft' };

function toPost(p: any): WorkspacePost | null {
  if (!p?.id || !p?.integration?.id) return null;
  return {
    id: String(p.id),
    group: String(p.group ?? ''),
    channelId: String(p.integration.id),
    channelIdentifier: String(p.integration.providerIdentifier ?? ''),
    content: String(p.content ?? ''),
    publishAt: new Date(p.publishDate).toISOString(),
    state: STATE[String(p.state)] ?? 'queued',
    error: p.error ? String(p.error).slice(0, 500) : undefined,
    releaseUrl: typeof p.releaseURL === 'string' ? p.releaseURL : undefined,
  };
}

export function signHs256(payload: object, secret: string): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc({ ...payload, iat: Math.floor(Date.now() / 1000) });
  return `${head}.${body}.${crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}

export function createPostizGateway(apiUrl: string): WorkspaceGateway {
  const pub = `${apiUrl}/public/v1`;
  const auth = (credential: string) => ({ Authorization: credential });
  const json = (credential: string) => ({ ...auth(credential), 'Content-Type': 'application/json' });

  return {
    async exchangeCode(code, clientId, clientSecret, redirectUri) {
      const body = await http(`${apiUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, ...(redirectUri ? { redirect_uri: redirectUri } : {}) }),
      });
      const token = body?.access_token;
      if (typeof token !== 'string' || !token.startsWith('pos_')) throw new GatewayError('Postiz returned an unexpected token response.', 502, 'bad_response');
      return token;
    },

    async describeWorkspace(credential) {
      const me = await http(`${pub}/me`, { headers: auth(credential) });
      return { id: me?.organization?.id, name: me?.organization?.name };
    },

    async listChannels(credential): Promise<WorkspaceChannel[]> {
      const body = await http(`${pub}/integrations`, { headers: auth(credential) });
      if (!Array.isArray(body)) throw new GatewayError('Postiz returned an unexpected channel list.', 502, 'bad_response');
      return body.filter((i: any) => i && typeof i.id === 'string').map((i: any) => ({
        id: i.id, name: String(i.name ?? ''), identifier: String(i.identifier ?? ''), picture: i.picture ?? null, disabled: !!i.disabled, profile: i.profile ?? null,
      }));
    },

    async connectUrl(credential, identifier, refreshChannelId) {
      const q = refreshChannelId ? `?refresh=${encodeURIComponent(refreshChannelId)}` : '';
      const body = await http(`${pub}/social/${encodeURIComponent(identifier)}${q}`, { headers: auth(credential) });
      if (typeof body?.url !== 'string' || !/^https:\/\//i.test(body.url)) throw new GatewayError('Postiz didn’t return an authorization link for this platform.', 502, 'bad_response');
      return body.url;
    },

    async connectUrlWithReturn(secret, input) {
      const token = signHs256({ apiKey: input.apiKey, provider: input.identifier, redirectUrl: input.redirectUrl, refreshId: input.refreshChannelId, webhookUrl: '' }, secret);
      const body = await http(`${apiUrl}/enterprise/url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ params: token }) });
      const url = typeof body === 'string' ? body : body?.url;
      if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new GatewayError('Postiz didn’t return an authorization link. Check POSTIZ_ENTERPRISE_JWT_SECRET.', 502, 'bad_response');
      return url;
    },

    async deleteChannel(credential, channelId) {
      await http(`${pub}/integrations/${encodeURIComponent(channelId)}`, { method: 'DELETE', headers: auth(credential) });
    },

    async listPosts(credential, range) {
      const q = new URLSearchParams({ startDate: range.from, endDate: range.to });
      const body = await http(`${pub}/posts?${q}`, { headers: auth(credential) });
      const list = Array.isArray(body?.posts) ? body.posts : [];
      return list.map(toPost).filter((p: WorkspacePost | null): p is WorkspacePost => p !== null);
    },

    async savePosts(credential, input: SavePostInput) {
      // CreatePostDto: { type, date, shortLink, tags, posts: [{ integration:{id}, group?, value:[{id?, content, image}], settings:{ __type } }] }
      const payload = {
        type: input.mode,
        date: input.publishAt,
        shortLink: false,
        tags: [],
        posts: input.items.map((it) => ({
          integration: { id: it.channelId },
          ...(it.group ? { group: it.group } : {}),
          value: [{ ...(it.existingPostId ? { id: it.existingPostId } : {}), content: it.content, image: it.media.map((m) => ({ id: m.id, path: m.path })) }],
          settings: { __type: it.channelIdentifier },
        })),
      };
      const body = await http(`${pub}/posts`, { method: 'POST', headers: json(credential), body: JSON.stringify(payload) });
      // Response shape isn't a documented contract; callers re-read posts when this is null.
      if (Array.isArray(body)) {
        const posts = body.map((p: any) => (p?.postId ? { id: String(p.postId), group: '', channelId: String(p.integration ?? ''), channelIdentifier: '', content: '', publishAt: input.publishAt, state: (input.mode === 'draft' ? 'draft' : 'queued') as WorkspacePostState } : toPost(p))).filter(Boolean) as WorkspacePost[];
        return posts.length ? posts : null;
      }
      return null;
    },

    async deletePost(credential, postId) {
      await http(`${pub}/posts/${encodeURIComponent(postId)}`, { method: 'DELETE', headers: auth(credential) });
    },

    async uploadMediaFromUrl(credential, url) {
      const body = await http(`${pub}/upload-from-url`, { method: 'POST', headers: json(credential), body: JSON.stringify({ url }) });
      if (!body?.id || !body?.path) throw new GatewayError('Postiz didn’t accept that media file.', 502, 'bad_response');
      return { id: String(body.id), path: String(body.path) };
    },

    async uploadMediaFile(credential, buffer, fileName, mimeType) {
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: mimeType }), fileName);
      const res = await fetch(`${pub}/upload`, {
        method: 'POST',
        headers: { Authorization: credential },
        body: form,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new GatewayError(`Postiz media upload failed (${res.status}): ${errText}`, res.status, 'bad_response');
      }
      const body: any = await res.json().catch(() => null);
      if (!body?.id || !body?.path) throw new GatewayError('Postiz didn’t return a valid media ID and path.', 502, 'bad_response');
      return { id: String(body.id), path: String(body.path) };
    },
  };
}
