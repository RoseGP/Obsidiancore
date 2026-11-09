import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import {
  Users,
  Search,
  Filter,
  Plus,
  RefreshCw,
  MoreVertical,
  CheckCircle2,
  Clock,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  Building,
  Mail,
  Phone,
  Calendar,
  CheckSquare,
  Square,
  Sparkles,
  BarChart3,
  List,
  Columns3,
  DollarSign,
  UserCheck,
  ChevronRight,
  X,
  Send,
  Trash2,
  Award,
  Layers,
  Check
} from 'lucide-react';
import { CRMLead, CRMLeadTask, CRMLeadActivity } from '../../types';

interface LeadsViewProps {
  onNavigateToDeal?: (dealId?: string) => void;
  onNavigateToContact?: (contactId?: string) => void;
}

export default function LeadsView({ onNavigateToDeal, onNavigateToContact }: LeadsViewProps) {
  const team = useTeamMembers();
  // Primary state
  const [leads, setLeads] = useState<CRMLead[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedOwner, setSelectedOwner] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'kanban' | 'analytics'>('list');

  // Selection & Bulk
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isBulkProcessing, setIsBulkProcessing] = useState<boolean>(false);

  // Modals & Drawers
  const [activeLead, setActiveLead] = useState<CRMLead | null>(null);
  const [activeTasks, setActiveTasks] = useState<CRMLeadTask[]>([]);
  const [activeActivities, setActiveActivities] = useState<CRMLeadActivity[]>([]);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState<boolean>(false);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isConvertModalOpen, setIsConvertModalOpen] = useState<boolean>(false);
  const [convertingLead, setConvertingLead] = useState<CRMLead | null>(null);

  // Notification Toasts
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // Form states
  const [newLeadForm, setNewLeadForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    title: '',
    source: 'whatsapp',
    status: 'new',
    owner: '',
    budget: '',
    authority: 'decision_maker',
    need: '',
    timeline: '1-3 months',
    notes: ''
  });

  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState<boolean>(false);

  const [convertForm, setConvertForm] = useState({
    dealTitle: '',
    dealValue: '',
    dealStage: 'qualified',
    expectedClose: 'Next Month',
    companyIndustry: 'Technology',
    companyTier: 'Enterprise Tier'
  });

  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [newTaskDueDate, setNewTaskDueDate] = useState<string>('');
  const [newTaskPriority, setNewTaskPriority] = useState<'urgent' | 'high' | 'medium' | 'low'>('high');

  // Analytics state
  const [analyticsData, setAnalyticsData] = useState<any>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Fetch leads
  const fetchLeads = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      if (selectedStatus !== 'all') params.append('status', selectedStatus);
      if (selectedSource !== 'all') params.append('source', selectedSource);
      if (selectedOwner !== 'all') params.append('owner', selectedOwner);

      const res = await fetch(`/api/leads?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setLeads(data.leads || []);
      }
    } catch (err: any) {
      showToast('Failed to load leads from server.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, selectedStatus, selectedSource, selectedOwner]);

  // Fetch conversion analytics
  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch('/api/leads/analytics');
      const data = await res.json();
      if (data.success) {
        setAnalyticsData(data.analytics);
      }
    } catch (err) {
      console.warn('[fetchAnalytics error]', err);
    }
  }, []);

  useEffect(() => {
    fetchLeads();
    fetchAnalytics();
  }, [fetchLeads, fetchAnalytics]);

  // Lead details loader (drawer)
  const openLeadDetails = async (lead: CRMLead) => {
    setActiveLead(lead);
    setIsDetailDrawerOpen(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}`);
      const data = await res.json();
      if (data.success) {
        setActiveLead(data.lead);
        setActiveTasks(data.tasks || []);
        setActiveActivities(data.activities || []);
      }
    } catch (err) {
      console.warn('[openLeadDetails error]', err);
    }
  };

  // Live duplicate checking on create
  useEffect(() => {
    if (!newLeadForm.email || newLeadForm.email.length < 5 || !newLeadForm.email.includes('@')) {
      setDuplicateWarning(null);
      return;
    }
    const timer = setTimeout(async () => {
      setIsCheckingDuplicate(true);
      try {
        const res = await fetch(`/api/leads/duplicates?email=${encodeURIComponent(newLeadForm.email)}`);
        const data = await res.json();
        if (data.success && data.hasDuplicates) {
          const match = data.duplicates[0];
          setDuplicateWarning(`Potential duplicate: "${match.name}" (${match.company || 'Unknown'}) already exists in status "${match.status.toUpperCase()}".`);
        } else {
          setDuplicateWarning(null);
        }
      } catch {
        setDuplicateWarning(null);
      } finally {
        setIsCheckingDuplicate(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [newLeadForm.email]);

  // Handle lead creation
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadForm.name.trim() || !newLeadForm.email.trim()) return;

    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newLeadForm.name.trim(),
          email: newLeadForm.email.trim(),
          phone: newLeadForm.phone.trim(),
          company: newLeadForm.company.trim(),
          title: newLeadForm.title.trim(),
          source: newLeadForm.source,
          status: newLeadForm.status,
          owner: newLeadForm.owner,
          notes: newLeadForm.notes.trim(),
          qualification: {
            budget: Number(newLeadForm.budget) || 0,
            authority: newLeadForm.authority,
            need: newLeadForm.need.trim(),
            timeline: newLeadForm.timeline
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`🎉 Lead created: ${newLeadForm.name} (Score: ${data.lead.score})`, 'success');
        setIsCreateModalOpen(false);
        setNewLeadForm({
          name: '',
          email: '',
          phone: '',
          company: '',
          title: '',
          source: 'whatsapp',
          status: 'new',
          owner: '',
          budget: '',
          authority: 'decision_maker',
          need: '',
          timeline: '1-3 months',
          notes: ''
        });
        setDuplicateWarning(null);
        fetchLeads();
        fetchAnalytics();
      } else {
        showToast(data.error || 'Failed to create lead', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error saving lead', 'error');
    }
  };

  // Open convert modal
  const openConvertModal = (lead: CRMLead) => {
    if (lead.isConverted || lead.status === 'converted') {
      showToast('This lead has already been converted into a deal.', 'info');
      return;
    }
    setConvertingLead(lead);
    setConvertForm({
      dealTitle: `${lead.company || lead.name} Solution Contract`,
      dealValue: String(lead.qualification?.budget || 65000),
      dealStage: 'qualified',
      expectedClose: 'Next Month',
      companyIndustry: 'Technology',
      companyTier: 'Enterprise Tier'
    });
    setIsConvertModalOpen(true);
  };

  // Execute transactional conversion
  const handleExecuteConversion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!convertingLead) return;

    try {
      const res = await fetch(`/api/leads/${convertingLead.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealTitle: convertForm.dealTitle,
          dealValue: Number(convertForm.dealValue),
          dealStage: convertForm.dealStage,
          expectedClose: convertForm.expectedClose,
          companyIndustry: convertForm.companyIndustry,
          companyTier: convertForm.companyTier
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`🚀 Converted! Deal registered: $${Number(convertForm.dealValue).toLocaleString()} ARR.`, 'success');
        setIsConvertModalOpen(false);
        setConvertingLead(null);
        if (isDetailDrawerOpen && activeLead?.id === convertingLead.id) {
          openLeadDetails({ ...activeLead, isConverted: true, status: 'converted' });
        }
        fetchLeads();
        fetchAnalytics();
      } else {
        showToast(data.error || 'Conversion failed', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Conversion error occurred', 'error');
    }
  };

  // Status transition handler
  const handleStatusChange = async (leadId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/leads/${leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Lead status updated to ${newStatus.toUpperCase()}`, 'success');
        setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));
        if (activeLead && activeLead.id === leadId) {
          setActiveLead({ ...activeLead, status: newStatus });
        }
        fetchAnalytics();
      } else {
        showToast(data.error || 'Failed to update status', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Status change error', 'error');
    }
  };

  // Add task to lead
  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLead || !newTaskTitle.trim()) return;

    try {
      const res = await fetch(`/api/leads/${activeLead.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTaskTitle.trim(),
          dueDate: newTaskDueDate || undefined,
          priority: newTaskPriority
        })
      });
      const data = await res.json();
      if (data.success) {
        setActiveTasks(prev => [data.task, ...prev]);
        setNewTaskTitle('');
        setNewTaskDueDate('');
        showToast('Follow-up task added', 'success');
      }
    } catch {
      showToast('Error adding task', 'error');
    }
  };

  // Toggle task
  const handleToggleTask = async (taskId: string) => {
    if (!activeLead) return;
    try {
      const res = await fetch(`/api/leads/${activeLead.id}/tasks/${taskId}/toggle`, {
        method: 'PATCH'
      });
      const data = await res.json();
      if (data.success) {
        setActiveTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed: data.completed } : t));
      }
    } catch {
      showToast('Error updating task', 'error');
    }
  };

  // Bulk actions
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedLeadIds(leads.map(l => l.id));
    } else {
      setSelectedLeadIds([]);
    }
  };

  const handleToggleSelectRow = (id: string) => {
    setSelectedLeadIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleBulkStatus = async (status: string) => {
    if (selectedLeadIds.length === 0) return;
    setIsBulkProcessing(true);
    try {
      const res = await fetch('/api/leads/bulk/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedLeadIds, status })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Updated ${data.count} leads to ${status.toUpperCase()}`, 'success');
        setSelectedLeadIds([]);
        fetchLeads();
        fetchAnalytics();
      }
    } catch {
      showToast('Bulk update failed', 'error');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleBulkAssign = async (owner: string) => {
    if (selectedLeadIds.length === 0) return;
    setIsBulkProcessing(true);
    try {
      const res = await fetch('/api/leads/bulk/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedLeadIds, owner })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Assigned ${data.count} leads to ${owner}`, 'success');
        setSelectedLeadIds([]);
        fetchLeads();
      }
    } catch {
      showToast('Bulk assignment failed', 'error');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Lead Score badge color helper
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (score >= 50) return 'text-amber-700 bg-amber-50 border-amber-200';
    return 'text-neutral-600 bg-neutral-100 border-neutral-200';
  };

  const kanbanColumns = ['new', 'contacted', 'qualifying', 'qualified', 'converted'];

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--app-bg)] text-[var(--text)] overflow-hidden font-sans">
      
      {/* TOP HEADER CONTROLS */}
      <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)] flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-[var(--text)] flex items-center gap-2">
              Leads Pipeline
              <span className="text-xs font-normal text-[var(--text-muted)] font-mono tabular-nums">
                ({leads.length} recorded)
              </span>
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              Omnichannel acquisition, BANT qualification, duplicate detection, and deal conversion
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* View mode segmented switcher */}
          <div className="flex items-center bg-[var(--app-bg)] p-0.5 rounded-xl border border-[var(--border)] text-xs">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-[var(--surface)] text-[var(--text)] shadow-xs font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <List className="h-3.5 w-3.5" />
              <span>List</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                viewMode === 'kanban'
                  ? 'bg-[var(--surface)] text-[var(--text)] shadow-xs font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" />
              <span>Pipeline</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('analytics')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                viewMode === 'analytics'
                  ? 'bg-[var(--surface)] text-[var(--text)] shadow-xs font-semibold'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Analytics</span>
            </button>
          </div>

          <button
            type="button"
            onClick={fetchLeads}
            className="p-2 rounded-xl border border-[var(--border)] hover:bg-[var(--app-bg)] text-[var(--text-muted)] transition cursor-pointer"
            title="Refresh leads"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-blue-500' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-xs hover:shadow-md transition cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>New Lead</span>
          </button>
        </div>
      </div>

      {/* FILTER & SEARCH TOOLBAR */}
      {viewMode !== 'analytics' && (
        <div className="px-6 py-2.5 border-b border-[var(--border)] bg-[var(--surface)]/70 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
              <input
                type="text"
                placeholder="Search leads by name, email, company, notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--app-bg)] text-xs text-[var(--text)] placeholder-neutral-400 focus:outline-none focus:border-blue-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Status filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-muted)]">Status:</span>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs text-[var(--text)] focus:outline-none cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="new">New Inbound</option>
                <option value="contacted">Contacted</option>
                <option value="qualifying">Qualifying</option>
                <option value="qualified">Qualified</option>
                <option value="converted">Converted</option>
                <option value="unqualified">Unqualified</option>
              </select>
            </div>

            {/* Source channel filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-muted)]">Source:</span>
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs text-[var(--text)] focus:outline-none cursor-pointer"
              >
                <option value="all">All Channels</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="voice">Voice Dialer</option>
                <option value="email">Email</option>
                <option value="linkedin">LinkedIn</option>
                <option value="website">Website</option>
                <option value="referral">Referral</option>
              </select>
            </div>

            {/* Owner filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-muted)]">Owner:</span>
              <select
                value={selectedOwner}
                onChange={(e) => setSelectedOwner(e.target.value)}
                className="px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] text-xs text-[var(--text)] focus:outline-none cursor-pointer"
              >
                <option value="all">All Reps</option>
                {team.names.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* BULK ACTION BAR */}
      {selectedLeadIds.length > 0 && viewMode === 'list' && (
        <div className="px-6 py-2 bg-blue-50/80 border-b border-blue-200/80 flex items-center justify-between text-xs animate-in slide-in-from-top-1">
          <div className="flex items-center gap-2 text-blue-900 font-semibold">
            <CheckSquare className="h-4 w-4 text-blue-600" />
            <span>{selectedLeadIds.length} lead(s) selected</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-blue-800">Set Status:</span>
              <select
                disabled={isBulkProcessing}
                onChange={(e) => e.target.value && handleBulkStatus(e.target.value)}
                defaultValue=""
                className="px-2 py-0.5 rounded border border-blue-300 bg-white text-xs cursor-pointer"
              >
                <option value="" disabled>Change status...</option>
                <option value="contacted">Mark Contacted</option>
                <option value="qualifying">Mark Qualifying</option>
                <option value="qualified">Mark Qualified</option>
                <option value="unqualified">Mark Unqualified</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[11px] text-blue-800">Assign Rep:</span>
              <select
                disabled={isBulkProcessing}
                onChange={(e) => e.target.value && handleBulkAssign(e.target.value)}
                defaultValue=""
                className="px-2 py-0.5 rounded border border-blue-300 bg-white text-xs cursor-pointer"
              >
                <option value="" disabled>Choose closer...</option>
                {team.names.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            <button
              type="button"
              onClick={() => setSelectedLeadIds([])}
              className="px-2 py-0.5 text-blue-700 hover:text-blue-900 font-medium"
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* MAIN VIEW CONTENT */}
      <div className="flex-1 overflow-auto p-6">
        
        {/* VIEW 1: TABLE / LIST VIEW */}
        {viewMode === 'list' && (
          <div className="w-full bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden shadow-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--app-bg)]/50 text-[11px] font-semibold text-[var(--text-muted)] tracking-wide uppercase">
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={leads.length > 0 && selectedLeadIds.length === leads.length}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="rounded border-[var(--border)] text-blue-600 focus:ring-0 cursor-pointer"
                    />
                  </th>
                  <th className="py-3 px-4">Lead & Organization</th>
                  <th className="py-3 px-4">Channel Source</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-center">Score</th>
                  <th className="py-3 px-4">Assigned Closer</th>
                  <th className="py-3 px-4">Target Budget</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] text-xs">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-neutral-400">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-blue-500" />
                      Loading CRM leads database...
                    </td>
                  </tr>
                ) : leads.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-neutral-400">
                      No leads match your search criteria.
                    </td>
                  </tr>
                ) : (
                  leads.map((lead) => {
                    const isSelected = selectedLeadIds.includes(lead.id);

                    return (
                      <tr
                        key={lead.id}
                        className={`hover:bg-[var(--app-bg)]/60 transition ${isSelected ? 'bg-blue-50/30' : ''}`}
                      >
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectRow(lead.id)}
                            className="rounded border-[var(--border)] text-blue-600 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-col">
                            <button
                              type="button"
                              onClick={() => openLeadDetails(lead)}
                              className="font-bold text-[var(--text)] hover:text-blue-600 text-left transition truncate cursor-pointer"
                            >
                              {lead.name}
                            </button>
                            <span className="text-[11px] text-[var(--text-muted)] truncate">
                              {lead.title ? `${lead.title} · ` : ''}{lead.company || 'Direct Inbound'}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono font-semibold uppercase text-[11px] text-neutral-600">
                            {lead.source}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-block w-2 h-2 rounded-full ${
                              lead.status === 'converted' ? 'bg-emerald-500' :
                              lead.status === 'qualified' ? 'bg-blue-500' :
                              lead.status === 'qualifying' ? 'bg-indigo-500' :
                              lead.status === 'contacted' ? 'bg-amber-500' :
                              lead.status === 'unqualified' ? 'bg-neutral-400' : 'bg-slate-500'
                            }`} />
                            <span className="capitalize font-medium text-neutral-700">
                              {lead.status}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-mono font-bold border ${getScoreColor(lead.score || 50)}`}>
                            {lead.score || 50}/100
                          </span>
                        </td>
                        <td className="py-3 px-4 text-neutral-700">
                          {lead.owner || 'Unassigned'}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-neutral-800">
                          {lead.qualification?.budget ? `$${Number(lead.qualification.budget).toLocaleString()}` : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {lead.isConverted ? (
                              <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 px-2 py-1 bg-emerald-50 rounded-lg">
                                <Check className="h-3 w-3" />
                                <span>Converted</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openConvertModal(lead)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold shadow-2xs hover:shadow-xs transition cursor-pointer flex items-center gap-1"
                                title="Convert to Deal + Contact"
                              >
                                <DollarSign className="h-3 w-3" />
                                <span>Convert</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => openLeadDetails(lead)}
                              className="p-1.5 rounded-lg hover:bg-neutral-100 text-neutral-500 hover:text-neutral-800 transition cursor-pointer"
                              title="View Details"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* VIEW 2: KANBAN PIPELINE VIEW */}
        {viewMode === 'kanban' && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 h-full items-start">
            {kanbanColumns.map((colKey) => {
              const columnLeads = leads.filter(l => l.status === colKey);
              const columnValue = columnLeads.reduce((acc, l) => acc + (Number(l.qualification?.budget) || 0), 0);

              return (
                <div
                  key={colKey}
                  className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-3 flex flex-col max-h-[calc(100vh-210px)] overflow-hidden shadow-2xs"
                >
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border)]">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text)]">
                        {colKey}
                      </h3>
                      <span className="text-[10px] text-[var(--text-muted)] font-mono tabular-nums">
                        {columnLeads.length} leads · ${columnValue.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2.5 overflow-y-auto pr-1 flex-1">
                    {columnLeads.map((lead) => (
                      <div
                        key={lead.id}
                        onClick={() => openLeadDetails(lead)}
                        className="p-3 bg-[var(--app-bg)] rounded-xl border border-[var(--border)] hover:border-blue-400 hover:shadow-md transition cursor-pointer group"
                      >
                        <div className="flex items-start justify-between gap-1 mb-1.5">
                          <h4 className="text-xs font-bold text-[var(--text)] group-hover:text-blue-600 transition truncate">
                            {lead.name}
                          </h4>
                          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${getScoreColor(lead.score || 50)}`}>
                            {lead.score || 50}
                          </span>
                        </div>

                        <div className="text-[11px] text-[var(--text-muted)] truncate mb-2">
                          {lead.company || 'Individual Client'}
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] pt-2 border-t border-[var(--border)]/70">
                          <span className="font-mono uppercase font-semibold text-neutral-600">
                            {lead.source}
                          </span>
                          <span className="font-mono tabular-nums font-bold text-neutral-800">
                            {lead.qualification?.budget ? `$${Number(lead.qualification.budget).toLocaleString()}` : '—'}
                          </span>
                        </div>

                        {!lead.isConverted && colKey === 'qualified' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openConvertModal(lead);
                            }}
                            className="w-full mt-2 py-1 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-semibold flex items-center justify-center gap-1 transition"
                          >
                            <DollarSign className="h-3 w-3" />
                            <span>Convert to Deal</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* VIEW 3: CONVERSION ANALYTICS & FUNNEL VIEW */}
        {viewMode === 'analytics' && analyticsData && (
          <div className="space-y-6 max-w-6xl mx-auto">
            
            {/* Top KPI row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <span className="text-xs text-[var(--text-muted)]">Total Ingested Leads</span>
                <div className="text-2xl font-black font-mono tabular-nums text-[var(--text)] mt-1">
                  {analyticsData.totalLeads}
                </div>
                <div className="text-[11px] text-neutral-500 mt-0.5">
                  Across all omnichannel sources
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <span className="text-xs text-[var(--text-muted)]">Lead Conversion Rate</span>
                <div className="text-2xl font-black font-mono tabular-nums text-emerald-600 mt-1">
                  {analyticsData.conversionRate}%
                </div>
                <div className="text-[11px] text-neutral-500 mt-0.5">
                  {analyticsData.convertedCount} successfully converted to deals
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <span className="text-xs text-[var(--text-muted)]">Qualification Rate</span>
                <div className="text-2xl font-black font-mono tabular-nums text-blue-600 mt-1">
                  {analyticsData.qualificationRate}%
                </div>
                <div className="text-[11px] text-neutral-500 mt-0.5">
                  BANT budget and authority confirmed
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <span className="text-xs text-[var(--text-muted)]">Avg Lead Score</span>
                <div className="text-2xl font-black font-mono tabular-nums text-amber-600 mt-1">
                  {analyticsData.avgScore}/100
                </div>
                <div className="text-[11px] text-neutral-500 mt-0.5">
                  Dynamic multi-factor algorithm
                </div>
              </div>
            </div>

            {/* Funnel Dropoff Chart */}
            <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-xs">
              <h3 className="text-sm font-bold text-[var(--text)] mb-3">Lifecycle Conversion Funnel</h3>
              <div className="space-y-3">
                {analyticsData.funnel.map((step: any) => {
                  const percent = analyticsData.totalLeads > 0
                    ? Math.round((step.count / analyticsData.totalLeads) * 100)
                    : 0;

                  return (
                    <div key={step.stage}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-neutral-800">{step.label}</span>
                        <span className="font-mono tabular-nums text-neutral-500">
                          {step.count} ({percent}%)
                        </span>
                      </div>
                      <div className="h-2 w-full bg-neutral-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 rounded-full transition-all duration-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Source and Rep Rankings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <h3 className="text-sm font-bold text-[var(--text)] mb-3">Conversions by Acquisition Source</h3>
                <div className="divide-y divide-[var(--border)] text-xs">
                  {Object.entries(analyticsData.sourceBreakdown || {}).map(([src, stat]: [string, any]) => (
                    <div key={src} className="py-2.5 flex items-center justify-between">
                      <span className="font-semibold uppercase font-mono text-neutral-700">{src}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-neutral-500 font-mono tabular-nums">{stat.converted} / {stat.total}</span>
                        <span className="font-mono font-bold text-emerald-600 tabular-nums">{stat.rate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-xs">
                <h3 className="text-sm font-bold text-[var(--text)] mb-3">Closer Performance Rankings</h3>
                <div className="divide-y divide-[var(--border)] text-xs">
                  {Object.entries(analyticsData.repPerformance || {}).map(([rep, stat]: [string, any]) => (
                    <div key={rep} className="py-2.5 flex items-center justify-between">
                      <span className="font-medium text-neutral-800">{rep}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-neutral-500 font-mono tabular-nums">{stat.converted} deals closed</span>
                        <span className="font-mono font-bold text-blue-600 tabular-nums">{stat.rate}% win</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}

      </div>

      {/* LEAD DETAIL DRAWER */}
      {isDetailDrawerOpen && activeLead && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
          <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
            <div className="min-w-0 pr-3">
              <h2 className="text-base font-bold text-[var(--text)] truncate">{activeLead.name}</h2>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {activeLead.title ? `${activeLead.title} · ` : ''}{activeLead.company || 'Direct Inbound'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsDetailDrawerOpen(false)}
              className="p-1.5 rounded-lg hover:bg-[var(--app-bg)] text-neutral-400 hover:text-neutral-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
            
            {/* Status & Conversion banner */}
            {activeLead.isConverted ? (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center justify-between">
                <div>
                  <div className="font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Converted to Deal</span>
                  </div>
                  <div className="text-[11px] text-emerald-700 mt-0.5 font-mono">
                    Deal ID: {activeLead.convertedDealId || 'Synchronized'}
                  </div>
                </div>
                {onNavigateToDeal && activeLead.convertedDealId && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsDetailDrawerOpen(false);
                      onNavigateToDeal(activeLead.convertedDealId);
                    }}
                    className="px-2.5 py-1 bg-white rounded-lg text-[11px] font-semibold text-emerald-700 border border-emerald-300 shadow-2xs hover:bg-emerald-50 cursor-pointer"
                  >
                    View Deal →
                  </button>
                )}
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-blue-50/80 border border-blue-200 flex items-center justify-between">
                <div>
                  <div className="font-bold text-blue-900">Ready to Convert?</div>
                  <div className="text-[11px] text-blue-700 mt-0.5">
                    Transactionally creates Contact, Company, and Deal
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openConvertModal(activeLead)}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-xs cursor-pointer flex items-center gap-1"
                >
                  <DollarSign className="h-3.5 w-3.5" />
                  <span>Convert</span>
                </button>
              </div>
            )}

            {/* Quick Status Bar */}
            <div>
              <label className="block text-[11px] font-bold text-neutral-700 mb-1">Current Lifecycle Status</label>
              <select
                disabled={activeLead.isConverted}
                value={activeLead.status}
                onChange={(e) => handleStatusChange(activeLead.id, e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--app-bg)] text-xs text-[var(--text)] font-semibold cursor-pointer"
              >
                <option value="new">New Inbound</option>
                <option value="contacted">Contacted</option>
                <option value="qualifying">Qualifying</option>
                <option value="qualified">Qualified</option>
                <option value="unqualified">Unqualified</option>
                <option value="converted" disabled>Converted</option>
              </select>
            </div>

            {/* Contact Details Grid */}
            <div className="space-y-2 p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--border)]">
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 text-neutral-400" />
                <span className="text-neutral-700 font-mono">{activeLead.email}</span>
              </div>
              {activeLead.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-neutral-400" />
                  <span className="text-neutral-700 font-mono">{activeLead.phone}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Building className="h-3.5 w-3.5 text-neutral-400" />
                <span className="text-neutral-700">{activeLead.company || 'Direct Client'}</span>
              </div>
            </div>

            {/* BANT Qualification Card */}
            <div className="p-3.5 rounded-xl bg-[var(--app-bg)] border border-[var(--border)] space-y-2">
              <h4 className="font-bold text-neutral-800 text-xs">BANT Qualification</h4>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-neutral-400 block">Budget:</span>
                  <span className="font-mono font-bold text-neutral-800">
                    {activeLead.qualification?.budget ? `$${Number(activeLead.qualification.budget).toLocaleString()}` : 'Not Specified'}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-400 block">Authority:</span>
                  <span className="capitalize font-medium text-neutral-800">
                    {activeLead.qualification?.authority?.replace('_', ' ') || 'Evaluator'}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-400 block">Timeline:</span>
                  <span className="font-medium text-neutral-800">
                    {activeLead.qualification?.timeline || '1-3 months'}
                  </span>
                </div>
                <div>
                  <span className="text-neutral-400 block">Score:</span>
                  <span className="font-mono font-bold text-blue-600">
                    {activeLead.score}/100
                  </span>
                </div>
              </div>
              {activeLead.qualification?.need && (
                <div className="pt-2 border-t border-neutral-200 text-[11px] text-neutral-600">
                  <span className="font-semibold text-neutral-700">Need / Problem: </span>
                  {activeLead.qualification.need}
                </div>
              )}
            </div>

            {/* Follow-up Tasks */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-neutral-800 text-xs">Follow-up Tasks</h4>
                <span className="text-[10px] font-mono text-neutral-400">
                  {activeTasks.filter(t => t.completed).length} / {activeTasks.length} done
                </span>
              </div>

              {/* Add task form */}
              <form onSubmit={handleAddTask} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Schedule call, send proposal..."
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-white text-xs text-[var(--text)]"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold text-xs cursor-pointer"
                >
                  Add
                </button>
              </form>

              <div className="space-y-1.5">
                {activeTasks.length === 0 ? (
                  <div className="py-3 text-center text-neutral-400 text-[11px]">
                    No tasks assigned to this lead.
                  </div>
                ) : (
                  activeTasks.map((t) => (
                    <div
                      key={t.id}
                      className="p-2 rounded-lg bg-white border border-neutral-200 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <button
                          type="button"
                          onClick={() => handleToggleTask(t.id)}
                          className="shrink-0 text-neutral-400 hover:text-neutral-700"
                        >
                          {t.completed ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                        <span className={`truncate text-xs ${t.completed ? 'line-through text-neutral-400' : 'text-neutral-800'}`}>
                          {t.title}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-neutral-400 shrink-0">
                        {new Date(t.dueDate).toLocaleDateString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Activity History */}
            <div className="space-y-2">
              <h4 className="font-bold text-neutral-800 text-xs">Activity History</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {activeActivities.length === 0 ? (
                  <div className="py-3 text-center text-neutral-400 text-[11px]">
                    No activity recorded yet.
                  </div>
                ) : (
                  activeActivities.map((act) => (
                    <div key={act.id} className="p-2 rounded-lg bg-[var(--app-bg)] text-[11px] border border-[var(--border)]">
                      <div className="font-semibold text-neutral-800">{act.title}</div>
                      <div className="text-neutral-500 mt-0.5">{act.description}</div>
                      <div className="text-[10px] text-neutral-400 font-mono mt-1">
                        {act.actor} · {new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* CREATE LEAD MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-lg bg-[var(--surface)] rounded-3xl border border-[var(--border)] shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <h3 className="text-sm font-bold text-[var(--text)]">Register Inbound Lead</h3>
                <p className="text-xs text-[var(--text-muted)]">Automatic scoring and duplicate detection</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Live Duplicate Warning */}
            {duplicateWarning && (
              <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>{duplicateWarning}</span>
              </div>
            )}

            <form onSubmit={handleCreateLead} className="mt-4 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="Full name"
                    value={newLeadForm.name}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Work Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="m.chen@alphatech.com"
                    value={newLeadForm.email}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Company</label>
                  <input
                    type="text"
                    placeholder="AlphaTech Global"
                    value={newLeadForm.company}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, company: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 349-2041"
                    value={newLeadForm.phone}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 focus:bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Source</label>
                  <select
                    value={newLeadForm.source}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, source: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 focus:bg-white"
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="voice">Voice Dialer</option>
                    <option value="email">Email</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="website">Website</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Budget ($)</label>
                  <input
                    type="number"
                    placeholder="50000"
                    value={newLeadForm.budget}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, budget: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 font-mono focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Owner</label>
                  <select
                    value={newLeadForm.owner}
                    onChange={(e) => setNewLeadForm({ ...newLeadForm, owner: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 focus:bg-white"
                  >
                    <option value="">Unassigned</option>
                    {team.names.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-neutral-700 mb-1">Notes / Specific Need</label>
                <textarea
                  rows={2}
                  placeholder="Requested enterprise WebRTC Call Canvas consultation..."
                  value={newLeadForm.notes}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, notes: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 focus:bg-white"
                />
              </div>

              <div className="pt-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-neutral-600 hover:text-neutral-900 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-xs"
                >
                  Save Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LEAD CONVERSION TRANSACTION MODAL */}
      {isConvertModalOpen && convertingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-[var(--surface)] rounded-3xl border border-[var(--border)] shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700">
                  <DollarSign className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text)]">Convert Lead to Pipeline Deal</h3>
                  <p className="text-xs text-[var(--text-muted)]">Atomic creation of Contact, Company & Deal</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsConvertModalOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteConversion} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-[11px] font-bold text-neutral-700 mb-1">Deal Title</label>
                <input
                  type="text"
                  required
                  value={convertForm.dealTitle}
                  onChange={(e) => setConvertForm({ ...convertForm, dealTitle: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 focus:bg-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Deal Value ($ ARR)</label>
                  <input
                    type="number"
                    required
                    value={convertForm.dealValue}
                    onChange={(e) => setConvertForm({ ...convertForm, dealValue: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 font-mono focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-neutral-700 mb-1">Pipeline Stage</label>
                  <select
                    value={convertForm.dealStage}
                    onChange={(e) => setConvertForm({ ...convertForm, dealStage: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[var(--border)] bg-neutral-50/50 text-neutral-900 focus:bg-white"
                  >
                    <option value="qualified">Qualified</option>
                    <option value="proposal">Proposal</option>
                    <option value="negotiation">Negotiation</option>
                  </select>
                </div>
              </div>

              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100 text-[11px] space-y-1">
                <div className="font-semibold text-neutral-700">Atomic Associations:</div>
                <div className="text-neutral-500">· Contact: <span className="text-neutral-800">{convertingLead.name} ({convertingLead.email})</span></div>
                <div className="text-neutral-500">· Company: <span className="text-neutral-800">{convertingLead.company || `${convertingLead.name} Corp`}</span></div>
                <div className="text-neutral-500">· Channel Origin: <span className="text-neutral-800 uppercase font-mono">{convertingLead.source}</span></div>
              </div>

              <div className="pt-3 border-t border-[var(--border)] flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsConvertModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-neutral-600 hover:text-neutral-900 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-xs flex items-center gap-1.5"
                >
                  <Check className="h-4 w-4" />
                  <span>Execute Conversion</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FLOAT NOTIFICATION TOAST */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-right ${
          toast.type === 'error'
            ? 'bg-rose-900 text-rose-100 border border-rose-700'
            : toast.type === 'info'
            ? 'bg-neutral-900 text-white border border-neutral-700'
            : 'bg-emerald-900 text-emerald-100 border border-emerald-700'
        }`}>
          {toast.type === 'error' ? (
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

    </div>
  );
}
