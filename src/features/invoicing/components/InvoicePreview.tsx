import React, { useLayoutEffect, useRef, useState } from 'react';
import type { InvoiceDocument } from '../services/invoiceDocument';
import { COLS } from '../services/invoiceDocument';

/** Column positions in mm, identical to the PDF renderer. */
const col = (c: { x: number; w: number }): React.CSSProperties => ({ position: 'absolute', left: `${c.x}mm`, width: `${c.w}mm` });

/**
 * The invoice paper. Drawn at true A4 size in mm and scaled to fit, so the
 * line breaks match the PDF generated from the same InvoiceDocument.
 */
export function InvoicePaper({ doc }: { doc: InvoiceDocument }) {
  return (
    <article className="inv-paper" aria-label={`Invoice ${doc.number} preview`}>
      {/* Header */}
      <div className="flex items-start justify-between" style={{ height: '20mm' }}>
        <div className="flex items-center" style={{ gap: '3mm' }}>
          {doc.issuer.logo ? (
            <img src={doc.issuer.logo} alt="" style={{ height: '12mm', maxWidth: '36mm', objectFit: 'contain' }} />
          ) : (
            <div className="flex items-center justify-center t-lead" style={{ width: '12mm', height: '12mm', borderRadius: '2.5mm', background: '#2f5bea', color: '#fff', fontWeight: 700 }}>
              {doc.issuer.name.trim().charAt(0).toUpperCase() || 'B'}
            </div>
          )}
          <span className="t-lead" style={{ fontWeight: 700, maxWidth: '80mm' }}>{doc.issuer.name}</span>
        </div>
        <div className="text-right">
          <div className="t-title">Invoice</div>
          <div className="t-sm c-muted" style={{ marginTop: '0.5mm' }}>{doc.number}</div>
        </div>
      </div>
      <div className="rule" />

      {/* Parties and dates */}
      <div className="flex" style={{ marginTop: '6mm', minHeight: '27mm' }}>
        <div style={{ width: '56mm' }}>
          <div className="t-xs c-muted">Billed to</div>
          <div className={`t-base ${doc.billTo.empty ? 'placeholder' : ''}`} style={{ fontWeight: 700, marginTop: '1.6mm' }}>{doc.billTo.name}</div>
          <div className="t-sm c-muted" style={{ marginTop: '0.6mm' }}>
            {doc.billTo.lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
        <div style={{ width: '56mm', marginLeft: '6mm' }}>
          <div className="t-xs c-muted">From</div>
          <div className="t-base" style={{ fontWeight: 700, marginTop: '1.6mm' }}>{doc.issuer.name}</div>
          <div className="t-sm c-muted" style={{ marginTop: '0.6mm' }}>
            {doc.issuer.lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
        <div className="flex-1 text-right">
          {[['Invoice no.', doc.number], ['Issued', doc.issueDate], ['Due', doc.dueDate]].map(([k, v]) => (
            <div key={k} style={{ height: '9mm' }}>
              <div className="t-xs c-muted">{k}</div>
              <div className="t-sm" style={{ fontWeight: 700, marginTop: '0.4mm' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Amount due banner */}
      <div className="soft flex items-center justify-between" style={{ marginTop: '7mm', height: '17mm', borderRadius: '2.5mm', padding: '0 5mm' }}>
        <div>
          <div className="t-sm c-muted">{doc.balanceLabel}</div>
          <div className="t-sm" style={{ fontWeight: 700, marginTop: '1mm' }}>Due {doc.dueDate}</div>
        </div>
        <div className="t-amount c-accent">{doc.balanceValue}</div>
      </div>
      {doc.scheduleNote && <div className="t-sm c-muted" style={{ marginTop: '4mm' }}>{doc.scheduleNote}</div>}

      {/* Items */}
      <div style={{ marginTop: doc.scheduleNote ? '4mm' : '8mm' }}>
        <div className="t-xs c-muted relative" style={{ height: '5mm' }}>
          <span style={col(COLS.item)}>Item</span>
          <span style={{ ...col(COLS.qty), textAlign: 'right' }}>Qty</span>
          <span style={{ ...col(COLS.price), textAlign: 'right' }}>Unit price</span>
          <span style={{ ...col(COLS.tax), textAlign: 'right' }}>Tax</span>
          <span style={{ ...col(COLS.amount), textAlign: 'right' }}>Amount</span>
        </div>
        <div style={{ borderTop: '0.35mm solid #16181d', marginBottom: '3mm' }} />
        {doc.items.length === 0 && <div className="t-sm placeholder" style={{ padding: '2mm 0 4mm' }}>Add items to see them here.</div>}
        {doc.items.map((it) => (
          <div key={it.key} className="relative" style={{ paddingBottom: '2.1mm', marginBottom: '1.5mm', borderBottom: '0.25mm solid #e5e7eb' }}>
            <div style={{ width: `${COLS.item.w - 4}mm` }}>
              <div className={`t-base ${it.name === 'Untitled item' ? 'placeholder' : ''}`} style={{ fontWeight: 700 }}>{it.name}</div>
              {it.description && <div className="t-sm c-muted" style={{ marginTop: '0.4mm', whiteSpace: 'pre-wrap' }}>{it.description}</div>}
            </div>
            <span className="t-base" style={{ ...col(COLS.qty), top: 0, textAlign: 'right' }}>{it.qty}</span>
            <span className="t-base" style={{ ...col(COLS.price), top: 0, textAlign: 'right' }}>{it.unitPrice}</span>
            <span className="t-base c-muted" style={{ ...col(COLS.tax), top: 0, textAlign: 'right' }}>{it.tax}</span>
            <span className="t-base" style={{ ...col(COLS.amount), top: 0, textAlign: 'right', fontWeight: 700 }}>{it.amount}</span>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div style={{ marginLeft: '98mm', marginTop: '1.5mm' }}>
        {doc.summary.map((r, i) => (
          <React.Fragment key={i}>
            {r.strong && <div className="rule" style={{ marginBottom: '2.5mm' }} />}
            <div className={`flex justify-between ${r.strong ? 't-base' : 't-sm'}`} style={{ height: r.strong ? '6mm' : '5.2mm', fontWeight: r.strong ? 700 : 400 }}>
              <span className={r.strong ? '' : 'c-muted'} style={{ maxWidth: '52mm' }}>{r.label}</span>
              <span className={r.muted ? 'c-muted' : ''}>{r.value}</span>
            </div>
          </React.Fragment>
        ))}
        <div className="soft t-base c-accent flex justify-between" style={{ height: '9mm', alignItems: 'center', borderRadius: '1.8mm', padding: '0 2mm 0 3mm', marginLeft: '-3mm', fontWeight: 700 }}>
          <span>{doc.balanceLabel}</span><span>{doc.balanceValue}</span>
        </div>
      </div>

      {doc.installments.length > 0 && (
        <div style={{ marginTop: '8mm' }}>
          <div className="t-sm" style={{ fontWeight: 700, marginBottom: '1.6mm' }}>Payment schedule</div>
          {doc.installments.map((ins, i) => (
            <div key={i} className="t-sm relative flex" style={{ height: '5.2mm' }}>
              <span style={{ width: '70mm' }}>{ins.label}</span>
              <span className="c-muted flex-1">{ins.share} · due {ins.due}</span>
              <span style={{ fontWeight: 700 }}>{ins.amount}</span>
            </div>
          ))}
        </div>
      )}

      {/* Footer sections */}
      <div className="flex justify-between" style={{ marginTop: '8mm', gap: '6mm' }}>
        <div style={{ width: doc.signature ? '108mm' : '100%' }}>
          {[['Payment instructions', doc.paymentInstructions], ['Notes', doc.notes]].filter(([, b]) => b).map(([t, b]) => (
            <div key={t} style={{ marginBottom: '5mm' }}>
              <div className="t-xs c-muted">{t}</div>
              <div className="t-sm" style={{ marginTop: '1mm', whiteSpace: 'pre-wrap' }}>{b}</div>
            </div>
          ))}
        </div>
        {doc.signature && (
          <div style={{ width: '56mm', flex: 'none' }}>
            <div style={{ height: '16mm', display: 'flex', alignItems: 'flex-end', paddingBottom: '1mm' }}>
              {doc.signature.image
                ? <img src={doc.signature.image} alt="" style={{ height: '12mm', maxWidth: '50mm', objectFit: 'contain' }} />
                : <span className="sig">{doc.signature.name}</span>}
            </div>
            <div style={{ borderTop: '0.25mm solid #16181d', paddingTop: '1.6mm' }}>
              <div className="t-sm" style={{ fontWeight: 700 }}>{doc.signature.name}</div>
              <div className="t-xs c-muted">{doc.signature.title}</div>
            </div>
          </div>
        )}
      </div>

      <div className="t-xs c-muted absolute flex justify-between" style={{ left: '16mm', right: '16mm', bottom: '9mm' }}>
        <span>{doc.issuer.name} · Invoice {doc.number}</span>
        <span>Page 1</span>
      </div>
    </article>
  );
}

/** Scales the A4 paper to the available width (or a chosen zoom). */
export function ScaledPaper({ doc, zoom = 'fit' }: { doc: InvoiceDocument; zoom?: 'fit' | number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [h, setH] = useState(0);

  useLayoutEffect(() => {
    const el = wrap.current;
    const p = paper.current;
    if (!el || !p) return;
    const update = () => {
      const natural = p.offsetWidth;
      if (!natural || !el.clientWidth) return; // hidden (e.g. inactive mobile pane)
      const s = zoom === 'fit' ? Math.min(1.25, (el.clientWidth - 2) / natural) : zoom;
      setScale(s);
      setH(p.offsetHeight * s);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(p);
    return () => ro.disconnect();
  }, [zoom]);

  return (
    <div ref={wrap} className="w-full" style={{ overflowX: zoom === 'fit' ? 'hidden' : 'auto' }}>
      <div style={{ height: h, width: zoom === 'fit' ? '100%' : paper.current ? paper.current.offsetWidth * scale : undefined, position: 'relative' }}>
        <div ref={paper} style={{ transform: `scale(${scale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: zoom === 'fit' && wrap.current && paper.current ? Math.max(0, (wrap.current.clientWidth - paper.current.offsetWidth * scale) / 2) : 0, width: 'max-content' }}>
          <InvoicePaper doc={doc} />
        </div>
      </div>
    </div>
  );
}
