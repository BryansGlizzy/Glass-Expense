import type { Express } from 'express';
import type { Server } from 'socket.io';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import db from '../db.js';
import { UPLOADS_DIR } from '../config.js';
import { ValidationError, isoDate, oneOf, sha256 } from '../security.js';
import {
  authenticateToken, requireSession, requireJobAccess, requireJobOwner, allowApiKey, getJobAccess, touchJob,
  enforceJobLimits, enforceArchiveLimits, enforceJoinLimits, enforceMemberLimits, receiptUpload, removeReceiptFile,
  removeTempFile, isUuid, envelope,
} from '../middleware.js';
import { syncJobToGoogle, deleteGoogleEvent } from '../google-calendar.js';

/**
 * End-to-end encrypted data API (/api/v2). The server stores opaque ciphertext envelopes ("enc") and the minimum
 * plaintext it needs: ids, ownership/membership, archive flag, timestamps and a job's start/end dates (calendar API).
 * Titles, amounts, descriptions, clients, notes, tags, tax data and receipts are only ever stored encrypted.
 */

const BLOB_NAMES = ['tags', 'tax_settings', 'tax_mappings', 'w2_forms', 'invoice_template', 'invoice_packages', 'ai_settings', 'preferences'] as const;
const MAX_BLOB_CHARS = 900 * 1024;

const dbJson = (res: any, fn: () => any) => {
  try { return res.json(fn()); } catch (err: any) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
};
const badRequest = (res: any, err: any) => {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  throw err;
};

export function registerDataRoutes(app: Express, io: Server) {
  const session = [authenticateToken, requireSession];

  // Scrubbing statements used when a legacy plaintext row is replaced by its encrypted form.
  const scrubJob = `title = '', description = NULL, mode = 'expense', client_name = NULL, client_address = NULL, client_email = NULL,
                    job_rate = 0, invoice_notes = NULL, invoice_tag = NULL, invoice_seq = NULL, invoice_number = NULL`;

  const expenseRow = (id: string) => db.prepare(`
    SELECT e.id, e.job_id, e.user_id, u.username AS user_name, e.enc, e.receipt_url, e.is_encrypted, e.created_at, e.updated_at
    FROM expenses e JOIN users u ON u.id = e.user_id WHERE e.id = ?`).get(id);
  const wishlistRow = (id: string) => db.prepare(`
    SELECT w.id, w.job_id, w.user_id, u.username AS user_name, w.enc, w.created_at
    FROM wishlist_items w JOIN users u ON u.id = w.user_id WHERE w.id = ?`).get(id);
  const subRow = (id: string) => db.prepare(`
    SELECT id, job_id, user_id, enc, next_generation_date, remind_1_day_before, remind_2_days_before, remind_7_days_before, is_active, created_at
    FROM subscriptions WHERE id = ?`).get(id);

  const evict = (jobId: string, userId: string) =>
    io.in(jobId).fetchSockets().then(ss => ss.forEach(s => { if (s.data.user?.id === userId) s.leave(jobId); })).catch(() => {});

  // ── Jobs ──────────────────────────────────────────────────────────────────
  app.get('/api/v2/jobs', ...session, (req: any, res) => {
    res.json(db.prepare(`
      SELECT j.id, j.created_by, u.username AS owner_name, j.is_archived, j.start_date, j.end_date, j.enc, j.google_event_id,
             j.created_at, j.updated_at, CASE WHEN j.created_by = ? THEN 'owner' ELSE 'member' END AS role, l.title_enc AS my_label
      FROM jobs j LEFT JOIN users u ON u.id = j.created_by
      LEFT JOIN job_calendar_labels l ON l.job_id = j.id AND l.user_id = ?
      WHERE j.created_by = ? OR EXISTS (SELECT 1 FROM job_users ju WHERE ju.job_id = j.id AND ju.user_id = ? AND COALESCE(ju.status,'active') = 'active')
      ORDER BY j.created_at DESC`).all(req.user.id, req.user.id, req.user.id, req.user.id));
  });

  /** Memberships awaiting the owner's approval (the job key hasn't been wrapped for me yet). */
  app.get('/api/v2/jobs/pending', ...session, (req: any, res) => {
    res.json(db.prepare(`SELECT ju.job_id, u.username AS owner_name FROM job_users ju JOIN jobs j ON j.id = ju.job_id
                         JOIN users u ON u.id = j.created_by WHERE ju.user_id = ? AND ju.status = 'pending'`).all(req.user.id));
  });

  app.post('/api/v2/jobs', ...session, enforceJobLimits, async (req: any, res) => {
    try {
      const b = req.body ?? {};
      if (!isUuid(b.id)) throw new ValidationError('id must be a UUID');
      const enc = envelope(b.enc, 'enc');
      const key = envelope(`v2.${String(b.key ?? '')}`, 'key', 4096).slice(3);
      const start = isoDate(b.start_date, 'start_date'), end = isoDate(b.end_date, 'end_date');
      const label = b.calendar_title_enc ? envelope(b.calendar_title_enc, 'calendar_title_enc', 4096) : null;
      if (db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(b.id)) return res.status(409).json({ error: 'Job already exists' });

      db.transaction(() => {
        db.prepare("INSERT INTO jobs (id, title, created_by, enc, start_date, end_date, is_archived) VALUES (?, '', ?, ?, ?, ?, 0)").run(b.id, req.user.id, enc, start, end);
        db.prepare('INSERT INTO job_keys (job_id, user_id, encrypted_job_key, wrapped_by) VALUES (?, ?, ?, NULL)').run(b.id, req.user.id, key);
        if (label) db.prepare('INSERT INTO job_calendar_labels (job_id, user_id, title_enc) VALUES (?, ?, ?)').run(b.id, req.user.id, label);
      })();
      const sync = await syncJobToGoogle(req.user.id, b.id);
      res.json({ id: b.id, sync_status: sync });
    } catch (err) { badRequest(res, err); }
  });

  app.put('/api/v2/jobs/:id', ...session, requireJobAccess, requireJobOwner, async (req: any, res) => {
    try {
      const b = req.body ?? {};
      const enc = envelope(b.enc, 'enc');
      const start = isoDate(b.start_date, 'start_date'), end = isoDate(b.end_date, 'end_date');
      const label = b.calendar_title_enc ? envelope(b.calendar_title_enc, 'calendar_title_enc', 4096) : null;
      db.transaction(() => {
        db.prepare(`UPDATE jobs SET enc = ?, start_date = ?, end_date = ?, ${scrubJob}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(enc, start, end, req.params.id);
        if (label) db.prepare(`INSERT INTO job_calendar_labels (job_id, user_id, title_enc) VALUES (?, ?, ?)
                               ON CONFLICT(job_id, user_id) DO UPDATE SET title_enc = excluded.title_enc`).run(req.params.id, req.user.id, label);
      })();
      io.to(req.params.id).emit('job_updated', { id: req.params.id, enc, start_date: start, end_date: end });
      res.json({ id: req.params.id, sync_status: await syncJobToGoogle(req.user.id, req.params.id) });
    } catch (err) { badRequest(res, err); }
  });

  /** Each participant stores their own calendar label (job title encrypted under *their* calendar key). */
  app.put('/api/v2/jobs/:id/calendar-label', ...session, requireJobAccess, async (req: any, res) => {
    try {
      const label = envelope(req.body?.title_enc, 'title_enc', 4096);
      db.prepare(`INSERT INTO job_calendar_labels (job_id, user_id, title_enc) VALUES (?, ?, ?)
                  ON CONFLICT(job_id, user_id) DO UPDATE SET title_enc = excluded.title_enc`).run(req.params.id, req.user.id, label);
      res.json({ success: true, sync_status: await syncJobToGoogle(req.user.id, req.params.id) });
    } catch (err) { badRequest(res, err); }
  });

  app.patch('/api/v2/jobs/:id/archive', ...session, requireJobAccess, requireJobOwner, enforceArchiveLimits, (req: any, res) => {
    db.prepare('UPDATE jobs SET is_archived = ? WHERE id = ?').run(req.body?.is_archived ? 1 : 0, req.params.id);
    touchJob(req.params.id);
    res.json({ success: true });
  });

  app.delete('/api/v2/jobs/:id', ...session, requireJobAccess, requireJobOwner, (req: any, res) => {
    const id = req.params.id;
    const receipts = (db.prepare('SELECT receipt_url FROM expenses WHERE job_id = ? AND receipt_url IS NOT NULL').all(id) as any[]).map(r => r.receipt_url);
    try {
      db.transaction(() => {
        db.prepare('DELETE FROM expenses WHERE job_id = ?').run(id);
        db.prepare('DELETE FROM invoices WHERE job_id = ?').run(id);
        db.prepare('DELETE FROM wishlist_items WHERE job_id = ?').run(id);
        db.prepare('DELETE FROM subscriptions WHERE job_id = ?').run(id);
        db.prepare('DELETE FROM job_users WHERE job_id = ?').run(id);
        db.prepare('DELETE FROM jobs WHERE id = ?').run(id); // job_keys, labels, invites cascade
      })();
    } catch (err) {
      console.error('Delete job error:', err);
      return res.status(500).json({ error: 'Failed to delete job' });
    }
    receipts.forEach(removeReceiptFile);
    if (req.job.google_event_id) void deleteGoogleEvent(req.user.id, req.job.google_event_id);
    io.to(id).emit('job_deleted', id);
    res.json({ success: true });
  });

  app.delete('/api/v2/jobs/:id/leave', ...session, requireJobAccess, (req: any, res) => {
    if (req.isJobOwner) return res.status(400).json({ error: 'Creator cannot leave the job, they must delete it' });
    db.transaction(() => {
      db.prepare('DELETE FROM job_users WHERE job_id = ? AND user_id = ?').run(req.params.id, req.user.id);
      db.prepare('DELETE FROM job_keys WHERE job_id = ? AND user_id = ?').run(req.params.id, req.user.id);
      db.prepare('DELETE FROM job_calendar_labels WHERE job_id = ? AND user_id = ?').run(req.params.id, req.user.id);
    })();
    void evict(req.params.id, req.user.id);
    res.json({ success: true });
  });

  /** Owner (re)stores their own copy of the job key. Used when a legacy job is migrated and had no usable server-side key. */
  app.put('/api/v2/jobs/:id/key', ...session, requireJobAccess, requireJobOwner, (req: any, res) => {
    try {
      const wrapped = envelope(`v2.${String(req.body?.encrypted_key ?? '')}`, 'encrypted_key', 4096).slice(3);
      db.prepare(`INSERT INTO job_keys (job_id, user_id, encrypted_job_key, wrapped_by) VALUES (?, ?, ?, NULL)
                  ON CONFLICT(job_id, user_id) DO UPDATE SET encrypted_job_key = excluded.encrypted_job_key, wrapped_by = NULL`).run(req.params.id, req.user.id, wrapped);
      res.json({ success: true });
    } catch (err) { badRequest(res, err); }
  });

  // ── Job keys & membership ─────────────────────────────────────────────────
  /** All job keys wrapped for me. `wrapped_by` NULL = sealed under my own master key; otherwise by that member's ECDH share. */
  app.get('/api/v2/keys', ...session, (req: any, res) => {
    res.json(db.prepare(`SELECT k.job_id, k.encrypted_job_key AS encrypted_key, k.wrapped_by, w.public_key AS wrapper_public_key
                         FROM job_keys k LEFT JOIN users w ON w.id = k.wrapped_by WHERE k.user_id = ?`).all(req.user.id));
  });

  app.get('/api/v2/jobs/:id/members', ...session, requireJobAccess, (req: any, res) => {
    const rows = db.prepare(`
      SELECT u.id AS user_id, u.username, u.email, u.public_key, COALESCE(ju.status,'active') AS status,
             EXISTS (SELECT 1 FROM job_keys k WHERE k.job_id = ju.job_id AND k.user_id = u.id) AS has_key
      FROM job_users ju JOIN users u ON u.id = ju.user_id WHERE ju.job_id = ?`).all(req.params.id) as any[];
    // Only the owner can see people who have redeemed an invite but are not approved yet.
    res.json(req.isJobOwner ? rows : rows.filter(r => r.status === 'active'));
  });

  /** Owner approves a member by wrapping the job key for that member's public key (done in the owner's browser). */
  app.put('/api/v2/jobs/:id/members/:userId/key', ...session, requireJobAccess, requireJobOwner, (req: any, res) => {
    try {
      const wrapped = envelope(`v2.${String(req.body?.encrypted_key ?? '')}`, 'encrypted_key', 4096).slice(3);
      if (!db.prepare('SELECT 1 FROM job_users WHERE job_id = ? AND user_id = ?').get(req.params.id, req.params.userId)) {
        return res.status(404).json({ error: 'Member not found' });
      }
      db.transaction(() => {
        db.prepare(`INSERT INTO job_keys (job_id, user_id, encrypted_job_key, wrapped_by) VALUES (?, ?, ?, ?)
                    ON CONFLICT(job_id, user_id) DO UPDATE SET encrypted_job_key = excluded.encrypted_job_key, wrapped_by = excluded.wrapped_by`)
          .run(req.params.id, req.params.userId, wrapped, req.user.id);
        db.prepare("UPDATE job_users SET status = 'active' WHERE job_id = ? AND user_id = ?").run(req.params.id, req.params.userId);
      })();
      io.to(`user:${req.params.userId}`).emit('job_key_ready', { job_id: req.params.id });
      res.json({ success: true });
    } catch (err) { badRequest(res, err); }
  });

  app.delete('/api/v2/jobs/:id/members/:userId', ...session, requireJobAccess, requireJobOwner, (req: any, res) => {
    db.transaction(() => {
      db.prepare('DELETE FROM job_users WHERE job_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
      db.prepare('DELETE FROM job_keys WHERE job_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
      db.prepare('DELETE FROM job_calendar_labels WHERE job_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
    })();
    void evict(req.params.id, req.params.userId);
    res.json({ success: true });
  });

  // ── Invites: join by single-use, expiring token (never by job id or raw key) ─
  app.post('/api/v2/jobs/:id/invites', ...session, requireJobAccess, requireJobOwner, (req: any, res) => {
    const open = (db.prepare("SELECT COUNT(*) AS c FROM job_invites WHERE job_id = ? AND used_at IS NULL AND expires_at > ?").get(req.params.id, new Date().toISOString()) as any).c;
    if (open >= 20) return res.status(429).json({ error: 'Too many open invites for this job. Revoke some first.' });
    const token = `gi_${crypto.randomBytes(24).toString('base64url')}`;
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    db.prepare('INSERT INTO job_invites (id, job_id, token_hash, created_by, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), req.params.id, sha256(token), req.user.id, expires);
    res.json({ token, expires_at: expires });
  });

  app.delete('/api/v2/jobs/:id/invites', ...session, requireJobAccess, requireJobOwner, (req: any, res) => {
    db.prepare('DELETE FROM job_invites WHERE job_id = ? AND used_at IS NULL').run(req.params.id);
    res.json({ success: true });
  });

  const resolveInvite = (req: any, res: any, next: any) => {
    const token = req.body?.token;
    const invite = typeof token === 'string' && token.length < 200
      ? db.prepare('SELECT * FROM job_invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?').get(sha256(token), new Date().toISOString()) as any
      : null;
    if (!invite) return res.status(404).json({ error: 'This invite is invalid, expired, or has already been used.' });
    req.invite = invite;
    req.body.jobId = invite.job_id; // lets the plan-limit middleware see which job is being joined
    next();
  };

  app.post('/api/v2/invites/redeem', ...session, resolveInvite, enforceJoinLimits, enforceMemberLimits, (req: any, res) => {
    const me = db.prepare('SELECT public_key FROM users WHERE id = ?').get(req.user.id) as any;
    if (!me?.public_key) return res.status(409).json({ error: 'Upgrade your account before joining shared jobs.', needs_upgrade: true });
    const jobId = req.invite.job_id;
    const job = db.prepare('SELECT created_by FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.created_by === req.user.id) return res.json({ job_id: jobId, status: 'owner' });

    const existing = db.prepare('SELECT status FROM job_users WHERE job_id = ? AND user_id = ?').get(jobId, req.user.id) as any;
    if (!existing) {
      db.transaction(() => {
        db.prepare("INSERT INTO job_users (job_id, user_id, status) VALUES (?, ?, 'pending')").run(jobId, req.user.id);
        db.prepare('UPDATE job_invites SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id, req.invite.id);
      })();
      io.to(`user:${job.created_by}`).emit('member_pending', { job_id: jobId });
    }
    res.json({ job_id: jobId, status: existing?.status ?? 'pending' });
  });

  // ── Expenses ──────────────────────────────────────────────────────────────
  /** Every expense row in every job the caller can access, in one request (dashboard totals, tax, reports). */
  app.get('/api/v2/expenses', ...session, (req: any, res) => {
    res.json(db.prepare(`
      SELECT e.id, e.job_id, e.user_id, u.username AS user_name, e.enc, e.receipt_url, e.is_encrypted, e.created_at, e.updated_at
      FROM expenses e JOIN users u ON u.id = e.user_id JOIN jobs j ON j.id = e.job_id
      WHERE j.created_by = ? OR EXISTS (SELECT 1 FROM job_users ju WHERE ju.job_id = j.id AND ju.user_id = ? AND COALESCE(ju.status,'active') = 'active')
      ORDER BY e.created_at DESC`).all(req.user.id, req.user.id));
  });

  app.get('/api/v2/jobs/:jobId/expenses', ...session, requireJobAccess, (req: any, res) => {
    res.json(db.prepare(`SELECT e.id, e.job_id, e.user_id, u.username AS user_name, e.enc, e.receipt_url, e.is_encrypted, e.created_at, e.updated_at
                         FROM expenses e JOIN users u ON u.id = e.user_id WHERE e.job_id = ? ORDER BY e.created_at DESC`).all(req.params.jobId));
  });

  app.post('/api/v2/jobs/:jobId/expenses', ...session, requireJobAccess, receiptUpload.single('receipt'), (req: any, res) => {
    const discard = () => { if (req.file) removeTempFile(req.file.path); };
    try {
      const b = req.body ?? {};
      if (!isUuid(b.id)) throw new ValidationError('id must be a UUID');
      const enc = envelope(b.enc, 'enc');
      if (db.prepare('SELECT 1 FROM expenses WHERE id = ?').get(b.id)) { discard(); return res.status(409).json({ error: 'Expense already exists' }); }
      db.prepare("INSERT INTO expenses (id, job_id, user_id, amount, description, receipt_url, is_encrypted, entry_type, date, enc) VALUES (?, ?, ?, 0, NULL, ?, ?, 'expense', NULL, ?)")
        .run(b.id, req.params.jobId, req.user.id, req.file ? `/uploads/${req.file.filename}` : null, req.file ? 1 : 0, enc);
      const row = expenseRow(b.id);
      io.to(req.params.jobId).emit('expense_added', row);
      touchJob(req.params.jobId);
      res.json(row);
    } catch (err) { discard(); badRequest(res, err); }
  });

  /** Idempotent batch insert (client-chosen ids): imports, recurring-subscription generation, migration. */
  app.post('/api/v2/jobs/:jobId/expenses/bulk', ...session, requireJobAccess, (req: any, res) => {
    try {
      const items = req.body?.items;
      if (!Array.isArray(items) || items.length === 0 || items.length > 500) throw new ValidationError('items must be an array of 1-500 entries');
      const insert = db.prepare("INSERT OR IGNORE INTO expenses (id, job_id, user_id, amount, description, receipt_url, is_encrypted, entry_type, date, enc) VALUES (?, ?, ?, 0, NULL, NULL, 0, 'expense', NULL, ?)");
      const created: string[] = [];
      db.transaction(() => {
        for (const it of items) {
          if (!isUuid(it?.id)) throw new ValidationError('every item needs a UUID id');
          if (insert.run(it.id, req.params.jobId, req.user.id, envelope(it.enc, 'enc')).changes) created.push(it.id);
        }
      })();
      created.forEach(id => io.to(req.params.jobId).emit('expense_added', expenseRow(id)));
      if (created.length) touchJob(req.params.jobId);
      res.json({ created: created.length, ids: created });
    } catch (err) { badRequest(res, err); }
  });

  /** Owner-only batch re-encryption of EXISTING rows (legacy migration). Scrubs the plaintext columns of every row it touches. */
  app.post('/api/v2/jobs/:jobId/expenses/rewrite', ...session, requireJobAccess, requireJobOwner, (req: any, res) => {
    try {
      const items = req.body?.items;
      if (!Array.isArray(items) || items.length === 0 || items.length > 500) throw new ValidationError('items must be an array of 1-500 entries');
      const update = db.prepare("UPDATE expenses SET enc = ?, amount = 0, description = NULL, date = NULL, entry_type = 'expense', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND job_id = ?");
      let updated = 0;
      db.transaction(() => { for (const it of items) updated += update.run(envelope(it?.enc, 'enc'), String(it?.id), req.params.jobId).changes; })();
      res.json({ updated });
    } catch (err) { badRequest(res, err); }
  });

  const expenseWriteGuard = (req: any, res: any, next: any) => {
    const expense = db.prepare('SELECT id, user_id, receipt_url FROM expenses WHERE id = ? AND job_id = ?').get(req.params.expenseId, req.params.jobId) as any;
    if (!expense) return res.status(404).json({ error: 'Expense not found' });
    if (expense.user_id !== req.user.id && !req.isJobOwner) return res.status(403).json({ error: 'Not authorized to modify this expense' });
    req.expense = expense;
    next();
  };

  app.put('/api/v2/jobs/:jobId/expenses/:expenseId', ...session, requireJobAccess, expenseWriteGuard, (req: any, res) => {
    try {
      const enc = envelope(req.body?.enc, 'enc');
      db.prepare("UPDATE expenses SET enc = ?, amount = 0, description = NULL, date = NULL, entry_type = 'expense', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(enc, req.params.expenseId);
      const row = expenseRow(req.params.expenseId);
      io.to(req.params.jobId).emit('expense_updated', row);
      touchJob(req.params.jobId);
      res.json(row);
    } catch (err) { badRequest(res, err); }
  });

  app.patch('/api/v2/jobs/:jobId/expenses/:expenseId/receipt', ...session, requireJobAccess, expenseWriteGuard, receiptUpload.single('receipt'), (req: any, res) => {
    removeReceiptFile(req.expense.receipt_url);
    db.prepare('UPDATE expenses SET receipt_url = ?, is_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(req.file ? `/uploads/${req.file.filename}` : null, req.file ? 1 : 0, req.params.expenseId);
    const row = expenseRow(req.params.expenseId);
    io.to(req.params.jobId).emit('expense_updated', row);
    touchJob(req.params.jobId);
    res.json(row);
  });

  app.delete('/api/v2/jobs/:jobId/expenses/:expenseId', ...session, requireJobAccess, expenseWriteGuard, (req: any, res) => {
    removeReceiptFile(req.expense.receipt_url);
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.expenseId);
    io.to(req.params.jobId).emit('expense_deleted', req.params.expenseId);
    touchJob(req.params.jobId);
    res.json({ success: true });
  });

  /**
   * Authenticated receipt download. Files are no longer served statically: the caller must be the owner or an active
   * member of the job the receipt belongs to. Receipts are opaque ciphertext (decrypted in the browser).
   */
  app.get('/api/v2/uploads/:filename', ...session, (req: any, res) => {
    const name = req.params.filename;
    if (!/^[A-Za-z0-9._ -]{1,200}$/.test(name) || name.includes('..')) return res.status(400).json({ error: 'Bad filename' });
    const row = db.prepare('SELECT job_id FROM expenses WHERE receipt_url = ?').get(`/uploads/${name}`) as any;
    if (!row || !getJobAccess(row.job_id, req.user.id)) return res.status(404).json({ error: 'Receipt not found' });
    const file = path.join(UPLOADS_DIR, name);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Receipt not found' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
    res.sendFile(file, { dotfiles: 'deny' });
  });

  // ── Wishlist ──────────────────────────────────────────────────────────────
  app.get('/api/v2/jobs/:jobId/wishlist', ...session, requireJobAccess, (req: any, res) => {
    res.json(db.prepare(`SELECT w.id, w.job_id, w.user_id, u.username AS user_name, w.enc, w.created_at
                         FROM wishlist_items w JOIN users u ON u.id = w.user_id WHERE w.job_id = ? ORDER BY w.created_at DESC`).all(req.params.jobId));
  });

  app.post('/api/v2/jobs/:jobId/wishlist', ...session, requireJobAccess, (req: any, res) => {
    try {
      if (!isUuid(req.body?.id)) throw new ValidationError('id must be a UUID');
      const enc = envelope(req.body?.enc, 'enc');
      if (db.prepare('SELECT 1 FROM wishlist_items WHERE id = ?').get(req.body.id)) return res.status(409).json({ error: 'Item already exists' });
      db.prepare("INSERT INTO wishlist_items (id, job_id, user_id, name, enc) VALUES (?, ?, ?, '', ?)").run(req.body.id, req.params.jobId, req.user.id, enc);
      const row = wishlistRow(req.body.id);
      io.to(req.params.jobId).emit('wishlist_item_added', row);
      res.json(row);
    } catch (err) { badRequest(res, err); }
  });

  const itemGuard = (table: 'wishlist_items' | 'subscriptions') => (req: any, res: any, next: any) => {
    const item = db.prepare(`SELECT id, user_id FROM ${table} WHERE id = ? AND job_id = ?`).get(req.params.itemId, req.params.jobId) as any;
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.user_id !== req.user.id && !req.isJobOwner) return res.status(403).json({ error: 'Not authorized' });
    next();
  };

  app.put('/api/v2/jobs/:jobId/wishlist/:itemId', ...session, requireJobAccess, itemGuard('wishlist_items'), (req: any, res) => {
    try {
      db.prepare("UPDATE wishlist_items SET enc = ?, name = '', estimated_cost = NULL, url = NULL, notes = NULL WHERE id = ?").run(envelope(req.body?.enc, 'enc'), req.params.itemId);
      res.json(wishlistRow(req.params.itemId));
    } catch (err) { badRequest(res, err); }
  });

  app.delete('/api/v2/jobs/:jobId/wishlist/:itemId', ...session, requireJobAccess, itemGuard('wishlist_items'), (req: any, res) => {
    db.prepare('DELETE FROM wishlist_items WHERE id = ?').run(req.params.itemId);
    io.to(req.params.jobId).emit('wishlist_item_deleted', req.params.itemId);
    res.json({ success: true });
  });

  // ── Invoices (docs/DOCUMENTATION.md §13.6) ────────────────────────────────────────────────────────────────────
  // Ciphertext only, sealed under the job key. Active members may READ; only the job owner may write, enforced here (a member's
  // client could otherwise write, because members hold the job key). Optimistic concurrency through `rev`.
  const MAX_INVOICE_ENC = 100 * 1024;
  const invoiceRow = (id: string) => db.prepare('SELECT id, job_id, user_id, enc, rev, created_at, updated_at FROM invoices WHERE id = ?').get(id) as any;

  app.get('/api/v2/invoices', ...session, (req: any, res) => {
    res.json(db.prepare(`
      SELECT i.id, i.job_id, i.user_id, i.enc, i.rev, i.created_at, i.updated_at FROM invoices i JOIN jobs j ON j.id = i.job_id
      WHERE j.created_by = ? OR EXISTS (SELECT 1 FROM job_users ju WHERE ju.job_id = j.id AND ju.user_id = ? AND COALESCE(ju.status,'active') = 'active')
      ORDER BY i.created_at DESC`).all(req.user.id, req.user.id));
  });

  app.get('/api/v2/jobs/:jobId/invoices', ...session, requireJobAccess, (req: any, res) => {
    res.json(db.prepare('SELECT id, job_id, user_id, enc, rev, created_at, updated_at FROM invoices WHERE job_id = ? ORDER BY created_at DESC').all(req.params.jobId));
  });

  app.post('/api/v2/jobs/:jobId/invoices', ...session, requireJobAccess, requireJobOwner, (req: any, res) => {
    try {
      if (!isUuid(req.body?.id)) throw new ValidationError('id must be a UUID');
      const enc = envelope(req.body?.enc, 'enc', MAX_INVOICE_ENC);
      if (db.prepare('SELECT 1 FROM invoices WHERE id = ?').get(req.body.id)) {
        const existing = invoiceRow(req.body.id);
        // Re-posting the same deterministic id from a second device is not an error for the owner: hand back what exists.
        if (existing.job_id === req.params.jobId && existing.user_id === req.user.id) return res.status(200).json({ ...existing, duplicate: true });
        return res.status(409).json({ error: 'Invoice already exists' });
      }
      db.prepare('INSERT INTO invoices (id, job_id, user_id, enc) VALUES (?, ?, ?, ?)').run(req.body.id, req.params.jobId, req.user.id, enc);
      const row = invoiceRow(req.body.id);
      touchJob(req.params.jobId);
      io.to(req.params.jobId).emit('invoice_updated', row);
      res.status(201).json(row);
    } catch (err) { badRequest(res, err); }
  });

  /** Resolves :id to its job, hides it from non-members (404) and from members for writes (403). */
  const invoiceWriteGuard = (req: any, res: any, next: any) => {
    const row = typeof req.params.id === 'string' ? invoiceRow(req.params.id) : null;
    const access = row ? getJobAccess(row.job_id, req.user.id) : null;
    if (!row || !access) return res.status(404).json({ error: 'Invoice not found' });
    if (!access.isOwner) return res.status(403).json({ error: 'Only the job owner can change invoices' });
    req.invoice = row; next();
  };

  app.put('/api/v2/invoices/:id', ...session, invoiceWriteGuard, (req: any, res) => {
    try {
      const enc = envelope(req.body?.enc, 'enc', MAX_INVOICE_ENC);
      const expected = req.body?.expected_rev;
      if (expected !== undefined && (!Number.isInteger(expected) || expected < 1)) throw new ValidationError('expected_rev must be a positive integer');
      // Compare-and-swap in one statement so two devices cannot both win.
      const r = db.prepare('UPDATE invoices SET enc = ?, rev = rev + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (? IS NULL OR rev = ?)')
        .run(enc, req.params.id, expected ?? null, expected ?? null);
      if (r.changes === 0) return res.status(409).json({ error: 'This invoice was changed elsewhere. Reload it and try again.', current: invoiceRow(req.params.id) });
      const row = invoiceRow(req.params.id);
      touchJob(row.job_id);
      io.to(row.job_id).emit('invoice_updated', row);
      res.json(row);
    } catch (err) { badRequest(res, err); }
  });

  app.delete('/api/v2/invoices/:id', ...session, invoiceWriteGuard, (req: any, res) => {
    db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
    io.to(req.invoice.job_id).emit('invoice_deleted', { id: req.params.id, job_id: req.invoice.job_id });
    res.json({ success: true });
  });

  // ── Recurring subscriptions (definition is encrypted; the client generates the expenses) ─
  const readSub = (b: any) => {
    const flag = (v: unknown) => (v ? 1 : 0);
    return {
      enc: envelope(b?.enc, 'enc'),
      next: b?.next_generation_date ? (isoDate(b.next_generation_date, 'next_generation_date') + 'T00:00:00.000Z') : null,
      r1: flag(b?.remind_1_day_before), r2: flag(b?.remind_2_days_before), r7: flag(b?.remind_7_days_before),
    };
  };

  app.get('/api/v2/jobs/:jobId/subscriptions', ...session, requireJobAccess, (req: any, res) => {
    res.json(db.prepare(`SELECT id, job_id, user_id, enc, next_generation_date, remind_1_day_before, remind_2_days_before, remind_7_days_before, is_active, created_at
                         FROM subscriptions WHERE job_id = ? AND is_active = 1 ORDER BY created_at DESC`).all(req.params.jobId));
  });

  app.post('/api/v2/jobs/:jobId/subscriptions', ...session, requireJobAccess, (req: any, res) => {
    try {
      if (!isUuid(req.body?.id)) throw new ValidationError('id must be a UUID');
      const s = readSub(req.body);
      if (db.prepare('SELECT 1 FROM subscriptions WHERE id = ?').get(req.body.id)) return res.status(409).json({ error: 'Subscription already exists' });
      db.prepare(`INSERT INTO subscriptions (id, job_id, user_id, amount, description, billing_day, frequency, next_generation_date, entry_type,
                  remind_1_day_before, remind_2_days_before, remind_7_days_before, enc) VALUES (?, ?, ?, 0, NULL, 1, 'MONTHLY', ?, 'expense', ?, ?, ?, ?)`)
        .run(req.body.id, req.params.jobId, req.user.id, s.next, s.r1, s.r2, s.r7, s.enc);
      res.json(subRow(req.body.id));
    } catch (err) { badRequest(res, err); }
  });

  app.put('/api/v2/jobs/:jobId/subscriptions/:itemId', ...session, requireJobAccess, itemGuard('subscriptions'), (req: any, res) => {
    try {
      const s = readSub(req.body);
      db.prepare(`UPDATE subscriptions SET enc = ?, next_generation_date = ?, remind_1_day_before = ?, remind_2_days_before = ?, remind_7_days_before = ?,
                  remind_1_sent = 0, remind_2_sent = 0, remind_7_sent = 0, amount = 0, description = NULL WHERE id = ?`)
        .run(s.enc, s.next, s.r1, s.r2, s.r7, req.params.itemId);
      res.json(subRow(req.params.itemId));
    } catch (err) { badRequest(res, err); }
  });

  app.delete('/api/v2/jobs/:jobId/subscriptions/:itemId', ...session, requireJobAccess, itemGuard('subscriptions'), (req: any, res) => {
    db.prepare('UPDATE subscriptions SET is_active = 0 WHERE id = ?').run(req.params.itemId);
    res.json({ success: true });
  });

  // ── Personal encrypted blobs (tags, tax profile, W-2s, invoice template, AI settings, ...) ─
  app.get('/api/v2/blobs', ...session, (req: any, res) => {
    res.json(db.prepare('SELECT name, enc, version, updated_at FROM user_blobs WHERE user_id = ?').all(req.user.id));
  });

  app.put('/api/v2/blobs/:name', ...session, (req: any, res) => {
    try {
      const name = oneOf(req.params.name, 'name', BLOB_NAMES);
      const enc = envelope(req.body?.enc, 'enc', MAX_BLOB_CHARS);
      const existing = db.prepare('SELECT version FROM user_blobs WHERE user_id = ? AND name = ?').get(req.user.id, name) as any;
      const expected = req.body?.expected_version;
      if (existing && expected !== undefined && expected !== existing.version) {
        return res.status(409).json({ error: 'Version conflict', version: existing.version });
      }
      const version = (existing?.version ?? 0) + 1;
      db.prepare(`INSERT INTO user_blobs (user_id, name, enc, version, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(user_id, name) DO UPDATE SET enc = excluded.enc, version = excluded.version, updated_at = CURRENT_TIMESTAMP`)
        .run(req.user.id, name, enc, version);
      res.json({ name, version });
    } catch (err) { badRequest(res, err); }
  });

  // ── Calendar schedule (the only endpoint an API key may call) ───────────────
  /**
   * Returns the caller's jobs with dates in plaintext and each job title as a calendar-key envelope. API-key callers also
   * receive `wrapped_calendar_key`, which only the private half of their key can unwrap; the server cannot read titles.
   */
  app.get('/api/calendar/schedule', allowApiKey, authenticateToken, (req: any, res) => {
    const jobs = db.prepare(`
      SELECT j.id, j.start_date, j.end_date, l.title_enc AS title
      FROM jobs j LEFT JOIN job_calendar_labels l ON l.job_id = j.id AND l.user_id = ?
      WHERE j.created_by = ? OR EXISTS (SELECT 1 FROM job_users ju WHERE ju.job_id = j.id AND ju.user_id = ? AND COALESCE(ju.status,'active') = 'active')
      ORDER BY j.start_date ASC`).all(req.user.id, req.user.id, req.user.id);
    res.json({
      version: 2,
      wrapped_calendar_key: req.authMethod === 'apikey' ? (req.apiKeyRecord.wrapped_calendar_key ?? null) : null,
      jobs,
    });
  });

  // ── Personal blobs aside: socket rooms for per-user notifications are joined in index.ts ─
  void dbJson;
}
