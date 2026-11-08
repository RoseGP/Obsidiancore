/**
 * Settings → Integrations: real connection status for the signed-in user, with links to where each is managed.
 * (Replaces an older panel that called the removed /api/social/* routes and showed simulated connections.)
 */
import React, { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, CircleDashed, Share2 } from 'lucide-react';

interface Row { id: string; label: string; detail: string; connected: boolean | null; manage: { label: string; view: string } }

export default function IntegrationsSettingsSection() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const get = async (url: string) => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } };
      const [social, gcal] = await Promise.all([get('/api/accounts/integrations'), get('/api/gcal/status')]);
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
      ]);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="rounded-xl border border-white/5 bg-neutral-900/20 p-5 space-y-3" aria-labelledby="integrations-heading">
      <h3 id="integrations-heading" className="text-sm font-bold text-white">Integrations</h3>
      {!rows ? <p className="text-xs text-neutral-400" role="status">Checking connections…</p> : (
        <ul className="divide-y divide-white/5">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
              {r.id === 'gcal' ? <CalendarDays className="h-4 w-4 text-sky-400" /> : <Share2 className="h-4 w-4 text-sky-400" />}
              <div className="flex-1 min-w-[12rem]">
                <p className="text-sm text-white flex items-center gap-1.5">{r.label}
                  {r.connected ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-label="connected" /> : <CircleDashed className="h-3.5 w-3.5 text-neutral-500" aria-label="not connected" />}
                </p>
                <p className="text-xs text-neutral-400">{r.detail}</p>
              </div>
              <a href={`/?view=${r.manage.view}`} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400">{r.manage.label}</a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-neutral-500">Payments (Stripe, Square) are managed under Proposals → Payment Providers. Google Business Profile under Local GBP.</p>
    </section>
  );
}
