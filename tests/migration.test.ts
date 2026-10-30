import './shim.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { call } from './helpers.ts';
import { installE2eeRouter } from '../src/e2ee/router.ts';
import { loginWithPassword, upgradeLegacyAccount } from '../src/e2ee/auth.ts';
import { migrateLegacyData } from '../src/e2ee/migration.ts';
import { getSession, setSession } from '../src/e2ee/session.ts';
import * as C from '../src/e2ee/crypto.ts';
import * as legacy from '../src/utils/crypto.ts';

const DATA_DIR = process.env.DATA_DIR!;
let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; } };
const page = async (method: string, path: string, body?: any) => {
  const init: any = { method, headers: { Authorization: 'Bearer ignored' } };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(path, init); let json: any = null; try { json = await res.clone().json(); } catch {}
  return { status: res.status, json, res };
};

const PASSWORD = 'legacy password 123';
const EMAIL = 'legacy1@example.com';
const NEEDLES = ['Legacy Kitchen', 'Old Shed', 'Maple cabinets', 'Plaintext receipt purchase', 'Dana Legacy', 'legacy-ai-key-sk-12345', 'Legacy Tag Fuel', 'LEGACY CORP INC', 'Legacy Co Invoice', 'Gym membership', 'Wish: laser level', 'LEGACY-PLAINTEXT-RECEIPT'];

// ── Seed a pre-E2EE account directly in the database, exactly as the old server stored it ──
const mnemonic = C.generateMnemonic();
// The v1 helper returns the first 32 bytes of the BIP-39 seed in browsers; compute that directly (Node's pooled Buffer.slice differs).
const mkB64 = C.toB64(await C.mnemonicToMasterKey(mnemonic));
const mkLegacy = await legacy.importEncryptionKey(mkB64);
const jobKeyA = await legacy.generateEncryptionKey();
const wrappedA = await legacy.wrapKey(jobKeyA, mkLegacy);
const userId = crypto.randomUUID(), jobA = crypto.randomUUID(), jobB = crypto.randomUUID();
const seed = async () => {
  const db = new Database(`${DATA_DIR}/data.db`);
  db.pragma('foreign_keys = ON');
  const wrapping = await legacy.derivePasswordKey(PASSWORD, EMAIL);
  db.prepare("INSERT INTO users (id, username, email, password_hash, plan, master_key_encrypted, kdf_version, e2ee_version, ai_api_key, ai_base_url, ai_model) VALUES (?,?,?,?,?,?,1,1,?,?,?)")
    .run(userId, 'legacy1', EMAIL, bcrypt.hashSync(PASSWORD, 10), 'pro', await legacy.wrapKey(mkB64, wrapping), 'legacy-ai-key-sk-12345', 'https://api.openai.com/v1', 'gpt-4o-mini');
  db.prepare("INSERT INTO jobs (id, title, description, created_by, start_date, end_date, client_name, invoice_tag, invoice_seq, invoice_number, job_rate, mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(jobA, 'Legacy Kitchen', 'Maple cabinets install', userId, '2026-03-01', '2026-03-10', 'Dana Legacy', 'KIT', 1, 'KIT-A00001', 85, 'expense');
  db.prepare("INSERT INTO jobs (id, title, created_by, invoice_number, invoice_seq) VALUES (?,?,?,?,?)").run(jobB, 'Old Shed', userId, 'INV-A00001', 1);
  db.prepare("INSERT INTO job_keys (job_id, user_id, encrypted_job_key) VALUES (?,?,?)").run(jobA, userId, wrappedA); // job B never had a key

  fs.writeFileSync(`${DATA_DIR}/uploads/1700000000001-legacy-plain.png`, 'LEGACY-PLAINTEXT-RECEIPT');
  const encFile = await legacy.encryptFile(new File([new TextEncoder().encode('legacy encrypted receipt body')], 'x.jpg'), jobKeyA);
  fs.writeFileSync(`${DATA_DIR}/uploads/1700000000002-legacy-enc.jpg`, Buffer.from(await encFile.arrayBuffer()));

  const ins = db.prepare("INSERT INTO expenses (id, job_id, user_id, amount, description, receipt_url, is_encrypted, entry_type, date) VALUES (?,?,?,?,?,?,?,?,?)");
  ins.run('e-plain', jobA, userId, 310.5, 'Plaintext receipt purchase', '/uploads/1700000000001-legacy-plain.png', 0, 'expense', '2026-03-02');
  ins.run('e-enc', jobA, userId, 99.99, 'Maple cabinets hardware', '/uploads/1700000000002-legacy-enc.jpg', 1, 'expense', '2026-03-03');
  ins.run('e-inc', jobA, userId, 4000, 'Deposit from client', null, 0, 'income', '2026-03-04');
  ins.run('e-b', jobB, userId, 15, 'Shed screws', null, 0, 'expense', '2026-03-05');
  db.prepare("INSERT INTO tags (id, user_id, name, color) VALUES ('t-fuel', ?, 'Legacy Tag Fuel', '#ef4444')").run(userId);
  db.prepare("INSERT INTO expense_tags (expense_id, tag_id) VALUES ('e-enc','t-fuel')").run();
  db.prepare("INSERT INTO tag_tax_mappings (tag_id, schedule_c_line) VALUES ('t-fuel','line_9_vehicle')").run();
  db.prepare("INSERT INTO expense_tax_mappings (expense_id, user_id, schedule_c_line) VALUES ('e-plain', ?, 'line_22_supplies')").run(userId);
  db.prepare("INSERT INTO wishlist_items (id, job_id, user_id, name, estimated_cost, url, notes) VALUES ('w1',?,?,?,?,?,?)").run(jobA, userId, 'Wish: laser level', 120, 'https://example.com/laser', 'for cabinets');
  db.prepare("INSERT INTO subscriptions (id, job_id, user_id, amount, description, billing_day, frequency, next_generation_date, entry_type) VALUES ('s1',?,?,?,?,?,?,?,?)").run(jobA, userId, 25, 'Gym membership', 12, 'MONTHLY', '2026-12-12T00:00:00.000Z', 'expense');
  db.prepare("INSERT INTO tax_settings (user_id, tax_year, filing_status, entity_type, business_miles, additional_gross_income) VALUES (?,2026,'married_joint','sole_proprietorship',1200,500)").run(userId);
  db.prepare("INSERT INTO w2_forms (id, user_id, tax_year, employer_name, wages_box1, fed_withholding_box2) VALUES ('w2a',?,2026,'LEGACY CORP INC',42000,3000)").run(userId);
  db.prepare("INSERT INTO invoice_templates (id, user_id, company_name, default_prefix) VALUES ('it1',?,'Legacy Co Invoice','LEG')").run(userId);
  db.close();
};
await seed();
installE2eeRouter();

await t('seeded legacy plaintext is really in the database before migration (test sanity)', async () => {
  const bytes = fs.readFileSync(`${DATA_DIR}/data.db`).toString('latin1') + fs.readFileSync(`${DATA_DIR}/data.db-wal`, { flag: 'r' }).toString('latin1');
  assert.ok(bytes.includes('Legacy Kitchen') && bytes.includes('legacy-ai-key-sk-12345'));
});

let outcome: any;
await t('legacy login still works once, is flagged as legacy, and the old vault opens with the old password', async () => {
  const l = await loginWithPassword('legacy1', PASSWORD);
  assert.equal(l.legacy, true); assert.ok((l as any).masterKey, 'old master key unwrapped'); assert.equal((l as any).newMnemonic, null);
  assert.deepEqual(C.toB64((l as any).masterKey), mkB64);
  outcome = l;
  await assert.rejects(loginWithPassword('legacy1', 'wrong password!!'));
});

await t('upgrade: server swaps the password for a v2 auth key; old-protocol login stops working', async () => {
  const up = await upgradeLegacyAccount(outcome);
  assert.equal(up.user.kdf_version, 2); assert.equal(up.user.e2ee_version, 1, 'data not migrated yet');
  assert.deepEqual(up.keys.masterKey, C.fromB64(mkB64), 'same master key, so existing wrapped job keys remain valid');
  const old = await call('POST', '/api/auth/login', { body: { username: 'legacy1', password: PASSWORD } });
  assert.equal(old.status, 401, 'legacy password protocol is refused after the upgrade');
  const noData = await call('GET', '/api/legacy/export', { token: up.token });
  assert.equal(noData.status, 200, 'owner can still read their own legacy data to migrate it');
});

await t('migration runs, reports progress and completes', async () => {
  const seen: string[] = [];
  const stats = await migrateLegacyData((m) => seen.push(m));
  assert.equal(stats.jobs, 2); assert.equal(stats.expenses, 4); assert.equal(stats.receipts, 1, 'only the plaintext receipt needed re-encryption');
  assert.ok(seen.length > 3);
  const me = await call('GET', '/api/auth/me', { token: getSession().token });
  assert.equal(me.json.user.e2ee_version, 2);
  assert.equal((await call('GET', '/api/legacy/export', { token: getSession().token })).status, 410, 'export is closed after completion');
});

await t('every migrated record decrypts and the page API shows the original data', async () => {
  const jobs = (await page('GET', '/api/jobs')).json;
  const a = jobs.find((j: any) => j.id === jobA), b = jobs.find((j: any) => j.id === jobB);
  assert.equal(a.title, 'Legacy Kitchen'); assert.equal(a.client_name, 'Dana Legacy'); assert.equal(a.invoice_number, 'KIT-A00001'); assert.equal(a.job_rate, 85); assert.equal(a.start_date, '2026-03-01');
  assert.equal(b.title, 'Old Shed');
  assert.equal(a.total_income, 4000); assert.equal(Math.round(a.total_expenses * 100) / 100, 410.49);
  const ex = (await page('GET', `/api/jobs/${jobA}/expenses`)).json;
  assert.equal(ex.length, 3); assert.equal(ex.find((e: any) => e.id === 'e-enc').tags[0].name, 'Legacy Tag Fuel');
  assert.equal(ex.find((e: any) => e.id === 'e-plain').amount, 310.5);
  assert.equal((await page('GET', `/api/jobs/${jobB}/expenses`)).json[0].description, 'Shed screws');
  assert.equal((await page('GET', `/api/jobs/${jobA}/wishlist`)).json[0].name, 'Wish: laser level');
  assert.equal((await page('GET', `/api/jobs/${jobA}/subscriptions`)).json[0].description, 'Gym membership');
  assert.equal((await page('GET', '/api/tags')).json[0].name, 'Legacy Tag Fuel');
  assert.equal((await page('GET', '/api/invoice-templates')).json.company_name, 'Legacy Co Invoice');
  assert.equal((await page('GET', '/api/settings/ai')).json.ai_api_key, 'legacy-ai-key-sk-12345');
  const profile = (await page('GET', '/api/taxes/profile?year=2026')).json;
  assert.equal(profile.settings.filing_status, 'married_joint'); assert.equal(profile.settings.business_miles, 1200);
  assert.equal(profile.w2Forms[0].employer_name, 'LEGACY CORP INC'); assert.equal(profile.tagMappings[0].schedule_c_line, 'line_9_vehicle');
  const calc = (await page('GET', '/api/taxes/calculate?year=2026')).json;
  assert.equal(calc.transactions.find((x: any) => x.id === 'e-plain').assigned_schedule_c_line, 'line_22_supplies', 'manual override survived');
  assert.equal(calc.transactions.find((x: any) => x.id === 'e-enc').assigned_schedule_c_line, 'line_9_vehicle', 'tag mapping survived');
});

await t('both receipts (previously plaintext and previously encrypted) now decrypt with the job key the pages use', async () => {
  const keyB64 = (await page('GET', `/api/jobs/${jobA}/keys`)).json.key;
  const raw = await legacy.unwrapKey(keyB64, await legacy.importEncryptionKey(C.toB64(getSession().keys.masterKey)));
  assert.equal(raw, jobKeyA, 'the original job key was kept');
  const ex = (await page('GET', `/api/jobs/${jobA}/expenses`)).json;
  for (const [id, expected] of [['e-plain', 'LEGACY-PLAINTEXT-RECEIPT'], ['e-enc', 'legacy encrypted receipt body']] as const) {
    const e = ex.find((x: any) => x.id === id);
    assert.equal(e.is_encrypted, 1);
    const dl = await fetch(e.receipt_url); assert.equal(dl.status, 200);
    const dec = await legacy.decryptFile(new Blob([await dl.arrayBuffer()]), raw, 'image/png');
    assert.equal(new TextDecoder().decode(await dec.arrayBuffer()), expected);
  }
});

await t('the job without a legacy key got a fresh one and is fully usable', async () => {
  const f = new FormData(); f.append('amount', '3'); f.append('description', 'new shed expense');
  assert.equal((await page('GET', `/api/jobs/${jobB}/keys`)).json.key !== null, true);
  const r = await fetch(`/api/jobs/${jobB}/expenses`, { method: 'POST', body: f });
  assert.equal(r.status, 200);
});

await t('no legacy plaintext remains in the database file, WAL, or upload directory', async () => {
  const db = new Database(`${DATA_DIR}/data.db`); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();
  const files = [`${DATA_DIR}/data.db`, `${DATA_DIR}/data.db-wal`].filter(f => fs.existsSync(f));
  for (const f of files) {
    const bytes = fs.readFileSync(f).toString('latin1');
    for (const n of NEEDLES) assert.ok(!bytes.includes(n), `legacy plaintext "${n}" still present in ${f.split('/').pop()}`);
  }
  for (const f of fs.readdirSync(`${DATA_DIR}/uploads`)) assert.ok(!fs.readFileSync(`${DATA_DIR}/uploads/${f}`).toString('latin1').includes('LEGACY-PLAINTEXT-RECEIPT'), `plaintext receipt on disk: ${f}`);
  const left = new Database(`${DATA_DIR}/data.db`, { readonly: true });
  for (const [sql, label] of [["SELECT COUNT(*) c FROM tags WHERE user_id=?", 'tags'], ["SELECT COUNT(*) c FROM tax_settings WHERE user_id=?", 'tax_settings'], ["SELECT COUNT(*) c FROM w2_forms WHERE user_id=?", 'w2'], ["SELECT COUNT(*) c FROM invoice_templates WHERE user_id=?", 'templates'], ["SELECT COUNT(*) c FROM expense_tax_mappings WHERE user_id=?", 'mappings']] as const)
    assert.equal((left.prepare(sql).get(userId) as any).c, 0, `${label} rows should be deleted`);
  assert.equal((left.prepare("SELECT ai_api_key k FROM users WHERE id=?").get(userId) as any).k, null);
  left.close();
});

await t('a later sign-in is plain v2: no migration needed, same data', async () => {
  setSession(null);
  const again = await loginWithPassword('legacy1', PASSWORD);
  assert.equal(again.legacy, false); assert.equal((again as any).user.e2ee_version, 2);
  assert.equal((await page('GET', '/api/jobs')).json.length, 2);
});

// ── Scale: a legacy account shaped like a real one (many jobs, almost none with a stored key) ──
await t('migrating 120 jobs without stored keys completes (no rate-limit failure) and the dashboard loads in few requests', async () => {
  const pw = 'second legacy pw 456', email = 'legacy2@example.com', uid = crypto.randomUUID();
  const mn = C.generateMnemonic(); const mk = C.toB64(await C.mnemonicToMasterKey(mn));
  const db = new Database(`${DATA_DIR}/data.db`); db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, username, email, password_hash, plan, master_key_encrypted, kdf_version, e2ee_version) VALUES (?,?,?,?,?,?,1,1)")
    .run(uid, 'legacy2', email, bcrypt.hashSync(pw, 10), 'pro', await legacy.wrapKey(mk, await legacy.derivePasswordKey(pw, email)));
  const insJob = db.prepare("INSERT INTO jobs (id, title, created_by, invoice_number, invoice_seq) VALUES (?,?,?,?,?)");
  const insExp = db.prepare("INSERT INTO expenses (id, job_id, user_id, amount, description, entry_type, date) VALUES (?,?,?,?,?,?,?)");
  db.transaction(() => { for (let i = 0; i < 120; i++) { const jid = crypto.randomUUID(); insJob.run(jid, `Bulk Job ${i}`, uid, `INV-A${String(i + 1).padStart(5, '0')}`, i + 1); insExp.run(crypto.randomUUID(), jid, uid, 10 + i, `Bulk item ${i}`, 'expense', '2026-04-01'); insExp.run(crypto.randomUUID(), jid, uid, 5, `Bulk income ${i}`, 'income', '2026-04-02'); } })();
  db.close();

  setSession(null);
  const l: any = await loginWithPassword('legacy2', pw);
  const up = await upgradeLegacyAccount(l);
  const started = Date.now();
  const stats = await migrateLegacyData();
  assert.equal(stats.jobs, 120); assert.equal(stats.expenses, 240);
  const migrateMs = Date.now() - started;

  const t0 = Date.now();
  const jobs = (await page('GET', '/api/jobs')).json;
  assert.equal(jobs.length, 120);
  assert.equal(jobs.find((j: any) => j.title === 'Bulk Job 7').total_expenses, 17);
  assert.equal(jobs.reduce((n: number, j: any) => n + j.total_income, 0), 600);
  console.log(`      (migrated 120 jobs in ${(migrateMs / 1000).toFixed(1)}s; dashboard load ${Date.now() - t0}ms)`);
  assert.equal((await call('GET', '/api/auth/me', { token: up.token })).json.user.e2ee_version, 2);
});

console.log(`\n${passed} migration tests passed`);
process.exit(process.exitCode || 0);
