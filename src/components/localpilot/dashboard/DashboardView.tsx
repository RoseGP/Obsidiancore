import React from 'react';
import { useOptionalLocalSeo } from '../live/localSeoClient';
import { 
  TrendingUp, Star, MousePointerClick, 
  ShieldCheck, ArrowUpRight, Sparkles, AlertCircle 
} from 'lucide-react';
import { KpiCard } from '../ui/KpiCard';
import { VisibilityChart } from './VisibilityChart';
import { AiRecommendationsCard } from './AiRecommendationsCard';
import { SeoQuickHealthCheckCard } from './SeoQuickHealthCheckCard';
import { PriorityActions } from './PriorityActions';
import { LocationHealthTable } from './LocationHealthTable';
import { LocationItem, SeoOpportunity, LocalPilotRoute, TimeRange } from '../types';

export interface DashboardViewProps {
  selectedLocation: LocationItem;
  locations: LocationItem[];
  opportunities: SeoOpportunity[];
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  onNavigate: (route: LocalPilotRoute, locId?: string) => void;
  onOpenAiAssistant: () => void;
  onExecuteAction: (opp: SeoOpportunity) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  selectedLocation,
  locations,
  opportunities,
  timeRange,
  onTimeRangeChange,
  onNavigate,
  onOpenAiAssistant,
  onExecuteAction
}) => {
  const seo = useOptionalLocalSeo();
  const locStats = React.useMemo(() => {
    const rs = (seo?.reviews ?? []).filter((r) => !selectedLocation || r.locationId === selectedLocation.id);
    const answered = rs.filter((r) => r.status === 'answered').length;
    return { count: rs.length, unanswered: rs.length - answered, avg: rs.length ? rs.reduce((a, r) => a + r.rating, 0) / rs.length : 0, responseRate: rs.length ? Math.round((answered / rs.length) * 100) : 0 };
  }, [seo?.reviews, selectedLocation]);
  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-dashboard-view">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            {selectedLocation?.name || 'Local SEO overview'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {locations.length} managed location{locations.length === 1 ? '' : 's'} · data from your Google Business Profile
          </p>
        </div>
      </div>

      {/* TOP KPI ROW: all values computed from synced Google data */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Profile Health"
          value={selectedLocation ? `${selectedLocation.profileCompleteness}` : '—'}
          badgeText={!selectedLocation ? '' : selectedLocation.profileCompleteness >= 80 ? 'Good' : selectedLocation.profileCompleteness >= 50 ? 'Needs work' : 'Poor'}
          badgeVariant={!selectedLocation ? 'warning' : selectedLocation.profileCompleteness >= 80 ? 'success' : 'warning'}
          subtitle="This app’s diagnostic, not a Google score"
          delta={{ value: `${selectedLocation?.openIssuesCount ?? 0}`, isPositive: (selectedLocation?.openIssuesCount ?? 0) === 0, comparisonText: 'checks to fix' }}
          icon={<TrendingUp className="h-4 w-4 text-blue-600" />}
          actionText="View checks"
          onAction={() => onNavigate('seo')}
        />
        <KpiCard
          title="Reviews & Ratings"
          value={locStats.count ? `${locStats.avg.toFixed(1)} ★` : '—'}
          subtitle={`${locStats.count} synced review${locStats.count === 1 ? '' : 's'}`}
          delta={{ value: locStats.count ? `${locStats.responseRate}%` : '—', isPositive: locStats.responseRate >= 80, comparisonText: 'response rate' }}
          badgeText={locStats.unanswered ? `${locStats.unanswered} unanswered` : 'All answered'}
          badgeVariant={locStats.unanswered ? 'warning' : 'success'}
          icon={<Star className="h-4 w-4 text-amber-500 fill-amber-400" />}
          actionText="Respond now"
          onAction={() => onNavigate('reviews')}
        />
        <KpiCard
          title="Customer Actions"
          value="See card"
          subtitle="Calls, website clicks and directions from Google"
          delta={{ value: 'Performance', isPositive: true, comparisonText: 'below' }}
          icon={<MousePointerClick className="h-4 w-4 text-emerald-600" />}
          actionText="Analytics"
          onAction={() => onNavigate('analytics')}
        />
        <KpiCard
          title="Google Connection"
          value={seo?.connection?.connected ? 'Connected' : 'Not connected'}
          badgeText={seo?.connection?.lastSync?.errors?.length ? 'Sync issues' : 'OK'}
          badgeVariant={seo?.connection?.lastSync?.errors?.length ? 'warning' : 'success'}
          subtitle={seo?.connection?.email || 'Google Business Profile'}
          delta={{ value: seo?.connection?.lastSync ? new Date(seo.connection.lastSync.at).toLocaleDateString() : 'never', isPositive: !!seo?.connection?.lastSync, comparisonText: 'last sync' }}
          icon={<ShieldCheck className="h-4 w-4 text-blue-600" />}
        />

      </div>

      {/* VISIBILITY SECTION + AI RECOMMENDATIONS (Grid layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <VisibilityChart
            timeRange={timeRange}
            onTimeRangeChange={onTimeRangeChange}
          />
        </div>

        <div className="lg:col-span-1 space-y-5">
          <AiRecommendationsCard
            onNavigate={onNavigate}
            onOpenAiAssistant={onOpenAiAssistant}
          />
          <SeoQuickHealthCheckCard
            selectedLocation={selectedLocation}
          />
        </div>
      </div>

      {/* PRIORITY ACTIONS */}
      <PriorityActions
        opportunities={opportunities}
        onNavigate={onNavigate}
        onExecuteAction={onExecuteAction}
      />

      {/* LOCATION HEALTH TABLE */}
      <LocationHealthTable
        locations={locations}
        onSelectLocation={(locId) => onNavigate('location-detail', locId)}
        onViewAllLocations={() => onNavigate('locations')}
      />

    </div>
  );
};

export default DashboardView;
