import React, { useState } from 'react';
import { 
  User, Settings, Shield, CreditCard, Bell, Sliders, LogOut, 
  X, Check, Sparkles, Key, Globe, Smartphone, Moon, Sun, 
  CheckCircle2, AlertCircle, RefreshCw, ChevronRight, Lock, 
  ExternalLink, Layers, Copy, Trash2, ShieldCheck, Laptop, Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';

export type ProfileModalTab = 
  | 'account' 
  | 'workspace' 
  | 'preferences' 
  | 'notifications' 
  | 'billing' 
  | 'security' 
  | 'connected_accounts';

interface UserProfileModalProps {
  isOpen: boolean;
  initialTab?: ProfileModalTab;
  onClose: () => void;
  onLogout?: () => void;
  themeMode?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onShowToast?: (msg: string) => void;
}

export default function UserProfileModal({
  isOpen,
  initialTab = 'account',
  onClose,
  onLogout,
  themeMode = 'light',
  onToggleTheme,
  onShowToast
}: UserProfileModalProps) {
  const { userProfile, updateProfileDetails, setPresence, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<ProfileModalTab>(initialTab);

  // Form states
  const [name, setName] = useState(userProfile.displayName || 'Rene Pierrette');
  const [email, setEmail] = useState(userProfile.email || 'rpierrette45@gmail.com');
  const [role, setRole] = useState(userProfile.role || 'Executive Director');
  const [photoURL, setPhotoURL] = useState(userProfile.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120');
  const [phone, setPhone] = useState('+1 (555) 438-9201');
  const [company, setCompany] = useState('Obsidian Enterprise Core');
  const [timezone, setTimezone] = useState('America/New_York (UTC-5)');
  
  // Workspace settings state
  const [workspaceName, setWorkspaceName] = useState('Obsidian Enterprise Core HQ');
  const [subdomain, setSubdomain] = useState('obsidian-vip');
  
  // Preferences states
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [autoLockMinutes, setAutoLockMinutes] = useState('15');

  // Notifications states
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyLeadInstant, setNotifyLeadInstant] = useState(true);
  const [notifySocialPublish, setNotifySocialPublish] = useState(true);
  const [notifySms, setNotifySms] = useState(false);

  // Security states
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(true);
  const [terminalPin, setTerminalPin] = useState('1337');
  const [showPin, setShowPin] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      await updateProfileDetails({
        displayName: name,
        email,
        role,
        photoURL
      });
      if (onShowToast) onShowToast('Profile settings saved successfully.');
    } catch (e: any) {
      if (onShowToast) onShowToast(`Error saving profile: ${e?.message || 'Update failed'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const navTabs: { id: ProfileModalTab; label: string; icon: any; badge?: string }[] = [
    { id: 'account', label: 'Account Profile', icon: User },
    { id: 'workspace', label: 'Workspace & Team', icon: Layers },
    { id: 'preferences', label: 'Preferences', icon: Sliders },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'billing', label: 'Billing & Plan', icon: CreditCard, badge: 'VIP' },
    { id: 'security', label: 'Security & Auth', icon: ShieldCheck },
    { id: 'connected_accounts', label: 'Connected Channels', icon: Globe }
  ];

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className={`w-full max-w-4xl h-[620px] max-h-[90vh] rounded-3xl border shadow-2xl flex flex-col md:flex-row overflow-hidden ${
          themeMode === 'light'
            ? 'bg-white border-neutral-200/90 text-neutral-800'
            : 'bg-[var(--obsidian-0)] border-white/10 text-neutral-100'
        }`}
      >
        {/* Left Navigation Sidebar inside Modal */}
        <div className={`w-full md:w-64 border-b md:border-b-0 md:border-r shrink-0 p-5 flex flex-col justify-between ${
          themeMode === 'light'
            ? 'bg-neutral-50/80 border-neutral-200/80'
            : 'bg-neutral-900/40 border-white/5'
        }`}>
          <div>
            {/* Header info */}
            <div className="flex items-center gap-3 pb-4 mb-4 border-b border-neutral-200 dark:border-white/10">
              <div className="relative">
                <img
                  src={photoURL}
                  alt={name}
                  className="h-11 w-11 rounded-2xl object-cover border-2 border-white dark:border-neutral-800 shadow-sm"
                  referrerPolicy="no-referrer"
                />
                <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 ${
                  themeMode === 'light' ? 'border-white' : 'border-neutral-900'
                } ${
                  userProfile.presence === 'online' ? 'bg-emerald-500' :
                  userProfile.presence === 'busy' ? 'bg-rose-500' : 'bg-amber-500'
                }`} />
              </div>
              <div className="overflow-hidden">
                <h3 className="font-bold text-sm truncate">{name}</h3>
                <p className="text-[11px] text-neutral-400 truncate">{email}</p>
                <span className="inline-block mt-0.5 text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold">
                  {role}
                </span>
              </div>
            </div>

            {/* Nav tabs */}
            <nav className="space-y-1">
              {navTabs.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? themeMode === 'light'
                          ? 'bg-white text-indigo-600 shadow-xs border border-neutral-200'
                          : 'bg-white/10 text-white shadow-xs border border-white/10'
                        : themeMode === 'light'
                          ? 'text-neutral-600 hover:bg-neutral-200/50'
                          : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`h-4 w-4 ${isActive ? 'text-indigo-500' : 'text-neutral-400'}`} />
                      <span>{tab.label}</span>
                    </div>
                    {tab.badge && (
                      <span className="text-[9px] px-1.5 py-0.2 font-mono font-black rounded bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-400">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Bottom actions: Logout & Close */}
          <div className="pt-4 border-t border-neutral-200 dark:border-white/10 space-y-2">
            <button
              onClick={() => {
                onClose();
                if (onLogout) onLogout();
                else logout();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out Session</span>
            </button>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top Bar of Modal */}
          <div className={`px-6 py-4 border-b flex items-center justify-between ${
            themeMode === 'light' ? 'border-neutral-200/80 bg-white' : 'border-white/5 bg-[var(--obsidian-0)]'
          }`}>
            <div>
              <h2 className="text-base font-bold tracking-tight capitalize">
                {navTabs.find(t => t.id === activeTab)?.label}
              </h2>
              <p className="text-xs text-neutral-400">
                Manage your enterprise identity, preferences, and system parameters
              </p>
            </div>
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-full border border-neutral-200 dark:border-white/10 flex items-center justify-center text-neutral-400 hover:text-neutral-800 dark:hover:text-white transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Modal Tab Content Area (Scrollable) */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6">
            
            {/* TAB: ACCOUNT */}
            {activeTab === 'account' && (
              <div className="space-y-5 max-w-xl">
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-400 mb-1.5">
                    Profile Photo URL
                  </label>
                  <div className="flex items-center gap-3">
                    <img
                      src={photoURL}
                      alt={name}
                      className="h-12 w-12 rounded-2xl object-cover border border-neutral-300 dark:border-neutral-700 shrink-0"
                    />
                    <input
                      type="text"
                      value={photoURL}
                      onChange={(e) => setPhotoURL(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 text-xs px-3 py-2 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-neutral-400 mb-1.5">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-neutral-400 mb-1.5">
                      Account Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-neutral-400 mb-1.5">
                      Official Role
                    </label>
                    <input
                      type="text"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-neutral-400 mb-1.5">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full text-xs px-3 py-2 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-400 mb-1.5">
                    Presence Status Beacon
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['online', 'busy', 'away'] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPresence(p)}
                        className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                          userProfile.presence === p
                            ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-950/60 dark:border-indigo-700 dark:text-indigo-300'
                            : 'border-neutral-200 dark:border-white/10 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/5'
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${
                          p === 'online' ? 'bg-emerald-500' : p === 'busy' ? 'bg-rose-500' : 'bg-amber-500'
                        }`} />
                        <span className="capitalize">{p}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-3 border-t border-neutral-200 dark:border-white/10 flex justify-end">
                  <button
                    onClick={handleSaveProfile}
                    disabled={isSaving}
                    className="px-5 py-2 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-xs font-bold flex items-center gap-2 hover:opacity-90 transition-all cursor-pointer shadow-sm"
                  >
                    {isSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    <span>Save Account Changes</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB: WORKSPACE */}
            {activeTab === 'workspace' && (
              <div className="space-y-5 max-w-xl">
                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-400 mb-1.5">
                    Workspace Name
                  </label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className="w-full text-xs px-3 py-2 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-400 mb-1.5">
                    Workspace Vanity Slug
                  </label>
                  <div className="flex items-center">
                    <span className="px-3 py-2 rounded-l-xl border border-r-0 border-neutral-200 dark:border-white/10 bg-neutral-100 dark:bg-neutral-800 text-neutral-500 text-xs font-mono">
                      https://
                    </span>
                    <input
                      type="text"
                      value={subdomain}
                      onChange={(e) => setSubdomain(e.target.value)}
                      className="flex-1 text-xs px-3 py-2 border-y border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60 font-mono"
                    />
                    <span className="px-3 py-2 rounded-r-xl border border-l-0 border-neutral-200 dark:border-white/10 bg-neutral-100 dark:bg-neutral-800 text-neutral-500 text-xs font-mono">
                      .obsidian.crm
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10 bg-neutral-50/50 dark:bg-neutral-900/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold">Team Seat Allocation</h4>
                      <p className="text-[11px] text-neutral-400">14 of 20 seats utilized across Executive & Operations roles</p>
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">70% Capacity</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full w-[70%]" />
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10 space-y-2">
                  <h4 className="text-xs font-bold">Connected API Gateway</h4>
                  <p className="text-[11px] text-neutral-400 font-mono">ENDPOINT: wss://obsidian.gateway.production/v4</p>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">Healthy (12ms latency)</span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: PREFERENCES */}
            {activeTab === 'preferences' && (
              <div className="space-y-5 max-w-xl">
                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold">Application Interface Theme</h4>
                    <p className="text-[11px] text-neutral-400">Switch between Crisp Obsidian Light or Stealth Dark Canvas</p>
                  </div>
                  <button
                    onClick={onToggleTheme}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-xs font-bold cursor-pointer"
                  >
                    {themeMode === 'light' ? (
                      <>
                        <Sun className="h-3.5 w-3.5 text-amber-500" />
                        <span>Light Mode</span>
                      </>
                    ) : (
                      <>
                        <Moon className="h-3.5 w-3.5 text-indigo-400" />
                        <span>Dark Mode</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold">Audio & Tone Chimes</h4>
                    <p className="text-[11px] text-neutral-400">Play subtle acoustic chime on inbound message or lead activity</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => setSoundEnabled(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold">Compact Information Density</h4>
                    <p className="text-[11px] text-neutral-400">Compress padding for high-volume lead pipelines and message tables</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={compactMode}
                    onChange={(e) => setCompactMode(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-neutral-400 mb-1.5">
                    Terminal Inactivity Timeout
                  </label>
                  <select
                    value={autoLockMinutes}
                    onChange={(e) => setAutoLockMinutes(e.target.value)}
                    className="text-xs px-3 py-2 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60"
                  >
                    <option value="5">5 Minutes</option>
                    <option value="15">15 Minutes (Default)</option>
                    <option value="30">30 Minutes</option>
                    <option value="60">1 Hour</option>
                  </select>
                </div>
              </div>
            )}

            {/* TAB: NOTIFICATIONS */}
            {activeTab === 'notifications' && (
              <div className="space-y-4 max-w-xl">
                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold">Instant Lead Dispatch Alerts</h4>
                    <p className="text-[11px] text-neutral-400">Push real-time badge on new customer inbound conversation</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifyLeadInstant}
                    onChange={(e) => setNotifyLeadInstant(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold">Social Media Publishing Confirmation</h4>
                    <p className="text-[11px] text-neutral-400">Notify when scheduled post transitions to Published on networks</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifySocialPublish}
                    onChange={(e) => setNotifySocialPublish(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold">Executive Email Digests</h4>
                    <p className="text-[11px] text-neutral-400">Daily 08:00 AM briefing summarizing scheduled demos and post performance</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold">SMS Emergency Alerts</h4>
                    <p className="text-[11px] text-neutral-400">Instant SMS alert for VIP client escalations or webhook disruptions</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifySms}
                    onChange={(e) => setNotifySms(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* TAB: BILLING */}
            {activeTab === 'billing' && (
              <div className="space-y-5 max-w-xl">
                {/* Plan card */}
                <div className={`p-5 rounded-3xl border ${
                  themeMode === 'light'
                    ? 'bg-gradient-to-br from-indigo-50 to-purple-50 border-indigo-200 text-neutral-900'
                    : 'bg-gradient-to-br from-indigo-950/40 to-purple-950/30 border-indigo-900/60 text-white'
                }`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-600 text-white font-bold">
                        Active Subscription
                      </span>
                      <h3 className="text-xl font-black tracking-tight mt-2">Obsidian Enterprise VIP</h3>
                      <p className="text-xs text-neutral-500 dark:text-neutral-300 mt-1">
                        Unlimited omnichannel routing, high-trust WebRTC consultation, and multi-network social planner.
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-black">$499</span>
                      <span className="text-xs text-neutral-400 block font-mono">/ month</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-indigo-200/60 dark:border-white/10 flex items-center justify-between text-xs">
                    <span className="text-neutral-500 dark:text-neutral-400">Next billing cycle: October 1, 2026</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">Auto-Renew Active</span>
                  </div>
                </div>

                {/* Meters */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10">
                    <span className="text-[10px] font-mono text-neutral-400 uppercase">Social Broadcast Quota</span>
                    <h4 className="text-base font-bold mt-1">428 / Unlimited</h4>
                    <p className="text-[10px] text-emerald-600 font-semibold mt-0.5">Dispatched across 7 channels</p>
                  </div>
                  <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10">
                    <span className="text-[10px] font-mono text-neutral-400 uppercase">Cloud Storage (Recordings)</span>
                    <h4 className="text-base font-bold mt-1">18.4 GB / 250 GB</h4>
                    <p className="text-[10px] text-neutral-400 font-semibold mt-0.5">Encrypted cold storage</p>
                  </div>
                </div>

                {/* Invoices */}
                <div>
                  <h4 className="text-xs font-bold uppercase text-neutral-400 mb-2">Recent Invoices</h4>
                  <div className="space-y-2">
                    {[
                      { date: 'Sep 01, 2026', ref: 'INV-2026-09-OBS', amount: '$499.00', status: 'PAID' },
                      { date: 'Aug 01, 2026', ref: 'INV-2026-08-OBS', amount: '$499.00', status: 'PAID' }
                    ].map(inv => (
                      <div key={inv.ref} className="p-3 rounded-xl border border-neutral-200 dark:border-white/10 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold">{inv.ref}</span>
                          <span className="text-neutral-400 block text-[10px]">{inv.date}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold">{inv.amount}</span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
                            {inv.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: SECURITY */}
            {activeTab === 'security' && (
              <div className="space-y-5 max-w-xl">
                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold">Two-Factor Authentication (2FA)</h4>
                    <p className="text-[11px] text-neutral-400">TOTP Authenticator app required for console authentication</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={twoFactorEnabled}
                    onChange={(e) => setTwoFactorEnabled(e.target.checked)}
                    className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-xs font-bold">Terminal Quick Lock PIN</h4>
                      <p className="text-[11px] text-neutral-400">4-digit code used to resume locked executive session</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="text-xs text-neutral-400 hover:text-neutral-800 dark:hover:text-white"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type={showPin ? 'text' : 'password'}
                      maxLength={4}
                      value={terminalPin}
                      onChange={(e) => setTerminalPin(e.target.value)}
                      className="w-28 text-center tracking-widest font-mono text-base px-3 py-2 rounded-xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/60 font-bold"
                    />
                    <button
                      onClick={() => {
                        if (onShowToast) onShowToast('Terminal PIN code updated to: ' + terminalPin);
                      }}
                      className="px-3 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-bold hover:bg-neutral-200 cursor-pointer"
                    >
                      Update PIN
                    </button>
                  </div>
                </div>

                {/* Active sessions */}
                <div>
                  <h4 className="text-xs font-bold uppercase text-neutral-400 mb-2">Active Authenticated Devices</h4>
                  <div className="space-y-2">
                    <div className="p-3 rounded-xl border border-neutral-200 dark:border-white/10 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-3">
                        <Laptop className="h-5 w-5 text-indigo-500" />
                        <div>
                          <span className="font-bold">MacBook Pro 16" (Current Session)</span>
                          <span className="text-[10px] text-neutral-400 block font-mono">Chrome 128 • New York, USA</span>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
                        Active Now
                      </span>
                    </div>

                    <div className="p-3 rounded-xl border border-neutral-200 dark:border-white/10 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-3">
                        <Smartphone className="h-5 w-5 text-neutral-400" />
                        <div>
                          <span className="font-bold">iPhone 15 Pro Max</span>
                          <span className="text-[10px] text-neutral-400 block font-mono">Obsidian Mobile • 4 hours ago</span>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          if (onShowToast) onShowToast('Session revoked for iPhone 15 Pro Max.');
                        }}
                        className="text-xs text-rose-500 font-bold hover:underline cursor-pointer"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: CONNECTED ACCOUNTS */}
            {activeTab === 'connected_accounts' && (
              <div className="space-y-4 max-w-xl">
                <p className="text-xs text-neutral-500">
                  Manage social platform and enterprise identity providers linked to your profile:
                </p>

                {[
                  { name: 'LinkedIn Professional', id: 'linkedin', color: '#0A66C2', connected: true, handle: '@sarah_jenkins_lead' },
                  { name: 'X (Twitter)', id: 'twitter', color: '#000000', connected: true, handle: '@flowforge' },
                  { name: 'Instagram Creator', id: 'instagram', color: '#E1306C', connected: true, handle: '@flowforge.studio' },
                  { name: 'Facebook Brand Page', id: 'facebook', color: '#1877F2', connected: false, handle: 'Not connected' },
                  { name: 'TikTok Studio', id: 'tiktok', color: '#000000', connected: false, handle: 'Not connected' },
                  { name: 'YouTube Studio', id: 'youtube', color: '#FF0000', connected: false, handle: 'Not connected' }
                ].map(acc => (
                  <div key={acc.id} className="p-3.5 rounded-2xl border border-neutral-200 dark:border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div 
                        className="h-8 w-8 rounded-xl flex items-center justify-center text-white text-xs font-black shadow-xs"
                        style={{ backgroundColor: acc.color }}
                      >
                        {acc.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold">{acc.name}</h4>
                        <span className="text-[11px] text-neutral-400 font-mono">{acc.handle}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        if (onShowToast) {
                          onShowToast(`${acc.name} authentication ${acc.connected ? 'synced' : 'initiated'}.`);
                        }
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        acc.connected
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5'
                      }`}
                    >
                      {acc.connected ? 'Connected' : 'Connect'}
                    </button>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>
      </motion.div>
    </div>
  );
}
