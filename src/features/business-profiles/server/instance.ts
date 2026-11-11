/** Wiring for the Business Profile Manager (server only). */
import { GoogleGenAI } from '@google/genai';
import { config } from '../../social-accounts/server/instance';
import { log } from '../../social-accounts/server/http';
import { gbp } from '../../gbp/server/instance';
import { createAssistant, type LlmClient } from './assistant';
import { googleBusinessProfileProvider } from './integrations';
import { createBusinessProfilesService } from './service';
import { createProfileStore } from './store';

const model = process.env.BUSINESS_PROFILES_AI_MODEL || process.env.GBP_AI_MODEL || 'gemini-2.5-flash';
let llm: LlmClient | null = null;
if (process.env.GEMINI_API_KEY) {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  llm = async ({ prompt, signal }) => {
    const r: any = await client.models.generateContent({ model, contents: prompt, config: { abortSignal: signal, responseMimeType: 'application/json', temperature: 0.4 } });
    return String(r?.text ?? '');
  };
}

export const businessProfiles = createBusinessProfilesService({
  store: createProfileStore(config.storeMode, config.dataDir),
  assistant: createAssistant(llm, { model }),
  providers: [googleBusinessProfileProvider(gbp)],
  signingKey: config.stateKey,
});

if (!llm) log.warn('Business profiles: GEMINI_API_KEY not set; AI suggestions disabled (audits and editing still work).');
