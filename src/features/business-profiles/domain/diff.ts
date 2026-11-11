/** Field-level diff for the change history (traceability of every edit). */
import { DAYS, type BusinessProfileData, type FieldChange } from './types';

export const FIELD_LABELS: Record<string, string> = {
  name: 'Business name', legalName: 'Legal name', description: 'Description', primaryCategory: 'Primary category', additionalCategories: 'Additional categories',
  phone: 'Phone', additionalPhones: 'Additional phones', email: 'Email', website: 'Website', address: 'Address', hideAddress: 'Hide address',
  serviceAreas: 'Service areas', hours: 'Hours', specialHours: 'Special hours', services: 'Services', attributes: 'Attributes', media: 'Media', openingDate: 'Opening date',
};

const MAX = 300;
const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX)}…` : s);

export function display(field: string, v: unknown): string {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return v;
  if (field === 'address') { const a = v as any; return [a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', '); }
  if (field === 'hours') {
    const h = v as BusinessProfileData['hours'];
    return DAYS.filter((d) => h[d]).map((d) => `${d.slice(0, 3)} ${h[d]!.closed ? 'closed' : h[d]!.periods.map((p) => `${p.open}–${p.close}`).join(', ')}`).join('; ') || '—';
  }
  if (field === 'services') return (v as any[]).map((s) => s.name).join(', ');
  if (field === 'media') return `${(v as any[]).length} item${(v as any[]).length === 1 ? '' : 's'}`;
  if (field === 'specialHours') return (v as any[]).map((s) => `${s.date} ${s.closed ? 'closed' : s.periods.map((p: any) => `${p.open}–${p.close}`).join(', ')}`).join('; ');
  if (Array.isArray(v)) return v.join(', ');
  return JSON.stringify(v);
}

const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b))) : x)) ?? '';
const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && v && !Array.isArray(v) && !Object.keys(v).length);

export function diffProfiles(before: BusinessProfileData, after: BusinessProfileData): FieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])] as (keyof BusinessProfileData)[];
  const out: FieldChange[] = [];
  for (const k of keys) {
    const a = before[k]; const b = after[k];
    if ((empty(a) && empty(b)) || canon(a) === canon(b)) continue;
    out.push({ field: k, before: clip(display(k, a)), after: clip(display(k, b)) });
  }
  return out;
}
