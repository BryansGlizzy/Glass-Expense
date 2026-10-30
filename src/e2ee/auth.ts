/**
 * Account flows: register, login (v2 + legacy upgrade), unlock, password change, password reset.
 * The password is only ever used here, in the browser, to derive two independent keys:
 *   authKey  → sent to the server as the login credential
 *   wrapKey  → stays on the device and unwraps the master key
 */
import * as C from './crypto';
import { rawFetch, setSession, updateToken, getSession, HttpError } from './session';
import { derivePasswordKey, unwrapKey, base64ToArrayBuffer } from '../utils/crypto';

const jsonCall = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await rawFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new HttpError(res.status, data?.error || `Request failed (${res.status})`, data);
  return data;
};

export const MIN_PASSWORD_LENGTH = 12;
/** Client-side password policy: the server never sees passwords, so this is where it must be enforced. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 128) return 'Use at most 128 characters.';
  if (/^(.)\1+$/.test(password)) return 'Choose a less repetitive password.';
  if (new Set(password.toLowerCase()).size < 5) return 'Choose a password with more variety.';
  return null;
}

export interface AuthOutcome { token: string; user: any; masterKeyB64: string; keys: C.UnlockedKeys }

const activate = (token: string, user: any, keys: C.UnlockedKeys): AuthOutcome => {
  setSession({ token, userId: user.id, username: user.username, keys });
  return { token, user, keys, masterKeyB64: C.toB64(keys.masterKey) };
};

// ── Register ─────────────────────────────────────────────────────────────────
export async function register(p: { username: string; email: string; password: string; mnemonic: string }): Promise<AuthOutcome> {
  const problem = passwordProblem(p.password);
  if (problem) throw new Error(problem);
  const salt = C.newKdfSalt();
  const creds = await C.deriveCredentials(p.password, salt, C.KDF_ITERATIONS);
  const { bundle, keys } = await C.createBundle(await C.mnemonicToMasterKey(p.mnemonic), creds.wrapKey);
  const data = await jsonCall('POST', '/api/auth/register', {
    username: p.username, email: p.email, auth_key: creds.authKey, kdf_salt: salt, kdf_iterations: C.KDF_ITERATIONS, ...bundle,
  });
  return activate(data.token, data.user, keys);
}

// ── Login ────────────────────────────────────────────────────────────────────
export interface LegacyLogin {
  legacy: true; token: string; user: any; password: string;
  masterKey: Uint8Array | null;       // null if the old vault could not be opened with this password
  newMnemonic: string | null;         // set when the account never had a recovery phrase; the UI must show it
}
export type LoginOutcome = ({ legacy: false } & AuthOutcome) | LegacyLogin;

export async function loginWithPassword(identifier: string, password: string): Promise<LoginOutcome> {
  const params = await jsonCall('POST', '/api/auth/params', { identifier });
  if (params.kdf_version === 2) {
    const creds = await C.deriveCredentials(password, params.kdf_salt, params.kdf_iterations);
    const data = await jsonCall('POST', '/api/auth/login', { identifier, auth_key: creds.authKey });
    let keys: C.UnlockedKeys;
    try { keys = await C.unlockBundle(data.user, creds.wrapKey); }
    catch { throw new Error('Signed in, but your vault could not be unlocked. Use the recovery phrase via "Forgot password".'); }
    return { legacy: false, ...activate(data.token, data.user, keys) };
  }

  // Legacy account: the old protocol sends the password once more; it is upgraded straight after.
  const data = await jsonCall('POST', '/api/auth/login', { username: identifier, password });
  let masterKey: Uint8Array | null = null;
  let newMnemonic: string | null = null;
  if (data.user.master_key_encrypted) {
    try {
      const wrapping = await derivePasswordKey(password, data.user.email || data.user.username);
      masterKey = new Uint8Array(base64ToArrayBuffer(await unwrapKey(data.user.master_key_encrypted, wrapping)));
    } catch { masterKey = null; }
  } else {
    newMnemonic = C.generateMnemonic();
    masterKey = await C.mnemonicToMasterKey(newMnemonic);
  }
  return { legacy: true, token: data.token, user: data.user, password, masterKey, newMnemonic };
}

/** Replaces a legacy account's password-based protocol with the v2 key bundle. Must be followed by migrateLegacyData(). */
export async function upgradeLegacyAccount(l: LegacyLogin): Promise<AuthOutcome> {
  if (!l.masterKey) throw new Error('Your existing vault could not be opened, so it cannot be upgraded automatically.');
  const salt = C.newKdfSalt();
  const creds = await C.deriveCredentials(l.password, salt, C.KDF_ITERATIONS);
  const { bundle, keys } = await C.createBundle(l.masterKey, creds.wrapKey);
  const data = await jsonCall('POST', '/api/auth/upgrade', {
    current_password: l.password, auth_key: creds.authKey, kdf_salt: salt, kdf_iterations: C.KDF_ITERATIONS, ...bundle,
  }, l.token);
  return activate(data.token, data.user, keys);
}

// ── Unlock an existing session (new tab / reload) ────────────────────────────
export async function restoreSession(token: string, user: any, masterKeyB64: string): Promise<boolean> {
  try {
    if (!user.public_key) return false; // legacy account that hasn't been upgraded yet
    setSession({ token, userId: user.id, username: user.username, keys: await C.sessionFromMasterKey(C.fromB64(masterKeyB64), user) });
    return true;
  } catch { return false; }
}

export async function unlockVault(token: string, user: any, password: string): Promise<AuthOutcome> {
  const params = await jsonCall('POST', '/api/auth/params', { identifier: user.username });
  const creds = await C.deriveCredentials(password, params.kdf_salt, params.kdf_iterations);
  let keys: C.UnlockedKeys;
  try { keys = await C.unlockBundle(user, creds.wrapKey); } catch { throw new Error('Incorrect password.'); }
  return activate(token, user, keys);
}

// ── Change password (vault contents stay as they are; only the wrapping changes) ─
export async function changePassword(currentPassword: string, newPassword: string): Promise<string> {
  const problem = passwordProblem(newPassword);
  if (problem) throw new Error(problem);
  const s = getSession();
  const params = await jsonCall('POST', '/api/auth/params', { identifier: s.username });
  const current = await C.deriveCredentials(currentPassword, params.kdf_salt, params.kdf_iterations);
  const salt = C.newKdfSalt();
  const next = await C.deriveCredentials(newPassword, salt, C.KDF_ITERATIONS);
  const data = await jsonCall('PATCH', '/api/auth/me/password', {
    current_auth_key: current.authKey, auth_key: next.authKey, kdf_salt: salt, kdf_iterations: C.KDF_ITERATIONS,
    master_key_encrypted: await C.rewrapMasterKey(s.keys.masterKey, next.wrapKey),
  }, s.token);
  updateToken(data.token);
  return data.token;
}

// ── Forgot-password completion: needs the e-mailed token AND the recovery phrase ─
export async function resetPassword(p: { token: string; email: string; newPassword: string; mnemonic: string }): Promise<void> {
  const problem = passwordProblem(p.newPassword);
  if (problem) throw new Error(problem);
  if (!C.isValidMnemonic(p.mnemonic)) throw new Error('That recovery phrase is not valid. Check the 12 words.');
  const masterKey = await C.mnemonicToMasterKey(p.mnemonic);
  const salt = C.newKdfSalt();
  const creds = await C.deriveCredentials(p.newPassword, salt, C.KDF_ITERATIONS);
  const params = await jsonCall('POST', '/api/auth/params', { identifier: p.email });
  const body: any = {
    token: p.token, auth_key: creds.authKey, kdf_salt: salt, kdf_iterations: C.KDF_ITERATIONS,
    master_key_encrypted: await C.rewrapMasterKey(masterKey, creds.wrapKey), key_check: await C.keyCheckOf(masterKey),
  };
  if (params.kdf_version !== 2) Object.assign(body, (await C.createBundle(masterKey, creds.wrapKey)).bundle); // legacy account: also creates its key pair
  await jsonCall('POST', '/api/auth/reset-password', body);
}
