import React, { useState } from 'react';
import { initialsAvatar } from './avatar';
import {
  Search,
  Plus,
  Globe,
  Users,
  MessageSquare,
  Flame,
  CheckCircle2,
  Clock,
  Filter,
  X,
  Pin,
  Briefcase,
  Layers,
  MoreVertical,
  Check,
  Trash2,
  MailCheck,
  Mail
} from 'lucide-react';
import {
  MessagingConversation,
  ConversationStatus,
  ConversationPriority,
  ConversationChannel,
  MessagingPlatformView
} from './types';

interface ConversationListColumnProps {
  conversations: MessagingConversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onOpenNewChatModal: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filterTab: 'all' | 'unread' | 'crm_linked' | 'groups' | 'direct' | 'pinned';
  onFilterTabChange: (tab: 'all' | 'unread' | 'crm_linked' | 'groups' | 'direct' | 'pinned') => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onRemoveConversation?: (id: string) => void;
  onTogglePinConversation?: (id: string) => void;
  onToggleReadConversation?: (id: string) => void;
  className?: string;
  currentView?: MessagingPlatformView;
  onSelectView?: (view: MessagingPlatformView) => void;
  unreadCounts?: {
    inbox: number;
    direct: number;
    visitors: number;
  };
}

export const ConversationListColumn: React.FC<ConversationListColumnProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onOpenNewChatModal,
  searchQuery,
  onSearchChange,
  filterTab,
  onFilterTabChange,
  isCollapsed = false,
  onToggleCollapse,
  onRemoveConversation,
  onTogglePinConversation,
  onToggleReadConversation,
  className = '',
  currentView = 'inbox',
  onSelectView,
  unreadCounts
}) => {
  const [activeMenuConvId, setActiveMenuConvId] = useState<string | null>(null);

  const getChannelBadge = (conv: MessagingConversation) => {
    if (conv.crmRecord) {
      return (
        <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
          <Briefcase className="w-2.5 h-2.5" /> {conv.crmRecord.type.toUpperCase()}
        </span>
      );
    }
    switch (conv.type) {
      case 'group':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20">
            <Users className="w-2.5 h-2.5" /> Group
          </span>
        );
      case 'widget':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
            <Globe className="w-2.5 h-2.5" /> Web Chat
          </span>
        );
      case 'direct':
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
            <MessageSquare className="w-2.5 h-2.5" /> Direct
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-neutral-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">
            <Layers className="w-2.5 h-2.5" /> Channel
          </span>
        );
    }
  };

  const getPriorityDot = (priority: ConversationPriority) => {
    if (priority === 'urgent' || priority === 'high') {
      return (
        <span className="flex items-center gap-0.5 text-[10px] font-bold text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded">
          <Flame className="w-2.5 h-2.5 text-rose-400" />
          {priority}
        </span>
      );
    }
    return null;
  };

  const formatTimestamp = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffHours < 24 && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diffHours < 48) {
      return 'Yesterday';
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Filter conversations
  const filtered = conversations.filter((c) => {
    if (filterTab === 'unread') return c.unreadCount > 0;
    if (filterTab === 'crm_linked') return !!c.crmRecord;
    if (filterTab === 'groups') return c.type === 'group';
    if (filterTab === 'direct') return c.type === 'direct';
    if (filterTab === 'pinned') return !!c.isPinned;
    return true;
  });

  const pinnedConversations = filtered.filter((c) => c.isPinned);
  const otherConversations = filtered.filter((c) => !c.isPinned);

  const renderConversationItem = (conv: MessagingConversation) => {
    const isActive = conv.id === activeConversationId;
    const isMenuOpen = activeMenuConvId === conv.id;

    // Display avatar logic
    const firstParticipant = conv.participants[0];
    const secondParticipant = conv.participants[1];
    const avatarUrl =
      secondParticipant?.avatar ||
      firstParticipant?.avatar ||
      initialsAvatar(conv.title);

    return (
      <div
        key={conv.id}
        onClick={() => {
          onSelectConversation(conv.id);
          setActiveMenuConvId(null);
        }}
        className={`group relative px-4 py-3 border-b border-white/5 cursor-pointer transition-all duration-150 select-none ${
          isActive
            ? 'bg-blue-600/15 border-blue-500/20'
            : 'hover:bg-white/[0.04]'
        }`}
      >
        <div className="flex items-start gap-3">
          {/* Avatar with Status Indicator */}
          <div className="relative shrink-0 mt-0.5">
            <img
              src={avatarUrl}
              alt={conv.title}
              className="w-10 h-10 rounded-xl object-cover ring-1 ring-white/10"
            />
            {/* Status dot */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-neutral-900 ${
                firstParticipant?.status === 'busy'
                  ? 'bg-amber-400'
                  : firstParticipant?.status === 'away'
                  ? 'bg-yellow-400'
                  : 'bg-emerald-400'
              }`}
            />
            {conv.isPinned && (
              <span className="absolute -top-1.5 -left-1.5 p-0.5 rounded-full bg-neutral-900 text-amber-400 border border-amber-400/30">
                <Pin className="w-2.5 h-2.5 fill-amber-400" />
              </span>
            )}
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <h4
                className={`text-xs font-semibold truncate ${
                  isActive ? 'text-white' : 'text-neutral-200'
                }`}
              >
                {conv.title}
              </h4>
              <span className="text-[10px] text-neutral-500 shrink-0 font-mono">
                {formatTimestamp(conv.lastMessage?.createdAt || conv.updatedAt)}
              </span>
            </div>

            {/* Badges row */}
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              {getChannelBadge(conv)}
              {getPriorityDot(conv.priority)}
              {conv.crmRecord?.value && (
                <span className="text-[10px] font-mono font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                  {conv.crmRecord.value}
                </span>
              )}
            </div>

            {/* Last message preview */}
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-neutral-400 truncate leading-snug">
                {conv.lastMessage ? (
                  <span>
                    {conv.lastMessage.senderName.split(' ')[0]}:{' '}
                    {conv.lastMessage.contentType === 'file'
                      ? `📎 ${conv.lastMessage.attachmentName || 'Attachment'}`
                      : conv.lastMessage.contentType === 'prompt'
                      ? `✨ [Prompt] ${conv.lastMessage.structuredPrompt?.title || 'Blueprint'}`
                      : conv.lastMessage.contentType === 'instruction'
                      ? `📋 [SOP] ${conv.lastMessage.structuredInstruction?.title || 'Checklist'}`
                      : conv.lastMessage.contentType === 'crm_activity'
                      ? `⚡ ${conv.lastMessage.content}`
                      : conv.lastMessage.content}
                  </span>
                ) : (
                  <span className="italic text-neutral-600">No messages yet</span>
                )}
              </p>

              {conv.unreadCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-blue-600 text-white font-bold text-[10px] shrink-0 animate-pulse">
                  {conv.unreadCount}
                </span>
              )}
            </div>
          </div>

          {/* Quick Context Menu Button */}
          <div className="shrink-0 relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveMenuConvId(isMenuOpen ? null : conv.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white transition cursor-pointer"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            {/* Context Dropdown */}
            {isMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-6 z-30 w-44 bg-neutral-900 border border-white/15 rounded-xl shadow-2xl p-1 text-xs text-neutral-300 animate-in fade-in zoom-in-95 duration-100"
              >
                {onTogglePinConversation && (
                  <button
                    onClick={() => {
                      onTogglePinConversation(conv.id);
                      setActiveMenuConvId(null);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/10 flex items-center gap-2 cursor-pointer"
                  >
                    <Pin className="w-3.5 h-3.5 text-amber-400" />
                    <span>{conv.isPinned ? 'Unpin Conversation' : 'Pin to Top'}</span>
                  </button>
                )}
                {onToggleReadConversation && (
                  <button
                    onClick={() => {
                      onToggleReadConversation(conv.id);
                      setActiveMenuConvId(null);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/10 flex items-center gap-2 cursor-pointer"
                  >
                    {conv.unreadCount > 0 ? (
                      <>
                        <MailCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Mark as Read</span>
                      </>
                    ) : (
                      <>
                        <Mail className="w-3.5 h-3.5 text-blue-400" />
                        <span>Mark as Unread</span>
                      </>
                    )}
                  </button>
                )}
                {onRemoveConversation && (
                  <button
                    onClick={() => {
                      onRemoveConversation(conv.id);
                      setActiveMenuConvId(null);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-500/15 text-rose-400 flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Archive / Delete</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`border-r border-white/5 bg-neutral-900/40 backdrop-blur-xl flex flex-col h-full shrink-0 transition-all duration-200 select-none ${
        isCollapsed ? 'w-0 overflow-hidden border-none' : 'w-80 md:w-88'
      } ${className}`}
    >
      {/* Mobile Channel Navigation Bar (Visible on Mobile Only) */}
      {onSelectView && (
        <div className="flex md:hidden items-center justify-around px-2 py-2 border-b border-white/10 bg-neutral-950/70 text-xs shrink-0">
          {[
            { id: 'inbox' as MessagingPlatformView, label: 'Inbox', badge: unreadCounts?.inbox },
            { id: 'visitors' as MessagingPlatformView, label: 'Visitors', badge: unreadCounts?.visitors },
            { id: 'direct' as MessagingPlatformView, label: 'Direct', badge: unreadCounts?.direct },
            { id: 'studio' as MessagingPlatformView, label: 'Widget' },
            { id: 'canned' as MessagingPlatformView, label: 'Templates' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectView(item.id)}
              className={`relative px-2.5 py-1.5 rounded-lg font-medium text-xs transition cursor-pointer flex items-center gap-1 ${
                currentView === item.id
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : 'text-neutral-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span>{item.label}</span>
              {item.badge && item.badge > 0 ? (
                <span className="px-1.5 py-0.2 bg-rose-500 text-white text-[9px] font-bold rounded-full">
                  {item.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {/* Top Header */}
      <div className="p-4 border-b border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white tracking-tight">Conversations</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
              {conversations.length}
            </span>
          </div>

          <button
            onClick={onOpenNewChatModal}
            title="Start New Conversation or Deal Room"
            className="p-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 transition cursor-pointer flex items-center gap-1 px-2.5 text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Search conversations, deals, emails..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-neutral-950/60 border border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          {[
            { id: 'all', label: 'All' },
            { id: 'unread', label: 'Unread' },
            { id: 'crm_linked', label: 'CRM Linked' },
            { id: 'groups', label: 'Groups' },
            { id: 'direct', label: 'Direct' },
            { id: 'pinned', label: 'Pinned' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => onFilterTabChange(tab.id as any)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition cursor-pointer ${
                filterTab === tab.id
                  ? 'bg-blue-600 text-white font-semibold'
                  : 'bg-white/5 text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {/* Pinned Section if any */}
        {pinnedConversations.length > 0 && filterTab !== 'pinned' && (
          <div>
            <div className="px-4 py-1.5 bg-neutral-950/40 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
              <span className="flex items-center gap-1">
                <Pin className="w-2.5 h-2.5 fill-amber-400" /> Pinned Conversations ({pinnedConversations.length})
              </span>
            </div>
            {pinnedConversations.map(renderConversationItem)}
          </div>
        )}

        {/* Remaining conversations */}
        {otherConversations.length > 0 ? (
          otherConversations.map(renderConversationItem)
        ) : pinnedConversations.length === 0 ? (
          <div className="p-8 text-center text-neutral-500 text-xs">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="font-semibold text-neutral-400">No conversations found</p>
            <p className="mt-1 text-[11px]">Create a new message or adjust search filters.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
