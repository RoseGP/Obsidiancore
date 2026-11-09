/**
 * Live data for the Local SEO (Google Business Profile) tab. Replaces the
 * former mockData seed: everything here comes from /api/local-seo.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getApiAuthHeaders } from '../../../lib/apiAuth';
import type { LocationItem, PostItem, ReviewItem, SeoOpportunity } from '../types';

export class LocalSeoError extends Error { constructor(message: string, public status: number, public code: string, public field?: string) { super(message); } }

async function call<T>(devUser: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/local-seo${path}`, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(await getApiAuthHeaders(devUser)), ...(init.headers || {}) } });
  } catch { throw new LocalSeoError('Can’t reach the server.', 0, 'network'); }
  let body: any = null; try { body = await res.json(); } catch { /* */ }
  if (!res.ok) throw new LocalSeoError(body?.error || `Request failed (${res.status}).`, res.status, body?.code || 'server', body?.field);
  return body as T;
}

export interface Connection { configured: boolean; aiConfigured: boolean; connected: boolean; needsReconnect: boolean; email?: string; selectedCount: number; lastSync?: { at: string; reviews: number; errors: string[] }; settings?: { brandVoice?: 'friendly' | 'professional' | 'casual' | 'luxury'; signOff?: string } }

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
function toLocation(o: any): LocationItem {
  const l = o.location; const a = o.audit;
  const hours: any = {};
  for (const d of DAYS) {
    const ps = (l.regularHours || []).filter((p: any) => p.day === d);
    hours[d.toLowerCase()] = ps.length ? ps.map((p: any) => `${p.open}–${p.close}`).join(', ') : (l.regularHours?.length ? 'Closed' : 'Not set');
  }
  return {
    id: l.name, name: l.title, category: l.primaryCategory || 'No category', address: (l.address?.lines || []).join(', '), city: l.address?.city || '', state: l.address?.region || '', zip: l.address?.postalCode || '',
    phone: l.phone || '', website: l.website || '',
    status: a.score >= 80 ? 'Healthy' : a.score >= 50 ? 'Needs Attention' : 'Critical',
    // Profile health is this app's diagnostic (see server/service.ts auditLocation), not a Google metric.
    visibilityScore: a.score, visibilityChange: 0,
    rating: o.averageRating ?? 0, reviewsCount: o.reviewCount, unansweredReviewsCount: o.unanswered,
    profileCompleteness: a.score, securityScore: 0, openIssuesCount: a.checks.filter((c: any) => !c.passed).length,
    lastSync: '', hours,
    // Not fetched in this phase (Google media and attributes APIs aren't wired yet): left empty, never invented.
    services: [], missingServices: [],
    attributes: { wheelchairAccessible: false, outdoorSeating: false, freeWifi: false, curbsidePickup: false, delivery: false, creditCards: false },
    photosCount: 0, lastPhotoAdded: '',
    auditChecks: a.checks.map((c: any) => ({ id: c.id, group: c.group, label: c.label, passed: !!c.passed })),
    hasRating: o.averageRating != null,
  } as LocationItem;
}

function toReview(r: any): ReviewItem {
  return {
    id: r.id, locationId: r.locationName, locationName: r.locationTitle, authorName: r.reviewer, authorAvatar: r.reviewerPhoto || '',
    rating: r.rating, date: new Date(r.createTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), createdAt: r.createTime,
    content: r.comment, sentiment: r.sentiment, topics: r.topics, status: r.reply ? 'answered' : 'unanswered',
    reply: r.reply ? { text: r.reply.comment, repliedAt: new Date(r.reply.updateTime).toLocaleDateString(), author: 'Owner' } : undefined,
    suggestedAiReply: r.draft?.text, aiThemes: r.topics,
  };
}

function toOpportunities(o: any): SeoOpportunity[] {
  return o.audit.checks.filter((c: any) => !c.passed && c.fix).map((c: any) => ({
    id: `${o.location.name}:${c.id}`, title: c.fix.title, description: c.fix.description, category: c.fix.category, impact: c.fix.impact, effort: c.fix.effort,
    estimatedTime: c.fix.effort === 'Low' ? 'about 5 min' : c.fix.effort === 'Medium' ? 'about 20 min' : 'about 1 hr', locationId: o.location.name, locationName: o.location.title,
    actionType: c.fix.actionType, actionLabel: c.fix.actionLabel,
  }));
}

function useLocalSeoState(devUser: string) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [opportunities, setOpportunities] = useState<SeoOpportunity[]>([]);
  const [activity, setActivity] = useState<{ at: string; type: string; message: string }[]>([]);
  const [discovered, setDiscovered] = useState<any[]>([]);
  const api = useMemo(() => <T,>(p: string, i?: RequestInit) => call<T>(devUser, p, i), [devUser]);

  const reload = useCallback(async () => {
    setError('');
    try {
      const c = await api<Connection>('/connection');
      setConnection(c);
      if (!c.connected) { setLocations([]); setReviews([]); setOpportunities([]); setStatus('ready'); return; }
      const [ov, rv, ls] = await Promise.all([api<any>('/overview'), api<any[]>('/reviews'), api<any[]>('/locations')]);
      setLocations(ov.locations.map(toLocation));
      setOpportunities(ov.locations.flatMap(toOpportunities));
      setActivity(ov.activity);
      setReviews(rv.map(toReview));
      setDiscovered(ls);
      setStatus('ready');
    } catch (e: any) { setError(e?.message || 'Local SEO data couldn’t load.'); setStatus('error'); }
  }, [api]);

  useEffect(() => { void reload(); }, [reload]);

  return {
    status, error, connection, locations, reviews, opportunities, activity, discovered, reload, setReviews,
    async connect() { const { url } = await api<{ url: string }>('/connect', { method: 'POST' }); window.location.assign(url); },
    async disconnect() { const r = await api<{ revokedAtGoogle: boolean }>('/connection', { method: 'DELETE' }); await reload(); return r; },
    async discover() { const l = await api<any[]>('/locations/discover', { method: 'POST' }); setDiscovered(l); return l; },
    async select(names: string[]) { await api('/locations/selection', { method: 'PUT', body: JSON.stringify({ locationNames: names }) }); await api('/sync', { method: 'POST' }); await reload(); },
    async sync() { const r = await api<{ reviews: number; errors: string[] }>('/sync', { method: 'POST' }); await reload(); return r; },
    async draftReply(reviewId: string, tone?: string) { return api<{ text: string; flags: string[] }>(`/reviews/${reviewId}/draft`, { method: 'POST', body: JSON.stringify(tone ? { tone } : {}) }); },
    async publishReply(reviewId: string, comment: string) {
      const r = await api<any>(`/reviews/${reviewId}/reply`, { method: 'PUT', body: JSON.stringify({ comment }) });
      setReviews((prev) => prev.map((x) => (x.id === reviewId ? toReview(r) : x)));
      return r;
    },
    async updateProfile(location: string, patch: { phone?: string; website?: string; description?: string }) { await api('/locations/profile', { method: 'PATCH', body: JSON.stringify({ location, ...patch }) }); await reload(); },
    async createPost(location: string, p: { summary: string; topicType: string; ctaType: string; ctaUrl?: string; title?: string; startDate?: string; endDate?: string }) { return api<any>('/posts', { method: 'POST', body: JSON.stringify({ location, ...p }) }); },
    async listPosts(location: string): Promise<PostItem[]> {
      const raw = await api<any[]>(`/posts?location=${encodeURIComponent(location)}`);
      return raw.map((p) => ({ id: p.id, locationId: location, locationName: '', type: p.topicType === 'OFFER' ? 'Offer' : p.topicType === 'EVENT' ? 'Event' : 'Update', content: p.summary, ctaType: (p.cta?.actionType || 'NONE') as any, ctaUrl: p.cta?.url, status: 'Published', publishedAt: p.createTime ? new Date(p.createTime).toLocaleDateString() : undefined, createdAt: p.createTime || undefined }));
    },
    async saveSettings(settings: { brandVoice?: 'friendly' | 'professional' | 'casual' | 'luxury'; signOff?: string }) { await api('/settings', { method: 'PUT', body: JSON.stringify(settings) }); await reload(); },
    async performance(location: string, days: number) { return api<any>(`/performance?location=${encodeURIComponent(location)}&days=${days}`); },
  };
}

export type LocalSeo = ReturnType<typeof useLocalSeoState>;
const Ctx = createContext<LocalSeo | null>(null);
export function LocalSeoProvider({ devUser, children }: { devUser: string; children: React.ReactNode }) {
  const v = useLocalSeoState(devUser);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export function useLocalSeo() { const v = useContext(Ctx); if (!v) throw new Error('useLocalSeo outside provider'); return v; }
export const useOptionalLocalSeo = () => useContext(Ctx);
