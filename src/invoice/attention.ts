import { calculateTotals } from './totals';
import { geOf } from './ge';
import { summarizePayments } from './salestax';
import { statusLabel, type Invoice } from './types';

/**
 * Dashboard helpers (docs/DOCUMENTATION.md §13.7): the badge a job card shows for its document, and the "needs attention" list.
 * Pure. Only the owner's own documents (`can_edit`) ever produce attention items, since members cannot act on them.
 */

export interface DocRecord { id: string; job_id: string; updated_at: string; can_edit: boolean; invoice: Invoice }

export type BadgeTone = 'gray' | 'blue' | 'green' | 'amber' | 'red';
export interface JobBadge { label: string; tone: BadgeTone; total: number; recordId: string; count: number }

const money = (n: number) => '$' + n.toFixed(2);
const isOverdue = (inv: Invoice, today: string) => inv.meta.docType === 'invoice' && !!inv.meta.dueDate && inv.meta.dueDate < today && summarizePayments(inv).balance > 0.005;

/** The badge for one job: its most recently changed document. Null when the job has no document. */
export function jobBadge(records: DocRecord[], today: string): JobBadge | null {
  if (!records.length) return null;
  const r = [...records].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
  const inv = r.invoice; const total = calculateTotals(inv).grandTotal;
  let label: string; let tone: BadgeTone;
  if (inv.meta.docType === 'estimate') {
    label = inv.meta.status === 'Estimate' || inv.meta.status === 'Draft' ? 'Estimate' : `Estimate · ${inv.meta.status}`; tone = 'blue';
  } else {
    const s = summarizePayments(inv);
    if (s.fullyPaid) { label = 'Paid'; tone = 'green'; }
    else if (isOverdue(inv, today)) { label = 'Overdue'; tone = 'red'; }
    else if (s.paid > 0) { label = 'Partially paid'; tone = 'amber'; }
    else { label = `Invoice · ${statusLabel(inv.meta.status, 'invoice')}`; tone = inv.meta.status === 'Draft' ? 'gray' : 'blue'; }
  }
  return { label, tone, total, recordId: r.id, count: records.length };
}

export type AttentionKind = 'overdue' | 'agent-final' | 'review-estimate';
export interface AttentionItem { id: string; kind: AttentionKind; recordId: string; jobId: string; title: string; detail: string }
const ORDER: Record<AttentionKind, number> = { overdue: 0, 'agent-final': 1, 'review-estimate': 2 };

/**
 * What is waiting on the owner:
 *  - overdue: a final invoice past its due date with a balance
 *  - agent-final: an agent confirmed an estimate into a final invoice and it has not been sent (review it first)
 *  - review-estimate: an estimate drafted automatically (website job or agent) that has not been sent
 */
export function attentionItems(records: DocRecord[], jobTitles: Record<string, string>, today: string): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of records) {
    if (!r.can_edit) continue;
    const inv = r.invoice; const g = geOf(inv);
    const title = jobTitles[r.job_id] || inv.customer.name || 'Job';
    const total = money(calculateTotals(inv).grandTotal);
    const num = inv.meta.invoiceNumber || '(no number)';
    if (isOverdue(inv, today)) {
      items.push({ id: `${r.id}:overdue`, kind: 'overdue', recordId: r.id, jobId: r.job_id, title, detail: `${num} was due ${inv.meta.dueDate}. ${money(summarizePayments(inv).balance)} unpaid.` });
    } else if (inv.meta.docType === 'invoice' && g.review?.by === 'agent' && !g.sentAt && inv.meta.status !== 'Paid') {
      items.push({ id: `${r.id}:agent`, kind: 'agent-final', recordId: r.id, jobId: r.job_id, title, detail: `${num} (${total}) was finalized by an agent. Review it before sending.` });
    } else if (inv.meta.docType === 'estimate' && !g.sentAt && (g.origin === 'api-auto' || g.origin === 'agent')) {
      items.push({ id: `${r.id}:review`, kind: 'review-estimate', recordId: r.id, jobId: r.job_id, title, detail: `${num} (${total}) was drafted automatically. Review the hours and send it.` });
    }
  }
  return items.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.title.localeCompare(b.title));
}
