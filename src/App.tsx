import React, { useState, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DatabaseProvider } from './context/DatabaseContext';
import { CommandProvider, useCommand, SemanticView } from './context/CommandContext';
import AuthFlowView from './components/auth/AuthFlowView';
import SessionLockScreen from './components/auth/SessionLockScreen';
import DynamicSidebar from './components/DynamicSidebar';
import TopNavProfileDropdown from './components/TopNavProfileDropdown';
import { NotificationDropdown } from './components/NotificationDropdown';
import { NotificationProvider } from './context/NotificationContext';
import { LuxuryNotificationToasts } from './components/notifications/LuxuryNotificationToasts';
import UnifiedCommandSearchBar from './components/UnifiedCommandSearchBar';
import DashboardView from './components/DashboardView';
import VideoWelcomePage from './components/VideoWelcomePage';
import MessagingView from './components/MessagingView';
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
import CRMCallCanvas from './components/CRMCallCanvas';
import VideoMeetingWorkspace from './components/greet/VideoMeetingWorkspace';
import FloatingMeetingHUD from './components/greet/FloatingMeetingHUD';
import { MeetingSessionProvider, useMeetingSession } from './context/MeetingSessionContext';
import PublicSchedulingPage from './components/PublicSchedulingPage';
import ExpandableOmnichannelChat from './components/ExpandableOmnichannelChat';
import { RealtimeSyncProvider } from './context/RealtimeSyncContext';
import RealTimeSyncBadge from './components/RealTimeSyncBadge';
import NotificationPreferencesModal from './components/notifications/NotificationPreferencesModal';
import QuickActionButton, { QuickActionType } from './components/QuickActionButton';
import QuickActionModal from './components/QuickActionModal';
import { CRMContact, CRMLead, CalendarEvent, CRMMessage, AppNotification, ActiveView } from './types';
import { MessageSquare, X } from 'lucide-react';
import { useTheme } from './context/ThemeContext';
import ThemeSwitch from './components/ThemeSwitch';
import { InvitationAcceptor } from './components/OrganizationSettings';

// TO COMPLETE: load the signed-in user's contacts from your database (e.g. Firestore users/{uid}/contacts with onSnapshot in DatabaseContext, like channels/posts) and persist create/update/delete. Until then the CRM starts empty and changes are lost on reload.
const INITIAL_CONTACTS: CRMContact[] = [];

// TO COMPLETE: load events from Google Calendar (/api/gcal OAuth is wired) or Firestore users/{uid}/events, and persist edits.
const INITIAL_EVENTS: CalendarEvent[] = [];

const INITIAL_MESSAGES: { [contactId: string]: CRMMessage[] } = {
  '1': [
    {
      id: 'msg-1',
      sender: 'contact',
      text: 'Good morning Rene. We completed the preliminary review of the multi-channel gateway proposal.',
      timestamp: '10:30 AM',
      channel: 'whatsapp'
    },
    {
      id: 'msg-2',
      sender: 'user',
      text: 'Great to hear Marcus! Does the 99.99% uptime SLA guarantee align with Alpha Tech requirements?',
      timestamp: '10:36 AM',
      channel: 'whatsapp'
    },
    {
      id: 'msg-3',
      sender: 'contact',
      text: "Let's finalize the SLA scope next Tuesday.",
      timestamp: '10:42 AM',
      channel: 'whatsapp'
    }
  ],
  '2': [
    {
      id: 'msg-4',
      sender: 'contact',
      text: 'Security compliance review completed for Q3 rollout. All ISO 27001 requirements are met.',
      timestamp: '09:15 AM',
      channel: 'email',
      subject: 'Security Compliance Audit - Q3 Approval'
    }
  ],
  '3': [
    {
      id: 'msg-5',
      sender: 'contact',
      text: 'Can we schedule a live consultation for the API team?',
      timestamp: 'Yesterday 4:20 PM',
      channel: 'telegram'
    }
  ],
  '4': [
    {
      id: 'msg-6',
      sender: 'contact',
      text: 'Received the demo meeting link. Joining at 2pm PST.',
      timestamp: 'Yesterday 2:05 PM',
      channel: 'sms'
    }
  ],
  '5': [
    {
      id: 'msg-7',
      sender: 'contact',
      text: 'Loved the product tour reel! What are enterprise tiers for our distributed team?',
      timestamp: '2 days ago',
      channel: 'instagram'
    }
  ]
};

const INITIAL_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'notif-1',
    title: 'New WhatsApp Message',
    message: 'Marcus Chen: "Let\'s finalize the SLA scope next Tuesday."',
    timestamp: '10:42 AM',
    read: false,
    type: 'message',
    targetView: 'messages',
    targetId: '1'
  },
  {
    id: 'notif-2',
    title: 'Meeting in 15 Minutes',
    message: 'Enterprise SLA & Infrastructure Review with Marcus Chen',
    timestamp: '09:45 AM',
    read: false,
    type: 'meeting',
    targetView: 'calendar'
  },
  {
    id: 'notif-3',
    title: 'Security Clearance Verified',
    message: 'Sarah Jenkins approved SOC 2 Type II data residency policy.',
    timestamp: '09:15 AM',
    read: true,
    type: 'system',
    targetView: 'proposals'
  }
];

const SEARCH_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { id: 'deals', label: 'Sales & Leads Pipeline', icon: 'DollarSign' },
  // 'chat' previously appeared here as "AI Chat Studio" but opened the messaging platform (duplicate of
  // Email & Messaging). The AI assistant now lives on the Dashboard; the 'chat' route still resolves.
  { id: 'greet', label: 'Greet Hub', icon: 'Video' },
  { id: 'messages', label: 'Email & Messaging', icon: 'MessageSquare' },
  { id: 'calendar', label: 'Calendar & Bookings', icon: 'Calendar' },
  { id: 'proposals', label: 'Enterprise Proposals', icon: 'FileText' },
  { id: 'social_planner', label: 'Social Planner', icon: 'Share2' },
  { id: 'gbp', label: 'Local GBP & Locations', icon: 'Globe' },
  { id: 'voice_dialer', label: 'Voice Dialer & Softphone', icon: 'Phone' },
  { id: 'call_canvas', label: 'Live Video Call Canvas', icon: 'Video' },
  { id: 'analytics', label: 'Analytics & Insights', icon: 'BarChart3' },
  { id: 'settings', label: 'Workspace Settings', icon: 'Settings' }
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
  const [isOmniChatOpen, setIsOmniChatOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showNotificationPreferencesModal, setShowNotificationPreferencesModal] = useState<boolean>(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>('account');
  const [isQuickActionModalOpen, setIsQuickActionModalOpen] = useState(false);
  const [quickActionInitialType, setQuickActionInitialType] = useState<QuickActionType>('lead');

  const handleTriggerQuickAction = useCallback((type: QuickActionType) => {
    setQuickActionInitialType(type);
    setIsQuickActionModalOpen(true);
  }, []);

  const handleLeadCreated = useCallback((newLead: CRMLead) => {
    setContacts(prev => {
      const exists = prev.some(c => c.email.toLowerCase() === newLead.email.toLowerCase());
      if (exists) return prev;
      const contactFromLead: CRMContact = {
        id: newLead.id,
        name: newLead.name,
        avatar: `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=150`,
        channel: newLead.source || 'website',
        lastMessage: newLead.notes || 'Inbound prospect created via Quick Action',
        timestamp: 'Just now',
        unread: true,
        status: 'active',
        sentiment: 'positive',
        email: newLead.email,
        phone: newLead.phone || '',
        company: newLead.company || '',
        title: newLead.title || '',
        notes: newLead.notes || ''
      };
      return [contactFromLead, ...prev];
    });
  }, []);

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
              await meetingSession.startInstantMeeting(roomCode, contact, title, options);
              setActiveView('call_canvas');
            }}
            onJoinMeeting={async (code) => {
              await meetingSession.joinMeeting(code);
              setActiveView('call_canvas');
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
      case 'call_canvas':
      case 'video_call':
        return (
          <CRMCallCanvas
            onAddCalendarEvent={handleAddCalendarEvent}
            onNavigateToDashboard={() => setActiveView('dashboard')}
            onNavigateToGreet={() => setActiveView('greet')}
          />
        );
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
          />
        );
    }
  };

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
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Navbar - Clean Murmura-inspired modern executive header */}
        <header className="h-14 px-5 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-md shrink-0 z-30 transition-colors">
          {/* Universal Command Search Bar & Quick Action */}
          <div className="flex-1 max-w-2xl flex items-center gap-3">
            <div className="flex-1 max-w-xl">
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
            <QuickActionButton onTriggerAction={handleTriggerQuickAction} />
          </div>

          {/* Right actions: Real-Time Sync + Notifications + Profile */}
          <div className="flex items-center gap-2.5 ml-4">
            <ThemeSwitch />
            <RealTimeSyncBadge
              onOpenDiagnostics={() => {
                setSettingsDefaultTab('realtime-sync');
                setActiveView('settings');
              }}
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
      <div className="fixed bottom-6 right-6 z-50">
        {isOmniChatOpen ? (
          <div className="w-[420px] h-[580px] rounded-2xl shadow-2xl overflow-hidden border border-white/10 bg-neutral-900 flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-4 py-3 bg-neutral-950 border-b border-white/10">
              <span className="text-xs font-semibold text-neutral-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live OmniChannel Gateway
              </span>
              <button
                id="btn-close-omnichat"
                onClick={() => setIsOmniChatOpen(false)}
                className="p-1 text-neutral-400 hover:text-white rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <ExpandableOmnichannelChat currentUser="Executive Director" onClose={() => setIsOmniChatOpen(false)} />
            </div>
          </div>
        ) : (
          <button
            id="btn-open-omnichat"
            onClick={() => setIsOmniChatOpen(true)}
            className="flex items-center gap-2 px-4 py-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-lg shadow-blue-600/30 transition-all hover:scale-105 cursor-pointer"
          >
            <MessageSquare className="w-4 h-4" />
            <span>OmniChannel Chat</span>
          </button>
        )}
      </div>

      {/* Luxury Obsidian Real-Time Notification Toasts */}
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
