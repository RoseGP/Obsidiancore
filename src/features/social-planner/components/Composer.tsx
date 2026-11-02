import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Image, Link2, Loader2, Plus, Send, Upload, X, Zap } from 'lucide-react';
import { fromLocalInput, toLocalInput } from '../domain/calendar';
import { ALL_PLATFORMS, PLATFORMS, PRIMARY_PLATFORMS, type PlannerPost, type PlatformId } from '../domain/model';
import { hasErrors, validatePost, type PostDraft } from '../domain/validation';
import { usePlanner } from '../state/PlannerStore';
import { Banner, Button, Dialog, PlatformGlyph, useToast } from '../ui/kit';

const shownErrors_media = (attempt: string | null, r: { errors: { mediaUrls?: string } }) => !!attempt && !!r.errors.mediaUrls;

export interface ComposerTarget { mode: 'create'; scheduledAt: string; initialPlatforms?: PlatformId[] } // ISO
export type ComposerOpen = ComposerTarget | { mode: 'edit'; post: PlannerPost };

export function Composer({ open, target, defaultPlatforms, onClose }: {
  open: boolean; target: ComposerOpen | null; defaultPlatforms: PlatformId[]; onClose: () => void;
}) {
  const { create, update, remove, accounts, isBusy } = usePlanner();
  const toast = useToast();
  const ids = { content: useId(), when: useId(), media: useId() };
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initial = useMemo<PostDraft>(() => {
    if (target?.mode === 'edit') {
      const p = target.post;
      return { content: p.content, platforms: p.platforms, scheduledAt: p.scheduledAt, mediaUrls: p.mediaUrls, intent: p.status === 'draft' ? 'draft' : 'scheduled' };
    }
    return { content: '', platforms: (target && 'initialPlatforms' in target && target.initialPlatforms?.length) ? target.initialPlatforms : defaultPlatforms, scheduledAt: target?.scheduledAt ?? null, mediaUrls: [], intent: 'scheduled' };
  }, [target, defaultPlatforms]);

  const [draft, setDraft] = useState<PostDraft>(initial);
  const [mediaInput, setMediaInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [attempt, setAttempt] = useState<'draft' | 'scheduled' | null>(null);
  const [serverError, setServerError] = useState('');
  const [saving, setSaving] = useState<'draft' | 'scheduled' | 'delete' | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(initial); setMediaInput(''); setAttempt(null); setServerError(''); setSaving(null); setConfirmDiscard(false);
    setShowMore(initial.platforms.some((p) => !PRIMARY_PLATFORMS.includes(p)));
  }, [open, initial]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || mediaInput.trim() !== '';
  const now = new Date();
  const result = validatePost({ ...draft, intent: attempt ?? 'draft' }, { now, accounts });
  const warnings = Array.from(new Set([
    ...validatePost({ ...draft, intent: 'draft' }, { now, accounts }).warnings,
    ...validatePost({ ...draft, intent: 'scheduled' }, { now, accounts }).warnings,
  ]));
  if (shownErrors_media(attempt, result)) warnings.splice(0, warnings.length, ...warnings.filter((w) => !w.includes('image or video')));
  const shownErrors = attempt ? result.errors : {};
  const connected = new Set(accounts?.map((a) => a.platform) ?? []);
  const editing = target?.mode === 'edit' ? target.post : null;
  const busy = saving !== null || (editing ? isBusy(editing.id) : false);

  const set = <K extends keyof PostDraft>(k: K, v: PostDraft[K]) => { setDraft((d) => ({ ...d, [k]: v })); setServerError(''); };
  const togglePlatform = (p: PlatformId) => set('platforms', draft.platforms.includes(p) ? draft.platforms.filter((x) => x !== p) : [...draft.platforms, p]);
  const addMedia = () => {
    const url = mediaInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { setServerError('Media links must start with http:// or https://'); return; }
    if (!draft.mediaUrls.includes(url)) set('mediaUrls', [...draft.mediaUrls, url].slice(0, 10));
    setMediaInput('');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setServerError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/posts/upload', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to upload media file.');
      }
      const data = await res.json();
      const path = data.media?.path || data.media?.url;
      if (path) {
        set('mediaUrls', [...draft.mediaUrls, path].slice(0, 10));
      }
    } catch (err: any) {
      setServerError(err?.message || 'Media upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const requestClose = () => { if (busy) return; if (dirty) setConfirmDiscard(true); else onClose(); };

  const submit = async (intent: 'draft' | 'scheduled') => {
    setAttempt(intent);
    const r = validatePost({ ...draft, intent }, { now: new Date(), accounts });
    if (hasErrors(r) || busy) return;
    setSaving(intent);
    try {
      const payload = { content: draft.content.trim(), platforms: draft.platforms, scheduledAt: draft.scheduledAt!, mediaUrls: draft.mediaUrls, intent };
      if (editing) await update(editing.id, { ...payload, platforms: [...payload.platforms, ...editing.otherPlatforms] });
      else await create(payload);
      toast({
        tone: 'success',
        title: intent === 'draft' ? 'Draft saved' : editing ? 'Post updated' : 'Post scheduled',
        body: intent === 'draft' ? 'It won’t publish until you schedule it.' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(draft.scheduledAt!)),
      });
      onClose();
    } catch (err: any) {
      if (err?.code !== 'busy') setServerError(err?.message || 'The post couldn’t be saved. Try again.');
    } finally {
      setSaving(null);
    }
  };

  const doDelete = async () => {
    if (!editing) return;
    setSaving('delete');
    try {
      await remove(editing.id);
      toast({ tone: 'success', title: 'Post deleted' });
      onClose();
    } catch (err: any) {
      if (err?.code !== 'busy') setServerError(err?.message || 'The post couldn’t be deleted.');
    } finally { setSaving(null); }
  };

  const text = draft.content.trim();
  const visiblePlatforms = showMore ? ALL_PLATFORMS : PRIMARY_PLATFORMS;

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      busy={busy}
      width={640}
      title={editing ? 'Edit post' : 'New post'}
      description={editing?.status === 'failed' ? 'Saving moves this post back into the publishing queue.' : undefined}
      footer={confirmDiscard ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-[13.5px]">Discard your changes?</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)} data-autofocus>Keep editing</Button>
            <Button variant="danger" onClick={onClose}>Discard</Button>
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-wrap items-center gap-2">
          {editing && <Button variant="danger" onClick={doDelete} loading={saving === 'delete'} disabled={busy}>Delete</Button>}
          <div className="flex-1" />
          <Button variant="secondary" onClick={() => submit('draft')} loading={saving === 'draft'} disabled={busy}>Save as draft</Button>
          {!editing && (
            <Button
              variant="secondary"
              icon={<Zap size={14} />}
              onClick={() => {
                const nowAhead = new Date(Date.now() + 60_000).toISOString();
                set('scheduledAt', nowAhead);
                setTimeout(() => submit('scheduled'), 50);
              }}
              loading={saving === 'scheduled'}
              disabled={busy}
              title="Publish immediately to Postiz channels"
            >
              Publish now
            </Button>
          )}
          <Button variant="primary" icon={<Send size={15} />} onClick={() => submit('scheduled')} loading={saving === 'scheduled'} disabled={busy}>
            {editing && editing.status !== 'draft' ? 'Update schedule' : 'Schedule post'}
          </Button>
        </div>
      )}
    >
      <form className="space-y-5" noValidate onSubmit={(e) => { e.preventDefault(); void submit('scheduled'); }}>
        {serverError && <Banner tone="danger">{serverError}</Banner>}

        <fieldset>
          <legend className="sp-label">Platforms</legend>
          <div className="flex flex-wrap gap-2">
            {visiblePlatforms.map((p) => {
              const on = draft.platforms.includes(p);
              return (
                <button key={p} type="button" className="sp-pill" aria-pressed={on} onClick={() => togglePlatform(p)}
                  title={accounts && !connected.has(p) ? `${PLATFORMS[p].label}: no connected account` : PLATFORMS[p].label}>
                  <PlatformGlyph id={p} size={14} color={on ? '#fff' : PLATFORMS[p].dot} />
                  {PLATFORMS[p].label}
                  {accounts && <span className="h-1.5 w-1.5 rounded-full" style={{ background: connected.has(p) ? 'var(--sp-success)' : '#5c5e6c' }} aria-label={connected.has(p) ? 'connected' : 'not connected'} />}
                </button>
              );
            })}
            {!showMore && <button type="button" className="sp-pill" onClick={() => setShowMore(true)}><Plus size={14} /> More</button>}
          </div>
          {shownErrors.platforms && <p className="sp-error" role="alert">{shownErrors.platforms}</p>}
        </fieldset>

        <div>
          <label htmlFor={ids.content} className="sp-label">Post text</label>
          <textarea id={ids.content} className="sp-input" value={draft.content} onChange={(e) => set('content', e.target.value)}
            placeholder="What do you want to share?" aria-invalid={!!shownErrors.content} aria-describedby={`${ids.content}-c`} data-autofocus maxLength={63206} />
          <div id={`${ids.content}-c`} className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] num">
            {draft.platforms.length === 0 && <span className="sp-faint">{text.length.toLocaleString()} characters</span>}
            {draft.platforms.map((p) => {
              const over = text.length > PLATFORMS[p].charLimit;
              return <span key={p} style={{ color: over ? '#fca5a5' : 'var(--sp-faint)' }}>{PLATFORMS[p].label} {text.length.toLocaleString()}/{PLATFORMS[p].charLimit.toLocaleString()}</span>;
            })}
          </div>
          {shownErrors.content && <p className="sp-error" role="alert">{shownErrors.content}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={ids.when} className="sp-label">Date and time</label>
            <input id={ids.when} type="datetime-local" className="sp-input" value={draft.scheduledAt ? toLocalInput(draft.scheduledAt) : ''}
              onChange={(e) => set('scheduledAt', fromLocalInput(e.target.value))} aria-invalid={!!shownErrors.scheduledAt} />
            {shownErrors.scheduledAt ? <p className="sp-error" role="alert">{shownErrors.scheduledAt}</p>
              : <p className="sp-hint">{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={ids.media} className="sp-label m-0">Media</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4"
                className="hidden"
                onChange={handleFileUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-[11.5px] font-medium text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
              >
                {uploading ? <Loader2 size={13} className="sp-spin" /> : <Upload size={13} />}
                <span>{uploading ? 'Uploading…' : 'Upload file'}</span>
              </button>
            </div>
            <div className="flex gap-2">
              <input id={ids.media} className="sp-input" type="url" inputMode="url" placeholder="https://… or upload file" value={mediaInput}
                onChange={(e) => setMediaInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMedia(); } }} />
              <Button variant="secondary" onClick={addMedia} disabled={!mediaInput.trim()} aria-label="Add media link"><Plus size={15} /></Button>
            </div>
            {shownErrors.mediaUrls && <p className="sp-error" role="alert">{shownErrors.mediaUrls}</p>}
          </div>
        </div>

        {draft.mediaUrls.length > 0 && (
          <ul className="space-y-1.5">
            {draft.mediaUrls.map((u) => {
              const isImg = /\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(u) || u.includes('image') || u.includes('uploads');
              return (
                <li key={u} className="flex items-center gap-2.5 rounded-lg p-2 text-[12.5px]" style={{ background: 'var(--sp-surface-2)' }}>
                  {isImg ? (
                    <img src={u} alt="Media thumbnail" className="h-9 w-9 object-cover rounded flex-none bg-neutral-900" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                  ) : (
                    <Link2 size={14} className="sp-faint flex-none" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{u}</span>
                  <button type="button" className="sp-btn sp-icon-btn sm" aria-label={`Remove ${u}`} onClick={() => set('mediaUrls', draft.mediaUrls.filter((x) => x !== u))}><X size={14} /></button>
                </li>
              );
            })}
          </ul>
        )}

        {warnings.length > 0 && (
          <Banner tone="warning">
            <ul className="space-y-1">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </Banner>
        )}
      </form>
    </Dialog>
  );
}
