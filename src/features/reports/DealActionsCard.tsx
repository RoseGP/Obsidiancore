/**
 * Next best actions for one deal, shown in the Sales Pipeline deal drawer (always-dark panel).
 * Data: GET /api/reports/deal-actions?dealId=. Hidden for roles that can't view reports.
 */
import React, { useEffect, useState } from 'react';
import { Lightbulb } from 'lucide-react';

interface Action { type: string; label: string; reason: string; urgency: number }
interface Row { dealId: string; probability: number; expectedValue: number; priority: number; actions: Action[] }

export default function DealActionsCard({ dealId }: { dealId: string }) {
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error' | 'hidden'; row?: Row | null }>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    fetch(`/api/reports/deal-actions?dealId=${encodeURIComponent(dealId)}`)
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) return alive && setState({ status: 'hidden' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) throw new Error('failed');
        if (alive) setState({ status: 'ok', row: (d.deals || []).find((x: Row) => x.dealId === dealId) || null });
      })
      .catch(() => alive && setState({ status: 'error' }));
    return () => { alive = false; };
  }, [dealId]);

  if (state.status === 'hidden') return null;
  return (
    <section aria-label="Next best actions" className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-4 space-y-2">
      <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]"><Lightbulb className="h-3.5 w-3.5 text-[var(--warning)]" aria-hidden="true" />Next best actions</h4>
      {state.status === 'loading' && <p className="text-[11px] text-[var(--text-muted)]">Checking this deal…</p>}
      {state.status === 'error' && <p className="text-[11px] text-[var(--danger)]">Couldn’t load the suggested actions.</p>}
      {state.status === 'ok' && !state.row && <p className="text-[11px] text-[var(--text-muted)]">Nothing to flag: the close date, follow-ups and stage age all look fine.</p>}
      {state.status === 'ok' && state.row && (
        <>
          <ul className="space-y-1.5">
            {state.row.actions.map((a) => (
              <li key={a.type} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
                <p className="text-[12px] font-semibold text-[var(--text)]">{a.label}</p>
                <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">{a.reason}</p>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-[var(--text-subtle)]">Ranked by expected value (${Math.round(state.row.expectedValue).toLocaleString('en-US')} = {Math.round(state.row.probability * 100)}% × value) × urgency. See Reports for how this is calculated.</p>
        </>
      )}
    </section>
  );
}
