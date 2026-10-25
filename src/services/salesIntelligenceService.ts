import { GoogleGenAI } from '@google/genai';

export type DealHealth = 'HEALTHY' | 'AT_RISK' | 'STALE' | 'BLOCKED';

export type NextAction = 
  | 'CALL'
  | 'EMAIL'
  | 'SEND_AUDIT'
  | 'PRESENT_AUDIT'
  | 'SCHEDULE_DEMO'
  | 'SEND_PROPOSAL'
  | 'ANSWER_OBJECTION'
  | 'FOLLOW_UP'
  | 'REQUEST_INFORMATION'
  | 'INVOLVE_DECISION_MAKER'
  | 'NEGOTIATE'
  | 'ONBOARD'
  | 'NURTURE'
  | 'CLOSE_LOST';

export type ActionPriority = 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AuditData {
  overallScore?: number;
  profileCompleteness?: number;
  unansweredReviews?: number;
  avgRating?: number;
  mapRank?: string;
  missingSecondaryCategories?: string[];
  websiteSignals?: string;
  competitorGap?: string;
}

export interface OpportunityData {
  id: string;
  name: string;
  title?: string;
  company: string;
  businessType: string;
  value: number; // in USD ARR
  stage: 'new_leads' | 'qualified' | 'proposal_sent' | 'negotiation' | 'closed_won';
  probability: number;
  priority: 'high' | 'medium' | 'low';
  createdDate?: string;
  lastActivityDate?: string;
  daysSinceLastActivity?: number;
  recentActivity?: string;
  statedProblems?: string[];
  auditData?: AuditData;
  buyingSignals?: string[];
  objections?: string[];
  decisionMakers?: {
    identified: string[];
    missingInfo?: string;
  };
  blockingIssues?: string;
  customerTimeline?: string;
  budget?: string;
  missingInformation?: string[];
  notes?: string;
}

export interface SalesIntelligenceReport {
  dealHealth: {
    classification: DealHealth;
    explanation: string;
  };
  primaryQuestions: {
    whoIsProspect: string;
    whatDoesBusinessDo: string;
    whatProblemSolving: string;
    whyNeedProduct: string;
    evidenceBuyingIntent: string;
    objectionsExist: string;
    whoInvolvedDecision: string;
    whatHappenedRecently: string;
    whatBlockingProgress: string;
    whatShouldSalespersonDoNext: string;
    whatShouldSalespersonSay: string;
    whatInformationMissing: string;
  };
  buyingSignals: {
    signalsDetected: string[];
    hasSignals: boolean;
    notes: string;
  };
  objections: {
    identifiedObjections: string[];
    hasObjections: boolean;
    notes: string;
  };
  nextAction: {
    action: NextAction;
    priority: ActionPriority;
    priorityReason: string;
    actionDetail: string;
  };
  salesTalkTrack: {
    script: string;
    keyPoints: string[];
    focusAreas: string[];
    auditFindingsCited?: string;
  };
  missingInformationChecklist: string[];
}

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    try {
      geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (e: any) {
      console.warn('[Gemini Sales Intel Init Note]:', e?.message);
    }
  }
  return geminiClient;
}

/**
 * Deterministic rules-based engine adhering strictly to all requirements
 */
export function generateDeterministicSalesIntel(opportunity: OpportunityData): SalesIntelligenceReport {
  const problems = opportunity.statedProblems || [];
  const signals = opportunity.buyingSignals || [];
  const objections = opportunity.objections || [];
  const decisionMakers = opportunity.decisionMakers?.identified || [];
  const blockingIssues = opportunity.blockingIssues || '';
  const daysInactive = opportunity.daysSinceLastActivity ?? 3;
  const audit = opportunity.auditData;
  const recentAct = opportunity.recentActivity || opportunity.notes || 'No recent activity recorded';
  const missingInfoList = [...(opportunity.missingInformation || [])];

  if (!opportunity.budget) missingInfoList.push('Customer budget or financial threshold not documented');
  if (decisionMakers.length === 0) missingInfoList.push('Decision-making unit or authority not identified');
  if (!opportunity.customerTimeline) missingInfoList.push('Specific customer implementation timeline not confirmed');
  if (problems.length === 0) missingInfoList.push('Explicit business problems not recorded');

  // DEAL HEALTH EVALUATION
  // HEALTHY: recent meaningful activity and clear next step
  // AT_RISK: engagement but significant obstacles (objections, unapproved budget, competitor)
  // STALE: insufficient activity for expected sales cycle (> 14 days or no recent response)
  // BLOCKED: known issue prevents progress
  let health: DealHealth = 'HEALTHY';
  let healthExplanation = '';

  const isBlocked = blockingIssues.trim().length > 0 && !blockingIssues.toLowerCase().includes('none');
  const isStale = daysInactive > 14 || recentAct.toLowerCase().includes('stalled') || recentAct.toLowerCase().includes('no response');
  const hasObstacles = objections.length > 0 || (opportunity.decisionMakers?.missingInfo && opportunity.stage === 'negotiation');

  if (isBlocked) {
    health = 'BLOCKED';
    healthExplanation = `A known issue prevents this opportunity from progressing: "${blockingIssues}". This blocker must be addressed before the deal can advance.`;
  } else if (isStale) {
    health = 'STALE';
    healthExplanation = `Insufficient meaningful activity for the expected sales cycle (${daysInactive} days since last touchpoint with no active response recorded).`;
  } else if (hasObstacles) {
    health = 'AT_RISK';
    healthExplanation = `There is active engagement, but significant obstacles exist: ${objections.join(', ')}.`;
  } else {
    health = 'HEALTHY';
    healthExplanation = `There is recent meaningful activity (${recentAct.slice(0, 75)}...) and a clear operational next step.`;
  }

  // NEXT ACTION DETERMINATION
  // Allowed actions: CALL, EMAIL, SEND_AUDIT, PRESENT_AUDIT, SCHEDULE_DEMO, SEND_PROPOSAL,
  // ANSWER_OBJECTION, FOLLOW_UP, REQUEST_INFORMATION, INVOLVE_DECISION_MAKER, NEGOTIATE, ONBOARD, NURTURE, CLOSE_LOST
  let primaryAction: NextAction = 'FOLLOW_UP';
  let actionPriority: ActionPriority = 'MEDIUM';
  let priorityReason = '';
  let actionDetail = '';

  if (health === 'BLOCKED') {
    primaryAction = 'REQUEST_INFORMATION';
    actionPriority = 'HIGH';
    priorityReason = 'A blocker is actively halting pipeline velocity; requesting required information is needed to clear the obstacle.';
    actionDetail = `Contact ${opportunity.name} to resolve the known blocker: ${blockingIssues}`;
  } else if (objections.length > 0 && opportunity.stage !== 'closed_won') {
    primaryAction = 'ANSWER_OBJECTION';
    actionPriority = opportunity.value >= 10000 || opportunity.priority === 'high' ? 'URGENT' : 'HIGH';
    priorityReason = 'An explicit objection has been raised by the prospect; unresolved objections cause immediate deal abandonment.';
    actionDetail = `Schedule a focused discussion or deliver evidence to resolve objection: ${objections[0]}`;
  } else if (audit && (!signals.includes('Prospect opened or reviewed an audit') || signals.includes('Prospect requested an audit'))) {
    primaryAction = 'PRESENT_AUDIT';
    actionPriority = 'HIGH';
    priorityReason = 'The local GBP/SEO audit is generated; walking through the specific data points is the highest-converting conversation starter.';
    actionDetail = `Conduct a live walkthrough of the Local GBP Audit findings (Score: ${audit.overallScore ?? 'N/A'}/100, ${audit.unansweredReviews ?? 0} unanswered reviews).`;
  } else if (!audit && problems.length > 0) {
    primaryAction = 'SEND_AUDIT';
    actionPriority = 'HIGH';
    priorityReason = 'Prospect has stated problems regarding local visibility; an automated GBP audit provides factual basis for discussion.';
    actionDetail = 'Generate and send the diagnostic Local GBP & Reputation Audit report.';
  } else if (opportunity.stage === 'new_leads' && signals.includes('Prospect requested a demo')) {
    primaryAction = 'SCHEDULE_DEMO';
    actionPriority = 'URGENT';
    priorityReason = 'Direct buyer intent signaled via demo request; prompt scheduling prevents decay.';
    actionDetail = 'Confirm calendar slot for a 20-minute platform demo focusing on stated local SEO gaps.';
  } else if (opportunity.stage === 'qualified' && signals.includes('Prospect requested a proposal')) {
    primaryAction = 'SEND_PROPOSAL';
    actionPriority = 'URGENT';
    priorityReason = 'Buyer explicitly asked for formal pricing proposal and contract terms.';
    actionDetail = 'Assemble and dispatch tailored SaaS proposal addressing stated local SEO and review management goals.';
  } else if (opportunity.stage === 'proposal_sent' && !signals.includes('Prospect involved another decision maker') && opportunity.decisionMakers?.missingInfo) {
    primaryAction = 'INVOLVE_DECISION_MAKER';
    actionPriority = 'HIGH';
    priorityReason = 'Proposal is delivered but key decision-makers remain uninvolved or unverified.';
    actionDetail = `Request introduction to additional stakeholders (${opportunity.decisionMakers.missingInfo}).`;
  } else if (opportunity.stage === 'negotiation') {
    primaryAction = 'NEGOTIATE';
    actionPriority = 'URGENT';
    priorityReason = 'Deal is in final terms review; active negotiation is required to finalize contract.';
    actionDetail = 'Address remaining contract provisions and confirm start date.';
  } else if (opportunity.stage === 'closed_won') {
    primaryAction = 'ONBOARD';
    actionPriority = 'HIGH';
    priorityReason = 'Agreement signed; initial GBP verification and onboarding sequence must start.';
    actionDetail = 'Launch customer onboarding workflow and sync GBP location access.';
  } else if (health === 'STALE') {
    primaryAction = 'FOLLOW_UP';
    actionPriority = 'MEDIUM';
    priorityReason = 'Deal has been inactive for an extended period; a value-focused follow-up is necessary without making assumptions.';
    actionDetail = `Dispatch concise follow-up email inquiring if ${problems[0] || 'local search visibility'} remains an active priority.`;
  } else {
    primaryAction = 'CALL';
    actionPriority = 'MEDIUM';
    priorityReason = 'Active opportunity requires timely discovery touchpoint.';
    actionDetail = `Call ${opportunity.name} to discuss current local search performance and audit insights.`;
  }

  // SALES TALK TRACK
  // Strictly avoid guarantees, generic sales talk, or inventing claims
  let talkTrackScript = '';
  if (audit && audit.overallScore) {
    talkTrackScript = `"Hi ${opportunity.name.split(' ')[0]}, when looking over the local visibility audit for ${opportunity.company}, we noticed ${audit.unansweredReviews ?? 'several'} Google reviews without business owner responses and missing secondary categories that directly relate to your ${problems[0] || 'local search presence'}. Our platform automates review monitoring and keeps your Google Business Profile aligned with customer search queries so prospective clients finding you in local search have up-to-date information. Let's look at the specific gaps identified in your audit."`;
  } else if (problems.length > 0) {
    talkTrackScript = `"Hi ${opportunity.name.split(' ')[0]}, you mentioned that ${opportunity.company} is currently looking to address ${problems[0]}. Our platform provides direct Google Business Profile management, local citation consistency, and automated customer review workflows to help local customers discover your services. I'd like to understand what your team has tried so far and review the specific locations you are focusing on."`;
  } else {
    talkTrackScript = `"Hi ${opportunity.name.split(' ')[0]}, thank you for connecting with us regarding ${opportunity.company}. We help local businesses maintain accurate Google Business Profiles and streamline online review management. I want to learn more about your current local search presence and the specific customer acquisition goals you are working toward."`;
  }

  return {
    dealHealth: {
      classification: health,
      explanation: healthExplanation
    },
    primaryQuestions: {
      whoIsProspect: `${opportunity.name}${opportunity.title ? ` (${opportunity.title})` : ''} at ${opportunity.company}.`,
      whatDoesBusinessDo: opportunity.businessType || 'Specific business operations details not provided in CRM.',
      whatProblemSolving: problems.length > 0 ? problems.join('; ') : 'No specific business problem recorded in CRM.',
      whyNeedProduct: problems.length > 0 
        ? `To address their stated challenges with ${problems[0]} through Google Business Profile optimization, local citation synchronization, and reputation management.`
        : 'Information on exact business requirements is missing from CRM records.',
      evidenceBuyingIntent: signals.length > 0 
        ? signals.join('; ') 
        : 'No explicit buying signals recorded in available CRM data. (Silence is not interpreted as buying intent).',
      objectionsExist: objections.length > 0 
        ? objections.join('; ') 
        : 'No objections recorded in CRM.',
      whoInvolvedDecision: decisionMakers.length > 0 
        ? decisionMakers.join(', ') + (opportunity.decisionMakers?.missingInfo ? ` (Additional stakeholders missing: ${opportunity.decisionMakers.missingInfo})` : '')
        : 'Decision-maker structure not fully documented in CRM.',
      whatHappenedRecently: recentAct,
      whatBlockingProgress: isBlocked ? blockingIssues : 'No known blockers recorded in CRM.',
      whatShouldSalespersonDoNext: `${primaryAction}: ${actionDetail}`,
      whatShouldSalespersonSay: talkTrackScript,
      whatInformationMissing: missingInfoList.length > 0 ? missingInfoList.join('; ') : 'No critical information gaps identified.'
    },
    buyingSignals: {
      signalsDetected: signals,
      hasSignals: signals.length > 0,
      notes: signals.length > 0 
        ? `${signals.length} buying signal(s) documented in CRM records.`
        : 'No documented buying signals. Per CRM guidelines, silence or inactivity is not interpreted as intent.'
    },
    objections: {
      identifiedObjections: objections,
      hasObjections: objections.length > 0,
      notes: objections.length > 0 
        ? `Supported objections found: ${objections.join(', ')}.`
        : 'No objections documented in CRM records.'
    },
    nextAction: {
      action: primaryAction,
      priority: actionPriority,
      priorityReason,
      actionDetail
    },
    salesTalkTrack: {
      script: talkTrackScript,
      keyPoints: [
        problems.length > 0 ? `Anchor directly to stated problem: "${problems[0]}"` : 'Inquire about primary local discovery challenges',
        audit?.unansweredReviews ? `Cite ${audit.unansweredReviews} unanswered Google reviews from audit` : 'Offer diagnostic GBP health check',
        'Avoid making ranking position guarantees or speculative outcomes',
        'Align SaaS value strictly to customer-stated operational goals'
      ],
      focusAreas: problems.length > 0 ? problems : ['Local customer discovery', 'Review response workflows'],
      auditFindingsCited: audit ? `Audit Score: ${audit.overallScore ?? 'N/A'}/100, Unanswered Reviews: ${audit.unansweredReviews ?? 0}, Map Status: ${audit.mapRank ?? 'Unranked'}` : undefined
    },
    missingInformationChecklist: missingInfoList
  };
}

/**
 * Executes AI Sales Intelligence Analysis using Gemini model (with infallible fallback)
 */
export async function analyzeOpportunityIntelligence(opportunity: OpportunityData): Promise<SalesIntelligenceReport> {
  const gemini = getGeminiClient();

  if (gemini) {
    try {
      const systemInstruction = `You are an AI Sales Intelligence Assistant inside a CRM for a SaaS platform that helps businesses improve their Google Business Profile, local SEO, online reputation, and local customer acquisition.
Your job is to help sales representatives understand opportunities, prioritize their work, prepare for conversations, identify risks, and determine the most useful next action.
You are NOT the salesperson and must not make irreversible decisions.
Your recommendations must be based on the data available in the CRM.
Never invent:
- Customer information
- Budget
- Decision makers
- Buying intent
- Timelines
- Business problems
- Competitors
- Conversations
- Commitments
When information is missing, explicitly identify it.

PRIMARY QUESTIONS:
For every open opportunity determine:
1. Who is the prospect?
2. What does the business do?
3. What problem are they trying to solve?
4. Why might they need our product?
5. What evidence indicates buying intent?
6. What objections exist?
7. Who is involved in the decision?
8. What has happened recently?
9. What is blocking progress?
10. What should the salesperson do next?
11. What should the salesperson say?
12. What information is still missing?

DEAL HEALTH:
Classify the opportunity as:
HEALTHY: There is recent meaningful activity and a clear next step.
AT_RISK: There is engagement but there are significant obstacles.
STALE: There has been insufficient meaningful activity for the expected sales cycle.
BLOCKED: A known issue prevents the opportunity from progressing.
Always explain the classification.

BUYING SIGNALS:
Look for evidence such as:
Prospect requested pricing, Prospect requested a demo, Prospect requested an audit, Prospect opened or reviewed an audit, Prospect asked implementation questions, Prospect asked about integrations, Prospect discussed specific business problems, Prospect identified a timeline, Prospect involved another decision maker, Prospect requested a proposal, Prospect discussed contract terms, Prospect asked about onboarding.
Do not interpret silence as a buying signal.

OBJECTIONS:
Identify objections such as:
Price, ROI, Timing, Trust, Implementation, Existing solution, Competitor, Contract, Technical requirements, Lack of urgency.
Only identify an objection if supported by available information.

NEXT ACTION:
Every active deal must receive ONE primary recommended next action from:
CALL, EMAIL, SEND_AUDIT, PRESENT_AUDIT, SCHEDULE_DEMO, SEND_PROPOSAL, ANSWER_OBJECTION, FOLLOW_UP, REQUEST_INFORMATION, INVOLVE_DECISION_MAKER, NEGOTIATE, ONBOARD, NURTURE, CLOSE_LOST.
Do not recommend a generic follow-up if a more specific action is possible.

PRIORITY:
Classify the next action: URGENT, HIGH, MEDIUM, LOW.
Consider: Buying intent, Deal value, Deal age, Recent activity, Customer timeline, Objections, Probability of progressing, Required action.
Do not claim that a deal will close.

SALES TALK TRACK:
Focus on the prospect's stated problems. Use information from their audit when available. Avoid generic sales language. Avoid unsupported claims. Do not guarantee rankings or business results. Explain value in terms of the customer's stated goals. Keep the talk track concise.

Output pure JSON conforming to this schema:
{
  "dealHealth": {
    "classification": "HEALTHY" | "AT_RISK" | "STALE" | "BLOCKED",
    "explanation": "..."
  },
  "primaryQuestions": {
    "whoIsProspect": "...",
    "whatDoesBusinessDo": "...",
    "whatProblemSolving": "...",
    "whyNeedProduct": "...",
    "evidenceBuyingIntent": "...",
    "objectionsExist": "...",
    "whoInvolvedDecision": "...",
    "whatHappenedRecently": "...",
    "whatBlockingProgress": "...",
    "whatShouldSalespersonDoNext": "...",
    "whatShouldSalespersonSay": "...",
    "whatInformationMissing": "..."
  },
  "buyingSignals": {
    "signalsDetected": ["..."],
    "hasSignals": boolean,
    "notes": "..."
  },
  "objections": {
    "identifiedObjections": ["..."],
    "hasObjections": boolean,
    "notes": "..."
  },
  "nextAction": {
    "action": "CALL" | "EMAIL" | "SEND_AUDIT" | "PRESENT_AUDIT" | "SCHEDULE_DEMO" | "SEND_PROPOSAL" | "ANSWER_OBJECTION" | "FOLLOW_UP" | "REQUEST_INFORMATION" | "INVOLVE_DECISION_MAKER" | "NEGOTIATE" | "ONBOARD" | "NURTURE" | "CLOSE_LOST",
    "priority": "URGENT" | "HIGH" | "MEDIUM" | "LOW",
    "priorityReason": "...",
    "actionDetail": "..."
  },
  "salesTalkTrack": {
    "script": "...",
    "keyPoints": ["..."],
    "focusAreas": ["..."],
    "auditFindingsCited": "..."
  },
  "missingInformationChecklist": ["..."]
}`;

      const prompt = `Perform complete sales intelligence analysis on this CRM opportunity record:\n${JSON.stringify(opportunity, null, 2)}`;

      const response = await gemini.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.2
        }
      });

      const text = response.text;
      if (text) {
        const parsed = JSON.parse(text) as SalesIntelligenceReport;
        if (parsed.dealHealth && parsed.nextAction && parsed.primaryQuestions) {
          return parsed;
        }
      }
    } catch (err: any) {
      console.warn('[Gemini Sales Intel API Note - Using Deterministic Fallback]:', err?.message);
    }
  }

  return generateDeterministicSalesIntel(opportunity);
}
