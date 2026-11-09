/**
 * /api/account: things about the signed-in person's own login.
 *   POST /sessions/revoke-all   sign out on every device (Firebase refresh tokens revoked; ID tokens
 *                               are checked for revocation on every request, so it takes effect at once)
 */
import { Router } from 'express';
import { requireUser, type AuthedRequest } from '../features/social-accounts/server/auth';
import { rateLimit } from '../features/social-accounts/server/http';
import { sendError } from '../server/tenancy/middleware';

const router = Router();
router.use(requireUser as any);

const limiter = rateLimit({ name: 'account-revoke', windowMs: 60_000, max: 5, key: (req) => (req as AuthedRequest).accountUser?.id || req.ip || 'anon' });

router.post('/sessions/revoke-all', limiter, async (req, res) => {
  try {
    const user = (req as AuthedRequest).accountUser!;
    if (user.via !== 'firebase') {
      return res.status(501).json({ success: false, code: 'not_available', error: 'Signing out other devices is available for accounts that sign in with email or Google.' });
    }
    const { getApps } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    const app = getApps()[0];
    if (!app) return res.status(503).json({ success: false, code: 'auth_not_configured', error: 'Firebase isn\'t configured on this server.' });
    await getAuth(app).revokeRefreshTokens(user.id);
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'account.revokeAll'); }
});

export default router;
