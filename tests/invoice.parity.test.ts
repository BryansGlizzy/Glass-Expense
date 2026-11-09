/**
 * PDF parity: the TypeScript writer must produce BYTE-IDENTICAL output to the original automotive-pdf app
 * (success criterion 1 in docs/INVOICING_PLAN.md). Three layers:
 *   1. golden SHA-256 hashes for the reference invoices (tests/fixtures/invoice/goldens.json),
 *   2. a differential run against the vendored oracle on randomized invoices (seeded, reproducible),
 *   3. determinism and structural checks (pagination, footers, xref).
 * Pure: needs no server.   Run:  npx tsx tests/invoice.parity.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generatePdfBytes, pdfFilename } from '../src/invoice/pdf/generate.ts';
import { calculateTotals } from '../src/invoice/totals.ts';
import { escapePdfText, wrapText } from '../src/invoice/pdf/text.ts';
// @ts-ignore  vendored original (plain JS), test-only
import * as oracleModel from './reference/automotive/model.js';
// @ts-ignore
import * as oraclePdf from './reference/automotive/pdf.js';
import { UPSTREAM_PDF_LABELS } from './reference/automotive/labels.ts';

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); process.exitCode = 1; } };

const dir = new URL('./fixtures/invoice/', import.meta.url);
const { goldens, oracle: pinned } = JSON.parse(readFileSync(new URL('goldens.json', dir), 'utf8'));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const ours = (inv: any, totals = calculateTotals(inv)) => generatePdfBytes(inv, totals, { labels: UPSTREAM_PDF_LABELS });
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');

await t('the vendored oracle is exactly the pinned upstream source', () => {
  for (const f of ['model.js', 'pdf.js']) assert.equal(sha(readFileSync(new URL(`./reference/automotive/${f}`, import.meta.url))), pinned[f], `${f} changed; see tests/reference/automotive/UPSTREAM.md`);
});

await t(`golden hashes: every reference invoice (${Object.keys(goldens).length}) produces the original's exact bytes`, () => {
  for (const [name, g] of Object.entries<any>(goldens)) {
    const inv = JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'));
    const bytes = ours(inv);
    assert.equal(sha(bytes), g.pdfSha256, `${name}: PDF bytes differ from the original`);
    assert.equal(bytes.length, g.pdfLength, `${name}: length`);
    assert.equal(Number(/\/Count (\d+)/.exec(text(bytes))![1]), g.pages, `${name}: page count`);
  }
});

await t('totals engine matches the original on every reference invoice (all eleven fields)', () => {
  for (const name of Object.keys(goldens)) {
    const inv = JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8'));
    assert.deepEqual(calculateTotals(inv), oracleModel.calculateTotals(inv), name);
    assert.deepEqual(calculateTotals(inv), goldens[name].totals, `${name}: golden totals`);
  }
});

// ── differential fuzz ────────────────────────────────────────────────────────
function rng(seed: number) { // mulberry32: reproducible; a failure prints its seed
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const WORDS = ['brake', 'rotor', 'oil', 'filter', 'check', 'engine', 'light', 'A/C', 'battery', 'tire', '(left)', 'rear\\', 'café', '“quote”', '—', '•', '#4', '$5', '日本', '🚗', 'x', 'service', 'inspection', 'replacement'];
function makeRandom(seed: number) {
  const r = rng(seed);
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const pick = <T,>(xs: T[]) => xs[int(0, xs.length - 1)];
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const maybe = (s: string, p = 0.8) => (r() < p ? s : '');
  const money = () => pick([0, 0, 1, 12.5, 0.335, 99.99, 1234.567, 55, 0.1, 7.255, int(0, 500) / 4]);
  const inv: any = {
    meta: { invoiceNumber: maybe(`T-${int(1, 99999)}`, 0.85), date: maybe('2026-03-04', 0.9), dueDate: maybe('2026-03-18', 0.7), status: pick(['Draft', 'Estimate', 'Approved', 'Paid', 'Overdue', '']) },
    shop: { name: maybe(words(int(1, 3))), address: maybe(words(int(2, 6))), phone: maybe('(555) 010-0100'), email: maybe('a@b.co', 0.6), licenseNumber: maybe(`L${int(1, 9999)}`, 0.5) },
    customer: { name: maybe(words(int(1, 3))), phone: maybe('555'), email: maybe('c@d.co', 0.5), address: maybe(words(int(2, 8)), 0.6) },
    vehicle: { year: maybe(String(int(1990, 2026))), make: maybe(words(1)), model: maybe(words(1)), vin: maybe('1HGCV1F34MA012345', 0.6), licensePlate: maybe(words(1), 0.5), mileage: maybe(String(int(1, 300000)), 0.6), engine: maybe(words(1), 0.5), serviceAdvisor: maybe(words(1), 0.4) },
    laborItems: Array.from({ length: pick([0, 0, 1, 2, 5, 12, 30, 45]) }, (_, i) => ({ id: `l${i}`, description: maybe(words(int(1, 8))), technician: maybe(words(1), 0.6), hours: pick([0, 0.25, 1, 1.5, 2.333, 0.1, 8]), rate: money() })),
    partItems: Array.from({ length: pick([0, 0, 1, 3, 8, 20, 40]) }, (_, i) => ({ id: `p${i}`, partNumber: maybe(`PN-${int(1, 999)}`, 0.7), description: maybe(words(int(1, 8))), quantity: pick([0, 1, 2, 3, 10, 2.5]), unitPrice: money() })),
    settings: { taxRate: pick([0, 6, 8.25, 8.875, 10]), taxLabor: r() < 0.4, discountType: pick(['percent', 'fixed']), discountValue: pick([0, 0, 5, 12.5, 100, 9999]), shopSuppliesRate: pick([0, 3.3, 5, 10]), shopSuppliesCap: pick([0, 12.5, 35, 99]), hazardousWasteFee: pick([0, 0, 3.5]), travelFee: pick([0, 0, 45]), miscFee: pick([0, 0, 7.25]) },
    notes: { customerNotes: maybe(words(int(1, 120)), 0.6), termsAndConditions: maybe(words(int(1, 90)) + (r() < 0.3 ? '\n\n' + words(int(1, 30)) : ''), 0.7) },
  };
  return inv;
}

await t('differential: 1,000 seeded random invoices are byte-identical to the original (explicit totals)', () => {
  let multi = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const inv = makeRandom(seed);
    const totals = oracleModel.calculateTotals(inv);
    const a = ours(inv, totals);
    const b = oraclePdf.generatePdfBytes(inv, totals);
    assert.ok(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0, `seed ${seed}: PDF bytes differ from the original`);
    if (Number(/\/Count (\d+)/.exec(text(a))![1]) > 1) multi++;
  }
  assert.ok(multi > 50, `fuzz should exercise pagination (multi-page cases: ${multi})`);
});

await t('differential: 300 random invoices with totals omitted (the port derives them from the single engine)', () => {
  for (let seed = 2001; seed <= 2300; seed++) {
    const inv = makeRandom(seed);
    // The original falls back to its own copy of the math when totals are omitted. With every setting explicit (as here and in
    // the app) the two copies agree; that is exactly the case the port supports (plan D4 drops the hidden fallbacks).
    const a = generatePdfBytes(inv, undefined, { labels: UPSTREAM_PDF_LABELS });
    const b = oraclePdf.generatePdfBytes(inv);
    assert.ok(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0, `seed ${seed}: PDF bytes differ when totals are derived`);
  }
});

await t('differential: odd inputs (missing sections, numbers as strings, nulls, empty object) match the original', () => {
  const cases: any[] = [
    {}, undefined, null, { meta: null, laborItems: null, partItems: 'x', settings: [] },
    { laborItems: [{ hours: '2', rate: '55.5', description: 'strings' }], partItems: [{ quantity: '3', unitPrice: '1.25' }], settings: { taxRate: '8', shopSuppliesRate: '5', shopSuppliesCap: '35' } },
    { laborItems: [{ hours: 'abc', rate: null }, { hours: -1, rate: 10 }], partItems: [{ quantity: NaN, unitPrice: Infinity }], settings: { discountType: 'fixed', discountValue: -5, taxRate: 0, shopSuppliesRate: 0, shopSuppliesCap: 0 } },
    { vehicle: { mileage: 12345, year: 2020 }, customer: { name: 12345 } },
  ];
  for (const [i, c] of cases.entries()) {
    const totals = c && typeof c === 'object' ? oracleModel.calculateTotals(c) : undefined;
    // `settings: []` and similar garbage: the original treats a missing totals argument via its own fallback; keep totals explicit.
    const a = generatePdfBytes(c as any, totals, { labels: UPSTREAM_PDF_LABELS });
    const b = oraclePdf.generatePdfBytes(c, totals);
    assert.ok(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0, `case ${i}: bytes differ`);
  }
});

// ── determinism & structure ─────────────────────────────────────────────────
await t('deterministic: same input, same bytes, regardless of time (no clock or randomness in the PDF path)', async () => {
  const inv = JSON.parse(readFileSync(new URL('sample.json', dir), 'utf8'));
  const first = sha(ours(inv));
  const RealDate = Date; const realRandom = Math.random;
  try {
    (globalThis as any).Date = class extends RealDate { constructor(...a: any[]) { super(...((a.length ? a : [4102444800000]) as [number])); } static now() { return 4102444800000; } };
    Math.random = () => 0.123456;
    assert.equal(sha(ours(inv)), first, 'output changed when Date/Math.random changed');
  } finally { (globalThis as any).Date = RealDate; Math.random = realRandom; }
  assert.equal(sha(ours(inv)), first);
});

await t('structure: PDF-1.4, xref offsets are correct, startxref points at the table, every page has a footer "Page n of N"', () => {
  const inv = JSON.parse(readFileSync(new URL('many-lines-60.json', dir), 'utf8'));
  const bytes = ours(inv); const s = text(bytes);
  assert.equal(s.slice(0, 8), '%PDF-1.4');
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  const startxref = Number(/startxref\n(\d+)/.exec(s)![1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');
  const entries = [...s.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map(m => Number(m[1]));
  entries.forEach((off, i) => assert.ok(new RegExp(`^${i + 1} 0 obj`).test(s.slice(off, off + 12)), `xref entry ${i + 1} does not point at its object`));
  const pages = Number(/\/Count (\d+)/.exec(s)![1]);
  assert.ok(pages >= 3);
  for (let p = 1; p <= pages; p++) assert.ok(s.includes(`(Page ${p} of ${pages}) Tj`), `footer for page ${p}`);
  // continuation header: the em dash in the template is written as "-" by the escaper; parentheses are escaped
  assert.ok(s.includes('(Example Auto Service - Invoice TEST-A00001 \\(Page 2\\)) Tj'), 'continuation header on page 2');
  assert.ok(s.includes('Customer Authorization Signature'), 'signature line');
});

await t('labels: defaults are neutral (no upstream brand, legal text, tax or supplies numbers appear)', () => {
  const inv: any = { meta: {}, shop: {}, customer: {}, vehicle: {}, laborItems: [], partItems: [], settings: {}, notes: {} };
  const s = text(generatePdfBytes(inv));
  for (const bad of ["Future", 'Automotive', 'warranty', 'lien', 'Auto Workshop', 'ARD', 'INV-DRAFT', '8.25']) assert.ok(!s.includes(bad), `default output contains "${bad}"`);
  // and the structure the plan promises to keep: every fee row, even at $0.00, plus the signature line
  for (const row of ['(Shop Supplies Fee)', '(Hazardous Waste Fee)', '(Travel Fee)', '(Misc. Fee)', '(Discount Amount)', '(Tax Amount)', '(Grand Total)']) assert.ok(s.includes(row), `missing ${row}`);
});

await t('labels: estimate documents change the title, the due-date label and the number label only', () => {
  const inv = JSON.parse(readFileSync(new URL('basic-tax-parts-only.json', dir), 'utf8'));
  const est = text(generatePdfBytes({ ...inv, meta: { ...inv.meta, docType: 'estimate' } }));
  assert.ok(est.includes('(ESTIMATE) Tj') && est.includes('(Estimate #: TEST-A00001) Tj') && est.includes('(Valid Until: 2026-01-29) Tj'));
  const invText = text(generatePdfBytes(inv));
  assert.ok(invText.includes('(INVOICE) Tj') && invText.includes('(Invoice #: TEST-A00001) Tj') && invText.includes('(Due Date: 2026-01-29) Tj'));
});

await t('labels: custom fee names, signature text and footer brand are honoured', () => {
  const inv = JSON.parse(readFileSync(new URL('every-fee.json', dir), 'utf8'));
  const s = text(generatePdfBytes(inv, undefined, { labels: { totals: { travel: 'Diagnostic/Travel', shopSupplies: 'Shop Supplies/Disposal' }, signatureText: { invoice: 'Work completed as described.' }, footerBrand: 'Acme' } }));
  assert.ok(s.includes('(Diagnostic/Travel) Tj') && s.includes('(Shop Supplies/Disposal) Tj') && s.includes('(Work completed as described.) Tj') && s.includes('(Acme  *  TEST-A00001) Tj'));
  const noBrand = text(generatePdfBytes({ ...inv, shop: { ...inv.shop, name: '' } }));
  assert.ok(noBrand.includes('(TEST-A00001) Tj'), 'without a brand the footer is just the number');
});

await t('text helpers: escaping, wrapping and file names', () => {
  assert.equal(escapePdfText('a(b)c\\d'), 'a\\(b\\)c\\\\d');
  assert.equal(escapePdfText(null), '');
  assert.equal(escapePdfText('“x” — é 日'), '"x" - \\351 ?');
  assert.deepEqual(wrapText('', 100, 8), []);
  assert.ok(wrapText('word '.repeat(100), 280, 8).length > 1);
  assert.equal(pdfFilename({ meta: { invoiceNumber: 'INV-1' } }), 'invoice-INV-1.pdf');
  assert.equal(pdfFilename({}), 'invoice-draft.pdf');
  assert.equal(pdfFilename({ meta: { invoiceNumber: '../../etc/x:y' } }), 'invoice-.._.._etc_x_y.pdf');
});

console.log(`${passed} invoice parity checks passed`);
