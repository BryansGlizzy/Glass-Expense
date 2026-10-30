import db from './db.js';
import { isAdminRow } from './middleware.js';
import { ValidationError, str } from './security.js';
import { KDF_MIN_ITERATIONS } from './config.js';

export const isInstanceUnlocked = () => {
  const { count } = db.prepare("SELECT COUNT(*) as count FROM license_keys WHERE status = 'active'").get() as any;
  return count > 0;
};

/** Everything a client needs to unlock its vault after authenticating. Contains only ciphertext and public keys. */
export const publicUser = (u: any) => ({
  id: u.id,
  username: u.username,
  email: u.email ?? null,
  isAdmin: isAdminRow(u),
  plan: u.plan,
  e2ee_version: u.e2ee_version ?? 1,
  kdf_version: u.kdf_version ?? 1,
  kdf_salt: u.kdf_salt ?? null,
  kdf_iterations: u.kdf_iterations ?? null,
  master_key_encrypted: u.master_key_encrypted ?? null,
  public_key: u.public_key ?? null,
  private_key_encrypted: u.private_key_encrypted ?? null,
  calendar_key_encrypted: u.calendar_key_encrypted ?? null,
  server_calendar_sync: Boolean(u.server_calendar_key),
});

const B64 = /^[A-Za-z0-9+/_=-]+$/;
const b64 = (v: unknown, field: string, min: number, max: number): string => {
  const s = str(v, field, { required: true, max });
  if (!s || s.length < min || !B64.test(s)) throw new ValidationError(`${field} is malformed`);
  return s;
};

export const readAuthKey = (v: unknown, field = 'auth_key'): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(v)) throw new ValidationError(`${field} is malformed`);
  return v;
};

export const readKdf = (body: any) => {
  const salt = b64(body?.kdf_salt, 'kdf_salt', 16, 64);
  const iterations = Number(body?.kdf_iterations);
  if (!Number.isInteger(iterations) || iterations < KDF_MIN_ITERATIONS || iterations > 10_000_000) {
    throw new ValidationError(`kdf_iterations must be an integer >= ${KDF_MIN_ITERATIONS}`);
  }
  return { salt, iterations };
};

export const readBundle = (body: any) => ({
  master_key_encrypted: b64(body?.master_key_encrypted, 'master_key_encrypted', 40, 512),
  public_key: b64(body?.public_key, 'public_key', 100, 256),
  private_key_encrypted: b64(body?.private_key_encrypted, 'private_key_encrypted', 100, 1024),
  calendar_key_encrypted: b64(body?.calendar_key_encrypted, 'calendar_key_encrypted', 40, 512),
  key_check: b64(body?.key_check, 'key_check', 40, 64),
});

export const readMasterKeyEnc = (body: any): string => b64(body?.master_key_encrypted, 'master_key_encrypted', 40, 512);
