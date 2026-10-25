import React, { useState, useEffect } from 'react';
import { 
  Headphones, MessageSquare, AlertCircle, Clock, 
  CheckCircle2, ArrowUpRight, Star,
  Send, RefreshCw
} from 'lucide-react';

export interface SupportTicket {
  id: string;
  customerName: string;
  company: string;
  channel: 'whatsapp' | 'email' | 'web' | 'phone' | 'sms' | string;
  subject: string;
  priority: 'critical' | 'high' | 'normal';
  slaMinutesRemaining: number;
  status: 'open' | 'in_progress' | 'resolved';
  sentiment: 'urgent' | 'neutral' | 'positive';
}

export const SupportTicketsWidget: React.FC<{ onNavigate?: (view: any) => void }> = ({ onNavigate }) => {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [replyTicketId, setReplyTicketId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);

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
      const data = await res.json();
      if (data.success) {
        setTickets(prev => prev.map(t => t.id === id ? { ...t, status: 'resolved' } : t));
        setReplyTicketId(null);
      }
    } catch (err) {
      console.error('Failed to resolve ticket:', err);
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
      const data = await res.json();
      if (data.success) {
        setTickets(prev => prev.map(t => t.id === id ? { ...t, status: 'resolved' } : t));
        setReplyText('');
        setReplyTicketId(null);
      }
    } catch (err) {
      console.error('Failed to send reply:', err);
    } finally {
      setIsSending(false);
    }
  };

  const getPriorityBadge = (priority: SupportTicket['priority']) => {
    switch (priority) {
      case 'critical':
        return <span className="text-[10px] font-mono font-bold text-rose-400 bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 rounded">Critical SLA</span>;
      case 'high':
        return <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded">High Priority</span>;
      case 'normal':
        return <span className="text-[10px] font-mono font-bold text-neutral-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">Standard</span>;
    }
  };

  return (
    <div className="h-full flex flex-col justify-between">
      <div>
        {/* Header & Overall Support KPIs */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white tracking-tight">Customer Support & SLAs</span>
              <span className="text-[10px] font-mono font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                98.4% SLA Met
              </span>
            </div>
            <p className="text-xs text-neutral-400 mt-0.5">
              Omnichannel ticket queue, SLA response timers, and CSAT rating.
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div>
              <span className="text-[10px] text-neutral-500 block">Open Queue</span>
              <span className="font-bold text-amber-400 tabular-nums">{openTickets.length} tickets</span>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <span className="text-[10px] text-neutral-500 block">Avg Response</span>
              <span className="font-bold text-emerald-400 tabular-nums">1.2m</span>
            </div>
            <div className="h-6 w-px bg-white/10" />
            <div>
              <span className="text-[10px] text-neutral-500 block">CSAT Score</span>
              <span className="font-bold text-white flex items-center gap-0.5 tabular-nums">
                <Star className="h-3 w-3 text-amber-400 fill-current" />
                <span>4.9</span>
              </span>
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

          <span className="text-[10px] font-mono text-neutral-500">
            Source: WhatsApp · Email · Web · Voice · SMS
          </span>
        </div>

        {/* Tickets List */}
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-neutral-400 text-xs">
            <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" />
            <span>Connecting to ticket queue...</span>
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
            No support tickets in this view.
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
                      <span className="text-[11px] text-neutral-400 font-mono">({ticket.company})</span>
                      {getPriorityBadge(ticket.priority)}
                    </div>
                    <p className="text-xs text-neutral-300 mt-1 line-clamp-1 leading-relaxed">
                      {ticket.subject}
                    </p>
                  </div>

                  {/* SLA countdown timer */}
                  <div className="text-right shrink-0">
                    <span className={`text-xs font-mono font-bold block tabular-nums ${
                      ticket.slaMinutesRemaining < 30 ? 'text-rose-400 animate-pulse' : 'text-emerald-400'
                    }`}>
                      {ticket.status === 'resolved' ? 'Resolved' : `${ticket.slaMinutesRemaining}m SLA`}
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
                        <span>{isSending ? 'Sending...' : 'Send & Resolve'}</span>
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
        <span className="font-mono text-[10px]">Auto-Triage Active (Gemini & Voice Bots)</span>
        <button
          type="button"
          onClick={() => onNavigate && onNavigate('messages')}
          className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>Open Unified Inbox</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default SupportTicketsWidget;
