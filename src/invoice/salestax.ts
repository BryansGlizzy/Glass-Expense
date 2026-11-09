import { addEvent, geOf, withGe, type GePayment } from './ge';
import { roundCurrency } from './format';
import { calculateTotals } from './totals';
import type { Invoice, Totals } from './types';

/**
 * Payments and sales tax bookkeeping (docs/INVOICING_PLAN.md §5.11, decision D9). Tax is optional and per user; the rule is driven
 * by the invoice itself: with no tax on the invoice nothing changes; with tax, the tax portion of each payment is split out of the
 * income entry (default) so Schedule C gross receipts do not include money owed to the state. This is bookkeeping logic, not tax
 * advice: users who charge tax should confirm the treatment with their accountant.
 */

export type IncomeMode = 'exclude' | 'include';

/** Proportional tax inside a payment: round(payment × taxAmount ÷ grandTotal, 2). 0 when the invoice has no tax. */
export function taxPortion(payment: number, taxAmount: number, grandTotal: number): number {
  if (!(taxAmount > 0) || !(grandTotal > 0) || !(payment > 0)) return 0;
  return Math.min(roundCurrency(payment), roundCurrency((payment * taxAmount) / grandTotal));
}

/** Amount to book as income for a payment. */
export function incomeForPayment(payment: number, tax: number, mode: IncomeMode): number {
  return mode === 'include' ? roundCurrency(payment) : roundCurrency(payment - tax);
}

export interface PaymentSummary { paid: number; balance: number; taxCollected: number; fullyPaid: boolean }

export function summarizePayments(invoice: Invoice, totals: Totals = calculateTotals(invoice)): PaymentSummary {
  const payments = geOf(invoice).payments;
  const paid = roundCurrency(payments.reduce((s, p) => s + p.amount, 0));
  const balance = Math.max(0, roundCurrency(totals.grandTotal - paid));
  return { paid, balance, taxCollected: roundCurrency(payments.reduce((s, p) => s + p.taxPortion, 0)), fullyPaid: totals.grandTotal > 0 && balance <= 0.005 };
}

export class PaymentError extends Error {}

/** Adds a payment (the caller books the income entry with `incomeEntryId`). Sets Paid when the balance reaches zero. */
export function recordPayment(
  invoice: Invoice, input: { id: string; method: string; amount: number; date: string; reference?: string }, opts: { mode: IncomeMode; now?: Date },
): { invoice: Invoice; payment: GePayment; income: number } {
  if (invoice.meta.docType !== 'invoice') throw new PaymentError('Confirm the estimate into a final invoice before recording payment.');
  const amount = roundCurrency(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new PaymentError('Enter a payment amount greater than zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new PaymentError('Enter the payment date.');
  const totals = calculateTotals(invoice);
  const before = summarizePayments(invoice, totals);
  if (amount > before.balance + 0.005) throw new PaymentError(`That is more than the balance due (${before.balance.toFixed(2)}).`);
  if (geOf(invoice).payments.some(p => p.id === input.id)) throw new PaymentError('This payment was already recorded.');

  const tax = taxPortion(amount, totals.taxAmount, totals.grandTotal);
  const payment: GePayment = { id: input.id, method: input.method.slice(0, 20), amount, date: input.date, reference: (input.reference || '').slice(0, 200), taxPortion: tax };
  let out = withGe(invoice, { payments: [...geOf(invoice).payments, payment] });
  const after = summarizePayments(out, totals);
  if (after.fullyPaid) out = { ...out, meta: { ...out.meta, status: 'Paid' } };
  out = addEvent(out, { by: 'human' }, 'payment', `${amount.toFixed(2)} ${payment.method}`, opts.now);
  return { invoice: out, payment, income: incomeForPayment(amount, tax, opts.mode) };
}

/** Sales tax collected per period, for remittance (not Schedule C gross receipts when excluded). */
export function salesTaxCollected(invoices: Invoice[], from: string, to: string): { total: number; byInvoice: Array<{ number: string; tax: number }> } {
  const rows: Array<{ number: string; tax: number }> = [];
  for (const inv of invoices) {
    const tax = roundCurrency(geOf(inv).payments.filter(p => p.date >= from && p.date <= to).reduce((s, p) => s + p.taxPortion, 0));
    if (tax > 0) rows.push({ number: inv.meta.invoiceNumber, tax });
  }
  return { total: roundCurrency(rows.reduce((s, r) => s + r.tax, 0)), byInvoice: rows };
}
