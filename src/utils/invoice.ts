/**
 * Utilities for GlassExpense Invoice Numbering
 * Standard 6-character format: 1 alpha + 5 digits (A00001 - A99999 > B00001, etc.)
 */

/**
 * Formats a 1-indexed sequence number into the standard 6-character invoice sequence.
 * Examples:
 *   1      -> A00001
 *   99999  -> A99999
 *   100000 -> B00001
 *   199999 -> B99999
 *   200000 -> C00001
 */
export function formatInvoiceSequence(seq: number): string {
  const s = Math.max(1, Math.floor(seq || 1));
  const offset = s - 1;
  const letterIndex = Math.floor(offset / 99999);
  const letter = String.fromCharCode(65 + (letterIndex % 26));
  const num = (offset % 99999) + 1;
  return `${letter}${String(num).padStart(5, '0')}`;
}

/**
 * Parses an invoice sequence string (standard 6-character or legacy digits) back into a 1-indexed integer.
 */
export function parseInvoiceSequence(code: string): number | null {
  if (!code) return null;
  const trimmed = code.trim().toUpperCase();
  
  // Match standard 6-char (1 alpha + 5 digits) optionally preceded by prefix and dash
  const matchAlpha = trimmed.match(/([A-Z])(\d{5})$/);
  if (matchAlpha) {
    const letterIndex = matchAlpha[1].charCodeAt(0) - 65;
    const num = parseInt(matchAlpha[2], 10);
    return letterIndex * 99999 + num;
  }

  // Fallback for legacy 1-5 digits
  const matchLegacy = trimmed.match(/(\d{1,5})$/);
  if (matchLegacy) {
    return parseInt(matchLegacy[1], 10);
  }

  return null;
}

/**
 * Generates the full invoice number with prefix and standard 6-character sequence.
 * Example:
 *   formatInvoiceNumber('AUTO', 1) -> 'AUTO-A00001'
 *   formatInvoiceNumber('INV', 100000) -> 'INV-B00001'
 *   formatInvoiceNumber(null, 1) -> 'A00001'
 */
export function formatInvoiceNumber(prefix: string | null | undefined, seq: number): string {
  const cleanPrefix = prefix ? String(prefix).trim().replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() : '';
  const code = formatInvoiceSequence(seq);
  return cleanPrefix ? `${cleanPrefix}-${code}` : code;
}

/**
 * Converts legacy invoice number (e.g. 'INV-00062' or 'AUTO-00001') to standard 6-character format ('INV-A00062').
 * If already converted or unrecognized format, returns as is.
 */
export function convertLegacyInvoiceNumber(invNum: string): string {
  if (!invNum) return invNum;
  // If already standard 6-character (letter + 5 digits after last dash or alone)
  if (/(?:^|-)[A-Z]\d{5}$/i.test(invNum)) {
    return invNum.toUpperCase();
  }
  // If legacy numeric suffix
  const match = invNum.match(/^(.*-)?(\d{1,5})$/);
  if (match) {
    const prefixPart = match[1] || '';
    const num = parseInt(match[2], 10);
    return `${prefixPart.toUpperCase()}${formatInvoiceSequence(num)}`;
  }
  return invNum;
}
