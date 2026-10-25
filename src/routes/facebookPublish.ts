import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

/**
 * PATH: POST /api/facebook/publish
 * Secure route handler to post text, photo, or video content to a Facebook Page.
 * 
 * Requirements implemented:
 * 1. Strict validation of Page Access Token supplied via Authorization Bearer header.
 * 2. Accepts pageId, message, optional imageUrl, and optional videoUrl.
 * 3. Conditional routing:
 *    - If `videoUrl` is provided, publishes to standard `/{page-id}/videos` endpoint.
 *    - If `imageUrl` is provided, publishes to `/{page-id}/photos` endpoint.
 *    - If text-only (no media URLs), defaults to `/{page-id}/feed` endpoint.
 */
router.post('/publish', async (req: Request, res: Response) => {
  try {
    // 1. Strict validation of Authorization Bearer Header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: A valid Page Access Token must be passed securely in the Authorization header as "Bearer <TOKEN>".'
      });
    }

    const pageAccessToken = authHeader.split(' ')[1]?.trim();
    if (!pageAccessToken) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Page Access Token is empty or invalid.'
      });
    }

    // 2. Validate payload parameters
    const { pageId, message, imageUrl, videoUrl } = req.body;

    if (!pageId) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error: "pageId" (Facebook Page ID) is required to identify the target destination.'
      });
    }

    if (!message && !imageUrl && !videoUrl) {
      return res.status(400).json({
        success: false,
        error: 'Validation Error: At least one content parameter ("message", "imageUrl", or "videoUrl") must be provided.'
      });
    }

    const fbGraphApiVersion = 'v20.0';
    let targetUrl = '';
    const params: Record<string, any> = {
      access_token: pageAccessToken
    };

    // 3. Conditional Routing & Parameter Assignment
    if (videoUrl) {
      // Route to page videos container
      targetUrl = `https://graph.facebook.com/${fbGraphApiVersion}/${pageId}/videos`;
      params.file_url = videoUrl;
      if (message) {
        params.description = message; // Facebook videos use description instead of message/caption
      }
      console.log(`[Facebook Publishing] Routing video upload to Page ${pageId} videos endpoint.`);
    } else if (imageUrl) {
      // Route to page photos container
      targetUrl = `https://graph.facebook.com/${fbGraphApiVersion}/${pageId}/photos`;
      params.url = imageUrl;
      if (message) {
        params.caption = message; // Facebook photos accept caption for descriptions
      }
      console.log(`[Facebook Publishing] Routing photo upload to Page ${pageId} photos endpoint.`);
    } else {
      // Default to text/link-only Page Feed
      targetUrl = `https://graph.facebook.com/${fbGraphApiVersion}/${pageId}/feed`;
      params.message = message;
      console.log(`[Facebook Publishing] Routing text update to Page ${pageId} feed endpoint.`);
    }

    // 4. Send API request directly to Meta Graph API
    const response = await axios.post(targetUrl, null, {
      params,
      headers: { 'Accept': 'application/json' }
    });

    const result = response.data;

    // 5. Build standard clean response
    return res.status(200).json({
      success: true,
      message: 'Content successfully published to Facebook Page.',
      postId: result.id || result.post_id,
      endpointUsed: targetUrl.replace(`https://graph.facebook.com/${fbGraphApiVersion}/${pageId}`, ''),
      rawResult: result
    });

  } catch (err: any) {
    const errorResponse = err.response?.data?.error;
    console.error('[Facebook Page Publishing Error]:', errorResponse || err.message);

    if (errorResponse) {
      const code = errorResponse.code;
      const subcode = errorResponse.error_subcode;
      const fbMessage = errorResponse.message;

      // Detect expired or unauthorized tokens
      if (code === 190 || code === 102 || code === 10) {
        return res.status(401).json({
          success: false,
          error: 'Authentication Exception: Page Access Token has expired or is unauthorized.',
          facebookError: { code, subcode, message: fbMessage }
        });
      }

      // Detect permission issues
      if (code === 200 || code === 210 || code === 283) {
        return res.status(403).json({
          success: false,
          error: 'Authorization Exception: Insufficient permissions to post content. Ensure manage_pages / publish_pages / pages_manage_posts is authorized.',
          facebookError: { code, subcode, message: fbMessage }
        });
      }

      // General Facebook API error response
      return res.status(400).json({
        success: false,
        error: `Facebook Graph API Error: ${fbMessage}`,
        facebookError: { code, subcode, message: fbMessage }
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      details: err.message
    });
  }
});

export default router;
