import type { DocType } from './types';

/**
 * Every user-visible string of the sheet (and so of the preview, print and PDF), as data (docs/DOCUMENTATION.md §13.4).
 *
 * Overridable per user from Settings; the defaults below are neutral (no business name, no automotive wording).
 *
 * Templates use `{name}` placeholders (see `fill`). Labels are plain strings so they can be stored in the encrypted settings blob.
 */

export const fill = (template: string, vars: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

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
  /** '' hides the terms box when the invoice has no terms (there is no built-in legal sentence, D4). */
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

export const resolveSheetLabels = (patch?: DeepPartial<SheetLabels>): SheetLabels => merge(DEFAULT_SHEET_LABELS, patch);
export type { DeepPartial };
