/** Number coercion and currency formatting, ported from automotive-pdf (model.js / pdf.js). */

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Same as upstream `asNumber`: anything that is not a finite number becomes 0. */
export function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Currency as the editor and the preview sheet show it (upstream `model.formatCurrency`, via Intl). */
export function formatCurrency(amount: unknown): string {
  return currencyFormatter.format(asNumber(amount));
}

/**
 * Currency as the PDF prints it (upstream `pdf.formatCurrency`). Intentionally a separate implementation: it treats anything
 * above -0.00001 as zero, so a tiny negative such as -0.000001 prints "$0.00" while Intl (the sheet) prints "-$0.00",
 * and the PDF bytes must not drift.
 */
export function formatPdfCurrency(val: unknown): string {
  const num = Number(val) || 0;
  const isNeg = num < -0.00001;
  const abs = Math.abs(num);
  const parts = abs.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${isNeg ? '-' : ''}$${parts.join('.')}`;
}
