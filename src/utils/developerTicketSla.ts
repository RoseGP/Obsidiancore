import { wsDispatcher } from './wsDispatcher';

export type TicketPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketCategory = 'OUTAGE_CRITICAL' | 'AUTH_SECURITY' | 'API_GATEWAY' | 'SDK_INTEGRATION' | 'BILLING' | 'GENERAL';

export interface DeveloperTicketInput {
  id?: string;
  subject: string;
  body: string;
  customerEmail?: string;
  customerName?: string;
  assignedTo?: string | null;
  status?: TicketStatus;
  createdAt?: string;
}

export interface DeveloperTicketSlaResult {
  ticketId: string;
  priority: TicketPriority;
  priorityLabel: string;
  category: TicketCategory;
  tags: string[];
  sla: {
    responseSlaMinutes: number;
    resolutionSlaMinutes: number;
    responseDeadline: string; // ISO string
    resolutionDeadline: string; // ISO string
    isBreached: boolean;
    timeRemainingMinutes: number;
  };
  matchedKeywords: string[];
}

export interface CannedSnippet {
  id: string;
  title: string;
  category: string;
  description: string;
  templateText: string;
  templateHtml?: string;
}

/**
 * Pre-configured canned code snippets for quick developer responses.
 */
export const DEVELOPER_CANNED_SNIPPETS: CannedSnippet[] = [
  {
    id: 'api-key-reset',
    title: '🔑 API Key Regeneration & Auth Header Instructions',
    category: 'Security & Auth',
    description: 'Instructions for generating a new Bearer token and resetting compromised credentials.',
    templateText: `Hello {{Name}},

To resolve your API authorization issue, please regenerate your developer API token from your Security Settings dashboard.

Ensure all outgoing HTTP requests include the token in your headers:
Authorization: Bearer <YOUR_NEW_API_KEY>
Content-Type: application/json

Ticket Ref: #{{TicketId}}
Need further assistance? Reply directly to this ticket.`,
    templateHtml: `<p>Hello <strong>{{Name}}</strong>,</p>
<p>To resolve your API authorization issue, please regenerate your developer API token from your Security Settings dashboard.</p>
<pre style="background: #1e293b; color: #38bdf8; padding: 12px; border-radius: 6px;">Authorization: Bearer &lt;YOUR_NEW_API_KEY&gt;\nContent-Type: application/json</pre>
<p>Ticket Ref: <code>#{{TicketId}}</code></p>`
  },
  {
    id: 'sdk-troubleshooting',
    title: '🛠️ TypeScript SDK & Node.js ESM Import Resolution',
    category: 'SDK & Client Libraries',
    description: 'Fixes common Node.js module resolution issues and type definition errors.',
    templateText: `Hello {{Name}},

For TypeScript & Node.js ESM projects, verify that your tsconfig.json includes:
{
  "compilerOptions": {
    "moduleResolution": "node",
    "target": "ES2022",
    "esModuleInterop": true
  }
}

Import the SDK using named imports:
import { CRMClient } from '@obsidian/crm-sdk';
const client = new CRMClient({ apiKey: process.env.CRM_API_KEY });

Ticket Ref: #{{TicketId}}`,
    templateHtml: `<p>Hello <strong>{{Name}}</strong>,</p>
<p>For TypeScript & Node.js ESM projects, verify your <code>tsconfig.json</code> settings:</p>
<pre style="background: #1e293b; color: #a7f3d0; padding: 12px; border-radius: 6px;">import { CRMClient } from '@obsidian/crm-sdk';\nconst client = new CRMClient({ apiKey: process.env.CRM_API_KEY });</pre>`
  },
  {
    id: 'oauth-redirect-fix',
    title: '🌐 OAuth 2.0 Redirect URI Mismatch Resolution',
    category: 'Authentication',
    description: 'Guidance for configuring authorized redirect URIs in OAuth Developer Console.',
    templateText: `Hello {{Name}},

The "redirect_uri_mismatch" error occurs when the callback URI passed in your authorize request does not exactly match your registered Developer Console URI.

1. Navigate to Developer Console -> App Credentials -> OAuth Settings
2. Add your deployment URL: {{WorkspaceUrl}}/oauth/callback
3. Save changes and wait up to 2 minutes for edge propagates.

Ticket Ref: #{{TicketId}}`,
    templateHtml: `<p>Hello <strong>{{Name}}</strong>,</p><p>Please register <code>{{WorkspaceUrl}}/oauth/callback</code> inside your OAuth Developer Portal to resolve callback mismatches.</p>`
  },
  {
    id: 'webhook-retry-config',
    title: '⚡ Webhook Delivery & Exponential Backoff Retry Setup',
    category: 'API Gateway',
    description: 'Instructions for handling 504 timeouts and idempotency headers.',
    templateText: `Hello {{Name}},

Our webhook engine enforces a 10-second request timeout. Ensure your webhook endpoint responds with HTTP 200 within this window and handles processing asynchronously.

We retry failed webhooks up to 5 times using exponential backoff:
Delay = Math.pow(2, attempt) * 1000 ms

Verify your X-Webhook-Signature header to validate payload integrity.

Ticket Ref: #{{TicketId}}`,
    templateHtml: `<p>Hello <strong>{{Name}}</strong>,</p><p>Our gateway retries failed webhooks with exponential backoff. Ensure your server responds with HTTP 200 within 10 seconds.</p>`
  }
];

/**
 * Categorization & Priority Matrix Keywords
 */
const KEYWORD_RULES = [
  {
    priority: 'P0' as TicketPriority,
    category: 'OUTAGE_CRITICAL' as TicketCategory,
    responseMinutes: 15,
    resolutionMinutes: 60,
    keywords: ['production down', 'system outage', 'api 500 error', 'critical bug', 'data breach', 'security vulnerability', 'api down', '504 gateway timeout', 'database cluster down']
  },
  {
    priority: 'P1' as TicketPriority,
    category: 'AUTH_SECURITY' as TicketCategory,
    responseMinutes: 120, // 2 hours
    resolutionMinutes: 480, // 8 hours
    keywords: ['oauth failure', 'webhook timeout', '429 rate limit', 'authentication error', 'billing failure', 'payment failed', 'sla breach', 'token expired', 'unauthorized']
  },
  {
    priority: 'P2' as TicketPriority,
    category: 'API_GATEWAY' as TicketCategory,
    responseMinutes: 1440, // 24 hours
    resolutionMinutes: 2880, // 48 hours
    keywords: ['api integration', 'documentation error', 'type error', 'cors issue', 'sdk bug', 'latency', 'performance', 'query slow', 'webhook delay']
  },
  {
    priority: 'P3' as TicketPriority,
    category: 'GENERAL' as TicketCategory,
    responseMinutes: 4320, // 72 hours
    resolutionMinutes: 7200, // 120 hours
    keywords: ['question', 'feature request', 'feedback', 'onboarding', 'general query', 'how to', 'pricing']
  }
];

/**
 * Service Utility: `processDeveloperTicketSla`
 * Evaluates ticket subject & body against keyword matrices to assign priority (P0, P1, P2, P3),
 * calculates response/resolution SLA deadlines, tags, and category.
 */
export function processDeveloperTicketSla(ticket: DeveloperTicketInput): DeveloperTicketSlaResult {
  const subjectLower = (ticket.subject || '').toLowerCase();
  const bodyLower = (ticket.body || '').toLowerCase();
  const combinedText = `${subjectLower} ${bodyLower}`;

  let detectedPriority: TicketPriority = 'P3';
  let detectedCategory: TicketCategory = 'GENERAL';
  let responseSlaMinutes = 4320; // Default P3 (72 hrs)
  let resolutionSlaMinutes = 7200; // Default P3 (120 hrs)
  const matchedKeywords: string[] = [];
  const tags: string[] = [];

  // Evaluate rules in priority order (P0 down to P3)
  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      if (combinedText.includes(kw)) {
        matchedKeywords.push(kw);
        tags.push(kw.replace(/\s+/g, '-'));
      }
    }

    if (matchedKeywords.length > 0 && detectedPriority === 'P3') {
      detectedPriority = rule.priority;
      detectedCategory = rule.category;
      responseSlaMinutes = rule.responseMinutes;
      resolutionSlaMinutes = rule.resolutionMinutes;
      break;
    }
  }

  const creationTime = ticket.createdAt ? new Date(ticket.createdAt) : new Date();
  const responseDeadlineDate = new Date(creationTime.getTime() + responseSlaMinutes * 60 * 1000);
  const resolutionDeadlineDate = new Date(creationTime.getTime() + resolutionSlaMinutes * 60 * 1000);

  const now = new Date();
  const isBreached = now > responseDeadlineDate;
  const timeRemainingMinutes = Math.max(0, Math.round((responseDeadlineDate.getTime() - now.getTime()) / (60 * 1000)));

  const priorityLabels: Record<TicketPriority, string> = {
    P0: '🔴 P0 - Emergency (15m SLA)',
    P1: '🟧 P1 - High Priority (2h SLA)',
    P2: '🟨 P2 - Normal (24h SLA)',
    P3: '🟦 P3 - Low Priority (72h SLA)'
  };

  return {
    ticketId: ticket.id || `ticket-${Date.now()}`,
    priority: detectedPriority,
    priorityLabel: priorityLabels[detectedPriority],
    category: detectedCategory,
    tags: Array.from(new Set(tags)),
    sla: {
      responseSlaMinutes,
      resolutionSlaMinutes,
      responseDeadline: responseDeadlineDate.toISOString(),
      resolutionDeadline: resolutionDeadlineDate.toISOString(),
      isBreached,
      timeRemainingMinutes
    },
    matchedKeywords
  };
}

/**
 * In-memory Store for Developer Ticket Assignments and Resolutions
 */
export const developerTicketsStore = new Map<string, {
  id: string;
  assignedTo: string | null;
  status: TicketStatus;
  updatedAt: string;
  commentHistory: Array<{ author: string; text: string; timestamp: string }>;
  slaData?: DeveloperTicketSlaResult;
}>();

/**
 * Assigns or updates ticket status, developer assignment, and appends comments/logs.
 */
export async function assignDeveloperTicket(
  ticketId: string,
  assignedTo: string | null,
  status: TicketStatus = 'IN_PROGRESS',
  comment?: string,
  updatedBy: string = 'Developer Lead'
) {
  const timestamp = new Date().toISOString();
  let existing = developerTicketsStore.get(ticketId);

  if (!existing) {
    existing = {
      id: ticketId,
      assignedTo: assignedTo || null,
      status: status,
      updatedAt: timestamp,
      commentHistory: []
    };
  } else {
    existing.assignedTo = assignedTo !== undefined ? assignedTo : existing.assignedTo;
    existing.status = status || existing.status;
    existing.updatedAt = timestamp;
  }

  if (comment) {
    existing.commentHistory.push({
      author: updatedBy,
      text: comment,
      timestamp
    });
  }

  developerTicketsStore.set(ticketId, existing);

  // Synchronize with Firestore DB if available
  try {
    const { adminDb } = await import('../lib/firebaseAdmin');
    if (adminDb) {
      const ticketRef = adminDb.collection('tickets').doc(ticketId);
      await ticketRef.set(
        {
          id: ticketId,
          assignedTo: existing.assignedTo,
          status: existing.status,
          updatedAt: timestamp
        },
        { merge: true }
      );
    }
  } catch (fsErr: any) {
    console.warn(`[Developer Ticket SLA Engine] Firestore sync note: ${fsErr.message}`);
  }

  // Broadcast WebSocket update event
  wsDispatcher.broadcast('TICKET_STATUS_UPDATED', {
    ticketId,
    assignedTo: existing.assignedTo,
    status: existing.status,
    updatedAt: timestamp,
    comment
  });

  return existing;
}

/**
 * Interpolates canned code snippet templates with customer/ticket details.
 */
export function renderCannedSnippet(snippetId: string, params: { Name?: string; TicketId?: string; WorkspaceUrl?: string }) {
  const snippet = DEVELOPER_CANNED_SNIPPETS.find((s) => s.id === snippetId);
  if (!snippet) {
    throw new Error(`Canned snippet with ID "${snippetId}" not found.`);
  }

  const name = params.Name || 'Developer';
  const ticketId = params.TicketId || 'TICK-402';
  const workspaceUrl = params.WorkspaceUrl || process.env.PUBLIC_APP_URL || 'https://app.crm-omnichannel.com';

  const replaceMap: Record<string, string> = {
    Name: name,
    TicketId: ticketId,
    WorkspaceUrl: workspaceUrl
  };

  let renderedText = snippet.templateText;
  let renderedHtml = snippet.templateHtml || `<p>${renderedText}</p>`;

  for (const [k, v] of Object.entries(replaceMap)) {
    const regex = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g');
    renderedText = renderedText.replace(regex, v);
    renderedHtml = renderedHtml.replace(regex, v);
  }

  return {
    id: snippet.id,
    title: snippet.title,
    category: snippet.category,
    renderedText,
    renderedHtml
  };
}
