/**
 * Business Profile Manager: business logic (server only, no Express).
 *
 * Authorization is enforced here on every call: the caller's role comes from the profile's
 * server-side member list, never from the client. Non-members get 404 (no existence leak).
 * Every mutation bumps `version` (optimistic concurrency) and appends a change-log entry.
 */
import crypto from 'node:crypto';
import { AccountsError } from '../../social-accounts/server/service';
import { auditIsStale, auditProfile, staleFlags } from '../domain/audit';
import { diffProfiles, FIELD_LABELS } from '../domain/diff';
import { can, type AuditResult, type BusinessProfile, type BusinessProfileData, type ChangeEntry, type ChangeSource, type ListingLink, type ProfileStatus, type ProfileSummaryView, type PublishableField, type Role, type Suggestion, type SuggestionKind } from '../domain/types';
import { AssistantError, type Assistant, type Tone } from './assistant';
import { IntegrationError, type ListingProvider } from './integrations';
import { NotFound, type ProfileStore } from './store';

const MAX_PROFILES_PER_USER = 200;
const MAX_MEMBERS = 50;
const PREVIEW_TTL = 10 * 60_000;

const rid = (prefix: string, bytes = 12) => `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;
const fail = (message: string, status: number, code: string, field?: string) => new AccountsError(message, status, code, field);

export interface ServiceDeps { store: ProfileStore; assistant: Assistant; providers: ListingProvider[]; signingKey: Buffer | null; now?: () => Date }

export function createBusinessProfilesService(deps: ServiceDeps) {
  const { store, assistant } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const iso = () => now().toISOString();

  // ---------- Access ----------

  async function load(uid: string, id: string): Promise<{ p: BusinessProfile; role: Role }> {
    const p = await store.get(id);
    const role = p?.members[uid];
    if (!p || !role) throw fail('Business profile not found.', 404, 'not_found');
    return { p, role };
  }
  const need = (role: Role, ok: boolean, what: string) => { if (!ok) throw fail(`Your role (${role}) can’t ${what}. Ask a profile owner for access.`, 403, 'forbidden'); };

  /** Read-modify-write with role and version checks inside the store's transaction. */
  function mutate<T>(uid: string, id: string, check: (r: Role) => boolean, what: string, version: number | null, fn: (p: BusinessProfile, role: Role) => T): Promise<T> {
    return store.update(id, (p) => {
      const role = p.members[uid];
      if (!role) throw fail('Business profile not found.', 404, 'not_found');
      need(role, check(role), what);
      if (version !== null && p.version !== version) throw fail('This profile was changed by someone else since you opened it. Reload to see the latest version, then reapply your edits.', 409, 'version_conflict');
      return fn(p, role);
    }).catch((e) => { if (e instanceof NotFound) throw fail('Business profile not found.', 404, 'not_found'); throw e; });
  }

  function record(p: BusinessProfile, uid: string, e: Omit<ChangeEntry, 'id' | 'at' | 'by' | 'version'>, bump = true) {
    if (bump) p.version += 1;
    p.updatedAt = iso(); p.updatedBy = uid;
    p.changes.push({ id: rid('ch', 6), at: p.updatedAt, by: uid, version: p.version, ...e });
  }

  const audit = (p: BusinessProfile): AuditResult => auditProfile({ data: p.data, version: p.version, hoursVerifiedAt: p.hoursVerifiedAt, lastReviewedAt: p.lastReviewedAt, listing: p.listings[0] }, now());

  function view(p: BusinessProfile, uid: string) {
    const role = p.members[uid];
    return {
      ...p,
      role,
      permissions: { edit: can.edit(role), publish: can.publish(role), manageMembers: can.manageMembers(role) },
      liveAudit: audit(p),
      auditStale: auditIsStale(p, now().getTime()),
      stale: staleFlags(p, now().getTime()),
      changes: p.changes.slice().reverse(),
      audits: p.audits.slice().reverse(),
      publishLog: p.publishLog.slice().reverse(),
      suggestions: p.suggestions.filter((s) => s.status === 'pending').reverse(),
    };
  }
  function summary(p: BusinessProfile, uid: string): ProfileSummaryView {
    const a = audit(p);
    return {
      id: p.id, name: p.data.name, primaryCategory: p.data.primaryCategory, city: p.data.hideAddress ? p.data.serviceAreas[0] : p.data.address?.city, status: p.status, role: p.members[uid],
      version: p.version, updatedAt: p.updatedAt, score: a.score, completeness: a.completeness, counts: a.counts, topIssue: a.priorities[0]?.title,
      lastAuditAt: p.lastAudit?.ranAt, auditStale: auditIsStale(p, now().getTime()), stale: staleFlags(p, now().getTime()), linked: p.listings.length > 0,
    };
  }

  // ---------- Profiles ----------

  async function list(uid: string) {
    const ps = await store.listForMember(uid);
    return ps.filter((p) => p.members[uid]).map((p) => summary(p, uid)).sort((a, b) => Number(a.status === 'archived') - Number(b.status === 'archived') || a.score - b.score || a.name.localeCompare(b.name));
  }

  async function get(uid: string, id: string) { const { p } = await load(uid, id); return view(p, uid); }

  async function create(uid: string, data: BusinessProfileData, source: ChangeSource = 'manual') {
    const owned = (await store.listForMember(uid)).filter((p) => p.members[uid] === 'owner').length;
    if (owned >= MAX_PROFILES_PER_USER) throw fail(`You can own at most ${MAX_PROFILES_PER_USER} business profiles.`, 409, 'limit_reached');
    const at = iso();
    const p: BusinessProfile = {
      id: rid('bp'), status: 'draft', version: 1, data, createdAt: at, createdBy: uid, updatedAt: at, updatedBy: uid,
      members: { [uid]: 'owner' }, memberIds: [uid], audits: [], changes: [], suggestions: [], listings: [], publishLog: [],
    };
    p.changes.push({ id: rid('ch', 6), at, by: uid, version: 1, action: 'create', source, summary: source === 'import' ? 'Created from a linked listing' : 'Created profile' });
    const a = audit(p); p.lastAudit = a;
    p.audits.push({ id: rid('au', 6), ranAt: a.ranAt, ranBy: 'system', profileVersion: 1, score: a.score, completeness: a.completeness, coverage: a.coverage, counts: a.counts, topIssues: a.priorities.slice(0, 3).map((f) => f.title) });
    await store.create(p);
    return view(p, uid);
  }

  async function update(uid: string, id: string, input: { version: number; data: BusinessProfileData; source: ChangeSource; suggestionId?: string; note?: string }) {
    const p = await mutate(uid, id, can.edit, 'edit this profile', input.version, (p) => {
      const fields = diffProfiles(p.data, input.data);
      if (!fields.length) throw fail('No changes to save.', 400, 'no_changes');
      let source = input.source;
      if (input.suggestionId) {
        const s = p.suggestions.find((x) => x.id === input.suggestionId && x.status === 'pending');
        if (s) { s.status = 'applied'; source = 'ai_suggestion'; } else source = 'manual';
      }
      const hoursChanged = fields.some((f) => f.field === 'hours');
      p.data = input.data;
      if (hoursChanged) delete p.hoursVerifiedAt; // edited hours need confirming again
      record(p, uid, { action: 'update', source, summary: `${source === 'ai_suggestion' ? 'Applied reviewed AI suggestion: ' : ''}Updated ${fields.map((f) => FIELD_LABELS[f.field] ?? f.field).join(', ')}${input.note ? ` — ${input.note}` : ''}`, fields });
      return p;
    });
    return view(p, uid);
  }

  async function setStatus(uid: string, id: string, input: { version: number; status: ProfileStatus }) {
    // Archiving (and restoring, checked below) needs manager; draft ⇄ active needs editor.
    const check = (r: Role) => (input.status === 'archived' ? can.publish(r) : can.edit(r));
    const p = await mutate(uid, id, check, input.status === 'archived' ? 'archive profiles' : 'change the status', input.version, (p, role) => {
      if (p.status === input.status) throw fail(`The profile is already ${input.status}.`, 400, 'no_changes');
      if (p.status === 'archived') need(role, can.publish(role), 'restore archived profiles');
      const from = p.status; p.status = input.status;
      record(p, uid, { action: 'status', source: 'manual', summary: `Status changed from ${from} to ${input.status}`, fields: [{ field: 'status', before: from, after: input.status }] });
      return p;
    });
    return view(p, uid);
  }

  async function markReviewed(uid: string, id: string, input: { version: number; scope: 'profile' | 'hours' }) {
    const p = await mutate(uid, id, can.edit, 'confirm profile details', input.version, (p) => {
      const at = iso();
      if (input.scope === 'hours') {
        if (!Object.keys(p.data.hours).length) throw fail('Add opening hours before confirming them.', 400, 'invalid_input', 'hours');
        p.hoursVerifiedAt = at;
      } else { p.lastReviewedAt = at; p.lastReviewedBy = uid; p.hoursVerifiedAt = Object.keys(p.data.hours).length ? at : p.hoursVerifiedAt; }
      record(p, uid, { action: 'review', source: 'review', summary: input.scope === 'hours' ? 'Confirmed opening hours are correct' : 'Marked the whole profile as reviewed and accurate' });
      return p;
    });
    return view(p, uid);
  }

  async function remove(uid: string, id: string, confirmName: string) {
    const { p, role } = await load(uid, id);
    need(role, role === 'owner', 'delete profiles');
    if (confirmName.trim() !== p.data.name) throw fail('Type the business name exactly to confirm deletion.', 400, 'confirmation_required', 'confirmName');
    await store.remove(id);
    return { deleted: true };
  }

  // ---------- Audits ----------

  async function runAudit(uid: string, id: string) {
    const p = await mutate(uid, id, can.edit, 'run audits', null, (p) => {
      const a = audit(p);
      p.lastAudit = a;
      p.audits.push({ id: rid('au', 6), ranAt: a.ranAt, ranBy: uid, profileVersion: p.version, score: a.score, completeness: a.completeness, coverage: a.coverage, counts: a.counts, topIssues: a.priorities.slice(0, 3).map((f) => f.title) });
      return p;
    });
    return view(p, uid);
  }

  // ---------- AI suggestions (review required; never saved to the profile automatically) ----------

  async function suggest(uid: string, id: string, input: { kind: SuggestionKind; tone: Tone; notes?: string }) {
    const { p, role } = await load(uid, id);
    need(role, can.edit(role), 'request AI suggestions');
    let out: { text?: string; services?: Suggestion['services']; flags: string[]; factsUsed: string[] };
    try { out = input.kind === 'description' ? await assistant.description(p.data, input) : await assistant.services(p.data, input); }
    catch (e) { if (e instanceof AssistantError) throw fail(e.message, e.status, e.code); throw e; }
    const s: Suggestion = { id: rid('sg', 8), kind: input.kind, createdAt: iso(), createdBy: uid, basedOnVersion: p.version, ...out, status: 'pending', model: assistant.model };
    await mutate(uid, id, can.edit, 'request AI suggestions', null, (x) => { x.suggestions.push(s); });
    return s;
  }

  async function dismissSuggestion(uid: string, id: string, sid: string) {
    await mutate(uid, id, can.edit, 'dismiss suggestions', null, (p) => {
      const s = p.suggestions.find((x) => x.id === sid);
      if (!s) throw fail('Suggestion not found.', 404, 'not_found');
      s.status = 'dismissed';
    });
    return { dismissed: true };
  }

  // ---------- Members (server-enforced roles) ----------

  async function setMember(uid: string, id: string, input: { userId: string; role: Role | null }) {
    const p = await mutate(uid, id, can.manageMembers, 'manage members', null, (p) => {
      const before = p.members[input.userId];
      const owners = Object.values(p.members).filter((r) => r === 'owner').length;
      if (before === 'owner' && input.role !== 'owner' && owners <= 1) throw fail('A profile needs at least one owner. Add another owner first.', 409, 'last_owner');
      if (input.role === null) { if (!before) throw fail('That user isn’t a member.', 404, 'not_found'); delete p.members[input.userId]; }
      else {
        if (!before && Object.keys(p.members).length >= MAX_MEMBERS) throw fail(`At most ${MAX_MEMBERS} members per profile.`, 409, 'limit_reached');
        p.members[input.userId] = input.role;
      }
      p.memberIds = Object.keys(p.members);
      record(p, uid, { action: 'members', source: 'manual', summary: input.role === null ? `Removed member ${input.userId}` : before ? `Changed ${input.userId} from ${before} to ${input.role}` : `Added ${input.userId} as ${input.role}` }, false);
      return p;
    });
    return p.members[uid] ? view(p, uid) : { removedSelf: true };
  }

  // ---------- Listings (integration boundary) ----------

  const provider = (id: string) => {
    const pr = deps.providers.find((x) => x.id === id);
    if (!pr) throw fail('Unknown integration.', 400, 'invalid_input');
    return pr;
  };
  const wrapI = async <T,>(fn: () => Promise<T>) => { try { return await fn(); } catch (e) { if (e instanceof IntegrationError) throw fail(e.message, e.status, e.code); throw e; } };

  async function integrations(uid: string) {
    return Promise.all(deps.providers.map(async (pr) => {
      try { return await pr.status(uid); }
      catch { return { provider: pr.id, label: pr.label, configured: false, connected: false, detail: 'Status could not be checked right now.', publishableFields: pr.publishableFields }; }
    }));
  }
  async function linkable(uid: string, providerId: string) { return wrapI(() => provider(providerId).listLinkable(uid)); }

  /** Draft profile data from a listing, for the user to review in the form. Nothing is saved. */
  async function importDraft(uid: string, providerId: string, externalId: string) {
    const { snapshot: s } = await wrapI(() => provider(providerId).snapshot(uid, externalId, false));
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

  async function link(uid: string, id: string, input: { version: number; provider: string; externalId: string }) {
    const pr = provider(input.provider);
    await load(uid, id).then(({ role }) => need(role, can.publish(role), 'link listings'));
    const { title, snapshot } = await wrapI(() => pr.snapshot(uid, input.externalId, false));
    const p = await mutate(uid, id, can.publish, 'link listings', input.version, (p) => {
      const l: ListingLink = { provider: pr.id, externalId: input.externalId, title, linkedAt: iso(), linkedBy: uid, snapshot, snapshotAt: iso() };
      p.listings = [l, ...p.listings.filter((x) => x.provider !== pr.id)];
      record(p, uid, { action: 'link', source: 'manual', summary: `Linked ${pr.label} listing “${title}”` });
      return p;
    });
    return view(p, uid);
  }

  async function unlink(uid: string, id: string, input: { version: number; provider: string }) {
    const p = await mutate(uid, id, can.publish, 'unlink listings', input.version, (p) => {
      const l = p.listings.find((x) => x.provider === input.provider);
      if (!l) throw fail('No listing of that type is linked.', 404, 'not_found');
      p.listings = p.listings.filter((x) => x !== l);
      record(p, uid, { action: 'unlink', source: 'manual', summary: `Unlinked listing “${l.title}” (the listing itself was not changed)` });
      return p;
    });
    return view(p, uid);
  }

  async function refreshListing(uid: string, id: string, providerId: string) {
    const { p: cur, role } = await load(uid, id);
    need(role, can.edit(role), 'refresh listing data');
    const l = cur.listings.find((x) => x.provider === providerId);
    if (!l) throw fail('Link a listing first.', 404, 'not_found');
    const { title, snapshot } = await wrapI(() => provider(providerId).snapshot(uid, l.externalId, true));
    const p = await mutate(uid, id, can.edit, 'refresh listing data', null, (p) => {
      const x = p.listings.find((y) => y.provider === providerId && y.externalId === l.externalId);
      if (!x) throw fail('The listing was unlinked meanwhile.', 409, 'version_conflict');
      x.snapshot = snapshot; x.snapshotAt = iso(); x.title = title;
      record(p, uid, { action: 'link', source: 'system', summary: `Read the latest data from ${provider(providerId).label}` });
      return p;
    });
    return view(p, uid);
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
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  }

  async function publishPreview(uid: string, id: string, input: { provider: string; fields?: PublishableField[] }) {
    const pr = provider(input.provider);
    const { p: cur, role } = await load(uid, id);
    need(role, can.publish(role), 'publish to external listings');
    const l = cur.listings.find((x) => x.provider === pr.id);
    if (!l) throw fail('Link a listing before publishing.', 409, 'not_linked');
    // Always compare with fresh data from the provider so the preview shows what will really change.
    const { snapshot } = await wrapI(() => pr.snapshot(uid, l.externalId, true));
    await mutate(uid, id, can.edit, 'refresh listing data', null, (p) => { const x = p.listings.find((y) => y.provider === pr.id); if (x) { x.snapshot = snapshot; x.snapshotAt = iso(); } });
    const { p } = await load(uid, id);
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
    const a = audit(p);
    const warnings = a.findings.filter((x) => (x.status === 'fail' || x.status === 'warn') && changes.some((c) => c.field === x.field)).map((x) => `${x.title}: ${x.explanation}`);
    const fields = changes.map((c) => c.field);
    const expiresAt = now().getTime() + PREVIEW_TTL;
    const token = fields.length ? sign({ u: uid, p: id, v: p.version, pr: pr.id, x: l.externalId, f: fields, h: valuesHash(p, fields), exp: expiresAt }) : null;
    return { provider: pr.id, listing: { externalId: l.externalId, title: l.title }, snapshotAt: iso(), changes, skipped, warnings, unsupported: 'Name, address, categories and hours can’t be published from here; edit them in Google Business Profile.', confirmToken: token, expiresAt: new Date(expiresAt).toISOString() };
  }

  async function publish(uid: string, id: string, input: { provider: string; confirmToken: string; confirm: true }) {
    const pr = provider(input.provider);
    const t = verify(input.confirmToken);
    if (t.u !== uid || t.p !== id || t.pr !== pr.id) throw fail('The confirmation doesn’t match this profile. Preview the changes again.', 400, 'invalid_confirmation');
    if (t.exp < now().getTime()) throw fail('The confirmation expired. Preview the changes again.', 400, 'confirmation_expired');
    const { p, role } = await load(uid, id);
    need(role, can.publish(role), 'publish to external listings');
    const l = p.listings.find((x) => x.provider === pr.id);
    if (!l || l.externalId !== t.x) throw fail('The linked listing changed. Preview the changes again.', 409, 'version_conflict');
    if (p.version !== t.v || valuesHash(p, t.f) !== t.h) throw fail('The profile changed after you previewed it. Preview the changes again.', 409, 'version_conflict');
    const fields = t.f as PublishableField[];
    const patch = Object.fromEntries(fields.map((f) => [f, p.data[f] as string]));
    const recordId = rid('pub', 6);
    try {
      await wrapI(() => pr.publish(uid, l.externalId, patch));
    } catch (e: any) {
      const message = e instanceof AccountsError ? e.message : 'The listing couldn’t be updated.';
      await mutate(uid, id, can.publish, 'publish', null, (x) => { x.publishLog.push({ id: recordId, at: iso(), by: uid, provider: pr.id, externalId: l.externalId, fields, outcome: 'failed', message }); }).catch(() => undefined);
      throw e;
    }
    const out = await mutate(uid, id, can.publish, 'publish', null, (x) => {
      const msg = `Sent ${fields.map((f) => FIELD_LABELS[f]).join(', ')} to ${pr.label}. Google may review changes before they appear publicly.`;
      x.publishLog.push({ id: recordId, at: iso(), by: uid, provider: pr.id, externalId: l.externalId, fields, outcome: 'success', message: msg });
      const ll = x.listings.find((y) => y.provider === pr.id);
      if (ll?.snapshot) Object.assign(ll.snapshot, patch);
      record(x, uid, { action: 'publish', source: 'manual', summary: msg, fields: fields.map((f) => ({ field: f, before: '(listing value)', after: String(patch[f]).slice(0, 300) })) }, false);
      return x;
    });
    return { ...view(out, uid), published: { fields, at: iso() } };
  }

  return { list, get, create, update, setStatus, markReviewed, remove, runAudit, suggest, dismissSuggestion, setMember, integrations, linkable, importDraft, link, unlink, refreshListing, publishPreview, publish, aiConfigured: () => assistant.configured };
}

export type BusinessProfilesService = ReturnType<typeof createBusinessProfilesService>;
