import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutGrid, Plus, RotateCcw, ArrowUp, ArrowDown, 
  X, GripVertical, Check, Eye, EyeOff, SlidersHorizontal, 
  TrendingUp, Users, DollarSign, Headphones, Maximize2, 
  Minimize2, Sparkles, Filter, ChevronDown, CheckCircle2,
  Columns2, Rows3, RefreshCw
} from 'lucide-react';
import { CRMContact } from '../../types';
import { RecentLeadsWidget } from './RecentLeadsWidget';
import { OpenOpportunitiesWidget } from './OpenOpportunitiesWidget';
import { SupportTicketsWidget } from './SupportTicketsWidget';
import { SalesPerformanceWidget } from './SalesPerformanceWidget';

export type WidgetId = 'recent_leads' | 'open_opportunities' | 'sales_performance' | 'support_tickets';

export interface WidgetConfig {
  id: WidgetId;
  title: string;
  subtitle: string;
  category: 'growth' | 'sales' | 'support' | 'revenue';
  icon: React.ComponentType<{ className?: string }>;
  badgeText: string;
  defaultExpanded?: boolean;
}

export const WIDGET_REGISTRY: Record<WidgetId, WidgetConfig> = {
  recent_leads: {
    id: 'recent_leads',
    title: 'Recent Leads',
    subtitle: 'Newest leads from every channel',
    category: 'growth',
    icon: Users,
    badgeText: 'Leads'
  },
  open_opportunities: {
    id: 'open_opportunities',
    title: 'Open Opportunities',
    subtitle: 'Open deals by stage and weighted forecast',
    category: 'sales',
    icon: DollarSign,
    badgeText: 'Pipeline'
  },
  sales_performance: {
    id: 'sales_performance',
    title: 'Sales Performance',
    subtitle: 'Revenue from won deals and top closers',
    category: 'revenue',
    icon: TrendingUp,
    badgeText: 'Analytics'
  },
  support_tickets: {
    id: 'support_tickets',
    title: 'Support Tickets',
    subtitle: 'Open tickets: reply or mark done',
    category: 'support',
    icon: Headphones,
    badgeText: 'Support'
  }
};

const DEFAULT_ORDER: WidgetId[] = [
  'recent_leads',
  'open_opportunities',
  'sales_performance',
  'support_tickets'
];

interface CustomizableWidgetGridProps {
  contacts: CRMContact[];
  onSelectContact?: (contact: CRMContact) => void;
  onNavigate?: (view: any) => void;
}

export const CustomizableWidgetGrid: React.FC<CustomizableWidgetGridProps> = ({
  contacts,
  onSelectContact,
  onNavigate
}) => {
  // Ordered array of active widget IDs
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>(() => {
    try {
      const saved = localStorage.getItem('obsidian_crm_widget_order_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Filter to only valid registered ids
          return parsed.filter(id => id in WIDGET_REGISTRY);
        }
      }
    } catch {
      // Fallback
    }
    return DEFAULT_ORDER;
  });

  // Array of hidden/removed widget IDs
  const [hiddenWidgets, setHiddenWidgets] = useState<WidgetId[]>(() => {
    try {
      const saved = localStorage.getItem('obsidian_crm_hidden_widgets_v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Fallback
    }
    return ['sales_performance']; // the dashboard's Performance chart covers this by default
  });

  // Layout mode: '2-col' | '1-col'
  const [layoutMode, setLayoutMode] = useState<'2-col' | '1-col'>(() => {
    try {
      const saved = localStorage.getItem('obsidian_crm_layout_mode_v2');
      if (saved === '1-col' || saved === '2-col') return saved;
    } catch {
      // Fallback
    }
    return '2-col';
  });

  // Expanded (full width / solo) widget ID
  const [focusedWidgetId, setFocusedWidgetId] = useState<WidgetId | null>(null);

  // Add Widget Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  
  // Customization drawer/controls toggle
  const [isCustomizeOpen, setIsCustomizeOpen] = useState(false);

  // Undo notification state
  const [lastRemovedWidget, setLastRemovedWidget] = useState<WidgetId | null>(null);

  // Drag and drop state
  const [draggedWidgetId, setDraggedWidgetId] = useState<WidgetId | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<WidgetId | null>(null);

  // Persist order
  useEffect(() => {
    try {
      localStorage.setItem('obsidian_crm_widget_order_v2', JSON.stringify(widgetOrder));
    } catch {
      // Ignore
    }
  }, [widgetOrder]);

  // Persist hidden
  useEffect(() => {
    try {
      localStorage.setItem('obsidian_crm_hidden_widgets_v2', JSON.stringify(hiddenWidgets));
    } catch {
      // Ignore
    }
  }, [hiddenWidgets]);

  // Persist layout
  useEffect(() => {
    try {
      localStorage.setItem('obsidian_crm_layout_mode_v2', layoutMode);
    } catch {
      // Ignore
    }
  }, [layoutMode]);

  // Visible widgets
  const visibleWidgets = useMemo(() => {
    return widgetOrder.filter(id => !hiddenWidgets.includes(id));
  }, [widgetOrder, hiddenWidgets]);

  // Available to add
  const availableToAdd = useMemo(() => {
    return (Object.keys(WIDGET_REGISTRY) as WidgetId[]).filter(
      id => hiddenWidgets.includes(id) || !widgetOrder.includes(id)
    );
  }, [hiddenWidgets, widgetOrder]);

  // Reordering helpers
  const moveWidget = (id: WidgetId, direction: 'up' | 'down') => {
    const currentIndex = widgetOrder.indexOf(id);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= widgetOrder.length) return;

    const newOrder = [...widgetOrder];
    const [moved] = newOrder.splice(currentIndex, 1);
    newOrder.splice(targetIndex, 0, moved);
    setWidgetOrder(newOrder);
  };

  const removeWidget = (id: WidgetId) => {
    setHiddenWidgets(prev => Array.from(new Set([...prev, id])));
    setLastRemovedWidget(id);
    if (focusedWidgetId === id) setFocusedWidgetId(null);
  };

  const addWidget = (id: WidgetId) => {
    setHiddenWidgets(prev => prev.filter(wId => wId !== id));
    if (!widgetOrder.includes(id)) {
      setWidgetOrder(prev => [...prev, id]);
    }
    setLastRemovedWidget(null);
  };

  const undoRemove = () => {
    if (lastRemovedWidget) {
      addWidget(lastRemovedWidget);
      setLastRemovedWidget(null);
    }
  };

  const resetToDefault = () => {
    setWidgetOrder(DEFAULT_ORDER);
    setHiddenWidgets([]);
    setLayoutMode('2-col');
    setFocusedWidgetId(null);
    setLastRemovedWidget(null);
  };

  const applyPreset = (preset: 'executive' | 'sales' | 'support') => {
    if (preset === 'executive') {
      setWidgetOrder(DEFAULT_ORDER);
      setHiddenWidgets([]);
    } else if (preset === 'sales') {
      setWidgetOrder(['recent_leads', 'open_opportunities', 'sales_performance', 'support_tickets']);
      setHiddenWidgets(['support_tickets']);
    } else if (preset === 'support') {
      setWidgetOrder(['support_tickets', 'recent_leads', 'open_opportunities', 'sales_performance']);
      setHiddenWidgets(['sales_performance', 'open_opportunities']);
    }
    setIsCustomizeOpen(false);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, id: WidgetId) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedWidgetId(id);
  };

  const handleDragOver = (e: React.DragEvent, id: WidgetId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverWidgetId !== id) {
      setDragOverWidgetId(id);
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: WidgetId) => {
    e.preventDefault();
    const sourceId = draggedWidgetId;
    setDraggedWidgetId(null);
    setDragOverWidgetId(null);

    if (!sourceId || sourceId === targetId) return;

    const sourceIdx = widgetOrder.indexOf(sourceId);
    const targetIdx = widgetOrder.indexOf(targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const newOrder = [...widgetOrder];
    const [removed] = newOrder.splice(sourceIdx, 1);
    newOrder.splice(targetIdx, 0, removed);
    setWidgetOrder(newOrder);
  };

  // Render individual widget component
  const renderWidgetContent = (id: WidgetId) => {
    switch (id) {
      case 'recent_leads':
        return (
          <RecentLeadsWidget 
            contacts={contacts} 
            onSelectContact={onSelectContact} 
            onNavigate={onNavigate} 
          />
        );
      case 'open_opportunities':
        return (
          <OpenOpportunitiesWidget 
            onNavigate={onNavigate} 
          />
        );
      case 'sales_performance':
        return (
          <SalesPerformanceWidget 
            onNavigate={onNavigate} 
          />
        );
      case 'support_tickets':
        return (
          <SupportTicketsWidget 
            onNavigate={onNavigate} 
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full flex flex-col gap-4 font-sans">
      
      {/* 1. SECTION HEADER & CONTROLS */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 sm:px-2">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center text-[var(--accent-text)]">
            <LayoutGrid className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold text-[var(--text)] tracking-[-0.01em]">
                Work queues
              </h2>
            </div>
            <p className="text-[12px] text-[var(--text-muted)]">
              Act on leads, move deals forward and answer tickets. Add, remove and rearrange widgets.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Layout Column Toggle */}
          <div className="obsidian flex items-center bg-[var(--obsidian-0)] border border-white/10 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setLayoutMode('2-col')}
              className={`p-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                layoutMode === '2-col'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-white'
              }`}
              title="2-Column Grid View"
            >
              <Columns2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline text-[11px]">2-Col</span>
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('1-col')}
              className={`p-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                layoutMode === '1-col'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-white'
              }`}
              title="1-Column Focused View"
            >
              <Rows3 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline text-[11px]">1-Col</span>
            </button>
          </div>

          {/* Customize Layout Presets Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsCustomizeOpen(!isCustomizeOpen)}
              className="obsidian px-3 py-1.5 rounded-xl bg-[var(--obsidian-0)] hover:bg-[var(--obsidian-2)] border border-white/10 text-xs font-medium text-neutral-200 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-indigo-400" />
              <span>Presets</span>
              <ChevronDown className="h-3 w-3 text-neutral-400" />
            </button>

            {isCustomizeOpen && (
              <div className="absolute right-0 mt-2 w-52 rounded-xl bg-slate-900/95 backdrop-blur-xl border border-white/10 shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 px-2 py-1 font-bold">
                  Dashboard Presets
                </div>
                <button
                  type="button"
                  onClick={() => applyPreset('executive')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-neutral-200 hover:bg-white/5 transition flex items-center justify-between"
                >
                  <span>Executive All (4)</span>
                  <span className="text-[10px] font-mono text-indigo-400">All</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('sales')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-neutral-200 hover:bg-white/5 transition flex items-center justify-between"
                >
                  <span>Sales Velocity</span>
                  <span className="text-[10px] font-mono text-emerald-400">3 Widgets</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('support')}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-neutral-200 hover:bg-white/5 transition flex items-center justify-between"
                >
                  <span>Support & Triage</span>
                  <span className="text-[10px] font-mono text-amber-400">2 Widgets</span>
                </button>
                <div className="my-1 border-t border-white/5" />
                <button
                  type="button"
                  onClick={() => {
                    resetToDefault();
                    setIsCustomizeOpen(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white hover:bg-white/5 transition flex items-center gap-1.5"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset Default Order</span>
                </button>
              </div>
            )}
          </div>

          {/* Add Widget Button */}
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all hover:scale-[1.02] active:scale-98 flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Widget</span>
            {availableToAdd.length > 0 && (
              <span className="h-4 min-w-[16px] px-1 rounded-full bg-white/20 text-[10px] font-mono font-bold flex items-center justify-center">
                {availableToAdd.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 2. UNDO NOTIFICATION BANNER */}
      {lastRemovedWidget && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-neutral-900/90 border border-amber-500/30 text-xs text-neutral-200 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-bold">Removed Widget:</span>
            <span>{WIDGET_REGISTRY[lastRemovedWidget].title}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={undoRemove}
              className="text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer transition underline underline-offset-2"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={() => setLastRemovedWidget(null)}
              className="text-neutral-500 hover:text-white p-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 3. WIDGET GRID CONTAINER */}
      {visibleWidgets.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-[#0B0C12]/90 border border-white/10 backdrop-blur-xl flex flex-col items-center justify-center">
          <div className="h-12 w-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-neutral-400 mb-3">
            <LayoutGrid className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-white">All Dashboard Widgets Are Hidden</h3>
          <p className="text-xs text-neutral-400 max-w-sm mt-1 mb-4">
            Restore the default widgets or pick the ones you want.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={resetToDefault}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg transition"
            >
              Restore All Default Widgets
            </button>
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-200 text-xs font-semibold border border-white/10 transition"
            >
              Browse Widgets
            </button>
          </div>
        </div>
      ) : (
        <div 
          className={`grid gap-5 transition-all duration-300 ${
            focusedWidgetId 
              ? 'grid-cols-1' 
              : layoutMode === '2-col' 
              ? 'grid-cols-1 lg:grid-cols-2' 
              : 'grid-cols-1'
          }`}
        >
          {visibleWidgets
            .filter(id => !focusedWidgetId || focusedWidgetId === id)
            .map((id, index) => {
              const config = WIDGET_REGISTRY[id];
              const Icon = config.icon;
              const isFirst = index === 0;
              const isLast = index === visibleWidgets.length - 1;
              const isDragging = draggedWidgetId === id;
              const isDragOver = dragOverWidgetId === id;

              return (
                <div
                  key={id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, id)}
                  onDragOver={(e) => handleDragOver(e, id)}
                  onDrop={(e) => handleDrop(e, id)}
                  className={`relative rounded-3xl bg-[#0B0C12]/95 backdrop-blur-2xl border transition-all duration-200 flex flex-col min-h-[420px] p-5 sm:p-6 shadow-[0_20px_50px_rgba(0,0,0,0.85)] group ${
                    isDragOver 
                      ? 'border-indigo-500 ring-2 ring-indigo-500/30 scale-[1.01]' 
                      : 'border-white/10 hover:border-white/20'
                  } ${isDragging ? 'opacity-40' : 'opacity-100'}`}
                >
                  {/* Subtle Obsidian Top Ambient Radial Light */}
                  <div className="absolute top-0 right-0 w-44 h-44 rounded-full bg-indigo-500/5 blur-3xl pointer-events-none" />

                  {/* Widget Card Control Bar */}
                  <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-white/5">
                    {/* Drag Handle & Title */}
                    <div className="flex items-center gap-2 min-w-0">
                      <div 
                        className="cursor-grab active:cursor-grabbing text-neutral-500 hover:text-neutral-300 p-1 -ml-1 rounded transition"
                        title="Drag to reorder widget"
                      >
                        <GripVertical className="h-4 w-4" />
                      </div>

                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-6 w-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-neutral-300 shrink-0">
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <span className="text-xs font-bold text-neutral-300 font-mono tracking-tight truncate">
                          {config.badgeText}
                        </span>
                      </div>
                    </div>

                    {/* Interactive Rearrange, Maximize & Close buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Move Up/Left */}
                      <button
                        type="button"
                        disabled={isFirst}
                        onClick={() => moveWidget(id, 'up')}
                        className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                          isFirst 
                            ? 'text-neutral-600 border-transparent cursor-not-allowed opacity-40' 
                            : 'text-neutral-400 hover:text-white border-white/5 hover:bg-white/5'
                        }`}
                        title="Move widget up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>

                      {/* Move Down/Right */}
                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => moveWidget(id, 'down')}
                        className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                          isLast 
                            ? 'text-neutral-600 border-transparent cursor-not-allowed opacity-40' 
                            : 'text-neutral-400 hover:text-white border-white/5 hover:bg-white/5'
                        }`}
                        title="Move widget down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>

                      {/* Solo Focus / Maximize */}
                      <button
                        type="button"
                        onClick={() => setFocusedWidgetId(focusedWidgetId === id ? null : id)}
                        className={`p-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
                          focusedWidgetId === id
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'text-neutral-400 hover:text-white border-white/5 hover:bg-white/5'
                        }`}
                        title={focusedWidgetId === id ? "Restore grid view" : "Maximize widget"}
                      >
                        {focusedWidgetId === id ? (
                          <Minimize2 className="h-3.5 w-3.5" />
                        ) : (
                          <Maximize2 className="h-3.5 w-3.5" />
                        )}
                      </button>

                      {/* Remove Widget */}
                      <button
                        type="button"
                        onClick={() => removeWidget(id)}
                        className="p-1.5 rounded-lg border border-white/5 text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 text-xs transition-colors cursor-pointer"
                        title="Remove widget from dashboard"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Widget Body */}
                  <div className="flex-1 w-full min-h-0">
                    {renderWidgetContent(id)}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* 4. ADD WIDGET MODAL / DRAWER */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
          <div className="obsidian w-full max-w-xl rounded-3xl bg-[var(--obsidian-0)] border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.9)] p-6 text-white select-none">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Plus className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Add Dashboard Widgets</h3>
                  <p className="text-xs text-neutral-400">Choose which widgets to show on your dashboard.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 py-4 max-h-[60vh] overflow-y-auto">
              {(Object.keys(WIDGET_REGISTRY) as WidgetId[]).map((id) => {
                const config = WIDGET_REGISTRY[id];
                const Icon = config.icon;
                const isCurrentlyActive = visibleWidgets.includes(id);

                return (
                  <div
                    key={id}
                    className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                      isCurrentlyActive
                        ? 'bg-white/[0.02] border-white/5 opacity-70'
                        : 'bg-white/[0.04] border-white/10 hover:border-white/20 hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-neutral-200 shrink-0">
                        <Icon className="h-5 w-5 text-indigo-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">{config.title}</span>
                          <span className="text-[10px] font-mono text-neutral-400 uppercase bg-white/5 px-1.5 py-0.5 rounded">
                            {config.badgeText}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-400 mt-0.5 truncate">{config.subtitle}</p>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isCurrentlyActive ? (
                        <button
                          type="button"
                          onClick={() => removeWidget(id)}
                          className="px-3 py-1.5 rounded-xl border border-white/10 bg-white/5 text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 text-xs font-medium transition cursor-pointer"
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addWidget(id)}
                          className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition cursor-pointer flex items-center gap-1"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Add to View</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
              <button
                type="button"
                onClick={resetToDefault}
                className="text-xs text-neutral-400 hover:text-white transition flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Restore All 4 Default Widgets</span>
              </button>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default CustomizableWidgetGrid;
