import React, { useState } from "react";
import { 
  FileText, Plus, PhoneCall, CheckCircle2, 
  Clock, AlertCircle, Copy, Check, User, Building2, Phone
} from "lucide-react";
import { ReceptionistMessageSlip } from "@cloudflare/voice/react";
import { copyToClipboard } from "../../utils/clipboard";
import { useTeamMembers } from "../../hooks/useTeamMembers";

interface MessageSlipsInboxProps {
  messageSlips: ReceptionistMessageSlip[];
  onAddSlip: (slip: Omit<ReceptionistMessageSlip, "id" | "timestamp" | "status">) => void;
  onUpdateStatus: (id: string, status: "unread" | "resolved" | "called_back") => void;
  onDialBack: (phone: string, name: string) => void;
}

export default function MessageSlipsInbox({
  messageSlips,
  onAddSlip,
  onUpdateStatus,
  onDialBack
}: MessageSlipsInboxProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form State for manual slip
  const [formCallerName, setFormCallerName] = useState("");
  const [formCompany, setFormCompany] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const team = useTeamMembers();
  const [formRecipient, setFormRecipient] = useState("");
  const [formUrgency, setFormUrgency] = useState<"normal" | "high" | "urgent">("high");
  const [formNotes, setFormNotes] = useState("");

  const handleSubmitManualSlip = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCallerName || !formNotes || !formPhone.trim()) return;

    onAddSlip({
      callerName: formCallerName,
      callerCompany: formCompany,
      callbackNumber: formPhone.trim(),
      recipient: formRecipient || "Anyone on the team",
      urgency: formUrgency,
      notes: formNotes
    });

    setFormCallerName("");
    setFormCompany("");
    setFormPhone("");
    setFormNotes("");
    setShowAddModal(false);
  };

  const handleCopySlip = async (slip: ReceptionistMessageSlip) => {
    const text = `[RECEPTIONIST MESSAGE SLIP]\nCaller: ${slip.callerName} (${slip.callerCompany})\nPhone: ${slip.callbackNumber}\nFor: ${slip.recipient}\nUrgency: ${slip.urgency.toUpperCase()}\nNotes: ${slip.notes}\nTime: ${slip.timestamp}`;
    await copyToClipboard(text);
    setCopiedId(slip.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const unreadCount = messageSlips.filter(s => s.status === "unread").length;

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm text-left">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-amber-600" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            Receptionist Message Slips
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
              {unreadCount} Unread
            </span>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-blue-50 hover:bg-blue-600 border border-blue-200 hover:border-blue-600 text-blue-600 hover:text-white text-xs font-bold transition-all cursor-pointer shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Slip</span>
          </button>
        </div>
      </div>

      {/* Slips List */}
      <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
        {messageSlips.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            No message slips recorded yet. The receptionist creates slips when taking caller messages.
          </div>
        ) : (
          messageSlips.map((slip) => {
            const isUnread = slip.status === "unread";
            const urgencyColors = {
              urgent: "bg-rose-50 text-rose-700 border-rose-200",
              high: "bg-amber-50 text-amber-700 border-amber-200",
              normal: "bg-blue-50 text-blue-700 border-blue-200"
            };

            return (
              <div
                key={slip.id}
                className={`p-3 rounded-2xl border transition-all ${
                  isUnread
                    ? "bg-white border-slate-300 shadow-sm"
                    : "bg-slate-50/70 border-slate-200 opacity-80"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-slate-900">{slip.callerName}</h4>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase tracking-wider ${urgencyColors[slip.urgency]}`}>
                        {slip.urgency}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">{slip.callerCompany} • <span className="font-mono text-slate-700">{slip.callbackNumber}</span></p>
                  </div>
                  <span className="text-[9px] text-slate-400 font-mono shrink-0">{slip.timestamp}</span>
                </div>

                <div className="p-2 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-700 my-2 leading-relaxed">
                  <span className="text-[9px] text-slate-500 font-bold block uppercase mb-0.5">
                    For: {slip.recipient}
                  </span>
                  {slip.notes}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 text-xs">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onDialBack(slip.callbackNumber, slip.callerName)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-600 border border-emerald-200 hover:border-emerald-600 text-emerald-700 hover:text-white text-[11px] font-bold transition-all cursor-pointer shadow-sm"
                    >
                      <PhoneCall className="h-3 w-3" />
                      <span>Call Back</span>
                    </button>
                    <button
                      onClick={() => handleCopySlip(slip)}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 text-[11px] transition-all cursor-pointer"
                    >
                      {copiedId === slip.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    {slip.status === "unread" ? (
                      <button
                        onClick={() => onUpdateStatus(slip.id, "resolved")}
                        className="text-[10px] text-slate-500 hover:text-emerald-600 transition-colors cursor-pointer font-medium"
                      >
                        Mark Resolved
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 text-[10px] text-emerald-700 font-semibold">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>{slip.status === "called_back" ? "Called Back" : "Resolved"}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Manual Slip Creation Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-5 shadow-2xl text-left">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Create Receptionist Message Slip</h3>
            
            <form onSubmit={handleSubmitManualSlip} className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Caller Name *</label>
                <input
                  type="text"
                  required
                  value={formCallerName}
                  onChange={(e) => setFormCallerName(e.target.value)}
                  placeholder="Caller name"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Company</label>
                  <input
                    type="text"
                    value={formCompany}
                    onChange={(e) => setFormCompany(e.target.value)}
                    placeholder="Company (optional)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    required
                    placeholder="Call-back number"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Recipient</label>
                  <select
                    value={formRecipient}
                    onChange={(e) => setFormRecipient(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Anyone on the team</option>
                    {team.names.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Urgency</label>
                  <select
                    value={formUrgency}
                    onChange={(e) => setFormUrgency(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">Message Notes *</label>
                <textarea
                  required
                  rows={3}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Notes regarding callback inquiry..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md cursor-pointer"
                >
                  Save Slip
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
