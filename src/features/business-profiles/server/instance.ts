/** Wiring for the Business Profile Manager (server only). */
import { config } from '../../social-accounts/server/instance';
import { log } from '../../social-accounts/server/http';
import { gbp } from '../../gbp/server/instance';
import { generateAIResponse, providerStatus, resolveProvider } from '../../../services/ai/aiService';
import { createAssistant, type LlmClient } from './assistant';
import { googleBusinessProfileProvider } from './integrations';
import { createBusinessProfilesService } from './service';
import { createProfileStore } from './store';

const SYSTEM = 'You write factual business directory copy. Follow the rules in the user message exactly and reply with JSON only.';

// AI goes through the CRM's shared service (Gemini or Claude, with its own provider fallback).
const status = providerStatus();
const provider = resolveProvider(process.env.BUSINESS_PROFILES_AI_PROVIDER);
const anyConfigured = status.gemini.configured || status.claude.configured;
const llm: LlmClient | null = anyConfigured
  ? async ({ prompt, signal }) => (await generateAIResponse(status[provider].configured ? provider : provider === 'claude' ? 'gemini' : 'claude', prompt, [], { systemPrompt: SYSTEM, useTools: false, signal })).reply
  : null;
const model = status[provider].configured ? status[provider].model : status.gemini.configured ? status.gemini.model : status.claude.model;

export const businessProfiles = createBusinessProfilesService({
  store: createProfileStore(),
  assistant: createAssistant(llm, { model }),
  providers: [googleBusinessProfileProvider(gbp)],
  signingKey: config.stateKey,
});

if (!llm) log.warn('Business profiles: no AI provider configured (GEMINI_API_KEY or ANTHROPIC_API_KEY); AI suggestions disabled.');
