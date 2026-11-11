/**
 * Auth headers for the app's own API (/api/accounts, /api/posts, /api/analytics).
 * Sends the Firebase ID token; nothing secret is stored in the browser.
 * X-Dev-User-Id is honoured only by servers running with SOCIAL_ACCOUNTS_DEV_AUTH=true
 * outside production (demo sessions without Firebase).
 */
import axios from 'axios';
import { auth } from './firebase';

/** Sandbox/dev identity of the signed-in user (set by AuthContext). Used only when there's no Firebase token. */
let identityHint: string | undefined = typeof window !== 'undefined' ? (
  (() => {
    try {
      const p = localStorage.getItem('obsidian_auth_user_profile');
      if (p) {
        const parsed = JSON.parse(p);
        if (parsed?.uid) return parsed.uid;
      }
    } catch {}
    return 'exec-director-45';
  })()
) : 'exec-director-45';
export function setApiIdentityHint(uid: string | undefined) { identityHint = uid || 'exec-director-45'; }

export async function getApiAuthHeaders(devUserId?: string): Promise<Record<string, string>> {
  devUserId = devUserId || identityHint;
  const headers: Record<string, string> = {};
  try {
    const token = await (auth as any)?.currentUser?.getIdToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* not signed in with Firebase */ }
  if (!headers.Authorization && devUserId) headers['X-Dev-User-Id'] = devUserId;
  return headers;
}

const PROTECTED = /^\/api\//;
let installed = false;

/** Adds the same headers to axios calls made by older components (e.g. the classic queue panel). */
export function installApiAuthInterceptor(devUserId: () => string | undefined) {
  if (installed) return;
  installed = true;
  axios.interceptors.request.use(async (config) => {
    const url = String(config.url || '');
    if (!PROTECTED.test(url)) return config;
    const extra = await getApiAuthHeaders(devUserId());
    for (const [k, v] of Object.entries(extra)) if (!config.headers?.[k]) (config.headers as any)[k] = v;
    return config;
  });
}


let fetchInstalled = false;
/**
 * Adds the user's credentials to every same-origin /api/ request made with fetch,
 * unless the caller already set Authorization. Install once at startup (main.tsx).
 */
/**
 * When the organization's security policy refuses a request (two-step sign-in required, or the session is
 * older than allowed), tell the app with a window event so it can explain what to do. The response is
 * returned unchanged.
 */
export const SECURITY_POLICY_EVENT = 'obsidian:security-policy';
function watchPolicy(res: Response): Response {
  if (res.status === 401 || res.status === 403) {
    res.clone().json().then((b) => {
      if (b && (b.code === 'mfa_required' || b.code === 'session_expired')) window.dispatchEvent(new CustomEvent(SECURITY_POLICY_EVENT, { detail: { code: b.code, message: b.error } }));
    }).catch(() => undefined);
  }
  return res;
}

export function installGlobalApiAuth() {
  if (fetchInstalled || typeof window === 'undefined') return;
  fetchInstalled = true;

  try {
    if (typeof window.fetch === 'function') {
      const original = window.fetch.bind(window);
      const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        try {
          const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, window.location.href);
          if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
            const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
            if (!headers.has('Authorization') && !headers.has('X-Dev-User-Id')) {
              for (const [k, v] of Object.entries(await getApiAuthHeaders())) headers.set(k, v);
              return watchPolicy(await original(input, { ...init, headers }));
            }
          }
        } catch { /* fall through to the original request */ }
        return original(input, init);
      };

      try {
        Object.defineProperty(window, 'fetch', {
          value: wrappedFetch,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } catch {
        try {
          (window as any).fetch = wrappedFetch;
        } catch (err) {
          console.warn('[apiAuth] Unable to override window.fetch:', err);
        }
      }
    }
  } catch (err) {
    console.warn('[apiAuth] Failed to initialize global fetch interceptor:', err);
  }

  try {
    installApiAuthInterceptor(() => identityHint);
  } catch (err) {
    console.warn('[apiAuth] Failed to initialize axios interceptor:', err);
  }
}

