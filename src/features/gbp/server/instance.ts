/** Wiring for the Local SEO feature (server only). */
import { GoogleGenAI } from '@google/genai';
import { config } from '../../social-accounts/server/instance';
import { log } from '../../social-accounts/server/http';
import { createGoogleGateway, GOOGLE_BASES, type GoogleBases } from './googleGateway';
import { createGbpService, type AiDraft } from './service';
import { createGbpStore } from './store';

const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
const redirectUri = process.env.GOOGLE_GBP_REDIRECT_URI?.trim() || (config.appUrl ? `${config.appUrl}/api/local-seo/callback` : '');
const configured = !!(clientId && clientSecret && redirectUri && config.appUrl);
// TODO(owner setup, outside this code): the Local SEO tab only works after all of these exist. Without them it
// shows its setup state (503 not_configured) instead of data:
//   1. Google Cloud project with Business Profile API access APPROVED by Google (request form in the GBP API docs;
//      until approved, calls fail with 403 or a quota of 0).
//   2. APIs enabled in that project: My Business Account Management, My Business Business Information,
//      Business Profile Performance, and Google My Business API v4 (reviews, posts).
//   3. OAuth client (Web) with redirect URI `${APP_URL}/api/local-seo/callback`; consent screen with the
//      `business.manage` scope, which needs Google's verification before non-test users can connect.
//   4. Server env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL, SOCIAL_ACCOUNTS_ENCRYPTION_KEY
//      (optional GOOGLE_GBP_REDIRECT_URI, GEMINI_API_KEY for reply drafts). See docs/local-seo/README.md.

let ai: AiDraft | null = null;
if (process.env.GEMINI_API_KEY) {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GBP_AI_MODEL || 'gemini-2.5-flash';
  ai = async (prompt) => {
    const r: any = await client.models.generateContent({ model, contents: prompt });
    return String(r?.text ?? '');
  };
}

// Test-only: point at a local Google stand-in. Ignored outside NODE_ENV=test.
const bases: GoogleBases = process.env.NODE_ENV === 'test' && process.env.GBP_TEST_BASES ? JSON.parse(process.env.GBP_TEST_BASES) : GOOGLE_BASES;

export const gbpStore = createGbpStore(config.storeMode, config.dataDir);
export const gbp = createGbpService({ cfg: config, google: createGoogleGateway({ clientId, clientSecret, redirectUri }, bases), store: gbpStore, configured, ai, returnPath: config.returnPath });

if (!configured) log.warn('Local SEO: Google OAuth not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL); the tab will show setup instructions.');
if (!ai) log.warn('Local SEO: GEMINI_API_KEY not set; AI drafting disabled (no canned fallbacks).');
