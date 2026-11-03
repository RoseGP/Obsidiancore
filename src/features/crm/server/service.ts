/**
 * CRM business logic: customers (contacts), leads, deals, tasks, notes,
 * activities (timeline), calendar events, saved views, settings, dashboard,
 * search, duplicate detection/merge, import/export and the public lead form.
 *
 * Every function takes the workspace id first; nothing reads across workspaces.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import { AccountsError } from '../../social-accounts/server/service';
import type { CrmStore } from './store';
import {
  INTERACTION_TYPES, LEAD_STATUSES, PRIORITIES,
  type Activity, type CalendarEvent, type Collection, type Contact, type CrmSettings, type CustomFieldDef, type CustomValues,
  type Deal, type EntityType, type Lead, type Note, type PipelineStage, type RelatedType, type SavedView, type Task,
} from './types';

export const crmError = (status: number, code: string, message: string, field?: string) => new AccountsError(message, status, code as any, field);
const now = () => new Date().toISOString();
const rid = (p: string) => `${p}_${crypto.randomBytes(9).toString('base64url')}`;
const DAY = 86_400_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- validation building blocks ----------

const s = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`);
const email = s(254).refine((v) => v === '' || EMAIL_RE.test(v), 'Enter a valid email address, like name@company.com.');
const phone = s(40).refine((v) => v === '' || /^[+\d][\d\s().-]{5,}$/.test(v), 'Enter a valid phone number.');
const url = s(500).refine((v) => v === '' || /^https?:\/\/\S+\.\S+/.test(v), 'Enter a full web address starting with https://');
const isoDate = z.string().trim().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date.');
const optDate = z.union([isoDate, z.literal(''), z.null()]).transform((v) => (v ? new Date(v).toISOString() : null));
const tags = z.array(s(40).min(1)).max(20, 'Use up to 20 tags.').transform((t) => [...new Map(t.map((x) => [x.toLowerCase(), x])).values()]);
const money = z.coerce.number().min(0, 'Use a positive amount.').max(1e12).transform((n) => Math.round(n * 100) / 100);
const fieldValues = z.record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]));
const related = z.object({ type: z.enum(['contact', 'lead', 'deal']), id: s(64).min(1) });
const ids = z.array(s(64).min(1)).min(1, 'Select at least one record.').max(500, 'Select up to 500 records at a time.');

const contactInput = z.object({
  firstName: s(80), lastName: s(80), company: s(120), title: s(120), email, phone, website: url, address: s(300),
  status: z.enum(['active', 'prospect', 'inactive']), tags, source: s(60), owner: s(80), notes: s(5000), fields: fieldValues,
});
const leadInput = z.object({
  name: s(120), company: s(120), email, phone, status: z.enum(LEAD_STATUSES), priority: z.enum(PRIORITIES), source: s(60),
  score: z.coerce.number().int().min(0).max(100), value: money, assignedTo: s(80), nextFollowUpAt: optDate, tags, notes: s(5000), fields: fieldValues, lostReason: s(300),
});
const dealInput = z.object({
  name: s(160), contactId: z.union([s(64), z.null()]), company: s(120), stageId: s(40), value: money,
  probability: z.union([z.coerce.number().int().min(0).max(100), z.null()]), expectedCloseDate: optDate, owner: s(80), lostReason: s(300), notes: s(5000), tags, fields: fieldValues,
});
const taskInput = z.object({
  title: s(200), description: s(5000), dueAt: optDate, priority: z.enum(PRIORITIES), status: z.enum(['open', 'done']), assignee: s(80), relatedTo: z.union([related, z.null()]),
});
const eventInput = z.object({
  title: s(200), start: isoDate, end: optDate, kind: z.enum(['meeting', 'call', 'demo', 'follow_up', 'other']), location: s(300), attendees: s(1000), relatedTo: z.union([related, z.null()]), notes: s(3000),
});
const listQuery = z.object({
  q: s(200).optional(), status: s(40).optional(), tag: s(40).optional(), owner: s(80).optional(), stage: s(40).optional(), priority: s(20).optional(), source: s(60).optional(),
  due: z.enum(['overdue', 'today', 'week', 'none', 'any']).optional(), relatedType: z.enum(['contact', 'lead', 'deal']).optional(), relatedId: s(64).optional(),
  sort: s(40).optional(), dir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

const norm = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
const digits = (v: string) => v.replace(/\D/g, '');
export const contactName = (c: Pick<Contact, 'firstName' | 'lastName' | 'company'>) => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.company || 'Unnamed customer';

function validateFields(defs: CustomFieldDef[], values: CustomValues): CustomValues {
  const out: CustomValues = {};
  for (const [k, v] of Object.entries(values)) {
    const d = defs.find((x) => x.key === k);
    if (!d) throw crmError(400, 'invalid_input', `Unknown custom field “${k}”.`, `fields.${k}`);
    if (v === null || v === '') { out[k] = null; continue; }
    if (d.kind === 'number') { const n = Number(v); if (!Number.isFinite(n)) throw crmError(400, 'invalid_input', `${d.label} must be a number.`, `fields.${k}`); out[k] = n; }
    else if (d.kind === 'checkbox') out[k] = v === true || v === 'true';
    else if (d.kind === 'date') { if (Number.isNaN(Date.parse(String(v)))) throw crmError(400, 'invalid_input', `${d.label} must be a date.`, `fields.${k}`); out[k] = String(v).slice(0, 10); }
    else if (d.kind === 'select') { if (!d.options.includes(String(v))) throw crmError(400, 'invalid_input', `Choose one of the options for ${d.label}.`, `fields.${k}`); out[k] = String(v); }
    else out[k] = String(v).slice(0, 2000);
  }
  return out;
}

function page<T>(items: T[], q: ListQuery) {
  const offset = q.offset ?? 0; const limit = q.limit ?? 50;
  return { items: items.slice(offset, offset + limit), total: items.length, offset, limit, nextOffset: offset + limit < items.length ? offset + limit : null };
}

function sorter<T>(key: string, dir: 'asc' | 'desc' = 'asc', get: (r: T, k: string) => unknown = (r: any, k) => r[k]) {
  const m = dir === 'desc' ? -1 : 1;
  return (a: T, b: T) => {
    const x = get(a, key); const y = get(b, key);
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * m;
  };
}

const csvCell = (v: unknown) => {
  let t = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; // keep spreadsheet apps from running formulas
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function createCrmService(store: CrmStore) {
  // ---------- helpers ----------
  const mustGet = async <T extends { id: string }>(uid: string, col: Collection, id: string, label: string): Promise<T> => {
    const r = await store.get<T>(uid, col, id);
    if (!r) throw crmError(404, 'not_found', `That ${label} no longer exists. It may have been deleted.`);
    return r;
  };
  const checkVersion = (cur: { version: number }, version: unknown) => {
    if (version !== undefined && version !== null && Number(version) !== cur.version) {
      throw crmError(409, 'conflict', 'Someone else changed this record. Reload to see the latest version, then try again.');
    }
  };
  const colOf = (t: EntityType): Collection => (t === 'contact' ? 'contacts' : t === 'lead' ? 'leads' : 'deals');
  const assertRelated = async (uid: string, rel: { type: EntityType; id: string } | null) => {
    if (rel) await mustGet(uid, colOf(rel.type), rel.id, rel.type === 'contact' ? 'customer' : rel.type);
  };

  async function log(uid: string, kind: string, summary: string, relatedTo: Activity['relatedTo'], actor = 'You') {
    const a: Activity = { id: rid('act'), at: now(), kind, summary: summary.slice(0, 500), relatedTo, actor };
    await store.put(uid, 'activities', [a]);
    if (relatedTo && (relatedTo.type === 'contact' || relatedTo.type === 'lead')) {
      const col = colOf(relatedTo.type);
      const r = await store.get<Contact | Lead>(uid, col, relatedTo.id);
      if (r) await store.put(uid, col, [{ ...r, lastActivityAt: a.at }]);
    }
    return a;
  }

  // ---------- settings ----------
  const fieldDef = z.object({
    key: s(40).regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers and underscores for the field key.'),
    label: s(60).min(1, 'Give the field a name.'), kind: z.enum(['text', 'number', 'date', 'select', 'checkbox']), options: z.array(s(60).min(1)).max(50).default([]),
  });
  const settingsInput = z.object({
    currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, like USD.').optional(),
    pipeline: z.array(z.object({ id: s(40).regex(/^[a-z0-9_]+$/), name: s(40).min(1), probability: z.coerce.number().int().min(0).max(100), kind: z.enum(['open', 'won', 'lost']) })).min(3).max(15).optional(),
    leadSources: z.array(s(60).min(1)).max(40).optional(),
    customFields: z.object({ contact: z.array(fieldDef).max(30), lead: z.array(fieldDef).max(30), deal: z.array(fieldDef).max(30) }).partial().optional(),
  }).strict();

  async function getSettings(uid: string) { return store.settings(uid); }

  async function updateSettings(uid: string, body: unknown) {
    const input = settingsInput.parse(body);
    const cur = await store.settings(uid);
    if (input.pipeline) {
      const ids = new Set(input.pipeline.map((p) => p.id));
      if (ids.size !== input.pipeline.length) throw crmError(400, 'invalid_input', 'Each pipeline stage needs a different id.', 'pipeline');
      if (!input.pipeline.some((p) => p.kind === 'won') || !input.pipeline.some((p) => p.kind === 'lost') || !input.pipeline.some((p) => p.kind === 'open')) {
        throw crmError(400, 'invalid_input', 'The pipeline needs at least one open stage, one “won” stage and one “lost” stage.', 'pipeline');
      }
      const inUse = new Set((await store.all<Deal>(uid, 'deals')).map((d) => d.stageId));
      const missing = [...inUse].filter((id) => !ids.has(id));
      if (missing.length) throw crmError(409, 'stage_in_use', `Move the deals out of “${cur.pipeline.find((p) => p.id === missing[0])?.name ?? missing[0]}” before removing that stage.`, 'pipeline');
    }
    if (input.customFields) {
      for (const [ent, defs] of Object.entries(input.customFields)) {
        const keys = new Set((defs ?? []).map((d) => d.key));
        if (keys.size !== (defs ?? []).length) throw crmError(400, 'invalid_input', `Two ${ent} fields use the same key.`, 'customFields');
        for (const d of defs ?? []) if (d.kind === 'select' && !d.options.length) throw crmError(400, 'invalid_input', `Add options for “${d.label}”.`, 'customFields');
      }
    }
    const next: CrmSettings = {
      ...cur, ...input,
      customFields: { ...cur.customFields, ...(input.customFields ?? {}) } as CrmSettings['customFields'],
      updatedAt: now(),
    };
    await store.saveSettings(uid, next);
    return next;
  }

  async function setCaptureForm(uid: string, enabled: boolean) {
    const cur = await store.settings(uid);
    const next = { ...cur, captureKey: enabled ? crypto.randomBytes(18).toString('base64url') : null, updatedAt: now() };
    await store.saveSettings(uid, next);
    return next;
  }

  // ---------- contacts ----------
  const defaultsContact = { firstName: '', lastName: '', company: '', title: '', email: '', phone: '', website: '', address: '', status: 'active' as const, tags: [], source: '', owner: '', notes: '', fields: {} };

  async function findDuplicateContacts(uid: string, c: Pick<Contact, 'email' | 'phone' | 'firstName' | 'lastName' | 'company'>, exceptId?: string) {
    const all = await store.all<Contact>(uid, 'contacts');
    const e = norm(c.email); const p = digits(c.phone); const n = norm(contactName(c)); const co = norm(c.company);
    return all.filter((x) => x.id !== exceptId && (
      (e && norm(x.email) === e) || (p.length >= 7 && digits(x.phone).endsWith(p.slice(-9))) || (n && co && norm(contactName(x)) === n && norm(x.company) === co)
    )).map((x) => ({ id: x.id, name: contactName(x), company: x.company, email: x.email }));
  }

  async function createContact(uid: string, body: unknown) {
    const settings = await store.settings(uid);
    const input = contactInput.partial().parse(body);
    const data = { ...defaultsContact, ...input };
    if (!data.firstName && !data.lastName && !data.company) throw crmError(400, 'invalid_input', 'Add a name or a company.', 'firstName');
    data.fields = validateFields(settings.customFields.contact, data.fields ?? {});
    const t = now();
    const c: Contact = { ...data, id: rid('con'), createdAt: t, updatedAt: t, version: 1, lastActivityAt: t } as Contact;
    const duplicates = await findDuplicateContacts(uid, c);
    await store.put(uid, 'contacts', [c]);
    await log(uid, 'created', `Customer ${contactName(c)} added`, { type: 'contact', id: c.id });
    return { contact: c, possibleDuplicates: duplicates };
  }

  async function updateContact(uid: string, id: string, body: any) {
    const cur = await mustGet<Contact>(uid, 'contacts', id, 'customer');
    checkVersion(cur, body?.version);
    const { version: _v, ...patch } = body ?? {};
    const input = contactInput.partial().parse(patch);
    const settings = await store.settings(uid);
    const next: Contact = { ...cur, ...input, fields: input.fields ? validateFields(settings.customFields.contact, { ...cur.fields, ...input.fields }) : cur.fields, updatedAt: now(), version: cur.version + 1 } as Contact;
    if (!next.firstName && !next.lastName && !next.company) throw crmError(400, 'invalid_input', 'Add a name or a company.', 'firstName');
    await store.put(uid, 'contacts', [next]);
    const changed = Object.keys(input).filter((k) => JSON.stringify((cur as any)[k]) !== JSON.stringify((next as any)[k]));
    if (changed.length) await log(uid, input.status && input.status !== cur.status ? 'status' : 'updated', input.status && input.status !== cur.status ? `Status changed to ${input.status}` : `Updated ${changed.join(', ')}`, { type: 'contact', id });
    return { contact: (await store.get<Contact>(uid, 'contacts', id))!, possibleDuplicates: await findDuplicateContacts(uid, next, id) };
  }

  /** Deletes the customer and their notes; deals, tasks and events are kept and unlinked. */
  async function deleteContacts(uid: string, idList: string[]) {
    const set = new Set(idList);
    const existing = (await store.all<Contact>(uid, 'contacts')).filter((c) => set.has(c.id));
    if (!existing.length) throw crmError(404, 'not_found', 'Those customers no longer exist.');
    const del = existing.map((c) => c.id); const delSet = new Set(del);
    const notes = (await store.all<Note>(uid, 'notes')).filter((n) => n.relatedTo.type === 'contact' && delSet.has(n.relatedTo.id));
    await store.remove(uid, 'notes', notes.map((n) => n.id));
    const t = now();
    const deals = (await store.all<Deal>(uid, 'deals')).filter((d) => d.contactId && delSet.has(d.contactId)).map((d) => ({ ...d, contactId: null, updatedAt: t, version: d.version + 1 }));
    await store.put(uid, 'deals', deals);
    const tasks = (await store.all<Task>(uid, 'tasks')).filter((x) => x.relatedTo?.type === 'contact' && delSet.has(x.relatedTo.id)).map((x) => ({ ...x, relatedTo: null, updatedAt: t, version: x.version + 1 }));
    await store.put(uid, 'tasks', tasks);
    const events = (await store.all<CalendarEvent>(uid, 'events')).filter((x) => x.relatedTo?.type === 'contact' && delSet.has(x.relatedTo.id)).map((x) => ({ ...x, relatedTo: null }));
    await store.put(uid, 'events', events);
    const leads = (await store.all<Lead>(uid, 'leads')).filter((l) => l.contactId && delSet.has(l.contactId)).map((l) => ({ ...l, contactId: null }));
    await store.put(uid, 'leads', leads);
    await store.remove(uid, 'contacts', del);
    for (const c of existing) await log(uid, 'deleted', `Customer ${contactName(c)} deleted`, null);
    return { deleted: del.length, unlinked: { deals: deals.length, tasks: tasks.length } };
  }

  function matchContact(c: Contact, q: ListQuery) {
    if (q.status && c.status !== q.status) return false;
    if (q.tag && !c.tags.some((t) => norm(t) === norm(q.tag))) return false;
    if (q.owner && norm(c.owner) !== norm(q.owner)) return false;
    if (q.source && norm(c.source) !== norm(q.source)) return false;
    if (q.q) {
      const hay = norm([contactName(c), c.company, c.email, c.phone, c.title, c.tags.join(' '), Object.values(c.fields).join(' ')].join(' '));
      const qd = digits(q.q);
      if (!norm(q.q).split(/\s+/).every((w) => hay.includes(w)) && !(qd.length >= 4 && digits(c.phone).includes(qd))) return false;
    }
    return true;
  }

  async function listContacts(uid: string, raw: unknown) {
    const q = listQuery.parse(raw);
    const all = (await store.all<Contact>(uid, 'contacts')).filter((c) => matchContact(c, q));
    const key = q.sort ?? 'updatedAt';
    all.sort(sorter<Contact>(key, q.dir ?? (key === 'updatedAt' || key === 'createdAt' || key === 'lastActivityAt' ? 'desc' : 'asc'), (r, k) => (k === 'name' ? contactName(r) : (r as any)[k])));
    const allTags = [...new Set((await store.all<Contact>(uid, 'contacts')).flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b));
    return { ...page(all, q), facets: { tags: allTags } };
  }

  async function getContact(uid: string, id: string) {
    const contact = await mustGet<Contact>(uid, 'contacts', id, 'customer');
    const [notes, tasks, deals, leads, activities, events] = await Promise.all([
      store.all<Note>(uid, 'notes'), store.all<Task>(uid, 'tasks'), store.all<Deal>(uid, 'deals'), store.all<Lead>(uid, 'leads'), store.all<Activity>(uid, 'activities'), store.all<CalendarEvent>(uid, 'events'),
    ]);
    const myDeals = deals.filter((d) => d.contactId === id);
    const myLeads = leads.filter((l) => l.contactId === id);
    const relatedIds = new Set([`contact:${id}`, ...myDeals.map((d) => `deal:${d.id}`), ...myLeads.map((l) => `lead:${l.id}`)]);
    const isMine = (r: { type: string; id: string } | null) => !!r && relatedIds.has(`${r.type}:${r.id}`);
    return {
      contact,
      notes: notes.filter((n) => isMine(n.relatedTo)).sort(sorter<Note>('createdAt', 'desc')),
      tasks: tasks.filter((t) => isMine(t.relatedTo)).sort(sorter<Task>('dueAt', 'asc')),
      deals: myDeals.sort(sorter<Deal>('updatedAt', 'desc')),
      leads: myLeads,
      events: events.filter((e) => isMine(e.relatedTo)).sort(sorter<CalendarEvent>('start', 'desc')),
      activities: activities.filter((a) => isMine(a.relatedTo)).sort(sorter<Activity>('at', 'desc')).slice(0, 200),
      possibleDuplicates: await findDuplicateContacts(uid, contact, id),
    };
  }

  async function duplicateGroups(uid: string) {
    const all = await store.all<Contact>(uid, 'contacts');
    const groups = new Map<string, { reason: string; ids: Set<string> }>();
    const add = (k: string, reason: string, id: string) => { if (!groups.has(k)) groups.set(k, { reason, ids: new Set() }); groups.get(k)!.ids.add(id); };
    for (const c of all) {
      if (norm(c.email)) add(`e:${norm(c.email)}`, 'Same email', c.id);
      const p = digits(c.phone); if (p.length >= 7) add(`p:${p.slice(-9)}`, 'Same phone number', c.id);
      if (norm(contactName(c)) && norm(c.company)) add(`n:${norm(contactName(c))}|${norm(c.company)}`, 'Same name and company', c.id);
    }
    const byId = new Map(all.map((c) => [c.id, c]));
    const seen = new Set<string>(); const out: { reason: string; contacts: Contact[] }[] = [];
    for (const g of groups.values()) {
      if (g.ids.size < 2) continue;
      const k = [...g.ids].sort().join(','); if (seen.has(k)) continue; seen.add(k);
      out.push({ reason: g.reason, contacts: [...g.ids].map((i) => byId.get(i)!).sort(sorter<Contact>('createdAt')) });
    }
    return out;
  }

  /** Merges `mergeIds` into `keepId`: fills empty fields, unions tags, moves notes, tasks, deals, leads, events and history. */
  async function mergeContacts(uid: string, keepId: string, mergeIds: string[]) {
    const keep = await mustGet<Contact>(uid, 'contacts', keepId, 'customer');
    const others = (await Promise.all(mergeIds.filter((i) => i !== keepId).map((i) => mustGet<Contact>(uid, 'contacts', i, 'customer'))));
    if (!others.length) throw crmError(400, 'invalid_input', 'Choose at least one other customer to merge.');
    const merged: Contact = { ...keep };
    for (const o of others) {
      for (const k of ['firstName', 'lastName', 'company', 'title', 'email', 'phone', 'website', 'address', 'source', 'owner'] as const) if (!merged[k] && o[k]) merged[k] = o[k];
      merged.tags = [...new Map([...merged.tags, ...o.tags].map((x) => [x.toLowerCase(), x])).values()];
      merged.fields = { ...o.fields, ...Object.fromEntries(Object.entries(merged.fields).filter(([, v]) => v !== null && v !== '')) };
      if (o.notes) merged.notes = [merged.notes, o.notes].filter(Boolean).join('\n\n').slice(0, 5000);
    }
    const t = now(); merged.updatedAt = t; merged.version += 1;
    const gone = new Set(others.map((o) => o.id));
    const re = <T extends { relatedTo: any }>(x: T): T => (x.relatedTo?.type === 'contact' && gone.has(x.relatedTo.id) ? { ...x, relatedTo: { type: 'contact', id: keepId } } : x);
    const notes = (await store.all<Note>(uid, 'notes')).filter((n) => n.relatedTo.type === 'contact' && gone.has(n.relatedTo.id)).map(re);
    const tasks = (await store.all<Task>(uid, 'tasks')).filter((n) => n.relatedTo?.type === 'contact' && gone.has(n.relatedTo.id)).map(re);
    const events = (await store.all<CalendarEvent>(uid, 'events')).filter((n) => n.relatedTo?.type === 'contact' && gone.has(n.relatedTo.id)).map(re);
    const acts = (await store.all<Activity>(uid, 'activities')).filter((n) => n.relatedTo?.type === 'contact' && gone.has(n.relatedTo.id)).map(re);
    const deals = (await store.all<Deal>(uid, 'deals')).filter((d) => d.contactId && gone.has(d.contactId)).map((d) => ({ ...d, contactId: keepId }));
    const leads = (await store.all<Lead>(uid, 'leads')).filter((d) => d.contactId && gone.has(d.contactId)).map((d) => ({ ...d, contactId: keepId }));
    await store.put(uid, 'notes', notes); await store.put(uid, 'tasks', tasks); await store.put(uid, 'events', events); await store.put(uid, 'activities', acts);
    await store.put(uid, 'deals', deals); await store.put(uid, 'leads', leads);
    await store.put(uid, 'contacts', [merged]);
    await store.remove(uid, 'contacts', [...gone]);
    await log(uid, 'merged', `Merged ${others.map(contactName).join(', ')} into this customer`, { type: 'contact', id: keepId });
    return { contact: merged, merged: others.length };
  }

  async function bulkContacts(uid: string, body: unknown) {
    const b = z.object({ action: z.enum(['delete', 'addTag', 'removeTag', 'setStatus', 'setOwner']), ids, value: s(80).optional() }).strict().parse(body);
    if (b.action === 'delete') return deleteContacts(uid, b.ids);
    if (!b.value && b.action !== 'setOwner') throw crmError(400, 'invalid_input', 'Choose a value for this action.', 'value');
    if (b.action === 'setStatus' && !['active', 'prospect', 'inactive'].includes(b.value!)) throw crmError(400, 'invalid_input', 'Choose a valid status.', 'value');
    const set = new Set(b.ids); const t = now();
    const recs = (await store.all<Contact>(uid, 'contacts')).filter((c) => set.has(c.id)).map((c) => {
      const n = { ...c, updatedAt: t, version: c.version + 1 };
      if (b.action === 'addTag') n.tags = [...new Map([...c.tags, b.value!].map((x) => [x.toLowerCase(), x])).values()].slice(0, 20);
      if (b.action === 'removeTag') n.tags = c.tags.filter((x) => norm(x) !== norm(b.value));
      if (b.action === 'setStatus') n.status = b.value as Contact['status'];
      if (b.action === 'setOwner') n.owner = b.value ?? '';
      return n;
    });
    await store.put(uid, 'contacts', recs);
    return { updated: recs.length };
  }

  // ---------- leads ----------
  const defaultsLead = { name: '', company: '', email: '', phone: '', status: 'new' as const, priority: 'normal' as const, source: '', score: 0, value: 0, assignedTo: '', nextFollowUpAt: null, tags: [], notes: '', fields: {}, lostReason: '' };

  async function findDuplicateLeads(uid: string, l: Pick<Lead, 'email' | 'phone' | 'name' | 'company'>, exceptId?: string) {
    const [leads, contacts] = await Promise.all([store.all<Lead>(uid, 'leads'), store.all<Contact>(uid, 'contacts')]);
    const e = norm(l.email); const p = digits(l.phone); const n = norm(l.name); const co = norm(l.company);
    const hit = (em: string, ph: string, nm: string, c: string) => (e && norm(em) === e) || (p.length >= 7 && digits(ph).endsWith(p.slice(-9))) || (!!n && !!co && norm(nm) === n && norm(c) === co);
    return [
      ...leads.filter((x) => x.id !== exceptId && x.status !== 'converted' && hit(x.email, x.phone, x.name, x.company)).map((x) => ({ type: 'lead' as const, id: x.id, name: x.name, company: x.company })),
      ...contacts.filter((x) => hit(x.email, x.phone, contactName(x), x.company)).map((x) => ({ type: 'contact' as const, id: x.id, name: contactName(x), company: x.company })),
    ];
  }

  async function createLead(uid: string, body: unknown, actor = 'You') {
    const settings = await store.settings(uid);
    const input = leadInput.partial().parse(body);
    const data = { ...defaultsLead, ...input };
    if (!data.name && !data.company) throw crmError(400, 'invalid_input', 'Add a name or a company for the lead.', 'name');
    if (data.status === 'converted') throw crmError(400, 'invalid_input', 'Use “Convert” to turn a lead into a customer.', 'status');
    data.fields = validateFields(settings.customFields.lead, data.fields ?? {});
    const t = now();
    const l: Lead = { ...data, id: rid('lead'), createdAt: t, updatedAt: t, version: 1, convertedAt: null, contactId: null, dealId: null, lastActivityAt: t } as Lead;
    const duplicates = await findDuplicateLeads(uid, l);
    await store.put(uid, 'leads', [l]);
    await log(uid, 'created', `Lead ${l.name || l.company} added${l.source ? ` from ${l.source}` : ''}`, { type: 'lead', id: l.id }, actor);
    return { lead: l, possibleDuplicates: duplicates };
  }

  async function updateLead(uid: string, id: string, body: any) {
    const cur = await mustGet<Lead>(uid, 'leads', id, 'lead');
    checkVersion(cur, body?.version);
    const { version: _v, ...patch } = body ?? {};
    const input = leadInput.partial().parse(patch);
    if (input.status === 'converted' && cur.status !== 'converted') throw crmError(400, 'invalid_input', 'Use “Convert” to turn a lead into a customer.', 'status');
    if (cur.status === 'converted' && input.status && input.status !== 'converted') throw crmError(409, 'conflict', 'This lead was already converted. Edit the customer instead.');
    const settings = await store.settings(uid);
    const next: Lead = { ...cur, ...input, fields: input.fields ? validateFields(settings.customFields.lead, { ...cur.fields, ...input.fields }) : cur.fields, updatedAt: now(), version: cur.version + 1 } as Lead;
    if (!next.name && !next.company) throw crmError(400, 'invalid_input', 'Add a name or a company for the lead.', 'name');
    await store.put(uid, 'leads', [next]);
    if (input.status && input.status !== cur.status) await log(uid, 'status', `Status changed from ${cur.status} to ${input.status}${input.status === 'lost' && next.lostReason ? ` (${next.lostReason})` : ''}`, { type: 'lead', id });
    else if (input.assignedTo !== undefined && input.assignedTo !== cur.assignedTo) await log(uid, 'assigned', next.assignedTo ? `Assigned to ${next.assignedTo}` : 'Unassigned', { type: 'lead', id });
    else if (input.nextFollowUpAt !== undefined && input.nextFollowUpAt !== cur.nextFollowUpAt) await log(uid, 'follow_up', next.nextFollowUpAt ? `Follow-up set for ${next.nextFollowUpAt.slice(0, 10)}` : 'Follow-up cleared', { type: 'lead', id });
    return { lead: (await store.get<Lead>(uid, 'leads', id))! };
  }

  async function deleteLeads(uid: string, idList: string[]) {
    const set = new Set(idList);
    const existing = (await store.all<Lead>(uid, 'leads')).filter((l) => set.has(l.id));
    if (!existing.length) throw crmError(404, 'not_found', 'Those leads no longer exist.');
    const del = new Set(existing.map((l) => l.id));
    const notes = (await store.all<Note>(uid, 'notes')).filter((n) => n.relatedTo.type === 'lead' && del.has(n.relatedTo.id));
    await store.remove(uid, 'notes', notes.map((n) => n.id));
    const tasks = (await store.all<Task>(uid, 'tasks')).filter((x) => x.relatedTo?.type === 'lead' && del.has(x.relatedTo.id)).map((x) => ({ ...x, relatedTo: null }));
    await store.put(uid, 'tasks', tasks);
    await store.remove(uid, 'leads', [...del]);
    for (const l of existing) await log(uid, 'deleted', `Lead ${l.name || l.company} deleted`, null);
    return { deleted: del.size };
  }

  function matchLead(l: Lead, q: ListQuery) {
    if (q.status) { if (q.status === 'active' ? !['new', 'contacted', 'qualified'].includes(l.status) : l.status !== q.status) return false; }
    if (q.priority && l.priority !== q.priority) return false;
    if (q.source && norm(l.source) !== norm(q.source)) return false;
    if (q.owner && norm(l.assignedTo) !== norm(q.owner)) return false;
    if (q.tag && !l.tags.some((t) => norm(t) === norm(q.tag))) return false;
    if (q.due) {
      const f = l.nextFollowUpAt ? Date.parse(l.nextFollowUpAt) : null; const t0 = startOfToday();
      if (q.due === 'overdue' && !(f !== null && f < t0)) return false;
      if (q.due === 'today' && !(f !== null && f >= t0 && f < t0 + DAY)) return false;
      if (q.due === 'week' && !(f !== null && f < t0 + 7 * DAY)) return false;
      if (q.due === 'none' && f !== null) return false;
    }
    if (q.q && !norm(q.q).split(/\s+/).every((w) => norm([l.name, l.company, l.email, l.phone, l.source, l.tags.join(' '), l.notes].join(' ')).includes(w))) return false;
    return true;
  }

  async function listLeads(uid: string, raw: unknown) {
    const q = listQuery.parse(raw);
    const PR = { urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>;
    const items = (await store.all<Lead>(uid, 'leads')).filter((l) => matchLead(l, q));
    const key = q.sort ?? 'createdAt';
    items.sort(sorter<Lead>(key, q.dir ?? (['createdAt', 'updatedAt', 'score', 'value'].includes(key) ? 'desc' : 'asc'), (r, k) => (k === 'priority' ? PR[r.priority] : (r as any)[k])));
    return page(items, q);
  }

  async function getLead(uid: string, id: string) {
    const lead = await mustGet<Lead>(uid, 'leads', id, 'lead');
    const [notes, tasks, acts] = await Promise.all([store.all<Note>(uid, 'notes'), store.all<Task>(uid, 'tasks'), store.all<Activity>(uid, 'activities')]);
    const mine = (r: { type: string; id: string } | null) => r?.type === 'lead' && r.id === id;
    return {
      lead,
      notes: notes.filter((n) => mine(n.relatedTo)).sort(sorter<Note>('createdAt', 'desc')),
      tasks: tasks.filter((t) => mine(t.relatedTo)).sort(sorter<Task>('dueAt')),
      activities: acts.filter((a) => mine(a.relatedTo)).sort(sorter<Activity>('at', 'desc')).slice(0, 200),
      possibleDuplicates: await findDuplicateLeads(uid, lead, id),
    };
  }

  async function convertLead(uid: string, id: string, body: unknown) {
    const b = z.object({ createDeal: z.boolean().default(true), dealName: s(160).optional(), value: money.optional(), stageId: s(40).optional(), existingContactId: s(64).optional() }).strict().parse(body ?? {});
    const lead = await mustGet<Lead>(uid, 'leads', id, 'lead');
    if (lead.status === 'converted') throw crmError(409, 'already_converted', 'This lead was already converted.');
    const settings = await store.settings(uid);
    const t = now();
    let contact: Contact;
    if (b.existingContactId) contact = await mustGet<Contact>(uid, 'contacts', b.existingContactId, 'customer');
    else {
      const [first, ...rest] = (lead.name || '').split(/\s+/);
      contact = { ...defaultsContact, id: rid('con'), firstName: first ?? '', lastName: rest.join(' '), company: lead.company, email: lead.email, phone: lead.phone, source: lead.source, owner: lead.assignedTo, tags: lead.tags, notes: lead.notes, status: 'active', fields: {}, createdAt: t, updatedAt: t, version: 1, lastActivityAt: t };
      await store.put(uid, 'contacts', [contact]);
    }
    let deal: Deal | null = null;
    if (b.createDeal) {
      const stage = settings.pipeline.find((p) => p.id === b.stageId) ?? settings.pipeline.find((p) => p.kind === 'open')!;
      deal = { id: rid('deal'), name: b.dealName || `${lead.company || lead.name} deal`, contactId: contact.id, leadId: lead.id, company: lead.company, stageId: stage.id, value: b.value ?? lead.value, probability: null, expectedCloseDate: null, owner: lead.assignedTo, closedAt: null, lostReason: '', notes: '', tags: [], fields: {}, createdAt: t, updatedAt: t, version: 1 };
      await store.put(uid, 'deals', [deal]);
    }
    // The customer's timeline shows the lead's notes and open tasks.
    const notes = (await store.all<Note>(uid, 'notes')).filter((n) => n.relatedTo.type === 'lead' && n.relatedTo.id === id).map((n) => ({ ...n, relatedTo: { type: 'contact' as const, id: contact.id } }));
    const tasks = (await store.all<Task>(uid, 'tasks')).filter((x) => x.relatedTo?.type === 'lead' && x.relatedTo.id === id).map((x) => ({ ...x, relatedTo: { type: 'contact' as const, id: contact.id } }));
    await store.put(uid, 'notes', notes); await store.put(uid, 'tasks', tasks);
    const updated: Lead = { ...lead, status: 'converted', convertedAt: t, contactId: contact.id, dealId: deal?.id ?? null, updatedAt: t, version: lead.version + 1 };
    await store.put(uid, 'leads', [updated]);
    await log(uid, 'converted', `Converted to customer${deal ? ` with deal “${deal.name}”` : ''}`, { type: 'lead', id });
    await log(uid, 'converted', `Became a customer from lead ${lead.name || lead.company}`, { type: 'contact', id: contact.id });
    return { lead: updated, contact, deal };
  }

  async function bulkLeads(uid: string, body: unknown) {
    const b = z.object({ action: z.enum(['delete', 'setStatus', 'assign', 'setPriority']), ids, value: s(80).optional() }).strict().parse(body);
    if (b.action === 'delete') return deleteLeads(uid, b.ids);
    if (b.action === 'setStatus' && (!(LEAD_STATUSES as readonly string[]).includes(b.value ?? '') || b.value === 'converted')) throw crmError(400, 'invalid_input', 'Choose a valid status. Convert leads one at a time.', 'value');
    if (b.action === 'setPriority' && !(PRIORITIES as readonly string[]).includes(b.value ?? '')) throw crmError(400, 'invalid_input', 'Choose a valid priority.', 'value');
    const set = new Set(b.ids); const t = now(); let skipped = 0;
    const recs = (await store.all<Lead>(uid, 'leads')).filter((l) => set.has(l.id)).flatMap((l) => {
      if (l.status === 'converted' && b.action === 'setStatus') { skipped++; return []; }
      const n = { ...l, updatedAt: t, version: l.version + 1 };
      if (b.action === 'setStatus') n.status = b.value as Lead['status'];
      if (b.action === 'assign') n.assignedTo = b.value ?? '';
      if (b.action === 'setPriority') n.priority = b.value as Lead['priority'];
      return [n];
    });
    await store.put(uid, 'leads', recs);
    for (const r of recs) if (b.action === 'setStatus') await log(uid, 'status', `Status changed to ${r.status}`, { type: 'lead', id: r.id });
    return { updated: recs.length, skipped };
  }

  // ---------- deals ----------
  const stageOf = (settings: CrmSettings, id: string): PipelineStage | undefined => settings.pipeline.find((p) => p.id === id);
  const probabilityOf = (settings: CrmSettings, d: Deal) => d.probability ?? stageOf(settings, d.stageId)?.probability ?? 0;

  async function createDeal(uid: string, body: unknown) {
    const settings = await store.settings(uid);
    const input = dealInput.partial().parse(body);
    if (!input.name) throw crmError(400, 'invalid_input', 'Give the deal a name.', 'name');
    const stageId = input.stageId || settings.pipeline.find((p) => p.kind === 'open')!.id;
    const stage = stageOf(settings, stageId);
    if (!stage) throw crmError(400, 'invalid_input', 'Choose a pipeline stage.', 'stageId');
    if (input.contactId) await mustGet<Contact>(uid, 'contacts', input.contactId, 'customer');
    const t = now();
    const d: Deal = { name: input.name, contactId: input.contactId ?? null, leadId: null, company: input.company ?? '', stageId, value: input.value ?? 0, probability: input.probability ?? null, expectedCloseDate: input.expectedCloseDate ?? null, owner: input.owner ?? '', closedAt: stage.kind === 'open' ? null : t, lostReason: input.lostReason ?? '', notes: input.notes ?? '', tags: input.tags ?? [], fields: validateFields(settings.customFields.deal, input.fields ?? {}), id: rid('deal'), createdAt: t, updatedAt: t, version: 1 };
    if (!d.company && d.contactId) d.company = (await store.get<Contact>(uid, 'contacts', d.contactId))?.company ?? '';
    await store.put(uid, 'deals', [d]);
    await log(uid, 'created', `Deal “${d.name}” created in ${stage.name}`, { type: 'deal', id: d.id });
    if (d.contactId) await log(uid, 'deal', `Deal “${d.name}” created`, { type: 'contact', id: d.contactId });
    return { deal: d };
  }

  async function updateDeal(uid: string, id: string, body: any) {
    const cur = await mustGet<Deal>(uid, 'deals', id, 'deal');
    checkVersion(cur, body?.version);
    const { version: _v, ...patch } = body ?? {};
    const input = dealInput.partial().parse(patch);
    const settings = await store.settings(uid);
    if (input.stageId && !stageOf(settings, input.stageId)) throw crmError(400, 'invalid_input', 'Choose a pipeline stage.', 'stageId');
    if (input.contactId) await mustGet<Contact>(uid, 'contacts', input.contactId, 'customer');
    if (input.name !== undefined && !input.name) throw crmError(400, 'invalid_input', 'Give the deal a name.', 'name');
    const t = now();
    const next: Deal = { ...cur, ...input, fields: input.fields ? validateFields(settings.customFields.deal, { ...cur.fields, ...input.fields }) : cur.fields, updatedAt: t, version: cur.version + 1 } as Deal;
    if (input.stageId && input.stageId !== cur.stageId) {
      const to = stageOf(settings, input.stageId)!; const from = stageOf(settings, cur.stageId);
      next.closedAt = to.kind === 'open' ? null : t;
      await store.put(uid, 'deals', [next]);
      await log(uid, 'stage', `Moved from ${from?.name ?? cur.stageId} to ${to.name}${to.kind === 'lost' && next.lostReason ? ` (${next.lostReason})` : ''}`, { type: 'deal', id });
      if (next.contactId && to.kind !== 'open') await log(uid, 'deal', `Deal “${next.name}” ${to.kind === 'won' ? 'won' : 'lost'}`, { type: 'contact', id: next.contactId });
    } else {
      await store.put(uid, 'deals', [next]);
      const changed = Object.keys(input).filter((k) => JSON.stringify((cur as any)[k]) !== JSON.stringify((next as any)[k]));
      if (changed.length) await log(uid, 'updated', `Updated ${changed.join(', ')}`, { type: 'deal', id });
    }
    return { deal: next };
  }

  async function deleteDeals(uid: string, idList: string[]) {
    const set = new Set(idList);
    const existing = (await store.all<Deal>(uid, 'deals')).filter((d) => set.has(d.id));
    if (!existing.length) throw crmError(404, 'not_found', 'That deal no longer exists.');
    const del = new Set(existing.map((d) => d.id));
    const notes = (await store.all<Note>(uid, 'notes')).filter((n) => n.relatedTo.type === 'deal' && del.has(n.relatedTo.id));
    await store.remove(uid, 'notes', notes.map((n) => n.id));
    const tasks = (await store.all<Task>(uid, 'tasks')).filter((x) => x.relatedTo?.type === 'deal' && del.has(x.relatedTo.id)).map((x) => ({ ...x, relatedTo: null }));
    await store.put(uid, 'tasks', tasks);
    const leads = (await store.all<Lead>(uid, 'leads')).filter((l) => l.dealId && del.has(l.dealId)).map((l) => ({ ...l, dealId: null }));
    await store.put(uid, 'leads', leads);
    await store.remove(uid, 'deals', [...del]);
    for (const d of existing) await log(uid, 'deleted', `Deal “${d.name}” deleted`, d.contactId ? { type: 'contact', id: d.contactId } : null);
    return { deleted: del.size };
  }

  async function listDeals(uid: string, raw: unknown) {
    const q = listQuery.parse(raw);
    const settings = await store.settings(uid);
    const contacts = new Map((await store.all<Contact>(uid, 'contacts')).map((c) => [c.id, c]));
    let items = await store.all<Deal>(uid, 'deals');
    if (q.stage) items = items.filter((d) => d.stageId === q.stage);
    if (q.status === 'open') items = items.filter((d) => stageOf(settings, d.stageId)?.kind === 'open');
    if (q.owner) items = items.filter((d) => norm(d.owner) === norm(q.owner));
    if (q.relatedId) items = items.filter((d) => d.contactId === q.relatedId);
    if (q.q) items = items.filter((d) => norm(q.q).split(/\s+/).every((w) => norm([d.name, d.company, d.owner, d.contactId ? contactName(contacts.get(d.contactId) ?? { firstName: '', lastName: '', company: '' }) : ''].join(' ')).includes(w)));
    items.sort(sorter<Deal>(q.sort ?? 'updatedAt', q.dir ?? 'desc'));
    const out = page(items, { ...q, limit: q.limit ?? 500 });
    return { ...out, items: out.items.map((d) => ({ ...d, contactName: d.contactId && contacts.get(d.contactId) ? contactName(contacts.get(d.contactId)!) : null, effectiveProbability: probabilityOf(settings, d) })) };
  }

  async function getDeal(uid: string, id: string) {
    const deal = await mustGet<Deal>(uid, 'deals', id, 'deal');
    const [notes, tasks, acts] = await Promise.all([store.all<Note>(uid, 'notes'), store.all<Task>(uid, 'tasks'), store.all<Activity>(uid, 'activities')]);
    const mine = (r: { type: string; id: string } | null) => r?.type === 'deal' && r.id === id;
    const contact = deal.contactId ? await store.get<Contact>(uid, 'contacts', deal.contactId) : null;
    return {
      deal, contact,
      notes: notes.filter((n) => mine(n.relatedTo)).sort(sorter<Note>('createdAt', 'desc')),
      tasks: tasks.filter((t) => mine(t.relatedTo)).sort(sorter<Task>('dueAt')),
      activities: acts.filter((a) => mine(a.relatedTo)).sort(sorter<Activity>('at', 'desc')).slice(0, 200),
    };
  }

  // ---------- tasks ----------
  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

  async function createTask(uid: string, body: unknown) {
    const input = taskInput.partial().parse(body);
    if (!input.title) throw crmError(400, 'invalid_input', 'Give the task a title.', 'title');
    await assertRelated(uid, input.relatedTo ?? null);
    const t = now();
    const task: Task = { title: input.title, description: input.description ?? '', dueAt: input.dueAt ?? null, priority: input.priority ?? 'normal', status: 'open', assignee: input.assignee ?? '', relatedTo: input.relatedTo ?? null, completedAt: null, id: rid('task'), createdAt: t, updatedAt: t, version: 1 };
    await store.put(uid, 'tasks', [task]);
    if (task.relatedTo) await log(uid, 'task', `Task “${task.title}” added${task.dueAt ? `, due ${task.dueAt.slice(0, 10)}` : ''}`, task.relatedTo);
    return { task };
  }

  async function updateTask(uid: string, id: string, body: any) {
    const cur = await mustGet<Task>(uid, 'tasks', id, 'task');
    checkVersion(cur, body?.version);
    const { version: _v, ...patch } = body ?? {};
    const input = taskInput.partial().parse(patch);
    if (input.title !== undefined && !input.title) throw crmError(400, 'invalid_input', 'Give the task a title.', 'title');
    if (input.relatedTo !== undefined) await assertRelated(uid, input.relatedTo);
    const t = now();
    const next: Task = { ...cur, ...input, updatedAt: t, version: cur.version + 1 } as Task;
    if (input.status === 'done' && cur.status !== 'done') next.completedAt = t;
    if (input.status === 'open') next.completedAt = null;
    await store.put(uid, 'tasks', [next]);
    if (input.status === 'done' && cur.status !== 'done' && next.relatedTo) await log(uid, 'task_done', `Completed task “${next.title}”`, next.relatedTo);
    return { task: next };
  }

  async function deleteTasks(uid: string, idList: string[]) {
    const set = new Set(idList);
    const del = (await store.all<Task>(uid, 'tasks')).filter((x) => set.has(x.id)).map((x) => x.id);
    if (!del.length) throw crmError(404, 'not_found', 'Those tasks no longer exist.');
    await store.remove(uid, 'tasks', del);
    return { deleted: del.length };
  }

  async function listTasks(uid: string, raw: unknown) {
    const q = listQuery.parse(raw);
    const t0 = startOfToday();
    let items = await store.all<Task>(uid, 'tasks');
    if (q.status && q.status !== 'all') items = items.filter((x) => x.status === q.status);
    if (q.priority) items = items.filter((x) => x.priority === q.priority);
    if (q.owner) items = items.filter((x) => norm(x.assignee) === norm(q.owner));
    if (q.relatedType && q.relatedId) items = items.filter((x) => x.relatedTo?.type === q.relatedType && x.relatedTo.id === q.relatedId);
    if (q.due && q.due !== 'any') items = items.filter((x) => {
      const d = x.dueAt ? Date.parse(x.dueAt) : null;
      if (q.due === 'none') return d === null;
      if (d === null) return false;
      if (q.due === 'overdue') return x.status === 'open' && d < t0;
      if (q.due === 'today') return d >= t0 && d < t0 + DAY;
      return d < t0 + 7 * DAY;
    });
    if (q.q) items = items.filter((x) => norm(q.q).split(/\s+/).every((w) => norm(`${x.title} ${x.description} ${x.assignee}`).includes(w)));
    const PR = { urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>;
    items.sort(q.sort ? sorter<Task>(q.sort, q.dir ?? 'asc', (r, k) => (k === 'priority' ? PR[r.priority] : (r as any)[k])) : (a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1) || sorter<Task>('dueAt')(a, b) || PR[a.priority] - PR[b.priority]);
    const names = await relatedNames(uid);
    const out = page(items, { ...q, limit: q.limit ?? 200 });
    return { ...out, items: out.items.map((x) => ({ ...x, overdue: x.status === 'open' && !!x.dueAt && Date.parse(x.dueAt) < t0, relatedName: x.relatedTo ? names.get(`${x.relatedTo.type}:${x.relatedTo.id}`) ?? null : null })) };
  }

  async function bulkTasks(uid: string, body: unknown) {
    const b = z.object({ action: z.enum(['complete', 'reopen', 'delete']), ids }).strict().parse(body);
    if (b.action === 'delete') return deleteTasks(uid, b.ids);
    const set = new Set(b.ids); const t = now();
    const recs = (await store.all<Task>(uid, 'tasks')).filter((x) => set.has(x.id)).map((x) => ({ ...x, status: b.action === 'complete' ? 'done' as const : 'open' as const, completedAt: b.action === 'complete' ? (x.completedAt ?? t) : null, updatedAt: t, version: x.version + 1 }));
    await store.put(uid, 'tasks', recs);
    return { updated: recs.length };
  }

  async function relatedNames(uid: string) {
    const [c, l, d] = await Promise.all([store.all<Contact>(uid, 'contacts'), store.all<Lead>(uid, 'leads'), store.all<Deal>(uid, 'deals')]);
    return new Map<string, string>([
      ...c.map((x) => [`contact:${x.id}`, contactName(x)] as [string, string]),
      ...l.map((x) => [`lead:${x.id}`, x.name || x.company] as [string, string]),
      ...d.map((x) => [`deal:${x.id}`, x.name] as [string, string]),
    ]);
  }

  // ---------- notes & interactions ----------
  async function listNotes(uid: string, type: EntityType, id: string) {
    return (await store.all<Note>(uid, 'notes')).filter((n) => n.relatedTo.type === type && n.relatedTo.id === id).sort(sorter<Note>('createdAt', 'desc'));
  }
  async function createNote(uid: string, body: unknown) {
    const b = z.object({ body: s(10_000).min(1, 'Write something first.'), relatedTo: related }).strict().parse(body);
    await assertRelated(uid, b.relatedTo);
    const t = now();
    const n: Note = { id: rid('note'), body: b.body, relatedTo: b.relatedTo, createdAt: t, updatedAt: t, version: 1 };
    await store.put(uid, 'notes', [n]);
    await log(uid, 'note', `Note: ${b.body.slice(0, 140)}`, b.relatedTo);
    return { note: n };
  }
  async function updateNote(uid: string, id: string, body: any) {
    const cur = await mustGet<Note>(uid, 'notes', id, 'note');
    checkVersion(cur, body?.version);
    const b = z.object({ body: s(10_000).min(1, 'Write something first.'), version: z.number().optional() }).strict().parse(body);
    const n = { ...cur, body: b.body, updatedAt: now(), version: cur.version + 1 };
    await store.put(uid, 'notes', [n]);
    return { note: n };
  }
  async function deleteNote(uid: string, id: string) {
    await mustGet<Note>(uid, 'notes', id, 'note');
    await store.remove(uid, 'notes', [id]);
    return { deleted: 1 };
  }
  async function logInteraction(uid: string, body: unknown) {
    const b = z.object({ kind: z.enum(INTERACTION_TYPES), summary: s(500).min(1, 'Add a short summary.'), relatedTo: related, at: optDate.optional() }).strict().parse(body);
    await assertRelated(uid, b.relatedTo);
    const a = await log(uid, b.kind, b.summary, b.relatedTo);
    if (b.at) { a.at = b.at; await store.put(uid, 'activities', [a]); }
    return { activity: a };
  }

  // ---------- calendar events ----------
  async function listEvents(uid: string, raw: unknown) {
    const q = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(raw);
    const from = q.from ? Date.parse(q.from) : -Infinity; const to = q.to ? Date.parse(q.to) : Infinity;
    const names = await relatedNames(uid);
    return (await store.all<CalendarEvent>(uid, 'events')).filter((e) => { const t = Date.parse(e.start); return t >= from && t < to; })
      .sort(sorter<CalendarEvent>('start')).map((e) => ({ ...e, relatedName: e.relatedTo ? names.get(`${e.relatedTo.type}:${e.relatedTo.id}`) ?? null : null }));
  }
  async function createEvent(uid: string, body: unknown) {
    const input = eventInput.partial().parse(body);
    if (!input.title) throw crmError(400, 'invalid_input', 'Give the event a title.', 'title');
    if (!input.start) throw crmError(400, 'invalid_input', 'Choose a start date and time.', 'start');
    if (input.end && Date.parse(input.end) < Date.parse(input.start)) throw crmError(400, 'invalid_input', 'The end must be after the start.', 'end');
    await assertRelated(uid, input.relatedTo ?? null);
    const t = now();
    const e: CalendarEvent = { title: input.title, start: new Date(input.start).toISOString(), end: input.end ?? null, kind: input.kind ?? 'meeting', location: input.location ?? '', attendees: input.attendees ?? '', relatedTo: input.relatedTo ?? null, notes: input.notes ?? '', id: rid('evt'), createdAt: t, updatedAt: t, version: 1 };
    await store.put(uid, 'events', [e]);
    if (e.relatedTo) await log(uid, 'meeting', `Scheduled “${e.title}” for ${e.start.slice(0, 16).replace('T', ' ')}`, e.relatedTo);
    return { event: e };
  }
  async function updateEvent(uid: string, id: string, body: any) {
    const cur = await mustGet<CalendarEvent>(uid, 'events', id, 'event');
    checkVersion(cur, body?.version);
    const { version: _v, ...patch } = body ?? {};
    const input = eventInput.partial().parse(patch);
    if (input.relatedTo !== undefined) await assertRelated(uid, input.relatedTo);
    const next = { ...cur, ...input, start: input.start ? new Date(input.start).toISOString() : cur.start, updatedAt: now(), version: cur.version + 1 } as CalendarEvent;
    if (next.end && Date.parse(next.end) < Date.parse(next.start)) throw crmError(400, 'invalid_input', 'The end must be after the start.', 'end');
    await store.put(uid, 'events', [next]);
    return { event: next };
  }
  async function deleteEvent(uid: string, id: string) {
    await mustGet<CalendarEvent>(uid, 'events', id, 'event');
    await store.remove(uid, 'events', [id]);
    return { deleted: 1 };
  }

  // ---------- saved views ----------
  async function listViews(uid: string, entity?: string) {
    return (await store.all<SavedView>(uid, 'views')).filter((v) => !entity || v.entity === entity).sort(sorter<SavedView>('name'));
  }
  async function saveView(uid: string, body: unknown) {
    const b = z.object({
      entity: z.enum(['contact', 'lead', 'deal', 'task']), name: s(60).min(1, 'Name the view.'),
      filters: z.record(z.string().max(40), z.union([s(200), z.array(s(60)).max(20), z.boolean(), z.null()])),
    }).strict().parse(body);
    const existing = (await store.all<SavedView>(uid, 'views')).filter((v) => v.entity === b.entity);
    if (existing.length >= 30) throw crmError(400, 'too_many', 'You can save up to 30 views for each list.');
    const same = existing.find((v) => norm(v.name) === norm(b.name));
    const t = now();
    const v: SavedView = same ? { ...same, filters: b.filters, updatedAt: t, version: same.version + 1 } : { ...b, id: rid('view'), createdAt: t, updatedAt: t, version: 1 };
    await store.put(uid, 'views', [v]);
    return { view: v };
  }
  async function deleteView(uid: string, id: string) {
    await mustGet<SavedView>(uid, 'views', id, 'view');
    await store.remove(uid, 'views', [id]);
    return { deleted: 1 };
  }

  // ---------- dashboard ----------
  async function dashboard(uid: string) {
    const [settings, contacts, leads, deals, tasks, acts, events] = await Promise.all([
      store.settings(uid), store.all<Contact>(uid, 'contacts'), store.all<Lead>(uid, 'leads'), store.all<Deal>(uid, 'deals'),
      store.all<Task>(uid, 'tasks'), store.all<Activity>(uid, 'activities'), store.all<CalendarEvent>(uid, 'events'),
    ]);
    const t0 = startOfToday(); const nowMs = Date.now();
    const since = (iso: string | null, days: number) => !!iso && Date.parse(iso) >= nowMs - days * DAY;
    const activeLead = (l: Lead) => ['new', 'contacted', 'qualified'].includes(l.status);
    const kind = (d: Deal) => stageOf(settings, d.stageId)?.kind ?? 'open';
    const openDeals = deals.filter((d) => kind(d) === 'open');
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const wonThisMonth = deals.filter((d) => kind(d) === 'won' && d.closedAt && Date.parse(d.closedAt) >= monthStart.getTime());
    const closed90 = deals.filter((d) => kind(d) !== 'open' && since(d.closedAt, 90));
    const leads90 = leads.filter((l) => since(l.createdAt, 90));
    const openTasks = tasks.filter((x) => x.status === 'open');
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); d.setMonth(d.getMonth() - (5 - i)); return d; });
    const salesByMonth = months.map((m, i) => {
      const end = i < 5 ? months[i + 1].getTime() : Infinity;
      const won = deals.filter((d) => kind(d) === 'won' && d.closedAt && Date.parse(d.closedAt) >= m.getTime() && Date.parse(d.closedAt) < end);
      return { month: m.toISOString().slice(0, 7), value: won.reduce((a, d) => a + d.value, 0), count: won.length };
    });
    const forecast = Array.from({ length: 3 }, (_, i) => {
      const m = new Date(); m.setDate(1); m.setHours(0, 0, 0, 0); m.setMonth(m.getMonth() + i);
      const end = new Date(m); end.setMonth(end.getMonth() + 1);
      const inMonth = openDeals.filter((d) => d.expectedCloseDate && Date.parse(d.expectedCloseDate) >= (i === 0 ? -Infinity : m.getTime()) && Date.parse(d.expectedCloseDate) < end.getTime());
      return { month: m.toISOString().slice(0, 7), weighted: Math.round(inMonth.reduce((a, d) => a + d.value * probabilityOf(settings, d) / 100, 0)), total: inMonth.reduce((a, d) => a + d.value, 0), count: inMonth.length };
    });
    const sourceCounts = new Map<string, number>();
    for (const l of leads90) sourceCounts.set(l.source || 'Not set', (sourceCounts.get(l.source || 'Not set') ?? 0) + 1);
    const names = await relatedNames(uid);
    const won90 = closed90.filter((d) => kind(d) === 'won').length;
    return {
      currency: settings.currency,
      totals: {
        customers: contacts.length,
        activeCustomers: contacts.filter((c) => c.status === 'active').length,
        newCustomers30d: contacts.filter((c) => since(c.createdAt, 30)).length,
        activeLeads: leads.filter(activeLead).length,
        newLeads7d: leads.filter((l) => since(l.createdAt, 7)).length,
        openTasks: openTasks.length,
        overdueTasks: openTasks.filter((x) => x.dueAt && Date.parse(x.dueAt) < t0).length,
        dueToday: openTasks.filter((x) => x.dueAt && Date.parse(x.dueAt) >= t0 && Date.parse(x.dueAt) < t0 + DAY).length,
        overdueFollowUps: leads.filter((l) => activeLead(l) && l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) < t0).length,
        openDeals: openDeals.length,
        pipelineValue: openDeals.reduce((a, d) => a + d.value, 0),
        weightedPipeline: Math.round(openDeals.reduce((a, d) => a + d.value * probabilityOf(settings, d) / 100, 0)),
        wonThisMonth: wonThisMonth.reduce((a, d) => a + d.value, 0),
        wonThisMonthCount: wonThisMonth.length,
        winRate90d: closed90.length ? Math.round((won90 / closed90.length) * 100) : null,
        leadConversion90d: leads90.length ? Math.round((leads90.filter((l) => l.status === 'converted').length / leads90.length) * 100) : null,
      },
      pipelineByStage: settings.pipeline.map((p) => { const ds = deals.filter((d) => d.stageId === p.id); return { stageId: p.id, name: p.name, kind: p.kind, count: ds.length, value: ds.reduce((a, d) => a + d.value, 0) }; }),
      salesByMonth, forecast,
      leadsBySource: [...sourceCounts.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      upcomingTasks: openTasks.sort(sorter<Task>('dueAt')).slice(0, 8).map((x) => ({ ...x, overdue: !!x.dueAt && Date.parse(x.dueAt) < t0, relatedName: x.relatedTo ? names.get(`${x.relatedTo.type}:${x.relatedTo.id}`) ?? null : null })),
      followUps: leads.filter((l) => activeLead(l) && l.nextFollowUpAt && Date.parse(l.nextFollowUpAt) < t0 + DAY).sort(sorter<Lead>('nextFollowUpAt')).slice(0, 8),
      upcomingEvents: events.filter((e) => Date.parse(e.start) >= t0).sort(sorter<CalendarEvent>('start')).slice(0, 5),
      recentActivity: acts.sort(sorter<Activity>('at', 'desc')).slice(0, 15).map((a) => ({ ...a, relatedName: a.relatedTo ? names.get(`${a.relatedTo.type}:${a.relatedTo.id}`) ?? null : null })),
      hasData: contacts.length + leads.length + deals.length + tasks.length > 0,
    };
  }

  // ---------- search ----------
  async function search(uid: string, raw: unknown) {
    const { q } = z.object({ q: s(200) }).parse(raw);
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return { results: [] };
    const has = (text: string) => { const h = norm(text); return words.every((w) => h.includes(w)); };
    const qd = digits(q);
    const [contacts, leads, deals, tasks, notes] = await Promise.all([store.all<Contact>(uid, 'contacts'), store.all<Lead>(uid, 'leads'), store.all<Deal>(uid, 'deals'), store.all<Task>(uid, 'tasks'), store.all<Note>(uid, 'notes')]);
    const names = await relatedNames(uid);
    const results = [
      ...contacts.filter((c) => has(`${contactName(c)} ${c.company} ${c.email} ${c.tags.join(' ')}`) || (qd.length >= 4 && digits(c.phone).includes(qd))).slice(0, 6).map((c) => ({ type: 'contact', id: c.id, title: contactName(c), subtitle: [c.company, c.email || c.phone].filter(Boolean).join(' · ') })),
      ...leads.filter((l) => has(`${l.name} ${l.company} ${l.email} ${l.source}`) || (qd.length >= 4 && digits(l.phone).includes(qd))).slice(0, 6).map((l) => ({ type: 'lead', id: l.id, title: l.name || l.company, subtitle: [l.company, l.status].filter(Boolean).join(' · ') })),
      ...deals.filter((d) => has(`${d.name} ${d.company}`)).slice(0, 6).map((d) => ({ type: 'deal', id: d.id, title: d.name, subtitle: d.company })),
      ...tasks.filter((x) => has(`${x.title} ${x.description}`)).slice(0, 6).map((x) => ({ type: 'task', id: x.id, title: x.title, subtitle: x.relatedTo ? names.get(`${x.relatedTo.type}:${x.relatedTo.id}`) ?? '' : x.status })),
      ...notes.filter((n) => has(n.body)).slice(0, 4).map((n) => ({ type: 'note', id: n.id, title: n.body.slice(0, 80), subtitle: names.get(`${n.relatedTo.type}:${n.relatedTo.id}`) ?? '', relatedTo: n.relatedTo })),
    ];
    return { results };
  }

  // ---------- import / export ----------
  async function importRows(uid: string, body: unknown) {
    const b = z.object({ entity: z.enum(['contact', 'lead']), rows: z.array(z.record(z.string().max(60), z.any())).min(1, 'The file has no rows.').max(5000, 'Import up to 5,000 rows at a time.'), duplicates: z.enum(['skip', 'update', 'create']).default('skip') }).strict().parse(body);
    const settings = await store.settings(uid);
    const result = { created: 0, updated: 0, skipped: 0, errors: [] as { row: number; message: string }[] };
    const t = now();
    const schema = (b.entity === 'contact' ? contactInput : leadInput).partial();
    const existing = b.entity === 'contact' ? await store.all<Contact>(uid, 'contacts') : await store.all<Lead>(uid, 'leads');
    const byEmail = new Map(existing.filter((r: any) => r.email).map((r: any) => [norm(r.email), r]));
    const byPhone = new Map(existing.filter((r: any) => digits(r.phone).length >= 7).map((r: any) => [digits(r.phone).slice(-9), r]));
    const put: any[] = [];
    b.rows.forEach((row, i) => {
      const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '').map(([k, v]) => [k, k === 'tags' ? (Array.isArray(v) ? v : String(v).split(/[;,]/).map((x) => x.trim()).filter(Boolean)) : k === 'fields' ? v : typeof v === 'string' ? v.trim() : v]));
      if (b.entity === 'lead' && clean.status === 'converted') delete clean.status;
      const parsed = schema.safeParse(clean);
      if (!parsed.success) { result.errors.push({ row: i + 1, message: parsed.error.issues[0]?.message ?? 'Invalid row' }); return; }
      const data: any = parsed.data;
      try { data.fields = validateFields(settings.customFields[b.entity], data.fields ?? {}); } catch (e: any) { result.errors.push({ row: i + 1, message: e.message }); return; }
      const dup = (data.email && byEmail.get(norm(data.email))) || (digits(data.phone ?? '').length >= 7 && byPhone.get(digits(data.phone).slice(-9)));
      const named = b.entity === 'contact' ? data.firstName || data.lastName || data.company : data.name || data.company;
      if (!named && !(dup && b.duplicates === 'update')) { result.errors.push({ row: i + 1, message: 'Add a name or a company.' }); return; }
      if (dup && b.duplicates === 'skip') { result.skipped++; return; }
      if (dup && b.duplicates === 'update') {
        const merged = { ...dup, ...data, tags: [...new Set([...(dup.tags ?? []), ...(data.tags ?? [])])], fields: { ...dup.fields, ...data.fields }, updatedAt: t, version: dup.version + 1 };
        put.push(merged); result.updated++; return;
      }
      const rec = b.entity === 'contact'
        ? { ...defaultsContact, ...data, id: rid('con'), createdAt: t, updatedAt: t, version: 1, lastActivityAt: null }
        : { ...defaultsLead, ...data, id: rid('lead'), createdAt: t, updatedAt: t, version: 1, convertedAt: null, contactId: null, dealId: null, lastActivityAt: null };
      put.push(rec);
      if (rec.email) byEmail.set(norm(rec.email), rec);
      if (digits(rec.phone).length >= 7) byPhone.set(digits(rec.phone).slice(-9), rec);
      result.created++;
    });
    for (let i = 0; i < put.length; i += 400) await store.put(uid, b.entity === 'contact' ? 'contacts' : 'leads', put.slice(i, i + 400));
    if (result.created || result.updated) await log(uid, 'imported', `Imported ${result.created} new and updated ${result.updated} ${b.entity === 'contact' ? 'customers' : 'leads'}`, null);
    return result;
  }

  async function exportCsv(uid: string, entity: 'contacts' | 'leads' | 'deals' | 'tasks') {
    const settings = await store.settings(uid);
    const rows: unknown[][] = [];
    if (entity === 'contacts') {
      const defs = settings.customFields.contact;
      rows.push(['First name', 'Last name', 'Company', 'Title', 'Email', 'Phone', 'Website', 'Address', 'Status', 'Tags', 'Source', 'Owner', 'Notes', 'Created', ...defs.map((d) => d.label)]);
      for (const c of (await store.all<Contact>(uid, 'contacts')).sort(sorter<Contact>('createdAt'))) rows.push([c.firstName, c.lastName, c.company, c.title, c.email, c.phone, c.website, c.address, c.status, c.tags, c.source, c.owner, c.notes, c.createdAt.slice(0, 10), ...defs.map((d) => c.fields[d.key])]);
    } else if (entity === 'leads') {
      const defs = settings.customFields.lead;
      rows.push(['Name', 'Company', 'Email', 'Phone', 'Status', 'Priority', 'Source', 'Score', 'Value', 'Assigned to', 'Next follow-up', 'Tags', 'Notes', 'Created', ...defs.map((d) => d.label)]);
      for (const l of (await store.all<Lead>(uid, 'leads')).sort(sorter<Lead>('createdAt'))) rows.push([l.name, l.company, l.email, l.phone, l.status, l.priority, l.source, l.score, l.value, l.assignedTo, l.nextFollowUpAt?.slice(0, 10), l.tags, l.notes, l.createdAt.slice(0, 10), ...defs.map((d) => l.fields[d.key])]);
    } else if (entity === 'deals') {
      const contacts = new Map((await store.all<Contact>(uid, 'contacts')).map((c) => [c.id, c]));
      rows.push(['Deal', 'Customer', 'Company', 'Stage', 'Value', 'Probability %', 'Expected close', 'Owner', 'Closed', 'Created']);
      for (const d of (await store.all<Deal>(uid, 'deals')).sort(sorter<Deal>('createdAt'))) rows.push([d.name, d.contactId && contacts.get(d.contactId) ? contactName(contacts.get(d.contactId)!) : '', d.company, stageOf(settings, d.stageId)?.name ?? d.stageId, d.value, probabilityOf(settings, d), d.expectedCloseDate?.slice(0, 10), d.owner, d.closedAt?.slice(0, 10), d.createdAt.slice(0, 10)]);
    } else {
      const names = await relatedNames(uid);
      rows.push(['Task', 'Status', 'Priority', 'Due', 'Assignee', 'Related to', 'Description', 'Completed']);
      for (const x of (await store.all<Task>(uid, 'tasks')).sort(sorter<Task>('dueAt'))) rows.push([x.title, x.status, x.priority, x.dueAt?.slice(0, 16).replace('T', ' '), x.assignee, x.relatedTo ? names.get(`${x.relatedTo.type}:${x.relatedTo.id}`) : '', x.description, x.completedAt?.slice(0, 10)]);
    }
    return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  // ---------- public lead form ----------
  async function capture(key: string, body: unknown) {
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(key)) throw crmError(404, 'not_found', 'This form isn’t active.');
    const b = z.object({ name: s(120).min(1, 'Please enter your name.'), email: email.default(''), phone: phone.default(''), company: s(120).default(''), message: s(2000).default(''), website: z.string().max(200).optional() }).strip().parse(body);
    if (b.website) return { ok: true }; // honeypot field filled in: silently drop bots
    if (!b.email && !b.phone) throw crmError(400, 'invalid_input', 'Please give an email address or phone number.', 'email');
    const uid = await store.findByCaptureKey(key);
    if (!uid) throw crmError(404, 'not_found', 'This form isn’t active.');
    await createLead(uid, { name: b.name, email: b.email, phone: b.phone, company: b.company, notes: b.message, source: 'Website' }, 'Website form');
    return { ok: true };
  }

  return {
    getSettings, updateSettings, setCaptureForm,
    listContacts, getContact, createContact, updateContact, deleteContacts, bulkContacts, duplicateGroups, mergeContacts,
    listLeads, getLead, createLead, updateLead, deleteLeads, bulkLeads, convertLead,
    listDeals, getDeal, createDeal, updateDeal, deleteDeals,
    listTasks, createTask, updateTask, deleteTasks, bulkTasks,
    listNotes, createNote, updateNote, deleteNote, logInteraction,
    listEvents, createEvent, updateEvent, deleteEvent,
    listViews, saveView, deleteView,
    dashboard, search, importRows, exportCsv, capture,
  };
}

export type CrmService = ReturnType<typeof createCrmService>;
