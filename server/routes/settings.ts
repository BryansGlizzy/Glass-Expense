import type { Express } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { APP_URL, JWT_SECRET } from '../config.js';
import { createOAuthClient } from '../google-calendar.js';
import { sendActivityDigestEmail, sendSubscriptionReminderEmail } from '../email.js';
import { sendReportForUser } from '../sweeps.js';
import { ValidationError, assertSafeOutboundUrl, oneOf, str } from '../security.js';
import { authenticateToken, requireSession, enforceKeyLimits, aiLimiter, mailLimiter, envelope, isUuid } from '../middleware.js';
import { serverCryptoAvailable, wrapForServer } from '../server-crypto.js';
import { parseScope, parseBundle, sealBundle, mergeBundle } from '../agent-keys.js';
import { generateActivityDigest, calculateNextRun } from '../sweeps.js';

export function registerSettingsRoutes(app: Express) {
  // ── API keys ────────────────────────────────────────────────────────────────
  // Keys are generated in the browser (src/e2ee/crypto.ts → createApiKeySecrets) because each key carries a private
  // decryption half that must never reach the server. The server only stores the SHA-256 of the public half and a copy of
  // the user's calendar key wrapped under the private half. API keys are valid ONLY for GET /api/calendar/schedule.
  app.get('/api/keys', authenticateToken, requireSession, enforceKeyLimits, (req: any, res) => {
    const rows = db.prepare(`SELECT id, name, created_at, last_used_at, (wrapped_calendar_key IS NOT NULL) AS has_calendar_key, agent_scope
                             FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`).all(req.user.id) as any[];
    res.json(rows.map(({ agent_scope, ...r }) => {
      let scope: any = null;
      try { scope = agent_scope ? JSON.parse(agent_scope) : null; } catch { /* ignore */ }
      return { ...r, agent_access: scope?.access ?? null, agent_all_jobs: scope ? Boolean(scope.all_jobs) : null };
    }));
  });

  app.post('/api/keys', authenticateToken, requireSession, enforceKeyLimits, (req: any, res) => {
    try {
      const name = str(req.body?.name, 'Name', { required: true, max: 100 })!;
      const keyHash = req.body?.key_hash;
      if (typeof keyHash !== 'string' || !/^[0-9a-f]{64}$/.test(keyHash)) throw new ValidationError('key_hash must be a SHA-256 hex digest');
      const wrapped = envelope(req.body?.wrapped_calendar_key, 'wrapped_calendar_key', 4096);
      if (db.prepare('SELECT 1 FROM api_keys WHERE key_hash = ?').get(keyHash)) throw new ValidationError('Key already exists');
      // The browser picks the id because the agent "inbox" key is derived from it.
      const id = req.body?.id !== undefined ? String(req.body.id) : uuidv4();
      if (!isUuid(id)) throw new ValidationError('id must be a UUID');
      if (db.prepare('SELECT 1 FROM api_keys WHERE id = ?').get(id)) throw new ValidationError('Key already exists');
      // Optional, explicitly opted-in agent access (see server/agent-keys.ts).
      let agentScope: string | null = null, agentBundle: string | null = null;
      if (req.body?.agent) {
        const scope = parseScope(req.body.agent);
        agentScope = JSON.stringify(scope);
        agentBundle = sealBundle(id, parseBundle(req.body.agent.bundle, req.user.id));
      }
      db.prepare('INSERT INTO api_keys (id, user_id, key_hash, name, wrapped_calendar_key, agent_scope, agent_bundle) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, req.user.id, keyHash, name, wrapped, agentScope, agentBundle);
      res.json({ key: db.prepare('SELECT id, name, created_at FROM api_keys WHERE id = ?').get(id) });
    } catch (err: any) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  /** The owner's browser adds keys for jobs created/joined since the key was made (only for keys that cover all jobs). */
  app.put('/api/keys/:id/agent-bundle', authenticateToken, requireSession, (req: any, res) => {
    try {
      const row = db.prepare('SELECT agent_scope FROM api_keys WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id) as any;
      if (!row?.agent_scope) return res.status(404).json({ error: 'Agent access is not enabled for this key' });
      if (!JSON.parse(row.agent_scope).all_jobs) return res.status(409).json({ error: 'This key is limited to the jobs chosen when it was created' });
      mergeBundle(req.params.id, req.user.id, parseBundle(req.body, req.user.id));
      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });

  /** Removes agent access but keeps the (calendar-only) key. Deletes the server-held bundle. */
  app.delete('/api/keys/:id/agent', authenticateToken, requireSession, (req: any, res) => {
    db.prepare('UPDATE api_keys SET agent_scope = NULL, agent_bundle = NULL WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  });

  app.delete('/api/keys/:id', authenticateToken, requireSession, (req: any, res) => {
    db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  });

  // ── Device / AI verification ────────────────────────────────────────────────
  app.post('/api/settings/device-token', authenticateToken, requireSession, (req: any, res) => {
    try {
      const token = str(req.body?.token, 'Token', { required: true, max: 4096 });
      db.prepare('UPDATE users SET device_token = ? WHERE id = ?').run(token, req.user.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // The AI provider key is stored encrypted in the user's own vault; the server never keeps it. For verification it is
  // supplied in the request body and discarded immediately.
  app.post('/api/settings/ai/verify', authenticateToken, requireSession, aiLimiter, async (req: any, res) => {
    try {
      const apiKey = str(req.body?.ai_api_key, 'API key', { required: true, max: 500 })!;
      const baseUrl = await assertSafeOutboundUrl(req.body?.ai_base_url);
      const response = await fetch(`${baseUrl}/models`, {
        method: 'GET', headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (response.ok) return res.json({ success: true });
      return res.status(400).json({ error: `Verification failed (provider returned HTTP ${response.status})` });
    } catch (err: any) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      return res.status(502).json({ error: 'Could not reach the AI provider' });
    }
  });

  // ── Automated reports (activity digest: counts only, since content is encrypted) ─
  app.get('/api/settings/reports', authenticateToken, requireSession, (req: any, res) => {
    let settings = db.prepare('SELECT * FROM report_settings WHERE user_id = ?').get(req.user.id) as any;
    if (!settings) {
      db.prepare('INSERT INTO report_settings (user_id) VALUES (?)').run(req.user.id);
      settings = db.prepare('SELECT * FROM report_settings WHERE user_id = ?').get(req.user.id);
    }
    const u = db.prepare('SELECT server_report_key FROM users WHERE id = ?').get(req.user.id) as any;
    const snap = db.prepare('SELECT updated_at FROM report_snapshots WHERE user_id = ?').get(req.user.id) as any;
    res.json({ ...settings, report_delegated: Boolean(u?.server_report_key), report_available: serverCryptoAvailable(), snapshot_updated_at: snap?.updated_at ?? null });
  });

  /**
   * Opt-in "reports with figures". The browser builds a compact aggregate snapshot (totals per day/job/category) and uploads it
   * encrypted under a dedicated *report key*; handing the server that key lets it decrypt ONLY that snapshot to write the e-mail.
   * It never receives job keys, individual expenses, notes, clients or receipts. DELETE revokes the key and erases the snapshot.
   */
  app.post('/api/settings/reports/delegation', authenticateToken, requireSession, (req: any, res) => {
    if (!serverCryptoAvailable()) return res.status(503).json({ error: 'Reports with figures are not configured on this server (SERVER_WRAP_KEY).' });
    const raw = typeof req.body?.report_key === 'string' ? Buffer.from(req.body.report_key, 'base64') : null;
    if (!raw || raw.length !== 32) return res.status(400).json({ error: 'report_key must be 32 bytes, base64 encoded' });
    db.prepare('UPDATE users SET server_report_key = ? WHERE id = ?').run(wrapForServer(raw, 'server-report-key'), req.user.id);
    res.json({ success: true });
  });

  app.delete('/api/settings/reports/delegation', authenticateToken, requireSession, (req: any, res) => {
    db.transaction(() => {
      db.prepare('UPDATE users SET server_report_key = NULL WHERE id = ?').run(req.user.id);
      db.prepare('DELETE FROM report_snapshots WHERE user_id = ?').run(req.user.id);
    })();
    res.json({ success: true });
  });

  app.put('/api/settings/reports/snapshot', authenticateToken, requireSession, (req: any, res) => {
    try {
      const u = db.prepare('SELECT server_report_key FROM users WHERE id = ?').get(req.user.id) as any;
      if (!u?.server_report_key) return res.status(409).json({ error: 'Reports with figures are not enabled' });
      const enc = envelope(req.body?.enc, 'enc', 400 * 1024);
      db.prepare(`INSERT INTO report_snapshots (user_id, enc, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(user_id) DO UPDATE SET enc = excluded.enc, updated_at = CURRENT_TIMESTAMP`).run(req.user.id, enc);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/settings/reports', authenticateToken, requireSession, (req: any, res) => {
    let frequency: string;
    try {
      frequency = oneOf(req.body?.frequency, 'Frequency', ['NONE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
    const nextRun = calculateNextRun(frequency);
    db.prepare(`INSERT INTO report_settings (user_id, frequency, next_run_at) VALUES (?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET frequency = ?, next_run_at = ?`).run(req.user.id, frequency, nextRun, frequency, nextRun);
    res.json({ success: true, frequency, next_run_at: nextRun });
  });

  const sendDigest = async (req: any, res: any, frequency: string) => {
    const user = db.prepare('SELECT id, username, email FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user.email) return res.status(400).json({ error: 'No email associated with account.' });
    // Full report (with figures) if the user opted in and has a snapshot; otherwise the content-free activity digest.
    const withFigures = await sendReportForUser(user.id, frequency);
    if (!withFigures) await sendActivityDigestEmail(user.email, user.username, generateActivityDigest(user.id, frequency));
    res.json({ success: true, message: withFigures ? 'Report sent' : 'Activity summary sent', with_figures: withFigures });
  };
  app.post('/api/settings/reports/test', authenticateToken, requireSession, mailLimiter, (req: any, res) => sendDigest(req, res, 'WEEKLY'));
  app.post('/api/settings/reports/generate', authenticateToken, requireSession, mailLimiter, (req: any, res) => {
    const s = db.prepare('SELECT frequency FROM report_settings WHERE user_id = ?').get(req.user.id) as any;
    return sendDigest(req, res, s && s.frequency !== 'NONE' ? s.frequency : 'WEEKLY');
  });
  app.post('/api/settings/subscriptions/test', authenticateToken, requireSession, mailLimiter, async (req: any, res) => {
    const user = db.prepare('SELECT username, email FROM users WHERE id = ?').get(req.user.id) as any;
    if (!user.email) return res.status(400).json({ error: 'No email associated with account.' });
    await sendSubscriptionReminderEmail(user.email, user.username, new Date(Date.now() + 2 * 86400000).toISOString(), 2);
    res.json({ success: true, message: 'Test subscription reminder email sent' });
  });

  // ── Google Calendar ─────────────────────────────────────────────────────────
  app.get('/api/auth/google', authenticateToken, requireSession, (req: any, res) => {
    // `state` is a short-lived signed token binding the consent flow to this user (prevents account-linking CSRF).
    const state = jwt.sign({ uid: req.user.id, purpose: 'google-oauth' }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '10m' });
    res.json({
      url: createOAuthClient().generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
        prompt: 'consent',
        state,
      }),
    });
  });

  app.get('/api/auth/google/callback', async (req: any, res) => {
    const { code, state } = req.query;
    if (typeof code !== 'string' || typeof state !== 'string' || !code || !state) return res.status(400).send('Missing code or state');
    let userId: string;
    try {
      const payload = jwt.verify(state, JWT_SECRET, { algorithms: ['HS256'] }) as any;
      if (payload.purpose !== 'google-oauth' || typeof payload.uid !== 'string') throw new Error('bad state');
      userId = payload.uid;
    } catch {
      return res.status(400).send('Invalid or expired authorization state. Please start the connection again from Settings.');
    }
    try {
      const { tokens } = await createOAuthClient().getToken(code);
      if (tokens.refresh_token) {
        // Sync stays off until the user also grants the server read access to job titles (calendar delegation).
        db.prepare('UPDATE users SET google_refresh_token = ?, google_sync_jobs = 1, google_sync_expenses = 0 WHERE id = ?').run(tokens.refresh_token, userId);
      }
      res.redirect(`${APP_URL}/settings?google_sync=success`);
    } catch (err) {
      console.error('Google OAuth callback error:', err);
      res.status(500).send('Failed to exchange Google OAuth code');
    }
  });

  app.get('/api/settings/google', authenticateToken, requireSession, (req: any, res) => {
    const u = db.prepare('SELECT google_refresh_token, google_calendar_id, google_sync_jobs, server_calendar_key FROM users WHERE id = ?').get(req.user.id) as any;
    res.json({
      isConnected: !!u?.google_refresh_token,
      calendarId: u?.google_calendar_id || 'primary',
      syncJobs: !!u?.google_sync_jobs,
      syncExpenses: false, // expense events would expose amounts/descriptions to the server and Google; removed with E2EE
      serverSyncEnabled: !!u?.server_calendar_key,
      serverSyncAvailable: serverCryptoAvailable(),
    });
  });

  app.patch('/api/settings/google', authenticateToken, requireSession, (req: any, res) => {
    const calendarId = str(req.body?.calendarId, 'Calendar', { max: 200 }) || 'primary';
    db.prepare('UPDATE users SET google_calendar_id = ?, google_sync_jobs = ?, google_sync_expenses = 0 WHERE id = ?').run(calendarId, req.body?.syncJobs ? 1 : 0, req.user.id);
    res.json({ success: true });
  });

  app.delete('/api/settings/google/disconnect', authenticateToken, requireSession, (req: any, res) => {
    db.prepare('UPDATE users SET google_refresh_token = NULL, google_sync_jobs = 0, google_sync_expenses = 0, server_calendar_key = NULL WHERE id = ?').run(req.user.id);
    res.json({ success: true });
  });

  /**
   * Opt-in: hands the server the user's calendar key (NOT a master or job key) so it can decrypt job titles and push
   * events to Google in the background. Sealed under SERVER_WRAP_KEY at rest. DELETE revokes it immediately.
   */
  app.post('/api/settings/google/delegation', authenticateToken, requireSession, (req: any, res) => {
    if (!serverCryptoAvailable()) return res.status(503).json({ error: 'Server-side calendar sync is not configured on this instance (SERVER_WRAP_KEY).' });
    const key = req.body?.calendar_key;
    const raw = typeof key === 'string' ? Buffer.from(key, 'base64') : null;
    if (!raw || raw.length !== 32) return res.status(400).json({ error: 'calendar_key must be 32 bytes, base64 encoded' });
    db.prepare('UPDATE users SET server_calendar_key = ? WHERE id = ?').run(wrapForServer(raw), req.user.id);
    res.json({ success: true });
  });

  app.delete('/api/settings/google/delegation', authenticateToken, requireSession, (req: any, res) => {
    db.prepare('UPDATE users SET server_calendar_key = NULL WHERE id = ?').run(req.user.id);
    res.json({ success: true });
  });
}
