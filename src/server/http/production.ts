/**
 * Production serving and process lifecycle.
 *
 * serveBuiltApp: the built single-page app from dist/.
 *   - /assets/* are content-hashed by Vite: cached for a year ("immutable"). A missing asset is a 404, not
 *     index.html (an old tab asking for a chunk from a previous deploy used to get HTML with status 200).
 *   - index.html is always revalidated (no-cache), so a new deploy is picked up on the next load.
 *   - Any other non-API GET path gets index.html (client-side navigation).
 *
 * installGracefulShutdown: on SIGTERM/SIGINT (sent by Cloud Run, Kubernetes, Render… on every deploy) stop
 * accepting connections, let in-flight requests finish, then exit; force exit after `timeoutMs`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import express, { type Express } from 'express';
import { logger } from './logger';

const YEAR_SECONDS = 365 * 24 * 3600;

export function serveBuiltApp(app: Express, distPath: string) {
  const indexFile = path.join(distPath, 'index.html');
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    index: false, fallthrough: true, immutable: true, maxAge: YEAR_SECONDS * 1000,
  }));
  app.use('/assets', (_req, res) => { res.status(404).type('text/plain').send('Not found'); });
  app.use(express.static(distPath, {
    index: false,
    setHeaders: (res, file) => { if (path.basename(file) === 'index.html') res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.get('*', (_req, res, next) => {
    if (!fs.existsSync(indexFile)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });
}

export interface ShutdownOptions {
  timeoutMs?: number;
  /** Extra cleanup (e.g. closing Socket.IO) run before the HTTP server closes. */
  beforeClose?: () => Promise<void> | void;
  signals?: NodeJS.Signals[];
  exit?: (code: number) => void;
}

/** Returns the shutdown function (also used by tests). Calling it more than once is a no-op. */
export function installGracefulShutdown(server: http.Server, opts: ShutdownOptions = {}) {
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000);
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let started = false;
  const shutdown = async (signal: string) => {
    if (started) return;
    started = true;
    logger.info('server.shutdown', { signal, timeoutMs });
    const force = setTimeout(() => { logger.warn('server.shutdown_forced', { timeoutMs }); exit(1); }, timeoutMs);
    force.unref?.();
    try { await opts.beforeClose?.(); } catch (e) { logger.warn('server.shutdown_cleanup_failed', { error: (e as Error)?.name || 'error' }); }
    // Keep-alive sockets would hold the server open: close them as soon as they go idle (an in-flight
    // response finishes first), and tell clients still sending requests to close after this one.
    const idle = setInterval(() => server.closeIdleConnections?.(), 100);
    idle.unref?.();
    server.on('request', (_req, res) => { if (!res.headersSent) res.setHeader('Connection', 'close'); });
    server.close((err) => {
      clearTimeout(force); clearInterval(idle);
      if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') { logger.error('server.shutdown_failed', { error: err.name }); exit(1); return; }
      logger.info('server.stopped', {});
      exit(0);
    });
    server.closeIdleConnections?.();
  };
  for (const s of opts.signals ?? (['SIGTERM', 'SIGINT'] as NodeJS.Signals[])) process.once(s, () => { void shutdown(s); });
  return shutdown;
}
