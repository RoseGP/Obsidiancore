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

/** Message slips are stored per organization on the server (/api/communication/message-slips). */
const slipFromServer = (s: any): ReceptionistMessageSlip => ({
  id: String(s.id),
  callerName: String(s.callerName || ''),
  callerCompany: String(s.callerCompany || ''),
  callbackNumber: String(s.callbackNumber || ''),
  recipient: String(s.recipient || ''),
  urgency: s.urgency === 'urgent' || s.urgency === 'high' ? s.urgency : 'normal',
  notes: String(s.notes || ''),
  timestamp: s.createdAt ? new Date(s.createdAt).toLocaleString() : '',
  status: s.status === 'resolved' || s.status === 'called_back' ? s.status : 'unread',
});

/** Reads the server's error message (e.g. "AI isn't set up on this server"). */
async function serverError(res: Response): Promise<string> {
  const d = await res.json().catch(() => ({} as any));
  return d?.error || `The server answered ${res.status}.`;
}

export function useVoiceAgent(options: UseVoiceAgentOptions = {}): UseVoiceAgentResult {
  const [callMode, setCallModeState] = useState<"receptionist" | "dialer">(options.callMode || "receptionist");
  const [activeDepartment, setActiveDepartment] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState<boolean>(false);
  const [messageSlips, setMessageSlips] = useState<ReceptionistMessageSlip[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/communication/message-slips")
      .then((r) => (r.ok ? r.json() : { slips: [] }))
      .then((d) => { if (!cancelled) setMessageSlips((d.slips || []).map(slipFromServer)); })
      .catch(() => { /* shown as empty */ });
    return () => { cancelled = true; };
  }, []);
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
  const [sentiment, setSentiment] = useState<"positive" | "neutral" | "skeptical" | "enthusiastic" | "urgent">("neutral");
  const [leadScore, setLeadScore] = useState<number>(0);
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

  // Department routing during a browser test call. Nothing is dialled: this only records where a real
  // call would be transferred. Live transfers need a connected phone line (Twilio IVR).
  const triggerDepartmentTransfer = useCallback(async (deptKey: string, deptName: string) => {
    if (statusRef.current !== "active") return;
    void deptKey;
    setActiveDepartment(deptName);
    playTransferChime();
    setTranscripts(prev => [...prev, {
      id: generateId(),
      sender: "agent",
      text: `[Test call] A real call would now be transferred to ${deptName}. No call was placed.`,
      timestamp: new Date(),
    }]);
  }, [playTransferChime]);

  // Message slip management
  const addManualMessageSlip = useCallback(async (slipData: Omit<ReceptionistMessageSlip, "id" | "timestamp" | "status"> & { source?: "manual" | "test_call" }) => {
    try {
      const res = await fetch("/api/communication/message-slips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slipData),
      });
      if (!res.ok) throw new Error(await serverError(res));
      const d = await res.json();
      setMessageSlips(prev => [slipFromServer(d.slip), ...prev]);
    } catch (err: any) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  const markMessageSlipStatus = useCallback((id: string, newStatus: "unread" | "resolved" | "called_back") => {
    setMessageSlips(prev => prev.map(s => s.id === id ? { ...s, status: newStatus } : s));
    fetch(`/api/communication/message-slips/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    }).then(async (res) => { if (!res.ok) setError(new Error(await serverError(res))); }).catch(() => {});
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
          leadCompany: activeConfig.leadCompany || "",
          leadDealValue: activeConfig.leadDealValue || "",
          leadStage: activeConfig.leadStage || "",
          agentPersona: activeConfig.agentPersona || "",
          callGoal: activeConfig.callGoal || undefined,
          userMessage: trimmed,
          conversationHistory: historyPayload
        })
      });

      if (!res.ok) {
        throw new Error(await serverError(res));
      }

      const data = await res.json();
      const reply = String(data.replyText || "");

      if (data.sentiment) setSentiment(data.sentiment);
      if (typeof data.qualificationScore === "number") setLeadScore(data.qualificationScore);
      if (data.actionItem && !actionItems.includes(data.actionItem)) {
        setActionItems(prev => [...prev, data.actionItem]);
      }

      // If receptionist triggered an autonomous action (Video call, Calendar event, Proposal)
      if (data.executedAction || data.actionType) {
        const actionType = data.executedAction?.type || data.actionType;
        const actionData = data.executedAction?.data || data.executedAction || {};
        let actionTitle = "Suggested action";
        let actionDesc = "The receptionist suggested this. Nothing was created: confirm it yourself.";

        if (actionType === "video_call") {
          actionTitle = "Suggested: video call";
          actionDesc = "Start a meeting from Meetings to send the caller a real link.";
        } else if (actionType === "calendar_event") {
          actionTitle = `Suggested meeting${actionData.title ? `: ${actionData.title}` : ""}`;
          actionDesc = `${[actionData.date, actionData.time].filter(Boolean).join(" at ") || "No time given"}. Add it to the calendar to book it.`;
        } else if (actionType === "proposal") {
          actionTitle = `Suggested proposal${actionData.title ? `: ${actionData.title}` : ""}`;
          actionDesc = `${typeof actionData.price === "number" ? `Mentioned amount: $${Number(actionData.price).toLocaleString()}. ` : ""}Create it in Proposals to send it.`;
        }

        const newAction: ReceptionistAction = {
          id: `act_${Date.now()}`,
          type: actionType,
          title: actionTitle,
          description: actionDesc,
          data: actionData,
          timestamp: "Just now",
          status: "pending"
        };

        setActiveActions(prev => [newAction, ...prev]);
        setLatestAction(newAction);
      }

      // If receptionist detected message taking, create message slip automatically
      if (data.isTakingMessage && data.messageSlip) {
        addManualMessageSlip({
          callerName: activeConfig.leadName || "Test caller",
          callerCompany: activeConfig.leadCompany || "",
          callbackNumber: data.messageSlip.callbackNumber || activeConfig.leadPhone || "",
          recipient: data.messageSlip.recipient || "",
          urgency: data.messageSlip.urgency === "urgent" || data.messageSlip.urgency === "high" ? data.messageSlip.urgency : "normal",
          notes: data.messageSlip.notes || trimmed,
          source: "test_call",
        });
      }

      const agentTranscript: VoiceTranscript = {
        id: generateId(),
        sender: "agent",
        text: reply,
        timestamp: new Date(),
      };

      setTranscripts(prev => [...prev, agentTranscript]);
      await speakText(reply);

      // If the receptionist chose a department, note where a real call would go.
      if (data.transferDepartment) {
        const names: Record<string, string> = { sales: "Sales", support: "Support", billing: "Billing", exec: "Management", partnerships: "Partnerships" };
        const targetDept = names[data.transferDepartment] || String(data.transferDepartment);
        setTimeout(() => {
          triggerDepartmentTransfer(data.transferDepartment, targetDept);
        }, 800);
      }

    } catch (err: any) {
      // No scripted reply: show what went wrong (e.g. AI not configured).
      setAgentState("listening");
      setError(err instanceof Error ? err : new Error(String(err)));
      setTranscripts(prev => [...prev, {
        id: generateId(),
        sender: "agent",
        text: `[Not answered] ${err?.message || "The AI receptionist is unavailable."}`,
        timestamp: new Date(),
      }]);
    }
  }, [callMode, speakText, actionItems, triggerDepartmentTransfer, addManualMessageSlip]);

  // Record an action the user wants to follow up on. Nothing is created here: the UI sends the user to
  // Meetings, Calendar or Proposals to do it for real.
  const executeAction = useCallback(async (type: "video_call" | "calendar_event" | "proposal", customParams?: any) => {
    const activeConfig = configRef.current;
    const who = activeConfig.leadCompany || activeConfig.leadName || "";
    const titles = { video_call: "Video call to set up", calendar_event: "Meeting to schedule", proposal: "Proposal to prepare" } as const;
    const where = { video_call: "Meetings", calendar_event: "Calendar", proposal: "Proposals" } as const;
    const newAction: ReceptionistAction = {
      id: `act_${Date.now()}`,
      type,
      title: `${titles[type]}${who ? ` for ${who}` : ""}`,
      description: `Open ${where[type]} to create it. Nothing has been created yet.`,
      data: { ...(customParams || {}), status: "suggested" },
      timestamp: "Just now",
      status: "pending"
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
          leadName: activeConfig.leadName || "Caller",
          leadPhone: activeConfig.leadPhone || "",
          leadCompany: activeConfig.leadCompany || "",
          leadDealValue: activeConfig.leadDealValue || "",
          durationSeconds: callDuration,
          transcripts: transcriptsRef.current
        })
      });

      if (!res.ok) throw new Error(await serverError(res));
      const data = await res.json();
      if (data.summary) {
        setPostCallSummary(data.summary);
        return data.summary;
      }
      return null;
    } catch (err: any) {
      setError(err instanceof Error ? err : new Error(String(err)));
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
      // No fake meter: show 0 and tell the user the microphone isn't available (typing still works).
      setAudioLevel(0);
      setError(new Error("Microphone unavailable or blocked. You can type the caller's words instead."));
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
      setSentiment("neutral");
      setLeadScore(0);
      setActionItems([]);
      setCallDuration(0);
      setStatus("connecting");
      setAgentState("idle");
      if (options.onStateChange) options.onStateChange("connecting");

      setStatus("active");
      setAgentState("speaking");
      if (options.onStateChange) options.onStateChange("active");

      const activeConfig = configRef.current;
      const isReception = (activeConfig.callMode || callMode) === "receptionist";
      setActiveDepartment(isReception ? "Reception" : null);

      const initialGreeting = isReception
        ? `Hello, thanks for calling. How can I help you today?`
        : `Hello ${activeConfig.leadName || "there"}, thanks for taking my call. How are you today?`;

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
