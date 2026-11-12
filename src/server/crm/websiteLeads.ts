/**
 * One place that turns a website inquiry into CRM records, used by the website form pipeline (built-in CRM
 * adapter, src/server/webforms) and the older POST /api/leads/capture.
 *
 * - An existing lead with the same email (or phone) gets the new inquiry appended instead of a duplicate.
 * - A new lead gets a score, an activity entry, an urgent follow-up task, and lead intelligence.
 * Input must already be validated and sanitized by the caller.
 */
import { CrmRepository } from './crmRepository';
import { TaskService } from './tasks';
import { refreshLeadIntelligence } from './leadIntelligence';
import { newId } from '../data/docStore';
import { calculateLeadScore } from '../../routes/dashboardApi';

export interface WebsiteLeadInput {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  title?: string;
  message?: string;
  sourceUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  /** Visitor ticked the marketing box on the form (consent itself is recorded in Privacy & Compliance). */
  marketingOptIn?: boolean;
  budget?: number;
  timeline?: string;
  /** Shown in activity entries ("Website Form", "Contact form"…). */
  formLabel?: string;
}

const nowIso = () => new Date().toISOString();
const digits = (p: unknown) => (typeof p === 'string' ? p.replace(/\D/g, '') : '');

export async function upsertWebsiteLead(orgId: string, input: WebsiteLeadInput): Promise<{ leadId: string; isExisting: boolean }> {
  const repo = await CrmRepository.forOrg(orgId);
  const actor = input.formLabel || 'Website Form';
  const email = input.email.trim().toLowerCase();
  const phone = input.phone || '';
  const inquiry = input.message || 'Inbound website lead submission.';
  const sourceUrl = input.sourceUrl || '';

  const existing = (await repo.listLeads()).find((l: any) =>
    (l.email && String(l.email).toLowerCase() === email) || (phone && digits(l.phone) && digits(l.phone) === digits(phone)));

  if (existing) {
    await repo.updateLead(existing.id, {
      notes: `${existing.notes || ''}\n[${nowIso().split('T')[0]} Web Re-engagement]: ${inquiry} (Source: ${sourceUrl || 'Website'})`,
      score: Math.min(100, (Number(existing.score) || 60) + 10),
      updatedAt: nowIso(),
    });
    await repo.addLeadActivity(existing.id, {
      type: 'contacted', title: 'Website Lead Re-engagement', actor,
      description: `Prospect submitted the website form from ${sourceUrl || 'direct site'}: "${inquiry.slice(0, 80)}"`,
    });
    await repo.logActivity({ type: 'lead_captured', title: `Website Re-engagement: ${existing.name}`, description: `Existing lead re-submitted an inquiry from ${sourceUrl || 'Website'}.`, actor, targetId: existing.id, targetType: 'lead' });
    return { leadId: existing.id, isExisting: true };
  }

  const lead: any = {
    id: newId('lead'),
    name: input.name, email, phone,
    company: input.company || 'Inbound Website Lead',
    title: input.title || 'Prospective Buyer',
    source: 'website', channel: 'website', status: 'new',
    owner: '', ownerId: null, // unassigned until someone in the org picks it up
    notes: `Inbound Website Submission from ${sourceUrl || 'Landing Page'}\nMessage: ${inquiry}\nUTM: ${input.utmSource || 'direct'} / ${input.utmMedium || 'none'} / ${input.utmCampaign || 'organic'}${input.marketingOptIn ? '\nMarketing emails: opted in' : ''}`,
    isConverted: false,
    qualification: { budget: Number(input.budget) > 0 ? Number(input.budget) : 0, authority: 'unknown', need: inquiry, timeline: input.timeline || 'unknown' },
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  lead.score = calculateLeadScore(lead);
  const saved = await repo.saveLead(lead);
  await repo.addLeadActivity(lead.id, { type: 'created', title: 'Inbound Website Lead Captured', description: `Captured from ${sourceUrl || 'Website'}. Score: ${lead.score}/100.`, actor });
  await (await TaskService.forOrg(orgId)).create({ title: `Follow up with ${lead.name} regarding website inquiry`, type: 'follow_up', dueDate: new Date(Date.now() + 2 * 3600_000).toISOString(), priority: 'urgent', leadId: lead.id, assignedTo: lead.owner || '', assigneeId: null },
    { userId: 'website-form', name: actor }, { source: 'website' });
  await repo.logActivity({ type: 'lead_created', title: `New Website Lead: ${lead.name}`, description: `Website form capture for ${lead.company}.`, actor, targetId: lead.id, targetType: 'lead' });
  await refreshLeadIntelligence(orgId, saved.id); // classify incoming web leads immediately (never throws)
  return { leadId: saved.id, isExisting: false };
}
