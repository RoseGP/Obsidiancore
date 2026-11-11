/**
 * Deal next-best-action: rules over each open deal, every one with its reason, ranked by
 * priority = expected value (p × value, from the forecast) × urgency (the most urgent rule that fired).
 *
 *   close_date_passed   the close date is in the past → update it or mark the deal lost        urgency 3
 *   proposal_missing    in Proposal with no proposal on record (or only a draft) → send one    urgency 2.5
 *   stuck               in the stage > 2× the typical time (the forecast's age rule)            urgency 2
 *   re_engage           value ≥ 2× the median open deal and no activity for 14+ days            urgency 2
 *   no_open_task        no open task on the deal, its lead or contact → schedule a follow-up   urgency 1.5
 * Deals without a value have an expected value of 0, so they sort after valued deals with the same rules;
 * their reasons say so. Pure: same records and `now`, same list.
 */
import { DAY, dateLabel, median, money, plural, round, ts } from './common';
import type { DealForecast } from './forecast';
import { normEmail } from './entityMatch';

export const URGENCY = { close_date_passed: 3, proposal_missing: 2.5, stuck: 2, re_engage: 2, no_open_task: 1.5 } as const;
export type ActionType = keyof typeof URGENCY;
export const QUIET_DEAL_DAYS = 14;
export const HIGH_VALUE_MULTIPLE = 2;
export const MIN_VALUED_DEALS = 3;

export interface DealAction { type: ActionType; label: string; reason: string; urgency: number; view: string }
export interface DealActionRow {
  dealId: string; name: string; client: string; owner: string; stage: string; value: number | null; probability: number;
  expectedValue: number; urgency: number; priority: number; lastActivityAt: string | null; openTasks: number;
  actions: DealAction[]; primary: DealAction;
}
export interface DealActionsInput {
  forecasts: DealForecast[];
  deals: any[]; tasks: any[]; feed: any[]; proposals: any[]; leads: any[];
  leadTasks?: Map<string, any[]>;                         // legacy organizations/{org}/leads/{id}/tasks
  messagesByEmail?: Map<string, Array<{ at: string }>>;
}

const openTask = (t: any) => t && !t.deletedAt && !t.completed && t.status !== 'done' && t.status !== 'cancelled';

export function buildDealActions(input: DealActionsInput, now: number): { deals: DealActionRow[]; typicalValue: number | null; notes: string[] } {
  const dealById = new Map(input.deals.map((d: any) => [d.id, d]));
  const leadById = new Map(input.leads.filter(Boolean).map((l: any) => [l.id, l]));
  const leadByDeal = new Map<string, any>(); for (const l of input.leads) if (l?.convertedDealId) leadByDeal.set(l.convertedDealId, l);
  const valued = input.forecasts.map((f) => f.value).filter((v): v is number => v !== null);
  const typicalValue = valued.length >= MIN_VALUED_DEALS ? median(valued) : null;
  const feedTimes = new Map<string, number>();
  for (const a of input.feed) { const t = ts(a?.timestamp); if (a?.targetId && t !== null) feedTimes.set(String(a.targetId), Math.max(feedTimes.get(String(a.targetId)) ?? 0, t)); }

  const rows: DealActionRow[] = [];
  for (const f of input.forecasts) {
    const deal = dealById.get(f.id) || {};
    const lead = leadById.get(deal.originLeadId) || leadById.get(deal.leadId) || leadByDeal.get(f.id) || null;
    const contactId = deal.contactId || lead?.convertedContactId || lead?.contactId || null;
    const email = normEmail(deal.contactEmail || lead?.email);

    const tasks = input.tasks.filter((t: any) => openTask(t) && (t.dealId === f.id || (lead && t.leadId === lead.id) || (contactId && t.contactId === contactId)));
    const legacy = lead ? (input.leadTasks?.get(lead.id) || []).filter((t: any) => openTask(t) && !tasks.some((u: any) => u.id === t.id)) : [];
    const openTasks = tasks.length + legacy.length;

    const proposals = input.proposals.filter((p: any) => p && (p.dealId === f.id || (contactId && (p.crmContactId === contactId || p.contactId === contactId)) || (lead && p.contactId === lead.id) || (email && normEmail(p.client?.email) === email)));
    const sent = proposals.filter((p: any) => p.status !== 'draft');

    const times = [feedTimes.get(f.id), lead ? feedTimes.get(lead.id) : undefined, contactId ? feedTimes.get(contactId) : undefined,
      ...(email ? (input.messagesByEmail?.get(email) || []).map((m) => ts(m.at) ?? undefined) : []),
      ...input.tasks.filter((t: any) => t.dealId === f.id && t.completedAt).map((t: any) => ts(t.completedAt) ?? undefined)]
      .filter((x): x is number => typeof x === 'number');
    const last = times.length ? Math.max(...times) : null;
    const quietDays = last !== null ? Math.floor((now - last) / DAY) : null;

    const actions: DealAction[] = [];
    const nv = f.valueSet ? '' : ' No value set, so it ranks low: add one to rank it.';
    if (f.expectedClose.overdue && f.expectedClose.date) {
      const d = Date.parse(`${f.expectedClose.date}T00:00:00Z`);
      actions.push({ type: 'close_date_passed', label: 'Update the close date or mark it lost', urgency: URGENCY.close_date_passed, view: 'deals',
        reason: `The close date (${dateLabel(d)}) passed ${plural(Math.max(1, Math.floor((now - d) / DAY)), 'day')} ago and the deal is still open.${nv}` });
    }
    if (f.stage === 'proposal' && !sent.length) {
      actions.push({ type: 'proposal_missing', label: proposals.length ? 'Send the draft proposal' : 'Send a proposal', urgency: URGENCY.proposal_missing, view: 'proposals',
        reason: proposals.length ? `In Proposal, but its proposal (${proposals[0].number || 'draft'}) was never sent.${nv}` : `In Proposal, but no proposal for this deal is on record.${nv}` });
    }
    if (f.age.penalized) {
      actions.push({ type: 'stuck', label: 'Check in or re-qualify', urgency: URGENCY.stuck, view: 'deals', reason: `${f.age.note}${nv}` });
    }
    if (typicalValue && f.value !== null && f.value >= HIGH_VALUE_MULTIPLE * typicalValue && (quietDays === null || quietDays >= QUIET_DEAL_DAYS)) {
      actions.push({ type: 're_engage', label: 'Re-engage the buyer', urgency: URGENCY.re_engage, view: 'deals',
        reason: `Worth ${money(f.value)}, ${round(f.value / typicalValue, 1)}× your typical open deal (${money(typicalValue)}), ${quietDays === null ? 'with no recorded activity' : `but no activity for ${quietDays} days`}.` });
    }
    if (!openTasks) {
      actions.push({ type: 'no_open_task', label: 'Schedule a follow-up', urgency: URGENCY.no_open_task, view: 'tasks', reason: `No open task on this deal${lead ? ', its lead' : ''}${contactId ? ' or its contact' : ''}.${nv}` });
    }
    if (!actions.length) continue;
    actions.sort((a, b) => b.urgency - a.urgency);
    const urgency = actions[0].urgency;
    rows.push({
      dealId: f.id, name: f.name, client: f.client, owner: f.owner, stage: f.stageLabel, value: f.value, probability: f.probability,
      expectedValue: round(f.expectedValue, 2), urgency, priority: round(f.expectedValue * urgency, 2),
      lastActivityAt: last !== null ? new Date(last).toISOString() : null, openTasks, actions, primary: actions[0],
    });
  }
  rows.sort((a, b) => b.priority - a.priority || b.urgency - a.urgency || b.actions.length - a.actions.length || a.name.localeCompare(b.name));
  const notes: string[] = [];
  if (!input.forecasts.length) notes.push('No open deals: nothing to act on.');
  if (!typicalValue && input.forecasts.length) notes.push(`The “high value, low engagement” rule needs at least ${MIN_VALUED_DEALS} open deals with a value.`);
  return { deals: rows, typicalValue, notes };
}
