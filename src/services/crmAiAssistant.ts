import { GoogleGenAI, Type } from '@google/genai';
import { calculateLeadScore } from '../routes/dashboardApi';
import { CrmRepository } from '../server/crm/crmRepository';
import { getDocStore, newId } from '../server/data/docStore';
import { can, isRole } from '../server/tenancy/orgs';

// Lazy initialize Gemini client
let geminiClient: GoogleGenAI | null = null;
/** Tests only: inject a stand-in client (null restores the real one). */
export function setGeminiClientForTests(client: any | null) { geminiClient = client; resolvedModel = null; }
function getGemini(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    try {
      geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (e: any) {
      console.warn('[Gemini Init Note]:', e?.message);
    }
  }
  return geminiClient;
}

// Approved Business Knowledge Base Documents
const APPROVED_KNOWLEDGE_DOCS = [
  {
    topic: 'Product Architecture & SLAs',
    content: 'Obsidian CRM provides sovereign multi-channel communications (WhatsApp Business API, WebRTC Video Call Canvas, Voice Softphone SIP trunks, Email, and SMS). SLA guarantees 99.99% uptime with dual-cloud regional failover and ISO 27001 / SOC 2 Type II compliance.'
  },
  {
    topic: 'Pricing & Enterprise Licensing',
    content: 'Enterprise Tier: $5,000/month or $50,000/year (billed annually). Includes unlimited call canvas seats, 10,000 monthly voice minutes, automated BANT lead qualification, custom AI prompt workflows, and dedicated account director.'
  },
  {
    topic: 'Lead Qualification & Scoring (BANT)',
    content: 'BANT methodology: Budget (verified threshold >= $20,000 = +15 pts), Authority (decision maker/influencer = +15 pts), Need (concrete pain point in multi-channel/voice = +15 pts), Timeline (immediate / 1-3 months). Minimum qualification threshold is 70 points.'
  },
  {
    topic: 'Social Planner & Content Publishing',
    content: 'Obsidian Social Planner automates cross-posting to LinkedIn UGC, X (Twitter), Instagram Business, and Facebook Pages with platform-specific variations, automated hashtag optimization, and analytics tracking.'
  }
];

// Structured Function Tool Declarations for Gemini
export const CRM_TOOL_DECLARATIONS = [
  {
    name: 'search_contacts',
    description: 'Search and retrieve customer contacts from the CRM database by query or company name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search term matching name, email, or company.' },
        limit: { type: Type.NUMBER, description: 'Maximum number of contacts to retrieve (1 to 20).' }
      },
      required: ['query']
    }
  },
  {
    name: 'search_leads',
    description: 'Search and retrieve inbound sales leads in the CRM database with BANT scores, status, and channels.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Optional keyword to search across lead names, companies, or notes.' },
        status: { type: Type.STRING, description: 'Optional status filter: "new", "contacted", "qualifying", "qualified", "converted".' },
        minScore: { type: Type.NUMBER, description: 'Minimum lead score threshold (0-100).' },
        limit: { type: Type.NUMBER, description: 'Maximum leads to return.' }
      }
    }
  },
  {
    name: 'get_pipeline_summary',
    description: 'Retrieve real-time revenue pipeline metrics, total ARR, active deals count, and stage breakdown.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        includeDeals: { type: Type.BOOLEAN, description: 'Whether to include deal titles and ARR values.' }
      }
    }
  },
  {
    name: 'create_lead',
    description: 'Create a new authorized inbound lead in the CRM with automatic duplicate detection and BANT scoring.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Full name of the prospect.' },
        email: { type: Type.STRING, description: 'Valid business email address.' },
        company: { type: Type.STRING, description: 'Company or business name.' },
        phone: { type: Type.STRING, description: 'Phone number or WhatsApp number.' },
        channel: { type: Type.STRING, description: 'Channel: "whatsapp", "voice", "email", "linkedin", "website".' },
        budget: { type: Type.NUMBER, description: 'Estimated budget in USD.' },
        need: { type: Type.STRING, description: 'Specific customer requirements or problem to solve.' },
        timeline: { type: Type.STRING, description: 'Timeline: "immediate", "1-3 months", "3-6 months".' }
      },
      required: ['name', 'email', 'company']
    }
  },
  {
    name: 'create_deal',
    description: 'Register a new active deal / opportunity in the revenue sales pipeline.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Deal title (e.g. "AlphaTech OmniRoute Core Migration").' },
        client: { type: Type.STRING, description: 'Client company name.' },
        value: { type: Type.NUMBER, description: 'Contract ARR value in USD.' },
        stage: { type: Type.STRING, description: 'Pipeline stage: "discovery", "qualified", "proposal", "negotiation", "won".' },
        expectedClose: { type: Type.STRING, description: 'Expected close timeframe (e.g. "This Month", "Next Month").' }
      },
      required: ['name', 'client', 'value']
    }
  },
  {
    name: 'create_followup_task',
    description: 'Schedule a follow-up task linked to a prospect or deal with due date and priority.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Task description / goal.' },
        leadId: { type: Type.STRING, description: 'Optional ID of the lead this task is associated with.' },
        dueDate: { type: Type.STRING, description: 'Due date / time string (e.g. "Tomorrow 2:00 PM", "In 2 hours").' },
        priority: { type: Type.STRING, description: 'Priority level: "urgent", "high", "medium", "low".' }
      },
      required: ['title', 'dueDate']
    }
  },
  {
    name: 'search_knowledge_base',
    description: 'Retrieve approved business knowledge, SLAs, security certifications, and pricing documentation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Search keywords regarding pricing, SLA, features, or compliance.' }
      },
      required: ['query']
    }
  },
  {
    name: 'draft_sales_outreach',
    description: 'Generate high-conversion, professional sales outreach copy for an active prospect or deal.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        recipientName: { type: Type.STRING, description: 'Name of the recipient.' },
        company: { type: Type.STRING, description: 'Company name.' },
        channel: { type: Type.STRING, description: '"email", "whatsapp", or "linkedin".' },
        keyPoints: { type: Type.STRING, description: 'Key solutions or meeting proposal to emphasize.' }
      },
      required: ['recipientName', 'company', 'channel', 'keyPoints']
    }
  },
  {
    name: 'create_social_draft',
    description: 'Create and save a multi-platform social media post draft in the CRM Social Planner.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        caption: { type: Type.STRING, description: 'Core post caption or message.' },
        platforms: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Target platforms (e.g. ["LINKEDIN", "INSTAGRAM", "FACEBOOK"]).'
        },
        scheduledDate: { type: Type.STRING, description: 'Optional ISO date or schedule timeframe.' }
      },
      required: ['caption', 'platforms']
    }
  },
  {
    name: 'qualify_lead',
    description: 'Mark an existing lead as qualified or unqualified (with an optional reason). Identify the lead by its id, or by its exact name or email address. Ask the user if several leads share the name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        leadId: { type: Type.STRING, description: 'The lead id (from search_leads), if known.' },
        nameOrEmail: { type: Type.STRING, description: 'Exact name or email address of the lead, if the id is not known.' },
        status: { type: Type.STRING, description: '"qualified" or "unqualified".' },
        reason: { type: Type.STRING, description: 'Optional short reason, e.g. budget confirmed.' }
      },
      required: ['status']
    }
  },
  {
    name: 'summarize_recent_conversations',
    description: 'Fetch the organization\'s recent customer messages (inbox conversations plus inbound WhatsApp and SMS) so you can summarize them. Read-only.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        hours: { type: Type.NUMBER, description: 'How far back to look, in hours (default 24, maximum 72).' }
      }
    }
  }
];

const WRITE_TOOLS = new Set(['create_lead', 'create_deal', 'create_followup_task', 'create_social_draft', 'qualify_lead']);
const s = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Executes a tool the model asked for, ONLY inside the caller's organization and ONLY if the caller's
 * role allows it. The model's arguments are untrusted input: they are validated and length-limited,
 * and the model can't choose the organization, the user, or the role.
 */
export async function executeCrmTool(
  toolName: string,
  args: Record<string, any>,
  context: { userId: string; orgId: string; role: string }
): Promise<any> {
  console.log(`[CRM AI Tool] ${toolName} | user ${context.userId} | org ${context.orgId}`);
  if (WRITE_TOOLS.has(toolName) && !(isRole(context.role) && can(context.role, 'write'))) {
    return { error: 'Your role is read-only, so I can’t create or change records for you.' };
  }

  try {
    const repo = await CrmRepository.forOrg(context.orgId);
    switch (toolName) {
      case 'search_contacts': {
        const q = s(args.query, 200).toLowerCase();
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
        const matches = (await repo.listContacts()).filter((c: any) =>
          ['name', 'email', 'company'].some((f) => typeof c[f] === 'string' && c[f].toLowerCase().includes(q))).slice(0, limit);
        return { count: matches.length, contacts: matches.length ? matches : 'No contacts matched your search query in CRM.' };
      }

      case 'search_leads': {
        const q = s(args.query, 200).toLowerCase();
        const minScore = Number(args.minScore) || 0;
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
        let leads = await repo.listLeads();
        if (args.status && args.status !== 'all') leads = leads.filter((l) => l.status === args.status);
        if (minScore > 0) leads = leads.filter((l) => (Number(l.score) || 0) >= minScore);
        if (q) leads = leads.filter((l) => ['name', 'company', 'email', 'notes'].some((f) => typeof l[f] === 'string' && l[f].toLowerCase().includes(q)));
        return {
          count: leads.length,
          leads: leads.slice(0, limit).map((l) => ({ id: l.id, name: l.name, company: l.company, email: l.email, status: l.status, score: l.score, source: l.source, budget: l.qualification?.budget, need: l.qualification?.need || l.notes })),
        };
      }

      case 'get_pipeline_summary': {
        const [deals, leads] = await Promise.all([repo.listDeals(), repo.listLeads()]);
        const stageBreakdown: Record<string, { count: number; value: number }> = {};
        for (const d of deals) {
          const k = d.stage || 'discovery';
          stageBreakdown[k] ??= { count: 0, value: 0 };
          stageBreakdown[k].count++; stageBreakdown[k].value += Number(d.value) || 0;
        }
        const converted = leads.filter((l) => l.isConverted || l.status === 'converted').length;
        return {
          totalPipelineValue: deals.reduce((sum, d) => sum + (Number(d.value) || 0), 0),
          activeDealsCount: deals.length,
          leadConversionRate: `${leads.length ? Number(((converted / leads.length) * 100).toFixed(1)) : 0}%`,
          totalLeads: leads.length,
          stageBreakdown,
          deals: args.includeDeals ? deals.slice(0, 5).map((d) => ({ name: d.name, client: d.client, value: d.value, stage: d.stage })) : undefined,
          note: deals.length === 0 && leads.length === 0 ? 'This organization has no deals or leads yet.' : undefined,
        };
      }

      case 'create_lead': {
        const name = s(args.name, 120), email = s(args.email, 254).toLowerCase(), company = s(args.company, 160);
        if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'A lead needs a name and a valid email address.' };
        const lead: any = {
          id: newId('lead'), name, email, phone: s(args.phone, 40), company, title: '',
          source: s(args.channel, 40) || 'ai_assistant', channel: s(args.channel, 40) || 'ai_assistant', status: 'new',
          owner: '', ownerId: context.userId,
          notes: args.need ? `Created via AI Assistant. Requirement: ${s(args.need, 2000)}` : 'Lead registered via AI assistant.',
          isConverted: false,
          qualification: { budget: Number(args.budget) > 0 ? Number(args.budget) : 0, authority: 'unknown', need: s(args.need, 2000), timeline: s(args.timeline, 60) || 'unknown' },
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        lead.score = calculateLeadScore(lead);
        await repo.saveLead(lead); // awaited: if it fails, the tool reports failure instead of claiming success
        await repo.logActivity({ type: 'lead_created', title: `Lead Registered: ${name}`, description: `AI Assistant registered a lead for ${company || name}.`, actor: 'AI Assistant', targetId: lead.id, targetType: 'lead' });
        return { success: true, leadId: lead.id, name, company, score: lead.score, message: `Created CRM lead for "${name}"${company ? ` (${company})` : ''} with an initial score of ${lead.score}/100.` };
      }

      case 'create_deal': {
        const name = s(args.name, 200), client = s(args.client, 160), value = Number(args.value);
        if (!name || !client || !Number.isFinite(value) || value < 0) return { error: 'A deal needs a name, a client and a non-negative value.' };
        const probs: Record<string, number> = { discovery: 30, qualified: 50, proposal: 70, negotiation: 85, won: 100 };
        const stage = probs[args.stage] !== undefined ? args.stage : 'discovery';
        const deal = await repo.createDeal({ name, client, value, stage, probability: probs[stage], expectedClose: s(args.expectedClose, 60) || 'This Month', momentum: 'hot', channelOrigin: 'ai_assistant', owner: '', ownerId: context.userId });
        await repo.logActivity({ type: 'deal_created', title: `New Deal: ${name}`, description: `Created a $${value.toLocaleString()} deal for ${client} via AI Assistant.`, actor: 'AI Assistant', targetId: deal.id, targetType: 'deal' });
        return { success: true, dealId: deal.id, dealTitle: name, value, stage, message: `Registered a $${value.toLocaleString()} deal for ${client} in the ${stage} stage.` };
      }

      case 'create_followup_task': {
        const title = s(args.title, 300);
        if (!title) return { error: 'A task needs a title.' };
        const leadId = typeof args.leadId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(args.leadId) ? args.leadId : null;
        const task = { title, dueDate: s(args.dueDate, 40) || 'Tomorrow', priority: ['low', 'normal', 'high', 'urgent'].includes(args.priority) ? args.priority : 'high', completed: false, createdById: context.userId, createdAt: new Date().toISOString() };
        // A lead id from the model is only used if that lead exists in THIS organization.
        const saved = leadId && (await repo.getLead(leadId)) ? await repo.addLeadTask(leadId, task) : await repo.createTask({ ...task, leadId: null });
        return { success: true, taskId: saved.id, title, dueDate: task.dueDate, message: `Scheduled task: "${title}" (Due: ${task.dueDate}, Priority: ${task.priority.toUpperCase()}).` };
      }

      case 'search_knowledge_base': {
        const q = s(args.query, 200).toLowerCase();
        const matches = APPROVED_KNOWLEDGE_DOCS.filter((d) => d.topic.toLowerCase().includes(q) || d.content.toLowerCase().includes(q));
        return { results: matches.length ? matches : APPROVED_KNOWLEDGE_DOCS };
      }

      case 'draft_sales_outreach': {
        const recipientName = s(args.recipientName, 120), company = s(args.company, 160);
        return {
          recipient: recipientName, company, channel: s(args.channel, 40),
          draftSubject: `Following up with ${company}`,
          draftBody: `Hi ${recipientName.split(' ')[0] || 'there'},\n\nFollowing up on our discussion about ${company}'s requirements: ${s(args.keyPoints, 2000)}.\n\nWould you have 15 minutes this week to go through next steps?\n\nBest regards,`,
          note: 'Draft only: nothing was sent.',
        };
      }

      case 'create_social_draft': {
        const caption = s(args.caption, 5000);
        if (!caption) return { error: 'A post needs a caption.' };
        const platforms = Array.isArray(args.platforms) ? args.platforms.filter((p: unknown) => typeof p === 'string').slice(0, 10) : ['LINKEDIN'];
        const post = await repo.createSocialDraft({ caption, mediaUrls: [], platforms, scheduledAt: s(args.scheduledDate, 40) || null, status: 'DRAFT', createdById: context.userId, createdAt: new Date().toISOString() });
        return { success: true, postId: post.id, caption, platforms, message: `Saved a social media draft for [${platforms.join(', ')}]. It has not been published or scheduled.` };
      }

      case 'qualify_lead': {
        const status = args.status === 'qualified' || args.status === 'unqualified' ? args.status : null;
        if (!status) return { error: 'Status must be "qualified" or "unqualified".' };
        const reason = s(args.reason, 500);
        let lead: any = null;
        if (typeof args.leadId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(args.leadId)) lead = await repo.getLead(args.leadId);
        if (!lead) {
          const key = s(args.nameOrEmail, 254).toLowerCase();
          if (!key) return { error: 'Tell me which lead: its id, exact name or email address.' };
          const matches = (await repo.listLeads()).filter((l) => (typeof l.email === 'string' && l.email.toLowerCase() === key) || (typeof l.name === 'string' && l.name.toLowerCase() === key));
          if (!matches.length) return { error: `No lead named or with the email "${s(args.nameOrEmail, 120)}" was found.` };
          if (matches.length > 1) return { error: 'Several leads match. Which one did you mean?', candidates: matches.slice(0, 5).map((l) => ({ id: l.id, name: l.name, email: l.email, company: l.company })) };
          lead = matches[0];
        }
        if (lead.isConverted || lead.status === 'converted') return { error: `${lead.name} is already converted to a deal; their status can't change.` };
        if (lead.status === status) return { success: true, unchanged: true, leadId: lead.id, message: `${lead.name} is already ${status}.` };
        const now = new Date().toISOString();
        await repo.updateLead(lead.id, { status, statusReason: reason || null, updatedAt: now });
        await repo.addLeadActivity(lead.id, { type: 'status_changed', title: `Status Changed: ${lead.status} → ${status}`, description: reason ? `Reason: ${reason}` : `Marked ${status} by the AI assistant.`, actor: 'AI Assistant' });
        await repo.logActivity({ type: 'status_changed', title: `Lead ${status === 'qualified' ? 'Qualified' : 'Unqualified'}: ${lead.name}`, description: reason || `Marked ${status} by the AI assistant.`, actor: 'AI Assistant', targetId: lead.id, targetType: 'lead' });
        return { success: true, leadId: lead.id, name: lead.name, from: lead.status, to: status, reason: reason || null, message: `Marked ${lead.name} as ${status}${reason ? ` (${reason})` : ''}.` };
      }

      case 'summarize_recent_conversations': {
        const hours = Math.min(Math.max(Math.round(Number(args.hours) || 24), 1), 72);
        const sinceMs = Date.now() - hours * 3_600_000;
        const { recentInboxMessages } = await import('../routes/messagingPlatform');
        const st = await getDocStore();
        const [inbox, inbound] = await Promise.all([
          recentInboxMessages(context.orgId, sinceMs, 150),
          st.list(`organizations/${context.orgId}/inbound_messages`, { orderBy: 'at', direction: 'desc', limit: 150 }),
        ]);
        const inboundRecent = inbound.filter((m) => Date.parse(m.at) >= sinceMs)
          .map((m) => ({ channel: m.channel, from: m.contactName || m.from, text: String(m.body || '').slice(0, 500), at: m.at }));
        return {
          windowHours: hours,
          inboxMessages: inbox,
          inboundMessages: inboundRecent,
          note: inbox.length || inboundRecent.length ? 'Summarize these messages; nothing was changed.' : `No customer messages in the last ${hours} hours.`,
        };
      }

      default:
        return { error: `Tool "${toolName}" is not recognized.` };
    }
  } catch (err: any) {
    console.error(`[CRM AI Tool Error: ${toolName}]`, err);
    return { error: `The ${toolName.replace(/_/g, ' ')} action failed. Nothing was changed.` };
  }
}

// ---------------------------------------------------------------------------
// Model selection and output limits
// ---------------------------------------------------------------------------
let resolvedModel: { model: string; maxOutputTokens: number; note?: string } | null = null;
const DEFAULT_MAX_OUTPUT = 8192;

/**
 * Picks the model and the output-token limit from the provider itself (models.get → outputTokenLimit),
 * capped by GEMINI_MAX_OUTPUT_TOKENS (default 32768). GEMINI_MODEL picks the model; if the provider
 * doesn't know it, gemini-2.5-flash is tried next and the reason is reported.
 */
export async function resolveGeminiModel(gemini: any): Promise<{ model: string; maxOutputTokens: number; note?: string }> {
  if (resolvedModel) return resolvedModel;
  const cap = Math.max(1024, Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 32768);
  const wanted = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
  const candidates = [...new Set([wanted, 'gemini-2.5-flash'])];
  let note: string | undefined;
  for (const model of candidates) {
    try {
      const info = await gemini.models.get({ model });
      const limit = Number(info?.outputTokenLimit) || DEFAULT_MAX_OUTPUT;
      resolvedModel = { model, maxOutputTokens: Math.min(limit, cap), note };
      return resolvedModel;
    } catch (err: any) {
      const status = err?.status ?? err?.code;
      if (status === 404 || /not found|is not supported|NOT_FOUND/i.test(String(err?.message))) {
        console.warn(`[ai] model ${model} is not available to this API key`);
        note = `The configured model (${wanted}) isn’t available to this API key.`;
        continue;
      }
      // Network or permission trouble: don't cache, use the requested model with a safe default limit.
      return { model, maxOutputTokens: Math.min(DEFAULT_MAX_OUTPUT, cap) };
    }
  }
  throw Object.assign(new Error('None of the configured Gemini models are available to this API key. Set GEMINI_MODEL.'), { code: 'model_unavailable' });
}

/** Keeps the newest messages within a character budget (oldest dropped first). */
export function trimHistory<T extends { content: string }>(history: T[], budgetChars = Number(process.env.AI_HISTORY_CHAR_BUDGET) || 120_000): { kept: T[]; dropped: number } {
  const kept: T[] = []; let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const len = history[i].content.length;
    if (used + len > budgetChars && kept.length) break;
    kept.unshift(history[i]); used += len;
  }
  return { kept, dropped: history.length - kept.length };
}

export type AssistantFinish = 'stop' | 'length' | 'safety' | 'other' | 'aborted';
const FINISH: Record<string, AssistantFinish> = { STOP: 'stop', MAX_TOKENS: 'length', SAFETY: 'safety', RECITATION: 'safety', PROHIBITED_CONTENT: 'safety', BLOCKLIST: 'safety', SPII: 'safety' };

/**
 * One assistant turn with real streaming: text is passed to onChunk as the provider produces it.
 * Tool calls (CRM data) run between rounds, scoped to the caller's organization and role.
 * Never invents a reply or performs an action the user didn't ask for: provider errors are thrown.
 */
export async function runCrmAssistantTurn(params: {
  incomingMessage: string;
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  context: { userId: string; orgId: string; role: string; name: string };
  systemInstruction: string;
  useTools?: boolean;
  signal?: AbortSignal;
  onChunk?: (delta: string) => void;
  onToolCall?: (toolName: string, args: any) => void;
  onToolResult?: (toolName: string, result: any) => void;
}): Promise<{ reply: string; toolCallsExecuted: string[]; finish: AssistantFinish; model: string; historyDropped: number; note?: string }> {
  const { incomingMessage, context, onChunk, onToolCall, onToolResult, signal, systemInstruction } = params;
  const useTools = params.useTools !== false;
  const gemini = getGemini();
  if (!gemini) throw Object.assign(new Error('AI isn’t configured on the server. Set GEMINI_API_KEY.'), { code: 'ai_not_configured' });

  const { model, maxOutputTokens, note } = await resolveGeminiModel(gemini);
  const { kept, dropped } = trimHistory(params.conversationHistory.filter((m) => m.role !== 'system'));
  const contents: any[] = [
    ...kept.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: [{ text: incomingMessage }] },
  ];

  const toolCallsExecuted: string[] = [];
  let reply = '';
  const MAX_TOOL_ROUNDS = 5;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const stream = await gemini.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction,
        ...(useTools && round < MAX_TOOL_ROUNDS ? { tools: [{ functionDeclarations: CRM_TOOL_DECLARATIONS as any }] } : {}),
        temperature: 0.4,
        maxOutputTokens,
        ...(signal ? { abortSignal: signal } : {}),
      },
    });
    const modelParts: any[] = [];
    const calls: Array<{ name: string; args: any }> = [];
    let finishRaw = '';
    for await (const chunk of stream as AsyncIterable<any>) {
      if (signal?.aborted) return { reply, toolCallsExecuted, finish: 'aborted', model, historyDropped: dropped, note };
      const cand = chunk?.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        modelParts.push(part); // kept verbatim (incl. thought signatures) for the next round
        if (part.functionCall) calls.push({ name: part.functionCall.name, args: part.functionCall.args || {} });
        else if (typeof part.text === 'string' && part.text && !part.thought) { reply += part.text; onChunk?.(part.text); }
      }
      if (cand?.finishReason) finishRaw = String(cand.finishReason);
    }
    if (signal?.aborted) return { reply, toolCallsExecuted, finish: 'aborted', model, historyDropped: dropped, note };
    if (calls.length) {
      contents.push({ role: 'model', parts: modelParts });
      const responses: any[] = [];
      for (const call of calls) {
        toolCallsExecuted.push(call.name);
        onToolCall?.(call.name, call.args);
        const result = await executeCrmTool(call.name, call.args, context);
        onToolResult?.(call.name, result);
        responses.push({ functionResponse: { name: call.name, response: { result } } });
      }
      contents.push({ role: 'user', parts: responses });
      continue;
    }
    return { reply, toolCallsExecuted, finish: FINISH[finishRaw] ?? (finishRaw ? 'other' : 'stop'), model, historyDropped: dropped, note };
  }
  return { reply, toolCallsExecuted, finish: 'other', model, historyDropped: dropped, note };
}
