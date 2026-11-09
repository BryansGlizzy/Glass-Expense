/**
 * Logo embedding and clickable pay links in the PDF (docs/INVOICING_PLAN.md H4, §5.11). Without a logo and without links the output is
 * byte-identical to before (invoice.parity); here we prove the additive parts are well-formed PDF, carry the exact JPEG bytes, put the
 * links where the text is, and are accepted by a real PDF reader when poppler is installed.
 * Pure: needs no server.   Run:  npx tsx tests/invoice.logo.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decodeLogo, isLogoDataUrl, parseJpeg, fitInside, MAX_LOGO_CHARS } from '../src/invoice/logo.ts';
import { generatePdfBytes } from '../src/invoice/pdf/generate.ts';
import { renderPdf, renderSheet } from '../src/invoice/render.ts';
import { normalizeSettings } from '../src/invoice/settings.ts';
import { calculateTotals } from '../src/invoice/totals.ts';
import { buildSheetModel } from '../src/invoice/sheet.ts';
import { UPSTREAM_PDF_LABELS } from './reference/automotive/labels.ts';

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; } };
const dir = new URL('./fixtures/invoice/', import.meta.url);
const jpg = new Uint8Array(readFileSync(new URL('logo.jpg', dir))); const gray = new Uint8Array(readFileSync(new URL('logo-gray.jpg', dir)));
const dataUrl = (b: Uint8Array) => `data:image/jpeg;base64,${Buffer.from(b).toString('base64')}`;
const fx = (n: string) => JSON.parse(readFileSync(new URL(`${n}.json`, dir), 'utf8'));
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const goldens = JSON.parse(readFileSync(new URL('goldens.json', dir), 'utf8')).goldens;
const hasPoppler = spawnSync('pdfinfo', ['-v']).status !== null && !spawnSync('pdfinfo', ['-v']).error;

/** Every xref entry must point at its object, and startxref at the table. */
function assertStructure(bytes: Uint8Array) {
  const s = text(bytes); const sx = Number(/startxref\n(\d+)/.exec(s)![1]); assert.equal(s.slice(sx, sx + 4), 'xref');
  const size = Number(/\/Size (\d+)/.exec(s)![1]); const entries = [...s.slice(sx).matchAll(/(\d{10}) 00000 n /g)].map(m => Number(m[1]));
  assert.equal(entries.length, size - 1, 'one xref entry per object');
  entries.forEach((off, i) => assert.ok(new RegExp(`^${i + 1} 0 obj`).test(s.slice(off, off + 14)), `xref entry ${i + 1} -> object`));
}
const pay = [{ label: 'PayPal', text: 'PayPal: https://www.paypal.me/FuturesAuto/106.00USD', url: 'https://www.paypal.me/FuturesAuto/106.00USD' }, { label: 'Venmo', text: 'Venmo: https://venmo.com/future-auto?txn=pay&amount=106.00&note=Invoice%20T-1', url: 'https://venmo.com/future-auto?txn=pay&amount=106.00&note=Invoice%20T-1' }, { label: 'Zelle', text: 'Zelle: pay@example.com (memo: T-1)' }];

await t('JPEG parsing: size and components from the frame header; non-JPEGs and truncated data are rejected', () => {
  assert.deepEqual(parseJpeg(jpg), { width: 320, height: 120, components: 3 }); assert.deepEqual(parseJpeg(gray), { width: 80, height: 40, components: 1 });
  assert.equal(parseJpeg(new Uint8Array(readFileSync(new URL('logo.png', dir)))), null); assert.equal(parseJpeg(new Uint8Array([0xff, 0xd8])), null); assert.equal(parseJpeg(jpg.slice(0, 40)), null); assert.equal(parseJpeg(new Uint8Array()), null);
  assert.deepEqual(fitInside(320, 120, 130, 48), { w: 128, h: 48 }); assert.equal(fitInside(10, 10, 130, 48).h, 48);
});
await t('logo data URLs: only small baseline JPEG data URLs are accepted (no PNG, no remote URL, no scripts, bounded size)', () => {
  assert.ok(isLogoDataUrl(dataUrl(jpg))); assert.ok(decodeLogo(dataUrl(jpg)) && decodeLogo(dataUrl(gray))!.components === 1);
  for (const bad of ['', null, 5, 'https://example.com/logo.jpg', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/jpeg;base64,@@@@', 'javascript:alert(1)', `data:image/jpeg;base64,${'A'.repeat(MAX_LOGO_CHARS)}`, 'data:image/jpeg;base64,AAAA']) assert.equal(isLogoDataUrl(bad) && decodeLogo(bad) !== null, false, String(bad).slice(0, 40));
  const s = normalizeSettings({ shop: { logo: dataUrl(jpg) } }); assert.equal(s.shop.logo, dataUrl(jpg)); assert.equal(normalizeSettings({ shop: { logo: 'https://evil.example/x.png' } }).shop.logo, '', 'a URL is dropped, never fetched');
  assert.equal(normalizeSettings({ shop: { logo: '<img src=x onerror=alert(1)>' } }).shop.logo, '');
});
await t('PDF with a logo: valid structure, the JPEG bytes embedded unchanged, drawn once at the top left, shop text moved right, other pages unaffected', () => {
  const inv = fx('many-lines-60'); const bytes = generatePdfBytes(inv, calculateTotals(inv), { labels: UPSTREAM_PDF_LABELS, logo: decodeLogo(dataUrl(jpg)) });
  assertStructure(bytes); const s = text(bytes);
  assert.ok(s.includes('/Subtype /Image') && s.includes('/Filter /DCTDecode') && s.includes('/Width 320') && s.includes('/Height 120') && s.includes('/ColorSpace /DeviceRGB') && s.includes(`/Length ${jpg.length}`));
  assert.ok(Buffer.from(bytes).includes(Buffer.from(jpg)), 'exact JPEG bytes present'); assert.equal((s.match(/\/Im1 Do/g) || []).length, 1, 'drawn once');
  assert.equal((s.match(/\/XObject <</g) || []).length, Number(/\/Count (\d+)/.exec(s)![1]), 'every page can reference it');
  assert.ok(s.includes('128.00 0 0 48.00 40.00 702.00 cm'), 'logo box: 128 x 48 pt at the top left');
  assert.ok(/1 0 0 1 180\.00 738\.00 Tm/.test(s), 'shop name starts right of the logo (40 + 128 + 12)');
  assert.ok(text(generatePdfBytes(inv, calculateTotals(inv), { labels: UPSTREAM_PDF_LABELS, logo: decodeLogo(dataUrl(gray)) })).includes('/ColorSpace /DeviceGray'));
});
await t('without a logo or links the output is still byte-identical to the original (golden hashes)', () => {
  for (const n of ['sample', 'every-fee', 'many-lines-60', 'odd-characters']) { const inv = fx(n); assert.equal(sha(generatePdfBytes(inv, calculateTotals(inv), { labels: UPSTREAM_PDF_LABELS, logo: null, payOptions: [] })), goldens[n].pdfSha256, n); }
});
await t('clickable pay links: one link annotation per linked line, over the printed text, with the exact URL; Zelle stays plain text', () => {
  const inv = { ...fx('basic-tax-parts-only'), meta: { ...fx('basic-tax-parts-only').meta, docType: 'invoice' } };
  const bytes = generatePdfBytes(inv, undefined, { payOptions: pay, paymentBoxes: ['Cash'] }); assertStructure(bytes); const s = text(bytes);
  assert.equal((s.match(/\/Subtype \/Link/g) || []).length, 2);
  assert.ok(s.includes('/URI (https://www.paypal.me/FuturesAuto/106.00USD)') && s.includes('/URI (https://venmo.com/future-auto?txn=pay&amount=106.00&note=Invoice%20T-1)') && !s.includes('/URI (Zelle'));
  assert.equal((s.match(/\/Annots \[/g) || []).length, 1, 'only the page with the block has annotations');
  const m = /\/Rect \[([\d. ]+)\]/.exec(s)!; const [x1, y1, x2, y2] = m[1].split(' ').map(Number); assert.ok(x1 === 40 && x2 > x1 + 100 && y2 - y1 === 10 && y1 > 60 && y2 < 752, `rect ${m[1]}`);
  const est = text(generatePdfBytes({ ...inv, meta: { ...inv.meta, docType: 'estimate' } }, undefined, { payOptions: pay })); assert.ok(!est.includes('/Subtype /Link'), 'estimates have no payment links');
});
await t('logo + links together on a multi-page invoice; the link lands on the right page and every object resolves', () => {
  const inv = fx('many-lines-60'); const bytes = generatePdfBytes(inv, undefined, { logo: decodeLogo(dataUrl(jpg)), payOptions: pay, paymentBoxes: ['Cash', 'Zelle'] });
  assertStructure(bytes); const s = text(bytes);
  const pages = Number(/\/Count (\d+)/.exec(s)![1]); assert.ok(pages >= 3);
  const annotated = [...s.matchAll(/\/Type \/Page\n[\s\S]*?\/Annots \[(\d+) 0 R (\d+) 0 R\]/g)]; assert.equal(annotated.length, 1);
  for (const id of [annotated[0][1], annotated[0][2]]) assert.ok(new RegExp(`${id} 0 obj\\n<<\\n  /Type /Annot`).test(s), `annotation ${id} exists`);
});
await t('render helpers: the user\'s logo appears in the PDF and the sheet; payment links are clickable in both', () => {
  const settings = normalizeSettings({ shop: { name: 'Example Auto', logo: dataUrl(jpg) }, payments: { paypal: { enabled: true, handle: 'FuturesAuto' }, zelle: { enabled: true, handle: 'pay@example.com' } } });
  const inv = { ...fx('basic-tax-parts-only'), meta: { ...fx('basic-tax-parts-only').meta, docType: 'invoice' } };
  const pdf = renderPdf(inv, settings).bytes; assertStructure(pdf); assert.ok(text(pdf).includes('/Subtype /Image') && text(pdf).includes('/Subtype /Link'));
  const sheet = renderSheet(inv, settings); assert.equal(sheet.model.shop.logo, dataUrl(jpg)); assert.deepEqual(sheet.payLines.map(l => !!l.url), [true, false]);
  assert.equal(buildSheetModel(inv).shop.logo, null); assert.equal(buildSheetModel(inv, undefined, undefined, { logo: 'https://evil.example/x.png' }).shop.logo, null, 'a non-data URL is never put on the sheet');
});
await t('a real PDF reader opens the files (poppler, when installed): page count, no syntax errors, text and image present', () => {
  if (!hasPoppler) { console.log('      (poppler not installed: skipped)'); return; }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ge-pdf-'));
  const cases: Record<string, Uint8Array> = {
    plain: generatePdfBytes(fx('sample')), logo: generatePdfBytes(fx('sample'), undefined, { logo: decodeLogo(dataUrl(jpg)) }),
    links: generatePdfBytes({ ...fx('basic-tax-parts-only') }, undefined, { payOptions: pay, paymentBoxes: ['Cash'] }), all: generatePdfBytes(fx('many-lines-60'), undefined, { logo: decodeLogo(dataUrl(gray)), payOptions: pay }),
  };
  for (const [name, bytes] of Object.entries(cases)) {
    const f = path.join(tmp, `${name}.pdf`); writeFileSync(f, bytes);
    const r = spawnSync('pdfinfo', [f], { encoding: 'utf8' }); assert.equal(r.status, 0, `${name}: ${r.stderr}`); assert.ok(!/error/i.test(r.stderr), `${name}: ${r.stderr}`);
    assert.equal(Number(/Pages:\s+(\d+)/.exec(r.stdout)![1]), Number(/\/Count (\d+)/.exec(text(bytes))![1]), `${name}: pages`);
  }
  const imgs = spawnSync('pdfimages', ['-list', path.join(tmp, 'logo.pdf')], { encoding: 'utf8' }); if (imgs.status === 0) assert.ok(/\s320\s+120\s/.test(imgs.stdout), `pdfimages: ${imgs.stdout}`);
});

console.log(`${passed} invoice logo checks passed`);
