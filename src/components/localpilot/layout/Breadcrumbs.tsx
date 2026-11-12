import React from 'react';
import { ChevronRight } from 'lucide-react';
import { LocalPilotRoute } from '../types';

export interface BreadcrumbsProps {
  route: LocalPilotRoute;
  selectedLocationName?: string;
  onNavigate: (route: LocalPilotRoute) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  route,
  selectedLocationName,
  onNavigate
}) => {
  const routeLabels: Record<LocalPilotRoute, string> = {
    'dashboard': 'Dashboard',
    'locations': 'Locations',
    'location-detail': selectedLocationName || 'Location Details',
    'reviews': 'Reviews',
    'posts': 'Posts',
    'seo': 'Local SEO',
    'analytics': 'Analytics',
    'security': 'Security',
    'reports': 'Reports',
    'ai': 'AI Assistant',
    'settings': 'Settings',
    'settings/team': 'Team & Access',
    'settings/integrations': 'Google Integrations',
    'settings/billing': 'Billing & Plans'
  };

  const isSubSettings = route.startsWith('settings/');

  return (
    <nav className="flex items-center gap-1.5 text-xs text-slate-500">
      <button
        type="button"
        onClick={() => onNavigate('dashboard')}
        className="hover:text-slate-900 font-medium transition cursor-pointer"
      >
        LocalPilot
      </button>

      {route !== 'dashboard' && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          {route === 'location-detail' ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate('locations')}
                className="hover:text-slate-900 transition cursor-pointer"
              >
                Locations
              </button>
              <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="font-semibold text-slate-900 truncate max-w-[180px]">
                {selectedLocationName || 'Location'}
              </span>
            </>
          ) : isSubSettings ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="hover:text-slate-900 transition cursor-pointer"
              >
                Settings
              </button>
              <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="font-semibold text-slate-900">
                {routeLabels[route]}
              </span>
            </>
          ) : (
            <span className="font-semibold text-slate-900">
              {routeLabels[route]}
            </span>
          )}
        </>
      )}
    </nav>
  );
};

export default Breadcrumbs;
