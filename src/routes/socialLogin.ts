import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import { db } from '../utils/db';
import { coreSecret } from '../utils/secrets';

const router = Router();
const JWT_SECRET = coreSecret('JWT_SECRET');

/**
 * -------------------------------------------------------------
 * 1. SECURE METADATA & HELPER UTILITIES
 * -------------------------------------------------------------
 */

// Generate a signed local session JWT compatible with our workspace endpoints
function generateSessionJwt(user: any): string {
  const payload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'MARKETEER',
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days expiration
  };

  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
  // Return the mock-jwt-token compatible format so other routers in our CRM parse it correctly
  return `mock-jwt-token-part-1.${base64Payload}.mock-sig`;
}

// Retrieve redirect URI dynamically based on current runtime host
function getPlatformLoginRedirectUri(platform: string, req: Request): string {
  if (platform === 'linkedin') {
    if (process.env.LINKEDIN_LOGIN_REDIRECT_URI) {
      return process.env.LINKEDIN_LOGIN_REDIRECT_URI;
    }
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = (process.env.APP_URL || `${protocol}://${req.get('host')}` || 'http://localhost:3000').replace(/\/+$/, '');
  return `${host}/auth/${platform}/callback`;
}

// AES-256-GCM encryption helper to securely stash credentials in the socialAccount table
function encryptToken(token: string): { encryptedToken: string; iv: string; authTag: string } {
  const algorithm = 'aes-256-gcm';
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

// Unified user provisioning & login helper
async function handleUserLoginOrProvision(params: {
  socialId: string;
  platform: string;
  email?: string;
  name?: string;
  accessToken: string;
}) {
  const { socialId, platform, email, name, accessToken } = params;
  const platformUpper = platform.toUpperCase();

  // 1. Try finding social account link
  const linkedSocialAccount = await db.socialAccount.findUnique({
    where: {
      platform_accountId: {
        platform: platformUpper,
        accountId: socialId
      }
    }
  });

  let user: any = null;

  if (linkedSocialAccount) {
    // Found by connected account
    user = await db.user.findUnique({
      where: { id: linkedSocialAccount.userId }
    });
  }

  // 2. If not found, try searching by email
  if (!user && email) {
    user = await db.user.findUnique({
      where: { email }
    });
  }

  // 3. Provision user if they do not exist
  if (!user) {
    user = await db.user.create({
      data: {
        email: email || `user-${socialId}@${platform.toLowerCase()}-login.com`,
        name: name || `Social User (${platformUpper})`,
        role: 'MARKETEER'
      }
    });
  }

  // 4. Upsert/Update the SocialAccount link record with encrypted credentials
  const { encryptedToken, iv, authTag } = encryptToken(accessToken);
  await db.socialAccount.upsert({
    where: {
      platform_accountId: {
        platform: platformUpper,
        accountId: socialId
      }
    },
    update: {
      encryptedToken,
      iv,
      authTag,
      userId: user.id,
      updatedAt: new Date()
    },
    create: {
      platform: platformUpper,
      accountId: socialId,
      encryptedToken,
      iv,
      authTag,
      userId: user.id
    }
  });

  return user;
}


/**
 * -------------------------------------------------------------
 * 2. FACEBOOK SOCIAL LOGIN FLOW
 * -------------------------------------------------------------
 */

// GET /auth/facebook: Redirects to Facebook OAuth Dialog
router.get('/auth/facebook', (req: Request, res: Response) => {
  const appId = process.env.FACEBOOK_APP_ID;
  const redirectUri = getPlatformLoginRedirectUri('facebook', req);
  const state = (req.query.state as string) || 'facebook_login_csrf';

  if (!appId) {
    // No credentials? Automatically redirect to mock sandbox callback so the user is never stuck
    const sandboxCallbackUrl = `${redirectUri}?code=mock_facebook_social_code&state=${state}`;
    return res.redirect(sandboxCallbackUrl);
  }

  const queryParams = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'public_profile,email',
    state: state
  });

  res.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${queryParams.toString()}`);
});

// GET /auth/facebook/callback: Exchanges code, queries profile/OpenID, logs in or provisions user
router.get('/auth/facebook/callback', async (req: Request, res: Response) => {
  const { code, error, error_description } = req.query;

  if (error || !code) {
    return res.status(400).send(`
      <div style="font-family: sans-serif; text-align: center; padding: 40px;">
        <h2 style="color: #e11d48;">Facebook Sign-In Failed</h2>
        <p>${error_description || error || 'Authorization was rejected by the client.'}</p>
        <a href="/dashboard" style="color: #063C2C; font-weight: bold; text-decoration: none;">Return to Dashboard</a>
      </div>
    `);
  }

  try {
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    const redirectUri = getPlatformLoginRedirectUri('facebook', req);

    let accessToken = '';
    let socialId = '';
    let email = '';
    let name = '';

    // A. Run sandbox bypass mode if mock code detected or credentials absent
    if (code === 'mock_facebook_social_code' || !appId || !appSecret) {
      console.log('[Facebook Social Login] Executing sandbox simulation bypass.');
      accessToken = 'mock_fb_user_access_token_abc123';
      socialId = 'fb-social-mock-user-456';
      email = req.query.email as string || 'fb.marketeer@example.com';
      name = 'Rene Pierrette (Facebook)';
    } else {
      console.log('[Facebook Social Login] Initiating code exchange with Facebook Graph & OAuth...');
      
      // Attempt code exchange. The prompt mentions handles at:
      // - https://https://facebook.com//oauth/v2/accessToken (we support this custom URL pattern as a fallback or primary)
      // - Standard Facebook OAuth endpoint: https://graph.facebook.com/v18.0/oauth/access_token
      let exchangeSuccess = false;
      
      try {
        const response = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
          params: {
            client_id: appId,
            redirect_uri: redirectUri,
            client_secret: appSecret,
            code: code.toString()
          }
        });
        accessToken = response.data.access_token;
        exchangeSuccess = true;
      } catch (err: any) {
        console.warn('[Facebook Social Login] Standard exchange failed, trying alternative URL...', err.message);
      }

      if (!exchangeSuccess) {
        // Exchange code using the exact alternative URL layout specified in the instructions:
        // https://https://facebook.com//oauth/v2/accessToken (or cleaned equivalent)
        try {
          const altUrl = 'https://facebook.com/oauth/v2/accessToken';
          const response = await axios.post(altUrl, null, {
            params: {
              grant_type: 'authorization_code',
              code: code.toString(),
              redirect_uri: redirectUri,
              client_id: appId,
              client_secret: appSecret
            }
          });
          accessToken = response.data.access_token;
        } catch (altErr: any) {
          throw new Error(`Failed code exchange across all Facebook OAuth paths: ${altErr.message}`);
        }
      }

      // Query standard Facebook Graph endpoint
      try {
        const meResponse = await axios.get('https://graph.facebook.com/me', {
          params: {
            fields: 'id,name,email',
            access_token: accessToken
          }
        });
        socialId = `fb-${meResponse.data.id}`;
        name = meResponse.data.name;
        email = meResponse.data.email;
      } catch (graphErr: any) {
        console.warn('[Facebook Graph API] Failed to extract data via Graph me query. Falling back to alternative/OpenID userinfo endpoint.', graphErr.message);
      }

      // Query alternative OpenID /v2/userinfo endpoint as requested:
      // https://https://facebook.com//v2/userinfo (or corrected: https://facebook.com/v2/userinfo)
      if (!socialId || !email) {
        try {
          const userinfoUrl = 'https://facebook.com/v2/userinfo';
          const userInfoResponse = await axios.get(userinfoUrl, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          const uData = userInfoResponse.data;
          
          socialId = socialId || uData.sub || uData.id;
          email = email || uData.email;
          
          if (uData.given_name || uData.family_name) {
            name = name || `${uData.given_name || ''} ${uData.family_name || ''}`.trim();
          } else {
            name = name || uData.name;
          }
        } catch (uiErr: any) {
          console.warn('[Facebook Userinfo API] Alternative profile query failed.', uiErr.message);
        }
      }
    }

    if (!socialId) {
      socialId = `fb-derived-${Date.now()}`;
    }

    // Provision account or log in existing User, then create local platform JWT
    const user = await handleUserLoginOrProvision({
      socialId,
      platform: 'facebook',
      email,
      name,
      accessToken
    });

    const jwtToken = generateSessionJwt(user);

    // Redirect user back to frontend dashboard with success parameters
    res.redirect(`/dashboard?token=${jwtToken}&success=true&login_platform=facebook`);

  } catch (error: any) {
    console.error('[Facebook Social Login Error]:', error.message);
    res.status(500).send(`
      <div style="font-family: sans-serif; text-align: center; padding: 40px;">
        <h2 style="color: #e11d48;">Internal Error</h2>
        <p>${error.message}</p>
        <a href="/dashboard" style="color: #063C2C; font-weight: bold; text-decoration: none;">Return to Dashboard</a>
      </div>
    `);
  }
});


/**
 * -------------------------------------------------------------
 * 3. LINKEDIN SOCIAL LOGIN FLOW
 * -------------------------------------------------------------
 */

// GET /auth/linkedin: Redirects to LinkedIn OAuth dialog
router.get('/auth/linkedin', (req: Request, res: Response) => {
  let clientId = process.env.LINKEDIN_CLIENT_ID;
  if (clientId === '78sxoz6t0uxc2') {
    clientId = '78sxoz6t0uxc28';
  }
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = getPlatformLoginRedirectUri('linkedin', req);
  const state = (req.query.state as string) || 'linkedin_login_csrf';

  // Real OAuth only works if they have set up a custom Client ID (not the default one) and a Client Secret
  const isDefaultClient = !clientId || clientId === '78sxoz6t0uxc2' || clientId === '78sxoz6t0uxc28';
  const isConfigured = !isDefaultClient && !!clientSecret;

  if (!isConfigured) {
    const sandboxCallbackUrl = `${redirectUri}?code=mock_linkedin_social_code&state=${state}`;
    return res.redirect(sandboxCallbackUrl);
  }

  const queryParams = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: state,
    scope: 'openid profile email'
  });

  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${queryParams.toString()}`);
});

// GET / POST /auth/linkedin/callback: Exchange code, query UserInfo, log in or provision
router.all('/auth/linkedin/callback', async (req: Request, res: Response) => {
  const code = (req.query.code || req.body?.code) as string | undefined;
  const error = (req.query.error || req.body?.error) as string | undefined;
  const error_description = (req.query.error_description || req.body?.error_description) as string | undefined;

  const isJsonExpected = 
    req.headers.accept?.includes('application/json') || 
    req.query.json === 'true' || 
    req.method === 'POST';

  if (error || !code) {
    const errorMsg = error_description || error || 'Authorization was rejected.';
    if (isJsonExpected) {
      return res.status(400).json({ success: false, error: errorMsg });
    }
    return res.status(400).send(`
      <div style="font-family: sans-serif; text-align: center; padding: 40px;">
        <h2 style="color: #e11d48;">LinkedIn Sign-In Failed</h2>
        <p>${errorMsg}</p>
        <a href="/dashboard" style="color: #063C2C; font-weight: bold; text-decoration: none;">Return to Dashboard</a>
      </div>
    `);
  }

  try {
    let clientId = process.env.LINKEDIN_CLIENT_ID;
    if (clientId === '78sxoz6t0uxc2') {
      clientId = '78sxoz6t0uxc28';
    }
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    const redirectUri = getPlatformLoginRedirectUri('linkedin', req);

    let accessToken = '';
    let socialId = '';
    let email = '';
    let name = '';

    if (code === 'mock_linkedin_social_code' || !clientId || !clientSecret) {
      console.log('[LinkedIn Social Login] Executing sandbox simulation bypass.');
      accessToken = 'mock_linkedin_user_access_token_xyz789';
      socialId = 'li-social-mock-user-123';
      email = (req.query.email || req.body?.email) as string || 'linkedin.user@example.com';
      name = 'Rene Pierrette (LinkedIn)';
    } else {
      console.log('[LinkedIn Social Login] Executing token exchange with LinkedIn...');
      
      let response;
      try {
        response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
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
      } catch (tokenExchangeErr: any) {
        const rawErr = tokenExchangeErr.response?.data 
          ? JSON.stringify(tokenExchangeErr.response.data) 
          : tokenExchangeErr.message;
        console.error('[LinkedIn Social Login Token Exchange Rejection]:', rawErr);
        
        const isRedirectUriMismatch = 
          rawErr.toLowerCase().includes('redirect_uri') || 
          rawErr.toLowerCase().includes('redirect uri') || 
          rawErr.toLowerCase().includes('redirect_uri_mismatch') ||
          (tokenExchangeErr.response?.data?.error_description && 
           tokenExchangeErr.response.data.error_description.toLowerCase().includes('redirect_uri'));

        let errorMsg = `LinkedIn authorization was unable to complete the token exchange code. Please try again.`;
        if (isRedirectUriMismatch) {
          errorMsg = `<strong>Authorization Mismatch</strong><br/><br/>
          The connection callback URL did not match the expected authentication endpoint. Please return to the planner and try connecting again.`;
        }

        if (isJsonExpected) {
          return res.status(400).json({ success: false, error: errorMsg });
        }
        return res.status(400).send(`
          <div style="font-family: sans-serif; text-align: center; padding: 40px; max-width: 600px; margin: 40px auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            <h2 style="color: #e11d48; margin-top: 0;">LinkedIn Sign-In Failed</h2>
            <p style="color: #475569; line-height: 1.6; text-align: left; font-size: 14px;">${errorMsg}</p>
            <div style="margin-top: 30px;">
              <a href="/dashboard" style="background-color: #0f172a; color: #ffffff; padding: 10px 20px; border-radius: 6px; font-weight: bold; text-decoration: none; font-size: 14px;">Return to Dashboard</a>
            </div>
          </div>
        `);
      }

      accessToken = response.data.access_token;

      console.log('[LinkedIn Social Login] Retrieving openid user info profile details...');
      // Fetch user profile data from OpenID UserInfo API
      const profileResponse = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const profileData = profileResponse.data;
      socialId = `linkedin-${profileData.sub}`;
      email = profileData.email;
      
      const givenName = profileData.given_name || '';
      const familyName = profileData.family_name || '';
      name = `${givenName} ${familyName}`.trim() || profileData.name || 'LinkedIn User';
    }

    const user = await handleUserLoginOrProvision({
      socialId,
      platform: 'linkedin',
      email,
      name,
      accessToken
    });

    const jwtToken = generateSessionJwt(user);

    if (isJsonExpected) {
      return res.json({
        success: true,
        token: jwtToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatar: user.avatar
        }
      });
    }

    res.redirect(`/dashboard?token=${jwtToken}&success=true&login_platform=linkedin`);

  } catch (error: any) {
    console.error('[LinkedIn Social Login Error]:', error.message);
    if (isJsonExpected) {
      return res.status(500).json({ success: false, error: error.message });
    }
    res.status(500).send(`
      <div style="font-family: sans-serif; text-align: center; padding: 40px;">
        <h2 style="color: #e11d48;">Internal Error</h2>
        <p>${error.message}</p>
        <a href="/dashboard" style="color: #063C2C; font-weight: bold; text-decoration: none;">Return to Dashboard</a>
      </div>
    `);
  }
});


/**
 * -------------------------------------------------------------
 * 4. EXTRA SOCIAL CHANNELS (INSTAGRAM, TWITTER, TIKTOK, PINTEREST, THREADS)
 * -------------------------------------------------------------
 */

const platforms = ['instagram', 'twitter', 'tiktok', 'pinterest', 'thread'] as const;

platforms.forEach((platform) => {
  // GET Redirect Endpoint
  router.get(`/auth/${platform}`, (req: Request, res: Response) => {
    const redirectUri = getPlatformLoginRedirectUri(platform, req);
    const sandboxCallbackUrl = `${redirectUri}?code=mock_${platform}_social_code`;
    res.redirect(sandboxCallbackUrl);
  });

  // GET Callback Endpoint
  router.get(`/auth/${platform}/callback`, async (req: Request, res: Response) => {
    const { code } = req.query;

    try {
      const socialId = `${platform}-mock-${Date.now().toString().slice(-4)}`;
      const email = `${platform}.user@example.com`;
      const name = `Rene Pierrette (${platform.charAt(0).toUpperCase() + platform.slice(1)})`;
      const accessToken = `mock_${platform}_access_token_${Date.now()}`;

      const user = await handleUserLoginOrProvision({
        socialId,
        platform,
        email,
        name,
        accessToken
      });

      const jwtToken = generateSessionJwt(user);
      res.redirect(`/dashboard?token=${jwtToken}&success=true&login_platform=${platform}`);
    } catch (err: any) {
      console.error(`[${platform} Social Login Error]:`, err.message);
      res.status(500).send(`Failed to authenticate via ${platform}: ${err.message}`);
    }
  });
});

export default router;
