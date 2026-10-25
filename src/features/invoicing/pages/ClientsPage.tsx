import React, { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Eye, FilePlus2, MoreHorizontal, Pencil, Search, UserPlus, Users } from 'lucide-react';
import { formatMoney, sumMinor } from '../domain/money';
import { formatDate, isReceivable, type InvoiceView } from '../domain/status';
import type { Client } from '../domain/types';
import { addressLines } from '../services/invoiceDocument';
import { useBillingData } from '../state/BillingStore';
import { useNav, useQuickActions } from '../state/navigation';
import { Initials } from '../layout/AppShell';
import { DataTable, type Column } from '../ui/data';
import { ConfirmDialog, Dialog, Menu, useToast } from '../ui/overlays';
import { Badge, Button, EmptyState, StatusBadge } from '../ui/primitives';

interface ClientRow { client: Client; invoices: InvoiceView[]; outstanding: bigint; overdue: bigint; billed: bigint }

export function ClientsPage({ focusClientId }: { focusClientId?: string }) {
  const { data, views, archiveClient, isPending, status } = useBillingData();
  const { navigate } = useNav();
  const { openClientDialog } = useQuickActions();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [viewing, setViewing] = useState<string | null>(focusClientId ?? null);
  const [archiveTarget, setArchiveTarget] = useState<Client | null>(null);
  const currency = data.settings.defaultCurrency;

  React.useEffect(() => { if (focusClientId) setViewing(focusClientId); }, [focusClientId]);

  const rows: ClientRow[] = useMemo(() => data.clients.map((client) => {
    const invoices = views.filter((v) => v.invoice.clientId === client.id);
    const open = invoices.filter((v) => isReceivable(v.status) && v.invoice.currency === currency);
    return {
      client, invoices,
      outstanding: sumMinor(open.map((v) => v.totals.balanceDue)),
      overdue: sumMinor(open.filter((v) => v.status === 'overdue').map((v) => v.totals.balanceDue)),
      billed: sumMinor(invoices.filter((v) => v.status !== 'draft' && v.status !== 'void' && v.invoice.currency === currency).map((v) => v.totals.total)),
    };
  }), [data.clients, views, currency]);

  const term = q.trim().toLowerCase();
  const filtered = rows.filter((r) => r.client.archived === showArchived)
    .filter((r) => !term || [r.client.name, r.client.company, r.client.email, r.client.phone].some((s) => s.toLowerCase().includes(term)));
  const archivedCount = rows.filter((r) => r.client.archived).length;

  const doArchive = async () => {
    if (!archiveTarget) return;
    const next = !archiveTarget.archived;
    try {
      await archiveClient(archiveTarget.id, next);
      toast({ tone: 'success', title: next ? 'Client archived' : 'Client restored', body: archiveTarget.company || archiveTarget.name });
      setArchiveTarget(null);
    } catch (err: any) {
      if (err?.code !== 'duplicate') toast({ tone: 'error', title: 'Client not updated', body: err?.message });
    }
  };

  const columns: Column<ClientRow>[] = [
    {
      key: 'name', header: 'Client', sortValue: (r) => r.client.company || r.client.name,
      render: (r) => (
        <span className="flex items-center gap-3">
          <Initials name={r.client.company || r.client.name} size={32} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{r.client.company || r.client.name}</span>
            <span className="inv-faint block truncate text-[12px]">{r.client.name}</span>
          </span>
        </span>
      ),
    },
    { key: 'email', header: 'Email', sortValue: (r) => r.client.email, render: (r) => <span className="inv-muted">{r.client.email}</span> },
    { key: 'phone', header: 'Phone', render: (r) => <span className="inv-muted num">{r.client.phone || '—'}</span>, hideBelow: 'lg' },
    { key: 'count', header: 'Invoices', align: 'right', sortValue: (r) => r.invoices.length, render: (r) => r.invoices.length, hideBelow: 'lg' },
    {
      key: 'outstanding', header: 'Outstanding', align: 'right', sortValue: (r) => r.outstanding,
      render: (r) => (
        <span>
          <span className="font-semibold">{formatMoney(r.outstanding, currency)}</span>
          {r.overdue > 0n && <span className="block text-[11.5px]" style={{ color: 'var(--inv-danger)' }}>{formatMoney(r.overdue, currency)} overdue</span>}
        </span>
      ),
    },
    {
      key: 'actions', header: <span className="sr-only-inv">Actions</span>, align: 'right', width: 56,
      render: (r) => (
        <Menu label={`Actions for ${r.client.name}`} items={[
          { label: 'View details', icon: <Eye size={15} />, onSelect: () => setViewing(r.client.id) },
          { label: 'Edit', icon: <Pencil size={15} />, onSelect: () => openClientDialog({ clientId: r.client.id }) },
          { label: 'Create invoice', icon: <FilePlus2 size={15} />, disabled: r.client.archived, onSelect: () => navigate({ name: 'invoice-new', clientId: r.client.id }) },
          'separator',
          r.client.archived
            ? { label: 'Restore client', icon: <ArchiveRestore size={15} />, onSelect: () => setArchiveTarget(r.client) }
            : { label: 'Archive client', icon: <Archive size={15} />, danger: true, onSelect: () => setArchiveTarget(r.client) },
        ]} trigger={(p) => <Button {...p} size="sm" variant="ghost" iconOnly icon={<MoreHorizontal size={16} />} aria-label={`Actions for ${r.client.name}`} />} />
      ),
    },
  ];

  const current = rows.find((r) => r.client.id === viewing);

  return (
    <div className="mx-auto max-w-[1400px] p-4 @3xl:p-6">
      <section className="inv-card" aria-labelledby="inv-clients-title">
        <header className="inv-card-head flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <h2 id="inv-clients-title" className="inv-h2">Clients</h2>
            <p className="inv-muted text-[12.5px]">{rows.length - archivedCount} active{archivedCount ? ` · ${archivedCount} archived` : ''}</p>
          </div>
          <Button variant="primary" size="sm" icon={<UserPlus size={15} />} onClick={() => openClientDialog()}>Add client</Button>
        </header>
        <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3 @3xl:px-5">
          <div className="relative min-w-[200px] flex-1 @3xl:max-w-[320px]">
            <Search size={15} className="inv-faint pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
            <input type="search" aria-label="Search clients" placeholder="Search name, company, email" className="inv-input inv-input-sm" style={{ paddingLeft: 32, height: 34 }} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div role="tablist" aria-label="Client list" className="inv-tabs" style={{ borderBottom: 0 }}>
            <button type="button" role="tab" className="inv-tab" aria-selected={!showArchived} onClick={() => setShowArchived(false)}><span className="inv-pill">{rows.length - archivedCount}</span>Active</button>
            <button type="button" role="tab" className="inv-tab" aria-selected={showArchived} onClick={() => setShowArchived(true)}><span className="inv-pill">{archivedCount}</span>Archived</button>
          </div>
        </div>
        <DataTable
          caption="Clients"
          rows={filtered}
          columns={columns}
          getRowId={(r) => r.client.id}
          initialSort={{ key: 'name', dir: 'asc' }}
          onRowClick={(r) => setViewing(r.client.id)}
          loading={status === 'loading'}
          resetKey={`${q}|${showArchived}`}
          renderMobileRow={(r) => (
            <div className="flex items-center gap-3">
              <Initials name={r.client.company || r.client.name} size={34} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.client.company || r.client.name}</p>
                <p className="inv-muted truncate text-[12.5px]">{r.client.email}</p>
              </div>
              <span className="num text-right text-[13px] font-semibold">{formatMoney(r.outstanding, currency)}</span>
            </div>
          )}
          empty={term ? (
            <EmptyState icon={<Search size={18} />} title="No clients match your search" action={<Button onClick={() => setQ('')}>Clear search</Button>} />
          ) : showArchived ? (
            <EmptyState icon={<Archive size={18} />} title="No archived clients" body="Archived clients are hidden from pickers but keep their invoice history." />
          ) : (
            <EmptyState icon={<Users size={18} />} title="No clients yet" body="Add a client once and reuse their billing details on every invoice." action={<Button variant="primary" onClick={() => openClientDialog()}>Add client</Button>} />
          )}
        />
      </section>

      <Dialog open={!!current} onClose={() => setViewing(null)} width={680} title={current?.client.company || current?.client.name || ''}
        description={current?.client.company ? current.client.name : undefined}
        footer={current && <>
          <Button onClick={() => { openClientDialog({ clientId: current.client.id }); }}>Edit</Button>
          <Button variant="primary" icon={<FilePlus2 size={15} />} disabled={current.client.archived} onClick={() => { setViewing(null); navigate({ name: 'invoice-new', clientId: current.client.id }); }}>Create invoice</Button>
        </>}>
        {current && (
          <div className="space-y-5">
            {current.client.archived && <Badge tone="void">Archived</Badge>}
            <div className="grid grid-cols-3 gap-3">
              {[['Outstanding', current.outstanding], ['Overdue', current.overdue], ['Billed to date', current.billed]].map(([k, val]) => (
                <div key={k as string} className="rounded-xl p-3" style={{ background: 'var(--inv-surface-2)', border: '1px solid var(--inv-border)' }}>
                  <p className="inv-muted text-[12px]">{k as string}</p>
                  <p className="num text-[16px] font-semibold" style={{ color: k === 'Overdue' && (val as bigint) > 0n ? 'var(--inv-danger)' : undefined }}>{formatMoney(val as bigint, currency)}</p>
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              <div><dt className="inv-faint text-[12px]">Email</dt><dd><a href={`mailto:${current.client.email}`} style={{ color: 'var(--inv-primary)' }}>{current.client.email}</a></dd></div>
              <div><dt className="inv-faint text-[12px]">Phone</dt><dd>{current.client.phone || '—'}</dd></div>
              <div><dt className="inv-faint text-[12px]">Billing address</dt><dd>{addressLines(current.client.address).map((l, i) => <span key={i} className="block">{l}</span>)}{addressLines(current.client.address).length === 0 && '—'}</dd></div>
              <div><dt className="inv-faint text-[12px]">Tax identification</dt><dd>{current.client.taxId ? `${current.client.taxIdLabel} ${current.client.taxId}` : '—'}</dd></div>
              {current.client.notes && <div className="sm:col-span-2"><dt className="inv-faint text-[12px]">Notes</dt><dd>{current.client.notes}</dd></div>}
            </dl>
            <div>
              <p className="inv-h3 mb-2">Invoices</p>
              {current.invoices.length === 0 ? <p className="inv-muted text-[13px]">No invoices for this client yet.</p> : (
                <ul className="divide-y rounded-xl" style={{ border: '1px solid var(--inv-border)', borderColor: 'var(--inv-border)' }}>
                  {[...current.invoices].sort((a, b) => b.invoice.issueDate.localeCompare(a.invoice.issueDate)).slice(0, 8).map((v) => (
                    <li key={v.invoice.id} style={{ borderColor: 'var(--inv-border)' }}>
                      <button type="button" className="inv-menu-item rounded-none px-3 py-2.5" onClick={() => { setViewing(null); navigate({ name: 'invoice-view', id: v.invoice.id }); }}>
                        <span className="w-24 font-semibold">{v.invoice.number}</span>
                        <span className="inv-muted num flex-1 text-[12.5px]">{formatDate(v.invoice.issueDate)}</span>
                        <span className="num font-medium">{formatMoney(v.totals.total, v.invoice.currency)}</span>
                        <StatusBadge status={v.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {current.invoices.length > 8 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => { setViewing(null); navigate({ name: 'invoices' }); }}>See all {current.invoices.length} invoices</Button>}
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog open={!!archiveTarget} onClose={() => setArchiveTarget(null)} onConfirm={doArchive}
        loading={archiveTarget ? isPending(`archive:${archiveTarget.id}`) : false}
        tone={archiveTarget?.archived ? 'primary' : 'danger'}
        title={archiveTarget?.archived ? 'Restore this client?' : 'Archive this client?'}
        confirmLabel={archiveTarget?.archived ? 'Restore client' : 'Archive client'}
        body={archiveTarget?.archived
          ? 'They’ll appear in client pickers again.'
          : 'They’ll be hidden from client pickers. Their invoices and balances stay unchanged, and you can restore them anytime.'} />
    </div>
  );
}
