import React, { useState, useRef, useEffect } from 'react';
import { Plus, ChevronDown, UserPlus, DollarSign, Calendar, Sparkles } from 'lucide-react';

export type QuickActionType = 'lead' | 'deal' | 'event';

interface QuickActionButtonProps {
  onTriggerAction: (type: QuickActionType) => void;
  className?: string;
}

export default function QuickActionButton({
  onTriggerAction,
  className = ''
}: QuickActionButtonProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  // Global keyboard shortcut listener (Alt+N to trigger quick action)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Alt + N or Option + N
      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        onTriggerAction('lead');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTriggerAction]);

  return (
    <div className={`relative inline-flex items-center ${className}`} ref={dropdownRef}>
      {/* Primary Action Button */}
      <div className="inline-flex items-stretch rounded-lg shadow-sm bg-[var(--accent)] text-[var(--accent-contrast)] transition-all hover:bg-[var(--accent-hover)] active:scale-[0.99]">
        <button
          type="button"
          onClick={() => onTriggerAction('lead')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-l-lg"
          title="Quick Action (Shortcut: Alt+N)"
          aria-label="Create new lead, deal, or event"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span className="font-semibold tracking-tight">Quick Action</span>
          <kbd className="hidden lg:inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-mono font-normal opacity-75 bg-[var(--border)] ml-1">
            Alt+N
          </kbd>
        </button>

        {/* Split Dropdown Trigger */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsDropdownOpen((prev) => !prev);
          }}
          className="px-1.5 py-1.5 border-l border-[var(--border)] hover:bg-[var(--border)] rounded-r-lg cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-label="Open quick action menu"
          aria-expanded={isDropdownOpen}
        >
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-150 ${
              isDropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      </div>

      {/* Dropdown Menu */}
      {isDropdownOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-56 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-3 py-1 text-[11px] font-medium text-[var(--text-muted)] dark:text-[var(--text-subtle)] uppercase tracking-wider">
            Create Instantly
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsDropdownOpen(false);
              onTriggerAction('lead');
            }}
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-sunken)] transition-colors text-left group"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-blue-500/10 text-blue-600 dark:text-[var(--accent-text)] flex items-center justify-center">
                <UserPlus className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="font-medium group-hover:text-blue-600 dark:group-hover:text-[var(--accent-text)] transition-colors">
                  New Inbound Lead
                </div>
                <div className="text-[10px] text-[var(--text-subtle)] dark:text-[var(--text-muted)]">
                  Prospect & qualification
                </div>
              </div>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-neutral-600 dark:group-hover:text-[var(--text-muted)]">
              Alt+1
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsDropdownOpen(false);
              onTriggerAction('deal');
            }}
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-sunken)] transition-colors text-left group"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-[var(--success)] flex items-center justify-center">
                <DollarSign className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="font-medium group-hover:text-emerald-600 dark:group-hover:text-[var(--success)] transition-colors">
                  New Sales Deal
                </div>
                <div className="text-[10px] text-[var(--text-subtle)] dark:text-[var(--text-muted)]">
                  Opportunity & forecast
                </div>
              </div>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-neutral-600 dark:group-hover:text-[var(--text-muted)]">
              Alt+2
            </span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsDropdownOpen(false);
              onTriggerAction('event');
            }}
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-sunken)] transition-colors text-left group"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-purple-500/10 text-purple-600 dark:text-[var(--accent-text)] flex items-center justify-center">
                <Calendar className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="font-medium group-hover:text-purple-600 dark:group-hover:text-[var(--accent-text)] transition-colors">
                  New Calendar Event
                </div>
                <div className="text-[10px] text-[var(--text-subtle)] dark:text-[var(--text-muted)]">
                  Meeting or client call
                </div>
              </div>
            </div>
            <span className="text-[10px] font-mono text-[var(--text-muted)] group-hover:text-neutral-600 dark:group-hover:text-[var(--text-muted)]">
              Alt+3
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
