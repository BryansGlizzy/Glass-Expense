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
await t('the database holds no plaintext of anything agents read or wrote', async () => {
  const db = new Database(`${DATA_DIR}/data.db`); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();
  const raw = fs.readFileSync(`${DATA_DIR}/data.db`);
  for (const needle of ['Agent Made Job', 'Lumber from agent', 'Robo Client', 'Zed Customer', 'Alpha Kitchen Remodel', 'Torque spec: 148', 'Second finding'])
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
