import { Timestamp } from 'firebase/firestore';

/**
 * Supported Social Media Platforms.
 */
export type SocialPlatform = 'facebook' | 'instagram' | 'linkedin' | 'tiktok' | 'x' | 'youtube';

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
 * Primary user profile document stored at `/users/{userId}`.
 */
export interface UserDocument {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Access tokens, account handles, and OAuth scopes for linked channels.
 * Stored as a sub-collection at `/users/{userId}/channels/{channelId}`.
 */
export interface ChannelDocument {
  id: string; // Typically matches platform ID (e.g., 'linkedin', 'instagram')
  platform: SocialPlatform;
  connected: boolean;
  handle: string; // Public user account handle or page name (e.g., '@flow_forge')
  
  // Sensitive OAuth credentials
  accessToken: string; // Long-lived access token
  refreshToken?: string; // Refresh token (if supported by provider)
  tokenExpiry?: Timestamp; // Expiration point of the current accessToken
  
  // Platform-specific API parameters
  pageId?: string; // e.g., Page ID for Facebook / Instagram Graph API
  scope?: string[]; // Authorized scopes approved during OAuth consent
  profilePictureUrl?: string; // Cached profile icon from the provider
  
  updatedAt: Timestamp;
}

/**
 * Cross-platform social media post document stored at `/posts/{postId}`.
 */
export interface PostDocument {
  id?: string; // Optional during creation as Firestore auto-generates IDs
  userId: string; // Reference to the User profile who scheduled this
  caption: string; // Main text content or caption of the social post
  media: PostMediaAsset[]; // Array of photo/video attachments
  scheduledAt: Timestamp; // Native Firebase Timestamp specifying publication point
  channelIds: string[]; // List of targeted channel IDs (e.g. ['linkedin', 'instagram'])
  status: PostStatus;
  error?: string; // Failure logs or error message from social APIs if status === 'failed'
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
