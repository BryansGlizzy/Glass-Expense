import type { DocType } from './types';

/**
 * Every user-visible string of the PDF and the preview sheet, as data (plan §5.1 / §5.2).
 *
 * The original app hard-coded some of these (brand names in the footer, the authorization sentence, fee-row names, an
 * automotive license label). They are now overridable per user from Settings; the defaults below are neutral. The exact
 * upstream wording lives in `tests/reference/automotive/labels.ts` and is used only by the parity tests.
 *
 * Templates use `{name}` placeholders (see `fill`). Labels are plain strings so they can be stored in the encrypted settings blob.
 */

export const fill = (template: string, vars: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

export interface PdfLabels {
  docTitle: Record<DocType, string>;
  /** Word used inside templates, e.g. "Invoice #:" */
  docName: Record<DocType, string>;
  dueLabel: Record<DocType, string>;
  headerShopFallback: string;
  continuationShopFallback: string;
  /** vars: shop, doc, number, page */
  continuationTitle: string;
  licenseLabel: string;
  /** vars: doc */
  numberLabel: string;
  numberFallback: string;
  dateLabel: string;
  statusLabel: string;
  statusFallback: string;
  customerHeading: string;
  vehicleHeading: string;
  nameLabel: string; phoneLabel: string; emailLabel: string; addressLabel: string;
  vehicleLabel: string; vinLabel: string; plateLabel: string; mileageLabel: string; mileageUnit: string; engineLabel: string; advisorLabel: string;
  blank: string;
  laborHeading: string;
  laborColumns: { description: string; technician: string; hours: string; rate: string; lineTotal: string };
  laborEmpty: string;
  laborSubtotal: string;
  partsHeading: string;
  partsColumns: { partNumber: string; description: string; qty: string; unitPrice: string; lineTotal: string };
  partsEmpty: string;
  partsSubtotal: string;
  customerNotesHeading: string;
  termsHeading: string;
  totals: {
    laborSubtotal: string; partsSubtotal: string; shopSupplies: string; hazardousWaste: string;
    travel: string; misc: string; discount: string; tax: string; grandTotal: string;
  };
  /** Heading of the optional payment-instructions block. */
  payHeading: string;
  /** Label before the optional "Payment received" boxes. */
  paymentReceivedLabel: string;
  signatureLine: string;
  /** Authorization sentence under the signature line; '' prints nothing. */
  signatureText: Record<DocType, string>;
  /** Footer brand; '' uses the shop name. */
  footerBrand: string;
  footerNumberFallback: string;
  /** vars: brand, number. Used only when a brand exists; otherwise the footer shows just the number. */
  footerLeft: string;
  /** vars: page, total */
  footerPage: string;
}

export interface SheetLabels {
  docTitle: Record<DocType, string>;
  docName: Record<DocType, string>;
  dueLabel: Record<DocType, string>;
  /** vars: doc */
  numberLabel: string;
  numberFallback: string;
  dateLabel: string;
  /** Placeholder for an empty value on the sheet. */
  blank: string;
  walkInCustomer: string;
  noContactDetails: string;
  customerHeading: string;
  vehicleHeading: string;
  ymmLabel: string; vinLabel: string; plateLabel: string; mileageLabel: string; engineLabel: string; advisorLabel: string;
  mileageUnit: string;
  laborHeading: string;
  laborColumns: { description: string; technician: string; hours: string; rate: string; amount: string };
  laborEmpty: string;
  laborFallback: string;
  laborSubtotal: string;
  partsHeading: string;
  partsColumns: { partNumber: string; description: string; qty: string; unitPrice: string; amount: string };
  partsEmpty: string;
  partFallback: string;
  partsSubtotal: string;
  notesHeading: string;
  notesEmpty: string;
  termsHeading: string;
  /** '' hides the terms box when the invoice has no terms (upstream showed a placeholder legal sentence; discarded, D4). */
  termsEmpty: string;
  totals: {
    laborSubtotal: string; partsSubtotal: string; subtotal: string; discount: string; shopSupplies: string; hazardousWaste: string;
    travel: string; misc: string; /** vars: rate */ tax: string; grandTotal: string;
  };
  signatureText: Record<DocType, string>;
  signatureCustomer: string;
  signatureDate: string;
}

const both = (invoice: string, estimate: string): Record<DocType, string> => ({ invoice, estimate });

export const DEFAULT_PDF_LABELS: PdfLabels = {
  docTitle: both('INVOICE', 'ESTIMATE'),
  docName: both('Invoice', 'Estimate'),
  dueLabel: both('Due Date:', 'Valid Until:'),
  headerShopFallback: '',
  continuationShopFallback: '',
  continuationTitle: '{shop} — {doc} {number} (Page {page})',
  licenseLabel: 'License #:',
  numberLabel: '{doc} #:',
  numberFallback: 'DRAFT',
  dateLabel: 'Date:',
  statusLabel: 'Status:',
  statusFallback: 'Draft',
  customerHeading: 'CUSTOMER INFORMATION',
  vehicleHeading: 'VEHICLE DETAILS',
  nameLabel: 'Name:', phoneLabel: 'Phone:', emailLabel: 'Email:', addressLabel: 'Address:',
  vehicleLabel: 'Vehicle:', vinLabel: 'VIN:', plateLabel: 'License Plate:', mileageLabel: 'Mileage:', mileageUnit: 'mi', engineLabel: 'Engine:', advisorLabel: 'Service Advisor:',
  blank: '-',
  laborHeading: 'LABOR SERVICES',
  laborColumns: { description: 'Description', technician: 'Technician', hours: 'Hours', rate: 'Rate', lineTotal: 'Line Total' },
  laborEmpty: 'No labor services listed.',
  laborSubtotal: 'Labor Subtotal:',
  partsHeading: 'PARTS & MATERIALS',
  partsColumns: { partNumber: 'Part #', description: 'Description', qty: 'Qty', unitPrice: 'Unit Price', lineTotal: 'Line Total' },
  partsEmpty: 'No parts or materials listed.',
  partsSubtotal: 'Parts Subtotal:',
  customerNotesHeading: 'Customer Notes:',
  termsHeading: 'Terms & Conditions:',
  totals: {
    laborSubtotal: 'Labor Subtotal', partsSubtotal: 'Parts Subtotal', shopSupplies: 'Shop Supplies Fee', hazardousWaste: 'Hazardous Waste Fee',
    travel: 'Travel Fee', misc: 'Misc. Fee', discount: 'Discount Amount', tax: 'Tax Amount', grandTotal: 'Grand Total',
  },
  payHeading: 'HOW TO PAY',
  paymentReceivedLabel: 'Payment received:',
  signatureLine: 'Customer Authorization Signature: _________________________________________    Date: _______________',
  signatureText: both('', ''),
  footerBrand: '',
  footerNumberFallback: 'Draft',
  footerLeft: '{brand}  •  {number}',
  footerPage: 'Page {page} of {total}',
};

export const DEFAULT_SHEET_LABELS: SheetLabels = {
  docTitle: both('INVOICE', 'ESTIMATE'),
  docName: both('Invoice', 'Estimate'),
  dueLabel: both('Due Date:', 'Valid Until:'),
  numberLabel: '{doc} #:',
  numberFallback: 'DRAFT',
  dateLabel: 'Date:',
  blank: '—',
  walkInCustomer: 'Walk-in Customer',
  noContactDetails: 'No contact details specified',
  customerHeading: 'Customer',
  vehicleHeading: 'Vehicle Information',
  ymmLabel: 'Year / Make / Model', vinLabel: 'VIN', plateLabel: 'License Plate', mileageLabel: 'Mileage', engineLabel: 'Engine / Trim', advisorLabel: 'Service Advisor',
  mileageUnit: 'mi',
  laborHeading: 'Labor & Diagnostic Services',
  laborColumns: { description: 'Service Description', technician: 'Technician', hours: 'Hours', rate: 'Rate', amount: 'Amount' },
  laborEmpty: 'No labor services',
  laborFallback: 'Labor Service',
  laborSubtotal: 'Labor Subtotal:',
  partsHeading: 'Parts & Materials',
  partsColumns: { partNumber: 'Part #', description: 'Description', qty: 'Qty', unitPrice: 'Unit Price', amount: 'Amount' },
  partsEmpty: 'No parts or materials',
  partFallback: 'Part Item',
  partsSubtotal: 'Parts Subtotal:',
  notesHeading: 'Customer Notes / Recommendations',
  notesEmpty: 'No special customer notes.',
  termsHeading: 'Terms & Conditions',
  termsEmpty: '',
  totals: {
    laborSubtotal: 'Labor Subtotal:', partsSubtotal: 'Parts Subtotal:', subtotal: 'Subtotal:', discount: 'Discount:', shopSupplies: 'Shop Supplies:',
    hazardousWaste: 'Hazardous Waste:', travel: 'Travel Fee:', misc: 'Misc. Fee:', tax: 'Sales Tax ({rate}):', grandTotal: 'Total Due:',
  },
  signatureText: both('', ''),
  signatureCustomer: 'Customer Signature',
  signatureDate: 'Date',
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T extends object>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(patch) as Array<keyof T>) {
    const v: any = (patch as any)[k];
    if (v === undefined) continue;
    const b: any = (base as any)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' ? merge(b, v) : v;
  }
  return out as T;
}

export const resolvePdfLabels = (patch?: DeepPartial<PdfLabels>): PdfLabels => merge(DEFAULT_PDF_LABELS, patch);
export const resolveSheetLabels = (patch?: DeepPartial<SheetLabels>): SheetLabels => merge(DEFAULT_SHEET_LABELS, patch);
export type { DeepPartial };
