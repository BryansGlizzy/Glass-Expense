/**
 * Detail-field presets: several named sets per user, linked to job codes (the part of the invoice number before the first dash), applied
 * automatically to new documents, appliable to existing ones, and reflected in the final-review checklist (no hard-coded "Vehicle details").
 * Pure: needs no server.   Run:  npx tsx tests/invoice.detailsets.test.tsx
 */
import React from 'react';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEmptyInvoice } from '../src/invoice/model.ts';
import { defaultSettings, normalizeSettings, matchCodes, detailSetFor, FIELD_PRESETS } from '../src/invoice/settings.ts';
import { buildNewInvoice } from '../src/invoice/prefill.ts';
import { applyDetailSet, autoApplyDetailSet } from '../src/invoice/detailSets.ts';
import { upgradeToDynamic } from '../src/invoice/pending.ts';
import { reviewChecklist } from '../src/invoice/review.ts';
import { normalizeInvoice } from '../src/invoice/normalize.ts';
import { parseStructuredIntake } from '../src/invoice/intake.ts';
import { InvoiceEditor } from '../src/components/invoice/InvoiceEditor.tsx';

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 8).join('\n   ')); process.exitCode = 1; } };
const NOW = new Date(2026, 10, 8, 12, 0, 0);

const SETS = [
  { id: 'auto', name: 'Automotive', title: 'Vehicle Details', match: 'auto, car', fields: FIELD_PRESETS.automotive.fields },
  { id: 'hvac', name: 'HVAC', title: 'Equipment', match: 'HVAC', fields: [{ label: 'Unit make' }, { label: 'Serial #' }, { label: 'Year', key: 'year' }] },
  { id: 'any', name: 'General', title: 'Job Details', match: '', fields: [{ label: 'Site' }] },
];
const settings = (over: any = {}) => normalizeSettings({ shop: { name: 'Shop' }, detailSets: SETS, ...over });

await t('settings: several presets are kept, bounded and cleaned; job codes normalize; garbage is repaired', () => {
  const s = settings();
  assert.deepEqual(s.detailSets.map(x => [x.id, x.name, x.match, x.fields.length]), [['auto', 'Automotive', 'AUTO, CAR', 8], ['hvac', 'HVAC', 'HVAC', 3], ['any', 'General', '', 1]]);
  assert.deepEqual(matchCodes(' auto,, Car; a b!c  AUTO -x- '), ['AUTO', 'CAR', 'A', 'BC', 'X']);
  assert.equal(normalizeSettings({ detailSets: Array.from({ length: 40 }, (_, i) => ({ name: `s${i}` })) }).detailSets.length, 20);
  const dup = normalizeSettings({ detailSets: [{ id: 'x', title: 'A' }, { id: 'x', title: 'B' }, 'junk', { id: '../bad id', name: '' }] }).detailSets;
  assert.equal(new Set(dup.map(x => x.id)).size, 4, 'duplicate or invalid ids are repaired'); assert.ok(dup.every(x => x.title && x.name));
  assert.deepEqual(normalizeSettings(normalizeSettings({ detailSets: SETS })), normalizeSettings({ detailSets: SETS }), 'idempotent');
  assert.deepEqual(defaultSettings().detailSets, []);
});

await t('settings: the former single detail box becomes one fallback preset; an empty one becomes none', () => {
  const m = normalizeSettings({ details: { title: 'Vehicle Details', fields: [{ label: 'Make' }] } }).detailSets;
  assert.deepEqual(m.map(x => [x.id, x.name, x.title, x.match, x.fields.map(f => f.key)]), [['set-default', 'Vehicle Details', 'Vehicle Details', '', ['make']]]);
  assert.deepEqual(normalizeSettings({ details: { title: 'Job Details', fields: [] } }).detailSets, []);
  assert.equal(normalizeSettings({ detailSets: [], details: { fields: [{ label: 'Old' }] } }).detailSets.length, 0, 'an explicit list wins over the old box');
});

await t('linking: AUTO-102912091 uses the automotive preset, HVAC-… the HVAC one, others the fallback; the longest code wins; no prefix collisions', () => {
  const sets = settings().detailSets;
  const pick = (...c: string[]) => detailSetFor(sets, c)?.id;
  assert.deepEqual([pick('AUTO-102912091'), pick('auto-a00001'), pick('CAR-A00002'), pick('HVAC-A00001'), pick('INV-A00001'), pick('A00001'), pick(), pick('AUTOMOTIVE-1')], ['auto', 'auto', 'auto', 'hvac', 'any', 'any', 'any', 'any']);
  assert.equal(pick('INV-A00001', 'AUTO'), 'auto', 'the job tag also counts');
  assert.equal(detailSetFor([{ ...sets[0], match: 'A' }, { ...sets[1], match: 'AUTO' }], ['AUTO-1'])!.id, 'hvac', 'longest code wins');
  assert.equal(detailSetFor(sets.slice(0, 2), ['INV-A00001']), null, 'no fallback and no match: none');
  assert.equal(detailSetFor([], ['AUTO-1']), null);
});

await t('new documents get the preset for the job number, with title, setId and fields filled from the job; other jobs get theirs', () => {
  const s = settings();
  const intake = parseStructuredIntake({ vehicle: { year: 2018, make: 'Toyota', model: 'Tacoma' }, client_name: 'Pat' }, NOW);
  const auto = buildNewInvoice({ job: { id: 'j1', invoice_number: 'AUTO-A00001' }, intake, settings: s, now: NOW }).invoice;
  assert.deepEqual([auto.details!.title, auto.details!.setId, auto.details!.fields.length], ['Vehicle Details', 'auto', 8]);
  assert.deepEqual(auto.details!.fields.filter(f => ['year', 'make', 'model'].includes(f.key)).map(f => f.value), ['2018', 'Toyota', 'Tacoma']);
  const hvac = buildNewInvoice({ job: { id: 'j2', invoice_number: 'HVAC-A00007' }, settings: s, now: NOW }).invoice;
  assert.deepEqual([hvac.details!.title, hvac.details!.setId, hvac.details!.fields.map(f => f.key)], ['Equipment', 'hvac', ['unit_make', 'serial', 'year']]);
  const tagged = buildNewInvoice({ job: { id: 'j3', invoice_number: 'X-1', invoice_tag: 'CAR' }, settings: s, now: NOW }).invoice; assert.equal(tagged.details!.setId, 'auto');
  const none = buildNewInvoice({ job: { id: 'j4', invoice_number: 'AUTO-1' }, settings: settings({ detailSets: [] }), now: NOW }).invoice; assert.deepEqual(none.details, { title: 'Job Details', fields: [] });
});

await t('applying a preset to an existing invoice keeps typed values, fills blanks from the job, and keeps typed values the preset has no field for', () => {
  const s = settings();
  const inv = buildNewInvoice({ job: { id: 'j', invoice_number: 'HVAC-A00001' }, settings: s, now: NOW }).invoice;
  const typed = { ...inv, details: { ...inv.details!, fields: inv.details!.fields.map(f => (f.key === 'serial' ? { ...f, value: 'SN-9' } : f.key === 'year' ? { ...f, value: '2011' } : f)) } };
  const intake = parseStructuredIntake({ vehicle: { make: 'Honda', model: 'Civic' } }, NOW);
  const auto = applyDetailSet(typed, s.detailSets[0], intake);
  const v = Object.fromEntries(auto.details!.fields.map(f => [f.key, f.value]));
  assert.deepEqual([auto.details!.title, auto.details!.setId, v.year, v.make, v.model], ['Vehicle Details', 'auto', '2011', 'Honda', 'Civic'], 'year is kept, make and model come from the job');
  assert.equal(v.serial, 'SN-9', 'a typed value with no matching field is kept, not lost'); assert.ok(!('unit_make' in v), 'blank fields of the old preset are dropped');
  assert.deepEqual(applyDetailSet(auto, s.detailSets[0], intake), auto, 'idempotent');
  assert.equal(typed.details!.title, 'Equipment', 'the original is not mutated');
});

await t('an original-format invoice (fixed vehicle box) can take a preset: its vehicle values carry over by key', () => {
  const legacy = createEmptyInvoice({ meta: { invoiceNumber: 'AUTO-A00005', docType: 'estimate' }, vehicle: { year: '2016', make: 'Ford', licensePlate: 'ABC123', mileage: '90000' } }, NOW);
  const out = applyDetailSet(legacy, settings().detailSets[0]);
  const v = Object.fromEntries(out.details!.fields.map(f => [f.key, f.value]));
  assert.deepEqual([v.year, v.make, v.license_plate, v.mileage], ['2016', 'Ford', 'ABC123', '90000']);
  const onlyHvac = applyDetailSet(legacy, settings().detailSets[1]);
  assert.deepEqual(onlyHvac.details!.fields.filter(f => f.value).map(f => [f.key, f.value]), [['year', '2016'], ['make', 'Ford'], ['license_plate', 'ABC123'], ['mileage', '90000']], 'HVAC has a year field; the other vehicle values (no HVAC field) are kept below, not lost');
});

await t('auto-apply on open: fills an empty or missing box from the number, never replaces a filled one, and does nothing without a match', () => {
  const s = settings();
  const legacy = createEmptyInvoice({ meta: { invoiceNumber: 'AUTO-A00005', docType: 'estimate' }, vehicle: { make: 'Ford' } }, NOW);
  const a = autoApplyDetailSet(legacy, s, []); assert.deepEqual([a.set?.id, a.invoice.details!.fields.find(f => f.key === 'make')!.value], ['auto', 'Ford']);
  const filled = a.invoice; const again = autoApplyDetailSet(filled, s, ['HVAC-1']); assert.equal(again.invoice, filled); assert.equal(again.set, null);
  const emptyBox = { ...legacy, details: { title: 'Job Details', fields: [] } }; assert.equal(autoApplyDetailSet(emptyBox, s, []).set?.id, 'auto');
  const noMatch = createEmptyInvoice({ meta: { invoiceNumber: 'INV-A1' } }, NOW); assert.equal(autoApplyDetailSet(noMatch, settings({ detailSets: SETS.slice(0, 2) }), ['INV-A1']).set, null);
  assert.equal(autoApplyDetailSet(legacy, s, ['HVAC-1']).set?.id, 'auto', "the document's own number is checked first");
});

await t('agent-made documents get the preset linked to their number when the owner’s browser finishes them', () => {
  const agent = createEmptyInvoice({ meta: { invoiceNumber: 'HVAC-A00009', docType: 'estimate' }, vehicle: { year: '2020' } }, NOW);
  const up = upgradeToDynamic(agent, settings());
  assert.deepEqual([up.details!.setId, up.details!.fields.find(f => f.key === 'year')!.value], ['hvac', '2020']);
});

await t('review checklist: the details row follows the applied preset (title and blanks), and is not "Vehicle details" unless the document is original-format', () => {
  const s = settings();
  const hvac = buildNewInvoice({ job: { id: 'j', invoice_number: 'HVAC-A00001' }, settings: s, now: NOW }).invoice;
  const row = (i: typeof hvac) => reviewChecklist(i).filter(x => x.id === 'details' || x.id === 'vehicle');
  assert.deepEqual(row(hvac).map(x => [x.id, x.label, x.ok, x.detail]), [['details', 'Equipment', false, 'All fields are blank: Unit make, Serial #, Year']]);
  const filled = { ...hvac, details: { ...hvac.details!, fields: hvac.details!.fields.map(f => (f.key === 'serial' ? { ...f, value: 'SN1' } : f)) } };
  assert.deepEqual(row(filled).map(x => [x.label, x.ok, x.detail]), [['Equipment', true, 'Blank: Unit make, Year']]);
  const full = { ...hvac, details: { ...hvac.details!, fields: hvac.details!.fields.map(f => ({ ...f, value: 'x' })) } }; assert.deepEqual(row(full).map(x => [x.ok, x.detail]), [[true, undefined]]);
  const many = { ...hvac, details: { title: 'Big', fields: Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, type: 'text' as const, value: '' })) } }; assert.match(row(many)[0].detail!, /L0, L1, L2, L3 \+3 more/);
  assert.deepEqual(row({ ...hvac, details: { title: 'Empty', fields: [] } }), [], 'a box with no fields has nothing to check');
  const old = createEmptyInvoice({ vehicle: { make: 'Ford' } }, NOW); assert.deepEqual(row(old).map(x => [x.label, x.ok]), [['Vehicle details', true]], 'original-format documents are still checked for a vehicle');
  assert.ok(!reviewChecklist(hvac).some(x => /vehicle/i.test(x.label)), 'no hard-coded vehicle row on an HVAC invoice');
});

await t('document: setId survives normalization (browser and server) and a hostile one is dropped', () => {
  assert.equal(normalizeInvoice({ details: { title: 'T', setId: 'auto', fields: [] } }).details!.setId, 'auto');
  assert.equal(normalizeInvoice({ details: { title: 'T', setId: '<script>', fields: [] } }).details!.setId, undefined);
  assert.ok(!('setId' in normalizeInvoice({ details: { title: 'T', fields: [] } }).details!));
});

await t('editor: the picker lists your presets, marks the applied and the number-linked one, hides when read-only, and shows on an empty box and on an original-format document', () => {
  const s = settings(); const noop = () => {};
  const auto = buildNewInvoice({ job: { id: 'j', invoice_number: 'AUTO-A00001' }, settings: s, now: NOW }).invoice;
  const h = renderToStaticMarkup(<InvoiceEditor invoice={auto} onChange={noop} hourlyRate={50} detailSets={s.detailSets} />);
  assert.ok(h.includes('Apply detail fields') && h.includes('Automotive (applied)') && h.includes('>HVAC<') && h.includes('Vehicle Details'));
  const switched = { ...auto, meta: { ...auto.meta, invoiceNumber: 'HVAC-A00001' } };
  assert.ok(renderToStaticMarkup(<InvoiceEditor invoice={switched} onChange={noop} hourlyRate={50} detailSets={s.detailSets} />).includes('HVAC (matches this number)'));
  assert.ok(!renderToStaticMarkup(<InvoiceEditor invoice={auto} onChange={noop} hourlyRate={50} readOnly detailSets={s.detailSets} />).includes('Apply detail fields'));
  const empty = { ...auto, details: { title: 'Job Details', fields: [] } };
  assert.ok(renderToStaticMarkup(<InvoiceEditor invoice={empty} onChange={noop} hourlyRate={50} detailSets={s.detailSets} />).includes('Choose a preset above'));
  assert.ok(!renderToStaticMarkup(<InvoiceEditor invoice={empty} onChange={noop} hourlyRate={50} />).includes('Job Details'), 'no presets and no fields: no card');
  const old = createEmptyInvoice({}, NOW); assert.ok(renderToStaticMarkup(<InvoiceEditor invoice={old} onChange={noop} hourlyRate={50} detailSets={s.detailSets} />).includes('Apply detail fields'));
});

console.log(`${passed} detail-set checks passed`);
