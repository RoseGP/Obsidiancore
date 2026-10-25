import { Timestamp } from 'firebase/firestore';

/**
 * Primary user account profile document stored at `/users/{userId}`.
 */
export interface UserDocument {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: Timestamp; // Native Firebase Timestamp
  updatedAt: Timestamp; // Native Firebase Timestamp
}

/**
 * Supported social media networks.
 */
export type SocialPlatform = 'facebook' | 'instagram' | 'linkedin' | 'tiktok' | 'x' | 'youtube';

/**
 * Access tokens and account metadata for linked channels.
 * Stored as a sub-collection at `/users/{userId}/channels/{channelId}`.
 */
export interface ChannelDocument {
  id: string; // matches platform ID (e.g., 'linkedin')
  platform: SocialPlatform;
  connected: boolean;
  handle: string; // Account handle (e.g., '@flow_forge')
  
  // Sensitive OAuth credentials
  accessToken: string; // Long-lived access token
  refreshToken?: string; // Refresh token (if supported by provider)
  tokenExpiry?: Timestamp; // Expiration point of the current accessToken
  
  // API specific information (such as page IDs, scopes)
  pageId?: string; // Required for Facebook Pages / Instagram Graph API
  scope?: string[]; // Scopes approved during OAuth flow
  profilePictureUrl?: string; // Cached profile icon from platform
  
  updatedAt: Timestamp;
}

/**
 * Social media publication lifecycle states.
 */
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed';

/**
 * Definition of photo/video attachment.
 */
export interface PostMediaAsset {
  url: string;
  type: 'image' | 'video';
  name: string;
  sizeBytes?: number;
}

/**
 * Cross-platform social media post stored in root collection `/posts/{postId}`.
 */
export interface PostDocument {
  id?: string; // Optional during creation as Firestore auto-generates IDs
  userId: string; // Reference to the User profile who scheduled this
  caption: string; // The post text, hashtags, etc.
  media: PostMediaAsset[]; // Array of photo/video attachments
  scheduledAt: Timestamp; // Scheduled publication point
  channelIds: string[]; // List of target channel/platform IDs (e.g., ['linkedin', 'instagram'])
  status: PostStatus;
  error?: string; // Failure description from social API if status === 'failed'
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * LinkedIn account document stored at `/linkedin_accounts/{accountId}`.
 */
export interface LinkedInAccountDocument {
  user_id: string;
  provider_account_id: string; // LinkedIn member URN
  access_token: string;
  expires_at: Timestamp; // Token expiration timestamp
  refresh_token?: string; // Optional refresh token
  refresh_token_expires_at?: Timestamp; // Optional refresh token expiration
  name?: string; // Member display name
  avatar_url?: string; // Member profile photo URL
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Scheduled post document stored at `/scheduled_posts/{postId}`.
 */
export interface ScheduledPostDocument {
  user_id: string;
  provider_account_id: string; // The publishing account's URN
  commentary: string; // Text content
  media_urls?: string[]; // Media assets
  scheduled_at: Timestamp;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED';
  failure_reason?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

