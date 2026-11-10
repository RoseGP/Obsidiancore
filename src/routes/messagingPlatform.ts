import { Router, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { getDocStore } from '../server/data/docStore';
import { generateAIResponse, providerStatus, AIProviderError } from '../services/ai/aiService';

const router = Router();

/**
 * Tenancy. Website visitors use only the public widget/visitor paths; everything else requires a signed-in
 * member, and every conversation (and its messages, tasks, notes) is visible only inside its organization.
 * TO COMPLETE (Phase A2, item 4): conversations are still kept in memory and lost on restart.
 */
const PUBLIC_PATHS = [/^\/widgets\/[^/]+$/, /^\/visitor-init$/, /^\/visitor-message$/, /^\/visitor-messages\/[^/]+$/, /^\/embed(\/.*)?$/];
router.use((req, res, next) => {
  const isPublic = PUBLIC_PATHS.some((r) => r.test(req.path)) && !(req.path.startsWith('/widgets/') && req.method !== 'GET');
  return isPublic ? next() : requireTenant(req, res, next);
});
const orgOf = (req: Request) => tenantOf(req).orgId;
/** The signed-in team member, for authorship (never taken from the request body). */
const me = (req: Request) => { const t = tenantOf(req); return { id: t.userId, name: t.name || t.email || 'Team member' }; };
const canModerate = (req: Request) => ['OWNER', 'ADMIN'].includes(tenantOf(req).role);

// Domain Interfaces
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: 'admin' | 'agent' | 'visitor';
  status: 'online' | 'busy' | 'away' | 'offline';
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
  orgId?: string;
  title: string;
  category: string;
  goal: string;
  instructions: string[];
  template: string;
  modelSuggestion?: string;
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
  steps: InstructionStep[];
  notes?: string;
}

export interface CrmRecordReference {
  type: 'contact' | 'company' | 'deal' | 'ticket' | 'task' | 'project';
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

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: 'user' | 'visitor' | 'bot' | 'system' | 'ai';
  senderName: string;
  senderAvatar?: string;
  content: string;
  contentType: 'text' | 'voice' | 'file' | 'image' | 'canned' | 'prompt' | 'instruction' | 'crm_activity' | 'task_reference' | 'ai_response';
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: string;
  attachmentMime?: string;
  voiceDuration?: number;
  reactions?: MessageReaction[];
  /** For contentType 'ai_response': what produced it (rendered by ChatDetailColumn). */
  aiResponseData?: { promptUsed: string; model: string; generatedText: string; tokensUsed?: number; [k: string]: unknown };
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
  status: 'sending' | 'sent' | 'delivered' | 'read';
  createdAt: string;
}

export interface ConversationRecord {
  id: string;
  /** Organization that owns this conversation (tenancy). */
  orgId?: string;
  type: 'direct' | 'group' | 'crm_linked' | 'internal' | 'widget' | 'support';
  channel: 'widget' | 'internal' | 'email' | 'sms' | 'crm';
  title: string;
  participantIds: string[];
  participants: UserRecord[];
  visitorMetadata?: VisitorMetadata;
  lastMessage?: MessageRecord;
  unreadCount: number;
  status: 'open' | 'pending' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignedTo?: string;
  tags: string[];
  widgetKey?: string;
  isPinned?: boolean;
  crmRecord?: CrmRecordReference;
  pinnedMessageIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WidgetRecord {
  widgetKey: string;
  orgId?: string;
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

// Registered Enterprise Agents & CRM Users
// TO COMPLETE: look up workspace members from your user directory (Firebase Auth / users collection).
export const REGISTERED_USERS: UserRecord[] = [];

// CRM records a conversation can link to come from the organization's leads and deals
// (organizations/{orgId}/leads|deals): see crmRecordRefs() and GET /crm-records.
const leadRef = (l: any): CrmRecordReference => ({ type: 'contact', id: String(l.id), title: l.name || l.email || 'Lead', subtitle: l.email || undefined, status: l.status || undefined, companyName: l.company || undefined });
const dealRef = (d: any): CrmRecordReference => ({ type: 'deal', id: String(d.id), title: d.title || d.name || 'Deal', value: d.value != null ? String(d.value) : undefined, status: d.stage || d.status || undefined, companyName: d.company || d.client || undefined });

/** One lead or deal of this organization as a link target (null if it isn't in the organization). */
async function crmRecordRef(orgId: string, recordId: string, type?: string): Promise<CrmRecordReference | null> {
  if (typeof recordId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(recordId)) return null;
  const st = await getDocStore();
  if (type !== 'deal') {
    const lead = await st.get(`organizations/${orgId}/leads/${recordId}`);
    if (lead) return leadRef({ ...lead, id: lead.id ?? recordId });
  }
  if (type !== 'contact') {
    const deal = await st.get(`organizations/${orgId}/deals/${recordId}`);
    if (deal) return dealRef({ ...deal, id: deal.id ?? recordId });
  }
  return null;
}

// In-Memory Fallback & Real-time State Stores
const CONVERSATIONS: Map<string, ConversationRecord> = new Map();

/** Any /conversations/:id… route: the conversation must belong to the caller's organization. */
router.param('id', (req, res, next, id) => {
  const c = CONVERSATIONS.get(String(id));
  if (!c || c.orgId !== orgOf(req)) return res.status(404).json({ success: false, error: 'Conversation not found' });
  next();
});
const MESSAGES: Map<string, MessageRecord[]> = new Map();
const WIDGETS: Map<string, WidgetRecord> = new Map();
const CRM_TASKS: Map<string, CrmTaskRecord[]> = new Map();
const CRM_ACTIVITIES: Map<string, CrmActivityLog[]> = new Map();

// Structured Prompt Templates Library
export const STRUCTURED_PROMPTS: StructuredPromptData[] = [
  {
    title: 'Answer a question about security',
    category: 'Security & Compliance',
    goal: 'Reply to a customer who asks how their data is protected, using only facts your team has confirmed.',
    instructions: [
      'Thank the customer for the question.',
      'Describe only the security measures and certifications your organization actually has.',
      'Offer a follow-up call with the right person on your team.'
    ],
    template: `Hi {{client_name}},

Thanks for asking about security. Here is how we protect {{company_name}}'s data:
{{security_summary}}

Happy to set up a short call with our team if you'd like more detail.`,
    modelSuggestion: 'gemini-2.5-flash',
    parameters: { client_name: '', company_name: '', security_summary: '' }
  },
  {
    title: 'Discovery questions',
    category: 'Sales Qualification',
    goal: 'Learn budget, decision makers, needs and timeline before a demo.',
    instructions: [
      'Ask which tools they use today.',
      'Ask how many people would use the product.',
      'Ask who decides and when they want to start.'
    ],
    template: `Hi {{client_name}},

So we can tailor the demo to {{company_name}}, could you tell us:
- How many people on your team would use it?
- Which tools do you use today?
- Who is involved in the decision, and when would you like to start?

Thanks!`,
    modelSuggestion: 'gemini-2.5-flash',
    parameters: { client_name: '', company_name: '' }
  },
  {
    title: 'Meeting follow-up',
    category: 'Customer Success',
    goal: 'Summarize a meeting: decisions, action items with owners and dates.',
    instructions: [
      'List the key decisions.',
      'List each action item with an owner and a due date.',
      'Link any document that needs review.'
    ],
    template: `Hi {{client_name}},

Thanks for today's meeting about {{project_name}}. Summary:

**Decisions:**
{{decisions}}

**Action items:**
{{action_items}}`,
    modelSuggestion: 'gemini-2.5-pro',
    parameters: { client_name: '', project_name: '', decisions: '', action_items: '' }
  }
];

// Canned responses: starting points each team edits to match what it actually offers.
const CANNED_RESPONSES = [
  { id: 'cr-1', shortcut: '/thanks', title: 'Thanks, we\'re on it', content: 'Thanks for reaching out. We\'re looking into this and will get back to you shortly.', category: 'General' },
  { id: 'cr-2', shortcut: '/demo', title: 'Offer a demo', content: 'Would you like a short demo this week? Let me know a time that works for you.', category: 'Sales' },
  { id: 'cr-3', shortcut: '/followup', title: 'Follow up', content: 'Just following up on my last message. Is there anything else I can help with?', category: 'General' },
  { id: 'cr-4', shortcut: '/close', title: 'Close the conversation', content: 'Glad we could help. If anything else comes up, just reply here.', category: 'General' }
];

// No built-in widget: each organization creates its own in Widget Studio.

// ----------------------------------------------------
// SEED RICH CRM CONVERSATIONS
// ----------------------------------------------------

// 1. CRM-Linked Deal Room (Group Conversation)
// TO COMPLETE: conversations and messages are created through POST /conversations and the website
// widget (no seed data). They are kept in memory (CONVERSATIONS/MESSAGES/CRM_TASKS/CRM_ACTIVITIES Maps) and
// are lost on restart: persist them in your database (e.g. Firestore conversations/{id}/messages).

const sseClients: Map<string, { res: Response; orgId: string }> = new Map();

/** Sends an event only to the organization that owns it (fails closed when the owner is unknown). */
// ----------------------------------------------------
// PERSISTENCE (organizations/{orgId}/inbox_*): loaded per organization on first use,
// changed documents written back after each request. Data survives restarts.
// One server instance serves the inbox (live updates are in-process), so the cache stays authoritative.
// ----------------------------------------------------
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const loaded = new Map<string, Promise<void>>();
const written = new Map<string, { org: string; json: string }>();
const flushing = new Map<string, Promise<void>>();
const convPath = (o: string, c: string) => `organizations/${o}/inbox_conversations/${c}`;

function remember(path: string, org: string, v: unknown) { written.set(path, { org, json: JSON.stringify(v) }); }

/** Loads one organization's inbox into memory (once). */
export function hydrateInbox(orgId: string): Promise<void> {
  if (!SAFE_ID.test(orgId)) return Promise.resolve();
  let p = loaded.get(orgId);
  if (!p) {
    p = (async () => {
      const st = await getDocStore();
      const base = `organizations/${orgId}`;
      for (const c of await st.list(`${base}/inbox_conversations`)) {
        if (!c?.id || !SAFE_ID.test(c.id)) continue;
        const conv = { ...c, orgId } as ConversationRecord;
        CONVERSATIONS.set(conv.id, conv); remember(convPath(orgId, conv.id), orgId, conv);
        const msgs = (await st.list(`${convPath(orgId, conv.id)}/messages`)) as MessageRecord[];
        msgs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        MESSAGES.set(conv.id, msgs);
        for (const m of msgs) remember(`${convPath(orgId, conv.id)}/messages/${m.id}`, orgId, m);
        const meta = await st.get(`${convPath(orgId, conv.id)}/meta/crm`);
        if (meta) {
          CRM_TASKS.set(conv.id, meta.tasks || []); CRM_ACTIVITIES.set(conv.id, meta.activities || []);
          remember(`${convPath(orgId, conv.id)}/meta/crm`, orgId, { tasks: meta.tasks || [], activities: meta.activities || [] });
        }
        if (conv.type === 'widget') remember(`inbox_visitor_conversations/${conv.id}`, orgId, { orgId });
      }
      for (const w of await st.list(`${base}/inbox_widgets`)) {
        if (!w?.widgetKey || !SAFE_ID.test(w.widgetKey)) continue;
        WIDGETS.set(w.widgetKey, { ...w, orgId }); remember(`${base}/inbox_widgets/${w.widgetKey}`, orgId, { ...w, orgId });
        remember(`inbox_widget_keys/${w.widgetKey}`, orgId, { orgId });
      }
      const lib = await st.get(`${base}/inbox_settings/library`);
      if (lib) {
        for (const pr of lib.prompts || []) STRUCTURED_PROMPTS.push({ ...pr, orgId });
        for (const cr of lib.cannedResponses || []) CANNED_RESPONSES.push({ ...cr, orgId });
        remember(`${base}/inbox_settings/library`, orgId, { prompts: lib.prompts || [], cannedResponses: lib.cannedResponses || [] });
      }
    })();
    p.catch(() => loaded.delete(orgId));
    loaded.set(orgId, p);
  }
  return p;
}

/** Loads the organization that owns a widget key or a visitor conversation (public routes). */
async function hydrateFromIndex(kind: 'inbox_widget_keys' | 'inbox_visitor_conversations', id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !SAFE_ID.test(id)) return null;
  const idx = await (await getDocStore()).get(`${kind}/${id}`);
  if (!idx?.orgId) return null;
  await hydrateInbox(idx.orgId);
  return idx.orgId;
}

async function flushNow(orgId: string) {
  const st = await getDocStore();
  const base = `organizations/${orgId}`;
  const want = new Map<string, unknown>();
  for (const c of CONVERSATIONS.values()) {
    if (c.orgId !== orgId || !SAFE_ID.test(c.id)) continue;
    want.set(convPath(orgId, c.id), c);
    for (const m of MESSAGES.get(c.id) || []) if (SAFE_ID.test(m.id)) want.set(`${convPath(orgId, c.id)}/messages/${m.id}`, m);
    const tasks = CRM_TASKS.get(c.id) || [], activities = CRM_ACTIVITIES.get(c.id) || [];
    if (tasks.length || activities.length) want.set(`${convPath(orgId, c.id)}/meta/crm`, { tasks, activities });
    if (c.type === 'widget') want.set(`inbox_visitor_conversations/${c.id}`, { orgId });
  }
  for (const w of WIDGETS.values()) {
    if (w.orgId !== orgId || !SAFE_ID.test(w.widgetKey)) continue;
    want.set(`${base}/inbox_widgets/${w.widgetKey}`, w);
    want.set(`inbox_widget_keys/${w.widgetKey}`, { orgId });
  }
  const prompts = STRUCTURED_PROMPTS.filter((x) => x.orgId === orgId);
  const cannedResponses = CANNED_RESPONSES.filter((x: any) => x.orgId === orgId);
  if (prompts.length || cannedResponses.length) want.set(`${base}/inbox_settings/library`, { prompts, cannedResponses });

  for (const [path, v] of want) {
    const json = JSON.stringify(v);
    if (written.get(path)?.json === json) continue;
    await st.set(path, JSON.parse(json));
    written.set(path, { org: orgId, json });
  }
  for (const [path, w] of [...written]) {
    if (w.org !== orgId || want.has(path)) continue;
    await st.deleteRecursive(path);
    written.delete(path);
  }
}

/** Writes an organization's changed inbox documents; calls for the same organization run one at a time. */
export function flushInbox(orgId: string): Promise<void> {
  const prev = flushing.get(orgId) || Promise.resolve();
  const next = prev.then(() => flushNow(orgId)).catch((err) => { console.error('[inbox] save failed:', err?.code || err?.name || 'error'); });
  flushing.set(orgId, next);
  return next;
}

/** Test helper: forget the in-memory cache (as after a restart). */
export function resetInboxCacheForTests() {
  for (const m of [CONVERSATIONS, MESSAGES, WIDGETS, CRM_TASKS, CRM_ACTIVITIES, loaded, written, flushing]) (m as Map<any, any>).clear();
  for (const arr of [STRUCTURED_PROMPTS, CANNED_RESPONSES] as any[][]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].orgId) arr.splice(i, 1);
}

/**
 * Inbox service figures for the dashboard (read-only). For conversations whose first visitor/contact
 * message falls in the window: the first team reply after it gives the first-response time; a
 * conversation still unanswered after the target counts as a miss, one still within the target isn't
 * measured yet. AI and system messages and internal notes don't count as a reply.
 */
export async function inboxServiceStats(orgId: string, sinceMs: number, slaTargetMinutes: number, now: number = Date.now()) {
  await hydrateInbox(orgId);
  const responseMinutes: number[] = [];
  let measured = 0, met = 0, unanswered = 0;
  const at = (m: MessageRecord) => Date.parse(String(m.createdAt));
  for (const c of CONVERSATIONS.values()) {
    if (c.orgId !== orgId) continue;
    const msgs = (MESSAGES.get(c.id) || []).filter((m) => !m.isInternalNote && (m.senderType === 'visitor' || m.senderType === 'user'))
      .sort((a, b) => at(a) - at(b));
    const last = msgs[msgs.length - 1];
    if ((c.status === 'open' || c.status === 'pending') && last?.senderType === 'visitor') unanswered++;
    const first = msgs.find((m) => m.senderType === 'visitor' && at(m) >= sinceMs);
    if (!first) continue;
    const reply = msgs.find((m) => m.senderType === 'user' && at(m) >= at(first));
    if (reply) {
      const mins = (at(reply) - at(first)) / 60_000;
      responseMinutes.push(mins); measured++;
      if (mins <= slaTargetMinutes) met++;
    } else if (now - at(first) > slaTargetMinutes * 60_000) {
      measured++; // unanswered past the target: a miss
    }
  }
  const hasActiveWidget = [...WIDGETS.values()].some((w) => w.orgId === orgId && w.isActive);
  return {
    measured, met, unanswered, hasActiveWidget,
    avgFirstResponseMinutes: responseMinutes.length ? responseMinutes.reduce((a, b) => a + b, 0) / responseMinutes.length : null,
  };
}

/** Recent inbox messages (newest last) for summaries; internal notes excluded. Read-only. */
export async function recentInboxMessages(orgId: string, sinceMs: number, limit = 200) {
  await hydrateInbox(orgId);
  const out: { conversation: string; channel: string; from: string; senderType: string; text: string; at: string }[] = [];
  for (const c of CONVERSATIONS.values()) {
    if (c.orgId !== orgId) continue;
    for (const m of MESSAGES.get(c.id) || []) {
      if (m.isInternalNote || Date.parse(String(m.createdAt)) < sinceMs) continue;
      out.push({ conversation: c.title, channel: c.channel, from: m.senderName, senderType: m.senderType, text: String(m.content || '').slice(0, 500), at: m.createdAt });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(-limit);
}

/**
 * Inbox messages grouped by the customer's email (visitor email or participant email), oldest first.
 * Used by lead intelligence to read a lead's communication history. Internal notes are excluded.
 */
export async function inboxMessagesByEmail(orgId: string) {
  await hydrateInbox(orgId);
  const out = new Map<string, { at: string; fromCustomer: boolean; text: string; channel: string }[]>();
  for (const c of CONVERSATIONS.values()) {
    if (c.orgId !== orgId) continue;
    const emails = new Set<string>();
    if (c.visitorMetadata?.email) emails.add(String(c.visitorMetadata.email).toLowerCase());
    for (const p of c.participants || []) if (p?.role === 'visitor' && p.email) emails.add(String(p.email).toLowerCase());
    if (!emails.size) continue;
    const msgs = (MESSAGES.get(c.id) || []).filter((m) => !m.isInternalNote).map((m) => ({
      at: String(m.createdAt), fromCustomer: m.senderType === 'visitor', text: String(m.content || '').slice(0, 1000), channel: c.channel,
    }));
    for (const e of emails) out.set(e, [...(out.get(e) || []), ...msgs].sort((a, b) => a.at.localeCompare(b.at)));
  }
  return out;
}

// Load the caller's organization before any route runs, and save its changes afterwards.
router.use(async (req, res, next) => {
  try {
    let orgId: string | null = null;
    if ((req as any).tenant) orgId = orgOf(req);
    else if (req.path.startsWith('/widgets/')) orgId = await hydrateFromIndex('inbox_widget_keys', req.path.split('/')[2]);
    else if (req.path === '/visitor-init') orgId = await hydrateFromIndex('inbox_widget_keys', req.body?.widgetKey);
    else if (req.path === '/visitor-message') orgId = await hydrateFromIndex('inbox_visitor_conversations', req.body?.conversationId);
    else if (req.path.startsWith('/visitor-messages/')) orgId = await hydrateFromIndex('inbox_visitor_conversations', req.path.split('/')[2]);
    if (orgId) {
      await hydrateInbox(orgId);
      if (req.path !== '/stream') res.on('finish', () => { void flushInbox(orgId!); });
    }
    next();
  } catch (err) { sendError(res, err, 'messaging.load'); }
});

function broadcastEvent(eventName: string, payload: any, orgIdHint?: string) {
  const orgId = orgIdHint ?? payload?.orgId ?? CONVERSATIONS.get(payload?.conversationId ?? payload?.id)?.orgId;
  if (!orgId) return;
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach((client, clientId) => {
    if (client.orgId !== orgId) return;
    try {
      client.res.write(data);
    } catch {
      sseClients.delete(clientId);
    }
  });
}

// ----------------------------------------------------
// REST ENDPOINTS: REAL-TIME STREAM
// ----------------------------------------------------
router.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  sseClients.set(clientId, { res, orgId: orgOf(req) });

  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, timestamp: new Date().toISOString() })}\n\n`);

  req.on('close', () => {
    sseClients.delete(clientId);
  });
});

// ----------------------------------------------------
// CONVERSATIONS API
// ----------------------------------------------------
router.get('/conversations', async (req: Request, res: Response) => {
  try {
    const { type, channel, status, search } = req.query;
    const orgId = orgOf(req);
    let list = Array.from(CONVERSATIONS.values()).filter((c) => c.orgId === orgId);

    if (type) {
      list = list.filter((c) => c.type === type);
    }
    if (channel) {
      list = list.filter((c) => c.channel === channel);
    }
    if (status) {
      list = list.filter((c) => c.status === status);
    }
    if (search) {
      const q = String(search).toLowerCase();
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.visitorMetadata?.email?.toLowerCase().includes(q) ||
          c.crmRecord?.title.toLowerCase().includes(q) ||
          c.tags.some((t) => t.toLowerCase().includes(q))
      );
    }

    // Sort pinned first, then newest updated
    list.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    res.json({
      success: true,
      count: list.length,
      conversations: list
    });
  } catch (err: any) {
    sendError(res, err, 'messaging');
  }
});

router.post('/conversations', async (req: Request, res: Response) => {
  try {
    const { type, channel, title, participantIds, priority, tags, visitorMetadata, crmRecord } = req.body;
    const convId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const participants = (participantIds || []).map((id: string) => {
      const existing = REGISTERED_USERS.find((u) => u.id === id);
      if (existing) return existing;
      return {
        id,
        name: 'Contact',
        email: '',
        avatar: '',
        role: 'visitor' as const,
        status: 'online' as const
      };
    });

    const newConv: ConversationRecord = {
      id: convId,
      orgId: orgOf(req),
      type: type || 'direct',
      channel: channel || 'internal',
      title: title || 'New Conversation',
      participantIds: participantIds?.length ? participantIds : [me(req).id],
      participants: participants.length > 0 ? participants : [{ id: me(req).id, name: me(req).name, email: tenantOf(req).email, avatar: '', role: 'admin' as const, status: 'online' as const }],
      visitorMetadata: visitorMetadata || undefined,
      // Resolve the link from this organization's records; never trust a snapshot sent by the client.
      crmRecord: crmRecord?.id ? (await crmRecordRef(orgOf(req), String(crmRecord.id), crmRecord.type)) ?? undefined : undefined,
      unreadCount: 0,
      status: 'open',
      priority: priority || 'medium',
      assignedTo: me(req).id,
      tags: tags || ['General'],
      pinnedMessageIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    CONVERSATIONS.set(convId, newConv);
    MESSAGES.set(convId, []);

    broadcastEvent('conversation_created', newConv);

    res.status(201).json({ success: true, conversation: newConv });
  } catch (err: any) {
    sendError(res, err, 'messaging');
  }
});

router.get('/conversations/:id', (req: Request, res: Response) => {
  const conv = CONVERSATIONS.get(req.params.id);
  if (!conv) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }
  res.json({ success: true, conversation: conv });
});

router.patch('/conversations/:id', (req: Request, res: Response) => {
  const conv = CONVERSATIONS.get(req.params.id);
  if (!conv) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  const { status, priority, assignedTo, tags, title, crmRecord, isPinned } = req.body;
  if (status !== undefined) conv.status = status;
  if (priority !== undefined) conv.priority = priority;
  if (assignedTo !== undefined) conv.assignedTo = assignedTo;
  if (tags !== undefined) conv.tags = tags;
  if (title !== undefined) conv.title = title;
  if (crmRecord !== undefined) conv.crmRecord = crmRecord;
  if (isPinned !== undefined) conv.isPinned = isPinned;
  conv.updatedAt = new Date().toISOString();

  CONVERSATIONS.set(conv.id, conv);

  broadcastEvent('conversation_updated', conv);

  res.json({ success: true, conversation: conv });
});

// Pin / Unpin Conversation
router.post('/conversations/:id/pin', (req: Request, res: Response) => {
  const conv = CONVERSATIONS.get(req.params.id);
  if (!conv) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }
  conv.isPinned = !conv.isPinned;
  conv.updatedAt = new Date().toISOString();
  CONVERSATIONS.set(conv.id, conv);
  broadcastEvent('conversation_updated', conv);
  res.json({ success: true, isPinned: conv.isPinned });
});

// Mark Conversation as Unread / Read
router.post('/conversations/:id/toggle-read', (req: Request, res: Response) => {
  const conv = CONVERSATIONS.get(req.params.id);
  if (!conv) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }
  conv.unreadCount = conv.unreadCount > 0 ? 0 : 1;
  conv.updatedAt = new Date().toISOString();
  CONVERSATIONS.set(conv.id, conv);
  broadcastEvent('conversation_updated', conv);
  res.json({ success: true, unreadCount: conv.unreadCount });
});

router.delete('/conversations/:id', (req: Request, res: Response) => {
  const convId = req.params.id;
  const existed = CONVERSATIONS.has(convId);
  if (!existed) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  const ownerOrg = CONVERSATIONS.get(convId)?.orgId;
  CONVERSATIONS.delete(convId);
  MESSAGES.delete(convId);

  broadcastEvent('conversation_deleted', { conversationId: convId }, ownerOrg);

  res.json({ success: true, message: 'Conversation profile deleted', id: convId });
});

// ----------------------------------------------------
// MESSAGES API
// ----------------------------------------------------
router.get('/conversations/:id/messages', (req: Request, res: Response) => {
  const convId = req.params.id;
  const list = MESSAGES.get(convId) || [];

  const conv = CONVERSATIONS.get(convId);
  if (conv && conv.unreadCount > 0) {
    conv.unreadCount = 0;
    CONVERSATIONS.set(convId, conv);
  }

  res.json({ success: true, messages: list });
});

router.post('/conversations/:id/messages', (req: Request, res: Response) => {
  const convId = req.params.id;
  const conv = CONVERSATIONS.get(convId);
  if (!conv) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  const {
    senderId,
    senderType,
    senderName,
    senderAvatar,
    content,
    contentType,
    attachmentUrl,
    attachmentName,
    attachmentSize,
    attachmentMime,
    voiceDuration,
    isInternalNote,
    replyTo,
    structuredPrompt,
    structuredInstruction,
    crmActivityData
  } = req.body;

  if (!content && !attachmentUrl && !voiceDuration && !structuredPrompt && !structuredInstruction) {
    return res.status(400).json({ success: false, error: 'Message content is required' });
  }

  const msgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const newMsg: MessageRecord = {
    id: msgId,
    conversationId: convId,
    senderId: me(req).id,
    senderType: senderType === 'system' ? 'system' : 'user',
    senderName: me(req).name,
    senderAvatar: typeof senderAvatar === 'string' && /^https:\/\//.test(senderAvatar) ? senderAvatar : '',
    content: content || '',
    contentType: contentType || 'text',
    attachmentUrl,
    attachmentName,
    attachmentSize,
    attachmentMime,
    voiceDuration,
    isInternalNote: !!isInternalNote,
    isPinned: false,
    replyTo,
    structuredPrompt,
    structuredInstruction,
    crmActivityData,
    status: 'sent',
    reactions: [],
    createdAt: new Date().toISOString()
  };

  const msgs = MESSAGES.get(convId) || [];
  msgs.push(newMsg);
  MESSAGES.set(convId, msgs);

  conv.lastMessage = newMsg;
  conv.updatedAt = newMsg.createdAt;
  CONVERSATIONS.set(convId, conv);

  broadcastEvent('new_message', { conversationId: convId, message: newMsg });

  res.status(201).json({ success: true, message: newMsg });
});

// Edit Message (Author or Admin)
router.patch('/conversations/:id/messages/:msgId', (req: Request, res: Response) => {
  const { id: convId, msgId } = req.params;
  const { content } = req.body;

  const msgs = MESSAGES.get(convId);
  if (!msgs) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  const msg = msgs.find((m) => m.id === msgId);
  if (!msg) {
    return res.status(404).json({ success: false, error: 'Message not found' });
  }

  if (msg.senderId !== me(req).id && !canModerate(req)) {
    return res.status(403).json({ success: false, error: 'Unauthorized to edit this message' });
  }

  msg.content = content;
  msg.isEdited = true;
  msg.editedAt = new Date().toISOString();

  broadcastEvent('message_updated', { conversationId: convId, message: msg });

  res.json({ success: true, message: msg });
});

// Delete Message
router.delete('/conversations/:id/messages/:msgId', (req: Request, res: Response) => {
  const { id: convId, msgId } = req.params;

  const msgs = MESSAGES.get(convId);
  if (!msgs) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  const index = msgs.findIndex((m) => m.id === msgId);
  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Message not found' });
  }
  if (msgs[index].senderId !== me(req).id && !canModerate(req)) {
    return res.status(403).json({ success: false, error: 'Only the author or an admin can delete this message.' });
  }

  msgs.splice(index, 1);
  MESSAGES.set(convId, msgs);

  broadcastEvent('message_deleted', { conversationId: convId, messageId: msgId });

  res.json({ success: true, messageId: msgId });
});

// Pin / Unpin Message
router.post('/conversations/:id/messages/:msgId/pin', (req: Request, res: Response) => {
  const { id: convId, msgId } = req.params;
  const conv = CONVERSATIONS.get(convId);
  const msgs = MESSAGES.get(convId);
  if (!conv || !msgs) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  const msg = msgs.find((m) => m.id === msgId);
  if (!msg) {
    return res.status(404).json({ success: false, error: 'Message not found' });
  }

  msg.isPinned = !msg.isPinned;
  conv.pinnedMessageIds = conv.pinnedMessageIds || [];

  if (msg.isPinned) {
    if (!conv.pinnedMessageIds.includes(msgId)) {
      conv.pinnedMessageIds.push(msgId);
    }
  } else {
    conv.pinnedMessageIds = conv.pinnedMessageIds.filter((id) => id !== msgId);
  }

  broadcastEvent('message_updated', { conversationId: convId, message: msg });
  broadcastEvent('conversation_updated', conv);

  res.json({ success: true, isPinned: msg.isPinned, pinnedMessageIds: conv.pinnedMessageIds });
});

// Toggle reaction
router.post('/conversations/:id/messages/:msgId/reaction', (req: Request, res: Response) => {
  const { id: convId, msgId } = req.params;
  const { emoji } = req.body;
  const userId = me(req).id;

  const msgs = MESSAGES.get(convId);
  if (!msgs) {
    return res.status(404).json({ success: false, error: 'Conversation messages not found' });
  }

  const msg = msgs.find((m) => m.id === msgId);
  if (!msg) {
    return res.status(404).json({ success: false, error: 'Message not found' });
  }

  msg.reactions = msg.reactions || [];
  const existingReaction = msg.reactions.find((r) => r.emoji === emoji);

  if (existingReaction) {
    if (existingReaction.userIds.includes(userId)) {
      existingReaction.userIds = existingReaction.userIds.filter((uid) => uid !== userId);
      if (existingReaction.userIds.length === 0) {
        msg.reactions = msg.reactions.filter((r) => r.emoji !== emoji);
      }
    } else {
      existingReaction.userIds.push(userId);
    }
  } else {
    msg.reactions.push({ emoji, userIds: [userId] });
  }

  broadcastEvent('reaction_toggled', { conversationId: convId, messageId: msgId, reactions: msg.reactions });

  res.json({ success: true, reactions: msg.reactions });
});

// ----------------------------------------------------
// CRM INTEGRATION: TASKS, NOTES, AND ACTIVITIES
// ----------------------------------------------------
router.get('/conversations/:id/tasks', (req: Request, res: Response) => {
  const tasks = CRM_TASKS.get(req.params.id) || [];
  res.json({ success: true, tasks });
});

router.post('/conversations/:id/tasks', (req: Request, res: Response) => {
  const convId = req.params.id;
  const { title, priority, dueDate, assignee, sourceMessageId, contactName } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, error: 'Task title is required' });
  }

  const taskId = `task_${Date.now()}`;
  const newTask: CrmTaskRecord = {
    id: taskId,
    title,
    status: 'pending',
    priority: priority || 'medium',
    dueDate: dueDate || new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
    assignee: assignee || me(req).name,
    conversationId: convId,
    sourceMessageId,
    contactName: contactName || 'CRM Lead',
    createdAt: new Date().toISOString()
  };

  const tasks = CRM_TASKS.get(convId) || [];
  tasks.unshift(newTask);
  CRM_TASKS.set(convId, tasks);

  // Automatically insert a system activity message in the conversation timeline
  const systemMsgId = `msg_act_${Date.now()}`;
  const systemMsg: MessageRecord = {
    id: systemMsgId,
    conversationId: convId,
    senderId: 'system',
    senderType: 'system',
    senderName: 'CRM Automations',
    content: `Converted to CRM Task: "${title}" • Assigned to ${newTask.assignee}`,
    contentType: 'crm_activity',
    crmActivityData: {
      action: 'task_created',
      targetTitle: title,
      details: `Due: ${newTask.dueDate} • Priority: ${newTask.priority.toUpperCase()}`
    },
    status: 'delivered',
    createdAt: new Date().toISOString()
  };

  const msgs = MESSAGES.get(convId) || [];
  msgs.push(systemMsg);
  MESSAGES.set(convId, msgs);

  // Log activity
  const activities = CRM_ACTIVITIES.get(convId) || [];
  activities.unshift({
    id: `act_${Date.now()}`,
    type: 'task_created',
    title: `Task Created: ${title}`,
    description: `Assigned to ${newTask.assignee} (Due ${newTask.dueDate})`,
    actorName: me(req).name,
    timestamp: 'Just now'
  });
  CRM_ACTIVITIES.set(convId, activities);

  broadcastEvent('task_created', { conversationId: convId, task: newTask });
  broadcastEvent('new_message', { conversationId: convId, message: systemMsg });

  res.status(201).json({ success: true, task: newTask, message: systemMsg });
});

router.patch('/conversations/:id/tasks/:taskId', (req: Request, res: Response) => {
  const { id: convId, taskId } = req.params;
  const { status, priority, assignee, dueDate } = req.body;

  const tasks = CRM_TASKS.get(convId) || [];
  const task = tasks.find((t) => t.id === taskId);
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  if (status) task.status = status;
  if (priority) task.priority = priority;
  if (assignee) task.assignee = assignee;
  if (dueDate) task.dueDate = dueDate;

  broadcastEvent('task_updated', { conversationId: convId, task });
  res.json({ success: true, task });
});

router.get('/conversations/:id/activities', (req: Request, res: Response) => {
  const activities = CRM_ACTIVITIES.get(req.params.id) || [];
  res.json({ success: true, activities });
});

// Add CRM Note
router.post('/conversations/:id/notes', (req: Request, res: Response) => {
  const convId = req.params.id;
  const { note } = req.body;

  if (!note) {
    return res.status(400).json({ success: false, error: 'Note text is required' });
  }

  const activities = CRM_ACTIVITIES.get(convId) || [];
  activities.unshift({
    id: `act_${Date.now()}`,
    type: 'note_added',
    title: 'CRM Note Added',
    description: note,
    actorName: me(req).name,
    timestamp: 'Just now'
  });
  CRM_ACTIVITIES.set(convId, activities);

  res.status(201).json({ success: true, message: 'CRM Note logged successfully' });
});

// Link / Update CRM Record
router.post('/conversations/:id/link-crm', async (req: Request, res: Response) => {
  try {
    const convId = req.params.id;
    const conv = CONVERSATIONS.get(convId); // router.param('id') already checked it belongs to this organization
    if (!conv) return res.status(404).json({ success: false, error: 'Conversation not found' });
    const { recordId, type } = req.body ?? {};
    if (recordId === null) {
      conv.crmRecord = undefined;
    } else {
      const targetRecord = await crmRecordRef(orgOf(req), recordId, typeof type === 'string' ? type : undefined);
      if (!targetRecord) return res.status(404).json({ success: false, error: 'CRM record not found in this organization.' });
      conv.crmRecord = targetRecord;
    }
    conv.updatedAt = new Date().toISOString();
    CONVERSATIONS.set(convId, conv);
    broadcastEvent('conversation_updated', conv);
    res.json({ success: true, conversation: conv });
  } catch (err) { sendError(res, err, 'messaging.linkCrm'); }
});

// ----------------------------------------------------
// SECURE FILE UPLOAD & VALIDATION API
// ----------------------------------------------------
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml'
]);

const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'svg'
]);

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'sh', 'php', 'js', 'py', 'cmd', 'vbs', 'msi', 'bin'
]);

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

router.post('/upload', (_req: Request, res: Response) => {
  // Files aren't stored anywhere yet; the old handler returned a storage URL for a file it never saved.
  res.status(501).json({ success: false, code: 'not_available', error: 'File attachments aren\'t available yet: connect file storage first. Share a link to the file instead.' });
});

// ----------------------------------------------------
// AI EXECUTION & WORKFLOW ENGINE API
// ----------------------------------------------------
router.post('/conversations/:id/execute-ai', async (req: Request, res: Response) => {
  const convId = req.params.id;
  const { promptTitle, promptContent, model, userInstructions, crmContext } = req.body;

  const conv = CONVERSATIONS.get(convId);
  if (!conv) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }

  const startTime = Date.now();
  const selectedModel = model || 'gemini-2.5-flash';

  try {
    // Generate context-grounded response for the CRM workflow
    const clientName = conv.crmRecord?.title || conv.title || 'Client Stakeholder';
    const company = conv.crmRecord?.companyName || 'Enterprise Account';

    // A real model (Gemini or Claude via the shared AI service), grounded only in this conversation.
    const ps = providerStatus();
    if (!ps.gemini.configured && !ps.claude.configured) {
      return res.status(503).json({ success: false, code: 'ai_not_configured', error: 'AI isn\'t set up on this server (add GEMINI_API_KEY or ANTHROPIC_API_KEY).' });
    }
    const history = (MESSAGES.get(convId) || []).filter((m) => !m.isInternalNote).slice(-40)
      .map((m) => `${m.senderName}: ${String(m.content).slice(0, 2000)}`).join('\n');
    const system = 'You help a CRM team handle a customer conversation. Use only the conversation and the CRM context given. ' +
      'Never invent facts, numbers, certifications, prices, commitments or people. If information is missing, say what is missing. Be concise.';
    const ask = [
      `Task: ${String(promptTitle || 'Help with this conversation').slice(0, 200)}`,
      promptContent ? `Instructions:\n${String(promptContent).slice(0, 4000)}` : '',
      userInstructions ? `Extra instructions from the agent:\n${String(userInstructions).slice(0, 2000)}` : '',
      `Client: ${clientName} (${company})`,
      crmContext ? `CRM context:\n${String(typeof crmContext === 'string' ? crmContext : JSON.stringify(crmContext)).slice(0, 4000)}` : '',
      `Conversation:\n${history || '(no messages yet)'}`,
    ].filter(Boolean).join('\n\n');
    let generatedText = '';
    let usedModel = selectedModel;
    try {
      const r = await generateAIResponse(ps.gemini.configured ? 'gemini' : 'claude', ask, [], { systemPrompt: system, useTools: false, fallback: true });
      generatedText = r.reply.trim();
      usedModel = r.model;
    } catch (e) {
      const msg = e instanceof AIProviderError ? e.message : 'The AI request failed.';
      return res.status(502).json({ success: false, code: 'ai_error', error: msg });
    }
    if (!generatedText) return res.status(502).json({ success: false, code: 'ai_error', error: 'The AI returned no text.' });

    const executionTimeMs = Date.now() - startTime;
    const tokensUsed = Math.floor(generatedText.length / 3.8);

    const msgId = `msg_ai_${Date.now()}`;
    const aiMessage: MessageRecord = {
      id: msgId,
      conversationId: convId,
      senderId: 'ai_copilot',
      senderType: 'system',
      senderName: 'AI assistant',
      senderAvatar: '',
      content: generatedText,
      contentType: 'ai_response',
      aiResponseData: {
        promptUsed: promptTitle || 'CRM Executive Blueprint',
        model: usedModel,
        generatedText,
        tokensUsed,
        executionTimeMs,
        status: 'completed',
        initiatedBy: tenantOf(req).name || tenantOf(req).email || 'Team member',
        // AI drafts are not reviewed by a person until someone edits or approves them.
        verifiedByHuman: false
      },
      status: 'delivered',
      createdAt: new Date().toISOString()
    };

    const msgs = MESSAGES.get(convId) || [];
    msgs.push(aiMessage);
    MESSAGES.set(convId, msgs);

    conv.lastMessage = aiMessage;
    conv.updatedAt = aiMessage.createdAt;
    CONVERSATIONS.set(convId, conv);

    // Log Activity
    const activities = CRM_ACTIVITIES.get(convId) || [];
    activities.unshift({
      id: `act_${Date.now()}`,
      type: 'ai_generated',
      title: `AI Prompt Executed: ${promptTitle || 'Executive Briefing'}`,
      description: `Model: ${selectedModel} • ${tokensUsed} tokens in ${executionTimeMs}ms`,
      actorName: 'Gemini CRM Copilot',
      timestamp: 'Just now'
    });
    CRM_ACTIVITIES.set(convId, activities);

    broadcastEvent('new_message', { conversationId: convId, message: aiMessage });
    broadcastEvent('conversation_updated', conv);

    res.status(201).json({
      success: true,
      message: aiMessage
    });
  } catch (err: any) {
    sendError(res, err, 'messaging');
  }
});

// ----------------------------------------------------
// GLOBAL CROSS-ENTITY SEARCH API
// ----------------------------------------------------
router.get('/search', (req: Request, res: Response) => {
  const q = String(req.query.q || '').trim().toLowerCase();

  if (!q) {
    return res.json({ success: true, count: 0, results: [] });
  }

  const results: Array<{
    type: 'conversation' | 'message' | 'file' | 'crm_record';
    id: string;
    conversationId: string;
    title: string;
    snippet: string;
    date: string;
    senderName?: string;
    crmRecord?: CrmRecordReference;
  }> = [];

  const orgId = orgOf(req);
  // 1. Search conversations
  CONVERSATIONS.forEach((c) => {
    if (c.orgId !== orgId) return;
    if (
      c.title.toLowerCase().includes(q) ||
      c.tags.some((t) => t.toLowerCase().includes(q)) ||
      c.crmRecord?.title.toLowerCase().includes(q)
    ) {
      results.push({
        type: 'conversation',
        id: c.id,
        conversationId: c.id,
        title: c.title,
        snippet: `Room tags: ${c.tags.join(', ')} • Priority: ${c.priority}`,
        date: c.updatedAt,
        crmRecord: c.crmRecord
      });
    }
  });

  // 2. Search messages & files
  MESSAGES.forEach((msgs, convId) => {
    const parentConv = CONVERSATIONS.get(convId);
    if (!parentConv || parentConv.orgId !== orgId) return;
    msgs.forEach((m) => {
      const matchContent = m.content.toLowerCase().includes(q);
      const matchAttachment = m.attachmentName?.toLowerCase().includes(q);
      const matchPrompt = m.structuredPrompt?.title.toLowerCase().includes(q);

      if (matchContent || matchAttachment || matchPrompt) {
        results.push({
          type: m.contentType === 'file' ? 'file' : 'message',
          id: m.id,
          conversationId: convId,
          title: parentConv?.title || 'Conversation',
          snippet: m.attachmentName ? `Attachment: ${m.attachmentName}` : m.content.slice(0, 120),
          date: m.createdAt,
          senderName: m.senderName,
          crmRecord: parentConv?.crmRecord
        });
      }
    });
  });

  res.json({ success: true, count: results.length, results });
});

// Available CRM Records for Linking
router.get('/crm-records', async (req: Request, res: Response) => {
  try {
    const st = await getDocStore();
    const orgId = orgOf(req);
    const [leads, deals] = await Promise.all([
      st.list(`organizations/${orgId}/leads`, { limit: 200 }),
      st.list(`organizations/${orgId}/deals`, { limit: 200 }),
    ]);
    const records: CrmRecordReference[] = [...leads.map(leadRef), ...deals.map(dealRef)];
    res.json({ success: true, records });
  } catch {
    res.status(500).json({ success: false, error: 'CRM records couldn\'t be loaded.' });
  }
});

// ----------------------------------------------------
// STRUCTURED PROMPTS API
// ----------------------------------------------------
router.get('/prompts', (req: Request, res: Response) => {
  const orgId = orgOf(req);
  res.json({ success: true, prompts: STRUCTURED_PROMPTS.filter((p) => !p.orgId || p.orgId === orgId) });
});

router.post('/prompts', (req: Request, res: Response) => {
  const { title, category, goal, instructions, template, modelSuggestion } = req.body;
  if (!title || !template) {
    return res.status(400).json({ success: false, error: 'Title and template are required' });
  }

  const newPrompt: StructuredPromptData = {
    orgId: orgOf(req),
    title,
    category: category || 'Custom Workflows',
    goal: goal || '',
    instructions: Array.isArray(instructions) ? instructions : [instructions],
    template,
    modelSuggestion: modelSuggestion || 'gemini-2.5-flash'
  };

  STRUCTURED_PROMPTS.push(newPrompt);
  res.status(201).json({ success: true, prompt: newPrompt });
});

// ----------------------------------------------------
// CANNED RESPONSES API
// ----------------------------------------------------
router.get('/canned-responses', (req: Request, res: Response) => {
  const orgId = orgOf(req);
  res.json({ success: true, cannedResponses: CANNED_RESPONSES.filter((c: any) => !c.orgId || c.orgId === orgId) });
});

router.post('/canned-responses', (req: Request, res: Response) => {
  const { shortcut, title, content, category } = req.body;
  if (!shortcut || !content) {
    return res.status(400).json({ success: false, error: 'Shortcut and content are required' });
  }

  const newCanned = {
    orgId: orgOf(req),
    id: `cr_${Date.now()}`,
    shortcut: shortcut.startsWith('/') ? shortcut : `/${shortcut}`,
    title: title || shortcut,
    content,
    category: category || 'General'
  };

  CANNED_RESPONSES.push(newCanned);
  res.status(201).json({ success: true, cannedResponse: newCanned });
});

// ----------------------------------------------------
// WIDGET CONFIGURATION & STUDIO API
// ----------------------------------------------------
router.get('/widgets', (req: Request, res: Response) => {
  const orgId = orgOf(req);
  res.json({
    success: true,
    widgets: Array.from(WIDGETS.values()).filter((w) => w.orgId === orgId)
  });
});

router.post('/widgets', (req: Request, res: Response) => {
  const {
    widgetKey,
    businessName,
    tagline,
    primaryColor,
    accentColor,
    greetingMessage,
    placeholderText,
    position,
    avatarUrl,
    allowedDomains,
    requireEmail,
    autoReplyMessage,
    offlineMessage,
    isActive
  } = req.body;

  const key = widgetKey || `wid_${randomBytes(9).toString('base64url')}`;
  if (!SAFE_ID.test(key)) {
    return res.status(400).json({ success: false, field: 'widgetKey', error: 'Widget keys may only contain letters, numbers, - and _.' });
  }
  const existing = WIDGETS.get(key);
  if (existing && existing.orgId !== orgOf(req)) {
    return res.status(409).json({ success: false, error: 'That widget key is already in use. Choose another.' });
  }

  const updated: WidgetRecord = {
    widgetKey: key,
    orgId: orgOf(req),
    businessName: businessName || existing?.businessName || 'Live Chat',
    tagline: tagline ?? existing?.tagline,
    primaryColor: primaryColor || existing?.primaryColor || '#2563eb',
    accentColor: accentColor || existing?.accentColor || '#3b82f6',
    greetingMessage: greetingMessage || existing?.greetingMessage || 'How can we help you?',
    placeholderText: placeholderText || existing?.placeholderText || 'Type a message...',
    position: position || existing?.position || 'bottom-right',
    avatarUrl: avatarUrl || existing?.avatarUrl || '',
    allowedDomains: allowedDomains || existing?.allowedDomains || ['*'],
    requireEmail: requireEmail !== undefined ? requireEmail : !!existing?.requireEmail,
    autoReplyMessage: autoReplyMessage || existing?.autoReplyMessage || 'Thanks for reaching out!',
    offlineMessage: offlineMessage || existing?.offlineMessage || 'We are currently offline.',
    isActive: isActive !== undefined ? isActive : (existing?.isActive ?? true),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  WIDGETS.set(key, updated);

  res.status(existing ? 200 : 201).json({ success: true, widget: updated });
});

router.get('/widgets/:key', (req: Request, res: Response) => {
  const widget = WIDGETS.get(req.params.key);
  if (!widget) {
    return res.status(404).json({ success: false, error: 'Widget configuration not found' });
  }
  res.json({ success: true, widget });
});

// ----------------------------------------------------
// VISITOR LIVE CHAT WIDGET ENDPOINTS
// ----------------------------------------------------
router.post('/visitor-init', (req: Request, res: Response) => {
  const {
    widgetKey,
    visitorId,
    visitorName,
    visitorEmail,
    currentPage,
    referrer,
    browser,
    os,
    device
  } = req.body;

  const widget = WIDGETS.get(widgetKey);
  if (!widget || !widget.orgId || widget.isActive === false) {
    return res.status(404).json({ success: false, error: 'This chat widget isn\'t available.' });
  }
  // The visitor id is the visitor's only credential for their chat: unguessable, issued here.
  const vid = typeof visitorId === 'string' && /^vis_[A-Za-z0-9_-]{20,64}$/.test(visitorId) ? visitorId : `vis_${randomBytes(18).toString('base64url')}`;
  let activeConv = Array.from(CONVERSATIONS.values()).find(
    (c) => c.orgId === widget.orgId && c.type === 'widget' && c.visitorMetadata?.visitorId === vid && c.status !== 'closed'
  );

  if (!activeConv) {
    const convId = `conv_vis_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const visName = visitorName || `Visitor #${vid.slice(-4)}`;

    activeConv = {
      id: convId,
      orgId: widget.orgId,
      type: 'widget',
      channel: 'widget',
      title: `${visName} (${currentPage ? new URL(currentPage, 'http://localhost').pathname : 'Live Chat'})`,
      participantIds: [vid],
      participants: [
        {
          id: vid,
          name: visName,
          email: visitorEmail || '',
          avatar: '',
          role: 'visitor',
          status: 'online'
        }
      ],
      visitorMetadata: {
        visitorId: vid,
        ip: req.ip || '127.0.0.1',
        currentPage,
        referrer,
        browser,
        os,
        device,
        email: visitorEmail
      },
      unreadCount: 0,
      status: 'open',
      priority: 'medium',
      assignedTo: '',
      tags: ['Website Visitor', 'Live Chat Widget'],
      widgetKey: widget.widgetKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const welcomeMsg: MessageRecord = {
      id: `msg_welcome_${Date.now()}`,
      conversationId: convId,
      senderId: 'bot',
      senderType: 'bot',
      senderName: widget.businessName,
      senderAvatar: widget.avatarUrl,
      content: widget.greetingMessage,
      contentType: 'text',
      status: 'delivered',
      createdAt: new Date().toISOString()
    };

    activeConv.lastMessage = welcomeMsg;
    CONVERSATIONS.set(convId, activeConv);
    MESSAGES.set(convId, [welcomeMsg]);

    broadcastEvent('conversation_created', activeConv);
  }

  res.json({
    success: true,
    visitorId: vid,
    conversationId: activeConv.id,
    widget,
    messages: (MESSAGES.get(activeConv.id) || []).filter((m) => !m.isInternalNote)
  });
});

router.post('/visitor-message', (req: Request, res: Response) => {
  const { conversationId, visitorId, content, visitorName } = req.body;

  if (!conversationId || !content) {
    return res.status(400).json({ success: false, error: 'conversationId and content are required' });
  }

  const conv = CONVERSATIONS.get(conversationId);
  // Only the visitor who started this chat may post to it.
  if (!conv || conv.type !== 'widget' || !visitorId || conv.visitorMetadata?.visitorId !== visitorId) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }
  if (typeof content !== 'string' || content.length > 4000) {
    return res.status(400).json({ success: false, error: 'Messages are limited to 4,000 characters.' });
  }
  const msgId = `msg_vis_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const newMsg: MessageRecord = {
    id: msgId,
    conversationId,
    senderId: visitorId || 'visitor',
    senderType: 'visitor',
    senderName: visitorName || conv.visitorMetadata?.email || 'Website Visitor',
    senderAvatar: '',
    content,
    contentType: 'text',
    status: 'delivered',
    createdAt: new Date().toISOString()
  };

  const msgs = MESSAGES.get(conversationId) || [];
  msgs.push(newMsg);
  MESSAGES.set(conversationId, msgs);

  conv.lastMessage = newMsg;
  conv.unreadCount = (conv.unreadCount || 0) + 1;
  conv.updatedAt = newMsg.createdAt;
  CONVERSATIONS.set(conversationId, conv);

  broadcastEvent('new_message', { conversationId, message: newMsg });
  broadcastEvent('conversation_updated', conv);

  res.status(201).json({ success: true, message: newMsg });
});

router.get('/visitor-messages/:conversationId', (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const conv = CONVERSATIONS.get(conversationId);
  if (!conv || conv.type !== 'widget' || conv.visitorMetadata?.visitorId !== String(req.query.visitorId || '')) {
    return res.status(404).json({ success: false, error: 'Conversation not found' });
  }
  const msgs = MESSAGES.get(conversationId) || [];
  const publicMsgs = msgs.filter((m) => !m.isInternalNote);
  res.json({ success: true, messages: publicMsgs });
});



export default router;
