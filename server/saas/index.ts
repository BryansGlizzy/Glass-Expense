// SaaS Module for GlassExpense
// This module contains logic for tier-based limits, Stripe/PayPal integration, and subscription handling.
// It is dynamically loaded by server.ts if process.env.MODE === 'saas'.

const getSetting = (db: any, keyName: string, defaultVal: number) => {
  const stmt = db.prepare('SELECT value FROM saas_settings WHERE key_name = ?');
  const res = stmt.get(keyName);
  return res ? parseInt(res.value, 10) : defaultVal;
};

export const enforceJobLimits = (req: any, res: any, next: any) => {
  if (req.user && req.user.plan === 'free' && !req.user.isAdmin) {
    if (global.saasDb) {
      const db = global.saasDb;
      const limit = getSetting(db, 'max_active_jobs_free', 2);
      const countStmt = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE created_by = ? AND is_archived = 0');
      const { count } = countStmt.get(req.user.id) as any;
      if (count >= limit) {
        return res.status(403).json({ error: `Free tier limit reached (${limit} Active Jobs). Please upgrade to create more jobs.` });
      }
    }
  }
  next();
};

export const enforceArchiveLimits = (req: any, res: any, next: any) => {
  if (req.user && req.user.plan === 'free' && !req.user.isAdmin && req.body.is_archived) {
    if (global.saasDb) {
      const db = global.saasDb;
      const limit = getSetting(db, 'max_archived_jobs_free', 6);
      const countStmt = db.prepare('SELECT COUNT(*) as count FROM jobs WHERE created_by = ? AND is_archived = 1');
      const { count } = countStmt.get(req.user.id) as any;
      if (count >= limit) {
        return res.status(403).json({ error: `Free tier limit reached (${limit} Archived Jobs). Please upgrade.` });
      }
    }
  }
  next();
};

export const enforceJoinLimits = (req: any, res: any, next: any) => {
  if (req.user && req.user.plan === 'free' && !req.user.isAdmin) {
    if (global.saasDb) {
      const db = global.saasDb;
      const limit = getSetting(db, 'max_joined_jobs_free', 4);
      const countStmt = db.prepare(`
        SELECT COUNT(*) as count FROM job_users ju 
        JOIN jobs j ON ju.job_id = j.id 
        WHERE ju.user_id = ? AND j.created_by != ?
      `);
      const { count } = countStmt.get(req.user.id, req.user.id) as any;
      if (count >= limit) {
        return res.status(403).json({ error: `Free tier limit reached (${limit} Joined Jobs). Please upgrade.` });
      }
    }
  }
  next();
};

export const enforceMemberLimits = (req: any, res: any, next: any) => {
  if (global.saasDb) {
    const db = global.saasDb;
    const jobId = req.params.jobId || req.body.jobId;
    if (!jobId) return next();

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) return next();

    const creator = db.prepare('SELECT plan, is_admin FROM users WHERE id = ?').get(job.created_by) as any;
    if (creator && creator.plan === 'free' && creator.is_admin !== 1) {
      const limit = getSetting(db, 'max_members_per_job_free', 4);
      const countStmt = db.prepare('SELECT COUNT(*) as count FROM job_users WHERE job_id = ? AND user_id != ?');
      const { count } = countStmt.get(jobId, job.created_by) as any;
      if (count >= limit) {
        return res.status(403).json({ error: `Job creator is on Free tier. Limit reached (${limit} members).` });
      }
    }
  }
  next();
};

export const enforceAiLimits = (req: any, res: any, next: any) => {
  if (req.user && req.user.plan === 'free' && !req.user.isAdmin) {
    if (global.saasDb) {
      const isEnabled = getSetting(global.saasDb, 'is_ai_enabled_free', 0);
      if (!isEnabled) {
        return res.status(403).json({ error: 'AI features are disabled on the Free tier. Please upgrade.' });
      }
    }
  }
  next();
};

export const enforceKeyLimits = (req: any, res: any, next: any) => {
  if (req.user && req.user.plan === 'free' && !req.user.isAdmin) {
    if (global.saasDb) {
      const isEnabled = getSetting(global.saasDb, 'is_api_enabled_free', 0);
      if (!isEnabled) {
        return res.status(403).json({ error: 'API access is disabled on the Free tier. Please upgrade.' });
      }
    }
  }
  next();
};

export const init = (app: any, db: any) => {
  // Store db instance globally for middleware access
  (global as any).saasDb = db;
  
  console.log('SaaS Module initialized successfully.');

  // Placeholder for Stripe Checkout Session
  app.post('/api/payments/create-checkout-session', (req: any, res: any) => {
    // Implement Stripe/PayPal logic here
    // Redirect URL should come from the frontend
    res.json({ url: '/checkout-placeholder' });
  });

  // Placeholder for Webhook (upgrades user plan)
  app.post('/api/payments/webhook', (req: any, res: any) => {
    // Handle webhook events (e.g. checkout.session.completed)
    // Update user plan to 'paid'
    res.json({ received: true });
  });
};
