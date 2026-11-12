/**
 * /api/crm-agent: the dashboard's CRM agent (answers grounded in the caller's own records; see
 * src/server/ai/crmAgent.ts and crmRetrieval.ts).
 *
 *   GET  /status  which AI providers are configured, and which record types this person's role lets it search
 *   POST /ask     { question, provider? } → { status, answer?, sources, cited, grounded, … }
 *
 * Signed-in organization members with dashboard access only; retrieval is limited to the caller's organization
 * and the record types their role can view. 20 questions per minute per person.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { askCrmAgent } from '../server/ai/crmAgent';
import { readableTypes } from '../server/ai/crmRetrieval';
import { getDocStore } from '../server/data/docStore';
import { asyncHandler, validateBody } from '../server/http/middleware';
import { requireAccess } from '../server/security/permissions';
import { requireTenant, tenantOf } from '../server/tenancy/middleware';
import { providerStatus } from '../services/ai/aiService';

const router = Router();
router.use(requireTenant, requireAccess('dashboard', 'view'));
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });

const askLimiter = rateLimit({
  windowMs: 60_000, limit: Number(process.env.CRM_AGENT_PER_MINUTE) || 20, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req) => `${tenantOf(req).orgId}:${tenantOf(req).userId}`,
  handler: (req, res) => { res.setHeader('Retry-After', '60'); res.status(429).json({ success: false, code: 'rate_limited', error: 'You\'re asking very quickly. Wait a minute and try again.', retryAfter: 60, requestId: req.id }); },
});

router.get('/status', (req, res) => {
  const p = providerStatus();
  res.json({ success: true, ai: { claude: p.claude.configured, gemini: p.gemini.configured }, searches: readableTypes(tenantOf(req).role), retrieval: 'keyword (BM25) over your organization\'s records' });
});

const Ask = z.object({
  question: z.string().trim().min(3, 'Ask a question of at least a few words.').max(1000, 'Keep questions under 1,000 characters.'),
  provider: z.enum(['claude', 'gemini']).optional(),
});

router.post('/ask', askLimiter, validateBody(Ask), asyncHandler(async (req, res) => {
  const t = tenantOf(req);
  const org = await (await getDocStore()).get(`organizations/${t.orgId}`).catch(() => null);
  const r = await askCrmAgent({ orgId: t.orgId, orgName: org?.name, role: t.role, userId: t.userId, question: req.body.question, provider: req.body.provider });
  res.json({ success: true, ...r });
}));

export default router;
