/**
 * Local SEO: profile checks and fixes for the selected Google Business Profile location.
 * Everything shown comes from the profile data synced from Google and this app's checks
 * (server: features/gbp/server/service.ts auditLocation). No rankings or scores are estimated.
 */
import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Layers, Star, Clock, ListChecks } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { SeoOpportunity, SeoAuditLog, LocalPilotRoute, LocationItem } from '../types';

export interface SeoViewProps {
  opportunities: SeoOpportunity[];
  auditLogs: SeoAuditLog[];
  selectedLocation?: LocationItem;
  onNavigate: (route: LocalPilotRoute, locId?: string) => void;
  onExecuteAction: (opp: SeoOpportunity) => void;
  /** Re-syncs from Google and re-runs the checks. */
  onRunAudit: () => Promise<unknown> | void;
}

const GROUP_ICONS: Record<string, React.ElementType> = {
  Completeness: Layers,
  'Categories & services': ListChecks,
  'Review engagement': Star,
  Maintenance: Clock,
};

export const SeoView: React.FC<SeoViewProps> = ({
  opportunities,
  auditLogs,
  selectedLocation,
  onNavigate,
  onExecuteAction,
  onRunAudit
}) => {
  const [isAuditing, setIsAuditing] = useState(false);
  const loc = selectedLocation;
  const checks = loc?.auditChecks || [];
  const locOpps = loc ? opportunities.filter((o) => !o.locationId || o.locationId === loc.id) : opportunities;

  const groups = Array.from(new Set(checks.map((c) => c.group))).map((group) => {
    const inGroup = checks.filter((c) => c.group === group);
    const passed = inGroup.filter((c) => c.passed).length;
    return { name: group, score: inGroup.length ? Math.round((passed / inGroup.length) * 100) : 0, passed, total: inGroup.length, icon: GROUP_ICONS[group] || Layers };
  });

  const handleAuditClick = async () => {
    setIsAuditing(true);
    try { await onRunAudit(); } finally { setIsAuditing(false); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200 text-left" id="localpilot-seo-view">

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1 border-b border-slate-100">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Local SEO</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Checks on your Google Business Profile and what to fix first. Search ranking tracking isn't available yet.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          isLoading={isAuditing}
          onClick={handleAuditClick}
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
        >
          Sync and re-check
        </Button>
      </div>

      {!loc ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center shadow-2xs">
          <p className="text-xs text-slate-500">Connect Google Business Profile and choose a location to see its checks.</p>
        </div>
      ) : (
        <>
          {/* Profile health + check groups */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Profile health · {loc.name}
                </span>
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-extrabold text-slate-900 tracking-tight">
                    {loc.visibilityScore} <span className="text-lg font-normal text-slate-400">/ 100</span>
                  </span>
                  <Badge variant={loc.status === 'Healthy' ? 'success' : loc.status === 'Critical' ? 'danger' : 'warning'} size="sm">
                    {loc.status}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Weighted share of the checks below that pass. It's this app's measure, not a Google score.
                </p>
              </div>
              <div className="flex items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/80 text-xs">
                <div>
                  <div className="font-bold text-slate-900">
                    {checks.filter((c) => c.passed).length} of {checks.length} checks passed
                  </div>
                  <div className="text-slate-500">
                    {loc.reviewsCount} review{loc.reviewsCount === 1 ? '' : 's'} synced · {loc.unansweredReviewsCount} without a reply
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4">Checks by area</h3>
              {groups.length === 0 ? (
                <p className="text-xs text-slate-500">Sync from Google to run the checks.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {groups.map((g) => {
                    const Icon = g.icon;
                    return (
                      <div key={g.name} className="p-4 rounded-xl border border-slate-100 bg-slate-50/60 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 font-semibold text-slate-900">
                            <Icon className="h-3.5 w-3.5 text-blue-600" />
                            <span>{g.name}</span>
                          </div>
                          <span className="font-bold text-slate-900">{g.passed}/{g.total}</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div className={`h-1.5 rounded-full ${g.score === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${g.score}%` }} />
                        </div>
                        <ul className="space-y-1 text-[11px]">
                          {checks.filter((c) => c.group === g.name).map((c) => (
                            <li key={c.id} className="flex items-start gap-1.5">
                              {c.passed
                                ? <CheckCircle2 className="h-3 w-3 mt-0.5 text-emerald-600 shrink-0" />
                                : <AlertTriangle className="h-3 w-3 mt-0.5 text-amber-500 shrink-0" />}
                              <span className={c.passed ? 'text-slate-500' : 'text-slate-900'}>{c.label}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Fixes */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 tracking-tight">What to fix</h3>
              <p className="text-xs text-slate-500">From the checks that didn't pass.</p>
            </div>
            {locOpps.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-6 text-center shadow-2xs">
                <p className="text-xs text-slate-500">Nothing to fix right now.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {locOpps.map((opp) => (
                  <div key={opp.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <h4 className="text-xs font-bold text-slate-900">{opp.title}</h4>
                          {opp.locationName && <span className="text-[11px] text-slate-500">Location: {opp.locationName}</span>}
                        </div>
                        <Badge variant={opp.impact === 'High' ? 'danger' : opp.impact === 'Medium' ? 'warning' : 'neutral'} size="sm">
                          {opp.impact} impact
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed my-2">{opp.description}</p>
                    </div>
                    <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500">Effort: <strong className="text-slate-800">{opp.effort}</strong></span>
                      <Button variant="primary" size="xs" onClick={() => onExecuteAction(opp)}>{opp.actionLabel}</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Check history (this session) */}
          {auditLogs.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="p-4 px-5 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900 tracking-tight">Re-checks</h3>
                <p className="text-xs text-slate-500">Results of the re-checks you ran in this session.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3">When</th>
                      <th className="px-4 py-3">Score</th>
                      <th className="px-4 py-3">Change</th>
                      <th className="px-4 py-3">Checks to fix</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-5 py-3 font-semibold text-slate-900">{log.date}</td>
                        <td className="px-4 py-3 font-bold text-slate-900">{log.score} / 100</td>
                        <td className="px-4 py-3 font-semibold">
                          <span className={log.scoreDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                            {log.scoreDelta >= 0 ? `+${log.scoreDelta}` : log.scoreDelta}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{log.issuesCount}</td>
                        <td className="px-4 py-3">
                          <Badge variant={log.status === 'Passed' ? 'success' : log.status === 'Action Needed' ? 'warning' : 'danger'} size="sm">
                            {log.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            See calls, website clicks and views from Google in <button type="button" className="text-blue-600 hover:underline cursor-pointer" onClick={() => onNavigate('analytics')}>Performance</button>.
          </p>
        </>
      )}
    </div>
  );
};

export default SeoView;
