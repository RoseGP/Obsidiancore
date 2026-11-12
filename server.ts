// Must be the first import: loads .env before any module reads process.env at import time.
import 'dotenv/config';
import './src/server/defaultNodeEnv';
import './src/server/startupChecks';
// Before any router is imported: makes async route handlers forward rejections to the error handler.
import './src/server/http/installAsyncErrors';
import express from 'express';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import { initializeSignalingServer } from './src/utils/signalingServer';

import chatRouter from './src/routes/chat';
import commRouter from './src/routes/communication';
import meetingsRouter from './src/routes/meetings';
import greetRouter, { startRecordingRetentionSweeper } from './src/routes/greetApi';
import meetingNotesRouter from './src/routes/meetingNotes';
import meetingAdminRouter from './src/routes/meetingAdminApi';
import { startMeetingSweeper } from './src/server/meetings/sessions';
import proposalsRouter from './src/routes/proposals';
import availabilityRouter from './src/routes/availability';
import gcalWebhookRouter from './src/routes/gcalWebhook';
import apiV1Router from './src/routes/apiV1Bff';
import { eventsRouter as embedEventsRouter, embedTokensRouter } from './src/routes/embedEventsApi';
import salesIntelRouter from './src/routes/salesIntel';
import messagingPlatformRouter from './src/routes/messagingPlatform';
import paymentIntegrationsRouter from './src/routes/paymentIntegrations';
import paymentWebhooksRouter from './src/routes/paymentWebhooks';
import paymentsRouter, { invoicesRouter } from './src/routes/payments';
import billingRouter from './src/routes/billing';
import accountsApiRouter, { listIntegrations } from './src/routes/accountsApi';
import postsApiRouter from './src/routes/postsApi';
import analyticsApiRouter from './src/routes/analyticsApi';
import localSeoApiRouter from './src/routes/localSeoApi';
import voiceIvrRouter from './src/routes/voiceIvr';
import dashboardApiRouter from './src/routes/dashboardApi';
import leadsApiRouter from './src/routes/leadsApi';
import marketingApiRouter from './src/routes/marketingApi';
import orgsApiRouter from './src/routes/orgsApi';
import accountApiRouter from './src/routes/accountApi';
import leadIntelligenceRouter from './src/routes/leadIntelligenceApi';
import { contactsRouter, companiesRouter } from './src/routes/contactsApi';
import tasksApiRouter from './src/routes/tasksApi';
import securityApiRouter from './src/routes/securityApi';
import adminAuditRouter from './src/routes/adminAuditApi';
import complianceApiRouter from './src/routes/complianceApi';
import reportsApiRouter from './src/routes/reportsApi';
import { securityHeaders, inlineScriptHashes } from './src/server/security/headers';
import { startRetentionSweeper } from './src/server/compliance/retention';
import fs from 'fs';
import { requireUser } from './src/features/social-accounts/server/auth';
import { guard, PUBLIC } from './src/server/routeGuards';
import { isExplicitDevOrTest } from './src/server/runtimeEnv';
import { apiRateLimit, errorHandler, installProcessErrorLogging, notFoundHandler, requestContext, requestLogger } from './src/server/http/middleware';
import { logger } from './src/server/http/logger';
import { installGracefulShutdown, serveBuiltApp } from './src/server/http/production';
import magicLinkRouter from './src/routes/magicLinkApi';
import crmAgentRouter from './src/routes/crmAgentApi';
import webFormsRouter from './src/routes/webFormsApi';

installProcessErrorLogging();

dotenv.config();

const app = express();
// Hosts (Cloud Run, Render, Heroku, Railway) assign the port via PORT.
const PORT = Number(process.env.PORT) || 3000;

// Behind a reverse proxy, TRUST_PROXY (e.g. 1 = one proxy hop) makes req.ip the client's address, which
// rate limits and sign-in monitoring rely on. Leave unset when clients connect directly.
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
app.disable('x-powered-by');
// Request id on every response (X-Request-Id) and one log line per API request.
app.use(requestContext());
app.use(requestLogger());
// Security headers on every response; CSP is report-only unless CSP_ENFORCE=true (see docs/compliance/SECURITY_CONTROLS.md).
const productionMode = !isExplicitDevOrTest();
const builtIndex = path.join(process.cwd(), 'dist', 'index.html');
app.use(securityHeaders({ production: productionMode, scriptHashes: productionMode && fs.existsSync(builtIndex) ? inlineScriptHashes(fs.readFileSync(builtIndex, 'utf8')) : [] }));

// Core Middleware
// CORS: the app's own pages only (APP_URL plus CORS_ALLOWED_ORIGINS). The embeddable calendar API
// (/api/v1/events) sets its own per-key CORS headers, so it's skipped here.
const corsAllowed = new Set([process.env.APP_URL, ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',')].map((o) => (o || '').trim().replace(/\/+$/, '')).filter(Boolean));
const appCors = cors({ origin: (origin, cb) => cb(null, !origin || corsAllowed.has(origin)) });
// Website form submissions (/api/web-forms/f/…) set per-organization CORS themselves (allowed websites).
app.use((req, res, next) => (req.path.startsWith('/api/v1/events') || req.path.startsWith('/api/v1/embed-tokens') || req.path.startsWith('/api/web-forms/f/') ? next() : appCors(req, res, next)));
app.use(express.json({ 
  limit: '10mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Per-IP ceiling for the whole API; routers keep their own stricter limits.
app.use('/api', apiRateLimit());

// Health Check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'OmniChannel CRM Platform',
    timestamp: new Date().toISOString()
  });
});

// Mount Production Messaging & Live Chat Widget API
app.use('/api/messaging', guard(PUBLIC.messaging), messagingPlatformRouter);
app.use('/api/widget', guard(PUBLIC.messaging), messagingPlatformRouter);

// Passwordless sign-in links (public: anyone may ask for a link; responses never reveal whether an account exists).
app.use('/api/auth/magic-link', guard(PUBLIC.magicLink), magicLinkRouter);
// Website forms → CRM: public submissions under /f/:formId, settings and delivery log for signed-in members.
app.use('/api/web-forms', guard(PUBLIC.webForms), webFormsRouter);
// CRM agent: questions answered from the caller's own organization's records (RAG).
app.use('/api/crm-agent', guard(PUBLIC.none), crmAgentRouter);

// Mount CRM API Routes
app.use('/api/chat', guard(PUBLIC.none), chatRouter);
app.use('/api/communication', guard(PUBLIC.communication), commRouter);
app.use('/api/meetings', guard(PUBLIC.none), meetingsRouter);
app.use('/api/greet', guard(PUBLIC.greet), greetRouter);
app.use('/api/meeting-notes', guard(PUBLIC.none), meetingNotesRouter);
app.use('/api/admin/meetings', guard(PUBLIC.none), meetingAdminRouter);
app.use('/api/proposals', guard(PUBLIC.proposals), proposalsRouter);
app.use('/api/payments', guard(PUBLIC.payments), paymentsRouter);
app.use('/api/invoices', guard(PUBLIC.none), invoicesRouter);
// Billing verifies its own session token (and the organization) inside the router.
app.use('/api/billing', billingRouter);
app.use('/api/accounts', guard(PUBLIC.accounts), accountsApiRouter);
app.use('/api/analytics', guard(PUBLIC.none), analyticsApiRouter);
app.use('/api/local-seo', guard(PUBLIC.localSeo), localSeoApiRouter);
app.use('/api/voice', guard(PUBLIC.voice), voiceIvrRouter);
app.use('/api/orgs', guard(PUBLIC.none), orgsApiRouter);
app.use('/api/account', guard(PUBLIC.none), accountApiRouter);
app.use('/api/lead-intelligence', guard(PUBLIC.none), leadIntelligenceRouter);
app.use('/api/security', guard(PUBLIC.none), securityApiRouter);
app.use('/api/admin/audit-log', guard(PUBLIC.none), adminAuditRouter);
app.use('/api/compliance', guard(PUBLIC.none), complianceApiRouter);
app.use('/api/dashboard', guard(PUBLIC.none), dashboardApiRouter);
app.use('/api/reports', guard(PUBLIC.none), reportsApiRouter);
app.use('/api/leads', guard(PUBLIC.leads), leadsApiRouter);
app.use('/api/contacts', guard(PUBLIC.none), contactsRouter);
app.use('/api/companies', guard(PUBLIC.none), companiesRouter);
app.use('/api/tasks', guard(PUBLIC.none), tasksApiRouter);
app.use('/api/marketing', guard(PUBLIC.none), marketingApiRouter);
app.use('/api/v1/marketing', guard(PUBLIC.none), marketingApiRouter);
// New application routes first; remaining legacy paths (/queue, /schedule, /retry, /accounts) require a verified user too.
app.use('/api/posts', guard(PUBLIC.none), postsApiRouter);
app.use('/api/media', guard(PUBLIC.none), postsApiRouter);
app.use('/api/integrations', guard(PUBLIC.paymentIntegrations), paymentIntegrationsRouter);
// Provider webhooks: each handler verifies the provider's signature.
app.use('/api/webhooks', guard(PUBLIC.paymentWebhooks), paymentWebhooksRouter);
// Channel list for pickers (same data as /api/accounts/integrations), before the legacy /api/social router.
app.get('/api/social/integrations', requireUser, listIntegrations as any);
app.use('/api/availability', guard(PUBLIC.availability), availabilityRouter);
app.use('/api/gcal', guard(PUBLIC.gcal), gcalWebhookRouter);
// Embeddable calendar (public, cross-origin): before the /api/v1 gateway router.
app.use('/api/v1/events', embedEventsRouter);
app.use('/api/v1/embed-tokens', embedTokensRouter);
app.use('/api/v1', apiV1Router);
app.use('/api/sales-intelligence', guard(PUBLIC.salesIntel), salesIntelRouter);

// Unknown API paths get a JSON 404 instead of falling through to the single-page app (which answered
// removed routes like /api/postiz/status with index.html and HTTP 200).
app.use('/api', notFoundHandler());
// Last: any error thrown or forwarded by a route becomes a safe JSON response (details only in the server log).
app.use(errorHandler());

// Start Server with Vite Middleware
async function startServer() {
  if (isExplicitDevOrTest()) {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Hashed assets cached for a year, index.html revalidated, missing chunks → 404 (src/server/http/production.ts).
    serveBuiltApp(app, path.join(process.cwd(), 'dist'));
  }

  const httpServer = http.createServer(app);

  // Initialize Unified Real-Time Socket.io Server for Data Synchronization & WebRTC Signaling
  const io = initializeSignalingServer(httpServer);
  // SIGTERM/SIGINT: stop accepting connections, finish in-flight requests, then exit (SHUTDOWN_TIMEOUT_MS, default 10 s).
  installGracefulShutdown(httpServer, { beforeClose: () => { io.disconnectSockets(true); } });

  // Ends meetings whose plan time limit has passed, even if nobody is connected.
  startMeetingSweeper();
  // Data retention: applies only policies an admin set to apply automatically; otherwise records a dry run.
  startRetentionSweeper();
  // Deletes GREET cloud recordings past the organization's retention period.
  startRecordingRetentionSweeper();
  httpServer.listen(PORT, '0.0.0.0', () => {
    logger.info('server.started', { port: PORT, mode: isExplicitDevOrTest() ? 'development' : 'production' });
    console.log(`[OmniChannel CRM Server] Running on http://0.0.0.0:${PORT} (WebSocket + HTTP)`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
