/**
 * Example protected Worker: GET /api/v1/health.
 *   Local:  npx wrangler dev -c wrangler.api.toml      (reads MASTER_API_KEY from .dev.vars)
 *   Deploy: npx wrangler deploy -c wrangler.api.toml
 */
import { withApiKey, type AuthEnv } from './authMiddleware';

export default {
  fetch: withApiKey<AuthEnv>(async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/api/v1/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', service: 'obsidian-crm-api', time: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response(JSON.stringify({ error: { code: 'not_found', message: 'No such route.' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }),
};
