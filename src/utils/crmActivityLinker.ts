import { adminDb } from '../lib/firebaseAdmin';
import { wsDispatcher } from './wsDispatcher';
import { GoogleGenAI, Type } from '@google/genai';

// Lazy initialization of GoogleGenAI client to avoid crashes if API key is not present on start
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.includes('placeholder') || key.trim() === '') {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

/**
 * Fallback keyword-based intent classifier in case Gemini API is unavailable or unconfigured.
 */
function fallbackClassifyIntent(subject: string, body: string): 'ticket' | 'deal' | 'task' {
  const combined = `${subject} ${body}`.toLowerCase();
  if (combined.includes('deal') || combined.includes('pricing') || combined.includes('quote') || combined.includes('proposal') || combined.includes('sales') || combined.includes('cost') || combined.includes('buy') || combined.includes('dollar') || combined.includes('price')) {
    return 'deal';
  }
  if (combined.includes('task') || combined.includes('kickoff') || combined.includes('deliverable') || combined.includes('schedule') || combined.includes('milestone') || combined.includes('todo') || combined.includes('action item') || combined.includes('update')) {
    return 'task';
  }
  return 'ticket'; // Default fallback
}

/**
 * Classifies the intent of an inbound communication using Gemini API.
 */
export async function classifyIntentWithGemini(subject: string, body: string): Promise<'ticket' | 'deal' | 'task'> {
  const client = getGeminiClient();
  if (!client) {
    console.log('[CRM Linker] Gemini API key not present, using keyword-based heuristic fallback classification.');
    return fallbackClassifyIntent(subject, body);
  }

  try {
    const prompt = `Analyze the subject and content of this inbound customer message and classify their primary intent.
Subject: "${subject}"
Body: "${body}"

Classify into exactly one of these categories:
1. 'ticket' - if it's a question, support request, technical issue, verification question, complaint, feedback, or general question.
2. 'deal' - if it's a deal inquiry, pricing discussion, sales opportunity, enterprise bid, proposal review, or quote request.
3. 'task' - if it's a task update, deliverables feedback, scheduling request, kickoff project item, or action-item milestone.`;

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: "You are a professional CRM router. Classify messages precisely. Return your response as JSON matching the schema.",
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            intent: {
              type: Type.STRING,
              description: "Must be exactly one of: 'ticket', 'deal', 'task'"
            },
            reasoning: {
              type: Type.STRING,
              description: "A short single sentence explanation of why this classification was chosen."
            }
          },
          required: ['intent']
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    const intent = result.intent?.toLowerCase();
    if (intent === 'ticket' || intent === 'deal' || intent === 'task') {
      console.log(`[CRM Linker] Gemini successfully classified intent as '${intent}'. Reasoning: ${result.reasoning}`);
      return intent;
    }
    throw new Error(`Invalid intent returned by Gemini: ${result.intent}`);
  } catch (err: any) {
    console.error(`[CRM Linker] Gemini classification failed: ${err.message}. Using heuristic fallback.`);
    return fallbackClassifyIntent(subject, body);
  }
}

/**
 * ====================================================================================
 * SENIOR DATABASE ARCHITECT: DISTRIBUTED EVENT & POLYMORPHIC SCHEMA BLUEPRINTS
 * ====================================================================================
 * 
 * Part 1: Relational Database DDL Schema (PostgreSQL/MySQL Compliant)
 * ------------------------------------------------------------------------------------
 * ```sql
 * -- Relational Database DDL Schema for Polymorphic CRM Activities Linker
 * -- Connects an automated JWZ 'thread_id' to multiple CRM entities (Tasks, Deals, and Tickets)
 * -- using a clean polymorphic association layout.
 * 
 * -- 1. core entity tables
 * CREATE TABLE crm_deals (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     name VARCHAR(255) NOT NULL,
 *     value DECIMAL(12,2) NOT NULL DEFAULT 0.00,
 *     status VARCHAR(50) NOT NULL DEFAULT 'Lead',
 *     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 *     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
 * );
 * 
 * CREATE TABLE crm_tasks (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     title VARCHAR(255) NOT NULL,
 *     status VARCHAR(50) NOT NULL DEFAULT 'pending',
 *     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 *     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
 * );
 * 
 * CREATE TABLE crm_tickets (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     subject VARCHAR(255) NOT NULL,
 *     status VARCHAR(50) NOT NULL DEFAULT 'Open', -- Open, Pending, 'Customer Replied', Closed
 *     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 *     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
 * );
 * 
 * -- 2. Polymorphic Association Junction Table (Activity Links)
 * CREATE TABLE crm_activity_links (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     thread_id VARCHAR(255) NOT NULL, -- Calculated JWZ Thread ID
 *     target_id UUID NOT NULL, -- Relates to crm_deals, crm_tasks, or crm_tickets
 *     target_type VARCHAR(50) NOT NULL, -- Enum: 'deal', 'task', 'ticket'
 *     status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'archived'
 *     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 *     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
 *     
 *     CONSTRAINT unique_thread_target UNIQUE (thread_id, target_id, target_type)
 * );
 * 
 * -- 3. Polymorphic Timeline Log (Activity Timeline)
 * CREATE TABLE crm_activity_timelines (
 *     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     target_id UUID NOT NULL, -- Relates to Deal, Task, or Ticket
 *     target_type VARCHAR(50) NOT NULL, -- 'deal', 'task', 'ticket'
 *     activity_type VARCHAR(50) NOT NULL, -- 'email_excerpt', 'comment', 'status_change'
 *     content TEXT NOT NULL, -- Content of the log, message excerpt
 *     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
 * );
 * 
 * -- 4. Highly Optimized Indexes for Fast Polymorphic Lookups
 * -- Speeds up looking up targets associated with a specific JWZ thread
 * CREATE INDEX idx_activity_links_thread_status ON crm_activity_links (thread_id, status);
 * 
 * -- Speeds up retrieving chronological history for a specific entity
 * CREATE INDEX idx_activity_timeline_target_date ON crm_activity_timelines (target_id, created_at DESC);
 * ```
 * 
 * ------------------------------------------------------------------------------------
 * Part 2: NoSQL Firestore Document Schema Blueprint & Layout
 * ------------------------------------------------------------------------------------
 * ```json
 * {
 *   "crm_activity_links": {
 *     "description": "Junction collection relating a JWZ threadId to target CRM entities.",
 *     "schema": {
 *       "id": "string (auto-generated)",
 *       "threadId": "string (JWZ Thread ID)",
 *       "targetId": "string (ID of the Task/Deal/Ticket)",
 *       "targetType": "string ('task' | 'deal' | 'ticket')",
 *       "status": "string ('active' | 'archived')",
 *       "createdAt": "string (ISO timestamp)",
 *       "updatedAt": "string (ISO timestamp)"
 *     },
 *     "indexes": [
 *       {
 *         "collectionGroup": "crm_activity_links",
 *         "queryScope": "COLLECTION",
 *         "fields": [
 *           { "fieldPath": "threadId", "order": "ASCENDING" },
 *           { "fieldPath": "status", "order": "ASCENDING" }
 *         ]
 *       }
 *     ]
 *   },
 *   "crm_activities": {
 *     "description": "Timeline events stored under each target entity as a subcollection or flat global collection.",
 *     "schema": {
 *       "id": "string",
 *       "targetId": "string",
 *       "targetType": "string",
 *       "activityType": "string ('email_excerpt')",
 *       "content": "string (email excerpt)",
 *       "createdAt": "string"
 *     }
 *   }
 * }
 * ```
 */

// Define entity structures
export interface CRMTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  threadId: string;
  timeline: string[]; // Activity timeline excerpts
  updatedAt: string;
}

export interface CRMTicket {
  id: string;
  subject: string;
  status: 'Open' | 'Pending' | 'Customer Replied' | 'Closed';
  threadId: string;
  timeline: string[]; // Activity timeline excerpts
  updatedAt: string;
}

export interface CRMDeal {
  id: string;
  name: string;
  value: number;
  status: 'Lead' | 'Contacted' | 'Proposal' | 'Won' | 'Lost';
  threadId: string;
  timeline: string[]; // Activity timeline excerpts
  updatedAt: string;
}

export interface CRMActivityLink {
  id: string;
  threadId: string; // Calculated JWZ Thread ID
  targetId: string;
  targetType: 'task' | 'deal' | 'ticket';
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

// In-Memory Fallback Database for Resilient Preview Mode (Fully Seeded)
export const fallbackTasks = new Map<string, CRMTask>();
export const fallbackTickets = new Map<string, CRMTicket>();
export const fallbackDeals = new Map<string, CRMDeal>();
export const fallbackActivityLinks = new Map<string, CRMActivityLink>();

// Seed fallback database with illustrative real-world examples
const SEED_THREAD_1 = 'thread-obsidian-kickoff';
const SEED_THREAD_2 = 'thread-luxury-bid';

fallbackTasks.set('task-1', {
  id: 'task-1',
  title: 'Audit Project Kickoff Deliverables',
  status: 'pending',
  threadId: SEED_THREAD_1,
  timeline: ['[System] Task created from email thread integration.'],
  updatedAt: new Date().toISOString()
});

fallbackTickets.set('ticket-1', {
  id: 'ticket-1',
  subject: 'Urgent: High-Net-Worth Verification Issue',
  status: 'Open',
  threadId: SEED_THREAD_2,
  timeline: ['[System] Ticket opened from inbound pipeline.'],
  updatedAt: new Date().toISOString()
});

fallbackDeals.set('deal-1', {
  id: 'deal-1',
  name: 'Confidential Luxury Bid Closeout',
  value: 450000,
  status: 'Proposal',
  threadId: SEED_THREAD_2,
  timeline: ['[System] Deal associated with Luxury Bid email thread.'],
  updatedAt: new Date().toISOString()
});

// Seed association links linking thread_ids to respective entities
fallbackActivityLinks.set('link-1', {
  id: 'link-1',
  threadId: SEED_THREAD_1,
  targetId: 'task-1',
  targetType: 'task',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

fallbackActivityLinks.set('link-2', {
  id: 'link-2',
  threadId: SEED_THREAD_2,
  targetId: 'ticket-1',
  targetType: 'ticket',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

fallbackActivityLinks.set('link-3', {
  id: 'link-3',
  threadId: SEED_THREAD_2,
  targetId: 'deal-1',
  targetType: 'deal',
  status: 'active',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

export interface InboundEmail {
  id: string;
  messageId: string;
  threadId: string; // The calculated JWZ thread_id
  subject: string;
  from: string;
  to: string;
  body: string;
  date: string | Date;
}

/**
 * Event Listener Trigger: Called whenever an IMAP or webhook parser ingests a new email message.
 * Calculates JWZ associations and automatically updates linked CRM tasks/tickets/deals.
 */
export async function onNewEmailIngested(email: InboundEmail): Promise<{
  success: boolean;
  updatesCount: number;
  updatedTargets: Array<{ id: string; type: string; newStatus?: string }>;
}> {
  const { threadId, subject, from, body } = email;
  const timestamp = new Date().toISOString();

  // 1. DYNAMIC CLASSIFICATION VIA GEMINI
  const classifiedType = await classifyIntentWithGemini(subject, body);
  console.log(`[CRM Linker] onNewEmailIngested: Classified intent as '${classifiedType}' on thread '${threadId}'.`);

  const excerpt = body.length > 250 ? body.substring(0, 250) + '...' : body;
  // Prefix the log with the classification type to make it clear in UI timelines
  const excerptLog = `[${classifiedType.toUpperCase()} - ${timestamp}] From: ${from} | Subj: ${subject}\n"${excerpt}"`;
  
  const updatedTargets: Array<{ id: string; type: string; newStatus?: string }> = [];
  let updatesCount = 0;

  // 1A. FIRST ATTEMPT: Production Firestore lookup and routing
  try {
    // Perform optimal query using compound index on (threadId, status)
    const linksSnapshot = await adminDb.collection('crm_activity_links')
      .where('threadId', '==', threadId)
      .where('status', '==', 'active')
      .get();

    const batch = adminDb.batch();
    let hasMatchingTypeLink = false;

    if (!linksSnapshot.empty) {
      console.log(`[CRM Linker] Firestore: Found ${linksSnapshot.size} active polymorphic association links.`);
      
      for (const doc of linksSnapshot.docs) {
        const linkData = doc.data() as CRMActivityLink;
        const { targetId, targetType } = linkData;

        if (targetType === classifiedType) {
          hasMatchingTypeLink = true;
        }

        if (targetType === 'task') {
          const taskRef = adminDb.collection('tasks').doc(targetId);
          const taskSnap = await taskRef.get();
          if (taskSnap.exists) {
            const taskData = taskSnap.data() as CRMTask;
            const updatedTimeline = [...(taskData.timeline || []), excerptLog];
            batch.update(taskRef, {
              timeline: updatedTimeline,
              updatedAt: timestamp
            });
            updatedTargets.push({ id: targetId, type: 'task' });
            updatesCount++;
          }
        } else if (targetType === 'ticket') {
          const ticketRef = adminDb.collection('tickets').doc(targetId);
          const ticketSnap = await ticketRef.get();
          if (ticketSnap.exists) {
            const ticketData = ticketSnap.data() as CRMTicket;
            const updatedTimeline = [...(ticketData.timeline || []), excerptLog];
            batch.update(ticketRef, {
              timeline: updatedTimeline,
              status: 'Customer Replied',
              updatedAt: timestamp
            });
            updatedTargets.push({ id: targetId, type: 'ticket', newStatus: 'Customer Replied' });
            updatesCount++;
          }
        } else if (targetType === 'deal') {
          const dealRef = adminDb.collection('deals').doc(targetId);
          const dealSnap = await dealRef.get();
          if (dealSnap.exists) {
            const dealData = dealSnap.data() as CRMDeal;
            const updatedTimeline = [...(dealData.timeline || []), excerptLog];
            batch.update(dealRef, {
              timeline: updatedTimeline,
              updatedAt: timestamp
            });
            updatedTargets.push({ id: targetId, type: 'deal' });
            updatesCount++;
          }
        }
      }
    }

    // If there's no existing active link of the classified targetType on this thread,
    // auto-create the CRM entity and associate it dynamically.
    if (!hasMatchingTypeLink) {
      console.log(`[CRM Linker] No existing active Firestore link for '${classifiedType}' found on thread '${threadId}'. Auto-creating entity.`);
      const newEntityId = `${classifiedType}-${Date.now()}`;
      const linkId = `link-${Date.now()}`;

      // Create polymorphic activity link
      const linkRef = adminDb.collection('crm_activity_links').doc(linkId);
      batch.set(linkRef, {
        id: linkId,
        threadId,
        targetId: newEntityId,
        targetType: classifiedType,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp
      });

      // Create target entity based on classified type
      if (classifiedType === 'task') {
        const taskRef = adminDb.collection('tasks').doc(newEntityId);
        batch.set(taskRef, {
          id: newEntityId,
          title: subject || 'Task Update from Inbound Communication',
          status: 'pending',
          threadId,
          timeline: [excerptLog],
          updatedAt: timestamp
        });
      } else if (classifiedType === 'ticket') {
        const ticketRef = adminDb.collection('tickets').doc(newEntityId);
        batch.set(ticketRef, {
          id: newEntityId,
          subject: subject || 'Support Ticket from Inbound Message',
          status: 'Open',
          threadId,
          timeline: [excerptLog],
          updatedAt: timestamp
        });
      } else if (classifiedType === 'deal') {
        const dealRef = adminDb.collection('deals').doc(newEntityId);
        batch.set(dealRef, {
          id: newEntityId,
          name: subject || 'New Deal Inquiry',
          value: 15000,
          status: 'Lead',
          threadId,
          timeline: [excerptLog],
          updatedAt: timestamp
        });
      }

      updatedTargets.push({ id: newEntityId, type: classifiedType });
      updatesCount++;
    }

    await batch.commit();
    console.log(`[CRM Linker] Successfully persisted ${updatesCount} polymorphic updates & auto-creation to Firestore.`);
  } catch (firestoreErr: any) {
    console.warn('[CRM Linker] Firestore lookup skipped or rules restricted. Failing over to highly resilient local cache:', firestoreErr.message);
  }

  // 1B. ALWAYS KEEP LOCAL FALLBACK DATABASE SYNCHRONIZED
  // Ensure preview and demonstration states remain perfect and immediately responsive
  const localLinks = Array.from(fallbackActivityLinks.values()).filter(
    link => link.threadId === threadId && link.status === 'active'
  );

  let hasLocalMatchingTypeLink = false;

  for (const link of localLinks) {
    const { targetId, targetType } = link;
    
    if (targetType === classifiedType) {
      hasLocalMatchingTypeLink = true;
    }

    if (targetType === 'task') {
      const task = fallbackTasks.get(targetId);
      if (task) {
        task.timeline.push(excerptLog);
        task.updatedAt = timestamp;
        if (!updatedTargets.some(t => t.id === targetId)) {
          updatedTargets.push({ id: targetId, type: 'task' });
          updatesCount++;
        }
      }
    } else if (targetType === 'ticket') {
      const ticket = fallbackTickets.get(targetId);
      if (ticket) {
        ticket.timeline.push(excerptLog);
        ticket.status = 'Customer Replied';
        ticket.updatedAt = timestamp;
        if (!updatedTargets.some(t => t.id === targetId)) {
          updatedTargets.push({ id: targetId, type: 'ticket', newStatus: 'Customer Replied' });
          updatesCount++;
        }
      }
    } else if (targetType === 'deal') {
      const deal = fallbackDeals.get(targetId);
      if (deal) {
        deal.timeline.push(excerptLog);
        deal.updatedAt = timestamp;
        if (!updatedTargets.some(t => t.id === targetId)) {
          updatedTargets.push({ id: targetId, type: 'deal' });
          updatesCount++;
        }
      }
    }
  }

  // If there's no existing active link of the classified targetType in local fallback,
  // auto-create the fallback CRM entity and associate it dynamically.
  if (!hasLocalMatchingTypeLink) {
    console.log(`[CRM Linker Fallback] No existing active link for '${classifiedType}' found on thread '${threadId}'. Auto-creating fallback entity.`);
    const newEntityId = `${classifiedType}-${Date.now()}`;
    const linkId = `link-${Date.now()}`;

    // Add activity link to fallback map
    fallbackActivityLinks.set(linkId, {
      id: linkId,
      threadId,
      targetId: newEntityId,
      targetType: classifiedType,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp
    });

    // Create target entity in fallback maps
    if (classifiedType === 'task') {
      fallbackTasks.set(newEntityId, {
        id: newEntityId,
        title: subject || 'Task Update from Inbound Communication',
        status: 'pending',
        threadId,
        timeline: [excerptLog],
        updatedAt: timestamp
      });
    } else if (classifiedType === 'ticket') {
      fallbackTickets.set(newEntityId, {
        id: newEntityId,
        subject: subject || 'Support Ticket from Inbound Message',
        status: 'Open',
        threadId,
        timeline: [excerptLog],
        updatedAt: timestamp
      });
    } else if (classifiedType === 'deal') {
      fallbackDeals.set(newEntityId, {
        id: newEntityId,
        name: subject || 'New Deal Inquiry',
        value: 15000,
        status: 'Lead',
        threadId,
        timeline: [excerptLog],
        updatedAt: timestamp
      });
    }

    if (!updatedTargets.some(t => t.id === newEntityId)) {
      updatedTargets.push({ id: newEntityId, type: classifiedType });
      updatesCount++;
    }
  }

  // 3. BROADCAST REAL-TIME WEBSOCKET UPDATE
  // Keeps the entire user interface updated instantly with intent decoration
  if (updatesCount > 0) {
    console.log(`[CRM Linker] Broadcasting real-time updates for ${updatesCount} target(s).`);
    wsDispatcher.broadcast('CRM_POLYMORPHIC_ACTIVITY_UPDATED', {
      threadId,
      updatedTargets,
      excerpt: `[${classifiedType.toUpperCase()}] ${excerpt}`,
      timestamp
    });
  } else {
    console.log(`[CRM Linker] No linked active CRM targets matched for thread ID: ${threadId}. Excerpt cached silently.`);
  }

  return {
    success: true,
    updatesCount,
    updatedTargets
  };
}
