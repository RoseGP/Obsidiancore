import axios, { AxiosError } from 'axios';

// ==========================================
// Custom Strongly-Typed Instagram Exceptions
// ==========================================

export class InstagramPublishingError extends Error {
  public code?: number;
  public subcode?: number;
  public fbtraceId?: string;
  public rawResponse?: any;

  constructor(message: string, code?: number, subcode?: number, fbtraceId?: string, rawResponse?: any) {
    super(message);
    this.name = 'InstagramPublishingError';
    this.code = code;
    this.subcode = subcode;
    this.fbtraceId = fbtraceId;
    this.rawResponse = rawResponse;

    // Maintain correct stack trace in V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when Instagram API request rate limits are exceeded (Error Code 4, 17, 32, etc.)
 */
export class InstagramRateLimitError extends InstagramPublishingError {
  constructor(message: string, rawResponse?: any) {
    super(message, 4, undefined, undefined, rawResponse);
    this.name = 'InstagramRateLimitError';
  }
}

/**
 * Thrown when OAuth credentials or page tokens expire or are revoked (Error Code 190)
 */
export class InstagramTokenExpiredError extends InstagramPublishingError {
  constructor(message: string, code?: number, subcode?: number, rawResponse?: any) {
    super(message, code, subcode, undefined, rawResponse);
    this.name = 'InstagramTokenExpiredError';
  }
}

// ==========================================
// Instagram Graph API Publishing Service
// ==========================================

export class InstagramPublishingService {
  private accessToken: string;
  private apiVersion: string;

  /**
   * Initializes the Instagram publishing pipeline with standard credentials.
   * @param accessToken Decrypted access token authorized for the Instagram Graph API.
   * @param apiVersion The Meta Graph API version to hit (defaults to v20.0).
   */
  constructor(accessToken: string, apiVersion: string = 'v20.0') {
    if (!accessToken) {
      throw new Error('[InstagramPublishingService] An active access token is required to initialize the publishing service.');
    }
    this.accessToken = accessToken;
    this.apiVersion = apiVersion;
  }

  /**
   * Helper utility to normalize error types into descriptive custom exceptions
   */
  private handleError(error: unknown, fallbackMessage: string): never {
    if (error instanceof AxiosError) {
      const fbError = error.response?.data?.error;
      if (fbError) {
        const code = fbError.code;
        const subcode = fbError.error_subcode;
        const message = fbError.message || fallbackMessage;
        const fbtraceId = fbError.fbtrace_id;

        // Rate limit validation: Graph API error codes 4 (Application rate limit), 17 (User rate limit), 32 (Page rate limit)
        if (code === 4 || code === 17 || code === 32) {
          throw new InstagramRateLimitError(
            `[Instagram Rate Limit] ${message} (Code: ${code}, Subcode: ${subcode || 'none'}). Please wait before attempting to publish again.`,
            error.response?.data
          );
        }

        // Token expiration check: OAuth error code 190, or explicit keyword matching for absolute safety
        const isOAuthInvalidation = code === 190 || 
          (message.toLowerCase().includes('token') && (message.toLowerCase().includes('expired') || message.toLowerCase().includes('invalid') || message.toLowerCase().includes('revoked')));

        if (isOAuthInvalidation) {
          throw new InstagramTokenExpiredError(
            `[Instagram Token Expired/Invalid] ${message} (Code: ${code}, Subcode: ${subcode || 'none'}). Re-authenticate to renew access.`,
            code,
            subcode,
            error.response?.data
          );
        }

        // General Meta API error
        throw new InstagramPublishingError(
          `[Instagram API Error] ${message} (Code: ${code}, Subcode: ${subcode || 'none'})`,
          code,
          subcode,
          fbtraceId,
          error.response?.data
        );
      }

      // Raw HTTP networking failure
      throw new InstagramPublishingError(
        `[Instagram Network Failure] HTTP ${error.response?.status || 'Unknown'}: ${error.message}`,
        undefined,
        undefined,
        undefined,
        error.response?.data
      );
    }

    if (error instanceof InstagramPublishingError) {
      throw error;
    }

    const genericErr = error as Error;
    throw new InstagramPublishingError(`[Instagram System Exception] ${genericErr.message || fallbackMessage}`);
  }

  /**
   * Phase 1: Create a media container node.
   * POST /v20.0/{instagramBusinessAccountId}/media
   * 
   * @param instagramBusinessAccountId The target Instagram business account ID.
   * @param mediaUrl Publicly accessible URL of the image or video to publish.
   * @param caption Text caption of the post, with optional hashtags and tags.
   * @returns Resolves to the Container ID.
   */
  public async createContainer(
    instagramBusinessAccountId: string,
    mediaUrl: string,
    caption: string
  ): Promise<string> {
    if (!instagramBusinessAccountId) {
      throw new Error('[InstagramPublishingService] instagramBusinessAccountId is required to create a container.');
    }
    if (!mediaUrl) {
      throw new Error('[InstagramPublishingService] A mediaUrl is required for media container creation.');
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${instagramBusinessAccountId}/media`;

    // Deduce if the asset is video based on extension patterns
    const isVideo = mediaUrl.match(/\.(mp4|mov|avi|mkv|webm|qt)($|\?)/i);

    const payload: Record<string, any> = {
      caption,
      access_token: this.accessToken,
    };

    if (isVideo) {
      payload.video_url = mediaUrl;
      payload.media_type = 'VIDEO'; // Sets correct media category for reels / video nodes
    } else {
      payload.image_url = mediaUrl;
    }

    try {
      console.log(`[InstagramPublishingService] Creating media container for Account ID: ${instagramBusinessAccountId}...`);
      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      const containerId = response.data?.id;
      if (!containerId) {
        throw new InstagramPublishingError('Container creation API request succeeded but failed to return a container ID node.');
      }

      console.log(`[InstagramPublishingService] Media container successfully created. ID: ${containerId}`);
      return containerId;
    } catch (error) {
      this.handleError(error, `Failed to create publishing container for account: ${instagramBusinessAccountId}`);
    }
  }

  /**
   * Phase 2: Poll container status node until FINISHED or ERROR.
   * GET /v20.0/{containerId}?fields=status_code,status
   * 
   * @param containerId The ID of the media container to poll.
   * @param options Polling configuration limits.
   * @returns Resolves to the containerId upon completion.
   */
  public async checkContainerStatus(
    containerId: string,
    options?: { maxRetries?: number; intervalMs?: number }
  ): Promise<string> {
    if (!containerId) {
      throw new Error('[InstagramPublishingService] containerId is required to verify processing status.');
    }

    const maxRetries = options?.maxRetries ?? 15;
    const intervalMs = options?.intervalMs ?? 5000;
    const url = `https://graph.facebook.com/${this.apiVersion}/${containerId}`;

    console.log(`[InstagramPublishingService] Starting status polling loop for Container URN: ${containerId}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(url, {
          params: {
            fields: 'status_code,status,error_message',
            access_token: this.accessToken
          }
        });

        const statusInfo = response.data;
        const statusCode = statusInfo?.status_code;

        if (statusCode === 'FINISHED') {
          console.log(`[InstagramPublishingService] Container ${containerId} successfully parsed & optimized (FINISHED) on attempt ${attempt}.`);
          return containerId;
        }

        if (statusCode === 'ERROR') {
          const detailedError = statusInfo?.error_message || statusInfo?.status || 'Unknown processing error';
          throw new InstagramPublishingError(
            `[Instagram Container Processing Error] Processing failed for container ${containerId}: ${detailedError}`
          );
        }

        console.log(`[InstagramPublishingService] Container ${containerId} current status: "${statusCode || 'IN_PROGRESS'}" (Attempt ${attempt}/${maxRetries}). Retrying in ${intervalMs}ms...`);
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, intervalMs));

      } catch (error) {
        if (error instanceof InstagramPublishingError) {
          throw error;
        }
        this.handleError(error, `Failed checking container status for: ${containerId}`);
      }
    }

    throw new InstagramPublishingError(
      `[Instagram Container Timeout] Container ${containerId} exceeded max status inquiry retries (${maxRetries}) without entering FINISHED status.`
    );
  }

  /**
   * Phase 3: Publish container node to make the post live.
   * POST /v20.0/{instagramBusinessAccountId}/media_publish
   * 
   * @param instagramBusinessAccountId The target Instagram business account ID.
   * @param containerId The processed and finalized container ID.
   * @returns Resolves to the live Instagram media object ID.
   */
  public async publishContainer(
    instagramBusinessAccountId: string,
    containerId: string
  ): Promise<string> {
    if (!instagramBusinessAccountId) {
      throw new Error('[InstagramPublishingService] instagramBusinessAccountId is required to complete final publication.');
    }
    if (!containerId) {
      throw new Error('[InstagramPublishingService] containerId is required to complete final publication.');
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${instagramBusinessAccountId}/media_publish`;

    try {
      console.log(`[InstagramPublishingService] Publishing finalized media container ${containerId} onto account ${instagramBusinessAccountId}...`);
      const response = await axios.post(url, {
        creation_id: containerId,
        access_token: this.accessToken
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      const liveMediaId = response.data?.id;
      if (!liveMediaId) {
        throw new InstagramPublishingError('Publish container request succeeded but failed to return a live media object URN.');
      }

      console.log(`[InstagramPublishingService] Success! Post is now LIVE on Instagram. Media ID: ${liveMediaId}`);
      return liveMediaId;
    } catch (error) {
      this.handleError(error, `Failed to finalize and publish container: ${containerId}`);
    }
  }
}
