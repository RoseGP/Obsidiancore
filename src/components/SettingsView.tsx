import React, { useState, useEffect } from 'react';
import { useDatabase } from '../context/DatabaseContext';
import { useAuth } from '../context/AuthContext';
import { useRealtimeSync } from '../context/RealtimeSyncContext';
import { initiateLinkedInLogin } from './LinkedInCallbackHandler';
import IntegrationsSettingsSection from './IntegrationsSettingsSection';
import NotificationPreferencesModal from './notifications/NotificationPreferencesModal';
import OrganizationSettings from './OrganizationSettings';
import ConcurrentSessionsManager from './ConcurrentSessionsManager';
import MurmuraBillingPage from './settings/MurmuraBillingPage';
import { UnifiedSocketInspector } from './UnifiedSocketInspector';
import {
  User,
  Building2,
  Bell,
  CreditCard,
  Server,
  ShieldCheck,
  Share2,
  Wifi,
  Layers,
  Database,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Radio,
  ToggleLeft,
  ToggleRight,
  Sparkles,
  Link2,
  Key,
  Shield,
  Linkedin,
  Instagram,
  Facebook,
  X,
  Globe,
  RefreshCw,
  Plus,
  Trash2,
  Calendar,
  Check,
  Clock,
  Activity,
  Users,
  Zap,
  Lock,
  Smartphone,
  Eye,
  EyeOff,
  Copy,
} from 'lucide-react';

export type SettingsTab =
  | 'account'
  | 'workspace'
  | 'notifications'
  | 'billing'
  | 'sessions'
  | 'security'
  | 'channels'
  | 'realtime-sync'
  | 'integrations'
  | 'roles-rbac'
  | 'social-db'
  | 'general';

interface SettingsViewProps {
  defaultTab?: SettingsTab;
}

export default function SettingsView({ defaultTab = 'account' }: SettingsViewProps) {
  // Normalize legacy tab names if needed
  const normalizeTab = (tab: SettingsTab): SettingsTab => {
    if (tab === 'general') return 'workspace';
    if (tab === 'roles-rbac') return 'security';
    return tab;
  };

  const [activeTab, setActiveTab] = useState<SettingsTab>(normalizeTab(defaultTab));

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(normalizeTab(defaultTab));
    }
  }, [defaultTab]);

  const { userProfile, updateProfileDetails, setPresence } = useAuth();
  const realtimeSync = useRealtimeSync();

  const {
    dbChannels,
    dbPosts,
    dbPostTargets,
    addChannel,
    deleteChannel,
    createPost,
    deletePost,
    simulatePublish,
  } = useDatabase();

  // Toast / feedback message
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3500);
  };

  // --- Account Settings State ---
  const [displayName, setDisplayName] = useState(userProfile.displayName || 'Rene Pierrette');
  const [userEmail, setUserEmail] = useState(userProfile.email || 'rpierrette45@gmail.com');
  const [userRole, setUserRole] = useState(userProfile.role || 'Executive Director');
  const [photoURL, setPhotoURL] = useState(
    userProfile.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120',
  );
  const [userPhone, setUserPhone] = useState('+1 (555) 438-9201');
  const [userTimezone, setUserTimezone] = useState('America/New_York (UTC-5)');
  const [userBio, setUserBio] = useState('Leading omnichannel growth, CRM architecture, and executive social pipelines.');

  // --- Workspace Settings State ---
  const [workspaceName, setWorkspaceName] = useState('Obsidian Enterprise Core');
  const [subdomain, setSubdomain] = useState('obsidian-vip');
  const [leadRouting, setLeadRouting] = useState<'round-robin' | 'fastest' | 'manual'>('round-robin');
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [dataRetentionDays, setDataRetentionDays] = useState('365');
  const [channels, setChannels] = useState({
    whatsapp: true,
    telegram: true,
    email: true,
    sms: false,
    instagram: true,
  });

  // --- Security Settings State ---
  const [mfaEnabled, setMfaEnabled] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [apiKeys, setApiKeys] = useState([
    { id: 'key-1', name: 'Production Webhook Gateway', prefix: 'obs_live_8472...', created: 'Sep 2026', lastUsed: '5m ago' },
    { id: 'key-2', name: 'Postiz Worker Sync Daemon', prefix: 'obs_sec_9918...', created: 'Oct 2026', lastUsed: 'Just now' },
  ]);

  // --- Connected Channels State ---
  const [socialConnections, setSocialConnections] = useState<{
    linkedin: { connected: boolean; handle: string; metric: string; metricName: string };
    instagram: { connected: boolean; handle: string; metric: string; metricName: string };
    facebook: { connected: boolean; handle: string; metric: string; metricName: string };
    tiktok: { connected: boolean; handle: string; metric: string; metricName: string };
    thread: { connected: boolean; handle: string; metric: string; metricName: string };
    twitter: { connected: boolean; handle: string; metric: string; metricName: string };
    pinterest: { connected: boolean; handle: string; metric: string; metricName: string };
  }>(() => {
    const saved = localStorage.getItem('obsidian_social_connections_v3');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {
      linkedin: { connected: true, handle: '@flowforge', metric: '1,420', metricName: 'Profile Visits' },
      instagram: { connected: true, handle: '@flowforge.studio', metric: '21.4k', metricName: 'Weekly Reach' },
      facebook: { connected: false, handle: '@flowforgepage', metric: '2.9%', metricName: 'Page Reach' },
      tiktok: { connected: false, handle: '@flowforge_tiktok', metric: '42.5k', metricName: 'Video Views' },
      thread: { connected: false, handle: '@flowforgethreads', metric: '890', metricName: 'Active Threads' },
      twitter: { connected: true, handle: '@flowforge', metric: '3.4%', metricName: 'Engagement' },
      pinterest: { connected: false, handle: '@flowforge', metric: '19.3k', metricName: 'Monthly Viewers' },
    };
  });

  useEffect(() => {
    localStorage.setItem('obsidian_social_connections_v3', JSON.stringify(socialConnections));
  }, [socialConnections]);

  const connectPlatform = (platform: keyof typeof socialConnections, mockHandle: string) => {
    setSocialConnections((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        connected: true,
        handle: mockHandle,
      },
    }));
    showSuccess(`Connected ${platform.toUpperCase()} account (${mockHandle})`);
  };

  const disconnectPlatform = (platform: keyof typeof socialConnections) => {
    setSocialConnections((prev) => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        connected: false,
      },
    }));
    showSuccess(`Disconnected ${platform.toUpperCase()}`);
  };

  const connectAllSocials = () => {
    setSocialConnections({
      linkedin: { connected: true, handle: '@flowforge', metric: '1,420', metricName: 'Profile Visits' },
      instagram: { connected: true, handle: '@flowforge.studio', metric: '21.4k', metricName: 'Reach (Last Week)' },
      facebook: { connected: true, handle: '@flowforgepage', metric: '2.9%', metricName: 'Page Reach' },
      tiktok: { connected: true, handle: '@flowforge_tiktok', metric: '42.5k', metricName: 'Video Views' },
      thread: { connected: true, handle: '@flowforgethreads', metric: '890', metricName: 'Active Threads' },
      twitter: { connected: true, handle: '@flowforge', metric: '3.4%', metricName: 'Engagement' },
      pinterest: { connected: true, handle: '@flowforge', metric: '19.3k', metricName: 'Monthly Viewers' },
    });
    showSuccess('All primary social channels linked successfully.');
  };

  const disconnectAllSocials = () => {
    setSocialConnections({
      linkedin: { connected: false, handle: '@flowforge', metric: '1,420', metricName: 'Profile Visits' },
      instagram: { connected: false, handle: '@flowforge.studio', metric: '21.4k', metricName: 'Reach (Last Week)' },
      facebook: { connected: false, handle: '@flowforgepage', metric: '2.9%', metricName: 'Page Reach' },
      tiktok: { connected: false, handle: '@flowforge_tiktok', metric: '42.5k', metricName: 'Video Views' },
      thread: { connected: false, handle: '@flowforgethreads', metric: '890', metricName: 'Active Threads' },
      twitter: { connected: false, handle: '@flowforge', metric: '3.4%', metricName: 'Engagement' },
      pinterest: { connected: false, handle: '@flowforge', metric: '19.3k', metricName: 'Monthly Viewers' },
    });
    showSuccess('Unlinked all social media accounts.');
  };

  // Social DB state
  const [newChPlatform, setNewChPlatform] = useState('LINKEDIN');
  const [newChHandle, setNewChHandle] = useState('');
  const [newPostText, setNewPostText] = useState('');
  const [newPostImageUrl, setNewPostImageUrl] = useState('');
  const [newPostDelay, setNewPostDelay] = useState('120');
  const [selectedExploreTable, setSelectedExploreTable] = useState<'channels' | 'posts' | 'post-targets'>('channels');

  // Handle Account Save
  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateProfileDetails({
      displayName,
      email: userEmail,
      role: userRole,
      photoURL,
    });
    showSuccess('Account profile updated successfully.');
  };

  // Handle Workspace Save
  const handleSaveWorkspace = (e: React.FormEvent) => {
    e.preventDefault();
    showSuccess('Workspace settings saved.');
  };

  // Navigation tabs definition
  const TABS = [
    { id: 'account' as SettingsTab, label: 'Account Settings', icon: User },
    { id: 'workspace' as SettingsTab, label: 'Workspace Settings', icon: Building2 },
    { id: 'notifications' as SettingsTab, label: 'Notifications', icon: Bell },
    { id: 'billing' as SettingsTab, label: 'Billing & Subscription', icon: CreditCard, highlight: true },
    { id: 'sessions' as SettingsTab, label: 'Sessions Management', icon: Server },
    { id: 'security' as SettingsTab, label: 'Security & Access', icon: ShieldCheck },
    { id: 'channels' as SettingsTab, label: 'Connected Channels', icon: Share2 },
    { id: 'realtime-sync' as SettingsTab, label: 'Real-Time Sync', icon: Wifi },
    { id: 'integrations' as SettingsTab, label: 'Integrations', icon: Layers },
    { id: 'social-db' as SettingsTab, label: 'Social DB Explorer', icon: Database },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12" id="settings-workspace-root">
      {/* Toast Alert */}
      {successMsg && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-semibold text-white shadow-2xl transition-all"
          style={{ background: '#12131c', border: '1px solid #10b981' }}
        >
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Settings Header */}
      <div className="border-b border-white/5 pb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="font-sans font-bold text-xl text-white tracking-tight flex items-center gap-2.5">
            Settings &amp; Workspace Configuration
          </h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Manage your account credentials, workspace defaults, billing tiers, sessions, and connected channels
          </p>
        </div>
      </div>

      {/* Unified Tab Bar */}
      <div
        className="flex items-center gap-1.5 overflow-x-auto p-1.5 rounded-2xl bg-neutral-950/80 border border-white/10"
        id="settings-tab-bar"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                active
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={14} className={active ? 'text-white' : 'text-neutral-400'} />
              <span>{tab.label}</span>
              {tab.highlight && !active && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: Account Settings */}
      {activeTab === 'account' && (
        <div className="space-y-6">
          <div className="rounded-2xl p-6 bg-neutral-900/40 border border-white/5 backdrop-blur-md space-y-6">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div>
                <h3 className="text-base font-bold text-white">Account Profile</h3>
                <p className="text-xs text-neutral-400 mt-0.5">Update personal details, contact information, and presence state</p>
              </div>
            </div>

            {/* Avatar & Presence */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-5 p-4 rounded-xl bg-neutral-950/40 border border-white/5">
              <img
                src={photoURL}
                alt="Profile"
                className="h-16 w-16 rounded-2xl object-cover border-2 border-indigo-500/40 shadow-md shrink-0"
                referrerPolicy="no-referrer"
              />
              <div className="space-y-2 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-white">{displayName}</span>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 font-bold border border-indigo-500/30">
                    {userRole}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {(['online', 'busy', 'away'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={async () => {
                        await setPresence(p);
                        showSuccess(`Presence status updated to ${p.toUpperCase()}`);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                        userProfile.presence === p
                          ? p === 'online'
                            ? 'bg-emerald-600 text-white'
                            : p === 'busy'
                            ? 'bg-rose-600 text-white'
                            : 'bg-amber-600 text-white'
                          : 'bg-white/5 text-neutral-400 hover:text-white'
                      }`}
                    >
                      {p === 'online' ? '● Online' : p === 'busy' ? '■ Busy' : '▲ Away'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Profile Form */}
            <form onSubmit={handleSaveAccount} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Full Name</label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Email Address</label>
                  <input
                    type="email"
                    required
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    className="w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Job Title / Role</label>
                  <input
                    type="text"
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value)}
                    className="w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Phone Number</label>
                  <input
                    type="text"
                    value={userPhone}
                    onChange={(e) => setUserPhone(e.target.value)}
                    className="w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Photo Avatar URL</label>
                  <input
                    type="url"
                    value={photoURL}
                    onChange={(e) => setPhotoURL(e.target.value)}
                    className="w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500 font-mono text-[11px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Timezone</label>
                  <select
                    value={userTimezone}
                    onChange={(e) => setUserTimezone(e.target.value)}
                    className="w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="America/New_York (UTC-5)">America/New York (Eastern Time)</option>
                    <option value="America/Chicago (UTC-6)">America/Chicago (Central Time)</option>
                    <option value="America/Denver (UTC-7)">America/Denver (Mountain Time)</option>
                    <option value="America/Los_Angeles (UTC-8)">America/Los Angeles (Pacific Time)</option>
                    <option value="Europe/London (UTC+0)">Europe/London (GMT)</option>
                    <option value="Europe/Paris (UTC+1)">Europe/Paris (CET)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1.5">Executive Bio &amp; Note</label>
                <textarea
                  rows={3}
                  value={userBio}
                  onChange={(e) => setUserBio(e.target.value)}
                  className="w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500 leading-relaxed"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-md cursor-pointer"
                >
                  Save Profile Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: Workspace Settings */}
      {activeTab === 'workspace' && (
        <div className="space-y-6">
          <form onSubmit={handleSaveWorkspace} className="space-y-6">
            <div className="rounded-2xl p-6 bg-neutral-900/40 border border-white/5 backdrop-blur-md space-y-4">
              <div className="flex items-center gap-2 text-white border-b border-white/5 pb-3">
                <Sliders className="h-4.5 w-4.5 text-blue-500" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Tenant Parameters &amp; Identity</h3>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">
                    Core CRM Tenant Name
                  </label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className="w-full text-xs font-semibold bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">
                    Workspace Subdomain
                  </label>
                  <div className="flex items-center rounded-xl bg-neutral-950/80 border border-white/10 px-3 py-1 text-xs">
                    <input
                      type="text"
                      value={subdomain}
                      onChange={(e) => setSubdomain(e.target.value)}
                      className="bg-transparent text-white font-mono text-xs outline-none py-2 w-full"
                    />
                    <span className="text-neutral-500 font-mono text-[11px]">.crm.app</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">
                    Lead Routing Strategy
                  </label>
                  <select
                    value={leadRouting}
                    onChange={(e) => setLeadRouting(e.target.value as any)}
                    className="w-full text-xs font-bold bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="round-robin">Round Robin Allocation (Equal distribution)</option>
                    <option value="fastest">Speed to Lead Protocol (Fastest agent availability)</option>
                    <option value="manual">Manual Assignment (Executive approvals)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">
                    Primary Currency
                  </label>
                  <select
                    value={defaultCurrency}
                    onChange={(e) => setDefaultCurrency(e.target.value)}
                    className="w-full text-xs font-bold bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value="USD">USD ($) United States Dollar</option>
                    <option value="EUR">EUR (€) Euro</option>
                    <option value="GBP">GBP (£) British Pound</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Omnichannel Gateways toggle */}
            <div className="rounded-2xl p-6 bg-neutral-900/40 border border-white/5 backdrop-blur-md space-y-4">
              <div className="flex items-center gap-2 text-white border-b border-white/5 pb-3">
                <Radio className="h-4.5 w-4.5 text-purple-500" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Omnichannel Gateway Toggles</h3>
              </div>

              <p className="text-xs text-neutral-400 leading-relaxed -mt-1">
                Turn communications channels on or off instantly. Offline gateways will safely spool incoming packets.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                {Object.entries(channels).map(([ch, isEnabled]) => (
                  <div
                    key={ch}
                    onClick={() => setChannels({ ...channels, [ch]: !isEnabled })}
                    className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-all ${
                      isEnabled ? 'bg-indigo-600/10 border-indigo-500/30' : 'bg-neutral-950/40 border-white/5 opacity-50'
                    }`}
                  >
                    <div>
                      <span className="text-xs font-bold text-white capitalize block">{ch} Gateway</span>
                      <span className="text-[10px] text-neutral-400 font-mono">{isEnabled ? 'Operational' : 'Disabled'}</span>
                    </div>
                    <button type="button" className="text-neutral-400 hover:text-white">
                      {isEnabled ? (
                        <ToggleRight className="h-6 w-6 text-indigo-500" />
                      ) : (
                        <ToggleLeft className="h-6 w-6 text-neutral-600" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-md cursor-pointer"
              >
                Save Workspace Settings
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: Notifications */}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <NotificationPreferencesModal inline={true} />
        </div>
      )}

      {/* TAB 4: Billing & Subscription (Murmura Page) */}
      {activeTab === 'billing' && <MurmuraBillingPage />}

      {/* TAB 5: Sessions Management (SFU Concurrent Sessions Heap) */}
      {activeTab === 'sessions' && (
        <div className="space-y-6">
          <ConcurrentSessionsManager />
        </div>
      )}

      {/* TAB 6: Security & Access (2FA, Password, API Keys, RBAC) */}
      {activeTab === 'security' && (
        <div className="space-y-6">
          {/* 2FA & Credentials Security Card */}
          <div className="rounded-2xl p-6 bg-neutral-900/40 border border-white/5 backdrop-blur-md space-y-6">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="text-emerald-400 h-5 w-5" />
                  Two-Factor Authentication &amp; Access Controls
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">Protect enterprise accounts with biometric or OTP authenticator</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMfaEnabled(!mfaEnabled);
                  showSuccess(`MFA status toggled: ${!mfaEnabled ? 'ENABLED' : 'DISABLED'}`);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  mfaEnabled
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                    : 'bg-white/5 text-neutral-400'
                }`}
              >
                <Smartphone size={14} />
                <span>2FA: {mfaEnabled ? 'Enforced' : 'Disabled'}</span>
              </button>
            </div>

            {/* Change Password Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newPassword !== confirmPassword) {
                  alert('Passwords do not match');
                  return;
                }
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                showSuccess('Password updated securely with PBKDF2 salt.');
              }}
              className="space-y-4"
            >
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Update Account Password</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">Current Password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">New Password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-neutral-400 mb-1">Confirm New Password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-2.5 text-white outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white"
                >
                  {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                  <span>{showPassword ? 'Hide characters' : 'Show characters'}</span>
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-md cursor-pointer"
                >
                  Update Password
                </button>
              </div>
            </form>

            {/* API Keys Table */}
            <div className="border-t border-white/5 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Personal Access &amp; API Keys
                  </h4>
                  <p className="text-[11px] text-neutral-400">Scoped credentials for headless integrations and webhooks</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const id = `key-${Date.now()}`;
                    setApiKeys([
                      ...apiKeys,
                      {
                        id,
                        name: 'API Key #' + (apiKeys.length + 1),
                        prefix: 'obs_live_' + Math.random().toString(36).substring(2, 6) + '...',
                        created: 'Just now',
                        lastUsed: 'Never',
                      },
                    ]);
                    showSuccess('Generated new high-entropy API key.');
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
                >
                  <Plus size={13} /> Generate Key
                </button>
              </div>

              <div className="space-y-2">
                {apiKeys.map((key) => (
                  <div
                    key={key.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-neutral-950/60 border border-white/5 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-white block">{key.name}</span>
                      <span className="font-mono text-neutral-400 text-[11px]">{key.prefix}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-neutral-500 text-[11px]">Last used: {key.lastUsed}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setApiKeys(apiKeys.filter((k) => k.id !== key.id));
                          showSuccess('Revoked API key.');
                        }}
                        className="text-neutral-400 hover:text-red-400"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Organization members & roles (server-enforced via /api/orgs) */}
          <OrganizationSettings />
        </div>
      )}

      {/* TAB 7: Connected Channels */}
      {activeTab === 'channels' && (
        <div className="space-y-6">
          <div className="rounded-2xl p-6 bg-neutral-900/40 border border-white/5 backdrop-blur-md space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/5 pb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Share2 className="text-indigo-400 h-5 w-5" />
                  Connected Social &amp; Messaging Channels
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Authorize, refresh OAuth tokens, and audit delivery pipelines across connected networks
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={connectAllSocials}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-md"
                >
                  Link All Channels
                </button>
                <button
                  type="button"
                  onClick={disconnectAllSocials}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-neutral-300 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                >
                  Unlink All
                </button>
              </div>
            </div>

            {/* Social Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
              {/* LinkedIn */}
              <div
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${
                  socialConnections.linkedin.connected
                    ? 'bg-blue-950/20 border-blue-500/30'
                    : 'bg-neutral-950/40 border-white/5 opacity-70'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
                      <Linkedin className="h-4 w-4 fill-current" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white block">LinkedIn</span>
                      <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5 truncate max-w-[120px]">
                        {socialConnections.linkedin.connected ? socialConnections.linkedin.handle : 'Not Connected'}
                      </span>
                    </div>
                  </div>
                  {socialConnections.linkedin.connected && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">
                      Linked
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-auto">
                  <span className="text-[10px] text-neutral-400 font-medium font-mono">
                    {socialConnections.linkedin.metric} Visits
                  </span>
                  {socialConnections.linkedin.connected ? (
                    <button
                      type="button"
                      onClick={() => disconnectPlatform('linkedin')}
                      className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => initiateLinkedInLogin()}
                      className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>

              {/* Instagram */}
              <div
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${
                  socialConnections.instagram.connected
                    ? 'bg-pink-950/20 border-pink-500/30'
                    : 'bg-neutral-950/40 border-white/5 opacity-70'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                      <Instagram className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white block">Instagram</span>
                      <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5 truncate max-w-[120px]">
                        {socialConnections.instagram.connected ? socialConnections.instagram.handle : 'Not Connected'}
                      </span>
                    </div>
                  </div>
                  {socialConnections.instagram.connected && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">
                      Linked
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-auto">
                  <span className="text-[10px] text-neutral-400 font-medium font-mono">
                    {socialConnections.instagram.metric} Reach
                  </span>
                  {socialConnections.instagram.connected ? (
                    <button
                      type="button"
                      onClick={() => disconnectPlatform('instagram')}
                      className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => connectPlatform('instagram', '@flowforge.studio')}
                      className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>

              {/* X / Twitter */}
              <div
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${
                  socialConnections.twitter.connected
                    ? 'bg-neutral-900/60 border-neutral-700'
                    : 'bg-neutral-950/40 border-white/5 opacity-70'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-black border border-white/20 flex items-center justify-center text-white font-bold text-sm">
                      <X className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white block">X (Twitter)</span>
                      <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5 truncate max-w-[120px]">
                        {socialConnections.twitter.connected ? socialConnections.twitter.handle : 'Not Connected'}
                      </span>
                    </div>
                  </div>
                  {socialConnections.twitter.connected && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">
                      Linked
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-auto">
                  <span className="text-[10px] text-neutral-400 font-medium font-mono">
                    {socialConnections.twitter.metric} Eng.
                  </span>
                  {socialConnections.twitter.connected ? (
                    <button
                      type="button"
                      onClick={() => disconnectPlatform('twitter')}
                      className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => connectPlatform('twitter', '@flowforge')}
                      className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>

              {/* Facebook */}
              <div
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${
                  socialConnections.facebook.connected
                    ? 'bg-blue-950/20 border-blue-500/30'
                    : 'bg-neutral-950/40 border-white/5 opacity-70'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-blue-700 flex items-center justify-center text-white font-bold text-sm">
                      <Facebook className="h-4 w-4 fill-current" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white block">Facebook Pages</span>
                      <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5 truncate max-w-[120px]">
                        {socialConnections.facebook.connected ? socialConnections.facebook.handle : 'Not Connected'}
                      </span>
                    </div>
                  </div>
                  {socialConnections.facebook.connected && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">
                      Linked
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-auto">
                  <span className="text-[10px] text-neutral-400 font-medium font-mono">
                    {socialConnections.facebook.metric} Reach
                  </span>
                  {socialConnections.facebook.connected ? (
                    <button
                      type="button"
                      onClick={() => disconnectPlatform('facebook')}
                      className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => connectPlatform('facebook', '@flowforgepage')}
                      className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>

              {/* TikTok */}
              <div
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${
                  socialConnections.tiktok.connected
                    ? 'bg-neutral-900/60 border-cyan-500/30'
                    : 'bg-neutral-950/40 border-white/5 opacity-70'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-black border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold text-sm">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white block">TikTok Creator</span>
                      <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5 truncate max-w-[120px]">
                        {socialConnections.tiktok.connected ? socialConnections.tiktok.handle : 'Not Connected'}
                      </span>
                    </div>
                  </div>
                  {socialConnections.tiktok.connected && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">
                      Linked
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-auto">
                  <span className="text-[10px] text-neutral-400 font-medium font-mono">
                    {socialConnections.tiktok.metric} Views
                  </span>
                  {socialConnections.tiktok.connected ? (
                    <button
                      type="button"
                      onClick={() => disconnectPlatform('tiktok')}
                      className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => connectPlatform('tiktok', '@flowforge_tiktok')}
                      className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>

              {/* Threads */}
              <div
                className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${
                  socialConnections.thread.connected
                    ? 'bg-neutral-900/60 border-neutral-700'
                    : 'bg-neutral-950/40 border-white/5 opacity-70'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-lg bg-black border border-white/20 flex items-center justify-center text-white font-bold text-sm">
                      <Globe className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-white block">Threads</span>
                      <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5 truncate max-w-[120px]">
                        {socialConnections.thread.connected ? socialConnections.thread.handle : 'Not Connected'}
                      </span>
                    </div>
                  </div>
                  {socialConnections.thread.connected && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">
                      Linked
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between mt-auto">
                  <span className="text-[10px] text-neutral-400 font-medium font-mono">
                    {socialConnections.thread.metric} Threads
                  </span>
                  {socialConnections.thread.connected ? (
                    <button
                      type="button"
                      onClick={() => disconnectPlatform('thread')}
                      className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => connectPlatform('thread', '@flowforgethreads')}
                      className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 8: Real-Time Sync & WebSockets */}
      {activeTab === 'realtime-sync' && (
        <div className="space-y-6">
          <div className="p-6 rounded-2xl border border-white/5 bg-neutral-900/40 backdrop-blur-md space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Wifi className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    Real-Time Synchronization Gateway
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      WebSocket Protocol Active
                    </span>
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Pushes live CRM entity updates, optimistic contact merges, and calendar bookings instantly to all connected peer nodes.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => realtimeSync.simulateConcurrentConflict()}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Simulate Concurrent Conflict</span>
                </button>
                <button
                  type="button"
                  onClick={() => realtimeSync.triggerStateResync()}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-200 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                  <span>Request Full Resync</span>
                </button>
              </div>
            </div>

            {/* Live Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Heartbeat Latency</div>
                <div className="text-lg font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                  <Activity className="w-4 h-4" />
                  <span>{realtimeSync.latencyMs} ms</span>
                </div>
                <div className="text-[10px] text-neutral-500">Target SLA: &lt; 50ms</div>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Active Peer Nodes</div>
                <div className="text-lg font-mono font-bold text-blue-400 flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  <span>{realtimeSync.activeClients} Node{realtimeSync.activeClients === 1 ? '' : 's'}</span>
                </div>
                <div className="text-[10px] text-neutral-500">Autoscaling cluster</div>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Sync State</div>
                <div className="text-lg font-bold text-white capitalize flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{realtimeSync.syncStatus.replace('_', ' ')}</span>
                </div>
                <div className="text-[10px] text-neutral-500">Last sync: {realtimeSync.lastSyncTime}</div>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Conflict Engine</div>
                <div className="text-lg font-mono font-bold text-amber-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>3-Way Merge</span>
                </div>
                <div className="text-[10px] text-neutral-500">Vector Clock + LWW</div>
              </div>
            </div>
          </div>

          {/* Unified Socket Inspector */}
          <div className="rounded-2xl border border-white/5 bg-neutral-900/40 p-5 space-y-3">
            <div>
              <h4 className="text-sm font-bold text-white">Live Socket Inspector &amp; Frame Telemetry</h4>
              <p className="text-xs text-neutral-400">Deep packet inspection for multiplexed WebRTC, Calendar, and CRM events.</p>
            </div>
            <UnifiedSocketInspector />
          </div>
        </div>
      )}

      {/* TAB 9: Integrations & Webhooks */}
      {activeTab === 'integrations' && (
        <div className="space-y-6">
          <IntegrationsSettingsSection />
        </div>
      )}

      {/* TAB 10: Social Database Explorer */}
      {activeTab === 'social-db' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/5 bg-neutral-900/40 p-5 backdrop-blur-md space-y-4">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2 text-white">
                <Database className="h-5 w-5 text-indigo-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Social Database Schema Explorer</h3>
              </div>
              <div className="flex gap-1.5">
                {(['channels', 'posts', 'post-targets'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelectedExploreTable(t)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer ${
                      selectedExploreTable === t
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white/5 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {t.replace('-', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-neutral-400">
              Direct introspection into Firestore Collections ({selectedExploreTable}) for automated social queue dispatch.
            </p>

            <div className="rounded-xl bg-neutral-950 p-4 border border-white/5 text-xs font-mono text-neutral-300 overflow-x-auto">
              <pre>
                {JSON.stringify(
                  selectedExploreTable === 'channels'
                    ? dbChannels
                    : selectedExploreTable === 'posts'
                    ? dbPosts
                    : dbPostTargets,
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
