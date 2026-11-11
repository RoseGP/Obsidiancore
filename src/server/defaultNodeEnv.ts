/**
 * Imported by server.ts right after dotenv, before anything reads NODE_ENV.
 * An unset NODE_ENV means production. Otherwise Vite's dev server would start and set
 * NODE_ENV=development itself, silently enabling development-only paths on a live deployment.
 * Local development sets NODE_ENV=development explicitly (npm run dev).
 */
if (!process.env.NODE_ENV || !process.env.NODE_ENV.trim()) {
  process.env.NODE_ENV = 'production';
  console.warn('[env] NODE_ENV was not set; defaulting to production. Use `npm run dev` for local development.');
}
export {};
