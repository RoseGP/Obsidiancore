import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Settings, 
  LogOut, 
  ChevronDown, 
  Check, 
  Sparkles, 
  ShieldCheck, 
  User as UserIcon, 
  Lock,
  Moon,
  Sun,
  Shield,
  Clock,
  KeyRound,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';

export interface SidebarUserProfileProps {
  isExpanded: boolean;
  onOpenSettings?: () => void;
  onOpenProfileModal?: () => void;
  onOpenSessionsModal?: () => void;
}

export const SidebarUserProfile: React.FC<SidebarUserProfileProps> = ({
  isExpanded,
  onOpenSettings,
  onOpenProfileModal,
  onOpenSessionsModal,
}) => {
  const { 
    user, 
    userProfile, 
    isAuthenticated, 
    logout, 
    setPresence, 
    lockSession,
    authError 
  } = useAuth();

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleStatusChange = async (newPresence: 'online' | 'busy' | 'away') => {
    await setPresence(newPresence);
    setIsOpen(false);
  };

  const handleProfileClick = () => {
    setIsOpen(false);
    if (onOpenProfileModal) {
      onOpenProfileModal();
    } else if (onOpenSettings) {
      onOpenSettings();
    }
  };

  const handleSettingsClick = () => {
    setIsOpen(false);
    if (onOpenSettings) {
      onOpenSettings();
    } else if (onOpenProfileModal) {
      onOpenProfileModal();
    }
  };

  const handleSessionsClick = () => {
    setIsOpen(false);
    if (onOpenSessionsModal) {
      onOpenSessionsModal();
    } else if (onOpenSettings) {
      onOpenSettings();
    }
  };

  const handleLockClick = () => {
    setIsOpen(false);
    lockSession();
  };

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
  };

  // Luxury Status color mappings
  const presenceConfig = {
    online: {
      ring: 'ring-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.35)]',
      dot: 'bg-emerald-500',
      ping: 'bg-emerald-400',
      label: 'Online',
    },
    busy: {
      ring: 'ring-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.35)]',
      dot: 'bg-rose-500',
      ping: 'bg-rose-400',
      label: 'Busy / In Call',
    },
    away: {
      ring: 'ring-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.35)]',
      dot: 'bg-amber-500',
      ping: 'bg-amber-400',
      label: 'Away',
    },
  };

  const currentPresence = presenceConfig[(userProfile.presence as 'online' | 'busy' | 'away') || 'online'] || presenceConfig.online;

  return (
    <div 
      ref={containerRef}
      id="sidebar-user-profile-container"
      className="relative px-2.5 py-2.5 border-b border-white/5 bg-gradient-to-b from-slate-900/80 to-transparent"
    >
      {/* Trigger Button: User Avatar + Identity details */}
      <button
        ref={triggerRef}
        id="sidebar-user-profile-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="sidebar-profile-dropdown-menu"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center rounded-2xl p-1.5 transition-all duration-200 group focus:outline-none focus:ring-1 focus:ring-emerald-500/50 cursor-pointer ${
          isOpen 
            ? 'bg-white/[0.08] ring-1 ring-white/10 shadow-lg' 
            : 'hover:bg-white/[0.04] active:bg-white/[0.06]'
        }`}
        title={`${userProfile.displayName || 'Executive'} (${userProfile.email || ''}) - Click to manage profile & settings`}
      >
        {/* Avatar Container with glowing status ring */}
        <div id="profile-avatar-wrapper" className="relative shrink-0 flex items-center justify-center">
          <div className={`h-9 w-9 rounded-xl p-[2px] transition-all duration-300 ring-2 ${currentPresence.ring} bg-gradient-to-br from-neutral-800 to-neutral-900 overflow-hidden`}>
            <img
              id="sidebar-profile-avatar-img"
              src={userProfile.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120'}
              alt={userProfile.displayName || 'User Profile Avatar'}
              className="h-full w-full rounded-[9px] object-cover"
              referrerPolicy="no-referrer"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120';
              }}
            />
          </div>

          {/* Glowing dynamic status beacon dot */}
          <span 
            id="sidebar-profile-status-indicator"
            className="obsidian absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-[var(--obsidian-0)] flex items-center justify-center ring-1 ring-white/20"
          >
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${currentPresence.ping}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${currentPresence.dot}`} />
            </span>
          </span>
        </div>

        {/* User Identity Details (Expanded View) */}
        {isExpanded && (
          <div className="ml-3 flex-1 min-w-0 text-left overflow-hidden">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-neutral-200 truncate tracking-tight group-hover:text-white transition-colors">
                {userProfile.displayName || 'Executive Director'}
              </span>
              {isAuthenticated && (
                <span title="Verified Workspace Session">
                  <ShieldCheck className="h-3 w-3 text-emerald-400 shrink-0" />
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-neutral-400 truncate max-w-[130px] font-mono">
                {userProfile.email || 'operator@obsidian.crm'}
              </span>
            </div>
          </div>
        )}

        {/* Dropdown Indicator Chevron */}
        {isExpanded && (
          <div className="ml-1 shrink-0 text-neutral-400 group-hover:text-neutral-200 transition-colors">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180 text-emerald-400' : ''}`} />
          </div>
        )}
      </button>

      {/* Luxury Obsidian Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            id="sidebar-profile-dropdown-menu"
            role="menu"
            aria-label="User Profile and Account Menu"
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute z-50 rounded-2xl p-2 select-none shadow-[0_25px_60px_rgba(0,0,0,0.9)] border border-white/10 bg-[#0B0C10]/95 backdrop-blur-2xl text-neutral-200 ${
              isExpanded 
                ? 'top-full left-2 right-2 mt-1.5' 
                : 'top-2 left-full ml-3 w-64'
            }`}
          >
            {/* Header / Identity Pill with Obsidian Luxury Gradient */}
            <div className="p-3 rounded-xl bg-gradient-to-br from-indigo-950/40 via-purple-950/20 to-white/[0.02] border border-white/10 mb-2">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl overflow-hidden shrink-0 border border-white/15 shadow-sm">
                  <img
                    src={userProfile.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120'}
                    alt={userProfile.displayName || 'Profile'}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-white truncate">
                      {userProfile.displayName || 'Rene Pierrette'}
                    </p>
                    <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded font-bold bg-indigo-600/90 text-white">
                      VIP
                    </span>
                  </div>
                  <p className="text-[10px] text-neutral-400 truncate font-mono mt-0.5">
                    {userProfile.email || 'rpierrette45@gmail.com'}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-[10px]">
                <span className="text-neutral-400 flex items-center gap-1 font-mono">
                  <span className={`h-1.5 w-1.5 rounded-full ${currentPresence.dot}`} />
                  <span>{currentPresence.label}</span>
                </span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {userProfile.role || 'Executive Director'}
                </span>
              </div>
            </div>

            {/* Status Switcher Section */}
            <div className="px-2 py-1 select-none">
              <span className="text-[9px] font-bold text-neutral-500 uppercase tracking-wider font-mono">Set Operational Status</span>
            </div>
            <div className="grid grid-cols-3 gap-1 mb-2">
              {(['online', 'busy', 'away'] as const).map((statusKey) => {
                const config = presenceConfig[statusKey];
                const isSelected = userProfile.presence === statusKey;
                return (
                  <button
                    key={statusKey}
                    id={`profile-status-btn-${statusKey}`}
                    type="button"
                    onClick={() => handleStatusChange(statusKey)}
                    className={`py-1 px-1 rounded-lg text-[10px] font-bold text-center transition-all cursor-pointer ${
                      isSelected 
                        ? statusKey === 'online' ? 'bg-emerald-600 text-white shadow-xs' :
                          statusKey === 'busy' ? 'bg-rose-600 text-white shadow-xs' :
                          'bg-amber-600 text-white shadow-xs'
                        : 'bg-white/[0.04] hover:bg-white/[0.08] text-neutral-400 hover:text-white'
                    }`}
                  >
                    <span>{statusKey === 'online' ? '● Online' : statusKey === 'busy' ? '■ Busy' : '▲ Away'}</span>
                  </button>
                );
              })}
            </div>

            {/* Divider */}
            <div className="h-px bg-white/5 my-1" />

            {/* Menu Items */}
            <div className="space-y-0.5">
              {/* Profile Option */}
              <button
                id="profile-dropdown-btn-profile"
                role="menuitem"
                type="button"
                onClick={handleProfileClick}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium text-neutral-200 hover:text-white hover:bg-white/[0.06] transition-colors text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <UserIcon className="h-4 w-4 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
                  <span>Profile</span>
                </div>
                <span className="text-[10px] text-neutral-500 font-mono">View Info</span>
              </button>

              {/* Account Settings Option */}
              <button
                id="profile-dropdown-btn-settings"
                role="menuitem"
                type="button"
                onClick={handleSettingsClick}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium text-neutral-200 hover:text-white hover:bg-white/[0.06] transition-colors text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Settings className="h-4 w-4 text-purple-400 group-hover:text-purple-300 transition-colors" />
                  <span>Account Settings</span>
                </div>
                <span className="text-[10px] text-neutral-500 font-mono">Workspace</span>
              </button>

              {/* Active Session & Device Security */}
              <button
                id="profile-dropdown-btn-sessions"
                role="menuitem"
                type="button"
                onClick={handleSessionsClick}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium text-neutral-200 hover:text-white hover:bg-white/[0.06] transition-colors text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-400 group-hover:text-emerald-300 transition-colors" />
                  <span>Active Session</span>
                </div>
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[9px] font-mono font-bold">
                  Active
                </span>
              </button>

              {/* Lock Session Option */}
              <button
                id="profile-dropdown-btn-lock"
                role="menuitem"
                type="button"
                onClick={handleLockClick}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium text-amber-300/90 hover:text-amber-200 hover:bg-amber-500/10 transition-colors text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <Lock className="h-4 w-4 text-amber-400 group-hover:text-amber-300 transition-colors" />
                  <span>Lock Console</span>
                </div>
                <span className="text-[10px] text-amber-500/70 font-mono">PIN lock</span>
              </button>
            </div>

            {/* Auth Error Toast if any */}
            {authError && (
              <div className="mx-1 my-1 p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px]">
                {authError}
              </div>
            )}

            {/* Divider */}
            <div className="h-px bg-white/5 my-1" />

            {/* Logout Option */}
            <button
              id="profile-dropdown-btn-logout"
              role="menuitem"
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors text-left group cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <LogOut className="h-4 w-4 text-rose-400 group-hover:translate-x-0.5 transition-transform" />
                <span>Logout</span>
              </div>
              <span className="text-[10px] text-rose-400/60 font-mono">Sign out</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SidebarUserProfile;
