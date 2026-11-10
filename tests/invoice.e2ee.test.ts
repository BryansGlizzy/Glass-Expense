/**
 * Encrypted invoice storage (docs/DOCUMENTATION.md §13.6): create/update/delete with optimistic
 * concurrency, members read but cannot write (enforced by the server), non-members see nothing, the database holds no
 * plaintext, ciphertext is bound to its record, deletes cascade, and a saved invoice reloads to identical PDF bytes.
 * Runs the real client layer against the throwaway server (see scripts/test-e2e.sh).
 */
import './shim.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { call } from './helpers.ts';
import { installE2eeRouter } from '../src/e2ee/router.ts';
import { register } from '../src/e2ee/auth.ts';
import { setSession, getSession } from '../src/e2ee/session.ts';
import { approveMember, listMembersNeedingKey } from '../src/e2ee/members.ts';
import * as C from '../src/e2ee/crypto.ts';
import { createEmptyInvoice, addLaborItem, addPartItem } from '../src/invoice/model.ts';
import { generateSheetPdf } from '../src/invoice/pdf/sheetPdf.ts';
import { buildSheetModel } from '../src/invoice/sheet.ts';
import { calculateTotals } from '../src/invoice/totals.ts';

const DATA_DIR = process.env.DATA_DIR!;
let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } };
const page = async (method: string, path: string, body?: any) => {
  const init: any = { method, headers: { Authorization: 'Bearer ignored' } };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(path, init);
  let json: any = null; try { json = await res.clone().json(); } catch {}
  return { status: res.status, json };
};

installE2eeRouter();
const mkUser = async (name: string) => {
  await register({ username: name, email: `${name}@example.com`, password: 'correct horse battery staple', mnemonic: C.generateMnemonic() });
  return { name, session: { ...getSession() } };
};
const as = (u: { session: any }) => setSession({ ...u.session });

const owner = await mkUser('invowner'); const member = await mkUser('invmember'); const outsider = await mkUser('invoutsider');
{ const w = new Database(`${DATA_DIR}/data.db`); w.prepare("UPDATE users SET plan='pro' WHERE username IN ('invowner', 'invmember', 'invoutsider')").run(); w.close(); } // free-tier key limits are a SaaS-mode rule unrelated to this suite

as(owner);
const job = (await page('POST', '/api/jobs', { title: 'Invoice Job Alpha', client_name: 'Sentinel Client Name' })).json.id as string;
const job2 = (await page('POST', '/api/jobs', { title: 'Invoice Job Beta' })).json.id as string;

const sample = () => {
  let inv = createEmptyInvoice({ meta: { invoiceNumber: 'TST-A00001', date: '2026-03-04', docType: 'estimate', status: 'Estimate' }, shop: { name: 'Sentinel Shop Name' }, customer: { name: 'Sentinel Customer Zed', email: 'sentinel@example.com' },
    settings: { taxRate: 6, shopSuppliesRate: 5, shopSuppliesCap: 35, travelFee: 45 }, notes: { customerNotes: 'Sentinel note text', termsAndConditions: 'Sentinel terms text' } });
  inv = addLaborItem(inv, { id: 'l1', description: 'Sentinel labor line', technician: 'Tech', hours: 1.5, rate: 55 });
  inv = addPartItem(inv, { id: 'p1', partNumber: 'SENT-1', description: 'Sentinel part', quantity: 2, unitPrice: 12.5 });
  return inv;
};
let invId = '';

await t('create, list, read back: decrypted, normalized, and marked editable for the owner', async () => {
  const r = await page('POST', `/api/jobs/${job}/invoices`, { invoice: sample() });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  invId = r.json.id;
  assert.deepEqual([r.json.job_id, r.json.rev, r.json.can_edit], [job, 1, true]);
  assert.equal(r.json.invoice.customer.name, 'Sentinel Customer Zed'); assert.equal(r.json.invoice.meta.docType, 'estimate'); assert.equal(r.json.invoice.laborItems[0].id, 'l1');
  const all = (await page('GET', '/api/invoices')).json; const byJob = (await page('GET', `/api/jobs/${job}/invoices`)).json;
  assert.deepEqual([all.length, byJob.length, (await page('GET', `/api/jobs/${job2}/invoices`)).json.length], [1, 1, 0]);
});

await t('update bumps the revision; a stale expected_rev is rejected with 409 and nothing is overwritten', async () => {
  const cur = (await page('GET', '/api/invoices')).json[0];
  const up = await page('PUT', `/api/invoices/${invId}`, { invoice: { ...cur.invoice, notes: { ...cur.invoice.notes, customerNotes: 'Edited note' } }, expected_rev: 1 });
  assert.equal(up.status, 200); assert.equal(up.json.rev, 2); assert.equal(up.json.invoice.notes.customerNotes, 'Edited note');
  const stale = await page('PUT', `/api/invoices/${invId}`, { invoice: { ...cur.invoice, notes: { ...cur.invoice.notes, customerNotes: 'Lost update' } }, expected_rev: 1 });
  assert.equal(stale.status, 409);
  assert.equal((await page('GET', '/api/invoices')).json[0].invoice.notes.customerNotes, 'Edited note');
  assert.equal((await page('PUT', `/api/invoices/${invId}`, { invoice: up.json.invoice })).json.rev, 3, 'omitting expected_rev uses the current revision');
});

await t('a second device creating the same deterministic id gets the existing record, not a duplicate', async () => {
  const id = await (await import('../src/e2ee/store.ts')).deterministicUuid(`estimate|${job2}`);
  const a = await page('POST', `/api/jobs/${job2}/invoices`, { id, invoice: sample() });
  const b = await page('POST', `/api/jobs/${job2}/invoices`, { id, invoice: createEmptyInvoice({ meta: { invoiceNumber: 'SECOND' } }) });
  assert.deepEqual([a.status, b.status, b.json.id], [200, 200, id]);
  assert.equal(b.json.invoice.meta.invoiceNumber, 'TST-A00001', 'the first write wins; the second was not applied');
  assert.equal((await page('GET', `/api/jobs/${job2}/invoices`)).json.length, 1);
  assert.equal((await page('DELETE', `/api/invoices/${id}`)).status, 200);
});

await t('input validation: missing body, oversized invoices and hostile JSON are handled', async () => {
  assert.equal((await page('POST', `/api/jobs/${job}/invoices`, {})).status, 400);
  const big = createEmptyInvoice({ laborItems: Array.from({ length: 500 }, (_, i) => ({ id: `x${i}`, description: 'd'.repeat(1000), technician: 't'.repeat(200), hours: 1, rate: 1 })) });
  const r = await page('POST', `/api/jobs/${job}/invoices`, { invoice: big });
  assert.equal(r.status, 400); assert.match(r.json.error, /too large/);
  const hostile = await page('POST', `/api/jobs/${job}/invoices`, { invoice: { meta: { status: 'Hacked' }, laborItems: [{ hours: 1e99, rate: 'x' }], surprise: 1 } });
  assert.equal(hostile.status, 200); assert.equal(hostile.json.invoice.meta.status, 'Draft'); assert.ok(!('surprise' in hostile.json.invoice));
  assert.equal((await page('DELETE', `/api/invoices/${hostile.json.id}`)).status, 200);
});

await t('the database holds no invoice plaintext (sentinels never appear in the file or WAL)', async () => {
  const db = new Database(`${DATA_DIR}/data.db`); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();
  const raw = fs.readFileSync(`${DATA_DIR}/data.db`);
  for (const needle of ['Sentinel Customer Zed', 'Sentinel Shop Name', 'Sentinel labor line', 'SENT-1', 'Sentinel note text', 'Sentinel terms text', 'sentinel@example.com', 'Edited note', 'TST-A00001'])
    assert.ok(!raw.includes(Buffer.from(needle)), `plaintext "${needle}" found in the database`);
});

await t('sharing: after approval a member reads the invoice (read-only); the server rejects every member write', async () => {
  const inv = await page('POST', `/api/jobs/${job}/invites`);
  as(member); assert.equal((await page('POST', '/api/jobs/join', { token: inv.json.token })).status, 200);
  assert.equal((await page('GET', '/api/invoices')).json.length, 0, 'a pending member sees nothing');
  as(owner); const need = await listMembersNeedingKey(job); await approveMember(job, need[0], need[0].fingerprint);
  as(member);
  const list = (await page('GET', '/api/invoices')).json;
  assert.equal(list.length, 1); assert.equal(list[0].invoice.customer.name, 'Sentinel Customer Zed'); assert.equal(list[0].can_edit, false);
  assert.equal((await page('PUT', `/api/invoices/${invId}`, { invoice: list[0].invoice })).status, 403, 'member update');
  assert.equal((await page('POST', `/api/jobs/${job}/invoices`, { invoice: sample() })).status, 403, 'member create');
  assert.equal((await page('DELETE', `/api/invoices/${invId}`)).status, 403, 'member delete');
  assert.equal((await page('GET', '/api/invoices')).json.length, 1, 'nothing changed');
});

await t('non-members get 404 (existence is hidden) on every route, including direct server calls', async () => {
  as(outsider);
  assert.equal((await page('GET', '/api/invoices')).json.length, 0);
  assert.equal((await page('GET', `/api/jobs/${job}/invoices`)).json.length, 0);
  const token = getSession().token;
  const any = (await call('GET', '/api/v2/invoices', { token })).json; assert.deepEqual(any, []);
  assert.equal((await call('GET', `/api/v2/jobs/${job}/invoices`, { token })).status, 404);
  assert.equal((await call('POST', `/api/v2/jobs/${job}/invoices`, { token, body: { id: crypto.randomUUID(), enc: 'v2:AAAA' } })).status, 404);
  assert.equal((await call('PUT', `/api/v2/invoices/${invId}`, { token, body: { enc: 'v2:AAAA' } })).status, 404);
  assert.equal((await call('DELETE', `/api/v2/invoices/${invId}`, { token })).status, 404);
  assert.equal((await call('PUT', `/api/v2/invoices/not-a-uuid`, { token, body: { enc: 'v2:AAAA' } })).status, 404);
});

await t('API keys cannot reach invoices at all', async () => {
  as(owner);
  const k = await page('POST', '/api/keys', { name: 'cal' });
  for (const [m, p] of [['GET', '/api/v2/invoices'], ['GET', `/api/v2/jobs/${job}/invoices`]] as const) assert.equal((await call(m, p, { apiKey: k.json.headerKey })).status, 403, p);
});

await t('ciphertext is bound to its record: moving an envelope to another invoice makes it unreadable', async () => {
  as(owner);
  const second = (await page('POST', `/api/jobs/${job}/invoices`, { invoice: sample() })).json;
  const token = getSession().token;
  const rows = (await call('GET', '/api/v2/invoices', { token })).json as any[];
  const encOf = (id: string) => rows.find(r => r.id === id).enc;
  assert.equal((await call('PUT', `/api/v2/invoices/${second.id}`, { token, body: { enc: encOf(invId) } })).status, 200);
  setSession({ ...owner.session }); // drop caches
  const ids = (await page('GET', '/api/invoices')).json.map((r: any) => r.id);
  assert.ok(ids.includes(invId) && !ids.includes(second.id), 'the swapped record fails authentication and is skipped');
  assert.equal((await page('DELETE', `/api/invoices/${second.id}`)).status, 200);
});

await t('round trip: a saved invoice reloads (new session) to identical PDF bytes', async () => {
  as(owner);
  const before = sample();
  const saved = (await page('POST', `/api/jobs/${job2}/invoices`, { invoice: before })).json;
  setSession({ ...owner.session });
  const back = (await page('GET', `/api/jobs/${job2}/invoices`)).json.find((r: any) => r.id === saved.id).invoice;
  const hash = (i: any) => Buffer.from(generateSheetPdf(buildSheetModel(i, calculateTotals(i)), { generatedAt: 'x' })).toString('base64');
  assert.equal(hash(back), hash(before));
});

await t('job deletion cascades: the invoices go with it and the delete succeeds (explicit cascade, no FK failure)', async () => {
  as(owner);
  assert.ok((await page('GET', `/api/jobs/${job2}/invoices`)).json.length >= 1);
  assert.equal((await page('DELETE', `/api/jobs/${job2}`)).status, 200);
  const db = new Database(`${DATA_DIR}/data.db`, { readonly: true });
  assert.equal((db.prepare('SELECT COUNT(*) c FROM invoices WHERE job_id = ?').get(job2) as any).c, 0);
  db.close();
  as(member); assert.equal((await page('GET', '/api/invoices')).json.length, 1, 'other jobs are untouched');
});

await t('removing a member immediately removes their read access to invoices', async () => {
  as(owner);
  const mem = (await page('GET', `/api/jobs/${job}/members`)).json.find((x: any) => x.username === 'invmember');
  assert.equal((await page('DELETE', `/api/jobs/${job}/members/${mem.id}`)).status, 200);
  as(member); assert.equal((await page('GET', '/api/invoices')).json.length, 0);
});

console.log(`${passed} invoice e2ee checks passed`);
