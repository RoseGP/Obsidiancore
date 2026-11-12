/**
 * Account lookups and sign-in tokens for passwordless sign-in, backed by Firebase Authentication (the app's
 * existing identity system). A sign-in link ends in a Firebase custom token; the browser exchanges it with
 * signInWithCustomToken, after which every request is authenticated exactly like a password sign-in
 * (Firebase ID token, organization security policy, two-step rules).
 *
 * Needs firebase-admin credentials that can sign tokens: a service account (GOOGLE_APPLICATION_CREDENTIALS)
 * or, on Google Cloud, a runtime service account with the "Service Account Token Creator" role.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfigJson from '../../../firebase-applet-config.json';

export interface AccountRecord { uid: string; disabled: boolean; hasSecondFactor: boolean }

export interface IdentityProvider {
  readonly configured: boolean;
  /** null when no account uses this email. */
  findByEmail(email: string): Promise<AccountRecord | null>;
  getById(uid: string): Promise<AccountRecord | null>;
  /** A short-lived credential the browser exchanges for a normal session. */
  createSignInToken(uid: string): Promise<string>;
}

function projectId(): string | undefined {
  return process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || (firebaseConfigJson as any)?.projectId || undefined;
}

const toRecord = (u: { uid: string; disabled?: boolean; multiFactor?: { enrolledFactors?: unknown[] } }): AccountRecord =>
  ({ uid: u.uid, disabled: !!u.disabled, hasSecondFactor: (u.multiFactor?.enrolledFactors?.length ?? 0) > 0 });

const notFound = (e: unknown) => (e as { code?: string })?.code === 'auth/user-not-found';

function firebaseIdentity(): IdentityProvider {
  const pid = projectId();
  const auth = () => getAuth(getApps()[0] ?? initializeApp({ projectId: pid }));
  return {
    configured: !!pid,
    async findByEmail(email) {
      try { return toRecord(await auth().getUserByEmail(email)); } catch (e) { if (notFound(e)) return null; throw e; }
    },
    async getById(uid) {
      try { return toRecord(await auth().getUser(uid)); } catch (e) { if (notFound(e)) return null; throw e; }
    },
    async createSignInToken(uid) { return auth().createCustomToken(uid, { signInMethod: 'magic_link' }); },
  };
}

let override: IdentityProvider | null = null;
export function setIdentityProviderForTests(p: IdentityProvider | null) { override = p; }
export function getIdentityProvider(): IdentityProvider { return override ?? firebaseIdentity(); }
