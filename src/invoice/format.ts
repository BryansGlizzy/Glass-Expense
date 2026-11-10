/** Number coercion and currency formatting. */

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Anything that is not a finite number becomes 0. */
export function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Currency as the editor and the preview sheet show it (via Intl); the PDF prints the same strings, because it is drawn from the sheet model. */
export function formatCurrency(amount: unknown): string {
  return currencyFormatter.format(asNumber(amount));
}
