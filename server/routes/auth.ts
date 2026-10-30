import type { Express } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { APP_URL, ADMIN_EMAIL, IS_SAAS, JWT_SECRET, KDF_DEFAULT_ITERATIONS } from '../config.js';
import { sendWelcomeEmail, sendPasswordResetEmail } from '../email.js';
import { EMAIL_RE, USERNAME_RE, ValidationError, sha256, str } from '../security.js';
import {
  authenticateToken, requireSession, signSession, loginLimiter, registerLimiter, resetLimiter, forgotLimiter,
  loginFailures, loginKey, LOGIN_MAX_FAILURES, LOGIN_LOCK_MS,
} from '../middleware.js';
import { isInstanceUnlocked, publicUser, readAuthKey, readBundle, readKdf, readMasterKeyEnc } from '../helpers.js';

// bcrypt over a 256-bit random auth key is only defence in depth; the cost factor keeps logins fast.
const BCRYPT_COST = 10;
// A real bcrypt hash used to equalise timing when a login names an unknown user.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_COST);

const fail = (res: any, err: any, label: string) => {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  console.error(`${label} error:`, err);
  return res.status(500).json({ error: 'Internal server error' });
};

const fakeSalt = (identifier: string) =>
  crypto.createHmac('sha256', JWT_SECRET).update(`kdf-salt|${identifier.trim().toLowerCase()}`).digest().subarray(0, 16).toString('base64');

export function registerAuthRoutes(app: Express) {
  /**
   * Step 1 of login: the client needs the user's KDF parameters (salt, iterations) to derive its keys.
   * Unknown identifiers get a deterministic fake salt so this endpoint doesn't reveal which accounts exist.
   */
  app.post('/api/auth/params', loginLimiter, (req: any, res) => {
    const identifier = req.body?.identifier;
    if (typeof identifier !== 'string' || !identifier || identifier.length > 254) return res.status(400).json({ error: 'identifier required' });
    const user = db.prepare('SELECT kdf_version, kdf_salt, kdf_iterations FROM users WHERE username = ? OR email = ?').get(identifier, identifier) as any;
    if (user && (user.kdf_version ?? 1) < 2) return res.json({ kdf_version: 1 });
    res.json({
      kdf_version: 2,
      kdf_salt: user?.kdf_salt ?? fakeSalt(identifier),
      kdf_iterations: user?.kdf_iterations ?? KDF_DEFAULT_ITERATIONS,
    });
  });

  app.post('/api/auth/register', registerLimiter, async (req: any, res: any) => {
    try {
      const b = req.body ?? {};
      const username = str(b.username, 'Username', { required: true, max: 32 })!;
      if (!USERNAME_RE.test(username)) throw new ValidationError('Username must be 3-32 characters: letters, numbers, dot, underscore or dash');
      const email = str(b.email, 'Email', { required: true, max: 254 })!;
      if (!EMAIL_RE.test(email)) throw new ValidationError('Email address is not valid');
      const authKey = readAuthKey(b.auth_key);
      const kdf = readKdf(b);
      const bundle = readBundle(b);

      const { count } = db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
      if (count > 0 && process.env.DISABLE_REGISTRATION === 'true') {
        return res.status(403).json({ error: 'Registration is currently disabled.' });
      }
      if (!IS_SAAS && count > 0 && !isInstanceUnlocked()) {
        return res.status(403).json({ error: 'Personal edition is limited to a single user. Please activate a license to unlock multi-user support.' });
      }
      // The configured admin address is reserved: only the very first account may use it.
      if (count > 0 && ADMIN_EMAIL && email.toLowerCase() === ADMIN_EMAIL) {
        return res.status(400).json({ error: 'This email address is reserved.' });
      }
      if (db.prepare('SELECT 1 FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)').get(email, username)) {
        return res.status(400).json({ error: 'Username or email already exists' });
      }

      const isFirstUser = count === 0;
      let plan = 'free';
      if (!IS_SAAS) plan = isFirstUser ? 'personal' : (isInstanceUnlocked() ? 'free' : 'personal');

      const id = uuidv4();
      db.prepare(`INSERT INTO users (id, username, email, password_hash, is_admin, plan, kdf_version, kdf_salt, kdf_iterations,
                  master_key_encrypted, public_key, private_key_encrypted, calendar_key_encrypted, key_check, e2ee_version)
                  VALUES (?, ?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, 2)`)
        .run(id, username, email, await bcrypt.hash(authKey, BCRYPT_COST), isFirstUser ? 1 : 0, plan, kdf.salt, kdf.iterations,
          bundle.master_key_encrypted, bundle.public_key, bundle.private_key_encrypted, bundle.calendar_key_encrypted, bundle.key_check);

      void sendWelcomeEmail(email, username);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
      res.json({ token: signSession(user), user: publicUser(user) });
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'Username or email already exists' });
      fail(res, err, 'Register');
    }
  });

  /**
   * Login. v2 accounts send `{ identifier, auth_key }` (derived client-side; the password never leaves the device).
   * Legacy accounts (kdf_version 1) still send `{ username, password }` ONE last time and are told to upgrade.
   */
  app.post('/api/auth/login', loginLimiter, async (req: any, res: any) => {
    const b = req.body ?? {};
    const isV2 = typeof b.auth_key === 'string';
    const identifier = isV2 ? b.identifier : b.username;
    const secret = isV2 ? b.auth_key : b.password;
    if (typeof identifier !== 'string' || typeof secret !== 'string' || !identifier || !secret || identifier.length > 254 || secret.length > 1024) {
      return res.status(400).json({ error: 'Credentials required' });
    }

    const key = loginKey(identifier);
    const lock = loginFailures.get(key);
    if (lock && lock.lockedUntil > Date.now()) {
      return res.status(429).json({ error: 'Too many failed attempts. Please try again in a few minutes.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identifier, identifier) as any;
    // The credential type must match the account's KDF version (a v2 auth key is never valid for a legacy account and vice versa).
    const versionOk = user && (isV2 ? (user.kdf_version ?? 1) === 2 : (user.kdf_version ?? 1) === 1);
    // Always run bcrypt (against a dummy hash otherwise) so response time doesn't reveal which accounts exist.
    const secretOk = await bcrypt.compare(secret, versionOk ? user.password_hash : DUMMY_HASH);

    if (!versionOk || !secretOk) {
      const entry = loginFailures.get(key) ?? { count: 0, lockedUntil: 0 };
      entry.count += 1;
      if (entry.count >= LOGIN_MAX_FAILURES) { entry.lockedUntil = Date.now() + LOGIN_LOCK_MS; entry.count = 0; }
      loginFailures.set(key, entry);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    loginFailures.delete(key);
    res.json({ token: signSession(user), user: publicUser(user), needs_upgrade: !isV2 });
  });

  /** One-time upgrade of a legacy account: proves the old password, then replaces it with a v2 auth key + key bundle. */
  app.post('/api/auth/upgrade', loginLimiter, authenticateToken, requireSession, async (req: any, res: any) => {
    try {
      const b = req.body ?? {};
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
      if ((user.kdf_version ?? 1) >= 2) return res.status(400).json({ error: 'Account is already upgraded' });
      if (typeof b.current_password !== 'string' || !(await bcrypt.compare(b.current_password, user.password_hash))) {
        return res.status(403).json({ error: 'Incorrect current password' });
      }
      const authKey = readAuthKey(b.auth_key);
      const kdf = readKdf(b);
      const bundle = readBundle(b);

      db.prepare(`UPDATE users SET password_hash = ?, kdf_version = 2, kdf_salt = ?, kdf_iterations = ?, master_key_encrypted = ?, public_key = ?,
                  private_key_encrypted = ?, calendar_key_encrypted = ?, key_check = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?`)
        .run(await bcrypt.hash(authKey, BCRYPT_COST), kdf.salt, kdf.iterations, bundle.master_key_encrypted, bundle.public_key,
          bundle.private_key_encrypted, bundle.calendar_key_encrypted, bundle.key_check, req.user.id);

      const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
      res.json({ token: signSession(updated), user: publicUser(updated) });
    } catch (err) { fail(res, err, 'Upgrade'); }
  });

  app.post('/api/auth/forgot-password', forgotLimiter, (req: any, res: any) => {
    // Identical response whether or not the account exists; work happens after responding.
    res.json({ success: true });
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      if (!email || email.length > 254) return;
      const user = db.prepare('SELECT id, email FROM users WHERE LOWER(email) = LOWER(?)').get(email) as any;
      if (!user) return;
      const resetToken = crypto.randomBytes(32).toString('hex');
      db.prepare('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?')
        .run(sha256(resetToken), new Date(Date.now() + 3600000).toISOString(), user.id);
      // Always built from APP_URL, never from request headers (prevents link poisoning).
      void sendPasswordResetEmail(user.email, `${APP_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`);
    } catch (err) {
      console.error('Forgot-password error:', err);
    }
  });

  /**
   * Reset needs the e-mailed token AND proof of the recovery phrase: the client sends `key_check`, a hash derived from
   * the master key, which must match the one stored at registration. Someone with only the token (phished link,
   * mailbox access) can therefore no longer overwrite the vault key and destroy access to the data.
   */
  app.post('/api/auth/reset-password', resetLimiter, async (req: any, res: any) => {
    try {
      const b = req.body ?? {};
      if (typeof b.token !== 'string' || !b.token || b.token.length > 256) return res.status(400).json({ error: 'Missing parameters' });
      const authKey = readAuthKey(b.auth_key);
      const kdf = readKdf(b);
      const masterKeyEnc = readMasterKeyEnc(b);

      const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(sha256(b.token)) as any;
      if (!user || new Date(user.reset_token_expiry) < new Date()) return res.status(400).json({ error: 'Invalid or expired token' });

      if ((user.kdf_version ?? 1) >= 2) {
        const given = Buffer.from(String(b.key_check ?? ''));
        const stored = Buffer.from(String(user.key_check ?? ''));
        if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) {
          return res.status(403).json({ error: 'The recovery phrase does not match this account.' });
        }
        db.prepare(`UPDATE users SET password_hash = ?, kdf_salt = ?, kdf_iterations = ?, master_key_encrypted = ?, reset_token = NULL,
                    reset_token_expiry = NULL, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?`)
          .run(await bcrypt.hash(authKey, BCRYPT_COST), kdf.salt, kdf.iterations, masterKeyEnc, user.id);
      } else {
        // Legacy account with no server-verifiable key material yet: it must supply a full v2 bundle (and is upgraded).
        const bundle = readBundle(b);
        db.prepare(`UPDATE users SET password_hash = ?, kdf_version = 2, kdf_salt = ?, kdf_iterations = ?, master_key_encrypted = ?, public_key = ?,
                    private_key_encrypted = ?, calendar_key_encrypted = ?, key_check = ?, reset_token = NULL, reset_token_expiry = NULL,
                    token_version = COALESCE(token_version, 0) + 1 WHERE id = ?`)
          .run(await bcrypt.hash(authKey, BCRYPT_COST), kdf.salt, kdf.iterations, bundle.master_key_encrypted, bundle.public_key,
            bundle.private_key_encrypted, bundle.calendar_key_encrypted, bundle.key_check, user.id);
      }
      res.json({ success: true });
    } catch (err) { fail(res, err, 'Reset-password'); }
  });

  app.get('/api/auth/me', authenticateToken, (req: any, res) => {
    const dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
    if (!dbUser) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(dbUser) });
  });

  app.patch('/api/auth/me/email', authenticateToken, requireSession, (req: any, res) => {
    try {
      const email = str(req.body?.email, 'Email', { required: true, max: 254 })!;
      if (!EMAIL_RE.test(email)) throw new ValidationError('Email address is not valid');
      const user = db.prepare('SELECT id, email, kdf_version FROM users WHERE id = ?').get(req.user.id) as any;
      if (!user) return res.status(404).json({ error: 'User not found' });
      // Only allowed if: user has no email (legacy), OR requester is admin
      if (user.email && !req.user.isAdmin) return res.status(403).json({ error: 'Email can only be changed by an administrator. Contact your admin.' });
      if (ADMIN_EMAIL && email.toLowerCase() === ADMIN_EMAIL && !req.user.isAdmin) return res.status(400).json({ error: 'This email address is reserved.' });
      if (db.prepare('SELECT 1 FROM users WHERE LOWER(email) = LOWER(?) AND id != ?').get(email, req.user.id)) {
        return res.status(400).json({ error: 'This email is already in use by another account.' });
      }
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.user.id);
      res.json({ success: true, email });
    } catch (err: any) {
      if (err?.message?.includes('UNIQUE constraint failed')) return res.status(400).json({ error: 'This email is already in use by another account.' });
      fail(res, err, 'Update email');
    }
  });

  /** Password change: proves the current auth key, then replaces auth key + salt + wrapped master key. All other sessions are revoked. */
  app.patch('/api/auth/me/password', loginLimiter, authenticateToken, requireSession, async (req: any, res) => {
    try {
      const b = req.body ?? {};
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
      if ((user.kdf_version ?? 1) < 2) return res.status(409).json({ error: 'Upgrade your account first', needs_upgrade: true });
      const current = readAuthKey(b.current_auth_key, 'current_auth_key');
      if (!(await bcrypt.compare(current, user.password_hash))) return res.status(403).json({ error: 'Incorrect current password' });
      const authKey = readAuthKey(b.auth_key);
      const kdf = readKdf(b);
      const mke = readMasterKeyEnc(b);

      const tokenVersion = (user.token_version ?? 0) + 1;
      db.prepare('UPDATE users SET password_hash = ?, kdf_salt = ?, kdf_iterations = ?, master_key_encrypted = ?, token_version = ? WHERE id = ?')
        .run(await bcrypt.hash(authKey, BCRYPT_COST), kdf.salt, kdf.iterations, mke, tokenVersion, req.user.id);
      res.json({ success: true, token: signSession({ ...user, token_version: tokenVersion }) });
    } catch (err) { fail(res, err, 'Change-password'); }
  });
}
