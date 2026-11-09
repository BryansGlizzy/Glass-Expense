import { IS_DEV, IS_SAAS, ROOT_DIR, UPDATES_DIR, DB_PATH, APP_URL, PORT, HOST, TRUST_PROXY, ALLOWED_ORIGINS, CSP_REPORT_ONLY } from './config.js';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import db from './db.js';
import { ValidationError } from './security.js';
import { apiLimiter, verifySessionToken, getJobAccess, saas } from './middleware.js';
import { isInstanceUnlocked } from './helpers.js';
import { runReportSweep, runReminderSweep } from './sweeps.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerDataRoutes } from './routes/data.js';
import { registerLegacyRoutes } from './routes/legacy.js';
import { registerAgentRoutes } from './routes/agent.js';
import { serverCryptoAvailable } from './server-crypto.js';
import { registerOcrRoutes } from './routes/ocr.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerInvoiceMailRoutes } from './routes/invoices-mail.js';
import { registerResearchWorker } from './research.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', TRUST_PROXY);
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: ALLOWED_ORIGINS } });

// ── Security headers ────────────────────────────────────────────────────────
// Tesseract worker/core/language data are self-hosted under /vendor/tesseract (see scripts/copy-tesseract-assets.mjs),
// so no third-party script origins are needed. Dev mode skips CSP because Vite HMR needs inline scripts.
const wsOrigin = APP_URL.replace(/^http/, 'ws');
app.use(helmet({
  contentSecurityPolicy: IS_DEV ? false : {
    useDefaults: false,
    reportOnly: CSP_REPORT_ONLY,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      workerSrc: ["'self'", 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'blob:', 'data:', wsOrigin],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(APP_URL.startsWith('https://') ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin' },
}));
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)) }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiLimiter);

// Receipts are NOT served statically any more: they are encrypted blobs fetched through the authenticated
// GET /api/v2/uploads/:filename route. Old /uploads URLs simply 404.
app.use('/uploads', (req, res) => res.status(404).send('Not found.'));

// OTA bundles (public by design; integrity is enforced client-side via the published checksum)
app.use('/updates', express.static(UPDATES_DIR, { index: false, dotfiles: 'deny' }));
app.use('/updates', (req, res) => res.status(404).send('Update bundle not found.'));

const publicDir = path.join(ROOT_DIR, 'public');
if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

// ── Misc public endpoints ───────────────────────────────────────────────────
app.get('/api/info', (req, res) => {
  const limits = { active: 2, joined: 4, archived: 6 };
  try {
    const get = (key: string, d: number) => {
      const row = db.prepare('SELECT value FROM saas_settings WHERE key_name = ?').get(key) as any;
      return row ? parseInt(row.value, 10) : d;
    };
    limits.active = get('max_active_jobs_free', 2);
    limits.joined = get('max_joined_jobs_free', 4);
    limits.archived = get('max_archived_jobs_free', 6);
  } catch { /* table may not exist yet */ }
  res.json({ isSaaS: IS_SAAS, isUnlocked: !IS_SAAS ? isInstanceUnlocked() : false, version: '2.0.0', e2ee: 2, limits, agent_access_available: serverCryptoAvailable() });
});

// Self-Hosted Over-The-Air (OTA) App Update Check
app.get('/api/app-update/check', (req, res) => {
  try {
    const versionFilePath = path.join(UPDATES_DIR, 'version.json');
    if (!fs.existsSync(versionFilePath)) return res.json({ available: false });
    const versionData = JSON.parse(fs.readFileSync(versionFilePath, 'utf8'));
    if (!versionData?.version) return res.json({ available: false });
    let bundleUrl = versionData.bundleUrl || '';
    if (bundleUrl && !/^https?:\/\//.test(bundleUrl)) bundleUrl = `${APP_URL}${bundleUrl.startsWith('/') ? '' : '/'}${bundleUrl}`;
    res.json({
      available: true, version: versionData.version, url: bundleUrl, checksum: versionData.checksum || '',
      releaseNotes: versionData.releaseNotes || '', publishedAt: versionData.publishedAt || new Date().toISOString(),
    });
  } catch (err) {
    console.error('OTA version check error:', err);
    res.json({ available: false });
  }
});

// ── Sockets: authenticated; rooms limited to jobs the user can access ───────
io.use((socket, next) => {
  const user = verifySessionToken(socket.handshake.auth?.token);
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = { id: user.id };
  next();
});
io.on('connection', (socket) => {
  socket.join(`user:${socket.data.user.id}`); // personal notifications (e.g. "someone accepted your invite")
  socket.on('join_job', (jobId) => { if (getJobAccess(jobId, socket.data.user.id)) socket.join(jobId); });
  socket.on('leave_job', (jobId) => { if (typeof jobId === 'string') socket.leave(jobId); });
});

// ── Routes ──────────────────────────────────────────────────────────────────
registerAuthRoutes(app);
registerAdminRoutes(app);
registerSettingsRoutes(app);
registerDataRoutes(app, io);
registerLegacyRoutes(app);
registerAgentRoutes(app, io);
registerOcrRoutes(app);
registerAiRoutes(app);
registerInvoiceMailRoutes(app);
registerResearchWorker(io);

// SaaS module (plan limits) — loaded after the routes so its placeholder routes cannot shadow them.
if (IS_SAAS) {
  try {
    const saasModule = await import('./saas/index.js');
    saas.limits = saasModule;
    saasModule.init(app, db);
  } catch (e) {
    console.error('CRITICAL: SaaS module missing or failed to load. Cannot start in SaaS mode.');
    console.error(e);
    process.exit(1);
  }
}

// ── Schedulers ──────────────────────────────────────────────────────────────
runReportSweep();
setInterval(runReportSweep, 60 * 60 * 1000);
runReminderSweep(io);
setInterval(() => runReminderSweep(io), 60 * 60 * 1000);

async function startServer() {
  // Unknown API routes must 404 as JSON, never fall through to the SPA.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  if (IS_DEV) {
    // Development only (NODE_ENV=development). Production never loads Vite.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: ROOT_DIR,
      appType: 'spa',
      server: {
        middlewareMode: true,
        // Replaces Vite's default deny-list; keeps runtime data and secrets unreachable even in dev.
        fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/secrets/**', '**/server/**', '**/scripts/**', '**/tests/**', '**/*firebase*adminsdk*', '**/*.db', '**/*.db-*'] },
      },
    });
    app.use(vite.middlewares);
    console.warn('[dev] Running with the Vite dev server. Never run this mode on a public host.');
  } else {
    const distDir = path.join(ROOT_DIR, 'dist');
    if (!fs.existsSync(path.join(distDir, 'index.html'))) console.warn('dist/index.html not found. Run `npm run build` first.');
    app.use(express.static(distDir));
    app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  // Central error handler: consistent JSON, no internals leaked.
  app.use((err: any, req: any, res: any, next: any) => {
    if (res.headersSent) return next(err);
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    if (err instanceof multer.MulterError) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
        error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 15 MB).' : 'Invalid upload.',
      });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    res.status(500).json({ error: 'Internal server error' });
  });

  httpServer.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT} (${IS_DEV ? 'development' : 'production'}${IS_SAAS ? ', saas' : ''})`);
    console.log(`Data directory: ${path.dirname(DB_PATH)}`);
  });
}

startServer();
