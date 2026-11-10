import { asNumber, formatCurrency } from './format';
import { calculateTotals } from './totals';
import { isLogoDataUrl } from './logo';
import { fill, resolveSheetLabels, type DeepPartial, type SheetLabels } from './labels';
import { statusLabel, type DocType, type Totals } from './types';

/**
 * The paper sheet as data: every string and number, in order, that the preview, the print view and the PDF show.
 *
 * `InvoiceSheet.tsx` only renders this model and `pdf/sheetPdf.ts` draws the PDF from it, so the three always agree. Keeping the text
 * logic here makes it testable with plain `tsx` scripts (GE has no component-test framework, docs/DOCUMENTATION.md §13.2 C14).
 *
 * There is no built-in legal wording: the terms fallback and the authorization sentence are label data, empty by default (decision D4).
 */

export interface SheetRow { description: string; technician: string; hours: string; rate: string; amount: string }
export interface SheetPartRow { partNumber: string; description: string; quantity: string; unitPrice: string; amount: string }
export interface SheetTotalsLine { key: string; label: string; value: string; bold?: boolean; grand?: boolean }

export interface SheetModel {
  docType: DocType;
  title: string;
  shop: { name: string; address: string; contact: string; license: string | null; /** JPEG data URL for the header, or null */ logo: string | null };
  status: { value: string; badgeText: string; cssClass: string };
  meta: Array<{ label: string; value: string; mono?: boolean }>;
  customer: { heading: string; name: string; details: string[]; emptyText: string };
  /** The vehicle box (original format) or the user's detail fields (dynamic); null when there is nothing to show. */
  vehicle: { heading: string; attrs: Array<{ label: string; value: string; mono?: boolean }> } | null;
  labor: { heading: string; columns: string[]; rows: SheetRow[]; emptyText: string; subtotalLabel: string; subtotal: string };
  parts: { heading: string; columns: string[]; rows: SheetPartRow[]; emptyText: string; subtotalLabel: string; subtotal: string };
  notes: { customer: { heading: string; text: string }; terms: { heading: string; text: string; hidden: boolean } };
  totals: SheetTotalsLine[];
  signature: { text: string; customerCaption: string; dateCaption: string };
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

export function buildSheetModel(invoice: any, totalsIn?: Totals | null, labelPatch?: DeepPartial<SheetLabels>, opts: { hideZeroRows?: boolean; logo?: string | null } = {}): SheetModel {
  const L = resolveSheetLabels(labelPatch);
  const inv = invoice || {};
  const totals = totalsIn ?? calculateTotals(inv);
  const meta = inv.meta || {};
  const shop = inv.shop || {};
  const customer = inv.customer || {};
  const vehicle = inv.vehicle || {};
  const settings = inv.settings || {};
  const notes = inv.notes || {};
  const docType: DocType = meta.docType === 'estimate' ? 'estimate' : 'invoice';
  const status = String(meta.status || 'Draft');

  const money = (n: unknown) => formatCurrency(n);
  const discountText = totals.discountAmount > 0 ? `-${money(totals.discountAmount)}` : money(0);
  const ymm = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const terms = notes.termsAndConditions || L.termsEmpty;
  const dynamicFees = Array.isArray(inv.fees);

  return {
    docType,
    title: L.docTitle[docType],
    shop: {
      name: shop.name || '',
      address: shop.address || '',
      contact: [shop.phone || '', shop.email || ''].filter(Boolean).join(' • '),
      license: shop.licenseNumber ? String(shop.licenseNumber) : null,
      logo: opts.logo && isLogoDataUrl(opts.logo) ? opts.logo : null,
    },
    status: { value: status, badgeText: statusLabel(status, docType).toUpperCase(), cssClass: `badge-${status.toLowerCase()}` },
    meta: [
      { label: fill(L.numberLabel, { doc: L.docName[docType] }), value: meta.invoiceNumber || L.numberFallback, mono: true },
      { label: L.dateLabel, value: meta.date || L.blank },
      { label: L.dueLabel[docType], value: meta.dueDate || L.blank },
    ],
    customer: {
      heading: L.customerHeading,
      name: customer.name || L.walkInCustomer,
      details: [customer.phone, customer.email, customer.address].filter(Boolean).map(String),
      emptyText: L.noContactDetails,
    },
    vehicle: inv.details
      ? (() => {
          const shown = inv.details.fields.filter((f: any) => String(f?.value ?? '').trim() !== '');
          return shown.length ? { heading: inv.details.title || 'Details', attrs: shown.map((f: any) => ({ label: String(f.label), value: String(f.value), mono: f.type === 'vin' })) } : null;
        })()
      : {
          heading: L.vehicleHeading,
          attrs: [
            { label: L.ymmLabel, value: ymm || L.blank },
            { label: L.vinLabel, value: vehicle.vin || L.blank, mono: true },
            { label: L.plateLabel, value: vehicle.licensePlate || L.blank, mono: true },
            { label: L.mileageLabel, value: vehicle.mileage ? `${vehicle.mileage} ${L.mileageUnit}` : L.blank },
            { label: L.engineLabel, value: vehicle.engine || L.blank },
            { label: L.advisorLabel, value: vehicle.serviceAdvisor || L.blank },
          ],
        },
    labor: {
      heading: L.laborHeading,
      columns: [L.laborColumns.description, L.laborColumns.technician, L.laborColumns.hours, L.laborColumns.rate, L.laborColumns.amount],
      // Hours show with one decimal by default; the optional rounding mode (meta.layout 2) shows two.
      rows: arr(inv.laborItems).map(item => ({
        description: item?.description || L.laborFallback,
        technician: item?.technician || L.blank,
        hours: asNumber(item?.hours).toFixed(meta.layout === 2 ? 2 : 1),
        rate: money(item?.rate || 0),
        amount: money(asNumber(item?.hours) * asNumber(item?.rate)),
      })),
      emptyText: L.laborEmpty,
      subtotalLabel: L.laborSubtotal,
      subtotal: money(totals.laborSubtotal),
    },
    parts: {
      heading: L.partsHeading,
      columns: [L.partsColumns.partNumber, L.partsColumns.description, L.partsColumns.qty, L.partsColumns.unitPrice, L.partsColumns.amount],
      rows: arr(inv.partItems).map(item => ({
        partNumber: item?.partNumber || L.blank,
        description: item?.description || L.partFallback,
        quantity: String(asNumber(item?.quantity)),
        unitPrice: money(item?.unitPrice || 0),
        amount: money(asNumber(item?.quantity) * asNumber(item?.unitPrice)),
      })),
      emptyText: L.partsEmpty,
      subtotalLabel: L.partsSubtotal,
      subtotal: money(totals.partsSubtotal),
    },
    notes: {
      customer: { heading: L.notesHeading, text: notes.customerNotes || L.notesEmpty },
      terms: { heading: L.termsHeading, text: terms, hidden: !terms },
    },
    totals: dynamicFees
      ? ([
          { key: 'labor', label: L.totals.laborSubtotal, value: money(totals.laborSubtotal) },
          { key: 'parts', label: L.totals.partsSubtotal, value: money(totals.partsSubtotal) },
          { key: 'subtotal', label: L.totals.subtotal, value: money(totals.subtotal), bold: true },
          ...(totals.discountAmount > 0 ? [{ key: 'discount', label: L.totals.discount, value: discountText }] : []),
          ...(totals.fees ?? []).map(f => ({ key: `fee:${f.id}`, label: `${f.label}:`, value: money(f.amount) })),
          ...(asNumber(settings.taxRate) > 0 || totals.taxAmount > 0 ? [{ key: 'tax', label: fill(L.totals.tax, { rate: `${settings.taxRate ?? 0}%` }), value: money(totals.taxAmount) }] : []),
          { key: 'grand', label: L.totals.grandTotal, value: money(totals.grandTotal), grand: true },
        ] as SheetTotalsLine[])
      // Every fee row is listed, including $0.00, unless the optional rounding mode (meta.layout 2) with hideZeroRows is on.
      : ([
          { key: 'labor', label: L.totals.laborSubtotal, value: money(totals.laborSubtotal) },
          { key: 'parts', label: L.totals.partsSubtotal, value: money(totals.partsSubtotal) },
          { key: 'subtotal', label: L.totals.subtotal, value: money(totals.subtotal), bold: true },
          { key: 'discount', label: L.totals.discount, value: discountText },
          { key: 'supplies', label: L.totals.shopSupplies, value: money(totals.shopSuppliesFee) },
          { key: 'hazmat', label: L.totals.hazardousWaste, value: money(totals.hazardousWasteFee) },
          { key: 'travel', label: L.totals.travel, value: money(totals.travelFee) },
          { key: 'misc', label: L.totals.misc, value: money(totals.miscFee) },
          { key: 'tax', label: fill(L.totals.tax, { rate: `${settings.taxRate ?? 0}%` }), value: money(totals.taxAmount) },
          { key: 'grand', label: L.totals.grandTotal, value: money(totals.grandTotal), grand: true },
        ] as SheetTotalsLine[]).filter(l => !(meta.layout === 2 && opts.hideZeroRows && ['discount', 'supplies', 'hazmat', 'travel', 'misc', 'tax'].includes(l.key) && /^-?\$0\.00$/.test(l.value))),
    signature: { text: L.signatureText[docType], customerCaption: L.signatureCustomer, dateCaption: L.signatureDate },
  };
}
