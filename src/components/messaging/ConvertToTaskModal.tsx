import React, { useState } from 'react';
import { X, CheckSquare, Calendar, User, Flag, ArrowRight, FileText } from 'lucide-react';
import { MessagingMessage, MessagingUser } from './types';

interface ConvertToTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: MessagingMessage | null;
  registeredAgents: MessagingUser[];
  onConvert: (taskData: {
    title: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    dueDate: string;
    assignee: string;
    sourceMessageId: string;
  }) => void;
}

export const ConvertToTaskModal: React.FC<ConvertToTaskModalProps> = ({
  isOpen,
  onClose,
  message,
  registeredAgents,
  onConvert
}) => {
  const [taskTitle, setTaskTitle] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('high');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date(Date.now() + 86400000 * 2);
    return d.toISOString().split('T')[0];
  });
  const [assignee, setAssignee] = useState(registeredAgents[0]?.name || '');

  React.useEffect(() => {
    if (message) {
      const cleanText = message.content.replace(/\n+/g, ' ').slice(0, 90);
      setTaskTitle(cleanText ? `Follow-up: ${cleanText}` : 'Follow up on discussion item');
    }
  }, [message]);

  if (!isOpen || !message) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    onConvert({
      title: taskTitle.trim(),
      priority,
      dueDate,
      assignee,
      sourceMessageId: message.id
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--surface)] backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-sunken)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[var(--warning)]">
              <CheckSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text)]">Convert Message to CRM Task</h3>
              <p className="text-xs text-[var(--text-muted)]">Assign actionable work directly to a CRM team member</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Source Quote snippet */}
          <div className="p-3 rounded-xl bg-[var(--surface-sunken)] border border-[var(--border)] text-xs text-[var(--text-muted)]">
            <p className="text-[10px] font-semibold text-[var(--text-subtle)] uppercase tracking-wider mb-1 flex items-center gap-1">
              <FileText className="w-3 h-3 text-[var(--warning)]" />
              Source Message from {message.senderName}
            </p>
            <p className="italic text-[var(--text-muted)] line-clamp-2">"{message.content}"</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Actionable Task Title</label>
            <input
              type="text"
              required
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-amber-500 transition"
              placeholder="What needs to be accomplished?"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
                <Flag className="w-3.5 h-3.5 text-[var(--danger)]" /> Priority Level
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-amber-500"
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium</option>
                <option value="high">High Priority</option>
                <option value="urgent">Urgent Escalation</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-[var(--accent-text)]" /> Due Date
              </label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
              <User className="w-3.5 h-3.5 text-[var(--success)]" /> Assigned Collaborator
            </label>
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-amber-500"
            >
              {registeredAgents.map((agent) => (
                <option key={agent.id} value={agent.name}>
                  {agent.name} ({agent.department || agent.role})
                </option>
              ))}
            </select>
          </div>

          <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)] text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition cursor-pointer"
            >
              <CheckSquare className="w-4 h-4" />
              <span>Create CRM Task</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
