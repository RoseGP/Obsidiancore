import React, { useState, useEffect } from 'react';
import { useDatabase } from '../context/DatabaseContext';
import { initiateLinkedInLogin } from './LinkedInCallbackHandler';
import IntegrationsSettingsSection from './IntegrationsSettingsSection';
import NotificationPreferencesModal from './notifications/NotificationPreferencesModal';
import RolePermissionsManagement from './auth/RolePermissionsManagement';
import { UnifiedSocketInspector } from './UnifiedSocketInspector';
import { useRealtimeSync } from '../context/RealtimeSyncContext';
import { 
  Settings, Key, Shield, Radio, Volume2, 
  HelpCircle, CheckCircle2, Sliders, ToggleLeft, ToggleRight, Sparkles,
  Facebook, Instagram, Linkedin, X, Globe, RefreshCw, Link2,
  Database, Plus, Trash2, Calendar, Check, AlertCircle, Clock, Server, Terminal,
  ShieldCheck, Layers, Bell, Users, Wifi, Activity, Zap
} from 'lucide-react';

export type SettingsTab = 'general' | 'integrations' | 'notifications' | 'roles-rbac' | 'realtime-sync' | 'social-db';

interface SettingsViewProps {
  defaultTab?: SettingsTab;
}

export default function SettingsView({ defaultTab = 'general' }: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab]);

  const realtimeSync = useRealtimeSync();

  const {
    dbChannels,
    dbPosts,
    dbPostTargets,
    addChannel,
    deleteChannel,
    createPost,
    deletePost,
    simulatePublish
  } = useDatabase();

  const [workspaceName, setWorkspaceName] = useState('Obsidian Enterprise Core');
  const [leadRouting, setLeadRouting] = useState<'round-robin' | 'fastest' | 'manual'>('round-robin');
  const [channels, setChannels] = useState({
    whatsapp: true,
    telegram: true,
    email: true,
    sms: false,
    instagram: true
  });
  const [notifications, setNotifications] = useState({
    desktop: true,
    sound: true,
    slack: true,
    emailAlerts: false
  });
  const [successMsg, setSuccessMsg] = useState(false);

  const [socialConnections, setSocialConnections] = useState<{
    linkedin: { connected: boolean; handle: string; metric: string; metricName: string };
    instagram: { connected: boolean; handle: string; metric: string; metricName: string };
    facebook: { connected: boolean; handle: string; metric: string; metricName: string };
    tiktok: { connected: boolean; handle: string; metric: string; metricName: string };
    thread: { connected: boolean; handle: string; metric: string; metricName: string };
    twitter: { connected: boolean; handle: string; metric: string; metricName: string };
    pinterest: { connected: boolean; handle: string; metric: string; metricName: string };
  }>(() => {
    const saved = localStorage.getItem('obsidian_social_connections_v3');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      linkedin: { connected: false, handle: '@flowforge', metric: '1,120', metricName: 'Profile Visits' },
      instagram: { connected: false, handle: '@flowforge.studio', metric: '21.4k', metricName: 'Reach (Last Week)' },
      facebook: { connected: false, handle: '@flowforgepage', metric: '2.9%', metricName: 'Page Reach' },
      tiktok: { connected: false, handle: '@flowforge_tiktok', metric: '42.5k', metricName: 'Video Views' },
      thread: { connected: false, handle: '@flowforgethreads', metric: '890', metricName: 'Active Threads' },
      twitter: { connected: false, handle: '@flowforge', metric: '3.2%', metricName: 'Engagement' },
      pinterest: { connected: false, handle: '@flowforge', metric: '19.3k', metricName: 'Monthly Viewers' }
    };
  });

  const [isSocialConnecting, setIsSocialConnecting] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('obsidian_social_connections_v3', JSON.stringify(socialConnections));
  }, [socialConnections]);

  const connectPlatform = (platform: 'linkedin' | 'instagram' | 'facebook' | 'tiktok' | 'thread' | 'twitter' | 'pinterest', mockHandle: string) => {
    setIsSocialConnecting(platform);
    setTimeout(() => {
      setSocialConnections(prev => ({
        ...prev,
        [platform]: {
          ...prev[platform],
          connected: true,
          handle: mockHandle
        }
      }));
      setIsSocialConnecting(null);
    }, 800);
  };

  const disconnectPlatform = (platform: 'linkedin' | 'instagram' | 'facebook' | 'tiktok' | 'thread' | 'twitter' | 'pinterest') => {
    setSocialConnections(prev => ({
      ...prev,
      [platform]: {
        ...prev[platform],
        connected: false
      }
    }));
  };

  const connectAllSocials = () => {
    setSocialConnections({
      linkedin: { connected: true, handle: '@flowforge', metric: '1,120', metricName: 'Profile Visits' },
      instagram: { connected: true, handle: '@flowforge.studio', metric: '21.4k', metricName: 'Reach (Last Week)' },
      facebook: { connected: true, handle: '@flowforgepage', metric: '2.9%', metricName: 'Page Reach' },
      tiktok: { connected: true, handle: '@flowforge_tiktok', metric: '42.5k', metricName: 'Video Views' },
      thread: { connected: true, handle: '@flowforgethreads', metric: '890', metricName: 'Active Threads' },
      twitter: { connected: true, handle: '@flowforge', metric: '3.2%', metricName: 'Engagement' },
      pinterest: { connected: true, handle: '@flowforge', metric: '19.3k', metricName: 'Monthly Viewers' }
    });
  };

  const disconnectAllSocials = () => {
    setSocialConnections({
      linkedin: { connected: false, handle: '@flowforge', metric: '1,120', metricName: 'Profile Visits' },
      instagram: { connected: false, handle: '@flowforge.studio', metric: '21.4k', metricName: 'Reach (Last Week)' },
      facebook: { connected: false, handle: '@flowforgepage', metric: '2.9%', metricName: 'Page Reach' },
      tiktok: { connected: false, handle: '@flowforge_tiktok', metric: '42.5k', metricName: 'Video Views' },
      thread: { connected: false, handle: '@flowforgethreads', metric: '890', metricName: 'Active Threads' },
      twitter: { connected: false, handle: '@flowforge', metric: '3.2%', metricName: 'Engagement' },
      pinterest: { connected: false, handle: '@flowforge', metric: '19.3k', metricName: 'Monthly Viewers' }
    });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg(true);
    setTimeout(() => setSuccessMsg(false), 3000);
  }  // Social database form states
  const [newChPlatform, setNewChPlatform] = useState('LINKEDIN');
  const [newChHandle, setNewChHandle] = useState('');
  const [newPostText, setNewPostText] = useState('');
  const [newPostImageUrl, setNewPostImageUrl] = useState('');
  const [newPostDelay, setNewPostDelay] = useState('120'); // in minutes
  const [selectedExploreTable, setSelectedExploreTable] = useState<'channels' | 'posts' | 'post-targets'>('channels');
  const [dbSuccessAlert, setDbSuccessAlert] = useState<string | null>(null);

  // Database helper actions
  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChHandle) return;

    const platform = newChPlatform.toUpperCase();
    const handle = newChHandle.startsWith('@') ? newChHandle : `@${newChHandle}`;
    
    // Check if channel already exists
    if (dbChannels.some(c => c.platform === platform)) {
      alert(`A Channel for platform ${platform} is already connected. Please remove it first or choose another platform.`);
      return;
    }

    const newChannel = {
      id: `ch-${Date.now()}`,
      platform,
      handle,
      accessToken: `ghp_${Math.random().toString(36).substring(2, 15).toUpperCase()}`,
      refreshToken: `ref_${Math.random().toString(36).substring(2, 10)}`,
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString()
    };

    await addChannel(newChannel);
    setNewChHandle('');
    triggerDbAlert(`Successfully inserted channel record for ${platform} (${handle})`);

    // Synchronize socialConnections from SettingsView state for coherence
    setSocialConnections(prev => ({
      ...prev,
      [platform.toLowerCase()]: {
        connected: true,
        handle,
        metric: 'New',
        metricName: 'Interactions'
      }
    }));
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostText) return;

    const newPostId = `post-${Date.now()}`;
    const scheduledTime = new Date(Date.now() + parseInt(newPostDelay, 10) * 60000).toISOString();

    const newPost = {
      id: newPostId,
      text: newPostText,
      imageUrls: newPostImageUrl ? [newPostImageUrl] : [],
      scheduledAt: scheduledTime
    };

    // Create targets for each connected channel!
    const newTargets = dbChannels.map((ch, idx) => ({
      id: `pt-${Date.now()}-${idx}`,
      postId: newPostId,
      channelId: ch.id
    }));

    await createPost(newPost, newTargets);
    setNewPostText('');
    setNewPostImageUrl('');
    triggerDbAlert(`Successfully created Post & generated ${newTargets.length} Platform Target junction records!`);
  };

  const handleSimulatePublish = async (targetId: string, forceFail = false, isReset = false) => {
    await simulatePublish(targetId, forceFail, isReset);
    triggerDbAlert(`Simulated publication routing update completed.`);
  };

  const handleDeleteChannel = async (id: string) => {
    const ch = dbChannels.find(c => c.id === id);
    await deleteChannel(id);
    
    if (ch) {
      triggerDbAlert(`Pruned Channel ${ch.platform} and cascaded targets deletion.`);
      setSocialConnections(prev => ({
        ...prev,
        [ch.platform.toLowerCase()]: {
          ...prev[ch.platform.toLowerCase()],
          connected: false
        }
      }));
    }
  };

  const handleDeletePost = async (id: string) => {
    await deletePost(id);
    triggerDbAlert(`Deleted Post ${id} and cascaded targets deletion.`);
  };

  const triggerDbAlert = (msg: string) => {
    setDbSuccessAlert(msg);
    setTimeout(() => setDbSuccessAlert(null), 3500);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6" id="settings-workspace-root">
      
      {/* Header */}
      <div className="border-b border-white/5 pb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="font-sans font-bold text-lg text-white tracking-tight">System Configuration</h2>
          <p className="text-xs text-neutral-400 mt-0.5">Configure webhook routes, routing policies, and omnichannel API connectors</p>
        </div>

        {/* Tab switch navigation */}
        <div className="flex bg-neutral-950 p-1 rounded-lg border border-white/5 self-start md:self-auto flex-wrap gap-1" id="settings-tab-bar">
          <button
            id="tab-general-settings"
            type="button"
            onClick={() => setActiveTab('general')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'general'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
            General Settings
          </button>
          <button
            id="tab-notifications"
            type="button"
            onClick={() => setActiveTab('notifications')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'notifications'
                ? 'bg-amber-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Bell className="h-3.5 w-3.5" />
            Notifications &amp; Alerts
          </button>
          <button
            id="tab-roles-rbac"
            type="button"
            onClick={() => setActiveTab('roles-rbac')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'roles-rbac'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Roles &amp; RBAC
          </button>
          <button
            id="tab-realtime-sync"
            type="button"
            onClick={() => setActiveTab('realtime-sync')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'realtime-sync'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Wifi className="h-3.5 w-3.5" />
            Real-Time Sync &amp; WebSockets
          </button>
          <button
            id="tab-integrations"
            type="button"
            onClick={() => setActiveTab('integrations')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'integrations'
                ? 'bg-cyan-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Integrations
          </button>
          <button
            id="tab-social-db"
            type="button"
            onClick={() => setActiveTab('social-db')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'social-db'
                ? 'bg-rose-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            Social Database Explorer
          </button>
        </div>
      </div>

      {activeTab === 'notifications' ? (
        <NotificationPreferencesModal inline={true} />
      ) : activeTab === 'roles-rbac' ? (
        <RolePermissionsManagement />
      ) : activeTab === 'realtime-sync' ? (
        <div className="space-y-6">
          {/* Realtime Cluster Header Card */}
          <div className="p-6 rounded-2xl border border-white/5 bg-neutral-900/40 backdrop-blur-md space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Wifi className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    Real-Time Synchronization Gateway
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      WebSocket Protocol Active
                    </span>
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Pushes live CRM entity updates, optimistic contact merges, and calendar bookings instantly to all connected peer nodes.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => realtimeSync.simulateConcurrentConflict()}
                  className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Simulate Concurrent Conflict</span>
                </button>
                <button
                  onClick={() => realtimeSync.triggerStateResync()}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-200 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                  <span>Request Full Resync</span>
                </button>
              </div>
            </div>

            {/* Live Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Heartbeat Latency</div>
                <div className="text-lg font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                  <Activity className="w-4 h-4" />
                  <span>{realtimeSync.latencyMs} ms</span>
                </div>
                <div className="text-[10px] text-neutral-500">Target SLA: &lt; 50ms</div>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Active Peer Nodes</div>
                <div className="text-lg font-mono font-bold text-blue-400 flex items-center gap-1.5">
                  <Users className="w-4 h-4" />
                  <span>{realtimeSync.activeClients} Node{realtimeSync.activeClients === 1 ? '' : 's'}</span>
                </div>
                <div className="text-[10px] text-neutral-500">Autoscaling cluster</div>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Sync State</div>
                <div className="text-lg font-bold text-white capitalize flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{realtimeSync.syncStatus.replace('_', ' ')}</span>
                </div>
                <div className="text-[10px] text-neutral-500">Last sync: {realtimeSync.lastSyncTime}</div>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-950/60 border border-white/5 space-y-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Conflict Engine</div>
                <div className="text-lg font-mono font-bold text-amber-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>3-Way Merge</span>
                </div>
                <div className="text-[10px] text-neutral-500">Vector Clock + LWW</div>
              </div>
            </div>
          </div>

          {/* Unified Socket Inspector */}
          <div className="rounded-2xl border border-white/5 bg-neutral-900/40 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white">Live Socket Inspector &amp; Frame Telemetry</h4>
                <p className="text-xs text-neutral-400">Deep packet inspection for multiplexed WebRTC, Calendar, and CRM events.</p>
              </div>
            </div>
            <UnifiedSocketInspector />
          </div>
        </div>
      ) : activeTab === 'integrations' ? (
        <IntegrationsSettingsSection />
      ) : activeTab === 'general' ? (
        <>
          {successMsg && (
            <div id="settings-success-alert" className="rounded-lg border border-emerald-500/10 bg-emerald-500/10 p-4 text-xs font-bold text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="h-4.5 w-4.5" />
              <span>System parameters successfully synchronized with Cloud KMS and production servers.</span>
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-6">
            
            {/* Workspace parameters */}
            <div className="rounded-xl border border-white/5 bg-neutral-900/20 p-5 backdrop-blur-md space-y-4">
              <div className="flex items-center gap-2 text-white border-b border-white/5 pb-3">
                <Sliders className="h-4.5 w-4.5 text-blue-500" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Tenant Parameters</h3>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">Core CRM Tenant Name</label>
                  <input 
                    id="input-workspace-name"
                    type="text" 
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className="w-full text-xs font-semibold bg-neutral-950/60 border border-white/5 rounded-lg p-2.5 text-white outline-none focus:border-blue-500/20"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">Lead Routing Strategy</label>
                  <select 
                    id="input-routing-strategy"
                    value={leadRouting}
                    onChange={(e) => setLeadRouting(e.target.value as any)}
                    className="w-full text-xs font-bold bg-neutral-950/60 border border-white/5 rounded-lg p-2.5 text-white outline-none focus:border-blue-500/25 cursor-pointer"
                  >
                    <option value="round-robin">Round Robin Allocation (Equal distribution)</option>
                    <option value="fastest">Speed to Lead Protocol (Fastest agent availability)</option>
                    <option value="manual">Manual Assignment (Executive approvals)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Omnichannel Gateways toggle */}
            <div className="rounded-xl border border-white/5 bg-neutral-900/20 p-5 backdrop-blur-md space-y-4">
              <div className="flex items-center gap-2 text-white border-b border-white/5 pb-3">
                <Radio className="h-4.5 w-4.5 text-purple-500" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Omnichannel Gateway Toggles</h3>
              </div>

              <p className="text-xs text-neutral-400 leading-relaxed -mt-1">
                Turn communication channels on or off instantly. Offline gateways will safely spool incoming packets.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
                {Object.entries(channels).map(([ch, isEnabled]) => (
                  <div 
                    key={ch} 
                    onClick={() => setChannels({ ...channels, [ch]: !isEnabled })}
                    className={`flex items-center justify-between p-3.5 rounded-lg border cursor-pointer transition-all ${
                      isEnabled 
                        ? 'bg-blue-600/5 border-blue-500/20' 
                        : 'bg-neutral-950/20 border-white/5 opacity-50'
                    }`}
                  >
                    <div>
                      <span className="text-xs font-bold text-white capitalize block">{ch} API</span>
                      <span className="text-[10px] text-neutral-500 tracking-wider font-mono">{isEnabled ? 'Operational' : 'Disabled'}</span>
                    </div>
                    <button type="button" className="text-neutral-400 hover:text-white">
                      {isEnabled ? (
                        <ToggleRight className="h-6 w-6 text-blue-500" />
                      ) : (
                        <ToggleLeft className="h-6 w-6 text-neutral-600" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Social Accounts Connection Section */}
            <div id="settings-social-auth-section" className="rounded-xl border border-white/5 bg-neutral-900/20 p-5 backdrop-blur-md space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-2 text-white">
                  <Link2 className="h-4.5 w-4.5 text-emerald-500" />
                  <h3 className="text-sm font-bold uppercase tracking-wider">Social Media Account Authorization</h3>
                </div>
                <div className="flex gap-2">
                  <button
                    id="btn-link-all-socials"
                    type="button"
                    onClick={connectAllSocials}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded-md transition-colors cursor-pointer"
                  >
                    Link All
                  </button>
                  <button
                    id="btn-unlink-all-socials"
                    type="button"
                    onClick={disconnectAllSocials}
                    className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-bold rounded-md transition-colors cursor-pointer"
                  >
                    Unlink All
                  </button>
                </div>
              </div>

              <p className="text-xs text-neutral-400 leading-relaxed -mt-1">
                Authorize and manage persistent social media channel APIs for automated distribution pipelines.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                {/* LinkedIn */}
                <div className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${socialConnections.linkedin.connected ? 'bg-blue-950/10 border-blue-500/20' : 'bg-neutral-950/40 border-white/5 opacity-65'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
                        <Linkedin className="h-4 w-4 fill-current" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white block">LinkedIn</span>
                        <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5">
                          {socialConnections.linkedin.connected ? socialConnections.linkedin.handle : 'Not Connected'}
                        </span>
                      </div>
                    </div>
                    {socialConnections.linkedin.connected && (
                      <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">Linked</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-[10px] text-neutral-500 font-medium">Metric: {socialConnections.linkedin.metric}</span>
                    {socialConnections.linkedin.connected ? (
                      <button
                        type="button"
                        onClick={() => disconnectPlatform('linkedin')}
                        className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => initiateLinkedInLogin()}
                        className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>

                {/* Instagram */}
                <div className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${socialConnections.instagram.connected ? 'bg-pink-950/10 border-pink-500/20' : 'bg-neutral-950/40 border-white/5 opacity-65'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-yellow-500 to-pink-600 flex items-center justify-center text-white font-bold text-sm">
                        <Instagram className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white block">Instagram</span>
                        <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5">
                          {socialConnections.instagram.connected ? socialConnections.instagram.handle : 'Not Connected'}
                        </span>
                      </div>
                    </div>
                    {socialConnections.instagram.connected && (
                      <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">Linked</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-[10px] text-neutral-500 font-medium">Metric: {socialConnections.instagram.metric}</span>
                    {socialConnections.instagram.connected ? (
                      <button
                        type="button"
                        onClick={() => disconnectPlatform('instagram')}
                        className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => connectPlatform('instagram', '@flowforge.studio')}
                        className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        {isSocialConnecting === 'instagram' ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Facebook */}
                <div className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${socialConnections.facebook.connected ? 'bg-blue-950/10 border-blue-500/20' : 'bg-neutral-950/40 border-white/5 opacity-65'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-blue-700 flex items-center justify-center text-white font-bold text-sm">
                        <Facebook className="h-4 w-4 fill-current" />
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white block">Facebook</span>
                        <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5">
                          {socialConnections.facebook.connected ? socialConnections.facebook.handle : 'Not Connected'}
                        </span>
                      </div>
                    </div>
                    {socialConnections.facebook.connected && (
                      <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">Linked</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-[10px] text-neutral-500 font-medium">Metric: {socialConnections.facebook.metric}</span>
                    {socialConnections.facebook.connected ? (
                      <button
                        type="button"
                        onClick={() => disconnectPlatform('facebook')}
                        className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => connectPlatform('facebook', '@flowforgepage')}
                        className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        {isSocialConnecting === 'facebook' ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>

                {/* TikTok */}
                <div className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${socialConnections.tiktok.connected ? 'bg-red-950/10 border-rose-500/20' : 'bg-neutral-950/40 border-white/5 opacity-65'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-slate-900 flex items-center justify-center text-rose-400 font-bold text-sm">
                        🎵
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white block">TikTok</span>
                        <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5">
                          {socialConnections.tiktok.connected ? socialConnections.tiktok.handle : 'Not Connected'}
                        </span>
                      </div>
                    </div>
                    {socialConnections.tiktok.connected && (
                      <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">Linked</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-[10px] text-neutral-500 font-medium">Metric: {socialConnections.tiktok.metric}</span>
                    {socialConnections.tiktok.connected ? (
                      <button
                        type="button"
                        onClick={() => disconnectPlatform('tiktok')}
                        className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => connectPlatform('tiktok', '@flowforge_tiktok')}
                        className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        {isSocialConnecting === 'tiktok' ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Threads */}
                <div className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${socialConnections.thread.connected ? 'bg-neutral-900 border-white/10' : 'bg-neutral-950/40 border-white/5 opacity-65'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-neutral-950 border border-white/10 flex items-center justify-center text-white font-mono text-xs font-bold">
                        @
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white block">Threads</span>
                        <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5">
                          {socialConnections.thread.connected ? socialConnections.thread.handle : 'Not Connected'}
                        </span>
                      </div>
                    </div>
                    {socialConnections.thread.connected && (
                      <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">Linked</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-[10px] text-neutral-500 font-medium">Metric: {socialConnections.thread.metric}</span>
                    {socialConnections.thread.connected ? (
                      <button
                        type="button"
                        onClick={() => disconnectPlatform('thread')}
                        className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => connectPlatform('thread', '@flowforgethreads')}
                        className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        {isSocialConnecting === 'thread' ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Twitter / X */}
                <div className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${socialConnections.twitter.connected ? 'bg-neutral-900 border-neutral-700/50' : 'bg-neutral-950/40 border-white/5 opacity-65'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-neutral-950 flex items-center justify-center text-white font-extrabold text-xs border border-white/10">
                        𝕏
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white block">Twitter / X</span>
                        <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5">
                          {socialConnections.twitter.connected ? socialConnections.twitter.handle : 'Not Connected'}
                        </span>
                      </div>
                    </div>
                    {socialConnections.twitter.connected && (
                      <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">Linked</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-[10px] text-neutral-500 font-medium">Metric: {socialConnections.twitter.metric}</span>
                    {socialConnections.twitter.connected ? (
                      <button
                        type="button"
                        onClick={() => disconnectPlatform('twitter')}
                        className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => connectPlatform('twitter', '@flowforge')}
                        className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        {isSocialConnecting === 'twitter' ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Pinterest */}
                <div className={`p-4 rounded-xl border transition-all flex flex-col justify-between h-36 ${socialConnections.pinterest.connected ? 'bg-red-950/10 border-red-500/20' : 'bg-neutral-950/40 border-white/5 opacity-65'}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-lg bg-red-700 flex items-center justify-center text-white font-bold text-sm">
                        P
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white block">Pinterest</span>
                        <span className="text-[10px] text-neutral-400 font-mono block leading-none mt-0.5">
                          {socialConnections.pinterest.connected ? socialConnections.pinterest.handle : 'Not Connected'}
                        </span>
                      </div>
                    </div>
                    {socialConnections.pinterest.connected && (
                      <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full uppercase font-mono">Linked</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-[10px] text-neutral-500 font-medium">Metric: {socialConnections.pinterest.metric}</span>
                    {socialConnections.pinterest.connected ? (
                      <button
                        type="button"
                        onClick={() => disconnectPlatform('pinterest')}
                        className="px-2.5 py-1 bg-rose-900/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => connectPlatform('pinterest', '@flowforge')}
                        className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-neutral-900 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                      >
                        {isSocialConnecting === 'pinterest' ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Messaging & SLA parameters */}
            <div className="rounded-xl border border-white/5 bg-neutral-900/20 p-5 backdrop-blur-md space-y-4">
              <div className="flex items-center gap-2 text-white border-b border-white/5 pb-3">
                <Volume2 className="h-4.5 w-4.5 text-blue-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider">Telemetry Notifications</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Object.entries(notifications).map(([notif, val]) => (
                  <div 
                    key={notif}
                    onClick={() => setNotifications({ ...notifications, [notif]: !val })}
                    className="flex items-center justify-between p-3 rounded-lg bg-neutral-950/40 border border-white/5 cursor-pointer hover:bg-neutral-950/70 transition-colors"
                  >
                    <span className="text-xs font-bold text-neutral-300 capitalize">{notif.replace(/([A-Z])/g, ' $1')} notifications</span>
                    <button type="button">
                      {val ? (
                        <ToggleRight className="h-6 w-6 text-blue-500" />
                      ) : (
                        <ToggleLeft className="h-6 w-6 text-neutral-600" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Save button footer */}
            <div className="flex items-center justify-between border-t border-white/5 pt-4">
              <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 font-medium">
                <Shield className="h-4 w-4 text-neutral-500" />
                <span>Encrypted using tenant cryptokey vault. Complies with SOC2 standards.</span>
              </div>
              
              <div className="flex items-center gap-3">
                <button 
                  id="btn-save-settings"
                  type="submit"
                  className="rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-bold text-white transition-all hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-500/20 font-sans"
                >
                  Sync Configuration
                </button>
              </div>
            </div>

          </form>
        </>
      ) : (
        /* DATABASE TAB: Social Schema Explorer and Relations Console */
        <div className="space-y-6" id="social-db-explorer-view">
          
          {dbSuccessAlert && (
            <div className="rounded-lg border border-emerald-500/10 bg-emerald-500/10 p-3 text-xs font-bold text-emerald-400 flex items-center gap-2">
              <Check className="h-4 w-4" />
              <span>{dbSuccessAlert}</span>
            </div>
          )}

          {/* Table Selector & Relational Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            
            {/* Database stats summary */}
            <div className="md:col-span-1 rounded-xl border border-white/5 bg-neutral-900/40 p-4 space-y-3">
              <h4 className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Relational Schema Stats</h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center py-1 border-b border-white/5 text-xs">
                  <span className="text-neutral-400">Channels</span>
                  <span className="font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded">{dbChannels.length} rows</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-white/5 text-xs">
                  <span className="text-neutral-400">Posts</span>
                  <span className="font-mono text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded">{dbPosts.length} rows</span>
                </div>
                <div className="flex justify-between items-center py-1 text-xs">
                  <span className="text-neutral-400">Junction Targets</span>
                  <span className="font-mono text-purple-400 font-bold bg-purple-500/10 px-2 py-0.5 rounded">{dbPostTargets.length} rows</span>
                </div>
              </div>

              {/* ASCII Schema relationship viz */}
              <div className="pt-2">
                <span className="text-[9px] font-bold text-neutral-500 uppercase block tracking-widest mb-1.5">Table Relationships</span>
                <div className="font-mono text-[9px] text-neutral-400 leading-normal bg-neutral-950 p-2.5 rounded-lg border border-white/5 overflow-x-auto whitespace-pre">
                  {`User [1]\n  │\n  ├───► Channels [1:M]\n  │       │ (channel_id)\n  │       ▼\n  │     PostTarget [M:1]\n  │       ▲\n  │       │ (post_id)\n  └───► Posts [1:M]`}
                </div>
              </div>
            </div>

            {/* Direct Table Browsing Tabs */}
            <div className="md:col-span-3 rounded-xl border border-white/5 bg-neutral-900/20 backdrop-blur-md p-4 space-y-4 flex flex-col justify-between">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2">Relational Database Table Selection</h4>
                <p className="text-[11px] text-neutral-400 mb-4">
                  Select and browse any raw table rows. Our cascade rules will automatically clean related junction records.
                </p>
                
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedExploreTable('channels')}
                    className={`px-4 py-2.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-2 cursor-pointer ${
                      selectedExploreTable === 'channels'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-neutral-950/40 border-white/5 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Channels Table ({dbChannels.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedExploreTable('posts')}
                    className={`px-4 py-2.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-2 cursor-pointer ${
                      selectedExploreTable === 'posts'
                        ? 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                        : 'bg-neutral-950/40 border-white/5 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    Posts Table ({dbPosts.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedExploreTable('post-targets')}
                    className={`px-4 py-2.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-2 cursor-pointer ${
                      selectedExploreTable === 'post-targets'
                        ? 'bg-purple-500/10 border-purple-500/30 text-purple-400'
                        : 'bg-neutral-950/40 border-white/5 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Sliders className="h-3.5 w-3.5" />
                    Post_Targets (Junction Table) ({dbPostTargets.length})
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-white/5 text-[10.5px] text-neutral-500 flex items-center gap-1.5 font-mono">
                <Shield className="h-3.5 w-3.5" />
                <span>Backend Schema: Prisma v5 Client (Auto-synchronized PostgreSQL)</span>
              </div>
            </div>
          </div>

          {/* TABLE BROWSER AND MUTATORS */}

          {/* 1. CHANNELS TABLE DETAILS */}
          {selectedExploreTable === 'channels' && (
            <div className="space-y-4" id="table-channels-block">
              {/* Add Mock Channel Form */}
              <div className="rounded-xl border border-white/5 bg-neutral-900/20 p-5 backdrop-blur-md space-y-4">
                <div className="flex items-center gap-2 text-white border-b border-white/5 pb-3">
                  <Plus className="h-4.5 w-4.5 text-emerald-500" />
                  <h3 className="text-sm font-bold uppercase tracking-wider">Connect Channel (INSERT channel record)</h3>
                </div>
                <form onSubmit={handleAddChannel} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">Platform Identifier</label>
                    <select
                      value={newChPlatform}
                      onChange={(e) => setNewChPlatform(e.target.value)}
                      className="w-full text-xs font-bold bg-neutral-950 border border-white/5 rounded-lg p-2.5 text-white outline-none cursor-pointer"
                    >
                      <option value="LINKEDIN">LinkedIn API</option>
                      <option value="FACEBOOK">Facebook API</option>
                      <option value="TWITTER">X (Twitter) API</option>
                      <option value="INSTAGRAM">Instagram API</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">Handle / Username</label>
                    <input
                      type="text"
                      placeholder="@flowforge"
                      value={newChHandle}
                      onChange={(e) => setNewChHandle(e.target.value)}
                      className="w-full text-xs font-semibold bg-neutral-950 border border-white/5 rounded-lg p-2.5 text-white outline-none focus:border-emerald-500/30"
                    />
                  </div>
                  <div>
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold p-2.5 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Plus className="h-4 w-4" />
                      Insert Channel
                    </button>
                  </div>
                </form>
              </div>

              {/* Table rendering */}
              <div className="rounded-xl border border-white/5 bg-neutral-900/20 backdrop-blur-md overflow-hidden">
                <div className="p-4 border-b border-white/5 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">channels Table ({dbChannels.length} Rows)</h3>
                  <span className="text-[10px] text-neutral-500 font-mono">PRIMARY KEY (id)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 bg-neutral-950/40 text-[10px] font-bold text-neutral-400 uppercase tracking-wider font-mono">
                        <th className="p-3">id</th>
                        <th className="p-3">platform</th>
                        <th className="p-3">handle</th>
                        <th className="p-3">access_token</th>
                        <th className="p-3">refresh_token</th>
                        <th className="p-3">expires_at</th>
                        <th className="p-3">user_id</th>
                        <th className="p-3 text-right">actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono text-[11px] text-neutral-200">
                      {dbChannels.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-8 text-center text-neutral-500 text-xs font-sans">
                            No channels connected. Use the link form above to add a channel!
                          </td>
                        </tr>
                      ) : (
                        dbChannels.map((ch) => (
                          <tr key={ch.id} className="hover:bg-white/5 transition-colors">
                            <td className="p-3 text-neutral-400 text-[10px]">{ch.id}</td>
                            <td className="p-3 font-sans font-bold">
                              <span className="bg-neutral-950 px-2 py-0.5 border border-white/5 rounded text-white text-[10px]">{ch.platform}</span>
                            </td>
                            <td className="p-3 font-sans font-bold text-emerald-400">{ch.handle}</td>
                            <td className="p-3 text-neutral-500 text-[10px] select-all cursor-help" title={ch.accessToken}>{ch.accessToken.substring(0, 10)}...</td>
                            <td className="p-3 text-neutral-500 text-[10px] select-all" title={ch.refreshToken}>{ch.refreshToken}</td>
                            <td className="p-3 text-[10px] text-neutral-400">{new Date(ch.expiresAt).toLocaleDateString()}</td>
                            <td className="p-3 text-neutral-500 text-[10px]">{ch.userId}</td>
                            <td className="p-3 text-right font-sans">
                              <button
                                type="button"
                                onClick={() => handleDeleteChannel(ch.id)}
                                className="text-rose-400 hover:text-rose-300 p-1 bg-rose-500/10 border border-rose-500/20 rounded hover:bg-rose-500/20 cursor-pointer"
                                title="Prune channel and cascade delete all targets"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 2. POSTS TABLE DETAILS */}
          {selectedExploreTable === 'posts' && (
            <div className="space-y-4" id="table-posts-block">
              {/* Add Mock Post Form */}
              <div className="rounded-xl border border-white/5 bg-neutral-900/20 p-5 backdrop-blur-md space-y-4">
                <div className="flex items-center gap-2 text-white border-b border-white/5 pb-3">
                  <Plus className="h-4.5 w-4.5 text-blue-500" />
                  <h3 className="text-sm font-bold uppercase tracking-wider">Schedule New Content (INSERT posts record)</h3>
                </div>
                <form onSubmit={handleCreatePost} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">Post Text Content (Caption)</label>
                    <textarea
                      placeholder="Enter the social post content copy..."
                      value={newPostText}
                      onChange={(e) => setNewPostText(e.target.value)}
                      rows={3}
                      className="w-full text-xs font-semibold bg-neutral-950 border border-white/5 rounded-lg p-2.5 text-white outline-none focus:border-blue-500/30"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">Optional Media Image URL</label>
                      <input
                        type="text"
                        placeholder="https://images.unsplash.com/..."
                        value={newPostImageUrl}
                        onChange={(e) => setNewPostImageUrl(e.target.value)}
                        className="w-full text-xs font-semibold bg-neutral-950 border border-white/5 rounded-lg p-2.5 text-white outline-none focus:border-blue-500/30"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest block">Scheduling delay</label>
                      <select
                        value={newPostDelay}
                        onChange={(e) => setNewPostDelay(e.target.value)}
                        className="w-full text-xs font-bold bg-neutral-950 border border-white/5 rounded-lg p-2.5 text-white outline-none cursor-pointer"
                      >
                        <option value="15">15 minutes delay</option>
                        <option value="120">2 hours delay</option>
                        <option value="1440">24 hours delay</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      className="rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-5 py-2.5 transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <Plus className="h-4 w-4" />
                      Create Post & Generate Targets
                    </button>
                  </div>
                </form>
              </div>

              {/* Table rendering */}
              <div className="rounded-xl border border-white/5 bg-neutral-900/20 backdrop-blur-md overflow-hidden">
                <div className="p-4 border-b border-white/5 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">posts Table ({dbPosts.length} Rows)</h3>
                  <span className="text-[10px] text-neutral-500 font-mono">PRIMARY KEY (id)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 bg-neutral-950/40 text-[10px] font-bold text-neutral-400 uppercase tracking-wider font-mono">
                        <th className="p-3">id</th>
                        <th className="p-3">text content</th>
                        <th className="p-3">image_urls</th>
                        <th className="p-3">scheduled_at</th>
                        <th className="p-3">created_by_id</th>
                        <th className="p-3 text-right">actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono text-[11px] text-neutral-200">
                      {dbPosts.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-neutral-500 text-xs font-sans">
                            No posts found. Use the schedule form above to insert some content rows!
                          </td>
                        </tr>
                      ) : (
                        dbPosts.map((post) => (
                          <tr key={post.id} className="hover:bg-white/5 transition-colors">
                            <td className="p-3 text-neutral-400 text-[10px]">{post.id}</td>
                            <td className="p-3 font-sans text-xs max-w-xs truncate" title={post.text}>{post.text}</td>
                            <td className="p-3 text-neutral-400 text-[10px] max-w-xs truncate" title={JSON.stringify(post.imageUrls)}>
                              {post.imageUrls.length > 0 ? (
                                <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1 rounded text-[9px] block w-fit">
                                  1 attachment
                                </span>
                              ) : (
                                <span className="text-neutral-600">[]</span>
                              )}
                            </td>
                            <td className="p-3 text-[10px] text-amber-400 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(post.scheduledAt).toLocaleString()}
                            </td>
                            <td className="p-3 text-neutral-500 text-[10px]">{post.createdById}</td>
                            <td className="p-3 text-right font-sans">
                              <button
                                type="button"
                                onClick={() => handleDeletePost(post.id)}
                                className="text-rose-400 hover:text-rose-300 p-1 bg-rose-500/10 border border-rose-500/20 rounded hover:bg-rose-500/20 cursor-pointer"
                                title="Delete post and related platform target entries"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 3. POST TARGETS JUNCTION TABLE DETAILS */}
          {selectedExploreTable === 'post-targets' && (
            <div className="space-y-4" id="table-post-targets-block">
              {/* Informative Guidance Card */}
              <div className="rounded-xl border border-white/5 bg-neutral-900/40 p-5 space-y-2">
                <div className="flex items-center gap-2 text-white">
                  <Shield className="h-4.5 w-4.5 text-purple-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wider">Junction Table Mechanics</h3>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  The <span className="font-mono text-purple-400 bg-purple-500/5 px-1 py-0.5 rounded border border-purple-500/10">post_targets</span> table tracks the delivery status of each post 
                  across individual connected social channels. Here you can simulate the asynchronous publishing worker, transitioning statuses 
                  from <span className="text-amber-400">PENDING</span> to <span className="text-emerald-400">PUBLISHED</span> or <span className="text-red-400">FAILED</span> with simulated logging.
                </p>
              </div>

              {/* Table rendering */}
              <div className="rounded-xl border border-white/5 bg-neutral-900/20 backdrop-blur-md overflow-hidden">
                <div className="p-4 border-b border-white/5 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">post_targets Junction Table ({dbPostTargets.length} Rows)</h3>
                  <span className="text-[10px] text-neutral-500 font-mono">FOREIGN KEYS (post_id, channel_id)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 bg-neutral-950/40 text-[10px] font-bold text-neutral-400 uppercase tracking-wider font-mono">
                        <th className="p-3">id</th>
                        <th className="p-3">post_id (Post Text)</th>
                        <th className="p-3">channel_id (Channel Handle)</th>
                        <th className="p-3">status</th>
                        <th className="p-3">error_log</th>
                        <th className="p-3">published_at</th>
                        <th className="p-3 text-right">simulation console</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono text-[11px] text-neutral-200">
                      {dbPostTargets.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-8 text-center text-neutral-500 text-xs font-sans">
                            No target junction records found. Make sure you have both channels and posts created first!
                          </td>
                        </tr>
                      ) : (
                        dbPostTargets.map((pt) => {
                          const targetPost = dbPosts.find(p => p.id === pt.postId);
                          const targetChannel = dbChannels.find(c => c.id === pt.channelId);
                          return (
                            <tr key={pt.id} className="hover:bg-white/5 transition-colors">
                              <td className="p-3 text-neutral-400 text-[10px]">{pt.id}</td>
                              <td className="p-3 max-w-xs">
                                <span className="text-neutral-500 text-[10px] block">{pt.postId}</span>
                                <span className="font-sans text-[11px] text-neutral-300 truncate block max-w-[180px]" title={targetPost?.text || 'Post not found'}>
                                  {targetPost ? targetPost.text : <span className="text-rose-500">Deleted Cascade</span>}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className="text-neutral-500 text-[10px] block">{pt.channelId}</span>
                                <span className="font-sans text-[11px] font-bold text-emerald-400 block">
                                  {targetChannel ? `${targetChannel.platform} (${targetChannel.handle})` : <span className="text-rose-500">Deleted Cascade</span>}
                                </span>
                              </td>
                              <td className="p-3 font-sans">
                                {pt.status === 'PENDING' && (
                                  <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 font-mono uppercase">Pending</span>
                                )}
                                {pt.status === 'PUBLISHED' && (
                                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono uppercase">Published</span>
                                )}
                                {pt.status === 'FAILED' && (
                                  <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 font-mono uppercase">Failed</span>
                                )}
                              </td>
                              <td className="p-3 max-w-xs text-rose-400/90 text-[10px] truncate" title={pt.errorLog || ''}>
                                {pt.errorLog || <span className="text-neutral-600">NULL</span>}
                              </td>
                              <td className="p-3 text-[10px] text-neutral-400">
                                {pt.publishedAt ? new Date(pt.publishedAt).toLocaleString() : <span className="text-neutral-600">NULL</span>}
                              </td>
                              <td className="p-3 text-right font-sans">
                                {pt.status === 'PENDING' ? (
                                  <div className="flex justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleSimulatePublish(pt.id, false)}
                                      className="px-2 py-1 bg-emerald-600/30 hover:bg-emerald-600 text-emerald-300 hover:text-white text-[10px] font-bold rounded transition-colors cursor-pointer"
                                    >
                                      Sim Publish
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSimulatePublish(pt.id, true)}
                                      className="px-2 py-1 bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white text-[10px] font-bold rounded transition-colors cursor-pointer"
                                    >
                                      Sim Fail
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      // Reset status back to PENDING for retesting
                                      handleSimulatePublish(pt.id, false, true);
                                    }}
                                    className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 text-[10px] font-bold rounded transition-colors cursor-pointer"
                                  >
                                    Re-test
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
