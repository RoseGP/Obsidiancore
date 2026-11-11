/**
 * Tenant-scoped CRM data. Every path starts with organizations/{orgId}, so a record from another
 * organization can't be read or changed even with a guessed id: it simply isn't at that path.
 *
 *   organizations/{orgId}/leads/{leadId}
 *   organizations/{orgId}/leads/{leadId}/tasks/{taskId}
 *   organizations/{orgId}/leads/{leadId}/activities/{activityId}
 *   organizations/{orgId}/deals/{dealId}
 *   organizations/{orgId}/tickets/{ticketId}
 *   organizations/{orgId}/contacts/{contactId}
 *   organizations/{orgId}/companies/{companyId}
 *   organizations/{orgId}/tasks/{taskId}             (tasks not attached to a lead)
 *   organizations/{orgId}/social_drafts/{postId}
 *   organizations/{orgId}/activities/{activityId}    (organization activity feed)
 */
import crypto from 'node:crypto';
import { assertId, getDocStore, newId, type DocStore } from '../data/docStore';
import { TenancyError } from '../tenancy/orgs';

export class CrmRepository {
  private constructor(private st: DocStore, readonly orgId: string) {}

  static async forOrg(orgId: string, st?: DocStore) {
    return new CrmRepository(st ?? (await getDocStore()), assertId(orgId));
  }

  private base(...segs: string[]) { return ['organizations', this.orgId, ...segs].join('/'); }

  // ---- Leads ----
  listLeads() { return this.st.list(this.base('leads')); }
  getLead(id: string) { return this.st.get(this.base('leads', assertId(id))); }
  async saveLead(lead: Record<string, any>) {
    const id = assertId(lead.id);
    await this.st.set(this.base('leads', id), { ...lead, id, orgId: this.orgId });
    return { ...lead, id, orgId: this.orgId };
  }
  updateLead(id: string, patch: Record<string, any>) {
    const { id: _i, orgId: _o, ...safe } = patch;
    return this.st.update(this.base('leads', assertId(id)), safe);
  }
  deleteLead(id: string) { return this.st.deleteRecursive(this.base('leads', assertId(id))); }

  listLeadTasks(leadId: string) { return this.st.list(this.base('leads', assertId(leadId), 'tasks'), { orderBy: 'createdAt', direction: 'desc' }); }
  getLeadTask(leadId: string, taskId: string) { return this.st.get(this.base('leads', assertId(leadId), 'tasks', assertId(taskId))); }
  async addLeadTask(leadId: string, task: Record<string, any>) {
    const id = task.id ? assertId(task.id) : newId('task');
    const t: Record<string, any> = { ...task, id, leadId };
    await this.st.set(this.base('leads', assertId(leadId), 'tasks', id), t);
    return t;
  }
  updateLeadTask(leadId: string, taskId: string, patch: Record<string, any>) {
    return this.st.update(this.base('leads', assertId(leadId), 'tasks', assertId(taskId)), patch);
  }

  listLeadActivities(leadId: string) { return this.st.list(this.base('leads', assertId(leadId), 'activities'), { orderBy: 'timestamp', direction: 'desc' }); }
  async addLeadActivity(leadId: string, act: Record<string, any>) {
    const id = act.id ? assertId(act.id) : newId('act');
    const a = { timestamp: new Date().toISOString(), ...act, id, leadId };
    await this.st.set(this.base('leads', assertId(leadId), 'activities', id), a);
    return a;
  }

  // ---- Organization activity feed ----
  async logActivity(activity: { type: string; title: string; description: string; actor?: string; targetId?: string; targetType?: string }) {
    const id = newId('act');
    const a = { id, ...activity, actor: activity.actor || 'System', timestamp: new Date().toISOString() };
    await this.st.set(this.base('activities', id), a);
    return a;
  }
  listActivities(limit = 20) { return this.st.list(this.base('activities'), { orderBy: 'timestamp', direction: 'desc', limit }); }

  // ---- Deals ----
  listDeals() { return this.st.list(this.base('deals'), { orderBy: 'createdAt', direction: 'desc' }); }
  getDeal(id: string) { return this.st.get(this.base('deals', assertId(id))); }
  async createDeal(deal: Record<string, any>) {
    const id = deal.id ? assertId(deal.id) : newId('deal');
    const now = new Date().toISOString();
    const d: Record<string, any> = { createdAt: now, updatedAt: now, ...deal, id, orgId: this.orgId };
    // Where the deal starts, so reports can measure time in stage (additive; older deals fall back to createdAt).
    if (d.stage && !Array.isArray(d.stageHistory)) { d.stageHistory = [{ stage: d.stage, from: null, at: d.createdAt }]; d.stageEnteredAt = d.stageEnteredAt || d.createdAt; }
    await this.st.set(this.base('deals', id), d);
    return d;
  }
  updateDeal(id: string, patch: Record<string, any>) {
    const { id: _i, orgId: _o, ...safe } = patch;
    return this.st.update(this.base('deals', assertId(id)), safe);
  }

  // ---- Tickets ----
  listTickets() { return this.st.list(this.base('tickets')); }
  getTicket(id: string) { return this.st.get(this.base('tickets', assertId(id))); }
  updateTicket(id: string, patch: Record<string, any>) {
    const { id: _i, orgId: _o, ...safe } = patch;
    return this.st.update(this.base('tickets', assertId(id)), safe);
  }

  // ---- Contacts / tasks / social drafts (used by the AI assistant tools) ----
  listContacts(limit = 200) { return this.st.list(this.base('contacts'), { limit }); }
  async createTask(task: Record<string, any>) {
    const id = newId('task');
    const t = { ...task, id, orgId: this.orgId };
    await this.st.set(this.base('tasks', id), t);
    return t;
  }
  async createSocialDraft(post: Record<string, any>) {
    const id = newId('post');
    const p = { ...post, id, orgId: this.orgId };
    await this.st.set(this.base('social_drafts', id), p);
    return p;
  }

  /**
   * Converts a lead into contact + company + deal in ONE transaction. A second conversion
   * (double click, retry, two tabs) fails with 409 and writes nothing.
   */
  async convertLead(leadId: string, build: (lead: any) => { contact: any; company: any; deal: any; activity: any; leadPatch: any }) {
    const leadPath = this.base('leads', assertId(leadId));
    return this.st.transaction(async (tx) => {
      const lead = await tx.get(leadPath);
      if (!lead) throw new TenancyError(404, 'not_found', 'Lead not found.');
      if (lead.isConverted === true || lead.status === 'converted') {
        throw new TenancyError(409, 'already_converted', `This lead has already been converted (Deal ID: ${lead.convertedDealId || 'recorded'}). Duplicate conversion is prevented.`);
      }
      const r = build(lead);
      tx.set(this.base('contacts', assertId(r.contact.id)), { ...r.contact, orgId: this.orgId });
      tx.set(this.base('companies', assertId(r.company.id)), { ...r.company, orgId: this.orgId });
      tx.set(this.base('deals', assertId(r.deal.id)), { ...r.deal, orgId: this.orgId });
      tx.set(this.base('leads', leadId, 'activities', assertId(r.activity.id)), { ...r.activity, leadId });
      tx.update(leadPath, r.leadPatch);
      return { lead: { ...lead, ...r.leadPatch }, ...r };
    });
  }
}

// ---- Public website lead form keys: crm_lead_capture_keys/{sha256(key)} → { orgId } ----
const keyHash = (k: string) => crypto.createHash('sha256').update(k).digest('hex');

export async function rotateLeadCaptureKey(orgId: string, st?: DocStore): Promise<string> {
  const s = st ?? (await getDocStore());
  const org = await s.get(`organizations/${assertId(orgId)}`);
  if (!org) throw new TenancyError(404, 'not_found', 'Organization not found.');
  const key = `lck_${crypto.randomBytes(24).toString('base64url')}`;
  const h = keyHash(key);
  await s.transaction(async (tx) => {
    const settings = await tx.get(`organizations/${orgId}/settings/lead_capture`);
    if (settings?.keyHash) tx.delete(`crm_lead_capture_keys/${settings.keyHash}`); // revoke the previous key
    tx.set(`crm_lead_capture_keys/${h}`, { orgId, createdAt: new Date().toISOString() });
    tx.set(`organizations/${orgId}/settings/lead_capture`, { keyHash: h, keyPrefix: key.slice(0, 8), rotatedAt: new Date().toISOString() });
  });
  return key; // shown once
}

export async function orgForLeadCaptureKey(key: unknown, st?: DocStore): Promise<string | null> {
  if (typeof key !== 'string' || !/^lck_[A-Za-z0-9_-]{20,64}$/.test(key)) return null;
  const s = st ?? (await getDocStore());
  const row = await s.get(`crm_lead_capture_keys/${keyHash(key)}`);
  return row?.orgId ?? null;
}
