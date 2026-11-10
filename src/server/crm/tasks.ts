/**
 * Tasks: one list for the whole organization.
 *
 *   organizations/{orgId}/tasks/{taskId}   every task, call, meeting prep and follow-up
 *
 * A task can point at a lead, contact, deal, inbox conversation or meeting. Older places that kept their own
 * tasks keep working:
 *   - lead tasks (organizations/{orgId}/leads/{leadId}/tasks/{id}) are mirrored with the SAME id, so the lead
 *     drawer, lead intelligence and anything else that reads them stay correct;
 *   - inbox tasks (inbox meta/crm.tasks) are mirrored by the inbox router (see messagingPlatform.ts).
 * Records that were only ever in the old places still show up here (read-through) and are copied into the
 * unified list the first time they're changed, or all at once by src/scripts/migrateTasks.ts.
 */
import crypto from 'node:crypto';
import { assertId, getDocStore, newId, type DocStore } from '../data/docStore';
import { TenancyError } from '../tenancy/orgs';

export const TASK_TYPES = ['task', 'call', 'meeting', 'follow_up', 'email'] as const;
export const TASK_STATUSES = ['open', 'in_progress', 'done', 'cancelled'] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskType = typeof TASK_TYPES[number];
export type TaskStatus = typeof TASK_STATUSES[number];
export type TaskPriority = typeof TASK_PRIORITIES[number];
const LINKS = ['leadId', 'contactId', 'dealId', 'companyId', 'conversationId', 'meetingId'] as const;

export interface Task {
  id: string; orgId: string; title: string; description: string;
  type: TaskType; status: TaskStatus; priority: TaskPriority; completed: boolean;
  dueDate: string | null; reminderAt: string | null;
  assigneeId: string | null; assignedTo: string;
  leadId: string | null; contactId: string | null; dealId: string | null; companyId: string | null; conversationId: string | null; meetingId: string | null;
  createdBy: string; createdAt: string; updatedAt: string; completedAt: string | null; deletedAt?: string | null;
  source: 'tasks' | 'lead' | 'inbox' | 'assistant' | 'meeting' | 'website' | 'migration';
  legacy?: { kind: 'lead' | 'inbox'; leadId?: string; conversationId?: string; taskId: string } | null;
  readThrough?: boolean;
}

const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoOrNull = (v: unknown) => { if (v === null || v === '' || v === undefined) return null; const t = Date.parse(String(v)); return Number.isFinite(t) ? new Date(t).toISOString() : undefined; };
export const priorityFrom = (p: unknown): TaskPriority => (p === 'medium' ? 'normal' : (TASK_PRIORITIES as readonly string[]).includes(String(p)) ? (p as TaskPriority) : 'normal');
const inboxStatusFrom = (s: unknown): TaskStatus => (s === 'completed' ? 'done' : s === 'in_progress' ? 'in_progress' : 'open');
export const inboxTaskId = (conversationId: string, taskId: string) => `itask_${crypto.createHash('sha256').update(`${conversationId}:${taskId}`).digest('hex').slice(0, 24)}`;

export interface Actor { userId: string; name: string }

/** Turns an old lead task into the unified shape (read-through). */
export function fromLeadTask(orgId: string, leadId: string, t: any): Task {
  return {
    id: t.id, orgId, title: str(t.title, 300) || 'Task', description: str(t.description, 4000), type: 'follow_up',
    status: t.completed ? 'done' : 'open', priority: priorityFrom(t.priority), completed: !!t.completed,
    dueDate: isoOrNull(t.dueDate) ?? null, reminderAt: null, assigneeId: t.assigneeId ?? null, assignedTo: str(t.assignedTo, 120),
    leadId, contactId: null, dealId: null, companyId: null, conversationId: null, meetingId: null,
    createdBy: t.createdBy || '', createdAt: t.createdAt || nowIso(), updatedAt: t.updatedAt || t.completedAt || t.createdAt || nowIso(), completedAt: t.completedAt ?? null,
    source: 'lead', legacy: { kind: 'lead', leadId, taskId: t.id }, readThrough: true,
  };
}

/** Turns an inbox task (meta/crm.tasks) into the unified shape (read-through). */
export function fromInboxTask(orgId: string, conversationId: string, t: any): Task {
  const status = inboxStatusFrom(t.status);
  return {
    id: inboxTaskId(conversationId, t.id), orgId, title: str(t.title, 300) || 'Task', description: t.contactName ? `Contact: ${str(t.contactName, 120)}` : '', type: 'follow_up',
    status, priority: priorityFrom(t.priority), completed: status === 'done',
    dueDate: isoOrNull(t.dueDate) ?? null, reminderAt: null, assigneeId: null, assignedTo: str(t.assignee, 120),
    leadId: null, contactId: null, dealId: null, companyId: null, conversationId, meetingId: null,
    createdBy: '', createdAt: t.createdAt || nowIso(), updatedAt: t.createdAt || nowIso(), completedAt: null,
    source: 'inbox', legacy: { kind: 'inbox', conversationId, taskId: t.id }, readThrough: true,
  };
}

/** The old lead-task document written alongside a unified task that has a lead. */
function leadMirror(t: Task) {
  return { id: t.id, leadId: t.leadId, title: t.title, dueDate: t.dueDate, completed: t.completed, completedAt: t.completedAt, priority: t.priority, assignedTo: t.assignedTo, createdAt: t.createdAt, unifiedTaskId: t.id };
}

/** Optional hook the inbox router registers so changes made here also show in the conversation's Tasks tab. */
type InboxMirror = (orgId: string, task: Task) => Promise<void>;
let inboxMirror: InboxMirror | null = null;
export function registerInboxTaskMirror(fn: InboxMirror) { inboxMirror = fn; }
type InboxReader = (orgId: string) => Promise<Array<{ conversationId: string; task: any }>>;
let inboxReader: InboxReader | null = null;
export function registerInboxTaskReader(fn: InboxReader) { inboxReader = fn; }

export interface TaskInput {
  title?: string; description?: string; type?: string; status?: string; priority?: string; completed?: boolean;
  dueDate?: string | null; reminderAt?: string | null; assigneeId?: string | null; assignedTo?: string;
  leadId?: string | null; contactId?: string | null; dealId?: string | null; companyId?: string | null; conversationId?: string | null; meetingId?: string | null;
}

export class TaskService {
  private constructor(private st: DocStore, readonly orgId: string) {}
  static async forOrg(orgId: string, st?: DocStore) { return new TaskService(st ?? (await getDocStore()), assertId(orgId)); }

  private col() { return `organizations/${this.orgId}/tasks`; }
  private path(id: string) { return `${this.col()}/${assertId(id)}`; }
  private leadTaskPath(leadId: string, id: string) { return `organizations/${this.orgId}/leads/${assertId(leadId)}/tasks/${assertId(id)}`; }

  private async checkLinks(input: TaskInput) {
    const col: Record<string, string> = { leadId: 'leads', contactId: 'contacts', dealId: 'deals', companyId: 'companies', meetingId: 'scheduled_meetings' };
    for (const k of Object.keys(col)) {
      const v = (input as any)[k];
      if (v && !(await this.st.get(`organizations/${this.orgId}/${col[k]}/${assertId(v)}`))) throw new TenancyError(400, 'invalid_input', `That ${k.replace('Id', '')} wasn’t found in this organization.`);
    }
    if (input.conversationId) assertId(input.conversationId);
  }

  private fields(input: TaskInput, partial: boolean) {
    const out: Record<string, any> = {};
    const has = (k: string) => !partial || (input as any)[k] !== undefined;
    if (has('title')) out.title = str(input.title, 300);
    if (has('description')) out.description = str(input.description, 4000);
    if (has('type')) out.type = (TASK_TYPES as readonly string[]).includes(String(input.type)) ? input.type : 'task';
    if (has('priority')) out.priority = priorityFrom(input.priority);
    if (has('assignedTo')) out.assignedTo = str(input.assignedTo, 120);
    if (has('assigneeId')) out.assigneeId = input.assigneeId ? str(input.assigneeId, 128) : null;
    for (const k of ['dueDate', 'reminderAt'] as const) if (has(k)) {
      const v = isoOrNull(input[k]);
      if (v === undefined) throw new TenancyError(400, 'invalid_input', `${k === 'dueDate' ? 'Due date' : 'Reminder'} isn’t a valid date.`);
      out[k] = v;
    }
    for (const k of LINKS) if (has(k)) out[k] = input[k] ? assertId(input[k]) : null;
    let status: TaskStatus | undefined;
    if (input.status !== undefined) {
      if (!(TASK_STATUSES as readonly string[]).includes(String(input.status))) throw new TenancyError(400, 'invalid_input', `Status must be one of: ${TASK_STATUSES.join(', ')}.`);
      status = input.status as TaskStatus;
    } else if (input.completed !== undefined) status = input.completed ? 'done' : 'open';
    else if (!partial) status = 'open';
    if (status) { out.status = status; out.completed = status === 'done'; }
    return out;
  }

  private async writeMirrors(t: Task, opts: { skipInbox?: boolean } = {}) {
    if (t.leadId && (await this.st.get(`organizations/${this.orgId}/leads/${t.leadId}`))) await this.st.set(this.leadTaskPath(t.leadId, t.id), leadMirror(t));
    if (t.conversationId && inboxMirror && !opts.skipInbox) await inboxMirror(this.orgId, t).catch(() => undefined);
  }

  async create(input: TaskInput, actor: Actor, opts: { id?: string; source?: Task['source']; legacy?: Task['legacy']; skipInboxMirror?: boolean } = {}) {
    const f = this.fields(input, true); // only what was given; defaults below
    if (!f.title) throw new TenancyError(400, 'invalid_input', 'Add a task title.');
    if (!f.status) { f.status = 'open'; f.completed = false; }
    await this.checkLinks(input);
    const ts = nowIso();
    const t: Task = {
      description: '', type: 'task', priority: 'normal', assignedTo: actor.name, assigneeId: actor.userId, dueDate: null, reminderAt: null,
      leadId: null, contactId: null, dealId: null, companyId: null, conversationId: null, meetingId: null,
      ...f, id: opts.id ? assertId(opts.id) : newId('task'), orgId: this.orgId, status: f.status, completed: f.completed,
      createdBy: actor.userId, createdAt: ts, updatedAt: ts, completedAt: f.completed ? ts : null, deletedAt: null,
      source: opts.source || 'tasks', legacy: opts.legacy ?? null,
    } as Task;
    await this.st.set(this.path(t.id), t as any);
    await this.writeMirrors(t, { skipInbox: opts.skipInboxMirror });
    return t;
  }

  async get(id: string): Promise<Task | null> {
    const t = await this.st.get(this.path(id));
    return t && !t.deletedAt ? t : null;
  }

  /** Copies an old-only record into the unified list (same id for lead tasks) so it can be changed. */
  async adopt(id: string): Promise<Task | null> {
    const existing = await this.st.get(this.path(id));
    if (existing) return existing.deletedAt ? null : existing;
    const legacy = (await this.legacyTasks()).find((t) => t.id === id);
    if (!legacy) return null;
    const { readThrough: _r, ...t } = legacy;
    await this.st.set(this.path(t.id), t as any);
    return t as Task;
  }

  async update(id: string, input: TaskInput, actor: Actor, opts: { skipInboxMirror?: boolean } = {}) {
    const cur = await this.adopt(id);
    if (!cur) throw new TenancyError(404, 'not_found', 'Task not found.');
    const f = this.fields(input, true);
    if (f.title !== undefined && !f.title) throw new TenancyError(400, 'invalid_input', 'A task needs a title.');
    await this.checkLinks(input);
    const next: Task = { ...cur, ...f, updatedAt: nowIso() } as Task;
    if (f.completed !== undefined && f.completed !== cur.completed) next.completedAt = f.completed ? nowIso() : null;
    if (cur.leadId && next.leadId !== cur.leadId) await this.st.deleteRecursive(this.leadTaskPath(cur.leadId, cur.id)).catch(() => false);
    await this.st.set(this.path(id), next as any);
    await this.writeMirrors(next, { skipInbox: opts.skipInboxMirror });
    void actor;
    return next;
  }

  /** Removes a task from every list. The record is kept (deletedAt) for history. */
  async remove(id: string, actor: Actor) {
    const cur = await this.adopt(id);
    if (!cur) throw new TenancyError(404, 'not_found', 'Task not found.');
    const ts = nowIso();
    await this.st.update(this.path(id), { deletedAt: ts, deletedBy: actor.userId, status: 'cancelled', updatedAt: ts });
    if (cur.leadId) await this.st.deleteRecursive(this.leadTaskPath(cur.leadId, cur.id)).catch(() => false);
    if (cur.conversationId && inboxMirror) await inboxMirror(this.orgId, { ...cur, status: 'cancelled', deletedAt: ts }).catch(() => undefined);
    return { id };
  }

  /** Tasks that exist only in the old places (lead task lists, inbox tasks) and haven't been copied yet. */
  async legacyTasks(): Promise<Task[]> {
    const unifiedIds = new Set((await this.st.list(this.col())).map((t: any) => t.id));
    const out: Task[] = [];
    const leads = await this.st.list(`organizations/${this.orgId}/leads`);
    for (const lead of leads) {
      for (const t of await this.st.list(`organizations/${this.orgId}/leads/${lead.id}/tasks`)) {
        if (!t?.id || unifiedIds.has(t.id) || t.unifiedTaskId) continue;
        out.push(fromLeadTask(this.orgId, lead.id, t));
      }
    }
    if (inboxReader) {
      for (const { conversationId, task } of await inboxReader(this.orgId).catch(() => [])) {
        const u = fromInboxTask(this.orgId, conversationId, task);
        if (!unifiedIds.has(u.id) && !task.unifiedTaskId) out.push(u);
      }
    }
    return out;
  }

  /** Every task (unified + not-yet-copied old ones), filtered. */
  async list(filter: { view?: string; assigneeId?: string; mine?: { userId: string; names: string[] }; status?: string; leadId?: string; contactId?: string; dealId?: string; companyId?: string; conversationId?: string; meetingId?: string; q?: string; includeDone?: boolean; now?: number } = {}) {
    const now = filter.now ?? Date.now();
    const rows: Task[] = [...(await this.st.list(this.col())).filter((t: any) => !t.deletedAt), ...(await this.legacyTasks())];
    const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
    const day1 = new Date(day0); day1.setDate(day1.getDate() + 1);
    const due = (t: Task) => (t.dueDate ? Date.parse(t.dueDate) : NaN);
    const open = (t: Task) => t.status !== 'done' && t.status !== 'cancelled';
    const q = String(filter.q || '').trim().toLowerCase();
    return rows.filter((t) => {
      for (const k of ['leadId', 'contactId', 'dealId', 'companyId', 'conversationId', 'meetingId'] as const) if (filter[k] && t[k] !== filter[k]) return false;
      if (filter.assigneeId && t.assigneeId !== filter.assigneeId) return false;
      if (filter.mine) {
        const names = filter.mine.names.map((n) => n.toLowerCase()).filter(Boolean);
        const byName = !t.assigneeId && names.includes(String(t.assignedTo || '').toLowerCase());
        if (t.assigneeId !== filter.mine.userId && !byName) return false;
      }
      if (filter.status && t.status !== filter.status) return false;
      if (q && ![t.title, t.description, t.assignedTo].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      switch (filter.view) {
        case 'overdue': return open(t) && Number.isFinite(due(t)) && due(t) < now;
        case 'today': return open(t) && Number.isFinite(due(t)) && due(t) >= day0.getTime() && due(t) < day1.getTime();
        case 'upcoming': return open(t) && Number.isFinite(due(t)) && due(t) >= now;
        case 'due_soon': {
          const remind = t.reminderAt ? Date.parse(t.reminderAt) : NaN;
          return open(t) && ((Number.isFinite(remind) && remind <= now) || (Number.isFinite(due(t)) && due(t) <= now + 60 * 60_000));
        }
        case 'done': return t.status === 'done';
        default: return filter.includeDone || filter.status ? true : open(t);
      }
    }).sort((a, b) => {
      const da = due(a), db = due(b);
      if (Number.isFinite(da) !== Number.isFinite(db)) return Number.isFinite(da) ? -1 : 1;
      if (Number.isFinite(da) && da !== db) return da - db;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  /** Copies every old-only task into the unified list (idempotent: same ids, back-references kept). */
  async migrateLegacy(opts: { apply: boolean }) {
    const legacy = await this.legacyTasks();
    if (opts.apply) {
      for (const t of legacy) {
        const { readThrough: _r, ...row } = t;
        await this.st.set(this.path(row.id), { ...row, source: row.source, migratedAt: nowIso() } as any);
        if (row.legacy?.kind === 'lead' && row.leadId) await this.st.update(this.leadTaskPath(row.leadId, row.legacy.taskId), { unifiedTaskId: row.id });
      }
    }
    return { found: legacy.length, lead: legacy.filter((t) => t.legacy?.kind === 'lead').length, inbox: legacy.filter((t) => t.legacy?.kind === 'inbox').length, applied: opts.apply };
  }
}
