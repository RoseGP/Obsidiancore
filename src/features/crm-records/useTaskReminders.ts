/**
 * Task reminders through the app's existing notification centre (no separate notification system): every few
 * minutes, the signed-in person's tasks whose reminder time has come, or that are due within the hour, raise
 * one in-app notification each (remembered per task + due time, so the same reminder isn't repeated).
 */
import { useEffect } from 'react';
import { listTasks } from '../../lib/tasksClient';
import { useOptionalNotifications } from '../../context/NotificationContext';

const KEY = 'obsidian_task_reminders_v1';
const EVERY_MS = 5 * 60_000;

function seen(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function remember(s: Record<string, number>) {
  const cutoff = Date.now() - 14 * 86_400_000;
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(Object.entries(s).filter(([, t]) => t > cutoff)))); } catch { /* storage blocked: may repeat */ }
}

export function useTaskReminders(enabled: boolean) {
  const n = useOptionalNotifications();
  const push = n?.pushNotification;
  useEffect(() => {
    if (!enabled || !push) return;
    let stopped = false;
    const check = async () => {
      try {
        const due = await listTasks({ view: 'due_soon', mine: true });
        if (stopped) return;
        const s = seen();
        for (const t of due.slice(0, 5)) {
          const k = `${t.id}:${t.reminderAt || t.dueDate || ''}`;
          if (s[k]) continue;
          s[k] = Date.now();
          const when = t.dueDate ? new Date(t.dueDate) : null;
          const overdue = when && when.getTime() < Date.now();
          push({
            title: overdue ? 'Task overdue' : 'Task due soon', type: 'task', priority: t.priority === 'urgent' || overdue ? 'high' : 'normal',
            message: `${t.title}${when ? ` · ${overdue ? 'was due' : 'due'} ${when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}`,
            targetView: 'tasks' as any, targetId: t.id,
          });
        }
        remember(s);
      } catch { /* offline or signed out: try again next time */ }
    };
    const first = setTimeout(check, 8_000);
    const timer = setInterval(check, EVERY_MS);
    return () => { stopped = true; clearTimeout(first); clearInterval(timer); };
  }, [enabled, push]);
}
