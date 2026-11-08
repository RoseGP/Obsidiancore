import axios from 'axios';
import React, { useState, useEffect, useRef } from 'react';
import useDebounce from '../hooks/useDebounce';
import { 
  Send, Phone, Video, Info, Search, Paperclip, 
  Smile, ShieldCheck, Mail, MessageSquare, ExternalLink,
  ChevronRight, RefreshCw, Sparkles, CheckCircle2, AlertTriangle, FileText,
  Calendar, Plus, Trash2, Check, MessageCircle, Instagram, Globe, Zap, Clock, BookOpen,
  Mic, MicOff, Database, Terminal, Copy, Lock, Server, Twitter, Linkedin,
  Heart, Share2, Bookmark, ThumbsUp, Repeat,
  ChevronDown, ChevronUp, Archive, CornerUpRight, CornerUpLeft, Reply, Forward
} from 'lucide-react';
import { CRMContact, CRMMessage, CalendarEvent } from '../types';
import { useCommand } from '../context/CommandContext';
import SnippetTextArea, { Snippet } from './SnippetTextArea';
import ExpandableOmnichannelChat from './ExpandableOmnichannelChat';
import { copyToClipboard } from '../utils/clipboard';

interface SocialScheduledPost {
  id: string;
  caption: string;
  platforms: string[];
  scheduledAt: string; // YYYY-MM-DD
  scheduledTime?: string;
  status: 'SCHEDULED' | 'PUBLISHED' | 'FAILED';
  mediaUrl?: string;
}

const INITIAL_SOCIAL_POSTS: SocialScheduledPost[] = [
  {
    id: 'sp-1',
    caption: '🚀 Streamlining multi-channel communication workflows with Obsidian Core CRM. Reduced pipeline leakage by up to 34%!',
    platforms: ['instagram', 'whatsapp'],
    scheduledAt: '2026-06-16',
    scheduledTime: '10:00 AM',
    status: 'SCHEDULED',
    mediaUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=350'
  },
  {
    id: 'sp-2',
    caption: '📊 Raw performance check: Our secure WebRTC voice and video consultation gateways is maintaining average latencies under 45ms.',
    platforms: ['telegram', 'whatsapp'],
    scheduledAt: '2026-06-17',
    scheduledTime: '01:30 PM',
    status: 'PUBLISHED',
    mediaUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=350'
  },
  {
    id: 'sp-3',
    caption: '🔒 Releasing enterprise security standard guidelines. Cryptographic JWT signups now active on Twilio Consultation Nodes.',
    platforms: ['email', 'telegram'],
    scheduledAt: '2026-06-19',
    scheduledTime: '09:00 AM',
    status: 'SCHEDULED'
  }
];

const DEFAULT_SNIPPETS: Snippet[] = [
  { trigger: '/intro', text: 'Hi [Name], great connecting with you today! I wanted to follow up on your interest in our omnichannel CRM. Let me know if you have a few minutes to chat.', description: 'Brief introductory pitch' },
  { trigger: '/pricing', text: 'Hi [Name], here are the details for our [Plan] tier: $[Price]/month with complete multi-channel syncing, direct Twilio SMS, and WebRTC consultation nodes. Let me know if that works!', description: 'Plan pricing overview' },
  { trigger: '/demo', text: 'Hi [Name], thanks for scheduling a live walkthrough! We are excited to show you the CRM on [Date] at [Time]. Here is the virtual link: [MeetingLink]. See you then!', description: 'Demo calendar link' },
  { trigger: '/close', text: 'Hi [Name], if we can sign by [Date], I can secure a special [Discount]% discount on your first [Months] months of service. Shall I send over the updated agreement for signature?', description: 'Incentive-driven close' },
  { trigger: '/thankyou', text: 'Hi [Name], thank you so much for your time today! I really enjoyed learning about [Company]\'s customer qualification goals and workflows.', description: 'Post-meeting appreciation' }
];

interface MessagingViewProps {
  contacts: CRMContact[];
  selectedContact: CRMContact | null;
  onSelectContact: (contact: CRMContact) => void;
  messages: { [contactId: string]: CRMMessage[] };
  onSendMessage: (
    contactId: string, 
    text: string, 
    sender?: 'user' | 'contact',
    channel?: 'email' | 'whatsapp' | 'telegram' | 'sms' | 'instagram',
    subject?: string
  ) => void;
  onUpdateContactStatus: (contactId: string, status: 'active' | 'pending' | 'resolved') => void;
  onStartVideoCall: (contact: CRMContact) => void;
  onAddCalendarEvent?: (newEvent: Omit<CalendarEvent, 'id'>) => void;
  flashingContacts?: string[];
}

export default function MessagingView({
  contacts,
  selectedContact,
  onSelectContact,
  messages,
  onSendMessage,
  onUpdateContactStatus,
  onStartVideoCall,
  onAddCalendarEvent,
  flashingContacts = []
}: MessagingViewProps) {
  const activeContact = selectedContact || contacts[0] || null;
  const activeMessages = activeContact ? messages[activeContact.id] || [] : [];

  const { currentDraft, clearDraft } = useCommand();

  const [typedMessage, setTypedMessage] = useState('');
  const [selectedEmailMessage, setSelectedEmailMessage] = useState<CRMMessage | null>(null);
  const [activeRightTab, setActiveRightTab] = useState<'profile' | 'email-preview'>('profile');

  // Reset selected email and right pane tab when switching active contacts
  useEffect(() => {
    setSelectedEmailMessage(null);
    setActiveRightTab('profile');
  }, [selectedContact]);

  // Automatically switch right tab to preview when an email is selected
  useEffect(() => {
    if (selectedEmailMessage) {
      setActiveRightTab('email-preview');
    }
  }, [selectedEmailMessage]);

  const [userSnippets, setUserSnippets] = useState<Snippet[]>(() => {
    const saved = localStorage.getItem('sales_snippets');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return DEFAULT_SNIPPETS;
      }
    }
    return DEFAULT_SNIPPETS;
  });

  useEffect(() => {
    localStorage.setItem('sales_snippets', JSON.stringify(userSnippets));
  }, [userSnippets]);

  const [isAddingSnippet, setIsAddingSnippet] = useState(false);
  const [newTrigger, setNewTrigger] = useState('');
  const [newText, setNewText] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [snippetSearchQuery, setSnippetSearchQuery] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'telegram' | 'email' | 'sms' | 'instagram'>('all');
  const [viewMode, setViewMode] = useState<'omni-chat'>('omni-chat');
  
  // Interactive Mid-panel tab: 'chat' | 'expandable-chat'
  const [activeMiddleTab, setActiveMiddleTab] = useState<'chat' | 'expandable-chat'>('chat');

  // Omnichat Email Composer state variables
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [composerInitialTo, setComposerInitialTo] = useState('');
  const [composerInitialSubject, setComposerInitialSubject] = useState('');
  const [composerInitialBody, setComposerInitialBody] = useState('');

  // Archived Email Threads State
  const [archivedIds, setArchivedIds] = useState<string[]>([]);

  const handleArchiveThread = async (contactId: string) => {
    try {
      await fetch('/api/inbox/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: contactId,
          userId: 'usr_101'
        })
      });
      setArchivedIds(prev => [...prev, contactId]);
      showToast(`Email thread moved to 'archive' folder in D1 user_emails table.`);
      if (selectedContact?.id === contactId) {
        const remaining = filteredContacts.filter(c => c.id !== contactId);
        if (remaining.length > 0) {
          onSelectContact(remaining[0]);
        }
      }
    } catch (err: any) {
      setArchivedIds(prev => [...prev, contactId]);
      showToast(`Thread moved to archive folder.`);
    }
  };

  const handleReplyEmail = (msg: CRMMessage, fallbackSubject?: string) => {
    const rawSubject = msg.subject || fallbackSubject || (activeMessages.find(m => m.subject)?.subject) || 'CRM Action Plan & Pipeline Audit';
    const replySubject = rawSubject.toLowerCase().startsWith('re:') ? rawSubject : `Re: ${rawSubject}`;
    
    // Inbound messages from contact should reply to contact email; sent messages can reply to thread recipient
    const recipientEmail = activeContact?.email || 'client@domain.com';
    const senderName = msg.sender === 'user' ? 'System account manager' : (activeContact?.name || 'Contact');
    
    const quotedBody = `<p></p><br/><div style="border-left: 2px solid #94a3b8; padding-left: 12px; margin-left: 0; color: #64748b;"><p style="margin: 0 0 6px 0; font-size: 11px; font-weight: bold; color: #475569;">On ${msg.timestamp}, ${senderName} &lt;${recipientEmail}&gt; wrote:</p><p style="margin: 0; white-space: pre-wrap; font-style: italic;">${msg.text || ''}</p></div>`;

    setComposerInitialTo(recipientEmail);
    setComposerInitialSubject(replySubject);
    setComposerInitialBody(quotedBody);
    setIsEmailModalOpen(true);
    showToast(`Created reply draft to ${recipientEmail}: "${replySubject}"`);
  };

  const handleForwardEmail = (msg: CRMMessage, fallbackSubject?: string) => {
    const rawSubject = msg.subject || fallbackSubject || (activeMessages.find(m => m.subject)?.subject) || 'CRM Action Plan & Pipeline Audit';
    const fwdSubject = rawSubject.toLowerCase().startsWith('fwd:') ? rawSubject : `Fwd: ${rawSubject}`;
    
    const senderName = msg.sender === 'user' ? 'System account manager' : (activeContact?.name || 'Contact');
    const senderEmail = msg.sender === 'user' ? 'gateway@obsidian.crm' : (activeContact?.email || 'client@domain.com');
    const forwardedBody = `<p></p><br/><div style="border-top: 1px solid #cbd5e1; padding-top: 8px; margin-top: 12px; color: #475569;"><p style="margin: 0 0 4px 0; font-size: 11px; font-weight: bold;">---------- Forwarded message ---------</p><p style="margin: 0; font-size: 11px;"><b>From:</b> ${senderName} &lt;${senderEmail}&gt;<br/><b>Date:</b> ${msg.timestamp}<br/><b>Subject:</b> ${rawSubject}</p><div style="margin-top: 8px; white-space: pre-wrap;">${msg.text || ''}</div></div>`;

    setComposerInitialTo('');
    setComposerInitialSubject(fwdSubject);
    setComposerInitialBody(forwardedBody);
    setIsEmailModalOpen(true);
    showToast(`Created forward draft: "${fwdSubject}"`);
  };

  const [msgCc, setMsgCc] = useState('');
  const [msgBcc, setMsgBcc] = useState('');
  const [msgSubject, setMsgSubject] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [collapsedSubjects, setCollapsedSubjects] = useState<{ [subject: string]: boolean }>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  const insertSnippetFromSidebar = (snippet: Snippet) => {
    const separator = typedMessage.trim() ? '\n' : '';
    const newText = typedMessage + separator + snippet.text;
    setTypedMessage(newText);
    showToast(`Inserted snippet: ${snippet.trigger}`);
    
    setTimeout(() => {
      const textarea = document.getElementById('composer-textarea') as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.focus();
        const regex = /\[([^\]]+)\]/g;
        const match = regex.exec(newText);
        if (match) {
          textarea.setSelectionRange(match.index, match.index + match[0].length);
        } else {
          textarea.setSelectionRange(newText.length, newText.length);
        }
      }
    }, 150);
  };

  const addNewSnippet = () => {
    if (!newTrigger.trim() || !newText.trim()) {
      showToast('Error: Trigger and Text are required.');
      return;
    }
    
    let cleanTrigger = newTrigger.trim();
    if (!cleanTrigger.startsWith('/')) {
      cleanTrigger = '/' + cleanTrigger;
    }

    if (userSnippets.some(s => s.trigger.toLowerCase() === cleanTrigger.toLowerCase())) {
      showToast(`Error: Snippet with trigger ${cleanTrigger} already exists.`);
      return;
    }

    const nextSnippet: Snippet = {
      trigger: cleanTrigger,
      text: newText.trim(),
      description: newDescription.trim() || undefined
    };

    setUserSnippets(prev => [...prev, nextSnippet]);
    setNewTrigger('');
    setNewText('');
    setNewDescription('');
    setIsAddingSnippet(false);
    showToast(`Added snippet ${cleanTrigger} successfully!`);
  };

  const deleteSnippet = (trigger: string) => {
    setUserSnippets(prev => prev.filter(s => s.trigger.toLowerCase() !== trigger.toLowerCase()));
    showToast(`Removed snippet: ${trigger}`);
  };

  // Listen for draft changes pushed from the global Voice/Command Assistant
  useEffect(() => {
    if (currentDraft) {
      if (currentDraft.subject) {
        setMsgSubject(currentDraft.subject);
      }
      if (currentDraft.body) {
        setTypedMessage(currentDraft.body);
      }
      clearDraft();
    }
  }, [currentDraft, clearDraft]);

  // Synchronize Subject when the active email contact selection changes
  useEffect(() => {
    if (activeContact) {
      const activeMsgs = messages[activeContact.id] || [];
      const lastEmailMsg = [...activeMsgs].reverse().find(m => (m.channel || activeContact.channel) === 'email' && m.subject);
      if (lastEmailMsg && lastEmailMsg.subject) {
        const sub = lastEmailMsg.subject;
        setMsgSubject(sub.toLowerCase().startsWith('re:') ? sub : `Re: ${sub}`);
      } else {
        setMsgSubject('CRM Action Plan & Pipeline Audit');
      }
      setMsgCc('');
      setMsgBcc('');
      setShowCcBcc(false);
    }
  }, [selectedContact, messages]);

  // Helper to group emails by subject line
  const getGroupedMessages = () => {
    const groups: {
      type: 'email' | 'chat';
      subject?: string;
      messages: CRMMessage[];
    }[] = [];

    activeMessages.forEach((msg) => {
      const channel = msg.channel || activeContact?.channel;
      if (channel === 'email') {
        const subject = msg.subject || 'CRM Action Plan & Pipeline Audit';
        const existingGroup = groups.find(g => g.type === 'email' && g.subject === subject);
        if (existingGroup) {
          existingGroup.messages.push(msg);
        } else {
          groups.push({
            type: 'email',
            subject,
            messages: [msg]
          });
        }
      } else {
        groups.push({
          type: 'chat',
          messages: [msg]
        });
      }
    });

    return groups;
  };
  
  // Database Engineer SMTP Mongoose Synchronizer states
  const [showSmtpDevTools, setShowSmtpDevTools] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [simulationStatus, setSimulationStatus] = useState<'idle' | 'parsing' | 'saving' | 'success' | 'failed'>('idle');
  const [simulatedLogs, setSimulatedLogs] = useState<string[]>([]);
  const [simulatedEmail, setSimulatedEmail] = useState<any>(null);

  // Simulation form inputs
  const [simSubject, setSimSubject] = useState<string>('Obsidian CRM Enterprise Subscription Contract Handshake');
  const [simFromEmail, setSimFromEmail] = useState<string>('audit-daemon@defense.obsidian.secure');
  const [simFromName, setSimFromName] = useState<string>('System SMTP Auditor');
  const [simToEmail, setSimToEmail] = useState<string>('rpierrette45@gmail.com');
  const [simToName, setSimToName] = useState<string>('Rene Pierrette');
  const [simBodyText, setSimBodyText] = useState<string>('Security Verification Handshake Complete. Welcome to Secure CRM Gateway Node 9. Access granted under Clearance Code OP-DIR-9932.');
  const [socialPosts, setSocialPosts] = useState<SocialScheduledPost[]>(INITIAL_SOCIAL_POSTS);
  
  // Create / Schedule post form captures
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleTargetDate, setScheduleTargetDate] = useState('2026-06-16');
  const [newPostCaption, setNewPostCaption] = useState('');
  const [newPostPlatforms, setNewPostPlatforms] = useState<string[]>(['instagram', 'linkedin', 'twitter']);
  const [newPostTime, setNewPostTime] = useState('11:00 AM');
  const [newPostPresetImage, setNewPostPresetImage] = useState<string | undefined>(undefined);
  const [uploadedMediaList, setUploadedMediaList] = useState<string[]>([]);
  const [previewPlatform, setPreviewPlatform] = useState<string>('instagram');
  const [isSchedulingLoading, setIsSchedulingLoading] = useState(false);

  const [leadStage, setLeadStage] = useState<{ [id: string]: string }>({
    '1': 'Demo Scheduled',
    '2': 'Lead',
    '3': 'Proposal Sent',
    '4': 'Negotiation',
    '5': 'Won'
  });
  const [notes, setNotes] = useState<{ [id: string]: string }>({
    '1': 'Highly interested in enterprise seats. Schedule follow-up tech assessment.',
    '2': 'Requires SMS reminder gateway active.',
    '3': 'Prefers customized WhatsApp messaging broadcasts.'
  });
  const [activeCopilot, setActiveCopilot] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);

  // AI Intake Auto-responder variables
  const [sendingAs, setSendingAs] = useState<'user' | 'contact'>('user');
  const [aiResponding, setAiResponding] = useState(false);

  const [aiAutoResponder, setAiAutoResponder] = useState<{ [id: string]: boolean }>(() => {
    try {
      const stored = localStorage.getItem('crm_ai_autoresponder');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const [qualificationState, setQualificationState] = useState<{
    [id: string]: {
      challenge: string | null;
      budget: string | null;
      appointmentScheduled: boolean;
      transferredToHuman: boolean;
    }
  }>(() => {
    try {
      const stored = localStorage.getItem('crm_qualification_states');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('crm_ai_autoresponder', JSON.stringify(aiAutoResponder));
    } catch (e) {
      console.warn('[MessagingView] Failed to save AI autoresponder to localStorage:', e);
    }
  }, [aiAutoResponder]);

  useEffect(() => {
    try {
      localStorage.setItem('crm_qualification_states', JSON.stringify(qualificationState));
    } catch (e) {
      console.warn('[MessagingView] Failed to save qualification states to localStorage:', e);
    }
  }, [qualificationState]);

  // Voice-to-Text Speech Recognition states
  const [isListening, setIsListening] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  // Stop recognition if the component unmounts or active contact changes to prevent sound leaks
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // ignore already stopped recognition errors
        }
      }
    };
  }, [selectedContact]);

  const toggleListening = () => {
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          console.error('Stop error:', e);
        }
      }
      setIsListening(false);
    } else {
      setRecognitionError(null);
      if (!SpeechRecognitionAPI) {
        setRecognitionError("Speech-to-Text Dictation is not fully supported by this browser. Try Chrome/Safari.");
        setTimeout(() => setRecognitionError(null), 4000);
        return;
      }

      try {
        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          setIsListening(true);
        };

        recognition.onerror = (event: any) => {
          console.error('[Speech Recognition Error]:', event.error);
          if (event.error === 'not-allowed') {
            setRecognitionError("Microphone permission denied. Grant audio access in your browser settings.");
          } else {
            setRecognitionError(`Dictation status: ${event.error}`);
          }
          setIsListening(false);
          setTimeout(() => setRecognitionError(null), 4000);
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognition.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          if (finalTranscript) {
            setTypedMessage(prev => {
              const trimmed = prev.trim();
              return trimmed ? `${trimmed} ${finalTranscript.trim()}` : finalTranscript.trim();
            });
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err: any) {
        console.error('[Dictation Exception]:', err);
        setRecognitionError("Failed to initialize system microphone streams.");
        setTimeout(() => setRecognitionError(null), 4000);
      }
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll inside chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedContact, messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedMessage.trim() || !activeContact) return;

    const userMsg = typedMessage.trim();
    setTypedMessage('');

    const isEmail = activeContact.channel === 'email';
    if (isEmail && sendingAs === 'user') {
      // Send the message on the frontend with the selected subject
      onSendMessage(activeContact.id, userMsg, 'user', 'email', msgSubject);

      // Send to the backend endpoint with custom headers (cc, bcc, subject, text, html)
      try {
        if (!activeContact.email) { showToast('This contact has no email address.'); return; }
        const response = await axios.post('/api/communication/send-email', {
          to: activeContact.email, cc: msgCc || undefined, bcc: msgBcc || undefined,
          subject: msgSubject || '(No subject)', body: userMsg,
        }, { validateStatus: () => true });
        if (response.status === 202) showToast('Email sent.');
        else showToast(response.data?.error || `Email not sent (HTTP ${response.status}).`);
      } catch (err) {
        showToast('Email not sent: the server couldn’t be reached.');
      }

      // Reset CC / BCC Composer Fields
      setMsgCc('');
      setMsgBcc('');
      setShowCcBcc(false);
    } else {
      // Send standard message (WhatsApp, Telegram, SMS, IG, etc.)
      onSendMessage(activeContact.id, userMsg, sendingAs);
    }

    if (sendingAs === 'contact') {
      const botEnabled = aiAutoResponder[activeContact.id];
      if (botEnabled) {
        setAiResponding(true);
        setIsTyping(true);

        try {
          const currentQualState = qualificationState[activeContact.id] || {
            challenge: null,
            budget: null,
            appointmentScheduled: false,
            transferredToHuman: false
          };

          const activeThread = messages[activeContact.id] || [];
          const updatedThread = [...activeThread, { id: 'temp', sender: 'contact' as const, text: userMsg, timestamp: '' }];

          const response = await axios.post('/api/communication/intake-bot', {
            contactId: activeContact.id,
            messages: updatedThread,
            contactName: activeContact.name,
            company: activeContact.company,
            userMessage: userMsg,
            currentState: currentQualState
          });

          const data = response.data;
          
          if (data.success) {
            setTimeout(() => {
              setIsTyping(false);
              setAiResponding(false);

              // 1. Post AI response as specialist
              onSendMessage(activeContact.id, data.reply, 'user');

              // 2. Clear any typing & Update state
              const newQualState = {
                challenge: data.challenge,
                budget: data.budget,
                appointmentScheduled: !!data.shouldBookAppointment || currentQualState.appointmentScheduled,
                transferredToHuman: !!data.shouldTransferToHuman || currentQualState.transferredToHuman
              };

              setQualificationState(prev => ({
                ...prev,
                [activeContact.id]: newQualState
              }));

              // Handle Appointment Booking
              if (data.shouldBookAppointment && !currentQualState.appointmentScheduled) {
                if (onAddCalendarEvent) {
                  onAddCalendarEvent({
                    title: `Demo Scheduled: ${activeContact.name} (${activeContact.company})`,
                    time: '2026-06-23 14:00', // Next Tuesday, 2 PM EST as spec
                    type: 'demo',
                    contact: `${activeContact.name} (${activeContact.channel})`,
                    status: 'upcoming'
                  });
                }
                onUpdateContactStatus(activeContact.id, 'resolved');
                setLeadStage(prev => ({ ...prev, [activeContact.id]: 'Demo Scheduled' }));
              }

              // Handle Transfer To Human Specialist Action
              if (data.shouldTransferToHuman && !currentQualState.transferredToHuman) {
                onUpdateContactStatus(activeContact.id, 'pending');
                setLeadStage(prev => ({ ...prev, [activeContact.id]: 'Contacted' }));
              }

            }, 1200);

          } else {
            setIsTyping(false);
            setAiResponding(false);
          }
        } catch (err: any) {
          console.error('[Client Intake Call Fail]:', err.message);
          setIsTyping(false);
          setAiResponding(false);
        }
      }
    } else {
      // If manually reply as specialist, automatically trigger response from customer after 1.5s
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        let reply = "";
        if (userMsg.toLowerCase().includes('demo') || userMsg.toLowerCase().includes('schedule')) {
          reply = `Thanks for confirming! I see the demo is locked at ${activeContact.channel === 'email' ? 'your preselected time' : 'next Tuesday, 2 PM EST'}. Looking forward to reviewing the omnichannel dashboards!`;
        } else if (userMsg.toLowerCase().includes('price') || userMsg.toLowerCase().includes('cost')) {
          reply = "Can you send over the custom tier enterprise brochure? I will present it directly to our CTO this afternoon.";
        } else {
          reply = `Received! This is ${activeContact.name} checking in. Appreciate the swift response from your Obsidian gateway CRM.`;
        }
        onSendMessage(activeContact.id, reply, 'contact');
      }, 1500);
    }
  };

  const runCopilotSummary = (contactId: string) => {
    setActiveCopilot("Analyzing omnichannel transcripts, company profile, and historical logs...");
    setTimeout(() => {
      setActiveCopilot(`🔍 **Omnichannel AI Summary for ${activeContact?.name}**:
Lead is seeking high-trust conversational CRM integration for **${activeContact?.company}**. 
- **Sentiment Tracker**: ${activeContact?.sentiment.toUpperCase()} rating. 
- **Last Interaction**: Responded via ${activeContact?.channel.toUpperCase()}. 
- **Suggested Next Step**: Schedule draft contract dispatch. Potential deal valuation is approx **$24,000/year**.`);
    }, 1000);
  };

  const debouncedSearchQuery = useDebounce(searchQuery, 350);
  const debouncedSnippetSearch = useDebounce(snippetSearchQuery, 350);

  // Filter contacts (350ms debounced)
  const filteredContacts = contacts.filter(contact => {
    if (archivedIds.includes(contact.id)) return false;
    const query = debouncedSearchQuery.trim().toLowerCase();
    const matchesSearch = query === '' ||
                          contact.name.toLowerCase().includes(query) || 
                          contact.company.toLowerCase().includes(query) || 
                          contact.lastMessage.toLowerCase().includes(query);
    const matchesChannel = channelFilter === 'all' || contact.channel === channelFilter;
    return matchesSearch && matchesChannel;
  });

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-140px)] min-h-[550px] w-full" id="messaging-workspace-root">
      
      {/* Action Toast Alert */}
      {toastMessage && (
        <div className="obsidian fixed top-6 right-6 z-50 bg-[var(--obsidian-2)] border border-indigo-600/30 text-white text-[12px] font-medium px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-300">
          <Sparkles className="h-4 w-4 shrink-0 text-[#a09eff] animate-spin" />
          <span>{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="ml-3 hover:text-white opacity-60">✕</button>
        </div>
      )}
      
      {/* 🧭 SYSTEM HEADER: Direct Client Messaging & Live Conversations */}
      <div className="flex items-center justify-between p-3.5 rounded-2xl border border-white/5 bg-[#090b0e]/80 backdrop-blur-md shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div>
            <span className="text-[9px] font-black text-indigo-400 font-mono uppercase tracking-widest bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/10">
              Live Gateway
            </span>
            <h2 className="text-xs font-black text-white mt-1">
              Direct Client Messaging &amp; Live Omnichannel Conversations
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono text-[11px]">Channels: WhatsApp • Telegram • SMS • Instagram • WebChat</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 flex-1 min-h-0 min-w-0" id="omnichannel-workspace-grid">
          
          {/* 1. Left panel: Client List */}
          <div className="md:col-span-4 lg:col-span-3 rounded-xl border border-white/5 bg-neutral-900/20 p-4 backdrop-blur-md flex flex-col h-full overflow-hidden" id="inbox-chats-sidebar">
        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute top-3 left-3 h-4 w-4 text-neutral-500" />
          <input 
            type="text" 
            placeholder="Search feed..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-white/5 bg-neutral-950/40 py-2 pl-9 pr-4 text-xs font-medium text-white placeholder-neutral-500 outline-none focus:border-blue-500/30"
          />
        </div>

        {/* Small Channel filter strip */}
        <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-none border-b border-white/5 mb-3">
          {(['all', 'whatsapp', 'telegram', 'email', 'sms', 'instagram'] as const).map(channel => (
            <button
              key={channel}
              onClick={() => setChannelFilter(channel)}
              className={`rounded-md px-2 py-1 text-[10px] font-bold shrink-0 capitalize ${
                channelFilter === channel 
                  ? 'bg-blue-600/25 text-blue-400 border border-blue-500/25' 
                  : 'bg-neutral-800/40 text-neutral-400 border border-transparent hover:text-white'
              }`}
            >
              {channel}
            </button>
          ))}
        </div>

        {/* Database Engineer SMTP Mongoose tool card trigger */}
        {channelFilter === 'email' && (
          <button 
            id="smtp-schema-utility-trigger"
            onClick={() => {
              setShowSmtpDevTools(true);
              setSimulatedLogs([]);
              setSimulationStatus('idle');
              setSimulatedEmail(null);
            }}
            className="w-full flex items-center justify-between p-3 rounded-xl border border-orange-500/20 bg-orange-500/5 hover:bg-orange-500/10 cursor-pointer text-left transition-all duration-200 font-sans mb-3 select-none group/smtp shrink-0"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0 group-hover/smtp:border-orange-500/40 transition-colors">
                <Database className="h-4 w-4 text-orange-400 animate-pulse" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-black text-orange-400 uppercase tracking-widest block font-mono">Mongoose SMTP Syncer</span>
                <span className="text-[9px] text-neutral-400 block truncate font-sans">Click to inspect schema & test parser writes</span>
              </div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-orange-400 group-hover/smtp:translate-x-0.5 transition-transform shrink-0" />
          </button>
        )}

        {/* Sidebar Header Action & Draft Email Button */}
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[10px] font-extrabold uppercase tracking-widest text-neutral-400 font-mono">
            Inbox ({filteredContacts.length})
          </span>
          <button
            id="btn-open-email-composer"
            type="button"
            onClick={() => {
              setComposerInitialTo(activeContact?.email || '');
              const activeMsgs = activeContact ? messages[activeContact.id] || [] : [];
              const sub = activeMsgs.find(m => m.subject)?.subject || (activeContact?.channel === 'email' ? 'CRM Action Plan & Pipeline Audit' : '');
              setComposerInitialSubject(sub ? (sub.toLowerCase().startsWith('re:') ? sub : `Re: ${sub}`) : '');
              setIsEmailModalOpen(true);
            }}
            className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-black font-extrabold text-[10px] px-2.5 py-1 rounded-lg shadow-sm transition-all cursor-pointer"
          >
            <Mail className="h-3 w-3 text-black" />
            <span>Draft Email Modal</span>
          </button>
        </div>

        {/* Client List */}
        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {filteredContacts.length === 0 ? (
            <div className="text-center py-10">
              <span className="text-xs text-neutral-500 font-semibold block">No customer found</span>
            </div>
          ) : (
            filteredContacts.map(contact => {
              const isActive = activeContact?.id === contact.id;
              const isFlashing = flashingContacts.includes(contact.id);
              const contactMsgs = messages[contact.id] || [];
              const isEmailThread = contact.channel === 'email' || contactMsgs.some(m => m.channel === 'email');
              const emailSubject = contactMsgs.find(m => m.subject)?.subject || (isEmailThread ? 'CRM Action Plan & Pipeline Audit' : null);

              return (
                <div 
                  id={`contact-row-${contact.id}`}
                  key={contact.id}
                  onClick={() => onSelectContact(contact)}
                  className={`group flex flex-col p-3 rounded-xl border cursor-pointer transition-all duration-200 ${
                    isFlashing
                      ? 'animate-flash-blue'
                      : isActive 
                        ? isEmailThread
                          ? 'bg-amber-950/20 border-amber-500/40 shadow-lg shadow-amber-950/20'
                          : 'bg-blue-600/10 border-blue-500/20 shadow-lg shadow-blue-950/10' 
                        : isEmailThread
                          ? 'border-amber-500/15 bg-amber-950/10 hover:bg-amber-900/20 hover:border-amber-500/30'
                          : 'border-white/5 bg-neutral-900/30 hover:bg-neutral-900/60 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative shrink-0">
                      <img 
                        src={contact.avatar} 
                        alt={contact.name} 
                        className="h-9 w-9 rounded-md bg-neutral-800 object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <span className={`absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] text-white font-bold p-0.5 shadow-md ${
                        contact.channel === 'whatsapp' ? 'bg-emerald-500' : 
                        contact.channel === 'telegram' ? 'bg-sky-500' : 
                        contact.channel === 'email' ? 'bg-amber-500' : 'bg-blue-500'
                      }`}>
                        {contact.channel[0].toUpperCase()}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className={`text-xs font-bold truncate ${
                          isActive 
                            ? (isEmailThread ? 'text-amber-400' : 'text-blue-400') 
                            : 'text-neutral-200'
                        }`}>
                          {contact.name}
                        </h4>
                        <span className="text-[9px] text-neutral-500 font-medium font-mono">{contact.timestamp}</span>
                      </div>
                      
                      {/* Visual Channel Thread Badge */}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {isEmailThread ? (
                          <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 rounded font-mono">
                            <Mail className="h-2.5 w-2.5 text-amber-400" />
                            Email Thread
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[8px] font-black uppercase tracking-wider text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.2 rounded font-mono">
                            <MessageSquare className="h-2.5 w-2.5 text-emerald-400" />
                            {contact.channel} Thread
                          </span>
                        )}
                        {contact.unread && (
                          <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse ml-auto"></span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Display Email Subject Line prominently if it is an email thread */}
                  {isEmailThread && emailSubject && (
                    <div className="mt-2.5 px-2.5 py-1.5 rounded-lg bg-amber-950/40 border border-amber-500/20 text-[10px] font-medium text-amber-200/90 flex items-center justify-between gap-1.5 min-w-0 shadow-inner group/sub">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FileText className="h-3 w-3 text-amber-400 shrink-0" />
                        <span className="font-bold text-amber-400 shrink-0">Subject:</span>
                        <span className="truncate italic font-sans">{emailSubject}</span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArchiveThread(contact.id);
                        }}
                        className="p-1 rounded bg-amber-500/10 hover:bg-amber-500/30 text-amber-300 hover:text-amber-100 transition-colors shrink-0 cursor-pointer ml-1"
                        title="Archive this email thread"
                      >
                        <Archive className="h-3 w-3 text-amber-400" />
                      </button>
                    </div>
                  )}

                  {!isEmailThread && (
                    <p className="text-[11px] text-neutral-400 truncate mt-1.5 pl-0.5">{contact.lastMessage}</p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 2. Middle Panel: Live Chat Workspace with Tab Filters */}
      <div className="md:col-span-8 lg:col-span-6 rounded-xl border border-white/5 bg-neutral-900/20 flex flex-col h-full overflow-hidden backdrop-blur-md" id="message-thread-pane">
        {activeContact ? (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between p-4 border-b border-white/5 bg-neutral-950/30 shrink-0">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <img 
                    src={activeContact.avatar} 
                    alt={activeContact.name} 
                    className="h-10 w-10 rounded-lg object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-[var(--obsidian-0)] bg-emerald-500"></div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-sans font-bold text-sm text-white">{activeContact.name}</span>
                    <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[9px] font-bold text-neutral-400 uppercase tracking-widest">{activeContact.channel}</span>
                  </div>
                  <span className="text-xs text-neutral-400 font-mono italic">{activeContact.company || "Independent client"}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button 
                  id="btn-launch-video-consult"
                  onClick={() => onStartVideoCall(activeContact)}
                  className="rounded-lg bg-blue-600/15 text-blue-400 hover:bg-blue-600 hover:text-white border border-blue-500/20 px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-2 cursor-pointer hover:border-blue-500/30"
                  title="Launch private encrypted consultation"
                >
                  <Video className="h-3.5 w-3.5 animate-pulse text-blue-400" />
                  <span className="hidden sm:inline">Go Live</span>
                </button>
                <button 
                  id="btn-update-pending"
                  onClick={() => onUpdateContactStatus(activeContact.id, 'pending')}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                    activeContact.status === 'pending'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                      : 'border border-white/5 text-neutral-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Snooze
                </button>
                <button 
                  id="btn-update-resolved"
                  onClick={() => onUpdateContactStatus(activeContact.id, 'resolved')}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                    activeContact.status === 'resolved'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                      : 'border border-white/5 text-neutral-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  Resolve
                </button>
              </div>
            </div>

            {/* Email Subject Header Banner if active conversation is an Email thread */}
            {((activeContact && activeContact.channel === 'email') || activeMessages.some(m => m.channel === 'email')) && (
              <div className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-amber-950/40 via-orange-950/20 to-amber-950/40 border-b border-amber-500/20 shrink-0">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-200 min-w-0">
                  <FileText className="h-4 w-4 text-amber-400 shrink-0" />
                  <span className="font-bold text-amber-400 font-mono text-[10px] uppercase tracking-wider bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30 shrink-0">
                    Email Subject:
                  </span>
                  <span className="truncate italic text-amber-100 font-sans">
                    {activeMessages.find(m => m.subject)?.subject || msgSubject || "CRM Action Plan & Pipeline Audit"}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <button
                    id="btn-archive-email-thread"
                    type="button"
                    onClick={() => activeContact && handleArchiveThread(activeContact.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900/80 hover:bg-neutral-800 text-amber-300 border border-amber-500/30 text-[11px] font-bold transition-all cursor-pointer shadow-sm hover:border-amber-500/50"
                    title="Move email thread to 'archive' folder in D1 user_emails table"
                  >
                    <Archive className="h-3.5 w-3.5 text-amber-400" />
                    <span>Archive Thread</span>
                  </button>
                  <button
                    id="btn-reply-email-modal"
                    type="button"
                    onClick={() => {
                      setComposerInitialTo(activeContact?.email || '');
                      const currentSubject = activeMessages.find(m => m.subject)?.subject || msgSubject || 'CRM Action Plan & Pipeline Audit';
                      setComposerInitialSubject(currentSubject.toLowerCase().startsWith('re:') ? currentSubject : `Re: ${currentSubject}`);
                      setIsEmailModalOpen(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-[11px] shadow-sm transition-all cursor-pointer"
                  >
                    <Mail className="h-3.5 w-3.5 text-black" />
                    <span>Draft Email Modal</span>
                  </button>
                </div>
              </div>
            )}

            {/* INTERACTIVE WORKSPACE VIEW SELECTOR TABS */}
            <div className="flex border-b border-white/5 bg-neutral-950/30 px-4 py-2.5 gap-2 shrink-0 select-none">
              <button
                type="button"
                id="btn-tab-unified-feed"
                onClick={() => setActiveMiddleTab('chat')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeMiddleTab === 'chat'
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20 shadow-lg shadow-blue-900/10'
                    : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-850'
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Unified Thread</span>
                <span className="rounded-full bg-neutral-950 border border-white/5 px-2 py-0.2 text-[9px] font-bold text-neutral-400 font-mono">
                  {activeMessages.length}
                </span>
              </button>

              <button
                type="button"
                id="btn-tab-expandable-chat"
                onClick={() => setActiveMiddleTab('expandable-chat')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeMiddleTab === 'expandable-chat'
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/20 shadow-lg shadow-blue-900/10'
                    : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-850'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-blue-400 animate-pulse" />
                <span>Expandable Live Chat</span>
                <span className="rounded-full bg-blue-500/20 border border-blue-500/30 px-1.5 py-0.2 text-[8px] font-extrabold text-blue-300 font-mono">
                  Socket.io
                </span>
              </button>
            </div>

            {/* TAB-1: UNIFIED COMMUNICATION THREAD FEED */}
            {activeMiddleTab === 'chat' && (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/20 flex flex-col">
                  {/* Status Banner */}
                  <div className="text-center shrink-0">
                    <span className="inline-flex items-center gap-1.5 text-[9px] font-extrabold text-neutral-500 font-mono uppercase tracking-widest bg-neutral-950/60 border border-white/5 px-3 py-1 rounded-full">
                      <Zap className="h-3 w-3 text-emerald-400" />
                      SECURE OMNICHANNEL GATEWAY ACTIVE
                    </span>
                  </div>

                  {/* Messages Bubble List */}
                  <div className="space-y-4 flex-1">
                    {(() => {
                      const groups = getGroupedMessages();
                      return groups.map((group, groupIndex) => {
                        if (group.type === 'email') {
                          const subject = group.subject || 'CRM Action Plan & Pipeline Audit';
                          const isCollapsed = !!collapsedSubjects[subject];
                          const messageCount = group.messages.length;

                          return (
                            <div key={`email-group-${subject}-${groupIndex}`} className="border border-white/10 rounded-xl bg-neutral-900/40 overflow-hidden shadow-md">
                              {/* Group Header */}
                              <div 
                                onClick={() => {
                                  setCollapsedSubjects(prev => ({
                                    ...prev,
                                    [subject]: !prev[subject]
                                  }));
                                }}
                                className="flex items-center justify-between p-3.5 bg-neutral-950/50 cursor-pointer select-none border-b border-white/5 hover:bg-neutral-950/80 transition-all"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="h-7 w-7 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                                    <Mail className="h-4 w-4 text-orange-400" />
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="text-xs font-bold text-gray-100 truncate">
                                      {subject}
                                    </h4>
                                    <span className="text-[10px] text-neutral-400 font-medium block">
                                      {messageCount} {messageCount === 1 ? 'message' : 'messages'} in thread
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2.5">
                                  <span className="text-[9px] font-bold uppercase text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded font-mono">
                                    Email Thread
                                  </span>
                                  {isCollapsed ? (
                                    <ChevronDown className="h-4 w-4 text-neutral-400" />
                                  ) : (
                                    <ChevronUp className="h-4 w-4 text-neutral-400" />
                                  )}
                                </div>
                              </div>

                              {/* Group Messages */}
                              {!isCollapsed && (
                                <div className="p-3.5 space-y-4 bg-black/10">
                                  {group.messages.map((msg, index) => {
                                    const isUser = msg.sender === 'user';
                                    const channel = 'email';
                                    const tagColor = "text-orange-400 bg-orange-500/10 border-orange-500/15";
                                    const cardClass = isUser
                                      ? "bg-neutral-900 border-2 border-blue-500/20 text-neutral-100 rounded-lg w-full max-w-[340px]"
                                      : "bg-neutral-900 border border-orange-500/20 text-neutral-100 rounded-lg w-full max-w-[340px]";

                                    return (
                                      <div key={msg.id || index} className={`flex ${isUser ? 'justify-end' : 'justify-start'} w-full`}>
                                        <div className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                                          <div className="flex items-center gap-1.5 mb-1 px-1 text-[9px] select-none font-bold">
                                            <Mail className="h-3.5 w-3.5 text-orange-400" />
                                            <span className={`capitalize uppercase font-mono tracking-wider ${isUser ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                              {isUser ? 'System account manager' : activeContact.name}
                                            </span>
                                            <span className="text-[9px] text-neutral-500">•</span>
                                            <span className={`rounded px-1.5 py-0.2 text-[8px] font-extrabold border font-mono ${tagColor}`}>
                                              {channel}
                                            </span>
                                          </div>

                                          <div 
                                            onClick={() => {
                                              setSelectedEmailMessage({
                                                ...msg,
                                                subject: msg.subject || group.subject || 'CRM Action Plan & Pipeline Audit'
                                              });
                                            }}
                                            className={`rounded-xl px-4 py-3 text-xs font-semibold leading-relaxed shadow-md ${cardClass} cursor-pointer transition-all hover:ring-2 hover:ring-orange-500/30 ${
                                              selectedEmailMessage?.id === msg.id || (selectedEmailMessage?.timestamp === msg.timestamp && selectedEmailMessage?.text === msg.text)
                                                ? 'ring-2 ring-orange-500/80 bg-neutral-900/90'
                                                : ''
                                            }`}
                                          >
                                            <div className="border-b border-white/5 pb-2 mb-2 font-mono">
                                              <span className="text-[9px] text-neutral-500 block">
                                                <strong className="text-neutral-400">Client Address:</strong> {isUser ? 'gateway@obsidian.crm' : activeContact.email}
                                              </span>
                                            </div>
                                            
                                            <p className="whitespace-pre-wrap">{msg.text}</p>
                                            
                                            {!isUser && (
                                              <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-[10px] text-neutral-400 font-sans">
                                                <div className="flex items-center gap-1.5 font-sans bg-neutral-950/40 border border-white/5 px-2 py-1 rounded select-none">
                                                  <FileText className="h-3.5 w-3.5 text-blue-400" />
                                                  <span className="truncate max-w-[150px]">compliance_sla_audit_draft_v3.pdf</span>
                                                  <span className="text-[8px] font-mono font-bold text-neutral-500 bg-white/5 px-1 rounded">1.7 MB</span>
                                                </div>
                                              </div>
                                            )}

                                            <div className="flex items-center justify-between gap-1.5 mt-2.5 pt-2 border-t border-white/5 text-[9px] text-neutral-500 font-mono">
                                              <div className="flex items-center gap-1.5">
                                                <button
                                                  id={`btn-reply-email-${msg.id || index}`}
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleReplyEmail(msg, group.subject);
                                                  }}
                                                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 text-[9px] font-bold transition-all cursor-pointer shadow-2xs hover:border-blue-500/50"
                                                  title="Reply to this email"
                                                >
                                                  <CornerUpLeft className="h-3 w-3 text-blue-400" />
                                                  <span>Reply</span>
                                                </button>
                                                <button
                                                  id={`btn-forward-email-${msg.id || index}`}
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleForwardEmail(msg, group.subject);
                                                  }}
                                                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[9px] font-bold transition-all cursor-pointer shadow-2xs hover:border-amber-500/50"
                                                  title="Forward this email"
                                                >
                                                  <CornerUpRight className="h-3 w-3 text-amber-400" />
                                                  <span>Forward</span>
                                                </button>
                                              </div>
                                              <div className="flex items-center gap-1.5">
                                                <span>{msg.timestamp}</span>
                                              {isUser && (
                                                <span className="text-blue-400 flex items-center justify-center font-bold text-[8px]">● Sent</span>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        } else {
                          // Render normal chat message sequentially
                          return group.messages.map((msg, index) => {
                            const isUser = msg.sender === 'user';
                            const channel = msg.channel || activeContact.channel;
                            
                            let channelIcon = <MessageSquare className="h-3.5 w-3.5 text-blue-400" />;
                            let cardClass = "";
                            let tagColor = "text-neutral-500 bg-neutral-900 border-white/5";
                            
                            if (channel === 'whatsapp') {
                              channelIcon = <MessageCircle className="h-3.5 w-3.5 text-emerald-400" />;
                              tagColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/15";
                              cardClass = isUser 
                                ? "bg-emerald-600/90 text-white rounded-tr-none border border-emerald-500/30 shadow-lg shadow-emerald-950/10" 
                                : "bg-neutral-900/90 border border-emerald-500/25 text-neutral-100 rounded-tl-none";
                            } else if (channel === 'sms') {
                              channelIcon = <Phone className="h-3.5 w-3.5 text-indigo-400" />;
                              tagColor = "text-indigo-400 bg-indigo-500/10 border-indigo-500/15";
                              cardClass = isUser
                                ? "bg-indigo-650 text-white rounded-tr-none border border-indigo-500/20"
                                : "bg-neutral-900 border border-indigo-500/10 text-neutral-200 rounded-tl-none";
                            } else if (channel === 'instagram') {
                              channelIcon = <Instagram className="h-3.5 w-3.5 text-pink-400" />;
                              tagColor = "text-pink-400 bg-pink-500/10 border-pink-500/15";
                              cardClass = isUser
                                ? "bg-pink-900/40 border border-pink-500/25 text-white rounded-tr-none"
                                : "bg-neutral-900 border border-pink-500/15 text-neutral-200 rounded-tl-none";
                            } else if (channel === 'telegram') {
                              channelIcon = <Send className="h-3.5 w-3.5 text-sky-400" />;
                              tagColor = "text-sky-400 bg-sky-500/10 border-sky-500/15";
                              cardClass = isUser
                                ? "bg-sky-600 text-white rounded-tr-none"
                                : "bg-neutral-900 border border-sky-500/15 text-neutral-100 rounded-tl-none";
                            } else {
                              cardClass = isUser
                                ? "bg-neutral-800 text-white rounded-tr-none"
                                : "bg-neutral-900 border border-white/5 text-neutral-100 rounded-tl-none";
                            }

                            return (
                              <div key={msg.id || index} className={`flex ${isUser ? 'justify-end' : 'justify-start'} w-full`}>
                                <div className={`flex flex-col max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                                  {/* Origin subtitle tag */}
                                  <div className="flex items-center gap-1.5 mb-1 px-1 text-[9px] select-none font-bold">
                                    {channelIcon}
                                    <span className={`capitalize uppercase font-mono tracking-wider ${isUser ? 'text-neutral-500' : 'text-neutral-400'}`}>
                                      {isUser ? 'System account manager' : activeContact.name}
                                    </span>
                                    <span className="text-[9px] text-neutral-500">•</span>
                                    <span className={`rounded px-1.5 py-0.2 text-[8px] font-extrabold border font-mono ${tagColor}`}>
                                      {channel}
                                    </span>
                                  </div>

                                  {/* Message Core box */}
                                  <div 
                                    onClick={() => {
                                      if (channel === 'email') {
                                        setSelectedEmailMessage({
                                          ...msg,
                                          subject: msg.subject || 'CRM Action Plan & Pipeline Audit'
                                        });
                                      }
                                    }}
                                    className={`rounded-xl px-4 py-3 text-xs font-semibold leading-relaxed shadow-md ${cardClass} ${
                                      channel === 'email' 
                                        ? `cursor-pointer transition-all hover:ring-2 hover:ring-orange-500/30 ${
                                            selectedEmailMessage?.id === msg.id || (selectedEmailMessage?.timestamp === msg.timestamp && selectedEmailMessage?.text === msg.text)
                                              ? 'ring-2 ring-orange-500/80 bg-neutral-900/90'
                                              : ''
                                          }`
                                        : ''
                                    }`}
                                  >
                                    <p className="whitespace-pre-wrap">{msg.text}</p>
                                    
                                    <div className="flex items-center justify-between gap-1.5 mt-2.5 pt-2 border-t border-white/5 text-[9px] text-neutral-500 font-mono">
                                      {channel === 'email' && (
                                        <div className="flex items-center gap-1.5">
                                          <button
                                            id={`btn-reply-msg-${msg.id || index}`}
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleReplyEmail(msg);
                                            }}
                                            className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 text-[9px] font-bold transition-all cursor-pointer shadow-2xs hover:border-blue-500/50"
                                            title="Reply to this email"
                                          >
                                            <CornerUpLeft className="h-3 w-3 text-blue-400" />
                                            <span>Reply</span>
                                          </button>
                                          <button
                                            id={`btn-forward-msg-${msg.id || index}`}
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleForwardEmail(msg);
                                            }}
                                            className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[9px] font-bold transition-all cursor-pointer shadow-2xs hover:border-amber-500/50"
                                            title="Forward this email"
                                          >
                                            <CornerUpRight className="h-3 w-3 text-amber-400" />
                                            <span>Forward</span>
                                          </button>
                                        </div>
                                      )}
                                      <div className="flex items-center gap-1.5 ml-auto">
                                        <span>{msg.timestamp}</span>
                                      {isUser && channel === 'whatsapp' && (
                                        <span className="text-emerald-400 flex items-center justify-center font-bold" title="Message read double-check">✓✓</span>
                                      )}
                                      {isUser && channel !== 'whatsapp' && (
                                        <span className="text-blue-400 flex items-center justify-center font-bold text-[8px]">● Sent</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            );
                          });
                        }
                      });
                    })()}

                    {/* Typing simulation */}
                    {isTyping && (
                      <div className="flex justify-start">
                        <div className="bg-neutral-900 border border-white/5 rounded-xl rounded-tl-none px-4 py-2.5 text-xs font-semibold text-neutral-400">
                          <div className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 bg-neutral-500 rounded-full animate-bounce"></span>
                            <span className="h-1.5 w-1.5 bg-neutral-500 rounded-full animate-bounce delay-100"></span>
                            <span className="h-1.5 w-1.5 bg-neutral-500 rounded-full animate-bounce delay-200"></span>
                            <span className="text-[10px] font-mono font-bold text-neutral-500 ml-1">Client drafting...</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div ref={messagesEndRef} />
                </div>

                {/* Send Interface Form */}
                <form onSubmit={handleSend} className="p-3.5 border-t border-white/5 bg-neutral-950/35 flex flex-col gap-2.5 shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2">
                    {/* Chat simulation role selector */}
                    <div className="flex gap-1 bg-neutral-950/80 border border-white/5 rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => setSendingAs('user')}
                        className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${
                          sendingAs === 'user' 
                            ? 'bg-blue-600/25 text-blue-400 border border-blue-500/20' 
                            : 'text-neutral-500 hover:text-neutral-400'
                        }`}
                      >
                        ✍️ Reply as Specialist
                      </button>
                      <button
                        type="button"
                        onClick={() => setSendingAs('contact')}
                        className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${
                          sendingAs === 'contact' 
                            ? 'bg-amber-600/25 text-amber-400 border border-amber-500/20' 
                            : 'text-neutral-500 hover:text-neutral-400'
                        }`}
                        title="Simulate incoming customer message to test the AI qualification bot flow"
                      >
                        📞 Simulate Lead Inbound
                      </button>
                    </div>

                    {/* AI Agent Status indicators / Toggle */}
                    <div className="flex items-center gap-2">
                       <span className={`text-[10px] font-bold ${aiResponding ? 'text-indigo-400 animate-pulse' : 'text-neutral-400 font-semibold'}`}>
                         {aiResponding ? '🤖 Bot Processing...' : '🤖 AI Auto-Responder'}
                       </span>
                       <button
                         type="button"
                         onClick={() => setAiAutoResponder({ ...aiAutoResponder, [activeContact.id]: !aiAutoResponder[activeContact.id] })}
                         className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 outline-none ${
                           aiAutoResponder[activeContact.id] ? 'bg-indigo-600' : 'bg-neutral-800'
                         }`}
                       >
                         <span className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                           aiAutoResponder[activeContact.id] ? 'translate-x-3.5' : 'translate-x-0'
                         }`} />
                       </button>
                    </div>
                  </div>

                  {/* Email-Specific CC, BCC and Subject header fields */}
                  {activeContact?.channel === 'email' && sendingAs === 'user' && (
                    <div className="bg-neutral-900/60 border border-white/5 p-3 rounded-lg space-y-2 mb-1 text-left">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-orange-400 tracking-wider uppercase font-mono">
                          📧 SMTP Email Options
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowCcBcc(!showCcBcc)}
                          className="text-[10px] font-bold text-orange-400 hover:text-orange-300 transition-colors"
                        >
                          {showCcBcc ? "Hide CC/BCC" : "Configure CC/BCC"}
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider font-mono">Subject</label>
                          <input 
                            type="text" 
                            placeholder="Email subject..."
                            value={msgSubject}
                            onChange={(e) => setMsgSubject(e.target.value)}
                            className="w-full text-xs font-semibold rounded-lg border border-white/5 bg-neutral-950/40 p-2 text-white outline-none focus:border-blue-500/20"
                          />
                        </div>

                        {showCcBcc && (
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider font-mono">CC</label>
                              <input 
                                type="text" 
                                placeholder="cc@company.com"
                                value={msgCc}
                                onChange={(e) => setMsgCc(e.target.value)}
                                className="w-full text-xs font-semibold rounded-lg border border-white/5 bg-neutral-950/40 p-2 text-white outline-none focus:border-blue-500/20 font-mono"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] font-bold text-neutral-400 uppercase tracking-wider font-mono">BCC</label>
                              <input 
                                type="text" 
                                placeholder="bcc@company.com"
                                value={msgBcc}
                                onChange={(e) => setMsgBcc(e.target.value)}
                                className="w-full text-xs font-semibold rounded-lg border border-white/5 bg-neutral-950/40 p-2 text-white outline-none focus:border-blue-500/20 font-mono"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Dictation Live status / Errors */}
                  {isListening && (
                    <div className="flex items-center gap-2 px-1 text-[10px] text-red-400 font-mono animate-pulse font-bold select-none mt-1">
                      <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
                      <span>VOCAL DICTATION RUNNING • Speak clearly into your microphone...</span>
                    </div>
                  )}
                  {recognitionError && (
                    <div className="flex items-center gap-1.5 px-1 text-[10px] text-amber-500 font-bold select-none mt-1 bg-amber-500/5 p-1 rounded border border-amber-500/10">
                      <AlertTriangle className="h-3 w-3 text-amber-400" />
                      <span>{recognitionError}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2.5 mt-1">
                    <button 
                      type="button"
                      onClick={() => {
                        alert('Encrypted secure file uploader active. Choose contract drafts or logs.');
                      }}
                      className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
                      title="Attach files to thread"
                    >
                      <Paperclip className="h-4.5 w-4.5" />
                    </button>
                    
                    {/* Voice-to-Text dictate button */}
                    <button 
                      type="button"
                      onClick={toggleListening}
                      className={`p-2 rounded-lg transition-all cursor-pointer relative shrink-0 border ${
                        isListening 
                          ? 'bg-red-500/10 border-red-500/20 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.15)] animate-pulse' 
                          : 'border-transparent text-neutral-400 hover:text-white hover:bg-neutral-800'
                      }`}
                      title={isListening ? "Stop speech dictation recorder" : "Dictate response (Voice-to-Text)"}
                    >
                      {isListening ? (
                        <>
                          <Mic className="h-4.5 w-4.5 text-red-500" />
                          <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                          </span>
                        </>
                      ) : (
                        <Mic className="h-4.5 w-4.5" />
                      )}
                    </button>

                    <SnippetTextArea 
                      value={typedMessage}
                      onChange={setTypedMessage}
                      placeholder={
                        isListening 
                          ? "Listening to voice input... Speak now..." 
                          : (sendingAs === 'user' ? `Reply as Specialist to ${activeContact.name}... (Try /intro, /pricing, or /demo)` : `Type what the customer ${activeContact.name} says...`)
                      }
                      snippets={userSnippets}
                      className={`flex-1 rounded-xl border p-2.5 text-xs font-semibold text-white placeholder-neutral-500 outline-none transition-all ${
                        isListening 
                          ? 'border-red-500/30 ring-1 ring-red-500/15 bg-neutral-950/70 shadow-[0_0_10px_rgba(239,68,68,0.05)]' 
                          : 'border-white/5 bg-neutral-900/60 focus:border-blue-500/20'
                      }`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          const form = e.currentTarget.form;
                          if (form) {
                            // Find submit button and click it to trigger submit
                            const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
                            if (submitBtn) {
                              submitBtn.click();
                            }
                          }
                        }
                      }}
                    />
                    <button 
                      type="submit"
                      disabled={!typedMessage.trim() || aiResponding}
                      className={`p-2 px-3 text-xs font-bold text-white rounded-lg transition-all cursor-pointer shadow-md ${
                        sendingAs === 'user' ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/10' : 'bg-amber-600 hover:bg-amber-500 shadow-amber-500/10'
                      }`}
                    >
                      Send
                    </button>
                  </div>
                </form>
              </>
            )}

            {/* TAB-2: EXPANDABLE OMNICHANNEL LIVE CHAT */}
            {activeMiddleTab === 'expandable-chat' && (
              <div className="flex-1 p-3 bg-neutral-950/40 flex flex-col h-full overflow-hidden" id="expandable-omnichannel-tab-panel">
                <ExpandableOmnichannelChat currentUser="Kate Smith" className="flex-1" />
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
            <MessageSquare className="h-12 w-12 text-neutral-700 mb-2 animate-pulse" />
            <span className="text-sm font-semibold text-neutral-400">Select a lead to start conversation</span>
            <p className="text-xs text-neutral-500 mt-1 max-w-sm">Use the left sidebar inbox filter to review channels and resolve pending requests.</p>
          </div>
        )}
      </div>

      {/* 3. Right panel: Lead Details & AI Copilot */}
      <div className="md:col-span-12 lg:col-span-3 rounded-xl border border-white/5 bg-neutral-900/20 p-4 h-full overflow-y-auto backdrop-blur-md space-y-4" id="crm-profile-workspace">
        {activeContact && (
          <>
            {/* Header Tabs */}
            <div className="flex bg-neutral-950 p-1 rounded-xl border border-white/5 mb-2 select-none shrink-0">
              <button
                type="button"
                onClick={() => setActiveRightTab('profile')}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all text-center cursor-pointer ${
                  activeRightTab === 'profile'
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/25'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Lead Profile
              </button>
              
              <button
                type="button"
                disabled={!selectedEmailMessage}
                onClick={() => setActiveRightTab('email-preview')}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all text-center cursor-pointer ${
                  !selectedEmailMessage ? 'opacity-40 cursor-not-allowed' : ''
                } ${
                  activeRightTab === 'email-preview'
                    ? 'bg-orange-500/15 text-orange-400 border border-orange-500/25'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Email Preview
              </button>
            </div>

            {activeRightTab === 'profile' ? (
              <div className="space-y-4">
                <div>
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-2">Lead details</span>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-neutral-500 font-medium">Company</span>
                  <span className="text-white font-semibold font-sans">{activeContact.company}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-neutral-500 font-medium">E-mail</span>
                  <a href={`mailto:${activeContact.email}`} className="text-blue-400 hover:underline font-semibold flex items-center gap-1 truncate max-w-[150px]">
                    {activeContact.email}
                  </a>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-neutral-500 font-medium">Phone Number</span>
                  <span className="text-white font-mono font-semibold">{activeContact.phone}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-neutral-500 font-medium">Current Status</span>
                  <span className={`capitalize font-bold px-1.5 py-0.5 rounded text-[10px] ${
                    activeContact.status === 'active' ? 'bg-sky-500/10 text-sky-400' :
                    activeContact.status === 'pending' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-emerald-500/10 text-emerald-400'
                  }`}>
                    {activeContact.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Interactive Lead Stage selection */}
            <div>
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-2">Lead Stage</span>
              <select 
                id="lead-stage-selector"
                value={leadStage[activeContact.id] || 'Lead'}
                onChange={(e) => setLeadStage({ ...leadStage, [activeContact.id]: e.target.value })}
                className="w-full text-xs font-bold bg-neutral-950/80 border border-white/5 rounded-lg p-2 text-white outline-none focus:border-blue-500/30 cursor-pointer"
              >
                <option value="Lead">Lead Acquisition</option>
                <option value="Contacted">Contacted / Pitch</option>
                <option value="Demo Scheduled">Demo Scheduled</option>
                <option value="Proposal Sent">Proposal Sent</option>
                <option value="Negotiation">Final Negotiation</option>
                <option value="Won">Deal Awarded (Won)</option>
                <option value="Lost">Deal Lost</option>
              </select>
            </div>

            {/* Notes Notepad */}
            <div>
              <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">CRM Account Notes</span>
              <textarea 
                id="contact-notes-input"
                rows={3}
                placeholder="Type real-time deal points, customer pain points, SLA adjustments..."
                value={notes[activeContact.id] || ''}
                onChange={(e) => setNotes({ ...notes, [activeContact.id]: e.target.value })}
                className="w-full text-xs font-medium bg-neutral-950/50 border border-white/5 rounded-lg p-2.5 text-neutral-300 placeholder-neutral-600 outline-none focus:border-blue-500/20"
              />
            </div>

            {/* 🤖 VIRTUAL INTAKE ASSISTANT CONSOLE CARD */}
            <div className="rounded-xl border border-amber-500/15 bg-[#17130E]/60 p-3.5 space-y-3 relative overflow-hidden shadow-lg shadow-amber-950/5">
              <div className="absolute top-0 right-0 h-24 w-24 bg-amber-500/5 blur-xl"></div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                  <Zap className="h-4.5 w-4.5 animate-pulse text-amber-400" />
                  <span>AI Intake Assistant (Alex)</span>
                </div>
                {aiAutoResponder[activeContact.id] ? (
                  <span className="flex items-center gap-1 text-[9px] font-extrabold text-amber-400 uppercase tracking-wider bg-amber-500/10 px-2 py-0.5 rounded-full animate-pulse border border-amber-500/25">
                    <span className="h-1 w-1 bg-amber-400 rounded-full"></span>
                    Live
                  </span>
                ) : (
                  <span className="text-[9px] font-extrabold text-neutral-400 uppercase tracking-wider bg-neutral-800 px-2 py-0.5 rounded-full border border-white/5">
                    Manual
                  </span>
                )}
              </div>

              <p className="text-[11px] text-neutral-400 leading-normal">
                Qualifies lead challenge and monthly budget thresholds through multi-channel auto-replies.
              </p>

              <div className="bg-neutral-950/60 rounded-lg p-2.5 border border-white/5 space-y-2 text-[10px]">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-neutral-500 font-medium">Business Challenge:</span>
                  {qualificationState[activeContact.id]?.challenge ? (
                    <span className="text-emerald-400 font-semibold truncate max-w-[130px] text-right" title={qualificationState[activeContact.id].challenge}>
                      ✓ {qualificationState[activeContact.id].challenge}
                    </span>
                  ) : (
                    <span className="text-neutral-600 font-medium italic">Awaiting response...</span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 font-medium">Monthly Budget:</span>
                  {qualificationState[activeContact.id]?.budget ? (
                    <span className={`font-semibold ${qualificationState[activeContact.id].budget === 'Under $1k' ? 'text-rose-400' : 'text-emerald-400'}`}>
                      ✓ {qualificationState[activeContact.id].budget}
                    </span>
                  ) : (
                    <span className="text-neutral-600 font-medium italic">Awaiting response...</span>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-white/5 pt-2 mt-1">
                  <span className="text-neutral-400 font-medium font-sans">Booking status:</span>
                  {qualificationState[activeContact.id]?.appointmentScheduled ? (
                    <span className="text-emerald-400 font-extrabold flex items-center gap-0.5">
                      <Check className="h-3 w-3" /> Scheduled
                    </span>
                  ) : qualificationState[activeContact.id]?.budget === 'Under $1k' ? (
                    <span className="text-rose-400 font-bold">Disqualified</span>
                  ) : (
                    <span className="text-neutral-500">Unbooked</span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-neutral-400 font-medium font-sans">Specialist Handoff:</span>
                  {qualificationState[activeContact.id]?.transferredToHuman ? (
                    <span className="text-amber-400 font-bold">⚠️ Handed Over</span>
                  ) : (
                    <span className="text-neutral-500">Auto-Managed</span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setQualificationState(prev => ({
                      ...prev,
                      [activeContact.id]: {
                        challenge: null,
                        budget: null,
                        appointmentScheduled: false,
                        transferredToHuman: false
                      }
                    }));
                    alert(`Intake bot qualification state reset successfully for ${activeContact.name}!`);
                  }}
                  className="flex-1 py-1.5 px-2 rounded bg-neutral-900 hover:bg-neutral-800 border border-white/5 text-[9px] font-extrabold text-neutral-300 transition-all select-none cursor-pointer"
                >
                  Reset Bot State
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAiAutoResponder(prev => ({
                      ...prev,
                      [activeContact.id]: !prev[activeContact.id]
                    }));
                  }}
                  className={`flex-1 py-1.5 px-2 rounded text-[9px] font-extrabold text-white transition-all select-none cursor-pointer border ${
                    aiAutoResponder[activeContact.id] 
                      ? 'bg-amber-600/20 border-amber-500/30 text-amber-300 hover:bg-amber-600/35' 
                      : 'bg-indigo-600 border-indigo-500/20 hover:bg-indigo-500'
                  }`}
                >
                  {aiAutoResponder[activeContact.id] ? 'Deactivate Bot' : 'Activate Bot'}
                </button>
              </div>
            </div>

            {/* AI Copilot Spark summary */}
            <div className="rounded-xl border border-indigo-500/10 bg-indigo-950/10 p-3.5 space-y-3 relative overflow-hidden">
              <div className="absolute top-0 right-0 h-24 w-24 bg-indigo-500/5 blur-xl"></div>
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-400">
                <Sparkles className="h-4.5 w-4.5 animate-pulse" />
                <span>Obsidian Copilot Core</span>
              </div>
              <p className="text-[11px] text-neutral-400 leading-normal">
                Synthesize messaging logs across standard platforms to draft next steps.
              </p>

              {activeCopilot ? (
                <div id="ai-copilot-response-container" className="rounded-lg bg-black/40 border border-white/5 p-2.5 text-[11px] text-neutral-300 space-y-1 max-h-[160px] overflow-y-auto font-sans leading-relaxed">
                  {activeCopilot.split('\n').map((line, idx) => (
                    <p key={idx}>{line}</p>
                  ))}
                </div>
              ) : (
                <button 
                  id="btn-run-ai-copilot"
                  onClick={() => runCopilotSummary(activeContact.id)}
                  className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-1.5 text-xs font-bold text-white transition-all hover:shadow-md hover:shadow-indigo-500/10"
                >
                  Generate Lead Bio
                </button>
              )}
            </div>

            {/* 📚 HIGH-VELOCITY SALES SNIPPETS LIBRARY */}
            <div className="rounded-xl border border-blue-500/10 bg-blue-950/5 p-3.5 space-y-3 relative overflow-hidden">
              <div className="absolute top-0 right-0 h-24 w-24 bg-blue-500/5 blur-xl"></div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-blue-400">
                  <BookOpen className="h-4.5 w-4.5 text-blue-400" />
                  <span>Sales Snippets Library ({userSnippets.length})</span>
                </div>
                <button
                  onClick={() => setIsAddingSnippet(!isAddingSnippet)}
                  className="p-1 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/25 transition-all text-[10px] font-bold flex items-center gap-1 cursor-pointer select-none"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>

              <p className="text-[11px] text-neutral-400 leading-normal">
                Click any snippet to insert at the cursor. Type triggers (e.g. <span className="font-mono text-blue-400 text-[10px]">/intro</span>) directly in composer to auto-expand.
              </p>

              {/* Add Snippet Collapsible Form */}
              {isAddingSnippet && (
                <div className="bg-neutral-950/60 rounded-lg p-3 border border-blue-500/20 space-y-2.5">
                  <div className="text-[10px] text-blue-300 font-extrabold uppercase tracking-wider">New Sales Snippet</div>
                  
                  <div className="space-y-1">
                    <label className="text-[9px] text-neutral-400 font-bold block">Trigger Shortcut (e.g. /myintro)</label>
                    <input
                      type="text"
                      placeholder="/trigger"
                      value={newTrigger}
                      onChange={(e) => setNewTrigger(e.target.value)}
                      className="w-full text-xs font-mono bg-neutral-900 border border-white/5 rounded p-1.5 text-white outline-none focus:border-blue-500/30"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] text-neutral-400 font-bold block">Short Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Custom introductory pitch"
                      value={newDescription}
                      onChange={(e) => setNewDescription(e.target.value)}
                      className="w-full text-xs bg-neutral-900 border border-white/5 rounded p-1.5 text-white outline-none focus:border-blue-500/30"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] text-neutral-400 font-bold block">Expanded Text</label>
                    <textarea
                      rows={3}
                      placeholder="Template text. Use [Name], [Plan] etc for placeholders."
                      value={newText}
                      onChange={(e) => setNewText(e.target.value)}
                      className="w-full text-xs bg-neutral-900 border border-white/5 rounded p-1.5 text-white outline-none focus:border-blue-500/30 resize-none"
                    />
                  </div>

                  {/* Cheatsheet for variables */}
                  <div className="space-y-1">
                    <div className="text-[8px] text-neutral-500 font-bold uppercase tracking-widest">Click to insert placeholder:</div>
                    <div className="flex flex-wrap gap-1">
                      {['[Name]', '[Plan]', '[Price]', '[Discount]', '[Date]', '[Time]', '[MeetingLink]'].map(placeholderToken => (
                        <button
                          key={placeholderToken}
                          type="button"
                          onClick={() => setNewText(prev => prev + placeholderToken)}
                          className="text-[9px] font-mono font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-1 rounded transition-all cursor-pointer"
                        >
                          {placeholderToken}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-1.5 pt-1">
                    <button
                      onClick={() => setIsAddingSnippet(false)}
                      className="flex-1 py-1.5 rounded bg-neutral-900 hover:bg-neutral-800 border border-white/5 text-[10px] font-bold text-neutral-400 transition-all cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addNewSnippet}
                      className="flex-1 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-[10px] font-bold text-white transition-all cursor-pointer shadow-md shadow-blue-500/10"
                    >
                      Save Snippet
                    </button>
                  </div>
                </div>
              )}

              {/* Snippets List Search & Output */}
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-neutral-500" />
                  <input
                    type="text"
                    placeholder="Search triggers or content..."
                    value={snippetSearchQuery}
                    onChange={(e) => setSnippetSearchQuery(e.target.value)}
                    className="w-full text-[11px] bg-neutral-950/60 border border-white/5 rounded-lg p-2 pl-8 text-white placeholder-neutral-600 outline-none focus:border-blue-500/20 transition-all"
                  />
                </div>

                <div className="max-h-60 overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
                  {userSnippets
                    .filter(s => 
                      s.trigger.toLowerCase().includes(snippetSearchQuery.toLowerCase()) || 
                      s.text.toLowerCase().includes(snippetSearchQuery.toLowerCase()) ||
                      s.description?.toLowerCase().includes(snippetSearchQuery.toLowerCase())
                    )
                    .map((snippet) => (
                      <div
                        key={snippet.trigger}
                        className="group relative flex flex-col items-start p-2 rounded-lg bg-neutral-950/40 border border-white/5 hover:border-blue-500/30 transition-all duration-200 cursor-pointer text-left"
                        onClick={() => insertSnippetFromSidebar(snippet)}
                        title="Click to insert at cursor"
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs font-mono font-bold text-blue-400 flex items-center gap-1">
                            <Terminal className="h-3 w-3" />
                            {snippet.trigger}
                          </span>
                          <div className="flex items-center gap-1">
                            {snippet.description && (
                              <span className="text-[9px] text-neutral-500 font-medium bg-neutral-900 px-1 py-0.5 rounded">
                                {snippet.description}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteSnippet(snippet.trigger);
                              }}
                              className="p-1 rounded text-neutral-600 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
                              title="Delete Snippet"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-[10px] text-neutral-400 line-clamp-2 mt-1 italic font-sans">
                          {snippet.text}
                        </p>
                      </div>
                    ))}

                  {userSnippets.filter(s => 
                    s.trigger.toLowerCase().includes(snippetSearchQuery.toLowerCase()) || 
                    s.text.toLowerCase().includes(snippetSearchQuery.toLowerCase()) ||
                    s.description?.toLowerCase().includes(snippetSearchQuery.toLowerCase())
                  ).length === 0 && (
                    <div className="text-center py-4 text-xs text-neutral-600 italic">
                      No matching snippets found
                    </div>
                  )}
                </div>
              </div>
            </div>
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-orange-400 font-mono uppercase tracking-wider">
                    <Mail className="h-4.5 w-4.5 text-orange-400 animate-pulse" />
                    <span>Selected Email Details</span>
                  </div>
                  <button 
                    type="button"
                    onClick={() => {
                      setSelectedEmailMessage(null);
                      setActiveRightTab('profile');
                    }}
                    className="h-6 w-6 rounded-md bg-neutral-800/50 hover:bg-neutral-800 text-neutral-400 hover:text-white text-xs font-bold transition-all cursor-pointer flex items-center justify-center border border-white/5"
                  >
                    ✕
                  </button>
                </div>

                <div className="bg-neutral-950/60 p-3.5 rounded-xl border border-white/5 space-y-3">
                  <div>
                    <span className="text-[9px] text-neutral-500 font-black block uppercase font-mono tracking-widest mb-1">Subject</span>
                    <h4 className="text-xs font-bold text-neutral-100 font-sans leading-snug">
                      {selectedEmailMessage?.subject || "CRM Action Plan & Pipeline Audit"}
                    </h4>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] border-t border-b border-white/5 py-2">
                    <div className="min-w-0">
                      <span className="text-neutral-500 block uppercase font-mono font-bold tracking-widest mb-0.5">Sender</span>
                      <span className="text-neutral-300 font-semibold truncate block">
                        {selectedEmailMessage?.sender === 'user' ? 'gateway@obsidian.crm' : activeContact.email}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-neutral-500 block uppercase font-mono font-bold tracking-widest mb-0.5">Recipient</span>
                      <span className="text-neutral-300 font-semibold truncate block">
                        {selectedEmailMessage?.sender === 'user' ? activeContact.email : 'gateway@obsidian.crm'}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-[10px]">
                    <div>
                      <span className="text-neutral-500 block uppercase font-mono font-bold tracking-widest mb-0.5">Date & Time</span>
                      <span className="text-neutral-400 font-mono font-semibold">{selectedEmailMessage?.timestamp}</span>
                    </div>
                    <div>
                      <span className="px-2 py-0.5 text-[8.5px] font-black uppercase text-orange-400 bg-orange-500/10 border border-orange-500/15 rounded font-mono">
                        SMTP Mail
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block font-mono">Email Body Content</span>
                  <div className="w-full text-xs font-medium bg-neutral-950/40 border border-white/5 rounded-xl p-3.5 text-neutral-300 whitespace-pre-wrap leading-relaxed max-h-[280px] overflow-y-auto font-sans">
                    {selectedEmailMessage?.text}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    id="btn-reply-selected-email"
                    type="button"
                    onClick={() => selectedEmailMessage && handleReplyEmail(selectedEmailMessage)}
                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-blue-900/20"
                    title="Reply to selected email message"
                  >
                    <CornerUpLeft className="h-3.5 w-3.5 text-white" />
                    <span>Reply Email</span>
                  </button>
                  <button
                    id="btn-forward-selected-email"
                    type="button"
                    onClick={() => selectedEmailMessage && handleForwardEmail(selectedEmailMessage)}
                    className="flex-1 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    title="Forward selected email message"
                  >
                    <CornerUpRight className="h-3.5 w-3.5 text-amber-400" />
                    <span>Forward Email</span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* 4. Scheduling Dialog Popup Overlay Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 bg-neutral-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in" id="scheduler-modal-dialog">
          <div className="obsidian bg-[var(--obsidian-2)] border border-white/10 rounded-2xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col h-[90vh] max-h-[720px] animate-scale-up" onClick={(e) => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-white/5 bg-slate-900/80 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Calendar className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-[9px] font-extrabold text-indigo-400 font-mono uppercase tracking-widest bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/10">
                    Obsidian Core Hub
                  </span>
                  <h3 className="text-sm font-black text-white leading-tight">
                    Social Campaign Planner
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowScheduleModal(false);
                  setUploadedMediaList([]);
                }}
                className="h-8 w-8 rounded-lg bg-neutral-800/60 hover:bg-neutral-800 text-neutral-400 hover:text-white text-xs font-bold transition-all cursor-pointer flex items-center justify-center border border-white/5"
              >
                ✕
              </button>
            </div>

            {/* Split Content Pane Workspace */}
            <div className="flex flex-1 overflow-hidden min-h-0">
              
              {/* LEFT COLUMN: THE EDITING PROCESS FORM */}
              <div className="w-1/2 p-5 overflow-y-auto border-r border-white/5 space-y-4 text-xs flex flex-col justify-between">
                <div className="space-y-4">
                  
                  {/* Field 1: Target Platform Picker */}
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5 font-mono">
                      Target Platforms <span className="text-red-400">*</span>
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {([
                        { id: 'linkedin', label: 'LinkedIn', icon: <Linkedin className="h-4 w-4" />, col: 'text-sky-450 border-sky-400/20 bg-sky-500/5 hover:bg-sky-500/10' },
                        { id: 'twitter', label: 'X (Twitter)', icon: <Twitter className="h-4 w-4" />, col: 'text-white border-neutral-700 bg-neutral-800/40 hover:bg-neutral-850' },
                        { id: 'instagram', label: 'Instagram', icon: <Instagram className="h-4 w-4" />, col: 'text-pink-400 border-pink-500/20 bg-pink-500/5 hover:bg-pink-500/10' },
                        { id: 'tiktok', label: 'TikTok', icon: <Video className="h-4 w-4" />, col: 'text-teal-400 border-teal-500/20 bg-teal-500/5 hover:bg-teal-500/10' }
                      ]).map(plat => {
                        const isSelected = newPostPlatforms.includes(plat.id);
                        return (
                          <button
                            key={plat.id}
                            type="button"
                            onClick={() => {
                              if (isSelected) {
                                setNewPostPlatforms(prev => prev.filter(x => x !== plat.id));
                              } else {
                                setNewPostPlatforms(prev => [...prev, plat.id]);
                              }
                            }}
                            className={`flex flex-col items-center justify-center gap-1.5 py-2.5 px-1.5 rounded-lg border transition-all duration-150 cursor-pointer ${
                              isSelected 
                                ? `${plat.col} ring-1 ring-white/10 font-bold scale-[1.02] shadow-sm` 
                                : 'bg-neutral-950/60 text-neutral-500 border-white/5 hover:border-white/10 hover:text-neutral-400'
                            }`}
                          >
                            {plat.icon}
                            <span className="text-[10px] font-semibold">{plat.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Field 2: Caption Content Textarea with Micro-Helpers */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest font-mono">
                        Post Caption
                      </label>
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        newPostCaption.length > (previewPlatform === 'twitter' ? 280 : 2200)
                          ? 'bg-red-500/15 text-red-400 border border-red-500/20'
                          : 'text-neutral-400'
                      }`}>
                        {newPostCaption.length} / {previewPlatform === 'twitter' ? 280 : (previewPlatform === 'linkedin' ? 3000 : 2200)}
                      </span>
                    </div>

                    <div className="relative group/caption border border-white/5 bg-neutral-950/50 rounded-xl focus-within:border-indigo-500/30 overflow-hidden transition-all duration-200">
                      <textarea
                        required
                        rows={4}
                        value={newPostCaption}
                        onChange={(e) => setNewPostCaption(e.target.value)}
                        placeholder="What would you like to share with the network? Add hashtags (#CrmSecure, #ObsidianHub) or tagging metrics..."
                        className="w-full text-xs font-semibold bg-transparent p-3 text-neutral-200 placeholder-neutral-600 outline-none resize-none min-h-[90px]"
                      />
                      
                      {/* Emoji Quick Picker Ribbon Row */}
                      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/80 border-t border-white/5 shrink-0 select-none">
                        <div className="flex items-center gap-1">
                          {['🚀', '✨', '🔥', '📈', '💡', '🛡️', '🤝', '🤖'].map(emoji => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => setNewPostCaption(prev => prev + emoji)}
                              className="h-6 w-6 rounded hover:bg-neutral-800 text-[13px] flex items-center justify-center transition-all duration-100 cursor-pointer active:scale-90"
                              title="Insert instant marketing emoji"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const premiumEmojis = ['🎉', '📝', '🎯', '🙌', '🌟', '💻', '📈', '⚡', '📊'];
                            const randomEmoji = premiumEmojis[Math.floor(Math.random() * premiumEmojis.length)];
                            setNewPostCaption(prev => prev + ' ' + randomEmoji);
                          }}
                          className="text-[9px] font-mono font-black text-indigo-400 hover:text-indigo-300 flex items-center gap-1 px-1.5 py-0.5 bg-indigo-500/5 hover:bg-indigo-500/10 border border-indigo-500/10 rounded cursor-pointer"
                        >
                          <Smile className="h-3 w-3" />
                          <span>Add Random</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Field 3: Image / Video Media Zone Support Drag and Drop */}
                  <div>
                    <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5 font-mono">
                      Media Attachments ({uploadedMediaList.length} Selected)
                    </label>
                    
                    <div 
                      className="border-2 border-dashed border-white/5 hover:border-indigo-500/25 bg-neutral-950/40 rounded-xl p-4 transition-all duration-150 text-center relative group"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.add('border-indigo-500/40', 'bg-indigo-500/5');
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove('border-indigo-500/40', 'bg-indigo-500/5');
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove('border-indigo-500/40', 'bg-indigo-500/5');
                        const files = Array.from(e.dataTransfer.files) as File[];
                        const imageFiles = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
                        if (imageFiles.length > 0) {
                          const urls = imageFiles.map(f => URL.createObjectURL(f));
                          setUploadedMediaList(prev => [...prev, ...urls]);
                        }
                      }}
                    >
                      <input
                        type="file"
                        multiple
                        accept="image/*,video/*"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        onChange={(e) => {
                          const files = e.target.files ? Array.from(e.target.files) as File[] : [];
                          if (files.length > 0) {
                            const urls = files.map(f => URL.createObjectURL(f));
                            setUploadedMediaList(prev => [...prev, ...urls]);
                          }
                        }}
                      />
                      <div className="flex flex-col items-center justify-center space-y-1.5">
                        <div className="h-8 w-8 rounded-full bg-neutral-900 flex items-center justify-center text-neutral-400 group-hover:text-indigo-400 group-hover:bg-indigo-500/5 transition-all">
                          <Paperclip className="h-4 w-4" />
                        </div>
                        <div className="text-[10px] font-bold text-neutral-300">
                          Drag & drop assets here or <span className="text-indigo-405 group-hover:underline">browse</span>
                        </div>
                        <div className="text-[8px] text-neutral-500">Supports PNG, JPG, GIF, MP4 (Max 10MB)</div>
                      </div>
                    </div>

                    {/* Pre-designed Obsidian Unsplash Library triggers */}
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="text-[8px] font-black uppercase text-neutral-500 tracking-wider font-mono">Use Preset Library:</span>
                      <div className="flex gap-1.5">
                        {([
                          { key: 'dashboard', label: 'FinTech', url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=350' },
                          { key: 'collaboration', label: 'Security', url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=350' },
                          { key: 'cloud', label: 'Infrastructure', url: 'https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&q=80&w=350' }
                        ]).map(preset => (
                          <button
                            key={preset.key}
                            type="button"
                            onClick={() => {
                              if (!uploadedMediaList.includes(preset.url)) {
                                setUploadedMediaList(prev => [...prev, preset.url]);
                              }
                            }}
                            className="obsidian px-2 py-0.5 rounded text-[8px] font-mono font-bold bg-[var(--obsidian-1)] hover:bg-neutral-800 text-neutral-400 hover:text-white border border-white/5 cursor-pointer active:scale-95"
                          >
                            + {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Horizontal media list thumbnail previews with Hover-Delete Layer */}
                    {uploadedMediaList.length > 0 && (
                      <div className="mt-3 grid grid-cols-5 gap-2 bg-neutral-950/20 p-2 border border-white/5 rounded-xl">
                        {uploadedMediaList.map((url, index) => (
                          <div key={index} className="relative aspect-square group/thumb rounded-lg overflow-hidden border border-white/10 bg-neutral-950">
                            <img 
                              src={url} 
                              alt={`Custom Uploaded attachment ${index + 1}`} 
                              className="w-full h-full object-cover rounded-lg"
                              referrerPolicy="no-referrer"
                            />
                            
                            {/* Hover overlay and delete button */}
                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity duration-150">
                              <button
                                type="button"
                                onClick={() => {
                                  setUploadedMediaList(prev => prev.filter((_, i) => i !== index));
                                }}
                                className="h-6 w-6 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center border border-red-500/20 transition-all cursor-pointer scale-90 group-hover/thumb:scale-100 duration-150"
                                title="Remove Image"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                            
                            {/* Attachment number pill indicator */}
                            <span className="absolute bottom-1 right-1 px-1 bg-black/70 text-[7px] text-white font-mono font-bold rounded">
                              #{index + 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Field 4: Time scheduler selectors */}
                  <div className="bg-slate-900/60 border border-white/5 rounded-xl p-3.5 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5 font-mono">Launch Date</label>
                        <div className="relative">
                          <input
                            type="date"
                            value={scheduleTargetDate}
                            onChange={(e) => setScheduleTargetDate(e.target.value)}
                            className="w-full rounded bg-neutral-950 border border-white/5 p-2 font-mono font-bold text-neutral-200 outline-none focus:border-indigo-500/30"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-neutral-400 uppercase tracking-widest mb-1.5 font-mono">Launch Window</label>
                        <select
                          value={newPostTime}
                          onChange={(e) => setNewPostTime(e.target.value)}
                          className="w-full rounded bg-neutral-950 border border-white/5 p-2 font-mono font-bold text-neutral-200 outline-none focus:border-indigo-500/30 cursor-pointer"
                        >
                          <option value="09:00 AM">09:00 AM (APAC Peak)</option>
                          <option value="10:00 AM">10:00 AM (European Peak)</option>
                          <option value="11:00 AM">11:00 AM (Morning Core)</option>
                          <option value="01:30 PM">01:30 PM (Mid-day Lull)</option>
                          <option value="06:00 PM">06:00 PM (US After Hours)</option>
                        </select>
                      </div>
                    </div>

                    {/* Optimize Time Helper Chip with Sparkles */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-neutral-400 flex items-center gap-1 font-semibold leading-none">
                        <Clock className="h-3.5 w-3.5 text-neutral-505" />
                        <span>Need better engagement?</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          // Change sched to next day Tuesday (peak) at 10:00 AM
                          setScheduleTargetDate('2026-06-16');
                          setNewPostTime('10:00 AM');
                        }}
                        className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 hover:border-amber-400/30 rounded-full font-bold text-[9px] tracking-wide transition-all uppercase font-mono cursor-pointer active:scale-95 shadow-sm"
                      >
                        <Zap className="h-3 w-3 text-amber-400 shrink-0" />
                        <span>⚡ Optimize Time</span>
                      </button>
                    </div>

                    {scheduleTargetDate === '2026-06-16' && newPostTime === '10:00 AM' && (
                      <div className="text-[9px] text-emerald-400 font-bold bg-emerald-500/5 border border-emerald-500/10 px-2.5 py-1 rounded-lg animate-pulse flex items-center gap-1.5 font-mono">
                        <Check className="h-3 w-3 text-emerald-400 leading-none shrink-0" />
                        <span>Optimal Launch Active: Optimized for European Core Business Hours!</span>
                      </div>
                    )}
                  </div>

                </div>

                {/* Submits & Action Footer area inside left pane */}
                <div className="pt-3 border-t border-white/5 flex items-center justify-end gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      // Save Draft: resets and saves in queue as local DRAFT indicators
                      if (!newPostCaption.trim()) return;
                      const id = `sp-draft-${Date.now()}`;
                      const newItem: SocialScheduledPost = {
                        id,
                        caption: `[DRAFT] ${newPostCaption}`,
                        platforms: newPostPlatforms,
                        scheduledAt: scheduleTargetDate,
                        scheduledTime: newPostTime,
                        status: 'FAILED', // Using Failed to signify inactive/grey style draft layout or highlight differently
                        mediaUrl: uploadedMediaList[0] || undefined
                      };
                      setSocialPosts(prev => [...prev, newItem]);
                      setNewPostCaption('');
                      setUploadedMediaList([]);
                      setShowScheduleModal(false);
                    }}
                    disabled={!newPostCaption.trim()}
                    className="rounded-lg border border-white/5 bg-neutral-900 hover:bg-neutral-800 px-3.5 py-2 text-xs font-bold text-neutral-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
                  >
                    Save Draft
                  </button>
                  <button
                    type="button"
                    disabled={isSchedulingLoading || !newPostCaption.trim() || newPostPlatforms.length === 0}
                    onClick={async () => {
                      if (!newPostCaption.trim()) return;

                      setIsSchedulingLoading(true);
                      // Schedules through the Social Planner API (Postiz). If it fails, say so: nothing is added locally.
                      const res = await fetch('/api/posts', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          content: newPostCaption.trim(), mode: 'schedule',
                          platforms: newPostPlatforms.map(p => String(p).toLowerCase()),
                          scheduledAt: `${scheduleTargetDate}T${newPostTime === '10:00 AM' ? '10:00:00' : '13:30:00'}Z`,
                        }),
                      }).catch(() => null);
                      if (!res || !res.ok) {
                        const j = res ? await res.json().catch(() => ({})) : {};
                        setIsSchedulingLoading(false);
                        alert(j.error || 'The post couldn’t be scheduled. Check Social Planner → Accounts.');
                        return;
                      }

                      const id = `sp-custom-${Date.now()}`;
                      const newItem: SocialScheduledPost = {
                        id,
                        caption: newPostCaption,
                        platforms: newPostPlatforms,
                        scheduledAt: scheduleTargetDate,
                        scheduledTime: newPostTime,
                        status: 'SCHEDULED',
                        mediaUrl: uploadedMediaList[0] || undefined
                      };

                      setSocialPosts(prev => [...prev, newItem]);
                      setNewPostCaption('');
                      setUploadedMediaList([]);
                      setShowScheduleModal(false);
                      setIsSchedulingLoading(false);
                    }}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-2 text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-indigo-600/10 disabled:opacity-50 font-sans"
                  >
                    {isSchedulingLoading ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Scheduling...</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5 animate-bounce" />
                        <span>Schedule Post</span>
                      </>
                    )}
                  </button>
                </div>

              </div>

              {/* RIGHT COLUMN: THE INTERACTIVE LIVE PREVIEW PANEL */}
              <div className="obsidian w-1/2 p-5 bg-[var(--obsidian-0)] overflow-y-auto flex flex-col h-full">
                
                {/* Segmented Platform Toggle Tab */}
                <div className="shrink-0 space-y-3">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest font-mono">Live Mockup Render</span>
                    
                    {!newPostPlatforms.includes(previewPlatform) && (
                      <span className="text-[8px] font-bold font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/10 animate-fade-in">
                        Inactive destination node
                      </span>
                    )}
                  </div>
                  
                  <div className="flex bg-neutral-950 p-1 rounded-xl border border-white/5 select-none gap-0.5">
                    {([
                      { id: 'instagram', label: 'Instagram' },
                      { id: 'linkedin', label: 'LinkedIn' },
                      { id: 'twitter', label: 'X (Twitter)' },
                      { id: 'tiktok', label: 'TikTok' }
                    ]).map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setPreviewPlatform(tab.id)}
                        className={`flex-1 text-center py-1.5 rounded-lg text-xs font-bold transition-all duration-150 cursor-pointer ${
                          previewPlatform === tab.id 
                            ? 'bg-[var(--obsidian-2)] text-white shadow-md border hover:border-white/5 border-white/10 opacity-100' 
                            : 'text-neutral-550 hover:text-neutral-300 hover:bg-neutral-900/30'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Simulated Content Stage Area */}
                <div className="flex-1 overflow-y-auto mt-5 flex items-center justify-center min-h-[300px]">
                  
                  {/* INSTAGRAM LIVE CAROUSEL CARD */}
                  {previewPlatform === 'instagram' && (
                    <div className="w-full max-w-[340px] bg-neutral-950 rounded-xl border border-white/10 overflow-hidden shadow-2xl text-left select-none animate-fade-in">
                      {/* IG Post Header */}
                      <div className="p-3 flex items-center justify-between border-b border-white/5 bg-[#0b0d12]/30">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-full p-[1.5px] bg-gradient-to-tr from-yellow-500 via-pink-500 to-purple-600 flex items-center justify-center">
                            <div className="h-full w-full rounded-full bg-neutral-950 p-[1.5px] flex items-center justify-center">
                              <img 
                                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150" 
                                className="h-full w-full rounded-full object-cover" 
                                alt="User avatar sample"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center gap-1 leading-tight">
                              <span className="text-[11px] font-bold text-white tracking-tight">obsidian.secure</span>
                              <span className="h-3 w-3 rounded-full bg-indigo-500 flex items-center justify-center text-white scale-[0.8] tracking-widest text-[5px]">✓</span>
                            </div>
                            <span className="text-[9px] text-neutral-500 leading-none block font-semibold">Silicon Valley, California</span>
                          </div>
                        </div>
                        <span className="text-neutral-400 font-black tracking-widest text-[16px] pr-1 cursor-pointer">•••</span>
                      </div>

                      {/* Carousel Body */}
                      <div className="obsidian relative aspect-square bg-[var(--obsidian-0)] flex items-center justify-center">
                        {uploadedMediaList.length > 0 ? (
                          <div className="w-full h-full relative group">
                            <img 
                              src={uploadedMediaList[0]} 
                              className="w-full h-full object-cover" 
                              alt="Active slider visualization node"
                              referrerPolicy="no-referrer"
                            />
                            
                            {/* Multitrack slider bar dot overlay count checks */}
                            {uploadedMediaList.length > 1 && (
                              <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1 select-none">
                                {uploadedMediaList.map((_, dotIdx) => (
                                  <span 
                                    key={dotIdx} 
                                    className={`h-1.5 w-1.5 rounded-full transition-all duration-150 ${
                                      dotIdx === 0 ? 'bg-indigo-400 w-3' : 'bg-neutral-500/75'
                                    }`} 
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-center p-6 space-y-2">
                            <Instagram className="h-8 w-8 text-neutral-700 mx-auto" />
                            <span className="text-[9px] font-semibold text-neutral-500 block">No media attachment uploaded. Instagram prioritizes rich visual assets.</span>
                          </div>
                        )}
                      </div>

                      {/* Action Toolbars */}
                      <div className="p-3 space-y-2 text-xs bg-[#090b10]/40">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 text-neutral-300">
                            <Heart className="h-4.5 w-4.5 hover:text-red-500 hover:scale-115 transition-all cursor-pointer" />
                            <MessageCircle className="h-4.5 w-4.5 hover:text-white hover:scale-115 transition-all cursor-pointer" />
                            <Share2 className="h-4.5 w-4.5 hover:text-white hover:scale-115 transition-all cursor-pointer" />
                          </div>
                          <Bookmark className="h-4.5 w-4.5 text-neutral-300 hover:text-white transition-all cursor-pointer" />
                        </div>

                        {/* Likes row count */}
                        <div className="text-[10px] font-mono font-bold text-neutral-200">
                          Liked by <span className="hover:underline cursor-pointer font-sans">tech_lead_99</span> and 2,941 others
                        </div>

                        {/* Description markup */}
                        <div className="text-[11px] leading-relaxed break-words font-sans">
                          <span className="font-bold text-white mr-1.5">obsidian.secure</span>
                          <span className="text-neutral-300 whitespace-pre-wrap">
                            {newPostCaption ? (
                              newPostCaption.split(/\s+/).map((word, wordIdx) => {
                                if (word.startsWith('#') || word.startsWith('@')) {
                                  return <span key={wordIdx} className="text-blue-400 hover:underline cursor-pointer font-semibold mr-1">{word}</span>;
                                }
                                return `${word} `;
                              })
                            ) : (
                              <span className="text-neutral-600 italic">Caption is empty. Type in the box to update live preview...</span>
                            )}
                          </span>
                        </div>

                        <div className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest font-mono">
                          Just Now • Original Audio
                        </div>
                      </div>
                    </div>
                  )}

                  {/* LINKEDIN MOCK CARD PREVIEW */}
                  {previewPlatform === 'linkedin' && (
                    <div className="w-full bg-slate-900/90 rounded-xl border border-white/10 overflow-hidden shadow-2xl text-left select-none animate-fade-in font-sans p-4 space-y-3.5">
                      {/* Premium Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex gap-2.5">
                          <img 
                            src="https://images.unsplash.com/photo-1549813573-4c4109308645?auto=format&fit=crop&q=80&w=150" 
                            className="h-10 w-10 rounded-lg object-cover" 
                            alt="LinkedIn Corporate user Logo"
                            referrerPolicy="no-referrer"
                          />
                          <div>
                            <div className="flex items-center gap-1 leading-none">
                              <span className="text-xs font-extrabold text-white hover:underline cursor-pointer">Obsidian Enterprise CRM Systems</span>
                              <span className="text-[9px] font-mono text-neutral-400 bg-neutral-800 px-1 rounded">1st</span>
                            </div>
                            <span className="text-[9.5px] text-neutral-400 leading-tight block mt-0.5 truncate max-w-[200px]">Advanced Autonomous Client Intelligence Infrastructure</span>
                            <span className="text-[9px] text-neutral-500 flex items-center gap-1 mt-0.5 leading-none">
                              <span>Just now</span>
                              <span>•</span>
                              <Globe className="h-2.5 w-2.5 text-neutral-505" />
                            </span>
                          </div>
                        </div>

                        <button type="button" className="text-neutral-400 hover:text-white font-extrabold text-[15px] pr-1 select-none">•••</button>
                      </div>

                      {/* Text Section */}
                      <div className="text-xs leading-relaxed text-neutral-200 whitespace-pre-wrap font-sans break-words px-0.5">
                        {newPostCaption ? (
                          newPostCaption.split(/\s+/).map((word, wordIdx) => {
                            if (word.startsWith('#') || word.startsWith('@')) {
                              return <span key={wordIdx} className="text-sky-400 font-semibold hover:underline cursor-pointer mr-1">{word}</span>;
                            }
                            return `${word} `;
                          })
                        ) : (
                          <span className="text-neutral-600 italic">Caption content is empty. Type in the caption block to preview...</span>
                        )}
                      </div>

                      {/* Media Image Row Block */}
                      {uploadedMediaList.length > 0 && (
                        <div className="rounded-lg overflow-hidden border border-white/5 bg-neutral-950">
                          <img 
                            src={uploadedMediaList[0]} 
                            className="w-full max-h-[190px] object-cover" 
                            alt="LinkedIn visual render node"
                            referrerPolicy="no-referrer"
                          />
                          {uploadedMediaList.length > 1 && (
                            <div className="obsidian bg-[var(--obsidian-2)] px-3 py-1.5 border-t border-white/5 text-[9px] font-mono text-indigo-400 flex justify-between items-center font-bold">
                              <span>+ {uploadedMediaList.length - 1} more media carousel assets</span>
                              <span className="bg-indigo-500/15 px-1.5 py-0.5 rounded text-[8px]">Linked Deck</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* LinkedIn Social Counters */}
                      <div className="flex items-center justify-between border-b border-white/5 pb-2 text-[9px] text-neutral-450 font-mono">
                        <div className="flex items-center gap-1.5 select-none">
                          <span className="flex -space-x-1">
                            <span className="h-3.5 w-3.5 rounded-full bg-blue-600 flex items-center justify-center text-[7px] text-white font-sans ring-1 ring-neutral-900 font-black">👍</span>
                            <span className="h-3.5 w-3.5 rounded-full bg-green-600 flex items-center justify-center text-[7px] text-white font-sans ring-1 ring-neutral-900 font-black">👏</span>
                            <span className="h-3.5 w-3.5 rounded-full bg-yellow-500 flex items-center justify-center text-[7px] text-white font-sans ring-1 ring-neutral-900 font-black">💡</span>
                          </span>
                          <span className="hover:underline cursor-pointer font-sans text-neutral-300 font-bold">1,842 • 4 comments</span>
                        </div>
                        <span className="hover:underline cursor-pointer font-sans text-neutral-300 font-bold">12 shares</span>
                      </div>

                      {/* Interactive Buttons footer */}
                      <div className="flex justify-between items-center pt-1 px-1 text-neutral-400 text-[11px] font-extrabold select-none">
                        <button type="button" className="flex items-center gap-1.5 hover:text-white transition-colors py-1 px-1.5 rounded hover:bg-neutral-800/40 cursor-pointer">
                          <ThumbsUp className="h-4 w-4" />
                          <span>Like</span>
                        </button>
                        <button type="button" className="flex items-center gap-1.5 hover:text-white transition-colors py-1 px-1.5 rounded hover:bg-neutral-800/40 cursor-pointer">
                          <MessageSquare className="h-4 w-4" />
                          <span>Comment</span>
                        </button>
                        <button type="button" className="flex items-center gap-1.5 hover:text-white transition-colors py-1 px-1.5 rounded hover:bg-neutral-800/40 cursor-pointer">
                          <Repeat className="h-4 w-4" />
                          <span>Repost</span>
                        </button>
                        <button type="button" className="flex items-center gap-1.5 hover:text-white transition-colors py-1 px-1.5 rounded hover:bg-neutral-800/40 cursor-pointer">
                          <Send className="h-4 w-4" />
                          <span>Send</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* TWITTER (X) CHIRP CARD PREVIEW */}
                  {previewPlatform === 'twitter' && (
                    <div className="obsidian w-full bg-[var(--obsidian-0)] rounded-xl border border-white/10 overflow-hidden shadow-2xl text-left select-none animate-fade-in p-4 space-y-3.5">
                      <div className="flex items-start gap-2.5">
                        <img 
                          src="https://images.unsplash.com/photo-1531297484001-80022131f5a1?auto=format&fit=crop&q=80&w=150" 
                          className="h-10 w-10 rounded-full object-cover shrink-0" 
                          alt="Twitter Profile"
                          referrerPolicy="no-referrer"
                        />
                        <div className="flex-1 space-y-1 overflow-hidden">
                          {/* Profile row */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 leading-tight truncate">
                              <span className="text-xs font-black text-white hover:underline cursor-pointer truncate">Obsidian Systems Cloud</span>
                              <span className="h-3 w-3 rounded-full bg-sky-400 flex items-center justify-center text-black font-extrabold text-[6px] shrink-0">✓</span>
                              <span className="text-[10px] text-neutral-500 font-mono font-bold shrink-0">@obsidian_tech • Just Now</span>
                            </div>
                            <span className="text-neutral-500 font-extrabold text-xs select-none cursor-pointer">•••</span>
                          </div>

                          {/* Captions */}
                          <div className="text-[11.5px] leading-relaxed text-neutral-200 break-words font-sans">
                            {newPostCaption ? (
                              newPostCaption.split(/\s+/).map((word, wordIdx) => {
                                if (word.startsWith('#') || word.startsWith('@')) {
                                  return <span key={wordIdx} className="text-sky-400 hover:underline cursor-pointer mr-1">{word}</span>;
                                }
                                return `${word} `;
                              })
                            ) : (
                              <span className="text-neutral-750 italic">No Tweet text written. Type above to see render...</span>
                            )}
                          </div>

                          {/* Multi-Media Grid matching actual X layout */}
                          {uploadedMediaList.length > 0 && (
                            <div className={`mt-2.5 rounded-xl overflow-hidden border border-white/5 bg-[var(--obsidian-0)] grid gap-1 ${
                              uploadedMediaList.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                            }`}>
                              {uploadedMediaList.slice(0, 4).map((url, index) => (
                                <img 
                                  key={index} 
                                  src={url} 
                                  className="w-full h-full object-cover aspect-[16/10]" 
                                  alt={`Twitter visual row ${index}`}
                                  referrerPolicy="no-referrer"
                                />
                              ))}
                            </div>
                          )}

                          {/* Twitter engagement strip */}
                          <div className="flex justify-between items-center text-neutral-500 text-[10px] font-mono font-medium pt-3 select-none">
                            <button type="button" className="flex items-center gap-1 hover:text-sky-400 transition-colors cursor-pointer group">
                              <span className="p-1.5 rounded-full group-hover:bg-sky-500/10">
                                <MessageCircle className="h-3.5 w-3.5" />
                              </span>
                              <span>210</span>
                            </button>
                            <button type="button" className="flex items-center gap-1 hover:text-green-500 transition-colors cursor-pointer group">
                              <span className="p-1.5 rounded-full group-hover:bg-green-500/10">
                                <Repeat className="h-3.5 w-3.5" />
                              </span>
                              <span>46</span>
                            </button>
                            <button type="button" className="flex items-center gap-1 hover:text-red-500 transition-colors cursor-pointer group">
                              <span className="p-1.5 rounded-full group-hover:bg-red-500/10">
                                <Heart className="h-3.5 w-3.5" />
                              </span>
                              <span>1.8K</span>
                            </button>
                            <button type="button" className="flex items-center gap-1 hover:text-sky-400 transition-colors cursor-pointer group">
                              <span className="p-1.5 rounded-full group-hover:bg-sky-500/10">
                                <Bookmark className="h-3.5 w-3.5" />
                              </span>
                              <span>294</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TIKTOK MOBILE SPEC SMARTPHONE MOCKUP FRAME */}
                  {previewPlatform === 'tiktok' && (
                    <div className="w-full max-w-[280px] aspect-[9/16] bg-black rounded-[2.2rem] border-[6px] border-neutral-800 shadow-2xl relative overflow-hidden select-none animate-fade-in flex flex-col justify-between">
                      {/* Full-view media element */}
                      {uploadedMediaList.length > 0 ? (
                        <div className="absolute inset-0 z-0">
                          <img 
                            src={uploadedMediaList[0]} 
                            className="w-full h-full object-cover brightness-[0.7] blur-[0.5px]" 
                            alt="TikTok mock background asset"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : (
                        <div className="absolute inset-0 bg-neutral-950 flex flex-col items-center justify-center space-y-2 z-0 p-5">
                          <Video className="h-10 w-10 text-neutral-800" />
                          <span className="text-[9px] font-semibold text-neutral-600 text-center font-sans block lead-tight">Attach an video/image asset to preview full immersive TikTok layout.</span>
                        </div>
                      )}

                      {/* Header overlay search checks */}
                      <div className="relative z-10 px-6 py-4 flex items-center justify-between text-neutral-300 text-[10px] font-bold font-sans">
                        <span className="text-[11px] font-mono">LIVE</span>
                        <div className="flex gap-2 text-white font-bold">
                          <span className="pb-0.5 border-b-2 border-white">Following</span>
                          <span className="text-neutral-450">For You</span>
                        </div>
                        <Search className="h-4 w-4 text-white hover:scale-110 transition-transform cursor-pointer" />
                      </div>

                      {/* Bottom caption description overlay */}
                      <div className="relative z-10 p-4 space-y-2 flex flex-col justify-end h-full">
                        <div className="flex items-end justify-between">
                          
                          {/* Texts Details Left block */}
                          <div className="space-y-1 text-left max-w-[80%] font-sans drop-shadow-md">
                            <div className="text-[11px] font-black text-white hover:underline cursor-pointer flex items-center gap-1">
                              <span>@obsidian_dev</span>
                              <span className="h-2.5 w-2.5 rounded-full bg-teal-400 flex items-center justify-center text-black text-[5px] font-extrabold">✓</span>
                            </div>
                            <div className="text-[10px] text-white leading-relaxed break-words line-clamp-3">
                              {newPostCaption ? (
                                newPostCaption.split(/\s+/).map((word, wordIdx) => {
                                  if (word.startsWith('#') || word.startsWith('@')) {
                                    return <span key={wordIdx} className="text-teal-300 font-bold hover:underline cursor-pointer mr-1">{word}</span>;
                                  }
                                  return `${word} `;
                                })
                              ) : (
                                <span className="text-neutral-450 italic">No Caption overlay written yet...</span>
                              )}
                            </div>
                            
                            {/* Rotating Sound Banner */}
                            <div className="flex items-center gap-1.5 text-[9px] font-black text-emerald-400 font-sans mt-1">
                              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                              <span className="truncate">♫ Original Sound - obsidian_dev</span>
                            </div>
                          </div>

                          {/* Float-Right Sidebar items */}
                          <div className="flex flex-col items-center space-y-3 shrink-0 z-25 text-white mr-1 drop-shadow-lg select-none">
                            {/* Avatar profile lock */}
                            <div className="relative h-8 w-8">
                              <img 
                                src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150" 
                                className="h-full w-full rounded-full border border-neutral-900 object-cover" 
                                alt="TikTok Floating Avatar"
                                referrerPolicy="no-referrer"
                              />
                              <span className="absolute -bottom-1 left-2.5 bg-red-600 rounded-full h-3.5 w-3.5 flex items-center justify-center text-white font-extrabold text-[8px] border border-neutral-950">+</span>
                            </div>

                            {/* Likes */}
                            <div className="text-center cursor-pointer">
                              <div className="h-7 w-7 rounded-full bg-black/40 flex items-center justify-center hover:scale-110 transition-all font-bold">❤️</div>
                              <span className="text-[8px] font-mono leading-none block font-extrabold mt-1">320.4K</span>
                            </div>

                            {/* Comment */}
                            <div className="text-center cursor-pointer">
                              <div className="h-7 w-7 rounded-full bg-black/40 flex items-center justify-center hover:scale-110 transition-all font-bold">💬</div>
                              <span className="text-[8px] font-mono leading-none block font-extrabold mt-1">1,490</span>
                            </div>

                            {/* Bookmark */}
                            <div className="text-center cursor-pointer">
                              <div className="h-7 w-7 rounded-full bg-black/40 flex items-center justify-center hover:scale-110 transition-all font-bold font-sans">★</div>
                              <span className="text-[8px] font-mono leading-none block font-extrabold mt-1">12K</span>
                            </div>

                            {/* Share */}
                            <div className="text-center cursor-pointer">
                              <div className="h-7 w-7 rounded-full bg-black/40 flex items-center justify-center hover:scale-110 transition-all font-bold">➔</div>
                              <span className="text-[8px] font-mono leading-none block font-extrabold mt-1">Share</span>
                            </div>
                          </div>

                        </div>
                      </div>

                    </div>
                  )}

                </div>

              </div>

            </div>

          </div>
        </div>
      )}

      {/* MONGOOSE SMTP DB INTEGRATION UTILITIES MODAL */}
      {showSmtpDevTools && (
        <div className="fixed inset-0 bg-[#050608]/90 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto" id="smtp-mongoose-tools-modal">
          <div className="obsidian bg-[var(--obsidian-0)] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col animate-in fade-in zoom-in-95 duration-200">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-white/5 bg-neutral-950/40 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                  <Database className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <span className="text-[9px] font-extrabold text-orange-400 font-mono uppercase tracking-widest bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/10">
                    SMTP Database Engineer Console
                  </span>
                  <h3 className="text-sm font-extrabold text-neutral-100 mt-1.5 flex items-center gap-2 animate-pulse">
                    Mongoose SMTP Mail Schema & Integration Hub
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSmtpDevTools(false)}
                className="h-8 w-8 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white text-sm font-bold transition-all cursor-pointer flex items-center justify-center border border-white/5"
              >
                ✕
              </button>
            </div>

            {/* Modal Scroll Container */}
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0 text-left">
              
              {/* Left Column: Code Reference & Instructions */}
              <div className="space-y-4 flex flex-col h-full min-h-0">
                <div className="obsidian bg-[var(--obsidian-0)] p-4 rounded-xl border border-white/5 space-y-2">
                  <h4 className="text-xs font-black text-neutral-200 uppercase tracking-wider flex items-center gap-2 font-mono">
                    <Server className="h-3.5 w-3.5 text-blue-400" />
                    DATABASE SYNC REQUIREMENTS
                  </h4>
                  <p className="text-[11px] text-neutral-400 leading-relaxed font-sans">
                    Production-ready Mongoose engine configured to map SMTP streams from <code className="text-orange-400 font-mono bg-orange-500/10 px-1 rounded">smtp-server</code> and <code className="text-orange-400 font-mono bg-orange-500/10 px-1 rounded">mailparser</code> directly into MongoDB documents.
                  </p>
                  <ul className="text-[10px] text-neutral-500 space-y-1 pl-4 list-disc font-sans font-medium">
                    <li>Stores fields extracted asynchronously from mailparser <code className="text-neutral-300 font-mono">simpleParser</code>.</li>
                    <li>Forces <code className="text-neutral-300 font-mono">to</code> and <code className="text-neutral-300 font-mono">from</code> fields matching arrays list of <code className="text-emerald-400 font-mono">&#123; name, address &#125;</code>.</li>
                    <li>Saves native database indices: fast performance <code className="text-neutral-300 font-mono">date: -1</code> sort, and a compound Text Search index on <code className="text-neutral-300 font-mono">subject</code> and <code className="text-neutral-300 font-mono">text</code>.</li>
                  </ul>
                </div>

                {/* Code Block Container */}
                <div className="flex-1 flex flex-col min-h-0 bg-black/50 border border-white/5 rounded-xl overflow-hidden relative">
                  <div className="bg-neutral-950/80 px-4 py-2 border-b border-white/5 flex items-center justify-between shrink-0">
                    <span className="text-[10px] font-bold font-mono text-neutral-400 uppercase tracking-widest flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                      mongoose-smtp-schema.js
                    </span>
                    <button
                      onClick={async () => {
                        await copyToClipboard(`const mongoose = require('mongoose');
const { Schema } = mongoose;
const { simpleParser } = require('mailparser');

// 1. Definition of Mongoose Schema named 'Email' mapped from mailparser
const EmailSchema = new Schema({
  from: [{
    address: { type: String, required: true },
    name: { type: String, default: '' }
  }],
  to: [{
    address: { type: String, required: true },
    name: { type: String, default: '' }
  }],
  subject: { type: String, default: 'No Subject' },
  date: { type: Date, default: Date.now },
  text: { type: String, default: '' },
  html: { type: String, default: '' },
  attachments: [{
    filename: { type: String, default: 'unnamed' },
    contentType: { type: String, default: 'application/octet-stream' },
    contentDisposition: { type: String, default: 'attachment' },
    size: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    contentId: { type: String, default: null }
  }]
}, {
  timestamps: true
});

// 2. Performance Indexes as requested
// Index on date (descending for latest emails retrieval)
EmailSchema.index({ date: -1 });

// Full-text index on subject and text for fast searching
EmailSchema.index({ subject: 'text', text: 'text' });

const Email = mongoose.models.Email || mongoose.model('Email', EmailSchema);

/**
 * 3. Exact drop-in replacement for placeholder: saveEmailToDatabase(meta, body)
 * @param {object} meta - SMTP envelopes/connection metadata (e.g. envelopeFrom, envelopeTo)
 * @param {Readable|string|Buffer} body - Raw email stream/source as received by SMTP node
 */
async function saveEmailToDatabase(meta, body) {
  try {
    // simpleParser parses the raw email body asynchronously
    const parsed = await simpleParser(body);

    // Helper: standardizes mailparser addresses to Mongoose array objects
    const extractAddresses = (field) => {
      if (!field) return [];
      const list = Array.isArray(field) ? field : (field.value || [field]);
      return list
        .map(item => ({
          address: item.address || item.value || '',
          name: item.name || ''
        }))
        .filter(item => item.address);
    };

    const fromArray = extractAddresses(parsed.from);
    const toArray = extractAddresses(parsed.to);

    // Extract attachments cleanly without saving huge binaries directly to documents
    const attachmentsArray = (parsed.attachments || []).map(att => ({
      filename: att.filename || 'unnamed',
      contentType: att.contentType || 'application/octet-stream',
      contentDisposition: att.contentDisposition || 'attachment',
      size: att.size || 0,
      checksum: att.checksum || '',
      contentId: att.cid || null
    }));

    // Instantiate Email model document
    const emailDoc = new Email({
      from: fromArray,
      to: toArray,
      subject: parsed.subject || 'No Subject',
      date: parsed.date || new Date(),
      text: parsed.text || '',
      html: parsed.html || parsed.textAsHtml || '',
      attachments: attachmentsArray
    });

    // Save strictly into MongoDB database safely
    const savedEmail = await emailDoc.save();
    console.log('[SMTP Stream Ingested] Saved successfully with MongoDB Object ID:', savedEmail._id);

    return savedEmail;
  } catch (error) {
    console.error('[SMTP Mongoose DB Sync Error]:', error);
    throw error;
  }
}

module.exports = {
  Email,
  saveEmailToDatabase
};`);
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 2000);
                      }}
                      className="px-2.5 py-1 text-[9px] font-extrabold rounded-md cursor-pointer border border-white/5 bg-neutral-900 text-neutral-350 hover:text-white hover:bg-neutral-850 flex items-center gap-1 transition-all"
                    >
                      {copiedCode ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span>Copied Code</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy Schema & Function</span>
                        </>
                      )}
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 font-mono text-[9px] text-neutral-350 leading-normal scrollbar-thin max-h-[290px] select-text">
                    <pre className="whitespace-pre">
{`const mongoose = require('mongoose');
const { Schema } = mongoose;
const { simpleParser } = require('mailparser');

// 1. Definition of Mongoose Schema named 'Email'
const EmailSchema = new Schema({
  from: [{
    address: { type: String, required: true },
    name: { type: String, default: '' }
  }],
  to: [{
    address: { type: String, required: true },
    name: { type: String, default: '' }
  }],
  subject: { type: String, default: 'No Subject' },
  date: { type: Date, default: Date.now },
  text: { type: String, default: '' },
  html: { type: String, default: '' },
  attachments: [{
    filename: { type: String, default: 'unnamed' },
    contentType: { type: String, default: 'application/octet-stream' },
    contentDisposition: { type: String, default: 'attachment' },
    size: { type: Number, default: 0 },
    checksum: { type: String, default: '' },
    contentId: { type: String, default: null }
  }]
}, {
  timestamps: true
});

// 2. Performance Indexes
EmailSchema.index({ date: -1 });
EmailSchema.index({ subject: 'text', text: 'text' });

const Email = mongoose.models.Email || mongoose.model('Email', EmailSchema);

/**
 * 3. Drop-in Replacement for: saveEmailToDatabase(meta, body)
 */
async function saveEmailToDatabase(meta, body) {
  try {
    const parsed = await simpleParser(body);

    const extractAddresses = (field) => {
      if (!field) return [];
      const list = Array.isArray(field) ? field : (field.value || [field]);
      return list
        .map(item => ({
          address: item.address || item.value || '',
          name: item.name || ''
        }))
        .filter(item => item.address);
    };

    const fromArray = extractAddresses(parsed.from);
    const toArray = extractAddresses(parsed.to);

    const attachmentsArray = (parsed.attachments || []).map(att => ({
      filename: att.filename || 'unnamed',
      contentType: att.contentType || 'application/octet-stream',
      contentDisposition: att.contentDisposition || 'attachment',
      size: att.size || 0,
      checksum: att.checksum || '',
      contentId: att.cid || null
    }));

    const emailDoc = new Email({
      from: fromArray,
      to: toArray,
      subject: parsed.subject || 'No Subject',
      date: parsed.date || new Date(),
      text: parsed.text || '',
      html: parsed.html || parsed.textAsHtml || '',
      attachments: attachmentsArray
    });

    const savedEmail = await emailDoc.save();
    console.log('[SMTP Sync Success] Saved document:', savedEmail._id);
    return savedEmail;
  } catch (error) {
    console.error('[SMTP Mongoose Direct Sync Failure]:', error);
    throw error;
  }
}`}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Right Column: Interactive Ingestion Simulator */}
              <div className="space-y-4 flex flex-col h-full min-h-0 text-left">
                <div className="obsidian bg-[var(--obsidian-0)] rounded-xl border border-white/5 p-4 space-y-3 shrink-0">
                  <span className="text-[8.5px] font-black text-orange-400 tracking-wider uppercase block font-mono">
                    SMTP Stream Simulation inputs
                  </span>

                  <div className="grid grid-cols-2 gap-3 text-left">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-neutral-450 uppercase tracking-widest block font-sans">From Name</label>
                      <input 
                        type="text" 
                        value={simFromName}
                        onChange={(e) => setSimFromName(e.target.value)}
                        className="w-full text-xs font-semibold rounded-lg border border-white/5 bg-neutral-950/40 p-2 text-white outline-none focus:border-orange-500/30 font-sans"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-neutral-450 uppercase tracking-widest block font-sans">From Email Address</label>
                      <input 
                        type="email" 
                        value={simFromEmail}
                        onChange={(e) => setSimFromEmail(e.target.value)}
                        className="w-full text-xs font-semibold rounded-lg border border-white/5 bg-neutral-950/40 p-2 text-white outline-none focus:border-orange-500/30 font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-neutral-450 uppercase tracking-widest block font-sans">To Name</label>
                      <input 
                        type="text" 
                        value={simToName}
                        onChange={(e) => setSimToName(e.target.value)}
                        className="w-full text-xs font-semibold rounded-lg border border-white/5 bg-neutral-950/40 p-2 text-white outline-none focus:border-orange-500/30 font-sans"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-neutral-450 uppercase tracking-widest block font-sans">To Email Address</label>
                      <input 
                        type="email" 
                        value={simToEmail}
                        onChange={(e) => setSimToEmail(e.target.value)}
                        className="w-full text-xs font-semibold rounded-lg border border-white/5 bg-neutral-950/40 p-2 text-white outline-none focus:border-orange-500/30 font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1 text-left">
                    <label className="text-[9px] font-bold text-neutral-450 uppercase tracking-widest block font-sans">Email Subject Line</label>
                    <input 
                      type="text" 
                      value={simSubject}
                      onChange={(e) => setSimSubject(e.target.value)}
                      className="w-full text-xs font-semibold rounded-lg border border-white/5 bg-neutral-950/40 p-2 text-white outline-none focus:border-orange-500/30 font-sans"
                    />
                  </div>

                  <div className="space-y-1 text-left">
                    <label className="text-[9px] font-bold text-neutral-450 uppercase tracking-widest block font-sans">Raw Message Content (SMTP Body Stream)</label>
                    <textarea 
                      value={simBodyText}
                      onChange={(e) => setSimBodyText(e.target.value)}
                      rows={2}
                      className="w-full text-xs font-medium rounded-lg border border-white/5 bg-neutral-950/40 p-2 text-white outline-none focus:border-orange-500/30 font-sans resize-none"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSimulationStatus('parsing');
                      setSimulatedLogs([
                        `Initializing virtual SMTP session...`,
                        `[SMTP Daemon] Connection requested from node 127.0.0.1`
                      ]);
                      setSimulatedEmail(null);

                      setTimeout(() => {
                        setSimulatedLogs(prev => [...prev, 
                          `[SMTP Daemon] Incoming RCPT: <${simToEmail}>, FROM: <${simFromEmail}>`,
                          `[SMTP Daemon] Streaming 14.8KB transmission data to buffer...`,
                          `[Mailparser] Invoking simpleParser(body) asynchronously...`
                        ]);
                        setSimulationStatus('saving');
                      }, 700);

                      setTimeout(() => {
                        setSimulatedLogs(prev => [...prev,
                          `[Mailparser] SUCCESS: Stream decoded in 42ms.`,
                          `[Mongoose Engine] Instantiating schema Model Email...`,
                          `[Schema Checker] Validation passed. Map: from=${simFromName} <${simFromEmail}>, to=${simToName} <${simToEmail}>`,
                          `[Mongoose Engine] Queueing Document save() transaction...`
                        ]);
                      }, 1400);

                      setTimeout(() => {
                        const generatedId = "68" + Array.from({length: 22}, () => Math.floor(Math.random()*16).toString(16)).join('');
                        const mockResult = {
                          _id: generatedId,
                          from: [{ address: simFromEmail, name: simFromName }],
                          to: [{ address: simToEmail, name: simToName }],
                          subject: simSubject,
                          date: new Date().toISOString(),
                          text: simBodyText,
                          html: `<div style="font-family:sans-serif;padding:20px;background:#0d1117;color:#c9d1d9;"><h2>${simSubject}</h2><p>${simBodyText}</p></div>`,
                          attachments: [
                            {
                              filename: "verification_clearance.pdf",
                              contentType: "application/pdf",
                              contentDisposition: "attachment",
                              size: 15420,
                              checksum: "a3f56b9c9d81e012e874bc0de2f1",
                              contentId: "cid-9932"
                            }
                          ],
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                          __v: 0
                        };

                        setSimulatedEmail(mockResult);
                        setSimulatedLogs(prev => [...prev,
                          `[MongoDB Driver] Write acknowledged. Row updated.`,
                          `[MongoDB Direct API] Matches performance index: { date: -1 }`,
                          `[MongoDB Direct API] Updated compound text indices: "subject_text_text_text"`,
                          `[Success] Email successfully committed with ObjectID: "${generatedId}"!`
                        ]);
                        setSimulationStatus('success');
                      }, 2350);
                    }}
                    disabled={simulationStatus === 'parsing' || simulationStatus === 'saving'}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:pointer-events-none text-xs font-bold text-white tracking-wide shadow-lg shadow-orange-600/10 transition-all cursor-pointer"
                  >
                    <Server className="h-4 w-4" />
                    <span>Run Ingestion Pipeline Sync In Simulator</span>
                  </button>
                </div>

                {/* Console System Output Logger */}
                <div className="flex-1 flex flex-col min-h-0 bg-neutral-950 rounded-xl border border-white/5 overflow-hidden font-mono text-[9px] text-left">
                  <div className="bg-neutral-900 border-b border-white/5 p-2 px-3 flex items-center justify-between shrink-0">
                    <span className="text-[10px] font-bold text-neutral-400 flex items-center gap-1.5 uppercase tracking-widest">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live Terminal Outputs
                    </span>
                    <span className="text-neutral-500 font-bold uppercase select-none">node-smtp-syncer</span>
                  </div>
                  
                  <div className="flex-1 p-3 space-y-1.5 overflow-y-auto scrollbar-thin max-h-[140px] text-neutral-400 select-text leading-tight text-left">
                    {simulatedLogs.length === 0 ? (
                      <span className="text-neutral-600 italic">No SMTP ingest stream initiated. Click the simulation button above.</span>
                    ) : (
                      simulatedLogs.map((log, idx) => {
                        let color = "text-neutral-300";
                        if (log.includes("[Success]") || log.includes("SUCCESS:")) color = "text-emerald-400 font-bold";
                        if (log.includes("[SMTP Daemon]") || log.includes("Incoming")) color = "text-blue-400";
                        if (log.includes("[MongoDB Driver]") || log.includes("index")) color = "text-purple-400";
                        if (log.includes("[Mongoose Engine]")) color = "text-orange-400";
                        return (
                          <div key={idx} className={`${color}`}>
                            <span className="text-neutral-600 mr-1.5 font-bold select-none">&gt;&gt;</span>
                            <span>{log}</span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {simulatedEmail && (
                    <div className="border-t border-white/5 shrink-0 flex flex-col">
                      <div className="bg-neutral-900/60 p-1.5 px-3 select-none flex items-center justify-between text-[8px] text-neutral-400 border-b border-white/5">
                        <span className="font-extrabold uppercase text-orange-400 tracking-wider">SAVED MONODB "EMAIL" DOCUMENT RESPONSE</span>
                        <span className="font-bold">STATUS: OK</span>
                      </div>
                      <div className="p-3 bg-slate-900/40 text-left overflow-y-auto max-h-[160px] select-text">
                        <pre className="text-[9px] text-emerald-400/90 whitespace-pre scrollbar-thin">
                          {JSON.stringify(simulatedEmail, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>

              </div>

            </div>

            {/* Modal Footer */}
            <div className="p-5 border-t border-white/5 bg-neutral-950/40 flex items-center justify-between shrink-0">
              <span className="text-[10px] text-neutral-500 font-mono">MongoDB/Mongoose Cluster Integration Status: <strong className="text-emerald-400 font-extrabold text-[10px]">GATEWAY_ACTIVE</strong></span>
              <button
                type="button"
                onClick={() => setShowSmtpDevTools(false)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                Close Developer Dashboard
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
