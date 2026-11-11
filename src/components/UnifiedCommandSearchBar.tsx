import React, { useState, useRef, useEffect } from 'react';
import useDebounce from '../hooks/useDebounce';
import {
  Search,
  Command,
  Sparkles,
  User,
  Calendar,
  ArrowRight,
  Clock,
  Settings,
  Globe,
  Megaphone,
  Phone,
  Video,
  FileText,
  BarChart3,
  HelpCircle,
  Filter,
  CheckCircle2,
  Briefcase,
  CheckSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CRMContact, CalendarEvent } from '../types';
import { NAV_GROUPS } from './DynamicSidebar';
import { getDashboardJson } from '../lib/dashboardData';

interface UnifiedCommandSearchBarProps {
  themeMode: 'light' | 'dark';
  contacts: CRMContact[];
  events: CalendarEvent[];
  /** Deprecated: navigation entries now come from the sidebar (same labels everywhere). */
  navItems?: readonly any[];
  activeView: string;
  setActiveView: (view: any) => void;
  onSelectContact: (contact: CRMContact) => void;
  placeholder?: string;
  onSearchInput?: (query: string) => void;
}

interface SearchMatch {
  type: 'contact' | 'route' | 'event' | 'action' | 'deal' | 'task';
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  object: any;
  icon?: React.ComponentType<any>;
}

export default function UnifiedCommandSearchBar({
  themeMode,
  contacts,
  events,
  navItems,
  activeView,
  setActiveView,
  onSelectContact,
  placeholder = 'Search contacts, deals, tasks...',
  onSearchInput
}: UnifiedCommandSearchBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'leads' | 'menus' | 'events'>('all');
  // Only what this person actually searched (no sample entries).
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('obsidian_recent_searches_v2') || '[]');
      return Array.isArray(saved) ? saved.filter((x) => typeof x === 'string').slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  // The organization's real deals (shared, cached dashboard request), loaded when search opens.
  const [deals, setDeals] = useState<any[]>([]);
  useEffect(() => {
    if (!showSearchResults) return;
    let cancelled = false;
    getDashboardJson<{ deals?: any[] }>('/api/dashboard/deals')
      .then((d) => { if (!cancelled && Array.isArray(d?.deals)) setDeals(d.deals); })
      .catch(() => { /* search still works on everything else */ });
    return () => { cancelled = true; };
  }, [showSearchResults]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync keyboard shortcuts (⌘K or Ctrl+K or /)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in another input/textarea
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        if (e.key === 'Escape' && showSearchResults) {
          setShowSearchResults(false);
          searchInputRef.current?.blur();
        }
        return;
      }

      // Check Command+K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowSearchResults(true);
      }

      // Check forward slash (/)
      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowSearchResults(true);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [showSearchResults]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(event.target as Node)
      ) {
        setShowSearchResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Compute all potential matches (only real records and real destinations)
  const money = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? `$${Number(v).toLocaleString()}` : '');
  const allMatches: SearchMatch[] = [
    // 1. Navigation: the sidebar's entries and labels
    ...NAV_GROUPS.flatMap((g) => g.items.map((item) => ({
      type: 'route' as const,
      id: item.id,
      title: item.label,
      subtitle: [g.label, item.hint].filter(Boolean).join(' · '),
      meta: 'Go to',
      object: item.id,
      icon: item.icon
    }))),
    // 2. Contacts / Leads
    ...contacts.map(c => ({
      type: 'contact' as const,
      id: c.id,
      title: c.name,
      subtitle: [c.company, c.phone].filter(Boolean).join(' • '),
      meta: c.channel || 'Lead',
      object: c,
      icon: User
    })),
    // 3. Calendar Events
    ...events.map(e => ({
      type: 'event' as const,
      id: e.id,
      title: e.title,
      subtitle: [e.contact, e.time].filter(Boolean).join(' · '),
      meta: e.type,
      object: e,
      icon: Calendar
    })),
    // 4. Deals of this organization
    ...deals.map((d) => ({
      type: 'deal' as const,
      id: String(d.id),
      title: d.name || d.client || 'Deal',
      subtitle: [d.client, money(d.value), d.stage].filter(Boolean).join(' • '),
      meta: 'Deal',
      object: 'deals',
      icon: Briefcase
    })),
    // 5. Quick actions that open real screens
    {
      type: 'action' as const,
      id: 'action-copilot',
      title: 'Ask your AI copilot',
      subtitle: 'Open the copilot on the dashboard',
      meta: 'AI',
      object: 'dashboard#copilot',
      icon: Sparkles
    },
    {
      type: 'action' as const,
      id: 'action-new-proposal',
      title: 'Create a proposal',
      subtitle: 'Open Proposals & Invoices',
      meta: 'Proposals',
      object: 'proposals',
      icon: FileText
    }
  ];

  const debouncedSearchQuery = useDebounce(searchQuery, 350);

  // Filter based on debounced search query and category
  const filteredMatches = allMatches.filter(match => {
    // Text search query filter (debounced 350ms)
    const query = (debouncedSearchQuery || '').trim().toLowerCase();
    const titleStr = (match.title || '').toLowerCase();
    const subtitleStr = (match.subtitle || '').toLowerCase();
    const metaStr = (match.meta || '').toLowerCase();

    const matchesSearch = query === '' ||
      titleStr.includes(query) ||
      subtitleStr.includes(query) ||
      metaStr.includes(query);

    if (!matchesSearch) return false;

    // Category tab filter
    if (selectedCategory === 'all') return true;
    if (selectedCategory === 'leads') return match.type === 'contact' || match.type === 'deal';
    if (selectedCategory === 'menus') return match.type === 'route' || match.type === 'action';
    if (selectedCategory === 'events') return match.type === 'event';

    return true;
  });

  // Reset highlighted index on query/category change
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchQuery, selectedCategory]);

  const saveRecentSearch = (query: string) => {
    if (!query.trim()) return;
    const filtered = [query, ...recentSearches.filter(s => s !== query)].slice(0, 5);
    setRecentSearches(filtered);
    try {
      localStorage.setItem('obsidian_recent_searches_v2', JSON.stringify(filtered));
    } catch (e) {
      console.warn('Failed to save recent search to localStorage', e);
    }
  };

  const handleSearchResultClick = (match: SearchMatch) => {
    saveRecentSearch(match.title);
    setSearchQuery('');
    setShowSearchResults(false);

    if (match.type === 'route') {
      setActiveView(match.object);
    } else if (match.type === 'contact') {
      onSelectContact(match.object as CRMContact);
      setActiveView('messages');
    } else if (match.type === 'event') {
      setActiveView('calendar');
    } else if (match.type === 'deal') {
      setActiveView('deals');
    } else if (match.type === 'action') {
      setActiveView(match.object);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowSearchResults(false);
      searchInputRef.current?.blur();
      return;
    }

    if (!showSearchResults) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        setShowSearchResults(true);
        setHighlightedIndex(0);
        e.preventDefault();
      }
      return;
    }

    const matchesCount = filteredMatches.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => {
        if (matchesCount === 0) return -1;
        const nextIndex = prev + 1;
        return nextIndex >= matchesCount ? 0 : nextIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => {
        if (matchesCount === 0) return -1;
        const nextIndex = prev - 1;
        return nextIndex < 0 ? matchesCount - 1 : nextIndex;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < matchesCount) {
        handleSearchResultClick(filteredMatches[highlightedIndex]);
      } else if (searchQuery.trim()) {
        saveRecentSearch(searchQuery);
        // Find first match or stay
        if (filteredMatches.length > 0) {
          handleSearchResultClick(filteredMatches[0]);
        }
      }
    }
  };

  const clearRecentSearches = () => {
    setRecentSearches([]);
    try {
      localStorage.removeItem('obsidian_recent_searches');
    } catch {}
  };

  return (
    <div
      id="unified-navigation-search-root"
      className="relative flex-1 group max-w-sm sm:max-w-md md:max-w-lg z-30"
    >
      {/* Input container */}
      <div
        id="unified-search-input-wrapper"
        className="relative flex items-center"
      >
        <div className="absolute left-3.5 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-neutral-400 group-focus-within:text-blue-500 transition-colors duration-200" />
        </div>

        <input
          id="search-command-input"
          ref={searchInputRef}
          type="text"
          placeholder={placeholder}
          value={searchQuery}
          onKeyDown={handleSearchKeyDown}
          onFocus={() => setShowSearchResults(true)}
          onChange={(e) => {
            const val = e.target.value;
            setSearchQuery(val);
            if (onSearchInput) {
              onSearchInput(val);
            }
          }}
          className={`w-full rounded-xl border py-2 pl-10 pr-14 text-xs font-semibold outline-none transition-all font-sans ${
            themeMode === 'light'
              ? 'border-neutral-200 bg-neutral-50/80 text-neutral-850 placeholder-neutral-400 focus:border-neutral-300 focus:bg-white focus:shadow-[0_4px_20px_rgba(0,0,0,0.03)]'
              : 'border-white/5 bg-neutral-900/60 text-neutral-200 placeholder-neutral-500 focus:border-blue-500/30 focus:shadow-[0_0_20px_rgba(59,130,246,0.12)] focus:bg-neutral-950/90'
          }`}
        />

        {/* Keyboard Shortcut Indicator pill */}
        <div className={`absolute right-3.5 flex items-center gap-0.5 select-none text-[9px] font-mono py-0.5 px-1.5 rounded-md pointer-events-none transition-colors ${
          themeMode === 'light'
            ? 'text-neutral-500 bg-neutral-100 border border-neutral-200'
            : 'text-neutral-400 bg-neutral-800/60 border border-white/5 group-focus-within:border-blue-500/20 group-focus-within:text-blue-400'
        }`}>
          <span>⌘</span>
          <span>K</span>
        </div>
      </div>

      {/* Dynamic dropped dropdown results with luxury glassmorphism */}
      <AnimatePresence>
        {showSearchResults && (
          <motion.div
            id="search-outcomes-dropdown-panel"
            ref={dropdownRef}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`absolute top-11 left-0 right-0 max-h-[500px] overflow-hidden rounded-2xl border shadow-2xl z-50 flex flex-col font-sans ${
              themeMode === 'light'
                ? 'border-neutral-200 bg-white/98 backdrop-blur-xl text-neutral-800'
                : 'border-white/10 bg-slate-900/96 backdrop-blur-2xl text-neutral-200'
            }`}
          >
            {/* Header: CRM Assistant Pitch & Quick Command */}
            <div className="p-3 border-b border-white/5 bg-neutral-950/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-5 w-5 rounded-md bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-md">
                  <Command className="h-3 w-3 text-white" />
                </div>
                <span className="text-[10px] font-extrabold tracking-wider uppercase bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-300">
                  Obsidian CRM Intelligence
                </span>
              </div>
              <span className="text-[9px] text-neutral-500 font-mono">
                Press <kbd className="px-1 py-0.5 rounded bg-neutral-900 border border-white/10 text-neutral-400 text-[8px]">Esc</kbd> to dismiss
              </span>
            </div>

            {/* Navigation Tabs / Filters */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 bg-neutral-950/10 overflow-x-auto scrollbar-none">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all uppercase tracking-wider cursor-pointer border ${
                  selectedCategory === 'all'
                    ? 'bg-blue-600/10 border-blue-500/20 text-blue-400'
                    : 'bg-transparent border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
                }`}
              >
                All Matches
              </button>
              <button
                onClick={() => setSelectedCategory('leads')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all uppercase tracking-wider cursor-pointer border ${
                  selectedCategory === 'leads'
                    ? 'bg-blue-600/10 border-blue-500/20 text-blue-400'
                    : 'bg-transparent border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
                }`}
              >
                Leads & Clients
              </button>
              <button
                onClick={() => setSelectedCategory('menus')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all uppercase tracking-wider cursor-pointer border ${
                  selectedCategory === 'menus'
                    ? 'bg-blue-600/10 border-blue-500/20 text-blue-400'
                    : 'bg-transparent border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
                }`}
              >
                Menus & Actions
              </button>
              <button
                onClick={() => setSelectedCategory('events')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold transition-all uppercase tracking-wider cursor-pointer border ${
                  selectedCategory === 'events'
                    ? 'bg-blue-600/10 border-blue-500/20 text-blue-400'
                    : 'bg-transparent border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
                }`}
              >
                Calendar Events
              </button>
            </div>

            {/* Dropdown Content Area */}
            <div className="flex-1 overflow-y-auto max-h-[320px] p-2 space-y-3 scrollbar-thin">
              {searchQuery.trim() === '' ? (
                // 1. Empty Query State: Show Recent Searches & Recommended shortcuts
                <div className="p-1 space-y-4">
                  {/* Recent Searches */}
                  {recentSearches.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[8.5px] font-black text-neutral-500 uppercase tracking-widest flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Recent Searches
                        </span>
                        <button
                          onClick={clearRecentSearches}
                          className="text-[8.5px] text-blue-400 hover:text-blue-300 font-bold hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {recentSearches.map((term, idx) => (
                          <button
                            key={idx}
                            onClick={() => setSearchQuery(term)}
                            className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-neutral-300 hover:text-white transition-all cursor-pointer"
                          >
                            <span>{term}</span>
                            <ArrowRight className="h-2.5 w-2.5 text-neutral-500" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Context Shortcuts / Quick Jump Workspaces */}
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[8.5px] font-black text-neutral-500 uppercase tracking-widest pl-1 block">
                      Recommended Actions & Jumps
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => {
                          setActiveView('dashboard');
                          setShowSearchResults(false);
                        }}
                        className="flex items-center gap-2.5 p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-left transition-all cursor-pointer"
                      >
                        <div className="h-7 w-7 rounded-lg bg-neutral-900 border border-white/5 flex items-center justify-center shrink-0">
                          <BarChart3 className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="truncate">
                          <span className="text-[10.5px] font-bold text-neutral-200 block truncate">Dashboard</span>
                          <span className="text-[8.5px] text-neutral-500 block">System Overview</span>
                        </div>
                      </button>

                      <button
                        onClick={() => {
                          setActiveView('messages');
                          setShowSearchResults(false);
                        }}
                        className="flex items-center gap-2.5 p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-left transition-all cursor-pointer"
                      >
                        <div className="h-7 w-7 rounded-lg bg-neutral-900 border border-white/5 flex items-center justify-center shrink-0">
                          <Sparkles className="h-4 w-4 text-purple-400" />
                        </div>
                        <div className="truncate">
                          <span className="text-[10.5px] font-bold text-neutral-200 block truncate">Email, Chat AI</span>
                          <span className="text-[8.5px] text-neutral-500 block">Process Inbox</span>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                // 2. Active Matches Listing
                <div className="space-y-4">
                  {filteredMatches.length === 0 ? (
                    <div className="text-center py-8">
                      <HelpCircle className="h-8 w-8 text-neutral-500 mx-auto mb-2 opacity-55 animate-bounce" />
                      <span className="text-xs text-neutral-400 block font-semibold">No operational records matched</span>
                      <span className="text-[10px] text-neutral-500 mt-1 block">Try searching contacts, nav names, or custom calendars</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {/* Categorized Listings */}
                      {(() => {
                        const routes = filteredMatches.filter(m => m.type === 'route');
                        const contactsList = filteredMatches.filter(m => m.type === 'contact');
                        const eventsList = filteredMatches.filter(m => m.type === 'event');
                        const actions = filteredMatches.filter(m => m.type === 'action');
                        const dealsList = filteredMatches.filter(m => m.type === 'deal');

                        return (
                          <div className="space-y-4">
                            {/* Actions Group */}
                            {actions.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[8.5px] font-extrabold text-indigo-400 uppercase tracking-widest pl-1 block">⚡ AI AUTOMATION COMMANDS</span>
                                {actions.map(match => {
                                  const globalIndex = filteredMatches.indexOf(match);
                                  const IconComp = match.icon || Sparkles;
                                  return (
                                    <button
                                      key={match.id}
                                      onClick={() => handleSearchResultClick(match)}
                                      className={`w-full text-left flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all duration-150 border ${
                                        globalIndex === highlightedIndex
                                          ? 'bg-blue-600/15 border-blue-500/35 text-white shadow-lg shadow-blue-500/5'
                                          : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/5 text-neutral-300 hover:text-white'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5 truncate">
                                        <div className="h-7 w-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                                          <IconComp className="h-4 w-4 text-indigo-400" />
                                        </div>
                                        <div className="truncate">
                                          <span className={`text-[11px] font-bold block truncate ${globalIndex === highlightedIndex ? 'text-white' : 'text-neutral-200'}`}>
                                            {match.title}
                                          </span>
                                          <span className="text-[8.5px] text-neutral-400 block truncate">{match.subtitle}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="rounded bg-neutral-900 border border-white/5 px-1.5 py-0.5 text-[8px] font-bold uppercase text-indigo-400 font-mono">
                                          {match.meta}
                                        </span>
                                        {globalIndex === highlightedIndex && (
                                          <span className="text-[8px] font-mono font-bold text-blue-500 bg-blue-500/15 px-1 py-0.5 rounded border border-blue-500/25 select-none animate-pulse">Enter</span>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* Routes Group */}
                            {routes.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[8.5px] font-extrabold text-blue-400 uppercase tracking-widest pl-1 block">🚀 SYSTEM NAVIGATION MENUS</span>
                                {routes.map(match => {
                                  const globalIndex = filteredMatches.indexOf(match);
                                  const IconComp = match.icon || Command;
                                  return (
                                    <button
                                      key={match.id}
                                      onClick={() => handleSearchResultClick(match)}
                                      className={`w-full text-left flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all duration-150 border ${
                                        globalIndex === highlightedIndex
                                          ? 'bg-blue-600/15 border-blue-500/35 text-white shadow-lg shadow-blue-500/5'
                                          : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/5 text-neutral-300 hover:text-white'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5 truncate">
                                        <div className="h-7 w-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                                          <IconComp className="h-4 w-4 text-blue-400" />
                                        </div>
                                        <div className="truncate">
                                          <span className={`text-[11px] font-bold block truncate ${globalIndex === highlightedIndex ? 'text-white' : 'text-neutral-200'}`}>
                                            {match.title}
                                          </span>
                                          <span className="text-[8.5px] text-neutral-400 block truncate">{match.subtitle}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="rounded bg-neutral-900 border border-white/5 px-1.5 py-0.5 text-[8px] font-bold uppercase text-blue-400 font-mono">
                                          {match.meta}
                                        </span>
                                        {globalIndex === highlightedIndex && (
                                          <span className="text-[8px] font-mono font-bold text-blue-500 bg-blue-500/15 px-1 py-0.5 rounded border border-blue-500/25 select-none animate-pulse">Enter</span>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* Contacts Group */}
                            {contactsList.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[8.5px] font-extrabold text-emerald-400 uppercase tracking-widest pl-1 block">👥 ACTIVE CLIENTS & LEADS</span>
                                {contactsList.map(match => {
                                  const globalIndex = filteredMatches.indexOf(match);
                                  const contact = match.object as CRMContact;
                                  const channelIcon = contact.channel === 'whatsapp' ? '💬' : contact.channel === 'telegram' ? '✈️' : '✉️';
                                  return (
                                    <button
                                      key={match.id}
                                      onClick={() => handleSearchResultClick(match)}
                                      className={`w-full text-left flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all duration-150 border ${
                                        globalIndex === highlightedIndex
                                          ? 'bg-blue-600/15 border-blue-500/35 text-white shadow-lg shadow-blue-500/5'
                                          : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/5 text-neutral-300 hover:text-white'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5 truncate">
                                        <div className="relative shrink-0 select-none">
                                          <img
                                            src={contact.avatar}
                                            alt={contact.name}
                                            className="h-7 w-7 rounded-full border border-white/10 object-cover"
                                            referrerPolicy="no-referrer"
                                          />
                                          <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-neutral-950 border border-white/10 flex items-center justify-center text-[8px] font-bold">
                                            {channelIcon}
                                          </span>
                                        </div>
                                        <div className="truncate">
                                          <span className={`text-[11px] font-bold block truncate ${globalIndex === highlightedIndex ? 'text-white' : 'text-neutral-200'}`}>
                                            {match.title}
                                          </span>
                                          <span className="text-[8.5px] text-neutral-400 block truncate">{match.subtitle}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="rounded bg-neutral-900 border border-white/5 px-1.5 py-0.5 text-[8px] font-bold uppercase text-emerald-400 font-mono">
                                          {match.meta}
                                        </span>
                                        {globalIndex === highlightedIndex && (
                                          <span className="text-[8px] font-mono font-bold text-blue-500 bg-blue-500/15 px-1 py-0.5 rounded border border-blue-500/25 select-none animate-pulse">Enter</span>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* Deals Group */}
                            {dealsList.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[8.5px] font-extrabold text-emerald-400 uppercase tracking-widest pl-1 block">DEALS</span>
                                {dealsList.map(match => {
                                  const globalIndex = filteredMatches.indexOf(match);
                                  const IconComp = match.icon || Briefcase;
                                  return (
                                    <button
                                      key={match.id}
                                      onClick={() => handleSearchResultClick(match)}
                                      className={`w-full text-left flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all duration-150 border ${
                                        globalIndex === highlightedIndex
                                          ? 'bg-blue-600/15 border-blue-500/35 text-white shadow-lg shadow-blue-500/5'
                                          : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/5 text-neutral-300 hover:text-white'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5 truncate">
                                        <div className="h-7 w-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                                          <IconComp className="h-4 w-4 text-emerald-400" />
                                        </div>
                                        <div className="truncate">
                                          <span className={`text-[11px] font-bold block truncate ${globalIndex === highlightedIndex ? 'text-white' : 'text-neutral-200'}`}>{match.title}</span>
                                          <span className="text-[8.5px] text-neutral-400 block truncate">{match.subtitle}</span>
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* Events Group */}
                            {eventsList.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[8.5px] font-extrabold text-amber-400 uppercase tracking-widest pl-1 block">📅 BOOKINGS & CALENDAR EVENTS</span>
                                {eventsList.map(match => {
                                  const globalIndex = filteredMatches.indexOf(match);
                                  const IconComp = match.icon || Calendar;
                                  return (
                                    <button
                                      key={match.id}
                                      onClick={() => handleSearchResultClick(match)}
                                      className={`w-full text-left flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all duration-150 border ${
                                        globalIndex === highlightedIndex
                                          ? 'bg-blue-600/15 border-blue-500/35 text-white shadow-lg shadow-blue-500/5'
                                          : 'bg-transparent border-transparent hover:bg-white/5 hover:border-white/5 text-neutral-300 hover:text-white'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5 truncate">
                                        <div className="h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                                          <IconComp className="h-4 w-4 text-amber-400" />
                                        </div>
                                        <div className="truncate">
                                          <span className={`text-[11px] font-bold block truncate ${globalIndex === highlightedIndex ? 'text-white' : 'text-neutral-200'}`}>
                                            {match.title}
                                          </span>
                                          <span className="text-[8.5px] text-neutral-400 block truncate">{match.subtitle}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="rounded bg-neutral-900 border border-white/5 px-1.5 py-0.5 text-[8px] font-bold uppercase text-amber-400 font-mono">
                                          {match.meta}
                                        </span>
                                        {globalIndex === highlightedIndex && (
                                          <span className="text-[8px] font-mono font-bold text-blue-500 bg-blue-500/15 px-1 py-0.5 rounded border border-blue-500/25 select-none animate-pulse">Enter</span>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer Status Panel */}
            <div className="p-2 px-3.5 bg-neutral-950/45 border-t border-white/5 flex items-center justify-between text-[9px] text-neutral-500">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                Command Engine: Active
              </span>
              <span className="font-mono">
                {filteredMatches.length} results listed
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
