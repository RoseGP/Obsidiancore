import React, { useState } from 'react';
import { 
  Bell, 
  Mail, 
  Smartphone, 
  Volume2, 
  VolumeX, 
  ShieldCheck, 
  Clock, 
  Sliders, 
  Check, 
  AlertTriangle, 
  Zap, 
  Send, 
  X, 
  RefreshCw, 
  Info,
  CheckCircle2,
  Filter,
  UserCheck,
  Flame,
  Radio
} from 'lucide-react';
import { 
  useNotifications, 
  EventTypePreferences, 
  DEFAULT_NOTIFICATION_PREFERENCES 
} from '../../context/NotificationContext';

interface NotificationPreferencesModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  inline?: boolean;
}

export default function NotificationPreferencesModal({
  isOpen = true,
  onClose,
  inline = false,
}: NotificationPreferencesModalProps) {
  const {
    preferences,
    updatePreferences,
    updateEventPreference,
    resetPreferences,
    pushPermission,
    requestPushPermission,
    emailDispatches,
    clearEmailDispatches,
    sendTestNotification,
    soundEnabled,
    setSoundEnabled,
  } = useNotifications();

  const [activeTab, setActiveTab] = useState<'matrix' | 'channels' | 'quiet_hours' | 'email_logs'>('matrix');
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [requestingPush, setRequestingPush] = useState(false);

  if (!isOpen && !inline) return null;

  const handleTest = (channel: 'inApp' | 'email' | 'push', type: 'lead' | 'task' | 'system') => {
    sendTestNotification(channel, type);
    setTestStatus(channel === 'email' ? 'Test logged. Email alerts aren\'t connected to a mail service yet, so nothing was emailed.' : `Test ${type} notification shown via ${channel === 'inApp' ? 'in-app alerts' : 'browser push'}.`);
    setTimeout(() => setTestStatus(null), 3500);
  };

  const handleRequestPush = async () => {
    setRequestingPush(true);
    const granted = await requestPushPermission();
    setRequestingPush(false);
    if (granted) {
      setTestStatus('Browser desktop push notifications enabled!');
    } else {
      setTestStatus('Push notification permission was denied or not granted.');
    }
    setTimeout(() => setTestStatus(null), 4000);
  };

  const content = (
    <div className="flex flex-col h-full text-neutral-100">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-neutral-950/80 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              Notification Preferences &amp; Alert Routing
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                Omnichannel CRM
              </span>
            </h2>
            <p className="text-xs text-neutral-400">
              Customize real-time alerts across In-App, Browser Push, and Email channels with granular priority thresholds.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {testStatus && (
            <div className="px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-1.5 animate-in fade-in">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{testStatus}</span>
            </div>
          )}
          {!inline && onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs navigation */}
      <div className="flex items-center gap-1 px-6 pt-3 pb-2 border-b border-white/5 bg-neutral-900/60 overflow-x-auto shrink-0">
        <button
          onClick={() => setActiveTab('matrix')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'matrix'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Event Matrix (Leads, Tasks, System)</span>
        </button>

        <button
          onClick={() => setActiveTab('channels')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'channels'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          <span>Delivery Channels &amp; Push API</span>
        </button>

        <button
          onClick={() => setActiveTab('quiet_hours')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'quiet_hours'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Quiet Hours &amp; Priority Filters</span>
        </button>

        <button
          onClick={() => setActiveTab('email_logs')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'email_logs'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/5'
          }`}
        >
          <Mail className="w-3.5 h-3.5" />
          <span>Email Queue &amp; Audit Log ({emailDispatches.length})</span>
        </button>
      </div>

      {/* Main body area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* TAB 1: EVENT MATRIX */}
        {activeTab === 'matrix' && (
          <div className="space-y-6">
            <div className="rounded-xl border border-white/5 bg-neutral-900/30 p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Filter className="w-4 h-4 text-blue-400" />
                    Granular Notification Matrix by Event Type
                  </h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Select which notification channels receive each alert category.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => resetPreferences()}
                    className="px-2.5 py-1 rounded-md text-xs font-semibold text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reset to Default
                  </button>
                </div>
              </div>

              {/* Table / Grid */}
              <div className="overflow-x-auto rounded-lg border border-white/5 bg-neutral-950/60">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-neutral-900/40 text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">
                      <th className="py-3 px-4">Event Alert Type</th>
                      <th className="py-3 px-3 text-center">
                        <span className="flex items-center justify-center gap-1.5">
                          <Bell className="w-3.5 h-3.5 text-blue-400" />
                          In-App Toasts
                        </span>
                      </th>
                      <th className="py-3 px-3 text-center">
                        <span className="flex items-center justify-center gap-1.5">
                          <Smartphone className="w-3.5 h-3.5 text-purple-400" />
                          Web Push
                        </span>
                      </th>
                      <th className="py-3 px-3 text-center">
                        <span className="flex items-center justify-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-amber-400" />
                          Email Digest
                        </span>
                      </th>
                      <th className="py-3 px-4 text-right">Instant Test</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {/* New Leads */}
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-orange-500/15 text-orange-400 flex items-center justify-center shrink-0">
                            <Flame className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-semibold text-white">New Lead Alerts</div>
                            <div className="text-[11px] text-neutral-400">
                              Instant inbound capture from WhatsApp, web forms, and social gateways
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.newLeadAlerts.inApp}
                          onChange={(e) => updateEventPreference('newLeadAlerts', 'inApp', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.newLeadAlerts.push}
                          onChange={(e) => updateEventPreference('newLeadAlerts', 'push', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.newLeadAlerts.email}
                          onChange={(e) => updateEventPreference('newLeadAlerts', 'email', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleTest('inApp', 'lead')}
                          className="px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          Trigger Lead Alert
                        </button>
                      </td>
                    </tr>

                    {/* Task Reminders */}
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
                            <Clock className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-semibold text-white">Task Reminders &amp; Deadlines</div>
                            <div className="text-[11px] text-neutral-400">
                              Upcoming calendar events, SLA reminders, and contract renewals
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.taskReminders.inApp}
                          onChange={(e) => updateEventPreference('taskReminders', 'inApp', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.taskReminders.push}
                          onChange={(e) => updateEventPreference('taskReminders', 'push', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.taskReminders.email}
                          onChange={(e) => updateEventPreference('taskReminders', 'email', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleTest('inApp', 'task')}
                          className="px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          Trigger Task Alert
                        </button>
                      </td>
                    </tr>

                    {/* System Updates */}
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-400 flex items-center justify-center shrink-0">
                            <ShieldCheck className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-semibold text-white">System Updates &amp; Security</div>
                            <div className="text-[11px] text-neutral-400">
                              OAuth token refreshes, sync cluster health, and RBAC permission alterations
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.systemUpdates.inApp}
                          onChange={(e) => updateEventPreference('systemUpdates', 'inApp', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.systemUpdates.push}
                          onChange={(e) => updateEventPreference('systemUpdates', 'push', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.systemUpdates.email}
                          onChange={(e) => updateEventPreference('systemUpdates', 'email', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleTest('inApp', 'system')}
                          className="px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          Trigger System Alert
                        </button>
                      </td>
                    </tr>

                    {/* Client Messages */}
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-400 flex items-center justify-center shrink-0">
                            <Zap className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-semibold text-white">Client OmniChannel Messages</div>
                            <div className="text-[11px] text-neutral-400">
                              Incoming replies from Telegram, WhatsApp, SMS, and Instagram
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.clientMessages.inApp}
                          onChange={(e) => updateEventPreference('clientMessages', 'inApp', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.clientMessages.push}
                          onChange={(e) => updateEventPreference('clientMessages', 'push', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.clientMessages.email}
                          onChange={(e) => updateEventPreference('clientMessages', 'email', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <span className="text-[11px] text-neutral-500 font-mono">Real-Time</span>
                      </td>
                    </tr>

                    {/* SLA Escalation */}
                    <tr className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-rose-500/15 text-rose-400 flex items-center justify-center shrink-0">
                            <AlertTriangle className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-semibold text-white">SLA Breach Escalations</div>
                            <div className="text-[11px] text-neutral-400">
                              High-priority breach warnings when response times exceed SLA agreements
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.slaEscalations.inApp}
                          onChange={(e) => updateEventPreference('slaEscalations', 'inApp', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.slaEscalations.push}
                          onChange={(e) => updateEventPreference('slaEscalations', 'push', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={preferences.events.slaEscalations.email}
                          onChange={(e) => updateEventPreference('slaEscalations', 'email', e.target.checked)}
                          className="w-4 h-4 rounded border-neutral-700 bg-neutral-900 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 font-bold">
                          Urgent Tier
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: DELIVERY CHANNELS */}
        {activeTab === 'channels' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Channel 1: In-App Toasts */}
            <div className="rounded-xl border border-white/5 bg-neutral-900/30 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                    <Bell className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">In-App Notifications</h4>
                    <p className="text-xs text-neutral-400">Floating toasts &amp; top-bar badge count</p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.channels.inApp}
                    onChange={(e) => updatePreferences({ channels: { ...preferences.channels, inApp: e.target.checked } })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
                </label>
              </div>

              <p className="text-xs text-neutral-400 leading-relaxed">
                Renders luxury obsidian glass banners with deep-link navigation directly into messages, deals, and calendar views.
              </p>

              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <span className="text-xs text-neutral-300 font-medium">Sound Effects</span>
                <button
                  onClick={() => {
                    const next = !soundEnabled;
                    setSoundEnabled(next);
                    updatePreferences({ channels: { ...preferences.channels, sound: next } });
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    soundEnabled
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                  }`}
                >
                  {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  <span>{soundEnabled ? 'Chime Enabled' : 'Muted'}</span>
                </button>
              </div>
            </div>

            {/* Channel 2: Web Push API */}
            <div className="rounded-xl border border-white/5 bg-neutral-900/30 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Browser Push Notifications</h4>
                    <p className="text-xs text-neutral-400">Native OS notifications even when tab is backgrounded</p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.channels.push}
                    onChange={(e) => updatePreferences({ channels: { ...preferences.channels, push: e.target.checked } })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600" />
                </label>
              </div>

              <div className="p-3 rounded-lg bg-neutral-950/60 border border-white/5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-400">Browser Permission:</span>
                  <span className={`font-semibold capitalize px-2 py-0.5 rounded text-[11px] ${
                    pushPermission === 'granted'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : pushPermission === 'denied'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}>
                    {pushPermission}
                  </span>
                </div>

                {pushPermission !== 'granted' && (
                  <button
                    onClick={handleRequestPush}
                    disabled={requestingPush}
                    className="w-full mt-2 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>{requestingPush ? 'Requesting...' : 'Request Browser Push Permission'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Channel 3: Email Alerts */}
            <div className="rounded-xl border border-white/5 bg-neutral-900/30 p-5 space-y-4 md:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Email Dispatch Gateway</h4>
                    <p className="text-xs text-neutral-400">Automated executive summaries and lead dispatches</p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.channels.email}
                    onChange={(e) => updatePreferences({ channels: { ...preferences.channels, email: e.target.checked } })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600" />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-300">Executive Recipient Email</label>
                  <input
                    type="email"
                    value={preferences.emailRecipient}
                    onChange={(e) => updatePreferences({ emailRecipient: e.target.value })}
                    placeholder="executive@domain.com"
                    className="w-full text-xs font-mono bg-neutral-950/80 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-amber-500/40"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-neutral-300">Delivery Cadence</label>
                  <select
                    value={preferences.deliveryFrequency}
                    onChange={(e) => updatePreferences({ deliveryFrequency: e.target.value as any })}
                    className="w-full text-xs font-semibold bg-neutral-950/80 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-amber-500/40 cursor-pointer"
                  >
                    <option value="instant">Instant Real-Time (Immediate per event)</option>
                    <option value="hourly_digest">Hourly Digest Summary</option>
                    <option value="daily_summary">Daily Executive Briefing (08:00 AM)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: QUIET HOURS & PRIORITY FILTERS */}
        {activeTab === 'quiet_hours' && (
          <div className="space-y-6">
            {/* Priority Threshold */}
            <div className="rounded-xl border border-white/5 bg-neutral-900/30 p-5 space-y-4">
              <div className="flex items-center gap-2 text-white">
                <Filter className="w-4 h-4 text-blue-400" />
                <h4 className="text-sm font-bold">Minimum Priority Threshold</h4>
              </div>
              <p className="text-xs text-neutral-400">
                Filter out noisy lower-priority alerts. Choose what level of urgency is required to produce alerts.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    id: 'all',
                    title: 'All Notifications',
                    desc: 'Receive normal, high, and urgent notifications without filtering',
                    badge: 'Full Stream',
                  },
                  {
                    id: 'high_and_urgent',
                    title: 'High & Urgent Only',
                    desc: 'Suppresses low and normal priority chatter; surfaces qualified leads and tasks',
                    badge: 'Recommended',
                  },
                  {
                    id: 'urgent_only',
                    title: 'Urgent Only',
                    desc: 'Strict executive silence; only triggers on SLA breaches and critical events',
                    badge: 'Minimalist',
                  },
                ].map((item) => {
                  const isSelected = preferences.priorityThreshold === item.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => updatePreferences({ priorityThreshold: item.id as any })}
                      className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-blue-600/15 border-blue-500 text-white shadow-lg shadow-blue-500/10'
                          : 'bg-neutral-950/40 border-white/5 text-neutral-400 hover:text-white hover:border-white/10'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold text-xs text-white">{item.title}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            isSelected ? 'bg-blue-500 text-white' : 'bg-white/5 text-neutral-400'
                          }`}>
                            {item.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-400 leading-snug">{item.desc}</p>
                      </div>

                      <div className="mt-4 flex items-center gap-2 text-xs font-semibold">
                        <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${
                          isSelected ? 'border-blue-400 bg-blue-500' : 'border-neutral-600'
                        }`}>
                          {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <span className={isSelected ? 'text-blue-300' : 'text-neutral-500'}>
                          {isSelected ? 'Active Filter' : 'Select'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quiet Hours */}
            <div className="rounded-xl border border-white/5 bg-neutral-900/30 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Quiet Hours (Do Not Disturb)</h4>
                    <p className="text-xs text-neutral-400">
                      Silence audio chimes and in-app toasts during off-work executive hours
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferences.quietHours.enabled}
                    onChange={(e) => updatePreferences({ quietHours: { ...preferences.quietHours, enabled: e.target.checked } })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-neutral-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                </label>
              </div>

              {preferences.quietHours.enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-neutral-950/60 border border-white/5 animate-in fade-in">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-neutral-300">Quiet Hours Start</label>
                    <input
                      type="time"
                      value={preferences.quietHours.start}
                      onChange={(e) => updatePreferences({ quietHours: { ...preferences.quietHours, start: e.target.value } })}
                      className="w-full text-xs font-mono bg-neutral-900 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-indigo-500/40 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-neutral-300">Quiet Hours End</label>
                    <input
                      type="time"
                      value={preferences.quietHours.end}
                      onChange={(e) => updatePreferences({ quietHours: { ...preferences.quietHours, end: e.target.value } })}
                      className="w-full text-xs font-mono bg-neutral-900 border border-white/10 rounded-lg p-2.5 text-white outline-none focus:border-indigo-500/40 cursor-pointer"
                    />
                  </div>

                  <div className="sm:col-span-2 text-[11px] text-neutral-400 flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>Emergency SLA breaches (Urgent Priority) will bypass quiet hours to guarantee response compliance.</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: EMAIL QUEUE & AUDIT LOG */}
        {activeTab === 'email_logs' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Mail className="w-4 h-4 text-amber-400" />
                  Simulated Outbound Email Notification Log
                </h4>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Verified outbound emails generated by the CRM's notification engine according to user preferences.
                </p>
              </div>

              {emailDispatches.length > 0 && (
                <button
                  onClick={clearEmailDispatches}
                  className="px-2.5 py-1 rounded-md text-xs font-semibold text-neutral-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Clear Queue
                </button>
              )}
            </div>

            {emailDispatches.length === 0 ? (
              <div className="rounded-xl border border-white/5 bg-neutral-900/30 p-12 text-center text-neutral-500 text-xs">
                No email alerts yet. Email alerts aren't connected to a mail service yet: alerts are logged here but not emailed.
              </div>
            ) : (
              <div className="space-y-2.5">
                {emailDispatches.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl border border-white/5 bg-neutral-950/60 hover:border-white/10 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">{item.subject}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${item.status === 'sent' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-neutral-700/60 text-neutral-300'}`}>
                          {item.status === 'not_sent' ? 'NOT SENT' : item.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-neutral-400 text-[11px] leading-relaxed line-clamp-1">{item.preview}</p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-[11px] font-mono text-neutral-400">To: {item.recipient}</div>
                      <div className="text-[10px] text-neutral-500">{item.timestamp}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div className="px-6 py-3.5 border-t border-white/10 bg-neutral-950 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Real-time event synchronization engine active</span>
        </div>

        <div className="flex items-center gap-2">
          {!inline && onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
            >
              Done &amp; Save
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (inline) {
    return (
      <div className="rounded-2xl border border-white/10 bg-neutral-900/90 shadow-2xl overflow-hidden min-h-[580px] flex flex-col">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-4xl h-[680px] rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {content}
      </div>
    </div>
  );
}
