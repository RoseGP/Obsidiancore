/**
 * Profile audit (pure). This app's own diagnostic of a Google Business Profile —
 * not a Google score, and not a ranking prediction. Every issue explains why it
 * matters and what to do; "expected benefit" is always an estimate.
 *
 * Inputs Google doesn't expose (or that failed to load) are passed as null and
 * reported as "not checked" instead of guessed; they don't count toward scores.
 */
import type { GLocation } from './googleGateway';

export type AuditArea = 'completeness' | 'localSeo' | 'infoQuality' | 'reputation' | 'content' | 'maintenance';
export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type Effort = 'quick' | 'moderate' | 'involved';
export type ActionType =
  | 'edit_description' | 'edit_contact' | 'edit_hours' | 'edit_special_hours' | 'edit_categories' | 'edit_services' | 'edit_attributes'
  | 'reply_reviews' | 'create_post' | 'add_photos' | 'review_google_updates' | 'verify_profile' | 'open_in_google' | 'request_reviews';

export const AREA_LABEL: Record<AuditArea, string> = {
  completeness: 'Profile completeness', localSeo: 'Local SEO optimization', infoQuality: 'Business information quality',
  reputation: 'Reputation management', content: 'Content quality', maintenance: 'Profile maintenance',
};
/** Overall score weights (sum 100). */
export const AREA_WEIGHT: Record<AuditArea, number> = { completeness: 20, localSeo: 20, infoQuality: 15, reputation: 25, content: 10, maintenance: 10 };

export interface AuditCheck {
  id: string;
  area: AuditArea;
  label: string;
  weight: number;
  status: 'passed' | 'failed' | 'not_checked';
  /** Present when failed. */
  issue?: {
    title: string;
    description: string;
    whyItMatters: string;
    solution: string;
    priority: Priority;
    effort: Effort;
    effortMinutes: number;
    /** Always phrased as an estimate. */
    expectedBenefit: string;
    action: { type: ActionType; label: string };
  };
  /** Why it couldn't be checked. */
  note?: string;
}

export interface AuditInputReview { rating: number; comment: string; createTime: string; reply?: { updateTime: string } }
export interface AuditInput {
  location: GLocation;
  reviews: AuditInputReview[];
  /** null = couldn't be read. */
  media: { photos: number; videos: number; latestAt: string | null; hasLogo: boolean; hasCover: boolean } | null;
  posts: { last30: number; latestAt: string | null } | null;
  attributes: { set: number; available: number } | null;
  verification: { state: string } | null;
  now?: Date;
}

export interface AuditResult {
  overall: number;
  areas: Record<AuditArea, number | null>;
  checks: AuditCheck[];
  issues: (AuditCheck & { issue: NonNullable<AuditCheck['issue']> })[];
  stats: { reviewCount: number; averageRating: number | null; responseRate: number | null; unanswered: number; unansweredNegative: number; medianReplyHours: number | null; photos: number | null; servicesCount: number; descriptionLength: number };
  notes: string[];
  generatedAt: string;
}

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const DAY = 86_400_000;

/** Signs of keyword stuffing in a business name (against Google's guidelines). */
export function nameStuffingSignals(title: string, city?: string, category?: string): string[] {
  const t = title.trim();
  const out: string[] = [];
  if (/[|•]|\s[-–—]\s/.test(t)) out.push('separators like “|” or “ - ” often add extra keywords');
  if (city && new RegExp(`\\b(in|near)\\s+${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) out.push(`“in/near ${city}” in the name`);
  if (/\b(best|top|#1|cheap|affordable|24\/7|near me)\b/i.test(t)) out.push('promotional words such as “best” or “near me”');
  if (category) {
    const words = category.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const hits = words.filter((w) => t.toLowerCase().includes(w)).length;
    if (t.split(/\s+/).length >= 7 && hits >= 1) out.push('a long name that repeats the category');
  }
  return out;
}

export function descriptionProblems(desc: string): string[] {
  const out: string[] = [];
  if (/https?:\/\/|www\./i.test(desc)) out.push('contains a link (Google doesn’t allow links in descriptions)');
  if (/(\+?\d[\d\s().-]{7,}\d)/.test(desc)) out.push('contains a phone number');
  if (/\b(sale|discount|% off|promo|coupon|deal)\b/i.test(desc)) out.push('reads like a promotion (Google asks for none in descriptions)');
  const caps = desc.match(/\b[A-Z]{4,}\b/g)?.length ?? 0;
  if (caps >= 3) out.push('uses a lot of capital letters');
  const words = desc.toLowerCase().match(/[a-z']{4,}/g) ?? [];
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const max = Math.max(0, ...freq.values());
  if (words.length >= 30 && max / words.length > 0.08) out.push('repeats the same word many times');
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function runAudit(input: AuditInput): AuditResult {
  const now = input.now ?? new Date();
  const l = input.location;
  const desc = (l.description ?? '').trim();
  const city = l.address?.city;
  const services = l.serviceItems ?? [];
  const reviews = input.reviews;
  const replied = reviews.filter((r) => r.reply);
  const negatives = reviews.filter((r) => r.rating <= 3);
  const unansweredNegative = negatives.filter((r) => !r.reply).length;
  const avg = reviews.length ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10 : null;
  const responseRate = reviews.length ? replied.length / reviews.length : null;
  const replyHours = replied.map((r) => (Date.parse(r.reply!.updateTime) - Date.parse(r.createTime)) / 3_600_000).filter((h) => Number.isFinite(h) && h >= 0);
  const medianReplyHours = median(replyHours);
  const latestReview = reviews.reduce<string | null>((m, r) => (!m || r.createTime > m ? r.createTime : m), null);
  const checks: AuditCheck[] = [];

  const add = (c: Omit<AuditCheck, 'status' | 'issue'> & { passed: boolean | null; note?: string; issue?: AuditCheck['issue'] }) => {
    const status = c.passed === null ? 'not_checked' : c.passed ? 'passed' : 'failed';
    checks.push({ id: c.id, area: c.area, label: c.label, weight: c.weight, status, ...(status === 'failed' && c.issue ? { issue: c.issue } : {}), ...(c.note ? { note: c.note } : {}) });
  };
  const est = (s: string) => `Estimate: ${s} Results vary and aren’t guaranteed.`;

  // ---------- Completeness ----------
  add({ id: 'name', area: 'completeness', label: 'Business name', weight: 4, passed: !!l.title.trim() });
  add({ id: 'address', area: 'completeness', label: 'Address or service area', weight: 5, passed: !!l.address?.lines?.length || !!l.hasServiceArea });
  add({ id: 'phone', area: 'completeness', label: 'Primary phone', weight: 6, passed: !!l.phone, issue: {
    title: 'Add a phone number', description: 'Your profile has no phone number.', whyItMatters: 'Calls are one of the main actions customers take from a Business Profile. Without a number, they can’t reach you from search or Maps.',
    solution: 'Add the number you actually answer for this location.', priority: 'high', effort: 'quick', effortMinutes: 2,
    expectedBenefit: est('customers who want to call can do so directly from the profile.'), action: { type: 'edit_contact', label: 'Add phone' } } });
  add({ id: 'website', area: 'completeness', label: 'Website link', weight: 5, passed: !!l.website, issue: {
    title: 'Add your website', description: 'There’s no website link on the profile.', whyItMatters: 'A website lets customers check services, prices and book before contacting you.',
    solution: 'Link the page that best matches this location (a location page beats a generic home page for multi-location businesses).', priority: 'medium', effort: 'quick', effortMinutes: 2,
    expectedBenefit: est('more website visits from people who found you on Google.'), action: { type: 'edit_contact', label: 'Add website' } } });
  add({ id: 'category', area: 'completeness', label: 'Primary category', weight: 8, passed: !!l.primaryCategory, issue: {
    title: 'Choose a primary category', description: 'No primary category is set.', whyItMatters: 'Google uses the primary category to decide which searches your business is relevant for.',
    solution: 'Pick the single category that best describes your core business.', priority: 'critical', effort: 'quick', effortMinutes: 3,
    expectedBenefit: est('your profile can appear for searches matching what you do.'), action: { type: 'edit_categories', label: 'Choose category' } } });
  add({ id: 'description', area: 'completeness', label: 'Business description', weight: 6, passed: desc.length > 0, issue: {
    title: 'Add a business description', description: 'The description is empty.', whyItMatters: 'The description is where customers learn what makes you different, in your own words.',
    solution: 'Write 250–750 characters about your real services, who you serve and where. No links, prices or promotions.', priority: 'high', effort: 'quick', effortMinutes: 10,
    expectedBenefit: est('clearer first impression for people comparing businesses.'), action: { type: 'edit_description', label: 'Write description' } } });
  add({ id: 'hours', area: 'completeness', label: 'Opening hours', weight: 7, passed: l.regularHours.length > 0, issue: {
    title: 'Add opening hours', description: 'No regular hours are set.', whyItMatters: 'Customers check hours before visiting or calling; missing hours make people pick a competitor whose hours they can see.',
    solution: 'Set hours for every day you’re open, and mark the others closed.', priority: 'high', effort: 'quick', effortMinutes: 5,
    expectedBenefit: est('fewer wasted trips and more visits while you’re open.'), action: { type: 'edit_hours', label: 'Set hours' } } });
  add({ id: 'services', area: 'completeness', label: 'Services listed', weight: 5, passed: services.length > 0, issue: {
    title: 'List your services', description: 'No services are on the profile.', whyItMatters: 'Services show customers exactly what you offer and help Google match you to specific searches.',
    solution: 'Add each service you genuinely provide, with a short description.', priority: 'medium', effort: 'moderate', effortMinutes: 20,
    expectedBenefit: est('relevance for searches about specific services.'), action: { type: 'edit_services', label: 'Add services' } } });
  add({ id: 'photos', area: 'completeness', label: 'Photos', weight: 5, passed: input.media ? input.media.photos > 0 : null, note: input.media ? undefined : 'Photos couldn’t be read from Google.', issue: {
    title: 'Add photos', description: 'There are no photos on the profile.', whyItMatters: 'Photos are often the first thing people look at when choosing between businesses.',
    solution: 'Add a logo, a cover photo, and real photos of your work, team and premises.', priority: 'high', effort: 'moderate', effortMinutes: 20,
    expectedBenefit: est('more people engaging with your profile.'), action: { type: 'add_photos', label: 'Add photos in Google' } } });
  add({ id: 'logo_cover', area: 'completeness', label: 'Logo and cover photo', weight: 2, passed: input.media ? input.media.hasLogo && input.media.hasCover : null, note: input.media ? undefined : 'Photos couldn’t be read from Google.', issue: {
    title: 'Add a logo and cover photo', description: `Missing: ${[!input.media?.hasLogo && 'logo', !input.media?.hasCover && 'cover photo'].filter(Boolean).join(' and ')}.`, whyItMatters: 'A recognisable logo and a strong cover photo make your profile look established and trustworthy.',
    solution: 'Upload a square logo and a landscape cover photo.', priority: 'low', effort: 'quick', effortMinutes: 5,
    expectedBenefit: est('a more professional-looking profile.'), action: { type: 'add_photos', label: 'Add in Google' } } });

  // ---------- Local SEO ----------
  const stuffing = nameStuffingSignals(l.title, city, l.primaryCategory);
  add({ id: 'name_clean', area: 'localSeo', label: 'Name matches the real business name', weight: 6, passed: stuffing.length === 0, issue: {
    title: 'Check your business name for extra keywords', description: `The name may include extra keywords: ${stuffing.join('; ')}.`, whyItMatters: 'Google’s guidelines require your real-world business name. Adding keywords can lead to edits or suspension.',
    solution: 'Use exactly the name on your signage and documents. Put services and locations in the description and services instead.', priority: 'high', effort: 'quick', effortMinutes: 5,
    expectedBenefit: est('lower risk of Google editing or suspending the profile.'), action: { type: 'open_in_google', label: 'Review name in Google' } } });
  add({ id: 'desc_length', area: 'localSeo', label: 'Description is 250–750 characters', weight: 5, passed: desc.length === 0 ? null : desc.length >= 250, note: desc.length === 0 ? 'No description yet (see Completeness).' : undefined, issue: {
    title: 'Expand your description', description: `It’s ${desc.length} characters; up to 750 are allowed.`, whyItMatters: 'A fuller description gives customers and Google more context about your services and area.',
    solution: 'Add your main services, who you help, and the area you serve, in natural sentences.', priority: 'medium', effort: 'quick', effortMinutes: 10,
    expectedBenefit: est('better understanding of what you offer.'), action: { type: 'edit_description', label: 'Improve description' } } });
  add({ id: 'desc_local', area: 'localSeo', label: 'Description mentions your area', weight: 3, passed: !desc || !city ? null : new RegExp(city, 'i').test(desc), note: !city ? 'No city on the profile to compare.' : !desc ? 'No description yet.' : undefined, issue: {
    title: 'Mention the area you serve', description: `The description doesn’t mention ${city}.`, whyItMatters: 'Naturally mentioning your city or neighbourhood helps people confirm you serve them.',
    solution: `Mention ${city} once, naturally, e.g. “serving families across ${city}”.`, priority: 'low', effort: 'quick', effortMinutes: 3,
    expectedBenefit: est('clearer local relevance.'), action: { type: 'edit_description', label: 'Improve description' } } });
  add({ id: 'additional_categories', area: 'localSeo', label: 'Relevant additional categories', weight: 4, passed: l.additionalCategories.length > 0, issue: {
    title: 'Review additional categories', description: 'Only a primary category is set.', whyItMatters: 'Accurate additional categories can make you eligible for more relevant searches.',
    solution: 'Add categories only for services you genuinely offer. Skip ones that don’t fit.', priority: 'medium', effort: 'quick', effortMinutes: 5,
    expectedBenefit: est('eligibility for more relevant searches.'), action: { type: 'edit_categories', label: 'Review categories' } } });
  add({ id: 'services_depth', area: 'localSeo', label: 'At least 5 services', weight: 4, passed: services.length === 0 ? null : services.length >= 5, note: services.length === 0 ? 'No services yet (see Completeness).' : undefined, issue: {
    title: 'Add more of your services', description: `${services.length} service${services.length === 1 ? '' : 's'} listed.`, whyItMatters: 'Each real service you list is another way customers can find exactly what they need.',
    solution: 'List every service you offer, one per item, with a short description.', priority: 'low', effort: 'moderate', effortMinutes: 15,
    expectedBenefit: est('relevance for more specific searches.'), action: { type: 'edit_services', label: 'Add services' } } });
  add({ id: 'attributes', area: 'localSeo', label: 'Attributes filled in', weight: 4, passed: input.attributes ? input.attributes.available === 0 || input.attributes.set / input.attributes.available >= 0.4 : null, note: input.attributes ? undefined : 'Attributes couldn’t be read from Google.', issue: {
    title: 'Fill in more attributes', description: `${input.attributes?.set ?? 0} of ${input.attributes?.available ?? 0} available attributes are set.`, whyItMatters: 'Attributes (like accessibility or payment options) answer common questions and appear on your profile.',
    solution: 'Set every attribute that’s true for your business.', priority: 'low', effort: 'quick', effortMinutes: 10,
    expectedBenefit: est('customers find the details they need faster.'), action: { type: 'edit_attributes', label: 'Edit attributes' } } });

  // ---------- Information quality ----------
  const digits = (l.phone ?? '').replace(/\D/g, '');
  add({ id: 'phone_format', area: 'infoQuality', label: 'Phone number looks valid', weight: 3, passed: !l.phone ? null : digits.length >= 7 && digits.length <= 15, note: !l.phone ? 'No phone yet.' : undefined, issue: {
    title: 'Check the phone number', description: `“${l.phone}” doesn’t look like a complete number.`, whyItMatters: 'A wrong number sends customers nowhere.', solution: 'Enter the full number including the area code.',
    priority: 'high', effort: 'quick', effortMinutes: 2, expectedBenefit: est('calls reach you.'), action: { type: 'edit_contact', label: 'Fix phone' } } });
  add({ id: 'website_https', area: 'infoQuality', label: 'Website uses https', weight: 3, passed: !l.website ? null : l.website.startsWith('https://'), note: !l.website ? 'No website yet.' : undefined, issue: {
    title: 'Use a secure (https) website link', description: 'The website link starts with http://.', whyItMatters: 'Browsers warn visitors about insecure sites, which puts people off.',
    solution: 'Enable https on your site and update the link.', priority: 'medium', effort: 'moderate', effortMinutes: 30, expectedBenefit: est('fewer visitors leaving at a browser warning.'), action: { type: 'edit_contact', label: 'Update website' } } });
  add({ id: 'website_owned', area: 'infoQuality', label: 'Website is your own site', weight: 2, passed: !l.website ? null : !/(facebook|instagram|linktr\.ee|yelp)\./i.test(l.website), note: !l.website ? 'No website yet.' : undefined, issue: {
    title: 'Link your own website', description: 'The website link points to a social or directory page.', whyItMatters: 'Your own site is where you control the information customers see.',
    solution: 'Link your own website if you have one; a simple one-page site works.', priority: 'low', effort: 'involved', effortMinutes: 120, expectedBenefit: est('more control over what customers see.'), action: { type: 'edit_contact', label: 'Update website' } } });
  const dProblems = desc ? descriptionProblems(desc) : [];
  add({ id: 'desc_quality', area: 'infoQuality', label: 'Description follows Google’s guidelines', weight: 4, passed: !desc ? null : dProblems.length === 0, note: !desc ? 'No description yet.' : undefined, issue: {
    title: 'Clean up the description', description: `The description ${dProblems.join('; ')}.`, whyItMatters: 'Google may reject or remove descriptions that break its content guidelines.',
    solution: 'Remove links, phone numbers and promotions; write naturally without repeating keywords.', priority: 'medium', effort: 'quick', effortMinutes: 10,
    expectedBenefit: est('the description stays visible.'), action: { type: 'edit_description', label: 'Fix description' } } });
  const badHours = l.regularHours.filter((h) => h.open === h.close && h.open !== '00:00');
  add({ id: 'hours_sane', area: 'infoQuality', label: 'Hours look correct', weight: 3, passed: l.regularHours.length === 0 ? null : badHours.length === 0, note: l.regularHours.length === 0 ? 'No hours yet.' : undefined, issue: {
    title: 'Check your opening hours', description: `${badHours.length} period${badHours.length === 1 ? '' : 's'} open and close at the same time.`, whyItMatters: 'Wrong hours lead to frustrated customers and negative reviews.',
    solution: 'Correct the opening and closing times.', priority: 'high', effort: 'quick', effortMinutes: 5, expectedBenefit: est('fewer visits when you’re closed.'), action: { type: 'edit_hours', label: 'Fix hours' } } });
  add({ id: 'duplicate', area: 'infoQuality', label: 'No duplicate listing flagged', weight: 3, passed: !l.meta?.duplicateLocation, issue: {
    title: 'Resolve a duplicate listing', description: 'Google flags this location as a duplicate of another listing.', whyItMatters: 'Duplicates split your reviews and confuse customers.',
    solution: 'Ask Google to merge or remove the duplicate from Business Profile support.', priority: 'high', effort: 'involved', effortMinutes: 30, expectedBenefit: est('all reviews and activity in one place.'), action: { type: 'open_in_google', label: 'Open in Google' } } });

  // ---------- Reputation ----------
  add({ id: 'review_count', area: 'reputation', label: 'At least 10 reviews', weight: 4, passed: reviews.length >= 10, issue: {
    title: 'Ask happy customers for reviews', description: `${reviews.length} review${reviews.length === 1 ? '' : 's'} synced.`, whyItMatters: 'People trust businesses with more recent reviews.',
    solution: 'Share your review link after a good experience. Never offer incentives or post reviews yourself, which break Google’s policies.', priority: 'medium', effort: 'moderate', effortMinutes: 15,
    expectedBenefit: est('more social proof over time.'), action: { type: 'request_reviews', label: 'Get review link' } } });
  add({ id: 'unanswered_negative', area: 'reputation', label: 'Every negative review has a reply', weight: 8, passed: unansweredNegative === 0, issue: {
    title: `Reply to ${unansweredNegative} negative review${unansweredNegative === 1 ? '' : 's'}`, description: 'Reviews of 3 stars or less have no reply.', whyItMatters: 'Future customers read how you respond to criticism; a calm, helpful reply can reassure them.',
    solution: 'Acknowledge the issue, apologise where appropriate, and invite them to contact you directly.', priority: 'critical', effort: 'quick', effortMinutes: 5 * Math.max(1, unansweredNegative),
    expectedBenefit: est('better impression on people reading your reviews.'), action: { type: 'reply_reviews', label: 'Reply now' } } });
  add({ id: 'response_rate', area: 'reputation', label: 'Reply to at least 80% of reviews', weight: 6, passed: responseRate === null ? null : responseRate >= 0.8, note: responseRate === null ? 'No reviews yet.' : undefined, issue: {
    title: 'Reply to more reviews', description: `You’ve replied to ${Math.round((responseRate ?? 0) * 100)}% of reviews.`, whyItMatters: 'Replying shows you value feedback and are active.',
    solution: 'Reply to recent reviews first, thanking people by name for specifics they mentioned.', priority: 'high', effort: 'quick', effortMinutes: 10,
    expectedBenefit: est('customers see an engaged business.'), action: { type: 'reply_reviews', label: 'Reply to reviews' } } });
  add({ id: 'reply_speed', area: 'reputation', label: 'Typical reply within 2 days', weight: 3, passed: medianReplyHours === null ? null : medianReplyHours <= 48, note: medianReplyHours === null ? 'No replies to measure yet.' : undefined, issue: {
    title: 'Reply faster', description: `Your typical reply comes after ${Math.round((medianReplyHours ?? 0) / 24)} days.`, whyItMatters: 'Quick replies, especially to complaints, show you take customers seriously.',
    solution: 'Turn on review alerts and reply within a day or two.', priority: 'low', effort: 'quick', effortMinutes: 5, expectedBenefit: est('more timely conversations with customers.'), action: { type: 'reply_reviews', label: 'Open reviews' } } });
  add({ id: 'rating', area: 'reputation', label: 'Average rating 4.0 or higher', weight: 5, passed: avg === null ? null : avg >= 4, note: avg === null ? 'No reviews yet.' : undefined, issue: {
    title: 'Address recurring complaints', description: `Average rating is ${avg} from synced reviews.`, whyItMatters: 'Ratings strongly affect which business people choose.',
    solution: 'Look at recurring complaint topics on the Reviews page and fix the underlying issue. Never remove or manipulate genuine reviews.', priority: 'high', effort: 'involved', effortMinutes: 60,
    expectedBenefit: est('better reviews as the underlying issues get fixed.'), action: { type: 'reply_reviews', label: 'See complaint themes' } } });
  add({ id: 'recent_review', area: 'reputation', label: 'A review in the last 60 days', weight: 3, passed: !latestReview ? false : now.getTime() - Date.parse(latestReview) <= 60 * DAY, issue: {
    title: 'Get fresh reviews', description: latestReview ? `The latest review is ${Math.round((now.getTime() - Date.parse(latestReview)) / DAY)} days old.` : 'There are no reviews yet.', whyItMatters: 'Recent reviews tell people your business is active today.',
    solution: 'Ask recent customers for a review using your review link.', priority: 'medium', effort: 'moderate', effortMinutes: 10, expectedBenefit: est('a profile that looks current.'), action: { type: 'request_reviews', label: 'Get review link' } } });

  // ---------- Content ----------
  add({ id: 'posts_recent', area: 'content', label: 'A Google post in the last 30 days', weight: 5, passed: input.posts ? input.posts.last30 > 0 : null, note: input.posts ? undefined : 'Posts couldn’t be read from Google.', issue: {
    title: 'Publish a Google post', description: input.posts?.latestAt ? `Last post was ${Math.round((now.getTime() - Date.parse(input.posts.latestAt)) / DAY)} days ago.` : 'No posts found.', whyItMatters: 'Posts share news, offers and events right on your profile.',
    solution: 'Publish a short update, offer or event every week or two.', priority: 'medium', effort: 'quick', effortMinutes: 10, expectedBenefit: est('more reasons for people to engage with your profile.'), action: { type: 'create_post', label: 'Create post' } } });
  add({ id: 'photo_count', area: 'content', label: 'At least 10 photos', weight: 3, passed: input.media ? input.media.photos >= 10 : null, note: input.media ? undefined : 'Photos couldn’t be read from Google.', issue: {
    title: 'Add more photos', description: `${input.media?.photos ?? 0} photos on the profile.`, whyItMatters: 'A range of real photos helps customers picture the experience.',
    solution: 'Add photos of your work, interior, exterior and team.', priority: 'low', effort: 'moderate', effortMinutes: 20, expectedBenefit: est('more profile engagement.'), action: { type: 'add_photos', label: 'Add in Google' } } });
  add({ id: 'photo_recent', area: 'content', label: 'A new photo in the last 90 days', weight: 2, passed: input.media ? !!input.media.latestAt && now.getTime() - Date.parse(input.media.latestAt) <= 90 * DAY : null, note: input.media ? undefined : 'Photos couldn’t be read from Google.', issue: {
    title: 'Add a recent photo', description: input.media?.latestAt ? `Newest photo is ${Math.round((now.getTime() - Date.parse(input.media.latestAt)) / DAY)} days old.` : 'No photos yet.', whyItMatters: 'Fresh photos show the business as it is today.',
    solution: 'Add a few current photos.', priority: 'low', effort: 'quick', effortMinutes: 10, expectedBenefit: est('a more current-looking profile.'), action: { type: 'add_photos', label: 'Add in Google' } } });
  add({ id: 'video', area: 'content', label: 'At least one video', weight: 1, passed: input.media ? input.media.videos > 0 : null, note: input.media ? undefined : 'Media couldn’t be read from Google.', issue: {
    title: 'Add a short video', description: 'No videos on the profile.', whyItMatters: 'A short video can show your space or work better than photos.',
    solution: 'Upload a 30-second clip of your premises or work.', priority: 'low', effort: 'moderate', effortMinutes: 20, expectedBenefit: est('richer profile content.'), action: { type: 'add_photos', label: 'Add in Google' } } });
  const described = services.filter((s) => (s.description ?? '').trim().length >= 20).length;
  add({ id: 'service_descriptions', area: 'content', label: 'Services have descriptions', weight: 2, passed: services.length === 0 ? null : described / services.length >= 0.5, note: services.length === 0 ? 'No services yet.' : undefined, issue: {
    title: 'Describe your services', description: `${described} of ${services.length} services have a description.`, whyItMatters: 'Descriptions answer customers’ questions before they call.',
    solution: 'Add one or two plain sentences to each service.', priority: 'low', effort: 'moderate', effortMinutes: 15, expectedBenefit: est('fewer basic questions, more confident customers.'), action: { type: 'edit_services', label: 'Edit services' } } });

  // ---------- Maintenance ----------
  const verified = input.verification ? input.verification.state === 'verified' : (l.meta?.hasVoiceOfMerchant ?? null);
  add({ id: 'verified', area: 'maintenance', label: 'Profile verified', weight: 5, passed: verified, note: verified === null ? 'Verification status couldn’t be read.' : undefined, issue: {
    title: 'Verify your profile', description: `Google reports: ${input.verification?.state.replace(/_/g, ' ') ?? 'not verified'}.`, whyItMatters: 'Unverified profiles can’t be fully managed and may not show your edits.',
    solution: 'Complete verification in Google Business Profile.', priority: 'critical', effort: 'involved', effortMinutes: 30, expectedBenefit: est('full control of the profile.'), action: { type: 'verify_profile', label: 'Verify in Google' } } });
  const upcoming = (l.specialHours ?? []).some((p) => Date.parse(p.endDate) >= now.getTime() - DAY);
  add({ id: 'special_hours', area: 'maintenance', label: 'Upcoming holiday hours set', weight: 3, passed: upcoming, issue: {
    title: 'Add holiday hours', description: 'No special hours are set for upcoming dates.', whyItMatters: 'Holiday hours prevent wasted trips and “it was closed” reviews.',
    solution: 'Add special hours for upcoming public holidays or closures.', priority: 'medium', effort: 'quick', effortMinutes: 5, expectedBenefit: est('fewer wasted trips on holidays.'), action: { type: 'edit_special_hours', label: 'Add holiday hours' } } });
  add({ id: 'google_updates', area: 'maintenance', label: 'No unreviewed changes by Google', weight: 3, passed: l.meta ? !l.meta.hasGoogleUpdated : null, note: l.meta ? undefined : 'Profile metadata unavailable.', issue: {
    title: 'Review changes Google made', description: 'Google changed some information on your profile (for example from user suggestions).', whyItMatters: 'Google sometimes applies edits from other sources; wrong ones mislead customers.',
    solution: 'Compare Google’s version with yours and keep or correct each field.', priority: 'high', effort: 'quick', effortMinutes: 5, expectedBenefit: est('your information stays accurate.'), action: { type: 'review_google_updates', label: 'Review changes' } } });
  add({ id: 'open_status', area: 'maintenance', label: 'Marked as open', weight: 2, passed: !l.openStatus ? null : l.openStatus === 'OPEN', note: !l.openStatus ? 'Open status not reported.' : undefined, issue: {
    title: 'Check your open status', description: `Google shows this location as ${l.openStatus?.toLowerCase().replace(/_/g, ' ')}.`, whyItMatters: 'If you’re open, a closed status hides you from many customers.',
    solution: 'If you’ve reopened, update the status in Google.', priority: 'critical', effort: 'quick', effortMinutes: 2, expectedBenefit: est('customers know you’re open.'), action: { type: 'open_in_google', label: 'Open in Google' } } });

  // ---------- Scores ----------
  const areas = {} as Record<AuditArea, number | null>;
  for (const area of Object.keys(AREA_WEIGHT) as AuditArea[]) {
    const scored = checks.filter((c) => c.area === area && c.status !== 'not_checked');
    const total = scored.reduce((a, c) => a + c.weight, 0);
    areas[area] = total ? Math.round((scored.filter((c) => c.status === 'passed').reduce((a, c) => a + c.weight, 0) / total) * 100) : null;
  }
  const known = (Object.keys(areas) as AuditArea[]).filter((a) => areas[a] !== null);
  const wsum = known.reduce((a, k) => a + AREA_WEIGHT[k], 0);
  const overall = wsum ? Math.round(known.reduce((a, k) => a + (areas[k]! * AREA_WEIGHT[k]), 0) / wsum) : 0;
  const issues = checks.filter((c): c is AuditCheck & { issue: NonNullable<AuditCheck['issue']> } => c.status === 'failed' && !!c.issue)
    .sort((a, b) => PRIORITY_RANK[a.issue.priority] - PRIORITY_RANK[b.issue.priority] || b.weight - a.weight);

  const notes = ['Products can’t be read through Google’s API. Check them in Google Business Profile.'];
  { const n = checks.filter((c) => c.status === 'not_checked').length; if (n) notes.push(n === 1 ? '1 check couldn’t be run and doesn’t count toward the score.' : `${n} checks couldn’t be run and don’t count toward the score.`); }

  return {
    overall, areas, checks, issues,
    stats: { reviewCount: reviews.length, averageRating: avg, responseRate, unanswered: reviews.length - replied.length, unansweredNegative, medianReplyHours, photos: input.media?.photos ?? null, servicesCount: services.length, descriptionLength: desc.length },
    notes, generatedAt: now.toISOString(),
  };
}
