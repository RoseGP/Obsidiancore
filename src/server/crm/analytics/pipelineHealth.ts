/**
 * Pipeline health: how deals move from stage to stage, how long they usually stay, which ones are stuck,
 * and how each lead source converts. Pure over the organization's deals, leads and activity feed.
 *
 *   Stage conversion   of the deals that reached a stage and have since left it (moved on, won or lost),
 *                      the share that went further. Deals still sitting in the stage aren't counted yet.
 *   Typical days       median time in the stage over stays that ended (default when fewer than 3 stays).
 *   Stale              open deals in their stage more than 2× the typical time (same rule as the forecast).
 *   Lead sources       leads per source, the share converted to a deal, and won deals/value from them.
 */
import { sourceLabel } from '../../../lib/dashboardMetrics';
import { OPEN_STAGES, STAGE_LABELS, dealValue, furthestStageReached, isOpen, normalizeDeals, plural, round, type OpenStage } from './common';
import { AGE_THRESHOLD, buildOrgModel, forecastDeal } from './forecast';

export interface StageHealth {
  stage: OpenStage; label: string; open: number; openValue: number;
  movedOn: number; advanced: number; conversion: number | null;
  typicalDays: number; typicalSource: 'history' | 'default'; samples: number;
}
export interface StaleDeal { id: string; name: string; client: string; stage: string; daysInStage: number; typicalDays: number; ratio: number; value: number | null }
export interface SourceRow { source: string; label: string; leads: number; converted: number; conversion: number | null; wonDeals: number; wonValue: number; smallSample: boolean }
export interface PipelineHealth { stages: StageHealth[]; stale: StaleDeal[]; sources: SourceRow[]; notes: string[] }

export const MIN_SOURCE_SAMPLE = 5;

export function buildPipelineHealth(allDeals: any[], leads: any[], feed: any[], now: number): PipelineHealth {
  const deals = normalizeDeals(allDeals);
  const model = buildOrgModel(deals, feed);
  const stages: StageHealth[] = OPEN_STAGES.map((s, i) => {
    let movedOn = 0, advanced = 0;
    for (const d of deals) {
      const f = furthestStageReached(d, model.histories.get(d.id)!);
      if (f === null || f < i || d.stage === s) continue; // never reached it, unknown, or still in it
      movedOn++;
      if (d.stage === 'won' || f > i) advanced++;
    }
    const open = deals.filter((d) => isOpen(d) && d.stage === s);
    const m = model.stages[s];
    return {
      stage: s, label: STAGE_LABELS[s], open: open.length, openValue: Math.round(open.reduce((sum, d) => sum + (dealValue(d) ?? 0), 0)),
      movedOn, advanced, conversion: movedOn ? round(advanced / movedOn, 3) : null,
      typicalDays: Math.round(m.typicalDays), typicalSource: m.typicalSource, samples: m.samples,
    };
  });

  const stale: StaleDeal[] = deals.filter(isOpen).map((d) => forecastDeal(d, model, now)).filter((f) => f.age.penalized)
    .map((f) => ({ id: f.id, name: f.name, client: f.client, stage: f.stageLabel, daysInStage: f.age.daysInStage ?? 0, typicalDays: f.age.typicalDays, ratio: f.age.ratio ?? 0, value: f.value }))
    .sort((a, b) => b.ratio - a.ratio);

  // Lead sources: converted share and what the converted leads became.
  const bySource = new Map<string, any[]>();
  const live = leads.filter((l) => l && !l.deletedAt && !l.archived);
  for (const l of live) { const k = String(l.source || '').trim() || 'unknown'; bySource.set(k, [...(bySource.get(k) || []), l]); }
  const dealsByLead = new Map<string, any[]>();
  for (const d of deals) { const k = d.originLeadId || d.leadId; if (k) dealsByLead.set(k, [...(dealsByLead.get(k) || []), d]); }
  const dealById = new Map(deals.map((d) => [d.id, d]));
  const sources: SourceRow[] = [...bySource.entries()].map(([source, rows]) => {
    const converted = rows.filter((l) => l.isConverted || l.status === 'converted');
    const won = new Map<string, any>();
    for (const l of rows) {
      for (const d of dealsByLead.get(l.id) || []) if (d.stage === 'won') won.set(d.id, d);
      const cd = l.convertedDealId ? dealById.get(l.convertedDealId) : null;
      if (cd && cd.stage === 'won') won.set(cd.id, cd);
    }
    return {
      source, label: source === 'unknown' ? 'Not recorded' : sourceLabel(source), leads: rows.length, converted: converted.length,
      conversion: rows.length ? round(converted.length / rows.length, 3) : null, wonDeals: won.size,
      wonValue: Math.round([...won.values()].reduce((s, d) => s + (dealValue(d) ?? 0), 0)), smallSample: rows.length < MIN_SOURCE_SAMPLE,
    };
  }).sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));

  const notes: string[] = [];
  if (!deals.length) notes.push('No deals yet: stage conversion and time in stage appear once deals move through the pipeline.');
  const defaults = stages.filter((s) => s.typicalSource === 'default').map((s) => s.label);
  if (defaults.length && deals.length) notes.push(`Typical time in ${defaults.join(', ')} uses a default until 3 deals have left that stage.`);
  if (model.unknownLost) notes.push(`${plural(model.unknownLost, 'lost deal')} without stage history ${model.unknownLost === 1 ? 'is' : 'are'} left out of stage conversion.`);
  if (sources.some((s) => s.smallSample)) notes.push(`Sources with fewer than ${MIN_SOURCE_SAMPLE} leads are marked as a small sample: their rate can swing a lot.`);
  if (stale.length) notes.push(`${plural(stale.length, 'deal')} ${stale.length === 1 ? 'has' : 'have'} been in ${stale.length === 1 ? 'its' : 'their'} stage more than ${AGE_THRESHOLD}× the typical time.`);
  return { stages, stale, sources, notes };
}
