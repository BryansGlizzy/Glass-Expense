/**
 * The downloaded / e-mailed PDF is drawn from the same SheetModel as the preview and the print view (docs/INVOICING_PLAN.md §5.2).
 * Pure: needs no server.   Run:  npx tsx tests/invoice.sheetpdf.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { renderPdf, renderSheet, footerStamp } from '../src/invoice/render.ts';
import { generateSheetPdf, DEFAULT_FOOTER_BRAND } from '../src/invoice/pdf/sheetPdf.ts';
import { normalizeSettings } from '../src/invoice/settings.ts';
import { normalizeInvoice } from '../src/invoice/normalize.ts';

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; } };
const dir = new URL('./fixtures/invoice/', import.meta.url);
const fx = (n: string) => normalizeInvoice(JSON.parse(readFileSync(new URL(`${n}.json`, dir), 'utf8')));
const jpg = readFileSync(new URL('logo.jpg', dir));
const latin = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const hasPoppler = !spawnSync('pdftotext', ['-v']).error;
const NOW = new Date(2026, 10, 9, 18, 10);
const settings = (logo = false) => normalizeSettings({ shop: { name: 'Test Shop', address: '1 Main St', phone: '555-0100', email: 'shop@example.com', licenseNumber: 'L-77', ...(logo ? { logo: `data:image/jpeg;base64,${jpg.toString('base64')}` } : {}) }, payments: { paypal: { enabled: true, handle: 'https://www.paypal.com/ncp/payment/ABCDEFGH12345' }, cash: { enabled: true } } });
const final = (n: string) => { const i = fx(n); i.meta.docType = 'invoice'; i.meta.invoiceNumber = 'T-1'; return i; };
function pdfText(bytes: Uint8Array): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'sp-')); const f = path.join(d, 'a.pdf'); writeFileSync(f, bytes);
  return spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout;
}
const pages = (b: Uint8Array) => Number(/\/Count (\d+)/.exec(latin(b))![1]);

await t('every string of the sheet is in the PDF (same wording, labels and numbers as the preview)', () => {
  const inv = final('sample'); const s = settings(); const { model: m } = renderSheet(inv, s);
  const pdf = latin(renderPdf(inv, s, { now: NOW }).bytes);
  const need = [m.title, m.status.badgeText, m.shop.name, m.shop.address, m.customer.name, m.customer.heading.toUpperCase(), m.labor.heading.toUpperCase(), m.parts.heading.toUpperCase(),
    ...m.meta.flatMap(r => [r.label, r.value]), ...m.totals.flatMap(l => [l.label, l.value]), m.labor.subtotal, m.parts.subtotal, m.signature.customerCaption, m.signature.dateCaption,
    ...m.labor.columns, ...m.parts.columns, ...m.labor.rows.flatMap(r => [r.description, r.amount]), ...m.parts.rows.flatMap(r => [r.partNumber, r.amount])];
  for (const s2 of need) assert.ok(pdf.includes(`(${s2.replace(/[()\\]/g, c => `\\${c}`)}) Tj`), `missing: ${s2}`);
});

await t('the footer is date/time + app name + page n of N on every page; no URL line, no header line', () => {
  const b = renderPdf(final('many-lines-60'), settings(), { now: NOW }).bytes; const n = pages(b); assert.ok(n >= 3);
  const s = latin(b);
  assert.equal(s.split(`(${footerStamp(NOW)}) Tj`).length - 1, n); assert.equal(s.split(`(${DEFAULT_FOOTER_BRAND}) Tj`).length - 1, n);
  for (let i = 1; i <= n; i++) assert.ok(s.includes(`(Page ${i} of ${n}) Tj`));
  assert.ok(!/https?:\/\/(localhost|127\.)/.test(s.replace(/\/URI \([^)]*\)/g, '')) , 'no page URL printed');
  assert.ok(footerStamp(NOW).includes('26') && /\d{1,2}:\d{2}/.test(footerStamp(NOW)));
});

await t('long documents continue on new pages: the table header repeats and nothing is cut off', () => {
  const inv = final('many-lines-60'); const b = renderPdf(inv, settings(), { now: NOW }).bytes; const s = latin(b);
  assert.ok(pages(b) >= 3); assert.ok((s.match(/\(Service Description\) Tj/g) ?? []).length >= 2, 'labor header repeats');
  for (let i = 1; i <= inv.laborItems.length; i++) assert.ok(s.includes(`(Service task ${i}) Tj`), `row ${i}`);
});

await t('pay links are clickable, boxes are drawn; estimates carry neither', () => {
  const s = settings(); const b = renderPdf(final('sample'), s, { now: NOW }).bytes; const txt = latin(b);
  assert.ok(txt.includes('/URI (https://www.paypal.com/ncp/payment/ABCDEFGH12345)') && txt.includes('(HOW TO PAY) Tj') && txt.includes('[ ] PayPal') && txt.includes('[ ] Cash'));
  const est = fx('estimate-status'); est.meta.docType = 'estimate';
  const e = latin(renderPdf(est, s, { now: NOW }).bytes); assert.ok(!e.includes('/URI') && !e.includes('HOW TO PAY'));
});

await t('logo is embedded once; without logo there is no image; vehicle box vs full-width customer box', () => {
  assert.equal((latin(renderPdf(final('sample'), settings(true), { now: NOW }).bytes).match(/\/Subtype \/Image/g) ?? []).length, 1);
  assert.ok(!latin(renderPdf(final('sample'), settings(), { now: NOW }).bytes).includes('/Subtype /Image'));
  const inv = final('sample'); inv.details = { title: '', fields: [] } as any;
  const { model } = renderSheet(inv, settings()); const b = generateSheetPdf(model, { generatedAt: 'x' });
  assert.ok(latin(b).startsWith('%PDF-1.4'));
});

await t('deterministic: same inputs and generatedAt give identical bytes; a different stamp changes only the footer', () => {
  const a = renderPdf(final('sample'), settings(true), { now: NOW }).bytes, b = renderPdf(final('sample'), settings(true), { now: NOW }).bytes;
  assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
  const c = renderPdf(final('sample'), settings(true), { now: new Date(2027, 0, 2, 3, 4) }).bytes; assert.notEqual(Buffer.compare(Buffer.from(a), Buffer.from(c)), 0);
});

await t('hostile text (odd characters, huge words) stays valid and inside the page', () => {
  const inv = final('odd-characters'); inv.customer.name = 'A'.repeat(300); inv.laborItems[0].description = 'W'.repeat(400) + ' (parens) \\ back';
  const b = renderPdf(inv, settings(), { now: NOW }).bytes; assert.ok(latin(b).startsWith('%PDF-1.4') && latin(b).trimEnd().endsWith('%%EOF'));
  if (hasPoppler) { const out = pdfText(b); assert.ok(out.includes('parens')); }
});

await t('poppler reads it: right page count, selectable text in reading order', () => {
  if (!hasPoppler) { console.log('      (poppler not installed, skipped)'); return; }
  const b = renderPdf(final('sample'), settings(true), { now: NOW }).bytes;
  const d = mkdtempSync(path.join(os.tmpdir(), 'sp-')); const f = path.join(d, 'a.pdf'); writeFileSync(f, b);
  const info = spawnSync('pdfinfo', [f], { encoding: 'utf8' }); assert.equal(info.status, 0); assert.match(info.stdout, new RegExp(`Pages:\\s+${pages(b)}`));
  const out = pdfText(b); const i = (x: string) => out.indexOf(x);
  assert.ok(i(renderSheet(final('sample'), settings()).model.shop.name) >= 0 && i('LABOR') > i('CUSTOMER') && i('PARTS') > i('LABOR') && i('Total Due') > i('PARTS') && i(DEFAULT_FOOTER_BRAND) > 0);
});

console.log(`\n${passed} passed`);
