import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, MapPin, Star, Megaphone, 
  TrendingUp, ShieldCheck, FileText, Sparkles, 
  Settings, ArrowRight, CornerDownLeft, X,
  Plus, CheckCircle2, Zap
} from 'lucide-react';
import { LocalPilotRoute, LocationItem } from '../types';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (route: LocalPilotRoute, locationId?: string) => void;
  locations: LocationItem[];
  onOpenAiAssistant: () => void;
  onCreatePost?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  locations,
  onOpenAiAssistant,
  onCreatePost
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘ K or Ctrl+K trigger
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Base command items
  const baseActions = [
    {
      id: 'cmd-audit',
      title: 'Run SEO audit across all locations',
      category: 'Actions',
      icon: Zap,
      run: () => onNavigate('seo')
    },
    {
      id: 'cmd-post',
      title: 'Create new Google post',
      category: 'Actions',
      icon: Megaphone,
      run: () => {
        if (onCreatePost) onCreatePost();
        else onNavigate('posts');
      }
    },
    {
      id: 'cmd-reviews',
      title: 'Find unanswered customer reviews (23)',
      category: 'Navigation',
      icon: Star,
      run: () => onNavigate('reviews')
    },
    {
      id: 'cmd-ai',
      title: 'Ask AI: "Find my biggest SEO problems"',
      category: 'AI Assistant',
      icon: Sparkles,
      run: () => onOpenAiAssistant()
    },
    {
      id: 'cmd-analytics',
      title: 'View search visibility & customer actions',
      category: 'Navigation',
      icon: TrendingUp,
      run: () => onNavigate('analytics')
    },
    {
      id: 'cmd-forms',
      title: 'Website forms: connect your contact form to the CRM',
      category: 'Navigation',
      icon: TrendingUp,
      run: () => onNavigate('forms')
    },
    {
      id: 'cmd-security',
      title: 'Check Google OAuth & security logs',
      category: 'Navigation',
      icon: ShieldCheck,
      run: () => onNavigate('security')
    },
    {
      id: 'cmd-reports',
      title: 'Generate September Monthly SEO Report',
      category: 'Navigation',
      icon: FileText,
      run: () => onNavigate('reports')
    },
    {
      id: 'cmd-settings-team',
      title: 'Manage team members and permissions',
      category: 'Settings',
      icon: Settings,
      run: () => onNavigate('settings/team')
    }
  ];

  // Location search results
  const locationActions = locations.map((loc) => ({
    id: `loc-${loc.id}`,
    title: `Open ${loc.name} (${loc.city}, ${loc.state})`,
    category: 'Locations',
    icon: MapPin,
    run: () => onNavigate('location-detail', loc.id)
  }));

  const allItems = [...baseActions, ...locationActions];
  const filtered = allItems.filter((item) =>
    item.title.toLowerCase().includes(query.toLowerCase()) ||
    item.category.toLowerCase().includes(query.toLowerCase())
  );

  const handleSelect = (item: typeof allItems[0]) => {
    item.run();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      handleSelect(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />

      {/* Command dialog */}
      <div className="relative w-full max-w-xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden z-10 animate-in zoom-in-95 duration-100">
        
        {/* Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-slate-100 gap-3">
          <Search className="h-4 w-4 text-slate-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search locations, reviews, tools..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="w-full text-sm text-slate-900 placeholder-slate-400 outline-none bg-transparent"
          />
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200">
            ESC
          </span>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 divide-y divide-slate-50 text-xs">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No commands or locations found matching &quot;{query}&quot;
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;

              return (
                <div
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`px-3 py-2.5 rounded-lg flex items-center justify-between cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50/80 text-blue-800' : 'hover:bg-slate-50 text-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
                    }`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="font-medium truncate">
                      {item.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-medium text-slate-400 px-1.5 py-0.5 rounded bg-slate-100">
                      {item.category}
                    </span>
                    {isSelected && (
                      <CornerDownLeft className="h-3.5 w-3.5 text-blue-600" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span>LocalPilot v2.4</span>
        </div>

      </div>
    </div>
  );
};

export default CommandPalette;
