/**
 * Express app for the protected HTTPS function. Kept separate from Firebase wiring so it can be tested
 * without the emulator: createApiApp(() => [key]).
 */
import express = require('express'); // CommonJS build (functions/tsconfig.json has no esModuleInterop)
import { requireApiKey } from './apiAuth';

export function createApiApp(getKeys: () => Array<string | undefined>) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // Everything under /api/v1 needs the master key.
  app.use('/api/v1', requireApiKey(getKeys));

  app.get('/api/v1/health', (_req: express.Request, res: express.Response) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok', service: 'obsidian-crm-api', time: new Date().toISOString() });
  });

  app.use((_req: express.Request, res: express.Response) => res.status(404).json({ error: { code: 'not_found', message: 'No such route.' } }));
  return app;
}
