import './shim.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { BASE, call } from './helpers.ts';
import { installE2eeRouter } from '../src/e2ee/router.ts';
import { register } from '../src/e2ee/auth.ts';
import * as C from '../src/e2ee/crypto.ts';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.DATA_DIR!;
let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } };
const page = async (method: string, path: string, body?: any) => {
  const init: any = { method, headers: {} };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(path, init); return { status: res.status, json: await res.json().catch(() => null) };
};

installE2eeRouter();
await register({ username: 'caller1', email: 'caller1@example.com', password: 'correct horse battery staple', mnemonic: C.generateMnemonic() });
const w = new Database(`${DATA_DIR}/data.db`); w.prepare("UPDATE users SET plan='pro' WHERE username='caller1'").run(); w.close();
await page('POST', '/api/jobs', { title: 'Kitchen – Smith & Sons “Phase 1” ✓', start_date: '2026-12-01', end_date: '2026-12-03' });
await page('POST', '/api/jobs', { title: 'Garage', start_date: '2026-12-10' });
const key = (await page('POST', '/api/keys', { name: 'doc example' })).json.rawKey as string;

const expected = ['Kitchen – Smith & Sons “Phase 1” ✓', 'Garage'];
const env = { ...process.env, GLASSEXPENSE_URL: BASE, GLASSEXPENSE_API_KEY: key };

await t('docs/examples/decrypt-calendar.mjs (Node.js) prints the decrypted titles', async () => {
  const out = JSON.parse(execFileSync('node', ['docs/examples/decrypt-calendar.mjs'], { env, encoding: 'utf8' }));
  assert.deepEqual(out.map((j: any) => j.title).sort(), [...expected].sort());
  assert.equal(out.find((j: any) => j.title === 'Garage').start_date, '2026-12-10');
});

await t('docs/examples/decrypt-calendar.browser.js (Web Crypto) produces the same result', async () => {
  const { fetchSchedule } = await import('../docs/examples/decrypt-calendar.browser.js');
  const jobs = await fetchSchedule(BASE, key);
  assert.deepEqual(jobs.map((j: any) => j.title).sort(), [...expected].sort());
});

const py = spawnSync('python3', ['-c', 'import cryptography, requests']);
if (py.status === 0) {
  await t('docs/examples/decrypt_calendar.py (Python) produces the same result', async () => {
    const out = JSON.parse(execFileSync('python3', ['docs/examples/decrypt_calendar.py'], { env, encoding: 'utf8' }));
    assert.deepEqual(out.map((j: any) => j.title).sort(), [...expected].sort());
  });
} else console.log('SKIP  Python example (pip install cryptography requests to run it)');

await t('sending the full key (with the private half) is refused, and the header-only key still works', async () => {
  assert.equal((await call('GET', '/api/calendar/schedule', { apiKey: key })).status, 400);
  assert.equal((await call('GET', '/api/calendar/schedule', { apiKey: key.split('.')[0] })).status, 200);
});

await t('documented test vector decrypts with the reference implementation', async () => {
  const fs = await import('node:fs');
  const v = JSON.parse(fs.readFileSync('docs/examples/test-vector.json', 'utf8'));
  const cal = await C.unwrapCalendarKeyWithApiKey(v.wrapped_calendar_key, v.decrypt_part);
  assert.equal(C.toHex(cal), v.calendar_key_hex);
  assert.equal(await C.decryptCalendarTitle(cal, v.job_id, v.title_envelope), v.title);
});

console.log(`\n${passed} example tests passed`);
process.exit(process.exitCode || 0);
