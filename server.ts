// Must be the first import: loads .env before any module reads process.env at import time.
import 'dotenv/config';
import './src/server/startupChecks';
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
import proposalsRouter from './src/routes/proposals';
import postsRouter from './src/routes/posts';
import socialPostsRouter from './src/routes/socialPosts';
import socialAuthRouter from './src/routes/socialAuth';
import socialConnectionRouter from './src/routes/socialConnection';
import authRouter from './src/routes/auth';
import availabilityRouter from './src/routes/availability';
import gcalWebhookRouter from './src/routes/gcalWebhook';
import apiV1Router from './src/routes/apiV1Bff';
import salesIntelRouter from './src/routes/salesIntel';
import postizRouter from './src/routes/postiz';
import messagingPlatformRouter from './src/routes/messagingPlatform';
import paymentIntegrationsRouter from './src/routes/paymentIntegrations';
import paymentWebhooksRouter from './src/routes/paymentWebhooks';
import paymentsRouter, { invoicesRouter } from './src/routes/payments';
import socialPlannerApiRouter from './src/routes/socialPlannerApi';
import billingRouter from './src/routes/billing';
import billingStripeRouter from './src/routes/billingStripe';
import accountsApiRouter from './src/routes/accountsApi';
import postsApiRouter from './src/routes/postsApi';
import analyticsApiRouter from './src/routes/analyticsApi';
import localSeoApiRouter from './src/routes/localSeoApi';
import voiceIvrRouter from './src/routes/voiceIvr';
import dashboardApiRouter from './src/routes/dashboardApi';
import leadsApiRouter from './src/routes/leadsApi';
import marketingApiRouter from './src/routes/marketingApi';
import { requireUser } from './src/features/social-accounts/server/auth';
import { guard, PUBLIC } from './src/server/routeGuards';

dotenv.config();

const app = express();
// Hosts (Cloud Run, Render, Heroku, Railway) assign the port via PORT.
const PORT = Number(process.env.PORT) || 3000;

// Core Middleware
app.use(cors());
app.use(express.json({ 
  limit: '10mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Mount CRM API Routes
app.use('/api/chat', guard(PUBLIC.none), chatRouter);
app.use('/api/communication', guard(PUBLIC.communication), commRouter);
app.use('/api/meetings', guard(PUBLIC.none), meetingsRouter);
app.use('/api/proposals', guard(PUBLIC.proposals), proposalsRouter);
app.use('/api/payments', guard(PUBLIC.payments), paymentsRouter);
app.use('/api/invoices', guard(PUBLIC.none), invoicesRouter);
// Stripe Connect OAuth return + webhook: no session (signed state / Stripe signature).
app.use('/api/billing-stripe', billingStripeRouter);
app.use('/api/billing', billingRouter);
app.use('/api/accounts', accountsApiRouter);
app.use('/api/analytics', analyticsApiRouter);
app.use('/api/local-seo', localSeoApiRouter);
app.use('/api/voice', voiceIvrRouter);
app.use('/api/dashboard', dashboardApiRouter);
app.use('/api/leads', leadsApiRouter);
app.use('/api/marketing', marketingApiRouter);
app.use('/api/v1/marketing', marketingApiRouter);
// New application routes first; remaining legacy paths (/queue, /schedule, /retry, /accounts) require a verified user too.
app.use('/api/posts', postsApiRouter);
app.use('/api/media', postsApiRouter);
app.use('/api/posts', requireUser, postsRouter);
app.use('/api/integrations', guard(PUBLIC.paymentIntegrations), paymentIntegrationsRouter);
app.use('/api/webhooks', paymentWebhooksRouter);
app.use('/api/postiz', guard(PUBLIC.postiz), postizRouter);
app.use('/api/social/postiz', guard(PUBLIC.postiz), postizRouter);
app.use('/integrations/postiz', guard(PUBLIC.postiz), postizRouter);
app.use('/api/social-posts', guard(PUBLIC.none), socialPostsRouter);
app.use('/api/social-auth', guard(PUBLIC.socialAuth), socialAuthRouter);
app.use('/api/social-connection', guard(PUBLIC.socialConnection), socialConnectionRouter);
app.use('/api/social', guard(PUBLIC.socialConnection), socialConnectionRouter);
app.use('/api/social-planner', guard(PUBLIC.none), socialPlannerApiRouter);
app.use('/api/auth', guard(PUBLIC.auth), authRouter);
app.use('/api/availability', guard(PUBLIC.availability), availabilityRouter);
app.use('/api/gcal', guard(PUBLIC.gcal), gcalWebhookRouter);
app.use('/api/v1', apiV1Router);
app.use('/api/sales-intelligence', guard(PUBLIC.salesIntel), salesIntelRouter);
// Legacy bare '/api' mount of the payments router (catch-all routes such as GET /:invoiceId).
// Kept LAST so it can't shadow other routers (it previously swallowed /api/posts and would block webhooks).
app.use('/api', guard(PUBLIC.payments), paymentsRouter);

// Start Server with Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);

  // Initialize Unified Real-Time Socket.io Server for Data Synchronization & WebRTC Signaling
  initializeSignalingServer(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[OmniChannel CRM Server] Running on http://0.0.0.0:${PORT} (WebSocket + HTTP)`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
