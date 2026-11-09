import Database from 'better-sqlite3';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { DB_PATH, ADMIN_EMAIL } from './config.js';

const db = new Database(DB_PATH, { timeout: 10000 });
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
try { fs.chmodSync(DB_PATH, 0o600); } catch { /* best effort */ }
// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    ai_api_key TEXT,
    ai_base_url TEXT DEFAULT 'https://api.openai.com/v1',
    ai_model TEXT DEFAULT 'gpt-4o-mini',
    reset_token TEXT,
    reset_token_expiry DATETIME,
    plan TEXT DEFAULT 'free',
    subscription_id TEXT,
    customer_id TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    created_by TEXT NOT NULL,
    is_archived INTEGER DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    client_name TEXT,
    client_address TEXT,
    client_email TEXT,
    job_rate REAL DEFAULT 0,
    invoice_notes TEXT,
    invoice_tag TEXT,
    invoice_seq INTEGER,
    invoice_number TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS job_users (
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (job_id, user_id),
    FOREIGN KEY (job_id) REFERENCES jobs (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    receipt_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS wishlist_items (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    estimated_cost REAL,
    url TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS expense_tags (
    expense_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (expense_id, tag_id),
    FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS report_settings (
    user_id TEXT PRIMARY KEY,
    frequency TEXT NOT NULL DEFAULT 'NONE',
    last_run_at DATETIME,
    next_run_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    billing_day INTEGER NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'MONTHLY',
    is_active INTEGER DEFAULT 1,
    last_generated_at DATETIME,
    next_generation_date DATETIME,
    entry_type TEXT DEFAULT 'expense',
    remind_1_day_before INTEGER DEFAULT 0,
    remind_2_days_before INTEGER DEFAULT 0,
    remind_7_days_before INTEGER DEFAULT 0,
    remind_1_sent INTEGER DEFAULT 0,
    remind_2_sent INTEGER DEFAULT 0,
    remind_7_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS saas_settings (
    id TEXT PRIMARY KEY,
    key_name TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS license_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT UNIQUE NOT NULL,
    plan TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    activated_at DATETIME,
    activated_by TEXT,
    FOREIGN KEY (activated_by) REFERENCES users (id)
  );

  CREATE TABLE IF NOT EXISTS invoice_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_name TEXT,
    company_address TEXT,
    company_logo_url TEXT,
    default_hourly_rate REAL DEFAULT 0,
    footer_notes TEXT,
    default_prefix TEXT DEFAULT 'INV',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS w2_forms (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    employer_name TEXT NOT NULL,
    employer_ein TEXT,
    is_scorp_officer_w2 INTEGER DEFAULT 0,
    wages_box1 REAL NOT NULL DEFAULT 0,
    fed_withholding_box2 REAL NOT NULL DEFAULT 0,
    ss_wages_box3 REAL NOT NULL DEFAULT 0,
    ss_withholding_box4 REAL NOT NULL DEFAULT 0,
    medicare_wages_box5 REAL NOT NULL DEFAULT 0,
    medicare_withholding_box6 REAL NOT NULL DEFAULT 0,
    state_code TEXT,
    state_wages_box16 REAL DEFAULT 0,
    state_withholding_box17 REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tax_settings (
    user_id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL DEFAULT 2025,
    filing_status TEXT NOT NULL DEFAULT 'single',
    entity_type TEXT NOT NULL DEFAULT 'sole_proprietorship',
    scorp_officer_salary REAL DEFAULT 0,
    scorp_ein TEXT,
    state_code TEXT DEFAULT 'TX',
    estimated_payments_made REAL DEFAULT 0,
    retirement_contributions REAL DEFAULT 0,
    business_miles REAL DEFAULT 0,
    vehicle_deduction_method TEXT DEFAULT 'auto_best',
    home_office_sqft REAL DEFAULT 0,
    selected_job_ids TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tag_tax_mappings (
    tag_id TEXT PRIMARY KEY,
    schedule_c_line TEXT NOT NULL,
    FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
  );
`);

// Initialize default SaaS settings
try {
  const defaultSettings = [
    { key: 'max_active_jobs_free', value: '2' },
    { key: 'max_archived_jobs_free', value: '6' },
    { key: 'max_joined_jobs_free', value: '4' },
    { key: 'max_members_per_job_free', value: '4' },
    { key: 'is_ai_enabled_free', value: '0' },
    { key: 'is_api_enabled_free', value: '0' }
  ];

  const checkStmt = db.prepare('SELECT COUNT(*) as count FROM saas_settings');
  const { count } = checkStmt.get() as any;

  if (count === 0) {
    const insertStmt = db.prepare('INSERT INTO saas_settings (id, key_name, value) VALUES (?, ?, ?)');
    for (const setting of defaultSettings) {
      insertStmt.run(uuidv4(), setting.key, setting.value);
    }
  }
} catch (e) {
  console.error("Failed to initialize saas_settings defaults:", e);
}

try {
  db.exec('ALTER TABLE jobs ADD COLUMN is_archived INTEGER DEFAULT 0');
} catch (e) {}

try {
  db.exec('ALTER TABLE expenses ADD COLUMN is_encrypted INTEGER DEFAULT 0');
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN mode TEXT DEFAULT 'expense'");
} catch (e) {}

try {
  db.exec("ALTER TABLE expenses ADD COLUMN entry_type TEXT DEFAULT 'expense'");
} catch (e) {}

try {
  db.exec('ALTER TABLE users ADD COLUMN ai_api_key TEXT');
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN ai_base_url TEXT DEFAULT 'https://api.openai.com/v1'");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN ai_model TEXT DEFAULT 'gpt-4o-mini'");
} catch (e) {}

try {
  db.exec("ALTER TABLE expenses ADD COLUMN date TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN tag TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN ai_tag_generation INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT");
} catch (e) {}

try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN reset_token TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN reset_token_expiry DATETIME");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN use_on_device_ai INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN on_device_ai_model TEXT DEFAULT 'Xenova/donut-base-finetuned-cord-v2'");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN updated_at DATETIME");
  db.exec("UPDATE jobs SET updated_at = created_at WHERE updated_at IS NULL");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'free'");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN subscription_id TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN customer_id TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN master_key_encrypted TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN start_date TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN end_date TEXT");
} catch (e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS job_keys (
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    encrypted_job_key TEXT NOT NULL,
    PRIMARY KEY (job_id, user_id),
    FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
`);

try {
  db.exec("ALTER TABLE users ADD COLUMN google_refresh_token TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN google_calendar_id TEXT DEFAULT 'primary'");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN google_sync_jobs INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN google_sync_expenses INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN google_event_id TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE expenses ADD COLUMN google_event_id TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN google_sync_expenses INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE subscriptions ADD COLUMN entry_type TEXT DEFAULT 'expense'");
} catch (e) {}

try {
  db.exec("ALTER TABLE subscriptions ADD COLUMN remind_1_day_before INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE subscriptions ADD COLUMN remind_2_days_before INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE subscriptions ADD COLUMN remind_7_days_before INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE subscriptions ADD COLUMN remind_1_sent INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE subscriptions ADD COLUMN remind_2_sent INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE subscriptions ADD COLUMN remind_7_sent INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE users ADD COLUMN device_token TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN client_name TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN client_address TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN client_email TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN job_rate REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN invoice_notes TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE invoice_templates ADD COLUMN default_prefix TEXT DEFAULT 'INV'");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN invoice_number TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN invoice_seq INTEGER");
} catch (e) {}

try {
  db.exec("ALTER TABLE jobs ADD COLUMN invoice_tag TEXT");
} catch (e) {}

import { formatInvoiceNumber, convertLegacyInvoiceNumber, formatInvoiceSequence, parseInvoiceSequence } from '../src/utils/invoice.ts';

try {
  const unassignedJobs = db.prepare("SELECT id, created_by, created_at, invoice_seq, invoice_tag FROM jobs WHERE invoice_seq IS NULL OR invoice_number IS NULL ORDER BY created_at ASC, id ASC").all() as any[];
  if (unassignedJobs.length > 0) {
    const userTagCounters: Record<string, Record<string, number>> = {};
    const updateStmt = db.prepare("UPDATE jobs SET invoice_seq = ?, invoice_number = ? WHERE id = ?");
    for (const j of unassignedJobs) {
      const tagKey = j.invoice_tag ? String(j.invoice_tag).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() : '__DEFAULT__';
      if (!userTagCounters[j.created_by]) userTagCounters[j.created_by] = {};
      if (userTagCounters[j.created_by][tagKey] === undefined) {
        const maxStmt = db.prepare("SELECT COALESCE(MAX(invoice_seq), 0) as maxSeq FROM jobs WHERE created_by = ? AND (invoice_tag = ? OR (invoice_tag IS NULL AND ? IS NULL))");
        const tagParam = j.invoice_tag || null;
        userTagCounters[j.created_by][tagKey] = (maxStmt.get(j.created_by, tagParam, tagParam) as any).maxSeq;
      }
      userTagCounters[j.created_by][tagKey] += 1;
      const seq = j.invoice_seq || userTagCounters[j.created_by][tagKey];
      const prefix = j.invoice_tag ? String(j.invoice_tag).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() : 'INV';
      const invNum = formatInvoiceNumber(prefix, seq);
      updateStmt.run(seq, invNum, j.id);
    }
  }
} catch (e) {}

try {
  // Convert legacy 5-digit invoice numbers (e.g. INV-00062 -> INV-A00062)
  const legacyJobs = db.prepare("SELECT id, invoice_number FROM jobs WHERE invoice_number IS NOT NULL").all() as any[];
  const updateInvStmt = db.prepare("UPDATE jobs SET invoice_number = ? WHERE id = ?");
  for (const j of legacyJobs) {
    if (j.invoice_number) {
      const converted = convertLegacyInvoiceNumber(j.invoice_number);
      if (converted !== j.invoice_number) {
        updateInvStmt.run(converted, j.id);
      }
    }
  }
} catch (e) {}

try {
  // Sync invoice_seq with invoice_number for tagged jobs where sequence was previously global
  const taggedJobs = db.prepare("SELECT id, invoice_number, invoice_seq FROM jobs WHERE invoice_tag IS NOT NULL AND invoice_number IS NOT NULL").all() as any[];
  const syncSeqStmt = db.prepare("UPDATE jobs SET invoice_seq = ? WHERE id = ?");
  for (const j of taggedJobs) {
    const parsed = parseInvoiceSequence(j.invoice_number);
    if (parsed && parsed !== j.invoice_seq) {
      syncSeqStmt.run(parsed, j.id);
    }
  }
} catch (e) {}

try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_invoice_number ON jobs (invoice_number)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_invoice_seq ON jobs (invoice_seq)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_invoice_tag ON jobs (invoice_tag)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_client_name ON jobs (client_name)");
} catch (e) {}

// Phase 4 Tax Management Migrations & Indexes
try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_w2_forms_user_year ON w2_forms (user_id, tax_year)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (date)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tag_tax_mappings_tag ON tag_tax_mappings (tag_id)");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN entity_type TEXT DEFAULT 'sole_proprietorship'");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN scorp_officer_salary REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN scorp_ein TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN business_miles REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN vehicle_deduction_method TEXT DEFAULT 'auto_best'");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN home_office_sqft REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN selected_job_ids TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE w2_forms ADD COLUMN is_scorp_officer_w2 INTEGER DEFAULT 0");
} catch (e) {}

// expense_tax_mappings is scoped per (expense, user): a member re-categorising an expense must not
// change another member's Schedule C result. Legacy rows (keyed by expense only) are migrated to the expense owner.
try {
  const cols = db.prepare("PRAGMA table_info(expense_tax_mappings)").all() as any[];
  if (cols.length > 0 && !cols.some(c => c.name === 'user_id')) {
    db.transaction(() => {
      db.exec("ALTER TABLE expense_tax_mappings RENAME TO expense_tax_mappings_legacy");
      db.exec(`
        CREATE TABLE expense_tax_mappings (
          expense_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          schedule_c_line TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (expense_id, user_id),
          FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
      `);
      db.exec(`
        INSERT OR IGNORE INTO expense_tax_mappings (expense_id, user_id, schedule_c_line, updated_at)
        SELECT m.expense_id, e.user_id, m.schedule_c_line, m.updated_at
        FROM expense_tax_mappings_legacy m JOIN expenses e ON e.id = m.expense_id
      `);
      db.exec("DROP TABLE expense_tax_mappings_legacy");
    })();
  } else if (cols.length === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS expense_tax_mappings (
        expense_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        schedule_c_line TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (expense_id, user_id),
        FOREIGN KEY (expense_id) REFERENCES expenses (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );
    `);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_expense_tax_mappings_user ON expense_tax_mappings (user_id, expense_id)");
} catch (e) {
  console.error('FATAL: expense_tax_mappings migration failed:', e);
  throw e;
}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN additional_gross_income REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN returns_and_allowances REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN cost_of_goods_sold REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN self_employed_health_insurance REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN prior_year_tax_liability REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN q1_payment_made REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN q2_payment_made REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN q3_payment_made REAL DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tax_settings ADD COLUMN q4_payment_made REAL DEFAULT 0");
} catch (e) {}

// Auto-seed tag tax mappings for existing tags with smart heuristics if unmapped
try {
  const unmappedTags = db.prepare(`
    SELECT t.id, t.name FROM tags t
    LEFT JOIN tag_tax_mappings m ON t.id = m.tag_id
    WHERE m.tag_id IS NULL
  `).all() as any[];

  if (unmappedTags.length > 0) {
    const insertMapping = db.prepare("INSERT OR IGNORE INTO tag_tax_mappings (tag_id, schedule_c_line) VALUES (?, ?)");
    for (const tag of unmappedTags) {
      const name = (tag.name || '').toLowerCase();
      let matchedLine: string | null = null;

      if (/marketing|advertising|ads|promo|seo|website/i.test(name)) matchedLine = 'line_8_advertising';
      else if (/gas|fuel|mileage|vehicle|auto|car|truck/i.test(name)) matchedLine = 'line_9_vehicle';
      else if (/commission|stripe|paypal|processing|merchant|bank fee/i.test(name)) matchedLine = 'line_10_commissions';
      else if (/subcontractor|contractor|freelance|labor/i.test(name)) matchedLine = 'line_11_contract_labor';
      else if (/insurance|policy|liability/i.test(name)) matchedLine = 'line_15_insurance';
      else if (/legal|cpa|accounting|attorney|bookkeeper|tax/i.test(name)) matchedLine = 'line_17_legal';
      else if (/office|software|saas|subscription|postage|stationery/i.test(name)) matchedLine = 'line_18_office';
      else if (/rent|lease|storage|rental/i.test(name)) matchedLine = 'line_20_rent';
      else if (/repair|maintenance|servicing/i.test(name)) matchedLine = 'line_21_repairs';
      else if (/supplies|materials|hardware|parts|lumber/i.test(name)) matchedLine = 'line_22_supplies';
      else if (/license|permit|registration|state fee|franchise/i.test(name)) matchedLine = 'line_23_taxes';
      else if (/travel|flight|hotel|airbnb|lodging/i.test(name)) matchedLine = 'line_24a_travel';
      else if (/meal|food|dinner|dining|restaurant/i.test(name)) matchedLine = 'line_24b_meals';
      else if (/utilities|utility|phone|cell|internet|electric|power/i.test(name)) matchedLine = 'line_25_utilities';
      else if (/tool|education|course|book|equipment/i.test(name)) matchedLine = 'line_27a_other';

      if (matchedLine) {
        insertMapping.run(tag.id, matchedLine);
      }
    }
  }
} catch (e) {}

// ── Security migrations ─────────────────────────────────────────────────────
// Session invalidation counter: bumped on password change/reset so older JWTs stop working.
try { db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0"); } catch (e) {}

// Make "activated" explicit. Previously unused keys shared the status 'active' with activated ones,
// so merely generating a key unlocked the instance and a key could be activated repeatedly.
try {
  db.exec("UPDATE license_keys SET status = 'unused' WHERE status = 'active' AND activated_at IS NULL");
} catch (e) {}

// Admin rights come from users.is_admin only. Legacy deployments granted admin by matching ADMIN_EMAIL on every
// request; promote that existing account once so nobody loses access. (Registration of ADMIN_EMAIL by a
// stranger is blocked in the register route once any user exists.)
try {
  if (ADMIN_EMAIL) {
    db.prepare("UPDATE users SET is_admin = 1 WHERE LOWER(email) = ? AND is_admin != 1").run(ADMIN_EMAIL);
  }
} catch (e) {}

// ── End-to-end encryption schema (v2) ───────────────────────────────────────
// The server stores ciphertext envelopes ("enc") plus the minimum plaintext metadata it needs to function
// (ids, ownership, membership, timestamps, archive flag, job start/end dates for the calendar API).
// Legacy plaintext columns are kept only until the owner's client migrates a row, then scrubbed.
const addColumn = (table: string, column: string, definition: string) => {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch (e) { /* already exists */ }
};
// Account key material. kdf_version 1 = legacy (password sent to server), 2 = split auth/encryption keys.
addColumn('users', 'kdf_version', 'INTEGER DEFAULT 1');
addColumn('users', 'kdf_salt', 'TEXT');
addColumn('users', 'kdf_iterations', 'INTEGER');
addColumn('users', 'public_key', 'TEXT');
addColumn('users', 'private_key_encrypted', 'TEXT');
addColumn('users', 'calendar_key_encrypted', 'TEXT');
addColumn('users', 'key_check', 'TEXT');
addColumn('users', 'e2ee_version', 'INTEGER DEFAULT 1');        // 2 = account upgraded AND all legacy data re-encrypted
addColumn('users', 'server_calendar_key', 'TEXT');              // opt-in delegation for background Google sync
addColumn('users', 'server_report_key', 'TEXT');                // opt-in delegation for figure-bearing report e-mails
addColumn('jobs', 'enc', 'TEXT');
addColumn('expenses', 'enc', 'TEXT');
addColumn('expenses', 'updated_at', 'DATETIME');
addColumn('wishlist_items', 'enc', 'TEXT');
addColumn('subscriptions', 'enc', 'TEXT');
addColumn('job_users', 'status', "TEXT DEFAULT 'active'");     // 'pending' until the owner wraps the job key for the member
addColumn('job_keys', 'wrapped_by', 'TEXT');                    // NULL = sealed under the holder's own master key
addColumn('api_keys', 'wrapped_calendar_key', 'TEXT');
addColumn('api_keys', 'last_used_at', 'DATETIME');
addColumn('api_keys', 'agent_scope', 'TEXT');                    // JSON {access, all_jobs} when the key was opted in to agent access
addColumn('api_keys', 'agent_bundle', 'TEXT');                   // job keys + calendar key + inbox key, sealed under SERVER_WRAP_KEY

// Invoicing 2.0 (docs/INVOICING_PLAN.md §5.8): one small encrypted JSON record per invoice/estimate, sealed under the JOB key.
// Active job members can read it; only the job owner can write it (enforced in routes/data.ts). The server never sees content.
db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs (id),
    user_id TEXT NOT NULL REFERENCES users (id),
    enc TEXT NOT NULL,
    rev INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices (job_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_blobs (
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    enc TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, name),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS job_calendar_labels (
    job_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    title_enc TEXT NOT NULL,
    PRIMARY KEY (job_id, user_id),
    FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS job_invites (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    created_by TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used_by TEXT,
    used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
  );
  -- Opt-in: an aggregated, client-built summary (per day/job/category totals) encrypted under the user's report key.
  CREATE TABLE IF NOT EXISTS report_snapshots (
    user_id TEXT PRIMARY KEY,
    enc TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_expenses_job ON expenses (job_id);
  CREATE INDEX IF NOT EXISTS idx_job_users_user ON job_users (user_id);
`);

// Accounts registered before this release are on kdf_version 1; everything created from now on is v2.
db.exec("UPDATE users SET kdf_version = 1 WHERE kdf_version IS NULL");
db.exec("UPDATE users SET e2ee_version = 1 WHERE e2ee_version IS NULL");
db.exec("UPDATE job_users SET status = 'active' WHERE status IS NULL");

export default db;

