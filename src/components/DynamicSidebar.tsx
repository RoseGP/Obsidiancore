import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  MessageSquare, 
  FileText, 
  BarChart3, 
  Settings,
  ChevronLeft,
  ChevronRight,
  Video,
  Sparkles,
  Clock,
  Calendar,
  Share2,
  Globe,
  Phone,
  DollarSign,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type UserStatus = 'online' | 'away' | 'offline';

interface SidebarItem {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
}

interface DynamicSidebarProps {
  activeId?: string;
  onActiveIdChange?: (id: string) => void;
  className?: string;
}

export default function DynamicSidebar({
  activeId = 'dashboard',
  onActiveIdChange,
  className = ''
}: DynamicSidebarProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [currentActive, setCurrentActive] = useState<string>(activeId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  React.useEffect(() => {
    if (activeId) {
      setCurrentActive(activeId);
    }
  }, [activeId]);

  const navigationItems: SidebarItem[] = [
    { id: 'dashboard', label: 'CRM Dashboard', icon: LayoutDashboard },
    { id: 'deals', label: 'Sales & Leads Pipeline', icon: DollarSign },
    { id: 'greet', label: 'Greet Hub', icon: Video },
    { id: 'messages', label: 'Messaging', icon: MessageSquare },
    { id: 'calendar', label: 'Calendar', icon: Calendar },
    { id: 'proposals', label: 'Proposals', icon: FileText },
    { id: 'social_planner', label: 'Social Planner', icon: Share2 },
    { id: 'gbp', label: 'Local GBP', icon: Globe },
    { id: 'voice_dialer', label: 'Voice Dialer', icon: Phone },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleItemClick = (id: string) => {
    setCurrentActive(id);
    if (onActiveIdChange) {
      onActiveIdChange(id);
    }
  };

  return (
    <motion.div
      id="dynamic-sidebar-container"
      initial={{ width: isExpanded ? 240 : 64 }}
      animate={{ width: isExpanded ? 240 : 64 }}
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className={`relative flex flex-col h-screen select-none obsidian bg-[var(--obsidian-1)] border-r border-[var(--obsidian-line)] text-neutral-300 overflow-hidden ${className}`}
    >
      {/* Sidebar Header with Toggle Icon */}
      <div 
        id="dynamic-sidebar-header" 
        className="h-16 flex items-center justify-between px-4 border-b border-white/5 shrink-0"
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="h-8 w-8 rounded-lg bg-[var(--accent)] flex items-center justify-center shrink-0">
            <LayoutDashboard className="h-4 w-4 text-white" />
          </div>
          <AnimatePresence initial={false}>
            {isExpanded && (
              <motion.div
                id="sidebar-title-motion"
                initial={{ opacity: 0, width: 0, x: -10 }}
                animate={{ opacity: 1, width: 'auto', x: 0 }}
                exit={{ opacity: 0, width: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col whitespace-nowrap"
              >
                <span className="font-sans font-semibold text-[13px] text-white tracking-[-0.01em] block">
                  Obsidian
                </span>
                <span className="text-[11px] text-neutral-500 font-medium">
                  CRM
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Toggle Expand Button */}
        <button
          id="sidebar-collapse-toggle-btn"
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isExpanded ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation list */}
      <nav 
        id="dynamic-sidebar-nav" 
        className="flex-1 py-6 px-3 space-y-2 overflow-y-auto overflow-x-hidden"
      >
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentActive === item.id;

          return (
            <div 
              key={item.id}
              className="relative group"
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <button
                id={`dynamic-sidebar-btn-${item.id}`}
                onClick={() => handleItemClick(item.id)}
                className={`group w-full relative flex items-center px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-white/[0.07] text-white border border-transparent'
                    : 'text-neutral-400 hover:text-neutral-100 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                {/* Subtle vertical accent line on left border on hover or active */}
                <span 
                  id={`sidebar-item-accent-${item.id}`}
                  className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-[var(--accent)] transition-all duration-200 origin-left ${
                    isActive 
                      ? 'scale-y-100 opacity-100' 
                      : 'scale-y-0 opacity-0 group-hover:scale-y-100 group-hover:opacity-100'
                  }`}
                />

                <div className="flex items-center justify-center shrink-0">
                  <Icon 
                    id={`sidebar-icon-${item.id}`}
                    className={`h-4.5 w-4.5 transition-all duration-200 ${
                      isActive 
                        ? 'text-[var(--obsidian-accent)]' 
                        : 'text-neutral-500 group-hover:text-neutral-200'
                    }`} 
                  />
                </div>

                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.span
                      id={`sidebar-item-label-${item.id}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.15 }}
                      className="ml-3 truncate whitespace-nowrap font-sans text-left"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>

              {/* High-fidelity glassmorphic Tooltip for collapsed state */}
              <AnimatePresence>
                {!isExpanded && hoveredId === item.id && (
                  <motion.div
                    id={`sidebar-tooltip-${item.id}`}
                    initial={{ opacity: 0, x: 5, scale: 0.95 }}
                    animate={{ opacity: 1, x: 12, scale: 1 }}
                    exit={{ opacity: 0, x: 5, scale: 0.95 }}
                    transition={{ duration: 0.1 }}
                    className="absolute left-full top-1/2 -translate-y-1/2 z-50 px-3 py-1.5 rounded-lg bg-neutral-950/90 backdrop-blur-md border border-white/10 text-white text-[11px] font-medium tracking-wide shadow-xl shadow-black/40 pointer-events-none whitespace-nowrap font-sans"
                  >
                    {item.label}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      {/* Sidebar Footer with Session Active Indicator */}
      <div 
        id="dynamic-sidebar-footer" 
        className="p-3.5 relative border-t border-white/5 bg-neutral-950/20 shrink-0 select-none"
      >
        <AnimatePresence initial={false}>
          {isExpanded ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between text-[9px] font-mono text-neutral-500"
            >
              <span className="flex items-center gap-1">
                <Clock className="h-2.5 w-2.5 text-emerald-500 animate-pulse" />
                Session Active
              </span>
              <span className="font-bold px-1.5 py-0.5 rounded border text-neutral-400 bg-neutral-900/50 border-white/5">
                Obsidian v2.5
              </span>
            </motion.div>
          ) : (
            <div className="flex justify-center">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
