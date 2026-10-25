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
