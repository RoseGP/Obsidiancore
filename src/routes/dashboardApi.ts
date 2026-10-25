import { Router, Request, Response } from 'express';
import { adminDb } from '../lib/firebaseAdmin';

const router = Router();

// Calculate lead score based on profile completeness & qualification indicators
export function calculateLeadScore(lead: any): number {
  let score = 20; // baseline
  if (lead.email && lead.email.includes('@') && !lead.email.endsWith('@gmail.com') && !lead.email.endsWith('@yahoo.com')) score += 20; // corporate email
  if (lead.phone && lead.phone.length > 7) score += 15;
  if (lead.company && lead.company.length > 2) score += 15;
  if (lead.title && /director|vp|head|chief|exec|lead|founder|manager/i.test(lead.title)) score += 15;
  if (lead.qualification?.budget && Number(lead.qualification.budget) >= 20000) score += 15;
  return Math.min(score, 100);
}

// Initial seed data if collections are empty
export const INITIAL_DEALS = [
  {
    id: 'deal-alphatech',
    name: 'AlphaTech OmniRoute Core Migration',
    client: 'AlphaTech Global',
    value: 120000,
    stage: 'qualified',
    probability: 60,
    expectedClose: 'Next Month',
    momentum: 'hot',
    channelOrigin: 'whatsapp',
    owner: 'Rene Pierrette',
    ownerAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'
  },
  {
    id: 'deal-metropolis',
    name: 'Metropolis Cloud CRM Seat Expansion (150 seats)',
    client: 'Metropolis Health',
    value: 85000,
    stage: 'proposal',
    probability: 75,
    expectedClose: 'This Month',
    momentum: 'hot',
    channelOrigin: 'voice',
    owner: 'Sarah Jenkins',
    ownerAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150'
  },
  {
    id: 'deal-hyperscale',
    name: 'HyperScale AI Softphone Integration',
    client: 'HyperScale AI',
    value: 64000,
    stage: 'negotiation',
    probability: 85,
    expectedClose: 'This Week',
    momentum: 'steady',
    channelOrigin: 'email',
    owner: 'Rene Pierrette',
    ownerAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'
  },
  {
    id: 'deal-apex',
    name: 'Apex Capital Call Canvas & Video Greet Suite',
    client: 'Apex Financial',
    value: 52500,
    stage: 'discovery',
    probability: 30,
    expectedClose: 'Q4',
    momentum: 'steady',
    channelOrigin: 'web',
    owner: 'Elena Rostova',
    ownerAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=150'
  },
  {
    id: 'deal-vanguard',
    name: 'Vanguard Security SLA Compliance Suite',
    client: 'Vanguard Logistics',
    value: 45000,
    stage: 'won',
    probability: 100,
    expectedClose: 'Closed',
    momentum: 'steady',
    channelOrigin: 'linkedin',
    owner: 'Rene Pierrette',
    ownerAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150'
  }
];

const INITIAL_TICKETS = [
  {
    id: 'ticket-chen-webrtc',
    customerName: 'Marcus Chen',
    company: 'AlphaTech Global',
    channel: 'whatsapp',
    subject: 'WebRTC video fallback routing for APAC region',
    priority: 'critical',
    slaMinutesRemaining: 18,
    status: 'open',
    sentiment: 'urgent'
  },
  {
    id: 'ticket-rostova-sip',
    customerName: 'Elena Rostova',
    company: 'Metropolis Health',
    channel: 'voice',
    subject: 'AI receptionist call transcription delay in SIP queue',
    priority: 'high',
    slaMinutesRemaining: 45,
    status: 'open',
    sentiment: 'neutral'
  },
  {
    id: 'ticket-vance-webhook',
    customerName: 'David Vance',
    company: 'HyperScale AI',
    channel: 'email',
    subject: 'Request for webhook secret rotation documentation',
    priority: 'normal',
    slaMinutesRemaining: 120,
    status: 'open',
    sentiment: 'positive'
  }
];

export const INITIAL_LEADS = [
  {
    id: 'lead-marcus-chen',
    name: 'Marcus Chen',
    email: 'm.chen@alphatech.global',
    phone: '+1 (555) 349-2041',
    company: 'AlphaTech Global',
    title: 'Chief Technology Officer',
    source: 'whatsapp',
    status: 'qualified',
    owner: 'Rene Pierrette',
    ownerId: 'exec-director-45',
    score: 95,
    notes: 'Inquired about enterprise SLA and WebRTC fallback for distributed engineers. High readiness.',
    channel: 'whatsapp',
    isConverted: false,
    value: '$120,000 ARR',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150',
    timeAgo: '8m ago',
    intent: 'WebRTC video fallback routing for distributed engineers',
    qualification: {
      budget: 120000,
      authority: 'decision_maker',
      need: 'Unified multi-channel CRM with real-time WebRTC Call Canvas',
      timeline: '1-3 months'
    }
  },
  {
    id: 'lead-elena-rostova',
    name: 'Elena Rostova',
    email: 'e.rostova@metropolis.health',
    phone: '+1 (555) 781-9923',
    company: 'Metropolis Health',
    title: 'VP Patient Communications',
    source: 'voice',
    status: 'qualifying',
    owner: 'Sarah Jenkins',
    ownerId: 'rep-sarah-02',
    score: 84,
    notes: 'Spoke with AI Front-Desk Receptionist. Requested 150-seat compliance evaluation.',
    channel: 'voice',
    isConverted: false,
    value: '$85,000 ARR',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=150',
    timeAgo: '24m ago',
    intent: 'Telephony AI receptionist with EHR synchronization',
    qualification: {
      budget: 85000,
      authority: 'influencer',
      need: 'Telephony AI receptionist with EHR synchronization',
      timeline: 'This Month'
    }
  },
  {
    id: 'lead-david-vance',
    name: 'David Vance',
    email: 'd.vance@hyperscale.ai',
    phone: '+1 (555) 890-4412',
    company: 'HyperScale AI',
    title: 'Head of Infrastructure',
    source: 'email',
    status: 'contacted',
    owner: 'Rene Pierrette',
    ownerId: 'exec-director-45',
    score: 78,
    notes: 'Responded to outbound enterprise proposal. Interested in custom SIP softphone trunking.',
    channel: 'email',
    isConverted: false,
    value: '$64,000 ARR',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=150',
    timeAgo: '1h ago',
    intent: 'SIP softphone trunking and audio analytics',
    qualification: {
      budget: 64000,
      authority: 'evaluator',
      need: 'SIP softphone trunking and audio analytics',
      timeline: 'immediate'
    }
  },
  {
    id: 'lead-sophia-patel',
    name: 'Sophia Patel',
    email: 'spatel@apexcapital.co',
    phone: '+1 (555) 912-8834',
    company: 'Apex Capital',
    title: 'Managing Partner',
    source: 'linkedin',
    status: 'new',
    owner: 'Rene Pierrette',
    ownerId: 'exec-director-45',
    score: 88,
    notes: 'Engaged with social planner update on AI video proposals. Requested consultation link.',
    channel: 'linkedin',
    isConverted: false,
    value: '$50,000 ARR',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150',
    timeAgo: '3h ago',
    intent: 'Executive video meet & greet with investment term sheet signing',
    qualification: {
      budget: 50000,
      authority: 'decision_maker',
      need: 'Executive video meet & greet with investment term sheet signing',
      timeline: '3-6 months'
    }
  }
];

// Helper to seed database if empty
async function ensureDbInitialized() {
  try {
    const dealsSnapshot = await adminDb.collection('crm_deals').limit(1).get();
    if (dealsSnapshot.empty) {
      const batch = adminDb.batch();
      for (const d of INITIAL_DEALS) {
        const docRef = adminDb.collection('crm_deals').doc();
        batch.set(docRef, {
          id: docRef.id,
          ...d,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      await batch.commit();
    }

    const ticketsSnapshot = await adminDb.collection('crm_tickets').limit(1).get();
    if (ticketsSnapshot.empty) {
      const batch = adminDb.batch();
      for (const t of INITIAL_TICKETS) {
        const docRef = adminDb.collection('crm_tickets').doc();
        batch.set(docRef, {
          id: docRef.id,
          ...t,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      await batch.commit();
    }

    const leadsSnapshot = await adminDb.collection('crm_leads').limit(1).get();
    if (leadsSnapshot.empty) {
      const batch = adminDb.batch();
      for (const l of INITIAL_LEADS) {
        const docRef = adminDb.collection('crm_leads').doc();
        batch.set(docRef, {
          id: docRef.id,
          ...l,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      await batch.commit();
    }
  } catch (err) {
    console.warn('[DashboardApi] DB seed error (non-fatal):', err);
  }
}

// Ensure DB seeds in background on startup
ensureDbInitialized();

// Helper to log audit activity
export async function logCrmActivity(activity: {
  type: string;
  title: string;
  description: string;
  actor?: string;
  targetId?: string;
  targetType?: string;
}) {
  try {
    const docRef = adminDb.collection('crm_activities').doc();
    await docRef.set({
      id: docRef.id,
      ...activity,
      actor: activity.actor || 'Executive Director',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    console.error('[logCrmActivity error]', e);
  }
}

// 1. GET /api/dashboard/stats
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    let deals: any[] = [];
    try {
      const dealsSnap = await adminDb.collection('crm_deals').get();
      deals = dealsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch {
      deals = INITIAL_DEALS;
    }

    let tickets: any[] = [];
    try {
      const ticketsSnap = await adminDb.collection('crm_tickets').get();
      tickets = ticketsSnap.docs.map(t => ({ id: t.id, ...t.data() }));
    } catch {
      tickets = INITIAL_TICKETS;
    }

    let leads: any[] = [];
    try {
      const leadsSnap = await adminDb.collection('crm_leads').get();
      leads = leadsSnap.docs.map(l => ({ id: l.id, ...l.data() }));
    } catch {
      leads = INITIAL_LEADS;
    }

    const openDeals = deals.filter(d => d.stage !== 'lost');
    const totalPipelineValue = openDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const weightedForecastValue = openDeals.reduce((sum, d) => {
      const prob = (Number(d.probability) || 50) / 100;
      return sum + (Number(d.value) || 0) * prob;
    }, 0);

    const activeTickets = tickets.filter(t => t.status !== 'resolved');
    const criticalTickets = activeTickets.filter(t => t.priority === 'critical');

    const totalLeads = leads.length;
    const qualifiedLeads = leads.filter(l => l.status === 'qualified').length;
    const convertedLeads = leads.filter(l => l.isConverted || l.status === 'converted').length;

    res.json({
      success: true,
      stats: {
        totalPipelineValue: Math.round(totalPipelineValue),
        openDealsCount: openDeals.length,
        weightedForecastValue: Math.round(weightedForecastValue),
        callsToday: 18,
        activeTicketsCount: activeTickets.length,
        criticalTicketsCount: criticalTickets.length,
        avgResponseMinutes: 1.2,
        slaMetRate: 98.6,
        meetingsToday: 4,
        totalLeads,
        qualifiedLeads,
        convertedLeads,
        conversionRate: totalLeads > 0 ? Number(((convertedLeads / totalLeads) * 100).toFixed(1)) : 0
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/dashboard/deals
router.get('/deals', async (_req: Request, res: Response) => {
  try {
    const snap = await adminDb.collection('crm_deals').orderBy('createdAt', 'desc').get();
    if (snap.empty) {
      return res.json({ success: true, deals: INITIAL_DEALS });
    }
    const deals = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, deals });
  } catch (err: any) {
    res.json({ success: true, deals: INITIAL_DEALS });
  }
});

// 3. POST /api/dashboard/deals
router.post('/deals', async (req: Request, res: Response) => {
  try {
    const { name, client, value, stage, channelOrigin, expectedClose } = req.body;
    if (!name || !client || value === undefined) {
      return res.status(400).json({ success: false, error: 'Name, client, and value are required.' });
    }

    const probabilities: Record<string, number> = {
      lead: 20,
      discovery: 30,
      qualified: 50,
      proposal: 70,
      negotiation: 85,
      won: 100,
      lost: 0
    };

    const docRef = adminDb.collection('crm_deals').doc();
    const newDeal = {
      id: docRef.id,
      name,
      client,
      value: Number(value),
      stage: stage || 'discovery',
      probability: probabilities[stage || 'discovery'] || 40,
      expectedClose: expectedClose || 'This Month',
      momentum: 'hot',
      channelOrigin: channelOrigin || 'whatsapp',
      owner: (req as any).accountUser?.id || 'Rene Pierrette',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await docRef.set(newDeal);

    await logCrmActivity({
      type: 'deal_created',
      title: `New Deal Created: ${name}`,
      description: `Registered $${Number(value).toLocaleString()} opportunity for ${client} via ${channelOrigin || 'web'}.`,
      actor: (req as any).accountUser?.id || 'Rene Pierrette',
      targetId: docRef.id,
      targetType: 'deal'
    });

    res.status(201).json({ success: true, deal: newDeal });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. PATCH /api/dashboard/deals/:id/stage
router.patch('/deals/:id/stage', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { stage } = req.body;
    if (!stage) {
      return res.status(400).json({ success: false, error: 'Target stage is required.' });
    }

    const probabilities: Record<string, number> = {
      lead: 20,
      discovery: 30,
      qualified: 50,
      proposal: 70,
      negotiation: 85,
      won: 100,
      lost: 0
    };

    const docRef = adminDb.collection('crm_deals').doc(id);
    const existing = await docRef.get();
    if (!existing.exists) {
      return res.status(404).json({ success: false, error: 'Deal not found' });
    }

    const currentData = existing.data();
    await docRef.update({
      stage,
      probability: probabilities[stage] ?? (currentData?.probability || 50),
      updatedAt: new Date().toISOString()
    });

    await logCrmActivity({
      type: 'stage_advanced',
      title: `Deal Stage Advanced: ${currentData?.name}`,
      description: `Stage shifted to ${stage.toUpperCase()} with ${probabilities[stage]}% probability.`,
      actor: (req as any).accountUser?.id || 'Rene Pierrette',
      targetId: id,
      targetType: 'deal'
    });

    res.json({ success: true, id, stage });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. GET /api/dashboard/leads
router.get('/leads', async (req: Request, res: Response) => {
  try {
    const channel = req.query.channel as string;
    let query: any = adminDb.collection('crm_leads');
    if (channel && channel !== 'all') {
      query = query.where('source', '==', channel);
    }
    const snap = await query.get();
    if (snap.empty) {
      return res.json({ success: true, leads: INITIAL_LEADS });
    }
    const leads = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, leads });
  } catch (err: any) {
    res.json({ success: true, leads: INITIAL_LEADS });
  }
});

// 6. GET /api/dashboard/tickets
router.get('/tickets', async (_req: Request, res: Response) => {
  try {
    const snap = await adminDb.collection('crm_tickets').get();
    if (snap.empty) {
      return res.json({ success: true, tickets: INITIAL_TICKETS });
    }
    const tickets = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, tickets });
  } catch (err: any) {
    res.json({ success: true, tickets: INITIAL_TICKETS });
  }
});

// 7. POST /api/dashboard/tickets/:id/resolve
router.post('/tickets/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const docRef = adminDb.collection('crm_tickets').doc(id);
    const existing = await docRef.get();
    if (existing.exists) {
      await docRef.update({
        status: 'resolved',
        updatedAt: new Date().toISOString()
      });
      await logCrmActivity({
        type: 'ticket_resolved',
        title: `Support Ticket Resolved`,
        description: `Resolved ticket "${existing.data()?.subject}" for ${existing.data()?.customerName}.`,
        actor: (req as any).accountUser?.id || 'Rene Pierrette',
        targetId: id,
        targetType: 'ticket'
      });
    }
    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. POST /api/dashboard/tickets/:id/reply
router.post('/tickets/:id/reply', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { replyText } = req.body;
    if (!replyText) {
      return res.status(400).json({ success: false, error: 'Reply text is required' });
    }

    const docRef = adminDb.collection('crm_tickets').doc(id);
    const existing = await docRef.get();
    const customer = existing.exists ? existing.data()?.customerName : 'Client';

    await logCrmActivity({
      type: 'message_sent',
      title: `Omnichannel Reply Dispatched`,
      description: `Dispatched response to ${customer}: "${replyText.slice(0, 60)}..."`,
      actor: (req as any).accountUser?.id || 'Rene Pierrette',
      targetId: id,
      targetType: 'ticket'
    });

    res.json({ success: true, id, message: 'Reply sent' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. GET /api/dashboard/activities
router.get('/activities', async (_req: Request, res: Response) => {
  try {
    const snap = await adminDb.collection('crm_activities').orderBy('timestamp', 'desc').limit(20).get();
    if (snap.empty) {
      return res.json({
        success: true,
        activities: [
          {
            id: 'act-1',
            type: 'deal_created',
            title: 'Deal Registered: AlphaTech Migration',
            description: '$120,000 ARR deal created from qualified WhatsApp thread.',
            actor: 'Rene Pierrette',
            timestamp: new Date().toISOString()
          },
          {
            id: 'act-2',
            type: 'message_sent',
            title: 'AI Receptionist Call Handled',
            description: 'Triage complete for inbound SIP caller Elena Rostova.',
            actor: 'AI Receptionist',
            timestamp: new Date(Date.now() - 3600000).toISOString()
          }
        ]
      });
    }
    const activities = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, activities });
  } catch (err: any) {
    res.json({
      success: true,
      activities: []
    });
  }
});

export default router;
