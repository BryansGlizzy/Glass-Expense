import './shim.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { call } from './helpers.ts';
import { installE2eeRouter } from '../src/e2ee/router.ts';
import { register } from '../src/e2ee/auth.ts';
import { getSession, invalidate, ensureJobKeys } from '../src/e2ee/session.ts';
import { syncAgentBundles } from '../src/e2ee/agent.ts';
import * as C from '../src/e2ee/crypto.ts';

const DATA_DIR = process.env.DATA_DIR!;
let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } };
const page = async (method: string, path: string, body?: any) => {
  const init: any = { method, headers: { Authorization: `Bearer ${getSession().token}` } };
  if (body instanceof FormData) init.body = body; else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(path, init); return { status: res.status, json: await res.json().catch(() => null) };
};
const agent = (key: string, method: string, path: string, body?: any) => call(method, `/api/agent/v1${path}`, { apiKey: key, body });
const today = new Date().toISOString().slice(0, 10);

installE2eeRouter();
await register({ username: 'agentowner', email: 'agentowner@example.com', password: 'correct horse battery staple', mnemonic: C.generateMnemonic() });
{ const w = new Database(`${DATA_DIR}/data.db`); w.prepare("UPDATE users SET plan='pro' WHERE username='agentowner'").run(); w.close(); }
const alpha = (await page('POST', '/api/jobs', { title: 'Alpha Kitchen Remodel', client_name: 'Zed Customer' })).json.id;
const beta = (await page('POST', '/api/jobs', { title: 'Beta Secret Project' })).json.id;
{ const f = new FormData(); f.append('amount', '300'); f.append('description', 'Existing deposit'); f.append('entry_type', 'income'); f.append('date', '2026-01-05');
  assert.equal((await page('POST', `/api/jobs/${alpha}/expenses`, f)).status, 200); }

const makeKey = async (name: string, agentOpts?: any) => {
  const r = await page('POST', '/api/keys', { name, ...(agentOpts ? { agent: agentOpts } : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return { id: r.json.key.id as string, header: r.json.headerKey as string, full: r.json.rawKey as string };
};

const plain = await makeKey('calendar only');
const readKey = await makeKey('reader', { access: 'read', all_jobs: false, job_ids: [alpha] });

await t('a calendar-only key (no opt-in) is refused by the agent API', async () => {
  const r = await agent(plain.header, 'GET', '/jobs');
  assert.equal(r.status, 403); assert.match(r.json.error, /agent access/i);
});
await t('sessions and missing keys cannot use the agent API', async () => {
  assert.equal((await call('GET', '/api/agent/v1/jobs', { token: getSession().token })).status, 403);
  assert.equal((await call('GET', '/api/agent/v1/jobs')).status, 401);
});
await t('selected-jobs read key: sees only the chosen job, decrypted, with totals', async () => {
  const me = await agent(readKey.header, 'GET', '/me');
  assert.deepEqual([me.json.access, me.json.all_jobs, me.json.job_count], ['read', false, 1]);
  const jobs = await agent(readKey.header, 'GET', '/jobs');
  assert.equal(jobs.json.length, 1);
  assert.equal(jobs.json[0].title, 'Alpha Kitchen Remodel'); assert.equal(jobs.json[0].client_name, 'Zed Customer');
  assert.equal(jobs.json[0].total_income, 300); assert.equal(jobs.json[0].net, 300);
  assert.equal((await agent(readKey.header, 'GET', `/jobs/${beta}`)).status, 404, 'unselected job is invisible');
  assert.equal((await agent(readKey.header, 'GET', `/jobs/${beta}/expenses`)).status, 404);
  const ex = await agent(readKey.header, 'GET', `/jobs/${alpha}/expenses?type=income&from=2026-01-01`);
  assert.equal(ex.json.total, 1); assert.equal(ex.json.items[0].description, 'Existing deposit');
});
await t('read-only keys cannot write', async () => {
  assert.equal((await agent(readKey.header, 'POST', `/jobs/${alpha}/expenses`, { amount: 5 })).status, 403);
  assert.equal((await agent(readKey.header, 'POST', '/jobs', { title: 'nope' })).status, 403);
});
await t('the full key (with the private half) is refused; keys never expose bundle data', async () => {
  assert.equal((await agent(readKey.full, 'GET', '/jobs')).status, 400);
  const list = await page('GET', '/api/keys');
  const row = list.json.find((k: any) => k.id === readKey.id);
  assert.equal(row.agent_access, 'read'); assert.equal(row.agent_all_jobs, false);
  assert.ok(!JSON.stringify(list.json).includes('bundle'));
});

const writeKey = await makeKey('writer', { access: 'write', all_jobs: true });
let agentJob = '';
await t('write key adds entries (validated, idempotent) that the browser can read', async () => {
  const id = crypto.randomUUID();
  const r = await agent(writeKey.header, 'POST', `/jobs/${alpha}/expenses`, { id, amount: 12.5, description: 'Lumber from agent', entry_type: 'expense', date: '2026-03-04' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(r.json.amount, 12.5);
  const again = await agent(writeKey.header, 'POST', `/jobs/${alpha}/expenses`, { id, amount: 12.5, description: 'Lumber from agent' });
  assert.equal(again.status, 200); assert.equal(again.json.duplicate, true);
  for (const bad of [{ amount: -1 }, { amount: 'abc' }, { amount: 5, entry_type: 'refund' }, { amount: 5, date: 'tomorrow' }, { amount: 5, id: 'nope' }])
    assert.equal((await agent(writeKey.header, 'POST', `/jobs/${alpha}/expenses`, bad)).status, 400, JSON.stringify(bad));
  const batch = await agent(writeKey.header, 'POST', `/jobs/${alpha}/expenses`, { items: [{ amount: 1, description: 'a' }, { amount: 2, description: 'b', entry_type: 'income' }] });
  assert.equal(batch.json.created.length, 2);
  assert.equal(batch.json.created[0].date, today, 'date defaults to today');
  invalidate('');
  const mine = await page('GET', `/api/jobs/${alpha}/expenses`);
  const found = mine.json.find((e: any) => e.description === 'Lumber from agent');
  assert.ok(found && found.amount === 12.5 && found.date === '2026-03-04', 'browser decrypts what the agent wrote');
  assert.equal((await agent(writeKey.header, 'POST', `/jobs/${beta}/expenses`, { amount: 3 })).status, 201, 'an all-jobs key covers every job that existed when it was created');
});
await t('write key creates a job; the browser adopts its key and re-seals it under the master key', async () => {
  const r = await agent(writeKey.header, 'POST', '/jobs', { title: 'Agent Made Job', client_name: 'Robo Client', start_date: '2026-06-01', end_date: '2026-06-03', invoice_tag: 'bots' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  agentJob = r.json.id;
  assert.equal(r.json.title, 'Agent Made Job'); assert.equal(r.json.invoice_tag, 'BOTS'); assert.equal(r.json.invoice_number, 'BOTS-A00001');
  assert.equal((await agent(writeKey.header, 'POST', `/jobs/${agentJob}/expenses`, { amount: 40, description: 'first line' })).status, 201);

  invalidate(''); await ensureJobKeys(true);
  const jobs = (await page('GET', '/api/jobs')).json;
  const mine = jobs.find((j: any) => j.id === agentJob);
  assert.ok(mine && !mine.locked, 'owner can open the agent-created job');
  assert.equal(mine.title, 'Agent Made Job'); assert.equal(mine.total_expenses, 40);
  const db = new Database(`${DATA_DIR}/data.db`, { readonly: true });
  assert.equal((db.prepare('SELECT wrapped_by FROM job_keys WHERE job_id = ?').get(agentJob) as any).wrapped_by, null, 'key now sealed under the owner master key');
  assert.ok(db.prepare('SELECT 1 FROM job_calendar_labels WHERE job_id = ?').get(agentJob), 'calendar label created');
  db.close();
  const sched = await call('GET', '/api/calendar/schedule', { apiKey: plain.header });
  assert.equal(sched.json.jobs.find((j: any) => j.id === agentJob)?.start_date, '2026-06-01');
  assert.equal((await agent(readKey.header, 'GET', `/jobs/${agentJob}`)).status, 404, 'a selected-jobs key does not see jobs created by other keys');
});
await t('write key appends to a description (never overwrites), idempotently; the browser sees it', async () => {
  const first = await agent(writeKey.header, 'POST', '/jobs', { title: 'Research Target', description: 'Customer: Pat\nVehicle: 2015 Ford F-150' });
  assert.equal(first.status, 201); const id = first.json.id;
  const r = await agent(writeKey.header, 'POST', `/jobs/${id}/description`, { append: '### Research\nTorque spec: 148 ft-lb' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(r.json.duplicate, false);
  assert.equal(r.json.description, 'Customer: Pat\nVehicle: 2015 Ford F-150\n\n### Research\nTorque spec: 148 ft-lb', 'original text kept, addition after it');
  const again = await agent(writeKey.header, 'POST', `/jobs/${id}/description`, { append: '### Research\nTorque spec: 148 ft-lb' });
  assert.equal(again.status, 200); assert.equal(again.json.duplicate, true);
  assert.equal((await agent(writeKey.header, 'GET', `/jobs/${id}`)).json.description, r.json.description, 'a retry does not append twice');
  const second = await agent(writeKey.header, 'POST', `/jobs/${id}/description`, { append: 'Second finding' });
  assert.ok(second.json.description.endsWith('Torque spec: 148 ft-lb\n\nSecond finding'));
  assert.equal(second.json.title, 'Research Target'); assert.equal(second.json.client_name, null, 'other fields untouched');
  invalidate(''); await ensureJobKeys(true);
  const mine = (await page('GET', '/api/jobs')).json.find((j: any) => j.id === id);
  assert.ok(mine && mine.description.includes('Second finding') && mine.description.startsWith('Customer: Pat'), 'owner decrypts the appended description');
});
await t('description append is write-only, validated and scoped to covered jobs', async () => {
  assert.equal((await agent(readKey.header, 'POST', `/jobs/${alpha}/description`, { append: 'x' })).status, 403, 'read-only key');
  assert.equal((await agent(writeKey.header, 'POST', `/jobs/${crypto.randomUUID()}/description`, { append: 'x' })).status, 404, 'unknown job');
  for (const bad of [{}, { append: '' }, { append: '   ' }, { append: 5 }, { append: 'x'.repeat(100_001) }, { description: 'replace' }])
    assert.equal((await agent(writeKey.header, 'POST', `/jobs/${alpha}/description`, bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  assert.equal((await agent(plain.header, 'POST', `/jobs/${alpha}/description`, { append: 'x' })).status, 403, 'calendar-only key');
  assert.equal((await agent(writeKey.header, 'PATCH', `/jobs/${alpha}`, { description: 'x' })).status, 404, 'no general edit route exists');
});
await t('an "all jobs" key is topped up when the browser later creates a job; a selected-jobs key is not', async () => {
  const later = (await page('POST', '/api/jobs', { title: 'Created Later In Browser' })).json.id;
  await syncAgentBundles();
  assert.equal((await agent(writeKey.header, 'GET', `/jobs/${later}`)).status, 200);
  assert.equal((await agent(readKey.header, 'GET', `/jobs/${later}`)).status, 404);
  assert.equal((await page('PUT', `/api/keys/${readKey.id}/agent-bundle`, {})).status, 409);
});
// ── Characterization tests ───────────────────────────────────────────────────────────────────────────────────────
// These pin down what the agent routes do TODAY (response shapes, validation, numbering, limits) so that the planned
// extraction of server/agent-core.ts (docs/INVOICING_PLAN.md K13) can be proven behaviour-preserving. When a later phase
// intentionally changes one of them (e.g. P5 adds client_phone/intake), update the test in the same change.

// client_phone and intake were added by Invoicing 2.0 (P5).
const JOB_VIEW_KEYS = ['client_address', 'client_email', 'client_name', 'client_phone', 'created_at', 'description', 'end_date', 'entry_count', 'id', 'intake', 'invoice_notes', 'invoice_number', 'invoice_tag',
  'is_archived', 'job_rate', 'mode', 'net', 'owner', 'role', 'start_date', 'title', 'total_expenses', 'total_income', 'updated_at'];

await t('characterization: /me and the job view have a stable shape', async () => {
  const me = await agent(writeKey.header, 'GET', '/me');
  assert.deepEqual(me.json, { access: 'write', all_jobs: true, job_count: me.json.job_count, user: 'agentowner' });
  assert.ok(me.json.job_count >= 3);
  const one = await agent(writeKey.header, 'GET', `/jobs/${alpha}`);
  assert.deepEqual(Object.keys(one.json).sort(), JOB_VIEW_KEYS, 'GET /jobs/:id fields');
  assert.deepEqual(Object.keys((await agent(writeKey.header, 'GET', '/jobs')).json[0]).sort(), JOB_VIEW_KEYS, 'GET /jobs fields');
  assert.equal(one.json.role, 'owner'); assert.equal(one.json.owner, 'agentowner'); assert.equal(one.json.mode, 'expense'); assert.equal(one.json.is_archived, false);
  assert.equal(typeof one.json.total_income, 'number'); assert.equal(one.json.net, one.json.total_income - one.json.total_expenses);
});

await t('characterization: job creation validates its input and applies defaults', async () => {
  for (const bad of [{}, { title: '' }, { title: '   ' }, { title: 5 }, { title: 'x'.repeat(201) }, { title: 'ok', mode: 'invoice' }, { title: 'ok', job_rate: -1 }, { title: 'ok', job_rate: 'abc' },
    { title: 'ok', job_rate: 1e12 }, { title: 'ok', start_date: 'soon' }, { title: 'ok', end_date: '2026-13-45' }, { title: 'ok', client_email: 'x'.repeat(300) }, { title: 'ok', description: 'x'.repeat(100_001) }])
    assert.equal((await agent(writeKey.header, 'POST', '/jobs', bad)).status, 400, JSON.stringify(bad).slice(0, 70));
  const r = await agent(writeKey.header, 'POST', '/jobs', { title: 'Characterization Defaults' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual([r.json.mode, r.json.job_rate, r.json.client_name, r.json.description, r.json.invoice_notes, r.json.start_date, r.json.end_date, r.json.is_archived, r.json.entry_count], ['expense', 0, null, null, null, null, null, false, 0]);
  const full = await agent(writeKey.header, 'POST', '/jobs', { title: 'Characterization Full', mode: 'budget', job_rate: '55.5', client_name: 'Chara Client', client_email: 'chara@example.com', client_address: '1 Test Way', invoice_notes: 'Net 30', description: 'Body text', start_date: '2026-07-01', end_date: '2026-07-02' });
  assert.equal(full.status, 201, JSON.stringify(full.json));
  assert.deepEqual([full.json.mode, full.json.job_rate, full.json.client_email, full.json.client_address, full.json.invoice_notes, full.json.description, full.json.start_date, full.json.end_date],
    ['budget', 55.5, 'chara@example.com', '1 Test Way', 'Net 30', 'Body text', '2026-07-01', '2026-07-02']);
  assert.equal((await agent(readKey.header, 'POST', '/jobs', { title: 'nope' })).status, 403, 'read-only key');
});

await t('characterization: an all-jobs key numbers jobs per tag (rolling A00001…); tags are sanitized and upper-cased', async () => {
  const a = await agent(writeKey.header, 'POST', '/jobs', { title: 'Num A', invoice_tag: 'chara' });
  const b = await agent(writeKey.header, 'POST', '/jobs', { title: 'Num B', invoice_tag: 'chara' });
  const c = await agent(writeKey.header, 'POST', '/jobs', { title: 'Num C', invoice_tag: ' ch ara!! ' });
  const other = await agent(writeKey.header, 'POST', '/jobs', { title: 'Num D', invoice_tag: 'zeta' });
  assert.deepEqual([a.json.invoice_number, b.json.invoice_number, c.json.invoice_number, other.json.invoice_number], ['CHARA-A00001', 'CHARA-A00002', 'CHARA-A00003', 'ZETA-A00001']);
  assert.deepEqual([a.json.invoice_tag, c.json.invoice_tag], ['CHARA', 'CHARA']);
  const plainJob = await agent(writeKey.header, 'POST', '/jobs', { title: 'Num untagged' });
  assert.match(plainJob.json.invoice_number, /^[A-Z0-9_-]+-A\d{5}$/); assert.equal(plainJob.json.invoice_tag, null);
  const numbers = (await agent(writeKey.header, 'GET', '/jobs')).json.map((j: any) => j.invoice_number).filter(Boolean);
  assert.equal(new Set(numbers).size, numbers.length, 'no two jobs share an invoice number');
});

await t('characterization (plan W9): a selected-jobs key creates the job WITHOUT an invoice number, then keeps using it; other keys do not see it', async () => {
  const selected = await makeKey('selected writer', { access: 'write', all_jobs: false, job_ids: [alpha] });
  const r = await agent(selected.header, 'POST', '/jobs', { title: 'Selected Key Job', invoice_tag: 'sel' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.invoice_number, null, 'only all-jobs keys can allocate a number');
  assert.equal(r.json.invoice_tag, 'SEL');
  assert.equal((await agent(selected.header, 'GET', `/jobs/${r.json.id}`)).status, 200, 'the creating key can keep using the job');
  assert.equal((await agent(selected.header, 'POST', `/jobs/${r.json.id}/expenses`, { amount: 9 })).status, 201);
  assert.equal((await agent(writeKey.header, 'GET', `/jobs/${r.json.id}`)).status, 404, 'a different key is not given the new job key');
  assert.equal((await page('DELETE', `/api/keys/${selected.id}`)).status, 200);
});

await t('characterization: description append respects the total size cap and only touches the description', async () => {
  const base = (await agent(writeKey.header, 'POST', '/jobs', { title: 'Cap Test', description: 'a'.repeat(99_990), client_name: 'Cap Client' })).json;
  const over = await agent(writeKey.header, 'POST', `/jobs/${base.id}/description`, { append: 'b'.repeat(20) });
  assert.equal(over.status, 400); assert.match(over.json.error, /exceed/);
  const fits = await agent(writeKey.header, 'POST', `/jobs/${base.id}/description`, { append: 'c' });
  assert.equal(fits.status, 201); assert.equal(fits.json.description.length, 99_990 + 2 + 1);
  assert.deepEqual([fits.json.title, fits.json.client_name, fits.json.invoice_number, fits.json.start_date], [base.title, 'Cap Client', base.invoice_number, null]);
  assert.equal((await agent(writeKey.header, 'POST', `/jobs/${base.id}/description`, { append: '  padded  ' })).status, 400, 'would exceed again');
  const small = (await agent(writeKey.header, 'POST', '/jobs', { title: 'Trim Test' })).json;
  const trimmed = await agent(writeKey.header, 'POST', `/jobs/${small.id}/description`, { append: '  padded text  ' });
  assert.equal(trimmed.json.description, 'padded text', 'surrounding whitespace is trimmed; an empty description is replaced, not prefixed');
});

await t('characterization: expense listing filters, sorts and paginates; creation shapes and batch limits', async () => {
  const job = (await agent(writeKey.header, 'POST', '/jobs', { title: 'Listing Job' })).json.id;
  const rows = [['2026-01-01', 'expense', 10], ['2026-01-02', 'income', 20], ['2026-01-03', 'expense', 30], ['2026-01-04', 'expense', 40], ['2026-01-05', 'income', 50]];
  const created = await agent(writeKey.header, 'POST', `/jobs/${job}/expenses`, { items: rows.map(([date, entry_type, amount]) => ({ date, entry_type, amount, description: `row ${date}` })) });
  assert.equal(created.status, 201); assert.deepEqual(Object.keys(created.json).sort(), ['created', 'duplicates']); assert.equal(created.json.created.length, 5);
  assert.deepEqual(Object.keys(created.json.created[0]).sort(), ['amount', 'date', 'description', 'entry_type', 'id', 'job_id']);
  const all = (await agent(writeKey.header, 'GET', `/jobs/${job}/expenses`)).json;
  assert.deepEqual(Object.keys(all).sort(), ['items', 'limit', 'offset', 'total']); assert.deepEqual([all.total, all.limit, all.offset], [5, 200, 0]);
  assert.deepEqual(all.items.map((e: any) => e.date), ['2026-01-05', '2026-01-04', '2026-01-03', '2026-01-02', '2026-01-01'], 'newest first');
  assert.deepEqual(Object.keys(all.items[0]).sort(), ['added_by', 'amount', 'created_at', 'date', 'description', 'entry_type', 'has_receipt', 'id', 'job_id']);
  const q = async (qs: string) => (await agent(writeKey.header, 'GET', `/jobs/${job}/expenses?${qs}`)).json;
  assert.equal((await q('type=income')).total, 2); assert.equal((await q('type=expense')).total, 3);
  assert.deepEqual((await q('from=2026-01-02&to=2026-01-04')).items.map((e: any) => e.date), ['2026-01-04', '2026-01-03', '2026-01-02'], 'from/to are inclusive');
  const p2 = await q('limit=2&offset=2'); assert.deepEqual([p2.total, p2.items.length, p2.items[0].date], [5, 2, '2026-01-03']);
  assert.equal((await q('limit=99999')).limit, 1000, 'limit is clamped to 1000'); assert.equal((await q('limit=0')).limit, 200, 'a zero or invalid limit falls back to 200');
  for (const bad of ['type=refund', 'from=yesterday', 'to=2026-99-99']) assert.equal((await agent(writeKey.header, 'GET', `/jobs/${job}/expenses?${bad}`)).status, 400, bad);
  const total = (await agent(writeKey.header, 'GET', `/jobs/${job}`)).json;
  assert.deepEqual([total.total_income, total.total_expenses, total.net, total.entry_count], [70, 80, -10, 5]);
  assert.equal((await agent(writeKey.header, 'POST', `/jobs/${job}/expenses`, { items: [] })).status, 400, 'empty batch');
  assert.equal((await agent(writeKey.header, 'POST', `/jobs/${job}/expenses`, { items: Array.from({ length: 101 }, () => ({ amount: 1 })) })).status, 400, 'batch over 100');
  assert.equal((await agent(writeKey.header, 'POST', `/jobs/${job}/expenses`, { items: Array.from({ length: 100 }, () => ({ amount: 1 })) })).status, 201, 'batch of exactly 100');
  const id = crypto.randomUUID();
  const mixed = await agent(writeKey.header, 'POST', `/jobs/${job}/expenses`, { items: [{ id, amount: 2 }, { id, amount: 2 }] });
  assert.equal(mixed.status, 201); assert.deepEqual([mixed.json.created.length, mixed.json.duplicates], [1, [id]], 'the same id twice in one batch is created once');
  const single = await agent(writeKey.header, 'POST', `/jobs/${job}/expenses`, { amount: '7.255', description: 'rounds', entry_type: 'income' });
  assert.equal(single.status, 201); assert.deepEqual([single.json.amount, single.json.entry_type, single.json.date], [7.26, 'income', today]);
  assert.equal((await agent(writeKey.header, 'POST', `/jobs/${crypto.randomUUID()}/expenses`, { amount: 1 })).status, 404);
  assert.equal((await agent(writeKey.header, 'POST', `/jobs/${job}/expenses`, { amount: 5, description: 'x'.repeat(1001) })).status, 400, 'description cap');
});

await t('the database holds no plaintext of anything agents read or wrote', async () => {
  const db = new Database(`${DATA_DIR}/data.db`); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();
  const raw = fs.readFileSync(`${DATA_DIR}/data.db`);
  for (const needle of ['Agent Made Job', 'Lumber from agent', 'Robo Client', 'Zed Customer', 'Alpha Kitchen Remodel', 'Torque spec: 148', 'Second finding',
    'Characterization Full', 'Chara Client', 'chara@example.com', '1 Test Way', 'Selected Key Job', 'Listing Job', 'row 2026-01-03'])
    assert.ok(!raw.includes(Buffer.from(needle)), `plaintext "${needle}" found in database file`);
});
await t('removing agent access and revoking keys takes effect immediately', async () => {
  assert.equal((await page('DELETE', `/api/keys/${readKey.id}/agent`)).status, 200);
  assert.equal((await agent(readKey.header, 'GET', '/jobs')).status, 403);
  const db = new Database(`${DATA_DIR}/data.db`, { readonly: true });
  assert.equal((db.prepare('SELECT agent_bundle FROM api_keys WHERE id = ?').get(readKey.id) as any).agent_bundle, null);
  db.close();
  assert.equal((await page('DELETE', `/api/keys/${writeKey.id}`)).status, 200);
  assert.equal((await agent(writeKey.header, 'GET', '/jobs')).status, 401);
});

console.log(`${passed} agent checks passed`);
