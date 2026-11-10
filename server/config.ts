import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Central, validated runtime configuration.
 * Every other server module should import from here instead of reading process.env directly,
 * so that missing/weak secrets fail loudly at boot instead of silently degrading.
 */

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Anything that is not explicitly "development" is treated as production (safe by default).
export const IS_DEV = process.env.NODE_ENV === 'development';
export const IS_PROD = !IS_DEV;
export const IS_SAAS = process.env.MODE === 'saas';

// Runtime data (database, receipts, OTA bundles) lives OUTSIDE the web/source tree.
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT_DIR, 'data'));
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const UPDATES_DIR = path.join(DATA_DIR, 'updates');
export const DB_PATH = path.join(DATA_DIR, process.env.DB_NAME || 'data.db');

for (const dir of [DATA_DIR, UPLOADS_DIR, UPDATES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
export const PORT = Number(process.env.PORT) || 3000;
export const HOST = process.env.HOST || (IS_DEV ? '127.0.0.1' : '0.0.0.0');

// Number of reverse-proxy hops in front of the app (nginx / Cloudflare / ...). 0 = none.
// Needed so rate limiting and req.ip see the real client address.
export const TRUST_PROXY = process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : 1;

// Origins allowed to call the API cross-origin (web app + Capacitor WebViews).
export const ALLOWED_ORIGINS = Array.from(new Set([
  APP_URL,
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
  ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) : []),
  ...(IS_DEV ? ['http://localhost:3000', 'http://localhost:5173'] : []),
]));

// ── JWT secret ──────────────────────────────────────────────────────────────
const KNOWN_WEAK_SECRETS = [/super-secret/i, /^changeme/i, /^secret$/i, /^password/i, /jwt-key-for-dev/i, /^your[-_ ]/i];

const resolveJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  const problem = !secret
    ? 'JWT_SECRET is not set'
    : secret.length < 32
      ? 'JWT_SECRET is shorter than 32 characters'
      : KNOWN_WEAK_SECRETS.some(rx => rx.test(secret))
        ? 'JWT_SECRET looks like a placeholder/default value'
        : null;

  if (!problem) return secret as string;

  const hint = 'Generate one with: openssl rand -base64 64';
  if (IS_PROD) {
    console.error(`FATAL: ${problem}. ${hint}`);
    process.exit(1);
  }
  console.warn(`[dev] WARNING: ${problem}. Using an ephemeral random secret for this run (sessions reset on restart). ${hint}`);
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(48))).toString('base64');
};

export const JWT_SECRET = resolveJwtSecret();
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '14d';

// ── SMTP (optional: when unset, outbound email is skipped and logged) ───────
export const SMTP = {
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost',
  configured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
};

// ── Firebase (optional push notifications) ──────────────────────────────────
export const FIREBASE_SERVICE_ACCOUNT_PATH = path.resolve(
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.join(ROOT_DIR, 'secrets', 'firebase-adminsdk.json')
);

// AI base URLs on private networks (e.g. local Ollama) are blocked unless explicitly allowed.
export const ALLOW_PRIVATE_AI_URLS = process.env.ALLOW_PRIVATE_AI_URLS === 'true';

// Specific AI endpoints (host or host:port, comma separated, e.g. "192.168.1.50:8000,localhost:11434") that MAY use plain http and
// private addresses. Prefer this over ALLOW_PRIVATE_AI_URLS, which opens every private address to every user. Default: none.
export const AI_ALLOWED_HOSTS: string[] = (process.env.AI_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
// Longest a single AI research/draft call may run, in milliseconds (the website's old Hermes step used up to 10 minutes).
export const AI_RESEARCH_TIMEOUT_MS = Math.min(900_000, Math.max(10_000, Number(process.env.AI_RESEARCH_TIMEOUT_MS) || 600_000));
// Daily cap on invoice e-mails per user (docs/DOCUMENTATION.md §13.10). There are no tier-based limits yet (decision D14).
export const INVOICE_EMAIL_DAILY_LIMIT = Math.max(1, Number(process.env.INVOICE_EMAIL_DAILY_LIMIT) || 30);

// Content-Security-Policy mode: 'enforce' (default) or 'report-only' for first rollout.
export const CSP_REPORT_ONLY = process.env.CSP_MODE === 'report-only';

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase() || null;

// ── End-to-end encryption settings ──────────────────────────────────────────
// Minimum PBKDF2 iterations the server accepts when an account sets/changes its password.
export const KDF_MIN_ITERATIONS = Number(process.env.KDF_MIN_ITERATIONS) || 300_000;
export const KDF_DEFAULT_ITERATIONS = Number(process.env.KDF_DEFAULT_ITERATIONS) || 600_000;

// 32-byte base64 key used ONLY to hold the calendar key of users who opt in to background Google Calendar sync.
// Generate with: openssl rand -base64 32.  Without it, server-side Google sync is unavailable.
export const SERVER_WRAP_KEY = process.env.SERVER_WRAP_KEY ? Buffer.from(process.env.SERVER_WRAP_KEY, 'base64') : null;
if (SERVER_WRAP_KEY && SERVER_WRAP_KEY.length !== 32) {
  console.error('FATAL: SERVER_WRAP_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32).');
  process.exit(1);
}
