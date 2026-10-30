import rateLimit from 'express-rate-limit';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import db from './db.js';
import { JWT_SECRET, JWT_EXPIRES_IN, UPLOADS_DIR } from './config.js';
import { sha256, ValidationError } from './security.js';

// ── Rate limiting ───────────────────────────────────────────────────────────
// RATE_LIMIT_MULTIPLIER scales every limit (default 1). Only automated tests raise it; keep it at 1 in production.
const RATE_LIMIT_MULTIPLIER = Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER) || 1);
const limiter = (windowMs: number, limit: number, message: string) => rateLimit({
  windowMs, limit: limit * RATE_LIMIT_MULTIPLIER, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message },
});
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const apiLimiter = limiter(MIN, 600, 'Too many requests. Please slow down.');
export const loginLimiter = limiter(15 * MIN, 30, 'Too many login attempts. Try again later.');
export const registerLimiter = limiter(HOUR, 10, 'Too many registrations from this address. Try again later.');
export const resetLimiter = limiter(HOUR, 10, 'Too many password reset attempts. Try again later.');
export const forgotLimiter = limiter(HOUR, 5, 'Too many password reset requests. Try again later.');
export const licenseLimiter = limiter(HOUR, 20, 'Too many license attempts. Try again later.');
export const mailLimiter = limiter(HOUR, 5, 'Too many email requests. Try again later.');
export const aiLimiter = limiter(HOUR, 60, 'Too many AI requests. Try again later.');

// Per-account lockout (in addition to the per-IP limiter) to blunt credential stuffing / brute force.
export const LOGIN_MAX_FAILURES = 8;
export const LOGIN_LOCK_MS = 15 * MIN;
export const loginFailures = new Map<string, { count: number; lockedUntil: number }>();
export const loginKey = (identifier: string) => identifier.trim().toLowerCase();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginFailures) if (v.lockedUntil < now && now - v.lockedUntil > LOGIN_LOCK_MS) loginFailures.delete(k);
}, 10 * MIN).unref();

// ── Sessions ────────────────────────────────────────────────────────────────
export const isAdminRow = (row: any) => row?.is_admin === 1;

export const signSession = (user: { id: string; username: string; email?: string | null; token_version?: number | null }) =>
  jwt.sign(
    { id: user.id, username: user.username, email: user.email ?? null, tv: user.token_version ?? 0 },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions
  );

/** Verifies a session JWT and loads the user. Returns null for invalid/expired/revoked tokens. */
export const verifySessionToken = (token: unknown): any | null => {
  if (typeof token !== 'string' || !token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as any;
    const dbUser = db.prepare('SELECT id, username, email, plan, is_admin, token_version, e2ee_version, kdf_version FROM users WHERE id = ?').get(payload.id) as any;
    if (!dbUser) return null;
    if ((payload.tv ?? 0) !== (dbUser.token_version ?? 0)) return null; // revoked by password change/reset
    return dbUser;
  } catch {
    return null;
  }
};

/** Marks a route as callable with an API key. Everything else rejects API keys. */
export const allowApiKey = (req: any, _res: any, next: any) => { req.allowApiKey = true; next(); };

// Authentication middleware: JWT session, or (only on routes marked with allowApiKey) a scoped API key.
export const authenticateToken = (req: any, res: any, next: any) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    if (!req.allowApiKey) {
      return res.status(403).json({ error: 'API keys can only be used with GET /api/calendar/schedule and (for keys with agent access enabled) /api/agent/v1/*. Use an interactive session for everything else.' });
    }
    if (typeof apiKey !== 'string' || apiKey.includes('.') || !/^ge_[A-Za-z0-9_-]{16,128}$/.test(apiKey)) {
      return res.status(400).json({
        error: 'Malformed API key. Send only the part before the "." in the x-api-key header. The part after the "." is a private decryption secret and must never be sent to the server; if you sent it, revoke this key and create a new one.',
      });
    }
    const keyRecord = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(sha256(apiKey)) as any;
    if (!keyRecord) return res.status(401).json({ error: 'Invalid API key' });

    const user = db.prepare('SELECT id, username, email, plan, is_admin FROM users WHERE id = ?').get(keyRecord.user_id) as any;
    if (!user) return res.status(401).json({ error: 'API key user not found' });

    db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(keyRecord.id);
    req.user = { id: user.id, username: user.username, email: user.email, plan: user.plan, isAdmin: false };
    req.authMethod = 'apikey';
    req.apiKeyRecord = keyRecord;
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const dbUser = verifySessionToken(token);
  if (!dbUser) return res.status(401).json({ error: 'Invalid or expired session' });

  req.user = { id: dbUser.id, username: dbUser.username, email: dbUser.email, plan: dbUser.plan, isAdmin: isAdminRow(dbUser), e2eeVersion: dbUser.e2ee_version ?? 1 };
  req.authMethod = 'session';
  next();
};

/** Sensitive actions require an interactive session, never an API key. */
export const requireSession = (req: any, res: any, next: any) => {
  if (req.authMethod !== 'session') {
    return res.status(403).json({ error: 'This action requires an interactive login session (API keys are not accepted).' });
  }
  next();
};

export const requireAdmin = (req: any, res: any, next: any) => {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
};

// ── Authorization helpers ───────────────────────────────────────────────────
export const getJobAccess = (jobId: unknown, userId: string): { job: any; isOwner: boolean } | null => {
  if (typeof jobId !== 'string' || !jobId) return null;
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
  if (!job) return null;
  if (job.created_by === userId) return { job, isOwner: true };
  // Only ACTIVE members (those whose job key the owner has wrapped for them) may read or write job data.
  const member = db.prepare("SELECT 1 FROM job_users WHERE job_id = ? AND user_id = ? AND COALESCE(status, 'active') = 'active'").get(jobId, userId);
  return member ? { job, isOwner: false } : null;
};

/** Requires the caller to be the creator or an active member of the job in `:jobId` (or `:id`). 404 hides existence. */
export const requireJobAccess = (req: any, res: any, next: any) => {
  const access = getJobAccess(req.params.jobId ?? req.params.id, req.user.id);
  if (!access) return res.status(404).json({ error: 'Job not found' });
  req.job = access.job;
  req.isJobOwner = access.isOwner;
  next();
};

export const requireJobOwner = (req: any, res: any, next: any) => {
  if (!req.isJobOwner) return res.status(403).json({ error: 'Only the job owner can do this' });
  next();
};

// ── SaaS plan limits (populated by the SaaS module when MODE=saas) ───────────
export const saas: { limits: any } = { limits: null };
const hook = (name: string) => (req: any, res: any, next: any) =>
  saas.limits && saas.limits[name] ? saas.limits[name](req, res, next) : next();
export const enforceJobLimits = hook('enforceJobLimits');
export const enforceArchiveLimits = hook('enforceArchiveLimits');
export const enforceAiLimits = hook('enforceAiLimits');
export const enforceKeyLimits = hook('enforceKeyLimits');
export const enforceJoinLimits = hook('enforceJoinLimits');
export const enforceMemberLimits = hook('enforceMemberLimits');

// ── Uploads ─────────────────────────────────────────────────────────────────
// Receipts are encrypted in the browser, so the server only ever accepts opaque binary blobs: no image/PDF
// parsing, no content sniffing, no previews. Filenames are random; the client's filename is ignored.
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.bin`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 30, fieldSize: 100 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/octet-stream') return cb(null, true);
    cb(new ValidationError('Receipts must be encrypted in the client and uploaded as application/octet-stream.'));
  },
});

// Cloud OCR uploads (opt-in, bring-your-own provider) live in the OS temp dir and are always deleted afterwards.
export const ocrUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `glassexpense-ocr-${crypto.randomBytes(12).toString('hex')}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10, fieldSize: 100 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.mimetype) || file.mimetype === 'application/pdf') return cb(null, true);
    cb(new ValidationError('Unsupported file type. Upload an image or PDF.'));
  },
});

export const receiptPath = (receiptUrl: string) => path.join(UPLOADS_DIR, path.basename(receiptUrl));
export const removeReceiptFile = (receiptUrl?: string | null) => {
  if (!receiptUrl) return;
  try { fs.unlinkSync(receiptPath(receiptUrl)); } catch { /* already gone */ }
};
export const removeTempFile = (filePath?: string) => {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* already gone */ }
};

export const touchJob = (jobId: string) => {
  try {
    db.prepare('UPDATE jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(jobId);
  } catch (e) {
    console.error('Failed to touch job:', e);
  }
};

export const PLANS = ['free', 'pro', 'personal'] as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Ciphertext envelope accepted from clients: "v2." + base64, bounded in size. */
export const ENVELOPE_RE = /^v2\.[A-Za-z0-9+/_=-]+$/;
export const envelope = (value: unknown, field: string, maxBytes = 512 * 1024): string => {
  if (typeof value !== 'string' || !ENVELOPE_RE.test(value)) throw new ValidationError(`${field} must be an encrypted v2 envelope`);
  if (value.length > maxBytes) throw new ValidationError(`${field} is too large`);
  return value;
};
