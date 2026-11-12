import React, { useState } from 'react';
import { X, Users, MessageSquare, Briefcase, Plus, Tag, ArrowRight, Shield, Globe } from 'lucide-react';
import { MessagingUser, CrmRecordReference, ConversationType } from './types';

interface NewConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  registeredAgents: MessagingUser[];
  availableCrmRecords: CrmRecordReference[];
  onCreateConversation: (payload: {
    type: ConversationType;
    channel: 'internal' | 'crm' | 'widget' | 'email';
    title: string;
    participantIds: string[];
    priority: 'low' | 'medium' | 'high' | 'urgent';
    tags: string[];
    crmRecord?: CrmRecordReference;
  }) => void;
}

export const NewConversationModal: React.FC<NewConversationModalProps> = ({
  isOpen,
  onClose,
  registeredAgents,
  availableCrmRecords,
  onCreateConversation
}) => {
  const [activeTab, setActiveTab] = useState<'crm' | 'group' | 'direct'>('crm');
  const [title, setTitle] = useState('');
  const [selectedRecipientId, setSelectedRecipientId] = useState(registeredAgents[1]?.id || '');
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([
    registeredAgents[0]?.id || 'user_agent_1',
    registeredAgents[1]?.id || 'user_agent_2'
  ]);
  const [selectedCrmRecordId, setSelectedCrmRecordId] = useState<string>(availableCrmRecords[0]?.id || '');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('high');
  const [customTags, setCustomTags] = useState('Enterprise, Q3 Review');

  if (!isOpen) return null;

  const handleToggleParticipant = (id: string) => {
    setSelectedParticipantIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    let convType: ConversationType = 'crm_linked';
    let channel: 'internal' | 'crm' | 'widget' | 'email' = 'crm';
    let convTitle = title.trim();
    let participantIds = selectedParticipantIds;
    let chosenRecord: CrmRecordReference | undefined;

    if (activeTab === 'crm') {
      convType = 'crm_linked';
      channel = 'crm';
      chosenRecord = availableCrmRecords.find((r) => r.id === selectedCrmRecordId);
      if (!convTitle && chosenRecord) {
        convTitle = `${chosenRecord.companyName || chosenRecord.title} Deal Room`;
      }
    } else if (activeTab === 'group') {
      convType = 'group';
      channel = 'internal';
      if (!convTitle) convTitle = 'Project Collaboration Team';
    } else {
      convType = 'direct';
      channel = 'internal';
      const targetUser = registeredAgents.find((u) => u.id === selectedRecipientId);
      participantIds = ['user_agent_1', selectedRecipientId];
      if (!convTitle) convTitle = targetUser ? targetUser.name : 'Direct Message';
    }

    const tagsArray = customTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    onCreateConversation({
      type: convType,
      channel,
      title: convTitle || 'New Conversation',
      participantIds,
      priority,
      tags: tagsArray.length > 0 ? tagsArray : ['General'],
      crmRecord: chosenRecord
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--surface)] backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-sunken)]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[var(--accent-text)]">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text)]">Create New Conversation</h3>
              <p className="text-xs text-[var(--text-muted)]">Connect team members, customers, or CRM records</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Selector Tabs */}
        <div className="p-4 border-b border-[var(--border)] bg-[var(--surface-sunken)] grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('crm')}
            className={`p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition cursor-pointer ${
              activeTab === 'crm'
                ? 'bg-blue-600/20 border-blue-500/40 text-[var(--accent-text)] shadow-sm'
                : 'bg-[var(--surface-sunken)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)]'
            }`}
          >
            <Briefcase className="w-4 h-4" />
            <span>CRM-Linked</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('group')}
            className={`p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition cursor-pointer ${
              activeTab === 'group'
                ? 'bg-purple-600/20 border-purple-500/40 text-[var(--accent-text)] shadow-sm'
                : 'bg-[var(--surface-sunken)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)]'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Team Group</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('direct')}
            className={`p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center gap-1 transition cursor-pointer ${
              activeTab === 'direct'
                ? 'bg-emerald-600/20 border-emerald-500/40 text-[var(--success)] shadow-sm'
                : 'bg-[var(--surface-sunken)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--border)]'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Direct Message</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Tab 1: CRM-Linked */}
          {activeTab === 'crm' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                  Select Associated CRM Record (Deal, Ticket, Contact)
                </label>
                <select
                  value={selectedCrmRecordId}
                  onChange={(e) => setSelectedCrmRecordId(e.target.value)}
                  className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-blue-500"
                >
                  {availableCrmRecords.map((r) => (
                    <option key={r.id} value={r.id}>
                      [{r.type.toUpperCase()}] {r.title} {r.value ? `(${r.value})` : ''} - {r.companyName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">
                  Room Title (Optional, defaults to record title)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Website redesign deal room"
                  className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Include Participants</label>
                <div className="space-y-1.5 max-h-32 overflow-y-auto p-2 bg-[var(--surface-sunken)] rounded-xl border border-[var(--border)]">
                  {registeredAgents.map((agent) => (
                    <label
                      key={agent.id}
                      className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-[var(--surface-sunken)] cursor-pointer text-xs text-[var(--text-muted)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedParticipantIds.includes(agent.id)}
                        onChange={() => handleToggleParticipant(agent.id)}
                        className="rounded border-[var(--border)] text-blue-600 focus:ring-0"
                      />
                      <span>{agent.name}</span>
                      <span className="text-[10px] text-[var(--text-subtle)]">({agent.department || agent.role})</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Group */}
          {activeTab === 'group' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Group Channel Name</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Enterprise Solution Architects"
                  className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Select Channel Members</label>
                <div className="space-y-1.5 max-h-36 overflow-y-auto p-2 bg-[var(--surface-sunken)] rounded-xl border border-[var(--border)]">
                  {registeredAgents.map((agent) => (
                    <label
                      key={agent.id}
                      className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-[var(--surface-sunken)] cursor-pointer text-xs text-[var(--text-muted)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedParticipantIds.includes(agent.id)}
                        onChange={() => handleToggleParticipant(agent.id)}
                        className="rounded border-[var(--border)] text-purple-600 focus:ring-0"
                      />
                      <span>{agent.name}</span>
                      <span className="text-[10px] text-[var(--text-subtle)]">({agent.department})</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Direct */}
          {activeTab === 'direct' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Select Recipient</label>
                <select
                  value={selectedRecipientId}
                  onChange={(e) => setSelectedRecipientId(e.target.value)}
                  className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-emerald-500"
                >
                  {registeredAgents
                    .filter((a) => a.id !== 'user_agent_1')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} • {a.department || a.email}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-blue-500"
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium</option>
                <option value="high">High Priority</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Tags (Comma-separated)</label>
              <input
                type="text"
                value={customTags}
                onChange={(e) => setCustomTags(e.target.value)}
                placeholder="Enterprise, SLA"
                className="w-full bg-[var(--surface-sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs text-[var(--text)] focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-sunken)] text-xs transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-blue-600/30 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Conversation</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
