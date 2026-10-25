import { Router, Request, Response } from 'express';

const router = Router();

/**
 * META CUSTOM FACEBOOK/INSTAGRAM GRAPH API MOCK ENDPOINT
 * Responds to caption and image_url posts with realistic resource identifiers.
 */
router.post('/meta', (req: Request, res: Response) => {
  try {
    const { caption, image_url, access_token } = req.body;
    console.log('[Mock Meta API] Received publication post request package:', { caption, image_url, access_token });

    // Built-in trigger to test error handlings in our background worker
    if (caption && (caption.toLowerCase().includes('fail_instagram') || caption.toLowerCase().includes('trigger_429_meta') || caption.toLowerCase().includes('rate_limit_meta'))) {
      if (caption.toLowerCase().includes('429') || caption.toLowerCase().includes('rate_limit')) {
        res.status(429).json({
          error: {
            message: 'Meta Graph API rate limit exceeded (429 Too Many Requests).',
            type: 'OAuthException',
            code: 429
          }
        });
        return;
      }
      res.status(400).json({
        error: {
          message: 'The aspect ratio for the image attached is unsupported by Meta systems.',
          type: 'OAuthException',
          code: 100,
          error_subcode: 2207009
        }
      });
      return;
    }

    res.status(200).json({
      id: `meta_post_${Math.floor(Math.random() * 900000) + 100000}`,
      status: 'FINISHED',
      permalink: `https://www.instagram.com/p/mock_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Meta Api mock server fault occurred.' });
  }
});

/**
 * LINKEDIN UGC POST API MOCK ENDPOINT
 * Simulates user-generated content share results from UGC post pipelines.
 */
router.post('/linkedin', (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('[Mock LinkedIn API] HTTP POST body detail payload:', JSON.stringify(req.body, null, 2));

    const specificContent = req.body.specificContent;
    const commentary = specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text || '';

    // Built-in trigger to test error response handling
    if (commentary && (commentary.toLowerCase().includes('fail_linkedin') || commentary.toLowerCase().includes('trigger_429_linkedin') || commentary.toLowerCase().includes('rate_limit_linkedin'))) {
      if (commentary.toLowerCase().includes('429') || commentary.toLowerCase().includes('rate_limit')) {
        res.status(429).json({
          error: 'LinkedIn UGC API rate limit exceeded (429 Too Many Requests).'
        });
        return;
      }
      res.status(401).json({
        error: 'LinkedIn Auth expired: w_member_social scope checks failed for active user credentials.'
      });
      return;
    }

    res.status(201).json({
      id: `urn:li:share:${Math.floor(Math.random() * 89999999) + 10000000}`,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      author: req.body.author || 'urn:li:person:mock_author_abc'
    });
  } catch (error: any) {
    res.status(500).json({ error: 'LinkedIn API simulation experienced internal fault.' });
  }
});

/**
 * X (TWITTER) API V2 TWEETS MOCK ENDPOINT
 */
router.post('/x', (req: Request, res: Response) => {
  try {
    const { text, media } = req.body;
    console.log('[Mock X API] Received tweet creation request:', { text, media });

    if (text && (text.toLowerCase().includes('trigger_429_x') || text.toLowerCase().includes('rate_limit_x') || text.toLowerCase().includes('fail_x'))) {
      if (text.toLowerCase().includes('429') || text.toLowerCase().includes('rate_limit')) {
        res.status(429).json({
          error: {
            message: 'X API v2 rate limit exceeded (429 Too Many Requests).',
            code: 429
          }
        });
        return;
      }
      res.status(400).json({
        error: {
          message: 'X API v2 duplicate tweet content detected.',
          code: 187
        }
      });
      return;
    }

    res.status(201).json({
      data: {
        id: `x_tweet_${Math.floor(Math.random() * 899999999) + 100000000}`,
        text: text
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: 'X API simulation experienced internal fault.' });
  }
});

export default router;
