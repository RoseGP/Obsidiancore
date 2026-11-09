import React, { useState, useRef, useEffect } from 'react';
import { 
  User, Settings, ShieldCheck, Bell, CreditCard, Sliders, 
  LogOut, ChevronDown, Check, Sparkles, Moon, Sun, 
  Lock, Globe, Share2, Layers, HelpCircle, ExternalLink, Shield
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { initialsAvatar } from './messaging/avatar';

interface TopNavProfileDropdownProps {
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  onLockSession?: () => void;
  onNavigateToSettings: (tab?: string) => void;
  onShowToast: (msg: string) => void;
  onOpenAuthFlow?: () => void;
}

export default function TopNavProfileDropdown({
  themeMode,
  onToggleTheme,
  onLockSession,
  onNavigateToSettings,
  onShowToast,
  onOpenAuthFlow
}: TopNavProfileDropdownProps) {
  const { userProfile, setPresence, logout, lockSession, isAuthenticated, isDemoSession } = useAuth();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close when clicked outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handlePresenceSwitch = async (newPresence: 'online' | 'busy' | 'away') => {
    await setPresence(newPresence);
    onShowToast(`Status set to ${newPresence}.`);
  };

  const handleLogoutClick = async () => {
    setIsOpen(false);
    await logout();
    onShowToast('Signed out.');
  };

  const presenceDetails = {
    online: { label: 'Online', color: 'bg-emerald-500', ring: 'ring-emerald-500/30' },
    busy: { label: 'Busy / In Call', color: 'bg-rose-500', ring: 'ring-rose-500/30' },
    away: { label: 'Away', color: 'bg-amber-500', ring: 'ring-amber-500/30' }
  };

  const currentPresence = presenceDetails[userProfile.presence || 'online'];

  return (
    <div ref={dropdownRef} className="relative select-none">
      {/* TRIGGER BUTTON (Top Right Navigation Area) */}
      <button
        id="top-nav-profile-button"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2.5 p-1.5 pl-2.5 rounded-2xl border text-xs font-medium transition-all cursor-pointer shadow-2xs ${
          themeMode === 'light'
            ? 'bg-white hover:bg-neutral-50/90 border-neutral-200/90 text-neutral-800'
            : 'bg-neutral-900/70 hover:bg-neutral-800/80 border-white/10 text-neutral-200'
        }`}
        title="Your account"
      >
        {/* Avatar with beacon */}
        <div className="relative shrink-0">
          <img
            src={userProfile.photoURL || initialsAvatar(userProfile.displayName || userProfile.email)}
            alt={userProfile.displayName || 'Profile'}
            className="h-8 w-8 rounded-xl object-cover border border-neutral-300 dark:border-neutral-700 shadow-2xs"
            referrerPolicy="no-referrer"
          />
          <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 ${
            themeMode === 'light' ? 'border-white' : 'border-neutral-900'
          } ${currentPresence.color}`} />
        </div>

        {/* User text details */}
        <div className="hidden sm:flex flex-col text-left pr-1">
          <span className="text-xs font-bold leading-tight truncate max-w-[130px]">
            {userProfile.displayName || userProfile.email || 'Your account'}
          </span>
          <span className="text-[10px] text-neutral-400 font-mono leading-tight truncate max-w-[130px]">
            {userProfile.email}
          </span>
        </div>

        <ChevronDown className={`h-3.5 w-3.5 text-neutral-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-500' : ''}`} />
      </button>

      {/* DROPDOWN MENU */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 6 }}
            transition={{ duration: 0.15 }}
            className={`absolute right-0 top-full mt-2 w-80 rounded-2xl border shadow-2xl z-50 p-2 text-xs overflow-hidden ${
              themeMode === 'light'
                ? 'bg-white border-neutral-200 text-neutral-800'
                : 'bg-[var(--obsidian-0)] border-white/10 text-neutral-200'
            }`}
          >
            {/* Header Profile Summary */}
            <div className={`p-3 rounded-xl border mb-2 ${
              themeMode === 'light'
                ? 'bg-gradient-to-br from-indigo-50/70 via-purple-50/40 to-white border-indigo-100 text-neutral-900'
                : 'bg-gradient-to-br from-indigo-950/40 via-purple-950/20 to-transparent border-indigo-900/50 text-white'
            }`}>
              <div className="flex items-center gap-3">
                <img
                  src={userProfile.photoURL || initialsAvatar(userProfile.displayName || userProfile.email)}
                  alt="Profile"
                  className="h-11 w-11 rounded-xl object-cover border-2 border-white dark:border-neutral-800 shadow-xs"
                  referrerPolicy="no-referrer"
                />
                <div className="overflow-hidden flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs truncate">{userProfile.displayName || userProfile.email || 'Your account'}</h4>
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded font-bold bg-indigo-600 text-white">
                      VIP
                    </span>
                  </div>
                  <p className="text-[10.5px] text-neutral-500 dark:text-neutral-300 truncate font-mono mt-0.5">
                    {userProfile.email}
                  </p>
                  <span className="inline-block mt-1 px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 text-[9px] font-extrabold uppercase">
                    {userProfile.role || 'Executive Director'}
                  </span>
                </div>
              </div>

              {/* Status Presence Pills */}
              <div className="mt-3 pt-2.5 border-t border-neutral-200/70 dark:border-white/10">
                <span className="text-[9.5px] font-bold uppercase text-neutral-400 block mb-1 font-mono">
                  Presence Status:
                </span>
                <div className="grid grid-cols-3 gap-1">
                  {(['online', 'busy', 'away'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handlePresenceSwitch(p)}
                      className={`py-1 px-1 rounded-lg text-[10px] font-bold text-center transition-all cursor-pointer ${
                        userProfile.presence === p
                          ? p === 'online' ? 'bg-emerald-600 text-white shadow-xs' :
                            p === 'busy' ? 'bg-rose-600 text-white shadow-xs' :
                            'bg-amber-600 text-white shadow-xs'
                          : themeMode === 'light'
                            ? 'bg-white/80 hover:bg-white text-neutral-600 border border-neutral-200/80'
                            : 'bg-white/5 hover:bg-white/10 text-neutral-400'
                      }`}
                    >
                      <span className="capitalize">{p === 'online' ? '● Online' : p === 'busy' ? '■ Busy' : '▲ Away'}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Menu Items: Section 1 (Profile & Workspace) */}
            <div className="space-y-0.5 pb-1 border-b border-neutral-200 dark:border-white/10 mb-1">
              <button
                type="button"
                id="menu-item-account-settings"
                onClick={() => {
                  setIsOpen(false);
                  onNavigateToSettings('account');
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 font-medium transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <User className="h-4 w-4 text-indigo-500" />
                  <span>Your profile</span>
                </div>
                <span className="text-[10px] text-neutral-400">Profile & Info</span>
              </button>

              <button
                type="button"
                id="menu-item-workspace-settings"
                onClick={() => {
                  setIsOpen(false);
                  onNavigateToSettings('workspace');
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 font-medium transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Layers className="h-4 w-4 text-purple-500" />
                  <span>Organization &amp; plan</span>
                </div>
                <span className="text-[10px] text-neutral-400">Members, plan</span>
              </button>

            </div>

            {/* Menu Items: Section 2 (Platform & Operations) */}
            <div className="space-y-0.5 pb-1 border-b border-neutral-200 dark:border-white/10 mb-1">
              <button
                type="button"
                id="menu-item-notifications"
                onClick={() => {
                  setIsOpen(false);
                  onNavigateToSettings('notifications');
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 font-medium transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Bell className="h-4 w-4 text-amber-500" />
                  <span>Notifications</span>
                </div>
              </button>



              <button
                type="button"
                id="menu-item-security"
                onClick={() => {
                  setIsOpen(false);
                  onNavigateToSettings('security');
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 font-medium transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Lock className="h-4 w-4 text-teal-500" />
                  <span>Security</span>
                </div>
                <span className="text-[10px] text-neutral-400">Password, devices</span>
              </button>

              <button
                type="button"
                id="menu-item-social-accounts"
                onClick={() => {
                  setIsOpen(false);
                  onNavigateToSettings('channels');
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 font-medium transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  <Globe className="h-4 w-4 text-cyan-500" />
                  <span>Connected accounts</span>
                </div>
                <span className="text-[10px] text-neutral-400">LinkedIn, X, etc.</span>
              </button>
            </div>

            {/* Bottom Actions: Theme Toggle, Lock, Switch Account, Logout */}
            <div className="pt-1 space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  onToggleTheme();
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 font-medium transition-colors cursor-pointer text-left"
              >
                <div className="flex items-center gap-2.5">
                  {themeMode === 'light' ? (
                    <Moon className="h-4 w-4 text-slate-700" />
                  ) : (
                    <Sun className="h-4 w-4 text-amber-400" />
                  )}
                  <span>{themeMode === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}</span>
                </div>
                <span className="text-[10px] text-neutral-400 capitalize">{themeMode}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  lockSession();
                  if (onLockSession) onLockSession();
                  onShowToast('Session locked.');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 text-amber-500 dark:text-amber-400 font-medium transition-colors cursor-pointer text-left"
              >
                <Lock className="h-4 w-4 text-amber-400" />
                <span>Lock screen</span>
              </button>

              {onOpenAuthFlow && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenAuthFlow();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/5 text-indigo-500 dark:text-indigo-400 font-medium transition-colors cursor-pointer text-left"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>Switch account</span>
                </button>
              )}

              <button
                type="button"
                id="menu-item-logout"
                onClick={handleLogoutClick}
                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-bold transition-colors cursor-pointer text-left"
              >
                <LogOut className="h-4 w-4" />
                <span>Sign out</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
