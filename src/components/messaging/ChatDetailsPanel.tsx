import React, { useState } from 'react';
import { initialsAvatar } from './avatar';
import {
  Globe,
  MapPin,
  Laptop,
  Clock,
  Tag,
  User,
  Shield,
  ExternalLink,
  Plus,
  X,
  Lock,
  BookOpen,
  Briefcase,
  CheckSquare,
  FileText,
  Activity,
  Users,
  Download,
  Eye,
  DollarSign,
  Building,
  Phone,
  Mail,
  ChevronRight
} from 'lucide-react';
import {
  MessagingConversation,
  MessagingMessage,
  MessagingUser,
  CannedResponse,
  CrmTaskRecord,
  CrmActivityLog
} from './types';

interface ChatDetailsPanelProps {
  conversation: MessagingConversation;
  messages: MessagingMessage[];
  registeredAgents: MessagingUser[];
  onUpdateConversation: (updates: Partial<MessagingConversation>) => void;
  cannedResponses: CannedResponse[];
  onInsertCanned: (text: string) => void;
  onRemoveConversation?: (id: string) => void;
  onOpenConvertToTask?: () => void;
  onPreviewDocument: (doc: {
    name: string;
    url?: string;
    size?: string;
    mime?: string;
    senderName?: string;
    timestamp?: string;
  }) => void;
  tasks: CrmTaskRecord[];
  activities: CrmActivityLog[];
  onToggleTaskStatus?: (taskId: string) => void;
  onClosePanel?: () => void;
  className?: string;
}

export const ChatDetailsPanel: React.FC<ChatDetailsPanelProps> = ({
  conversation,
  messages,
  registeredAgents,
  onUpdateConversation,
  cannedResponses,
  onInsertCanned,
  onRemoveConversation,
  onOpenConvertToTask,
  onPreviewDocument,
  tasks,
  activities,
  onToggleTaskStatus,
  onClosePanel,
  className = ''
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'files' | 'activity'>('overview');
  const [newTagInput, setNewTagInput] = useState('');
  const [showAddTag, setShowAddTag] = useState(false);

  const meta = conversation.visitorMetadata;
  const isVisitor = conversation.channel === 'widget' || !!meta;

  const handleAddTag = () => {
    const val = newTagInput.trim();
    if (!val) return;
    if (!conversation.tags.includes(val)) {
      onUpdateConversation({ tags: [...conversation.tags, val] });
    }
    setNewTagInput('');
    setShowAddTag(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onUpdateConversation({
      tags: conversation.tags.filter((t) => t !== tagToRemove)
    });
  };

  // Extract shared files from messages
  const sharedFiles = messages.filter((m) => m.contentType === 'file' || m.attachmentName);

  const crmRecord = conversation.crmRecord;

  // Primary participant display
  const primaryContact =
    conversation.participants.find((p) => p?.role === 'visitor') ||
    conversation.participants.find((p) => p.id !== 'user_agent_1') ||
    conversation.participants[0];

  return (
    <aside className={`w-80 lg:w-88 bg-neutral-900/60 backdrop-blur-xl border-l border-white/5 flex flex-col h-full overflow-hidden shrink-0 select-none divide-y divide-white/5 ${className}`}>
      {/* 1. Profile & Entity Overview Header */}
      <div className="p-5 flex flex-col items-center text-center relative bg-neutral-950/40 shrink-0">
        {onClosePanel && (
          <button
            onClick={onClosePanel}
            title="Close Panel"
            className="absolute top-4 left-4 p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {onRemoveConversation && (
          <button
            onClick={() => onRemoveConversation(conversation.id)}
            title="Archive Conversation"
            className="absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="relative mb-3">
          <img
            src={
              primaryContact?.avatar ||
              initialsAvatar(primaryContact?.name)
            }
            alt="Profile"
            className="w-16 h-16 rounded-2xl object-cover ring-2 ring-white/10 shadow-lg"
          />
          <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white shadow">
            {conversation.type.toUpperCase()}
          </span>
        </div>

        <h3 className="text-sm font-semibold text-white tracking-tight">{conversation.title}</h3>
        <p className="text-xs text-neutral-400 mt-0.5">
          {primaryContact?.email || meta?.email || 'contact@client-enterprise.io'}
        </p>

        {/* Linked CRM Badge */}
        {crmRecord && (
          <div className="mt-2.5 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 w-full flex items-center justify-between">
            <div className="flex items-center gap-1.5 truncate">
              <Briefcase className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-semibold truncate">{crmRecord.title}</span>
            </div>
            {crmRecord.value && (
              <span className="font-mono text-[10px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded">
                {crmRecord.value}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 2. Navigation Tabs */}
      <div className="grid grid-cols-4 p-1.5 bg-neutral-950/60 border-b border-white/5 text-xs font-semibold shrink-0">
        {[
          { id: 'overview', label: 'Details' },
          { id: 'tasks', label: `Tasks (${tasks.length})` },
          { id: 'files', label: `Files (${sharedFiles.length})` },
          { id: 'activity', label: 'Audit' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`py-1.5 text-center rounded-lg transition cursor-pointer text-[11px] ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-neutral-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 3. Tab Contents Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Tab: Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-4 text-xs">
            {/* Priority & Status Controls */}
            <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Room Priority</span>
                <select
                  value={conversation.priority}
                  onChange={(e) => onUpdateConversation({ priority: e.target.value as any })}
                  className="bg-neutral-950 border border-white/10 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Assigned Agent</span>
                <span className="font-medium text-white">Alex Rivera</span>
              </div>

              {crmRecord?.companyName && (
                <div className="flex items-center justify-between">
                  <span className="text-neutral-400">Company</span>
                  <span className="font-medium text-white">{crmRecord.companyName}</span>
                </div>
              )}
            </div>

            {/* Conversation Tags */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5" /> Tags
                </span>
                <button
                  onClick={() => setShowAddTag(!showAddTag)}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium flex items-center gap-0.5 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>

              {showAddTag && (
                <div className="flex gap-1.5 mb-2">
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                    placeholder="New tag..."
                    className="flex-1 bg-neutral-950 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleAddTag}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-medium text-xs cursor-pointer"
                  >
                    Save
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {conversation.tags.map((t) => (
                  <span
                    key={t}
                    className="group inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-white/5 border border-white/10 text-neutral-300 hover:border-white/20"
                  >
                    <span>{t}</span>
                    <button
                      onClick={() => handleRemoveTag(t)}
                      className="text-neutral-500 hover:text-rose-400 opacity-60 group-hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Participants Stack */}
            <div>
              <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center gap-1 mb-2">
                <Users className="w-3.5 h-3.5" /> Participants ({conversation.participants.length})
              </span>
              <div className="space-y-1.5">
                {conversation.participants.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5"
                  >
                    <div className="flex items-center gap-2">
                      <img src={p.avatar || initialsAvatar(p.name)} alt={p.name} className="w-6 h-6 rounded-lg object-cover" />
                      <div>
                        <p className="font-semibold text-white text-xs">{p.name}</p>
                        <p className="text-[10px] text-neutral-400">{p.department || p.role}</p>
                      </div>
                    </div>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        p.status === 'busy' ? 'bg-amber-400' : p.status === 'away' ? 'bg-yellow-400' : 'bg-emerald-400'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tab: Tasks */}
        {activeTab === 'tasks' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Actionable Tasks
              </span>
              {onOpenConvertToTask && (
                <button
                  onClick={onOpenConvertToTask}
                  className="px-2.5 py-1 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 text-xs font-semibold flex items-center gap-1 hover:bg-blue-600/30 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> New Task
                </button>
              )}
            </div>

            {tasks.length === 0 ? (
              <div className="p-6 text-center text-neutral-500">
                <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No CRM tasks assigned to this room yet.</p>
                <p className="text-[11px] mt-1">Hover over any message and click "Convert to Task".</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => {
                  const isDone = task.status === 'completed';
                  return (
                    <div
                      key={task.id}
                      className={`p-3 rounded-xl border transition ${
                        isDone
                          ? 'bg-neutral-950/40 border-white/5 opacity-60'
                          : 'bg-white/5 border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={isDone}
                          onChange={() => onToggleTaskStatus && onToggleTaskStatus(task.id)}
                          className="mt-0.5 rounded border-white/20 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`font-semibold text-white truncate ${isDone ? 'line-through' : ''}`}>
                            {task.title}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-neutral-400">
                            <span className="text-amber-400 font-medium capitalize">
                              {task.priority} Priority
                            </span>
                            <span>•</span>
                            <span>Assigned to {task.assignee}</span>
                            {task.dueDate && (
                              <>
                                <span>•</span>
                                <span>Due {task.dueDate}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab: Files */}
        {activeTab === 'files' && (
          <div className="space-y-3 text-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 block">
              Shared Documents & Specifications
            </span>

            {sharedFiles.length === 0 ? (
              <div className="p-6 text-center text-neutral-500">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No documents uploaded yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sharedFiles.map((fileMsg) => (
                  <div
                    key={fileMsg.id}
                    className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between gap-2.5 hover:border-white/20 transition"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate text-xs">
                          {fileMsg.attachmentName || 'Shared Document.pdf'}
                        </p>
                        <p className="text-[10px] text-neutral-400">{fileMsg.attachmentSize || '1.8 MB'}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() =>
                          onPreviewDocument({
                            name: fileMsg.attachmentName || 'Document.pdf',
                            url: fileMsg.attachmentUrl,
                            size: fileMsg.attachmentSize,
                            mime: fileMsg.attachmentMime,
                            senderName: fileMsg.senderName,
                            timestamp: new Date(fileMsg.createdAt).toLocaleTimeString()
                          })
                        }
                        className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                        title="Preview"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {fileMsg.attachmentUrl && (
                        <a
                          href={fileMsg.attachmentUrl}
                          download={fileMsg.attachmentName}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                          title="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab: Activity Audit */}
        {activeTab === 'activity' && (
          <div className="space-y-3 text-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 block">
              Audit & Activity Trail
            </span>

            {activities.length === 0 ? (
              <div className="p-6 text-center text-neutral-500">
                <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No recent room activities.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {activities.map((act) => (
                  <div key={act.id} className="p-2.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-white">{act.title}</span>
                      <span className="text-[10px] text-neutral-500">{act.timestamp}</span>
                    </div>
                    <p className="text-[11px] text-neutral-400">{act.description}</p>
                    <p className="text-[10px] text-blue-400 font-medium">Logged by {act.actorName}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
