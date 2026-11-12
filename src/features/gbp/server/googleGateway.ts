/**
 * Google Business Profile gateway (server only). The only file that knows
 * Google URLs, parameters and payload shapes.
 *
 * Verified against googleapis@178 generated clients (Google discovery docs):
 *   GET   mybusinessaccountmanagement.googleapis.com/v1/accounts
 *   GET   mybusinessbusinessinformation.googleapis.com/v1/{accounts/{a}}/locations?readMask=…   (readMask required)
 *   PATCH mybusinessbusinessinformation.googleapis.com/v1/{locations/{l}}?updateMask=…
 *   GET   businessprofileperformance.googleapis.com/v1/{locations/{l}}:fetchMultiDailyMetricsTimeSeries
 *
 * Google My Business API v4 (NOT in the generated client; per Google's published v4 reference —
 * re-verify before launch, and note v4 access must be enabled for the Cloud project):
 * TODO(before production): run Connect → Sync against a real, approved project and confirm reviews and posts load;
 * if Google retires a v4 method, move that call to its replacement API and update tests/mockGoogle.ts.
 *   GET    mybusiness.googleapis.com/v4/{accounts/{a}/locations/{l}}/reviews
 *   PUT    mybusiness.googleapis.com/v4/{…/reviews/{r}}/reply        { comment }
 *   DELETE mybusiness.googleapis.com/v4/{…/reviews/{r}}/reply
 *   GET    mybusiness.googleapis.com/v4/{accounts/{a}/locations/{l}}/localPosts
 *   POST   mybusiness.googleapis.com/v4/{accounts/{a}/locations/{l}}/localPosts
 *
 * OAuth 2.0 (Google Identity): accounts.google.com/o/oauth2/v2/auth,
 * oauth2.googleapis.com/token, oauth2.googleapis.com/revoke.
 */
import { GatewayError } from '../../social-accounts/server/gateway';

export { GatewayError };
export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';
const TIMEOUT = 20_000;

async function http(url: string, init: RequestInit = {}): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  let res: Response;
  try { res = await fetch(url, { ...init, signal: ctrl.signal }); }
  catch (err: any) { throw new GatewayError(err?.name === 'AbortError' ? 'Google didn’t respond in time.' : 'Google couldn’t be reached.', 0, 'unavailable'); }
  finally { clearTimeout(t); }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const e = body?.error;
    const msg = String((typeof e === 'object' ? e?.message : body?.error_description || e) || `Google returned ${res.status}.`).slice(0, 300);
    const kind = res.status === 401 ? 'unauthorized' : res.status === 403 ? 'not_allowed' : res.status === 404 ? 'not_found' : res.status === 429 || res.status >= 500 ? 'unavailable' : 'other';
    throw new GatewayError(msg, res.status, kind);
  }
  return body;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });

export interface GoogleTokens { accessToken: string; expiresIn: number; refreshToken?: string; scope: string; email?: string }

export interface GLocation {
  name: string; // locations/123
  accountName: string; // accounts/456
  title: string;
  primaryCategory?: string;
  additionalCategories: string[];
  address?: { lines: string[]; city?: string; region?: string; postalCode?: string; country?: string };
  phone?: string;
  website?: string;
  description?: string;
  regularHours: { day: string; open: string; close: string }[];
  hasSpecialHours: boolean;
  serviceItemCount: number;
  mapsUri?: string;
  /** openInfo.status: OPEN, CLOSED_PERMANENTLY, CLOSED_TEMPORARILY (absent = not returned). */
  openStatus?: string;
  /** Output-only listing metadata from Business Information v1 (absent fields = Google didn't return them). */
  listing?: { hasPendingEdits?: boolean; hasGoogleUpdated?: boolean; duplicateLocation?: string; hasVoiceOfMerchant?: boolean; canModifyServiceList?: boolean; placeId?: string; newReviewUri?: string };
}

/** Account Management v1 Admin (locations/{l}/admins). The admin field is a name, or an email while an invitation is pending. */
export interface GAdmin { name: string; admin: string; role: string; pendingInvitation: boolean }

export interface GReview {
  name: string; // accounts/…/locations/…/reviews/…
  reviewer: string;
  reviewerPhoto?: string;
  rating: number;
  comment: string;
  createTime: string;
  updateTime: string;
  reply?: { comment: string; updateTime: string };
}

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const pad = (n: number) => String(n).padStart(2, '0');

export interface GoogleBases { auth: string; oauth: string; accounts: string; info: string; perf: string; v4: string }
export const GOOGLE_BASES: GoogleBases = {
  auth: 'https://accounts.google.com', oauth: 'https://oauth2.googleapis.com', accounts: 'https://mybusinessaccountmanagement.googleapis.com',
  info: 'https://mybusinessbusinessinformation.googleapis.com', perf: 'https://businessprofileperformance.googleapis.com', v4: 'https://mybusiness.googleapis.com',
};

/** `bases` exists only so tests can point at a local stand-in; production uses Google's hosts. */
export function createGoogleGateway(cfg: { clientId: string; clientSecret: string; redirectUri: string }, B: GoogleBases = GOOGLE_BASES) {
  return {
    authUrl(state: string, codeChallenge: string, loginHint?: string) {
      const q = new URLSearchParams({
        client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code',
        scope: `${GBP_SCOPE} openid email`, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
        state, code_challenge: codeChallenge, code_challenge_method: 'S256', ...(loginHint ? { login_hint: loginHint } : {}),
      });
      return `${B.auth}/o/oauth2/v2/auth?${q}`;
    },

    async exchangeCode(code: string, codeVerifier: string): Promise<GoogleTokens> {
      const b = await http(`${B.oauth}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier }),
      });
      if (typeof b?.access_token !== 'string') throw new GatewayError('Google returned an unexpected token response.', 502, 'bad_response');
      let email: string | undefined;
      try { email = JSON.parse(Buffer.from(String(b.id_token).split('.')[1], 'base64url').toString()).email; } catch { /* no id_token */ }
      return { accessToken: b.access_token, expiresIn: Number(b.expires_in) || 3600, refreshToken: b.refresh_token, scope: String(b.scope || ''), email };
    },

    async refresh(refreshToken: string): Promise<GoogleTokens> {
      const b = await http(`${B.oauth}/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' }),
      });
      return { accessToken: b.access_token, expiresIn: Number(b.expires_in) || 3600, scope: String(b.scope || '') };
    },

    async revoke(token: string): Promise<void> {
      await http(`${B.oauth}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
    },

    async listAccounts(token: string): Promise<{ name: string; accountName: string; type?: string }[]> {
      const out: any[] = [];
      let pageToken = '';
      do {
        const q = new URLSearchParams({ pageSize: '20', ...(pageToken ? { pageToken } : {}) });
        const b = await http(`${B.accounts}/v1/accounts?${q}`, { headers: bearer(token) });
        out.push(...(b?.accounts ?? []));
        pageToken = b?.nextPageToken || '';
      } while (pageToken && out.length < 200);
      return out.map((a) => ({ name: String(a.name), accountName: String(a.accountName ?? a.name), type: a.type }));
    },

    async listLocations(token: string, accountName: string): Promise<GLocation[]> {
      const readMask = 'name,title,categories,storefrontAddress,phoneNumbers,websiteUri,profile,regularHours,specialHours,serviceItems,metadata,openInfo';
      const out: GLocation[] = [];
      let pageToken = '';
      do {
        const q = new URLSearchParams({ readMask, pageSize: '100', ...(pageToken ? { pageToken } : {}) });
        const b = await http(`${B.info}/v1/${accountName}/locations?${q}`, { headers: bearer(token) });
        for (const l of b?.locations ?? []) {
          out.push({
            name: String(l.name), accountName, title: String(l.title ?? ''),
            primaryCategory: l.categories?.primaryCategory?.displayName,
            additionalCategories: (l.categories?.additionalCategories ?? []).map((c: any) => String(c.displayName)),
            address: l.storefrontAddress ? { lines: l.storefrontAddress.addressLines ?? [], city: l.storefrontAddress.locality, region: l.storefrontAddress.administrativeArea, postalCode: l.storefrontAddress.postalCode, country: l.storefrontAddress.regionCode } : undefined,
            phone: l.phoneNumbers?.primaryPhone, website: l.websiteUri, description: l.profile?.description,
            regularHours: (l.regularHours?.periods ?? []).map((p: any) => ({
              day: String(p.openDay), open: `${pad(p.openTime?.hours ?? 0)}:${pad(p.openTime?.minutes ?? 0)}`, close: `${pad(p.closeTime?.hours ?? 0)}:${pad(p.closeTime?.minutes ?? 0)}`,
            })),
            hasSpecialHours: Array.isArray(l.specialHours?.specialHourPeriods) && l.specialHours.specialHourPeriods.length > 0,
            serviceItemCount: Array.isArray(l.serviceItems) ? l.serviceItems.length : 0,
            mapsUri: l.metadata?.mapsUri,
            openStatus: typeof l.openInfo?.status === 'string' ? l.openInfo.status : undefined,
            listing: l.metadata ? {
              hasPendingEdits: typeof l.metadata.hasPendingEdits === 'boolean' ? l.metadata.hasPendingEdits : undefined,
              hasGoogleUpdated: typeof l.metadata.hasGoogleUpdated === 'boolean' ? l.metadata.hasGoogleUpdated : undefined,
              duplicateLocation: typeof l.metadata.duplicateLocation === 'string' && l.metadata.duplicateLocation ? l.metadata.duplicateLocation : undefined,
              hasVoiceOfMerchant: typeof l.metadata.hasVoiceOfMerchant === 'boolean' ? l.metadata.hasVoiceOfMerchant : undefined,
              canModifyServiceList: typeof l.metadata.canModifyServiceList === 'boolean' ? l.metadata.canModifyServiceList : undefined,
              placeId: typeof l.metadata.placeId === 'string' ? l.metadata.placeId : undefined,
              newReviewUri: typeof l.metadata.newReviewUri === 'string' && l.metadata.newReviewUri.startsWith('https://') ? l.metadata.newReviewUri : undefined,
            } : undefined,
          });
        }
        pageToken = b?.nextPageToken || '';
      } while (pageToken && out.length < 1000);
      return out;
    },

    /** Only fields Business Information v1 lets owners update directly; Google may hold edits for review. */
    async patchLocation(token: string, locationName: string, patch: { phone?: string; website?: string; description?: string; hours?: { day: string; open: string; close: string }[] }) {
      const body: any = {}; const mask: string[] = [];
      if (patch.hours !== undefined) {
        const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
        const t = (hm: string) => { const [h, m] = hm.split(':').map(Number); return { hours: h, minutes: m }; };
        body.regularHours = { periods: patch.hours.map((p) => {
          // Closing at or before opening means after midnight: Google wants the next day as closeDay.
          const overnight = p.close <= p.open;
          return { openDay: p.day, openTime: t(p.open), closeDay: overnight ? DAYS[(DAYS.indexOf(p.day) + 1) % 7] : p.day, closeTime: p.close === '24:00' ? { hours: 24 } : t(p.close) };
        }) };
        mask.push('regularHours');
      }
      if (patch.phone !== undefined) { body.phoneNumbers = { primaryPhone: patch.phone }; mask.push('phoneNumbers.primaryPhone'); }
      if (patch.website !== undefined) { body.websiteUri = patch.website; mask.push('websiteUri'); }
      if (patch.description !== undefined) { body.profile = { description: patch.description }; mask.push('profile.description'); }
      await http(`${B.info}/v1/${locationName}?updateMask=${encodeURIComponent(mask.join(','))}`, {
        method: 'PATCH', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    },

    /** Account Management v1: who can manage this location (needs owner or manager rights; 403 otherwise). */
    async listLocationAdmins(token: string, locationName: string): Promise<GAdmin[]> {
      const b = await http(`${B.accounts}/v1/${locationName}/admins`, { headers: bearer(token) });
      return (b?.admins ?? []).map((a: any) => ({ name: String(a.name ?? ''), admin: String(a.admin ?? ''), role: String(a.role ?? 'ROLE_UNSPECIFIED'), pendingInvitation: a.pendingInvitation === true }));
    },

    /** v4: accounts/{a}/locations/{l} */
    async listReviews(token: string, v4Location: string, max = 200): Promise<{ reviews: GReview[]; averageRating?: number; total?: number }> {
      const out: GReview[] = [];
      let pageToken = ''; let averageRating: number | undefined; let total: number | undefined;
      do {
        const q = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc', ...(pageToken ? { pageToken } : {}) });
        const b = await http(`${B.v4}/v4/${v4Location}/reviews?${q}`, { headers: bearer(token) });
        averageRating = b?.averageRating ?? averageRating; total = b?.totalReviewCount ?? total;
        for (const r of b?.reviews ?? []) {
          out.push({
            name: String(r.name), reviewer: r.reviewer?.isAnonymous ? 'Anonymous' : String(r.reviewer?.displayName ?? 'Google user'),
            reviewerPhoto: typeof r.reviewer?.profilePhotoUrl === 'string' && r.reviewer.profilePhotoUrl.startsWith('https://') ? r.reviewer.profilePhotoUrl : undefined,
            rating: STARS[String(r.starRating)] ?? 0, comment: String(r.comment ?? ''), createTime: String(r.createTime), updateTime: String(r.updateTime ?? r.createTime),
            reply: r.reviewReply ? { comment: String(r.reviewReply.comment ?? ''), updateTime: String(r.reviewReply.updateTime ?? '') } : undefined,
          });
        }
        pageToken = b?.nextPageToken || '';
      } while (pageToken && out.length < max);
      return { reviews: out, averageRating, total };
    },

    async putReply(token: string, reviewName: string, comment: string): Promise<{ comment: string; updateTime: string }> {
      const b = await http(`${B.v4}/v4/${reviewName}/reply`, { method: 'PUT', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }) });
      return { comment: String(b?.comment ?? comment), updateTime: String(b?.updateTime ?? new Date().toISOString()) };
    },

    async deleteReply(token: string, reviewName: string): Promise<void> {
      await http(`${B.v4}/v4/${reviewName}/reply`, { method: 'DELETE', headers: bearer(token) });
    },

    async dailyMetrics(token: string, locationName: string, from: Date, to: Date, metrics: string[]): Promise<Record<string, { date: string; value: number }[]>> {
      const q = new URLSearchParams();
      for (const m of metrics) q.append('dailyMetrics', m);
      q.set('dailyRange.startDate.year', String(from.getUTCFullYear())); q.set('dailyRange.startDate.month', String(from.getUTCMonth() + 1)); q.set('dailyRange.startDate.day', String(from.getUTCDate()));
      q.set('dailyRange.endDate.year', String(to.getUTCFullYear())); q.set('dailyRange.endDate.month', String(to.getUTCMonth() + 1)); q.set('dailyRange.endDate.day', String(to.getUTCDate()));
      const b = await http(`${B.perf}/v1/${locationName}:fetchMultiDailyMetricsTimeSeries?${q}`, { headers: bearer(token) });
      const out: Record<string, { date: string; value: number }[]> = {};
      for (const group of b?.multiDailyMetricTimeSeries ?? []) {
        for (const s of group?.dailyMetricTimeSeries ?? []) {
          out[s.dailyMetric] = (s.timeSeries?.datedValues ?? []).map((v: any) => ({ date: `${v.date.year}-${pad(v.date.month)}-${pad(v.date.day)}`, value: Number(v.value ?? 0) }));
        }
      }
      return out;
    },

    async listPosts(token: string, v4Location: string): Promise<any[]> {
      const b = await http(`${B.v4}/v4/${v4Location}/localPosts?pageSize=50`, { headers: bearer(token) });
      return Array.isArray(b?.localPosts) ? b.localPosts : [];
    },

    async createPost(token: string, v4Location: string, post: { summary: string; topicType: 'STANDARD' | 'OFFER' | 'EVENT'; cta?: { actionType: string; url?: string }; title?: string; start?: string; end?: string; languageCode: string }) {
      const body: any = { languageCode: post.languageCode, summary: post.summary, topicType: post.topicType };
      if (post.cta && post.cta.actionType !== 'NONE') body.callToAction = { actionType: post.cta.actionType, ...(post.cta.url ? { url: post.cta.url } : {}) };
      if (post.topicType !== 'STANDARD' && post.title && post.start && post.end) {
        const d = (s: string) => { const [y, m, dd] = s.split('-').map(Number); return { year: y, month: m, day: dd }; };
        body.event = { title: post.title, schedule: { startDate: d(post.start), endDate: d(post.end) } };
      }
      return http(`${B.v4}/v4/${v4Location}/localPosts`, { method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    },
  };
}

export type GoogleGateway = ReturnType<typeof createGoogleGateway>;

/** v4 resource path: accounts/{a}/locations/{l}. */
export const v4Location = (accountName: string, locationName: string) => `${accountName}/${locationName}`;
