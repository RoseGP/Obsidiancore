/**
 * Posts — /api/posts (application routes; Postiz mapping in features/social-accounts/server/postiz)
 *
 *   GET    /?from&to   posts on the current user's channels in a date range   → GET  /public/v1/posts
 *   POST   /           create: schedule, post now or save draft (mode)       → POST /public/v1/upload-from-url, /public/v1/posts
 *   POST   /upload     multipart file (also at /api/media/upload)            → POST /public/v1/upload
 *   PATCH  /:id        edit content, time, media or draft state               → POST /public/v1/posts (group + id = update)
 *   DELETE /:id        delete (Postiz removes the whole post group)           → DELETE /public/v1/posts/:id
 *
 * Mounted before the legacy router in src/routes/posts.ts; other paths fall through to it.
 */
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireUser, type AuthedRequest } from '../features/social-accounts/server/auth';
import { csrfGuard, rateLimit, sendError, userKey } from '../features/social-accounts/server/http';
import { config, posts } from '../features/social-accounts/server/instance';
import { PLATFORM_DEFINITIONS } from '../features/social-accounts/shared/types';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});
const guard = [requireUser, csrfGuard(config.appUrl), rateLimit({ name: 'posts', windowMs: 60_000, max: 120, key: userKey })];
// File uploads are multipart; same origin check, otherwise identical.
const uploadGuard = [requireUser, csrfGuard(config.appUrl, { allowMultipart: true }), rateLimit({ name: 'posts', windowMs: 60_000, max: 120, key: userKey })];
const writeLimit = rateLimit({ name: 'posts-write', windowMs: 60_000, max: 30, key: userKey });

const iso = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'Use an ISO date.');
const httpsUrl = z.string().max(2048).url().refine((u) => u.startsWith('https://'), 'Media links must use https://');
const platform = z.enum(PLATFORM_DEFINITIONS.map((d) => d.platform) as [string, ...string[]]);
const id = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/, 'Invalid id.');

const createBody = z.object({
  content: z.string().trim().min(1, 'Write something to post.').max(63206),
  scheduledAt: iso,
  mode: z.enum(['draft', 'schedule', 'now']).default('schedule'),
  accountIds: z.array(id).max(20).optional(),
  platforms: z.array(platform).max(20).optional(),
  mediaUrls: z.array(httpsUrl).max(10).default([]),
}).strict().refine((b) => (b.accountIds?.length ?? 0) + (b.platforms?.length ?? 0) > 0, { message: 'Choose at least one account.', path: ['accountIds'] })
  .refine((b) => b.mode !== 'schedule' || Date.parse(b.scheduledAt) > Date.now() + 30_000, { message: 'Pick a time in the future to schedule.', path: ['scheduledAt'] });

const updateBody = z.object({
  content: z.string().trim().min(1).max(63206).optional(),
  scheduledAt: iso.optional(),
  mode: z.enum(['draft', 'schedule']).optional(),
  mediaUrls: z.array(httpsUrl).max(10).optional(),
}).strict().refine((b) => Object.keys(b).length > 0, 'Nothing to change.')
  .refine((b) => !b.scheduledAt || b.mode === 'draft' || Date.parse(b.scheduledAt) > Date.now() + 30_000, { message: 'Pick a time in the future to schedule.', path: ['scheduledAt'] });

const rangeQuery = z.object({ from: iso, to: iso }).refine((r) => Date.parse(r.to) > Date.parse(r.from) && Date.parse(r.to) - Date.parse(r.from) <= 400 * 86_400_000, 'Use a range of at most 400 days.');

const uid = (req: AuthedRequest) => req.accountUser!.id;

/** Identifies supported media by magic bytes. Returns null for anything else. */
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

const normalizeCreate = (raw: any) => {
  const b = { ...(raw ?? {}) };
  if (!b.accountIds && Array.isArray(b.integrations)) {
    b.accountIds = b.integrations;
    delete b.integrations;
  }
  if (!b.mode && b.type) {
    b.mode = b.type;
    delete b.type;
  }
  // "Post now" is Postiz's own `type: "now"`; the publish time is set by the server.
  if (b.mode === 'now') b.scheduledAt = new Date().toISOString();
  if (!b.scheduledAt && b.mode === 'schedule') {
    b.scheduledAt = new Date(Date.now() + 60_000).toISOString();
  }
  if (!b.mediaUrls && Array.isArray(b.media)) {
    b.mediaUrls = b.media.map((m: any) => (typeof m === 'string' ? m : m?.url || m?.path)).filter(Boolean);
    delete b.media;
  }
  return b;
};

const handleCreate = async (req: AuthedRequest, res: any) => {
  try {
    const parsed = createBody.parse(normalizeCreate(req.body));
    const created = await posts.create(uid(req), parsed as any);
    res.status(201).json({ posts: created, post: created[0] });
  } catch (err) {
    sendError(res, err, 'create post');
  }
};

router.get('/', ...guard, async (req: AuthedRequest, res) => {
  try {
    const fromParam = (req.query.from || req.query.startDate || new Date(Date.now() - 30 * 86_400_000).toISOString()) as string;
    const toParam = (req.query.to || req.query.endDate || new Date(Date.now() + 60 * 86_400_000).toISOString()) as string;
    const r = rangeQuery.parse({ from: fromParam, to: toParam });
    res.json({ posts: await posts.list(uid(req), r) });
  } catch (err) { sendError(res, err, 'list posts'); }
});

router.post('/', ...guard, writeLimit, handleCreate);
router.post('/create', ...guard, writeLimit, handleCreate);

router.patch('/:id', ...guard, writeLimit, async (req: AuthedRequest, res) => {
  try { res.json({ success: true, post: await posts.update(uid(req), id.parse(req.params.id), updateBody.parse(req.body ?? {})) }); }
  catch (err) { sendError(res, err, 'update post'); }
});

const singleFile = (req: any, res: any, next: any) => upload.single('file')(req, res, (err: any) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is larger than 25 MB.', code: 'too_large' });
  if (err) return res.status(400).json({ error: 'The upload couldn’t be read. Try again.', code: 'bad_upload' });
  next();
});

router.post('/upload', ...uploadGuard, writeLimit, singleFile, async (req: AuthedRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided.', code: 'missing_file' });
    }
    // The type comes from the file's own bytes, not the name or the browser's claim.
    const mime = sniffMediaType(req.file.buffer);
    if (!mime) {
      return res.status(400).json({ error: 'Unsupported file type. Use JPEG, PNG, GIF, WebP, MP4 or MOV.', code: 'invalid_type' });
    }
    const media = await posts.uploadFile(uid(req), req.file.buffer, req.file.originalname, mime);
    res.status(201).json({ success: true, id: media.id, url: media.path, path: media.path, media });
  } catch (err) {
    sendError(res, err, 'upload media');
  }
});

router.delete('/:id', ...guard, writeLimit, async (req: AuthedRequest, res) => {
  try { res.json({ success: true, ...(await posts.remove(uid(req), id.parse(req.params.id))) }); }
  catch (err) { sendError(res, err, 'delete post'); }
});

export default router;
