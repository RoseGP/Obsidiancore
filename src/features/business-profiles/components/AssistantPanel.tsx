/**
 * AI assistant: drafts a description or service descriptions from the profile's own facts.
 * Suggestions are never saved automatically: the user edits them here, then “Use in profile”
 * copies them into the edit form, where they must still be saved explicitly.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Sparkles, Trash2, Wand2 } from 'lucide-react';
import type { ServiceItem, Suggestion, SuggestionKind } from '../domain/types';
import { LIMITS } from '../domain/validation';
import { bpApi } from '../client/api';
import { Badge, Button, Card, EmptyState, Field, Notice, ProvenanceBadge, inputCls, timeAgo, useToast } from './ui';

export function AssistantPanel({ profileId, version, aiConfigured, canEdit, pending, hasServices, onApply, onChanged }: {
  profileId: string; version: number; aiConfigured: boolean; canEdit: boolean; pending: Suggestion[]; hasServices: boolean;
  onApply: (s: Suggestion, edited: { text?: string; services?: ServiceItem[] }) => void; onChanged: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<SuggestionKind>('description');
  const [tone, setTone] = useState('professional');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true); setError(null);
    try { await bpApi.suggest(profileId, kind, tone, notes.trim()); onChanged(); toast('Suggestion ready for review.', 'info'); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!aiConfigured) return (
    <Card><EmptyState icon={<Sparkles className="h-5 w-5" />} title="AI suggestions aren’t configured">
      An administrator can enable them by setting <code>GEMINI_API_KEY</code> on the server. Audits, editing and publishing work without AI.
    </EmptyState></Card>
  );

  return (
    <div className="space-y-4">
      <Notice tone="info" title="How suggestions work">
        The assistant only uses facts already on this profile (name, categories, services, service area, attributes) plus any notes you add.
        Phone, email, website and street address are not sent. Every suggestion is checked for invented numbers or names, links, promotional
        wording and ranking claims, and nothing is saved until you review it and save the profile.
      </Notice>
      {canEdit ? (
        <Card className="p-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="What to draft" htmlFor="ai-kind">
              <select id="ai-kind" className={inputCls()} value={kind} onChange={(e) => setKind(e.target.value as SuggestionKind)}>
                <option value="description">Business description</option>
                <option value="services" disabled={!hasServices}>Service descriptions{hasServices ? '' : ' (add services first)'}</option>
              </select>
            </Field>
            <Field label="Tone" htmlFor="ai-tone">
              <select id="ai-tone" className={inputCls()} value={tone} onChange={(e) => setTone(e.target.value)}>
                <option value="professional">Professional</option><option value="friendly">Friendly</option><option value="concise">Concise</option>
              </select>
            </Field>
          </div>
          <Field label="Extra facts (optional)" htmlFor="ai-notes" hint={`Only true facts, e.g. “family-owned since 2009, Spanish spoken”. ${notes.length}/600`}>
            <textarea id="ai-notes" rows={2} maxLength={600} className={inputCls()} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button variant="primary" icon={<Wand2 className="h-4 w-4" />} loading={busy} onClick={generate}>Generate suggestion</Button>
        </Card>
      ) : <Notice tone="warning">Your role can view suggestions but not request or apply them.</Notice>}

      {pending.length === 0 ? <p className="text-[13px] text-[var(--text-muted)] px-1">No suggestions waiting for review.</p>
        : pending.map((s) => <SuggestionCard key={s.id} s={s} profileId={profileId} version={version} canEdit={canEdit} onApply={onApply} onChanged={onChanged} />)}
    </div>
  );
}

function SuggestionCard({ s, profileId, version, canEdit, onApply, onChanged }: { s: Suggestion; profileId: string; version: number; canEdit: boolean; onApply: (s: Suggestion, e: { text?: string; services?: ServiceItem[] }) => void; onChanged: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(s.text ?? '');
  const [services, setServices] = useState<ServiceItem[]>(s.services ?? []);
  useEffect(() => { setText(s.text ?? ''); setServices(s.services ?? []); }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dismiss = async () => { try { await bpApi.dismiss(profileId, s.id); onChanged(); } catch (e: any) { toast(e.message, 'danger'); } };
  return (
    <Card className="p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge source="ai" />
        <Badge>{s.kind === 'description' ? 'Description' : 'Service descriptions'}</Badge>
        <span className="text-[12px] text-[var(--text-subtle)]">Generated {timeAgo(s.createdAt)} by {s.createdBy}</span>
        {s.basedOnVersion !== version && <Badge tone="warning">Profile changed since</Badge>}
      </div>
      {s.flags.length > 0 && (
        <div className="rounded-[var(--radius-control)] bg-[var(--warning-soft)] p-3 text-[13px]">
          <div className="flex items-center gap-1.5 font-medium text-[var(--text)]"><AlertTriangle className="h-4 w-4 text-[var(--warning)]" /> Check before using</div>
          <ul className="list-disc pl-5 mt-1 text-[var(--text-muted)] space-y-0.5">{s.flags.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
      {s.kind === 'description' ? (
        <Field label="Edit the suggestion" htmlFor={`sg-${s.id}`} hint={`${text.length}/${LIMITS.description} characters`}>
          <textarea id={`sg-${s.id}`} rows={6} maxLength={LIMITS.description} className={inputCls()} value={text} onChange={(e) => setText(e.target.value)} disabled={!canEdit} />
        </Field>
      ) : (
        <div className="space-y-2">
          {services.map((x, i) => (
            <Field key={x.name} label={x.name} htmlFor={`sg-${s.id}-${i}`}>
              <input id={`sg-${s.id}-${i}`} className={inputCls()} maxLength={LIMITS.serviceDescription} value={x.description ?? ''} disabled={!canEdit} onChange={(e) => setServices(services.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
            </Field>
          ))}
        </div>
      )}
      {s.factsUsed.length > 0 && <p className="text-[12px] text-[var(--text-subtle)]">Facts the model says it used: {s.factsUsed.join(' · ')}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => onApply(s, s.kind === 'description' ? { text } : { services })} disabled={s.kind === 'description' && !text.trim()}>Use in profile (review & save)</Button>
          <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={dismiss}>Dismiss</Button>
        </div>
      )}
    </Card>
  );
}
