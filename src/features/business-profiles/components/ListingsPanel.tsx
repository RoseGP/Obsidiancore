/**
 * Linked listings and publishing. Status always reflects the real integration state; publishing
 * is a two-step flow: preview (fresh data from Google, field-by-field diff) → explicit confirmation.
 */
import React, { useEffect, useState } from 'react';
import { ExternalLink, Link2, RefreshCw, Send, Unlink } from 'lucide-react';
import type { PublishableField } from '../domain/types';
import { bpApi, type LinkableListing, type ProfileView, type ProviderStatus, type PublishPreview } from '../client/api';
import { Badge, Button, Card, Field, Modal, Notice, ProvenanceBadge, inputCls, timeAgo, useToast } from './ui';

export function ListingsPanel({ p, onUpdated, onOpenGbp }: { p: ProfileView; onUpdated: (v: ProfileView) => void; onOpenGbp: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [linkable, setLinkable] = useState<LinkableListing[]>([]);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [selected, setSelected] = useState<PublishableField[]>([]);
  const [ack, setAck] = useState(false);
  const link = p.listings.find((l) => l.provider === 'google_business_profile');

  useEffect(() => {
    let live = true;
    bpApi.integrations().then((s) => { if (!live) return; const g = s.find((x) => x.provider === 'google_business_profile') ?? null; setStatus(g); if (g?.connected) bpApi.linkable().then((l) => live && setLinkable(l)).catch(() => undefined); })
      .catch((e) => live && setStatusErr(e.message));
    return () => { live = false; };
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e: any) { toast(e.message, 'danger'); } finally { setBusy(null); } };
  const doLink = () => run('link', async () => { onUpdated(await bpApi.link(p.id, p.version, choice)); toast('Listing linked. Consistency checks now use Google’s data.'); });
  const doUnlink = () => run('unlink', async () => { onUpdated(await bpApi.unlink(p.id, p.version)); toast('Listing unlinked. Nothing was changed on Google.', 'info'); });
  const doRefresh = () => run('refresh', async () => { onUpdated(await bpApi.refresh(p.id)); toast('Read the latest data from Google.', 'info'); });
  const doPreview = () => run('preview', async () => { const pv = await bpApi.preview(p.id); setPreview(pv); setSelected(pv.changes.map((c) => c.field)); setAck(false); });
  const doPublish = () => run('publish', async () => {
    if (!preview) return;
    // A narrower selection needs a confirmation token for exactly those fields.
    const token = selected.length === preview.changes.length ? preview.confirmToken : (await bpApi.preview(p.id, selected)).confirmToken;
    if (!token) throw new Error('Nothing to publish.');
    const v = await bpApi.publish(p.id, token);
    onUpdated(v); setPreview(null);
    toast('Sent to Google. Google may review changes before they appear publicly.');
  });

  const usable = linkable.filter((l) => l.selected);
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[220px]">
            <h3 className="text-[15px] font-semibold text-[var(--text)]">Google Business Profile</h3>
            <p className="text-[13px] text-[var(--text-muted)] mt-0.5">Uses Google’s official Business Profile APIs through your own Google connection (Local GBP tab). No scraping.</p>
          </div>
          {status ? (
            <Badge tone={!status.configured ? 'neutral' : status.needsReconnect ? 'danger' : status.connected ? 'success' : 'warning'}>
              {!status.configured ? 'Not configured' : status.needsReconnect ? 'Reconnect needed' : status.connected ? 'Connected' : 'Not connected'}
            </Badge>
          ) : statusErr ? <Badge tone="danger">Status unavailable</Badge> : <Badge>Checking…</Badge>}
        </div>
        {status && <p className="text-[13px] text-[var(--text-muted)] mt-3">{status.detail}</p>}
        {statusErr && <Notice tone="danger">{statusErr}</Notice>}
        {status?.configured && !status.connected && <Button className="mt-3" icon={<ExternalLink className="h-4 w-4" />} onClick={onOpenGbp}>Open Local GBP to connect</Button>}
      </Card>

      {link ? (
        <Card className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Link2 className="h-4 w-4 text-[var(--accent-text)]" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--text)]">{link.title}</div>
              <div className="text-[12px] text-[var(--text-subtle)]">Linked {timeAgo(link.linkedAt)} by {link.linkedBy} · Google data read {timeAgo(link.snapshotAt)}</div>
            </div>
            {link.snapshot?.mapsUri && /^https:\/\//.test(link.snapshot.mapsUri) && <a className="text-[13px] text-[var(--accent-text)] hover:underline inline-flex items-center gap-1" href={link.snapshot.mapsUri} target="_blank" rel="noopener noreferrer">View on Maps <ExternalLink className="h-3 w-3" /></a>}
            {p.permissions.edit && <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy === 'refresh'} onClick={doRefresh}>Refresh from Google</Button>}
            {p.permissions.publish && <Button size="sm" variant="ghost" icon={<Unlink className="h-3.5 w-3.5" />} loading={busy === 'unlink'} onClick={doUnlink}>Unlink</Button>}
          </div>
          {link.snapshot && (
            <div className="rounded-[var(--radius-control)] border border-[var(--border)] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--surface-sunken)] text-[12px] text-[var(--text-muted)]"><ProvenanceBadge source="verified" /> As read from Google {timeAgo(link.snapshotAt)}</div>
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 p-3 text-[13px]">
                {([['Name', link.snapshot.name], ['Primary category', link.snapshot.primaryCategory], ['Phone', link.snapshot.phone], ['Website', link.snapshot.website], ['Address', [...(link.snapshot.addressLines ?? []), link.snapshot.city, link.snapshot.postalCode].filter(Boolean).join(', ')], ['Hours', link.snapshot.hours?.length ? `${new Set(link.snapshot.hours.map((h) => h.day)).size} days set` : undefined]] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-[var(--text-subtle)]">{k}</dt><dd className="text-[var(--text)] break-words">{v || <span className="text-[var(--text-subtle)]">Not set on Google</span>}</dd></div>
                ))}
              </dl>
            </div>
          )}
          {p.permissions.publish ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" icon={<Send className="h-4 w-4" />} loading={busy === 'preview'} onClick={doPreview} disabled={status ? !status.connected : true}>Review changes to publish…</Button>
              <span className="text-[12px] text-[var(--text-subtle)]">Phone, website and description can be published. Name, address, categories and hours are edited in Google Business Profile.</span>
            </div>
          ) : <Notice tone="info">Publishing to Google needs the manager or owner role on this profile.</Notice>}
        </Card>
      ) : (
        <Card className="p-5 space-y-3">
          <h3 className="text-[15px] font-semibold text-[var(--text)]">Link a listing</h3>
          {!status?.connected ? <p className="text-[13px] text-[var(--text-muted)]">Connect Google Business Profile first; until then, consistency checks show as “not checked”.</p>
            : !p.permissions.publish ? <Notice tone="info">Linking a listing needs the manager or owner role.</Notice>
              : usable.length === 0 ? <p className="text-[13px] text-[var(--text-muted)]">No selected locations. Choose the locations you manage in the Local GBP tab.</p>
                : (
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Google location" htmlFor="bp-link" className="flex-1 min-w-[240px]">
                      <select id="bp-link" className={inputCls()} value={choice} onChange={(e) => setChoice(e.target.value)}>
                        <option value="">Choose a location…</option>
                        {usable.map((l) => <option key={l.externalId} value={l.externalId}>{l.title}{l.address ? ` — ${l.address}` : ''}</option>)}
                      </select>
                    </Field>
                    <Button variant="primary" disabled={!choice} loading={busy === 'link'} onClick={doLink}>Link listing</Button>
                  </div>
                )}
        </Card>
      )}

      {p.publishLog.length > 0 && (
        <Card className="p-5">
          <h3 className="text-[15px] font-semibold text-[var(--text)] mb-2">Publish log</h3>
          <ul className="divide-y divide-[var(--border)] text-[13px]">
            {p.publishLog.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap gap-x-3 gap-y-1 items-center">
                <Badge tone={r.outcome === 'success' ? 'success' : 'danger'}>{r.outcome === 'success' ? 'Sent' : 'Failed'}</Badge>
                <span className="text-[var(--text-muted)] w-28">{timeAgo(r.at)}</span>
                <span className="flex-1 min-w-[200px] text-[var(--text)]">{r.message}</span>
                <span className="text-[var(--text-subtle)]">by {r.by}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={!!preview} wide title="Review changes before publishing to Google" onClose={() => setPreview(null)}
        footer={preview && <>
          <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
          <Button variant="primary" icon={<Send className="h-4 w-4" />} disabled={!ack || !selected.length || !preview.confirmToken} loading={busy === 'publish'} onClick={doPublish}>Publish {selected.length} change{selected.length === 1 ? '' : 's'}</Button>
        </>}>
        {preview && (
          <div className="space-y-4">
            <p className="text-[13px] text-[var(--text-muted)]">Compared with data read from Google just now for <strong className="text-[var(--text)]">{preview.listing.title}</strong>. Only the fields you tick are sent. This confirmation expires {new Date(preview.expiresAt).toLocaleTimeString()}.</p>
            {preview.changes.length === 0 ? <Notice tone="success" title="Nothing to publish">The listing already matches the CRM for every publishable field.</Notice> : (
              <table className="w-full text-[13px] border border-[var(--border)] rounded-[var(--radius-control)] overflow-hidden">
                <thead className="bg-[var(--surface-sunken)] text-[var(--text-muted)] text-left"><tr><th className="p-2 w-8"><span className="sr-only">Include</span></th><th className="p-2">Field</th><th className="p-2">On Google now</th><th className="p-2">Will become</th></tr></thead>
                <tbody>{preview.changes.map((c) => (
                  <tr key={c.field} className="border-t border-[var(--border)] align-top">
                    <td className="p-2"><input type="checkbox" aria-label={`Publish ${c.label}`} checked={selected.includes(c.field)} onChange={(e) => setSelected(e.target.checked ? [...selected, c.field] : selected.filter((f) => f !== c.field))} /></td>
                    <td className="p-2 font-medium text-[var(--text)]">{c.label}</td>
                    <td className="p-2 text-[var(--text-muted)] whitespace-pre-wrap break-words max-w-[240px]">{c.current}</td>
                    <td className="p-2 text-[var(--text)] whitespace-pre-wrap break-words max-w-[240px]">{c.proposed}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {preview.skipped.length > 0 && <ul className="text-[12px] text-[var(--text-subtle)] space-y-0.5">{preview.skipped.map((s) => <li key={s.field}>{s.field}: {s.reason}</li>)}</ul>}
            {preview.warnings.length > 0 && <Notice tone="warning" title="Audit warnings on these fields"><ul className="list-disc pl-4">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Notice>}
            <p className="text-[12px] text-[var(--text-subtle)]">{preview.unsupported}</p>
            {preview.changes.length > 0 && (
              <label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
                <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                I’ve checked these values are accurate and want to update the public Google listing. Google may review the change before it appears.
              </label>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
