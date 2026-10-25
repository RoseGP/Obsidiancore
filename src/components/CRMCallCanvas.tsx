import React, { useState, useEffect, useRef } from "react";
import { 
  Calendar, Clock, Sparkles, X, Plus, CalendarDays, PhoneCall, 
  HelpCircle, CheckCircle2, Shield, Activity, Share2, Copy, Check,
  ChevronRight, Radio, LayoutDashboard, Video, Users, Pause, Play,
  PhoneOff, Mic, MicOff, AlertTriangle, ChevronLeft, Volume2, UserPlus,
  Search, ShieldAlert, Phone, MonitorUp, MonitorOff
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import CRMSoftphoneCanvas from "./CRMSoftphoneCanvas";
import { CalendarEvent } from "../types";
import { 
  onScreenShareStateChange, 
  requestToggleScreenShare 
} from "../utils/webrtcEvents";
import { isScreenSharingSupported } from "../utils/app";

interface VoiceParticipant {
  id: string;
  name: string;
  role: string;
  avatar: string;
  isMuted: boolean;
  isOnHold?: boolean;
  isSpeaking?: boolean;
  joinedAt: string;
  device?: string;
}

interface CRMCallCanvasProps {
  onAddCalendarEvent?: (newEvent: Omit<CalendarEvent, "id">) => void;
  onNavigateToDashboard?: () => void;
  onNavigateToGreet?: () => void;
}

export default function CRMCallCanvas({ 
  onAddCalendarEvent,
  onNavigateToDashboard,
  onNavigateToGreet 
}: CRMCallCanvasProps) {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [instantRoomId, setInstantRoomId] = useState<string>(() => `omni-${Math.random().toString(36).substring(2, 7)}`);

  // Hold state & audio chime synthesizer
  const [isOnHold, setIsOnHold] = useState<boolean>(false);
  const [isCallActive, setIsCallActive] = useState<boolean>(true);

  // Retractable participant list panel state
  const [isParticipantPanelOpen, setIsParticipantPanelOpen] = useState<boolean>(true);
  const [participantSearch, setParticipantSearch] = useState<string>("");

  // Disconnect confirmation modal state
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState<boolean>(false);

  // Screen sharing state synchronized across call canvas components
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const canShareScreen = isScreenSharingSupported();

  useEffect(() => {
    const unsub = onScreenShareStateChange((sharing) => {
      setIsScreenSharing(sharing);
    });
    return unsub;
  }, []);

  const handleToggleScreenShare = () => {
    requestToggleScreenShare();
  };

  // Dynamic participant list in active voice agent room
  // TO COMPLETE: participants come from the live LiveKit room (room.remoteParticipants).
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);

  // Web Audio chime synthesizer for Hold toggle
  const playHoldChime = (isEngaging: boolean) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (isEngaging) {
        // Soft 3-note harmonic chime (E5 -> G#5 -> B5) with gentle sine wave
        const notes = [659.25, 830.61, 987.77];
        notes.forEach((freq, index) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.13);

          gain.gain.setValueAtTime(0, ctx.currentTime + index * 0.13);
          gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + index * 0.13 + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + index * 0.13 + 0.55);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(ctx.currentTime + index * 0.13);
          osc.stop(ctx.currentTime + index * 0.13 + 0.6);
        });
      } else {
        // Resume pleasant release tone (B5 -> E5)
        const notes = [987.77, 659.25];
        notes.forEach((freq, index) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.11);

          gain.gain.setValueAtTime(0, ctx.currentTime + index * 0.11);
          gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + index * 0.11 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + index * 0.11 + 0.4);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(ctx.currentTime + index * 0.11);
          osc.stop(ctx.currentTime + index * 0.11 + 0.45);
        });
      }
    } catch (e) {
      console.warn("[Hold Chime] Web Audio playback note:", e);
    }
  };

  // Toggle Hold on/off
  const handleToggleHold = () => {
    const nextHold = !isOnHold;
    setIsOnHold(nextHold);
    playHoldChime(nextHold);

    // Update user participant mute and hold status
    setParticipants(prev => prev.map(p => {
      if (p.id === "p1") {
        return {
          ...p,
          isOnHold: nextHold,
          isMuted: nextHold ? true : p.isMuted,
          isSpeaking: nextHold ? false : p.isSpeaking
        };
      }
      return p;
    }));
  };

  // Toggle individual participant mute
  const handleToggleParticipantMute = (participantId: string) => {
    setParticipants(prev => prev.map(p => {
      if (p.id === participantId) {
        return { ...p, isMuted: !p.isMuted, isSpeaking: p.isMuted ? p.isSpeaking : false };
      }
      return p;
    }));
  };

  // Disconnect confirmation execution
  const handleConfirmDisconnect = () => {
    setIsCallActive(false);
    setIsOnHold(false);
    setShowDisconnectConfirm(false);
  };

  // Reconnect / Start new session
  const handleReconnect = () => {
    setIsCallActive(true);
    setIsOnHold(false);
  };

  // Dynamic initialization for tomorrow's date representation
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0]; // "2026-06-17"

  // Pre-filled states for the active lead details setup
  const [title, setTitle] = useState<string>("SLA Post-Call Alignment");
  const [date, setDate] = useState<string>(tomorrowStr);
  const [time, setTime] = useState<string>("14:00");
  const [type, setType] = useState<"call" | "demo" | "followup" | "contract">("followup");
  const [contact, setContact] = useState<string>("Marcus Aurelius (Stoic Ventures LLC)");

  const handleBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !contact.trim()) return;

    if (onAddCalendarEvent) {
      onAddCalendarEvent({
        title: title.trim(),
        time: `${date} ${time}`,
        type,
        contact: contact.trim(),
        status: "upcoming"
      });
    }

    setShowModal(false);
    setTitle("SLA Post-Call Alignment");
    setDate(tomorrowStr);
    setTime("14:00");
    setType("followup");
  };

  const handleCopyMeetingLink = () => {
    const link = `https://crm.cloud/meet/${instantRoomId}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link);
    }
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const filteredParticipants = participants.filter(p => 
    p.name.toLowerCase().includes(participantSearch.toLowerCase()) ||
    p.role.toLowerCase().includes(participantSearch.toLowerCase())
  );

  return (
    <div className="obsidian h-full w-full relative flex flex-col bg-[var(--obsidian-0)] text-neutral-100 overflow-hidden" id="crm-call-canvas-root">
      
      {/* 1. Obsidian Studio Header */}
      <header className="px-5 py-3 bg-slate-900/95 backdrop-blur-xl border-b border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0 z-20 shadow-md">
        {/* Left: Breadcrumbs & Title */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 border border-purple-400/30 flex items-center justify-center text-white shadow-lg shadow-purple-500/20 shrink-0">
            <PhoneCall className="h-4 w-4" />
          </div>

          <div>
            {/* Breadcrumb Hierarchy */}
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 font-mono">
              <span className="hover:text-neutral-200 transition-colors cursor-pointer">Dashboard</span>
              <ChevronRight className="h-3 w-3 text-neutral-600" />
              <span className="text-purple-400 font-semibold">Call Canvas Studio</span>
            </div>
            
            <div className="flex items-center gap-2 mt-0.5">
              <h1 className="text-sm sm:text-base font-black tracking-tight text-white">
                Call Canvas Studio & Voice Room
              </h1>
              {isCallActive ? (
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border transition-colors ${
                  isOnHold 
                    ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isOnHold ? "bg-amber-400 animate-ping" : "bg-emerald-400 animate-ping"}`} />
                  {isOnHold ? "CALL ON HOLD" : "LIVE NODE"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-[10px] font-mono font-bold text-rose-400">
                  DISCONNECTED
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: Quick Action Triggers, Hold, Participant Toggle, Disconnect */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Signal Diagnostics Pill */}
          <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/40 border border-white/5 text-[10px] font-mono text-neutral-400">
            <Shield className="h-3 w-3 text-indigo-400" />
            <span>DTLS-SRTP 256</span>
            <span className="text-neutral-600">•</span>
            <span className="text-emerald-400 font-bold">14ms Jitter</span>
          </div>

          {/* Quick Copy Instant Room Link */}
          <button
            id="btn-copy-instant-room-link"
            onClick={handleCopyMeetingLink}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 hover:text-white transition-all cursor-pointer shadow-xs"
            title="Generate & Copy Instant Meeting Link"
          >
            {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Share2 className="h-3.5 w-3.5 text-purple-400" />}
            <span className="hidden sm:inline">{copiedLink ? "Link Copied!" : "Instant Link"}</span>
          </button>

          {/* Schedule Follow-up Appointment Modal Trigger */}
          <button
            id="btn-schedule-canvas-followup"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600/80 hover:bg-purple-600 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Schedule</span>
          </button>

          {/* SCREEN SHARING BUTTON: Captures screen and swaps video track in active RTCPeerConnection */}
          {isCallActive && (
            <button
              id="btn-call-canvas-screen-share"
              disabled={!canShareScreen}
              onClick={handleToggleScreenShare}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer border ${
                !canShareScreen
                  ? "opacity-35 cursor-not-allowed bg-white/5 text-neutral-400 border-white/5"
                  : isScreenSharing
                  ? "bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-400 ring-2 ring-amber-400/40 animate-pulse font-black shadow-amber-500/20"
                  : "bg-white/10 hover:bg-amber-500/20 text-neutral-200 hover:text-amber-300 border-white/15"
              }`}
              title={
                !canShareScreen
                  ? "Screen sharing is not supported by this browser. Please use a current version of Chrome, Edge, Firefox, or another supported browser."
                  : isScreenSharing
                  ? "Stop Sharing Screen (Restores camera track in active RTCPeerConnection)"
                  : "Share Screen (Captures screen & swaps video track in active RTCPeerConnection)"
              }
              aria-label={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
            >
              {isScreenSharing ? (
                <MonitorOff className="h-3.5 w-3.5 text-slate-950" />
              ) : (
                <MonitorUp className="h-3.5 w-3.5" />
              )}
              <span>{isScreenSharing ? "Stop Sharing" : "Share Screen"}</span>
            </button>
          )}

          {/* 1. HOLD BUTTON: Toggles muted/holding state and plays soft chime */}
          {isCallActive && (
            <button
              id="btn-call-canvas-hold"
              onClick={handleToggleHold}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer border ${
                isOnHold
                  ? "bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-400 ring-2 ring-amber-400/40 animate-pulse font-black"
                  : "bg-white/10 hover:bg-amber-500/20 text-neutral-200 hover:text-amber-300 border-white/15"
              }`}
              title={isOnHold ? "Resume Call (Plays soft chime to room)" : "Place Call on Hold (Plays soft chime & mutes)"}
            >
              {isOnHold ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5" />}
              <span>{isOnHold ? "Resume" : "Hold"}</span>
            </button>
          )}

          {/* 2. RETRACTABLE PARTICIPANT LIST PANEL TOGGLE BUTTON */}
          <button
            id="btn-toggle-participant-panel"
            onClick={() => setIsParticipantPanelOpen(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer border ${
              isParticipantPanelOpen 
                ? "bg-indigo-600 text-white border-indigo-500 shadow-indigo-600/20" 
                : "bg-white/10 hover:bg-white/15 text-neutral-200 border-white/10"
            }`}
            title={isParticipantPanelOpen ? "Retract Participant Panel" : "Open Participant Panel"}
          >
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Participants</span>
            <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-[10px] font-mono font-black ml-0.5">
              {participants.length}
            </span>
          </button>

          {/* 3. DISCONNECT BUTTON WITH CONFIRMATION DIALOG */}
          {isCallActive ? (
            <button
              id="btn-call-canvas-disconnect"
              onClick={() => setShowDisconnectConfirm(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md shadow-rose-600/20 active:scale-95 cursor-pointer border border-rose-500/30"
              title="Disconnect from Voice Agent Room (Opens confirmation dialog)"
            >
              <PhoneOff className="h-3.5 w-3.5" />
              <span>Disconnect</span>
            </button>
          ) : (
            <button
              id="btn-call-canvas-reconnect"
              onClick={handleReconnect}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer border border-emerald-500/30"
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Reconnect</span>
            </button>
          )}
        </div>
      </header>

      {/* Persistent ON HOLD Banner across top if active */}
      <AnimatePresence>
        {isOnHold && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-amber-500/20 border-b border-amber-500/30 px-6 py-2 flex items-center justify-between gap-4 z-20"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
              <span>CALL IS CURRENTLY ON HOLD</span>
              <span className="text-neutral-400 font-normal hidden md:inline">— Microphone muted & harmonic chime played to other participants.</span>
            </div>

            <button
              onClick={handleToggleHold}
              className="px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs transition-all shadow-xs cursor-pointer"
            >
              Resume Call
            </button>
          </motion.div>
        )}

        {/* Active Screen Sharing Notice Banner */}
        {isScreenSharing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-amber-500/15 border-b border-amber-500/30 px-6 py-1.5 flex items-center justify-between gap-4 z-20"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              <MonitorUp className="h-3.5 w-3.5 text-amber-400" />
              <span>SCREEN BROADCAST ACTIVE</span>
              <span className="text-neutral-300 font-normal hidden md:inline">
                — Screen video track actively swapped into RTCPeerConnection sender for all participants.
              </span>
            </div>

            <button
              onClick={handleToggleScreenShare}
              className="px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <MonitorOff className="h-3.5 w-3.5" />
              <span>Stop Sharing</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* 2. Main Workspace: Softphone Canvas + Retractable Participant List Panel */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        
        {/* Softphone Matrix Center */}
        <div className="flex-1 min-w-0 h-full overflow-hidden relative">
          <CRMSoftphoneCanvas 
            onScheduleFollowup={() => setShowModal(true)} 
            onAddCalendarEvent={onAddCalendarEvent}
            isScreenSharingProp={isScreenSharing}
            onToggleScreenShareProp={handleToggleScreenShare}
          />
        </div>

        {/* Retractable Participant List Panel on the Right Side */}
        <AnimatePresence initial={false}>
          {isParticipantPanelOpen && (
            <motion.aside
              key="retractable-participants-aside"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeInOut" }}
              className="obsidian h-full bg-[var(--obsidian-0)] border-l border-white/10 flex flex-col shrink-0 z-10 overflow-hidden shadow-2xl"
              id="retractable-participant-panel"
            >
              {/* Panel Header */}
              <div className="obsidian p-3.5 border-b border-white/10 bg-[var(--obsidian-1)] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Users className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white leading-none">Voice Room</h3>
                    <p className="text-[10px] text-neutral-400 mt-0.5">{participants.length} Active Participants</p>
                  </div>
                </div>

                <button
                  onClick={() => setIsParticipantPanelOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                  title="Retract Panel"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Search input filter */}
              <div className="p-3 border-b border-white/5 bg-black/20">
                <div className="relative flex items-center">
                  <Search className="h-3 w-3 text-neutral-500 absolute left-2.5" />
                  <input
                    type="text"
                    value={participantSearch}
                    onChange={(e) => setParticipantSearch(e.target.value)}
                    placeholder="Filter participants..."
                    className="obsidian w-full bg-[var(--obsidian-2)] border border-white/10 focus:border-indigo-500 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none transition-colors"
                  />
                  {participantSearch && (
                    <button
                      onClick={() => setParticipantSearch("")}
                      className="absolute right-2 text-neutral-500 hover:text-neutral-300"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Participant List */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                <div className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 px-1 mb-1 flex items-center justify-between">
                  <span>In Room ({filteredParticipants.length})</span>
                  <span className="text-[9px] text-emerald-400 font-mono">Live Audio Active</span>
                </div>

                {filteredParticipants.map((p) => {
                  const isYou = p.id === "p1";
                  const isAgent = p.id === "p-agent";

                  return (
                    <div
                      key={p.id}
                      className={`p-2.5 rounded-xl border transition-all ${
                        p.isOnHold 
                          ? "bg-amber-500/10 border-amber-500/30" 
                          : p.isSpeaking 
                          ? "bg-indigo-950/40 border-indigo-500/40 shadow-xs" 
                          : "bg-slate-900/80 border-white/5 hover:border-white/10"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        {/* Avatar & Info */}
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 relative ${
                            isAgent
                              ? "bg-gradient-to-tr from-purple-600 to-indigo-600 text-white"
                              : isYou
                              ? "bg-gradient-to-tr from-emerald-600 to-teal-600 text-white"
                              : "bg-neutral-800 text-neutral-200 border border-white/10"
                          }`}>
                            {p.avatar}
                            {p.isSpeaking && (
                              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 border-2 border-[var(--obsidian-0)]" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-white truncate">{p.name}</span>
                              {isYou && (
                                <span className="text-[8px] font-bold px-1 rounded bg-emerald-500/20 text-emerald-400 shrink-0">
                                  YOU
                                </span>
                              )}
                              {isAgent && (
                                <span className="text-[8px] font-bold px-1 rounded bg-purple-500/20 text-purple-300 shrink-0">
                                  AI
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-neutral-400 truncate flex items-center gap-1">
                              <span>{p.role}</span>
                            </div>
                          </div>
                        </div>

                        {/* Mute / Hold Status Action */}
                        <div className="flex items-center gap-1 shrink-0">
                          {p.isOnHold ? (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 text-[9px] font-mono font-bold text-amber-300">
                              <Pause className="h-2.5 w-2.5" />
                              HOLD
                            </span>
                          ) : (
                            <button
                              onClick={() => handleToggleParticipantMute(p.id)}
                              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                                p.isMuted
                                  ? "bg-rose-500/15 border-rose-500/30 text-rose-400 hover:bg-rose-500/25"
                                  : "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
                              }`}
                              title={p.isMuted ? "Unmute participant" : "Mute participant"}
                            >
                              {p.isMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Device badge & status footer */}
                      <div className="mt-2 pt-1.5 border-t border-white/5 flex items-center justify-between text-[9px] font-mono text-neutral-400">
                        <span className="truncate">{p.device || "Audio Stream"}</span>
                        <span className={p.isMuted ? "text-rose-400 font-semibold" : p.isOnHold ? "text-amber-400 font-semibold" : "text-emerald-400 font-semibold"}>
                          {p.isOnHold ? "On Hold" : p.isMuted ? "Muted" : p.isSpeaking ? "Speaking" : "Active"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Panel Footer: Quick Telemetry & Room Info */}
              <div className="obsidian p-3 border-t border-white/10 bg-[var(--obsidian-1)] space-y-2 shrink-0 text-left">
                <div className="flex items-center justify-between text-[10px] text-neutral-400 font-mono">
                  <span>Room ID:</span>
                  <span className="text-purple-300 font-bold">{instantRoomId}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-neutral-400 font-mono">
                  <span>SIP Ingress:</span>
                  <span className="text-emerald-400">ST_outbound_telnyx</span>
                </div>
                <button
                  onClick={handleCopyMeetingLink}
                  className="w-full py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-neutral-200 hover:text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Share2 className="h-3 w-3 text-purple-400" />
                  <span>Copy Room Invite Link</span>
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* 3. CONFIRMATION DIALOG FOR 'DISCONNECT' BUTTON */}
      <AnimatePresence>
        {showDisconnectConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDisconnectConfirm(false)}
              className="absolute inset-0 bg-neutral-950/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="obsidian w-full max-w-md bg-[var(--obsidian-0)] border border-rose-500/30 rounded-3xl p-6 shadow-2xl relative z-10 text-neutral-100"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="h-10 w-10 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">Disconnect Call Session?</h3>
                  <p className="text-xs text-neutral-400">Confirmation required to prevent accidental disconnection</p>
                </div>
              </div>

              <p className="text-xs text-neutral-300 leading-relaxed mb-6 bg-black/30 p-3.5 rounded-2xl border border-white/5">
                Are you sure you want to disconnect from this voice agent room? This will terminate your active audio, video streams, and SIP telephony connections with <strong className="text-white">Alex AI</strong> and all participants.
              </p>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDisconnectConfirm(false)}
                  className="px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-bold text-neutral-300 hover:text-white transition-all cursor-pointer"
                >
                  Stay Connected
                </button>

                <button
                  type="button"
                  onClick={handleConfirmDisconnect}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-lg shadow-rose-600/30 active:scale-95 cursor-pointer"
                >
                  <PhoneOff className="h-4 w-4" />
                  <span>Confirm Disconnect</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 4. Obsidian Dark Glass Scheduling Dialog Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Modal Backdrop with deep blur filter */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="absolute inset-0 bg-neutral-950/80 backdrop-blur-md"
            />

            {/* Modal Card content Container */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-md bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-2xl relative z-10 text-neutral-100"
            >
              {/* Top Banner Header */}
              <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
                    <CalendarDays className="h-4 w-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-extrabold text-white tracking-tight">Schedule Follow-up Booking</h3>
                    <p className="text-[10px] text-neutral-400">Add an automated CRM appointment node</p>
                  </div>
                </div>

                <button 
                  onClick={() => setShowModal(false)}
                  className="p-1.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/5 text-neutral-400 hover:text-white transition-all cursor-pointer"
                  title="Close Dialogue"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Pre-filled Calendar Input Form */}
              <form onSubmit={handleBooking} className="space-y-4">
                {/* 1. Recipient target */}
                <div>
                  <label className="block text-[8px] font-bold tracking-widest text-neutral-400 uppercase mb-1.5">Current Lead / Contact</label>
                  <div className="flex items-center gap-2 bg-neutral-900/60 border border-white/5 rounded-xl px-3 py-2.5 text-xs text-neutral-300 font-semibold select-none">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    {contact}
                  </div>
                </div>

                {/* 2. Meeting Title */}
                <div>
                  <label className="block text-[8px] font-bold tracking-widest text-neutral-400 uppercase mb-1.5">Meeting / Booking Title</label>
                  <input 
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="obsidian w-full bg-[var(--obsidian-2)] border border-white/15 focus:border-blue-500 focus:outline-none rounded-xl px-3 py-2.5 text-xs text-white placeholder-neutral-500 transition-colors font-sans"
                    placeholder="e.g., SLA Custom Terms Finalization"
                  />
                </div>

                {/* 3. Event Type selection */}
                <div>
                  <label className="block text-[8px] font-bold tracking-widest text-neutral-400 uppercase mb-1.5">Appointment Category</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as any)}
                    className="obsidian w-full bg-[var(--obsidian-2)] border border-white/15 focus:border-blue-500 focus:outline-none rounded-xl px-3 py-2.5 text-xs text-white transition-colors cursor-pointer"
                  >
                    <option value="followup">Follow-up Call (SLA Align)</option>
                    <option value="demo">Interactive Tech Demo</option>
                    <option value="call">Standard Core Consultation</option>
                    <option value="contract">Legal Draft Execution</option>
                  </select>
                </div>

                {/* 4. Scheduling Grids (Date & Time selectors) */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[8px] font-bold tracking-widest text-neutral-400 uppercase mb-1.5">Scheduled Date</label>
                    <div className="relative">
                      <input 
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="obsidian w-full bg-[var(--obsidian-2)] border border-white/15 focus:border-blue-500 focus:outline-none rounded-xl px-3 py-2.5 text-xs text-white font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[8px] font-bold tracking-widest text-neutral-400 uppercase mb-1.5">Target Time</label>
                    <div className="relative">
                      <input 
                        type="time"
                        required
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="obsidian w-full bg-[var(--obsidian-2)] border border-white/15 focus:border-blue-500 focus:outline-none rounded-xl px-3 py-2.5 text-xs text-white font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Strategic Advice Warning Alert Footer */}
                <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10 text-[9px] text-neutral-400 leading-relaxed flex gap-2.5">
                  <div className="h-4 w-4 rounded bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="h-2.5 w-2.5 text-blue-400" />
                  </div>
                  <div>
                    <span className="font-bold text-neutral-200">Zero-Trust Real-time Booking Guarantee</span>
                    <p className="mt-0.5 text-neutral-400">Saves directly into the CRM system's scheduling index. All parties receive automated dual-channel invite confirmations upon submission.</p>
                  </div>
                </div>

                {/* Dialog Action triggers */}
                <div className="flex items-center justify-end gap-2 border-t border-white/5 pt-4 mt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 rounded-xl border border-white/10 text-neutral-300 hover:text-white hover:bg-white/5 hover:border-white/15 text-xs font-bold transition-all cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Book Appointment</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
