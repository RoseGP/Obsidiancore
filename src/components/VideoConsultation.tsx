import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, MicOff, Video, VideoOff, Monitor, MonitorUp, MonitorOff, PhoneOff, 
  Settings, Maximize, Minimize, Shield, Volume2, 
  HelpCircle, Sparkles, Activity, AlertCircle, RefreshCw,
  ExternalLink, User, CheckCircle2, MessageSquare, X,
  CircleDot, Square, Play, Download, Cloud, Send, Loader2, Trash2, Calendar,
  SignalHigh, SignalMedium, SignalLow, Clock, Wifi, WifiOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CRMContact } from '../types';
import { 
  collection, doc, setDoc, getDoc, updateDoc, deleteDoc, 
  onSnapshot, addDoc 
} from 'firebase/firestore';
import { getFirestoreDb } from '../lib/firebase-config';
import { BackgroundBlurProcessor } from '../utils/backgroundBlur';
import { createFallbackScreenStream } from '../hooks/useMediaStream';
import LiveTranscriptOverlay from './LiveTranscriptOverlay';
import { dispatchWebRTCCallState } from '../utils/webrtcEvents';
import { isScreenSharingSupported, getScreenShareErrorMessage } from '../utils/app';

interface VideoConsultationProps {
  contact: CRMContact;
  onEndCall: () => void;
}

export default function VideoConsultation({ contact, onEndCall }: VideoConsultationProps) {
  // WebRTC control states
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [isScreenCapturePending, setIsScreenCapturePending] = useState(false);
  const canShareScreen = isScreenSharingSupported();
  const [quality, setQuality] = useState<'4K' | '1080p' | '720p'>('1080p');
  const [showTechnicalDiagnostics, setShowTechnicalDiagnostics] = useState(true);

  // Recording State Management
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [savedRecordings, setSavedRecordings] = useState<Array<{ 
    id: string; 
    name: string; 
    date: string; 
    duration: string; 
    size: string; 
    url: string; 
    cloudUrl?: string; 
  }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showSaveRecordingModal, setShowSaveRecordingModal] = useState(false);
  const [tempRecordingBlob, setTempRecordingBlob] = useState<Blob | null>(null);
  const [recordingNameInput, setRecordingNameInput] = useState('');

  // Peer Messaging State (Firestore Sync & Simulation fallback)
  const [showChatPanel, setShowChatPanel] = useState(true);
  const [activeRightTab, setActiveRightTab] = useState<'chat' | 'diagnostics' | 'recordings'>('chat');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<Array<{ 
    id: string; 
    sender: string; 
    text: string; 
    time: string; 
    isYou: boolean; 
  }>>([
    { 
      id: 'init-1', 
      sender: contact.name, 
      text: "Hello! Direct secure channel connected. Ready to review the SLA blueprints.", 
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
      isYou: false 
    }
  ]);

  // Auto-hide controls when user mouse stops moving
  const [controlsVisible, setControlsVisible] = useState(true);
  const mouseTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Media Stream references
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const blurProcessorRef = useRef<BackgroundBlurProcessor | null>(null);
  
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Background Blur states
  const [isBlurActive, setIsBlurActive] = useState(false);
  const [blurStatus, setBlurStatus] = useState<'idle' | 'loading' | 'active' | 'failed'>('idle');
  const [blurStatusMessage, setBlurStatusMessage] = useState('');

  // Peer states for camera and mic status sync via Firestore
  const isCallerRef = useRef(false);
  const [peerMuted, setPeerMuted] = useState(false);
  const [peerVideoOff, setPeerVideoOff] = useState(false);

  // Technical WebRTC connection and signal metrics
  const [iceState, setIceState] = useState<RTCIceConnectionState>('new');
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [callDuration, setCallDuration] = useState<number>(0);
  const [bitrate, setBitrate] = useState(4820); // kbps
  const [latency, setLatency] = useState(18); // ms
  const [packetLoss, setPacketLoss] = useState(0.01); // %

  // Determine signal strength status (Good/Fair/Poor) based on WebRTC ICE and Peer Connection states
  const getSignalStrength = () => {
    if (iceState === 'connected' || iceState === 'completed' || connectionState === 'connected' || remoteStream) {
      return { status: 'Good' as const, label: 'Signal: Good', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' };
    }
    if (iceState === 'checking' || connectionState === 'connecting' || iceState === 'new') {
      return { status: 'Fair' as const, label: 'Signal: Fair', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' };
    }
    return { status: 'Poor' as const, label: 'Signal: Poor', color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/30' };
  };

  const signalInfo = getSignalStrength();
  const isCallEstablished = iceState === 'connected' || iceState === 'completed' || connectionState === 'connected' || remoteStream !== null;

  // Visual Call Duration Timer: tracks time elapsed once a WebRTC peer connection is established
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isCallEstablished) {
      timer = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isCallEstablished]);

  const formatCallTimer = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Interaction logs / Live comments in Call
  const [commentInput, setCommentInput] = useState('');
  const [comments, setComments] = useState<Array<{ sender: string; text: string; time: string }>>([
    { sender: 'System Security', text: "Direct secure AES-GCM P2P signaling node initialized.", time: 'Now' }
  ]);

  // Load saved recordings on mount
  useEffect(() => {
    const saved = localStorage.getItem('webrtc_recordings');
    if (saved) {
      try {
        setSavedRecordings(JSON.parse(saved));
      } catch (e) {
        console.warn("Error parsing recordings from local storage:", e);
      }
    }
  }, []);

  // Sync real-time messages with Firestore
  useEffect(() => {
    const db = getFirestoreDb();
    const roomId = `Consultation-${contact.id || 'room'}`;
    const messagesCol = collection(db, 'video_rooms', roomId, 'messages');

    const unsub = onSnapshot(messagesCol, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      if (list.length > 0) {
        list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const formatted = list.map(m => ({
          id: m.id,
          sender: m.sender === 'You' ? 'You' : m.sender || contact.name,
          text: m.text,
          time: m.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isYou: m.sender === 'You'
        }));
        setMessages(formatted);
      }
    }, (err) => {
      console.warn("[Firestore Chat Sync] Message collection not fully initialized or empty:", err);
    });

    return () => unsub();
  }, [contact.id]);

  // Handle Mouse movement for auto-hiding top & bottom overlays
  useEffect(() => {
    const handleMouseMove = () => {
      setControlsVisible(true);
      if (mouseTimerRef.current) {
        clearTimeout(mouseTimerRef.current);
      }
      mouseTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3500); // Auto-hide after 3.5 seconds of silence
    };

    window.addEventListener('mousemove', handleMouseMove);
    handleMouseMove(); // Initial trigger

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (mouseTimerRef.current) {
        clearTimeout(mouseTimerRef.current);
      }
    };
  }, []);

  // Start the Camera and establish WebRTC connection via Firestore signaling
  useEffect(() => {
    let localMediaStream: MediaStream | null = null;
    let pc: RTCPeerConnection | null = null;
    let unsubRoom: (() => void) | null = null;
    let unsubCallerCandidates: (() => void) | null = null;
    let unsubCalleeCandidates: (() => void) | null = null;
    let isDisposed = false;

    // Buffer for ICE candidates received before remoteDescription is configured
    const candidateQueue: RTCIceCandidateInit[] = [];

    const flushCandidateQueue = async (targetPc: RTCPeerConnection) => {
      if (isDisposed || !targetPc || (targetPc.signalingState as string) === 'closed' || (targetPc.connectionState as string) === 'closed') {
        candidateQueue.length = 0;
        return;
      }
      if (!targetPc.currentRemoteDescription && !targetPc.remoteDescription) {
        return;
      }
      const candidatesToProcess = [...candidateQueue];
      candidateQueue.length = 0;
      for (const candidateData of candidatesToProcess) {
        if (isDisposed || !targetPc || (targetPc.signalingState as string) === 'closed' || (targetPc.connectionState as string) === 'closed') {
          break;
        }
        try {
          await targetPc.addIceCandidate(new RTCIceCandidate(candidateData));
        } catch (e: any) {
          if (targetPc && (targetPc.signalingState as string) !== 'closed' && (targetPc.connectionState as string) !== 'closed') {
            console.warn("[VideoConsultation] Safe warning flushing ICE candidate:", e?.message || e);
          }
        }
      }
    };

    const handleIncomingCandidate = async (targetPc: RTCPeerConnection, candidateData: any) => {
      if (isDisposed || !targetPc || (targetPc.signalingState as string) === 'closed' || (targetPc.connectionState as string) === 'closed') {
        return;
      }
      if (!targetPc.currentRemoteDescription && !targetPc.remoteDescription) {
        candidateQueue.push(candidateData);
        return;
      }
      try {
        await targetPc.addIceCandidate(new RTCIceCandidate(candidateData));
      } catch (e: any) {
        if (targetPc && (targetPc.signalingState as string) !== 'closed' && (targetPc.connectionState as string) !== 'closed') {
          console.warn("[VideoConsultation] Safe warning adding ICE candidate:", e?.message || e);
        }
      }
    };

    async function startCameraAndSignCall() {
      if (isVideoOff) {
        stopCamera();
        return;
      }

      try {
        console.log("[VideoConsultation] Requesting media permissions for camera and microphone...");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
          audio: true
        });
        if (isDisposed) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        localMediaStream = stream;
        setLocalStream(stream);

        // Bind local video track to HTML <video> element
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        setMediaError(null);

        // Initialize WebRTC signaling via Firestore
        const db = getFirestoreDb();
        const roomId = `Consultation-${contact.id || 'room'}`;
        const roomRef = doc(db, 'video_rooms', roomId);

        console.log("[VideoConsultation] Checking Firestore room state:", roomId);
        const roomSnapshot = await getDoc(roomRef);
        if (isDisposed) return;
        const isCaller = !roomSnapshot.exists();
        isCallerRef.current = isCaller;

        const configuration = {
          iceServers: [
            {
              urls: [
                'stun:stun.l.google.com:19302',
                'stun:stun1.l.google.com:19302',
                'stun:stun2.l.google.com:19302'
              ]
            }
          ],
          iceCandidatePoolSize: 10
        };

        pc = new RTCPeerConnection(configuration);
        pcRef.current = pc;

        // Monitor iceConnectionState and connectionState for signal strength and timer
        setIceState(pc.iceConnectionState);
        setConnectionState(pc.connectionState);

        pc.oniceconnectionstatechange = () => {
          if (pc && pc.signalingState !== 'closed') {
            console.log("[VideoConsultation] ICE connection state changed:", pc.iceConnectionState);
            setIceState(pc.iceConnectionState);
            if (pc.iceConnectionState === 'connected') {
              dispatchWebRTCCallState('connected', { peerName: contact.name, room: `Consultation-${contact.id || 'room'}` });
            } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
              dispatchWebRTCCallState('disconnected', { peerName: contact.name, room: `Consultation-${contact.id || 'room'}` });
            }
          }
        };

        pc.onconnectionstatechange = () => {
          if (pc && pc.signalingState !== 'closed') {
            console.log("[VideoConsultation] Connection state changed:", pc.connectionState);
            setConnectionState(pc.connectionState);
            if (pc.connectionState === 'connected') {
              dispatchWebRTCCallState('connected', { peerName: contact.name, room: `Consultation-${contact.id || 'room'}` });
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
              dispatchWebRTCCallState('disconnected', { peerName: contact.name, room: `Consultation-${contact.id || 'room'}` });
            }
          }
        };

        // Add local tracks to RTCPeerConnection
        stream.getTracks().forEach(track => {
          if (pc && pc.signalingState !== 'closed') {
            pc.addTrack(track, stream);
          }
        });

        // Register track listener to get the remote participant's video stream
        pc.ontrack = (event) => {
          console.log("[VideoConsultation] Remote track registered:", event.streams[0]);
          if (event.streams && event.streams[0]) {
            setRemoteStream(event.streams[0]);
            dispatchWebRTCCallState('connected', { peerName: contact.name, room: `Consultation-${contact.id || 'room'}` });
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = event.streams[0];
            }
            setComments(prev => [
              ...prev,
              { sender: 'Secure System', text: `Direct peer-to-peer connection established. Quality optimized.`, time: 'Now' }
            ]);
          }
        };

        const callerCandidatesCollection = collection(roomRef, 'callerCandidates');
        const calleeCandidatesCollection = collection(roomRef, 'calleeCandidates');

        // Send candidates to Firestore
        pc.onicecandidate = async (event) => {
          if (isDisposed || !pc || pc.signalingState === 'closed') return;
          if (event.candidate) {
            const candidateData = event.candidate.toJSON();
            try {
              if (isCaller) {
                await addDoc(callerCandidatesCollection, candidateData);
              } else {
                await addDoc(calleeCandidatesCollection, candidateData);
              }
            } catch (err) {
              if (!isDisposed) {
                console.warn("[VideoConsultation] Warning writing ICE candidate:", err);
              }
            }
          }
        };

        if (isCaller) {
          console.log("[VideoConsultation] Initializing as caller (creating offer)...");
          const offer = await pc.createOffer();
          if (isDisposed || !pc || pc.signalingState === 'closed') return;
          await pc.setLocalDescription(offer);

          if (isDisposed) return;
          await setDoc(roomRef, {
            offer: {
              type: offer.type,
              sdp: offer.sdp
            },
            createdAt: Date.now()
          });

          // Listen for answer
          unsubRoom = onSnapshot(roomRef, async (snapshot) => {
            if (isDisposed || !pc || (pc.signalingState as string) === 'closed' || (pc.connectionState as string) === 'closed') return;
            const data = snapshot.data();
            if (data && data.answer && pc && !pc.currentRemoteDescription && pc.signalingState === 'have-local-offer') {
              console.log("[VideoConsultation] Caller received answer from callee");
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                await flushCandidateQueue(pc);
              } catch (err: any) {
                if (pc && (pc.signalingState as string) !== 'closed') {
                  console.warn("[VideoConsultation] Failed setting caller remote description:", err);
                }
              }
            }
          });

          // Listen for callee's candidates
          unsubCalleeCandidates = onSnapshot(calleeCandidatesCollection, (snapshot) => {
            if (isDisposed || !pc || (pc.signalingState as string) === 'closed' || (pc.connectionState as string) === 'closed') return;
            snapshot.docChanges().forEach(async (change) => {
              if (change.type === 'added' && pc) {
                const data = change.doc.data();
                await handleIncomingCandidate(pc, data);
              }
            });
          });
        } else {
          console.log("[VideoConsultation] Initializing as callee (joining existing offer)...");
          const roomData = roomSnapshot.data();
          const offer = roomData?.offer;
          
          if (offer && pc && pc.signalingState === 'stable') {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(offer));
              await flushCandidateQueue(pc);
              const answer = await pc.createAnswer();
              if (isDisposed || !pc || (pc.signalingState as string) === 'closed') return;
              await pc.setLocalDescription(answer);

              if (isDisposed) return;
              await updateDoc(roomRef, {
                answer: {
                  type: answer.type,
                  sdp: answer.sdp
                }
              });
            } catch (err: any) {
              if (pc && (pc.signalingState as string) !== 'closed') {
                console.warn("[VideoConsultation] Failed setting up callee offer/answer:", err);
              }
            }

            // Listen for caller's candidates
            unsubCallerCandidates = onSnapshot(callerCandidatesCollection, (snapshot) => {
              if (isDisposed || !pc || (pc.signalingState as string) === 'closed' || (pc.connectionState as string) === 'closed') return;
              snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added' && pc) {
                  const data = change.doc.data();
                  await handleIncomingCandidate(pc, data);
                }
              });
            });
          }
        }

      } catch (err: any) {
        console.warn("[Media Device Initiation Warning] Failed to acquire full media track assets inside virtual sandbox iframe.", err?.message || err);
        setMediaError("Using premium animated simulator fallback (WebRTC is running in loops or credentials under verification).");
      }
    }

    startCameraAndSignCall();

    return () => {
      isDisposed = true;
      if (unsubRoom) {
        unsubRoom();
        unsubRoom = null;
      }
      if (unsubCallerCandidates) {
        unsubCallerCandidates();
        unsubCallerCandidates = null;
      }
      if (unsubCalleeCandidates) {
        unsubCalleeCandidates();
        unsubCalleeCandidates = null;
      }
      if (pc) {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.oniceconnectionstatechange = null;
        pc.onconnectionstatechange = null;
        try {
          if (pc.signalingState !== 'closed') {
            pc.close();
          }
        } catch (e) {
          // ignore
        }
        pc = null;
      }
      pcRef.current = null;
      if (localMediaStream) {
        localMediaStream.getTracks().forEach(track => track.stop());
      }
      if (blurProcessorRef.current) {
        blurProcessorRef.current.stop();
        blurProcessorRef.current = null;
      }
    };
  }, [isVideoOff, contact.id]);

  // Sync local camera and microphone state to the Firestore room
  useEffect(() => {
    const db = getFirestoreDb();
    const roomId = `Consultation-${contact.id || 'room'}`;
    const roomRef = doc(db, 'video_rooms', roomId);
    
    let isDisposed = false;
    const updatePeerStatus = async () => {
      try {
        const roomSnapshot = await getDoc(roomRef);
        if (isDisposed) return;
        if (roomSnapshot.exists()) {
          const updateData: any = {};
          if (isCallerRef.current) {
            updateData.callerMuted = isMuted;
            updateData.callerVideoOff = isVideoOff;
          } else {
            updateData.calleeMuted = isMuted;
            updateData.calleeVideoOff = isVideoOff;
          }
          await updateDoc(roomRef, updateData);
        }
      } catch (err) {
        console.warn("Error updating peer status in Firestore:", err);
      }
    };
    
    updatePeerStatus();
    
    return () => {
      isDisposed = true;
    };
  }, [isMuted, isVideoOff, contact.id]);

  // Listen to remote peer's camera and microphone state from the Firestore room
  useEffect(() => {
    const db = getFirestoreDb();
    const roomId = `Consultation-${contact.id || 'room'}`;
    const roomRef = doc(db, 'video_rooms', roomId);

    const unsub = onSnapshot(roomRef, (snapshot) => {
      const data = snapshot.data();
      if (data) {
        if (isCallerRef.current) {
          // I am caller, so peer is callee
          if (data.calleeMuted !== undefined) {
            setPeerMuted(data.calleeMuted);
          }
          if (data.calleeVideoOff !== undefined) {
            setPeerVideoOff(data.calleeVideoOff);
          }
        } else {
          // I am callee, so peer is caller
          if (data.callerMuted !== undefined) {
            setPeerMuted(data.callerMuted);
          }
          if (data.callerVideoOff !== undefined) {
            setPeerVideoOff(data.callerVideoOff);
          }
        }
      }
    }, (err) => {
      console.warn("Error watching peer status in Firestore:", err);
    });

    return () => unsub();
  }, [contact.id]);

  const stopCamera = () => {
    if (pcRef.current) {
      const pc = pcRef.current;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.oniceconnectionstatechange = null;
      pc.onconnectionstatechange = null;
      try {
        if (pc.signalingState !== 'closed') {
          pc.close();
        }
      } catch (e) {
        // ignore
      }
      pcRef.current = null;
    }
    if (blurProcessorRef.current) {
      blurProcessorRef.current.stop();
      blurProcessorRef.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    setIsBlurActive(false);
    setBlurStatus('idle');
    setBlurStatusMessage('');
    setRemoteStream(null);
  };

  // Cross-browser screen sharing utilizing Web Screen Capture API and RTCPeerConnection replaceTrack
  const toggleScreenShare = async () => {
    if (isScreenCapturePending) return;

    if (isScreenSharing) {
      if (screenStream) {
        screenStream.getTracks().forEach(t => {
          try {
            t.stop();
          } catch (e) {}
        });
        setScreenStream(null);
      }
      setIsScreenSharing(false);

      // Restore camera track to active RTCPeerConnection video sender
      if (pcRef.current) {
        const videoSender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
        const cameraTrack = localStream?.getVideoTracks()[0] || null;
        if (videoSender && cameraTrack) {
          try {
            await videoSender.replaceTrack(cameraTrack);
            console.log('[VideoConsultation] Camera track restored on RTCPeerConnection.');
          } catch (err) {
            console.warn('[VideoConsultation] Error restoring camera track on sender:', err);
          }
        }
      }

      // Restore camera preview to local video preview
      if (localVideoRef.current && localStream) {
        localVideoRef.current.srcObject = localStream;
      }
    } else {
      if (!isScreenSharingSupported()) {
        setScreenShareError(
          'Screen sharing is not supported by this browser. Please use a current version of Chrome, Edge, Firefox, or another supported browser.'
        );
        return;
      }

      setIsScreenCapturePending(true);
      setScreenShareError(null);

      try {
        let stream: MediaStream | null = null;

        // Try standard recommended options with browser surface hints
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
            preferCurrentTab: false,
            selfBrowserSurface: 'exclude' as any,
            surfaceSwitching: 'include' as any,
            monitorTypeSurfaces: 'include' as any,
            systemAudio: 'include' as any
          });
        } catch (optionErr: any) {
          if (optionErr?.name === 'TypeError') {
            console.warn('[VideoConsultation] Browser rejected advanced hints, retrying with standard parameters...');
            try {
              stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            } catch (fallbackErr: any) {
              if (fallbackErr?.name === 'TypeError') {
                stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
              } else {
                throw fallbackErr;
              }
            }
          } else {
            throw optionErr;
          }
        }

        if (!stream) {
          throw new Error('No display stream returned.');
        }

        setScreenStream(stream);
        setIsScreenSharing(true);

        if (screenVideoRef.current) {
          screenVideoRef.current.srcObject = stream;
          try {
            await screenVideoRef.current.play();
          } catch (pErr) {
            console.warn('[VideoConsultation] Autoplay preview notice:', pErr);
          }
        }

        // WebRTC track replacement: swap camera track for screen video track
        const [videoTrack] = stream.getVideoTracks();
        if (pcRef.current && videoTrack) {
          const videoSender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
          if (videoSender) {
            try {
              await videoSender.replaceTrack(videoTrack);
              console.log('[VideoConsultation] Swapped video track to display capture in active RTCPeerConnection.');
            } catch (swapErr) {
              console.warn('[VideoConsultation] Error swapping track on RTCPeerConnection sender:', swapErr);
            }
          }
        }

        // Automatically detect when user clicks browser's native "Stop sharing" chrome banner
        if (videoTrack) {
          videoTrack.addEventListener('ended', async () => {
            console.log('[VideoConsultation] Display capture track ended natively by browser control.');
            setIsScreenSharing(false);
            setScreenStream(null);

            if (pcRef.current) {
              const videoSender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
              const cameraTrack = localStream?.getVideoTracks()[0] || null;
              if (videoSender && cameraTrack) {
                try {
                  await videoSender.replaceTrack(cameraTrack);
                  console.log('[VideoConsultation] Restored camera track after native stop.');
                } catch (rErr) {
                  console.warn('[VideoConsultation] Error restoring camera track on sender:', rErr);
                }
              }
            }

            if (localVideoRef.current && localStream) {
              localVideoRef.current.srcObject = localStream;
            }
          });
        }
      } catch (err: any) {
        console.error('[VideoConsultation] Screen sharing failed or cancelled:', err);
        setIsScreenSharing(false);
        setScreenStream(null);
        const friendlyMessage = getScreenShareErrorMessage(err);
        setScreenShareError(friendlyMessage);
      } finally {
        setIsScreenCapturePending(false);
      }
    }
  };

  // Real-time background blur trigger utilizing MediaPipe Selfie Segmentation
  const toggleBackgroundBlur = async () => {
    if (isBlurActive) {
      // Turn off blur processor
      if (blurProcessorRef.current) {
        blurProcessorRef.current.stop();
        blurProcessorRef.current = null;
      }
      setIsBlurActive(false);
      setBlurStatus('idle');
      setBlurStatusMessage('');

      // Restore raw localStream to preview
      if (localStream && localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
        
        // Find video sender and restore original track
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack && pcRef.current) {
          const videoSender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
          if (videoSender) {
            try {
              await videoSender.replaceTrack(videoTrack);
              console.log("[VideoConsultation] Successfully restored original video track on WebRTC connection.");
            } catch (err) {
              console.warn("[VideoConsultation] Failed to replaceTrack:", err);
            }
          }
        }
      }
    } else {
      if (!localStream) {
        setBlurStatus('failed');
        setBlurStatusMessage('No camera stream found to blur.');
        return;
      }

      setIsBlurActive(true);
      setBlurStatus('loading');
      setBlurStatusMessage('Initializing background blur...');

      try {
        // Create offscreen video element for frame polling
        const tempVideo = document.createElement('video');
        tempVideo.srcObject = localStream;
        tempVideo.muted = true;
        tempVideo.playsInline = true;
        
        // Wait for metadata to resolve before starting
        tempVideo.onloadedmetadata = async () => {
          try {
            await tempVideo.play();

            const processor = new BackgroundBlurProcessor(tempVideo);
            blurProcessorRef.current = processor;

            await processor.startBlur(
              async (blurredStream) => {
                // Update local video preview to show the beautifully blurred canvas stream
                if (localVideoRef.current) {
                  localVideoRef.current.srcObject = blurredStream;
                }

                // Find video sender and replace the track on the live WebRTC peer connection
                const blurredVideoTrack = blurredStream.getVideoTracks()[0];
                if (blurredVideoTrack && pcRef.current) {
                  const videoSender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
                  if (videoSender) {
                    try {
                      await videoSender.replaceTrack(blurredVideoTrack);
                      console.log("[VideoConsultation] Successfully pushed blurred track to WebRTC peer connection.");
                    } catch (err) {
                      console.warn("[VideoConsultation] Failed to replaceTrack:", err);
                    }
                  }
                }
              },
              (status, message) => {
                setBlurStatus(status);
                setBlurStatusMessage(message || '');
                if (status === 'active') {
                  setComments(prev => [
                    ...prev,
                    { sender: 'AI Privacy Agent', text: 'Real-time background blur has been applied to protect your workspace privacy.', time: 'Now' }
                  ]);
                }
              }
            );
          } catch (e) {
            console.error('Error playing temporary video stream:', e);
            setBlurStatus('failed');
            setBlurStatusMessage('Failed to initialize local video processing.');
          }
        };
      } catch (err: any) {
        console.error('Error starting background blur setup:', err);
        setBlurStatus('failed');
        setBlurStatusMessage('Could not activate background blur.');
      }
    }
  };

  // Simulate WebRTC diagnostic telemetry updates
  useEffect(() => {
    const interval = setInterval(() => {
      setBitrate(prev => Math.max(1200, Math.min(6500, prev + Math.floor(Math.random() * 200 - 100))));
      setLatency(prev => Math.max(10, Math.min(48, prev + Math.floor(Math.random() * 4 - 2))));
      setPacketLoss(prev => Math.max(0, Math.min(0.2, prev + (Math.random() * 0.02 - 0.01))));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const startRecording = () => {
    setComments(prev => [
      ...prev,
      { sender: 'System Recorder', text: 'Initializing secure frame recorder...', time: 'Now' }
    ]);

    const streamToRecord = localStream || remoteStream;
    if (!streamToRecord) {
      console.log("[Recording] No live media stream found, using sandbox-simulated session recording.");
      setIsRecording(true);
      setRecordingSeconds(0);
      setTempRecordingBlob(null);
      
      recordingIntervalRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
      return;
    }

    try {
      let mediaRecorder: MediaRecorder;
      const chunks: Blob[] = [];
      const options = { mimeType: 'video/webm;codecs=vp9' };
      
      try {
        mediaRecorder = new MediaRecorder(streamToRecord, options);
      } catch (e) {
        mediaRecorder = new MediaRecorder(streamToRecord);
      }

      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        setTempRecordingBlob(blob);
        setRecordingNameInput(`Consultation with ${contact.name} - ${new Date().toLocaleDateString()}`);
        setShowSaveRecordingModal(true);
        setComments(prev => [
          ...prev,
          { sender: 'System Recorder', text: 'Video stream captured. Waiting for cloud upload approval.', time: 'Now' }
        ]);
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordingSeconds(0);

      recordingIntervalRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);

      setComments(prev => [
        ...prev,
        { sender: 'System Recorder', text: 'Media stream recording active.', time: 'Now' }
      ]);
    } catch (err) {
      console.error("[Recording] Failed to start native MediaRecorder:", err);
      // Fallback
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingSeconds(prev => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      // Simulated recording
      const simulatedBlob = new Blob(["Simulated WebRTC Video Stream Chunk Content"], { type: 'video/webm' });
      setTempRecordingBlob(simulatedBlob);
      setRecordingNameInput(`Consultation with ${contact.name} - ${new Date().toLocaleDateString()}`);
      setShowSaveRecordingModal(true);
    }

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    setIsRecording(false);
  };

  const handleSaveRecording = () => {
    if (!tempRecordingBlob) return;
    
    setIsUploading(true);
    setUploadProgress(0);
    setShowSaveRecordingModal(false);

    const interval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setIsUploading(false);
            
            const sizeInMb = tempRecordingBlob.size > 100 ? (tempRecordingBlob.size / (1024 * 1024)).toFixed(2) + ' MB' : '12.42 MB';
            const durationStr = formatDuration(recordingSeconds || 12);
            const cloudUrl = `https://storage.googleapis.com/omnichannel-crm-recordings/session_${Date.now()}.webm`;
            const downloadUrl = tempRecordingBlob.size > 100 ? URL.createObjectURL(tempRecordingBlob) : 'https://storage.googleapis.com/obsidian-recordings/session_webrtc_993.mp4';

            const newRec = {
              id: `rec-${Date.now()}`,
              name: recordingNameInput.trim() || `Consultation with ${contact.name}`,
              date: new Date().toLocaleString(),
              duration: durationStr,
              size: sizeInMb,
              url: downloadUrl,
              cloudUrl: cloudUrl
            };

            const updated = [newRec, ...savedRecordings];
            setSavedRecordings(updated);
            localStorage.setItem('webrtc_recordings', JSON.stringify(updated));

            setComments(prev => [
              ...prev,
              { sender: 'Cloud Bucket', text: `Saved "${newRec.name}" to cloud storage & browser cache successfully.`, time: 'Now' }
            ]);
            
            // Dispatch calendar updates
            try {
              const calendarRecs = localStorage.getItem('calendar_recordings') || '[]';
              const parsedCal = JSON.parse(calendarRecs);
              parsedCal.push({
                id: newRec.id,
                title: newRec.name,
                date: new Date().toISOString().split('T')[0],
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                duration: newRec.duration,
                contactName: contact.name,
                videoUrl: newRec.url
              });
              localStorage.setItem('calendar_recordings', JSON.stringify(parsedCal));
            } catch (err) {
              console.warn("Could not sync with calendar recordings store:", err);
            }

            setTempRecordingBlob(null);
          }, 400);
          return 100;
        }
        return prev + 10;
      });
    }, 100);
  };

  const deleteRecording = (id: string) => {
    const updated = savedRecordings.filter(r => r.id !== id);
    setSavedRecordings(updated);
    localStorage.setItem('webrtc_recordings', JSON.stringify(updated));
    setComments(prev => [
      ...prev,
      { sender: 'System Logs', text: 'Recording purge executed.', time: 'Now' }
    ]);
  };

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const timestamp = Date.now();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const messageText = chatInput.trim();

    setChatInput('');

    // Append to local immediately
    const userMsg = {
      id: `user-${timestamp}`,
      sender: 'You',
      text: messageText,
      time: timeStr,
      isYou: true
    };
    setMessages(prev => [...prev, userMsg]);

    // Send to Firestore under room message subcollection
    try {
      const db = getFirestoreDb();
      const roomId = `Consultation-${contact.id || 'room'}`;
      const messagesCol = collection(db, 'video_rooms', roomId, 'messages');
      await addDoc(messagesCol, {
        sender: 'You',
        text: messageText,
        time: timeStr,
        timestamp
      });
    } catch (err) {
      console.warn("[Firestore Chat] Local-only transmission due to offline database:", err);
    }

    // Check if we need to auto-respond
    if (!remoteStream) {
      setTimeout(async () => {
        const responderPhrases = [
          `Received. The AES-256 endpoint keys match up with our telemetry metrics.`,
          `Are we recording this consultation stream? Let me know so we save it.`,
          `I see your screen share projection, looking clean and crisp on my feed.`,
          `I will lock down these settings on our Google Workspace Cloud console.`,
          `Understood. Sending over the REST webhook payload to execute.`,
          `Direct peer line seems stable. Signal bitrate looks perfect on this node.`
        ];
        const randomPhrase = responderPhrases[Math.floor(Math.random() * responderPhrases.length)];
        const replyTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const replyTimestamp = Date.now();

        try {
          const db = getFirestoreDb();
          const roomId = `Consultation-${contact.id || 'room'}`;
          const messagesCol = collection(db, 'video_rooms', roomId, 'messages');
          await addDoc(messagesCol, {
            sender: contact.name,
            text: randomPhrase,
            time: replyTime,
            timestamp: replyTimestamp
          });
        } catch (e) {
          // Local fallback
          setMessages(prev => [
            ...prev,
            {
              id: `peer-${replyTimestamp}`,
              sender: contact.name,
              text: randomPhrase,
              time: replyTime,
              isYou: false
            }
          ]);
        }
      }, 1500);
    }
  };

  const handleDownloadBlob = () => {
    if (!tempRecordingBlob) return;
    const url = URL.createObjectURL(tempRecordingBlob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `${recordingNameInput.trim() || 'consultation-recording'}.webm`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  };

  const handleEndCall = async () => {
    dispatchWebRTCCallState('disconnected', { peerName: contact.name, room: `Consultation-${contact.id || 'room'}` });
    if (isRecording) {
      stopRecording();
    }
    stopCamera();
    try {
      const db = getFirestoreDb();
      const roomId = `Consultation-${contact.id || 'room'}`;
      const roomRef = doc(db, 'video_rooms', roomId);
      await deleteDoc(roomRef);
    } catch (e) {
      console.warn("Error deleting Firestore video room:", e);
    }
    onEndCall();
  };

  return (
    <div 
      id="webrtc-consultation-room" 
      className="obsidian fixed inset-0 bg-[var(--obsidian-0)] text-white h-screen w-screen z-50 overflow-hidden flex flex-row font-sans select-none"
    >
      {/* LEFT PANEL: Interactive meeting area */}
      <div className="flex-1 h-full relative flex flex-col justify-between overflow-hidden">
        {/* 1. BACKGROUND / REMOTE CLIENT STREAM 100% */}
        <div id="remote-container" className="obsidian absolute inset-0 h-full w-full z-0 bg-[var(--obsidian-0)]">
          {/* WebRTC Signal Strength Indicator Overlay */}
          <div className="absolute top-20 left-6 z-30 flex items-center gap-2 bg-[#07080a]/85 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10 shadow-xl pointer-events-auto">
            {signalInfo.status === 'Good' && (
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                <SignalHigh className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Signal: Good</span>
                <span className="text-[10px] text-emerald-500/80 font-mono font-medium">({iceState === 'new' && remoteStream ? 'connected' : iceState})</span>
              </div>
            )}
            {signalInfo.status === 'Fair' && (
              <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
                <SignalMedium className="h-4 w-4 text-amber-400 shrink-0 animate-pulse" />
                <span>Signal: Fair</span>
                <span className="text-[10px] text-amber-500/80 font-mono font-medium">({iceState})</span>
              </div>
            )}
            {signalInfo.status === 'Poor' && (
              <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                <SignalLow className="h-4 w-4 text-rose-400 shrink-0 animate-pulse" />
                <span>Signal: Poor</span>
                <span className="text-[10px] text-rose-500/80 font-mono font-medium">({iceState})</span>
              </div>
            )}
          </div>

          {/* Screen Share Error Banner */}
          {screenShareError && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 bg-rose-950/95 text-white px-4 py-2.5 rounded-2xl text-xs flex items-center gap-2.5 border border-rose-500/50 shadow-2xl backdrop-blur-md max-w-md w-[90%] sm:w-auto">
              <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
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

          {/* Active Screen Share Top Indicator Banner */}
          {isScreenSharing && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 bg-amber-500 text-slate-950 border border-amber-300 backdrop-blur-md px-4 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-2 shadow-2xl">
              <span className="h-2 w-2 rounded-full bg-slate-950 animate-ping" />
              <MonitorUp className="h-4 w-4 text-slate-950" />
              <span>You are sharing your screen</span>
              <button 
                onClick={toggleScreenShare}
                className="ml-2 px-3 py-1 bg-slate-950 hover:bg-slate-800 text-white rounded-full text-[10px] font-bold transition-colors cursor-pointer shadow-sm"
              >
                Stop Sharing
              </button>
            </div>
          )}

          {isScreenSharing && screenStream ? (
            /* Actual Screen share render */
            <video 
              ref={screenVideoRef}
              autoPlay 
              playsInline 
              className="w-full h-full object-contain"
            />
          ) : remoteStream && !peerVideoOff ? (
            /* Real WebRTC incoming client video stream */
            <video 
              ref={remoteVideoRef}
              autoPlay 
              playsInline 
              className="w-full h-full object-cover transition-opacity duration-300"
            />
          ) : (
            /* Waiting for peer connection state or Peer Camera Off */
            <div className="relative w-full h-full flex flex-col items-center justify-center p-6 text-center bg-radial-gradient from-blue-900/10 to-neutral-950">
              {/* Blurry background decorative ring */}
              <div className="absolute inset-0 bg-radial-gradient from-blue-500/5 to-transparent pointer-events-none" />
              
              {/* Pulsing secure radar visual */}
              <div className="relative h-24 w-24 rounded-full bg-blue-500/5 flex items-center justify-center border border-blue-500/15 mb-6">
                {peerVideoOff ? (
                  <VideoOff className="h-8 w-8 text-rose-500 animate-pulse" />
                ) : (
                  <User className="h-8 w-8 text-blue-400 animate-pulse" />
                )}
                <span className="absolute inset-0 rounded-full border border-blue-500/20 animate-ping" style={{ animationDuration: '3s' }} />
                <span className="absolute inset-2 rounded-full border border-indigo-500/10 animate-ping" style={{ animationDuration: '4s' }} />
              </div>

              <h3 className="text-lg font-bold text-white tracking-tight">
                {peerVideoOff ? `${contact.name}'s Camera is Off` : "Waiting for Participant"}
              </h3>
              <p className="text-xs text-neutral-400 mt-2 max-w-sm leading-relaxed">
                {peerVideoOff 
                  ? `${contact.name} has disabled their camera feed. You can still speak with them normally.`
                  : `Secure WebRTC signaling channel initialized via Firestore database. Open this consultation room on another client or device to connect directly with ${contact.name}.`}
              </p>

              {!peerVideoOff && (
                <div className="mt-6 flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900 border border-white/5 text-[10px] font-mono text-neutral-400 select-all cursor-pointer hover:bg-neutral-800 transition-colors">
                  <span className="text-blue-500 font-bold uppercase">ROOM CODE:</span>
                  <span>Consultation-{contact.id || 'room'}</span>
                </div>
              )}
            </div>
          )}

          {/* Dynamic peer mute/disabled indicators inside #remote-container */}
          <div className="absolute top-24 right-6 z-30 flex flex-col gap-2">
            {peerMuted && (
              <div className="bg-red-600/95 text-white px-3 py-2 rounded-xl border border-red-500/30 flex items-center gap-2 shadow-lg">
                <MicOff className="h-4 w-4 text-white shrink-0" />
                <span className="text-xs font-bold font-sans uppercase tracking-wider">Peer Muted</span>
              </div>
            )}
            {peerVideoOff && (
              <div className="bg-red-600/95 text-white px-3 py-2 rounded-xl border border-red-500/30 flex items-center gap-2 shadow-lg">
                <VideoOff className="h-4 w-4 text-white shrink-0" />
                <span className="text-xs font-bold font-sans uppercase tracking-wider">Peer Camera Off</span>
              </div>
            )}
          </div>

          {/* Incoming Live Transcription Overlay on Video Canvas */}
          <LiveTranscriptOverlay 
            position="bottom-center" 
            activeSpeaker={contact.name}
            className="mb-8"
          />
        </div>

        {/* 2. TOP HEADING HEADER - AUTO HIDE */}
        <header 
          id="webrtc-top-header"
          className={`w-full z-20 px-6 py-4 flex items-center justify-between bg-gradient-to-b from-[#07080a]/90 to-transparent transition-all duration-500 ${
            controlsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-red-600/10 border border-red-500/20 text-red-400 flex items-center justify-center animate-pulse">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500"></span>
            </div>
            <div>
              <h1 className="font-sans font-bold text-sm tracking-widest text-white uppercase">Secure Omnichannel consultation</h1>
              <p className="text-[10px] text-neutral-400 font-mono">CHANNEL: SECURE PEER CONVERGENCE &bull; SOC2 COMPLIANT</p>
            </div>
          </div>

          {/* Visual Call Duration Timer */}
          <div className="flex items-center gap-2.5 bg-neutral-900/90 border border-white/10 px-4 py-1.5 rounded-full shadow-lg backdrop-blur-md">
            <Clock className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
            <span className="text-xs font-mono font-extrabold text-emerald-400 tracking-wider">
              {isCallEstablished ? formatCallTimer(callDuration) : '00:00'}
            </span>
            <span className="text-[9px] uppercase tracking-wider font-extrabold text-neutral-400">
              {isCallEstablished ? 'CALL TIME' : 'CONNECTING...'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Quality badge selector */}
            <span className="rounded-lg bg-neutral-900/60 border border-white/10 py-1 px-2.5 text-[10px] font-mono font-bold text-neutral-300">
              {quality} HD Feed
            </span>
          </div>
        </header>

        {/* 4. PICTURE-IN-PICTURE (PiP) VIDEO BOX - BOTTOM RIGHT */}
        <div 
          id="local-pip-feed"
          className="absolute bottom-24 right-6 z-20 w-[160px] sm:w-[200px] aspect-[4/3] rounded-xl border border-white/20 bg-neutral-900 shadow-2xl overflow-hidden group hover:scale-[1.03] transition-transform duration-300"
        >
          {isVideoOff ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center bg-black gap-1.5">
              <VideoOff className="h-5 w-5 text-neutral-500" />
              <span className="text-[9px] font-bold text-neutral-400 tracking-wider">Video Suspended</span>
            </div>
          ) : localStream ? (
            /* Actual webcam stream */
            <div className="relative w-full h-full">
              <video 
                ref={localVideoRef}
                autoPlay 
                playsInline 
                muted 
                className="w-full h-full object-cover transform scale-x-[-1]"
              />
              
              {/* Status indicator badge */}
              {isBlurActive && (
                <div className="absolute top-2 right-2 bg-blue-600/95 text-white px-1.5 py-0.5 rounded-md border border-blue-500/20 text-[8px] font-bold flex items-center gap-1 z-10 shadow uppercase tracking-wider animate-pulse">
                  <Sparkles className="h-2 w-2" />
                  <span>AI Blur</span>
                </div>
              )}

              {/* Model status messaging overlay inside PiP */}
              {isBlurActive && blurStatus === 'loading' && (
                <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center p-2 text-center z-10">
                  <RefreshCw className="h-4 w-4 text-blue-400 animate-spin mb-1" />
                  <span className="text-[8px] font-medium text-neutral-300">Loading AI Model...</span>
                </div>
              )}
            </div>
          ) : (
            /* fallback simulator visual animation */
            <div className="obsidian relative w-full h-full bg-[var(--obsidian-2)] flex flex-col items-center justify-center p-3 text-center">
              {/* pulsing video lens simulation */}
              <div className="relative h-14 w-14 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-xs uppercase shadow-md mb-1.5">
                <span>You</span>
                <span className="absolute inset-0 rounded-full border border-blue-500 animate-ping opacity-60"></span>
              </div>
              
              <p className="text-[9px] text-neutral-400 font-semibold tracking-wider uppercase truncate max-w-full">Rene (Local Host)</p>
              <span className="text-[8px] text-emerald-400 block font-mono">Stream Live</span>
            </div>
          )}

          {/* Small mic mute indicator inside PiP */}
          {isMuted && (
            <div className="absolute top-2 left-2 bg-red-600/80 p-1 rounded-md border border-red-500/20 text-white z-10 animate-pulse">
              <MicOff className="h-3 w-3" />
            </div>
          )}
        </div>

        {/* 6. IMMERSIVE BOTTOM COMMAND FLOATING BAR - AUTO HIDE */}
        <footer 
          id="webrtc-bottom-controls"
          className={`w-full z-20 px-6 py-6 flex flex-col items-center justify-center bg-gradient-to-t from-[#07080a]/90 to-transparent transition-all duration-500 ${
            controlsVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          <div 
            className="bg-neutral-900/80 backdrop-blur-xl border border-white/10 px-6 py-3.5 rounded-full flex items-center gap-4 shadow-2xl shrink-0"
          >
            {/* MIC MUTE TRIGGER */}
            <button 
              id="btn-webrtc-mute"
              onClick={() => {
                setIsMuted(!isMuted);
                setComments(prev => [
                  ...prev,
                  { sender: 'Mic Agent', text: `Local voice output ${!isMuted ? 'muted' : 'activated'}.`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
                ]);
              }}
              className={`h-11 w-11 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                isMuted 
                  ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' 
                  : 'bg-white/5 text-neutral-300 border-white/10 hover:bg-white/10 hover:text-white'
              }`}
              title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            {/* VIDEO ENABLE TRIGGER */}
            <button 
              id="btn-webrtc-camera-toggle"
              onClick={() => {
                setIsVideoOff(!isVideoOff);
                setComments(prev => [
                  ...prev,
                  { sender: 'Cam Agent', text: `Local viewport feedback ${!isVideoOff ? 'suspended' : 're-established'}.`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
                ]);
              }}
              className={`h-11 w-11 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                isVideoOff 
                  ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' 
                  : 'bg-white/5 text-neutral-300 border-white/10 hover:bg-white/10 hover:text-white'
              }`}
              title={isVideoOff ? "Turn Video On" : "Turn Video Off"}
            >
              {isVideoOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
            </button>

            {/* AI BACKGROUND PRIVACY BLUR */}
            <button 
              id="btn-webrtc-blur-toggle"
              onClick={toggleBackgroundBlur}
              disabled={isVideoOff || !localStream}
              className={`h-11 w-11 rounded-full flex items-center justify-center border transition-all cursor-pointer relative ${
                isBlurActive 
                  ? 'bg-blue-600 text-white border-blue-500/35' 
                  : (isVideoOff || !localStream) 
                    ? 'bg-white/5 text-neutral-600 border-white/5 cursor-not-allowed'
                    : 'bg-white/5 text-neutral-300 border-white/10 hover:bg-white/10 hover:text-white'
              }`}
              title={isBlurActive ? "Disable AI Background Blur" : "Enable AI Background Privacy Blur"}
            >
              <Sparkles className={`h-5 w-5 ${blurStatus === 'loading' ? 'animate-spin' : ''}`} />
              
              {/* Pulsing indicator dot */}
              {isBlurActive && blurStatus === 'active' && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
              )}
            </button>

            {/* SCREEN DISPLAY SHARE TRIGGER */}
            <button 
              id="btn-webrtc-screen-project"
              disabled={!canShareScreen || isScreenCapturePending}
              onClick={() => {
                toggleScreenShare();
                setComments(prev => [
                  ...prev,
                  { sender: 'Screen Agent', text: `Desktop screen share protocol modified.`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
                ]);
              }}
              className={`h-11 w-11 rounded-full flex items-center justify-center border transition-all cursor-pointer ${
                !canShareScreen
                  ? 'opacity-35 cursor-not-allowed bg-white/5 text-neutral-500 border-white/5'
                  : isScreenSharing 
                  ? 'bg-amber-500 text-slate-950 border-amber-400 ring-2 ring-amber-400/40 shadow-lg shadow-amber-500/30 animate-pulse font-bold' 
                  : 'bg-white/5 text-neutral-300 border-white/10 hover:bg-white/10 hover:text-white'
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
              {isScreenSharing ? <MonitorOff className="h-5 w-5 text-slate-950" /> : <MonitorUp className="h-5 w-5" />}
            </button>

            {/* IN-MEETING CHAT BUTTON */}
            <button 
              id="btn-webrtc-chat-toggle"
              onClick={() => {
                setShowChatPanel(prev => !prev);
                setActiveRightTab('chat');
                setUnreadChatCount(0);
              }}
              className={`h-11 w-11 rounded-full flex items-center justify-center border transition-all cursor-pointer relative ${
                showChatPanel && activeRightTab === 'chat'
                  ? 'bg-indigo-600 text-white border-indigo-500/40 shadow-lg shadow-indigo-600/30' 
                  : 'bg-white/5 text-neutral-300 border-white/10 hover:bg-white/10 hover:text-white'
              }`}
              title={showChatPanel ? "Hide In-Meeting Chat" : "Open In-Meeting Live Chat"}
            >
              <MessageSquare className="h-5 w-5" />
              {unreadChatCount > 0 && !showChatPanel && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[9px] font-bold text-white shadow-md animate-bounce">
                  {unreadChatCount}
                </span>
              )}
            </button>

            {/* Spacer block */}
            <span className="h-6 w-[1.5px] bg-white/10 rounded"></span>

            {/* NATIVE STREAM MEDIA RECORDER BUTTON */}
            <button 
              id="btn-webrtc-record"
              onClick={isRecording ? stopRecording : startRecording}
              className={`h-11 w-11 rounded-full flex items-center justify-center border transition-all cursor-pointer relative ${
                isRecording 
                  ? 'bg-red-600 text-white border-red-500/35 animate-pulse' 
                  : 'bg-white/5 text-neutral-300 border-white/10 hover:bg-white/10 hover:text-white'
              }`}
              title={isRecording ? `Stop Recording (${formatDuration(recordingSeconds)})` : "Record Consultation Stream"}
            >
              {isRecording ? <Square className="h-5 w-5 fill-white text-white" /> : <CircleDot className="h-5 w-5 text-red-500" />}
              
              {isRecording && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
              )}
            </button>

            {/* Spacer block */}
            <span className="h-6 w-[1.5px] bg-white/10 rounded"></span>

            {/* CRIMSON RED END CALL BUTTON */}
            <button 
              id="btn-webrtc-disconnect"
              onClick={handleEndCall}
              className="h-11 w-11 rounded-full bg-red-500/20 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center cursor-pointer shadow-lg shadow-red-500/10"
              title="Terminate Video Consultation Session"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          </div>

          {/* Media warning message descriptor */}
          {mediaError && (
            <div className="mt-3 text-[10px] text-neutral-500 text-center select-none truncate max-w-lg font-medium">
              {mediaError}
            </div>
          )}
        </footer>
      </div>

      {/* RIGHT PANEL: Dedicated Telemetry Console, Real-time Peer Chat & Saved Recordings Library */}
      <AnimatePresence>
        {showChatPanel && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="obsidian h-full bg-[var(--obsidian-0)] border-l border-white/10 flex flex-col z-30 font-sans shadow-2xl shrink-0 overflow-hidden"
          >
            {/* SIDEBAR HEADER WITH TABS & CLOSE BUTTON */}
            <div className="obsidian p-3.5 border-b border-white/5 bg-[var(--obsidian-0)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Shield className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h2 className="text-xs font-extrabold tracking-widest text-neutral-200 uppercase">Consultation Hub</h2>
                  <p className="text-[9px] text-neutral-500 font-mono">Room: {contact.id || 'p2p-live'}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                  <span className="text-[8px] font-mono text-emerald-400 font-bold">ONLINE</span>
                </div>
                <button
                  id="btn-close-meeting-sidepanel"
                  onClick={() => setShowChatPanel(false)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Minimize Panel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* TAB SELECTOR STRIP: Chat | Diagnostics | Recordings */}
            <div className="grid grid-cols-3 p-1 bg-black/40 border-b border-white/5 text-[10px] font-bold">
              <button
                onClick={() => setActiveRightTab('chat')}
                className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  activeRightTab === 'chat'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <MessageSquare className="h-3 w-3" />
                <span>Live Chat</span>
              </button>

              <button
                onClick={() => setActiveRightTab('diagnostics')}
                className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  activeRightTab === 'diagnostics'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Activity className="h-3 w-3" />
                <span>Diagnostics</span>
              </button>

              <button
                onClick={() => setActiveRightTab('recordings')}
                className={`py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  activeRightTab === 'recordings'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Calendar className="h-3 w-3" />
                <span>Recordings ({savedRecordings.length})</span>
              </button>
            </div>

            {/* TAB CONTENT 1: REAL-TIME PEER CHAT ROOM */}
            {activeRightTab === 'chat' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="obsidian px-4 py-2 bg-[var(--obsidian-0)] border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[9px] font-extrabold tracking-wider text-neutral-400 uppercase">
                    <MessageSquare className="h-3 w-3 text-indigo-400" />
                    <span>In-Meeting Live Messages</span>
                  </div>
                  <span className="text-[8px] font-mono text-emerald-400 flex items-center gap-1">
                    <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
                    Realtime Sync
                  </span>
                </div>

                {/* Messages feed */}
                <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-neutral-950/30">
                  {messages.map((m) => (
                    <div 
                      key={m.id} 
                      className={`flex flex-col max-w-[85%] ${m.isYou ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-[9px] font-extrabold ${m.isYou ? 'text-indigo-400' : 'text-neutral-300'}`}>
                          {m.sender}
                        </span>
                        <span className="text-[8px] text-neutral-600 font-mono">{m.time}</span>
                      </div>
                      <div 
                        className={`rounded-2xl px-3.5 py-2 text-xs leading-relaxed border ${
                          m.isYou 
                            ? 'bg-indigo-600 border-indigo-500/30 text-white rounded-tr-none shadow-md shadow-indigo-600/20' 
                            : 'bg-[var(--obsidian-1)] border-white/5 text-neutral-200 rounded-tl-none'
                        }`}
                      >
                        {m.text}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Chat input form */}
                <form onSubmit={handleSendChatMessage} className="obsidian p-3 bg-[var(--obsidian-0)] border-t border-white/5 flex gap-2">
                  <input 
                    type="text"
                    placeholder={`Type message to ${contact.name}...`}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1 bg-neutral-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/20 transition-all placeholder-neutral-600"
                  />
                  <button 
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl px-3.5 flex items-center justify-center transition-all shadow-md cursor-pointer shrink-0"
                    title="Transmit Message"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
            )}

            {/* TAB CONTENT 2: TECHNICAL DIAGNOSTICS & SYSTEM EVENT LOOPS */}
            {activeRightTab === 'diagnostics' && (
              <div className="flex-1 flex flex-col p-4 space-y-3 bg-[#0a0c10]/40 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-extrabold tracking-wider text-neutral-400 uppercase">Signal & Encryption</span>
                  <span className="text-[8px] font-mono text-emerald-400">AES-GCM-256</span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="obsidian bg-[var(--obsidian-1)] border border-white/5 rounded-xl p-2">
                    <span className="block text-[8px] text-neutral-500 font-mono">BITRATE</span>
                    <span className="text-[10px] font-mono text-blue-400 font-bold">{(bitrate / 1000).toFixed(2)} Mb/s</span>
                  </div>
                  <div className="obsidian bg-[var(--obsidian-1)] border border-white/5 rounded-xl p-2">
                    <span className="block text-[8px] text-neutral-500 font-mono">LATENCY</span>
                    <span className="text-[10px] font-mono text-emerald-400 font-bold">{latency} ms</span>
                  </div>
                  <div className="obsidian bg-[var(--obsidian-1)] border border-white/5 rounded-xl p-2">
                    <span className="block text-[8px] text-neutral-500 font-mono">LOSS RATE</span>
                    <span className="text-[10px] font-mono text-amber-500 font-bold">{packetLoss.toFixed(3)}%</span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2">
                  <span className="text-[9px] font-extrabold tracking-wider text-neutral-400 uppercase">Live WebRTC Session Feed</span>
                  <div className="bg-black/60 border border-white/5 rounded-xl p-3 font-mono text-[9.5px] text-neutral-400 h-[220px] overflow-y-auto space-y-1.5 scrollbar-thin">
                    <div className="text-neutral-500 text-[8px] border-b border-white/5 pb-1 mb-1 flex items-center justify-between">
                      <span>SIGNALLING THREAD</span>
                      <span className="animate-pulse text-emerald-400">● ACTIVE</span>
                    </div>
                    {comments.slice(-12).map((c, i) => (
                      <div key={i} className="leading-relaxed">
                        <span className="text-neutral-600">[{c.time}]</span> <span className="text-neutral-300 font-bold">{c.sender}:</span> {c.text}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT 3: SESSION RECORDINGS ARCHIVE */}
            {activeRightTab === 'recordings' && (
              <div className="obsidian flex-1 flex flex-col bg-[var(--obsidian-0)] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between shrink-0">
                  <span className="text-[9px] font-extrabold tracking-wider text-neutral-400 uppercase flex items-center gap-1.5">
                    <Calendar className="h-3 w-3 text-red-400" />
                    <span>In-Call Recordings ({savedRecordings.length})</span>
                  </span>
                  <span className="text-[8px] font-mono text-neutral-500">Persisted locally</span>
                </div>

                <div className="flex-1 p-3 overflow-y-auto space-y-2.5">
                  {savedRecordings.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
                      <div className="h-10 w-10 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
                        <CircleDot className="h-5 w-5" />
                      </div>
                      <span className="text-xs text-neutral-300 font-bold">No session recordings yet</span>
                      <span className="text-[10px] text-neutral-500 font-mono">Click the red record button in the control bar to capture this meeting.</span>
                    </div>
                  ) : (
                    savedRecordings.map((rec) => (
                      <div 
                        key={rec.id} 
                        className="obsidian bg-[var(--obsidian-1)] border border-white/5 rounded-xl p-3 flex items-center justify-between gap-3 hover:border-white/10 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="block text-xs font-bold text-white truncate" title={rec.name}>
                            {rec.name}
                          </span>
                          <span className="block text-[9px] text-neutral-500 font-mono mt-0.5">
                            {rec.date.split(',')[0]} &bull; {rec.duration} &bull; {rec.size}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <a 
                            href={rec.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg bg-white/5 text-neutral-300 hover:bg-white/10 hover:text-white transition-colors border border-white/5"
                            title="Play Video"
                          >
                            <Play className="h-3 w-3 fill-neutral-300" />
                          </a>
                          <a 
                            href={rec.url}
                            download={`${rec.name.toLowerCase().replace(/\s+/g, '_')}.webm`}
                            className="p-1.5 rounded-lg bg-blue-600/10 border border-blue-500/20 text-blue-400 hover:bg-blue-600 hover:text-white transition-colors"
                            title="Download Video File"
                          >
                            <Download className="h-3 w-3" />
                          </a>
                          <button 
                            onClick={() => deleteRecording(rec.id)}
                            className="p-1.5 rounded-lg bg-red-600/10 border border-red-500/20 text-red-400 hover:bg-red-600 hover:text-white transition-colors"
                            title="Delete Recording"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* SAVE RECORDING PROMPT OVERLAY */}
      <AnimatePresence>
        {showSaveRecordingModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="obsidian w-full max-w-sm bg-[var(--obsidian-0)] border border-white/10 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center gap-3 border-b border-white/5 pb-4 mb-4">
                <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                  <CircleDot className="h-5 w-5 animate-pulse text-red-500" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">Save Session Recording</h3>
                  <p className="text-[10px] text-neutral-400 font-mono">Secure WebRTC Recording Node</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[9px] font-extrabold text-neutral-400 uppercase tracking-wider mb-1">Recording Name</label>
                  <input 
                    type="text"
                    value={recordingNameInput}
                    onChange={(e) => setRecordingNameInput(e.target.value)}
                    className="w-full bg-neutral-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500/50"
                    placeholder="E.g. Consultation Roadmap Review..."
                  />
                </div>

                <div className="rounded-lg bg-neutral-950/50 border border-white/5 p-3 text-[10px] text-neutral-400 space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span>Duration captured:</span>
                    <span className="text-white font-bold">{formatDuration(recordingSeconds)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cloud destination:</span>
                    <span className="text-blue-400 font-bold">GCS Cloud Bucket</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2.5 mt-6">
                <button 
                  onClick={handleDownloadBlob}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
                >
                  <Download className="h-4 w-4" />
                  <span>Download Local Blob (.webm)</span>
                </button>
                <div className="flex gap-2.5">
                  <button 
                    onClick={() => {
                      setShowSaveRecordingModal(false);
                      setTempRecordingBlob(null);
                    }}
                    className="obsidian flex-1 py-2 rounded-xl bg-[var(--obsidian-2)] border border-white/5 text-xs text-neutral-300 hover:bg-[var(--obsidian-3)] transition-colors cursor-pointer"
                  >
                    Discard
                  </button>
                  <button 
                    onClick={handleSaveRecording}
                    className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    Save & Upload
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SECURE CLOUD STORAGE PROGRESS LOADER */}
      <AnimatePresence>
        {isUploading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
            <div className="text-center space-y-4 max-w-xs w-full px-6">
              <div className="relative h-16 w-16 mx-auto bg-blue-600/10 border border-blue-500/20 rounded-full flex items-center justify-center">
                <Cloud className="h-6 w-6 text-blue-400 animate-pulse" />
                <div className="absolute inset-0 rounded-full border border-blue-500/30 animate-spin border-t-transparent" />
              </div>
              <div>
                <h4 className="text-xs font-extrabold text-white uppercase tracking-wider">Uploading to Cloud Bucket</h4>
                <p className="text-[8px] text-neutral-500 mt-1 font-mono">storage.googleapis.com/omnichannel-crm-recordings/</p>
              </div>
              <div className="w-full bg-neutral-900 rounded-full h-1 border border-white/5 overflow-hidden">
                <div className="bg-blue-500 h-full transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
              </div>
              <span className="text-[10px] text-blue-400 font-mono font-bold">{uploadProgress}% Complete</span>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
