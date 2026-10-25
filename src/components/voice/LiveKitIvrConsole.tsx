import React, { useState, useEffect } from "react";
import { 
  Server, Phone, PhoneForwarded, Radio, ShieldCheck, 
  Sparkles, CheckCircle2, AlertCircle, RefreshCw, Zap, 
  Cpu, Activity, Play, Terminal, ArrowRight, CornerDownLeft, 
  Layers, Volume2, Database, Key, Send
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import SipTrunkRedundancyManager, { SipTrunkConfig } from "./SipTrunkRedundancyManager";

interface LiveKitIvrConsoleProps {
  onSimulateTransfer?: (extension: string, department: string) => void;
  onTrunkChange?: (activeTrunkId: string, trunks: SipTrunkConfig[]) => void;
}

export default function LiveKitIvrConsole({ onSimulateTransfer, onTrunkChange }: LiveKitIvrConsoleProps) {
  // LiveKit connection and worker status
  const [workerStatus, setWorkerStatus] = useState<"connected" | "connecting" | "idle">("connected");
  const [activeProvider, setActiveProvider] = useState<"openai" | "groq" | "deepgram" | "gemini">("openai");
  const [fallbackCount, setFallbackCount] = useState<number>(0);
  const [ttsProvider, setTtsProvider] = useState<"elevenlabs" | "cartesia" | "openai" | "google">("elevenlabs");
  const [autoFallbackEnabled, setAutoFallbackEnabled] = useState<boolean>(true);
  
  // SIP trunk telemetry
  const [inboundTrunkId, setInboundTrunkId] = useState<string>("ST_inbound_telnyx_main");
  const [sipStatus, setSipStatus] = useState<"registered" | "routing" | "standby">("registered");
  const [selectedExtension, setSelectedExtension] = useState<string>("101");
  const [transferStatus, setTransferStatus] = useState<string | null>(null);

  // Live simulation logs
  const [logs, setLogs] = useState<Array<{ id: string; time: string; level: "info" | "warn" | "success"; text: string }>>([
    { id: "1", time: "10:30:12", level: "info", text: "[LiveKit Worker] agent.ts listening on room prefix: call-ivr-*" },
    { id: "2", time: "10:30:14", level: "success", text: "[SIP Gateway] Inbound SIP trunk rule bound to Telnyx / Asterisk numbers [+15550198000]" },
    { id: "3", time: "10:30:18", level: "info", text: "[LLM Pipeline] Primary LLM: OpenAI GPT-4o-mini | Failover: Groq Llama-3.3-70b" },
    { id: "4", time: "10:30:20", level: "info", text: "[TTS Pipeline] Primary TTS: ElevenLabs Flash | Failover: Cartesia Sonic / Deepgram Aura" }
  ]);

  const addLog = (level: "info" | "warn" | "success", text: string) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev.slice(-30), { id: `log_${Date.now()}_${Math.random()}`, time, level, text }]);
  };

  const handleSimulateFailover = () => {
    if (activeProvider === "openai") {
      addLog("warn", "[Provider Health Check] 429 RateLimit / Timeout detected on primary OpenAI API key.");
      addLog("info", "[Auto-Fallback] Seamlessly shifting active audio stream to Groq Llama-3.3-70b (0ms audio interruption)...");
      setActiveProvider("groq");
      setFallbackCount(prev => prev + 1);
      setTimeout(() => {
        addLog("success", "[Auto-Fallback] Groq LLM fallback operational. Active telephony call preserved.");
      }, 500);
    } else {
      addLog("info", "[Provider Health Check] Restoring primary OpenAI provider pipeline...");
      setActiveProvider("openai");
      addLog("success", "[LiveKit Worker] Primary OpenAI model back online.");
    }
  };

  const handleSimulateTtsFailover = () => {
    if (ttsProvider === "elevenlabs") {
      addLog("warn", "[TTS Health Check] ElevenLabs quota exhausted on free tier (429 RateLimit).");
      addLog("info", "[Auto-Fallback] Seamlessly migrating synthesizer to Cartesia Sonic / Deepgram Aura...");
      setTtsProvider("cartesia");
      setFallbackCount(prev => prev + 1);
      setTimeout(() => {
        addLog("success", "[TTS Fallback] Cartesia Sonic synthesizer generating voice output.");
      }, 500);
    } else {
      addLog("info", "[TTS Health Check] Re-engaging ElevenLabs primary voice stream...");
      setTtsProvider("elevenlabs");
      addLog("success", "[TTS Pipeline] ElevenLabs primary voice online.");
    }
  };

  const handleBlindTransfer = () => {
    const extMap: Record<string, string> = {
      "101": "Sales & New Accounts (Alex Vance)",
      "102": "Technical Support (Jordan Reed)",
      "103": "Billing & Accounts (Marcus Zhao)",
      "104": "Executive Suite (Evelyn Sinclair)",
      "105": "Strategic Partnerships (David Kim)"
    };

    const targetDept = extMap[selectedExtension] || `Extension ${selectedExtension}`;
    setTransferStatus(`Executing SIP REFER blind transfer to Ext ${selectedExtension}...`);
    addLog("info", `[SIP Gateway] transferToHuman(extension: "${selectedExtension}") called by AI agent`);
    addLog("info", `[SIP Gateway] Sending SIP REFER to gateway for destination: sip:${selectedExtension}@pbx.internal`);

    setTimeout(() => {
      setTransferStatus(`Transferred to Ext ${selectedExtension} (${targetDept})`);
      addLog("success", `[SIP Gateway] Call transfer successful. Participant bridged to ${targetDept}. Room detached.`);
      if (onSimulateTransfer) {
        onSimulateTransfer(selectedExtension, targetDept);
      }
      setTimeout(() => setTransferStatus(null), 4000);
    }, 1200);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm text-slate-800 space-y-5 text-left" id="livekit-ivr-console">
      
      {/* Console Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600 shadow-sm">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                LiveKit Open-Source Voice Agent & SIP IVR
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                agent.ts Active
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Inbound SIP trunking, automatic provider fallback, and blind transfer gateway
            </p>
          </div>
        </div>

        {/* Worker Heartbeat Badge */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono font-medium text-slate-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Worker: Connected</span>
          </div>
        </div>
      </div>

      {/* Grid: Fallback Controls + SIP Transfer Controller */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Card 1: Provider Fallback & Resilience */}
        <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-600" />
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Multi-Provider Resilience
              </h4>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              {fallbackCount} Auto-Switches
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Zero-drop failover seamlessly routes calls if primary free-tier API quotas or latency limits trigger.
          </p>

          {/* Active LLM Pill */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200 text-xs">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-blue-600" />
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase block leading-none">LLM Engine</span>
                <span className="font-bold text-slate-800">
                  {activeProvider === "openai" ? "OpenAI GPT-4o-mini (Primary)" : "Groq Llama-3.3-70b (Fallback)"}
                </span>
              </div>
            </div>
            <button
              onClick={handleSimulateFailover}
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              Test Failover
            </button>
          </div>

          {/* Active TTS Pill */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200 text-xs">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-emerald-600" />
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase block leading-none">Voice Synthesizer (TTS)</span>
                <span className="font-bold text-slate-800">
                  {ttsProvider === "elevenlabs" ? "ElevenLabs Flash (Primary)" : "Cartesia Sonic (Fallback)"}
                </span>
              </div>
            </div>
            <button
              onClick={handleSimulateTtsFailover}
              className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700 transition-colors cursor-pointer"
            >
              Test Failover
            </button>
          </div>
        </div>

        {/* Card 2: SIP Blind Transfer Gateway (transferToHuman Tool) */}
        <div className="p-4 rounded-2xl bg-slate-50/80 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PhoneForwarded className="h-4 w-4 text-blue-600" />
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                SIP Blind Transfer Gateway
              </h4>
            </div>
            <span className="text-[10px] font-mono font-bold text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
              SIP REFER
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Tool function <code className="text-blue-600 font-mono text-[11px] bg-blue-50 px-1 py-0.5 rounded">transferToHuman(extension)</code> sends SIP metadata to hand callers off to an office extension.
          </p>

          <div className="flex items-center gap-2 pt-1">
            <select
              value={selectedExtension}
              onChange={(e) => setSelectedExtension(e.target.value)}
              className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 font-medium focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="101">Ext 101 - Sales & New Accounts (Alex Vance)</option>
              <option value="102">Ext 102 - Technical Support (Jordan Reed)</option>
              <option value="103">Ext 103 - Billing & Invoicing (Marcus Zhao)</option>
              <option value="104">Ext 104 - Executive Suite (Evelyn Sinclair)</option>
              <option value="105">Ext 105 - Strategic Partnerships (David Kim)</option>
            </select>

            <button
              onClick={handleBlindTransfer}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer whitespace-nowrap"
            >
              Transfer Caller
            </button>
          </div>

          {transferStatus && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>{transferStatus}</span>
            </motion.div>
          )}
        </div>

      </div>

      {/* Multi-SIP Trunk Redundancy & Carrier Fallback Manager */}
      <SipTrunkRedundancyManager
        onTrunkChange={(newPrimaryId, updatedTrunks) => {
          const selected = updatedTrunks.find(t => t.id === newPrimaryId);
          setInboundTrunkId(newPrimaryId);
          addLog("info", `[SIP Trunk Manager] Active carrier switched to: ${selected?.name || newPrimaryId} (${selected?.sipHost})`);
          if (onTrunkChange) {
            onTrunkChange(newPrimaryId, updatedTrunks);
          }
        }}
      />

      {/* Terminal Live Activity Log Box */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 text-slate-200 font-mono text-xs shadow-inner">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">LiveKit Telephony & Agent Activity Log</span>
          </div>
          <span className="text-[10px] text-slate-500 font-sans">Live Stream</span>
        </div>

        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
          {logs.map((log) => (
            <div key={log.id} className="flex items-start gap-2 leading-relaxed">
              <span className="text-slate-500 text-[10px] shrink-0 font-sans">{log.time}</span>
              <span className={`text-[11px] ${
                log.level === 'warn' ? 'text-amber-400' :
                log.level === 'success' ? 'text-emerald-400' :
                'text-slate-300'
              }`}>
                {log.text}
              </span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
