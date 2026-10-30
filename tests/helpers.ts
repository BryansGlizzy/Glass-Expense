import * as C from '../src/e2ee/crypto.ts';

export const BASE = process.env.TEST_BASE || 'http://localhost:3930';
export const ITER = 1000; // server must run with KDF_MIN_ITERATIONS<=1000 for tests

export async function call(method: string, path: string, opts: { token?: string; body?: any; form?: FormData; apiKey?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.apiKey) headers['x-api-key'] = opts.apiKey;
  let body: any;
  if (opts.form) body = opts.form; else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(BASE + path, { method, headers, body });
  const raw = await res.arrayBuffer();
  let json: any = null; try { json = JSON.parse(new TextDecoder().decode(raw)); } catch {}
  return { status: res.status, json, headers: res.headers, bytes: new Uint8Array(raw) };
}

export interface TestUser { username: string; email: string; password: string; token: string; id: string; keys: C.UnlockedKeys; mnemonic: string; authKey: string; salt: string }

export async function registerUser(username: string, password = 'a-very-long-test-passphrase'): Promise<TestUser> {
  const email = `${username}@example.com`;
  const salt = C.newKdfSalt();
  const creds = await C.deriveCredentials(password, salt, ITER);
  const mnemonic = C.generateMnemonic();
  const { bundle, keys } = await C.createBundle(await C.mnemonicToMasterKey(mnemonic), creds.wrapKey);
  const r = await call('POST', '/api/auth/register', { body: { username, email, auth_key: creds.authKey, kdf_salt: salt, kdf_iterations: ITER, ...bundle } });
  if (r.status !== 200) throw new Error(`register ${username}: ${r.status} ${JSON.stringify(r.json)}`);
  return { username, email, password, token: r.json.token, id: r.json.user.id, keys, mnemonic, authKey: creds.authKey, salt };
}

export async function login(username: string, password: string) {
  const p = await call('POST', '/api/auth/params', { body: { identifier: username } });
  const creds = await C.deriveCredentials(password, p.json.kdf_salt, p.json.kdf_iterations);
  const r = await call('POST', '/api/auth/login', { body: { identifier: username, auth_key: creds.authKey } });
  return { ...r, creds, params: p.json };
}

export const uuid = () => crypto.randomUUID();
