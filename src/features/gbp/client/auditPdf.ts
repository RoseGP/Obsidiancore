/** Professional PDF audit report (client-side, jsPDF). */
import { jsPDF } from 'jspdf';
import { AREA_LABEL, EFFORT_LABEL, PRIORITY_LABEL, type AuditResult, type GLocation } from './api';

export function downloadAuditPdf(location: GLocation, audit: AuditResult) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(); const H = doc.internal.pageSize.getHeight(); const M = 48;
  let y = 0;
  const ensure = (h: number) => { if (y + h > H - 56) { doc.addPage(); y = 56; } };
  const text = (t: string, size: number, opts: { bold?: boolean; color?: [number, number, number]; width?: number; gap?: number } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...(opts.color ?? [16, 24, 40]));
    const lines = doc.splitTextToSize(t, opts.width ?? W - 2 * M);
    ensure(lines.length * size * 1.35);
    doc.text(lines, M, y); y += lines.length * size * 1.35 + (opts.gap ?? 4);
  };
  const band = (v: number | null): [number, number, number] => (v === null ? [133, 144, 163] : v >= 80 ? [19, 122, 75] : v >= 55 ? [163, 95, 0] : [196, 45, 45]);

  doc.setFillColor(74, 53, 204); doc.rect(0, 0, W, 96, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('Google Business Profile audit', M, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  doc.text(`${location.title}${location.address?.city ? ` · ${location.address.city}` : ''} · ${new Date(audit.generatedAt).toLocaleDateString()}`, M, 66);
  y = 132;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(40); doc.setTextColor(...band(audit.overall)); doc.text(String(audit.overall), M, y + 10);
  doc.setFontSize(12); doc.setTextColor(85, 96, 112); doc.text('/ 100  Profile Health', M + 62, y + 4);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  doc.text('This is this app’s assessment of your profile, not a Google metric or a ranking prediction.', M + 62, y + 20);
  y += 48;

  text('Scores by area', 13, { bold: true, gap: 8 });
  for (const [k, v] of Object.entries(audit.areas)) {
    ensure(22);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(16, 24, 40); doc.text(AREA_LABEL[k as keyof typeof AREA_LABEL], M, y);
    doc.setFillColor(238, 240, 247); doc.roundedRect(M + 170, y - 8, 240, 8, 4, 4, 'F');
    if (v !== null) { doc.setFillColor(...band(v)); doc.roundedRect(M + 170, y - 8, (240 * v) / 100, 8, 4, 4, 'F'); }
    doc.setFont('helvetica', 'bold'); doc.text(v === null ? 'n/a' : String(v), M + 420, y);
    y += 20;
  }
  y += 8;
  const s = audit.stats;
  text(`Reviews synced: ${s.reviewCount} · Average rating: ${s.averageRating ?? 'n/a'} · Replied: ${s.responseRate === null ? 'n/a' : `${Math.round(s.responseRate * 100)}%`} · Photos: ${s.photos ?? 'n/a'} · Services: ${s.servicesCount}`, 10, { color: [85, 96, 112], gap: 14 });

  text(`Recommendations (${audit.issues.length})`, 13, { bold: true, gap: 8 });
  audit.issues.forEach((c, i) => {
    ensure(90);
    text(`${i + 1}. ${c.issue.title}`, 11.5, { bold: true, gap: 2 });
    text(`${PRIORITY_LABEL[c.issue.priority]} priority · ${EFFORT_LABEL[c.issue.effort]} (about ${c.issue.effortMinutes} min) · ${AREA_LABEL[c.area]}`, 9.5, { color: [91, 69, 224], gap: 4 });
    text(c.issue.description, 10, { gap: 2 });
    text(`Why it matters: ${c.issue.whyItMatters}`, 10, { color: [85, 96, 112], gap: 2 });
    text(`What to do: ${c.issue.solution}`, 10, { gap: 2 });
    text(c.issue.expectedBenefit, 9.5, { color: [133, 144, 163], gap: 12 });
  });

  ensure(40); text('All checks', 13, { bold: true, gap: 8 });
  for (const c of audit.checks) {
    ensure(16);
    const mark = c.status === 'passed' ? 'Pass' : c.status === 'failed' ? 'Fix' : 'Not checked';
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...(c.status === 'passed' ? [19, 122, 75] : c.status === 'failed' ? [196, 45, 45] : [133, 144, 163]) as [number, number, number]);
    doc.text(mark, M, y); doc.setTextColor(16, 24, 40); doc.text(`${c.label}${c.note ? ` (${c.note})` : ''}`, M + 70, y); y += 14;
  }
  y += 10;
  for (const n of audit.notes) text(n, 9, { color: [133, 144, 163], gap: 2 });
  text('Expected benefits are estimates, not guarantees. No ranking outcome is promised. This report isn’t produced or endorsed by Google.', 9, { color: [133, 144, 163] });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8.5); doc.setTextColor(133, 144, 163); doc.text(`Page ${i} of ${pages}`, W - M, H - 24, { align: 'right' }); }
  doc.save(`profile-audit-${location.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${audit.generatedAt.slice(0, 10)}.pdf`);
}
