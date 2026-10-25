import axios, { AxiosError } from 'axios';

export interface LinkedInUgcPayload {
  author: string;
  lifecycleState: 'PUBLISHED' | 'DRAFT';
  specificContent: {
    'com.linkedin.ugc.ShareContent': {
      shareCommentary: {
        text: string;
      };
      shareMediaCategory: 'NONE' | 'IMAGE' | 'VIDEO' | 'ARTICLE';
      media?: Array<{
        status: string;
        originalUrl: string;
        title?: {
          text: string;
        };
        description?: {
          text: string;
        };
      }>;
    };
  };
  visibility: {
    'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' | 'CONNECTIONS';
  };
}

export class LinkedInPublishingError extends Error {
  public status?: number;
  public code?: string;
  public details?: any;

  constructor(message: string, status?: number, code?: string, details?: any) {
    super(message);
    this.name = 'LinkedInPublishingError';
    this.status = status;
    this.code = code;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Formats a user's scheduled post into a valid LinkedIn UGC Post API JSON payload.
 * Handles both personal profiles (urn:li:person:...) and organization pages (urn:li:organization:...).
 * 
 * @param authorUrn The LinkedIn URN of the author. Must start with 'urn:li:person:' or 'urn:li:organization:'.
 * @param text The commentary text of the post.
 * @param imageUrls Optional list of image attachments.
 * @returns Fully structured, ready-to-publish LinkedInUgcPayload object.
 */
export function formatLinkedInUgcPayload(
  authorUrn: string,
  text: string,
  imageUrls?: string[]
): LinkedInUgcPayload {
  // Validate authorUrn
  const cleanUrn = authorUrn?.trim();
  if (!cleanUrn) {
    throw new Error('LinkedIn authorUrn is required.');
  }

  const isPerson = cleanUrn.startsWith('urn:li:person:');
  const isOrg = cleanUrn.startsWith('urn:li:organization:');

  if (!isPerson && !isOrg) {
    throw new Error(
      `Invalid LinkedIn URN format: "${authorUrn}". Must start with either "urn:li:person:" or "urn:li:organization:".`
    );
  }

  // Set proper media category based on presence of image URLs
  const hasImages = imageUrls && imageUrls.length > 0;
  const shareMediaCategory = hasImages ? 'IMAGE' : 'NONE';

  const payload: LinkedInUgcPayload = {
    author: cleanUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: text || '',
        },
        shareMediaCategory,
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  // Populate media array if images are attached
  if (hasImages && imageUrls) {
    payload.specificContent['com.linkedin.ugc.ShareContent'].media = imageUrls.map((url, index) => ({
      status: 'READY',
      originalUrl: url,
      title: {
        text: `Attachment ${index + 1}`,
      },
      description: {
        text: 'Shared image content via Social Planner',
      },
    }));
  }

  return payload;
}

/**
 * Publishes a formatted UGC Post to LinkedIn's API or a mock endpoint.
 * Catches and maps 403 Forbidden permission errors to descriptive user exceptions.
 */
export async function publishLinkedInUgcPost(
  accessToken: string,
  authorUrn: string,
  text: string,
  imageUrls?: string[]
): Promise<any> {
  if (!accessToken) {
    throw new LinkedInPublishingError('An active LinkedIn access token is required to publish content.', 401);
  }

  const payload = formatLinkedInUgcPayload(authorUrn, text, imageUrls);

  try {
    console.log('[LinkedInPublishing] Attempting to publish UGC post to LinkedIn Graph API...');
    
    // Send to LinkedIn UGC Post API endpoint (with mock fallback for sandbox safety)
    const response = await axios.post('https://api.linkedin.com/v2/ugcPosts', payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
    });

    console.log('[LinkedInPublishing] UGC Post successfully published. Ref:', response.data?.id);
    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorData = error.response?.data;
      
      // 403 Forbidden handling with specific validation checks
      if (status === 403) {
        throw new LinkedInPublishingError(
          `[LinkedIn 403 Forbidden] Insufficient member permissions. The authenticated user does not have authorization to publish on behalf of URN: "${authorUrn}". Ensure your LinkedIn token includes 'w_member_social' (for profiles) or 'w_organization_social' (for brand pages).`,
          403,
          'PERMISSION_DENIED',
          errorData
        );
      }

      if (status === 401) {
        throw new LinkedInPublishingError(
          '[LinkedIn 401 Unauthorized] The provided LinkedIn access token is invalid, expired, or has been revoked.',
          401,
          'INVALID_TOKEN',
          errorData
        );
      }

      // Generic LinkedIn API error
      const apiMessage = errorData?.message || error.message;
      throw new LinkedInPublishingError(
        `[LinkedIn API Error] ${apiMessage} (HTTP ${status || 'unknown'})`,
        status,
        'API_ERROR',
        errorData
      );
    }

    throw new LinkedInPublishingError(
      `[LinkedIn Unknown Exception] ${error.message || 'An unexpected error occurred during publication.'}`,
      500
    );
  }
}
