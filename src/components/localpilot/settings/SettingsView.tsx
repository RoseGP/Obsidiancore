/**
 * Local SEO settings: reply style (saved on the server and used for AI reply drafts) and the
 * real state of each connection. Team members and billing live in the main app's Settings.
 */
import React, { useEffect, useState } from 'react';
import { Users, Globe, Sliders, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useOptionalLocalSeo } from '../live/localSeoClient';

type Voice = 'friendly' | 'professional' | 'casual' | 'luxury';

export interface SettingsViewProps {
  initialTab?: 'general' | 'team' | 'integrations';
}

export const SettingsView: React.FC<SettingsViewProps> = ({ initialTab = 'general' }) => {
  const seo = useOptionalLocalSeo();
  const c = seo?.connection;
  const [activeTab, setActiveTab] = useState<'general' | 'team' | 'integrations'>(initialTab);
  const [voice, setVoice] = useState<Voice>(c?.settings?.brandVoice || 'friendly');
  const [signOff, setSignOff] = useState(c?.settings?.signOff || '');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    setVoice(c?.settings?.brandVoice || 'friendly');
    setSignOff(c?.settings?.signOff || '');
  }, [c?.settings?.brandVoice, c?.settings?.signOff]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setMsg('');
    try { await fn(); setMsg(ok); } catch (e: any) { setMsg(e?.message || 'Something went wrong.'); } finally { setBusy(''); }
  };

  const integrations = [
    {
      id: 'gbp',
      name: 'Google Business Profile',
      description: 'Locations, reviews, replies, posts and performance.',
      status: !c?.configured ? 'Not set up on the server' : c.connected ? 'Connected' : c.needsReconnect ? 'Needs reconnect' : 'Not connected',
      ok: !!c?.connected,
      detail: c?.connected
        ? `${c.email ? `${c.email} · ` : ''}${c.lastSync ? `last sync ${new Date(c.lastSync.at).toLocaleString()}` : 'not synced yet'}`
        : '',
    },
    {
      id: 'ai',
      name: 'AI reply drafts',
      description: 'Drafts review replies for you to edit and approve.',
      status: c?.aiConfigured ? 'Configured' : 'Not configured',
      ok: !!c?.aiConfigured,
      detail: c?.aiConfigured ? '' : 'An admin needs to set GEMINI_API_KEY on the server.',
    },
    {
      id: 'rank',
      name: 'Search rank tracking',
      description: 'Where your locations appear in local search results.',
      status: 'Not available yet',
      ok: false,
      detail: '',
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-settings-view">

      <div className="pb-1">
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">Local SEO settings</h1>
        <p className="text-xs text-slate-500 mt-0.5">Reply style and connections for your Google Business Profile.</p>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200 pb-2 text-xs font-semibold overflow-x-auto">
        {[
          { id: 'general', label: 'Reply style', icon: Sliders },
          { id: 'integrations', label: 'Connections', icon: Globe },
          { id: 'team', label: 'Team', icon: Users },
        ].map((tab) => {
          const Icon = tab.icon;
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
                isSelected ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {msg && <p className="text-xs text-slate-700" role="status">{msg}</p>}

      {activeTab === 'general' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-6">
          <div>
            <h3 className="text-sm font-bold text-slate-900">How AI drafts your review replies</h3>
            <p className="text-xs text-slate-500">Used for every draft. You still edit and approve each reply before it's published.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="lp-voice" className="font-semibold text-slate-900 block mb-1">Tone</label>
              <select id="lp-voice" value={voice} onChange={(e) => setVoice(e.target.value as Voice)} className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900">
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="casual">Casual</option>
                <option value="luxury">Refined</option>
              </select>
            </div>
            <div>
              <label htmlFor="lp-signoff" className="font-semibold text-slate-900 block mb-1">Sign-off (optional)</label>
              <input id="lp-signoff" type="text" maxLength={80} value={signOff} onChange={(e) => setSignOff(e.target.value)} placeholder="e.g. The team at your business" className="w-full p-2 bg-white border border-slate-200 rounded-lg text-slate-900" />
            </div>
          </div>
          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={!seo || !!busy}
              onClick={() => seo && void run('save', () => seo.saveSettings({ brandVoice: voice, signOff: signOff.trim() }), 'Saved.')}
            >
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'integrations' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {integrations.map((item) => (
            <div key={item.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-bold text-xs text-slate-900">{item.name}</h4>
                  <Badge variant={item.ok ? 'success' : 'neutral'} size="sm">{item.status}</Badge>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{item.description}</p>
                {item.detail && <span className="text-[10px] text-slate-400 block">{item.detail}</span>}
              </div>
              {item.id === 'gbp' && c?.connected && seo && (
                <div className="pt-4 mt-4 border-t border-slate-100 flex justify-end">
                  <Button variant="outline" size="xs" disabled={!!busy} onClick={() => void run('sync', () => seo.sync(), 'Synced from Google.')} leftIcon={<RefreshCw className="h-3 w-3" />}>
                    {busy === 'sync' ? 'Syncing…' : 'Sync now'}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'team' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-2">
          <h3 className="text-sm font-bold text-slate-900">Team members</h3>
          <p className="text-xs text-slate-500">
            Invite people and set their roles in the main app under Settings, Team. The Google connection here belongs to the person who connected it.
          </p>
        </div>
      )}
    </div>
  );
};

export default SettingsView;
