/**
 * Postiz Public API & Integration Type Definitions
 * Conforms strictly to official Postiz Public API v1: https://docs.postiz.com/public-api
 */

export type PostizPlatformIdentifier =
  | 'x'
  | 'twitter'
  | 'linkedin'
  | 'linkedin-page'
  | 'facebook'
  | 'facebook-page'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'pinterest'
  | 'reddit'
  | 'threads'
  | 'mastodon'
  | 'bluesky'
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'medium'
  | 'wordpress'
  | string;

export interface PostizIntegration {
  id: string;
  name: string;
  identifier: PostizPlatformIdentifier;
  disabled: boolean;
  picture?: string;
  profile?: string;
  createdAt?: string;
  updatedAt?: string;
  platformDetails?: {
    platform: string;
    accountName?: string;
    accountId?: string;
  };
}

export interface PostizMediaItem {
  id: string;
  path: string;
  mimeType?: string;
  name?: string;
  size?: number;
}

export interface PostizSinglePostValue {
  content: string;
  id?: string;
  media?: Array<{
    id: string;
    path: string;
  }>;
}

export interface PostizPostConfigItem {
  integration: {
    id: string;
  };
  value: PostizSinglePostValue[];
  settings?: Record<string, any>;
}

export type PostizPublishType = 'now' | 'schedule' | 'draft';

export interface PostizCreatePostRequest {
  type: PostizPublishType;
  date: string; // ISO 8601 format required
  shortLink?: boolean;
  tags?: string[];
  posts: PostizPostConfigItem[];
}

export interface PostizPostResponse {
  id: string;
  type: PostizPublishType;
  date: string;
  status?: 'scheduled' | 'published' | 'draft' | 'failed' | 'processing';
  releaseId?: string;
  posts: Array<{
    id?: string;
    integration: {
      id: string;
      name?: string;
      identifier?: string;
      picture?: string;
    };
    value: PostizSinglePostValue[];
    settings?: Record<string, any>;
    status?: string;
    error?: string;
    postId?: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
}

export type PostizAuthStatus = 'active' | 'revoked' | 'expired' | 'disconnected';

export interface PostizCredentialRecord {
  userId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  iv: string;
  authTag: string;
  refreshIv?: string;
  refreshAuthTag?: string;
  status: PostizAuthStatus;
  expiresAt?: number;
  userEmail?: string;
  workspaceId?: string;
  connectedAt: string;
  updatedAt: string;
  reconnectReason?: string;
  authType: 'oauth' | 'api_key';
}

export interface PostizWebhookPayload {
  event: 'post.published' | 'post.failed' | 'post.scheduled' | 'channel.disconnected' | 'integration.revoked';
  timestamp: string;
  data: {
    postId?: string;
    integrationId?: string;
    status?: string;
    error?: string;
    publishedUrl?: string;
  };
}
