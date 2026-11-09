/**
 * Activity on the organization's connected numbers: SMS and WhatsApp messages and voicemails, from
 * /api/communication/inbound-messages. Shows only what was actually received; empty until a number is connected.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart2, MessageSquare, Voicemail, RefreshCw, Phone, Plus, Trash2, AlertCircle } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

interface InboundMessage { id: string; channel: "SMS" | "WHATSAPP"; from: string; contactName?: string; body: string; at: string }
interface VoicemailItem { id: string; from: string; recordingUrl: string; durationSeconds: number; at: string }
interface InboundRoute { id: string; kind: "phone" | "whatsapp"; number: string }

const day = (iso: string) => iso.slice(0, 10);
const when = (iso: string) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

export default function CallMonitoringDashboard() {
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [voicemails, setVoicemails] = useState<VoicemailItem[]>([]);
  const [routes, setRoutes] = useState<InboundRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: "phone" | "whatsapp"; number: string }>({ kind: "phone", number: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [m, r] = await Promise.all([fetch("/api/communication/inbound-messages"), fetch("/api/communication/inbound-routes")]);
      const md = await m.json().catch(() => ({})); const rd = await r.json().catch(() => ({}));
      if (!m.ok) throw new Error(md.error || `Couldn't load activity (${m.status}).`);
      setMessages(md.messages || []); setVoicemails(md.voicemails || []); setRoutes(r.ok ? rd.routes || [] : []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addRoute = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setError(null);
    try {
      const res = await fetch("/api/communication/inbound-routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Couldn't connect the number (${res.status}).`);
      setForm({ ...form, number: "" }); await load();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };
  const removeRoute = async (id: string) => {
    const res = await fetch(`/api/communication/inbound-routes/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || "Couldn't remove the number."); }
    await load();
  };

  // Last 7 days, counted from the received items.
  const chart = useMemo(() => {
    const days: { day: string; messages: number; voicemails: number }[] = [];
    for (let i = 6; i >= 0; i--) days.push({ day: day(new Date(Date.now() - i * 86400000).toISOString()), messages: 0, voicemails: 0 });
    for (const m of messages) { const d = days.find((x) => x.day === day(m.at)); if (d) d.messages++; }
    for (const v of voicemails) { const d = days.find((x) => x.day === day(v.at)); if (d) d.voicemails++; }
    return days.map((d) => ({ ...d, label: d.day.slice(5) }));
  }, [messages, voicemails]);
  const today = day(new Date().toISOString());
  const todayCount = messages.filter((m) => day(m.at) === today).length + voicemails.filter((v) => day(v.at) === today).length;

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm text-left space-y-5" id="call-monitoring-dashboard">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600 shadow-sm">
            <BarChart2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">Inbound activity</h3>
            <p className="text-xs text-slate-500">SMS, WhatsApp and voicemails received on your connected numbers</p>
          </div>
        </div>
        <button type="button" onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && <p role="alert" className="flex items-center gap-2 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 text-xs"><AlertCircle className="h-4 w-4" />{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: "Received today", value: todayCount, icon: <Phone className="h-4 w-4" /> },
          { label: "Messages (latest 200)", value: messages.length, icon: <MessageSquare className="h-4 w-4" /> },
          { label: "Voicemails (latest 200)", value: voicemails.length, icon: <Voicemail className="h-4 w-4" /> },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">{k.icon}{k.label}</div>
            <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">{loading ? "…" : k.value}</div>
          </div>
        ))}
      </div>

      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#64748b" }} />
            <Tooltip />
            <Bar dataKey="messages" name="Messages" fill="#2563eb" radius={[4, 4, 0, 0]} />
            <Bar dataKey="voicemails" name="Voicemails" fill="#7c3aed" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="space-y-2">
          <h4 className="text-xs font-bold text-slate-800">Latest messages</h4>
          {messages.length === 0 ? (
            <p className="text-xs text-slate-500 rounded-2xl border border-dashed border-slate-200 p-3">{loading ? "Loading…" : "Nothing received yet."}</p>
          ) : messages.slice(0, 20).map((m) => (
            <div key={m.id} className="rounded-2xl border border-slate-200 p-3 text-xs">
              <div className="flex justify-between gap-2 text-slate-500"><span className="font-semibold text-slate-800">{m.contactName || m.from} · {m.channel === "WHATSAPP" ? "WhatsApp" : "SMS"}</span><span>{when(m.at)}</span></div>
              <p className="mt-1 text-slate-700 whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          ))}
        </section>
        <section className="space-y-2">
          <h4 className="text-xs font-bold text-slate-800">Latest voicemails</h4>
          {voicemails.length === 0 ? (
            <p className="text-xs text-slate-500 rounded-2xl border border-dashed border-slate-200 p-3">{loading ? "Loading…" : "No voicemails yet."}</p>
          ) : voicemails.slice(0, 20).map((v) => (
            <div key={v.id} className="rounded-2xl border border-slate-200 p-3 text-xs flex items-center justify-between gap-2">
              <span><span className="font-semibold text-slate-800">{v.from || "Unknown caller"}</span> · {v.durationSeconds}s · {when(v.at)}</span>
              <a href={v.recordingUrl} target="_blank" rel="noreferrer" className="text-blue-600 font-semibold hover:underline">Open recording</a>
            </div>
          ))}
        </section>
      </div>

      <section className="space-y-2 border-t border-slate-100 pt-4">
        <h4 className="text-xs font-bold text-slate-800">Connected numbers</h4>
        <p className="text-[11px] text-slate-500">Point your Twilio number's SMS and voice webhooks (or your WhatsApp Business webhook) at this server, then add the number here so its messages reach this workspace. Admins only.</p>
        {routes.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-2xl border border-slate-200 px-3 py-2 text-xs">
            <span><span className="font-semibold">{r.kind === "whatsapp" ? "WhatsApp ID" : "Phone"}</span> {r.number}</span>
            <button type="button" onClick={() => removeRoute(r.id)} className="text-rose-600 hover:text-rose-700 cursor-pointer" aria-label={`Remove ${r.number}`}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <form onSubmit={addRoute} className="flex flex-wrap items-center gap-2">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as any })} className="rounded-xl border border-slate-200 px-2 py-1.5 text-xs bg-white">
            <option value="phone">Phone (SMS + calls)</option>
            <option value="whatsapp">WhatsApp phone number ID</option>
          </select>
          <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder={form.kind === "phone" ? "+15551234567" : "WhatsApp phone number ID"} className="flex-1 min-w-[160px] rounded-xl border border-slate-200 px-3 py-1.5 text-xs" />
          <button type="submit" disabled={saving || !form.number.trim()} className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Connect</button>
        </form>
      </section>
    </div>
  );
}
