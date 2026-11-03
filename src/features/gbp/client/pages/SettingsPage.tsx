/** Connection, locations, reply voice, and integration status. */
import React, { useState } from 'react';
import { Link2Off, MapPin, RefreshCw } from 'lucide-react';
import type { GLocation } from '../api';
import { SetupList } from '../Onboarding';
import { useGrowth, useLoad } from '../GrowthStore';
import { Alert, Badge, Button, Card, Dialog, Field, PageHeader, Skeleton, fmtDateTime, useToast } from '../ui';

export default function SettingsPage() {
  const { api, dash, reload } = useGrowth();
  const toast = useToast();
  const conn = dash!.connection;
  const locs = useLoad(() => api<GLocation[]>('/locations'), []);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [voice, setVoice] = useState(conn.settings?.brandVoice ?? 'friendly');
  const [signOff, setSignOff] = useState(conn.settings?.signOff ?? '');
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const sel = picked ?? (locs.data ?? []).filter((l) => l.selected).map((l) => l.name);

  const act = async (k: string, fn: () => Promise<unknown>, done?: string) => { setBusy(k); try { await fn(); if (done) toast('ok', done); } catch (e: any) { toast('danger', e.message); } finally { setBusy(null); } };
  const reconnect = () => act('connect', async () => { const { url } = await api<{ url: string }>('/connect', { method: 'POST', json: {} }); window.location.assign(url); });

  return (
    <div className="space-y-5 g-fade">
      <PageHeader title="Settings" />
      <Card title="Google connection">
        <div className="flex flex-wrap items-center gap-3">
          {conn.connected ? <Badge tone="ok">Connected</Badge> : conn.needsReconnect ? <Badge tone="danger">Reconnect required</Badge> : <Badge>Not connected</Badge>}
          <span className="text-[13.5px]">{conn.email ?? ''}</span>{conn.connectedAt && <span className="g-faint text-[12.5px]">since {fmtDateTime(conn.connectedAt)}</span>}
          <span className="flex-1" />
          <Button onClick={reconnect} loading={busy === 'connect'}>{conn.connected ? 'Reconnect' : 'Connect'}</Button>
          {conn.connected && <Button variant="ghost" icon={<Link2Off size={15} />} onClick={() => setConfirmOff(true)}>Disconnect</Button>}
        </div>
        {conn.lastSync?.errors?.length ? <div className="mt-3"><Alert tone="warn" title="Last sync had errors">{conn.lastSync.errors.map((e) => <p key={e}>{e}</p>)}</Alert></div> : null}
      </Card>

      <Card title="Locations" description="Choose which Business Profiles to manage here." actions={<Button size="sm" icon={<RefreshCw size={14} />} loading={busy === 'discover'} onClick={() => act('discover', async () => { await api('/locations/discover', { method: 'POST', json: {} }); await locs.reload(); }, 'Locations refreshed from Google.')}>Refresh from Google</Button>}>
        {locs.loading ? <Skeleton h={120} /> : locs.error ? <Alert tone="danger" title={locs.error} /> : (
          <>
            <ul className="space-y-1.5">{(locs.data ?? []).map((l) => (
              <li key={l.name}><label className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px]" style={{ background: 'var(--g-raised)' }}>
                <input type="checkbox" checked={sel.includes(l.name)} onChange={(e) => setPicked(e.target.checked ? [...sel, l.name] : sel.filter((x) => x !== l.name))} />
                <MapPin size={15} style={{ color: 'var(--g-accent)' }} aria-hidden /><span className="flex-1 font-medium">{l.title}</span><span className="g-faint text-[12px]">{l.address?.city}</span>
              </label></li>
            ))}</ul>
            <div className="mt-3"><Button variant="primary" disabled={!picked} loading={busy === 'save'} onClick={() => act('save', async () => { await api('/locations/selection', { method: 'PUT', json: { locationNames: sel } }); setPicked(null); await reload(); }, 'Locations saved.')}>Save locations</Button></div>
          </>
        )}
      </Card>

      <Card title="Reply voice" description="Used as the default tone for AI review replies.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Default tone">{(id) => <select id={id} className="g-select" value={voice} onChange={(e) => setVoice(e.target.value)}><option value="friendly">Friendly</option><option value="professional">Professional</option><option value="casual">Casual</option><option value="luxury">Premium</option></select>}</Field>
          <Field label="Sign-off (optional)" hint="e.g. “— The Acme team”">{(id) => <input id={id} className="g-input" maxLength={80} value={signOff} onChange={(e) => setSignOff(e.target.value)} />}</Field>
        </div>
        <div className="mt-3"><Button variant="primary" loading={busy === 'voice'} onClick={() => act('voice', () => api('/settings', { method: 'PUT', json: { brandVoice: voice, signOff } }), 'Saved.')}>Save</Button></div>
      </Card>

      <Card title="Integrations" description="What’s switched on for this workspace.">
        <ul className="mb-4 space-y-1.5 text-[13.5px]">
          <li className="flex items-center gap-2">{conn.configured ? <Badge tone="ok">On</Badge> : <Badge tone="danger">Off</Badge>} Google Business Profile APIs</li>
          <li className="flex items-center gap-2">{dash!.aiConfigured ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>} AI (Gemini)</li>
          <li className="flex items-center gap-2">{dash!.placesConfigured ? <Badge tone="ok">On</Badge> : <Badge>Off</Badge>} Google Places (competitor details)</li>
          <li className="flex items-center gap-2"><Badge>Off</Badge> Rank tracking provider (geo-grid heatmaps)</li>
        </ul>
        <SetupList />
      </Card>

      <Dialog open={confirmOff} onClose={() => setConfirmOff(false)} title="Disconnect Google?" description="We’ll revoke this app’s access at Google and delete the synced profile data, reviews and drafts stored here. Your Google Business Profile itself isn’t changed."
        footer={<><Button onClick={() => setConfirmOff(false)}>Cancel</Button><Button variant="danger" loading={busy === 'off'} onClick={() => act('off', async () => { await api('/connection', { method: 'DELETE' }); setConfirmOff(false); await reload(); }, 'Disconnected and access revoked.')}>Disconnect</Button></>}>
        <p className="g-muted text-[13.5px]">You can reconnect at any time.</p>
      </Dialog>
    </div>
  );
}
