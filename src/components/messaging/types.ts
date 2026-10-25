export type UserRole = 'admin' | 'agent' | 'visitor';
export type UserStatus = 'online' | 'busy' | 'away' | 'offline';
export type ConversationType = 'direct' | 'group' | 'crm_linked' | 'internal' | 'widget' | 'support';
export type ConversationChannel = 'widget' | 'internal' | 'email' | 'sms' | 'crm';
export type ConversationStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type ConversationPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface MessagingUser {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: UserRole;
  status: UserStatus;
  lastSeen?: string;
  department?: string;
}

export interface VisitorMetadata {
  visitorId: string;
  ip?: string;
  city?: string;
  country?: string;
  browser?: string;
  os?: string;
  device?: string;
  currentPage?: string;
  referrer?: string;
  sessionDuration?: string;
  email?: string;
}

export interface MessageReaction {
  emoji: string;
  userIds: string[];
}

export interface MessageReplyContext {
  messageId: string;
  senderName: string;
  contentSnippet: string;
  contentType?: string;
}

export interface StructuredPromptData {
  title: string;
  category: string;
  goal: string;
  instructions: string[];
  template: string;
  contextCrmRecord?: string;
  modelSuggestion?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  assignedUser?: string;
  parameters?: Record<string, string>;
}

export interface InstructionStep {
  id: string;
  text: string;
  completed: boolean;
  assignee?: string;
}

export interface StructuredInstructionData {
  title: string;
  sopCategory: string;
  contextCrmRecord?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  assignedUser?: string;
  steps: InstructionStep[];
  notes?: string;
}

export interface AiResponseData {
  promptUsed: string;
  model: string;
  generatedText: string;
  tokensUsed?: number;
  executionTimeMs?: number;
  status: 'completed' | 'in_progress' | 'failed';
  error?: string;
  initiatedBy: string;
  verifiedByHuman?: boolean;
}

export interface CrmRecordReference {
  type: 'contact' | 'company' | 'lead' | 'deal' | 'ticket' | 'task' | 'project';
  id: string;
  title: string;
  subtitle?: string;
  value?: string;
  status?: string;
  companyName?: string;
  linkUrl?: string;
}

export interface CrmTaskRecord {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  assignee?: string;
  conversationId?: string;
  sourceMessageId?: string;
  contactName?: string;
  createdAt: string;
}

export interface CrmActivityLog {
  id: string;
  type: 'task_created' | 'note_added' | 'file_shared' | 'status_changed' | 'prompt_executed' | 'ai_generated';
  title: string;
  description: string;
  actorName: string;
  timestamp: string;
}

export interface MessagingMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: 'user' | 'visitor' | 'bot' | 'system' | 'ai';
  senderName: string;
  senderAvatar?: string;
  content: string;
  contentType:
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
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: string;
  attachmentMime?: string;
  voiceDuration?: number;
  reactions?: MessageReaction[];
  isInternalNote?: boolean;
  isPinned?: boolean;
  isEdited?: boolean;
  editedAt?: string;
  replyTo?: MessageReplyContext;
  structuredPrompt?: StructuredPromptData;
  structuredInstruction?: StructuredInstructionData;
  crmActivityData?: {
    action: string;
    targetTitle: string;
    details?: string;
  };
  aiResponseData?: AiResponseData;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  createdAt: string;
}

export interface MessagingConversation {
  id: string;
  type: ConversationType;
  channel: ConversationChannel;
  title: string;
  participantIds: string[];
  participants: MessagingUser[];
  visitorMetadata?: VisitorMetadata;
  lastMessage?: MessagingMessage;
  unreadCount: number;
  status: ConversationStatus;
  priority: ConversationPriority;
  assignedTo?: string; // agent user ID
  tags: string[];
  widgetKey?: string;
  isPinned?: boolean;
  crmRecord?: CrmRecordReference;
  pinnedMessageIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WidgetConfig {
  widgetKey: string;
  businessName: string;
  tagline?: string;
  primaryColor: string;
  accentColor?: string;
  greetingMessage: string;
  placeholderText: string;
  position: 'bottom-right' | 'bottom-left';
  avatarUrl: string;
  allowedDomains: string[];
  requireEmail: boolean;
  autoReplyMessage: string;
  offlineMessage: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CannedResponse {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string;
}

export type MessagingPlatformView = 'inbox' | 'direct' | 'visitors' | 'studio' | 'canned' | 'crm_linked' | 'prompts';
