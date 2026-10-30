import type { Express } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { DB_PATH, UPLOADS_DIR, IS_SAAS } from '../config.js';
import { EMAIL_RE, ValidationError, oneOf, sha256, str } from '../security.js';
import { authenticateToken, requireSession, requireAdmin, licenseLimiter, removeReceiptFile, PLANS } from '../middleware.js';
import { isInstanceUnlocked } from '../helpers.js';

// Admin API: interactive session + admin flag required; API keys are never accepted here.
const adminOnly = [authenticateToken, requireSession, requireAdmin];

export function registerAdminRoutes(app: Express) {
  app.get('/api/admin/users', ...adminOnly, (req: any, res) => {
    res.json(db.prepare('SELECT id, username, email, plan, created_at, e2ee_version FROM users ORDER BY created_at DESC').all());
  });

  // Admins can change an account's email and plan. They cannot set passwords: with end-to-end encryption the server
  // never sees a user's password, so a forced password could not re-wrap the vault. Users reset via the e-mail flow.
  app.patch('/api/admin/users/:id', ...adminOnly, (req: any, res) => {
    try {
      const userId = req.params.id;
      if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) return res.status(404).json({ error: 'User not found' });
      const email = req.body?.email ? str(req.body.email, 'Email', { max: 254 }) : null;
      if (email && !EMAIL_RE.test(email)) throw new ValidationError('Email address is not valid');
      const plan = req.body?.plan ? oneOf(req.body.plan, 'Plan', PLANS) : null;
      if (req.body?.password) throw new ValidationError('Passwords cannot be set by an administrator. Ask the user to use "Forgot password".');

      if (email) {
        if (db.prepare('SELECT 1 FROM users WHERE LOWER(email) = LOWER(?) AND id != ?').get(email, userId)) {
          return res.status(400).json({ error: 'Email update failed, possibly already exists.' });
        }
        db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
      }
      if (plan) db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);
      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      console.error('Admin update user error:', err);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  app.delete('/api/admin/users/:id', ...adminOnly, (req: any, res) => {
    const userId = req.params.id;
    if (req.user.id === userId) return res.status(400).json({ error: 'Cannot delete your own admin account.' });

    try {
      const receiptUrls: string[] = [];
      db.transaction(() => {
        const jobIds = (db.prepare('SELECT id FROM jobs WHERE created_by = ?').all(userId) as any[]).map(j => j.id);
        const collect = (sql: string, ...params: any[]) =>
          (db.prepare(sql).all(...params) as any[]).forEach(e => e.receipt_url && receiptUrls.push(e.receipt_url));

        if (jobIds.length > 0) {
          const ph = jobIds.map(() => '?').join(',');
          collect(`SELECT receipt_url FROM expenses WHERE job_id IN (${ph})`, ...jobIds);
          db.prepare(`DELETE FROM wishlist_items WHERE job_id IN (${ph})`).run(...jobIds);
          db.prepare(`DELETE FROM subscriptions WHERE job_id IN (${ph})`).run(...jobIds);
          db.prepare(`DELETE FROM job_users WHERE job_id IN (${ph})`).run(...jobIds);
          db.prepare(`DELETE FROM expenses WHERE job_id IN (${ph})`).run(...jobIds);
          db.prepare('DELETE FROM jobs WHERE created_by = ?').run(userId);
        }
        collect('SELECT receipt_url FROM expenses WHERE user_id = ?', userId);
        db.prepare('DELETE FROM expenses WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM wishlist_items WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM tags WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM api_keys WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM job_users WHERE user_id = ?').run(userId);
        // license_keys.activated_by has no ON DELETE action; keep the key row but detach it.
        db.prepare('UPDATE license_keys SET activated_by = NULL WHERE activated_by = ?').run(userId);
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      })();
      receiptUrls.forEach(removeReceiptFile); // files are removed only after the DB transaction commits
      res.json({ success: true });
    } catch (err: any) {
      console.error('Delete User Error:', err);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  app.get('/api/admin/stats', ...adminOnly, (req: any, res) => {
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) as count FROM ${t}`).get() as any).count;
    let dbSize = 0, uploadsSize = 0;
    try { if (fs.existsSync(DB_PATH)) dbSize = fs.statSync(DB_PATH).size; } catch {}
    try { for (const f of fs.readdirSync(UPLOADS_DIR)) uploadsSize += fs.statSync(path.join(UPLOADS_DIR, f)).size; } catch {}
    res.json({
      users: count('users'), jobs: count('jobs'), expenses: count('expenses'),
      dbSizeBytes: dbSize, uploadsSizeBytes: uploadsSize,
      isSaaSMode: IS_SAAS, isUnlocked: !IS_SAAS ? isInstanceUnlocked() : false,
    });
  });

  app.get('/api/admin/config', ...adminOnly, (req: any, res) => {
    res.json(db.prepare('SELECT key_name, value FROM saas_settings').all());
  });

  app.patch('/api/admin/config', ...adminOnly, (req: any, res) => {
    const settings = req.body;
    if (!Array.isArray(settings) || settings.length > 100) return res.status(400).json({ error: 'Expected array of settings' });
    const stmt = db.prepare('UPDATE saas_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key_name = ?');
    try {
      db.transaction(() => {
        for (const setting of settings) {
          if (typeof setting?.key_name !== 'string' || setting.value === undefined) continue;
          const value = String(setting.value);
          if (!/^\d{1,6}$/.test(value)) throw new ValidationError(`Invalid value for ${setting.key_name}`);
          stmt.run(value, setting.key_name);
        }
      })();
    } catch (err: any) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    res.json({ success: true });
  });

  app.get('/api/admin/licenses', ...adminOnly, (req: any, res) => {
    res.json(db.prepare(`SELECT l.*, u.username as activator_username FROM license_keys l
                         LEFT JOIN users u ON l.activated_by = u.id ORDER BY l.created_at DESC`).all());
  });

  app.post('/api/admin/license/generate', ...adminOnly, (req: any, res) => {
    let plan: typeof PLANS[number];
    try { plan = oneOf(req.body?.plan, 'Plan', PLANS); } catch (err: any) { return res.status(400).json({ error: err.message }); }
    const rawKey = `sk_${crypto.randomBytes(16).toString('hex')}`;
    db.prepare("INSERT INTO license_keys (id, key_hash, plan, status) VALUES (?, ?, ?, 'unused')").run(uuidv4(), sha256(rawKey), plan);
    res.json({ success: true, key: rawKey }); // returned once
  });

  app.delete('/api/admin/license/:id', ...adminOnly, (req: any, res) => {
    db.prepare('DELETE FROM license_keys WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // License key lifecycle: unused -> active (activated locally) | remote_used (verified by a community instance)
  app.post('/api/license/activate', licenseLimiter, authenticateToken, requireSession, (req: any, res) => {
    const key = req.body?.key;
    if (typeof key !== 'string' || !key || key.length > 128) return res.status(400).json({ error: 'License key required' });
    const license = db.prepare('SELECT * FROM license_keys WHERE key_hash = ?').get(sha256(key)) as any;
    if (!license) return res.status(400).json({ error: 'Invalid license key' });

    const claimed = db.transaction(() => {
      const r = db.prepare("UPDATE license_keys SET status = 'active', activated_at = CURRENT_TIMESTAMP, activated_by = ? WHERE id = ? AND status = 'unused'")
        .run(req.user.id, license.id);
      if (r.changes === 0) return false;
      db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(license.plan, req.user.id);
      return true;
    })();
    if (!claimed) return res.status(400).json({ error: 'License key has already been used' });
    res.json({ success: true, plan: license.plan });
  });

  app.post('/api/license/remote-verify', licenseLimiter, (req: any, res) => {
    const key = req.body?.key;
    if (typeof key !== 'string' || !key || key.length > 128) return res.status(400).json({ error: 'License key required' });
    const license = db.prepare('SELECT * FROM license_keys WHERE key_hash = ?').get(sha256(key)) as any;
    if (!license) return res.status(400).json({ error: 'Invalid license key' });
    const r = db.prepare("UPDATE license_keys SET status = 'remote_used', activated_at = CURRENT_TIMESTAMP, activated_by = NULL WHERE id = ? AND status = 'unused'").run(license.id);
    if (r.changes === 0) return res.status(400).json({ error: 'License key has already been used' });
    res.json({ success: true, plan: license.plan });
  });
}
