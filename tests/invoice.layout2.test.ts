/**
 * The opt-in "layout 2" hardening and the additive PDF blocks (docs/INVOICING_PLAN.md §4.3 H1-H7, §5.11). Layout 1 stays byte-identical
 * to the original (that is invoice.parity's job); this suite proves layout 2 behaves as promised and that nothing leaks into layout 1.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatePdfBytes } from '../src/invoice/pdf/generate.ts';
import { helveticaWidth, getTextWidth, escapePdfText, escapePdfTextWinAnsi, wrapText } from '../src/invoice/pdf/text.ts';
import { calculateTotals } from '../src/invoice/totals.ts';
import { buildSheetModel } from '../src/invoice/sheet.ts';
import { createEmptyInvoice, addLaborItem, addPartItem } from '../src/invoice/model.ts';
import { normalizeInvoice } from '../src/invoice/normalize.ts';

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; } };
const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/invoice/${n}.json`, import.meta.url), 'utf8'));
const text = (inv: any, opts?: any) => Buffer.from(generatePdfBytes(inv, undefined, opts)).toString('latin1');
const L2 = (inv: any) => ({ ...inv, meta: { ...inv.meta, layout: 2 } });

await t('H1: real Helvetica widths (known values) differ from the old estimate', () => {
  assert.equal(Math.round(helveticaWidth('Hello', 10) * 100) / 100, 22.78); assert.equal(Math.round(helveticaWidth('Hello', 10, true) * 100) / 100, 24.45);
  assert.equal(helveticaWidth('', 8), 0); assert.ok(helveticaWidth('WWWW', 8) > helveticaWidth('iiii', 8) * 3); assert.notEqual(helveticaWidth('Hello', 10), getTextWidth('Hello', 10));
  const inv = fx('basic-tax-parts-only'); assert.notEqual(text(L2(inv)), text(inv), 'right-aligned text moves with real metrics');
});
await t('H3: WinAnsi characters beyond Latin-1 are written in layout 2 (€ … ™); everything else is unchanged; layout 1 still prints "?"', () => {
  assert.equal(escapePdfTextWinAnsi('5€ … ™'), '5\\200 \\205 \\231'); assert.equal(escapePdfTextWinAnsi('日本'), '??'); assert.equal(escapePdfTextWinAnsi('café (x)'), escapePdfText('café (x)'));
  const inv = { ...fx('basic-tax-parts-only'), notes: { customerNotes: 'Price 50€…', termsAndConditions: 'T' } };
  assert.ok(text(L2(inv)).includes('(Price 50\\200\\205) Tj')); assert.ok(text(inv).includes('(Price 50??) Tj'));
});
await t('H2: long descriptions wrap onto extra lines (layout 2), rows grow, every word is kept; layout 1 keeps one line', () => {
  const long = 'Replace the front left lower control arm bushing and inspect the ball joint tie rod ends and sway bar links for play'; // far wider than the column
  let inv = createEmptyInvoice({ meta: { invoiceNumber: 'W1' }, shop: { name: 'S' } }); inv = addLaborItem(inv, { id: 'l', description: long, hours: 1, rate: 10 }); inv = addPartItem(inv, { id: 'p', description: long, quantity: 1, unitPrice: 1 });
  const lines2 = wrapText(long, 224, 8, false, helveticaWidth); assert.ok(lines2.length >= 2 && lines2.join(' ') === long);
  const s2 = text(L2(inv)); const pieces = lines2.filter(l => s2.includes(`(${l}) Tj`)); assert.equal(pieces.length, lines2.length, 'every wrapped line is drawn');
  assert.ok(text(inv).includes(`(${long}) Tj`), 'layout 1 prints the description as one overflowing line, as the original');
  const many = createEmptyInvoice({ meta: { invoiceNumber: 'W2' } }); let big = many; for (let i = 0; i < 40; i++) big = addLaborItem(big, { id: `l${i}`, description: long, hours: 1, rate: 1 });
  assert.ok(Number(/\/Count (\d+)/.exec(text(L2(big)))![1]) > Number(/\/Count (\d+)/.exec(text(big))![1]), 'taller rows paginate sooner');
});
await t('H5: hideZeroRows leaves out $0.00 fee rows in layout 2 only (subtotals and the grand total always print)', () => {
  const inv = { ...fx('basic-tax-parts-only'), settings: { ...fx('basic-tax-parts-only').settings, shopSuppliesRate: 0, taxRate: 0, travelFee: 45 } };
  const hidden = text(L2(inv), { hideZeroRows: true });
  assert.ok(hidden.includes('(Travel Fee) Tj') && hidden.includes('(Labor Subtotal) Tj') && hidden.includes('(Grand Total) Tj'));
  for (const gone of ['(Shop Supplies Fee)', '(Hazardous Waste Fee)', '(Misc. Fee)', '(Discount Amount)', '(Tax Amount)']) assert.ok(!hidden.includes(gone), gone);
  assert.ok(text(inv, { hideZeroRows: true }).includes('(Tax Amount) Tj'), 'layout 1 ignores the option: the original always prints every row');
  const m = buildSheetModel(L2(inv), undefined, undefined, { hideZeroRows: true }); assert.deepEqual(m.totals.map(x => x.key), ['labor', 'parts', 'subtotal', 'travel', 'grand']);
  assert.equal(buildSheetModel(inv, undefined, undefined, { hideZeroRows: true }).totals.length, 10);
});
await t('H6/H7: layout 2 rounds each line first (subtotal = sum of shown lines) and shows two hour decimals on the sheet', () => {
  let inv = createEmptyInvoice({ meta: { invoiceNumber: 'R' } }); for (let i = 0; i < 3; i++) inv = addPartItem(inv, { id: `p${i}`, description: 'x', quantity: 1, unitPrice: 0.335 });
  const old = calculateTotals(inv).partsSubtotal, hard = calculateTotals(L2(inv)).partsSubtotal;
  assert.equal(old, 1.01); assert.equal(hard, 1.02, '3 × $0.34 shown'); 
  const lab = addLaborItem(createEmptyInvoice({}), { id: 'l', description: 'x', hours: 1.25, rate: 10 });
  assert.equal(buildSheetModel(lab).labor.rows[0].hours, '1.3'); assert.equal(buildSheetModel(L2(lab)).labor.rows[0].hours, '1.25');
  assert.equal(calculateTotals(normalizeInvoice(L2(lab))).laborSubtotal, calculateTotals(L2(lab)).laborSubtotal, 'layout survives normalization');
});
await t('How to pay + Payment received: only on FINAL invoices; absent options change nothing; long links wrap; nothing is cut off', () => {
  const inv = { ...fx('basic-tax-parts-only'), meta: { ...fx('basic-tax-parts-only').meta, docType: 'invoice' } };
  const base = text(inv); const pay = [{ label: 'PayPal', text: 'PayPal: https://www.paypal.me/FuturesAuto/106.00USD' }, { label: 'Zelle', text: 'Zelle: pay@example.com (memo: TEST-A00001)' }];
  const withPay = text(inv, { payOptions: pay, paymentBoxes: ['Cash', 'Zelle'] });
  assert.ok(withPay.includes('(HOW TO PAY) Tj') && withPay.includes('(PayPal: https://www.paypal.me/FuturesAuto/106.00USD) Tj') && withPay.includes('(Payment received:   [ ] Cash    [ ] Zelle) Tj'));
  assert.ok(!base.includes('HOW TO PAY') && !base.includes('Payment received'));
  const est = text({ ...inv, meta: { ...inv.meta, docType: 'estimate' } }, { payOptions: pay, paymentBoxes: ['Cash'] }); assert.ok(!est.includes('HOW TO PAY') && !est.includes('Payment received'), 'estimates never show payment instructions');
  const many = text(fx('many-lines-60'), { payOptions: pay, paymentBoxes: ['Cash'] }); // no docType in the fixture: it is an invoice
  const pages = Number(/\/Count (\d+)/.exec(many)![1]);
  assert.ok(many.includes('(HOW TO PAY) Tj') && pages >= 3); for (let p = 1; p <= pages; p++) assert.ok(many.includes(`(Page ${p} of ${pages}) Tj`), `footer ${p}`);
});
await t('layout 1 is unaffected by every layout-2 helper (the golden hashes are checked in invoice.parity)', () => {
  const inv = fx('every-fee'); assert.equal(text(inv), text({ ...inv, meta: { ...inv.meta, layout: 1 } }));
});

console.log(`${passed} invoice layout2 checks passed`);
