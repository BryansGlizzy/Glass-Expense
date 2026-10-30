import { formatInvoiceNumber } from '../utils/invoice';
import type { JobView } from './store';

/** Port of the server's rolling invoice-number allocator: numbers are now assigned in the browser, where titles/tags are visible. */
export function nextInvoiceForTag(ownedJobs: JobView[], defaultPrefixRaw: string | null | undefined, tag: string | null | undefined, excludeJobId?: string | null) {
  const defaultPrefix = (defaultPrefixRaw || 'INV').toUpperCase();
  const cleanTag = tag ? String(tag).trim().replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() : null;
  const prefix = cleanTag || defaultPrefix;

  const pool = ownedJobs.filter(j => !excludeJobId || j.id !== excludeJobId);
  const sameTag = pool.filter(j => (cleanTag ? (j.invoice_tag || '').toUpperCase() === cleanTag : !j.invoice_tag));
  let nextSeq = sameTag.reduce((max, j) => Math.max(max, j.invoice_seq || 0), 0) + 1;

  const taken = new Set(pool.map(j => (j.invoice_number || '').toUpperCase()));
  let candidate = formatInvoiceNumber(prefix, nextSeq);
  while (taken.has(candidate.toUpperCase())) {
    nextSeq++;
    candidate = formatInvoiceNumber(prefix, nextSeq);
  }
  return { tag: cleanTag, prefix, nextSeq, invoiceNumber: candidate };
}
