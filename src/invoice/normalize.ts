import { createId } from './model';
import { DISCOUNT_TYPES, DOC_TYPES, FEE_KINDS, FIELD_TYPES, INVOICE_STATUSES, type DetailField, type FeeLine, type GeBlock, type Invoice, type InvoiceDetails, type LaborItem, type PartItem } from './types';

/**
 * `normalizeInvoice` is the single gate for every invoice that did not come from this editor: files the user imports,
 * invoices on jobs they joined, and anything an agent writes (docs/DOCUMENTATION.md §13.6, T1). It never throws, always returns a complete,
 * well-typed invoice, and guarantees the math in `totals.ts` and the PDF writer can run on it:
 *
 *   - numbers are coerced and clamped (NaN / strings / Infinity / negatives become safe values),
 *   - `status`, `docType`, `discountType`, `layout` are restricted to their allow-lists,
 *   - strings are length-capped with control characters removed, arrays are capped,
 *   - unknown keys are dropped at every level (except the sanitized `ge` namespace, kept only when `keepGe` is set).
 *
 * React escapes text, so no markup injection is possible; this protects the arithmetic and the size limits.
 * Pure and DOM-free: the server uses the same module for agent writes (plan C8).
 */

export const LIMITS = {
  maxMoney: 1_000_000_000,
  maxHours: 100_000,
  maxQuantity: 1_000_000,
  maxLines: 500, maxFees: 20, maxFields: 30,
  name: 200, phone: 50, email: 254, address: 500, shortField: 100,
  description: 1000, notes: 5000, terms: 20_000,
  id: 64,
  importBytes: 2_000_000,
  geBytes: 64_000, geDepth: 6, geKeys: 100, geArray: 500, geString: 5000,
} as const;

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const CONTROL_NO_NEWLINE = /[\u0000-\u001F\u007F]/g;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Strings stay strings; finite numbers (year, mileage typed as numbers in old files) become their text; everything else is ''. */
function str(v: unknown, max: number, multiline = false): string {
  let s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  s = s.replace(multiline ? CONTROL : CONTROL_NO_NEWLINE, multiline ? '' : ' ');
  return s.length > max ? s.slice(0, max) : s;
}

function num(v: unknown, max: number, min = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : 0;
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

const bool = (v: unknown) => v === true || v === 'true' || v === 1;
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback;

function isoDate(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? '' : v;
}

function lines<T extends { id: string }>(raw: unknown, make: (o: Record<string, unknown>, id: string) => T, prefix: string): T[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of raw.slice(0, LIMITS.maxLines)) {
    const o = isObj(entry) ? entry : {};
    let id = typeof o.id === 'string' && /^[\w.:-]{1,64}$/.test(o.id) ? o.id : '';
    if (!id || seen.has(id)) id = createId(prefix);
    seen.add(id);
    out.push(make(o, id));
  }
  return out;
}

const FIELD_KEY = /^[a-z][a-z0-9_]{0,30}$/;

export function normalizeFees(raw: unknown): FeeLine[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.slice(0, LIMITS.maxFees).map(entry => {
    const o = isObj(entry) ? entry : {};
    let id = typeof o.id === 'string' && /^[\w.:-]{1,64}$/.test(o.id) ? o.id : '';
    if (!id || seen.has(id)) id = createId('fee');
    seen.add(id);
    const kind = oneOf(o.kind, FEE_KINDS, 'flat');
    return { id, label: str(o.label, 60) || 'Fee', kind, value: num(o.value, kind === 'flat' ? LIMITS.maxMoney : 100), cap: num(o.cap, LIMITS.maxMoney), taxable: bool(o.taxable) };
  });
}

export function normalizeDetails(raw: unknown): InvoiceDetails | undefined {
  if (!isObj(raw)) return undefined;
  const seen = new Set<string>();
  const fields: DetailField[] = [];
  for (const entry of (Array.isArray(raw.fields) ? raw.fields : []).slice(0, LIMITS.maxFields)) {
    const o = isObj(entry) ? entry : {};
    const key = typeof o.key === 'string' && FIELD_KEY.test(o.key) ? o.key : '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fields.push({ key, label: str(o.label, 60) || key, type: oneOf(o.type, FIELD_TYPES, 'text'), value: str(o.value, 200) });
  }
  return { title: str(raw.title, 60) || 'Details', fields };
}

/** Copies JSON-safe data only: bounded depth, keys, array length and string length; no prototype-polluting keys. */
function sanitizeJson(v: unknown, depth: number): unknown {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.length > LIMITS.geString ? v.slice(0, LIMITS.geString) : v;
  if (depth >= LIMITS.geDepth) return null;
  if (Array.isArray(v)) return v.slice(0, LIMITS.geArray).map(x => sanitizeJson(x, depth + 1));
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).slice(0, LIMITS.geKeys)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = sanitizeJson(v[k], depth + 1);
    }
    return out;
  }
  return null; // undefined, functions, symbols, bigint
}

function sanitizeGe(v: unknown): GeBlock | undefined {
  if (!isObj(v)) return undefined;
  const clean = sanitizeJson(v, 0) as GeBlock;
  return JSON.stringify(clean).length > LIMITS.geBytes ? undefined : clean;
}

export interface NormalizeOptions {
  /** Keep the (sanitized) `ge` namespace. Off for files and foreign invoices; on for GE's own records. */
  keepGe?: boolean;
}

export function normalizeInvoice(raw: unknown, opts: NormalizeOptions = {}): Invoice {
  const r = isObj(raw) ? raw : {};
  const meta = isObj(r.meta) ? r.meta : {};
  const shop = isObj(r.shop) ? r.shop : {};
  const customer = isObj(r.customer) ? r.customer : {};
  const vehicle = isObj(r.vehicle) ? r.vehicle : {};
  const settings = isObj(r.settings) ? r.settings : {};
  const notes = isObj(r.notes) ? r.notes : {};
  const discountType = oneOf(settings.discountType, DISCOUNT_TYPES, 'percent');

  const out: Invoice = {
    meta: {
      invoiceNumber: str(meta.invoiceNumber, LIMITS.shortField),
      // Deterministic on purpose: a missing or invalid date stays blank rather than becoming "today".
      date: isoDate(meta.date),
      dueDate: isoDate(meta.dueDate),
      status: oneOf(meta.status, INVOICE_STATUSES, 'Draft'),
      docType: oneOf(meta.docType, DOC_TYPES, 'invoice'),
      layout: meta.layout === 2 ? 2 : 1,
    },
    shop: {
      name: str(shop.name, LIMITS.name), address: str(shop.address, LIMITS.address), phone: str(shop.phone, LIMITS.phone),
      email: str(shop.email, LIMITS.email), licenseNumber: str(shop.licenseNumber, LIMITS.shortField),
    },
    customer: { name: str(customer.name, LIMITS.name), phone: str(customer.phone, LIMITS.phone), email: str(customer.email, LIMITS.email), address: str(customer.address, LIMITS.address) },
    vehicle: {
      year: str(vehicle.year, 10), make: str(vehicle.make, LIMITS.shortField), model: str(vehicle.model, LIMITS.shortField), vin: str(vehicle.vin, 40),
      licensePlate: str(vehicle.licensePlate, 20), mileage: str(vehicle.mileage, 20), engine: str(vehicle.engine, LIMITS.shortField), serviceAdvisor: str(vehicle.serviceAdvisor, LIMITS.name),
    },
    laborItems: lines<LaborItem>(r.laborItems, (o, id) => ({
      id, description: str(o.description, LIMITS.description), technician: str(o.technician, LIMITS.name),
      hours: num(o.hours, LIMITS.maxHours), rate: num(o.rate, LIMITS.maxMoney),
    }), 'labor'),
    partItems: lines<PartItem>(r.partItems, (o, id) => ({
      id, partNumber: str(o.partNumber, LIMITS.shortField), description: str(o.description, LIMITS.description),
      quantity: num(o.quantity, LIMITS.maxQuantity), unitPrice: num(o.unitPrice, LIMITS.maxMoney),
    }), 'part'),
    settings: {
      taxRate: num(settings.taxRate, 100),
      taxLabor: bool(settings.taxLabor),
      discountType,
      discountValue: num(settings.discountValue, discountType === 'percent' ? 100 : LIMITS.maxMoney),
      shopSuppliesRate: num(settings.shopSuppliesRate, 100),
      shopSuppliesCap: num(settings.shopSuppliesCap, LIMITS.maxMoney),
      hazardousWasteFee: num(settings.hazardousWasteFee, LIMITS.maxMoney),
      travelFee: num(settings.travelFee, LIMITS.maxMoney),
      miscFee: num(settings.miscFee, LIMITS.maxMoney),
    },
    notes: { customerNotes: str(notes.customerNotes, LIMITS.notes, true), termsAndConditions: str(notes.termsAndConditions, LIMITS.terms, true) },
  };
  if (Array.isArray(r.fees)) out.fees = normalizeFees(r.fees);
  const details = normalizeDetails(r.details);
  if (details) out.details = details;
  if (opts.keepGe) {
    const ge = sanitizeGe(r.ge);
    if (ge) out.ge = ge;
  }
  return out;
}

/** The plain invoice JSON a user can keep (the document itself). */
export function exportInvoiceJson(invoice: Invoice, { includeGe = false } = {}): string {
  const { ge, ...plain } = invoice;
  return JSON.stringify(includeGe && ge ? { ...plain, ge } : plain, null, 2);
}

/**
 * Parses a user-chosen file. Throws an Error with a friendly message for bad input; otherwise returns a normalized invoice
 * with the `ge` namespace stripped (an import always becomes a new record).
 */
export function importInvoiceJson(text: string): Invoice {
  if (typeof text !== 'string' || text.length > LIMITS.importBytes) throw new Error('Invoice JSON is too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Invalid invoice JSON.'); }
  if (!isObj(parsed)) throw new Error('Invoice JSON must contain an invoice object.');
  return normalizeInvoice(parsed, { keepGe: false });
}
