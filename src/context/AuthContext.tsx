import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { 
  User, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut as firebaseSignOut, 
  onAuthStateChanged,
  OAuthProvider,
  TwitterAuthProvider,
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  getMultiFactorResolver,
  TotpMultiFactorGenerator,
  type MultiFactorResolver,
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  serverTimestamp, 
  onSnapshot 
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile } from '../types';
import { setApiIdentityHint } from '../lib/apiAuth';

/**
 * Sandbox personas (e.g. "Rene Pierrette") give instant access without an account. They're for
 * local development and staging previews only: enabled in Vite dev builds, or when the build sets
 * VITE_ENABLE_SANDBOX_LOGIN=true. Production builds never show them, and the server rejects their
 * dev identity unless SOCIAL_ACCOUNTS_DEV_AUTH=true (which is ignored when NODE_ENV=production).
 */
export const SANDBOX_LOGIN_ENABLED: boolean = !!((import.meta as any).env?.DEV || (import.meta as any).env?.VITE_ENABLE_SANDBOX_LOGIN === 'true');

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operation: OperationType;
  path: string | null;
  authInfo: {
    userId: string | null;
    email: string | null;
    isAnonymous: boolean;
  };
}

export function handleFirestoreError(
  error: unknown,
  operation: OperationType,
  path: string | null
): never {
  const err = error as { code?: string; message?: string };
  const errorInfo: FirestoreErrorInfo = {
    error: err?.message || 'Unknown Firestore error occurred',
    operation,
    path,
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      isAnonymous: auth?.currentUser?.isAnonymous || false,
    },
  };
  console.error('[Firestore Error Caught]', JSON.stringify(errorInfo, null, 2));
  throw new Error(`Firestore Error [${operation} on ${path || 'unknown'}]: ${err?.message || 'Access denied or network failure'}`);
}

export interface UserSession {
  id: string;
  device: string;
  browser: string;
  ip: string;
  location: string;
  lastActive: string;
  isCurrent: boolean;
  signedInAt: string;
}

export interface SessionSettings {
  autoLockMinutes: number; // 0 = disabled, 15, 30, 60
  rememberMe: boolean;
  terminalPin: string;
}

export type Permission = 
  | 'view:dashboard'
  | 'view:deals'
  | 'view:messages'
  | 'view:calendar'
  | 'view:proposals'
  | 'view:social_planner'
  | 'view:gbp'
  | 'view:voice_dialer'
  | 'view:call_canvas'
  | 'view:analytics'
  | 'view:settings'
  | 'manage:users'
  | 'manage:billing'
  | 'manage:integrations'
  | 'export:data'
  | 'delete:records';

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  'Executive Director': [
    'view:dashboard', 'view:deals', 'view:messages', 'view:calendar',
    'view:proposals', 'view:social_planner', 'view:gbp', 'view:voice_dialer',
    'view:call_canvas', 'view:analytics', 'view:settings', 'manage:users',
    'manage:billing', 'manage:integrations', 'export:data', 'delete:records'
  ],
  'Class-5 Executive': [
    'view:dashboard', 'view:deals', 'view:messages', 'view:calendar',
    'view:proposals', 'view:social_planner', 'view:gbp', 'view:voice_dialer',
    'view:call_canvas', 'view:analytics', 'view:settings', 'manage:users',
    'manage:billing', 'manage:integrations', 'export:data', 'delete:records'
  ],
  'VP of Enterprise Sales': [
    'view:dashboard', 'view:deals', 'view:messages', 'view:calendar',
    'view:proposals', 'view:voice_dialer', 'view:call_canvas', 'view:analytics',
    'export:data'
  ],
  'Customer Success Lead': [
    'view:dashboard', 'view:messages', 'view:calendar', 'view:voice_dialer',
    'view:call_canvas', 'view:analytics'
  ],
  'Growth & Marketing Director': [
    'view:dashboard', 'view:deals', 'view:messages', 'view:social_planner',
    'view:gbp', 'view:analytics'
  ],
  'Solutions Architect': [
    'view:dashboard', 'view:voice_dialer', 'view:call_canvas', 'view:analytics',
    'view:settings', 'manage:integrations'
  ]
};

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile;
  isAuthenticated: boolean;
  isDemoSession: boolean;
  isSessionLocked: boolean;
  isLoading: boolean;
  authError: string | null;
  sessionSettings: SessionSettings;
  activeSessions: UserSession[];
  currentSession: UserSession;
  
  // Auth Actions
  loginWithEmail: (email: string, password: string, rememberMe?: boolean) => Promise<unknown>;
  signUpWithEmail: (email: string, password: string, displayName: string, company?: string, role?: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginAsDemo: (role?: string, name?: string, email?: string) => void;
  loginWithSocial: (platform: string) => Promise<void>;
  loginWithEnterpriseSSO: (email: string, code?: string) => Promise<void>;
  logout: () => Promise<void>;

  // Two-step sign-in: set when the password/Google step succeeded and a code is still needed.
  mfaPending: { factor: 'totp' | 'unsupported'; hint: string } | null;
  completeMfaSignIn: (code: string) => Promise<void>;
  cancelMfaSignIn: () => void;

  // Role-Based Authorization
  hasPermission: (permission: Permission) => boolean;
  userPermissions: Permission[];
  switchRole: (role: string) => void;

  // Session Management
  lockSession: () => void;
  unlockSession: (password?: string) => Promise<boolean>;
  updateSessionSettings: (settings: Partial<SessionSettings>) => void;
  terminateSession: (sessionId: string) => void;
  terminateAllOtherSessions: () => void;
  setPresence: (presence: 'online' | 'busy' | 'away') => Promise<void>;
  updateProfileDetails: (details: Partial<UserProfile>) => Promise<void>;
  clearAuthError: () => void;
}

/** Signed-out placeholder. Real values come from the signed-in account; nothing is invented. */
const DEFAULT_PROFILE: UserProfile = {
  uid: '',
  displayName: '',
  email: '',
  photoURL: '',
  role: 'Executive Director', // client-side menu permissions only; the server enforces organization roles
  company: '',
  presence: 'online',
  isAnonymous: false,
};

const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  autoLockMinutes: 30,
  rememberMe: true,
  terminalPin: '',
};

function getClientBrowserInfo(): { browser: string; device: string } {
  if (typeof navigator === 'undefined') {
    return { browser: 'Chrome 128', device: 'Desktop Workstation' };
  }
  const ua = navigator.userAgent;
  let browser = 'Chrome';
  if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Edg')) browser = 'Edge';

  let device = 'Macintosh';
  if (ua.includes('Windows')) device = 'Windows Workstation';
  else if (ua.includes('iPhone')) device = 'iPhone';
  else if (ua.includes('Android')) device = 'Android Mobile';
  else if (ua.includes('Linux')) device = 'Linux Machine';

  return { browser, device };
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isDemoSession, setIsDemoSession] = useState<boolean>(() => {
    // A stored flag can only restore a sandbox session where sandbox sign-in is enabled.
    return SANDBOX_LOGIN_ENABLED && localStorage.getItem('obsidian_auth_is_demo') === 'true';
  });
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem('obsidian_auth_user_profile');
      return saved ? JSON.parse(saved) : DEFAULT_PROFILE;
    } catch {
      return DEFAULT_PROFILE;
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSessionLocked, setIsSessionLocked] = useState<boolean>(() => {
    return sessionStorage.getItem('obsidian_session_locked') === 'true';
  });

  const [sessionSettings, setSessionSettings] = useState<SessionSettings>(() => {
    try {
      const saved = localStorage.getItem('obsidian_session_settings');
      return saved ? { ...DEFAULT_SESSION_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SESSION_SETTINGS;
    } catch {
      return DEFAULT_SESSION_SETTINGS;
    }
  });

  // Client device metadata
  const clientInfo = useRef(getClientBrowserInfo());

  // Active sessions collection
  // Only this device is known in the browser (no invented devices, IPs or locations).
  // To sign out everywhere, Settings → Security calls the server, which revokes the account's sessions.
  const [activeSessions, setActiveSessions] = useState<UserSession[]>(() => [{
    id: 'this-device',
    device: clientInfo.current.device,
    browser: clientInfo.current.browser,
    ip: '',
    location: '',
    lastActive: 'Now',
    isCurrent: true,
    signedInAt: new Date().toLocaleString(),
  }]);

  const currentSession = activeSessions.find(s => s.isCurrent) || activeSessions[0];

  // Inactivity tracking
  const lastActivityRef = useRef<number>(Date.now());
  const mfaResolverRef = useRef<MultiFactorResolver | null>(null);
  const [mfaPending, setMfaPending] = useState<{ factor: 'totp' | 'unsupported'; hint: string } | null>(null);

  /** Firebase asked for a second factor: keep the resolver and ask the person for their code. */
  const beginMfa = (err: any): boolean => {
    if (err?.code !== 'auth/multi-factor-auth-required' || !auth) return false;
    const resolver = getMultiFactorResolver(auth, err);
    mfaResolverRef.current = resolver;
    const totp = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    setMfaPending(totp ? { factor: 'totp', hint: totp.displayName || 'Authenticator app' } : { factor: 'unsupported', hint: resolver.hints[0]?.displayName || resolver.hints[0]?.factorId || '' });
    return true;
  };

  const completeMfaSignIn = async (code: string) => {
    const resolver = mfaResolverRef.current;
    if (!resolver) throw new Error('Start signing in again.');
    const totp = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);
    if (!totp) throw new Error('This account uses a kind of second step this app can’t ask for yet. Contact your administrator.');
    try {
      await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(totp.uid, code.replace(/\s+/g, '')));
      mfaResolverRef.current = null;
      setMfaPending(null);
      setIsDemoSession(false);
      setIsSessionLocked(false);
      lastActivityRef.current = Date.now();
    } catch (err: any) {
      if (err?.code === 'auth/invalid-verification-code' || err?.code === 'auth/invalid-credential') throw new Error('That code didn’t work. Check the time on your phone and try the newest code.');
      if (err?.code === 'auth/too-many-requests') throw new Error('Too many attempts. Wait a few minutes and try again.');
      throw new Error('The code couldn’t be checked. Try again.');
    }
  };
  const cancelMfaSignIn = () => { mfaResolverRef.current = null; setMfaPending(null); };

  // Sync profile & settings changes to storage
  useEffect(() => {
    localStorage.setItem('obsidian_auth_user_profile', JSON.stringify(userProfile));
  }, [userProfile]);

  useEffect(() => {
    localStorage.setItem('obsidian_session_settings', JSON.stringify(sessionSettings));
  }, [sessionSettings]);

  useEffect(() => {
    try { localStorage.removeItem('obsidian_active_sessions'); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    localStorage.setItem('obsidian_auth_is_demo', isDemoSession ? 'true' : 'false');
  }, [isDemoSession]);

  useEffect(() => {
    sessionStorage.setItem('obsidian_session_locked', isSessionLocked ? 'true' : 'false');
  }, [isSessionLocked]);

  // Inactivity Auto-Lock Monitor
  useEffect(() => {
    if (!sessionSettings.autoLockMinutes || sessionSettings.autoLockMinutes <= 0) {
      return;
    }

    const checkInterval = setInterval(() => {
      if (isSessionLocked) return;
      const idleTimeMs = Date.now() - lastActivityRef.current;
      const limitMs = sessionSettings.autoLockMinutes * 60 * 1000;
      if (idleTimeMs >= limitMs) {
        setIsSessionLocked(true);
      }
    }, 15000);

    const recordActivity = () => {
      lastActivityRef.current = Date.now();
    };

    window.addEventListener('mousemove', recordActivity, { passive: true });
    window.addEventListener('keydown', recordActivity, { passive: true });
    window.addEventListener('click', recordActivity, { passive: true });
    window.addEventListener('touchstart', recordActivity, { passive: true });

    return () => {
      clearInterval(checkInterval);
      window.removeEventListener('mousemove', recordActivity);
      window.removeEventListener('keydown', recordActivity);
      window.removeEventListener('click', recordActivity);
      window.removeEventListener('touchstart', recordActivity);
    };
  }, [sessionSettings.autoLockMinutes, isSessionLocked]);

  // Listen to Firebase Auth state
  useEffect(() => {
    if (!auth) {
      setIsLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthError(null);

      if (currentUser) {
        setIsDemoSession(false);
        const uid = currentUser.uid;
        const email = currentUser.email || '';
        const displayName = currentUser.displayName || currentUser.email?.split('@')[0] || 'Team member';
        const photoURL = currentUser.photoURL || '';

        // Check or create Firestore document in users/{uid}
        if (db) {
          try {
            const userDocRef = doc(db, 'users', uid);
            const docSnap = await getDoc(userDocRef);

            if (!docSnap.exists()) {
              // Create new user profile document strictly matching firestore.rules
              await setDoc(userDocRef, {
                uid,
                email,
                displayName,
                photoURL,
                presence: 'online',
                role: 'Executive Director',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });

              setUserProfile({
                uid,
                email,
                displayName,
                photoURL,
                role: 'Executive Director',
                presence: 'online',
                isAnonymous: currentUser.isAnonymous,
              });
            } else {
              const data = docSnap.data();
              setUserProfile({
                uid,
                email: data.email || email,
                displayName: data.displayName || displayName,
                photoURL: data.photoURL || photoURL,
                role: data.role || 'Executive Director',
                presence: (data.presence as 'online' | 'busy' | 'away') || 'online',
                isAnonymous: currentUser.isAnonymous,
              });

              // Touch updatedAt timestamp
              try {
                await updateDoc(userDocRef, {
                  updatedAt: serverTimestamp(),
                });
              } catch {
                // Non-fatal if rule restriction or offline
              }
            }

            // Real-time listener for user profile updates
            const unsubDoc = onSnapshot(userDocRef, (snapshot) => {
              if (snapshot.exists()) {
                const liveData = snapshot.data();
                setUserProfile(prev => ({
                  ...prev,
                  displayName: liveData.displayName || prev.displayName,
                  photoURL: liveData.photoURL || prev.photoURL,
                  presence: liveData.presence || prev.presence,
                  role: liveData.role || prev.role,
                }));
              }
            });

            setIsLoading(false);
            return () => unsubDoc();
          } catch (err) {
            console.warn('[Firestore User Sync] Profile synchronization warning:', err);
            setUserProfile(prev => ({
              ...prev,
              uid,
              email,
              displayName,
              photoURL,
              isAnonymous: currentUser.isAnonymous,
            }));
          }
        } else {
          setUserProfile(prev => ({
            ...prev,
            uid,
            email,
            displayName,
            photoURL,
            isAnonymous: currentUser.isAnonymous,
          }));
        }
      } else {
        // If not in demo mode and no Firebase user, fallback to unauthenticated or demo
        if (!isDemoSession) {
          // Keep current profile if already set, but isAuthenticated will reflect status
        }
      }

      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [isDemoSession]);

  // 1. Email & Password Sign In
  const loginWithEmail = async (email: string, password: string, rememberMe: boolean = true) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      if (!auth) throw new Error('Firebase Authentication is not initialized.');
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      setIsDemoSession(false);
      setIsSessionLocked(false);
      lastActivityRef.current = Date.now();

      // Update session settings
      setSessionSettings(prev => ({ ...prev, rememberMe }));

      setActiveSessions([{ id: 'this-device', device: clientInfo.current.device, browser: clientInfo.current.browser, ip: '', location: '', lastActive: 'Now', isCurrent: true, signedInAt: new Date().toLocaleString() }]);

      return userCredential.user;
    } catch (err: any) {
      if (beginMfa(err)) {
        const e: any = new Error('Enter the 6-digit code from your authenticator app.');
        e.code = 'mfa_required';
        throw e;
      }
      console.error('[Firebase Auth Login Error]', err);
      let message = 'Failed to sign in. Please verify your email and password.';
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        message = 'Invalid email or password. Please verify your credentials or sign up.';
      } else if (err.code === 'auth/too-many-requests') {
        message = 'Access temporarily disabled due to many failed attempts. Please reset password or try again later.';
      } else if (err.code === 'auth/invalid-email') {
        message = 'The email address is improperly formatted.';
      } else if (err.message) {
        message = err.message;
      }
      setAuthError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Email & Password Sign Up
  const signUpWithEmail = async (
    email: string, 
    password: string, 
    displayName: string, 
    company?: string, 
    role?: string
  ) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      if (!auth) throw new Error('Firebase Authentication is not initialized.');
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const newUser = userCredential.user;

      // Update user profile in Firebase Auth
      await updateProfile(newUser, { displayName: displayName.trim() });

      // Synchronize to Firestore
      if (db) {
        try {
          const userDocRef = doc(db, 'users', newUser.uid);
          await setDoc(userDocRef, {
            uid: newUser.uid,
            email: newUser.email,
            displayName: displayName.trim(),
            photoURL: '',
            role: role || 'Executive Director',
            presence: 'online',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (dbErr) {
          console.warn('[Firestore Initial User Creation Note]', dbErr);
        }
      }

      setIsDemoSession(false);
      setIsSessionLocked(false);
      lastActivityRef.current = Date.now();

      setUserProfile({
        uid: newUser.uid,
        email: newUser.email || email,
        displayName: displayName.trim(),
        photoURL: '',
        role: role || 'Executive Director',
        company: company || '',
        presence: 'online',
        isAnonymous: false,
      });

    } catch (err: any) {
      console.error('[Firebase Auth Sign Up Error]', err);
      let message = 'Failed to create workspace account. Please try again.';
      if (err.code === 'auth/email-already-in-use') {
        message = 'An account with this email address already exists. Please log in instead.';
      } else if (err.code === 'auth/weak-password') {
        message = 'Password should be at least 6 characters.';
      } else if (err.code === 'auth/invalid-email') {
        message = 'The email address is improperly formatted.';
      } else if (err.message) {
        message = err.message;
      }
      setAuthError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Password Reset
  const resetPassword = async (email: string) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      if (!auth) throw new Error('Firebase Authentication is not initialized.');
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err: any) {
      console.error('[Firebase Password Reset Error]', err);
      let message = 'Failed to send password reset email.';
      if (err.code === 'auth/user-not-found') {
        message = 'No account found matching this email address.';
      } else if (err.code === 'auth/invalid-email') {
        message = 'Please provide a valid email address.';
      } else if (err.message) {
        message = err.message;
      }
      setAuthError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Google Sign-In handler (Firebase Auth popup)
  const loginWithGoogle = async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
      if (!auth) throw new Error('Firebase Authentication is not initialized.');
      const provider = new GoogleAuthProvider();
      provider.addScope('profile');
      provider.addScope('email');
      const result = await signInWithPopup(auth, provider);
      const loggedUser = result.user;

      setIsDemoSession(false);
      setIsSessionLocked(false);
      lastActivityRef.current = Date.now();

      if (db && loggedUser) {
        try {
          const userDocRef = doc(db, 'users', loggedUser.uid);
          const snap = await getDoc(userDocRef);
          if (!snap.exists()) {
            await setDoc(userDocRef, {
              uid: loggedUser.uid,
              email: loggedUser.email || '',
              displayName: loggedUser.displayName || loggedUser.email?.split('@')[0] || 'Team member',
              photoURL: loggedUser.photoURL || '',
              presence: 'online',
              role: 'Executive Director',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (dbErr) {
          console.warn('[Firestore Google Profile Sync Note]', dbErr);
        }
      }
    } catch (err: any) {
      if (beginMfa(err)) {
        const e: any = new Error('Enter the 6-digit code from your authenticator app.');
        e.code = 'mfa_required';
        throw e;
      }
      console.error('[Google Sign-In Error]', err);
      if (err.code === 'auth/popup-closed-by-user') {
        setAuthError('Sign-in popup closed by user.');
      } else if (err.code === 'auth/network-request-failed') {
        setAuthError('Network error during Google Sign-In. Please check your connection.');
      } else {
        setAuthError(err.message || 'Google Sign-In failed. Please try again.');
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // 5. Demo / Instant Sandbox Access (for review and immediate frictionless evaluation)
  const loginAsDemo = (role?: string, name?: string, email?: string) => {
    if (!SANDBOX_LOGIN_ENABLED) {
      setAuthError('Demo access is disabled. Sign in with your account.');
      return;
    }
    setIsLoading(true);
    setAuthError(null);
    setIsDemoSession(true);
    setIsSessionLocked(false);
    lastActivityRef.current = Date.now();

    const selectedProfile: UserProfile = {
      uid: 'demo-sandbox-executive',
      displayName: name || 'Rene Pierrette',
      email: email || 'sandbox-owner@example.com',
      photoURL: '',
      role: role || 'Class-5 Executive',
      company: 'Sandbox',
      presence: 'online',
      isAnonymous: false,
    };

    setUserProfile(selectedProfile);
    setIsLoading(false);
  };

  // 6. Other sign-in providers: real Firebase providers only. Each must be enabled in the Firebase console.
  const loginWithSocial = async (platform: string) => {
    setIsLoading(true);
    setAuthError(null);
    const key = platform.toLowerCase();
    try {
      if (key === 'google') return await loginWithGoogle();
      const provider = key === 'microsoft' ? new OAuthProvider('microsoft.com')
        : key === 'twitter' || key === 'x' ? new TwitterAuthProvider()
        : key === 'apple' ? new OAuthProvider('apple.com')
        : null;
      if (!provider) {
        setAuthError(`Signing in with ${platform} isn't available. Use email or Google.`);
        return;
      }
      if (!auth) throw new Error('not_configured');
      await signInWithPopup(auth, provider);
      setIsDemoSession(false);
      setIsSessionLocked(false);
    } catch (err: any) {
      const code = String(err?.code || err?.message || '');
      setAuthError(code.includes('operation-not-allowed') || code === 'not_configured'
        ? `Signing in with ${platform} isn't set up for this app yet. Use email or Google.`
        : code.includes('popup-closed') ? 'The sign-in window was closed.'
        : `Signing in with ${platform} didn't work. Try again.`);
    } finally {
      setIsLoading(false);
    }
  };

  // 7. Single sign-on (SAML/OIDC) isn't set up; say so instead of pretending to sign in.
  const loginWithEnterpriseSSO = async (_email: string, _code?: string) => {
    setAuthError('Single sign-on isn\'t available yet. Sign in with email or Google.');
  };

  // 8. Logout
  const logout = async () => {
    setIsLoading(true);
    try {
      if (auth) {
        await firebaseSignOut(auth);
      }
      setUser(null);
      setIsDemoSession(false);
      setIsSessionLocked(false);
      localStorage.removeItem('obsidian_auth_is_demo');
      sessionStorage.removeItem('obsidian_session_locked');
      setUserProfile(DEFAULT_PROFILE);
    } catch (err: any) {
      console.error('[Logout Error]', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 9. Session Lock & Unlock
  const lockSession = useCallback(() => {
    setIsSessionLocked(true);
  }, []);

  /**
   * Unlocking needs proof it's still you: your password (email accounts) or your sign-in provider
   * (Google etc.). Sandbox sessions have no credentials and unlock directly.
   */
  const unlockSession = useCallback(async (password?: string): Promise<boolean> => {
    const done = () => { setIsSessionLocked(false); lastActivityRef.current = Date.now(); return true; };
    const current = auth?.currentUser;
    if (!current) return isDemoSession ? done() : false;
    try {
      const usesPassword = current.providerData.some((p) => p.providerId === 'password');
      if (usesPassword) {
        if (!password || !current.email) return false;
        await reauthenticateWithCredential(current, EmailAuthProvider.credential(current.email, password));
      } else {
        const providerId = current.providerData[0]?.providerId;
        const provider = providerId === 'google.com' ? new GoogleAuthProvider()
          : providerId === 'twitter.com' ? new TwitterAuthProvider()
          : providerId ? new OAuthProvider(providerId) : null;
        if (!provider) return false;
        await reauthenticateWithPopup(current, provider);
      }
      return done();
    } catch {
      return false;
    }
  }, [isDemoSession]);

  // 10. Update Session Settings
  const updateSessionSettings = (settings: Partial<SessionSettings>) => {
    setSessionSettings(prev => ({ ...prev, ...settings }));
  };

  // 11. Terminate remote sessions
  const terminateSession = (sessionId: string) => {
    setActiveSessions(prev => prev.filter(s => s.id !== sessionId));
  };

  const terminateAllOtherSessions = () => {
    setActiveSessions(prev => prev.filter(s => s.isCurrent));
  };

  // 12. Presence updates
  const setPresence = async (presence: 'online' | 'busy' | 'away') => {
    setUserProfile(prev => ({ ...prev, presence }));

    if (user && db) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, {
          presence,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn('[Firestore Presence Update Error]', e);
      }
    }
  };

  // 13. Update Profile Details
  const updateProfileDetails = async (details: Partial<UserProfile>) => {
    setUserProfile(prev => ({ ...prev, ...details }));

    if (user && db) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        const updatePayload: any = {
          updatedAt: serverTimestamp(),
        };
        if (details.displayName) updatePayload.displayName = details.displayName;
        if (details.photoURL) updatePayload.photoURL = details.photoURL;
        if (details.presence) updatePayload.presence = details.presence;
        if (details.role) updatePayload.role = details.role;

        await updateDoc(userDocRef, updatePayload);
      } catch (e) {
        console.warn('[Firestore Profile Update Error]', e);
      }
    }
  };

  const clearAuthError = () => setAuthError(null);

  // 14. Role-Based Authorization & Role Switcher
  const currentRole = userProfile?.role || 'Executive Director';
  const userPermissions = ROLE_PERMISSIONS[currentRole] || ROLE_PERMISSIONS['Executive Director'] || [];

  const hasPermission = useCallback((permission: Permission): boolean => {
    // Executive / Super Admin roles bypass
    if (currentRole === 'Executive Director' || currentRole === 'Class-5 Executive') {
      return true;
    }
    const perms = ROLE_PERMISSIONS[currentRole];
    if (!perms) return false;
    return perms.includes(permission);
  }, [currentRole]);

  const switchRole = useCallback((newRole: string) => {
    setUserProfile(prev => {
      const updated = {
        ...prev,
        role: newRole
      };
      try {
        localStorage.setItem('obsidian_auth_user_profile', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const isAuthenticated = Boolean(user && !user.isAnonymous) || (SANDBOX_LOGIN_ENABLED && isDemoSession);

  // Tell the API client who is signed in: Firebase user, or the sandbox profile (which has no Firebase token).

  // Set during render, not in an effect: child components' effects run first and would otherwise

  // send their first requests without an identity.

  setApiIdentityHint((user as any)?.uid || (userProfile as any)?.uid);


  return (
    <AuthContext.Provider value={{
      user,
      userProfile,
      isAuthenticated,
      isDemoSession,
      isSessionLocked,
      isLoading,
      authError,
      sessionSettings,
      activeSessions,
      currentSession,
      loginWithEmail,
      signUpWithEmail,
      resetPassword,
      loginWithGoogle,
      loginAsDemo,
      loginWithSocial,
      loginWithEnterpriseSSO,
      logout,
      mfaPending,
      completeMfaSignIn,
      cancelMfaSignIn,
      hasPermission,
      userPermissions,
      switchRole,
      lockSession,
      unlockSession,
      updateSessionSettings,
      terminateSession,
      terminateAllOtherSessions,
      setPresence,
      updateProfileDetails,
      clearAuthError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Like useAuth, but returns undefined outside an AuthProvider (shared providers and tests). */
export function useOptionalAuth() {
  return useContext(AuthContext);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
