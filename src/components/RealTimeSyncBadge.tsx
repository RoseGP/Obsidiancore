import React, { useState } from 'react';
import { 
  Wifi, 
  WifiOff, 
  Activity, 
  Users, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  Zap, 
  Layers, 
  Database,
  ArrowRight,
  ShieldCheck,
  X
} from 'lucide-react';
import { useRealtimeSync } from '../context/RealtimeSyncContext';

interface RealTimeSyncBadgeProps {
  onOpenDiagnostics?: () => void;
}

export default function RealTimeSyncBadge({ onOpenDiagnostics }: RealTimeSyncBadgeProps) {
  const {
    isConnected,
    latencyMs,
    activeClients,
    syncStatus,
    conflictHistory,
    lastSyncTime,
    simulateConcurrentConflict,
    triggerStateResync,
  } = useRealtimeSync();

  const [isOpen, setIsOpen] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const handleSimulateConflict = () => {
    setSimulating(true);
    simulateConcurrentConflict('contact-1');
    setTimeout(() => setSimulating(false), 1500);
  };

  // Color mappings based on latency and sync status
  const isHealthy = isConnected && syncStatus !== 'offline';
  const latencyBadgeColor = 
    latencyMs == null ? 'text-neutral-400 bg-white/5 border-white/10' :
    latencyMs < 50 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
    latencyMs < 150 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
    'text-rose-400 bg-rose-500/10 border-rose-500/20';

  return (
    <div className="relative">
      {/* HUD Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer backdrop-blur-md ${
          isHealthy
            ? 'bg-neutral-900/60 border-white/10 hover:border-white/20 text-neutral-200 hover:text-white'
            : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
        }`}
        title="Real-Time WebSocket Synchronization Status"
      >
        <span className="relative flex h-2 w-2">
          {isHealthy ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </>
          ) : (
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
          )}
        </span>

        {isHealthy ? (
          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
        ) : (
          <WifiOff className="w-3.5 h-3.5 text-rose-400" />
        )}

        <span className="font-mono text-[11px] hidden sm:inline">
          {isHealthy ? (latencyMs == null ? '…' : `${latencyMs}ms`) : 'Offline'}
        </span>

        {syncStatus === 'conflict_resolved' && (
          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 animate-pulse">
            Resolved
          </span>
        )}
      </button>

      {/* Flyout Telemetry Card */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-84 sm:w-96 rounded-2xl border border-white/10 bg-neutral-900/95 shadow-2xl shadow-black/80 backdrop-blur-xl p-5 z-50 text-neutral-100 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  Real-Time Cluster Telemetry
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-blue-500/15 text-blue-400 border border-blue-500/20">
                    WSS Active
                  </span>
                </h4>
                <p className="text-[10px] text-neutral-400">Deterministic WebSocket &amp; Vector Sync</p>
              </div>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Metric Badges */}
          <div className="grid grid-cols-3 gap-2.5 my-4">
            <div className="p-2.5 rounded-xl bg-neutral-950/60 border border-white/5 text-center">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold mb-0.5">Roundtrip</div>
              <div className={`text-xs font-mono font-bold px-2 py-0.5 rounded border inline-block ${latencyBadgeColor}`}>
                {latencyMs == null ? 'Measuring…' : `${latencyMs}ms`}
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-950/60 border border-white/5 text-center">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold mb-0.5">Peer Nodes</div>
              <div className="text-xs font-mono font-bold text-blue-400 flex items-center justify-center gap-1">
                <Users className="w-3 h-3" />
                <span>{activeClients} Active</span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-neutral-950/60 border border-white/5 text-center">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-semibold mb-0.5">Sync State</div>
              <div className="text-[11px] font-bold text-emerald-400 capitalize">
                {syncStatus.replace('_', ' ')}
              </div>
            </div>
          </div>

          {/* Conflict Resolution Architecture Banner */}
          <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/15 space-y-1.5 mb-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-300">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              <span>Deterministic Conflict Resolution</span>
            </div>
            <p className="text-[11px] text-neutral-400 leading-snug">
              Uses server-authoritative vector versioning with Field-Level 3-Way Merge (Last-Write-Wins fallback) to prevent stale overwrites across simultaneous CRM edits.
            </p>
          </div>

          {/* Recent Conflicts Log */}
          {conflictHistory.length > 0 && (
            <div className="space-y-2 mb-4">
              <div className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold flex items-center justify-between">
                <span>Recent Conflict Events</span>
                <span className="text-emerald-400 font-mono text-[10px]">Reconciled</span>
              </div>

              <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                {conflictHistory.slice(0, 3).map((item) => (
                  <div key={item.id} className="p-2 rounded-lg bg-neutral-950/80 border border-white/5 text-[11px] space-y-0.5">
                    <div className="flex items-center justify-between text-neutral-300 font-semibold">
                      <span className="font-mono text-amber-300">{item.entityType}:{item.entityId}</span>
                      <span className="text-neutral-500 text-[10px]">{item.timestamp}</span>
                    </div>
                    <div className="text-neutral-400 text-[10px] line-clamp-1">{item.strategy}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interactive Actions */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="grid grid-cols-2 gap-2">
              {/* Developer tool: sends a test edit to every connected client, so never in production builds. */}
              {(import.meta as any).env?.DEV && <button
                onClick={handleSimulateConflict}
                disabled={simulating}
                className="py-2 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>{simulating ? 'Testing...' : 'Test Conflict'}</span>
              </button>}

              <button
                onClick={triggerStateResync}
                className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-200 text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                <span>Force Resync</span>
              </button>
            </div>

            {onOpenDiagnostics && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  onOpenDiagnostics();
                }}
                className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span>Open Diagnostic Hub</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
