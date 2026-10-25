import axios, { AxiosError } from 'axios';

export interface ThreadsPublishingOptions {
  accessToken: string;
  threadsUserId: string;
  tokenCreatedAt?: Date | string | number; // To check if token is older than 45 days
  apiVersion?: string;
}

export class ThreadsPublishingError extends Error {
  public code?: number;
  public subcode?: number;
  public fbtraceId?: string;
  public rawResponse?: any;

  constructor(message: string, code?: number, subcode?: number, fbtraceId?: string, rawResponse?: any) {
    super(message);
    this.name = 'ThreadsPublishingError';
    this.code = code;
    this.subcode = subcode;
    this.fbtraceId = fbtraceId;
    this.rawResponse = rawResponse;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class ThreadsPublishingService {
  private accessToken: string;
  private threadsUserId: string;
  private apiVersion: string;

  /**
   * Initializes the Threads Publishing Service.
   * Performs automatic token expiration verification checks upon startup.
   */
  constructor(options: ThreadsPublishingOptions) {
    if (!options.accessToken) {
      throw new Error('[ThreadsPublishingService] A valid accessToken is required.');
    }
    if (!options.threadsUserId) {
      throw new Error('[ThreadsPublishingService] A valid threadsUserId is required.');
    }

    this.accessToken = options.accessToken;
    this.threadsUserId = options.threadsUserId;
    this.apiVersion = options.apiVersion || 'v1.0';

    // Verify token age and trigger warnings if older than 45 days
    if (options.tokenCreatedAt) {
      this.checkTokenAge(options.tokenCreatedAt);
    }
  }

  /**
   * Checks the age of the OAuth token and logs a warning if it is older than 45 days.
   * Long-lived Meta tokens typically last 60 days, so warning at 45 days is standard practice.
   */
  private checkTokenAge(createdAt: Date | string | number): void {
    try {
      const createdTime = new Date(createdAt).getTime();
      if (isNaN(createdTime)) {
        console.warn('[ThreadsPublishingService] Provided tokenCreatedAt timestamp is invalid.');
        return;
      }

      const fortyFiveDaysInMs = 45 * 24 * 60 * 60 * 1000;
      const ageInMs = Date.now() - createdTime;

      if (ageInMs > fortyFiveDaysInMs) {
        const ageInDays = Math.floor(ageInMs / (24 * 60 * 60 * 1000));
        console.warn(
          `[ThreadsPublishingService] [TOKEN EXPIRATION WARNING] The current access token was generated ${ageInDays} days ago, which is older than 45 days. Please proactively renew this access token to prevent API call disruptions.`
        );
      } else {
        const ageInDays = Math.floor(ageInMs / (24 * 60 * 60 * 1000));
        console.log(`[ThreadsPublishingService] Token status checked: token age is ${ageInDays} days (safe).`);
      }
    } catch (err: any) {
      console.warn('[ThreadsPublishingService] Error during token age verification: ', err.message);
    }
  }

  /**
   * Helper utility to normalize Threads Graph API errors
   */
  private handleError(error: unknown, fallbackMessage: string): never {
    if (error instanceof AxiosError) {
      const threadsError = error.response?.data?.error;
      if (threadsError) {
        const code = threadsError.code;
        const subcode = threadsError.error_subcode;
        const message = threadsError.message || fallbackMessage;
        const fbtraceId = threadsError.fbtrace_id;

        throw new ThreadsPublishingError(
          `[Threads API Error] ${message} (Code: ${code}, Subcode: ${subcode || 'none'})`,
          code,
          subcode,
          fbtraceId,
          error.response?.data
        );
      }
      throw new ThreadsPublishingError(
        `[Threads Network Error] HTTP ${error.response?.status || 'Unknown'}: ${error.message}`,
        undefined,
        undefined,
        undefined,
        error.response?.data
      );
    }

    if (error instanceof ThreadsPublishingError) {
      throw error;
    }

    const genericErr = error as Error;
    throw new ThreadsPublishingError(`[Threads System Exception] ${genericErr.message || fallbackMessage}`);
  }

  /**
   * Phase 1: Create a threads media container.
   * POST /v1.0/{threads-user-id}/threads
   * 
   * If post is text-only, automatically includes auto_publish_text=true query parameter to
   * finalize publishing in a single call instead of requiring subsequent publication steps.
   */
  public async createContainer(
    text: string,
    mediaUrl?: string,
    mediaType?: 'IMAGE' | 'VIDEO' | 'TEXT'
  ): Promise<{ id: string; isAutoPublished: boolean }> {
    const url = `https://graph.threads.net/${this.apiVersion}/${this.threadsUserId}/threads`;

    // Automated logic block to detect if post is text-only
    const isTextOnly = !mediaUrl;
    const finalMediaType = mediaType || (isTextOnly ? 'TEXT' : mediaUrl.match(/\.(mp4|mov|avi|mkv|webm|qt)($|\?)/i) ? 'VIDEO' : 'IMAGE');

    const params: Record<string, any> = {
      access_token: this.accessToken,
    };

    const payload: Record<string, any> = {
      media_type: finalMediaType,
    };

    if (text) {
      payload.text = text;
    }

    if (!isTextOnly && mediaUrl) {
      if (finalMediaType === 'VIDEO') {
        payload.video_url = mediaUrl;
      } else {
        payload.image_url = mediaUrl;
      }
    }

    // Pass auto_publish_text=true for text-only posts to publish in a single API call
    if (isTextOnly) {
      params.auto_publish_text = 'true';
      console.log('[ThreadsPublishingService] Detected text-only post. Initiating single-step auto-publishing flow.');
    }

    try {
      console.log(`[ThreadsPublishingService] Sending container request to Threads API for User: ${this.threadsUserId}...`);
      const response = await axios.post(url, payload, {
        params,
        headers: { 'Content-Type': 'application/json' }
      });

      const containerId = response.data?.id;
      if (!containerId) {
        throw new ThreadsPublishingError('Threads container API request completed but no ID was returned.');
      }

      console.log(`[ThreadsPublishingService] Container call succeeded. ID/Post ID returned: ${containerId}`);
      return {
        id: containerId,
        isAutoPublished: isTextOnly
      };
    } catch (error) {
      this.handleError(error, 'Failed to create Threads publishing container.');
    }
  }

  /**
   * Phase 2: Optional polling method to verify threads container creation status.
   * Useful for video/image post rendering checks prior to launching threads_publish.
   * GET /v1.0/{containerId}?fields=status,error_message
   */
  public async checkContainerStatus(
    containerId: string,
    options?: { maxRetries?: number; intervalMs?: number }
  ): Promise<string> {
    if (!containerId) {
      throw new Error('[ThreadsPublishingService] containerId is required to query status.');
    }

    const maxRetries = options?.maxRetries ?? 10;
    const intervalMs = options?.intervalMs ?? 4000;
    const url = `https://graph.threads.net/${this.apiVersion}/${containerId}`;

    console.log(`[ThreadsPublishingService] Polling processing status for Threads Container: ${containerId}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(url, {
          params: {
            fields: 'status,error_message',
            access_token: this.accessToken
          }
        });

        const statusInfo = response.data;
        const status = statusInfo?.status;

        if (status === 'FINISHED' || status === 'PUBLISHED') {
          console.log(`[ThreadsPublishingService] Container ${containerId} has completed processing.`);
          return containerId;
        }

        if (status === 'ERROR' || status === 'FAILED') {
          const detailedError = statusInfo?.error_message || 'Media transcoding failed.';
          throw new ThreadsPublishingError(`[Threads Processing Error] Processing failed for container ${containerId}: ${detailedError}`);
        }

        console.log(`[ThreadsPublishingService] Container ${containerId} current status: "${status || 'IN_PROGRESS'}" (Attempt ${attempt}/${maxRetries}).`);
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      } catch (error) {
        if (error instanceof ThreadsPublishingError) {
          throw error;
        }
        this.handleError(error, `Failed to fetch status for Threads container: ${containerId}`);
      }
    }

    throw new ThreadsPublishingError(
      `[Threads Container Timeout] Container ${containerId} exceeded max status inquiries without entering FINISHED/PUBLISHED status.`
    );
  }

  /**
   * Phase 3: Finalize publishing by launching threads_publish endpoint.
   * POST /v1.0/{threads-user-id}/threads_publish
   */
  public async publishContainer(containerId: string): Promise<string> {
    if (!containerId) {
      throw new Error('[ThreadsPublishingService] containerId is required to complete publication.');
    }

    const url = `https://graph.threads.net/${this.apiVersion}/${this.threadsUserId}/threads_publish`;

    try {
      console.log(`[ThreadsPublishingService] Publishing finalized Threads container ${containerId}...`);
      const response = await axios.post(url, null, {
        params: {
          creation_id: containerId,
          access_token: this.accessToken
        },
        headers: { 'Content-Type': 'application/json' }
      });

      const publishedPostId = response.data?.id;
      if (!publishedPostId) {
        throw new ThreadsPublishingError('Threads publish request succeeded but did not return a published post ID.');
      }

      console.log(`[ThreadsPublishingService] Success! Post is now live on Threads. Post ID: ${publishedPostId}`);
      return publishedPostId;
    } catch (error) {
      this.handleError(error, `Failed to publish Threads container: ${containerId}`);
    }
  }

  /**
   * Unified High-Level Publisher:
   * Publishes text, images, or video content onto Threads securely, optimizing for the target type.
   */
  public async publish(text: string, mediaUrl?: string): Promise<string> {
    // Phase 1: Create Container
    const { id, isAutoPublished } = await this.createContainer(text, mediaUrl);

    // If auto-published, Phase 1 completes the entire flow
    if (isAutoPublished) {
      return id;
    }

    // For media containers, poll until processed and finalize publishing
    await this.checkContainerStatus(id);
    return this.publishContainer(id);
  }
}
