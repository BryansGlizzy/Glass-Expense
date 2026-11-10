/**
 * Agent API, Invoicing 2.0 (docs/DOCUMENTATION.md §13.7, §13.12): structured job intake with a website `quote`
 * and idempotent `external_ref`, a browser edit that must not drop the new job fields (C6), and the invoice permission levels
 * (none < read < draft < finalize): agents can draft estimates and, with `finalize`, confirm them; never edit a final invoice,
 * send e-mail, record payments or delete.
 */
import './shim.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { call } from './helpers.ts';
import { installE2eeRouter } from '../src/e2ee/router.ts';
import { register } from '../src/e2ee/auth.ts';
import { getSession, invalidate, ensureJobKeys } from '../src/e2ee/session.ts';
import { deterministicUuid } from '../src/e2ee/store.ts';
import * as C from '../src/e2ee/crypto.ts';
import { applyPending } from '../src/invoice/pending.ts';
import { normalizeSettings } from '../src/invoice/settings.ts';
import { geOf } from '../src/invoice/ge.ts';

const DATA_DIR = process.env.DATA_DIR!;
let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split("\n").slice(0, 16).join('\n       ')); process.exitCode = 1; } };
const page = async (method: string, path: string, body?: any) => {
  const init: any = { method, headers: { Authorization: `Bearer ${getSession().token}` } };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(path, init); return { status: res.status, json: await res.json().catch(() => null) };
};
const agent = (key: string, method: string, path: string, body?: any) => call(method, `/api/agent/v1${path}`, { apiKey: key, body });

installE2eeRouter();
await register({ username: 'agentinv', email: 'agentinv@example.com', password: 'correct horse battery staple', mnemonic: C.generateMnemonic() });
{ const w = new Database(`${DATA_DIR}/data.db`); w.prepare("UPDATE users SET plan='pro' WHERE username='agentinv'").run(); w.close(); }
const mine = (await page('POST', '/api/jobs', { title: 'Owner Made Job', client_name: 'Owner Client' })).json.id as string;
const other = (await page('POST', '/api/jobs', { title: 'Uncovered Job' })).json.id as string;

const makeKey = async (name: string, agentOpts: any) => { const r = await page('POST', '/api/keys', { name, agent: agentOpts }); assert.equal(r.status, 200, JSON.stringify(r.json)); return { id: r.json.key.id as string, header: r.json.headerKey as string }; };
const none = await makeKey('none', { access: 'write', all_jobs: true });
const reader = await makeKey('reader', { access: 'write', all_jobs: true, invoices: 'read' });
const drafter = await makeKey('drafter', { access: 'write', all_jobs: true, invoices: 'draft' });
const finalizer = await makeKey('finalizer', { access: 'write', all_jobs: true, invoices: 'finalize' });
const selected = await makeKey('selected drafter', { access: 'write', all_jobs: false, job_ids: [mine], invoices: 'draft' });

const PAYLOAD = { external_ref: 'sub-7d6c', title: 'Auto: 2012 Nissan Xterra - Sample Customer', mode: 'budget', start_date: '2026-11-12', end_date: '2026-11-12',
  client_name: 'SAMPLE CUSTOMER', client_email: 'Customer@Example.com', client_phone: '5550100142', client_address: '123 frontage rd nw',
  vehicle: { year: '2012', make: 'nissan', model: 'Xterra', engine: '4wd' }, services: ['Other'], parts_policy: 'own-parts', symptoms: 'Rattle from the rear',
  preferred: { start: '2026-11-12', end: '2026-11-12', window: 'Flexible' }, quote: { hourly_rate: 55, base_fee: 45 } };
let site = '';

await t('structured create: intake, quote → job_rate, canonical description, normalized contact, an invoice number', async () => {
  const r = await agent(finalizer.header, 'POST', '/jobs', PAYLOAD);
  assert.equal(r.status, 201, JSON.stringify(r.json)); site = r.json.id;
  assert.deepEqual([r.json.job_rate, r.json.client_name, r.json.client_email, r.json.client_phone], [55, 'Sample Customer', 'customer@example.com', '+15550100142']);
  assert.deepEqual(r.json.intake.quote, { hourlyRate: 55, baseFee: 45 }); assert.equal(r.json.intake.source, 'api'); assert.equal(r.json.intake.partsPolicy, 'own-parts');
  assert.equal(r.json.intake.vehicle.engine, '4WD'); assert.ok(r.json.intake.warnings.some((w: any) => w.code === 'address_incomplete'));
  assert.match(r.json.description, /^Customer: Sample Customer\nEmail: customer@example.com\nPhone: \(555\) 010-0142\nAddress: 123 Frontage Rd NW\nVehicle: 2012 Nissan Xterra 4WD\nServices: Other Custom Work\nInspection: Customer will provide own parts\/hardware\n/);
  assert.match(r.json.invoice_number, /-A\d{5}$/); assert.equal(r.json.start_date, '2026-11-12');
});
await t('external_ref makes a website retry idempotent (200 + duplicate:true, no second job); a new ref creates a new job', async () => {
  const before = (await agent(finalizer.header, 'GET', '/jobs')).json.length;
  const again = await agent(finalizer.header, 'POST', '/jobs', PAYLOAD);
  assert.deepEqual([again.status, again.json.duplicate, again.json.id], [200, true, site]);
  assert.equal((await agent(finalizer.header, 'GET', '/jobs')).json.length, before);
  assert.equal((await agent(finalizer.header, 'POST', '/jobs', { ...PAYLOAD, external_ref: 'sub-other' })).status, 201);
});
await t('structured create validates strictly; free text sent alongside is kept; text-only payloads still work', async () => {
  for (const bad of [{ quote: { hourly_rate: -1 } }, { quote: { hourly_rate: 'x' } }, { quote: { variables: { 'bad key': 1 } } }, { vehicle: { year: 1850 } }, { services: 'x' }, { parts_policy: 'maybe' }, { external_ref: 'has space' }])
    assert.equal((await agent(finalizer.header, 'POST', '/jobs', { title: 'Bad', ...bad })).status, 400, JSON.stringify(bad));
  const both = await agent(finalizer.header, 'POST', '/jobs', { title: 'Both', client_name: 'Pat', description: 'Extra context from the form', quote: { hourly_rate: 60 } });
  assert.equal(both.status, 201); assert.equal(both.json.description, 'Customer: Pat\n\nNotes:\nExtra context from the form'); assert.equal(both.json.job_rate, 60);
  const old = await agent(finalizer.header, 'POST', '/jobs', { title: 'Old style', description: 'Customer: X\nVehicle: 2015 Ford F-150' });
  assert.deepEqual([old.status, old.json.intake, old.json.description], [201, null, 'Customer: X\nVehicle: 2015 Ford F-150']);
  assert.equal((await agent(finalizer.header, 'POST', '/jobs', { title: 'x', job_rate: 12, quote: { hourly_rate: 99 } })).json.job_rate, 12, 'an explicit job_rate wins over the quote');
});
await t('structured create takes generic detail fields for any trade (fields.<name>), validates them, and writes them into the description', async () => {
  const r = await agent(finalizer.header, 'POST', '/jobs', { title: 'Wedding photos', client_name: 'Sam Planner', fields: { venue: 'Hall A', guests: 120 }, external_ref: 'fields-1' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(r.json.intake.fields, { venue: 'Hall A', guests: '120' }); assert.match(r.json.description, /Customer: Sam Planner\nVenue: Hall A\nGuests: 120/);
  for (const bad of [{ fields: 'x' }, { fields: ['a'] }, { fields: { 'Bad Key': 'x' } }, { fields: { ok: { nested: true } } }]) assert.equal((await agent(finalizer.header, 'POST', '/jobs', { title: 'Bad', ...bad })).status, 400, JSON.stringify(bad));
  const both = await agent(finalizer.header, 'POST', '/jobs', { title: 'Car + extras', vehicle: { year: 2018, make: 'Toyota' }, fields: { year: '2018', mileage: '84210' }, external_ref: 'fields-2' });
  assert.match(both.json.description, /Vehicle: 2018 Toyota\nMileage: 84210/); assert.ok(!/\nYear: /.test(both.json.description), 'a vehicle key is not repeated');
});
await t('(C6) a browser edit keeps client_phone and intake; the browser sees the agent-created job', async () => {
  invalidate(''); await ensureJobKeys(true);
  assert.equal((await page('PATCH', `/api/jobs/${site}`, { title: 'Renamed in the app', client_name: 'Edited Name' })).status, 200);
  invalidate('');
  const job = (await page('GET', '/api/jobs')).json.find((j: any) => j.id === site);
  assert.deepEqual([job.title, job.client_phone, job.intake.externalRef, job.intake.quote, job.job_rate], ['Renamed in the app', '+15550100142', 'sub-7d6c', { hourlyRate: 55, baseFee: 45 }, 55]);
  assert.equal((await page('PATCH', `/api/jobs/${site}`, { client_phone: '(555) 010-9999' })).json.client_phone, '(555) 010-9999');
  assert.equal((await page('GET', `/api/jobs/${site}`)).json.intake.externalRef, 'sub-7d6c');
});

const est = { invoice: { meta: { invoiceNumber: 'AGENT-1', docType: 'invoice', status: 'Approved' }, customer: { name: 'Sample Customer' }, laborItems: [{ id: 'l1', description: 'Rattle diagnosis', hours: 1.5, rate: 55 }], settings: { travelFee: 45 } } };
let estId = '';
await t('permission levels: none is refused; read can list but not write; draft cannot confirm', async () => {
  assert.equal((await agent(none.header, 'GET', `/jobs/${site}/invoices`)).status, 403);
  assert.equal((await agent(none.header, 'POST', `/jobs/${site}/invoices`, est)).status, 403);
  assert.deepEqual((await agent(reader.header, 'GET', `/jobs/${site}/invoices`)).json, []);
  assert.equal((await agent(reader.header, 'POST', `/jobs/${site}/invoices`, est)).status, 403, 'read cannot draft');
  const made = await agent(drafter.header, 'POST', `/jobs/${site}/invoices`, est);
  assert.equal(made.status, 201, JSON.stringify(made.json)); estId = made.json.id;
  assert.equal((await agent(drafter.header, 'POST', `/invoices/${estId}/confirm`, { note: 'x' })).status, 403, 'draft cannot finalize');
  assert.equal((await agent(reader.header, 'PUT', `/invoices/${estId}`, est)).status, 403); assert.equal((await agent(reader.header, 'POST', `/invoices/${estId}/confirm`, {})).status, 403);
  const me = await agent(finalizer.header, 'GET', '/me'); assert.equal(me.json.invoices, 'finalize');
});
await t('an agent can only create an ESTIMATE (forced), idempotently, with the same id the app would use; ge is never agent-written', async () => {
  const r = (await agent(reader.header, 'GET', `/jobs/${site}/invoices`)).json;
  assert.equal(r.length, 1); const inv = r[0].invoice;
  assert.deepEqual([inv.meta.docType, inv.meta.status, inv.meta.invoiceNumber, inv.laborItems[0].description], ['estimate', 'Estimate', 'AGENT-1', 'Rattle diagnosis']);
  assert.equal(estId, await deterministicUuid(`estimate|${site}`), 'server and browser derive the identical id');
  const again = await agent(drafter.header, 'POST', `/jobs/${site}/invoices`, { invoice: { customer: { name: 'Different' } } });
  assert.deepEqual([again.status, again.json.duplicate, again.json.id], [200, true, estId]);
  const g = geOf(inv); assert.deepEqual([g.origin, g.pending, g.events[0].by, g.events[0].keyId], ['agent', ['defaults'], 'agent', drafter.id]);
  const sneaky = await agent(drafter.header, 'POST', `/jobs/${other}/invoices`, { invoice: { ge: { review: { by: 'human' }, payments: [{ id: 'x', amount: 5 }] } }, external_ref: 'sneaky' });
  assert.equal(sneaky.status, 201); const sg = geOf(sneaky.json.invoice); assert.deepEqual([sg.review, sg.payments.length, sg.origin], [undefined, 0, 'agent']);
  assert.equal((await agent(drafter.header, 'POST', `/jobs/${site}/invoices`, { external_ref: 'bad ref' })).status, 400);
});
await t('draft can edit an unconfirmed estimate (optimistic revision); stale revisions are 409; the status stays an estimate', async () => {
  const cur = (await agent(drafter.header, 'GET', `/jobs/${site}/invoices`)).json[0];
  const up = await agent(drafter.header, 'PUT', `/invoices/${estId}`, { expected_rev: cur.rev, invoice: { laborItems: [{ id: 'l1', description: 'Rattle diagnosis', hours: 2, rate: 55 }], meta: { docType: 'invoice', status: 'Paid' } } });
  assert.equal(up.status, 200, JSON.stringify(up.json)); assert.deepEqual([up.json.rev, up.json.invoice.laborItems[0].hours, up.json.invoice.meta.docType, up.json.invoice.meta.status], [cur.rev + 1, 2, 'estimate', 'Estimate']);
  assert.equal((await agent(drafter.header, 'PUT', `/invoices/${estId}`, { expected_rev: cur.rev, invoice: {} })).status, 409);
  assert.equal((await agent(drafter.header, 'PUT', `/invoices/${estId}`, { expected_rev: 0, invoice: {} })).status, 400); assert.equal((await agent(drafter.header, 'PUT', `/invoices/${estId}`, {})).status, 400);
  assert.equal((await agent(drafter.header, 'PUT', `/invoices/${crypto.randomUUID()}`, { invoice: {} })).status, 404);
});
await t('hostile invoice JSON from an agent is normalized (clamped numbers, allow-listed enums, capped arrays)', async () => {
  const r = await agent(drafter.header, 'POST', `/jobs/${other}/invoices`, { external_ref: 'hostile', invoice: { meta: { status: 'Hacked' }, settings: { taxRate: 9e9, discountType: 'x' }, laborItems: Array.from({ length: 900 }, () => ({ hours: 1e99, rate: 'x', evil: 1 })), surprise: 'x' } });
  const inv = r.json.invoice; assert.deepEqual([r.status, inv.laborItems.length, inv.laborItems[0].hours, inv.laborItems[0].rate, inv.settings.taxRate, inv.settings.discountType, 'surprise' in inv], [200, 500, 100000, 0, 100, 'percent', false].map((v, i) => (i === 0 ? 201 : v)));
});
await t('finalize confirms once, recording the agent and key; final invoices are locked for agents; the owner completes the pending steps', async () => {
  const done = await agent(finalizer.header, 'POST', `/invoices/${estId}/confirm`, { note: 'Hours verified with the customer' });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  const inv = done.json.invoice; const g = geOf(inv);
  assert.deepEqual([inv.meta.docType, inv.meta.status, inv.meta.invoiceNumber], ['invoice', 'Draft', 'AGENT-1']);
  assert.deepEqual([g.review!.by, g.review!.keyId, g.review!.note, g.pending.sort()], ['agent', finalizer.id, 'Hours verified with the customer', ['defaults', 'swapTerms']]);
  assert.equal((await agent(finalizer.header, 'POST', `/invoices/${estId}/confirm`, {})).status, 409, 'already final');
  assert.equal((await agent(finalizer.header, 'PUT', `/invoices/${estId}`, { invoice: { customer: { name: 'Tampered' } } })).status, 409, 'agents cannot edit a final invoice');
  assert.equal((await agent(finalizer.header, 'DELETE', `/invoices/${estId}`)).status, 404, 'no delete route exists for agents');
  for (const [m, p] of [['POST', `/invoices/${estId}/send`], ['POST', `/invoices/${estId}/payments`], ['POST', '/invoices/send']] as const) assert.equal((await agent(finalizer.header, m, p, {})).status, 404, `${m} ${p}`);
  invalidate('');
  const rec = (await page('GET', `/api/jobs/${site}/invoices`)).json[0];
  assert.equal(geOf(rec.invoice).review!.by, 'agent');
  const s = normalizeSettings({ terms: { estimateTerms: 'EST', invoiceTerms: 'FINAL TERMS' }, shop: { name: 'Example Auto', phone: '555' } });
  const completed = applyPending({ ...rec.invoice, notes: { ...rec.invoice.notes, termsAndConditions: 'EST' } }, s);
  assert.deepEqual([completed.notes.termsAndConditions, completed.shop.name, geOf(completed).pending], ['FINAL TERMS', 'Example Auto', []]);
});
await t('scoping: a selected-jobs key only reaches its job; unknown ids are 404; invoice content is sealed in the database', async () => {
  assert.equal((await agent(selected.header, 'GET', `/jobs/${other}/invoices`)).status, 404);
  assert.equal((await agent(selected.header, 'POST', `/jobs/${other}/invoices`, est)).status, 404);
  assert.equal((await agent(selected.header, 'POST', `/jobs/${mine}/invoices`, est)).status, 201);
  assert.equal((await agent(finalizer.header, 'GET', `/jobs/${crypto.randomUUID()}/invoices`)).status, 404);
  const db = new Database(`${DATA_DIR}/data.db`); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();
  const raw = fs.readFileSync(`${DATA_DIR}/data.db`);
  for (const needle of ['Rattle diagnosis', 'Sample Customer', 'Hours verified', 'AGENT-1', 'Rattle from the rear', 'Customer@Example.com', 'customer@example.com']) assert.ok(!raw.includes(Buffer.from(needle)), `plaintext "${needle}" in the database`);
});
await t('key creation validates the new options; the key list reports them', async () => {
  for (const bad of [{ access: 'read', all_jobs: true, invoices: 'draft' }, { access: 'read', all_jobs: true, invoices: 'finalize' }, { access: 'read', all_jobs: true, research: true }])
    assert.equal((await page('POST', '/api/keys', { name: 'bad', agent: bad })).status, 400, JSON.stringify(bad));
  const unknown = await page('POST', '/api/keys', { name: 'unknown level', agent: { access: 'write', all_jobs: true, invoices: 'delete' } });
  assert.equal(unknown.status, 200); assert.equal((await page('GET', '/api/keys')).json.find((k: any) => k.id === unknown.json.key.id).agent_invoices, 'none', 'an unknown level falls back to the least privilege');
  const withResearch = await page('POST', '/api/keys', { name: 'research no endpoint', agent: { access: 'write', all_jobs: true, research: true } });
  assert.equal(withResearch.status, 400); assert.match(withResearch.json.error, /Research endpoint/);
  const list = (await page('GET', '/api/keys')).json;
  assert.deepEqual([list.find((k: any) => k.id === drafter.id).agent_invoices, list.find((k: any) => k.id === none.id).agent_invoices, list.find((k: any) => k.id === drafter.id).agent_research], ['draft', 'none', false]);
});

console.log(`${passed} agent invoice checks passed`);
