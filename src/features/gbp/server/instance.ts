/** Wiring for the Local SEO feature (server only). */
import { GoogleGenAI } from '@google/genai';
import { config } from '../../social-accounts/server/instance';
import { log } from '../../social-accounts/server/http';
import { createGoogleGateway, GOOGLE_BASES, type GoogleBases } from './googleGateway';
import { createGbpService, type AiDraft } from './service';
import { createGbpStore } from './store';
import { createGrowthService } from './growth';
import { createPlacesClient } from './places';

const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
const redirectUri = process.env.GOOGLE_GBP_REDIRECT_URI?.trim() || (config.appUrl ? `${config.appUrl}/api/local-seo/callback` : '');
const configured = !!(clientId && clientSecret && redirectUri && config.appUrl);

let ai: AiDraft | null = null;
if (process.env.GEMINI_API_KEY) {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const model = process.env.GBP_AI_MODEL || 'gemini-2.5-flash';
  ai = async (prompt) => {
    const r: any = await client.models.generateContent({ model, contents: prompt });
    return String(r?.text ?? '');
  };
}

// Test-only: a fake model injected by tests. Ignored outside NODE_ENV=test.
if (process.env.NODE_ENV === 'test' && typeof (globalThis as any).__gbpTestAi === 'function') ai = (globalThis as any).__gbpTestAi;

// Test-only: point at a local Google stand-in. Ignored outside NODE_ENV=test.
const bases: GoogleBases = process.env.NODE_ENV === 'test' && process.env.GBP_TEST_BASES ? JSON.parse(process.env.GBP_TEST_BASES) : GOOGLE_BASES;

export const gbpStore = createGbpStore(config.storeMode, config.dataDir);
const google = createGoogleGateway({ clientId, clientSecret, redirectUri }, bases);
export const gbp = createGbpService({ cfg: config, google, store: gbpStore, configured, ai, returnPath: config.returnPath });

const placesKey = process.env.GOOGLE_PLACES_API_KEY?.trim() || '';
const placesBase = process.env.NODE_ENV === 'test' && process.env.GBP_TEST_PLACES_BASE ? process.env.GBP_TEST_PLACES_BASE : undefined;
export const growth = createGrowthService({ store: gbpStore, google, core: gbp, ai, places: placesKey ? createPlacesClient(placesKey, placesBase) : null, rankProvider: null });

// Publishes posts the user scheduled, and runs periodic analysis (prepare-only). Off in tests.
if (process.env.NODE_ENV !== 'test' && process.env.GBP_SCHEDULER !== 'off' && configured) {
  const hours = Number(process.env.GBP_AUTOMATION_INTERVAL_HOURS || 6);
  growth.startScheduler({ automationEveryMs: Math.max(1, hours) * 3_600_000 });
}

if (!configured) log.warn('Local SEO: Google OAuth not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL); the tab will show setup instructions.');
if (!ai) log.warn('Local SEO: GEMINI_API_KEY not set; AI drafting disabled (no canned fallbacks).');
if (!placesKey) log.warn('Local SEO: GOOGLE_PLACES_API_KEY not set; competitor lookup is manual only.');
