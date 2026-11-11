/**
 * Lead Intelligence: explainable lead qualification from the organization's own records.
 *
 * Seven factors, each scored 0-100 with the evidence that produced it:
 *   buying intent 25 · budget 20 · requirements 15 · engagement 15 · communication 10 · deal value 10 · responsiveness 5
 * The weighted total (0-100) gives the class: Hot ≥ 65, Warm 40-64, Cold < 40. Qualification evidence (intent,
 * budget, authority/need/timeline) carries most weight so a strong new lead isn't penalised for having no history yet.
 *
 * Signals come from: the lead record (budget, authority, need, timeline, notes, source, status), its activity
 * log and tasks, inbox conversations and WhatsApp/SMS messages matched by email/phone, proposals sent to the
 * lead, scheduled meetings with the lead, and deals created from the lead. Predictions (closing probability,
 * value, follow-up timing, approach, objections, next best action) are rules over those signals; closing
 * probability calibrates to the organization's own win history once it has enough closed deals from leads.
 * Nothing is invented: a factor with no data scores low and says so.
 */
import { getDocStore, assertId } from '../data/docStore';
import { CrmRepository } from './crmRepository';
import { inboxMessagesByEmail } from '../../routes/messagingPlatform';

const HOUR = 3_600_000;
const DAY = 86_400_000;

export type LeadClass = 'hot' | 'warm' | 'cold';
export type FactorId = 'engagement' | 'communication' | 'intent' | 'budget' | 'requirements' | 'responsiveness' | 'value';
export const FACTOR_WEIGHTS: Record<FactorId, number> = { engagement: 15, communication: 10, intent: 25, budget: 20, requirements: 15, responsiveness: 5, value: 10 };
export const HOT_MIN = 65;
export const WARM_MIN = 40;
export const FACTOR_LABELS: Record<FactorId, string> = {
  engagement: 'Lead engagement', communication: 'Communication history', intent: 'Buying intent', budget: 'Budget indicators',
  requirements: 'Business requirements', responsiveness: 'Response frequency', value: 'Potential deal value',
};

export interface Message { at: string; fromCustomer: boolean; text: string; channel: string }
export interface LeadSignals {
  messages: Message[];                                   // inbox + WhatsApp/SMS (inbound and outbound), oldest first
  activities: { type?: string; title?: string; description?: string; timestamp?: string }[];
  tasks: { completed?: boolean; dueDate?: string }[];
  proposals: { number?: string; status: string; sentAt?: string | null; viewedAt?: string | null; total?: number }[];
  meetings: { title: string; start: string }[];
  deals: { stage?: string; value?: number }[];
}
export interface OrgContext {
  typicalDealValue: number | null;                       // median value of the org's deals (null if none)
  calibration: { hot: number | null; warm: number | null; cold: number | null; closedDeals: number };
}

export interface Factor { id: FactorId; label: string; weight: number; score: number; evidence: string[] }
export interface NextBestAction { type: 'reply' | 'convert' | 'schedule' | 'proposal' | 'contact' | 'nurture'; label: string; detail: string; view?: string }
export interface LeadAnalysis {
  leadId: string; name: string; company: string; email: string; phone: string; source: string; status: string; owner: string;
  createdAt: string; converted: boolean; convertedDealId?: string;
  score: number; classification: LeadClass; explanation: string; factors: Factor[];
  prediction: {
    closingProbability: number; probabilityBasis: string;
    potentialValue: number | null; valueBasis: string;
    followUp: { when: string; dueAt: string | null; reason: string; bestTime: string | null };
    approach: string[]; objections: string[];
  };
  qualified: boolean;
  nextBestAction: NextBestAction | null;
  lastActivityAt: string | null;
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
const ts = (v?: string | null) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
const ago = (t: number, now: number) => {
  const h = (now - t) / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min ago`;
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} days ago`;
};
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

const INTENT_STRONG = /\b(quote|pricing|price|proposal|contract|sign|purchase|buy|ready to|get started|start (?:next|this)|invoice|book (?:a|the)|onboard)\b/i;
const INTENT_MEDIUM = /\b(demo|availability|available|how much|cost|interested|timeline|options|package|plan|trial|call me|meeting)\b/i;
const INTENT_NEGATIVE = /\b(not interested|no longer|unsubscribe|stop|too expensive|just looking|maybe later|no budget|went with|chose another)\b/i;
const COMPETITOR = /\b(other (?:quote|vendor|agency|provider)|competitor|already (?:use|have|work with)|comparing|cheaper)\b/i;
const MONEY_RE = /\$\s?([\d,]+(?:\.\d+)?)\s?(k|m)?\b|\b([\d,]+(?:\.\d+)?)\s?(k|m)?\s?(?:usd|dollars)\b/gi;
const URGENT_TIMELINE = /immediate|asap|urgent|this week|this month|< ?1|under 1|0-1|1 month|30 days/i;
const LONG_TIMELINE = /6\+|6-12|12|year|next year|later|unknown|no timeline/i;
const SENIOR_TITLE = /owner|founder|ceo|cfo|coo|cto|president|director|vp|vice|head|chief|partner|principal|manager/i;

function moneyMentions(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const raw = Number(String(m[1] || m[3] || '').replace(/,/g, ''));
    const mult = /k/i.test(m[2] || m[4] || '') ? 1_000 : /m/i.test(m[2] || m[4] || '') ? 1_000_000 : 1;
    if (Number.isFinite(raw) && raw * mult >= 100) out.push(raw * mult);
  }
  return out;
}

/** Scores one lead. Pure: same inputs, same result. */
export function analyzeLead(lead: any, s: LeadSignals, ctx: OrgContext, now: number = Date.now()): LeadAnalysis {
  const q = lead.qualification || {};
  const status = String(lead.status || 'new');
  const inbound = s.messages.filter((m) => m.fromCustomer);
  const outbound = s.messages.filter((m) => !m.fromCustomer);
  const customerText = [lead.notes, q.need, ...inbound.map((m) => m.text)].filter(Boolean).join('\n');
  const created = ts(lead.createdAt) ?? now;
  const lastInbound = inbound.length ? ts(inbound[inbound.length - 1].at) : null;
  const lastOutbound = outbound.length ? ts(outbound[outbound.length - 1].at) : null;
  const awaitingReply = lastInbound !== null && (lastOutbound === null || lastOutbound < lastInbound);
  const viewed = s.proposals.filter((p) => p.status === 'viewed' || p.viewedAt);
  const accepted = s.proposals.filter((p) => p.status === 'accepted');
  const upcoming = s.meetings.filter((m) => (ts(m.start) ?? 0) > now);
  const pastMeetings = s.meetings.filter((m) => (ts(m.start) ?? Infinity) <= now);

  // 1. Engagement
  const eng: string[] = []; let e = 0;
  if (status === 'contacted') { e += 15; eng.push('Marked contacted'); }
  if (status === 'qualified') { e += 30; eng.push('Marked qualified'); }
  if (s.proposals.length) { e += 15; eng.push(`${s.proposals.length} proposal${s.proposals.length === 1 ? '' : 's'} sent`); }
  if (viewed.length) { e += 20; eng.push(`Opened proposal ${viewed[0].number || ''}`.trim()); }
  if (accepted.length) { e += 30; eng.push('Accepted a proposal'); }
  if (upcoming.length) { e += 45; eng.push(`Meeting booked: ${upcoming[0].title}`); }
  if (pastMeetings.length) { e += 15; eng.push(`${pastMeetings.length} meeting${pastMeetings.length === 1 ? '' : 's'} held`); }
  const doneTasks = s.tasks.filter((t) => t.completed).length;
  if (doneTasks) { e += Math.min(10, doneTasks * 5); eng.push(`${doneTasks} follow-up task${doneTasks === 1 ? '' : 's'} done`); }
  if (!eng.length) eng.push('No meetings, proposals or follow-ups yet');

  // 2. Communication history
  const com: string[] = []; let c = 0;
  if (s.messages.length) {
    c += Math.min(60, s.messages.length * 8);
    com.push(`${s.messages.length} message${s.messages.length === 1 ? '' : 's'} exchanged (${inbound.length} from them)`);
    const channels = [...new Set(s.messages.map((m) => m.channel))];
    if (channels.length > 1) { c += 15; com.push(`Talking on ${channels.length} channels`); }
    const last = Math.max(lastInbound ?? 0, lastOutbound ?? 0);
    if (now - last < 3 * DAY) { c += 25; com.push(`Last message ${ago(last, now)}`); } else com.push(`Last message ${ago(last, now)}`);
  } else com.push('No conversation history yet');

  // 3. Buying intent
  const int: string[] = []; let i = 0;
  const phrase = (w: string) => (/^(quote|pricing|price|proposal|contract|invoice|demo|availability|cost|options|package|plan|trial|timeline)$/i.test(w) ? `Asked about ${w.toLowerCase()}` : /^how much$/i.test(w) ? 'Asked how much it costs' : `Said “${w.toLowerCase()}”`);
  if (INTENT_STRONG.test(customerText)) { i += 55; int.push(phrase(customerText.match(INTENT_STRONG)![0])); }
  else if (INTENT_MEDIUM.test(customerText)) { i += 30; int.push(phrase(customerText.match(INTENT_MEDIUM)![0])); }
  if (lead.source === 'referral') { i += 20; int.push('Came by referral'); }
  if (lead.source === 'inbound_call' || lead.source === 'voice') { i += 15; int.push('Called in themselves'); }
  if (viewed.length || upcoming.length) { i += 15; int.push('Took a next step (opened a proposal or booked a meeting)'); }
  if (INTENT_NEGATIVE.test(customerText)) { i -= 45; int.push(`Said “${customerText.match(INTENT_NEGATIVE)![0].toLowerCase()}”`); }
  if (!int.length) int.push('No buying signals in notes or messages yet');

  // 4. Budget indicators
  const bud: string[] = []; let b = 0;
  const statedBudget = Number(q.budget) || 0;
  const mentioned = moneyMentions(customerText);
  if (statedBudget > 0) { b += 60 + Math.min(30, Math.log10(statedBudget) * 6); bud.push(`Budget stated: ${money(statedBudget)}`); }
  if (mentioned.length) { b += statedBudget > 0 ? 20 : 45; bud.push(`Mentioned ${money(Math.max(...mentioned))} in conversation`); }
  if (/budget (?:is )?(?:approved|confirmed|set)/i.test(customerText)) { b += 20; bud.push('Budget approved'); }
  if (/no budget|tight budget|too expensive/i.test(customerText)) { b -= 30; bud.push('Raised budget concerns'); }
  if (!bud.length) bud.push('No budget information yet');

  // 5. Business requirements
  const req: string[] = []; let r = 0;
  const need = String(q.need || '').trim();
  if (need.length > 80) { r += 40; req.push('Detailed requirements recorded'); } else if (need) { r += 25; req.push(`Need: “${need.slice(0, 60)}”`); }
  if (q.authority === 'decision_maker' || SENIOR_TITLE.test(String(lead.title || ''))) { r += 30; req.push(`Decision maker${lead.title ? ` (${lead.title})` : ''}`); }
  else if (lead.title) { r += 10; req.push(`Role: ${lead.title}`); }
  if (lead.company) { r += 10; req.push(`Company: ${lead.company}`); }
  if (q.timeline && URGENT_TIMELINE.test(String(q.timeline))) { r += 20; req.push(`Urgent timeline (${q.timeline})`); }
  else if (q.timeline) req.push(`Timeline: ${q.timeline}`);
  if (!need) req.push('Requirements not captured yet');

  // 6. Response frequency
  const rsp: string[] = []; let f = 0;
  const recentInbound = inbound.filter((m) => (ts(m.at) ?? 0) > now - 14 * DAY).length;
  if (recentInbound) { f += Math.min(60, recentInbound * 20); rsp.push(`${recentInbound} message${recentInbound === 1 ? '' : 's'} from them in 14 days`); }
  // How quickly they answer us: gaps between our message and their next reply.
  const gaps: number[] = [];
  for (const o of outbound) { const t = ts(o.at)!; const reply = inbound.find((m) => (ts(m.at) ?? 0) > t); if (reply) gaps.push((ts(reply.at)! - t) / HOUR); }
  if (gaps.length) {
    const avg = gaps.reduce((x, y) => x + y, 0) / gaps.length;
    f += avg < 4 ? 40 : avg < 24 ? 25 : 10;
    rsp.push(`Replies in about ${avg < 1 ? 'under an hour' : avg < 24 ? `${Math.round(avg)} h` : `${Math.round(avg / 24)} days`}`);
  } else if (outbound.length && !inbound.some((m) => (ts(m.at) ?? 0) > (ts(outbound[0].at) ?? 0))) { rsp.push('Hasn’t replied to your messages yet'); }
  if (!rsp.length) rsp.push('Not enough messages to measure');

  // 7. Potential deal value
  const dealVal = s.deals.reduce((x, d) => x + (Number(d.value) || 0), 0);
  let potential: number | null = null, valueBasis = '';
  if (dealVal > 0) { potential = dealVal; valueBasis = 'Value of the deal created from this lead'; }
  else if (statedBudget > 0) { potential = statedBudget; valueBasis = 'Budget the lead stated'; }
  else if (mentioned.length) { potential = Math.max(...mentioned); valueBasis = 'Amount mentioned in conversation'; }
  else if (ctx.typicalDealValue) { potential = ctx.typicalDealValue; valueBasis = 'Your typical deal size (no amount from this lead yet)'; }
  else valueBasis = 'Unknown: no budget, amount or past deals to estimate from';
  const val: string[] = []; let v = 0;
  if (potential !== null) {
    const rel = ctx.typicalDealValue ? potential / ctx.typicalDealValue : 1;
    // Compared with the org's typical deal when there is one; otherwise on an absolute scale ($1k ≈ 66, $10k ≈ 78, $100k ≈ 90).
    v = valueBasis.startsWith('Your typical') ? 35 : ctx.typicalDealValue ? clamp(50 + Math.log2(Math.max(rel, 0.125)) * 20) : clamp(30 + Math.log10(Math.max(potential, 1)) * 12);
    val.push(`${money(potential)}: ${valueBasis.toLowerCase()}`);
    if (ctx.typicalDealValue && !valueBasis.startsWith('Your typical')) val.push(`${rel >= 1 ? `${rel.toFixed(1)}× above` : `${(1 / rel).toFixed(1)}× below`} your typical deal (${money(ctx.typicalDealValue)})`);
  } else val.push('No value to estimate yet');

  const factors: Factor[] = ([
    ['engagement', e, eng], ['communication', c, com], ['intent', i, int], ['budget', b, bud],
    ['requirements', r, req], ['responsiveness', f, rsp], ['value', v, val],
  ] as const).map(([id, score, evidence]) => ({ id, label: FACTOR_LABELS[id], weight: FACTOR_WEIGHTS[id], score: clamp(score), evidence: [...evidence] }));
  let score = clamp(factors.reduce((sum, x) => sum + x.score * x.weight, 0) / 100);
  if (status === 'unqualified') score = Math.min(score, 25);
  const classification: LeadClass = score >= HOT_MIN ? 'hot' : score >= WARM_MIN ? 'warm' : 'cold';

  // Why this class: strongest factors and the main gap.
  const ranked = [...factors].sort((a, b2) => b2.score * b2.weight - a.score * a.weight);
  const strengths = ranked.filter((x) => x.score >= 50).slice(0, 3).map((x) => x.evidence[0]);
  const gaps2 = ranked.filter((x) => x.score < 30).slice(-2).map((x) => x.label.toLowerCase());
  const lead1 = classification === 'hot' ? 'Hot lead' : classification === 'warm' ? 'Warm lead' : 'Cold lead';
  const explanation = `${lead1} (${score}/100). ${strengths.length ? `${strengths.join('; ')}.` : 'Few positive signals so far.'}${gaps2.length ? ` Weak on ${gaps2.join(' and ')}.` : ''}${status === 'unqualified' ? ' Marked unqualified by your team.' : ''}`;

  // Closing probability: the org's win rate for this class once there is history; otherwise from the score.
  const cal = ctx.calibration[classification];
  const closingProbability = cal !== null ? clamp(cal * 100, 1, 99) : clamp(4 + score * 0.75, 2, 85);
  const probabilityBasis = cal !== null
    ? `Your win rate for ${classification} leads (${ctx.calibration.closedDeals} closed deals from leads)`
    : 'Estimated from the score (it will follow your own win rate once 10+ deals from leads have closed)';

  // Follow-up timing
  let when: string, dueAt: number | null, reason: string;
  if (awaitingReply) { when = 'Now'; dueAt = now; reason = `They messaged ${ago(lastInbound!, now)} and are waiting for a reply.`; }
  else if (classification === 'hot') { const fresh = now - created < DAY; when = fresh ? 'Within 1 hour' : 'Today'; dueAt = now + (fresh ? HOUR : 6 * HOUR); reason = fresh ? 'New hot leads go cold fast; first contact within an hour converts best.' : 'Strong signals; keep momentum today.'; }
  else if (classification === 'warm') { when = 'Within 2 days'; dueAt = now + 2 * DAY; reason = 'Interested but not ready: a timely, useful follow-up moves them forward.'; }
  else { when = 'In 2 weeks'; dueAt = now + 14 * DAY; reason = 'Low signals: add them to a nurture message rather than chasing now.'; }
  if (status === 'unqualified' || lead.isConverted) { when = lead.isConverted ? 'Handled in the pipeline' : 'No follow-up'; dueAt = null; reason = lead.isConverted ? 'Already converted to a deal.' : 'Marked unqualified.'; }
  const hours = inbound.map((m) => new Date(m.at).getHours());
  let bestTime: string | null = null;
  if (hours.length >= 2) {
    const counts = new Map<number, number>(); hours.forEach((h) => counts.set(h, (counts.get(h) || 0) + 1));
    const [h] = [...counts.entries()].sort((a, b2) => b2[1] - a[1])[0];
    bestTime = `They usually write around ${new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' })}`;
  }

  // Approach and objections
  const approach: string[] = [];
  const objections: string[] = [];
  if (statedBudget > 0 && i >= 50) approach.push('They have budget and intent: move straight to a tailored proposal.');
  else if (i >= 50) approach.push('Strong intent: offer a short call to confirm scope, then send a quote.');
  if (!statedBudget && !mentioned.length) { approach.push('Qualify budget early in the conversation.'); objections.push('Budget not confirmed: price may surprise them.'); }
  if (!(q.authority === 'decision_maker' || SENIOR_TITLE.test(String(lead.title || '')))) { approach.push('Ask who else is involved in the decision.'); objections.push('Needs sign-off from someone else.'); }
  if (lead.source === 'referral') approach.push('Mention the referral: it builds trust quickly.');
  if (q.timeline && URGENT_TIMELINE.test(String(q.timeline))) approach.push(`Lead with your earliest start date: they want it ${q.timeline}.`);
  if (q.timeline && LONG_TIMELINE.test(String(q.timeline))) objections.push(`Timing: they’re looking at ${q.timeline}; the deal may stall.`);
  if (COMPETITOR.test(customerText)) { objections.push('Comparing alternatives: expect price or feature comparisons.'); approach.push('Show what sets you apart, with a concrete example or case study.'); }
  if (INTENT_NEGATIVE.test(customerText)) objections.push(`They said “${customerText.match(INTENT_NEGATIVE)![0].toLowerCase()}”.`);
  if (outbound.length && !inbound.length) objections.push('Hasn’t replied yet: try a different channel.');
  if (viewed.length && !accepted.length) approach.push(`They opened proposal ${viewed[0].number || ''}: ask what questions they have.`.replace('  ', ' '));
  if (!approach.length) approach.push(classification === 'cold' ? 'Share something useful (a guide or offer) and check back later.' : 'Introduce yourself and ask about their goals and timeline.');
  if (!objections.length) objections.push('None visible yet.');

  // Next best action (qualified = hot or warm, not converted or unqualified)
  const qualified = !lead.isConverted && status !== 'unqualified' && classification !== 'cold';
  let nba: NextBestAction | null = null;
  if (!lead.isConverted && status !== 'unqualified') {
    const lastIn = inbound[inbound.length - 1];
    if (awaitingReply) nba = { type: 'reply', label: lastIn.channel === 'WHATSAPP' ? 'Reply on WhatsApp' : lastIn.channel === 'SMS' ? 'Reply by SMS' : 'Reply to their message', detail: `“${lastIn.text.slice(0, 90)}”`, view: lastIn.channel === 'WHATSAPP' || lastIn.channel === 'SMS' ? 'voice_messages' : 'messages' };
    else if (classification !== 'cold' && upcoming.length && (ts(upcoming[0].start)! - now) < 3 * DAY) nba = { type: 'schedule', label: `Prepare for “${upcoming[0].title}”`, detail: `${new Date(upcoming[0].start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}: review their needs and bring a proposal outline.`, view: 'calendar' };
    else if (viewed.length && !accepted.length) nba = { type: 'proposal', label: `Follow up on proposal ${viewed[0].number || ''}`.trim(), detail: 'They opened it but haven’t signed.', view: 'proposals' };
    else if (classification === 'hot' && (statedBudget > 0 || dealVal > 0) && (status === 'qualified' || i >= 50)) nba = { type: 'convert', label: 'Convert to opportunity', detail: `Create a ${potential ? money(potential) + ' ' : ''}deal in your pipeline.` };
    else if (classification === 'hot' && !upcoming.length) nba = { type: 'schedule', label: 'Book a discovery call', detail: 'Strong signals and no meeting yet.', view: 'calendar' };
    else if (status === 'new') nba = { type: 'contact', label: classification === 'cold' ? 'Send an introduction' : 'Call or email today', detail: lead.phone ? `Phone ${lead.phone}` : `Email ${lead.email}`, view: 'leads' };
    else if (classification === 'warm') nba = { type: !s.proposals.length && (statedBudget > 0 || i >= 50) ? 'proposal' : 'contact', label: !s.proposals.length && (statedBudget > 0 || i >= 50) ? 'Send a proposal' : 'Send a helpful follow-up', detail: !s.proposals.length && (statedBudget > 0 || i >= 50) ? 'They have shown enough intent for a quote.' : 'Share a case study or answer an open question.', view: !s.proposals.length && (statedBudget > 0 || i >= 50) ? 'proposals' : 'leads' };
    else nba = { type: 'nurture', label: 'Add to nurture', detail: 'Check back in two weeks with something useful.', view: 'leads' };
  }

  const lastTimes = [lastInbound, lastOutbound, ...s.activities.map((a) => ts(a.timestamp))].filter((x): x is number => x !== null);
  return {
    leadId: lead.id, name: lead.name || '', company: lead.company || '', email: lead.email || '', phone: lead.phone || '', source: lead.source || '',
    status, owner: lead.owner || '', createdAt: lead.createdAt || '', converted: !!lead.isConverted, convertedDealId: lead.convertedDealId,
    score, classification, explanation, factors,
    prediction: { closingProbability, probabilityBasis, potentialValue: potential, valueBasis, followUp: { when, dueAt: dueAt ? new Date(dueAt).toISOString() : null, reason, bestTime }, approach: approach.slice(0, 4), objections: objections.slice(0, 4) },
    qualified, nextBestAction: nba, lastActivityAt: lastTimes.length ? new Date(Math.max(...lastTimes)).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Gathering signals for an organization
// ---------------------------------------------------------------------------
const phoneKey = (v: unknown) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : ''; };
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

interface OrgData { leads: any[]; ctx: OrgContext; signalsFor: (lead: any) => Promise<LeadSignals> }

async function loadOrg(orgId: string): Promise<OrgData> {
  const st = await getDocStore();
  const repo = await CrmRepository.forOrg(orgId);
  const base = `organizations/${assertId(orgId)}`;
  const [leads, deals, proposals, meetings, inbound, outbound, inbox] = await Promise.all([
    repo.listLeads(), repo.listDeals(),
    st.list(`${base}/proposals`), st.list(`${base}/scheduled_meetings`),
    st.list(`${base}/inbound_messages`, { orderBy: 'at', direction: 'desc', limit: 1000 }),
    st.list(`${base}/outbound_messages`, { orderBy: 'at', direction: 'desc', limit: 1000 }),
    inboxMessagesByEmail(orgId).catch(() => new Map()),
  ]);

  const values = deals.map((d: any) => Number(d.value) || 0).filter((x: number) => x > 0);
  // Calibration: deals that came from leads and have closed, grouped by the lead's stored class at conversion.
  const byLead = new Map(leads.map((l: any) => [l.id, l]));
  const closed = deals.filter((d: any) => d.originLeadId && (d.stage === 'won' || d.stage === 'lost'));
  const rate = (cls: LeadClass) => {
    const rows = closed.filter((d: any) => (byLead.get(d.originLeadId)?.aiClass || null) === cls);
    return rows.length >= 3 ? rows.filter((d: any) => d.stage === 'won').length / rows.length : null;
  };
  const enough = closed.length >= 10;
  const ctx: OrgContext = { typicalDealValue: median(values), calibration: { hot: enough ? rate('hot') : null, warm: enough ? rate('warm') : null, cold: enough ? rate('cold') : null, closedDeals: closed.length } };

  const phoneMsgs = new Map<string, Message[]>();
  for (const m of inbound) { const k = phoneKey(m.from); if (k) phoneMsgs.set(k, [...(phoneMsgs.get(k) || []), { at: m.at, fromCustomer: true, text: String(m.body || '').slice(0, 1000), channel: String(m.channel || 'SMS').toUpperCase() }]); }
  for (const m of outbound) { const k = phoneKey(m.to); if (k) phoneMsgs.set(k, [...(phoneMsgs.get(k) || []), { at: m.at, fromCustomer: false, text: String(m.body || '').slice(0, 1000), channel: String(m.channel || 'SMS').toUpperCase() }]); }

  const signalsFor = async (lead: any): Promise<LeadSignals> => {
    const email = String(lead.email || '').toLowerCase();
    const pk = phoneKey(lead.phone);
    const messages = [...(inbox.get(email) || []), ...(pk ? phoneMsgs.get(pk) || [] : [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const [activities, tasks] = await Promise.all([repo.listLeadActivities(lead.id).catch(() => []), repo.listLeadTasks(lead.id).catch(() => [])]);
    return {
      messages, activities, tasks,
      proposals: proposals.filter((p: any) => email && String(p.client?.email || '').toLowerCase() === email)
        .map((p: any) => ({ number: p.number, status: p.status, sentAt: p.sentAt, viewedAt: p.viewedAt })),
      meetings: meetings.filter((m: any) => email && (m.guests || []).some((g: string) => String(g).toLowerCase() === email))
        .flatMap((m: any) => (m.occurrences?.length ? m.occurrences : [{ startTime: m.startTime }]).map((o: any) => ({ title: m.title, start: o.startTime }))),
      deals: deals.filter((d: any) => d.originLeadId === lead.id || (lead.convertedDealId && d.id === lead.convertedDealId)).map((d: any) => ({ stage: d.stage, value: Number(d.value) || 0 })),
    };
  };
  return { leads, ctx, signalsFor };
}

/** Saves the class/score on the lead when it changed (so lists and other screens agree) and logs the change. */
async function persist(orgId: string, lead: any, a: LeadAnalysis) {
  if (lead.aiScore === a.score && lead.aiClass === a.classification) return;
  const repo = await CrmRepository.forOrg(orgId);
  const at = new Date().toISOString();
  await repo.updateLead(lead.id, { aiScore: a.score, aiClass: a.classification, aiAnalyzedAt: at });
  if (lead.aiClass !== a.classification) {
    await repo.addLeadActivity(lead.id, {
      type: 'ai_classified', title: `Lead intelligence: ${a.classification.toUpperCase()} (${a.score}/100)`,
      description: lead.aiClass ? `Changed from ${String(lead.aiClass).toUpperCase()}. ${a.explanation}` : a.explanation, actor: 'Lead Intelligence',
    });
  }
}

export interface IntelligenceSummary { hot: number; warm: number; cold: number; total: number; qualified: number; pipelinePotential: number; avgProbability: number | null; calibrated: boolean; closedDeals: number; typicalDealValue: number | null }

/** Analyzes every lead in the organization (converted ones only when asked). */
export async function analyzeOrganization(orgId: string, opts: { includeConverted?: boolean; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const org = await loadOrg(orgId);
  const rows = org.leads.filter((l: any) => opts.includeConverted || !l.isConverted);
  const analyses: LeadAnalysis[] = [];
  for (const lead of rows) {
    const a = analyzeLead(lead, await org.signalsFor(lead), org.ctx, now);
    analyses.push(a);
    await persist(orgId, lead, a).catch(() => undefined);
  }
  analyses.sort((x, y) => y.score - x.score);
  const open = analyses.filter((a) => !a.converted);
  const summary: IntelligenceSummary = {
    hot: open.filter((a) => a.classification === 'hot').length, warm: open.filter((a) => a.classification === 'warm').length, cold: open.filter((a) => a.classification === 'cold').length,
    total: open.length, qualified: open.filter((a) => a.qualified).length,
    pipelinePotential: Math.round(open.filter((a) => a.qualified).reduce((s, a) => s + (a.prediction.potentialValue || 0) * a.prediction.closingProbability / 100, 0)),
    avgProbability: open.length ? Math.round(open.reduce((s, a) => s + a.prediction.closingProbability, 0) / open.length) : null,
    calibrated: org.ctx.calibration.hot !== null || org.ctx.calibration.warm !== null, closedDeals: org.ctx.calibration.closedDeals, typicalDealValue: org.ctx.typicalDealValue,
  };
  return { summary, leads: analyses };
}

/** Analyzes one lead (null if it isn't in this organization). */
export async function analyzeOne(orgId: string, leadId: string, now: number = Date.now()) {
  const org = await loadOrg(orgId);
  const lead = org.leads.find((l: any) => l.id === assertId(leadId));
  if (!lead) return null;
  const signals = await org.signalsFor(lead);
  const a = analyzeLead(lead, signals, org.ctx, now);
  await persist(orgId, lead, a).catch(() => undefined);
  return { analysis: a, signals, lead };
}

/** Called when a lead arrives (form, capture, assistant): classify it straight away. Never throws. */
export async function refreshLeadIntelligence(orgId: string, leadId: string) {
  try { return (await analyzeOne(orgId, leadId))?.analysis ?? null; } catch (err) { console.warn('[lead-intelligence] analysis failed:', (err as any)?.code || (err as any)?.name || 'error'); return null; }
}
