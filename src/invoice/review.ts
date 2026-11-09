import { addEvent, geOf, withGe, type Actor } from './ge';
import { todayIso } from './model';
import { calculateTotals } from './totals';
import type { InvoicingSettings } from './settings';
import type { Invoice } from './types';

/**
 * Estimate → Final Invoice (docs/INVOICING_PLAN.md §5.10). Generation always yields an Estimate; this is the only way to a Final
 * invoice, and it records WHO confirmed (a person in the app, or an agent whose key has `invoices: finalize`).
 */

export class ConfirmError extends Error {}

export interface ChecklistItem { id: string; label: string; ok: boolean; detail?: string }

/** What a person should look at before confirming. Advisory: failing items warn, they do not block. */
export function reviewChecklist(invoice: Invoice): ChecklistItem[] {
  const t = calculateTotals(invoice);
  const ai = geOf(invoice).ai;
  const items: ChecklistItem[] = [
    { id: 'labor', label: 'Labor lines and actual hours', ok: invoice.laborItems.length > 0 && invoice.laborItems.every(l => l.hours > 0 && l.rate > 0), detail: invoice.laborItems.length ? undefined : 'No labor lines' },
    { id: 'parts', label: 'Parts used and their prices', ok: invoice.partItems.every(p => p.quantity > 0 && p.unitPrice >= 0 && p.description.trim() !== '') },
    { id: 'fees', label: 'Fees, discount and tax', ok: true, detail: `Total ${t.grandTotal.toFixed(2)}` },
    { id: 'customer', label: 'Customer name and contact details', ok: invoice.customer.name.trim() !== '' && (invoice.customer.phone.trim() !== '' || invoice.customer.email.trim() !== '') },
    { id: 'vehicle', label: 'Vehicle details', ok: invoice.vehicle.make.trim() !== '' || invoice.vehicle.model.trim() !== '' },
    { id: 'terms', label: 'Terms and conditions', ok: invoice.notes.termsAndConditions.trim() !== '' },
    { id: 'total', label: 'Total is greater than zero', ok: t.grandTotal > 0 },
  ];
  if (ai && ai.lineIds.length) items.push({ id: 'ai', label: 'AI-suggested lines were verified', ok: ai.verified });
  return items;
}

const isEstimate = (i: Invoice) => i.meta.docType === 'estimate';

/** True when the invoice is a Final Invoice, which agents may no longer edit. */
export const isFinal = (i: Invoice) => !isEstimate(i);

/**
 * Converts an estimate to a Final Invoice: docType `invoice`, status `Draft`, issue date today, number unchanged, review recorded.
 * Agents cannot see the user's settings, so for them the terms swap is left as a pending step the owner's browser completes.
 */
export function confirmEstimate(invoice: Invoice, actor: Actor & { by: 'human' | 'agent' }, note: string, opts: { now?: Date; settings?: InvoicingSettings } = {}): Invoice {
  if (!isEstimate(invoice)) throw new ConfirmError('This document is already a final invoice.');
  const now = opts.now ?? new Date();
  const today = todayIso(now);
  let out: Invoice = {
    ...invoice,
    meta: { ...invoice.meta, docType: 'invoice', status: 'Draft', date: today, dueDate: opts.settings && opts.settings.defaults.dueDays > 0 ? addDays(today, opts.settings.defaults.dueDays) : '' },
  };
  out = withGe(out, { review: { by: actor.by, ...(actor.keyId ? { keyId: actor.keyId } : {}), at: now.toISOString(), note: note.slice(0, 2000) }, pending: [...new Set([...geOf(out).pending, 'swapTerms', 'defaults'])] });
  return addEvent(out, actor, 'confirmed', note.slice(0, 500), now);
}

/** Owner reopens a final invoice as an estimate (in the app only; logged). */
export function reopenAsEstimate(invoice: Invoice, now: Date = new Date()): Invoice {
  if (isEstimate(invoice)) return invoice;
  return addEvent(withGe({ ...invoice, meta: { ...invoice.meta, docType: 'estimate', status: 'Estimate' } }, { review: undefined }), { by: 'human' }, 'reopened', undefined, now);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
