/**
 * Invoice data model. This is also the import/export file format: `meta`, `shop`, `customer`, `vehicle`, line items,
 * `settings`, `notes`, optional `fees` / `details`, and an optional namespaced `ge` block that GlassExpense owns.
 *
 * Pure TypeScript, no DOM: shared by the browser and (where noted in the plan) the server.
 */

/** Order matters: it is the order of the status dropdown. `Sent` is a GlassExpense addition (docs/DOCUMENTATION.md §13.8). */
export const INVOICE_STATUSES = ['Draft', 'Estimate', 'Approved', 'Paid', 'Overdue', 'Sent'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/**
 * What people SEE for a status. The stored value stays `Draft` (older files and the agent API use it), but on a final invoice
 * it reads "Final": the invoice is finished and not yet sent. An estimate that is still a draft keeps the word "Draft".
 */
export function statusLabel(status: string, docType?: string): string {
  return status === 'Draft' && docType !== 'estimate' ? 'Final' : status;
}

export const DOC_TYPES = ['invoice', 'estimate'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DISCOUNT_TYPES = ['percent', 'fixed'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export interface InvoiceMeta {
  invoiceNumber: string;
  /** YYYY-MM-DD or '' */
  date: string;
  /** YYYY-MM-DD or ''. For estimates this is the "valid until" date. */
  dueDate: string;
  status: InvoiceStatus;
  docType: DocType;
  /**
   * PDF/sheet layout generation, pinned per invoice so reprints of a sent invoice never change (docs/DOCUMENTATION.md §13.4).
   * 1 = the original design (default). 2 is reserved for the optional hardening in P8.
   */
  layout: 1 | 2;
}

export interface Party {
  name: string;
  phone: string;
  email: string;
  address: string;
}

export interface ShopInfo extends Party {
  licenseNumber: string;
}

export interface Vehicle {
  year: string;
  make: string;
  model: string;
  vin: string;
  licensePlate: string;
  mileage: string;
  engine: string;
  serviceAdvisor: string;
}

export interface LaborItem {
  id: string;
  description: string;
  technician: string;
  hours: number;
  rate: number;
}

export interface PartItem {
  id: string;
  partNumber: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceSettings {
  /** percent, 0-100 */
  taxRate: number;
  taxLabor: boolean;
  discountType: DiscountType;
  discountValue: number;
  /** percent of labor, 0-100 */
  shopSuppliesRate: number;
  shopSuppliesCap: number;
  hazardousWasteFee: number;
  travelFee: number;
  miscFee: number;
}

export interface InvoiceNotes {
  customerNotes: string;
  termsAndConditions: string;
}

/**
 * GlassExpense's own namespace inside an exported invoice. Opaque in the core (P1); later phases give it a strict shape
 * (id, jobId, review, payments, events, pending, ai, ...). It is always sanitized by `normalizeInvoice`.
 */
export type GeBlock = Record<string, unknown>;

/**
 * User-defined fees (docs/DOCUMENTATION.md, "dynamic fees"): any number of labelled lines, each a flat amount or a percentage of labor or
 * of the subtotal (optionally capped, optionally taxable). An invoice that carries a `fees` array uses these INSTEAD of the four fixed
 * fee fields; an invoice without one (older files) keeps the fixed fields and behaves as before.
 */
export const FEE_KINDS = ['flat', 'percentOfLabor', 'percentOfSubtotal'] as const;
export type FeeKind = (typeof FEE_KINDS)[number];
export interface FeeLine { id: string; label: string; kind: FeeKind; value: number; /** 0 = no cap */ cap: number; taxable: boolean }

/** User-defined detail fields (replace the fixed vehicle box): a labelled value each, filled from a job's intake by `key`. */
export const FIELD_TYPES = ['text', 'number', 'date', 'vin'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export interface DetailField { key: string; label: string; type: FieldType; value: string }
/** `setId` records which of the user's detail-field presets (Settings → Invoices) filled the box; absent on older or hand-made boxes. */
export interface InvoiceDetails { title: string; fields: DetailField[]; setId?: string }

export interface Invoice {
  meta: InvoiceMeta;
  shop: ShopInfo;
  customer: Party;
  vehicle: Vehicle;
  laborItems: LaborItem[];
  partItems: PartItem[];
  settings: InvoiceSettings;
  notes: InvoiceNotes;
  /** Present = dynamic fees mode (see FeeLine). */
  fees?: FeeLine[];
  /** Present = custom detail fields instead of the fixed vehicle box. */
  details?: InvoiceDetails;
  ge?: GeBlock;
}

export interface Totals {
  laborSubtotal: number;
  partsSubtotal: number;
  subtotal: number;
  shopSuppliesFee: number;
  hazardousWasteFee: number;
  travelFee: number;
  miscFee: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  grandTotal: number;
  /** Dynamic fees mode only (absent for original-format invoices, so their totals are unchanged). */
  fees?: Array<{ id: string; label: string; amount: number }>;
  feesTotal?: number;
}

export type VinCheck = { valid: true } | { valid: false; reason: string };
