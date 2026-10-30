import './shim.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { call } from './helpers.ts';
import { installE2eeRouter } from '../src/e2ee/router.ts';
import { register } from '../src/e2ee/auth.ts';
import { getSession, api } from '../src/e2ee/session.ts';
import { enableReportFigures, updateReportFigures, disableReportFigures, buildSnapshot } from '../src/e2ee/reportSnapshot.ts';
import { buildReport, type ReportSnapshot } from '../server/report.ts';
import * as C from '../src/e2ee/crypto.ts';

const DATA_DIR = process.env.DATA_DIR!;
const MAIL_DIR = `${DATA_DIR}/mail`;
let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 4).join('\n       ')); process.exitCode = 1; } };
const page = async (method: string, path: string, body?: any) => {
  const init: any = { method, headers: { Authorization: `Bearer ${getSession().token}` } }; // pages send this themselves for server-handled routes
  if (body instanceof FormData) init.body = body; else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(path, init); return { status: res.status, json: await res.json().catch(() => null) };
};
const latestMail = () => {
  const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).sort() : [];
  return files.length ? fs.readFileSync(`${MAIL_DIR}/${files[files.length - 1]}`, 'utf8') : '';
};
const mailCount = () => (fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).length : 0);
const day = (offset: number) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);

// ── 1. The math (pure) ───────────────────────────────────────────────────────────────────────────
await t('buildReport: totals, previous-period trend, winners, loss leaders, categories', async () => {
  const today = new Date('2026-11-10T12:00:00Z');
  const d = (n: number) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);
  const snap: ReportSnapshot = {
    v: 1, generated_at: today.toISOString(), include_job_names: true, include_category_names: true,
    jobs: ['Alpha', 'Beta', 'Gamma'], cats: ['Materials', 'Fuel'],
    rows: [
      [d(1), 0, 0, 0, 200, 2], [d(2), 0, -1, 1000, 0, 1],   // Alpha this week: +1000 -200  => +800
      [d(3), 1, 1, 100, 600, 3],                            // Beta this week: -500
      [d(9), 0, 0, 0, 100, 1], [d(10), 2, -1, 300, 0, 1],   // previous week: Alpha -100, Gamma +300
      [d(30), 1, 0, 9999, 0, 1],                            // outside both windows
    ],
  };
  const r = buildReport(snap, 7, today);
  assert.equal(r.windowEnd, '2026-11-10'); assert.equal(r.windowStart, '2026-11-04');
  assert.deepEqual(r.totals, { income: 1100, expense: 800, net: 300, entries: 6 });
  assert.deepEqual(r.previous, { income: 300, expense: 100, net: 200 });
  assert.deepEqual(r.winners.map(j => [j.name, j.net]), [['Alpha', 800]]);
  assert.deepEqual(r.lossLeaders.map(j => [j.name, j.net]), [['Beta', -500]]);
  assert.equal(r.jobs.find(j => j.name === 'Alpha')!.prevNet, -100);
  assert.deepEqual(r.categories.map(c => c.name), ['Fuel', 'Materials']);
  assert.equal(r.staleDays, 0);
  const monthly = buildReport(snap, 30, today);
  assert.equal(monthly.totals.income, 1100 + 300, 'a 30-day window includes last week too');
  assert.equal(buildReport({ ...snap, generated_at: new Date(today.getTime() - 5 * 86400000).toISOString() }, 7, today).staleDays, 5);
});

// ── 2. End to end ────────────────────────────────────────────────────────────────────────────────
installE2eeRouter();
await register({ username: 'reporter1', email: 'reporter1@example.com', password: 'correct horse battery staple', mnemonic: C.generateMnemonic() });
const money = async (jobId: string, amount: number, type: 'income' | 'expense', date: string, desc: string, tagId?: string) => {
  const f = new FormData(); f.append('amount', String(amount)); f.append('description', desc); f.append('entry_type', type); f.append('date', date);
  if (tagId) f.append('tags', JSON.stringify([tagId]));
  assert.equal((await page('POST', `/api/jobs/${jobId}/expenses`, f)).status, 200);
};
const tag = (await page('POST', '/api/tags', { name: 'Lumber', color: '#10b981' })).json.id;
const winner = (await page('POST', '/api/jobs', { title: 'Zebra Winner Co' })).json.id;
const loser = (await page('POST', '/api/jobs', { title: 'Quokka Loss Leader' })).json.id;
await money(winner, 1000, 'income', day(1), 'deposit');
await money(winner, 200, 'expense', day(2), 'boards', tag);
await money(loser, 100, 'income', day(3), 'small payment');
await money(loser, 600, 'expense', day(3), 'big spend', tag);
await money(winner, 400, 'expense', day(10), 'last week stuff');   // previous window

await t('without opting in, the e-mail is content-free: counts only, no names or amounts', async () => {
  const before = mailCount();
  const r = await page('POST', '/api/settings/reports/generate');
  assert.equal(r.status, 200); assert.equal(r.json.with_figures, false);
  assert.equal(mailCount(), before + 1);
  const mail = latestMail();
  assert.match(mail, /new entries|new entry/);
  for (const secret of ['Zebra', 'Quokka', 'Lumber', '$1,000', '$600', '800.00']) assert.ok(!mail.includes(secret), `leaked "${secret}"`);
});

await t('opting in uploads an encrypted summary; the database never contains names or amounts', async () => {
  await enableReportFigures({ include_job_names: true, include_category_names: true });
  const status = (await page('GET', '/api/settings/reports')).json;
  assert.equal(status.report_delegated, true); assert.ok(status.snapshot_updated_at);
  const db = new Database(`${DATA_DIR}/data.db`); db.pragma('wal_checkpoint(TRUNCATE)');
  const row = db.prepare("SELECT s.enc, u.server_report_key k FROM report_snapshots s JOIN users u ON u.id = s.user_id WHERE u.username = 'reporter1'").get() as any;
  db.close();
  assert.ok(row.enc.startsWith('v2.')); assert.ok(row.k && !row.k.includes('=') || row.k.length > 40, 'server key is sealed, not the raw key');
  const bytes = fs.readFileSync(`${DATA_DIR}/data.db`).toString('latin1');
  for (const secret of ['Zebra Winner', 'Quokka Loss', 'Lumber']) assert.ok(!bytes.includes(secret), `snapshot leaked "${secret}" into the database`);
});

await t('opted-in e-mail shows totals, trend, winners, loss leaders and categories', async () => {
  const r = await page('POST', '/api/settings/reports/generate');
  assert.equal(r.json.with_figures, true);
  const mail = latestMail();
  // this week: income 1100, expense 800 => net 300; previous week: expense 400 => net -400
  assert.match(mail, /\$1,100\.00/); assert.match(mail, /\$800\.00/); assert.match(mail, /\$300\.00/);
  assert.match(mail, /Zebra Winner Co/); assert.match(mail, /Quokka Loss Leader/);
  assert.match(mail, /\$800\.00[\s\S]*Loss leaders[\s\S]*-\$500\.00/);          // winner +800 (1000-200), loss leader -500 (100-600)
  assert.match(mail, /Lumber/); assert.match(mail, /vs previous period/);
  assert.ok(!mail.includes('deposit') && !mail.includes('big spend') && !mail.includes('boards'), 'individual entry descriptions are never included');
  assert.ok(mail.indexOf('Winners') < mail.indexOf('Loss leaders'));
});

await t('hiding names replaces them with generic labels (and refreshes the summary)', async () => {
  await updateReportFigures({ include_job_names: false, include_category_names: false });
  await page('POST', '/api/settings/reports/generate');
  const mail = latestMail();
  assert.ok(!mail.includes('Zebra') && !mail.includes('Quokka') && !mail.includes('Lumber'));
  assert.match(mail, /Job \d/);
});

await t('the summary follows data changes automatically (debounced refresh after a write)', async () => {
  await updateReportFigures({ include_job_names: true, include_category_names: true });
  await money(winner, 5000, 'income', day(0), 'big win');
  await new Promise(r => setTimeout(r, 4800));            // scheduleSnapshotRefresh() default debounce is 4s
  await page('POST', '/api/settings/reports/generate');
  assert.match(latestMail(), /\$6,100\.00/);               // 1100 + 5000 income
});

await t('another account cannot upload a summary without opting in, and cannot reuse this one', async () => {
  const other = await call('POST', '/api/auth/register', { body: { username: 'reporter2', email: 'reporter2@example.com', auth_key: 'a'.repeat(43), kdf_salt: C.newKdfSalt(), kdf_iterations: 1000,
    master_key_encrypted: 'x'.repeat(60), public_key: 'x'.repeat(120), private_key_encrypted: 'x'.repeat(120), calendar_key_encrypted: 'x'.repeat(60), key_check: 'x'.repeat(44) } });
  assert.equal(other.status, 200);
  const put = await call('PUT', '/api/settings/reports/snapshot', { token: other.json.token, body: { enc: 'v2.AAAA' } });
  assert.equal(put.status, 409);
  const delegate = await call('POST', '/api/settings/reports/delegation', { token: other.json.token, body: { report_key: 'short' } });
  assert.equal(delegate.status, 400);
});

await t('an API key can never reach the report endpoints', async () => {
  const w = new Database(`${DATA_DIR}/data.db`); w.prepare("UPDATE users SET plan='pro' WHERE username='reporter1'").run(); w.close();
  const k = await page('POST', '/api/keys', { name: 'x' });
  const header = k.json.rawKey.split('.')[0];
  assert.equal((await call('PUT', '/api/settings/reports/snapshot', { apiKey: header, body: { enc: 'v2.AAAA' } })).status, 403);
  assert.equal((await call('GET', '/api/settings/reports', { apiKey: header })).status, 403);
});

await t('turning it off erases the key and the stored summary, and e-mails go back to counts only', async () => {
  await disableReportFigures();
  const db = new Database(`${DATA_DIR}/data.db`, { readonly: true });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM report_snapshots s JOIN users u ON u.id = s.user_id WHERE u.username='reporter1'").get() as any).c, 0);
  assert.equal((db.prepare("SELECT server_report_key k FROM users WHERE username='reporter1'").get() as any).k, null);
  db.close();
  const r = await page('POST', '/api/settings/reports/generate');
  assert.equal(r.json.with_figures, false);
  assert.ok(!latestMail().includes('Zebra'));
  const snap = await buildSnapshot({ include_job_names: true, include_category_names: true });   // still computable locally, never sent
  assert.ok(snap.rows.length > 0);
});

console.log(`\n${passed} report tests passed`);
process.exit(process.exitCode || 0);
