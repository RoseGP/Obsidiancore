import React from 'react';
import { useOptionalLocalSeo } from '../live/localSeoClient';
import { Sparkles, ArrowRight, MessageSquare, Plus, ImageIcon, Megaphone } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { LocalPilotRoute } from '../types';

export interface AiRecommendationsCardProps {
  onNavigate: (route: LocalPilotRoute) => void;
  onOpenAiAssistant: () => void;
}

export const AiRecommendationsCard: React.FC<AiRecommendationsCardProps> = ({
  onNavigate,
  onOpenAiAssistant
}) => {
  // Derived from real profile-health checks (no hardcoded counts).
  const seo = useOptionalLocalSeo();
  const ICON: Record<string, any> = { Reviews: MessageSquare, Services: Plus, Photos: ImageIcon, Content: Megaphone, Profile: Plus, Keywords: Megaphone };
  const recommendations = (seo?.opportunities ?? []).slice(0, 4).map((o) => ({
    id: o.id, title: o.title, impact: o.impact,
    impactVariant: (o.impact === 'High' ? 'danger' : 'warning') as 'danger' | 'warning',
    estimatedTime: o.estimatedTime, icon: ICON[o.category] ?? MessageSquare, btnText: o.actionLabel.split(' ')[0],
    route: (o.actionType === 'reply_reviews' ? 'reviews' : 'seo') as LocalPilotRoute,
  }));

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 tracking-tight">
                AI Recommendations
              </h3>
              <p className="text-[11px] text-slate-500">
                ✨ Your biggest opportunities
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenAiAssistant}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 transition cursor-pointer"
          >
            <span>Ask AI</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* List of 4 Opportunities */}
        <div className="space-y-2.5">
          {recommendations.map((rec) => {
            const Icon = rec.icon;
            return (
              <div
                key={rec.id}
                className="p-2.5 rounded-lg border border-slate-100 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-200 transition-all flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="h-7 w-7 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-600 shrink-0 mt-0.5">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">
                      {rec.title}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                      <span>Impact: <strong className="text-slate-800">{rec.impact}</strong></span>
                      <span>•</span>
                      <span>{rec.estimatedTime}</span>
                    </div>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onNavigate(rec.route)}
                  className="shrink-0 text-xs font-medium"
                >
                  {rec.btnText}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="pt-3 mt-3 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
        <span>{recommendations.length ? `Based on ${recommendations.length} profile check${recommendations.length === 1 ? '' : 's'}` : 'No open checks. Nice work.'}</span>
        <span className="text-[10px] text-slate-400"></span>
      </div>
    </div>
  );
};

export default AiRecommendationsCard;
