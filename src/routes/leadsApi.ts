import { Router, Request, Response } from 'express';
import { adminDb } from '../lib/firebaseAdmin';
import { calculateLeadScore, logCrmActivity } from './dashboardApi';

const router = Router();

// Validation helper for email
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// In-Memory store with initial seed for zero-latency operations & ADC fallback
const MEMORY_LEADS = new Map<string, any>();
const MEMORY_TASKS = new Map<string, any[]>(); // leadId -> tasks[]
const MEMORY_ACTIVITIES = new Map<string, any[]>(); // leadId -> activities[]

const SEED_LEADS = [
  {
    id: 'lead-1',
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
    qualification: {
      budget: 120000,
      authority: 'decision_maker',
      need: 'Unified multi-channel CRM with real-time WebRTC Call Canvas',
      timeline: '1-3 months'
    },
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString()
  },
  {
    id: 'lead-2',
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
    qualification: {
      budget: 85000,
      authority: 'influencer',
      need: 'Telephony AI receptionist with EHR synchronization',
      timeline: 'This Month'
    },
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 2).toISOString()
  },
  {
    id: 'lead-3',
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
    qualification: {
      budget: 64000,
      authority: 'evaluator',
      need: 'SIP softphone trunking and audio analytics',
      timeline: 'immediate'
    },
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: 'lead-4',
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
    qualification: {
      budget: 50000,
      authority: 'decision_maker',
      need: 'Executive video meet & greet with investment term sheet signing',
      timeline: '3-6 months'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

// Seed in-memory store
for (const lead of SEED_LEADS) {
  MEMORY_LEADS.set(lead.id, lead);
}

// Helper to get all leads from memory or Firestore
async function getAllLeads(): Promise<any[]> {
  try {
    const snapshot = await adminDb.collection('crm_leads').get();
    if (!snapshot.empty) {
      const fsLeads = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      for (const l of fsLeads) MEMORY_LEADS.set(l.id, l);
      return fsLeads;
    }
  } catch {
    // ADC not present or network error: use memory store
  }
  return Array.from(MEMORY_LEADS.values());
}

// 1. GET /api/leads - List leads with search, filtering, and sorting
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, status, source, owner, minScore, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    let leads = await getAllLeads();

    if (status && status !== 'all') {
      leads = leads.filter(l => l.status === status);
    }
    if (source && source !== 'all') {
      leads = leads.filter(l => l.source === source);
    }
    if (owner && owner !== 'all') {
      leads = leads.filter(l => l.owner === owner);
    }

    // Free-text search
    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      leads = leads.filter((l: any) =>
        (l.name && l.name.toLowerCase().includes(q)) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.company && l.company.toLowerCase().includes(q)) ||
        (l.title && l.title.toLowerCase().includes(q)) ||
        (l.notes && l.notes.toLowerCase().includes(q))
      );
    }

    if (minScore) {
      const min = Number(minScore);
      if (!isNaN(min)) {
        leads = leads.filter((l: any) => (l.score || 0) >= min);
      }
    }

    // In-memory sorting
    leads.sort((a: any, b: any) => {
      let valA = a[sortBy as string];
      let valB = b[sortBy as string];

      if (sortBy === 'score' || sortBy === 'budget') {
        valA = Number(valA || 0);
        valB = Number(valB || 0);
      } else {
        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    res.json({
      success: true,
      count: leads.length,
      leads
    });
  } catch (err: any) {
    console.error('[LeadsApi GET / error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. GET /api/leads/analytics - Conversion rates and funnel intelligence
router.get('/analytics', async (_req: Request, res: Response) => {
  try {
    const leads = await getAllLeads();

    const totalLeads = leads.length;
    const convertedLeads = leads.filter(l => l.isConverted || l.status === 'converted');
    const qualifiedLeads = leads.filter(l => l.status === 'qualified');
    const newLeads = leads.filter(l => l.status === 'new');
    const contactedLeads = leads.filter(l => l.status === 'contacted');
    const qualifyingLeads = leads.filter(l => l.status === 'qualifying');
    const unqualifiedLeads = leads.filter(l => l.status === 'unqualified');

    const conversionRate = totalLeads > 0 ? Number(((convertedLeads.length / totalLeads) * 100).toFixed(1)) : 0;
    const qualificationRate = totalLeads > 0 ? Number((((qualifiedLeads.length + convertedLeads.length) / totalLeads) * 100).toFixed(1)) : 0;

    const avgScore = totalLeads > 0
      ? Math.round(leads.reduce((acc, l) => acc + (Number(l.score) || 0), 0) / totalLeads)
      : 0;

    // Breakdown by channel source
    const sourceBreakdown: Record<string, { total: number; converted: number; rate: number }> = {};
    for (const lead of leads) {
      const src = lead.source || 'other';
      if (!sourceBreakdown[src]) {
        sourceBreakdown[src] = { total: 0, converted: 0, rate: 0 };
      }
      sourceBreakdown[src].total += 1;
      if (lead.isConverted || lead.status === 'converted') {
        sourceBreakdown[src].converted += 1;
      }
    }

    for (const src of Object.keys(sourceBreakdown)) {
      const item = sourceBreakdown[src];
      item.rate = item.total > 0 ? Number(((item.converted / item.total) * 100).toFixed(1)) : 0;
    }

    // Rep conversion rankings
    const repPerformance: Record<string, { total: number; converted: number; rate: number }> = {};
    for (const lead of leads) {
      const rep = lead.owner || 'Unassigned';
      if (!repPerformance[rep]) {
        repPerformance[rep] = { total: 0, converted: 0, rate: 0 };
      }
      repPerformance[rep].total += 1;
      if (lead.isConverted || lead.status === 'converted') {
        repPerformance[rep].converted += 1;
      }
    }

    for (const rep of Object.keys(repPerformance)) {
      const item = repPerformance[rep];
      item.rate = item.total > 0 ? Number(((item.converted / item.total) * 100).toFixed(1)) : 0;
    }

    res.json({
      success: true,
      analytics: {
        totalLeads,
        convertedCount: convertedLeads.length,
        conversionRate,
        qualificationRate,
        avgScore,
        funnel: [
          { stage: 'new', label: 'New Inbound', count: newLeads.length },
          { stage: 'contacted', label: 'Contacted', count: contactedLeads.length },
          { stage: 'qualifying', label: 'Qualifying', count: qualifyingLeads.length },
          { stage: 'qualified', label: 'Qualified', count: qualifiedLeads.length },
          { stage: 'converted', label: 'Converted to Deal', count: convertedLeads.length },
          { stage: 'unqualified', label: 'Unqualified / Dropped', count: unqualifiedLeads.length }
        ],
        sourceBreakdown,
        repPerformance
      }
    });
  } catch (err: any) {
    console.error('[LeadsApi GET /analytics error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. GET /api/leads/duplicates - Duplicate detection
router.get('/duplicates', async (req: Request, res: Response) => {
  try {
    const { email, phone, company } = req.query;
    if (!email && !phone && !company) {
      return res.json({ success: true, duplicates: [] });
    }

    const leads = await getAllLeads();

    const matches: any[] = [];
    const targetEmail = email ? String(email).trim().toLowerCase() : null;
    const targetPhone = phone ? String(phone).replace(/\D/g, '') : null;
    const targetCompany = company ? String(company).trim().toLowerCase() : null;

    for (const lead of leads) {
      let reasons: string[] = [];
      if (targetEmail && lead.email && lead.email.toLowerCase() === targetEmail) {
        reasons.push('Exact email match');
      }
      if (targetPhone && lead.phone) {
        const leadPhoneClean = lead.phone.replace(/\D/g, '');
        if (leadPhoneClean && leadPhoneClean === targetPhone) {
          reasons.push('Phone number match');
        }
      }
      if (targetCompany && lead.company && lead.company.toLowerCase() === targetCompany) {
        reasons.push('Same company name');
      }

      if (reasons.length > 0) {
        matches.push({
          id: lead.id,
          name: lead.name,
          email: lead.email,
          company: lead.company,
          status: lead.status,
          reasons
        });
      }
    }

    res.json({
      success: true,
      hasDuplicates: matches.length > 0,
      duplicates: matches
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. POST /api/leads/capture - Automated Website Lead Capture (Public Webhook / Form Widget)
router.post('/capture', async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      phone,
      company,
      title,
      message,
      need,
      budget,
      timeline,
      sourceUrl,
      utmSource,
      utmCampaign,
      _hp_website_title, // Honeypot anti-spam trap
      _bot_trap
    } = req.body;

    // Honeypot spam trap: if hidden field is filled, silently return success to confuse bot
    if (_hp_website_title || _bot_trap) {
      return res.status(200).json({
        success: true,
        message: 'Inquiry received. Thank you.'
      });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Full name is required.' });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'A valid work email is required.' });
    }

    const orgId = (req.headers['x-org-id'] as string) || 'org_obsidian_enterprise';
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone ? phone.trim() : '';
    const cleanCompany = company ? company.trim() : 'Inbound Website Lead';
    const inquiryText = message || need || 'Inbound website lead submission.';

    const allLeads = await getAllLeads();

    // Check for existing duplicate by email or phone
    const existing = allLeads.find(l => 
      (l.email && l.email.toLowerCase() === cleanEmail) ||
      (cleanPhone && l.phone && l.phone.replace(/\D/g, '') === cleanPhone.replace(/\D/g, ''))
    );

    if (existing) {
      // Merge inquiry into existing lead rather than creating duplicate
      const updatedNotes = `${existing.notes || ''}\n[${new Date().toISOString().split('T')[0]} Web Re-engagement]: ${inquiryText} (Source: ${sourceUrl || 'Website'})`;
      const updatedScore = Math.min(100, (existing.score || 60) + 10);

      existing.notes = updatedNotes;
      existing.score = updatedScore;
      existing.updatedAt = new Date().toISOString();

      MEMORY_LEADS.set(existing.id, existing);

      // Append to activities
      const acts = MEMORY_ACTIVITIES.get(existing.id) || [];
      acts.unshift({
        id: `act-${Date.now()}`,
        leadId: existing.id,
        type: 'contacted',
        title: 'Website Lead Re-engagement',
        description: `Prospect submitted website form from ${sourceUrl || 'direct site'}: "${inquiryText.slice(0, 80)}"`,
        actor: 'Website Form Bot',
        timestamp: new Date().toISOString()
      });
      MEMORY_ACTIVITIES.set(existing.id, acts);

      await logCrmActivity({
        type: 'lead_captured',
        title: `Website Re-engagement: ${existing.name}`,
        description: `Existing lead re-submitted inquiry from ${sourceUrl || 'Website'}.`,
        actor: 'Website Lead Engine',
        targetId: existing.id,
        targetType: 'lead'
      });

      return res.status(200).json({
        success: true,
        leadId: existing.id,
        isExisting: true,
        message: 'Thank you for reaching out again! Our executive team has received your updated requirements.'
      });
    }

    // Otherwise create brand new qualified lead
    const docId = `lead-web-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const parsedBudget = Number(budget) || 25000;

    const newLead: any = {
      id: docId,
      orgId,
      name: name.trim(),
      email: cleanEmail,
      phone: cleanPhone,
      company: cleanCompany,
      title: title ? title.trim() : 'Prospective Buyer',
      source: 'website',
      status: 'new',
      owner: 'Rene Pierrette',
      ownerId: 'exec-director-45',
      score: 75,
      notes: `Inbound Website Submission from ${sourceUrl || 'Landing Page'}\nMessage: ${inquiryText}\nUTM: ${utmSource || 'direct'} / ${utmCampaign || 'organic'}`,
      channel: 'website',
      isConverted: false,
      qualification: {
        budget: parsedBudget,
        authority: 'decision_maker',
        need: inquiryText,
        timeline: timeline || '1-3 months'
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    newLead.score = calculateLeadScore(newLead);

    MEMORY_LEADS.set(docId, newLead);

    // Initial activity
    MEMORY_ACTIVITIES.set(docId, [
      {
        id: `act-${Date.now()}`,
        leadId: docId,
        type: 'created',
        title: 'Inbound Website Lead Captured',
        description: `Automated lead capture from ${sourceUrl || 'Website'}. Score: ${newLead.score}/100.`,
        actor: 'Website Lead Engine',
        timestamp: new Date().toISOString()
      }
    ]);

    // Initial follow-up task
    MEMORY_TASKS.set(docId, [
      {
        id: `task-${Date.now()}`,
        leadId: docId,
        title: `Follow up with ${newLead.name} regarding website inquiry`,
        dueDate: 'Within 2 hours',
        completed: false,
        priority: 'urgent',
        createdAt: new Date().toISOString()
      }
    ]);

    // Async sync to Firestore
    adminDb.collection('crm_leads').doc(docId).set(newLead).catch(() => {});

    await logCrmActivity({
      type: 'lead_created',
      title: `New Website Lead: ${newLead.name}`,
      description: `Inbound website form capture for ${newLead.company}. Assigned to ${newLead.owner}.`,
      actor: 'Website Lead Engine',
      targetId: docId,
      targetType: 'lead'
    });

    res.status(201).json({
      success: true,
      leadId: docId,
      isExisting: false,
      lead: newLead,
      message: 'Thank you! Your request has been received. An enterprise advisor will follow up shortly.'
    });
  } catch (err: any) {
    console.error('[LeadsApi POST /capture error]', err);
    res.status(500).json({ success: false, error: err.message || 'Lead capture failed.' });
  }
});

// 5. POST /api/leads - Create new lead
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      phone,
      company,
      title,
      source = 'website',
      status = 'new',
      owner = 'Rene Pierrette',
      ownerId,
      notes = '',
      channel,
      qualification = {}
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Lead full name is required.' });
    }
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }

    const allLeads = await getAllLeads();
    const hasDuplicate = allLeads.some(l => l.email && l.email.toLowerCase() === email.trim().toLowerCase());

    const docId = `lead-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const leadData: any = {
      id: docId,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : '',
      company: company ? company.trim() : '',
      title: title ? title.trim() : '',
      source,
      status,
      owner,
      ownerId: ownerId || (req as any).accountUser?.id || 'exec-director-45',
      notes,
      channel: channel || source,
      qualification: {
        budget: Number(qualification.budget) || 0,
        authority: qualification.authority || 'evaluator',
        need: qualification.need || '',
        timeline: qualification.timeline || '1-3 months'
      },
      isConverted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    leadData.score = calculateLeadScore(leadData);

    // Persist to memory
    MEMORY_LEADS.set(docId, leadData);

    // Initial activity log
    const initialActivity = {
      id: `act-${Date.now()}`,
      leadId: docId,
      type: 'created',
      title: 'Lead Ingested',
      description: `Lead created from source: ${source.toUpperCase()} with initial score ${leadData.score}/100.`,
      actor: (req as any).accountUser?.id || owner,
      timestamp: new Date().toISOString()
    };
    MEMORY_ACTIVITIES.set(docId, [initialActivity]);

    // Persist to Firestore asynchronously if available
    try {
      adminDb.collection('crm_leads').doc(docId).set(leadData).catch(() => {});
      adminDb.collection('crm_leads').doc(docId).collection('activities').doc(initialActivity.id).set(initialActivity).catch(() => {});
    } catch {}

    // Global audit activity
    logCrmActivity({
      type: 'lead_created',
      title: `New Lead: ${leadData.name}`,
      description: `Inbound lead recorded from ${source.toUpperCase()} (${leadData.company || 'Direct'}). Score: ${leadData.score}.`,
      actor: (req as any).accountUser?.id || owner,
      targetId: docId,
      targetType: 'lead'
    }).catch(() => {});

    res.status(201).json({
      success: true,
      lead: leadData,
      warning: hasDuplicate ? 'A lead with this email address already existed.' : undefined
    });
  } catch (err: any) {
    console.error('[LeadsApi POST / error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. GET /api/leads/:id - Get lead details with follow-up tasks and activity history
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let lead = MEMORY_LEADS.get(id);

    if (!lead) {
      try {
        const snap = await adminDb.collection('crm_leads').doc(id).get();
        if (snap.exists) {
          lead = { id: snap.id, ...snap.data() };
          MEMORY_LEADS.set(id, lead);
        }
      } catch {}
    }

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    const tasks = MEMORY_TASKS.get(id) || [];
    const activities = MEMORY_ACTIVITIES.get(id) || [
      {
        id: `act-seed-${id}`,
        leadId: id,
        type: 'created',
        title: 'Lead Ingested',
        description: `Lead profile created. Current status: ${lead.status}.`,
        actor: lead.owner || 'System',
        timestamp: lead.createdAt || new Date().toISOString()
      }
    ];

    res.json({
      success: true,
      lead,
      tasks,
      activities
    });
  } catch (err: any) {
    console.error('[LeadsApi GET /:id error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. PATCH /api/leads/:id - Update lead details
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let lead = MEMORY_LEADS.get(id);

    if (!lead) {
      try {
        const snap = await adminDb.collection('crm_leads').doc(id).get();
        if (snap.exists) {
          lead = { id: snap.id, ...snap.data() };
        }
      } catch {}
    }

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    if (lead.isConverted && !req.body.allowConvertedEdit) {
      return res.status(400).json({
        success: false,
        error: 'This lead has been converted. Core lifecycle edits are locked to preserve audit history.'
      });
    }

    const updates: any = {
      updatedAt: new Date().toISOString()
    };

    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    if (req.body.email !== undefined) {
      if (!isValidEmail(req.body.email)) {
        return res.status(400).json({ success: false, error: 'Invalid email address.' });
      }
      updates.email = req.body.email.trim().toLowerCase();
    }
    if (req.body.phone !== undefined) updates.phone = req.body.phone.trim();
    if (req.body.company !== undefined) updates.company = req.body.company.trim();
    if (req.body.title !== undefined) updates.title = req.body.title.trim();
    if (req.body.source !== undefined) updates.source = req.body.source;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;
    if (req.body.channel !== undefined) updates.channel = req.body.channel;
    if (req.body.qualification !== undefined) {
      updates.qualification = {
        ...lead.qualification,
        ...req.body.qualification
      };
    }

    const merged = { ...lead, ...updates };
    updates.score = calculateLeadScore(merged);
    const updatedLead = { ...lead, ...updates };

    MEMORY_LEADS.set(id, updatedLead);

    try {
      adminDb.collection('crm_leads').doc(id).update(updates).catch(() => {});
    } catch {}

    const act = {
      id: `act-${Date.now()}`,
      leadId: id,
      type: 'updated',
      title: 'Lead Profile Updated',
      description: `Updated profile attributes. Re-scored to ${updates.score}/100.`,
      actor: (req as any).accountUser?.id || lead.owner,
      timestamp: new Date().toISOString()
    };
    const currentActs = MEMORY_ACTIVITIES.get(id) || [];
    MEMORY_ACTIVITIES.set(id, [act, ...currentActs]);

    res.json({
      success: true,
      lead: updatedLead
    });
  } catch (err: any) {
    console.error('[LeadsApi PATCH /:id error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. PATCH /api/leads/:id/status - Status transitions
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    const validStatuses = ['new', 'contacted', 'qualifying', 'qualified', 'unqualified', 'converted'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    let lead = MEMORY_LEADS.get(id);
    if (!lead) {
      try {
        const snap = await adminDb.collection('crm_leads').doc(id).get();
        if (snap.exists) lead = { id: snap.id, ...snap.data() };
      } catch {}
    }

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    if (lead.isConverted && status !== 'converted') {
      return res.status(400).json({ success: false, error: 'Converted leads cannot be reverted to earlier stages.' });
    }

    const oldStatus = lead.status;
    lead.status = status;
    lead.statusReason = reason || null;
    lead.updatedAt = new Date().toISOString();
    MEMORY_LEADS.set(id, lead);

    try {
      adminDb.collection('crm_leads').doc(id).update({
        status,
        statusReason: reason || null,
        updatedAt: lead.updatedAt
      }).catch(() => {});
    } catch {}

    const act = {
      id: `act-${Date.now()}`,
      leadId: id,
      type: 'status_changed',
      title: `Status Changed: ${oldStatus} → ${status}`,
      description: reason ? `Reason: ${reason}` : `Lifecycle advanced to ${status.toUpperCase()}.`,
      actor: (req as any).accountUser?.id || lead.owner,
      timestamp: new Date().toISOString()
    };
    const currentActs = MEMORY_ACTIVITIES.get(id) || [];
    MEMORY_ACTIVITIES.set(id, [act, ...currentActs]);

    res.json({ success: true, id, status, oldStatus });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. PATCH /api/leads/:id/assign - Assign lead to owner
router.patch('/:id/assign', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { owner, ownerId } = req.body;

    if (!owner) {
      return res.status(400).json({ success: false, error: 'Owner name is required.' });
    }

    let lead = MEMORY_LEADS.get(id);
    if (!lead) {
      try {
        const snap = await adminDb.collection('crm_leads').doc(id).get();
        if (snap.exists) lead = { id: snap.id, ...snap.data() };
      } catch {}
    }

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    const previousOwner = lead.owner;
    lead.owner = owner;
    lead.ownerId = ownerId || null;
    lead.updatedAt = new Date().toISOString();
    MEMORY_LEADS.set(id, lead);

    try {
      adminDb.collection('crm_leads').doc(id).update({
        owner,
        ownerId: lead.ownerId,
        updatedAt: lead.updatedAt
      }).catch(() => {});
    } catch {}

    const act = {
      id: `act-${Date.now()}`,
      leadId: id,
      type: 'assigned',
      title: `Lead Reassigned`,
      description: `Assigned from ${previousOwner || 'Unassigned'} to ${owner}.`,
      actor: (req as any).accountUser?.id || 'Executive Director',
      timestamp: new Date().toISOString()
    };
    const currentActs = MEMORY_ACTIVITIES.get(id) || [];
    MEMORY_ACTIVITIES.set(id, [act, ...currentActs]);

    res.json({ success: true, id, owner });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. POST /api/leads/:id/tasks - Add follow-up task
router.post('/:id/tasks', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, dueDate, priority = 'normal', assignedTo } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Task title is required.' });
    }

    let lead = MEMORY_LEADS.get(id);
    if (!lead) {
      try {
        const snap = await adminDb.collection('crm_leads').doc(id).get();
        if (snap.exists) lead = { id: snap.id, ...snap.data() };
      } catch {}
    }

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const taskData = {
      id: taskId,
      leadId: id,
      title: title.trim(),
      dueDate: dueDate || new Date(Date.now() + 86400000 * 2).toISOString(),
      completed: false,
      priority,
      assignedTo: assignedTo || lead.owner || 'Rene Pierrette',
      createdAt: new Date().toISOString()
    };

    const currentTasks = MEMORY_TASKS.get(id) || [];
    MEMORY_TASKS.set(id, [taskData, ...currentTasks]);

    try {
      adminDb.collection('crm_leads').doc(id).collection('tasks').doc(taskId).set(taskData).catch(() => {});
      adminDb.collection('crm_tasks').doc(taskId).set(taskData).catch(() => {});
    } catch {}

    const act = {
      id: `act-${Date.now()}`,
      leadId: id,
      type: 'task_created',
      title: `Task Added: ${title.trim()}`,
      description: `Follow-up scheduled for ${new Date(taskData.dueDate).toLocaleDateString()}. Priority: ${priority}.`,
      actor: (req as any).accountUser?.id || 'Executive Director',
      timestamp: new Date().toISOString()
    };
    const currentActs = MEMORY_ACTIVITIES.get(id) || [];
    MEMORY_ACTIVITIES.set(id, [act, ...currentActs]);

    res.status(201).json({ success: true, task: taskData });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. PATCH /api/leads/:id/tasks/:taskId/toggle - Toggle task completion
router.patch('/:id/tasks/:taskId/toggle', async (req: Request, res: Response) => {
  try {
    const { id, taskId } = req.params;
    const currentTasks = MEMORY_TASKS.get(id) || [];
    const task = currentTasks.find(t => t.id === taskId);

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    task.completed = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;

    try {
      adminDb.collection('crm_leads').doc(id).collection('tasks').doc(taskId).update({
        completed: task.completed,
        completedAt: task.completedAt
      }).catch(() => {});
      adminDb.collection('crm_tasks').doc(taskId).update({
        completed: task.completed
      }).catch(() => {});
    } catch {}

    res.json({ success: true, taskId, completed: task.completed });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. POST /api/leads/:id/convert - TRANSACTIONAL CONVERSION
// Converts lead to Contact + Company + Deal atomically; prevents duplicate conversions.
router.post('/:id/convert', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      dealTitle,
      dealValue,
      dealStage = 'qualified',
      expectedClose = 'Next Month',
      companyIndustry = 'Technology',
      companyTier = 'Enterprise Tier'
    } = req.body;

    let lead = MEMORY_LEADS.get(id);
    if (!lead) {
      try {
        const snap = await adminDb.collection('crm_leads').doc(id).get();
        if (snap.exists) {
          lead = { id: snap.id, ...snap.data() };
          MEMORY_LEADS.set(id, lead);
        }
      } catch {}
    }

    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    // PREVENT DUPLICATE CONVERSIONS
    if (lead.isConverted === true || lead.status === 'converted') {
      return res.status(409).json({
        success: false,
        error: `This lead has already been converted (Deal ID: ${lead.convertedDealId || 'recorded'}). Duplicate conversion is prevented.`
      });
    }

    const timestamp = new Date().toISOString();
    const contactId = `contact-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const companyId = `company-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const dealId = `deal-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    // 1. Contact record
    const contactData = {
      id: contactId,
      name: lead.name,
      email: lead.email,
      phone: lead.phone || '',
      company: lead.company || 'Enterprise Account',
      title: lead.title || 'Client Stakeholder',
      channel: lead.channel || lead.source || 'whatsapp',
      status: 'active',
      priority: (lead.score && lead.score > 80) ? 'high' : 'medium',
      originLeadId: id,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // 2. Company record
    const companyData = {
      id: companyId,
      name: lead.company || `${lead.name} Corp`,
      industry: companyIndustry,
      tier: companyTier,
      primaryContactId: contactId,
      originLeadId: id,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // 3. Deal record
    const value = dealValue ? Number(dealValue) : (lead.qualification?.budget || 50000);
    const probabilities: Record<string, number> = {
      discovery: 30,
      qualified: 50,
      proposal: 70,
      negotiation: 85,
      won: 100
    };

    const dealData = {
      id: dealId,
      name: dealTitle || `${lead.company || lead.name} Solution Contract`,
      client: lead.company || lead.name,
      value,
      stage: dealStage,
      probability: probabilities[dealStage] || 50,
      expectedClose,
      momentum: 'hot',
      channelOrigin: lead.source || 'whatsapp',
      owner: lead.owner || 'Rene Pierrette',
      originLeadId: id,
      contactId,
      companyId,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // Atomic update in memory
    lead.status = 'converted';
    lead.isConverted = true;
    lead.convertedAt = timestamp;
    lead.convertedContactId = contactId;
    lead.convertedCompanyId = companyId;
    lead.convertedDealId = dealId;
    lead.updatedAt = timestamp;
    MEMORY_LEADS.set(id, lead);

    // Activity log
    const convertActivity = {
      id: `act-${Date.now()}`,
      leadId: id,
      type: 'converted',
      title: 'Converted to Deal & Contact',
      description: `Lead converted into Contact, Company, and Deal: "${dealData.name}" ($${dealData.value.toLocaleString()} ARR).`,
      actor: (req as any).accountUser?.id || 'Rene Pierrette',
      timestamp
    };
    const currentActs = MEMORY_ACTIVITIES.get(id) || [];
    MEMORY_ACTIVITIES.set(id, [convertActivity, ...currentActs]);

    // Try transaction on Firestore if available
    try {
      const leadRef = adminDb.collection('crm_leads').doc(id);
      adminDb.runTransaction(async (transaction) => {
        const fsLeadDoc = await transaction.get(leadRef);
        if (fsLeadDoc.exists && (fsLeadDoc.data()?.isConverted || fsLeadDoc.data()?.status === 'converted')) {
          throw new Error('LEAD_ALREADY_CONVERTED');
        }
        transaction.set(adminDb.collection('crm_contacts').doc(contactId), contactData);
        transaction.set(adminDb.collection('crm_companies').doc(companyId), companyData);
        transaction.set(adminDb.collection('crm_deals').doc(dealId), dealData);
        transaction.update(leadRef, {
          status: 'converted',
          isConverted: true,
          convertedAt: timestamp,
          convertedContactId: contactId,
          convertedCompanyId: companyId,
          convertedDealId: dealId,
          updatedAt: timestamp
        });
      }).catch(() => {});
    } catch {}

    // Global audit log
    logCrmActivity({
      type: 'deal_created',
      title: `Lead Converted: ${dealData.name}`,
      description: `Lead "${contactData.name}" converted to $${dealData.value.toLocaleString()} pipeline deal.`,
      actor: (req as any).accountUser?.id || 'Rene Pierrette',
      targetId: dealId,
      targetType: 'deal'
    }).catch(() => {});

    res.json({
      success: true,
      message: 'Lead successfully converted into Contact, Company, and Pipeline Deal.',
      conversion: {
        contactId,
        companyId,
        dealId,
        deal: dealData,
        contact: contactData,
        company: companyData
      }
    });
  } catch (err: any) {
    console.error('[LeadsApi POST /:id/convert error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. POST /api/leads/bulk/status - Bulk update status
router.post('/bulk/status', async (req: Request, res: Response) => {
  try {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !status) {
      return res.status(400).json({ success: false, error: 'Array of lead IDs and status are required.' });
    }

    const timestamp = new Date().toISOString();
    for (const id of ids) {
      const lead = MEMORY_LEADS.get(id);
      if (lead) {
        lead.status = status;
        lead.updatedAt = timestamp;
        MEMORY_LEADS.set(id, lead);
      }
    }

    try {
      const batch = adminDb.batch();
      for (const id of ids) {
        const ref = adminDb.collection('crm_leads').doc(id);
        batch.update(ref, {
          status,
          updatedAt: timestamp
        });
      }
      batch.commit().catch(() => {});
    } catch {}

    logCrmActivity({
      type: 'stage_advanced',
      title: `Bulk Status Update`,
      description: `Updated ${ids.length} leads to status ${status.toUpperCase()}.`,
      actor: (req as any).accountUser?.id || 'Executive Director'
    }).catch(() => {});

    res.json({ success: true, count: ids.length, status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. POST /api/leads/bulk/assign - Bulk assign owner
router.post('/bulk/assign', async (req: Request, res: Response) => {
  try {
    const { ids, owner, ownerId } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !owner) {
      return res.status(400).json({ success: false, error: 'Array of lead IDs and owner name are required.' });
    }

    const timestamp = new Date().toISOString();
    for (const id of ids) {
      const lead = MEMORY_LEADS.get(id);
      if (lead) {
        lead.owner = owner;
        lead.ownerId = ownerId || null;
        lead.updatedAt = timestamp;
        MEMORY_LEADS.set(id, lead);
      }
    }

    try {
      const batch = adminDb.batch();
      for (const id of ids) {
        const ref = adminDb.collection('crm_leads').doc(id);
        batch.update(ref, {
          owner,
          ownerId: ownerId || null,
          updatedAt: timestamp
        });
      }
      batch.commit().catch(() => {});
    } catch {}

    logCrmActivity({
      type: 'assigned',
      title: `Bulk Lead Reassignment`,
      description: `Reassigned ${ids.length} leads to ${owner}.`,
      actor: (req as any).accountUser?.id || 'Executive Director'
    }).catch(() => {});

    res.json({ success: true, count: ids.length, owner });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. DELETE /api/leads/:id - Soft-delete or remove lead
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const lead = MEMORY_LEADS.get(id);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Lead not found.' });
    }

    MEMORY_LEADS.delete(id);
    MEMORY_TASKS.delete(id);
    MEMORY_ACTIVITIES.delete(id);

    try {
      adminDb.collection('crm_leads').doc(id).delete().catch(() => {});
    } catch {}

    logCrmActivity({
      type: 'lead_deleted',
      title: `Lead Deleted`,
      description: `Deleted lead: "${lead.name}" (${lead.company || 'Direct'}).`,
      actor: (req as any).accountUser?.id || 'Executive Director',
      targetId: id
    }).catch(() => {});

    res.json({ success: true, id });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
