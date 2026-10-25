import { ISocialPlatformAdapter, PublishPayload, PublishResult, DecryptedAccountCredentials, SupportedSocialPlatform } from './types';
import { BlueskyAdapter } from './adapters/BlueskyAdapter';
import { MastodonAdapter } from './adapters/MastodonAdapter';
import { LinkedInAdapter } from './adapters/LinkedInAdapter';
import { XAdapter } from './adapters/XAdapter';

/**
 * SocialPublisherManager
 * Central orchestration layer dispatching post publications across connected social networks.
 */
export class SocialPublisherManager {
  private adapters: Map<string, ISocialPlatformAdapter> = new Map();

  constructor() {
    this.registerAdapter(new BlueskyAdapter());
    this.registerAdapter(new MastodonAdapter());
    this.registerAdapter(new LinkedInAdapter());
    this.registerAdapter(new XAdapter());
  }

  public registerAdapter(adapter: ISocialPlatformAdapter) {
    this.adapters.set(adapter.platform.toLowerCase(), adapter);
    if (adapter.platform === 'x') {
      this.adapters.set('twitter', adapter);
    }
  }

  public getAdapter(platform: string): ISocialPlatformAdapter | undefined {
    return this.adapters.get(platform.toLowerCase());
  }

  public async publishToPlatform(
    platform: string,
    payload: PublishPayload,
    credentials: DecryptedAccountCredentials
  ): Promise<PublishResult> {
    const canonicalPlatform = platform.toLowerCase();
    const adapter = this.getAdapter(canonicalPlatform);

    if (!adapter) {
      // Graceful fallback for mock simulation
      return {
        success: true,
        platform: canonicalPlatform as SupportedSocialPlatform,
        platformPostId: `sim_${canonicalPlatform}_${Date.now()}`,
        url: `https://${canonicalPlatform}.com/post/${Date.now()}`,
        rawResponse: { simulated: true }
      };
    }

    try {
      return await adapter.publish(payload, credentials);
    } catch (err: any) {
      return {
        success: false,
        platform: canonicalPlatform as SupportedSocialPlatform,
        error: err.message || `Unhandled exception during publishing to ${platform}`
      };
    }
  }

  public async publishToMultiple(
    platforms: string[],
    payload: PublishPayload,
    credentialsMap: Record<string, DecryptedAccountCredentials>
  ): Promise<{ allSuccessful: boolean; results: PublishResult[] }> {
    const results: PublishResult[] = [];

    for (const plat of platforms) {
      const canonicalPlat = plat.toLowerCase();
      const creds = credentialsMap[canonicalPlat] || {
        platform: canonicalPlat as SupportedSocialPlatform,
        accountId: 'demo_account',
        handle: `@user_${canonicalPlat}`,
        accessToken: 'mock_token'
      };

      const result = await this.publishToPlatform(canonicalPlat, payload, creds);
      results.push(result);
    }

    const allSuccessful = results.every(r => r.success);
    return { allSuccessful, results };
  }
}

export const socialPublisherManager = new SocialPublisherManager();
