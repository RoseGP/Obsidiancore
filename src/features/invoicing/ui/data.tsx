import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { Button, Skeleton, cx } from './primitives';

// ---------- DataTable ----------

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  /** Return a comparable value to make the column sortable. */
  sortValue?: (row: T) => string | number | bigint;
  align?: 'left' | 'right';
  width?: number | string;
  /** Hide on narrower desktop widths. */
  hideBelow?: 'lg' | 'xl';
}

export interface SortState { key: string; dir: 'asc' | 'desc' }

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  getRowId: (row: T) => string;
  caption: string;
  pageSize?: number;
  initialSort?: SortState;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  isRowSelectable?: (row: T) => boolean;
  /** Card layout for small screens. */
  renderMobileRow?: (row: T) => React.ReactNode;
  loading?: boolean;
  empty?: React.ReactNode;
  /** Reset to page 1 when this changes (e.g. filter signature). */
  resetKey?: string;
}

function compare(a: string | number | bigint, b: string | number | bigint) {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return a < b ? -1 : a > b ? 1 : 0;
}

export function DataTable<T>({
  rows, columns, getRowId, caption, pageSize = 10, initialSort, onRowClick, selectable, selectedIds,
  onSelectionChange, isRowSelectable = () => true, renderMobileRow, loading, empty, resetKey,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | undefined>(initialSort);
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [resetKey, pageSize]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const out = [...rows].sort((a, b) => compare(col.sortValue!(a), col.sortValue!(b)));
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visible = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  const start = sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, sorted.length);

  const selectableVisible = visible.filter(isRowSelectable);
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((r) => selectedIds?.has(getRowId(r)));
  const someVisibleSelected = selectableVisible.some((r) => selectedIds?.has(getRowId(r)));

  const toggleAll = () => {
    const next = new Set(selectedIds);
    if (allVisibleSelected) selectableVisible.forEach((r) => next.delete(getRowId(r)));
    else selectableVisible.forEach((r) => next.add(getRowId(r)));
    onSelectionChange?.(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange?.(next);
  };

  const toggleSort = (key: string) => {
    setSort((s) => (!s || s.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : undefined));
  };

  const hideCls = (c: Column<T>) => (c.hideBelow === 'lg' ? 'hidden @5xl:table-cell' : c.hideBelow === 'xl' ? 'hidden @6xl:table-cell' : '');

  if (loading) {
    return (
      <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} style={{ height: 40 }} />)}
      </div>
    );
  }

  if (rows.length === 0) return <>{empty}</>;

  return (
    <div>
      {/* Desktop / tablet table */}
      <div className={cx('overflow-x-auto', renderMobileRow && 'hidden @3xl:block')}>
        <table className="inv-table">
          <caption className="sr-only-inv">{caption}</caption>
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    className="inv-check"
                    aria-label="Select all rows on this page"
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className={hideCls(c)}
                    style={{ width: c.width, textAlign: c.align ?? 'left' }}
                    aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {c.sortValue ? (
                      <button type="button" className="inv-sort" onClick={() => toggleSort(c.key)}>
                        {c.header}
                        {active ? (sort!.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ChevronsUpDown size={12} className="inv-faint" />}
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const id = getRowId(row);
              const selected = selectedIds?.has(id);
              return (
                <tr
                  key={id}
                  className={cx(onRowClick && 'is-clickable', selected && 'is-selected')}
                  onClick={onRowClick ? (e) => {
                    if ((e.target as HTMLElement).closest('button, a, input, select, [data-stop]')) return;
                    onRowClick(row);
                  } : undefined}
                >
                  {selectable && (
                    <td data-stop>
                      <input
                        type="checkbox"
                        className="inv-check"
                        aria-label={`Select row ${id}`}
                        disabled={!isRowSelectable(row)}
                        checked={!!selected}
                        onChange={() => toggleOne(id)}
                      />
                    </td>
                  )}
                  {columns.map((c, ci) => (
                    <td key={c.key} className={cx(hideCls(c), c.align === 'right' && 'num')} style={{ textAlign: c.align ?? 'left' }}>
                      {ci === 0 && onRowClick ? (
                        <button type="button" onClick={() => onRowClick(row)} className="text-left" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                          {c.render(row)}
                        </button>
                      ) : c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      {renderMobileRow && (
        <ul className="@3xl:hidden divide-y" style={{ borderColor: 'var(--inv-border)' }}>
          {visible.map((row) => (
            <li key={getRowId(row)} style={{ borderColor: 'var(--inv-border)' }}>
              {onRowClick ? (
                <button type="button" className="block w-full px-4 py-3 text-left" style={{ background: 'none', border: 0, font: 'inherit', color: 'inherit' }} onClick={() => onRowClick(row)}>
                  {renderMobileRow(row)}
                </button>
              ) : <div className="px-4 py-3">{renderMobileRow(row)}</div>}
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[12.5px]" style={{ borderColor: 'var(--inv-border)' }}>
        <span className="inv-muted num">{start}–{end} of {sorted.length}</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" iconOnly icon={<ChevronLeft size={15} />} aria-label="Previous page" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} />
          <span className="num px-2" aria-live="polite">Page {safePage} of {pageCount}</span>
          <Button size="sm" variant="ghost" iconOnly icon={<ChevronRight size={15} />} aria-label="Next page" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)} />
        </div>
      </nav>
    </div>
  );
}

// ---------- Summary card ----------

export interface Delta {
  /** Percent change, null when there's no previous value to compare. */
  pct: number | null;
  /** Whether an increase is good news (paid) or bad news (overdue). */
  goodWhen: 'up' | 'down';
}

export function SummaryCard({ label, value, delta, caption, icon, loading, onClick }: {
  label: string; value: string; delta?: Delta; caption: string; icon: React.ReactNode; loading?: boolean; onClick?: () => void;
}) {
  const dir = !delta || delta.pct === null || Math.abs(delta.pct) < 0.05 ? 'flat' : delta.pct > 0 ? 'up' : 'down';
  const good = dir === 'flat' ? null : dir === delta!.goodWhen;
  const Icon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;
  const color = good === null ? 'var(--inv-muted)' : good ? 'var(--inv-success)' : 'var(--inv-danger)';
  const bg = good === null ? 'var(--inv-surface-3)' : good ? 'var(--inv-success-tint)' : 'var(--inv-danger-tint)';
  const Wrapper: any = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className="inv-card flex flex-col p-4 text-left"
      style={{ font: 'inherit', color: 'inherit', cursor: onClick ? 'pointer' : undefined }}
    >
      <div className="flex items-center justify-between">
        <span className="inv-muted text-[13px] font-medium">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--inv-surface-2)', color: 'var(--inv-muted)', border: '1px solid var(--inv-border)' }} aria-hidden>{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-3" style={{ height: 30, width: '70%' }} />
      ) : (
        <p className="num mt-2 text-[26px] font-semibold leading-9 tracking-tight">{value}</p>
      )}
      <div className="mt-2 flex items-center gap-2 text-[12px]">
        {delta && (
          <span className="num inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold" style={{ color, background: bg }}>
            <Icon size={12} aria-hidden />
            {delta.pct === null ? 'New' : `${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(1)}%`}
            <span className="sr-only-inv">{good === null ? '' : good ? '(favorable)' : '(unfavorable)'}</span>
          </span>
        )}
        <span className="inv-faint">{caption}</span>
      </div>
    </Wrapper>
  );
}
