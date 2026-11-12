import React, { useState, useEffect } from 'react';
import { getDashboardJson, invalidateDashboard } from '../../lib/dashboardData';
import { 
  Headphones, MessageSquare, AlertCircle, Clock, 
  CheckCircle2, ArrowUpRight,
  Send, RefreshCw
} from 'lucide-react';

export interface SupportTicket {
  id: string;
  customerName: string;
  company: string;
  channel: 'whatsapp' | 'email' | 'web' | 'phone' | 'sms' | string;
  subject: string;
  priority: 'critical' | 'high' | 'normal';
  slaMinutesRemaining?: number;
  status: 'open' | 'in_progress' | 'resolved';
  createdAt?: string;
}

function age(iso?: string): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 60) return `${m}m old`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h old` : `${Math.round(h / 24)}d old`;
}

export const SupportTicketsWidget: React.FC<{ onNavigate?: (view: any) => void }> = ({ onNavigate }) => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [replyTicketId, setReplyTicketId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchTickets = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data: any = await getDashboardJson('/api/dashboard/tickets');
      if (data.success && Array.isArray(data.tickets)) {
        const normalized = data.tickets.map((t: any, idx: number) => ({
          ...t,
          id: String(t.id || `ticket-${idx}-${t.customerName || 'customer'}`)
        }));
        normalized.sort((a: SupportTicket, b: SupportTicket) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setTickets(normalized);
      } else {
        throw new Error(data.error || 'Failed to fetch support tickets');
      }
    } catch (err: any) {
      console.error('[SupportTicketsWidget] Error:', err);
      setError(err.message || 'Error connecting to support queue.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const openTickets = tickets.filter(t => t.status !== 'resolved');

  const filteredTickets = tickets.filter(t => {
    if (filterPriority === 'all') return true;
    if (filterPriority === 'open') return t.status !== 'resolved';
    return t.priority === filterPriority;
  });

  const resolveTicket = async (id: string) => {
    try {
      const res = await fetch(`/api/dashboard/tickets/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setTickets(prev => prev.map(t => t.id === id ? { ...t, status: 'resolved' } : t));
        setReplyTicketId(null);
        invalidateDashboard();
      } else {
        setNotice(data.error || 'Couldn’t mark the ticket as done.');
      }
    } catch (err) {
      setNotice('Couldn’t reach the server. The ticket was not changed.');
    }
  };

  const handleSendReply = async (id: string) => {
    if (!replyText.trim() || isSending) return;
    setIsSending(true);
    try {
      const res = await fetch(`/api/dashboard/tickets/${id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyText: replyText.trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        // Saving a reply doesn't resolve the ticket; resolving is a separate action.
        // The server says whether it was delivered; don't claim more.
        setNotice(data.delivered ? 'Reply sent.' : (data.message || 'Reply saved to the ticket (not sent).'));
        setReplyText('');
        setReplyTicketId(null);
      } else {
        setNotice(data.error || 'Couldn’t save the reply. Your text is still in the box.');
      }
    } catch (err) {
      setNotice('Couldn’t reach the server. Your reply was not saved.');
    } finally {
      setIsSending(false);
    }
  };

  const getPriorityBadge = (priority: SupportTicket['priority']) => {
    switch (priority) {
      case 'critical':
        return <span className="text-[10px] font-mono font-bold text-[var(--danger)] bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 rounded">Critical</span>;
      case 'high':
        return <span className="text-[10px] font-mono font-bold text-[var(--warning)] bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">High Priority</span>;
      case 'normal':
        return <span className="text-[10px] font-mono font-bold text-[var(--text-muted)] bg-[var(--surface-sunken)] border border-[var(--border)] px-1.5 py-0.5 rounded">Standard</span>;
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col justify-between">
      <div>
        {/* Header & Overall Support KPIs */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[var(--text)] tracking-tight">Support tickets</span>
              <span className="text-[10px] font-mono font-bold text-[var(--success)] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                {tickets.length - openTickets.length} resolved
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Open tickets, newest first. Reply or mark them done.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-[10px] text-[var(--text-subtle)] block">Open Queue</span>
              <span className="font-bold text-[var(--warning)] tabular-nums">{openTickets.length} tickets</span>
            </div>
            <div className="h-6 w-px bg-[var(--border)]" />
            <div>
              <span className="text-[10px] text-[var(--text-subtle)] block">Critical</span>
              <span className="font-bold text-[var(--danger)] tabular-nums">{openTickets.filter(t => t.priority === 'critical').length}</span>
            </div>
            <button
              onClick={fetchTickets}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-[var(--surface-sunken)] hover:bg-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition"
              title="Refresh Tickets"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-[var(--accent-text)]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Strip */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={() => setFilterPriority('all')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors cursor-pointer ${
                filterPriority === 'all' ? 'bg-[var(--border)] text-[var(--text)] font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterPriority('open')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors cursor-pointer ${
                filterPriority === 'open' ? 'bg-indigo-600 text-white font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Active ({openTickets.length})
            </button>
            <button
              onClick={() => setFilterPriority('critical')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors cursor-pointer ${
                filterPriority === 'critical' ? 'bg-rose-600 text-white font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Critical
            </button>
          </div>

          {notice && <span role="status" className="text-[10px] text-[var(--text-muted)] truncate">{notice}</span>}
        </div>

        {/* Tickets List */}
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-[var(--text-muted)] text-xs">
            <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" />
            <span>Loading tickets…</span>
          </div>
        ) : error ? (
          <div className="py-8 text-center text-xs text-[var(--danger)] bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex flex-col items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
            <button
              onClick={fetchTickets}
              className="text-xs font-bold text-[var(--text)] underline underline-offset-2 hover:text-[var(--danger)]"
            >
              Retry
            </button>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="py-8 text-center text-xs text-[var(--text-subtle)] rounded-xl border border-dashed border-[var(--border)] p-4">
            {tickets.length === 0 ? 'No support tickets yet.' : 'No tickets in this view.'}
          </div>
        ) : (
          <div className="space-y-2.5 overflow-y-auto max-h-[300px] pr-1">
            {filteredTickets.map((ticket, idx) => (
              <div
                key={ticket.id ? `ticket-${ticket.id}-${idx}` : `ticket-${idx}`}
                className={`p-3 rounded-xl border transition-all ${
                  ticket.status === 'resolved'
                    ? 'bg-white/[0.01] border-[var(--border)] opacity-60'
                    : 'bg-white/[0.03] border-[var(--border)] hover:border-[var(--border)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-[var(--text)] truncate">{ticket.customerName}</span>
                      {ticket.company && <span className="text-[11px] text-[var(--text-muted)] font-mono">({ticket.company})</span>}
                      {getPriorityBadge(ticket.priority)}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-1 leading-relaxed">
                      {ticket.subject}
                    </p>
                  </div>

                  {/* Response deadline when the ticket has one, otherwise its age */}
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-mono font-bold block tabular-nums ${
                      typeof ticket.slaMinutesRemaining === 'number' && ticket.slaMinutesRemaining < 30 && ticket.status !== 'resolved' ? 'text-[var(--danger)]' : 'text-[var(--success)]'
                    }`}>
                      {ticket.status === 'resolved' ? 'Resolved' : typeof ticket.slaMinutesRemaining === 'number' ? `${ticket.slaMinutesRemaining}m to respond` : (age(ticket.createdAt) || 'Open')}
                    </span>
                    <span className="text-[10px] text-[var(--text-subtle)] font-mono capitalize">
                      via {ticket.channel}
                    </span>
                  </div>
                </div>

                {/* Reply drawer inside ticket */}
                {replyTicketId === ticket.id ? (
                  <div className="mt-3 pt-3 border-t border-[var(--border)] space-y-2 animate-in fade-in">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={`Reply to ${ticket.customerName} via ${ticket.channel.toUpperCase()}...`}
                      rows={2}
                      className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-lg p-2 text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-indigo-500/50"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setReplyTicketId(null)}
                        className="px-2.5 py-1 rounded-md text-[11px] text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={() => handleSendReply(ticket.id)}
                        className="px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Send className="h-3 w-3" />
                        <span>{isSending ? 'Saving…' : 'Save reply'}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2.5 pt-2 border-t border-[var(--border)] flex items-center justify-between text-[11px]">
                    <span className="text-[10px] text-[var(--text-subtle)] font-mono">
                      ID: {ticket.id}
                    </span>

                    {ticket.status !== 'resolved' && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setReplyTicketId(ticket.id)}
                          className="text-[var(--accent-text)] hover:text-[var(--accent-text)] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <MessageSquare className="h-3 w-3" />
                          <span>Quick Reply</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveTicket(ticket.id)}
                          className="text-[var(--success)] hover:text-[var(--success)] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Mark Done</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span className="font-mono text-[10px]">{openTickets.length} open · {tickets.length} total</span>
        <button
          type="button"
          onClick={() => onNavigate && onNavigate('messages')}
          className="text-[var(--accent-text)] hover:text-[var(--accent-text)] text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>Open Inbox</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default SupportTicketsWidget;
