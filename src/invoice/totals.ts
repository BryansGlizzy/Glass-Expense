import { asNumber, roundCurrency } from './format';
import type { FeeLine, Totals } from './types';

/** Amount of one user-defined fee. Percentages are of the labor subtotal or of the subtotal (before discount), with an optional cap. */
export function feeAmount(f: Pick<FeeLine, 'kind' | 'value' | 'cap'>, labor: number, subtotal: number): number {
  const cap = asNumber(f.cap) > 0 ? asNumber(f.cap) : Infinity;
  if (f.kind === 'percentOfLabor') return roundCurrency(Math.min(labor * (asNumber(f.value) / 100), cap));
  if (f.kind === 'percentOfSubtotal') return roundCurrency(Math.min(subtotal * (asNumber(f.value) / 100), cap));
  return roundCurrency(asNumber(f.value));
}

/**
 * The totals engine (one definition of the rounding and the order of operations).
 * Tolerant of missing/garbage input on purpose: it is also used on untrusted JSON before normalization.
 */
export function calculateTotals(invoice: unknown): Totals {
  const inv = invoice as any;
  const laborItems: any[] = Array.isArray(inv?.laborItems) ? inv.laborItems : [];
  const partItems: any[] = Array.isArray(inv?.partItems) ? inv.partItems : [];
  const settings: any = inv?.settings || {};

  // Layout 2 (opt-in, H6): every line is rounded to the cent first, so the subtotal always equals the sum of the lines shown.
  const line = inv?.meta?.layout === 2 ? roundCurrency : (n: number) => n;
  const laborSubtotal = roundCurrency(laborItems.reduce((sum, item) => sum + line(asNumber(item?.hours) * asNumber(item?.rate)), 0));
  const partsSubtotal = roundCurrency(partItems.reduce((sum, item) => sum + line(asNumber(item?.quantity) * asNumber(item?.unitPrice)), 0));
  const subtotal = roundCurrency(laborSubtotal + partsSubtotal);
  // Dynamic fees mode (the invoice has a `fees` array): the four fixed fee fields are ignored and the labelled fee lines are used instead.
  const dynamic = Array.isArray(inv?.fees);
  const shopSuppliesFee = dynamic ? 0 : roundCurrency(Math.min(laborSubtotal * (asNumber(settings.shopSuppliesRate) / 100), asNumber(settings.shopSuppliesCap)));
  const hazardousWasteFee = dynamic ? 0 : roundCurrency(asNumber(settings.hazardousWasteFee));
  const travelFee = dynamic ? 0 : roundCurrency(asNumber(settings.travelFee));
  const miscFee = dynamic ? 0 : roundCurrency(asNumber(settings.miscFee));
  const feeLines = dynamic ? (inv.fees as any[]).map(f => ({ id: String(f?.id ?? ''), label: String(f?.label ?? ''), amount: feeAmount(f ?? {}, laborSubtotal, subtotal), taxable: !!f?.taxable })) : [];
  const feesTotal = roundCurrency(feeLines.reduce((n, f) => n + f.amount, 0));
  const taxableFees = roundCurrency(feeLines.filter(f => f.taxable).reduce((n, f) => n + f.amount, 0));
  const discountValue = asNumber(settings.discountValue);
  const discountAmount = roundCurrency(settings.discountType === 'fixed' ? Math.min(discountValue, subtotal) : subtotal * (discountValue / 100));
  const taxableBase = settings.taxLabor ? subtotal : partsSubtotal;
  const discountShare = subtotal > 0 ? discountAmount * (taxableBase / subtotal) : 0;
  const taxableAmount = roundCurrency(Math.max(0, taxableBase - discountShare) + taxableFees);
  const taxAmount = roundCurrency(taxableAmount * (asNumber(settings.taxRate) / 100));
  const grandTotal = roundCurrency(subtotal - discountAmount + shopSuppliesFee + hazardousWasteFee + travelFee + miscFee + feesTotal + taxAmount);

  const base = { laborSubtotal, partsSubtotal, subtotal, shopSuppliesFee, hazardousWasteFee, travelFee, miscFee, discountAmount, taxableAmount, taxAmount, grandTotal };
  return dynamic ? { ...base, fees: feeLines.map(({ id, label, amount }) => ({ id, label, amount })), feesTotal } : base;
}
