import { useState, useEffect, useRef, useCallback } from "react";

export interface VoiceTranscript {
  id: string;
  sender: "lead" | "agent";
  text: string;
  timestamp: Date;
}

export type VoiceConnectionState = "idle" | "connecting" | "active" | "on_hold" | "disconnected" | "error";
export type AgentState = "idle" | "listening" | "thinking" | "speaking" | "muted" | "on_hold";

export interface ReceptionistMessageSlip {
  id: string;
  callerName: string;
  callerCompany: string;
  callbackNumber: string;
  recipient: string;
  urgency: "normal" | "high" | "urgent";
  notes: string;
  timestamp: string;
  status: "unread" | "resolved" | "called_back";
}

export interface ReceptionistAction {
  id: string;
  type: "video_call" | "calendar_event" | "proposal";
  title: string;
  description: string;
  data: any;
  timestamp: string;
  status: "executed" | "pending";
}

export interface PostCallSummary {
  executiveSummary: string;
  sentimentScore: string;
  leadQuality: string;
  keyTopicsDiscussed: string[];
  actionItems: string[];
  suggestedNextStep: string;
  crmNote: string;
}

export interface UseVoiceAgentOptions {
  callMode?: "receptionist" | "dialer";
  leadId?: string;
  leadName?: string;
  leadCompany?: string;
  leadPhone?: string;
  leadDealValue?: string;
  leadStage?: string;
  agentPersona?: string;
  callGoal?: string;
  onStateChange?: (state: VoiceConnectionState) => void;
  onError?: (error: Error) => void;
}

export interface UseVoiceAgentResult {
  status: VoiceConnectionState;
  agentState: AgentState;
  callMode: "receptionist" | "dialer";
  activeDepartment: string | null;
  isTransferring: boolean;
  transcripts: VoiceTranscript[];
  interimTranscript: string;
  audioLevel: number;
  isMuted: boolean;
  isOnHold: boolean;
  isRecording: boolean;
  callDuration: number;
  sentiment: "positive" | "neutral" | "skeptical" | "enthusiastic" | "urgent";
  leadScore: number;
  actionItems: string[];
  messageSlips: ReceptionistMessageSlip[];
  activeActions: ReceptionistAction[];
  latestAction: ReceptionistAction | null;
  postCallSummary: PostCallSummary | null;
  isGeneratingSummary: boolean;
  startCall: (customConfig?: Partial<UseVoiceAgentOptions>) => Promise<void>;
  disconnect: () => void;
  toggleMuted: () => void;
  toggleHold: () => void;
  toggleRecording: () => void;
  setCallMode: (mode: "receptionist" | "dialer") => void;
  playDTMFTone: (key: string) => void;
  triggerDepartmentTransfer: (deptKey: string, deptName: string) => Promise<void>;
  executeAction: (type: "video_call" | "calendar_event" | "proposal", customParams?: any) => Promise<any>;
  clearActiveAction: (actionId?: string) => void;
  addManualMessageSlip: (slip: Omit<ReceptionistMessageSlip, "id" | "timestamp" | "status">) => void;
  markMessageSlipStatus: (id: string, status: "unread" | "resolved" | "called_back") => void;
  submitVoiceInput: (phrase: string) => Promise<void>;
  generatePostCallReport: () => Promise<PostCallSummary | null>;
  clearPostCallSummary: () => void;
  error: Error | null;
}

// Helper to generate UUIDs for transcripts
const generateId = () => `vt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

// DTMF standard phone keypad frequencies
const DTMF_FREQS: Record<string, [number, number]> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477],
};

const SEED_MESSAGE_SLIPS: ReceptionistMessageSlip[] = [
  {
    id: "slip_1",
    callerName: "Richard Thorne",
    callerCompany: "Apex BioTech",
    callbackNumber: "+1 (555) 492-1049",
    recipient: "Evelyn Sinclair (CEO Office)",
    urgency: "high",
    notes: "Follow-up regarding private equity partnership syndicate term sheet.",
    timestamp: "Today, 11:20 AM",
    status: "unread"
  },
  {
    id: "slip_2",
    callerName: "Kendra Larson",
    callerCompany: "Nexus Retailers",
    callbackNumber: "+1 (555) 301-8842",
    recipient: "Billing & Invoicing (Marcus Zhao)",
    urgency: "normal",
    notes: "Requested updated Q3 VAT invoice and tax exemption certificate.",
    timestamp: "Yesterday, 4:15 PM",
    status: "called_back"
  }
];

export function useVoiceAgent(options: UseVoiceAgentOptions = {}): UseVoiceAgentResult {
  const [callMode, setCallModeState] = useState<"receptionist" | "dialer">(options.callMode || "receptionist");
  const [activeDepartment, setActiveDepartment] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [messageSlips, setMessageSlips] = useState<ReceptionistMessageSlip[]>(SEED_MESSAGE_SLIPS);
  const [activeActions, setActiveActions] = useState<ReceptionistAction[]>([]);
  const [latestAction, setLatestAction] = useState<ReceptionistAction | null>(null);

  const [status, setStatus] = useState<VoiceConnectionState>("idle");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>([]);
  const [interimTranscript, setInterimTranscript] = useState<string>("");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isOnHold, setIsOnHold] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(true);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [sentiment, setSentiment] = useState<"positive" | "neutral" | "skeptical" | "enthusiastic" | "urgent">("positive");
  const [leadScore, setLeadScore] = useState<number>(75);
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [postCallSummary, setPostCallSummary] = useState<PostCallSummary | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  // Mutable config ref for dynamic override
  const configRef = useRef<UseVoiceAgentOptions>(options);
  useEffect(() => {
    configRef.current = { ...configRef.current, ...options };
  }, [options]);

  // References for Web APIs & state tracking
  const recognitionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMutedRef = useRef<boolean>(false);
  const isOnHoldRef = useRef<boolean>(false);
  const statusRef = useRef<VoiceConnectionState>("idle");
  const transcriptsRef = useRef<VoiceTranscript[]>([]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isOnHoldRef.current = isOnHold;
  }, [isOnHold]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  // Call duration counter
  useEffect(() => {
    if (status === "active" || status === "on_hold") {
      timerIntervalRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [status]);

  // Web Audio DTMF Keypad Tone Generator
  const playDTMFTone = useCallback((key: string) => {
    try {
      const freqs = DTMF_FREQS[key];
      if (!freqs) return;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = "sine";
      osc2.type = "sine";
      osc1.frequency.value = freqs[0];
      osc2.frequency.value = freqs[1];

      gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.16);
      osc2.stop(ctx.currentTime + 0.16);

      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 300);
    } catch {
      // AudioContext might be blocked until user gesture, ignore
    }
  }, []);

  // Web Speech TTS Synthesis
  const speakText = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        resolve();
        return;
      }

      window.speechSynthesis.cancel();

      if (isMutedRef.current || isOnHoldRef.current) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      // Look for natural English voice
      const preferred = voices.find(v => (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Samantha") || v.name.includes("Daniel")) && v.lang.startsWith("en"));
      const fallback = voices.find(v => v.lang.startsWith("en")) || voices[0];
      if (preferred || fallback) {
        utterance.voice = preferred || fallback;
      }

      utterance.pitch = 1.02;
      utterance.rate = 1.04;

      utterance.onstart = () => {
        setAgentState("speaking");
      };

      utterance.onend = () => {
        if (statusRef.current === "active") {
          setAgentState(isMutedRef.current ? "muted" : "listening");
        }
        resolve();
      };

      utterance.onerror = () => {
        if (statusRef.current === "active") {
          setAgentState(isMutedRef.current ? "muted" : "listening");
        }
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }, []);

  // Play a gentle warm transfer chime using Web Audio
  const playTransferChime = useCallback(() => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.04, ctx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.12 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.12);
        osc.stop(ctx.currentTime + idx * 0.12 + 0.35);
      });
      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 900);
    } catch {}
  }, []);

  // Warm Department Transfer execution
  const triggerDepartmentTransfer = useCallback(async (deptKey: string, deptName: string) => {
    if (statusRef.current !== "active") return;
    setIsTransferring(true);
    setIsOnHold(true);
    setStatus("on_hold");
    setAgentState("on_hold");

    // Announce transfer
    const announceText = `Transferring you to ${deptName}. Please hold for just a moment.`;
    const transferNoticeTranscript: VoiceTranscript = {
      id: generateId(),
      sender: "agent",
      text: `[SYSTEM: Warm Transfer Initiated -> ${deptName}] ${announceText}`,
      timestamp: new Date(),
    };
    setTranscripts(prev => [...prev, transferNoticeTranscript]);
    playTransferChime();
    await speakText(announceText);

    // Realistic warm transfer hold delay
    await new Promise(resolve => setTimeout(resolve, 2200));

    // Complete transfer handover
    setActiveDepartment(deptName);
    setIsTransferring(false);
    setIsOnHold(false);
    setStatus("active");
    setAgentState("speaking");

    let deptGreeting = `Hello! This is ${deptName}. How can I assist you with your request today?`;
    if (deptKey === "sales") deptGreeting = `Hello! This is Alex Vance in Sales. I understand you're interested in our enterprise platform. How can I assist?`;
    if (deptKey === "support") deptGreeting = `Hi there! Jordan Reed in Technical Support here. I have your connection open. What technical issue or API question can I solve for you?`;
    if (deptKey === "billing") deptGreeting = `Hello, Marcus Zhao in Billing & Accounts. I can assist you with your invoices, payment methods, or licensing right away.`;
    if (deptKey === "exec") deptGreeting = `You've reached Evelyn Sinclair's executive line. Evelyn is currently in a meeting, but her private desk is logging this call. How can we help?`;

    const handoverTranscript: VoiceTranscript = {
      id: generateId(),
      sender: "agent",
      text: deptGreeting,
      timestamp: new Date(),
    };
    setTranscripts(prev => [...prev, handoverTranscript]);
    await speakText(deptGreeting);
  }, [playTransferChime, speakText]);

  // Message slip management
  const addManualMessageSlip = useCallback((slipData: Omit<ReceptionistMessageSlip, "id" | "timestamp" | "status">) => {
    const newSlip: ReceptionistMessageSlip = {
      id: `slip_${Date.now()}`,
      ...slipData,
      timestamp: "Just now",
      status: "unread"
    };
    setMessageSlips(prev => [newSlip, ...prev]);
  }, []);

  const markMessageSlipStatus = useCallback((id: string, newStatus: "unread" | "resolved" | "called_back") => {
    setMessageSlips(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
  }, []);

  const setCallMode = useCallback((mode: "receptionist" | "dialer") => {
    setCallModeState(mode);
    configRef.current.callMode = mode;
  }, []);

  // Send turn to backend Gemini endpoint
  const submitVoiceInput = useCallback(async (phrase: string) => {
    if (!phrase || !phrase.trim() || statusRef.current !== "active" || isOnHoldRef.current) return;

    const trimmed = phrase.trim();

    // Append lead transcript
    const userTranscript: VoiceTranscript = {
      id: generateId(),
      sender: "lead",
      text: trimmed,
      timestamp: new Date(),
    };

    setTranscripts(prev => [...prev, userTranscript]);
    setInterimTranscript("");
    setAgentState("thinking");

    try {
      const activeConfig = configRef.current;
      const historyPayload = transcriptsRef.current.slice(-8).map(t => ({
        sender: t.sender,
        text: t.text
      }));

      const res = await fetch("/api/communication/voice-dialer/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callMode: activeConfig.callMode || callMode,
          leadName: activeConfig.leadName || "Caller",
          leadCompany: activeConfig.leadCompany || "Guest Client",
          leadDealValue: activeConfig.leadDealValue || "$50,000",
          leadStage: activeConfig.leadStage || "Discovery",
          agentPersona: activeConfig.agentPersona || "Alex AI - Unified Executive Voice Concierge",
          callGoal: activeConfig.callGoal || (callMode === "receptionist" ? "Greet caller, answer knowledge base questions, execute actions or route to department" : "Qualify lead and book executive briefing"),
          userMessage: trimmed,
          conversationHistory: historyPayload
        })
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const data = await res.json();
      const reply = data.replyText || "Thank you for letting me know. How else may I assist you today?";

      if (data.sentiment) setSentiment(data.sentiment);
      if (data.qualificationScore) setLeadScore(data.qualificationScore);
      if (data.actionItem && !actionItems.includes(data.actionItem)) {
        setActionItems(prev => [...prev, data.actionItem]);
      }

      // If receptionist triggered an autonomous action (Video call, Calendar event, Proposal)
      if (data.executedAction || data.actionType) {
        const actionType = data.executedAction?.type || data.actionType;
        const actionData = data.executedAction?.data || data.executedAction || {};
        let actionTitle = "Autonomous Action Triggered";
        let actionDesc = "Receptionist executed an autonomous business workflow.";

        if (actionType === "video_call") {
          actionTitle = `My Meet & Greet Video Consultation`;
          actionDesc = `Encrypted WebRTC video bridge launched with room ID: ${actionData.roomId || "meet_greet"}. Ready to route to My Meet & Greet.`;
        } else if (actionType === "calendar_event") {
          actionTitle = `Calendar Scheduled: ${actionData.title || "Meeting"}`;
          actionDesc = `Event set for ${actionData.date || "Tomorrow"} at ${actionData.time || "14:00"} (${actionData.duration || 30} mins).`;
        } else if (actionType === "proposal") {
          actionTitle = `Proposal Created: ${actionData.title || "Enterprise Proposal"}`;
          actionDesc = `Formal proposal ($${Number(actionData.price || 78000).toLocaleString()}) generated for ${actionData.clientName || "Client"}.`;
        }

        const newAction: ReceptionistAction = {
          id: `act_${Date.now()}`,
          type: actionType,
          title: actionTitle,
          description: actionDesc,
          data: actionData,
          timestamp: "Just now",
          status: "executed"
        };

        setActiveActions(prev => [newAction, ...prev]);
        setLatestAction(newAction);
      }

      // If receptionist detected message taking, create message slip automatically
      if (data.isTakingMessage && data.messageSlip) {
        const newSlip: ReceptionistMessageSlip = {
          id: `slip_${Date.now()}`,
          callerName: activeConfig.leadName || "Inbound Caller",
          callerCompany: activeConfig.leadCompany || "Guest Client",
          callbackNumber: data.messageSlip.callbackNumber || activeConfig.leadPhone || "+1 (555) 234-8901",
          recipient: data.messageSlip.recipient || "Front Desk Inbound Queue",
          urgency: data.messageSlip.urgency || "normal",
          notes: data.messageSlip.notes || trimmed,
          timestamp: "Just now",
          status: "unread"
        };
        setMessageSlips(prev => [newSlip, ...prev]);
      }

      const agentTranscript: VoiceTranscript = {
        id: generateId(),
        sender: "agent",
        text: reply,
        timestamp: new Date(),
      };

      setTranscripts(prev => [...prev, agentTranscript]);
      await speakText(reply);

      // If receptionist triggered a warm transfer to department
      if (data.transferDepartment) {
        const deptMap: Record<string, string> = {
          sales: "Sales & New Accounts (Alex Vance)",
          support: "Technical Support & DevOps (Jordan Reed)",
          billing: "Billing & Invoicing (Marcus Zhao)",
          exec: "Executive Suite (Evelyn Sinclair Desk)",
          partnerships: "Strategic Partnerships (David Kim)"
        };
        const targetDept = deptMap[data.transferDepartment] || "Department Specialist";
        setTimeout(() => {
          triggerDepartmentTransfer(data.transferDepartment, targetDept);
        }, 800);
      }

    } catch (err: any) {
      console.warn("[VoiceAgent Turn Warning] Fallback triggered:", err.message);

      // Local fallback turn
      const fallbackReply = callMode === "receptionist"
        ? `Thank you for calling Obsidian Core. How can I direct your call today? I can connect you to Sales, Technical Support, Billing, or take a message for our executive team.`
        : `Understood. At Obsidian Core, we customize every deployment to ensure seamless integration and sub-50ms latency. Would you like to reserve a 20-minute executive briefing next week?`;

      const agentTranscript: VoiceTranscript = {
        id: generateId(),
        sender: "agent",
        text: fallbackReply,
        timestamp: new Date(),
      };

      setTranscripts(prev => [...prev, agentTranscript]);
      await speakText(fallbackReply);
    }
  }, [callMode, speakText, actionItems, triggerDepartmentTransfer]);

  // Execute an action on-demand from UI or voice commands
  const executeAction = useCallback(async (type: "video_call" | "calendar_event" | "proposal", customParams?: any) => {
    const activeConfig = configRef.current;
    const clientName = activeConfig.leadCompany || activeConfig.leadName || "Client Partner";

    let actionTitle = "";
    let actionDesc = "";
    let actionData: any = null;

    if (type === "video_call") {
      const room = `meet-greet-${Math.random().toString(36).substring(2, 7)}`;
      actionData = {
        roomId: `room_${Date.now()}`,
        roomName: `My Meet & Greet`,
        topic: `My Meet & Greet Consultation with ${clientName}`,
        joinUrl: `/meet-and-greet?room=${room}&autojoin=true`,
        targetView: "call_canvas",
        participants: [activeConfig.leadName || "Executive Guest", "Sophia (AI Receptionist)", "Alex Vance (Sales VP)"],
        scheduledTime: "Immediate / Live WebRTC",
        recordingEnabled: true
      };
      actionTitle = `My Meet & Greet Video Consultation`;
      actionDesc = `Encrypted WebRTC video bridge launched. Routed to My Meet & Greet.`;
    } else if (type === "calendar_event") {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
      actionData = {
        meetingId: `cal_${Date.now()}`,
        title: customParams?.title || `Executive Strategy Briefing: ${clientName}`,
        date: customParams?.date || tomorrow,
        time: customParams?.time || "14:00",
        duration: customParams?.duration || 30,
        calendarType: "Google Calendar & CRM Sync",
        attendees: [
          activeConfig.leadName ? `${activeConfig.leadName.toLowerCase().replace(/\s+/g, ".")}@${(activeConfig.leadCompany || "client").toLowerCase().replace(/\s+/g, "")}.com` : "guest@enterprise.com",
          "reception@obsidiancore.com",
          "evelyn.sinclair@obsidiancore.com"
        ]
      };
      actionTitle = `Calendar Scheduled: ${actionData.title}`;
      actionDesc = `Confirmed for ${actionData.date} at ${actionData.time} with Google Calendar sync.`;
    } else if (type === "proposal") {
      actionData = {
        proposalId: `prop_${Date.now()}`,
        clientName: clientName,
        title: customParams?.title || `Obsidian Core Omnichannel SLA & Deployment Proposal`,
        price: customParams?.price || 78000,
        currency: "USD",
        status: "Draft Ready for e-Signature",
        deliverables: customParams?.deliverables || [
          "Phase 1: Zero-Trust Security Architecture & Cloud Infrastructure ($19,500)",
          "Phase 2: Real-Time WebRTC Telephony & AI Receptionist Training ($19,500)",
          "Phase 3: High-Frequency Messaging & Multi-Channel Sync ($19,500)",
          "Phase 4: 24/7 Priority SLA & Dedicated Account Engineering ($19,500)"
        ]
      };
      actionTitle = `Proposal Created: ${actionData.title}`;
      actionDesc = `Enterprise proposal ($${Number(actionData.price).toLocaleString()}) generated for ${actionData.clientName}.`;
    }

    const newAction: ReceptionistAction = {
      id: `act_${Date.now()}`,
      type,
      title: actionTitle,
      description: actionDesc,
      data: actionData,
      timestamp: "Just now",
      status: "executed"
    };

    setActiveActions(prev => [newAction, ...prev]);
    setLatestAction(newAction);
    return newAction;
  }, []);

  const clearActiveAction = useCallback((actionId?: string) => {
    if (actionId) {
      setActiveActions(prev => prev.filter(a => a.id !== actionId));
      setLatestAction(prev => (prev?.id === actionId ? null : prev));
    } else {
      setLatestAction(null);
    }
  }, []);

  // Generate full Post-Call CRM Intelligence Briefing
  const generatePostCallReport = useCallback(async (): Promise<PostCallSummary | null> => {
    setIsGeneratingSummary(true);
    try {
      const activeConfig = configRef.current;
      const res = await fetch("/api/communication/voice-dialer/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadName: activeConfig.leadName || "Sarah Jenkins",
          leadPhone: activeConfig.leadPhone || "+1 (555) 234-8901",
          leadCompany: activeConfig.leadCompany || "TechFlow Innovations",
          leadDealValue: activeConfig.leadDealValue || "$120,000",
          durationSeconds: callDuration,
          transcripts: transcriptsRef.current
        })
      });

      const data = await res.json();
      if (data.summary) {
        setPostCallSummary(data.summary);
        return data.summary;
      }
      return null;
    } catch (err) {
      console.error("Failed to generate post-call report:", err);
      return null;
    } finally {
      setIsGeneratingSummary(false);
    }
  }, [callDuration]);

  // Start microphone analysis for live visualizer
  const startMicAnalysis = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = audioStream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(audioStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const mappedVolume = Math.min(Math.round((avg / 128) * 100), 100);

        setAudioLevel(isMutedRef.current || isOnHoldRef.current ? 0 : mappedVolume);
        animationFrameRef.current = requestAnimationFrame(checkVolume);
      };

      checkVolume();
    } catch (err: any) {
      console.warn("Microphone access unavailable or denied. Using synthetic audio activity visualizer:", err.message);
      const simulateMic = () => {
        if (statusRef.current === "active" && !isMutedRef.current && !isOnHoldRef.current) {
          const rand = Math.floor(Math.sin(Date.now() / 220) * 18 + 22 + Math.random() * 8);
          setAudioLevel(Math.max(0, Math.min(rand, 100)));
        } else {
          setAudioLevel(0);
        }
        animationFrameRef.current = requestAnimationFrame(simulateMic);
      };
      simulateMic();
    }
  };

  const stopMicAnalysis = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  };

  // Browser speech recognition (STT)
  const startSpeechRecognition = useCallback(() => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      console.warn("SpeechRecognition is not natively supported in this browser. Manual input is available.");
      return;
    }

    const rec = new SpeechRecognitionClass();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (event: any) => {
      if (isMutedRef.current || isOnHoldRef.current) return;

      let finalTranscript = "";
      let localInterim = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          localInterim += event.results[i][0].transcript;
        }
      }

      if (localInterim) {
        setInterimTranscript(localInterim);
      }

      if (finalTranscript.trim()) {
        submitVoiceInput(finalTranscript.trim());
      }
    };

    rec.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed") {
        console.warn("Speech recognition mic permission not allowed.");
      }
    };

    rec.onend = () => {
      setTimeout(() => {
        if (statusRef.current === "active" && !isOnHoldRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch {
            // Already started or busy
          }
        }
      }, 300);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      // Ignored
    }
  }, [submitVoiceInput]);

  const disconnect = useCallback(() => {
    setStatus("disconnected");
    setAgentState("idle");
    stopMicAnalysis();

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      try {
        recognitionRef.current.stop();
      } catch {
        // No-op
      }
      recognitionRef.current = null;
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    setInterimTranscript("");

    // Auto-generate post-call intelligence report if we have at least 1 turn
    if (transcriptsRef.current.length > 1) {
      generatePostCallReport();
    }

    if (options.onStateChange) {
      options.onStateChange("disconnected");
    }
  }, [options, generatePostCallReport]);

  const startCall = useCallback(async (customConfig?: Partial<UseVoiceAgentOptions>) => {
    try {
      if (customConfig) {
        configRef.current = { ...configRef.current, ...customConfig };
      }

      setError(null);
      setPostCallSummary(null);
      setCallDuration(0);
      setStatus("connecting");
      setAgentState("idle");
      if (options.onStateChange) options.onStateChange("connecting");

      // Realistic carrier dialing / WebSocket handshake latency
      await new Promise(resolve => setTimeout(resolve, 1100));

      setStatus("active");
      setAgentState("speaking");
      if (options.onStateChange) options.onStateChange("active");

      const activeConfig = configRef.current;
      const isReception = (activeConfig.callMode || callMode) === "receptionist";
      setActiveDepartment(isReception ? "Front Desk Virtual Reception" : null);

      const initialGreeting = isReception
        ? `Thank you for calling Obsidian Core. My name is Alex AI, your unified voice concierge. How may I direct your call, answer questions, or assist you today?`
        : `Hello ${activeConfig.leadName || "there"}, this is Alex AI calling from Obsidian Core regarding ${activeConfig.leadCompany || "your team"}'s platform inquiry. How are you doing today?`;

      setTranscripts([
        {
          id: generateId(),
          sender: "agent",
          text: initialGreeting,
          timestamp: new Date(),
        }
      ]);

      await speakText(initialGreeting);
      await startMicAnalysis();
      startSpeechRecognition();

    } catch (err: any) {
      setError(err);
      setStatus("error");
      setAgentState("idle");
      if (options.onStateChange) options.onStateChange("error");
      if (options.onError) options.onError(err);
    }
  }, [callMode, options, speakText, startSpeechRecognition]);

  const toggleMuted = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      setAgentState(next ? "muted" : "listening");
      return next;
    });
  }, []);

  const toggleHold = useCallback(() => {
    setIsOnHold(prev => {
      const next = !prev;
      setStatus(next ? "on_hold" : "active");
      setAgentState(next ? "on_hold" : (isMutedRef.current ? "muted" : "listening"));
      if (next && typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      return next;
    });
  }, []);

  const toggleRecording = useCallback(() => {
    setIsRecording(prev => !prev);
  }, []);

  const clearPostCallSummary = useCallback(() => {
    setPostCallSummary(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try { recognitionRef.current.stop(); } catch {}
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Window manual input dispatcher hookup for automated tests
  useEffect(() => {
    (window as any)._voiceAgentInputHandler = submitVoiceInput;
    return () => {
      delete (window as any)._voiceAgentInputHandler;
    };
  }, [submitVoiceInput]);

  return {
    status,
    agentState,
    callMode,
    activeDepartment,
    isTransferring,
    transcripts,
    interimTranscript,
    audioLevel,
    isMuted,
    isOnHold,
    isRecording,
    callDuration,
    sentiment,
    leadScore,
    actionItems,
    messageSlips,
    activeActions,
    latestAction,
    postCallSummary,
    isGeneratingSummary,
    startCall,
    disconnect,
    toggleMuted,
    toggleHold,
    toggleRecording,
    setCallMode,
    playDTMFTone,
    triggerDepartmentTransfer,
    executeAction,
    clearActiveAction,
    addManualMessageSlip,
    markMessageSlipStatus,
    submitVoiceInput,
    generatePostCallReport,
    clearPostCallSummary,
    error,
  };
}
