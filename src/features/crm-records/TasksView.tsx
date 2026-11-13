/**
 * Tasks: the organization's one task list (calls, meetings, follow-ups, to-dos) from /api/tasks.
 * Views: My tasks · Team · Overdue · Today · Upcoming · Done. Tasks can be linked to a lead, contact, deal,
 * company, inbox conversation or meeting; lead and inbox tasks created elsewhere show here too.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Circle, ClipboardList, Pencil, Plus, Search, Sparkles, Trash2, Phone, Video, Mail, Repeat, ListTodo } from 'lucide-react';
import { completeTask, createTask, deleteTask, listTasks, updateTask, PRIORITY_LABEL, TASK_TYPE_LABEL, type CrmTask, type TaskInput, type TaskPriority, type TaskType, type TaskView } from '../../lib/tasksClient';
import { onCrmChanged } from '../../lib/crmEvents';
import { useTeamMembers } from '../../hooks/useTeamMembers';
import { useOptionalAuth } from '../../context/AuthContext';
import { Badge, Button, Card, Empty, ErrorNote, Field, Loading, Modal, Page, fmtDate, inputCls } from './ui';
import { useCan } from '../../lib/myPermissions';

const VIEWS: Array<{ id: TaskView; label: string }> = [
  { id: 'mine', label: 'My tasks' }, { id: 'team', label: 'Team' }, { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'done', label: 'Done' },
];
const TYPE_ICON: Record<TaskType, React.ComponentType<any>> = { task: ListTodo, call: Phone, meeting: Video, follow_up: Repeat, email: Mail };
const PRIORITY_TONE: Record<TaskPriority, 'neutral' | 'accent' | 'warning' | 'danger'> = { low: 'neutral', normal: 'neutral', high: 'warning', urgent: 'danger' };
/** Left edge colour of a task row (full list only), so urgent work stands out while scanning. */
const PRIORITY_EDGE: Record<TaskPriority, string> = { low: 'transparent', normal: 'transparent', high: 'var(--warning)', urgent: 'var(--danger)' };

const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function linkLabel(t: CrmTask): { label: string; view: string } | null {
  if (t.leadId) return { label: 'Lead', view: 'leads' };
  if (t.contactId) return { label: 'Contact', view: 'deals' };
  if (t.dealId) return { label: 'Deal', view: 'deals' };
  if (t.companyId) return { label: 'Company', view: 'deals' };
  if (t.conversationId) return { label: 'Inbox', view: 'messages' };
  if (t.meetingId) return { label: 'Meeting', view: 'calendar' };
  return null;
}

/** Create / edit form. `fixed` pre-links the task to a record (e.g. from a contact profile). */
export function TaskForm({ task, fixed, onClose, onSaved }: { task?: CrmTask | null; fixed?: Partial<TaskInput>; onClose: () => void; onSaved: (t: CrmTask) => void }) {
  const { members } = useTeamMembers();
  const auth = useOptionalAuth();
  const myId = auth?.user?.uid || '';
  const [f, setF] = useState({
    title: task?.title || '', description: task?.description || '', type: (task?.type || 'task') as TaskType, priority: (task?.priority || 'normal') as TaskPriority,
    due: toLocalInput(task?.dueDate), reminder: toLocalInput(task?.reminderAt), assigneeId: task ? task.assigneeId || '' : 'me',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (!f.title.trim()) { setErr('Add a title.'); return; }
    setBusy(true); setErr('');
    const who = members.find((m) => m.id === f.assigneeId);
    const input: TaskInput = {
      title: f.title.trim(), description: f.description.trim(), type: f.type, priority: f.priority,
      dueDate: fromLocalInput(f.due), reminderAt: fromLocalInput(f.reminder),
      // "Me" on a new task: the server assigns it to whoever is signed in.
      ...(f.assigneeId === 'me' ? {} : { assigneeId: f.assigneeId || null }), ...(who ? { assignedTo: who.name } : f.assigneeId === '' ? { assignedTo: '' } : {}), ...(task ? {} : fixed || {}),
    };
    try { onSaved(task ? await updateTask(task.id, input) : await createTask(input)); onClose(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose} labelId="task-form-title"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : task ? 'Save' : 'Add task'}</Button></>}>
      <Field label="Title"><input autoFocus className={inputCls} value={f.title} onChange={set('title')} placeholder="Call Hana about the renewal" maxLength={300} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Type"><select className={inputCls} value={f.type} onChange={set('type')}>{(Object.keys(TASK_TYPE_LABEL) as TaskType[]).map((k) => <option key={k} value={k}>{TASK_TYPE_LABEL[k]}</option>)}</select></Field>
        <Field label="Priority"><select className={inputCls} value={f.priority} onChange={set('priority')}>{(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((k) => <option key={k} value={k}>{PRIORITY_LABEL[k]}</option>)}</select></Field>
        <Field label="Due"><input type="datetime-local" className={inputCls} value={f.due} onChange={set('due')} /></Field>
        <Field label="Remind me" hint="You get a notification at this time."><input type="datetime-local" className={inputCls} value={f.reminder} onChange={set('reminder')} /></Field>
      </div>
      <Field label="Assigned to">
        <select className={inputCls} value={f.assigneeId} onChange={set('assigneeId')}>
          {!task && <option value="me">Me</option>}
          <option value="">Unassigned</option>
          {members.filter((m) => task || m.id !== myId).map((m) => <option key={m.id} value={m.id}>{m.id === myId ? `${m.name} (me)` : m.name}</option>)}
        </select>
      </Field>
      <Field label="Notes"><textarea rows={3} className={inputCls} value={f.description} onChange={set('description')} maxLength={4000} /></Field>
      {err && <ErrorNote text={err} />}
    </Modal>
  );
}

/** A list of tasks with complete / edit / delete. Used by the Tasks view and the contact/company profiles. */
export function TaskList({ tasks, onChanged, onNavigate, compact }: { tasks: CrmTask[]; onChanged: () => void; onNavigate?: (view: string) => void; compact?: boolean }) {
  const can = useCan();
  const [editing, setEditing] = useState<CrmTask | null>(null);
  const [confirm, setConfirm] = useState<CrmTask | null>(null);
  const [err, setErr] = useState('');
  const now = Date.now();
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); onChanged(); } catch (e: any) { setErr(e.message); } };

  return (
    <>
      {err && <div className="mb-2"><ErrorNote text={err} /></div>}
      <ul className="divide-y divide-[var(--border)]">
        {tasks.map((t) => {
          const Icon = TYPE_ICON[t.type] || ListTodo;
          const done = t.status === 'done';
          const overdue = !done && t.dueDate && Date.parse(t.dueDate) < now;
          const link = linkLabel(t);
          return (
            <li key={t.id} className={compact ? 'flex items-start gap-3 py-2' : 'group relative flex items-start gap-3 px-4 sm:px-5 py-3.5 transition-colors hover:bg-[var(--surface-raised)]'}>
              {!compact && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: done ? 'transparent' : PRIORITY_EDGE[t.priority] }} />}
              <button type="button" onClick={() => run(() => completeTask(t.id, !done))} aria-label={done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
                className="mt-0.5 rounded-full text-[var(--text-muted)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                {done ? <CheckCircle2 className="h-5 w-5 text-[var(--success)]" /> : <Circle className="h-5 w-5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className={`${compact ? 'text-[13px]' : 'text-[14px]'} font-medium break-words ${done ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text)]'}`}>{t.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <span className={compact ? 'inline-flex items-center gap-1' : 'inline-flex items-center gap-1 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 font-medium'}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{TASK_TYPE_LABEL[t.type] || 'Task'}</span>
                  {t.dueDate && <span className={`inline-flex items-center gap-1 ${overdue ? 'font-medium text-[var(--danger)]' : ''}`}>{!compact && <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />}{overdue ? 'Overdue · ' : 'Due '}{fmtDate(t.dueDate, true)}</span>}
                  {t.priority !== 'normal' && <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Badge>}
                  {t.assignedTo && <span>· {t.assignedTo}</span>}
                  {link && (onNavigate ? <button type="button" className="text-[var(--accent-text)] hover:underline" onClick={() => onNavigate(link.view)}>{link.label}</button> : <Badge>{link.label}</Badge>)}
                </div>
                {!compact && t.description && <p className="mt-1 text-[12px] text-[var(--text-muted)] whitespace-pre-wrap break-words">{t.description}</p>}
              </div>
              <div className={`flex shrink-0 items-center ${compact ? '' : 'opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'}`}>
                <Button variant="ghost" className="!px-2" aria-label={`Edit “${t.title}”`} onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></Button>
                {can('tasks', 'delete') && <Button variant="ghost" className="!px-2" aria-label={`Delete “${t.title}”`} onClick={() => setConfirm(t)}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </li>
          );
        })}
      </ul>
      {editing && <TaskForm task={editing} onClose={() => setEditing(null)} onSaved={() => onChanged()} />}
      {confirm && (
        <Modal title="Delete this task?" onClose={() => setConfirm(null)} labelId="task-del-title"
          footer={<><Button onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={() => { const t = confirm; setConfirm(null); run(() => deleteTask(t.id)); }}>Delete</Button></>}>
          <p className="text-[13px] text-[var(--text)]">“{confirm.title}” is removed from every list, including the lead or conversation it belongs to. It stays in the record’s history.</p>
        </Modal>
      )}
    </>
  );
}

/** Opens the existing AI copilot, which lives on the dashboard: go there, then scroll to it and focus its input. */
function openAssistant(onNavigate: (view: string) => void) {
  onNavigate('dashboard');
  let tries = 0;
  const seek = () => {
    const panel = document.getElementById('copilot');
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById('assistant-input')?.focus({ preventScroll: true });
    } else if (++tries < 40) window.setTimeout(seek, 100); // the dashboard loads lazily
  };
  window.setTimeout(seek, 0);
}

function AiAssistantButton({ onNavigate }: { onNavigate?: (view: string) => void }) {
  return (
    <button type="button" disabled={!onNavigate} onClick={() => onNavigate && openAssistant(onNavigate)}
      title={onNavigate ? 'Open the AI copilot on your dashboard' : 'The AI copilot is on the dashboard'}
      className="group inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/25 bg-[var(--accent-soft)] py-1.5 pl-1.5 pr-3.5 text-[13px] font-semibold text-[var(--accent-text)] shadow-[var(--shadow-xs)] transition-all hover:border-[var(--accent)]/50 hover:shadow-[var(--shadow-md)] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
      <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[#B06AE8] text-white shadow-sm transition-transform group-hover:scale-105">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      AI Assistant
    </button>
  );
}

function StatTile({ icon, label, value, hint, tone, active, onClick }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint: string; tone: 'danger' | 'accent' | 'success'; active?: boolean; onClick?: () => void }) {
  const chip = tone === 'danger' ? 'bg-[var(--danger-soft)] text-[var(--danger)]' : tone === 'success' ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--accent-soft)] text-[var(--accent-text)]';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag {...(onClick ? { type: 'button' as const, onClick, 'aria-pressed': !!active } : {})}
      className={`flex items-center gap-3 rounded-[var(--radius-card)] border bg-[var(--surface)] p-4 text-left shadow-[var(--shadow-xs)] transition-all ${active ? 'border-[var(--accent)] ring-2 ring-[var(--accent-soft)]' : 'border-[var(--border)]'} ${onClick ? 'hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-md)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]' : ''}`}>
      <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${chip}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-[var(--text-muted)]">{label}</span>
        <span className="block text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[var(--text)] tabular-nums">{value}</span>
        <span className="block truncate text-[11px] text-[var(--text-subtle)]">{hint}</span>
      </span>
    </Tag>
  );
}

export default function TasksView({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const can = useCan();
  const [view, setView] = useState<TaskView>('mine');
  const [q, setQ] = useState('');
  const [tasks, setTasks] = useState<CrmTask[] | null>(null);
  const [counts, setCounts] = useState<{ overdue: number; today: number } | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setErr('');
    try {
      const [rows, overdue, today] = await Promise.all([
        listTasks({ view: view === 'done' ? 'done' : view, q: q.trim() || undefined }),
        listTasks({ view: 'overdue', mine: true }), listTasks({ view: 'today', mine: true }),
      ]);
      setTasks(rows); setCounts({ overdue: overdue.length, today: today.length });
    } catch (e: any) { setErr(e.message); setTasks((t) => t ?? []); }
  }, [view, q]);

  useEffect(() => { const h = setTimeout(load, q ? 250 : 0); return () => clearTimeout(h); }, [load, q]);
  useEffect(() => onCrmChanged((k) => { if (k === 'task') void load(); }), [load]);

  const subtitle = useMemo(() => counts ? [counts.overdue ? `${counts.overdue} overdue` : 'Nothing overdue', `${counts.today} due today`].join(' · ') : 'Calls, meetings and follow-ups for you and your team.', [counts]);
  const viewLabel = VIEWS.find((v) => v.id === view)?.label || 'Tasks';
  const openCount = tasks ? tasks.filter((t) => t.status !== 'done').length : null;

  return (
    <Page title="Tasks" subtitle={subtitle} actions={<>
      <AiAssistantButton onNavigate={onNavigate} />
      {can('tasks', 'create') && <Button variant="primary" className="!rounded-full !px-4 shadow-[var(--shadow-sm)]" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />New task</Button>}
    </>}>
      <section aria-label="Task summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile icon={<AlertTriangle className="h-5 w-5" />} tone="danger" label="Overdue" value={counts ? counts.overdue : '–'}
          hint={counts?.overdue ? 'Assigned to you and past due' : 'You’re all caught up'} active={view === 'overdue'} onClick={() => setView('overdue')} />
        <StatTile icon={<CalendarClock className="h-5 w-5" />} tone="accent" label="Due today" value={counts ? counts.today : '–'}
          hint="Assigned to you" active={view === 'today'} onClick={() => setView('today')} />
        <StatTile icon={<ClipboardList className="h-5 w-5" />} tone="success" label={view === 'done' ? 'Finished' : 'Open in this list'}
          value={tasks === null ? '–' : view === 'done' ? tasks.length : openCount} hint={q ? `${viewLabel} · matching “${q.trim()}”` : viewLabel} />
      </section>
      {err && <ErrorNote text={err} onRetry={load} />}
      <Card className="overflow-hidden shadow-[var(--shadow-xs)]">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 sm:px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div role="tablist" aria-label="Task lists" className="flex gap-1 overflow-x-auto rounded-full bg-[var(--surface-sunken)] p-1">
            {VIEWS.map((v) => (
              <button key={v.id} role="tab" type="button" aria-selected={view === v.id} onClick={() => setView(v.id)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${view === v.id ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                {v.label}{v.id === 'overdue' && counts?.overdue ? <span className="rounded-full bg-[var(--danger-soft)] px-1.5 text-[11px] font-semibold text-[var(--danger)] tabular-nums" aria-label={`, ${counts.overdue}`}>{counts.overdue}</span> : null}
              </button>
            ))}
          </div>
          <label className="relative block sm:w-64">
            <span className="sr-only">Search tasks</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks" className={`${inputCls} !rounded-full pl-9`} />
          </label>
        </div>
        {tasks === null ? <Loading label="Loading tasks…" />
          : tasks.length === 0 ? (
            <Empty icon={<span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-text)]"><ClipboardList className="h-7 w-7" /></span>} title={q ? 'No tasks match your search.' : view === 'overdue' ? 'Nothing overdue.' : view === 'done' ? 'No finished tasks yet.' : 'No tasks here.'}
              text={view === 'mine' && !q ? 'Tasks you add, and follow-ups from leads, the inbox and meetings, show up here.' : undefined}
              action={!q && view !== 'done' && can('tasks', 'create') ? <Button variant="primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />New task</Button> : undefined} />
          ) : <TaskList tasks={tasks} onChanged={load} onNavigate={onNavigate} />}
      </Card>
      {adding && <TaskForm onClose={() => setAdding(false)} onSaved={() => load()} />}
    </Page>
  );
}
