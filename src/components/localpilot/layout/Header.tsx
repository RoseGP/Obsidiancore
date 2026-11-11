import React, { useState, useRef, useEffect } from 'react';
import { useOptionalLocalSeo } from '../live/localSeoClient';
import { 
  Bell, Search, Sparkles, Check, 
  ExternalLink, CheckCircle2, AlertTriangle, ShieldCheck, User as UserIcon } from 'lucide-react';
import { Breadcrumbs } from './Breadcrumbs';
import { LocationSelector } from './LocationSelector';
import { DateRangePicker } from './DateRangePicker';
import { LocalPilotRoute, LocationItem, TimeRange } from '../types';

export interface HeaderProps {
  currentRoute: LocalPilotRoute;
  onRouteChange: (route: LocalPilotRoute) => void;
  locations: LocationItem[];
  selectedLocationId: string;
  onSelectLocation: (id: string) => void;
  selectedRange: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  onOpenCommandPalette: () => void;
  onOpenAiAssistant: () => void;
  onOpenOnboarding: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRoute,
  onRouteChange,
  locations,
  selectedLocationId,
  onSelectLocation,
  selectedRange,
  onRangeChange,
  onOpenCommandPalette,
  onOpenAiAssistant,
  onOpenOnboarding
}) => {
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const selectedLoc = locations.find((l) => l.id === selectedLocationId);

  // Real notifications only: derived from synced Google data.
  const seo = useOptionalLocalSeo();
  const unanswered = (seo?.reviews ?? []).filter((r) => r.status === 'unanswered').length;
  const notifications = [
    ...(unanswered ? [{ id: 'n-reviews', title: `${unanswered} review${unanswered === 1 ? '' : 's'} waiting for a reply`, desc: 'Draft and approve replies in Reviews.', time: '', unread: true, route: 'reviews' as LocalPilotRoute }] : []),
    ...((seo?.connection?.lastSync?.errors ?? []).map((e, i) => ({ id: `n-err-${i}`, title: 'Sync problem', desc: e, time: '', unread: true, route: 'settings' as LocalPilotRoute }))),
    ...(seo?.connection && !seo.connection.aiConfigured ? [{ id: 'n-ai', title: 'AI drafting is off', desc: 'Set GEMINI_API_KEY on the server to enable AI reply drafts.', time: '', unread: false, route: 'reviews' as LocalPilotRoute }] : []),
  ];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="h-14 sticky top-0 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-6 flex items-center justify-between z-20 select-none">
      
      {/* Left: Breadcrumbs */}
      <div className="flex items-center gap-4">
        <Breadcrumbs
          route={currentRoute}
          selectedLocationName={selectedLoc?.name}
          onNavigate={onRouteChange}
        />
      </div>

      {/* Right: Controls & Shortcuts */}
      <div className="flex items-center gap-2.5">
        
        {/* Location Selector */}
        <LocationSelector
          locations={locations}
          selectedLocationId={selectedLocationId}
          onSelectLocation={onSelectLocation}
          onAddNewLocation={onOpenOnboarding}
        />

        {/* Date Range Selector */}
        <DateRangePicker
          selectedRange={selectedRange}
          onRangeChange={onRangeChange}
        />

        {/* Command Palette Trigger ⌘ K */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs text-slate-500 flex items-center gap-2 transition-colors cursor-pointer"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search or jump to...</span>
          <span className="font-mono text-[10px] px-1 py-0.5 rounded bg-white border border-slate-200 text-slate-900">
            ⌘K
          </span>
        </button>

        {/* AI Assistant Quick Trigger */}
        <button
          type="button"
          onClick={onOpenAiAssistant}
          className="h-8 px-2.5 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200/80 text-xs font-semibold text-blue-600 flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
        >
          <Sparkles className="h-3.5 w-3.5 text-blue-600" />
          <span className="hidden md:inline">Ask</span>
        </button>

        {/* Notifications Popover */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => setIsNotifOpen(!isNotifOpen)}
            className="h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-900 flex items-center justify-center relative transition-colors cursor-pointer"
          >
            <Bell className="h-3.5 w-3.5" />
            {notifications.some((n) => n.unread) && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-blue-600" />}
          </button>

          {isNotifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3.5 py-2 border-b border-slate-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">
                  Notifications
                </span>
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                {notifications.length === 0 && <p className="p-3 text-[11px] text-slate-500">Nothing needs your attention.</p>}
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => {
                      setIsNotifOpen(false);
                      onRouteChange(n.route);
                    }}
                    className={`p-3 text-xs hover:bg-slate-50 cursor-pointer transition-colors ${
                      n.unread ? 'bg-blue-50/30' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-semibold text-slate-900">
                        {n.title}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {n.time}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {n.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User avatar */}
        <div className="pl-1">
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            className="h-8 w-8 rounded-full border border-slate-200 bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer hover:bg-slate-200"
            onClick={() => onRouteChange('settings')}
          >
            <UserIcon className="h-4 w-4" />
          </button>
        </div>

      </div>

    </header>
  );
};

export default Header;
