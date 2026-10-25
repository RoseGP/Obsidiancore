import axios from 'axios';

/**
 * Helper function to retrieve a binary Buffer from an imageUrl string or a file buffer.
 * Automatically handles fetching remote image URLs and returning raw buffers.
 * 
 * @param {string|Buffer} source - The public image URL or local file buffer
 * @returns {Promise<Buffer>} - Resolves to a binary Buffer
 */
async function ensureBuffer(source) {
  if (Buffer.isBuffer(source)) {
    return source;
  }

  if (typeof source === 'string' && source.startsWith('http')) {
    try {
      console.log(`[SocialPublishingService] Fetching remote image binary from URL: ${source}`);
      const response = await axios.get(source, { responseType: 'arraybuffer' });
      return Buffer.from(response.data);
    } catch (error) {
      throw new Error(`Failed to fetch image binary from URL. Error: ${error.message}`);
    }
  }

  throw new Error('Invalid image source. Must be a remote HTTP URL string or a binary Buffer object.');
}

/**
 * Handle API rate limit error detection and formatting.
 * 
 * @param {any} error - The caught Axios error or generic error
 * @param {string} platform - The target platform ('LINKEDIN', 'FACEBOOK', etc.)
 * @returns {Error} - Formatted error with clean message
 */
function handlePublishingError(error, platform) {
  const status = error.response?.status;
  const data = error.response?.data;
  const message = error.message;

  console.error(`[SocialPublishingService] Error on ${platform} API callback:`, {
    status,
    message,
    data: data ? JSON.stringify(data) : 'N/A'
  });

  // Detect Rate Limits (HTTP 429)
  if (status === 429) {
    return new Error(`[${platform} Rate Limit Error] API rate limit exceeded. Please back off and try again later.`);
  }

  // Detect Expired Token or Authorization issues (HTTP 401)
  if (status === 401 || status === 403) {
    return new Error(`[${platform} Auth Error] Unauthorized or expired access token. Please re-authenticate your social account.`);
  }

  // General server/validation errors
  const apiMessage = data?.error?.message || data?.message || data?.error_description || message;
  return new Error(`[${platform} Publishing Failed] Status ${status || 'Unknown'}: ${apiMessage}`);
}

/**
 * -----------------------------------------------------------------------------
 * LINKEDIN PUBLISHING SERVICE LAYER
 * -----------------------------------------------------------------------------
 */

/**
 * Registers an image asset with LinkedIn, uploads the raw image bytes,
 * and publishes a text-and-image post via the UGC Posts API.
 * 
 * @param {string} accessToken - Active LinkedIn OAuth2 Access Token
 * @param {string} authorUrn - LinkedIn Person/Organization URN (e.g. 'urn:li:person:123456')
 * @param {string} caption - Post description or share commentary
 * @param {string|Buffer} [image] - Optional public image URL or binary Buffer
 * @returns {Promise<object>} - Response payload containing status and post ID
 */
export async function publishLinkedInPost(accessToken, authorUrn, caption, image) {
  try {
    if (!accessToken) {
      throw new Error('LinkedIn access token is required.');
    }
    if (!authorUrn) {
      throw new Error('LinkedIn Author URN is required.');
    }

    // Ensure author URN matches LinkedIn's canonical pattern
    const canonicalAuthor = authorUrn.startsWith('urn:li:') ? authorUrn : `urn:li:person:${authorUrn}`;

    let assetUrn = null;

    // Handle Image upload flow if image source is provided
    if (image) {
      console.log('[LinkedIn Publisher] Starting image registerUpload flow...');
      const imageBuffer = await ensureBuffer(image);

      // Step A: Register the asset with LinkedIn to acquire the uploadUrl
      const registerPayload = {
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: canonicalAuthor,
          supportedUploadMechanisms: ['SYNCHRONOUS_UPLOAD']
        }
      };

      const registerRes = await axios.post(
        'https://api.linkedin.com/v2/assets?action=registerUpload',
        registerPayload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const uploadUrl = registerRes.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadWithMechanism'].uploadUrl;
      assetUrn = registerRes.data.value.asset;

      console.log(`[LinkedIn Publisher] Image asset registered successfully: ${assetUrn}. Uploading binary bytes...`);

      // Step B: Upload the raw image binary bytes to LinkedIn's AWS S3 upload bucket
      await axios.put(uploadUrl, imageBuffer, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'image/jpeg'
        }
      });

      console.log('[LinkedIn Publisher] Image upload completed. Handshaking UGC Post endpoint...');
    }

    // Step C: Build UGC Post payload depending on whether we have media attached or only text
    const shareContent = {
      shareCommentary: {
        text: caption || ''
      },
      shareMediaCategory: assetUrn ? 'IMAGE' : 'NONE'
    };

    if (assetUrn) {
      shareContent.media = [
        {
          status: 'READY',
          description: {
            text: 'Attached image description'
          },
          media: assetUrn,
          title: {
            text: 'Shared image'
          }
        }
      ];
    }

    const ugcPayload = {
      author: canonicalAuthor,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': shareContent
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
      }
    };

    const ugcResponse = await axios.post(
      'https://api.linkedin.com/v2/ugcPosts',
      ugcPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      }
    );

    const createdPostId = ugcResponse.data.id;
    console.log(`[LinkedIn Publisher] ✓ Successfully published UGC Post: ${createdPostId}`);

    return {
      success: true,
      platform: 'LINKEDIN',
      postId: createdPostId,
      assetUrn: assetUrn
    };

  } catch (error) {
    throw handlePublishingError(error, 'LINKEDIN');
  }
}

/**
 * -----------------------------------------------------------------------------
 * FACEBOOK PUBLISHING SERVICE LAYER
 * -----------------------------------------------------------------------------
 */

/**
 * Publishes text posts to a Facebook Page Feed or uploads images directly with captions.
 * 
 * @param {string} accessToken - Active Facebook Page/User Access Token
 * @param {string} pageOrUserId - Facebook Page ID or 'me'
 * @param {string} caption - Post message body
 * @param {string|Buffer} [image] - Optional public image URL or binary Buffer
 * @returns {Promise<object>} - Response payload containing status and post ID
 */
export async function publishFacebookPost(accessToken, pageOrUserId, caption, image) {
  try {
    if (!accessToken) {
      throw new Error('Facebook access token is required.');
    }
    const targetId = pageOrUserId || 'me';

    // Facebook utilizes different endpoints depending on presence of images
    if (image) {
      console.log(`[Facebook Publisher] Attaching image to Facebook Feed under node: ${targetId}...`);
      
      const imageBuffer = await ensureBuffer(image);

      // We use standard FormData helper built-in Node 18+ to build multipart upload
      const formData = new FormData();
      formData.append('caption', caption || '');
      
      // Convert buffer to Web Blob to append to standard native Node FormData
      const imageBlob = new Blob([imageBuffer], { type: 'image/jpeg' });
      formData.append('source', imageBlob, 'social_post_image.jpg');

      const photoResponse = await axios.post(
        `https://graph.facebook.com/v15.0/${targetId}/photos`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`
            // axios automatically calculates boundaries for standard FormData payloads
          }
        }
      );

      console.log(`[Facebook Publisher] ✓ Successfully uploaded photo post: ${photoResponse.data.id}`);
      return {
        success: true,
        platform: 'FACEBOOK',
        postId: photoResponse.data.id,
        postIdType: 'photo_id'
      };

    } else {
      // Standard text feed status update
      console.log(`[Facebook Publisher] Posting text-only feed update to: ${targetId}...`);
      
      const feedResponse = await axios.post(
        `https://graph.facebook.com/v15.0/${targetId}/feed`,
        null,
        {
          params: {
            message: caption || ''
          },
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      console.log(`[Facebook Publisher] ✓ Successfully updated feed post: ${feedResponse.data.id}`);
      return {
        success: true,
        platform: 'FACEBOOK',
        postId: feedResponse.data.id,
        postIdType: 'feed_post_id'
      };
    }

  } catch (error) {
    throw handlePublishingError(error, 'FACEBOOK');
  }
}

/**
 * -----------------------------------------------------------------------------
 * INSTAGRAM PUBLISHING SERVICE LAYER
 * -----------------------------------------------------------------------------
 */

/**
 * Publishes an image and caption to an Instagram Business account.
 * Instagram requires a multi-step media container flow.
 * Note: Instagram Graph API requires image sources to be publicly accessible URL strings.
 * 
 * @param {string} accessToken - Facebook Graph Access Token (linked to Instagram Business account)
 * @param {string} instagramBusinessAccountId - The ID of the Target Instagram Business account
 * @param {string} caption - The photo caption/hashtags
 * @param {string} imageUrl - The publicly-hosted image URL (string required by Meta)
 * @returns {Promise<object>} - Response payload containing status and Instagram Media ID
 */
export async function publishInstagramPost(accessToken, instagramBusinessAccountId, caption, imageUrl) {
  try {
    if (!accessToken) {
      throw new Error('Instagram access token is required.');
    }
    if (!instagramBusinessAccountId) {
      throw new Error('Instagram Business Account ID is required.');
    }
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('Instagram publishing requires a publicly accessible, absolute Image URL string.');
    }

    console.log(`[Instagram Publisher] Creating media container for Account: ${instagramBusinessAccountId}...`);

    // Step A: Request container creation with image URL and caption
    const containerRes = await axios.post(
      `https://graph.facebook.com/v15.0/${instagramBusinessAccountId}/media`,
      null,
      {
        params: {
          image_url: imageUrl,
          caption: caption || ''
        },
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const creationId = containerRes.data.id;
    console.log(`[Instagram Publisher] Container created with ID: ${creationId}. Polling processing status...`);

    // Step B: Poll container status to check if processing is finished (max 5 attempts)
    let containerReady = false;
    let attempts = 0;
    const maxAttempts = 5;

    while (!containerReady && attempts < maxAttempts) {
      attempts++;
      // Wait 3 seconds before querying container state
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const statusRes = await axios.get(
        `https://graph.facebook.com/v15.0/${creationId}`,
        {
          params: {
            fields: 'status_code,status'
          },
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      );

      const status = statusRes.data.status_code;
      console.log(`[Instagram Publisher] Poll attempt ${attempts}: Container status is "${status}"`);

      if (status === 'FINISHED') {
        containerReady = true;
      } else if (status === 'ERROR') {
        throw new Error(`Instagram media container processing failed: ${statusRes.data.status || 'Unknown error'}`);
      }
    }

    if (!containerReady) {
      throw new Error('Instagram media container took too long to compile/process (polling timeout).');
    }

    console.log(`[Instagram Publisher] Container ${creationId} ready. Dispatching final publish request...`);

    // Step C: Trigger final publication of the prepared media container
    const publishRes = await axios.post(
      `https://graph.facebook.com/v15.0/${instagramBusinessAccountId}/media_publish`,
      null,
      {
        params: {
          creation_id: creationId
        },
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const publishedMediaId = publishRes.data.id;
    console.log(`[Instagram Publisher] ✓ Successfully published post live on Instagram! Media ID: ${publishedMediaId}`);

    return {
      success: true,
      platform: 'INSTAGRAM',
      postId: publishedMediaId
    };

  } catch (error) {
    throw handlePublishingError(error, 'INSTAGRAM');
  }
}
