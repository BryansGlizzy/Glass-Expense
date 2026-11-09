/**
 * UI smoke tests (docs/INVOICING_PLAN.md C14: GE has no DOM test framework). Components are rendered to static HTML on the server, which
 * is enough to prove they render complete data, that hostile content comes out as inert text (React escaping, no raw HTML anywhere),
 * that read-only mode disables every control, and that the sheet and editor mirror the same invoice.
 * Pure: needs no server.   Run:  npx tsx tests/invoice.ui.test.tsx
 */
import React from 'react';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoiceSheet } from '../src/components/invoice/InvoiceSheet.tsx';
import { InvoiceEditor, VinBadge } from '../src/components/invoice/InvoiceEditor.tsx';
import { HistoryDrawer, PackageBar } from '../src/components/invoice/panels.tsx';
import { ReviewConfirmModal, RecordPaymentModal, SendInvoiceModal, NewDocumentModal, NamePrompt } from '../src/components/invoice/modals.tsx';
import { buildSheetModel } from '../src/invoice/sheet.ts';
import { calculateTotals } from '../src/invoice/totals.ts';
import { createEmptyInvoice, addLaborItem, addPartItem } from '../src/invoice/model.ts';
import { defaultSettings, normalizeSettings } from '../src/invoice/settings.ts';
import { automotiveStarter } from '../src/invoice/packages.ts';
import { withGe } from '../src/invoice/ge.ts';
import { renderSheet, renderPdf, fillEmailTemplate, payInfo } from '../src/invoice/render.ts';

let passed = 0;
const t = async (name: string, fn: () => Promise<void> | void) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; } };
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const noop = () => {};
const fmt = (n: number) => '$' + n.toFixed(2);

const EVIL = '<img src=x onerror=alert(1)><script>alert(1)</script>';
let inv = createEmptyInvoice({ meta: { invoiceNumber: 'T-A00001', date: '2026-11-08', docType: 'invoice', status: 'Sent' }, shop: { name: 'Example Auto', phone: '555' }, customer: { name: EVIL, email: 'c@example.com' },
  vehicle: { year: '2018', make: 'Toyota', model: 'Tacoma', vin: '5TFAX5GN0JX000000' }, settings: { taxRate: 6, travelFee: 45 }, notes: { customerNotes: EVIL, termsAndConditions: 'Net 10' } });
inv = addLaborItem(inv, { id: 'l1', description: EVIL, technician: 'T', hours: 1.5, rate: 55 });
inv = addPartItem(inv, { id: 'p1', partNumber: 'PN-1', description: 'Pads', quantity: 2, unitPrice: 12.5 });
const settings = normalizeSettings({ shop: { name: 'Example Auto' }, payments: { paypal: { enabled: true, handle: 'Example' }, zelle: { enabled: true, handle: 'pay@example.com' }, cash: { enabled: true } }, email: { enabled: true }, tax: { rate: 6 } });

await t('sheet: renders every section and the totals; hostile values are escaped text, never elements', () => {
  const out = html(<InvoiceSheet model={buildSheetModel(inv, calculateTotals(inv))} />);
  for (const needle of ['INVOICE', 'Example Auto', 'T-A00001', 'SENT', 'Labor &amp; Diagnostic Services', 'Parts &amp; Materials', 'Total Due:', 'Sales Tax (6%):', '$55.00', 'Customer Signature']) assert.ok(out.includes(needle), needle);
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && out.includes('&lt;img src=x onerror=alert(1)&gt;'), 'escaped');
  const bodyOnly = out.replace(/<style>[\s\S]*?<\/style>/, '');
  assert.ok(!/<script/i.test(bodyOnly) && !/<img/i.test(bodyOnly), 'no injected elements'); assert.ok(!/dangerouslySetInnerHTML/.test(String(InvoiceSheet)), 'no raw HTML escape hatch');
  assert.match(out, /class="badge badge-sent"/); assert.equal((out.match(/class="sh-line[ "]/g) || []).length, 10, 'all ten totals lines');
});
await t('sheet: estimates show the estimate title and "Valid Until"; empty documents show the placeholders; pay instructions appear when given', () => {
  const est = html(<InvoiceSheet model={buildSheetModel({ ...inv, meta: { ...inv.meta, docType: 'estimate', status: 'Estimate' } })} />);
  assert.ok(est.includes('ESTIMATE') && est.includes('Valid Until:') && est.includes('Estimate #:'));
  const empty = html(<InvoiceSheet model={buildSheetModel(createEmptyInvoice())} />);
  assert.ok(empty.includes('Walk-in Customer') && empty.includes('No labor services') && empty.includes('No parts or materials') && !empty.includes('Terms'));
  const pay = renderSheet(inv, settings); assert.ok(pay.payLines.length >= 2);
  assert.ok(html(<InvoiceSheet model={pay.model} payLines={pay.payLines} />).includes('HOW TO PAY'));
});
await t('editor: shows every field and the live totals; the VIN badge validates; AI-drafted lines are marked', () => {
  const marked = withGe(inv, { ai: { lineIds: ['l1'], verified: false } });
  const out = html(<InvoiceEditor invoice={marked} onChange={noop} hourlyRate={55} fromWebsite={{ rates: true }} />);
  for (const needle of ['Customer Information', 'Vehicle Details', 'Labor &amp; Services', 'Parts &amp; Materials', 'Fees, Tax &amp; Totals', 'rates from website', 'Add Labor', 'Add Part', 'Grand Total:', fmt(calculateTotals(inv).grandTotal)])
    assert.ok(out.includes(needle), needle);
  assert.ok(!out.includes('Shop Information'), 'the shop is edited only in Settings → Invoices'); assert.ok(!out.includes('Notes &amp; Terms'), 'notes and terms are a separate card placed under the preview');
  assert.ok(out.includes('border-l-violet-400'), 'AI line marker'); assert.ok(html(<VinBadge vin="5TFAX5GN0JX000000" />).includes('VALID VIN')); assert.ok(html(<VinBadge vin="BAD" />).includes('INVALID VIN')); assert.ok(html(<VinBadge vin="" />).includes('17 alphanumeric'));
  assert.ok(!/<script/i.test(out) && out.includes('&lt;script&gt;'));
  assert.equal(calculateTotals(inv).grandTotal, 154, 'sanity: 82.50 labor + 25 parts + 45 travel + 1.50 tax (6% of parts)');
});
await t('editor: read-only mode disables every control (a member viewing the owner\'s invoice)', () => {
  const out = html(<InvoiceEditor invoice={inv} onChange={noop} readOnly hourlyRate={55} />);
  const controls = out.match(/<(input|select|textarea|button)\b[^>]*>/g) || [];
  const enabled = controls.filter(c => !/\bdisabled\b/.test(c)); assert.ok(controls.length > 25);
  assert.deepEqual(enabled, [], `controls still enabled: ${enabled.slice(0, 3).join(' | ')}`);
  assert.ok(html(<InvoiceEditor invoice={inv} onChange={noop} hourlyRate={55} />).match(/<(input|select|textarea)\b[^>]*>/g)!.some(c => !/\bdisabled\b/.test(c)), 'editable for the owner');
});
await t('package bar: suggestions, the starter offer when empty, and the "More" overflow beyond 12', () => {
  const starter = automotiveStarter();
  const out = html(<PackageBar packages={starter} services={['Brakes & Rotors']} readOnly={false} siteServices={[]} onApply={noop} onApplyAll={noop} onSaveAs={noop} onSeedStarter={noop} onSeedSite={noop} />);
  assert.ok(out.includes('Suggested') && out.includes('Add all suggested (1)') && out.includes('Save lines as package') && out.includes('Front Brake Pads'));
  const none = html(<PackageBar packages={[]} services={[]} readOnly={false} siteServices={['Cooling Systems']} onApply={noop} onApplyAll={noop} onSaveAs={noop} onSeedStarter={noop} onSeedSite={noop} />);
  assert.ok(none.includes('automotive starter') && none.includes('from my website'));
  const many = Array.from({ length: 15 }, (_, i) => ({ ...starter[0], id: `p${i}`, name: `Pkg ${i}`, order: i }));
  assert.ok(html(<PackageBar packages={many} services={[]} readOnly={false} siteServices={[]} onApply={noop} onApplyAll={noop} onSaveAs={noop} onSeedStarter={noop} onSeedSite={noop} />).includes('More (3)'));
  assert.ok(!html(<PackageBar packages={starter} services={[]} readOnly siteServices={[]} onApply={noop} onApplyAll={noop} onSaveAs={noop} onSeedStarter={noop} onSeedSite={noop} />).includes('Save lines as package'));
});
await t('history drawer: lists documents with status, total and owner-only delete', () => {
  const rec = (can: boolean) => ({ id: 'r1', job_id: 'j1', rev: 1, user_id: 'u', created_at: '', updated_at: '', can_edit: can, invoice: inv });
  const owner = html(<HistoryDrawer records={[rec(true)]} jobTitles={{ j1: 'Brake job' }} currentId={null} onOpen={noop} onDelete={noop} onClose={noop} />);
  assert.ok(owner.includes('T-A00001') && owner.includes('Brake job') && owner.includes('$154.00') && owner.includes('>Load<') && owner.includes('aria-label="Delete"'));
  const member = html(<HistoryDrawer records={[rec(false)]} jobTitles={{}} currentId={null} onOpen={noop} onDelete={noop} onClose={noop} />);
  assert.ok(member.includes('>View<') && !member.includes('aria-label="Delete"'));
  assert.ok(html(<HistoryDrawer records={[]} jobTitles={{}} currentId={null} onOpen={noop} onDelete={noop} onClose={noop} />).includes('No saved invoices yet'));
});
await t('modals: review checklist, payment preview with the tax split, send dialog with links and the opt-in explanation', () => {
  const est = { ...inv, meta: { ...inv.meta, docType: 'estimate' as const } };
  const review = html(<ReviewConfirmModal invoice={est} onConfirm={noop} onClose={noop} />);
  assert.ok(review.includes('Review &amp; confirm final invoice') && review.includes('Labor lines and actual hours') && review.includes('Confirm final invoice'));
  const pay = html(<RecordPaymentModal invoice={inv} settings={settings} onRecord={async () => {}} onClose={noop} />);
  assert.ok(pay.includes('Record payment') && pay.includes('Balance due $154.00') && pay.includes('income entry of $152.50') && pay.includes('$1.50 sales tax'), pay.slice(pay.indexOf('Adds an'), pay.indexOf('Adds an') + 300));
  const send = html(<SendInvoiceModal invoice={inv} settings={settings} onSent={noop} onClose={noop} />);
  assert.ok(send.includes('value="c@example.com"') && send.includes('Invoice T-A00001 from Example Auto') && send.includes('PayPal') && send.includes('Send</button>'));
  const off = html(<SendInvoiceModal invoice={inv} settings={defaultSettings()} onSent={noop} onClose={noop} />); assert.ok(off.includes('In-app e-mail is off') && off.includes('Open in my mail app') && !off.includes('>Send</button>'));
  assert.ok(html(<NewDocumentModal jobs={[{ id: 'j', title: 'Job A', invoice_number: 'X-1' }]} onPick={noop} onQuick={async () => {}} onClose={noop} />).includes('Job A'));
  assert.ok(html(<NamePrompt title="T" label="L" confirm="Go" onSubmit={noop} onClose={noop} />).includes('Go'));
});
await t('render helpers: the PDF uses your labels and shows payment instructions only on final invoices; e-mail templates fill every variable', () => {
  const s2 = normalizeSettings({ ...settings });
  const pdf = Buffer.from(renderPdf(inv, s2).bytes).toString('latin1');
  assert.ok(pdf.includes('(Travel Fee:) Tj') && pdf.includes('(HOW TO PAY) Tj') && pdf.includes('Payment received:') && pdf.includes('[ ] PayPal'));
  const estPdf = Buffer.from(renderPdf({ ...inv, meta: { ...inv.meta, docType: 'estimate' } }, s2).bytes).toString('latin1'); assert.ok(!estPdf.includes('HOW TO PAY'));
  assert.equal(renderPdf(inv, s2).filename, 'invoice-T-A00001.pdf'); assert.equal(renderPdf({ ...inv, meta: { ...inv.meta, docType: 'estimate' } }, s2).filename, 'estimate-T-A00001.pdf');
  const body = fillEmailTemplate(settings.email.body, { ...inv, customer: { ...inv.customer, name: 'Pat Example' } }, settings);
  assert.ok(body.startsWith('Hi Pat,') && body.includes('Invoice T-A00001') && body.includes('$154.00') && body.includes('https://www.paypal.me/Example/154.00USD') && body.includes('Zelle: pay@example.com') && !body.includes('{{'));
  assert.equal(payInfo({ ...inv, meta: { ...inv.meta, docType: 'estimate' } }, settings).options.length, 0);
});

console.log(`${passed} invoice ui checks passed`);
