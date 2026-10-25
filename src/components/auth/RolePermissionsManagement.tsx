import React, { useState } from 'react';
import { 
  Shield, 
  ShieldCheck, 
  Users, 
  Lock, 
  Key, 
  Check, 
  AlertCircle, 
  Plus, 
  Trash2, 
  Edit3, 
  UserCheck, 
  Eye, 
  Sliders, 
  CheckCircle2, 
  Sparkles,
  Info
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export interface RoleDefinition {
  id: string;
  name: string;
  badgeColor: string;
  description: string;
  isSystem: boolean;
  userCount: number;
  permissions: {
    contacts: { read: boolean; create: boolean; edit: boolean; delete: boolean; export: boolean };
    deals: { view: boolean; edit: boolean; moveStages: boolean; modifyPricing: boolean };
    messages: { read: boolean; reply: boolean; initiateCall: boolean; broadcast: boolean };
    system: { integrations: boolean; editRoles: boolean; apiKeys: boolean; auditLogs: boolean };
    analytics: { viewRevenue: boolean; exportReports: boolean };
  };
}

const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: 'super_admin',
    name: 'Class-5 Executive (Super Admin)',
    badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    description: 'Unrestricted operational authority across omnichannel routing, KMS credentials, and CRM databases.',
    isSystem: true,
    userCount: 2,
    permissions: {
      contacts: { read: true, create: true, edit: true, delete: true, export: true },
      deals: { view: true, edit: true, moveStages: true, modifyPricing: true },
      messages: { read: true, reply: true, initiateCall: true, broadcast: true },
      system: { integrations: true, editRoles: true, apiKeys: true, auditLogs: true },
      analytics: { viewRevenue: true, exportReports: true },
    },
  },
  {
    id: 'sales_manager',
    name: 'Sales Director',
    badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    description: 'Pipeline oversight, deal velocity metrics, customer outreach, and proposal approvals.',
    isSystem: true,
    userCount: 6,
    permissions: {
      contacts: { read: true, create: true, edit: true, delete: false, export: true },
      deals: { view: true, edit: true, moveStages: true, modifyPricing: true },
      messages: { read: true, reply: true, initiateCall: true, broadcast: true },
      system: { integrations: false, editRoles: false, apiKeys: false, auditLogs: false },
      analytics: { viewRevenue: true, exportReports: true },
    },
  },
  {
    id: 'support_specialist',
    name: 'Omnichannel Specialist',
    badgeColor: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    description: 'First-line communications, live WhatsApp/SMS ticket resolution, and meeting coordination.',
    isSystem: true,
    userCount: 14,
    permissions: {
      contacts: { read: true, create: true, edit: true, delete: false, export: false },
      deals: { view: true, edit: false, moveStages: false, modifyPricing: false },
      messages: { read: true, reply: true, initiateCall: true, broadcast: false },
      system: { integrations: false, editRoles: false, apiKeys: false, auditLogs: false },
      analytics: { viewRevenue: false, exportReports: false },
    },
  },
  {
    id: 'compliance_auditor',
    name: 'Compliance & Legal Auditor',
    badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    description: 'Read-only regulatory examination, data privacy checks, SOC 2 audit trails, and archival export.',
    isSystem: true,
    userCount: 1,
    permissions: {
      contacts: { read: true, create: false, edit: false, delete: false, export: true },
      deals: { view: true, edit: false, moveStages: false, modifyPricing: false },
      messages: { read: true, reply: false, initiateCall: false, broadcast: false },
      system: { integrations: false, editRoles: false, apiKeys: false, auditLogs: true },
      analytics: { viewRevenue: true, exportReports: true },
    },
  },
  {
    id: 'guest_readonly',
    name: 'External Observer (Read-Only)',
    badgeColor: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
    description: 'Restricted view for contracted partners. No access to client PII or sensitive revenue data.',
    isSystem: false,
    userCount: 3,
    permissions: {
      contacts: { read: true, create: false, edit: false, delete: false, export: false },
      deals: { view: true, edit: false, moveStages: false, modifyPricing: false },
      messages: { read: false, reply: false, initiateCall: false, broadcast: false },
      system: { integrations: false, editRoles: false, apiKeys: false, auditLogs: false },
      analytics: { viewRevenue: false, exportReports: false },
    },
  },
];

interface TeamMember {
  id: string;
  name: string;
  email: string;
  roleId: string;
  status: 'active' | 'pending';
  lastActive: string;
}

// TO COMPLETE: load workspace members and their roles from your user/organization store.
const INITIAL_TEAM: TeamMember[] = [];

export default function RolePermissionsManagement() {
  const { userProfile, updateProfileDetails } = useAuth();
  const [roles, setRoles] = useState<RoleDefinition[]>(() => {
    try {
      const saved = localStorage.getItem('obsidian_rbac_roles_v2');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_ROLES;
  });

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => {
    try {
      const saved = localStorage.getItem('obsidian_rbac_team_v2');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_TEAM;
  });

  const [selectedRoleId, setSelectedRoleId] = useState<string>('super_admin');
  const [activeTab, setActiveTab] = useState<'matrix' | 'team'>('matrix');
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Save roles
  const persistRoles = (newRoles: RoleDefinition[]) => {
    setRoles(newRoles);
    try {
      localStorage.setItem('obsidian_rbac_roles_v2', JSON.stringify(newRoles));
    } catch {}
  };

  const selectedRole = roles.find(r => r.id === selectedRoleId) || roles[0];

  const handleTogglePermission = (
    module: keyof RoleDefinition['permissions'],
    action: string,
    value: boolean
  ) => {
    const updated = roles.map(r => {
      if (r.id !== selectedRoleId) return r;
      return {
        ...r,
        permissions: {
          ...r.permissions,
          [module]: {
            ...r.permissions[module],
            [action]: value,
          },
        },
      };
    });
    persistRoles(updated);
  };

  const handleAssignRoleToCurrentUser = (role: RoleDefinition) => {
    updateProfileDetails({ role: role.name });
    setSuccessToast(`Active user persona updated to: ${role.name}`);
    setTimeout(() => setSuccessToast(null), 3500);
  };

  const handleUpdateMemberRole = (memberId: string, roleId: string) => {
    const updated = teamMembers.map(m => m.id === memberId ? { ...m, roleId } : m);
    setTeamMembers(updated);
    try {
      localStorage.setItem('obsidian_rbac_team_v2', JSON.stringify(updated));
    } catch {}
    setSuccessToast('Team member role assigned successfully.');
    setTimeout(() => setSuccessToast(null), 3000);
  };

  return (
    <div className="space-y-6 text-neutral-100">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-white/5 bg-neutral-900/30">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-400" />
            Role-Based Access Control (RBAC) &amp; Authorization
          </h3>
          <p className="text-xs text-neutral-400 mt-1">
            Enforce granular principle-of-least-privilege across CRM pipelines, customer communications, and financial metrics.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {successToast && (
            <div className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-1.5 animate-in fade-in">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{successToast}</span>
            </div>
          )}

          <div className="flex bg-neutral-950 p-1 rounded-lg border border-white/5">
            <button
              onClick={() => setActiveTab('matrix')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'matrix' ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Permissions Matrix
            </button>
            <button
              onClick={() => setActiveTab('team')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'team' ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Team Assignments ({teamMembers.length})
            </button>
          </div>
        </div>
      </div>

      {activeTab === 'matrix' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Role Selector List */}
          <div className="lg:col-span-4 space-y-2.5">
            <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider px-1">
              Select Role Profile
            </div>

            <div className="space-y-2">
              {roles.map(role => {
                const isSelected = role.id === selectedRoleId;
                const isCurrentUserRole = userProfile?.role === role.name;

                return (
                  <div
                    key={role.id}
                    onClick={() => setSelectedRoleId(role.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-neutral-800/80 border-blue-500/60 shadow-lg shadow-blue-500/5'
                        : 'bg-neutral-950/40 border-white/5 hover:border-white/10 hover:bg-neutral-900/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-xs text-white">{role.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${role.badgeColor}`}>
                        {role.userCount} Users
                      </span>
                    </div>

                    <p className="text-[11px] text-neutral-400 line-clamp-2 leading-relaxed">
                      {role.description}
                    </p>

                    <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAssignRoleToCurrentUser(role);
                        }}
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded transition-colors cursor-pointer flex items-center gap-1 ${
                          isCurrentUserRole
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-white/5 text-neutral-300 hover:text-white hover:bg-white/10'
                        }`}
                      >
                        <UserCheck className="w-3 h-3" />
                        <span>{isCurrentUserRole ? 'Active User Role' : 'Adopt Role'}</span>
                      </button>

                      {role.isSystem && (
                        <span className="text-[10px] font-mono text-neutral-500 flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" />
                          System Tier
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Detailed Granular Permissions Matrix for Selected Role */}
          <div className="lg:col-span-8 rounded-2xl border border-white/5 bg-neutral-900/40 p-5 space-y-6">
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white">{selectedRole.name}</h4>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${selectedRole.badgeColor}`}>
                    Active Editor
                  </span>
                </div>
                <p className="text-xs text-neutral-400 mt-0.5">{selectedRole.description}</p>
              </div>

              <button
                onClick={() => handleAssignRoleToCurrentUser(selectedRole)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-600/20 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Simulate As This Role</span>
              </button>
            </div>

            {/* Permissions Sections */}
            <div className="space-y-4">
              {/* Module 1: Contacts & Leads */}
              <div className="p-4 rounded-xl border border-white/5 bg-neutral-950/60 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-400" />
                    Contacts &amp; Inbound Leads
                  </span>
                  <span className="text-[11px] text-neutral-500">Core CRM Entities</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
                  {[
                    { key: 'read', label: 'View Contacts' },
                    { key: 'create', label: 'Create New' },
                    { key: 'edit', label: 'Edit Details' },
                    { key: 'delete', label: 'Delete Records' },
                    { key: 'export', label: 'Export PII' },
                  ].map(action => (
                    <label key={action.key} className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(selectedRole.permissions.contacts as any)[action.key]}
                        onChange={(e) => handleTogglePermission('contacts', action.key, e.target.checked)}
                        className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                      />
                      <span>{action.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Module 2: Deals & Sales Pipeline */}
              <div className="p-4 rounded-xl border border-white/5 bg-neutral-950/60 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    Deals &amp; Revenue Pipeline
                  </span>
                  <span className="text-[11px] text-neutral-500">Financial Opportunities</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  {[
                    { key: 'view', label: 'View Deals' },
                    { key: 'edit', label: 'Edit Deal Value' },
                    { key: 'moveStages', label: 'Advance Stage' },
                    { key: 'modifyPricing', label: 'Override Pricing' },
                  ].map(action => (
                    <label key={action.key} className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(selectedRole.permissions.deals as any)[action.key]}
                        onChange={(e) => handleTogglePermission('deals', action.key, e.target.checked)}
                        className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-emerald-600 focus:ring-0 cursor-pointer"
                      />
                      <span>{action.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Module 3: Communications & Messaging */}
              <div className="p-4 rounded-xl border border-white/5 bg-neutral-950/60 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Shield className="w-4 h-4 text-purple-400" />
                    Omnichannel Communications
                  </span>
                  <span className="text-[11px] text-neutral-500">WhatsApp, SMS, Email, SIP</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  {[
                    { key: 'read', label: 'Read Messages' },
                    { key: 'reply', label: 'Send Outbound' },
                    { key: 'initiateCall', label: 'Place Voice Calls' },
                    { key: 'broadcast', label: 'Run Broadcasts' },
                  ].map(action => (
                    <label key={action.key} className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(selectedRole.permissions.messages as any)[action.key]}
                        onChange={(e) => handleTogglePermission('messages', action.key, e.target.checked)}
                        className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-purple-600 focus:ring-0 cursor-pointer"
                      />
                      <span>{action.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Module 4: System Administration & Audit Logs */}
              <div className="p-4 rounded-xl border border-white/5 bg-neutral-950/60 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Key className="w-4 h-4 text-amber-400" />
                    System Administration &amp; Security
                  </span>
                  <span className="text-[11px] text-neutral-500">Security &amp; Infrastructure</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  {[
                    { key: 'integrations', label: 'Manage Connectors' },
                    { key: 'editRoles', label: 'Modify RBAC' },
                    { key: 'apiKeys', label: 'Rotate API Keys' },
                    { key: 'auditLogs', label: 'Inspect Audit Logs' },
                  ].map(action => (
                    <label key={action.key} className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(selectedRole.permissions.system as any)[action.key]}
                        onChange={(e) => handleTogglePermission('system', action.key, e.target.checked)}
                        className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-amber-600 focus:ring-0 cursor-pointer"
                      />
                      <span>{action.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Team Members List */
        <div className="rounded-2xl border border-white/5 bg-neutral-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-white">Active Tenant Operators</h4>
              <p className="text-xs text-neutral-400">Assign role profiles to verified team members.</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/5 bg-neutral-950/60">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-white/10 bg-neutral-900/40 text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
                  <th className="py-3 px-4">Operator</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Assigned Role Profile</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Last Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {teamMembers.map((member) => (
                  <tr key={member.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-white flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-xs">
                        {member.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span>{member.name}</span>
                    </td>
                    <td className="py-3.5 px-4 text-neutral-300 font-mono text-[11px]">
                      {member.email}
                    </td>
                    <td className="py-3.5 px-4">
                      <select
                        value={member.roleId}
                        onChange={(e) => handleUpdateMemberRole(member.id, e.target.value)}
                        className="bg-neutral-900 text-xs font-semibold text-white border border-white/10 rounded-lg px-2.5 py-1.5 outline-none focus:border-blue-500 cursor-pointer"
                      >
                        {roles.map(r => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        member.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                      }`}>
                        {member.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right text-neutral-400 font-mono text-[11px]">
                      {member.lastActive}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
