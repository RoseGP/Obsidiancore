import React, { useState, useEffect, useMemo } from 'react';
import { 
  locationInsightsService 
} from '../services/locationInsightsService';
import { LocationInsights, LRUCacheStats } from '../utils/lruCache';
import { 
  Database, 
  Zap, 
  Search, 
  MapPin, 
  PhoneCall, 
  Globe, 
  Star, 
  Activity, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  Server, 
  ArrowRight, 
  Layers, 
  Sliders,
  ShieldCheck,
  Eye,
  Navigation
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const LOCATIONS_LIST = [
  { id: "loc-101", name: "San Francisco HQ", city: "San Francisco, CA" },
  { id: "loc-102", name: "New York Midtown Hub", city: "New York, NY" },
  { id: "loc-103", name: "London Canary Wharf", city: "London, UK" },
  { id: "loc-104", name: "Tokyo Shibuya Center", city: "Tokyo, Japan" },
  { id: "loc-105", name: "Austin Innovation Lab", city: "Austin, TX" },
  { id: "loc-106", name: "Berlin Tech Campus", city: "Berlin, Germany" },
];

export default function LocationInsightsCacheDashboard() {
  const [selectedLocationId, setSelectedLocationId] = useState<string>("loc-101");
  const [currentInsights, setCurrentInsights] = useState<LocationInsights | null>(null);
  const [lastQueryMeta, setLastQueryMeta] = useState<{ isFromCache: boolean; latencyMs: number } | null>(null);
  const [isQuerying, setIsQuerying] = useState<boolean>(false);

  const [cacheStats, setCacheStats] = useState<LRUCacheStats>(locationInsightsService.getCacheStats());
  const [cacheEntries, setCacheEntries] = useState(locationInsightsService.getCacheEntries());
  const [activityLogs, setActivityLogs] = useState(locationInsightsService.getActivityLogs());
  const [capacity, setCapacity] = useState<number>(4);

  // Load location data on location selection
  const loadLocationData = async (locId: string) => {
    setIsQuerying(true);
    const result = await locationInsightsService.fetchLocationInsights(locId);
    setCurrentInsights(result.data);
    setLastQueryMeta({ isFromCache: result.isFromCache, latencyMs: result.latencyMs });
    setIsQuerying(false);

    // Refresh Telemetry
    updateTelemetry();
  };

  useEffect(() => {
    loadLocationData(selectedLocationId);
  }, [selectedLocationId]);

  const updateTelemetry = () => {
    setCacheStats(locationInsightsService.getCacheStats());
    setCacheEntries(locationInsightsService.getCacheEntries());
    setActivityLogs(locationInsightsService.getActivityLogs());
  };

  const handleCapacityChange = (newCap: number) => {
    setCapacity(newCap);
    locationInsightsService.setCapacity(newCap);
    updateTelemetry();
  };

  const handleClearCache = () => {
    locationInsightsService.clearCache();
    updateTelemetry();
    loadLocationData(selectedLocationId);
  };

  return (
    <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xl space-y-6 text-left font-sans">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-violet-600 text-white flex items-center justify-center shadow-md shadow-violet-600/20 shrink-0">
            <Database className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-extrabold text-neutral-900 tracking-tight">
                In-Memory Metrics & Google Reviews LRU Cache
              </h2>
              <span className="bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md">
                Doubly Linked List + Hash Map O(1)
              </span>
            </div>
            <p className="text-xs text-neutral-500 font-medium mt-0.5">
              Optimizes Location Insights, Views, Directions, & Reviews API Quota Efficiency
            </p>
          </div>
        </div>

        {/* Real-Time Cache Telemetry Counters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-neutral-50 border border-neutral-250 px-3.5 py-2 rounded-2xl text-center shadow-2xs">
            <span className="text-[9px] font-black text-neutral-400 uppercase tracking-widest block font-mono">
              Cache Hit Ratio
            </span>
            <span className="text-lg font-black text-violet-600 font-mono">
              {cacheStats.hitRatioPct}%
            </span>
          </div>

          <div className="bg-neutral-50 border border-neutral-250 px-3.5 py-2 rounded-2xl text-center shadow-2xs">
            <span className="text-[9px] font-black text-neutral-400 uppercase tracking-widest block font-mono">
              Hits / Misses
            </span>
            <span className="text-lg font-black text-neutral-900 font-mono">
              <span className="text-emerald-600">{cacheStats.hits}</span> / <span className="text-amber-600">{cacheStats.misses}</span>
            </span>
          </div>

          <div className="bg-neutral-50 border border-neutral-250 px-3.5 py-2 rounded-2xl text-center shadow-2xs">
            <span className="text-[9px] font-black text-neutral-400 uppercase tracking-widest block font-mono">
              Evictions
            </span>
            <span className="text-lg font-black text-rose-600 font-mono">
              {cacheStats.evictions}
            </span>
          </div>
        </div>
      </div>

      {/* Location Selector Tabs & Cache Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-neutral-50 p-4 rounded-2xl border border-neutral-200">
        <div className="space-y-1.5 min-w-0">
          <span className="text-[10px] font-extrabold text-neutral-400 uppercase tracking-wider block font-mono">
            Query Location Metrics (Tests O(1) Cache Hit vs API Miss):
          </span>
          <div className="flex flex-wrap gap-2">
            {LOCATIONS_LIST.map((loc) => {
              const isSelected = selectedLocationId === loc.id;
              const isCached = cacheEntries.some(e => e.key === loc.id);

              return (
                <button
                  key={loc.id}
                  onClick={() => setSelectedLocationId(loc.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                    isSelected 
                      ? "bg-violet-600 text-white border-violet-600 shadow-md shadow-violet-600/20" 
                      : "bg-white border-neutral-250 text-neutral-700 hover:border-neutral-400"
                  }`}
                >
                  <MapPin className={`h-3.5 w-3.5 ${isSelected ? "text-white" : "text-violet-600"}`} />
                  <span>{loc.name}</span>
                  {isCached && (
                    <span className={`h-2 w-2 rounded-full ${isSelected ? "bg-white" : "bg-emerald-500"}`} title="Cached in memory" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Capacity Slider & Clear */}
        <div className="flex items-center gap-4 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-neutral-200">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono font-bold text-neutral-500">
              <span>Capacity</span>
              <span className="text-violet-700">{capacity} Nodes</span>
            </div>
            <input 
              type="range" 
              min={2} 
              max={10} 
              value={capacity} 
              onChange={e => handleCapacityChange(Number(e.target.value))}
              className="w-28 accent-violet-600 cursor-pointer"
            />
          </div>

          <button
            onClick={handleClearCache}
            className="p-2 rounded-xl border border-neutral-250 text-neutral-600 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
            title="Clear LRU Cache"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Data Display: Active Location Metrics & Cache Status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Location Insights & Reviews Cards */}
        <div className="lg:col-span-7 space-y-4">
          
          {/* Query Latency & Cache Hit Banner */}
          {lastQueryMeta && currentInsights && (
            <div className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs font-bold font-mono ${
              lastQueryMeta.isFromCache 
                ? "bg-emerald-50 border-emerald-200 text-emerald-900" 
                : "bg-amber-50 border-amber-200 text-amber-900"
            }`}>
              <div className="flex items-center gap-2">
                <Zap className={`h-4 w-4 ${lastQueryMeta.isFromCache ? "text-emerald-600" : "text-amber-600"}`} />
                <span>
                  {lastQueryMeta.isFromCache 
                    ? `⚡ O(1) LRU CACHE HIT — Served instantly in ${lastQueryMeta.latencyMs}ms` 
                    : `🌐 API CACHE MISS — Fetched from remote source in ${lastQueryMeta.latencyMs}ms`}
                </span>
              </div>
              <span className="bg-white/80 border px-2 py-0.5 rounded-md text-[10px]">
                {lastQueryMeta.isFromCache ? "0 Quota Spent" : "-15 Quota Units"}
              </span>
            </div>
          )}

          {/* Location Metrics Overview */}
          {currentInsights && (
            <div className="bg-neutral-50 rounded-2xl border border-neutral-200 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-neutral-900">
                    {currentInsights.locationName}
                  </h3>
                  <span className="text-xs font-medium text-neutral-500">
                    {currentInsights.city} • Last Synced: {currentInsights.fetchedAt}
                  </span>
                </div>

                <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-extrabold px-3 py-1 rounded-xl">
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                  <span>{currentInsights.averageRating} ({currentInsights.totalReviews} Reviews)</span>
                </div>
              </div>

              {/* Insights Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white border border-neutral-200 p-3 rounded-xl shadow-2xs">
                  <span className="text-[10px] font-extrabold text-neutral-400 uppercase tracking-wider block font-mono">
                    Search Views
                  </span>
                  <span className="text-base font-black text-neutral-900 font-mono mt-0.5 block">
                    {currentInsights.searchViews.toLocaleString()}
                  </span>
                </div>

                <div className="bg-white border border-neutral-200 p-3 rounded-xl shadow-2xs">
                  <span className="text-[10px] font-extrabold text-neutral-400 uppercase tracking-wider block font-mono">
                    Map Views
                  </span>
                  <span className="text-base font-black text-neutral-900 font-mono mt-0.5 block">
                    {currentInsights.mapViews.toLocaleString()}
                  </span>
                </div>

                <div className="bg-white border border-neutral-200 p-3 rounded-xl shadow-2xs">
                  <span className="text-[10px] font-extrabold text-neutral-400 uppercase tracking-wider block font-mono">
                    Directions
                  </span>
                  <span className="text-base font-black text-neutral-900 font-mono mt-0.5 block">
                    {currentInsights.directionRequests.toLocaleString()}
                  </span>
                </div>

                <div className="bg-white border border-neutral-200 p-3 rounded-xl shadow-2xs">
                  <span className="text-[10px] font-extrabold text-neutral-400 uppercase tracking-wider block font-mono">
                    Phone Calls
                  </span>
                  <span className="text-base font-black text-neutral-900 font-mono mt-0.5 block">
                    {currentInsights.phoneCallClicks.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Google Reviews Stream */}
              <div className="space-y-2 pt-2">
                <span className="text-xs font-extrabold text-neutral-700 uppercase tracking-wider block font-mono">
                  Cached Google Customer Reviews:
                </span>
                <div className="space-y-2">
                  {currentInsights.recentReviews.map((rev) => (
                    <div key={rev.id} className="bg-white border border-neutral-200 p-3 rounded-xl space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-neutral-900">{rev.author}</span>
                        <div className="flex items-center gap-0.5 text-amber-500">
                          {Array.from({ length: rev.rating }).map((_, i) => (
                            <Star key={i} className="h-3 w-3 fill-amber-500" />
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-neutral-600 font-medium">"{rev.text}"</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Right: Doubly Linked List State & Activity Logs */}
        <div className="lg:col-span-5 space-y-4">
          
          {/* LRU Doubly Linked List Order Visualization (MRU Head to LRU Tail) */}
          <div className="bg-neutral-900 text-white rounded-2xl p-4 shadow-lg space-y-3 font-mono">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
              <span className="text-xs font-bold text-violet-400 flex items-center gap-1.5">
                <Layers className="h-4 w-4" />
                Doubly Linked List Structure
              </span>
              <span className="text-[10px] text-neutral-400">
                Size: {cacheStats.size} / {cacheStats.capacity}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between text-[10px] text-neutral-400">
                <span>👑 MRU (Most Recently Used Head)</span>
                <span>LRU (Least Recently Used Tail) 🔻</span>
              </div>

              {cacheEntries.length === 0 ? (
                <span className="text-neutral-500 italic block py-2">Cache is currently empty</span>
              ) : (
                cacheEntries.map((entry, idx) => (
                  <div 
                    key={entry.key}
                    className={`p-2.5 rounded-xl border flex items-center justify-between transition-all ${
                      idx === 0 
                        ? "bg-violet-500/20 border-violet-500/50 text-violet-200 font-bold" 
                        : idx === cacheEntries.length - 1 && cacheEntries.length === capacity
                          ? "bg-rose-500/10 border-rose-500/40 text-rose-300"
                          : "bg-neutral-800 border-neutral-700 text-neutral-300"
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="truncate block font-bold">
                        {idx === 0 ? "HEAD ➔ " : idx === cacheEntries.length - 1 ? "TAIL ➔ " : `[Node ${idx}] `}
                        {entry.value.locationName}
                      </span>
                      <span className="text-[9px] text-neutral-400 font-mono">Key: {entry.key}</span>
                    </div>

                    <span className="text-[10px] font-bold text-emerald-400 bg-neutral-900 px-2 py-1 rounded-md border border-neutral-700">
                      O(1) Cached
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Activity Logs Stream */}
          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-4 space-y-2">
            <span className="text-xs font-extrabold text-neutral-800 uppercase tracking-wider block font-mono">
              Live Cache Operation Log
            </span>

            <div className="space-y-1.5 max-h-48 overflow-y-auto font-mono text-[11px] pr-1">
              {activityLogs.map((log) => (
                <div key={log.id} className="bg-white border border-neutral-200 p-2 rounded-xl flex items-center justify-between">
                  <span className={`font-bold ${
                    log.action.includes('HIT') ? "text-emerald-600" : "text-amber-600"
                  }`}>
                    {log.action}
                  </span>
                  <span className="text-neutral-700 truncate max-w-[120px]">{log.locationName}</span>
                  <span className="text-neutral-400 text-[10px]">{log.responseTimeMs}ms</span>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
