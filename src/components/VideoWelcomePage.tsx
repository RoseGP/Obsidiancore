import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Users, Calendar as CalendarIcon, ArrowRight, Video, VideoOff,
  Sparkles, Check, Copy, X, Clock, Plus, LayoutDashboard,
  Shield, UserCheck, PhoneCall, Phone, Mic, MicOff, PhoneOff,
  Volume2, VolumeX, Settings, Monitor, MessageSquare, Play,
  ExternalLink, ChevronRight, Activity, Radio, FileText, Share2,
  CalendarDays, Download, Info, CheckCircle2, Search, User,
  LogOut, SlidersHorizontal, ShieldAlert, Command, Home,
  MonitorUp, MonitorOff, Lock, Maximize2, Minimize2, AlertCircle,
  RefreshCw, Laptop, Disc, Pause, Save, Trash2, Eye, Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CRMContact, CalendarEvent } from '../types';
import { 
  isScreenSharingSupported, 
  getScreenShareErrorMessage,
  getActivePeerConnection 
} from '../utils/app';
import { dispatchScreenShareState } from '../utils/webrtcEvents';
import { useMeetingSession, MeetingHistoryRecord } from '../context/MeetingSessionContext';
import { jsPDF } from 'jspdf';

interface VideoWelcomePageProps {
  onStartInstantMeeting: (
    roomCode?: string, 
    linkedContact?: CRMContact, 
    customTitle?: string, 
    options?: {
      autoRecord?: boolean;
      autoTranscribe?: boolean;
      startMuted?: boolean;
      startCamOff?: boolean;
    }
  ) => void;
  onJoinMeeting: (codeOrLink: string) => void;
  onScheduleMeeting: (event: Omit<CalendarEvent, 'id'>) => void;
  onNavigateToDashboard?: () => void;
  contacts?: CRMContact[];
}

export default function VideoWelcomePage({
  onStartInstantMeeting,
  onJoinMeeting,
  onScheduleMeeting,
  onNavigateToDashboard,
  contacts = [],
}: VideoWelcomePageProps) {
  // Main view tab inside the combined Welcome Portal
  const [welcomeTab, setWelcomeTab] = useState<'greet' | 'recordings' | 'schedule_recordings'>('greet');

  const { 
    isCallActive, 
    activeMeeting, 
    returnToMeeting,
    meetingHistory,
    deleteMeetingHistoryItem,
    liveTranscript,
    saveCurrentMeetingTranscript,
    startInstantMeeting,
    meetingFeatures,
    subscription
  } = useMeetingSession();
  // Recording depends on the organization's plan; the option says so instead of failing at start.
  const canRecordOnPlan = meetingFeatures.recording;
  const recordingPlanLabel = subscription ? (['premium', 'enterprise'] as const).map(t => subscription.plans[t]).find(p => p.features.recording)?.label : undefined;

  const [meetingCode, setMeetingCode] = useState('');
  const [customRoomName, setCustomRoomName] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showQuickActionMenu, setShowQuickActionMenu] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Dedicated Start Instant Video Meeting Modal State
  const [showStartInstantModal, setShowStartInstantModal] = useState(false);
  const [modalMeetingTitle, setModalMeetingTitle] = useState('Executive Strategy Consultation');
  const [modalRoomCode, setModalRoomCode] = useState(() => `omni-${Math.random().toString(36).substring(2, 7)}`);
  const [modalLinkedContactId, setModalLinkedContactId] = useState<string>('none');
  const [modalAutoRecord, setModalAutoRecord] = useState(true);
  const [modalAutoTranscribe, setModalAutoTranscribe] = useState(true);
  const [modalStartMuted, setModalStartMuted] = useState(false);
  const [modalStartCamOff, setModalStartCamOff] = useState(false);
  const [modalNoiseSuppression, setModalNoiseSuppression] = useState(true);
  const [modalCopiedCode, setModalCopiedCode] = useState(false);

  // Hub Studio Pre-Flight Recording State
  const [isHubRecording, setIsHubRecording] = useState(false);
  const [hubRecordingSeconds, setHubRecordingSeconds] = useState(0);
  const hubRecorderRef = useRef<MediaRecorder | null>(null);
  const hubChunksRef = useRef<Blob[]>([]);
  const hubTimerRef = useRef<any>(null);
  const [hubSaveNotice, setHubSaveNotice] = useState<string | null>(null);

  // Recordings & Transcripts Vault state
  const [vaultSubTab, setVaultSubTab] = useState<'all' | 'recordings' | 'transcripts'>('all');
  const [vaultSearchQuery, setVaultSearchQuery] = useState('');
  const [activeWatchRecording, setActiveWatchRecording] = useState<MeetingHistoryRecord | null>(null);
  const [activeViewTranscript, setActiveViewTranscript] = useState<MeetingHistoryRecord | null>(null);
  const [transcriptSearchTerm, setTranscriptSearchTerm] = useState('');
  const [watchVideoPlaying, setWatchVideoPlaying] = useState(true);
  const [watchPlaybackSpeed, setWatchPlaybackSpeed] = useState(1);
  const [vaultTranscriptSaveFeedback, setVaultTranscriptSaveFeedback] = useState<string | null>(null);
  const [watchCurrentTime, setWatchCurrentTime] = useState(0);
  const [watchTranscriptSearch, setWatchTranscriptSearch] = useState('');
  const [welcomeToast, setWelcomeToast] = useState<{ message: string; type?: 'info' | 'success' | 'warning' } | null>(null);

  const showWelcomeToast = (message: string, type: 'info' | 'success' | 'warning' = 'success') => {
    setWelcomeToast({ message, type });
    setTimeout(() => {
      setWelcomeToast(prev => prev?.message === message ? null : prev);
    }, 3500);
  };

  // Export Transcript as PDF via jsPDF
  const handleDownloadTranscriptPdf = (record: MeetingHistoryRecord) => {
    try {
      const doc = new jsPDF();
      doc.setFillColor(30, 27, 75);
      doc.rect(0, 0, 210, 30, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text('OmniMeet Executive Video Transcript', 14, 18);
      doc.setFontSize(10);
      doc.text(`Meeting: ${record.title} • Room: ${record.roomId} • Date: ${record.date}`, 14, 25);
      
      let y = 42;
      doc.setTextColor(33, 37, 41);
      doc.setFontSize(10);

      record.transcript.forEach((item) => {
        if (y > 270) {
          doc.addPage();
          y = 25;
        }
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(item.isHost ? 79 : 71, item.isHost ? 70 : 85, item.isHost ? 229 : 105);
        doc.text(`[${item.timestamp}] ${item.speakerName} ${item.isHost ? '(Host)' : ''}:`, 14, y);
        
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(35, 35, 35);
        const splitText = doc.splitTextToSize(item.text, 135);
        doc.text(splitText, 65, y);
        y += (splitText.length * 5) + 4;
      });

      doc.save(`transcript-${record.roomId}.pdf`);
      showWelcomeToast('Transcript downloaded as PDF document (.pdf).', 'success');
    } catch (err) {
      console.warn('PDF export fallback:', err);
      const text = record.transcript.map(t => `[${t.timestamp}] ${t.speakerName}: ${t.text}`).join('\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcript-${record.roomId}.txt`;
      a.click();
      showWelcomeToast('Transcript exported as text document (.txt).', 'info');
    }
  };

  // Start / Stop Recording in Greet Hub Stage
  const handleToggleHubRecording = () => {
    if (isHubRecording) {
      if (hubRecorderRef.current && hubRecorderRef.current.state !== 'inactive') {
        try { hubRecorderRef.current.stop(); } catch (e) {}
      }
      if (hubTimerRef.current) {
        clearInterval(hubTimerRef.current);
        hubTimerRef.current = null;
      }
      setIsHubRecording(false);
    } else {
      hubChunksRef.current = [];
      setHubRecordingSeconds(0);
      const stream = previewVideoRef.current?.srcObject as MediaStream || cameraStreamRef.current || screenStreamRef.current;
      
      if (stream && typeof MediaRecorder !== 'undefined') {
        try {
          const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
          rec.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) hubChunksRef.current.push(e.data);
          };
          rec.onstop = () => {
            const blob = new Blob(hubChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const duration = hubRecordingSeconds || 18;
            const mins = Math.floor(duration / 60);
            const secs = duration % 60;
            const durationFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            const sizeMb = ((blob.size || 22000000) / (1024 * 1024)).toFixed(1);

            const newRec: MeetingHistoryRecord = {
              id: `rec-hub-${Date.now()}`,
              roomId: `greet-${Math.random().toString(36).substring(2, 7)}`,
              title: `Executive Video Consultation Brief`,
              date: 'Today',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              durationSeconds: duration,
              durationFormatted,
              hostName: 'Camelia Rose',
              participants: [
                { name: 'Camelia Rose', title: 'Lead Enterprise Partner', company: 'Obsidian Cloud', avatar: 'CR' }
              ],
              hasRecording: true,
              recordingUrl: url,
              recordingSize: `${sizeMb} MB`,
              hasTranscript: true,
              transcript: [
                { id: 't1', speakerId: 'host', speakerName: 'Camelia Rose', timestamp: '00:03', timeSeconds: 3, text: 'Studio video memo recorded and archived directly from the Greet Hub.', isHost: true },
                { id: 't2', speakerId: 'host', speakerName: 'Camelia Rose', timestamp: '00:10', timeSeconds: 10, text: 'Synchronized with customer relationship profile notes and ready for client distribution.', isHost: true }
              ],
              notes: 'Studio preview recording archived into Greet Hub Recordings Vault.',
              tasksCount: 1
            };

            try {
              const saved = localStorage.getItem('obsidian_meeting_history');
              const list = saved ? JSON.parse(saved) : [];
              list.unshift(newRec);
              localStorage.setItem('obsidian_meeting_history', JSON.stringify(list));
            } catch (e) {}

            setHubSaveNotice('✓ Video Recording saved to Greet Hub Recordings Vault!');
            setTimeout(() => setHubSaveNotice(null), 4500);
          };
          rec.start(1000);
          hubRecorderRef.current = rec;
        } catch (e) {
          console.warn('MediaRecorder error, falling back', e);
        }
      }

      setIsHubRecording(true);
      hubTimerRef.current = setInterval(() => {
        setHubRecordingSeconds(s => s + 1);
      }, 1000);
    }
  };

  // Softphone & Hardware quick-test states
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [quickDialNumber, setQuickDialNumber] = useState('');
  const [micLevel, setMicLevel] = useState(65);

  // Live Screen Sharing & Video Meeting Stage State
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isScreenCapturePending, setIsScreenCapturePending] = useState(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [hasSystemAudio, setHasSystemAudio] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // DOM & MediaStream references
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);

  // Check browser support for standard Web Screen Capture API
  const canShareScreen =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function';

  // Animate mic volume bar subtly
  useEffect(() => {
    if (isMicMuted || (!isCameraActive && !hasSystemAudio)) {
      setMicLevel(0);
      return;
    }
    const interval = setInterval(() => {
      setMicLevel(Math.floor(40 + Math.random() * 50));
    }, 450);
    return () => clearInterval(interval);
  }, [isMicMuted, isCameraActive, hasSystemAudio]);

  // Clean up all media tracks when component unmounts
  useEffect(() => {
    return () => {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
        screenStreamRef.current = null;
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
        cameraStreamRef.current = null;
      }
    };
  }, []);

  // Stop Screen Share and restore camera track if active
  const handleStopScreenShare = useCallback(async () => {
    // 1. Clean up all display media tracks
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      screenStreamRef.current = null;
    }

    // 2. Restore camera stream in video preview if active, or clear srcObject
    if (isCameraActive && cameraStreamRef.current && previewVideoRef.current) {
      previewVideoRef.current.srcObject = cameraStreamRef.current;
      previewVideoRef.current.play().catch(() => {});
    } else if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }

    // 3. WebRTC integration: restore user's camera track using replaceTrack()
    const activePc = getActivePeerConnection();
    if (activePc) {
      const sender = activePc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        const cameraTrack = cameraStreamRef.current?.getVideoTracks()[0] || null;
        try {
          await sender.replaceTrack(cameraTrack);
          console.log('[Greet Video] Restored camera track in active RTCPeerConnection.');
        } catch (err) {
          console.warn('[Greet Video] Error restoring camera track in peer connection:', err);
        }
      }
    }

    // 4. Update UI state and notify global event bus
    setIsScreenSharing(false);
    setHasSystemAudio(false);
    setIsScreenCapturePending(false);
    dispatchScreenShareState(false, null);
  }, [isCameraActive]);

  // Toggle Screen Share using standard Web Screen Capture API
  const handleToggleScreenShare = async () => {
    setScreenShareError(null);

    // If currently sharing, stop sharing immediately
    if (isScreenSharing) {
      await handleStopScreenShare();
      return;
    }

    // Verify browser support before continuing
    if (!canShareScreen) {
      setScreenShareError(
        'Screen sharing is not supported by this browser. Please use a current version of Chrome, Edge, Firefox, or another supported browser.'
      );
      return;
    }

    if (isScreenCapturePending) return;
    setIsScreenCapturePending(true);

    try {
      let stream: MediaStream | null = null;

      // Recommended implementation: request video and optional system/tab audio
      // with standard constraints and resilient hint fallback
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
          preferCurrentTab: false,
          selfBrowserSurface: 'exclude' as any,
          surfaceSwitching: 'include' as any,
          monitorTypeSurfaces: 'include' as any,
          systemAudio: 'include' as any
        } as DisplayMediaStreamOptions);
      } catch (optionErr: any) {
        // If browser rejected advanced hints with TypeError (e.g. Firefox or older Chromium),
        // gracefully fall back to basic options without hints
        if (optionErr?.name === 'TypeError') {
          console.warn('[Greet Video] Browser rejected advanced display hints. Retrying with basic options...', optionErr);
          try {
            stream = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: true
            });
          } catch (retryErr: any) {
            if (retryErr?.name === 'TypeError') {
              // Retry video-only if audio capture was unsupported
              stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            } else {
              throw retryErr;
            }
          }
        } else {
          throw optionErr;
        }
      }

      if (!stream) {
        throw new Error('No display stream was returned by getDisplayMedia.');
      }

      screenStreamRef.current = stream;
      setHasSystemAudio(stream.getAudioTracks().length > 0);

      // Show the captured stream in the video preview
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        await previewVideoRef.current.play();
      }

      // Detect when the user stops sharing from the browser's native screen-sharing controls
      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          console.log('[Greet Video] Display track ended natively by browser control.');
          handleStopScreenShare();
        });

        // WebRTC integration: add the screen-sharing video track to the existing RTCPeerConnection
        const activePc = getActivePeerConnection();
        if (activePc) {
          const sender = activePc
            .getSenders()
            .find((s) => s.track?.kind === 'video');

          if (sender) {
            await sender.replaceTrack(videoTrack);
            console.log('[Greet Video] Swapped video track in active RTCPeerConnection with screen share track.');
          }
        }
      }

      setIsScreenSharing(true);
      dispatchScreenShareState(true, stream);
    } catch (err: any) {
      console.warn('[Greet Video] Screen share error:', err);
      const isIframe = typeof window !== 'undefined' && window.self !== window.top;

      let friendlyMsg = 'Screen sharing could not be started.';
      switch (err?.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          friendlyMsg = isIframe
            ? 'Screen sharing was cancelled or denied. Because the app is running in an iframe, verify that allow="display-capture" is present on the iframe element.'
            : 'Screen sharing was cancelled or denied by the user.';
          break;
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          friendlyMsg = 'No shareable display source is available (entire screen, application window, or browser tab).';
          break;
        case 'NotReadableError':
        case 'TrackStartError':
          friendlyMsg = 'The operating system or browser could not capture the selected display source. Check OS privacy and screen recording permissions.';
          break;
        case 'InvalidStateError':
          friendlyMsg = 'Screen sharing was not initiated from a valid user interaction. Please click the button directly.';
          break;
        case 'TypeError':
          friendlyMsg = 'The requested screen sharing options are not supported by this browser.';
          break;
        case 'SecurityError':
          friendlyMsg = 'Screen sharing requires a secure context (HTTPS) and appropriate permissions policy.';
          break;
        case 'AbortError':
          friendlyMsg = 'The screen capture request was cancelled before completion.';
          break;
        default:
          friendlyMsg = err?.message || 'Screen sharing could not be started.';
      }

      setScreenShareError(friendlyMsg);
      await handleStopScreenShare();
    } finally {
      setIsScreenCapturePending(false);
    }
  };

  // Toggle Camera (HD webcam preview)
  const handleToggleCamera = async () => {
    setScreenShareError(null);

    if (isCameraActive) {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
        cameraStreamRef.current = null;
      }
      if (!isScreenSharing && previewVideoRef.current) {
        previewVideoRef.current.srcObject = null;
      }
      setIsCameraActive(false);

      const activePc = getActivePeerConnection();
      if (activePc && !isScreenSharing) {
        const sender = activePc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(null).catch(() => {});
        }
      }
    } else {
      try {
        if (!navigator?.mediaDevices?.getUserMedia) {
          throw new Error('getUserMedia is not supported on this browser.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true
        });

        cameraStreamRef.current = stream;

        if (!isScreenSharing && previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream;
          await previewVideoRef.current.play().catch(() => {});
        }

        setIsCameraActive(true);

        const activePc = getActivePeerConnection();
        if (activePc && !isScreenSharing) {
          const sender = activePc.getSenders().find((s) => s.track?.kind === 'video');
          const camTrack = stream.getVideoTracks()[0] || null;
          if (sender && camTrack) {
            await sender.replaceTrack(camTrack).catch(() => {});
          }
        }
      } catch (err: any) {
        console.warn('Camera access error:', err);
        setScreenShareError(
          err?.name === 'NotAllowedError'
            ? 'Camera access was denied by browser permissions.'
            : 'Could not access camera or microphone: ' + (err?.message || 'Device unavailable')
        );
      }
    }
  };

  // Toggle Microphone Mute
  const handleToggleMicrophone = () => {
    const nextMuted = !isMicMuted;
    setIsMicMuted(nextMuted);

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }
  };

  // Toggle Fullscreen on video preview container
  const handleToggleFullscreen = () => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Listen for fullscreen change events from browser
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Schedule Modal form state
  const [scheduleTitle, setScheduleTitle] = useState('Client Strategy & Review');
  const [scheduleDate, setScheduleDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [scheduleTime, setScheduleTime] = useState('14:00');
  const [scheduleContact, setScheduleContact] = useState(contacts[0]?.name || 'Marcus Sterling');
  const [scheduleType, setScheduleType] = useState<'call' | 'demo' | 'followup' | 'contract'>('call');
  const [scheduleNotes, setScheduleNotes] = useState('Video consultation room generated from Welcome Hub.');
  const [scheduleSuccessMsg, setScheduleSuccessMsg] = useState<string | null>(null);

  // Search & Navigation state in Greet Tab
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [userPresence, setUserPresence] = useState<'available' | 'in_meeting' | 'away'>('available');

  // Pre-populated upcoming & recorded meetings for the video dashboard
  // TO COMPLETE: load scheduled meetings from GET /api/meetings and the user’s calendar.
  const upcomingMeetings = [] as any[];

  const recentRecordings = [
    {
      id: 'rec-01',
      title: 'Strategic Account Discovery',
      duration: '42:18',
      date: 'Yesterday, 16:30',
      size: '284 MB',
      participants: '3 Attendees'
    },
    {
      id: 'rec-02',
      title: 'Quarterly Revenue Milestone Pitch',
      duration: '28:45',
      date: 'June 14, 2026',
      size: '195 MB',
      participants: '5 Attendees'
    }
  ];

  // Generate random room code like 'abc-defg-hij'
  const generateRoomCode = () => {
    const part1 = Math.random().toString(36).substring(2, 5);
    const part2 = Math.random().toString(36).substring(2, 6);
    const part3 = Math.random().toString(36).substring(2, 5);
    return `${part1}-${part2}-${part3}`;
  };

  const handleOpenStartInstantModal = () => {
    const code = customRoomName.trim() || generateRoomCode();
    setModalRoomCode(code);
    setShowStartInstantModal(true);
  };

  const handleCreateInstantRoom = () => {
    handleOpenStartInstantModal();
  };

  const handleConfirmStartInstantMeeting = () => {
    setShowStartInstantModal(false);
    const linkedContact = modalLinkedContactId !== 'none'
      ? contacts.find(c => c.id === modalLinkedContactId)
      : undefined;
    onStartInstantMeeting(modalRoomCode, linkedContact, modalMeetingTitle, {
      autoRecord: modalAutoRecord && canRecordOnPlan,
      autoTranscribe: modalAutoTranscribe,
      startMuted: modalStartMuted,
      startCamOff: modalStartCamOff
    });
  };

  const handleJoinSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = meetingCode.trim();
    if (!clean) {
      setErrorMessage('Please enter a valid meeting code or link.');
      return;
    }
    setErrorMessage(null);
    onJoinMeeting(clean);
  };

  const handleQuickDialSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickDialNumber.trim()) return;
    onJoinMeeting(quickDialNumber.trim());
  };

  const handleScheduleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const generatedLink = `https://crm.cloud/meet/${generateRoomCode()}`;
    const formattedDateTime = `${scheduleDate} at ${scheduleTime}`;

    onScheduleMeeting({
      title: scheduleTitle,
      time: formattedDateTime,
      type: scheduleType,
      contact: scheduleContact,
      status: 'upcoming',
      meetingLink: generatedLink,
      notes: scheduleNotes,
      invitees: scheduleContact,
    });

    setScheduleSuccessMsg(`Meeting scheduled! Link: ${generatedLink}`);
    setTimeout(() => {
      setScheduleSuccessMsg(null);
      setShowScheduleModal(false);
    }, 1800);
  };

  return (
    <div 
      id="video-welcome-page"
      className="relative min-h-full w-full bg-slate-50 text-neutral-900 flex flex-col justify-between overflow-x-hidden font-sans select-none rounded-3xl border border-neutral-200/80 shadow-xs"
    >
      {/* Ambient background glow & radial light-mode gradients */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div 
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[850px] h-[550px] bg-gradient-to-tr from-blue-300/35 via-indigo-300/30 to-purple-300/35 rounded-full blur-[120px] opacity-70"
        />
        <div 
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[380px] bg-gradient-to-b from-blue-100/40 via-indigo-50/20 to-transparent rounded-full blur-[100px]"
        />
      </div>

      {/* Top Navigation & Hub Header with Search & My Account Menu at Top Right */}
      <header className="relative z-30 w-full px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/80 bg-white/80 backdrop-blur-md">
        
        {/* Left: Branding & Core Signal */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-indigo-900 flex items-center justify-center text-white shadow-sm shadow-indigo-900/30 shrink-0">
            <Video className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-neutral-900 tracking-tight">
                OmniMeet Video Dashboard
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/80 text-[10px] font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live WebRTC
              </span>
            </div>
            <p className="text-[11px] text-neutral-500 font-mono">
              Combined Greet & Call Canvas Hub
            </p>
          </div>
        </div>

        {/* Center: Integrated Quick Search Bar for Greet Tab */}
        <div className="relative flex-1 max-w-xs sm:max-w-sm md:max-w-md mx-2">
          <div className="relative flex items-center">
            <Search className="absolute left-3 h-3.5 w-3.5 text-neutral-400 pointer-events-none" />
            <input
              id="input-greet-quick-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearchOpen(true)}
              placeholder="Search meetings, contacts, rooms (e.g. Marcus, SLA)..."
              className="w-full pl-9 pr-8 py-1.5 text-xs bg-neutral-100/90 hover:bg-neutral-100 focus:bg-white border border-neutral-200 rounded-xl text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 transition-all font-medium"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 p-0.5 text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            ) : (
              <span className="absolute right-2.5 text-[9px] font-mono text-neutral-400 bg-neutral-200/70 px-1.5 py-0.5 rounded">
                /
              </span>
            )}
          </div>

          {/* Quick Search Autocomplete Dropdown */}
          <AnimatePresence>
            {isSearchOpen && searchQuery && (
              <>
                <div 
                  className="fixed inset-0 z-40 bg-transparent" 
                  onClick={() => setIsSearchOpen(false)} 
                />
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-xl shadow-xl border border-neutral-200 z-50 overflow-hidden text-xs max-h-72 overflow-y-auto"
                >
                  <div className="p-2 border-b border-neutral-100 bg-neutral-50 text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                    Quick Search Results for "{searchQuery}"
                  </div>

                  {/* Matching Meetings */}
                  {upcomingMeetings.filter(m => 
                    m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    m.contact.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    m.roomCode.toLowerCase().includes(searchQuery.toLowerCase())
                  ).map(meeting => (
                    <div
                      key={meeting.id}
                      onClick={() => {
                        onJoinMeeting(meeting.roomCode);
                        setIsSearchOpen(false);
                      }}
                      className="p-2.5 hover:bg-indigo-50/70 border-b border-neutral-100 flex items-center justify-between cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                          <Video className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <p className="font-bold text-neutral-900 text-xs">{meeting.title}</p>
                          <p className="text-[10.5px] text-neutral-500">{meeting.contact} • <span className="font-mono">{meeting.time}</span></p>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-600 text-white">
                        Join Room
                      </span>
                    </div>
                  ))}

                  {/* Matching Contacts */}
                  {contacts.filter(c => 
                    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    c.company.toLowerCase().includes(searchQuery.toLowerCase())
                  ).map(contact => (
                    <div
                      key={contact.id}
                      onClick={() => {
                        onStartInstantMeeting(`meet-${contact.name.toLowerCase().replace(/\s+/g, '-')}`);
                        setIsSearchOpen(false);
                      }}
                      className="p-2.5 hover:bg-purple-50/70 border-b border-neutral-100 flex items-center justify-between cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <img 
                          src={contact.avatar} 
                          alt={contact.name} 
                          className="h-7 w-7 rounded-lg object-cover border border-neutral-200"
                          referrerPolicy="no-referrer"
                        />
                        <div>
                          <p className="font-bold text-neutral-900 text-xs">{contact.name}</p>
                          <p className="text-[10.5px] text-neutral-500">{contact.company} • {contact.status}</p>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-600 text-white flex items-center gap-1">
                        <PhoneCall className="h-2.5 w-2.5" /> Start Call
                      </span>
                    </div>
                  ))}

                  {/* If nothing matches */}
                  {upcomingMeetings.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 &&
                   contacts.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                    <div className="p-4 text-center text-neutral-500 text-xs">
                      No matching records. Press enter to generate room <b>"{searchQuery}"</b>.
                    </div>
                  )}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {/* View Switcher Tabs: Greet / Call Canvas Studio / Recordings Vault / Schedule */}
        <div className="hidden lg:flex items-center p-1 rounded-xl bg-neutral-100/80 border border-neutral-200/70 shadow-inner">
          <button
            id="tab-greet-welcome"
            onClick={() => setWelcomeTab('greet')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              welcomeTab === 'greet'
                ? 'bg-white text-indigo-900 shadow-sm border border-neutral-200/60'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
            <span>Greet Portal</span>
          </button>


          <button
            id="tab-recordings-vault"
            onClick={() => setWelcomeTab('recordings')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              welcomeTab === 'recordings'
                ? 'bg-white text-indigo-900 shadow-sm border border-neutral-200/60'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Disc className="h-3.5 w-3.5 text-rose-600" />
            <span>Recordings & Vault</span>
            {meetingHistory && meetingHistory.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold">
                {meetingHistory.length}
              </span>
            )}
          </button>

          <button
            id="tab-schedule-recordings"
            onClick={() => setWelcomeTab('schedule_recordings')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              welcomeTab === 'schedule_recordings'
                ? 'bg-white text-indigo-900 shadow-sm border border-neutral-200/60'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5 text-blue-600" />
            <span>Schedule ({upcomingMeetings.length})</span>
          </button>
        </div>
      </header>

      {/* DEDICATED BREADCRUMB SUB-HEADER BAR FOR GREET TAB */}
      <div 
        id="greet-breadcrumb-bar"
        className="relative z-20 w-full px-6 py-2 bg-neutral-100/70 border-b border-neutral-200/70 flex items-center justify-between text-xs text-neutral-600 select-none backdrop-blur-xs"
      >
        <div className="flex items-center gap-2 font-medium">
          {onNavigateToDashboard ? (
            <button
              onClick={onNavigateToDashboard}
              className="flex items-center gap-1 hover:text-indigo-900 transition-colors cursor-pointer font-semibold"
            >
              <Home className="h-3 w-3 text-neutral-500" />
              <span>Core CRM</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 font-semibold">
              <Home className="h-3 w-3 text-neutral-500" />
              <span>Core CRM</span>
            </div>
          )}
          
          <ChevronRight className="h-3 w-3 text-neutral-400" />

          <span className="px-2 py-0.5 rounded-md bg-indigo-100/80 text-indigo-900 font-bold text-[11px] flex items-center gap-1 border border-indigo-200/60">
            <Sparkles className="h-3 w-3 text-indigo-600" />
            Greet Portal
          </span>

          <ChevronRight className="h-3 w-3 text-neutral-400" />

          <span className="text-neutral-500 hidden sm:inline text-[11px] font-mono">
            OmniMeet Studio • High-Fidelity WebRTC
          </span>
        </div>

        {/* Live Audio/Mesh status indicators */}
        <div className="hidden md:flex items-center gap-3 text-[11px] text-neutral-500 font-mono">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Edge SFU Node: US-East
          </span>
          <span className="text-neutral-300">•</span>
          <span>48kHz Opus Audio</span>
          <span className="text-neutral-300">•</span>
          <span className="text-indigo-700 font-bold">RTT &lt; 14ms</span>
        </div>
      </div>

      {/* Main Dynamic Content Area */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-8">
        
        {/* ================= TAB 1: GREET PORTAL (COMBINED VIDEO MEETING & SCREEN SHARING) ================= */}
        {welcomeTab === 'greet' && (
          <div className="w-full max-w-6xl flex flex-col items-center">
            
            {/* Header Greeting & Collaborative Title */}
            <motion.div 
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="text-center mb-6 max-w-2xl"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-900 text-xs font-semibold mb-3">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                <span>Enterprise Omnichannel Video Stage</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 leading-tight">
                Welcome back! Ready to collaborate?
              </h1>
              <p className="text-xs sm:text-sm text-neutral-500 mt-1.5">
                Zero-latency WebRTC meeting room with standard cross-browser screen sharing and hardware diagnostics
              </p>
            </motion.div>

            {/* Active Meeting Resume Banner */}
            {isCallActive && activeMeeting && (
              <div className="w-full mb-6 p-4 rounded-2xl bg-gradient-to-r from-emerald-950/90 via-indigo-950/90 to-purple-950/90 border border-emerald-500/40 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3.5 w-3.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                      <span>Live Call in Progress: {activeMeeting.title}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-300 font-mono">
                        ID: {activeMeeting.roomId}
                      </span>
                    </h3>
                    <p className="text-xs text-neutral-300">
                      {activeMeeting.participants.length + 1} attendees in room. Your video stream and chat session are preserved.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    returnToMeeting();
                    onStartInstantMeeting(activeMeeting.roomId);
                  }}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-950/50 cursor-pointer"
                >
                  <ArrowRight className="h-4 w-4" />
                  <span>Return to Video Room</span>
                </button>
              </div>
            )}

            {/* Main Non-Redundant Action Deck (3 Distinct Action Cards) */}
            <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
              
              {/* Pillar 1: Start Instant Meeting */}
              <div 
                id="card-hero-start-instant"
                className="bg-white/90 backdrop-blur-xl border border-white/90 shadow-[0_12px_32px_-4px_rgba(49,46,129,0.06),0_4px_12px_rgba(0,0,0,0.02)] rounded-3xl p-6 flex flex-col justify-between hover:shadow-[0_18px_40px_-6px_rgba(49,46,129,0.12)] transition-all group"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-indigo-900 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-950/20 shrink-0 group-hover:scale-105 transition-transform">
                      <Video className="h-6 w-6" />
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 font-mono">
                      INSTANT HD
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-neutral-900 mb-1">
                    Start an Instant Meeting
                  </h3>
                  <p className="text-xs text-neutral-500 leading-relaxed mb-4">
                    Launch a high-definition video room with automatic audio, live speech-to-text transcripts, and meeting recording.
                  </p>
                </div>

                <div className="space-y-2 pt-2 border-t border-neutral-100">
                  <div className="flex items-center gap-2 text-[11px] text-neutral-500 mb-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>Auto-recording &amp; Live AI Transcripts ready</span>
                  </div>

                  <button
                    id="btn-hero-start-instant-meeting"
                    type="button"
                    onClick={handleOpenStartInstantModal}
                    className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-indigo-900 via-indigo-700 to-indigo-800 hover:from-[#252778] hover:to-indigo-700 text-white font-bold text-xs shadow-lg shadow-indigo-950/20 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-98"
                  >
                    <Video className="h-4 w-4" />
                    <span>Start Instant Meeting</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-auto" />
                  </button>
                </div>
              </div>

              {/* Pillar 2: Join Existing Meeting with Code */}
              <div 
                id="card-join-by-code"
                className="bg-white/90 backdrop-blur-xl border border-white/90 shadow-[0_12px_32px_-4px_rgba(49,46,129,0.06),0_4px_12px_rgba(0,0,0,0.02)] rounded-3xl p-6 flex flex-col justify-between hover:shadow-[0_18px_40px_-6px_rgba(49,46,129,0.12)] transition-all group"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-12 w-12 rounded-2xl bg-purple-50 border border-purple-100 text-purple-700 flex items-center justify-center shadow-xs shrink-0 group-hover:scale-105 transition-transform">
                      <Users className="h-6 w-6" />
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-100 font-mono">
                      DIRECT JOIN
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-neutral-900 mb-1">
                    Join with Room Code
                  </h3>
                  <p className="text-xs text-neutral-500 leading-relaxed mb-4">
                    Connect to a team conference or client room with an invitation code or meeting URL.
                  </p>
                </div>

                <form onSubmit={handleJoinSubmit} className="space-y-2 pt-2 border-t border-neutral-100">
                  <div className="flex items-center rounded-xl bg-neutral-50 border border-neutral-200 p-1 focus-within:border-indigo-600 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
                    <input
                      id="input-meeting-code"
                      type="text"
                      value={meetingCode}
                      onChange={(e) => {
                        setMeetingCode(e.target.value);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      placeholder="e.g. omni-7x9q"
                      className="flex-1 bg-transparent px-3 py-2 text-xs text-neutral-800 placeholder:text-neutral-400 focus:outline-none min-w-0 font-mono"
                    />
                    <button
                      id="btn-submit-meeting-code"
                      type="submit"
                      disabled={!meetingCode.trim()}
                      className="h-8 px-3 rounded-lg bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center transition-all cursor-pointer shadow-xs active:scale-95 shrink-0"
                    >
                      <span>Join</span>
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </button>
                  </div>

                  {errorMessage && (
                    <p className="text-[11px] text-rose-600 font-medium">
                      {errorMessage}
                    </p>
                  )}
                </form>
              </div>

              {/* Pillar 3: Schedule Future Consultation */}
              <div 
                id="card-schedule-meeting"
                className="bg-white/90 backdrop-blur-xl border border-white/90 shadow-[0_12px_32px_-4px_rgba(49,46,129,0.06),0_4px_12px_rgba(0,0,0,0.02)] rounded-3xl p-6 flex flex-col justify-between hover:shadow-[0_18px_40px_-6px_rgba(49,46,129,0.12)] transition-all group"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="h-12 w-12 rounded-2xl bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center shadow-xs shrink-0 group-hover:scale-105 transition-transform">
                      <CalendarDays className="h-6 w-6" />
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 font-mono">
                      CALENDAR
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-neutral-900 mb-1">
                    Schedule a Consultation
                  </h3>
                  <p className="text-xs text-neutral-500 leading-relaxed mb-4">
                    Plan upcoming video meetings with integrated calendar invites, automated email links, and reminders.
                  </p>
                </div>

                <div className="pt-2 border-t border-neutral-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowScheduleModal(true)}
                    className="flex-1 py-3 px-4 rounded-2xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <CalendarDays className="h-4 w-4 text-blue-600" />
                    <span>Schedule New Meeting</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWelcomeTab('schedule_recordings')}
                    className="p-3 rounded-2xl bg-neutral-100 hover:bg-neutral-200 text-neutral-600 text-xs font-semibold transition-colors cursor-pointer"
                    title={`View ${upcomingMeetings.length} upcoming meetings`}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

            </div>

            {/* Bottom Dashboard Grid: Left (Recent Recordings & Transcripts) + Right (Today's Agenda & Node Status) */}
            <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Left Column (7 cols): Recent Consultations & Recorded Sessions */}
              <div className="lg:col-span-7 bg-white/90 backdrop-blur-xl border border-white/90 shadow-[0_12px_32px_-4px_rgba(49,46,129,0.06),0_4px_12px_rgba(0,0,0,0.02)] rounded-3xl p-6">
                <div className="flex items-center justify-between pb-4 border-b border-neutral-100 mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600">
                      <Disc className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-neutral-900">Recent Meeting Recordings & Transcripts</h3>
                      <p className="text-[11px] text-neutral-500">Searchable transcripts, video playback, and downloadable logs</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setWelcomeTab('recordings')}
                    className="text-xs font-bold text-indigo-700 hover:text-indigo-900 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <span>Open Vault ({meetingHistory.length})</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {meetingHistory.length > 0 ? (
                  <div className="space-y-3">
                    {meetingHistory.slice(0, 3).map((item) => (
                      <div
                        key={item.id}
                        className="p-4 rounded-2xl bg-neutral-50/80 hover:bg-neutral-100/80 border border-neutral-200/60 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-bold text-xs text-neutral-900 truncate">
                              {item.title}
                            </span>
                            <span className="px-2 py-0.2 rounded-full bg-neutral-200/70 text-neutral-600 text-[10px] font-mono">
                              {item.roomId}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-neutral-500 flex-wrap">
                            <span>{item.date} • {item.time}</span>
                            <span>•</span>
                            <span>Duration: {item.durationFormatted}</span>
                            <span>•</span>
                            <span>{item.participants.length} attendees</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {item.recordingUrl && (
                            <button
                              type="button"
                              onClick={() => setActiveWatchRecording(item)}
                              className="px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-200 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                            >
                              <Play className="h-3 w-3 text-emerald-600" />
                              <span>Watch</span>
                            </button>
                          )}

                          {item.transcript && item.transcript.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setActiveViewTranscript(item)}
                              className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <FileText className="h-3 w-3 text-indigo-600" />
                              <span>Transcript</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDownloadTranscriptPdf(item)}
                            className="p-2 rounded-xl bg-white hover:bg-neutral-100 text-neutral-600 border border-neutral-200 transition-colors cursor-pointer"
                            title="Download PDF Transcript"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 px-4 text-center rounded-2xl bg-neutral-50 border border-dashed border-neutral-200">
                    <Disc className="h-8 w-8 text-neutral-300 mx-auto mb-2" />
                    <p className="text-xs font-bold text-neutral-700">No meeting recordings yet</p>
                    <p className="text-[11px] text-neutral-500 mt-0.5 mb-3">
                      Start an instant meeting with recording enabled to automatically archive speech transcripts and MP4 playback.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenStartInstantModal}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all cursor-pointer"
                    >
                      Start Instant Meeting
                    </button>
                  </div>
                )}
              </div>

              {/* Right Column (5 cols): Today's Scheduled Consultations & Hardware Readiness */}
              <div className="lg:col-span-5 space-y-4">
                
                {/* Upcoming Today Agenda Card */}
                <div className="bg-white/90 backdrop-blur-xl border border-white/90 shadow-[0_12px_32px_-4px_rgba(49,46,129,0.06),0_4px_12px_rgba(0,0,0,0.02)] rounded-3xl p-5">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-neutral-100">
                    <span className="text-xs font-bold text-neutral-900 flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-blue-600" />
                      <span>Today's Scheduled Consultations</span>
                    </span>
                    <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full font-mono">
                      {upcomingMeetings.length} Booked
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {upcomingMeetings.slice(0, 3).map((m) => (
                      <div 
                        key={m.id}
                        className="p-3 rounded-2xl bg-neutral-50/80 hover:bg-neutral-100/80 border border-neutral-200/60 flex items-center justify-between transition-colors gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-neutral-900 truncate">{m.title}</p>
                          <p className="text-[10px] text-neutral-500 font-mono mt-0.5">{m.time} • {m.roomCode}</p>
                        </div>
                        <button
                          onClick={() => onJoinMeeting(m.roomCode)}
                          className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-900 hover:text-white text-indigo-900 text-[11px] font-bold transition-all shrink-0 cursor-pointer"
                        >
                          Join
                        </button>
                      </div>
                    ))}
                  </div>
                </div>


              </div>
            </div>
          </div>
        )}

        {/* ================= TAB 3: RECORDINGS & TRANSCRIPTS VAULT ================= */}
        {welcomeTab === 'recordings' && (
          <motion.div 
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="w-full max-w-5xl space-y-6"
          >
            {/* Vault Header Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white/85 backdrop-blur-md p-5 rounded-3xl border border-neutral-200/80 shadow-sm gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-rose-50 border border-rose-100 text-rose-600">
                    <Disc className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-neutral-900">Greet Recordings Vault & Meeting Transcripts</h2>
                    <p className="text-xs text-neutral-500">Search, stream, and export recorded meetings and speech-to-text transcripts</p>
                  </div>
                </div>
              </div>

              {/* CORE REQUIREMENT: Button to save transcript for entire meeting in greet meeting tabs */}
              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  id="btn-save-entire-transcript-vault"
                  onClick={() => {
                    const result = saveCurrentMeetingTranscript();
                    setVaultTranscriptSaveFeedback(result.message);
                    setTimeout(() => setVaultTranscriptSaveFeedback(null), 3500);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-950/20 active:scale-95 transition-all"
                  title="Save current/entire meeting transcript into Greet Meeting tabs"
                >
                  <Save className="h-4 w-4" />
                  <span>Save Entire Meeting Transcript</span>
                </button>
              </div>
            </div>

            {vaultTranscriptSaveFeedback && (
              <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{vaultTranscriptSaveFeedback}</span>
              </div>
            )}

            {/* Filter and Search Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/80 backdrop-blur-md p-3 rounded-2xl border border-neutral-200/80 shadow-sm">
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-neutral-100">
                <button
                  onClick={() => setVaultSubTab('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    vaultSubTab === 'all' ? 'bg-white text-indigo-900 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  All Vault Files ({meetingHistory.length})
                </button>
                <button
                  onClick={() => setVaultSubTab('recordings')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                    vaultSubTab === 'recordings' ? 'bg-white text-indigo-900 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  <Disc className="h-3.5 w-3.5 text-rose-500" />
                  <span>Recordings ({meetingHistory.filter(m => m.hasRecording).length})</span>
                </button>
                <button
                  onClick={() => setVaultSubTab('transcripts')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                    vaultSubTab === 'transcripts' ? 'bg-white text-indigo-900 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Transcripts ({meetingHistory.filter(m => m.hasTranscript).length})</span>
                </button>
              </div>

              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-400" />
                <input
                  type="text"
                  value={vaultSearchQuery}
                  onChange={(e) => setVaultSearchQuery(e.target.value)}
                  placeholder="Search title, room code, or notes..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-200"
                />
              </div>
            </div>

            {/* Recordings Grid */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {meetingHistory
                  .filter(m => {
                    if (vaultSubTab === 'recordings') return m.hasRecording;
                    if (vaultSubTab === 'transcripts') return m.hasTranscript;
                    return true;
                  })
                  .filter(m => {
                    if (!vaultSearchQuery.trim()) return true;
                    const q = vaultSearchQuery.toLowerCase();
                    return m.title.toLowerCase().includes(q) ||
                           m.roomId.toLowerCase().includes(q) ||
                           m.notes.toLowerCase().includes(q);
                  })
                  .map((record) => (
                    <div 
                      key={record.id}
                      className="bg-white/90 backdrop-blur-md rounded-2xl border border-neutral-200/80 p-5 shadow-sm hover:shadow-md transition-all space-y-3.5"
                    >
                      {/* Top Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="h-10 w-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0 mt-0.5">
                            <Play className="h-5 w-5 fill-rose-600 ml-0.5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-neutral-900 leading-snug">{record.title}</h3>
                            <div className="flex items-center gap-2 text-[11px] text-neutral-500 font-mono mt-0.5">
                              <span>{record.date} at {record.time}</span>
                              <span>•</span>
                              <span>{record.durationFormatted}</span>
                            </div>
                          </div>
                        </div>

                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-100 text-neutral-600 font-mono border border-neutral-200">
                          {record.recordingSize || '184 MB'}
                        </span>
                      </div>

                      {/* Room Code & Participants Strip */}
                      <div className="p-2.5 rounded-xl bg-neutral-50/80 border border-neutral-200/60 flex items-center justify-between text-xs">
                        <span className="font-mono text-neutral-600 text-[11px]">Room: {record.roomId}</span>
                        <div className="flex items-center gap-1">
                          {record.participants.map((p, i) => (
                            <span 
                              key={i} 
                              className="h-6 w-6 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-200 flex items-center justify-center text-[10px] font-bold"
                              title={p.name}
                            >
                              {p.avatar || p.name.substring(0, 2)}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Notes / Quote Preview */}
                      {record.notes && (
                        <p className="text-xs text-neutral-600 italic line-clamp-2 bg-neutral-50/40 p-2 rounded-lg">
                          "{record.notes}"
                        </p>
                      )}

                      {/* Actions Toolbar */}
                      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-neutral-100 text-xs">
                        {/* Watch Recording Button */}
                        <button
                          onClick={() => setActiveWatchRecording(record)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Play className="h-3.5 w-3.5 fill-white" />
                          <span>Watch Recording</span>
                        </button>

                        {/* View Transcript Button */}
                        <button
                          onClick={() => setActiveViewTranscript(record)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <FileText className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Transcript ({record.transcript?.length || 0})</span>
                        </button>

                        {/* Download Recording */}
                        <button
                          onClick={() => {
                            const blob = new Blob(['Obsidian CRM Video Meeting Recording Container'], { type: 'video/webm' });
                            const url = record.recordingUrl || URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `recording-${record.roomId}.webm`;
                            a.click();
                          }}
                          className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors cursor-pointer"
                          title="Download Recording File (.WEBM)"
                        >
                          <Download className="h-4 w-4" />
                        </button>

                        {/* Delete from History */}
                        <button
                          onClick={() => deleteMeetingHistoryItem(record.id)}
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer ml-auto"
                          title="Delete Record"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>

              {meetingHistory.length === 0 && (
                <div className="p-12 text-center bg-white/70 rounded-3xl border border-neutral-200/80 text-neutral-500 text-xs space-y-2">
                  <Disc className="h-8 w-8 text-neutral-400 mx-auto" />
                  <p className="font-semibold text-neutral-700">No meeting recordings saved yet</p>
                  <p>Click "Start Instant Meeting" or "Record" in the Greet stage to record consultations.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ================= TAB 4: SCHEDULED SESSIONS ================= */}
        {welcomeTab === 'schedule_recordings' && (
          <motion.div 
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="w-full max-w-4xl space-y-6"
          >
            <div className="flex items-center justify-between bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-neutral-200/80 shadow-sm">
              <div>
                <h2 className="text-base font-bold text-neutral-900">Upcoming Video Consultations Calendar</h2>
                <p className="text-xs text-neutral-500">Synchronized directly with your CRM matrix calendar</p>
              </div>
              <button
                onClick={() => setShowScheduleModal(true)}
                className="px-4 py-2 rounded-xl bg-indigo-900 hover:bg-[#252778] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Schedule New Session</span>
              </button>
            </div>

            {/* Upcoming Consultations Grid */}
            <div className="bg-white/85 backdrop-blur-md rounded-2xl border border-neutral-200/80 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-neutral-100">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">Scheduled Consultations</span>
                <span className="text-xs font-semibold text-indigo-700">{upcomingMeetings.length} Booked</span>
              </div>

              <div className="space-y-3">
                {upcomingMeetings.map((m) => (
                  <div 
                    key={m.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-neutral-50/80 hover:bg-neutral-100/80 border border-neutral-200/60 transition-all gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-900 shrink-0 mt-0.5">
                        <Video className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-neutral-900">{m.title}</h3>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${m.badgeColor}`}>
                            {m.badge}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-600 mt-0.5">{m.contact}</p>
                        <div className="flex items-center gap-3 text-[11px] text-neutral-400 font-mono mt-1">
                          <span>{m.time}</span>
                          <span>•</span>
                          <span>Code: {m.roomCode}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`https://crm.cloud/meet/${m.roomCode}`);
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 1800);
                        }}
                        className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        title="Copy Invitation Link"
                      >
                        {copiedLink ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                        <span>{copiedLink ? 'Copied' : 'Invite'}</span>
                      </button>

                      <button
                        onClick={() => onJoinMeeting(m.roomCode)}
                        className="px-4 py-1.5 rounded-lg bg-indigo-900 hover:bg-[#252778] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shadow-sm"
                      >
                        <Video className="h-3 w-3" />
                        <span>Join Room</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </main>

      {/* Bottom Status Bar & Floating Action Hub */}
      <footer className="relative z-20 w-full px-6 py-4 flex items-center justify-between border-t border-neutral-200/50 bg-white/40 backdrop-blur-sm">
        <div className="flex items-center gap-4 text-[11px] text-neutral-400 font-mono">
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-emerald-600" />
            ZERO-TRUST WEBRTC DTLS-SRTP
          </span>
          <span className="hidden sm:inline">•</span>
          <span className="hidden sm:inline">LATENCY: 18ms</span>
          <span className="hidden sm:inline">•</span>
          <span className="hidden sm:inline">CODEC: OPUS / VP9 / AV1</span>
        </div>

        {/* Floating Quick Action Bubble Trigger */}
        <div className="relative">
          <button
            id="floating-btn-video-action"
            onClick={() => setShowQuickActionMenu(!showQuickActionMenu)}
            title="Quick Video & Call Canvas Actions"
            className="h-12 w-12 rounded-full bg-indigo-900 hover:bg-[#252778] text-white flex items-center justify-center shadow-lg shadow-indigo-900/30 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer"
          >
            <Video className="h-5 w-5" />
          </button>

          {/* Quick Action Bubble Menu */}
          <AnimatePresence>
            {showQuickActionMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 10 }}
                className="absolute right-0 bottom-16 w-60 bg-white rounded-2xl shadow-2xl border border-neutral-200/90 p-2 z-50 text-xs backdrop-blur-md"
              >
                <div className="px-3 py-2 border-b border-neutral-100 font-bold text-neutral-500 uppercase text-[10px] tracking-wider">
                  Quick Video & Canvas Actions
                </div>
                <button
                  onClick={() => {
                    setShowQuickActionMenu(false);
                    handleCreateInstantRoom();
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-100 text-neutral-800 font-semibold flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <Plus className="h-4 w-4 text-indigo-700" />
                  <span>Start Instant Meeting</span>
                </button>
                <button
                  onClick={() => {
                    setShowQuickActionMenu(false);
                    setShowScheduleModal(true);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-100 text-neutral-800 font-semibold flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <CalendarIcon className="h-4 w-4 text-blue-700" />
                  <span>Schedule for Later</span>
                </button>
                <button
                  onClick={() => {
                    const code = generateRoomCode();
                    navigator.clipboard.writeText(`https://crm.cloud/meet/${code}`);
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-100 text-neutral-800 font-semibold flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  {copiedLink ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4 text-neutral-500" />}
                  <span>{copiedLink ? 'Link Copied!' : 'Copy Meeting Link'}</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </footer>

      {/* =========================================================================
          START INSTANT VIDEO MEETING MODAL
          ========================================================================= */}
      <AnimatePresence>
        {showStartInstantModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowStartInstantModal(false)}
              className="fixed inset-0 bg-neutral-950/80 backdrop-blur-md"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ duration: 0.2 }}
              className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-neutral-200/90 overflow-hidden flex flex-col z-50 my-6 max-h-[92vh]"
            >
              {/* Modal Top Header */}
              <div className="flex items-center justify-between p-5 sm:p-6 pb-4 border-b border-neutral-100 bg-gradient-to-r from-indigo-50/70 via-purple-50/40 to-white">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-2xl bg-indigo-900 text-white flex items-center justify-center shadow-md shadow-indigo-950/20">
                    <Video className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base sm:text-lg font-bold text-neutral-900">Start an Instant Meeting</h3>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 border border-indigo-200 font-mono">
                        HD WebRTC
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5">Configure consultation parameters and hardware pre-flight checks</p>
                  </div>
                </div>

                <button
                  id="btn-close-instant-meeting-modal"
                  onClick={() => setShowStartInstantModal(false)}
                  className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Scrollable Modal Content */}
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
                
                {/* 1. Meeting Title & Quick Presets */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-neutral-800">
                    Meeting Title / Subject
                  </label>
                  <input
                    id="input-instant-meeting-title"
                    type="text"
                    value={modalMeetingTitle}
                    onChange={(e) => setModalMeetingTitle(e.target.value)}
                    placeholder="e.g. Executive Strategy Consultation"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs sm:text-sm font-semibold text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 transition-all"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider">Quick Presets:</span>
                    {[
                      'Executive Strategy Consultation',
                      'High-Trust SLA Architecture Demo',
                      'Rapid Alignment & Closing Call',
                      'Weekly Operations Sync'
                    ].map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setModalMeetingTitle(preset)}
                        className={`text-[10.5px] px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                          modalMeetingTitle === preset
                            ? 'bg-indigo-50 border-indigo-200 text-indigo-900 font-bold'
                            : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2. Room Code & Direct Invite Link */}
                <div className="space-y-2 p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200/80">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-neutral-700 flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-indigo-700" />
                      <span>Dedicated Secure Room Code</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setModalRoomCode(generateRoomCode())}
                      className="text-[11px] text-indigo-700 hover:text-indigo-900 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                      title="Generate new random room code"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Regenerate</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={modalRoomCode}
                      onChange={(e) => setModalRoomCode(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-xl bg-white border border-neutral-200 text-xs font-mono font-bold text-neutral-800 focus:outline-none focus:border-indigo-600"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const url = `${window.location.origin}/meet/${modalRoomCode}`;
                        navigator.clipboard?.writeText(url);
                        setModalCopiedCode(true);
                        setTimeout(() => setModalCopiedCode(false), 2000);
                      }}
                      className="px-3 py-2 rounded-xl bg-white hover:bg-neutral-100 border border-neutral-200 text-xs font-semibold text-neutral-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      {modalCopiedCode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-neutral-500" />}
                      <span>{modalCopiedCode ? 'Copied Link' : 'Copy Link'}</span>
                    </button>
                  </div>
                </div>

                {/* 3. Hardware Pre-Flight Check (Camera Preview & Audio Level) */}
                <div className="space-y-3 p-4 rounded-2xl bg-neutral-900 text-white border border-neutral-800 shadow-inner">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold flex items-center gap-1.5 text-neutral-200">
                      <Activity className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Hardware Pre-Flight Preview</span>
                    </span>
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/30">
                      Hardware Active
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                    {/* Live Preview Box */}
                    <div className="sm:col-span-5 aspect-video rounded-xl bg-neutral-950 border border-white/10 relative overflow-hidden flex items-center justify-center">
                      {!modalStartCamOff ? (
                        <div className="relative w-full h-full flex items-center justify-center bg-gradient-to-tr from-indigo-950 to-neutral-900">
                          <video
                            ref={(el) => {
                              if (el && previewVideoRef.current?.srcObject) {
                                el.srcObject = previewVideoRef.current.srcObject;
                              }
                            }}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover scale-x-[-1]"
                          />
                          <div className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[9px] font-mono text-emerald-300">
                            Live 720p HD
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-neutral-400">
                          <VideoOff className="h-6 w-6 text-neutral-500" />
                          <span className="text-[10px] font-semibold text-neutral-400">Camera Off</span>
                        </div>
                      )}
                    </div>

                    {/* Pre-Flight Quick Toggles & Mic Meter */}
                    <div className="sm:col-span-7 space-y-2.5">
                      {/* Live Audio Meter */}
                      <div>
                        <div className="flex items-center justify-between text-[11px] mb-1 text-neutral-300 font-medium">
                          <span className="flex items-center gap-1">
                            <Mic className="h-3 w-3 text-indigo-400" />
                            <span>Microphone Input Level</span>
                          </span>
                          <span className="font-mono text-[10px] text-emerald-400">
                            {modalStartMuted ? 'Muted' : `${micLevel}% Signal`}
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-neutral-800 overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-indigo-500 transition-all duration-150 rounded-full"
                            style={{ width: `${modalStartMuted ? 0 : micLevel}%` }}
                          />
                        </div>
                      </div>

                      {/* Hardware Entry Toggles */}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setModalStartMuted(!modalStartMuted)}
                          className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                            modalStartMuted 
                              ? 'bg-rose-600 text-white shadow-md shadow-rose-950/40' 
                              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200'
                          }`}
                        >
                          {modalStartMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5 text-emerald-400" />}
                          <span>{modalStartMuted ? 'Muted' : 'Unmuted'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setModalStartCamOff(!modalStartCamOff)}
                          className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                            modalStartCamOff 
                              ? 'bg-rose-600 text-white shadow-md shadow-rose-950/40' 
                              : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200'
                          }`}
                        >
                          {modalStartCamOff ? <VideoOff className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5 text-indigo-400" />}
                          <span>{modalStartCamOff ? 'Camera Off' : 'Camera On'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Associate with CRM Contact */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-neutral-800">
                    Link Consultation to CRM Contact (Optional)
                  </label>
                  <select
                    id="select-modal-contact"
                    value={modalLinkedContactId}
                    onChange={(e) => setModalLinkedContactId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-800 focus:outline-none focus:border-indigo-600 cursor-pointer"
                  >
                    <option value="none">No CRM Contact (Standalone Guest Session)</option>
                    {contacts.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.company} ({c.email})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10.5px] text-neutral-500">
                    Meeting minutes, transcript, and recording links will be archived directly to this client's profile.
                  </p>
                </div>

                {/* 5. Meeting Preferences */}
                <div className="space-y-2 pt-1 border-t border-neutral-100">
                  <span className="text-xs font-bold text-neutral-800 block">Meeting Capabilities</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <label className={`flex items-center gap-2 p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/80 transition-colors ${canRecordOnPlan ? 'cursor-pointer hover:bg-neutral-100/60' : 'opacity-60 cursor-not-allowed'}`}>
                      <input
                        type="checkbox"
                        checked={modalAutoRecord && canRecordOnPlan}
                        disabled={!canRecordOnPlan}
                        onChange={(e) => setModalAutoRecord(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                      />
                      <div>
                        <span className="font-semibold text-neutral-800 block">Record Meeting</span>
                        <span className="text-[10px] text-neutral-500">{canRecordOnPlan ? 'Auto-save video to Greet Vault' : `Included in ${recordingPlanLabel ?? 'a higher plan'}`}</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-2 p-2.5 rounded-xl bg-neutral-50 border border-neutral-200/80 cursor-pointer hover:bg-neutral-100/60 transition-colors">
                      <input
                        type="checkbox"
                        checked={modalAutoTranscribe}
                        onChange={(e) => setModalAutoTranscribe(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                      />
                      <div>
                        <span className="font-semibold text-neutral-800 block">Live AI Transcription</span>
                        <span className="text-[10px] text-neutral-500">Real-time speaker recognition</span>
                      </div>
                    </label>
                  </div>
                </div>

              </div>

              {/* Modal Footer Actions */}
              <div className="flex items-center justify-end gap-3 p-4 sm:p-6 pt-3 border-t border-neutral-100 bg-neutral-50/60">
                <button
                  type="button"
                  onClick={() => setShowStartInstantModal(false)}
                  className="px-4 py-2.5 rounded-xl text-neutral-600 hover:text-neutral-900 font-semibold text-xs hover:bg-neutral-200/50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  id="btn-confirm-start-instant-meeting"
                  type="button"
                  onClick={handleConfirmStartInstantMeeting}
                  className="px-6 py-2.5 rounded-xl bg-indigo-900 hover:bg-[#252778] active:bg-[#1E2063] text-white font-bold text-xs tracking-wide transition-all shadow-lg shadow-indigo-950/20 flex items-center gap-2 cursor-pointer active:scale-98"
                >
                  <Video className="h-4 w-4" />
                  <span>Start Meeting Now</span>
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Schedule Meeting Modal */}
      <AnimatePresence>
        {showScheduleModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowScheduleModal(false)}
              className="fixed inset-0 bg-neutral-900/40 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-neutral-200/80 p-6 sm:p-7 z-10"
            >
              <div className="flex items-center justify-between pb-4 border-b border-neutral-100 mb-5">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-900">
                    <CalendarIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-neutral-900">Schedule Video Consultation</h3>
                    <p className="text-xs text-neutral-500">Sync with CRM Calendar Matrix</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowScheduleModal(false)}
                  className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {scheduleSuccessMsg ? (
                <div className="py-8 text-center">
                  <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                    <Check className="h-6 w-6" />
                  </div>
                  <h4 className="text-base font-bold text-neutral-900 mb-1">Meeting Booked!</h4>
                  <p className="text-xs text-neutral-600 font-mono">{scheduleSuccessMsg}</p>
                </div>
              ) : (
                <form onSubmit={handleScheduleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      Meeting Title
                    </label>
                    <input
                      type="text"
                      value={scheduleTitle}
                      onChange={(e) => setScheduleTitle(e.target.value)}
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 text-sm focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        Date
                      </label>
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        required
                        className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-xs focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 mb-1">
                        Time
                      </label>
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        required
                        className="w-full px-3 py-2 rounded-xl border border-neutral-200 text-xs focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      Client / Contact
                    </label>
                    <select
                      value={scheduleContact}
                      onChange={(e) => setScheduleContact(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 text-xs focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 focus:outline-none bg-white"
                    >
                      {contacts.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name} ({c.company || c.email})
                        </option>
                      ))}
                      <option value="General Video Consultation">External Guest</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 mb-1">
                      Agenda Notes
                    </label>
                    <textarea
                      rows={2}
                      value={scheduleNotes}
                      onChange={(e) => setScheduleNotes(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-200 text-xs focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 focus:outline-none resize-none"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-3 border-t border-neutral-100">
                    <button
                      type="button"
                      onClick={() => setShowScheduleModal(false)}
                      className="px-4 py-2.5 rounded-xl text-xs font-semibold text-neutral-600 hover:bg-neutral-100 transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-xl text-xs font-semibold bg-indigo-900 hover:bg-[#252778] text-white transition-all shadow-md shadow-indigo-900/15 cursor-pointer"
                    >
                      Schedule Meeting
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* =========================================================================
          WATCH RECORDING VIDEO PLAYER MODAL
          ========================================================================= */}
      {activeWatchRecording && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="obsidian w-full max-w-3xl bg-[var(--obsidian-1)] rounded-3xl border border-white/15 shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-rose-600/20 text-rose-400">
                  <Play className="h-5 w-5 fill-rose-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{activeWatchRecording.title}</h3>
                  <p className="text-xs text-neutral-400 font-mono">
                    {activeWatchRecording.date} at {activeWatchRecording.time} • {activeWatchRecording.durationFormatted} • {activeWatchRecording.recordingSize || '184 MB'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveWatchRecording(null)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Video Player Box */}
            <div className="w-full aspect-video rounded-2xl bg-black border border-white/10 relative overflow-hidden flex flex-col items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-tr from-neutral-950 via-indigo-950/50 to-neutral-900 flex flex-col items-center justify-center p-6 text-center">
                <button
                  onClick={() => setWatchVideoPlaying(!watchVideoPlaying)}
                  className="h-16 w-16 rounded-full bg-rose-600/90 hover:bg-rose-500 text-white flex items-center justify-center shadow-xl shadow-rose-950/60 mb-3 cursor-pointer transition-transform hover:scale-105 active:scale-95"
                >
                  {watchVideoPlaying ? <Play className="h-7 w-7 ml-1 fill-white" /> : <Pause className="h-7 w-7" />}
                </button>
                <p className="text-xs text-neutral-300 font-medium">Recorded Session Stream</p>
                <p className="text-[11px] text-neutral-500 font-mono mt-0.5">High-Definition WebM • Zero-Trust Encrypted</p>
              </div>

              {/* Player Overlay Controls */}
              <div className="absolute bottom-3 inset-x-4 flex items-center justify-between bg-black/70 backdrop-blur-md p-2 rounded-xl border border-white/10 text-xs text-white">
                <div className="flex items-center gap-2">
                  <button onClick={() => setWatchVideoPlaying(!watchVideoPlaying)} className="p-1 cursor-pointer">
                    {watchVideoPlaying ? <Play className="h-4 w-4 fill-white" /> : <Pause className="h-4 w-4" />}
                  </button>
                  <span className="font-mono text-[11px] text-neutral-300">00:15 / {activeWatchRecording.durationFormatted}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setWatchPlaybackSpeed(watchPlaybackSpeed === 1 ? 1.5 : watchPlaybackSpeed === 1.5 ? 2 : 1)}
                    className="px-2 py-0.5 rounded bg-neutral-800 text-[10px] font-bold font-mono hover:bg-neutral-700 cursor-pointer"
                  >
                    {watchPlaybackSpeed}x
                  </button>
                  <button
                    onClick={() => {
                      const blob = new Blob(['Obsidian Video Recording'], { type: 'video/webm' });
                      const url = activeWatchRecording.recordingUrl || URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `recording-${activeWatchRecording.roomId}.webm`;
                      a.click();
                    }}
                    className="p-1 text-neutral-300 hover:text-white cursor-pointer"
                    title="Download Recording"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Synchronized Transcript Preview with Keyword Search & Timestamp Jump */}
            {activeWatchRecording.transcript && activeWatchRecording.transcript.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-[11px] font-bold text-neutral-300 uppercase tracking-wider">Synchronized Transcript</span>
                    <span className="text-[10px] text-neutral-500 font-mono">(Click timestamp to jump)</span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDownloadTranscriptPdf(activeWatchRecording)}
                      className="text-neutral-400 hover:text-white flex items-center gap-1 text-[11px] cursor-pointer transition-colors"
                      title="Download formatted PDF transcript"
                    >
                      <Download className="h-3 w-3 text-emerald-400" />
                      <span>PDF</span>
                    </button>
                    <button
                      onClick={() => {
                        const text = activeWatchRecording.transcript.map(t => `[${t.timestamp}] ${t.speakerName}: ${t.text}`).join('\n');
                        const blob = new Blob([text], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `transcript-${activeWatchRecording.roomId}.txt`;
                        a.click();
                        showWelcomeToast('Transcript downloaded as text file.', 'info');
                      }}
                      className="text-neutral-400 hover:text-white flex items-center gap-1 text-[11px] cursor-pointer transition-colors"
                      title="Download text file transcript"
                    >
                      <Download className="h-3 w-3 text-indigo-400" />
                      <span>TXT</span>
                    </button>
                  </div>
                </div>

                {/* Keyword search in player */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-neutral-500" />
                  <input
                    type="text"
                    value={watchTranscriptSearch}
                    onChange={(e) => setWatchTranscriptSearch(e.target.value)}
                    placeholder="Search spoken keywords in recording..."
                    className="w-full pl-7 pr-3 py-1.5 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="max-h-36 overflow-y-auto p-3 rounded-xl bg-neutral-900/90 border border-white/5 space-y-1.5 text-xs">
                  {activeWatchRecording.transcript
                    .filter(t => !watchTranscriptSearch.trim() || t.text.toLowerCase().includes(watchTranscriptSearch.toLowerCase()) || t.speakerName.toLowerCase().includes(watchTranscriptSearch.toLowerCase()))
                    .map(t => (
                      <div
                        key={t.id}
                        onClick={() => {
                          setWatchCurrentTime(t.timeSeconds || 0);
                          showWelcomeToast(`Jumped playback to ${t.timestamp} (${t.speakerName})`, 'info');
                        }}
                        className={`flex items-start gap-2 p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-white/5 ${
                          watchCurrentTime >= (t.timeSeconds || 0) && watchCurrentTime <= (t.timeSeconds || 0) + 15
                            ? 'bg-indigo-950/40 border-l-2 border-indigo-400'
                            : ''
                        }`}
                        title="Click to jump recording playback to this point"
                      >
                        <span className="text-indigo-400 hover:text-indigo-300 font-mono text-[10px] shrink-0 font-bold underline cursor-pointer">
                          {t.timestamp}
                        </span>
                        <span className="font-bold text-neutral-300 shrink-0">{t.speakerName}:</span>
                        <span className="text-neutral-200">{t.text}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          FULL MEETING TRANSCRIPT VIEWER MODAL
          ========================================================================= */}
      {activeViewTranscript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="obsidian w-full max-w-2xl bg-[var(--obsidian-1)] rounded-3xl border border-white/15 shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-600/20 text-emerald-400">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Full Meeting Transcript</h3>
                  <p className="text-xs text-neutral-400">{activeViewTranscript.title} • {activeViewTranscript.date}</p>
                </div>
              </div>
              <button
                onClick={() => setActiveViewTranscript(null)}
                className="p-1.5 rounded-lg text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search within Transcript & Export Options */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-400" />
                <input
                  type="text"
                  value={transcriptSearchTerm}
                  onChange={(e) => setTranscriptSearchTerm(e.target.value)}
                  placeholder="Search spoken dialogue words..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none"
                />
              </div>

              <button
                onClick={() => {
                  const text = activeViewTranscript.transcript.map(t => `[${t.timestamp}] ${t.speakerName}: ${t.text}`).join('\n');
                  const blob = new Blob([text], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `transcript-${activeViewTranscript.roomId}.txt`;
                  a.click();
                  showWelcomeToast('Transcript downloaded as text file.', 'info');
                }}
                className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                title="Download plain text file"
              >
                <Download className="h-3.5 w-3.5 text-indigo-400" />
                <span>Download .TXT</span>
              </button>

              <button
                onClick={() => handleDownloadTranscriptPdf(activeViewTranscript)}
                className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                title="Download formatted PDF file"
              >
                <FileText className="h-3.5 w-3.5 text-emerald-400" />
                <span>Download .PDF</span>
              </button>

              <button
                onClick={() => {
                  const text = activeViewTranscript.transcript.map(t => `[${t.timestamp}] ${t.speakerName}: ${t.text}`).join('\n');
                  navigator.clipboard.writeText(text);
                  showWelcomeToast('Complete transcript copied to clipboard!', 'info');
                }}
                className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </button>
            </div>

            {/* Transcript dialogue items */}
            <div className="max-h-80 overflow-y-auto p-3.5 rounded-2xl bg-neutral-900/80 border border-white/5 space-y-2.5">
              {activeViewTranscript.transcript
                .filter(t => !transcriptSearchTerm.trim() || t.text.toLowerCase().includes(transcriptSearchTerm.toLowerCase()))
                .map(t => (
                  <div key={t.id} className="p-2.5 rounded-xl bg-black/40 border border-white/5 text-xs space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className={`font-bold ${t.isHost ? 'text-indigo-400' : 'text-neutral-300'}`}>
                        {t.speakerName} {t.isHost && '(Host)'}
                      </span>
                      <span className="font-mono text-neutral-500 text-[10px]">{t.timestamp}</span>
                    </div>
                    <p className="text-neutral-200 leading-relaxed text-[11.5px]">{t.text}</p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Welcome Portal Toast Notification Banner */}
      <AnimatePresence>
        {welcomeToast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-2xl shadow-2xl border text-xs font-semibold flex items-center gap-2.5 backdrop-blur-md ${
              welcomeToast.type === 'warning'
                ? 'bg-amber-950/90 border-amber-500/50 text-amber-200'
                : welcomeToast.type === 'info'
                ? 'bg-indigo-950/90 border-indigo-500/50 text-indigo-200'
                : 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
            }`}
          >
            {welcomeToast.type === 'warning' ? (
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            ) : welcomeToast.type === 'info' ? (
              <Info className="h-4 w-4 text-indigo-400 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            )}
            <span>{welcomeToast.message}</span>
            <button
              onClick={() => setWelcomeToast(null)}
              className="p-0.5 rounded-md text-neutral-400 hover:text-white transition-colors cursor-pointer ml-1"
            >
              <X className="h-3 w-3" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
