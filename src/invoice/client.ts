/**
 * Browser-side API for the invoicing UI. Calls to routed endpoints (`/api/invoices`, `/api/jobs`, `/api/invoicing/*`) go through
 * `fetch`, where the E2EE router encrypts and decrypts them. Server pass-through endpoints (AI relays, mailer) use the vault session.
 */
import { api } from '../e2ee/session';
import type { Invoice } from './types';
import type { InvoiceRecord } from '../e2ee/handlers/invoices';
import type { InvoicingSettings } from './settings';
import type { ServicePackage } from './packages';
import type { JobView } from '../e2ee/store';
import type { AiProfile } from './aiSettings';

export type { InvoiceRecord };

async function call<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ignored' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let json: any = null; try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

export const invoicesApi = {
  list: () => call<InvoiceRecord[]>('GET', '/api/invoices'),
  create: (jobId: string, invoice: Invoice, id?: string) => call<InvoiceRecord>('POST', `/api/jobs/${jobId}/invoices`, { invoice, ...(id ? { id } : {}) }),
  update: (id: string, invoice: Invoice, expected_rev?: number) => call<InvoiceRecord>('PUT', `/api/invoices/${id}`, { invoice, ...(expected_rev ? { expected_rev } : {}) }),
  remove: (id: string) => call('DELETE', `/api/invoices/${id}`),
};
export const settingsApi = { get: () => call<InvoicingSettings>('GET', '/api/invoicing/settings'), save: (s: InvoicingSettings) => call<InvoicingSettings>('PUT', '/api/invoicing/settings', s) };
export const packagesApi = { get: () => call<ServicePackage[]>('GET', '/api/invoicing/packages'), save: (p: ServicePackage[]) => call<ServicePackage[]>('PUT', '/api/invoicing/packages', { packages: p }) };
export const jobsApi = {
  list: () => call<JobView[]>('GET', '/api/jobs'),
  patch: (id: string, body: Record<string, unknown>) => call<JobView>('PATCH', `/api/jobs/${id}`, body),
  create: (body: Record<string, unknown>) => call<JobView>('POST', '/api/jobs', body),
  expenses: (id: string) => call<Array<{ id: string; amount: number; description: string | null; entry_type: string; date: string | null }>>('GET', `/api/jobs/${id}/expenses`),
};

/** Books a payment as an income entry on the job with a deterministic id, so two devices can never double-post it. */
export async function addIncomeEntry(jobId: string, entryId: string, amount: number, description: string, date: string): Promise<void> {
  const f = new FormData(); f.append('id', entryId); f.append('amount', String(amount)); f.append('description', description); f.append('entry_type', 'income'); f.append('date', date);
  const res = await fetch(`/api/jobs/${jobId}/expenses`, { method: 'POST', headers: { Authorization: 'Bearer ignored' }, body: f });
  if (!res.ok && res.status !== 409) throw new Error('The payment was recorded, but the income entry could not be added.');
}

export const aiApi = {
  settings: () => call<any>('GET', '/api/settings/ai'),
  complete: (profile: AiProfile, messages: Array<{ role: string; content: string }>, json = false) => api<{ content: string }>('POST', '/api/ai/complete', { body: { profile, messages, json } }),
  test: (profile: Partial<AiProfile>) => api<{ ok: boolean; models: string[] }>('POST', '/api/ai/test', { body: { profile } }),
  start: (profile: AiProfile, messages: Array<{ role: string; content: string }>) => api<{ id: string }>('POST', '/api/ai/tasks', { body: { profile, messages } }),
  poll: (id: string) => api<{ status: 'pending' | 'done' | 'error'; content?: string; error?: string }>('GET', `/api/ai/tasks/${id}`),
  cancel: (id: string) => api('DELETE', `/api/ai/tasks/${id}`),
};

export interface MailPayload { to: string; bcc?: string[]; subject: string; text: string; pay_links: Array<{ label: string; url: string }>; pdf_base64: string; filename: string; shop_name: string; reply_to?: string }
export const sendInvoiceMail = (p: MailPayload) => api<{ success: boolean }>('POST', '/api/invoices/send', { body: p });

export function pdfToBase64(bytes: Uint8Array): string {
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Saves bytes as a file. On Android's WebView a plain anchor download can fail; the native Share path needs an APK release (plan C9). */
export function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/pdf'): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
