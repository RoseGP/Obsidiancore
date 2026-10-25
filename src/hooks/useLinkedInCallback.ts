import { useState, useEffect } from 'react';
import axios from 'axios';

interface UseLinkedInCallbackOptions {
  /**
   * Optional custom URL for the backend authentication endpoint.
   * Defaults to '/api/auth/linkedin/callback'
   */
  backendUrl?: string;

  /**
   * Router navigation callback. If omitted, falls back to standard window location redirection.
   */
  navigate?: (path: string) => void;
}

interface UseLinkedInCallbackResult {
  /**
   * Current status of the OAuth callback handshake process
   */
  status: 'idle' | 'loading' | 'success' | 'error';

  /**
   * Status description/label explaining the current step
   */
  stepDescription: string;

  /**
   * Any validation or communication error messages encountered
   */
  error: string | null;

  /**
   * Received user session data from successful backend authentication
   */
  sessionData: any | null;

  /**
   * Function to manually re-trigger the OAuth callback code processing
   */
  triggerHandshake: () => Promise<void>;
}

/**
 * useLinkedInCallback
 * 
 * A custom React Hook to safely process LinkedIn OAuth authorization codes,
 * verify the dynamic state parameter for CSRF validation, exchange it with the backend server,
 * and navigate users to the secure dashboard.
 */
export function useLinkedInCallback({
  backendUrl = '/api/auth/linkedin/callback',
  navigate
}: UseLinkedInCallbackOptions = {}): UseLinkedInCallbackResult {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [stepDescription, setStepDescription] = useState<string>('Standby');
  const [error, setError] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<any | null>(null);

  const triggerHandshake = async () => {
    setStatus('loading');
    setStepDescription('Verifying authentication state & tokens...');
    setError(null);

    let code: string | null = null;
    let stateParam: string | null = null;
    let errorParam: string | null = null;
    let errorDescParam: string | null = null;

    try {
      // 1. Capture authorization parameters from the URL
      const searchParams = new URLSearchParams(window.location.search);
      code = searchParams.get('code');
      stateParam = searchParams.get('state');
      errorParam = searchParams.get('error');
      errorDescParam = searchParams.get('error_description');
    } catch (e) {
      console.warn('Hook URLSearchParams extraction warning, fallback active:', e);
      const matchCode = window.location.search.match(/[?&]code=([^&#]*)/);
      const matchState = window.location.search.match(/[?&]state=([^&#]*)/);
      code = matchCode ? decodeURIComponent(matchCode[1]) : null;
      stateParam = matchState ? decodeURIComponent(matchState[1]) : null;
    }

    // 2. Validate native errors
    if (errorParam) {
      const errorStr = errorDescParam || errorParam || 'User aborted LinkedIn authorization process.';
      setStatus('error');
      setError(errorStr);
      setStepDescription('Authorization process cancelled');
      return;
    }

    // 3. Verify state CSRF token
    const storedState = localStorage.getItem('linkedin_auth_state');
    // Clear state token immediately to prevent replay
    localStorage.removeItem('linkedin_auth_state');

    if (!stateParam || stateParam !== storedState) {
      const csrfError = 'CSRF verification failed: State token mismatch.';
      setStatus('error');
      setError(csrfError);
      setStepDescription('Security verification failed');
      return;
    }

    if (!code) {
      const missingCodeError = 'OAuth code query parameter is missing in current URL context.';
      setStatus('error');
      setError(missingCodeError);
      setStepDescription('Inbound token validation failed');
      return;
    }

    // 4. Initiate backend token exchange
    setStatus('loading');
    setStepDescription('Exchanging authorization code for secure session keys...');

    try {
      const response = await axios.post(backendUrl, {
        code: code
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      const data = response.data;

      if (data && (data.success || data.token)) {
        setStatus('success');
        setStepDescription('Authentication verified! Synchronizing session credentials...');
        setSessionData(data);

        // Store session tokens locally
        localStorage.setItem('obsidian_linkedin_logged_in', 'true');
        if (data.token) {
          localStorage.setItem('obsidian_linkedin_jwt_token', data.token);
        }
        if (data.user) {
          localStorage.setItem('obsidian_user_profile', JSON.stringify({
            name: data.user.name,
            email: data.user.email,
            avatar: data.user.avatar
          }));
        }

        // Clean search query parameters
        try {
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (e) {
          console.warn('Failed clearing query parameters:', e);
        }

        // 5. Redirect user to the dashboard view
        setTimeout(() => {
          if (navigate) {
            navigate('/dashboard');
          } else {
            window.location.href = '/';
          }
        }, 1500);

      } else {
        throw new Error('API server returned invalid or empty session responses.');
      }
    } catch (err: any) {
      console.error('LinkedIn hook auth error:', err);
      const detailedMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Network gateway exchange timeout.';
      setStatus('error');
      setError(detailedMessage);
      setStepDescription('Backend exchange authentication failed');
    }
  };

  useEffect(() => {
    // Automatically execute callback parsing on hook mount
    triggerHandshake();
  }, [backendUrl]);

  return {
    status,
    stepDescription,
    error,
    sessionData,
    triggerHandshake
  };
}
