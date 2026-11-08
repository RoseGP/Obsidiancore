/**
 * Meeting plans side by side, with the organization's current plan and a way to request a change.
 * Used in the meeting (PlanUpgradeDialog) and in Settings → Organization (SubscriptionSettings).
 * Plan values come from the server (GET /api/meetings/subscription); nothing here is hardcoded.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpCircle, Check, Clock, Minus, Users, X } from 'lucide-react';
import { useMeetingSession, type PlanNotice } from '../../context/MeetingSessionContext';
import { FEATURE_KEYS, FEATURE_LABELS, MEETING_PLAN_TIERS, formatMinutes, tierRank, type MeetingPlanTier } from '../../lib/meetingPlans';

export function PlanComparison({ highlight, onDone }: { highlight?: MeetingPlanTier; onDone?: (message: string) => void }) {
  const { subscription, requestPlanChange, cancelPlanRequest } = useMeetingSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!subscription) {
    return <p className="text-sm text-neutral-400">Plan details couldn't be loaded. Check your connection and try again.</p>;
  }
  const { plans, tier: current, canRequestChange, pendingRequest } = subscription;

  const request = async (tier: MeetingPlanTier) => {
    setBusy(tier); setMessage(null);
    const r = await requestPlanChange(tier);
    setMessage({ ok: r.success, text: r.message }); setBusy(null);
    if (r.success) onDone?.(r.message);
  };
  const cancel = async () => {
    setBusy('cancel');
    const r = await cancelPlanRequest();
    setMessage({ ok: r.success, text: r.message }); setBusy(null);
  };

  return (
    <div className="space-y-3">
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`rounded-lg px-3 py-2 text-sm border ${message.ok ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>{message.text}</p>
      )}
      {pendingRequest && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <span>Requested: {plans[pendingRequest.requestedTier]?.label ?? pendingRequest.requestedTier} ({new Date(pendingRequest.createdAt).toLocaleDateString()}). Waiting for your account manager.</span>
          {canRequestChange && <button type="button" onClick={cancel} disabled={!!busy} className="text-xs font-semibold underline underline-offset-2 cursor-pointer disabled:opacity-50">Cancel request</button>}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3" role="list" aria-label="Meeting plans">
        {MEETING_PLAN_TIERS.map((t) => {
          const p = plans[t];
          const isCurrent = t === current;
          const isHighlight = t === highlight && !isCurrent;
          const up = tierRank(t) > tierRank(current);
          return (
            <div role="listitem" key={t} className={`rounded-xl border p-4 flex flex-col gap-3 min-w-0 ${isCurrent ? 'border-indigo-500 bg-indigo-600/15' : isHighlight ? 'border-amber-400/70 bg-amber-500/5' : 'border-white/10 bg-neutral-950/40'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-semibold text-white">{p.label}</span>
                {isCurrent ? <span className="text-[11px] font-semibold text-indigo-300">Your plan</span> : isHighlight ? <span className="text-[11px] font-semibold text-amber-300">Recommended</span> : null}
              </div>
              <div className="space-y-1 text-sm text-neutral-200">
                <p className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-neutral-400" /> Up to {p.limits.maxParticipants} people</p>
                <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-neutral-400" /> Meetings up to {formatMinutes(p.limits.maxDurationMinutes)}</p>
                {isCurrent && subscription.plan.custom && (
                  <p className="text-xs text-indigo-200">Your agreement: {subscription.plan.limits.maxParticipants} people, {formatMinutes(subscription.plan.limits.maxDurationMinutes)}</p>
                )}
              </div>
              <ul className="space-y-1 text-[13px]">
                {FEATURE_KEYS.map((k) => (
                  <li key={k} className={`flex items-center gap-1.5 ${p.features[k] ? 'text-neutral-200' : 'text-neutral-500'}`}>
                    {p.features[k] ? <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-label="Included" /> : <Minus className="h-3.5 w-3.5 shrink-0" aria-label="Not included" />}
                    {FEATURE_LABELS[k]}
                  </li>
                ))}
              </ul>
              {!isCurrent && canRequestChange && (
                <button
                  type="button"
                  disabled={!!busy || !!pendingRequest}
                  onClick={() => request(t)}
                  className={`mt-auto min-h-10 rounded-lg px-3 text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${up ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200'}`}
                >
                  {busy === t ? 'Sending…' : up ? `Request ${p.label}` : `Request change to ${p.label}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-neutral-500">
        {canRequestChange
          ? `${subscription.billing.message} Upgrades also extend a meeting that's already running; downgrades apply to the next meeting.`
          : 'Only an owner or admin of your organization can change the plan. Ask them to request an upgrade.'}
      </p>
    </div>
  );
}

/** In-meeting dialog: what limit was hit, and the plans. */
export function PlanUpgradeDialog({ open, notice, onClose }: { open: boolean; notice?: PlanNotice | null; onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => closeRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="obsidian w-full sm:max-w-4xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[var(--obsidian-1)] border border-white/15 shadow-2xl p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-600/20 text-indigo-300"><ArrowUpCircle className="h-5 w-5" /></div>
            <div>
              <h3 id={titleId} className="text-base font-bold text-white">{notice ? 'Your plan limit was reached' : 'Meeting plans'}</h3>
              {notice && <p className="text-sm text-neutral-300 mt-0.5">{notice.message}{notice.kind === 'feature' && notice.upgradeLabel ? ` ${notice.upgradeLabel} includes it.` : ''}</p>}
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"><X className="h-4 w-4" /></button>
        </div>
        <PlanComparison highlight={notice?.upgradeTo} />
      </div>
    </div>
  );
}
