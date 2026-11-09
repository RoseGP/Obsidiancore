import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { DateTime } from 'luxon';
import { 
  AuthenticatedRequest, 
  rateLimiterMiddleware, 
  jwtAuthMiddleware, 
  apiSuccess, 
  apiError,

  JWT_SECRET
} from '../middleware/apiGatewayMiddleware';

const apiV1Router = Router();

// Apply unified Rate Limiter to all /api/v1 endpoints (100 reqs per 15 mins)
apiV1Router.use(rateLimiterMiddleware({ windowMs: 15 * 60 * 1000, maxRequests: 100 }));

// -----------------------------------------------------------------------------
// PUBLIC GATEWAY ENDPOINTS (Bypass Auth)
// -----------------------------------------------------------------------------

/**
 * GET /api/v1/health
 * Gateway status and subsystem health report
 */
apiV1Router.get('/health', (req, res) => {
  return apiSuccess(res, {
    gateway: 'Unified API Gateway / BFF (v1)',
    status: 'ONLINE',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    subsystems: {
      auth: 'JWT_ENABLED',
      rateLimiter: 'ACTIVE',
      webrtcSignaling: 'ONLINE',
      database: 'CONNECTED'
    }
  });
});

/**
 * POST /api/v1/auth/login: REMOVED.
 * It issued a signed ADMIN token for any email without checking a password. Clients sign in with
 * Firebase and send that ID token as `Authorization: Bearer <token>`; the gateway verifies it.
 */
apiV1Router.post('/auth/login', (_req, res) => apiError(res, 'This endpoint has been removed. Sign in through the app and send your session token.', 410));

// -----------------------------------------------------------------------------
// SECURED GATEWAY ENDPOINTS (Protected by Unified JWT Auth Middleware)
// -----------------------------------------------------------------------------
apiV1Router.use(jwtAuthMiddleware as any);

/**
 * GET /api/v1/me
 * Returns current authenticated user profile extracted by Gateway middleware
 */
apiV1Router.get('/me', (req: AuthenticatedRequest, res: Response) => {
  return apiSuccess(res, { user: req.user });
});

/**
 * /api/v1/meetings: moved. Meetings are scheduled and run through /api/meetings, which applies the
 * organizer's subscription limits (duration, participants, recurring series) on the server.
 */
apiV1Router.all(['/meetings', '/meetings/*'], (_req, res) => apiError(res, 'Meetings moved to /api/meetings (scheduling: POST /api/meetings/create).', 410));

/** /api/v1/proposals: moved to /api/proposals (organization-scoped, shared by secure link). */
apiV1Router.all(['/proposals', '/proposals/*'], (_req, res) => apiError(res, 'Proposals moved to /api/proposals.', 410));

export default apiV1Router;
