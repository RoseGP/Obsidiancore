/** Change history (who changed what, from which source). Access is managed in Settings › Team Management. */
import React, { useState } from 'react';
import { Bot, History } from 'lucide-react';
import type { ChangeEntry } from '../domain/types';
import { FIELD_LABELS } from '../domain/diff';
import { Badge, Button, Card, EmptyState, timeAgo } from './ui';

const SOURCE: Record<ChangeEntry['source'], string> = { manual: 'Manual edit', ai_suggestion: 'Reviewed AI suggestion', import: 'Imported', review: 'Review', system: 'System' };

export function HistoryPanel({ changes }: { changes: ChangeEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!changes.length) return <Card><EmptyState icon={<History className="h-5 w-5" />} title="No changes yet" /></Card>;
  return (
    <Card className="p-5">
      <h3 className="text-[15px] font-semibold text-[var(--text)] mb-2">Change history</h3>
      <ol className="divide-y divide-[var(--border)]">
        {changes.map((c) => (
          <li key={c.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-[var(--text-muted)] w-28">{timeAgo(c.at)}</span>
              <Badge tone={c.source === 'ai_suggestion' ? 'accent' : 'neutral'}>{c.source === 'ai_suggestion' && <Bot className="h-3 w-3" />}{SOURCE[c.source]}</Badge>
              <span className="flex-1 min-w-[200px] text-[var(--text)]">{c.summary}</span>
              <span className="text-[var(--text-subtle)]">{c.by} · v{c.version}</span>
              {c.fields?.length ? <Button size="sm" variant="ghost" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>{open === c.id ? 'Hide' : 'Details'}</Button> : null}
            </div>
            {open === c.id && c.fields && (
              <table className="mt-2 w-full text-[12px]">
                <thead className="text-[var(--text-subtle)] text-left"><tr><th className="py-1 pr-3 font-medium">Field</th><th className="py-1 pr-3 font-medium">Before</th><th className="py-1 font-medium">After</th></tr></thead>
                <tbody>{c.fields.map((f) => (
                  <tr key={f.field} className="align-top border-t border-[var(--border)]">
                    <td className="py-1.5 pr-3 text-[var(--text)] whitespace-nowrap">{FIELD_LABELS[f.field] ?? f.field}</td>
                    <td className="py-1.5 pr-3 text-[var(--text-muted)] break-words">{f.before}</td>
                    <td className="py-1.5 text-[var(--text)] break-words">{f.after}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}
