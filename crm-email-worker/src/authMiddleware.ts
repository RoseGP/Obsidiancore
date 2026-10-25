/**
 * Authentication Middleware for Cloudflare Worker REST API
 *
 * Validates inbound requests to protected API endpoints:
 * 1. Checks for 'Bearer <token>' in the Authorization header
 * 2. Checks for custom 'X-API-Key' header as an alternative
 * 3. Validates the extracted token against the environment variable (env.API_KEY)
 *    using a constant-time comparison to prevent timing attacks.
 * 4. Bypasses CORS preflight OPTIONS requests.
 * 5. Returns a structured 401 Unauthorized JSON response if credentials are missing or invalid.
 */

export interface AuthEnv {
  API_KEY?: string;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, Range, X-Requested-With, Accept',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Disposition, ETag',
  'Access-Control-Max-Age': '86400',
};

/**
 * Constant-time string equality check to prevent timing analysis attacks
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  if (aBytes.byteLength !== bBytes.byteLength) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < aBytes.byteLength; i++) {
    mismatch |= aBytes[i] ^ bBytes[i];
  }

  return mismatch === 0;
}

/**
 * Extracts authentication token from either Authorization header (Bearer scheme)
 * or custom X-API-Key header.
 *
 * @param request - Inbound Fetch Request
 * @returns string token or null if not present
 */
export function extractAuthToken(request: Request): string | null {
  // 1. Check Authorization: Bearer <token>
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (authHeader) {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch && bearerMatch[1]) {
      const token = bearerMatch[1].trim();
      if (token.length > 0) return token;
    }
  }

  // 2. Check X-API-Key: <token>
  const apiKeyHeader = request.headers.get('X-API-Key') || request.headers.get('x-api-key');
  if (apiKeyHeader) {
    const token = apiKeyHeader.trim();
    if (token.length > 0) return token;
  }

  return null;
}

/**
 * Creates a standard 401 Unauthorized JSON Response
 *
 * @param message - Descriptive failure message
 * @param customHeaders - Optional additional response headers
 * @returns 401 Response object
 */
export function createUnauthorizedResponse(
  message = 'Unauthorized: Missing or invalid API credentials.',
  customHeaders: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify(
      {
        success: false,
        error: 'Unauthorized',
        message,
        status: 401,
        help: 'Provide a valid Bearer token in the Authorization header (Authorization: Bearer <API_KEY>) or an X-API-Key header (X-API-Key: <API_KEY>).'
      },
      null,
      2
    ),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'WWW-Authenticate': 'Bearer error="invalid_token", error_description="The access token is missing or invalid"',
        ...CORS_HEADERS,
        ...customHeaders
      }
    }
  );
}

/**
 * Validates request authorization against env.API_KEY.
 *
 * - Allows CORS preflight OPTIONS requests automatically.
 * - If request is valid, returns `null` (allowing request to proceed).
 * - If request is invalid or unauthorized, returns a 401 JSON Response.
 *
 * @param request - Inbound Request object
 * @param env - Worker environment bindings containing API_KEY
 * @returns Promise<Response | null> or Response | null
 */
export function validateApiAuth(request: Request, env: AuthEnv): Response | null {
  // Always allow CORS preflight requests
  if (request.method.toUpperCase() === 'OPTIONS') {
    return null;
  }

  const expectedKey = env.API_KEY?.trim();

  // If env.API_KEY is not configured on the Worker environment, block access with 401
  if (!expectedKey) {
    console.error('[Auth Middleware] env.API_KEY is missing or unconfigured on the server.');
    return createUnauthorizedResponse('Unauthorized: Server API Key is not configured.');
  }

  const providedToken = extractAuthToken(request);

  if (!providedToken) {
    return createUnauthorizedResponse('Unauthorized: No authentication credentials provided.');
  }

  // Validate token against expected key using constant-time string comparison
  const isValid = timingSafeEqualStrings(providedToken, expectedKey);

  if (!isValid) {
    return createUnauthorizedResponse('Unauthorized: Invalid API Key or token provided.');
  }

  // Authorized
  return null;
}

/**
 * Higher-order middleware handler to wrap worker fetch endpoints
 *
 * @example
 * ```ts
 * import { withAuth } from './authMiddleware';
 * 
 * export default {
 *   fetch: withAuth(async (request, env, ctx) => {
 *     // Protected handler logic
 *   })
 * };
 * ```
 */
export function withAuth<E extends AuthEnv = AuthEnv>(
  handler: (request: Request, env: E, ctx: any) => Promise<Response> | Response,
  options?: { protectedPrefixes?: string[] }
): (request: Request, env: E, ctx: any) => Promise<Response> {
  const protectedPrefixes = options?.protectedPrefixes || ['/api/'];

  return async (request: Request, env: E, ctx: any): Promise<Response> => {
    // 1. Pass through CORS preflight OPTIONS requests immediately
    if (request.method.toUpperCase() === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // 2. Check if route is protected (matches any protected prefix)
    const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));

    if (isProtected) {
      const authErrorResponse = validateApiAuth(request, env);
      if (authErrorResponse) {
        return authErrorResponse;
      }
    }

    // 3. Delegate to downstream route handler
    return handler(request, env, ctx);
  };
}
