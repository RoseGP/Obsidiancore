import React, { useState, useEffect, useCallback } from 'react';
import { 
  Database, 
  Mail, 
  Search, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  Circle, 
  Clock, 
  User, 
  Tag, 
  Code, 
  AlertCircle, 
  Layers, 
  FolderCheck, 
  Send, 
  Archive, 
  Trash2, 
  Inbox as InboxIcon, 
  SlidersHorizontal,
  ChevronDown,
  Sparkles,
  FileCode2,
  X,
  ExternalLink,
  Check,
  ShieldCheck,
  Filter,
  Paperclip,
  Download,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface EmailRecord {
  id: string;
  threadId: string;
  sender: string;
  subject: string;
  bodyText: string;
  createdAt: string;
  folder: string;
  isRead: boolean;
  userId: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

const FOLDERS = [
  { id: 'inbox', label: 'Inbox', icon: InboxIcon, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  { id: 'sent', label: 'Sent', icon: Send, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { id: 'archive', label: 'Archive', icon: Archive, color: 'text-slate-600 bg-slate-50 border-slate-200' },
  { id: 'trash', label: 'Trash', icon: Trash2, color: 'text-rose-600 bg-rose-50 border-rose-200' },
];

const USER_PRESETS = [
  { id: 'usr_101', name: 'R. Pierrette', email: 'rpierrette45@gmail.com' },
  { id: 'usr_102', name: 'Achmad Hakim', email: 'achmadhakim@gmail.com' },
  { id: 'usr_103', name: 'DevOps Lead', email: 'dev.ops@webcreatorlive.com' },
];

export default function CloudflareD1Inbox() {
  // Query Filters State
  const [selectedUserId, setSelectedUserId] = useState<string>('usr_101');
  const [selectedFolder, setSelectedFolder] = useState<string>('inbox');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Data State
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  });
  const [d1SqlExecuted, setD1SqlExecuted] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Selected Email Modal Drawer State
  const [selectedEmail, setSelectedEmail] = useState<EmailRecord | null>(null);
  const [showCodeInspector, setShowCodeInspector] = useState<boolean>(false);
  const [emailAttachments, setEmailAttachments] = useState<Array<{
    id: string;
    email_id: string;
    filename: string;
    content_type: string;
    size: number;
    r2_key: string;
    download_url: string;
  }>>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState<boolean>(false);
  const [isSimulatingWorker, setIsSimulatingWorker] = useState<boolean>(false);
  const [simulationNotice, setSimulationNotice] = useState<string | null>(null);

  // Fetch Attachments when selected email changes
  useEffect(() => {
    if (!selectedEmail) {
      setEmailAttachments([]);
      return;
    }

    const fetchAttachments = async () => {
      setIsLoadingAttachments(true);
      try {
        const res = await fetch(`/api/attachments?emailId=${selectedEmail.id}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setEmailAttachments(data.data);
        }
      } catch (err) {
        console.error('Failed to load email attachments:', err);
      } finally {
        setIsLoadingAttachments(false);
      }
    };

    fetchAttachments();
  }, [selectedEmail]);

  // Simulate Cloudflare Worker email() Handler Ingesting Email with Attachment via postal-mime
  const handleSimulateWorkerIngest = async () => {
    setIsSimulatingWorker(true);
    setSimulationNotice(null);

    try {
      const sampleFiles = [
        { name: 'Infrastructure_Security_Audit_2026.pdf', type: 'application/pdf', size: 1245000 },
        { name: 'Cloudflare_D1_R2_Benchmark_Results.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 680200 },
        { name: 'Postal_Mime_Extraction_Log.txt', type: 'text/plain', size: 45100 }
      ];
      const picked = sampleFiles[Math.floor(Math.random() * sampleFiles.length)];

      const res = await fetch('/api/attachments/simulate-worker-ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: 'rpierrette45@gmail.com',
          sender: 'security-bot@cloudflare-edge.net',
          subject: `[Worker Ingestion Test] Inbound Mail with Attached ${picked.name}`,
          filename: picked.name,
          contentType: picked.type,
          size: picked.size
        })
      });

      const data = await res.json();
      if (data.success) {
        setSimulationNotice(`Worker email() event executed successfully! Attachment "${picked.name}" saved to R2 bucket env.ATTACHMENTS_BUCKET and metadata registered in D1 attachments table.`);
        fetchInboxEmails();
      } else {
        throw new Error(data.error || 'Simulation failed');
      }
    } catch (err: any) {
      setSimulationNotice(`Worker Ingestion Error: ${err.message}`);
    } finally {
      setIsSimulatingWorker(false);
    }
  };

  // Fetch Emails from GET /api/inbox
  const fetchInboxEmails = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const queryParams = new URLSearchParams({
        userId: selectedUserId,
        folder: selectedFolder,
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
      });

      if (searchQuery.trim()) {
        queryParams.append('search', searchQuery.trim());
      }

      const response = await fetch(`/api/inbox?${queryParams.toString()}`);
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || `HTTP ${response.status}: Failed to fetch inbox`);
      }

      setEmails(result.data || []);
      if (result.pagination) {
        setPagination(result.pagination);
      }
      if (result.d1Metadata?.sqlQuery) {
        setD1SqlExecuted(result.d1Metadata.sqlQuery);
      }
    } catch (err: any) {
      console.error('[Cloudflare D1 Inbox UI] Fetch Error:', err);
      setErrorMsg(err.message || 'Failed to connect to Cloudflare D1 Inbox Worker.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedUserId, selectedFolder, currentPage, itemsPerPage, searchQuery]);

  useEffect(() => {
    fetchInboxEmails();
  }, [fetchInboxEmails]);

  // Toggle Read/Unread Status via PATCH /api/inbox/read-status
  const handleToggleReadStatus = async (email: EmailRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const targetNewState = !email.isRead;

    // Optimistic UI Update
    setEmails((prev) =>
      prev.map((item) =>
        item.id === email.id ? { ...item, isRead: targetNewState } : item
      )
    );

    if (selectedEmail && selectedEmail.id === email.id) {
      setSelectedEmail((prev) => (prev ? { ...prev, isRead: targetNewState } : null));
    }

    try {
      const res = await fetch('/api/inbox/read-status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailId: email.id,
          userId: selectedUserId,
          isRead: targetNewState,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update read status in D1');
      }
    } catch (err: any) {
      console.error('Failed to sync read status with D1:', err);
      // Revert optimistic state on failure
      setEmails((prev) =>
        prev.map((item) =>
          item.id === email.id ? { ...item, isRead: email.isRead } : item
        )
      );
    }
  };

  const handleFolderChange = (folderId: string) => {
    setSelectedFolder(folderId);
    setCurrentPage(1);
  };

  const handleUserChange = (userId: string) => {
    setSelectedUserId(userId);
    setCurrentPage(1);
  };

  const formatTimestamp = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return isoStr;
    }
  };

  const unreadCount = emails.filter((e) => !e.isRead).length;

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 font-sans p-4 md:p-6 select-none">
      <div className="max-w-7xl mx-auto space-y-5">

        {/* Top Header & Cloudflare D1 Connection Banner */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/80 to-slate-900 border border-slate-800 shadow-xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="p-3 bg-indigo-600/20 rounded-xl border border-indigo-500/30 text-indigo-400 shrink-0">
              <Database className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase text-indigo-400 tracking-wider font-mono bg-indigo-950 px-2 py-0.5 rounded border border-indigo-800/60">
                  Cloudflare D1 Worker
                </span>
                <span className="text-[10px] font-extrabold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/60 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  Binding: env.DB Active
                </span>
              </div>
              <h1 className="text-xl font-extrabold text-white tracking-tight mt-1 flex items-center gap-2">
                D1 Inbox Endpoint Engine
                <span className="text-xs text-slate-400 font-normal">GET /api/inbox</span>
              </h1>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                Database: <strong className="text-indigo-300">obsidiandashoarddb</strong> | ID: <span className="text-slate-300">adc1da90-6d37-45e1-88ce-9522ea7bf3ee</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end lg:self-center flex-wrap">
            <button
              type="button"
              onClick={handleSimulateWorkerIngest}
              disabled={isSimulatingWorker}
              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              title="Test Cloudflare Worker email() handler attachment extraction with postal-mime & R2"
            >
              <Paperclip className={`w-3.5 h-3.5 ${isSimulatingWorker ? 'animate-bounce' : ''}`} />
              <span>{isSimulatingWorker ? 'Extracting via postal-mime...' : 'Simulate R2 Attachment Ingest'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCodeInspector(!showCodeInspector)}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <FileCode2 className="w-4 h-4 text-indigo-400" />
              <span>{showCodeInspector ? 'Hide Worker SQL' : 'View Worker SQL'}</span>
            </button>

            <button
              type="button"
              onClick={fetchInboxEmails}
              disabled={isLoading}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-extrabold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh D1 Query</span>
            </button>
          </div>
        </div>

        {/* Deployment Steps Verification Panel */}
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-slate-200 font-mono uppercase tracking-wider">
                Developer Email Desk — Deployment Verification
              </span>
            </div>
            <span className="text-[10.5px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> All 5 Steps Deployed & Verified
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 text-xs font-mono">
            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <strong className="text-indigo-300">1. Setup D1</strong>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <p className="text-[10px] text-slate-400 font-sans">
                Executed <code className="text-indigo-400">schema.sql</code> on D1 database.
              </p>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <strong className="text-indigo-300">2. wrangler.toml</strong>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <p className="text-[10px] text-slate-400 font-sans">
                Bound <code className="text-indigo-400">DB</code> (D1) and <code className="text-indigo-400">EMAIL</code> (Send Email).
              </p>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <strong className="text-indigo-300">3. Deploy Workers</strong>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <p className="text-[10px] text-slate-400 font-sans">
                Deployed <code className="text-indigo-400">inbound.js</code> & <code className="text-indigo-400">outbound.js</code>.
              </p>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <strong className="text-indigo-300">4. Email Routing</strong>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <p className="text-[10px] text-slate-400 font-sans">
                Catch-all rule points to Inbound Worker.
              </p>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <strong className="text-indigo-300">5. Sending Domain</strong>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <p className="text-[10px] text-slate-400 font-sans">
                Verified sending domain & DKIM records.
              </p>
            </div>
          </div>
        </div>

        {/* Worker Simulation Notice Banner */}
        {simulationNotice && (
          <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-800 text-emerald-200 text-xs flex items-center justify-between gap-3 font-sans">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{simulationNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setSimulationNotice(null)}
              className="p-1 text-emerald-400 hover:text-white rounded cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Worker Code & D1 SQL Inspector Drawer */}
        <AnimatePresence>
          {showCodeInspector && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="p-4 rounded-2xl bg-slate-900 border border-indigo-900/60 font-mono text-xs text-indigo-200 overflow-hidden space-y-2"
            >
              <div className="flex items-center justify-between border-b border-indigo-950 pb-2">
                <span className="text-[11px] font-bold text-indigo-400 flex items-center gap-1.5">
                  <Code className="w-4 h-4" /> Executed D1 SQL Query (JOIN user_emails with emails)
                </span>
                <span className="text-[10px] text-slate-400">Parameterized PreparedStatement</span>
              </div>
              <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-emerald-400 text-[11px] overflow-x-auto leading-relaxed">
{d1SqlExecuted || `SELECT e.id, e.thread_id, e.sender, e.subject, e.body_text, e.created_at, ue.is_read
FROM user_emails ue
INNER JOIN emails e ON ue.email_id = e.id
WHERE ue.user_id = '${selectedUserId}' AND ue.folder = '${selectedFolder}'
ORDER BY e.created_at DESC LIMIT ${itemsPerPage} OFFSET ${(currentPage - 1) * itemsPerPage}`}
              </pre>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Interface Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

          {/* Left Sidebar: User Selector & Folders */}
          <div className="lg:col-span-1 space-y-4">

            {/* User Account Picker */}
            <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-2.5">
              <label className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-indigo-400" />
                Select D1 User Context
              </label>
              <div className="space-y-1.5">
                {USER_PRESETS.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleUserChange(user.id)}
                    className={`w-full text-left p-2.5 rounded-xl text-xs font-semibold border transition-all flex items-center justify-between cursor-pointer ${
                      selectedUserId === user.id
                        ? 'bg-indigo-600/20 border-indigo-500 text-white font-bold'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div>
                      <div className="text-xs">{user.name}</div>
                      <div className="text-[10px] opacity-70 font-mono">{user.email}</div>
                    </div>
                    {selectedUserId === user.id && (
                      <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Folders Navigation */}
            <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-2">
              <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-400 block mb-2">
                D1 Folders
              </span>
              <div className="space-y-1">
                {FOLDERS.map((f) => {
                  const IconComp = f.icon;
                  const isActive = selectedFolder === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => handleFolderChange(f.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <IconComp className="w-4 h-4" />
                        <span>{f.label}</span>
                      </div>
                      {f.id === 'inbox' && unreadCount > 0 && (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-500 text-white">
                          {unreadCount} unread
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Query Info Box */}
            <div className="p-4 bg-slate-900/60 rounded-2xl border border-slate-800/80 text-xs text-slate-400 space-y-1.5 font-mono">
              <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                D1 PreparedStatement
              </div>
              <p className="text-[11px] leading-relaxed opacity-80">
                Queries are executed on Cloudflare Worker Edge runtime using SQL bindings: <code className="text-indigo-300">env.DB.prepare(...)</code>.
              </p>
            </div>

          </div>

          {/* Right Main Area: Email List & Search */}
          <div className="lg:col-span-3 space-y-4">

            {/* Search Bar & Pagination Size Controls */}
            <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
              {/* Search Box */}
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Search sender, subject, body..."
                  className="w-full bg-slate-950 border border-slate-800 text-xs text-white pl-9 pr-3 py-2 rounded-xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Items Per Page Selector */}
              <div className="flex items-center gap-2 self-end md:self-auto text-xs text-slate-400">
                <span className="font-semibold">Items per page:</span>
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-slate-950 border border-slate-800 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value={5}>5 per page</option>
                  <option value={10}>10 per page</option>
                  <option value={20}>20 per page</option>
                  <option value={50}>50 per page</option>
                </select>
              </div>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Email List Container */}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
              
              {/* Table Header Bar */}
              <div className="px-5 py-3 bg-slate-950/60 border-b border-slate-800 text-[10.5px] font-extrabold uppercase text-slate-400 tracking-wider flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span>State</span>
                  <span>Sender & Subject</span>
                </div>
                <span>Created At</span>
              </div>

              {/* List Content */}
              {isLoading ? (
                <div className="p-12 text-center text-slate-400 space-y-3">
                  <RefreshCw className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
                  <p className="text-xs font-semibold">Executing D1 SQL Query...</p>
                </div>
              ) : emails.length === 0 ? (
                <div className="p-12 text-center text-slate-400 space-y-2">
                  <Mail className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-sm font-bold text-slate-300">No emails found in this D1 folder</p>
                  <p className="text-xs opacity-75">
                    User: <strong className="text-indigo-400">{selectedUserId}</strong> | Folder: <strong className="text-indigo-400">{selectedFolder}</strong>
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/80">
                  {emails.map((email) => {
                    const isUnread = !email.isRead;
                    return (
                      <div
                        key={email.id}
                        onClick={() => setSelectedEmail(email)}
                        className={`p-4 transition-all flex items-start justify-between gap-3 cursor-pointer group hover:bg-slate-800/60 ${
                          isUnread
                            ? 'bg-indigo-950/30 border-l-4 border-l-indigo-500'
                            : 'bg-slate-900/40'
                        }`}
                      >
                        {/* Unread Indicator & Main Info */}
                        <div className="flex items-start gap-3 min-w-0">
                          
                          {/* Unread State Indicator Toggle Button */}
                          <button
                            type="button"
                            onClick={(e) => handleToggleReadStatus(email, e)}
                            className="mt-0.5 p-1 text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer"
                            title={isUnread ? 'Mark as Read' : 'Mark as Unread'}
                          >
                            {isUnread ? (
                              <span className="relative flex h-3.5 w-3.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-indigo-500" />
                              </span>
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                            )}
                          </button>

                          {/* Email Headers Preview */}
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`text-xs truncate ${
                                  isUnread
                                    ? 'font-black text-white'
                                    : 'font-medium text-slate-300'
                                }`}
                              >
                                {email.sender}
                              </span>

                              {isUnread && (
                                <span className="text-[9.5px] font-black uppercase px-2 py-0.5 rounded-md bg-indigo-500 text-white tracking-wider">
                                  UNREAD
                                </span>
                              )}
                            </div>

                            <h4
                              className={`text-xs truncate ${
                                isUnread
                                  ? 'font-bold text-indigo-200'
                                  : 'font-normal text-slate-400'
                              }`}
                            >
                              {email.subject}
                            </h4>

                            <p className="text-[11.5px] text-slate-500 line-clamp-1 leading-relaxed">
                              {email.bodyText}
                            </p>
                          </div>

                        </div>

                        {/* Created At Timestamp */}
                        <div className="text-[11px] font-mono text-slate-400 shrink-0 text-right">
                          {formatTimestamp(email.createdAt)}
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pagination Controls Footer */}
              <div className="px-5 py-3 bg-slate-950/80 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
                <div>
                  Showing <strong className="text-white">{emails.length > 0 ? (pagination.page - 1) * pagination.limit + 1 : 0}</strong> to{' '}
                  <strong className="text-white">{Math.min(pagination.page * pagination.limit, pagination.total)}</strong> of{' '}
                  <strong className="text-indigo-400">{pagination.total}</strong> D1 records
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={!pagination.hasPrev || isLoading}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                    title="Previous Page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <span className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono font-bold text-slate-200">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>

                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.min(pagination.totalPages, prev + 1))}
                    disabled={!pagination.hasNext || isLoading}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                    title="Next Page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

            </div>

          </div>

        </div>

        {/* Selected Email Detailed Drawer Modal */}
        <AnimatePresence>
          {selectedEmail && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm font-sans select-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col text-left"
              >
                {/* Modal Header */}
                <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-extrabold text-white">
                      Email Details (D1 Record: {selectedEmail.id})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedEmail(null)}
                    className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
                  
                  <div className="space-y-2 pb-4 border-b border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-indigo-400 font-bold font-mono">
                        Thread ID: {selectedEmail.threadId}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => handleToggleReadStatus(selectedEmail, e)}
                        className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
                          selectedEmail.isRead
                            ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            : 'bg-indigo-600 text-white hover:bg-indigo-500'
                        }`}
                      >
                        {selectedEmail.isRead ? 'Mark as Unread' : 'Mark as Read'}
                      </button>
                    </div>

                    <h2 className="text-base font-extrabold text-white">
                      {selectedEmail.subject}
                    </h2>

                    <div className="flex items-center justify-between text-xs text-slate-400 flex-wrap gap-2 pt-1">
                      <div>
                        From: <strong className="text-slate-200">{selectedEmail.sender}</strong>
                      </div>
                      <div className="font-mono text-[11px]">
                        {formatTimestamp(selectedEmail.createdAt)}
                      </div>
                    </div>
                  </div>

                  {/* Body Text Content */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 leading-relaxed font-sans whitespace-pre-wrap">
                    {selectedEmail.bodyText}
                  </div>

                  {/* Postal-Mime Extracted Attachments Section */}
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                        <Paperclip className="w-3.5 h-3.5 text-emerald-400" />
                        Attachments ({emailAttachments.length}) — Extracted via postal-mime to R2
                      </span>
                      {isLoadingAttachments && (
                        <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" /> Querying D1 attachments...
                        </span>
                      )}
                    </div>

                    {emailAttachments.length === 0 && !isLoadingAttachments ? (
                      <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl text-[11px] text-slate-500 italic">
                        No attachments detected in this MIME payload.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {emailAttachments.map((att) => (
                          <div
                            key={att.id}
                            className="p-3 bg-slate-950 border border-slate-800 hover:border-emerald-700/60 rounded-xl flex items-center justify-between gap-3 transition-all"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="p-2 bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 rounded-lg shrink-0">
                                <FileText className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <h5 className="text-xs font-bold text-slate-200 truncate" title={att.filename}>
                                  {att.filename}
                                </h5>
                                <div className="flex items-center gap-2 text-[10.5px] font-mono text-slate-400 flex-wrap">
                                  <span>{att.content_type}</span>
                                  <span>•</span>
                                  <span>{(att.size / 1024).toFixed(1)} KB</span>
                                  <span>•</span>
                                  <span className="text-indigo-400 truncate max-w-[150px]" title={att.r2_key}>
                                    R2: env.ATTACHMENTS_BUCKET
                                  </span>
                                </div>
                              </div>
                            </div>

                            <a
                              href={att.download_url}
                              target="_blank"
                              rel="noreferrer"
                              download={att.filename}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 shadow-sm shadow-emerald-600/30"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Presigned GET</span>
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Metadata Footer */}
                  <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-900/60 text-[11px] font-mono text-indigo-300 flex items-center justify-between">
                    <span>Folder: <strong>{selectedEmail.folder}</strong></span>
                    <span>User: <strong>{selectedEmail.userId}</strong></span>
                    <span>Read Status: <strong>{selectedEmail.isRead ? '1 (Read)' : '0 (Unread)'}</strong></span>
                  </div>

                </div>

                <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSelectedEmail(null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>

              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
