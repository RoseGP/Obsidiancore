/**
 * Profile audit for one location, in plain language. Two clearly separate groups:
 *   Profile quality  completeness and engagement checks on the data Google returns (these make up the score)
 *   Listing status   what Google itself reports about the listing (verification, pending edits, duplicates…)
 * Every finding shows its evidence. "Not reported by Google" means the API didn't return that field; it is
 * never counted as a pass or a failure. This is not a security audit of the Google account.
 */
import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, HelpCircle, ExternalLink, ChevronDown } from 'lucide-react';
import type { AuditFinding, LocationItem } from '../types';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

const STATE = {
  pass: { icon: CheckCircle2, cls: 'text-emerald-600', label: 'OK', badge: 'success' as const },
  fail: { icon: AlertTriangle, cls: 'text-amber-600', label: 'Needs attention', badge: 'warning' as const },
  unknown: { icon: HelpCircle, cls: 'text-slate-400', label: 'Not reported by Google', badge: 'neutral' as const },
};

function Finding({ f, onAction, mapsUri }: { f: AuditFinding; onAction: (f: AuditFinding) => void; mapsUri?: string }) {
  const s = STATE[f.state];
  const Icon = s.icon;
  return (
    <li className="flex gap-3 py-3">
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${s.cls}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{f.label}</span>
          <Badge variant={s.badge} size="xs">{s.label}</Badge>
          {f.state === 'fail' && f.severity === 'high' && <Badge variant="danger" size="xs">High impact</Badge>}
        </div>
        <p className="text-xs text-slate-600"><span className="font-medium text-slate-700">Evidence: </span>{f.evidence}</p>
        {f.state === 'fail' && f.fix && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <p className="text-xs text-slate-600"><span className="font-medium text-slate-700">What to do: </span>{f.fix.description}</p>
            {f.fix.actionType === 'open_in_google'
              ? <a className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline" href={mapsUri || 'https://business.google.com/'} target="_blank" rel="noreferrer noopener">{f.fix.actionLabel} <ExternalLink className="h-3 w-3" /></a>
              : <Button size="xs" variant="outline" onClick={() => onAction(f)}>{f.fix.actionLabel}</Button>}
          </div>
        )}
      </div>
    </li>
  );
}

export function ProfileAuditPanel({ location, onAction }: { location: LocationItem; onAction: (f: AuditFinding) => void }) {
  const findings = location.auditFindings || [];
  const [showPassed, setShowPassed] = useState(false);
  if (!findings.length) return <p className="text-xs text-slate-500">Sync from Google to run the audit.</p>;
  const profile = findings.filter((f) => f.section === 'profile');
  const listing = findings.filter((f) => f.section === 'listing');
  const order = (a: AuditFinding, b: AuditFinding) => (a.state === 'fail' ? 0 : a.state === 'unknown' ? 1 : 2) - (b.state === 'fail' ? 0 : b.state === 'unknown' ? 1 : 2);
  const visible = (list: AuditFinding[]) => [...list].sort(order).filter((f) => showPassed || f.state !== 'pass');

  const group = (title: string, subtitle: string, list: AuditFinding[]) => {
    const fails = list.filter((f) => f.state === 'fail').length;
    const shown = visible(list);
    return (
      <section aria-label={title} className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
          <Badge variant={fails ? 'warning' : 'success'} size="sm">{fails ? `${fails} to review` : 'All clear'}</Badge>
        </div>
        {shown.length ? <ul className="divide-y divide-slate-100">{shown.map((f) => <Finding key={f.id} f={f} onAction={onAction} mapsUri={location.mapsUri} />)}</ul>
          : <p className="pt-3 text-xs text-slate-500">Nothing needs attention here.</p>}
      </section>
    );
  };

  return (
    <div className="space-y-4" id="localpilot-profile-audit">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 max-w-2xl">
          Checks run on the data Google's Business Profile APIs return for this location. The score ({location.visibilityScore}/100) covers profile quality only.
          This isn't a Google ranking score and isn't a security audit of your Google account (see <span className="font-medium">Security → Access review</span> for who can manage the listing).
        </p>
        <button type="button" onClick={() => setShowPassed(!showPassed)} aria-expanded={showPassed}
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900">
          {showPassed ? 'Hide passed checks' : 'Show passed checks'} <ChevronDown className={`h-3.5 w-3.5 transition ${showPassed ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {group('Profile quality', 'Completeness and engagement (scored)', profile)}
      {group('Listing status', 'What Google reports about this listing (not scored)', listing)}
    </div>
  );
}
