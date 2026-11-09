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
import VideoWelcomePage from './components/VideoWelcomePage';
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
import { useTheme } from './context/ThemeContext';
import ThemeSwitch from './components/ThemeSwitch';
import { InvitationAcceptor } from './components/OrganizationSettings';

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

// TO COMPLETE: load events from Google Calendar (/api/gcal OAuth is wired) or Firestore users/{uid}/events, and persist edits.
const INITIAL_EVENTS: CalendarEvent[] = [];

// Conversations live in the Inbox (/api/messaging); notifications arrive from real events only.
const INITIAL_MESSAGES: { [contactId: string]: CRMMessage[] } = {};
const INITIAL_NOTIFICATIONS: AppNotification[] = [];

const SEARCH_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { id: 'deals', label: 'Leads & deals', icon: 'DollarSign' },
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

  // Load the organization's contacts (leads) once signed in.
  React.useEffect(() => {
    if (!isAuthenticated) { setContacts([]); return; }
    let cancelled = false;
    fetch('/api/leads')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && Array.isArray(d.leads)) setContacts(d.leads.map(contactFromLead)); })
      .catch(() => { /* offline: contacts stay empty */ });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

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

  const handleAddCalendarEvent = useCallback((newEvent: Omit<CalendarEvent, 'id'> | CalendarEvent) => {
    const eventWithId: CalendarEvent = {
      ...newEvent,
      id: 'id' in newEvent ? newEvent.id : `evt-${Date.now()}`
    };
    setEvents(prev => [eventWithId, ...prev]);
    showToast(`Meeting "${eventWithId.title}" added to calendar.`);
  }, [showToast]);

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
    if (['deals', 'sales_pipelines', 'pipeline', 'leads'].includes(activeView)) return 'deals';
    return activeView;
  })();

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
          <VideoWelcomePage
            contacts={contacts}
            onStartInstantMeeting={async (roomCode, contact, title, options) => {
              // The server starts the meeting on the organization's plan; if it refuses, say why and stay here.
              const r = await meetingSession.startInstantMeeting(roomCode, contact, title, options);
              if (r.success) setActiveView('call_canvas');
              else if (r.message) showToast(r.message);
            }}
            onJoinMeeting={async (code) => {
              const r = await meetingSession.joinMeeting(code);
              if (r.success) { setActiveView('call_canvas'); if (r.message) showToast(r.message); }
              else if (r.message) showToast(r.message);
            }}
            onScheduleMeeting={handleAddCalendarEvent}
            onNavigateToDashboard={() => setActiveView('dashboard')}
          />
        );
      case 'analytics':
        // Built as a dark console: shown in the graphite frame in both themes (light variant: future work).
        return <div className="obsidian min-h-full p-6 bg-[var(--obsidian-1)] text-neutral-200"><AnalyticsView /></div>;
      case 'settings':
        return <div className="obsidian min-h-full bg-[var(--obsidian-1)] text-neutral-200"><SettingsView defaultTab={settingsDefaultTab} /></div>;
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
      case 'voice_dialer':
      case 'voice_hub':
        return (
          <CRMVoiceDialer
            onAddCalendarEvent={handleAddCalendarEvent}
            onNavigate={(v) => setActiveView(v as SemanticView)}
          />
        );
      // 'call_canvas' / 'video_call' render the full-viewport VideoMeetingWorkspace (early return below).
      case 'public_scheduling':
        return (
          <PublicSchedulingPage
            onBookingCreated={handleAddCalendarEvent}
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
          />
        );
    }
  };

  // Proposal links (/?proposal=<token>) are for clients: no CRM account needed.
  const proposalToken = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('proposal') : null;
  if (proposalToken) return <ProposalSharePage token={proposalToken} />;

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
        onActiveIdChange={(id) => setActiveView(id as SemanticView)}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Navbar - Clean Murmura-inspired modern executive header */}
        <header className="h-14 px-3 sm:px-5 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-md shrink-0 z-30 transition-colors print:hidden">
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
                setActiveView={(v) => setActiveView(v as SemanticView)}
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
        <main className="flex-1 overflow-hidden relative flex flex-col">
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
