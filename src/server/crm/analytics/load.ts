/**
 * Reads what the reports need for one organization, always under organizations/{orgId} or billing/{orgId}.
 * The report functions themselves are pure (forecast.ts, pipelineHealth.ts, segments.ts, dealActions.ts).
 */
import { assertId, getDocStore } from '../../data/docStore';
import { inboxMessagesByEmail } from '../../../routes/messagingPlatform';
import { buildForecast, buildOrgModel, forecastDeal } from './forecast';
import { buildPipelineHealth } from './pipelineHealth';
import { buildSegments } from './segments';
import { buildDealActions } from './dealActions';
import { isOpen, normalizeDeals } from './common';

const FEED_LIMIT = 5000;

async function core(orgId: string) {
  const st = await getDocStore();
  const base = `organizations/${assertId(orgId)}`;
  const [deals, leads, feed] = await Promise.all([
    st.list(`${base}/deals`), st.list(`${base}/leads`),
    st.list(`${base}/activities`, { orderBy: 'timestamp', direction: 'desc', limit: FEED_LIMIT }).catch(() => []),
  ]);
  return { st, base, deals, leads, feed };
}

export async function forecastReport(orgId: string, months: number, now = Date.now()) {
  const { deals, feed } = await core(orgId);
  return buildForecast(deals, feed, now, { months });
}

export async function pipelineReport(orgId: string, now = Date.now()) {
  const { deals, leads, feed } = await core(orgId);
  return buildPipelineHealth(deals, leads, feed, now);
}

export async function segmentsReport(orgId: string, now = Date.now()) {
  const { st, base, deals, leads, feed } = await core(orgId);
  const billing = `billing/${assertId(orgId)}`;
  const root = await st.get(billing).catch(() => null);
  const [contacts, companies, invoices, payments, billingClients, inbound, outbound, inbox] = await Promise.all([
    st.list(`${base}/contacts`), st.list(`${base}/companies`),
    root ? st.list(`${billing}/invoices`) : Promise.resolve([]), root ? st.list(`${billing}/payments`) : Promise.resolve([]), root ? st.list(`${billing}/clients`) : Promise.resolve([]),
    st.list(`${base}/inbound_messages`, { orderBy: 'at', direction: 'desc', limit: 2000 }).catch(() => []),
    st.list(`${base}/outbound_messages`, { orderBy: 'at', direction: 'desc', limit: 2000 }).catch(() => []),
    inboxMessagesByEmail(orgId).catch(() => new Map()),
  ]);
  return buildSegments({
    contacts, companies, leads, deals, feed, invoices, payments, billingClients,
    currency: String(root?.settings?.defaultCurrency || 'USD'),
    messagesByEmail: inbox,
    phoneMessages: [...inbound.map((m: any) => ({ at: m.at, phone: m.from })), ...outbound.map((m: any) => ({ at: m.at, phone: m.to }))],
  }, now);
}

export async function dealActionsReport(orgId: string, opts: { dealId?: string } = {}, now = Date.now()) {
  const { st, base, deals, leads, feed } = await core(orgId);
  const live = normalizeDeals(deals);
  const model = buildOrgModel(live, feed);
  let open = live.filter(isOpen);
  if (opts.dealId) open = open.filter((d) => d.id === opts.dealId);
  const forecasts = open.map((d) => forecastDeal(d, model, now));
  const [tasks, proposals, inbox] = await Promise.all([
    st.list(`${base}/tasks`).catch(() => []), st.list(`${base}/proposals`).catch(() => []), inboxMessagesByEmail(orgId).catch(() => new Map()),
  ]);
  // Older lead tasks that were never copied into the unified list (read-through, bounded to these deals' leads).
  const leadIds = [...new Set(open.flatMap((d) => [d.originLeadId, d.leadId]).filter(Boolean))].slice(0, 300);
  for (const l of leads) if (l?.convertedDealId && open.some((d) => d.id === l.convertedDealId)) leadIds.push(l.id);
  const leadTasks = new Map<string, any[]>();
  await Promise.all([...new Set(leadIds)].map(async (id) => { try { leadTasks.set(id, await st.list(`${base}/leads/${assertId(id)}/tasks`)); } catch { /* skip invalid ids */ } }));
  return buildDealActions({ forecasts, deals: live, tasks, feed, proposals, leads, leadTasks, messagesByEmail: inbox }, now);
}
