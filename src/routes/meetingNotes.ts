/**
 * /api/meeting-notes: notes typed in the Call Canvas, saved with the organization's CRM data.
 *
 *   GET    /                 list (newest first); ?leadId= or ?meetingKey= to filter
 *   POST   /                 { meetingKey } → a new note id to save under (nothing is stored yet)
 *   GET    /:id              one note
 *   PUT    /:id              create or update the author's draft { meetingKey, title, body, leadId? }
 *   POST   /:id/complete     save to the CRM (final, read-only; logs an activity, and on the lead if linked)
 *   DELETE /:id              author or admin (drafts); manage_records (final)
 */
import { Router, type Request, type Response } from 'express';
import { can } from '../server/tenancy/orgs';
import { requirePermission, requireTenant, sendError, tenantOf } from '../server/tenancy/middleware';
import { MeetingNotesError, completeNote, deleteNote, getNote, listNotes, newNoteId, saveDraft, type NotesActor } from '../server/meetings/notes';

const router = Router();
router.use(requireTenant);

const actorOf = (req: Request): NotesActor => {
  const t = tenantOf(req);
  return { orgId: t.orgId, userId: t.userId, name: t.name || t.email || 'Team member', role: t.role };
};
function fail(res: Response, err: unknown, tag: string) {
  if (err instanceof MeetingNotesError) return res.status(err.status).json({ success: false, code: err.code, error: err.message });
  return sendError(res, err, tag);
}
const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

router.get('/', requirePermission('read'), async (req, res) => {
  try { res.json({ success: true, notes: await listNotes(tenantOf(req).orgId, { leadId: q(req.query.leadId), meetingKey: q(req.query.meetingKey) }) }); }
  catch (err) { fail(res, err, 'meetingNotes.list'); }
});

router.post('/', requirePermission('write'), (_req, res) => {
  res.status(201).json({ success: true, id: newNoteId() });
});

router.get('/:id', requirePermission('read'), async (req, res) => {
  try { res.json({ success: true, note: await getNote(tenantOf(req).orgId, req.params.id) }); }
  catch (err) { fail(res, err, 'meetingNotes.get'); }
});

router.put('/:id', requirePermission('write'), async (req, res) => {
  try { res.json({ success: true, note: await saveDraft(actorOf(req), req.params.id, req.body) }); }
  catch (err) { fail(res, err, 'meetingNotes.save'); }
});

router.post('/:id/complete', requirePermission('write'), async (req, res) => {
  try { res.json({ success: true, note: await completeNote(actorOf(req), req.params.id) }); }
  catch (err) { fail(res, err, 'meetingNotes.complete'); }
});

router.delete('/:id', requirePermission('write'), async (req, res) => {
  try {
    const t = tenantOf(req);
    await deleteNote(actorOf(req), req.params.id, can(t.role, 'manage_records'));
    res.json({ success: true });
  } catch (err) { fail(res, err, 'meetingNotes.delete'); }
});

export default router;
