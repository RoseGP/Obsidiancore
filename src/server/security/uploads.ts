/**
 * Shared checks for anything a user uploads. The file's type comes from its own bytes (magic numbers),
 * never from its name or the browser's claim, and only an allowlist of image/video types is accepted.
 *
 * Where uploads go today:
 *   /api/posts/upload, /api/media/upload   multipart, 25 MB, images/video → forwarded to the Social Planner
 *                                          gateway (not stored or served by this server)
 *   /api/billing (invoice logo, signature) PNG/JPEG data URLs inside the workspace document (≤ 750 KB decoded)
 *   /api/messaging/upload                  501 not_available until file storage is connected
 * Nothing uploaded is served from this server's origin, so an uploaded file can't run as a page or script here.
 */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export const MEDIA_TYPES = [...IMAGE_TYPES, 'video/mp4', 'video/quicktime'] as const;

/** Identifies supported media by magic bytes. Returns null for anything else (including SVG, HTML, PDF, scripts). */
export function sniffMediaType(b: Buffer): string | null {
  if (!b || b.length < 12) return null;
  const ascii = (from: number, to: number) => b.subarray(from, to).toString('latin1');
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 8) === 'ftyp') return ascii(8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4';
  return null;
}

/** A file name safe to pass on: no path, no control or shell characters, limited length. */
export function safeFileName(name: unknown, fallback = 'upload'): string {
  const base = String(name ?? '').split(/[\\/]/).pop() || '';
  const cleaned = base.normalize('NFKC').replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned || fallback;
}

/**
 * Validates an image data URL: declared type in `allowed`, decodes as base64, real bytes match the
 * declared type, and the decoded size is within `maxBytes`. Empty string is allowed (no image).
 */
export function validateImageDataUrl(v: string, opts: { allowed?: readonly string[]; maxBytes?: number } = {}): { ok: true } | { ok: false; reason: string } {
  if (v === '') return { ok: true };
  const allowed = opts.allowed ?? ['image/png', 'image/jpeg'];
  const maxBytes = opts.maxBytes ?? 750 * 1024;
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(v);
  if (!m) return { ok: false, reason: 'Images must be PNG or JPEG data URLs.' };
  if (!allowed.includes(m[1])) return { ok: false, reason: 'Images must be PNG or JPEG.' };
  const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (bytes.length > maxBytes) return { ok: false, reason: `Images must be ${Math.round(maxBytes / 1024)} KB or smaller.` };
  const real = sniffMediaType(bytes);
  if (real !== m[1]) return { ok: false, reason: 'The image file is damaged or isn’t really a PNG or JPEG.' };
  return { ok: true };
}
