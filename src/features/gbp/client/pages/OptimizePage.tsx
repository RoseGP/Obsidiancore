/** AI Local SEO optimizer: suggestions grounded in Google data; every change goes through review. */
import React, { useState } from 'react';
import { ArrowRight, Check, KeyRound, Lightbulb, ListPlus, MessageCircleQuestion, Sparkles, Swords, Tags } from 'lucide-react';
import type { ChangeSet, GLocation } from '../api';
import { useGrowth } from '../GrowthStore';
import { Alert, Badge, Button, Card, Empty, PageHeader, Skeleton, useToast } from '../ui';

interface Optimization {
  summary: string;
  keywords: { term: string; intent: string; why: string }[];
  categories: { name: string; why: string; categoryId?: string; displayName?: string }[];
  description: { before: string; after: string; notes: string[] };
  services: { name: string; description: string; why: string }[];
  attributes: { name: string; why: string }[];
  contentTopics: { topic: string; why: string }[];
  questions: string[];
  competitorInsights: string[];
  sources: { googleSearchTerms: number; competitors: number; reviews: number };
  disclaimer: string;
}

export default function OptimizePage() {
  const { api, location, dash, go } = useGrowth();
  const toast = useToast();
  const [o, setO] = useState<Optimization | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ services: string[]; categories: string[] }>({ services: [], categories: [] });
  const [prepared, setPrepared] = useState<string[]>([]);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      // Fresh Google search terms make suggestions better; failure here is fine.
      await api(`/growth/visibility?location=${encodeURIComponent(location!.name)}`).catch(() => undefined);
      setO(await api<Optimization>('/growth/optimize', { method: 'POST', json: { location: location!.name } }));
      setPicked({ services: [], categories: [] });
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const prepare = async (label: string, body: any) => {
    try {
      await api<ChangeSet>('/growth/changes', { method: 'POST', json: { location: location!.name, source: 'ai', ...body } });
      setPrepared((p) => [...p, label]);
      toast('ok', 'Prepared as a draft. Review and publish it from Business profile → Change history.');
    } catch (e: any) { toast(e.code === 'no_changes' ? 'info' : 'danger', e.message); }
  };

  const l: GLocation | null = location;
  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Local SEO optimizer" description="AI suggestions based on your profile, the search terms Google reports for you, your reviews and the competitors you’ve added. Nothing changes until you review and publish."
        actions={<Button variant="primary" icon={<Sparkles size={15} />} loading={busy} disabled={!dash?.aiConfigured} onClick={run}>{o ? 'Refresh suggestions' : 'Analyse my profile'}</Button>} />
      {!dash?.aiConfigured && <Alert tone="info" title="AI isn’t configured on the server">An administrator can set GEMINI_API_KEY to enable the optimizer. Your audit already lists rule-based improvements.</Alert>}
      {err && <Alert tone="danger" title={err} />}
      {busy && !o && <div className="space-y-3"><Skeleton h={90} /><Skeleton h={220} /></div>}
      {!o && !busy && dash?.aiConfigured && <Card><Empty icon={<Sparkles size={20} />} title="Get tailored suggestions" body="We’ll suggest search terms, categories, a clearer description, services to check, attributes and content ideas." action={<Button variant="primary" onClick={run}>Analyse my profile</Button>} /></Card>}

      {o && l && (
        <>
          <Alert tone="info" title="Summary">{o.summary}<p className="g-faint mt-1 text-[12px]">Based on {o.sources.googleSearchTerms} Google search terms, {o.sources.reviews} reviews and {o.sources.competitors} competitors. {o.disclaimer}</p></Alert>

          <Card title={<span className="flex items-center gap-2"><Lightbulb size={16} aria-hidden />Description: before and after</span>} description="Check the facts are right; you can edit it after preparing.">
            <div className="grid gap-3 md:grid-cols-2">
              <div><p className="g-faint mb-1 text-[11.5px] font-semibold uppercase tracking-wide">Now</p><div className="g-diff-before text-[13.5px]">{o.description.before || '(empty)'}</div></div>
              <div><p className="g-faint mb-1 text-[11.5px] font-semibold uppercase tracking-wide">Suggested · {o.description.after.length}/750</p><div className="g-diff-after text-[13.5px]">{o.description.after}</div></div>
            </div>
            {o.description.notes.length > 0 && <ul className="g-muted mt-3 list-disc pl-5 text-[13px]">{o.description.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            <div className="mt-3"><Button variant="primary" disabled={prepared.includes('description')} icon={prepared.includes('description') ? <Check size={15} /> : undefined} onClick={() => prepare('description', { patch: { description: o.description.after } })}>{prepared.includes('description') ? 'Prepared' : 'Prepare this change'}</Button></div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={<span className="flex items-center gap-2"><KeyRound size={16} aria-hidden />Search terms</span>} description="Use these naturally in your description, services and posts. Never add them to your business name.">
              {!o.keywords.length ? <p className="g-muted text-[13.5px]">No suggestions.</p> : (
                <ul className="space-y-2">{o.keywords.map((k) => (
                  <li key={k.term} className="rounded-lg px-3 py-2" style={{ background: 'var(--g-raised)' }}>
                    <div className="flex flex-wrap items-center gap-2"><span className="text-[13.5px] font-semibold">{k.term}</span><Badge tone="teal">{k.intent}</Badge></div>
                    <p className="g-muted text-[12.5px]">{k.why}</p>
                  </li>
                ))}</ul>
              )}
            </Card>

            <Card title={<span className="flex items-center gap-2"><Tags size={16} aria-hidden />Categories to consider</span>} description="Matched to Google’s category list. Only add ones that genuinely fit.">
              {!o.categories.length ? <p className="g-muted text-[13.5px]">No additional categories suggested.</p> : (
                <>
                  <ul className="space-y-2">{o.categories.map((c) => (
                    <li key={c.name}><label className="flex items-start gap-2.5 rounded-lg px-3 py-2" style={{ background: 'var(--g-raised)' }}>
                      <input type="checkbox" className="mt-1" disabled={!c.categoryId} checked={picked.categories.includes(c.categoryId ?? '')} onChange={(e) => setPicked((p) => ({ ...p, categories: e.target.checked ? [...p.categories, c.categoryId!] : p.categories.filter((x) => x !== c.categoryId) }))} />
                      <span><span className="block text-[13.5px] font-semibold">{c.displayName ?? c.name}{!c.categoryId && <span className="g-faint font-normal"> (not found in Google’s list)</span>}</span><span className="g-muted block text-[12.5px]">{c.why}</span></span>
                    </label></li>
                  ))}</ul>
                  <div className="mt-3"><Button disabled={!picked.categories.length || prepared.includes('categories')} onClick={() => prepare('categories', { patch: { additionalCategoryIds: [...new Set([...(l.additionalCategoryIds ?? []), ...picked.categories])] }, categoryNames: Object.fromEntries([...(l.additionalCategoryIds ?? []).map((id, i) => [id, l.additionalCategories[i] ?? id]), ...o.categories.filter((c) => c.categoryId).map((c) => [c.categoryId!, c.displayName ?? c.name])]) })}>{prepared.includes('categories') ? 'Prepared' : `Prepare ${picked.categories.length || ''} category change`}</Button></div>
                </>
              )}
            </Card>

            <Card title={<span className="flex items-center gap-2"><ListPlus size={16} aria-hidden />Services to check</span>} description="Only add services you actually offer.">
              {!o.services.length ? <p className="g-muted text-[13.5px]">No missing services spotted.</p> : (
                <>
                  <ul className="space-y-2">{o.services.map((s) => (
                    <li key={s.name}><label className="flex items-start gap-2.5 rounded-lg px-3 py-2" style={{ background: 'var(--g-raised)' }}>
                      <input type="checkbox" className="mt-1" checked={picked.services.includes(s.name)} onChange={(e) => setPicked((p) => ({ ...p, services: e.target.checked ? [...p.services, s.name] : p.services.filter((x) => x !== s.name) }))} />
                      <span><span className="block text-[13.5px] font-semibold">{s.name}</span><span className="block text-[12.5px]">{s.description}</span><span className="g-muted block text-[12px]">{s.why}</span></span>
                    </label></li>
                  ))}</ul>
                  <div className="mt-3"><Button disabled={!picked.services.length || !l.primaryCategoryId || prepared.includes('services')} onClick={() => prepare('services', { patch: { serviceItems: [...(l.serviceItems ?? []).map((s) => ({ label: s.label, ...(s.description ? { description: s.description } : {}), category: s.category ?? l.primaryCategoryId })), ...o.services.filter((s) => picked.services.includes(s.name)).map((s) => ({ label: s.name, description: s.description, category: l.primaryCategoryId }))] } })}>{prepared.includes('services') ? 'Prepared' : `Prepare ${picked.services.length || ''} new service${picked.services.length === 1 ? '' : 's'}`}</Button></div>
                </>
              )}
            </Card>

            <Card title="Attributes worth setting" description="Set these in Business profile → Attributes if they’re true.">
              {!o.attributes.length ? <p className="g-muted text-[13.5px]">None suggested.</p> : <ul className="space-y-1.5 text-[13.5px]">{o.attributes.map((a) => <li key={a.name}><strong>{a.name}</strong> <span className="g-muted">— {a.why}</span></li>)}</ul>}
              <div className="mt-3"><Button size="sm" onClick={() => go('profile', { focus: 'edit_attributes' })}>Open attributes<ArrowRight size={13} aria-hidden /></Button></div>
            </Card>

            <Card title="Content ideas" description="Topics for Google posts.">
              <ul className="space-y-1.5 text-[13.5px]">{o.contentTopics.map((t) => <li key={t.topic}><strong>{t.topic}</strong> <span className="g-muted">— {t.why}</span></li>)}</ul>
              <div className="mt-3"><Button size="sm" onClick={() => go('posts')}>Plan posts<ArrowRight size={13} aria-hidden /></Button></div>
            </Card>

            <Card title={<span className="flex items-center gap-2"><MessageCircleQuestion size={16} aria-hidden />Questions customers ask</span>} description="Answer these in your description, services or posts.">
              <ul className="list-disc space-y-1 pl-5 text-[13.5px]">{o.questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </Card>
          </div>

          {o.competitorInsights.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><Swords size={16} aria-hidden />Competitor positioning</span>} description="From the competitors you added.">
              <ul className="list-disc space-y-1 pl-5 text-[13.5px]">{o.competitorInsights.map((c) => <li key={c}>{c}</li>)}</ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
