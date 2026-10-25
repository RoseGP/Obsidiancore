import React, { useEffect, useState, useRef } from "react";
import { Wifi, Activity, ShieldAlert, BarChart2, Radio, Server, CheckCircle2 } from "lucide-react";

interface RealTimeLatencyIndicatorProps {
  peerConnection: RTCPeerConnection | null;
  fallbackRtt?: number | null;
}

export function RealTimeLatencyIndicator({ peerConnection, fallbackRtt }: RealTimeLatencyIndicatorProps) {
  const [rtt, setRtt] = useState<number | null>(null);
  const [jitter, setJitter] = useState<number>(0);
  const [packetsLost, setPacketsLost] = useState<number>(0);
  const [lossRate, setLossRate] = useState<number>(0);
  const [codec, setCodec] = useState<string>("Opus");
  const [showTelemetryHUD, setShowTelemetryHUD] = useState<boolean>(false);

  // History state for calculating sliding-window packet loss rate
  const prevPacketsLostRef = useRef<number>(0);
  const prevPacketsReceivedRef = useRef<number>(0);

  useEffect(() => {
    if (!peerConnection) {
      setRtt(null);
      setJitter(0);
      setPacketsLost(0);
      setLossRate(0);
      return;
    }

    const interval = setInterval(async () => {
      try {
        const stats = await peerConnection.getStats();
        let foundRtt = false;

        let totalPacketsLost = 0;
        let totalPacketsReceived = 0;
        let maxJitter = 0;
        let currentCodec = "Opus";

        stats.forEach((report) => {
          // 1. Get current Round Trip Time (RTT)
          if (
            report.type === "candidate-pair" &&
            report.state === "succeeded" &&
            typeof report.currentRoundTripTime === "number"
          ) {
            setRtt(Math.round(report.currentRoundTripTime * 1000));
            foundRtt = true;
          }

          // 2. Get active audio/video remote inbound feed metrics
          if (report.type === "inbound-rtp") {
            if (typeof report.packetsLost === "number") {
              totalPacketsLost += report.packetsLost;
            }
            if (typeof report.packetsReceived === "number") {
              totalPacketsReceived += report.packetsReceived;
            }
            if (typeof report.jitter === "number") {
              const jMs = report.jitter * 1000;
              if (jMs > maxJitter) {
                maxJitter = jMs;
              }
            }
            if (report.codecId) {
              const codecReport = stats.get(report.codecId);
              if (codecReport && codecReport.mimeType) {
                const mime: string = codecReport.mimeType;
                currentCodec = mime.split("/")[1] || "Opus";
              }
            }
          }
        });

        if (!foundRtt && fallbackRtt) {
          setRtt(fallbackRtt);
        }

        setJitter(maxJitter);
        setPacketsLost(totalPacketsLost);
        setCodec(currentCodec);

        // Calculate short-term sliding interval packet loss rate
        const prevLost = prevPacketsLostRef.current;
        const prevRecv = prevPacketsReceivedRef.current;

        const diffLost = Math.max(0, totalPacketsLost - prevLost);
        const diffRecv = Math.max(0, totalPacketsReceived - prevRecv);
        const diffTotal = diffLost + diffRecv;

        if (diffTotal > 0) {
          const ratePercent = (diffLost / diffTotal) * 100;
          setLossRate(parseFloat(ratePercent.toFixed(1)));
        } else if (totalPacketsLost > 0 && totalPacketsReceived > 0) {
          // Fallback to cumulative calculation
          const cumulativeRate = (totalPacketsLost / (totalPacketsLost + totalPacketsReceived)) * 100;
          setLossRate(parseFloat(cumulativeRate.toFixed(1)));
        } else {
          setLossRate(0);
        }

        prevPacketsLostRef.current = totalPacketsLost;
        prevPacketsReceivedRef.current = totalPacketsReceived;

      } catch (err) {
        console.warn("Failed to retrieve RTCPeerConnection diagnostic statistics", err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [peerConnection, fallbackRtt]);

  const displayRtt = rtt !== null ? rtt : (fallbackRtt !== undefined && fallbackRtt !== null ? fallbackRtt : null);

  if (displayRtt === null) return null;

  // Connection health evaluations matches industrial enterprise SLA bounds
  let statusColor = "text-emerald-400 bg-neutral-950/80 border-emerald-500/20";
  let pingDotColor = "bg-emerald-500";
  let pingAnimationColor = "bg-emerald-400";
  let statusLabel = "Excellent";
  let healthScore = "Optimal";

  if (displayRtt >= 150 || lossRate > 5 || jitter > 30) {
    statusColor = "text-red-400 bg-neutral-950/85 border-red-500/30";
    pingDotColor = "bg-red-500";
    pingAnimationColor = "bg-red-400";
    statusLabel = "Degraded";
    healthScore = "Critical Connection Loss";
  } else if (displayRtt >= 65 || lossRate > 1.5 || jitter > 12) {
    statusColor = "text-amber-400 bg-neutral-950/85 border-amber-500/30";
    pingDotColor = "bg-amber-500";
    pingAnimationColor = "bg-amber-400";
    statusLabel = "Warning";
    healthScore = "Congested/Heavy jitter";
  }

  return (
    <div className="relative flex flex-col items-end gap-1.5 font-sans">
      {/* 1. Main Telemetry Pill */}
      <button
        type="button"
        onClick={() => setShowTelemetryHUD(!showTelemetryHUD)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border backdrop-blur-md transition-all duration-300 hover:scale-[1.02] cursor-pointer shadow-lg select-none ${statusColor}`}
        title="Toggle Real-Time Advanced Networking Telemetry HUD"
      >
        <div className="relative flex h-2 w-2">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${pingAnimationColor}`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${pingDotColor}`} />
        </div>
        
        <span className="text-[10px] font-mono font-bold tracking-wider uppercase flex items-center gap-1 text-neutral-200">
          <Wifi className="h-3 w-3 text-neutral-400" /> RTT: <span className="font-extrabold text-white">{displayRtt}ms</span>
        </span>
        
        <span className="opacity-40 text-[10px] text-neutral-500">|</span>
        
        <span className="text-[9px] font-mono font-bold text-neutral-200 uppercase tracking-widest flex items-center gap-1">
          <Radio className="h-3 w-3 text-neutral-400" /> JIT: <span className="text-white font-extrabold">{jitter.toFixed(1)}ms</span>
        </span>

        <span className="opacity-40 text-[10px] text-neutral-500">|</span>

        <span className="text-[9px] font-bold uppercase tracking-widest">{statusLabel}</span>
      </button>

      {/* 2. Comprehensive Glassmorphism Diagnostic Dashboard Overlay */}
      {showTelemetryHUD && (
        <div className="absolute top-9 right-0 w-64 z-50 bg-black/85 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl animate-fade-in text-neutral-100 font-mono text-[10px] flex flex-col gap-3 pointer-events-auto">
          {/* Header section */}
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <span className="text-[10px] font-sans font-bold text-white flex items-center gap-1.5 uppercase tracking-wider">
              <Activity className="h-3.5 w-3.5 text-blue-400 animate-pulse" /> RTC Telemetry HUD
            </span>
            <span className={`text-[8px] font-sans font-black px-1.5 py-0.5 rounded uppercase ${
              statusLabel === "Excellent" ? "bg-emerald-500/20 text-emerald-400" :
              statusLabel === "Warning" ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"
            }`}>
              {statusLabel}
            </span>
          </div>

          {/* Metrics grids */}
          <div className="grid grid-cols-2 gap-2 font-mono">
            <div className="bg-white/5 p-2 rounded-xl border border-white/5 flex flex-col gap-0.5">
              <span className="text-[8px] text-neutral-400 uppercase tracking-widest">Jitter Ratio</span>
              <span className="text-[12px] font-black text-amber-400">{jitter.toFixed(2)} ms</span>
            </div>

            <div className="bg-white/5 p-2 rounded-xl border border-white/5 flex flex-col gap-0.5">
              <span className="text-[8px] text-neutral-400 uppercase tracking-widest">Packet Loss</span>
              <span className={`text-[12px] font-black ${lossRate > 0 ? "text-red-400" : "text-emerald-400"}`}>
                {lossRate}%
              </span>
            </div>

            <div className="bg-white/5 p-2 rounded-xl border border-white/5 flex flex-col gap-0.5">
              <span className="text-[8px] text-neutral-400 uppercase tracking-widest">Lost Packets</span>
              <span className="text-[11px] font-extrabold text-neutral-200">{packetsLost} pkts</span>
            </div>

            <div className="bg-white/5 p-2 rounded-xl border border-white/5 flex flex-col gap-0.5">
              <span className="text-[8px] text-neutral-400 uppercase tracking-widest">Codec Match</span>
              <span className="text-[11px] font-bold text-blue-400">{codec}</span>
            </div>
          </div>

          {/* Stability Diagnostic Advice Column */}
          <div className="p-2 rounded-xl bg-neutral-900 border border-white/5 text-[9px] leading-relaxed text-neutral-300">
            <div className="flex items-center gap-1.5 font-bold font-sans text-neutral-100 mb-1">
              {statusLabel === "Excellent" ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Stable Infrastructure</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
                  <span className="text-amber-400">Troubleshoot Advice</span>
                </>
              )}
            </div>
            {statusLabel === "Excellent" && "Bandwidth status and latency ranges are optimal. VoIP audio pipelines operating at pure grade-A parity."}
            {statusLabel === "Warning" && "Congested relay or slight network strain detected. Advise agent to shut down auxiliary streaming applications."}
            {statusLabel === "Degraded" && "High package dropping. Recommend hot-transition to enterprise orbit/hold or backup audio node routing."}
          </div>

          {/* Infrastructure Signoff */}
          <div className="flex items-center gap-1 text-[8px] text-neutral-500 pt-1 border-t border-white/5">
            <Server className="h-2.5 w-2.5" /> SECURE SFU REALTIMEKIT PIPELINE
          </div>
        </div>
      )}
    </div>
  );
}

