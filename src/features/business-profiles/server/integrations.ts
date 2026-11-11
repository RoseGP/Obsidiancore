/**
 * Listing integrations (server only): the boundary between the CRM's profile record and
 * external directories.
 *
 * Rules for every provider:
 * - Official, authorized APIs only (OAuth on behalf of the signed-in user). No scraping.
 * - Never fabricate results: when a provider isn't configured or connected, say so.
 * - Reads produce a timestamped snapshot; writes happen only via a previewed, confirmed publish
 *   and only for the fields the provider's API supports.
 *
 * Google Business Profile reuses the existing Local SEO connection (features/gbp): the user
 * connects Google once in the Local GBP tab; this module reads locations and publishes through
 * that service, so tokens never leave it.
 */
import type { ListingSnapshot, PublishableField } from '../domain/types';
import type { GbpService } from '../../gbp/server/service';

export interface ProviderStatus {
  provider: string;
  label: string;
  /** Server has credentials for this integration. */
  configured: boolean;
  /** The signed-in user has authorised access. */
  connected: boolean;
  needsReconnect?: boolean;
  account?: string;
  detail: string;
  publishableFields: PublishableField[];
}

export interface LinkableListing { externalId: string; title: string; address?: string; selected: boolean }

export interface ListingProvider {
  id: 'google_business_profile';
  label: string;
  publishableFields: PublishableField[];
  status(userId: string): Promise<ProviderStatus>;
  /** Listings the user can link (from the provider's API data already synced for this user). */
  listLinkable(userId: string): Promise<LinkableListing[]>;
  /** Reads the listing. `refresh` re-reads from the provider's API (quota-sensitive). */
  snapshot(userId: string, externalId: string, refresh: boolean): Promise<{ title: string; snapshot: ListingSnapshot }>;
  publish(userId: string, externalId: string, patch: Partial<Record<PublishableField, string>>): Promise<void>;
}

export class IntegrationError extends Error { constructor(message: string, public status: number, public code: string) { super(message); } }

export function googleBusinessProfileProvider(gbp: GbpService): ListingProvider {
  const map = (l: any): ListingSnapshot => ({
    name: l.title || undefined, primaryCategory: l.primaryCategory, additionalCategories: l.additionalCategories, phone: l.phone, website: l.website,
    description: l.description ?? '', addressLines: l.address?.lines, city: l.address?.city, region: l.address?.region, postalCode: l.address?.postalCode, country: l.address?.country,
    hours: l.regularHours, hasSpecialHours: l.hasSpecialHours, serviceCount: l.serviceItemCount, mapsUri: l.mapsUri,
  });
  const fields: PublishableField[] = ['phone', 'website', 'description'];
  return {
    id: 'google_business_profile',
    label: 'Google Business Profile',
    publishableFields: fields,
    async status(userId) {
      const c = await gbp.connection(userId);
      const detail = !c.configured ? 'Not configured on the server. An administrator must add Google OAuth credentials (see docs/business-profiles/README.md).'
        : c.needsReconnect ? 'Google access expired or was revoked. Reconnect in the Local GBP tab.'
          : !c.connected ? 'Not connected. Connect your Google account in the Local GBP tab, then choose the locations you manage.'
            : c.selectedCount === 0 ? 'Connected, but no locations are selected. Choose locations in the Local GBP tab.'
              : `Connected${c.email ? ` as ${c.email}` : ''}. ${c.selectedCount} location${c.selectedCount === 1 ? '' : 's'} available.`;
      return { provider: 'google_business_profile', label: 'Google Business Profile', configured: c.configured, connected: c.connected, needsReconnect: c.needsReconnect, account: c.email, detail, publishableFields: fields };
    },
    async listLinkable(userId) {
      const c = await gbp.connection(userId);
      if (!c.configured || !c.connected) return [];
      return (await gbp.listLocations(userId)).map((l: any) => ({ externalId: l.name, title: l.title, address: [...(l.address?.lines ?? []), l.address?.city].filter(Boolean).join(', ') || undefined, selected: l.selected }));
    },
    async snapshot(userId, externalId, refresh) {
      const c = await gbp.connection(userId);
      if (!c.configured) throw new IntegrationError('Google Business Profile isn’t configured on the server.', 503, 'not_configured');
      if (!c.connected) throw new IntegrationError(c.needsReconnect ? 'Google access expired. Reconnect in the Local GBP tab.' : 'Connect Google Business Profile in the Local GBP tab first.', 409, c.needsReconnect ? 'reconnect_required' : 'not_connected');
      const list: any[] = refresh ? await gbp.discoverLocations(userId) : await gbp.listLocations(userId);
      const l = list.find((x) => x.name === externalId);
      if (!l) throw new IntegrationError('That Google location isn’t available on your connected Google account.', 404, 'listing_not_found');
      if (!l.selected) throw new IntegrationError('Select this location in the Local GBP tab before linking or publishing it.', 409, 'listing_not_selected');
      return { title: l.title, snapshot: map(l) };
    },
    async publish(userId, externalId, patch) {
      await gbp.updateProfile(userId, externalId, patch);
    },
  };
}
