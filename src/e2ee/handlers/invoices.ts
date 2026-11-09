/**
 * Invoices, estimates and their encrypted storage (docs/INVOICING_PLAN.md §5.8).
 *
 * One small JSON record per document, `{ v: 1, invoice }`, sealed under the JOB key (AAD "invoice|<jobId>|<id>"). Active job
 * members can read; the server only accepts writes from the job owner. PDFs and HTML are never stored.
 * The UI keeps calling `/api/invoices...` and gets decrypted, normalized records.
 */
import * as C from '../crypto';
import { api, getJobKey, getSession, requireJobKey, ensureJobKeys, invalidate, cached, HttpError } from '../session';
import { uuid } from '../store';
import { normalizeInvoice } from '../../invoice/normalize';
import type { Invoice } from '../../invoice/types';
import { Route, ok, bad, NotFound } from './types';

export interface InvoiceRecord {
  id: string;
  job_id: string;
  rev: number;
  user_id: string;
  created_at: string;
  updated_at: string;
  /** True for the job owner (the only role the server lets write). */
  can_edit: boolean;
  invoice: Invoice;
}

const MAX_PLAINTEXT = 80 * 1024; // keeps the ciphertext under the server's 100 KB cap with room for base64 overhead

async function decryptRow(row: any): Promise<InvoiceRecord | null> {
  const key = await getJobKey(row.job_id);
  if (!key || !row.enc) return null;
  try {
    const body = await C.decryptJson<{ v: number; invoice: unknown }>(key, row.enc, C.aad.invoice(row.job_id, row.id));
    return {
      id: row.id, job_id: row.job_id, rev: row.rev, user_id: row.user_id, created_at: row.created_at, updated_at: row.updated_at,
      can_edit: row.user_id === getSession().userId,
      invoice: normalizeInvoice(body?.invoice, { keepGe: true }),
    };
  } catch { return null; } // sealed under a key we do not hold, or tampered with
}

async function sealInvoice(jobId: string, id: string, invoice: unknown): Promise<string> {
  const clean = normalizeInvoice(invoice, { keepGe: true });
  if (JSON.stringify(clean).length > MAX_PLAINTEXT) bad('This invoice is too large to save. Remove some lines or notes.');
  return C.encryptJson(await requireJobKey(jobId), { v: 1, invoice: clean }, C.aad.invoice(jobId, id));
}

/** Every invoice the user can read, one request. */
export async function listInvoices(): Promise<InvoiceRecord[]> {
  return cached('invoices:all', async () => {
    await ensureJobKeys();
    const rows = await api<any[]>('GET', '/api/v2/invoices');
    return (await Promise.all(rows.map(decryptRow))).filter((r): r is InvoiceRecord => r !== null);
  }, 3000);
}

export async function getInvoice(id: string): Promise<InvoiceRecord | null> {
  invalidate('invoices:');
  return (await listInvoices()).find(r => r.id === id) ?? null;
}

const forbidSeal = (e: unknown): never => { throw e; };

export const invoiceRoutes: Route[] = [
  ['GET', /^\/api\/invoices$/, async () => ok(await listInvoices())],

  ['GET', /^\/api\/jobs\/([^/]+)\/invoices$/, async ({ m }) => ok((await listInvoices()).filter(r => r.job_id === m[1]))],

  ['POST', /^\/api\/jobs\/([^/]+)\/invoices$/, async ({ m, body }) => {
    const jobId = m[1];
    if (!body?.invoice || typeof body.invoice !== 'object') bad('invoice is required');
    // A caller-chosen id (a deterministic one, e.g. for auto-drafted estimates) makes concurrent creates from two devices collapse into one.
    const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : uuid();
    try {
      await api('POST', `/api/v2/jobs/${jobId}/invoices`, { body: { id, enc: await sealInvoice(jobId, id, body.invoice) } });
    } catch (e) { if (e instanceof HttpError && e.status === 409) throw e; forbidSeal(e); }
    invalidate('invoices:');
    const rec = await getInvoice(id);
    if (!rec) throw new NotFound('Invoice not found after saving');
    return ok(rec);
  }],

  ['PUT', /^\/api\/invoices\/([^/]+)$/, async ({ m, body }) => {
    const current = await getInvoice(m[1]);
    if (!current) throw new NotFound('Invoice not found');
    if (!body?.invoice || typeof body.invoice !== 'object') bad('invoice is required');
    const expected = body.expected_rev === undefined ? current.rev : Number(body.expected_rev);
    await api('PUT', `/api/v2/invoices/${m[1]}`, { body: { enc: await sealInvoice(current.job_id, m[1], body.invoice), expected_rev: expected } });
    invalidate('invoices:');
    return ok(await getInvoice(m[1]));
  }],

  ['DELETE', /^\/api\/invoices\/([^/]+)$/, async ({ m }) => {
    await api('DELETE', `/api/v2/invoices/${m[1]}`);
    invalidate('invoices:');
    return ok();
  }],
];
