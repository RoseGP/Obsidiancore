import * as functions from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import axios from 'axios';

// Get encryption key from environment configurations or a fallback for testing
const ENCRYPTION_KEY = process.env.OAUTH_TOKEN_ENCRYPTION_KEY || 'f8b7921a2386927902dcb112c3f843f5'; // 32-byte key fallback
const IV_LENGTH = 16;

/**
 * Utility to securely encrypt sensitive API access tokens before storing them in Firestore.
 */
function encryptToken(token: string): string {
  // Key must be exactly 32 bytes (256 bits) for aes-256-cbc.
  const key = Buffer.alloc(32);
  Buffer.from(ENCRYPTION_KEY).copy(key);
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * HTTPS Trigger: LinkedIn OAuth 2.0 callback redirect handler.
 * Endpoint: GET /linkedinCallback
 */
export const linkedinCallback = functions.onRequest(async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Handle access denied or user cancellation
  if (error) {
    console.error('[OAuth Callback] LinkedIn Authorization Error:', error, error_description);
    res.status(400).send(`LinkedIn Authorization Failed: ${error_description || error}`);
    return;
  }

  if (!code || !state) {
    res.status(400).send('LinkedIn callback is missing authorization code or state validation parameters.');
    return;
  }

  // The state parameter contains the user ID to associate the token with
  const userId = state.toString();

  console.log(`[OAuth Callback] LinkedIn code received for user: ${userId}. Initiating Access Token Exchange.`);

  try {
    const clientId = process.env.LINKEDIN_CLIENT_ID || 'MOCK_LINKEDIN_CLIENT_ID';
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET || 'MOCK_LINKEDIN_CLIENT_SECRET';
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI || 'https://us-central1-my-project.cloudfunctions.net/linkedinCallback';

    console.log(`[OAuth Callback] Dispatching LinkedIn token exchange token URL with code: ${code.toString().substring(0, 5)}...`);

    // 1. Perform authorization code exchange with LinkedIn's OAuth v2 token endpoint
    const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code.toString());
    params.append('redirect_uri', redirectUri);
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);

    let accessToken = '';
    let refreshToken = '';
    let expiresIn = 5184000; // 60 days default

    try {
      const response = await axios.post(tokenUrl, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      accessToken = response.data.access_token;
      refreshToken = response.data.refresh_token || '';
      if (response.data.expires_in) {
        expiresIn = response.data.expires_in;
      }
    } catch (axiosError: any) {
      const errorMsg = axiosError.response?.data
        ? JSON.stringify(axiosError.response.data)
        : axiosError.message;
      throw new Error(`LinkedIn token exchange failed: ${errorMsg}`);
    }

    if (!accessToken) {
      throw new Error('LinkedIn token endpoint did not return an access token.');
    }

    // 2. Fetch authenticated user details from LinkedIn userinfo OIDC API
    let handle = 'LinkedIn User';
    let profilePictureUrl = 'https://images.unsplash.com/photo-1560179707-f14e90ef3623?w=150';

    try {
      const profileResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      if (profileResponse.data.name) {
        handle = profileResponse.data.name;
      } else if (profileResponse.data.given_name || profileResponse.data.family_name) {
        handle = [profileResponse.data.given_name, profileResponse.data.family_name].filter(Boolean).join(' ');
      }
      if (profileResponse.data.picture) {
        profilePictureUrl = profileResponse.data.picture;
      }
    } catch (profileError: any) {
      console.warn('[OAuth Callback] LinkedIn OIDC Profile fetch failed, attempting v2/me fallback:', profileError.message);
      try {
        const fallbackProfile = await axios.get('https://api.linkedin.com/v2/me', {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        });
        if (fallbackProfile.data.localizedFirstName) {
          handle = `${fallbackProfile.data.localizedFirstName} ${fallbackProfile.data.localizedLastName || ''}`.trim();
        }
      } catch (meError) {
        console.warn('[OAuth Callback] LinkedIn fallback v2/me also failed:', meError);
      }
    }

    // 3. Encrypt access token and refresh token securely
    const encryptedAccessToken = encryptToken(accessToken);
    const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : undefined;

    // 4. Persist credentials securely inside the user's Firestore 'channels' subcollection
    const db = admin.firestore();
    const channelRef = db.doc(`users/${userId}/channels/linkedin`);

    const channelPayload: any = {
      id: 'linkedin',
      platform: 'linkedin',
      connected: true,
      handle,
      accessToken: encryptedAccessToken,
      tokenExpiry: admin.firestore.Timestamp.fromDate(new Date(Date.now() + expiresIn * 1000)),
      scope: ['w_member_social', 'r_liteprofile', 'r_organization_admin'],
      profilePictureUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (encryptedRefreshToken) {
      channelPayload.refreshToken = encryptedRefreshToken;
    }

    await channelRef.set(channelPayload, { merge: true });

    console.log(`[OAuth Callback] LinkedIn channel successfully linked and encrypted for User: ${userId}`);

    // Redirect the user back to the planner application dashboard
    const appUrl = process.env.APP_DASHBOARD_URL || 'https://ai.studio/build';
    res.redirect(`${appUrl}?channelConnected=linkedin&status=success`);

  } catch (err: any) {
    console.error('[OAuth Callback] LinkedIn Handshake Exception:', err);
    res.status(500).send(`Internal LinkedIn OAuth Handshake Error: ${err.message || err}`);
  }
});

/**
 * HTTPS Trigger: Facebook OAuth 2.0 callback redirect handler.
 * Endpoint: GET /facebookCallback
 */
export const facebookCallback = functions.onRequest(async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Handle authorization issues or cancellations
  if (error) {
    console.error('[OAuth Callback] Facebook Authorization Error:', error, error_description);
    res.status(400).send(`Facebook Authorization Failed: ${error_description || error}`);
    return;
  }

  if (!code || !state) {
    res.status(400).send('Facebook callback is missing authorization code or state validation parameters.');
    return;
  }

  const userId = state.toString();

  console.log(`[OAuth Callback] Facebook code received for user: ${userId}. Initiating Permanent Token Exchange.`);

  try {
    const clientId = process.env.FACEBOOK_CLIENT_ID || 'MOCK_FB_CLIENT_ID';
    const clientSecret = process.env.FACEBOOK_CLIENT_SECRET || 'MOCK_FB_CLIENT_SECRET';
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI || 'https://us-central1-my-project.cloudfunctions.net/facebookCallback';

    // 1. Exchange temporary authorization code for user access token
    let userToken = '';
    try {
      const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          client_id: clientId,
          redirect_uri: redirectUri,
          client_secret: clientSecret,
          code: code.toString(),
        },
      });
      userToken = response.data.access_token;
    } catch (axiosError: any) {
      const errorMsg = axiosError.response?.data
        ? JSON.stringify(axiosError.response.data)
        : axiosError.message;
      throw new Error(`Facebook initial user token exchange failed: ${errorMsg}`);
    }

    if (!userToken) {
      throw new Error('Facebook did not return user access token from code exchange.');
    }

    // 2. Exchange short-lived token for a long-lived (60 days) user access token
    let longLivedUserToken = userToken;
    try {
      const extendResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: clientId,
          client_secret: clientSecret,
          fb_exchange_token: userToken,
        },
      });
      longLivedUserToken = extendResponse.data.access_token || userToken;
    } catch (extendError: any) {
      console.warn('[OAuth Callback] Facebook long-lived token exchange failed, falling back to short-lived user token:', extendError.message);
    }

    // 3. Retrieve Page accounts managed by the user to select primary marketing channel
    // Pages retrieved through /me/accounts with a long-lived user token contain permanent Page Access Tokens!
    let pageAccessToken = longLivedUserToken;
    let pageId = 'fb_page_default';
    let pageName = 'Facebook Page';
    let pagePicture = 'https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=150';

    try {
      const accountsResponse = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
        params: {
          access_token: longLivedUserToken,
        },
      });

      const pages = accountsResponse.data.data;
      if (pages && pages.length > 0) {
        // Select primary or first Facebook page
        const primaryPage = pages[0];
        pageId = primaryPage.id;
        pageName = primaryPage.name;
        pageAccessToken = primaryPage.access_token || longLivedUserToken;
      }
    } catch (accountsError: any) {
      console.warn('[OAuth Callback] Facebook page accounts query failed:', accountsError.message);
    }

    // Attempt to retrieve page's high-res branding picture
    try {
      if (pageId !== 'fb_page_default') {
        const picResponse = await axios.get(`https://graph.facebook.com/v18.0/${pageId}/picture`, {
          params: {
            redirect: 'false',
            access_token: pageAccessToken,
          },
        });
        if (picResponse.data?.data?.url) {
          pagePicture = picResponse.data.data.url;
        }
      }
    } catch (picError) {
      console.warn('[OAuth Callback] Facebook page profile picture fetch failed:', picError);
    }

    // 4. Encrypt the selected Page Access Token securely before storing
    const encryptedAccessToken = encryptToken(pageAccessToken);

    // 5. Save the Facebook channel record in Firestore
    const db = admin.firestore();
    const channelRef = db.doc(`users/${userId}/channels/facebook`);

    const channelPayload = {
      id: 'facebook',
      platform: 'facebook',
      connected: true,
      handle: pageName,
      accessToken: encryptedAccessToken, // Securely Encrypted Page Access Token
      pageId: pageId,
      scope: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'publish_to_groups'],
      tokenExpiry: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)), // 60 Days mapped
      profilePictureUrl: pagePicture,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await channelRef.set(channelPayload, { merge: true });

    console.log(`[OAuth Callback] Facebook channel successfully linked and encrypted for User: ${userId}`);

    // Redirect user back to the application planner dashboard
    const appUrl = process.env.APP_DASHBOARD_URL || 'https://ai.studio/build';
    res.redirect(`${appUrl}?channelConnected=facebook&status=success`);

  } catch (err: any) {
    console.error('[OAuth Callback] Facebook Handshake Exception:', err);
    res.status(500).send(`Internal Facebook OAuth Handshake Error: ${err.message || err}`);
  }
});
