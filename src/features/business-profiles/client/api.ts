/** Browser client for /api/business-profiles. Auth headers come from the shared API auth helper. */
import { getApiAuthHeaders } from '../../../lib/apiAuth';
import type { AuditResult, BusinessProfile, BusinessProfileData, ProfileSummaryView, PublishableField, Role, Suggestion, SuggestionKind } from '../domain/types';

export class ApiError extends Error { constructor(message: string, public status: number, public code: string, public field?: string) { super(message); } }

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  let res: Response;
  const { json, ...rest } = init;
  try {
    res = await fetch(`/api/business-profiles${path}`, {
      ...rest, credentials: 'same-origin',
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(await getApiAuthHeaders()), ...(rest.headers || {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch { throw new ApiError('Can’t reach the server. Check your connection and try again.', 0, 'network'); }
  let body: any = null; try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const retry = res.headers.get('Retry-After');
    throw new ApiError((body?.error || `Request failed (${res.status}).`) + (res.status === 429 && retry ? ` (retry in ${retry}s)` : ''), res.status, body?.code || 'server', body?.field);
  }
  return body as T;
}

export interface ProfileView extends BusinessProfile {
  role: Role;
  permissions: { edit: boolean; publish: boolean; manageMembers: boolean };
  liveAudit: AuditResult;
  auditStale: boolean;
  stale: string[];
}
export interface ProviderStatus { provider: string; label: string; configured: boolean; connected: boolean; needsReconnect?: boolean; account?: string; detail: string; publishableFields: PublishableField[] }
export interface LinkableListing { externalId: string; title: string; address?: string; selected: boolean }
export interface PublishPreview {
  provider: string; listing: { externalId: string; title: string }; snapshotAt: string;
  changes: { field: PublishableField; label: string; current: string; proposed: string }[];
  skipped: { field: PublishableField; reason: string }[]; warnings: string[]; unsupported: string; confirmToken: string | null; expiresAt: string;
}

const GBP = 'google_business_profile';
export const bpApi = {
  list: () => call<{ profiles: ProfileSummaryView[]; aiConfigured: boolean }>('/'),
  create: (data: BusinessProfileData, source: 'manual' | 'import' = 'manual') => call<ProfileView>('/', { method: 'POST', json: { data, source } }),
  get: (id: string) => call<ProfileView>(`/${encodeURIComponent(id)}`),
  update: (id: string, version: number, data: BusinessProfileData, extra: { suggestionId?: string; note?: string } = {}) => call<ProfileView>(`/${encodeURIComponent(id)}`, { method: 'PUT', json: { version, data, ...extra } }),
  setStatus: (id: string, version: number, status: BusinessProfile['status']) => call<ProfileView>(`/${encodeURIComponent(id)}/status`, { method: 'PATCH', json: { version, status } }),
  review: (id: string, version: number, scope: 'profile' | 'hours') => call<ProfileView>(`/${encodeURIComponent(id)}/review`, { method: 'POST', json: { version, scope } }),
  remove: (id: string, confirmName: string) => call<{ deleted: boolean }>(`/${encodeURIComponent(id)}`, { method: 'DELETE', json: { confirmName } }),
  runAudit: (id: string) => call<ProfileView>(`/${encodeURIComponent(id)}/audits`, { method: 'POST', json: {} }),
  suggest: (id: string, kind: SuggestionKind, tone: string, notes?: string) => call<Suggestion>(`/${encodeURIComponent(id)}/suggestions`, { method: 'POST', json: { kind, tone, notes: notes || undefined } }),
  dismiss: (id: string, sid: string) => call<{ dismissed: boolean }>(`/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(sid)}`, { method: 'DELETE' }),
  setMember: (id: string, userId: string, role: Role | null) => call<ProfileView | { removedSelf: true }>(`/${encodeURIComponent(id)}/members`, { method: 'PUT', json: { userId, role } }),
  integrations: () => call<ProviderStatus[]>('/integrations'),
  linkable: () => call<LinkableListing[]>(`/integrations/${GBP}/listings`),
  importDraft: (externalId: string) => call<BusinessProfileData & { _source?: unknown }>(`/integrations/${GBP}/import`, { method: 'POST', json: { externalId } }),
  link: (id: string, version: number, externalId: string) => call<ProfileView>(`/${encodeURIComponent(id)}/listings`, { method: 'POST', json: { version, provider: GBP, externalId } }),
  unlink: (id: string, version: number) => call<ProfileView>(`/${encodeURIComponent(id)}/listings/${GBP}`, { method: 'DELETE', json: { version } }),
  refresh: (id: string) => call<ProfileView>(`/${encodeURIComponent(id)}/listings/${GBP}/refresh`, { method: 'POST', json: {} }),
  preview: (id: string, fields?: PublishableField[]) => call<PublishPreview>(`/${encodeURIComponent(id)}/publish/preview`, { method: 'POST', json: { provider: GBP, fields } }),
  publish: (id: string, confirmToken: string) => call<ProfileView>(`/${encodeURIComponent(id)}/publish`, { method: 'POST', json: { provider: GBP, confirmToken, confirm: true } }),
};
