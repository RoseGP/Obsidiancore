import React, { useState } from "react";
import { 
  Server, ShieldCheck, Zap, RefreshCw, CheckCircle2, 
  AlertCircle, Settings, ToggleLeft, ToggleRight, Radio,
  Layers, ArrowDownUp, Globe, Activity
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface SipTrunkConfig {
  id: string;
  name: string;
  provider: "telnyx" | "twilio" | "bandwidth" | "signalwire" | "custom";
  sipHost: string;
  port: number;
  protocol: "TLS" | "UDP" | "TCP";
  authType: "IP_ACL" | "CREDENTIALS";
  priority: number; // 1 = Primary, 2 = Secondary, 3 = Tertiary
  active: boolean;
  health: "healthy" | "degraded" | "failing";
  latencyMs: number;
  inboundDid: string;
  concurrentChannels: number;
  maxChannels: number;
}

interface SipTrunkRedundancyManagerProps {
  onTrunkChange?: (activeTrunkId: string, trunks: SipTrunkConfig[]) => void;
}

export default function SipTrunkRedundancyManager({
  onTrunkChange
}: SipTrunkRedundancyManagerProps) {
  const [trunks, setTrunks] = useState<SipTrunkConfig[]>([
    {
      id: "trunk_telnyx_primary",
      name: "Telnyx Global SIP Trunk",
      provider: "telnyx",
      sipHost: "sip.telnyx.com",
      port: 5061,
      protocol: "TLS",
      authType: "IP_ACL",
      priority: 1,
      active: true,
      health: "healthy",
      latencyMs: 24,
      inboundDid: "+1 (555) 019-8000",
      concurrentChannels: 3,
      maxChannels: 50
    },
    {
      id: "trunk_twilio_secondary",
      name: "Twilio Elastic SIP Trunk",
      provider: "twilio",
      sipHost: "omnichannel-crm.pstn.twilio.com",
      port: 5061,
      protocol: "TLS",
      authType: "CREDENTIALS",
      priority: 2,
      active: true,
      health: "healthy",
      latencyMs: 38,
      inboundDid: "+1 (555) 234-9100",
      concurrentChannels: 0,
      maxChannels: 30
    },
    {
      id: "trunk_bandwidth_tertiary",
      name: "Bandwidth.com Direct Route",
      provider: "bandwidth",
      sipHost: "sbclocal.bandwidth.com",
      port: 5060,
      protocol: "TCP",
      authType: "IP_ACL",
      priority: 3,
      active: false,
      health: "degraded",
      latencyMs: 62,
      inboundDid: "+1 (555) 890-4422",
      concurrentChannels: 0,
      maxChannels: 25
    }
  ]);

  const [activePrimaryTrunkId, setActivePrimaryTrunkId] = useState<string>("trunk_telnyx_primary");
  const [autoFailoverEnabled, setAutoFailoverEnabled] = useState<boolean>(true);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Form for new SIP trunk
  const [newTrunkName, setNewTrunkName] = useState("");
  const [newProvider, setNewProvider] = useState<SipTrunkConfig["provider"]>("custom");
  const [newSipHost, setNewSipHost] = useState("");
  const [newInboundDid, setNewInboundDid] = useState("");
  const [newProtocol, setNewProtocol] = useState<"TLS" | "UDP" | "TCP">("TLS");

  const notifyChange = (newPrimaryId: string, updatedTrunks: SipTrunkConfig[]) => {
    if (onTrunkChange) {
      onTrunkChange(newPrimaryId, updatedTrunks);
    }
  };

  const handleToggleTrunkActive = (id: string) => {
    const updated = trunks.map(t => {
      if (t.id === id) {
        return { ...t, active: !t.active };
      }
      return t;
    });
    setTrunks(updated);
    notifyChange(activePrimaryTrunkId, updated);
  };

  const handleSetPrimaryTrunk = (id: string) => {
    setActivePrimaryTrunkId(id);
    const selected = trunks.find(t => t.id === id);
    setStatusMessage(`Switched active primary SIP Trunk to ${selected?.name || id}`);
    notifyChange(id, trunks);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleSimulateCarrierOutage = (trunkId: string) => {
    const updated = trunks.map(t => {
      if (t.id === trunkId) {
        return { ...t, health: (t.health === "failing" ? "healthy" : "failing") as any };
      }
      return t;
    });
    setTrunks(updated);

    // If active primary failed and auto failover is on, switch to next healthy
    if (autoFailoverEnabled && trunkId === activePrimaryTrunkId) {
      const nextHealthy = updated.find(t => t.id !== trunkId && t.active && t.health === "healthy");
      if (nextHealthy) {
        setActivePrimaryTrunkId(nextHealthy.id);
        setStatusMessage(`⚡ Automated Failover Triggered: Switched primary to ${nextHealthy.name} (Zero Call Drop)`);
        notifyChange(nextHealthy.id, updated);
      }
    }
  };

  const handleAddTrunk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTrunkName || !newSipHost) return;

    const newTrunk: SipTrunkConfig = {
      id: `trunk_${Date.now()}`,
      name: newTrunkName,
      provider: newProvider,
      sipHost: newSipHost,
      port: newProtocol === "TLS" ? 5061 : 5060,
      protocol: newProtocol,
      authType: "IP_ACL",
      priority: trunks.length + 1,
      active: true,
      health: "healthy",
      latencyMs: 30,
      inboundDid: newInboundDid || "+1 (555) 000-1122",
      concurrentChannels: 0,
      maxChannels: 20
    };

    const updated = [...trunks, newTrunk];
    setTrunks(updated);
    notifyChange(activePrimaryTrunkId, updated);
    setShowConfigModal(false);
    setNewTrunkName("");
    setNewSipHost("");
    setNewInboundDid("");
    setStatusMessage(`Added SIP Trunk ${newTrunk.name}`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm text-left space-y-4" id="sip-trunk-redundancy-manager">
      
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shadow-sm">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900 tracking-tight">
                Multi-SIP Trunk Redundancy & Carrier Fallback
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                Zero-Drop Failover
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Toggle between primary & secondary SIP carriers without manual code changes or redeployments
            </p>
          </div>
        </div>

        {/* Global Auto-Failover Switch & Add Button */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setAutoFailoverEnabled(!autoFailoverEnabled)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              autoFailoverEnabled
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : "bg-slate-100 border-slate-200 text-slate-600"
            }`}
            title="Automatically reroute active and incoming SIP calls if carrier reports packet loss or 503"
          >
            <Zap className={`h-3.5 w-3.5 ${autoFailoverEnabled ? "text-emerald-600" : "text-slate-400"}`} />
            <span>Auto-Failover: {autoFailoverEnabled ? "Enabled" : "Manual"}</span>
          </button>

          <button
            onClick={() => setShowConfigModal(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all cursor-pointer shadow-sm"
          >
            <span>+ Add Trunk</span>
          </button>
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <motion.div 
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-semibold flex items-center justify-between"
        >
          <span>{statusMessage}</span>
          <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
        </motion.div>
      )}

      {/* Trunks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {trunks.map((trunk) => {
          const isPrimary = trunk.id === activePrimaryTrunkId;
          const healthColor = {
            healthy: "bg-emerald-500",
            degraded: "bg-amber-500",
            failing: "bg-rose-500"
          }[trunk.health];

          return (
            <div
              key={trunk.id}
              className={`p-4 rounded-2xl border transition-all relative flex flex-col justify-between ${
                isPrimary
                  ? "bg-blue-50/50 border-blue-400 shadow-sm ring-1 ring-blue-300"
                  : trunk.active
                  ? "bg-white border-slate-200 hover:border-slate-300"
                  : "bg-slate-50 border-slate-200 opacity-60"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${healthColor} ${trunk.health === 'healthy' ? 'animate-pulse' : ''}`} />
                    <h4 className="text-xs font-bold text-slate-900 truncate">{trunk.name}</h4>
                  </div>
                  {isPrimary && (
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-600 text-white uppercase tracking-wider shrink-0">
                      Active Primary
                    </span>
                  )}
                </div>

                <div className="space-y-1 text-[11px] text-slate-600 mb-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-medium">SIP Host:</span>
                    <span className="font-mono text-slate-800 font-semibold">{trunk.sipHost}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-medium">Inbound DID:</span>
                    <span className="font-mono text-slate-800">{trunk.inboundDid}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-medium">Protocol & Ping:</span>
                    <span className="font-mono text-slate-800">{trunk.protocol} ({trunk.port}) • {trunk.latencyMs}ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-medium">Channels:</span>
                    <span className="font-mono text-slate-800">{trunk.concurrentChannels}/{trunk.maxChannels} active</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-slate-100">
                <button
                  onClick={() => handleSetPrimaryTrunk(trunk.id)}
                  disabled={isPrimary || !trunk.active || trunk.health === "failing"}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-40 ${
                    isPrimary
                      ? "bg-blue-100 text-blue-800 border border-blue-300"
                      : "bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700"
                  }`}
                >
                  {isPrimary ? "Primary Active" : "Set Primary"}
                </button>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleSimulateCarrierOutage(trunk.id)}
                    className="px-2 py-1 rounded-lg text-[10px] font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    title="Simulate Carrier Outage / 503 Error"
                  >
                    {trunk.health === "failing" ? "Restore" : "Simulate Outage"}
                  </button>
                  <button
                    onClick={() => handleToggleTrunkActive(trunk.id)}
                    className="p-1 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                    title={trunk.active ? "Disable Trunk" : "Enable Trunk"}
                  >
                    {trunk.active ? <ToggleRight className="h-5 w-5 text-emerald-600" /> : <ToggleLeft className="h-5 w-5 text-slate-400" />}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Trunk Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-5 shadow-2xl text-left">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
              <h3 className="text-sm font-bold text-slate-900">Add SIP Trunk Provider</h3>
              <button onClick={() => setShowConfigModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <form onSubmit={handleAddTrunk} className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Trunk Friendly Name *</label>
                <input
                  type="text"
                  required
                  value={newTrunkName}
                  onChange={(e) => setNewTrunkName(e.target.value)}
                  placeholder="e.g. SignalWire Primary Route"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Provider Type</label>
                  <select
                    value={newProvider}
                    onChange={(e) => setNewProvider(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="telnyx">Telnyx</option>
                    <option value="twilio">Twilio Elastic</option>
                    <option value="bandwidth">Bandwidth</option>
                    <option value="signalwire">SignalWire</option>
                    <option value="custom">Generic SIP / Asterisk</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Protocol</label>
                  <select
                    value={newProtocol}
                    onChange={(e) => setNewProtocol(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="TLS">TLS (Encrypted)</option>
                    <option value="TCP">TCP</option>
                    <option value="UDP">UDP</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">SIP Server Host / FQDN *</label>
                <input
                  type="text"
                  required
                  value={newSipHost}
                  onChange={(e) => setNewSipHost(e.target.value)}
                  placeholder="e.g. sip.signalwire.com or 192.168.1.10"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Inbound Direct Inward Dial (DID)</label>
                <input
                  type="text"
                  value={newInboundDid}
                  onChange={(e) => setNewInboundDid(e.target.value)}
                  placeholder="+1 (555) 000-9988"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  Save & Bind Trunk
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
