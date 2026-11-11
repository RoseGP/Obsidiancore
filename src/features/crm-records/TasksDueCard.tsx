/**
 * Dashboard card: the signed-in person's overdue and due-today tasks from the one task list (/api/tasks).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { listTasks, type CrmTask } from '../../lib/tasksClient';
import { onCrmChanged } from '../../lib/crmEvents';
import { TaskList } from './TasksView';
import { ErrorNote } from './ui';

export default function TasksDueCard({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [rows, setRows] = useState<CrmTask[] | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    try {
      const [overdue, today] = await Promise.all([listTasks({ view: 'overdue', mine: true }), listTasks({ view: 'today', mine: true })]);
      const seen = new Set<string>();
      setRows([...overdue, ...today].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true))));
    } catch (e: any) { setErr(e.message); setRows([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => onCrmChanged((k) => { if (k === 'task') void load(); }), [load]);

  return (
    <section aria-labelledby="tasks-due-title" className="cc-card rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="tasks-due-title" className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text)]"><ClipboardList className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />Your tasks today</h2>
        {onNavigate && <button type="button" onClick={() => onNavigate('tasks')} className="text-[12px] font-medium text-[var(--accent-text)] hover:underline">All tasks</button>}
      </div>
      {err && <ErrorNote text={err} onRetry={load} />}
      {rows === null ? <p className="text-[13px] text-[var(--text-muted)]">Loading…</p>
        : rows.length === 0 ? <p className="text-[13px] text-[var(--text-muted)]">Nothing overdue or due today.</p>
        : <TaskList compact tasks={rows.slice(0, 6)} onChanged={load} onNavigate={onNavigate} />}
      {rows && rows.length > 6 && <p className="mt-2 text-[12px] text-[var(--text-muted)]">and {rows.length - 6} more</p>}
    </section>
  );
}
