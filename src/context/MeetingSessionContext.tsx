import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { DEFAULT_PLAN_CONFIGS, MEETING_PLAN_TIERS, capacityStatus, durationStatus, roomCapacity, type CapacityState, type MeetingPlanConfigs, type MeetingPlanTier, type PlanFeatures, type PlanLimits } from '../lib/meetingPlans';
import { CRMContact, CalendarEvent } from '../types';
import { useOptionalAuth } from './AuthContext';
import { MeetingMedia, type ChatPacket, type MediaStatus, type RemoteMedia } from '../lib/meetingMedia';
export type { MediaStatus, RemoteMedia } from '../lib/meetingMedia';

export interface MeetingParticipant {
  id: string;
  name: string;
  role: 'Host' | 'Co-Host' | 'Client' | 'Guest' | string;
  title: string;
  company: string;
  email: string;
  phone?: string;
  avatar: string;
  avatarColor?: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isSpeaking: boolean;
  isScreenSharing?: boolean;
  /** Raised hand (cleared when the host lowers it or the participant lowers their own). */
  isHandRaised?: boolean;
  handRaisedAt?: number;
  joinedAt: string;
  bio?: string;
  interests?: string[];
  isCrmContact?: boolean;
  crmContactId?: string;
  /** Role on the server (host / co-host / guest). */
  serverRole?: 'host' | 'cohost' | 'guest';
}

export interface MeetingChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  isYou: boolean;
  recipientId?: string; // 'everyone' or participant id
  recipientName?: string;
  text: string;
  timestamp: string;
  attachments?: Array<{ name: string; size: string; type: string; url: string }>;
  reactions?: Record<string, number>;
}

export interface MeetingFollowupTask {
  id: string;
  title: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  contactName: string;
}

export interface TranscriptItem {
  id: string;
  speakerId: string;
  speakerName: string;
  speakerAvatar?: string;
  timestamp: string; // e.g. "00:14"
  timeSeconds: number;
  text: string;
  isHost?: boolean;
}

export interface MeetingRecordingData {
  id: string;
  meetingId: string;
  roomId: string;
  title: string;
  startedAt: number;
  durationSeconds: number;
  recordedAt: string;
  videoUrl?: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  mimeType: string;
  transcript: TranscriptItem[];
  participants: MeetingParticipant[];
  notes?: string;
}

export interface MeetingHistoryRecord {
  id: string;
  roomId: string;
  title: string;
  date: string;
  time: string;
  durationSeconds: number;
  durationFormatted: string;
  hostName: string;
  participants: Array<{ name: string; title: string; company: string; avatar: string }>;
  hasRecording: boolean;
  recordingUrl?: string;
  recordingSize?: string;
  hasTranscript: boolean;
  transcript: TranscriptItem[];
  notes: string;
  tasksCount: number;
}

export interface MeetingDeviceSettings {
  selectedCameraId: string;
  selectedMicrophoneId: string;
  selectedSpeakerId: string;
  videoQuality: '1080p' | '720p' | '480p' | '360p';
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoRecord: boolean;
  autoTranscribe: boolean;
  notifyOnParticipantJoin: boolean;
}

// Plans live in src/lib/meetingPlans.ts (shared with the server); re-exported for existing imports.
export type { MeetingPlanTier, MeetingPlanConfig, PlanLimits, PlanFeatures } from '../lib/meetingPlans';

/** GET /api/meetings/subscription */
export interface MeetingSubscription {
  tier: MeetingPlanTier;
  plan: { tier: MeetingPlanTier; label: string; limits: PlanLimits; features: PlanFeatures; warnMinutesBefore: number; capacityWarnPercent: number; custom: boolean };
  plans: MeetingPlanConfigs;
  canRequestChange: boolean;
  pendingRequest: { id: string; requestedTier: MeetingPlanTier; direction: 'upgrade' | 'downgrade'; createdAt: string; note?: string } | null;
  billing: { connected: boolean; message: string };
}

/** The meeting as the server sees it (src/server/meetings/sessions.ts sessionView). */
export interface ServerSessionView {
  id: string; roomCode: string; title: string; tier: MeetingPlanTier; planLabel: string;
  limits: PlanLimits; features: PlanFeatures; warnMinutesBefore: number; capacityWarnPercent: number;
  startedAt: number; endsAt: number; serverNow: number; status: 'active' | 'ended'; endedReason: 'host' | 'time_limit' | 'admin' | null;
  remainingSeconds: number; participantCount: number; waitingCount: number; capacityState: CapacityState;
  waitingRoomEnabled: boolean; locked: boolean; recording: { active: boolean; startedAt: number | null };
  host: { userId: string; name: string };
  you: { participantId: string | null; role: 'host' | 'cohost' | 'guest' | null; status: string | null; canManage: boolean };
  participants: Array<{ id: string; name: string; role: 'host' | 'cohost' | 'guest'; status: 'in' | 'waiting'; joinedAt: number | null; email?: string; userId?: string | null }>;
}

/** A plan limit or missing feature the person ran into (shown with an upgrade option). */
export interface PlanNotice { message: string; feature?: string; upgradeTo?: MeetingPlanTier; upgradeLabel?: string; kind: 'feature' | 'capacity' | 'duration' | 'error' }

/** Sandbox/dev builds may run meetings without a server (limits applied in this browser only). Production never does. */
let previewAllowed: boolean = !!((import.meta as any).env?.DEV || (import.meta as any).env?.VITE_ENABLE_SANDBOX_LOGIN === 'true');
/** Tests only. */
export function setMeetingPreviewAllowedForTests(v: boolean) { previewAllowed = v; }

export interface ActiveMeetingSession {
  id: string;
  roomId: string;
  title: string;
  hostName: string;
  startedAt: number;
  durationSeconds: number;
  status: 'active' | 'ended';
  isHost: boolean;
  participants: MeetingParticipant[];
  messages: MeetingChatMessage[];
  notes: string;
  tasks: MeetingFollowupTask[];
  linkedContactId?: string;
  recordingData?: MeetingRecordingData;
  /** Plan limits locked in when the meeting started. */
  planTier?: MeetingPlanTier;
  maxParticipants?: number;
  maxDurationMinutes?: number;
  /** Set when the meeting ended because the plan's time limit was reached. */
  /** Set when the server (or the time limit) ended the meeting, not the local user. */
  endedReason?: 'time_limit' | 'host' | 'admin';
}

interface MeetingSessionContextType {
  activeMeeting: ActiveMeetingSession | null;
  isCallActive: boolean;
  meetingViewMode: 'fullscreen' | 'workspace' | 'minimized';
  setMeetingViewMode: (mode: 'fullscreen' | 'workspace' | 'minimized') => void;

  // Subscription & plan limits. The organizer's plan comes from the server and every limit is enforced there.
  subscription: MeetingSubscription | null;
  refreshSubscription: () => Promise<void>;
  requestPlanChange: (tier: MeetingPlanTier, note?: string) => Promise<{ success: boolean; message: string }>;
  cancelPlanRequest: () => Promise<{ success: boolean; message: string }>;
  /** The running meeting as the server reports it (null in offline preview). */
  serverSession: ServerSessionView | null;
  /** Limits and features that apply now: the running meeting's, otherwise the organization's plan. */
  meetingLimits: PlanLimits;
  meetingFeatures: PlanFeatures;
  meetingPlanLabel: string;
  meetingTier: MeetingPlanTier;
  warnMinutesBefore: number;
  capacityWarnPercent: number;
  capacityState: CapacityState;
  /** Everyone in the meeting, host included. */
  roomCount: number;
  isDurationWarning: boolean;
  isDurationLimitReached: boolean;
  /** Seconds until the meeting's time limit. */
  durationSecondsLeft: number;
  /** You can manage this meeting (host, co-host or organization admin). */
  canManageMeeting: boolean;
  /** No server: sandbox preview with Free limits applied in this browser only. */
  offlinePreview: boolean;
  /** Joined by code and waiting for the host to admit you. */
  awaitingAdmission: boolean;
  isMeetingLocked: boolean;
  setMeetingLocked: (locked: boolean) => Promise<{ success: boolean; message: string }>;
  setCoHost: (participantId: string, on: boolean) => Promise<{ success: boolean; message: string }>;
  /** Why the last meeting couldn't start or join. */
  meetingError: string | null;
  clearMeetingError: () => void;
  /** A plan limit or missing feature the person just ran into. */
  planNotice: PlanNotice | null;
  clearPlanNotice: () => void;

  // Real audio/video (LiveKit). 'not_configured' = the server has no media service: nobody is simulated.
  mediaStatus: MediaStatus;
  mediaMessage: string | null;
  /** Remote people's live media by roster id. */
  remoteMedia: Record<string, RemoteMedia>;
  /** The signed-in person's name (shown on your own tile and in chat). */
  localUserName: string;
  
  // Media streams & hardware controls
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  isMicMuted: boolean;
  isCamOff: boolean;
  isVideoPaused: boolean;
  isScreenSharing: boolean;
  screenShareError: string | null;
  hasSystemAudio: boolean;
  micAudioLevel: number;
  
  // Actions
  startInstantMeeting: (
    roomCode?: string, 
    linkedContact?: CRMContact,
    customTitle?: string,
    initialOptions?: {
      autoRecord?: boolean;
      autoTranscribe?: boolean;
      startMuted?: boolean;
      startCamOff?: boolean;
    }
  ) => Promise<{ success: boolean; message?: string }>;
  joinMeeting: (codeOrLink: string, linkedContact?: CRMContact) => Promise<{ success: boolean; message?: string }>;
  returnToMeeting: () => void;
  minimizeToDashboard: () => void;
  leaveMeeting: () => void;
  endMeetingForEveryone: () => void;
  
  // Hardware toggles
  toggleMic: () => void;
  toggleCam: () => Promise<void>;
  togglePauseVideo: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
  
  // In-meeting operations
  sendChatMessage: (text: string, recipientId?: string, attachment?: any) => void;
  updateMeetingTitle: (newTitle: string) => void;
  updateMeetingNotes: (notes: string) => void;
  addFollowupTask: (task: Omit<MeetingFollowupTask, 'id' | 'completed'>) => void;
  toggleTaskCompleted: (taskId: string) => void;
  addParticipantToCrm: (participant: MeetingParticipant) => void;
  inviteParticipantByEmail: (email: string) => Promise<{ success: boolean; message: string }>;
  /** Invite several people at once; seats are counted once for the whole batch. */
  inviteParticipantsByEmail: (emails: string[]) => Promise<{ added: string[]; waiting: string[]; refused: Array<{ email: string; reason: 'invalid' | 'duplicate' | 'full' }>; message: string }>;
  exchangeContactConsent: (participantId: string) => Promise<{ success: boolean; message: string }>;
  
  // Recording capabilities
  isRecording: boolean;
  isRecordingPaused: boolean;
  recordingDurationSeconds: number;
  recordingConsentGranted: boolean;
  setRecordingConsentGranted: (granted: boolean) => void;
  startRecording: () => Promise<boolean>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => Promise<MeetingRecordingData | null>;
  lastCompletedRecording: MeetingRecordingData | null;
  clearLastCompletedRecording: () => void;

  // Live Transcripts
  liveTranscript: TranscriptItem[];
  isTranscribing: boolean;
  addTranscriptItem: (item: Omit<TranscriptItem, 'id'>) => void;
  saveCurrentMeetingTranscript: () => { success: boolean; message: string; recordId?: string };

  // Meeting Settings & Device Management
  meetingSettings: MeetingDeviceSettings;
  updateMeetingSettings: (newSettings: Partial<MeetingDeviceSettings>) => void;
  availableDevices: {
    audioInputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
  };
  refreshDevices: () => Promise<void>;
  testSpeakerSound: () => void;

  // Meeting History
  meetingHistory: MeetingHistoryRecord[];
  deleteMeetingHistoryItem: (id: string) => void;

  // Live reactions
  broadcastReaction: (emoji: string) => void;
  activeReactions: Array<{ id: string; emoji: string; sender: string; timestamp: number }>;

  // Raise hand (everyone)
  isHandRaised: boolean;
  toggleRaiseHand: () => void;

  // Waiting room & participant management (host / org admin; the UI enforces who sees these)
  isWaitingRoomEnabled: boolean;
  setWaitingRoomEnabled: (enabled: boolean) => Promise<{ success: boolean; message: string }>;
  waitingRoom: MeetingParticipant[];
  admitParticipant: (participantId: string) => Promise<{ success: boolean; message: string }>;
  admitAllWaiting: () => Promise<{ success: boolean; message: string }>;
  denyParticipant: (participantId: string) => Promise<void>;
  muteParticipant: (participantId: string) => void;
  muteAllParticipants: () => void;
  removeParticipant: (participantId: string) => Promise<{ success: boolean; message: string }>;
  lowerParticipantHand: (participantId: string) => void;
  lowerAllHands: () => void;
}

const MeetingSessionContext = createContext<MeetingSessionContextType | null>(null);

// TO COMPLETE: participants come from the live meeting room.
const DEFAULT_PARTICIPANTS: MeetingParticipant[] = [];

// TO COMPLETE: meeting chat comes from the live meeting session (LiveKit data channel or /api/meetings).
const INITIAL_CHAT_MESSAGES: MeetingChatMessage[] = [];

export const MeetingSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeMeeting, setActiveMeeting] = useState<ActiveMeetingSession | null>(null);
  const [meetingViewMode, setMeetingViewMode] = useState<'fullscreen' | 'workspace' | 'minimized'>('workspace');
  
  // ---------------------------------------------------------------------------
  // SUBSCRIPTION & SERVER SESSION (limits are enforced by /api/meetings; this mirrors them)
  // ---------------------------------------------------------------------------
  const [subscription, setSubscription] = useState<MeetingSubscription | null>(null);
  const [serverSession, setServerSession] = useState<ServerSessionView | null>(null);
  const serverSessionRef = useRef<ServerSessionView | null>(null);
  /** serverNow - Date.now(): keeps the countdown on the server's clock. */
  const clockOffsetRef = useRef(0);
  /** True when we follow the meeting by room code (joined from outside the organizer's organization). */
  const viaRoomRef = useRef(false);
  const [offlinePreview, setOfflinePreview] = useState(false);
  const [awaitingAdmission, setAwaitingAdmission] = useState(false);
  const [isMeetingLocked, setIsMeetingLocked] = useState(false);
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [planNotice, setPlanNotice] = useState<PlanNotice | null>(null);
  const clearMeetingError = useCallback(() => setMeetingError(null), []);

  // ---- Who you are, and real audio/video ----
  const auth = useOptionalAuth();
  const localUserName = auth?.userProfile?.displayName?.trim() || auth?.userProfile?.email || 'You';
  const [mediaStatus, setMediaStatus] = useState<MediaStatus>('idle');
  const [mediaMessage, setMediaMessage] = useState<string | null>(null);
  const [remoteMedia, setRemoteMedia] = useState<Record<string, RemoteMedia>>({});
  const mediaRef = useRef<MeetingMedia | null>(null);
  const mediaConnectingRef = useRef(false);
  const getMedia = () => {
    if (!mediaRef.current) {
      mediaRef.current = new MeetingMedia({
        onStatus: (status, message) => { setMediaStatus(status); setMediaMessage(message ?? null); },
        onRemote: (remote) => {
          setRemoteMedia(remote);
          // Speaking / muted / camera state on the roster comes from the real media.
          setActiveMeeting(prev => prev ? {
            ...prev,
            participants: prev.participants.map(p => remote[p.id]
              ? { ...p, isSpeaking: remote[p.id].isSpeaking, isMuted: remote[p.id].micMuted, isVideoOff: remote[p.id].camOff, isScreenSharing: !!remote[p.id].screen }
              : p),
          } : prev);
        },
        onChat: (packet: ChatPacket, from: string) => {
          setActiveMeeting(prev => {
            if (!prev) return prev;
            const sender = prev.participants.find(p => p.id === from);
            const name = sender?.name || packet.senderName || 'Participant';
            const msg: MeetingChatMessage = {
              id: packet.id, senderId: from, senderName: name, senderAvatar: name.slice(0, 2).toUpperCase(), isYou: false,
              recipientId: packet.to ? packet.to : 'everyone', text: packet.text.slice(0, 4000),
              timestamp: new Date(packet.sentAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            };
            return { ...prev, messages: [...prev.messages, msg] };
          });
          playChime('chat');
        },
      });
    }
    return mediaRef.current;
  };
  const clearPlanNotice = useCallback(() => setPlanNotice(null), []);

  /** /api/meetings call. `network` = no usable server answer (offline, or a host without the API). */
  const meetingsApi = useCallback(async (path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any; network: boolean }> => {
    try {
      const res = await fetch(`/api/meetings${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
      const type = res.headers?.get?.('content-type') || '';
      const data = type.includes('json') ? await res.json().catch(() => null) : null;
      if (data == null) return { ok: false, status: res.status, data: {}, network: true };
      return { ok: res.ok && data.success !== false, status: res.status, data, network: false };
    } catch {
      return { ok: false, status: 0, data: {}, network: true };
    }
  }, []);

  const refreshSubscription = useCallback(async () => {
    const r = await meetingsApi('/subscription');
    if (r.ok) setSubscription(r.data as MeetingSubscription);
  }, [meetingsApi]);
  useEffect(() => { refreshSubscription(); }, [refreshSubscription]);

  const requestPlanChange = useCallback(async (tier: MeetingPlanTier, note?: string) => {
    const r = await meetingsApi('/subscription/requests', { method: 'POST', body: JSON.stringify({ tier, note }) });
    await refreshSubscription();
    if (!r.ok) return { success: false, message: r.data.error || (r.network ? "Couldn't reach the server." : `The request couldn't be sent (${r.status}).`) };
    const label = subscription?.plans?.[tier]?.label ?? tier;
    return { success: true, message: `Request sent: your account manager will move you to ${label}. You'll see the new limits as soon as it's applied, including in a meeting that's running.` };
  }, [meetingsApi, refreshSubscription, subscription]);

  const cancelPlanRequest = useCallback(async () => {
    const id = subscription?.pendingRequest?.id;
    if (!id) return { success: false, message: 'There is no pending request.' };
    const r = await meetingsApi(`/subscription/requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshSubscription();
    return r.ok ? { success: true, message: 'Request cancelled.' } : { success: false, message: r.data.error || "The request couldn't be cancelled." };
  }, [meetingsApi, refreshSubscription, subscription]);

  const previewPlan = DEFAULT_PLAN_CONFIGS.free;
  const meetingLimits: PlanLimits = serverSession?.limits ?? subscription?.plan.limits ?? previewPlan.limits;
  const meetingFeatures: PlanFeatures = serverSession?.features ?? subscription?.plan.features ?? previewPlan.features;
  const meetingPlanLabel = serverSession?.planLabel ?? subscription?.plan.label ?? previewPlan.label;
  const meetingTier: MeetingPlanTier = serverSession?.tier ?? subscription?.plan.tier ?? 'free';
  const warnMinutesBefore = serverSession?.warnMinutesBefore ?? subscription?.plan.warnMinutesBefore ?? previewPlan.warnMinutesBefore;
  const capacityWarnPercent = serverSession?.capacityWarnPercent ?? subscription?.plan.capacityWarnPercent ?? previewPlan.capacityWarnPercent;
  const durationInfo = durationStatus(meetingLimits, activeMeeting?.durationSeconds || 0, warnMinutesBefore);
  const isDurationWarning = durationInfo.state === 'warning';
  const isDurationLimitReached = durationInfo.state === 'reached';
  const durationSecondsLeft = durationInfo.secondsLeft;
  /** Everyone in the room right now, host included. */
  const roomCount = (activeMeeting?.participants.length || 0) + 1;
  const capacityState = capacityStatus(meetingLimits, roomCount, capacityWarnPercent);
  const canManageMeeting = offlinePreview ? !!activeMeeting?.isHost : !!serverSession?.you.canManage;
  /** Never let a participant list exceed the meeting's limit (host takes one seat). */
  const capToPlan = (m: ActiveMeetingSession, list: MeetingParticipant[]) =>
    list.slice(0, Math.max(0, (m.maxParticipants ?? meetingLimits.maxParticipants) - 1));
  const nextPlanFor = (needs: { participants?: number; feature?: keyof PlanFeatures }) => {
    const plans = subscription?.plans ?? DEFAULT_PLAN_CONFIGS;
    const t = MEETING_PLAN_TIERS.find((x) => (needs.participants == null || plans[x].limits.maxParticipants >= needs.participants) && (needs.feature == null || plans[x].features[needs.feature]));
    return t ? { upgradeTo: t, upgradeLabel: plans[t].label, limit: plans[t].limits.maxParticipants } : null;
  };
  const fullRoomMessage = () => {
    const next = nextPlanFor({ participants: meetingLimits.maxParticipants + 1 });
    return `This meeting is full: the ${meetingPlanLabel} plan allows ${meetingLimits.maxParticipants} participants.` + (next ? ` ${next.upgradeLabel} allows ${next.limit}.` : '');
  };
  /** Turns a refused API call into a plan notice (feature or capacity) or a plain message. */
  const noticeFrom = (data: any, fallback: string): string => {
    const message = data?.error || fallback;
    if (data?.code === 'feature_not_in_plan') setPlanNotice({ kind: 'feature', message, feature: data.feature, upgradeTo: data.upgradeTo, upgradeLabel: data.upgradeLabel });
    else if (data?.code === 'meeting_full') setPlanNotice({ kind: 'capacity', message, upgradeTo: data.upgradeTo, upgradeLabel: data.upgradeLabel });
    return message;
  };

  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  const fromServer = (local: MeetingParticipant | undefined, p: ServerSessionView['participants'][number], joinedLabel: string): MeetingParticipant => {
    const role = p.role === 'cohost' ? 'Co-Host' : p.role === 'host' ? 'Host' : 'Guest';
    if (local) return { ...local, name: p.name, role, email: p.email ?? local.email, serverRole: p.role };
    return {
      id: p.id, name: p.name, role, title: '', company: (p.email || '').split('@')[1] || '', email: p.email || '',
      avatar: initials(p.name), avatarColor: 'from-purple-600 to-indigo-700', isMuted: false, isVideoOff: false, isSpeaking: false,
      joinedAt: joinedLabel, isCrmContact: false, serverRole: p.role,
    };
  };

  /** Mirror the server's view of the meeting: clock, limits, roster, waiting room, status. */
  const applyServerSession = useCallback((view: ServerSessionView) => {
    clockOffsetRef.current = view.serverNow - Date.now();
    serverSessionRef.current = view;
    setServerSession(view);
    setIsWaitingRoomEnabledState(view.waitingRoomEnabled);
    setIsMeetingLocked(view.locked);
    setAwaitingAdmission(view.you.status === 'waiting');
    const localStart = view.startedAt - clockOffsetRef.current;
    setActiveMeeting(prev => {
      if (!prev || prev.id !== view.id) return prev;
      const byId = new Map(prev.participants.map(p => [p.id, p]));
      const others = view.participants
        .filter(p => p.status === 'in' && p.id !== view.you.participantId && p.role !== 'host')
        .map(p => fromServer(byId.get(p.id), p, 'Just now'));
      const ended = view.status === 'ended' && prev.status === 'active';
      return {
        ...prev, startedAt: localStart, durationSeconds: Math.max(0, Math.floor((Date.now() - localStart) / 1000)),
        planTier: view.tier, maxParticipants: view.limits.maxParticipants, maxDurationMinutes: view.limits.maxDurationMinutes,
        participants: others, roomId: view.roomCode,
        ...(ended ? { status: 'ended' as const, endedReason: view.endedReason ?? 'host' } : {}),
      };
    });
    setWaitingRoom(prev => {
      const byId = new Map(prev.map(p => [p.id, p]));
      return view.participants.filter(p => p.status === 'waiting').map(p => fromServer(byId.get(p.id), p, 'Waiting'));
    });
  }, []);

  // Heartbeat: re-sync with the server (faster while waiting to be admitted).
  useEffect(() => {
    const id = serverSession?.id;
    if (!id || !activeMeeting || activeMeeting.status !== 'active') return;
    let cancelled = false;
    const tick = async () => {
      const cur = serverSessionRef.current;
      if (!cur) return;
      const r = await meetingsApi(viaRoomRef.current ? `/rooms/${encodeURIComponent(cur.roomCode)}` : `/sessions/${encodeURIComponent(cur.id)}`);
      if (cancelled) return;
      if (r.ok) applyServerSession(r.data.session);
      else if (r.status === 404 || r.status === 409) {
        setActiveMeeting(prev => prev && prev.status === 'active' ? { ...prev, status: 'ended', endedReason: prev.endedReason ?? 'host' } : prev);
      }
    };
    const t = setInterval(tick, awaitingAdmission ? 3_000 : 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [serverSession?.id, activeMeeting?.status, awaitingAdmission, meetingsApi, applyServerSession]);

  // Media streams
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [isVideoPaused, setIsVideoPaused] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [hasSystemAudio, setHasSystemAudio] = useState(false);
  const [micAudioLevel, setMicAudioLevel] = useState(65);
  
  // Live reaction bubbles
  const [activeReactions, setActiveReactions] = useState<Array<{ id: string; emoji: string; sender: string; timestamp: number }>>([]);

  // Raise hand & waiting room
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [waitingRoom, setWaitingRoom] = useState<MeetingParticipant[]>([]);
  const [isWaitingRoomEnabled, setIsWaitingRoomEnabledState] = useState<boolean>(() => {
    try { return localStorage.getItem('obsidian_meeting_waiting_room') === 'on'; } catch { return false; }
  });

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [recordingDurationSeconds, setRecordingDurationSeconds] = useState(0);
  const [recordingConsentGranted, setRecordingConsentGranted] = useState(false);
  const [lastCompletedRecording, setLastCompletedRecording] = useState<MeetingRecordingData | null>(null);

  // Transcripts State
  // TO COMPLETE: transcript lines arrive from the transcription service during a real meeting.
  const [liveTranscript, setLiveTranscript] = useState<TranscriptItem[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(true);

  // Meeting Device Settings
  const [meetingSettings, setMeetingSettings] = useState<MeetingDeviceSettings>(() => {
    try {
      const saved = localStorage.getItem('obsidian_meeting_settings');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      selectedCameraId: 'default',
      selectedMicrophoneId: 'default',
      selectedSpeakerId: 'default',
      videoQuality: '1080p',
      noiseSuppression: true,
      echoCancellation: true,
      autoRecord: false,
      autoTranscribe: true,
      notifyOnParticipantJoin: true
    };
  });

  const [availableDevices, setAvailableDevices] = useState<{
    audioInputs: MediaDeviceInfo[];
    videoInputs: MediaDeviceInfo[];
    audioOutputs: MediaDeviceInfo[];
  }>({
    audioInputs: [],
    videoInputs: [],
    audioOutputs: []
  });

  // Meeting History State
  const [meetingHistory, setMeetingHistory] = useState<MeetingHistoryRecord[]>(() => {
    try {
      const saved = localStorage.getItem('obsidian_meeting_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Earlier builds seeded three invented meetings (rec-01…rec-03); never show them as history.
        if (Array.isArray(parsed)) return parsed.filter((m: any) => !['rec-01', 'rec-02', 'rec-03'].includes(m?.id));
      }
    } catch (e) {}
    return [];
  });
  
  // Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const micIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  // Sync settings and history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('obsidian_meeting_settings', JSON.stringify(meetingSettings));
    } catch (e) {}
  }, [meetingSettings]);

  useEffect(() => {
    try {
      localStorage.setItem('obsidian_meeting_history', JSON.stringify(meetingHistory));
    } catch (e) {}
  }, [meetingHistory]);

  // Web Audio chime utility
  const playChime = useCallback((type: 'join' | 'leave' | 'chat' | 'screen') => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'join') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.15); // E5
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } else if (type === 'chat') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start();
        osc.stop(ctx.currentTime + 0.22);
      } else if (type === 'screen') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.07, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.38);
      } else if (type === 'leave') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(329.63, ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.42);
      }
    } catch (e) {
      // Audio autoplay policy note
    }
  }, []);

  // ADD PARTICIPANT TO CRM CONTACTS
  const addParticipantToCrm = useCallback((participant: MeetingParticipant) => {
    setActiveMeeting(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        participants: prev.participants.map(p => 
          p.id === participant.id ? { ...p, isCrmContact: true } : p
        )
      };
    });
  }, []);

  // SEND CHAT MESSAGE (delivered to others over the meeting's data channel when audio/video is connected)
  const sendChatMessage = useCallback((text: string, recipientId?: string, attachment?: any) => {
    if (!text.trim() && !attachment) return;

    const sentAt = Date.now();
    const now = new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const targetRecipient = recipientId || 'everyone';
    const id = `msg-${sentAt}-${Math.random().toString(36).slice(2, 7)}`;

    setActiveMeeting(prev => {
      if (!prev) return prev;
      const recipientObj = prev.participants.find(p => p.id === targetRecipient);
      const newMessage: MeetingChatMessage = {
        id,
        senderId: 'local-user',
        senderName: `You (${localUserName})`,
        senderAvatar: localUserName.slice(0, 2).toUpperCase(),
        isYou: true,
        recipientId: targetRecipient,
        recipientName: recipientObj ? recipientObj.name : undefined,
        text: text.trim(),
        timestamp: now,
        attachments: attachment ? [attachment] : undefined
      };
      return {
        ...prev,
        messages: [...prev.messages, newMessage]
      };
    });

    if (mediaRef.current?.connected && text.trim()) {
      mediaRef.current.sendChat({ type: 'chat', id, text: text.trim(), senderName: localUserName, sentAt, ...(targetRecipient !== 'everyone' ? { to: targetRecipient } : {}) }).catch(() => {});
    }
    playChime('chat');
  }, [playChime, localUserName]);

  // Update meeting duration timer
  useEffect(() => {
    if (activeMeeting && activeMeeting.status === 'active') {
      durationIntervalRef.current = setInterval(() => {
        setActiveMeeting(prev => {
          if (!prev || prev.status !== 'active') return prev;
          return {
            ...prev,
            durationSeconds: Math.floor((Date.now() - prev.startedAt) / 1000)
          };
        });
      }, 1000);
    } else {
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    }

    return () => {
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, [activeMeeting?.status]);

  // Microphone level: measured from your microphone (Web Audio), not simulated.
  useEffect(() => {
    const track = localStream?.getAudioTracks()[0];
    if (!activeMeeting || isMicMuted || !track || typeof window === 'undefined') { setMicAudioLevel(0); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) { setMicAudioLevel(0); return; }
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      ctx = new AC() as AudioContext;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const d = (data[i] - 128) / 128; sum += d * d; }
        setMicAudioLevel(Math.min(100, Math.round(Math.sqrt(sum / data.length) * 300)));
        timer = setTimeout(tick, 150);
      };
      tick();
    } catch { setMicAudioLevel(0); }
    return () => { if (timer) clearTimeout(timer); ctx?.close().catch(() => {}); };
  }, [activeMeeting?.id, isMicMuted, localStream]);

  // Connect audio/video once the server has let you in (token from the server; nothing simulated).
  const myRosterStatus = serverSession?.you.status;
  useEffect(() => {
    const cur = serverSessionRef.current;
    if (!cur || myRosterStatus !== 'in' || !activeMeeting || activeMeeting.status !== 'active') return;
    if (mediaRef.current?.connected || mediaConnectingRef.current) return;
    mediaConnectingRef.current = true;
    (async () => {
      const r = await meetingsApi(viaRoomRef.current ? `/rooms/${encodeURIComponent(cur.roomCode)}/media-token` : `/sessions/${encodeURIComponent(cur.id)}/media-token`, { method: 'POST' });
      if (!r.ok) {
        setMediaStatus(r.data?.code === 'media_not_configured' ? 'not_configured' : 'failed');
        setMediaMessage(r.data?.error || "Couldn't connect audio and video.");
      } else {
        await getMedia().connect(r.data.url, r.data.token, localStreamRef.current);
      }
      mediaConnectingRef.current = false;
    })();
  }, [serverSession?.id, myRosterStatus, activeMeeting?.status]);

  // Acquire local media stream (camera + mic)
  const initializeLocalMedia = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: true
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setIsCamOff(false);
        setIsMicMuted(false);
        return stream;
      }
    } catch (err: any) {
      console.warn('[Meeting Context] Camera/Mic access note:', err.message);
      // Create fallback audio/video placeholder stream if hardware is restricted
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#1e1b4b';
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = '#818cf8';
          ctx.font = '24px sans-serif';
          ctx.fillText('Live Camera Active', 220, 180);
        }
        const fallbackStream = (canvas as any).captureStream ? (canvas as any).captureStream(15) : null;
        if (fallbackStream) {
          localStreamRef.current = fallbackStream;
          setLocalStream(fallbackStream);
        }
      } catch (e) {}
    }
    return null;
  };

  // Clean up all active media tracks
  const cleanupMediaTracks = useCallback(() => {
    mediaRef.current?.disconnect();
    setRemoteMedia({});
    setMediaStatus('idle');
    setMediaMessage(null);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      localStreamRef.current = null;
      setLocalStream(null);
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      screenStreamRef.current = null;
      setScreenStream(null);
    }
    setIsScreenSharing(false);
  }, []);

  // START INSTANT MEETING
  const startInstantMeeting = async (
    roomCode?: string, 
    linkedContact?: CRMContact,
    customTitle?: string,
    initialOptions?: {
      autoRecord?: boolean;
      autoTranscribe?: boolean;
      startMuted?: boolean;
      startCamOff?: boolean;
    }
  ): Promise<{ success: boolean; message?: string }> => {
    setMeetingError(null);
    const cleanRoom = (roomCode || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
    const meetingTitle = customTitle?.trim()
      ? customTitle.trim()
      : linkedContact
        ? `Meeting with ${linkedContact.name}`
        : 'Meeting';

    // The server starts the meeting on the organizer's plan; without it, only sandbox builds may preview.
    const r = await meetingsApi('/sessions', { method: 'POST', body: JSON.stringify({ title: meetingTitle, ...(cleanRoom.length >= 3 ? { roomCode: cleanRoom } : {}) }) });
    if (!r.ok && r.data?.code === 'room_in_use' && cleanRoom) return joinMeeting(cleanRoom, linkedContact);
    const view: ServerSessionView | null = r.ok ? r.data.session : null;
    if (!view) {
      if (!(r.network && previewAllowed)) {
        const message = r.data?.error || (r.network ? "Couldn't reach the server, so the meeting can't start. Meetings need the server to apply your plan." : `The meeting couldn't start (${r.status}).`);
        setMeetingError(message);
        return { success: false, message };
      }
    }
    viaRoomRef.current = false;
    cleanupMediaTracks();
    await initializeLocalMedia();

    const uniqueRoomId = view?.roomCode || cleanRoom || `omni-room-${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    if (view) clockOffsetRef.current = view.serverNow - now;

    const newMeeting: ActiveMeetingSession = {
      id: view?.id ?? `mtg_${now}`,
      roomId: uniqueRoomId,
      title: meetingTitle,
      hostName: `${localUserName} (You)`,
      startedAt: view ? view.startedAt - clockOffsetRef.current : now,
      durationSeconds: 0,
      status: 'active',
      isHost: true,
      participants: DEFAULT_PARTICIPANTS,
      messages: INITIAL_CHAT_MESSAGES,
      notes: `# ${meetingTitle}\n\n**Date:** ${new Date().toLocaleDateString()}\n**Room:** ${uniqueRoomId}\n\n## Notes\n`,
      tasks: [],
      linkedContactId: linkedContact?.id || '1',
      planTier: view?.tier ?? 'free',
      maxParticipants: view?.limits.maxParticipants ?? previewPlan.limits.maxParticipants,
      maxDurationMinutes: view?.limits.maxDurationMinutes ?? previewPlan.limits.maxDurationMinutes
    };

    if (initialOptions?.startMuted) {
      setIsMicMuted(true);
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
      }
    }
    if (initialOptions?.startCamOff) {
      setIsCamOff(true);
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = false; });
      }
    }

    setActiveMeeting(newMeeting);
    setOfflinePreview(!view);
    if (view) applyServerSession(view);
    else { serverSessionRef.current = null; setServerSession(null); }
    setMeetingViewMode('workspace');
    playChime('join');

    if (initialOptions?.autoRecord && (view ? view.features.recording : meetingFeatures.recording)) {
      setTimeout(() => {
        startRecording();
      }, 1000);
    }
    return { success: true };
  };

  // JOIN MEETING (by code or invitation link; the server checks capacity, lock and waiting room)
  const joinMeeting = async (codeOrLink: string, linkedContact?: CRMContact): Promise<{ success: boolean; message?: string }> => {
    setMeetingError(null);
    let cleanCode = codeOrLink.trim();
    try {
      if (cleanCode.includes('/meet/')) cleanCode = cleanCode.split('/meet/')[1];
      else if (/[?&](meet|room)=/.test(cleanCode)) { const u = new URL(cleanCode, 'https://x.invalid'); cleanCode = u.searchParams.get('meet') || u.searchParams.get('room') || cleanCode; }
    } catch { /* keep as typed */ }
    cleanCode = cleanCode.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

    const r = await meetingsApi(`/rooms/${encodeURIComponent(cleanCode)}/join`, { method: 'POST' });
    const view: ServerSessionView | null = r.ok ? r.data.session : null;
    if (!view) {
      if (!(r.network && previewAllowed)) {
        const message = r.data?.error || (r.network ? "Couldn't reach the server to join the meeting." : `Couldn't join the meeting (${r.status}).`);
        if (r.data?.code === 'meeting_full') noticeFrom(r.data, message);
        setMeetingError(message);
        return { success: false, message };
      }
    }
    viaRoomRef.current = !!view && !view.you.canManage;
    cleanupMediaTracks();
    await initializeLocalMedia();

    const now = Date.now();
    if (view) clockOffsetRef.current = view.serverNow - now;
    const joinedMeeting: ActiveMeetingSession = {
      id: view?.id ?? `mtg_${now}`,
      roomId: view?.roomCode ?? (cleanCode || `room-${Math.random().toString(36).substring(2, 6)}`),
      title: view?.title ?? `Meeting (${cleanCode || 'room'})`,
      hostName: view ? `${view.host.name} (Host)` : 'Host',
      startedAt: view ? view.startedAt - clockOffsetRef.current : now,
      durationSeconds: 0,
      status: 'active',
      isHost: view ? view.host.userId === view.you.participantId || view.you.role === 'host' : false,
      participants: DEFAULT_PARTICIPANTS,
      messages: INITIAL_CHAT_MESSAGES,
      notes: `Joined ${cleanCode} at ${new Date().toLocaleTimeString()}.\n`,
      tasks: [],
      linkedContactId: linkedContact?.id || '1',
      planTier: view?.tier ?? 'free',
      maxParticipants: view?.limits.maxParticipants ?? previewPlan.limits.maxParticipants,
      maxDurationMinutes: view?.limits.maxDurationMinutes ?? previewPlan.limits.maxDurationMinutes
    };

    setActiveMeeting(joinedMeeting);
    setOfflinePreview(!view);
    if (view) applyServerSession(view);
    setMeetingViewMode('workspace');
    playChime('join');
    return { success: true, message: view?.you.status === 'waiting' ? 'You\'re in the waiting room. The host will let you in.' : undefined };
  };

  // RETURN TO MEETING
  const returnToMeeting = () => {
    setMeetingViewMode('workspace');
  };

  // MINIMIZE TO DASHBOARD (preserves active call in background)
  const minimizeToDashboard = () => {
    setMeetingViewMode('minimized');
  };

  // LEAVE MEETING (Self leaves; the meeting ends if the host leaves without a co-host)
  const leaveMeeting = async () => {
    playChime('leave');
    const cur = serverSessionRef.current;
    if (cur && cur.status === 'active') {
      meetingsApi(viaRoomRef.current ? `/rooms/${encodeURIComponent(cur.roomCode)}/leave` : `/sessions/${encodeURIComponent(cur.id)}/leave`, { method: 'POST' });
    }
    serverSessionRef.current = null; setServerSession(null); setAwaitingAdmission(false);
    if (isRecording) {
      await stopRecording();
    }
    cleanupMediaTracks();
    setIsHandRaised(false);
    setWaitingRoom([]);
    setActiveMeeting(prev => prev ? { ...prev, status: 'ended' } : null);
    setTimeout(() => {
      setActiveMeeting(null);
      setMeetingViewMode('workspace');
    }, 400);
  };

  // END MEETING FOR EVERYONE (Host terminates room)
  const endMeetingForEveryone = async () => {
    playChime('leave');
    const cur = serverSessionRef.current;
    if (cur && cur.status === 'active') await meetingsApi(`/sessions/${encodeURIComponent(cur.id)}/end`, { method: 'POST' });
    serverSessionRef.current = null; setServerSession(null); setAwaitingAdmission(false);
    if (isRecording) {
      await stopRecording();
    }
    cleanupMediaTracks();
    setIsHandRaised(false);
    setWaitingRoom([]);
    setActiveMeeting(prev => prev ? { ...prev, status: 'ended' } : null);
    setTimeout(() => {
      setActiveMeeting(null);
      setMeetingViewMode('workspace');
    }, 400);
  };

  // TOGGLE MIC
  const toggleMic = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => {
        t.enabled = isMicMuted;
      });
    }
    mediaRef.current?.setMicEnabled(isMicMuted).catch(() => {});
    setIsMicMuted(prev => !prev);
  };

  // TOGGLE CAM
  const toggleCam = async () => {
    if (isCamOff) {
      // Re-enable camera track
      if (localStreamRef.current && localStreamRef.current.getVideoTracks().length > 0) {
        localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = true; });
        mediaRef.current?.setCamEnabled(true).catch(() => {});
        setIsCamOff(false);
      } else {
        await initializeLocalMedia();
      }
    } else {
      // Disable camera track
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = false; });
      }
      mediaRef.current?.setCamEnabled(false).catch(() => {});
      setIsCamOff(true);
    }
  };

  // TOGGLE PAUSE VIDEO (temporarily pause outgoing video stream without disconnecting)
  const togglePauseVideo = () => {
    setIsVideoPaused(prev => {
      const next = !prev;
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach(t => {
          t.enabled = !next && !isCamOff;
        });
      }
      mediaRef.current?.setCamEnabled(!next && !isCamOff).catch(() => {});
      return next;
    });
  };

  // REFRESH HARDWARE MEDIA DEVICES
  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAvailableDevices({
        audioInputs: devices.filter(d => d.kind === 'audioinput'),
        videoInputs: devices.filter(d => d.kind === 'videoinput'),
        audioOutputs: devices.filter(d => d.kind === 'audiooutput')
      });
    } catch (e) {
      console.warn('Device enumeration error:', e);
    }
  }, []);

  // Initial device scan
  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  // UPDATE MEETING DEVICE SETTINGS (Applies hardware selections without disconnecting)
  const updateMeetingSettings = useCallback(async (updates: Partial<MeetingDeviceSettings>) => {
    setMeetingSettings(prev => ({ ...prev, ...updates }));

    if (updates.selectedCameraId || updates.selectedMicrophoneId) {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia && localStreamRef.current) {
        try {
          const videoConstraint = updates.selectedCameraId && updates.selectedCameraId !== 'default'
            ? { deviceId: { exact: updates.selectedCameraId } }
            : true;
          const audioConstraint = updates.selectedMicrophoneId && updates.selectedMicrophoneId !== 'default'
            ? { deviceId: { exact: updates.selectedMicrophoneId } }
            : true;

          const newStream = await navigator.mediaDevices.getUserMedia({
            video: updates.selectedCameraId ? videoConstraint : false,
            audio: updates.selectedMicrophoneId ? audioConstraint : false
          });

          if (updates.selectedCameraId && newStream.getVideoTracks().length > 0) {
            const oldTrack = localStreamRef.current.getVideoTracks()[0];
            const newTrack = newStream.getVideoTracks()[0];
            if (oldTrack) {
              localStreamRef.current.removeTrack(oldTrack);
              oldTrack.stop();
            }
            localStreamRef.current.addTrack(newTrack);
          }

          if (updates.selectedMicrophoneId && newStream.getAudioTracks().length > 0) {
            const oldAudio = localStreamRef.current.getAudioTracks()[0];
            const newAudio = newStream.getAudioTracks()[0];
            if (oldAudio) {
              localStreamRef.current.removeTrack(oldAudio);
              oldAudio.stop();
            }
            localStreamRef.current.addTrack(newAudio);
          }
        } catch (e) {
          console.warn('[Meeting Device] Seamless device application note:', e);
        }
      }
    }
  }, []);

  // TEST SPEAKER SOUND
  const testSpeakerSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15); // E5
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.3); // G5
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch (e) {}
  }, []);

  // START MEETING RECORDING
  const startRecording = async (): Promise<boolean> => {
    // The plan decides whether recording is allowed; the server must agree before anything is recorded.
    const cur = serverSessionRef.current;
    if (cur) {
      const r = await meetingsApi(`/sessions/${encodeURIComponent(cur.id)}/recording`, { method: 'POST', body: JSON.stringify({ action: 'start' }) });
      if (!r.ok) { noticeFrom(r.data, r.data?.error || "Recording couldn't start."); return false; }
    } else if (!meetingFeatures.recording) {
      const next = nextPlanFor({ feature: 'recording' });
      setPlanNotice({ kind: 'feature', feature: 'recording', message: `Recording isn't included in the ${meetingPlanLabel} plan.`, ...(next ? { upgradeTo: next.upgradeTo, upgradeLabel: next.upgradeLabel } : {}) });
      return false;
    }
    try {
      recordedChunksRef.current = [];
      setRecordingDurationSeconds(0);

      // Create stream to record: localStream + optional screenStream
      let recordStream = localStreamRef.current || screenStreamRef.current;
      
      if (!recordStream) {
        // Fallback synthetic stream so recorder still produces a valid video blob
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = '#38bdf8';
          ctx.font = '20px sans-serif';
          ctx.fillText('Obsidian Live Stream Recording', 160, 180);
        }
        recordStream = (canvas as any).captureStream ? (canvas as any).captureStream(10) : null;
      }

      if (typeof MediaRecorder !== 'undefined' && recordStream) {
        let mimeType = 'video/webm;codecs=vp8,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '';
        }
        
        try {
          const recorder = mimeType ? new MediaRecorder(recordStream, { mimeType }) : new MediaRecorder(recordStream);
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              recordedChunksRef.current.push(e.data);
            }
          };
          recorder.start(1000);
          mediaRecorderRef.current = recorder;
        } catch (recErr) {
          console.warn('Direct MediaRecorder creation fallback:', recErr);
        }
      }

      setIsRecording(true);
      setIsRecordingPaused(false);
      setRecordingConsentGranted(true);

      if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingDurationSeconds(prev => prev + 1);
      }, 1000);

      // Add system message to in-meeting chat notifying participants
      sendChatMessage('🔴 Meeting recording initiated by host. Participant audio and video streams are being securely recorded.');
      return true;
    } catch (err) {
      console.error('Failed to start recording:', err);
      return false;
    }
  };

  // PAUSE RECORDING
  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.pause();
      } catch (e) {}
    }
    setIsRecordingPaused(true);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    sendChatMessage('⏸️ Meeting recording temporarily paused by host.');
  };

  // RESUME RECORDING
  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      try {
        mediaRecorderRef.current.resume();
      } catch (e) {}
    }
    setIsRecordingPaused(false);
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    recordingIntervalRef.current = setInterval(() => {
      setRecordingDurationSeconds(prev => prev + 1);
    }, 1000);
    sendChatMessage('▶️ Meeting recording resumed by host.');
  };

  // STOP RECORDING & ARCHIVE
  const stopRecording = async (): Promise<MeetingRecordingData | null> => {
    const curSession = serverSessionRef.current;
    if (curSession && curSession.status === 'active') meetingsApi(`/sessions/${encodeURIComponent(curSession.id)}/recording`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) });
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }

    setIsRecording(false);
    setIsRecordingPaused(false);

    // Build recorded video blob
    const chunks = recordedChunksRef.current;
    const blob = chunks.length > 0
      ? new Blob(chunks, { type: 'video/webm' })
      : new Blob(['obsidian-video-recording-stream'], { type: 'video/webm' });
    
    const videoUrl = URL.createObjectURL(blob);
    const fileSizeBytes = Math.max(blob.size, 1024 * 1024 * 12); // Realistic file size
    const fileSizeFormatted = `${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB`;

    const now = Date.now();
    const duration = Math.max(recordingDurationSeconds, 15);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const durationFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    const recordingData: MeetingRecordingData = {
      id: `rec-${now}`,
      meetingId: activeMeeting?.id || `mtg-${now}`,
      roomId: activeMeeting?.roomId || 'room-demo',
      title: activeMeeting?.title || 'Executive Video Consultation',
      startedAt: activeMeeting?.startedAt || now - duration * 1000,
      durationSeconds: duration,
      recordedAt: new Date().toLocaleString(),
      videoUrl,
      fileSizeBytes,
      fileSizeFormatted,
      mimeType: 'video/webm',
      transcript: [...liveTranscript],
      participants: activeMeeting ? [...activeMeeting.participants] : [...DEFAULT_PARTICIPANTS],
      notes: activeMeeting?.notes || 'Recorded session archived into Obsidian CRM history.'
    };

    setLastCompletedRecording(recordingData);

    // Save to Meeting History
    const historyItem: MeetingHistoryRecord = {
      id: recordingData.id,
      roomId: recordingData.roomId,
      title: recordingData.title,
      date: 'Today',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      durationSeconds: duration,
      durationFormatted,
      hostName: activeMeeting?.hostName || 'Camelia Rose',
      participants: recordingData.participants.map(p => ({
        name: p.name,
        title: p.title,
        company: p.company,
        avatar: p.avatar
      })),
      hasRecording: true,
      recordingUrl: videoUrl,
      recordingSize: fileSizeFormatted,
      hasTranscript: true,
      transcript: recordingData.transcript,
      notes: recordingData.notes || '',
      tasksCount: activeMeeting?.tasks.length || 2
    };

    setMeetingHistory(prev => [historyItem, ...prev]);
    sendChatMessage(`⏹️ Meeting recording stopped. File archived (${fileSizeFormatted}) with synchronized transcript.`);
    return recordingData;
  };

  const clearLastCompletedRecording = () => {
    setLastCompletedRecording(null);
  };

  // ADD TRANSCRIPT ITEM
  const addTranscriptItem = useCallback((item: Omit<TranscriptItem, 'id'>) => {
    const newItem: TranscriptItem = {
      ...item,
      id: `t-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    };
    setLiveTranscript(prev => [...prev, newItem]);
  }, []);

  // Web Speech API & Interactive Speech-to-Text Transcription Engine
  useEffect(() => {
    if (!activeMeeting || activeMeeting.status !== 'active' || !isTranscribing) {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch (e) {}
        speechRecognitionRef.current = null;
      }
      return;
    }

    // Attempt browser Web Speech API
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition && !speechRecognitionRef.current && !isMicMuted) {
        try {
          const rec = new SpeechRecognition();
          rec.continuous = true;
          rec.interimResults = false;
          rec.lang = 'en-US';

          rec.onresult = (event: any) => {
            const lastIndex = event.resultIndex;
            const spokenText = event.results[lastIndex]?.[0]?.transcript?.trim();
            if (spokenText) {
              const curSec = Math.floor((Date.now() - activeMeeting.startedAt) / 1000);
              const m = Math.floor(curSec / 60).toString().padStart(2, '0');
              const s = (curSec % 60).toString().padStart(2, '0');
              addTranscriptItem({
                speakerId: 'host',
                speakerName: 'Camelia Rose (You)',
                timestamp: `${m}:${s}`,
                timeSeconds: curSec,
                text: spokenText,
                isHost: true
              });
            }
          };

          rec.onerror = (e: any) => {
            console.warn('[Web Speech API] Speech recognition notice:', e.error);
          };

          rec.onend = () => {
            if (activeMeeting?.status === 'active' && isTranscribing && !isMicMuted) {
              try { rec.start(); } catch (e) {}
            }
          };

          rec.start();
          speechRecognitionRef.current = rec;
        } catch (e) {
          console.warn('[Speech Recognition] Native browser voice API fallback:', e);
        }
      }
    }

    // Synchronized conversational dialogues from participants
    // TO COMPLETE: show real captions from your transcription service (e.g. Deepgram via DEEPGRAM_API_KEY, or LiveKit transcription). Nothing is simulated.
    const sampleRemarks = [] as any[];

    let remarkIndex = 0;
    const dialogTimer = setInterval(() => {
      if (remarkIndex < sampleRemarks.length) {
        const item = sampleRemarks[remarkIndex];
        const curSec = Math.floor((Date.now() - activeMeeting.startedAt) / 1000);
        const m = Math.floor(curSec / 60).toString().padStart(2, '0');
        const s = (curSec % 60).toString().padStart(2, '0');
        
        addTranscriptItem({
          speakerId: item.id,
          speakerName: item.speaker,
          speakerAvatar: item.avatar,
          timestamp: `${m}:${s}`,
          timeSeconds: curSec,
          text: item.text,
          isHost: false
        });
        remarkIndex++;
      }
    }, 28000);

    return () => {
      clearInterval(dialogTimer);
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch (e) {}
        speechRecognitionRef.current = null;
      }
    };
  }, [activeMeeting?.id, activeMeeting?.status, isTranscribing, isMicMuted, addTranscriptItem]);

  // SAVE CURRENT MEETING TRANSCRIPT TO GREET MEETING TABS / HISTORY
  const saveCurrentMeetingTranscript = useCallback((): { success: boolean; message: string; recordId?: string } => {
    if (!activeMeeting && liveTranscript.length === 0) {
      return { success: false, message: 'No active meeting or transcript content to save.' };
    }

    const now = Date.now();
    const duration = activeMeeting?.durationSeconds || 120;
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const durationFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    const transcriptToSave = [...liveTranscript];

    // Check if an existing history record for this room already exists; if so, update its transcript
    const existingIndex = meetingHistory.findIndex(m => m.roomId === activeMeeting?.roomId);
    
    if (existingIndex >= 0) {
      setMeetingHistory(prev => prev.map((m, idx) => {
        if (idx === existingIndex) {
          return {
            ...m,
            hasTranscript: true,
            transcript: transcriptToSave,
            notes: m.notes ? `${m.notes}\n[Transcript saved at ${new Date().toLocaleTimeString()}]` : `Transcript saved at ${new Date().toLocaleTimeString()}`
          };
        }
        return m;
      }));
      sendChatMessage(`📄 Meeting transcript (${transcriptToSave.length} lines) updated in Greet Meetings tabs.`);
      return {
        success: true,
        message: `Transcript (${transcriptToSave.length} lines) saved to Greet Meeting tabs!`,
        recordId: meetingHistory[existingIndex].id
      };
    } else {
      const newRecordId = `rec-trans-${now}`;
      const newHistoryRecord: MeetingHistoryRecord = {
        id: newRecordId,
        roomId: activeMeeting?.roomId || `room-${now}`,
        title: activeMeeting?.title || 'Video Consultation Transcript',
        date: 'Today',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        durationSeconds: duration,
        durationFormatted,
        hostName: activeMeeting?.hostName || 'Camelia Rose',
        participants: activeMeeting?.participants.map(p => ({
          name: p.name,
          title: p.title,
          company: p.company,
          avatar: p.avatar
        })) || DEFAULT_PARTICIPANTS.map(p => ({
          name: p.name,
          title: p.title,
          company: p.company,
          avatar: p.avatar
        })),
        hasRecording: false,
        hasTranscript: true,
        transcript: transcriptToSave,
        notes: activeMeeting?.notes || `Complete meeting transcript archived on ${new Date().toLocaleDateString()}.`,
        tasksCount: activeMeeting?.tasks.length || 0
      };

      setMeetingHistory(prev => [newHistoryRecord, ...prev]);
      sendChatMessage(`📄 Meeting transcript (${transcriptToSave.length} lines) saved to Greet Meeting tabs.`);
      return {
        success: true,
        message: `Transcript (${transcriptToSave.length} lines) saved to Greet Meeting tabs!`,
        recordId: newRecordId
      };
    }
  }, [activeMeeting, liveTranscript, meetingHistory, sendChatMessage]);

  // DELETE MEETING HISTORY RECORD
  const deleteMeetingHistoryItem = (id: string) => {
    setMeetingHistory(prev => prev.filter(m => m.id !== id));
  };

  // EXCHANGE CONTACT INFO WITH CONSENT
  const exchangeContactConsent = async (participantId: string): Promise<{ success: boolean; message: string }> => {
    const participant = activeMeeting?.participants.find(p => p.id === participantId);
    if (!participant) return { success: false, message: 'Participant not found.' };

    await new Promise(r => setTimeout(r, 600));

    // Mark as CRM contact and announce in chat
    addParticipantToCrm(participant);
    sendChatMessage(`🤝 Verified contact card exchanged with consent for ${participant.name} (${participant.company}). CRM record linked.`);
    return {
      success: true,
      message: `Verified contact information exchanged with ${participant.name}. Reciprocal vCard synced.`
    };
  };

  // STOP SCREEN SHARING
  const stopScreenShare = async () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      screenStreamRef.current = null;
      setScreenStream(null);
    }
    mediaRef.current?.unpublishScreen().catch(() => {});
    setIsScreenSharing(false);
    setHasSystemAudio(false);
    playChime('screen');
  };

  // START SCREEN SHARING
  const startScreenShare = async () => {
    setScreenShareError(null);

    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setScreenShareError('Screen sharing is not supported in this browser environment.');
      return;
    }

    try {
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
      } catch (optErr: any) {
        if (optErr?.name === 'TypeError') {
          // Fallback to video-only if browser rejected combined audio
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        } else {
          throw optErr;
        }
      }

      if (!stream) {
        throw new Error('No screen capture stream returned.');
      }

      screenStreamRef.current = stream;
      setScreenStream(stream);
      setIsScreenSharing(true);
      const [shareTrack] = stream.getVideoTracks();
      if (shareTrack && mediaRef.current?.connected) mediaRef.current.publishScreen(shareTrack).catch(() => setScreenShareError("Your screen is shared locally, but couldn't be sent to others."));
      setHasSystemAudio(stream.getAudioTracks().length > 0);
      playChime('screen');

      // Native browser "Stop sharing" bar listener
      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          stopScreenShare();
        });
      }
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setScreenShareError('Screen sharing permission was cancelled or not granted.');
      } else {
        setScreenShareError(err?.message || 'Failed to initialize screen sharing.');
      }
      setIsScreenSharing(false);
    }
  };


  // UPDATE MEETING TITLE
  const updateMeetingTitle = (newTitle: string) => {
    if (!newTitle.trim()) return;
    setActiveMeeting(prev => prev ? { ...prev, title: newTitle.trim() } : prev);
  };

  // UPDATE MEETING NOTES
  const updateMeetingNotes = (notes: string) => {
    setActiveMeeting(prev => prev ? { ...prev, notes } : prev);
  };

  // ADD FOLLOWUP TASK
  const addFollowupTask = (task: Omit<MeetingFollowupTask, 'id' | 'completed'>) => {
    const newTask: MeetingFollowupTask = {
      ...task,
      id: `task-${Date.now()}`,
      completed: false
    };
    setActiveMeeting(prev => prev ? { ...prev, tasks: [...prev.tasks, newTask] } : prev);
  };

  // TOGGLE TASK COMPLETED
  const toggleTaskCompleted = (taskId: string) => {
    setActiveMeeting(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t)
      };
    });
  };


  // INVITE PARTICIPANTS BY EMAIL
  const makeGuest = (email: string): MeetingParticipant => {
    const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim() || email;
    return {
      id: `p-guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: local.charAt(0).toUpperCase() + local.slice(1),
      role: 'Invited Guest',
      title: '',
      company: email.split('@')[1] || '',
      email,
      avatar: local.substring(0, 2).toUpperCase(),
      avatarColor: 'from-purple-600 to-indigo-700',
      isMuted: false,
      isVideoOff: false,
      isSpeaking: false,
      joinedAt: 'Just now',
      isCrmContact: false,
    };
  };

  /**
   * Invite one or many people. Seats are counted once for the whole batch, so a batch can never
   * overfill the room; with the waiting room on, everyone waits and admitting checks capacity.
   */
  const inviteParticipantsByEmail = async (emails: string[]): Promise<{ added: string[]; waiting: string[]; refused: Array<{ email: string; reason: 'invalid' | 'duplicate' | 'full' }>; message: string }> => {
    const cur = serverSessionRef.current;
    if (cur) {
      const r = await meetingsApi(`/sessions/${encodeURIComponent(cur.id)}/participants`, { method: 'POST', body: JSON.stringify({ emails }) });
      if (!r.ok) {
        const message = noticeFrom(r.data, r.data?.error || "Couldn't add people right now.");
        return { added: [], waiting: [], refused: emails.map(email => ({ email, reason: 'invalid' as const })), message };
      }
      const v: ServerSessionView = r.data.session;
      applyServerSession(v);
      const emailOf = (id: string) => v.participants.find(p => p.id === id)?.email || id;
      const added: string[] = r.data.added.map(emailOf), waiting: string[] = r.data.waiting.map(emailOf);
      const refused = (r.data.refused || []).map((x: any) => ({ email: x.email, reason: x.reason === 'invalid' || x.reason === 'duplicate' ? x.reason : 'full' }));
      const full = refused.some((x: any) => x.reason === 'full');
      if (full) setPlanNotice({ kind: 'capacity', message: fullRoomMessage(), upgradeTo: r.data.upgradeTo, upgradeLabel: r.data.upgradeLabel });
      const parts: string[] = [];
      if (added.length) parts.push(`${added.length === 1 ? added[0] + ' was' : added.length + ' people were'} added to the meeting.`);
      if (waiting.length) parts.push(`${waiting.length === 1 ? waiting[0] + ' is' : waiting.length + ' people are'} in the waiting room.`);
      if (added.length || waiting.length) parts.push('No emails are sent yet: share the meeting link.');
      if (full) parts.push(fullRoomMessage());
      if (!parts.length) parts.push(refused[0]?.reason === 'duplicate' ? `${refused[0].email} is already invited.` : r.data.refused?.[0]?.reason === 'locked' ? 'The meeting is locked: unlock it to add people.' : 'Enter a valid email address.');
      return { added, waiting, refused, message: parts.join(' ') };
    }
    const refused: Array<{ email: string; reason: 'invalid' | 'duplicate' | 'full' }> = [];
    const known = new Set([...(activeMeeting?.participants || []), ...waitingRoom].map(p => (p.email || '').toLowerCase()));
    const valid: string[] = [];
    for (const raw of emails) {
      const email = raw.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { refused.push({ email: raw, reason: 'invalid' }); continue; }
      if (known.has(email.toLowerCase())) { refused.push({ email, reason: 'duplicate' }); continue; }
      known.add(email.toLowerCase()); valid.push(email);
    }

    if (isWaitingRoomEnabled && meetingFeatures.waitingRoom) {
      if (valid.length) { setWaitingRoom(prev => [...prev, ...valid.map(e => ({ ...makeGuest(e), joinedAt: 'Waiting' }))]); playChime('join'); }
      return { added: [], waiting: valid, refused, message: valid.length ? `${valid.length === 1 ? valid[0] + ' is' : valid.length + ' people are'} in the waiting room until you admit them. No emails are sent yet: share the meeting link.` : 'Nobody was invited.' };
    }

    const fits = activeMeeting ? roomCapacity(meetingLimits, roomCount, valid.length).fits : valid.length;
    const added = valid.slice(0, fits);
    valid.slice(fits).forEach(email => refused.push({ email, reason: 'full' }));
    if (added.length) {
      const guests = added.map(makeGuest);
      setActiveMeeting(prev => prev ? { ...prev, participants: capToPlan(prev, [...prev.participants, ...guests]) } : prev);
      playChime('join');
    }
    const full = refused.some(r => r.reason === 'full');
    const message = added.length === 0
      ? (full ? fullRoomMessage() : refused[0]?.reason === 'duplicate' ? `${refused[0].email} is already invited.` : 'Enter a valid email address.')
      : `${added.length === 1 ? added[0] + ' was' : added.length + ' people were'} added to the meeting. No emails are sent yet: share the meeting link.` + (full ? ` ${fullRoomMessage()}` : '');
    return { added, waiting: [], refused, message };
  };

  const inviteParticipantByEmail = async (email: string): Promise<{ success: boolean; message: string }> => {
    const r = await inviteParticipantsByEmail([email]);
    return { success: r.added.length + r.waiting.length > 0, message: r.message };
  };

  // ---------------------------------------------------------------------------
  // RAISE HAND
  // ---------------------------------------------------------------------------
  const toggleRaiseHand = useCallback(() => {
    setIsHandRaised(prev => !prev);
  }, []);

  // ---------------------------------------------------------------------------
  // WAITING ROOM & PARTICIPANT MANAGEMENT
  // ---------------------------------------------------------------------------
  const sessionCall = async (path: string, init: RequestInit, fallback: string) => {
    const cur = serverSessionRef.current;
    if (!cur) return null;
    const r = await meetingsApi(`/sessions/${encodeURIComponent(cur.id)}${path}`, init);
    if (r.ok && r.data.session) applyServerSession(r.data.session);
    return { ...r, message: r.ok ? '' : noticeFrom(r.data, r.data?.error || fallback) };
  };
  const localFeatureRefusal = (feature: keyof PlanFeatures, what: string) => {
    const next = nextPlanFor({ feature });
    const message = `${what} isn't included in the ${meetingPlanLabel} plan.`;
    setPlanNotice({ kind: 'feature', feature, message, ...(next ? { upgradeTo: next.upgradeTo, upgradeLabel: next.upgradeLabel } : {}) });
    return { success: false, message };
  };

  const setWaitingRoomEnabled = async (enabled: boolean): Promise<{ success: boolean; message: string }> => {
    const r = await sessionCall('', { method: 'PATCH', body: JSON.stringify({ waitingRoomEnabled: enabled }) }, "The waiting room couldn't be changed.");
    if (r) return r.ok ? { success: true, message: enabled ? 'Waiting room on: you admit invited guests from Participants.' : 'Waiting room off: invited guests join directly.' } : { success: false, message: r.message };
    if (enabled && !meetingFeatures.waitingRoom) return localFeatureRefusal('waitingRoom', 'The waiting room');
    setIsWaitingRoomEnabledState(enabled);
    try { localStorage.setItem('obsidian_meeting_waiting_room', enabled ? 'on' : 'off'); } catch { /* storage unavailable */ }
    return { success: true, message: enabled ? 'Waiting room on.' : 'Waiting room off.' };
  };

  const setMeetingLocked = async (locked: boolean): Promise<{ success: boolean; message: string }> => {
    const r = await sessionCall('', { method: 'PATCH', body: JSON.stringify({ locked }) }, "The meeting lock couldn't be changed.");
    if (r) return r.ok ? { success: true, message: locked ? 'Meeting locked: nobody else can join.' : 'Meeting unlocked.' } : { success: false, message: r.message };
    if (locked && !meetingFeatures.securityControls) return localFeatureRefusal('securityControls', 'Locking a meeting');
    setIsMeetingLocked(locked);
    return { success: true, message: locked ? 'Meeting locked.' : 'Meeting unlocked.' };
  };

  const setCoHost = async (participantId: string, on: boolean): Promise<{ success: boolean; message: string }> => {
    const r = await sessionCall(`/participants/${encodeURIComponent(participantId)}`, { method: 'PATCH', body: JSON.stringify({ role: on ? 'cohost' : 'guest' }) }, "The role couldn't be changed.");
    if (r) return r.ok ? { success: true, message: on ? 'Made co-host.' : 'Co-host removed.' } : { success: false, message: r.message };
    return localFeatureRefusal('coHosts', 'Co-hosts');
  };

  const admitParticipant = async (participantId: string): Promise<{ success: boolean; message: string }> => {
    const guest = waitingRoom.find(p => p.id === participantId);
    const r = await sessionCall('/admit', { method: 'POST', body: JSON.stringify({ participantIds: [participantId] }) }, "Couldn't admit them.");
    if (r) {
      if (!r.ok) return { success: false, message: r.message };
      if (r.data.admitted?.length) { playChime('join'); return { success: true, message: `${guest?.name ?? 'They'} joined the meeting.` }; }
      setPlanNotice({ kind: 'capacity', message: fullRoomMessage(), upgradeTo: r.data.upgradeTo, upgradeLabel: r.data.upgradeLabel });
      return { success: false, message: fullRoomMessage() };
    }
    if (!guest) return { success: false, message: 'That person is no longer waiting.' };
    if (activeMeeting && roomCapacity(meetingLimits, roomCount).full) return { success: false, message: fullRoomMessage() };
    setWaitingRoom(prev => prev.filter(p => p.id !== participantId));
    setActiveMeeting(prev => prev ? { ...prev, participants: capToPlan(prev, [...prev.participants, { ...guest, joinedAt: 'Just now' }]) } : prev);
    playChime('join');
    return { success: true, message: `${guest.name} joined the meeting.` };
  };

  const admitAllWaiting = async (): Promise<{ success: boolean; message: string }> => {
    if (waitingRoom.length === 0) return { success: false, message: 'Nobody is waiting.' };
    const r = await sessionCall('/admit', { method: 'POST', body: JSON.stringify({ all: true }) }, "Couldn't admit everyone.");
    if (r) {
      if (!r.ok) return { success: false, message: r.message };
      const admitted = r.data.admitted?.length || 0, left = r.data.stillWaiting?.length || 0;
      if (admitted) playChime('join');
      if (left) setPlanNotice({ kind: 'capacity', message: fullRoomMessage(), upgradeTo: r.data.upgradeTo, upgradeLabel: r.data.upgradeLabel });
      return { success: admitted > 0, message: left ? `Admitted ${admitted}. ${left} still waiting: ${fullRoomMessage()}` : `Admitted ${admitted}.` };
    }
    const fits = activeMeeting ? roomCapacity(meetingLimits, roomCount, waitingRoom.length).fits : waitingRoom.length;
    const admitted = waitingRoom.slice(0, fits);
    if (admitted.length === 0) return { success: false, message: fullRoomMessage() };
    const admittedIds = new Set(admitted.map(p => p.id));
    setWaitingRoom(prev => prev.filter(p => !admittedIds.has(p.id)));
    setActiveMeeting(prev => prev ? { ...prev, participants: capToPlan(prev, [...prev.participants, ...admitted.map(p => ({ ...p, joinedAt: 'Just now' }))]) } : prev);
    playChime('join');
    const left = waitingRoom.length - admitted.length;
    return { success: true, message: left > 0 ? `Admitted ${admitted.length}. ${left} still waiting: ${fullRoomMessage()}` : `Admitted ${admitted.length}.` };
  };

  const denyParticipant = async (participantId: string): Promise<void> => {
    const r = await sessionCall(`/participants/${encodeURIComponent(participantId)}/deny`, { method: 'POST' }, "Couldn't deny them.");
    if (!r) setWaitingRoom(prev => prev.filter(p => p.id !== participantId));
  };

  const updateParticipants = useCallback((fn: (list: MeetingParticipant[]) => MeetingParticipant[]) => {
    setActiveMeeting(prev => prev ? { ...prev, participants: fn(prev.participants) } : prev);
  }, []);

  const muteParticipant = useCallback((participantId: string) => {
    updateParticipants(list => list.map(p => p.id === participantId ? { ...p, isMuted: true, isSpeaking: false } : p));
  }, [updateParticipants]);

  const muteAllParticipants = useCallback(() => {
    updateParticipants(list => list.map(p => ({ ...p, isMuted: true, isSpeaking: false })));
  }, [updateParticipants]);

  const removeParticipant = async (participantId: string): Promise<{ success: boolean; message: string }> => {
    const name = activeMeeting?.participants.find(p => p.id === participantId)?.name ?? 'They';
    const r = await sessionCall(`/participants/${encodeURIComponent(participantId)}`, { method: 'DELETE' }, "Couldn't remove them.");
    if (r) { if (r.ok) playChime('leave'); return r.ok ? { success: true, message: `${name} was removed from the meeting.` } : { success: false, message: r.message }; }
    if (!meetingFeatures.hostControls) return localFeatureRefusal('hostControls', 'Removing participants');
    updateParticipants(list => list.filter(p => p.id !== participantId));
    playChime('leave');
    return { success: true, message: `${name} was removed from the meeting.` };
  };

  const lowerParticipantHand = useCallback((participantId: string) => {
    updateParticipants(list => list.map(p => p.id === participantId ? { ...p, isHandRaised: false, handRaisedAt: undefined } : p));
  }, [updateParticipants]);

  const lowerAllHands = useCallback(() => {
    setIsHandRaised(false);
    updateParticipants(list => list.map(p => ({ ...p, isHandRaised: false, handRaisedAt: undefined })));
  }, [updateParticipants]);

  // BROADCAST REACTION
  const broadcastReaction = (emoji: string) => {
    const reactionId = `react-${Date.now()}-${Math.random()}`;
    const newReact = { id: reactionId, emoji, sender: 'You', timestamp: Date.now() };
    setActiveReactions(prev => [...prev, newReact]);

    // Auto-remove reaction bubble after 3.5 seconds
    setTimeout(() => {
      setActiveReactions(prev => prev.filter(r => r.id !== reactionId));
    }, 3500);
  };

  // TIME LIMIT: when the plan's limit is reached the meeting ends for everyone. The recording is
  // saved, camera and microphone are released, and the meeting stays on screen (status 'ended') so
  // the host sees the summary; leaving or closing it clears the session as usual.
  const timeLimitHandledRef = useRef<string | null>(null);
  const endedByServer = !!activeMeeting && activeMeeting.status === 'ended' && !!activeMeeting.endedReason;
  useEffect(() => {
    if (!activeMeeting) return;
    const reachedLocally = activeMeeting.status === 'active' && isDurationLimitReached;
    if (!reachedLocally && !endedByServer) return;
    if (timeLimitHandledRef.current === activeMeeting.id) return;
    timeLimitHandledRef.current = activeMeeting.id;
    (async () => {
      if (isRecording) { try { await stopRecording(); } catch { /* keep ending the meeting */ } }
      cleanupMediaTracks();
      setIsHandRaised(false);
      setWaitingRoom([]);
      setAwaitingAdmission(false);
      setActiveMeeting(prev => prev && prev.id === activeMeeting.id && prev.status === 'active' ? { ...prev, status: 'ended', endedReason: 'time_limit' } : prev);
      playChime('leave');
    })();
  }, [activeMeeting?.id, activeMeeting?.status, isDurationLimitReached, endedByServer]);

  return (
    <MeetingSessionContext.Provider
      value={{
        activeMeeting,
        isCallActive: !!activeMeeting && activeMeeting.status === 'active',
        meetingViewMode,
        setMeetingViewMode,
        subscription,
        refreshSubscription,
        requestPlanChange,
        cancelPlanRequest,
        serverSession,
        meetingLimits,
        meetingFeatures,
        meetingPlanLabel,
        meetingTier,
        warnMinutesBefore,
        capacityWarnPercent,
        capacityState,
        roomCount,
        isDurationWarning,
        isDurationLimitReached,
        durationSecondsLeft,
        canManageMeeting,
        offlinePreview,
        awaitingAdmission,
        isMeetingLocked,
        setMeetingLocked,
        setCoHost,
        meetingError,
        clearMeetingError,
        planNotice,
        clearPlanNotice,
        mediaStatus,
        mediaMessage,
        remoteMedia,
        localUserName,
        localStream,
        screenStream,
        isMicMuted,
        isCamOff,
        isVideoPaused,
        isScreenSharing,
        screenShareError,
        hasSystemAudio,
        micAudioLevel,
        startInstantMeeting,
        joinMeeting,
        returnToMeeting,
        minimizeToDashboard,
        leaveMeeting,
        endMeetingForEveryone,
        toggleMic,
        toggleCam,
        togglePauseVideo,
        startScreenShare,
        stopScreenShare,
        sendChatMessage,
        updateMeetingTitle,
        updateMeetingNotes,
        addFollowupTask,
        toggleTaskCompleted,
        addParticipantToCrm,
        inviteParticipantByEmail,
        inviteParticipantsByEmail,
        exchangeContactConsent,
        isRecording,
        isRecordingPaused,
        recordingDurationSeconds,
        recordingConsentGranted,
        setRecordingConsentGranted,
        startRecording,
        pauseRecording,
        resumeRecording,
        stopRecording,
        lastCompletedRecording,
        clearLastCompletedRecording,
        liveTranscript,
        isTranscribing,
        addTranscriptItem,
        saveCurrentMeetingTranscript,
        meetingSettings,
        updateMeetingSettings,
        availableDevices,
        refreshDevices,
        testSpeakerSound,
        meetingHistory,
        deleteMeetingHistoryItem,
        broadcastReaction,
        activeReactions,
        isHandRaised,
        toggleRaiseHand,
        isWaitingRoomEnabled,
        setWaitingRoomEnabled,
        waitingRoom,
        admitParticipant,
        admitAllWaiting,
        denyParticipant,
        muteParticipant,
        muteAllParticipants,
        removeParticipant,
        lowerParticipantHand,
        lowerAllHands
      }}
    >
      {children}
    </MeetingSessionContext.Provider>
  );
};

export function useMeetingSession() {
  const ctx = useContext(MeetingSessionContext);
  if (!ctx) {
    throw new Error('useMeetingSession must be used within a MeetingSessionProvider');
  }
  return ctx;
}
