/**
 * Provider-neutral interface for a social "workspace" service (Postiz today).
 * Business logic (service.ts, postsService.ts) depends only on this file;
 * all Postiz-specific URLs, headers and payload shapes live in ./postiz/.
 */

export type GatewayErrorKind = 'unauthorized' | 'not_allowed' | 'not_found' | 'unavailable' | 'bad_response' | 'other';

export class GatewayError extends Error {
  constructor(message: string, public status: number, public kind: GatewayErrorKind) { super(message); }
}

export interface WorkspaceChannel {
  id: string;
  name: string;
  /** Provider key, e.g. "instagram", "linkedin". */
  identifier: string;
  picture?: string | null;
  disabled: boolean;
  profile?: string | null;
}

export type WorkspacePostState = 'queued' | 'published' | 'error' | 'draft';

export interface WorkspacePost {
  id: string;
  group: string;
  channelId: string;
  channelIdentifier: string;
  content: string;
  publishAt: string; // ISO
  state: WorkspacePostState;
  error?: string;
  releaseUrl?: string;
}

export interface WorkspaceMedia { id: string; path: string }

export interface SavePostInput {
  /** 'draft' keeps it unscheduled; 'schedule' publishes at `publishAt`; 'now' publishes immediately. */
  mode: 'draft' | 'schedule' | 'now';
  publishAt: string;
  items: {
    channelId: string;
    channelIdentifier: string;
    content: string;
    media: WorkspaceMedia[];
    /** Set both to update an existing post in place. */
    existingPostId?: string;
    group?: string;
  }[];
}

export interface WorkspaceGateway {
  /** OAuth authorization-code exchange → long-lived workspace access token. */
  exchangeCode(code: string, clientId: string, clientSecret: string, redirectUri?: string): Promise<string>;
  describeWorkspace(credential: string): Promise<{ id?: string; name?: string }>;
  listChannels(credential: string): Promise<WorkspaceChannel[]>;
  /** Provider consent URL for connecting (or refreshing) a channel. */
  connectUrl(credential: string, identifier: string, refreshChannelId?: string): Promise<string>;
  /** Self-hosted only: consent URL that returns to `redirectUrl` afterwards. */
  connectUrlWithReturn?(secret: string, input: { apiKey: string; identifier: string; redirectUrl: string; refreshChannelId?: string }): Promise<string>;
  deleteChannel(credential: string, channelId: string): Promise<void>;
  listPosts(credential: string, range: { from: string; to: string }): Promise<WorkspacePost[]>;
  savePosts(credential: string, input: SavePostInput): Promise<WorkspacePost[] | null>;
  /** Deletes the post's whole group. */
  deletePost(credential: string, postId: string): Promise<void>;
  uploadMediaFromUrl(credential: string, url: string): Promise<WorkspaceMedia>;
  uploadMediaFile?(credential: string, buffer: Buffer, fileName: string, mimeType: string): Promise<WorkspaceMedia>;
}
