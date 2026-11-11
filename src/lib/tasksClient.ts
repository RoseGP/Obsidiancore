/**
 * Client for the organization's single task list (/api/tasks). Every screen that creates or changes tasks
 * (Tasks view, lead drawer, inbox, meetings) goes through here so they all stay in step.
 */
import { notifyCrmChanged } from './crmEvents';

export type TaskType = 'task' | 'call' | 'meeting' | 'follow_up' | 'email';
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export interface CrmTask {
  id: string; title: string; description: string; type: TaskType; status: TaskStatus; priority: TaskPriority; completed: boolean;
  dueDate: string | null; reminderAt: string | null; assigneeId: string | null; assignedTo: string;
  leadId: string | null; contactId: string | null; dealId: string | null; companyId: string | null; conversationId: string | null; meetingId: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null; source: string; readThrough?: boolean;
}
export type TaskView = 'mine' | 'team' | 'overdue' | 'today' | 'upcoming' | 'due_soon' | 'done' | 'all';
export interface TaskInput {
  title?: string; description?: string; type?: TaskType; priority?: TaskPriority; status?: TaskStatus; completed?: boolean;
  dueDate?: string | null; reminderAt?: string | null; assigneeId?: string | null; assignedTo?: string;
  leadId?: string | null; contactId?: string | null; dealId?: string | null; companyId?: string | null; conversationId?: string | null; meetingId?: string | null;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.success === false) throw new Error(body?.error || `Request failed (${r.status}).`);
  return body as T;
}

export async function listTasks(params: { view?: TaskView; mine?: boolean; q?: string; leadId?: string; contactId?: string; dealId?: string; companyId?: string; conversationId?: string; meetingId?: string } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== false) qs.set(k, String(v));
  return (await call<{ tasks: CrmTask[] }>(`/api/tasks?${qs}`)).tasks;
}

export async function createTask(input: TaskInput) {
  const r = await call<{ task: CrmTask }>('/api/tasks', { method: 'POST', body: JSON.stringify(input) });
  notifyCrmChanged('task');
  return r.task;
}

export async function updateTask(id: string, patch: TaskInput) {
  const r = await call<{ task: CrmTask }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  notifyCrmChanged('task');
  return r.task;
}

export async function completeTask(id: string, completed = true) {
  const r = await call<{ task: CrmTask }>(`/api/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST', body: JSON.stringify({ completed }) });
  notifyCrmChanged('task');
  return r.task;
}

export async function deleteTask(id: string) {
  await call(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  notifyCrmChanged('task');
}

/** A follow-up after a meeting or call. `dueAt` defaults to tomorrow. Returns the created task. */
export function createFollowUpTask(input: { title: string; dueAt?: string | Date | null; leadId?: string | null; contactId?: string | null; dealId?: string | null; meetingId?: string | null; description?: string; priority?: TaskPriority }) {
  const due = input.dueAt ? new Date(input.dueAt) : new Date(Date.now() + 86_400_000);
  return createTask({
    title: input.title, type: 'follow_up', description: input.description, priority: input.priority || 'normal',
    dueDate: Number.isFinite(due.getTime()) ? due.toISOString() : null,
    leadId: input.leadId || null, contactId: input.contactId || null, dealId: input.dealId || null, meetingId: input.meetingId || null,
  });
}

export const TASK_TYPE_LABEL: Record<TaskType, string> = { task: 'To-do', call: 'Call', meeting: 'Meeting', follow_up: 'Follow-up', email: 'Email' };
export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
