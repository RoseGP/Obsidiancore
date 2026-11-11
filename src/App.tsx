import SecurityPolicyGuard from './components/settings/SecurityPolicyGuard';
import React, { useState, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DatabaseProvider } from './context/DatabaseContext';
import { CommandProvider, useCommand, SemanticView } from './context/CommandContext';
import AuthFlowView from './components/auth/AuthFlowView';
import ProposalSharePage from './features/proposals/ProposalSharePage';
import SessionLockScreen from './components/auth/SessionLockScreen';
import DynamicSidebar from './components/DynamicSidebar';
import TopNavProfileDropdown from './components/TopNavProfileDropdown';
import { NotificationDropdown } from './components/NotificationDropdown';
import { NotificationProvider } from './context/NotificationContext';
import { LuxuryNotificationToasts } from './components/notifications/LuxuryNotificationToasts';
import UnifiedCommandSearchBar from './components/UnifiedCommandSearchBar';
import DashboardView from './components/DashboardView';
import GreetHub from './components/greet/GreetHub';
import GreetGuestPage from './components/greet/GreetGuestPage';
import { announceMeetingsChanged, scheduleFromCalendarEvent, scheduleMeeting } from './lib/greetClient';
import ProductionMessagingPlatform from './components/messaging/ProductionMessagingPlatform';
import AnalyticsView from './components/AnalyticsView';
import SettingsView, { SettingsTab } from './components/SettingsView';
import CalendarView from './components/CalendarView';
import ProposalsView from './components/ProposalsView';
import SocialPlannerTab from './components/SocialPlannerTab';
import GbpView from './components/GbpView';
import DealsPipelineView from './components/DealsPipelineView';
import LeadsView from './components/leads/LeadsView';
import CRMVoiceDialer from './components/CRMVoiceDialer';
import VideoMeetingWorkspace from './components/greet/VideoMeetingWorkspace';
import FloatingMeetingHUD from './components/greet/FloatingMeetingHUD';
import { MeetingSessionProvider, useMeetingSession } from './context/MeetingSessionContext';
import PublicSchedulingPage from './components/PublicSchedulingPage';
import { RealtimeSyncProvider } from './context/RealtimeSyncContext';
import RealTimeSyncBadge from './components/RealTimeSyncBadge';
import NotificationPreferencesModal from './components/notifications/NotificationPreferencesModal';
import QuickActionButton, { QuickActionType } from './components/QuickActionButton';
import QuickActionModal from './components/QuickActionModal';
import { CRMContact, CRMLead, CalendarEvent, CRMMessage, AppNotification, ActiveView } from './types';
import { MessageSquare, X, Menu } from 'lucide-react';
import HelpMenu from './components/HelpMenu';
import LeadIntelligenceView from './features/lead-intelligence/LeadIntelligenceView';
import { useTheme } from './context/ThemeContext';
import ThemeSwitch from './components/ThemeSwitch';
import { InvitationAcceptor } from './components/OrganizationSettings';
import { onCrmChanged } from './lib/crmEvents';
import { useTaskReminders } from './features/crm-records/useTaskReminders';

// Contacts are the organization's leads (/api/leads, stored per organization on the server); loaded after sign-in.
const INITIAL_CONTACTS: CRMContact[] = [];

function contactFromLead(lead: CRMLead): CRMContact {
  return {
    id: lead.id,
    name: lead.name,
    avatar: '',
    channel: lead.source || 'website',
    lastMessage: lead.notes || '',
    timestamp: '',
    unread: false,
    status: lead.status === 'converted' ? 'resolved' : 'active',
    sentiment: 'neutral',
    email: lead.email,
    phone: lead.phone || '',
    company: lead.company || '',
    title: lead.title || '',
    notes: lead.notes || '',
  };
}

/** A saved contact (/api/contacts) in the same shape, for people who aren't (or are no longer) open leads. */
function contactFromRecord(c: any): CRMContact {
  return { id: c.id, name: c.name || c.email, avatar: '', channel: 'contact', lastMessage: c.notes || '', timestamp: '', unread: false, status: 'active', sentiment: 'neutral', email: c.email || '', phone: c.phone || '', company: c.company || '', title: c.title || '', notes: c.notes || '' };
}

// TO COMPLETE: load events from Google Calendar (/api/gcal OAuth is wired) or Firestore users/{uid}/events, and persist edits.
const INITIAL_EVENTS: CalendarEvent[] = [];

// Conversations live in the Inbox (/api/messaging); notifications arrive from real events only.
const INITIAL_MESSAGES: { [contactId: string]: CRMMessage[] } = {};
const INITIAL_NOTIFICATIONS: AppNotification[] = [];

// Views laid out as one long page scroll the main area; the others (inbox, calendar, meetings, proposals…)
// fill the viewport and scroll inside their own panels.
const PAGE_SCROLL_VIEWS = new Set<string>(['dashboard', 'home', 'analytics', 'settings', 'lead_intelligence']);

const SEARCH_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { id: 'deals', label: 'Leads & deals', icon: 'DollarSign' },
  { id: 'lead_intelligence', label: 'Lead Intelligence (Hot, Warm, Cold)', icon: 'Sparkles' },
  { id: 'proposals', label: 'Proposals & invoices', icon: 'FileText' },
  { id: 'messages', label: 'Inbox', icon: 'MessageSquare' },
  { id: 'greet', label: 'Meetings', icon: 'Video' },
  { id: 'calendar', label: 'Calendar', icon: 'Calendar' },
  { id: 'voice_dialer', label: 'Phone', icon: 'Phone' },
  { id: 'social_planner', label: 'Social planner', icon: 'Share2' },
  { id: 'gbp', label: 'Local SEO', icon: 'Globe' },
  { id: 'analytics', label: 'Analytics', icon: 'BarChart3' },
  { id: 'settings', label: 'Settings', icon: 'Settings' }
] as const;

function AppMain() {
  const { isAuthenticated, isSessionLocked, isLoading: isAuthLoading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const { activeView, setActiveView } = useCommand();
  const meetingSession = useMeetingSession();
  // Theme comes from ThemeProvider (System / Light / Dark, saved per browser).
  const { resolved: themeMode, toggle: toggleThemePref } = useTheme();
  const [contacts, setContacts] = useState<CRMContact[]>(INITIAL_CONTACTS);
  const [selectedContact, setSelectedContact] = useState<CRMContact | null>(INITIAL_CONTACTS[0] ?? null);
  const [events, setEvents] = useState<CalendarEvent[]>(INITIAL_EVENTS);
  const [messages, setMessages] = useState<{ [contactId: string]: CRMMessage[] }>(INITIAL_MESSAGES);
  const [notifications, setNotifications] = useState<AppNotification[]>(INITIAL_NOTIFICATIONS);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showNotificationPreferencesModal, setShowNotificationPreferencesModal] = useState<boolean>(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>('account');
  const [isQuickActionModalOpen, setIsQuickActionModalOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [quickActionInitialType, setQuickActionInitialType] = useState<QuickActionType>('lead');

  const handleTriggerQuickAction = useCallback((type: QuickActionType) => {
    setQuickActionInitialType(type);
    setIsQuickActionModalOpen(true);
  }, []);

  const handleLeadCreated = useCallback((newLead: CRMLead) => {
    setContacts(prev => (prev.some(c => c.id === newLead.id) ? prev : [contactFromLead(newLead), ...prev]));
  }, []);

  // Load the organization's people (leads + saved contacts, one entry per email) once signed in, and again
  // whenever a lead, contact or company changes anywhere in the app, so search and the dashboard stay current.
  const [crmVersion, setCrmVersion] = React.useState(0);
  React.useEffect(() => onCrmChanged((k) => { if (k === 'lead' || k === 'contact' || k === 'company') setCrmVersion((v) => v + 1); }), []);
  useTaskReminders(isAuthenticated);
  React.useEffect(() => {
    if (!isAuthenticated) { setContacts([]); return; }
    let cancelled = false;
    const get = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get('/api/leads'), get('/api/contacts')]).then(([l, c]) => {
      if (cancelled || (!l && !c)) return;
      const rows: CRMContact[] = [...(Array.isArray(l?.leads) ? l.leads.map(contactFromLead) : [])];
      const emails = new Set(rows.map((r) => (r.email || '').toLowerCase()).filter(Boolean));
      for (const rec of Array.isArray(c?.contacts) ? c.contacts : []) if (!rec.email || !emails.has(String(rec.email).toLowerCase())) rows.push(contactFromRecord(rec));
      setContacts(rows);
    });
    return () => { cancelled = true; };
  }, [isAuthenticated, crmVersion]);

  // Meeting invitation links (/?view=greet&meet=<code>): join once signed in. The server applies the
  // organizer's plan (capacity, lock, waiting room) and refuses with a reason if the meeting can't be joined.
  const inviteHandledRef = React.useRef(false);
  React.useEffect(() => {
    if (!isAuthenticated || inviteHandledRef.current || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('meet');
    if (!code) return;
    inviteHandledRef.current = true;
    url.searchParams.delete('meet');
    window.history.replaceState(null, '', url.toString());
    meetingSession.joinMeeting(code).then((r) => {
      if (r.success) { setActiveView('call_canvas'); if (r.message) showToast(r.message); }
      else { setActiveView('greet'); if (r.message) showToast(r.message); }
    });
  }, [isAuthenticated]);

  // Auto-route to proposals view if OAuth callback redirected with payment provider params
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const viewParam = params.get('view');
      const hasConnected = params.has('connected');
      const hasSubtab = params.get('subtab') === 'payment_providers';
      const hasError = params.has('error');
      if (viewParam === 'gbp' || params.has('gbp')) {
        // Returning from Google Business Profile authorization (src/routes/localSeoApi.ts)
        setActiveView('gbp' as SemanticView);
      } else if (viewParam === 'social_planner' || params.has('sa')) {
        // Returning from a social account authorization (see src/routes/socialAccounts.ts)
        setActiveView('social_planner' as SemanticView);
      } else if (viewParam === 'proposals' || hasConnected || hasSubtab || hasError) {
        setActiveView('proposals');
      }
    }
  }, [setActiveView]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const handleSelectContact = useCallback((contact: CRMContact) => {
    setSelectedContact(contact);
    setActiveView('messages');
  }, [setActiveView]);

  const handleSendMessage = useCallback((
    contactId: string,
    text: string,
    sender: 'user' | 'contact' = 'user',
    channel: any = 'whatsapp',
    subject?: string
  ) => {
    const newMsg: CRMMessage = {
      id: `msg-${Date.now()}`,
      sender,
      text,
      timestamp: 'Just now',
      channel,
      subject
    };
    setMessages(prev => ({
      ...prev,
      [contactId]: [...(prev[contactId] || []), newMsg]
    }));
    setContacts(prev => prev.map(c => {
      if (c.id === contactId) {
        return {
          ...c,
          lastMessage: text,
          timestamp: 'Just now'
        };
      }
      return c;
    }));
  }, []);

  const handleUpdateContactStatus = useCallback((contactId: string, status: 'active' | 'pending' | 'resolved') => {
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, status } : c));
  }, []);

  // Kept only in this browser: used when the server can't be reached, and by the public booking page preview.
  const handleAddLocalCalendarEvent = useCallback((newEvent: Omit<CalendarEvent, 'id'> | CalendarEvent, note?: string) => {
    const eventWithId: CalendarEvent = {
      ...newEvent,
      id: 'id' in newEvent ? newEvent.id : `evt-${Date.now()}`
    };
    setEvents(prev => [eventWithId, ...prev]);
    showToast(note || `"${eventWithId.title}" added to the calendar on this device.`);
  }, [showToast]);

  // One calendar: every scheduling entry point (calendar form, quick actions, dialer, free-time finder,
  // meeting room) saves a GREET meeting on the server. Already-saved meetings just refresh the views.
  const handleAddCalendarEvent = useCallback(async (newEvent: Omit<CalendarEvent, 'id'> | CalendarEvent) => {
    const ev = newEvent as CalendarEvent & { serverMeeting?: boolean };
    if (ev.serverMeeting || (typeof ev.id === 'string' && ev.id.startsWith('smt_'))) {
      announceMeetingsChanged();
      showToast(`GREET meeting "${ev.title}" is on the calendar.`);
      return;
    }
    const input = scheduleFromCalendarEvent(ev);
    if (!input) { handleAddLocalCalendarEvent(newEvent, `"${ev.title}" has no date and time, so it was added on this device only.`); return; }
    try {
      await scheduleMeeting(input);
      showToast(`GREET meeting "${input.title}" scheduled for ${input.date} at ${input.time}.`);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'network') handleAddLocalCalendarEvent(newEvent, `The server couldn't be reached: "${ev.title}" was saved on this device only.`);
      else showToast(err.message);
    }
  }, [showToast, handleAddLocalCalendarEvent]);

  const handleRemoveCalendarEvent = useCallback((id: string) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    showToast('Meeting removed from calendar.');
  }, [showToast]);

  // Notifications handlers
  const handleMarkAsRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const handleMarkAllAsRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const handleDismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleClearAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const handleNavigateView = useCallback((view: ActiveView, targetId?: string) => {
    setActiveView(view as SemanticView);
    if (targetId) {
      const contact = contacts.find(c => c.id === targetId);
      if (contact) setSelectedContact(contact);
    }
  }, [setActiveView, contacts]);

  const toggleTheme = useCallback(() => toggleThemePref(), [toggleThemePref]);

  // Map semantic active view to sidebar id
  const sidebarActiveId = (() => {
    if (['greet', 'welcome', 'meet_and_greet'].includes(activeView)) return 'greet';
    if (['messages', 'email_assistant'].includes(activeView)) return 'messages';
    if (['voice_dialer', 'voice_hub'].includes(activeView)) return 'voice_dialer';
    if (['proposals', 'enterprise_proposals'].includes(activeView)) return 'proposals';
    if (['deals', 'sales_pipelines', 'pipeline'].includes(activeView)) return 'deals';
    if (activeView === 'settings') return ['account', 'notifications', 'workspace', 'integrations'].includes(settingsDefaultTab) ? `settings:${settingsDefaultTab}` : 'settings';
    return activeView;
  })();

  // Sidebar items are views, dashboard sections ('dashboard#missions') or Settings tabs ('settings:integrations').
  const navigateTo = useCallback((id: string) => {
    if (id.startsWith('settings:')) { setSettingsDefaultTab(id.slice('settings:'.length) as SettingsTab); setActiveView('settings'); return; }
    if (id.startsWith('dashboard#')) {
      const section = id.slice('dashboard#'.length);
      setActiveView('dashboard');
      let tries = 0;
      const scroll = () => { const el = document.getElementById(section); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); else if (tries++ < 20) setTimeout(scroll, 100); };
      setTimeout(scroll, 60);
      return;
    }
    if (id === 'settings') setSettingsDefaultTab('account');
    setActiveView(id as SemanticView);
  }, [setActiveView]);

  const renderActiveView = () => {
    switch (activeView) {
      case 'dashboard':
      case 'home':
        return (
          <DashboardView
            contacts={contacts}
            onSelectContact={handleSelectContact}
            onNavigate={(v) => setActiveView(v as SemanticView)}
            onQuickAction={handleTriggerQuickAction}
            onOpenSettings={(tab) => { setSettingsDefaultTab(tab as SettingsTab); setActiveView('settings'); }}
            events={events}
          />
        );
      case 'leads':
      case 'deals':
      case 'sales_pipelines':
        return <DealsPipelineView initialTab={activeView === 'leads' ? 'leads' : 'board'} />;
      case 'chat':
      case 'messages':
      case 'email_assistant':
        return <ProductionMessagingPlatform />;
      case 'greet':
      case 'welcome':
      case 'meet_and_greet':
        return (
          <GreetHub
            contacts={contacts}
            onNavigate={(v) => setActiveView(v as SemanticView)}
            onStart={async (roomCode, contact, title, options) => {
              // The server starts the meeting on the organization's plan; if it refuses, say why and stay here.
              const r = await meetingSession.startInstantMeeting(roomCode, contact, title, options);
              if (r.success) setActiveView('call_canvas');
              else if (r.message) showToast(r.message);
            }}
            onJoin={async (code) => {
              const r = await meetingSession.joinMeeting(code);
              if (r.success) { setActiveView('call_canvas'); if (r.message) showToast(r.message); }
              else if (r.message) showToast(r.message);
            }}
          />
        );
      case 'analytics':
        // Built as a dark console: shown in the graphite frame in both themes (light variant: future work).
        return <div className="obsidian min-h-full shrink-0 p-6 bg-[var(--obsidian-1)] text-neutral-200"><AnalyticsView /></div>;
      case 'settings':
        return <div className="obsidian min-h-full shrink-0 bg-[var(--obsidian-1)] text-neutral-200"><SettingsView defaultTab={settingsDefaultTab} /></div>;
      case 'calendar':
        return (
          <CalendarView
            events={events}
            onAddEvent={handleAddCalendarEvent}
            onRemoveEvent={handleRemoveCalendarEvent}
          />
        );
      case 'proposals':
      case 'enterprise_proposals':
        return (
          <ProposalsView
            contacts={contacts}
            onSelectContact={handleSelectContact}
            onNavigate={(v) => setActiveView(v as SemanticView)}
          />
        );
      case 'social_planner':
        return <SocialPlannerTab />;
      case 'gbp':
        return <GbpView />;
      case 'lead_intelligence':
        return (
          <div className="cc min-h-full shrink-0 w-full">
            <LeadIntelligenceView onNavigate={(v) => setActiveView(v as SemanticView)} onQuickAction={handleTriggerQuickAction} />
          </div>
        );
      case 'voice_dialer':
      case 'voice_hub':
      case 'voice_messages':
      case 'voice_receptionist':
        return (
          <CRMVoiceDialer
            initialMode={activeView === 'voice_messages' ? 'monitoring' : activeView === 'voice_receptionist' ? 'receptionist' : 'unified'}
            onAddCalendarEvent={handleAddCalendarEvent}
            onNavigate={(v) => setActiveView(v as SemanticView)}
          />
        );
      // 'call_canvas' / 'video_call' render the full-viewport VideoMeetingWorkspace (early return below).
      case 'public_scheduling':
        return (
          <PublicSchedulingPage
            onBookingCreated={(ev) => handleAddLocalCalendarEvent(ev)}
            onClose={() => setActiveView('calendar')}
          />
        );
      default:
        return (
          <DashboardView
            contacts={contacts}
            onSelectContact={handleSelectContact}
            onNavigate={(v) => setActiveView(v as SemanticView)}
            onQuickAction={handleTriggerQuickAction}
            onOpenSettings={(tab) => { setSettingsDefaultTab(tab as SettingsTab); setActiveView('settings'); }}
            events={events}
          />
        );
    }
  };

  // Proposal links (/?proposal=<token>) are for clients: no CRM account needed.
  const proposalToken = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('proposal') : null;
  if (proposalToken) return <ProposalSharePage token={proposalToken} />;
  // GREET guest invitations (/?greet_invite=<token>) are for external guests: no CRM account needed.
  const greetInvite = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('greet_invite') : null;
  if (greetInvite) return <GreetGuestPage token={greetInvite} />;

  if (!isAuthenticated && !isAuthLoading) {
    return (
      <div className="obsidian min-h-screen bg-[var(--obsidian-0)]">
        <AuthFlowView onSuccess={() => showToast('Authenticated to Obsidian CRM workspace!')} />
        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-neutral-900/90 text-white text-xs font-medium border border-white/10 shadow-xl shadow-black/50 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150">
            {toastMessage}
          </div>
        )}
      </div>
    );
  }

  // Full-viewport dedicated video meeting workspace
  if (activeView === 'call_canvas' || activeView === 'video_call') {
    return (
      <div className="obsidian w-screen h-screen overflow-hidden bg-[var(--obsidian-0)]">
        <VideoMeetingWorkspace
          contacts={contacts}
          onAddCalendarEvent={handleAddCalendarEvent}
          onNavigateToDashboard={() => setActiveView('dashboard')}
          onNavigateToGreet={(tab) => {
            setActiveView('greet');
          }}
          onNavigateToContact={(contact) => {
            setSelectedContact(contact);
            setActiveView('dashboard');
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[var(--app-bg)] text-[var(--text)]">
      {/* Accepts ?invite=<token> links once the user is signed in */}
      <InvitationAcceptor onResult={showToast} />
      {/* Explains two-step / session-age refusals and applies the organization's idle sign-out */}
      <SecurityPolicyGuard onOpenSecurity={() => navigateTo('settings:security')} />

      {/* Session Lock Screen Overlay */}
      {isSessionLocked && <SessionLockScreen />}

      {/* Switch Account / Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-4xl">
            <AuthFlowView 
              isModal={true} 
              onCancel={() => setShowAuthModal(false)} 
              onSuccess={() => {
                setShowAuthModal(false);
                showToast('Switched account successfully.');
              }} 
            />
          </div>
        </div>
      )}

      {/* Sidebar */}
      <DynamicSidebar
        activeId={sidebarActiveId}
        onActiveIdChange={navigateTo}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Navbar - Clean Murmura-inspired modern executive header */}
        <header
          className={`h-14 px-3 sm:px-5 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-md shrink-0 z-30 transition-colors print:hidden`}
        >
          {/* Menu (small screens) · search · quick create */}
          <div className="flex-1 min-w-0 max-w-2xl flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="md:hidden inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)] cursor-pointer"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0 max-w-xl">
              <UnifiedCommandSearchBar
                themeMode={themeMode}
                contacts={contacts}
                events={events}
                navItems={SEARCH_NAV_ITEMS}
                activeView={activeView}
                setActiveView={(v) => navigateTo(String(v))}
                onSelectContact={handleSelectContact}
                placeholder="Search contacts, deals, calls, or type command..."
              />
            </div>
            <div className="hidden sm:block"><QuickActionButton onTriggerAction={handleTriggerQuickAction} /></div>
          </div>

          {/* Right actions: Real-Time Sync + Notifications + Profile */}
          <div className="flex items-center gap-1 sm:gap-2.5 ml-2 sm:ml-4 shrink-0">
            <div className="hidden lg:block"><ThemeSwitch /></div>
            <div className="hidden lg:block">
              <RealTimeSyncBadge
                onOpenDiagnostics={() => {
                  setSettingsDefaultTab('realtime-sync');
                  setActiveView('settings');
                }}
              />
            </div>
            <HelpMenu
              onOpenDashboard={() => setActiveView('dashboard' as SemanticView)}
              onOpenSettings={() => { setSettingsDefaultTab('workspace'); setActiveView('settings'); }}
            />

            <NotificationDropdown
              themeMode={themeMode}
              notifications={notifications}
              onMarkAsRead={handleMarkAsRead}
              onMarkAllAsRead={handleMarkAllAsRead}
              onDismiss={handleDismissNotification}
              onClearAll={handleClearAllNotifications}
              onNavigateView={handleNavigateView}
              onOpenSettings={() => {
                setSettingsDefaultTab('notifications');
                setActiveView('settings');
              }}
              onOpenPreferences={() => setShowNotificationPreferencesModal(true)}
            />

            <TopNavProfileDropdown
              themeMode={themeMode}
              onToggleTheme={toggleTheme}
              onLockSession={() => showToast('Session locked.')}
              onNavigateToSettings={(tab) => {
                if (tab) setSettingsDefaultTab(tab as any);
                setActiveView('settings');
              }}
              onShowToast={showToast}
              onOpenAuthFlow={() => setShowAuthModal(true)}
            />
          </div>
        </header>

        {/* Dynamic Viewport */}
        <main className={`flex-1 min-h-0 relative flex flex-col ${PAGE_SCROLL_VIEWS.has(activeView) ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'}`}>
          {renderActiveView()}
        </main>
      </div>

      {/* Floating Live Omnichannel Support Widget */}
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 print:hidden">
        {activeView !== 'messages' && (
          <button
            id="btn-open-omnichat"
            onClick={() => setActiveView('messages')}
            className="flex items-center gap-2 px-4 py-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-lg shadow-blue-600/30 transition-all hover:scale-105 cursor-pointer"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Inbox</span>
          </button>
        )}
      </div>

      {/* Real-time notification toasts */}
      <LuxuryNotificationToasts onNavigateView={handleNavigateView} />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-neutral-900/90 text-white text-xs font-medium border border-white/10 shadow-xl shadow-black/50 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-150">
          {toastMessage}
        </div>
      )}

      {/* Floating Mini Meeting HUD during Background Navigation */}
      <FloatingMeetingHUD onReturnToMeeting={() => setActiveView('call_canvas')} />

      {/* Global Quick Action Modal (Lead / Deal / Event) */}
      <QuickActionModal
        isOpen={isQuickActionModalOpen}
        onClose={() => setIsQuickActionModalOpen(false)}
        initialType={quickActionInitialType}
        onLeadCreated={handleLeadCreated}
        onEventCreated={handleAddCalendarEvent}
        onShowToast={showToast}
        onNavigateView={(view) => setActiveView(view as SemanticView)}
      />

      {/* Customizable Notification Preferences Modal */}
      <NotificationPreferencesModal
        isOpen={showNotificationPreferencesModal}
        onClose={() => setShowNotificationPreferencesModal(false)}
      />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <DatabaseProvider>
        <NotificationProvider>
          <RealtimeSyncProvider>
            <MeetingSessionProvider>
              <CommandProvider>
                <AppMain />
              </CommandProvider>
            </MeetingSessionProvider>
          </RealtimeSyncProvider>
        </NotificationProvider>
      </DatabaseProvider>
    </AuthProvider>
  );
}

export default App;
