/** Edit form for the core business information. Validates with the same zod schema as the server. */
import React, { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { DAYS, type BusinessProfileData, type Day, type MediaItem } from '../domain/types';
import { LIMITS, profileDataSchema } from '../domain/validation';
import { hasEmail, hasPhone, hasUrl, promotionalPhrases, repeatedTerms } from '../domain/audit';
import { Button, Card, Field, inputCls, cx } from './ui';

export type FieldErrors = Record<string, string>;

/** Client-side validation: returns errors keyed by dotted path (same messages as the API). */
export function validate(d: BusinessProfileData): FieldErrors {
  const r = profileDataSchema.safeParse(d);
  if (r.success) return {};
  const out: FieldErrors = {};
  for (const i of r.error.issues) { const k = i.path.join('.') || 'form'; if (!out[k]) out[k] = i.message; }
  return out;
}

function ChipInput({ id, values, onChange, placeholder, max, disabled, maxLen = 120 }: { id: string; values: string[]; onChange: (v: string[]) => void; placeholder: string; max: number; disabled?: boolean; maxLen?: number }) {
  const [draft, setDraft] = useState('');
  const add = () => { const v = draft.trim(); if (!v || values.length >= max || values.some((x) => x.toLowerCase() === v.toLowerCase())) return; onChange([...values, v.slice(0, maxLen)]); setDraft(''); };
  return (
    <div className={cx(inputCls(), 'flex flex-wrap items-center gap-1.5 py-1.5')}>
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[13px]">
          {v}{!disabled && <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-[var(--text-subtle)] hover:text-[var(--danger)]"><X className="h-3 w-3" /></button>}
        </span>
      ))}
      {!disabled && values.length < max && (
        <input id={id} value={draft} maxLength={maxLen} onChange={(e) => setDraft(e.target.value)} onBlur={add}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1)); }}
          placeholder={values.length ? '' : placeholder} className="flex-1 min-w-[140px] bg-transparent outline-none text-sm" />
      )}
    </div>
  );
}

const Section = ({ id, title, description, children }: { id?: string; title: string; description?: string; children: React.ReactNode }) => (
  <Card className="p-5 scroll-mt-24" id={id} tabIndex={id ? -1 : undefined}>
    <h3 className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
    {description && <p className="text-[13px] text-[var(--text-muted)] mt-0.5 mb-4">{description}</p>}
    <div className={cx('space-y-4', !description && 'mt-4')}>{children}</div>
  </Card>
);

const dayLabel = (d: Day) => d[0] + d.slice(1).toLowerCase();

export function ProfileForm({ value, onChange, errors, readOnly }: { value: BusinessProfileData; onChange: (d: BusinessProfileData) => void; errors: FieldErrors; readOnly?: boolean }) {
  const d = value;
  const set = <K extends keyof BusinessProfileData>(k: K, v: BusinessProfileData[K]) => onChange({ ...d, [k]: v });
  const err = (k: string) => errors[k] ?? Object.entries(errors).find(([p]) => p.startsWith(`${k}.`))?.[1];
  const ro = !!readOnly;

  const descChecks = useMemo(() => {
    const t = d.description; const out: string[] = [];
    if (hasUrl(t) || hasEmail(t) || hasPhone(t)) out.push('Contains a link, email or phone number (not allowed in Google descriptions).');
    const promo = promotionalPhrases(t); if (promo.length) out.push(`Promotional wording: ${promo.join(', ')}.`);
    const rep = repeatedTerms(t); if (rep.length) out.push(`Repeated keywords: ${rep.join(', ')}.`);
    return out;
  }, [d.description]);

  const setDay = (day: Day, v: BusinessProfileData['hours'][Day] | undefined) => { const h = { ...d.hours }; if (v) h[day] = v; else delete h[day]; set('hours', h); };
  const copyMonday = () => { const m = d.hours.MONDAY; if (!m) return; const h = { ...d.hours }; for (const day of ['TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as Day[]) h[day] = { closed: m.closed, periods: m.periods.map((p) => ({ ...p })) }; set('hours', h); };

  return (
    <fieldset disabled={ro} className="space-y-4 min-w-0">
      <Section title="Basics" description="Use the business’s real-world name, exactly as on signage. Keywords or locations added to the name can get a listing suspended.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Business name *" htmlFor="bp-name" error={err('name')}>
            <input id="bp-name" className={inputCls(!!err('name'))} value={d.name} maxLength={LIMITS.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Legal / registered name" htmlFor="bp-legal" hint="Optional. Helps explain names that include a city or category." error={err('legalName')}>
            <input id="bp-legal" className={inputCls(!!err('legalName'))} value={d.legalName ?? ''} maxLength={LIMITS.name} onChange={(e) => set('legalName', e.target.value || undefined)} />
          </Field>
          <Field label="Primary category" htmlFor="bp-cat" hint="Use the exact name from Google’s category list, e.g. “Dentist”." error={err('primaryCategory')}>
            <input id="bp-cat" className={inputCls(!!err('primaryCategory'))} value={d.primaryCategory} maxLength={LIMITS.category} onChange={(e) => set('primaryCategory', e.target.value)} />
          </Field>
          <Field label={`Additional categories (${d.additionalCategories.length}/${LIMITS.additionalCategories})`} htmlFor="bp-cats" hint="Press Enter to add. Only categories that genuinely apply." error={err('additionalCategories')}>
            <ChipInput id="bp-cats" values={d.additionalCategories} onChange={(v) => set('additionalCategories', v)} placeholder="e.g. Cosmetic dentist" max={LIMITS.additionalCategories} disabled={ro} />
          </Field>
          <Field label="Opening date" htmlFor="bp-open" error={err('openingDate')}>
            <input id="bp-open" type="date" className={inputCls(!!err('openingDate'))} value={d.openingDate ?? ''} onChange={(e) => set('openingDate', e.target.value || undefined)} />
          </Field>
        </div>
      </Section>

      <Section title="Description" description="Plain, factual language: what you do, for whom, where. No links, prices or promotional claims.">
        <Field label="" htmlFor="bp-desc" error={err('description')} hint={<span className="tabular-nums">{d.description.length}/{LIMITS.description} characters{d.description.length > 0 && d.description.length < 250 ? ' · aim for at least 250' : ''}</span>}>
          <textarea id="bp-desc" rows={6} className={inputCls(!!err('description'))} value={d.description} maxLength={LIMITS.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        {descChecks.length > 0 && <ul className="text-[12px] text-[var(--warning)] list-disc pl-5 space-y-0.5">{descChecks.map((c) => <li key={c}>{c}</li>)}</ul>}
      </Section>

      <Section title="Contact">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Primary phone" htmlFor="bp-phone" hint="International format, e.g. +1 512 555 0100" error={err('phone')}>
            <input id="bp-phone" type="tel" autoComplete="off" className={inputCls(!!err('phone'))} value={d.phone} maxLength={40} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Additional phones" htmlFor="bp-phones" error={err('additionalPhones')}>
            <ChipInput id="bp-phones" values={d.additionalPhones} onChange={(v) => set('additionalPhones', v)} placeholder="Press Enter to add" max={LIMITS.phones} disabled={ro} maxLen={40} />
          </Field>
          <Field label="Website" htmlFor="bp-web" error={err('website')}>
            <input id="bp-web" type="url" className={inputCls(!!err('website'))} placeholder="https://" value={d.website ?? ''} maxLength={2048} onChange={(e) => set('website', e.target.value || undefined)} />
          </Field>
          <Field label="Public email" htmlFor="bp-email" error={err('email')}>
            <input id="bp-email" type="email" className={inputCls(!!err('email'))} value={d.email ?? ''} maxLength={254} onChange={(e) => set('email', e.target.value || undefined)} />
          </Field>
        </div>
      </Section>

      <Section title="Location & service area">
        <label className="flex items-center gap-2 text-sm text-[var(--text)]">
          <input type="checkbox" checked={d.hideAddress} onChange={(e) => set('hideAddress', e.target.checked)} />
          Customers are served at their location (hide the street address)
        </label>
        <div className="grid gap-4 md:grid-cols-6">
          <Field className="md:col-span-4" label="Street address" htmlFor="bp-a1" error={err('address.line1')}>
            <input id="bp-a1" className={inputCls(!!err('address.line1'))} value={d.address?.line1 ?? ''} onChange={(e) => set('address', { country: 'US', city: '', ...d.address, line1: e.target.value })} />
          </Field>
          <Field className="md:col-span-2" label="Suite / unit" htmlFor="bp-a2">
            <input id="bp-a2" className={inputCls()} value={d.address?.line2 ?? ''} onChange={(e) => set('address', { country: 'US', city: '', line1: '', ...d.address, line2: e.target.value || undefined })} />
          </Field>
          <Field className="md:col-span-2" label="City" htmlFor="bp-city" error={err('address.city')}>
            <input id="bp-city" className={inputCls(!!err('address.city'))} value={d.address?.city ?? ''} onChange={(e) => set('address', { country: 'US', line1: '', ...d.address, city: e.target.value })} />
          </Field>
          <Field className="md:col-span-2" label="State / region" htmlFor="bp-reg">
            <input id="bp-reg" className={inputCls()} value={d.address?.region ?? ''} onChange={(e) => set('address', { country: 'US', line1: '', city: '', ...d.address, region: e.target.value || undefined })} />
          </Field>
          <Field className="md:col-span-1" label="Postal code" htmlFor="bp-zip">
            <input id="bp-zip" className={inputCls()} value={d.address?.postalCode ?? ''} onChange={(e) => set('address', { country: 'US', line1: '', city: '', ...d.address, postalCode: e.target.value || undefined })} />
          </Field>
          <Field className="md:col-span-1" label="Country" htmlFor="bp-cc" error={err('address.country')}>
            <input id="bp-cc" className={inputCls(!!err('address.country'))} value={d.address?.country ?? ''} maxLength={2} placeholder="US" onChange={(e) => set('address', { line1: '', city: '', ...d.address, country: e.target.value.toUpperCase() })} />
          </Field>
        </div>
        {d.address && !ro && <Button size="sm" variant="ghost" onClick={() => set('address', undefined)} icon={<Trash2 className="h-3.5 w-3.5" />}>Remove address</Button>}
        <Field label={`Service areas (${d.serviceAreas.length}/${LIMITS.serviceAreas})`} htmlFor="bp-areas" hint="Cities, postcodes or regions you serve." error={err('serviceAreas')}>
          <ChipInput id="bp-areas" values={d.serviceAreas} onChange={(v) => set('serviceAreas', v)} placeholder="e.g. Austin, TX" max={LIMITS.serviceAreas} disabled={ro} />
        </Field>
      </Section>

      <Section id="bp-hours" title="Opening hours" description="Set every day, marking closed days. A closing time earlier than the opening time means the range runs past midnight.">
        {err('hours') && <p className="text-[12px] text-[var(--danger)]" role="alert">{err('hours')}</p>}
        <div className="divide-y divide-[var(--border)]">
          {DAYS.map((day) => {
            const h = d.hours[day];
            return (
              <div key={day} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="w-24 text-sm font-medium text-[var(--text)]">{dayLabel(day)}</span>
                <select aria-label={`${dayLabel(day)} status`} className={inputCls(false, 'w-36')} value={!h ? 'unset' : h.closed ? 'closed' : 'open'}
                  onChange={(e) => setDay(day, e.target.value === 'unset' ? undefined : e.target.value === 'closed' ? { closed: true, periods: [] } : { closed: false, periods: h?.periods.length ? h.periods : [{ open: '09:00', close: '17:00' }] })}>
                  <option value="unset">Not set</option><option value="open">Open</option><option value="closed">Closed</option>
                </select>
                {h && !h.closed && h.periods.map((p, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <input aria-label={`${dayLabel(day)} opens`} type="time" className={inputCls(false, 'w-[132px]')} value={p.open} onChange={(e) => setDay(day, { ...h, periods: h.periods.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)) })} />
                    <span className="text-[var(--text-subtle)]">–</span>
                    <input aria-label={`${dayLabel(day)} closes`} type="time" className={inputCls(false, 'w-[132px]')} value={p.close === '24:00' ? '00:00' : p.close} onChange={(e) => setDay(day, { ...h, periods: h.periods.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)) })} />
                    {!ro && h.periods.length > 1 && <button type="button" aria-label="Remove time range" className="p-1 text-[var(--text-subtle)] hover:text-[var(--danger)]" onClick={() => setDay(day, { ...h, periods: h.periods.filter((_, j) => j !== i) })}><X className="h-3.5 w-3.5" /></button>}
                  </span>
                ))}
                {!ro && h && !h.closed && h.periods.length < 4 && <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDay(day, { ...h, periods: [...h.periods, { open: '13:00', close: '17:00' }] })}>Split</Button>}
                {errors[`hours.${day}`] || Object.entries(errors).find(([k]) => k.startsWith(`hours.${day}.`))?.[1] ? <span className="text-[12px] text-[var(--danger)]">{errors[`hours.${day}`] || Object.entries(errors).find(([k]) => k.startsWith(`hours.${day}.`))?.[1]}</span> : null}
              </div>
            );
          })}
        </div>
        {!ro && d.hours.MONDAY && <Button size="sm" variant="secondary" onClick={copyMonday}>Copy Monday to Tue–Fri</Button>}
      </Section>

      <Section id="bp-special" title="Special hours" description="Holidays and one-off changes. Past dates can be removed.">
        {d.specialHours.map((s, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input aria-label="Date" type="date" className={inputCls(!!errors[`specialHours.${i}.date`], 'w-44')} value={s.date} onChange={(e) => set('specialHours', d.specialHours.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
            <select aria-label="Open or closed" className={inputCls(false, 'w-32')} value={s.closed ? 'closed' : 'open'} onChange={(e) => set('specialHours', d.specialHours.map((x, j) => (j === i ? { ...x, closed: e.target.value === 'closed', periods: e.target.value === 'closed' ? [] : [{ open: '10:00', close: '14:00' }] } : x)))}>
              <option value="closed">Closed</option><option value="open">Open</option>
            </select>
            {!s.closed && s.periods.slice(0, 1).map((p, k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <input aria-label="Opens" type="time" className={inputCls(false, 'w-[132px]')} value={p.open} onChange={(e) => set('specialHours', d.specialHours.map((x, j) => (j === i ? { ...x, periods: [{ ...p, open: e.target.value }] } : x)))} />–
                <input aria-label="Closes" type="time" className={inputCls(false, 'w-[132px]')} value={p.close} onChange={(e) => set('specialHours', d.specialHours.map((x, j) => (j === i ? { ...x, periods: [{ ...p, close: e.target.value }] } : x)))} />
              </span>
            ))}
            <input aria-label="Note" placeholder="Note (e.g. Christmas Day)" className={inputCls(false, 'flex-1 min-w-[160px]')} maxLength={80} value={s.note ?? ''} onChange={(e) => set('specialHours', d.specialHours.map((x, j) => (j === i ? { ...x, note: e.target.value || undefined } : x)))} />
            {!ro && <button type="button" aria-label="Remove date" className="p-1.5 text-[var(--text-subtle)] hover:text-[var(--danger)]" onClick={() => set('specialHours', d.specialHours.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
            {errors[`specialHours.${i}.date`] && <span className="text-[12px] text-[var(--danger)] w-full">{errors[`specialHours.${i}.date`]}</span>}
          </div>
        ))}
        {!ro && d.specialHours.length < LIMITS.specialHours && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('specialHours', [...d.specialHours, { date: new Date().toISOString().slice(0, 10), closed: true, periods: [] }])}>Add date</Button>}
      </Section>

      <Section id="bp-services" title={`Services (${d.services.length}/${LIMITS.services})`} description="Only services you actually provide. A short description helps customers know what’s included.">
        {d.services.map((s, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[minmax(160px,1fr)_2fr_auto] items-start">
            <div>
              <input aria-label="Service name" placeholder="Service name" className={inputCls(!!errors[`services.${i}.name`])} maxLength={LIMITS.serviceName} value={s.name} onChange={(e) => set('services', d.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              {errors[`services.${i}.name`] && <p className="text-[12px] text-[var(--danger)] mt-1">{errors[`services.${i}.name`]}</p>}
            </div>
            <input aria-label="Service description" placeholder="What’s included (optional)" className={inputCls(!!errors[`services.${i}.description`])} maxLength={LIMITS.serviceDescription} value={s.description ?? ''} onChange={(e) => set('services', d.services.map((x, j) => (j === i ? { ...x, description: e.target.value || undefined } : x)))} />
            {!ro && <button type="button" aria-label={`Remove ${s.name || 'service'}`} className="p-2 text-[var(--text-subtle)] hover:text-[var(--danger)]" onClick={() => set('services', d.services.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {!ro && d.services.length < LIMITS.services && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('services', [...d.services, { name: '' }])}>Add service</Button>}
      </Section>

      <Section title="Attributes" description="Facts customers filter by: accessibility, amenities, payment options, languages. Only what is true.">
        <ChipInput id="bp-attrs" values={d.attributes} onChange={(v) => set('attributes', v)} placeholder="e.g. Wheelchair accessible entrance" max={LIMITS.attributes} disabled={ro} maxLen={LIMITS.attribute} />
      </Section>

      <Section id="bp-media" title="Media" description="Links to images (https). Real photos of the premises, team and work; no stock images. Uploading to Google is done in Google Business Profile.">
        {d.media.map((m, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[120px_2fr_1fr_auto] items-start">
            <select aria-label="Image type" className={inputCls()} value={m.kind} onChange={(e) => set('media', d.media.map((x, j) => (j === i ? { ...x, kind: e.target.value as MediaItem['kind'] } : x)))}>
              <option value="logo">Logo</option><option value="cover">Cover</option><option value="photo">Photo</option>
            </select>
            <div>
              <input aria-label="Image URL" type="url" placeholder="https://…" className={inputCls(!!errors[`media.${i}.url`])} value={m.url} onChange={(e) => set('media', d.media.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              {errors[`media.${i}.url`] && <p className="text-[12px] text-[var(--danger)] mt-1">{errors[`media.${i}.url`]}</p>}
            </div>
            <input aria-label="Caption" placeholder="Caption" className={inputCls()} maxLength={LIMITS.caption} value={m.caption ?? ''} onChange={(e) => set('media', d.media.map((x, j) => (j === i ? { ...x, caption: e.target.value || undefined } : x)))} />
            {!ro && <button type="button" aria-label="Remove image" className="p-2 text-[var(--text-subtle)] hover:text-[var(--danger)]" onClick={() => set('media', d.media.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
          </div>
        ))}
        {!ro && d.media.length < LIMITS.media && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set('media', [...d.media, { kind: d.media.some((x) => x.kind === 'logo') ? 'photo' : 'logo', url: '', addedAt: new Date().toISOString() }])}>Add image link</Button>}
      </Section>
    </fieldset>
  );
}
