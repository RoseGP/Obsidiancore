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

export interface GSpecialHours { startDate: string; endDate: string; closed: boolean; open?: string; close?: string }
export interface GServiceItem { label: string; description?: string; category?: string; structuredId?: string }
export interface GLocationMeta {
  placeId?: string; newReviewUri?: string; hasPendingEdits?: boolean; hasGoogleUpdated?: boolean; hasVoiceOfMerchant?: boolean;
  canModifyServiceList?: boolean; canOperateLocalPost?: boolean; duplicateLocation?: string;
}

export interface GLocation {
  name: string; // locations/123
  accountName: string; // accounts/456
  title: string;
  primaryCategory?: string;
  /** Category resource names (categories/gcid:…) for edits. */
  primaryCategoryId?: string;
  additionalCategoryIds?: string[];
  additionalCategories: string[];
  storeCode?: string;
  openStatus?: string;
  specialHours?: GSpecialHours[];
  serviceItems?: GServiceItem[];
  labels?: string[];
  /** Service-area business (may hide its address). */
  hasServiceArea?: boolean;
  meta?: GLocationMeta;
  address?: { lines: string[]; city?: string; region?: string; postalCode?: string; country?: string };
  phone?: string;
  website?: string;
  description?: string;
  regularHours: { day: string; open: string; close: string }[];
  hasSpecialHours: boolean;
  serviceItemCount: number;
  mapsUri?: string;
}

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

export interface GAttribute { name: string; valueType: string; values: any[]; uriValues: string[] }
export interface GAttributeMeta { parent: string; displayName: string; group: string; valueType: string; repeatable: boolean; values: { value: any; displayName: string }[] }
export interface GMedia { name: string; format: string; category: string; createTime: string; googleUrl?: string; thumbnailUrl?: string }

export const DAY_NAMES = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
const ymd = (d: any) => (d?.year ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : '');
const hm = (t: any) => (t ? `${pad(t.hours ?? 0)}:${pad(t.minutes ?? 0)}` : undefined);

function parseLocationExtras(l: any): Partial<GLocation> {
  return {
    primaryCategoryId: l.categories?.primaryCategory?.name,
    additionalCategoryIds: (l.categories?.additionalCategories ?? []).map((c: any) => String(c.name)),
    storeCode: l.storeCode || undefined,
    openStatus: l.openInfo?.status || undefined,
    labels: Array.isArray(l.labels) ? l.labels.map(String) : undefined,
    hasServiceArea: !!(l.serviceArea?.places?.placeInfos?.length || l.serviceArea?.regionCode || l.serviceArea?.businessType === 'CUSTOMER_LOCATION_ONLY'),
    specialHours: (l.specialHours?.specialHourPeriods ?? []).map((p: any) => ({ startDate: ymd(p.startDate), endDate: ymd(p.endDate) || ymd(p.startDate), closed: !!p.closed, open: hm(p.openTime), close: hm(p.closeTime) })),
    serviceItems: (l.serviceItems ?? []).map((it: any) => ({
      label: String(it.freeFormServiceItem?.label?.displayName ?? it.structuredServiceItem?.serviceTypeId ?? ''),
      description: it.freeFormServiceItem?.label?.description ?? it.structuredServiceItem?.description ?? undefined,
      category: it.freeFormServiceItem?.category ?? undefined, structuredId: it.structuredServiceItem?.serviceTypeId ?? undefined,
    })),
    meta: l.metadata ? {
      placeId: l.metadata.placeId, newReviewUri: l.metadata.newReviewUri, hasPendingEdits: !!l.metadata.hasPendingEdits, hasGoogleUpdated: !!l.metadata.hasGoogleUpdated,
      hasVoiceOfMerchant: !!l.metadata.hasVoiceOfMerchant, canModifyServiceList: l.metadata.canModifyServiceList, canOperateLocalPost: l.metadata.canOperateLocalPost, duplicateLocation: l.metadata.duplicateLocation,
    } : undefined,
  };
}

function toLocation(l: any, accountName: string): GLocation {
  return {
    ...parseLocationExtras(l),
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
  };
}

/** Fields this app can change, in the shapes Business Information v1 expects. */
export interface LocationPatch {
  phone?: string;
  website?: string;
  description?: string;
  regularHours?: { day: string; open: string; close: string }[];
  specialHours?: GSpecialHours[];
  primaryCategoryId?: string;
  additionalCategoryIds?: string[];
  serviceItems?: { label: string; description?: string; category: string }[];
}

const toTime = (s?: string) => { const [h, m] = String(s || '00:00').split(':').map(Number); return { hours: h, minutes: m || 0 }; };
const toDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return { year: y, month: m, day: d }; };

export function buildLocationPatch(patch: LocationPatch): { body: any; mask: string[] } {
  const body: any = {}; const mask: string[] = [];
  if (patch.phone !== undefined) { body.phoneNumbers = { primaryPhone: patch.phone }; mask.push('phoneNumbers.primaryPhone'); }
  if (patch.website !== undefined) { body.websiteUri = patch.website; mask.push('websiteUri'); }
  if (patch.description !== undefined) { body.profile = { description: patch.description }; mask.push('profile.description'); }
  if (patch.regularHours !== undefined) {
    body.regularHours = { periods: patch.regularHours.map((p) => ({ openDay: p.day, closeDay: p.close <= p.open && p.close !== '24:00' ? DAY_NAMES[(DAY_NAMES.indexOf(p.day as any) + 1) % 7] : p.day, openTime: toTime(p.open), closeTime: p.close === '24:00' ? { hours: 24 } : toTime(p.close) })) };
    mask.push('regularHours');
  }
  if (patch.specialHours !== undefined) {
    body.specialHours = { specialHourPeriods: patch.specialHours.map((p) => ({ startDate: toDate(p.startDate), endDate: toDate(p.endDate || p.startDate), ...(p.closed ? { closed: true } : { openTime: toTime(p.open), closeTime: toTime(p.close) }) })) };
    mask.push('specialHours');
  }
  if (patch.primaryCategoryId !== undefined || patch.additionalCategoryIds !== undefined) {
    body.categories = {};
    if (patch.primaryCategoryId !== undefined) { body.categories.primaryCategory = { name: patch.primaryCategoryId }; mask.push('categories.primaryCategory'); }
    if (patch.additionalCategoryIds !== undefined) { body.categories.additionalCategories = patch.additionalCategoryIds.map((name) => ({ name })); mask.push('categories.additionalCategories'); }
  }
  if (patch.serviceItems !== undefined) {
    body.serviceItems = patch.serviceItems.map((it) => ({ freeFormServiceItem: { category: it.category, label: { displayName: it.label, ...(it.description ? { description: it.description } : {}), languageCode: 'en' } } }));
    mask.push('serviceItems');
  }
  return { body, mask };
}

export interface GoogleBases { auth: string; oauth: string; accounts: string; info: string; perf: string; v4: string; verify?: string }
export const GOOGLE_BASES: GoogleBases = {
  auth: 'https://accounts.google.com', oauth: 'https://oauth2.googleapis.com', accounts: 'https://mybusinessaccountmanagement.googleapis.com',
  info: 'https://mybusinessbusinessinformation.googleapis.com', perf: 'https://businessprofileperformance.googleapis.com', v4: 'https://mybusiness.googleapis.com',
  verify: 'https://mybusinessverifications.googleapis.com',
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
      const readMask = 'name,title,storeCode,categories,storefrontAddress,phoneNumbers,websiteUri,profile,regularHours,specialHours,serviceItems,openInfo,labels,serviceArea,metadata';
      const out: GLocation[] = [];
      let pageToken = '';
      do {
        const q = new URLSearchParams({ readMask, pageSize: '100', ...(pageToken ? { pageToken } : {}) });
        const b = await http(`${B.info}/v1/${accountName}/locations?${q}`, { headers: bearer(token) });
        for (const l of b?.locations ?? []) out.push(toLocation(l, accountName));
        pageToken = b?.nextPageToken || '';
      } while (pageToken && out.length < 1000);
      return out;
    },

    /**
     * Business Information v1 PATCH with an explicit updateMask. Google may hold edits for review
     * (metadata.hasPendingEdits). `validateOnly` asks Google to check the edit without applying it.
     */
    async patchLocation(token: string, locationName: string, patch: LocationPatch, validateOnly = false) {
      const { body, mask } = buildLocationPatch(patch);
      if (!mask.length) throw new GatewayError('Nothing to change.', 400, 'other');
      const q = new URLSearchParams({ updateMask: mask.join(','), ...(validateOnly ? { validateOnly: 'true' } : {}) });
      return http(`${B.info}/v1/${locationName}?${q}`, {
        method: 'PATCH', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
    },

    /** GET v1/{locations/x}?readMask=… — one location (same fields as listLocations). */
    async getLocation(token: string, accountName: string, locationName: string): Promise<GLocation> {
      const readMask = 'name,title,storeCode,categories,storefrontAddress,phoneNumbers,websiteUri,profile,regularHours,specialHours,serviceItems,openInfo,labels,serviceArea,metadata';
      const l = await http(`${B.info}/v1/${locationName}?${new URLSearchParams({ readMask })}`, { headers: bearer(token) });
      return toLocation(l, accountName);
    },

    /** GET v1/{locations/x}:getGoogleUpdated — the location as Google shows it, with fields Google changed (diffMask) or holds for review (pendingMask). */
    async getGoogleUpdated(token: string, locationName: string): Promise<{ diffMask: string[]; pendingMask: string[]; location: any }> {
      const q = new URLSearchParams({ readMask: 'name,title,categories,storefrontAddress,phoneNumbers,websiteUri,profile,regularHours,specialHours,metadata' });
      const b = await http(`${B.info}/v1/${locationName}:getGoogleUpdated?${q}`, { headers: bearer(token) });
      const split = (m: any) => String(m || '').split(',').map((x) => x.trim()).filter(Boolean);
      return { diffMask: split(b?.diffMask), pendingMask: split(b?.pendingMask), location: b?.location ?? null };
    },

    /** GET v1/{locations/x/attributes} */
    async getAttributes(token: string, locationName: string): Promise<GAttribute[]> {
      const b = await http(`${B.info}/v1/${locationName}/attributes`, { headers: bearer(token) });
      return (b?.attributes ?? []).map((a: any) => ({ name: String(a.name), valueType: String(a.valueType ?? ''), values: Array.isArray(a.values) ? a.values : [], uriValues: (a.uriValues ?? []).map((u: any) => String(u.uri)) }));
    },

    /** GET v1/attributes?parent=locations/x — attributes Google offers for this location's category and region. */
    async listAvailableAttributes(token: string, locationName: string, languageCode = 'en'): Promise<GAttributeMeta[]> {
      const out: GAttributeMeta[] = [];
      let pageToken = '';
      do {
        const q = new URLSearchParams({ parent: locationName, languageCode, pageSize: '200', ...(pageToken ? { pageToken } : {}) });
        const b = await http(`${B.info}/v1/attributes?${q}`, { headers: bearer(token) });
        for (const m of b?.attributeMetadata ?? []) {
          if (m.deprecated) continue;
          out.push({ parent: String(m.parent), displayName: String(m.displayName ?? m.parent), group: String(m.groupDisplayName ?? ''), valueType: String(m.valueType ?? ''), repeatable: !!m.repeatable,
            values: (m.valueMetadata ?? []).map((v: any) => ({ value: v.value, displayName: String(v.displayName ?? v.value) })) });
        }
        pageToken = b?.nextPageToken || '';
      } while (pageToken && out.length < 1000);
      return out;
    },

    /** PATCH v1/{locations/x/attributes}?attributeMask=… — only the listed attributes change. */
    async updateAttributes(token: string, locationName: string, attrs: { name: string; valueType: string; values?: any[]; uriValues?: string[] }[]) {
      const names = attrs.map((a) => a.name.replace(/^.*\/attributes\//, '').replace(/^attributes\//, ''));
      const body = { name: `${locationName}/attributes`, attributes: attrs.map((a, i) => ({
        name: `attributes/${names[i]}`, valueType: a.valueType, ...(a.uriValues ? { uriValues: a.uriValues.map((uri) => ({ uri })) } : { values: a.values ?? [] }),
      })) };
      const q = new URLSearchParams({ attributeMask: names.map((n) => `attributes/${n}`).join(',') });
      return http(`${B.info}/v1/${locationName}/attributes?${q}`, { method: 'PATCH', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    },

    /** GET v1/categories?regionCode&languageCode&filter=displayName=… */
    async searchCategories(token: string, query: string, regionCode = 'US', languageCode = 'en'): Promise<{ name: string; displayName: string }[]> {
      const q = new URLSearchParams({ regionCode, languageCode, view: 'BASIC', pageSize: '20', filter: `displayName=${query}` });
      const b = await http(`${B.info}/v1/categories?${q}`, { headers: bearer(token) });
      return (b?.categories ?? []).map((c: any) => ({ name: String(c.name), displayName: String(c.displayName) }));
    },

    /** Verifications API: GET v1/{locations/x}/VoiceOfMerchantState */
    async voiceOfMerchant(token: string, locationName: string): Promise<{ hasVoiceOfMerchant: boolean; hasBusinessAuthority: boolean; state: string }> {
      const b = await http(`${B.verify || B.info}/v1/${locationName}/VoiceOfMerchantState`, { headers: bearer(token) });
      const state = b?.hasVoiceOfMerchant ? 'verified' : b?.verify ? 'needs_verification' : b?.waitForVoiceOfMerchant ? 'pending' : b?.resolveOwnershipConflict ? 'ownership_conflict' : b?.complyWithGuidelines ? 'suspended_or_guidelines' : 'unknown';
      return { hasVoiceOfMerchant: !!b?.hasVoiceOfMerchant, hasBusinessAuthority: !!b?.hasBusinessAuthority, state };
    },

    /** Performance API: monthly search keyword impressions (Google withholds small counts and reports a threshold instead). */
    async searchKeywords(token: string, locationName: string, from: { year: number; month: number }, to: { year: number; month: number }): Promise<{ keyword: string; value: number | null; threshold: number | null }[]> {
      const out: { keyword: string; value: number | null; threshold: number | null }[] = [];
      let pageToken = '';
      do {
        const q = new URLSearchParams({
          'monthlyRange.startMonth.year': String(from.year), 'monthlyRange.startMonth.month': String(from.month),
          'monthlyRange.endMonth.year': String(to.year), 'monthlyRange.endMonth.month': String(to.month), pageSize: '100', ...(pageToken ? { pageToken } : {}),
        });
        const b = await http(`${B.perf}/v1/${locationName}/searchkeywords/impressions/monthly?${q}`, { headers: bearer(token) });
        for (const k of b?.searchKeywordsCounts ?? []) {
          out.push({ keyword: String(k.searchKeyword), value: k.insightsValue?.value != null ? Number(k.insightsValue.value) : null, threshold: k.insightsValue?.threshold != null ? Number(k.insightsValue.threshold) : null });
        }
        pageToken = b?.nextPageToken || '';
      } while (pageToken && out.length < 500);
      return out;
    },

    /** v4 media list: accounts/{a}/locations/{l}/media */
    async listMedia(token: string, v4Location: string): Promise<GMedia[]> {
      const out: GMedia[] = [];
      let pageToken = '';
      do {
        const q = new URLSearchParams({ pageSize: '100', ...(pageToken ? { pageToken } : {}) });
        const b = await http(`${B.v4}/v4/${v4Location}/media?${q}`, { headers: bearer(token) });
        for (const m of b?.mediaItems ?? []) {
          out.push({ name: String(m.name), format: String(m.mediaFormat ?? 'PHOTO'), category: String(m.locationAssociation?.category ?? ''), createTime: String(m.createTime ?? ''),
            googleUrl: typeof m.googleUrl === 'string' && m.googleUrl.startsWith('https://') ? m.googleUrl : undefined, thumbnailUrl: typeof m.thumbnailUrl === 'string' && m.thumbnailUrl.startsWith('https://') ? m.thumbnailUrl : undefined });
        }
        pageToken = b?.nextPageToken || '';
      } while (pageToken && out.length < 500);
      return out;
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
