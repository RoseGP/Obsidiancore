/**
 * Contacts and companies (signed-in organization members).
 *
 *   /api/contacts
 *     GET    /                 ?q= &tag= &companyId= &ownerId= &includeDeleted=true      list / search
 *     GET    /duplicates       groups of contacts that look like the same person
 *     POST   /                 create (409 possible_duplicate with `matches` unless { force: true })
 *     POST   /merge            { keepId, mergeIds[] } re-points every link to the kept contact (manager+)
 *     GET    /:id              profile: company, leads, deals, tasks, proposals, meetings, invoicing clients,
 *                              communication history and a combined timeline
 *     PATCH  /:id              update
 *     POST   /:id/notes        { note } add a note to the timeline
 *     DELETE /:id              soft delete (manager+); POST /:id/restore undoes it
 *
 *   /api/companies
 *     GET / ?q=  ·  POST /  ·  GET /:id (profile with contacts, deals, totals, timeline)  ·  PATCH /:id
 *     POST /:id/notes  ·  DELETE /:id (manager+, soft)
 */
import { Router, type Request, type Response } from 'express';
import { ContactService } from '../server/crm/contacts';
import { requirePermission, requireReadOrWrite, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { TenancyError } from '../server/tenancy/orgs';

const actor = (req: Request) => { const t = tenantOf(req); return { userId: t.userId, name: t.name || t.email || t.userId }; };
const svc = (req: Request) => ContactService.forOrg(tenantOf(req).orgId);
const note = (b: any) => (typeof b?.note === 'string' ? b.note.trim().slice(0, 10_000) : '');

function fail(res: Response, err: unknown, tag: string) {
  if (err instanceof TenancyError && err.code === 'possible_duplicate') {
    return res.status(409).json({ success: false, code: err.code, error: err.message, matches: (err as any).details?.matches || [] });
  }
  return sendError(res, err, tag);
}

// ---------------------------------------------------------------- contacts
export const contactsRouter = Router();
contactsRouter.use(requireTenant, requireReadOrWrite);

contactsRouter.get('/', async (req, res) => {
  try {
    const q = req.query;
    const contacts = await (await svc(req)).list({ q: String(q.q || ''), tag: q.tag ? String(q.tag) : undefined, companyId: q.companyId ? String(q.companyId) : undefined, ownerId: q.ownerId ? String(q.ownerId) : undefined, includeDeleted: q.includeDeleted === 'true' });
    res.json({ success: true, count: contacts.length, contacts });
  } catch (err) { fail(res, err, 'contacts.list'); }
});

contactsRouter.get('/duplicates', async (req, res) => {
  try { res.json({ success: true, groups: await (await svc(req)).duplicateGroups() }); } catch (err) { fail(res, err, 'contacts.duplicates'); }
});

contactsRouter.post('/', async (req, res) => {
  try {
    const contact = await (await svc(req)).create(req.body || {}, actor(req), { force: req.body?.force === true });
    res.status(201).json({ success: true, contact });
  } catch (err) { fail(res, err, 'contacts.create'); }
});

contactsRouter.post('/merge', requirePermission('manage_records'), async (req, res) => {
  try {
    const keepId = String(req.body?.keepId || '');
    const mergeIds = Array.isArray(req.body?.mergeIds) ? req.body.mergeIds.map(String).slice(0, 20) : [];
    const r = await (await svc(req)).merge(keepId, mergeIds, actor(req));
    res.json({ success: true, ...r });
  } catch (err) { fail(res, err, 'contacts.merge'); }
});

contactsRouter.get('/:id', async (req, res) => {
  try {
    const p = await (await svc(req)).profile(req.params.id);
    if (!p) return res.status(404).json({ success: false, code: 'not_found', error: 'Contact not found.' });
    if ((p as any).redirectTo) return res.json({ success: true, mergedInto: (p as any).redirectTo });
    res.json({ success: true, ...p });
  } catch (err) { fail(res, err, 'contacts.get'); }
});

contactsRouter.patch('/:id', async (req, res) => {
  try { res.json({ success: true, contact: await (await svc(req)).update(req.params.id, req.body || {}, actor(req)) }); } catch (err) { fail(res, err, 'contacts.update'); }
});

contactsRouter.post('/:id/notes', async (req, res) => {
  try {
    const text = note(req.body);
    if (!text) return res.status(400).json({ success: false, code: 'invalid_input', error: 'Write a note first.' });
    const s = await svc(req);
    const c = await s.get(req.params.id);
    if (!c || c.redirectTo || c.deletedAt) return res.status(404).json({ success: false, code: 'not_found', error: 'Contact not found.' });
    const a = await s.addActivity('contact', c.id, { type: 'note_added', title: 'Note added', description: text, actor: actor(req).name });
    await s.feed({ type: 'note_added', title: `Note on ${c.name || c.email}`, description: text.slice(0, 300), actor: actor(req).name, targetId: c.id, targetType: 'contact' });
    res.status(201).json({ success: true, activity: a });
  } catch (err) { fail(res, err, 'contacts.note'); }
});

contactsRouter.delete('/:id', requirePermission('manage_records'), async (req, res) => {
  try { res.json({ success: true, ...(await (await svc(req)).softDelete(req.params.id, actor(req))) }); } catch (err) { fail(res, err, 'contacts.delete'); }
});

contactsRouter.post('/:id/restore', requirePermission('manage_records'), async (req, res) => {
  try { res.json({ success: true, contact: await (await svc(req)).restore(req.params.id, actor(req)) }); } catch (err) { fail(res, err, 'contacts.restore'); }
});

// ---------------------------------------------------------------- companies
export const companiesRouter = Router();
companiesRouter.use(requireTenant, requireReadOrWrite);

companiesRouter.get('/', async (req, res) => {
  try {
    const companies = await (await svc(req)).listCompanies({ q: String(req.query.q || ''), includeDeleted: req.query.includeDeleted === 'true' });
    res.json({ success: true, count: companies.length, companies });
  } catch (err) { fail(res, err, 'companies.list'); }
});

companiesRouter.post('/', async (req, res) => {
  try { res.status(201).json({ success: true, company: await (await svc(req)).createCompany(req.body || {}, actor(req), { force: req.body?.force === true }) }); } catch (err) { fail(res, err, 'companies.create'); }
});

companiesRouter.get('/:id', async (req, res) => {
  try {
    const p = await (await svc(req)).companyProfile(req.params.id);
    if (!p) return res.status(404).json({ success: false, code: 'not_found', error: 'Company not found.' });
    res.json({ success: true, ...p });
  } catch (err) { fail(res, err, 'companies.get'); }
});

companiesRouter.patch('/:id', async (req, res) => {
  try { res.json({ success: true, company: await (await svc(req)).updateCompany(req.params.id, req.body || {}, actor(req)) }); } catch (err) { fail(res, err, 'companies.update'); }
});

companiesRouter.post('/:id/notes', async (req, res) => {
  try {
    const text = note(req.body);
    if (!text) return res.status(400).json({ success: false, code: 'invalid_input', error: 'Write a note first.' });
    const s = await svc(req);
    const c = await s.getCompany(req.params.id);
    if (!c || c.deletedAt) return res.status(404).json({ success: false, code: 'not_found', error: 'Company not found.' });
    const a = await s.addActivity('company', c.id, { type: 'note_added', title: 'Note added', description: text, actor: actor(req).name });
    await s.feed({ type: 'note_added', title: `Note on ${c.name}`, description: text.slice(0, 300), actor: actor(req).name, targetId: c.id, targetType: 'company' });
    res.status(201).json({ success: true, activity: a });
  } catch (err) { fail(res, err, 'companies.note'); }
});

companiesRouter.delete('/:id', requirePermission('manage_records'), async (req, res) => {
  try { res.json({ success: true, ...(await (await svc(req)).softDeleteCompany(req.params.id, actor(req))) }); } catch (err) { fail(res, err, 'companies.delete'); }
});
