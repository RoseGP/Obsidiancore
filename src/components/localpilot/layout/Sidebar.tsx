import React from 'react';
import { useOptionalLocalSeo } from '../live/localSeoClient';
import { 
  LayoutDashboard, MapPin, Star, Megaphone, 
  Search, TrendingUp, ShieldCheck, FileText, 
  Sparkles, Settings, ChevronDown, ChevronsUpDown,
  Building2, Plus, User as UserIcon } from 'lucide-react';
import { LocalPilotRoute } from '../types';

export interface SidebarProps {
  currentRoute: LocalPilotRoute;
  onRouteChange: (route: LocalPilotRoute) => void;
  unansweredReviewsCount?: number;
  openIssuesCount?: number;
  onOpenAiAssistant?: () => void;
  onOpenOnboarding?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentRoute,
  onRouteChange,
  unansweredReviewsCount = 23,
  openIssuesCount = 4,
  onOpenAiAssistant,
  onOpenOnboarding
}) => {
  const seo = useOptionalLocalSeo();
  const mainNav = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'locations', label: 'Locations', icon: MapPin, count: undefined },
    { id: 'reviews', label: 'Reviews', icon: Star, count: unansweredReviewsCount, badgeVariant: 'warning' },
    { id: 'posts', label: 'Posts', icon: Megaphone },
    { id: 'seo', label: 'SEO', icon: Search, count: openIssuesCount, badgeVariant: 'info' },
    { id: 'analytics', label: 'Analytics', icon: TrendingUp },
  ];

  const managementNav = [
    { id: 'security', label: 'Security', icon: ShieldCheck },
    { id: 'reports', label: 'Reports', icon: FileText },
  ];

  const aiNav = [
    { id: 'ai', label: 'AI Assistant', icon: Sparkles, isAction: true },
  ];

  const settingsNav = [
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const renderNavGroup = (items: typeof mainNav, groupTitle?: string) => (
    <div className="space-y-0.5">
      {groupTitle && (
        <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 tracking-wider uppercase">
          {groupTitle}
        </div>
      )}
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = currentRoute === item.id || (item.id === 'locations' && currentRoute === 'location-detail') || (item.id === 'settings' && currentRoute.startsWith('settings/'));

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.id === 'ai' && onOpenAiAssistant) {
                onOpenAiAssistant();
              } else {
                onRouteChange(item.id as LocalPilotRoute);
              }
            }}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group cursor-pointer ${
              isActive
                ? 'bg-blue-50/90 text-blue-800 font-semibold'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Icon className={`h-4 w-4 shrink-0 transition-colors ${
                isActive ? 'text-blue-600' : 'text-slate-500 group-hover:text-slate-900'
              }`} />
              <span>{item.label}</span>
            </div>

            {item.count !== undefined && item.count > 0 && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                isActive
                  ? 'bg-blue-200/60 text-blue-800'
                  : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
              }`}>
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 bg-white border-r border-slate-200 flex flex-col justify-between select-none z-30">
      
      {/* Brand & Main Nav */}
      <div className="p-3.5 space-y-5 overflow-y-auto">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-2 pt-1 pb-1">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <span className="text-sm font-bold text-slate-900 tracking-tight block leading-tight">
                LocalPilot
              </span>
              <span className="text-[10px] text-slate-400 font-medium block leading-none">
                Growth Engine
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenOnboarding}
            title="Connect new business profile"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Sections */}
        <div className="space-y-4">
          {renderNavGroup(mainNav, 'Main')}
          {renderNavGroup(managementNav, 'Management')}
          {renderNavGroup(aiNav, 'AI')}
          {renderNavGroup(settingsNav, 'Settings')}
        </div>
      </div>

      {/* Footer: Workspace & User info */}
      <div className="p-3 border-t border-slate-200 bg-slate-50/50 space-y-2">
        {/* Workspace Switcher */}
        <button
          type="button"
          className="w-full flex items-center justify-between p-1.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-left transition cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-6 w-6 rounded bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-700 shrink-0">
              AH
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">
                Google Business Profile
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {(seo?.locations.length ?? 0)} managed location{(seo?.locations.length ?? 0) === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        </button>

        {/* User Card */}
        <div className="flex items-center justify-between p-1.5 rounded-lg">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-7 w-7 rounded-full border border-slate-200 bg-slate-100 text-slate-600 flex items-center justify-center shrink-0" aria-hidden="true">
              <UserIcon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {seo?.connection?.email || 'Google not connected'}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {seo?.connection?.connected ? 'Connected via Google' : 'Not connected'}
              </div>
            </div>
          </div>
        </div>
      </div>

    </aside>
  );
};

export default Sidebar;
