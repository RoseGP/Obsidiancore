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
import { getProposalDetails } from '../utils/proposalsDb';

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

/**
 * GET /api/v1/proposals/:id
 * Unified proposal details fetch endpoint
 */
apiV1Router.get('/proposals/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const proposalId = req.params.id || 'prop_101';
    const proposal = await getProposalDetails(proposalId);
    if (!proposal) {
      return apiError(res, `Proposal with ID '${proposalId}' not found.`, 404);
    }
    return apiSuccess(res, proposal);
  } catch (err: any) {
    return apiError(res, `Failed to fetch proposal details: ${err.message}`, 500);
  }
});

export default apiV1Router;
