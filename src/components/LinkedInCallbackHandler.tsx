import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { 
  Linkedin, 
  Loader2, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight, 
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

/**
 * Initiates the LinkedIn OAuth 2.0 dynamic flow.
 * - Generates a secure, random state string.
 * - Saves it to localStorage.
 * - Dynamic config resolution for Client ID.
 * - Redirects the user to the LinkedIn authorization endpoint.
 * - Scopes: openid, profile, w_member_social.
 */
export async function initiateLinkedInLogin() {
  try {
    // 1. Generate a secure, random state string (32 characters hex)
    const array = new Uint32Array(4);
    window.crypto.getRandomValues(array);
    const state = Array.from(array, dec => dec.toString(16).padStart(8, '0')).join('');
    
    // Save it to localStorage for verification in the callback component
    localStorage.setItem('linkedin_auth_state', state);

    // 2. Fetch the client ID from the backend endpoint dynamically
    const response = await axios.get<{ clientId: string }>('/api/auth/linkedin/client-id');
    const clientId = response.data.clientId || '78sxoz6t0uxc28';

    // 3. Construct redirect URI and scopes
    const redirectUri = `${window.location.origin}/auth/callback/linkedin`;
    const scope = 'openid profile w_member_social';

    // 4. Calculate final LinkedIn OAuth URL
    const queryParams = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: state,
      scope: scope
    });

    const authorizationUrl = `https://www.linkedin.com/oauth/v2/authorization?${queryParams.toString()}`;
    
    // 5. Redirect the user to the LinkedIn OAuth login screen
    window.location.href = authorizationUrl;
  } catch (err: any) {
    console.error('[LinkedIn OAuth Setup Failure]:', err);
    alert(`Could not initiate secure handshake with LinkedIn: ${err.message}`);
  }
}

/**
 * Interface representing the session response data returned by the backend server
 */
interface LinkedInSessionData {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    name: string;
    email: string;
    avatar: string;
  };
  accountId?: string;
  isMock?: boolean;
}

interface LinkedInCallbackHandlerProps {
  /**
   * Optional custom URL for the backend authentication endpoint.
   * Defaults to '/api/auth/linkedin/callback'
   */
  backendUrl?: string;
  
  /**
   * Callback triggered when authorization completes successfully
   */
  onSuccess?: (session: LinkedInSessionData) => void;

  /**
   * Callback triggered when authorization fails
   */
  onFailure?: (error: string) => void;

  /**
   * Router transition handler to navigate away.
   * If omitted, falls back to window.location.href redirects.
   */
  navigate?: (path: string) => void;
}

/**
 * LinkedInCallbackHandler
 * 
 * A high-fidelity, polished, and secure React component to process LinkedIn OAuth callbacks.
 * Handles extracting the authorization 'code' and 'state' from the URL query parameters,
 * verifies the state parameter against the cached value in localStorage (CSRF Protection),
 * exchanges it with the backend server, stores active sessions, and transitions back.
 */
export default function LinkedInCallbackHandler({
  backendUrl = '/api/auth/linkedin/callback',
  onSuccess,
  onFailure,
  navigate
}: LinkedInCallbackHandlerProps) {
  const [status, setStatus] = useState<'idle' | 'verifying' | 'exchanging' | 'success' | 'error'>('idle');
  const [stepDescription, setStepDescription] = useState<string>('Initializing handshake protocol...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<LinkedInSessionData | null>(null);

  useEffect(() => {
    let active = true;

    async function handleCallback() {
      setStatus('verifying');
      setStepDescription('Parsing security tokens and verifying state token...');

      // 1. Capture authorization parameters from the URL
      let code: string | null = null;
      let stateParam: string | null = null;
      let errorParam: string | null = null;
      let errorDescParam: string | null = null;

      try {
        const searchParams = new URLSearchParams(window.location.search);
        code = searchParams.get('code');
        stateParam = searchParams.get('state');
        errorParam = searchParams.get('error');
        errorDescParam = searchParams.get('error_description');
      } catch (e) {
        console.warn('URLSearchParams capture failed, trying window parsing fallback:', e);
        const codeMatch = window.location.href.match(/[?&]code=([^&#]*)/);
        const stateMatch = window.location.href.match(/[?&]state=([^&#]*)/);
        const errorMatch = window.location.href.match(/[?&]error=([^&#]*)/);
        code = codeMatch ? decodeURIComponent(codeMatch[1]) : null;
        stateParam = stateMatch ? decodeURIComponent(stateMatch[1]) : null;
        errorParam = errorMatch ? decodeURIComponent(errorMatch[1]) : null;
      }

      // 2. Handle native LinkedIn authorization errors
      if (errorParam) {
        const errorStr = errorDescParam || errorParam || 'User rejected authorization request.';
        if (!active) return;
        setStatus('error');
        setErrorMessage(errorStr);
        if (onFailure) onFailure(errorStr);
        return;
      }

      // 3. Verify state against stored CSRF token
      const storedState = localStorage.getItem('linkedin_auth_state');
      // Clear state immediately to prevent replay attacks
      localStorage.removeItem('linkedin_auth_state');

      if (!stateParam || stateParam !== storedState) {
        const csrfError = 'CSRF validation failed: State token mismatch. The transaction may have been intercepted.';
        console.error('[LinkedIn OAuth CSRF Error]:', { received: stateParam, expected: storedState });
        if (!active) return;
        setStatus('error');
        setErrorMessage(csrfError);
        if (onFailure) onFailure(csrfError);
        return;
      }

      if (!code) {
        const noCodeStr = 'Missing OAuth authorization code in callback query parameters.';
        if (!active) return;
        setStatus('error');
        setErrorMessage(noCodeStr);
        if (onFailure) onFailure(noCodeStr);
        return;
      }

      // 4. Initiate backend credential token exchange
      if (!active) return;
      setStatus('exchanging');
      setStepDescription('Exchanging authorization code for secure session keys...');

      try {
        // Send authorization code to the backend server
        const response = await axios.post<LinkedInSessionData>(backendUrl, {
          code: code
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        });

        if (!active) return;

        const data = response.data;

        if (data.success || data.token) {
          setStatus('success');
          setStepDescription('Handshake verified. Access credentials established!');
          setSessionInfo(data);

          // Securely persist login details to localStorage for persistent sessions
          localStorage.setItem('obsidian_linkedin_logged_in', 'true');
          if (data.token) {
            localStorage.setItem('obsidian_linkedin_jwt_token', data.token);
          }
          if (data.user) {
            localStorage.setItem('obsidian_user_profile', JSON.stringify({
              name: data.user.name,
              email: data.user.email,
              avatar: data.user.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120'
            }));
          }
          if (data.accountId) {
            localStorage.setItem('obsidian_linkedin_account_id', data.accountId);
          }

          // Trigger custom developer success callback
          if (onSuccess) {
            onSuccess(data);
          }

          // Purge sensitive query parameters from the window history stack
          try {
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch (historyErr) {
            console.warn('Failed clearing URL search params:', historyErr);
          }

          // 5. Redirect to Dashboard with a short delay for smooth visual feedback
          setTimeout(() => {
            if (!active) return;
            if (navigate) {
              navigate('/dashboard');
            } else {
              // Standard client-side fallback
              window.location.href = '/';
            }
          }, 1800);

        } else {
          throw new Error('Backend responded without a valid token or success status flag.');
        }

      } catch (err: any) {
        if (!active) return;
        console.error('LinkedIn authorization exchange failure:', err);
        const detailedError = err.response?.data?.error || err.response?.data?.message || err.message || 'Network handshake timeout.';
        setStatus('error');
        setErrorMessage(detailedError);
        if (onFailure) onFailure(detailedError);
      }
    }

    handleCallback();

    return () => {
      active = false;
    };
  }, [backendUrl, onSuccess, onFailure, navigate]);

  return (
    <div 
      id="linkedin-callback-container"
      className="obsidian min-h-[450px] w-full max-w-lg mx-auto flex flex-col items-center justify-center p-8 bg-white dark:bg-[var(--obsidian-0)] border border-slate-200/80 dark:border-white/5 rounded-3xl shadow-2xl relative overflow-hidden transition-all duration-300"
    >
      {/* Dynamic Background visual highlights */}
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#0A66C2] via-blue-500 to-indigo-600" />
      
      <AnimatePresence mode="wait">
        {(status === 'verifying' || status === 'exchanging' || status === 'idle') && (
          <motion.div 
            key="loading"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col items-center text-center space-y-6"
          >
            <div className="relative">
              <div className="h-20 w-20 rounded-full bg-blue-50 dark:bg-blue-950/20 flex items-center justify-center">
                <Linkedin className="h-10 w-10 text-[#0A66C2] animate-pulse" />
              </div>
              <div className="obsidian absolute -bottom-1 -right-1 bg-white dark:bg-[var(--obsidian-0)] p-1.5 rounded-full shadow-md">
                <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                Securing LinkedIn Handshake
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tracking-wider bg-slate-50 dark:bg-white/5 px-3 py-1.5 rounded-lg border border-slate-100 dark:border-white/5">
                {stepDescription}
              </p>
            </div>

            <div className="w-48 h-1.5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden relative">
              <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-[#0A66C2] to-blue-500 rounded-full animate-[loading-bar_1.5s_infinite_ease-in-out] w-24" />
            </div>

            <p className="text-[10px] text-slate-400 dark:text-neutral-500 font-bold uppercase tracking-widest">
              Executing CSRF & Gateway validation...
            </p>
          </motion.div>
        )}

        {status === 'success' && (
          <motion.div 
            key="success"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="flex flex-col items-center text-center space-y-6"
          >
            <div className="h-20 w-20 rounded-full bg-emerald-50 dark:bg-emerald-950/20 flex items-center justify-center shadow-lg shadow-emerald-500/10">
              <ShieldCheck className="h-11 w-11 text-emerald-500 animate-bounce" />
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center justify-center gap-2">
                <span>Access Granted</span>
                <span className="text-[10px] font-black uppercase text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full tracking-wider dark:bg-emerald-950/20 dark:border-emerald-500/10">
                  Verified
                </span>
              </h3>
              
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-sm">
                Successfully authorized your account. Your professional profile has been verified and securely linked.
              </p>
            </div>

            {sessionInfo?.user && (
              <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-150 dark:border-white/5 max-w-xs text-left w-full">
                <img 
                  src={sessionInfo.user.avatar} 
                  alt={sessionInfo.user.name} 
                  referrerPolicy="no-referrer"
                  className="h-10 w-10 rounded-xl object-cover border border-slate-200 dark:border-neutral-800"
                />
                <div className="min-w-0">
                  <span className="text-xs font-black text-slate-900 dark:text-white block truncate">
                    {sessionInfo.user.name}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-neutral-500 block truncate font-mono">
                    {sessionInfo.user.email}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-blue-500 font-extrabold animate-pulse">
              <span>Redirecting to workspace</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </motion.div>
        )}

        {status === 'error' && (
          <motion.div 
            key="error"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center text-center space-y-6 w-full"
          >
            <div className="h-20 w-20 rounded-full bg-red-50 dark:bg-red-950/20 flex items-center justify-center shadow-lg shadow-red-500/10">
              <AlertTriangle className="h-10 w-10 text-red-500 animate-pulse" />
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                Authentication Interrupted
              </h3>
              <div className="bg-red-50/50 dark:bg-red-950/10 border border-red-100 dark:border-red-500/10 p-4 rounded-2xl text-xs text-red-650 dark:text-red-400 font-mono text-left max-w-md break-all">
                <span className="font-extrabold uppercase text-[9px] tracking-wider text-red-500 block mb-1">Diagnostic Log:</span>
                {errorMessage}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm pt-2">
              <button
                id="btn-retry-linkedin-auth"
                type="button"
                onClick={() => {
                  window.location.href = '/';
                }}
                className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-neutral-200 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Back to App</span>
              </button>
              
              <button
                id="btn-manual-redirect-oauth"
                type="button"
                onClick={() => {
                  initiateLinkedInLogin();
                }}
                className="flex-1 py-2.5 px-4 bg-[#0A66C2] hover:bg-[#004182] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Retry Handshake</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
