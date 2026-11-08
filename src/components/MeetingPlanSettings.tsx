/**
 * Settings → Organization: the organization's meeting plan.
 * Owners and Admins can change it (PUT /api/meetings/plan, enforced on the server); everyone else sees it.
 * A meeting keeps the plan it started with; the new plan applies to meetings started afterwards.
 */
import React, { useState } from 'react';
import { Check, Clock, Users, Video } from 'lucide-react';
import { useMeetingSession } from '../context/MeetingSessionContext';
import { MEETING_PLAN_TIERS, MEETING_PLANS, type MeetingPlanTier } from '../lib/meetingPlans';

export default function MeetingPlanSettings() {
  const { currentPlanTier, canChangePlan, changeMeetingPlan, planSource, activeMeeting } = useMeetingSession();
  const [busy, setBusy] = useState<MeetingPlanTier | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const choose = async (tier: MeetingPlanTier) => {
    if (tier === currentPlanTier || busy) return;
    setBusy(tier); setMessage(null);
    const r = await changeMeetingPlan(tier);
    setMessage({ ok: r.success, text: r.success && activeMeeting?.status === 'active' ? `${r.message} The meeting in progress keeps its current limits.` : r.message });
    setBusy(null);
  };

  return (
    <section className="rounded-xl border border-white/5 bg-neutral-900/30 p-5 space-y-4" aria-labelledby="meeting-plan-heading">
      <div>
        <h3 id="meeting-plan-heading" className="text-base font-semibold text-white flex items-center gap-2">
          <Video className="h-4 w-4 text-indigo-400" /> Meeting plan
        </h3>
        <p className="text-sm text-neutral-400">
          Sets how many people can join this organization's video meetings and how long they can run.
          {canChangePlan ? ' Changes apply to meetings started afterwards.' : ' Only an owner or admin can change it.'}
        </p>
      </div>

      {planSource === 'default' && (
        <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Couldn't load your organization's plan, so meetings use Standard limits for now.
        </p>
      )}
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm border ${message.ok ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
          {message.text}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Meeting plan">
        {MEETING_PLAN_TIERS.map((tier) => {
          const p = MEETING_PLANS[tier];
          const selected = tier === currentPlanTier;
          return (
            <button
              key={tier}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!canChangePlan || !!busy}
              onClick={() => choose(tier)}
              className={`text-left rounded-xl border p-4 space-y-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                selected ? 'border-indigo-500 bg-indigo-600/15' : 'border-white/10 bg-neutral-950/40'
              } ${canChangePlan && !selected ? 'hover:border-indigo-500/50 cursor-pointer' : 'cursor-default'} disabled:opacity-100`}
            >
              <span className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">{p.label}</span>
                {selected && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-300"><Check className="h-3.5 w-3.5" /> Current</span>}
                {busy === tier && <span className="text-[11px] text-neutral-400">Saving…</span>}
              </span>
              <span className="flex items-center gap-1.5 text-sm text-neutral-200"><Users className="h-3.5 w-3.5 text-neutral-400" /> Up to {p.maxParticipants} people</span>
              <span className="flex items-center gap-1.5 text-sm text-neutral-200"><Clock className="h-3.5 w-3.5 text-neutral-400" /> {p.maxDurationMinutes ? `${p.maxDurationMinutes}-minute meetings` : 'No time limit'}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-neutral-500">Billing for plans isn't connected yet; when it is, the plan will follow your subscription.</p>
    </section>
  );
}
