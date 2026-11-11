/**
 * Contacts and companies: the organization's single record of a person and a business.
 *
 *   organizations/{orgId}/contacts/{contactId}               the person (owner, tags, company, emails/phones)
 *   organizations/{orgId}/contacts/{contactId}/activities/*  their own timeline entries
 *   organizations/{orgId}/companies/{companyId}              the business
 *   organizations/{orgId}/companies/{companyId}/activities/* the company's own timeline entries
 *
 * Everything else points at a contact by id and is matched by email/phone for older records:
 *   leads (convertedContactId / contactId), deals (contactId), tasks (contactId), proposals (crmContactId,
 *   or the client email), invoicing clients (billing/{orgId}/clients contactId, or email), scheduled
 *   meetings (contactId, or a guest email), inbox conversations and WhatsApp/SMS (email / phone).
 *
 * Nothing is hard-deleted here: deleting sets deletedAt, merging re-points every link to the kept record
 * and leaves the other one as a tombstone (mergedInto) with all of its data.
 */
import { assertId, getDocStore, newId, type DocStore } from '../data/docStore';
import { TenancyError } from '../tenancy/orgs';
import { recordAudit } from '../audit/auditLog';
import { inboxMessagesByEmail } from '../../routes/messagingPlatform';
import { LIKELY, POSSIBLE, buildIndex, findMatchingPairs, levelOf, matchAgainst, matchLeadsToContacts, type MatchLevel } from './analytics/entityMatch';

export const normEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
export const normPhone = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : ''; };
export const nameKey = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const companyKey = (v: unknown) => nameKey(v).replace(/\b(inc|llc|ltd|co|corp|corporation|company|gmbh|sa|plc)\b/g, '').replace(/\s+/g, ' ').trim();
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface ContactInput {
  name?: string; email?: string; phone?: string; title?: string; company?: string; companyId?: string | null;
  ownerId?: string | null; owner?: string; tags?: string[]; category?: string; notes?: string; status?: string;
}

const base = (orgId: string) => `organizations/${assertId(orgId)}`;
export const contactPath = (orgId: string, id: string) => `${base(orgId)}/contacts/${assertId(id)}`;
export const companyPath = (orgId: string, id: string) => `${base(orgId)}/companies/${assertId(id)}`;

const live = (r: any) => r && !r.deletedAt && !r.mergedInto;

function cleanTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((t) => str(t, 40)).filter(Boolean))].slice(0, 20);
}

function contactFields(input: ContactInput, partial: boolean) {
  const out: Record<string, any> = {};
  const set = (k: string, v: any) => { if (!partial || (input as any)[k] !== undefined) out[k] = v; };
  set('name', str(input.name, 120));
  set('email', normEmail(input.email));
  set('phone', str(input.phone, 40));
  set('title', str(input.title, 120));
  set('company', str(input.company, 160));
  set('companyId', input.companyId ? assertId(input.companyId) : null);
  set('ownerId', input.ownerId ? str(input.ownerId, 128) : null);
  set('owner', str(input.owner, 120));
  set('tags', cleanTags(input.tags));
  set('category', str(input.category, 40));
  set('notes', str(input.notes, 10_000));
  if (input.status !== undefined) out.status = ['active', 'inactive', 'customer', 'prospect'].includes(String(input.status)) ? input.status : 'active';
  return out;
}

export function validEmail(e: string) { return !e || (e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)); }

/** Why two records look like the same person (empty when they don't). */
export function duplicateReasons(a: any, b: any): string[] {
  const why: string[] = [];
  const ea = [a.email, ...(a.altEmails || [])].map(normEmail).filter(Boolean);
  const eb = new Set([b.email, ...(b.altEmails || [])].map(normEmail).filter(Boolean));
  if (ea.some((e) => eb.has(e))) why.push('Same email');
  const pa = [a.phone, ...(a.altPhones || [])].map(normPhone).filter(Boolean);
  const pb = new Set([b.phone, ...(b.altPhones || [])].map(normPhone).filter(Boolean));
  if (pa.some((p) => pb.has(p))) why.push('Same phone');
  const na = nameKey(a.name), nb = nameKey(b.name);
  if (na && na === nb && companyKey(a.company) && companyKey(a.company) === companyKey(b.company)) why.push('Same name and company');
  return why;
}

export class ContactService {
  private constructor(private st: DocStore, readonly orgId: string) {}
  static async forOrg(orgId: string, st?: DocStore) { return new ContactService(st ?? (await getDocStore()), assertId(orgId)); }

  private col(name: string) { return `${base(this.orgId)}/${name}`; }

  // ---------------------------------------------------------------- contacts
  async listAll() { return this.st.list(this.col('contacts')); }

  async list(opts: { q?: string; tag?: string; companyId?: string; ownerId?: string; includeDeleted?: boolean } = {}) {
    const q = nameKey(opts.q), qd = String(opts.q || '').replace(/\D/g, '');
    return (await this.listAll())
      .filter((c: any) => (opts.includeDeleted ? !c.mergedInto : live(c)))
      .filter((c: any) => !opts.tag || (c.tags || []).includes(opts.tag))
      .filter((c: any) => !opts.companyId || c.companyId === opts.companyId)
      .filter((c: any) => !opts.ownerId || c.ownerId === opts.ownerId)
      .filter((c: any) => !q || [c.name, c.email, c.company, c.title, ...(c.tags || [])].some((v) => nameKey(v).includes(q) || normEmail(v).includes(String(opts.q).trim().toLowerCase()))
        || (qd.length >= 4 && normPhone(c.phone).includes(qd)))
      .sort((a: any, b: any) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
  }

  async get(id: string) {
    const c = await this.st.get(contactPath(this.orgId, id));
    return c && !c.mergedInto ? c : c && c.mergedInto ? { ...c, redirectTo: c.mergedInto } : null;
  }

  /**
   * Contacts that look like `candidate`: exact matches (same email, same phone, same name and company) and fuzzy
   * matches at or above `min` (see analytics/entityMatch.ts), best first, each with its score and reasons.
   */
  async findDuplicates(candidate: any, excludeId?: string, min = LIKELY) {
    const pool = (await this.listAll()).filter((c: any) => live(c) && c.id !== excludeId);
    const probe = { ...candidate, id: candidate.id || '__candidate__' };
    const fuzzy = new Map(matchAgainst(probe, pool, { min: POSSIBLE, limit: 50, index: buildIndex(pool) }).map((m) => [m.record.id, m.match]));
    return pool
      .map((c: any) => {
        const exact = duplicateReasons(candidate, c);
        const f = fuzzy.get(c.id);
        const score = exact.length ? Math.max(f?.score ?? 0, 0.9) : f?.score ?? 0;
        return { contact: c, reasons: [...new Set([...exact, ...(f?.reasons || [])])], score, level: (exact.length ? (score >= LIKELY ? 'likely' : 'possible') : levelOf(score)) as MatchLevel, exact: exact.length > 0 };
      })
      .filter((m) => m.exact || m.score >= min)
      .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score);
  }

  /** Closest contacts for a contact being typed in (possible and likely matches), for the create form. */
  async matchCandidates(input: ContactInput & { id?: string }) {
    const probe = { name: str(input.name, 120), email: normEmail(input.email), phone: str(input.phone, 40), company: str(input.company, 160) };
    if (!probe.name && !probe.email && !normPhone(probe.phone)) return [];
    return (await this.findDuplicates(probe, input.id, POSSIBLE)).slice(0, 5)
      .map((d) => ({ id: d.contact.id, name: d.contact.name, email: d.contact.email, phone: d.contact.phone, company: d.contact.company, score: d.score, level: d.level, reasons: d.reasons }));
  }

  async findByEmail(email: string) {
    const e = normEmail(email);
    if (!e) return null;
    return (await this.listAll()).find((c: any) => live(c) && [c.email, ...(c.altEmails || [])].map(normEmail).includes(e)) || null;
  }

  async create(input: ContactInput, actor: { userId: string; name: string }, opts: { force?: boolean; originLeadId?: string } = {}) {
    const fields = contactFields(input, false);
    if (!fields.name && !fields.email) throw new TenancyError(400, 'invalid_input', 'Add a name or an email.');
    if (!validEmail(fields.email)) throw new TenancyError(400, 'invalid_input', 'That email address isn’t valid.');
    if (fields.companyId && !(await this.st.get(companyPath(this.orgId, fields.companyId)))) throw new TenancyError(400, 'invalid_input', 'That company wasn’t found.');
    if (!opts.force) {
      const dups = await this.findDuplicates(fields);
      if (dups.length) {
        throw Object.assign(new TenancyError(409, 'possible_duplicate', `This looks like ${dups[0].contact.name || dups[0].contact.email} (${dups[0].reasons.join(', ').toLowerCase()}). Open that contact, merge, or save anyway.`),
          { details: { matches: dups.slice(0, 5).map((d) => ({ id: d.contact.id, name: d.contact.name, email: d.contact.email, company: d.contact.company, reasons: d.reasons, score: d.score, level: d.level })) } });
      }
    }
    const ts = nowIso();
    const c: Record<string, any> = { ...fields, id: newId('contact'), orgId: this.orgId, status: fields.status || 'active', ownerId: fields.ownerId ?? actor.userId, owner: fields.owner || actor.name,
      originLeadId: opts.originLeadId ?? null, createdBy: actor.userId, createdAt: ts, updatedAt: ts };
    await this.st.set(contactPath(this.orgId, c.id), c);
    await this.addActivity('contact', c.id, { type: 'created', title: 'Contact created', description: c.name || c.email, actor: actor.name });
    return c;
  }

  async update(id: string, input: ContactInput, actor: { userId: string; name: string }) {
    const cur = await this.st.get(contactPath(this.orgId, id));
    if (!live(cur)) throw new TenancyError(404, 'not_found', 'Contact not found.');
    const fields = contactFields(input, true);
    if (fields.email !== undefined && !validEmail(fields.email)) throw new TenancyError(400, 'invalid_input', 'That email address isn’t valid.');
    if (fields.name !== undefined && !fields.name && !(fields.email ?? cur.email)) throw new TenancyError(400, 'invalid_input', 'A contact needs a name or an email.');
    if (fields.companyId && !(await this.st.get(companyPath(this.orgId, fields.companyId)))) throw new TenancyError(400, 'invalid_input', 'That company wasn’t found.');
    const patch = { ...fields, updatedAt: nowIso() };
    await this.st.update(contactPath(this.orgId, id), patch);
    const changed = Object.keys(fields).filter((k) => JSON.stringify(fields[k]) !== JSON.stringify(cur[k]));
    if (changed.length) await this.addActivity('contact', id, { type: 'updated', title: 'Contact updated', description: `Changed ${changed.join(', ')}.`, actor: actor.name });
    return { ...cur, ...patch };
  }

  /** Soft delete: the record stays (with deletedAt) so links and history keep working. */
  async softDelete(id: string, actor: { userId: string; name: string }) {
    const cur = await this.st.get(contactPath(this.orgId, id));
    if (!live(cur)) throw new TenancyError(404, 'not_found', 'Contact not found.');
    await recordAudit(this.orgId, { actorId: actor.userId, action: 'contact.deleted', target: { type: 'contact', id }, meta: { soft: true } });
    await this.st.update(contactPath(this.orgId, id), { deletedAt: nowIso(), deletedBy: actor.userId, updatedAt: nowIso() });
    await this.feed({ type: 'contact_deleted', title: 'Contact deleted', description: cur.name || cur.email, actor: actor.name, targetId: id, targetType: 'contact' });
    return { id };
  }

  async restore(id: string, actor: { userId: string; name: string }) {
    const cur = await this.st.get(contactPath(this.orgId, id));
    if (!cur || cur.mergedInto || !cur.deletedAt) throw new TenancyError(404, 'not_found', 'Deleted contact not found.');
    await this.st.update(contactPath(this.orgId, id), { deletedAt: null, deletedBy: null, updatedAt: nowIso() });
    await this.addActivity('contact', id, { type: 'restored', title: 'Contact restored', description: cur.name || cur.email, actor: actor.name });
    return { ...cur, deletedAt: null };
  }

  /**
   * Groups of live contacts that look like the same person: exact matches (same email, phone, or name and
   * company) and fuzzy matches scored ≥ 0.7 (analytics/entityMatch.ts). Each group keeps the original fields
   * (reasons, contacts) and adds its best score, level and the scored pairs. Merging stays a manual step.
   */
  async duplicateGroups() {
    const rows = (await this.listAll()).filter(live);
    const pairs = new Map<string, { a: number; b: number; score: number; reasons: string[] }>();
    for (const p of findMatchingPairs(rows, POSSIBLE)) pairs.set(`${p.a}|${p.b}`, { a: p.a, b: p.b, score: p.match.score, reasons: p.match.reasons });
    // Exact rules first: they always count, whatever the fuzzy score.
    const byEmail = new Map<string, number[]>(), byPhone = new Map<string, number[]>();
    rows.forEach((r: any, i: number) => {
      for (const e of [r.email, ...(r.altEmails || [])].map(normEmail).filter(Boolean)) byEmail.set(e, [...(byEmail.get(e) || []), i]);
      for (const ph of [r.phone, ...(r.altPhones || [])].map(normPhone).filter(Boolean)) byPhone.set(ph, [...(byPhone.get(ph) || []), i]);
    });
    const exactCandidates = new Set<string>(pairs.keys());
    for (const list of [...byEmail.values(), ...byPhone.values()]) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) exactCandidates.add(`${Math.min(list[x], list[y])}|${Math.max(list[x], list[y])}`);
    for (const k of exactCandidates) {
      const [a, b] = k.split('|').map(Number);
      if (a === b) continue;
      const exact = duplicateReasons(rows[a], rows[b]);
      if (!exact.length) continue;
      const cur = pairs.get(k);
      pairs.set(k, { a, b, score: Math.max(cur?.score ?? 0, 0.9), reasons: [...new Set([...exact, ...(cur?.reasons || [])])] });
    }
    const parent = rows.map((_: any, i: number) => i);
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (const p of pairs.values()) { const ra = find(p.a), rb = find(p.b); if (ra !== rb) parent[rb] = ra; }
    const groups = new Map<number, number[]>();
    rows.forEach((_: any, i: number) => { const r = find(i); groups.set(r, [...(groups.get(r) || []), i]); });
    return [...groups.entries()].filter(([, g]) => g.length > 1).map(([root, g]) => {
      const gp = [...pairs.values()].filter((p) => find(p.a) === root).sort((x, y) => y.score - x.score);
      const score = gp.length ? gp[0].score : 0;
      return {
        reasons: [...new Set(gp.flatMap((p) => p.reasons))],
        contacts: g.map((i) => rows[i]).sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt))),
        score, level: score >= LIKELY ? 'likely' : 'possible',
        pairs: gp.map((p) => ({ ids: [rows[p.a].id, rows[p.b].id], score: p.score, level: p.score >= LIKELY ? 'likely' : 'possible', reasons: p.reasons, summary: p.reasons.join('; ') })),
      };
    }).sort((x, y) => y.score - x.score);
  }

  /** Open leads that look like an existing contact ("this lead looks like contact X"). Nothing is merged. */
  async leadMatches() {
    const [leads, contacts] = await Promise.all([this.st.list(this.col('leads')), this.listAll()]);
    return matchLeadsToContacts(leads.filter((l: any) => !l.deletedAt && !l.archived), contacts.filter(live)).slice(0, 100).map((m) => ({
      lead: { id: m.lead.id, name: m.lead.name || '', email: m.lead.email || '', phone: m.lead.phone || '', company: m.lead.company || '', status: m.lead.status || '' },
      contact: { id: m.contact.id, name: m.contact.name || '', email: m.contact.email || '', phone: m.contact.phone || '', company: m.contact.company || '' },
      score: m.score, level: m.level, reasons: m.reasons, summary: m.summary,
    }));
  }

  /**
   * Merges `others` into `keepId`. Every link (leads, deals, tasks, proposals, invoicing clients, meetings,
   * companies, timeline entries) is re-pointed to the kept contact; empty fields are filled from the others;
   * emails/phones/tags are kept as alternates. The merged-away contacts stay as tombstones (mergedInto).
   */
  async merge(keepId: string, others: string[], actor: { userId: string; name: string }) {
    const ids = [...new Set(others.map((o) => assertId(o)))].filter((o) => o !== keepId);
    if (!ids.length) throw new TenancyError(400, 'invalid_input', 'Pick at least one other contact to merge.');
    const keep = await this.st.get(contactPath(this.orgId, keepId));
    if (!live(keep)) throw new TenancyError(404, 'not_found', 'The contact to keep wasn’t found.');
    const drop = await Promise.all(ids.map((i) => this.st.get(contactPath(this.orgId, i))));
    if (drop.some((d) => !live(d))) throw new TenancyError(404, 'not_found', 'One of the contacts to merge wasn’t found.');
    await recordAudit(this.orgId, { actorId: actor.userId, action: 'contact.merged', target: { type: 'contact', id: keepId }, meta: { mergedIds: ids } });

    const merged: Record<string, any> = { ...keep };
    for (const d of drop) for (const k of ['name', 'email', 'phone', 'title', 'company', 'companyId', 'ownerId', 'owner', 'category', 'notes', 'originLeadId']) if (!merged[k] && d[k]) merged[k] = d[k];
    const emails = [...new Set([keep.email, ...(keep.altEmails || []), ...drop.flatMap((d: any) => [d.email, ...(d.altEmails || [])])].map(normEmail).filter(Boolean))];
    const phones = [...new Set([keep.phone, ...(keep.altPhones || []), ...drop.flatMap((d: any) => [d.phone, ...(d.altPhones || [])])].map((p) => str(p, 40)).filter(Boolean))];
    merged.altEmails = emails.filter((e) => e !== normEmail(merged.email));
    merged.altPhones = phones.filter((p) => normPhone(p) !== normPhone(merged.phone));
    merged.tags = [...new Set([...(keep.tags || []), ...drop.flatMap((d: any) => d.tags || [])])].slice(0, 40);
    merged.mergedFrom = [...new Set([...(keep.mergedFrom || []), ...ids])];
    merged.updatedAt = nowIso();

    const moved: Record<string, number> = {};
    const bump = (k: string) => { moved[k] = (moved[k] || 0) + 1; };
    const repoint = async (col: string, fields: string[], label: string) => {
      for (const row of await this.st.list(col)) {
        const patch: Record<string, any> = {};
        for (const f of fields) if (ids.includes(row[f])) patch[f] = keepId;
        if (Object.keys(patch).length) { await this.st.update(`${col}/${row.id}`, patch); bump(label); }
      }
    };
    await repoint(this.col('leads'), ['convertedContactId', 'contactId'], 'leads');
    await repoint(this.col('deals'), ['contactId'], 'deals');
    await repoint(this.col('tasks'), ['contactId'], 'tasks');
    await repoint(this.col('proposals'), ['crmContactId'], 'proposals');
    await repoint(this.col('scheduled_meetings'), ['contactId'], 'meetings');
    await repoint(this.col('companies'), ['primaryContactId'], 'companies');
    await repoint(`billing/${this.orgId}/clients`, ['contactId'], 'invoicingClients');
    for (const d of drop) {
      for (const a of await this.st.list(`${contactPath(this.orgId, d.id)}/activities`)) {
        await this.st.set(`${contactPath(this.orgId, keepId)}/activities/${a.id}`, { ...a, contactId: keepId, mergedFromContactId: d.id }); bump('timeline');
      }
    }

    await this.st.set(contactPath(this.orgId, keepId), merged);
    const ts = nowIso();
    for (const d of drop) await this.st.update(contactPath(this.orgId, d.id), { mergedInto: keepId, mergedAt: ts, mergedBy: actor.userId, deletedAt: ts, updatedAt: ts });
    const names = drop.map((d: any) => d.name || d.email).join(', ');
    await this.addActivity('contact', keepId, { type: 'merged', title: 'Contacts merged', description: `Merged ${names} into this contact. Moved: ${Object.entries(moved).map(([k, v]) => `${v} ${k}`).join(', ') || 'no linked records'}.`, actor: actor.name });
    return { contact: merged, merged: ids, moved };
  }

  // ---------------------------------------------------------------- companies
  async listCompanies(opts: { q?: string; includeDeleted?: boolean } = {}) {
    const q = nameKey(opts.q);
    return (await this.st.list(this.col('companies')))
      .filter((c: any) => (opts.includeDeleted ? !c.mergedInto : live(c)))
      .filter((c: any) => !q || [c.name, c.industry, c.website, c.domain].some((v) => nameKey(v).includes(q)))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  }

  async getCompany(id: string) { const c = await this.st.get(companyPath(this.orgId, id)); return c && !c.mergedInto ? c : null; }

  async findCompanyByName(name: string) {
    const k = companyKey(name);
    if (!k) return null;
    return (await this.st.list(this.col('companies'))).find((c: any) => live(c) && companyKey(c.name) === k) || null;
  }

  private companyFields(b: any, partial: boolean) {
    const out: Record<string, any> = {};
    for (const [k, max] of [['name', 160], ['industry', 80], ['website', 300], ['phone', 40], ['address', 400], ['size', 40], ['tier', 80], ['notes', 10_000]] as const) {
      if (!partial || b[k] !== undefined) out[k] = str(b[k], max);
    }
    if (!partial || b.tags !== undefined) out.tags = cleanTags(b.tags);
    if (!partial || b.ownerId !== undefined) out.ownerId = b.ownerId ? str(b.ownerId, 128) : null;
    if (!partial || b.parentCompanyId !== undefined) out.parentCompanyId = b.parentCompanyId ? assertId(b.parentCompanyId) : null;
    if (out.website) out.domain = out.website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
    return out;
  }

  async createCompany(b: any, actor: { userId: string; name: string }, opts: { force?: boolean } = {}) {
    const fields = this.companyFields(b || {}, false);
    if (!fields.name) throw new TenancyError(400, 'invalid_input', 'Add the company name.');
    if (!opts.force) {
      const dup = await this.findCompanyByName(fields.name);
      if (dup) throw Object.assign(new TenancyError(409, 'possible_duplicate', `A company called ${dup.name} already exists. Open it, or save anyway.`), { details: { matches: [{ id: dup.id, name: dup.name, reasons: ['Same name'] }] } });
    }
    const ts = nowIso();
    const c: Record<string, any> = { ...fields, id: newId('company'), orgId: this.orgId, ownerId: fields.ownerId ?? actor.userId, createdBy: actor.userId, createdAt: ts, updatedAt: ts };
    await this.st.set(companyPath(this.orgId, c.id), c);
    await this.addActivity('company', c.id, { type: 'created', title: 'Company created', description: c.name, actor: actor.name });
    return c;
  }

  async updateCompany(id: string, b: any, actor: { userId: string; name: string }) {
    const cur = await this.st.get(companyPath(this.orgId, id));
    if (!live(cur)) throw new TenancyError(404, 'not_found', 'Company not found.');
    const fields = this.companyFields(b || {}, true);
    if (fields.name !== undefined && !fields.name) throw new TenancyError(400, 'invalid_input', 'A company needs a name.');
    if (fields.parentCompanyId === id) throw new TenancyError(400, 'invalid_input', 'A company can’t be its own parent.');
    const patch = { ...fields, updatedAt: nowIso() };
    await this.st.update(companyPath(this.orgId, id), patch);
    await this.addActivity('company', id, { type: 'updated', title: 'Company updated', description: `Changed ${Object.keys(fields).join(', ') || 'nothing'}.`, actor: actor.name });
    return { ...cur, ...patch };
  }

  async softDeleteCompany(id: string, actor: { userId: string; name: string }) {
    const cur = await this.st.get(companyPath(this.orgId, id));
    if (!live(cur)) throw new TenancyError(404, 'not_found', 'Company not found.');
    await recordAudit(this.orgId, { actorId: actor.userId, action: 'company.deleted', target: { type: 'company', id }, meta: { soft: true } });
    await this.st.update(companyPath(this.orgId, id), { deletedAt: nowIso(), deletedBy: actor.userId, updatedAt: nowIso() });
    await this.feed({ type: 'company_deleted', title: 'Company deleted', description: cur.name, actor: actor.name, targetId: id, targetType: 'company' });
    return { id };
  }

  // ---------------------------------------------------------------- timeline
  async addActivity(kind: 'contact' | 'company', id: string, act: { type: string; title: string; description?: string; actor?: string; source?: string }) {
    const a = { id: newId('act'), timestamp: nowIso(), description: '', actor: 'System', ...act, [`${kind}Id`]: id };
    await this.st.set(`${kind === 'contact' ? contactPath(this.orgId, id) : companyPath(this.orgId, id)}/activities/${a.id}`, a);
    return a;
  }
  async feed(a: { type: string; title: string; description: string; actor?: string; targetId?: string; targetType?: string }) {
    const row = { id: newId('act'), ...a, actor: a.actor || 'System', timestamp: nowIso() };
    await this.st.set(`${this.col('activities')}/${row.id}`, row);
    return row;
  }

  // ---------------------------------------------------------------- profiles
  private async related() {
    const [leads, deals, tasks, proposals, meetings, feed, billingClients, inbound, outbound] = await Promise.all([
      this.st.list(this.col('leads')), this.st.list(this.col('deals')), this.st.list(this.col('tasks')),
      this.st.list(this.col('proposals')), this.st.list(this.col('scheduled_meetings')),
      this.st.list(this.col('activities'), { orderBy: 'timestamp', direction: 'desc', limit: 500 }),
      this.st.list(`billing/${this.orgId}/clients`).catch(() => []),
      this.st.list(this.col('inbound_messages'), { orderBy: 'at', direction: 'desc', limit: 1000 }).catch(() => []),
      this.st.list(this.col('outbound_messages'), { orderBy: 'at', direction: 'desc', limit: 1000 }).catch(() => []),
    ]);
    return { leads, deals, tasks, proposals, meetings, feed, billingClients, inbound, outbound };
  }

  /** Everything the organization knows about one contact, with a combined timeline. */
  async profile(id: string) {
    const contact = await this.st.get(contactPath(this.orgId, id));
    if (!contact || contact.mergedInto) return contact?.mergedInto ? { redirectTo: contact.mergedInto } : null;
    const r = await this.related();
    const emails = new Set([contact.email, ...(contact.altEmails || [])].map(normEmail).filter(Boolean));
    const phones = new Set([contact.phone, ...(contact.altPhones || [])].map(normPhone).filter(Boolean));
    const isMine = (email?: unknown, phone?: unknown) => (normEmail(email) && emails.has(normEmail(email))) || (normPhone(phone) && phones.has(normPhone(phone)));

    const leads = r.leads.filter((l: any) => l.convertedContactId === id || l.contactId === id || isMine(l.email, l.phone));
    const leadIds = new Set(leads.map((l: any) => l.id));
    const deals = r.deals.filter((d: any) => d.contactId === id || (d.originLeadId && leadIds.has(d.originLeadId)));
    const dealIds = new Set(deals.map((d: any) => d.id));
    const tasks = r.tasks.filter((t: any) => !t.deletedAt && (t.contactId === id || (t.leadId && leadIds.has(t.leadId)) || (t.dealId && dealIds.has(t.dealId))));
    const proposals = r.proposals.filter((p: any) => p.crmContactId === id || (p.contactId && (p.contactId === id || leadIds.has(p.contactId))) || isMine(p.client?.email));
    const meetings = r.meetings.filter((m: any) => m.contactId === id || (m.leadId && leadIds.has(m.leadId)) || (m.guests || []).some((g: string) => isMine(g)));
    const invoicingClients = r.billingClients.filter((c: any) => c.contactId === id || isMine(c.email, c.phone));
    const company = contact.companyId ? await this.st.get(companyPath(this.orgId, contact.companyId)) : (contact.company ? await this.findCompanyByName(contact.company) : null);

    // Communication history: inbox conversations (by email) and WhatsApp/SMS (by phone).
    const inbox = await inboxMessagesByEmail(this.orgId).catch(() => new Map());
    const communications = [
      ...[...emails].flatMap((e) => (inbox.get(e) || []).map((m: any) => ({ ...m, kind: 'inbox' }))),
      ...r.inbound.filter((m: any) => isMine(null, m.from)).map((m: any) => ({ at: m.at, fromCustomer: true, text: String(m.body || '').slice(0, 1000), channel: String(m.channel || 'SMS').toUpperCase(), kind: 'phone' })),
      ...r.outbound.filter((m: any) => isMine(null, m.to)).map((m: any) => ({ at: m.at, fromCustomer: false, text: String(m.body || '').slice(0, 1000), channel: String(m.channel || 'SMS').toUpperCase(), kind: 'phone' })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200);

    const own = await this.st.list(`${contactPath(this.orgId, id)}/activities`);
    const leadActs = (await Promise.all(leads.map((l: any) => this.st.list(`${this.col('leads')}/${l.id}/activities`).then((rows) => rows.map((a: any) => ({ ...a, via: { type: 'lead', id: l.id, name: l.name } })))))).flat();
    const targets = new Set([id, ...leadIds, ...dealIds]);
    const feedActs = r.feed.filter((a: any) => a.targetId && targets.has(a.targetId)).map((a: any) => ({ ...a, via: { type: a.targetType || 'record', id: a.targetId } }));
    const timeline = dedupeTimeline([...own.map((a: any) => ({ ...a, via: { type: 'contact', id } })), ...leadActs, ...feedActs]);

    return { contact, company: live(company) ? company : null, leads, deals, tasks, proposals: proposals.map(slimProposal), meetings: meetings.map(slimMeeting), invoicingClients: invoicingClients.map(slimClient), communications, timeline };
  }

  async companyProfile(id: string) {
    const company = await this.st.get(companyPath(this.orgId, id));
    if (!live(company)) return null;
    const key = companyKey(company.name);
    const r = await this.related();
    const contacts = (await this.listAll()).filter((c: any) => live(c) && (c.companyId === id || (!c.companyId && key && companyKey(c.company) === key)));
    const contactIds = new Set(contacts.map((c: any) => c.id));
    const leads = r.leads.filter((l: any) => l.convertedCompanyId === id || (key && companyKey(l.company) === key));
    const leadIds = new Set(leads.map((l: any) => l.id));
    const deals = r.deals.filter((d: any) => d.companyId === id || (d.contactId && contactIds.has(d.contactId)) || (d.originLeadId && leadIds.has(d.originLeadId)) || (key && companyKey(d.client) === key));
    const dealIds = new Set(deals.map((d: any) => d.id));
    const tasks = r.tasks.filter((t: any) => !t.deletedAt && ((t.contactId && contactIds.has(t.contactId)) || (t.leadId && leadIds.has(t.leadId)) || (t.dealId && dealIds.has(t.dealId))));
    const subsidiaries = (await this.st.list(this.col('companies'))).filter((c: any) => live(c) && c.parentCompanyId === id);
    const parent = company.parentCompanyId ? await this.getCompany(company.parentCompanyId) : null;

    const own = await this.st.list(`${companyPath(this.orgId, id)}/activities`);
    const contactActs = (await Promise.all(contacts.map((c: any) => this.st.list(`${contactPath(this.orgId, c.id)}/activities`).then((rows) => rows.map((a: any) => ({ ...a, via: { type: 'contact', id: c.id, name: c.name } })))))).flat();
    const leadActs = (await Promise.all(leads.map((l: any) => this.st.list(`${this.col('leads')}/${l.id}/activities`).then((rows) => rows.map((a: any) => ({ ...a, via: { type: 'lead', id: l.id, name: l.name } })))))).flat();
    const targets = new Set([id, ...contactIds, ...leadIds, ...dealIds]);
    const feedActs = r.feed.filter((a: any) => a.targetId && targets.has(a.targetId)).map((a: any) => ({ ...a, via: { type: a.targetType || 'record', id: a.targetId } }));
    const timeline = dedupeTimeline([...own.map((a: any) => ({ ...a, via: { type: 'company', id } })), ...contactActs, ...leadActs, ...feedActs]);
    const openValue = deals.filter((d: any) => d.stage !== 'won' && d.stage !== 'lost').reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);
    const wonValue = deals.filter((d: any) => d.stage === 'won').reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);
    return { company, parent, subsidiaries, contacts, leads, deals, tasks, totals: { openValue, wonValue, contacts: contacts.length, deals: deals.length }, timeline };
  }
}

function dedupeTimeline(rows: any[]) {
  const seen = new Set<string>();
  return rows.filter((a) => { const k = `${a.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, 200);
}
const slimProposal = (p: any) => ({ id: p.id, number: p.number, title: p.title, status: p.status, total: p.totals?.total ?? null, currency: p.currency, sentAt: p.sentAt ?? null, createdAt: p.createdAt });
const slimMeeting = (m: any) => ({ id: m.id, title: m.title, startTime: m.startTime, endTime: m.endTime, status: m.status, roomCode: m.roomCode });
const slimClient = (c: any) => ({ id: c.id, name: c.name, email: c.email, company: c.company ?? c.companyName ?? '' });

/**
 * Used when a lead is converted: the contact with the same email (or the company with the same name) is
 * reused instead of creating a second record for the same person.
 */
export async function existingForLead(orgId: string, lead: any) {
  const svc = await ContactService.forOrg(orgId);
  const byId = lead.convertedContactId ? await svc.get(lead.convertedContactId) : null;
  const contact = (byId && !byId.redirectTo && live(byId) ? byId : null) || (lead.email ? await svc.findByEmail(lead.email) : null);
  const company = (contact?.companyId ? await svc.getCompany(contact.companyId) : null) || (lead.company ? await svc.findCompanyByName(lead.company) : null);
  return { contact, company };
}
