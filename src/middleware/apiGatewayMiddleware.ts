import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { coreSecret } from '../utils/secrets';
import { identifyToken } from '../features/social-accounts/server/auth';

// Extend Express Request type to attach authenticated user info
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

// Environment JWT secret with secure default fallback
export const JWT_SECRET = coreSecret('JWT_SECRET');

// Consolidated Response Wrapper Helper Functions
export function apiSuccess<T>(res: Response, data: T, statusCode: number = 200) {
  return res.status(statusCode).json({
    success: true,
    data: data ?? null,
    error: null
  });
}

export function apiError(res: Response, errorMessage: string, statusCode: number = 400) {
  return res.status(statusCode).json({
    success: false,
    data: null,
    error: errorMessage
  });
}

// -----------------------------------------------------------------------------
// 1. RATE LIMITING MIDDLEWARE (Sliding Window in-memory)
// -----------------------------------------------------------------------------
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

/**
 * Unified Rate Limiter Middleware
 * Configurable requests per window (default 100 requests per 15 minutes)
 */
export function rateLimiterMiddleware(options: { windowMs?: number; maxRequests?: number } = {}) {
  const windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
  const maxRequests = options.maxRequests || 100;       // 100 requests default

  return (req: Request, res: Response, next: NextFunction) => {
    const clientKey = req.ip || req.headers['x-forwarded-for'] as string || 'unknown_client';
    const now = Date.now();

    let record = rateLimitStore.get(clientKey);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs
      };
      rateLimitStore.set(clientKey, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, maxRequests - record.count);
    const resetInSeconds = Math.ceil((record.resetTime - now) / 1000);

    // Set standard rate limiting HTTP response headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetInSeconds);

    if (record.count > maxRequests) {
      console.warn(`[Gateway RateLimiter] Rate limit exceeded for IP: ${clientKey}`);
      return apiError(
        res,
        `Rate limit exceeded. Maximum ${maxRequests} requests per ${Math.round(windowMs / 60000)} minutes allowed. Try again in ${resetInSeconds}s.`,
        429
      );
    }

    next();
  };
}

// -----------------------------------------------------------------------------
// 2. JWT AUTHENTICATION MIDDLEWARE
// -----------------------------------------------------------------------------
/**
 * Unified JWT Authentication Middleware
 * Validates incoming Bearer token or x-access-token header before routing to controllers
 */
export async function jwtAuthMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // Accepts: Authorization: Bearer <token> or x-access-token. Tokens in the query string are not
  // accepted (they leak into logs and browser history). There are no bypass/mock tokens.
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : String(req.headers['x-access-token'] || '').trim();
  try {
    const who = await identifyToken(token, String(req.headers['x-dev-user-id'] || ''));
    if (!who) return apiError(res, 'Unauthorized: sign in to continue.', 401);
    const c = who.claims || {};
    req.user = { id: who.id, email: String(c.email || ''), name: String(c.name || 'CRM User'), role: String(c.role || 'AGENT') };
    next();
  } catch (err: any) {
    console.warn(`[Gateway JWT Auth] Authentication failed: ${err?.message}`);
    return apiError(res, 'Unauthorized: invalid or expired session.', 401);
  }
}

/**
 * Helper to generate signed JWT tokens for login/session authentication
 */
export function generateUserJwt(user: { id: string; email: string; name: string; role: string }, expiresIn: string = '24h'): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn } as any
  );
}
