import { PLATFORMS, type ConnectedAccount, type PlatformId } from './model';

export interface PostDraft {
  content: string;
  platforms: PlatformId[];
  scheduledAt: string | null; // ISO
  mediaUrls: string[];
  /** 'now' publishes immediately: no date needed, but every platform rule applies. */
  intent: 'draft' | 'scheduled' | 'now';
}

export interface ValidationResult {
  errors: Partial<Record<'content' | 'platforms' | 'scheduledAt' | 'mediaUrls', string>>;
  warnings: string[];
}

const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

/**
 * Drafts only need content and a date. Scheduling also enforces platform
 * limits, media requirements and a future time.
 */
export function validatePost(d: PostDraft, ctx: { now: Date; accounts: ConnectedAccount[] | null }): ValidationResult {
  const errors: ValidationResult['errors'] = {};
  const warnings: string[] = [];
  const strict = d.intent === 'scheduled' || d.intent === 'now';
  const text = d.content.trim();

  if (!text) errors.content = 'Write something to post.';
  else if (strict) {
    const over = d.platforms.filter((p) => text.length > PLATFORMS[p].charLimit);
    if (over.length) {
      const tightest = over.reduce((a, b) => (PLATFORMS[a].charLimit < PLATFORMS[b].charLimit ? a : b));
      errors.content = `${PLATFORMS[tightest].label} allows ${PLATFORMS[tightest].charLimit.toLocaleString()} characters. This post has ${text.length.toLocaleString()}.`;
    }
  }

  if (d.platforms.length === 0) errors.platforms = 'Choose at least one platform.';

  if (d.intent === 'now') { /* publishes immediately: the date field is ignored */ }
  else if (!d.scheduledAt) errors.scheduledAt = 'Choose a date and time.';
  else if (strict && new Date(d.scheduledAt).getTime() < ctx.now.getTime() + 60_000) {
    errors.scheduledAt = 'Pick a time in the future to schedule.';
  }

  const badUrl = d.mediaUrls.find((u) => !URL_RE.test(u.trim()));
  if (badUrl) errors.mediaUrls = 'Media links must start with http:// or https://';

  const needsMedia = d.platforms.filter((p) => PLATFORMS[p].requiresMedia);
  if (needsMedia.length && d.mediaUrls.length === 0) {
    const names = needsMedia.map((p) => PLATFORMS[p].label).join(' and ');
    if (strict) errors.mediaUrls = `${names} ${needsMedia.length > 1 ? 'need' : 'needs'} an image or video.`;
    else warnings.push(`${names} will need an image or video before you schedule.`);
  }

  if (ctx.accounts) {
    const connected = new Set(ctx.accounts.map((a) => a.platform));
    const missing = d.platforms.filter((p) => !connected.has(p));
    if (missing.length) warnings.push(`No connected account for ${missing.map((p) => PLATFORMS[p].label).join(', ')}. Connect one in Accounts before it publishes.`);
  }
  const manual = d.platforms.filter((p) => !PLATFORMS[p].autoPublish);
  if (manual.length && strict) {
    warnings.push(`Auto-publishing isn’t available for ${manual.map((p) => PLATFORMS[p].label).join(', ')} yet. Those posts are saved to the calendar for you to publish.`);
  }
  return { errors, warnings };
}

export const hasErrors = (r: ValidationResult) => Object.keys(r.errors).length > 0;
