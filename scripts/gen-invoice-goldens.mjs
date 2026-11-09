#!/usr/bin/env node
/**
 * Generates the reference invoices and their golden PDF hashes from the vendored original (tests/reference/automotive).
 *
 *   node scripts/gen-invoice-goldens.mjs          # rewrite tests/fixtures/invoice/*.json and goldens.json
 *   node scripts/gen-invoice-goldens.mjs --check  # fail if the committed fixtures differ from what the oracle produces
 *
 * Every fixture states every value explicitly (shop, terms, settings, dates) so that upstream's *defaults* never leak
 * into a parity comparison (plan §4.2). The oracle is test-only and must never be imported by app code.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const refDir = path.join(root, 'tests/reference/automotive');
const outDir = path.join(root, 'tests/fixtures/invoice');
const check = process.argv.includes('--check');

const model = await import(path.join(refDir, 'model.js'));
const pdf = await import(path.join(refDir, 'pdf.js'));

// Pin the oracle so an accidental edit cannot silently move the goldens.
const EXPECTED = { 'model.js': '0a858dfbadb79603a3cc9f9e0b954bbd46987ad00e471357e03398925126ecb4', 'pdf.js': '70696f979f7fb4d7d73e4a4a857919b2df6ede7bbc54a25d887c049dc3af27fe' };
for (const [f, h] of Object.entries(EXPECTED)) {
  const actual = createHash('sha256').update(readFileSync(path.join(refDir, f))).digest('hex');
  if (actual !== h) { console.error(`Oracle ${f} changed (${actual}); update UPSTREAM.md and this script deliberately.`); process.exit(1); }
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Fully explicit blank invoice. */
function base(over = {}) {
  return {
    meta: { invoiceNumber: 'TEST-A00001', date: '2026-01-15', dueDate: '2026-01-29', status: 'Draft', ...(over.meta || {}) },
    shop: { name: 'Example Auto Service', address: '100 Example Road, Sampletown, ST 00000', phone: '(555) 010-0100', email: 'shop@example.com', licenseNumber: 'LIC-0001', ...(over.shop || {}) },
    customer: { name: 'Pat Example', phone: '(555) 010-0199', email: 'pat@example.com', address: '200 Sample Street, Sampletown, ST 00000', ...(over.customer || {}) },
    vehicle: { year: '2018', make: 'Toyota', model: 'Tacoma', vin: '5TFAX5GN0JX000000', licensePlate: 'ABC1234', mileage: '84210', engine: '3.5L V6', serviceAdvisor: 'Sam', ...(over.vehicle || {}) },
    laborItems: over.laborItems || [],
    partItems: over.partItems || [],
    settings: { taxRate: 0, taxLabor: false, discountType: 'percent', discountValue: 0, shopSuppliesRate: 0, shopSuppliesCap: 0, hazardousWasteFee: 0, travelFee: 0, miscFee: 0, ...(over.settings || {}) },
    notes: { customerNotes: '', termsAndConditions: 'Payment due on receipt.', ...(over.notes || {}) },
  };
}

const labor = (n, f = (i) => ({})) => Array.from({ length: n }, (_, i) => ({ description: `Service task ${i + 1}`, technician: `Tech ${(i % 3) + 1}`, hours: 0.5 + (i % 4) * 0.25, rate: 55, ...f(i) }));
const parts = (n, f = (i) => ({})) => Array.from({ length: n }, (_, i) => ({ partNumber: `PN-${1000 + i}`, description: `Part item ${i + 1}`, quantity: 1 + (i % 3), unitPrice: 4.5 + i * 1.25, ...f(i) }));
const lorem = 'The quick brown fox jumps over the lazy dog while the technician inspects every fastener, fitting and fluid level twice before releasing the vehicle back to its owner. ';

const sampleRaw = model.createSampleInvoice();
const sample = JSON.parse(JSON.stringify(sampleRaw));
sample.meta = { invoiceNumber: 'INV-2026-1001', date: '2026-01-15', dueDate: '2026-01-29', status: 'Approved' };

const fixtures = {
  sample,
  empty: base({ shop: { licenseNumber: '' } }),
  'blank-fields': base({ meta: { invoiceNumber: '', date: '', dueDate: '', status: '' }, shop: { name: '', address: '', phone: '', email: '', licenseNumber: '' },
    customer: { name: '', phone: '', email: '', address: '' }, vehicle: { year: '', make: '', model: '', vin: '', licensePlate: '', mileage: '', engine: '', serviceAdvisor: '' },
    notes: { customerNotes: '', termsAndConditions: '' } }),
  'basic-tax-parts-only': base({ laborItems: labor(2), partItems: parts(3), settings: { taxRate: 6, shopSuppliesRate: 5, shopSuppliesCap: 35 }, notes: { customerNotes: 'Thanks for your business.' } }),
  'every-fee': base({ laborItems: labor(3), partItems: parts(2), settings: { taxRate: 8.25, taxLabor: true, shopSuppliesRate: 10, shopSuppliesCap: 12.5, hazardousWasteFee: 3.5, travelFee: 45, miscFee: 7.25, discountType: 'fixed', discountValue: 5 } }),
  'discount-percent': base({ laborItems: labor(2), partItems: parts(2), settings: { taxRate: 7, taxLabor: true, discountType: 'percent', discountValue: 12.5, shopSuppliesRate: 5, shopSuppliesCap: 35 } }),
  'discount-fixed-clamped': base({ laborItems: labor(1), partItems: parts(1), settings: { taxRate: 5, discountType: 'fixed', discountValue: 9999 } }),
  'zero-fees': base({ laborItems: [], partItems: [] }),
  'estimate-status': base({ meta: { status: 'Estimate', invoiceNumber: 'EST-A00007' }, laborItems: labor(2), settings: { travelFee: 45 } }),
  'many-lines-60': base({ laborItems: labor(40), partItems: parts(20), settings: { taxRate: 6, shopSuppliesRate: 5, shopSuppliesCap: 35 } }),
  'long-notes': base({ laborItems: labor(2), partItems: parts(1), notes: { customerNotes: lorem.repeat(14), termsAndConditions: (lorem.repeat(6) + '\n\nSecond paragraph. ' + lorem.repeat(5)) } }),
  'odd-characters': base({
    shop: { name: 'Caf\u00e9 \u201CQuoted\u201D Auto & Sons (Est. 1999)' },
    customer: { name: 'Jos\u00e9 Mu\u00f1oz \u2013 Jr.', address: 'C:\\Users\\path (back\\slash) \u2022 unit #4' },
    vehicle: { make: 'Citro\u00ebn', model: '\u65e5\u672c\u8a9e \ud83d\ude97', serviceAdvisor: 'A\u00a0B' },
    laborItems: [{ description: 'Replace \u201Csmart\u201D key (2 of 2) \u2014 programmed', technician: '\u00d8yvind', hours: 1.25, rate: 55 }],
    partItems: [{ partNumber: 'X/1-\u2018A\u2019', description: 'Seal (rear) \\ gasket \t tab', quantity: 2, unitPrice: 12.5 }],
    notes: { customerNotes: 'Line one\nLine two (with parens)\n\n\nLine four \\ slash', termsAndConditions: 'Terms with \u201Cquotes\u201D and \u2014 dashes \u2022 bullets' } }),
  'float-edge': base({ laborItems: [{ description: 'Odd rounding', technician: 'T', hours: 0.1, rate: 0.7 }, { description: 'More', technician: 'T', hours: 1 / 3, rate: 30 }],
    partItems: [{ partNumber: 'P', description: 'cent edge', quantity: 3, unitPrice: 0.335 }], settings: { taxRate: 8.875, taxLabor: true, shopSuppliesRate: 3.3, shopSuppliesCap: 99 } }),
  'large-amounts': base({ laborItems: [{ description: 'Engine rebuild', technician: 'Lead', hours: 120, rate: 185.5 }], partItems: [{ partNumber: 'ENG-1', description: 'Crate engine', quantity: 1, unitPrice: 8999.99 }, { partNumber: 'ENG-2', description: 'Parts kit', quantity: 12, unitPrice: 1234.5 }], settings: { taxRate: 6, taxLabor: false } }),
};

// Deterministic line ids (the generator output must not depend on the clock or randomness).
for (const inv of Object.values(fixtures)) {
  inv.laborItems.forEach((it, i) => { it.id = `labor-${i + 1}`; });
  inv.partItems.forEach((it, i) => { it.id = `part-${i + 1}`; });
}

const goldens = {};
const files = {};
for (const [name, invoice] of Object.entries(fixtures)) {
  const totals = model.calculateTotals(invoice);
  const bytes = pdf.generatePdfBytes(invoice, totals);
  const text = Buffer.from(bytes).toString('latin1');
  files[`${name}.json`] = JSON.stringify(invoice, null, 2) + '\n';
  goldens[name] = { pdfSha256: sha(bytes), pdfLength: bytes.length, pages: Number(/\/Count (\d+)/.exec(text)[1]), totals };
}
files['goldens.json'] = JSON.stringify({ oracle: EXPECTED, goldens }, null, 2) + '\n';

if (check) {
  let bad = 0;
  for (const [f, content] of Object.entries(files)) {
    let current = null;
    try { current = readFileSync(path.join(outDir, f), 'utf8'); } catch {}
    if (current !== content) { console.error(`DIFFERS: ${f}`); bad++; }
  }
  const extra = readdirSync(outDir).filter(f => f.endsWith('.json') && !(f in files));
  for (const f of extra) { console.error(`UNEXPECTED: ${f}`); bad++; }
  if (bad) process.exit(1);
  console.log(`fixtures match the oracle (${Object.keys(fixtures).length} invoices)`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [f, content] of Object.entries(files)) writeFileSync(path.join(outDir, f), content);
  console.log(`wrote ${Object.keys(fixtures).length} fixtures + goldens.json to ${path.relative(root, outDir)}`);
  for (const [n, g] of Object.entries(goldens)) console.log(`  ${n.padEnd(24)} ${String(g.pages).padStart(2)} page(s)  ${g.pdfSha256.slice(0, 16)}…`);
}
