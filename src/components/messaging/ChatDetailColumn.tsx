import React, { useState, useRef, useEffect } from 'react';
import { initialsAvatar } from './avatar';
import {
  Send,
  Paperclip,
  Smile,
  Mic,
  MicOff,
  Lock,
  Globe,
  Check,
  CheckCheck,
  Phone,
  Video,
  MoreVertical,
  SidebarClose,
  SidebarOpen,
  Sparkles,
  Zap,
  Play,
  Pause,
  FileText,
  AlertCircle,
  Pin,
  CheckSquare,
  Search,
  X,
  Reply,
  Copy,
  Edit2,
  Trash2,
  Download,
  Eye,
  CornerUpLeft,
  ArrowLeft,
  ChevronDown,
  Briefcase,
  Users,
  UploadCloud,
  Bot,
  Cpu,
  Clock,
  FileUp,
  Bookmark
} from 'lucide-react';
import {
  MessagingConversation,
  MessagingMessage,
  MessagingUser,
  CannedResponse,
  StructuredPromptData,
  StructuredInstructionData,
  MessageReplyContext
} from './types';

interface ChatDetailColumnProps {
  conversation: MessagingConversation;
  messages: MessagingMessage[];
  currentUser: MessagingUser;
  registeredAgents: MessagingUser[];
  onSendMessage: (payload: {
    content: string;
    isInternalNote?: boolean;
    contentType?:
      | 'text'
      | 'voice'
      | 'file'
      | 'image'
      | 'canned'
      | 'prompt'
      | 'instruction'
      | 'crm_activity'
      | 'task_reference'
      | 'ai_response';
    attachmentName?: string;
    attachmentUrl?: string;
    attachmentSize?: string;
    attachmentMime?: string;
    voiceDuration?: number;
    replyTo?: MessageReplyContext;
    structuredPrompt?: StructuredPromptData;
    structuredInstruction?: StructuredInstructionData;
  }) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onUpdateConversationStatus: (status: 'open' | 'pending' | 'resolved') => void;
  onToggleDetailsPanel: () => void;
  isDetailsPanelOpen: boolean;
  cannedResponses: CannedResponse[];
  isConversationListCollapsed?: boolean;
  onToggleConversationList?: () => void;
  onOpenPromptLibrary: () => void;
  onOpenConvertToTask: (message: MessagingMessage) => void;
  onPreviewDocument: (doc: {
    name: string;
    url?: string;
    size?: string;
    mime?: string;
    senderName?: string;
    timestamp?: string;
  }) => void;
  onTogglePinMessage?: (messageId: string) => void;
  onEditMessage?: (messageId: string, newContent: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onExecuteAi?: (prompt: StructuredPromptData) => void;
  onUploadFile?: (file: File) => void;
  onAddNote?: (noteText: string) => void;
  onBackToList?: () => void;
}

export const ChatDetailColumn: React.FC<ChatDetailColumnProps> = ({
  conversation,
  messages,
  currentUser,
  registeredAgents,
  onSendMessage,
  onToggleReaction,
  onUpdateConversationStatus,
  onToggleDetailsPanel,
  isDetailsPanelOpen,
  cannedResponses,
  isConversationListCollapsed = false,
  onToggleConversationList,
  onOpenPromptLibrary,
  onOpenConvertToTask,
  onPreviewDocument,
  onTogglePinMessage,
  onEditMessage,
  onDeleteMessage,
  onExecuteAi,
  onUploadFile,
  onAddNote,
  onBackToList
}) => {
  const [inputText, setInputText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [activeReply, setActiveReply] = useState<MessageReplyContext | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Drag and Drop state
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Search within conversation
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchInConvQuery, setSearchInConvQuery] = useState('');

  // Mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [showMentionPicker, setShowMentionPicker] = useState(false);

  // Quick Emoji Tray
  const [showEmojiPickerForMsgId, setShowEmojiPickerForMsgId] = useState<string | null>(null);
  const [showComposerEmojiTray, setShowComposerEmojiTray] = useState(false);

  // Canned shortcuts
  const [showCannedDropdown, setShowCannedDropdown] = useState(false);

  // Interactive Checklist completion states
  const [instructionState, setInstructionState] = useState<{ [stepId: string]: boolean }>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle @mention and `/` canned trigger
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    if (val.startsWith('/')) {
      setShowCannedDropdown(true);
    } else {
      setShowCannedDropdown(false);
    }

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1 && (lastAtIndex === 0 || /\s/.test(textBeforeCursor[lastAtIndex - 1]))) {
      const query = textBeforeCursor.slice(lastAtIndex + 1);
      if (!query.includes(' ')) {
        setMentionQuery(query);
        setShowMentionPicker(true);
        return;
      }
    }
    setShowMentionPicker(false);
    setMentionQuery(null);
  };

  const handleSelectMention = (user: MessagingUser) => {
    if (!textareaRef.current) return;
    const cursorPos = textareaRef.current.selectionStart;
    const textBeforeCursor = inputText.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = inputText.slice(cursorPos);

    const newText = `${inputText.slice(0, lastAtIndex)}@${user.name} ${textAfterCursor}`;
    setInputText(newText);
    setShowMentionPicker(false);
    setMentionQuery(null);

    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  const handleInsertCanned = (content: string) => {
    setInputText(content);
    setShowCannedDropdown(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleSend = () => {
    if (!inputText.trim()) return;

    onSendMessage({
      content: inputText.trim(),
      isInternalNote,
      contentType: 'text',
      replyTo: activeReply || undefined
    });

    setInputText('');
    setIsInternalNote(false);
    setActiveReply(null);
    setShowCannedDropdown(false);
  };

  // Keyboard shortcut: Enter = send, Shift + Enter = new line
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleProcessFile = (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      alert(`File "${file.name}" is too large. Maximum allowed size is 25MB.`);
      return;
    }

    // Simulate progress animation
    setUploadProgress(15);
    const p1 = setTimeout(() => setUploadProgress(65), 200);
    const p2 = setTimeout(() => {
      setUploadProgress(100);
      if (onUploadFile) {
        onUploadFile(file);
      } else {
        onSendMessage({
          content: `Shared file: ${file.name}`,
          contentType: 'file',
          attachmentName: file.name,
          attachmentUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
          attachmentSize: `${(file.size / 1024).toFixed(1)} KB`,
          attachmentMime: file.type || 'application/pdf'
        });
      }
      setTimeout(() => setUploadProgress(null), 400);
    }, 500);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleProcessFile(e.target.files[0]);
    }
  };

  // Filter messages by in-conversation search
  const displayedMessages = messages.filter((m) => {
    if (!searchInConvQuery.trim()) return true;
    const q = searchInConvQuery.toLowerCase();
    return (
      m.content.toLowerCase().includes(q) ||
      m.senderName.toLowerCase().includes(q) ||
      m.attachmentName?.toLowerCase().includes(q) ||
      m.structuredPrompt?.title.toLowerCase().includes(q)
    );
  });

  const pinnedMessages = messages.filter((m) => m.isPinned);

  const formatDateSeparator = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    if (isToday) return 'Today';
    if (isYesterday) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const EMOJI_OPTIONS = ['👍', '❤️', '🚀', '🔥', '✅', '👏', '🎯', '💡'];

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex-1 flex flex-col h-full bg-neutral-950 overflow-hidden relative"
    >
      {/* ---------------------------------------------------- */}
      {/* DRAG AND DROP VISUAL OVERLAY DROPZONE                */}
      {/* ---------------------------------------------------- */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 bg-blue-950/80 backdrop-blur-md border-2 border-dashed border-blue-400 m-4 rounded-3xl flex flex-col items-center justify-center text-white pointer-events-none animate-in fade-in duration-150">
          <UploadCloud className="w-16 h-16 text-blue-400 mb-3 animate-bounce" />
          <h3 className="text-lg font-bold">Drop Business File to Attach</h3>
          <p className="text-xs text-blue-200 mt-1">
            Securely upload to {conversation.title} (PDF, DOCX, XLSX, Images up to 25MB)
          </p>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 1. TOP CONVERSATION HEADER BAR                       */}
      {/* ---------------------------------------------------- */}
      <div className="px-3 sm:px-5 py-3.5 border-b border-white/5 bg-neutral-900/60 backdrop-blur-md flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {onBackToList && (
            <button
              onClick={onBackToList}
              id="btn-back-to-conv-list"
              title="Back to conversations list"
              className="flex md:hidden p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer items-center gap-1 shrink-0"
            >
              <ArrowLeft className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-semibold text-neutral-300">Chats</span>
            </button>
          )}

          {onToggleConversationList && (
            <button
              onClick={onToggleConversationList}
              title={isConversationListCollapsed ? 'Expand conversation list' : 'Collapse conversation list'}
              className="hidden md:flex p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition cursor-pointer shrink-0"
            >
              {isConversationListCollapsed ? <SidebarOpen className="w-4 h-4" /> : <SidebarClose className="w-4 h-4" />}
            </button>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-white tracking-tight truncate">{conversation.title}</h3>
              {conversation.crmRecord && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                  <Briefcase className="w-3 h-3" />
                  <span>{conversation.crmRecord.title}</span>
                  {conversation.crmRecord.value && <span>({conversation.crmRecord.value})</span>}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-400">
              <span className="flex items-center gap-1 text-[11px]">
                <Users className="w-3 h-3 text-neutral-500" />
                <span>{conversation.participants.length} participants</span>
              </span>
              <span>•</span>
              <span className="capitalize text-[11px] text-emerald-400 font-medium">{conversation.status}</span>
              {conversation.isPinned && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-0.5 text-[10px] text-amber-400">
                    <Pin className="w-2.5 h-2.5 fill-amber-400" /> Pinned
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Search within conversation toggle */}
          <button
            onClick={() => {
              setIsSearchActive(!isSearchActive);
              if (isSearchActive) setSearchInConvQuery('');
            }}
            title="Search in this conversation"
            className={`p-2 rounded-xl transition cursor-pointer ${
              isSearchActive ? 'bg-blue-600/20 text-blue-400' : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Structured Prompt Button */}
          <button
            onClick={onOpenPromptLibrary}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600/15 border border-purple-500/30 text-purple-300 hover:bg-purple-600/25 text-xs font-semibold shadow-sm transition cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>AI Prompts & SOP</span>
          </button>

          {/* Status Dropdown */}
          <select
            value={conversation.status}
            onChange={(e) => onUpdateConversationStatus(e.target.value as any)}
            className="bg-neutral-950 border border-white/10 text-xs text-neutral-300 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="open">🟢 Open</option>
            <option value="pending">🟡 Pending</option>
            <option value="resolved">🔵 Resolved</option>
          </select>

          {/* Toggle details right panel */}
          <button
            onClick={onToggleDetailsPanel}
            title={isDetailsPanelOpen ? 'Hide CRM details' : 'Show CRM details'}
            className={`p-2 rounded-xl border transition cursor-pointer ${
              isDetailsPanelOpen
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-400'
                : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white'
            }`}
          >
            <Briefcase className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* 2. SEARCH WITHIN CONVERSATION INPUT BAR              */}
      {/* ---------------------------------------------------- */}
      {isSearchActive && (
        <div className="px-5 py-2.5 bg-neutral-900 border-b border-white/10 flex items-center gap-2 animate-in slide-in-from-top-2 duration-150">
          <Search className="w-4 h-4 text-blue-400 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Filter messages in this timeline..."
            value={searchInConvQuery}
            onChange={(e) => setSearchInConvQuery(e.target.value)}
            className="flex-1 bg-transparent text-xs text-white placeholder-neutral-500 focus:outline-none"
          />
          {searchInConvQuery && (
            <span className="text-[11px] text-neutral-400 font-mono">
              {displayedMessages.length} found
            </span>
          )}
          <button
            onClick={() => {
              setIsSearchActive(false);
              setSearchInConvQuery('');
            }}
            className="p-1 rounded text-neutral-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 3. PINNED MESSAGES BANNER                            */}
      {/* ---------------------------------------------------- */}
      {pinnedMessages.length > 0 && (
        <div className="px-5 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2 truncate">
            <Pin className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
            <span className="font-semibold text-amber-400">Pinned:</span>
            <span className="truncate text-amber-200/90 font-medium">
              "{pinnedMessages[0].content || pinnedMessages[0].structuredPrompt?.title || 'Pinned Item'}"
            </span>
          </div>
          {onTogglePinMessage && (
            <button
              onClick={() => onTogglePinMessage(pinnedMessages[0].id)}
              className="text-[10px] text-amber-400 hover:text-white underline cursor-pointer ml-3 shrink-0"
            >
              Unpin
            </button>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 4. MAIN MESSAGE TIMELINE                             */}
      {/* ---------------------------------------------------- */}
      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-5">
        {displayedMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-500">
            <Sparkles className="w-10 h-10 text-purple-400/40 mb-3" />
            <h4 className="text-sm font-semibold text-neutral-300 mb-1">
              {searchInConvQuery ? 'No matching messages' : 'Conversation Room Started'}
            </h4>
            <p className="text-xs text-neutral-500 max-w-sm">
              {searchInConvQuery
                ? 'Try a different search keyword.'
                : 'Send a message, drag and drop documents, or trigger an enterprise AI prompt blueprint.'}
            </p>
          </div>
        ) : (
          displayedMessages.map((msg, index) => {
            const isMe = msg.senderId === currentUser.id || msg.senderType === 'user';
            const isInternal = msg.isInternalNote;
            const prevMsg = displayedMessages[index - 1];
            const isFirstOfGroup = !prevMsg || prevMsg.senderId !== msg.senderId;

            const showDateSeparator =
              !prevMsg ||
              new Date(prevMsg.createdAt).toDateString() !== new Date(msg.createdAt).toDateString();

            const isEditing = editingMessageId === msg.id;

            return (
              <React.Fragment key={msg.id}>
                {showDateSeparator && (
                  <div className="flex items-center justify-center my-4">
                    <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">
                      {formatDateSeparator(msg.createdAt)}
                    </span>
                  </div>
                )}

                {/* Message Item */}
                <div
                  className={`group relative flex flex-col ${
                    isInternal ? 'items-center my-2' : isMe ? 'items-end' : 'items-start'
                  }`}
                >
                  {/* Internal Note Banner */}
                  {isInternal ? (
                    <div className="w-full max-w-xl p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs shadow-sm space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-amber-400">
                        <span className="flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5" />
                          Internal Team Note (Private to CRM Agents)
                        </span>
                        <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="text-amber-100 whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ) : msg.contentType === 'crm_activity' ? (
                    /* CRM Activity Audit Pill */
                    <div className="w-full max-w-lg p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 text-blue-200 text-xs shadow-sm flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 shrink-0">
                          <CheckSquare className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-semibold text-white">{msg.crmActivityData?.targetTitle || msg.content}</p>
                          {msg.crmActivityData?.details && (
                            <p className="text-[11px] text-neutral-400">{msg.crmActivityData.details}</p>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-neutral-500 shrink-0">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ) : msg.contentType === 'ai_response' && msg.aiResponseData ? (
                    /* AI Copilot Response Card */
                    <div className="w-full max-w-2xl p-4 rounded-2xl bg-neutral-900/90 border border-purple-500/30 shadow-xl space-y-3">
                      <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400">
                            <Bot className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="text-xs font-bold text-white flex items-center gap-1.5">
                              Gemini CRM Copilot
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                {msg.aiResponseData.model}
                              </span>
                            </span>
                            <span className="text-[10px] text-neutral-400 block">
                              Executed for: "{msg.aiResponseData.promptUsed}"
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-[10px] text-neutral-400">
                          <span className="flex items-center gap-1">
                            <Cpu className="w-3 h-3 text-purple-400" />
                            {msg.aiResponseData.tokensUsed} tokens
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-neutral-500" />
                            {msg.aiResponseData.executionTimeMs}ms
                          </span>
                        </div>
                      </div>

                      <div className="text-xs text-neutral-200 leading-relaxed whitespace-pre-wrap font-sans">
                        {msg.aiResponseData.generatedText}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[11px]">
                        <span className="text-emerald-400 font-medium flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Human Verified Output
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onOpenConvertToTask(msg)}
                            className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white flex items-center gap-1 cursor-pointer"
                          >
                            <CheckSquare className="w-3 h-3 text-amber-400" />
                            <span>Convert to CRM Task</span>
                          </button>
                          {onAddNote && (
                            <button
                              onClick={() => onAddNote(msg.aiResponseData?.generatedText || msg.content)}
                              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white flex items-center gap-1 cursor-pointer"
                            >
                              <Bookmark className="w-3 h-3 text-blue-400" />
                              <span>Log as Note</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Standard Message Bubble Container */
                    <div
                      className={`flex gap-2.5 max-w-[85%] md:max-w-[75%] ${
                        isMe ? 'flex-row-reverse' : 'flex-row'
                      }`}
                    >
                      {/* Avatar */}
                      {isFirstOfGroup ? (
                        <img
                          src={
                            msg.senderAvatar ||
                            initialsAvatar(msg.senderName)
                          }
                          alt={msg.senderName}
                          className="w-8 h-8 rounded-xl object-cover ring-1 ring-white/10 shrink-0 mt-1"
                        />
                      ) : (
                        <div className="w-8 shrink-0" />
                      )}

                      <div className="flex flex-col min-w-0">
                        {/* Sender name & time */}
                        {isFirstOfGroup && (
                          <div
                            className={`flex items-center gap-2 mb-1 px-1 text-[11px] ${
                              isMe ? 'justify-end text-neutral-400' : 'text-neutral-400'
                            }`}
                          >
                            <span className="font-semibold text-neutral-200">{msg.senderName}</span>
                            <span className="text-[10px] text-neutral-500">
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {msg.isPinned && (
                              <span className="flex items-center gap-0.5 text-[9px] text-amber-400 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                                <Pin className="w-2.5 h-2.5 fill-amber-400" /> Pinned
                              </span>
                            )}
                          </div>
                        )}

                        {/* Quoted Reply context if present */}
                        {msg.replyTo && (
                          <div className="mb-1.5 p-2 rounded-lg bg-white/5 border-l-2 border-blue-500 text-[11px] text-neutral-300 max-w-md">
                            <span className="font-semibold text-blue-400 block">{msg.replyTo.senderName}:</span>
                            <span className="italic line-clamp-1">{msg.replyTo.contentSnippet}</span>
                          </div>
                        )}

                        {/* Content Card by Type */}
                        <div
                          className={`relative rounded-2xl p-3.5 text-xs shadow-md transition-all ${
                            isMe
                              ? 'bg-blue-600 text-white rounded-tr-sm'
                              : 'bg-neutral-900 border border-white/10 text-neutral-200 rounded-tl-sm'
                          }`}
                        >
                          {/* Inline Edit Form */}
                          {isEditing ? (
                            <div className="space-y-2 min-w-[280px]">
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                className="w-full bg-neutral-950 border border-white/20 rounded-lg p-2 text-xs text-white focus:outline-none"
                                rows={3}
                              />
                              <div className="flex justify-end gap-2 text-xs">
                                <button
                                  onClick={() => setEditingMessageId(null)}
                                  className="px-2 py-1 rounded bg-white/10 text-neutral-300 hover:text-white"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => {
                                    if (onEditMessage && editingText.trim()) {
                                      onEditMessage(msg.id, editingText.trim());
                                    }
                                    setEditingMessageId(null);
                                  }}
                                  className="px-3 py-1 rounded bg-blue-500 text-white font-medium"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {/* Structured Prompt Card */}
                              {msg.contentType === 'prompt' && msg.structuredPrompt ? (
                                <div className="space-y-3 min-w-[280px] max-w-md text-left">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-semibold text-purple-300 bg-purple-500/20 px-2 py-0.5 rounded-full border border-purple-400/30">
                                      ✨ {msg.structuredPrompt.category}
                                    </span>
                                    {msg.structuredPrompt.modelSuggestion && (
                                      <span className="text-[10px] font-mono text-purple-200/80">
                                        {msg.structuredPrompt.modelSuggestion}
                                      </span>
                                    )}
                                  </div>
                                  <h4 className="text-sm font-bold text-white tracking-tight">
                                    {msg.structuredPrompt.title}
                                  </h4>
                                  <p className="text-xs text-purple-100/90">{msg.structuredPrompt.goal}</p>

                                  <div className="p-3 rounded-xl bg-neutral-950/80 border border-white/10 text-xs font-mono text-neutral-300 whitespace-pre-wrap leading-relaxed">
                                    {msg.structuredPrompt.template}
                                  </div>

                                  <div className="flex items-center justify-between gap-2 pt-1">
                                    <button
                                      onClick={() => {
                                        navigator.clipboard?.writeText(msg.structuredPrompt?.template || '');
                                      }}
                                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium flex items-center gap-1 transition cursor-pointer"
                                    >
                                      <Copy className="w-3 h-3" />
                                      <span>Copy Template</span>
                                    </button>

                                    {onExecuteAi && (
                                      <button
                                        onClick={() => onExecuteAi(msg.structuredPrompt!)}
                                        className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold flex items-center gap-1 shadow-md shadow-purple-600/30 transition cursor-pointer"
                                      >
                                        <Zap className="w-3 h-3" />
                                        <span>Execute with Copilot</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : msg.contentType === 'instruction' && msg.structuredInstruction ? (
                                /* Structured SOP Checklist */
                                <div className="space-y-3 min-w-[280px] max-w-md text-left">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-semibold text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-400/30">
                                      📋 {msg.structuredInstruction.sopCategory}
                                    </span>
                                    <span className="text-[10px] text-neutral-400">Interactive Checklist</span>
                                  </div>
                                  <h4 className="text-sm font-bold text-white">{msg.structuredInstruction.title}</h4>

                                  <div className="space-y-1.5">
                                    {msg.structuredInstruction.steps.map((step) => {
                                      const isDone = instructionState[step.id] ?? step.completed;
                                      return (
                                        <label
                                          key={step.id}
                                          className={`flex items-start gap-2 p-2 rounded-lg border transition cursor-pointer ${
                                            isDone
                                              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                                              : 'bg-white/5 border-white/5 text-neutral-200 hover:bg-white/10'
                                          }`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isDone}
                                            onChange={() =>
                                              setInstructionState((prev) => ({
                                                ...prev,
                                                [step.id]: !isDone
                                              }))
                                            }
                                            className="mt-0.5 rounded border-white/20 text-emerald-600 focus:ring-0"
                                          />
                                          <div className="flex-1 text-xs">
                                            <span className={isDone ? 'line-through opacity-70' : ''}>
                                              {step.text}
                                            </span>
                                            {step.assignee && (
                                              <span className="block text-[10px] text-neutral-400 mt-0.5">
                                                Assigned: {step.assignee}
                                              </span>
                                            )}
                                          </div>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : msg.contentType === 'file' ? (
                                /* Document / File Attachment */
                                <div className="space-y-2 min-w-[240px]">
                                  <p className="text-xs leading-relaxed">{msg.content}</p>
                                  <div className="p-3 rounded-xl bg-neutral-950/60 border border-white/10 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 shrink-0">
                                        <FileText className="w-5 h-5" />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-xs font-semibold text-white truncate">
                                          {msg.attachmentName || 'Shared Document.pdf'}
                                        </p>
                                        <p className="text-[10px] text-neutral-400">{msg.attachmentSize || '2.4 MB'}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        onClick={() =>
                                          onPreviewDocument({
                                            name: msg.attachmentName || 'Document.pdf',
                                            url: msg.attachmentUrl,
                                            size: msg.attachmentSize,
                                            mime: msg.attachmentMime,
                                            senderName: msg.senderName,
                                            timestamp: new Date(msg.createdAt).toLocaleTimeString()
                                          })
                                        }
                                        className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
                                        title="Preview Document"
                                      >
                                        <Eye className="w-3.5 h-3.5" />
                                      </button>
                                      {msg.attachmentUrl && (
                                        <a
                                          href={msg.attachmentUrl}
                                          download={msg.attachmentName}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="p-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition cursor-pointer"
                                          title="Download"
                                        >
                                          <Download className="w-3.5 h-3.5" />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                /* Standard Text */
                                <p className="whitespace-pre-wrap leading-relaxed break-words">{msg.content}</p>
                              )}

                              {msg.isEdited && (
                                <span className="text-[9px] opacity-70 block mt-1 text-right italic">(edited)</span>
                              )}
                            </>
                          )}
                        </div>

                        {/* Reaction Badges */}
                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5 px-1">
                            {msg.reactions.map((r) => {
                              const hasReacted = r.userIds.includes(currentUser.id);
                              return (
                                <button
                                  key={r.emoji}
                                  onClick={() => onToggleReaction(msg.id, r.emoji)}
                                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition cursor-pointer ${
                                    hasReacted
                                      ? 'bg-blue-600/30 border-blue-500/50 text-white font-bold'
                                      : 'bg-white/5 border-white/10 text-neutral-300 hover:bg-white/10'
                                  }`}
                                >
                                  <span>{r.emoji}</span>
                                  <span className="text-[10px] font-mono">{r.userIds.length}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Hover Actions Toolbar */}
                  {!isInternal && !isEditing && msg.contentType !== 'crm_activity' && (
                    <div
                      className={`absolute top-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center gap-1 p-1 rounded-xl bg-neutral-900 border border-white/15 shadow-xl z-20 ${
                        isMe ? 'right-12 -translate-y-3' : 'left-12 -translate-y-3'
                      }`}
                    >
                      {/* Emoji trigger */}
                      <div className="relative">
                        <button
                          onClick={() =>
                            setShowEmojiPickerForMsgId(showEmojiPickerForMsgId === msg.id ? null : msg.id)
                          }
                          title="Add Reaction"
                          className="p-1 rounded-lg text-neutral-400 hover:text-amber-400 hover:bg-white/10 transition cursor-pointer"
                        >
                          <Smile className="w-3.5 h-3.5" />
                        </button>
                        {showEmojiPickerForMsgId === msg.id && (
                          <div className="absolute left-0 bottom-8 bg-neutral-900 border border-white/15 rounded-xl shadow-2xl p-1.5 flex gap-1 z-30 animate-in zoom-in-95">
                            {EMOJI_OPTIONS.map((em) => (
                              <button
                                key={em}
                                onClick={() => {
                                  onToggleReaction(msg.id, em);
                                  setShowEmojiPickerForMsgId(null);
                                }}
                                className="p-1 text-sm hover:scale-125 transition transform cursor-pointer"
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Reply */}
                      <button
                        onClick={() =>
                          setActiveReply({
                            messageId: msg.id,
                            senderName: msg.senderName,
                            contentSnippet: msg.content.slice(0, 80)
                          })
                        }
                        title="Reply / Quote"
                        className="p-1 rounded-lg text-neutral-400 hover:text-blue-400 hover:bg-white/10 transition cursor-pointer"
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>

                      {/* Convert to CRM Task */}
                      <button
                        onClick={() => onOpenConvertToTask(msg)}
                        title="Convert to CRM Task"
                        className="p-1 rounded-lg text-neutral-400 hover:text-amber-400 hover:bg-white/10 transition cursor-pointer"
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                      </button>

                      {/* Add as Note */}
                      {onAddNote && (
                        <button
                          onClick={() => onAddNote(msg.content)}
                          title="Log as CRM Note"
                          className="p-1 rounded-lg text-neutral-400 hover:text-blue-400 hover:bg-white/10 transition cursor-pointer"
                        >
                          <Bookmark className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Pin Message */}
                      {onTogglePinMessage && (
                        <button
                          onClick={() => onTogglePinMessage(msg.id)}
                          title={msg.isPinned ? 'Unpin message' : 'Pin message'}
                          className={`p-1 rounded-lg transition cursor-pointer ${
                            msg.isPinned ? 'text-amber-400' : 'text-neutral-400 hover:text-amber-400 hover:bg-white/10'
                          }`}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Edit (own message) */}
                      {isMe && onEditMessage && (
                        <button
                          onClick={() => {
                            setEditingMessageId(msg.id);
                            setEditingText(msg.content);
                          }}
                          title="Edit Message"
                          className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Delete */}
                      {(isMe || currentUser.role === 'admin') && onDeleteMessage && (
                        <button
                          onClick={() => onDeleteMessage(msg.id)}
                          title="Delete Message"
                          className="p-1 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Copy */}
                      <button
                        onClick={() => navigator.clipboard?.writeText(msg.content)}
                        title="Copy text"
                        className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ---------------------------------------------------- */}
      {/* 5. MENTION AUTOCOMPLETE POPUP                        */}
      {/* ---------------------------------------------------- */}
      {showMentionPicker && (
        <div className="absolute left-6 bottom-24 z-30 w-64 bg-neutral-900 border border-white/15 rounded-xl shadow-2xl p-1.5 animate-in slide-in-from-bottom-2">
          <p className="text-[10px] font-semibold text-neutral-400 px-2 py-1 uppercase tracking-wider">
            Mention CRM Teammate
          </p>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {registeredAgents
              .filter((u) => !mentionQuery || u.name.toLowerCase().includes(mentionQuery.toLowerCase()))
              .map((u) => (
                <button
                  key={u.id}
                  onClick={() => handleSelectMention(u)}
                  className="w-full text-left p-1.5 rounded-lg hover:bg-white/10 flex items-center gap-2 cursor-pointer text-xs text-white"
                >
                  <img src={u.avatar || initialsAvatar(u.name)} alt={u.name} className="w-5 h-5 rounded-full object-cover" />
                  <span className="font-medium truncate">{u.name}</span>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 6. CANNED SHORTCUT AUTOCOMPLETE                      */}
      {/* ---------------------------------------------------- */}
      {showCannedDropdown && (
        <div className="absolute left-6 bottom-24 z-30 w-80 bg-neutral-900 border border-white/15 rounded-xl shadow-2xl p-2 animate-in slide-in-from-bottom-2">
          <p className="text-[10px] font-semibold text-neutral-400 px-2 py-1 uppercase tracking-wider">
            Insert Canned Response
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {cannedResponses.map((cr) => (
              <button
                key={cr.id}
                onClick={() => handleInsertCanned(cr.content)}
                className="w-full text-left p-2 rounded-lg hover:bg-white/10 text-xs text-white cursor-pointer"
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-blue-400">{cr.shortcut}</span>
                  <span className="text-[10px] text-neutral-500">{cr.category}</span>
                </div>
                <p className="text-[11px] text-neutral-300 line-clamp-1">{cr.content}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 7. MESSAGE COMPOSER                                  */}
      {/* ---------------------------------------------------- */}
      <div className="p-4 border-t border-white/5 bg-neutral-900/60 backdrop-blur-xl shrink-0 space-y-2">
        {/* Upload Progress Bar */}
        {uploadProgress !== null && (
          <div className="p-2 rounded-xl bg-blue-600/10 border border-blue-500/20 text-xs text-blue-300 space-y-1.5 animate-in fade-in">
            <div className="flex justify-between items-center text-[10px] font-semibold">
              <span className="flex items-center gap-1.5">
                <FileUp className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                Encrypting & Uploading CRM Document to Vault...
              </span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-neutral-900 h-1.5 rounded-full overflow-hidden">
              <div
                style={{ width: `${uploadProgress}%` }}
                className="bg-blue-500 h-full transition-all duration-200"
              />
            </div>
          </div>
        )}

        {/* Reply Preview Bar */}
        {activeReply && (
          <div className="p-2 rounded-xl bg-blue-600/15 border border-blue-500/30 flex items-center justify-between text-xs text-blue-300">
            <div className="flex items-center gap-2 truncate">
              <CornerUpLeft className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="font-semibold text-white">Replying to {activeReply.senderName}:</span>
              <span className="truncate italic text-neutral-300">"{activeReply.contentSnippet}"</span>
            </div>
            <button
              onClick={() => setActiveReply(null)}
              className="p-1 rounded text-neutral-400 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Internal note mode indicator */}
        {isInternalNote && (
          <div className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center gap-2 text-xs font-semibold text-amber-300">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span>Posting as Internal Team Note — will be highlighted yellow and not shown to clients</span>
          </div>
        )}

        {/* Hidden File Picker Input */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileInputChange}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp"
        />

        {/* Textarea Input Form */}
        <div
          className={`flex items-end gap-2 p-2 rounded-2xl border transition-all ${
            isInternalNote
              ? 'bg-amber-950/20 border-amber-500/40 focus-within:border-amber-400'
              : 'bg-neutral-950 border-white/10 focus-within:border-blue-500'
          }`}
        >
          {/* Action icon buttons */}
          <div className="flex items-center gap-1 text-neutral-400 pb-1">
            {/* Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach Business Document or Drag & Drop (PDF, DOCX, XLSX, Images)"
              className="p-2 rounded-xl hover:text-white hover:bg-white/10 transition cursor-pointer"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Structured Prompt Button */}
            <button
              type="button"
              onClick={onOpenPromptLibrary}
              title="Open Structured Prompts & SOP Checklists"
              className="p-2 rounded-xl hover:text-purple-400 hover:bg-purple-500/10 transition cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-purple-400" />
            </button>

            {/* Quick Emoji Tray Trigger */}
            <button
              type="button"
              onClick={() => setShowComposerEmojiTray(!showComposerEmojiTray)}
              title="Add Emoji"
              className="p-2 rounded-xl hover:text-amber-400 hover:bg-white/10 transition cursor-pointer"
            >
              <Smile className="w-4 h-4" />
            </button>

            {/* Internal Note Toggle */}
            <button
              type="button"
              onClick={() => setIsInternalNote(!isInternalNote)}
              title={isInternalNote ? 'Switch to client response' : 'Switch to internal note'}
              className={`p-2 rounded-xl transition cursor-pointer ${
                isInternalNote ? 'bg-amber-500 text-neutral-950 font-bold' : 'hover:text-white hover:bg-white/10'
              }`}
            >
              <Lock className="w-4 h-4" />
            </button>
          </div>

          {/* Text Area: Enter = send, Shift + Enter = new line */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isInternalNote
                ? 'Type internal note for CRM team... (Enter to post, Shift+Enter for new line)'
                : 'Write a message... (Enter to send, Shift+Enter for new line, @ to mention, / for canned snippets)'
            }
            className="flex-1 bg-transparent text-xs text-white placeholder-neutral-500 resize-none max-h-32 focus:outline-none py-2"
          />

          {/* Send Button */}
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputText.trim()}
            className={`p-2.5 rounded-xl transition cursor-pointer flex items-center justify-center shrink-0 ${
              inputText.trim()
                ? isInternalNote
                  ? 'bg-amber-500 hover:bg-amber-400 text-neutral-950 shadow-lg shadow-amber-500/20'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30'
                : 'bg-white/5 text-neutral-600 cursor-not-allowed'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        {/* Emoji Tray Popup */}
        {showComposerEmojiTray && (
          <div className="flex items-center gap-1.5 p-2 bg-neutral-950 rounded-xl border border-white/10 text-base">
            {EMOJI_OPTIONS.map((em) => (
              <button
                key={em}
                onClick={() => {
                  setInputText((prev) => prev + em);
                  setShowComposerEmojiTray(false);
                }}
                className="p-1 hover:scale-125 transition transform cursor-pointer"
              >
                {em}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
