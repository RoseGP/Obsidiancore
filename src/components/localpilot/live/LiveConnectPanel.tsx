/** Shown until the user has connected Google and chosen locations. No mock data. */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Globe, Loader2, RefreshCw } from 'lucide-react';
import { useLocalSeo } from './localSeoClient';

export function LiveConnectPanel() {
  const seo = useLocalSeo();
  const c = seo.connection;
  const [busy, setBusy] = useState<'' | 'connect' | 'discover' | 'select'>('');
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const returnMsg = (() => {
    const p = new URLSearchParams(window.location.search);
    const g = p.get('gbp');
    if (g === 'connected') return { ok: true, text: 'Google account connected. Choose the locations to manage.' };
    if (g === 'cancelled') return { ok: false, text: 'Google authorization was cancelled. Nothing was connected.' };
    if (g === 'error') return { ok: false, text: ({ state_mismatch: 'The authorization didn’t match this browser session. Start again here.', expired: 'The authorization link expired or was already used. Start again.', scope_denied: 'Google Business Profile access wasn’t granted. Tick the Business Profile permission when you connect.', token_exchange: 'Google didn’t accept the authorization. Try again.' } as Record<string, string>)[p.get('gbp_reason') || ''] || 'The connection didn’t complete. Start again.' };
    return null;
  })();
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('gbp')) return;
    const p = new URLSearchParams(window.location.search); ['gbp', 'gbp_reason', 'view'].forEach((k) => p.delete(k));
    window.history.replaceState(null, '', `${window.location.pathname}${p.toString() ? `?${p}` : ''}${window.location.hash}`);
  }, []);
  useEffect(() => { if (c?.connected && seo.discovered.length === 0 && !busy) void run('discover', () => seo.discover()); }, [c?.connected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPicked(seo.discovered.filter((l) => l.selected).map((l) => l.name)); }, [seo.discovered]);

  async function run(kind: typeof busy, fn: () => Promise<unknown>) {
    setBusy(kind); setErr('');
    try { await fn(); } catch (e: any) { setErr(e?.message || 'Something went wrong.'); } finally { setBusy(''); }
  }

  const card = 'max-w-xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 shadow-sm';
  if (seo.status === 'loading') return <div className="flex items-center justify-center py-24 text-sm text-slate-500"><Loader2 className="w-4 h-4 mr-2 animate-spin" />Loading Local SEO…</div>;
  if (seo.status === 'error') return <div className={card} role="alert"><p className="font-semibold text-slate-900">Local SEO couldn’t load</p><p className="text-sm text-slate-500 mt-1">{seo.error}</p><button className="mt-4 text-sm font-semibold text-blue-600" onClick={() => void seo.reload()}>Try again</button></div>;

  return (
    <div className="py-10 px-4">
      <div className={card}>
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center"><Globe className="w-5 h-5" /></span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Connect Google Business Profile</h1>
            <p className="text-xs text-slate-500">Manage reviews, profile health and posts for your real locations.</p>
          </div>
        </div>
        {returnMsg && <p className={`mt-4 text-sm rounded-lg px-3 py-2 ${returnMsg.ok ? 'bg-slate-100 text-[#047857]' : 'bg-slate-50 text-[#B91C1C]'}`} role="status">{returnMsg.text}</p>}
        {err && <p className="mt-4 text-sm rounded-lg px-3 py-2 bg-slate-50 text-[#B91C1C]" role="alert">{err}</p>}

        {!c?.configured ? (
          <div className="mt-5 text-sm text-slate-600 space-y-2">
            <p className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-[#D97706] mt-0.5 flex-none" />Google isn’t configured on the server yet.</p>
            <p className="text-xs text-slate-500">An admin needs to set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_URL, enable the Business Profile APIs for the Google Cloud project, and add <code>/api/local-seo/callback</code> as an authorized redirect URI. See docs/local-seo/README.md.</p>
          </div>
        ) : !c.connected ? (
          <div className="mt-5">
            {c.needsReconnect && <p className="text-sm text-[#B45309] mb-3">Google access expired or was revoked. Reconnect to continue.</p>}
            <ul className="text-xs text-slate-500 space-y-1 mb-4 list-disc pl-4">
              <li>You’ll sign in with Google and approve Business Profile access.</li>
              <li>Replies are only published when you approve them.</li>
              <li>You can disconnect at any time; we revoke the access at Google.</li>
            </ul>
            <button className="w-full h-10 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-60" disabled={!!busy} onClick={() => void run('connect', () => seo.connect())}>
              {busy === 'connect' ? 'Opening Google…' : c.needsReconnect ? 'Reconnect Google' : 'Connect with Google'}
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <p className="text-sm text-slate-600 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-[#059669]" />Connected{c.email ? ` as ${c.email}` : ''}</p>
            <div className="flex items-center justify-between mt-4 mb-2">
              <p className="text-sm font-semibold text-slate-900">Choose locations to manage</p>
              <button className="text-xs font-semibold text-blue-600 flex items-center gap-1" disabled={!!busy} onClick={() => void run('discover', () => seo.discover())}><RefreshCw className={`w-3.5 h-3.5 ${busy === 'discover' ? 'animate-spin' : ''}`} />Refresh</button>
            </div>
            {busy === 'discover' && !seo.discovered.length ? <p className="text-sm text-slate-500 py-4">Loading your locations from Google…</p>
              : !seo.discovered.length ? <p className="text-sm text-slate-500 py-4">No locations were found on this Google account. Make sure it manages at least one verified Business Profile.</p>
              : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-72 overflow-auto">
                  {seo.discovered.map((l) => (
                    <li key={l.name}>
                      <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                        <input type="checkbox" className="w-4 h-4" checked={picked.includes(l.name)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, l.name] : p.filter((x) => x !== l.name))} />
                        <span className="min-w-0"><span className="block text-sm font-medium text-slate-900 truncate">{l.title}</span><span className="block text-xs text-slate-500 truncate">{[l.primaryCategory, l.address?.city].filter(Boolean).join(' · ')}</span></span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            <button className="mt-4 w-full h-10 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-60" disabled={!picked.length || !!busy} onClick={() => void run('select', () => seo.select(picked))}>
              {busy === 'select' ? 'Syncing reviews…' : `Manage ${picked.length || ''} location${picked.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
