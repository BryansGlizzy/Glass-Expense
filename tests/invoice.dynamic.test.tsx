/**
 * User-defined fees and detail fields ("dynamic" documents). A document that carries a `fees` array uses labelled fee lines instead of
 * the four fixed fee fields, and one that carries `details` shows the user's own fields instead of the vehicle box.
 * Older documents without these arrays keep the fixed fields; here we prove the new model:
 * the math, hostile input, the sheet and PDF, settings migration, website variables filling fees and fields, upgrading agent-made
 * invoices without changing their total, package fees, shop details from settings, and the editor.
 * Pure: needs no server.   Run:  npx tsx tests/invoice.dynamic.test.tsx
 */
import React from 'react';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { calculateTotals, feeAmount } from '../src/invoice/totals.ts';
import { normalizeInvoice, normalizeFees, normalizeDetails } from '../src/invoice/normalize.ts';
import { buildSheetModel } from '../src/invoice/sheet.ts';
import { generateSheetPdf } from '../src/invoice/pdf/sheetPdf.ts';
import { createEmptyInvoice, addLaborItem, addPartItem } from '../src/invoice/model.ts';
import { defaultSettings, normalizeSettings, slugKey, quoteVariable, FIELD_PRESETS } from '../src/invoice/settings.ts';
import { buildNewInvoice, fieldValue, refreshFromJob } from '../src/invoice/prefill.ts';
import { parseStructuredIntake, canonicalDescription, IntakeError } from '../src/invoice/intake.ts';
import { upgradeToDynamic, applyPending } from '../src/invoice/pending.ts';
import { confirmEstimate } from '../src/invoice/review.ts';
import { applyPackage, normalizePackage } from '../src/invoice/packages.ts';
import { renderPdf, renderSheet, withShop } from '../src/invoice/render.ts';
import { escapePdfTextWinAnsi } from '../src/invoice/pdf/text.ts';
import { InvoiceEditor, NotesCard } from '../src/components/invoice/InvoiceEditor.tsx';
import { InvoiceSheet } from '../src/components/invoice/InvoiceSheet.tsx';
import { geOf } from '../src/invoice/ge.ts';
import type { FeeLine, Invoice } from '../src/invoice/types.ts';

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 8).join('\n       ')); process.exitCode = 1; } };
const NOW = new Date(2026, 10, 8, 12, 0, 0);
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => {};

const fee = (over: Partial<FeeLine> & { id: string }): FeeLine => ({ label: 'Fee', kind: 'flat', value: 0, cap: 0, taxable: false, ...over });
/** labor 100 (2 h x $50) + parts 30 = subtotal 130 */
const base = (extra: Partial<Invoice> = {}, over: any = {}): Invoice => {
  let i = createEmptyInvoice({ meta: { invoiceNumber: 'D-1', docType: 'invoice' }, shop: { name: 'Example Shop' }, customer: { name: 'Pat' }, ...over }, NOW);
  i = addLaborItem(i, { id: 'l', description: 'Work', hours: 2, rate: 50 }); i = addPartItem(i, { id: 'p', description: 'Part', quantity: 1, unitPrice: 30 });
  return { ...i, ...extra };
};
const settings = (over: any = {}) => normalizeSettings({ shop: { name: 'Example Shop', phone: '555' }, ...over });

await t('fee math: flat, % of labor (with cap), % of subtotal, taxable fees join the tax base; fixed fee fields are ignored in dynamic mode', () => {
  const inv = base({ fees: [fee({ id: 'a', label: 'Trip', value: 45, taxable: true }), fee({ id: 'b', label: 'Supplies', kind: 'percentOfLabor', value: 10, cap: 8 }), fee({ id: 'c', label: 'Service charge', kind: 'percentOfSubtotal', value: 5 })] });
  inv.settings = { ...inv.settings, taxRate: 10, travelFee: 99, hazardousWasteFee: 99, miscFee: 99, shopSuppliesRate: 50, shopSuppliesCap: 99 };
  const x = calculateTotals(inv);
  assert.deepEqual(x.fees, [{ id: 'a', label: 'Trip', amount: 45 }, { id: 'b', label: 'Supplies', amount: 8 }, { id: 'c', label: 'Service charge', amount: 6.5 }]);
  assert.deepEqual([x.feesTotal, x.taxableAmount, x.taxAmount, x.grandTotal, x.travelFee, x.shopSuppliesFee, x.hazardousWasteFee, x.miscFee], [59.5, 75, 7.5, 197, 0, 0, 0, 0]);
  assert.equal(feeAmount({ kind: 'percentOfLabor', value: 10, cap: 0 }, 100, 130), 10, 'cap 0 = no cap'); assert.equal(feeAmount({ kind: 'flat', value: 'x' as any, cap: 0 }, 1, 1), 0);
  const empty = calculateTotals(base({ fees: [] })); assert.deepEqual([empty.feesTotal, empty.grandTotal, empty.fees], [0, 130, []]);
  const legacy = calculateTotals(base()); assert.ok(!('fees' in legacy) && !('feesTotal' in legacy), 'original-format totals carry no extra keys');
  const withDiscount = calculateTotals({ ...inv, settings: { ...inv.settings, discountType: 'percent' as const, discountValue: 10 } }); assert.equal(withDiscount.discountAmount, 13);
});

await t('normalization: fees and details are bounded, allow-listed and de-duplicated; a missing array stays original-format', () => {
  const fees = normalizeFees([{ id: 'dup', label: 'x'.repeat(200), kind: 'weird', value: 1e12, cap: -4, taxable: 'yes' }, { id: 'dup', kind: 'percentOfLabor', value: 5000 }, 'junk', null, ...Array.from({ length: 40 }, () => ({}))]);
  assert.equal(fees.length, 20); assert.deepEqual([fees[0].label.length, fees[0].kind, fees[0].value, fees[0].cap, fees[0].taxable, fees[1].value], [60, 'flat', 1_000_000_000, 0, false, 100]);
  assert.equal(new Set(fees.map(f => f.id)).size, 20, 'ids unique');
  const d = normalizeDetails({ title: 'T'.repeat(200), fields: [{ key: 'venue', label: 'Venue', type: 'text', value: 'Hall' }, { key: 'venue', label: 'dup' }, { key: 'Bad Key', label: 'x' }, { key: '1abc', label: 'x' }, { key: 'when', type: 'bogus', value: 'v'.repeat(500) }, ...Array.from({ length: 50 }, (_, i) => ({ key: `k${i}` }))] })!;
  assert.equal(d.title.length, 60); assert.equal(d.fields.length, 27, 'only the first 30 entries are read; 3 of them are duplicates or invalid'); assert.deepEqual([d.fields[0].key, d.fields[1].key, d.fields[1].type, d.fields[1].value.length], ['venue', 'when', 'text', 200]);
  assert.equal(normalizeDetails('x'), undefined); assert.equal(normalizeDetails(null), undefined);
  const inv = normalizeInvoice({ fees: [{ id: 'a', label: 'Trip', value: 5 }], details: { title: 'Job', fields: [{ key: 'venue', label: 'Venue', value: 'Hall' }] } });
  assert.deepEqual([inv.fees!.length, inv.details!.fields[0].value], [1, 'Hall']); assert.ok(!('fees' in normalizeInvoice({})) && !('details' in normalizeInvoice({ fees: 'nope', details: 5 })), 'bad values do not turn the mode on');
  assert.deepEqual(normalizeInvoice(inv), inv, 'idempotent');
  assert.equal(normalizeInvoice({ fees: [{ value: 1e99 }] }).fees![0].value, 1_000_000_000);
});

await t('sheet: fee lines, hidden zero discount and zero tax, the details box shows only filled fields, and is gone when empty', () => {
  const inv = base({ fees: [fee({ id: 'a', label: 'Trip charge', value: 45 })], details: { title: 'Event', fields: [{ key: 'venue', label: 'Venue', type: 'text', value: 'Hall A' }, { key: 'vin', label: 'VIN', type: 'vin', value: '1HGCV1F34MA012345' }, { key: 'blank', label: 'Blank', type: 'text', value: '  ' }] } });
  const m = buildSheetModel(inv);
  assert.deepEqual(m.totals.map(x => x.key), ['labor', 'parts', 'subtotal', 'fee:a', 'grand']); assert.deepEqual([m.totals[3].label, m.totals[3].value, m.totals[4].value], ['Trip charge:', '$45.00', '$175.00']);
  assert.deepEqual([m.vehicle!.heading, m.vehicle!.attrs.map(a => [a.label, a.mono])], ['Event', [['Venue', false], ['VIN', true]]]);
  const taxed = buildSheetModel({ ...inv, settings: { ...inv.settings, taxRate: 6, discountValue: 10 } }); assert.deepEqual(taxed.totals.map(x => x.key), ['labor', 'parts', 'subtotal', 'discount', 'fee:a', 'tax', 'grand']);
  assert.equal(buildSheetModel({ ...inv, details: { title: 'Event', fields: [] } }).vehicle, null); assert.equal(buildSheetModel({ ...inv, details: undefined, fees: undefined }).vehicle!.heading, 'Vehicle Information', 'original format unchanged');
  const none = html(<InvoiceSheet model={buildSheetModel({ ...inv, details: { title: 'x', fields: [] } })} />); assert.ok(none.includes('sh-parties one') && !none.includes('Vehicle Information'));
  assert.ok(html(<InvoiceSheet model={m} />).includes('Hall A') && !html(<InvoiceSheet model={m} />).includes('sh-parties one'));
});

await t('PDF: fee lines replace the fixed rows, zero discount/tax rows disappear, the details box lists filled fields, the customer box widens when there are none', () => {
  const inv = base({ fees: [fee({ id: 'a', label: 'Trip charge', value: 45 }), fee({ id: 'b', label: 'Disposal', value: 12.5 })], details: { title: 'Job Site', fields: [{ key: 'site', label: 'Site', type: 'text', value: 'Warehouse 4' }, { key: 'po', label: 'PO #', type: 'text', value: '88123' }] } });
  const pdf = (i: any) => generateSheetPdf(buildSheetModel(i, calculateTotals(i)), { generatedAt: 'test' });
  const s = text(pdf(inv)); const m = buildSheetModel(inv);
  for (const l of m.totals) assert.ok(s.includes(`(${l.label}) Tj`) && s.includes(`(${l.value}) Tj`), `totals line ${l.label}`);
  for (const yes of ['(Trip charge:) Tj', '(Disposal:) Tj', '(JOB SITE) Tj', '(SITE) Tj', '(Warehouse 4) Tj', '(PO #) Tj', '(88123) Tj', '($187.50) Tj']) assert.ok(s.includes(yes), yes);
  for (const no of ['(Shop Supplies', '(Hazardous Waste', '(Travel Fee', '(Misc. Fee', '(Discount', '(Sales Tax', '(VEHICLE']) assert.ok(!s.includes(no), no);
  const noDetails = text(pdf({ ...inv, details: { title: 'Job Site', fields: [] } })); assert.ok(!noDetails.includes('(JOB SITE) Tj') && noDetails.includes('(CUSTOMER) Tj'), 'no details box when there are no fields');
  const many = text(pdf({ ...inv, details: { title: 'Details', fields: Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, type: 'text' as const, value: `v${i}` })) } })); for (let i = 0; i < 6; i++) assert.ok(many.includes(`(v${i}) Tj`), `field ${i} listed`);
  const long = pdf({ ...inv, details: { title: 'D', fields: [{ key: 'x', label: 'Notes', type: 'text', value: 'word '.repeat(80) }] } }); assert.ok(text(long).startsWith('%PDF-1.4') && text(long).includes('(word'), 'a very long value still produces a valid document');
  const taxed = { ...inv, settings: { ...inv.settings, taxRate: 7 } }; const taxLine = buildSheetModel(taxed).totals.find(l => l.key === 'tax');
  assert.ok(taxLine && text(pdf(taxed)).includes(`(${escapePdfTextWinAnsi(taxLine.label)}) Tj`), 'tax row appears when a rate is set');
  // original-format documents (fixed fee fields and a vehicle box) are still read and printed
  const legacy = text(pdf(base())); for (const yes of ['(Shop Supplies', '(Travel Fee', '(Misc. Fee', '(Sales Tax', '(VEHICLE INFORMATION) Tj']) assert.ok(legacy.includes(yes), `original format still prints ${yes}`);
  const sx = spawnSync('pdfinfo', ['-v']); if (!sx.error) { const f = path.join(mkdtempSync(path.join(os.tmpdir(), 'ge-dyn-')), 'd.pdf'); writeFileSync(f, pdf(inv)); const r = spawnSync('pdfinfo', [f], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); assert.ok(!/error/i.test(r.stderr), r.stderr); }
});

await t('settings: older fixed-fee settings migrate to fees once; explicit lists are never re-seeded; defaults are blank; keys and prefixes are sanitized', () => {
  const old = normalizeSettings({ rates: { hourlyRate: 55, baseFee: 45, shopSuppliesRate: 5, shopSuppliesCap: 35, hazardousWasteFee: 3.5, miscFee: 7 }, feeLabels: { travel: 'Diagnostic/Travel' } });
  assert.deepEqual(old.fees.map(f => [f.label, f.kind, f.value, f.cap, f.quoteKey]), [['Diagnostic/Travel', 'flat', 45, 0, 'base_fee'], ['Shop Supplies Fee', 'percentOfLabor', 5, 35, ''], ['Hazardous Waste Fee', 'flat', 3.5, 0, ''], ['Misc. Fee', 'flat', 7, 0, '']]);
  assert.ok(old.fees.every(f => f.auto && !f.taxable) && old.rates.hourlyRate === 55 && !('baseFee' in old.rates));
  assert.deepEqual(normalizeSettings({ rates: { baseFee: 45 }, fees: [] }).fees, [], 'an explicit empty list is respected');
  const d = defaultSettings(); assert.deepEqual([d.fees, d.details.fields, d.numbering.prefix], [[], [], 'INV']);
  assert.equal(normalizeSettings({ numbering: { prefix: ' fa-/x!*y ' } }).numbering.prefix, 'FA-XY'); assert.equal(normalizeSettings({ numbering: { prefix: '!!!' } }).numbering.prefix, 'INV');
  assert.deepEqual([slugKey('License Plate'), slugKey('Year / Make'), slugKey('3rd floor'), slugKey('!!!')], ['license_plate', 'year_make', 'f_3rd_floor', '']);
  const f = normalizeSettings({ details: { fields: [{ label: 'Venue' }, { label: 'Venue' }, { label: '', key: 'x' }, { label: '!!!' }, { key: 'BAD', label: 'Ok' }] } }).details.fields;
  assert.deepEqual(f.map(x => x.key), ['venue', 'venue_1', 'x', 'ok'], 'duplicate and invalid keys are repaired or dropped');
  const messy = normalizeSettings({ fees: [{ label: 'A', kind: 'percentOfLabor', value: 999, quoteKey: 'bad key!' }, { label: 'B', auto: false }] }); assert.deepEqual([messy.fees[0].value, messy.fees[0].quoteKey, messy.fees[1].auto], [100, '', false]);
  assert.deepEqual(normalizeSettings(normalizeSettings(old)), normalizeSettings(old), 'idempotent'); assert.equal(FIELD_PRESETS.automotive.fields.some(x => x.type === 'vin'), true);
  assert.deepEqual([quoteVariable({ baseFee: 45, variables: { rush: 20 } }, 'base_fee'), quoteVariable({ baseFee: 45, variables: { rush: 20 } }, 'rush'), quoteVariable({ variables: {} }, 'rush'), quoteVariable(null, 'x')], [45, 20, undefined, undefined]);
});

await t('intake: fields validate strictly, appear in the canonical description (without repeating the vehicle), and fill detail fields by key', () => {
  const i = parseStructuredIntake({ fields: { venue: 'Hall A', guests: 120, year: '2018' }, vehicle: { year: 2018, make: 'Toyota' }, client_name: 'Pat' }, NOW)!;
  assert.deepEqual(i.fields, { venue: 'Hall A', guests: '120', year: '2018' });
  const text = canonicalDescription(i); assert.match(text, /Vehicle: 2018 Toyota\nVenue: Hall A\nGuests: 120$/); assert.ok(!/\nYear: /.test(text), 'a vehicle key is not repeated');
  for (const bad of [{ fields: 'x' }, { fields: [] }, { fields: { 'Bad Key': 'x' } }, { fields: { ok: { nested: 1 } } }, { fields: { '1x': 'y' } }]) assert.throws(() => parseStructuredIntake(bad as any, NOW), IntakeError, JSON.stringify(bad));
  assert.equal(parseStructuredIntake({ fields: { a: '' } }, NOW)!.fields, undefined, 'empty values are dropped');
  const def = { key: 'venue', label: 'Venue', default: 'TBD' };
  assert.deepEqual([fieldValue(i, def), fieldValue(null, def), fieldValue(i, { key: 'make', label: 'Make', default: '' }), fieldValue({ ...i, fields: undefined, extra: { Venue: 'From text' } } as any, def)],
    [{ value: 'Hall A', source: 'intake' }, { value: 'TBD', source: 'settings' }, { value: 'Toyota', source: 'intake' }, { value: 'From text', source: 'intake' }]);
});

await t('prefill: fees come from YOUR fee list (auto ones only) and follow website variables; detail fields fill by key; nothing else is invented', () => {
  const s = settings({ rates: { hourlyRate: 60, followWebsite: true, websiteQuote: { hourlyRate: 58, baseFee: 40, variables: { rush: 20 }, at: '2026-11-01' } },
    fees: [{ id: 'trip', label: 'Trip charge', value: 30, quoteKey: 'base_fee', taxable: true }, { id: 'rush', label: 'Rush', value: 10, quoteKey: 'rush' }, { id: 'own', label: 'Disposal', value: 12 }, { id: 'manual', label: 'Manual only', value: 5, auto: false }],
    details: { title: 'Event', fields: [{ label: 'Venue', default: 'TBD' }, { label: 'Guests' }] } });
  const withQuote = buildNewInvoice({ job: { id: 'j' }, intake: parseStructuredIntake({ fields: { venue: 'Hall A' }, quote: { base_fee: 45, variables: { rush: 0 } } }, NOW), settings: s, now: NOW });
  assert.deepEqual(withQuote.invoice.fees!.map(f => [f.label, f.value, f.taxable]), [['Trip charge', 45, true], ['Rush', 0, false], ['Disposal', 12, false]], 'this job\'s quote first; manual-only fees are not added');
  assert.deepEqual([withQuote.provenance['fees.trip'], withQuote.provenance['fees.own'], withQuote.provenance['details.venue']], ['website', 'settings', 'intake']);
  assert.deepEqual(withQuote.invoice.details!.fields.map(f => [f.key, f.value]), [['venue', 'Hall A'], ['guests', '']]);
  const noQuote = buildNewInvoice({ job: { id: 'j' }, settings: s, now: NOW }).invoice;
  assert.deepEqual(noQuote.fees!.map(f => f.value), [40, 20, 12], 'then the latest website quote while "follow website" is on'); assert.equal(noQuote.details!.fields[0].value, 'TBD', 'then the field default');
  const pinned = buildNewInvoice({ job: { id: 'j' }, settings: { ...s, rates: { ...s.rates, followWebsite: false } }, now: NOW }).invoice; assert.deepEqual(pinned.fees!.map(f => f.value), [30, 10, 12], 'pinned: your own values');
  const bare = buildNewInvoice({ job: { id: 'j' }, settings: settings(), now: NOW }).invoice; assert.deepEqual([bare.fees, bare.details!.fields, bare.vehicle.make, bare.settings.travelFee], [[], [], '', 0], 'no settings, no fees, no fields, no vehicle');
  assert.ok(Array.isArray(withQuote.invoice.fees) && withQuote.invoice.details, 'new documents are in dynamic mode');
});

await t('prefill: "Refresh from job" also refreshes untouched detail fields and keeps your edits', () => {
  const s = settings({ details: { fields: [{ label: 'Venue' }, { label: 'Date' }] } });
  const first = buildNewInvoice({ job: { id: 'j' }, intake: parseStructuredIntake({ fields: { venue: 'Old Hall', date: '2026-12-01' } }, NOW), settings: s, now: NOW }).invoice;
  const edited = { ...first, details: { ...first.details!, fields: first.details!.fields.map(f => (f.key === 'date' ? { ...f, value: 'my own date' } : f)) } };
  const fresh = buildNewInvoice({ job: { id: 'j' }, intake: parseStructuredIntake({ fields: { venue: 'New Hall', date: '2027-01-01' } }, NOW), settings: s, now: NOW }).invoice;
  const r = refreshFromJob(edited, fresh);
  assert.deepEqual(r.changed, ['details.venue']); assert.deepEqual(r.invoice.details!.fields.map(f => f.value), ['New Hall', 'my own date']); assert.deepEqual(refreshFromJob(r.invoice, fresh).changed, []);
});

await t('agent-made invoices upgrade to dynamic mode without changing the total, losing a fee, or losing the vehicle', () => {
  const legacy = base({}, { settings: { taxRate: 6, travelFee: 45, shopSuppliesRate: 10, shopSuppliesCap: 8, hazardousWasteFee: 3.5, miscFee: 7 }, vehicle: { year: '2018', make: 'Toyota', model: 'Tacoma', vin: '5TFAX5GN0JX000000' }, meta: { docType: 'estimate', invoiceNumber: 'A-1' } });
  const s = settings({ details: FIELD_PRESETS.automotive });
  const up = upgradeToDynamic(legacy, s);
  assert.equal(calculateTotals(up).grandTotal, calculateTotals(legacy).grandTotal, 'same total');
  assert.deepEqual(up.fees!.map(f => [f.label, f.kind, f.value, f.cap]), [['Travel Fee', 'flat', 45, 0], ['Shop Supplies Fee', 'percentOfLabor', 10, 8], ['Hazardous Waste Fee', 'flat', 3.5, 0], ['Misc. Fee', 'flat', 7, 0]]);
  assert.deepEqual([up.settings.travelFee, up.settings.miscFee, up.settings.shopSuppliesRate], [0, 0, 0]);
  assert.deepEqual(up.details!.fields.filter(f => ['year', 'make', 'vin'].includes(f.key)).map(f => f.value), ['2018', 'Toyota', '5TFAX5GN0JX000000']);
  assert.deepEqual(upgradeToDynamic(up, s), up, 'idempotent');
  assert.equal(upgradeToDynamic(legacy, settings()).details, undefined, 'no detail fields of your own: the vehicle box stays so nothing is lost');
  assert.deepEqual(upgradeToDynamic(base({}, { meta: { docType: 'estimate' } }), settings()).details, { title: 'Job Details', fields: [] }, 'a document with no vehicle data gets the (empty) custom box');
  const agent = confirmEstimate({ ...legacy }, { by: 'agent', keyId: 'k' }, 'auto', { now: NOW });
  const done = applyPending(agent, settings({ details: FIELD_PRESETS.automotive, terms: { invoiceTerms: 'FINAL' } }), NOW);
  assert.ok(Array.isArray(done.fees) && done.details && done.notes.termsAndConditions === 'FINAL' && geOf(done).pending.length === 0);
});

await t('packages: fees are set by name (an existing fee is updated, not doubled); older fixed-trio packages convert; original-format documents get the nearest fixed field', () => {
  const pkg = normalizePackage({ id: 'p', name: 'Brakes', labor: [{ description: 'x', hours: 1, rate: null }], fees: [{ label: 'trip charge', kind: 'flat', value: 60 }, { label: 'Disposal', kind: 'flat', value: 9, taxable: true }] });
  const inv = base({ fees: [fee({ id: 'a', label: 'Trip Charge', value: 45 })] });
  const once = applyPackage(inv, pkg, 55); const twice = applyPackage(once, pkg, 55);
  assert.deepEqual(once.fees!.map(f => [f.label, f.value, f.taxable]), [['trip charge', 60, false], ['Disposal', 9, true]]); assert.equal(once.fees![0].id, 'a', 'same line, same id');
  assert.equal(twice.fees!.length, 2, 'applying twice never adds a second fee'); assert.equal(twice.laborItems.length, inv.laborItems.length + 2, 'labor does append (as the original)');
  const trio = normalizePackage({ id: 'o', name: 'Old', fees: { travelFee: 45, hazardousWasteFee: 3, miscFee: 0 } }); assert.deepEqual(trio.fees.map(f => [f.label, f.value]), [['Travel Fee', 45], ['Hazardous Waste Fee', 3], ['Misc. Fee', 0]]);
  const legacy = applyPackage(base(), normalizePackage({ id: 'x', name: 'x', fees: [{ label: 'Diagnostic & travel', kind: 'flat', value: 45 }, { label: 'Waste disposal', kind: 'flat', value: 4 }, { label: 'Other', kind: 'flat', value: 2 }, { label: 'Percent', kind: 'percentOfLabor', value: 5 }] }), 55);
  assert.deepEqual([legacy.settings.travelFee, legacy.settings.hazardousWasteFee, legacy.settings.miscFee, legacy.fees], [45, 4, 2, undefined]);
});

await t('shop details always come from Settings: a document with a blank shop prints yours, one with its own keeps it; logo and prefix are settings too', () => {
  const s = settings({ shop: { name: 'Settings Shop', address: '1 Main St', phone: '555', email: 's@example.com', licenseNumber: 'L-1' } });
  const blank = base({}, { shop: { name: '' } });
  assert.deepEqual([withShop(blank, s).shop.name, withShop(blank, s).shop.address], ['Settings Shop', '1 Main St']); assert.equal(withShop(base({}, { shop: { name: 'Own Name' } }), s).shop.name, 'Own Name');
  const pdf = text(renderPdf(blank, s).bytes); const sm = renderSheet(blank, s).model.shop; assert.ok(pdf.includes('(Settings Shop) Tj') && pdf.includes('(1 Main St) Tj') && pdf.includes(`(${escapePdfTextWinAnsi(sm.contact)}) Tj`) && pdf.includes(`(${sm.license}) Tj`) && sm.license.includes('L-1'), 'the PDF prints the same shop strings the sheet does');
  const sheet = renderSheet(blank, s).model.shop; assert.deepEqual([sheet.name, sheet.address, sheet.license], ['Settings Shop', '1 Main St', 'L-1']);
});

await t('editor: no shop card; your detail fields (or the original vehicle box); a fee editor with saved fees; fixed fee inputs only for original-format documents; notes are their own card', () => {
  const dyn = base({ fees: [fee({ id: 'a', label: 'Trip charge', value: 45 })], details: { title: 'Event', fields: [{ key: 'venue', label: 'Venue', type: 'text', value: 'Hall A' }, { key: 'vin', label: 'VIN', type: 'vin', value: 'BAD' }] } });
  const templates = [{ id: 't1', label: 'Rush', kind: 'flat' as const, value: 20, cap: 0, taxable: false, auto: false, quoteKey: '' }, { id: 't2', label: 'Trip charge', kind: 'flat' as const, value: 30, cap: 0, taxable: false, auto: true, quoteKey: '' }];
  const out = html(<InvoiceEditor invoice={dyn} onChange={noop} hourlyRate={50} feeTemplates={templates} />);
  for (const yes of ['Customer Information', 'Event', 'Venue', 'Hall A', 'INVALID VIN', 'Fees', 'value="Trip charge"', 'Add fee', 'Add a saved fee', '>Rush<', 'Fees, Tax &amp; Totals', 'Grand Total:']) assert.ok(out.includes(yes), yes);
  for (const no of ['Shop Information', 'Vehicle Details', 'Shop Supplies Rate', 'Hazardous Waste Fee ($)', 'Notes &amp; Terms']) assert.ok(!out.includes(no), `should not contain ${no}`);
  assert.ok(!out.includes('>Trip charge</option>'), 'a saved fee already on the document is not offered again');
  assert.ok(!html(<InvoiceEditor invoice={{ ...dyn, details: { title: 'Event', fields: [] } }} onChange={noop} hourlyRate={50} />).includes('Event'), 'no fields, no box');
  const old = html(<InvoiceEditor invoice={base()} onChange={noop} hourlyRate={50} />); for (const yes of ['Vehicle Details', 'Shop Supplies Rate', 'Hazardous Waste Fee ($)', 'Misc. Fee ($)']) assert.ok(old.includes(yes), `original format shows ${yes}`);
  const ro = html(<InvoiceEditor invoice={dyn} onChange={noop} readOnly hourlyRate={50} feeTemplates={templates} />);
  const enabled = (ro.match(/<(input|select|textarea|button)\b[^>]*>/g) || []).filter(c => !/\bdisabled\b/.test(c)); assert.deepEqual(enabled, [], `still enabled: ${enabled.slice(0, 2).join(' | ')}`);
  const notes = html(<NotesCard invoice={dyn} onChange={noop} />); assert.ok(notes.includes('Notes &amp; Terms') && notes.includes('Customer Notes') && notes.includes('Terms &amp; Conditions'));
  assert.ok(html(<NotesCard invoice={dyn} onChange={noop} readOnly />).match(/<textarea\b[^>]*>/g)!.every(c => /\bdisabled\b/.test(c)));
});

console.log(`${passed} invoice dynamic checks passed`);
