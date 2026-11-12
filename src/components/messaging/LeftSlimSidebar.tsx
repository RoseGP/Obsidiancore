import React from 'react';
import { initialsAvatar } from './avatar';
import {
  MessageSquare,
  Users,
  Globe,
  Sliders,
  BookOpen,
  Circle,
  Zap,
  ChevronRight
} from 'lucide-react';
import { MessagingPlatformView, MessagingUser, UserStatus } from './types';

interface LeftSlimSidebarProps {
  currentView: MessagingPlatformView;
  onSelectView: (view: MessagingPlatformView) => void;
  currentUser: MessagingUser;
  onStatusChange: (status: UserStatus) => void;
  unreadCounts: {
    inbox: number;
    direct: number;
    visitors: number;
  };
}

export const LeftSlimSidebar: React.FC<LeftSlimSidebarProps> = ({
  currentView,
  onSelectView,
  currentUser,
  onStatusChange,
  unreadCounts
}) => {
  const statusColors: Record<UserStatus, string> = {
    online: 'bg-emerald-500 ring-emerald-500/20',
    busy: 'bg-amber-500 ring-amber-500/20',
    away: 'bg-indigo-500 ring-indigo-500/20',
    offline: 'bg-neutral-500 ring-neutral-500/20'
  };

  const navItems = [
    {
      id: 'inbox' as MessagingPlatformView,
      label: 'All Inbox',
      icon: MessageSquare,
      badge: unreadCounts.inbox
    },
    {
      id: 'visitors' as MessagingPlatformView,
      label: 'Live Visitors',
      icon: Globe,
      badge: unreadCounts.visitors
    },
    {
      id: 'direct' as MessagingPlatformView,
      label: 'Direct Messages',
      icon: Users,
      badge: unreadCounts.direct
    },
    {
      id: 'studio' as MessagingPlatformView,
      label: 'Widget Studio',
      icon: Sliders
    },
    {
      id: 'canned' as MessagingPlatformView,
      label: 'Canned Templates',
      icon: BookOpen
    }
  ];

  return (
    <aside className="hidden md:flex w-16 bg-[var(--surface-sunken)] backdrop-blur-xl border-r border-[var(--border)] flex-col items-center py-4 justify-between z-20 shrink-0 select-none">
      {/* Top Logo / App Brand */}
      <div className="flex flex-col items-center gap-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20 cursor-pointer transition-transform hover:scale-105">
          <Zap className="w-5 h-5 text-[var(--text)]" />
        </div>

        {/* Primary Navigation Icons */}
        <nav className="flex flex-col gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                id={`btn-nav-${item.id}`}
                onClick={() => onSelectView(item.id)}
                title={item.label}
                className={`relative group w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.badge && item.badge > 0 ? (
                  <span className="absolute -top-1 -right-1 px-1.5 py-0.2 bg-rose-500 text-white text-[10px] font-bold rounded-full ring-2 ring-neutral-950">
                    {item.badge}
                  </span>
                ) : null}

                {/* Tooltip */}
                <div className="absolute left-14 px-2.5 py-1 bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-xs font-medium rounded-md shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                  {item.label}
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Profile & Status Toggle */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative group">
          <div className="relative cursor-pointer">
            <img
              src={currentUser.avatar || initialsAvatar(currentUser.name)}
              alt={currentUser.name}
              className="w-10 h-10 rounded-xl object-cover ring-2 ring-[var(--border)] hover:ring-blue-500/40 transition-all"
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-neutral-950 ${
                statusColors[currentUser.status]
              }`}
            />
          </div>

          {/* Status Quick Popover */}
          <div className="absolute left-14 bottom-0 w-44 p-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all z-50">
            <div className="px-2 py-1 mb-1 border-b border-[var(--border)]">
              <p className="text-xs font-semibold text-[var(--text)] truncate">{currentUser.name}</p>
              <p className="text-[10px] text-[var(--text-muted)] capitalize">{currentUser.status}</p>
            </div>
            {(['online', 'busy', 'away', 'offline'] as UserStatus[]).map((st) => (
              <button
                key={st}
                onClick={() => onStatusChange(st)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  currentUser.status === st ? 'bg-[var(--border)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)]'
                }`}
              >
                <span className="flex items-center gap-2 capitalize">
                  <span className={`w-2 h-2 rounded-full ${statusColors[st]}`} />
                  {st}
                </span>
                {currentUser.status === st && <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default LeftSlimSidebar;
