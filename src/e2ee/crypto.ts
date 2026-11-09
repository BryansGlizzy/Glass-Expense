/**
 * GlassExpense end-to-end encryption core (format version 2).
 *
 * Pure WebCrypto + bip39: runs unchanged in browsers, Node >= 20 and test runners.
 * Nothing here talks to the network. The server only ever receives ciphertext, public keys and an
 * *authentication* key that is cryptographically independent of the key that protects your data.
 *
 * Key hierarchy
 * -------------
 *   password ──PBKDF2-SHA256(600k, per-user salt)──► root
 *     root ──HKDF "auth/v2"──► authKey   (sent to the server in place of the password)
 *     root ──HKDF "wrap/v2"──► wrapKey   (never leaves the device; wraps the master key)
 *   12-word recovery phrase ──BIP39 seed[0..32]──► masterKey (MK)       [unchanged from v1]
 *     MK  ─AES-GCM─► wraps: ECDH private key, calendar key, per-job keys (creator copy)
 *     MK  ──HKDF "user-data/v2"──► UDK  (encrypts personal blobs: tags, tax profile, W-2s, ...)
 *   ECDH P-256 key pair (per user) ──► wraps a job key for each invited member
 *   Calendar key (random 32 bytes)  ──► encrypts job titles for calendar sync / API-key callers
 */
import * as bip39 from 'bip39';

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export const KDF_VERSION = 2;
export const KDF_ITERATIONS = 600_000;
export const ENVELOPE_PREFIX = 'v2.';

// ── Encoding helpers ─────────────────────────────────────────────────────────
export const toB64 = (bytes: Uint8Array): string => {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
};
export const fromB64 = (b64: string): Uint8Array => {
  const normalised = b64.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalised);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};
export const toB64Url = (bytes: Uint8Array): string => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export const randomBytes = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const utf8 = (s: string): Uint8Array => te.encode(s);

// ── Primitives ───────────────────────────────────────────────────────────────
export const sha256 = async (data: Uint8Array | string): Promise<Uint8Array> =>
  new Uint8Array(await subtle().digest('SHA-256', typeof data === 'string' ? te.encode(data) : data));

export async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await subtle().importKey('raw', te.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256));
}

export async function hkdf(ikm: Uint8Array, info: string, length = 32): Promise<Uint8Array> {
  const material = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(info) }, material, length * 8));
}

export const aesKey = (raw: Uint8Array): Promise<CryptoKey> =>
  subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/** AES-256-GCM. Output layout: 12-byte random IV || ciphertext+tag. */
export async function seal(key: CryptoKey, plaintext: Uint8Array, aad?: string): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const params: AesGcmParams = { name: 'AES-GCM', iv, ...(aad ? { additionalData: te.encode(aad) } : {}) };
  const ct = new Uint8Array(await subtle().encrypt(params, key, plaintext));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export async function open(key: CryptoKey, data: Uint8Array, aad?: string): Promise<Uint8Array> {
  if (data.length < 28) throw new Error('Ciphertext too short');
  const params: AesGcmParams = { name: 'AES-GCM', iv: data.subarray(0, 12), ...(aad ? { additionalData: te.encode(aad) } : {}) };
  return new Uint8Array(await subtle().decrypt(params, key, data.subarray(12)));
}

// ── JSON envelopes ("v2.<base64(iv||ciphertext)>") ───────────────────────────
// `aad` binds a ciphertext to its record (e.g. "expense|<jobId>|<expenseId>") so the server cannot
// swap blobs between records or users without detection.
const keyCache = new Map<string, Promise<CryptoKey>>();
export const cachedAesKey = (raw: Uint8Array): Promise<CryptoKey> => {
  const id = toB64(raw);
  let k = keyCache.get(id);
  if (!k) { k = aesKey(raw); keyCache.set(id, k); }
  return k;
};
export const clearKeyCache = () => keyCache.clear();

export async function encryptJson(rawKey: Uint8Array | CryptoKey, value: unknown, aad: string): Promise<string> {
  const key = rawKey instanceof Uint8Array ? await cachedAesKey(rawKey) : rawKey;
  return ENVELOPE_PREFIX + toB64(await seal(key, te.encode(JSON.stringify(value)), aad));
}

export async function decryptJson<T = any>(rawKey: Uint8Array | CryptoKey, envelope: string, aad: string): Promise<T> {
  if (typeof envelope !== 'string' || !envelope.startsWith(ENVELOPE_PREFIX)) throw new Error('Not a v2 envelope');
  const key = rawKey instanceof Uint8Array ? await cachedAesKey(rawKey) : rawKey;
  return JSON.parse(td.decode(await open(key, fromB64(envelope.slice(ENVELOPE_PREFIX.length)), aad)));
}

export const aad = {
  job: (jobId: string) => `job|${jobId}`,
  expense: (jobId: string, id: string) => `expense|${jobId}|${id}`,
  wishlist: (jobId: string, id: string) => `wishlist|${jobId}|${id}`,
  invoice: (jobId: string, id: string) => `invoice|${jobId}|${id}`,
  subscription: (jobId: string, id: string) => `subscription|${jobId}|${id}`,
  blob: (userId: string, name: string) => `blob|${userId}|${name}`,
  calendarTitle: (jobId: string) => `calendar-title|${jobId}`,
  jobShare: (jobId: string) => `job-share|${jobId}`,
  agentInbox: (jobId: string) => `agent-inbox|${jobId}`,
};

// ── Accounts: password → (authKey, wrapKey) ──────────────────────────────────
export interface Credentials { authKey: string; wrapKey: CryptoKey }

export async function deriveCredentials(password: string, saltB64: string, iterations: number): Promise<Credentials> {
  const root = await pbkdf2(password, fromB64(saltB64), iterations);
  return {
    authKey: toB64Url(await hkdf(root, 'glassexpense/auth/v2')),
    wrapKey: await aesKey(await hkdf(root, 'glassexpense/wrap/v2')),
  };
}

export const newKdfSalt = (): string => toB64(randomBytes(16));

// ── Recovery phrase / master key ─────────────────────────────────────────────
export const generateMnemonic = (): string => bip39.generateMnemonic(128);
export const isValidMnemonic = (m: string): boolean => bip39.validateMnemonic(m.trim().toLowerCase().replace(/\s+/g, ' '));
export async function mnemonicToMasterKey(mnemonic: string): Promise<Uint8Array> {
  const seed = await bip39.mnemonicToSeed(mnemonic.trim().toLowerCase().replace(/\s+/g, ' '));
  return new Uint8Array(seed.subarray(0, 32));
}

// ── Key bundle (what the server stores for a user) ───────────────────────────
export interface KeyBundle {
  master_key_encrypted: string;      // MK sealed under wrapKey
  public_key: string;                // ECDH P-256, SPKI, base64
  private_key_encrypted: string;     // ECDH private key (PKCS8) sealed under MK
  calendar_key_encrypted: string;    // calendar key sealed under MK
  key_check: string;                 // SHA-256(HKDF(MK,"key-check/v2")): proves knowledge of MK without revealing it
}

export interface UnlockedKeys {
  masterKey: Uint8Array;
  mk: CryptoKey;                     // MK as AES-GCM key (wraps job keys, private key, calendar key)
  udk: CryptoKey;                    // user-data key (personal encrypted blobs)
  publicKey: string;                 // SPKI base64
  privateKeyPkcs8: Uint8Array;
  calendarKey: Uint8Array;
}

export const keyCheckOf = async (masterKey: Uint8Array): Promise<string> =>
  toB64(await sha256(await hkdf(masterKey, 'glassexpense/key-check/v2')));

export async function generateKeyPair(): Promise<{ publicKey: string; privateKeyPkcs8: Uint8Array }> {
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    publicKey: toB64(new Uint8Array(await subtle().exportKey('spki', pair.publicKey))),
    privateKeyPkcs8: new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey)),
  };
}

export async function sessionFromMasterKey(masterKey: Uint8Array, bundle?: Partial<KeyBundle>): Promise<UnlockedKeys> {
  const mk = await aesKey(masterKey);
  const udk = await aesKey(await hkdf(masterKey, 'glassexpense/user-data/v2'));
  if (!bundle?.private_key_encrypted || !bundle.calendar_key_encrypted || !bundle.public_key) {
    throw new Error('Key bundle is incomplete');
  }
  return {
    masterKey, mk, udk,
    publicKey: bundle.public_key,
    privateKeyPkcs8: await open(mk, fromB64(bundle.private_key_encrypted), 'private-key'),
    calendarKey: await open(mk, fromB64(bundle.calendar_key_encrypted), 'calendar-key'),
  };
}

/** Builds a fresh key bundle for a (new or upgrading) account. */
export async function createBundle(masterKey: Uint8Array, wrapKey: CryptoKey, existing?: { keyPair?: { publicKey: string; privateKeyPkcs8: Uint8Array }; calendarKey?: Uint8Array }): Promise<{ bundle: KeyBundle; keys: UnlockedKeys }> {
  const mk = await aesKey(masterKey);
  const pair = existing?.keyPair ?? await generateKeyPair();
  const calendarKey = existing?.calendarKey ?? randomBytes(32);
  const bundle: KeyBundle = {
    master_key_encrypted: toB64(await seal(wrapKey, masterKey, 'master-key')),
    public_key: pair.publicKey,
    private_key_encrypted: toB64(await seal(mk, pair.privateKeyPkcs8, 'private-key')),
    calendar_key_encrypted: toB64(await seal(mk, calendarKey, 'calendar-key')),
    key_check: await keyCheckOf(masterKey),
  };
  return { bundle, keys: await sessionFromMasterKey(masterKey, bundle) };
}

/** Password login: unwrap MK with the password-derived wrapKey, then everything else with MK. */
export async function unlockBundle(bundle: KeyBundle, wrapKey: CryptoKey): Promise<UnlockedKeys> {
  const masterKey = await open(wrapKey, fromB64(bundle.master_key_encrypted), 'master-key');
  return sessionFromMasterKey(masterKey, bundle);
}

export const rewrapMasterKey = async (masterKey: Uint8Array, wrapKey: CryptoKey): Promise<string> =>
  toB64(await seal(wrapKey, masterKey, 'master-key'));

// ── Job keys ─────────────────────────────────────────────────────────────────
export const generateJobKey = (): Uint8Array => randomBytes(32);

/** Creator/self copy: sealed under MK (format identical to v1 job-key wrapping, so existing rows stay valid). */
export const wrapJobKeyForSelf = async (mk: CryptoKey, jobKey: Uint8Array): Promise<string> => toB64(await seal(mk, jobKey));
export const unwrapJobKeyForSelf = async (mk: CryptoKey, wrapped: string): Promise<Uint8Array> => open(mk, fromB64(wrapped));

async function shareKey(privateKeyPkcs8: Uint8Array, otherPublicSpki: string, jobId: string): Promise<CryptoKey> {
  const priv = await subtle().importKey('pkcs8', privateKeyPkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = await subtle().importKey('spki', fromB64(otherPublicSpki), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: pub }, priv, 256));
  return aesKey(await hkdf(shared, `glassexpense/job-share/v2|${jobId}`));
}

/** Wraps a job key for another user (invite approval). Only the two key holders can derive the wrapping key. */
export async function wrapJobKeyForMember(senderPrivatePkcs8: Uint8Array, recipientPublicSpki: string, jobId: string, jobKey: Uint8Array): Promise<string> {
  return toB64(await seal(await shareKey(senderPrivatePkcs8, recipientPublicSpki, jobId), jobKey, aad.jobShare(jobId)));
}
export async function unwrapJobKeyFromMember(myPrivatePkcs8: Uint8Array, senderPublicSpki: string, jobId: string, wrapped: string): Promise<Uint8Array> {
  return open(await shareKey(myPrivatePkcs8, senderPublicSpki, jobId), fromB64(wrapped), aad.jobShare(jobId));
}

/** Human-comparable fingerprint of a public key, shown when approving an invitee (guards against key substitution). */
export async function fingerprint(publicKeySpki: string): Promise<string> {
  const hex = toHex((await sha256(fromB64(publicKeySpki))).subarray(0, 10)).toUpperCase();
  return hex.match(/.{1,4}/g)!.join('-');
}

// ── Agent inbox (jobs created through an API key with agent access) ──────────
// The server creates the job and seals its key under this per-API-key inbox key. Derived from the master key, so the browser can always
// recompute it (even after the API key is deleted), open the job key and re-seal it under the master key.
export const agentInboxKey = (masterKey: Uint8Array, apiKeyId: string): Promise<Uint8Array> =>
  hkdf(masterKey, `glassexpense/agent-inbox/v2|${apiKeyId}`);
export async function unwrapAgentInboxJobKey(inbox: Uint8Array, jobId: string, wrapped: string): Promise<Uint8Array> {
  return open(await aesKey(inbox), fromB64(wrapped), aad.agentInbox(jobId));
}

// ── Calendar key (job titles for API-key callers and opt-in Google sync) ─────
export const encryptCalendarTitle = (calendarKey: Uint8Array, jobId: string, title: string): Promise<string> =>
  encryptJson(calendarKey, title, aad.calendarTitle(jobId));
export const decryptCalendarTitle = (calendarKey: Uint8Array, jobId: string, envelope: string): Promise<string> =>
  decryptJson<string>(calendarKey, envelope, aad.calendarTitle(jobId));

/**
 * API keys.  Printed key = `ge_<authPart>.<decryptPart>`.
 *   - `ge_<authPart>` goes in the `x-api-key` header (the server stores only its SHA-256).
 *   - `<decryptPart>` NEVER goes to the server: the caller uses it locally to unwrap the calendar key.
 */
export async function createApiKeySecrets(calendarKey: Uint8Array): Promise<{ fullKey: string; headerKey: string; keyHash: string; wrappedCalendarKey: string }> {
  const authPart = toB64Url(randomBytes(24));
  const decryptPart = toB64Url(randomBytes(32));
  const wrapKey = await aesKey(await hkdf(fromB64(decryptPart), 'glassexpense/apikey-calendar/v2'));
  return {
    fullKey: `ge_${authPart}.${decryptPart}`,
    headerKey: `ge_${authPart}`,
    keyHash: toHex(await sha256(`ge_${authPart}`)),
    wrappedCalendarKey: ENVELOPE_PREFIX + toB64(await seal(wrapKey, calendarKey, 'apikey-calendar')),
  };
}

/** Reference implementation for API-key callers: recover the calendar key from the wrapped copy + decrypt part. */
export async function unwrapCalendarKeyWithApiKey(wrappedCalendarKey: string, decryptPart: string): Promise<Uint8Array> {
  const wrapKey = await aesKey(await hkdf(fromB64(decryptPart), 'glassexpense/apikey-calendar/v2'));
  return open(wrapKey, fromB64(wrappedCalendarKey.slice(ENVELOPE_PREFIX.length)), 'apikey-calendar');
}
