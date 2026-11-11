/**
 * Business Profile Manager: business logic (server only, no Express).
 *
 * Profiles belong to an organization (organizations/{orgId}/business_profiles). Access follows the org
 * RBAC matrix, module `listings` (src/server/security/permissions.ts); the router checks it with
 * requireAccess() and this service checks it again (defence in depth). The actor comes from the
 * resolved tenant, never from the request body. Profiles of other organizations are simply not found.
 * Every data mutation bumps `version` (optimistic concurrency) and appends a change-log entry;
 * security-relevant actions also go to the organization's audit log.
 */
import crypto from 'node:crypto';
import { AccountsError } from '../../social-accounts/server/service';
import { auditIsStale, auditProfile, staleFlags } from '../domain/audit';
import { diffProfiles, FIELD_LABELS } from '../domain/diff';
import type { AuditResult, BusinessProfile, BusinessProfileData, ChangeEntry, ChangeSource, ListingLink, ProfilePermissions, ProfileStatus, ProfileSummaryView, PublishableField, Suggestion, SuggestionKind } from '../domain/types';
import { canAccess, type Permission } from '../../../server/security/permissions';
import { recordAudit, type AuditInput } from '../../../server/audit/auditLog';
import { AssistantError, type Assistant, type Tone } from './assistant';
import { IntegrationError, type ListingProvider } from './integrations';
import { MAX_PROFILES_PER_ORG, NotFound, type ProfileStore } from './store';

/** The caller, from the resolved tenant (req.tenant). */
export interface Actor { orgId: string; userId: string; role: string; email?: string; ip?: string }

const PREVIEW_TTL = 10 * 60_000;

const rid = (prefix: string, bytes = 12) => `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
const fail = (message: string, status: number, code: string, field?: string) => new AccountsError(message, status, code, field);

export interface ServiceDeps { store: ProfileStore; assistant: Assistant; providers: ListingProvider[]; signingKey: Buffer | null; now?: () => Date; audit?: (orgId: string, e: AuditInput) => Promise<unknown> }

export function createBusinessProfilesService(deps: ServiceDeps) {
  const { store, assistant } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const iso = () => now().toISOString();

  // ---------- Access ----------

  const audit_ = deps.audit ?? recordAudit;
  const logAudit = (a: Actor, action: string, p: { id: string; data: { name: string } }, meta?: Record<string, unknown>) =>
    audit_(a.orgId, { actorId: a.userId, actorEmail: a.email, ip: a.ip, action: `business_profile.${action}`, target: { type: 'business_profile', id: p.id, label: p.data.name }, meta }).catch(() => undefined);
  const allowed = (a: Actor, perm: Permission) => canAccess(a.role, 'listings', perm);
  const WHAT: Record<Permission, string> = { view: 'view business profiles', create: 'create business profiles', edit: 'edit business profiles', share: 'link or publish listings', delete: 'delete business profiles', export: 'export business profiles', manage: 'manage business profiles' };
  const need = (a: Actor, perm: Permission) => { if (!allowed(a, perm)) throw fail(`Your role (${a.role}) can’t ${WHAT[perm]}. Ask an admin for access.`, 403, 'forbidden'); };
  const permissions = (a: Actor): ProfilePermissions => ({ create: allowed(a, 'create'), edit: allowed(a, 'edit'), publish: allowed(a, 'share'), delete: allowed(a, 'delete') });

  async function load(a: Actor, id: string): Promise<BusinessProfile> {
    need(a, 'view');
    const p = await store.get(a.orgId, id);
    if (!p || p.orgId !== a.orgId) throw fail('Business profile not found.', 404, 'not_found');
    return p;
  }

  /** Read-modify-write with permission and version checks inside the store's transaction. */
  function mutate<T>(a: Actor, id: string, perm: Permission, version: number | null, fn: (p: BusinessProfile) => T): Promise<T> {
    need(a, perm);
    return store.update(a.orgId, id, (p) => {
      if (p.orgId !== a.orgId) throw fail('Business profile not found.', 404, 'not_found');
      if (version !== null && p.version !== version) throw fail('This profile was changed by someone else since you opened it. Reload to see the latest version, then reapply your edits.', 409, 'version_conflict');
      return fn(p);
    }).catch((e) => { if (e instanceof NotFound) throw fail('Business profile not found.', 404, 'not_found'); throw e; });
  }

  function record(p: BusinessProfile, uid: string, e: Omit<ChangeEntry, 'id' | 'at' | 'by' | 'version'>, bump = true) {
    if (bump) p.version += 1;
    p.updatedAt = iso(); p.updatedBy = uid;
    p.changes.push({ id: rid('ch', 6), at: p.updatedAt, by: uid, version: p.version, ...e });
  }

  const audit = (p: BusinessProfile): AuditResult => auditProfile({ data: p.data, version: p.version, hoursVerifiedAt: p.hoursVerifiedAt, lastReviewedAt: p.lastReviewedAt, listing: p.listings[0] }, now());

  function view(p: BusinessProfile, a: Actor) {
    return {
      ...p,
      role: a.role,
      permissions: permissions(a),
      liveAudit: audit(p),
      auditStale: auditIsStale(p, now().getTime()),
      stale: staleFlags(p, now().getTime()),
      changes: p.changes.slice().reverse(),
      audits: p.audits.slice().reverse(),
      publishLog: p.publishLog.slice().reverse(),
      suggestions: p.suggestions.filter((s) => s.status === 'pending').reverse(),
    };
  }
  function summary(p: BusinessProfile): ProfileSummaryView {
    const a = audit(p);
    return {
      id: p.id, name: p.data.name, primaryCategory: p.data.primaryCategory, city: p.data.hideAddress ? p.data.serviceAreas[0] : p.data.address?.city, status: p.status,
      version: p.version, updatedAt: p.updatedAt, score: a.score, completeness: a.completeness, counts: a.counts, topIssue: a.priorities[0]?.title,
      lastAuditAt: p.lastAudit?.ranAt, auditStale: auditIsStale(p, now().getTime()), stale: staleFlags(p, now().getTime()), linked: p.listings.length > 0,
    };
  }
  const summarize = (p: BusinessProfile, a: AuditResult, by: string) => ({ id: rid('au', 6), ranAt: a.ranAt, ranBy: by, profileVersion: p.version, score: a.score, completeness: a.completeness, coverage: a.coverage, counts: a.counts, topIssues: a.priorities.slice(0, 3).map((f) => f.title) });

  // ---------- Profiles ----------

  async function list(a: Actor) {
    need(a, 'view');
    const ps = (await store.list(a.orgId)).filter((p) => p.orgId === a.orgId);
    return {
      profiles: ps.map(summary).sort((x, y) => Number(x.status === 'archived') - Number(y.status === 'archived') || x.score - y.score || x.name.localeCompare(y.name)),
      permissions: permissions(a), role: a.role,
    };
  }

  async function get(a: Actor, id: string) { return view(await load(a, id), a); }

  async function create(a: Actor, data: BusinessProfileData, source: ChangeSource = 'manual') {
    need(a, 'create');
    if ((await store.list(a.orgId)).length >= MAX_PROFILES_PER_ORG) throw fail(`An organization can have at most ${MAX_PROFILES_PER_ORG} business profiles.`, 409, 'limit_reached');
    const at = iso();
    const p: BusinessProfile = {
      id: rid('bp'), orgId: a.orgId, status: 'draft', version: 1, data, createdAt: at, createdBy: a.userId, updatedAt: at, updatedBy: a.userId,
      audits: [], changes: [], suggestions: [], listings: [], publishLog: [],
    };
    p.changes.push({ id: rid('ch', 6), at, by: a.userId, version: 1, action: 'create', source, summary: source === 'import' ? 'Created from a linked listing' : 'Created profile' });
    const r = audit(p); p.lastAudit = r; p.audits.push(summarize(p, r, 'system'));
    await store.create(p);
    await logAudit(a, 'create', p, { source });
    return view(p, a);
  }

  async function update(a: Actor, id: string, input: { version: number; data: BusinessProfileData; suggestionId?: string; note?: string }) {
    const p = await mutate(a, id, 'edit', input.version, (p) => {
      const fields = diffProfiles(p.data, input.data);
      if (!fields.length) throw fail('No changes to save.', 400, 'no_changes');
      let source: ChangeSource = 'manual';
      if (input.suggestionId) {
        const s = p.suggestions.find((x) => x.id === input.suggestionId && x.status === 'pending');
        if (s) { s.status = 'applied'; source = 'ai_suggestion'; }
      }
      if (fields.some((f) => f.field === 'hours')) delete p.hoursVerifiedAt; // edited hours need confirming again
      p.data = input.data;
      record(p, a.userId, { action: 'update', source, summary: `${source === 'ai_suggestion' ? 'Applied reviewed AI suggestion: ' : ''}Updated ${fields.map((f) => FIELD_LABELS[f.field] ?? f.field).join(', ')}${input.note ? ` — ${input.note}` : ''}`, fields });
      return p;
    });
    return view(p, a);
  }

  async function setStatus(a: Actor, id: string, input: { version: number; status: ProfileStatus }) {
    const cur = await load(a, id);
    // Archiving and restoring need `share` (manager level); draft ⇄ active needs `edit`.
    const perm: Permission = input.status === 'archived' || cur.status === 'archived' ? 'share' : 'edit';
    const p = await mutate(a, id, perm, input.version, (p) => {
      if (p.status === input.status) throw fail(`The profile is already ${input.status}.`, 400, 'no_changes');
      const from = p.status; p.status = input.status;
      record(p, a.userId, { action: 'status', source: 'manual', summary: `Status changed from ${from} to ${input.status}`, fields: [{ field: 'status', before: from, after: input.status }] });
      return p;
    });
    if (input.status === 'archived' || cur.status === 'archived') await logAudit(a, input.status === 'archived' ? 'archive' : 'restore', p);
    return view(p, a);
  }

  async function markReviewed(a: Actor, id: string, input: { version: number; scope: 'profile' | 'hours' }) {
    const p = await mutate(a, id, 'edit', input.version, (p) => {
      const at = iso();
      if (input.scope === 'hours') {
        if (!Object.keys(p.data.hours).length) throw fail('Add opening hours before confirming them.', 400, 'invalid_input', 'hours');
        p.hoursVerifiedAt = at;
      } else { p.lastReviewedAt = at; p.lastReviewedBy = a.userId; if (Object.keys(p.data.hours).length) p.hoursVerifiedAt = at; }
      record(p, a.userId, { action: 'review', source: 'review', summary: input.scope === 'hours' ? 'Confirmed opening hours are correct' : 'Marked the whole profile as reviewed and accurate' });
      return p;
    });
    return view(p, a);
  }

  async function remove(a: Actor, id: string, confirmName: string) {
    need(a, 'delete');
    const p = await load(a, id);
    if (confirmName.trim() !== p.data.name) throw fail('Type the business name exactly to confirm deletion.', 400, 'confirmation_required', 'confirmName');
    await store.remove(a.orgId, id);
    await logAudit(a, 'delete', p);
    return { deleted: true };
  }

  // ---------- Audits ----------

  async function runAudit(a: Actor, id: string) {
    const p = await mutate(a, id, 'edit', null, (p) => { const r = audit(p); p.lastAudit = r; p.audits.push(summarize(p, r, a.userId)); return p; });
    return view(p, a);
  }

  // ---------- AI suggestions (review required; never saved to the profile automatically) ----------

  async function suggest(a: Actor, id: string, input: { kind: SuggestionKind; tone: Tone; notes?: string }) {
    need(a, 'edit');
    const p = await load(a, id);
    let out: { text?: string; services?: Suggestion['services']; flags: string[]; factsUsed: string[]; model?: string };
    try { out = input.kind === 'description' ? await assistant.description(p.data, input) : await assistant.services(p.data, input); }
    catch (e) { if (e instanceof AssistantError) throw fail(e.message, e.status, e.code); throw e; }
    const { model, ...rest } = out;
    const s: Suggestion = { id: rid('sg', 8), kind: input.kind, createdAt: iso(), createdBy: a.userId, basedOnVersion: p.version, ...rest, status: 'pending', model: model || assistant.model };
    await mutate(a, id, 'edit', null, (x) => { x.suggestions.push(s); });
    return s;
  }

  async function dismissSuggestion(a: Actor, id: string, sid: string) {
    await mutate(a, id, 'edit', null, (p) => {
      const s = p.suggestions.find((x) => x.id === sid);
      if (!s) throw fail('Suggestion not found.', 404, 'not_found');
      s.status = 'dismissed';
    });
    return { dismissed: true };
  }

  // ---------- Listings (integration boundary) ----------

  const provider = (id: string) => {
    const pr = deps.providers.find((x) => x.id === id);
    if (!pr) throw fail('Unknown integration.', 400, 'invalid_input');
    return pr;
  };
  const wrapI = async <T,>(fn: () => Promise<T>) => { try { return await fn(); } catch (e) { if (e instanceof IntegrationError) throw fail(e.message, e.status, e.code); throw e; } };

  async function integrations(a: Actor) {
    need(a, 'view');
    return Promise.all(deps.providers.map(async (pr) => {
      try { return await pr.status(a.userId); }
      catch { return { provider: pr.id, label: pr.label, configured: false, connected: false, detail: 'Status could not be checked right now.', publishableFields: pr.publishableFields }; }
    }));
  }
  async function linkable(a: Actor, providerId: string) { need(a, 'view'); return wrapI(() => provider(providerId).listLinkable(a.userId)); }

  /** Draft profile data from a listing, for the user to review in the form. Nothing is saved. */
  async function importDraft(a: Actor, providerId: string, externalId: string) {
    need(a, 'create');
    const { snapshot: s } = await wrapI(() => provider(providerId).snapshot(a.userId, externalId, false));
    const hours: BusinessProfileData['hours'] = {};
    if (s.hours?.length) for (const day of ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const) {
      const ps = s.hours.filter((h) => h.day === day).map((h) => ({ open: h.open, close: h.close === '00:00' ? '24:00' : h.close }));
      hours[day] = { closed: !ps.length, periods: ps };
    }
    return {
      name: s.name ?? '', description: s.description ?? '', primaryCategory: s.primaryCategory ?? '', additionalCategories: (s.additionalCategories ?? []).slice(0, 9),
      phone: s.phone ?? '', additionalPhones: [], website: s.website, hideAddress: false, serviceAreas: [],
      address: s.addressLines?.length ? { line1: s.addressLines[0], line2: s.addressLines.slice(1).join(', ') || undefined, city: s.city ?? '', region: s.region, postalCode: s.postalCode, country: s.country ?? 'US' } : undefined,
      hours, specialHours: [], services: [], attributes: [], media: [],
      _source: { provider: providerId, externalId, note: 'Imported from the provider’s API. Review every field before saving.' },
    };
  }

  async function link(a: Actor, id: string, input: { version: number; provider: string; externalId: string }) {
    const pr = provider(input.provider);
    need(a, 'share');
    await load(a, id);
    const { title, snapshot } = await wrapI(() => pr.snapshot(a.userId, input.externalId, false));
    const p = await mutate(a, id, 'share', input.version, (p) => {
      const l: ListingLink = { provider: pr.id, externalId: input.externalId, title, linkedAt: iso(), linkedBy: a.userId, snapshot, snapshotAt: iso() };
      p.listings = [l, ...p.listings.filter((x) => x.provider !== pr.id)];
      record(p, a.userId, { action: 'link', source: 'manual', summary: `Linked ${pr.label} listing “${title}”` });
      return p;
    });
    await logAudit(a, 'link', p, { provider: pr.id, listing: input.externalId });
    return view(p, a);
  }

  async function unlink(a: Actor, id: string, input: { version: number; provider: string }) {
    const p = await mutate(a, id, 'share', input.version, (p) => {
      const l = p.listings.find((x) => x.provider === input.provider);
      if (!l) throw fail('No listing of that type is linked.', 404, 'not_found');
      p.listings = p.listings.filter((x) => x !== l);
      record(p, a.userId, { action: 'unlink', source: 'manual', summary: `Unlinked listing “${l.title}” (the listing itself was not changed)` });
      return p;
    });
    await logAudit(a, 'unlink', p, { provider: input.provider });
    return view(p, a);
  }

  async function refreshListing(a: Actor, id: string, providerId: string) {
    need(a, 'edit');
    const cur = await load(a, id);
    const l = cur.listings.find((x) => x.provider === providerId);
    if (!l) throw fail('Link a listing first.', 404, 'not_found');
    const { title, snapshot } = await wrapI(() => provider(providerId).snapshot(a.userId, l.externalId, true));
    const p = await mutate(a, id, 'edit', null, (p) => {
      const x = p.listings.find((y) => y.provider === providerId && y.externalId === l.externalId);
      if (!x) throw fail('The listing was unlinked meanwhile.', 409, 'version_conflict');
      x.snapshot = snapshot; x.snapshotAt = iso(); x.title = title;
      record(p, a.userId, { action: 'link', source: 'system', summary: `Read the latest data from ${provider(providerId).label}` });
      return p;
    });
    return view(p, a);
  }

  // ---- Publishing: preview → explicit confirmation (signed, bound to the exact values) → publish ----

  const valuesHash = (p: BusinessProfile, fields: PublishableField[]) => crypto.createHash('sha256').update(JSON.stringify(fields.map((f) => [f, p.data[f] ?? '']))).digest('base64url');
  function sign(payload: object) {
    if (!deps.signingKey) throw fail('Publishing is disabled: the server has no signing key (SOCIAL_ACCOUNTS_ENCRYPTION_KEY).', 503, 'not_configured');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${crypto.createHmac('sha256', deps.signingKey).update(body).digest('base64url')}`;
  }
  function verify(token: string): any {
    if (!deps.signingKey) throw fail('Publishing is disabled: the server has no signing key.', 503, 'not_configured');
    const [body, mac] = token.split('.');
    const expect = crypto.createHmac('sha256', deps.signingKey).update(body || '').digest();
    let given: Buffer; try { given = Buffer.from(mac || '', 'base64url'); } catch { given = Buffer.alloc(0); }
    if (!body || given.length !== expect.length || !crypto.timingSafeEqual(given, expect)) throw fail('The confirmation is invalid. Preview the changes again.', 400, 'invalid_confirmation');
    try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw fail('The confirmation is invalid. Preview the changes again.', 400, 'invalid_confirmation'); }
  }

  async function publishPreview(a: Actor, id: string, input: { provider: string; fields?: PublishableField[] }) {
    const pr = provider(input.provider);
    need(a, 'share');
    const cur = await load(a, id);
    const l = cur.listings.find((x) => x.provider === pr.id);
    if (!l) throw fail('Link a listing before publishing.', 409, 'not_linked');
    // Always compare with fresh data from the provider so the preview shows what will really change.
    const { snapshot } = await wrapI(() => pr.snapshot(a.userId, l.externalId, true));
    await mutate(a, id, 'share', null, (p) => { const x = p.listings.find((y) => y.provider === pr.id); if (x) { x.snapshot = snapshot; x.snapshotAt = iso(); } });
    const p = await load(a, id);
    const wanted = (input.fields?.length ? input.fields : pr.publishableFields).filter((f) => pr.publishableFields.includes(f));
    const norm = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();
    const changes: { field: PublishableField; label: string; current: string; proposed: string }[] = [];
    const skipped: { field: PublishableField; reason: string }[] = [];
    for (const f of wanted) {
      const proposed = (p.data[f] as string | undefined) ?? '';
      const current = (snapshot[f] as string | undefined) ?? '';
      if (!proposed.trim()) { skipped.push({ field: f, reason: 'Empty in the CRM. Publishing won’t clear a field on the listing.' }); continue; }
      if (norm(proposed) === norm(current)) { skipped.push({ field: f, reason: 'Already matches the listing.' }); continue; }
      changes.push({ field: f, label: FIELD_LABELS[f], current: current || '—', proposed });
    }
    const r = audit(p);
    const warnings = r.findings.filter((x) => (x.status === 'fail' || x.status === 'warn') && changes.some((c) => c.field === x.field)).map((x) => `${x.title}: ${x.explanation}`);
    const fields = changes.map((c) => c.field);
    const expiresAt = now().getTime() + PREVIEW_TTL;
    const token = fields.length ? sign({ o: a.orgId, u: a.userId, p: id, v: p.version, pr: pr.id, x: l.externalId, f: fields, h: valuesHash(p, fields), exp: expiresAt }) : null;
    return { provider: pr.id, listing: { externalId: l.externalId, title: l.title }, snapshotAt: iso(), changes, skipped, warnings, unsupported: 'Name, address, categories and hours can’t be published from here; edit them in Google Business Profile.', confirmToken: token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async function publish(a: Actor, id: string, input: { provider: string; confirmToken: string; confirm: true }) {
    const pr = provider(input.provider);
    need(a, 'share');
    const t = verify(input.confirmToken);
    if (t.o !== a.orgId || t.u !== a.userId || t.p !== id || t.pr !== pr.id) throw fail('The confirmation doesn’t match this profile. Preview the changes again.', 400, 'invalid_confirmation');
    if (t.exp < now().getTime()) throw fail('The confirmation expired. Preview the changes again.', 400, 'confirmation_expired');
    const p = await load(a, id);
    const l = p.listings.find((x) => x.provider === pr.id);
    if (!l || l.externalId !== t.x) throw fail('The linked listing changed. Preview the changes again.', 409, 'version_conflict');
    if (p.version !== t.v || valuesHash(p, t.f) !== t.h) throw fail('The profile changed after you previewed it. Preview the changes again.', 409, 'version_conflict');
    const fields = t.f as PublishableField[];
    const patch = Object.fromEntries(fields.map((f) => [f, p.data[f] as string]));
    const recordId = rid('pub', 6);
    try {
      await wrapI(() => pr.publish(a.userId, l.externalId, patch));
    } catch (e: any) {
      const message = e instanceof AccountsError ? e.message : 'The listing couldn’t be updated.';
      await mutate(a, id, 'share', null, (x) => { x.publishLog.push({ id: recordId, at: iso(), by: a.userId, provider: pr.id, externalId: l.externalId, fields, outcome: 'failed', message }); }).catch(() => undefined);
      await logAudit(a, 'publish_failed', p, { provider: pr.id, fields: fields.join(',') });
      throw e;
    }
    const out = await mutate(a, id, 'share', null, (x) => {
      const msg = `Sent ${fields.map((f) => FIELD_LABELS[f]).join(', ')} to ${pr.label}. Google may review changes before they appear publicly.`;
      x.publishLog.push({ id: recordId, at: iso(), by: a.userId, provider: pr.id, externalId: l.externalId, fields, outcome: 'success', message: msg });
      const ll = x.listings.find((y) => y.provider === pr.id);
      if (ll?.snapshot) Object.assign(ll.snapshot, patch);
      record(x, a.userId, { action: 'publish', source: 'manual', summary: msg, fields: fields.map((f) => ({ field: f, before: '(listing value)', after: String(patch[f]).slice(0, 300) })) }, false);
      return x;
    });
    await logAudit(a, 'publish', out, { provider: pr.id, fields: fields.join(',') });
    return { ...view(out, a), published: { fields, at: iso() } };
  }

  return { list, get, create, update, setStatus, markReviewed, remove, runAudit, suggest, dismissSuggestion, integrations, linkable, importDraft, link, unlink, refreshListing, publishPreview, publish, aiConfigured: () => assistant.configured };
}

export type BusinessProfilesService = ReturnType<typeof createBusinessProfilesService>;
