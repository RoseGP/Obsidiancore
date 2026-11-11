/**
 * Google connection & activity: the real state of the Google connection and the activity log
 * the server keeps for it (connects, syncs, replies, posts, profile changes). No invented score.
 */
import React from 'react';
import { ShieldCheck, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';
import { LocalPilotRoute } from '../types';
import { useOptionalLocalSeo } from '../live/localSeoClient';

export interface SecurityViewProps {
  onNavigate: (route: LocalPilotRoute) => void;
  /** Starts the Google connection again (new authorization). */
  onRefreshOAuth: () => void;
}

export const SecurityView: React.FC<SecurityViewProps> = ({ onNavigate, onRefreshOAuth }) => {
  const seo = useOptionalLocalSeo();
  const c = seo?.connection;
  const activity = seo?.activity || [];
  const syncErrors = c?.lastSync?.errors || [];

  const tiles = [
    { label: 'Google connection', value: c?.connected ? 'Connected' : c?.needsReconnect ? 'Needs reconnect' : 'Not connected', ok: !!c?.connected },
    { label: 'Signed in as', value: c?.email || '—', ok: true },
    { label: 'Locations managed', value: String(c?.selectedCount ?? 0), ok: true },
    { label: 'Last sync', value: c?.lastSync ? new Date(c.lastSync.at).toLocaleString() : 'Never', ok: !syncErrors.length },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200" id="localpilot-security-view">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Google connection & activity</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Who is connected, when data was last synced, and what this app changed on Google.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefreshOAuth} leftIcon={<RefreshCw className="h-3.5 w-3.5 text-slate-500" />}>
          Reconnect Google
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {tiles.map((t) => (
            <div key={t.label} className="p-3 rounded-lg bg-slate-50 border border-slate-100 min-w-0">
              <span className="text-slate-500 text-[10px] uppercase font-bold block">{t.label}</span>
              <span className={`font-semibold mt-0.5 block truncate ${t.ok ? 'text-slate-900' : 'text-amber-700'}`}>{t.value}</span>
            </div>
          ))}
        </div>

        <div className="space-y-2 text-xs">
          <p className="flex items-start gap-2 text-slate-600">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
            Google access tokens are stored encrypted on the server. Disconnecting revokes this app's access at Google.
          </p>
          {syncErrors.length > 0 ? (
            syncErrors.map((e, i) => (
              <p key={i} className="flex items-start gap-2 text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" /> {e}
              </p>
            ))
          ) : c?.lastSync ? (
            <p className="flex items-start gap-2 text-slate-600">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" /> The last sync finished without errors.
            </p>
          ) : null}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 px-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-900 tracking-tight">Recent activity</h3>
          <p className="text-xs text-slate-500">The last 30 events recorded for this Google connection.</p>
        </div>
        {activity.length === 0 ? (
          <p className="p-5 text-xs text-slate-500">No activity recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">When</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">What happened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activity.map((a, i) => (
                  <tr key={`${a.at}-${i}`}>
                    <td className="px-5 py-3 whitespace-nowrap text-slate-900 font-medium">{new Date(a.at).toLocaleString()}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500 capitalize">{a.type}</td>
                    <td className="px-4 py-3 text-slate-700">{a.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-400">
        Team roles are managed in the main app. <button type="button" className="text-blue-600 hover:underline cursor-pointer" onClick={() => onNavigate('settings')}>Local SEO settings</button>
      </p>
    </div>
  );
};

export default SecurityView;
