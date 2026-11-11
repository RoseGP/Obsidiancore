import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { publishToPlatforms } from './publishers';

// Initialize the Firebase Admin SDK
admin.initializeApp();

// Protected HTTPS API (master API key): GET /api/v1/health
export { api } from './api';

// Export OAuth 2.0 Callbacks
export { linkedinCallback, facebookCallback } from './oauth';

/**
 * Cloud Firestore Trigger: Listen for changes in the 'posts' collection documents.
 * Triggered on status transitions to 'publishing' to post multi-media assets to live channel APIs.
 */
export const publishPostTrigger = onDocumentUpdated('posts/{postId}', async (event) => {
  const change = event.data;
  if (!change) {
    console.warn('[Cloud Function] No update event data payload found.');
    return;
  }

  const beforeData = change.before.data();
  const afterData = change.after.data();

  if (!afterData) {
    console.warn('[Cloud Function] Target document deleted or lacks valid body data.');
    return;
  }

  const postId = event.params.postId;

  // Enforce precise condition check: Transition to 'publishing' status only
  const isPublishingTransition = afterData.status === 'publishing' && (!beforeData || beforeData.status !== 'publishing');

  if (!isPublishingTransition) {
    console.log(`[Cloud Function] Skipping change event on Post ${postId}: status did not transition to 'publishing'. Current: '${afterData.status}'`);
    return;
  }

  console.log(`[Cloud Function] Processing post publication routine for Post ID: ${postId}`);

  const { userId, caption, media = [], channelIds = [] } = afterData;

  if (!userId) {
    console.error(`[Cloud Function] Post ${postId} is missing owner userId.`);
    await change.after.ref.update({
      status: 'failed',
      error: 'Missing creator userId in post document fields.',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return;
  }

  if (channelIds.length === 0) {
    console.warn(`[Cloud Function] Post ${postId} does not have any target platform channelIds registered.`);
    await change.after.ref.update({
      status: 'failed',
      error: 'No target platforms or channel IDs selected for publishing.',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return;
  }

  try {
    // 1. Dispatch social API calls via publishers pipeline
    const publishResultList = await publishToPlatforms(userId, caption, media, channelIds);

    // 2. Aggregate outcomes
    const failedPubs = publishResultList.filter(item => !item.success);
    const successCount = publishResultList.length - failedPubs.length;

    console.log(`[Cloud Function] Publish session for Post ${postId} complete: ${successCount} succeeded, ${failedPubs.length} failed.`);

    if (failedPubs.length > 0) {
      // If any of the target channels failed, set document status to 'failed' to provide transparent user feedback
      const errorSummary = failedPubs.map(f => `${f.platform.toUpperCase()}: ${f.error}`).join('; ');
      
      await change.after.ref.update({
        status: 'failed',
        error: `Failed channels: ${errorSummary}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`[Cloud Function] Post ${postId} status transitioned to 'failed'. Logs written.`);
    } else {
      // 100% Success across all channels
      await change.after.ref.update({
        status: 'published',
        error: admin.firestore.FieldValue.delete(), // clear any previous error log
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log(`[Cloud Function] Post ${postId} status transitioned to 'published'.`);
    }

  } catch (error: any) {
    console.error(`[Cloud Function] Critical unhandled error publishing Post ${postId}:`, error);
    
    await change.after.ref.update({
      status: 'failed',
      error: `Internal Server Error: ${error instanceof Error ? error.message : String(error)}`,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
});
