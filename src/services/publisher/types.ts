export type SupportedSocialPlatform = 
  | 'x' 
  | 'twitter' 
  | 'linkedin' 
  | 'bluesky' 
  | 'mastodon' 
  | 'facebook' 
  | 'instagram';

export interface DecryptedAccountCredentials {
  platform: SupportedSocialPlatform;
  accountId: string;
  handle: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiry?: Date | string;
  instanceUrl?: string; // For Mastodon instances (e.g. https://mastodon.social)
  appPassword?: string; // For Bluesky AT Protocol
  did?: string;         // For Bluesky AT Protocol DID
}

export interface PublishPayload {
  postId: string;
  content: string;
  mediaUrls?: string[];
  scheduledAt?: string;
  options?: Record<string, any>;
}

export interface PublishResult {
  success: boolean;
  platform: SupportedSocialPlatform;
  platformPostId?: string;
  url?: string;
  error?: string;
  tokenExpired?: boolean;
  newToken?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
  };
  rawResponse?: any;
}

export interface ISocialPlatformAdapter {
  readonly platform: SupportedSocialPlatform;
  publish(payload: PublishPayload, credentials: DecryptedAccountCredentials): Promise<PublishResult>;
  refreshToken?(credentials: DecryptedAccountCredentials): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: string } | null>;
  validateCredentials(credentials: DecryptedAccountCredentials): Promise<boolean>;
}
