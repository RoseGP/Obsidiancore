/**
 * HTTP security headers for every response (no extra dependency).
 *
 * - X-Content-Type-Options, Referrer-Policy, Permissions-Policy (camera/mic/screen only for this site,
 *   which GREET meetings need), Cross-Origin-Opener-Policy (allows the Google/Firebase sign-in popup).
 * - X-Frame-Options SAMEORIGIN, except for the embeddable chat widget paths that customer sites frame.
 * - Strict-Transport-Security in production.
 * - Content-Security-Policy in production. It is sent as Report-Only unless CSP_ENFORCE=true, so a
 *   deployment can watch the browser console for violations before turning enforcement on.
 *   It allows: this site; Google Fonts; Firebase/Google sign-in; Stripe Checkout; https/wss
 *   connections (LiveKit servers vary per deployment); data:/blob: images and media.
 * - API responses are never cached (Cache-Control: no-store).
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const EMBEDDABLE = [/^\/api\/(messaging|widget)\/embed(\/|$)/, /^\/widget\.js$/];

export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (m[1].trim()) out.push(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  }
  return out;
}

export function buildCsp(opts: { scriptHashes?: string[]; frameAncestors?: string } = {}): string {
  const d: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...(opts.scriptHashes || []), 'https://apis.google.com', 'https://www.gstatic.com', 'https://js.stripe.com'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'media-src': ["'self'", 'blob:', 'data:', 'https:'],
    'connect-src': ["'self'", 'https:', 'wss:'],
    'frame-src': ["'self'", 'https://*.firebaseapp.com', 'https://accounts.google.com', 'https://js.stripe.com', 'https://checkout.stripe.com'],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", 'https:'],
    'frame-ancestors': [opts.frameAncestors || "'self'"],
  };
  return Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

export function securityHeaders(opts: { production: boolean; scriptHashes?: string[] } = { production: false }) {
  const frameAncestors = (process.env.FRAME_ANCESTORS || '').trim() || undefined;
  const csp = buildCsp({ scriptHashes: opts.scriptHashes, frameAncestors });
  const enforce = process.env.CSP_ENFORCE === 'true';
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(self), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    const embeddable = EMBEDDABLE.some((re) => re.test(req.path));
    if (!embeddable && !frameAncestors) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (opts.production) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      if (!embeddable) res.setHeader(enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', csp);
    }
    res.removeHeader('X-Powered-By');
    next();
  };
}
