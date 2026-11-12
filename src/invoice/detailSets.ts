import { fieldValue } from './prefill';
import type { JobIntake } from './intake';
import { detailSetFor, type DetailSet, type InvoicingSettings } from './settings';
import type { DetailField, Invoice } from './types';

/**
 * Applying the user's detail-field presets to a document (docs/DOCUMENTATION.md §13.5 and §13.7). Pure.
 *
 * A document has one detail box. Applying a preset gives it that preset's title and fields. Values already on the document are kept (by
 * field key), blanks are filled from the job's intake and the field defaults, and anything the user typed into a field the new preset does
 * not have is kept below it, so applying a preset never throws away information.
 */

const LEGACY_LABELS: Array<[string, string, DetailField['type']]> = [
  ['year', 'Year', 'text'], ['make', 'Make', 'text'], ['model', 'Model', 'text'], ['vin', 'VIN', 'vin'],
  ['license_plate', 'License Plate', 'text'], ['mileage', 'Mileage', 'text'], ['engine', 'Engine / Trim', 'text'], ['service_advisor', 'Service Advisor', 'text'],
];

/** What the document currently holds: its own box, or (original format) the fixed vehicle box expressed as detail fields. */
export function currentDetailFields(inv: Invoice): DetailField[] {
  if (inv.details) return inv.details.fields;
  const v = (inv.vehicle ?? {}) as unknown as Record<string, string>;
  const byKey: Record<string, string> = { year: v.year, make: v.make, model: v.model, vin: v.vin, license_plate: v.licensePlate, mileage: v.mileage, engine: v.engine, service_advisor: v.serviceAdvisor };
  return LEGACY_LABELS.map(([key, label, type]) => ({ key, label, type, value: (byKey[key] ?? '').trim() })).filter(f => f.value !== '');
}

/** The document with `set`'s title and fields in its box (see the module comment for what is kept). */
export function applyDetailSet(inv: Invoice, set: DetailSet, intake: JobIntake | null = null): Invoice {
  const have = new Map(currentDetailFields(inv).map(f => [f.key, f]));
  const keys = new Set(set.fields.map(f => f.key));
  const fields: DetailField[] = set.fields.map(def => {
    const mine = have.get(def.key)?.value ?? '';
    return { key: def.key, label: def.label, type: def.type, value: mine.trim() !== '' ? mine : fieldValue(intake, def).value };
  });
  const kept = [...have.values()].filter(f => !keys.has(f.key) && f.value.trim() !== '');
  return { ...inv, details: { title: set.title, setId: set.id, fields: [...fields, ...kept].slice(0, 30) } };
}

/**
 * Applies the set linked to this job's number (see `detailSetFor`) when the document has no filled-in box yet. Never replaces a box that
 * already has fields, so it is safe to run every time a document opens. Returns the same object when nothing applies.
 */
export function autoApplyDetailSet(inv: Invoice, settings: InvoicingSettings, candidates: ReadonlyArray<string | null | undefined>, intake: JobIntake | null = null): { invoice: Invoice; set: DetailSet | null } {
  if (inv.details && inv.details.fields.length > 0) return { invoice: inv, set: null };
  const set = detailSetFor(settings.detailSets, [inv.meta.invoiceNumber, ...candidates]);
  if (!set || set.fields.length === 0) return { invoice: inv, set: null };
  return { invoice: applyDetailSet(inv, set, intake), set };
}
