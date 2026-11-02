import React, { useState, useEffect, useRef, useCallback } from "react";
import useDebounce from "../hooks/useDebounce";
import { 
  ChevronLeft, Users, Plus, Phone, PhoneOff, Mic, MicOff, Video, VideoOff, 
  Maximize2, Minimize2, Settings, Send, Volume2, VolumeX, Sparkles, Calendar, Terminal,
  Activity, Check, Info, Shield, Wifi, Play, Pause, ChevronDown, CheckCircle2,
  ListRestart, CircleDot, MessageSquare, MonitorUp, MonitorOff, PictureInPicture,
  Bell, Search, Pin, Copy, Smile, Download, FileText, Save, FileDown, CalendarDays,
  Clock, CheckSquare, Link, Share2, CalendarPlus, Trash2, ExternalLink, ShieldCheck, Lock, X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useCRMCall } from "../hooks/useCRMCall";
import { RealTimeLatencyIndicator } from "./RealTimeLatencyIndicator";
import LiveTranscriptOverlay from "./LiveTranscriptOverlay";
import { dispatchWebRTCCallState } from "../utils/webrtcEvents";
import { 
  initializeWebRTCSession, 
  terminateCallSession, 
  sendChatMessage, 
  onChatMessageReceived,
  onLiveTranscriptReceived,
  toggleLocalAudioMute,
  toggleLocalVideoMute,
  startScreenShare,
  stopScreenShare,
  isScreenSharingSupported,
  getScreenShareErrorMessage,
  onMuteStatusChanged,
  onCameraStatusChanged,
  emitMuteStatusChange,
  emitCameraStatusChange,
  setActivePeerConnection,
  setLocalMediaStream
} from "../utils/app";

import { CalendarEvent } from "../types";
import { copyToClipboard } from "../utils/clipboard";
import { 
  dispatchScreenShareState, 
  onRequestToggleScreenShare 
} from "../utils/webrtcEvents";

interface CRMSoftphoneCanvasProps {
  onScheduleFollowup?: () => void;
  onAddCalendarEvent?: (newEvent: Omit<CalendarEvent, "id">) => void;
  isScreenSharingProp?: boolean;
  onToggleScreenShareProp?: () => void;
}

export default function CRMSoftphoneCanvas({ 
  onScheduleFollowup, 
  onAddCalendarEvent,
  isScreenSharingProp,
  onToggleScreenShareProp
}: CRMSoftphoneCanvasProps) {
  // Call configuration state
  const [isCallConnected, setIsCallConnected] = useState<boolean>(true);
  const [callDuration, setCallDuration] = useState<number>(195); // Starts at 03:15 (195 seconds)
  const [volumeLevel, setVolumeLevel] = useState<number>(65);
  const [isMutedLocal, setIsMutedLocal] = useState<boolean>(false);
  const [isVideoOffLocal, setIsVideoOffLocal] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"messages" | "participants" | "logs" | "my_meetings">("messages");
  const [voiceTab, setVoiceTab] = useState<"assistant" | "transcript" | "topics">("assistant");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isRecordingInviting, setIsRecordingInviting] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(true);
  const [isChatExpanded, setIsChatExpanded] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [isScreenCapturePending, setIsScreenCapturePending] = useState<boolean>(false);
  const canShareScreen = isScreenSharingSupported();
  const [isPipActive, setIsPipActive] = useState<boolean>(false);
  const [isGridView, setIsGridView] = useState<boolean>(false);
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(null);
  const [isOnHold, setIsOnHold] = useState<boolean>(false);
  const [showDisconnectConfirmModal, setShowDisconnectConfirmModal] = useState<boolean>(false);

  // Secure Link Modal state
  const [isLinkModalOpen, setIsLinkModalOpen] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [activeMeetingLink, setActiveMeetingLink] = useState<{
    url: string;
    roomId: string;
    passcode: string;
    createdAt: string;
    expiresIn: string;
  } | null>(null);

  // Schedule Meeting Modal state & date-picker data
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState<boolean>(false);
  const [scheduleForm, setScheduleForm] = useState<{
    title: string;
    date: string;
    time: string;
    type: 'call' | 'demo' | 'followup' | 'contract';
    contact: string;
    invitees: string;
    notes: string;
  }>({
    title: "Gamma Project Post-Call Alignment",
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: "10:30",
    type: "followup",
    contact: "Marcus Aurelius",
    invitees: "marcus@enterprise.org, kate@meetlyze.io",
    notes: "Follow up on WebRTC call recording notes, SLA compliance terms, and contract execution."
  });

  // Toast feedback banner state
  const [toastNotification, setToastNotification] = useState<{ message: string; type: 'success' | 'info' } | null>(null);

  // Saved Meetings & Recordings state for "My Meeting" tab
  const [savedRecordings, setSavedRecordings] = useState<Array<{
    id: string;
    title: string;
    date: string;
    duration: string;
    size: string;
    participants: string[];
    transcriptCount: number;
    videoUrl?: string;
    jsonUrl?: string;
  }>>([
    {
      id: "rec-initial-1",
      title: "Gamma Project SLA Alignment & Tech Review",
      date: `${new Date().toLocaleDateString()} 10:45 AM`,
      duration: "14:32",
      size: "24.8 MB",
      participants: ["Camelia Rose", "Kate Smith", "Rochelle"],
      transcriptCount: 18,
      videoUrl: "https://storage.googleapis.com/obsidian-recordings/session_webrtc_993.mp4"
    }
  ]);

  // Load saved recordings from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('my_meeting_recordings');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSavedRecordings(parsed);
        }
      }
    } catch (e) {
      console.warn("Could not load my_meeting_recordings:", e);
    }
  }, []);

  // Live accumulated transcripts state for downloading .txt file
  const [accumulatedTranscripts, setAccumulatedTranscripts] = useState<Array<{
    id: string;
    speaker: string;
    timestamp: string;
    text: string;
  }>>([
    { id: 'tr-1', speaker: 'Christina Mant', timestamp: '11:34 AM', text: "We must change strategy to boost revenue this month. I've sent the deck through chat..." },
    { id: 'tr-2', speaker: 'Camelia Rose', timestamp: '11:35 AM', text: "Fully agreed, I will coordinate with Nicholas to optimize our webhook integration endpoints." },
    { id: 'tr-3', speaker: 'Edward', timestamp: '11:37 AM', text: "Let's check the financial sheets on Slide 4 first! 📈" },
    { id: 'tr-4', speaker: 'Eva', timestamp: '11:39 AM', text: "The UI/UX wireframes for the multi-channel inbox are updated." },
    { id: 'tr-5', speaker: 'Alexandra Opalan', timestamp: '11:41 AM', text: "We have 99.99% multi-region redundancy under extreme loads." }
  ]);

  // Meeting Agenda items for Calendar tab
  const [agendaItems, setAgendaItems] = useState<Array<{ id: string; title: string; completed: boolean }>>([
    { id: 'ag-1', title: '1. Revenue Strategy Review & Conversion Metrics', completed: true },
    { id: 'ag-2', title: '2. Q3 Multi-Region Architecture & Webhooks', completed: true },
    { id: 'ag-3', title: '3. SLA Proposal Terms & Legal Execution', completed: false },
    { id: 'ag-4', title: '4. Action Items & Follow-up Booking', completed: false }
  ]);
  
  // Settings and Advanced configuration panels
  const [showSettingsOverlay, setShowSettingsOverlay] = useState<boolean>(false);
  const [selectedMic, setSelectedMic] = useState<string>("default-mic");
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>("default-speaker");
  const [selectedCamera, setSelectedCamera] = useState<string>("default-cam");

  // Chat message input
  const [chatInput, setChatInput] = useState<string>("");
  const [overlayChatInput, setOverlayChatInput] = useState<string>("");
  const [isOverlayChatOpen, setIsOverlayChatOpen] = useState<boolean>(false);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const debouncedSearchQuery = useDebounce(searchQuery, 350);

  // WebRTC Call Recorder state and refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const wasConnectedRef = useRef<boolean>(true);

  // Live real-time streaming transcripts state
  const [liveTranscriptText, setLiveTranscriptText] = useState<string>("We must change strategy to boost revenue this month. I've sent the deck through chat...");
  const [liveTranscriptSpeaker, setLiveTranscriptSpeaker] = useState<string>("Christina Mant");

  // Dynamic participants list
  const [participants, setParticipants] = useState<Array<{
    id: string;
    name: string;
    role: string;
    img: string; // initials
    status: "Active Speaker" | "Listening" | "Muted";
    isMuted: boolean;
    isVideoOff?: boolean;
  }>>([
    { id: "p1", name: "Camelia Rose (You)", role: "Founder", img: "CR", status: "Active Speaker", isMuted: false, isVideoOff: false },
    { id: "p2", name: "Rochelle", role: "UI/UX Designer", img: "R", status: "Listening", isMuted: false, isVideoOff: false },
    { id: "p3", name: "Nick P.", role: "Project Manager", img: "NP", status: "Listening", isMuted: false, isVideoOff: false },
    { id: "p4", name: "Eva Y.", role: "UI/UX Design Lead", img: "EY", status: "Listening", isMuted: false, isVideoOff: false }
  ]);

  const [showAddUserModal, setShowAddUserModal] = useState<boolean>(false);
  const [newParticipantName, setNewParticipantName] = useState<string>("Amelia Bada Lee");
  const [newParticipantRole, setNewParticipantRole] = useState<string>("Guest");
  const [chatRecipient, setChatRecipient] = useState<string>("Everyone");

  // Group Chat initial state matching the reference image conversation
  const [messages, setMessages] = useState<Array<{
    id: string;
    sender: string;
    avatar: string;
    text: string;
    timestamp: string;
    isYou?: boolean;
    isSystem?: boolean;
    recipient?: string;
  }>>([
    {
      id: "m1",
      sender: "Edward",
      avatar: "ED",
      text: "Hello, everyone! Is everyone here?",
      timestamp: "10m ago"
    },
    {
      id: "m2",
      sender: "Eva",
      avatar: "EV",
      text: "Yes, i'm here. Hello, everyone!",
      timestamp: "8m ago"
    },
    {
      id: "m3",
      sender: "You",
      avatar: "CR",
      text: "Hello, sorry for being a bit late.",
      timestamp: "6m ago",
      isYou: true
    },
    {
      id: "m4",
      sender: "Edward",
      avatar: "ED",
      text: "No problem, welcome Brad! Shall we get started?",
      timestamp: "5m ago"
    },
    {
      id: "m5",
      sender: "Cloe",
      avatar: "CL",
      text: "Yes, let's. What are the highlights for today?",
      timestamp: "3m ago"
    },
    {
      id: "m6",
      sender: "You",
      avatar: "CR",
      text: "Our project team reached a couple of milestones within the past week.",
      timestamp: "2m ago",
      isYou: true
    },
    {
      id: "m7",
      sender: "Edward",
      avatar: "ED",
      text: "That's great news, Brad!",
      timestamp: "1m ago"
    },
    {
      id: "m8",
      sender: "You",
      avatar: "CR",
      text: "We are progressing according to our planned timeline.",
      timestamp: "Now",
      isYou: true
    }
  ]);

  // WebRTC hooks mapping
  const {
    localStream,
    remoteStream,
    connectionState,
    isConnecting,
    isMuted,
    isVideoOff,
    rtt,
    peerConnection,
    startCall,
    endCall,
    toggleMute,
    toggleVideo
  } = useCRMCall({
    leadId: "real_estate_proposal_review_group",
    leadName: "Kate Smith"
  });

  // Video and Chat references
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const [screenShareStream, setScreenShareStream] = useState<MediaStream | null>(null);

  // Sync active peer connection and local media stream with global WebRTC state
  useEffect(() => {
    if (peerConnection) {
      setActivePeerConnection(peerConnection);
    }
  }, [peerConnection]);

  useEffect(() => {
    if (localStream) {
      setLocalMediaStream(localStream);
    }
  }, [localStream]);

  // Callback refs to instantly and securely bind streams on mount
  const setLocalVideoRef = useCallback((el: HTMLVideoElement | null) => {
    localVideoRef.current = el;
    if (el && localStream) {
      el.srcObject = localStream;
    }
  }, [localStream]);

  const setRemoteVideoRef = useCallback((el: HTMLVideoElement | null) => {
    remoteVideoRef.current = el;
    if (el && remoteStream) {
      el.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const setScreenShareVideoRef = useCallback((el: HTMLVideoElement | null) => {
    if (el && screenShareStream) {
      el.srcObject = screenShareStream;
    }
  }, [screenShareStream]);

  // Simulate active speaker switching among unmuted participants
  useEffect(() => {
    if (!isCallConnected) return;
    const interval = setInterval(() => {
      setParticipants(prev => {
        const unmuted = prev.filter(p => !p.isMuted);
        if (unmuted.length === 0) return prev;
        const speakerIndex = Math.floor(Math.random() * unmuted.length);
        const activeSpeakerId = unmuted[speakerIndex].id;
        return prev.map(p => {
          if (p.isMuted) {
            return { ...p, status: "Muted" as const };
          }
          return {
            ...p,
            status: p.id === activeSpeakerId ? ("Active Speaker" as const) : ("Listening" as const)
          };
        });
      });
    }, 6000);
    return () => clearInterval(interval);
  }, [isCallConnected]);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const overlayChatBottomRef = useRef<HTMLDivElement | null>(null);

  // Scroll chat list to bottom on new message
  const scrollToBottom = () => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollOverlayToBottom = () => {
    overlayChatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOverlayChatOpen) {
      scrollOverlayToBottom();
    }
  }, [messages, isTyping, isOverlayChatOpen]);

  // WebRTC Call Recording Functions
  const startRecordingSession = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      return; // Already recording
    }
    if (!peerConnection) {
      console.log("[Call Recorder] No peerConnection yet to start recording.");
      return;
    }

    // Capture the MediaStream from RTCPeerConnection by collecting all tracks
    const tracks: MediaStreamTrack[] = [];
    peerConnection.getReceivers().forEach(receiver => {
      if (receiver.track) tracks.push(receiver.track);
    });
    peerConnection.getSenders().forEach(sender => {
      if (sender.track) tracks.push(sender.track);
    });

    // Fallback to local and remote stream tracks if peerConnection receivers/senders are empty
    if (tracks.length === 0) {
      if (remoteStream) remoteStream.getTracks().forEach(t => tracks.push(t));
      if (localStream) localStream.getTracks().forEach(t => tracks.push(t));
    }

    if (tracks.length === 0) {
      console.log("[Call Recorder] No active media tracks available to record yet.");
      return;
    }

    try {
      const combinedStream = new MediaStream(tracks);
      recordedChunksRef.current = [];

      // Detect supported container type
      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8,opus';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = '';
      }

      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(combinedStream, options);

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        console.log("[Call Recorder] MediaRecorder stopped.");
      };

      recorder.start(1000); // chunk every 1 sec
      mediaRecorderRef.current = recorder;
      console.log(`[Call Recorder] Started recording combined RTCPeerConnection streams using MediaRecorder. Mime: ${mimeType}`);
    } catch (err) {
      console.error("[Call Recorder] Failed to start MediaRecorder:", err);
    }
  };

  const stopAndDownloadRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        console.warn("[Call Recorder] Error stopping MediaRecorder:", err);
      }
    }

    // Use a small delay to ensure final recorded chunks are captured
    setTimeout(() => {
      if (recordedChunksRef.current && recordedChunksRef.current.length > 0) {
        try {
          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          if (blob.size > 0) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = `meetlyze-webrtc-call-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log("[Call Recorder] Prompts the user to download the blob successfully.");
          }
        } catch (e) {
          console.error("[Call Recorder] Error generating call recording blob:", e);
        }
      }
      // Reset references
      mediaRecorderRef.current = null;
      recordedChunksRef.current = [];
    }, 300);
  };

  // Watch for call disconnect to trigger download prompt
  useEffect(() => {
    if (wasConnectedRef.current && !isCallConnected) {
      console.log("[Call Recorder] Disconnection detected. Prompting user to download recorded call.");
      stopAndDownloadRecording();
    }
    wasConnectedRef.current = isCallConnected;
  }, [isCallConnected]);

  // Automatically start recording when call is connected and peerConnection or streams update
  useEffect(() => {
    if (isCallConnected && peerConnection) {
      const timer = setTimeout(() => {
        startRecordingSession();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isCallConnected, peerConnection, localStream, remoteStream]);

  // Live Timer Countup
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isCallConnected) {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isCallConnected]);

  const formatDuration = (secs: number) => {
    const mm = Math.floor(secs / 60).toString().padStart(2, "0");
    const ss = (secs % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  };

  // Click handler for vertical volume slider
  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const computedVol = Math.max(0, Math.min(100, Math.round(((rect.height - y) / rect.height) * 100)));
    setVolumeLevel(computedVol);
  };

  // Fullscreen implementation
  const toggleFullscreenMode = () => {
    try {
      const el = document.getElementById("webrtc-video-screen-container");
      if (el) {
        if (!document.fullscreenElement) {
          el.requestFullscreen().catch(() => {});
          setIsFullscreen(true);
        } else {
          document.exitFullscreen().catch(() => {});
          setIsFullscreen(false);
        }
      }
    } catch {
      setIsFullscreen(!isFullscreen);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFull = document.fullscreenElement !== null;
      setIsFullscreen(isCurrentlyFull);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // 1. Setup Socket.io-based WebRTC Session and incoming Chat message listener
  useEffect(() => {
    if (isCallConnected) {
      console.log("[CRMSoftphoneCanvas] Initializing Socket.io signaling connection and register callback...");
      initializeWebRTCSession("real_estate_proposal_review_group", "Kate_Smith")
        .then(() => {
          console.log("[CRMSoftphoneCanvas] Socket.io signaling connection initialized successfully.");
        })
        .catch(err => {
          console.warn("[CRMSoftphoneCanvas] Error starting Socket.io signaling session:", err);
        });

      // Register listener for real-time incoming chat messages
      const unsubscribe = onChatMessageReceived((data: { text: string; sender: string; timestamp: string }) => {
        console.log("[CRMSoftphoneCanvas] Chat message received over Socket.io:", data);
        setMessages(prev => {
          // Prevent duplicate messages in list
          if (prev.some(m => m.text === data.text && m.sender === data.sender)) return prev;
          const words = (data.sender || "Alexandra Opalan").split(" ");
          const initials = words.map(w => w[0]).join("").toUpperCase().substring(0, 2);
          return [
            ...prev,
            {
              id: `socket-${Date.now()}-${Math.random()}`,
              sender: data.sender || "Alexandra Opalan",
              avatar: initials,
              text: data.text,
              timestamp: data.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            }
          ];
        });
      });

      // Register listener for real-time incoming streaming transcription events
      const unsubscribeTranscript = onLiveTranscriptReceived((data: { text: string; sender: string; timestamp: string }) => {
        console.log("[CRMSoftphoneCanvas] Live transcript received over Socket.io:", data);
        if (data && data.text) {
          setLiveTranscriptText(data.text);
          if (data.sender) {
            setLiveTranscriptSpeaker(data.sender);
          }
          setAccumulatedTranscripts(prev => [
            ...prev,
            {
              id: `tr-${Date.now()}-${Math.random()}`,
              speaker: data.sender || 'Christina Mant',
              timestamp: data.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              text: data.text
            }
          ]);
        }
      });

      // Register listener for real-time incoming administrative mute status changes
      const unsubscribeMute = onMuteStatusChanged((data: { roomId: string; targetUserId: string; newState: boolean; isOverride?: boolean }) => {
        console.log("[CRMSoftphoneCanvas] Mute status changed received:", data);
        const { targetUserId, newState, isOverride } = data;

        let localId = targetUserId;
        if (targetUserId === "Kate_Smith") {
          localId = "p1";
        } else if (targetUserId === "Alexandra_Opalan") {
          localId = "p2";
        } else if (targetUserId === "Amelia_Bada_Lee") {
          localId = "p3";
        } else if (targetUserId === "Justin_Bieber") {
          localId = "p4";
        }

        // If this is an administrative override targeting ourselves (Kate_Smith / p1)
        if (isOverride && localId === "p1") {
          setIsMutedLocal(prev => {
            if (prev !== newState) {
              toggleLocalAudioMute(newState);
              if (localStream) {
                localStream.getAudioTracks().forEach(track => {
                  track.enabled = !newState;
                });
              }
            }
            return newState;
          });
        }

        // Update the participant list to reflect the new state instantly (Requirement 2)
        setParticipants(prev => prev.map(p => {
          if (p.id === localId) {
            return {
              ...p,
              isMuted: newState,
              status: newState ? ("Muted" as const) : ("Listening" as const)
            };
          }
          return p;
        }));
      });

      // Register listener for real-time incoming administrative camera status changes
      const unsubscribeCamera = onCameraStatusChanged((data: { roomId: string; targetUserId: string; newState: boolean; isOverride?: boolean }) => {
        console.log("[CRMSoftphoneCanvas] Camera status changed received:", data);
        const { targetUserId, newState, isOverride } = data;

        let localId = targetUserId;
        if (targetUserId === "Kate_Smith") {
          localId = "p1";
        } else if (targetUserId === "Alexandra_Opalan") {
          localId = "p2";
        } else if (targetUserId === "Amelia_Bada_Lee") {
          localId = "p3";
        } else if (targetUserId === "Justin_Bieber") {
          localId = "p4";
        }

        // Update the participant list to reflect the new state instantly
        setParticipants(prev => prev.map(p => {
          if (p.id === localId) {
            return {
              ...p,
              isVideoOff: newState
            };
          }
          return p;
        }));

        // If this is an administrative override targeting ourselves
        if (isOverride && localId === "p1") {
          setIsVideoOffLocal(prev => {
            if (prev !== newState) {
              toggleLocalVideoMute(newState);
              if (localStream) {
                localStream.getVideoTracks().forEach(track => {
                  track.enabled = !newState;
                });
              }
            }
            return newState;
          });
        }
      });

      return () => {
        terminateCallSession();
        unsubscribe();
        unsubscribeTranscript();
        unsubscribeMute();
        unsubscribeCamera();
      };
    }
  }, [isCallConnected]);

  // Toggle Recording Bot Trigger
  const toggleRecordingBot = async () => {
    if (isRecordingInviting) return;

    if (!isRecording) {
      setIsRecordingInviting(true);
      try {
        const response = await fetch('/api/bot/invite', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            meetingUrl: 'https://meet.google.com/real_estate_proposal_review_group',
            botName: 'Executive Recording Bot'
          })
        });

        const data = await response.json();
        if (response.ok && data.success) {
          setIsRecording(true);
          setMessages(prev => [
            ...prev,
            {
              id: `recording-sys-${Date.now()}`,
              sender: "[System]",
              avatar: "",
              text: "dispatched Executive Recording Bot successfully to record this meeting.",
              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              isSystem: true
            }
          ]);
        } else {
          console.error("Recording invitation failed:", data.error);
          alert(`Recording bot invitation failed: ${data.error || 'Server error'}`);
        }
      } catch (err) {
        console.error("Error invoking recording bot:", err);
      } finally {
        setIsRecordingInviting(false);
      }
    } else {
      // Toggle off recording
      setIsRecording(false);
      setMessages(prev => [
        ...prev,
        {
          id: `recording-sys-off-${Date.now()}`,
          sender: "[System]",
          avatar: "",
          text: "has stopped recording this session. Processing compliance transcripts.",
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          isSystem: true
        }
      ]);

      // Automatically store recording in the calendar database
      if (onAddCalendarEvent) {
        onAddCalendarEvent({
          title: "SLA Strategic Assessment WebRTC Recording",
          time: new Date().toISOString().replace('T', ' ').substring(0, 16),
          type: "call",
          contact: "Christina Mant (WebRTC Studio)",
          status: "completed",
          recording: {
            url: "https://storage.googleapis.com/obsidian-recordings/session_webrtc_993.mp4",
            duration: "15:24",
            transcript: "Christina Mant (11:34 AM): We must change strategy to boost revenue this month. I've sent the deck through chat...\nCamelia Rose (11:35 AM): Fully agreed, I will coordinate with Nicholas to optimize our webhook integration endpoints."
          },
          meetingLink: "https://meet.google.com/real_estate_proposal_review_group"
        });
      }
    }
  };

  // Chat message submission
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const textToSend = chatInput.trim();
    const timeString = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg = {
      id: `user-${Date.now()}`,
      sender: "You",
      avatar: "KS",
      text: textToSend,
      timestamp: timeString,
      isYou: true,
      recipient: chatRecipient
    };

    setMessages(prev => [...prev, userMsg]);
    setChatInput("");

    // Send chat message using active Socket.io session connection
    sendChatMessage(textToSend, chatRecipient === "Everyone" ? "Kate Smith" : chatRecipient, timeString);

    // Simulate active reply (local simulation fallback)
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      const responses = [
        "Let's check the financial sheets on Slide 4 first! 📈",
        "Sounds perfect, I am ready to review.",
        "Yes, we have 99.99% multi-region redundancy under extreme loads.",
        "Good point! Alexandra, could you present your screen?",
        "Agree! We should start the walk-through.",
        "Excellent points, let me write down these requirements.",
        "Could you clarify the pricing model for the sublease agreements?"
      ];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      const responseTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      // Pick a responder from other active participants
      const otherParticipants = participants.filter(p => p.id !== "p1" && !p.isMuted);
      const responder = otherParticipants.length > 0 
        ? otherParticipants[Math.floor(Math.random() * otherParticipants.length)]
        : { name: "Alexandra Opalan", img: "AO" };

      // Mirror mock replies to all connected Socket.io clients so screens are fully in sync
      sendChatMessage(randomResponse, responder.name, responseTime);

      setMessages(prev => [...prev, {
        id: `reply-${Date.now()}`,
        sender: responder.name,
        avatar: responder.img,
        text: randomResponse,
        timestamp: responseTime,
        recipient: chatRecipient !== "Everyone" ? "You" : undefined
      }]);
    }, 1500);
  };

  // Chat overlay submission
  const handleSendOverlayMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!overlayChatInput.trim()) return;

    const textToSend = overlayChatInput.trim();
    const timeString = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg = {
      id: `user-${Date.now()}`,
      sender: "You",
      avatar: "KS",
      text: textToSend,
      timestamp: timeString,
      isYou: true,
      recipient: "Everyone"
    };

    setMessages(prev => [...prev, userMsg]);
    setOverlayChatInput("");

    // Send chat message using active Socket.io session connection
    sendChatMessage(textToSend, "Everyone", timeString);

    // Simulate active reply (local simulation fallback)
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      const responses = [
        "Let's check the financial sheets on Slide 4 first! 📈",
        "Sounds perfect, I am ready to review.",
        "Yes, we have 99.99% multi-region redundancy under extreme loads.",
        "Good point! Alexandra, could you present your screen?",
        "Agree! We should start the walk-through.",
        "Excellent points, let me write down these requirements.",
        "Could you clarify the pricing model for the sublease agreements?"
      ];
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      const responseTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      // Pick a responder from other active participants
      const otherParticipants = participants.filter(p => p.id !== "p1" && !p.isMuted);
      const responder = otherParticipants.length > 0 
        ? otherParticipants[Math.floor(Math.random() * otherParticipants.length)]
        : { name: "Alexandra Opalan", img: "AO" };

      // Mirror mock replies to all connected Socket.io clients so screens are fully in sync
      sendChatMessage(randomResponse, responder.name, responseTime);

      setMessages(prev => [...prev, {
        id: `reply-${Date.now()}`,
        sender: responder.name,
        avatar: responder.img,
        text: randomResponse,
        timestamp: responseTime
      }]);
    }, 1500);
  };

  const handleStartCall = async () => {
    setIsCallConnected(true);
    setCallDuration(195); // Starts back at 03:15 for high fidelity representation
    dispatchWebRTCCallState('connected', { peerName: 'Marcus Aurelius & Team', room: 'real_estate_proposal_review_group' });
    try {
      await startCall("video");
    } catch (e) {
      console.warn("Real camera access rejected. Operating in premium mock stream mode.", e);
    }
  };

  const playHoldChime = (isEngaging: boolean) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      if (isEngaging) {
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
      console.warn("[CRMSoftphoneCanvas Hold Chime Error]", e);
    }
  };

  const handleToggleHold = () => {
    const nextHold = !isOnHold;
    setIsOnHold(nextHold);
    playHoldChime(nextHold);

    if (nextHold) {
      setIsMutedLocal(true);
      toggleLocalAudioMute(true);
      emitMuteStatusChange("real_estate_proposal_review_group", "Kate_Smith", true);
      setParticipants(prev => prev.map(p => p.id === "p1" ? { ...p, status: "Muted", isMuted: true } : p));
    } else {
      setIsMutedLocal(false);
      toggleLocalAudioMute(false);
      emitMuteStatusChange("real_estate_proposal_review_group", "Kate_Smith", false);
      setParticipants(prev => prev.map(p => p.id === "p1" ? { ...p, status: "Active Speaker", isMuted: false } : p));
    }
  };

  const handleHangupCall = () => {
    setIsCallConnected(false);
    setIsScreenSharing(false);
    setIsPipActive(false);
    setIsOnHold(false);
    setShowDisconnectConfirmModal(false);
    dispatchWebRTCCallState('disconnected', { peerName: 'Marcus Aurelius & Team', room: 'real_estate_proposal_review_group' });
    try {
      const doc = document as any;
      if (doc.pictureInPictureElement) {
        doc.exitPictureInPicture().catch(() => {});
      }
    } catch (e) {}
    endCall();
  };

  const handleTogglePiP = async () => {
    const videoEl = remoteVideoRef.current;
    if (!videoEl) {
      console.warn("No remote video element found for Picture-in-Picture.");
      return;
    }

    try {
      const doc = document as any;
      if (doc.pictureInPictureElement) {
        await doc.exitPictureInPicture();
        setIsPipActive(false);
      } else {
        if (doc.pictureInPictureEnabled) {
          await (videoEl as any).requestPictureInPicture();
          setIsPipActive(true);
          videoEl.addEventListener("leavepictureinpicture", () => {
            setIsPipActive(false);
          }, { once: true });
        } else {
          alert("Picture-in-Picture is not supported in this browser.");
        }
      }
    } catch (err) {
      console.error("Error toggling Picture-in-Picture:", err);
    }
  };

  const handleToggleScreenShare = useCallback(async () => {
    if (isScreenCapturePending) return;

    if (isScreenSharing) {
      await stopScreenShare(() => {
        setIsScreenSharing(false);
        setScreenShareStream(null);
        dispatchScreenShareState(false, null);
      }, peerConnection, localStream);
      setIsScreenSharing(false);
      setScreenShareStream(null);
      dispatchScreenShareState(false, null);
    } else {
      if (!isScreenSharingSupported()) {
        setScreenShareError(
          "Screen sharing is not supported by this browser. Please use a current version of Chrome, Edge, Firefox, or another supported browser."
        );
        return;
      }

      setIsScreenCapturePending(true);
      setScreenShareError(null);

      try {
        const stream = await startScreenShare(
          () => {
            console.log("[CRMSoftphoneCanvas] Screen sharing stream ended natively by browser");
            setIsScreenSharing(false);
            setScreenShareStream(null);
            dispatchScreenShareState(false, null);
          },
          peerConnection,
          { audio: true }
        );

        setIsScreenSharing(true);
        setScreenShareStream(stream);
        dispatchScreenShareState(true, stream);
      } catch (err: any) {
        console.error("Screen sharing cancelled or failed:", err);
        setIsScreenSharing(false);
        setScreenShareStream(null);
        dispatchScreenShareState(false, null);
        const friendlyMessage = getScreenShareErrorMessage(err);
        setScreenShareError(friendlyMessage);
      } finally {
        setIsScreenCapturePending(false);
      }
    }
  }, [isScreenSharing, isScreenCapturePending, peerConnection, localStream]);

  // Synchronize with external screen share toggle triggers (e.g., from Call Canvas header)
  useEffect(() => {
    const unsub = onRequestToggleScreenShare(() => {
      handleToggleScreenShare();
    });
    return unsub;
  }, [handleToggleScreenShare]);

  // 1. Download Transcript (.txt) Handler
  const handleDownloadTranscript = () => {
    const formattedDuration = formatDuration(callDuration);
    const header = `==================================================\n` +
      `MEETLYZE WebRTC CALL TRANSCRIPT\n` +
      `Session: Gamma Project Reporting / SLA Alignment\n` +
      `Date: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n` +
      `Call Duration: ${formattedDuration}\n` +
      `Active Participants: ${participants.map(p => p.name).join(', ')}\n` +
      `==================================================\n\n`;

    const body = accumulatedTranscripts.map(item => `[${item.timestamp}] ${item.speaker}:\n${item.text}\n`).join('\n');
    const fullText = header + body;

    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Meetlyze_Call_Transcript_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 2. Save Recording & Auto-Populate "My Meeting" Handler
  const handleSaveRecording = () => {
    const formattedDuration = formatDuration(callDuration);
    const newRecordingId = `rec-${Date.now()}`;
    const formattedDate = `${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    
    const newRecordingItem = {
      id: newRecordingId,
      title: "Gamma Project Reporting / SLA Alignment",
      date: formattedDate,
      duration: formattedDuration,
      size: "18.4 MB",
      participants: participants.map(p => p.name),
      transcriptCount: accumulatedTranscripts.length,
      videoUrl: "https://storage.googleapis.com/obsidian-recordings/session_webrtc_993.mp4"
    };

    // Auto-save into state and localStorage for "My Meeting" section
    const updatedRecordings = [newRecordingItem, ...savedRecordings];
    setSavedRecordings(updatedRecordings);
    try {
      localStorage.setItem('my_meeting_recordings', JSON.stringify(updatedRecordings));
    } catch (e) {
      console.warn("Error saving to localStorage:", e);
    }

    // Download JSON backup package
    const recordingPackage = {
      meetingTitle: newRecordingItem.title,
      date: new Date().toISOString(),
      duration: formattedDuration,
      participants: participants.map(p => ({ name: p.name, role: p.role })),
      transcriptCount: accumulatedTranscripts.length,
      transcripts: accumulatedTranscripts,
      webrtcSessionId: "real_estate_proposal_review_group",
      status: "Saved & Verified WebRTC Call Recording"
    };

    const blob = new Blob([JSON.stringify(recordingPackage, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Meetlyze_Call_Recording_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Sync recording node to CRM Database / Calendar history if provided
    if (onAddCalendarEvent) {
      onAddCalendarEvent({
        title: "Gamma Project Reporting WebRTC Session Recording",
        time: new Date().toISOString().replace('T', ' ').substring(0, 16),
        type: "call",
        contact: "Marcus Aurelius (Stoic Ventures LLC)",
        status: "completed",
        recording: {
          url: "https://storage.googleapis.com/obsidian-recordings/session_webrtc_993.mp4",
          duration: formattedDuration,
          transcript: accumulatedTranscripts.map(t => `[${t.timestamp}] ${t.speaker}: ${t.text}`).join('\n')
        },
        meetingLink: "https://meet.google.com/real_estate_proposal_review_group"
      });
    }

    // Auto switch tab to "My Meeting" section and open chat sidebar if closed
    setActiveTab("my_meetings");
    setIsChatOpen(true);

    // Display Toast notification
    setToastNotification({
      message: 'Recording saved and populated in "My Meeting" tab!',
      type: 'success'
    });
    setTimeout(() => setToastNotification(null), 4000);
  };

  // 3. Collaboration Feature 1: Create Secure Shareable Link
  const generateSecureMeetingLink = useCallback(() => {
    const randomHex = Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 6);
    const roomId = `sec_mtg_${randomHex}`;
    const passcode = Math.floor(100000 + Math.random() * 900000).toString();
    const origin = typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'https://meetlyze.app';
    const secureUrl = `${origin}?room=${roomId}&passcode=${passcode}`;

    const linkData = {
      url: secureUrl,
      roomId,
      passcode,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      expiresIn: "24 Hours"
    };

    setActiveMeetingLink(linkData);
    setCopiedLink(false);
    setIsLinkModalOpen(true);
    return linkData;
  }, []);

  const handleCreateLink = () => {
    generateSecureMeetingLink();
  };

  // Option A: Share Link
  const handleShareLink = async () => {
    if (!activeMeetingLink) return;

    if (navigator.share) {
      navigator.share({
        title: 'Join my Secure Meeting',
        text: `You are invited to join a secure meeting room (${activeMeetingLink.roomId}). Passcode: ${activeMeetingLink.passcode}`,
        url: activeMeetingLink.url,
      }).catch(async () => {
        await copyToClipboard(activeMeetingLink.url);
      });
    } else {
      await copyToClipboard(activeMeetingLink.url);
    }

    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);

    setToastNotification({
      message: `Secure link copied to clipboard! Share with your team.`,
      type: 'success'
    });
    setTimeout(() => setToastNotification(null), 4000);
  };

  // Option B: Join Meeting
  const handleJoinMeetingFromLink = () => {
    if (!activeMeetingLink) return;

    if (!isCallConnected) {
      setIsCallConnected(true);
    }
    setCallDuration(0); // Reset session timer
    setParticipants([
      { id: "p1", name: "Camelia Rose (You - Host)", role: "Host & Organizer", img: "CR", status: "Active Speaker", isMuted: false },
      { id: "p2", name: "Guest Participant", role: "Invited Guest", img: "GP", status: "Listening", isMuted: false }
    ]);

    setIsLinkModalOpen(false);

    setToastNotification({
      message: `Joined secure room session: ${activeMeetingLink.roomId}`,
      type: 'success'
    });
    setTimeout(() => setToastNotification(null), 4500);
  };

  // 4. Collaboration Feature 2: Schedule Meeting with Date Picker
  const handleScheduleMeeting = () => {
    // Open date picker scheduler tool
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    setScheduleForm(prev => ({
      ...prev,
      date: prev.date || tomorrow
    }));
    setIsScheduleModalOpen(true);
  };

  const handleSaveScheduledEvent = (e: React.FormEvent) => {
    e.preventDefault();

    const formattedTime = `${scheduleForm.date} at ${scheduleForm.time}`;
    const generatedLink = `https://meetlyze.app?room=sec_mtg_${Math.random().toString(36).substring(2, 10)}`;

    const newCalendarEvent: Omit<CalendarEvent, 'id'> = {
      title: scheduleForm.title || "Scheduled Meeting",
      time: formattedTime,
      type: scheduleForm.type,
      contact: scheduleForm.contact || "Client Contact",
      status: 'upcoming',
      meetingLink: generatedLink,
      invitees: scheduleForm.invitees,
      notes: scheduleForm.notes
    };

    // Save directly to global calendar state
    if (onAddCalendarEvent) {
      onAddCalendarEvent(newCalendarEvent);
    }

    if (onScheduleFollowup) {
      onScheduleFollowup();
    }

    setIsScheduleModalOpen(false);

    setToastNotification({
      message: `Meeting "${scheduleForm.title}" scheduled for ${scheduleForm.date} at ${scheduleForm.time}!`,
      type: 'success'
    });
    setTimeout(() => setToastNotification(null), 5000);
  };

  // 5. Collaboration Feature 3: Create Group Call
  const handleCreateGroupCall = () => {
    // Add co-host/guests if needed and activate call
    if (!isCallConnected) {
      setIsCallConnected(true);
    }
    setParticipants([
      { id: "p1", name: "Camelia Rose (You)", role: "Founder & Host", img: "CR", status: "Active Speaker", isMuted: false },
      { id: "p2", name: "Kate Smith", role: "SLA Specialist", img: "KS", status: "Listening", isMuted: false },
      { id: "p3", name: "Alex Rivers", role: "Product Manager", img: "AR", status: "Listening", isMuted: false },
      { id: "p4", name: "Dr. Marcus Aurelius", role: "Partner", img: "MA", status: "Listening", isMuted: false }
    ]);
    
    setToastNotification({
      message: 'Multi-participant group call room created & connected!',
      type: 'success'
    });
    setTimeout(() => setToastNotification(null), 4000);
  };

  const handleToggleMute = () => {
    const nextMuteState = !isMutedLocal;
    setIsMutedLocal(nextMuteState);
    toggleLocalAudioMute(nextMuteState);
    toggleMute();

    // Synchronize local participant mute status in the grid/list
    setParticipants(prev => prev.map(p => {
      if (p.id === "p1") {
        return {
          ...p,
          isMuted: nextMuteState,
          status: nextMuteState ? ("Muted" as const) : ("Listening" as const)
        };
      }
      return p;
    }));

    // Emit state update over socket (Requirement 2)
    emitMuteStatusChange("real_estate_proposal_review_group", "Kate_Smith", nextMuteState);
  };

  // Audio level fluctuating helper
  const [visualizerHeights, setVisualizerHeights] = useState<number[]>([12, 18, 14, 28, 8, 22, 16, 26, 12, 19, 14, 25, 10, 20]);
  useEffect(() => {
    if (!isCallConnected) return;
    const interval = setInterval(() => {
      setVisualizerHeights(prev => prev.map(() => Math.floor(Math.random() * 26) + 4));
    }, 120);
    return () => clearInterval(interval);
  }, [isCallConnected]);

  return (
    <div 
      id="webrtc-call-canvas-layout-container" 
      className="w-full max-w-7xl mx-auto rounded-3xl bg-slate-50 shadow-2xl border border-neutral-200 overflow-hidden flex flex-col lg:grid lg:grid-cols-12 text-neutral-900 font-sans relative"
    >
      {/* Wave CSS animations for beautiful interactive speech indicators */}
      <style>{`
        @keyframes subtle-ripple {
          0%, 100% { transform: scale(1); opacity: 0.2; }
          50% { transform: scale(1.1); opacity: 0.45; }
        }
        .animate-subtle-ripple {
          animation: subtle-ripple 2.5s ease-in-out infinite;
        }
      `}</style>

      {/* Meetlyze Top Header */}
      <div className="col-span-12 flex items-center justify-between px-6 py-4 bg-white border-b border-neutral-200 z-30">
        {/* Left Logo */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-blue-600 to-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/10">
            <Video className="h-4.5 w-4.5 text-white" />
          </div>
          <span className="text-base font-extrabold text-neutral-900 tracking-tight font-sans">Meetlyze</span>
        </div>

        {/* Center Navigation Pills */}
        <div className="hidden md:flex items-center gap-2">
          {/* Search Input */}
          <div className="relative mr-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..." 
              className="bg-neutral-100 border border-neutral-250 rounded-full pl-9 pr-4 py-1.5 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-blue-500/50 w-44"
            />
          </div>

          <button 
            onClick={() => { setActiveTab("my_meetings"); setIsChatOpen(true); }}
            className={`px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "my_meetings"
                ? "bg-blue-600 text-white shadow shadow-blue-600/20"
                : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100"
            }`}
          >
            <Video className="h-3.5 w-3.5" />
            <span>My Meeting</span>
          </button>

          <button 
            onClick={() => { setActiveTab("logs"); setIsChatOpen(true); }}
            className={`px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === "logs"
                ? "bg-blue-600 text-white shadow shadow-blue-600/20"
                : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100"
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>My Meet & Greet</span>
          </button>

          <button className="text-neutral-500 hover:text-neutral-800 px-3 py-1.5 rounded-full text-xs font-semibold hover:bg-neutral-100 transition-colors cursor-pointer">
            <Sparkles className="h-3.5 w-3.5 inline mr-1" />
            <span>AI Space</span>
          </button>
        </div>

        {/* Right User Actions */}
        <div className="flex items-center gap-4">
          {/* Bell / Notification */}
          <button className="p-2 rounded-xl bg-neutral-100 border border-neutral-200 text-neutral-600 hover:text-neutral-900 transition-colors relative cursor-pointer">
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-blue-500" />
            <Bell className="h-3.5 w-3.5" />
          </button>

          {/* User profile dropdown */}
          <div className="flex items-center gap-2.5 bg-neutral-100 border border-neutral-200 hover:border-neutral-300 px-3 py-1.5 rounded-2xl cursor-pointer transition-colors">
            <div className="h-7 w-7 rounded-lg bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 text-xs font-bold flex items-center justify-center">
              CR
            </div>
            <div className="flex flex-col text-left leading-none">
              <span className="text-[10px] font-bold text-neutral-800">Camelia Rose</span>
              <span className="text-[8px] text-neutral-500 font-medium mt-0.5">camel.works@gmail.com</span>
            </div>
            <ChevronDown className="h-3 w-3 text-neutral-500 ml-1 shrink-0" />
          </div>
        </div>
      </div>

      {/* LEFT AREA: Video Workspace */}
      <div className={`${isChatOpen ? "lg:col-span-8" : "lg:col-span-12"} flex flex-col p-6 sm:p-8 bg-white border-r border-neutral-200/60 transition-all duration-300`}>
        
        {/* Title, AI Mode and Copyable Invite Link Bar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div className="flex flex-col text-left">
            {/* AI Mode badge */}
            <div className="flex items-center gap-2 mb-2">
              <span className="bg-blue-600/10 border border-blue-500/20 text-blue-400 px-3 py-1 rounded-full font-bold text-[10px] tracking-wider uppercase flex items-center gap-1">
                <Sparkles className="h-3 w-3 animate-pulse" />
                <span>Analysis AI Mode</span>
              </span>
            </div>
            {/* Dynamic Meeting Title */}
            <h2 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-tight leading-tight">
              Gamma Project Reporting
            </h2>
          </div>

          {/* Copyable Invite Link */}
          <div className="flex items-center gap-2 bg-neutral-100 border border-neutral-200 pl-3.5 pr-2 py-1.5 rounded-2xl w-full md:w-auto">
            <span className="text-[10px] text-neutral-600 font-mono select-all truncate max-w-[180px] sm:max-w-xs">
              https://us77web.meetlyze/g7262h418i92..
            </span>
            <button 
              onClick={async () => {
                await copyToClipboard("https://us77web.meetlyze/g7262h418i92..");
                setToastNotification({
                  message: "Invite link copied to clipboard!",
                  type: 'success'
                });
              }}
              className="p-1.5 rounded-lg hover:bg-neutral-200 text-neutral-500 hover:text-neutral-800 transition-colors cursor-pointer"
              title="Copy invite link"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Collaboration & Invitation Action Bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6 bg-neutral-50 border border-neutral-200 p-3 rounded-2xl relative">
          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 px-3 py-1 rounded-full font-bold text-xs flex items-center gap-2 shadow-sm">
              <span>Invited to call:</span>
              <span className="bg-emerald-600 text-white rounded-full w-4.5 h-4.5 flex items-center justify-center text-[10px] font-black">
                {participants.length}
              </span>
            </div>

            {/* Toast Notification Banner */}
            {toastNotification && (
              <motion.div 
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className={`px-3 py-1 rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-sm border ${
                  toastNotification.type === 'success' 
                    ? 'bg-emerald-600 text-white border-emerald-500' 
                    : 'bg-blue-600 text-white border-blue-500'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{toastNotification.message}</span>
              </motion.div>
            )}
          </div>

          {/* Collaboration & Invitation Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {/* Create a Link */}
            <button 
              onClick={handleCreateLink}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-3.5 py-2 transition-all shadow-sm cursor-pointer"
              title="Generate & copy shareable meeting link"
            >
              <Link className="h-3.5 w-3.5" />
              <span>Create Link</span>
            </button>

            {/* Schedule Meeting */}
            <button 
              onClick={handleScheduleMeeting}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 rounded-xl bg-white hover:bg-neutral-100 border border-neutral-250 text-neutral-800 font-bold text-xs px-3.5 py-2 transition-all shadow-sm cursor-pointer"
              title="Schedule future meeting session"
            >
              <CalendarPlus className="h-3.5 w-3.5 text-blue-600" />
              <span>Schedule</span>
            </button>

            {/* Create Group Call */}
            <button 
              onClick={handleCreateGroupCall}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3.5 py-2 transition-all shadow-sm cursor-pointer"
              title="Initiate multi-participant group call"
            >
              <Users className="h-3.5 w-3.5" />
              <span>Create Group Call</span>
            </button>
          </div>
        </div>

        {/* Main Video Screen with absolute floating controls */}
        <div id="webrtc-video-screen-container" className="w-full aspect-[1.5] rounded-3xl overflow-hidden relative shadow-inner bg-neutral-100 border border-neutral-200 flex items-center justify-center group/video">
          {/* Active Call state rendering */}
          {isCallConnected ? (() => {
            const getActivePresenter = () => {
              if (pinnedParticipantId) {
                const pinned = participants.find(p => p.id === pinnedParticipantId);
                if (pinned) return pinned;
              }
              if (isScreenSharing) {
                return participants.find(p => p.id === "p1") || participants[0];
              }
              const activeSpeaker = participants.find(p => p.status === "Active Speaker" && !p.isMuted);
              if (activeSpeaker) return activeSpeaker;
              const otherParticipant = participants.find(p => p.id !== "p1");
              return otherParticipant || participants[0];
            };
            const presenter = getActivePresenter();
            return (
              <div className="absolute inset-0 w-full h-full flex gap-4 bg-slate-100 p-4 animate-fade-in">
                
                {/* 1. Large Main Presenter Screen (Left, occupying 70% width) */}
                <div className="flex-1 h-full relative rounded-2xl overflow-hidden bg-white border border-neutral-200/80 flex items-center justify-center shadow-md">
                  {isScreenSharing && screenShareStream ? (
                    <div className="relative w-full h-full bg-slate-950 flex items-center justify-center overflow-hidden">
                      <video 
                        ref={setScreenShareVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-contain"
                      />
                      {/* Floating Picture-In-Picture or Mini Camera overlay in bottom right corner */}
                      {localStream && !isVideoOffLocal && (
                        <div className="absolute bottom-16 right-4 w-36 h-24 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-20 bg-black">
                          <video 
                            id="local-video"
                            ref={setLocalVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover transform scale-x-[-1]"
                          />
                          {isMutedLocal && (
                            <div
                              id="local-video-muted-overlay"
                              className="absolute top-1.5 left-1.5 z-30 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-600/90 text-white shadow-md border border-rose-400/40 text-[10px] font-semibold"
                              title="Microphone is muted"
                            >
                              <MicOff className="h-2.5 w-2.5" />
                              <span>Muted</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : presenter.id === "p1" && !isVideoOffLocal && localStream ? (
                    <div className="absolute inset-0 w-full h-full">
                      <video 
                        id="local-video-presenter"
                        ref={setLocalVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover transform scale-x-[-1]"
                      />
                      {isMutedLocal && (
                        <div
                          className="absolute top-4 left-4 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600/90 text-white shadow-lg border border-rose-400/40 text-xs font-semibold"
                          title="Microphone is muted"
                        >
                          <MicOff className="h-3.5 w-3.5" />
                          <span>Muted</span>
                        </div>
                      )}
                    </div>
                  ) : presenter.id !== "p1" && remoteStream ? (
                    <div id="remote-container" className="absolute inset-0 w-full h-full">
                      {presenter.isVideoOff ? (
                        <div className="obsidian absolute inset-0 bg-[var(--obsidian-0)] flex flex-col items-center justify-center text-center z-10 p-6">
                          <div className="relative h-20 w-20 rounded-full flex items-center justify-center bg-red-950/40 border border-red-500/20 shadow-xl mb-4">
                            <VideoOff className="h-8 w-8 text-red-500 animate-pulse" />
                          </div>
                          <span className="text-sm font-extrabold text-neutral-300">{presenter.name}'s Camera is Off</span>
                          <span className="text-xs text-neutral-500 mt-1">Video feed has been disabled by user</span>
                        </div>
                      ) : (
                        <video 
                          ref={setRemoteVideoRef}
                          autoPlay
                          playsInline
                          className="w-full h-full object-cover"
                        />
                      )}
                      
                      {/* Red strike-through control overlays inside #remote-container */}
                      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                        <button
                          id="btn-remote-share-screen"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                              const [videoTrack] = stream.getVideoTracks();
                              if (peerConnection && videoTrack) {
                                const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
                                if (sender) {
                                  await sender.replaceTrack(videoTrack);
                                  console.log('[CRMSoftphoneCanvas] Injected display stream via replaceTrack');
                                }
                              }
                            } catch (err) {
                              console.error('Failed to share screen inside #remote-container:', err);
                            }
                          }}
                          className="bg-blue-600 hover:bg-blue-500 border border-blue-500/35 text-white px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-lg backdrop-blur-md cursor-pointer transition-colors"
                          title="Share Screen (Display Capture & replaceTrack)"
                        >
                          <MonitorUp className="h-4 w-4 text-white" />
                          <span className="text-[10px] font-bold font-sans uppercase tracking-wider">Share Screen</span>
                        </button>
                        {presenter.isMuted && (
                          <div className="bg-red-600/95 border border-red-500/35 text-white px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-lg backdrop-blur-md">
                            <MicOff className="h-4 w-4 text-white" />
                            <span className="text-[10px] font-bold font-sans uppercase tracking-wider">Muted</span>
                          </div>
                        )}
                        {presenter.isVideoOff && (
                          <div className="bg-red-600/95 border border-red-500/35 text-white px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-lg backdrop-blur-md">
                            <VideoOff className="h-4 w-4 text-white" />
                            <span className="text-[10px] font-bold font-sans uppercase tracking-wider">Video Disabled</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center z-10 p-6">
                      {/* Generous Pulsing Initials fallback */}
                      <div className="relative h-24 w-24 rounded-full flex items-center justify-center font-bold text-2xl text-white bg-gradient-to-tr from-blue-600 to-blue-500 shadow-2xl">
                        <span>{presenter.img}</span>
                        {presenter.status === "Active Speaker" && !presenter.isMuted && (
                          <>
                            <span className="absolute inset-0 rounded-full border-2 border-blue-500 animate-ping opacity-60" style={{ animationDuration: '2s' }} />
                            <span className="absolute -inset-2 rounded-full border border-blue-400/30 animate-subtle-ripple" />
                          </>
                        )}
                      </div>
                      <span className="mt-3 text-xs font-bold text-neutral-600">{presenter.role}</span>
                    </div>
                  )}

                  {/* Screen Sharing Error Banner */}
                  {screenShareError && (
                    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 bg-rose-950/95 text-white px-4 py-2.5 rounded-2xl text-xs flex items-center gap-2.5 border border-rose-500/50 shadow-2xl backdrop-blur-md max-w-md w-[90%] sm:w-auto">
                      <Shield className="h-4 w-4 text-rose-400 shrink-0" />
                      <span className="flex-1 font-medium leading-relaxed">{screenShareError}</span>
                      <button 
                        onClick={() => setScreenShareError(null)} 
                        className="p-1 hover:bg-white/10 rounded-lg cursor-pointer transition-colors text-white/70 hover:text-white"
                        title="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Active Screen Share Top Banner Overlay */}
                  {isScreenSharing && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-amber-500 text-slate-950 border border-amber-300 backdrop-blur-md px-4 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-2 shadow-2xl">
                      <span className="h-2 w-2 rounded-full bg-slate-950 animate-ping" />
                      <MonitorUp className="h-4 w-4 text-slate-950" />
                      <span>You are sharing your screen</span>
                      <button 
                        onClick={handleToggleScreenShare}
                        className="ml-2 px-3 py-1 bg-slate-950 hover:bg-slate-800 text-white rounded-full text-[10px] font-bold transition-colors cursor-pointer shadow-sm"
                      >
                        Stop Sharing
                      </button>
                    </div>
                  )}

                  {/* Floating User Badge - Top Left with glass styling from image */}
                  <div className="absolute top-4 left-4 z-20 bg-black/45 backdrop-blur-md rounded-xl px-3.5 py-1.5 flex items-center gap-2 border border-white/10 shadow-lg text-white">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-bold font-sans">{presenter.name}</span>
                  </div>

                  {/* Active Recording & Pin Icons Overlay - Top Right */}
                  <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
                    <div className="bg-red-500/85 border border-red-600/30 backdrop-blur-md text-white px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 shadow-md">
                      <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                      <span>Recording Live</span>
                    </div>

                    <button 
                      onClick={() => setPinnedParticipantId(null)}
                      className="p-2 rounded-xl bg-black/40 backdrop-blur-md border border-white/10 text-white hover:bg-black/65 transition-colors"
                      title="Clear Pinned status"
                    >
                      <Pin className="h-3.5 w-3.5 text-blue-400 fill-blue-400" />
                    </button>

                    <span className="bg-blue-600 p-2 rounded-xl text-white font-bold text-xs shadow-md">
                      <Sparkles className="h-3.5 w-3.5" />
                    </span>
                  </div>

                  {/* Incoming Live Transcription Overlay on Video Canvas */}
                  <LiveTranscriptOverlay 
                    position="bottom-center"
                    activeSpeaker={presenter.name}
                    className="mb-14"
                  />

                  {/* BOTTOM FLOATING TRANSPARENT CONTROLS CAPSULE - Dark Glass layout from reference image */}
                  <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-black/55 backdrop-blur-lg px-6 py-3 rounded-full border border-white/15 shadow-2xl pointer-events-auto">
                    
                    {/* Toggle Microphone */}
                    <button 
                      onClick={handleToggleMute}
                      className={`h-10 w-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        isMutedLocal 
                          ? "bg-rose-600 text-white shadow-lg shadow-rose-600/25" 
                          : "bg-white/20 hover:bg-white/30 text-white border border-white/10"
                      }`}
                      title={isMutedLocal ? "Unmute Microphone" : "Mute Microphone"}
                    >
                      {isMutedLocal ? <MicOff className="h-4.5 w-4.5" /> : <Mic className="h-4.5 w-4.5" />}
                    </button>

                    {/* Hold Button with soft chime */}
                    <button 
                      id="btn-softphone-capsule-hold"
                      onClick={handleToggleHold}
                      className={`h-10 w-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        isOnHold 
                          ? "bg-amber-500 text-slate-950 ring-2 ring-amber-400/50 shadow-lg animate-pulse" 
                          : "bg-white/20 hover:bg-amber-500/30 text-white border border-white/10"
                      }`}
                      title={isOnHold ? "Resume Call (Plays soft tone)" : "Hold Call (Plays soft chime & mutes)"}
                    >
                      {isOnHold ? <Play className="h-4.5 w-4.5 fill-current" /> : <Pause className="h-4.5 w-4.5" />}
                    </button>

                    {/* Toggle Video */}
                    <button 
                      onClick={() => {
                        const nextVideoState = !isVideoOffLocal;
                        setIsVideoOffLocal(nextVideoState);
                        toggleLocalVideoMute(nextVideoState);
                        emitCameraStatusChange("real_estate_proposal_review_group", "Kate_Smith", nextVideoState);
                      }}
                      className={`h-10 w-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        isVideoOffLocal 
                          ? "bg-rose-600 text-white shadow-lg shadow-rose-600/25" 
                          : "bg-white/20 hover:bg-white/30 text-white border border-white/10"
                      }`}
                      title={isVideoOffLocal ? "Turn Camera On" : "Turn Camera Off"}
                    >
                      {isVideoOffLocal ? <VideoOff className="h-4.5 w-4.5" /> : <Video className="h-4.5 w-4.5" />}
                    </button>

                    {/* Record button matching red dot in the image */}
                    <button 
                      onClick={() => setIsRecording(prev => !prev)}
                      className={`h-10 w-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        isRecording 
                          ? "bg-red-600 text-white animate-pulse" 
                          : "bg-white/20 hover:bg-white/30 text-white border border-white/10"
                      }`}
                      title={isRecording ? "Stop Local Recording" : "Start Local Recording"}
                    >
                      <CircleDot className={`h-4.5 w-4.5 ${isRecording ? "text-white" : "text-red-500 fill-red-500"}`} />
                    </button>

                    {/* Hangup button with confirmation modal protection */}
                    <button 
                      onClick={() => setShowDisconnectConfirmModal(true)}
                      className="h-10 w-10 rounded-full flex items-center justify-center bg-rose-600 hover:bg-rose-700 text-white transition-all cursor-pointer shadow-lg shadow-rose-600/20"
                      title="Leave / End Meeting (Confirmation protected)"
                    >
                      <PhoneOff className="h-4.5 w-4.5" />
                    </button>

                    {/* Separator line */}
                    <span className="w-px h-6 bg-white/20" />

                    {/* PiP Mode */}
                    <button 
                      onClick={handleTogglePiP}
                      className={`h-10 w-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        isPipActive ? "bg-blue-600 text-white" : "bg-white/10 hover:bg-white/20 text-white/90"
                      }`}
                      title="Picture-in-Picture"
                    >
                      <PictureInPicture className="h-4 w-4" />
                    </button>

                    {/* Screen Sharing */}
                    <button 
                      id="btn-toggle-screen-share"
                      disabled={!canShareScreen || isScreenCapturePending}
                      onClick={handleToggleScreenShare}
                      className={`h-10 w-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        !canShareScreen
                          ? "opacity-35 cursor-not-allowed bg-white/5 text-white/30"
                          : isScreenSharing 
                          ? "bg-amber-500 text-slate-950 font-bold ring-4 ring-amber-400/40 shadow-lg shadow-amber-500/30 animate-pulse" 
                          : "bg-white/10 hover:bg-white/20 text-white/90"
                      }`}
                      title={
                        !canShareScreen
                          ? "Screen sharing is not supported by this browser. Please use a current version of Chrome, Edge, Firefox, or another supported browser."
                          : isScreenSharing
                          ? "Stop Sharing Screen"
                          : "Share Screen (Entire Screen, Window, or Tab)"
                      }
                      aria-label={isScreenSharing ? "Stop Sharing" : "Share Screen"}
                    >
                      {isScreenSharing ? <MonitorOff className="h-4 w-4 text-slate-950" /> : <MonitorUp className="h-4 w-4" />}
                    </button>

                    {/* Device Settings */}
                    <button 
                      onClick={() => setShowSettingsOverlay(true)}
                      className="h-10 w-10 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white/90 transition-all cursor-pointer"
                      title="Multimedia Settings"
                    >
                      <Settings className="h-4 w-4" />
                    </button>

                    {/* Chat Overlay Toggle */}
                    <button 
                      onClick={() => setIsOverlayChatOpen(prev => !prev)}
                      className={`h-10 w-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        isOverlayChatOpen ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25" : "bg-white/10 hover:bg-white/20 text-white/90"
                      }`}
                      title={isOverlayChatOpen ? "Close Chat Overlay" : "Open Chat Overlay"}
                    >
                      <MessageSquare className="h-4 w-4" />
                    </button>

                    {/* Fullscreen Toggle */}
                    <button 
                      onClick={toggleFullscreenMode}
                      className={`h-10 w-10 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        isFullscreen ? "bg-blue-600 text-white" : "bg-white/10 hover:bg-white/20 text-white/90"
                      }`}
                      title={isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
                    >
                      <Maximize2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Real-time Floating Chat Overlay */}
                  <AnimatePresence>
                    {isOverlayChatOpen && (
                      <motion.div 
                        initial={{ opacity: 0, x: 20, scale: 0.95 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 20, scale: 0.95 }}
                        transition={{ duration: 0.2 }}
                        className="absolute top-16 bottom-24 right-4 z-45 w-80 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-white/15 flex flex-col shadow-2xl overflow-hidden text-white font-sans pointer-events-auto text-left"
                      >
                        {/* Overlay Header */}
                        <div className="px-4 py-3 bg-white/5 border-b border-white/10 flex items-center justify-between shrink-0">
                          <div className="flex items-center gap-2">
                            <MessageSquare className="h-4 w-4 text-blue-400" />
                            <span className="text-xs font-extrabold tracking-tight">In-Call Live Chat</span>
                          </div>
                          <button 
                            type="button"
                            onClick={() => setIsOverlayChatOpen(false)}
                            className="p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
                            title="Close"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Overlay Messages Stream */}
                        <div className="flex-1 p-4 overflow-y-auto space-y-3 flex flex-col">
                          {messages.map((msg) => {
                            if (msg.isSystem) {
                              return (
                                <div key={msg.id} className="flex justify-center my-1">
                                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-[9px] font-bold text-center">
                                    {msg.sender} {msg.text}
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div 
                                key={msg.id} 
                                className={`flex flex-col max-w-[85%] ${msg.isYou ? "ml-auto items-end" : "items-start"}`}
                              >
                                <div className="flex items-center gap-1.5 px-1 mb-0.5">
                                  <span className="text-[9px] font-bold text-white/60">
                                    {msg.isYou ? "You" : msg.sender}
                                  </span>
                                  {msg.timestamp && (
                                    <span className="text-[8px] text-white/40 font-mono">
                                      {msg.timestamp}
                                    </span>
                                  )}
                                </div>
                                <div className={`px-3 py-2 rounded-xl text-xs leading-relaxed border shadow-sm ${
                                  msg.isYou 
                                    ? "bg-blue-600 text-white border-blue-500 rounded-tr-none text-right" 
                                    : "bg-white/10 text-white border-white/10 rounded-tl-none text-left"
                                }`}>
                                  <p className="whitespace-pre-wrap font-sans font-medium">{msg.text}</p>
                                </div>
                              </div>
                            );
                          })}
                          {isTyping && (
                            <div className="flex gap-2 items-center text-white/50 animate-pulse text-[10px] font-semibold pl-1">
                              <span>Amelia is typing</span>
                              <span className="flex gap-0.5 mt-1">
                                <span className="h-1 w-1 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                                <span className="h-1 w-1 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                                <span className="h-1 w-1 bg-white/50 rounded-full animate-bounce" style={{ animationDelay: '0.5s' }} />
                              </span>
                            </div>
                          )}
                          <div ref={overlayChatBottomRef} />
                        </div>

                        {/* Overlay Input Form */}
                        <form 
                          onSubmit={handleSendOverlayMessage}
                          className="p-3 border-t border-white/10 bg-white/5 flex items-center gap-2 shrink-0"
                        >
                          <input 
                            type="text"
                            value={overlayChatInput}
                            onChange={(e) => setOverlayChatInput(e.target.value)}
                            placeholder="Send a message during call..."
                            className="flex-1 bg-white/5 hover:bg-white/10 focus:bg-white/10 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/40 focus:outline-none focus:border-blue-500/50 transition-all font-medium"
                          />
                          <button 
                            type="submit"
                            disabled={!overlayChatInput.trim()}
                            className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-xl shadow-md shadow-blue-600/10 transition-colors cursor-pointer"
                          >
                            <Send className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* 2. Side Stacked Grid for Other Participants (Right, 30% width) - Premium styling with real portraits */}
                <div className="w-[30%] flex flex-col gap-3 h-full overflow-y-auto pr-1">
                  {participants.filter(p => p.id !== presenter.id).map((p) => {
                    const isSpeaking = p.status === "Active Speaker" && !p.isMuted;
                    return (
                      <div 
                        key={p.id}
                        onClick={() => setPinnedParticipantId(pinnedParticipantId === p.id ? null : p.id)}
                        className={`relative flex-1 rounded-2xl overflow-hidden bg-slate-800 border flex flex-col items-center justify-center min-h-[120px] transition-all cursor-pointer hover:scale-[1.03] shadow-md group ${
                          isSpeaking 
                            ? "border-blue-500 ring-4 ring-blue-500/20 shadow-blue-500/10" 
                            : "border-neutral-200 hover:border-neutral-400"
                        }`}
                      >
                        {/* High-fidelity camera feed preview or initials avatar */}
                        {p.id === "p1" && localStream && !isVideoOffLocal ? (
                          <video 
                            ref={setLocalVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="absolute inset-0 w-full h-full object-cover transform scale-x-[-1]"
                          />
                        ) : p.id !== "p1" && remoteStream && !p.isVideoOff ? (
                          <video 
                            ref={setRemoteVideoRef}
                            autoPlay
                            playsInline
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center p-2 text-center">
                            <div className="h-12 w-12 rounded-full flex items-center justify-center font-bold text-sm text-white bg-gradient-to-tr from-blue-600 to-indigo-600 shadow-lg">
                              {p.img}
                            </div>
                            <span className="text-[10px] text-neutral-400 mt-1 font-medium">{p.role}</span>
                          </div>
                        )}

                        {/* Name badge bottom left with glass style */}
                        <div className="absolute bottom-2.5 left-2.5 z-10 bg-black/45 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/5 flex items-center gap-1.5 shadow-sm text-white">
                          {isSpeaking && <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />}
                          <span className="text-[10px] font-bold font-sans">{p.name}</span>
                        </div>

                        {/* Speaker mute control top right */}
                        <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              const nextMute = !p.isMuted;
                              const targetIdMap: Record<string, string> = {
                                "p1": "Kate_Smith",
                                "p2": "Alexandra_Opalan",
                                "p3": "Amelia_Bada_Lee",
                                "p4": "Justin_Bieber"
                              };
                              const targetUserId = targetIdMap[p.id] || p.id;
                              emitMuteStatusChange("real_estate_proposal_review_group", targetUserId, nextMute);
                              
                              // Update local state for immediate feedback
                              setParticipants(prev => prev.map(pt => {
                                if (pt.id === p.id) {
                                  return {
                                    ...pt,
                                    isMuted: nextMute,
                                    status: nextMute ? "Muted" as const : "Listening" as const
                                  };
                                }
                                return pt;
                              }));
                            }}
                            className={`p-1.5 rounded-lg backdrop-blur-md border border-white/10 transition-all cursor-pointer ${
                              p.isMuted 
                                ? "bg-rose-600/85 text-white" 
                                : isSpeaking 
                                  ? "bg-blue-600/85 text-white shadow-sm shadow-blue-500/20" 
                                  : "bg-black/35 text-white hover:bg-black/55"
                            }`}
                            title={p.isMuted ? "Remote Unmute Participant" : "Remote Mute Participant"}
                          >
                            {p.isMuted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>
            );
          })() : (
            /* DISCONNECTED STATE VIEW */
            <div className="p-8 text-center flex flex-col items-center justify-center bg-neutral-50 w-full h-full">
              <div className="relative h-16 w-16 bg-gradient-to-tr from-[#0d9488] to-emerald-600 rounded-full flex items-center justify-center shadow-lg shadow-teal-500/20 mb-4 animate-pulse">
                <Phone className="h-8 w-8 text-white" />
              </div>
              <h4 className="text-base font-bold text-neutral-800 uppercase tracking-wider mb-2">
                Call Session Disconnected
              </h4>
              <p className="text-xs text-neutral-600 mt-1 max-w-sm mb-6 leading-relaxed">
                Review completed. You can re-establish the WebRTC tunnel to Marcus Aurelius and Alexandra Opalan at any time.
              </p>
              <button 
                onClick={handleStartCall}
                className="bg-[#0d9488] hover:bg-[#0f766e] text-white font-bold text-xs px-6 py-3 rounded-xl shadow-lg shadow-teal-500/15 flex items-center gap-2 transition-all cursor-pointer"
              >
                <Phone className="h-4 w-4" />
                <span>Reconnect to Call Space</span>
              </button>
            </div>
          )}

          {/* Settings Overlay Container */}
          <AnimatePresence>
            {showSettingsOverlay && (
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
                className="absolute inset-4 z-40 bg-white/95 backdrop-blur-lg rounded-2xl p-6 border border-neutral-250 text-neutral-800 flex flex-col justify-between overflow-y-auto"
              >
                <div>
                  <div className="flex items-center justify-between border-b border-neutral-200 pb-3 mb-4">
                    <span className="text-xs font-black uppercase tracking-wider text-teal-600">Pipeline & Multimedia Devices</span>
                    <button 
                      onClick={() => setShowSettingsOverlay(false)}
                      className="text-xs font-bold text-neutral-500 hover:text-neutral-800 cursor-pointer"
                    >
                      Close [X]
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-left">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wide">Mic Capture</label>
                      <select 
                        value={selectedMic}
                        onChange={(e) => setSelectedMic(e.target.value)}
                        className="bg-neutral-100 border border-neutral-200 text-xs text-neutral-800 p-2.5 rounded-lg focus:outline-none focus:border-teal-500 cursor-pointer"
                      >
                        <option value="default-mic">System Default Microphone</option>
                        <option value="external">External Focusrite Solo</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wide">Camera Input</label>
                      <select 
                        value={selectedCamera}
                        onChange={(e) => setSelectedCamera(e.target.value)}
                        className="bg-neutral-100 border border-neutral-200 text-xs text-neutral-800 p-2.5 rounded-lg focus:outline-none focus:border-teal-500 cursor-pointer"
                      >
                        <option value="default-cam">FHD Front Facing Lens</option>
                        <option value="external-hd">Logitech StreamCam HD</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wide">Speaker Monitor</label>
                      <select 
                        value={selectedSpeaker}
                        onChange={(e) => setSelectedSpeaker(e.target.value)}
                        className="bg-neutral-100 border border-neutral-200 text-xs text-neutral-800 p-2.5 rounded-lg focus:outline-none focus:border-teal-500 cursor-pointer"
                      >
                        <option value="default-speaker">Stereo Desktop Audio Output</option>
                        <option value="headphones">Connected Sennheiser Monitor</option>
                      </select>
                    </div>
                  </div>

                  <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 text-left mb-2">
                    <div className="flex items-center gap-2 mb-2">
                      <Terminal className="h-3.5 w-3.5 text-teal-600" />
                      <span className="text-[10px] font-mono uppercase text-teal-600 font-bold">STUN/TURN Interactive WebRTC Logs</span>
                    </div>
                    <div className="text-[10px] font-mono text-neutral-600 space-y-1">
                      <p>• [Signaling] WebSocket connected to real-time endpoint successfully.</p>
                      <p>• [ICE] Gathering candidates: STUN ok, TURN anycast gathered.</p>
                      <p>• [Pipeline] Secure ECC-AES 256 GCM encryption negotiated.</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-neutral-200">
                  <button 
                    onClick={() => setShowSettingsOverlay(false)}
                    className="bg-[#0d9488] hover:bg-[#0f766e] text-white font-bold text-xs px-4 py-2 rounded-lg cursor-pointer"
                  >
                    Save Changes
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Add User Modal */}
          <AnimatePresence>
            {showAddUserModal && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 flex items-center justify-center p-4"
              >
                <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-md" onClick={() => setShowAddUserModal(false)} />
                
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: 15 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 15 }}
                  transition={{ duration: 0.2 }}
                  className="w-full max-w-sm bg-white border border-neutral-200 rounded-3xl p-6 shadow-2xl relative z-10 text-neutral-900 text-left"
                >
                  <div className="flex items-center justify-between border-b border-neutral-200 pb-3 mb-4">
                    <span className="text-xs font-black uppercase tracking-wider text-teal-600">Add New Participant</span>
                    <button 
                      onClick={() => setShowAddUserModal(false)}
                      className="text-xs font-bold text-neutral-500 hover:text-neutral-800 cursor-pointer"
                    >
                      Close [X]
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[9px] font-bold text-neutral-500 uppercase tracking-wider mb-1.5">Participant Name</label>
                      <input 
                        type="text"
                        placeholder="Enter participant name..."
                        value={newParticipantName}
                        onChange={(e) => setNewParticipantName(e.target.value)}
                        className="w-full bg-neutral-50 border border-neutral-250 focus:border-teal-500 focus:outline-none rounded-xl px-3 py-2.5 text-xs text-neutral-800 font-sans"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-[9px] font-bold text-neutral-500 uppercase tracking-wider mb-1.5">Meeting Role</label>
                      <select
                        value={newParticipantRole}
                        onChange={(e) => setNewParticipantRole(e.target.value)}
                        className="w-full bg-neutral-50 border border-neutral-250 focus:border-teal-500 focus:outline-none rounded-xl px-3 py-2.5 text-xs text-neutral-800 cursor-pointer font-sans font-semibold"
                      >
                        <option value="Guest">Guest</option>
                        <option value="Co-host">Co-host</option>
                        <option value="Reviewer">Reviewer</option>
                        <option value="Lead Reviewer">Lead Reviewer</option>
                      </select>
                    </div>
                    
                    <div className="flex items-center gap-2 pt-2">
                      <button 
                        onClick={() => setShowAddUserModal(false)}
                        className="flex-1 px-4 py-2 rounded-xl border border-neutral-250 text-neutral-600 hover:text-neutral-800 hover:bg-neutral-50 text-xs font-bold transition-all cursor-pointer text-center font-sans"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={() => {
                          if (!newParticipantName.trim()) return;
                          const words = newParticipantName.trim().split(" ");
                          const initials = words.map(w => w[0]).join("").toUpperCase().substring(0, 2);
                          
                          const newP = {
                            id: `p-${Date.now()}`,
                            name: newParticipantName.trim(),
                            role: newParticipantRole,
                            img: initials,
                            status: "Listening" as const,
                            isMuted: false
                          };
                          setParticipants(prev => [...prev, newP]);
                          setNewParticipantName("");
                          setShowAddUserModal(false);
                          
                          setMessages(prev => [
                            ...prev,
                            {
                              id: `sys-${Date.now()}`,
                              sender: "[System]",
                              avatar: "",
                              text: `${newParticipantName.trim()} joined the call.`,
                              timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                              isSystem: true
                            }
                          ]);
                        }}
                        className="flex-1 bg-[#0d9488] hover:bg-[#0f766e] text-white font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition-all text-center cursor-pointer font-sans"
                      >
                        Add Participant
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>

                       {/* Bottom Audio Waveform and AI/Transcript interactive tab box */}
        <div className="mt-6 bg-white border border-neutral-200 rounded-2xl p-4 flex flex-col md:flex-row items-stretch justify-between gap-4 shadow-lg">
          
          {/* Left Tab Buttons for the helper card */}
          <div className="flex flex-wrap md:flex-col gap-1.5 shrink-0 border-r border-neutral-200 pr-4 justify-start">
            <button 
              onClick={() => setVoiceTab("assistant")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all text-left flex items-center gap-2 cursor-pointer ${
                voiceTab === "assistant" 
                  ? "bg-blue-600 text-white" 
                  : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI Assistant</span>
            </button>
            <button 
              onClick={() => setVoiceTab("transcript")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all text-left flex items-center gap-2 cursor-pointer ${
                voiceTab === "transcript" 
                  ? "bg-blue-600 text-white" 
                  : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100"
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              <span>Live Transcript</span>
            </button>
            <button 
              onClick={() => setVoiceTab("topics")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all text-left flex items-center gap-2 cursor-pointer ${
                voiceTab === "topics" 
                  ? "bg-blue-600 text-white" 
                  : "text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100"
              }`}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>Session Topics</span>
            </button>
          </div>

          {/* Right contents dependent on selected Tab */}
          <div className="flex-1 flex flex-col sm:flex-row items-center gap-4 text-left justify-between min-w-0">
            {voiceTab === "assistant" && (
              <div className="flex-1 animate-fade-in text-xs sm:text-sm">
                <span className="font-extrabold text-blue-600 text-[10px] tracking-wider uppercase block mb-1">AI Recommendation</span>
                <p className="text-neutral-700 leading-relaxed font-sans">
                  Christina raised a critical strategy concern. Highlighting last month's conversion ratios (4.8%) could strengthen the current argument.
                </p>
              </div>
            )}

            {voiceTab === "transcript" && (
              <div className="flex-1 flex items-center justify-between gap-4 animate-fade-in text-xs sm:text-sm">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Waveform visualization */}
                  <div className="flex items-end gap-1 h-8 shrink-0">
                    {visualizerHeights.slice(0, 10).map((h, i) => (
                      <span 
                        key={i} 
                        className="w-1 bg-blue-500 rounded-full transition-all duration-100"
                        style={{ height: isCallConnected ? `${h}px` : '4px' }}
                      />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <span className="font-extrabold text-neutral-500 text-[10px] tracking-wider uppercase block mb-1">{liveTranscriptSpeaker}</span>
                    <p className="text-neutral-800 truncate font-sans font-medium">
                      "{liveTranscriptText}"
                    </p>
                  </div>
                </div>

                <button 
                  onClick={handleDownloadTranscript}
                  className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] px-2.5 py-1.5 rounded-xl shadow transition-all cursor-pointer shrink-0"
                  title="Download full transcript as .txt file"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Download .txt</span>
                </button>
              </div>
            )}

            {voiceTab === "topics" && (
              <div className="flex-1 animate-fade-in text-xs">
                <span className="font-extrabold text-amber-600 text-[10px] tracking-wider uppercase block mb-1">Current Meeting Agenda</span>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  <span className="bg-neutral-100 border border-neutral-200 px-2 py-1 rounded-lg text-neutral-800 font-semibold">1. Revenue Strategy Review (Active)</span>
                  <span className="bg-neutral-50 border border-neutral-150 px-2 py-1 rounded-lg text-neutral-500">2. Q3 Product Roadmap</span>
                  <span className="bg-neutral-50 border border-neutral-150 px-2 py-1 rounded-lg text-neutral-500">3. Proposal Deliverables</span>
                </div>
              </div>
            )}

            {/* Quick action panel badge */}
            <div className="bg-blue-600/10 border border-blue-500/20 text-blue-600 px-3 py-1.5 rounded-xl font-bold text-[10px] tracking-wider uppercase flex items-center gap-1.5 self-center">
              <Shield className="h-3.5 w-3.5 text-blue-600" />
              <span>Real-time Secure</span>
            </div>
          </div>

        </div>

      </div>

      {/* RIGHT SIDEBAR: Group Chat / Participants list / Logs / Calendar */}
      {isChatOpen && (
        <div className="lg:col-span-4 flex flex-col bg-white border-l border-neutral-200 h-[620px] lg:h-auto shadow-lg">
        
        {/* Chat/Participants/Logs/My Meetings Sidebar Tabs */}
        <div className="p-4 border-b border-neutral-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-neutral-50/50">
          <h3 className="text-xs font-extrabold text-neutral-900 tracking-tight font-sans">
            {activeTab === "messages" && "Group Chat"}
            {activeTab === "participants" && "Participants"}
            {activeTab === "logs" && "My Meet & Greet"}
            {activeTab === "my_meetings" && "My Meeting"}
          </h3>

          <div className="flex bg-neutral-100 p-1 rounded-xl border border-neutral-200 overflow-x-auto max-w-full">
            <button 
              onClick={() => setActiveTab("messages")}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "messages" 
                  ? "bg-blue-600 text-white shadow" 
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              Messages
            </button>
            <button 
              onClick={() => setActiveTab("participants")}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "participants" 
                  ? "bg-blue-600 text-white shadow" 
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              People
            </button>
            <button 
              onClick={() => setActiveTab("logs")}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "logs" 
                  ? "bg-blue-600 text-white shadow" 
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              My Meet & Greet
            </button>
            <button 
              onClick={() => setActiveTab("my_meetings")}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === "my_meetings" 
                  ? "bg-blue-600 text-white shadow" 
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              My Meeting
            </button>
          </div>
        </div>

        {/* Tab 1: Messages active view */}
        {activeTab === "messages" && (
          <div className="flex-1 flex flex-col justify-between overflow-hidden">
            {/* Header with Expand Button */}
            <div className="px-4 py-2 bg-neutral-100/70 border-b border-neutral-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-neutral-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Real-Time Omnichannel Chat</span>
              </div>
              <button
                type="button"
                id="btn-expand-softphone-chat"
                onClick={() => setIsChatExpanded(true)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white hover:bg-neutral-50 text-blue-600 border border-blue-200 text-[10px] font-bold shadow-xs transition-all cursor-pointer"
                title="Expand chat to large canvas"
              >
                <Maximize2 className="h-3 w-3 text-blue-600" />
                <span>Expand</span>
              </button>
            </div>

            {/* Message stream container */}
            <div className="flex-1 p-5 overflow-y-auto space-y-4">
              {messages.map((msg) => {
                if (msg.isSystem) {
                  return (
                    <div key={msg.id} className="flex justify-center my-2 animate-fade-in">
                      <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 px-4 py-2 rounded-2xl flex items-center gap-2 text-[10px] font-bold shadow-sm">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span>{msg.sender} {msg.text}</span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div 
                    key={msg.id} 
                    className={`flex gap-3 max-w-[90%] ${msg.isYou ? "ml-auto flex-row-reverse" : ""}`}
                  >
                    {!msg.isYou && (
                      <div className="h-8 w-8 rounded-xl bg-blue-600/10 text-blue-600 border border-blue-500/20 font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
                        {msg.avatar}
                      </div>
                    )}

                    <div className={`flex flex-col gap-1 ${msg.isYou ? "items-end" : "items-start"}`}>
                      <div className="flex items-center gap-2 px-1">
                        {!msg.isYou ? (
                          <>
                            <span className="text-[10px] font-bold text-neutral-600">
                              {msg.sender}
                            </span>
                            {msg.recipient && msg.recipient !== "Everyone" && (
                              <span className="text-[8px] font-bold bg-amber-500/20 text-amber-600 px-1.5 py-0.2 rounded uppercase">
                                DM to You
                              </span>
                            )}
                            {msg.timestamp && (
                              <span className="text-[8px] text-neutral-400 font-mono">
                                {msg.timestamp}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {msg.recipient && msg.recipient !== "Everyone" && (
                              <span className="text-[8px] font-bold bg-blue-500/20 text-blue-600 px-1.5 py-0.2 rounded uppercase">
                                DM to {msg.recipient}
                              </span>
                            )}
                            {msg.timestamp && (
                              <span className="text-[8px] text-neutral-400 font-mono">
                                {msg.timestamp}
                              </span>
                            )}
                            <span className="text-[10px] font-bold text-neutral-500">
                              You
                            </span>
                          </>
                        )}
                      </div>
                      
                      <div className={`p-3 rounded-2xl shadow text-xs border leading-relaxed ${
                        msg.isYou 
                          ? "bg-blue-600 text-white border-blue-500 rounded-tr-none" 
                          : "bg-neutral-50 text-neutral-800 border-neutral-200 rounded-tl-none"
                      }`}>
                        <p className="whitespace-pre-wrap font-sans font-medium">{msg.text}</p>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Is typing indicator */}
              {isTyping && (
                <div className="flex gap-3 max-w-[85%] items-center animate-pulse">
                  <div className="h-8 w-8 rounded-xl bg-neutral-100 text-neutral-500 border border-neutral-200 font-bold text-xs flex items-center justify-center shrink-0">
                    AL
                  </div>
                  <div className="bg-neutral-50 border border-neutral-200 p-3 rounded-2xl flex items-center gap-1.5 text-xs text-neutral-500">
                    <span className="text-[10px] font-semibold">Amelia is typing</span>
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <span className="h-1.5 w-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                      <span className="h-1.5 w-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '0.5s' }} />
                    </span>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Chat message composer form */}
            <form 
              onSubmit={handleSendMessage}
              className="p-4 border-t border-neutral-200 bg-neutral-50 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2 px-1">
                <span className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide">To:</span>
                <select 
                  value={chatRecipient}
                  onChange={(e) => setChatRecipient(e.target.value)}
                  className="bg-white border border-neutral-200 text-[9px] font-bold text-neutral-600 rounded px-2 py-0.5 outline-none focus:border-blue-500/40 cursor-pointer"
                >
                  <option value="Everyone">Everyone</option>
                  {participants.filter(p => p.id !== "p1").map(p => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="relative flex-1 flex items-center gap-2.5">
                <input 
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={chatRecipient === "Everyone" ? "Write message..." : `DM to ${chatRecipient}...`}
                  className="w-full bg-white border border-neutral-200 rounded-2xl pl-4 pr-12 py-3.5 text-xs text-neutral-800 placeholder-neutral-400 focus:outline-none focus:border-blue-500/50 transition-all font-sans font-medium"
                />
                
                <button 
                  type="submit"
                  disabled={!chatInput.trim()}
                  className={`absolute right-1.5 top-1.5 p-2 rounded-xl flex items-center justify-center transition-all ${
                    chatInput.trim() 
                      ? "bg-blue-600 text-white shadow hover:bg-blue-700 cursor-pointer" 
                      : "bg-neutral-200 text-neutral-400 cursor-not-allowed"
                  }`}
                  title="Send message"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tab 2: Participants list view */}
        {activeTab === "participants" && (
          <div className="flex-1 p-5 overflow-y-auto space-y-4 flex flex-col justify-between">
            
            {/* Inline Form to Add Participant */}
            <div className="bg-neutral-50 rounded-2xl border border-neutral-200 p-4 shadow-sm space-y-3">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block">Add Participation</span>
              <div className="flex flex-col gap-2">
                <input 
                  type="text"
                  placeholder="Amelia Bada Lee"
                  value={newParticipantName}
                  onChange={(e) => setNewParticipantName(e.target.value)}
                  className="w-full bg-white border border-neutral-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-blue-500 font-sans font-semibold text-neutral-800 placeholder-neutral-450"
                />
                <div className="flex gap-2">
                  <select
                    value={newParticipantRole}
                    onChange={(e) => setNewParticipantRole(e.target.value)}
                    className="flex-1 bg-white border border-neutral-200 text-xs rounded-xl px-2.5 py-2 outline-none focus:border-blue-500 cursor-pointer font-sans font-bold text-neutral-600"
                  >
                    <option value="Guest">Guest</option>
                    <option value="Co-host">Co-host</option>
                    <option value="Reviewer">Reviewer</option>
                    <option value="Lead Reviewer">Lead Reviewer</option>
                  </select>
                  <button 
                    onClick={() => {
                      if (!newParticipantName.trim()) return;
                      const words = newParticipantName.trim().split(" ");
                      const initials = words.map(w => w[0]).join("").toUpperCase().substring(0, 2);
                      
                      const newP = {
                        id: `p-${Date.now()}`,
                        name: newParticipantName.trim(),
                        role: newParticipantRole,
                        img: initials,
                        status: "Listening" as const,
                        isMuted: false
                      };
                      setParticipants(prev => [...prev, newP]);
                      setNewParticipantName("");
                      
                      setMessages(prev => [
                        ...prev,
                        {
                          id: `sys-${Date.now()}`,
                          sender: "[System]",
                          avatar: "",
                          text: `${newParticipantName.trim()} joined the call.`,
                          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                          isSystem: true
                        }
                      ]);
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Currently in call list */}
            <div className="flex-1 space-y-3 mt-4 overflow-y-auto">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider block">Currently in call ({participants.length})</span>
              {participants.map((participant) => {
                const isLocalUser = participant.id === "p1";
                return (
                  <div key={participant.id} className="flex items-center justify-between p-3 rounded-2xl border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-600 font-bold text-xs flex items-center justify-center">
                        {participant.img}
                      </div>
                      <div className="flex flex-col text-left">
                        <span className="text-xs font-bold text-neutral-800">{participant.name}</span>
                        <span className="text-[10px] text-neutral-500 font-medium">{participant.role}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {!isLocalUser && (
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => {
                              const nextMute = !participant.isMuted;
                              const targetIdMap: Record<string, string> = {
                                "p1": "Kate_Smith",
                                "p2": "Alexandra_Opalan",
                                "p3": "Amelia_Bada_Lee",
                                "p4": "Justin_Bieber"
                              };
                              const targetUserId = targetIdMap[participant.id] || participant.id;
                              emitMuteStatusChange("real_estate_proposal_review_group", targetUserId, nextMute);

                              setParticipants(prev => prev.map(p => {
                                if (p.id === participant.id) {
                                  return { 
                                    ...p, 
                                    isMuted: nextMute,
                                    status: nextMute ? ("Muted" as const) : ("Listening" as const)
                                  };
                                }
                                return p;
                              }));
                            }}
                            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                              participant.isMuted 
                                ? "bg-rose-50/10 border-rose-500/20 text-rose-500" 
                                : "bg-white border-neutral-200 text-neutral-500 hover:text-neutral-800"
                            }`}
                            title={participant.isMuted ? "Unmute Participant" : "Mute Participant"}
                          >
                            {participant.isMuted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                          </button>

                          <button 
                            onClick={() => {
                              setParticipants(prev => prev.filter(p => p.id !== participant.id));
                              setMessages(prev => [
                                ...prev,
                                {
                                  id: `sys-kick-${Date.now()}`,
                                  sender: "[System]",
                                  avatar: "",
                                  text: `${participant.name} left the call.`,
                                  timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                                  isSystem: true
                                }
                              ]);
                            }}
                            className="p-1.5 rounded-lg border bg-white border-neutral-200 text-neutral-500 hover:text-rose-500 transition-all cursor-pointer"
                            title="Remove from call"
                          >
                            <PhoneOff className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 3: Signaling Logs & Transcript Pane */}
        {activeTab === "logs" && (
          <div className="flex-1 p-5 overflow-y-auto space-y-4 flex flex-col justify-between">
            {/* Top Export Action Bar */}
            <div className="flex flex-col gap-2.5 bg-neutral-50 p-3.5 rounded-2xl border border-neutral-200">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Session Artifact Exports</span>
              <div className="grid grid-cols-1 gap-2">
                {/* Download Transcript Button */}
                <button 
                  onClick={handleDownloadTranscript}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm transition-all cursor-pointer"
                  title="Download accumulated call transcript as .txt file"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Transcript (.txt)</span>
                </button>

                {/* Save Recording Button */}
                <button 
                  onClick={handleSaveRecording}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all cursor-pointer"
                  title="Save call recording package & sync to CRM calendar"
                >
                  <Save className="h-4 w-4" />
                  <span>Save Recording Package</span>
                </button>
              </div>
            </div>

            {/* Accumulated Transcript Dialogue List */}
            <div className="flex-1 space-y-3 overflow-y-auto max-h-[300px] pr-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Live Accumulated Transcript ({accumulatedTranscripts.length})</span>
                <span className="text-[9px] font-bold bg-blue-500/10 text-blue-600 border border-blue-500/20 px-2 py-0.5 rounded-full">Speech-to-Text Active</span>
              </div>

              {accumulatedTranscripts.map((item) => (
                <div key={item.id} className="bg-white p-3 rounded-2xl border border-neutral-200 shadow-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-neutral-900">{item.speaker}</span>
                    <span className="text-[9px] font-mono text-neutral-400">{item.timestamp}</span>
                  </div>
                  <p className="text-xs text-neutral-700 font-sans leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>

            {/* Real-time WebRTC Signaling Logs Terminal */}
            <div className="bg-slate-950 text-slate-200 p-3.5 rounded-2xl border border-slate-800 space-y-2 text-left">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="h-3.5 w-3.5 text-teal-400" />
                  <span className="text-[10px] font-mono uppercase font-bold text-teal-400">WebRTC Signaling Telemetry</span>
                </div>
                <RealTimeLatencyIndicator peerConnection={peerConnection} fallbackRtt={rtt || 24} />
              </div>

              <div className="text-[10px] font-mono space-y-1 text-slate-400 max-h-28 overflow-y-auto">
                <p className="text-emerald-400">• [ICE] Local candidate gathered: typ host srflx 192.168.1.45</p>
                <p className="text-blue-400">• [Signaling] SDP Offer/Answer exchanged via Socket.io endpoint</p>
                <p className="text-slate-300">• [MediaStream] Track kind: video (VP8 1080p @ 30fps), audio (Opus 48kHz)</p>
                <p className="text-amber-400">• [DisplayMedia] getDisplayMedia handler ready for peer replacement</p>
                <p className="text-indigo-400">• [Min-Heap #253 Priority Queue] Peak rooms: 3 • Bandwidth: 225 Mbps allocated on sfu-us-east-01</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: My Meeting & Saved Recordings Pane */}
        {activeTab === "my_meetings" && (
          <div className="flex-1 p-5 overflow-y-auto space-y-4 flex flex-col text-left">
            
            {/* Header info card */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl p-4 shadow-md space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-blue-200" />
                  <span className="text-xs font-black uppercase tracking-wider">My Meeting Recordings</span>
                </div>
                <span className="bg-white/20 text-white text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">
                  {savedRecordings.length} Saved
                </span>
              </div>
              <p className="text-xs text-blue-100 font-sans leading-relaxed">
                Recordings automatically populate here whenever you click <strong className="text-white font-bold">"Save Recording Package"</strong> during a call.
              </p>
            </div>

            {/* Saved Recordings Collection */}
            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {savedRecordings.length === 0 ? (
                <div className="text-center py-10 px-4 bg-neutral-50 rounded-2xl border border-dashed border-neutral-300">
                  <Video className="h-8 w-8 text-neutral-400 mx-auto mb-2" />
                  <span className="text-xs font-bold text-neutral-700 block">No saved meeting recordings yet</span>
                  <p className="text-[11px] text-neutral-500 mt-1">
                    Click "Save Recording Package" during any live WebRTC session to populate recordings here.
                  </p>
                </div>
              ) : (
                savedRecordings.map((rec) => (
                  <div key={rec.id} className="bg-white p-3.5 rounded-2xl border border-neutral-200 shadow-sm space-y-2.5 hover:border-blue-400 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center shrink-0">
                          <Play className="h-4 w-4 fill-blue-600 ml-0.5" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-extrabold text-neutral-900 truncate block">
                            {rec.title}
                          </span>
                          <span className="text-[10px] text-neutral-500 font-medium block">
                            {rec.date} • {rec.duration} • {rec.size}
                          </span>
                        </div>
                      </div>

                      <button 
                        onClick={() => {
                          const filtered = savedRecordings.filter(r => r.id !== rec.id);
                          setSavedRecordings(filtered);
                          try {
                            localStorage.setItem('my_meeting_recordings', JSON.stringify(filtered));
                          } catch (e) {
                            console.warn("Could not save to localStorage", e);
                          }
                        }}
                        className="p-1 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 cursor-pointer"
                        title="Delete recording"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Participant Tags */}
                    {rec.participants && rec.participants.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {rec.participants.map((p, idx) => (
                          <span key={idx} className="bg-neutral-100 border border-neutral-200 text-neutral-600 text-[9px] font-semibold px-2 py-0.5 rounded-md">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-1 border-t border-neutral-100">
                      <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Verified Package
                      </span>

                      <button 
                        onClick={handleDownloadTranscript}
                        className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-[10px] font-bold px-2 py-1 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
                      >
                        <Download className="h-3 w-3" />
                        <span>Transcript (.txt)</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

          </div>
        )}

        </div>
      )}

      {/* Secure Meeting Link Modal Overlay */}
      <AnimatePresence>
        {isLinkModalOpen && activeMeetingLink && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-neutral-200 overflow-hidden relative text-left"
            >
              {/* Close Button */}
              <button 
                onClick={() => setIsLinkModalOpen(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Header Icon & Title */}
              <div className="flex items-center gap-3 mb-4">
                <div className="h-11 w-11 rounded-2xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                  <ShieldCheck className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-neutral-900 tracking-tight font-sans">
                    Secure Meeting Link Generated
                  </h3>
                  <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1 mt-0.5">
                    <CheckCircle2 className="h-3 w-3" /> E2E Encrypted • WebRTC TLS 1.3
                  </span>
                </div>
              </div>

              <p className="text-xs text-neutral-600 mb-4 font-sans leading-relaxed">
                Your meeting link is ready. You can share it with colleagues and external participants, or join the secure room directly right now.
              </p>

              {/* Link Display Box */}
              <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-3.5 mb-5 space-y-2.5">
                <span className="text-[10px] font-extrabold text-neutral-400 uppercase tracking-wider block font-mono">
                  Shareable Meeting URL
                </span>
                <div className="flex items-center justify-between gap-2 bg-white border border-neutral-200 rounded-xl px-3 py-2 shadow-xs">
                  <span className="text-xs font-mono font-medium text-neutral-800 truncate select-all">
                    {activeMeetingLink.url}
                  </span>
                  <button 
                    onClick={handleShareLink}
                    className="text-blue-600 hover:text-blue-700 p-1.5 rounded-lg hover:bg-blue-50 transition-colors shrink-0 cursor-pointer"
                    title="Copy link to clipboard"
                  >
                    {copiedLink ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[11px] text-neutral-500 font-sans pt-1">
                  <span className="flex items-center gap-1">
                    <Lock className="h-3 w-3 text-neutral-400" /> Passcode: <strong className="font-mono text-neutral-800">{activeMeetingLink.passcode}</strong>
                  </span>
                  <span className="text-neutral-400">Expires: {activeMeetingLink.expiresIn}</span>
                </div>
              </div>

              {/* Action Buttons: Share Link OR Join Meeting */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  onClick={handleShareLink}
                  className="flex items-center justify-center gap-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-250 font-bold text-xs py-3 px-4 rounded-2xl transition-all shadow-sm cursor-pointer active:scale-95"
                >
                  <Share2 className="h-4 w-4 text-neutral-600" />
                  <span>{copiedLink ? "Link Copied!" : "Share Link"}</span>
                </button>

                <button
                  onClick={handleJoinMeetingFromLink}
                  className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs py-3 px-4 rounded-2xl transition-all shadow-md shadow-blue-600/25 cursor-pointer active:scale-95"
                >
                  <Video className="h-4 w-4" />
                  <span>Join Meeting</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Schedule Meeting & Date-Picker Modal Overlay */}
      <AnimatePresence>
        {isScheduleModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-neutral-200 overflow-hidden relative text-left"
            >
              {/* Close Button */}
              <button 
                onClick={() => setIsScheduleModalOpen(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>

              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="h-11 w-11 rounded-2xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                  <CalendarPlus className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-neutral-900 tracking-tight font-sans">
                    Schedule Future Meeting
                  </h3>
                  <span className="text-[11px] font-semibold text-neutral-500 block mt-0.5">
                    Select a date & time to create an event in calendar storage
                  </span>
                </div>
              </div>

              {/* Event Creation Form */}
              <form onSubmit={handleSaveScheduledEvent} className="space-y-3.5">
                {/* Meeting Title */}
                <div>
                  <label className="text-[11px] font-extrabold text-neutral-700 uppercase tracking-wider block mb-1">
                    Meeting Subject / Title
                  </label>
                  <input 
                    type="text" 
                    value={scheduleForm.title}
                    onChange={e => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                    placeholder="e.g. Gamma SLA Review & Alignment"
                    className="w-full bg-neutral-50 border border-neutral-250 rounded-xl px-3.5 py-2 text-xs font-medium text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    required
                  />
                </div>

                {/* Date and Time Picker Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-extrabold text-neutral-700 uppercase tracking-wider block mb-1">
                      Meeting Date
                    </label>
                    <div className="relative">
                      <input 
                        type="date" 
                        value={scheduleForm.date}
                        onChange={e => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                        className="w-full bg-neutral-50 border border-neutral-250 rounded-xl px-3 py-2 text-xs font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-extrabold text-neutral-700 uppercase tracking-wider block mb-1">
                      Time
                    </label>
                    <input 
                      type="time" 
                      value={scheduleForm.time}
                      onChange={e => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                      className="w-full bg-neutral-50 border border-neutral-250 rounded-xl px-3 py-2 text-xs font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
                      required
                    />
                  </div>
                </div>

                {/* Type & Contact Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-extrabold text-neutral-700 uppercase tracking-wider block mb-1">
                      Event Category
                    </label>
                    <select 
                      value={scheduleForm.type}
                      onChange={e => setScheduleForm({ ...scheduleForm, type: e.target.value as any })}
                      className="w-full bg-neutral-50 border border-neutral-250 rounded-xl px-3 py-2 text-xs font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
                    >
                      <option value="followup">Follow-up Call</option>
                      <option value="demo">Product Demo</option>
                      <option value="call">Client Consultation</option>
                      <option value="contract">Contract Review</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-extrabold text-neutral-700 uppercase tracking-wider block mb-1">
                      Primary Contact
                    </label>
                    <input 
                      type="text" 
                      value={scheduleForm.contact}
                      onChange={e => setScheduleForm({ ...scheduleForm, contact: e.target.value })}
                      placeholder="e.g. Dr. Marcus Aurelius"
                      className="w-full bg-neutral-50 border border-neutral-250 rounded-xl px-3.5 py-2 text-xs font-medium text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                </div>

                {/* Invitees */}
                <div>
                  <label className="text-[11px] font-extrabold text-neutral-700 uppercase tracking-wider block mb-1">
                    Invitees (Comma Separated)
                  </label>
                  <input 
                    type="text" 
                    value={scheduleForm.invitees}
                    onChange={e => setScheduleForm({ ...scheduleForm, invitees: e.target.value })}
                    placeholder="kate@meetlyze.io, marcus@enterprise.org"
                    className="w-full bg-neutral-50 border border-neutral-250 rounded-xl px-3.5 py-2 text-xs font-medium text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>

                {/* Agenda & Notes */}
                <div>
                  <label className="text-[11px] font-extrabold text-neutral-700 uppercase tracking-wider block mb-1">
                    Agenda & Notes
                  </label>
                  <textarea 
                    rows={2}
                    value={scheduleForm.notes}
                    onChange={e => setScheduleForm({ ...scheduleForm, notes: e.target.value })}
                    placeholder="Meeting objectives and topic overview..."
                    className="w-full bg-neutral-50 border border-neutral-250 rounded-xl px-3.5 py-2 text-xs font-medium text-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-neutral-100">
                  <button 
                    type="button"
                    onClick={() => setIsScheduleModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-neutral-250 text-neutral-700 font-bold text-xs hover:bg-neutral-100 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button 
                    type="submit"
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-md shadow-blue-600/25 transition-all cursor-pointer active:scale-95"
                  >
                    <CalendarPlus className="h-4 w-4" />
                    <span>Schedule Event</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
        {/* EXPANDABLE OMNICHANNEL TEXT CHAT MODAL OVERLAY */}
        {isChatExpanded && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-black/60 backdrop-blur-md animate-fade-in">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-3xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden shadow-2xl"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between bg-neutral-50 dark:bg-neutral-950/50 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-blue-600/10 text-blue-600 border border-blue-500/20 flex items-center justify-center shadow-inner">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-neutral-900 dark:text-white text-base">
                        Expanded Omnichannel Text Chat
                      </h3>
                      <span className="bg-emerald-500/15 text-emerald-600 border border-emerald-500/20 text-[10px] font-extrabold px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        LIVE SYNC
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Real-time interactive messaging stream powered by <code className="font-mono text-blue-600">sendChatMessage()</code>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const transcript = messages.map(m => `[${m.timestamp || ''}] ${m.sender}${m.recipient ? ` (to ${m.recipient})` : ''}: ${m.text}`).join('\n');
                      const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `softphone-chat-export-${Date.now()}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="p-2 rounded-xl text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-1 text-xs font-bold border border-neutral-200 dark:border-neutral-700"
                    title="Export text transcript"
                  >
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">Export</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsChatExpanded(false)}
                    className="p-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 transition-colors flex items-center gap-1 text-xs font-bold border border-neutral-300 dark:border-neutral-700 cursor-pointer"
                    title="Collapse to sidebar"
                  >
                    <Minimize2 className="h-4 w-4 text-blue-600" />
                    <span>Collapse</span>
                  </button>
                </div>
              </div>

              {/* Messages Body */}
              <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-neutral-50/50 dark:bg-neutral-950/30">
                {messages.map((msg) => {
                  if (msg.isSystem) {
                    return (
                      <div key={msg.id} className="flex justify-center my-3 animate-fade-in">
                        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-4 py-1.5 rounded-full flex items-center gap-2 text-xs font-bold shadow-xs">
                          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          <span>{msg.sender} {msg.text}</span>
                        </div>
                      </div>
                    );
                  }

                  const isYou = msg.isYou;

                  return (
                    <div 
                      key={msg.id} 
                      className={`flex gap-3 max-w-[80%] ${isYou ? "ml-auto flex-row-reverse" : ""}`}
                    >
                      {!isYou && (
                        <div className="h-9 w-9 rounded-2xl bg-blue-600/10 text-blue-600 border border-blue-500/20 font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
                          {msg.avatar}
                        </div>
                      )}

                      <div className={`flex flex-col gap-1 ${isYou ? "items-end" : "items-start"}`}>
                        <div className="flex items-center gap-2 px-1">
                          {!isYou ? (
                            <>
                              <span className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                                {msg.sender}
                              </span>
                              {msg.recipient && msg.recipient !== "Everyone" && (
                                <span className="text-[9px] font-extrabold bg-amber-500/20 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full uppercase font-mono">
                                  DM to You
                                </span>
                              )}
                              {msg.timestamp && (
                                <span className="text-[10px] text-neutral-400 font-mono">
                                  {msg.timestamp}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              {msg.recipient && msg.recipient !== "Everyone" && (
                                <span className="text-[9px] font-extrabold bg-blue-500/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full uppercase font-mono">
                                  DM to {msg.recipient}
                                </span>
                              )}
                              {msg.timestamp && (
                                <span className="text-[10px] text-neutral-400 font-mono">
                                  {msg.timestamp}
                                </span>
                              )}
                              <span className="text-xs font-bold text-neutral-500">
                                You
                              </span>
                            </>
                          )}
                        </div>

                        <div className={`p-4 rounded-3xl shadow-sm text-sm border leading-relaxed ${
                          isYou 
                            ? "bg-blue-600 text-white border-blue-500 rounded-tr-none" 
                            : "bg-white dark:bg-neutral-850 text-neutral-800 dark:text-neutral-100 border-neutral-200 dark:border-neutral-700 rounded-tl-none"
                        }`}>
                          <p className="whitespace-pre-wrap font-sans font-medium">{msg.text}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {isTyping && (
                  <div className="flex gap-3 max-w-[85%] items-center animate-pulse">
                    <div className="h-9 w-9 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-500 border border-neutral-200 dark:border-neutral-700 font-bold text-xs flex items-center justify-center shrink-0">
                      AL
                    </div>
                    <div className="bg-white dark:bg-neutral-850 border border-neutral-200 dark:border-neutral-700 p-3.5 rounded-2xl flex items-center gap-2 text-xs text-neutral-500">
                      <span className="text-xs font-semibold">Amelia is typing a response</span>
                      <span className="flex gap-1">
                        <span className="h-1.5 w-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                        <span className="h-1.5 w-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                        <span className="h-1.5 w-1.5 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '0.5s' }} />
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Canned Snippets */}
              <div className="px-6 py-2 bg-neutral-100 dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none">
                <span className="text-[10px] font-extrabold text-neutral-500 uppercase tracking-wider font-mono shrink-0 flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-amber-500" /> Canned:
                </span>
                {[
                  "Let's review the customer qualification data.",
                  "Understood! Updating CRM ticket status now.",
                  "WebRTC session latency is stable under 40ms.",
                  "Could you clarify the SLA requirements?",
                  "All changes synced to D1 and Cloudflare R2."
                ].map((snippet, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setChatInput(snippet)}
                    className="shrink-0 px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 hover:border-blue-400 text-neutral-600 dark:text-neutral-300 text-xs transition-colors cursor-pointer"
                  >
                    {snippet}
                  </button>
                ))}
              </div>

              {/* Expanded Chat Composer Form */}
              <form 
                onSubmit={handleSendMessage}
                className="p-5 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col gap-3 shrink-0"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-neutral-600 dark:text-neutral-400 uppercase tracking-wide">Recipient:</span>
                    <select 
                      value={chatRecipient}
                      onChange={(e) => setChatRecipient(e.target.value)}
                      className="bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 text-xs font-bold text-neutral-700 dark:text-neutral-200 rounded-xl px-3 py-1.5 outline-none focus:border-blue-500 cursor-pointer"
                    >
                      <option value="Everyone">📢 Everyone (Meeting Broadcast)</option>
                      {participants.filter(p => p.id !== "p1").map(p => (
                        <option key={p.id} value={p.name}>👤 {p.name} ({p.role})</option>
                      ))}
                    </select>
                  </div>
                  <span className="text-xs text-neutral-400 font-mono">
                    Dispatched via <code className="text-blue-500">sendChatMessage()</code>
                  </span>
                </div>

                <div className="relative flex items-center">
                  <input 
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={chatRecipient === "Everyone" ? "Write message to everyone on call..." : `Direct message to ${chatRecipient}...`}
                    className="w-full bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-2xl pl-5 pr-14 py-4 text-sm text-neutral-900 dark:text-white placeholder-neutral-400 focus:outline-none focus:border-blue-500 transition-all font-sans font-medium"
                  />
                  
                  <button 
                    type="submit"
                    id="btn-send-expanded-modal-chat"
                    disabled={!chatInput.trim()}
                    className={`absolute right-2 top-2 p-3 rounded-xl flex items-center justify-center transition-all ${
                      chatInput.trim() 
                        ? "bg-blue-600 text-white shadow-md hover:bg-blue-700 cursor-pointer" 
                        : "bg-neutral-200 dark:bg-neutral-800 text-neutral-400 cursor-not-allowed"
                    }`}
                    title="Send message"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Disconnect / Leave Confirmation Dialog Modal */}
      <AnimatePresence>
        {showDisconnectConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDisconnectConfirmModal(false)}
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
                  <PhoneOff className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">Disconnect Call?</h3>
                  <p className="text-xs text-neutral-400">Confirmation required to prevent accidental disconnection</p>
                </div>
              </div>

              <p className="text-xs text-neutral-300 leading-relaxed mb-6 bg-black/30 p-3.5 rounded-2xl border border-white/5">
                Are you sure you want to disconnect from this voice session? All active streams, screen shares, and SIP channels will be closed.
              </p>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDisconnectConfirmModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-bold text-neutral-300 hover:text-white transition-all cursor-pointer"
                >
                  Stay Connected
                </button>

                <button
                  type="button"
                  onClick={handleHangupCall}
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

    </div>
  );
}
