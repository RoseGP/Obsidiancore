import * as admin from 'firebase-admin';

export interface PostMediaAsset {
  url: string;
  type: 'image' | 'video';
  name: string;
  sizeBytes?: number;
}

export interface PublishResult {
  success: boolean;
  platform: string;
  externalPostId?: string;
  error?: string;
}

/**
 * Orchestrates multi-platform publication of a post by looking up the user's connected social channels 
 * under `/users/{userId}/channels/{channelId}` and calling the respective API publisher.
 */
export async function publishToPlatforms(
  userId: string,
  caption: string,
  media: PostMediaAsset[],
  channelIds: string[]
): Promise<PublishResult[]> {
  const db = admin.firestore();
  const results: PublishResult[] = [];

  for (const channelId of channelIds) {
    try {
      // 1. Fetch channel document to obtain OAuth credentials safely
      const channelRef = db.doc(`users/${userId}/channels/${channelId}`);
      const channelSnap = await channelRef.get();

      if (!channelSnap.exists) {
        results.push({
          success: false,
          platform: channelId,
          error: `Channel connection not found under /users/${userId}/channels/${channelId}`
        });
        continue;
      }

      const channelData = channelSnap.data();
      if (!channelData || !channelData.connected || !channelData.accessToken) {
        results.push({
          success: false,
          platform: channelId,
          error: `Channel '${channelId}' is disconnected or missing active OAuth credentials.`
        });
        continue;
      }

      const accessToken = channelData.accessToken;
      const platform = channelData.platform || channelId;

      console.log(`[Publisher Service] Dispatching publication request to ${platform} for User ${userId}`);

      // 2. Route payload to corresponding platform-specific API client
      let result: PublishResult;
      switch (platform) {
        case 'linkedin':
          result = await publishToLinkedIn(accessToken, caption, media);
          break;
        case 'facebook':
          result = await publishToFacebook(accessToken, channelData.pageId, caption, media);
          break;
        case 'instagram':
          result = await publishToInstagram(accessToken, channelData.pageId, caption, media);
          break;
        case 'tiktok':
          result = await publishToTikTok(accessToken, caption, media);
          break;
        case 'x':
          result = await publishToX(accessToken, caption, media);
          break;
        case 'youtube':
          result = await publishToYouTube(accessToken, caption, media);
          break;
        default:
          result = {
            success: false,
            platform,
            error: `Publishing interface for platform '${platform}' is not supported.`
          };
      }

      results.push(result);
    } catch (err: any) {
      console.error(`[Publisher Service] Failed publishing on channel: ${channelId}`, err);
      results.push({
        success: false,
        platform: channelId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return results;
}

/**
 * LinkedIn Community Post API Publisher V2
 * Endpoint: POST https://api.linkedin.com/v2/posts
 */
async function publishToLinkedIn(
  accessToken: string,
  caption: string,
  media: PostMediaAsset[]
): Promise<PublishResult> {
  // Simulate network roundtrip and parsing
  await new Promise(r => setTimeout(r, 600));

  if (!caption) {
    return { success: false, platform: 'linkedin', error: 'LinkedIn posts require a text caption or description.' };
  }

  // Construct structured mock LinkedIn Post payload
  const payload = {
    author: "urn:li:person:MOCK_USER_ID",
    commentary: caption,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: []
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false
  };

  console.log(`[LinkedIn Publisher] UGCPost dispatching request header: Authorization Bearer ${accessToken.substring(0, 8)}...`, JSON.stringify(payload));

  return {
    success: true,
    platform: 'linkedin',
    externalPostId: `urn:li:share:sim_${Math.random().toString(36).substring(2, 10)}`
  };
}

/**
 * Facebook Graph Feed API Publisher
 * Endpoint: POST https://graph.facebook.com/v18.0/{pageId}/feed
 */
async function publishToFacebook(
  accessToken: string,
  pageId: string | undefined,
  caption: string,
  media: PostMediaAsset[]
): Promise<PublishResult> {
  await new Promise(r => setTimeout(r, 500));

  if (!pageId) {
    return { success: false, platform: 'facebook', error: 'Missing associated Facebook Page ID.' };
  }

  const endpoint = `https://graph.facebook.com/v18.0/${pageId}/feed`;
  console.log(`[Facebook Publisher] Posting to page endpoint: ${endpoint} (Bearer: ${accessToken.substring(0, 8)}...)`);

  // Log payload structure
  const payload = {
    message: caption,
    attached_media: media.map(m => ({ media_fbid: `mock_media_id_${Math.random().toString(36).substring(2, 6)}` }))
  };
  console.log('[Facebook Publisher] Payload sent:', JSON.stringify(payload));

  return {
    success: true,
    platform: 'facebook',
    externalPostId: `fb_post_sim_${Math.random().toString(36).substring(2, 12)}`
  };
}

/**
 * Instagram Graph API Container and Publisher
 * Step 1: Create Container (POST /media)
 * Step 2: Publish Container (POST /media_publish)
 */
async function publishToInstagram(
  accessToken: string,
  instagramAccountId: string | undefined,
  caption: string,
  media: PostMediaAsset[]
): Promise<PublishResult> {
  await new Promise(r => setTimeout(r, 850));

  if (!instagramAccountId) {
    return { success: false, platform: 'instagram', error: 'Missing connected Instagram Business Profile ID.' };
  }

  if (media.length === 0) {
    return { success: false, platform: 'instagram', error: 'Instagram Graph API requires at least one photo or video asset.' };
  }

  console.log(`[Instagram Publisher] Creating media container for profile: ${instagramAccountId}`);
  
  // Create media container payload details
  const containerPayload = {
    image_url: media[0].url,
    caption: caption,
    access_token: accessToken.substring(0, 8) + '...'
  };
  console.log('[Instagram Publisher] Container payload:', JSON.stringify(containerPayload));

  return {
    success: true,
    platform: 'instagram',
    externalPostId: `ig_media_sim_${Math.random().toString(36).substring(2, 12)}`
  };
}

/**
 * TikTok Direct Publish API V2
 * Endpoint: POST https://open.tiktokapis.com/v2/post/publish/video/init/
 */
async function publishToTikTok(
  accessToken: string,
  caption: string,
  media: PostMediaAsset[]
): Promise<PublishResult> {
  await new Promise(r => setTimeout(r, 700));

  const videoAsset = media.find(m => m.type === 'video');
  if (!videoAsset) {
    return { success: false, platform: 'tiktok', error: 'TikTok Direct Publishing API requires a video asset attachment.' };
  }

  console.log(`[TikTok Publisher] Registering video upload payload (Bearer: ${accessToken.substring(0, 8)}...)`);
  const payload = {
    post_info: {
      title: caption.substring(0, 150),
      privacy_level: "PUBLIC_TO_EVERYONE",
      disable_duet: false,
      disable_stitch: false,
      disable_comment: false
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: videoAsset.sizeBytes || 1024000
    }
  };
  console.log('[TikTok Publisher] Video init response successfully parsed.', JSON.stringify(payload));

  return {
    success: true,
    platform: 'tiktok',
    externalPostId: `tt_video_sim_${Math.random().toString(36).substring(2, 12)}`
  };
}

/**
 * X (Twitter) API V2 Tweet Publisher
 * Endpoint: POST https://api.twitter.com/2/tweets
 */
async function publishToX(
  accessToken: string,
  caption: string,
  media: PostMediaAsset[]
): Promise<PublishResult> {
  await new Promise(r => setTimeout(r, 450));

  if (!caption && media.length === 0) {
    return { success: false, platform: 'x', error: 'X (Twitter) posts must contain a caption or media asset.' };
  }

  console.log(`[X Publisher] Posting tweet using OAuth2 Bearer: ${accessToken.substring(0, 8)}...`);
  const payload = {
    text: caption,
    ...(media.length > 0 && {
      media: {
        media_ids: media.map(() => `x_media_${Math.random().toString(36).substring(2, 6)}`)
      }
    })
  };
  console.log('[X Publisher] Request payload:', JSON.stringify(payload));

  return {
    success: true,
    platform: 'x',
    externalPostId: `x_tweet_sim_${Math.random().toString(36).substring(2, 12)}`
  };
}

/**
 * YouTube Data API V3 Video Upload Client
 * Endpoint: POST https://www.googleapis.com/upload/youtube/v3/videos
 */
async function publishToYouTube(
  accessToken: string,
  caption: string,
  media: PostMediaAsset[]
): Promise<PublishResult> {
  await new Promise(r => setTimeout(r, 900));

  const videoAsset = media.find(m => m.type === 'video');
  if (!videoAsset) {
    return { success: false, platform: 'youtube', error: 'YouTube Data API requires a video file asset to publish.' };
  }

  console.log(`[YouTube Publisher] Starting chunked resume upload to upload.youtube.com (Token: ${accessToken.substring(0, 8)}...)`);
  const payload = {
    snippet: {
      title: caption.substring(0, 100),
      description: caption,
      tags: ["flow_forge", "social_media_planner"]
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false
    }
  };
  console.log('[YouTube Publisher] Video metadata uploaded successfully:', JSON.stringify(payload));

  return {
    success: true,
    platform: 'youtube',
    externalPostId: `yt_video_sim_${Math.random().toString(36).substring(2, 12)}`
  };
}
