import axios from 'axios';
import { ISocialPlatformAdapter, PublishPayload, PublishResult, DecryptedAccountCredentials } from '../types';

/**
 * Mastodon ActivityPub REST Adapter
 * 
 * Direct instance federation: Allows end-users to link their account from ANY
 * Mastodon instance (mastodon.social, mastodon.online, fosstodon.org, custom instance)
 * by providing an access token or instance OAuth, with zero platform developer approval needed.
 */
export class MastodonAdapter implements ISocialPlatformAdapter {
  readonly platform = 'mastodon' as const;
  private readonly defaultInstance = 'https://mastodon.social';

  async publish(payload: PublishPayload, credentials: DecryptedAccountCredentials): Promise<PublishResult> {
    try {
      const token = credentials.accessToken;
      let rawInstance = credentials.instanceUrl || this.defaultInstance;
      if (!rawInstance.startsWith('http://') && !rawInstance.startsWith('https://')) {
        rawInstance = `https://${rawInstance}`;
      }
      const instanceUrl = rawInstance.replace(/\/$/, '');

      // Handle mock/dev mode
      if (!token || token.startsWith('mock_') || token === 'sandbox') {
        const mockStatusId = `masto_${Date.now()}`;
        return {
          success: true,
          platform: this.platform,
          platformPostId: mockStatusId,
          url: `${instanceUrl}/@${credentials.handle.replace(/^@/, '')}/${mockStatusId}`,
          rawResponse: { simulated: true, id: mockStatusId }
        };
      }

      // Execute POST /api/v1/statuses
      const response = await axios.post(
        `${instanceUrl}/api/v1/statuses`,
        {
          status: payload.content,
          visibility: 'public'
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `status_${payload.postId}_${Date.now()}`
          },
          timeout: 15000
        }
      );

      const statusData = response.data;
      return {
        success: true,
        platform: this.platform,
        platformPostId: statusData.id,
        url: statusData.url || `${instanceUrl}/@${credentials.handle.replace(/^@/, '')}/${statusData.id}`,
        rawResponse: statusData
      };

    } catch (error: any) {
      console.error('[MastodonAdapter Publish Error]:', error.response?.data || error.message);
      const isTokenIssue = error.response?.status === 401 || error.response?.status === 403;
      return {
        success: false,
        platform: this.platform,
        error: error.response?.data?.error || error.message || 'Failed to dispatch status to Mastodon instance',
        tokenExpired: isTokenIssue
      };
    }
  }

  async validateCredentials(credentials: DecryptedAccountCredentials): Promise<boolean> {
    return !!credentials.accessToken;
  }
}
