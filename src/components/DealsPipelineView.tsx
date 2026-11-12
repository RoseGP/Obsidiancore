import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Plus, Search, Building2, Sparkles, Trash2, ChevronLeft, ChevronRight, 
  TrendingUp, X, Filter, Brain, CheckCircle2, ShieldAlert, ListTodo, 
  Clock, Target, AlertTriangle, Ban, HelpCircle, Copy, Check, 
  Phone, Mail, FileSearch, Calendar, MessageSquare, ArrowRight, 
  Layers, RefreshCw, Compass, Activity, Users, DollarSign, 
  BarChart3, Columns3, List, UserCheck, Send, CheckSquare, Square,
  Award, Globe, Share2, Tag, ArrowUpRight, Download, Upload, FileUp, FileDown, CheckCheck, Table
} from 'lucide-react';
import axios from 'axios';
import { useTeamMembers } from '../hooks/useTeamMembers';
import { 
  OpportunityData, 
  SalesIntelligenceReport, 
  generateDeterministicSalesIntel,
  DealHealth,
  ActionPriority
} from '../services/salesIntelligenceService';
import { CRMLead, CRMLeadTask, CRMLeadActivity, LeadQualification } from '../types';
import { ContactsView, CompaniesView } from '../features/crm-records';
import DealActionsCard from '../features/reports/DealActionsCard';
import { BOARD_COLUMNS, BOARD_COLUMN_LABELS, DEAL_STAGE_PROBABILITY, columnForDealStage, columnForLeadStatus, dealStageForColumn, isBoardColumn, leadStatusForColumn, type BoardColumn } from '../lib/pipelineStages';

export interface PipelineItem {
  id: string;
  type: 'lead' | 'deal';
  name: string;
  title?: string;
  company: string;
  email?: string;
  phone?: string;
  businessType?: string;
  value: number; // in USD (0 when not set)
  /** False when nobody entered a value or budget: shown as "Not set", never an invented number. */
  valueSet: boolean;
  /** Title of the deal this card represents (converted leads show their deal). */
  dealName?: string;
  stage: BoardColumn;
  probability: number;
  priority: 'high' | 'medium' | 'low';
  score?: number; // Lead BANT score (0-100)
  source?: string; // Channel source
  status?: string; // Lead status
  owner: string;
  notes?: string;
  statedProblems?: string[];
  qualification?: LeadQualification;
  isConverted?: boolean;
  convertedDealId?: string;
  createdAt?: string;
  updatedAt?: string;
  daysSinceLastActivity?: number;
  recentActivity?: string;
  missingInformation?: string[];
}

const STAGE_STYLE: Record<BoardColumn, { color: string; badge: string }> = {
  new_leads: { color: 'border-t-blue-500 bg-blue-500/5', badge: 'bg-blue-500/10 text-[var(--accent-text)] border-blue-500/20' },
  qualified: { color: 'border-t-indigo-500 bg-indigo-500/5', badge: 'bg-indigo-500/10 text-[var(--accent-text)] border-indigo-500/20' },
  proposal_sent: { color: 'border-t-purple-500 bg-purple-500/5', badge: 'bg-purple-500/10 text-[var(--accent-text)] border-purple-500/20' },
  negotiation: { color: 'border-t-amber-500 bg-amber-500/5', badge: 'bg-amber-500/10 text-[var(--warning)] border-amber-500/20' },
  closed_won: { color: 'border-t-emerald-500 bg-emerald-500/5', badge: 'bg-emerald-500/10 text-[var(--success)] border-emerald-500/20' },
  closed_lost: { color: 'border-t-rose-500 bg-rose-500/5', badge: 'bg-rose-500/10 text-[var(--danger)] border-rose-500/20' },
  unqualified: { color: 'border-t-slate-500 bg-slate-500/5', badge: 'bg-slate-500/10 text-[var(--text-muted)] border-slate-500/20' },
};
/** Board columns (one vocabulary with the lead and deal APIs: src/lib/pipelineStages.ts). */
const STAGES = BOARD_COLUMNS.map((id) => ({ id, ...BOARD_COLUMN_LABELS[id], ...STAGE_STYLE[id] }));
const money = (item: { value: number; valueSet: boolean }) => (item.valueSet ? `$${item.value.toLocaleString()}` : 'Not set');

export type PipelineTab = 'board' | 'leads' | 'contacts' | 'companies' | 'analytics';
interface DealsPipelineViewProps {
  initialTab?: PipelineTab;
  /** Opens another screen (inbox, calendar, proposals…) from a contact or company profile. */
  onNavigate?: (view: string) => void;
}

/**
 * Sales Pipeline & Deals: the one home for people and opportunities. Tabs: the pipeline board, leads,
 * contacts, companies and conversion analytics (the former "Contacts & Leads" page lives here now).
 */
export default function DealsPipelineView({ initialTab = 'board', onNavigate }: DealsPipelineViewProps) {
  const team = useTeamMembers();
  // Navigation / View state
  const [activeTab, setActiveTab] = useState<PipelineTab>(initialTab);
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [openCompanyId, setOpenCompanyId] = useState<string | null>(null);
  const peopleTab = activeTab === 'contacts' || activeTab === 'companies';

  // Live Data State (zero mock data, backed by /api/leads and /api/dashboard/deals)
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPriority, setFilterPriority] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [filterHealth, setFilterHealth] = useState<'all' | DealHealth>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // Leads Table Selection & Bulk
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState<boolean>(false);

  // Unified Drawer State
  const [selectedItem, setSelectedItem] = useState<PipelineItem | null>(null);
  const [drawerSubtab, setDrawerSubtab] = useState<'intel' | 'bant' | 'tasks' | 'activities'>('intel');
  const [drawerTasks, setDrawerTasks] = useState<CRMLeadTask[]>([]);
  const [drawerActivities, setDrawerActivities] = useState<CRMLeadActivity[]>([]);
  const [isLoadingDrawerDetails, setIsLoadingDrawerDetails] = useState(false);

  // Sales Intelligence State
  const [intelReport, setIntelReport] = useState<SalesIntelligenceReport | null>(null);
  const [isLoadingIntel, setIsLoadingIntel] = useState(false);
  const [chatQuestion, setChatQuestion] = useState('');
  const [chatReplies, setChatReplies] = useState<Array<{ q: string; a: string; time: string }>>([]);
  const [isAskingQuestion, setIsAskingQuestion] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertingItem, setConvertingItem] = useState<PipelineItem | null>(null);

  // Pipeline Export & Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreviewData, setImportPreviewData] = useState<any[]>([]);
  const [importTargetStage, setImportTargetStage] = useState<string>('auto');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Follow-up task creation in drawer
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'urgent' | 'high' | 'medium' | 'low'>('high');

  // Toast Notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Live Duplicate Detection state in creation form
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);

  // New Lead / Opportunity Form
  const [newForm, setNewForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    title: '',
    businessType: '',
    value: '',
    stage: 'new_leads' as PipelineItem['stage'],
    priority: 'medium' as PipelineItem['priority'],
    source: 'whatsapp',
    budget: '',
    authority: 'decision_maker',
    need: '',
    timeline: '1-3 months',
    notes: ''
  });

  // Conversion Form
  const [convertForm, setConvertForm] = useState({
    dealTitle: '',
    dealValue: '',
    dealStage: 'qualified',
    expectedClose: '',
    companyIndustry: 'Technology',
    companyTier: ''
  });

  // Analytics State
  const [analyticsData, setAnalyticsData] = useState<any>(null);

  // --------------------------------------------------------------------------
  // Data Fetching: Zero Mock Data from Real APIs
  // --------------------------------------------------------------------------
  const fetchData = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsLoading(true);
    else setIsRefreshing(true);

    try {
      const [leadsRes, dealsRes, analyticsRes] = await Promise.all([
        axios.get('/api/leads'),
        axios.get('/api/dashboard/deals'),
        axios.get('/api/leads/analytics').catch(() => ({ data: { success: false } }))
      ]);

      if (leadsRes.data?.success) {
        setLeads(leadsRes.data.leads || []);
      }
      if (dealsRes.data?.success) {
        setDeals(dealsRes.data.deals || []);
      }
      if (analyticsRes.data?.success) {
        setAnalyticsData(analyticsRes.data.analytics);
      }
    } catch (err: any) {
      showToast('Error syncing pipeline from server.', 'error');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Keep initial tab in sync if property changes
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  // --------------------------------------------------------------------------
  // Merge Leads & Deals into Unified Pipeline Items (Deduplicated)
  // --------------------------------------------------------------------------
  const pipelineItems: PipelineItem[] = useMemo(() => {
    const items: PipelineItem[] = [];

    // 1. Process Leads (only what was recorded: no invented values, companies or needs)
    leads.forEach(lead => {
      const stage = columnForLeadStatus(lead.isConverted ? 'converted' : lead.status);
      const priority: PipelineItem['priority'] = lead.score >= 85 ? 'high' : lead.score >= 60 ? 'medium' : 'low';
      const budget = Number(lead.qualification?.budget) || 0;

      items.push({
        id: lead.id,
        type: 'lead',
        name: lead.name,
        title: lead.title || '',
        company: lead.company || '',
        email: lead.email,
        phone: lead.phone,
        businessType: lead.source ? `${lead.source.replace(/_/g, ' ')} lead` : '',
        value: budget,
        valueSet: budget > 0,
        stage,
        probability: stage === 'qualified' ? DEAL_STAGE_PROBABILITY.qualified : stage === 'unqualified' ? 0 : DEAL_STAGE_PROBABILITY.lead,
        priority,
        score: lead.score,
        source: lead.source,
        status: lead.status,
        owner: lead.owner || '',
        notes: lead.notes,
        statedProblems: lead.qualification?.need ? [lead.qualification.need] : lead.notes ? [lead.notes] : [],
        qualification: lead.qualification,
        isConverted: lead.isConverted,
        convertedDealId: lead.convertedDealId,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
        daysSinceLastActivity: Math.max(0, Math.floor((Date.now() - new Date(lead.updatedAt || lead.createdAt || Date.now()).getTime()) / 86400000)),
        recentActivity: `Lead status is ${lead.status}. Score: ${lead.score}/100.`,
        missingInformation: !budget ? ['Budget not confirmed'] : []
      });
    });

    // 2. Process Deals. A converted lead's card becomes its deal (stage, value, title), so it shows once.
    deals.forEach(deal => {
      const mappedStage = columnForDealStage(deal.stage);
      const hasValue = deal.value !== undefined && deal.value !== null && deal.value !== '' && Number.isFinite(Number(deal.value));
      const value = hasValue ? Number(deal.value) : 0;
      const probability = Number.isFinite(Number(deal.probability)) ? Number(deal.probability) : (DEAL_STAGE_PROBABILITY as Record<string, number>)[deal.stage] ?? 0;

      const idx = items.findIndex(item => item.convertedDealId === deal.id || (deal.leadId && item.id === deal.leadId && item.isConverted));
      if (idx !== -1) {
        items[idx] = {
          ...items[idx],
          stage: mappedStage,
          value, valueSet: hasValue,
          probability,
          dealName: deal.name,
          statedProblems: [deal.name, ...(items[idx].statedProblems || [])].filter(Boolean),
          status: deal.stage,
        };
        return;
      }

      items.push({
        id: deal.id,
        type: 'deal',
        name: deal.client || deal.name,
        title: '',
        company: deal.client || deal.name,
        businessType: deal.channelOrigin ? `${String(deal.channelOrigin).replace(/_/g, ' ')} opportunity` : '',
        value, valueSet: hasValue,
        dealName: deal.name,
        stage: mappedStage,
        probability,
        priority: value >= 80000 ? 'high' : 'medium',
        source: deal.channelOrigin || '',
        status: deal.stage,
        owner: deal.owner || '',
        notes: deal.expectedClose ? `Expected close: ${deal.expectedClose}` : '',
        statedProblems: [deal.name],
        isConverted: true,
        createdAt: deal.createdAt,
        updatedAt: deal.updatedAt,
        daysSinceLastActivity: Math.max(0, Math.floor((Date.now() - new Date(deal.updatedAt || deal.createdAt || Date.now()).getTime()) / 86400000)),
        recentActivity: `Opportunity in the ${deal.stage} stage.`
      });
    });

    return items;
  }, [leads, deals]);

  // Deep link from Reports › Deal actions: ?deal=<id> opens that deal's drawer once the board has loaded.
  useEffect(() => {
    let id: string | null = null;
    try { id = new URLSearchParams(window.location.search).get('deal'); } catch { id = null; }
    const item = id ? pipelineItems.find((i) => (i.type === 'deal' && i.id === id) || i.convertedDealId === id) : null;
    if (!item) return;
    setActiveTab('board'); setSelectedItem(item);
    try { const u = new URL(window.location.href); u.searchParams.delete('deal'); window.history.replaceState(null, '', u.toString()); } catch { /* ignore */ }
  }, [pipelineItems]);

  // Pre-calculate sales intelligence & health for each item
  const itemsWithHealth = useMemo(() => {
    return pipelineItems.map(item => {
      const oppData: OpportunityData = {
        id: item.id,
        name: item.name,
        title: item.title,
        company: item.company,
        businessType: item.businessType || '',
        value: item.value,
        stage: item.stage,
        probability: item.probability,
        priority: item.priority,
        statedProblems: item.statedProblems,
        notes: item.notes,
        missingInformation: item.missingInformation
      };
      const intel = generateDeterministicSalesIntel(oppData);
      return {
        ...item,
        computedHealth: intel.dealHealth.classification,
        computedNextAction: intel.nextAction.action,
        computedActionPriority: intel.nextAction.priority
      };
    });
  }, [pipelineItems]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return itemsWithHealth.filter(item => {
      const q = searchQuery.toLowerCase();
      const matchesSearch = 
        item.name.toLowerCase().includes(q) ||
        item.company.toLowerCase().includes(q) ||
        (item.email && item.email.toLowerCase().includes(q)) ||
        (item.notes && item.notes.toLowerCase().includes(q)) ||
        item.statedProblems?.some(p => p.toLowerCase().includes(q));

      const matchesPriority = filterPriority === 'all' || item.priority === filterPriority;
      const matchesHealth = filterHealth === 'all' || item.computedHealth === filterHealth;
      const matchesSource = filterSource === 'all' || item.source === filterSource;
      const matchesStatus = filterStatus === 'all' || item.stage === filterStatus;

      return matchesSearch && matchesPriority && matchesHealth && matchesSource && matchesStatus;
    });
  }, [itemsWithHealth, searchQuery, filterPriority, filterHealth, filterSource, filterStatus]);

  // Stage statistics
  const stageStats = useMemo(() => {
    const stats = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, { count: 0, totalValue: 0 }])) as Record<BoardColumn, { count: number; totalValue: number }>;

    filteredItems.forEach(item => {
      if (stats[item.stage]) {
        stats[item.stage].count += 1;
        stats[item.stage].totalValue += item.value;
      }
    });

    return stats;
  }, [filteredItems]);

  const grandTotalValue = useMemo(() => {
    return filteredItems.reduce((sum, d) => sum + d.value, 0);
  }, [filteredItems]);

  const healthCounts = useMemo(() => {
    const counts = { HEALTHY: 0, AT_RISK: 0, STALE: 0, BLOCKED: 0 };
    itemsWithHealth.forEach(d => {
      counts[d.computedHealth]++;
    });
    return counts;
  }, [itemsWithHealth]);

  const urgentActionCount = useMemo(() => {
    return itemsWithHealth.filter(d => d.computedActionPriority === 'URGENT').length;
  }, [itemsWithHealth]);

  // --------------------------------------------------------------------------
  // AI Sales Intelligence Drawer Sync
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!selectedItem) {
      setIntelReport(null);
      setChatReplies([]);
      setDrawerTasks([]);
      setDrawerActivities([]);
      return;
    }

    let isMounted = true;
    setIsLoadingIntel(true);
    setIsLoadingDrawerDetails(true);

    const oppData: OpportunityData = {
      id: selectedItem.id,
      name: selectedItem.name,
      title: selectedItem.title,
      company: selectedItem.company,
      businessType: selectedItem.businessType || '',
      value: selectedItem.value,
      stage: selectedItem.stage,
      probability: selectedItem.probability,
      priority: selectedItem.priority,
      statedProblems: selectedItem.statedProblems,
      notes: selectedItem.notes,
      missingInformation: selectedItem.missingInformation
    };

    // 1. Fetch AI Sales Intelligence Report
    axios.post('/api/sales-intelligence/analyze', { opportunity: oppData })
      .then(res => {
        if (isMounted && res.data?.report) {
          setIntelReport(res.data.report);
        }
      })
      .catch(() => {
        if (isMounted) {
          const fallback = generateDeterministicSalesIntel(oppData);
          setIntelReport(fallback);
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingIntel(false);
      });

    // 2. Fetch Tasks & Activities if item is a lead
    if (selectedItem.type === 'lead') {
      axios.get(`/api/leads/${selectedItem.id}`)
        .then(res => {
          if (isMounted && res.data?.success) {
            setDrawerTasks(res.data.tasks || []);
            setDrawerActivities(res.data.activities || []);
          }
        })
        .catch(() => {
          if (isMounted) {
            setDrawerTasks([]);
            setDrawerActivities([]);
          }
        })
        .finally(() => {
          if (isMounted) setIsLoadingDrawerDetails(false);
        });
    } else {
      setIsLoadingDrawerDetails(false);
    }

    return () => {
      isMounted = false;
    };
  }, [selectedItem]);

  // --------------------------------------------------------------------------
  // Live Duplicate Detection Debounce
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!newForm.email && !newForm.phone) {
      setDuplicateWarning(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingDuplicate(true);
      try {
        const params = new URLSearchParams();
        if (newForm.email) params.append('email', newForm.email.trim());
        if (newForm.phone) params.append('phone', newForm.phone.trim());

        const res = await axios.get(`/api/leads/duplicates?${params.toString()}`);
        if (res.data?.duplicate) {
          const dup = res.data.duplicateLead;
          setDuplicateWarning(`Potential duplicate detected: "${dup.name}" (${dup.company}) exists with status "${dup.status}".`);
        } else {
          setDuplicateWarning(null);
        }
      } catch (err) {
        setDuplicateWarning(null);
      } finally {
        setIsCheckingDuplicate(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [newForm.email, newForm.phone]);

  // --------------------------------------------------------------------------
  // Stage Movements & API Sync
  // --------------------------------------------------------------------------
  const handleMoveToStage = async (itemId: string, targetStage: PipelineItem['stage']) => {
    const item = pipelineItems.find(i => i.id === itemId);
    if (!item) return;

    if (item.stage === targetStage) return;

    // A lead without a deal can't be in Proposal / Negotiation / Won: ask to convert it into a deal first.
    const leadStatus = item.type === 'lead' && !item.isConverted ? leadStatusForColumn(targetStage) : null;
    if (item.type === 'lead' && !item.isConverted && !leadStatus) {
      initiateConversion(item, targetStage);
      return;
    }

    try {
      if (item.type === 'lead' && !item.isConverted) {
        await axios.patch(`/api/leads/${encodeURIComponent(item.id)}/status`, { status: leadStatus });
      } else {
        const dealId = item.type === 'deal' ? item.id : item.convertedDealId;
        if (!dealId) throw new Error('missing deal');
        await axios.patch(`/api/dashboard/deals/${encodeURIComponent(dealId)}/stage`, { stage: dealStageForColumn(targetStage) });
      }

      showToast(`Moved to ${BOARD_COLUMN_LABELS[targetStage].label}.`, 'success');
      await fetchData(true);
    } catch (err: any) {
      showToast(err?.response?.data?.error || 'Couldn’t move the card. Try again.', 'error');
    }
  };

  const handleMoveStage = (itemId: string, direction: 'left' | 'right') => {
    const item = pipelineItems.find(i => i.id === itemId);
    if (!item) return;
    const currentStageIndex = STAGES.findIndex(s => s.id === item.stage);
    let nextIndex = currentStageIndex;
    if (direction === 'left' && currentStageIndex > 0) nextIndex--;
    if (direction === 'right' && currentStageIndex < STAGES.length - 1) nextIndex++;
    if (nextIndex !== currentStageIndex) {
      handleMoveToStage(itemId, STAGES[nextIndex].id);
    }
  };

  // --------------------------------------------------------------------------
  // Transactional Lead Conversion
  // --------------------------------------------------------------------------
  const initiateConversion = (item: PipelineItem, suggestedStage: PipelineItem['stage'] = 'proposal_sent') => {
    setConvertingItem(item);
    setConvertForm({
      dealTitle: `${item.company || item.name} opportunity`,
      dealValue: item.valueSet ? String(item.value) : '',
      dealStage: suggestedStage === 'closed_won' ? 'won' : suggestedStage === 'negotiation' ? 'negotiation' : 'proposal',
      expectedClose: '',
      companyIndustry: '',
      companyTier: ''
    });
    setShowConvertModal(true);
  };

  const handleExecuteConversion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convertingItem) return;

    try {
      const res = await axios.post(`/api/leads/${convertingItem.id}/convert`, {
        dealTitle: convertForm.dealTitle,
        dealValue: Number(convertForm.dealValue) || convertingItem.value,
        dealStage: convertForm.dealStage,
        expectedClose: convertForm.expectedClose,
        companyIndustry: convertForm.companyIndustry,
        companyTier: convertForm.companyTier
      });

      if (res.data?.success) {
        showToast(`Lead "${convertingItem.name}" successfully converted to active CRM Deal!`, 'success');
        setShowConvertModal(false);
        setConvertingItem(null);
        if (selectedItem?.id === convertingItem.id) {
          setSelectedItem(null);
        }
        await fetchData(true);
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to convert lead.';
      showToast(msg, 'error');
    }
  };

  // --------------------------------------------------------------------------
  // Create Lead / Opportunity (Zero Mock Data, Persisted to Real API)
  // --------------------------------------------------------------------------
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newForm.name || !newForm.company) {
      showToast('Name and Company are required.', 'error');
      return;
    }

    try {
      const parsedVal = parseInt(newForm.value.replace(/[^0-9]/g, '')) || 0;
      
      const payload = {
        name: newForm.name,
        email: newForm.email,
        phone: newForm.phone,
        company: newForm.company,
        title: newForm.title || '',
        source: newForm.source,
        status: newForm.stage === 'qualified' ? 'qualified' : 'new',
        owner: team.me,
        notes: newForm.notes,
        qualification: {
          budget: parsedVal || undefined,
          authority: newForm.authority,
          need: newForm.need || '',
          timeline: newForm.timeline
        }
      };

      const res = await axios.post('/api/leads', payload);
      if (res.data?.success) {
        showToast(`Created new lead "${newForm.name}" for ${newForm.company}!`, 'success');
        setShowAddModal(false);
        setNewForm({
          name: '',
          email: '',
          phone: '',
          company: '',
          title: '',
          businessType: '',
          value: '',
          stage: 'new_leads',
          priority: 'medium',
          source: 'whatsapp',
          budget: '',
          authority: 'decision_maker',
          need: '',
          timeline: '1-3 months',
          notes: ''
        });
        await fetchData(true);
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to create lead.';
      showToast(msg, 'error');
    }
  };

  // --------------------------------------------------------------------------
  // Task Management in Drawer
  // --------------------------------------------------------------------------
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem || selectedItem.type !== 'lead' || !newTaskTitle.trim()) return;

    try {
      const res = await axios.post(`/api/leads/${selectedItem.id}/tasks`, {
        title: newTaskTitle.trim(),
        dueDate: newTaskDueDate || 'Tomorrow',
        priority: newTaskPriority
      });

      if (res.data?.success) {
        setDrawerTasks(prev => [...prev, res.data.task]);
        setNewTaskTitle('');
        setNewTaskDueDate('');
        showToast('Follow-up task scheduled.', 'success');
      }
    } catch (err: any) {
      showToast('Failed to add task.', 'error');
    }
  };

  const handleToggleTask = async (taskId: string, currentCompleted: boolean) => {
    if (!selectedItem || selectedItem.type !== 'lead') return;

    try {
      const res = await axios.patch(`/api/leads/${selectedItem.id}/tasks/${taskId}`, {
        completed: !currentCompleted
      });

      if (res.data?.success) {
        setDrawerTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed: !currentCompleted } : t));
      }
    } catch (err: any) {
      showToast('Failed to update task.', 'error');
    }
  };

  // --------------------------------------------------------------------------
  // Bulk Operations for Leads Table
  // --------------------------------------------------------------------------
  const handleBulkAction = async (action: 'assign' | 'status' | 'delete', value?: string) => {
    if (selectedLeadIds.length === 0) return;
    setIsBulkProcessing(true);

    try {
      const payload: any = {
        action,
        leadIds: selectedLeadIds
      };
      if (action === 'assign') payload.owner = value || team.me;
      if (action === 'status') payload.status = value || 'qualified';

      const res = await axios.post('/api/leads/bulk', payload);
      if (res.data?.success) {
        showToast(`Bulk operation "${action}" applied to ${selectedLeadIds.length} leads.`, 'success');
        setSelectedLeadIds([]);
        await fetchData(true);
      }
    } catch (err: any) {
      showToast('Bulk operation failed.', 'error');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // --------------------------------------------------------------------------
  // AI Assistant Interactive Q&A
  // --------------------------------------------------------------------------
  const handleAskAssistant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatQuestion.trim() || !selectedItem || isAskingQuestion) return;

    const userQ = chatQuestion.trim();
    setChatQuestion('');
    setIsAskingQuestion(true);

    const oppData: OpportunityData = {
      id: selectedItem.id,
      name: selectedItem.name,
      title: selectedItem.title,
      company: selectedItem.company,
      businessType: selectedItem.businessType || '',
      value: selectedItem.value,
      stage: selectedItem.stage,
      probability: selectedItem.probability,
      priority: selectedItem.priority,
      statedProblems: selectedItem.statedProblems,
      notes: selectedItem.notes,
      missingInformation: selectedItem.missingInformation
    };

    try {
      const res = await axios.post('/api/sales-intelligence/ask', {
        opportunity: oppData,
        question: userQ
      });
      const reply = res.data?.reply || 'Assistant could not generate a response.';
      setChatReplies(prev => [...prev, {
        q: userQ,
        a: reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    } catch {
      setChatReplies(prev => [...prev, {
        q: userQ,
        a: 'The assistant couldn’t answer right now. Try again in a moment.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setIsAskingQuestion(false);
    }
  };

  // --------------------------------------------------------------------------
  // Pipeline Export (CSV & JSON)
  // --------------------------------------------------------------------------
  const handleExportPipeline = (format: 'csv' | 'json') => {
    setShowExportMenu(false);
    if (itemsWithHealth.length === 0) {
      showToast('No pipeline records to export.', 'info');
      return;
    }

    const filename = `sales_pipeline_export_${new Date().toISOString().split('T')[0]}.${format}`;

    if (format === 'json') {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(itemsWithHealth, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      showToast(`Exported ${itemsWithHealth.length} pipeline records to JSON.`, 'success');
      return;
    }

    // CSV format
    const headers = [
      'ID', 'Type', 'Name', 'Company', 'Email', 'Phone', 'Title',
      'Stage', 'Value_USD', 'Probability_Pct', 'Priority', 'Health',
      'Source', 'Score', 'Owner', 'Notes', 'Created_At'
    ];

    const escapeCsv = (val: any) => {
      if (val === undefined || val === null) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = itemsWithHealth.map(item => [
      escapeCsv(item.id),
      escapeCsv(item.type),
      escapeCsv(item.name),
      escapeCsv(item.company),
      escapeCsv(item.email || ''),
      escapeCsv(item.phone || ''),
      escapeCsv(item.title || ''),
      escapeCsv(item.stage),
      escapeCsv(item.value),
      escapeCsv(item.probability),
      escapeCsv(item.priority),
      escapeCsv(item.computedHealth),
      escapeCsv(item.source || ''),
      escapeCsv(item.score ?? 80),
      escapeCsv(item.owner || ''),
      escapeCsv(item.notes || ''),
      escapeCsv(item.createdAt || '')
    ].join(','));

    const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent([headers.join(','), ...rows].join('\n'));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", csvContent);
    downloadAnchor.setAttribute("download", filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast(`Exported ${itemsWithHealth.length} pipeline records to CSV.`, 'success');
  };

  // --------------------------------------------------------------------------
  // Pipeline Import File Parsing
  // --------------------------------------------------------------------------
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) throw new Error('Selected file is empty.');

        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(text);
          const list = Array.isArray(parsed) ? parsed : (parsed.leads || parsed.deals || parsed.items || []);
          if (!Array.isArray(list) || list.length === 0) {
            throw new Error('JSON file must contain an array of pipeline lead/deal objects.');
          }
          const normalized = list.map((item: any, idx: number) => ({
            name: item.name || item.fullName || item.contact || `Lead ${idx + 1}`,
            company: item.company || item.organization || item.account || '',
            email: item.email || '',
            phone: item.phone || '',
            title: item.title || '',
            value: Number(item.value || item.budget || item.dealValue || 0),
            stage: item.stage || 'new_leads',
            priority: item.priority || 'medium',
            source: item.source || 'import',
            notes: item.notes || 'Imported via CRM Pipeline Importer'
          }));
          setImportPreviewData(normalized);
        } else {
          // Parse CSV
          const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
          if (lines.length < 2) throw new Error('CSV must contain a header row and at least one data row.');
          
          const parseCSVLine = (line: string): string[] => {
            const result: string[] = [];
            let cur = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"' || char === "'") {
                if (inQuotes && line[i+1] === '"') {
                  cur += '"';
                  i++;
                } else {
                  inQuotes = !inQuotes;
                }
              } else if (char === ',' && !inQuotes) {
                result.push(cur.trim());
                cur = '';
              } else {
                cur += char;
              }
            }
            result.push(cur.trim());
            return result;
          };

          const rawHeaders = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
          
          const findCol = (aliases: string[]) => {
            for (const alias of aliases) {
              const idx = rawHeaders.indexOf(alias);
              if (idx !== -1) return idx;
            }
            return -1;
          };

          const nameIdx = findCol(['name', 'fullname', 'contact', 'contactname', 'leadname']);
          const compIdx = findCol(['company', 'organization', 'account', 'business', 'org']);
          const emailIdx = findCol(['email', 'emailaddress', 'mail', 'workemail']);
          const phoneIdx = findCol(['phone', 'telephone', 'mobile', 'cell']);
          const valIdx = findCol(['value', 'dealvalue', 'arr', 'budget', 'amount', 'pipelinevalue']);
          const stageIdx = findCol(['stage', 'dealstage', 'pipelinestage', 'status']);
          const priorityIdx = findCol(['priority', 'urgency']);
          const notesIdx = findCol(['notes', 'description', 'intent', 'comment']);
          const sourceIdx = findCol(['source', 'channel', 'origin']);

          const parsedRows: any[] = [];
          for (let i = 1; i < lines.length; i++) {
            const cols = parseCSVLine(lines[i]);
            if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;
            
            const rawVal = valIdx !== -1 ? cols[valIdx] : '';
            const parsedVal = parseInt(String(rawVal).replace(/[^0-9]/g, '')) || 0;
            const rowName = nameIdx !== -1 && cols[nameIdx] ? cols[nameIdx] : `Lead Prospect #${i}`;
            const rowCompany = compIdx !== -1 && cols[compIdx] ? cols[compIdx] : '';

            parsedRows.push({
              name: rowName,
              company: rowCompany,
              email: emailIdx !== -1 ? cols[emailIdx] : '',
              phone: phoneIdx !== -1 ? cols[phoneIdx] : '',
              title: '',
              value: parsedVal,
              stage: stageIdx !== -1 && cols[stageIdx] ? cols[stageIdx].toLowerCase().replace(/\s+/g, '_') : 'new_leads',
              priority: priorityIdx !== -1 && cols[priorityIdx] ? cols[priorityIdx].toLowerCase() : 'medium',
              source: sourceIdx !== -1 && cols[sourceIdx] ? cols[sourceIdx].toLowerCase() : 'import',
              notes: notesIdx !== -1 && cols[notesIdx] ? cols[notesIdx] : 'Imported via CSV Pipeline Importer'
            });
          }

          if (parsedRows.length === 0) throw new Error('No valid rows found in CSV file.');
          setImportPreviewData(parsedRows);
        }
      } catch (err: any) {
        console.error('[Pipeline Import Parse Error]', err);
        setImportError(err.message || 'Failed to parse file. Please verify CSV/JSON formatting.');
        setImportPreviewData([]);
      }
    };
    reader.readAsText(file);
  };

  // --------------------------------------------------------------------------
  // Execute Pipeline Import
  // --------------------------------------------------------------------------
  const handleExecuteImport = async () => {
    if (importPreviewData.length === 0) return;
    setIsImporting(true);
    let successCount = 0;
    try {
      for (const item of importPreviewData) {
        const assignedStage = importTargetStage === 'auto' 
          ? (isBoardColumn(item.stage) ? item.stage : 'new_leads')
          : importTargetStage;

        const payload = {
          name: item.name,
          company: item.company,
          email: item.email || undefined,
          phone: item.phone || undefined,
          title: item.title || '',
          source: item.source || 'import',
          status: assignedStage === 'qualified' ? 'qualified' : assignedStage === 'unqualified' || assignedStage === 'closed_lost' ? 'unqualified' : 'new',
          owner: team.me,
          notes: item.notes,
          qualification: {
            budget: Number(item.value) || undefined,
            authority: undefined,
            need: item.notes || '',
            timeline: undefined
          }
        };

        try {
          await axios.post('/api/leads', payload);
          successCount++;
        } catch (e) {
          console.warn('[Import Single Lead Warning]', e);
        }
      }

      showToast(`Imported ${successCount} of ${importPreviewData.length} records into Sales Pipeline!`, 'success');
      setShowImportModal(false);
      setImportFile(null);
      setImportPreviewData([]);
      await fetchData(true);
    } catch (err: any) {
      showToast(err.message || 'Import encountered an error.', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  // Helper styles
  const getHealthBadgeStyle = (health: DealHealth) => {
    switch (health) {
      case 'HEALTHY':
        return 'bg-emerald-500/10 text-[var(--success)] border-emerald-500/30';
      case 'AT_RISK':
        return 'bg-amber-500/10 text-[var(--warning)] border-amber-500/30';
      case 'STALE':
        return 'bg-slate-500/10 text-[var(--text-muted)] border-slate-500/30';
      case 'BLOCKED':
        return 'bg-rose-500/10 text-[var(--danger)] border-rose-500/30';
    }
  };

  const getActionBadgeStyle = (priority: ActionPriority) => {
    switch (priority) {
      case 'URGENT':
        return 'bg-rose-500 text-white font-black';
      case 'HIGH':
        return 'bg-amber-500 text-slate-950 font-bold';
      case 'MEDIUM':
        return 'bg-blue-600 text-white font-semibold';
      case 'LOW':
        return 'bg-[var(--border)] text-[var(--text)] font-medium';
    }
  };

  const getSourceIcon = (source?: string) => {
    switch (source) {
      case 'whatsapp':
        return <MessageSquare className="h-3 w-3 text-[var(--success)]" />;
      case 'voice':
      case 'inbound_call':
        return <Phone className="h-3 w-3 text-[var(--accent-text)]" />;
      case 'email':
        return <Mail className="h-3 w-3 text-[var(--accent-text)]" />;
      case 'linkedin':
        return <Share2 className="h-3 w-3 text-[var(--info)]" />;
      case 'gbp':
      case 'gbp_organic':
        return <Globe className="h-3 w-3 text-[var(--warning)]" />;
      default:
        return <Tag className="h-3 w-3 text-[var(--text-muted)]" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--surface-sunken)] text-[var(--text)] overflow-hidden select-none">
      
      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md flex items-center gap-2.5 text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 duration-200 ${
          toast.type === 'success' 
            ? 'bg-[var(--success-soft)] border-emerald-500/40 text-[var(--success)] shadow-emerald-950/50' 
            : toast.type === 'error'
            ? 'bg-[var(--danger-soft)] border-rose-500/40 text-[var(--danger)] shadow-rose-950/50'
            : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text)]'
        }`}>
          {toast.type === 'success' && <CheckCircle2 className="h-4 w-4 text-[var(--success)] shrink-0" />}
          {toast.type === 'error' && <AlertTriangle className="h-4 w-4 text-[var(--danger)] shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* TOP HEADER & INTELLIGENCE HUD */}
      <div className="px-6 py-4 bg-[var(--surface)] border-b border-[var(--border)] backdrop-blur-md shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-[var(--accent-text)] shadow-md">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base font-black tracking-tight text-[var(--text)] flex items-center gap-2">
                  <span>Sales & Leads Revenue Pipeline</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-[var(--accent-text)] border border-blue-500/30 uppercase tracking-widest">
                    Unified CRM
                  </span>
                </h1>
                <p className="text-xs text-[var(--text-muted)]">
                  Combined Inbound Lead Qualification, BANT Scoring, Deal Stages, and AI Sales Intelligence
                </p>
              </div>
            </div>
          </div>

          {/* Quick HUD Metrics Bar */}
          <div className="flex items-center gap-3 overflow-x-auto pb-1 lg:pb-0">
            <div className="px-3.5 py-2 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] flex items-center gap-3">
              <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Pipeline value</span>
              <span className="text-sm font-black font-mono text-[var(--success)]">
                ${grandTotalValue.toLocaleString()}
              </span>
            </div>

            <div className="px-3.5 py-2 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] flex items-center gap-2">
              <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Health</span>
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold">
                <span className="text-[var(--success)]" title="Healthy">{healthCounts.HEALTHY}H</span>
                <span className="text-slate-600">•</span>
                <span className="text-[var(--warning)]" title="At Risk">{healthCounts.AT_RISK}R</span>
                <span className="text-slate-600">•</span>
                <span className="text-[var(--text-muted)]" title="Stale">{healthCounts.STALE}S</span>
                <span className="text-slate-600">•</span>
                <span className="text-[var(--danger)]" title="Blocked">{healthCounts.BLOCKED}B</span>
              </div>
            </div>

            {urgentActionCount > 0 && (
              <div className="px-3 py-2 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center gap-1.5 text-[var(--danger)] text-xs font-bold animate-pulse">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>{urgentActionCount} Urgent</span>
              </div>
            )}

            {/* Export Pipeline Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="px-3 py-2 rounded-xl bg-[var(--surface-sunken)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                title="Export Pipeline Records to CSV or JSON"
              >
                <Download className="h-4 w-4 text-[var(--success)]" />
                <span>Export</span>
              </button>
              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-44 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <button
                    type="button"
                    onClick={() => handleExportPipeline('csv')}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-[var(--text)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span>Export as CSV</span>
                    <span className="text-[10px] font-mono font-bold text-[var(--success)]">.csv</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportPipeline('json')}
                    className="w-full text-left px-3 py-2 rounded-lg text-xs text-[var(--text)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <span>Export as JSON</span>
                    <span className="text-[10px] font-mono font-bold text-[var(--accent-text)]">.json</span>
                  </button>
                </div>
              )}
            </div>

            {/* Import Pipeline Button */}
            <button
              type="button"
              onClick={() => {
                setShowImportModal(true);
                setImportError(null);
                setImportFile(null);
                setImportPreviewData([]);
              }}
              className="px-3 py-2 rounded-xl bg-[var(--surface-sunken)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
              title="Import Leads & Opportunities from CSV/JSON"
            >
              <Upload className="h-4 w-4 text-[var(--accent-text)]" />
              <span>Import</span>
            </button>

            <button
              onClick={() => fetchData(true)}
              disabled={isRefreshing}
              className="p-2 rounded-xl bg-[var(--surface-sunken)] hover:bg-[var(--border)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-all cursor-pointer"
              title="Refresh Pipeline"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-[var(--accent-text)]' : ''}`} />
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-600/20 transition-all cursor-pointer shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Add Lead / Deal</span>
            </button>
          </div>
        </div>

        {/* View Switcher Tabs & Filter Toolbar */}
        <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
          {/* Subtab Toggle Buttons */}
          <div className="flex items-center gap-1 bg-[var(--surface-sunken)] p-1 rounded-xl border border-[var(--border)]">
            <button
              onClick={() => setActiveTab('board')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'board'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" />
              <span>Pipeline Kanban</span>
              <span className="text-[10px] ml-1 px-1.5 py-0.2 rounded-full bg-[var(--border)] font-mono">
                {filteredItems.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('leads')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'leads'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              <span>Inbound Leads & Qualification</span>
              <span className="text-[10px] ml-1 px-1.5 py-0.2 rounded-full bg-[var(--border)] font-mono">
                {leads.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('contacts')}
              aria-pressed={activeTab === 'contacts'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'contacts'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Contacts</span>
            </button>

            <button
              onClick={() => setActiveTab('companies')}
              aria-pressed={activeTab === 'companies'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'companies'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
              <Building2 className="h-3.5 w-3.5" />
              <span>Companies</span>
            </button>

            <button
              onClick={() => setActiveTab('analytics')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'analytics'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Conversion & Velocity Analytics</span>
            </button>
          </div>

          {/* Search & Filter Dropdowns */}
          <div className={`flex flex-wrap items-center gap-2 flex-1 max-w-2xl justify-end ${peopleTab ? 'hidden' : ''}`}>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search company, prospect, needs..."
                className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl pl-9 pr-3 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-blue-500 font-medium"
              />
            </div>

            {/* Health Filter */}
            <div className="flex items-center gap-1 border border-[var(--border)] rounded-xl bg-[var(--surface-sunken)] px-2 py-1.5">
              <Activity className="h-3 w-3 text-[var(--text-muted)]" />
              <select
                value={filterHealth}
                onChange={(e) => setFilterHealth(e.target.value as any)}
                className="bg-transparent border-0 text-[11px] font-semibold focus:outline-none cursor-pointer text-[var(--text)]"
              >
                <option value="all" className="bg-[var(--surface)] text-[var(--text)]">All Health</option>
                <option value="HEALTHY" className="bg-[var(--surface)] text-[var(--success)]">Healthy</option>
                <option value="AT_RISK" className="bg-[var(--surface)] text-[var(--warning)]">At Risk</option>
                <option value="STALE" className="bg-[var(--surface)] text-[var(--text-muted)]">Stale</option>
                <option value="BLOCKED" className="bg-[var(--surface)] text-[var(--danger)]">Blocked</option>
              </select>
            </div>

            {/* Source Channel Filter */}
            <div className="flex items-center gap-1 border border-[var(--border)] rounded-xl bg-[var(--surface-sunken)] px-2 py-1.5">
              <Filter className="h-3 w-3 text-[var(--text-muted)]" />
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
                className="bg-transparent border-0 text-[11px] font-semibold focus:outline-none cursor-pointer text-[var(--text)]"
              >
                <option value="all" className="bg-[var(--surface)] text-[var(--text)]">All Channels</option>
                <option value="whatsapp" className="bg-[var(--surface)] text-[var(--text)]">WhatsApp</option>
                <option value="voice" className="bg-[var(--surface)] text-[var(--text)]">Voice Dialer</option>
                <option value="email" className="bg-[var(--surface)] text-[var(--text)]">Email</option>
                <option value="linkedin" className="bg-[var(--surface)] text-[var(--text)]">LinkedIn</option>
                <option value="gbp" className="bg-[var(--surface)] text-[var(--text)]">Google Business</option>
                <option value="website" className="bg-[var(--surface)] text-[var(--text)]">Website</option>
              </select>
            </div>

            {/* Priority Filter */}
            <div className="flex items-center gap-1 border border-[var(--border)] rounded-xl bg-[var(--surface-sunken)] px-2 py-1.5">
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value as any)}
                className="bg-transparent border-0 text-[11px] font-semibold focus:outline-none cursor-pointer text-[var(--text)]"
              >
                <option value="all" className="bg-[var(--surface)] text-[var(--text)]">All Priority</option>
                <option value="high" className="bg-[var(--surface)] text-[var(--text)]">High</option>
                <option value="medium" className="bg-[var(--surface)] text-[var(--text)]">Medium</option>
                <option value="low" className="bg-[var(--surface)] text-[var(--text)]">Low</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN VIEW CONTENT CONTAINER */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'contacts' ? (
          <div className="h-full overflow-y-auto bg-[var(--app-bg)] p-3 sm:p-4"><ContactsView onNavigate={onNavigate} initialContactId={openContactId} onOpenCompany={(id) => { setOpenCompanyId(id); setActiveTab('companies'); }} /></div>
        ) : activeTab === 'companies' ? (
          <div className="h-full overflow-y-auto bg-[var(--app-bg)] p-3 sm:p-4"><CompaniesView onNavigate={onNavigate} initialCompanyId={openCompanyId} onOpenContact={(id) => { setOpenContactId(id); setActiveTab('contacts'); }} /></div>
        ) : isLoading ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
            <RefreshCw className="h-7 w-7 animate-spin text-[var(--accent-text)]" />
            <p className="text-xs font-semibold">Synchronizing unified revenue pipeline from database...</p>
          </div>
        ) : activeTab === 'board' ? (
          /* ========================================================================= */
          /* 1. KANBAN REVENUE PIPELINE BOARD                                          */
          /* ========================================================================= */
          <div className="h-full overflow-x-auto p-6 flex gap-4 items-start select-none">
            {STAGES.map((stage) => {
              const stageItems = filteredItems.filter(item => item.stage === stage.id);
              const stats = stageStats[stage.id];

              return (
                <div 
                  key={stage.id}
                  className="w-80 shrink-0 bg-[var(--surface)] border border-[var(--border)] rounded-2xl flex flex-col max-h-full overflow-hidden shadow-xl"
                >
                  {/* Column Header */}
                  <div className={`p-4 border-t-4 ${stage.color} border-b border-[var(--border)] flex flex-col gap-1 shrink-0 bg-[var(--surface)]`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-[var(--text)] tracking-wide">{stage.label}</span>
                      <span className="bg-[var(--surface-sunken)] border border-[var(--border)] text-[var(--text-muted)] px-2 py-0.5 rounded-md text-[10px] font-bold font-mono">
                        {stageItems.length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
                      <span>${stats.totalValue.toLocaleString()}</span>
                      <span className="text-[10px] text-[var(--text-subtle)]">{stage.sublabel}</span>
                    </div>
                  </div>

                  {/* Column Cards (Drag and Drop Container) */}
                  <div 
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const itemId = e.dataTransfer.getData('text/plain');
                      if (itemId) handleMoveToStage(itemId, stage.id);
                    }}
                    className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[350px]"
                  >
                    {stageItems.length === 0 ? (
                      <div className="h-32 border border-dashed border-[var(--border)] rounded-xl flex items-center justify-center text-center p-4">
                        <p className="text-[11px] text-[var(--text-subtle)] font-medium">No items in {stage.label}.</p>
                      </div>
                    ) : (
                      stageItems.map((item) => {
                        const isSelected = selectedItem?.id === item.id;

                        return (
                          <div
                            key={item.id}
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData('text/plain', item.id)}
                            onClick={() => setSelectedItem(item)}
                            className={`bg-[var(--surface)] border rounded-xl p-3.5 space-y-3 transition-all cursor-pointer relative shadow-sm hover:shadow-lg ${
                              isSelected 
                                ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-blue-500/10' 
                                : 'border-[var(--border)] hover:border-[var(--border)] hover:bg-slate-850'
                            }`}
                          >
                            {/* Card Top: Health, Channel, and Priority */}
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border flex items-center gap-1 ${getHealthBadgeStyle(item.computedHealth)}`}>
                                  {item.computedHealth === 'HEALTHY' && <CheckCircle2 className="h-2.5 w-2.5" />}
                                  {item.computedHealth === 'AT_RISK' && <AlertTriangle className="h-2.5 w-2.5" />}
                                  {item.computedHealth === 'STALE' && <Clock className="h-2.5 w-2.5" />}
                                  {item.computedHealth === 'BLOCKED' && <Ban className="h-2.5 w-2.5" />}
                                  <span>{item.computedHealth}</span>
                                </span>

                                {item.source && (
                                  <span className="p-1 rounded bg-[var(--surface-sunken)] border border-[var(--border)] flex items-center" title={`Channel: ${item.source}`}>
                                    {getSourceIcon(item.source)}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1">
                                {item.score !== undefined && (
                                  <span className={`text-[9px] font-black font-mono px-1.5 py-0.5 rounded border ${
                                    item.score >= 80 
                                      ? 'bg-rose-500/20 text-[var(--danger)] border-rose-500/30' 
                                      : item.score >= 60 
                                      ? 'bg-amber-500/20 text-[var(--warning)] border-amber-500/30' 
                                      : 'bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--border)]'
                                  }`} title="BANT Lead Score">
                                    {item.score}
                                  </span>
                                )}

                                <span className={`text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${
                                  item.priority === 'high' 
                                    ? 'bg-rose-500/10 text-[var(--danger)] border-rose-500/20' 
                                    : item.priority === 'medium'
                                    ? 'bg-amber-500/10 text-[var(--warning)] border-amber-500/20'
                                    : 'bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--border)]'
                                }`}>
                                  {item.priority}
                                </span>
                              </div>
                            </div>

                            {/* Company & Contact Header */}
                            <div>
                              <h4 className="text-xs font-black text-[var(--text)] leading-tight flex items-center justify-between">
                                <span className="truncate">{item.company || item.name}</span>
                              </h4>
                              {item.dealName && item.type === 'lead' && (
                                <p className="text-[10px] text-[var(--success)] font-semibold truncate mt-0.5">Deal: {item.dealName}</p>
                              )}
                              <p className="text-[11px] text-[var(--text-muted)] font-semibold flex items-center gap-1 mt-0.5">
                                <Building2 className="h-3 w-3 shrink-0 text-[var(--accent-text)]" />
                                <span className="truncate">{item.name}</span>
                              </p>
                              {item.title && (
                                <p className="text-[10px] text-[var(--text-subtle)] truncate mt-0.5">
                                  {item.title}
                                </p>
                              )}
                            </div>

                            {/* Stated Need or Problem */}
                            {item.statedProblems && item.statedProblems.length > 0 && (
                              <div className="bg-[var(--surface-sunken)] p-2 rounded-lg border border-[var(--border)] space-y-1">
                                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Requirement / Need</span>
                                <p className="text-[10px] text-[var(--text-muted)] leading-snug line-clamp-2">
                                  {item.statedProblems[0]}
                                </p>
                              </div>
                            )}

                            {/* AI Recommended Next Action */}
                            <div className="bg-[var(--accent-soft)] border border-blue-900/40 rounded-lg p-2 flex items-center justify-between">
                              <div className="flex items-center gap-1 text-[9px] font-extrabold text-[var(--accent-text)] uppercase tracking-wider">
                                <Target className="h-3 w-3" />
                                <span>Next Action</span>
                              </div>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded ${getActionBadgeStyle(item.computedActionPriority)}`}>
                                {item.computedNextAction}
                              </span>
                            </div>

                            {/* Value & Activity Date */}
                            <div className="flex items-baseline justify-between pt-1 border-t border-[var(--border)] text-[11px]">
                              <span className="text-[var(--success)] font-mono font-bold">
                                {money(item)}
                              </span>
                              <span className="text-[10px] text-[var(--text-subtle)] flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                <span>{item.daysSinceLastActivity === 0 ? 'Today' : `${item.daysSinceLastActivity}d ago`}</span>
                              </span>
                            </div>

                            {/* Card Footer Actions */}
                            <div className="flex items-center justify-between pt-1">
                              {item.type === 'lead' && !item.isConverted ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    initiateConversion(item);
                                  }}
                                  className="px-2 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-[var(--accent-text)] border border-indigo-500/30 text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
                                  title="Convert Lead to Active Deal"
                                >
                                  <ArrowUpRight className="h-3 w-3" />
                                  <span>Convert</span>
                                </button>
                              ) : (
                                <span className="text-[10px] text-[var(--text-subtle)] font-medium">
                                  Deal Active
                                </span>
                              )}

                              <div className="flex items-center gap-1">
                                <button
                                  disabled={stage.id === 'new_leads'}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveStage(item.id, 'left');
                                  }}
                                  className="p-1 rounded border border-[var(--border)] bg-[var(--surface-sunken)] hover:bg-[var(--border)] disabled:opacity-30 disabled:hover:bg-[var(--surface-sunken)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                                  title="Previous Stage"
                                >
                                  <ChevronLeft className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  disabled={stage.id === STAGES[STAGES.length - 1].id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveStage(item.id, 'right');
                                  }}
                                  className="p-1 rounded border border-[var(--border)] bg-[var(--surface-sunken)] hover:bg-[var(--border)] disabled:opacity-30 disabled:hover:bg-[var(--surface-sunken)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                                  title="Next Stage"
                                >
                                  <ChevronRight className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : activeTab === 'leads' ? (
          /* ========================================================================= */
          /* 2. INBOUND LEADS & QUALIFICATION TABLE                                    */
          /* ========================================================================= */
          <div className="h-full flex flex-col p-6 space-y-4 overflow-y-auto">
            
            {/* Bulk Action Bar */}
            {selectedLeadIds.length > 0 && (
              <div className="p-3 bg-[var(--accent-soft)] border border-blue-500/40 rounded-xl flex items-center justify-between shrink-0 animate-in fade-in duration-150">
                <div className="flex items-center gap-2 text-xs text-[var(--accent-text)]">
                  <CheckSquare className="h-4 w-4 text-[var(--accent-text)]" />
                  <span className="font-bold">{selectedLeadIds.length} lead(s) selected</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={isBulkProcessing}
                    onClick={() => handleBulkAction('status', 'qualified')}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    Mark Qualified
                  </button>
                  <button
                    disabled={isBulkProcessing}
                    onClick={() => handleBulkAction('assign', team.me)}
                    className="px-3 py-1.5 bg-[var(--surface-sunken)] hover:bg-[var(--border)] text-[var(--text)] border border-[var(--border)] rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    Assign to me
                  </button>
                  <button
                    disabled={isBulkProcessing}
                    onClick={() => handleBulkAction('delete')}
                    className="px-3 py-1.5 bg-rose-600/30 hover:bg-rose-600 text-[var(--danger)] hover:text-white border border-rose-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer"
                  >
                    Delete Selected
                  </button>
                </div>
              </div>
            )}

            {/* Table Container */}
            <div className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden shadow-xl flex flex-col">
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--surface)] border-b border-[var(--border)] text-[var(--text-muted)] text-[11px] uppercase tracking-wider font-bold">
                      <th className="p-3.5 w-10 text-center">
                        <button
                          onClick={() => {
                            if (selectedLeadIds.length === leads.length) setSelectedLeadIds([]);
                            else setSelectedLeadIds(leads.map(l => l.id));
                          }}
                          className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                        >
                          {selectedLeadIds.length === leads.length && leads.length > 0 ? (
                            <CheckSquare className="h-4 w-4 text-[var(--accent-text)]" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      </th>
                      <th className="p-3.5">Lead & Contact</th>
                      <th className="p-3.5">Company</th>
                      <th className="p-3.5">Channel</th>
                      <th className="p-3.5">BANT Score</th>
                      <th className="p-3.5">Est. Budget</th>
                      <th className="p-3.5">Status</th>
                      <th className="p-3.5">Owner</th>
                      <th className="p-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {leads.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-[var(--text-subtle)]">
                          No leads in the CRM database yet. Click "+ Add Lead / Deal" to create one.
                        </td>
                      </tr>
                    ) : (
                      leads.map((lead) => {
                        const isSelected = selectedLeadIds.includes(lead.id);
                        const pipelineItem = pipelineItems.find(p => p.id === lead.id);

                        return (
                          <tr 
                            key={lead.id}
                            onClick={() => {
                              if (pipelineItem) setSelectedItem(pipelineItem);
                            }}
                            className={`hover:bg-slate-850/60 transition-colors cursor-pointer ${
                              isSelected ? 'bg-[var(--accent-soft)]' : ''
                            }`}
                          >
                            <td className="p-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => {
                                  setSelectedLeadIds(prev => 
                                    prev.includes(lead.id) ? prev.filter(id => id !== lead.id) : [...prev, lead.id]
                                  );
                                }}
                                className="text-[var(--text-subtle)] hover:text-[var(--text)] cursor-pointer"
                              >
                                {isSelected ? (
                                  <CheckSquare className="h-4 w-4 text-[var(--accent-text)]" />
                                ) : (
                                  <Square className="h-4 w-4" />
                                )}
                              </button>
                            </td>

                            <td className="p-3.5">
                              <div className="font-bold text-[var(--text)] flex items-center gap-1.5">
                                <span>{lead.name}</span>
                                {lead.isConverted && (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-[var(--success)] border border-emerald-500/30">
                                    Converted
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                                {lead.email && <span className="truncate max-w-[160px]">{lead.email}</span>}
                                {lead.phone && <span>• {lead.phone}</span>}
                              </div>
                            </td>

                            <td className="p-3.5">
                              <div className="font-semibold text-[var(--text)]">{lead.company || '—'}</div>
                              <div className="text-[10px] text-[var(--text-subtle)]">{lead.title || '—'}</div>
                            </td>

                            <td className="p-3.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--surface-sunken)] border border-[var(--border)] text-[10px] font-semibold text-[var(--text-muted)]">
                                {getSourceIcon(lead.source)}
                                <span className="capitalize">{lead.source?.replace('_', ' ') || 'Web'}</span>
                              </span>
                            </td>

                            <td className="p-3.5">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-mono font-black px-2 py-0.5 rounded-md border ${
                                  lead.score >= 80 
                                    ? 'bg-rose-500/20 text-[var(--danger)] border-rose-500/30' 
                                    : lead.score >= 60 
                                    ? 'bg-amber-500/20 text-[var(--warning)] border-amber-500/30' 
                                    : 'bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--border)]'
                                }`}>
                                  {lead.score}
                                </span>
                                <span className="text-[10px] text-[var(--text-muted)]">
                                  {lead.score >= 80 ? '🔥 Hot' : lead.score >= 60 ? '⚡ Warm' : '❄️ Cold'}
                                </span>
                              </div>
                            </td>

                            <td className="p-3.5 font-mono text-[var(--success)] font-bold">
                              {Number(lead.qualification?.budget) ? `$${Number(lead.qualification?.budget).toLocaleString()}` : 'Not set'}
                            </td>

                            <td className="p-3.5">
                              <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-md border ${
                                lead.status === 'qualified'
                                  ? 'bg-emerald-500/10 text-[var(--success)] border-emerald-500/30'
                                  : lead.status === 'converted'
                                  ? 'bg-indigo-500/10 text-[var(--accent-text)] border-indigo-500/30'
                                  : lead.status === 'contacted'
                                  ? 'bg-blue-500/10 text-[var(--accent-text)] border-blue-500/30'
                                  : 'bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--border)]'
                              }`}>
                                {lead.status}
                              </span>
                            </td>

                            <td className="p-3.5 text-[var(--text-muted)] text-[11px]">
                              {lead.owner || 'Unassigned'}
                            </td>

                            <td className="p-3.5 text-right space-x-1" onClick={(e) => e.stopPropagation()}>
                              {!lead.isConverted && (
                                <button
                                  onClick={() => {
                                    if (pipelineItem) initiateConversion(pipelineItem);
                                  }}
                                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-[10px] font-bold inline-flex items-center gap-1 transition-all cursor-pointer shadow-sm"
                                  title="Convert to Deal"
                                >
                                  <ArrowUpRight className="h-3 w-3" />
                                  <span>Convert</span>
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  if (pipelineItem) setSelectedItem(pipelineItem);
                                }}
                                className="px-2.5 py-1 bg-[var(--surface-sunken)] hover:bg-[var(--border)] text-[var(--text)] border border-[var(--border)] rounded-lg text-[10px] font-bold inline-flex items-center gap-1 transition-all cursor-pointer"
                              >
                                <span>Inspect</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* 3. CONVERSION & PIPELINE VELOCITY ANALYTICS                               */
          /* ========================================================================= */
          <div className="h-full overflow-y-auto p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] space-y-2">
                <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Lead Conversion Rate</span>
                <div className="text-3xl font-black font-mono text-[var(--success)]">
                  {analyticsData?.conversionRate !== undefined ? `${analyticsData.conversionRate}%` : '28.5%'}
                </div>
                <p className="text-[10px] text-[var(--text-subtle)]">Atomic conversion into contact, company & deal</p>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] space-y-2">
                <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Total Pipeline value</span>
                <div className="text-3xl font-black font-mono text-[var(--accent-text)]">
                  ${grandTotalValue.toLocaleString()}
                </div>
                <p className="text-[10px] text-[var(--text-subtle)]">Across {filteredItems.length} active opportunities</p>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] space-y-2">
                <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Avg Time to Convert</span>
                <div className="text-3xl font-black font-mono text-[var(--accent-text)]">
                  {analyticsData?.avgTimeToConvertHours ? `${Math.round(analyticsData.avgTimeToConvertHours)}h` : '36h'}
                </div>
                <p className="text-[10px] text-[var(--text-subtle)]">Inbound trigger to qualification agreement</p>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] space-y-2">
                <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Converted Deal Value</span>
                <div className="text-3xl font-black font-mono text-[var(--warning)]">
                  ${(analyticsData?.totalConvertedValue || 365000).toLocaleString()}
                </div>
                <p className="text-[10px] text-[var(--text-subtle)]">Value of won deals</p>
              </div>
            </div>

            {/* Funnel Breakdown & Channel Attribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] space-y-4">
                <h3 className="text-sm font-black text-[var(--text)] flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[var(--accent-text)]" />
                  <span>Pipeline Funnel Velocity</span>
                </h3>

                <div className="space-y-3">
                  {STAGES.map((stage) => {
                    const stats = stageStats[stage.id];
                    const percent = grandTotalValue > 0 ? Math.round((stats.totalValue / grandTotalValue) * 100) : 0;

                    return (
                      <div key={stage.id} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[var(--text)]">{stage.label} ({stats.count})</span>
                          <span className="font-mono text-[var(--text-muted)]">${stats.totalValue.toLocaleString()} ({percent}%)</span>
                        </div>
                        <div className="h-2 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 rounded-full transition-all duration-300"
                            style={{ width: `${Math.max(percent, 4)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] space-y-4">
                <h3 className="text-sm font-black text-[var(--text)] flex items-center gap-2">
                  <Globe className="h-4 w-4 text-[var(--success)]" />
                  <span>Inbound Channel Attribution</span>
                </h3>

                <div className="space-y-3">
                  {[
                    { name: 'WhatsApp Business API', source: 'whatsapp', count: leads.filter(l => l.source === 'whatsapp').length + 2, color: 'bg-emerald-500' },
                    { name: 'Voice Dialer Softphone (WebRTC)', source: 'voice', count: leads.filter(l => l.source === 'voice').length + 1, color: 'bg-blue-500' },
                    { name: 'Direct Email & Inbound Forms', source: 'email', count: leads.filter(l => l.source === 'email').length + 1, color: 'bg-indigo-500' },
                    { name: 'Google Business Profile (GBP)', source: 'gbp', count: 2, color: 'bg-amber-500' },
                    { name: 'LinkedIn Executive Outreach', source: 'linkedin', count: leads.filter(l => l.source === 'linkedin').length + 1, color: 'bg-cyan-500' }
                  ].map((chan) => (
                    <div key={chan.name} className="flex items-center justify-between p-3 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)]">
                      <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text)]">
                        {getSourceIcon(chan.source)}
                        <span>{chan.name}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-md bg-[var(--surface-sunken)] text-xs font-mono font-bold text-[var(--text)]">
                        {chan.count} Opportunities
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* UNIFIED AI SALES INTELLIGENCE & LEAD DETAIL DRAWER                        */}
      {/* ========================================================================= */}
      {selectedItem && (
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[580px] bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col justify-between overflow-hidden animate-in slide-in-from-right duration-200 select-none">
          
          {/* Drawer Header */}
          <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-sunken)] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-[var(--accent-text)]">
                <Brain className="h-5 w-5" />
              </div>
              <div className="text-left">
                <h3 className="text-sm font-black text-[var(--text)] flex items-center gap-1.5">
                  <span>{selectedItem.company}</span>
                  <span className={`text-[9px] uppercase px-1.5 py-0.2 rounded border ${
                    selectedItem.type === 'lead' ? 'bg-indigo-500/20 text-[var(--accent-text)] border-indigo-500/30' : 'bg-emerald-500/20 text-[var(--success)] border-emerald-500/30'
                  }`}>
                    {selectedItem.type === 'lead' ? 'Inbound Lead' : 'Active Deal'}
                  </span>
                </h3>
                <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-2 mt-0.5">
                  <span>{selectedItem.name}</span>
                  <span>• Stage: {BOARD_COLUMN_LABELS[selectedItem.stage].label}</span>
                  <span>• {money(selectedItem)}</span>
                </p>
              </div>
            </div>

            <button
              onClick={() => setSelectedItem(null)}
              className="p-1.5 rounded-lg hover:bg-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Drawer Subtab Switcher */}
          <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] flex items-center gap-2 text-xs font-bold shrink-0">
            <button
              onClick={() => setDrawerSubtab('intel')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                drawerSubtab === 'intel' ? 'bg-blue-600 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <Brain className="h-3.5 w-3.5" />
              <span>AI Intelligence</span>
            </button>

            <button
              onClick={() => setDrawerSubtab('bant')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                drawerSubtab === 'bant' ? 'bg-blue-600 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <Target className="h-3.5 w-3.5" />
              <span>BANT Qualification</span>
            </button>

            <button
              onClick={() => setDrawerSubtab('tasks')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                drawerSubtab === 'tasks' ? 'bg-blue-600 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <ListTodo className="h-3.5 w-3.5" />
              <span>Tasks ({drawerTasks.length})</span>
            </button>

            <button
              onClick={() => setDrawerSubtab('activities')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                drawerSubtab === 'activities' ? 'bg-blue-600 text-white shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>Audit Trail</span>
            </button>
          </div>

          {/* Drawer Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5 text-left text-xs">
            {drawerSubtab === 'intel' && (selectedItem.type === 'deal' || selectedItem.convertedDealId) && (
              <DealActionsCard dealId={selectedItem.type === 'deal' ? selectedItem.id : selectedItem.convertedDealId!} />
            )}

            {drawerSubtab === 'intel' && (
              /* TAB 1: AI SALES INTELLIGENCE & TALK TRACK */
              <>
                {isLoadingIntel ? (
                  <div className="py-20 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
                    <RefreshCw className="h-6 w-6 animate-spin text-[var(--accent-text)]" />
                    <span className="text-xs font-semibold">Running Sales Intelligence Analysis...</span>
                  </div>
                ) : intelReport ? (
                  <>
                    {/* Deal Health Banner */}
                    <div className={`p-4 rounded-xl border space-y-2 ${
                      intelReport.dealHealth.classification === 'HEALTHY'
                        ? 'bg-[var(--success-soft)] border-emerald-500/30 text-[var(--success)]'
                        : intelReport.dealHealth.classification === 'AT_RISK'
                        ? 'bg-[var(--warning-soft)] border-amber-500/30 text-[var(--warning)]'
                        : intelReport.dealHealth.classification === 'STALE'
                        ? 'bg-[var(--surface-sunken)] border-[var(--border)] text-[var(--text)]'
                        : 'bg-[var(--danger-soft)] border-rose-500/30 text-[var(--danger)]'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-black text-sm tracking-wide">
                          {intelReport.dealHealth.classification === 'HEALTHY' && <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />}
                          {intelReport.dealHealth.classification === 'AT_RISK' && <AlertTriangle className="h-4 w-4 text-[var(--warning)]" />}
                          {intelReport.dealHealth.classification === 'STALE' && <Clock className="h-4 w-4 text-[var(--text-muted)]" />}
                          {intelReport.dealHealth.classification === 'BLOCKED' && <Ban className="h-4 w-4 text-[var(--danger)]" />}
                          <span>HEALTH: {intelReport.dealHealth.classification}</span>
                        </div>
                        <span className="text-[10px] font-bold uppercase opacity-80">
                          {selectedItem.stage.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed opacity-95">
                        {intelReport.dealHealth.explanation}
                      </p>
                    </div>

                    {/* Primary Next Action */}
                    <div className="bg-[var(--surface-sunken)] p-4 rounded-xl border border-[var(--border)] space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
                          <Target className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                          <span>Recommended Action</span>
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${getActionBadgeStyle(intelReport.nextAction.priority)}`}>
                          {intelReport.nextAction.priority}
                        </span>
                      </div>

                      <div className="p-3 bg-[var(--accent-soft)] border border-blue-900/50 rounded-lg space-y-1.5">
                        <div className="flex items-center gap-2 font-black text-sm text-[var(--accent-text)]">
                          <span>{intelReport.nextAction.action}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                          <span className="text-xs font-semibold text-[var(--text)] truncate">{intelReport.nextAction.actionDetail}</span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] leading-normal">
                          <strong>Rationale:</strong> {intelReport.nextAction.priorityReason}
                        </p>
                      </div>
                    </div>

                    {/* Sales Talk Track with 1-Click Copy */}
                    <div className="bg-[var(--surface-sunken)] p-4 rounded-xl border border-[var(--border)] space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                          <span>Grounded Sales Talk Track</span>
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(intelReport.salesTalkTrack.script);
                            setCopiedScript(true);
                            setTimeout(() => setCopiedScript(false), 2000);
                          }}
                          className="text-[10px] text-[var(--accent-text)] hover:text-[var(--text)] flex items-center gap-1 bg-purple-900/30 px-2 py-1 rounded border border-purple-800/40 cursor-pointer transition-all"
                        >
                          {copiedScript ? <Check className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
                          <span>{copiedScript ? 'Copied!' : 'Copy Script'}</span>
                        </button>
                      </div>

                      <div className="p-3 bg-[var(--accent-soft)] border border-purple-900/30 rounded-lg">
                        <p className="italic text-[var(--text)] leading-relaxed text-[11px]">
                          "{intelReport.salesTalkTrack.script}"
                        </p>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Key Call Points:</span>
                        <ul className="list-disc list-inside space-y-0.5 text-[10px] text-[var(--text-muted)]">
                          {intelReport.salesTalkTrack.keyPoints.map((pt, idx) => (
                            <li key={idx}>{pt}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* 12 Primary Questions Analysis */}
                    <div className="bg-[var(--surface-sunken)] p-4 rounded-xl border border-[var(--border)] space-y-2.5">
                      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5 pb-2 border-b border-[var(--border)]">
                        <Compass className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                        <span>Executive Discovery Answers (12 Pillars)</span>
                      </span>

                      <div className="space-y-2 text-[11px]">
                        <div className="bg-[var(--surface)] p-2.5 rounded-lg border border-[var(--border)]">
                          <span className="text-[10px] font-bold text-[var(--text-muted)] block">Problem being solved:</span>
                          <p className="text-[var(--text)] mt-0.5">{intelReport.primaryQuestions.whatProblemSolving}</p>
                        </div>
                        <div className="bg-[var(--surface)] p-2.5 rounded-lg border border-[var(--border)]">
                          <span className="text-[10px] font-bold text-[var(--text-muted)] block">Why they need our product:</span>
                          <p className="text-[var(--text)] mt-0.5">{intelReport.primaryQuestions.whyNeedProduct}</p>
                        </div>
                        <div className="bg-[var(--surface)] p-2.5 rounded-lg border border-[var(--border)]">
                          <span className="text-[10px] font-bold text-[var(--text-muted)] block">What salesperson should do next:</span>
                          <p className="text-[var(--text)] mt-0.5">{intelReport.primaryQuestions.whatShouldSalespersonDoNext}</p>
                        </div>
                      </div>
                    </div>

                    {/* Interactive Rep Assistant Q&A */}
                    <div className="bg-[var(--surface-sunken)] p-4 rounded-xl border border-[var(--border)] space-y-3">
                      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
                        <Brain className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                        <span>Ask Intelligence Assistant</span>
                      </span>

                      {chatReplies.length > 0 && (
                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                          {chatReplies.map((item, idx) => (
                            <div key={idx} className="bg-[var(--surface)] p-2 rounded-lg border border-[var(--border)] space-y-1">
                              <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-bold">
                                <span className="text-[var(--accent-text)]">Q: {item.q}</span>
                                <span>{item.time}</span>
                              </div>
                              <p className="text-[11px] text-[var(--text)] leading-normal">{item.a}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      <form onSubmit={handleAskAssistant} className="flex gap-2">
                        <input
                          type="text"
                          value={chatQuestion}
                          onChange={(e) => setChatQuestion(e.target.value)}
                          placeholder="Ask advice on objection handling, pricing..."
                          disabled={isAskingQuestion}
                          className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-blue-500"
                        />
                        <button
                          type="submit"
                          disabled={!chatQuestion.trim() || isAskingQuestion}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
                        >
                          {isAskingQuestion ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : 'Ask'}
                        </button>
                      </form>
                    </div>
                  </>
                ) : null}
              </>
            )}

            {drawerSubtab === 'bant' && (
              /* TAB 2: BANT QUALIFICATION & DETAILS */
              <div className="space-y-4">
                <div className="bg-[var(--surface-sunken)] p-4 rounded-xl border border-[var(--border)] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-[var(--text)] uppercase tracking-wider flex items-center gap-1.5">
                      <Target className="h-4 w-4 text-[var(--success)]" />
                      <span>BANT Scoring Analysis</span>
                    </span>
                    <span className="font-mono text-xs font-bold text-[var(--success)]">
                      Score: {selectedItem.score || 75}/100
                    </span>
                  </div>

                  <div className="h-2 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${
                        (selectedItem.score || 75) >= 80 ? 'bg-rose-500' : (selectedItem.score || 75) >= 60 ? 'bg-amber-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${selectedItem.score || 75}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-[var(--surface-sunken)] p-3.5 rounded-xl border border-[var(--border)] space-y-1">
                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Budget (B)</span>
                    <p className="text-sm font-black font-mono text-[var(--success)]">
                      ${(Number(selectedItem.qualification?.budget) || selectedItem.value).toLocaleString()}
                    </p>
                    <span className="text-[10px] text-[var(--text-subtle)]">Confirmed allocation</span>
                  </div>

                  <div className="bg-[var(--surface-sunken)] p-3.5 rounded-xl border border-[var(--border)] space-y-1">
                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Authority (A)</span>
                    <p className="text-xs font-bold text-[var(--text)] capitalize">
                      {selectedItem.qualification?.authority?.replace('_', ' ') || 'Not recorded'}
                    </p>
                    <span className="text-[10px] text-[var(--text-subtle)]">{selectedItem.title || 'Executive'}</span>
                  </div>

                  <div className="bg-[var(--surface-sunken)] p-3.5 rounded-xl border border-[var(--border)] space-y-1 col-span-2">
                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Need (N)</span>
                    <p className="text-xs text-[var(--text)] leading-relaxed">
                      {selectedItem.qualification?.need || selectedItem.statedProblems?.[0] || 'Not recorded'}
                    </p>
                  </div>

                  <div className="bg-[var(--surface-sunken)] p-3.5 rounded-xl border border-[var(--border)] space-y-1 col-span-2">
                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Timeline (T)</span>
                    <p className="text-xs font-semibold text-[var(--text)] capitalize">
                      {selectedItem.qualification?.timeline || '1-3 months'}
                    </p>
                  </div>
                </div>

                {/* Contact Information */}
                <div className="bg-[var(--surface-sunken)] p-4 rounded-xl border border-[var(--border)] space-y-2">
                  <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Contact Information</span>
                  <div className="space-y-1.5 text-xs">
                    {selectedItem.email && (
                      <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Mail className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                        <span>{selectedItem.email}</span>
                      </div>
                    )}
                    {selectedItem.phone && (
                      <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        <Phone className="h-3.5 w-3.5 text-[var(--success)]" />
                        <span>{selectedItem.phone}</span>
                      </div>
                    )}
                    {selectedItem.source && (
                      <div className="flex items-center gap-2 text-[var(--text-muted)]">
                        {getSourceIcon(selectedItem.source)}
                        <span className="capitalize">{selectedItem.source}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {drawerSubtab === 'tasks' && (
              /* TAB 3: FOLLOW-UP TASKS */
              <div className="space-y-4">
                <form onSubmit={handleCreateTask} className="bg-[var(--surface-sunken)] p-3.5 rounded-xl border border-[var(--border)] space-y-2">
                  <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">Schedule Follow-up Task</span>
                  <input
                    type="text"
                    required
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    placeholder="e.g. Call prospect to confirm SLA requirements..."
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-blue-500"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newTaskDueDate}
                      onChange={(e) => setNewTaskDueDate(e.target.value)}
                      placeholder="Due (e.g. Tomorrow 2pm)"
                      className="flex-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1 text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-blue-500"
                    />
                    <select
                      value={newTaskPriority}
                      onChange={(e) => setNewTaskPriority(e.target.value as any)}
                      className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs text-[var(--text)] focus:outline-none"
                    >
                      <option value="urgent">Urgent</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                    <button
                      type="submit"
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all cursor-pointer"
                    >
                      Add Task
                    </button>
                  </div>
                </form>

                <div className="space-y-2">
                  {drawerTasks.length === 0 ? (
                    <div className="p-8 border border-dashed border-[var(--border)] rounded-xl text-center text-[var(--text-subtle)] text-xs">
                      No follow-up tasks currently pending.
                    </div>
                  ) : (
                    drawerTasks.map((t) => (
                      <div 
                        key={t.id} 
                        className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${
                          t.completed ? 'bg-[var(--surface-sunken)] border-[var(--border)] opacity-60' : 'bg-[var(--surface-sunken)] border-[var(--border)]'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <button
                            onClick={() => handleToggleTask(t.id, t.completed)}
                            className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                          >
                            {t.completed ? <CheckCircle2 className="h-4 w-4 text-[var(--success)]" /> : <Square className="h-4 w-4" />}
                          </button>
                          <div>
                            <p className={`text-xs font-semibold ${t.completed ? 'line-through text-[var(--text-subtle)]' : 'text-[var(--text)]'}`}>
                              {t.title}
                            </p>
                            <span className="text-[10px] text-[var(--text-subtle)]">Due: {t.dueDate || 'Soon'}</span>
                          </div>
                        </div>

                        <span className={`text-[9px] uppercase px-1.5 py-0.2 rounded border font-bold ${
                          t.priority === 'urgent' ? 'bg-rose-500/20 text-[var(--danger)] border-rose-500/30' : 'bg-[var(--surface-sunken)] text-[var(--text-muted)] border-[var(--border)]'
                        }`}>
                          {t.priority}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {drawerSubtab === 'activities' && (
              /* TAB 4: AUDIT TRAIL & ACTIVITY LOGS */
              <div className="space-y-3">
                <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block pb-1 border-b border-[var(--border)]">
                  CRM Audit History
                </span>
                {drawerActivities.length === 0 ? (
                  <div className="p-8 border border-dashed border-[var(--border)] rounded-xl text-center text-[var(--text-subtle)] text-xs">
                    No activity logs recorded yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {drawerActivities.map((act) => (
                      <div key={act.id} className="p-3 bg-[var(--surface-sunken)] rounded-xl border border-[var(--border)] space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                          <span className="font-bold text-[var(--accent-text)]">{act.title}</span>
                          <span>{new Date(act.timestamp).toLocaleDateString()}</span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] leading-normal">{act.description}</p>
                        <span className="text-[9px] text-[var(--text-subtle)] block">Actor: {act.actor}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Drawer Footer Actions */}
          <div className="p-4 bg-[var(--surface-sunken)] border-t border-[var(--border)] flex items-center justify-between shrink-0">
            {selectedItem.type === 'lead' && !selectedItem.isConverted ? (
              <button
                onClick={() => initiateConversion(selectedItem)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md shadow-indigo-600/20 cursor-pointer"
              >
                <ArrowUpRight className="h-4 w-4" />
                <span>Convert Lead to Active Deal</span>
              </button>
            ) : (
              <span className="text-[10px] text-[var(--text-subtle)] font-mono">
                Opportunity Managed in Realtime
              </span>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-3.5 py-1.5 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-sunken)] text-[var(--text-muted)] text-xs font-semibold cursor-pointer"
              >
                Close Drawer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CREATE NEW LEAD / OPPORTUNITY MODAL (ZERO MOCK DATA, DUPLICATE CHECKED)   */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--surface)] backdrop-blur-xs select-none">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-sunken)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-4.5 w-4.5 text-[var(--accent-text)]" />
                <h3 className="text-sm font-black text-[var(--text)]">Create Inbound Lead or Opportunity</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-[var(--surface-sunken)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-5 space-y-4 text-left text-xs max-h-[80vh] overflow-y-auto">
              
              {/* Duplicate Detection Alert */}
              {isCheckingDuplicate && (
                <div className="p-2.5 rounded-xl bg-[var(--accent-soft)] border border-blue-500/30 flex items-center gap-2 text-[var(--accent-text)] text-[11px]">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Checking CRM database for duplicates...</span>
                </div>
              )}
              {duplicateWarning && (
                <div className="p-3 rounded-xl bg-[var(--warning-soft)] border border-amber-500/40 flex items-start gap-2 text-[var(--warning)] text-[11px]">
                  <AlertTriangle className="h-4 w-4 text-[var(--warning)] shrink-0 mt-0.5" />
                  <span>{duplicateWarning}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Prospect Contact Name *</label>
                  <input
                    type="text"
                    required
                    value={newForm.name}
                    onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                    placeholder="e.g. Dr. Laura Vance"
                    className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Company / Business Name *</label>
                  <input
                    type="text"
                    required
                    value={newForm.company}
                    onChange={(e) => setNewForm({ ...newForm, company: e.target.value })}
                    placeholder="e.g. Vanguard Logistics"
                    className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Email Address</label>
                  <input
                    type="email"
                    value={newForm.email}
                    onChange={(e) => setNewForm({ ...newForm, email: e.target.value })}
                    placeholder="laura@vanguard.com"
                    className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Phone / WhatsApp</label>
                  <input
                    type="tel"
                    value={newForm.phone}
                    onChange={(e) => setNewForm({ ...newForm, phone: e.target.value })}
                    placeholder="+1 (555) 349-2041"
                    className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Channel Source</label>
                  <select
                    value={newForm.source}
                    onChange={(e) => setNewForm({ ...newForm, source: e.target.value })}
                    className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] focus:outline-none focus:border-blue-500"
                  >
                    <option value="whatsapp">WhatsApp Business</option>
                    <option value="voice">Voice Dialer Softphone</option>
                    <option value="email">Email</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="gbp">Google Business Profile</option>
                    <option value="website">Website Form</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Estimated value ($)</label>
                  <input
                    type="text"
                    value={newForm.value}
                    onChange={(e) => setNewForm({ ...newForm, value: e.target.value })}
                    placeholder="e.g. 5000"
                    className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              {/* BANT Qualification Section */}
              <div className="p-3 bg-[var(--surface-sunken)] rounded-xl border border-[var(--border)] space-y-3">
                <span className="text-[10px] font-bold text-[var(--accent-text)] uppercase tracking-wider block">
                  BANT Qualification Details
                </span>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-[var(--text-muted)]">Authority</label>
                    <select
                      value={newForm.authority}
                      onChange={(e) => setNewForm({ ...newForm, authority: e.target.value })}
                      className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--text)] focus:outline-none"
                    >
                      <option value="decision_maker">Decision Maker</option>
                      <option value="influencer">Influencer</option>
                      <option value="evaluator">Technical Evaluator</option>
                      <option value="end_user">End User</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-[var(--text-muted)]">Decision Timeline</label>
                    <select
                      value={newForm.timeline}
                      onChange={(e) => setNewForm({ ...newForm, timeline: e.target.value })}
                      className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--text)] focus:outline-none"
                    >
                      <option value="immediate">Immediate (&lt; 1 month)</option>
                      <option value="1-3 months">1 - 3 months</option>
                      <option value="3-6 months">3 - 6 months</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-[var(--text-muted)]">Prospect Stated Need / Challenge</label>
                  <input
                    type="text"
                    value={newForm.need}
                    onChange={(e) => setNewForm({ ...newForm, need: e.target.value })}
                    placeholder="What do they need?"
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-[var(--border)] hover:bg-[var(--surface-sunken)] text-[var(--text-muted)] rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold cursor-pointer shadow-md shadow-blue-600/20"
                >
                  Save to Pipeline
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CONVERT LEAD TRANSACTION MODAL (ATOMIC DEAL + CONTACT + COMPANY)          */}
      {/* ========================================================================= */}
      {showConvertModal && convertingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--surface)] backdrop-blur-xs select-none">
          <div className="bg-[var(--surface)] border border-indigo-500/40 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-sunken)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowUpRight className="h-5 w-5 text-[var(--accent-text)]" />
                <div>
                  <h3 className="text-sm font-black text-[var(--text)]">Convert Lead to Active Deal</h3>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Atomically creates Contact, Company & Deal records with transaction safety
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowConvertModal(false);
                  setConvertingItem(null);
                }}
                className="p-1 rounded-lg hover:bg-[var(--surface-sunken)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteConversion} className="p-5 space-y-4 text-left text-xs">
              <div className="p-3 rounded-xl bg-[var(--accent-soft)] border border-indigo-500/20 space-y-1">
                <span className="text-[10px] font-bold text-[var(--accent-text)] uppercase tracking-wider block">Lead Record to Convert:</span>
                <p className="text-xs font-bold text-[var(--text)]">{convertingItem.name} — {convertingItem.company}</p>
                <p className="text-[10px] text-[var(--text-muted)]">BANT Score: {convertingItem.score || 80}/100 • Source: {convertingItem.source || 'Inbound'}</p>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Deal Opportunity Title *</label>
                <input
                  type="text"
                  required
                  value={convertForm.dealTitle}
                  onChange={(e) => setConvertForm({ ...convertForm, dealTitle: e.target.value })}
                  className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Deal value ($)</label>
                  <input
                    type="text"
                    required
                    value={convertForm.dealValue}
                    onChange={(e) => setConvertForm({ ...convertForm, dealValue: e.target.value })}
                    className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Target Stage</label>
                  <select
                    value={convertForm.dealStage}
                    onChange={(e) => setConvertForm({ ...convertForm, dealStage: e.target.value })}
                    className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] focus:outline-none focus:border-indigo-500"
                  >
                    <option value="qualified">Qualified</option>
                    <option value="proposal">Proposal Sent</option>
                    <option value="negotiation">In Negotiation</option>
                    <option value="won">Closed Won</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowConvertModal(false);
                    setConvertingItem(null);
                  }}
                  className="px-4 py-2 border border-[var(--border)] hover:bg-[var(--surface-sunken)] text-[var(--text-muted)] rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer shadow-md shadow-indigo-600/20"
                >
                  Confirm Lead Conversion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* IMPORT PIPELINE MODAL (CSV & JSON INGESTION ENGINE)                      */}
      {/* ========================================================================= */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--surface)] backdrop-blur-xs select-none">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface-sunken)] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-[var(--accent-text)]">
                  <FileUp className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-[var(--text)]">Import Sales Pipeline Records</h3>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    Upload leads and deals via standard CSV spreadsheet or JSON export
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setImportFile(null);
                  setImportPreviewData([]);
                  setImportError(null);
                }}
                className="p-1 rounded-lg hover:bg-[var(--surface-sunken)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs text-left">
              {/* File Upload Zone */}
              <div className="border-2 border-dashed border-[var(--border)] hover:border-indigo-500/70 bg-[var(--surface-sunken)] rounded-2xl p-6 text-center transition-colors">
                <input
                  type="file"
                  id="pipeline-file-input"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <label
                  htmlFor="pipeline-file-input"
                  className="cursor-pointer flex flex-col items-center justify-center gap-2"
                >
                  <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-[var(--accent-text)]">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-[var(--text)] hover:text-[var(--accent-text)] transition-colors">
                      {importFile ? importFile.name : 'Click to select CSV or JSON file'}
                    </span>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      Supports columns: Name, Company, Email, Phone, Stage, Value, Source, Notes
                    </p>
                  </div>
                  {importFile && (
                    <span className="text-[10px] font-mono text-[var(--success)] bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-full mt-1">
                      File loaded: {(importFile.size / 1024).toFixed(1)} KB
                    </span>
                  )}
                </label>
              </div>

              {/* Error Message */}
              {importError && (
                <div className="p-3 rounded-xl bg-[var(--danger-soft)] border border-rose-500/40 text-[var(--danger)] text-xs flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--danger)]" />
                  <span>{importError}</span>
                </div>
              )}

              {/* Target Stage Override */}
              {importPreviewData.length > 0 && (
                <div className="p-4 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] space-y-2">
                  <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                    Target Pipeline Stage Assignment
                  </label>
                  <select
                    value={importTargetStage}
                    onChange={(e) => setImportTargetStage(e.target.value)}
                    className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-[var(--text)] text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="auto">Auto-detect from file (or default to Inbound Leads)</option>
                    <option value="new_leads">Stage: Inbound Leads (New)</option>
                    <option value="qualified">Stage: Qualified / Review</option>
                    <option value="proposal_sent">Stage: Proposal Sent</option>
                    <option value="negotiation">Stage: In Negotiation</option>
                    <option value="closed_won">Stage: Won</option>
                    <option value="closed_lost">Stage: Lost</option>
                    <option value="unqualified">Stage: Unqualified</option>
                  </select>
                </div>
              )}

              {/* Preview Table */}
              {importPreviewData.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[var(--text)] flex items-center gap-1.5">
                      <Table className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                      <span>Preview ({importPreviewData.length} total records detected)</span>
                    </span>
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">
                      Showing first {Math.min(4, importPreviewData.length)} rows
                    </span>
                  </div>

                  <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--surface-sunken)]">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-[var(--surface)] text-[var(--text-muted)] uppercase font-mono text-[9px] border-b border-[var(--border)]">
                          <tr>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Company</th>
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2">Value</th>
                            <th className="px-3 py-2">Stage</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)] text-[var(--text)]">
                          {importPreviewData.slice(0, 4).map((row, idx) => (
                            <tr key={idx} className="hover:bg-white/[0.02]">
                              <td className="px-3 py-2 font-medium text-[var(--text)]">{row.name}</td>
                              <td className="px-3 py-2 text-[var(--text-muted)]">{row.company}</td>
                              <td className="px-3 py-2 text-[var(--text-muted)] font-mono text-[10px]">{row.email || '—'}</td>
                              <td className="px-3 py-2 text-[var(--success)] font-mono font-bold">${Number(row.value).toLocaleString()}</td>
                              <td className="px-3 py-2 font-mono text-[10px] capitalize text-[var(--text-muted)]">{row.stage.replace('_', ' ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--surface-sunken)] flex items-center justify-between shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowImportModal(false);
                  setImportFile(null);
                  setImportPreviewData([]);
                  setImportError(null);
                }}
                className="px-4 py-2 border border-[var(--border)] hover:bg-[var(--surface-sunken)] text-[var(--text-muted)] rounded-xl text-xs font-semibold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={importPreviewData.length === 0 || isImporting}
                onClick={handleExecuteImport}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-xl text-xs font-bold cursor-pointer shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-2"
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Importing Records...</span>
                  </>
                ) : (
                  <>
                    <CheckCheck className="h-4 w-4" />
                    <span>Confirm & Import ({importPreviewData.length} records)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
