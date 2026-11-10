import type { SheetModel } from '../sheet';
import { fitInside, type PdfLogo } from '../logo';
import { assemblePdf } from './assemble';
import { escapePdfTextWinAnsi, helveticaWidth, wrapText } from './text';
import { PageStream, type Rgb } from './writer';

/**
 * The downloaded / e-mailed PDF, drawn from the SAME `SheetModel` the on-screen preview and the print view show (docs/DOCUMENTATION.md
 * docs/DOCUMENTATION.md §13.4). Sections, order, wording, numbers and design follow the sheet: header with logo, status badge and meta; customer and detail
 * boxes; labor and parts tables (the header row repeats on a new page); notes and terms beside the totals box; "How to pay" with clickable
 * links; signature lines. Text is real, selectable text with accurate Helvetica widths; long descriptions wrap.
 *
 * Every page ends with one footer line: when it was generated, the app name, and "Page n of N". Nothing here reads the clock: the caller
 * passes `generatedAt`, so the same inputs always give the same bytes.
 */

export interface SheetPdfOptions {
  logo?: PdfLogo | null;
  payLines?: Array<{ text: string; url?: string }>;
  /** Printed as "Payment received: [ ] Cash   [ ] Zelle ..." under the payment instructions. */
  paymentBoxes?: string[];
  paymentReceivedLabel?: string;
  payHeading?: string;
  /** Left side of the footer, e.g. "11/9/26, 6:10 PM". */
  generatedAt: string;
  /** Centre of the footer. */
  brand?: string;
}

export const DEFAULT_FOOTER_BRAND = 'GlassExpense - Your Transparent Expense Tracker';

// Page geometry (US Letter, points) and the sheet's palette.
const W = 612, L = 36, R = 576, CW = R - L, TOP = 756, BOTTOM = 62;
const INK: Rgb = [0.059, 0.09, 0.165], TEXT: Rgb = [0.067, 0.094, 0.153], SLATE: Rgb = [0.2, 0.255, 0.333], MUTED: Rgb = [0.392, 0.455, 0.545];
const BORDER: Rgb = [0.886, 0.91, 0.941], BOX_BG: Rgb = [0.973, 0.98, 0.988], HEAD_BG: Rgb = [0.945, 0.961, 0.976], ALT_BG: Rgb = [0.98, 0.988, 1];
const LINK: Rgb = [0.114, 0.306, 0.847], WHITE: Rgb = [1, 1, 1];
const BADGES: Record<string, { bg: Rgb; fg: Rgb }> = {
  'badge-estimate': { bg: [0.859, 0.918, 0.996], fg: [0.114, 0.306, 0.847] }, 'badge-sent': { bg: [0.859, 0.918, 0.996], fg: [0.114, 0.306, 0.847] },
  'badge-approved': { bg: [0.863, 0.988, 0.906], fg: [0.082, 0.502, 0.239] }, 'badge-paid': { bg: [0.733, 0.969, 0.816], fg: [0.086, 0.396, 0.204] },
  'badge-overdue': { bg: [0.996, 0.886, 0.886], fg: [0.725, 0.11, 0.11] }, 'badge-draft': { bg: HEAD_BG, fg: [0.278, 0.333, 0.412] },
};

export function generateSheetPdf(m: SheetModel, o: SheetPdfOptions): Uint8Array {
  const logo = o.logo ?? null;
  const pages: PageStream[] = [];
  let page = new PageStream(1, helveticaWidth, escapePdfTextWinAnsi);
  pages.push(page);
  let y = TOP;
  const newPage = () => { page = new PageStream(pages.length + 1, helveticaWidth, escapePdfTextWinAnsi); pages.push(page); y = TOP; };
  /** Starts a new page when `h` points do not fit; returns true if it did. */
  const ensure = (h: number) => { if (y - h < BOTTOM) { newPage(); return true; } return false; };

  const w = (s: string, size: number, bold = false) => helveticaWidth(s, size, bold);
  const text = (s: string, x: number, yy: number, size: number, o2: { bold?: boolean; color?: Rgb; align?: 'left' | 'right' | 'center' } = {}) =>
    page.drawText(s, x, yy, { font: o2.bold ? '/F2' : '/F1', size, color: o2.color ?? TEXT, align: o2.align ?? 'left' });
  /** Wraps to a width, breaking over-long words so nothing runs out of its box. */
  const wrap = (s: unknown, width: number, size: number, bold = false): string[] => {
    const lines = wrapText(String(s ?? ''), width, size, bold, helveticaWidth);
    return lines.flatMap(line => {
      if (w(line, size, bold) <= width) return [line];
      const out: string[] = []; let cur = '';
      for (const ch of line) { if (w(cur + ch, size, bold) > width) { out.push(cur); cur = ch; } else cur += ch; }
      return cur ? [...out, cur] : out;
    });
  };
  const clipOne = (s: string, width: number, size: number, bold = false) => { let out = s; while (out.length > 1 && w(out, size, bold) > width) out = out.slice(0, -1); return out; };

  // ── Header ──────────────────────────────────────────────────────────────────
  let ly = y;
  if (logo) { const { w: lw, h: lh } = fitInside(logo.width, logo.height, 160, 52); page.drawImage('Im1', L, ly - lh, lw, lh); ly -= lh + 6; }
  if (m.shop.name) { text(m.shop.name, L, ly - 15, 17, { bold: true, color: INK }); ly -= 22; }
  for (const line of [...wrap(m.shop.address, 300, 9), ...wrap(m.shop.contact, 300, 9)]) { text(line, L, ly - 9, 9, { color: MUTED }); ly -= 12; }
  if (m.shop.license) { const cw = w(m.shop.license, 8) + 12; page.drawRoundRect(L, ly - 16, cw, 14, 3, { fill: HEAD_BG }); text(m.shop.license, L + 6, ly - 12, 8, { color: [0.278, 0.333, 0.412] }); ly -= 20; }

  let ry = y;
  text(m.title, R, ry - 22, 24, { bold: true, color: INK, align: 'right' }); ry -= 32;
  const badge = BADGES[m.status.cssClass] ?? BADGES['badge-draft'];
  const bw = w(m.status.badgeText, 7.5, true) + 16;
  page.drawRoundRect(R - bw, ry - 15, bw, 14, 7, { fill: badge.bg }); text(m.status.badgeText, R - bw / 2, ry - 11, 7.5, { bold: true, color: badge.fg, align: 'center' }); ry -= 22;
  for (const row of m.meta) { text(row.label, R - 96, ry - 9, 8.5, { color: MUTED, align: 'right' }); text(row.value, R, ry - 9, 8.5, { bold: true, color: INK, align: 'right' }); ry -= 13; }
  y = Math.min(ly, ry) - 6;
  page.drawLine(L, y, R, y, [0.898, 0.906, 0.925], 1.5); y -= 14;

  // ── Customer and detail boxes ───────────────────────────────────────────────
  const colW = m.vehicle ? (CW - 12) / 2 : CW;
  const inner = colW - 20;
  const custLines = m.customer.details.length ? m.customer.details.flatMap(d => wrap(d, inner, 9)) : [m.customer.emptyText];
  const custH = 14 + 16 + custLines.length * 12 + 12;
  const attrCols = 2, attrW = inner / attrCols - 4;
  const attrRows: Array<Array<{ label: string; lines: string[]; mono?: boolean }>> = [];
  if (m.vehicle) {
    const items = m.vehicle.attrs.map(a => ({ label: a.label, lines: wrap(a.value, attrW, 9, true).slice(0, 2), mono: a.mono }));
    for (let i = 0; i < items.length; i += attrCols) attrRows.push(items.slice(i, i + attrCols));
  }
  const rowH = (r: typeof attrRows[number]) => 11 + Math.max(...r.map(a => a.lines.length)) * 11 + 5;
  const vehH = m.vehicle ? 14 + 8 + attrRows.reduce((n, r) => n + rowH(r), 0) + 8 : 0;
  const boxH = Math.max(custH, vehH);
  ensure(boxH + 16);
  const top = y;
  page.drawRoundRect(L, top - boxH, colW, boxH, 6, { fill: BOX_BG, stroke: BORDER, lineWidth: 0.75 });
  text(m.customer.heading.toUpperCase(), L + 10, top - 16, 7.5, { bold: true, color: MUTED });
  text(m.customer.name, L + 10, top - 32, 11, { bold: true });
  custLines.forEach((line, i) => text(line, L + 10, top - 46 - i * 12, 9, { color: MUTED }));
  if (m.vehicle) {
    const vx = L + colW + 12;
    page.drawRoundRect(vx, top - boxH, colW, boxH, 6, { fill: BOX_BG, stroke: BORDER, lineWidth: 0.75 });
    text(m.vehicle.heading.toUpperCase(), vx + 10, top - 16, 7.5, { bold: true, color: MUTED });
    let ay = top - 24;
    for (const r of attrRows) {
      r.forEach((a, c) => { const ax = vx + 10 + c * (inner / attrCols); text(a.label.toUpperCase(), ax, ay - 9, 6.5, { color: MUTED }); a.lines.forEach((l, k) => text(l, ax, ay - 20 - k * 11, 9, { bold: true })); });
      ay -= rowH(r);
    }
  }
  y = top - boxH - 16;

  // ── Tables ──────────────────────────────────────────────────────────────────
  type Col = { title: string; w: number; align: 'left' | 'right' };
  const drawTable = (heading: string, cols: Col[], rows: string[][], emptyText: string, subtotalLabel: string, subtotal: string, boldCols: number[]) => {
    const xs: number[] = []; cols.reduce((x, c) => { xs.push(x); return x + c.w; }, L);
    const cell = (c: number, s: string, yy: number, size: number, bold: boolean, color: Rgb) => {
      const col = cols[c]; if (col.align === 'right') text(s, xs[c] + col.w - 8, yy, size, { bold, color, align: 'right' }); else text(s, xs[c] + 8, yy, size, { bold, color });
    };
    const header = () => {
      page.drawRect(L, y - 18, CW, 18, { fill: HEAD_BG, stroke: BORDER, lineWidth: 0.5 });
      cols.forEach((c, i) => cell(i, c.title, y - 12.5, 8, true, SLATE)); y -= 18;
    };
    ensure(18 + 18 + 22 + 18 + 22); text(heading.toUpperCase(), L, y - 9, 9.5, { bold: true, color: INK }); y -= 15; header();
    if (rows.length === 0) { page.drawLine(L, y - 22, R, y - 22, BORDER, 0.5); text(emptyText, L + CW / 2, y - 14, 8.5, { color: [0.58, 0.64, 0.72], align: 'center' }); y -= 22; }
    rows.forEach((row, ri) => {
      const wrapped = row.map((s, c) => (c === 0 || (c === 1 && cols.length === 5 && cols[1].align === 'left') || (c === 1 && cols[0].title === m.parts.columns[0]) ? wrap(s, cols[c].w - 16, 9, boldCols.includes(c)) : [clipOne(s, cols[c].w - 16, 9, boldCols.includes(c))]));
      const h = Math.max(...wrapped.map(l => l.length)) * 11 + 9;
      if (y - h < BOTTOM + 26) { newPage(); header(); }   // keep room for at least the subtotal row after it
      if (ri % 2 === 1) page.drawRect(L, y - h, CW, h, { fill: ALT_BG });
      page.drawLine(L, y - h, R, y - h, BORDER, 0.5);
      wrapped.forEach((lines, c) => lines.forEach((l, k) => cell(c, l, y - 13 - k * 11, 9, boldCols.includes(c), c >= 2 || c === 1 && cols[1].align === 'right' ? TEXT : TEXT)));
      y -= h;
    });
    ensure(22);
    page.drawRect(L, y - 20, CW, 20, { fill: HEAD_BG, stroke: BORDER, lineWidth: 0.5 });
    text(subtotalLabel, xs[cols.length - 1] - 8, y - 14, 9, { bold: true, color: SLATE, align: 'right' }); text(subtotal, R - 8, y - 14, 9, { bold: true, color: INK, align: 'right' });
    y -= 20 + 14;
  };
  const lc = m.labor.columns, pc = m.parts.columns;
  drawTable(m.labor.heading, [{ title: lc[0], w: 226, align: 'left' }, { title: lc[1], w: 100, align: 'left' }, { title: lc[2], w: 50, align: 'right' }, { title: lc[3], w: 70, align: 'right' }, { title: lc[4], w: 94, align: 'right' }],
    m.labor.rows.map(r => [r.description, r.technician, r.hours, r.rate, r.amount]), m.labor.emptyText, m.labor.subtotalLabel, m.labor.subtotal, [0, 4]);
  drawTable(m.parts.heading, [{ title: pc[0], w: 86, align: 'left' }, { title: pc[1], w: 226, align: 'left' }, { title: pc[2], w: 44, align: 'right' }, { title: pc[3], w: 80, align: 'right' }, { title: pc[4], w: 104, align: 'right' }],
    m.parts.rows.map(r => [r.partNumber, r.description, r.quantity, r.unitPrice, r.amount]), m.parts.emptyText, m.parts.subtotalLabel, m.parts.subtotal, [1, 4]);

  // ── Notes and terms (left) beside the totals box (right) ────────────────────
  const leftW = 296, totW = CW - leftW - 16, totX = R - totW;
  const notes = [m.notes.customer, ...(m.notes.terms.hidden ? [] : [m.notes.terms])].map(n => ({ heading: n.heading, lines: wrap(n.text, leftW - 20, 8.5) }));
  const noteHs = notes.map(n => 12 + 14 + n.lines.length * 11 + 8);
  const notesH = noteHs.reduce((a, b) => a + b, 0) + (notes.length - 1) * 8;
  const totHs = m.totals.map(l => (l.grand ? 28 : 19));
  const totalsH = totHs.reduce((a, b) => a + b, 0);
  const blockH = Math.max(notesH, totalsH);
  ensure(blockH + 14);
  let ny = y;
  notes.forEach((n, i) => {
    page.drawRoundRect(L, ny - noteHs[i], leftW, noteHs[i], 6, { stroke: BORDER, lineWidth: 0.75 });
    text(n.heading.toUpperCase(), L + 10, ny - 15, 7, { bold: true, color: MUTED });
    n.lines.forEach((l, k) => text(l, L + 10, ny - 28 - k * 11, 8.5, { color: SLATE })); ny -= noteHs[i] + 8;
  });
  page.drawRoundRect(totX, y - totalsH, totW, totalsH, 6, { stroke: BORDER, lineWidth: 0.75 });
  let ty = y;
  m.totals.forEach((l, i) => {
    const h = totHs[i];
    if (l.grand) { page.drawRoundRect(totX, ty - h, totW, h, 6, { fill: INK }); text(l.label, totX + 10, ty - 18, 11, { bold: true, color: WHITE }); text(l.value, totX + totW - 10, ty - 18, 11, { bold: true, color: WHITE, align: 'right' }); }
    else { text(l.label, totX + 10, ty - 13, 9, { bold: !!l.bold, color: TEXT }); text(l.value, totX + totW - 10, ty - 13, 9, { bold: !!l.bold, color: TEXT, align: 'right' }); if (i < m.totals.length - 1 && !m.totals[i + 1].grand) page.drawLine(totX + 1, ty - h, totX + totW - 1, ty - h, [0.945, 0.961, 0.976], 0.5); }
    ty -= h;
  });
  y -= blockH + 16;

  // ── How to pay ──────────────────────────────────────────────────────────────
  const payLines = (o.payLines ?? []).flatMap(p => wrap(p.text, CW - 24, 8.5).map(t => ({ t, url: p.url })));
  const boxes = o.paymentBoxes ?? [];
  if (payLines.length || boxes.length) {
    const hh = 12 + 12 + payLines.length * 11.5 + (boxes.length ? 18 : 0) + 6;
    ensure(hh + 10);
    page.drawRoundRect(L, y - hh, CW, hh, 6, { stroke: [0.796, 0.835, 0.882], lineWidth: 0.75, dash: [3, 2] });
    let py = y - 14;
    if (payLines.length) { text((o.payHeading ?? 'HOW TO PAY').toUpperCase(), L + 12, py - 2, 7.5, { bold: true, color: [0.278, 0.333, 0.412] }); py -= 14; }
    for (const l of payLines) {
      text(l.t, L + 12, py - 6, 8.5, { color: l.url ? LINK : TEXT });
      if (l.url) page.addLink(L + 12, py - 8, Math.min(CW - 24, w(l.t, 8.5)), 11, l.url);   // clickable in any PDF viewer
      py -= 11.5;
    }
    if (boxes.length) text(`${o.paymentReceivedLabel ?? 'Payment received:'}   ${boxes.map(b => `[ ] ${b}`).join('    ')}`, L + 12, py - 8, 8.5, { color: TEXT });
    y -= hh + 14;
  }

  // ── Signature ───────────────────────────────────────────────────────────────
  const disc = m.signature.text ? wrap(m.signature.text, CW, 8) : [];
  const sigH = 12 + disc.length * 10 + (disc.length ? 22 : 8) + 30;
  ensure(sigH);
  page.drawLine(L, y, R, y, BORDER, 0.75); y -= 14;
  disc.forEach(l => { text(l, L, y - 6, 8, { color: MUTED }); y -= 10; });
  y -= disc.length ? 22 : 8;
  const dateW = 120, gap = 24;
  page.drawLine(L, y, R - dateW - gap, y, INK, 0.75); page.drawLine(R - dateW, y, R, y, INK, 0.75);
  text(m.signature.customerCaption, L, y - 10, 7.5, { color: MUTED }); text(m.signature.dateCaption, R - dateW, y - 10, 7.5, { color: MUTED });

  // ── Footer on every page: generated at, app name, page n of N ───────────────
  const brand = o.brand ?? DEFAULT_FOOTER_BRAND;
  pages.forEach((p, i) => {
    p.drawLine(L, 44, R, 44, BORDER, 0.5);
    p.drawText(o.generatedAt, L, 30, { font: '/F1', size: 7.5, color: MUTED });
    p.drawText(brand, W / 2, 30, { font: '/F1', size: 7.5, color: MUTED, align: 'center' });
    p.drawText(`Page ${i + 1} of ${pages.length}`, R, 30, { font: '/F1', size: 7.5, color: MUTED, align: 'right' });
  });

  return assemblePdf(pages, logo);
}
