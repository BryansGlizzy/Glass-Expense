/**
 * Text helpers for the PDF writer: escaping for PDF literal strings, real Helvetica metrics and word wrapping.
 */

/** Escapes a string for a PDF literal string `( ... )` and maps characters to WinAnsi-safe equivalents. */
export function escapePdfText(str: unknown): string {
  if (str === null || str === undefined) return '';
  const s = String(str);

  // Normalize common unicode punctuation to ASCII equivalents
  const normalized = s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/•/g, '*')
    .replace(/ /g, ' ');

  let out = '';
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '\\') {
      out += '\\\\';
    } else if (c === '(') {
      out += '\\(';
    } else if (c === ')') {
      out += '\\)';
    } else if (c === '\r') {
      out += '\\r';
    } else if (c === '\n' || c === '\t') {
      out += ' ';
    } else {
      const code = c.charCodeAt(0);
      if (code < 32 || code > 126) {
        if (code >= 128 && code <= 255) out += '\\' + code.toString(8).padStart(3, '0');
        else out += '?';
      } else {
        out += c;
      }
    }
  }
  return out;
}

export type Measure = (text: string, fontSize: number, isBold?: boolean) => number;

/** Greedy word wrap by width (real Helvetica metrics by default); blank paragraphs are dropped. */
export function wrapText(text: unknown, maxWidth: number, fontSize: number, isBold = false, measure: Measure = helveticaWidth): string[] {
  if (!text) return [];
  const lines: string[] = [];
  const rawParagraphs = String(text).split('\n');

  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      const width = measure(candidate, fontSize, isBold);
      if (width <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

// ── Metrics and WinAnsi ────────────────────────────────────────────────────────────────────────────────────────
// Standard Helvetica / Helvetica-Bold advance widths (1000-unit em) for printable ASCII 32..126.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELV_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Real Helvetica widths (characters outside printable ASCII fall back to the digit width, as accented Latin-1 letters are close to it). */
export function helveticaWidth(text: string, fontSize: number, isBold = false): number {
  if (!text) return 0;
  const table = isBold ? HELV_BOLD : HELV;
  let units = 0;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); units += c >= 32 && c <= 126 ? table[c - 32] : 556; }
  return (units / 1000) * fontSize;
}

const WINANSI_EXTRA: Record<string, string> = { '\u20AC': '\\200', '\u201A': '\\202', '\u0192': '\\203', '\u201E': '\\204', '\u2026': '\\205', '\u2020': '\\206', '\u2021': '\\207', '\u02C6': '\\210', '\u2030': '\\211', '\u0160': '\\212', '\u2039': '\\213', '\u0152': '\\214', '\u017D': '\\216', '\u02DC': '\\230', '\u2122': '\\231', '\u0161': '\\232', '\u203A': '\\233', '\u0153': '\\234', '\u017E': '\\236', '\u0178': '\\237' };

/** Like `escapePdfText`, but characters that exist in WinAnsi beyond Latin-1 (€ … ™ …) are written instead of becoming "?". */
export function escapePdfTextWinAnsi(str: unknown): string {
  let out = '';
  for (const ch of String(str ?? '')) out += WINANSI_EXTRA[ch] ?? escapePdfText(ch);
  return out;
}
