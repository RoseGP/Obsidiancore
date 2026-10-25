/**
 * Unified API Gateway / Backend-for-Frontend (BFF) Client Utility
 * Provides type-safe frontend methods to call /api/v1 endpoints with consolidated response parsing
 */

export interface BffApiResponse<T = any> {
  success: boolean;
  data: T | null;
  error: string | null;
}

export interface InitiateMeetingPayload {
  title: string;
  date?: string;
  time?: string;
  duration?: number;
  guests?: string[];
  locations?: string[];
  additionalNotes?: string;
  syncGoogleCalendar?: boolean;
}

export interface InitiateMeetingResult {
  transactionId: string;
  status: string;
  meeting: {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    guests: string[];
    videoLink: string;
    status: string;
  };
  googleCalendar: {
    synced: boolean;
    eventId: string;
    htmlLink: string;
    status: string;
  };
  webrtc: {
    roomId: string;
    roomToken: string;
    signalingEndpoint: string;
    videoLink: string;
    expiresAt: string;
  };
}

class BffClient {
  private baseUrl: string = '/api/v1';

  /**
   * Retrieves active auth token from localStorage or session
   */
  private getToken(): string {
    // No fallback token: without a stored session token the request goes out without one and the
    // global API auth wrapper (lib/apiAuth.ts) attaches the signed-in user's Firebase ID token.
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('bff_jwt_token') || '';
  }

  /**
   * Sets active auth token in localStorage
   */
  public setToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('bff_jwt_token', token);
    }
  }

  /**
   * Generic request fetcher adhering to { success, data, error } wrapper
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<BffApiResponse<T>> {
    try {
      const headers = new Headers(options.headers || {});
      headers.set('Content-Type', 'application/json');
      
      const token = this.getToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers
      });

      const json: BffApiResponse<T> = await response.json();

      if (!response.ok && !json.error) {
        return {
          success: false,
          data: null,
          error: `HTTP Error ${response.status}: ${response.statusText}`
        };
      }

      return json;
    } catch (err: any) {
      console.error(`[BFF Client] Request to ${endpoint} failed:`, err);
      return {
        success: false,
        data: null,
        error: err.message || 'Network communication error'
      };
    }
  }

  /**
   * Public Health Check
   */
  public async getHealth(): Promise<BffApiResponse> {
    return this.request('/health', { method: 'GET' });
  }

  /**
   * Authenticate and save JWT token
   */
  public async login(email?: string, password?: string): Promise<BffApiResponse> {
    const res = await this.request<{ token: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    if (res.success && res.data?.token) {
      this.setToken(res.data.token);
    }

    return res;
  }

  /**
   * Fetch current user details
   */
  public async getMe(): Promise<BffApiResponse> {
    return this.request('/me', { method: 'GET' });
  }

  /**
   * Fetch meetings via BFF gateway
   */
  public async getMeetings(): Promise<BffApiResponse> {
    return this.request('/meetings', { method: 'GET' });
  }

  /**
   * Initiate a consolidated meeting transaction (DB + Google Cal Sync + WebRTC Token)
   */
  public async initiateMeeting(payload: InitiateMeetingPayload): Promise<BffApiResponse<InitiateMeetingResult>> {
    return this.request<InitiateMeetingResult>('/meetings/initiate', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
}

export const bffClient = new BffClient();
