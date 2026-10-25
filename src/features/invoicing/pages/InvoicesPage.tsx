import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Download, FileSpreadsheet, X } from 'lucide-react';
import { minorToDecimalString } from '../domain/money';
import { STATUS_LABELS, type InvoiceView } from '../domain/status';
import type { InvoiceStatus } from '../domain/types';
import { buildInvoiceDocument } from '../services/invoiceDocument';
import { downloadInvoicePdf } from '../services/pdf';
import { useBillingData } from '../state/BillingStore';
import { InvoiceFiltersBar, InvoiceTable, applyFilters, emptyFilters } from '../components/InvoiceTable';
import { canVoid } from '../components/invoiceActions';
import { saveFile } from '../services/fileSave';
import { ConfirmDialog, useToast } from '../ui/overlays';
import { Button } from '../ui/primitives';

const TABS: ('all' | InvoiceStatus)[] = ['all', 'draft', 'sent', 'viewed', 'partially_paid', 'overdue', 'paid', 'void'];

function exportCsv(rows: InvoiceView[]) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = ['Invoice', 'Client', 'Email', 'Issue date', 'Due date', 'Currency', 'Total', 'Paid', 'Balance', 'Status'];
  const lines = rows.map((v) => [
    v.invoice.number, v.invoice.billTo.company || v.invoice.billTo.name, v.invoice.billTo.email, v.invoice.issueDate, v.invoice.dueDate,
    v.invoice.currency, minorToDecimalString(v.totals.total, v.invoice.currency), minorToDecimalString(v.totals.amountPaid, v.invoice.currency),
    minorToDecimalString(v.totals.balanceDue, v.invoice.currency), STATUS_LABELS[v.status],
  ].map((c) => esc(String(c))).join(','));
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  return saveFile(`invoices-${new Date().toISOString().slice(0, 10)}.csv`, blob);
}

export function InvoicesPage({ initialStatus }: { initialStatus?: string }) {
  const { views, today, voidInvoice } = useBillingData();
  const toast = useToast();
  const [filters, setFilters] = useState(() => ({ ...emptyFilters(), status: (initialStatus as any) ?? 'all' }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [voidOpen, setVoidOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (initialStatus) setFilters((f) => ({ ...f, status: initialStatus as any })); }, [initialStatus]);

  const withoutStatus = useMemo(() => applyFilters(views, filters, today, true), [views, filters, today]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: withoutStatus.length };
    for (const v of withoutStatus) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [withoutStatus]);
  const rows = filters.status === 'all' ? withoutStatus : withoutStatus.filter((v) => v.status === filters.status);

  // Drop selections that are no longer visible after filtering.
  useEffect(() => {
    const visible = new Set(rows.map((r) => r.invoice.id));
    setSelected((s) => { const n = new Set([...s].filter((id) => visible.has(id))); return n.size === s.size ? s : n; });
  }, [rows]);

  const selectedViews = rows.filter((v) => selected.has(v.invoice.id));
  const voidable = selectedViews.filter(canVoid);

  const bulkPdf = async () => {
    setBusy(true);
    let saved = 0;
    try {
      for (const v of selectedViews) {
        if ((await downloadInvoicePdf(buildInvoiceDocument(v.invoice, v.totals))) === 'saved') saved++;
        await new Promise((r) => setTimeout(r, 250)); // browsers throttle rapid downloads
      }
    } catch {
      toast({ tone: 'error', title: 'Some PDFs couldn’t be saved', body: 'Try again with fewer invoices selected.' });
    }
    setBusy(false);
    if (saved) toast({ tone: 'success', title: `${saved} PDF${saved === 1 ? '' : 's'} downloaded` });
  };

  const bulkVoid = async () => {
    setBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const v of voidable) {
      try { await voidInvoice(v.invoice.id); ok++; } catch { failed.push(v.invoice.number); }
    }
    setBusy(false);
    setVoidOpen(false);
    setSelected(new Set());
    toast(failed.length
      ? { tone: 'warning', title: `${ok} voided, ${failed.length} not voided`, body: failed.join(', ') }
      : { tone: 'success', title: `${ok} invoice${ok === 1 ? '' : 's'} voided` });
  };

  return (
    <div className="mx-auto max-w-[1400px] p-4 @3xl:p-6">
      <section className="inv-card" aria-labelledby="inv-list-title">
        <header className="inv-card-head flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <h2 id="inv-list-title" className="inv-h2">All invoices</h2>
          <Button size="sm" variant="ghost" icon={<FileSpreadsheet size={15} />} onClick={() => exportCsv(rows)} disabled={rows.length === 0}>Export CSV</Button>
        </header>
        <div className="space-y-3 px-4 pt-4 @3xl:px-5">
          <InvoiceFiltersBar value={filters} onChange={setFilters} showStatus={false} showAmount />
          <div role="tablist" aria-label="Filter by status" className="inv-tabs">
            {TABS.map((t) => (
              <button key={t} role="tab" type="button" className="inv-tab" aria-selected={filters.status === t} onClick={() => setFilters({ ...filters, status: t })}>
                <span className="inv-pill num">{counts[t] ?? 0}</span>
                {t === 'all' ? 'All' : STATUS_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {selected.size > 0 && (
          <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 @3xl:mx-5" style={{ background: 'var(--inv-primary-tint)' }} role="region" aria-label="Bulk actions">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--inv-primary-ink)' }}>{selected.size} selected</span>
            <div className="flex-1" />
            <Button size="sm" icon={<Download size={14} />} onClick={bulkPdf} loading={busy && !voidOpen}>Download PDFs</Button>
            <Button size="sm" icon={<FileSpreadsheet size={14} />} onClick={() => exportCsv(selectedViews)}>Export</Button>
            <Button size="sm" variant="danger-soft" icon={<Ban size={14} />} disabled={voidable.length === 0} onClick={() => setVoidOpen(true)}
              title={voidable.length === 0 ? 'None of the selected invoices can be voided' : undefined}>Void{voidable.length !== selected.size && voidable.length > 0 ? ` ${voidable.length}` : ''}</Button>
            <Button size="sm" variant="ghost" iconOnly icon={<X size={14} />} aria-label="Clear selection" onClick={() => setSelected(new Set())} />
          </div>
        )}

        <div className="mt-2">
          <InvoiceTable rows={rows} pageSize={10} selectable selectedIds={selected} onSelectionChange={setSelected}
            filters={filters} onClearFilters={() => setFilters(emptyFilters())} />
        </div>
      </section>

      <ConfirmDialog open={voidOpen} onClose={() => setVoidOpen(false)} onConfirm={bulkVoid} loading={busy} tone="danger"
        title={`Void ${voidable.length} invoice${voidable.length === 1 ? '' : 's'}?`} confirmLabel="Void invoices"
        body={<>
          {voidable.length < selected.size && <p className="mb-2">{selected.size - voidable.length} selected invoice{selected.size - voidable.length === 1 ? ' has' : 's have'} confirmed payments or {selected.size - voidable.length === 1 ? 'is' : 'are'} already void and will be skipped.</p>}
          <p>Voided invoices stay on record but no longer count toward balances. This can’t be undone.</p>
        </>} />
    </div>
  );
}
