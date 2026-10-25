declare interface DurableObjectNamespace {
  idFromName(name: string): any;
  get(id: any): any;
}

interface RealtimeInfra {
  generateTurnCredentials(options?: { ttl?: number }): Promise<{ iceServers: RTCIceServer[] }>;
}

declare module "agents" {
  export class Agent {
    constructor(state: any, environment: any);
    state: any;
    env: any;
  }
}

declare module "@cloudflare/voice" {
  import { Agent } from "agents";

  export interface VoiceAgentConfig {
    stt?: any;
    tts?: any;
    voice?: string;
  }

  export function withVoice<T extends new (...args: any[]) => Agent>(
    Base: T,
    config?: VoiceAgentConfig
  ): T & {
    new (...args: any[]): {
      onTurn(transcript: string, context: any): Promise<void>;
    };
  };

  export class WorkersAIFluxSTT {
    constructor();
  }

  export class WorkersAITTS {
    constructor(options?: { voice?: string });
  }
}

declare module "@cloudflare/voice/react" {
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

  export function useVoiceAgent(options?: UseVoiceAgentOptions): UseVoiceAgentResult;
}
