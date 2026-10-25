/**
 * PDF generation. Mirrors InvoicePreview.tsx using the same millimetre
 * layout (PAGE, COLS, TYPE) and the same InvoiceDocument model.
 * Built-in Helvetica is used in both the preview paper and the PDF so line
 * breaks land in the same places.
 */
import { jsPDF } from 'jspdf';
import type { InvoiceDocument } from './invoiceDocument';
import { COLS, PAGE } from './invoiceDocument';
import { formatMoney, toMinor } from '../domain/money';
import { formatDate } from '../domain/status';
import { PAYMENT_METHOD_LABELS, type Invoice, type Payment } from '../domain/types';
import { saveFile, type SaveOutcome } from './fileSave';

/** Font size (pt) and line height (mm) per text style, shared with the preview. */
export const TYPE = {
  xs: { pt: 7.5, lh: 3.4 },
  sm: { pt: 8.5, lh: 3.9 },
  base: { pt: 9.5, lh: 4.4 },
  lead: { pt: 11, lh: 5 },
  title: { pt: 22, lh: 9 },
  amount: { pt: 18, lh: 7.5 },
} as const;

const CONTENT_W = PAGE.widthMm - PAGE.marginMm * 2;
const BOTTOM = PAGE.heightMm - PAGE.marginMm - 6; // keep room for the footer

/** Built-in PDF fonts only cover WinAnsi; map common symbols and replace the rest. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u00A0\u202F\u2007]/g, ' ')
    .replace(/₦/g, 'NGN ')
    .replace(/₹/g, 'INR ')
    .replace(/−/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '?');
}

type Doc = jsPDF;

function style(doc: Doc, t: keyof typeof TYPE, weight: 'normal' | 'bold' = 'normal', color: string = PAGE.ink) {
  doc.setFont('helvetica', weight);
  doc.setFontSize(TYPE[t].pt);
  doc.setTextColor(color);
}

function wrap(doc: Doc, text: string, width: number): string[] {
  return doc.splitTextToSize(pdfSafe(text), width) as string[];
}

/** Writes wrapped lines at (x, y) and returns the new y. */
function block(doc: Doc, lines: string[], x: number, y: number, t: keyof typeof TYPE, align: 'left' | 'right' = 'left') {
  lines.forEach((ln, i) => doc.text(ln, x, y + i * TYPE[t].lh, { baseline: 'top', align }));
  return y + lines.length * TYPE[t].lh;
}

function drawFooter(doc: Doc, d: InvoiceDocument) {
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    style(doc, 'xs', 'normal', PAGE.muted);
    const y = PAGE.heightMm - PAGE.marginMm + 1;
    doc.text(pdfSafe(`${d.issuer.name} · Invoice ${d.number}`), PAGE.marginMm, y, { baseline: 'top' });
    doc.text(`Page ${p} of ${pages}`, PAGE.widthMm - PAGE.marginMm, y, { baseline: 'top', align: 'right' });
  }
}

export function renderInvoicePdf(d: InvoiceDocument): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setLineHeightFactor(1.15);
  const L = PAGE.marginMm;
  const R = PAGE.widthMm - PAGE.marginMm;
  let y: number = PAGE.marginMm;

  const ensure = (needed: number) => {
    if (y + needed > BOTTOM) {
      doc.addPage();
      y = PAGE.marginMm;
      return true;
    }
    return false;
  };

  // ---- Header: logo + business name | "Invoice" + number
  let nameX = L;
  if (d.issuer.logo) {
    try {
      const props = doc.getImageProperties(d.issuer.logo);
      const h = 12;
      const w = Math.min(36, (props.width / props.height) * h);
      doc.addImage(d.issuer.logo, props.fileType, L, y, w, h);
      nameX = L + w + 3;
    } catch { /* unreadable logo: fall back to the monogram */ }
  }
  if (nameX === L) {
    doc.setFillColor(PAGE.accent);
    doc.roundedRect(L, y, 12, 12, 2.5, 2.5, 'F');
    style(doc, 'lead', 'bold', '#FFFFFF');
    doc.text(pdfSafe(d.issuer.name.trim().charAt(0).toUpperCase() || 'B'), L + 6, y + 3.4, { baseline: 'top', align: 'center' });
    nameX = L + 15;
  }
  style(doc, 'lead', 'bold');
  doc.text(pdfSafe(d.issuer.name), nameX, y + 3.6, { baseline: 'top', maxWidth: 80 });

  style(doc, 'title', 'normal');
  doc.text('Invoice', R, y - 0.5, { baseline: 'top', align: 'right' });
  style(doc, 'sm', 'normal', PAGE.muted);
  doc.text(pdfSafe(d.number), R, y + TYPE.title.lh + 0.5, { baseline: 'top', align: 'right' });
  y += 20;

  doc.setDrawColor(PAGE.rule);
  doc.setLineWidth(0.25);
  doc.line(L, y, R, y);
  y += 6;

  // ---- Parties + dates
  const colW = 56;
  const top = y;
  style(doc, 'xs', 'normal', PAGE.muted);
  doc.text('Billed to', L, top, { baseline: 'top' });
  doc.text('From', L + 62, top, { baseline: 'top' });
  style(doc, 'base', 'bold', d.billTo.empty ? PAGE.muted : PAGE.ink);
  let yb = block(doc, wrap(doc, d.billTo.name, colW), L, top + 5, 'base');
  style(doc, 'sm', 'normal', PAGE.muted);
  yb = block(doc, d.billTo.lines.flatMap((l) => wrap(doc, l, colW)), L, yb + 0.6, 'sm');

  style(doc, 'base', 'bold');
  let yf = block(doc, wrap(doc, d.issuer.name, colW), L + 62, top + 5, 'base');
  style(doc, 'sm', 'normal', PAGE.muted);
  yf = block(doc, d.issuer.lines.flatMap((l) => wrap(doc, l, colW)), L + 62, yf + 0.6, 'sm');

  const meta: [string, string][] = [['Invoice no.', d.number], ['Issued', d.issueDate], ['Due', d.dueDate]];
  meta.forEach(([k, v], i) => {
    const my = top + i * 9;
    style(doc, 'xs', 'normal', PAGE.muted);
    doc.text(k, R, my, { baseline: 'top', align: 'right' });
    style(doc, 'sm', 'bold');
    doc.text(pdfSafe(v), R, my + 3.8, { baseline: 'top', align: 'right' });
  });
  y = Math.max(yb, yf, top + 27) + 7;

  // ---- Amount due banner
  doc.setFillColor(PAGE.soft);
  doc.roundedRect(L, y, CONTENT_W, 17, 2.5, 2.5, 'F');
  style(doc, 'sm', 'normal', PAGE.muted);
  doc.text(pdfSafe(d.balanceLabel), L + 5, y + 4.2, { baseline: 'top' });
  style(doc, 'sm', 'bold');
  doc.text(pdfSafe(`Due ${d.dueDate}`), L + 5, y + 9, { baseline: 'top' });
  style(doc, 'amount', 'bold', PAGE.accent);
  doc.text(pdfSafe(d.balanceValue), R - 5, y + 4.6, { baseline: 'top', align: 'right' });
  y += 17 + 4;

  if (d.scheduleNote) {
    style(doc, 'sm', 'normal', PAGE.muted);
    y = block(doc, wrap(doc, d.scheduleNote, CONTENT_W), L, y, 'sm') + 2;
  }
  y += 4;

  // ---- Items table
  const header = () => {
    style(doc, 'xs', 'normal', PAGE.muted);
    doc.text('Item', L + COLS.item.x, y, { baseline: 'top' });
    doc.text('Qty', L + COLS.qty.x + COLS.qty.w, y, { baseline: 'top', align: 'right' });
    doc.text('Unit price', L + COLS.price.x + COLS.price.w, y, { baseline: 'top', align: 'right' });
    doc.text('Tax', L + COLS.tax.x + COLS.tax.w, y, { baseline: 'top', align: 'right' });
    doc.text('Amount', L + COLS.amount.x + COLS.amount.w, y, { baseline: 'top', align: 'right' });
    y += 5;
    doc.setDrawColor(PAGE.ink);
    doc.setLineWidth(0.35);
    doc.line(L, y, R, y);
    y += 3;
  };
  header();

  for (const it of d.items) {
    style(doc, 'base', 'bold');
    const nameLines = wrap(doc, it.name, COLS.item.w - 4);
    style(doc, 'sm', 'normal');
    const descLines = it.description ? wrap(doc, it.description, COLS.item.w - 4) : [];
    const h = nameLines.length * TYPE.base.lh + descLines.length * TYPE.sm.lh + 4;
    if (ensure(h)) header();

    style(doc, 'base', 'bold');
    const yy = block(doc, nameLines, L, y, 'base');
    style(doc, 'sm', 'normal', PAGE.muted);
    block(doc, descLines, L, yy + 0.4, 'sm');
    style(doc, 'base', 'normal');
    doc.text(pdfSafe(it.qty), L + COLS.qty.x + COLS.qty.w, y, { baseline: 'top', align: 'right' });
    doc.text(pdfSafe(it.unitPrice), L + COLS.price.x + COLS.price.w, y, { baseline: 'top', align: 'right' });
    style(doc, 'base', 'normal', PAGE.muted);
    doc.text(pdfSafe(it.tax), L + COLS.tax.x + COLS.tax.w, y, { baseline: 'top', align: 'right' });
    style(doc, 'base', 'bold');
    doc.text(pdfSafe(it.amount), R, y, { baseline: 'top', align: 'right' });
    y += h;
    doc.setDrawColor(PAGE.rule);
    doc.setLineWidth(0.25);
    doc.line(L, y - 1.5, R, y - 1.5);
  }
  y += 3;

  // ---- Summary (right column)
  const sx = L + 98;
  ensure(d.summary.length * 6 + 14);
  for (const row of d.summary) {
    if (row.strong) {
      doc.setDrawColor(PAGE.rule);
      doc.line(sx, y, R, y);
      y += 2.5;
    }
    style(doc, row.strong ? 'base' : 'sm', row.strong ? 'bold' : 'normal', row.muted ? PAGE.muted : row.strong ? PAGE.ink : PAGE.muted);
    doc.text(pdfSafe(row.label), sx, y, { baseline: 'top', maxWidth: 52 });
    style(doc, row.strong ? 'base' : 'sm', row.strong ? 'bold' : 'normal', row.muted ? PAGE.muted : PAGE.ink);
    doc.text(pdfSafe(row.value), R, y, { baseline: 'top', align: 'right' });
    y += row.strong ? 6 : 5.2;
  }
  doc.setFillColor(PAGE.soft);
  doc.roundedRect(sx - 3, y, R - sx + 3, 9, 1.8, 1.8, 'F');
  style(doc, 'base', 'bold', PAGE.accent);
  doc.text(pdfSafe(d.balanceLabel), sx, y + 2.4, { baseline: 'top' });
  doc.text(pdfSafe(d.balanceValue), R - 2, y + 2.4, { baseline: 'top', align: 'right' });
  y += 9 + 8;

  // ---- Installments
  if (d.installments.length) {
    ensure(10 + d.installments.length * 5.5);
    style(doc, 'sm', 'bold');
    doc.text('Payment schedule', L, y, { baseline: 'top' });
    y += 5.5;
    for (const ins of d.installments) {
      style(doc, 'sm', 'normal');
      doc.text(pdfSafe(ins.label), L, y, { baseline: 'top' });
      style(doc, 'sm', 'normal', PAGE.muted);
      doc.text(pdfSafe(`${ins.share} · due ${ins.due}`), L + 70, y, { baseline: 'top' });
      style(doc, 'sm', 'bold');
      doc.text(pdfSafe(ins.amount), R, y, { baseline: 'top', align: 'right' });
      y += 5.2;
    }
    y += 5;
  }

  // ---- Payment instructions, notes, signature
  const leftW = d.signature ? 108 : CONTENT_W;
  const sections: [string, string][] = [];
  if (d.paymentInstructions) sections.push(['Payment instructions', d.paymentInstructions]);
  if (d.notes) sections.push(['Notes', d.notes]);
  const startY = y;
  for (const [title, body] of sections) {
    style(doc, 'sm', 'normal');
    const lines = body.split('\n').flatMap((p) => wrap(doc, p, leftW));
    ensure(6 + lines.length * TYPE.sm.lh);
    style(doc, 'xs', 'normal', PAGE.muted);
    doc.text(title, L, y, { baseline: 'top' });
    style(doc, 'sm', 'normal');
    y = block(doc, lines, L, y + 4.4, 'sm') + 5;
  }
  if (d.signature) {
    let sy = sections.length ? startY : y;
    if (sy + 26 > BOTTOM) { doc.addPage(); sy = PAGE.marginMm; }
    const sx2 = R - 56;
    if (d.signature.image) {
      try {
        const props = doc.getImageProperties(d.signature.image);
        const h = 12;
        const w = Math.min(50, (props.width / props.height) * h);
        doc.addImage(d.signature.image, props.fileType, sx2, sy + 2, w, h);
      } catch { /* ignore */ }
    } else {
      doc.setFont('times', 'italic');
      doc.setFontSize(18);
      doc.setTextColor(PAGE.ink);
      doc.text(pdfSafe(d.signature.name), sx2, sy + 5, { baseline: 'top' });
    }
    doc.setDrawColor(PAGE.ink);
    doc.setLineWidth(0.25);
    doc.line(sx2, sy + 16, R, sy + 16);
    style(doc, 'sm', 'bold');
    doc.text(pdfSafe(d.signature.name), sx2, sy + 18, { baseline: 'top' });
    style(doc, 'xs', 'normal', PAGE.muted);
    doc.text(pdfSafe(d.signature.title), sx2, sy + 22.2, { baseline: 'top' });
    y = Math.max(y, sy + 28);
  }

  drawFooter(doc, d);
  return doc;
}

export function invoicePdfFilename(d: Pick<InvoiceDocument, 'number' | 'billTo'>) {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9-_]+/g, '_').replace(/^_|_$/g, '');
  return `${safe(d.number) || 'invoice'}${d.billTo.empty ? '' : '_' + safe(d.billTo.name)}.pdf`;
}

export function downloadInvoicePdf(d: InvoiceDocument): Promise<SaveOutcome> {
  return saveFile(invoicePdfFilename(d), renderInvoicePdf(d).output('blob'));
}

export function invoicePdfBase64(d: InvoiceDocument): string {
  const uri = renderInvoicePdf(d).output('datauristring');
  return uri.slice(uri.indexOf(',') + 1);
}

/** Payment receipt PDF. */
export function downloadReceiptPdf(payment: Payment, invoice: Invoice, balanceAfterMinor: bigint): Promise<SaveOutcome> {
  const doc = new jsPDF({ unit: 'mm', format: 'a5', compress: true });
  const L = 14;
  const R = 148 - 14;
  let y = 16;
  style(doc, 'lead', 'bold');
  doc.text(pdfSafe(invoice.issuer.name), L, y, { baseline: 'top' });
  style(doc, 'title', 'normal');
  doc.setFontSize(18);
  doc.text('Receipt', R, y - 1, { baseline: 'top', align: 'right' });
  y += 9;
  style(doc, 'sm', 'normal', PAGE.muted);
  doc.text(pdfSafe(payment.receiptNumber), R, y, { baseline: 'top', align: 'right' });
  y += 10;
  doc.setDrawColor(PAGE.rule);
  doc.line(L, y, R, y);
  y += 7;

  style(doc, 'xs', 'normal', PAGE.muted);
  doc.text('Amount received', L, y, { baseline: 'top' });
  y += 4.5;
  style(doc, 'amount', 'bold', PAGE.accent);
  doc.text(pdfSafe(formatMoney(toMinor(payment.amount, invoice.currency) ?? 0n, invoice.currency)), L, y, { baseline: 'top' });
  y += 13;

  const rows: [string, string][] = [
    ['Received from', invoice.billTo.company || invoice.billTo.name],
    ['Payment date', formatDate(payment.date)],
    ['Method', PAYMENT_METHOD_LABELS[payment.method]],
    ['Reference', payment.reference || '—'],
    ['For invoice', invoice.number],
    ['Remaining balance', formatMoney(balanceAfterMinor, invoice.currency)],
    ['Recorded by', payment.recordedBy],
  ];
  for (const [k, v] of rows) {
    style(doc, 'sm', 'normal', PAGE.muted);
    doc.text(k, L, y, { baseline: 'top' });
    style(doc, 'sm', 'bold');
    doc.text(pdfSafe(v), R, y, { baseline: 'top', align: 'right' });
    y += 6.5;
  }
  y += 4;
  style(doc, 'xs', 'normal', PAGE.muted);
  doc.text(pdfSafe(`Thank you. This receipt confirms a ${payment.status} payment recorded on ${formatDate(payment.createdAt.slice(0, 10))}.`), L, y, { baseline: 'top', maxWidth: R - L });
  return saveFile(`${payment.receiptNumber}.pdf`, doc.output('blob'));
}
