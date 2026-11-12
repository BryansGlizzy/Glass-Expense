import { addEvent, geOf, withGe } from './ge';
import { detailSetFor, DEFAULT_DETAILS_TITLE, type InvoicingSettings } from './settings';
import { applyDetailSet } from './detailSets';
import { createId } from './model';
import type { FeeLine, Invoice } from './types';

/**
 * Pending steps (docs/DOCUMENTATION.md §13.12, constraint C17): the server cannot read a user's Settings, so documents made by an
 * agent (or the server) may be sparse. The owner's browser completes them the next time the app opens. Idempotent: running it
 * twice changes nothing, and it never overwrites anything the owner or the agent filled in.
 */

/**
 * Documents made by an agent (or imported) use the original fixed fee fields and vehicle box. When the owner's browser finishes them,
 * they move to the user's own fee lines and detail fields without losing anything: every non-zero fixed fee becomes a fee line, and the
 * vehicle values fill the matching fields of the user's detail preset linked to the document's number (the vehicle box stays if no preset applies).
 */
export function upgradeToDynamic(inv: Invoice, s: InvoicingSettings): Invoice {
  let out = inv;
  if (!out.fees) {
    const st = out.settings; const fees: FeeLine[] = [];
    if (st.travelFee > 0) fees.push({ id: createId('fee'), label: 'Travel Fee', kind: 'flat', value: st.travelFee, cap: 0, taxable: false });
    if (st.shopSuppliesRate > 0) fees.push({ id: createId('fee'), label: 'Shop Supplies Fee', kind: 'percentOfLabor', value: st.shopSuppliesRate, cap: st.shopSuppliesCap, taxable: false });
    if (st.hazardousWasteFee > 0) fees.push({ id: createId('fee'), label: 'Hazardous Waste Fee', kind: 'flat', value: st.hazardousWasteFee, cap: 0, taxable: false });
    if (st.miscFee > 0) fees.push({ id: createId('fee'), label: 'Misc. Fee', kind: 'flat', value: st.miscFee, cap: 0, taxable: false });
    out = { ...out, fees, settings: { ...st, travelFee: 0, shopSuppliesRate: 0, shopSuppliesCap: 0, hazardousWasteFee: 0, miscFee: 0 } };
  }
  if (!out.details) {
    // The user's preset linked to this document's number fills the box (the old vehicle values carry over by key).
    const set = detailSetFor(s.detailSets, [out.meta.invoiceNumber]);
    const v = out.vehicle as unknown as Record<string, string>;
    const hasVehicle = ['year', 'make', 'model', 'vin', 'licensePlate', 'mileage', 'engine', 'serviceAdvisor'].some(k => (v[k] || '').trim() !== '');
    if (set) out = applyDetailSet(out, set);
    else if (!hasVehicle) out = { ...out, details: { title: DEFAULT_DETAILS_TITLE, fields: [] } }; // otherwise the vehicle box stays so nothing is lost
  }
  return out;
}

export const needsPending = (inv: Invoice) => geOf(inv).pending.length > 0;

export function applyPending(invoice: Invoice, settings: InvoicingSettings, now: Date = new Date()): Invoice {
  const pending = geOf(invoice).pending;
  if (!pending.length) return invoice;
  let out = invoice;
  const blank = (v: string) => v.trim() === '';

  if (pending.includes('defaults')) {
    const s = settings;
    out = {
      ...out,
      shop: {
        name: blank(out.shop.name) ? s.shop.name : out.shop.name, address: blank(out.shop.address) ? s.shop.address : out.shop.address, phone: blank(out.shop.phone) ? s.shop.phone : out.shop.phone,
        email: blank(out.shop.email) ? s.shop.email : out.shop.email, licenseNumber: blank(out.shop.licenseNumber) ? s.shop.licenseNumber : out.shop.licenseNumber,
      },
      notes: { ...out.notes, termsAndConditions: blank(out.notes.termsAndConditions) ? (out.meta.docType === 'estimate' ? s.terms.estimateTerms : s.terms.invoiceTerms) : out.notes.termsAndConditions },
    };
  }
  if (pending.includes('defaults')) out = upgradeToDynamic(out, settings);
  if (pending.includes('swapTerms') && out.meta.docType === 'invoice') {
    // Swap estimate terms for invoice terms only if nobody edited them (they still equal the estimate template, with or without the own-parts clause).
    const est = settings.terms.estimateTerms.trim();
    const cur = out.notes.termsAndConditions.trim();
    const estimateForms = [est, [est, settings.terms.ownPartsClause.trim()].filter(Boolean).join('\n\n')];
    if (cur === '' || (est !== '' && estimateForms.includes(cur))) {
      const clause = settings.terms.ownPartsClause.trim();
      const hadClause = clause !== '' && cur.endsWith(clause);
      out = { ...out, notes: { ...out.notes, termsAndConditions: [settings.terms.invoiceTerms.trim(), hadClause ? clause : ''].filter(Boolean).join('\n\n') } };
    }
  }
  out = withGe(out, { pending: undefined });
  return addEvent(out, { by: 'system' }, 'completed-pending', pending.join(','), now);
}
