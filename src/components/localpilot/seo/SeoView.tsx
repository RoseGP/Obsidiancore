import React, { useState, useMemo } from 'react';
import { 
  TrendingUp, CheckCircle2, AlertTriangle, 
  ArrowUpRight, Zap, RefreshCw, Layers, 
  ImageIcon, Star, FileText, ShieldCheck, ChevronRight,
  Terminal, Copy, AlertCircle, Sparkles, BookOpen, Layers2,
  FileCode, Clipboard, HelpCircle, Activity, Settings, ListPlus
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { VisibilityScore } from '../ui/VisibilityScore';
import { SeoOpportunity, SeoAuditLog, LocalPilotRoute } from '../types';

export interface SeoViewProps {
  opportunities: SeoOpportunity[];
  auditLogs: SeoAuditLog[];
  selectedLocation?: any;
  onNavigate: (route: LocalPilotRoute, locId?: string) => void;
  onExecuteAction: (opp: SeoOpportunity) => void;
  onRunAudit: () => void;
}

export const SeoView: React.FC<SeoViewProps> = ({
  opportunities,
  auditLogs,
  selectedLocation,
  onNavigate,
  onExecuteAction,
  onRunAudit
}) => {
  const [isAuditing, setIsAuditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'standard' | 'strategist'>('strategist');
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const loc = selectedLocation || {
    id: 'loc-downtown-miami',
    name: 'Downtown Miami Flagship',
    category: 'Italian Restaurant & Lounge',
    address: '150 SE 2nd Ave, Suite 300',
    city: 'Miami',
    state: 'FL',
    zip: '33131',
    phone: '+1 (305) 555-0192',
    website: 'https://localpilot-sample.com/downtown',
    status: 'Healthy',
    visibilityScore: 92,
    rating: 4.8,
    reviewsCount: 1284,
    unansweredReviewsCount: 7,
    profileCompleteness: 96,
    services: ['Pizza', 'Cocktails', 'Brunch'],
    missingServices: ['Gluten-Free Custom Catering', 'Corporate Wine Tastings', 'Chef Tasting Table']
  };

  const handleAuditClick = () => {
    setIsAuditing(true);
    setTimeout(() => {
      setIsAuditing(false);
      onRunAudit();
    }, 900);
  };

  // Generate Strategist JSON based on actual selected location (FACT vs INFERENCE vs RECOMMENDATION)
  const auditData = useMemo(() => {
    const isDowntown = loc.id === 'loc-downtown-miami';
    return {
      "executive_summary": isDowntown 
        ? "FACT: Downtown Miami Flagship has a 96% profile completeness score and a 4.8-star review rating across 1,284 customer feedback entries. INFERENCE: The profile has excellent search authority, but is leaking high-intent local conversions. RECOMMENDATION: Immediately map the 3 identified missing services ('Gluten-Free Custom Catering', 'Corporate Wine Tastings', 'Chef Tasting Table') and formulate direct replies to the 7 outstanding customer reviews to maintain maximum search visibility."
        : "FACT: Westside Bistro & Terrace currently holds a lower 84/100 visibility score with a 4.6-star rating and 9 unanswered reviews. INFERENCE: Lacks consistent local authority, exacerbated by an 18-day stall in visual content uploads and missing pet-friendly seating services. RECOMMENDATION: Perform a clean menu-schema mapping, upload 5+ fresh weekly visual assets, and deploy JSON-LD openingHoursSpecification code to stabilize local rankings.",
      "business_understanding": {
        "business_type": loc.category || "FoodEstablishment",
        "primary_services": loc.services || ['Dining', 'Takeout'],
        "target_locations": [
          `${loc.city || "Miami"}, ${loc.state || "FL"} (${loc.zip || "33131"})`,
          isDowntown ? "Downtown Miami Financial District Core" : "Miami Westside Commercial Zone"
        ],
        "likely_customer_intents": isDowntown 
          ? [
              "Dinners looking for premium Italian cuisine near Downtown Miami financial core",
              "Private corporate gatherings and wine tasting event spaces in Brickell/Miami",
              "Weekend morning brunch options with specialty cocktails and wood-fired dining"
            ]
          : [
              "Local lunch options and bistro espresso near West Flagler Street",
              "Families looking for patio bistro dining or pet-friendly outdoor seating",
              "Weekend bistro takeout and local evening craft beer on tap"
            ]
      },
      "health_summary": {
        "profile": isDowntown 
          ? "Healthy (96% completeness) - All core fields are synchronized with Google Business Profile APIs, with only niche service items remaining unmapped."
          : "Needs Attention (89% completeness) - Lacks multiple high-conversion specialty services and essential attribute declarations.",
        "local_seo": isDowntown 
          ? "Strong (84.2% Top 3 Map Pack presence) - Ranks exceptionally well for primary dining terms, but faces traffic decay for high-value catering keywords."
          : "Moderate (84/100 visibility score) - Subject to ranking decay due to unmapped services and stagnant visual media activity.",
        "website": isDowntown 
          ? "Good - Website is live at https://localpilot-sample.com/downtown, but has no validated openingHours specification or FoodEstablishment Schema."
          : "Needs Improvement - Website lacks pet-friendly service landing pages and lacks structured LocalBusiness Schema.",
        "reviews": isDowntown 
          ? "Healthy (4.8 rating from 1284 reviews) - Highly credible authority, but has 7 unanswered reviews creating slight engagement friction."
          : "Action Needed (4.6 rating from 842 reviews) - Review response velocity has dropped below 48 hours, leaving 9 high-value reviews unanswered.",
        "content": isDowntown 
          ? "Active - 142 visual assets present with active post cadence, but missing corporate event and private dining highlights."
          : "Stale - Only 48 profile photos, with zero visual uploads in the last 18 days. Post frequency is below the recommended 14-day threshold.",
        "measurement": "Local Pilot dashboard metrics are active, but missing detailed local competitor review velocity tracking and organic CTR logs."
      },
      "critical_issues": [
        {
          "id": "crit-1",
          "title": "Unanswered Customer Reviews",
          "type": "FACT",
          "description": `${loc.unansweredReviewsCount || 7} customer reviews are currently unanswered.`,
          "evidence": [`Found ${loc.unansweredReviewsCount || 7} reviews with status 'unanswered' on the active profile list.`],
          "recommendation": "Deploy AI response assistant to reply to the remaining unanswered reviews within 24 hours."
        },
        ...(!isDowntown ? [{
          "id": "crit-2",
          "title": "Low Photo Activity Stall",
          "type": "FACT",
          "description": "Zero profile media uploads in over 18 days.",
          "evidence": ["lastPhotoAdded field indicates '18 days ago' which is below the optimal weekly refresh cadence."],
          "recommendation": "Upload 5 high-resolution photos highlighting bistro terraces, pastry selections, and team hospitality."
        }] : [])
      ],
      "opportunities": [
        {
          "id": "opp-1",
          "category": "Service Optimization",
          "title": "Map Missing Specialty Services in GBP",
          "problem": "The active Google Business Profile is missing high-search specialty services, causing intent mismatches.",
          "evidence": (loc.missingServices || []).map((s: string) => `Missing Service Attribute: "${s}"`),
          "recommendation": `Explicitly add ${loc.missingServices?.join(', ') || 'specialty options'} to the Google Business Profile services database.`,
          "expected_business_effect": "Maximizes discovery in local 3-Pack rankings for high-intent, long-tail transactional searches.",
          "impact": 5,
          "effort": 1,
          "confidence": 5,
          "risk": 1,
          "priority": "Critical",
          "requires_user_approval": true,
          "automatable": true
        },
        {
          "id": "opp-2",
          "category": "Structured Data",
          "title": "Implement LocalBusiness JSON-LD Schema on Website",
          "problem": "Homepage and location landing pages are missing structured schema codes.",
          "evidence": [
            "Missing openingHoursSpecification mapped to Google Business hours.",
            "Lacks FoodEstablishment schema extension."
          ],
          "recommendation": "Generate and embed structured JSON-LD code on the site headers with opening hours and exact matching NAP details.",
          "expected_business_effect": "Improves organic crawl relevance and guarantees search bots detect no NAP discrepancies.",
          "impact": 4,
          "effort": 3,
          "confidence": 4,
          "risk": 1,
          "priority": "High",
          "requires_user_approval": false,
          "automatable": false
        },
        {
          "id": "opp-3",
          "category": "Review Response Quality",
          "title": "Establish 24-Hour Review Response SLA",
          "problem": "Review reply latency creates conversion leaks for prospects reading reviews.",
          "evidence": [`Current profile displays ${loc.unansweredReviewsCount || 7} unanswered reviews.`],
          "recommendation": "Configure automatic notifications and use the AI workspace tool to achieve a 100% review response rate.",
          "expected_business_effect": "Drives higher review sentiment and directly signals positive customer service to prospects.",
          "impact": 3,
          "effort": 1,
          "confidence": 5,
          "risk": 1,
          "priority": "High",
          "requires_user_approval": true,
          "automatable": true
        }
      ],
      "quick_wins": [
        {
          "title": "GBP Sync Missing Services",
          "time": "5 mins",
          "impact": "High"
        },
        {
          "title": "AI Reply to Outstanding Reviews",
          "time": "10 mins",
          "impact": "Medium"
        }
      ],
      "strategic_projects": [
        {
          "title": "LocalBusiness & OpeningHours JSON-LD Integration",
          "timeline": "1-2 days",
          "effort": "Medium"
        },
        {
          "title": "Weekly Visual Assets Upload Sequence",
          "timeline": "Recurring Weekly",
          "effort": "Low"
        }
      ],
      "missing_data": [
        "Exact Google Maps grid-based search ranking positions.",
        "Organic click-through rates (CTR) on competitor listings.",
        "Detailed historical search queries count from Google Search Console API."
      ],
      "policy_risks": [
        {
          "type": "Inference",
          "risk": "Inconsistent formatting of address ('Suite 300' vs 'Apt 300') across citations could trigger duplicate profile flags.",
          "prevention": "Ensure perfect NAP consistency across Yelp, Bing, and Apple Maps using local pilot sync filters."
        }
      ],
      "next_actions": [
        {
          "step": 1,
          "action": "Synchronize missing service attributes into the Google Business Profile API database.",
          "automatable": true
        },
        {
          "step": 2,
          "action": "Resolve all outstanding reviews using the AI response assistant.",
          "automatable": true
        },
        {
          "step": 3,
          "action": "Deploy matched JSON-LD structured data on location pages.",
          "automatable": false
        }
      ]
    };
  }, [loc]);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(auditData, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const categoryScores = [
    { name: 'Profile Optimization', score: loc.profileCompleteness || 96, status: 'Optimal', icon: Layers },
    { name: 'Review Sentiment & Velocity', score: Math.round(loc.rating * 20), status: 'Strong', icon: Star },
    { name: 'Content & Post Cadence', score: loc.id === 'loc-downtown-miami' ? 84 : 62, status: loc.id === 'loc-downtown-miami' ? 'Good' : 'Needs Cadence', icon: FileText },
    { name: 'Photos & Visual Media', score: loc.id === 'loc-downtown-miami' ? 92 : 55, status: loc.id === 'loc-downtown-miami' ? 'Excellent' : 'Action Needed', icon: ImageIcon },
    { name: 'Services & Menu Coverage', score: Math.round((loc.services.length / (loc.services.length + loc.missingServices.length)) * 100), status: `${loc.missingServices.length} missing services`, icon: Zap },
    { name: 'Security & Verification', score: loc.securityScore || 100, status: 'Verified', icon: ShieldCheck },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-seo-view text-left">
      
      {/* Page Header with Sub-tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1 border-b border-slate-100">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight text-left">
            Local SEO & Search Visibility
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 text-left">
            Optimize ranking factors across Google 3-Pack, local organic queries, and Maps discovery.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Sub-tab Switches */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center border border-slate-200">
            <button
              onClick={() => setActiveTab('strategist')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'strategist' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Deep SEO Audit</span>
            </button>
            <button
              onClick={() => setActiveTab('standard')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'standard' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ListPlus className="h-3.5 w-3.5" />
              <span>Standard Opportunities</span>
            </button>
          </div>

          <Button
            variant="primary"
            size="sm"
            isLoading={isAuditing}
            onClick={handleAuditClick}
            leftIcon={<Zap className="h-3.5 w-3.5" />}
          >
            Run SEO Sweep
          </Button>
        </div>
      </div>

      {activeTab === 'strategist' ? (
        /* STRATEGIST DEEP AUDIT VIEW */
        <div className="space-y-6 text-left">
          
          {/* Active Location Banner */}
          <div className="bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="absolute inset-0 bg-radial-gradient from-blue-500/10 to-transparent pointer-events-none" />
            <div className="z-10 space-y-1.5">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-blue-400 bg-blue-950/80 px-2.5 py-1 rounded-full border border-blue-900/60">
                Active Strategic Location Audit
              </span>
              <h2 className="text-lg font-extrabold tracking-tight">{loc.name}</h2>
              <p className="text-xs text-slate-300 font-mono flex items-center gap-2">
                <span>Category: {loc.category}</span>
                <span>•</span>
                <span>Address: {loc.address}, {loc.city}</span>
              </p>
            </div>
            
            <div className="z-10 flex items-center gap-2.5 shrink-0">
              <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Visibility</span>
                <span className="text-lg font-black text-blue-400">{loc.visibilityScore}%</span>
              </div>
              <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl text-center">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Profile</span>
                <span className="text-lg font-black text-emerald-400">{loc.profileCompleteness}%</span>
              </div>
            </div>
          </div>

          {/* Executive Summary Card with Fact vs Inference vs Recommendation Badges */}
          <div className="bg-blue-50/50 border border-blue-200/50 rounded-2xl p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-extrabold text-blue-900 uppercase tracking-widest flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-blue-700" />
                <span>Executive Strategy Summary</span>
              </h3>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">FACT</span>
                <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-md border border-blue-200">INFERENCE</span>
                <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-200 font-semibold">RECOMMENDATION</span>
              </div>
            </div>
            <p className="text-xs text-blue-950 font-medium leading-relaxed">
              {auditData.executive_summary}
            </p>
          </div>

          {/* 2 Column Details: Business Understanding + Health Summary */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Business Understanding (5 cols) */}
            <div className="lg:col-span-5 bg-white border border-slate-200 p-5 rounded-2xl shadow-2xs space-y-4">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                Business Understanding
              </h3>
              
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Business Type</span>
                  <span className="font-semibold text-slate-800 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md inline-block">
                    {auditData.business_understanding.business_type}
                  </span>
                </div>
                
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Primary Services (Mapped)</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {auditData.business_understanding.primary_services.map((srv: string, i: number) => (
                      <span key={i} className="text-[10px] font-medium text-slate-600 bg-slate-100 border border-slate-200/50 px-2 py-0.5 rounded-md">
                        {srv}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Target Geographies</span>
                  <div className="space-y-1 mt-1">
                    {auditData.business_understanding.target_locations.map((locStr: string, i: number) => (
                      <p key={i} className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <span className="h-1 w-1 rounded-full bg-blue-500" />
                        <span>{locStr}</span>
                      </p>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Likely Customer Intents (Inferences)</span>
                  <ul className="space-y-1.5 mt-1.5 list-disc pl-4 text-slate-600 leading-normal">
                    {auditData.business_understanding.likely_customer_intents.map((intent: string, i: number) => (
                      <li key={i}>{intent}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Health Summary Card Grid (7 cols) */}
            <div className="lg:col-span-7 bg-white border border-slate-200 p-5 rounded-2xl shadow-2xs space-y-4">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                Health Summary Index
              </h3>
              
              <div className="grid grid-cols-2 gap-3.5">
                {Object.entries(auditData.health_summary).map(([key, value]) => (
                  <div key={key} className="p-3 bg-slate-50/60 border border-slate-100 rounded-xl space-y-1">
                    <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">
                      {key.replace('_', ' ')}
                    </span>
                    <p className="text-[11px] text-slate-600 leading-normal font-medium">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* Critical Issues Alerts Section */}
          {auditData.critical_issues.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-rose-500" />
                <span>Critical Visibility Risks ({auditData.critical_issues.length})</span>
              </h3>
              
              <div className="space-y-3">
                {auditData.critical_issues.map((crit, idx) => (
                  <div key={idx} className="bg-rose-50/50 border border-rose-200/50 rounded-xl p-4 flex gap-3 text-rose-950">
                    <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-rose-900 text-sm">{crit.title}</span>
                        <span className="text-[9px] font-extrabold bg-rose-200/80 text-rose-800 border border-rose-300 px-1.5 py-0.5 rounded">
                          {crit.type}
                        </span>
                      </div>
                      <p className="text-rose-900 font-medium">{crit.description}</p>
                      
                      <div className="bg-white/80 p-2.5 rounded-lg border border-rose-100 text-[11px] space-y-1">
                        <p className="font-bold text-rose-950">Evidence Basis:</p>
                        <ul className="list-disc pl-4 text-rose-800">
                          {crit.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
                        </ul>
                      </div>

                      <p className="text-[11px] leading-relaxed">
                        <strong className="text-emerald-700">RECOMMENDATION: </strong> 
                        <span className="text-slate-700">{crit.recommendation}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prioritized Actionable Opportunities & Scores (1-5 Scoring) */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-950 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-4 w-4 text-blue-600" />
              <span>Actionable Strategic Opportunities</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {auditData.opportunities.map((opp) => (
                <div 
                  key={opp.id}
                  className="bg-white border border-slate-200 hover:border-blue-300 transition-all rounded-2xl p-4 shadow-sm flex flex-col justify-between"
                >
                  <div className="space-y-3 text-xs">
                    <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                      <div>
                        <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wide block">{opp.category}</span>
                        <h4 className="font-bold text-slate-900 text-sm mt-0.5 leading-snug">{opp.title}</h4>
                      </div>
                      <Badge 
                        variant={opp.priority === 'Critical' ? 'danger' : opp.priority === 'High' ? 'warning' : 'neutral'} 
                        size="xs"
                      >
                        {opp.priority}
                      </Badge>
                    </div>

                    <p className="text-slate-600 font-medium leading-relaxed">
                      <strong className="text-slate-800">Problem: </strong> {opp.problem}
                    </p>

                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-[10px] space-y-1">
                      <span className="font-bold text-slate-700 block uppercase tracking-wider text-[8px]">Evidence Found</span>
                      <ul className="list-disc pl-4 text-slate-600 space-y-0.5">
                        {opp.evidence.map((ev, i) => <li key={i}>{ev}</li>)}
                      </ul>
                    </div>

                    <p className="text-slate-700 font-medium">
                      <strong className="text-emerald-700">RECOMMENDATION: </strong> {opp.recommendation}
                    </p>
                    
                    <p className="text-[10px] text-slate-500 leading-snug">
                      <strong className="text-slate-700">Estimated Business Outcome: </strong> {opp.expected_business_effect}
                    </p>
                  </div>

                  <div className="pt-3.5 mt-3 border-t border-slate-100 space-y-3">
                    {/* Opportunity Matrix HUD */}
                    <div className="grid grid-cols-4 gap-1.5 text-center">
                      <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block">Impact</span>
                        <span className="text-xs font-black text-slate-800">{opp.impact}/5</span>
                      </div>
                      <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block">Effort</span>
                        <span className="text-xs font-black text-slate-800">{opp.effort}/5</span>
                      </div>
                      <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block">Conf</span>
                        <span className="text-xs font-black text-slate-800">{opp.confidence}/5</span>
                      </div>
                      <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tight block">Risk</span>
                        <span className="text-xs font-black text-slate-800">{opp.risk}/5</span>
                      </div>
                    </div>

                    {/* Automatable Buttons / Approved toggles */}
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <div className="flex flex-col gap-0.5">
                        <span>Automatable: <strong className="text-slate-800">{opp.automatable ? 'Yes' : 'No'}</strong></span>
                        <span>Requires Approval: <strong className="text-slate-800">{opp.requires_user_approval ? 'Yes' : 'No'}</strong></span>
                      </div>
                      <Button variant="primary" size="xs">
                        Resolve Now
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Wins & Strategic Projects Roadmap */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs font-medium">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-2xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span>Suggested Quick Wins (Immediate Actions)</span>
              </h3>
              <div className="space-y-2">
                {auditData.quick_wins.map((win, idx) => (
                  <div key={idx} className="p-3 bg-emerald-50/40 rounded-xl border border-emerald-100 flex items-center justify-between text-emerald-950">
                    <span className="font-bold text-emerald-900">{win.title}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-md font-extrabold uppercase">{win.impact} Impact</span>
                      <span className="text-[10px] text-slate-500">{win.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-2xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-200 pb-2 flex items-center gap-1.5">
                <FileCode className="h-4 w-4 text-blue-500" />
                <span>Strategic Implementation Projects</span>
              </h3>
              <div className="space-y-2">
                {auditData.strategic_projects.map((proj, idx) => (
                  <div key={idx} className="p-3 bg-blue-50/40 rounded-xl border border-blue-100 flex items-center justify-between text-blue-950">
                    <span className="font-bold text-blue-900">{proj.title}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200">Effort: {proj.effort}</span>
                      <span className="text-[10px] text-slate-500 font-semibold">{proj.timeline}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Missing Data Checklist & Policy Risk Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-2xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                Identified Missing Data
              </h3>
              <ul className="space-y-2 text-slate-600 list-disc pl-4 leading-normal">
                {auditData.missing_data.map((dataItem, idx) => (
                  <li key={idx} className="font-medium text-slate-500">
                    {dataItem} <span className="text-[10px] text-rose-500 italic block mt-0.5">Missing from direct API feeds</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-2xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <span>GBP Policy & Quality Risks</span>
              </h3>
              <div className="space-y-2.5">
                {auditData.policy_risks.map((risk, idx) => (
                  <div key={idx} className="space-y-1">
                    <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wide block">Risk Factor (Inference)</span>
                    <p className="text-slate-600 font-medium">{risk.risk}</p>
                    <p className="text-[11px] text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-100 mt-1 font-semibold leading-relaxed">
                      🏷 PREVENTION: {risk.prevention}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* JSON Schema Interactive Panel */}
          <div className="bg-slate-950 text-white rounded-2xl border border-slate-800 shadow-2xl overflow-hidden">
            <div className="p-4 px-5 bg-slate-900 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Terminal className="h-4.5 w-4.5 text-blue-400" />
                <div>
                  <h3 className="text-sm font-bold tracking-tight">Structured Strategy Output</h3>
                  <p className="text-[10px] text-slate-400">Strictly conforms to JSON schemas, distinguishing FACT, INFERENCE, and RECOMMENDATION.</p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowRawJson(!showRawJson)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  {showRawJson ? 'Hide Raw JSON' : 'Show Raw JSON'}
                </button>
                <button
                  onClick={handleCopyJson}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  {copiedJson ? <CheckCircle2 className="h-3.5 w-3.5 text-white" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedJson ? 'Copied!' : 'Copy JSON'}</span>
                </button>
              </div>
            </div>

            {showRawJson && (
              <pre className="p-5 font-mono text-[10.5px] leading-relaxed text-blue-300 bg-black/90 overflow-x-auto max-h-[420px] select-all">
                {JSON.stringify(auditData, null, 2)}
              </pre>
            )}
          </div>

        </div>
      ) : (
        /* STANDARD OPPORTUNITIES VIEW */
        <div className="space-y-6">
          {/* Hero Card: Local Visibility Score + Category Breakdown */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100 text-left">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Local Visibility Score
                </span>
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-extrabold text-slate-900 tracking-tight">
                    92 <span className="text-lg font-normal text-slate-400">/ 100</span>
                  </span>
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                    Excellent
                  </span>
                  <span className="text-xs font-semibold text-emerald-600 flex items-center gap-0.5">
                    <ArrowUpRight className="h-3.5 w-3.5" /> +7 points this month
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Aggregated from all active locations based on map ranking, click-through rates, and Google ranking signals.
                </p>
              </div>

              <div className="flex items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
                <div className="h-10 w-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold">
                  #1
                </div>
                <div className="text-xs">
                  <div className="font-bold text-slate-900">
                    Top 3 Map Pack Presence
                  </div>
                  <div className="text-slate-500">
                    84.2% of target local search keywords
                  </div>
                </div>
              </div>
            </div>

            {/* Category Horizontal Progress Bars */}
            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4">
                Audit Category Health Scores
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categoryScores.map((cat) => {
                  const Icon = cat.icon;
                  return (
                    <div
                      key={cat.name}
                      className="p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 font-semibold text-slate-900">
                          <Icon className="h-3.5 w-3.5 text-blue-600" />
                          <span>{cat.name}</span>
                        </div>
                        <span className="font-bold text-slate-900">{cat.score}%</span>
                      </div>

                      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full ${
                            cat.score >= 90 ? 'bg-emerald-500' :
                            cat.score >= 80 ? 'bg-blue-600' :
                            'bg-amber-500'
                          }`}
                          style={{ width: `${cat.score}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">{cat.status}</span>
                        <span className={`font-semibold ${
                          cat.score >= 90 ? 'text-emerald-600' :
                          cat.score >= 80 ? 'text-blue-600' :
                          'text-amber-600'
                        }`}>
                          {cat.score >= 90 ? 'Passing' : 'Actionable'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Actionable Opportunities Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 tracking-tight text-left">
                  Your biggest opportunities
                </h3>
                <p className="text-xs text-slate-500 text-left">
                  Rank-impacting action items detected by automated daily profile sweeps.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {opportunities.map((opp) => (
                <div
                  key={opp.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-2 text-left">
                      <div>
                        <h4 className="text-xs font-bold text-slate-900">
                          {opp.title}
                        </h4>
                        {opp.locationName && (
                          <span className="text-[11px] text-slate-500">
                            Location: {opp.locationName}
                          </span>
                        )}
                      </div>

                      <Badge
                        variant={opp.impact === 'High' ? 'danger' : opp.impact === 'Medium' ? 'warning' : 'neutral'}
                        size="sm"
                      >
                        {opp.impact} Impact
                      </Badge>
                    </div>

                    <p className="text-xs text-slate-500 leading-relaxed my-2 text-left">
                      {opp.description}
                    </p>
                  </div>

                  <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3 text-[11px] text-slate-500">
                      <span>Effort: <strong className="text-slate-800">{opp.effort}</strong></span>
                      <span>•</span>
                      <span>Est. {opp.estimatedTime}</span>
                    </div>

                    <Button
                      variant="primary"
                      size="xs"
                      onClick={() => onExecuteAction(opp)}
                    >
                      {opp.actionLabel}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SEO Audit History Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="p-4 px-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 tracking-tight">
                  SEO Audit History
                </h3>
                <p className="text-xs text-slate-500">
                  Historical benchmark logs and ranking progress tracking.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">Audit Date</th>
                    <th className="px-4 py-3">Score</th>
                    <th className="px-4 py-3">Delta</th>
                    <th className="px-4 py-3">Issues Found</th>
                    <th className="px-4 py-3">Audited By</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Report</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3 font-semibold text-slate-900">
                        {log.date}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        {log.score} / 100
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        <span className={log.scoreDelta >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                          {log.scoreDelta >= 0 ? `+${log.scoreDelta}` : log.scoreDelta} pts
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {log.issuesCount} open ({log.resolvedIssuesCount} resolved)
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {log.auditedBy}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={log.status === 'Passed' ? 'success' : log.status === 'Action Needed' ? 'warning' : 'danger'}
                          size="sm"
                        >
                          {log.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onNavigate('reports')}
                          className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                        >
                          View Report
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default SeoView;
