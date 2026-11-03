/**
 * Google Places API (New) — public business information for competitor lookups.
 * POST https://places.googleapis.com/v1/places:searchText (X-Goog-Api-Key, X-Goog-FieldMask),
 * GET  https://places.googleapis.com/v1/places/{id}. Verified against googleapis@178 (places/v1).
 *
 * Requires GOOGLE_PLACES_API_KEY with the Places API (New) enabled. Places content may only be
 * cached for up to 30 days (Google Maps Platform terms); place ids may be kept indefinitely.
 */
import { GatewayError } from '../../social-accounts/server/gateway';

export interface PublicPlace {
  placeId: string;
  name: string;
  address: string;
  primaryType: string;
  types: string[];
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
  mapsUrl: string | null;
  photoCount: number;
  summary: string | null;
  hasHours: boolean;
}

const FIELDS = ['id', 'displayName', 'formattedAddress', 'primaryTypeDisplayName', 'types', 'rating', 'userRatingCount', 'websiteUri', 'googleMapsUri', 'photos', 'editorialSummary', 'regularOpeningHours'];

function toPlace(p: any): PublicPlace {
  return {
    placeId: String(p.id ?? ''), name: String(p.displayName?.text ?? ''), address: String(p.formattedAddress ?? ''),
    primaryType: String(p.primaryTypeDisplayName?.text ?? ''), types: Array.isArray(p.types) ? p.types.map(String) : [],
    rating: typeof p.rating === 'number' ? p.rating : null, reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    website: typeof p.websiteUri === 'string' ? p.websiteUri : null, mapsUrl: typeof p.googleMapsUri === 'string' ? p.googleMapsUri : null,
    photoCount: Array.isArray(p.photos) ? p.photos.length : 0, summary: p.editorialSummary?.text ?? null, hasHours: !!p.regularOpeningHours,
  };
}

export function createPlacesClient(apiKey: string, base = 'https://places.googleapis.com') {
  async function req(path: string, init: RequestInit, mask: string) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { ...init, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': mask, ...(init.headers || {}) } });
    } catch { throw new GatewayError('Google Places couldn’t be reached.', 0, 'unavailable'); }
    finally { clearTimeout(t); }
    const body: any = await res.json().catch(() => null);
    if (!res.ok) throw new GatewayError(String(body?.error?.message ?? `Places returned ${res.status}.`).slice(0, 300), res.status, res.status === 403 ? 'not_allowed' : res.status === 429 ? 'unavailable' : 'other');
    return body;
  }
  return {
    configured: !!apiKey,
    async searchText(textQuery: string, max = 5): Promise<PublicPlace[]> {
      const b = await req('/v1/places:searchText', { method: 'POST', body: JSON.stringify({ textQuery, pageSize: Math.min(10, max) }) }, FIELDS.map((f) => `places.${f}`).join(','));
      return (b?.places ?? []).map(toPlace);
    },
    async get(placeId: string): Promise<PublicPlace> {
      if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) throw new GatewayError('Invalid place id.', 400, 'other');
      return toPlace(await req(`/v1/places/${placeId}`, { method: 'GET' }, FIELDS.join(',')));
    },
  };
}

export type PlacesClient = ReturnType<typeof createPlacesClient>;
