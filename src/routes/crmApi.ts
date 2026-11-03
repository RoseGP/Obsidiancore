/**
 * CRM API: /api/crm/*
 *
 * Every route requires a signed-in user and works only on that user's
 * workspace. Writes must come from the app's own origin (CSRF check) and send
 * JSON. The one public route is the website lead form, POST /capture/:key,
 * which is rate-limited per IP and identified by a secret, rotatable key.
 */
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireUser, type AuthedRequest } from '../features/social-accounts/server/auth';
import { csrfGuard, ipKey, rateLimit, sendError, userKey } from '../features/social-accounts/server/http';
import { config } from '../features/social-accounts/server/instance';
import { createCrmStore } from '../features/crm/server/store';
import { createCrmService } from '../features/crm/server/service';

export const crmStore = createCrmStore({ mode: config.storeMode, dataDir: process.env.CRM_DATA_DIR || path.join(path.dirname(path.resolve(config.dataDir)), 'crm') });
export const crm = createCrmService(crmStore);

const router = Router();
const uid = (req: AuthedRequest) => req.accountUser!.id;
const id = z.string().regex(/^[a-z]{3,4}_[A-Za-z0-9_-]{8,40}$/, 'Invalid id.');
const handle = (ctx: string, fn: (req: AuthedRequest, res: Response) => Promise<unknown>) => async (req: AuthedRequest, res: Response) => {
  try { const out = await fn(req, res); if (!res.headersSent) res.json(out); } catch (err) { sendError(res, err, `crm ${ctx}`); }
};

// Public website form (before auth). Accepts JSON or a classic HTML form post.
router.post('/capture/:key', rateLimit({ name: 'crm-capture', windowMs: 10 * 60_000, max: 20, key: ipKey }), async (req: Request, res: Response) => {
  try { res.json(await crm.capture(String(req.params.key), req.body)); } catch (err) { sendError(res, err, 'crm capture'); }
});

router.use(requireUser, csrfGuard(config.appUrl), rateLimit({ name: 'crm', windowMs: 60_000, max: 600, key: userKey }));
const heavy = rateLimit({ name: 'crm-heavy', windowMs: 60_000, max: 20, key: userKey });

router.get('/settings', handle('settings', (req) => crm.getSettings(uid(req))));
router.put('/settings', handle('save settings', (req) => crm.updateSettings(uid(req), req.body)));
router.post('/settings/capture-form', handle('capture form', (req) => crm.setCaptureForm(uid(req), z.object({ enabled: z.boolean() }).strict().parse(req.body ?? {}).enabled)));

router.get('/dashboard', handle('dashboard', (req) => crm.dashboard(uid(req))));
router.get('/search', handle('search', (req) => crm.search(uid(req), req.query)));

router.get('/contacts', handle('contacts', (req) => crm.listContacts(uid(req), req.query)));
router.post('/contacts', handle('create contact', (req) => crm.createContact(uid(req), req.body)));
router.get('/contacts/duplicates', handle('duplicates', (req) => crm.duplicateGroups(uid(req))));
router.post('/contacts/merge', handle('merge', (req) => { const b = z.object({ keepId: id, mergeIds: z.array(id).min(1).max(20) }).strict().parse(req.body ?? {}); return crm.mergeContacts(uid(req), b.keepId, b.mergeIds); }));
router.post('/contacts/bulk', handle('bulk contacts', (req) => crm.bulkContacts(uid(req), req.body)));
router.get('/contacts/:id', handle('contact', (req) => crm.getContact(uid(req), id.parse(req.params.id))));
router.patch('/contacts/:id', handle('update contact', (req) => crm.updateContact(uid(req), id.parse(req.params.id), req.body)));
router.delete('/contacts/:id', handle('delete contact', (req) => crm.deleteContacts(uid(req), [id.parse(req.params.id)])));

router.get('/leads', handle('leads', (req) => crm.listLeads(uid(req), req.query)));
router.post('/leads', handle('create lead', (req) => crm.createLead(uid(req), req.body)));
router.post('/leads/bulk', handle('bulk leads', (req) => crm.bulkLeads(uid(req), req.body)));
router.get('/leads/:id', handle('lead', (req) => crm.getLead(uid(req), id.parse(req.params.id))));
router.patch('/leads/:id', handle('update lead', (req) => crm.updateLead(uid(req), id.parse(req.params.id), req.body)));
router.post('/leads/:id/convert', handle('convert lead', (req) => crm.convertLead(uid(req), id.parse(req.params.id), req.body)));
router.delete('/leads/:id', handle('delete lead', (req) => crm.deleteLeads(uid(req), [id.parse(req.params.id)])));

router.get('/deals', handle('deals', (req) => crm.listDeals(uid(req), req.query)));
router.post('/deals', handle('create deal', (req) => crm.createDeal(uid(req), req.body)));
router.get('/deals/:id', handle('deal', (req) => crm.getDeal(uid(req), id.parse(req.params.id))));
router.patch('/deals/:id', handle('update deal', (req) => crm.updateDeal(uid(req), id.parse(req.params.id), req.body)));
router.delete('/deals/:id', handle('delete deal', (req) => crm.deleteDeals(uid(req), [id.parse(req.params.id)])));

router.get('/tasks', handle('tasks', (req) => crm.listTasks(uid(req), req.query)));
router.post('/tasks', handle('create task', (req) => crm.createTask(uid(req), req.body)));
router.post('/tasks/bulk', handle('bulk tasks', (req) => crm.bulkTasks(uid(req), req.body)));
router.patch('/tasks/:id', handle('update task', (req) => crm.updateTask(uid(req), id.parse(req.params.id), req.body)));
router.delete('/tasks/:id', handle('delete task', (req) => crm.deleteTasks(uid(req), [id.parse(req.params.id)])));

const relQuery = z.object({ type: z.enum(['contact', 'lead', 'deal']), id });
router.get('/notes', handle('notes', (req) => { const q = relQuery.parse(req.query); return crm.listNotes(uid(req), q.type, q.id); }));
router.post('/notes', handle('create note', (req) => crm.createNote(uid(req), req.body)));
router.patch('/notes/:id', handle('update note', (req) => crm.updateNote(uid(req), id.parse(req.params.id), req.body)));
router.delete('/notes/:id', handle('delete note', (req) => crm.deleteNote(uid(req), id.parse(req.params.id))));
router.post('/interactions', handle('log interaction', (req) => crm.logInteraction(uid(req), req.body)));

router.get('/events', handle('events', (req) => crm.listEvents(uid(req), req.query)));
router.post('/events', handle('create event', (req) => crm.createEvent(uid(req), req.body)));
router.patch('/events/:id', handle('update event', (req) => crm.updateEvent(uid(req), id.parse(req.params.id), req.body)));
router.delete('/events/:id', handle('delete event', (req) => crm.deleteEvent(uid(req), id.parse(req.params.id))));

router.get('/views', handle('views', (req) => crm.listViews(uid(req), typeof req.query.entity === 'string' ? req.query.entity : undefined)));
router.post('/views', handle('save view', (req) => crm.saveView(uid(req), req.body)));
router.delete('/views/:id', handle('delete view', (req) => crm.deleteView(uid(req), id.parse(req.params.id))));

router.post('/import', heavy, handle('import', (req) => crm.importRows(uid(req), req.body)));
router.get('/export/:entity', heavy, handle('export', async (req, res) => {
  const entity = z.enum(['contacts', 'leads', 'deals', 'tasks']).parse(req.params.entity);
  const csv = await crm.exportCsv(uid(req), entity);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${entity}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
}));

export default router;
