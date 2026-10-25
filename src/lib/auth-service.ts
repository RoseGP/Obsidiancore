import { Timestamp } from 'firebase/firestore';
import { ChannelDocument, SocialPlatform } from '../types/firebase';

export interface OAuthSimulationResult {
  id: string;
  platform: SocialPlatform;
  connected: boolean;
  handle: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: Timestamp;
  scope: string[];
  profilePictureUrl: string;
  pageId?: string;
}

/**
 * Simulates a secure OAuth 2.0 authorization redirect or popup flow.
 * It provides realistic platform-specific responses for LinkedIn, Instagram, and YouTube.
 */
export async function simulateOAuthLogin(
  platform: 'linkedin' | 'instagram' | 'youtube'
): Promise<OAuthSimulationResult> {
  console.log(`[OAuth Service] Initiating simulated OAuth handshake for: ${platform}`);
  
  // Simulate network latency for the handshake (800ms)
  await new Promise((resolve) => setTimeout(resolve, 800));

  const now = new Date();
  
  switch (platform) {
    case 'linkedin':
      return {
        id: 'linkedin',
        platform: 'linkedin',
        connected: true,
        handle: 'Flow Forge Inc. (LinkedIn)',
        accessToken: `AQW_LINKEDIN_MEMBER_OAUTH2_TOKEN_SIM_${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
        refreshToken: `AQW_REFR_LINKEDIN_MOCK_TOKEN_${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        tokenExpiry: Timestamp.fromDate(new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)), // 60 Days
        scope: ['w_member_social', 'r_liteprofile', 'r_organization_admin'],
        profilePictureUrl: 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=150&auto=format&fit=crop',
      };

    case 'instagram':
      return {
        id: 'instagram',
        platform: 'instagram',
        connected: true,
        handle: '@flowforge_agency',
        accessToken: `IG_GRAPH_API_USER_TOKEN_SIM_${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
        refreshToken: `IG_REFR_MOCK_TOKEN_${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        tokenExpiry: Timestamp.fromDate(new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)), // 60 Days
        scope: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'pages_show_list'],
        profilePictureUrl: 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=150&auto=format&fit=crop',
        pageId: 'ig_business_act_551920',
      };

    case 'youtube':
      return {
        id: 'youtube',
        platform: 'youtube',
        connected: true,
        handle: 'Flow Forge Dev Network',
        accessToken: `YA_YOUTUBE_DATA_API_V3_OAUTH_SIM_${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
        refreshToken: `YA_YOUTUBE_OAUTH_REFR_SIM_${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        tokenExpiry: Timestamp.fromDate(new Date(now.getTime() + 3600 * 1000)), // 1 Hour (Standard Google OAuth expiry)
        scope: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
        profilePictureUrl: 'https://images.unsplash.com/photo-1611162618828-bc409f855cdd?w=150&auto=format&fit=crop',
      };

    default:
      throw new Error(`Unsupported platform for simulation auth flow: ${platform}`);
  }
}

/**
 * Revokes active tokens and simulates a disconnection of the specified social channel.
 */
export async function simulateOAuthDisconnect(platform: SocialPlatform): Promise<string> {
  console.log(`[OAuth Service] Revoking tokens and disconnecting: ${platform}`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  return platform;
}
