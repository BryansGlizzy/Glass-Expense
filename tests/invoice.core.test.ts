/**
 * Invoice core: model, totals, VIN and currency rules, the "no built-in business defaults" guarantee (decision D4), and hostile-JSON
 * normalization (threat T1).
 * Pure: needs no server.   Run:  npx tsx tests/invoice.core.test.ts
 */
import assert from 'node:assert/strict';
import {
  createEmptyInvoice, addLaborItem, updateLaborItem, removeLaborItem, addPartItem, updatePartItem, removePartItem, todayIso,
} from '../src/invoice/model.ts';
import { calculateTotals } from '../src/invoice/totals.ts';
import { validateVin } from '../src/invoice/vin.ts';
import { formatCurrency, asNumber } from '../src/invoice/format.ts';
import { normalizeInvoice, exportInvoiceJson, importInvoiceJson, LIMITS } from '../src/invoice/normalize.ts';
import { generateSheetPdf } from '../src/invoice/pdf/sheetPdf.ts';
import { buildSheetModel } from '../src/invoice/sheet.ts';
import { INVOICE_STATUSES } from '../src/invoice/types.ts';
import { readFileSync } from 'node:fs';

/** A PDF for any (possibly hostile) invoice, drawn the way the app draws it. */
const pdfOf = (inv: any) => generateSheetPdf(buildSheetModel(inv, calculateTotals(inv)), { generatedAt: 'test' });

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 5).join('\n       ')); process.exitCode = 1; } };

const NOW = new Date(2026, 0, 15, 12, 0, 0);
const withSettings = (settings: any, labor: any[] = [], parts: any[] = []) => createEmptyInvoice({ settings, laborItems: labor, partItems: parts }, NOW);

// ── creation ────────────────────────────────────────────────────────────────
await t('createEmptyInvoice is blank and neutral: no built-in business defaults exist (decision D4)', () => {
  const inv = createEmptyInvoice({}, NOW);
  assert.equal(inv.meta.invoiceNumber, '');
  assert.equal(inv.meta.status, 'Draft'); assert.equal(inv.meta.docType, 'invoice'); assert.equal(inv.meta.layout, 1);
  assert.equal(inv.meta.date, '2026-01-15'); assert.equal(inv.meta.dueDate, '');
  assert.deepEqual(inv.laborItems, []); assert.deepEqual(inv.partItems, []);
  assert.equal(inv.settings.taxRate, 0); assert.equal(inv.settings.shopSuppliesRate, 0); assert.equal(inv.settings.shopSuppliesCap, 0);
  const json = JSON.stringify(inv);
  for (const bad of ["Future's", 'Evergreen', 'ARD-', 'warranted', 'INV-2026', '8.25', 'example', 'Jordan', 'Honda']) assert.ok(!json.includes(bad), `default invoice contains "${bad}"`);
});

await t('createEmptyInvoice merges overrides section by section without mutating anything', () => {
  const inv = createEmptyInvoice({ customer: { name: 'Zed' }, settings: { taxRate: 5 } }, NOW);
  assert.equal(inv.customer.name, 'Zed'); assert.equal(inv.customer.phone, '');
  assert.equal(inv.settings.taxRate, 5); assert.equal(inv.settings.taxLabor, false);
  assert.equal(createEmptyInvoice({}, NOW).customer.name, '');
  assert.doesNotThrow(() => createEmptyInvoice(null));
});

await t('todayIso is the local calendar date, zero-padded', () => {
  assert.equal(todayIso(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(todayIso(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
});

// ── line item CRUD ─────────────────────────────────────────────────
await t('labor add/update/remove is immutable', () => {
  const base = createEmptyInvoice({}, NOW);
  const a = addLaborItem(base, { description: 'Brakes', hours: 2, rate: 100 });
  assert.equal(base.laborItems.length, 0); assert.equal(a.laborItems.length, 1);
  const item = a.laborItems[0]; assert.ok(item.id); assert.equal(item.technician, '');
  const b = updateLaborItem(a, item.id, { hours: 3, id: 'hack' });
  assert.equal(b.laborItems[0].hours, 3); assert.equal(b.laborItems[0].id, item.id); assert.equal(a.laborItems[0].hours, 2);
  const c = removeLaborItem(b, item.id);
  assert.equal(c.laborItems.length, 0); assert.equal(b.laborItems.length, 1);
});

await t('part add/update/remove is immutable', () => {
  const base = createEmptyInvoice({}, NOW);
  const a = addPartItem(base, { partNumber: 'P1', quantity: 2, unitPrice: 5 });
  const b = addPartItem(a, { id: 'custom', quantity: 1, unitPrice: 1 });
  assert.equal(b.partItems[1].id, 'custom'); assert.notEqual(a.partItems[0].id, b.partItems[1].id);
  const c = updatePartItem(b, 'custom', { quantity: 9 });
  assert.equal(c.partItems[1].quantity, 9); assert.equal(b.partItems[1].quantity, 1); assert.equal(c.partItems[0].quantity, 2);
  const d = removePartItem(c, 'custom');
  assert.equal(d.partItems.length, 1); assert.equal(d.partItems[0].partNumber, 'P1');
});

await t('update/remove with an unknown id is a no-op; generated ids are unique', () => {
  const a = addLaborItem(createEmptyInvoice({}, NOW), { hours: 1, rate: 1 });
  assert.deepEqual(updateLaborItem(a, 'nope', { hours: 5 }).laborItems, a.laborItems);
  assert.equal(removeLaborItem(a, 'nope').laborItems.length, 1);
  let inv = createEmptyInvoice({}, NOW);
  for (let i = 0; i < 200; i++) inv = addPartItem(inv, {});
  assert.equal(new Set(inv.partItems.map(p => p.id)).size, 200);
});

// ── VIN / currency ─────────────────────────────────────────────────
await t('validateVin', () => {
  assert.deepEqual(validateVin('1HGCV1F34MA012345'), { valid: true });
  assert.equal(validateVin('1hgcv1f34ma012345').valid, true);
  assert.equal(validateVin('').valid, false); assert.equal(validateVin(null).valid, false);
  assert.match((validateVin('ABC') as any).reason, /17/);
  assert.match((validateVin('1HGCV1F34MA01234I') as any).reason, /excluding I, O, and Q/);
  assert.equal(validateVin('1HGCV1F34MA01234O').valid, false); assert.equal(validateVin('1HGCV1F34MA01234Q').valid, false);
});

await t('formatCurrency rounds and signs as documented', () => {
  assert.equal(formatCurrency(1234.5), '$1,234.50'); assert.equal(formatCurrency(0), '$0.00'); assert.equal(formatCurrency('abc'), '$0.00'); assert.equal(formatCurrency(-5), '-$5.00');
  assert.equal(formatCurrency(-0.000001), '-$0.00', 'Intl keeps the sign of a tiny negative');
  assert.equal(formatCurrency(999999.995), '$1,000,000.00'); assert.equal(formatCurrency(undefined), '$0.00'); assert.equal(formatCurrency(1e9), '$1,000,000,000.00');
  assert.equal(asNumber('7.5'), 7.5); assert.equal(asNumber(Infinity), 0);
});

// ── totals ─────────────────────────────────────────────────────────
const labor = [{ hours: 2, rate: 100 }]; // 200
const parts = [{ quantity: 2, unitPrice: 50 }]; // 100

await t('empty invoice totals are zero; tolerant of garbage input', () => {
  for (const v of Object.values(calculateTotals(createEmptyInvoice({}, NOW)))) assert.equal(v, 0);
  assert.doesNotThrow(() => calculateTotals(undefined)); assert.doesNotThrow(() => calculateTotals(null)); assert.doesNotThrow(() => calculateTotals({ laborItems: [null, 5, 'x'], partItems: 'no' }));
});
await t('subtotals, shop supplies, tax on parts only by default', () => {
  const x = calculateTotals(withSettings({ taxRate: 10, shopSuppliesRate: 5, shopSuppliesCap: 35 }, labor, parts));
  assert.deepEqual([x.laborSubtotal, x.partsSubtotal, x.subtotal, x.shopSuppliesFee, x.taxableAmount, x.taxAmount, x.grandTotal], [200, 100, 300, 10, 100, 10, 320]);
});
await t('shop supplies fee is capped; hazmat is added', () => {
  const x = calculateTotals(withSettings({ shopSuppliesRate: 50, shopSuppliesCap: 35, taxRate: 0 }, labor, parts));
  assert.equal(x.shopSuppliesFee, 35); assert.equal(x.grandTotal, 335);
  const h = calculateTotals(withSettings({ hazardousWasteFee: 7.5, shopSuppliesRate: 0, taxRate: 0 }, labor, parts));
  assert.equal(h.hazardousWasteFee, 7.5); assert.equal(h.grandTotal, 307.5);
});
await t('travel and misc fees are added and not taxed', () => {
  const x = calculateTotals(withSettings({ travelFee: 25, miscFee: 12.5, shopSuppliesRate: 0, taxRate: 10 }, labor, parts));
  assert.deepEqual([x.travelFee, x.miscFee, x.taxAmount, x.grandTotal], [25, 12.5, 10, 347.5]);
  const legacy = calculateTotals({ laborItems: [], partItems: [], settings: { taxRate: 0 } });
  assert.deepEqual([legacy.travelFee, legacy.miscFee, legacy.grandTotal], [0, 0, 0]);
});
await t('taxLabor toggle changes the taxable base', () => {
  const off = calculateTotals(withSettings({ taxRate: 10, shopSuppliesRate: 0, taxLabor: false }, labor, parts));
  const on = calculateTotals(withSettings({ taxRate: 10, shopSuppliesRate: 0, taxLabor: true }, labor, parts));
  assert.equal(off.taxAmount, 10); assert.deepEqual([on.taxableAmount, on.taxAmount, on.grandTotal], [300, 30, 330]);
});
await t('percent and fixed discounts (fixed is clamped to the subtotal)', () => {
  const p = calculateTotals(withSettings({ discountType: 'percent', discountValue: 10, taxRate: 10, shopSuppliesRate: 0 }, labor, parts));
  assert.deepEqual([p.discountAmount, p.taxableAmount, p.taxAmount, p.grandTotal], [30, 90, 9, 279]);
  const f = calculateTotals(withSettings({ discountType: 'fixed', discountValue: 60, taxRate: 0, shopSuppliesRate: 0 }, labor, parts));
  assert.deepEqual([f.discountAmount, f.grandTotal], [60, 240]);
  const big = calculateTotals(withSettings({ discountType: 'fixed', discountValue: 9999, taxRate: 0, shopSuppliesRate: 0 }, labor, parts));
  assert.deepEqual([big.discountAmount, big.grandTotal], [300, 0]);
});
await t('non-numeric inputs are treated as zero', () => {
  const x = calculateTotals(withSettings({ taxRate: 'x' }, [{ hours: 'a', rate: 5 }], [{ quantity: 1, unitPrice: '3.5' }]));
  assert.equal(x.laborSubtotal, 0); assert.equal(x.partsSubtotal, 3.5);
});
await t('totals stay finite and deterministic on 2,000 random invoices (including weird values)', () => {
  let s = 12345; const r = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  for (let i = 0; i < 2000; i++) {
    const inv = {
      laborItems: Array.from({ length: Math.floor(r() * 6) }, () => ({ hours: pick([0, 0.1, 1 / 3, 2.5, '2', 'x', null, -1]), rate: pick([0, 55, 0.7, 99.99, '12.5', undefined]) })),
      partItems: Array.from({ length: Math.floor(r() * 6) }, () => ({ quantity: pick([0, 1, 3, 2.5, '4', NaN]), unitPrice: pick([0, 0.335, 12.5, 1234.567, '3']) })),
      settings: { taxRate: pick([0, 6, 8.875, '7']), taxLabor: pick([true, false, 1, 0]), discountType: pick(['percent', 'fixed']), discountValue: pick([0, 5, 12.5, 100, 9999]), shopSuppliesRate: pick([0, 3.3, 10]), shopSuppliesCap: pick([0, 12.5, 99]), hazardousWasteFee: pick([0, 3.5]), travelFee: pick([0, 45]), miscFee: pick([0, 7.25]) },
    };
    const a = calculateTotals(inv); assert.deepEqual(a, calculateTotals(inv), 'deterministic');
    assert.ok(Object.values(a).every(v => typeof v !== 'number' || Number.isFinite(v)), JSON.stringify(inv));
  }
});

// ── normalization of untrusted JSON (threat T1) ───────────────────────────────
await t('normalizeInvoice: never throws and always returns a complete, well-typed invoice', () => {
  for (const junk of [undefined, null, 0, 1, 'x', true, [], [1, 2], {}, { meta: 5, shop: [], customer: 'x', vehicle: null, laborItems: {}, partItems: 3, settings: 'x', notes: 7 }]) {
    const inv = normalizeInvoice(junk);
    assert.ok(Array.isArray(inv.laborItems) && Array.isArray(inv.partItems));
    assert.equal(typeof inv.meta.invoiceNumber, 'string'); assert.ok((INVOICE_STATUSES as readonly string[]).includes(inv.meta.status));
    assert.equal(typeof inv.settings.taxRate, 'number'); assert.equal(typeof inv.notes.termsAndConditions, 'string');
    assert.doesNotThrow(() => pdfOf(inv)); assert.ok(Object.values(calculateTotals(inv)).every(Number.isFinite));
  }
});

await t('normalizeInvoice: numbers are coerced and clamped (huge, negative, NaN, Infinity, numeric strings, wrong types)', () => {
  const inv = normalizeInvoice({
    laborItems: [{ hours: 1e30, rate: -5 }, { hours: '2.5', rate: '55' }, { hours: 'abc', rate: Infinity }, { hours: NaN, rate: {} }, { hours: [3], rate: true }],
    partItems: [{ quantity: 1e18, unitPrice: 1e18 }, { quantity: '3', unitPrice: '1.5' }],
    settings: { taxRate: 5000, discountType: 'percent', discountValue: 1e9, shopSuppliesRate: -4, shopSuppliesCap: 'x', hazardousWasteFee: 1e99, travelFee: '45', miscFee: null },
  });
  assert.deepEqual(inv.laborItems.map(l => [l.hours, l.rate]), [[LIMITS.maxHours, 0], [2.5, 55], [0, 0], [0, 0], [0, 0]]);
  assert.deepEqual(inv.partItems.map(p => [p.quantity, p.unitPrice]), [[LIMITS.maxQuantity, LIMITS.maxMoney], [3, 1.5]]);
  assert.deepEqual([inv.settings.taxRate, inv.settings.discountValue, inv.settings.shopSuppliesRate, inv.settings.shopSuppliesCap, inv.settings.hazardousWasteFee, inv.settings.travelFee, inv.settings.miscFee], [100, 100, 0, 0, LIMITS.maxMoney, 45, 0]);
  const totals = calculateTotals(inv);
  assert.ok(Object.values(totals).every(v => Number.isFinite(v) && Math.abs(v) < 1e19), JSON.stringify(totals));
});

await t('normalizeInvoice: enums are allow-listed, dates validated, strings capped and stripped of control characters', () => {
  const inv = normalizeInvoice({
    meta: { status: 'Hacked', docType: 'receipt', layout: 99, invoiceNumber: 'A'.repeat(500), date: '2026-02-30', dueDate: '2026-03-01' },
    settings: { discountType: '<script>' },
    customer: { name: 'N'.repeat(5000) + '\u0000\u0007', phone: 5551234 },
    notes: { customerNotes: 'line1\nline2\u0000\u001b[31m', termsAndConditions: 'T'.repeat(100_000) },
    vehicle: { year: 2020, mileage: 99999 },
  });
  assert.equal(inv.meta.status, 'Draft'); assert.equal(inv.meta.docType, 'invoice'); assert.equal(inv.meta.layout, 1);
  assert.equal(inv.meta.invoiceNumber.length, 100); assert.equal(inv.meta.date, ''); assert.equal(inv.meta.dueDate, '2026-03-01');
  assert.equal(inv.settings.discountType, 'percent');
  assert.equal(inv.customer.name.length, LIMITS.name); assert.ok(!/[\u0000-\u0008]/.test(inv.customer.name)); assert.equal(inv.customer.phone, '5551234');
  assert.equal(inv.notes.customerNotes, 'line1\nline2[31m'); assert.equal(inv.notes.termsAndConditions.length, LIMITS.terms);
  assert.deepEqual([inv.vehicle.year, inv.vehicle.mileage], ['2020', '99999']);
  assert.equal(normalizeInvoice({ meta: { status: 'Sent', docType: 'estimate', layout: 2 } }).meta.status, 'Sent');
  assert.deepEqual(normalizeInvoice({ meta: { docType: 'estimate', layout: 2 } }).meta, { ...normalizeInvoice({}).meta, docType: 'estimate', layout: 2 });
});

await t('normalizeInvoice: script-like text stays inert text (React escapes; nothing is interpreted)', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(1)</script>"\'`${7*7}{{constructor}}';
  const inv = normalizeInvoice({ customer: { name: evil }, laborItems: [{ description: evil }], notes: { customerNotes: evil } });
  assert.equal(inv.customer.name, evil); assert.equal(inv.laborItems[0].description, evil); assert.equal(inv.notes.customerNotes, evil);
  assert.doesNotThrow(() => pdfOf(inv));
});

await t('normalizeInvoice: arrays are capped, ids are made unique and safe, unknown keys are dropped at every level', () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ id: i % 2 ? 'dup' : `ok-${i}`, description: `d${i}`, hours: 1, rate: 1, evil: 'x' }));
  const inv: any = normalizeInvoice({ laborItems: many, partItems: [{ id: '<b>', quantity: 1 }, { id: 'a b' }, {}], extra: 'x', meta: { invoiceNumber: 'N', surprise: 1 }, settings: { taxRate: 1, wat: 2 }, ge: { id: 'x' } });
  assert.equal(inv.laborItems.length, LIMITS.maxLines);
  assert.equal(new Set(inv.laborItems.map((l: any) => l.id)).size, LIMITS.maxLines, 'ids unique');
  assert.ok(inv.partItems.every((p: any) => /^[\w.:-]{1,64}$/.test(p.id)) && new Set(inv.partItems.map((p: any) => p.id)).size === 3);
  assert.ok(!('evil' in inv.laborItems[0]) && !('extra' in inv) && !('surprise' in inv.meta) && !('wat' in inv.settings));
  assert.ok(!('ge' in inv), 'ge is dropped unless the caller opts in');
});

await t('normalizeInvoice: the ge namespace is sanitized when kept (depth, size, prototype-pollution keys)', () => {
  const polluted = JSON.parse('{"ge":{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}},"ok":{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}},"fn":"x","arr":[1,2,3]}}');
  const inv = normalizeInvoice(polluted, { keepGe: true });
  assert.equal(({} as any).polluted, undefined); assert.equal(({} as any).polluted2, undefined); assert.equal((Object.prototype as any).polluted, undefined);
  assert.ok(inv.ge && !Object.prototype.hasOwnProperty.call(inv.ge, '__proto__') && !('constructor' in (inv.ge as any) && Object.prototype.hasOwnProperty.call(inv.ge, 'constructor')));
  assert.deepEqual((inv.ge as any).arr, [1, 2, 3]);
  assert.equal((inv.ge as any).ok.a.b.c.d.e, null, 'anything nested deeper than the limit is replaced by null');
  assert.equal((inv.ge as any).ok.a.b.c.d !== null, true, 'but data within the limit is kept');
  const huge = normalizeInvoice({ ge: { blob: Array.from({ length: 400 }, () => 'x'.repeat(4000)) } }, { keepGe: true });
  assert.equal(huge.ge, undefined, 'oversized ge is dropped, not truncated into something misleading');
  assert.equal(normalizeInvoice({ ge: 'string' }, { keepGe: true }).ge, undefined);
});

await t('normalization is idempotent and does not disturb a clean invoice (so saved invoices reload identically)', () => {
  const clean = createEmptyInvoice({ meta: { invoiceNumber: 'X-1', status: 'Approved' }, shop: { name: 'Shop' }, settings: { taxRate: 6.5, discountType: 'fixed', discountValue: 5 }, notes: { customerNotes: 'a\nb' } }, NOW);
  const withLines = addPartItem(addLaborItem(clean, { id: 'l1', description: 'x', hours: 1.5, rate: 55 }), { id: 'p1', partNumber: 'P', description: 'y', quantity: 2, unitPrice: 3.25 });
  const once = normalizeInvoice(withLines); const twice = normalizeInvoice(once);
  assert.deepEqual(once, withLines); assert.deepEqual(twice, once);
});

await t('export / import round trip; the ge namespace never leaves in a plain export and is stripped on import', () => {
  const inv = { ...addLaborItem(createEmptyInvoice({ meta: { invoiceNumber: 'R-1' } }, NOW), { id: 'l1', description: 'x', hours: 1, rate: 2 }), ge: { id: 'rec-1', secret: 'x' } };
  const json = exportInvoiceJson(inv);
  assert.ok(json.includes('\n') && !json.includes('rec-1') && !json.includes('"ge"'));
  const back = importInvoiceJson(json); const { ge, ...plain } = inv;
  assert.deepEqual(back, plain);
  assert.ok(exportInvoiceJson(inv, { includeGe: true }).includes('rec-1'));
  assert.equal(importInvoiceJson(exportInvoiceJson(inv, { includeGe: true })).ge, undefined);
  assert.throws(() => importInvoiceJson('not json'), /Invalid invoice JSON/);
  assert.throws(() => importInvoiceJson('[]'), /invoice object/); assert.throws(() => importInvoiceJson('null'), /invoice object/);
  assert.throws(() => importInvoiceJson('x'.repeat(LIMITS.importBytes + 1)), /too large/);
});

await t('an older exported file (no docType/layout/fees, extra fields) imports cleanly and prints', () => {
  const file = JSON.parse(readFileSync(new URL('./fixtures/invoice/sample.json', import.meta.url), 'utf8'));
  const inv = importInvoiceJson(JSON.stringify(file));
  assert.equal(inv.customer.name, file.customer.name); assert.equal(inv.meta.docType, 'invoice'); assert.equal(inv.laborItems.length, 2);
  assert.equal(calculateTotals(inv).grandTotal, calculateTotals(normalizeInvoice(file)).grandTotal); assert.ok(calculateTotals(inv).grandTotal > 0); assert.doesNotThrow(() => pdfOf(inv));
});

console.log(`${passed} invoice core checks passed`);
