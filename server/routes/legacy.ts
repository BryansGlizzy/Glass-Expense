import type { Express } from 'express';
import db from '../db.js';
import { authenticateToken, requireSession } from '../middleware.js';

/**
 * Migration of accounts created before end-to-end encryption.
 *
 *   1. The user logs in (last time with the old plaintext password) and the browser upgrades the account keys.
 *   2. The browser downloads its OWN legacy plaintext here, encrypts it locally and uploads the ciphertext through the
 *      /api/v2 endpoints, which scrub each legacy row as it is replaced.
 *   3. /api/v2/migration/complete verifies nothing is left, deletes the user's remaining legacy plaintext (tags, tax
 *      data, W-2s, invoice template, AI key), and VACUUMs the database so deleted plaintext does not linger on disk.
 *
 * Only the OWNER of a job migrates the job's content (including entries other members authored), since only the
 * owner can hold its job key.
 */
export function registerLegacyRoutes(app: Express) {
  const guard = [authenticateToken, requireSession];

  app.get('/api/legacy/export', ...guard, (req: any, res) => {
    const userId = req.user.id;
    const user = db.prepare('SELECT kdf_version, e2ee_version, ai_api_key, ai_base_url, ai_model, use_on_device_ai, on_device_ai_model FROM users WHERE id = ?').get(userId) as any;
    if ((user.kdf_version ?? 1) < 2) return res.status(409).json({ error: 'Upgrade your account keys first', needs_upgrade: true });
    if ((user.e2ee_version ?? 1) >= 2) return res.status(410).json({ error: 'Migration already completed' });

    // Resumable: only rows that still hold plaintext are exported, so an interrupted migration can simply be run again.
    const allOwned = db.prepare('SELECT id, enc FROM jobs WHERE created_by = ?').all(userId) as any[];
    const jobs = db.prepare('SELECT * FROM jobs WHERE created_by = ? AND enc IS NULL').all(userId) as any[];
    const ids = allOwned.map(j => j.id);
    const ph = ids.map(() => '?').join(',');
    const inJobs = (sql: string) => (ids.length ? db.prepare(sql.replace('%IN%', ph)).all(...ids) : []) as any[];

    const expenses = inJobs('SELECT * FROM expenses WHERE job_id IN (%IN%) AND (enc IS NULL OR (receipt_url IS NOT NULL AND is_encrypted = 0))');
    const tagsByExpense = expenses.length
      ? db.prepare(`SELECT et.expense_id, t.id, t.name, t.color FROM expense_tags et JOIN tags t ON t.id = et.tag_id
                    WHERE et.expense_id IN (${expenses.map(() => '?').join(',')})`).all(...expenses.map(e => e.id)) as any[]
      : [];

    res.json({
      owned_job_ids: ids,
      jobs,
      expenses: expenses.map(e => ({ ...e, tags: tagsByExpense.filter(t => t.expense_id === e.id).map(({ id, name, color }) => ({ id, name, color })) })),
      wishlist: inJobs('SELECT * FROM wishlist_items WHERE job_id IN (%IN%) AND enc IS NULL'),
      subscriptions: inJobs('SELECT * FROM subscriptions WHERE job_id IN (%IN%) AND is_active = 1 AND enc IS NULL'),
      members: inJobs("SELECT ju.job_id, ju.user_id, COALESCE(ju.status,'active') AS status, u.public_key FROM job_users ju JOIN users u ON u.id = ju.user_id WHERE ju.job_id IN (%IN%)"),
      job_keys: db.prepare('SELECT job_id, encrypted_job_key FROM job_keys WHERE user_id = ?').all(userId),
      tags: db.prepare('SELECT * FROM tags WHERE user_id = ?').all(userId),
      tag_tax_mappings: db.prepare('SELECT m.tag_id, m.schedule_c_line FROM tag_tax_mappings m JOIN tags t ON t.id = m.tag_id WHERE t.user_id = ?').all(userId),
      expense_tax_mappings: db.prepare('SELECT expense_id, schedule_c_line FROM expense_tax_mappings WHERE user_id = ?').all(userId),
      tax_settings: db.prepare('SELECT * FROM tax_settings WHERE user_id = ?').get(userId) ?? null,
      w2_forms: db.prepare('SELECT * FROM w2_forms WHERE user_id = ?').all(userId),
      invoice_template: db.prepare('SELECT * FROM invoice_templates WHERE user_id = ?').get(userId) ?? null,
      ai_settings: {
        ai_api_key: user.ai_api_key, ai_base_url: user.ai_base_url, ai_model: user.ai_model,
        use_on_device_ai: user.use_on_device_ai, on_device_ai_model: user.on_device_ai_model,
      },
    });
  });

  app.post('/api/v2/migration/complete', ...guard, (req: any, res) => {
    const userId = req.user.id;
    const user = db.prepare('SELECT kdf_version, e2ee_version FROM users WHERE id = ?').get(userId) as any;
    if ((user.kdf_version ?? 1) < 2) return res.status(409).json({ error: 'Upgrade your account keys first' });
    if ((user.e2ee_version ?? 1) >= 2) return res.json({ success: true, already: true });

    const count = (sql: string) => (db.prepare(sql).get(userId) as any).c;
    const remaining =
      count("SELECT COUNT(*) AS c FROM jobs WHERE created_by = ? AND enc IS NULL") +
      count("SELECT COUNT(*) AS c FROM expenses WHERE enc IS NULL AND job_id IN (SELECT id FROM jobs WHERE created_by = ?)") +
      count("SELECT COUNT(*) AS c FROM wishlist_items WHERE enc IS NULL AND job_id IN (SELECT id FROM jobs WHERE created_by = ?)") +
      count("SELECT COUNT(*) AS c FROM subscriptions WHERE enc IS NULL AND is_active = 1 AND job_id IN (SELECT id FROM jobs WHERE created_by = ?)") +
      count("SELECT COUNT(*) AS c FROM expenses WHERE receipt_url IS NOT NULL AND is_encrypted = 0 AND job_id IN (SELECT id FROM jobs WHERE created_by = ?)");
    if (remaining > 0) return res.status(409).json({ error: `${remaining} record(s) are not encrypted yet`, remaining });

    db.transaction(() => {
      db.prepare('DELETE FROM expense_tax_mappings WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM tag_tax_mappings WHERE tag_id IN (SELECT id FROM tags WHERE user_id = ?)').run(userId);
      db.prepare('DELETE FROM expense_tags WHERE tag_id IN (SELECT id FROM tags WHERE user_id = ?)').run(userId);
      db.prepare('DELETE FROM tags WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM tax_settings WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM w2_forms WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM invoice_templates WHERE user_id = ?').run(userId);
      db.prepare('UPDATE users SET ai_api_key = NULL, ai_base_url = NULL, ai_model = NULL, on_device_ai_model = NULL, use_on_device_ai = 0, e2ee_version = 2 WHERE id = ?').run(userId);
    })();

    // Make sure the deleted plaintext is physically gone from the database file and write-ahead log.
    try { db.pragma('wal_checkpoint(TRUNCATE)'); db.exec('VACUUM'); } catch (e) { console.error('VACUUM after migration failed:', e); }
    res.json({ success: true });
  });
}
