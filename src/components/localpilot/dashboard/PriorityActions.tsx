import React from 'react';
import { MessageSquare, Clock, MapPin, ArrowRight, ShieldAlert, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { SeoOpportunity, LocalPilotRoute } from '../types';

export interface PriorityActionsProps {
  opportunities: SeoOpportunity[];
  onNavigate: (route: LocalPilotRoute, locId?: string) => void;
  onExecuteAction: (opp: SeoOpportunity) => void;
}

export const PriorityActions: React.FC<PriorityActionsProps> = ({
  opportunities,
  onNavigate,
  onExecuteAction
}) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 tracking-tight">
            Priority actions
          </h3>
          <p className="text-xs text-slate-500">
            High-impact tasks curated to immediately improve your Google Business Profile rankings.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate('seo')}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
        >
          <span>View all opportunities (7)</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {opportunities.slice(0, 4).map((opp) => {
          return (
            <div
              key={opp.id}
              className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 tracking-tight">
                        {opp.title}
                      </h4>
                      {opp.locationName && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500">
                          <MapPin className="h-3 w-3 text-slate-400" />
                          <span className="truncate">{opp.locationName}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <Badge
                    variant={opp.impact === 'High' ? 'danger' : opp.impact === 'Medium' ? 'warning' : 'neutral'}
                    size="sm"
                  >
                    {opp.impact} Impact
                  </Badge>
                </div>

                <p className="text-xs text-slate-500 leading-relaxed my-2">
                  {opp.description}
                </p>
              </div>

              <div className="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span>Effort: <strong className="text-slate-800">{opp.effort}</strong></span>
                  <span>•</span>
                  <span>Est. {opp.estimatedTime}</span>
                </div>

                <Button
                  variant="primary"
                  size="xs"
                  onClick={() => onExecuteAction(opp)}
                >
                  {opp.actionLabel}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PriorityActions;
