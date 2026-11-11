import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { BackgroundOrbital } from './BackgroundOrbital';
import { LeftSlimSidebar } from './LeftSlimSidebar';
import { ConversationListColumn } from './ConversationListColumn';
import { ChatDetailColumn } from './ChatDetailColumn';
import { ChatDetailsPanel } from './ChatDetailsPanel';
import { WidgetStudioView } from './WidgetStudioView';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { PromptLibraryModal } from './PromptLibraryModal';
import { ConvertToTaskModal } from './ConvertToTaskModal';
import { NewConversationModal } from './NewConversationModal';
import {
  MessagingConversation,
  MessagingMessage,
  MessagingUser,
  WidgetConfig,
  CannedResponse,
  MessagingPlatformView,
  UserStatus,
  StructuredPromptData,
  StructuredInstructionData,
  CrmRecordReference,
  CrmTaskRecord,
  CrmActivityLog,
  ConversationType
} from './types';
import {
  Plus,
  X,
  MessageSquare,
  Users,
  Globe,
  Sparkles,
  BookOpen,
  Send,
  Sliders,
  Check,
  ChevronRight,
  PanelLeftOpen,
  Briefcase
} from 'lucide-react';
import { useOptionalAuth } from '../../context/AuthContext';
import { AuthedEventSource } from '../../lib/authedEventSource';

export const ProductionMessagingPlatform: React.FC = () => {
  // The signed-in team member and the organization's real members (no built-in people).
  const auth = useOptionalAuth();
  const CURRENT_USER: MessagingUser = React.useMemo(() => ({
    id: auth?.user?.uid || auth?.userProfile?.uid || 'me',
    name: auth?.userProfile?.displayName || auth?.user?.email || 'You',
    email: auth?.userProfile?.email || auth?.user?.email || '',
    avatar: auth?.userProfile?.photoURL || '',
    role: 'admin',
    status: 'online',
    department: ''
  }), [auth?.user?.uid, auth?.user?.email, auth?.userProfile?.uid, auth?.userProfile?.displayName, auth?.userProfile?.email, auth?.userProfile?.photoURL]);
  const [orgMembers, setOrgMembers] = useState<MessagingUser[]>([]);
  useEffect(() => {
    axios.get('/api/orgs/current/members').then((res) => {
      const list = Array.isArray(res.data?.members) ? res.data.members : [];
      setOrgMembers(list.map((m: any) => ({
        id: String(m.userId), name: m.name || m.email || 'Team member', email: m.email || '', avatar: '',
        role: m.role === 'OWNER' || m.role === 'ADMIN' ? 'admin' : 'agent', status: 'offline', department: ''
      })));
    }).catch(() => setOrgMembers([]));
  }, []);
  const REGISTERED_AGENTS: MessagingUser[] = React.useMemo(
    () => [CURRENT_USER, ...orgMembers.filter((m) => m.id !== CURRENT_USER.id)],
    [CURRENT_USER, orgMembers]
  );
  const [currentView, setCurrentView] = useState<MessagingPlatformView>('inbox');
  const [conversations, setConversations] = useState<MessagingConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessagingMessage[]>([]);
  const [tasks, setTasks] = useState<CrmTaskRecord[]>([]);
  const [activities, setActivities] = useState<CrmActivityLog[]>([]);
  const [availableCrmRecords, setAvailableCrmRecords] = useState<CrmRecordReference[]>([]);
  const [promptsList, setPromptsList] = useState<StructuredPromptData[]>([]);

  const [widgetConfig, setWidgetConfig] = useState<WidgetConfig | null>(null);
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
  const [currentUserStatus, setCurrentUserStatus] = useState<UserStatus>('online');

  // Filter & Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'unread' | 'crm_linked' | 'groups' | 'direct' | 'pinned'>('all');
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(true);
  const [isConversationListCollapsed, setIsConversationListCollapsed] = useState(false);

  // Responsive screen size tracking
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      if (window.innerWidth >= 768) {
        setMobileView('chat');
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowWidth < 768;
  const isTablet = windowWidth >= 768 && windowWidth < 1024;

  // Modals state
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [isPromptLibraryOpen, setIsPromptLibraryOpen] = useState(false);
  const [selectedMessageForTask, setSelectedMessageForTask] = useState<MessagingMessage | null>(null);
  const [previewDocument, setPreviewDocument] = useState<{
    name: string;
    url?: string;
    size?: string;
    mime?: string;
    senderName?: string;
    timestamp?: string;
  } | null>(null);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // -----------------------------------------------------------------
  // 1. Fetch Initial Data
  // -----------------------------------------------------------------
  const fetchConversations = useCallback(async () => {
    try {
      const res = await axios.get('/api/messaging/conversations');
      if (res.data.success) {
        setConversations(res.data.conversations);
        if (!activeConversationId && res.data.conversations.length > 0) {
          setActiveConversationId(res.data.conversations[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch conversations:', err);
    }
  }, [activeConversationId]);

  const fetchMessages = useCallback(async (convId: string) => {
    try {
      const res = await axios.get(`/api/messaging/conversations/${convId}/messages`);
      if (res.data.success) {
        setMessages(res.data.messages);
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  }, []);

  const fetchTasks = useCallback(async (convId: string) => {
    try {
      const res = await axios.get(`/api/messaging/conversations/${convId}/tasks`);
      if (res.data.success) {
        setTasks(res.data.tasks);
      }
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  }, []);

  const fetchActivities = useCallback(async (convId: string) => {
    try {
      const res = await axios.get(`/api/messaging/conversations/${convId}/activities`);
      if (res.data.success) {
        setActivities(res.data.activities);
      }
    } catch (err) {
      console.error('Failed to fetch activities:', err);
    }
  }, []);

  const fetchCrmRecords = useCallback(async () => {
    try {
      const res = await axios.get('/api/messaging/crm-records');
      if (res.data.success) {
        setAvailableCrmRecords(res.data.records);
      }
    } catch (err) {
      console.error('Failed to fetch CRM records:', err);
    }
  }, []);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await axios.get('/api/messaging/prompts');
      if (res.data.success) {
        setPromptsList(res.data.prompts);
      }
    } catch (err) {
      console.error('Failed to fetch prompts:', err);
    }
  }, []);

  const fetchWidget = useCallback(async () => {
    try {
      const res = await axios.get('/api/messaging/widgets');
      if (res.data.success && res.data.widgets.length > 0) {
        setWidgetConfig(res.data.widgets[0]);
      }
    } catch (err) {
      console.error('Failed to fetch widget config:', err);
    }
  }, []);

  const fetchCanned = useCallback(async () => {
    try {
      const res = await axios.get('/api/messaging/canned-responses');
      if (res.data.success) {
        setCannedResponses(res.data.cannedResponses);
      }
    } catch (err) {
      console.error('Failed to fetch canned responses:', err);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    fetchCrmRecords();
    fetchPrompts();
    fetchWidget();
    fetchCanned();
  }, [fetchConversations, fetchCrmRecords, fetchPrompts, fetchWidget, fetchCanned]);

  useEffect(() => {
    if (activeConversationId) {
      fetchMessages(activeConversationId);
      fetchTasks(activeConversationId);
      fetchActivities(activeConversationId);
    }
  }, [activeConversationId, fetchMessages, fetchTasks, fetchActivities]);

  // -----------------------------------------------------------------
  // 2. Real-Time Server-Sent Events (SSE) Connection
  // -----------------------------------------------------------------
  useEffect(() => {
    let eventSource: AuthedEventSource | null = null;
    try {
      eventSource = new AuthedEventSource('/api/messaging/stream');

      eventSource.addEventListener('new_message', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          const { conversationId, message } = payload;

          if (conversationId === activeConversationId) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === message.id)) return prev;
              return [...prev, message];
            });
          }

          setConversations((prev) =>
            prev.map((c) => {
              if (c.id === conversationId) {
                return {
                  ...c,
                  lastMessage: message,
                  updatedAt: message.createdAt,
                  unreadCount: conversationId === activeConversationId ? 0 : (c.unreadCount || 0) + 1
                };
              }
              return c;
            })
          );

          if (message.senderId !== CURRENT_USER.id) {
            showToast(`💬 New message from ${message.senderName}: "${message.content.slice(0, 35)}..."`);
          }
        } catch (err) {
          console.error('SSE new_message parse error:', err);
        }
      });

      eventSource.addEventListener('message_updated', (e: MessageEvent) => {
        try {
          const { conversationId, message } = JSON.parse(e.data);
          if (conversationId === activeConversationId) {
            setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
          }
        } catch (err) {
          console.error('SSE message_updated parse error:', err);
        }
      });

      eventSource.addEventListener('message_deleted', (e: MessageEvent) => {
        try {
          const { conversationId, messageId } = JSON.parse(e.data);
          if (conversationId === activeConversationId) {
            setMessages((prev) => prev.filter((m) => m.id !== messageId));
          }
        } catch (err) {
          console.error('SSE message_deleted error:', err);
        }
      });

      eventSource.addEventListener('conversation_created', (e: MessageEvent) => {
        try {
          const newConv = JSON.parse(e.data);
          setConversations((prev) => [newConv, ...prev.filter((c) => c.id !== newConv.id)]);
          showToast(`🔔 New conversation created: ${newConv.title}`);
        } catch (err) {
          console.error('SSE conversation_created error:', err);
        }
      });

      eventSource.addEventListener('conversation_updated', (e: MessageEvent) => {
        try {
          const updatedConv = JSON.parse(e.data);
          setConversations((prev) =>
            prev.map((c) => (c.id === updatedConv.id ? { ...c, ...updatedConv } : c))
          );
        } catch (err) {
          console.error('SSE conversation_updated error:', err);
        }
      });

      eventSource.addEventListener('task_created', (e: MessageEvent) => {
        try {
          const { conversationId, task } = JSON.parse(e.data);
          if (conversationId === activeConversationId) {
            setTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
          }
          showToast(`⚡ CRM Task Created: "${task.title}"`);
        } catch (err) {
          console.error('SSE task_created error:', err);
        }
      });

      eventSource.addEventListener('task_updated', (e: MessageEvent) => {
        try {
          const { conversationId, task } = JSON.parse(e.data);
          if (conversationId === activeConversationId) {
            setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
          }
        } catch (err) {
          console.error('SSE task_updated error:', err);
        }
      });

      eventSource.addEventListener('reaction_toggled', (e: MessageEvent) => {
        try {
          const { conversationId, messageId, reactions } = JSON.parse(e.data);
          if (conversationId === activeConversationId) {
            setMessages((prev) =>
              prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
            );
          }
        } catch (err) {
          console.error('SSE reaction_toggled error:', err);
        }
      });

      eventSource.addEventListener('conversation_deleted', (e: MessageEvent) => {
        try {
          const { conversationId } = JSON.parse(e.data);
          setConversations((prev) => prev.filter((c) => c.id !== conversationId));
          setActiveConversationId((curr) => (curr === conversationId ? null : curr));
        } catch (err) {
          console.error('SSE conversation_deleted error:', err);
        }
      });
    } catch (err) {
      console.warn('SSE could not initialize:', err);
    }

    return () => {
      eventSource?.close();
    };
  }, [activeConversationId]);

  // -----------------------------------------------------------------
  // 3. Handlers: Message Sending, Reactions, Editing & Deleting
  // -----------------------------------------------------------------
  const handleSendMessage = async (payload: {
    content: string;
    isInternalNote?: boolean;
    contentType?: 'text' | 'voice' | 'file' | 'image' | 'prompt' | 'instruction' | 'crm_activity';
    attachmentName?: string;
    attachmentUrl?: string;
    attachmentSize?: string;
    attachmentMime?: string;
    voiceDuration?: number;
    replyTo?: any;
    structuredPrompt?: StructuredPromptData;
    structuredInstruction?: StructuredInstructionData;
  }) => {
    if (!activeConversationId) return;

    const tempId = `temp_${Date.now()}`;
    const optimisticMsg: MessagingMessage = {
      id: tempId,
      conversationId: activeConversationId,
      senderId: CURRENT_USER.id,
      senderType: 'user',
      senderName: CURRENT_USER.name,
      senderAvatar: CURRENT_USER.avatar,
      content: payload.content,
      contentType: payload.contentType || 'text',
      attachmentName: payload.attachmentName,
      attachmentUrl: payload.attachmentUrl,
      attachmentSize: payload.attachmentSize,
      attachmentMime: payload.attachmentMime,
      voiceDuration: payload.voiceDuration,
      isInternalNote: payload.isInternalNote,
      replyTo: payload.replyTo,
      structuredPrompt: payload.structuredPrompt,
      structuredInstruction: payload.structuredInstruction,
      status: 'sending',
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const res = await axios.post(`/api/messaging/conversations/${activeConversationId}/messages`, {
        ...payload,
        senderId: CURRENT_USER.id,
        senderName: CURRENT_USER.name,
        senderAvatar: CURRENT_USER.avatar
      });

      if (res.data.success) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? res.data.message : m))
        );
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      showToast('❌ Failed to send message. Please try again.');
    }
  };

  const handleEditMessage = async (messageId: string, newContent: string) => {
    if (!activeConversationId) return;
    try {
      const res = await axios.patch(
        `/api/messaging/conversations/${activeConversationId}/messages/${messageId}`,
        { content: newContent, userId: CURRENT_USER.id }
      );
      if (res.data.success) {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? res.data.message : m)));
        showToast('Message edited');
      }
    } catch (err) {
      console.error('Failed to edit message:', err);
      showToast('Could not edit message');
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!activeConversationId) return;
    try {
      await axios.delete(`/api/messaging/conversations/${activeConversationId}/messages/${messageId}`);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      showToast('Message deleted');
    } catch (err) {
      console.error('Failed to delete message:', err);
      showToast('Could not delete message');
    }
  };

  const handleTogglePinMessage = async (messageId: string) => {
    if (!activeConversationId) return;
    try {
      const res = await axios.post(
        `/api/messaging/conversations/${activeConversationId}/messages/${messageId}/pin`
      );
      if (res.data.success) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, isPinned: res.data.isPinned } : m))
        );
        showToast(res.data.isPinned ? '📌 Message pinned to room banner' : 'Message unpinned');
      }
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleTogglePinConversation = async (convId: string) => {
    try {
      const res = await axios.post(`/api/messaging/conversations/${convId}/pin`);
      if (res.data.success) {
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, isPinned: res.data.isPinned } : c))
        );
        showToast(res.data.isPinned ? '📌 Conversation pinned to top' : 'Conversation unpinned');
      }
    } catch (err) {
      console.error('Failed to pin conversation:', err);
    }
  };

  const handleToggleReadConversation = async (convId: string) => {
    try {
      const res = await axios.post(`/api/messaging/conversations/${convId}/toggle-read`);
      if (res.data.success) {
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, unreadCount: res.data.unreadCount } : c))
        );
      }
    } catch (err) {
      console.error('Failed to toggle read state:', err);
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!activeConversationId) return;
    try {
      const res = await axios.post(
        `/api/messaging/conversations/${activeConversationId}/messages/${messageId}/reaction`,
        { emoji, userId: CURRENT_USER.id }
      );
      if (res.data.success) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, reactions: res.data.reactions } : m))
        );
      }
    } catch (err) {
      console.error('Failed to toggle reaction:', err);
    }
  };

  const handleUpdateConversation = async (updates: Partial<MessagingConversation>) => {
    if (!activeConversationId) return;
    try {
      const res = await axios.patch(
        `/api/messaging/conversations/${activeConversationId}`,
        updates
      );
      if (res.data.success) {
        setConversations((prev) =>
          prev.map((c) => (c.id === activeConversationId ? { ...c, ...res.data.conversation } : c))
        );
        showToast('Updated conversation details');
      }
    } catch (err) {
      console.error('Failed to update conversation:', err);
    }
  };

  const handleRemoveConversation = async (convId: string) => {
    try {
      const target = conversations.find((c) => c.id === convId);
      const title = target?.title || 'Conversation';

      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConversationId === convId) {
        const remaining = conversations.filter((c) => c.id !== convId);
        setActiveConversationId(remaining.length > 0 ? remaining[0].id : null);
      }

      await axios.delete(`/api/messaging/conversations/${convId}`);
      showToast(`Archived "${title}"`);
    } catch (err) {
      console.error('Failed to remove conversation:', err);
      showToast('Archived conversation');
    }
  };

  const handleExecuteAi = async (prompt: StructuredPromptData) => {
    if (!activeConversationId) return;
    try {
      showToast(`🤖 Executing AI Copilot: "${prompt.title}"...`);
      const res = await axios.post(`/api/messaging/conversations/${activeConversationId}/execute-ai`, {
        promptTitle: prompt.title,
        promptContent: prompt.template,
        model: prompt.modelSuggestion || 'gemini-2.5-flash',
        crmContext: activeConversation?.crmRecord
      });
      if (res.data.success) {
        setMessages((prev) => [...prev, res.data.message]);
        showToast('✅ AI Copilot generated workflow response');
      }
    } catch (err) {
      console.error('Failed to execute AI:', err);
      showToast('Could not execute AI copilot prompt');
    }
  };

  const handleUploadFile = async (file: File) => {
    if (!activeConversationId) return;
    try {
      const res = await axios.post('/api/messaging/upload', {
        filename: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
        conversationId: activeConversationId
      });
      if (res.data.success) {
        await handleSendMessage({
          content: `Shared document: ${file.name}`,
          contentType: 'file',
          attachmentName: res.data.filename,
          attachmentUrl: res.data.downloadUrl,
          attachmentSize: res.data.sizeHuman,
          attachmentMime: res.data.mimeType
        });
        showToast(`Shared ${file.name}`);
      }
    } catch (err: any) {
      console.error('Upload failed:', err);
      showToast(err.response?.data?.error || 'File upload failed');
    }
  };

  const handleAddNote = async (noteText: string) => {
    if (!activeConversationId) return;
    try {
      await axios.post(`/api/messaging/conversations/${activeConversationId}/notes`, {
        note: noteText,
        authorName: CURRENT_USER.name
      });
      fetchActivities(activeConversationId);
      showToast('📝 CRM Note logged to deal record');
    } catch (err) {
      console.error('Failed to log note:', err);
      showToast('Failed to log CRM note');
    }
  };

  // Create CRM Task from message or modal
  const handleCreateTask = async (taskData: {
    title: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    dueDate: string;
    assignee: string;
    sourceMessageId: string;
  }) => {
    if (!activeConversationId) return;
    try {
      const res = await axios.post(
        `/api/messaging/conversations/${activeConversationId}/tasks`,
        taskData
      );
      if (res.data.success) {
        setTasks((prev) => [res.data.task, ...prev]);
        setMessages((prev) => [...prev, res.data.message]);
        showToast(`⚡ Created CRM Task: "${taskData.title}"`);
      }
    } catch (err) {
      console.error('Failed to create task:', err);
      showToast('Could not create task');
    }
  };

  const handleToggleTaskStatus = async (taskId: string) => {
    if (!activeConversationId) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';

    try {
      const res = await axios.patch(
        `/api/messaging/conversations/${activeConversationId}/tasks/${taskId}`,
        { status: newStatus }
      );
      if (res.data.success) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? res.data.task : t)));
      }
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const handleCreateNewConversation = async (payload: {
    type: ConversationType;
    channel: 'internal' | 'crm' | 'widget' | 'email';
    title: string;
    participantIds: string[];
    priority: 'low' | 'medium' | 'high' | 'urgent';
    tags: string[];
    crmRecord?: CrmRecordReference;
  }) => {
    try {
      const res = await axios.post('/api/messaging/conversations', payload);
      if (res.data.success) {
        const newConv = res.data.conversation;
        setConversations((prev) => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
        setIsNewChatModalOpen(false);
        showToast(`Created conversation room: ${newConv.title}`);
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
      showToast('Could not start conversation');
    }
  };

  const handleSaveWidget = async (updated: WidgetConfig) => {
    try {
      const res = await axios.post('/api/messaging/widgets', updated);
      if (res.data.success) {
        setWidgetConfig(res.data.widget);
        showToast('✅ Widget configuration saved and published!');
      }
    } catch (err) {
      console.error('Failed to save widget:', err);
      showToast('❌ Failed to save widget configuration');
    }
  };

  // Unread badge counters
  const unreadCounts = {
    inbox: conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0),
    visitors: conversations
      .filter((c) => c.channel === 'widget')
      .reduce((acc, c) => acc + (c.unreadCount || 0), 0),
    direct: conversations
      .filter((c) => c.type === 'direct')
      .reduce((acc, c) => acc + (c.unreadCount || 0), 0)
  };

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) || conversations[0];

  return (
    <div className="h-full w-full flex bg-neutral-950 text-neutral-100 font-sans overflow-hidden relative selection:bg-blue-600 selection:text-white">
      {/* Background Ambient Glow */}
      <BackgroundOrbital />

      {/* 1. Left Slim Sidebar (Hidden on mobile, visible on md+) */}
      <LeftSlimSidebar
        currentView={currentView}
        onSelectView={(view) => {
          setCurrentView(view);
          if (view === 'visitors') setFilterTab('all');
          if (view === 'direct') setFilterTab('direct');
          if (view === 'inbox') setFilterTab('all');
        }}
        currentUser={{ ...CURRENT_USER, status: currentUserStatus }}
        onStatusChange={(st) => setCurrentUserStatus(st)}
        unreadCounts={unreadCounts}
      />

      {/* 2. Main Stage Router */}
      {currentView === 'studio' && widgetConfig ? (
        <WidgetStudioView
          widget={widgetConfig}
          onSaveWidget={handleSaveWidget}
          onTestMessageSent={(text) => {
            showToast(`Received test message: "${text.slice(0, 25)}..."`);
          }}
        />
      ) : currentView === 'canned' ? (
        /* Canned Templates Manager View */
        <div className="flex-1 p-4 sm:p-8 overflow-y-auto bg-neutral-950/60 backdrop-blur-xl space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <BookOpen className="w-5 h-5 text-blue-400" />
                <h2 className="text-xl font-bold text-white tracking-tight">Canned Response Library</h2>
              </div>
              <p className="text-xs text-neutral-400">
                Type <code className="text-blue-400 font-mono">/shortcut</code> in any chat to instantly paste rapid support snippets.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cannedResponses.map((cr) => (
              <div
                key={cr.id}
                className="p-5 rounded-2xl bg-neutral-900/80 border border-white/10 shadow-lg space-y-2 hover:border-blue-500/30 transition-all"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-md border border-blue-500/20">
                    {cr.shortcut}
                  </span>
                  <span className="text-[11px] font-semibold text-neutral-400 px-2 py-0.5 rounded bg-white/5">
                    {cr.category}
                  </span>
                </div>
                <h4 className="text-sm font-semibold text-white">{cr.title}</h4>
                <p className="text-xs text-neutral-300 leading-relaxed">{cr.content}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Standard Deep CRM Messaging Workstation (Adaptive Screen Layout) */
        <div className="flex-1 flex h-full overflow-hidden relative z-10 min-w-0">
          {/* Column 1: Conversations List (Full-width on mobile when list is active, hidden when chatting on mobile) */}
          <ConversationListColumn
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={(id) => {
              setActiveConversationId(id);
              if (isMobile) {
                setMobileView('chat');
              }
            }}
            onOpenNewChatModal={() => setIsNewChatModalOpen(true)}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterTab={filterTab}
            onFilterTabChange={setFilterTab}
            isCollapsed={isConversationListCollapsed}
            onToggleCollapse={() => setIsConversationListCollapsed(!isConversationListCollapsed)}
            onRemoveConversation={handleRemoveConversation}
            onTogglePinConversation={handleTogglePinConversation}
            onToggleReadConversation={handleToggleReadConversation}
            currentView={currentView}
            onSelectView={(view) => {
              setCurrentView(view);
              if (view === 'visitors') setFilterTab('all');
              if (view === 'direct') setFilterTab('direct');
              if (view === 'inbox') setFilterTab('all');
            }}
            unreadCounts={unreadCounts}
            className={
              isMobile
                ? mobileView === 'list'
                  ? 'w-full flex-1 border-r-0'
                  : 'hidden'
                : isConversationListCollapsed
                ? 'w-0 overflow-hidden border-none'
                : 'w-72 md:w-80 lg:w-88 shrink-0'
            }
          />

          {/* Column 2: Central Chat Timeline & Composer */}
          {activeConversation ? (
            <div className={`flex-1 flex flex-col h-full min-w-0 ${isMobile && mobileView === 'list' ? 'hidden' : 'flex'}`}>
              <ChatDetailColumn
                conversation={activeConversation}
                messages={messages}
                currentUser={CURRENT_USER}
                registeredAgents={REGISTERED_AGENTS}
                onSendMessage={handleSendMessage}
                onToggleReaction={handleToggleReaction}
                onUpdateConversationStatus={(status) => handleUpdateConversation({ status })}
                onToggleDetailsPanel={() => setIsDetailsPanelOpen(!isDetailsPanelOpen)}
                isDetailsPanelOpen={isDetailsPanelOpen}
                cannedResponses={cannedResponses}
                isConversationListCollapsed={isConversationListCollapsed}
                onToggleConversationList={() => setIsConversationListCollapsed(!isConversationListCollapsed)}
                onOpenPromptLibrary={() => setIsPromptLibraryOpen(true)}
                onOpenConvertToTask={(msg) => setSelectedMessageForTask(msg)}
                onPreviewDocument={(doc) => setPreviewDocument(doc)}
                onTogglePinMessage={handleTogglePinMessage}
                onEditMessage={handleEditMessage}
                onDeleteMessage={handleDeleteMessage}
                onExecuteAi={handleExecuteAi}
                onUploadFile={handleUploadFile}
                onAddNote={handleAddNote}
                onBackToList={isMobile ? () => setMobileView('list') : undefined}
              />
            </div>
          ) : (
            <div className={`flex-1 flex flex-col items-center justify-center p-8 text-center bg-neutral-950 ${isMobile && mobileView === 'list' ? 'hidden' : 'flex'}`}>
              <MessageSquare className="w-12 h-12 text-neutral-600 mb-3" />
              <h3 className="text-base font-semibold text-white">No active conversation selected</h3>
              <p className="text-xs text-neutral-400 mt-1 max-w-sm">
                Select a deal room or direct message from the inbox, or start a new conversation.
              </p>
            </div>
          )}

          {/* Column 3: 360° CRM Collaboration & Telemetry Sidebar (Overlay drawer on mobile/tablet, side-by-side on desktop) */}
          {isDetailsPanelOpen && activeConversation && (
            isTablet || isMobile ? (
              <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
                <div className="w-full max-w-sm sm:max-w-md h-full bg-neutral-900 border-l border-white/10 shadow-2xl relative animate-in slide-in-from-right duration-200">
                  <ChatDetailsPanel
                    conversation={activeConversation}
                    messages={messages}
                    registeredAgents={REGISTERED_AGENTS}
                    onUpdateConversation={handleUpdateConversation}
                    cannedResponses={cannedResponses}
                    onInsertCanned={(text) => {
                      handleSendMessage({ content: text, contentType: 'text' });
                      showToast('Inserted canned template into chat');
                    }}
                    onRemoveConversation={handleRemoveConversation}
                    onOpenConvertToTask={() => {
                      if (messages.length > 0) {
                        setSelectedMessageForTask(messages[messages.length - 1]);
                      }
                    }}
                    onPreviewDocument={(doc) => setPreviewDocument(doc)}
                    tasks={tasks}
                    activities={activities}
                    onToggleTaskStatus={handleToggleTaskStatus}
                    onClosePanel={() => setIsDetailsPanelOpen(false)}
                    className="w-full h-full border-none"
                  />
                </div>
              </div>
            ) : (
              <ChatDetailsPanel
                conversation={activeConversation}
                messages={messages}
                registeredAgents={REGISTERED_AGENTS}
                onUpdateConversation={handleUpdateConversation}
                cannedResponses={cannedResponses}
                onInsertCanned={(text) => {
                  handleSendMessage({ content: text, contentType: 'text' });
                  showToast('Inserted canned template into chat');
                }}
                onRemoveConversation={handleRemoveConversation}
                onOpenConvertToTask={() => {
                  if (messages.length > 0) {
                    setSelectedMessageForTask(messages[messages.length - 1]);
                  }
                }}
                onPreviewDocument={(doc) => setPreviewDocument(doc)}
                tasks={tasks}
                activities={activities}
                onToggleTaskStatus={handleToggleTaskStatus}
                onClosePanel={() => setIsDetailsPanelOpen(false)}
              />
            )
          )}
        </div>
      )}

      {/* Modal 1: New Conversation Modal (CRM-Linked / Group / Direct) */}
      <NewConversationModal
        isOpen={isNewChatModalOpen}
        onClose={() => setIsNewChatModalOpen(false)}
        registeredAgents={REGISTERED_AGENTS}
        availableCrmRecords={availableCrmRecords}
        onCreateConversation={handleCreateNewConversation}
      />

      {/* Modal 2: Structured Prompts & SOP Checklists Library */}
      <PromptLibraryModal
        isOpen={isPromptLibraryOpen}
        onClose={() => setIsPromptLibraryOpen(false)}
        prompts={promptsList}
        clientContextName={activeConversation?.title || 'Client'}
        companyContextName={activeConversation?.crmRecord?.companyName || ''}
        onSelectPrompt={(prompt, asCard) => {
          if (asCard) {
            handleSendMessage({
              content: `Structured Prompt: ${prompt.title}`,
              contentType: 'prompt',
              structuredPrompt: prompt
            });
          } else {
            handleSendMessage({
              content: prompt.template,
              contentType: 'text'
            });
          }
          showToast(`Applied prompt: ${prompt.title}`);
        }}
        onSelectInstruction={(instruction) => {
          handleSendMessage({
            content: `SOP Checklist: ${instruction.title}`,
            contentType: 'instruction',
            structuredInstruction: instruction
          });
          showToast(`Deployed SOP checklist: ${instruction.title}`);
        }}
      />

      {/* Modal 3: Convert to CRM Task Modal */}
      <ConvertToTaskModal
        isOpen={!!selectedMessageForTask}
        onClose={() => setSelectedMessageForTask(null)}
        message={selectedMessageForTask}
        registeredAgents={REGISTERED_AGENTS}
        onConvert={handleCreateTask}
      />

      {/* Modal 4: Document Preview Modal */}
      <DocumentPreviewModal
        isOpen={!!previewDocument}
        onClose={() => setPreviewDocument(null)}
        document={previewDocument}
      />

      {/* Floating System Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl bg-neutral-900/90 text-white text-xs font-medium border border-white/10 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150 flex items-center gap-2">
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

export default ProductionMessagingPlatform;
