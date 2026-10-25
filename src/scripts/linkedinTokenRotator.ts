import axios from 'axios';
import * as dotenv from 'dotenv';
import { 
  collection, 
  getDocs, 
  updateDoc, 
  doc, 
  Timestamp 
} from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase-config';
import { LinkedInAccountDocument } from '../types/firebase-schemas';

// Load environment variables from .env file
dotenv.config();

const LINKEDIN_TOKEN_ENDPOINT = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_PROFILE_ENDPOINT = 'https://api.linkedin.com/v2/userinfo';

/**
 * Checks if a given access token is active/valid by querying LinkedIn's lightweight profile endpoint.
 * This is an extra layer of defense in case the token was revoked early before its expiration date.
 * 
 * @param accessToken The access token to verify.
 * @returns Promise<boolean> True if the token is valid, false if revoked or expired.
 */
async function verifyTokenWithLinkedInAPI(accessToken: string): Promise<boolean> {
  try {
    await axios.get(LINKEDIN_PROFILE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return true;
  } catch (error: any) {
    if (error.response && error.response.status === 401) {
      console.warn('  [Active Check] LinkedIn API returned 401 Unauthorized. Token has been revoked or expired.');
      return false;
    }
    // If it is another network/API error, assume token is temporarily unreachable but valid locally
    console.warn('  [Active Check] Non-401 warning during LinkedIn connection check:', error.message);
    return true;
  }
}

/**
 * Executes OAuth 2.0 Refresh Token rotation flow with LinkedIn's token endpoint.
 * 
 * @param refreshToken The current refresh token.
 * @returns Promise with new credentials or null if failed.
 */
async function refreshLinkedInAccessToken(refreshToken: string) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET in environment variables. Cannot rotate token.'
    );
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    console.log('  [OAuth Handshake] Sending refresh_token request to LinkedIn token endpoint...');
    const response = await axios.post(LINKEDIN_TOKEN_ENDPOINT, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const {
      access_token,
      expires_in,
      refresh_token: new_refresh_token,
      refresh_token_expires_in,
    } = response.data;

    if (!access_token) {
      throw new Error('LinkedIn response succeeded but did not contain an access_token.');
    }

    return {
      accessToken: access_token,
      expiresInSeconds: expires_in || 5184000, // Default to 60 days
      newRefreshToken: new_refresh_token || refreshToken, // fallback if not rotated
      refreshTokenExpiresInSeconds: refresh_token_expires_in || 31536000, // Default to 1 year
    };
  } catch (error: any) {
    const errorMsg = error.response?.data ? JSON.stringify(error.response.data) : error.message;
    console.error('  [OAuth Handshake Failed] LinkedIn token refresh error:', errorMsg);
    throw error;
  }
}

/**
 * Scans the Firestore `linkedin_accounts` collection, evaluates token expiration,
 * and seamlessly executes refresh rotations when expired or about to expire.
 */
export async function rotateExpiredLinkedInTokens(): Promise<void> {
  console.log('[LinkedIn Rotator] Starting token rotation evaluation job...');
  
  let db;
  try {
    db = getFirestoreDb();
  } catch (err: any) {
    console.error('[LinkedIn Rotator] Cannot retrieve Firestore database reference:', err.message);
    return;
  }

  const accountsColRef = collection(db, 'linkedin_accounts');
  let snapshot;
  try {
    snapshot = await getDocs(accountsColRef);
  } catch (err: any) {
    console.error('[LinkedIn Rotator] Failed to fetch linkedin_accounts:', err.message);
    return;
  }

  if (snapshot.empty) {
    console.log('[LinkedIn Rotator] No LinkedIn accounts found in the database. Nothing to process.');
    return;
  }

  console.log(`[LinkedIn Rotator] Found ${snapshot.size} account(s) to inspect.`);

  const now = new Date();
  // 5 minute padding buffer to prevent race conditions during scheduled publishings
  const EXPIRATION_BUFFER_MS = 5 * 60 * 1000;

  for (const accountDoc of snapshot.docs) {
    const accountId = accountDoc.id;
    const accountData = accountDoc.data() as LinkedInAccountDocument;

    console.log(`\n[Account: ${accountId}] Inspecting profile for URN: ${accountData.provider_account_id}`);

    const expiresAt = accountData.expires_at.toDate();
    const isExpiredLocally = (expiresAt.getTime() - EXPIRATION_BUFFER_MS) <= now.getTime();

    let needsRotation = isExpiredLocally;

    if (!needsRotation) {
      console.log(`  [Expiry Status] Token is locally valid. Scheduled to expire on: ${expiresAt.toISOString()}`);
      console.log('  [Active Status] Checking live token validity against LinkedIn API...');
      const isLiveTokenValid = await verifyTokenWithLinkedInAPI(accountData.access_token);
      if (!isLiveTokenValid) {
        console.log('  [Active Status] Live token validation failed (401). Forcing rotation.');
        needsRotation = true;
      } else {
        console.log('  [Active Status] Live token check succeeded. Token is fully operational.');
      }
    } else {
      console.log(`  [Expiry Status] Token has expired or is expiring within the 5-minute buffer window (Expired: ${expiresAt.toISOString()})`);
    }

    if (needsRotation) {
      if (!accountData.refresh_token) {
        console.error(`  [Rotation Aborted] No refresh_token was stored for account: ${accountData.provider_account_id}. Manual login required.`);
        continue;
      }

      // If refresh token itself has expired, we can't rotate it
      if (accountData.refresh_token_expires_at) {
        const refreshTokenExpiresAt = accountData.refresh_token_expires_at.toDate();
        if (refreshTokenExpiresAt <= now) {
          console.error(`  [Rotation Aborted] Stored refresh_token has expired on ${refreshTokenExpiresAt.toISOString()}. User must re-authenticate manually.`);
          continue;
        }
      }

      try {
        console.log(`  [Rotation Triggered] Refreshing access token for LinkedIn URN: ${accountData.provider_account_id}...`);
        const rotatedCreds = await refreshLinkedInAccessToken(accountData.refresh_token);

        // Calculate new expiration timestamps
        const newExpiresAtDate = new Date(Date.now() + rotatedCreds.expiresInSeconds * 1000);
        const newRefreshTokenExpiresAtDate = new Date(Date.now() + rotatedCreds.refreshTokenExpiresInSeconds * 1000);

        const updatedDocPayload = {
          access_token: rotatedCreds.accessToken,
          expires_at: Timestamp.fromDate(newExpiresAtDate),
          refresh_token: rotatedCreds.newRefreshToken,
          refresh_token_expires_at: Timestamp.fromDate(newRefreshTokenExpiresAtDate),
          updatedAt: Timestamp.now(),
        };

        const docRef = doc(db, 'linkedin_accounts', accountId);
        await updateDoc(docRef, updatedDocPayload);

        console.log(`  [Rotation Success] ✓ Successfully rotated token in Firestore collection for account ID: ${accountId}`);
        console.log(`  [New Expiry Points] Access Token Exp: ${newExpiresAtDate.toISOString()} | Refresh Token Exp: ${newRefreshTokenExpiresAtDate.toISOString()}`);
      } catch (rotationErr: any) {
        console.error(`  [Rotation Failed] Failed to rotate token for account: ${accountData.provider_account_id}. Details:`, rotationErr.message);
      }
    }
  }

  console.log('\n[LinkedIn Rotator] Evaluated all registered LinkedIn accounts.');
}

// Self-run when executed directly via Node.js / tsx CLI command
if (process.argv[1] && (process.argv[1].endsWith('linkedinTokenRotator.ts') || process.argv[1].endsWith('linkedinTokenRotator.js'))) {
  console.log('[CLI Exec] Initiating LinkedIn Token Rotator script directly from CLI...');
  rotateExpiredLinkedInTokens()
    .then(() => {
      console.log('[CLI Exec] Rotator run completed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[CLI Exec Critical Failure]:', err);
      process.exit(1);
    });
}
