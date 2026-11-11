/**
 * Leads API: tenant-scoped (organizations/{orgId}/leads).
 *
 * Mounted in server.ts behind guard(PUBLIC.leads). Every route except POST /capture then requires a
 * resolved tenant (requireTenant) and a role that allows the action. Response shapes are unchanged
 * from the previous implementation so the existing UI keeps working.
 *
 * POST /capture is the public website form. It is attributed to an organization by its lead-capture
 * key (X-Lead-Capture-Key header or `formKey` field), created in Settings → Organization. Never by a
 * client-chosen org id. LEGACY_LEAD_CAPTURE_ORG_ID routes key-less submissions to one org during migration.
 */
import { refreshLeadIntelligence } from '../server/crm/leadIntelligence';
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { calculateLeadScore } from './dashboardApi';
import { CrmRepository, orgForLeadCaptureKey } from '../server/crm/crmRepository';
import { newId } from '../server/data/docStore';
import { TaskService } from '../server/crm/tasks';
import { existingForLead } from '../server/crm/contacts';
import { requirePermission, requireReadOrWrite, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { TenancyError } from '../server/tenancy/orgs';

const router = Router();

const LEAD_STATUSES = ['new', 'contacted', 'qualifying', 'qualified', 'unqualified', 'converted'] as const;
const BULK_MAX = 200;

function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
/** Trimmed string limited to `max` characters; '' for anything that isn't a string. */
function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
const nowIso = () => new Date().toISOString();
const digits = (p: unknown) => (typeof p === 'string' ? p.replace(/\D/g, '') : '');

async function repoFor(req: Request) {
  return CrmRepository.forOrg(tenantOf(req).orgId);
}
function actorOf(req: Request) {
  const t = tenantOf(req);
  return t.name || t.email || t.userId;
}

// ---------------------------------------------------------------------------
// PUBLIC: website lead form
// ---------------------------------------------------------------------------
const captureLimiter = rateLimit({
  windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { success: false, error: 'Too many submissions. Please try again later.' },
});

router.post('/capture', captureLimiter, async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    // Honeypot spam trap: a filled hidden field gets a quiet success and nothing is stored.
    if (b._hp_website_title || b._bot_trap) {
      return res.status(200).json({ success: true, message: 'Inquiry received. Thank you.' });
    }

    const orgId = (await orgForLeadCaptureKey(req.get('x-lead-capture-key') || b.formKey)) || process.env.LEGACY_LEAD_CAPTURE_ORG_ID?.trim() || null;
    if (!orgId) {
      return res.status(401).json({ success: false, code: 'form_not_connected', error: 'This form isn’t connected to an organization. Add its lead-capture key.' });
    }

    const name = str(b.name, 120);
    if (!name) return res.status(400).json({ success: false, error: 'Full name is required.' });
    if (!isValidEmail(b.email)) return res.status(400).json({ success: false, error: 'A valid work email is required.' });

    const repo = await CrmRepository.forOrg(orgId);
    const cleanEmail = b.email.trim().toLowerCase();
    const cleanPhone = str(b.phone, 40);
    const inquiryText = str(b.message, 4000) || str(b.need, 4000) || 'Inbound website lead submission.';
    const sourceUrl = str(b.sourceUrl, 500);

    const existing = (await repo.listLeads()).find((l) =>
      (l.email && String(l.email).toLowerCase() === cleanEmail) || (cleanPhone && digits(l.phone) && digits(l.phone) === digits(cleanPhone)));

    if (existing) {
      // Merge the new inquiry into the existing lead instead of creating a duplicate.
      await repo.updateLead(existing.id, {
        notes: `${existing.notes || ''}\n[${nowIso().split('T')[0]} Web Re-engagement]: ${inquiryText} (Source: ${sourceUrl || 'Website'})`,
        score: Math.min(100, (Number(existing.score) || 60) + 10),
        updatedAt: nowIso(),
      });
      await repo.addLeadActivity(existing.id, {
        type: 'contacted', title: 'Website Lead Re-engagement', actor: 'Website Form',
        description: `Prospect submitted the website form from ${sourceUrl || 'direct site'}: "${inquiryText.slice(0, 80)}"`,
      });
      await repo.logActivity({ type: 'lead_captured', title: `Website Re-engagement: ${existing.name}`, description: `Existing lead re-submitted an inquiry from ${sourceUrl || 'Website'}.`, actor: 'Website Form', targetId: existing.id, targetType: 'lead' });
      return res.status(200).json({ success: true, leadId: existing.id, isExisting: true, message: 'Thank you for reaching out again! We have received your updated requirements.' });
    }

    const lead: any = {
      id: newId('lead'),
      name, email: cleanEmail, phone: cleanPhone,
      company: str(b.company, 160) || 'Inbound Website Lead',
      title: str(b.title, 120) || 'Prospective Buyer',
      source: 'website', channel: 'website', status: 'new',
      owner: '', ownerId: null, // unassigned until someone in the org picks it up
      notes: `Inbound Website Submission from ${sourceUrl || 'Landing Page'}\nMessage: ${inquiryText}\nUTM: ${str(b.utmSource, 100) || 'direct'} / ${str(b.utmCampaign, 100) || 'organic'}`,
      isConverted: false,
      qualification: { budget: Number(b.budget) > 0 ? Number(b.budget) : 0, authority: 'unknown', need: inquiryText, timeline: str(b.timeline, 60) || 'unknown' },
      createdAt: nowIso(), updatedAt: nowIso(),
    };
    lead.score = calculateLeadScore(lead);
    const saved = await repo.saveLead(lead);
    await repo.addLeadActivity(lead.id, { type: 'created', title: 'Inbound Website Lead Captured', description: `Captured from ${sourceUrl || 'Website'}. Score: ${lead.score}/100.`, actor: 'Website Form' });
    await (await TaskService.forOrg(orgId)).create({ title: `Follow up with ${lead.name} regarding website inquiry`, type: 'follow_up', dueDate: new Date(Date.now() + 2 * 3600_000).toISOString(), priority: 'urgent', leadId: lead.id, assignedTo: lead.owner || '', assigneeId: null },
      { userId: 'website-form', name: 'Website Form' }, { source: 'website' });
    await repo.logActivity({ type: 'lead_created', title: `New Website Lead: ${lead.name}`, description: `Website form capture for ${lead.company}.`, actor: 'Website Form', targetId: lead.id, targetType: 'lead' });

    // The public response doesn't echo the stored record back to an anonymous caller.
    await refreshLeadIntelligence(orgId, saved.id); // classify incoming web leads immediately (never throws)
    return res.status(201).json({ success: true, leadId: saved.id, isExisting: false, message: 'Thank you! Your request has been received. We will follow up shortly.' });
  } catch (err) {
    return sendError(res, err, 'leads.capture');
  }
});

// ---------------------------------------------------------------------------
// Everything below: signed-in member of the organization
// ---------------------------------------------------------------------------
router.use(requireTenant, requireReadOrWrite);

// GET /api/leads: search, filter, sort
router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, status, source, owner, minScore, sortBy = 'createdAt', sortOrder = 'desc' } = req.query as Record<string, string>;
    let leads = await (await repoFor(req)).listLeads();
    if (status && status !== 'all') leads = leads.filter((l) => l.status === status);
    if (source && source !== 'all') leads = leads.filter((l) => l.source === source);
    if (owner && owner !== 'all') leads = leads.filter((l) => l.owner === owner);
    if (typeof search === 'string' && search) {
      const q = search.toLowerCase();
      leads = leads.filter((l) => ['name', 'email', 'company', 'title', 'notes'].some((f) => typeof l[f] === 'string' && l[f].toLowerCase().includes(q)));
    }
    const min = Number(minScore);
    if (minScore && !isNaN(min)) leads = leads.filter((l) => (Number(l.score) || 0) >= min);
    const numeric = sortBy === 'score' || sortBy === 'budget';
    leads.sort((a, b) => {
      const va = numeric ? Number(a[sortBy] || 0) : String(a[sortBy] ?? '').toLowerCase();
      const vb = numeric ? Number(b[sortBy] || 0) : String(b[sortBy] ?? '').toLowerCase();
      return va < vb ? (sortOrder === 'asc' ? -1 : 1) : va > vb ? (sortOrder === 'asc' ? 1 : -1) : 0;
    });
    res.json({ success: true, count: leads.length, leads });
  } catch (err) { sendError(res, err, 'leads.list'); }
});

// GET /api/leads/analytics
router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const leads = await (await repoFor(req)).listLeads();
    const total = leads.length;
    const isConv = (l: any) => l.isConverted || l.status === 'converted';
    const byStatus = (s: string) => leads.filter((l) => l.status === s).length;
    const converted = leads.filter(isConv).length;
    const breakdown = (key: (l: any) => string) => {
      const out: Record<string, { total: number; converted: number; rate: number }> = {};
      for (const l of leads) {
        const k = key(l);
        out[k] ??= { total: 0, converted: 0, rate: 0 };
        out[k].total++; if (isConv(l)) out[k].converted++;
      }
      for (const v of Object.values(out)) v.rate = v.total ? Number(((v.converted / v.total) * 100).toFixed(1)) : 0;
      return out;
    };
    res.json({
      success: true,
      analytics: {
        totalLeads: total,
        convertedCount: converted,
        conversionRate: total ? Number(((converted / total) * 100).toFixed(1)) : 0,
        qualificationRate: total ? Number((((byStatus('qualified') + converted) / total) * 100).toFixed(1)) : 0,
        avgScore: total ? Math.round(leads.reduce((a, l) => a + (Number(l.score) || 0), 0) / total) : 0,
        funnel: [
          { stage: 'new', label: 'New Inbound', count: byStatus('new') },
          { stage: 'contacted', label: 'Contacted', count: byStatus('contacted') },
          { stage: 'qualifying', label: 'Qualifying', count: byStatus('qualifying') },
          { stage: 'qualified', label: 'Qualified', count: byStatus('qualified') },
          { stage: 'converted', label: 'Converted to Deal', count: converted },
          { stage: 'unqualified', label: 'Unqualified / Dropped', count: byStatus('unqualified') },
        ],
        sourceBreakdown: breakdown((l) => l.source || 'other'),
        repPerformance: breakdown((l) => l.owner || 'Unassigned'),
      },
    });
  } catch (err) { sendError(res, err, 'leads.analytics'); }
});

// GET /api/leads/duplicates?email=&phone=&company=
router.get('/duplicates', async (req: Request, res: Response) => {
  try {
    const email = str(req.query.email, 254).toLowerCase();
    const phone = digits(str(req.query.phone, 40));
    const company = str(req.query.company, 160).toLowerCase();
    if (!email && !phone && !company) return res.json({ success: true, duplicates: [] });
    const duplicates = [];
    for (const l of await (await repoFor(req)).listLeads()) {
      const reasons: string[] = [];
      if (email && String(l.email || '').toLowerCase() === email) reasons.push('Exact email match');
      if (phone && digits(l.phone) === phone) reasons.push('Phone number match');
      if (company && String(l.company || '').toLowerCase() === company) reasons.push('Same company name');
      if (reasons.length) duplicates.push({ id: l.id, name: l.name, email: l.email, company: l.company, status: l.status, reasons });
    }
    res.json({ success: true, hasDuplicates: duplicates.length > 0, duplicates });
  } catch (err) { sendError(res, err, 'leads.duplicates'); }
});

// POST /api/leads: create
router.post('/', async (req: Request, res: Response) => {
  try {
    const b = req.body || {};
    const name = str(b.name, 120);
    if (!name) return res.status(400).json({ success: false, error: 'Lead full name is required.' });
    if (!isValidEmail(b.email)) return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    const status = LEAD_STATUSES.includes(b.status) && b.status !== 'converted' ? b.status : 'new';
    const repo = await repoFor(req);
    const t = tenantOf(req);
    const email = b.email.trim().toLowerCase();
    const hasDuplicate = (await repo.listLeads()).some((l) => String(l.email || '').toLowerCase() === email);
    const q = b.qualification && typeof b.qualification === 'object' ? b.qualification : {};
    const source = str(b.source, 40) || 'website';
    const lead: any = {
      id: newId('lead'), name, email,
      phone: str(b.phone, 40), company: str(b.company, 160), title: str(b.title, 120),
      source, status, channel: str(b.channel, 40) || source,
      owner: str(b.owner, 120) || t.name || t.email, ownerId: t.userId,
      notes: str(b.notes, 10_000),
      qualification: { budget: Number(q.budget) || 0, authority: str(q.authority, 40) || 'evaluator', need: str(q.need, 2000), timeline: str(q.timeline, 60) || '1-3 months' },
      isConverted: false, createdAt: nowIso(), updatedAt: nowIso(),
    };
    lead.score = calculateLeadScore(lead);
    await repo.saveLead(lead);
    await repo.addLeadActivity(lead.id, { type: 'created', title: 'Lead Ingested', description: `Lead created from source: ${source.toUpperCase()} with initial score ${lead.score}/100.`, actor: actorOf(req) });
    await repo.logActivity({ type: 'lead_created', title: `New Lead: ${lead.name}`, description: `Lead recorded from ${source.toUpperCase()} (${lead.company || 'Direct'}). Score: ${lead.score}.`, actor: actorOf(req), targetId: lead.id, targetType: 'lead' });
    // Classify the new lead straight away (Hot / Warm / Cold); never blocks creation.
    const ai = await refreshLeadIntelligence(t.orgId, lead.id);
    res.status(201).json({ success: true, lead: { ...lead, orgId: t.orgId, ...(ai ? { aiScore: ai.score, aiClass: ai.classification } : {}) }, ...(ai ? { intelligence: ai } : {}), warning: hasDuplicate ? 'A lead with this email address already existed.' : undefined });
  } catch (err) { sendError(res, err, 'leads.create'); }
});

// Bulk operations (manager and above). Unknown ids are skipped and reported.
async function bulkApply(req: Request, ids: unknown, fn: (repo: CrmRepository, id: string) => Promise<boolean>) {
  if (!Array.isArray(ids) || ids.length === 0) throw new TenancyError(400, 'invalid_ids', 'An array of lead IDs is required.');
  if (ids.length > BULK_MAX) throw new TenancyError(400, 'too_many', `At most ${BULK_MAX} leads per request.`);
  const repo = await repoFor(req);
  const updated: string[] = [], skipped: string[] = [];
  for (const id of ids) {
    if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && (await fn(repo, id))) updated.push(id);
    else skipped.push(String(id).slice(0, 128));
  }
  return { repo, updated, skipped };
}

router.post('/bulk/status', requirePermission('manage_records'), async (req, res) => {
  try {
    const { ids, status } = req.body || {};
    if (!LEAD_STATUSES.includes(status) || status === 'converted') return res.status(400).json({ success: false, error: 'Invalid status. Use lead conversion to convert leads.' });
    const r = await bulkApply(req, ids, async (repo, id) => {
      const l = await repo.getLead(id);
      return !!l && !l.isConverted && repo.updateLead(id, { status, updatedAt: nowIso() });
    });
    if (r.updated.length) await r.repo.logActivity({ type: 'stage_advanced', title: 'Bulk Status Update', description: `Updated ${r.updated.length} leads to status ${status.toUpperCase()}.`, actor: actorOf(req) });
    res.json({ success: true, count: r.updated.length, skipped: r.skipped, status });
  } catch (err) { sendError(res, err, 'leads.bulkStatus'); }
});

router.post('/bulk/assign', requirePermission('manage_records'), async (req, res) => {
  try {
    const owner = str(req.body?.owner, 120);
    if (!owner) return res.status(400).json({ success: false, error: 'Owner name is required.' });
    const ownerId = str(req.body?.ownerId, 128) || null;
    const r = await bulkApply(req, req.body?.ids, (repo, id) => repo.updateLead(id, { owner, ownerId, updatedAt: nowIso() }));
    if (r.updated.length) await r.repo.logActivity({ type: 'assigned', title: 'Bulk Lead Reassignment', description: `Reassigned ${r.updated.length} leads to ${owner}.`, actor: actorOf(req) });
    res.json({ success: true, count: r.updated.length, skipped: r.skipped, owner });
  } catch (err) { sendError(res, err, 'leads.bulkAssign'); }
});

// POST /api/leads/bulk { action: 'assign'|'status'|'delete', leadIds, owner?, status? } (used by the pipeline view)
router.post('/bulk', requirePermission('manage_records'), async (req, res) => {
  try {
    const { action, leadIds } = req.body || {};
    if (action === 'delete') {
      const r = await bulkApply(req, leadIds, (repo, id) => repo.deleteLead(id));
      if (r.updated.length) await r.repo.logActivity({ type: 'lead_deleted', title: 'Bulk Lead Deletion', description: `Deleted ${r.updated.length} leads.`, actor: actorOf(req) });
      return res.json({ success: true, action, count: r.updated.length, skipped: r.skipped });
    }
    if (action === 'status') {
      const status = req.body.status;
      if (!LEAD_STATUSES.includes(status) || status === 'converted') return res.status(400).json({ success: false, error: 'Invalid status.' });
      const r = await bulkApply(req, leadIds, async (repo, id) => { const l = await repo.getLead(id); return !!l && !l.isConverted && repo.updateLead(id, { status, updatedAt: nowIso() }); });
      return res.json({ success: true, action, count: r.updated.length, skipped: r.skipped });
    }
    if (action === 'assign') {
      const owner = str(req.body.owner, 120);
      if (!owner) return res.status(400).json({ success: false, error: 'Owner name is required.' });
      const r = await bulkApply(req, leadIds, (repo, id) => repo.updateLead(id, { owner, updatedAt: nowIso() }));
      return res.json({ success: true, action, count: r.updated.length, skipped: r.skipped });
    }
    res.status(400).json({ success: false, error: 'Unknown bulk action.' });
  } catch (err) { sendError(res, err, 'leads.bulk'); }
});

// GET /api/leads/:id: lead + tasks + activity history
router.get('/:id', async (req, res) => {
  try {
    const repo = await repoFor(req);
    const lead = await repo.getLead(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    const [tasks, activities] = await Promise.all([
      TaskService.forOrg(tenantOf(req).orgId).then((s) => s.list({ leadId: lead.id, includeDone: true, view: 'all' })),
      repo.listLeadActivities(lead.id),
    ]);
    res.json({ success: true, lead, tasks, activities });
  } catch (err) { sendError(res, err, 'leads.get'); }
});

// PATCH /api/leads/:id: update profile fields
router.patch('/:id', async (req, res) => {
  try {
    const repo = await repoFor(req);
    const lead = await repo.getLead(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    const b = req.body || {};
    if (lead.isConverted && !b.allowConvertedEdit) {
      return res.status(400).json({ success: false, error: 'This lead has been converted. Core lifecycle edits are locked to preserve audit history.' });
    }
    const updates: any = { updatedAt: nowIso() };
    if (b.name !== undefined) { updates.name = str(b.name, 120); if (!updates.name) return res.status(400).json({ success: false, error: 'Name can’t be empty.' }); }
    if (b.email !== undefined) { if (!isValidEmail(b.email)) return res.status(400).json({ success: false, error: 'Invalid email address.' }); updates.email = b.email.trim().toLowerCase(); }
    for (const [f, max] of [['phone', 40], ['company', 160], ['title', 120], ['source', 40], ['channel', 40], ['notes', 10_000]] as const) {
      if (b[f] !== undefined) updates[f] = str(b[f], max);
    }
    if (b.qualification && typeof b.qualification === 'object') {
      const q = b.qualification;
      updates.qualification = { ...lead.qualification,
        ...(q.budget !== undefined ? { budget: Number(q.budget) || 0 } : {}),
        ...(q.authority !== undefined ? { authority: str(q.authority, 40) } : {}),
        ...(q.need !== undefined ? { need: str(q.need, 2000) } : {}),
        ...(q.timeline !== undefined ? { timeline: str(q.timeline, 60) } : {}) };
    }
    updates.score = calculateLeadScore({ ...lead, ...updates });
    await repo.updateLead(lead.id, updates);
    await repo.addLeadActivity(lead.id, { type: 'updated', title: 'Lead Profile Updated', description: `Updated profile attributes. Re-scored to ${updates.score}/100.`, actor: actorOf(req) });
    res.json({ success: true, lead: { ...lead, ...updates } });
  } catch (err) { sendError(res, err, 'leads.update'); }
});

// PATCH /api/leads/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    const reason = str(req.body?.reason, 500);
    if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${LEAD_STATUSES.join(', ')}` });
    if (status === 'converted') return res.status(400).json({ success: false, error: 'Use “Convert” to turn a lead into a deal.' });
    const repo = await repoFor(req);
    const lead = await repo.getLead(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    if (lead.isConverted) return res.status(400).json({ success: false, error: 'Converted leads cannot be reverted to earlier stages.' });
    await repo.updateLead(lead.id, { status, statusReason: reason || null, updatedAt: nowIso() });
    await repo.addLeadActivity(lead.id, { type: 'status_changed', title: `Status Changed: ${lead.status} → ${status}`, description: reason ? `Reason: ${reason}` : `Lifecycle advanced to ${status.toUpperCase()}.`, actor: actorOf(req) });
    res.json({ success: true, id: lead.id, status, oldStatus: lead.status });
  } catch (err) { sendError(res, err, 'leads.status'); }
});

// PATCH /api/leads/:id/assign
router.patch('/:id/assign', async (req, res) => {
  try {
    const owner = str(req.body?.owner, 120);
    if (!owner) return res.status(400).json({ success: false, error: 'Owner name is required.' });
    const repo = await repoFor(req);
    const lead = await repo.getLead(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    await repo.updateLead(lead.id, { owner, ownerId: str(req.body?.ownerId, 128) || null, updatedAt: nowIso() });
    await repo.addLeadActivity(lead.id, { type: 'assigned', title: 'Lead Reassigned', description: `Assigned from ${lead.owner || 'Unassigned'} to ${owner}.`, actor: actorOf(req) });
    res.json({ success: true, id: lead.id, owner });
  } catch (err) { sendError(res, err, 'leads.assign'); }
});

// POST /api/leads/:id/tasks
router.post('/:id/tasks', async (req, res) => {
  try {
    const title = str(req.body?.title, 300);
    if (!title) return res.status(400).json({ success: false, error: 'Task title is required.' });
    const repo = await repoFor(req);
    const lead = await repo.getLead(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    const due = str(req.body?.dueDate, 40);
    const priority = ['low', 'normal', 'high', 'urgent'].includes(req.body?.priority) ? req.body.priority : 'normal';
    const t = tenantOf(req);
    const task = await (await TaskService.forOrg(t.orgId)).create({
      title, type: 'follow_up', priority, leadId: lead.id,
      dueDate: due && !isNaN(Date.parse(due)) ? new Date(due).toISOString() : new Date(Date.now() + 2 * 86400_000).toISOString(),
      assignedTo: str(req.body?.assignedTo, 120) || lead.owner || '', assigneeId: str(req.body?.assigneeId, 128) || (lead.ownerId ?? null),
    }, { userId: t.userId, name: actorOf(req) }, { source: 'lead' });
    await repo.addLeadActivity(lead.id, { type: 'task_created', title: `Task Added: ${title}`, description: `Follow-up scheduled for ${new Date(task.dueDate!).toLocaleDateString()}. Priority: ${priority}.`, actor: actorOf(req) });
    res.status(201).json({ success: true, task });
  } catch (err) { sendError(res, err, 'leads.addTask'); }
});

async function setTaskCompleted(req: Request, res: Response, desired: boolean | null) {
  const t = tenantOf(req);
  const tasks = await TaskService.forOrg(t.orgId);
  const task = await tasks.adopt(req.params.taskId);
  if (!task || task.leadId !== req.params.id) return res.status(404).json({ success: false, error: 'Task not found.' });
  const completed = desired ?? !task.completed;
  await tasks.update(task.id, { completed }, { userId: t.userId, name: actorOf(req) });
  res.json({ success: true, taskId: task.id, completed });
}
// PATCH /api/leads/:id/tasks/:taskId/toggle   and   PATCH /api/leads/:id/tasks/:taskId { completed }
router.patch('/:id/tasks/:taskId/toggle', (req, res) => setTaskCompleted(req, res, null).catch((e) => sendError(res, e, 'leads.toggleTask')));
router.patch('/:id/tasks/:taskId', (req, res) => {
  if (typeof req.body?.completed !== 'boolean') return res.status(400).json({ success: false, error: '`completed` (true/false) is required.' });
  setTaskCompleted(req, res, req.body.completed).catch((e) => sendError(res, e, 'leads.updateTask'));
});

// POST /api/leads/:id/convert: contact + company + deal in one transaction; duplicates → 409
router.post('/:id/convert', async (req, res) => {
  try {
    const b = req.body || {};
    const repo = await repoFor(req);
    const probabilities: Record<string, number> = { discovery: 30, qualified: 50, proposal: 70, negotiation: 85, won: 100 };
    const dealStage = probabilities[b.dealStage] !== undefined ? b.dealStage : 'qualified';
    const ts = nowIso();
    const pre = await repo.getLead(req.params.id);
    const known = pre ? await existingForLead(tenantOf(req).orgId, pre) : { contact: null, company: null };
    const result = await repo.convertLead(req.params.id, (lead) => {
      const contactId = known.contact?.id || newId('contact'), companyId = known.company?.id || newId('company'), dealId = newId('deal');
      const value = Number(b.dealValue) > 0 ? Number(b.dealValue) : (Number(lead.qualification?.budget) || 0);
      const deal = {
        id: dealId, name: str(b.dealTitle, 200) || `${lead.company || lead.name} Solution Contract`, client: lead.company || lead.name,
        value, stage: dealStage, probability: probabilities[dealStage], expectedClose: str(b.expectedClose, 60) || 'Next Month',
        momentum: 'hot', channelOrigin: lead.source || 'other', owner: lead.owner || actorOf(req),
        originLeadId: lead.id, contactId, companyId, createdAt: ts, updatedAt: ts,
      };
      return {
        contact: known.contact
          ? { ...known.contact, leadIds: [...new Set([...(known.contact.leadIds || []), lead.id])], companyId: known.contact.companyId || companyId, phone: known.contact.phone || lead.phone || '', title: known.contact.title || lead.title || '', updatedAt: ts }
          : { id: contactId, name: lead.name, email: lead.email, phone: lead.phone || '', company: lead.company || '', companyId, title: lead.title || '', channel: lead.channel || lead.source || 'other', status: 'active', priority: (lead.score || 0) > 80 ? 'high' : 'medium', ownerId: lead.ownerId ?? null, owner: lead.owner || '', tags: [], leadIds: [lead.id], originLeadId: lead.id, createdAt: ts, updatedAt: ts },
        company: known.company
          ? { ...known.company, primaryContactId: known.company.primaryContactId || contactId, updatedAt: ts }
          : { id: companyId, name: lead.company || `${lead.name} Corp`, industry: str(b.companyIndustry, 80) || 'Unspecified', tier: str(b.companyTier, 80) || 'Unspecified', primaryContactId: contactId, originLeadId: lead.id, createdAt: ts, updatedAt: ts },
        deal,
        activity: { id: newId('act'), type: 'converted', title: 'Converted to Deal & Contact', description: `Lead converted into Contact, Company, and Deal: "${deal.name}" ($${value.toLocaleString()}).`, actor: actorOf(req), timestamp: ts },
        leadPatch: { status: 'converted', isConverted: true, convertedAt: ts, convertedContactId: contactId, convertedCompanyId: companyId, convertedDealId: dealId, updatedAt: ts },
      };
    });
    await repo.logActivity({ type: 'deal_created', title: `Lead Converted: ${result.deal.name}`, description: `Lead "${result.contact.name}" converted to a $${result.deal.value.toLocaleString()} pipeline deal.`, actor: actorOf(req), targetId: result.deal.id, targetType: 'deal' });
    res.json({ success: true, message: 'Lead successfully converted into Contact, Company, and Pipeline Deal.', conversion: { contactId: result.contact.id, companyId: result.company.id, dealId: result.deal.id, deal: result.deal, contact: result.contact, company: result.company } });
  } catch (err) { sendError(res, err, 'leads.convert'); }
});

// DELETE /api/leads/:id (manager and above). Deletes the lead with its tasks and activity.
router.delete('/:id', requirePermission('manage_records'), async (req, res) => {
  try {
    const repo = await repoFor(req);
    const lead = await repo.getLead(req.params.id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found.' });
    await repo.deleteLead(lead.id);
    await repo.logActivity({ type: 'lead_deleted', title: 'Lead Deleted', description: `Deleted lead: "${lead.name}" (${lead.company || 'Direct'}).`, actor: actorOf(req), targetId: lead.id });
    res.json({ success: true, id: lead.id });
  } catch (err) { sendError(res, err, 'leads.delete'); }
});

export default router;
