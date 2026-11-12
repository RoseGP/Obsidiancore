/**
 * Settings → Integrations: real connection status for the signed-in user, with links to where each is managed.
 * (Replaces an older panel that called the removed /api/social/* routes and showed simulated connections.)
 */
import React, { useEffect, useState } from 'react';
import { Bot, CalendarDays, CheckCircle2, CircleDashed, MessageCircle, Share2 } from 'lucide-react';

interface Row { id: string; label: string; detail: string; connected: boolean | null; manage: { label: string; view: string } | null; icon?: 'ai' | 'channel' }

export default function IntegrationsSettingsSection() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const get = async (url: string) => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } };
      const [social, gcal, models, service] = await Promise.all([get('/api/accounts/integrations'), get('/api/gcal/status'), get('/api/chat/models'), get('/api/dashboard/service')]);
      if (cancelled) return;
      const channels = social?.integrations ?? [];
      setRows([
        {
          id: 'social', label: 'Social media (Postiz)',
          detail: !social ? 'Status unavailable.' : social.postiz?.configured === false ? 'Postiz isn’t configured on the server.' : channels.length ? `${channels.length} account${channels.length === 1 ? '' : 's'}: ${channels.map((c: any) => c.label || c.platform).join(', ')}` : 'No accounts connected yet.',
          connected: social ? channels.length > 0 : null, manage: { label: 'Open Social Planner', view: 'social_planner' },
        },
        {
          id: 'gcal', label: 'Google Calendar',
          detail: !gcal ? 'Status unavailable.' : gcal.configured === false ? 'Google isn’t configured on the server.' : gcal.connected ? `Connected${gcal.email ? ` as ${gcal.email}` : ''}.` : 'Not connected.',
          connected: gcal ? !!gcal.connected : null, manage: { label: 'Open Calendar', view: 'calendar' },
        },
        // AI providers: configured by an administrator on the server (API keys are never shown here).
        ...(['claude', 'gemini'] as const).map((id) => {
          const p = models?.providers?.[id];
          return {
            id: `ai-${id}`, icon: 'ai' as const, label: `${id === 'claude' ? 'Anthropic Claude' : 'Google Gemini'} (AI provider)`,
            detail: !models ? 'Status unavailable.' : p?.configured ? `Configured${p.model ? ` · model ${p.model}` : ''}. Used by the AI Copilot and assistant features.` : `Not configured. An administrator adds ${id === 'claude' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'} on the server.`,
            connected: models ? !!p?.configured : null, manage: null,
          };
        }),
        // Messaging channels, as the server reports them (WhatsApp, SMS, voice, email, website chat).
        ...((service?.channels || []) as any[]).map((c) => ({
          id: `ch-${c.id}`, icon: 'channel' as const, label: c.label,
          detail: c.detail || (c.status === 'connected' ? 'Connected.' : c.status === 'not_configured' ? 'Not configured.' : 'Not available yet.'),
          connected: c.status === 'connected', manage: c.id === 'website_chat' ? { label: 'Open Inbox', view: 'messages' } : c.status === 'not_available' ? null : { label: 'Phone & messages', view: 'voice_messages' },
        })),
      ]);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3" aria-labelledby="integrations-heading">
      <h3 id="integrations-heading" className="text-sm font-bold text-[var(--text)]">Integrations</h3>
      {!rows ? <p className="text-xs text-[var(--text-muted)]" role="status">Checking connections…</p> : (
        <ul className="divide-y divide-[var(--border)]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
              {r.icon === 'ai' ? <Bot className="h-4 w-4 text-[var(--info)]" /> : r.icon === 'channel' ? <MessageCircle className="h-4 w-4 text-[var(--info)]" /> : r.id === 'gcal' ? <CalendarDays className="h-4 w-4 text-[var(--info)]" /> : <Share2 className="h-4 w-4 text-[var(--info)]" />}
              <div className="flex-1 min-w-[12rem]">
                <p className="text-sm text-[var(--text)] flex items-center gap-1.5">{r.label}
                  {r.connected ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" aria-label="connected" /> : <CircleDashed className="h-3.5 w-3.5 text-[var(--text-subtle)]" aria-label="not connected" />}
                </p>
                <p className="text-xs text-[var(--text-muted)]">{r.detail}</p>
              </div>
              {r.manage && <a href={`/#${r.manage.view}`} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] hover:bg-[var(--surface-sunken)] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">{r.manage.label}</a>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-[var(--text-subtle)]">Payments (Stripe, Square) are managed under Proposals → Payment Providers. Google Business Profile under Local SEO. Telegram and Instagram messaging aren’t supported yet.</p>
    </section>
  );
}
