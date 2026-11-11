/**
 * Data-subject rights (GDPR art. 15–17, 20; CCPA/CPRA right to know, correct, delete) for one person,
 * identified by email address, inside one organization.
 *
 * Covered stores (every place the audit found personal data about customers):
 *   organizations/{org}/leads (+ tasks, activities)      organizations/{org}/contacts
 *   organizations/{org}/deals (linked)                    organizations/{org}/activities (linked)
 *   organizations/{org}/proposals (client)                billing/{org}/clients, billing/{org}/invoices (billTo)
 *   organizations/{org}/scheduled_meetings (guests)       organizations/{org}/meeting_notes (linked lead)
 *   organizations/{org}/inbound_messages, voicemails (lead phone)
 *   inbox conversations and messages (organizations/{org}/inbox_*)
 *   organizations/{org}/consents
 *
 * Erasure anonymizes in place; it never hard-deletes. Records keep their ids (deals, invoices and proposals
 * still add up for accounting), personal fields are cleared, free text written by or about the person is
 * replaced. A tombstone with only a hash of the email is kept as proof, and consent records are kept with
 * the email replaced by its hash so the person isn't contacted again.
 */
import crypto from 'node:crypto';
import { assertId, getDocStore, newId } from '../data/docStore';
import { anonymizeInboxForEmail, inboxRecordsForEmail } from '../../routes/messagingPlatform';

export const REMOVED = '[removed at the person’s request]';
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const sameNumber = (a: unknown, b: unknown) => { const x = digits(a), y = digits(b); return x.length >= 7 && y.length >= 7 && x.slice(-10) === y.slice(-10); };
export const emailHash = (email: string) => crypto.createHash('sha256').update(lc(email)).digest('hex');
export const isEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Removes credential-like fields from exported records (share token hashes, secrets). */
function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as any;
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, x] of Object.entries(v as any)) if (!/(hash|token|secret|password|signature(Image|DataUrl)?$)/i.test(k)) out[k] = clean(x);
    return out;
  }
  return v;
}

const billingRoot = (orgId: string) => `billing/${String(orgId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || '_'}`;

/** Everything held about the person, with the paths needed to change it. */
export async function findSubject(orgId: string, email: string) {
  const O = `organizations/${assertId(orgId)}`;
  const e = lc(email);
  const st = await getDocStore();
  const leads = (await st.list(`${O}/leads`)).filter((l) => lc(l.email) === e);
  const leadIds = new Set(leads.map((l) => l.id));
  const phones = leads.map((l) => l.phone).filter((p) => digits(p).length >= 7);
  const contacts = (await st.list(`${O}/contacts`)).filter((c) => lc(c.email) === e || (c.leadId && leadIds.has(c.leadId)));
  const contactIds = new Set(contacts.map((c) => c.id));
  const deals = (await st.list(`${O}/deals`)).filter((d) => (d.leadId && leadIds.has(d.leadId)) || (d.contactId && contactIds.has(d.contactId)) || leads.some((l) => l.convertedDealId === d.id));
  const linked = new Set<string>([...leadIds, ...contactIds]);
  const activities = (await st.list(`${O}/activities`)).filter((a) => a.targetId && linked.has(a.targetId));
  const leadTasks: Array<{ leadId: string; task: any }> = [];
  const leadActivities: Array<{ leadId: string; activity: any }> = [];
  for (const id of leadIds) {
    for (const t of await st.list(`${O}/leads/${assertId(id)}/tasks`)) leadTasks.push({ leadId: id, task: t });
    for (const a of await st.list(`${O}/leads/${assertId(id)}/activities`)) leadActivities.push({ leadId: id, activity: a });
  }
  const proposals = (await st.list(`${O}/proposals`)).filter((p) => lc(p.client?.email) === e || (p.contactId && linked.has(p.contactId)));
  const billingClients = (await st.list(`${billingRoot(orgId)}/clients`)).filter((c) => lc(c.email) === e);
  const billingClientIds = new Set(billingClients.map((c) => c.id));
  const invoices = (await st.list(`${billingRoot(orgId)}/invoices`)).filter((i) => lc(i.billTo?.email) === e || (i.clientId && billingClientIds.has(i.clientId)));
  const meetings = (await st.list(`${O}/scheduled_meetings`)).filter((m) => (m.guests || []).some((g: unknown) => lc(g) === e));
  const meetingNotes = (await st.list(`${O}/meeting_notes`)).filter((n) => n.leadId && leadIds.has(n.leadId));
  const inbound = phones.length ? (await st.list(`${O}/inbound_messages`)).filter((m) => phones.some((p) => sameNumber(p, m.from))) : [];
  const voicemails = phones.length ? (await st.list(`${O}/voicemails`)).filter((m) => phones.some((p) => sameNumber(p, m.from))) : [];
  const consents = (await st.list(`${O}/consents`)).filter((c) => lc(c.email) === e);
  const inbox = await inboxRecordsForEmail(orgId, e);
  return { O, e, leads, leadTasks, leadActivities, contacts, deals, activities, proposals, billingClients, invoices, meetings, meetingNotes, inbound, voicemails, consents, inbox };
}

export function subjectCounts(f: Awaited<ReturnType<typeof findSubject>>) {
  return {
    leads: f.leads.length, leadTasks: f.leadTasks.length, leadActivities: f.leadActivities.length, contacts: f.contacts.length,
    deals: f.deals.length, activities: f.activities.length, proposals: f.proposals.length, invoicingClients: f.billingClients.length,
    invoices: f.invoices.length, meetings: f.meetings.length, meetingNotes: f.meetingNotes.length, inboundMessages: f.inbound.length,
    voicemails: f.voicemails.length, consents: f.consents.length, inboxConversations: f.inbox.length,
    inboxMessages: f.inbox.reduce((s, c) => s + c.messages.length, 0),
  };
}

/** Machine-readable copy of everything held about the person (access + portability). */
export async function exportSubject(orgId: string, email: string) {
  const f = await findSubject(orgId, email);
  return clean({
    format: 'obsidian-crm/data-subject-export@1',
    subject: { email: f.e }, organizationId: orgId, generatedAt: new Date().toISOString(),
    counts: subjectCounts(f),
    leads: f.leads.map((l) => ({ ...l, tasks: f.leadTasks.filter((t) => t.leadId === l.id).map((t) => t.task), activities: f.leadActivities.filter((a) => a.leadId === l.id).map((a) => a.activity) })),
    contacts: f.contacts, deals: f.deals, activities: f.activities, proposals: f.proposals,
    invoicing: { clients: f.billingClients, invoices: f.invoices },
    meetings: f.meetings.map((m) => ({ id: m.id, title: m.title, startTime: m.startTime, endTime: m.endTime, guests: m.guests })),
    meetingNotes: f.meetingNotes, phone: { messages: f.inbound, voicemails: f.voicemails },
    inbox: f.inbox, consents: f.consents,
  });
}

/** Anonymizes everything held about the person. apply=false returns what would change. */
export async function eraseSubject(orgId: string, email: string, opts: { apply: boolean; requestId?: string }) {
  const f = await findSubject(orgId, email);
  const counts = subjectCounts(f);
  const inboxPreview = await anonymizeInboxForEmail(orgId, f.e, false);
  if (!opts.apply) return { applied: false, counts: { ...counts, inboxMessages: inboxPreview.messages } };
  const st = await getDocStore();
  const at = new Date().toISOString();
  const mark = { anonymizedAt: at, ...(opts.requestId ? { privacyRequestId: opts.requestId } : {}) };
  const person = { name: 'Removed contact', email: '', phone: '', title: '', ...mark };
  for (const l of f.leads) await st.update(`${f.O}/leads/${assertId(l.id)}`, { ...person, company: '', notes: '', qualification: { need: '', budget: 0, authority: 'unknown', timeline: 'unknown' }, aiBrief: null });
  for (const { leadId, task } of f.leadTasks) await st.update(`${f.O}/leads/${assertId(leadId)}/tasks/${assertId(task.id)}`, { title: 'Follow-up (contact removed)', description: '', notes: '' });
  for (const { leadId, activity } of f.leadActivities) await st.update(`${f.O}/leads/${assertId(leadId)}/activities/${assertId(activity.id)}`, { title: 'Activity (contact removed)', description: '' });
  for (const c of f.contacts) await st.update(`${f.O}/contacts/${assertId(c.id)}`, { ...person, firstName: '', lastName: '', notes: '' });
  for (const d of f.deals) await st.update(`${f.O}/deals/${assertId(d.id)}`, { client: 'Removed contact', contactName: '', contactEmail: '', notes: '', ...mark });
  for (const a of f.activities) await st.update(`${f.O}/activities/${assertId(a.id)}`, { title: 'Activity (contact removed)', description: '' });
  for (const p of f.proposals) await st.update(`${f.O}/proposals/${assertId(p.id)}`, { client: { name: 'Removed contact', email: '', company: '' }, ...mark });
  if (f.billingClients.length || f.invoices.length) {
    const blank = { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' };
    for (const c of f.billingClients) await st.update(`${billingRoot(orgId)}/clients/${String(c.id)}`, { name: 'Removed contact', company: '', email: '', phone: '', address: blank, taxId: '', notes: '', ...mark });
    // Invoices stay (tax/accounting retention); only the recipient's personal details are cleared.
    for (const i of f.invoices) await st.update(`${billingRoot(orgId)}/invoices/${String(i.id)}`, { billTo: { ...(i.billTo || {}), name: 'Removed contact', company: '', email: '', phone: '', address: blank, taxId: '' }, ...mark });
    const root = await st.get(billingRoot(orgId));
    if (root) await st.update(billingRoot(orgId), { version: (Number(root.version) || 0) + 1 });
  }
  for (const m of f.meetings) await st.update(`${f.O}/scheduled_meetings/${assertId(m.id)}`, { guests: (m.guests || []).filter((g: unknown) => lc(g) !== f.e) });
  for (const n of f.meetingNotes) await st.update(`${f.O}/meeting_notes/${assertId(n.id)}`, { body: REMOVED, ...mark });
  for (const m of f.inbound) await st.update(`${f.O}/inbound_messages/${assertId(m.id)}`, { from: '', contactName: '', body: REMOVED, ...mark });
  for (const v of f.voicemails) await st.update(`${f.O}/voicemails/${assertId(v.id)}`, { from: '', callerName: '', transcript: REMOVED, recordingUrl: null, ...mark });
  for (const c of f.consents) await st.update(`${f.O}/consents/${assertId(c.id)}`, { email: '', emailHash: emailHash(f.e), subjectErased: true });
  const inbox = await anonymizeInboxForEmail(orgId, f.e, true);
  const tombstone = { id: newId('tomb'), emailHash: emailHash(f.e), executedAt: at, requestId: opts.requestId || null, counts: { ...counts, inboxMessages: inbox.messages } };
  await st.set(`${f.O}/dsr_tombstones/${tombstone.id}`, tombstone);
  return { applied: true, counts: tombstone.counts, tombstoneId: tombstone.id };
}

export const CORRECTABLE = ['name', 'email', 'phone', 'company', 'title'] as const;
export type Corrections = Partial<Record<typeof CORRECTABLE[number], string>>;

/** Applies corrections to the person's lead and contact records. apply=false returns what would change. */
export async function correctSubject(orgId: string, email: string, corrections: Corrections, opts: { apply: boolean }) {
  const patch: Record<string, string> = {};
  for (const k of CORRECTABLE) if (typeof corrections[k] === 'string') patch[k] = corrections[k]!.trim().slice(0, k === 'email' ? 254 : 200);
  if (patch.email !== undefined) { if (!isEmail(patch.email)) throw Object.assign(new Error('The corrected email isn’t valid.'), { status: 400, code: 'invalid_email' }); patch.email = lc(patch.email); }
  const f = await findSubject(orgId, email);
  if (!opts.apply) return { applied: false, fields: Object.keys(patch), leads: f.leads.length, contacts: f.contacts.length };
  const st = await getDocStore();
  const at = new Date().toISOString();
  for (const l of f.leads) await st.update(`${f.O}/leads/${assertId(l.id)}`, { ...patch, updatedAt: at, correctedAt: at });
  for (const c of f.contacts) await st.update(`${f.O}/contacts/${assertId(c.id)}`, { ...patch, updatedAt: at, correctedAt: at });
  return { applied: true, fields: Object.keys(patch), leads: f.leads.length, contacts: f.contacts.length };
}
