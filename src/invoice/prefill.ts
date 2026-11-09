import { addPartItem, createEmptyInvoice, createId, todayIso } from './model';
import { displayPhone, type IntakeWarning, type JobIntake } from './intake';
import { effectiveRates, quoteVariable, type InvoicingSettings } from './settings';
import type { DetailField, DocType, FeeLine, Invoice } from './types';

/**
 * Builds a new document from a job, its intake and the user's settings (docs/INVOICING_PLAN.md §5.9). Pure.
 *
 * The first non-empty source wins. The website is the source of truth for rates (D3): a posted `quote` beats Settings, and every
 * resulting value stays editable per invoice. Fees come from the user's own fee list (those marked "add to every new document"); a fee
 * whose `quoteKey` matches a variable the website posted takes that amount. Detail fields come from the user's own field list, each
 * filled from the intake by its `key`. Nothing here comes from the upstream app (D4). The result records WHERE values came from
 * (`provenance`) and a snapshot of what was filled, so "Refresh from job" can update only fields the user has not edited.
 */

export interface JobLike {
  id: string;
  title?: string;
  client_name?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  client_address?: string | null;
  invoice_number?: string | null;
  invoice_notes?: string | null;
  job_rate?: number | null;
}

export type Provenance = 'job' | 'intake' | 'website' | 'settings' | 'default';
export interface PrefillResult { invoice: Invoice; provenance: Record<string, Provenance>; warnings: IntakeWarning[] }

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
const first = <T,>(...candidates: Array<[T | null | undefined | '', Provenance]>): [T | '', Provenance] => {
  for (const [v, p] of candidates) if (v !== null && v !== undefined && v !== '') return [v as T, p];
  return ['', 'default'];
};

/** Vehicle values a mechanic's website posts as `vehicle{...}`: they fill detail fields with the same keys. */
const vehicleValue = (v: JobIntake['vehicle'], key: string): string => {
  if (!v) return '';
  const x = (({ year: v.year, make: v.make, model: v.model, engine: v.engine, vin: v.vin }) as Record<string, unknown>)[key];
  return x === undefined || x === null ? '' : String(x);
};

/** The value for one detail field: the intake's `fields[key]`, a matching vehicle value, an unlabelled "Label: value" from the text, then the field's default. */
export function fieldValue(intake: JobIntake | null, def: { key: string; label: string; default: string }): { value: string; source: Provenance } {
  const fromFields = intake?.fields?.[def.key];
  if (fromFields) return { value: fromFields, source: 'intake' };
  const fromVehicle = vehicleValue(intake?.vehicle, def.key);
  if (fromVehicle) return { value: fromVehicle, source: 'intake' };
  if (intake) for (const [k, v] of Object.entries(intake.extra)) if (v && (k.toLowerCase() === def.label.toLowerCase() || k.toLowerCase() === def.key)) return { value: v, source: 'intake' };
  return { value: def.default, source: def.default ? 'settings' : 'default' };
}

export function buildNewInvoice(opts: {
  job: JobLike | null; intake?: JobIntake | null; settings: InvoicingSettings; docType?: DocType; now?: Date;
}): PrefillResult {
  const { job, settings, now = new Date() } = opts;
  const intake = opts.intake ?? null;
  const docType: DocType = opts.docType ?? 'estimate';
  const today = todayIso(now);
  const prov: Record<string, Provenance> = {};
  const take = <T,>(path: string, ...c: Array<[T | null | undefined | '', Provenance]>): T | '' => { const [v, p] = first<T>(...c); prov[path] = p; return v; };

  const rates = effectiveRates(settings);
  const quote = intake?.quote;
  const websiteQuote = settings.rates.followWebsite ? settings.rates.websiteQuote : null;
  const hourly = take<number>('rates.hourly', [quote?.hourlyRate, 'website'], [job?.job_rate && job.job_rate > 0 ? job.job_rate : null, 'job'], [rates.hourlyRate > 0 ? rates.hourlyRate : null, rates.fromWebsite ? 'website' : 'settings']);
  const taxRate = take<number>('settings.taxRate', [quote?.variables?.tax_rate, 'website'], [settings.tax.rate > 0 ? settings.tax.rate : null, 'settings']);

  // Fees: the user's own list. A fee follows a website variable when it names one (this job's quote first, then the latest quote seen).
  const fees: FeeLine[] = settings.fees.filter(t => t.auto).map(t => {
    const jobValue = t.quoteKey ? quoteVariable(quote, t.quoteKey) : undefined;
    const siteValue = t.quoteKey ? quoteVariable(websiteQuote, t.quoteKey) : undefined;
    const value = jobValue ?? siteValue ?? t.value;
    prov[`fees.${t.id}`] = jobValue !== undefined || siteValue !== undefined ? 'website' : 'settings';
    return { id: createId('fee'), label: t.label, kind: t.kind, value, cap: t.cap, taxable: t.taxable };
  });

  // Detail fields: the user's own list, each filled by its key.
  const fields: DetailField[] = settings.details.fields.map(def => {
    const v = fieldValue(intake, def); prov[`details.${def.key}`] = v.source;
    return { key: def.key, label: def.label, type: def.type, value: v.value };
  });

  const ownPartsClause = intake?.partsPolicy === 'own-parts' ? settings.terms.ownPartsClause : '';
  const baseTerms = docType === 'estimate' ? settings.terms.estimateTerms : settings.terms.invoiceTerms;
  const terms = [baseTerms, ownPartsClause].filter(Boolean).join('\n\n');

  const dueDays = docType === 'estimate' ? settings.defaults.estimateValidDays : settings.defaults.dueDays;
  const invoice = createEmptyInvoice({
    meta: {
      invoiceNumber: String(take('meta.invoiceNumber', [job?.invoice_number, 'job'])), date: today, dueDate: dueDays > 0 ? addDays(today, dueDays) : '',
      status: docType === 'estimate' ? 'Estimate' : 'Draft', docType, layout: settings.defaults.layout2 ? 2 : 1,
    },
    shop: { name: settings.shop.name, address: settings.shop.address, phone: settings.shop.phone, email: settings.shop.email, licenseNumber: settings.shop.licenseNumber },
    customer: {
      name: String(take('customer.name', [intake?.contact.name, 'intake'], [job?.client_name, 'job'])),
      phone: String(take('customer.phone', [intake?.contact.phone ? displayPhone(intake.contact.phone) : '', 'intake'], [job?.client_phone, 'job'])),
      email: String(take('customer.email', [intake?.contact.email, 'intake'], [job?.client_email, 'job'])),
      address: String(take('customer.address', [job?.client_address, 'job'], [intake?.location?.raw, 'intake'])),
    },
    settings: {
      taxRate: Number(taxRate) || 0, taxLabor: settings.tax.taxLabor, discountType: settings.defaults.discountType, discountValue: settings.defaults.discountValue,
      shopSuppliesRate: 0, shopSuppliesCap: 0, hazardousWasteFee: 0, travelFee: 0, miscFee: 0,
    },
    notes: {
      customerNotes: String(take('notes.customerNotes', [job?.invoice_notes, 'job'], [intake?.symptoms, 'intake'], [settings.terms.customerNotes, 'settings'])),
      termsAndConditions: take('notes.termsAndConditions', [terms, 'settings']) as string,
    },
  }, now);
  invoice.fees = fees;                                    // dynamic fees mode
  invoice.details = { title: settings.details.title, fields };

  // What was filled, so a later refresh only touches fields the user has not changed since.
  invoice.ge = { prefill: { at: now.toISOString(), hourlyRate: Number(hourly) || 0, rateSource: prov['rates.hourly'], snapshot: prefillSnapshot(invoice), jobId: job?.id ?? null } };
  return { invoice, provenance: prov, warnings: intake?.warnings ?? [] };
}

const PATHS = ['meta.invoiceNumber', 'customer.name', 'customer.phone', 'customer.email', 'customer.address', 'settings.taxRate', 'notes.customerNotes', 'notes.termsAndConditions'] as const;

const getPath = (inv: Invoice, path: string): unknown => {
  if (path.startsWith('details.')) return inv.details?.fields.find(f => f.key === path.slice(8))?.value;
  return path.split('.').reduce<any>((o, k) => (o ? o[k] : undefined), inv);
};
const setPath = (inv: Invoice, path: string, value: unknown): Invoice => {
  if (path.startsWith('details.')) return inv.details ? { ...inv, details: { ...inv.details, fields: inv.details.fields.map(f => (f.key === path.slice(8) ? { ...f, value: String(value ?? '') } : f)) } } : inv;
  const [a, b] = path.split('.') as [keyof Invoice, string];
  return { ...inv, [a]: { ...(inv[a] as object), [b]: value } } as Invoice;
};
const pathsOf = (inv: Invoice): string[] => [...PATHS, ...(inv.details?.fields ?? []).map(f => `details.${f.key}`)];

export const prefillSnapshot = (inv: Invoice): Record<string, unknown> => Object.fromEntries(pathsOf(inv).map(p => [p, getPath(inv, p)]));

/**
 * "Refresh from job": takes `fresh` (a new prefill) and applies a value only where the user has NOT edited it since the last
 * prefill (current value still equals the stored snapshot). Never overwrites edits. Returns the new invoice and what changed.
 */
export function refreshFromJob(current: Invoice, fresh: Invoice): { invoice: Invoice; changed: string[] } {
  const snap = ((current.ge?.prefill as any)?.snapshot ?? {}) as Record<string, unknown>;
  let out = current; const changed: string[] = [];
  for (const p of pathsOf(fresh)) {
    if (p.startsWith('details.') && !current.details?.fields.some(f => f.key === p.slice(8))) continue;
    const mine = getPath(current, p), was = snap[p], now = getPath(fresh, p);
    if (mine === was && mine !== now) { out = setPath(out, p, now); changed.push(p); }
  }
  // Only refreshed fields get a new baseline; a field the user edited keeps its old one, so it is still recognised as edited next time.
  if (changed.length) out = { ...out, ge: { ...(out.ge || {}), prefill: { ...((out.ge?.prefill as object) || {}), snapshot: { ...snap, ...Object.fromEntries(changed.map(p => [p, getPath(out, p)])) } } } };
  return { invoice: out, changed };
}

export interface BillableExpense { id: string; amount: number; description: string | null; entry_type: string }

/** Part lines from a job's expenses with a markup %, never adding the same expense twice (ids kept in `ge.fromExpense`). */
export function partsFromExpenses(invoice: Invoice, expenses: BillableExpense[], markupPercent: number): Invoice {
  const used = new Set<string>(Array.isArray(invoice.ge?.fromExpense) ? (invoice.ge!.fromExpense as string[]) : []);
  const factor = 1 + Math.max(0, Math.min(1000, Number(markupPercent) || 0)) / 100;
  let out = invoice;
  for (const e of expenses) {
    if (e.entry_type === 'income' || used.has(e.id) || !(e.amount > 0)) continue;
    out = addPartItem(out, { description: e.description || 'Expense', quantity: 1, unitPrice: Math.round(e.amount * factor * 100) / 100 });
    used.add(e.id);
  }
  return { ...out, ge: { ...(out.ge || {}), fromExpense: [...used] } };
}
