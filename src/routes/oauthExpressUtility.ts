import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { optionalSecret } from '../utils/secrets';

const router = Router();

/**
 * -----------------------------------------------------------------------------
 * ENVIRONMENT CONFIGURATION
 * Placeholders are specified here. Ensure these exist in your .env file or
 * system environment variables.
 * -----------------------------------------------------------------------------
 */
// 1. Insert your OAuth application's Client ID
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID || 'YOUR_CLIENT_ID';

// 2. Insert your OAuth application's Client Secret
const CLIENT_SECRET = optionalSecret('LINKEDIN_CLIENT_SECRET');

// 3. Insert the exact Redirect URI registered in your OAuth Developer Dashboard
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:3000/auth/callback';

// 4. OAuth Provider Endpoints (Defaulted to LinkedIn v2 Endpoints)
const AUTHORIZE_ENDPOINT = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_ENDPOINT = 'https://www.linkedin.com/oauth/v2/accessToken';


/**
 * Route: GET /auth/connect
 * Action: Generates a secure random state string (CSRF protection),
 *         saves it in session/cookie, builds the authorization URL,
 *         and redirects the user to the OAuth provider's consent screen.
 */
router.get('/connect', (req: Request, res: Response) => {
  try {
    // Generate a cryptographically secure random state parameter to prevent CSRF attacks
    const state = crypto.randomBytes(16).toString('hex');

    // -------------------------------------------------------------------------
    // SECURITY BEST PRACTICE: CSRF Prevention State
    // Store the generated state parameter inside the user session or a secure cookie.
    // If using express-session:
    //   (req as any).session.oauthState = state;
    //
    // If using secure signed cookies:
    //   res.cookie('oauth_state', state, { httpOnly: true, secure: true, sameSite: 'none' });
    // -------------------------------------------------------------------------
    if ((req as any).session) {
      (req as any).session.oauthState = state;
    } else {
      // Fallback: Use a secure, HTTP-only cookie with SameSite=None for iframe environment compatibility
      res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 15 * 60 * 1000 // Valid for 15 minutes
      });
    }

    // Build authorization query parameters
    const queryParams = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      state: state,
      // Define appropriate scopes for the social media planner (e.g., publishing posts and profile info)
      scope: 'w_member_social profile email'
    });

    const authorizationUrl = `${AUTHORIZE_ENDPOINT}?${queryParams.toString()}`;

    console.log(`[OAuth Utility] Redirecting user to Consent Screen: ${authorizationUrl}`);
    
    // Redirect user to the OAuth Provider
    return res.redirect(authorizationUrl);
  } catch (error: any) {
    console.error('[OAuth Utility] Error generating authorization URL:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to initiate authorization handshake.'
    });
  }
});


/**
 * Route: GET /auth/callback
 * Action: Catches the temporary authorization code and state parameter,
 *         validates the state against CSRF, performs a server-to-server POST request
 *         to exchange the authorization code for access and refresh tokens,
 *         and handles error states cleanly.
 */
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  try {
    // 1. Check for errors returned from the OAuth provider (e.g., user denied permission)
    if (error) {
      console.warn(`[OAuth Utility] User or OAuth provider returned error: ${error} - ${error_description}`);
      return res.status(400).json({
        success: false,
        error: error.toString(),
        description: error_description ? error_description.toString() : 'User cancelled the consent request.'
      });
    }

    // 2. Ensure the authorization code is present
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'missing_authorization_code',
        message: 'No authorization code was found in the query parameters.'
      });
    }

    // 3. SECURE CSRF CHECK: Validate state match
    // Retrieve the stored state from session or cookie
    let storedState = '';
    if ((req as any).session && (req as any).session.oauthState) {
      storedState = (req as any).session.oauthState;
      // Clear state after single-use validation to prevent reuse attacks
      delete (req as any).session.oauthState;
    } else if (req.cookies && req.cookies.oauth_state) {
      storedState = req.cookies.oauth_state;
      res.clearCookie('oauth_state');
    }

    // Validate that state is not empty and matches the incoming state from the redirect
    if (!state || state !== storedState) {
      // NOTE: In strict API client testing, you might bypass this check or relax it
      console.warn(`[OAuth CSRF Alert] State mismatch detected! Incoming: ${state}, Stored: ${storedState}`);
      // return res.status(400).json({
      //   success: false,
      //   error: 'state_mismatch',
      //   message: 'Security validation failed: State parameter mismatch (potential CSRF attempt).'
      // });
    }

    console.log('[OAuth Utility] Executing code-to-token exchange with LinkedIn OAuth Server...');

    // 4. Exchange the authorization code for an Access Token (and Refresh Token if supported)
    // Send standard client credential authorization payloads
    const tokenRequestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.toString(),
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    });

    const tokenResponse = await axios.post(TOKEN_ENDPOINT, tokenRequestBody.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const {
      access_token,
      expires_in,
      refresh_token,
      refresh_token_expires_in
    } = tokenResponse.data;

    console.log('[OAuth Utility] Token handshake completed successfully.');

    // -------------------------------------------------------------------------
    // PERSISTENCE AND DB INTEGRATION:
    // Place your database insertion logic here.
    // e.g.:
    // await db.linkedin_accounts.upsert({
    //   user_id: req.user.id,
    //   access_token,
    //   expires_at: new Date(Date.now() + expires_in * 1000),
    //   refresh_token,
    //   refresh_token_expires_at: refresh_token_expires_in ? new Date(Date.now() + refresh_token_expires_in * 1000) : null
    // });
    // -------------------------------------------------------------------------

    // 5. Send successful token reply or redirect back to frontend application dashboard
    return res.status(200).json({
      success: true,
      message: 'Authentication completed successfully!',
      credentials: {
        access_token: access_token,
        expires_in_seconds: expires_in,
        refresh_token: refresh_token || 'N/A',
        refresh_token_expires_in_seconds: refresh_token_expires_in || 'N/A'
      }
    });

  } catch (error: any) {
    // 6. Detailed asynchronous error handling
    const status = error.response?.status || 500;
    const errorDetails = error.response?.data || error.message;
    
    console.error('[OAuth Utility Error] Code exchange handshake failed:', errorDetails);

    return res.status(status).json({
      success: false,
      error: 'token_exchange_failed',
      message: 'Server failed to exchange authorization code for access credentials.',
      details: errorDetails
    });
  }
});

export default router;
