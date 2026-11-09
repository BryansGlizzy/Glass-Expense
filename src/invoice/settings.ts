import type { DeepPartial, PdfLabels, SheetLabels } from './labels';
import { isLogoDataUrl } from './logo';
import { FEE_KINDS, FIELD_TYPES, type FeeKind, type FieldType } from './types';

/**
 * The user's invoicing settings (docs/INVOICING_PLAN.md §5.6): shop profile, hourly rate, **user-defined fees**, **user-defined detail
 * fields**, tax, defaults, terms, payment methods, e-mail and automation. Stored inside the existing encrypted `invoice_template` blob
 * under `invoicing`. Every value is per user and nothing is inherited from the upstream app (plan D4). Pure, DOM-free.
 *
 * Fees and detail fields are data, not code, so any trade can describe its own paperwork (a plumber's "Trip charge", a photographer's
 * "Venue", a mechanic's "Year / Make / Model"). A website or agent fills a detail field by posting a value under the field's `key`,
 * and a fee's amount can follow a variable the website posts (`quoteKey`).
 */

export const PAYMENT_METHOD_KEYS = ['paypal', 'venmo', 'cashapp', 'zelle', 'cash', 'check', 'other'] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];
export interface PaymentMethod { enabled: boolean; label: string; handle: string; note: string }

export interface WebsiteQuote { hourlyRate: number | null; baseFee: number | null; variables: Record<string, number>; at: string }

/** A fee the user defined. `auto` adds it to every new document; `quoteKey` names a website variable that overrides `value` (e.g. `base_fee`). */
export interface FeeTemplate { id: string; label: string; kind: FeeKind; value: number; cap: number; taxable: boolean; auto: boolean; quoteKey: string }
/** A detail field the user defined. `key` is the API variable that fills it (`fields.<key>` in an agent request). */
export interface FieldDef { key: string; label: string; type: FieldType; default: string }

export interface InvoicingSettings {
  schema: 2;
  /** `logo` is a small baseline JPEG data URL made from the user's upload (see logoUpload.ts); '' = none. */
  shop: { name: string; address: string; phone: string; email: string; licenseNumber: string; logo: string };
  /** Prefix of the job invoice numbers, e.g. INV gives INV-A00001. */
  numbering: { prefix: string };
  rates: {
    hourlyRate: number;
    /** When on, the latest rate and fee variables the website posted override your own for new documents (plan D3). */
    followWebsite: boolean;
    websiteQuote: WebsiteQuote | null;
  };
  fees: FeeTemplate[];
  details: { title: string; fields: FieldDef[] };
  /** rate 0 = no sales tax (the default). `incomeMode` decides how a payment on a taxed invoice becomes an income entry. */
  tax: { rate: number; taxLabor: boolean; incomeMode: 'exclude' | 'include' };
  defaults: { estimateValidDays: number; dueDays: number; discountType: 'percent' | 'fixed'; discountValue: number; /** New documents use the opt-in hardened layout (real font metrics, wrapped lines, rounding per line). Pinned per invoice by meta.layout. */ layout2: boolean };
  terms: { customerNotes: string; estimateTerms: string; invoiceTerms: string; estimateSignature: string; invoiceSignature: string; /** Appended to the terms when the customer supplies their own parts. Empty = nothing added. */ ownPartsClause: string };
  payments: Record<PaymentMethodKey, PaymentMethod>;
  email: { enabled: boolean; replyTo: string; bccMe: boolean; subject: string; body: string };
  automation: { autoDraft: boolean; requireVerification: boolean };
}

const money = (max = 1_000_000_000) => (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : fallback;
};
const num = money();
const pct = money(100);
const days = money(3650);
const str = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max) : fallback);
const bool = (v: unknown, fallback = false) => (typeof v === 'boolean' ? v : fallback);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => ((allowed as readonly string[]).includes(v as string) ? (v as T) : fallback);

const METHOD_LABELS: Record<PaymentMethodKey, string> = { paypal: 'PayPal', venmo: 'Venmo', cashapp: 'Cash App', zelle: 'Zelle', cash: 'Cash', check: 'Check', other: 'Other' };

export const DEFAULT_EMAIL_SUBJECT = '{{docTitle}} {{invoice.number}} from {{shop.name}}';
export const DEFAULT_EMAIL_BODY = 'Hi {{customer.firstName}},\n\nPlease find your {{docTitle}} {{invoice.number}} attached. The total is {{total}}.\n\n{{payOptions}}\n\nThank you,\n{{shop.name}}\n{{shop.phone}}';

/** Detail-field presets. "Automotive" is one example; the user can build any set. Keys match what a mechanic's website posts as `vehicle`. */
export const FIELD_PRESETS: Record<string, { title: string; fields: FieldDef[] }> = {
  automotive: {
    title: 'Vehicle Details',
    fields: [
      { key: 'year', label: 'Year', type: 'text', default: '' }, { key: 'make', label: 'Make', type: 'text', default: '' }, { key: 'model', label: 'Model', type: 'text', default: '' },
      { key: 'vin', label: 'VIN', type: 'vin', default: '' }, { key: 'license_plate', label: 'License Plate', type: 'text', default: '' }, { key: 'mileage', label: 'Mileage', type: 'text', default: '' },
      { key: 'engine', label: 'Engine / Trim', type: 'text', default: '' }, { key: 'service_advisor', label: 'Service Advisor', type: 'text', default: '' },
    ],
  },
};

/** Turns a label into a field key / variable name. */
export const slugKey = (label: string): string => {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  return /^[a-z]/.test(s) ? s : s ? `f_${s}`.slice(0, 31) : '';
};

export function defaultSettings(): InvoicingSettings {
  return {
    schema: 2,
    shop: { name: '', address: '', phone: '', email: '', licenseNumber: '', logo: '' },
    numbering: { prefix: 'INV' },
    rates: { hourlyRate: 0, followWebsite: true, websiteQuote: null },
    fees: [],
    details: { title: 'Job Details', fields: [] },
    tax: { rate: 0, taxLabor: false, incomeMode: 'exclude' },
    defaults: { estimateValidDays: 15, dueDays: 0, discountType: 'percent', discountValue: 0, layout2: false },
    terms: { customerNotes: '', estimateTerms: '', invoiceTerms: '', estimateSignature: '', invoiceSignature: '', ownPartsClause: '' },
    payments: Object.fromEntries(PAYMENT_METHOD_KEYS.map(k => [k, { enabled: false, label: METHOD_LABELS[k], handle: '', note: '' }])) as Record<PaymentMethodKey, PaymentMethod>,
    email: { enabled: false, replyTo: '', bccMe: false, subject: DEFAULT_EMAIL_SUBJECT, body: DEFAULT_EMAIL_BODY },
    automation: { autoDraft: true, requireVerification: false },
  };
}

let feeSeq = 0;
const newFeeId = () => `fee-${Date.now().toString(36)}-${(++feeSeq).toString(36)}`;
export { newFeeId };

function normalizeFees(raw: unknown): FeeTemplate[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).slice(0, 20).map(entry => {
    const o = isObj(entry) ? entry : {};
    let id = typeof o.id === 'string' && /^[\w.:-]{1,64}$/.test(o.id) ? o.id : '';
    if (!id || seen.has(id)) id = newFeeId();
    seen.add(id);
    const kind = oneOf(o.kind, FEE_KINDS, 'flat');
    const quoteKey = typeof o.quoteKey === 'string' && /^[a-z][a-z0-9_]{0,40}$/i.test(o.quoteKey) ? o.quoteKey : '';
    return { id, label: str(o.label, 60) || 'Fee', kind, value: kind === 'flat' ? num(o.value) : pct(o.value), cap: num(o.cap), taxable: bool(o.taxable), auto: bool(o.auto, true), quoteKey };
  });
}

function normalizeFields(raw: unknown): FieldDef[] {
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const entry of (Array.isArray(raw) ? raw : []).slice(0, 30)) {
    const o = isObj(entry) ? entry : {};
    const label = str(o.label, 60).trim();
    let key = typeof o.key === 'string' && /^[a-z][a-z0-9_]{0,30}$/.test(o.key) ? o.key : slugKey(label);
    if (!key) continue;
    while (seen.has(key)) key = `${key.slice(0, 28)}_${seen.size}`;
    seen.add(key);
    out.push({ key, label: label || key, type: oneOf(o.type, FIELD_TYPES, 'text'), default: str(o.default, 200) });
  }
  return out;
}

/** The fees an older settings object (fixed travel / supplies / hazmat / misc fields) would have had, as user-defined fees. */
function legacyFees(rates: Record<string, unknown>, labels: Record<string, unknown>): FeeTemplate[] {
  const out: FeeTemplate[] = [];
  const label = (k: string, fb: string) => str(labels[k], 60, fb) || fb;
  if (num(rates.baseFee) > 0) out.push({ id: newFeeId(), label: label('travel', 'Travel Fee'), kind: 'flat', value: num(rates.baseFee), cap: 0, taxable: false, auto: true, quoteKey: 'base_fee' });
  if (pct(rates.shopSuppliesRate) > 0) out.push({ id: newFeeId(), label: label('shopSupplies', 'Shop Supplies Fee'), kind: 'percentOfLabor', value: pct(rates.shopSuppliesRate), cap: num(rates.shopSuppliesCap), taxable: false, auto: true, quoteKey: '' });
  if (num(rates.hazardousWasteFee) > 0) out.push({ id: newFeeId(), label: label('hazardousWaste', 'Hazardous Waste Fee'), kind: 'flat', value: num(rates.hazardousWasteFee), cap: 0, taxable: false, auto: true, quoteKey: '' });
  if (num(rates.miscFee) > 0) out.push({ id: newFeeId(), label: label('misc', 'Misc. Fee'), kind: 'flat', value: num(rates.miscFee), cap: 0, taxable: false, auto: true, quoteKey: '' });
  return out;
}

/** Coerces anything stored (or imported, or an older shape) into a complete, bounded settings object. */
export function normalizeSettings(raw: unknown): InvoicingSettings {
  const d = defaultSettings();
  const r = isObj(raw) ? raw : {};
  const o = (k: string): Record<string, unknown> => (isObj(r[k]) ? (r[k] as Record<string, unknown>) : {});
  const shop = o('shop'), rates = o('rates'), tax = o('tax'), def = o('defaults'), terms = o('terms'), email = o('email'), auto = o('automation'), pay = o('payments'), numbering = o('numbering'), details = o('details');

  const wq = isObj(rates.websiteQuote) ? rates.websiteQuote : null;
  const variables: Record<string, number> = {};
  if (wq && isObj(wq.variables)) for (const k of Object.keys(wq.variables).slice(0, 30)) if (/^[a-z][a-z0-9_]{0,40}$/i.test(k)) variables[k] = num(wq.variables[k]);

  const payments = { ...d.payments };
  for (const k of PAYMENT_METHOD_KEYS) {
    const m = isObj(pay[k]) ? (pay[k] as Record<string, unknown>) : {};
    payments[k] = { enabled: bool(m.enabled), label: str(m.label, 40, METHOD_LABELS[k]) || METHOD_LABELS[k], handle: str(m.handle, 200), note: str(m.note, 500) };
  }

  // Settings saved before user-defined fees existed carried four fixed fee fields; they become ordinary fees once.
  const fees = r.fees === undefined ? legacyFees(rates, o('feeLabels')) : normalizeFees(r.fees);
  const prefix = (typeof numbering.prefix === 'string' ? numbering.prefix : 'INV').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase().slice(0, 20) || 'INV';

  return {
    schema: 2,
    shop: { name: str(shop.name, 200), address: str(shop.address, 500), phone: str(shop.phone, 50), email: str(shop.email, 254), licenseNumber: str(shop.licenseNumber, 100), logo: isLogoDataUrl(shop.logo) ? shop.logo : '' },
    numbering: { prefix },
    rates: {
      hourlyRate: num(rates.hourlyRate), followWebsite: bool(rates.followWebsite, d.rates.followWebsite),
      websiteQuote: wq ? { hourlyRate: wq.hourlyRate == null ? null : num(wq.hourlyRate), baseFee: wq.baseFee == null ? null : num(wq.baseFee), variables, at: str(wq.at, 40) } : null,
    },
    fees,
    details: { title: str(details.title, 60, d.details.title) || d.details.title, fields: normalizeFields(details.fields) },
    tax: { rate: pct(tax.rate), taxLabor: bool(tax.taxLabor), incomeMode: tax.incomeMode === 'include' ? 'include' : 'exclude' },
    defaults: {
      estimateValidDays: days(def.estimateValidDays, d.defaults.estimateValidDays), dueDays: days(def.dueDays, d.defaults.dueDays),
      discountType: def.discountType === 'fixed' ? 'fixed' : 'percent', discountValue: def.discountType === 'fixed' ? num(def.discountValue) : pct(def.discountValue), layout2: bool(def.layout2),
    },
    terms: {
      customerNotes: str(terms.customerNotes, 5000), estimateTerms: str(terms.estimateTerms, 20000), invoiceTerms: str(terms.invoiceTerms, 20000),
      estimateSignature: str(terms.estimateSignature, 1000), invoiceSignature: str(terms.invoiceSignature, 1000), ownPartsClause: str(terms.ownPartsClause, 2000),
    },
    payments,
    email: { enabled: bool(email.enabled), replyTo: str(email.replyTo, 254), bccMe: bool(email.bccMe), subject: str(email.subject, 300, d.email.subject) || d.email.subject, body: str(email.body, 5000, d.email.body) || d.email.body },
    automation: { autoDraft: bool(auto.autoDraft, d.automation.autoDraft), requireVerification: bool(auto.requireVerification) },
  };
}

/** The hourly rate new documents start from: the website's latest quote wins while "follow website" is on (plan D3). */
export function effectiveRates(s: InvoicingSettings): { hourlyRate: number; fromWebsite: boolean } {
  const q = s.rates.websiteQuote;
  if (s.rates.followWebsite && q && q.hourlyRate != null) return { hourlyRate: q.hourlyRate, fromWebsite: true };
  return { hourlyRate: s.rates.hourlyRate, fromWebsite: false };
}

/** Looks a variable up in a website quote: `base_fee` is the quote's base fee, anything else a named variable. */
export function quoteVariable(q: { baseFee?: number | null; variables?: Record<string, number> } | null | undefined, key: string): number | undefined {
  if (!q || !key) return undefined;
  if (key === 'base_fee') return q.baseFee == null ? undefined : q.baseFee;
  const v = q.variables?.[key];
  return typeof v === 'number' ? v : undefined;
}

/** PDF labels derived from the user's settings (signature text, footer brand). The structure of the PDF does not change. */
export function pdfLabelsFor(s: InvoicingSettings): DeepPartial<PdfLabels> {
  return { signatureText: { invoice: s.terms.invoiceSignature, estimate: s.terms.estimateSignature }, footerBrand: s.shop.name };
}

export function sheetLabelsFor(s: InvoicingSettings): DeepPartial<SheetLabels> {
  return { signatureText: { invoice: s.terms.invoiceSignature, estimate: s.terms.estimateSignature } };
}
