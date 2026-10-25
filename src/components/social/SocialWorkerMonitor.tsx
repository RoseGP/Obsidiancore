import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Server, 
  Play, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  RefreshCw, 
  Cpu, 
  Database, 
  Send, 
  Radio, 
  Layers, 
  Globe, 
  ShieldAlert, 
  ExternalLink, 
  Clock, 
  Terminal,
  Activity,
  Zap,
  Code
} from 'lucide-react';

interface PlatformOutcome {
  platform: string;
  status: 'success' | 'failed' | 'skipped';
  postId?: string;
  url?: string;
  error?: string;
  errorCode?: string;
  tokenExpired?: boolean;
  rateLimited?: boolean;
  aspectRatioAdjusted?: boolean;
  characterCount?: number;
  publishedAt?: string;
}

interface WorkerTelemetry {
  totalJobsProcessed: number;
  succeededBatches: number;
  partialSuccessBatches: number;
  failedBatches: number;
  activeJobsCount: number;
  queueMode: 'bullmq_redis' | 'standard_async';
  lastRunTimestamp: string;
  redisAvailable: boolean;
  asyncQueueLength: number;
  totalWebhookLogs: number;
}

interface WebhookLog {
  id: string;
  batchId: string;
  postId: string;
  userId: string;
  status: 'published' | 'partial_success' | 'failed';
  targetUrl: string;
  delivered: boolean;
  httpStatusCode?: number;
  summaryText: string;
  dispatchedAt: string;
  payload: Record<string, any>;
}

export const SocialWorkerMonitor: React.FC<{
  userId?: string;
  onPostPublished?: () => void;
}> = ({ userId = 'demo-user-123', onPostPublished }) => {
  // Test Dispatch Form State
  const [content, setContent] = useState<string>(
    '🚀 Launching our new high-throughput AI Social Planner orchestration worker! Automated multi-network batching with real-time rate limit cooling and token verification.'
  );
  const [mediaUrl, setMediaUrl] = useState<string>(
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=1200'
  );
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([
    'instagram',
    'linkedin',
    'x',
    'tiktok'
  ]);
  const [simulateExpiredTikTok, setSimulateExpiredTikTok] = useState<boolean>(true);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [activeExecutionResult, setActiveExecutionResult] = useState<any | null>(null);

  // Telemetry & Logs State
  const [telemetry, setTelemetry] = useState<WorkerTelemetry | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
  const [userMapping, setUserMapping] = useState<any | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'dispatcher' | 'outcomes' | 'webhooks' | 'mapping'>('dispatcher');

  // Load telemetry & webhooks on mount
  const fetchTelemetry = async () => {
    try {
      const res = await axios.get('/api/social/worker/telemetry');
      if (res.data?.telemetry) {
        setTelemetry(res.data.telemetry);
      }
    } catch (e) {
      console.warn('[Fetch Telemetry Note]', e);
    }
  };

  const fetchWebhookLogs = async () => {
    try {
      const res = await axios.get('/api/social/worker/webhooks');
      if (res.data?.logs) {
        setWebhookLogs(res.data.logs);
      }
    } catch (e) {
      console.warn('[Fetch Webhook Logs Note]', e);
    }
  };

  const fetchUserMapping = async () => {
    try {
      const res = await axios.get(`/api/social/worker/mapping/${userId}?platforms=${selectedPlatforms.join(',')}`);
      if (res.data?.mapping) {
        setUserMapping(res.data.mapping);
      }
    } catch (e) {
      console.warn('[Fetch Mapping Note]', e);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    fetchWebhookLogs();
    fetchUserMapping();
    const interval = setInterval(() => {
      fetchTelemetry();
      fetchWebhookLogs();
    }, 4000);
    return () => clearInterval(interval);
  }, [userId]);

  const togglePlatform = (plat: string) => {
    if (selectedPlatforms.includes(plat)) {
      if (selectedPlatforms.length > 1) {
        setSelectedPlatforms(selectedPlatforms.filter(p => p !== plat));
      }
    } else {
      setSelectedPlatforms([...selectedPlatforms, plat]);
    }
  };

  // Run the Unified Task Worker
  const handleExecuteWorkerJob = async () => {
    setIsProcessing(true);
    try {
      const payload = {
        userId,
        postId: `post_${Date.now()}`,
        content: {
          text: content,
          mediaUrls: mediaUrl ? [mediaUrl] : []
        },
        platforms: selectedPlatforms,
        webhookUrl: 'https://api.obsidian-crm.internal/webhooks/social-publish',
        metadata: {
          simulateExpiredTikTok,
          originTab: 'social-planner-worker'
        }
      };

      const res = await axios.post('/api/social/worker/process', payload);
      if (res.data?.success && res.data?.result) {
        setActiveExecutionResult(res.data.result);
        setActiveSubTab('outcomes');
        await fetchTelemetry();
        await fetchWebhookLogs();
        if (onPostPublished) onPostPublished();
      }
    } catch (err: any) {
      console.error('[Worker Execution Error]', err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div id="social-worker-monitor-container" className="space-y-6">
      
      {/* 1. ARCHITECTURAL OVERVIEW BANNER */}
      <div id="worker-header-card" className="bg-white border border-neutral-200/80 rounded-2xl p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
                <Cpu className="h-4 w-4" />
              </div>
              <h2 className="text-lg font-bold text-neutral-900 tracking-tight">
                Unified Social Media Background Worker & Batch Dispatcher
              </h2>
            </div>
            <p className="text-xs text-neutral-500 max-w-3xl leading-relaxed">
              Resilient Task Queue architecture (BullMQ + Standard Async FIFO) executing unified REST requests across 
              multi-tenant social accounts. Manages automatic character limit trims, media aspect ratio conversions, 
              and explicit multi-platform error isolation.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs">
              <Radio className="h-3.5 w-3.5 text-emerald-500 animate-pulse" />
              <span className="text-neutral-500 font-medium">Queue Engine:</span>
              <span className="font-mono font-bold text-neutral-900 uppercase">
                {telemetry?.queueMode === 'bullmq_redis' ? 'BullMQ (Redis)' : 'Async FIFO Queue'}
              </span>
            </div>
            <button
              onClick={() => {
                fetchTelemetry();
                fetchWebhookLogs();
                fetchUserMapping();
              }}
              className="p-2 rounded-xl border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-colors"
              title="Refresh telemetry"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Operational Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-neutral-100">
          <div className="p-3 rounded-xl bg-neutral-50/70 border border-neutral-200/60">
            <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Jobs Processed</div>
            <div className="text-lg font-bold text-neutral-900 mt-0.5">{telemetry?.totalJobsProcessed ?? 0}</div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-100/80">
            <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">Full Success (100%)</div>
            <div className="text-lg font-bold text-emerald-900 mt-0.5">{telemetry?.succeededBatches ?? 0}</div>
          </div>
          <div className="p-3 rounded-xl bg-amber-50/50 border border-amber-100/80">
            <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Partial Success</div>
            <div className="text-lg font-bold text-amber-900 mt-0.5">{telemetry?.partialSuccessBatches ?? 0}</div>
          </div>
          <div className="p-3 rounded-xl bg-neutral-50/70 border border-neutral-200/60">
            <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Webhook Logs</div>
            <div className="text-lg font-bold text-neutral-900 mt-0.5">{telemetry?.totalWebhookLogs ?? 0}</div>
          </div>
        </div>
      </div>

      {/* 2. SUB-NAVIGATION TABS */}
      <div className="flex items-center gap-2 border-b border-neutral-200 pb-2">
        <button
          onClick={() => setActiveSubTab('dispatcher')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === 'dispatcher'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
          }`}
        >
          <Play className="h-3.5 w-3.5" />
          <span>Batch Dispatch Console</span>
        </button>

        <button
          onClick={() => setActiveSubTab('outcomes')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === 'outcomes'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          <span>Multi-Platform Outcomes</span>
          {activeExecutionResult && (
            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
              activeExecutionResult.status === 'published'
                ? 'bg-emerald-100 text-emerald-800'
                : activeExecutionResult.status === 'partial_success'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-rose-100 text-rose-800'
            }`}>
              {activeExecutionResult.status}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('webhooks')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === 'webhooks'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
          }`}
        >
          <Send className="h-3.5 w-3.5" />
          <span>Webhook Notification Logs</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-neutral-200 text-neutral-700">
            {webhookLogs.length}
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab('mapping')}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
            activeSubTab === 'mapping'
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
          }`}
        >
          <Database className="h-3.5 w-3.5" />
          <span>Tenant Profile Mapping</span>
        </button>
      </div>

      {/* 3. TAB CONTENT */}

      {/* SUBTAB 1: BATCH DISPATCH CONSOLE */}
      {activeSubTab === 'dispatcher' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Dispatch Form */}
          <div className="lg:col-span-2 bg-white border border-neutral-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
            <div>
              <h3 className="text-sm font-bold text-neutral-900">Construct Batch Publication Payload</h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Pass user payload to the background worker to execute cross-network dispatch with isolated error handling.
              </p>
            </div>

            {/* Target Networks Selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-neutral-700">Target Platforms (Array)</label>
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { id: 'instagram', name: 'Instagram' },
                  { id: 'linkedin', name: 'LinkedIn' },
                  { id: 'x', name: 'X (Twitter)' },
                  { id: 'tiktok', name: 'TikTok' },
                  { id: 'facebook', name: 'Facebook' },
                  { id: 'pinterest', name: 'Pinterest' }
                ].map(p => {
                  const isSelected = selectedPlatforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlatform(p.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-semibold'
                          : 'bg-neutral-50 border-neutral-200 text-neutral-500 hover:text-neutral-700'
                      }`}
                    >
                      {isSelected ? '✓ ' : ''}{p.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Content Field */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-neutral-700">Post Content (Text / Media URLs)</label>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={4}
                className="w-full text-xs font-normal text-neutral-800 p-3 rounded-xl border border-neutral-200 focus:outline-hidden focus:border-indigo-500 leading-relaxed"
                placeholder="Write post content..."
              />
              <div className="text-[11px] text-neutral-400 text-right">
                Length: {content.length} chars (Auto-trimmed to 280 for X, 2,200 for Instagram, 3,000 for LinkedIn)
              </div>
            </div>

            {/* Media URL Field */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-neutral-700">Media URL (Aspect-Ratio Transformation)</label>
              <input
                type="text"
                value={mediaUrl}
                onChange={e => setMediaUrl(e.target.value)}
                className="w-full text-xs font-mono text-neutral-800 p-2.5 rounded-xl border border-neutral-200 focus:outline-hidden focus:border-indigo-500"
                placeholder="https://images.unsplash.com/..."
              />
            </div>

            {/* Multi-Platform Error Simulation Toggle */}
            <div className="p-3.5 rounded-xl bg-amber-50/60 border border-amber-200/70 flex items-start gap-3">
              <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-amber-900">Simulate TikTok Token Expiration (Requirement 4)</span>
                  <input
                    type="checkbox"
                    checked={simulateExpiredTikTok}
                    onChange={e => setSimulateExpiredTikTok(e.target.checked)}
                    className="rounded text-indigo-600 h-4 w-4 cursor-pointer"
                  />
                </div>
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  When enabled, TikTok will fail with code <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[10px]">TOKEN_EXPIRED</code>, 
                  demonstrating explicit platform-level isolation. Instagram, LinkedIn, and X will succeed, yielding an overall post status of <code className="bg-amber-100 px-1 py-0.5 rounded font-mono font-bold text-[10px]">partial_success</code> without crashing the worker.
                </p>
              </div>
            </div>

            {/* Dispatch Action Button */}
            <div className="pt-2 flex items-center justify-between">
              <div className="text-xs text-neutral-500">
                Tenant: <code className="font-mono text-[11px] text-neutral-700">{userId}</code>
              </div>
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleExecuteWorkerJob}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold shadow-xs cursor-pointer transition-all"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Processing Batch Through Queue...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    <span>Trigger Worker Batch Publish</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Architectural Abstraction Spec Card */}
          <div className="bg-white border border-neutral-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-bold text-neutral-900">Abstraction Layer Engine</h3>
            </div>
            <p className="text-xs text-neutral-500 leading-relaxed">
              Handles individual platform API transformations from a single unified HTTP POST request:
            </p>

            <div className="space-y-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/70">
                <div className="font-semibold text-neutral-800 flex items-center justify-between">
                  <span>📸 Instagram</span>
                  <span className="text-[10px] text-neutral-500 font-mono">2,200 chars</span>
                </div>
                <div className="text-[11px] text-neutral-500 mt-1">
                  Enforces 1:1 or 4:5 aspect ratio cropping. Requires valid Media Container ID.
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/70">
                <div className="font-semibold text-neutral-800 flex items-center justify-between">
                  <span>💼 LinkedIn</span>
                  <span className="text-[10px] text-neutral-500 font-mono">3,000 chars</span>
                </div>
                <div className="text-[11px] text-neutral-500 mt-1">
                  UGC Share structure with automatic binary upload registration.
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/70">
                <div className="font-semibold text-neutral-800 flex items-center justify-between">
                  <span>𝕏 X (Twitter)</span>
                  <span className="text-[10px] text-neutral-500 font-mono">280 chars</span>
                </div>
                <div className="text-[11px] text-neutral-500 mt-1">
                  Strict character truncation & multi-image chunking.
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/70">
                <div className="font-semibold text-neutral-800 flex items-center justify-between">
                  <span>🎵 TikTok</span>
                  <span className="text-[10px] text-neutral-500 font-mono">2,200 chars</span>
                </div>
                <div className="text-[11px] text-neutral-500 mt-1">
                  Requires 9:16 vertical orientation and active <code className="text-[10px]">video.upload</code> scope.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 2: MULTI-PLATFORM OUTCOMES BREAKDOWN */}
      {activeSubTab === 'outcomes' && (
        <div className="space-y-5">
          {activeExecutionResult ? (
            <div className="space-y-5">
              {/* Overall Batch Status Bar */}
              <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                activeExecutionResult.status === 'published'
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  : activeExecutionResult.status === 'partial_success'
                  ? 'bg-amber-50/70 border-amber-200 text-amber-900'
                  : 'bg-rose-50/70 border-rose-200 text-rose-900'
              }`}>
                <div className="flex items-center gap-3">
                  {activeExecutionResult.status === 'published' && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                  {activeExecutionResult.status === 'partial_success' && <AlertTriangle className="h-5 w-5 text-amber-600" />}
                  {activeExecutionResult.status === 'failed' && <XCircle className="h-5 w-5 text-rose-600" />}
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider">
                      Overall Database Post Status: <strong className="text-sm font-bold">{activeExecutionResult.status}</strong>
                    </div>
                    <div className="text-xs opacity-80 mt-0.5">
                      Batch ID: <span className="font-mono">{activeExecutionResult.providerBatchId}</span> &bull; Post ID: <span className="font-mono">{activeExecutionResult.postId}</span>
                    </div>
                  </div>
                </div>

                <div className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-white/80 border border-current shadow-2xs">
                  {activeExecutionResult.summary.succeeded} of {activeExecutionResult.summary.total} Networks Dispatched Successfully
                </div>
              </div>

              {/* Per-Platform Outcome Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {Object.entries(activeExecutionResult.platformOutcomes || {}).map(([plat, outcome]: [string, any]) => {
                  const isSuccess = outcome.status === 'success';

                  return (
                    <div
                      key={plat}
                      className={`p-4 rounded-2xl border transition-all ${
                        isSuccess
                          ? 'bg-white border-neutral-200 shadow-xs'
                          : 'bg-rose-50/30 border-rose-200/80 shadow-xs'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-neutral-900 uppercase tracking-wide">
                          {plat}
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                          isSuccess
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}>
                          {isSuccess ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {isSuccess ? 'SUCCESS' : 'FAILED'}
                        </span>
                      </div>

                      {isSuccess ? (
                        <div className="space-y-2 text-xs text-neutral-600">
                          <div>
                            <span className="text-neutral-400">Post ID:</span>{' '}
                            <code className="font-mono text-[11px] text-neutral-800">{outcome.postId}</code>
                          </div>
                          {outcome.url && (
                            <a
                              href={outcome.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
                            >
                              <span>View Published Live</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          <div className="text-[10px] text-neutral-400 pt-1 border-t border-neutral-100">
                            Aspect Ratio: Adjusted &bull; Length: {outcome.characterCount} chars
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2 text-xs">
                          <div className="text-[11px] font-semibold text-rose-700">
                            Code: <span className="font-mono">{outcome.errorCode || 'ERROR'}</span>
                          </div>
                          <p className="text-[11px] text-rose-600 leading-relaxed">
                            {outcome.error}
                          </p>
                          {outcome.tokenExpired && (
                            <div className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                              ⚠️ Token Revoked / Expired: Isolated from other networks.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Raw JSON Worker Telemetry Inspector */}
              <div className="bg-neutral-900 text-neutral-100 rounded-2xl p-4 sm:p-5 shadow-xs space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-neutral-400 border-b border-neutral-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-emerald-400" />
                    <span>Worker Execution Telemetry & Error Log</span>
                  </div>
                  <span className="font-mono text-[11px] text-neutral-500">
                    Processed: {activeExecutionResult.processedAt}
                  </span>
                </div>
                <div className="text-xs font-mono text-emerald-300 py-1">
                  Log: {activeExecutionResult.errorLog}
                </div>
                <pre className="text-[11px] font-mono text-neutral-300 bg-neutral-950 p-3 rounded-xl overflow-x-auto max-h-64">
                  {JSON.stringify(activeExecutionResult, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-neutral-200/80 rounded-2xl p-10 text-center space-y-3">
              <Activity className="h-8 w-8 text-neutral-400 mx-auto" />
              <div className="text-sm font-semibold text-neutral-800">No Active Batch Execution Result Yet</div>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                Navigate to the Batch Dispatch Console to trigger a multi-platform publication job through the queue.
              </p>
              <button
                onClick={() => setActiveSubTab('dispatcher')}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold cursor-pointer shadow-xs"
              >
                Go to Dispatcher Console
              </button>
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 3: WEBHOOK NOTIFICATION LOGS */}
      {activeSubTab === 'webhooks' && (
        <div className="bg-white border border-neutral-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-neutral-900">Dispatched Webhooks & Event Notifications</h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Real-time webhooks fired upon worker batch completion, informing external CRM listeners of partial/full success.
              </p>
            </div>
            <button
              onClick={fetchWebhookLogs}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh Logs</span>
            </button>
          </div>

          {webhookLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-neutral-400">
              No webhook events dispatched yet. Trigger a batch publish job to generate notifications.
            </div>
          ) : (
            <div className="space-y-3">
              {webhookLogs.map(log => (
                <div
                  key={log.id}
                  className="p-4 rounded-xl bg-neutral-50 border border-neutral-200/70 text-xs space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        log.delivered ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {log.delivered ? `HTTP ${log.httpStatusCode || 200} DELIVERED` : 'DELIVERY FAILED'}
                      </span>
                      <span className="font-mono text-neutral-700 font-medium">{log.targetUrl}</span>
                    </div>
                    <div className="text-neutral-400 text-[11px]">
                      {new Date(log.dispatchedAt).toLocaleTimeString()}
                    </div>
                  </div>

                  <p className="text-neutral-600 font-normal">{log.summaryText}</p>

                  <details className="cursor-pointer text-[11px] text-neutral-500">
                    <summary className="hover:text-neutral-800 font-mono">View Webhook Payload JSON</summary>
                    <pre className="mt-2 p-2.5 rounded-lg bg-neutral-900 text-neutral-200 text-[10px] font-mono overflow-x-auto">
                      {JSON.stringify(log.payload, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 4: TENANT PROFILE MAPPING */}
      {activeSubTab === 'mapping' && (
        <div className="bg-white border border-neutral-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-neutral-900">User Unified Profile Mapping Configuration</h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Internal user mapping (<code className="font-mono text-neutral-700">internal_user_id &harr; unified_provider_profile_id</code>) resolved during OAuth handshake.
              </p>
            </div>
            <button
              onClick={fetchUserMapping}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh Mapping</span>
            </button>
          </div>

          {userMapping ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-neutral-50 border border-neutral-200/70 text-xs">
                <div>
                  <span className="text-neutral-500 font-medium">Internal User ID:</span>{' '}
                  <strong className="font-mono text-neutral-900">{userMapping.userId}</strong>
                </div>
                <div>
                  <span className="text-neutral-500 font-medium">Unified Provider Profile ID:</span>{' '}
                  <strong className="font-mono text-indigo-600">{userMapping.unifiedProfileId}</strong>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-neutral-800">Connected Account References:</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.entries(userMapping.accounts || {}).map(([plat, acc]: [string, any]) => (
                    <div key={plat} className="p-3 rounded-xl border border-neutral-200/70 bg-white text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-neutral-900 uppercase">{plat}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${
                          acc.isExpired ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {acc.status}
                        </span>
                      </div>
                      <div className="text-neutral-500">Handle: <span className="font-mono text-neutral-800">{acc.handle}</span></div>
                      <div className="text-neutral-500">Account Ref ID: <span className="font-mono text-neutral-600">{acc.accountId}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-neutral-400">Loading user mapping configuration...</div>
          )}
        </div>
      )}

    </div>
  );
};

export default SocialWorkerMonitor;
