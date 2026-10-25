import React, { useState } from 'react';
import { 
  Users, KeyRound, CreditCard, Bell, 
  Globe, ShieldCheck, Plus, Check, Trash2, 
  ExternalLink, RefreshCw, Mail, Sliders
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Dialog } from '../ui/Dialog';
import { TeamMember, IntegrationItem, BillingPlan } from '../types';

export interface SettingsViewProps {
  initialTab?: 'general' | 'team' | 'integrations' | 'billing';
  teamMembers: TeamMember[];
  integrations: IntegrationItem[];
  billing: BillingPlan;
  onInviteMember: (member: Partial<TeamMember>) => void;
  onRemoveMember: (id: string) => void;
  onReconnectIntegration: (id: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  initialTab = 'general',
  teamMembers,
  integrations,
  billing,
  onInviteMember,
  onRemoveMember,
  onReconnectIntegration
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'team' | 'integrations' | 'billing'>(initialTab);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'Admin' | 'Location Manager' | 'Review Moderator'>('Location Manager');

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName || !inviteEmail) return;
    onInviteMember({
      id: `usr-${Date.now()}`,
      name: inviteName,
      email: inviteEmail,
      role: inviteRole,
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
      status: 'Active',
      twoFactorEnabled: true,
      lastActive: 'Just now'
    });
    setInviteName('');
    setInviteEmail('');
    setIsInviteOpen(false);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-settings-view">
      
      {/* Header */}
      <div className="pb-1">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">
          Workspace Settings & Governance
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Manage team access controls, Google Business Profile API integrations, and billing.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 pb-2 text-xs font-semibold">
        {[
          { id: 'general', label: 'General', icon: Sliders },
          { id: 'team', label: 'Team & RBAC', icon: Users },
          { id: 'integrations', label: 'Integrations & API', icon: Globe },
          { id: 'billing', label: 'Billing & Plan', icon: CreditCard },
        ].map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-2 transition cursor-pointer ${
                isSelected
                  ? 'bg-slate-100 text-slate-900'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: GENERAL */}
      {activeTab === 'general' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Organization Profile</h3>
            <p className="text-xs text-slate-500">Set your primary business entity name and defaults.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="font-semibold text-slate-900 block mb-1">Company / Agency Name</label>
              <input
                type="text"
                defaultValue="Acme Hospitality Group LLC"
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-900 block mb-1">Primary Contact Email</label>
              <input
                type="email"
                defaultValue="ops@acmehospitality.com"
                className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-900 block mb-1">Default Time Zone</label>
              <select className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900">
                <option>Eastern Time (US & Canada) (UTC-04:00)</option>
                <option>Central Time (US & Canada) (UTC-05:00)</option>
                <option>Pacific Time (US & Canada) (UTC-07:00)</option>
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-900 block mb-1">Review Notification Frequency</label>
              <select className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900">
                <option>Instant push & email for negative (≤3★)</option>
                <option>Daily consolidated digest</option>
                <option>Weekly executive summary only</option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <Button variant="primary" size="sm">
              Save Organization Settings
            </Button>
          </div>
        </div>
      )}

      {/* TAB 2: TEAM & RBAC */}
      {activeTab === 'team' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Team Members & Access Governance</h3>
              <p className="text-xs text-slate-500">Manage location permissions, assign review moderation, and enforce 2FA.</p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsInviteOpen(true)}
              leftIcon={<Plus className="h-3.5 w-3.5" />}
            >
              Invite Member
            </Button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3">Member</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3">2FA</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last Active</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {teamMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={member.avatar}
                            alt={member.name}
                            className="h-8 w-8 rounded-full object-cover border border-slate-200"
                          />
                          <div>
                            <div className="font-semibold text-slate-900">{member.name}</div>
                            <div className="text-[11px] text-slate-500">{member.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 font-medium text-slate-900">
                        {member.role}
                      </td>

                      <td className="px-4 py-3.5">
                        {member.twoFactorEnabled ? (
                          <span className="text-emerald-700 font-semibold flex items-center gap-1 text-[11px]">
                            <Check className="h-3 w-3 text-emerald-600" /> Enabled
                          </span>
                        ) : (
                          <span className="text-amber-700 font-semibold text-[11px]">
                            Pending
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <Badge variant={member.status === 'Active' ? 'success' : 'neutral'} size="sm">
                          {member.status}
                        </Badge>
                      </td>

                      <td className="px-4 py-3.5 text-slate-500">
                        {member.lastActive}
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        {member.role !== 'Owner' && (
                          <button
                            type="button"
                            onClick={() => onRemoveMember(member.id)}
                            className="text-rose-600 hover:text-rose-800 p-1.5 rounded hover:bg-rose-50 transition cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: INTEGRATIONS */}
      {activeTab === 'integrations' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {integrations.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-xs text-slate-900">{item.name}</h4>
                  <Badge variant={item.status === 'Connected' ? 'success' : 'neutral'} size="sm">
                    {item.status}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {item.description}
                </p>
                {item.lastSynced && (
                  <span className="text-[10px] text-slate-400 block">
                    Last sync: {item.lastSynced}
                  </span>
                )}
              </div>

              <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" /> OAuth Valid
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onReconnectIntegration(item.id)}
                  leftIcon={<RefreshCw className="h-3 w-3" />}
                >
                  Reconnect
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 4: BILLING */}
      {activeTab === 'billing' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider block mb-1">
                Current Plan
              </span>
              <h2 className="text-xl font-bold text-slate-900">
                {billing.planName} (${billing.monthlyPrice}/month)
              </h2>
              <p className="text-xs text-slate-500">
                {billing.locationsIncluded} included • Renews on {billing.nextBillingDate}
              </p>
            </div>

            <Button variant="outline" size="sm">
              Upgrade to Agency Tier
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Managed Locations</span>
              <span className="text-lg font-bold text-slate-900">127 active</span>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Payment Method</span>
              <span className="text-sm font-semibold text-slate-900 mt-1 block">Mastercard ending in 8492</span>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-500 block text-[10px] uppercase font-bold">Invoice Status</span>
              <span className="text-sm font-semibold text-emerald-700 mt-1 block">Paid in full</span>
            </div>
          </div>
        </div>
      )}

      {/* Invite Team Member Dialog */}
      <Dialog
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        title="Invite Team Member"
        description="Grant access to manage Google Business Profiles and moderate reviews."
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button variant="outline" size="sm" onClick={() => setIsInviteOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleInviteSubmit}>
              Send Invitation
            </Button>
          </div>
        }
      >
        <form onSubmit={handleInviteSubmit} className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-slate-900 block mb-1">Full Name</label>
            <input
              type="text"
              placeholder="e.g. Jordan Miller"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="font-semibold text-slate-900 block mb-1">Work Email</label>
            <input
              type="email"
              placeholder="jordan@acmehospitality.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="font-semibold text-slate-900 block mb-1">Role & Permissions</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as any)}
              className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
            >
              <option value="Admin">Admin (Full workspace access & billing)</option>
              <option value="Location Manager">Location Manager (Edit hours, services & posts)</option>
              <option value="Review Moderator">Review Moderator (Draft and reply to reviews)</option>
            </select>
          </div>
        </form>
      </Dialog>

    </div>
  );
};

export default SettingsView;
