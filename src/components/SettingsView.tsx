/**
 * Settings. Every tab shows real data or says plainly what isn't available yet.
 *   Account        profile saved to your user record; presence
 *   Organization   members, invitations, roles, keys, meeting plan (server-enforced)
 *   Notifications  notification preferences
 *   Security       password change (Firebase), sign out on all devices
 *   Connected accounts → managed in Social Planner (server-side, encrypted tokens)
 *   Real-time sync connection status
 *   Integrations, Plan administration (platform admins only)
 */
import React, { useEffect, useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { useRealtimeSync } from '../context/RealtimeSyncContext';
import { useCommand } from '../context/CommandContext';
import { auth as firebaseAuth } from '../lib/firebase';
import { getApiAuthHeaders } from '../lib/apiAuth';
import IntegrationsSettingsSection from './IntegrationsSettingsSection';
import NotificationPreferencesModal from './notifications/NotificationPreferencesModal';
import OrganizationSettings from './OrganizationSettings';
import MeetingAdminPanel, { usePlatformAdmin } from './meetings/MeetingAdminPanel';
import {
  User, Building2, Bell, ShieldCheck, Share2, Wifi, Layers, Sliders, CheckCircle2, AlertCircle,
  RefreshCw, Activity, Users, Eye, EyeOff, LogOut, Monitor, ArrowRight,
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
  | 'plan-admin'
  | 'general';

interface SettingsViewProps {
  defaultTab?: SettingsTab;
}

const card = 'rounded-2xl p-6 bg-neutral-900/40 border border-white/5 backdrop-blur-md space-y-4';
const input = 'w-full text-xs font-medium bg-neutral-950/80 border border-white/10 rounded-xl p-3 text-white outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500';
const label = 'block text-xs font-semibold text-neutral-300 mb-1.5';
const primaryBtn = 'px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all shadow-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

/** Old tab names (links, bookmarks) map onto the tabs that exist now. */
function normalizeTab(tab: SettingsTab): SettingsTab {
  if (tab === 'general' || tab === 'billing' || tab === 'roles-rbac') return 'workspace';
  if (tab === 'sessions') return 'security';
  if (tab === 'social-db') return 'channels';
  return tab;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

function describeDevice() {
  if (typeof navigator === 'undefined') return 'This device';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export default function SettingsView({ defaultTab = 'account' }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(normalizeTab(defaultTab));
  useEffect(() => { if (defaultTab) setActiveTab(normalizeTab(defaultTab)); }, [defaultTab]);

  const { user, userProfile, updateProfileDetails, setPresence, logout } = useAuth();
  const realtimeSync = useRealtimeSync();
  const { setActiveView } = useCommand();
  const isPlatformAdmin = usePlatformAdmin();

  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const say = (kind: 'ok' | 'error', text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 4500);
  };

  // --- Account ---
  const [displayName, setDisplayName] = useState(userProfile.displayName || '');
  const [photoURL, setPhotoURL] = useState(userProfile.photoURL || '');
  const [savingProfile, setSavingProfile] = useState(false);
  useEffect(() => {
    setDisplayName(userProfile.displayName || '');
    setPhotoURL(userProfile.photoURL || '');
  }, [userProfile.displayName, userProfile.photoURL]);

  const saveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (photoURL && !/^https:\/\//.test(photoURL)) { say('error', 'The photo link must start with https://'); return; }
    setSavingProfile(true);
    try {
      await updateProfileDetails({ displayName: displayName.trim(), photoURL: photoURL.trim() });
      say('ok', user ? 'Profile saved.' : 'Profile saved in this browser (you are using a sandbox sign-in).');
    } catch {
      say('error', 'Your profile couldn\'t be saved. Try again.');
    } finally {
      setSavingProfile(false);
    }
  };

  // --- Security ---
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const fbUser: any = (firebaseAuth as any)?.currentUser || null;
  const usesPassword = !!fbUser?.providerData?.some((p: any) => p?.providerId === 'password');
  const providerNames = (fbUser?.providerData || []).map((p: any) => (p?.providerId === 'google.com' ? 'Google' : p?.providerId === 'password' ? 'email and password' : p?.providerId)).filter(Boolean);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) { say('error', 'Use at least 8 characters for the new password.'); return; }
    if (newPassword !== confirmPassword) { say('error', 'The new passwords don\'t match.'); return; }
    if (!fbUser?.email) { say('error', 'Password changes need an email sign-in.'); return; }
    setChangingPassword(true);
    try {
      await reauthenticateWithCredential(fbUser, EmailAuthProvider.credential(fbUser.email, currentPassword));
      await updatePassword(fbUser, newPassword);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      say('ok', 'Password changed.');
    } catch (err: any) {
      const code = String(err?.code || '');
      say('error', code.includes('wrong-password') || code.includes('invalid-credential') ? 'Your current password is incorrect.'
        : code.includes('weak-password') ? 'That password is too weak. Try a longer one.'
        : code.includes('too-many-requests') ? 'Too many attempts. Wait a few minutes and try again.'
        : 'The password couldn\'t be changed. Try again.');
    } finally {
      setChangingPassword(false);
    }
  };

  const signOutEverywhere = async () => {
    if (!window.confirm('Sign out on every device, including this one?')) return;
    setRevoking(true);
    try {
      const res = await fetch('/api/account/sessions/revoke-all', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await getApiAuthHeaders()) } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || 'That didn\'t work. Try again.');
      await logout();
    } catch (err: any) {
      say('error', err?.message || 'That didn\'t work. Try again.');
    } finally {
      setRevoking(false);
    }
  };

  const TABS = [
    { id: 'account' as SettingsTab, label: 'Account', icon: User },
    { id: 'workspace' as SettingsTab, label: 'Organization & plan', icon: Building2 },
    { id: 'notifications' as SettingsTab, label: 'Notifications', icon: Bell },
    { id: 'security' as SettingsTab, label: 'Security', icon: ShieldCheck },
    { id: 'channels' as SettingsTab, label: 'Connected accounts', icon: Share2 },
    { id: 'realtime-sync' as SettingsTab, label: 'Live updates', icon: Wifi },
    { id: 'integrations' as SettingsTab, label: 'Integrations', icon: Layers },
    // Platform administrators only (PLATFORM_ADMIN_USER_IDS); the server enforces it too.
    ...(isPlatformAdmin ? [{ id: 'plan-admin' as SettingsTab, label: 'Plan administration', icon: Sliders }] : []),
  ];

  const lastSignIn = fbUser?.metadata?.lastSignInTime ? new Date(fbUser.metadata.lastSignInTime).toLocaleString() : null;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12" id="settings-workspace-root">
      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className="fixed bottom-6 right-6 left-6 sm:left-auto z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs font-semibold text-white shadow-2xl"
          style={{ background: '#12131c', border: `1px solid ${notice.kind === 'error' ? '#f43f5e' : '#10b981'}` }}
        >
          {notice.kind === 'error' ? <AlertCircle size={16} className="text-rose-400" /> : <CheckCircle2 size={16} className="text-emerald-400" />}
          <span>{notice.text}</span>
        </div>
      )}

      <div className="border-b border-white/5 pb-4">
        <h2 className="font-sans font-bold text-xl text-white tracking-tight">Settings</h2>
        <p className="text-xs text-neutral-400 mt-0.5">Your account, your organization, notifications and security.</p>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto p-1.5 rounded-2xl bg-neutral-950/80 border border-white/10" id="settings-tab-bar" role="tablist">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                active ? 'bg-indigo-600 text-white shadow-md' : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={14} className={active ? 'text-white' : 'text-neutral-400'} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'account' && (
        <div className={card}>
          <div className="border-b border-white/5 pb-4">
            <h3 className="text-base font-bold text-white">Your profile</h3>
            <p className="text-xs text-neutral-400 mt-0.5">How you appear to your team and in meetings.</p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-5 p-4 rounded-xl bg-neutral-950/40 border border-white/5">
            {photoURL ? (
              <img src={photoURL} alt="" className="h-16 w-16 rounded-2xl object-cover border-2 border-indigo-500/40 shrink-0" referrerPolicy="no-referrer" />
            ) : (
              <div className="h-16 w-16 rounded-2xl bg-slate-700 text-slate-100 flex items-center justify-center text-xl font-semibold shrink-0" aria-hidden="true">{initials(displayName || userProfile.email || '?')}</div>
            )}
            <div className="space-y-2 flex-1 min-w-0">
              <span className="text-sm font-bold text-white block truncate">{displayName || 'Add your name'}</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Your status">
                {(['online', 'busy', 'away'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={userProfile.presence === p}
                    onClick={async () => { await setPresence(p); say('ok', `Status set to ${p}.`); }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      userProfile.presence === p
                        ? p === 'online' ? 'bg-emerald-600 text-white' : p === 'busy' ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white'
                        : 'bg-white/5 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {p === 'online' ? 'Available' : p === 'busy' ? 'Busy' : 'Away'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <form onSubmit={saveAccount} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="settings-name" className={label}>Full name</label>
                <input id="settings-name" type="text" required maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={input} autoComplete="name" />
              </div>
              <div>
                <label htmlFor="settings-email" className={label}>Email</label>
                <input id="settings-email" type="email" value={userProfile.email || ''} readOnly className={`${input} opacity-70`} aria-describedby="settings-email-help" />
                <p id="settings-email-help" className="text-[11px] text-neutral-500 mt-1">Your sign-in email. It can't be changed here.</p>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="settings-photo" className={label}>Photo link (optional)</label>
                <input id="settings-photo" type="url" placeholder="https://…" value={photoURL} onChange={(e) => setPhotoURL(e.target.value)} className={input} />
              </div>
            </div>
            <p className="text-[11px] text-neutral-500">Your role and permissions come from your organization (Organization &amp; plan tab), not from this profile.</p>
            <div className="pt-2 flex justify-end">
              <button type="submit" disabled={savingProfile} className={primaryBtn}>{savingProfile ? 'Saving…' : 'Save profile'}</button>
            </div>
          </form>
        </div>
      )}

      {activeTab === 'workspace' && <OrganizationSettings />}

      {activeTab === 'notifications' && <NotificationPreferencesModal inline={true} />}

      {activeTab === 'security' && (
        <div className="space-y-6">
          <div className={card}>
            <div className="border-b border-white/5 pb-3">
              <h3 className="text-base font-bold text-white">Password</h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                {user ? `You sign in with ${providerNames.join(' and ') || 'your account'}.` : 'You are using a sandbox sign-in, which has no password.'}
              </p>
            </div>
            {usesPassword ? (
              <form onSubmit={changePassword} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="pw-current" className={label}>Current password</label>
                    <input id="pw-current" type={showPassword ? 'text' : 'password'} required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={input} />
                  </div>
                  <div>
                    <label htmlFor="pw-new" className={label}>New password</label>
                    <input id="pw-new" type={showPassword ? 'text' : 'password'} required minLength={8} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={input} />
                  </div>
                  <div>
                    <label htmlFor="pw-confirm" className={label}>Confirm new password</label>
                    <input id="pw-confirm" type={showPassword ? 'text' : 'password'} required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={input} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 cursor-pointer">
                    {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    <span>{showPassword ? 'Hide passwords' : 'Show passwords'}</span>
                  </button>
                  <button type="submit" disabled={changingPassword} className={primaryBtn}>{changingPassword ? 'Changing…' : 'Change password'}</button>
                </div>
              </form>
            ) : user ? (
              <p className="text-xs text-neutral-400">Your password is managed by {providerNames[0] || 'your sign-in provider'}. Change it there.</p>
            ) : null}
          </div>

          <div className={card}>
            <div className="border-b border-white/5 pb-3">
              <h3 className="text-base font-bold text-white">Where you're signed in</h3>
              <p className="text-xs text-neutral-400 mt-0.5">We can't list your other devices, but you can sign out of all of them at once.</p>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-neutral-950/40 border border-white/5">
              <Monitor size={18} className="text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">{describeDevice()} <span className="text-emerald-400">(this device)</span></p>
                {lastSignIn && <p className="text-[11px] text-neutral-500">Last signed in {lastSignIn}</p>}
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={signOutEverywhere} disabled={revoking || !user} className="px-4 py-2 rounded-xl border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 font-semibold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                <LogOut size={14} /> {revoking ? 'Signing out…' : 'Sign out on all devices'}
              </button>
            </div>
          </div>

          <div className={card}>
            <h3 className="text-base font-bold text-white">Two-step verification</h3>
            <p className="text-xs text-neutral-400">Not available yet. If you sign in with Google, turn on 2-Step Verification in your Google account to protect this sign-in too.</p>
          </div>
        </div>
      )}

      {activeTab === 'channels' && (
        <div className={card}>
          <h3 className="text-base font-bold text-white">Connected social accounts</h3>
          <p className="text-xs text-neutral-400">
            Social accounts are connected and managed in Social Planner. Access tokens are stored encrypted on the server and are never shown in the browser.
          </p>
          <button type="button" onClick={() => setActiveView('social_planner' as any)} className={`${primaryBtn} inline-flex items-center gap-1.5`}>
            Open Social Planner <ArrowRight size={14} />
          </button>
        </div>
      )}

      {activeTab === 'realtime-sync' && (
        <div className={card}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
            <div>
              <h3 className="text-base font-bold text-white">Live updates</h3>
              <p className="text-xs text-neutral-400">Changes made by your teammates appear here without reloading.</p>
            </div>
            <div className="flex items-center gap-2">
              {(import.meta as any).env?.DEV && (
                <button type="button" onClick={() => realtimeSync.simulateConcurrentConflict()} className="px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold cursor-pointer">
                  Test a conflict (development only)
                </button>
              )}
              <button type="button" onClick={() => realtimeSync.triggerStateResync()} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-200 text-xs font-semibold cursor-pointer flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-blue-400" /> Refresh now
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Response time</div>
              <div className="text-lg font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                <Activity className="w-4 h-4" />
                <span>{realtimeSync.latencyMs == null ? 'Measuring…' : `${realtimeSync.latencyMs} ms`}</span>
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Connected tabs</div>
              <div className="text-lg font-mono font-bold text-blue-400 flex items-center gap-1.5">
                <Users className="w-4 h-4" />
                <span>{realtimeSync.activeClients}</span>
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Status</div>
              <div className="text-lg font-bold text-white capitalize">{realtimeSync.syncStatus.replace('_', ' ')}</div>
              <div className="text-[10px] text-neutral-500">Last update: {realtimeSync.lastSyncTime}</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'integrations' && <IntegrationsSettingsSection />}

      {activeTab === 'plan-admin' && isPlatformAdmin && <MeetingAdminPanel />}
    </div>
  );
}
