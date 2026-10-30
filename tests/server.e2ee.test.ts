import assert from 'node:assert/strict';
import fs from 'node:fs';
import { io } from 'socket.io-client';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import * as C from '../src/e2ee/crypto.ts';
import { call, registerUser, login, uuid, BASE } from './helpers.ts';

const DATA_DIR = process.env.DATA_DIR!;
let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', e.message?.split('\n')[0]); process.exitCode = 1; } };

const alice = await registerUser('alice');
const bob = await registerUser('bobby');
const carol = await registerUser('carol');

await t('login: params → derive → auth_key; the password itself never reaches the server', async () => {
  const r = await login('alice', 'a-very-long-test-passphrase');
  assert.equal(r.status, 200); assert.equal(r.json.user.kdf_version, 2);
  const unlocked = await C.unlockBundle(r.json.user, r.creds.wrapKey);
  assert.deepEqual(unlocked.masterKey, alice.keys.masterKey);
  const db = new Database(`${DATA_DIR}/data.db`, { readonly: true });
  const hash = (db.prepare("SELECT password_hash h FROM users WHERE username='alice'").get() as any).h;
  assert.equal(await bcrypt.compare('a-very-long-test-passphrase', hash), false, 'password must not be what the server verifies');
  assert.equal(await bcrypt.compare(alice.authKey, hash), true);
  db.close();
  assert.equal((await login('alice', 'wrong-password-123')).status, 401);
});

await t('params endpoint does not reveal whether an account exists (same shape, stable fake salt)', async () => {
  const a = await call('POST', '/api/auth/params', { body: { identifier: 'nobody-here' } });
  const b = await call('POST', '/api/auth/params', { body: { identifier: 'nobody-here' } });
  assert.equal(a.json.kdf_version, 2); assert.equal(a.json.kdf_salt, b.json.kdf_salt);
  assert.deepEqual(Object.keys(a.json).sort(), Object.keys((await call('POST', '/api/auth/params', { body: { identifier: 'alice' } })).json).sort());
});

const jobId = uuid(); let jobKey: Uint8Array; let expenseId = uuid();
await t('owner creates an encrypted job + expense; server returns only ciphertext', async () => {
  jobKey = C.generateJobKey();
  const r = await call('POST', '/api/v2/jobs', { token: alice.token, body: {
    id: jobId, enc: await C.encryptJson(jobKey, { title: 'Smith Kitchen Remodel', client_name: 'Jane Smith' }, C.aad.job(jobId)),
    start_date: '2026-11-01', end_date: '2026-11-05', key: await C.wrapJobKeyForSelf(alice.keys.mk, jobKey),
    calendar_title_enc: await C.encryptCalendarTitle(alice.keys.calendarKey, jobId, 'Smith Kitchen Remodel'),
  } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const e = await call('POST', `/api/v2/jobs/${jobId}/expenses`, { token: alice.token, form: (() => {
    const f = new FormData(); f.append('id', expenseId);
    return f;
  })() }).catch(() => null);
  // enc must be supplied: build it properly
  const f = new FormData(); f.append('id', expenseId);
  f.append('enc', await C.encryptJson(jobKey, { amount: 1234.56, description: 'Secret lumber purchase', entry_type: 'expense', date: '2026-11-02' }, C.aad.expense(jobId, expenseId)));
  const ok = await call('POST', `/api/v2/jobs/${jobId}/expenses`, { token: alice.token, form: f });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const list = await call('GET', `/api/v2/jobs/${jobId}/expenses`, { token: alice.token });
  assert.ok(list.json[0].enc.startsWith('v2.')); assert.ok(!JSON.stringify(list.json).includes('lumber'));
  const dec = await C.decryptJson(jobKey, list.json[0].enc, C.aad.expense(jobId, expenseId));
  assert.equal(dec.amount, 1234.56);
});

await t('outsider and anonymous callers get nothing (404/401)', async () => {
  for (const p of [`/api/v2/jobs/${jobId}/expenses`, `/api/v2/jobs/${jobId}/wishlist`, `/api/v2/jobs/${jobId}/subscriptions`, `/api/v2/jobs/${jobId}/members`])
    assert.equal((await call('GET', p, { token: carol.token })).status, 404, p);
  assert.equal((await call('GET', `/api/v2/jobs/${jobId}/expenses`)).status, 401);
  assert.equal((await call('GET', '/api/v2/jobs', { token: carol.token })).json.length, 0);
});

await t('enc must be a v2 envelope (plaintext writes are rejected)', async () => {
  const f = new FormData(); f.append('id', uuid()); f.append('enc', JSON.stringify({ amount: 5 }));
  assert.equal((await call('POST', `/api/v2/jobs/${jobId}/expenses`, { token: alice.token, form: f })).status, 400);
  assert.equal((await call('POST', '/api/v2/jobs', { token: alice.token, body: { id: uuid(), enc: 'hello', key: 'abcd' } })).status, 400);
});

let inviteToken = '';
await t('invite flow: single-use token → pending (no data access) → owner wraps key via ECDH → member decrypts', async () => {
  const inv = await call('POST', `/api/v2/jobs/${jobId}/invites`, { token: alice.token });
  assert.equal(inv.status, 200); inviteToken = inv.json.token;
  assert.equal((await call('POST', `/api/v2/jobs/${jobId}/invites`, { token: bob.token })).status, 404, 'non-members cannot create invites');
  const red = await call('POST', '/api/v2/invites/redeem', { token: bob.token, body: { token: inviteToken } });
  assert.equal(red.status, 200); assert.equal(red.json.status, 'pending');
  assert.equal((await call('GET', `/api/v2/jobs/${jobId}/expenses`, { token: bob.token })).status, 404, 'pending members get no ciphertext');
  assert.equal((await call('POST', '/api/v2/invites/redeem', { token: carol.token, body: { token: inviteToken } })).status, 404, 'token is single-use');
  assert.equal((await call('GET', '/api/v2/jobs/pending', { token: bob.token })).json.length, 1);

  const members = await call('GET', `/api/v2/jobs/${jobId}/members`, { token: alice.token });
  const pending = members.json.find((m: any) => m.user_id === bob.id);
  assert.equal(pending.status, 'pending'); assert.equal(pending.has_key, 0);
  assert.equal(pending.public_key, bob.keys.publicKey);
  const wrapped = await C.wrapJobKeyForMember(alice.keys.privateKeyPkcs8, pending.public_key, jobId, jobKey);
  assert.equal((await call('PUT', `/api/v2/jobs/${jobId}/members/${bob.id}/key`, { token: carol.token, body: { encrypted_key: wrapped } })).status, 404, 'only owner can approve');
  assert.equal((await call('PUT', `/api/v2/jobs/${jobId}/members/${bob.id}/key`, { token: alice.token, body: { encrypted_key: wrapped } })).status, 200);

  const keys = await call('GET', '/api/v2/keys', { token: bob.token });
  const k = keys.json.find((x: any) => x.job_id === jobId);
  const bobsKey = await C.unwrapJobKeyFromMember(bob.keys.privateKeyPkcs8, k.wrapper_public_key, jobId, k.encrypted_key);
  assert.deepEqual(bobsKey, jobKey);
  const rows = await call('GET', `/api/v2/jobs/${jobId}/expenses`, { token: bob.token });
  assert.equal(rows.status, 200);
  assert.equal((await C.decryptJson(bobsKey, rows.json[0].enc, C.aad.expense(jobId, expenseId))).description, 'Secret lumber purchase');
});

await t('blob swap protection: ciphertext from one record fails on another (AAD)', async () => {
  const rows = (await call('GET', `/api/v2/jobs/${jobId}/expenses`, { token: alice.token })).json;
  await assert.rejects(C.decryptJson(jobKey, rows[0].enc, C.aad.expense(jobId, uuid())));
});

let receiptName = '';
await t('receipts: only encrypted binary accepted; download is authenticated and membership-checked; /uploads is gone', async () => {
  const png = new FormData(); png.append('id', uuid()); png.append('enc', await C.encryptJson(jobKey, { amount: 1 }, 'x')); png.append('receipt', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'r.png');
  assert.equal((await call('POST', `/api/v2/jobs/${jobId}/expenses`, { token: alice.token, form: png })).status, 400, 'plaintext image rejected');
  const id2 = uuid();
  const f = new FormData(); f.append('id', id2); f.append('enc', await C.encryptJson(jobKey, { amount: 9 }, C.aad.expense(jobId, id2)));
  f.append('receipt', new Blob([await C.seal(await C.aesKey(jobKey), C.utf8('receipt-bytes'))], { type: 'application/octet-stream' }), '../../evil.html');
  const up = await call('POST', `/api/v2/jobs/${jobId}/expenses`, { token: alice.token, form: f });
  assert.equal(up.status, 200); assert.match(up.json.receipt_url, /^\/uploads\/\d+-[0-9a-f]{24}\.bin$/);
  receiptName = up.json.receipt_url.split('/').pop();
  assert.equal((await call('GET', `/api/v2/uploads/${receiptName}`)).status, 401);
  assert.equal((await call('GET', `/api/v2/uploads/${receiptName}`, { token: carol.token })).status, 404);
  const dl = await call('GET', `/api/v2/uploads/${receiptName}`, { token: bob.token });
  assert.equal(dl.status, 200); assert.equal(dl.headers.get('cache-control'), 'private, no-store');
  assert.equal(new TextDecoder().decode(await C.open(await C.aesKey(jobKey), dl.bytes)), 'receipt-bytes');
  assert.equal((await fetch(`${BASE}/uploads/${receiptName}`)).status, 404, 'no public static access');
});

await t('API key: calendar-only; titles decryptable only with the private half; server cannot read them', async () => {
  const k = await C.createApiKeySecrets(alice.keys.calendarKey);
  assert.equal((await call('POST', '/api/keys', { token: alice.token, body: { name: 'cal', key_hash: k.keyHash, wrapped_calendar_key: k.wrappedCalendarKey } })).status, 200);
  const sched = await call('GET', '/api/calendar/schedule', { apiKey: k.headerKey });
  assert.equal(sched.status, 200); assert.equal(sched.json.version, 2);
  assert.equal(sched.json.jobs[0].start_date, '2026-11-01'); assert.ok(sched.json.jobs[0].title.startsWith('v2.'));
  const cal = await C.unwrapCalendarKeyWithApiKey(sched.json.wrapped_calendar_key, k.fullKey.split('.')[1]);
  assert.equal(await C.decryptCalendarTitle(cal, jobId, sched.json.jobs[0].title), 'Smith Kitchen Remodel');
  // scope
  for (const p of ['/api/v2/jobs', '/api/keys', `/api/v2/jobs/${jobId}/expenses`, '/api/auth/me', '/api/admin/users'])
    assert.equal((await call('GET', p, { apiKey: k.headerKey })).status, 403, p);
  assert.equal((await call('GET', '/api/calendar/schedule', { apiKey: k.fullKey })).status, 400, 'full key (with secret half) is refused');
  assert.equal((await call('GET', '/api/calendar/schedule', { apiKey: 'ge_' + 'a'.repeat(32) })).status, 401);
  const db = new Database(`${DATA_DIR}/data.db`, { readonly: true });
  const stored = db.prepare('SELECT key_hash, wrapped_calendar_key FROM api_keys').get() as any; db.close();
  assert.ok(!JSON.stringify(stored).includes(k.fullKey.split('.')[1]), 'server never stores the decrypt half');
});

await t('members see a calendar with their own label; unlabeled joined jobs have title=null', async () => {
  const s = await call('GET', '/api/calendar/schedule', { token: bob.token });
  assert.equal(s.json.jobs.length, 1); assert.equal(s.json.jobs[0].title, null);
  const label = await C.encryptCalendarTitle(bob.keys.calendarKey, jobId, 'Smith (my label)');
  assert.equal((await call('PUT', `/api/v2/jobs/${jobId}/calendar-label`, { token: bob.token, body: { title_enc: label } })).status, 200);
  const s2 = await call('GET', '/api/calendar/schedule', { token: bob.token });
  assert.equal(await C.decryptCalendarTitle(bob.keys.calendarKey, jobId, s2.json.jobs[0].title), 'Smith (my label)');
  assert.equal((await call('PUT', `/api/v2/jobs/${jobId}/calendar-label`, { token: carol.token, body: { title_enc: label } })).status, 404);
});

await t('personal blobs: encrypted, versioned, user-scoped, whitelisted', async () => {
  const enc = await C.encryptJson(alice.keys.udk, { tags: [{ id: 't1', name: 'Fuel' }] }, C.aad.blob(alice.id, 'tags'));
  const put = await call('PUT', '/api/v2/blobs/tags', { token: alice.token, body: { enc } });
  assert.equal(put.json.version, 1);
  assert.equal((await call('PUT', '/api/v2/blobs/tags', { token: alice.token, body: { enc, expected_version: 1 } })).json.version, 2);
  assert.equal((await call('PUT', '/api/v2/blobs/tags', { token: alice.token, body: { enc, expected_version: 1 } })).status, 409);
  assert.equal((await call('PUT', '/api/v2/blobs/evil', { token: alice.token, body: { enc } })).status, 400);
  assert.equal((await call('GET', '/api/v2/blobs', { token: bob.token })).json.length, 0);
});

await t('realtime: members receive ciphertext rows; outsiders and anonymous sockets receive nothing', async () => {
  const connect = (auth: any) => new Promise<any>(res => { const s = io(BASE, { auth, transports: ['websocket'], reconnection: false }); s.on('connect', () => res({ s })); s.on('connect_error', e => res({ err: e.message })); });
  assert.equal((await connect({})).err, 'unauthorized');
  const a = await connect({ token: alice.token }), c = await connect({ token: carol.token }), b = await connect({ token: bob.token });
  const got: Record<string, any[]> = { a: [], b: [], c: [] };
  a.s.on('expense_added', (e: any) => got.a.push(e)); b.s.on('expense_added', (e: any) => got.b.push(e)); c.s.on('expense_added', (e: any) => got.c.push(e));
  for (const x of [a, b, c]) x.s.emit('join_job', jobId);
  await new Promise(r => setTimeout(r, 300));
  const id3 = uuid(); const f = new FormData(); f.append('id', id3); f.append('enc', await C.encryptJson(jobKey, { amount: 77 }, C.aad.expense(jobId, id3)));
  await call('POST', `/api/v2/jobs/${jobId}/expenses`, { token: alice.token, form: f });
  await new Promise(r => setTimeout(r, 400));
  assert.equal(got.a.length, 1); assert.equal(got.b.length, 1); assert.equal(got.c.length, 0);
  assert.ok(got.b[0].enc.startsWith('v2.') && got.b[0].amount === undefined);
  [a, b, c].forEach(x => x.s.close());
});

await t('password change: needs current auth key, re-wraps MK, revokes other sessions, same vault afterwards', async () => {
  const newSalt = C.newKdfSalt();
  const nc = await C.deriveCredentials('brand-new-passphrase-2', newSalt, 1000);
  const wrongCur = await C.deriveCredentials('nope', alice.salt, 1000);
  const body = { current_auth_key: wrongCur.authKey, auth_key: nc.authKey, kdf_salt: newSalt, kdf_iterations: 1000, master_key_encrypted: await C.rewrapMasterKey(alice.keys.masterKey, nc.wrapKey) };
  assert.equal((await call('PATCH', '/api/auth/me/password', { token: alice.token, body })).status, 403);
  body.current_auth_key = alice.authKey;
  const r = await call('PATCH', '/api/auth/me/password', { token: alice.token, body });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/auth/me', { token: alice.token })).status, 401, 'old session revoked');
  assert.equal((await call('GET', '/api/auth/me', { token: r.json.token })).status, 200);
  const re = await login('alice', 'brand-new-passphrase-2');
  assert.equal(re.status, 200);
  const keys = await C.unlockBundle(re.json.user, re.creds.wrapKey);
  assert.deepEqual(keys.calendarKey, alice.keys.calendarKey); // same vault, same data still readable
  alice.token = r.json.token;
});

await t('reset requires the recovery phrase (key_check): a stolen reset token alone cannot overwrite the vault', async () => {
  await call('POST', '/api/auth/forgot-password', { body: { email: 'bobby@example.com' } });
  await new Promise(r => setTimeout(r, 300));
  const db = new Database(`${DATA_DIR}/data.db`);
  const token = 'known-reset-token-for-test';
  db.prepare("UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE username = 'bobby'").run(
    (await import('node:crypto')).createHash('sha256').update(token).digest('hex'), new Date(Date.now() + 60000).toISOString());
  db.close();
  const salt = C.newKdfSalt(); const nc = await C.deriveCredentials('recovered-passphrase-3', salt, 1000);
  const evilMk = C.randomBytes(32);
  const evil = await call('POST', '/api/auth/reset-password', { body: { token, auth_key: nc.authKey, kdf_salt: salt, kdf_iterations: 1000, master_key_encrypted: await C.rewrapMasterKey(evilMk, nc.wrapKey), key_check: await C.keyCheckOf(evilMk) } });
  assert.equal(evil.status, 403, 'attacker with only the token is refused');
  const mk = await C.mnemonicToMasterKey(bob.mnemonic);
  const good = await call('POST', '/api/auth/reset-password', { body: { token, auth_key: nc.authKey, kdf_salt: salt, kdf_iterations: 1000, master_key_encrypted: await C.rewrapMasterKey(mk, nc.wrapKey), key_check: await C.keyCheckOf(mk) } });
  assert.equal(good.status, 200);
  const l = await login('bobby', 'recovered-passphrase-3');
  assert.equal(l.status, 200);
  assert.deepEqual((await C.unlockBundle(l.json.user, l.creds.wrapKey)).calendarKey, bob.keys.calendarKey);
  assert.equal((await call('GET', '/api/auth/me', { token: bob.token })).status, 401, 'old sessions revoked');
});

await t('member removal revokes access immediately', async () => {
  const bobNow = (await login('bobby', 'recovered-passphrase-3')).json.token;
  assert.equal((await call('GET', `/api/v2/jobs/${jobId}/expenses`, { token: bobNow })).status, 200);
  assert.equal((await call('DELETE', `/api/v2/jobs/${jobId}/members/${bob.id}`, { token: alice.token })).status, 200);
  assert.equal((await call('GET', `/api/v2/jobs/${jobId}/expenses`, { token: bobNow })).status, 404);
  assert.equal((await call('GET', `/api/v2/uploads/${receiptName}`, { token: bobNow })).status, 404);
  assert.equal((await call('GET', '/api/v2/keys', { token: bobNow })).json.length, 0);
});

await t('delegation for background Google sync is opt-in, refused when not configured, and never stores the raw key', async () => {
  const r = await call('POST', '/api/settings/google/delegation', { token: alice.token, body: { calendar_key: Buffer.from(alice.keys.calendarKey).toString('base64') } });
  assert.ok([200, 503].includes(r.status));
  if (r.status === 200) {
    const db = new Database(`${DATA_DIR}/data.db`, { readonly: true });
    const v = (db.prepare("SELECT server_calendar_key v FROM users WHERE username='alice'").get() as any).v; db.close();
    assert.ok(v && v !== Buffer.from(alice.keys.calendarKey).toString('base64'));
    assert.equal((await call('DELETE', '/api/settings/google/delegation', { token: alice.token })).status, 200);
  }
});

await t('the database file contains no plaintext of anything the users stored', async () => {
  const db = new Database(`${DATA_DIR}/data.db`); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();
  const bytes = fs.readFileSync(`${DATA_DIR}/data.db`).toString('latin1');
  for (const needle of ['Smith Kitchen', 'Jane Smith', 'Secret lumber', 'receipt-bytes', 'a-very-long-test-passphrase', 'brand-new-passphrase', 'Fuel', alice.mnemonic.split(' ')[0] + ' ' + alice.mnemonic.split(' ')[1]])
    assert.ok(!bytes.includes(needle), `plaintext leaked into database: ${needle}`);
  for (const f of fs.readdirSync(`${DATA_DIR}/uploads`)) assert.ok(!fs.readFileSync(`${DATA_DIR}/uploads/${f}`).toString('latin1').includes('receipt-bytes'));
});

console.log(`\n${passed} server E2EE tests passed`);
process.exit(process.exitCode || 0);
