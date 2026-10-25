import { Router, Request, Response } from 'express';
import { 
  analyzeOpportunityIntelligence, 
  generateDeterministicSalesIntel, 
  OpportunityData 
} from '../services/salesIntelligenceService';
import { GoogleGenAI } from '@google/genai';

const router = Router();

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    try {
      geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (e: any) {
      console.warn('[Gemini Init Note]:', e?.message);
    }
  }
  return geminiClient;
}

/**
 * POST /api/sales-intelligence/analyze
 * Generates the complete Sales Intelligence Assessment for an opportunity
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const opportunity: OpportunityData = req.body.opportunity || req.body;
    if (!opportunity || !opportunity.name || !opportunity.company) {
      return res.status(400).json({
        success: false,
        error: 'Invalid opportunity payload: name and company are required.'
      });
    }

    const report = await analyzeOpportunityIntelligence(opportunity);
    return res.json({
      success: true,
      report,
      analyzedAt: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Sales Intel API Error]:', error);
    // Even if an unexpected error occurs, generate deterministic report
    try {
      const opportunity: OpportunityData = req.body.opportunity || req.body;
      const fallbackReport = generateDeterministicSalesIntel(opportunity);
      return res.json({
        success: true,
        report: fallbackReport,
        fallback: true
      });
    } catch (fallbackError: any) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to analyze sales opportunity'
      });
    }
  }
});

/**
 * POST /api/sales-intelligence/ask
 * Interactive assistant for sales reps asking specific questions about an opportunity
 */
router.post('/ask', async (req: Request, res: Response) => {
  try {
    const { opportunity, question } = req.body;
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ success: false, error: 'Question is required.' });
    }

    const gemini = getGeminiClient();
    if (gemini) {
      const systemInstruction = `You are an AI Sales Intelligence Assistant inside a CRM for a SaaS platform that helps businesses improve their Google Business Profile, local SEO, online reputation, and local customer acquisition.
Your job is to help sales representatives understand opportunities, prioritize their work, prepare for conversations, identify risks, and determine the most useful next action.
You are NOT the salesperson and must not make irreversible decisions.
Your recommendations must be based on the data available in the CRM.
Never invent: Customer information, Budget, Decision makers, Buying intent, Timelines, Business problems, Competitors, Conversations, Commitments.
When information is missing, explicitly identify it.
Never guarantee rankings or business results. Keep advice concise, factual, and actionable.`;

      const response = await gemini.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [
          {
            role: 'user',
            parts: [{
              text: `CRM Opportunity Context:\n${JSON.stringify(opportunity || {}, null, 2)}\n\nSales Rep Question:\n${question}`
            }]
          }
        ],
        config: {
          systemInstruction,
          temperature: 0.3
        }
      });

      return res.json({
        success: true,
        reply: response.text || 'No response generated from sales intelligence assistant.'
      });
    }

    // Deterministic answering fallback
    const qLower = question.toLowerCase();
    let reply = '';
    if (qLower.includes('objection') || qLower.includes('price') || qLower.includes('budget')) {
      const objections = opportunity?.objections || [];
      reply = objections.length > 0 
        ? `Supported objections in CRM: ${objections.join(', ')}. Frame our solution in terms of customer acquisition ROI and local search visibility rather than feature count. Note that the customer's exact budget is ${opportunity?.budget ? opportunity.budget : 'not documented in CRM records'}.`
        : 'There are no documented objections in CRM records for this opportunity. Avoid anticipating objections that the prospect has not voiced.';
    } else if (qLower.includes('audit') || qLower.includes('gbp') || qLower.includes('seo')) {
      const audit = opportunity?.auditData;
      reply = audit 
        ? `The available audit shows an overall score of ${audit.overallScore ?? 'N/A'}/100 with ${audit.unansweredReviews ?? 0} unanswered reviews. In your conversation, highlight how responding to customer reviews demonstrates active management to local searchers, without making claims of guaranteed ranking spikes.`
        : 'No automated GBP audit data is currently attached to this opportunity record. The recommended next step is to generate and send a baseline GBP audit.';
    } else {
      reply = `Based strictly on the CRM record for ${opportunity?.name || 'this prospect'} at ${opportunity?.company || 'their business'}, focus on their stated problem: "${opportunity?.statedProblems?.[0] || 'local customer discovery'}". Explicitly verify any missing information (${opportunity?.missingInformation?.join(', ') || 'decision-maker timeline'}) during your next touchpoint.`;
    }

    return res.json({
      success: true,
      reply
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/sales-intelligence/health
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'AI Sales Intelligence Assistant',
    capabilities: [
      'DEAL_HEALTH_CLASSIFICATION',
      'PRIMARY_QUESTIONS_ANALYSIS',
      'BUYING_SIGNALS_DETECTION',
      'OBJECTIONS_IDENTIFICATION',
      'NEXT_ACTION_RECOMMENDATION',
      'SALES_TALK_TRACK_GENERATION'
    ]
  });
});

export default router;
