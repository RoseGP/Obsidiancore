/**
 * Input validation and sanitisation for business profiles (shared by the API and the form).
 * Values are stored as plain text: control characters and HTML tags are stripped, and React
 * escapes everything on render. Limits follow Google Business Profile where one exists
 * (750-character description, up to 9 additional categories).
 */
import { z } from 'zod';
import { DAYS, type BusinessProfileData } from './types';

export const LIMITS = {
  name: 120, description: 750, category: 100, additionalCategories: 9, phones: 2, serviceAreas: 20,
  services: 50, serviceName: 120, serviceDescription: 300, attributes: 40, attribute: 80, media: 30, specialHours: 60, caption: 200,
} as const;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g;
const TAGS = /<\/?[a-z][^>]*>/gi;

/** Strips control/bidi characters and HTML tags; collapses whitespace (newlines kept when multiline). */
export function cleanText(v: string, multiline = false): string {
  let s = String(v ?? '').replace(CONTROL, '').replace(TAGS, '');
  s = multiline ? s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim();
}

const text = (max: number, label: string, multiline = false) =>
  z.string().max(max * 2, `${label} is too long.`).transform((s) => cleanText(s, multiline)).refine((s) => s.length <= max, `${label} must be ${max} characters or fewer.`);
const optText = (max: number, label: string) => text(max, label).optional().transform((s) => (s ? s : undefined));

export const phoneDigits = (p: string | undefined) => (p || '').replace(/\D/g, '');
export const phoneSchema = z.string().max(40).transform((s) => cleanText(s)).refine(
  (s) => s === '' || (/^\+?[\d\s().-]+$/.test(s) && phoneDigits(s).length >= 7 && phoneDigits(s).length <= 15),
  'Enter a valid phone number (7–15 digits; include the country code, e.g. +1 512 555 0100).',
);

export function isSafeWebUrl(u: string, httpsOnly = false): boolean {
  try {
    const url = new URL(u);
    if (httpsOnly ? url.protocol !== 'https:' : !['https:', 'http:'].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    return /\./.test(url.hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname);
  } catch { return false; }
}
const websiteSchema = z.string().max(2048).transform((s) => cleanText(s)).refine((s) => s === '' || isSafeWebUrl(s), 'Enter a full website address starting with https:// (no login details or IP addresses).');
const emailSchema = z.string().max(254).transform((s) => cleanText(s).toLowerCase()).refine((s) => s === '' || /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i.test(s), 'Enter a valid email address.');

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use 24-hour time, e.g. 09:00 or 17:30.');
const period = z.object({ open: time, close: time }).strict().refine((p) => p.open !== p.close, 'Opening and closing times can’t be the same.');
const dayHours = z.object({ closed: z.boolean(), periods: z.array(period).max(4, 'At most 4 time ranges per day.') }).strict();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-24.').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date.');

const addressSchema = z.object({
  line1: text(200, 'Street address'), line2: optText(200, 'Address line 2'), city: text(100, 'City'),
  region: optText(100, 'State / region'), postalCode: optText(20, 'Postal code'),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code, e.g. US.'),
}).strict();

export const profileDataSchema = z.object({
  name: text(LIMITS.name, 'Business name').refine((s) => s.length > 0, 'Business name is required.'),
  legalName: optText(LIMITS.name, 'Legal name'),
  description: text(LIMITS.description, 'Description', true).default(''),
  primaryCategory: text(LIMITS.category, 'Primary category').default(''),
  additionalCategories: z.array(text(LIMITS.category, 'Category')).max(LIMITS.additionalCategories, `Google allows up to ${LIMITS.additionalCategories} additional categories.`).default([])
    .transform((a) => a.filter(Boolean)),
  phone: phoneSchema.default(''),
  additionalPhones: z.array(phoneSchema).max(LIMITS.phones, `At most ${LIMITS.phones} additional phone numbers.`).default([]).transform((a) => a.filter(Boolean)),
  email: emailSchema.optional().transform((s) => (s ? s : undefined)),
  website: websiteSchema.optional().transform((s) => (s ? s : undefined)),
  address: addressSchema.optional(),
  hideAddress: z.boolean().default(false),
  serviceAreas: z.array(text(120, 'Service area')).max(LIMITS.serviceAreas, `At most ${LIMITS.serviceAreas} service areas.`).default([]).transform((a) => a.filter(Boolean)),
  hours: z.object(Object.fromEntries(DAYS.map((d) => [d, dayHours.optional()])) as Record<(typeof DAYS)[number], z.ZodOptional<typeof dayHours>>).strict().default({}),
  specialHours: z.array(z.object({ date: ymd, closed: z.boolean(), periods: z.array(period).max(4), note: optText(80, 'Note') }).strict()).max(LIMITS.specialHours).default([]),
  services: z.array(z.object({ name: text(LIMITS.serviceName, 'Service name').refine((s) => s.length > 0, 'Service name is required.'), description: optText(LIMITS.serviceDescription, 'Service description') }).strict())
    .max(LIMITS.services, `At most ${LIMITS.services} services.`).default([]),
  attributes: z.array(text(LIMITS.attribute, 'Attribute')).max(LIMITS.attributes).default([]).transform((a) => [...new Set(a.filter(Boolean))]),
  media: z.array(z.object({
    kind: z.enum(['logo', 'cover', 'photo']),
    url: z.string().max(2048).trim().refine((u) => isSafeWebUrl(u, true), 'Media links must be https:// image URLs.'),
    caption: optText(LIMITS.caption, 'Caption'),
    addedAt: z.string().max(40).optional(),
  }).strict()).max(LIMITS.media, `At most ${LIMITS.media} media items.`).default([]),
  openingDate: ymd.optional(),
}).strict()
  .superRefine((d, ctx) => {
    if (d.hideAddress && !d.serviceAreas.length) ctx.addIssue({ code: 'custom', path: ['serviceAreas'], message: 'Add at least one service area when the address is hidden.' });
    const seen = new Set<string>();
    for (const [i, s] of d.services.entries()) {
      const k = s.name.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['services', i, 'name'], message: `“${s.name}” is listed twice.` });
      seen.add(k);
    }
    const dates = new Set<string>();
    for (const [i, s] of d.specialHours.entries()) {
      if (dates.has(s.date)) ctx.addIssue({ code: 'custom', path: ['specialHours', i, 'date'], message: `${s.date} has more than one entry.` });
      dates.add(s.date);
    }
  });

/** Parses user input into stored profile data (stamps media.addedAt). Throws ZodError. */
export function parseProfileData(input: unknown, now = new Date().toISOString()): BusinessProfileData {
  const d = profileDataSchema.parse(input);
  return { ...d, media: d.media.map((m) => ({ ...m, addedAt: m.addedAt && !Number.isNaN(Date.parse(m.addedAt)) ? m.addedAt : now })) } as BusinessProfileData;
}

export const profileIdSchema = z.string().regex(/^bp_[A-Za-z0-9_-]{10,40}$/, 'Invalid profile id.');
