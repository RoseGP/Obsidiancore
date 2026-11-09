/**
 * Proposals (server). Organization-scoped documents, shared with clients through unguessable links.
 *
 *   organizations/{orgId}/proposals/{id}   the proposal (line items, terms, status, signature)
 *   proposal_shares/{sha256(token)}        share link → proposal (only the hash is stored)
 *
 * Totals are always computed here (amounts in minor units, e.g. cents); clients can only toggle optional items,
 * accept with a typed signature (recorded with a SHA-256 of exactly what was accepted) or decline.
 */
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { assertId, getDocStore, newId } from '../../../server/data/docStore';

export class ProposalError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}

export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined';

export interface ProposalItem { id: string; title: string; description: string; quantity: number; unitPrice: number; optional: boolean; selected: boolean }
export interface Proposal {
  id: string;
  orgId: string;
  number: string;
  title: string;
  client: { name: string; email: string; company: string };
  contactId: string | null;
  currency: string;
  intro: string;
  terms: string;
  validUntil: string | null;
  items: ProposalItem[];
  status: ProposalStatus;
  shareTokenHash: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  viewedAt: string | null;
  decidedAt: string | null;
  declineReason: string | null;
  signature: { name: string; title: string; email: string; signedAt: string; ip: string; userAgent: string; contentHash: string } | null;
}

const proposalsCol = (orgId: string) => `organizations/${orgId}/proposals`;
const proposalPath = (orgId: string, id: string) => `${proposalsCol(orgId)}/${assertId(id)}`;
const sharePath = (hash: string) => `proposal_shares/${hash}`;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const money = z.number().int('Amounts are in cents.').min(0).max(1_000_000_000_00);
const itemSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  title: z.string().trim().min(1, 'Each item needs a title.').max(200),
  description: z.string().max(2000).default(''),
  quantity: z.number().positive().max(100_000).default(1),
  unitPrice: money,
  optional: z.boolean().default(false),
  selected: z.boolean().optional(),
});
export const proposalInputSchema = z.object({
  title: z.string().trim().min(1, 'Add a title.').max(200),
  client: z.object({
    name: z.string().trim().min(1, 'Add the client\'s name.').max(200),
    email: z.string().trim().email('Add a valid client email.').max(254),
    company: z.string().trim().max(200).default(''),
  }),
  contactId: z.string().max(120).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code, e.g. USD.').default('USD'),
  intro: z.string().max(20_000).default(''),
  terms: z.string().max(20_000).default(''),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  items: z.array(itemSchema).min(1, 'Add at least one line item.').max(200),
});
export type ProposalInput = z.infer<typeof proposalInputSchema>;

export function totals(p: Pick<Proposal, 'items'>) {
  const line = (i: ProposalItem) => Math.round(i.quantity * i.unitPrice);
  const required = p.items.filter((i) => !i.optional).reduce((t, i) => t + line(i), 0);
  const options = p.items.filter((i) => i.optional && i.selected).reduce((t, i) => t + line(i), 0);
  return { required, options, total: required + options };
}

function normalizeItems(items: ProposalInput['items'], previous: ProposalItem[] = []): ProposalItem[] {
  return items.map((i) => {
    const prev = i.id ? previous.find((x) => x.id === i.id) : undefined;
    return {
      id: i.id && prev ? i.id : newId('pi'), title: i.title, description: i.description ?? '', quantity: i.quantity ?? 1, unitPrice: i.unitPrice,
      optional: !!i.optional, selected: i.optional ? (i.selected ?? prev?.selected ?? false) : true,
    };
  });
}

// ---------------------------------------------------------------------------
// Staff (organization members)
// ---------------------------------------------------------------------------

export async function listProposals(orgId: string) {
  const rows: Proposal[] = await (await getDocStore()).list(proposalsCol(orgId));
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((p) => ({ ...strip(p), totals: totals(p) }));
}

export async function getProposal(orgId: string, id: string): Promise<Proposal> {
  const p = await (await getDocStore()).get(proposalPath(orgId, id));
  if (!p) throw new ProposalError(404, 'not_found', 'Proposal not found.');
  return p;
}

export async function createProposal(orgId: string, userId: string, raw: unknown) {
  const input = proposalInputSchema.parse(raw);
  const st = await getDocStore();
  const now = new Date().toISOString();
  const count = (await st.list(proposalsCol(orgId))).length;
  const p: Proposal = {
    id: newId('prop'), orgId, number: `P-${String(count + 1).padStart(4, '0')}`, title: input.title, client: { ...input.client, company: input.client.company ?? '' },
    contactId: input.contactId ?? null, currency: input.currency, intro: input.intro, terms: input.terms, validUntil: input.validUntil ?? null,
    items: normalizeItems(input.items), status: 'draft', shareTokenHash: null, createdBy: userId, createdAt: now, updatedAt: now,
    sentAt: null, viewedAt: null, decidedAt: null, declineReason: null, signature: null,
  };
  await st.set(proposalPath(orgId, p.id), p as any);
  return p;
}

export async function updateProposal(orgId: string, id: string, raw: unknown) {
  const input = proposalInputSchema.parse(raw);
  const st = await getDocStore();
  return st.transaction(async (tx) => {
    const p: Proposal | null = await tx.get(proposalPath(orgId, id));
    if (!p) throw new ProposalError(404, 'not_found', 'Proposal not found.');
    if (p.status === 'accepted' || p.status === 'declined') throw new ProposalError(409, 'proposal_closed', `This proposal was ${p.status}; duplicate it to make changes.`);
    const next: Proposal = {
      ...p, title: input.title, client: { ...input.client, company: input.client.company ?? '' }, contactId: input.contactId ?? null,
      currency: input.currency, intro: input.intro, terms: input.terms, validUntil: input.validUntil ?? null,
      items: normalizeItems(input.items, p.items), updatedAt: new Date().toISOString(),
    };
    tx.set(proposalPath(orgId, id), next as any);
    return next;
  });
}

export async function deleteProposal(orgId: string, id: string) {
  const st = await getDocStore();
  const p = await getProposal(orgId, id);
  if (p.shareTokenHash) await st.deleteRecursive(sharePath(p.shareTokenHash));
  await st.deleteRecursive(proposalPath(orgId, id));
}

/** Creates (or replaces) the client link. The token is returned once; only its hash is stored. */
export async function shareProposal(orgId: string, id: string) {
  const st = await getDocStore();
  const token = randomBytes(24).toString('base64url');
  const hash = sha256(token);
  const p = await st.transaction(async (tx) => {
    const cur: Proposal | null = await tx.get(proposalPath(orgId, id));
    if (!cur) throw new ProposalError(404, 'not_found', 'Proposal not found.');
    if (cur.shareTokenHash) tx.delete(sharePath(cur.shareTokenHash));
    const now = new Date().toISOString();
    const next = { ...cur, shareTokenHash: hash, status: cur.status === 'draft' ? 'sent' as const : cur.status, sentAt: cur.sentAt ?? now, updatedAt: now };
    tx.set(proposalPath(orgId, id), next as any);
    tx.set(sharePath(hash), { orgId, proposalId: id, createdAt: now });
    return next;
  });
  return { proposal: p, token };
}

export async function revokeShare(orgId: string, id: string) {
  const st = await getDocStore();
  return st.transaction(async (tx) => {
    const cur: Proposal | null = await tx.get(proposalPath(orgId, id));
    if (!cur) throw new ProposalError(404, 'not_found', 'Proposal not found.');
    if (cur.shareTokenHash) tx.delete(sharePath(cur.shareTokenHash));
    const next = { ...cur, shareTokenHash: null, updatedAt: new Date().toISOString() };
    tx.set(proposalPath(orgId, id), next as any);
    return next;
  });
}

// ---------------------------------------------------------------------------
// Client (share link)
// ---------------------------------------------------------------------------

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function resolveShare(token: string): Promise<{ orgId: string; proposalId: string }> {
  if (!TOKEN_RE.test(token)) throw new ProposalError(404, 'not_found', 'This proposal link isn\'t valid.');
  const share = await (await getDocStore()).get(sharePath(sha256(token)));
  if (!share) throw new ProposalError(404, 'not_found', 'This proposal link isn\'t valid or was withdrawn.');
  return share;
}

/** What the client sees: no internal ids or staff fields. */
export function clientView(p: Proposal, orgName: string) {
  return {
    number: p.number, title: p.title, from: orgName, client: p.client, currency: p.currency, intro: p.intro, terms: p.terms,
    validUntil: p.validUntil, status: p.status, items: p.items, totals: totals(p),
    decidedAt: p.decidedAt, signature: p.signature ? { name: p.signature.name, title: p.signature.title, signedAt: p.signature.signedAt } : null,
    expired: !!p.validUntil && p.validUntil < new Date().toISOString().slice(0, 10) && p.status !== 'accepted',
  };
}

export async function openShared(token: string) {
  const { orgId, proposalId } = await resolveShare(token);
  const st = await getDocStore();
  return st.transaction(async (tx) => {
    const p: Proposal | null = await tx.get(proposalPath(orgId, proposalId));
    if (!p) throw new ProposalError(404, 'not_found', 'This proposal is no longer available.');
    if (p.status === 'sent') {
      const next = { ...p, status: 'viewed' as const, viewedAt: new Date().toISOString() };
      tx.set(proposalPath(orgId, proposalId), next as any);
      return next;
    }
    return p;
  });
}

async function mutateShared(token: string, fn: (p: Proposal) => Proposal) {
  const { orgId, proposalId } = await resolveShare(token);
  const st = await getDocStore();
  return st.transaction(async (tx) => {
    const p: Proposal | null = await tx.get(proposalPath(orgId, proposalId));
    if (!p) throw new ProposalError(404, 'not_found', 'This proposal is no longer available.');
    if (p.status === 'accepted' || p.status === 'declined') throw new ProposalError(409, 'proposal_closed', `This proposal was already ${p.status}.`);
    if (p.validUntil && p.validUntil < new Date().toISOString().slice(0, 10)) throw new ProposalError(409, 'proposal_expired', 'This proposal has expired. Ask the sender for a new one.');
    const next = fn(p);
    tx.set(proposalPath(orgId, proposalId), { ...next, updatedAt: new Date().toISOString() } as any);
    return next;
  });
}

export function selectOption(token: string, itemId: string, selected: boolean) {
  return mutateShared(token, (p) => {
    const item = p.items.find((i) => i.id === itemId);
    if (!item) throw new ProposalError(404, 'not_found', 'That item isn\'t part of this proposal.');
    if (!item.optional) throw new ProposalError(400, 'item_required', 'This item is included and can\'t be removed.');
    return { ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, selected } : i)) };
  });
}

/** The exact content the client accepts (hashed into the signature record). */
export function acceptedContent(p: Proposal) {
  return JSON.stringify({ number: p.number, title: p.title, client: p.client, currency: p.currency, terms: p.terms, items: p.items.filter((i) => !i.optional || i.selected).map((i) => ({ title: i.title, description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })), totals: totals(p) });
}

export const acceptSchema = z.object({
  name: z.string().trim().min(2, 'Type your full name to sign.').max(200),
  title: z.string().trim().max(200).default(''),
  email: z.string().trim().email('Enter a valid email.').max(254),
  agree: z.literal(true, { message: 'Confirm that you accept the proposal.' }),
});

export function acceptShared(token: string, raw: unknown, meta: { ip: string; userAgent: string }) {
  const input = acceptSchema.parse(raw);
  return mutateShared(token, (p) => {
    const signedAt = new Date().toISOString();
    return {
      ...p, status: 'accepted', decidedAt: signedAt,
      signature: { name: input.name, title: input.title ?? '', email: input.email, signedAt, ip: meta.ip.slice(0, 64), userAgent: meta.userAgent.slice(0, 300), contentHash: sha256(acceptedContent(p)) },
    };
  });
}

export function declineShared(token: string, reason: unknown) {
  return mutateShared(token, (p) => ({ ...p, status: 'declined', decidedAt: new Date().toISOString(), declineReason: typeof reason === 'string' ? reason.trim().slice(0, 1000) : null }));
}

/** Staff-facing copy without the link hash. */
export function strip(p: Proposal) {
  const { shareTokenHash, ...rest } = p;
  return { ...rest, shared: !!shareTokenHash };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmt = (cents: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);

/** Printable document (all text escaped). */
export function renderDocument(p: Proposal, orgName: string) {
  const t = totals(p);
  const rows = p.items.map((i) => `<tr${i.optional && !i.selected ? ' class="off"' : ''}><td>${esc(i.title)}${i.optional ? ' <em>(optional)</em>' : ''}<div class="d">${esc(i.description)}</div></td><td class="n">${esc(i.quantity)}</td><td class="n">${fmt(i.unitPrice, p.currency)}</td><td class="n">${i.optional && !i.selected ? '—' : fmt(Math.round(i.quantity * i.unitPrice), p.currency)}</td></tr>`).join('');
  const sig = p.signature ? `<div class="sig"><b>Accepted by ${esc(p.signature.name)}</b>${p.signature.title ? `, ${esc(p.signature.title)}` : ''} on ${esc(new Date(p.signature.signedAt).toUTCString())}<br><small>Record: SHA-256 ${esc(p.signature.contentHash)}</small></div>` : p.status === 'declined' ? '<div class="sig">Declined.</div>' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.number)} ${esc(p.title)}</title><style>
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111827;max-width:820px;margin:40px auto;padding:0 24px}
h1{font-size:22px;margin:0}.m{color:#6b7280;font-size:13px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:left;vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}.n{text-align:right;white-space:nowrap}.d{color:#6b7280;font-size:12px}.off{color:#9ca3af}
.tot td{font-weight:700;border-bottom:0}.sig{margin-top:24px;padding:14px;border:1px solid #d1d5db;border-radius:8px}pre{white-space:pre-wrap;font:inherit}
</style></head><body><h1>${esc(p.title)}</h1><p class="m">${esc(p.number)} · From ${esc(orgName)} · For ${esc(p.client.name)}${p.client.company ? `, ${esc(p.client.company)}` : ''}${p.validUntil ? ` · Valid until ${esc(p.validUntil)}` : ''}</p>
${p.intro ? `<pre>${esc(p.intro)}</pre>` : ''}<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr class="tot"><td colspan="3" class="n">Total</td><td class="n">${fmt(t.total, p.currency)}</td></tr></tfoot></table>
${p.terms ? `<h3>Terms</h3><pre>${esc(p.terms)}</pre>` : ''}${sig}</body></html>`;
}

export const _test = { sha256, sharePath };
