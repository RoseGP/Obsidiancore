import React from 'react';
import { Star, ArrowRight, ShieldCheck, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { LocationItem, LocalPilotRoute } from '../types';

export interface LocationHealthTableProps {
  locations: LocationItem[];
  onSelectLocation: (locId: string) => void;
  onViewAllLocations: () => void;
}

export const LocationHealthTable: React.FC<LocationHealthTableProps> = ({
  locations,
  onSelectLocation,
  onViewAllLocations
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
      {/* Header */}
      <div className="p-4 px-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 tracking-tight">
            Location health & rankings
          </h3>
          <p className="text-xs text-slate-500">
            Multi-location overview across visibility, review velocity, profile completeness, and open issues.
          </p>
        </div>

        <button
          type="button"
          onClick={onViewAllLocations}
          className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
        >
          <span>View all locations</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Responsive Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            <tr>
              <th className="px-5 py-3">Location</th>
              <th className="px-4 py-3">Visibility</th>
              <th className="px-4 py-3">Reviews</th>
              <th className="px-4 py-3">Profile</th>
              <th className="px-4 py-3">Security</th>
              <th className="px-4 py-3">Open Issues</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-normal">
            {locations.slice(0, 5).map((loc) => {
              const statusVariant = 
                loc.status === 'Healthy' ? 'success' :
                loc.status === 'Needs Attention' ? 'warning' : 'danger';

              return (
                <tr 
                  key={loc.id} 
                  onClick={() => onSelectLocation(loc.id)}
                  className="hover:bg-slate-50/70 transition-colors cursor-pointer group"
                >
                  {/* Location Info */}
                  <td className="px-5 py-3.5">
                    <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                      {loc.name}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {loc.city}, {loc.state} • {loc.category}
                    </div>
                  </td>

                  {/* Visibility Score */}
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">
                        {loc.visibilityScore}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        loc.visibilityScore >= 90 ? 'bg-emerald-50 text-emerald-700' :
                        loc.visibilityScore >= 80 ? 'bg-blue-50 text-blue-700' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {loc.visibilityScore >= 90 ? 'Strong' : loc.visibilityScore >= 80 ? 'Good' : 'Needs work'}
                      </span>
                    </div>
                  </td>

                  {/* Rating & Reviews */}
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-900 flex items-center gap-1">
                        {loc.rating} <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      </span>
                      <span className="text-[11px] text-slate-400">
                        ({loc.reviewsCount})
                      </span>
                      {loc.unansweredReviewsCount > 0 && (
                        <span className="text-[10px] font-semibold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded ml-1">
                          {loc.unansweredReviewsCount} new
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Profile Completeness */}
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="bg-blue-600 h-1.5 rounded-full" 
                          style={{ width: `${loc.profileCompleteness}%` }}
                        />
                      </div>
                      <span className="font-medium text-slate-900">
                        {loc.profileCompleteness}%
                      </span>
                    </div>
                  </td>

                  {/* Security Score */}
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 text-slate-900 font-medium">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                      <span>{loc.securityScore}%</span>
                    </div>
                  </td>

                  {/* Open Issues */}
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <Badge variant={statusVariant} size="sm">
                      {loc.openIssuesCount} {loc.openIssuesCount === 1 ? 'issue' : 'issues'}
                    </Badge>
                  </td>

                  {/* Action Link */}
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <span className="inline-flex items-center text-blue-600 font-semibold text-xs group-hover:underline">
                      Manage <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  );
};

export default LocationHealthTable;
