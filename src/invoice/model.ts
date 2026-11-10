import type { GeBlock, Invoice, InvoiceMeta, InvoiceNotes, InvoiceSettings, LaborItem, Party, PartItem, ShopInfo, Vehicle } from './types';

/**
 * Immutable invoice model functions.
 *
 * There are no built-in business defaults (decision D4, docs/DOCUMENTATION.md §13.2): no demo shop, warranty text, tax rate, fee, numbering
 * scheme, due date or labor rate. A new invoice starts blank; real values come from the user's Settings and the job (`prefill.ts`).
 */

let idSequence = 0;
export function createId(prefix: string): string {
  idSequence += 1;
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}-${rand}`;
}

const cloneItems = <T extends object>(items: T[] | undefined): T[] => (Array.isArray(items) ? items.map(item => ({ ...item })) : []);

/** Local calendar date as YYYY-MM-DD (the user's "today", not UTC's). */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export interface InvoiceOverrides {
  meta?: Partial<InvoiceMeta>;
  shop?: Partial<ShopInfo>;
  customer?: Partial<Party>;
  vehicle?: Partial<Vehicle>;
  laborItems?: LaborItem[];
  partItems?: PartItem[];
  settings?: Partial<InvoiceSettings>;
  notes?: Partial<InvoiceNotes>;
  ge?: GeBlock;
}

/** A blank invoice. Every field is explicit and neutral; `overrides` is merged section by section. */
export function createEmptyInvoice(overrides: InvoiceOverrides | null = {}, now: Date = new Date()): Invoice {
  const source = (overrides && typeof overrides === 'object' ? overrides : {}) as InvoiceOverrides;
  const base: Invoice = {
    meta: { invoiceNumber: '', date: todayIso(now), dueDate: '', status: 'Draft', docType: 'invoice', layout: 1 },
    shop: { name: '', address: '', phone: '', email: '', licenseNumber: '' },
    customer: { name: '', phone: '', email: '', address: '' },
    vehicle: { year: '', make: '', model: '', vin: '', licensePlate: '', mileage: '', engine: '', serviceAdvisor: '' },
    laborItems: [],
    partItems: [],
    settings: {
      taxRate: 0, taxLabor: false, discountType: 'percent', discountValue: 0,
      shopSuppliesRate: 0, shopSuppliesCap: 0, hazardousWasteFee: 0, travelFee: 0, miscFee: 0,
    },
    notes: { customerNotes: '', termsAndConditions: '' },
  };
  const out: Invoice = {
    ...base,
    ...(source as Partial<Invoice>),
    meta: { ...base.meta, ...(source.meta || {}) },
    shop: { ...base.shop, ...(source.shop || {}) },
    customer: { ...base.customer, ...(source.customer || {}) },
    vehicle: { ...base.vehicle, ...(source.vehicle || {}) },
    laborItems: cloneItems(source.laborItems),
    partItems: cloneItems(source.partItems),
    settings: { ...base.settings, ...(source.settings || {}) },
    notes: { ...base.notes, ...(source.notes || {}) },
  };
  return out;
}

export function addLaborItem(invoice: Invoice, item: Partial<LaborItem> = {}): Invoice {
  const laborItem: LaborItem = { description: '', technician: '', hours: 0, rate: 0, ...item, id: item.id || createId('labor') };
  return { ...invoice, laborItems: [...cloneItems(invoice.laborItems), laborItem] };
}

export function updateLaborItem(invoice: Invoice, id: string, patch: Partial<LaborItem> = {}): Invoice {
  return { ...invoice, laborItems: cloneItems(invoice.laborItems).map(item => (item.id === id ? { ...item, ...patch, id: item.id } : item)) };
}

export function removeLaborItem(invoice: Invoice, id: string): Invoice {
  return { ...invoice, laborItems: cloneItems(invoice.laborItems).filter(item => item.id !== id) };
}

export function addPartItem(invoice: Invoice, item: Partial<PartItem> = {}): Invoice {
  const partItem: PartItem = { partNumber: '', description: '', quantity: 0, unitPrice: 0, ...item, id: item.id || createId('part') };
  return { ...invoice, partItems: [...cloneItems(invoice.partItems), partItem] };
}

export function updatePartItem(invoice: Invoice, id: string, patch: Partial<PartItem> = {}): Invoice {
  return { ...invoice, partItems: cloneItems(invoice.partItems).map(item => (item.id === id ? { ...item, ...patch, id: item.id } : item)) };
}

export function removePartItem(invoice: Invoice, id: string): Invoice {
  return { ...invoice, partItems: cloneItems(invoice.partItems).filter(item => item.id !== id) };
}
