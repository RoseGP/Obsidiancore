import { Router, Request, Response } from 'express';
import { db } from '../utils/db';
import { ChatMessageItem } from '../types';
import { processCRMBrainChat, CRMBrainChatParams as CRMBrainChatInput, CRMBrainChatResult as CRMBrainChatOutput } from '../services/crmBrain';
import {
  handleChatCompletions,
  handleGetModels,
  handleGetGatewayStatus
} from '../controllers/omniRouteChatController';

const router = Router();

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

// Ensure or retrieve active userId
async function getOrProvisionUserId(req: Request, fallbackId?: string): Promise<string> {
  const targetId =
    fallbackId ||
    (req as any).session?.userId ||
    (req as any).user?.id ||
    (req as any).userId ||
    req.body?.userId ||
    (req.query?.userId as string) ||
    'demo-user-123';

  if (db.user) {
    try {
      const existing = await db.user.findFirst({ where: { id: targetId } });
      if (!existing) {
        await db.user.create({
          data: {
            id: targetId,
            email: `${targetId}@flowforge.studio`,
            name: 'Executive Director',
            role: 'ADMIN',
          },
        });
      }
    } catch (e) {}
  }
  return targetId;
}

/**
 * POST /api/chat
 * Main CRM AI assistant endpoint
 */
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
    let session = null;
    if (db.chatSession) {
      try {
        session = await db.chatSession.findFirst({
          where: { sessionId },
        });
      } catch (err) {
        console.warn('[Chat DB Fetch Note]:', (err as any).message);
      }
    }

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
    let savedSession: any = null;
    if (db.chatSession) {
      try {
        savedSession = await db.chatSession.upsert({
          where: { sessionId },
          update: {
            messages: finalMessages,
            updatedAt: new Date(),
          },
          create: {
            sessionId,
            userId,
            messages: finalMessages,
          },
        });
      } catch (saveErr: any) {
        console.warn('[ChatSession DB Save Note]:', saveErr.message);
      }
    }

    // 7. Parse CRM command metadata for dashboard integration
    const lower = userMessageText.toLowerCase();
    let type: 'text' | 'command' = 'text';
    let action: 'initialize_video_call' | 'voice_hub' | 'enterprise_proposals' | 'home' | 'none' = 'none';
    let params: any = {};

    if (lower.includes('video') || lower.includes('call') || lower.includes('webrtc')) {
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
      session: savedSession || {
        sessionId,
        userId,
        messages: finalMessages,
      },
    });
  } catch (error: any) {
    console.error('[POST /api/chat Error]', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error processing chat request.',
    });
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
    console.error('[POST /api/chat/brain Error]', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error processing CRM Brain Chat.',
    });
  }
});

/**
 * GET /api/chat/sessions
 */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const userId = await getOrProvisionUserId(req);
    let sessions: any[] = [];

    if (db.chatSession) {
      sessions = await db.chatSession.findMany({
        where: { userId },
      });
    }

    return res.status(200).json({
      success: true,
      userId,
      sessions,
    });
  } catch (error: any) {
    console.error('[GET /api/chat/sessions Error]', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to list chat sessions.',
    });
  }
});

/**
 * GET /api/chat/session/:sessionId
 */
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    let session = null;

    if (db.chatSession) {
      session = await db.chatSession.findFirst({
        where: { sessionId },
      });
    }

    if (!session) {
      return res.status(404).json({
        success: false,
        error: `Chat session '${sessionId}' not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      session,
      messages: session.messages || [],
    });
  } catch (error: any) {
    console.error('[GET /api/chat/session/:sessionId Error]', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch chat session.',
    });
  }
});

/**
 * DELETE /api/chat/session/:sessionId
 */
router.delete('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (db.chatSession) {
      try {
        await db.chatSession.delete({
          where: { sessionId },
        });
      } catch (e) {}
    }

    return res.status(200).json({
      success: true,
      message: `Chat session '${sessionId}' cleared.`,
    });
  } catch (error: any) {
    console.error('[DELETE /api/chat/session/:sessionId Error]', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete chat session.',
    });
  }
});

export default router;
