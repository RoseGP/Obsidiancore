import axios, { AxiosError } from 'axios';
import { db } from './db';
import { db as firestoreDb } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { updateMemoryPostStatus } from '../routes/socialPosts';

// Custom errors for LinkedIn publishing handshakes
export class LinkedInTokenExpiredError extends Error {
  public statusCode: number;
  public details?: any;

  constructor(message: string, statusCode: number = 401, details?: any) {
    super(message);
    this.name = 'LinkedInTokenExpiredError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class LinkedInPublishingError extends Error {
  public statusCode?: number;
  public details?: any;

  constructor(message: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'LinkedInPublishingError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

interface LinkedInPublishResult {
  success: boolean;
  postId?: string;
  error?: string;
  tokenExpired?: boolean;
}

/**
 * Core backend function that takes a post's text content and a stored LinkedIn access token,
 * makes an HTTP POST request to the official LinkedIn UGC Post API to create a user post,
 * handles token expirations and errors, and synchronizes the final status in databases (Prisma & Firestore).
 * 
 * @param postId The ID of the post in the database to update.
 * @param textContent The message content/caption of the social post.
 * @param authorUrn The LinkedIn member URN (e.g., 'urn:li:person:12345678' or 'urn:li:organization:87654321').
 * @param accessToken The decrypted active OAuth2 access token for LinkedIn API v2.
 * @param mediaUrls Optional attached images/media URLs to publish alongside the text content.
 */
export async function publishLinkedInPostWithDatabaseSync(
  postId: string,
  textContent: string,
  authorUrn: string,
  accessToken: string,
  mediaUrls: string[] = []
): Promise<LinkedInPublishResult> {
  console.log(`[LinkedInPublisher] Starting publication sync for Post ${postId} on behalf of ${authorUrn}...`);

  if (!accessToken) {
    const errMessage = 'LinkedIn Access Token is missing or null. Authentication is required.';
    await updatePostDatabaseStatus(postId, 'FAILED', errMessage);
    return { success: false, error: errMessage, tokenExpired: true };
  }

  const cleanUrn = authorUrn?.trim() || 'urn:li:person:demo_profile';
  const hasMedia = mediaUrls && mediaUrls.length > 0;
  
  // Official LinkedIn UGC Post / Share API Request Body Format
  const payload = {
    author: cleanUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: {
          text: textContent || '',
        },
        shareMediaCategory: hasMedia ? 'IMAGE' : 'NONE',
        media: hasMedia
          ? mediaUrls.map((url, idx) => ({
              status: 'READY',
              description: { text: `Attached asset ${idx + 1}` },
              media: url,
              title: { text: `Attachment ${idx + 1}` },
            }))
          : [],
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  try {
    // Check if running with mock/bypass token in development sandbox environment
    if (accessToken.startsWith('mock_') || accessToken === 'challenge') {
      console.log('[LinkedInPublisher] Detected sandbox mode / simulated credential. Resolving mock success.');
      
      const mockPostUrn = `urn:li:share:mock_share_${Math.floor(Math.random() * 99999999)}`;
      await updatePostDatabaseStatus(postId, 'PUBLISHED', `Simulated dispatch successful. Ref URN: ${mockPostUrn}`);
      return { success: true, postId: mockPostUrn };
    }

    console.log('[LinkedInPublisher] Sending POST request to LinkedIn UGC Share API endpoint...');
    const response = await axios.post('https://api.linkedin.com/v2/ugcPosts', payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
    });

    const publishedUrn = response.data?.id;
    if (!publishedUrn) {
      throw new LinkedInPublishingError('LinkedIn responded successfully but returned a missing or invalid share URN/ID.');
    }

    console.log(`[LinkedInPublisher] UGC Post published perfectly! URN Ref: ${publishedUrn}`);
    await updatePostDatabaseStatus(postId, 'PUBLISHED', `Successfully published to LinkedIn. Share ID: ${publishedUrn}`);
    
    return { success: true, postId: publishedUrn };

  } catch (error: any) {
    let errorMessage = 'An unexpected system exception occurred during the publication process.';
    let isExpired = false;
    let statusCode = 500;
    let responseData: any = null;

    if (axios.isAxiosError(error)) {
      statusCode = error.response?.status || 500;
      responseData = error.response?.data;

      // Classify 401 Unauthorized error specifically as expired or revoked OAuth tokens
      if (statusCode === 401) {
        isExpired = true;
        errorMessage = `[LinkedIn Token Expired] Unauthorized (401). The provided access token has expired, been revoked, or is otherwise invalid. Please re-authenticate the connected channel.`;
        console.error('[LinkedInPublisher] Access Token validation failed (401 Unauthorized):', responseData);
      } else if (statusCode === 403) {
        errorMessage = `[LinkedIn Permission Denied] Forbidden (403). The member token lacks necessary scope rights ('w_member_social' or 'w_organization_social') or is not authorized to post for URN "${cleanUrn}".`;
        console.error('[LinkedInPublisher] Permission Denied (403 Forbidden):', responseData);
      } else {
        errorMessage = `[LinkedIn API Error] HTTP ${statusCode}: ${responseData?.message || error.message}`;
        console.error('[LinkedInPublisher] API Connection Failure:', responseData || error.message);
      }
    } else {
      errorMessage = error.message || errorMessage;
      console.error('[LinkedInPublisher] Non-HTTP Runtime Exception:', error);
    }

    // Persist failure status and detailed telemetry log in database
    await updatePostDatabaseStatus(postId, 'FAILED', errorMessage);

    return {
      success: false,
      error: errorMessage,
      tokenExpired: isExpired,
    };
  }
}

/**
 * Unified Helper to persist the post status updates to multiple database targets:
 * 1. Prisma database status mapping
 * 2. Firestore document updates (in 'Posts' and 'posts' collections)
 * 3. Local in-memory global state so the dashboard reflects the status in real-time
 */
async function updatePostDatabaseStatus(
  postId: string,
  status: 'PUBLISHED' | 'FAILED',
  logMessage: string
): Promise<void> {
  const isPublished = status === 'PUBLISHED';
  const publishedAtDate = isPublished ? new Date() : null;

  console.log(`[DatabaseSync] Syncing Post ${postId} to state: ${status}. Message: ${logMessage}`);

  // 1. Update the local in-memory global queue list immediately for real-time frontend UI update
  try {
    updateMemoryPostStatus(postId, status, logMessage);
  } catch (memErr: any) {
    console.warn('[DatabaseSync] Skipping memory post synchronization fallback:', memErr.message);
  }

  // 2. Update the Prisma database SocialPost table
  try {
    await db.socialPost.update({
      where: { id: postId },
      data: {
        status: status,
        publishedAt: publishedAtDate,
        errorLog: logMessage,
      },
    });
    console.log('[DatabaseSync] Successfully persisted state to Prisma PostgreSQL table.');
  } catch (dbErr: any) {
    console.warn('[DatabaseSync] Prisma state update failed or database unaligned:', dbErr.message);
  }

  // 3. Update active Firestore 'Posts' and 'posts' collections (if configured)
  try {
    const postRef1 = doc(firestoreDb, 'Posts', postId);
    await updateDoc(postRef1, {
      status: isPublished ? 'published' : 'failed',
      errorLog: logMessage,
      publishedAt: publishedAtDate ? publishedAtDate.toISOString() : null,
      updatedAt: new Date().toISOString()
    });

    const postRef2 = doc(firestoreDb, 'posts', postId);
    await updateDoc(postRef2, {
      status: isPublished ? 'published' : 'failed',
      errorLog: logMessage,
      publishedAt: publishedAtDate ? publishedAtDate.toISOString() : null,
      updatedAt: new Date().toISOString()
    });

    console.log('[DatabaseSync] Successfully persisted state to Firestore collections.');
  } catch (fsErr: any) {
    // Safe bypass in case of simulated/uninitialized Firebase environment
    console.warn('[DatabaseSync] Firestore update bypassed or uninitialized:', fsErr.message);
  }
}
