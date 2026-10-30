import assert from 'node:assert/strict';
import * as C from '../src/e2ee/crypto.ts';

let n = 0; const t = async (name: string, fn: () => Promise<void>) => { await fn(); n++; console.log('PASS ', name); };
const ITER = 1000; // tests only; production uses KDF_ITERATIONS

await t('auth key and wrap key are independent and deterministic', async () => {
  const salt = C.newKdfSalt();
  const a = await C.deriveCredentials('correct horse battery', salt, ITER);
  const b = await C.deriveCredentials('correct horse battery', salt, ITER);
  const c = await C.deriveCredentials('correct horse battery!', salt, ITER);
  assert.equal(a.authKey, b.authKey); assert.notEqual(a.authKey, c.authKey);
  assert.ok(a.authKey.length >= 43);
  // wrapKey is non-extractable and never equals/derives from the authKey the server sees
  await assert.rejects(crypto.subtle.exportKey('raw', a.wrapKey));
});

await t('bundle: create, unlock with password, unlock with master key', async () => {
  const salt = C.newKdfSalt(); const creds = await C.deriveCredentials('pw-123456789', salt, ITER);
  const mn = C.generateMnemonic(); assert.ok(C.isValidMnemonic(mn));
  const mkBytes = await C.mnemonicToMasterKey(mn);
  const { bundle, keys } = await C.createBundle(mkBytes, creds.wrapKey);
  const again = await C.unlockBundle(bundle, creds.wrapKey);
  assert.deepEqual(again.masterKey, keys.masterKey); assert.deepEqual(again.calendarKey, keys.calendarKey); assert.equal(again.publicKey, keys.publicKey);
  const bad = await C.deriveCredentials('wrong-password', salt, ITER);
  await assert.rejects(C.unlockBundle(bundle, bad.wrapKey));
  const viaMn = await C.sessionFromMasterKey(await C.mnemonicToMasterKey(mn), bundle);
  assert.deepEqual(viaMn.calendarKey, keys.calendarKey);
  assert.equal(bundle.key_check, await C.keyCheckOf(mkBytes));
});

await t('envelope: round trip, AAD binding, tamper detection', async () => {
  const key = C.generateJobKey();
  const env = await C.encryptJson(key, { amount: 12.5, description: 'Lumber' }, C.aad.expense('job1', 'e1'));
  assert.ok(env.startsWith('v2.')); assert.ok(!env.includes('Lumber'));
  assert.deepEqual(await C.decryptJson(key, env, C.aad.expense('job1', 'e1')), { amount: 12.5, description: 'Lumber' });
  await assert.rejects(C.decryptJson(key, env, C.aad.expense('job1', 'e2')));        // swapped onto another record
  await assert.rejects(C.decryptJson(C.generateJobKey(), env, C.aad.expense('job1', 'e1'))); // wrong key
  const raw = C.fromB64(env.slice(3)); raw[raw.length - 1] ^= 1;
  await assert.rejects(C.decryptJson(key, 'v2.' + C.toB64(raw), C.aad.expense('job1', 'e1'))); // bit flip
});

await t('member sharing via ECDH: only intended recipient can unwrap, bound to job', async () => {
  const alice = await C.generateKeyPair(), bob = await C.generateKeyPair(), eve = await C.generateKeyPair();
  const jobKey = C.generateJobKey();
  const wrapped = await C.wrapJobKeyForMember(alice.privateKeyPkcs8, bob.publicKey, 'jobA', jobKey);
  assert.deepEqual(await C.unwrapJobKeyFromMember(bob.privateKeyPkcs8, alice.publicKey, 'jobA', wrapped), jobKey);
  await assert.rejects(C.unwrapJobKeyFromMember(eve.privateKeyPkcs8, alice.publicKey, 'jobA', wrapped));
  await assert.rejects(C.unwrapJobKeyFromMember(bob.privateKeyPkcs8, alice.publicKey, 'jobB', wrapped));
  assert.match(await C.fingerprint(bob.publicKey), /^([0-9A-F]{4}-){4}[0-9A-F]{4}$/);
});

await t('self-wrapped job key stays compatible with v1 format (iv||ct, no AAD)', async () => {
  const mk = await C.aesKey(C.randomBytes(32)); const jk = C.generateJobKey();
  const w = await C.wrapJobKeyForSelf(mk, jk);
  assert.deepEqual(await C.unwrapJobKeyForSelf(mk, w), jk);
});

await t('API key: server-visible part cannot recover the calendar key; decrypt part can', async () => {
  const cal = C.randomBytes(32);
  const k = await C.createApiKeySecrets(cal);
  assert.match(k.fullKey, /^ge_[\w-]+\.[\w-]+$/); assert.ok(!k.headerKey.includes('.'));
  const dec = k.fullKey.split('.')[1];
  assert.deepEqual(await C.unwrapCalendarKeyWithApiKey(k.wrappedCalendarKey, dec), cal);
  await assert.rejects(C.unwrapCalendarKeyWithApiKey(k.wrappedCalendarKey, k.headerKey.slice(3)));
  const title = await C.encryptCalendarTitle(cal, 'job1', 'Smith Kitchen');
  assert.equal(await C.decryptCalendarTitle(cal, 'job1', title), 'Smith Kitchen');
  await assert.rejects(C.decryptCalendarTitle(cal, 'job2', title));
});
console.log(`\n${n} crypto tests passed`);
