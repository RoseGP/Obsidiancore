/**
 * Who is calling? Verified on the server for every request.
 *
 * 1. Firebase ID token (what this app's sign-in issues) — verified with
 *    firebase-admin against Google's public keys.
 * 2. HS256 session JWT signed with SOCIAL_ACCOUNTS_JWT_SECRET or JWT_SECRET.
 * 3. Development only (NODE_ENV explicitly 'development' or 'test' AND SOCIAL_ACCOUNTS_DEV_AUTH=true):
 *    the X-Dev-User-Id header, so demo sessions without Firebase can be tested.
 */
import type { NextFunction, Request, Response } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { verifyJwt } from '../../../utils/verifyJwt';
import { devIdentityHeaderAllowed } from '../../../server/runtimeEnv';
import firebaseConfigJson from '../../../../firebase-applet-config.json';

export interface AuthedRequest extends Request {
  accountUser?: { id: string; via: 'firebase' | 'jwt' | 'dev'; email?: string; emailVerified?: boolean; name?: string };
}

function firebaseProjectId(): string | undefined {
  return process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || (firebaseConfigJson as any)?.projectId || undefined;
}

export function looksLikeFirebaseToken(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload?.iss === 'string' && payload.iss.startsWith('https://securetoken.google.com/');
  } catch {
    return false;
  }
}

/** Anonymous Firebase users are not accounts: they can't own organizations or data. */
export function acceptedFirebaseIdentity(decoded: { uid?: string; firebase?: { sign_in_provider?: string } }): boolean {
  return Boolean(decoded?.uid) && decoded.firebase?.sign_in_provider !== 'anonymous';
}

async function verifyFirebaseClaims(token: string): Promise<{ uid: string; email?: string; email_verified?: boolean; name?: string } | null> {
  const projectId = firebaseProjectId();
  if (!projectId) return null;
  try {
    const app = getApps()[0] ?? initializeApp({ projectId });
    const decoded = await getAuth(app).verifyIdToken(token, true);
    return acceptedFirebaseIdentity(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

async function verifyFirebase(token: string): Promise<string | null> {
  return (await verifyFirebaseClaims(token))?.uid ?? null;
}

export async function identify(req: Request): Promise<AuthedRequest['accountUser'] | null> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    if (looksLikeFirebaseToken(token)) {
      const c = await verifyFirebaseClaims(token);
      if (c) return { id: c.uid, via: 'firebase', email: c.email, emailVerified: c.email_verified === true, name: c.name };
    } else {
      const secret = process.env.SOCIAL_ACCOUNTS_JWT_SECRET || process.env.JWT_SECRET;
      if (secret) {
        const p: any = await verifyJwt(token, secret);
        const id = p && String(p.userId ?? p.sub ?? p.uid ?? '');
        // Server-issued session JWTs: an email claim is only trusted as verified if the token says so.
        if (id) return { id, via: 'jwt', email: typeof p.email === 'string' ? p.email : undefined, emailVerified: p.email_verified === true, name: typeof p.name === 'string' ? p.name : undefined };
      }
    }
  }
  if (devIdentityHeaderAllowed()) {
    const rawDev = req.headers['x-dev-user-id'];
    if (typeof rawDev === 'string' && rawDev.trim() && /^[A-Za-z0-9_.@-]{1,128}$/.test(rawDev.trim())) {
      // Development only: X-Dev-User-Email simulates a verified email (e.g. to test invitations).
      const rawEmail = req.headers['x-dev-user-email'];
      const email = typeof rawEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail.trim().toLowerCase() : undefined;
      return { id: rawDev.trim(), via: 'dev', email, emailVerified: !!email };
    }
  }
  return null;
}

export async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = await identify(req);
  if (!user) {
    res.status(401).json({ code: 'unauthorized', error: 'Sign in to manage connected accounts.' });
    return;
  }
  req.accountUser = user;
  next();
}


/**
 * Verifies a raw token (no Express request): Firebase ID token, or an HS256 JWT signed with
 * SOCIAL_ACCOUNTS_JWT_SECRET / JWT_SECRET. `devUserId` is honoured only when
 * SOCIAL_ACCOUNTS_DEV_AUTH=true outside production. There are no bypass tokens.
 */
export async function identifyToken(token: string | undefined, devUserId?: string): Promise<{ id: string; via: string; claims?: any } | null> {
  const t = (token || '').trim();
  if (t) {
    if (looksLikeFirebaseToken(t)) {
      const uid = await verifyFirebase(t);
      if (uid) return { id: uid, via: 'firebase' };
    } else {
      const secret = process.env.SOCIAL_ACCOUNTS_JWT_SECRET || process.env.JWT_SECRET;
      if (secret) {
        const p: any = await verifyJwt(t, secret);
        const id = p && String(p.userId ?? p.sub ?? p.uid ?? p.id ?? '');
        if (id) return { id, via: 'jwt', claims: p };
      }
    }
  }
  if (devIdentityHeaderAllowed()) {
    if (typeof devUserId === 'string' && devUserId.trim() && /^[A-Za-z0-9_.@-]{1,128}$/.test(devUserId.trim())) {
      return { id: devUserId.trim(), via: 'dev' };
    }
  }
  return null;
}
