import { Router, Request, Response } from 'express';
import { assertId, getDocStore } from '../server/data/docStore';
import { requirePermission, requireReadOrWrite, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { ChatMessageItem } from '../types';
import { AIProviderError, generateAIResponse } from '../services/ai/aiService';
import { buildAssistantPrompt } from '../services/assistantPrompt';
import { processCRMBrainChat, CRMBrainChatParams as CRMBrainChatInput, CRMBrainChatResult as CRMBrainChatOutput } from '../services/crmBrain';
import {
  handleChatCompletions,
  handleGetModels,
  handleGetGatewayStatus
} from '../controllers/omniRouteChatController';

const router = Router();

// Every chat route acts for a signed-in member of an organization.
// Asking the assistant is a read: read-only members can use it (its tools enforce write permission
// themselves). Other chat routes need write access for anything that changes data.
router.use(requireTenant, (req, res, next) => (/\/completions$/.test(req.path) ? requirePermission('read')(req, res, next) : requireReadOrWrite(req, res, next)));

// ============================================================================
// OMNIROUTE AI GATEWAY ENDPOINTS (SSE STREAMING & RESILIENCE)
// ============================================================================
// Primary endpoint: POST /api/chat/completions
router.post('/completions', handleChatCompletions);
router.post('/chat/completions', handleChatCompletions);
router.get('/models', handleGetModels);
router.get('/gateway/status', handleGetGatewayStatus);

// Fallback / standard lead context
const DEFAULT_LEAD_CONTEXT = {
  id: '1',
  name: 'Marcus Chen',
  company: 'Alpha Tech Cloud Inc.',
  title: 'VP of Infrastructure & Enterprise Systems',
  email: 'marcus.c@alpha-tech.cloud',
  phone: '+1 (555) 234-5678',
  channel: 'Direct Messaging / Email',
  status: 'Active Lead (SLA Negotiation Phase)',
  sentiment: 'Positive (High Intent)',
  lastMessage: "Let's finalize the SLA scope next Tuesday.",
  pipelineValue: '$120,000 ARR',
  notes: 'Looking for multi-channel CRM automation with low-latency failovers. Prefers direct, concise communication.',
};

/** The verified caller. Client-supplied ids are ignored. */
async function getOrProvisionUserId(req: Request, _ignored?: string): Promise<string> {
  return tenantOf(req).userId;
}

/** organizations/{orgId}/chat_sessions/{sessionId}: sessions are private to their user. */
function sessionPath(req: Request, sessionId: string) {
  return `organizations/${tenantOf(req).orgId}/chat_sessions/${assertId(sessionId)}`;
}

/**
 * Loads a chat session only if it belongs to `userId`. A session owned by someone else is reported
 * exactly like a missing one, so session ids can't be probed.
 */
async function loadOwnedSession(req: Request, sessionId: string, userId: string): Promise<any | null> {
  if (!sessionId) return null;
  const st = await getDocStore();
  const s = await st.get(sessionPath(req, sessionId));
  return s && s.userId === userId ? s : null;
}

async function sessionIdTakenByOther(req: Request, sessionId: string, userId: string): Promise<boolean> {
  if (!sessionId) return false;
  const s = await (await getDocStore()).get(sessionPath(req, sessionId));
  return !!(s && s.userId !== userId);
}

/**
 * POST /api/chat
 * Main CRM AI assistant endpoint
 */
/**
 * POST /api/chat  { message, history?, provider?: 'gemini' | 'claude', preferences? }
 * Unified, non-streaming answer from the chosen provider (the other one backs it up). Responds
 * { success, provider, model, reply, finish, notice }. For streaming, use POST /api/chat/completions.
 * Requests without `provider`/`history` keep the command palette's original behavior below.
 */
async function handleUnifiedChat(req: Request, res: Response) {
  const t = tenantOf(req);
  const b = req.body || {};
  const message = typeof b.message === 'string' ? b.message.slice(0, 200_000) : '';
  if (!message.trim()) return res.status(400).json({ success: false, code: 'bad_request', error: 'Send a message.' });
  if (b.provider !== undefined && !['gemini', 'claude'].includes(b.provider)) return res.status(400).json({ success: false, code: 'bad_request', error: 'provider must be "gemini" or "claude".' });
  const history = Array.isArray(b.history) ? b.history.slice(-60) : [];
  const prefs = b.preferences || {};
  const ctrl = new AbortController();
  req.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  try {
    const { getOrg } = await import('../server/tenancy/orgs');
    const orgName = (await getOrg(t.orgId).catch(() => null))?.name || '';
    const systemPrompt = buildAssistantPrompt({
      userName: t.name || t.email, role: t.role, orgName, crmToolsEnabled: prefs.includeCrm !== false,
      length: ['concise', 'standard', 'detailed'].includes(prefs.length) ? prefs.length : 'standard',
      tone: ['executive', 'technical', 'action'].includes(prefs.tone) ? prefs.tone : 'executive',
    });
    const r = await generateAIResponse(b.provider === 'claude' ? 'claude' : 'gemini', message, history, {
      systemPrompt, context: { userId: t.userId, orgId: t.orgId, role: t.role, name: t.name || t.email }, useTools: prefs.includeCrm !== false, signal: ctrl.signal,
    });
    res.json({ success: true, provider: r.provider, model: r.model, reply: r.reply, finish: r.finish, toolCalls: r.toolCalls, notice: r.notice });
  } catch (err: any) {
    if (err instanceof AIProviderError) {
      const status = err.code === 'ai_not_configured' || err.code === 'model_unavailable' ? 503 : err.code === 'rate_limited' ? 429 : err.code === 'bad_request' ? 400 : 502;
      return res.status(status).json({ success: false, code: err.code, provider: err.provider, error: err.code === 'bad_request' ? err.message : status === 503 ? err.message : 'The AI provider couldn’t answer right now. Nothing was changed; try again.' });
    }
    return sendError(res, err, 'chat.unified');
  }
}

router.post('/', async (req: Request, res: Response, next) => {
  if (req.body && (req.body.provider !== undefined || Array.isArray(req.body.history))) return handleUnifiedChat(req, res);
  next();
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      message: rawMessage,
      prompt: rawPrompt,
      content: rawContent,
      sessionId: providedSessionId,
      userId: providedUserId,
    } = req.body;

    const incomingText = rawMessage || rawPrompt || rawContent;
    if (!incomingText || typeof incomingText !== 'string' || !incomingText.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: message (or prompt) in request body.',
      });
    }

    const userId = await getOrProvisionUserId(req, providedUserId);
    const sessionId = providedSessionId || `session_${userId}_${Date.now()}`;
    const userMessageText = incomingText.trim();
    const timestamp = new Date().toISOString();

    // 1. Fetch or initialize ChatSession from database
    if (await sessionIdTakenByOther(req, sessionId, userId)) {
      return res.status(404).json({ success: false, error: 'Chat session not found.' });
    }
    const session: any = await loadOwnedSession(req, sessionId, userId);

    let existingMessages: ChatMessageItem[] = [];
    if (session && session.messages) {
      existingMessages = Array.isArray(session.messages) ? session.messages : [];
    }

    // 2. Append incoming user message to session history
    const newUserMessage: ChatMessageItem = {
      role: 'user',
      content: userMessageText,
      timestamp,
    };

    const updatedMessages: ChatMessageItem[] = [...existingMessages, newUserMessage];

    // 3. Format conversation history for CRM Brain
    const conversationHistory: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    for (const msg of existingMessages) {
      if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
        conversationHistory.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    const leadContextToUse = req.body.leadContext || req.body.activeLead || DEFAULT_LEAD_CONTEXT;

    // 4. Send to CRM Intelligence Brain
    let assistantReply = '';
    let gatewayModelUsed = 'crm-intelligence-v3';
    let detectedAction = 'none';

    try {
      const brainResult = await processCRMBrainChat({
        leadContext: leadContextToUse,
        conversationHistory,
        incomingMessage: userMessageText,
      });

      assistantReply = brainResult.reply || '';
      gatewayModelUsed = brainResult.gatewayModelUsed || 'crm-intelligence-v3';
      detectedAction = brainResult.suggestedAction || 'none';
    } catch (aiErr: any) {
      console.warn('[AI Processing Note]:', aiErr.message);
      assistantReply = `I received your request regarding: "${userMessageText}". How would you like me to proceed with your client workflow?`;
    }

    // 5. Append assistant reply to session history
    const newAssistantMessage: ChatMessageItem = {
      role: 'assistant',
      content: assistantReply,
      timestamp: new Date().toISOString(),
    };

    const finalMessages: ChatMessageItem[] = [...updatedMessages, newAssistantMessage];

    // 6. Save updated ChatSession record
    const savedSession = {
      sessionId, userId, orgId: tenantOf(req).orgId, messages: finalMessages,
      createdAt: session?.createdAt || timestamp, updatedAt: new Date().toISOString(),
    };
    await (await getDocStore()).set(sessionPath(req, sessionId), savedSession);

    // 7. Parse CRM command metadata for dashboard integration
    const lower = userMessageText.toLowerCase();
    let type: 'text' | 'command' = 'text';
    let action: 'email_draft' | 'initialize_video_call' | 'voice_hub' | 'enterprise_proposals' | 'home' | 'none' = 'none';
    let params: any = {};

    if (lower.includes('email') || lower.includes('draft') || lower.includes('mail')) {
      type = 'command';
      action = 'email_draft';
      params = {
        recipient: leadContextToUse?.name || 'Marcus Chen',
        subject: 'Omnichannel CRM Platform Alignment & SLA Scope',
        body: `Hi,\n\nFollowing up on our CRM review, I wanted to share our latest workflow analytics and proposal details.\n\nBest regards,\nCRM Lead`,
      };
    } else if (lower.includes('video') || lower.includes('call') || lower.includes('webrtc')) {
      type = 'command';
      action = 'initialize_video_call';
      params = { contactId: '1' };
    } else if (lower.includes('proposal') || lower.includes('deal') || lower.includes('contract')) {
      type = 'command';
      action = 'enterprise_proposals';
    } else if (lower.includes('voice') || lower.includes('dialer')) {
      type = 'command';
      action = 'voice_hub';
    } else if (lower.includes('home') || lower.includes('dashboard')) {
      type = 'command';
      action = 'home';
    }

    return res.status(200).json({
      success: true,
      sessionId,
      userId,
      reply: assistantReply,
      message: assistantReply,
      role: 'assistant',
      modelUsed: gatewayModelUsed,
      messages: finalMessages,
      type,
      action,
      params,
      session: savedSession,
    });
  } catch (error: any) {
    return sendError(res, error, 'POST /api/chat Error');
  }
});

/**
 * POST /api/chat/brain
 */
router.post('/brain', async (req: Request, res: Response) => {
  try {
    const { leadContext, conversationHistory, incomingMessage } = req.body;

    if (!incomingMessage || typeof incomingMessage !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing incomingMessage in request body.',
      });
    }

    const result = await processCRMBrainChat({
      leadContext: leadContext || DEFAULT_LEAD_CONTEXT,
      conversationHistory: conversationHistory || [],
      incomingMessage,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    return sendError(res, error, 'POST /api/chat/brain Error');
  }
});

/**
 * GET /api/chat/sessions
 */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const userId = await getOrProvisionUserId(req);
    const sessions = await (await getDocStore()).list(`organizations/${tenantOf(req).orgId}/chat_sessions`, { where: [['userId', '==', userId]] });

    return res.status(200).json({
      success: true,
      userId,
      sessions,
    });
  } catch (error: any) {
    return sendError(res, error, 'GET /api/chat/sessions Error');
  }
});

/**
 * GET /api/chat/session/:sessionId
 */
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = await getOrProvisionUserId(req);
    const session = await loadOwnedSession(req, sessionId, userId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Chat session not found.' });
    }

    return res.status(200).json({
      success: true,
      session,
      messages: session.messages || [],
    });
  } catch (error: any) {
    return sendError(res, error, 'GET /api/chat/session/:sessionId Error');
  }
});

/**
 * DELETE /api/chat/session/:sessionId
 */
router.delete('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = await getOrProvisionUserId(req);
    const session = await loadOwnedSession(req, sessionId, userId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Chat session not found.' });
    }

    await (await getDocStore()).deleteRecursive(sessionPath(req, sessionId));

    return res.status(200).json({
      success: true,
      message: `Chat session '${sessionId}' cleared.`,
    });
  } catch (error: any) {
    return sendError(res, error, 'DELETE /api/chat/session/:sessionId Error');
  }
});

export default router;
