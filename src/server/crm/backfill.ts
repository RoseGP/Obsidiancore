/**
 * One-time (idempotent) data moves for the single contact record and the single task list.
 * Both scripts default to a dry run and only add fields or documents: nothing is deleted or overwritten.
 */
import { assertId, getDocStore, newId, type DocStore } from '../data/docStore';
import { ContactService, normEmail } from './contacts';
import { TaskService } from './tasks';

export interface ContactBackfillResult { orgId: string; contactsCreated: number; leadsLinked: number; proposalsLinked: number; invoicingClientsLinked: number; applied: boolean }

/**
 * - Converted leads whose contact is missing get one (or are linked to the contact with the same email).
 * - Proposals and invoicing clients whose email matches a contact get its id (crmContactId / contactId),
 *   next to the data they already hold.
 */
export async function backfillContacts(orgId: string, opts: { apply: boolean }, st?: DocStore): Promise<ContactBackfillResult> {
  const s = st ?? (await getDocStore());
  const base = `organizations/${assertId(orgId)}`;
  const svc = await ContactService.forOrg(orgId, s);
  const r: ContactBackfillResult = { orgId, contactsCreated: 0, leadsLinked: 0, proposalsLinked: 0, invoicingClientsLinked: 0, applied: opts.apply };
  const planned = new Map<string, string>(); // email → contact id created in this run (dry run included)

  for (const lead of await s.list(`${base}/leads`)) {
    if (!(lead.isConverted || lead.status === 'converted')) continue;
    if (lead.convertedContactId && (await s.get(`${base}/contacts/${lead.convertedContactId}`))) continue;
    const email = normEmail(lead.email);
    const existing = (email && planned.get(email)) || (email ? (await svc.findByEmail(email))?.id : null);
    let contactId = existing || null;
    if (!contactId) {
      contactId = newId('contact');
      r.contactsCreated++;
      if (email) planned.set(email, contactId);
      if (opts.apply) {
        const ts = new Date().toISOString();
        await s.set(`${base}/contacts/${contactId}`, {
          id: contactId, orgId, name: lead.name || email, email, phone: lead.phone || '', company: lead.company || '', companyId: lead.convertedCompanyId || null,
          title: lead.title || '', status: 'active', ownerId: lead.ownerId ?? null, owner: lead.owner || '', tags: [], leadIds: [lead.id], originLeadId: lead.id,
          createdBy: 'migration', createdAt: lead.convertedAt || ts, updatedAt: ts, backfilledAt: ts,
        });
      }
    }
    r.leadsLinked++;
    if (opts.apply) await s.update(`${base}/leads/${lead.id}`, { convertedContactId: contactId });
  }

  const contactByEmail = async (e: unknown) => {
    const email = normEmail(e);
    if (!email) return null;
    return planned.get(email) || (await svc.findByEmail(email))?.id || null;
  };
  for (const p of await s.list(`${base}/proposals`)) {
    if (p.crmContactId) continue;
    const id = await contactByEmail(p.client?.email);
    if (!id) continue;
    r.proposalsLinked++;
    if (opts.apply) await s.update(`${base}/proposals/${p.id}`, { crmContactId: id });
  }
  for (const c of await s.list(`billing/${orgId}/clients`).catch(() => [])) {
    if (c.contactId) continue;
    const id = await contactByEmail(c.email);
    if (!id) continue;
    r.invoicingClientsLinked++;
    if (opts.apply) await s.update(`billing/${orgId}/clients/${c.id}`, { contactId: id });
  }
  return r;
}

export async function migrateTasks(orgId: string, opts: { apply: boolean }, st?: DocStore) {
  return { orgId, ...(await (await TaskService.forOrg(orgId, st)).migrateLegacy(opts)) };
}

/** Organization ids to process: one (--org) or every organization. */
export async function orgIds(only?: string, st?: DocStore) {
  if (only) return [assertId(only)];
  const s = st ?? (await getDocStore());
  return (await s.list('organizations')).map((o: any) => o.id).filter(Boolean);
}
