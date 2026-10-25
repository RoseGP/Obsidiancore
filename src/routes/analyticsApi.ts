/**
 * Analytics — /api/analytics?days=30
 * Postiz's public API has no analytics endpoint, so this returns publishing
 * activity computed from the user's own posts, and says engagement isn't available.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireUser, type AuthedRequest } from '../features/social-accounts/server/auth';
import { rateLimit, sendError, userKey } from '../features/social-accounts/server/http';
import { posts } from '../features/social-accounts/server/instance';

const router = Router();
router.get('/', requireUser, rateLimit({ name: 'analytics', windowMs: 60_000, max: 30, key: userKey }), async (req: AuthedRequest, res) => {
  try {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }).parse(req.query);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json(await posts.analytics(req.accountUser!.id, days));
  } catch (err) { sendError(res, err, 'analytics'); }
});
export default router;
