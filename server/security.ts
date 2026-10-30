import dns from 'dns/promises';
import net from 'net';
import crypto from 'crypto';
import { ALLOW_PRIVATE_AI_URLS } from './config.js';

// ── Hashing ─────────────────────────────────────────────────────────────────
export const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

// ── Output encoding ─────────────────────────────────────────────────────────
export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// ── Input validation helpers ────────────────────────────────────────────────
export class ValidationError extends Error {
  status = 400;
}

export const str = (value: unknown, field: string, opts: { max?: number; min?: number; required?: boolean } = {}): string | null => {
  const { max = 500, min = 0, required = false } = opts;
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  if (required && trimmed.length === 0) throw new ValidationError(`${field} is required`);
  if (trimmed.length < min) throw new ValidationError(`${field} must be at least ${min} characters`);
  if (trimmed.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return trimmed;
};

export const num = (value: unknown, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): number | null => {
  const { min = -1e12, max = 1e12, required = false } = opts;
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a valid number`);
  if (n < min || n > max) throw new ValidationError(`${field} is out of range`);
  return n;
};

export const oneOf = <T extends string>(value: unknown, field: string, allowed: readonly T[], fallback?: T): T => {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
};

/** YYYY-MM-DD (also accepts a full ISO timestamp, truncated to the date). */
export const isoDate = (value: unknown, field: string): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a date string`);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m || Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`))) {
    throw new ValidationError(`${field} must be a valid YYYY-MM-DD date`);
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
};

/** Only http(s) URLs are allowed to be stored and later rendered as links/images. */
export const httpUrl = (value: unknown, field: string, max = 2000): string | null => {
  const s = str(value, field, { max });
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad scheme');
    return u.toString();
  } catch {
    throw new ValidationError(`${field} must be a valid http(s) URL`);
  }
};

export const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;
export const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

// ── SSRF guard for user-supplied outbound URLs ──────────────────────────────
const isPrivateIPv4 = (ip: string): boolean => {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
    (a === 169 && b === 254) ||             // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                                // multicast / reserved / broadcast
  );
};

const isPrivateIPv6 = (ip: string): boolean => {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff')) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
};

export const isPrivateAddress = (ip: string): boolean =>
  net.isIPv4(ip) ? isPrivateIPv4(ip) : net.isIPv6(ip) ? isPrivateIPv6(ip) : true;

/**
 * Validates a user-supplied base URL before the server fetches it.
 * - https only (http allowed only when private AI URLs are explicitly enabled)
 * - no credentials in the URL
 * - hostname must not resolve to loopback / private / link-local / metadata addresses
 * Returns the normalised URL without a trailing slash. Callers must also use `redirect: 'error'`.
 */
export const assertSafeOutboundUrl = async (raw: unknown): Promise<string> => {
  if (typeof raw !== 'string' || !raw.trim()) throw new ValidationError('A base URL is required');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ValidationError('Base URL is not a valid URL');
  }
  if (url.username || url.password) throw new ValidationError('Base URL must not contain credentials');
  if (url.protocol !== 'https:' && !(ALLOW_PRIVATE_AI_URLS && url.protocol === 'http:')) {
    throw new ValidationError('Base URL must use https');
  }

  if (!ALLOW_PRIVATE_AI_URLS) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
    if (addresses.length === 0) throw new ValidationError('Base URL host could not be resolved');
    if (addresses.some(a => isPrivateAddress(a.address))) {
      throw new ValidationError('Base URL must not point to a private or internal address');
    }
  }
  return url.toString().replace(/\/$/, '');
};
