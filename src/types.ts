export interface CRMContact {
  id: string;
  name: string;
  avatar: string;
  channel: 'email' | 'whatsapp' | 'telegram' | 'sms' | 'instagram' | string;
  lastMessage: string;
  timestamp: string;
  unread: boolean;
  status: 'active' | 'pending' | 'resolved' | string;
  sentiment: 'positive' | 'neutral' | 'negative' | string;
  email: string;
  phone: string;
  company: string;
  title?: string;
  notes?: string;
  pipelineValue?: string;
  priority?: 'high' | 'medium' | 'low';
}

export interface CRMMessage {
  id: string;
  sender: 'user' | 'contact' | 'assistant' | 'system' | string;
  text: string;
  timestamp: string;
  subject?: string;
  channel?: 'email' | 'whatsapp' | 'telegram' | 'sms' | 'instagram' | string;
  attachments?: Array<{ name: string; size?: string; type?: string; url?: string }>;
  read?: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  time: string;
  type: 'interview' | 'task' | 'timeoff' | 'demo' | 'call' | 'contract' | string;
  contact: string;
  status: 'upcoming' | 'completed' | 'cancelled' | string;
  meetingLink?: string;
  invitees?: string;
  notes?: string;
  date?: string;
  location?: string;
  duration?: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  role?: string;
  company?: string;
  presence?: 'online' | 'busy' | 'away' | string;
  isAnonymous?: boolean;
  lastLogin?: string;
}

export type ActiveView = 
  | 'dashboard'
  | 'leads'
  | 'chat'
  | 'greet'
  | 'welcome'
  | 'messages'
  | 'email_assistant'
  | 'analytics'
  | 'settings'
  | 'calendar'
  | 'proposals'
  | 'social_planner'
  | 'gbp'
  | 'deals'
  | 'sales_pipelines'
  | 'voice_dialer'
  | 'call_canvas'
  | 'public_scheduling';

export interface LeadQualification {
  budget?: number;
  authority?: 'decision_maker' | 'influencer' | 'evaluator' | 'none' | string;
  need?: string;
  timeline?: 'immediate' | '1-3 months' | '3-6 months' | 'evaluating' | string;
}

export interface CRMLeadTask {
  id: string;
  leadId: string;
  title: string;
  dueDate: string;
  completed: boolean;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  assignedTo?: string;
  createdAt: string;
}

export interface CRMLeadActivity {
  id: string;
  leadId: string;
  type: 'created' | 'status_changed' | 'assigned' | 'updated' | 'task_created' | 'converted' | 'contacted' | string;
  title: string;
  description: string;
  actor: string;
  timestamp: string;
}

export interface CRMLead {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
  source: 'whatsapp' | 'email' | 'voice' | 'linkedin' | 'website' | 'referral' | 'inbound_call' | 'ad_campaign' | string;
  status: 'new' | 'contacted' | 'qualifying' | 'qualified' | 'unqualified' | 'converted' | string;
  owner: string;
  ownerId?: string;
  score: number;
  notes?: string;
  channel?: string;
  qualification?: LeadQualification;
  isConverted: boolean;
  convertedAt?: string;
  convertedContactId?: string;
  convertedCompanyId?: string;
  convertedDealId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  type: 'message' | 'lead' | 'task' | 'interaction' | 'meeting' | 'social' | 'proposal' | 'system' | 'call' | string;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  channel?: 'whatsapp' | 'email' | 'sms' | 'instagram' | 'telegram' | 'phone' | 'web';
  avatar?: string;
  targetView?: ActiveView;
  targetId?: string;
  metadata?: Record<string, any>;
}

export type DashboardWidgetId = 
  | 'recent_leads'
  | 'open_opportunities'
  | 'support_tickets'
  | 'sales_performance'
  | 'conversation_insights'
  | 'task_radar';

export type DashboardWidgetSize = 'normal' | 'wide' | 'full';

export interface DashboardWidgetConfig {
  id: DashboardWidgetId;
  title: string;
  description: string;
  enabled: boolean;
  order: number;
  size: DashboardWidgetSize;
  category: 'sales' | 'support' | 'leads' | 'analytics';
  icon: string;
}

export interface ChatMessageItem {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string | Date;
}

export interface ChatSessionData {
  sessionId: string;
  userId: string;
  messages: ChatMessageItem[];
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface ThreadableEmail {
  id: string;
  messageId?: string;
  subject: string;
  date: string | Date;
  inReplyTo?: string | null;
  references?: string | string[] | null;
  from?: string;
  to?: string;
  body?: string;
  threadId?: string | null;
}

export interface ChatMessage {
  id?: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: string;
  modelUsed?: string;
  isFallback?: boolean;
  fallbackReason?: string;
  provider?: string;
  latencyMs?: number;
}

export interface ChatCompletionPayload {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  fallbackChain?: string[];
  userId: string;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  simulateError?: 'none' | '429_rate_limit' | 'quota_exhausted' | 'provider_503';
}

export interface StreamDeltaChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      role?: string;
    };
    finish_reason: string | null;
  }>;
  system_notice?: {
    type: 'fallback_activated' | 'rate_limit_handled' | 'provider_switch';
    originalModel: string;
    fallbackModel: string;
    reason: string;
    code: number | string;
  };
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  contextWindow: string;
  description: string;
  isDefault?: boolean;
}

export interface GatewayStatusResponse {
  status: 'online' | 'degraded' | 'offline';
  gatewayUrl: string;
  version?: string;
  activeProvidersCount?: number;
  modelsAvailable?: number;
  activeProvider?: string;
  circuitBreakerState?: 'closed' | 'open' | 'half-open';
  totalRoutedRequests?: number;
  successfulRoutes?: number;
  fallbackExecutions?: number;
  latencyMs?: number;
  averageLatencyMs?: number;
  lastChecked?: string;
  supportedModels?: ModelOption[];
  recentIncidents?: Array<{
    timestamp: string;
    model: string;
    errorType: string;
    fallbackTarget: string;
    resolved: boolean;
  }>;
}
