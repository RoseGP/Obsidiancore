/**
 * Customer segmentation (RFM) from the organization's own purchases: won deals and fully paid invoices.
 *
 *   Customer   a contact, or (when a purchase can't be tied to a person) the company. Purchases are linked the
 *              same way the contact profile links records: contactId, the lead the deal came from
 *              (originLeadId / leadId / the lead's convertedDealId → convertedContactId / contactId, or its
 *              email/phone), email (including merged alternates), invoicing client → contactId or email, and
 *              finally the company (companyId or the normalized company name).
 *   R          days since the last purchase (deal won date, or the date of the payment that settled the invoice)
 *   F          number of won deals + paid invoices
 *   M          their total value (deal value; invoice total in the workspace currency)
 *   Scores     1–5. With 20+ customers: quintiles of the organization's own customers. Below that: fixed
 *              thresholds (recency days, purchase counts, and multiples of the median customer's value).
 *   Segments   Champions · Loyal · Promising/New · Needs attention · At risk · Hibernating (rules in SEGMENT_RULES).
 *              Last activity (timeline, inbox, WhatsApp/SMS) is a secondary signal: a recent buyer gone quiet for
 *              90+ days is At risk; a lapsed customer still in touch in the last 30 days Needs attention.
 *   Prospects  contacts with no purchase: counted, not scored.
 */
import { calculateInvoice } from '../../../features/invoicing/domain/calc';
import { minorToDecimalString } from '../../../features/invoicing/domain/money';
import { DAY, closedAt, dealValue, feedByTarget, median, money, normalizeDeals, plural, round, stageHistory, ts } from './common';
import { companyTokens, normEmail, normPhone } from './entityMatch';

export const QUINTILE_MIN = 20;
export const FIXED = {
  recencyDays: [30, 90, 180, 365] as const,        // ≤30 → 5, ≤90 → 4, ≤180 → 3, ≤365 → 2, older → 1
  frequency: [2, 3, 5, 10] as const,               // 1 → 1, 2 → 2, 3–4 → 3, 5–9 → 4, 10+ → 5
  monetaryMultiples: [0.5, 1, 2, 4] as const,      // × the median customer's total: <0.5 → 1, <1 → 2, <2 → 3, <4 → 4, ≥4 → 5
};
export const QUIET_DAYS = 90;      // no activity for this long turns a fading customer into At risk
export const ENGAGED_DAYS = 30;    // activity this recent turns a lapsed customer into Needs attention
export const MAX_MEMBERS = 500;

export type SegmentId = 'champions' | 'loyal' | 'promising' | 'needs_attention' | 'at_risk' | 'hibernating';
export const SEGMENT_RULES: Record<SegmentId, { label: string; rule: string }> = {
  champions: { label: 'Champions', rule: 'Recency 4–5 and frequency 4–5: buy often and recently.' },
  loyal: { label: 'Loyal', rule: 'Recency 3+ and frequency 3+ (not Champions): buy regularly. Recency 3 / frequency 3 with no activity for 90+ days is At risk instead.' },
  promising: { label: 'Promising / New', rule: 'Recency 4–5 and frequency 1–2: new or recent buyers.' },
  needs_attention: { label: 'Needs attention', rule: 'Recency 3 with few purchases, or a lapsed customer still in touch in the last 30 days.' },
  at_risk: { label: 'At risk', rule: 'Recency 1–2 after frequent (F 3+) or large (M 4+) purchases, or recency 3 with frequency 2–3 and no activity for 90+ days.' },
  hibernating: { label: 'Hibernating', rule: 'Recency 1–2, few small purchases and no recent activity.' },
};
const ORDER: SegmentId[] = ['champions', 'loyal', 'promising', 'needs_attention', 'at_risk', 'hibernating'];

export interface SegmentsInput {
  contacts: any[]; companies: any[]; leads: any[]; deals: any[]; feed: any[];
  invoices: any[]; payments: any[]; billingClients: any[]; currency: string;
  /** email → messages (inbox), and WhatsApp/SMS messages with the customer's phone. */
  messagesByEmail?: Map<string, Array<{ at: string }>>;
  phoneMessages?: Array<{ at: string; phone: string }>;
}
export interface Member {
  id: string; type: 'contact' | 'company'; name: string; email: string; company: string;
  recencyDays: number; frequency: number; monetary: number; r: number; f: number; m: number;
  segment: SegmentId; reason: string; lastPurchaseAt: string; lastActivityAt: string | null;
}
export interface ScoreBand { score: number; min: number; max: number; customers: number }
export interface SegmentsResult {
  generatedAt: string; currency: string; customers: number; prospects: number; method: 'quintiles' | 'fixed';
  thresholds: { explanation: string; recency: ScoreBand[]; frequency: ScoreBand[]; monetary: ScoreBand[]; medianMonetary: number | null };
  segments: Array<{ id: SegmentId; label: string; rule: string; count: number; members: Member[]; truncated: boolean }>;
  unmatched: { deals: number; invoices: number };
  notes: string[];
}

interface Purchase { kind: 'deal' | 'invoice'; id: string; at: number; value: number; noValue: boolean }
interface Customer { key: string; id: string; type: 'contact' | 'company'; name: string; email: string; company: string; purchases: Purchase[]; activityKeys: Set<string>; emails: string[]; phones: string[] }

const companyKey = (v: unknown) => companyTokens(v).join(' ');
const live = (r: any) => r && !r.deletedAt && !r.mergedInto && !r.archived;

/** RFM segments for the organization. Pure: same records and `now`, same result. */
export function buildSegments(input: SegmentsInput, now: number): SegmentsResult {
  const deals = normalizeDeals(input.deals);
  const byDealFeed = feedByTarget(input.feed);

  // ---- Indexes (the contact profile's matching rules) ----
  const allContacts = new Map(input.contacts.filter(Boolean).map((c: any) => [c.id, c]));
  const resolveContact = (id: unknown) => {
    let c = id ? allContacts.get(String(id)) : null; let hops = 0;
    while (c && c.mergedInto && hops++ < 5) c = allContacts.get(c.mergedInto);
    return c && live(c) ? c : null;
  };
  const contacts = [...allContacts.values()].filter(live);
  const byEmail = new Map<string, any>(), byPhone = new Map<string, any>();
  for (const c of contacts) {
    for (const e of [c.email, ...(c.altEmails || [])].map(normEmail).filter(Boolean)) if (!byEmail.has(e)) byEmail.set(e, c);
    for (const p of [c.phone, ...(c.altPhones || [])].map(normPhone).filter(Boolean)) if (!byPhone.has(p)) byPhone.set(p, c);
  }
  const companies = input.companies.filter(live);
  const companyById = new Map(companies.map((c: any) => [c.id, c]));
  const companyByKey = new Map<string, any>(); for (const c of companies) { const k = companyKey(c.name); if (k && !companyByKey.has(k)) companyByKey.set(k, c); }
  const leadsById = new Map(input.leads.filter(Boolean).map((l: any) => [l.id, l]));
  const leadByDeal = new Map<string, any>(); for (const l of input.leads) if (l?.convertedDealId) leadByDeal.set(l.convertedDealId, l);
  const clientsById = new Map(input.billingClients.filter(Boolean).map((c: any) => [c.id, c]));

  const customers = new Map<string, Customer>();
  const contactCustomer = (c: any): Customer => {
    const key = `contact:${c.id}`;
    let x = customers.get(key);
    if (!x) {
      const emails = [c.email, ...(c.altEmails || [])].map(normEmail).filter(Boolean);
      x = { key, id: c.id, type: 'contact', name: c.name || c.email || 'Unnamed contact', email: c.email || '', company: c.company || '', purchases: [], activityKeys: new Set([c.id]), emails, phones: [c.phone, ...(c.altPhones || [])].map(normPhone).filter(Boolean) };
      customers.set(key, x);
    }
    return x;
  };
  const companyCustomer = (company: any | null, name: string): Customer | null => {
    const k = company ? company.id : companyKey(name);
    if (!k) return null;
    const key = `company:${k}`;
    let x = customers.get(key);
    if (!x) { x = { key, id: company ? company.id : `name:${k}`, type: 'company', name: company?.name || name, email: '', company: company?.name || name, purchases: [], activityKeys: new Set(company ? [company.id] : []), emails: [], phones: [] }; customers.set(key, x); }
    return x;
  };
  const companyFor = (id: unknown, ...names: unknown[]) => {
    const byId = id ? companyById.get(String(id)) : null;
    if (byId) return { company: byId, name: byId.name };
    for (const n of names) { const k = companyKey(n); if (k) return { company: companyByKey.get(k) || null, name: String(n).trim() }; }
    return null;
  };

  // ---- Won deals ----
  let unmatchedDeals = 0, noValueDeals = 0;
  for (const d of deals.filter((x) => x.stage === 'won')) {
    const lead = leadsById.get(d.originLeadId) || leadsById.get(d.leadId) || leadByDeal.get(d.id) || null;
    const contact = resolveContact(d.contactId) || (lead && (resolveContact(lead.convertedContactId) || resolveContact(lead.contactId)))
      || (lead && (byEmail.get(normEmail(lead.email)) || byPhone.get(normPhone(lead.phone)))) || byEmail.get(normEmail(d.contactEmail || d.email)) || null;
    const at = closedAt(d, stageHistory(d, byDealFeed.get(String(d.id)) || [])) ?? now;
    const v = dealValue(d);
    if (v === null) noValueDeals++;
    const p: Purchase = { kind: 'deal', id: d.id, at, value: v ?? 0, noValue: v === null };
    let cust: Customer | null = null;
    if (contact) cust = contactCustomer(contact);
    else { const co = companyFor(d.companyId || lead?.convertedCompanyId, d.client, lead?.company); cust = co ? companyCustomer(co.company, co.name) : null; }
    if (!cust) { unmatchedDeals++; continue; }
    cust.purchases.push(p); cust.activityKeys.add(d.id); if (lead) cust.activityKeys.add(lead.id);
  }

  // ---- Paid invoices (workspace currency only; amounts are never converted) ----
  const paymentsByInvoice = new Map<string, any[]>();
  for (const p of input.payments) if (p?.invoiceId) paymentsByInvoice.set(p.invoiceId, [...(paymentsByInvoice.get(p.invoiceId) || []), p]);
  let unmatchedInvoices = 0, otherCurrency = 0;
  for (const inv of input.invoices) {
    if (!inv || inv.lifecycle === 'void' || inv.lifecycle === 'draft') continue;
    const pays = paymentsByInvoice.get(inv.id) || [];
    let totals;
    try { totals = calculateInvoice({ currency: inv.currency, items: inv.items || [], discount: inv.discount || { type: 'fixed', value: '' }, fees: inv.fees || [] }, pays); } catch { continue; }
    if (totals.total <= 0n || totals.balanceDue > 0n) continue;
    if (inv.currency !== input.currency) { otherCurrency++; continue; }
    const confirmed = pays.filter((p) => p.status === 'confirmed' && p.currency === inv.currency).map((p) => ts(p.date) ?? ts(p.createdAt)).filter((x): x is number => x !== null);
    const at = confirmed.length ? Math.max(...confirmed) : ts(inv.updatedAt) ?? now;
    const value = Number(minorToDecimalString(totals.total, inv.currency));
    const client = inv.clientId ? clientsById.get(inv.clientId) : null;
    const contact = resolveContact(client?.contactId) || byEmail.get(normEmail(client?.email)) || byEmail.get(normEmail(inv.billTo?.email))
      || byPhone.get(normPhone(inv.billTo?.phone)) || byPhone.get(normPhone(client?.phone)) || null;
    let cust: Customer | null = null;
    if (contact) cust = contactCustomer(contact);
    else { const co = companyFor(null, inv.billTo?.company, client?.company, client?.companyName); cust = co ? companyCustomer(co.company, co.name) : null; }
    if (!cust) { unmatchedInvoices++; continue; }
    cust.purchases.push({ kind: 'invoice', id: inv.id, at, value, noValue: false });
  }

  // ---- Last activity (secondary signal) ----
  const feedTimes = new Map<string, number>();
  for (const a of input.feed) { const t = ts(a?.timestamp); if (a?.targetId && t !== null) feedTimes.set(String(a.targetId), Math.max(feedTimes.get(String(a.targetId)) ?? 0, t)); }
  const phoneTimes = new Map<string, number>();
  for (const m of input.phoneMessages || []) { const k = normPhone(m.phone), t = ts(m.at); if (k && t !== null) phoneTimes.set(k, Math.max(phoneTimes.get(k) ?? 0, t)); }
  const lastActivity = (c: Customer): number | null => {
    const times: number[] = [];
    for (const k of c.activityKeys) { const t = feedTimes.get(k); if (t) times.push(t); }
    for (const e of c.emails) for (const m of input.messagesByEmail?.get(e) || []) { const t = ts(m.at); if (t !== null) times.push(t); }
    for (const p of c.phones) { const t = phoneTimes.get(p); if (t) times.push(t); }
    return times.length ? Math.max(...times) : null;
  };

  // ---- RFM ----
  const buyers = [...customers.values()].filter((c) => c.purchases.length);
  const rows = buyers.map((c) => {
    const last = Math.max(...c.purchases.map((p) => p.at));
    return { c, last, recency: Math.max(0, Math.floor((now - last) / DAY)), frequency: c.purchases.length, monetary: round(c.purchases.reduce((s, p) => s + p.value, 0), 2), activity: lastActivity(c) };
  });
  const n = rows.length;
  const method: SegmentsResult['method'] = n >= QUINTILE_MIN ? 'quintiles' : 'fixed';
  const medM = median(rows.map((r) => r.monetary));
  const quintile = (values: number[], x: number, lowerIsBetter: boolean) => {
    const worse = values.filter((v) => (lowerIsBetter ? v > x : v < x)).length;
    return Math.min(5, 1 + Math.floor((5 * worse) / values.length));
  };
  const R = rows.map((r) => r.recency), F = rows.map((r) => r.frequency), M = rows.map((r) => r.monetary);
  const scoreR = (x: number) => method === 'quintiles' ? quintile(R, x, true) : x <= 30 ? 5 : x <= 90 ? 4 : x <= 180 ? 3 : x <= 365 ? 2 : 1;
  const scoreF = (x: number) => method === 'quintiles' ? quintile(F, x, false) : x >= 10 ? 5 : x >= 5 ? 4 : x >= 3 ? 3 : x >= 2 ? 2 : 1;
  const scoreM = (x: number) => {
    if (method === 'quintiles') return quintile(M, x, false);
    if (!medM) return x > 0 ? 3 : 1; // every customer at $0 (no values recorded): nothing to compare
    const k = x / medM;
    return k >= 4 ? 5 : k >= 2 ? 4 : k >= 1 ? 3 : k >= 0.5 ? 2 : 1;
  };

  const members: Member[] = rows.map((row) => {
    const r = scoreR(row.recency), f = scoreF(row.frequency), m = scoreM(row.monetary);
    const quietDays = row.activity !== null ? Math.floor((now - row.activity) / DAY) : null;
    const quiet = quietDays === null || quietDays >= QUIET_DAYS;
    const engaged = quietDays !== null && quietDays <= ENGAGED_DAYS;
    let segment: SegmentId; let why: string;
    if (r >= 4 && f >= 4) { segment = 'champions'; why = 'buys often and recently'; }
    else if (r >= 3 && f >= 3 && !(r === 3 && f === 3 && quiet)) { segment = 'loyal'; why = 'buys regularly'; }
    else if (r <= 2 && (f >= 3 || m >= 4)) { segment = 'at_risk'; why = `used to buy ${f >= 3 ? 'often' : 'big'} but not lately${engaged ? ` (still in touch ${quietDays} days ago: a good moment to reach out)` : ''}`; }
    else if (r === 3 && f >= 2 && f <= 3 && quiet) { segment = 'at_risk'; why = quietDays === null ? 'buying is slowing and there is no recorded activity' : `buying is slowing and no activity for ${quietDays} days`; }
    else if (r >= 4) { segment = 'promising'; why = f === 1 ? 'first purchase was recent' : 'recent buyer with few purchases so far'; }
    else if (r === 3 || engaged) { segment = 'needs_attention'; why = r === 3 ? 'hasn’t bought for a while' : `hasn’t bought for a while but was in touch ${quietDays} days ago`; }
    else { segment = 'hibernating'; why = quietDays === null ? 'no recent purchases or activity' : `no recent purchases; last activity ${quietDays} days ago`; }
    const noVal = row.c.purchases.filter((p) => p.noValue).length;
    const reason = `${cap(why)}. ${plural(row.frequency, 'purchase')}, last ${row.recency === 0 ? 'today' : `${row.recency} day${row.recency === 1 ? '' : 's'} ago`}, ${money(row.monetary)} in total${noVal ? ` (${noVal} won deal${noVal === 1 ? '' : 's'} without a value)` : ''}: R${r} F${f} M${m}.`;
    return {
      id: row.c.id, type: row.c.type, name: row.c.name, email: row.c.email, company: row.c.company,
      recencyDays: row.recency, frequency: row.frequency, monetary: row.monetary, r, f, m, segment, reason,
      lastPurchaseAt: new Date(row.last).toISOString(), lastActivityAt: row.activity !== null ? new Date(row.activity).toISOString() : null,
    };
  });

  const band = (key: 'r' | 'f' | 'm', value: (x: Member) => number): ScoreBand[] => [5, 4, 3, 2, 1].map((score) => {
    const vs = members.filter((x) => x[key] === score).map(value);
    return { score, min: vs.length ? Math.min(...vs) : 0, max: vs.length ? Math.max(...vs) : 0, customers: vs.length };
  });
  const explanation = method === 'quintiles'
    ? `${n} customers, so each score is a fifth of your own customers: 5 is the best 20% (most recent, most purchases, highest total).`
    : `Only ${plural(n, 'customer')} (quintiles need ${QUINTILE_MIN}), so fixed thresholds are used: recency 5 = bought in the last 30 days, 4 = 90, 3 = 180, 2 = 365, 1 = older; frequency 5 = 10+ purchases, 4 = 5–9, 3 = 3–4, 2 = 2, 1 = 1; monetary compares each total with the median customer${medM ? ` (${money(medM)})` : ''}: 5 = 4× or more, 4 = 2×, 3 = 1×, 2 = half, 1 = less.`;

  const prospects = contacts.filter((c) => !customers.get(`contact:${c.id}`)?.purchases.length).length;
  const notes: string[] = [];
  if (!n) notes.push('No purchases yet: customers appear here once deals are won or invoices are paid.');
  if (method === 'fixed' && n) notes.push(`Fewer than ${QUINTILE_MIN} customers: scores use fixed thresholds instead of quintiles.`);
  if (prospects) notes.push(`${plural(prospects, 'contact')} with no purchase ${prospects === 1 ? 'is a prospect' : 'are prospects'}: counted, not scored.`);
  if (unmatchedDeals || unmatchedInvoices) notes.push(`${[unmatchedDeals && plural(unmatchedDeals, 'won deal'), unmatchedInvoices && plural(unmatchedInvoices, 'paid invoice')].filter(Boolean).join(' and ')} couldn’t be tied to a contact or company and ${unmatchedDeals + unmatchedInvoices === 1 ? 'is' : 'are'} left out.`);
  if (noValueDeals) notes.push(`${plural(noValueDeals, 'won deal')} ${noValueDeals === 1 ? 'has' : 'have'} no value: counted as a purchase worth $0.`);
  if (otherCurrency) notes.push(`${plural(otherCurrency, 'paid invoice')} in another currency than ${input.currency} ${otherCurrency === 1 ? 'is' : 'are'} left out (amounts are never converted).`);
  if (n && members.some((m) => m.type === 'company')) notes.push('Purchases that couldn’t be tied to a person are grouped by company.');

  const segments = ORDER.map((id) => {
    const list = members.filter((m) => m.segment === id).sort((a, b) => b.monetary - a.monetary || a.recencyDays - b.recencyDays);
    return { id, label: SEGMENT_RULES[id].label, rule: SEGMENT_RULES[id].rule, count: list.length, members: list.slice(0, MAX_MEMBERS), truncated: list.length > MAX_MEMBERS };
  });
  return {
    generatedAt: new Date(now).toISOString(), currency: input.currency, customers: n, prospects, method,
    thresholds: { explanation, recency: band('r', (x) => x.recencyDays), frequency: band('f', (x) => x.frequency), monetary: band('m', (x) => x.monetary), medianMonetary: medM },
    segments, unmatched: { deals: unmatchedDeals, invoices: unmatchedInvoices }, notes,
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
