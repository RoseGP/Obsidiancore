/**
 * One activity timeline. Anything that happens on a record (a note in the inbox, a task, a meeting note) is
 * written to that record's own timeline and to the organization feed, so the lead, contact, company and
 * dashboard all show the same history.
 */
import { assertId, getDocStore, newId } from '../data/docStore';
import { CrmRepository } from './crmRepository';
import { ContactService, normEmail } from './contacts';
import { refreshLeadIntelligence } from './leadIntelligence';

export interface RecordRef { type: string; id: string; title?: string }
export interface TimelineEntry { type: string; title: string; description?: string; actor?: string; source?: string }

/**
 * Writes `entry` to the linked record's timeline and to the organization feed. Older inbox links labelled
 * leads as "contact", so a contact id that isn't a contact is tried as a lead. Returns where it was written.
 */
export async function recordLinkedActivity(orgId: string, ref: RecordRef | null | undefined, entry: TimelineEntry) {
  if (!ref?.id) return null;
  const st = await getDocStore();
  const id = assertId(ref.id);
  const base = `organizations/${assertId(orgId)}`;
  const repo = await CrmRepository.forOrg(orgId, st);
  const row = { description: '', actor: 'System', ...entry };
  let target: { type: string; id: string } | null = null;

  if (ref.type === 'contact' && (await st.get(`${base}/contacts/${id}`))) {
    await (await ContactService.forOrg(orgId, st)).addActivity('contact', id, row);
    target = { type: 'contact', id };
  } else if ((ref.type === 'lead' || ref.type === 'contact') && (await st.get(`${base}/leads/${id}`))) {
    await repo.addLeadActivity(id, row);
    target = { type: 'lead', id };
  } else if (ref.type === 'company' && (await st.get(`${base}/companies/${id}`))) {
    await (await ContactService.forOrg(orgId, st)).addActivity('company', id, row);
    target = { type: 'company', id };
  } else if (ref.type === 'deal' && (await st.get(`${base}/deals/${id}`))) {
    target = { type: 'deal', id };
  }
  if (!target) return null;
  await repo.logActivity({ type: entry.type, title: entry.title, description: entry.description || '', actor: entry.actor, targetId: target.id, targetType: target.type });
  return target;
}

/**
 * A website chat visitor gave an email: link the conversation to the person the organization already knows
 * (a contact, then a lead with the same email) or create a new lead (source "website_chat"). Never creates a
 * second lead for the same email.
 */
export async function matchOrCreateVisitorLead(orgId: string, v: { email: string; name?: string; page?: string; conversationId: string }) {
  const email = normEmail(v.email);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const st = await getDocStore();
  const contact = await (await ContactService.forOrg(orgId, st)).findByEmail(email);
  if (contact) return { type: 'contact' as const, id: contact.id, title: contact.name || contact.email, subtitle: contact.email, companyName: contact.company || undefined, created: false };
  const repo = await CrmRepository.forOrg(orgId, st);
  const lead = (await repo.listLeads()).find((l: any) => normEmail(l.email) === email);
  if (lead) {
    await repo.addLeadActivity(lead.id, { type: 'website_chat', title: 'Started a website chat', description: v.page ? `From ${String(v.page).slice(0, 300)}` : 'From the website chat widget.', actor: 'Website chat' });
    return { type: 'lead' as const, id: lead.id, title: lead.name || lead.email, subtitle: lead.email, status: lead.status, companyName: lead.company || undefined, created: false };
  }
  const ts = new Date().toISOString();
  const name = String(v.name || '').trim().slice(0, 120) || email.split('@')[0];
  const created = await repo.saveLead({
    id: newId('lead'), name, email, phone: '', company: '', title: '', source: 'website_chat', channel: 'website_chat', status: 'new',
    owner: '', isConverted: false, score: 0, notes: `Started a website chat${v.page ? ` on ${String(v.page).slice(0, 300)}` : ''}.`,
    qualification: { budget: 0, authority: 'unknown', need: '', timeline: 'unknown' }, conversationId: v.conversationId, createdAt: ts, updatedAt: ts,
  });
  await repo.addLeadActivity(created.id, { type: 'created', title: 'New lead from website chat', description: `${name} (${email}) started a chat.`, actor: 'Website chat' });
  await repo.logActivity({ type: 'lead_created', title: `New Website Chat Lead: ${name}`, description: email, actor: 'Website chat', targetId: created.id, targetType: 'lead' });
  await refreshLeadIntelligence(orgId, created.id);
  return { type: 'lead' as const, id: created.id, title: name, subtitle: email, status: 'new', created: true };
}
