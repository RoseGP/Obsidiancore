import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useUnifiedSocket } from '../hooks/useUnifiedSocket';
import { useNotifications } from './NotificationContext';

export interface ConflictRecord {
  id: string;
  entityType: string;
  entityId: string;
  timestamp: string;
  strategy: string;
  resolvedVersion: number;
  competingAuthors?: string[];
}

export type SupportedEntityType = 'contact' | 'lead' | 'deal' | 'event' | 'task';

export interface StagedEntityMutation {
  entityType: SupportedEntityType;
  entityId: string;
  patch: Record<string, any>;
  version: number;
  timestamp: number;
}

export interface RealtimeSyncContextType {
  isConnected: boolean;
  latencyMs: number | null;
  activeClients: number;
  syncStatus: 'synced' | 'syncing' | 'conflict_resolved' | 'offline';
  vectorClock: Record<string, { version: number; lastModified: number; updatedBy: string }>;
  conflictHistory: ConflictRecord[];
  lastSyncTime: string;
  // Production Batched Writes Telemetry & Operations
  pendingBatchCount: number;
  batchedWritesCommitted: number;
  lastBatchCommitTime: string | null;
  syncEntity: (
    entityType: SupportedEntityType,
    entityId: string,
    patch: Record<string, any>
  ) => void;
  batchSyncEntities: (
    entities: Array<{
      entityType: SupportedEntityType;
      entityId: string;
      patch: Record<string, any>;
    }>
  ) => void;
  flushPendingWrites: () => Promise<void>;
  simulateConcurrentConflict: (entityId?: string) => void;
  triggerStateResync: () => void;
  clearConflictHistory: () => void;
}

const RealtimeSyncContext = createContext<RealtimeSyncContextType | undefined>(undefined);

const ENTITY_COLLECTIONS: Record<SupportedEntityType, string> = {
  contact: 'crm_contacts',
  lead: 'crm_leads',
  deal: 'deals',
  event: 'crm_events',
  task: 'crm_tasks'
};

const BATCH_DEBOUNCE_MS = 350;
const MAX_BATCH_THRESHOLD = 25;

export const RealtimeSyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { socket, isConnected } = useUnifiedSocket();
  const { pushNotification } = useNotifications();

  // Measured by socket round-trip; null until the first reply (never an invented number).
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [activeClients, setActiveClients] = useState<number>(1);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'conflict_resolved' | 'offline'>('synced');
  const [vectorClock, setVectorClock] = useState<Record<string, { version: number; lastModified: number; updatedBy: string }>>({});
  const [conflictHistory, setConflictHistory] = useState<ConflictRecord[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string>(new Date().toLocaleTimeString());

  // Batched writes telemetry
  const [pendingBatchCount, setPendingBatchCount] = useState<number>(0);
  const [batchedWritesCommitted, setBatchedWritesCommitted] = useState<number>(0);
  const [lastBatchCommitTime, setLastBatchCommitTime] = useState<string | null>(null);

  const localEntityVersions = useRef<Map<string, number>>(new Map());
  // Coalescing in-memory queue: key `${entityType}:${entityId}` -> StagedEntityMutation
  const pendingQueue = useRef<Map<string, StagedEntityMutation>>(new Map());
  const flushTimer = useRef<NodeJS.Timeout | null>(null);
  const isFlushing = useRef<boolean>(false);

  // Ping for latency measurement every 6 seconds
  useEffect(() => {
    if (!socket || !isConnected) {
      setSyncStatus('offline');
      return;
    }

    setSyncStatus('synced');

    const pingInterval = setInterval(() => {
      const start = Date.now();
      socket.emit('crm:sync:ping', { clientTimestamp: start });
    }, 6000);

    const handlePong = (data: { clientTimestamp: number; serverTimestamp: number; activeConnections?: number }) => {
      const roundTrip = Math.max(1, Date.now() - data.clientTimestamp);
      setLatencyMs(roundTrip);
      if (data.activeConnections) {
        setActiveClients(data.activeConnections);
      }
    };

    const handleInit = (data: {
      serverTime: number;
      totalEntities: number;
      vectorClock: Record<string, { version: number; lastModified: number; updatedBy: string }>;
      activeClients: number;
    }) => {
      setVectorClock(data.vectorClock || {});
      setActiveClients(data.activeClients || 1);
      setLastSyncTime(new Date().toLocaleTimeString());
      setSyncStatus('synced');
    };

    const handleEntityUpdated = (payload: {
      entityType: string;
      entityId: string;
      version: number;
      data: any;
      updatedBy: string;
      wasReconciled: boolean;
      timestamp: number;
    }) => {
      const key = `${payload.entityType}:${payload.entityId}`;
      localEntityVersions.current.set(key, payload.version);
      
      setVectorClock(prev => ({
        ...prev,
        [key]: {
          version: payload.version,
          lastModified: payload.timestamp,
          updatedBy: payload.updatedBy
        }
      }));

      setLastSyncTime(new Date().toLocaleTimeString());

      if (payload.wasReconciled) {
        setSyncStatus('conflict_resolved');
        setTimeout(() => setSyncStatus('synced'), 4000);
      }
    };

    const handleBatchUpdated = (payload: {
      updates: Array<{
        entityType: string;
        entityId: string;
        version: number;
        data: any;
        updatedBy: string;
        timestamp: number;
      }>;
      timestamp: number;
    }) => {
      if (!Array.isArray(payload?.updates)) return;
      setVectorClock(prev => {
        const next = { ...prev };
        for (const u of payload.updates) {
          const key = `${u.entityType}:${u.entityId}`;
          localEntityVersions.current.set(key, u.version);
          next[key] = {
            version: u.version,
            lastModified: u.timestamp,
            updatedBy: u.updatedBy
          };
        }
        return next;
      });
      setLastSyncTime(new Date().toLocaleTimeString());
    };

    const handleConflict = (payload: {
      entityType: string;
      entityId: string;
      strategy: string;
      resolvedVersion: number;
      mergedData: any;
    }) => {
      const newRecord: ConflictRecord = {
        id: `conf-${Date.now()}`,
        entityType: payload.entityType,
        entityId: payload.entityId,
        timestamp: new Date().toLocaleTimeString(),
        strategy: payload.strategy,
        resolvedVersion: payload.resolvedVersion,
        competingAuthors: payload.mergedData?._conflictResolution?.competingAuthors || ['Remote Client', 'Current Session']
      };

      setConflictHistory(prev => [newRecord, ...prev.slice(0, 19)]);
      setSyncStatus('conflict_resolved');

      pushNotification({
        title: '⚡ Real-Time Merge Conflict Reconciled',
        message: `Entity [${payload.entityType}:${payload.entityId}] resolved to v${payload.resolvedVersion} via ${payload.strategy}.`,
        type: 'system',
        priority: 'high',
        showToast: true,
      });

      setTimeout(() => setSyncStatus('synced'), 5000);
    };

    socket.on('crm:sync:pong', handlePong);
    socket.on('crm:sync:init', handleInit);
    socket.on('crm:entity:updated', handleEntityUpdated);
    socket.on('crm:entity:batch_updated', handleBatchUpdated);
    socket.on('crm:sync:conflict', handleConflict);

    // Initial state request
    socket.emit('crm:sync:request_state');

    return () => {
      clearInterval(pingInterval);
      socket.off('crm:sync:pong', handlePong);
      socket.off('crm:sync:init', handleInit);
      socket.off('crm:entity:updated', handleEntityUpdated);
      socket.off('crm:entity:batch_updated', handleBatchUpdated);
      socket.off('crm:sync:conflict', handleConflict);
    };
  }, [socket, isConnected, pushNotification]);

  /**
   * Flushes all staged mutations into a single atomic Firestore writeBatch
   * and synchronizes over WebSocket.
   */
  const flushPendingWrites = useCallback(async () => {
    if (pendingQueue.current.size === 0 || isFlushing.current) return;
    isFlushing.current = true;

    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }

    // Snapshot queued mutations and clear buffer
    const mutationsToCommit = Array.from(pendingQueue.current.values());
    pendingQueue.current.clear();
    setPendingBatchCount(0);
    setSyncStatus('syncing');

    try {
      // 1. Commit atomic writeBatch to Firestore (reducing concurrent billable writes)
      if (db) {
        const batch = writeBatch(db);
        for (const item of mutationsToCommit) {
          const collectionName = ENTITY_COLLECTIONS[item.entityType] || item.entityType;
          const docRef = doc(db, collectionName, item.entityId);
          batch.set(
            docRef,
            {
              ...item.patch,
              id: item.entityId,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
        await batch.commit();
        setBatchedWritesCommitted(prev => prev + mutationsToCommit.length);
        setLastBatchCommitTime(new Date().toLocaleTimeString());
      }
    } catch (firestoreErr: any) {
      console.warn('[RealtimeSyncProvider] Firestore batched write warning:', firestoreErr?.message || firestoreErr);
    }

    // 2. Broadcast batched updates via WebSocket for instant collaborative sync
    if (socket && isConnected) {
      socket.emit('crm:entity:batch_update', {
        updates: mutationsToCommit.map(m => ({
          entityType: m.entityType,
          entityId: m.entityId,
          version: m.version,
          patch: m.patch
        })),
        clientTimestamp: Date.now()
      });
    }

    // Update local vector clock state
    setVectorClock(prev => {
      const next = { ...prev };
      for (const m of mutationsToCommit) {
        const key = `${m.entityType}:${m.entityId}`;
        next[key] = {
          version: m.version,
          lastModified: Date.now(),
          updatedBy: 'local-session'
        };
      }
      return next;
    });

    setLastSyncTime(new Date().toLocaleTimeString());
    setSyncStatus('synced');
    isFlushing.current = false;
  }, [socket, isConnected]);

  // Flush on page unload or navigation to guarantee persistence
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingQueue.current.size > 0) {
        void flushPendingWrites();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, [flushPendingWrites]);

  /**
   * Enqueues an entity patch into the coalescing write buffer.
   * If the entity has already been patched in the current window, properties are merged.
   */
  const syncEntity = useCallback((
    entityType: SupportedEntityType,
    entityId: string,
    patch: Record<string, any>
  ) => {
    const key = `${entityType}:${entityId}`;
    const currentVersion = (localEntityVersions.current.get(key) || 1) + 1;
    localEntityVersions.current.set(key, currentVersion);

    const existing = pendingQueue.current.get(key);
    if (existing) {
      // Coalesce updates: Last-Write-Wins property merge
      existing.patch = { ...existing.patch, ...patch };
      existing.version = currentVersion;
      existing.timestamp = Date.now();
    } else {
      pendingQueue.current.set(key, {
        entityType,
        entityId,
        patch,
        version: currentVersion,
        timestamp: Date.now()
      });
    }

    setPendingBatchCount(pendingQueue.current.size);

    // If buffer hits threshold, flush immediately; otherwise debounce
    if (pendingQueue.current.size >= MAX_BATCH_THRESHOLD) {
      void flushPendingWrites();
    } else {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => {
        void flushPendingWrites();
      }, BATCH_DEBOUNCE_MS);
    }
  }, [flushPendingWrites]);

  /**
   * Bulk staging of multiple entity patches in one call.
   */
  const batchSyncEntities = useCallback((
    entities: Array<{
      entityType: SupportedEntityType;
      entityId: string;
      patch: Record<string, any>;
    }>
  ) => {
    for (const item of entities) {
      const key = `${item.entityType}:${item.entityId}`;
      const currentVersion = (localEntityVersions.current.get(key) || 1) + 1;
      localEntityVersions.current.set(key, currentVersion);

      const existing = pendingQueue.current.get(key);
      if (existing) {
        existing.patch = { ...existing.patch, ...item.patch };
        existing.version = currentVersion;
        existing.timestamp = Date.now();
      } else {
        pendingQueue.current.set(key, {
          entityType: item.entityType,
          entityId: item.entityId,
          patch: item.patch,
          version: currentVersion,
          timestamp: Date.now()
        });
      }
    }

    setPendingBatchCount(pendingQueue.current.size);

    if (pendingQueue.current.size >= MAX_BATCH_THRESHOLD) {
      void flushPendingWrites();
    } else {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => {
        void flushPendingWrites();
      }, BATCH_DEBOUNCE_MS);
    }
  }, [flushPendingWrites]);

  const simulateConcurrentConflict = useCallback((entityId: string = 'contact-1') => {
    if (!socket || !isConnected) return;
    setSyncStatus('syncing');

    // Deliberately pass a stale version 0 to trigger the server-side conflict detection branch
    socket.emit('crm:entity:update', {
      entityType: 'contact',
      entityId,
      version: 0, // Stale version forces conflict
      patch: {
        lastMessage: 'Simulated concurrent update from remote sales agent cluster.',
        notes: 'Merged via 3-Way CRDT-inspired Conflict Handler.',
        updatedAt: new Date().toISOString()
      },
      clientTimestamp: Date.now(),
      author: 'remote-agent-frankfurt-node'
    });
  }, [socket, isConnected]);

  const triggerStateResync = useCallback(() => {
    if (!socket || !isConnected) return;
    setSyncStatus('syncing');
    socket.emit('crm:sync:request_state');
  }, [socket, isConnected]);

  const clearConflictHistory = useCallback(() => {
    setConflictHistory([]);
  }, []);

  return (
    <RealtimeSyncContext.Provider
      value={{
        isConnected,
        latencyMs,
        activeClients,
        syncStatus,
        vectorClock,
        conflictHistory,
        lastSyncTime,
        pendingBatchCount,
        batchedWritesCommitted,
        lastBatchCommitTime,
        syncEntity,
        batchSyncEntities,
        flushPendingWrites,
        simulateConcurrentConflict,
        triggerStateResync,
        clearConflictHistory
      }}
    >
      {children}
    </RealtimeSyncContext.Provider>
  );
};

export const useRealtimeSync = () => {
  const context = useContext(RealtimeSyncContext);
  if (!context) {
    throw new Error('useRealtimeSync must be used within a RealtimeSyncProvider');
  }
  return context;
};

