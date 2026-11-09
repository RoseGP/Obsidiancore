import React, { useState, useEffect } from 'react';
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
      const res = await fetch('/api/dashboard/tickets');
      const data = await res.json();
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
        return <span className="text-[10px] font-mono font-bold text-rose-400 bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 rounded">Critical</span>;
      case 'high':
        return <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">High Priority</span>;
      case 'normal':
        return <span className="text-[10px] font-mono font-bold text-neutral-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">Standard</span>;
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
              <span className="text-sm font-bold text-white tracking-tight">Support tickets</span>
              <span className="text-[10px] font-mono font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                {tickets.length - openTickets.length} resolved
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Open tickets, newest first. Reply or mark them done.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-[10px] text-neutral-500 block">Open Queue</span>
              <span className="font-bold text-amber-400 tabular-nums">{openTickets.length} tickets</span>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <span className="text-[10px] text-neutral-500 block">Critical</span>
              <span className="font-bold text-rose-400 tabular-nums">{openTickets.filter(t => t.priority === 'critical').length}</span>
            </div>
            <button
              onClick={fetchTickets}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition"
              title="Refresh Tickets"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter Strip */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 text-xs">
            <button
              onClick={() => setFilterPriority('all')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors cursor-pointer ${
                filterPriority === 'all' ? 'bg-white/20 text-white font-bold' : 'text-neutral-400 hover:text-white'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilterPriority('open')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors cursor-pointer ${
                filterPriority === 'open' ? 'bg-indigo-600 text-white font-bold' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Active ({openTickets.length})
            </button>
            <button
              onClick={() => setFilterPriority('critical')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors cursor-pointer ${
                filterPriority === 'critical' ? 'bg-rose-600 text-white font-bold' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Critical
            </button>
          </div>

          {notice && <span role="status" className="text-[10px] text-neutral-400 truncate">{notice}</span>}
        </div>

        {/* Tickets List */}
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-neutral-400 text-xs">
            <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" />
            <span>Loading tickets…</span>
          </div>
        ) : error ? (
          <div className="py-8 text-center text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex flex-col items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
            <button
              onClick={fetchTickets}
              className="text-xs font-bold text-white underline underline-offset-2 hover:text-rose-200"
            >
              Retry
            </button>
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="py-8 text-center text-xs text-neutral-500 rounded-xl border border-dashed border-white/10 p-4">
            {tickets.length === 0 ? 'No support tickets yet.' : 'No tickets in this view.'}
          </div>
        ) : (
          <div className="space-y-2.5 overflow-y-auto max-h-[300px] pr-1">
            {filteredTickets.map((ticket, idx) => (
              <div
                key={ticket.id ? `ticket-${ticket.id}-${idx}` : `ticket-${idx}`}
                className={`p-3 rounded-xl border transition-all ${
                  ticket.status === 'resolved'
                    ? 'bg-white/[0.01] border-white/5 opacity-60'
                    : 'bg-white/[0.03] border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-white truncate">{ticket.customerName}</span>
                      {ticket.company && <span className="text-[11px] text-neutral-400 font-mono">({ticket.company})</span>}
                      {getPriorityBadge(ticket.priority)}
                    </div>
                    <p className="text-xs text-neutral-300 mt-1 line-clamp-1 leading-relaxed">
                      {ticket.subject}
                    </p>
                  </div>

                  {/* Response deadline when the ticket has one, otherwise its age */}
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-mono font-bold block tabular-nums ${
                      typeof ticket.slaMinutesRemaining === 'number' && ticket.slaMinutesRemaining < 30 && ticket.status !== 'resolved' ? 'text-rose-400' : 'text-emerald-400'
                    }`}>
                      {ticket.status === 'resolved' ? 'Resolved' : typeof ticket.slaMinutesRemaining === 'number' ? `${ticket.slaMinutesRemaining}m to respond` : (age(ticket.createdAt) || 'Open')}
                    </span>
                    <span className="text-[10px] text-neutral-500 font-mono capitalize">
                      via {ticket.channel}
                    </span>
                  </div>
                </div>

                {/* Reply drawer inside ticket */}
                {replyTicketId === ticket.id ? (
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-2 animate-in fade-in">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={`Reply to ${ticket.customerName} via ${ticket.channel.toUpperCase()}...`}
                      rows={2}
                      className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500/50"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setReplyTicketId(null)}
                        className="px-2.5 py-1 rounded-md text-[11px] text-neutral-400 hover:text-white"
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
                  <div className="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                    <span className="text-[10px] text-neutral-500 font-mono">
                      ID: {ticket.id}
                    </span>

                    {ticket.status !== 'resolved' && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setReplyTicketId(ticket.id)}
                          className="text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <MessageSquare className="h-3 w-3" />
                          <span>Quick Reply</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveTicket(ticket.id)}
                          className="text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1 cursor-pointer transition-colors"
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
      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-neutral-400">
        <span className="font-mono text-[10px]">{openTickets.length} open · {tickets.length} total</span>
        <button
          type="button"
          onClick={() => onNavigate && onNavigate('messages')}
          className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>Open Inbox</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default SupportTicketsWidget;
