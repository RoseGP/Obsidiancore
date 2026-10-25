import React, { useMemo, useState } from 'react';
import { FileText, MoreHorizontal, Search, SlidersHorizontal, X } from 'lucide-react';
import { formatMoney, toMinor } from '../domain/money';
import { addDays, formatDate, PAYMENT_STATE_LABELS, STATUS_LABELS, type InvoiceView } from '../domain/status';
import type { InvoiceStatus, PaymentState } from '../domain/types';
import { useBillingData } from '../state/BillingStore';
import { useNav } from '../state/navigation';
import { DataTable, type Column } from '../ui/data';
import { Menu } from '../ui/overlays';
import { Button, DateField, EmptyState, Input, Select, StatusBadge, cx } from '../ui/primitives';
import { useInvoiceActions } from './invoiceActions';

export interface InvoiceFilterState {
  q: string;
  status: 'all' | InvoiceStatus;
  clientId: string;
  datePreset: 'any' | '30d' | '90d' | 'ytd' | 'custom';
  from: string;
  to: string;
  payment: 'all' | PaymentState;
  minAmount: string;
  maxAmount: string;
}

export const emptyFilters = (): InvoiceFilterState => ({
  q: '', status: 'all', clientId: 'all', datePreset: 'any', from: '', to: '', payment: 'all', minAmount: '', maxAmount: '',
});

export function applyFilters(views: InvoiceView[], f: InvoiceFilterState, today: string, ignoreStatus = false) {
  const term = f.q.trim().toLowerCase();
  let from = '';
  let to = '';
  if (f.datePreset === '30d') from = addDays(today, -30);
  if (f.datePreset === '90d') from = addDays(today, -90);
  if (f.datePreset === 'ytd') from = `${today.slice(0, 4)}-01-01`;
  if (f.datePreset === 'custom') { from = f.from; to = f.to; }
  const min = f.minAmount.trim() ? toMinor(f.minAmount, 'USD') : null;
  const max = f.maxAmount.trim() ? toMinor(f.maxAmount, 'USD') : null;
  return views.filter((v) => {
    const i = v.invoice;
    if (term && ![i.number, i.billTo.name, i.billTo.company, i.billTo.email].some((s) => s.toLowerCase().includes(term))) return false;
    if (!ignoreStatus && f.status !== 'all' && v.status !== f.status) return false;
    if (f.clientId !== 'all' && i.clientId !== f.clientId) return false;
    if (from && i.issueDate < from) return false;
    if (to && i.issueDate > to) return false;
    if (f.payment !== 'all' && (v.paymentState !== f.payment || v.status === 'draft' || v.status === 'void')) return false;
    if (min !== null && v.totals.total < min) return false;
    if (max !== null && v.totals.total > max) return false;
    return true;
  });
}

const filterKey = (f: InvoiceFilterState) => JSON.stringify(f);

function activeFilterCount(f: InvoiceFilterState, showStatus: boolean) {
  return [showStatus && f.status !== 'all', f.clientId !== 'all', f.datePreset !== 'any', f.payment !== 'all', f.minAmount || f.maxAmount].filter(Boolean).length;
}

export function InvoiceFiltersBar({ value, onChange, showStatus = true, showAmount = false, searchLabel = 'Search invoices' }: {
  value: InvoiceFilterState; onChange: (f: InvoiceFilterState) => void; showStatus?: boolean; showAmount?: boolean; searchLabel?: string;
}) {
  const { data } = useBillingData();
  const [open, setOpen] = useState(false);
  const set = <K extends keyof InvoiceFilterState>(k: K, v: InvoiceFilterState[K]) => onChange({ ...value, [k]: v });
  const count = activeFilterCount(value, showStatus);
  const clients = [...data.clients].sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 @3xl:max-w-[320px]">
          <Search size={15} className="inv-faint pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input type="search" aria-label={searchLabel} placeholder="Search by number or client" className="inv-input inv-input-sm" style={{ paddingLeft: 32, height: 34 }} value={value.q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <Button size="sm" variant={open || count ? 'secondary' : 'ghost'} icon={<SlidersHorizontal size={14} />} aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ height: 34 }}>
          Filters{count > 0 && <span className="inv-pill" style={{ background: 'var(--inv-primary-tint)', color: 'var(--inv-primary-ink)' }}>{count}</span>}
        </Button>
        {count > 0 && (
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => onChange({ ...emptyFilters(), q: value.q, status: showStatus ? 'all' : value.status })}>Clear</Button>
        )}
      </div>
      {open && (
        <div className="grid grid-cols-1 gap-3 rounded-xl p-3 @xl:grid-cols-2 @4xl:grid-cols-4" style={{ background: 'var(--inv-surface-2)', border: '1px solid var(--inv-border)' }}>
          {showStatus && (
            <Select inputSize="sm" label="Invoice status" value={value.status} onChange={(v) => set('status', v as any)}
              options={[{ value: 'all', label: 'All statuses' }, ...Object.entries(STATUS_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
          )}
          <Select inputSize="sm" label="Client" value={value.clientId} onChange={(v) => set('clientId', v)}
            options={[{ value: 'all', label: 'All clients' }, ...clients.map((c) => ({ value: c.id, label: (c.company || c.name) + (c.archived ? ' (archived)' : '') }))]} />
          <Select inputSize="sm" label="Payment status" value={value.payment} onChange={(v) => set('payment', v as any)}
            options={[{ value: 'all', label: 'Any' }, ...Object.entries(PAYMENT_STATE_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
          <Select inputSize="sm" label="Issue date" value={value.datePreset} onChange={(v) => set('datePreset', v as any)}
            options={[{ value: 'any', label: 'Any time' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' }, { value: 'ytd', label: 'This year' }, { value: 'custom', label: 'Custom range' }]} />
          {value.datePreset === 'custom' && (
            <>
              <DateField inputSize="sm" label="From" value={value.from} onChange={(v) => set('from', v)} max={value.to || undefined} />
              <DateField inputSize="sm" label="To" value={value.to} onChange={(v) => set('to', v)} min={value.from || undefined} error={value.from && value.to && value.to < value.from ? 'End date is before start date.' : undefined} />
            </>
          )}
          {showAmount && (
            <>
              <Input inputSize="sm" label="Min amount" inputMode="decimal" prefix="$" value={value.minAmount} onChange={(e) => set('minAmount', e.target.value)} error={value.minAmount && toMinor(value.minAmount, 'USD') === null ? 'Enter a number.' : undefined} />
              <Input inputSize="sm" label="Max amount" inputMode="decimal" prefix="$" value={value.maxAmount} onChange={(e) => set('maxAmount', e.target.value)} error={value.maxAmount && toMinor(value.maxAmount, 'USD') === null ? 'Enter a number.' : undefined} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function InvoiceTable({ rows, pageSize = 10, selectable, selectedIds, onSelectionChange, filters, onClearFilters, compact }: {
  rows: InvoiceView[]; pageSize?: number; selectable?: boolean; selectedIds?: Set<string>;
  onSelectionChange?: (s: Set<string>) => void; filters: InvoiceFilterState; onClearFilters: () => void; compact?: boolean;
}) {
  const { navigate } = useNav();
  const { status } = useBillingData();
  const { menuFor, dialogs } = useInvoiceActions();
  const clientLabel = (v: InvoiceView) => v.invoice.billTo.company || v.invoice.billTo.name || 'No client';

  const columns: Column<InvoiceView>[] = useMemo(() => [
    { key: 'number', header: 'Invoice', sortValue: (v) => v.invoice.number, render: (v) => <span className="font-semibold">{v.invoice.number}</span> },
    {
      key: 'client', header: 'Client', sortValue: clientLabel,
      render: (v) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{clientLabel(v)}</p>
          {!compact && v.invoice.billTo.company && <p className="inv-faint truncate text-[12px]">{v.invoice.billTo.name}</p>}
        </div>
      ),
    },
    { key: 'issue', header: 'Issued', sortValue: (v) => v.invoice.issueDate, render: (v) => <span className="inv-muted num">{formatDate(v.invoice.issueDate)}</span>, hideBelow: 'lg' },
    {
      key: 'due', header: 'Due', sortValue: (v) => v.invoice.dueDate,
      render: (v) => (
        <span className="num" style={{ color: v.status === 'overdue' ? 'var(--inv-danger)' : 'var(--inv-muted)' }}>
          {formatDate(v.invoice.dueDate)}
          {v.status === 'overdue' && <span className="block text-[11.5px]">{v.daysOverdue}d overdue</span>}
        </span>
      ),
    },
    {
      key: 'amount', header: 'Amount', align: 'right', sortValue: (v) => v.totals.total,
      render: (v) => (
        <span>
          <span className="font-semibold">{formatMoney(v.totals.total, v.invoice.currency)}</span>
          {v.status === 'partially_paid' || (v.status === 'overdue' && v.totals.amountPaid > 0n)
            ? <span className="inv-faint block text-[11.5px]">{formatMoney(v.totals.balanceDue, v.invoice.currency)} left</span> : null}
        </span>
      ),
    },
    { key: 'status', header: 'Status', sortValue: (v) => STATUS_LABELS[v.status], render: (v) => <StatusBadge status={v.status} /> },
    {
      key: 'actions', header: <span className="sr-only-inv">Actions</span>, align: 'right', width: 56,
      render: (v) => (
        <Menu
          label={`Actions for ${v.invoice.number}`}
          items={menuFor(v)}
          trigger={(p) => <Button {...p} size="sm" variant="ghost" iconOnly icon={<MoreHorizontal size={16} />} aria-label={`Actions for ${v.invoice.number}`} />}
        />
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [compact, menuFor]);

  const anyFilter = filterKey(filters) !== filterKey(emptyFilters());

  return (
    <>
      <DataTable
        caption="Invoices"
        rows={rows}
        columns={columns}
        getRowId={(v) => v.invoice.id}
        pageSize={pageSize}
        initialSort={{ key: 'issue', dir: 'desc' }}
        onRowClick={(v) => navigate({ name: 'invoice-view', id: v.invoice.id })}
        selectable={selectable}
        selectedIds={selectedIds}
        onSelectionChange={onSelectionChange}
        loading={status === 'loading'}
        resetKey={filterKey(filters)}
        renderMobileRow={(v) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{v.invoice.number} <span className="inv-muted font-normal">· {clientLabel(v)}</span></p>
              <p className={cx('num text-[12.5px]', v.status === 'overdue' ? '' : 'inv-muted')} style={{ color: v.status === 'overdue' ? 'var(--inv-danger)' : undefined }}>
                Due {formatDate(v.invoice.dueDate)}{v.status === 'overdue' ? ` · ${v.daysOverdue}d overdue` : ''}
              </p>
            </div>
            <div className="flex flex-none flex-col items-end gap-1">
              <span className="num font-semibold">{formatMoney(v.totals.total, v.invoice.currency)}</span>
              <StatusBadge status={v.status} />
            </div>
          </div>
        )}
        empty={anyFilter ? (
          <EmptyState icon={<Search size={18} />} title="No invoices match these filters" body="Try a different search or clear the filters." action={<Button onClick={onClearFilters}>Clear filters</Button>} />
        ) : (
          <EmptyState icon={<FileText size={18} />} title="No invoices yet" body="Create your first invoice to start tracking what you’re owed." action={<Button variant="primary" onClick={() => navigate({ name: 'invoice-new' })}>Create invoice</Button>} />
        )}
      />
      {dialogs}
    </>
  );
}
