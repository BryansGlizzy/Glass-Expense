/**
 * Internal invoice e-mailer (docs/INVOICING_PLAN.md §5.12, success criterion 13). The test server runs without SMTP and with
 * EMAIL_CAPTURE_DIR, so messages and the EXACT attachment bytes land on disk: the attachment must equal the client's PDF.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { call, registerUser } from './helpers.ts';
import { generatePdfBytes } from '../src/invoice/pdf/generate.ts';
import { createEmptyInvoice, addLaborItem } from '../src/invoice/model.ts';
import { calculateTotals } from '../src/invoice/totals.ts';

const DIR = path.join(process.env.DATA_DIR!, 'mail');
let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split("\n").slice(0, 14).join('\n       ')); process.exitCode = 1; } };

const user = await registerUser('mailuser');
const inv = addLaborItem(createEmptyInvoice({ meta: { invoiceNumber: 'T-A00001' }, shop: { name: 'Example Auto' } }), { id: 'l', description: 'Work', hours: 1, rate: 55 });
const pdf = generatePdfBytes(inv, calculateTotals(inv));
const good = () => ({ to: 'customer@example.com', subject: 'Invoice T-A00001 from Example Auto', text: 'Hi Pat,\nYour invoice is attached.\n<b>total</b> $55.00', pdf_base64: Buffer.from(pdf).toString('base64'), filename: 'invoice-T-A00001.pdf', shop_name: 'Example Auto', reply_to: 'shop@example.com' });
const send = (body: any, token = user.token) => call('POST', '/api/invoices/send', { token, body });
const captured = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR) : []);

await t('sends: the captured attachment is byte-identical to the client PDF; HTML is built from escaped text; pay links become buttons', async () => {
  const before = captured().length;
  const r = await send({ ...good(), bcc: ['me@example.com'], pay_links: [{ label: 'PayPal', url: 'https://www.paypal.me/Example/55.00USD' }, { label: 'Venmo', url: 'https://venmo.com/example?txn=pay&amount=55.00' }] });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.deepEqual([r.json.success, r.json.recipients], [true, 2]);
  const files = captured().slice(before); const html = files.find(f => f.endsWith('-invoice.html'))!; const att = files.find(f => f.endsWith('invoice-T-A00001.pdf'))!;
  assert.ok(html && att);
  assert.ok(Buffer.compare(fs.readFileSync(path.join(DIR, att)), Buffer.from(pdf)) === 0, 'attachment bytes equal the client PDF');
  const whole = fs.readFileSync(path.join(DIR, html), 'utf8'); const body = whole.split('<!-- text -->')[0]; // the HTML part only; the plain-text part is plain text
  assert.match(body, /to: customer@example.com \| cc: {2}\| bcc: me@example.com \| reply-to: shop@example.com \| from-name: Example Auto \| subject: Invoice T-A00001 from Example Auto/);
  assert.ok(body.includes('&lt;b&gt;total&lt;/b&gt;') && !body.includes('<b>total</b>'), 'client text is escaped');
  assert.ok(body.includes('href="https://www.paypal.me/Example/55.00USD"') && body.includes('Pay with Venmo'));
  assert.ok(whole.split('<!-- text -->')[1].includes('PayPal: https://www.paypal.me/Example/55.00USD'), 'the plain-text alternative lists the links too');
});
await t('rejects header injection, bad addresses, more than 3 recipients and bad file names', async () => {
  const bads: any[] = [{ subject: 'Hi\r\nBcc: spam@example.com' }, { to: 'a@example.com\r\nBcc: x@example.com' }, { to: 'not-an-email' }, { to: '' }, { to: ['a@example.com', 'b@example.com'], cc: ['c@example.com'], bcc: ['d@example.com'] },
    { reply_to: 'x@y\nz.com' }, { cc: ['bad'] }, { filename: '../evil.pdf' }, { filename: 'invoice.exe' }, { subject: '' }, { text: '' }, { text: 'x'.repeat(10_001) }, { subject: 'x'.repeat(301) }];
  for (const b of bads) assert.equal((await send({ ...good(), ...b })).status, 400, JSON.stringify(b).slice(0, 80));
});
await t('rejects non-PDFs, malformed or oversized attachments', async () => {
  for (const b of [{ pdf_base64: Buffer.from('<html>not a pdf</html>').toString('base64') }, { pdf_base64: '!!!' }, { pdf_base64: '' }, { pdf_base64: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3 * 1024 * 1024)]).toString('base64') }, { pdf_base64: undefined }])
    assert.ok([400, 413].includes((await send({ ...good(), ...b })).status), 'refused (400 from the route, or 413 from the body-size limit)');
});
await t('pay links must be https on PayPal.Me / Venmo / Cash App (no http, look-alike hosts, javascript:, or a long list)', async () => {
  for (const url of ['http://paypal.me/x', 'https://evil.example/paypal.me', 'https://paypal.me.evil.example/x', 'javascript:alert(1)', 'https://user:pw@paypal.me/x', 'https://paypal.me:8443/x', 'ftp://venmo.com/x'])
    assert.equal((await send({ ...good(), pay_links: [{ label: 'Pay', url }] })).status, 400, url);
  assert.equal((await send({ ...good(), pay_links: Array.from({ length: 7 }, () => ({ label: 'x', url: 'https://cash.app/$x' })) })).status, 400);
  for (const url of ['https://www.paypal.com/signin', 'https://www.paypal.com/ncp/payment/ABC123?redirect=evil']) assert.equal((await send({ ...good(), pay_links: [{ label: 'PayPal', url }] })).status, 400, url);
  assert.equal((await send({ ...good(), pay_links: [{ label: 'Cash App', url: 'https://cash.app/$Example' }, { label: 'PayPal', url: 'https://www.paypal.com/ncp/payment/ABCDEFGH12345' }] })).status, 200, 'a PayPal payment link is accepted');
});
await t('only interactive sessions may send: API keys and anonymous calls are refused', async () => {
  assert.ok([401, 403].includes((await send(good(), '')).status), 'anonymous');
  assert.ok([401, 403].includes((await call('POST', '/api/invoices/send', { apiKey: 'ge_whatever', body: good() })).status), 'API key');
});
await t('a flat per-user daily cap applies (INVOICE_EMAIL_DAILY_LIMIT) and counts per user', async () => {
  const u2 = await registerUser('mailcap'); const u3 = await registerUser('mailcap2');
  for (let i = 0; i < 8; i++) assert.equal((await send(good(), u2.token)).status, 200, `message ${i + 1}`);
  const over = await send(good(), u2.token); assert.equal(over.status, 429); assert.match(over.json.error, /Daily e-mail limit/);
  assert.equal((await send(good(), u3.token)).status, 200, 'another user is unaffected');
});

console.log(`${passed} mailer checks passed`);
