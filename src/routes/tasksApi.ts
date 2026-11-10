/**
 * Tasks (signed-in organization members): one list for leads, contacts, deals, inbox conversations and meetings.
 *
 *   GET    /api/tasks          ?view=mine|team|overdue|today|upcoming|due_soon|done|all  &leadId= &contactId= &dealId=
 *                              &companyId= &conversationId= &meetingId= &q= &status=
 *   POST   /api/tasks          { title, description?, type?, priority?, dueDate?, reminderAt?, assigneeId?, assignedTo?,
 *                                leadId?, contactId?, dealId?, companyId?, conversationId?, meetingId? }
 *   GET    /api/tasks/:id
 *   PATCH  /api/tasks/:id      any of the fields above, or { status } / { completed }
 *   POST   /api/tasks/:id/complete   { completed?: boolean } (default true)
 *   DELETE /api/tasks/:id      removes it from every list (kept for history)
 */
import { Router, type Request } from 'express';
import { TaskService } from '../server/crm/tasks';
import { CrmRepository } from '../server/crm/crmRepository';
import { recordLinkedActivity } from '../server/crm/timeline';
import { requireReadOrWrite, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';

const router = Router();
router.use(requireTenant, requireReadOrWrite);

const actor = (req: Request) => { const t = tenantOf(req); return { userId: t.userId, name: t.name || t.email || t.userId }; };
const svc = (req: Request) => TaskService.forOrg(tenantOf(req).orgId);
const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** Logs task events on the record the task belongs to (lead, contact, company or deal). */
async function logOnRecord(req: Request, t: any, type: string, title: string) {
  const orgId = tenantOf(req).orgId;
  const ref = t.leadId ? { type: 'lead', id: t.leadId } : t.contactId ? { type: 'contact', id: t.contactId } : t.companyId ? { type: 'company', id: t.companyId } : t.dealId ? { type: 'deal', id: t.dealId } : null;
  const description = `${t.title}${t.dueDate ? ` · due ${new Date(t.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`;
  if (ref) await recordLinkedActivity(orgId, ref, { type, title, description, actor: actor(req).name }).catch(() => null);
  else if (type === 'task_completed') await (await CrmRepository.forOrg(orgId)).logActivity({ type, title, description, actor: actor(req).name, targetId: t.id, targetType: 'task' });
}

router.get('/', async (req, res) => {
  try {
    const t = tenantOf(req);
    const view = q(req.query.view) || 'mine';
    const mine = view === 'mine' || req.query.mine === 'true';
    const tasks = await (await svc(req)).list({
      view: ['mine', 'team', 'open'].includes(view) ? 'open' : view === 'all' ? 'all' : view,
      mine: mine ? { userId: t.userId, names: [t.name, t.email] } : undefined,
      includeDone: view === 'all',
      assigneeId: q(req.query.assigneeId), status: q(req.query.status), q: q(req.query.q),
      leadId: q(req.query.leadId), contactId: q(req.query.contactId), dealId: q(req.query.dealId), companyId: q(req.query.companyId),
      conversationId: q(req.query.conversationId), meetingId: q(req.query.meetingId),
    });
    res.json({ success: true, count: tasks.length, tasks });
  } catch (err) { sendError(res, err, 'tasks.list'); }
});

router.post('/', async (req, res) => {
  try {
    const task = await (await svc(req)).create(req.body || {}, actor(req), { source: req.body?.meetingId ? 'meeting' : 'tasks' });
    await logOnRecord(req, task, 'task_created', `Task added: ${task.title}`);
    res.status(201).json({ success: true, task });
  } catch (err) { sendError(res, err, 'tasks.create'); }
});

router.get('/:id', async (req, res) => {
  try {
    const s = await svc(req);
    const task = (await s.get(req.params.id)) || (await s.legacyTasks()).find((t) => t.id === req.params.id) || null;
    if (!task) return res.status(404).json({ success: false, code: 'not_found', error: 'Task not found.' });
    res.json({ success: true, task });
  } catch (err) { sendError(res, err, 'tasks.get'); }
});

router.patch('/:id', async (req, res) => {
  try {
    const s = await svc(req);
    const before = await s.adopt(req.params.id);
    const task = await s.update(req.params.id, req.body || {}, actor(req));
    if (before && !before.completed && task.completed) await logOnRecord(req, task, 'task_completed', `Task completed: ${task.title}`);
    res.json({ success: true, task });
  } catch (err) { sendError(res, err, 'tasks.update'); }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const completed = req.body?.completed !== false;
    const s = await svc(req);
    const before = await s.adopt(req.params.id);
    const task = await s.update(req.params.id, { completed }, actor(req));
    if (completed && before && !before.completed) await logOnRecord(req, task, 'task_completed', `Task completed: ${task.title}`);
    res.json({ success: true, task });
  } catch (err) { sendError(res, err, 'tasks.complete'); }
});

router.delete('/:id', async (req, res) => {
  try { res.json({ success: true, ...(await (await svc(req)).remove(req.params.id, actor(req))) }); } catch (err) { sendError(res, err, 'tasks.delete'); }
});

export default router;
