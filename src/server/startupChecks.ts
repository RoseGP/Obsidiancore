/** Imported by server.ts right after dotenv: lists every missing core secret at once in production. */
import { assertProductionSecrets } from '../utils/secrets';

assertProductionSecrets([
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  ['PAYMENT_ENCRYPTION_SECRET', 'JWT_SECRET'],
  ['OAUTH_STATE_SECRET', 'JWT_SECRET'],
  'CRM_WEBHOOK_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'SOCIAL_ACCOUNTS_ENCRYPTION_KEY',
]);

// Without Google credentials (no GOOGLE_APPLICATION_CREDENTIALS / ADC), the Firestore client rejects
// internal promises nobody can await, and Node exits on the first one. The routes already fall back to
// local stores, so log that case once and keep serving. Every other unhandled rejection still crashes.
const NO_GOOGLE_CREDENTIALS = 'Could not load the default credentials';
let warnedNoCredentials = false;
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes(NO_GOOGLE_CREDENTIALS)) {
    if (!warnedNoCredentials) {
      warnedNoCredentials = true;
      console.warn('[startup] Google credentials not found: Firestore calls will fail and local fallbacks are used.');
    }
    return;
  }
  throw reason;
});
