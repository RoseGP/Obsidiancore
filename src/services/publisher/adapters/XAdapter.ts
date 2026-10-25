import axios from 'axios';
import { ISocialPlatformAdapter, PublishPayload, PublishResult, DecryptedAccountCredentials } from '../types';

/**
 * X (Twitter) API v2 Tweets Adapter
 * 
 * Supports X API v2 POST /2/tweets with User OAuth 2.0 / Bearer Tokens.
 */
export class XAdapter implements ISocialPlatformAdapter {
  readonly platform = 'x' as const;

  async publish(payload: PublishPayload, credentials: DecryptedAccountCredentials): Promise<PublishResult> {
    try {
      const token = credentials.accessToken;

      // Handle mock/sandbox mode
      if (!token || token.startsWith('mock_') || token === 'sandbox') {
        const mockTweetId = `${Date.now()}`;
        return {
          success: true,
          platform: this.platform,
          platformPostId: mockTweetId,
          url: `https://x.com/${credentials.handle.replace(/^@/, '')}/status/${mockTweetId}`,
          rawResponse: { simulated: true, id: mockTweetId }
        };
      }

      // Execute POST https://api.twitter.com/2/tweets
      const response = await axios.post(
        'https://api.twitter.com/2/tweets',
        {
          text: payload.content
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const tweetId = response.data?.data?.id || `${Date.now()}`;
      return {
        success: true,
        platform: this.platform,
        platformPostId: tweetId,
        url: `https://x.com/${credentials.handle.replace(/^@/, '')}/status/${tweetId}`,
        rawResponse: response.data
      };

    } catch (error: any) {
      console.error('[XAdapter Publish Error]:', error.response?.data || error.message);
      const isTokenIssue = error.response?.status === 401 || error.response?.status === 403;
      return {
        success: false,
        platform: this.platform,
        error: error.response?.data?.detail || error.response?.data?.message || error.message || 'X API v2 Tweet publish failed',
        tokenExpired: isTokenIssue
      };
    }
  }

  async validateCredentials(credentials: DecryptedAccountCredentials): Promise<boolean> {
    return !!credentials.accessToken;
  }
}
