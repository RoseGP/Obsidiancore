/**
 * Retrieval for the CRM agent (the "R" in RAG): finds the caller's organization's records most relevant to a
 * question, so the model answers from real data instead of guessing.
 *
 * Boundaries (enforced here, not by the model):
 *   - Only organizations/{orgId}/… of the caller's own organization is read (orgId comes from requireTenant).
 *   - Only record types the caller's role may view (permissions.ts canAccess(role, module, 'view')).
 *   - Deleted, merged and archived records are skipped.
 *   - Field allowlists per type: no custom fields, addresses, payment data, message bodies or ids beyond the
 *     record's own. Email and phone are included only when the question asks for contact details.
 *
 * Ranking: BM25 over the allowlisted text (title weighted), plus derived facts computed from the data
 * ("overdue", "closing soon", "stale", "high value"…), with a small boost for the record type the question
 * names. It runs per request in memory, which suits organizations with up to tens of thousands of records;
 * MAX_PER_TYPE bounds the work. A vector index could replace rankDocuments() without changing callers.
 */
import { assertId, getDocStore, type DocStore } from '../data/docStore';
import { canAccess, type Module } from '../security/permissions';
import type { Role } from '../tenancy/orgs';

export type SourceType = 'contact' | 'company' | 'lead' | 'deal' | 'task';
export const SOURCE_TYPES: SourceType[] = ['contact', 'company', 'lead', 'deal', 'task'];
const MODULE_OF: Record<SourceType, Module> = { contact: 'contacts', company: 'companies', lead: 'leads', deal: 'deals', task: 'tasks' };
const COLLECTION_OF: Record<SourceType, string> = { contact: 'contacts', company: 'companies', lead: 'leads', deal: 'deals', task: 'tasks' };
/** The app view that shows each type (for "open record" links in the UI). */
export const VIEW_OF: Record<SourceType, string> = { contact: 'contacts', company: 'companies', lead: 'leads', deal: 'deals', task: 'tasks' };
const MAX_PER_TYPE = 3000;
const DAY = 86_400_000;

export interface CrmDoc {
  id: string;
  type: SourceType;
  title: string;
  /** Facts given to the model (allowlisted fields only), one per line. */
  facts: string[];
  /** Text used for ranking (title + facts + derived tags). */
  search: string;
  updatedAt?: string;
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const date = (v: unknown) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ''; };
const ms = (v: unknown) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : NaN; };
const money = (v: unknown, cur?: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} ${str(cur, 3) || 'USD'}` : ''; };
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 40)).filter(Boolean).slice(0, 10).join(', ') : '');
const line = (label: string, value: string) => (value ? `${label}: ${value}` : '');
const dead = (r: any) => !r || r.deletedAt || r.mergedInto || r.archivedAt || r.status === 'deleted' || r.archived === true;

export interface DocOptions { includeContactDetails: boolean; now: number }

export function toDoc(type: SourceType, r: any, o: DocOptions): CrmDoc | null {
  if (dead(r) || typeof r.id !== 'string') return null;
  const contact = (label: string, v: unknown) => (o.includeContactDetails ? line(label, str(v, 120)) : '');
  const derived: string[] = [];
  let title = '';
  let facts: string[] = [];
  switch (type) {
    case 'contact':
      title = str(r.name, 120) || str(r.email, 120) || 'Unnamed contact';
      facts = [line('Title', str(r.title, 120)), line('Company', str(r.company, 120)), line('Status', str(r.status, 40)), line('Tags', list(r.tags)),
        line('Owner', str(r.owner, 80)), line('Last contacted', date(r.lastContactedAt ?? r.lastContact)), line('Notes', str(r.notes, 400)),
        contact('Email', r.email), contact('Phone', r.phone)];
      break;
    case 'company':
      title = str(r.name, 120) || 'Unnamed company';
      facts = [line('Industry', str(r.industry, 80)), line('Size', str(r.size ?? r.employees, 40)), line('Website', str(r.website ?? r.domain, 120)),
        line('Status', str(r.status, 40)), line('Tags', list(r.tags)), line('Notes', str(r.notes, 400))];
      break;
    case 'lead': {
      title = str(r.name, 120) || str(r.company, 120) || 'Unnamed lead';
      const q = r.qualification || {};
      const score = Number(r.aiScore ?? r.score);
      facts = [line('Company', str(r.company, 120)), line('Title', str(r.title, 120)), line('Status', str(r.status, 40)), line('Source', str(r.source ?? r.channel, 40)),
        line('Score', Number.isFinite(score) ? String(Math.round(score)) : ''), line('Classification', str(r.aiClass, 20)), line('Owner', str(r.owner, 80) || 'unassigned'),
        line('Need', str(q.need, 200)), line('Budget', money(q.budget)), line('Timeline', str(q.timeline, 60)), line('Created', date(r.createdAt)),
        line('Converted', r.isConverted ? 'yes' : ''), line('Notes', str(r.notes, 400)), contact('Email', r.email), contact('Phone', r.phone)];
      if (Number.isFinite(score) && score >= 70) derived.push('hot', 'high score');
      if (!r.ownerId && !r.owner) derived.push('unassigned');
      if (o.now - ms(r.createdAt) < 7 * DAY) derived.push('new', 'recent', 'this week');
      break;
    }
    case 'deal': {
      title = str(r.name, 120) || 'Unnamed deal';
      const stage = str(r.stage, 40).toLowerCase();
      const value = Number(r.value);
      const close = ms(r.expectedClose ?? r.closeDate);
      const touched = ms(r.updatedAt ?? r.stageEnteredAt);
      facts = [line('Client', str(r.client ?? r.company, 120)), line('Stage', stage), line('Value', money(value, r.currency)),
        line('Probability', Number.isFinite(Number(r.probability)) ? `${Number(r.probability)}%` : ''), line('Expected close', date(r.expectedClose ?? r.closeDate)),
        line('Owner', str(r.owner, 80)), line('Closed', date(r.closedAt)), line('Lost reason', str(r.lostReason, 200)), line('Last updated', date(r.updatedAt)), line('Notes', str(r.notes ?? r.description, 400))];
      const open = stage !== 'won' && stage !== 'lost';
      if (open) derived.push('open', 'pipeline', 'active');
      if (stage === 'won') derived.push('won', 'closed', 'revenue');
      if (stage === 'lost') derived.push('lost', 'closed');
      if (Number.isFinite(value) && value >= 10_000) derived.push('high value', 'large', 'big');
      if (open && Number.isFinite(close) && close < o.now) derived.push('overdue', 'past close date', 'slipped');
      if (open && Number.isFinite(close) && close >= o.now && close - o.now <= 30 * DAY) derived.push('closing soon', 'this month');
      if (open && Number.isFinite(touched) && o.now - touched > 21 * DAY) derived.push('stale', 'stuck', 'inactive');
      break;
    }
    case 'task': {
      title = str(r.title, 160) || 'Untitled task';
      const done = r.status === 'done' || r.completed === true;
      const due = ms(r.dueAt ?? r.dueDate);
      facts = [line('Status', done ? 'done' : str(r.status, 30) || 'open'), line('Type', str(r.type, 30)), line('Priority', str(r.priority, 20)),
        line('Due', date(r.dueAt ?? r.dueDate)), line('Assigned to', str(r.assignedTo, 80) || 'unassigned'), line('Details', str(r.description, 300))];
      if (!done) derived.push('open', 'todo', 'pending');
      if (!done && Number.isFinite(due) && due < o.now) derived.push('overdue', 'late', 'missed');
      if (!done && Number.isFinite(due) && due >= o.now && due - o.now <= DAY) derived.push('due today', 'today', 'tomorrow');
      if (!done && Number.isFinite(due) && due >= o.now && due - o.now <= 7 * DAY) derived.push('this week', 'upcoming');
      break;
    }
  }
  facts = facts.filter(Boolean);
  return { id: r.id, type, title, facts, search: [title, title, title, ...facts, ...derived, type].join(' \n '), updatedAt: str(r.updatedAt ?? r.createdAt, 40) || undefined };
}

// ---------------------------------------------------------------------------
// BM25
// ---------------------------------------------------------------------------

const STOP = new Set('a an and are as at be by can could did do does for from had has have how i in into is it its me my of on or our show tell that the their them there these this to us was we were what when where which who why will with you your about any all give list find get please'.split(' '));

export function tokenize(text: string): string[] {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith('ies') ? `${t.slice(0, -3)}y` : t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

const TYPE_HINTS: Array<[SourceType, RegExp]> = [
  ['deal', /\b(deals?|pipeline|opportunit|revenue|forecast|won|lost|stage|closing)\b/i],
  ['task', /\b(tasks?|to-?dos?|follow[- ]?ups?|overdue|due|reminders?)\b/i],
  ['lead', /\b(leads?|prospects?|inbound|hot|qualif)/i],
  ['contact', /\b(contacts?|people|person|customers?|who)\b/i],
  ['company', /\b(compan(y|ies)|accounts?|organi[sz]ations?|clients?)\b/i],
];
export const typeHints = (q: string) => new Set(TYPE_HINTS.filter(([, re]) => re.test(q)).map(([t]) => t));
export const wantsContactDetails = (q: string) => /\b(e-?mails?|phones?|numbers?|call|reach|contact (info|details))\b/i.test(q);

export interface Ranked { doc: CrmDoc; score: number }

export function rankDocuments(docs: CrmDoc[], question: string, k = 8): Ranked[] {
  const qTerms = [...new Set(tokenize(question))];
  const hints = typeHints(question);
  if (!docs.length) return [];
  const tokenized = docs.map((d) => tokenize(d.search));
  const avgLen = tokenized.reduce((s, t) => s + t.length, 0) / tokenized.length || 1;
  const df = new Map<string, number>();
  for (const toks of tokenized) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length, k1 = 1.2, b = 0.75;
  const scored: Ranked[] = docs.map((doc, i) => {
    const toks = tokenized[i];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const q of qTerms) {
      const f = tf.get(q);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(q) || 0) + 0.5) / ((df.get(q) || 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / avgLen)));
    }
    if (score > 0 && hints.has(doc.type)) score *= 1.35;
    return { doc, score };
  });
  const hits = scored.filter((s) => s.score > 0).sort((a, b2) => b2.score - a.score);
  if (hits.length) return hits.slice(0, k);
  // No word matched, but the question names a record type ("what are my tasks?"): the most recently updated ones.
  if (hints.size) {
    return scored.filter((s) => hints.has(s.doc.type))
      .sort((a, b2) => (ms(b2.doc.updatedAt) || 0) - (ms(a.doc.updatedAt) || 0))
      .slice(0, k).map((s) => ({ ...s, score: 0 }));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Loading (tenant- and permission-scoped)
// ---------------------------------------------------------------------------

export interface RetrievalScope { orgId: string; role: Role | string }

/** Record types this role may read. */
export const readableTypes = (role: Role | string) => SOURCE_TYPES.filter((t) => canAccess(role, MODULE_OF[t], 'view'));

export async function retrieve(scope: RetrievalScope, question: string, opts: { store?: DocStore; now?: number; k?: number } = {}) {
  const orgId = assertId(scope.orgId);
  const types = readableTypes(scope.role);
  const store = opts.store ?? (await getDocStore());
  const now = opts.now ?? Date.now();
  const includeContactDetails = wantsContactDetails(question);
  const lists = await Promise.all(types.map(async (t) => {
    const rows = await store.list(`organizations/${orgId}/${COLLECTION_OF[t]}`, { limit: MAX_PER_TYPE }).catch(() => []);
    return rows.map((r: any) => toDoc(t, r, { includeContactDetails, now })).filter((d): d is CrmDoc => !!d);
  }));
  const docs = lists.flat();
  return { searched: types, totalRecords: docs.length, results: rankDocuments(docs, question, opts.k ?? 8) };
}
