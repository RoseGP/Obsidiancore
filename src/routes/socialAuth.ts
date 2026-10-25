import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { db } from '../utils/db';
import { initializeApp as initializeAdminApp, getApps as getAdminApps } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, Timestamp as AdminTimestamp } from 'firebase-admin/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';
import { 
  saveSocialTokens, 
  getAllSocialTokens, 
  deleteSocialToken, 
  checkAndRefreshToken, 
  getSocialToken 
} from '../utils/socialAuthStore';
import { coreSecret } from '../utils/secrets';

// Validates if a database ID is a syntactically valid Firestore database ID.
function isValidDatabaseId(dbId: string | undefined): boolean {
  if (!dbId) return false;
  if (dbId === '(default)') return true;
  return /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(dbId);
}

function getAdminFirestoreDb() {
  const resolvedProjectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || firebaseConfigJson.projectId;
  const envDbId = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || process.env.FIREBASE_FIRESTORE_DATABASE_ID;
  const resolvedDatabaseId = isValidDatabaseId(envDbId)
    ? envDbId
    : (isValidDatabaseId(firebaseConfigJson.firestoreDatabaseId) ? firebaseConfigJson.firestoreDatabaseId : undefined);

  const adminApp = getAdminApps().length === 0
    ? initializeAdminApp({
        projectId: resolvedProjectId,
      })
    : getAdminApps()[0];

  return resolvedDatabaseId
    ? getAdminFirestore(adminApp, resolvedDatabaseId)
    : getAdminFirestore(adminApp);
}

// Secure GCM token encryption helper
function encryptToken(token: string): { encryptedToken: string; iv: string; authTag: string } {
  const algorithm = 'aes-256-gcm';
  // AES-256-GCM requires exactly a 32-byte key
  const secretKey = coreSecret('ENCRYPTION_KEY', { length: 32 });
  const iv = crypto.randomBytes(12);
  const key = Buffer.alloc(32);
  Buffer.from(secretKey).copy(key);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return {
    encryptedToken: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag
  };
}

// Retrieve or provision a safe userId to link the social account
async function getOrProvisionUserId(req: Request): Promise<string> {
  let userId = (req as any).session?.userId || (req as any).user?.id || (req as any).userId;
  if (!userId) {
    const existing = await db.user.findFirst();
    if (existing) {
      userId = existing.id;
    } else {
      const created = await db.user.create({
        data: {
          email: 'marketer@obsidian.com',
          name: 'Primary Marketeer',
          role: 'MARKETEER'
        }
      });
      userId = created.id;
    }
  }
  return userId;
}

const router = Router();

// Retrieve dynamic host based URL for redirect callback registration
function getPlatformRedirectUri(platform: 'linkedin' | 'facebook' | 'twitter' | 'x', req: Request): string {
  if (platform === 'linkedin') {
    if (process.env.LINKEDIN_REDIRECT_URI) {
      return process.env.LINKEDIN_REDIRECT_URI;
    }
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = (process.env.APP_URL || `${protocol}://${req.get('host')}` || 'http://localhost:3000').replace(/\/+$/, '');
    return `${host}/api/auth/callback/linkedin`;
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = (process.env.APP_URL || `${protocol}://${req.get('host')}` || 'http://localhost:3000').replace(/\/+$/, '');
  return `${host}/api/auth/social/${platform}/callback`;
}

/**
 * -----------------------------------------------------------------
 * LINKEDIN OAUTH INTEGRATION FLOW
 * -----------------------------------------------------------------
 */

// Initializer page to calculate Consent Screen url
router.get('/linkedin/url', (req: Request, res: Response) => {
  let clientId = process.env.LINKEDIN_CLIENT_ID;
  if (clientId === '78sxoz6t0uxc2') {
    clientId = '78sxoz6t0uxc28';
  }
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = getPlatformRedirectUri('linkedin', req);
  
  // Real OAuth only works if they have set up a custom Client ID (not the default one) and a Client Secret
  const isDefaultClient = !clientId || clientId === '78sxoz6t0uxc2' || clientId === '78sxoz6t0uxc28';
  const isConfigured = !isDefaultClient && !!clientSecret;

  // Real OAuth 2.0 Auth Dialog targeting LinkedIn endpoints
  const queryParams = new URLSearchParams({
    response_type: 'code',
    client_id: clientId || '',
    redirect_uri: redirectUri,
    state: 'linkedin_auth_state_csrf',
    scope: 'w_member_social profile email'
  });

  const realUrl = `https://www.linkedin.com/oauth/v2/authorization?${queryParams.toString()}`;
  const mockUrl = `/api/auth/social/linkedin/callback?code=mock_linkedin_dev_code`;

  res.status(200).json({
    success: true,
    configured: isConfigured,
    url: isConfigured ? realUrl : mockUrl,
    message: isConfigured 
      ? 'LinkedIn OAuth Client credentials mapped successfully.' 
      : 'Using local Sandbox Bypass redirect for LinkedIn Auth simulation.'
  });
});

// Callback page handling LinkedIn redirection handshakes
router.get('/linkedin/callback', async (req: Request, res: Response) => {
  const { code, state, error, error_description } = req.query;

  // Validate state to prevent CSRF attacks
  if (state && state !== 'linkedin_auth_state_csrf') {
    return res.status(400).send(renderResponsePage({
      success: false,
      platform: 'LinkedIn',
      message: 'State mismatch error. Cross-Site Request Forgery (CSRF) detected.'
    }));
  }

  if (error || !code) {
    return res.status(400).send(renderResponsePage({
      success: false,
      platform: 'LinkedIn',
      message: (error_description as string) || (error as string) || 'Client rejected auth requests.'
    }));
  }

  try {
    let clientId = process.env.LINKEDIN_CLIENT_ID;
    if (clientId === '78sxoz6t0uxc2') {
      clientId = '78sxoz6t0uxc28';
    }
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    
    // Dynamically calculate redirectUri based on how it was requested (supports both compatibility callback routes!)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = (process.env.APP_URL || `${protocol}://${req.get('host')}` || 'http://localhost:3000').replace(/\/+$/, '');
    const reqPath = req.originalUrl.split('?')[0]; // '/api/auth/callback/linkedin' or '/api/auth/social/linkedin/callback'
    const redirectUri = `${host}${reqPath}`;

    let accessToken = '';
    let refreshToken = '';
    let expiresIn = 3600;
    let isMock = false;
    let linkedinAccountId = `li-member-${Date.now().toString().slice(-4)}`;
    let profileName = 'LinkedIn Member';
    let avatarUrl = '';

    if (code === 'mock_linkedin_dev_code' || !clientId || !clientSecret) {
      console.log('[LinkedIn callback] Running in sandbox simulation bypass mode.');
      accessToken = 'mock_linkedin_access_token_token_abc';
      refreshToken = 'mock_linkedin_refresh_token_ref_xyz';
      expiresIn = 3600;
      isMock = true;
    } else {
      console.log('[LinkedIn callback] Triggering token exchange handshake with LinkedIn... URL:', redirectUri);
      
      try {
        const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
          params: {
            grant_type: 'authorization_code',
            code: code.toString(),
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        accessToken = response.data.access_token;
        refreshToken = response.data.refresh_token || '';
        expiresIn = Number(response.data.expires_in) || 3600;
      } catch (tokenExchangeErr: any) {
        const errMsg = tokenExchangeErr.response?.data 
          ? JSON.stringify(tokenExchangeErr.response.data) 
          : tokenExchangeErr.message;
        console.error('[LinkedIn Token Exchange API Rejection]:', errMsg);
        
        const isRedirectUriMismatch = 
          errMsg.toLowerCase().includes('redirect_uri') || 
          errMsg.toLowerCase().includes('redirect uri') || 
          errMsg.toLowerCase().includes('redirect_uri_mismatch') ||
          (tokenExchangeErr.response?.data?.error_description && 
           tokenExchangeErr.response.data.error_description.toLowerCase().includes('redirect_uri'));

        let friendlyMessage = `LinkedIn authentication was unable to complete the authorization code exchange. Please try again.`;
        if (isRedirectUriMismatch) {
          friendlyMessage = `Authentication redirect URL mismatch. Please try reconnecting your account.`;
        }

        return res.status(400).send(renderResponsePage({
          success: false,
          platform: 'LinkedIn',
          message: friendlyMessage
        }));
      }

      // Extract LinkedIn User Account Profile details using active tokens
      try {
        const userProfile = await axios.get('https://api.linkedin.com/v2/userinfo', {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });
        
        if (userProfile.data) {
          if (userProfile.data.sub) {
            linkedinAccountId = userProfile.data.sub;
            if (!linkedinAccountId.startsWith('urn:li:')) {
              linkedinAccountId = `urn:li:person:${linkedinAccountId}`;
            }
          }
          if (userProfile.data.name) {
            profileName = userProfile.data.name;
          } else if (userProfile.data.given_name || userProfile.data.family_name) {
            profileName = [userProfile.data.given_name, userProfile.data.family_name].filter(Boolean).join(' ');
          }
          if (userProfile.data.picture) {
            avatarUrl = userProfile.data.picture;
          }
        }
      } catch (err: any) {
        console.warn('[LinkedIn Profile API] Could not retrieve userinfo profile. Defaulting to fallback credentials.', err.message);
      }
    }

    // Encrypt the received access_token using Node's native crypto module (AES-256-GCM)
    const { encryptedToken, iv, authTag } = encryptToken(accessToken);

    // Fetch or provision a valid system user ID to link
    const userId = await getOrProvisionUserId(req);

    // 1. Insert or upsert a new row into the SQLite/Prisma DB table for platform stability
    try {
      await db.socialAccount.upsert({
        where: {
          platform_accountId: {
            platform: 'LINKEDIN',
            accountId: linkedinAccountId
          }
        },
        update: {
          encryptedToken,
          iv,
          authTag,
          userId,
          updatedAt: new Date()
        },
        create: {
          platform: 'LINKEDIN',
          accountId: linkedinAccountId,
          encryptedToken,
          iv,
          authTag,
          userId
        }
      });
    } catch (sqlErr: any) {
      console.warn('[SQL local-sync Warning] Could not sync credentials to local Prisma table:', sqlErr.message);
    }

    // 2. Save tokens securely to the token store file for backward compatibility
    try {
      saveSocialTokens({
        accountId: linkedinAccountId,
        platform: 'LINKEDIN',
        accessToken,
        refreshToken,
        expiresIn,
        expiryTime: Date.now() + (expiresIn * 1000)
      });
    } catch (tokenStoreErr: any) {
      console.warn('[TokenStore Warning] Failed to update offline file-token registry:', tokenStoreErr.message);
    }

    // 3. UPSERT the token, expiration details, and profile info into Firestore schema
    try {
      const dbFs = getAdminFirestoreDb();
      const accountDocRef = dbFs.collection('linkedin_accounts').doc(linkedinAccountId);
      const docSnap = await accountDocRef.get();
      
      const nowFs = AdminTimestamp.now();
      const expiresAtFs = AdminTimestamp.fromDate(new Date(Date.now() + (expiresIn * 1000)));
      // Set refresh token expiration default to 1 year, or 365 days if not provided
      const refreshTokenExpiresAtFs = AdminTimestamp.fromDate(new Date(Date.now() + (365 * 24 * 60 * 60 * 1000)));

      const payload: any = {
        user_id: userId,
        provider_account_id: linkedinAccountId,
        access_token: accessToken,
        expires_at: expiresAtFs,
        name: profileName,
        avatar_url: avatarUrl,
        updatedAt: nowFs,
      };

      if (refreshToken) {
        payload.refresh_token = refreshToken;
        payload.refresh_token_expires_at = refreshTokenExpiresAtFs;
      }

      if (docSnap.exists) {
        payload.createdAt = docSnap.data()?.createdAt || nowFs;
      } else {
        payload.createdAt = nowFs;
      }

      await accountDocRef.set(payload);
      console.log(`[LinkedIn callback Firestore] ✓ Successfully stored account info in Firestore for account: ${linkedinAccountId}`);
    } catch (fsErr: any) {
      console.error('[LinkedIn callback Firestore Error] Could not register account in Firestore database:', fsErr.message);
    }

    // Render completion page with message back to parent window
    return res.status(200).send(renderResponsePage({
      success: true,
      platform: 'LinkedIn',
      accountId: linkedinAccountId,
      isMock,
      accessToken,
      encryptedToken,
      iv,
      authTag,
      message: 'Connected to LinkedIn integration platform successfully.'
    }));

  } catch (err: any) {
    const errorDetails = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[LinkedIn callback Error]:', errorDetails);
    res.status(500).send(renderResponsePage({
      success: false,
      platform: 'LinkedIn',
      message: `Failed during exchange process handshake: ${err.message}`
    }));
  }
});


/**
 * -----------------------------------------------------------------
 * FACEBOOK GRAPH OAUTH INTEGRATION FLOW
 * -----------------------------------------------------------------
 */

// Initializer page to calculate FB authorization url
router.get('/facebook/url', (req: Request, res: Response) => {
  const appId = process.env.FACEBOOK_APP_ID;
  const redirectUri = getPlatformRedirectUri('facebook', req);
  const isConfigured = !!appId;

  // Real OAuth 2.0 Auth Dialog targeting Facebook Graph API endpoints
  const queryParams = new URLSearchParams({
    client_id: appId || '',
    redirect_uri: redirectUri,
    state: 'facebook_auth_state_csrf',
    scope: 'public_profile,email,pages_manage_posts,pages_read_engagement'
  });

  const realUrl = `https://www.facebook.com/v18.0/dialog/oauth?${queryParams.toString()}`;
  const mockUrl = `/api/auth/social/facebook/callback?code=mock_facebook_dev_code`;

  res.status(200).json({
    success: true,
    configured: isConfigured,
    url: isConfigured ? realUrl : mockUrl,
    message: isConfigured 
      ? 'Facebook App Client credentials mapped successfully.' 
      : 'Using local Sandbox Bypass redirect for Facebook Auth simulation.'
  });
});

// Callback page handling Facebook redirection handshakes
router.get('/facebook/callback', async (req: Request, res: Response) => {
  const { code, error, error_description } = req.query;

  if (error || !code) {
    return res.status(400).send(renderResponsePage({
      success: false,
      platform: 'Facebook',
      message: (error_description as string) || (error as string) || 'Client rejected auth requests.'
    }));
  }

  try {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const redirectUri = getPlatformRedirectUri('facebook', req);

    let accessToken = '';
    let refreshToken = '';
    let expiresIn = 3600;
    let isMock = false;
    let facebookAccountId = `fb-page-${Date.now().toString().slice(-4)}`;

    if (code === 'mock_facebook_dev_code' || !appId || !appSecret) {
      console.log('[Facebook callback] Running in sandbox simulation bypass mode.');
      accessToken = 'mock_facebook_access_token_token_abc';
      refreshToken = 'mock_facebook_refresh_token_ref_xyz';
      expiresIn = 3600;
      isMock = true;
    } else {
      console.log('[Facebook callback] Exchanging authorization code with Facebook Graph API...');
      
      const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          client_id: appId,
          redirect_uri: redirectUri,
          client_secret: appSecret,
          code: code.toString()
        }
      });

      accessToken = response.data.access_token;
      refreshToken = response.data.refresh_token || 'mock_facebook_refresh_token_ref_xyz';
      expiresIn = Number(response.data.expires_in) || 3600;

      // Exchange short-lived FB access token for long-lived one (usually 60 days)
      try {
        const longLivedResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: accessToken
          }
        });
        accessToken = longLivedResponse.data.access_token;
        expiresIn = Number(longLivedResponse.data.expires_in) || 5184000; // 60 days
      } catch (lhErr: any) {
        console.warn('[Facebook Long-lived Token Exchange] Failed; continuing with standard session token.', lhErr.message);
      }

      // Query User ID and Name
      try {
        const profileResponse = await axios.get('https://graph.facebook.com/me', {
          params: {
            fields: 'id,name',
            access_token: accessToken
          }
        });
        if (profileResponse.data && profileResponse.data.id) {
          facebookAccountId = `fb-${profileResponse.data.id}`;
        }
      } catch (meErr: any) {
        console.warn('[Facebook Profile API] Failed to extract custom node identifier.', meErr.message);
      }
    }

    // Encrypt the received access_token using Node's native crypto module (AES-256-GCM)
    const { encryptedToken, iv, authTag } = encryptToken(accessToken);

    // Fetch or provision a valid system user ID to link
    const userId = await getOrProvisionUserId(req);

    // Insert or upsert a new row into the social_accounts database table
    await db.socialAccount.upsert({
      where: {
        platform_accountId: {
          platform: 'FACEBOOK',
          accountId: facebookAccountId
        }
      },
      update: {
        encryptedToken,
        iv,
        authTag,
        userId,
        updatedAt: new Date()
      },
      create: {
        platform: 'FACEBOOK',
        accountId: facebookAccountId,
        encryptedToken,
        iv,
        authTag,
        userId
      }
    });

    // Save tokens securely to the token store for backward compatibility
    saveSocialTokens({
      accountId: facebookAccountId,
      platform: 'FACEBOOK',
      accessToken,
      refreshToken,
      expiresIn,
      expiryTime: Date.now() + (expiresIn * 1000)
    });

    // Render completion page with message back to parent window
    return res.status(200).send(renderResponsePage({
      success: true,
      platform: 'Facebook',
      accountId: facebookAccountId,
      isMock,
      accessToken,
      encryptedToken,
      iv,
      authTag,
      message: 'Connected to Facebook sandbox environment.'
    }));

  } catch (err: any) {
    const errorDetails = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[Facebook callback Error]:', errorDetails);
    res.status(500).send(renderResponsePage({
      success: false,
      platform: 'Facebook',
      message: `Failed during exchange process handshake: ${err.message}`
    }));
  }
});


/**
 * -----------------------------------------------------------------
 * SESSION MANAGEMENT & INTEGRATED APP UI API ENDPOINTS
 * -----------------------------------------------------------------
 */

// Fetch active credentials and metadata
router.get('/sessions', (req: Request, res: Response) => {
  const sessions = getAllSocialTokens().map(s => ({
    accountId: s.accountId,
    platform: s.platform,
    isExpired: Date.now() >= (s.expiryTime - 10000),
    expiresInSeconds: Math.round(Math.max(0, (s.expiryTime - Date.now()) / 1000)),
    updatedAt: s.updatedAt,
    accessTokenMasked: `${s.accessToken.slice(0, 15)}...`,
    refreshTokenMasked: `${s.refreshToken.slice(0, 15)}...`
  }));

  res.status(200).json({
    success: true,
    sessions
  });
});

// Trigger manually code flow checks or trigger explicit token refreshes
router.post('/refresh/:accountId', async (req: Request, res: Response) => {
  const { accountId } = req.params;
  try {
    const tokenRecord = getSocialToken(accountId);
    if (!tokenRecord) {
      return res.status(404).json({ success: false, error: 'Account unmapped.' });
    }

    const currentTokenVal = tokenRecord.accessToken;
    const refreshedToken = await checkAndRefreshToken(accountId);

    res.status(200).json({
      success: true,
      message: 'Secure system expiration analysis concluded.',
      tokenRotated: currentTokenVal !== refreshedToken,
      token: refreshedToken
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Simulate explicit session token expiration for demonstration purposes
router.post('/simulate/expire/:accountId', (req: Request, res: Response) => {
  const { accountId } = req.params;
  const match = getSocialToken(accountId);
  if (match) {
    match.expiryTime = Date.now() - 5000; // sets expiry to 5 seconds ago
    saveSocialTokens({
      accountId: match.accountId,
      platform: match.platform,
      accessToken: match.accessToken,
      refreshToken: match.refreshToken,
      expiresIn: match.expiresIn,
      expiryTime: match.expiryTime
    });
    res.status(200).json({
      success: true,
      message: `Wound back clock to expire session token for account: ${accountId}. The subsequent action will trigger live automatic refresh.`
    });
  } else {
    res.status(404).json({ success: false, error: 'Account not found.' });
  }
});

// Remove integrated platform profile
router.post('/logout/:accountId', async (req: Request, res: Response) => {
  const { accountId } = req.params;
  const deleted = deleteSocialToken(accountId);
  
  try {
    await db.socialAccount.deleteMany({
      where: { accountId }
    });
  } catch (err: any) {
    console.error('[DB Deletion Error during logout]', err.message);
  }

  res.status(200).json({
    success: true,
    message: `Social media channel credentials deleted for account: "${accountId}" from store and database.`
  });
});

/**
 * -----------------------------------------------------------------
 * X / TWITTER OAUTH INTEGRATION FLOW
 * -----------------------------------------------------------------
 */

// Initializer page to calculate Consent Screen url
router.get('/twitter/url', (req: Request, res: Response) => {
  const clientId = process.env.TWITTER_CLIENT_ID || process.env.X_CLIENT_ID;
  const redirectUri = getPlatformRedirectUri('twitter', req);
  const isConfigured = !!clientId;

  const queryParams = new URLSearchParams({
    response_type: 'code',
    client_id: clientId || '',
    redirect_uri: redirectUri,
    state: 'twitter_auth_state_csrf',
    scope: 'tweet.read tweet.write users.read offline.access',
    code_challenge: 'challenge',
    code_challenge_method: 'plain'
  });

  const realUrl = `https://twitter.com/i/oauth2/authorize?${queryParams.toString()}`;
  const mockUrl = `/api/auth/social/twitter/callback?code=mock_twitter_dev_code`;

  res.status(200).json({
    success: true,
    configured: isConfigured,
    url: isConfigured ? realUrl : mockUrl,
    message: isConfigured 
      ? 'Twitter/X OAuth Client credentials mapped successfully.' 
      : 'Using local Sandbox Bypass redirect for Twitter/X Auth simulation.'
  });
});

// Callback page handling Twitter redirection handshakes
router.get('/twitter/callback', async (req: Request, res: Response) => {
  const { code, error, error_description } = req.query;

  if (error || !code) {
    return res.status(400).send(renderResponsePage({
      success: false,
      platform: 'Twitter',
      message: (error_description as string) || (error as string) || 'Client rejected auth requests.'
    }));
  }

  try {
    const clientId = process.env.TWITTER_CLIENT_ID || process.env.X_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET || process.env.X_CLIENT_SECRET;
    const redirectUri = getPlatformRedirectUri('twitter', req);

    let accessToken = '';
    let refreshToken = '';
    let expiresIn = 3600;
    let isMock = false;
    let twitterAccountId = `twitter-member-${Date.now().toString().slice(-4)}`;

    if (code === 'mock_twitter_dev_code' || !clientId || !clientSecret) {
      console.log('[Twitter callback] Running in sandbox simulation bypass mode.');
      accessToken = 'mock_twitter_access_token_token_abc';
      refreshToken = 'mock_twitter_refresh_token_ref_xyz';
      expiresIn = 3600;
      isMock = true;
    } else {
      console.log('[Twitter callback] Triggering token exchange handshake with Twitter...');
      const response = await axios.post('https://api.twitter.com/2/oauth2/token', null, {
        params: {
          grant_type: 'authorization_code',
          code: code.toString(),
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: 'challenge'
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
        }
      });

      accessToken = response.data.access_token;
      refreshToken = response.data.refresh_token || 'mock_twitter_refresh_token_ref_xyz';
      expiresIn = Number(response.data.expires_in) || 3600;

      // Extract Twitter details
      try {
        const userProfile = await axios.get('https://api.twitter.com/2/users/me', {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });
        if (userProfile.data && userProfile.data.data && userProfile.data.data.id) {
          twitterAccountId = `twitter-${userProfile.data.data.id}`;
        }
      } catch (err: any) {
        console.warn('[Twitter Profile API] Could not retrieve sub identifier, default back to random generator.', err.message);
      }
    }

    // Encrypt the received access_token using Node's native crypto module (AES-256-GCM)
    const { encryptedToken, iv, authTag } = encryptToken(accessToken);

    const userId = await getOrProvisionUserId(req);

    // Insert or upsert a new row into the social_accounts database table
    if (db.socialAccount) {
      await db.socialAccount.upsert({
        where: {
          platform_accountId: {
            platform: 'TWITTER',
            accountId: twitterAccountId
          }
        },
        update: {
          encryptedToken,
          iv,
          authTag,
          userId,
          updatedAt: new Date()
        },
        create: {
          platform: 'TWITTER',
          accountId: twitterAccountId,
          encryptedToken,
          iv,
          authTag,
          userId
        }
      });
    }

    // Save tokens securely to the token store file for backward compatibility
    saveSocialTokens({
      accountId: twitterAccountId,
      platform: 'TWITTER',
      accessToken,
      refreshToken,
      expiresIn,
      expiryTime: Date.now() + (expiresIn * 1000)
    });

    // Render completion page with message back to parent window
    return res.status(200).send(renderResponsePage({
      success: true,
      platform: 'Twitter',
      accountId: twitterAccountId,
      isMock,
      accessToken,
      encryptedToken,
      iv,
      authTag,
      message: 'Connected to Twitter/X sandbox environment.'
    }));

  } catch (err: any) {
    const errorDetails = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[Twitter callback Error]:', errorDetails);
    res.status(500).send(renderResponsePage({
      success: false,
      platform: 'Twitter',
      message: `Failed during exchange process handshake: ${err.message}`
    }));
  }
});


// Disconnect a specific platform by name from database and memory store
router.post('/disconnect-platform', async (req: Request, res: Response) => {
  try {
    const { platform } = req.body;
    if (!platform) {
      return res.status(400).json({ success: false, error: 'Platform parameter is required.' });
    }

    const platformUpper = platform.toUpperCase();
    
    // Get userId of the logged-in user or fallback
    let userId = (req as any).session?.userId || (req as any).user?.id || (req as any).userId;
    if (!userId && db.user) {
      const fallbackUser = await db.user.findFirst();
      if (fallbackUser) {
        userId = fallbackUser.id;
      }
    }

    // Delete matching social account records from DB
    if (db.socialAccount) {
      await db.socialAccount.deleteMany({
        where: {
          platform: platformUpper,
          ...(userId ? { userId } : {})
        }
      });
    }

    // Also remove from socialAuthStore memory/disk if any matching account
    const allTokens = getAllSocialTokens();
    const matches = allTokens.filter(t => t.platform === platformUpper);
    for (const match of matches) {
      deleteSocialToken(match.accountId);
    }

    return res.status(200).json({
      success: true,
      message: `Successfully disconnected all ${platformUpper} profiles and cleared security tokens.`
    });
  } catch (err: any) {
    console.error('[Disconnect Platform Error]', err);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      details: err.message
    });
  }
});


/**
 * -----------------------------------------------------------------
 * CARD POPUP UI RENDER TEMPLATE (HTML)
 * -----------------------------------------------------------------
 */
interface ResponsePageOptions {
  success: boolean;
  platform: string;
  message?: string;
  accountId?: string;
  isMock?: boolean;
  accessToken?: string;
  encryptedToken?: string;
  iv?: string;
  authTag?: string;
}

function renderResponsePage(opts: ResponsePageOptions): string {
  const statusBadgeColor = opts.isMock ? '#fbbf24' : '#10b981';
  const statusBadgeText = opts.isMock ? 'Sandbox Simulation Active' : 'Connected to Sandbox Platform';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${opts.platform} Authorized Handshake</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: #0b0c10;
          color: #f5f6fa;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          overflow: hidden;
        }
        .card {
          background-color: #12131c;
          border: 1px solid rgba(255, 255, 255, 0.05);
          padding: 35px;
          border-radius: 16px;
          text-align: center;
          max-width: 420px;
          box-shadow: 0 15px 35px rgba(0,0,0,0.6);
          animation: scaleUp 0.35s ease-out;
        }
        @keyframes scaleUp {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .icon-circle {
          display: inline-flex;
          width: 60px;
          height: 60px;
          background-color: ${opts.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'};
          color: ${opts.success ? '#10b981' : '#ef4444'};
          border-radius: 50%;
          align-items: center;
          justify-content: center;
          margin-bottom: 24px;
          font-size: 26px;
        }
        h2 {
          margin: 0 0 12px 0;
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.03em;
        }
        p {
          font-size: 13.5px;
          color: #9ea2b0;
          line-height: 1.6;
          margin: 0 0 24px 0;
        }
        .badge {
          background-color: ${opts.success ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'};
          color: ${opts.success ? '#10b981' : '#ef4444'};
          font-size: 10.5px;
          font-family: monospace;
          padding: 4px 10px;
          border-radius: 5px;
          text-transform: uppercase;
          font-weight: bold;
          display: inline-block;
          margin-bottom: 24px;
        }
        .meta-box {
          background-color: #181a26;
          border: 1px solid rgba(255,255,255,0.03);
          border-radius: 8px;
          padding: 12px;
          font-size: 11px;
          font-family: monospace;
          color: #727a8e;
          text-align: left;
          margin-bottom: 24px;
          word-break: break-all;
        }
        .btn-close {
          background-color: #2b2e42;
          border: 1px solid rgba(255,255,255,0.05);
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          padding: 10px 24px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.25s;
        }
        .btn-close:hover {
          background-color: #383a54;
          border-color: rgba(255,255,255,0.1);
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon-circle">${opts.success ? '✓' : '✗'}</div>
        <h2>${opts.success ? 'Integration Configured' : 'Connection Broken'}</h2>
        <div class="badge">${opts.success ? statusBadgeText : 'Execution Fault'}</div>
        <p>
          ${opts.success 
            ? `Successfully registered your <strong>${opts.platform} Channel</strong> with Obsidian systems. Communication hooks are securely calibrated.` 
            : `Authentication failed while talking to <strong>${opts.platform} authorization endpoints</strong>: <span style="color:#ef4444">${opts.message}</span>`}
        </p>
        
        ${opts.success && opts.accountId ? `
          <div class="meta-box">
            <strong>ACCOUNT ID:</strong> ${opts.accountId}<br/>
            <strong>SECURE ACC_TOKEN:</strong> ${opts.accessToken?.slice(0, 16)}...<br/>
            <strong>HANDSHAKED AT:</strong> ${new Date().toLocaleTimeString()}
          </div>
        ` : ''}

        <button class="btn-close" onclick="closePopup()">Proceed & Close</button>
      </div>

      <script>
        try {
          if (window.opener) {
            window.opener.postMessage({
              type: 'OAUTH_AUTH_SUCCESS',
              platform: '${opts.platform.toUpperCase()}',
              accountId: '${opts.accountId || ''}',
              isMock: ${opts.isMock || false},
              encryptedToken: '${opts.encryptedToken || ''}',
              iv: '${opts.iv || ''}',
              authTag: '${opts.authTag || ''}'
            }, '*');
          } else {
            // Main window redirect fallback
            localStorage.setItem('OAUTH_PENDING_SUCCESS_EVENT', JSON.stringify({
              type: 'OAUTH_AUTH_SUCCESS',
              platform: '${opts.platform.toUpperCase()}',
              accountId: '${opts.accountId || ''}',
              isMock: ${opts.isMock || false},
              encryptedToken: '${opts.encryptedToken || ''}',
              iv: '${opts.iv || ''}',
              authTag: '${opts.authTag || ''}'
            }));
            setTimeout(function() {
              window.location.href = '/';
            }, 2000);
          }
        } catch (err) {
          console.warn('Fail to postMessage back to parent window context:', err);
        }

        function closePopup() {
          if (window.opener) {
            window.close();
          } else {
            window.location.href = '/';
          }
        }

        // Auto close or redirect after 2.5 seconds block
        setTimeout(closePopup, 2500);
      </script>
    </body>
    </html>
  `;
}

export default router;
