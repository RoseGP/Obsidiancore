import React from 'react';
import { 
  ShieldCheck, CheckCircle2, AlertTriangle, 
  KeyRound, Users, History, Lock, RefreshCw, 
  UserX, ShieldAlert, ArrowRight, Check
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { SecurityActivity, SecurityRecommendation, LocalPilotRoute } from '../types';

export interface SecurityViewProps {
  activities: SecurityActivity[];
  recommendations: SecurityRecommendation[];
  onNavigate: (route: LocalPilotRoute) => void;
  onRefreshOAuth: () => void;
}

export const SecurityView: React.FC<SecurityViewProps> = ({
  activities,
  recommendations,
  onNavigate,
  onRefreshOAuth
}) => {
  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-security-view">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Business Profile Security
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Protect your business presence, manage Google OAuth authorizations, and monitor access logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefreshOAuth}
            leftIcon={<RefreshCw className="h-3.5 w-3.5 text-slate-500" />}
          >
            Re-verify Google OAuth
          </Button>
        </div>
      </div>

      {/* Hero Card: Security Score + Status Grid */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
              Security Score
            </span>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-extrabold text-slate-900 tracking-tight">
                96 <span className="text-lg font-normal text-slate-400">/ 100</span>
              </span>
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                Excellent
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              No active unauthorized changes or critical access threats detected.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-500 text-[10px] uppercase font-bold block">Google Connection</span>
              <span className="font-semibold text-emerald-700 mt-0.5 flex items-center gap-1">
                <Check className="h-3 w-3" /> Connected
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-500 text-[10px] uppercase font-bold block">OAuth Status</span>
              <span className="font-semibold text-emerald-700 mt-0.5 flex items-center gap-1">
                <Check className="h-3 w-3" /> Healthy (AES-256)
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-500 text-[10px] uppercase font-bold block">Team Access</span>
              <span className="font-semibold text-slate-900 mt-0.5 block">
                12 members
              </span>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-slate-500 text-[10px] uppercase font-bold block">Recent Changes</span>
              <span className="font-semibold text-slate-900 mt-0.5 block">
                2 this week
              </span>
            </div>
          </div>
        </div>

        {/* Security Recommendations */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Security Recommendations
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recommendations.map((rec) => (
              <div
                key={rec.id}
                className="p-4 rounded-xl border border-amber-200 bg-amber-50/30 flex items-start justify-between gap-3 text-xs"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-slate-900">
                      {rec.title}
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                      {rec.description}
                    </p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onNavigate('settings/team')}
                  className="shrink-0 bg-white"
                >
                  {rec.actionLabel}
                </Button>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Recent Security Activity Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 px-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 tracking-tight">
              Recent Security & Profile Audit Activity
            </h3>
            <p className="text-xs text-slate-500">
              Immutable audit log of configuration updates, logins, and API sync events.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3">Timestamp</th>
                <th className="px-4 py-3">Event Description</th>
                <th className="px-4 py-3">Actor / Initiator</th>
                <th className="px-4 py-3">Location Scope</th>
                <th className="px-4 py-3">Security Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activities.map((act) => (
                <tr key={act.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-5 py-3.5 whitespace-nowrap">
                    <div className="font-semibold text-slate-900">{act.date}</div>
                    <div className="text-[10px] text-slate-400">{act.time}</div>
                  </td>

                  <td className="px-4 py-3.5">
                    <div className="font-semibold text-slate-900">{act.event}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{act.details}</div>
                  </td>

                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="font-medium text-slate-900">{act.actor}</div>
                    <div className="text-[10px] text-slate-500">{act.actorRole}</div>
                  </td>

                  <td className="px-4 py-3.5 whitespace-nowrap text-slate-500">
                    {act.locationName}
                  </td>

                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <Badge
                      variant={
                        act.status === 'verified' ? 'success' :
                        act.status === 'warning' ? 'danger' : 'neutral'
                      }
                      size="sm"
                    >
                      {act.status === 'verified' ? 'Verified' : 'Blocked Threat'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};

export default SecurityView;
