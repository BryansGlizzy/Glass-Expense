/**
 * The sheet view-model: `buildSheetModel` is the single source of every string and number the preview, the print view and the PDF show.
 * GE has no DOM test framework (docs/DOCUMENTATION.md §13.2, C14), so the rules (rows, labels, fallbacks, totals box) are restated
 * here independently and compared with the model for every reference invoice.
 * Pure: needs no server.   Run:  npx tsx tests/invoice.sheet.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildSheetModel } from '../src/invoice/sheet.ts';
import { calculateTotals } from '../src/invoice/totals.ts';
import { DEFAULT_SHEET_LABELS } from '../src/invoice/labels.ts';
import { formatCurrency } from '../src/invoice/format.ts';
import type { DeepPartial, SheetLabels } from '../src/invoice/labels.ts';

/** A wording set with the strings a traditional repair shop would use, to prove labels are data and the model follows them. */
const SHOP_LABELS: DeepPartial<SheetLabels> = {
  numberFallback: 'INV-DRAFT',
  termsHeading: 'Terms & Warranty Policy',
  termsEmpty: 'Standard shop warranty and liability disclaimer.',
  signatureText: {
    invoice: "I hereby authorize the repair work listed above along with necessary materials. An express mechanic's lien is acknowledged on the vehicle to secure the amount of repairs.",
    estimate: "I hereby authorize the repair work listed above along with necessary materials. An express mechanic's lien is acknowledged on the vehicle to secure the amount of repairs.",
  },
};

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); process.exitCode = 1; } };

const dir = new URL('./fixtures/invoice/', import.meta.url);
const names: string[] = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
const load = (n: string) => JSON.parse(readFileSync(new URL(`${n}.json`, dir), 'utf8'));

/** The sheet's rules, restated independently of `buildSheetModel`. */
function expectedSheet(inv: any) {
  const totals = calculateTotals(inv); const f = formatCurrency;
  const s = inv.shop || {}, m = inv.meta || {}, c = inv.customer || {}, v = inv.vehicle || {};
  return {
    shopName: s.name || "Future's Automotive",                                                      // :734 (fallback is a label now)
    shopAddress: s.address || '', shopContact: [s.phone || '', s.email || ''].filter(Boolean).join(' • '), // :736-739
    license: s.licenseNumber || null,                                                               // :743
    number: m.invoiceNumber || 'INV-DRAFT', date: m.date || '—', due: m.dueDate || '—',   // :754-756
    badge: ((m.status || 'Draft') === 'Draft' && m.docType !== 'estimate' ? 'Final' : (m.status || 'Draft')).toUpperCase(),   // "Draft" reads "Final" on invoices (the only deliberate difference)                                                     // :495
    customerName: c.name || 'Walk-in Customer',                                                     // :760
    details: [c.phone, c.email, c.address].filter(Boolean),                                         // :762-766
    ymm: [v.year, v.make, v.model].filter(Boolean).join(' ') || '—',                           // :771-776
    mileage: v.mileage ? `${v.mileage} mi` : '—',                                              // :779
    laborRows: (inv.laborItems || []).map((i: any) => [i.description || 'Labor Service', i.technician || '—', (Number(i.hours) || 0).toFixed(1), f(i.rate || 0), f((Number(i.hours) || 0) * (Number(i.rate) || 0))]), // :795-799
    partRows: (inv.partItems || []).map((i: any) => [i.partNumber || '—', i.description || 'Part Item', String(Number(i.quantity) || 0), f(i.unitPrice || 0), f((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0))]), // :819-823
    notes: inv.notes?.customerNotes || 'No special customer notes.',                                // :832
    terms: inv.notes?.termsAndConditions || 'Standard shop warranty and liability disclaimer.',     // :833
    totals: [f(totals.laborSubtotal), f(totals.partsSubtotal), f(totals.subtotal),                  // :836-846
      totals.discountAmount > 0 ? `-${f(totals.discountAmount)}` : f(0),
      f(totals.shopSuppliesFee), f(totals.hazardousWasteFee), f(totals.travelFee), f(totals.miscFee), f(totals.taxAmount), f(totals.grandTotal)],
    taxLabel: `Sales Tax (${inv.settings?.taxRate ?? 8.25}%):`,                                     // :844
    laborSubtotal: f(totals.laborSubtotal), partsSubtotal: f(totals.partsSubtotal),
  };
}

await t(`every reference invoice (${names.length}): the sheet model follows the documented rules`, () => {
  for (const n of names) {
    const inv = load(n); const e = expectedSheet(inv);
    const m = buildSheetModel(inv, calculateTotals(inv), { ...SHOP_LABELS });
    const at = (what: string) => `${n}: ${what}`;
    assert.equal(m.shop.name || 'Future\'s Automotive', e.shopName, at('shop name'));
    assert.equal(m.shop.address, e.shopAddress, at('address')); assert.equal(m.shop.contact, e.shopContact, at('contact')); assert.equal(m.shop.license, e.license, at('license'));
    assert.deepEqual(m.meta.map(x => x.value), [e.number, e.date, e.due], at('meta'));
    assert.equal(m.status.badgeText, e.badge, at('badge'));
    assert.equal(m.customer.name, e.customerName, at('customer name')); assert.deepEqual(m.customer.details, e.details, at('details'));
    assert.equal(m.vehicle.attrs[0].value, e.ymm, at('ymm')); assert.equal(m.vehicle.attrs[3].value, e.mileage, at('mileage'));
    assert.deepEqual(m.labor.rows.map(r => [r.description, r.technician, r.hours, r.rate, r.amount]), e.laborRows, at('labor rows'));
    assert.deepEqual(m.parts.rows.map(r => [r.partNumber, r.description, r.quantity, r.unitPrice, r.amount]), e.partRows, at('part rows'));
    assert.equal(m.notes.customer.text, e.notes, at('notes')); assert.equal(m.notes.terms.text, e.terms, at('terms'));
    assert.deepEqual(m.totals.map(x => x.value), e.totals, at('totals box'));
    assert.equal(m.totals.find(x => x.key === 'tax')!.label, e.taxLabel, at('tax label'));
    assert.equal(m.labor.subtotal, e.laborSubtotal, at('labor subtotal')); assert.equal(m.parts.subtotal, e.partsSubtotal, at('parts subtotal'));
  }
});

await t('the sample: sections, order and labels', () => {
  const inv = load('sample'); const m = buildSheetModel(inv, undefined, { ...SHOP_LABELS });
  assert.equal(m.title, 'INVOICE');
  assert.deepEqual(m.meta.map(x => x.label), ['Invoice #:', 'Date:', 'Due Date:']);
  assert.equal(m.customer.heading, 'Customer'); assert.equal(m.vehicle.heading, 'Vehicle Information');
  assert.deepEqual(m.vehicle.attrs.map(a => a.label), ['Year / Make / Model', 'VIN', 'License Plate', 'Mileage', 'Engine / Trim', 'Service Advisor']);
  assert.deepEqual(m.vehicle.attrs.map(a => !!a.mono), [false, true, true, false, false, false], 'VIN and plate are monospace');
  assert.equal(m.labor.heading, 'Labor & Diagnostic Services'); assert.deepEqual(m.labor.columns, ['Service Description', 'Technician', 'Hours', 'Rate', 'Amount']);
  assert.equal(m.parts.heading, 'Parts & Materials'); assert.deepEqual(m.parts.columns, ['Part #', 'Description', 'Qty', 'Unit Price', 'Amount']);
  assert.equal(m.notes.customer.heading, 'Customer Notes / Recommendations'); assert.equal(m.notes.terms.heading, 'Terms & Warranty Policy');
  assert.deepEqual(m.totals.map(x => x.label), ['Labor Subtotal:', 'Parts Subtotal:', 'Subtotal:', 'Discount:', 'Shop Supplies:', 'Hazardous Waste:', 'Travel Fee:', 'Misc. Fee:', 'Sales Tax (8.25%):', 'Total Due:']);
  assert.deepEqual(m.totals.filter(x => x.bold || x.grand).map(x => x.key), ['subtotal', 'grand'], 'only Subtotal and Total Due are emphasised');
  assert.deepEqual(m.signature, { text: m.signature.text, customerCaption: 'Customer Signature', dateCaption: 'Date' });
  assert.match(m.signature.text, /mechanic's lien is acknowledged on the vehicle/);
  assert.deepEqual(m.labor.rows[0], { description: 'Synthetic oil and filter change', technician: 'Alex Chen', hours: '0.6', rate: '$95.00', amount: '$57.00' });
  assert.equal(m.status.cssClass, 'badge-approved');
});

await t('quirks kept by default: hours show one decimal on the sheet; every fee row is listed even at $0.00', () => {
  const m = buildSheetModel({ laborItems: [{ description: 'x', hours: 1.25, rate: 10 }], settings: {} });
  assert.equal(m.labor.rows[0].hours, '1.3'); // the sheet shows one decimal (1.25 becomes 1.3)
  assert.equal(m.totals.length, 10); assert.ok(m.totals.every(x => /^-?\$[\d,]+\.\d\d$/.test(x.value)));
  assert.equal(m.totals.find(x => x.key === 'discount')!.value, '$0.00', 'no discount: shown as $0.00 without a minus sign');
});

await t('empty invoice uses the placeholders (walk-in customer, dashes, empty-table messages)', () => {
  const m = buildSheetModel({}); const L = DEFAULT_SHEET_LABELS;
  assert.equal(m.customer.name, L.walkInCustomer); assert.deepEqual(m.customer.details, []); assert.equal(m.customer.emptyText, L.noContactDetails);
  assert.ok(m.vehicle.attrs.every(a => a.value === L.blank)); assert.deepEqual(m.meta.map(x => x.value), [L.numberFallback, L.blank, L.blank]);
  assert.equal(m.labor.rows.length, 0); assert.equal(m.labor.emptyText, 'No labor services'); assert.equal(m.parts.emptyText, 'No parts or materials');
  assert.equal(m.notes.customer.text, 'No special customer notes.'); assert.equal(m.status.badgeText, 'FINAL'); assert.equal(m.shop.license, null);
});

await t('defaults are neutral: no brand or legal text; the terms box hides when there are no terms', () => {
  const m = buildSheetModel({});
  const json = JSON.stringify(m);
  for (const bad of ["Future", 'warranty', 'lien', 'Automotive', 'Standard shop', 'INV-DRAFT', '8.25']) assert.ok(!json.includes(bad), `neutral model contains "${bad}"`);
  assert.equal(m.notes.terms.hidden, true); assert.equal(buildSheetModel({ notes: { termsAndConditions: 'Net 30' } }).notes.terms.hidden, false);
  assert.equal(m.totals.find(x => x.key === 'tax')!.label, 'Sales Tax (0%):');
});

await t('estimate documents: title, due-date label and number label change; everything else is identical', () => {
  const inv = load('basic-tax-parts-only');
  const a = buildSheetModel(inv); const b = buildSheetModel({ ...inv, meta: { ...inv.meta, docType: 'estimate' } });
  assert.deepEqual([a.title, b.title], ['INVOICE', 'ESTIMATE']);
  assert.deepEqual(b.meta.map(x => x.label), ['Estimate #:', 'Date:', 'Valid Until:']);
  assert.deepEqual([a.status.badgeText, b.status.badgeText], ['FINAL', 'DRAFT'], 'a draft invoice reads Final; a draft estimate stays Draft');
  assert.deepEqual({ ...b, title: '', meta: [], docType: 'invoice', status: null }, { ...a, title: '', meta: [], docType: 'invoice', status: null });
});

await t('labels are overridable per user (fee names, headings) without touching the numbers', () => {
  const inv = load('every-fee');
  const m = buildSheetModel(inv, undefined, { totals: { travel: 'Diagnostic/Travel:', shopSupplies: 'Shop Supplies/Disposal:' }, laborHeading: 'Services' });
  assert.equal(m.totals.find(x => x.key === 'travel')!.label, 'Diagnostic/Travel:'); assert.equal(m.totals.find(x => x.key === 'supplies')!.label, 'Shop Supplies/Disposal:'); assert.equal(m.labor.heading, 'Services');
  assert.deepEqual(m.totals.map(x => x.value), buildSheetModel(inv).totals.map(x => x.value));
});

await t('hostile values render as plain strings (no markup interpreted; the model never contains HTML-producing code paths)', () => {
  const evil = '<script>alert(1)</script>';
  const m = buildSheetModel({ shop: { name: evil }, customer: { name: evil, phone: evil }, laborItems: [{ description: evil, technician: evil, hours: 1, rate: 1 }], notes: { customerNotes: evil } });
  assert.equal(m.shop.name, evil); assert.equal(m.customer.name, evil); assert.equal(m.labor.rows[0].description, evil); assert.equal(m.notes.customer.text, evil);
  assert.ok(Object.values(m).every(v => typeof v !== 'function'));
});

console.log(`${passed} invoice sheet checks passed`);
