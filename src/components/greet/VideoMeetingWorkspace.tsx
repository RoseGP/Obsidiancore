import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, VideoOff, Mic, MicOff, MonitorUp, MonitorOff, PhoneOff,
  Maximize2, Minimize2, MessageSquare, Users, Sparkles, Briefcase,
  Copy, Check, X, Send, Paperclip, Smile, Search, Plus, Calendar,
  Shield, CheckCircle2, ChevronRight, AlertCircle, Clock, LayoutGrid,
  Radio, Volume2, VolumeX, UserCheck, Edit3, ArrowRight, Home, Share2,
  Trash2, UserPlus, Info, CheckSquare, Square, Download, ExternalLink,
  Laptop, ShieldAlert, Award, Pause, Play, Disc, Settings, FileText,
  SlidersHorizontal, CheckCircle, RotateCw, Printer, Save, Activity,
  AudioLines, Gauge, Captions, Hand, PenTool, BarChart3, Presentation, UserSquare, PictureInPicture2,
  Sun, Moon, Keyboard, HelpCircle, Image as ImageIcon, WifiOff
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
import { gridColumns, gridPage, isGroupMeeting } from '../../lib/meetingPolicy';
import { VIDEO_FILTERS, applyVideoQuality, enterPictureInPicture } from '../../lib/meetingMedia';
import './meeting/meeting.css';
import { MeetingUiProvider, useActiveSpeaker, useMeetingShortcuts, useMeetingUi, useNetworkStatus } from './meeting/useMeetingUi';
import { NotificationSystem, useNotify } from './meeting/NotificationSystem';
import { useMeetingCollab } from './meeting/useMeetingCollab';
import { MeetingHeader } from './meeting/MeetingHeader';
import { MeetingRoom } from './meeting/MeetingRoom';
import { MeetingToolbar } from './meeting/MeetingToolbar';
import type { MenuGroup, MenuItem } from './meeting/MoreOptionsMenu';
import { VideoGrid } from './meeting/VideoGrid';
import type { TileModel } from './meeting/ParticipantTile';
import { ScreenShareController, ScreenShareError } from './meeting/ScreenShareController';
import { SidePanel } from './meeting/SidePanel';
import { ChatPanel } from './meeting/ChatPanel';
import { ParticipantsPanel } from './meeting/ParticipantsPanel';
import { SettingsPanel } from './meeting/SettingsPanel';
import { WhiteboardPanel } from './meeting/WhiteboardPanel';
import { PollsPanel } from './meeting/PollsPanel';
import { SummaryPanel } from './meeting/SummaryPanel';
import { CaptionsOverlay } from './meeting/CaptionsOverlay';
import { BackgroundDialog, HelpDialog, InviteDialog, LeaveDialog, MeetingInfoDialog, RecordConsentDialog, ShortcutsDialog, meetingLink } from './meeting/MeetingDialogs';
import { CRMContact } from '../../types';

interface VideoMeetingWorkspaceProps {
  contacts?: CRMContact[];
  onAddCalendarEvent?: (event: any) => void;
  onNavigateToDashboard?: () => void;
  onNavigateToGreet?: (tab?: string) => void;
  onNavigateToContact?: (contact: CRMContact) => void;
}

function WorkspaceInner({
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
    sessionLimits,
    sessionTime,
    remainingSeats,
    lastMeetingEnd,
    clearLastMeetingEnd,
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
    testSpeakerSound,
    isTranscribing,
    setTranscribing,
  } = useMeetingSession();
  const ui = useMeetingUi();
  const notify = useNotify();

  // Sidebar Tab state ('chat' | 'greet' | 'participants' | 'crm' | 'transcript')
  // The side panel is driven by the meeting UI state; these keep the older panels' calls working.
  type LegacyTab = 'chat' | 'greet' | 'participants' | 'crm' | 'transcript';
  const activeSidebarTab: LegacyTab | null = ui.panel === 'people' ? 'participants' : ui.panel === 'notes' ? 'crm'
    : ui.panel === 'chat' || ui.panel === 'greet' || ui.panel === 'transcript' ? ui.panel : null;
  const setActiveSidebarTab = (t: LegacyTab) => ui.openPanel(t === 'participants' ? 'people' : t === 'crm' ? 'notes' : t);
  const isSidebarOpen = ui.panel !== null;
  const setIsSidebarOpen = (open: boolean) => { if (!open) ui.closePanel(); };
  const [transcriptSaveNotice, setTranscriptSaveNotice] = useState<string | null>(null);

  // Fullscreen browser state
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Layout mode ('grid' | 'speaker')
  const [layoutMode, setLayoutMode] = useState<'grid' | 'speaker'>('grid');
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(null);

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatRecipient, setChatRecipient] = useState<string>('everyone');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
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
  const setShowInviteModal = (open: boolean) => (open ? ui.openDialog('invite') : ui.closeDialog());
  const [inviteEmailInput, setInviteEmailInput] = useState('');
  const [inviteFeedback, setInviteFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  const setShowLeaveConfirmModal = (open: boolean) => (open ? ui.openDialog('leave') : ui.closeDialog());
  const [showEndMeetingSummaryModal, setShowEndMeetingSummaryModal] = useState(false);
  const [copiedLinkNotice, setCopiedLinkNotice] = useState(false);
  const [copiedMeetingIdNotice, setCopiedMeetingIdNotice] = useState(false);

  // Recording Modal & Controls
  const setShowRecordingConsentModal = (open: boolean) => (open ? ui.openDialog('record-consent') : ui.closeDialog());
  const [showRecordingActionsMenu, setShowRecordingActionsMenu] = useState(false);
  const [recordingConsentCheckbox, setRecordingConsentCheckbox] = useState(true);

  // In-Meeting Settings Modal
  const showSettingsModal = ui.dialog === 'settings';
  const setShowSettingsModal = (open: boolean) => (open ? ui.openDialog('settings') : ui.closeDialog());
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
  // Workspace notices go through the meeting notification system.
  const showToast = (message: string, type: 'info' | 'success' | 'warning' = 'success') => notify(message, type);

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
  const currentDuration = activeMeeting?.durationSeconds || 0;
  const headcountNow = participantsList.length + 1;
  const remainingLabel = sessionTime?.remainingSeconds != null ? formatDuration(sessionTime.remainingSeconds) : null;

  // Group meetings (up to 100 people) are paged 25 tiles at a time.
  const [gridPageIndex, setGridPageIndex] = useState(0);
  const grid = gridPage(participantsList.length, gridPageIndex);
  const visibleParticipants = participantsList.slice(grid.start, grid.end);
  const gridCols = gridColumns(grid.tileCount);
  /** 4+ columns: compact tiles so 25 people fit on a page. */
  const denseGrid = gridCols > 3;
  useEffect(() => {
    if (grid.page !== gridPageIndex) setGridPageIndex(grid.page);
  }, [grid.page, gridPageIndex]);

  // ===========================================================================
  // Meeting room wiring (new interface). Meeting state lives in MeetingSessionContext,
  // UI state in useMeetingUi, media helpers in lib/meetingMedia, shared events in useMeetingCollab.
  // ===========================================================================
  const localName = (activeMeeting?.isHost ? activeMeeting.hostName : 'You').replace(/\s*\(.*\)\s*$/, '') || 'You';
  const collab = useMeetingCollab(activeMeeting?.roomId ?? null, localName);
  const activeSpeakerId = useActiveSpeaker(participantsList, micAudioLevel, isMicMuted);
  const [screenErrorHidden, setScreenErrorHidden] = useState<string | null>(null);
  const pipTarget = useRef<HTMLVideoElement | null>(null);
  const [isCompact, setIsCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900);
  useEffect(() => {
    const onResize = () => setIsCompact(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const net = useNetworkStatus(() => {
    const ended = localStream?.getTracks().some((t) => t.readyState === 'ended');
    notify(ended ? 'Reconnected. Your camera or mic stopped while offline. Turn it back on.' : 'Reconnected', ended ? 'warning' : 'success');
  });
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!net.online && !wasOffline.current) { wasOffline.current = true; notify('You’re offline. Trying to reconnect…', 'warning'); }
    if (net.online) wasOffline.current = false;
  }, [net.online]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unread chat badge
  const [seenMessages, setSeenMessages] = useState(0);
  const messageCount = activeMeeting?.messages.length ?? 0;
  useEffect(() => { if (ui.panel === 'chat') setSeenMessages(messageCount); }, [ui.panel, messageCount]);
  const unreadChat = ui.panel === 'chat' ? 0 : Math.max(0, messageCount - seenMessages);

  // Join / leave notices
  const prevIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(participantsList.map((p) => p.id));
    const prev = prevIds.current;
    prevIds.current = ids;
    if (!prev || !meetingSettings.notifyOnParticipantJoin) return;
    const joined = participantsList.filter((p) => !prev.has(p.id));
    const left = [...prev].filter((id) => !ids.has(id)).length;
    if (joined.length === 1) notify(`${joined[0].name} joined`, 'info');
    else if (joined.length > 1) notify(`${joined.length} people joined`, 'info');
    if (left) notify(`${left} ${left === 1 ? 'person' : 'people'} left`, 'info');
  }, [participantsList]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remote raised hands → notice
  const prevHands = useRef(0);
  useEffect(() => {
    if (collab.remoteHands.length > prevHands.current) notify(`${collab.remoteHands[collab.remoteHands.length - 1]} raised their hand`, 'info');
    prevHands.current = collab.remoteHands.length;
  }, [collab.remoteHands]); // eslint-disable-line react-hooks/exhaustive-deps

  // Low-bandwidth mode also lowers outgoing video.
  useEffect(() => { applyVideoQuality(localStream, meetingSettings.videoQuality, ui.lowBandwidth); }, [ui.lowBandwidth, localStream]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleHand = () => {
    const next = !ui.handRaised;
    ui.setHandRaised(next);
    collab.setHand(next);
    notify(next ? 'Hand raised' : 'Hand lowered', 'info', { durationMs: 2000 });
  };
  const react = (emoji: string) => { broadcastReaction(emoji); collab.sendReaction(emoji); };
  const toggleShare = () => (isScreenSharing ? stopScreenShare() : startScreenShare());
  const openPrivateMessage = (id: string) => { setChatRecipient(id); ui.openPanel('chat'); };
  const pip = async () => {
    const r = await enterPictureInPicture(pipTarget.current ?? localVideoRef.current ?? screenVideoRef.current);
    if (r === 'unsupported') notify('Picture-in-picture isn’t supported in this browser.', 'warning');
    else if (r === 'no-video') notify('Turn on your camera or share your screen to use picture-in-picture.', 'info');
    else if (r === 'failed') notify('Picture-in-picture couldn’t start.', 'warning');
  };
  const endForEveryone = async () => {
    if (isRecording) await stopRecording();
    setShowEndMeetingSummaryModal(true);
  };
  const stopAndSaveRecording = async () => {
    const saved = await stopRecording();
    if (saved) notify(`Recording saved to Greet Hub (${saved.fileSizeFormatted})`, 'success');
  };
  const copyLink = () => {
    navigator.clipboard.writeText(meetingLink(activeMeeting?.roomId))
      .then(() => notify('Meeting link copied', 'success'))
      .catch(() => notify(`Couldn’t copy. Link: ${meetingLink(activeMeeting?.roomId)}`, 'warning', { durationMs: 9000 }));
  };

  useMeetingShortcuts({
    m: toggleMic,
    v: () => { toggleCam(); },
    s: () => { toggleShare(); },
    c: () => ui.togglePanel('chat'),
    p: () => ui.togglePanel('people'),
    h: toggleHand,
    l: () => ui.setPref('layout', ui.layout === 'gallery' ? 'speaker' : 'gallery'),
    f: handleToggleFullscreen,
    '.': () => ui.setMoreOpen(!ui.moreOpen),
    '?': () => ui.openDialog('shortcuts'),
    escape: () => { if (ui.moreOpen) ui.setMoreOpen(false); else if (ui.panel && isCompact) ui.closePanel(); },
  }, Boolean(activeMeeting) && !ui.dialog);

  const filterCss = VIDEO_FILTERS[ui.videoFilter]?.css;
  const initialsOf = (n: string) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const localTile: TileModel = {
    id: 'local-user', name: localName, initials: initialsOf(localName), isLocal: true, isHost: activeMeeting?.isHost,
    muted: isMicMuted, camOff: isCamOff, paused: isVideoPaused, handRaised: ui.handRaised, stream: localStream, mirror: true, filterCss,
  };
  const handNames = new Set(collab.remoteHands.map((n) => n.toLowerCase()));
  const remoteTiles: TileModel[] = participantsList.map((p) => ({
    id: p.id, name: p.name, initials: p.avatar || initialsOf(p.name), avatarGradient: undefined,
    muted: p.isMuted, camOff: p.isVideoOff || ui.lowBandwidth, handRaised: handNames.has(p.name.toLowerCase()), isHost: p.role === 'Host',
  }));

  const moreGroups: MenuGroup[] = [
    {
      id: 'av', label: 'Audio & video', items: [
        { id: 'audio', label: 'Audio settings', icon: Volume2, onSelect: () => ui.openDialog('settings', { settingsTab: 'audio' }) },
        { id: 'video', label: 'Video settings', icon: Video, onSelect: () => ui.openDialog('settings', { settingsTab: 'video' }) },
        { kind: 'toggle', id: 'noise', label: 'Noise cancellation', icon: AudioLines, checked: meetingSettings.noiseSuppression, onSelect: () => updateMeetingSettings({ noiseSuppression: !meetingSettings.noiseSuppression }) },
        { id: 'bg', label: 'Background effects', icon: Sparkles, onSelect: () => ui.openDialog('background', { backgroundTab: 'effects' }) },
        { id: 'vbg', label: 'Virtual background', icon: ImageIcon, onSelect: () => ui.openDialog('background', { backgroundTab: 'virtual' }) },
        { kind: 'toggle', id: 'pause', label: 'Pause my video', icon: Pause, checked: isVideoPaused, disabled: isCamOff, onSelect: togglePauseVideo },
        { kind: 'toggle', id: 'lowbw', label: 'Low-bandwidth mode', icon: Gauge, hint: '180p video, incoming video hidden', checked: ui.lowBandwidth, onSelect: () => ui.setPref('lowBandwidth', !ui.lowBandwidth) },
      ],
    },
    {
      id: 'meeting', label: 'In this meeting', items: [
        ...(isRecording ? [
          { id: 'rec-pause', label: isRecordingPaused ? 'Resume recording' : 'Pause recording', icon: isRecordingPaused ? Play : Pause, onSelect: () => (isRecordingPaused ? resumeRecording() : pauseRecording()) } as MenuItem,
          { id: 'rec-stop', label: 'Stop and save recording', icon: Disc, onSelect: stopAndSaveRecording } as MenuItem,
        ] : [{ id: 'rec', label: 'Record meeting', icon: Disc, onSelect: () => ui.openDialog('record-consent') } as MenuItem]),
        { kind: 'toggle', id: 'captions', label: 'Live captions', icon: Captions, checked: ui.captions, onSelect: () => { const on = !ui.captions; ui.setCaptions(on); if (on && !isTranscribing) setTranscribing(true); } },
        { kind: 'toggle', id: 'hand', label: 'Raise hand', icon: Hand, shortcut: 'H', checked: ui.handRaised, onSelect: toggleHand },
        { id: 'transcript', label: 'Live transcript', icon: FileText, onSelect: () => ui.openPanel('transcript') },
        { kind: 'reactions', id: 'reactions', label: 'Reactions', emojis: ['👍', '👏', '❤️', '😂', '🎉', '😮', '💡', '🙌'], onPick: react },
      ],
    },
    {
      id: 'collab', label: 'Collaborate', items: [
        { id: 'whiteboard', label: 'Whiteboard', icon: PenTool, hint: collab.unseen.whiteboard ? 'New drawing' : undefined, onSelect: () => { ui.openPanel('whiteboard'); collab.markSeen('whiteboard'); } },
        { id: 'polls', label: 'Polls', icon: BarChart3, hint: collab.unseen.polls ? `${collab.unseen.polls} new` : undefined, onSelect: () => { ui.openPanel('polls'); collab.markSeen('polls'); } },
        { id: 'notes', label: 'Notes & CRM', icon: Briefcase, onSelect: () => ui.openPanel('notes') },
        { id: 'summary', label: 'AI summary & action items', icon: Sparkles, onSelect: () => ui.openPanel('summary') },
        { id: 'greet', label: 'Meet & Greet', icon: UserCheck, onSelect: () => ui.openPanel('greet') },
      ],
    },
    {
      id: 'room', label: 'Meeting', items: [
        { id: 'info', label: 'Meeting information', icon: Info, onSelect: () => ui.openDialog('info') },
        { id: 'invite', label: 'Invite participants', icon: UserPlus, onSelect: () => ui.openDialog('invite') },
        { id: 'link', label: 'Copy meeting link', icon: Copy, onSelect: copyLink },
        { id: 'layout', label: ui.layout === 'gallery' ? 'Switch to speaker view' : 'Switch to gallery view', icon: ui.layout === 'gallery' ? Presentation : LayoutGrid, shortcut: 'L', onSelect: () => ui.setPref('layout', ui.layout === 'gallery' ? 'speaker' : 'gallery') },
        { kind: 'toggle', id: 'selfview', label: 'Show my video', icon: UserSquare, checked: ui.showSelfView, onSelect: () => ui.setPref('showSelfView', !ui.showSelfView) },
        { kind: 'toggle', id: 'fullscreen', label: 'Fullscreen', icon: isFullscreen ? Minimize2 : Maximize2, shortcut: 'F', checked: isFullscreen, onSelect: handleToggleFullscreen },
        { id: 'pip', label: 'Picture-in-picture', icon: PictureInPicture2, onSelect: pip },
        { kind: 'toggle', id: 'theme', label: 'Light mode', icon: ui.theme === 'light' ? Sun : Moon, checked: ui.theme === 'light', onSelect: () => ui.setPref('theme', ui.theme === 'light' ? 'dark' : 'light') },
        { id: 'dashboard', label: 'Go to dashboard', icon: Home, hint: 'The meeting keeps running', onSelect: handleReturnToDashboard },
      ],
    },
    {
      id: 'help', label: 'Settings & help', items: [
        { id: 'settings', label: 'Meeting settings', icon: Settings, onSelect: () => ui.openDialog('settings', { settingsTab: 'preferences' }) },
        { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, shortcut: '?', onSelect: () => ui.openDialog('shortcuts') },
        { id: 'help', label: 'Help and support', icon: HelpCircle, onSelect: () => ui.openDialog('help') },
      ],
    },
  ];

  const stageOverride = isScreenSharing ? (
    <ScreenShareController stream={screenStream} hasSystemAudio={hasSystemAudio} onStop={stopScreenShare}
      onVideoEl={(el) => { screenVideoRef.current = el; if (el) pipTarget.current = el; }} />
  ) : undefined;

  return (
    <MeetingRoom
      theme={ui.theme}
      alert={net.reconnecting && (
        <div role="alert" className="flex flex-none items-center justify-center gap-3 px-4 py-2 text-[13px]" style={{ background: 'var(--m-danger-tint)', color: 'var(--m-text)' }}>
          <WifiOff size={15} style={{ color: 'var(--m-danger)' }} aria-hidden />
          <span>{net.online ? 'Reconnecting…' : 'You’re offline.'} {net.attempt > 0 ? `Attempt ${net.attempt}.` : ''} Your meeting will resume when the connection is back.</span>
          <button type="button" className="m-btn m-btn-sm" onClick={net.retryNow}><RotateCw size={13} aria-hidden />Retry now</button>
        </div>
      )}
      header={<MeetingHeader
        title={activeMeeting?.title || 'Meeting'}
        elapsed={currentDuration}
        limitMinutes={sessionLimits.maxDurationMinutes}
        warn={isDurationWarning || isDurationLimitReached}
        recording={isRecording}
        recordingPaused={isRecordingPaused}
        recordingSeconds={recordingDurationSeconds}
        people={headcountNow}
        net={net}
        onInfo={() => ui.openDialog('info')}
        onPeople={() => ui.togglePanel('people')}
      />}
      notices={<>
            {isDurationWarning && !isDurationLimitReached && (
              <div role="status" className="m-glass flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[13px]">
                <Clock size={16} style={{ color: 'var(--m-warn)' }} aria-hidden />
                <span className="min-w-0 flex-1"><strong className="m-num">{remainingLabel} left.</strong> This meeting ends automatically at the {sessionLimits.maxDurationMinutes}-minute limit.</span>
                <button type="button" className="m-btn m-btn-sm" onClick={() => ui.openDialog('leave')}>Wrap up</button>
              </div>
            )}
            {isDurationLimitReached && (
              <div role="alert" className="m-glass flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[13px]">
                <Clock size={16} style={{ color: 'var(--m-danger)' }} aria-hidden />
                <span><strong>{sessionLimits.maxDurationMinutes}-minute limit reached.</strong> Ending the meeting for everyone…</span>
              </div>
            )}
            {screenShareError && screenErrorHidden !== screenShareError && (
              <ScreenShareError message={screenShareError} onDismiss={() => setScreenErrorHidden(screenShareError)} />
            )}
      </>}
      stage={<>
            <VideoGrid
              local={localTile}
              remote={remoteTiles}
              layout={ui.layout}
              pinnedId={ui.pinnedId}
              activeSpeakerId={activeSpeakerId}
              showSelfView={ui.showSelfView}
              onPin={(id) => { ui.setPinned(id); if (id) ui.setPref('layout', 'speaker'); }}
              onMessage={openPrivateMessage}
              onLocalVideoEl={(el) => { localVideoRef.current = el; if (el && !isScreenSharing) pipTarget.current = el; }}
              stageOverride={stageOverride}
            />

            {/* Reactions float up from the bottom of the stage */}
            <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center gap-3" aria-live="polite">
              <AnimatePresence>
                {[...activeReactions.map((r) => ({ id: r.id, emoji: r.emoji, name: 'You' })), ...collab.remoteReactions].map((r, i) => (
                  <motion.div key={r.id} initial={{ opacity: 0, y: 20, scale: 0.6 }} animate={{ opacity: 1, y: -120 - (i % 3) * 30, scale: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 2.6, ease: 'easeOut' }} className="flex flex-col items-center">
                    <span className="text-4xl" aria-hidden>{r.emoji}</span>
                    <span className="m-glass mt-1 rounded-full px-2 py-0.5 text-[11px]">{r.name}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {ui.captions && (
              <div className={`pointer-events-none absolute inset-x-0 flex justify-center ${isScreenSharing || ui.layout === 'speaker' ? 'bottom-[212px]' : 'bottom-[104px] sm:bottom-[112px]'}`}>
                <CaptionsOverlay transcript={liveTranscript} transcribing={isTranscribing} micMuted={isMicMuted} />
              </div>
            )}
      </>}
      toolbar={<MeetingToolbar
                micMuted={isMicMuted}
                camOff={isCamOff}
                sharing={isScreenSharing}
                peopleCount={headcountNow}
                unreadChat={unreadChat}
                panel={ui.panel}
                moreOpen={ui.moreOpen}
                moreGroups={moreGroups}
                onToggleMic={toggleMic}
                onToggleCam={() => { toggleCam(); }}
                onToggleShare={() => { toggleShare(); }}
                onTogglePeople={() => ui.togglePanel('people')}
                onToggleChat={() => ui.togglePanel('chat')}
                onMoreOpenChange={ui.setMoreOpen}
                onLeave={() => ui.openDialog('leave')}
              />}
      panel={<SidePanel panel={ui.panel} compact={isCompact} onSwitch={ui.openPanel} onClose={ui.closePanel}
          peopleCount={headcountNow} unreadChat={unreadChat} wide={ui.panel === 'whiteboard'}>
          {ui.panel === 'chat' && <ChatPanel recipient={chatRecipient} onRecipientChange={setChatRecipient} />}
          {ui.panel === 'people' && (
            <ParticipantsPanel localName={localName} localHandRaised={ui.handRaised} remoteHands={collab.remoteHands} activeSpeakerId={activeSpeakerId}
              onInvite={() => ui.openDialog('invite')} onMessage={openPrivateMessage}
              onPin={(id) => { ui.setPinned(id); ui.setPref('layout', 'speaker'); }} />
          )}
          {ui.panel === 'whiteboard' && <WhiteboardPanel strokes={collab.strokes} onStroke={collab.addStroke} onClear={collab.clearBoard} />}
          {ui.panel === 'polls' && <PollsPanel polls={collab.polls} votes={collab.votes} selfId={collab.selfId} onCreate={collab.createPoll} onVote={collab.vote} onClose={collab.closePoll} />}
          {ui.panel === 'summary' && <SummaryPanel />}
          {(ui.panel === 'greet' || ui.panel === 'notes' || ui.panel === 'transcript') && (
            <div className="m-legacy flex min-h-0 flex-1 flex-col">
              {/* -------------------------------------------------------------
                  TAB 2: MEET & GREET FEATURE
                  ------------------------------------------------------------- */}
              {ui.panel === 'greet' && (
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
                  TAB 4: CRM DOSSIER & REAL-TIME MEETING NOTES
                  ------------------------------------------------------------- */}
              {ui.panel === 'notes' && (
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
              {ui.panel === 'transcript' && (
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
            </div>
          )}
        </SidePanel>}
    >

      {/* Meeting-ended notice (e.g. the 60-minute limit closed the session) */}
      {!activeMeeting && lastMeetingEnd && (
        <div className="m-legacy fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div role="alertdialog" aria-labelledby="meeting-ended-title" className="obsidian w-full max-w-sm p-6 rounded-3xl bg-[var(--obsidian-1)] border border-white/15 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-2xl ${lastMeetingEnd.reason === 'duration_limit' ? 'bg-rose-600/20 text-rose-400' : 'bg-indigo-600/20 text-indigo-300'}`}>
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <h3 id="meeting-ended-title" className="text-sm font-bold text-white">
                  {lastMeetingEnd.reason === 'duration_limit' ? 'Meeting ended at the time limit' : lastMeetingEnd.reason === 'host_ended' ? 'Meeting ended' : 'You left the meeting'}
                </h3>
                <p className="text-xs text-neutral-400 truncate max-w-[240px]">{lastMeetingEnd.title}</p>
              </div>
            </div>
            {lastMeetingEnd.reason === 'duration_limit' && (
              <p className="text-xs text-neutral-300">
                Meetings can run for up to {sessionLimits.maxDurationMinutes || 60} minutes. Start a new meeting to keep talking.
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { clearLastMeetingEnd(); onNavigateToGreet?.(); }}
                className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
              >
                Back to meetings
              </button>
              <button
                type="button"
                onClick={() => { clearLastMeetingEnd(); onNavigateToDashboard?.(); }}
                className="flex-1 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold cursor-pointer"
              >
                Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          8. POST-MEETING SUMMARY & RECORDING / TRANSCRIPT MODAL
          ========================================================================= */}
      {showEndMeetingSummaryModal && (
        <div className="m-legacy fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md overflow-y-auto">
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

      <SettingsPanel />
      <MeetingInfoDialog />
      <InviteDialog />
      <LeaveDialog onLeave={leaveMeeting} onEndForAll={endForEveryone} onDashboard={handleReturnToDashboard} />
      <RecordConsentDialog onStarted={() => {}} />
      <ShortcutsDialog />
      <HelpDialog />
      <BackgroundDialog />
    </MeetingRoom>
  );
}

export default function VideoMeetingWorkspace(props: VideoMeetingWorkspaceProps) {
  return (
    <MeetingUiProvider>
      <NotificationSystem>
        <WorkspaceInner {...props} />
      </NotificationSystem>
    </MeetingUiProvider>
  );
}
