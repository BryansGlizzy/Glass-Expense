import crypto from 'crypto';
import { SERVER_WRAP_KEY } from './config.js';

/**
 * The ONLY place the server can decrypt user data, and only for users who explicitly opted in to background
 * Google Calendar sync: it holds that user's *calendar key* (never a master key or job key), sealed under
 * SERVER_WRAP_KEY, so it can read job titles to push them to Google. Disabling the option erases the key.
 */
export const serverCryptoAvailable = (): boolean => SERVER_WRAP_KEY !== null;

const GCM_TAG = 16;

export function wrapForServer(raw: Buffer, aad = 'server-calendar-key'): string {
  if (!SERVER_WRAP_KEY) throw new Error('SERVER_WRAP_KEY is not configured');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SERVER_WRAP_KEY, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(raw), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64');
}

export function unwrapForServer(b64: string, aad = 'server-calendar-key'): Buffer {
  if (!SERVER_WRAP_KEY) throw new Error('SERVER_WRAP_KEY is not configured');
  const data = Buffer.from(b64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', SERVER_WRAP_KEY, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(data.subarray(data.length - GCM_TAG));
  return Buffer.concat([decipher.update(data.subarray(12, data.length - GCM_TAG)), decipher.final()]);
}

/** Decrypts a "v2.<base64(iv||ct||tag)>" calendar-title envelope (same format the browser produces with WebCrypto). */
export function decryptCalendarTitleServer(calendarKey: Buffer, jobId: string, envelope: string): string {
  const data = Buffer.from(envelope.replace(/^v2\./, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', calendarKey, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(`calendar-title|${jobId}`));
  decipher.setAuthTag(data.subarray(data.length - GCM_TAG));
  const plain = Buffer.concat([decipher.update(data.subarray(12, data.length - GCM_TAG)), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

/** Decrypts any "v2.<base64(iv||ct||tag)>" envelope produced by the browser (Web Crypto AES-256-GCM). */
export function decryptEnvelopeServer<T = unknown>(key: Buffer, envelope: string, aad: string): T {
  const data = Buffer.from(envelope.replace(/^v2\./, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(data.subarray(data.length - GCM_TAG));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(12, data.length - GCM_TAG)), decipher.final()]).toString('utf8'));
}

/** Encrypts a JSON value into a "v2.<base64(iv||ct||tag)>" envelope that the browser (Web Crypto AES-256-GCM) can open. */
export function encryptEnvelopeServer(key: Buffer, value: unknown, aad: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), 'utf8')), cipher.final()]);
  return 'v2.' + Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64');
}

/** Raw AES-256-GCM seal (base64 of iv||ct||tag, the same layout as the browser's `seal`). Used to wrap job keys for the agent inbox. */
export function sealRawServer(key: Buffer, raw: Buffer, aad: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(raw), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64');
}
