import React, { useState, useEffect } from "react";
import { 
  BarChart2, TrendingUp, Clock, PhoneIncoming, 
  PhoneOutgoing, PhoneForwarded, CheckCircle2, 
  Activity, ArrowUpRight, Zap, RefreshCw, Layers
} from "lucide-react";
import { 
  ResponsiveContainer, AreaChart, Area, 
  BarChart, Bar, XAxis, YAxis, Tooltip, 
  CartesianGrid, LineChart, Line, Cell
} from "recharts";

// Real-time call volume by hour
const HOURLY_CALL_METRICS = [
  { hour: "08:00", totalCalls: 14, inbound: 10, outbound: 4, avgHandleSec: 135, peakLoad: 45 },
  { hour: "09:00", totalCalls: 32, inbound: 24, outbound: 8, avgHandleSec: 160, peakLoad: 72 },
  { hour: "10:00", totalCalls: 48, inbound: 36, outbound: 12, avgHandleSec: 185, peakLoad: 94 },
  { hour: "11:00", totalCalls: 62, inbound: 48, outbound: 14, avgHandleSec: 198, peakLoad: 98 },
  { hour: "12:00", totalCalls: 38, inbound: 28, outbound: 10, avgHandleSec: 140, peakLoad: 60 },
  { hour: "13:00", totalCalls: 44, inbound: 32, outbound: 12, avgHandleSec: 165, peakLoad: 75 },
  { hour: "14:00", totalCalls: 75, inbound: 58, outbound: 17, avgHandleSec: 210, peakLoad: 100 },
  { hour: "15:00", totalCalls: 59, inbound: 44, outbound: 15, avgHandleSec: 178, peakLoad: 88 },
  { hour: "16:00", totalCalls: 41, inbound: 30, outbound: 11, avgHandleSec: 152, peakLoad: 65 },
  { hour: "17:00", totalCalls: 22, inbound: 16, outbound: 6, avgHandleSec: 120, peakLoad: 38 }
];

// Department breakdown metrics
const DEPT_VOLUME = [
  { name: "Sales (Alex Vance)", calls: 142, aht: "3m 12s", fill: "#2563eb" },
  { name: "Support (Jordan Reed)", calls: 98, aht: "4m 45s", fill: "#059669" },
  { name: "Billing (Marcus Zhao)", calls: 64, aht: "2m 18s", fill: "#d97706" },
  { name: "Exec Office (Evelyn)", calls: 31, aht: "1m 50s", fill: "#7c3aed" }
];

interface CallMonitoringDashboardProps {
  activeCallsCount?: number;
  totalCallsToday?: number;
  avgHandleTimeSeconds?: number;
  primaryTrunkName?: string;
}

export default function CallMonitoringDashboard({
  activeCallsCount = 3,
  totalCallsToday = 435,
  avgHandleTimeSeconds = 174,
  primaryTrunkName = "Telnyx Primary SIP"
}: CallMonitoringDashboardProps) {
  const [timeRange, setTimeRange] = useState<"today" | "week">("today");
  const [metricView, setMetricView] = useState<"volume" | "aht" | "peak">("volume");
  const [livePulse, setLivePulse] = useState(true);

  // Periodic pulse effect for real-time telemetry
  useEffect(() => {
    const timer = setInterval(() => {
      setLivePulse(prev => !prev);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const formatSecToMin = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm text-left space-y-5" id="call-monitoring-dashboard">
      
      {/* Dashboard Top Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600 shadow-sm">
            <BarChart2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                Live Telephony & Room Metadata Analytics
              </h3>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${livePulse ? "scale-125" : "scale-100"} transition-all`} />
                LiveKit Room Stream
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Real-time SIP ingress, handle duration metrics, and peak traffic distribution
            </p>
          </div>
        </div>

        {/* Filter / View Pill */}
        <div className="flex items-center gap-2">
          <div className="bg-slate-100 border border-slate-200 p-1 rounded-2xl flex items-center gap-1 shadow-inner">
            <button
              onClick={() => setMetricView("volume")}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                metricView === "volume"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Call Volume
            </button>
            <button
              onClick={() => setMetricView("aht")}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                metricView === "aht"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Handle Time (AHT)
            </button>
            <button
              onClick={() => setMetricView("peak")}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                metricView === "peak"
                  ? "bg-white text-blue-600 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Peak Load %
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider">Active Concurrency</span>
            <Activity className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-slate-900">{activeCallsCount}</span>
            <span className="text-[10px] text-emerald-600 font-semibold">Live Channels</span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">Trunk: {primaryTrunkName}</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider">Total Calls Today</span>
            <PhoneIncoming className="h-3.5 w-3.5 text-blue-600" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-slate-900">{totalCallsToday}</span>
            <span className="text-[10px] text-blue-600 font-semibold">+18% vs avg</span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">78% Inbound / 22% Out</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider">Avg Handle Time</span>
            <Clock className="h-3.5 w-3.5 text-amber-600" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-slate-900">{formatSecToMin(avgHandleTimeSeconds)}</span>
            <span className="text-[10px] text-amber-700 font-semibold">-14s vs Target</span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">Automated screening: 38s</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider">Peak Hour</span>
            <TrendingUp className="h-3.5 w-3.5 text-purple-600" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold font-mono text-slate-900">14:00</span>
            <span className="text-[10px] text-purple-700 font-semibold">75 calls/hr</span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5">Capacity headroom: 45%</span>
        </div>
      </div>

      {/* Main Recharts Visualizer Chart */}
      <div className="p-4 rounded-2xl bg-slate-50/70 border border-slate-200 space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            {metricView === "volume" && "Hourly Call Volume (Inbound vs Outbound Telephony)"}
            {metricView === "aht" && "Average Handle Time by Hour of Day (Seconds)"}
            {metricView === "peak" && "LiveKit Room Peak Traffic Capacity Load (%)"}
          </span>
          <span className="text-[10px] text-slate-400 font-mono">Live metadata aggregated from agent rooms</span>
        </div>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {metricView === "volume" ? (
              <AreaChart data={HOURLY_CALL_METRICS} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorInbound" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0}/>
                  </linearGradient>
                  <linearGradient id="colorOutbound" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#059669" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="hour" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#ffffff", borderRadius: "12px", border: "1px solid #cbd5e1", fontSize: "11px", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                  formatter={(value: any, name: any) => [value, name === "inbound" ? "Inbound Calls" : "Outbound Calls"]}
                />
                <Area type="monotone" dataKey="inbound" stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#colorInbound)" />
                <Area type="monotone" dataKey="outbound" stroke="#059669" strokeWidth={2} fillOpacity={1} fill="url(#colorOutbound)" />
              </AreaChart>
            ) : metricView === "aht" ? (
              <BarChart data={HOURLY_CALL_METRICS} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="hour" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#ffffff", borderRadius: "12px", border: "1px solid #cbd5e1", fontSize: "11px" }}
                  formatter={(value: any) => [`${value} seconds (${Math.floor(Number(value)/60)}m ${Number(value)%60}s)`, "Avg Handle Time"]}
                />
                <Bar dataKey="avgHandleSec" fill="#d97706" radius={[6, 6, 0, 0]}>
                  {HOURLY_CALL_METRICS.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.avgHandleSec > 190 ? "#dc2626" : "#d97706"} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <LineChart data={HOURLY_CALL_METRICS} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="hour" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} domain={[0, 100]} tickLine={false} unit="%" />
                <Tooltip 
                  contentStyle={{ backgroundColor: "#ffffff", borderRadius: "12px", border: "1px solid #cbd5e1", fontSize: "11px" }}
                  formatter={(value: any) => [`${value}% Peak Capacity`, "Server Load"]}
                />
                <Line type="monotone" dataKey="peakLoad" stroke="#7c3aed" strokeWidth={3} dot={{ r: 4, fill: "#7c3aed" }} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Department Allocation Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 pt-1">
        {DEPT_VOLUME.map((dept, idx) => (
          <div key={idx} className="p-3 rounded-2xl bg-white border border-slate-200 flex flex-col justify-between shadow-xs">
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block truncate">{dept.name}</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-base font-bold text-slate-900 font-mono">{dept.calls} calls</span>
                <span className="text-[10px] text-slate-400 font-mono">AHT: {dept.aht}</span>
              </div>
            </div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-2">
              <div 
                className="h-full rounded-full" 
                style={{ width: `${(dept.calls / 142) * 100}%`, backgroundColor: dept.fill }}
              />
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
