import { calculateTotals } from '../totals';
import { formatPdfCurrency } from '../format';
import { fill, resolvePdfLabels, type DeepPartial, type PdfLabels } from '../labels';
import type { DocType, Totals } from '../types';
import { escapePdfText, escapePdfTextWinAnsi, getTextWidth, helveticaWidth, wrapText } from './text';
import { PageStream, type Rgb } from './writer';
import { assemblePdf } from './assemble';
import { fitInside, type PdfLogo } from '../logo';

/**
 * PDF-1.4 invoice writer: a command-for-command port of automotive-pdf `generatePdfBytes`.
 *
 * Parity contract (plan §4.2): for the same invoice, totals and labels the output is byte-identical to the original
 * (tests/invoice.parity.test.ts compares SHA-256 against goldens and a differential run against the vendored oracle).
 * What differs from upstream is only where text comes from: strings are `PdfLabels` instead of constants, upstream's
 * hard-coded brand/legal text and its fallback tax/supplies numbers are gone (plan D4), and there is a single totals engine.
 *
 * Deterministic by design: no clock, no randomness, no environment access. Do not add any.
 */

export interface PdfOptions {
  labels?: DeepPartial<PdfLabels>;
  /** Printed as a "How to pay" block on FINAL invoices (never on estimates). Absent = identical output to before. */
  payOptions?: Array<{ label: string; text: string; /** https link: the printed text becomes clickable in the PDF */ url?: string }>;
  /** Company logo (a JPEG). Drawn at the top left; the shop text moves right to make room. Absent = identical output to before. */
  logo?: PdfLogo | null;
  /** Printed as "Payment received: [ ] Cash   [ ] Zelle ..." under the pay block (final invoices only). */
  paymentBoxes?: string[];
  /** Layout 2 only: leave out fee rows that are $0.00 (Labor and Parts subtotals and the grand total always print). */
  hideZeroRows?: boolean;
}

/** Fills any total the caller left out from the one totals engine; supplied values are used as given (as upstream). */
function resolveTotals(invoice: any, totals?: Partial<Totals> | null): Totals {
  const fallback = calculateTotals(invoice);
  if (!totals || typeof totals !== 'object') return fallback;
  const pick = (v: unknown, fb: number) => (v !== undefined ? Number(v) : fb);
  const laborSubtotal = pick(totals.laborSubtotal, fallback.laborSubtotal);
  const partsSubtotal = pick(totals.partsSubtotal, fallback.partsSubtotal);
  const subtotal = totals.subtotal !== undefined ? Number(totals.subtotal) : laborSubtotal + partsSubtotal;
  const shopSuppliesFee = pick(totals.shopSuppliesFee, fallback.shopSuppliesFee);
  const hazardousWasteFee = pick(totals.hazardousWasteFee, fallback.hazardousWasteFee);
  const travelFee = pick(totals.travelFee, fallback.travelFee);
  const miscFee = pick(totals.miscFee, fallback.miscFee);
  const discountAmount = pick(totals.discountAmount, fallback.discountAmount);
  const taxableAmount = pick(totals.taxableAmount, fallback.taxableAmount);
  const taxAmount = pick(totals.taxAmount, fallback.taxAmount);
  const grandTotal = totals.grandTotal !== undefined
    ? Number(totals.grandTotal)
    : Math.round((subtotal - discountAmount + shopSuppliesFee + hazardousWasteFee + travelFee + miscFee + taxAmount + Number.EPSILON) * 100) / 100;
  const out: Totals = { laborSubtotal, partsSubtotal, subtotal, shopSuppliesFee, hazardousWasteFee, travelFee, miscFee, discountAmount, taxableAmount, taxAmount, grandTotal };
  if (Array.isArray(invoice?.fees)) { out.fees = totals.fees ?? fallback.fees ?? []; out.feesTotal = totals.feesTotal ?? fallback.feesTotal ?? 0; }
  return out;
}

/** `invoice-<number>.pdf` (upstream name), with characters that are unsafe in file names replaced. */
export function pdfFilename(invoice: any): string {
  const n = String(invoice?.meta?.invoiceNumber || 'draft').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_');
  return `invoice-${n}.pdf`;
}

export function generatePdfBytes(invoice: any = {}, totals?: Partial<Totals> | null, options: PdfOptions = {}): Uint8Array {
  const L = resolvePdfLabels(options.labels);
  const inv = invoice || {};
  const meta = inv.meta || {};
  const shop = inv.shop || {};
  const customer = inv.customer || {};
  const vehicle = inv.vehicle || {};
  const laborItems: any[] = Array.isArray(inv.laborItems) ? inv.laborItems : [];
  const partItems: any[] = Array.isArray(inv.partItems) ? inv.partItems : [];
  const notes = inv.notes || {};
  const resolvedTotals = resolveTotals(inv, totals);
  // Dynamic mode: the invoice carries its own fee lines and detail fields (replacing the fixed fee rows and the vehicle box).
  const dynamicFees = Array.isArray(inv.fees);
  const detailLines: string[] | null = inv.details && typeof inv.details === 'object'
    ? (Array.isArray(inv.details.fields) ? inv.details.fields : []).filter((f: any) => String(f?.value ?? '').trim() !== '').map((f: any) => `${f.label}: ${f.value}`)
    : null;
  const docType: DocType = meta.docType === 'estimate' ? 'estimate' : 'invoice';
  const docName = L.docName[docType];
  // Layout 2 is the opt-in hardening pinned per invoice (docs/INVOICING_PLAN.md §4.3): real Helvetica metrics, WinAnsi characters beyond
  // Latin-1, wrapped long descriptions, optional hiding of $0.00 fee rows. Layout 1 (default) is byte-identical to the original app.
  const layout2 = meta.layout === 2;
  const measure = layout2 ? helveticaWidth : getTextWidth;
  const escaper = layout2 ? escapePdfTextWinAnsi : escapePdfText;
  const newPage = (n: number) => new PageStream(n, measure, escaper);

  // Document layout geometry
  const pageWidth = 612;
  const pageHeight = 792;
  const leftX = 40;
  const rightX = 572;
  const contentWidth = rightX - leftX; // 532 pt

  // Color palette
  const cDarkNavy: Rgb = [0.06, 0.09, 0.16];
  const cSlateDark: Rgb = [0.12, 0.16, 0.23];
  const cSlateMuted: Rgb = [0.38, 0.44, 0.53];
  const cAccentBlue: Rgb = [0.12, 0.35, 0.85];
  const cBoxBg: Rgb = [0.95, 0.96, 0.98];
  const cBoxBorder: Rgb = [0.85, 0.88, 0.92];
  const cRowAlt: Rgb = [0.98, 0.99, 1.0];
  const cBorderLine: Rgb = [0.88, 0.90, 0.93];

  const pages: PageStream[] = [];
  let currentPage = newPage(1);
  pages.push(currentPage);

  let currentY = 752;

  function checkPageBreak(neededHeight: number) {
    if (currentY - neededHeight < 60) {
      const nextNum = pages.length + 1;
      currentPage = newPage(nextNum);
      pages.push(currentPage);
      currentY = 752;

      // Header on continuation pages
      currentPage.drawText(
        fill(L.continuationTitle, { shop: shop.name || L.continuationShopFallback, doc: docName, number: meta.invoiceNumber || '', page: nextNum }),
        leftX, currentY, { font: '/F2', size: 9, color: cSlateMuted },
      );
      currentPage.drawLine(leftX, currentY - 6, rightX, currentY - 6, cBorderLine, 0.75);
      currentY -= 20;
    }
  }

  // 1. SHOP HEADER & INVOICE METADATA (Top Section)
  let shopX = leftX;
  const logo = options.logo ?? null;
  if (logo) {
    const { w, h } = fitInside(logo.width, logo.height, 130, 48);
    currentPage.drawImage('Im1', leftX, currentY - 2 - h, w, h);
    shopX = leftX + w + 12;
  }
  currentPage.drawText(shop.name || L.headerShopFallback, shopX, currentY - 14, { font: '/F2', size: 15, color: cDarkNavy });
  currentPage.drawText(shop.address || '', shopX, currentY - 28, { font: '/F1', size: 8.5, color: cSlateMuted });

  const shopContact = [
    shop.phone ? `${L.phoneLabel} ${shop.phone}` : '',
    shop.email ? `${L.emailLabel} ${shop.email}` : '',
  ].filter(Boolean).join('   |   ');
  currentPage.drawText(shopContact, shopX, currentY - 40, { font: '/F1', size: 8.5, color: cSlateMuted });

  const licenseText = shop.licenseNumber ? `${L.licenseLabel} ${shop.licenseNumber}` : '';
  currentPage.drawText(licenseText, shopX, currentY - 52, { font: '/F1', size: 8.5, color: cSlateMuted });

  // Right: Invoice Metadata
  currentPage.drawText(L.docTitle[docType], rightX, currentY - 16, { font: '/F2', size: 20, color: cDarkNavy, align: 'right' });
  currentPage.drawText(`${fill(L.numberLabel, { doc: docName })} ${meta.invoiceNumber || L.numberFallback}`, rightX, currentY - 30, { font: '/F2', size: 9.5, color: cSlateDark, align: 'right' });
  currentPage.drawText(`${L.dateLabel} ${meta.date || ''}`, rightX, currentY - 42, { font: '/F1', size: 8.5, color: cSlateMuted, align: 'right' });
  currentPage.drawText(`${L.dueLabel[docType]} ${meta.dueDate || ''}`, rightX, currentY - 54, { font: '/F1', size: 8.5, color: cSlateMuted, align: 'right' });
  currentPage.drawText(`${L.statusLabel} ${meta.status || L.statusFallback}`, rightX, currentY - 66, { font: '/F2', size: 8.5, color: cAccentBlue, align: 'right' });

  currentY -= 76;

  // Divider bar
  currentPage.drawLine(leftX, currentY, rightX, currentY, cBorderLine, 1);
  currentY -= 12;

  // 2. CUSTOMER INFO & VEHICLE DETAILS (Two Boxes)
  const showDetails = detailLines === null || detailLines.length > 0;   // dynamic mode with no filled fields: the customer box takes the full width
  const boxWidth = showDetails ? 258 : contentWidth;
  const boxHeight = detailLines ? Math.max(76, 13 * detailLines.length + 24) : 76;
  const leftBoxX = leftX;
  const rightBoxX = 314;

  currentPage.drawRect(leftBoxX, currentY - boxHeight, boxWidth, boxHeight, { stroke: cBoxBorder, lineWidth: 0.5 });
  currentPage.drawRect(leftBoxX, currentY - 18, boxWidth, 18, { fill: cBoxBg, stroke: cBoxBorder, lineWidth: 0.5 });
  currentPage.drawText(L.customerHeading, leftBoxX + 8, currentY - 13, { font: '/F2', size: 8.5, color: cSlateDark });

  if (showDetails) {
    currentPage.drawRect(rightBoxX, currentY - boxHeight, 258, boxHeight, { stroke: cBoxBorder, lineWidth: 0.5 });
    currentPage.drawRect(rightBoxX, currentY - 18, 258, 18, { fill: cBoxBg, stroke: cBoxBorder, lineWidth: 0.5 });
    currentPage.drawText(detailLines ? (inv.details.title || 'Details') : L.vehicleHeading, rightBoxX + 8, currentY - 13, { font: '/F2', size: 8.5, color: cSlateDark });
  }

  // Customer lines
  currentPage.drawText(`${L.nameLabel} ${customer.name || L.blank}`, leftBoxX + 8, currentY - 30, { font: '/F2', size: 8.5, color: cSlateDark });
  currentPage.drawText(`${L.phoneLabel} ${customer.phone || L.blank}`, leftBoxX + 8, currentY - 43, { font: '/F1', size: 8, color: cSlateMuted });
  currentPage.drawText(`${L.emailLabel} ${customer.email || L.blank}`, leftBoxX + 8, currentY - 56, { font: '/F1', size: 8, color: cSlateMuted });
  currentPage.drawText(`${L.addressLabel} ${customer.address || L.blank}`, leftBoxX + 8, currentY - 69, { font: '/F1', size: 8, color: cSlateMuted });

  if (detailLines) {
    // The user's own detail fields: one "Label: value" line each (the first one emphasised), clipped to the box.
    const clip = (t: string, size: number, bold: boolean) => { let out = t; while (out.length > 4 && measure(out, size, bold) > 242) out = out.slice(0, -1); return out === t ? t : out.replace(/\s+$/, '') + '...'; };
    detailLines.forEach((line, i) => currentPage.drawText(clip(line, i === 0 ? 8.5 : 8, i === 0), rightBoxX + 8, currentY - 30 - 13 * i, i === 0 ? { font: '/F2', size: 8.5, color: cSlateDark } : { font: '/F1', size: 8, color: cSlateMuted }));
  } else {
    // Vehicle lines (original format)
    const vehicleSummary = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || L.blank;
    currentPage.drawText(`${L.vehicleLabel} ${vehicleSummary}`, rightBoxX + 8, currentY - 30, { font: '/F2', size: 8.5, color: cSlateDark });
    currentPage.drawText(`${L.vinLabel} ${vehicle.vin || L.blank}`, rightBoxX + 8, currentY - 43, { font: '/F1', size: 8, color: cSlateMuted });
    const plateAndMileage = `${L.plateLabel} ${vehicle.licensePlate || L.blank}   ${L.mileageLabel} ${vehicle.mileage ? vehicle.mileage + ' ' + L.mileageUnit : L.blank}`;
    currentPage.drawText(plateAndMileage, rightBoxX + 8, currentY - 56, { font: '/F1', size: 8, color: cSlateMuted });
    const engineAndAdvisor = `${L.engineLabel} ${vehicle.engine || L.blank}   ${L.advisorLabel} ${vehicle.serviceAdvisor || L.blank}`;
    currentPage.drawText(engineAndAdvisor, rightBoxX + 8, currentY - 69, { font: '/F1', size: 8, color: cSlateMuted });
  }

  currentY -= boxHeight + 16;

  // 3. ITEMIZED LABOR TABLE
  checkPageBreak(50);
  currentPage.drawText(L.laborHeading, leftX, currentY, { font: '/F2', size: 10, color: cDarkNavy });
  currentY -= 6;

  currentPage.drawRect(leftX, currentY - 16, contentWidth, 16, { fill: cBoxBg, stroke: cBoxBorder, lineWidth: 0.5 });
  currentPage.drawText(L.laborColumns.description, leftX + 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark });
  currentPage.drawText(L.laborColumns.technician, leftX + 240, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark });
  currentPage.drawText(L.laborColumns.hours, leftX + 380, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentPage.drawText(L.laborColumns.rate, leftX + 450, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentPage.drawText(L.laborColumns.lineTotal, rightX - 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentY -= 16;

  if (laborItems.length === 0) {
    currentPage.drawText(L.laborEmpty, leftX + 8, currentY - 12, { font: '/F1', size: 8, color: cSlateMuted });
    currentPage.drawLine(leftX, currentY - 16, rightX, currentY - 16, cBorderLine, 0.5);
    currentY -= 16;
  } else {
    laborItems.forEach((item, index) => {
      const hours = Number(item.hours) || 0;
      const rate = Number(item.rate) || 0;
      const lineTotal = hours * rate;
      // Layout 2 wraps a long description onto extra lines (max 4) and grows the row; layout 1 always has one line and a 16 pt row.
      const descLines = layout2 ? wrapText(item.description || L.blank, 224, 8, false, measure).slice(0, 4) : [item.description || L.blank];
      const rowH = descLines.length > 1 ? 16 + (descLines.length - 1) * 9.5 : 16;
      checkPageBreak(rowH + 4);

      if (index % 2 === 1) {
        currentPage.drawRect(leftX, currentY - rowH, contentWidth, rowH, { fill: cRowAlt });
      }
      currentPage.drawLine(leftX, currentY - rowH, rightX, currentY - rowH, cBorderLine, 0.5);

      descLines.forEach((dl, k) => currentPage.drawText(dl, leftX + 8, currentY - 11.5 - k * 9.5, { font: '/F1', size: 8, color: cSlateDark }));
      currentPage.drawText(item.technician || L.blank, leftX + 240, currentY - 11.5, { font: '/F1', size: 8, color: cSlateMuted });
      currentPage.drawText(hours.toFixed(2), leftX + 380, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark, align: 'right' });
      currentPage.drawText(formatPdfCurrency(rate), leftX + 450, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark, align: 'right' });
      currentPage.drawText(formatPdfCurrency(layout2 ? Math.round((lineTotal + Number.EPSILON) * 100) / 100 : lineTotal), rightX - 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
      currentY -= rowH;
    });
  }

  // Labor subtotal line
  currentPage.drawRect(leftX, currentY - 16, contentWidth, 16, { fill: cBoxBg, stroke: cBoxBorder, lineWidth: 0.5 });
  currentPage.drawText(L.laborSubtotal, leftX + 450, currentY - 11.5, { font: '/F2', size: 8.5, color: cSlateDark, align: 'right' });
  currentPage.drawText(formatPdfCurrency(resolvedTotals.laborSubtotal), rightX - 8, currentY - 11.5, { font: '/F2', size: 8.5, color: cSlateDark, align: 'right' });
  currentY -= 24;

  // 4. ITEMIZED PARTS TABLE
  checkPageBreak(50);
  currentPage.drawText(L.partsHeading, leftX, currentY, { font: '/F2', size: 10, color: cDarkNavy });
  currentY -= 6;

  currentPage.drawRect(leftX, currentY - 16, contentWidth, 16, { fill: cBoxBg, stroke: cBoxBorder, lineWidth: 0.5 });
  currentPage.drawText(L.partsColumns.partNumber, leftX + 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark });
  currentPage.drawText(L.partsColumns.description, leftX + 110, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark });
  currentPage.drawText(L.partsColumns.qty, leftX + 380, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentPage.drawText(L.partsColumns.unitPrice, leftX + 450, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentPage.drawText(L.partsColumns.lineTotal, rightX - 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
  currentY -= 16;

  if (partItems.length === 0) {
    currentPage.drawText(L.partsEmpty, leftX + 8, currentY - 12, { font: '/F1', size: 8, color: cSlateMuted });
    currentPage.drawLine(leftX, currentY - 16, rightX, currentY - 16, cBorderLine, 0.5);
    currentY -= 16;
  } else {
    partItems.forEach((item, index) => {
      const qty = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const lineTotal = qty * unitPrice;
      const descLines = layout2 ? wrapText(item.description || L.blank, 224, 8, false, measure).slice(0, 4) : [item.description || L.blank];
      const rowH = descLines.length > 1 ? 16 + (descLines.length - 1) * 9.5 : 16;
      checkPageBreak(rowH + 4);

      if (index % 2 === 1) {
        currentPage.drawRect(leftX, currentY - rowH, contentWidth, rowH, { fill: cRowAlt });
      }
      currentPage.drawLine(leftX, currentY - rowH, rightX, currentY - rowH, cBorderLine, 0.5);

      currentPage.drawText(item.partNumber || L.blank, leftX + 8, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark });
      descLines.forEach((dl, k) => currentPage.drawText(dl, leftX + 110, currentY - 11.5 - k * 9.5, { font: '/F1', size: 8, color: cSlateDark }));
      currentPage.drawText(String(qty), leftX + 380, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark, align: 'right' });
      currentPage.drawText(formatPdfCurrency(unitPrice), leftX + 450, currentY - 11.5, { font: '/F1', size: 8, color: cSlateDark, align: 'right' });
      currentPage.drawText(formatPdfCurrency(layout2 ? Math.round((lineTotal + Number.EPSILON) * 100) / 100 : lineTotal), rightX - 8, currentY - 11.5, { font: '/F2', size: 8, color: cSlateDark, align: 'right' });
      currentY -= rowH;
    });
  }

  // Parts subtotal line
  currentPage.drawRect(leftX, currentY - 16, contentWidth, 16, { fill: cBoxBg, stroke: cBoxBorder, lineWidth: 0.5 });
  currentPage.drawText(L.partsSubtotal, leftX + 450, currentY - 11.5, { font: '/F2', size: 8.5, color: cSlateDark, align: 'right' });
  currentPage.drawText(formatPdfCurrency(resolvedTotals.partsSubtotal), rightX - 8, currentY - 11.5, { font: '/F2', size: 8.5, color: cSlateDark, align: 'right' });
  currentY -= 24;

  // 5. TOTALS SUMMARY & NOTES / TERMS SECTION
  checkPageBreak(150);

  const splitY = currentY;
  const leftColWidth = 280;
  const totalsBoxX = 330;
  const totalsBoxWidth = rightX - totalsBoxX; // 242 pt

  // Left column: notes & terms
  let notesY = splitY;
  if (notes.customerNotes) {
    currentPage.drawText(L.customerNotesHeading, leftX, notesY, { font: '/F2', size: 8.5, color: cDarkNavy });
    notesY -= 11;
    for (const line of wrapText(notes.customerNotes, leftColWidth, 8, false, measure)) {
      currentPage.drawText(line, leftX, notesY, { font: '/F1', size: 8, color: cSlateDark });
      notesY -= 10;
    }
    notesY -= 6;
  }

  if (notes.termsAndConditions) {
    currentPage.drawText(L.termsHeading, leftX, notesY, { font: '/F2', size: 8.5, color: cDarkNavy });
    notesY -= 11;
    for (const line of wrapText(notes.termsAndConditions, leftColWidth, 7.5, false, measure)) {
      currentPage.drawText(line, leftX, notesY, { font: '/F1', size: 7.5, color: cSlateMuted });
      notesY -= 9.5;
    }
  }

  // Right column: totals summary. Every row is always printed, including $0.00 rows (upstream behavior, Q5).
  let totalsY = splitY;
  const totalsRows = dynamicFees
    ? [
        { label: L.totals.laborSubtotal, amount: resolvedTotals.laborSubtotal, isDiscount: false },
        { label: L.totals.partsSubtotal, amount: resolvedTotals.partsSubtotal, isDiscount: false },
        ...(resolvedTotals.fees ?? []).map(f => ({ label: f.label, amount: f.amount, isDiscount: false })),
        ...(resolvedTotals.discountAmount > 0 ? [{ label: L.totals.discount, amount: resolvedTotals.discountAmount, isDiscount: true }] : []),
        ...(Number(inv.settings?.taxRate) > 0 || resolvedTotals.taxAmount > 0 ? [{ label: L.totals.tax, amount: resolvedTotals.taxAmount, isDiscount: false }] : []),
      ]
    : [
        { label: L.totals.laborSubtotal, amount: resolvedTotals.laborSubtotal, isDiscount: false },
        { label: L.totals.partsSubtotal, amount: resolvedTotals.partsSubtotal, isDiscount: false },
        { label: L.totals.shopSupplies, amount: resolvedTotals.shopSuppliesFee, isDiscount: false },
        { label: L.totals.hazardousWaste, amount: resolvedTotals.hazardousWasteFee, isDiscount: false },
        { label: L.totals.travel, amount: resolvedTotals.travelFee, isDiscount: false },
        { label: L.totals.misc, amount: resolvedTotals.miscFee, isDiscount: false },
        { label: L.totals.discount, amount: resolvedTotals.discountAmount, isDiscount: true },
        { label: L.totals.tax, amount: resolvedTotals.taxAmount, isDiscount: false },
      ];

  const visibleRows = layout2 && options.hideZeroRows ? totalsRows.filter((r, i) => i < 2 || Math.abs(r.amount) >= 0.005) : totalsRows;
  for (const row of visibleRows) {
    currentPage.drawText(row.label, totalsBoxX + 8, totalsY, { font: '/F1', size: 8.5, color: cSlateDark });
    const prefix = row.isDiscount && row.amount > 0 ? '-' : '';
    currentPage.drawText(`${prefix}${formatPdfCurrency(row.amount)}`, rightX - 8, totalsY, { font: '/F2', size: 8.5, color: cSlateDark, align: 'right' });
    totalsY -= 13;
  }

  // Grand total highlight bar
  totalsY -= 2;
  currentPage.drawRect(totalsBoxX, totalsY - 18, totalsBoxWidth, 20, { fill: cDarkNavy });
  currentPage.drawText(L.totals.grandTotal, totalsBoxX + 8, totalsY - 13.5, { font: '/F2', size: 10, color: [1, 1, 1] });
  currentPage.drawText(formatPdfCurrency(resolvedTotals.grandTotal), rightX - 8, totalsY - 13.5, { font: '/F2', size: 11, color: [1, 1, 1], align: 'right' });
  totalsY -= 26;

  // Move currentY past both columns
  currentY = Math.min(notesY, totalsY) - 16;

  // 5b. HOW TO PAY (optional; final invoices only; absent options leave the output byte-identical to before)
  const payLines = docType === 'invoice' ? (options.payOptions ?? []).flatMap(o => wrapText(o.text, contentWidth - 16, 8, false, measure).map(t => ({ t, url: o.url }))) : [];
  const boxes = docType === 'invoice' ? (options.paymentBoxes ?? []) : [];
  if (payLines.length || boxes.length) {
    checkPageBreak(24 + payLines.length * 10 + (boxes.length ? 14 : 0));
    if (payLines.length) {
      currentPage.drawText(L.payHeading, leftX, currentY, { font: '/F2', size: 8.5, color: cDarkNavy });
      currentY -= 11;
      for (const line of payLines) {
        currentPage.drawText(line.t, leftX, currentY, { font: '/F1', size: 8, color: line.url ? cAccentBlue : cSlateDark });
        if (line.url) currentPage.addLink(leftX, currentY - 2, Math.min(contentWidth, measure(line.t, 8, false)), 10, line.url); // clickable in any PDF viewer
        currentY -= 10;
      }
      currentY -= 4;
    }
    if (boxes.length) {
      currentPage.drawText(`${L.paymentReceivedLabel}   ${boxes.map(b => `[ ] ${b}`).join('    ')}`, leftX, currentY, { font: '/F1', size: 8, color: cSlateDark });
      currentY -= 14;
    }
  }

  // 6. CUSTOMER AUTHORIZATION SIGNATURE LINE
  checkPageBreak(55);
  currentPage.drawLine(leftX, currentY, rightX, currentY, cBorderLine, 0.75);
  currentY -= 18;

  currentPage.drawText(L.signatureLine, leftX, currentY, { font: '/F2', size: 8, color: cSlateDark });
  currentY -= 12;

  const authorization = L.signatureText[docType];
  if (authorization) currentPage.drawText(authorization, leftX, currentY, { font: '/F1', size: 7, color: cSlateMuted });

  // 7. FOOTERS ACROSS ALL PAGES
  const totalPages = pages.length;
  const footerNumber = meta.invoiceNumber || L.footerNumberFallback;
  const footerBrand = L.footerBrand || shop.name || '';
  const footerLeftText = footerBrand ? fill(L.footerLeft, { brand: footerBrand, number: footerNumber }) : String(footerNumber);
  pages.forEach((page, idx) => {
    page.drawLine(leftX, 32, rightX, 32, cBorderLine, 0.5);
    page.drawText(footerLeftText, leftX, 22, { font: '/F1', size: 7, color: cSlateMuted });
    page.drawText(fill(L.footerPage, { page: idx + 1, total: totalPages }), rightX, 22, { font: '/F1', size: 7, color: cSlateMuted, align: 'right' });
  });

  // 8. ASSEMBLE PDF-1.4 BINARY OUTPUT
  return assemblePdf(pages, logo);
}
