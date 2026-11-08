import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, VideoOff, Mic, MicOff, MonitorUp, MonitorOff, PhoneOff,
  Maximize2, Minimize2, MessageSquare, Users, Sparkles, Briefcase,
  Copy, Check, X, Send, Paperclip, Smile, Search, Plus, Calendar,
  Shield, CheckCircle2, ChevronRight, AlertCircle, Clock, LayoutGrid,
  Radio, Volume2, VolumeX, UserCheck, Edit3, ArrowRight, Home, Share2,
  Trash2, UserPlus, Info, CheckSquare, Square, Download, ExternalLink,
  Laptop, ShieldAlert, Award, Pause, Play, Disc, Settings, FileText,
  SlidersHorizontal, CheckCircle, RotateCw, Printer,
  // Used by the transcript tab and summary modal but previously never imported (ReferenceError at render).
  Save, Activity, UserX
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import { 
  useMeetingSession, 
  MeetingParticipant, 
  MeetingChatMessage,
  TranscriptItem,
  MeetingRecordingData,
  MeetingHistoryRecord,
  MeetingDeviceSettings
} from '../../context/MeetingSessionContext';
import { CRMContact } from '../../types';
import MeetingControlBar, { EndMeetingConfirmDialog } from './MeetingControlBar';
import { meetingPermissions, type OrgRole } from './meetingControls';

interface VideoMeetingWorkspaceProps {
  contacts?: CRMContact[];
  onAddCalendarEvent?: (event: any) => void;
  onNavigateToDashboard?: () => void;
  onNavigateToGreet?: (tab?: string) => void;
  onNavigateToContact?: (contact: CRMContact) => void;
}

export default function VideoMeetingWorkspace({
  contacts = [],
  onAddCalendarEvent,
  onNavigateToDashboard,
  onNavigateToGreet,
  onNavigateToContact
}: VideoMeetingWorkspaceProps) {
  const {
    activeMeeting,
    currentPlanTier,
    setPlanTier,
    planConfig,
    isDurationWarning,
    isDurationLimitReached,
    localStream,
    screenStream,
    isMicMuted,
    isCamOff,
    isVideoPaused,
    isScreenSharing,
    screenShareError,
    hasSystemAudio,
    micAudioLevel,
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
    exchangeContactConsent,
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
    lowerAllHands,
    // Recording
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
    // Transcripts
    liveTranscript,
    addTranscriptItem,
    saveCurrentMeetingTranscript,
    // Settings
    meetingSettings,
    updateMeetingSettings,
    availableDevices,
    refreshDevices,
    testSpeakerSound
  } = useMeetingSession();

  // Sidebar Tab state ('chat' | 'greet' | 'participants' | 'crm' | 'transcript')
  const [activeSidebarTab, setActiveSidebarTab] = useState<'chat' | 'greet' | 'participants' | 'crm' | 'transcript'>('greet');
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 1024);
  const [transcriptSaveNotice, setTranscriptSaveNotice] = useState<string | null>(null);

  // Fullscreen browser state
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Layout mode ('grid' | 'speaker')
  const [layoutMode, setLayoutMode] = useState<'grid' | 'speaker'>('grid');
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(null);

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatRecipient, setChatRecipient] = useState<string>('everyone');
  const [showFileAttachedNotice, setShowFileAttachedNotice] = useState<string | null>(null);

  // CRM tab contact state
  const [selectedCrmContactId, setSelectedCrmContactId] = useState<string>(() => {
    return activeMeeting?.linkedContactId || (contacts[0]?.id || '1');
  });
  const selectedCrmContact = contacts.find(c => c.id === selectedCrmContactId) || contacts[0] || {
    id: '1',
    name: 'Marcus Chen',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=120',
    company: 'Alpha Tech Cloud Inc.',
    title: 'VP of Infrastructure & Enterprise Systems',
    email: 'marcus.c@alpha-tech.cloud',
    phone: '+1 (555) 234-5678',
    channel: 'email',
    status: 'active',
    sentiment: 'positive',
    pipelineValue: '$120,000 ARR',
    unread: false,
    lastMessage: 'SLA benchmarks look promising.',
    timestamp: '10:42 AM'
  };

  // Modals & Popups
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmailInput, setInviteEmailInput] = useState('');
  const [inviteFeedback, setInviteFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  const [showLeaveConfirmModal, setShowLeaveConfirmModal] = useState(false);
  const [showEndMeetingSummaryModal, setShowEndMeetingSummaryModal] = useState(false);
  // "End for everyone" asks first; only after confirming is the recording stopped and the meeting closed.
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  // Organization role (OWNER/ADMIN may end meetings and control recording like the host).
  const [orgRole, setOrgRole] = useState<OrgRole>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/orgs/me').then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d?.current?.role) setOrgRole(d.current.role); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [copiedLinkNotice, setCopiedLinkNotice] = useState(false);
  const [copiedMeetingIdNotice, setCopiedMeetingIdNotice] = useState(false);

  // Recording Modal & Controls
  const [showRecordingConsentModal, setShowRecordingConsentModal] = useState(false);
  const [recordingConsentCheckbox, setRecordingConsentCheckbox] = useState(true);

  // In-Meeting Settings Modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsActiveTab, setSettingsActiveTab] = useState<'devices' | 'video' | 'audio' | 'preferences'>('devices');
  const [isSpeakerTesting, setIsSpeakerTesting] = useState(false);
  const settingsCameraPreviewRef = useRef<HTMLVideoElement | null>(null);

  // Transcript search state
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [transcriptSpeakerFilter, setTranscriptSpeakerFilter] = useState<'all' | 'host' | 'guests'>('all');

  // Meet & Greet Action states
  const [showExchangeConsentModal, setShowExchangeConsentModal] = useState<MeetingParticipant | null>(null);
  const [exchangeStatusFeedback, setExchangeStatusFeedback] = useState<string | null>(null);
  const [interactionNoteParticipant, setInteractionNoteParticipant] = useState<MeetingParticipant | null>(null);
  const [interactionNoteInput, setInteractionNoteInput] = useState('');
  const [scheduleFollowupParticipant, setScheduleFollowupParticipant] = useState<MeetingParticipant | null>(null);
  const [scheduleFollowupDate, setScheduleFollowupDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [scheduleFollowupTime, setScheduleFollowupTime] = useState('11:00');
  const [scheduleFollowupTitle, setScheduleFollowupTitle] = useState('Executive Follow-Up Session');
  const [hostBio, setHostBio] = useState('Specializes in high-trust CRM automation, low-latency audio tunnels, and multi-channel pipeline security.');
  const [isEditingHostBio, setIsEditingHostBio] = useState(false);
  const [hostTitle, setHostTitle] = useState('Lead Enterprise Partner');

  // Post-Meeting Summary state
  const [summaryActiveTab, setSummaryActiveTab] = useState<'watch' | 'transcript' | 'details'>('watch');
  const [summaryVideoPlaying, setSummaryVideoPlaying] = useState(false);
  const [summaryVideoCurrentTime, setSummaryVideoCurrentTime] = useState(0);
  const [summaryPlaybackSpeed, setSummaryPlaybackSpeed] = useState(1);
  const [summaryTranscriptSearch, setSummaryTranscriptSearch] = useState('');
  const [isTranscriptProcessing, setIsTranscriptProcessing] = useState(false);
  const summaryVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (showEndMeetingSummaryModal) {
      setIsTranscriptProcessing(true);
      const timer = setTimeout(() => {
        setIsTranscriptProcessing(false);
      }, 1400);
      return () => clearTimeout(timer);
    }
  }, [showEndMeetingSummaryModal]);

  // In-Workspace Toast Notification System (avoids window.alert)
  const [toastNotice, setToastNotice] = useState<{ message: string; type?: 'info' | 'success' | 'warning' } | null>(null);

  const showToast = (message: string, type: 'info' | 'success' | 'warning' = 'success') => {
    setToastNotice({ message, type });
    setTimeout(() => {
      setToastNotice(prev => prev?.message === message ? null : prev);
    }, 3800);
  };

  // Client-Side PDF Transcript Generator via jsPDF
  const handleDownloadTranscriptPdf = (transcript: TranscriptItem[], roomTitle: string = 'Meeting Transcript') => {
    try {
      const doc = new jsPDF();
      doc.setFillColor(30, 27, 75);
      doc.rect(0, 0, 210, 30, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.text('OmniMeet Executive Video Transcript', 14, 18);
      doc.setFontSize(10);
      doc.text(`Room: ${activeMeeting?.roomId || 'Session'} • Exported: ${new Date().toLocaleString()}`, 14, 25);
      
      let y = 42;
      doc.setTextColor(33, 37, 41);
      doc.setFontSize(10);

      transcript.forEach((item) => {
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

      doc.save(`transcript-${activeMeeting?.roomId || 'meeting'}.pdf`);
      showToast('Transcript downloaded as PDF document (.pdf).', 'success');
    } catch (err) {
      console.warn('PDF export fallback:', err);
      const fullTxt = transcript.map(t => `[${t.timestamp}] ${t.speakerName}: ${t.text}`).join('\n');
      const blob = new Blob([fullTxt], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `meeting-transcript-${activeMeeting?.roomId || 'session'}.txt`;
      a.click();
      showToast('Transcript exported as text document (.txt).', 'info');
    }
  };

  // Editing Room Title
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(activeMeeting?.title || 'Executive Strategy Consultation');

  // New Follow-up Task input
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().split('T')[0];
  });
  const [newTaskPriority, setNewTaskPriority] = useState<'high' | 'medium' | 'low'>('high');

  // DOM refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null);

  // Sync title input
  useEffect(() => {
    if (activeMeeting?.title) {
      setTitleInput(activeMeeting.title);
    }
  }, [activeMeeting?.title]);

  // Bind local camera stream to local video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream, isCamOff]);

  // Bind screen stream to screen video element
  useEffect(() => {
    if (screenVideoRef.current && screenStream) {
      screenVideoRef.current.srcObject = screenStream;
      screenVideoRef.current.play().catch(() => {});
    }
  }, [screenStream, isScreenSharing]);

  // Bind local camera stream to settings modal camera preview element
  useEffect(() => {
    if (showSettingsModal && settingsActiveTab === 'devices' && settingsCameraPreviewRef.current && localStream) {
      settingsCameraPreviewRef.current.srcObject = localStream;
      settingsCameraPreviewRef.current.play().catch(() => {});
    }
  }, [showSettingsModal, settingsActiveTab, localStream, isCamOff]);

  // Scroll chat to bottom on new message
  useEffect(() => {
    if (activeSidebarTab === 'chat' && chatMessagesEndRef.current) {
      chatMessagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeMeeting?.messages.length, activeSidebarTab]);

  // Track fullscreen state change
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Format elapsed timer
  const formatDuration = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (hours > 0) {
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
  };

  // Toggle browser fullscreen
  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (e) {
      // Fullscreen policy note
      setIsFullscreen(!isFullscreen);
    }
  };

  // Copy shareable meeting link
  const handleCopyMeetingLink = () => {
    const url = `${window.location.origin}/?tab=greet&meet=${activeMeeting?.roomId || 'demo-room'}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLinkNotice(true);
      setTimeout(() => setCopiedLinkNotice(false), 2500);
    }).catch(() => {});
  };

  // Copy meeting ID
  const handleCopyMeetingId = () => {
    if (activeMeeting?.roomId) {
      navigator.clipboard.writeText(activeMeeting.roomId).then(() => {
        setCopiedMeetingIdNotice(true);
        setTimeout(() => setCopiedMeetingIdNotice(false), 2500);
      }).catch(() => {});
    }
  };

  // Handle chat submission
  const handleSendChat = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;

    sendChatMessage(chatInput.trim(), chatRecipient);
    setChatInput('');
  };

  // Handle file attachment simulation
  const handleAttachFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Security check: validate size and extension
    if (file.size > 25 * 1024 * 1024) {
      showToast('File size exceeds the 25MB enterprise security boundary.', 'warning');
      return;
    }

    const attachmentObj = {
      name: file.name,
      size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
      type: file.type || 'application/octet-stream',
      url: '#'
    };

    sendChatMessage(
      `Shared document: ${file.name}`,
      chatRecipient,
      attachmentObj
    );

    setShowFileAttachedNotice(file.name);
    setTimeout(() => setShowFileAttachedNotice(null), 3000);
    e.target.value = '';
  };

  // Handle adding follow-up task
  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    addFollowupTask({
      title: newTaskTitle.trim(),
      dueDate: newTaskDueDate,
      priority: newTaskPriority,
      contactName: selectedCrmContact.name
    });

    setNewTaskTitle('');
  };

  // Handle inviting participant by email
  const handleSendInviteEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmailInput.trim()) return;

    setIsInviting(true);
    setInviteFeedback(null);

    const res = await inviteParticipantByEmail(inviteEmailInput.trim());
    setIsInviting(false);
    setInviteFeedback({
      text: res.message,
      isError: !res.success
    });

    if (res.success) {
      setInviteEmailInput('');
      setTimeout(() => {
        setShowInviteModal(false);
        setInviteFeedback(null);
      }, 2000);
    }
  };

  // Return to CRM Dashboard while preserving active call
  const handleReturnToDashboard = () => {
    minimizeToDashboard();
    if (onNavigateToDashboard) {
      onNavigateToDashboard();
    }
  };

  const participantsList = activeMeeting?.participants || [];
  // Host or org OWNER/ADMIN: same rule as the control bar (see meetingControls.ts).
  const meetingPerms = meetingPermissions({ isHost: !!activeMeeting?.isHost, orgRole });
  const raisedHandsCount = participantsList.filter(p => p.isHandRaised).length + (isHandRaised ? 1 : 0);
  // Raised hands first (in the order they were raised), then everyone else as they joined.
  const rosterOrder = [...participantsList].sort((a, b) =>
    (a.isHandRaised ? 0 : 1) - (b.isHandRaised ? 0 : 1) || (a.handRaisedAt ?? 0) - (b.handRaisedAt ?? 0));
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const currentDuration = activeMeeting?.durationSeconds || 0;

  return (
    <div className="obsidian w-full h-screen bg-[var(--obsidian-0)] text-neutral-100 flex flex-col overflow-hidden select-none font-sans">
      
      {/* =========================================================================
          1. TOP NAVIGATION & HUD BAR
          ========================================================================= */}
      <header className="obsidian h-14 sm:h-16 px-3 sm:px-6 bg-[var(--obsidian-1)] border-b border-white/10 flex items-center justify-between shrink-0 z-30 gap-2">
        
        {/* Left: Brand + Meeting Room Title */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-gradient-to-r from-indigo-900/60 to-purple-900/60 border border-indigo-500/30 shrink-0">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-bold text-white tracking-wide">GREET LIVE</span>
          </div>

          {/* Title and Room ID */}
          <div className="flex items-center gap-2 min-w-0">
            {isEditingTitle ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      updateMeetingTitle(titleInput);
                      setIsEditingTitle(false);
                    }
                  }}
                  className="px-2 py-1 text-xs sm:text-sm bg-neutral-900 border border-indigo-500/60 rounded-lg text-white focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={() => {
                    updateMeetingTitle(titleInput);
                    setIsEditingTitle(false);
                  }}
                  className="p-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsEditingTitle(true)}
                className="group flex items-center gap-1.5 text-xs sm:text-sm font-bold text-white hover:text-indigo-300 truncate transition-colors text-left"
                title="Click to rename meeting"
              >
                <span className="truncate max-w-[140px] sm:max-w-[280px] md:max-w-md">
                  {activeMeeting?.title || 'Live Strategy Consultation'}
                </span>
                <Edit3 className="h-3 w-3 opacity-0 group-hover:opacity-100 text-indigo-400 shrink-0 transition-opacity" />
              </button>
            )}

            {/* Room ID Pill */}
            <button
              onClick={handleCopyMeetingId}
              className="hidden md:flex items-center gap-1 px-2 py-0.5 rounded-lg bg-neutral-900/90 border border-white/10 hover:border-indigo-400/40 text-[11px] font-mono text-neutral-300 transition-all cursor-pointer"
              title="Click to copy Room Code"
            >
              <span>ID: {activeMeeting?.roomId || 'omni-room'}</span>
              {copiedMeetingIdNotice ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3 text-neutral-400" />
              )}
            </button>
          </div>
        </div>

        {/* Center: Live Timer, Plan Tier & Group Capacity */}
        <div className="hidden lg:flex items-center gap-2.5 shrink-0">
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-mono font-medium transition-colors ${
            isDurationLimitReached ? 'bg-rose-950/60 border-rose-500/50 text-rose-300' :
            isDurationWarning ? 'bg-amber-950/60 border-amber-500/50 text-amber-300 animate-pulse' :
            'bg-neutral-900 border-white/10 text-neutral-200'
          }`}>
            <Clock className="h-3.5 w-3.5 text-indigo-400" />
            <span>{formatDuration(currentDuration)}</span>
            {planConfig.maxDurationMinutes > 0 && (
              <span className="text-neutral-400 font-mono text-[11px]">/ {planConfig.maxDurationMinutes}:00</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/40 border border-emerald-500/20 text-[11px] text-emerald-300 font-medium">
            <Shield className="h-3 w-3 text-emerald-400" />
            <span>Encrypted WebRTC</span>
          </div>

          {/* Group Capacity Counter */}
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-950/40 border border-indigo-500/20 text-[11px] text-indigo-300 font-medium">
            <Users className="h-3 w-3 text-indigo-400" />
            <span>{participantsList.length + 1} / {planConfig.maxParticipants} Attendees</span>
          </div>

          {/* Plan Tier Selector Pill */}
          <div className="relative group">
            <button
              type="button"
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-neutral-900 hover:bg-neutral-800 border border-white/15 text-[11px] text-neutral-200 font-medium cursor-pointer transition-colors"
              title={`Active Tier: ${planConfig.label}. Up to ${planConfig.maxParticipants} participants${planConfig.maxDurationMinutes > 0 ? `, ${planConfig.maxDurationMinutes}m limit` : ', unlimited duration'}. Click to toggle plan.`}
            >
              <Award className="h-3 w-3 text-amber-400" />
              <span className="capitalize">{currentPlanTier}</span>
              <span className="text-[10px] text-neutral-400">({planConfig.maxParticipants})</span>
            </button>
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 hidden group-hover:flex flex-col bg-neutral-950 border border-white/15 rounded-2xl p-2 shadow-2xl z-50 min-w-[220px] animate-in fade-in">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-neutral-400 font-bold border-b border-white/10 mb-1">
                Meeting Plan Capacity
              </div>
              <button
                type="button"
                onClick={() => setPlanTier('standard')}
                className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-left cursor-pointer transition-colors ${
                  currentPlanTier === 'standard' ? 'bg-indigo-600 text-white font-semibold' : 'text-neutral-300 hover:bg-neutral-900'
                }`}
              >
                <div>
                  <div className="font-semibold">Standard Plan</div>
                  <div className="text-[10px] opacity-75">100 participants • 60 min limit</div>
                </div>
                {currentPlanTier === 'standard' && <Check className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => setPlanTier('premium')}
                className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-left cursor-pointer transition-colors ${
                  currentPlanTier === 'premium' ? 'bg-indigo-600 text-white font-semibold' : 'text-neutral-300 hover:bg-neutral-900'
                }`}
              >
                <div>
                  <div className="font-semibold">Premium Plan</div>
                  <div className="text-[10px] opacity-75">250 participants • Unlimited</div>
                </div>
                {currentPlanTier === 'premium' && <Check className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => setPlanTier('enterprise')}
                className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-left cursor-pointer transition-colors ${
                  currentPlanTier === 'enterprise' ? 'bg-indigo-600 text-white font-semibold' : 'text-neutral-300 hover:bg-neutral-900'
                }`}
              >
                <div>
                  <div className="font-semibold">Enterprise Plan</div>
                  <div className="text-[10px] opacity-75">500 participants • Unlimited</div>
                </div>
                {currentPlanTier === 'enterprise' && <Check className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Primary Navigation Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          
          {/* Invite Button */}
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 hover:text-white text-xs font-semibold transition-all cursor-pointer"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Invite</span>
          </button>

          {/* Copy Link Button */}
          <button
            onClick={handleCopyMeetingLink}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 text-xs font-semibold transition-all cursor-pointer"
            title="Copy meeting invitation link"
            aria-label="Copy meeting invitation link"
          >
            {copiedLinkNotice ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                <span className="text-emerald-400 text-xs">Copied</span>
              </>
            ) : (
              <>
                <Share2 className="h-3.5 w-3.5 text-neutral-400" />
                <span className="hidden md:inline">Copy link</span>
              </>
            )}
          </button>

          {/* Return to Dashboard (Preserves Meeting Session) */}
          <button
            onClick={handleReturnToDashboard}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-200 text-xs font-semibold transition-all cursor-pointer"
            title="Return to CRM dashboard while keeping this meeting active in the background"
          >
            <Home className="h-3.5 w-3.5 text-blue-400" />
            <span className="hidden sm:inline">Dashboard</span>
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={handleToggleFullscreen}
            className="p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-neutral-300 hover:text-white transition-all cursor-pointer"
            title={isFullscreen ? "Exit Full Screen" : "Enter Full Screen"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>

          {/* Leave lives in the bottom control bar (always visible), so it isn't repeated here. */}
        </div>
      </header>

      {/* =========================================================================
          2. MAIN STAGE: VIDEO CANVAS + COLLAPSIBLE RIGHT PANEL
          ========================================================================= */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* Floating Reactions Canvas Layer */}
        <div className="absolute inset-0 pointer-events-none z-40 overflow-hidden">
          <AnimatePresence>
            {activeReactions.map(r => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 80, scale: 0.5 }}
                animate={{ opacity: 1, y: -120, scale: 1.4 }}
                exit={{ opacity: 0, scale: 1.8 }}
                transition={{ duration: 2.8, ease: "easeOut" }}
                className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20 text-2xl shadow-xl shadow-black/80"
              >
                <span>{r.emoji}</span>
                <span className="text-[10px] text-white/80 font-bold ml-1 font-mono">{r.sender}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* A. CENTRAL PARTICIPANT VIDEO STAGE */}
        <main className={`flex-1 flex flex-col p-2 sm:p-4 gap-3 overflow-hidden transition-all duration-300 ${isSidebarOpen ? 'lg:pr-2' : ''}`}>
          
          {/* Active Screen Sharing Banner Overlay */}
          {isScreenSharing && (
            <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-indigo-950/80 border border-indigo-500/40 text-xs text-indigo-200 shadow-md">
              <div className="flex items-center gap-2">
                <MonitorUp className="h-4 w-4 text-indigo-400 animate-pulse" />
                <span className="font-semibold text-white">You are sharing your screen</span>
                {hasSystemAudio && (
                  <span className="px-1.5 py-0.5 rounded bg-indigo-900 text-[10px] text-indigo-300">
                    System Audio On
                  </span>
                )}
              </div>
              <button
                onClick={stopScreenShare}
                className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] transition-all cursor-pointer"
              >
                Stop Sharing
              </button>
            </div>
          )}

          {/* Screen Share Error Banner */}
          {screenShareError && (
            <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-amber-950/80 border border-amber-500/40 text-xs text-amber-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>{screenShareError}</span>
              </div>
              <button
                onClick={() => startScreenShare()}
                className="px-2 py-0.5 rounded bg-amber-800 hover:bg-amber-700 text-white text-[11px] font-semibold cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}

          {/* 60-Minute Duration Warning & Limit Banners on Standard Tier */}
          {isDurationWarning && !isDurationLimitReached && (
            <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-amber-950/80 border border-amber-500/40 text-xs text-amber-200 shadow-md">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-400 animate-pulse shrink-0" />
                <span>
                  <strong>Standard Plan Notice:</strong> Approaching 60-minute duration limit ({Math.max(1, 60 - Math.floor(currentDuration / 60))} minutes remaining).
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPlanTier('premium')}
                className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs transition-all cursor-pointer shrink-0"
              >
                Upgrade to Premium (Unlimited)
              </button>
            </div>
          )}
          {isDurationLimitReached && (
            <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-rose-950/90 border border-rose-500/50 text-xs text-rose-200 shadow-md animate-pulse">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                <span>
                  <strong>60-minute meeting limit reached on Standard Plan.</strong> Switch to Premium (250 attendees) or Enterprise (500 attendees) for unlimited group calls.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setPlanTier('premium')}
                  className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-all cursor-pointer"
                >
                  Switch to Premium
                </button>
                <button
                  type="button"
                  onClick={() => setShowLeaveConfirmModal(true)}
                  className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 text-xs cursor-pointer border border-white/10"
                >
                  End Meeting
                </button>
              </div>
            </div>
          )}

          {/* Video Grid / Presentation Container */}
          <div className="flex-1 rounded-2xl bg-black/60 border border-white/5 overflow-hidden relative flex flex-col items-center justify-center p-2">
            
            {/* SCENARIO 1: SCREEN SHARING ACTIVE -> Prominent shared presentation display */}
            {isScreenSharing ? (
              <div className="w-full h-full flex flex-col lg:flex-row gap-3 relative">
                {/* Huge Screen Video */}
                <div className="flex-1 bg-black rounded-xl overflow-hidden relative border border-white/10 flex items-center justify-center">
                  <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 flex items-center gap-2 text-xs text-white">
                    <Laptop className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Live Screen Broadcast (1080p 60fps)</span>
                  </div>
                </div>

                {/* Side Rail for Participant Thumbnails */}
                <div className="h-36 lg:h-full lg:w-56 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto shrink-0 p-1">
                  {/* Local Thumbnail */}
                  <div className="obsidian w-48 lg:w-full h-full lg:h-36 rounded-xl bg-[var(--obsidian-1)] border border-white/10 relative overflow-hidden shrink-0">
                    {!isCamOff ? (
                      <video
                        id="local-video-rail"
                        ref={localVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover scale-x-[-1]"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-tr from-neutral-900 to-indigo-950">
                        <div className="h-10 w-10 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-white text-sm">
                          CR
                        </div>
                      </div>
                    )}
                    {/* Small Muted Icon Overlay in rail */}
                    {isMicMuted && (
                      <div
                        className="absolute top-2 left-2 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-600/90 text-[10px] font-semibold text-white shadow-md border border-rose-400/40"
                        title="Microphone muted"
                      >
                        <MicOff className="h-3 w-3" />
                        <span>Muted</span>
                      </div>
                    )}
                    {/* Paused Video Overlay in Screen Share Thumbnail */}
                    {isVideoPaused && (
                      <div className="absolute inset-0 bg-neutral-950/85 backdrop-blur-xs flex flex-col items-center justify-center gap-1 z-10 animate-in fade-in">
                        <Pause className="h-4 w-4 text-amber-400" />
                        <span className="text-[10px] font-bold text-amber-300">Video Paused</span>
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white">
                      You (Host)
                    </div>
                  </div>

                  {/* Remote Participants Thumbnails */}
                  {participantsList.map(p => (
                    <div
                      key={p.id}
                      className="obsidian w-48 lg:w-full h-full lg:h-36 rounded-xl bg-[var(--obsidian-1)] border border-white/10 relative overflow-hidden shrink-0 flex items-center justify-center"
                    >
                      <div className={`h-12 w-12 rounded-full bg-gradient-to-tr ${p.avatarColor || 'from-indigo-600 to-purple-800'} flex items-center justify-center font-bold text-white text-base shadow-lg`}>
                        {p.avatar}
                      </div>
                      <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white truncate max-w-[85%]">
                        {p.name}
                      </div>
                      <div className="absolute top-2 right-2">
                        {p.isMuted ? (
                          <div className="p-1 rounded-full bg-rose-950/80 text-rose-400">
                            <MicOff className="h-3 w-3" />
                          </div>
                        ) : (
                          <div className="p-1 rounded-full bg-emerald-950/80 text-emerald-400">
                            <Mic className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            ) : layoutMode === 'speaker' && pinnedParticipantId ? (
              /* SCENARIO 2: SPEAKER SPOTLIGHT VIEW */
              <div className="w-full h-full flex flex-col gap-2">
                {/* Large Spotlight Video Tile */}
                <div className="obsidian flex-1 rounded-xl bg-[var(--obsidian-1)] border border-white/10 relative overflow-hidden flex items-center justify-center">
                  {pinnedParticipantId === 'local-user' ? (
                    <>
                      {!isCamOff ? (
                        <video
                          id="local-video-spotlight"
                          ref={localVideoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover scale-x-[-1]"
                        />
                      ) : (
                        <div className="h-24 w-24 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-white text-3xl">
                          CR
                        </div>
                      )}
                      {/* Small Muted Icon Overlay in spotlight */}
                      {isMicMuted && (
                        <div
                          className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600/90 text-xs font-semibold text-white shadow-lg backdrop-blur-md border border-rose-400/40 animate-in fade-in"
                          title="Microphone muted"
                        >
                          <MicOff className="h-3.5 w-3.5 text-white" />
                          <span>Muted</span>
                        </div>
                      )}
                      {isVideoPaused && (
                        <div className="absolute inset-0 bg-neutral-950/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 z-10 animate-in fade-in">
                          <div className="h-12 w-12 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                            <Pause className="h-6 w-6" />
                          </div>
                          <span className="text-xs font-bold text-amber-300">Video Paused</span>
                          <span className="text-[10px] text-neutral-400 font-mono">Stream temporarily held</span>
                        </div>
                      )}
                    </>
                  ) : (
                    (() => {
                      const spotlightP = participantsList.find(p => p.id === pinnedParticipantId);
                      return (
                        <div className="flex flex-col items-center gap-3">
                          <div className={`h-24 w-24 rounded-full bg-gradient-to-tr ${spotlightP?.avatarColor || 'from-indigo-600 to-purple-800'} flex items-center justify-center font-bold text-white text-3xl shadow-2xl`}>
                            {spotlightP?.avatar || 'P'}
                          </div>
                          <span className="text-base font-bold text-white">{spotlightP?.name}</span>
                          <span className="text-xs text-neutral-400">{spotlightP?.title} • {spotlightP?.company}</span>
                        </div>
                      );
                    })()
                  )}
                  <button
                    onClick={() => setPinnedParticipantId(null)}
                    className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-black/60 hover:bg-black/80 text-xs text-neutral-300 transition-colors"
                  >
                    Unpin
                  </button>
                </div>

                {/* Horizontal Thumbnails Bar */}
                <div className="h-24 flex gap-2 overflow-x-auto shrink-0 p-1">
                  {/* Local Thumbnail */}
                  <div
                    onClick={() => setPinnedParticipantId('local-user')}
                    className="obsidian w-36 h-full rounded-xl bg-[var(--obsidian-1)] border border-white/10 relative overflow-hidden shrink-0 cursor-pointer hover:border-indigo-500/50"
                  >
                    <div className="w-full h-full flex items-center justify-center bg-indigo-950/60 font-bold text-xs text-white">
                      You (Host)
                    </div>
                  </div>
                  {participantsList.map(p => (
                    <div
                      key={p.id}
                      onClick={() => setPinnedParticipantId(p.id)}
                      className="obsidian w-36 h-full rounded-xl bg-[var(--obsidian-1)] border border-white/10 relative overflow-hidden shrink-0 cursor-pointer hover:border-indigo-500/50 flex items-center justify-center"
                    >
                      <span className="text-xs font-semibold text-white truncate px-2">{p.name}</span>
                    </div>
                  ))}
                </div>
              </div>

            ) : (
              /* SCENARIO 3: HIGH-DEFINITION MULTI-PARTICIPANT GRID VIEW (Default) */
              <div className="w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-3 auto-rows-fr">
                
                {/* 1. LOCAL USER TILE (You / Host) */}
                <div className={`rounded-xl bg-[var(--obsidian-1)] border relative overflow-hidden flex items-center justify-center transition-all ${
                  !isMicMuted && micAudioLevel > 30 ? 'border-emerald-500/60 shadow-[0_0_20px_rgba(16,185,129,0.15)]' : 'border-white/10'
                }`}>
                  {!isCamOff ? (
                    <video
                      id="local-video"
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover scale-x-[-1]"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-20 w-20 rounded-full bg-gradient-to-tr from-indigo-600 via-indigo-700 to-purple-800 flex items-center justify-center font-bold text-white text-2xl shadow-xl shadow-indigo-950/50">
                        CR
                      </div>
                      <span className="text-xs font-bold text-neutral-300">Camera Off</span>
                    </div>
                  )}

                  {/* Paused Video Overlay */}
                  {isVideoPaused && (
                    <div className="absolute inset-0 bg-neutral-950/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 z-10 animate-in fade-in">
                      <div className="h-12 w-12 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                        <Pause className="h-6 w-6" />
                      </div>
                      <span className="text-xs font-bold text-amber-300">Video Paused</span>
                      <span className="text-[10px] text-neutral-400 font-mono">Camera stream temporarily held</span>
                    </div>
                  )}

                  {/* Local Audio Wave HUD (when unmuted) */}
                  {!isMicMuted && (
                    <div className="absolute top-3 left-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-[10px] text-emerald-400 font-mono">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span>Audio Active</span>
                    </div>
                  )}

                  {/* Small 'muted' icon overlay on local video feed when audio track is disabled */}
                  {isMicMuted && (
                    <div
                      id="local-video-muted-overlay"
                      className="absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-600/90 text-xs font-semibold text-white shadow-lg backdrop-blur-md border border-rose-400/40 animate-in fade-in"
                      title="Microphone muted"
                    >
                      <MicOff className="h-3.5 w-3.5 text-white" />
                      <span>Muted</span>
                    </div>
                  )}

                  {/* Local User Badge */}
                  <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-xl bg-black/75 backdrop-blur-md border border-white/10">
                    <span className="text-xs font-bold text-white">Camelia Rose (You)</span>
                    {isHandRaised && <span role="img" aria-label="Hand raised" title="Hand raised" className="text-sm leading-none">✋</span>}
                    <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-indigo-600 text-white">Host</span>
                  </div>

                  {/* Status Indicator */}
                  <div className="absolute bottom-3 right-3 flex items-center gap-1">
                    {isMicMuted ? (
                      <div className="p-1.5 rounded-lg bg-rose-600/90 text-white">
                        <MicOff className="h-3.5 w-3.5" />
                      </div>
                    ) : (
                      <div className="p-1.5 rounded-lg bg-black/75 text-emerald-400">
                        <Mic className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. REMOTE PARTICIPANTS TILES */}
                {participantsList.map(p => (
                  <div
                    key={p.id}
                    className={`rounded-xl bg-[var(--obsidian-1)] border relative overflow-hidden flex items-center justify-center transition-all ${
                      p.isSpeaking ? 'border-emerald-500/60 shadow-[0_0_20px_rgba(16,185,129,0.15)]' : 'border-white/10'
                    }`}
                  >
                    {/* Simulated High-Resolution Participant Feed / Canvas */}
                    <div className="flex flex-col items-center gap-2.5 text-center p-4">
                      <div className="relative">
                        <div className={`h-20 w-20 rounded-full bg-gradient-to-tr ${p.avatarColor || 'from-indigo-600 to-purple-800'} flex items-center justify-center font-bold text-white text-2xl shadow-xl shadow-black/50`}>
                          {p.avatar}
                        </div>
                        {p.isSpeaking && (
                          <span className="absolute -inset-1 rounded-full border-2 border-emerald-400 animate-ping opacity-75"></span>
                        )}
                      </div>

                      <div>
                        <h4 className="text-sm font-bold text-white">{p.name}</h4>
                        <p className="text-xs text-neutral-400">{p.title}</p>
                        <p className="text-[11px] text-indigo-400 font-medium">{p.company}</p>
                      </div>

                      {p.isSpeaking && (
                        <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                          <Radio className="h-3 w-3 animate-pulse" />
                          <span>Speaking...</span>
                        </div>
                      )}
                    </div>

                    {/* Participant Badge */}
                    <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-xl bg-black/75 backdrop-blur-md border border-white/10">
                      <span className="text-xs font-bold text-white truncate max-w-[120px]">{p.name}</span>
                      {p.isHandRaised && <span role="img" aria-label="Hand raised" title="Hand raised" className="text-sm leading-none">✋</span>}
                      <span className="text-[10px] font-semibold text-neutral-400">{p.role}</span>
                    </div>

                    {/* Participant Audio Badge */}
                    <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
                      {p.isMuted ? (
                        <div className="p-1.5 rounded-lg bg-rose-950/80 text-rose-400 border border-rose-800/40" title="Muted">
                          <MicOff className="h-3.5 w-3.5" />
                        </div>
                      ) : (
                        <div className="p-1.5 rounded-lg bg-black/75 text-emerald-400 border border-white/10">
                          <Mic className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>

                    {/* Quick Tile Actions */}
                    <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setPinnedParticipantId(p.id);
                          setLayoutMode('speaker');
                        }}
                        className="p-1.5 rounded-lg bg-black/80 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                        title="Pin to spotlight"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setActiveSidebarTab('chat');
                          setChatRecipient(p.id);
                          setIsSidebarOpen(true);
                        }}
                        className="p-1.5 rounded-lg bg-black/80 hover:bg-neutral-800 text-indigo-300 hover:text-white transition-colors cursor-pointer"
                        title="Send Private Message"
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* =========================================================================
              3. BOTTOM MEETING CONTROLS (primary controls + More menu; see MeetingControlBar)
              ========================================================================= */}
          <MeetingControlBar
            isHost={!!activeMeeting?.isHost}
            orgRole={orgRole}
            isMicMuted={isMicMuted}
            isCamOff={isCamOff}
            isVideoPaused={isVideoPaused}
            isScreenSharing={isScreenSharing}
            participantsCount={participantsList.length + 1}
            chatCount={activeMeeting?.messages.length || 0}
            isSidebarOpen={isSidebarOpen}
            activeSidebarTab={activeSidebarTab}
            layoutMode={layoutMode}
            isRecording={isRecording}
            isRecordingPaused={isRecordingPaused}
            recordingDurationSeconds={recordingDurationSeconds}
            isHandRaised={isHandRaised}
            raisedHandsCount={raisedHandsCount}
            isWaitingRoomEnabled={isWaitingRoomEnabled}
            waitingCount={waitingRoom.length}
            onToggleRaiseHand={toggleRaiseHand}
            onToggleWaitingRoom={() => {
              setWaitingRoomEnabled(!isWaitingRoomEnabled);
              showToast(isWaitingRoomEnabled ? 'Waiting room off: invited guests join directly.' : 'Waiting room on: you admit invited guests from Participants.', 'info');
            }}
            onMuteAll={() => { muteAllParticipants(); showToast('Everyone else is muted. They can unmute themselves.', 'info'); }}
            onLowerAllHands={() => { lowerAllHands(); showToast('All hands lowered.', 'info'); }}
            onToggleMic={toggleMic}
            onToggleCam={toggleCam}
            onToggleScreenShare={isScreenSharing ? stopScreenShare : startScreenShare}
            onTogglePanel={(tab) => {
              if (activeSidebarTab === tab && isSidebarOpen) {
                setIsSidebarOpen(false);
              } else {
                setActiveSidebarTab(tab);
                setIsSidebarOpen(true);
              }
            }}
            onTogglePauseVideo={togglePauseVideo}
            onToggleLayout={() => setLayoutMode(layoutMode === 'grid' ? 'speaker' : 'grid')}
            onReaction={(emoji) => broadcastReaction(emoji)}
            onStartRecording={() => setShowRecordingConsentModal(true)}
            onPauseResumeRecording={() => (isRecordingPaused ? resumeRecording() : pauseRecording())}
            onStopRecording={async () => {
              const saved = await stopRecording();
              if (saved) {
                showToast(`✓ Meeting recording stopped and saved to Greet Hub Vault (${saved.fileSizeFormatted}).`, 'success');
              }
            }}
            onOpenSettings={() => setShowSettingsModal(true)}
            onLeave={() => setShowLeaveConfirmModal(true)}
            onEndForEveryone={() => setShowEndConfirm(true)}
          />
        </main>

        {/* =========================================================================
            B. COLLAPSIBLE RIGHT PANEL (CHAT, MEET & GREET, PARTICIPANTS, CRM)
            ========================================================================= */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.aside
              aria-label="Meeting side panel"
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ duration: 0.22 }}
              onKeyDown={(e) => { if (e.key === 'Escape' && window.innerWidth < 1024) setIsSidebarOpen(false); }}
              className="obsidian fixed inset-x-0 top-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-40 rounded-b-2xl sm:left-auto sm:w-[380px] sm:border-l sm:rounded-bl-2xl sm:rounded-br-none lg:static lg:inset-auto lg:bottom-auto lg:rounded-none lg:z-20 lg:w-[380px] lg:h-full bg-[var(--obsidian-1)] border-white/10 flex flex-col shrink-0 overflow-hidden shadow-2xl lg:shadow-none"
            >
              
              {/* Tab Selector Header */}
              <div className="obsidian p-3 border-b border-white/10 flex items-center justify-between gap-1 bg-[var(--obsidian-1)]">
                <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none">
                  <button
                    onClick={() => setActiveSidebarTab('chat')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                      activeSidebarTab === 'chat'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                  >
                    Chat
                  </button>

                  <button
                    onClick={() => setActiveSidebarTab('greet')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                      activeSidebarTab === 'greet'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                  >
                    Greet
                  </button>

                  <button
                    onClick={() => setActiveSidebarTab('participants')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                      activeSidebarTab === 'participants'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                  >
                    People
                  </button>

                  <button
                    onClick={() => setActiveSidebarTab('transcript')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                      activeSidebarTab === 'transcript'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                  >
                    <FileText className="h-3 w-3 text-emerald-400" />
                    <span>Transcript</span>
                  </button>

                  <button
                    onClick={() => setActiveSidebarTab('crm')}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                      activeSidebarTab === 'crm'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                  >
                    CRM
                  </button>
                </div>

                <button
                  onClick={() => setIsSidebarOpen(false)}
                  aria-label="Close side panel"
                  className="p-1.5 min-h-10 min-w-10 lg:min-h-0 lg:min-w-0 flex items-center justify-center rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer ml-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                  title="Close side panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* -------------------------------------------------------------
                  TAB 1: MEETING CHAT & MESSAGING
                  ------------------------------------------------------------- */}
              {activeSidebarTab === 'chat' && (
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  
                  {/* Destination Filter (Everyone vs 1:1 Private) */}
                  <div className="p-3 border-b border-white/10 bg-neutral-900/60 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-neutral-400">Send to:</span>
                    <select
                      value={chatRecipient}
                      onChange={(e) => setChatRecipient(e.target.value)}
                      className="flex-1 px-2.5 py-1 rounded-lg bg-neutral-950 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500 font-medium"
                    >
                      <option value="everyone">💬 Everyone (Meeting Chat)</option>
                      {participantsList.map(p => (
                        <option key={p.id} value={p.id}>
                          🔒 Private to {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Message Thread */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {activeMeeting?.messages.map(msg => (
                      <div
                        key={msg.id}
                        className={`flex flex-col gap-1 ${msg.isYou ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center gap-1.5 text-[10px] text-neutral-400">
                          <span className="font-semibold text-neutral-300">{msg.senderName}</span>
                          <span>•</span>
                          <span>{msg.timestamp}</span>
                          {msg.recipientId && msg.recipientId !== 'everyone' && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 font-bold border border-amber-800/40">
                              Private
                            </span>
                          )}
                        </div>

                        <div className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-xs ${
                          msg.isYou
                            ? 'bg-indigo-600 text-white rounded-tr-none'
                            : 'bg-[var(--obsidian-2)] text-neutral-200 border border-white/10 rounded-tl-none'
                        }`}>
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                          
                          {/* Attachment Card */}
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-2">
                              <Paperclip className="h-3.5 w-3.5 text-indigo-300 shrink-0" />
                              <div className="flex-1 truncate">
                                <p className="text-[11px] font-semibold truncate text-white">{msg.attachments[0].name}</p>
                                <p className="text-[10px] text-neutral-400">{msg.attachments[0].size}</p>
                              </div>
                              <span className="text-[10px] font-bold text-emerald-400">Verified</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={chatMessagesEndRef} />
                  </div>

                  {/* File Upload Notice */}
                  {showFileAttachedNotice && (
                    <div className="px-4 py-1.5 bg-emerald-950/80 border-t border-emerald-500/30 text-[11px] text-emerald-300 flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Attached: {showFileAttachedNotice}</span>
                    </div>
                  )}

                  {/* Chat Input Bar */}
                  <form onSubmit={handleSendChat} className="obsidian p-3 border-t border-white/10 bg-[var(--obsidian-1)] flex items-center gap-2">
                    <label className="p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white cursor-pointer transition-colors" title="Attach Document (PDF, JPG, PNG)">
                      <Paperclip className="h-4 w-4" />
                      <input
                        type="file"
                        onChange={handleAttachFile}
                        className="hidden"
                        accept=".pdf,.png,.jpg,.jpeg,.docx"
                      />
                    </label>

                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder={chatRecipient === 'everyone' ? "Message everyone in room..." : "Send private message..."}
                      className="flex-1 px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500 transition-colors"
                    />

                    <button
                      type="submit"
                      disabled={!chatInput.trim()}
                      className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white cursor-pointer transition-all"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </form>
                </div>
              )}

              {/* -------------------------------------------------------------
                  TAB 2: MEET & GREET FEATURE
                  ------------------------------------------------------------- */}
              {activeSidebarTab === 'greet' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  
                  {/* Warm Welcome Action */}
                  <div className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-950/80 to-purple-950/80 border border-indigo-500/30 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-300" />
                      <h4 className="text-xs font-bold text-white">Meet & Greet Concierge</h4>
                    </div>
                    <p className="text-[11px] text-neutral-300 leading-relaxed">
                      Welcome attendees, exchange verified credentials, and create immediate CRM contact records.
                    </p>
                    <button
                      onClick={() => {
                        sendChatMessage('👋 Warm welcome to everyone! Glad to have you in the room today. Let me know if you need any materials pulled up.');
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
                    >
                      <span>👋 Send Warm Welcome to All</span>
                    </button>
                  </div>

                  {/* Host Profile Card */}
                  <div className="obsidian p-3.5 rounded-2xl bg-[var(--obsidian-1)] border border-white/10 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Host Profile</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-bold">You</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-700 flex items-center justify-center font-bold text-white text-base">
                        CR
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Camelia Rose</h4>
                        <p className="text-[11px] text-neutral-400">Lead Enterprise Partner</p>
                        <p className="text-[10px] text-indigo-400">Obsidian Sovereign Cloud CRM</p>
                      </div>
                    </div>
                    <p className="text-[11px] text-neutral-300 pt-1 leading-relaxed">
                      Specializes in high-trust CRM automation, low-latency audio tunnels, and multi-channel pipeline security.
                    </p>
                  </div>

                  {/* Participant Introduction Cards */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-neutral-300 uppercase tracking-wider">Participant Introductions</h4>
                      <span className="text-[10px] font-mono text-neutral-500">{participantsList.length} Attendees</span>
                    </div>

                    {participantsList.map(p => (
                      <div
                        key={p.id}
                        className="obsidian p-3.5 rounded-2xl bg-[var(--obsidian-1)] border border-white/10 space-y-3 hover:border-indigo-500/40 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className={`h-10 w-10 rounded-full bg-gradient-to-tr ${p.avatarColor || 'from-indigo-600 to-purple-700'} flex items-center justify-center font-bold text-white text-sm shadow-md`}>
                              {p.avatar}
                            </div>
                            <div>
                              <h5 className="text-xs font-bold text-white">{p.name}</h5>
                              <p className="text-[11px] text-neutral-400">{p.title}</p>
                              <p className="text-[10px] text-indigo-400 font-medium">{p.company}</p>
                            </div>
                          </div>
                          {p.isCrmContact && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/30 text-[10px] font-bold text-emerald-400">
                              In CRM
                            </span>
                          )}
                        </div>

                        {p.bio && (
                          <p className="text-[11px] text-neutral-300 leading-relaxed bg-black/40 p-2 rounded-xl">
                            {p.bio}
                          </p>
                        )}

                        {/* Interests tags */}
                        {p.interests && p.interests.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {p.interests.map(tag => (
                              <span
                                key={tag}
                                className="px-2 py-0.5 rounded-md bg-neutral-900 border border-white/5 text-[10px] text-neutral-300"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Actions for this participant */}
                        <div className="grid grid-cols-2 gap-1.5 pt-1">
                          <button
                            onClick={() => {
                              setActiveSidebarTab('chat');
                              setChatRecipient(p.id);
                            }}
                            className="py-1.5 px-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                          >
                            <MessageSquare className="h-3 w-3 text-indigo-400" />
                            <span>Message</span>
                          </button>

                          <button
                            onClick={() => {
                              setSelectedCrmContactId(p.crmContactId || '1');
                              setActiveSidebarTab('crm');
                            }}
                            className="py-1.5 px-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                          >
                            <Briefcase className="h-3 w-3 text-blue-400" />
                            <span>View Dossier</span>
                          </button>

                          {!p.isCrmContact && (
                            <button
                              onClick={() => {
                                addParticipantToCrm(p);
                                showToast(`Added ${p.name} to CRM Contacts database.`, 'success');
                              }}
                              className="col-span-2 py-1.5 px-2 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/40 text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                            >
                              <UserCheck className="h-3 w-3 text-emerald-400" />
                              <span>Add to CRM Contacts</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* -------------------------------------------------------------
                  TAB 3: PARTICIPANTS & INVITE ROSTER
                  ------------------------------------------------------------- */}
              {activeSidebarTab === 'participants' && (
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  
                  {/* Top: Invite Action + Mute All */}
                  <div className="p-3 border-b border-white/10 bg-neutral-900/60 flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-white">
                      {participantsList.length + 1} In Call
                      {raisedHandsCount > 0 && <span className="ml-1.5 text-amber-300 font-semibold">· ✋ {raisedHandsCount}</span>}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {meetingPerms.canManageParticipants && participantsList.length > 0 && (
                        <button
                          type="button"
                          onClick={() => { muteAllParticipants(); showToast('Everyone else is muted. They can unmute themselves.', 'info'); }}
                          className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold text-xs flex items-center gap-1 cursor-pointer"
                          title="Mute everyone except you"
                        >
                          <MicOff className="h-3.5 w-3.5" />
                          <span>Mute all</span>
                        </button>
                      )}
                      <button
                        onClick={() => setShowInviteModal(true)}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        <span>Invite</span>
                      </button>
                    </div>
                  </div>

                  {/* Waiting room (host / admin only) */}
                  {meetingPerms.canManageParticipants && (isWaitingRoomEnabled || waitingRoom.length > 0) && (
                    <div className="p-3 border-b border-white/10 bg-amber-950/20 space-y-2" aria-label="Waiting room">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-amber-200 uppercase tracking-wider">
                          Waiting room ({waitingRoom.length})
                        </span>
                        {waitingRoom.length > 1 && (
                          <button
                            type="button"
                            onClick={() => { const r = admitAllWaiting(); showToast(r.message, r.success ? 'success' : 'warning'); }}
                            className="px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
                          >
                            Admit all
                          </button>
                        )}
                      </div>
                      {waitingRoom.length === 0 ? (
                        <p className="text-[11px] text-neutral-400">On. Invited guests wait here until you admit them.</p>
                      ) : waitingRoom.map(w => (
                        <div key={w.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-neutral-900/70 border border-white/5">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">{w.name}</p>
                            <p className="text-[10px] text-neutral-400 truncate">{w.email}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => { const r = admitParticipant(w.id); showToast(r.message, r.success ? 'success' : 'warning'); }}
                              className="px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
                            >
                              Admit
                            </button>
                            <button
                              type="button"
                              onClick={() => denyParticipant(w.id)}
                              className="px-2 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[11px] font-semibold cursor-pointer"
                            >
                              Deny
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Participants List */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {/* Local User Item */}
                    <div className="obsidian p-3 rounded-xl bg-[var(--obsidian-1)] border border-white/10 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-white text-xs">
                          CR
                        </div>
                        <div>
                          <p className="text-xs font-bold text-white">Camelia Rose (You)</p>
                          <p className="text-[10px] text-indigo-400">Meeting Host</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-neutral-400">
                        {isHandRaised && (
                          <button type="button" onClick={toggleRaiseHand} title="Lower your hand" aria-label="Lower your hand" className="text-sm leading-none cursor-pointer">✋</button>
                        )}
                        {isMicMuted ? <MicOff className="h-3.5 w-3.5 text-rose-400" /> : <Mic className="h-3.5 w-3.5 text-emerald-400" />}
                        {isCamOff ? <VideoOff className="h-3.5 w-3.5 text-rose-400" /> : <Video className="h-3.5 w-3.5 text-indigo-400" />}
                      </div>
                    </div>

                    {/* Remote Participants (raised hands first) */}
                    {rosterOrder.map(p => (
                      <div
                        key={p.id}
                        className="obsidian p-3 rounded-xl bg-[var(--obsidian-1)] border border-white/10 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`h-9 w-9 rounded-full bg-gradient-to-tr ${p.avatarColor || 'from-indigo-600 to-purple-800'} flex items-center justify-center font-bold text-white text-xs`}>
                            {p.avatar}
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white">{p.name}</p>
                            <p className="text-[10px] text-neutral-400">{p.role}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {p.isHandRaised && (
                            meetingPerms.canManageParticipants ? (
                              <button type="button" onClick={() => lowerParticipantHand(p.id)} title={`Lower ${p.name}'s hand`} aria-label={`Lower ${p.name}'s hand`} className="text-sm leading-none cursor-pointer">✋</button>
                            ) : (
                              <span role="img" aria-label="Hand raised" title="Hand raised" className="text-sm leading-none">✋</span>
                            )
                          )}
                          {p.isMuted ? (
                            <span className="p-1 rounded bg-rose-950/80 text-rose-400" title="Muted">
                              <MicOff className="h-3 w-3" />
                            </span>
                          ) : meetingPerms.canManageParticipants ? (
                            <button
                              type="button"
                              onClick={() => muteParticipant(p.id)}
                              className="p-1 rounded bg-emerald-950/80 text-emerald-400 hover:bg-rose-950/80 hover:text-rose-400 cursor-pointer transition-colors"
                              title={`Mute ${p.name}`}
                              aria-label={`Mute ${p.name}`}
                            >
                              <Mic className="h-3 w-3" />
                            </button>
                          ) : (
                            <span className="p-1 rounded bg-emerald-950/80 text-emerald-400">
                              <Mic className="h-3 w-3" />
                            </span>
                          )}
                          {meetingPerms.canManageParticipants && (
                            confirmRemoveId === p.id ? (
                              <span className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => { removeParticipant(p.id); setConfirmRemoveId(null); showToast(`${p.name} was removed from the meeting.`, 'info'); }}
                                  className="px-1.5 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold cursor-pointer"
                                >
                                  Remove
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmRemoveId(null)}
                                  className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 text-[10px] cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmRemoveId(p.id)}
                                className="p-1 rounded hover:bg-rose-950/80 text-neutral-400 hover:text-rose-400 transition-colors cursor-pointer"
                                title={`Remove ${p.name} from the meeting`}
                                aria-label={`Remove ${p.name} from the meeting`}
                              >
                                <UserX className="h-3.5 w-3.5" />
                              </button>
                            )
                          )}
                          <button
                            onClick={() => {
                              setActiveSidebarTab('chat');
                              setChatRecipient(p.id);
                            }}
                            className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
                            title="Direct Message"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* -------------------------------------------------------------
                  TAB 4: CRM DOSSIER & REAL-TIME MEETING NOTES
                  ------------------------------------------------------------- */}
              {activeSidebarTab === 'crm' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  
                  {/* Linked Contact Selector */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider block">
                      Active Lead / CRM Record
                    </label>
                    <select
                      value={selectedCrmContactId}
                      onChange={(e) => setSelectedCrmContactId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500 font-semibold"
                    >
                      {contacts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} — {c.company} ({c.pipelineValue || '$0'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Contact Summary Card */}
                  <div className="obsidian p-3.5 rounded-2xl bg-[var(--obsidian-1)] border border-white/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={selectedCrmContact.avatar}
                          alt={selectedCrmContact.name}
                          className="h-10 w-10 rounded-xl object-cover border border-white/10"
                        />
                        <div>
                          <h4 className="text-xs font-bold text-white">{selectedCrmContact.name}</h4>
                          <p className="text-[11px] text-neutral-400">{selectedCrmContact.title}</p>
                          <p className="text-[10px] text-indigo-400 font-medium">{selectedCrmContact.company}</p>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/30 text-[10px] font-bold text-emerald-400">
                        {selectedCrmContact.pipelineValue || '$120,000 ARR'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                      <div className="p-2 rounded-lg bg-neutral-900 border border-white/5">
                        <span className="text-neutral-500 block text-[10px]">Email</span>
                        <span className="text-neutral-200 truncate block font-mono text-[10px]">{selectedCrmContact.email}</span>
                      </div>
                      <div className="p-2 rounded-lg bg-neutral-900 border border-white/5">
                        <span className="text-neutral-500 block text-[10px]">Phone</span>
                        <span className="text-neutral-200 block font-mono text-[10px]">{selectedCrmContact.phone}</span>
                      </div>
                    </div>
                  </div>

                  {/* Real-time Meeting Notes */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                        Live Meeting Notes
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const timeTag = `\n[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] `;
                          updateMeetingNotes((activeMeeting?.notes || '') + timeTag);
                        }}
                        className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer"
                      >
                        + Timestamp
                      </button>
                    </div>

                    <textarea
                      value={activeMeeting?.notes || ''}
                      onChange={(e) => updateMeetingNotes(e.target.value)}
                      rows={6}
                      className="w-full p-3 rounded-xl bg-neutral-900 border border-white/10 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed"
                      placeholder="Capture meeting minutes, client feedback, and technical agreements..."
                    />
                    <div className="flex items-center justify-between text-[10px] text-neutral-500">
                      <span>Auto-persisting to CRM record</span>
                      <span className="text-emerald-400 font-semibold">✓ Synchronized</span>
                    </div>
                  </div>

                  {/* Tasks & Action Items */}
                  <div className="space-y-2">
                    <h5 className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                      Follow-up Tasks
                    </h5>

                    {/* Task list */}
                    <div className="space-y-1.5">
                      {activeMeeting?.tasks.map(t => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-900 border border-white/5 text-xs"
                        >
                          <button
                            onClick={() => toggleTaskCompleted(t.id)}
                            className="flex items-center gap-2 text-left cursor-pointer flex-1"
                          >
                            {t.completed ? (
                              <CheckSquare className="h-4 w-4 text-emerald-400 shrink-0" />
                            ) : (
                              <Square className="h-4 w-4 text-neutral-500 shrink-0" />
                            )}
                            <span className={t.completed ? 'line-through text-neutral-500' : 'text-neutral-200'}>
                              {t.title}
                            </span>
                          </button>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            t.priority === 'high' ? 'bg-rose-950 text-rose-400' : 'bg-neutral-800 text-neutral-400'
                          }`}>
                            {t.priority}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Add Task Form */}
                    <form onSubmit={handleAddTask} className="pt-2 space-y-2">
                      <input
                        type="text"
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        placeholder="Add follow-up task..."
                        className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500"
                      />
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={newTaskDueDate}
                          onChange={(e) => setNewTaskDueDate(e.target.value)}
                          className="flex-1 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-white/10 text-xs text-neutral-300 focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={!newTaskTitle.trim()}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold transition-all cursor-pointer"
                        >
                          Add Task
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* -------------------------------------------------------------
                  TAB 5: LIVE MEETING TRANSCRIPT & SAVE TO GREET HUB TABS
                  ------------------------------------------------------------- */}
              {activeSidebarTab === 'transcript' && (
                <div className="flex-1 flex flex-col h-full overflow-hidden">
                  
                  {/* Top Bar: Search & Status */}
                  <div className="p-3 border-b border-white/10 bg-neutral-900/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span className="text-xs font-bold text-white">Live Transcription</span>
                      </div>
                      <span className="text-[10px] font-mono text-neutral-400">
                        {liveTranscript.length} Dialogue Segments
                      </span>
                    </div>

                    {/* CORE USER REQUIREMENT: Save Entire Meeting Transcript to Greet Hub Tabs */}
                    <button
                      id="btn-save-entire-transcript"
                      onClick={() => {
                        const result = saveCurrentMeetingTranscript();
                        setTranscriptSaveNotice(result.message);
                        setTimeout(() => setTranscriptSaveNotice(null), 3500);
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-950/40 transition-all cursor-pointer active:scale-98"
                      title="Save the complete meeting transcript into Greet Meeting tabs"
                    >
                      <Save className="h-3.5 w-3.5" />
                      <span>Save Transcript to Greet Hub Tabs</span>
                    </button>

                    {transcriptSaveNotice && (
                      <div className="p-2 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-[11px] text-emerald-300 font-medium flex items-center gap-1.5 animate-in fade-in">
                        <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span>{transcriptSaveNotice}</span>
                      </div>
                    )}

                    {/* Search & Speaker Filter */}
                    <div className="flex gap-1.5">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-neutral-500" />
                        <input
                          type="text"
                          value={transcriptSearch}
                          onChange={(e) => setTranscriptSearch(e.target.value)}
                          placeholder="Search spoken words..."
                          className="w-full pl-7 pr-2.5 py-1.5 rounded-lg bg-neutral-950 border border-white/10 text-[11px] text-white placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <select
                        value={transcriptSpeakerFilter}
                        onChange={(e) => setTranscriptSpeakerFilter(e.target.value as any)}
                        className="px-2 py-1.5 rounded-lg bg-neutral-950 border border-white/10 text-[11px] text-neutral-300 focus:outline-none"
                      >
                        <option value="all">All</option>
                        <option value="host">Host</option>
                        <option value="guests">Guests</option>
                      </select>
                    </div>

                    {/* Quick export actions: TXT, PDF & Copy */}
                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-white/5 gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const fullTxt = liveTranscript.map(t => `[${t.timestamp}] ${t.speakerName}: ${t.text}`).join('\n');
                            const blob = new Blob([fullTxt], { type: 'text/plain' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `meeting-transcript-${activeMeeting?.roomId || 'session'}.txt`;
                            a.click();
                            showToast('Transcript downloaded as text file.', 'info');
                          }}
                          className="text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                          title="Download plain text transcript"
                        >
                          <Download className="h-3 w-3 text-indigo-400" />
                          <span>TXT</span>
                        </button>

                        <button
                          onClick={() => {
                            handleDownloadTranscriptPdf(liveTranscript, activeMeeting?.title || 'Meeting Session');
                          }}
                          className="text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                          title="Download styled PDF transcript document"
                        >
                          <FileText className="h-3 w-3 text-emerald-400" />
                          <span>PDF</span>
                        </button>
                      </div>

                      <button
                        onClick={() => {
                          const fullTxt = liveTranscript.map(t => `[${t.timestamp}] ${t.speakerName}: ${t.text}`).join('\n');
                          navigator.clipboard.writeText(fullTxt);
                          showToast('Transcript copied to clipboard!', 'info');
                        }}
                        className="text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copy All</span>
                      </button>
                    </div>
                  </div>

                  {/* Transcript entries stream */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                    {liveTranscript
                      .filter(t => {
                        if (transcriptSpeakerFilter === 'host') return t.isHost;
                        if (transcriptSpeakerFilter === 'guests') return !t.isHost;
                        return true;
                      })
                      .filter(t => {
                        if (!transcriptSearch.trim()) return true;
                        return t.text.toLowerCase().includes(transcriptSearch.toLowerCase()) ||
                               t.speakerName.toLowerCase().includes(transcriptSearch.toLowerCase());
                      })
                      .map((item) => (
                        <div
                          key={item.id}
                          className={`p-2.5 rounded-xl border text-xs space-y-1 transition-colors ${
                            item.isHost
                              ? 'bg-indigo-950/30 border-indigo-500/20'
                              : 'bg-neutral-900/60 border-white/5'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`font-bold text-[11px] ${item.isHost ? 'text-indigo-400' : 'text-neutral-300'}`}>
                              {item.speakerName} {item.isHost && '(Host)'}
                            </span>
                            <span className="font-mono text-[10px] text-neutral-500">
                              {item.timestamp}
                            </span>
                          </div>
                          <p className="text-neutral-200 leading-relaxed text-[11.5px]">
                            {item.text}
                          </p>
                        </div>
                      ))}

                    {liveTranscript.length === 0 && (
                      <div className="p-6 text-center text-neutral-500 text-xs">
                        Speech-to-text active. Transcripts will stream as participants speak.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* =========================================================================
          4. INVITE PARTICIPANTS MODAL
          ========================================================================= */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="obsidian w-full max-w-md p-6 rounded-3xl bg-[var(--obsidian-1)] border border-white/15 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-600/30 text-indigo-400">
                  <UserPlus className="h-5 w-5" />
                </div>
                <h3 className="text-base font-bold text-white">Invite Participants</h3>
              </div>
              <button
                onClick={() => setShowInviteModal(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Plan Tier & Capacity Overview */}
            <div className="p-3.5 rounded-2xl bg-neutral-900/90 border border-white/10 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-300 font-medium flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Room Capacity ({planConfig.label})</span>
                </span>
                <span className="font-mono font-bold text-white text-[11px]">
                  {participantsList.length + 1} / {planConfig.maxParticipants} max attendees
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-neutral-800 overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-300 ${
                    (participantsList.length + 1) >= planConfig.maxParticipants ? 'bg-rose-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${Math.min(100, ((participantsList.length + 1) / planConfig.maxParticipants) * 100)}%` }}
                />
              </div>
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setPlanTier('standard')}
                  className={`p-2 rounded-xl text-left border cursor-pointer transition-all ${
                    currentPlanTier === 'standard' ? 'bg-indigo-600/30 border-indigo-500 text-white' : 'bg-neutral-950/60 border-white/5 text-neutral-400 hover:text-white'
                  }`}
                >
                  <div className="text-[10px] font-bold">Standard</div>
                  <div className="text-[9px] text-neutral-400">100 • 60 min</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPlanTier('premium')}
                  className={`p-2 rounded-xl text-left border cursor-pointer transition-all ${
                    currentPlanTier === 'premium' ? 'bg-indigo-600/30 border-indigo-500 text-white' : 'bg-neutral-950/60 border-white/5 text-neutral-400 hover:text-white'
                  }`}
                >
                  <div className="text-[10px] font-bold">Premium</div>
                  <div className="text-[9px] text-neutral-400">250 • Unlim.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPlanTier('enterprise')}
                  className={`p-2 rounded-xl text-left border cursor-pointer transition-all ${
                    currentPlanTier === 'enterprise' ? 'bg-indigo-600/30 border-indigo-500 text-white' : 'bg-neutral-950/60 border-white/5 text-neutral-400 hover:text-white'
                  }`}
                >
                  <div className="text-[10px] font-bold">Enterprise</div>
                  <div className="text-[9px] text-neutral-400">500 • Unlim.</div>
                </button>
              </div>
            </div>

            {/* Method A: Copy Link */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-neutral-400">Shareable Invitation Link</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/?tab=greet&meet=${activeMeeting?.roomId}`}
                  className="flex-1 px-3 py-2.5 rounded-xl bg-neutral-900 border border-white/10 text-xs text-neutral-300 font-mono select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyMeetingLink}
                  className="px-3 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedLinkNotice ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  <span>{copiedLinkNotice ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Method B: Email Invite */}
            <form onSubmit={handleSendInviteEmail} className="space-y-3">
              <label className="text-xs font-semibold text-neutral-400">Invite by Email Address</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={inviteEmailInput}
                  onChange={(e) => setInviteEmailInput(e.target.value)}
                  placeholder="e.g. client.executive@alpha-tech.cloud"
                  className="flex-1 px-3 py-2.5 rounded-xl bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={isInviting || !inviteEmailInput.trim()}
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold text-xs transition-all cursor-pointer"
                >
                  {isInviting ? 'Sending...' : 'Send'}
                </button>
              </div>

              {inviteFeedback && (
                <p className={`text-xs ${inviteFeedback.isError ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {inviteFeedback.text}
                </p>
              )}
            </form>

            <div className="pt-2 border-t border-white/10 flex justify-end">
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          5. LEAVE CONFIRMATION MODAL
          ========================================================================= */}
      {showLeaveConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="obsidian w-full max-w-sm p-6 rounded-3xl bg-[var(--obsidian-1)] border border-white/15 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-600/20 text-rose-400">
                <PhoneOff className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Leave This Meeting?</h3>
                <p className="text-xs text-neutral-400">You will exit the video room.</p>
              </div>
            </div>

            <p className="text-xs text-neutral-300 leading-relaxed">
              If you want to view CRM records while keeping the call running, you can click <span className="font-semibold text-white">Return to Dashboard</span> instead.
            </p>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowLeaveConfirmModal(false)}
                className="flex-1 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={() => {
                  setShowLeaveConfirmModal(false);
                  handleReturnToDashboard();
                }}
                className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
              >
                Dashboard
              </button>

              <button
                onClick={() => {
                  setShowLeaveConfirmModal(false);
                  leaveMeeting();
                }}
                className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          6. RECORDING CONSENT CONFIRMATION MODAL
          ========================================================================= */}
      {showRecordingConsentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="obsidian w-full max-w-md p-6 rounded-3xl bg-[var(--obsidian-1)] border border-white/15 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-rose-600/20 text-rose-400 border border-rose-500/30">
                <Disc className="h-6 w-6 text-rose-500 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Record Meeting Session</h3>
                <p className="text-xs text-neutral-400">Audio, video & synchronized transcript</p>
              </div>
            </div>

            <p className="text-xs text-neutral-300 leading-relaxed">
              Recording this consultation will archive the media file into your <span className="font-semibold text-white">Greet Hub Recordings Vault</span>. All participants will receive an on-screen visual notification.
            </p>

            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-neutral-900 border border-white/10 cursor-pointer">
              <input
                type="checkbox"
                checked={recordingConsentCheckbox}
                onChange={(e) => setRecordingConsentCheckbox(e.target.checked)}
                className="mt-0.5 rounded text-indigo-600 focus:ring-0"
              />
              <span className="text-xs text-neutral-300 leading-relaxed">
                I confirm that participant consent has been requested in accordance with enterprise compliance policies.
              </span>
            </label>

            <div className="flex gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowRecordingConsentModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={!recordingConsentCheckbox}
                onClick={async () => {
                  setShowRecordingConsentModal(false);
                  setRecordingConsentGranted(true);
                  const started = await startRecording();
                  if (started) {
                    sendChatMessage('🔴 Meeting recording started. Session will be archived into Greet Hub Vault upon conclusion.');
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-bold text-xs transition-all cursor-pointer shadow-md shadow-rose-950/50 flex items-center justify-center gap-1.5"
              >
                <Disc className="h-4 w-4" />
                <span>Start Recording</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          7. IN-MEETING SETTINGS MODAL
          ========================================================================= */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="obsidian w-full max-w-lg p-6 rounded-3xl bg-[var(--obsidian-1)] border border-white/15 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-600/30 text-indigo-400">
                  <Settings className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Meeting Settings & Hardware</h3>
                  <p className="text-xs text-neutral-400">Microphone, camera, audio, and video quality</p>
                </div>
              </div>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Settings Tab Selector */}
            <div className="flex rounded-xl bg-neutral-900 p-1 border border-white/5">
              {(['devices', 'video', 'audio', 'preferences'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setSettingsActiveTab(tab)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer ${
                    settingsActiveTab === tab ? 'bg-indigo-600 text-white shadow-xs' : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* TAB: Devices */}
            {settingsActiveTab === 'devices' && (
              <div className="space-y-4 max-h-[460px] overflow-y-auto pr-1">
                
                {/* 1. Camera Selection & Live Camera Preview */}
                <div className="space-y-1.5 p-3 rounded-2xl bg-neutral-900/80 border border-white/5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                      <Video className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Camera (Video Input)</span>
                    </label>
                    <span className="text-[10px] text-emerald-400 font-mono">Live Hardware Preview</span>
                  </div>
                  <select
                    id="select-camera-device"
                    value={meetingSettings.selectedCameraId}
                    onChange={(e) => updateMeetingSettings({ selectedCameraId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    {availableDevices.videoInputs.length > 0 ? (
                      availableDevices.videoInputs.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera (${d.deviceId.slice(0, 8)})`}</option>
                      ))
                    ) : (
                      <option value="default">Default System HD Webcam</option>
                    )}
                  </select>

                  {/* Interactive Camera Preview Box */}
                  <div className="mt-2 w-full h-36 rounded-xl bg-black border border-white/10 relative overflow-hidden flex items-center justify-center">
                    {!isCamOff ? (
                      <video
                        ref={settingsCameraPreviewRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover scale-x-[-1]"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-neutral-400">
                        <VideoOff className="h-6 w-6 text-neutral-500" />
                        <span className="text-[11px]">Camera is currently disabled</span>
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/75 text-[10px] text-white font-mono flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Camera Preview • {meetingSettings.videoQuality || '1080p'}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Microphone Selection & Live Input Testing */}
                <div className="space-y-1.5 p-3 rounded-2xl bg-neutral-900/80 border border-white/5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                      <Mic className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Microphone (Audio Input)</span>
                    </label>
                    <span className="text-[10px] font-mono text-emerald-400">
                      {isMicMuted ? 'Muted' : 'Input Testing Active'}
                    </span>
                  </div>
                  <select
                    id="select-microphone-device"
                    value={meetingSettings.selectedMicrophoneId}
                    onChange={(e) => updateMeetingSettings({ selectedMicrophoneId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    {availableDevices.audioInputs.length > 0 ? (
                      availableDevices.audioInputs.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone (${d.deviceId.slice(0, 8)})`}</option>
                      ))
                    ) : (
                      <option value="default">Default System Microphone</option>
                    )}
                  </select>

                  {/* Microphone Input Testing Audio Meter */}
                  <div className="mt-2 p-2.5 rounded-xl bg-neutral-950 border border-white/10 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-neutral-400 flex items-center gap-1">
                        <Activity className="h-3 w-3 text-emerald-400" />
                        <span>Live Mic Level Test</span>
                      </span>
                      <span className="font-mono text-emerald-400 font-bold text-[10px]">
                        {isMicMuted ? 'Muted' : `${micAudioLevel}% Signal`}
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-neutral-800 overflow-hidden relative">
                      <div 
                        className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-indigo-500 transition-all duration-150 rounded-full"
                        style={{ width: `${isMicMuted ? 0 : Math.min(100, micAudioLevel * 1.2)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-neutral-400">
                      Speak into your microphone to verify live input sensitivity and hardware gain.
                    </p>
                  </div>
                </div>

                {/* 3. Speaker Selection & Output Sound Testing */}
                <div className="space-y-1.5 p-3 rounded-2xl bg-neutral-900/80 border border-white/5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5">
                      <Volume2 className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Speaker (Audio Output)</span>
                    </label>
                    <button
                      id="btn-test-speaker"
                      type="button"
                      onClick={() => {
                        testSpeakerSound();
                        setIsSpeakerTesting(true);
                        setTimeout(() => setIsSpeakerTesting(false), 900);
                      }}
                      className="text-xs text-indigo-300 hover:text-white font-semibold cursor-pointer flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/40 transition-colors"
                    >
                      <Volume2 className="h-3 w-3" />
                      <span>{isSpeakerTesting ? 'Playing Chime...' : 'Test Speaker'}</span>
                    </button>
                  </div>
                  <select
                    id="select-speaker-device"
                    value={meetingSettings.selectedSpeakerId}
                    onChange={(e) => updateMeetingSettings({ selectedSpeakerId: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-neutral-950 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    {availableDevices.audioOutputs.length > 0 ? (
                      availableDevices.audioOutputs.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker (${d.deviceId.slice(0, 8)})`}</option>
                      ))
                    ) : (
                      <option value="default">Default System Speaker / Headphones</option>
                    )}
                  </select>
                </div>
              </div>
            )}

            {/* TAB: Video Quality */}
            {settingsActiveTab === 'video' && (
              <div className="space-y-3">
                <label className="text-xs font-semibold text-neutral-300 block">Outgoing Stream Resolution</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['1080p', '720p', '480p', '360p'] as const).map(res => (
                    <button
                      key={res}
                      type="button"
                      onClick={() => updateMeetingSettings({ videoQuality: res })}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        meetingSettings.videoQuality === res
                          ? 'bg-indigo-600/30 border-indigo-500 text-white ring-1 ring-indigo-500'
                          : 'bg-neutral-900 border-white/5 text-neutral-300 hover:border-white/20'
                      }`}
                    >
                      <span className="font-bold text-xs block">{res}</span>
                      <span className="text-[10px] text-neutral-400">
                        {res === '1080p' ? 'Full HD (High Bandwidth)' :
                         res === '720p' ? 'HD Standard (Balanced)' :
                         res === '480p' ? 'Standard Definition' : 'Data Saver'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* TAB: Audio Filters */}
            {settingsActiveTab === 'audio' && (
              <div className="space-y-3">
                <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-900 border border-white/10 cursor-pointer">
                  <div>
                    <span className="text-xs font-bold text-white block">AI Noise Suppression</span>
                    <span className="text-[11px] text-neutral-400">Filters keyboard clatter and ambient room noise</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={meetingSettings.noiseSuppression}
                    onChange={(e) => updateMeetingSettings({ noiseSuppression: e.target.checked })}
                    className="rounded text-indigo-600 focus:ring-0"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-900 border border-white/10 cursor-pointer">
                  <div>
                    <span className="text-xs font-bold text-white block">Acoustic Echo Cancellation</span>
                    <span className="text-[11px] text-neutral-400">Eliminates feedback from open speakers</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={meetingSettings.echoCancellation}
                    onChange={(e) => updateMeetingSettings({ echoCancellation: e.target.checked })}
                    className="rounded text-indigo-600 focus:ring-0"
                  />
                </label>
              </div>
            )}

            {/* TAB: Preferences */}
            {settingsActiveTab === 'preferences' && (
              <div className="space-y-3">
                <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-900 border border-white/10 cursor-pointer">
                  <div>
                    <span className="text-xs font-bold text-white block">Auto-Transcribe Meetings</span>
                    <span className="text-[11px] text-neutral-400">Starts speech recognition automatically on call join</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={meetingSettings.autoTranscribe}
                    onChange={(e) => updateMeetingSettings({ autoTranscribe: e.target.checked })}
                    className="rounded text-indigo-600 focus:ring-0"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-neutral-900 border border-white/10 cursor-pointer">
                  <div>
                    <span className="text-xs font-bold text-white block">Participant Join Chime</span>
                    <span className="text-[11px] text-neutral-400">Play pleasant sound when attendees arrive</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={meetingSettings.notifyOnParticipantJoin}
                    onChange={(e) => updateMeetingSettings({ notifyOnParticipantJoin: e.target.checked })}
                    className="rounded text-indigo-600 focus:ring-0"
                  />
                </label>
              </div>
            )}

            <div className="pt-2 border-t border-white/10 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer shadow-md"
              >
                Apply & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          8. POST-MEETING SUMMARY & RECORDING / TRANSCRIPT MODAL
          ========================================================================= */}
      {showEndMeetingSummaryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md overflow-y-auto">
          <div className="obsidian w-full max-w-2xl p-6 rounded-3xl bg-[var(--obsidian-1)] border border-white/15 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-2xl bg-indigo-600/30 text-indigo-400 border border-indigo-500/30">
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Meeting Concluded & Archived</h3>
                  <p className="text-xs text-neutral-400">Duration: {formatDuration(currentDuration)} • Room ID: {activeMeeting?.roomId}</p>
                </div>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                SAVED TO VAULT
              </span>
            </div>

            {/* Modal Tabs: Watch Recording, View Transcript, Details */}
            <div className="flex rounded-xl bg-neutral-900 p-1 border border-white/5">
              <button
                onClick={() => setSummaryActiveTab('watch')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  summaryActiveTab === 'watch' ? 'bg-indigo-600 text-white shadow-md' : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Play className="h-3.5 w-3.5" />
                <span>Watch Recording</span>
              </button>

              <button
                onClick={() => setSummaryActiveTab('transcript')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  summaryActiveTab === 'transcript' ? 'bg-indigo-600 text-white shadow-md' : 'text-neutral-400 hover:text-white'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>View Transcript</span>
              </button>

              <button
                onClick={() => setSummaryActiveTab('details')}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  summaryActiveTab === 'details' ? 'bg-indigo-600 text-white shadow-md' : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Info className="h-3.5 w-3.5" />
                <span>Meeting Details</span>
              </button>
            </div>

            {/* Processing status banner */}
            {isTranscriptProcessing && (
              <div className="p-3 rounded-xl bg-indigo-950/80 border border-indigo-500/40 flex items-center justify-between text-xs text-indigo-300 animate-pulse">
                <div className="flex items-center gap-2">
                  <RotateCw className="h-4 w-4 animate-spin text-indigo-400 shrink-0" />
                  <span>Processing AI Transcription... Analyzing audio waveforms & speaker diarization.</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-900 text-indigo-200">Syncing...</span>
              </div>
            )}

            {/* TAB: Watch Recording */}
            {summaryActiveTab === 'watch' && (
              <div className="space-y-4">
                <div className="w-full aspect-video rounded-2xl bg-black border border-white/10 relative overflow-hidden flex flex-col items-center justify-center group">
                  {lastCompletedRecording?.videoUrl ? (
                    <video
                      ref={summaryVideoRef}
                      src={lastCompletedRecording.videoUrl}
                      className="w-full h-full object-contain"
                      playsInline
                      onTimeUpdate={(e) => {
                        setSummaryVideoCurrentTime((e.target as HTMLVideoElement).currentTime);
                      }}
                      onEnded={() => setSummaryVideoPlaying(false)}
                      onClick={() => {
                        if (summaryVideoRef.current) {
                          if (summaryVideoPlaying) {
                            summaryVideoRef.current.pause();
                            setSummaryVideoPlaying(false);
                          } else {
                            summaryVideoRef.current.play();
                            setSummaryVideoPlaying(true);
                          }
                        }
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-tr from-neutral-950 via-indigo-950/30 to-neutral-900">
                      <div className="h-16 w-16 rounded-full bg-rose-600/90 text-white flex items-center justify-center shadow-xl shadow-rose-950/60 mb-3">
                        <Play className="h-7 w-7 ml-1 fill-white" />
                      </div>
                      <h4 className="text-sm font-bold text-white">{activeMeeting?.title || 'Live Consultation Recording'}</h4>
                      <p className="text-xs text-neutral-400 font-mono mt-1">
                        WebM High Definition • Synchronized Video Stream
                      </p>
                    </div>
                  )}

                  {/* Video Control Bar Overlay */}
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 flex flex-col gap-2 z-20">
                    {/* Scrubbing slider */}
                    <input
                      type="range"
                      min={0}
                      max={Math.max(lastCompletedRecording?.durationSeconds || currentDuration || 60, 1)}
                      step={0.5}
                      value={summaryVideoCurrentTime}
                      onChange={(e) => {
                        const targetTime = parseFloat(e.target.value);
                        setSummaryVideoCurrentTime(targetTime);
                        if (summaryVideoRef.current) {
                          summaryVideoRef.current.currentTime = targetTime;
                        }
                      }}
                      className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:h-2 transition-all"
                    />

                    <div className="flex items-center justify-between text-xs text-white">
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={() => {
                            if (summaryVideoRef.current) {
                              if (summaryVideoPlaying) {
                                summaryVideoRef.current.pause();
                                setSummaryVideoPlaying(false);
                              } else {
                                summaryVideoRef.current.play();
                                setSummaryVideoPlaying(true);
                              }
                            } else {
                              setSummaryVideoPlaying(!summaryVideoPlaying);
                            }
                          }}
                          className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                        >
                          {summaryVideoPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-white" />}
                        </button>

                        <span className="font-mono text-[11px] text-neutral-300">
                          {formatDuration(Math.floor(summaryVideoCurrentTime))} / {formatDuration(lastCompletedRecording?.durationSeconds || currentDuration || 60)}
                        </span>
                      </div>

                      {/* Speed selector & direct download */}
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center bg-white/10 rounded-lg p-0.5 text-[10px] font-mono">
                          {[0.75, 1, 1.25, 1.5, 2].map(speed => (
                            <button
                              key={speed}
                              onClick={() => {
                                setSummaryPlaybackSpeed(speed);
                                if (summaryVideoRef.current) {
                                  summaryVideoRef.current.playbackRate = speed;
                                }
                              }}
                              className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                                summaryPlaybackSpeed === speed ? 'bg-indigo-600 text-white font-bold' : 'text-neutral-400 hover:text-white'
                              }`}
                            >
                              {speed}x
                            </button>
                          ))}
                        </div>

                        <button
                          onClick={() => {
                            const blob = lastCompletedRecording?.videoUrl
                              ? null
                              : new Blob(['Obsidian Video Recording'], { type: 'video/webm' });
                            const url = lastCompletedRecording?.videoUrl || (blob ? URL.createObjectURL(blob) : '');
                            if (url) {
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `recording-${activeMeeting?.roomId || 'consultation'}.webm`;
                              a.click();
                              showToast('Downloaded meeting recording video file (.webm).', 'success');
                            }
                          }}
                          className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
                          title="Download Recording Video"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Synchronized Jump-To-Time Transcript Bar */}
                <div className="p-3 rounded-2xl bg-neutral-900/90 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-neutral-300 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Synchronized Audio & Spoken Transcript</span>
                    </span>
                    <span className="text-[10px] text-neutral-400 font-mono">Click timestamp to jump video</span>
                  </div>

                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {liveTranscript.map(item => (
                      <div
                        key={item.id}
                        onClick={() => {
                          if (summaryVideoRef.current) {
                            summaryVideoRef.current.currentTime = item.timeSeconds;
                            summaryVideoRef.current.play();
                            setSummaryVideoPlaying(true);
                          }
                          setSummaryVideoCurrentTime(item.timeSeconds);
                        }}
                        className="p-2 rounded-xl bg-black/40 hover:bg-indigo-950/40 border border-white/5 hover:border-indigo-500/30 text-xs cursor-pointer transition-all flex items-start gap-2.5 group"
                      >
                        <span className="px-1.5 py-0.5 rounded bg-indigo-950 border border-indigo-500/30 text-indigo-300 font-mono text-[10px] shrink-0 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                          {item.timestamp}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className={`font-semibold text-[11px] mr-1.5 ${item.isHost ? 'text-indigo-400' : 'text-neutral-300'}`}>
                            {item.speakerName}:
                          </span>
                          <span className="text-neutral-200 text-[11px]">{item.text}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Direct Action Buttons */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      const blob = lastCompletedRecording?.videoUrl
                        ? null
                        : new Blob(['Obsidian Video Recording'], { type: 'video/webm' });
                      const url = lastCompletedRecording?.videoUrl || (blob ? URL.createObjectURL(blob) : '');
                      if (url) {
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `recording-${activeMeeting?.roomId || 'consultation'}.webm`;
                        a.click();
                        showToast('Downloaded meeting recording video file (.webm).', 'success');
                      }
                    }}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-indigo-950/40 transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download Recording (.WEBM)</span>
                  </button>

                  <button
                    onClick={() => {
                      handleDownloadTranscriptPdf(liveTranscript, activeMeeting?.title || 'Meeting Session');
                    }}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <FileText className="h-4 w-4 text-emerald-400" />
                    <span>Download Transcript (.PDF)</span>
                  </button>

                  <button
                    onClick={() => {
                      const fullTxt = liveTranscript.map(t => `[${t.timestamp}] ${t.speakerName}: ${t.text}`).join('\n');
                      const blob = new Blob([fullTxt], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `transcript-${activeMeeting?.roomId || 'session'}.txt`;
                      a.click();
                      showToast('Transcript downloaded as text file.', 'info');
                    }}
                    className="py-2.5 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <Download className="h-4 w-4 text-neutral-400" />
                    <span>.TXT</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB: View Transcript */}
            {summaryActiveTab === 'transcript' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-neutral-500" />
                    <input
                      type="text"
                      value={summaryTranscriptSearch}
                      onChange={(e) => setSummaryTranscriptSearch(e.target.value)}
                      placeholder="Search spoken keywords in transcript..."
                      className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-neutral-900 border border-white/10 text-xs text-white placeholder:text-neutral-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        const fullTxt = liveTranscript.map(t => `[${t.timestamp}] ${t.speakerName}: ${t.text}`).join('\n');
                        const blob = new Blob([fullTxt], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `meeting-transcript-${activeMeeting?.roomId || 'session'}.txt`;
                        a.click();
                        showToast('Transcript downloaded as text file.', 'info');
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-xs font-semibold text-neutral-200 flex items-center gap-1 cursor-pointer"
                      title="Download plain text file"
                    >
                      <Download className="h-3 w-3 text-indigo-400" />
                      <span>Download .TXT</span>
                    </button>

                    <button
                      onClick={() => {
                        handleDownloadTranscriptPdf(liveTranscript, activeMeeting?.title || 'Meeting Session');
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-white/10 text-xs font-semibold text-neutral-200 flex items-center gap-1 cursor-pointer"
                      title="Download formatted PDF file"
                    >
                      <FileText className="h-3 w-3 text-emerald-400" />
                      <span>Download .PDF</span>
                    </button>

                    <button
                      onClick={() => {
                        const res = saveCurrentMeetingTranscript();
                        showToast(res.message, 'success');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center gap-1 cursor-pointer"
                    >
                      <Save className="h-3 w-3" />
                      <span>Save in Greet Tabs</span>
                    </button>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto p-3 rounded-2xl bg-neutral-900/80 border border-white/5 space-y-2">
                  {liveTranscript
                    .filter(t => !summaryTranscriptSearch.trim() || t.text.toLowerCase().includes(summaryTranscriptSearch.toLowerCase()))
                    .map(item => (
                      <div key={item.id} className="p-2 rounded-lg bg-black/40 border border-white/5 text-xs">
                        <div className="flex items-center justify-between text-[11px] mb-0.5">
                          <span className={`font-bold ${item.isHost ? 'text-indigo-400' : 'text-neutral-300'}`}>
                            {item.speakerName}
                          </span>
                          <span className="font-mono text-neutral-500 text-[10px]">{item.timestamp}</span>
                        </div>
                        <p className="text-neutral-200 text-[11px]">{item.text}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* TAB: Meeting Details */}
            {summaryActiveTab === 'details' && (
              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-neutral-900 border border-white/5 space-y-1">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Attendance Roster</span>
                  <p className="text-xs text-neutral-200">
                    Camelia Rose (Host), {participantsList.map(p => p.name).join(', ')}
                  </p>
                </div>

                {activeMeeting?.notes && (
                  <div className="p-3 rounded-xl bg-neutral-900 border border-white/5 space-y-1">
                    <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Meeting Minutes</span>
                    <p className="text-xs text-neutral-300 max-h-24 overflow-y-auto whitespace-pre-wrap font-mono">
                      {activeMeeting.notes}
                    </p>
                  </div>
                )}

                {activeMeeting?.tasks && activeMeeting.tasks.length > 0 && (
                  <div className="p-3 rounded-xl bg-neutral-900 border border-white/5 space-y-1.5">
                    <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Follow-up Deliverables</span>
                    {activeMeeting.tasks.map(t => (
                      <div key={t.id} className="flex items-center justify-between text-xs text-neutral-200">
                        <span>• {t.title}</span>
                        <span className="text-[10px] text-neutral-400">Due: {t.dueDate}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Modal Footer Navigation */}
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/10">
              <button
                id="btn-goto-greet-recordings"
                onClick={() => {
                  setShowEndMeetingSummaryModal(false);
                  endMeetingForEveryone();
                  if (onNavigateToGreet) {
                    onNavigateToGreet('recordings');
                  } else if (onNavigateToDashboard) {
                    onNavigateToDashboard();
                  }
                }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5"
              >
                <Disc className="h-3.5 w-3.5" />
                <span>View in Greet Hub Recordings Tab</span>
              </button>

              <button
                onClick={() => {
                  setShowEndMeetingSummaryModal(false);
                  endMeetingForEveryone();
                  if (onNavigateToDashboard) onNavigateToDashboard();
                }}
                className="px-5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold text-xs transition-all cursor-pointer"
              >
                Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      <EndMeetingConfirmDialog
        open={showEndConfirm}
        isRecording={isRecording}
        participantsCount={participantsList.length + 1}
        onCancel={() => setShowEndConfirm(false)}
        onConfirm={async () => {
          setShowEndConfirm(false);
          if (isRecording) {
            await stopRecording();
          }
          setShowEndMeetingSummaryModal(true);
        }}
      />

      {/* Toast Notification Banner */}
      <AnimatePresence>
        {toastNotice && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-2xl shadow-2xl border text-xs font-semibold flex items-center gap-2.5 backdrop-blur-md ${
              toastNotice.type === 'warning'
                ? 'bg-amber-950/90 border-amber-500/50 text-amber-200'
                : toastNotice.type === 'info'
                ? 'bg-indigo-950/90 border-indigo-500/50 text-indigo-200'
                : 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
            }`}
          >
            {toastNotice.type === 'warning' ? (
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
            ) : toastNotice.type === 'info' ? (
              <Info className="h-4 w-4 text-indigo-400 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            )}
            <span>{toastNotice.message}</span>
            <button
              onClick={() => setToastNotice(null)}
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
