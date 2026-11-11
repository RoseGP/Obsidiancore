/**
 * Meeting notes taken in the Call Canvas, stored with the organization's CRM data.
 *
 *   organizations/{orgId}/meeting_notes/{noteId}
 *
 * Notes are drafts while the meeting runs (autosaved by their author) and become final ("saved to
 * the CRM") when the author finishes them or the meeting ends. Final notes are read-only. Finishing
 * logs an organization activity and, when the notes are linked to a lead, an entry on that lead.
 */
import { z } from 'zod';
import { assertId, getDocStore, newId } from '../data/docStore';
import { CrmRepository } from '../crm/crmRepository';
import { MAX_NOTES_CHARS } from '../../services/meetingSummary';

export class MeetingNotesError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface MeetingNote {
  id: string;
  orgId: string;
  meetingKey: string;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  leadId: string | null;
  leadName: string | null;
  status: 'draft' | 'final';
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface NotesActor { orgId: string; userId: string; name: string; role: string }

const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
export const noteInputSchema = z.object({
  meetingKey: z.string().regex(SAFE, 'Invalid meeting reference.'),
  title: z.string().trim().max(200).optional().default(''),
  body: z.string().max(MAX_NOTES_CHARS, `Notes are limited to ${MAX_NOTES_CHARS.toLocaleString()} characters.`).optional().default(''),
  leadId: z.string().regex(SAFE).nullable().optional(),
});

const col = (orgId: string) => `organizations/${assertId(orgId)}/meeting_notes`;
const isAdmin = (role: string) => role === 'OWNER' || role === 'ADMIN';

async function leadFor(orgId: string, leadId: string | null | undefined) {
  if (!leadId) return null;
  const lead = await (await CrmRepository.forOrg(orgId)).getLead(leadId);
  if (!lead) throw new MeetingNotesError(400, 'lead_not_found', 'That lead doesn\'t exist in your organization.');
  return { id: String(lead.id), name: String(lead.name || lead.email || 'Lead') };
}

export async function listNotes(orgId: string, filter: { leadId?: string; meetingKey?: string } = {}): Promise<MeetingNote[]> {
  const where: [string, '==', unknown][] = [];
  if (filter.leadId) where.push(['leadId', '==', assertId(filter.leadId)]);
  if (filter.meetingKey) where.push(['meetingKey', '==', assertId(filter.meetingKey)]);
  const rows = await (await getDocStore()).list(col(orgId), { where, limit: 500 }) as MeetingNote[];
  return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getNote(orgId: string, id: string): Promise<MeetingNote> {
  const note = await (await getDocStore()).get(`${col(orgId)}/${assertId(id)}`) as MeetingNote | null;
  if (!note) throw new MeetingNotesError(404, 'not_found', 'Notes not found.');
  return note;
}

/** Create the draft (if it doesn't exist yet) or update it. Only its author may change it; final notes can't change. */
export async function saveDraft(actor: NotesActor, id: string, input: unknown): Promise<MeetingNote> {
  const noteId = assertId(id);
  const data = noteInputSchema.parse(input ?? {});
  const st = await getDocStore();
  const path = `${col(actor.orgId)}/${noteId}`;
  const existing = await st.get(path) as MeetingNote | null;
  if (existing) {
    if (existing.authorId !== actor.userId) throw new MeetingNotesError(403, 'not_author', 'Only the person who wrote these notes can edit them.');
    if (existing.status === 'final') throw new MeetingNotesError(409, 'notes_final', 'These notes were already saved to the CRM and can\'t be changed.');
    if (existing.meetingKey !== data.meetingKey) throw new MeetingNotesError(400, 'meeting_mismatch', 'These notes belong to another meeting.');
  }
  const lead = data.leadId === undefined
    ? (existing?.leadId ? { id: existing.leadId, name: existing.leadName || '' } : null)
    : await leadFor(actor.orgId, data.leadId);
  const now = new Date().toISOString();
  const note: MeetingNote = {
    id: noteId, orgId: actor.orgId, meetingKey: data.meetingKey,
    title: data.title || existing?.title || 'Meeting notes', body: data.body,
    authorId: actor.userId, authorName: existing?.authorName || actor.name,
    leadId: lead?.id ?? null, leadName: lead?.name ?? null,
    status: 'draft', createdAt: existing?.createdAt || now, updatedAt: now, completedAt: null,
  };
  await st.set(path, note);
  return note;
}

/** Mark the notes final ("saved to the CRM") and record it on the activity feed (and the lead). */
export async function completeNote(actor: NotesActor, id: string): Promise<MeetingNote> {
  const note = await getNote(actor.orgId, id);
  if (note.authorId !== actor.userId) throw new MeetingNotesError(403, 'not_author', 'Only the person who wrote these notes can save them.');
  if (note.status === 'final') return note; // finishing twice (button + meeting end) is harmless
  const now = new Date().toISOString();
  const done: MeetingNote = { ...note, status: 'final', updatedAt: now, completedAt: now };
  await (await getDocStore()).set(`${col(actor.orgId)}/${note.id}`, done);
  const repo = await CrmRepository.forOrg(actor.orgId);
  const preview = note.body.replace(/\s+/g, ' ').trim().slice(0, 140) || '(no text)';
  await repo.logActivity({
    type: 'meeting_notes', title: `Meeting notes saved: ${note.title}`, description: preview, actor: actor.name,
    targetId: note.leadId || note.id, targetType: note.leadId ? 'lead' : 'meeting',
  });
  if (note.leadId && await repo.getLead(note.leadId)) {
    await repo.addLeadActivity(note.leadId, { type: 'meeting_notes', title: `Meeting notes: ${note.title}`, description: note.body.slice(0, 2000), actor: actor.name, noteId: note.id });
  }
  return done;
}

/** Delete a draft (its author or an admin). Final notes need manage_records, checked by the route. */
export async function deleteNote(actor: NotesActor, id: string, canManageRecords: boolean): Promise<void> {
  const note = await getNote(actor.orgId, id);
  const own = note.authorId === actor.userId;
  if (note.status === 'final' ? !canManageRecords : !(own || isAdmin(actor.role))) {
    throw new MeetingNotesError(403, 'forbidden', note.status === 'final' ? 'Saved notes can only be deleted by someone who manages records.' : 'Only the author or an admin can delete these notes.');
  }
  await (await getDocStore()).deleteRecursive(`${col(actor.orgId)}/${note.id}`);
}

export const newNoteId = () => newId('mnote');
