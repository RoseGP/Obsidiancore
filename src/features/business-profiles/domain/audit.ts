/**
 * Deterministic business-profile audit (shared by client and server).
 *
 * Every finding here is algorithmic: it comes from rules over the stored data, never from an LLM.
 * Findings comparing the CRM record with a linked listing are marked `verified` when they are
 * based on data read from the provider's official API (the snapshot), with its timestamp.
 * Checks that can't be evaluated (no listing linked, no snapshot) are reported as `unknown`
 * and excluded from the score rather than counted as passed.
 *
 * The score is this app's own diagnostic of profile quality. It is not a Google metric and does
 * not predict or guarantee rankings.
 */
import { DAYS, type AuditFinding, type AuditResult, type BusinessProfile, type BusinessProfileData, type FindingCategory, type FindingStatus, type Level, type ListingLink, type Severity, type TimePeriod } from './types';
import { phoneDigits } from './validation';

export const AUDIT_ENGINE_VERSION = 'bp-audit-1.0';
const DAY_MS = 86_400_000;
export const STALE = { hoursDays: 90, reviewDays: 180, snapshotDays: 30, auditDays: 30 } as const;

// ---------- Text helpers (exported for tests) ----------

const STOP = new Set('a an and are as at be by for from has have in is it its of on or our that the this to we with you your their they will can more also all any into than then them who what when where which while very most just over under about after before'.split(' '));
const LEGAL = /\b(llc|l\.l\.c|inc|incorporated|ltd|limited|corp|corporation|co|company|plc|gmbh|pty|pc|pllc|llp)\b\.?/g;

export function normalizeName(s: string | undefined): string {
  return (s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').replace(LEGAL, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\bthe\b/g, ' ').replace(/\s+/g, ' ').trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** 0–1 similarity of two business names after normalisation (max of token overlap and edit distance). */
export function nameSimilarity(a: string | undefined, b: string | undefined): number {
  const x = normalizeName(a); const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const tx = new Set(x.split(' ')); const ty = new Set(y.split(' '));
  const inter = [...tx].filter((t) => ty.has(t)).length;
  const jaccard = inter / new Set([...tx, ...ty]).size;
  const edit = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  return Math.max(jaccard, edit);
}

const ADDR: [RegExp, string][] = [
  [/\bstreet\b/g, 'st'], [/\bavenue\b/g, 'ave'], [/\bboulevard\b/g, 'blvd'], [/\broad\b/g, 'rd'], [/\bdrive\b/g, 'dr'], [/\blane\b/g, 'ln'],
  [/\bcourt\b/g, 'ct'], [/\bplace\b/g, 'pl'], [/\bsuite\b/g, 'ste'], [/\bapartment\b/g, 'apt'], [/\bhighway\b/g, 'hwy'], [/\bparkway\b/g, 'pkwy'],
  [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'], [/\beast\b/g, 'e'], [/\bwest\b/g, 'w'], [/#/g, ' ste '],
];
export function normalizeAddress(s: string | undefined): string {
  let x = ` ${(s || '').toLowerCase().replace(/[.,]/g, ' ')} `;
  for (const [re, rep] of ADDR) x = x.replace(re, rep);
  return x.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function urlKey(u: string | undefined): string {
  if (!u) return '';
  try { const x = new URL(u); return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/+$/, '')}`; } catch { return u.toLowerCase().trim(); }
}

/** Last 10 digits, so "+1 (512) 555-0100" and "512.555.0100" compare equal. */
export const phoneKey = (p: string | undefined) => phoneDigits(p).slice(-10);

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
/** Returns the periods that overlap another on the same day (overnight periods extend past 24:00). */
export function overlappingPeriods(periods: TimePeriod[]): boolean {
  const iv = periods.map((p) => { const o = toMin(p.open); let c = toMin(p.close); if (c <= o) c += 1440; return [o, c] as const; }).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < iv.length; i++) if (iv[i][0] < iv[i - 1][1]) return true;
  return false;
}

/** Words repeated unnaturally often (keyword stuffing heuristic). */
export function repeatedTerms(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [];
  if (words.length < 20) return [];
  const freq = new Map<string, number>();
  for (const w of words) if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()].filter(([, n]) => n >= 5 || (n >= 4 && n / words.length > 0.06)).map(([w]) => w);
}

const PROMO = /#\s?1\b|(?<![-\w])free\b(?!-)|\d+\s?% off\b|\b(?:best|number one|no\.? ?1|cheapest|lowest price|guarantee[ds]?|top[- ]rated|award[- ]winning|discount|sale|world[- ]class|unbeatable|rank(?:ing)? first)\b/gi;
export const promotionalPhrases = (text: string) => [...new Set((text.match(PROMO) ?? []).map((m) => m.toLowerCase()))];
export const hasUrl = (t: string) => /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]/i.test(t);
export const hasEmail = (t: string) => /[\w.+-]+@[\w-]+\.[\w.]+/.test(t);
export const hasPhone = (t: string) => /(\+?\d[\d\s().-]{7,}\d)/.test(t);

const daysSince = (iso: string | undefined, now: number) => (iso ? Math.floor((now - Date.parse(iso)) / DAY_MS) : Infinity);
const fmtDays = (n: number) => (n === Infinity ? 'never' : n === 0 ? 'today' : `${n} day${n === 1 ? '' : 's'} ago`);
const titleCase = (d: string) => d[0] + d.slice(1).toLowerCase();

// ---------- Engine ----------

const IMPACT_W: Record<Level, number> = { high: 3, medium: 2, low: 1 };
const SEVERITY_W: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const EFFORT_W: Record<Level, number> = { low: 1, medium: 2, high: 3 };
/** Priority = impact × severity ÷ effort (higher first). Quick, important fixes rise to the top. */
export const priorityOf = (impact: Level, severity: Severity, effort: Level) => Math.round(((IMPACT_W[impact] * SEVERITY_W[severity]) / EFFORT_W[effort]) * 10) / 10;

interface CheckDef { id: string; category: FindingCategory; weight: number; severity: Severity; impact: Level; effort: Level; field?: string }
type Outcome = { status: FindingStatus; title: string; explanation: string; recommendation?: string; evidence?: string; source?: 'verified' | 'algorithmic'; severity?: Severity };

export interface AuditInput {
  data: BusinessProfileData;
  version: number;
  hoursVerifiedAt?: string;
  lastReviewedAt?: string;
  listing?: ListingLink;
}

export function auditProfile(input: AuditInput, now: Date = new Date()): AuditResult {
  const { data: d } = input;
  const t = now.getTime();
  const findings: (AuditFinding & { weight: number })[] = [];
  const add = (c: CheckDef, o: Outcome) => {
    const severity = o.severity ?? c.severity;
    findings.push({
      checkId: c.id, category: c.category, status: o.status, severity, impact: c.impact, effort: c.effort, title: o.title, explanation: o.explanation,
      recommendation: o.status === 'pass' ? '' : o.recommendation ?? '', field: c.field, evidence: o.evidence, source: o.source ?? 'algorithmic',
      priority: o.status === 'pass' || o.status === 'unknown' ? 0 : priorityOf(c.impact, severity, c.effort), weight: c.weight,
    });
  };
  const desc = d.description.trim();
  const words = (s: string) => normalizeName(s).split(' ').filter((w) => w.length > 3 && !STOP.has(w));

  // ---- Completeness ----
  add({ id: 'name', category: 'completeness', weight: 6, severity: 'critical', impact: 'high', effort: 'low', field: 'name' },
    d.name ? { status: 'pass', title: 'Business name is set', explanation: `The profile uses “${d.name}”.` } : { status: 'fail', title: 'Business name is missing', explanation: 'Customers and directories need the business’s real-world name.', recommendation: 'Enter the name exactly as it appears on your signage and documents.' });

  add({ id: 'primary-category', category: 'completeness', weight: 10, severity: 'high', impact: 'high', effort: 'low', field: 'primaryCategory' },
    d.primaryCategory ? { status: 'pass', title: 'Primary category is set', explanation: `Primary category: ${d.primaryCategory}.` }
      : { status: 'fail', title: 'Choose a primary category', explanation: 'The primary category tells directories what kind of business this is. Without it, the listing is harder to match to relevant searches.', recommendation: 'Pick the single category that best describes the core business, using the exact name from the directory’s category list (for Google, choose it in Business Profile).' });

  add({ id: 'description', category: 'completeness', weight: 10, severity: 'high', impact: 'medium', effort: 'low', field: 'description' },
    !desc ? { status: 'fail', title: 'Add a business description', explanation: 'There is no description. A short, factual description helps customers understand what the business offers.', recommendation: 'Write 250–750 characters about your real services, who you serve and where. The AI assistant can draft one from the facts on this profile for you to review.' }
      : desc.length < 250 ? { status: 'warn', severity: 'medium', title: 'Description is short', explanation: `The description is ${desc.length} characters. There is room (up to 750) to explain services and service area more fully.`, recommendation: 'Expand it with concrete facts: main services, the customers you serve and the area you cover.', evidence: `${desc.length}/750 characters` }
        : { status: 'pass', title: 'Description has a useful length', explanation: `${desc.length} of 750 characters used.` });

  add({ id: 'phone', category: 'completeness', weight: 8, severity: 'high', impact: 'high', effort: 'low', field: 'phone' },
    d.phone ? { status: 'pass', title: 'Primary phone number is set', explanation: `Phone: ${d.phone}.` } : { status: 'fail', title: 'Add a phone number', explanation: 'Customers can’t call the business from its listing.', recommendation: 'Add the main number that is answered during business hours.' });

  add({ id: 'website', category: 'completeness', weight: 6, severity: 'medium', impact: 'medium', effort: 'low', field: 'website' },
    d.website ? { status: 'pass', title: 'Website link is set', explanation: `Website: ${d.website}.` } : { status: 'fail', title: 'Add a website link', explanation: 'A website link lets customers learn more, book or buy.', recommendation: 'Link the page that best represents this business or location.' });

  const hasAddr = !!d.address?.line1 && !d.hideAddress;
  add({ id: 'location', category: 'completeness', weight: 10, severity: 'critical', impact: 'high', effort: 'low', field: 'address' },
    hasAddr || d.serviceAreas.length ? { status: 'pass', title: 'Location information is set', explanation: hasAddr ? `Storefront address in ${d.address!.city}.` : `Service area: ${d.serviceAreas.slice(0, 5).join(', ')}${d.serviceAreas.length > 5 ? '…' : ''}.` }
      : { status: 'fail', title: 'Add an address or service area', explanation: 'Without an address or service area, customers and directories can’t tell where the business operates.', recommendation: 'Add the storefront address, or the cities/regions you serve if you visit customers.' });

  const setDays = DAYS.filter((day) => d.hours[day]);
  const missingDays = DAYS.filter((day) => !d.hours[day]);
  add({ id: 'hours', category: 'completeness', weight: 10, severity: 'high', impact: 'high', effort: 'low', field: 'hours' },
    !setDays.length ? { status: 'fail', title: 'Add opening hours', explanation: 'No opening hours are set, so customers can’t tell when the business is open.', recommendation: 'Set hours for every day of the week, marking days you are closed.' }
      : missingDays.length ? { status: 'warn', severity: 'medium', title: 'Some days have no hours', explanation: `${missingDays.map(titleCase).join(', ')} ${missingDays.length === 1 ? 'has' : 'have'} no hours and aren’t marked closed.`, recommendation: 'Set hours or mark each of these days as closed.', evidence: missingDays.map(titleCase).join(', ') }
        : { status: 'pass', title: 'Hours are set for every day', explanation: 'All seven days have hours or are marked closed.' });

  add({ id: 'services', category: 'completeness', weight: 6, severity: 'medium', impact: 'medium', effort: 'medium', field: 'services' },
    d.services.length ? { status: 'pass', title: 'Services are listed', explanation: `${d.services.length} service${d.services.length === 1 ? '' : 's'} listed.` }
      : { status: 'fail', title: 'List your services', explanation: 'No services are listed. Customers look for specific services before contacting a business.', recommendation: 'Add the services you actually provide, one per line, with a short description each.' });

  add({ id: 'additional-categories', category: 'completeness', weight: 3, severity: 'low', impact: 'low', effort: 'low', field: 'additionalCategories' },
    d.additionalCategories.length ? { status: 'pass', title: 'Additional categories considered', explanation: `${d.additionalCategories.length} additional categor${d.additionalCategories.length === 1 ? 'y' : 'ies'}.` }
      : { status: 'warn', title: 'Consider additional categories', explanation: 'No additional categories are set. That is fine if the primary category covers everything you do.', recommendation: 'If you offer distinct services covered by another category in the directory’s list, add it. Only add categories that genuinely apply.' });

  add({ id: 'attributes', category: 'completeness', weight: 2, severity: 'low', impact: 'low', effort: 'low', field: 'attributes' },
    d.attributes.length ? { status: 'pass', title: 'Attributes recorded', explanation: `${d.attributes.length} attribute${d.attributes.length === 1 ? '' : 's'} (e.g. accessibility, payment options).` }
      : { status: 'warn', title: 'Record key attributes', explanation: 'Attributes such as wheelchair access, payment options or languages spoken help customers decide.', recommendation: 'Add the attributes that are true for this business.' });

  // ---- Accuracy ----
  if (d.website) {
    add({ id: 'website-https', category: 'accuracy', weight: 3, severity: 'medium', impact: 'medium', effort: 'low', field: 'website' },
      d.website.startsWith('https://') ? { status: 'pass', title: 'Website uses https', explanation: 'The website link is secure.' }
        : { status: 'warn', title: 'Website link isn’t secure (http)', explanation: 'Browsers mark http pages as “Not secure”, which can put customers off.', recommendation: 'Use the https:// version of your site if it has one.', evidence: d.website });
  }
  if (d.phone) {
    add({ id: 'phone-format', category: 'accuracy', weight: 2, severity: 'low', impact: 'low', effort: 'low', field: 'phone' },
      d.phone.trim().startsWith('+') ? { status: 'pass', title: 'Phone includes the country code', explanation: 'International format avoids ambiguity across directories.' }
        : { status: 'warn', title: 'Add the country code to the phone number', explanation: 'Without a country code, directories may parse the number differently.', recommendation: 'Write it in international format, e.g. +1 512 555 0100.' });
  }
  const badDays = DAYS.filter((day) => { const h = d.hours[day]; return h && !h.closed && (!h.periods.length || overlappingPeriods(h.periods)); });
  if (setDays.length) {
    add({ id: 'hours-valid', category: 'accuracy', weight: 5, severity: 'high', impact: 'high', effort: 'low', field: 'hours' },
      badDays.length ? { status: 'fail', title: 'Hours have errors', explanation: `${badDays.map(titleCase).join(', ')}: marked open but with no time ranges, or with overlapping ranges.`, recommendation: 'Fix the time ranges so each open day has non-overlapping hours.', evidence: badDays.map(titleCase).join(', ') }
        : { status: 'pass', title: 'Hours are well-formed', explanation: 'No overlapping or empty time ranges.' });
  }
  const dupCats = d.additionalCategories.filter((c, i, a) => c.toLowerCase() === d.primaryCategory.toLowerCase() || a.findIndex((x) => x.toLowerCase() === c.toLowerCase()) !== i);
  if (d.additionalCategories.length) {
    add({ id: 'category-duplicates', category: 'accuracy', weight: 2, severity: 'low', impact: 'low', effort: 'low', field: 'additionalCategories' },
      dupCats.length ? { status: 'warn', title: 'Duplicate categories', explanation: `“${dupCats[0]}” is repeated or matches the primary category.`, recommendation: 'Remove the duplicate.' }
        : { status: 'pass', title: 'No duplicate categories', explanation: 'Each category is listed once.' });
  }
  // Name stuffing: separators, category or city words appended to the name.
  const nameN = ` ${normalizeName(d.name)} `;
  const legalN = normalizeName(d.legalName);
  const stuffed: string[] = [];
  if (/[|]|\s[-–—]\s/.test(d.name)) stuffed.push('separator characters');
  if (d.address?.city && nameN.includes(` ${normalizeName(d.address.city)} `) && !(legalN && ` ${legalN} `.includes(` ${normalizeName(d.address.city)} `))) stuffed.push(`the city (“${d.address.city}”)`);
  const catWords = words(d.primaryCategory);
  if (catWords.length && catWords.every((w) => nameN.includes(` ${w} `)) && !(legalN && catWords.every((w) => ` ${legalN} `.includes(` ${w} `))) && d.name.split(/\s+/).length > catWords.length + 1) stuffed.push(`the category (“${d.primaryCategory}”)`);
  if (d.name) {
    add({ id: 'name-keywords', category: 'accuracy', weight: 4, severity: 'medium', impact: 'medium', effort: 'low', field: 'name' },
      stuffed.length ? { status: 'warn', title: 'Business name may include extra keywords', explanation: `The name contains ${stuffed.join(' and ')}. Directory guidelines (including Google’s) ask for the real-world name only; adding keywords can lead to the listing being suspended.`, recommendation: 'If these words aren’t part of the registered or signage name, remove them. If they are (record it as the legal name), you can ignore this.', evidence: d.name }
        : { status: 'pass', title: 'Business name looks like a real-world name', explanation: 'No added keywords, cities or separators detected.' });
  }
  if (hasAddr) {
    add({ id: 'address-postal', category: 'accuracy', weight: 2, severity: 'medium', impact: 'medium', effort: 'low', field: 'address' },
      d.address!.postalCode ? { status: 'pass', title: 'Address includes a postal code', explanation: 'Complete addresses match more reliably across directories.' }
        : { status: 'warn', title: 'Address has no postal code', explanation: 'Directories and maps use the postal code to match the address.', recommendation: 'Add the postal / ZIP code.' });
  }

  // ---- Content quality ----
  if (desc) {
    const contact = [hasUrl(desc) && 'a link', hasEmail(desc) && 'an email address', hasPhone(desc) && 'a phone number'].filter(Boolean) as string[];
    add({ id: 'description-contact', category: 'content', weight: 4, severity: 'medium', impact: 'medium', effort: 'low', field: 'description' },
      contact.length ? { status: 'fail', title: 'Description contains contact details or links', explanation: `It includes ${contact.join(', ')}. Google’s guidelines don’t allow links in the description, and contact details belong in their own fields.`, recommendation: 'Remove them from the description; keep them in the phone, email and website fields.' }
        : { status: 'pass', title: 'No links or contact details in the description', explanation: 'Contact details are kept in their own fields.' });
    const promo = promotionalPhrases(desc);
    add({ id: 'description-claims', category: 'content', weight: 4, severity: 'medium', impact: 'medium', effort: 'low', field: 'description' },
      promo.length ? { status: 'warn', title: 'Description uses promotional or unverifiable claims', explanation: `Phrases like ${promo.slice(0, 4).map((p) => `“${p}”`).join(', ')} read as advertising and may break directory content policies unless you can back them up.`, recommendation: 'Replace them with concrete facts (services, experience, certifications you actually hold).', evidence: promo.join(', ') }
        : { status: 'pass', title: 'No promotional claims detected', explanation: 'The description sticks to descriptive language.' });
    const rep = repeatedTerms(desc);
    add({ id: 'description-stuffing', category: 'content', weight: 4, severity: 'medium', impact: 'medium', effort: 'low', field: 'description' },
      rep.length ? { status: 'warn', title: 'Repeated keywords in the description', explanation: `${rep.slice(0, 4).map((w) => `“${w}”`).join(', ')} ${rep.length === 1 ? 'appears' : 'appear'} many times. Repetition reads poorly and doesn’t help customers.`, recommendation: 'Say each thing once, in natural sentences.', evidence: rep.join(', ') }
        : { status: 'pass', title: 'Natural keyword use', explanation: 'No term is repeated excessively.' });
    const letters = desc.replace(/[^A-Za-z]/g, '');
    const caps = letters.length ? desc.replace(/[^A-Z]/g, '').length / letters.length : 0;
    add({ id: 'description-caps', category: 'content', weight: 1, severity: 'low', impact: 'low', effort: 'low', field: 'description' },
      caps > 0.3 && letters.length > 40 ? { status: 'warn', title: 'Too many capital letters', explanation: `About ${Math.round(caps * 100)}% of letters are capitals, which reads as shouting.`, recommendation: 'Use sentence case.' }
        : { status: 'pass', title: 'Readable capitalisation', explanation: 'Sentence case is used.' });
    const relevant = [...catWords, ...d.services.flatMap((s) => words(s.name))];
    const descN = ` ${normalizeName(desc)} `;
    if (relevant.length) {
      add({ id: 'description-relevance', category: 'content', weight: 3, severity: 'low', impact: 'medium', effort: 'low', field: 'description' },
        relevant.some((w) => descN.includes(` ${w}`)) ? { status: 'pass', title: 'Description mentions what you do', explanation: 'It refers to the category or listed services.' }
          : { status: 'warn', title: 'Description doesn’t mention your services', explanation: 'Neither the primary category nor any listed service appears in the description, so it may not tell customers what you actually do.', recommendation: 'Mention your main services in plain words.' });
    }
  }
  if (d.services.length) {
    const without = d.services.filter((s) => !s.description).length;
    add({ id: 'service-descriptions', category: 'content', weight: 2, severity: 'low', impact: 'low', effort: 'medium', field: 'services' },
      without / d.services.length > 0.5 ? { status: 'warn', title: 'Most services have no description', explanation: `${without} of ${d.services.length} services have no description.`, recommendation: 'Add a sentence to each service explaining what is included. The AI assistant can draft these for review.' }
        : { status: 'pass', title: 'Services are described', explanation: `${d.services.length - without} of ${d.services.length} services have descriptions.` });
  }

  // ---- Freshness ----
  const hv = daysSince(input.hoursVerifiedAt, t);
  add({ id: 'hours-verified', category: 'freshness', weight: 5, severity: 'medium', impact: 'high', effort: 'low', field: 'hours' },
    hv <= STALE.hoursDays ? { status: 'pass', title: 'Hours confirmed recently', explanation: `Hours were confirmed ${fmtDays(hv)}.` }
      : { status: 'warn', title: hv === Infinity ? 'Hours have never been confirmed' : 'Hours may be out of date', explanation: `Hours were last confirmed ${fmtDays(hv)}. Wrong hours are one of the most common reasons customers have a bad experience.`, recommendation: 'Check the hours with the business and click “Confirm hours are correct”.', evidence: `Last confirmed: ${fmtDays(hv)}` });
  const rv = daysSince(input.lastReviewedAt, t);
  add({ id: 'profile-reviewed', category: 'freshness', weight: 4, severity: 'low', impact: 'medium', effort: 'low' },
    rv <= STALE.reviewDays ? { status: 'pass', title: 'Profile reviewed recently', explanation: `Someone confirmed the whole profile ${fmtDays(rv)}.` }
      : { status: 'warn', title: 'Profile hasn’t been reviewed in a while', explanation: `The profile was last reviewed ${fmtDays(rv)}. Details such as services, phone numbers and photos drift over time.`, recommendation: 'Read through the profile and click “Mark profile as reviewed” once everything is accurate.' });
  const upcoming = d.specialHours.filter((s) => { const x = Date.parse(`${s.date}T00:00:00Z`); return x >= t - DAY_MS && x <= t + 60 * DAY_MS; });
  const past = d.specialHours.filter((s) => Date.parse(`${s.date}T23:59:59Z`) < t);
  add({ id: 'special-hours', category: 'freshness', weight: 2, severity: 'low', impact: 'medium', effort: 'low', field: 'specialHours' },
    upcoming.length ? { status: 'pass', title: 'Upcoming special hours are set', explanation: `${upcoming.length} date${upcoming.length === 1 ? '' : 's'} in the next 60 days.` }
      : { status: 'warn', title: 'No special hours in the next 60 days', explanation: 'If the business closes or changes hours for holidays or events in the next two months, customers won’t know.', recommendation: 'Add special hours for any upcoming dates that differ from the usual schedule (ignore this if none do).' });
  if (past.length >= 5) {
    add({ id: 'special-hours-old', category: 'freshness', weight: 1, severity: 'low', impact: 'low', effort: 'low', field: 'specialHours' },
      { status: 'warn', title: 'Old special-hours entries', explanation: `${past.length} special-hours dates are in the past.`, recommendation: 'Remove past entries to keep the schedule easy to check.' });
  }

  // ---- Media (links recorded in the CRM; whether they are on the live listing isn't checked) ----
  const logo = d.media.some((m) => m.kind === 'logo');
  const cover = d.media.some((m) => m.kind === 'cover');
  const photos = d.media.filter((m) => m.kind === 'photo');
  add({ id: 'media-logo', category: 'media', weight: 3, severity: 'medium', impact: 'medium', effort: 'low', field: 'media' },
    logo ? { status: 'pass', title: 'Logo recorded', explanation: 'A logo is on file.' } : { status: 'fail', title: 'Add a logo', explanation: 'A logo helps customers recognise the business across directories.', recommendation: 'Add a square logo image link.' });
  add({ id: 'media-cover', category: 'media', weight: 3, severity: 'medium', impact: 'medium', effort: 'low', field: 'media' },
    cover ? { status: 'pass', title: 'Cover photo recorded', explanation: 'A cover photo is on file.' } : { status: 'fail', title: 'Add a cover photo', explanation: 'The cover photo is often the first image customers see.', recommendation: 'Add a high-quality photo that represents the business.' });
  add({ id: 'media-photos', category: 'media', weight: 4, severity: 'medium', impact: 'medium', effort: 'medium', field: 'media' },
    photos.length >= 3 ? { status: 'pass', title: 'Photos recorded', explanation: `${photos.length} photos on file.` }
      : { status: photos.length ? 'warn' : 'fail', title: photos.length ? 'Add more photos' : 'Add photos', explanation: `${photos.length} photo${photos.length === 1 ? '' : 's'} on file. Real photos of the premises, team and work help customers choose.`, recommendation: 'Add at least 3 genuine photos (no stock images).' });
  const newest = Math.min(...d.media.map((m) => daysSince(m.addedAt, t)), Infinity);
  if (d.media.length) {
    add({ id: 'media-recent', category: 'media', weight: 2, severity: 'low', impact: 'low', effort: 'medium', field: 'media' },
      newest <= 180 ? { status: 'pass', title: 'Photos updated recently', explanation: `Newest image added ${fmtDays(newest)}.` }
        : { status: 'warn', title: 'No new photos in 6 months', explanation: `The newest image was added ${fmtDays(newest)}.`, recommendation: 'Add a few recent photos so the profile reflects the business today.' });
  }

  // ---- Consistency with the linked listing (data read from the provider's API) ----
  const L = input.listing;
  const s = L?.snapshot;
  if (!L) {
    add({ id: 'listing-consistency', category: 'consistency', weight: 0, severity: 'medium', impact: 'high', effort: 'low' },
      { status: 'unknown', title: 'Listing consistency not checked', explanation: 'No external listing is linked, so this audit could not compare the CRM record with what customers see on Google.', recommendation: 'Link the Google Business Profile location under “Listings” to check name, phone, address, website and hours for mismatches.' });
  } else if (!s) {
    add({ id: 'listing-consistency', category: 'consistency', weight: 0, severity: 'medium', impact: 'high', effort: 'low' },
      { status: 'unknown', title: 'Listing data not fetched', explanation: `A listing is linked (${L.title}) but its data hasn’t been read yet, so consistency could not be checked.`, recommendation: 'Click “Refresh from Google” under Listings.' });
  } else {
    const age = daysSince(L.snapshotAt, t);
    const asOf = L.snapshotAt ? ` (Google data from ${fmtDays(age)})` : '';
    if (age > STALE.snapshotDays) {
      add({ id: 'listing-snapshot-age', category: 'freshness', weight: 2, severity: 'low', impact: 'medium', effort: 'low' },
        { status: 'warn', title: 'Listing data is old', explanation: `The consistency checks below use Google data read ${fmtDays(age)}. The live listing may have changed since.`, recommendation: 'Refresh from Google before acting on mismatches.' });
    }
    const v = 'verified' as const;
    const cmp = (id: string, field: string, label: string, ok: boolean | null, crm: string | undefined, ext: string | undefined, weight: number, severity: Severity, opts: { warnOnly?: boolean; partial?: boolean } = {}) => {
      if (ok === null) return add({ id, category: 'consistency', weight: 0, severity, impact: 'high', effort: 'low', field }, { status: 'unknown', source: v, title: `${label}: not compared`, explanation: `${label} is missing on ${!crm ? 'the CRM record' : 'Google'}, so the two couldn’t be compared${asOf}.`, recommendation: !crm ? `Add the ${label.toLowerCase()} to the CRM record.` : `Add the ${label.toLowerCase()} to the Google listing (or publish it from here if supported).` });
      add({ id, category: 'consistency', weight, severity, impact: 'high', effort: 'low', field },
        ok ? { status: 'pass', source: v, title: `${label} matches Google`, explanation: `The CRM and Google Business Profile agree${asOf}.` }
          : { status: opts.warnOnly || opts.partial ? 'warn' : 'fail', source: v, title: `${label} differs from Google`, explanation: `The CRM has “${crm}” but Google shows “${ext}”${asOf}. Inconsistent details across listings confuse customers and directories.`, recommendation: 'Decide which value is correct. Update the CRM record, or publish the CRM value to Google from the Listings tab (where supported) or in Google Business Profile.', evidence: `CRM: ${crm} · Google: ${ext}` });
    };
    const sim = d.name && s.name ? nameSimilarity(d.name, s.name) : null;
    cmp('nap-name', 'name', 'Business name', sim === null ? null : sim >= 0.98, d.name, s.name, 6, 'high', { partial: sim !== null && sim >= 0.6 });
    cmp('nap-phone', 'phone', 'Phone number', d.phone && s.phone ? phoneKey(d.phone) === phoneKey(s.phone) : null, d.phone, s.phone, 6, 'high');
    cmp('nap-website', 'website', 'Website', d.website && s.website ? urlKey(d.website) === urlKey(s.website) : null, d.website, s.website, 4, 'medium');
    if (!d.hideAddress) {
      const crmLine = d.address?.line1; const extLine = s.addressLines?.[0];
      const sameLine = crmLine && extLine ? normalizeAddress(crmLine) === normalizeAddress(extLine) : null;
      const samePostal = !d.address?.postalCode || !s.postalCode || d.address.postalCode.replace(/\s/g, '').toLowerCase() === s.postalCode.replace(/\s/g, '').toLowerCase();
      cmp('nap-address', 'address', 'Address', sameLine === null ? null : sameLine && samePostal, crmLine ? [crmLine, d.address?.city, d.address?.postalCode].filter(Boolean).join(', ') : undefined, extLine ? [extLine, s.city, s.postalCode].filter(Boolean).join(', ') : undefined, 6, 'high');
    }
    cmp('category-match', 'primaryCategory', 'Primary category', d.primaryCategory && s.primaryCategory ? d.primaryCategory.trim().toLowerCase() === s.primaryCategory.trim().toLowerCase() : null, d.primaryCategory, s.primaryCategory, 4, 'medium', { warnOnly: true });
    if (setDays.length && s.hours) {
      const crmDay = (day: string) => { const h = d.hours[day as keyof typeof d.hours]; return !h || h.closed ? '' : h.periods.map((p) => `${p.open}-${p.close}`).sort().join(','); };
      const extDay = (day: string) => s.hours!.filter((p) => p.day === day).map((p) => `${p.open}-${p.close === '00:00' ? '24:00' : p.close}`).sort().join(',');
      const diff = DAYS.filter((day) => d.hours[day] && crmDay(day) !== extDay(day));
      add({ id: 'hours-match', category: 'consistency', weight: 5, severity: 'high', impact: 'high', effort: 'low', field: 'hours' },
        diff.length ? { status: 'fail', source: v, title: 'Hours differ from Google', explanation: `${diff.map(titleCase).join(', ')}: the CRM hours don’t match Google Business Profile${asOf}.`, recommendation: 'Confirm the correct hours with the business, then update whichever side is wrong. Hours are edited in Google Business Profile directly.', evidence: diff.map((day) => `${titleCase(day)} CRM ${crmDay(day) || 'closed'} · Google ${extDay(day) || 'closed'}`).join('; ') }
          : { status: 'pass', source: v, title: 'Hours match Google', explanation: `Weekly hours agree${asOf}.` });
    }
    if (desc && s.description !== undefined) {
      add({ id: 'description-published', category: 'consistency', weight: 2, severity: 'low', impact: 'medium', effort: 'low', field: 'description' },
        cleanCompare(desc) === cleanCompare(s.description || '') ? { status: 'pass', source: v, title: 'Description is published', explanation: `Google shows the same description${asOf}.` }
          : { status: 'warn', source: v, title: 'Description not yet published', explanation: `The description on Google differs from the CRM version${asOf}.`, recommendation: 'When the CRM version is approved, publish it from the Listings tab.' });
    }
  }

  // ---- Scores ----
  const scored = findings.filter((f) => f.status !== 'unknown' && f.weight > 0);
  const pts = (f: AuditFinding) => (f.status === 'pass' ? 1 : f.status === 'warn' ? 0.5 : 0);
  const score = scored.length ? Math.round((scored.reduce((a, f) => a + f.weight * pts(f), 0) / scored.reduce((a, f) => a + f.weight, 0)) * 100) : 0;
  const categoryScores: AuditResult['categoryScores'] = {};
  for (const cat of ['completeness', 'accuracy', 'content', 'freshness', 'media', 'consistency'] as FindingCategory[]) {
    const fs = scored.filter((f) => f.category === cat);
    if (fs.length) categoryScores[cat] = Math.round((fs.reduce((a, f) => a + f.weight * pts(f), 0) / fs.reduce((a, f) => a + f.weight, 0)) * 100);
  }
  const core = [d.name, d.primaryCategory, desc, d.phone, d.website, hasAddr || d.serviceAreas.length, setDays.length === 7, d.services.length, logo, cover || photos.length];
  const counts = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const f of findings) counts[f.status]++;
  const clean = findings.map(({ weight, ...f }) => f);
  const order: Record<FindingStatus, number> = { fail: 0, warn: 1, unknown: 2, pass: 3 };
  return {
    engineVersion: AUDIT_ENGINE_VERSION, ranAt: now.toISOString(), profileVersion: input.version, score,
    completeness: Math.round((core.filter(Boolean).length / core.length) * 100),
    coverage: Math.round((findings.filter((f) => f.status !== 'unknown').length / findings.length) * 100),
    categoryScores, counts,
    findings: clean.sort((a, b) => order[a.status] - order[b.status] || b.priority - a.priority),
    priorities: clean.filter((f) => f.status === 'fail' || f.status === 'warn').sort((a, b) => b.priority - a.priority || order[a.status] - order[b.status]),
    listing: L ? { provider: L.provider, externalId: L.externalId, snapshotAt: L.snapshotAt } : undefined,
  };
}

const cleanCompare = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Freshness labels for list views. */
export function staleFlags(p: Pick<BusinessProfile, 'hoursVerifiedAt' | 'lastReviewedAt' | 'lastAudit' | 'version' | 'listings'>, now = Date.now()): string[] {
  const out: string[] = [];
  if (daysSince(p.hoursVerifiedAt, now) > STALE.hoursDays) out.push('Hours not confirmed in 90 days');
  if (daysSince(p.lastReviewedAt, now) > STALE.reviewDays) out.push('Profile not reviewed in 6 months');
  const snap = p.listings[0]?.snapshotAt;
  if (p.listings[0] && daysSince(snap, now) > STALE.snapshotDays) out.push('Listing data older than 30 days');
  return out;
}
export const auditIsStale = (p: Pick<BusinessProfile, 'lastAudit' | 'version'>, now = Date.now()) =>
  !p.lastAudit || p.lastAudit.profileVersion !== p.version || daysSince(p.lastAudit.ranAt, now) > STALE.auditDays || p.lastAudit.engineVersion !== AUDIT_ENGINE_VERSION;
