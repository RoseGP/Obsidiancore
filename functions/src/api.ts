/**
 * Protected HTTPS API (Firebase Functions v2): GET /api/v1/health.
 *   Secret: firebase functions:secrets:set MASTER_API_KEY   (see docs/api-key-auth/README.md)
 *   URL:    https://<region>-<project>.cloudfunctions.net/api/api/v1/health
 *           (or /api/v1/health on your domain with a Hosting rewrite: { "source": "/api/**", "function": "api" })
 *
 * Rotation without downtime: create MASTER_API_KEY_PREVIOUS (old value) and MASTER_API_KEY (new value), add
 * MASTER_API_KEY_PREVIOUS to `secrets` below, deploy; once clients switched, remove it again and deploy.
 * (It isn't bound by default because deploys fail when a bound secret doesn't exist.)
 */
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createApiApp } from './app';

const MASTER_API_KEY = defineSecret('MASTER_API_KEY');

// Secrets are read per request (`.value()` only works at runtime, inside the function).
const app = createApiApp(() => [MASTER_API_KEY.value(), process.env.MASTER_API_KEY_PREVIOUS]);

// `secrets` binds the secret to this function only; cors:false = server-to-server (no browser access).
export const api = onRequest({ secrets: [MASTER_API_KEY], cors: false, maxInstances: 10 }, app);
