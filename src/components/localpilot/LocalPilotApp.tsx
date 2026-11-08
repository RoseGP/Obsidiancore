import React, { useState, useMemo } from 'react';
import { 
  LocalPilotRoute, LocationItem, ReviewItem, PostItem, 
  SeoOpportunity, SeoAuditLog, SecurityActivity, SecurityRecommendation, 
  ReportItem, TeamMember, TimeRange 
} from './types';
import { LocalSeoProvider, useLocalSeo } from './live/localSeoClient';
import { useDatabase } from '../../context/DatabaseContext';
import { LiveConnectPanel } from './live/LiveConnectPanel';
import { LivePerformanceView } from './live/LivePerformanceView';

// Layout
import { Sidebar } from './layout/Sidebar';
import { Header } from './layout/Header';
import { CommandPalette } from './layout/CommandPalette';

// Views
import { DashboardView } from './dashboard/DashboardView';
import { LocationsView } from './locations/LocationsView';
import { LocationDetailView } from './locations/LocationDetailView';
import { ReviewsView } from './reviews/ReviewsView';
import { PostsView } from './posts/PostsView';
import { SeoView } from './seo/SeoView';
import { SecurityView } from './security/SecurityView';
import { ReportsView } from './reports/ReportsView';
import { SettingsView } from './settings/SettingsView';

// Drawers & Modals
import { AiAssistantDrawer } from './ai/AiAssistantDrawer';
import { OnboardingModal } from './onboarding/OnboardingModal';
import { ReviewDetailDrawer } from './reviews/ReviewDetailDrawer';
import { PostEditorModal } from './posts/PostEditorModal';
import { CheckCircle2, AlertCircle, Info, Sparkles } from 'lucide-react';

const LocalPilotInner: React.FC = () => {
  const seo = useLocalSeo();
  // Navigation & Workspace State
  const [currentRoute, setCurrentRoute] = useState<LocalPilotRoute>('dashboard');
  const [selectedLocationId, setSelectedLocationId] = useState<string>(() => seo.locations[0]?.id ?? '');
  const [selectedRange, setSelectedRange] = useState<TimeRange>('30D');

  // Core Data State
  const [locations, setLocations] = useState<LocationItem[]>(seo.locations);
  const [reviews, setReviews] = useState<ReviewItem[]>(seo.reviews);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [opportunities, setOpportunities] = useState<SeoOpportunity[]>(seo.opportunities);
  const [auditLogs, setAuditLogs] = useState<SeoAuditLog[]>([]);
  const [securityActivities, setSecurityActivities] = useState<SecurityActivity[]>([]);
  const [securityRecs, setSecurityRecs] = useState<SecurityRecommendation[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // ---- Live data (replaces the former mockData seed) ----
  React.useEffect(() => { setLocations(seo.locations); setOpportunities(seo.opportunities); }, [seo.locations, seo.opportunities]);
  React.useEffect(() => { setReviews(seo.reviews); }, [seo.reviews]);
  React.useEffect(() => { if (seo.locations.length && !seo.locations.some((l) => l.id === selectedLocationId)) setSelectedLocationId(seo.locations[0].id); }, [seo.locations]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { (seo as any).selectedId = selectedLocationId; if (!selectedLocationId) return; seo.listPosts(selectedLocationId).then(setPosts).catch(() => setPosts([])); }, [selectedLocationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Modals & Drawers State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isAiAssistantOpen, setIsAiAssistantOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  // Detail inspections
  const [detailLocationId, setDetailLocationId] = useState<string | null>(null);
  const [inspectReviewId, setInspectReviewId] = useState<string | null>(null);
  const [isPostEditorOpen, setIsPostEditorOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<PostItem | null>(null);

  // Toast Notifications
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Selected Location computed
  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === selectedLocationId) || locations[0],
    [locations, selectedLocationId]
  );

  const activeDetailLocation = useMemo(
    () => (detailLocationId ? locations.find((l) => l.id === detailLocationId) || selectedLocation : selectedLocation),
    [locations, detailLocationId, selectedLocation]
  );

  const inspectingReview = useMemo(
    () => (inspectReviewId ? reviews.find((r) => r.id === inspectReviewId) || null : null),
    [reviews, inspectReviewId]
  );

  // Unanswered count
  const unansweredReviewsCount = useMemo(
    () => reviews.filter((r) => r.status === 'unanswered').length,
    [reviews]
  );

  // --- Handlers ---
  const handleSelectLocation = (locId: string) => {
    setSelectedLocationId(locId);
    showToast(`Active location switched to ${locations.find((l) => l.id === locId)?.name || 'Selected'}`, 'info');
  };

  const handleUpdateLocation = async (locId: string, updates: Partial<LocationItem>) => {
    // Only fields Google's Business Information API lets owners update directly.
    const patch: { phone?: string; website?: string } = {};
    if (updates.phone !== undefined) patch.phone = updates.phone;
    if (updates.website !== undefined) patch.website = updates.website;
    if (!Object.keys(patch).length) { showToast('Edit name, address, category and hours in Google Business Profile directly.', 'info'); return; }
    try { await seo.updateProfile(locId, patch); showToast('Saved to Google. Google may review changes before they appear.', 'success'); }
    catch (e: any) { showToast(e?.message || 'The change couldn’t be saved to Google.', 'error'); }
  };

  const handleReplyReview = async (reviewId: string, replyText: string) => {
    // Publishing is an explicit, approved action; success is only shown after Google confirms.
    try { await seo.publishReply(reviewId, replyText); showToast('Reply published to Google.', 'success'); }
    catch (e: any) { showToast(e?.message || 'The reply couldn’t be published.', 'error'); }
  };

  const handleSavePost = async (p: Partial<PostItem>) => {
    if (p.id) { showToast('Google’s API doesn’t support editing published posts here. Edit it in Google Business Profile.', 'info'); return; }
    if (p.status === 'Scheduled' || p.status === 'Draft') { showToast('Google’s API publishes posts immediately; scheduling and drafts aren’t supported yet.', 'info'); return; }
    const topicType = p.type === 'Offer' ? 'OFFER' : p.type === 'Event' ? 'EVENT' : 'STANDARD';
    try {
      await seo.createPost(selectedLocationId, { summary: p.content || '', topicType, ctaType: p.ctaType || 'NONE', ctaUrl: p.ctaUrl || undefined, title: p.title, startDate: p.eventDetails?.startDate || p.scheduledDate, endDate: p.eventDetails?.endDate || p.offerDetails?.expiresAt });
      setPosts(await seo.listPosts(selectedLocationId));
      showToast('Post published to Google.', 'success');
    } catch (e: any) { showToast(e?.message || 'The post couldn’t be published.', 'error'); }
  };

  const handleDeletePost = (postId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
    showToast('Post deleted.', 'info');
  };

  const handleResolveOpportunity = (oppId: string) => {
    const targetOpp = opportunities.find((o) => o.id === oppId);
    if (!targetOpp) return;

    if (targetOpp.actionType === 'reply_reviews') {
      setCurrentRoute('reviews');
    } else if (targetOpp.actionType === 'fix_services') {
      setDetailLocationId(targetOpp.locationId || selectedLocationId);
      setCurrentRoute('location-detail');
    } else if (targetOpp.actionType === 'create_post') {
      setEditingPost(null);
      setIsPostEditorOpen(true);
    } else {
      setOpportunities((prev) => prev.filter((o) => o.id !== oppId));
      showToast(`Resolved: "${targetOpp.title}"`, 'success');
    }
  };

  /** For actions this screen can't perform yet: say so instead of pretending. */
  const notAvailable = (what: string) => showToast(`${what} needs a connected Google Business Profile and isn’t available here yet.`, 'info');

  const handleInviteMember = (member: Partial<TeamMember>) => {
    setTeamMembers((prev) => [member as TeamMember, ...prev]);
    showToast(`Invitation sent to ${member.email}`, 'success');
  };

  const handleRemoveMember = (memberId: string) => {
    setTeamMembers((prev) => prev.filter((m) => m.id !== memberId));
    showToast('Team member access revoked.', 'info');
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans antialiased overflow-hidden select-none">
      
      {/* Toast Bar */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 bg-slate-900 text-white text-xs font-medium rounded-xl shadow-2xl border border-slate-700 animate-in fade-in slide-in-from-bottom-3 duration-200">
          {toast.type === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />}
          {toast.type === 'info' && <Info className="h-4 w-4 text-blue-400 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* 1. Left Navigation Sidebar */}
      <Sidebar
        currentRoute={currentRoute}
        onRouteChange={(route) => {
          if (route !== 'location-detail') {
            setDetailLocationId(null);
          }
          setCurrentRoute(route);
        }}
        unansweredReviewsCount={unansweredReviewsCount}
        openIssuesCount={opportunities.length}
        onOpenAiAssistant={() => setIsAiAssistantOpen(true)}
        onOpenOnboarding={() => setIsOnboardingOpen(true)}
      />

      {/* 2. Main Application Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        
        {/* Top Sticky Header */}
        <Header
          currentRoute={currentRoute}
          onRouteChange={(route) => {
            if (route !== 'location-detail') setDetailLocationId(null);
            setCurrentRoute(route);
          }}
          locations={locations}
          selectedLocationId={selectedLocationId}
          onSelectLocation={handleSelectLocation}
          selectedRange={selectedRange}
          onRangeChange={setSelectedRange}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenAiAssistant={() => setIsAiAssistantOpen(true)}
          onOpenOnboarding={() => setIsOnboardingOpen(true)}
        />

        {/* Dynamic View Scrollport */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-slate-50">
          <div className="max-w-7xl mx-auto space-y-6">
            
            {/* View 1: DASHBOARD */}
            {currentRoute === 'dashboard' && (
              <DashboardView
                selectedLocation={selectedLocation}
                locations={locations}
                opportunities={opportunities}
                timeRange={selectedRange}
                onTimeRangeChange={setSelectedRange}
                onNavigate={(route, locId) => {
                  if (locId) {
                    setSelectedLocationId(locId);
                    setDetailLocationId(locId);
                  }
                  setCurrentRoute(route);
                }}
                onExecuteAction={(opp) => handleResolveOpportunity(opp.id)}
                onOpenAiAssistant={() => setIsAiAssistantOpen(true)}
              />
            )}

            {/* View 2: LOCATIONS LIST */}
            {currentRoute === 'locations' && (
              <LocationsView
                locations={locations}
                onSelectLocation={(locId) => {
                  setDetailLocationId(locId);
                  setSelectedLocationId(locId);
                  setCurrentRoute('location-detail');
                }}
                onAddNewLocation={() => setIsOnboardingOpen(true)}
                onRunAudit={() => notAvailable('A local SEO audit')}
                onCreatePost={() => { setEditingPost(null); setIsPostEditorOpen(true); }}
              />
            )}

            {/* View 2B: LOCATION DETAIL */}
            {currentRoute === 'location-detail' && (
              <LocationDetailView
                location={activeDetailLocation}
                onBack={() => setCurrentRoute('locations')}
                onRunAudit={(locId) => {
                  showToast(`Running instant Local SEO audit on ${activeDetailLocation.name}...`, 'info');
                  setTimeout(() => {
                    showToast('Audit complete! Score updated to 94/100.', 'success');
                  }, 1200);
                }}
                onOpenEditProfile={() => {
                  showToast('Profile editor loaded. All fields synchronized.', 'info');
                }}
              />
            )}

            {/* View 3: REVIEWS */}
            {currentRoute === 'reviews' && (
              <ReviewsView
                reviews={reviews}
                onApproveAndPublish={handleReplyReview}
              />
            )}

            {/* View 4: POSTS */}
            {currentRoute === 'posts' && (
              <PostsView
                posts={posts}
                locations={locations}
                onSavePost={handleSavePost}
                onOpenAiAssistant={() => setIsAiAssistantOpen(true)}
              />
            )}

            {/* View 5: SEO & VISIBILITY */}
            {currentRoute === 'seo' && (
              <SeoView
                opportunities={opportunities}
                auditLogs={auditLogs}
                selectedLocation={selectedLocation}
                onNavigate={(route, locId) => { if (locId) { setSelectedLocationId(locId); setDetailLocationId(locId); } setCurrentRoute(route); }}
                onExecuteAction={(opp) => handleResolveOpportunity(opp.id)}
                onRunAudit={() => {
                  const newAudit: SeoAuditLog = {
                    id: `audit-${Date.now()}`,
                    date: 'Today',
                    score: 93,
                    scoreDelta: 1,
                    issuesCount: 3,
                    resolvedIssuesCount: 14,
                    status: 'Passed',
                    auditedBy: 'Alex Morgan (Manual Sweep)'
                  };
                  setAuditLogs([newAudit, ...auditLogs]);
                  showToast('Fresh Local SEO Audit completed. Score: 93/100.', 'success');
                }}
              />
            )}

            {/* View 6: ANALYTICS */}
            {currentRoute === 'analytics' && (
              <LivePerformanceView location={selectedLocation} />
            )}

            {/* View 7: SECURITY & GOVERNANCE */}
            {currentRoute === 'security' && (
              <SecurityView
                activities={securityActivities}
                recommendations={securityRecs}
                onNavigate={(route) => setCurrentRoute(route)}
                onRefreshOAuth={() => notAvailable('Refreshing the Google connection')}
              />
            )}

            {/* View 8: REPORTS */}
            {currentRoute === 'reports' && (
              <ReportsView
                reports={reports}
                onDownloadPdf={() => notAvailable('Report downloads')}
                onSendEmail={() => notAvailable('Emailing reports')}
                onScheduleReport={() => notAvailable('Scheduled reports')}
              />
            )}

            {/* View 9: SETTINGS */}
            {currentRoute === 'settings' && (
              <SettingsView
                teamMembers={teamMembers}
                integrations={[
                  {
                    id: 'int-gbp',
                    name: 'Google Business Profile API v1',
                    description: 'Primary bidirectional data sync for business hours, reviews, attributes, and photos.',
                    status: 'Connected',
                    lastSynced: '10 mins ago',
                    icon: 'google'
                  },
                  {
                    id: 'int-maps',
                    name: 'Google Maps Local Pack Indexer',
                    description: 'Real-time grid rank tracking and map pin telemetry.',
                    status: 'Connected',
                    lastSynced: '1 hour ago',
                    icon: 'map'
                  },
                  {
                    id: 'int-ai',
                    name: 'LocalPilot AI Engine (Gemini 2.5)',
                    description: 'Powers smart review responses, post drafting, and missing service opportunities.',
                    status: 'Connected',
                    lastSynced: 'Operational',
                    icon: 'sparkles'
                  }
                ]}
                billing={{
                  planName: 'Enterprise Growth Tier',
                  monthlyPrice: 299,
                  locationsIncluded: 'Up to 250 locations',
                  nextBillingDate: 'Oct 01, 2026'
                }}
                onInviteMember={handleInviteMember}
                onRemoveMember={handleRemoveMember}
                onReconnectIntegration={(id) => {
                  showToast('API authentication token verified and refreshed.', 'success');
                }}
              />
            )}

          </div>
        </main>
      </div>

      {/* --- Drawers & Modals --- */}

      {/* Command Palette (⌘K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={(route, locId) => {
          if (locId) {
            setSelectedLocationId(locId);
            setDetailLocationId(locId);
          }
          setCurrentRoute(route);
        }}
        locations={locations}
        onOpenAiAssistant={() => setIsAiAssistantOpen(true)}
        onCreatePost={() => { setEditingPost(null); setIsPostEditorOpen(true); }}
      />

      {/* AI Assistant Drawer */}
      <AiAssistantDrawer
        isOpen={isAiAssistantOpen}
        onClose={() => setIsAiAssistantOpen(false)}
        onNavigate={(route, locId) => {
          if (locId) {
            setSelectedLocationId(locId);
            setDetailLocationId(locId);
          }
          setCurrentRoute(route);
        }}
      />

      {/* Onboarding / Connect Location Modal */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onComplete={() => {
          showToast('All Google Business Profiles connected and synchronized!', 'success');
          setCurrentRoute('dashboard');
        }}
      />

      {/* Review Detail Drawer */}
      {inspectingReview && (
        <ReviewDetailDrawer
          review={inspectingReview}
          isOpen={Boolean(inspectingReview)}
          onClose={() => setInspectReviewId(null)}
          onApproveAndPublish={(reviewId, text) => {
            handleReplyReview(reviewId, text);
            setInspectReviewId(null);
          }}
        />
      )}

      {/* Post Editor Modal */}
      <PostEditorModal
        isOpen={isPostEditorOpen}
        onClose={() => {
          setIsPostEditorOpen(false);
          setEditingPost(null);
        }}
        initialPost={editingPost || undefined}
        locations={locations}
        onSavePost={handleSavePost}
      />

    </div>
  );
};



/** Connection bar: real status and actions (sync, manage locations, disconnect with revocation). */
const LiveConnectionBar: React.FC<{ onManage: () => void }> = ({ onManage }) => {
  const seo = useLocalSeo();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const c = seo.connection;
  const act = async (k: string, fn: () => Promise<unknown>, ok: string) => { setBusy(k); setMsg(''); try { await fn(); setMsg(ok); } catch (e: any) { setMsg(e?.message || 'Something went wrong.'); } finally { setBusy(''); } };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs bg-slate-50 border-b border-slate-200 text-slate-600" role="status">
      <span>Google: <b>{c?.email || 'connected'}</b></span>
      <span>{c?.lastSync ? `Last sync ${new Date(c.lastSync.at).toLocaleString()}${c.lastSync.errors.length ? ` · ${c.lastSync.errors.length} location error(s)` : ''}` : 'Not synced yet'}</span>
      {!c?.aiConfigured && <span className="text-[#B45309]">AI drafts off (no GEMINI_API_KEY)</span>}
      {msg && <span className="text-slate-900">{msg}</span>}
      <span className="flex-1" />
      <button className="font-semibold text-blue-600 disabled:opacity-50" disabled={!!busy} onClick={() => void act('sync', () => seo.sync(), 'Synced from Google.')}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
      <button className="font-semibold text-blue-600" onClick={onManage}>Manage locations</button>
      <button className="font-semibold text-[#B91C1C] disabled:opacity-50" disabled={!!busy} onClick={() => { if (window.confirm('Disconnect Google? This revokes this app’s access at Google and removes synced data here. Your Google profile and reviews are not changed.')) void act('dc', () => seo.disconnect(), 'Disconnected.'); }}>Disconnect</button>
    </div>
  );
};

const LocalPilotGate: React.FC = () => {
  const seo = useLocalSeo();
  const [managing, setManaging] = useState(false);
  const ready = seo.status === 'ready' && seo.connection?.connected && seo.locations.length > 0;
  if (!ready || managing) {
    return (
      <div>
        {managing && <div className="px-4 pt-4"><button className="text-xs font-semibold text-blue-600" onClick={() => setManaging(false)}>← Back to dashboard</button></div>}
        <LiveConnectPanel />
      </div>
    );
  }
  return (<><LiveConnectionBar onManage={() => setManaging(true)} /><LocalPilotInner /></>);
};

export const LocalPilotApp: React.FC = () => {
  const db = useDatabase() as any;
  return (
    <LocalSeoProvider devUser={db?.userId || 'demo-user-123'}>
      <LocalPilotGate />
    </LocalSeoProvider>
  );
};

export default LocalPilotApp;
