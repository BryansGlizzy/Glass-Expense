# GlassExpense — Master Architecture & Technical Documentation

> **Target Audience**: Software Engineers, AI/LLM Coding Agents, DevOps Engineers, and Product Architects working on or integrating with GlassExpense.  
> **Specialized Subsystem Guide**: For in-depth mathematical tax mechanics, IRS form line-by-line mappings, safe-harbor underpayment rules, and beginner filing blueprints, see the dedicated [TAX_SYSTEM.md](TAX_SYSTEM.md). For programmatic REST contracts, see [API.md](API.md). For the security review and remediation status, see [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

---

## 1. Executive Summary & Core Philosophy

**GlassExpense** is an offline-first Progressive Web Application (PWA) and cross-platform mobile application engineered for high-performance financial management, expense tracking, invoice generation, and audit-ready tax preparation. Designed specifically for contractors, trade professionals, freelancers, and small businesses, the platform combines intuitive glassmorphism aesthetics with rigorous enterprise security.

### Core Architectural Pillars

1. **End-to-End Encryption of your data**:
   - Job titles, clients, notes, expense amounts/descriptions/dates, tags, wishlists, recurring entries, tax settings, W-2s, the invoice template, the AI provider key and every receipt file are encrypted **in the browser** (AES-256-GCM, Web Crypto) before they reach the server. The server stores ciphertext only.
   - Your password is **never sent**: the browser derives two independent keys from it (an authentication key for login, a wrapping key that stays on the device). Your vault key comes from a **12-word BIP-39 recovery phrase**.
   - Sharing a job uses per-user **ECDH key pairs**: the owner approves each invitee (after comparing a security-code fingerprint) and wraps the job key for that person only. Invites never contain keys.
   - Integrations get a **calendar-only API key** whose private half decrypts job titles locally (see [API.md §3](API.md#3-calendar-api-for-integrations-api-keys)).
   - **What the server still sees**: username, e-mail, plan, job start/end dates, archive flag, timestamps/counts, and which accounts share a job. Opt-in features (background Google sync, cloud OCR) widen this; see [§5.4](#54-threat-model-and-known-limits).

2. **Offline-First PWA Sync Engine**:
   - Built on Service Workers with `StaleWhileRevalidate` caching strategies and an IndexedDB mutation queue (`idb`).
   - When offline, users can log expenses, capture receipts, and browse cached projects uninterrupted. Upon network recovery, mutations are automatically drained and synchronized with the central database.

3. **Dual Vision & OCR Intelligence**:
   - **Cloud OCR**: Bring-Your-Own-Key (BYOK) OpenAI-compatible Vision API (`/chat/completions`) for structured receipt and W-2 form extraction.
   - **Local On-Device OCR**: Zero-network, zero-knowledge optical character recognition powered by Web Workers and `tesseract.js` for completely private on-device processing.

4. **Multi-Entity Tax & Compliance Engine**:
   - Supports **Sole Proprietorships**, **Single-Member LLCs** (disregarded entities), and **LLCs with S-Corporation Elections** (Form 1120-S).
   - Automated IRS Schedule C categorization, statutory meal limits (50% under IRC §274(n)), simplified home office deductions (§280A), vehicle deduction optimization (Standard Mileage vs Actual Expenses), quarterly Form 1040-ES vouchers, and safe-harbor underpayment protection.

5. **Dual Execution Topology**:
   - **Personal Edition**: Single-tenant or self-hosted deployment with multi-user capabilities, offline data persistence, and self-hosted Over-The-Air (OTA) updates.
   - **SaaS Mode**: Multi-tenant architecture with tier enforcement (`free`, `pro`, `personal`), resource quotas, and Stripe/PayPal webhook hooks.

6. **Real-Time Collaboration**:
   - Full duplex WebSocket channels powered by **Socket.IO** for live transaction updates, collaborative job workspaces, tag synchronisation, and wishlist conversion.

---

## 2. Directory Structure & File Interconnectivity

### 2.1 File Tree

```
glassexpense/
├── README.md                         # Quick start, scripts, deployment notes
├── .env.example                      # Documented configuration template (copy to .env)
├── capacitor.config.ts · index.html · package.json · tsconfig.json · vite.config.ts
│
├── android/                          # Native Android Capacitor container
├── docs/
│   ├── API.md                        # API reference incl. the calendar API + caller-side decryption guide
│   ├── DOCUMENTATION.md              # This document
│   ├── SECURITY_AUDIT.md             # Security review, findings and remediation status
│   ├── TODO.md                       # Manual verification checklist before migrating production
│   ├── TAX_SYSTEM.md                 # Tax calculation engine deep-dive
│   └── examples/                     # Tested caller-decrypt clients (Node, browser, Python) + test vector
├── public/                           # Static assets (icons); vendor/tesseract is generated (gitignored)
├── scripts/
│   ├── build-ota.js · copy-tesseract-assets.mjs · promote-admin.ts
│   └── test-e2e.sh                   # `npm test`: boots a throwaway server and runs every suite
├── tests/                            # crypto, server, client-layer, migration and example suites
│
├── server/                           # Backend (Express + Socket.IO + SQLite) — sees ciphertext only
│   ├── index.ts                      # App wiring, headers, sockets, schedulers
│   ├── config.ts · security.ts       # Validated config (fail-fast secrets) · validators, SSRF guard
│   ├── middleware.ts                 # Sessions, API-key scoping, access guards, rate limits, uploads
│   ├── helpers.ts · server-crypto.ts # User payload/validators · opt-in calendar-key wrapping (SERVER_WRAP_KEY)
│   ├── db.ts                         # Schema + idempotent migrations (incl. E2EE columns/tables)
│   ├── routes/                       # auth · admin · settings · data (/api/v2) · agent · ai · invoices-mail · legacy (migration) · ocr
│   ├── agent-core.ts · research.ts   # Agent permission model shared by the routes and the in-process research worker · AI research for posted jobs
│   ├── ai-client.ts                  # One SSRF-guarded OpenAI-compatible client (long timeouts, no redirects)
│   ├── sweeps.ts · push.ts           # Activity digests, content-free reminders · Firebase push
│   ├── email.ts · google-calendar.ts # Escaped templates · calendar sync (opt-in delegation)
│   └── saas/index.ts                 # SaaS tier enforcement and limits
│
├── data/                             # RUNTIME DATA — gitignored (override with DATA_DIR): data.db, uploads/, updates/
├── secrets/                          # gitignored: firebase-adminsdk.json
├── dist/                             # Vite build output (gitignored)
│
├── src/                              # React frontend source code
│   ├── App.tsx                       # Main router, route definitions, layout wrappers
│   ├── index.css                     # Tailwind CSS v4 directives, glassmorphic theme tokens, print CSS
│   ├── main.tsx                      # Frontend entry point, DOM bootstrap, SW registration
│   │
│   ├── components/                   # Reusable UI component modules
│   │   ├── BudgetTrendChart.tsx      # Recharts visual area chart with dynamic profit/loss gradient
│   │   ├── CalendarView.tsx          # Multi-view interactive project calendar (Month, Week, Day)
│   │   ├── Layout.tsx                # Application shell with responsive sidebar, navigation, mobile drawer
│   │   ├── MarkdownRenderer.tsx      # Custom Markdown parser with sanitized tables and code blocks
│   │   ├── OTAUpdateManager.tsx      # Native mobile Over-The-Air release checker & download modal
│   │   ├── ReportWizard.tsx          # Multi-criteria financial report builder
│   │   └── ReportsWorkspace.tsx      # Financial reports dashboard, receipt gallery, CSV export
│   │
│   ├── context/                      # React Context providers
│   │   └── AuthContext.tsx           # Authentication session, JWT tokens, Master Key storage
│   │
│   ├── pages/                        # Primary application views / routes
│   │   ├── AdminPortal.tsx           # Super-admin dashboard: system telemetry, user limits, tiers
│   │   ├── ApiDocs.tsx               # Interactive API documentation & self-hosting instructions
│   │   ├── Dashboard.tsx             # Project dashboard: job cards, calendar toggle, key migration
│   │   ├── ForgotPassword.tsx        # Password reset initiation view
│   │   ├── Home.tsx                  # High-converting landing page showcasing glassmorphic UI
│   │   ├── Invoices.tsx              # Invoices & estimates workspace (/invoices)
│   │   ├── Job.tsx                   # Core project workspace: expense ledger, receipt capture, wishlists
│   │   ├── Legal.tsx                 # Terms of Service & Privacy Policy
│   │   ├── Login.tsx                 # User authentication & PBKDF2 Master Key unwrapping
│   │   ├── Pricing.tsx               # Commercial tier cards and offline license unlock modal
│   │   ├── Register.tsx              # Account registration & BIP-39 mnemonic generation ceremony
│   │   ├── ResetPassword.tsx         # Password reset completion & key re-encryption view
│   │   ├── Settings.tsx              # Tabbed settings: Profile, Invoices, Tags, AI, Reports, Google
│   │   └── TaxCenter.tsx             # Tax Hub: Overview, Schedule C, Sole Prop forms, W-2, 1040-ES, CPA export
│   │
│   ├── invoice/                      # Invoicing 2.0 core (pure TS, tested): model, totals, PDF writer, sheet view-model, settings, packages, intake, prefill, review, payments, tax split, AI draft
│   ├── components/invoice/           # Invoice workspace (editor, sheet, modals, history) · components/settings/ InvoiceSettings, AiProfilesSettings
│   └── utils/                        # Frontend algorithmic & utility libraries
│       ├── crypto.ts                 # Web Crypto API: BIP-39, PBKDF2, AES-GCM-256 key wrapping & file crypto
│       ├── invoice.ts                # Rolling 6-character sequential invoice numbering algorithms
│       ├── ocr.ts                    # Tesseract.js Web Worker integration for on-device OCR
│       ├── sync.ts                   # IndexedDB offline mutation queue & automatic network sync
│       └── taxCalculator.ts          # Pure mathematical federal tax engine & IRS bracket calculators
```

---

### 2.2 File Connectivity & Data Flow

The following diagram illustrates how files and layers communicate across GlassExpense:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                CLIENT / BROWSER RUNTIME                                │
│                                                                                        │
│   [index.html] ──► [src/main.tsx] ──► [src/App.tsx]                                    │
│                                            │                                           │
│                 ┌──────────────────────────┴──────────────────────────┐                │
│                 ▼                                                     ▼                │
│       [src/context/AuthContext.tsx]                          [src/components/Layout.tsx]
│                 │                                                     │                │
│                 │ (Session, JWT, MasterKey)                           ▼                │
│                 │                                             [src/pages/*.tsx]        │
│                 │                                             - Job.tsx                │
│                 │                                             - Dashboard.tsx          │
│                 │                                             - TaxCenter.tsx          │
│                 │                                             - Settings.tsx           │
│                 │                                             - ReportsWorkspace.tsx   │
│                 ▼                                                     │                │
│       [src/utils/crypto.ts] ◄─────────────────────────────────────────┤                │
│       (AES-GCM-256, BIP-39, PBKDF2)                                   │                │
│                                                                       ▼                │
│       [src/utils/taxCalculator.ts] ◄───────────────────────── [src/pages/TaxCenter.tsx]│
│       (Progressive brackets, SE, 1040, Safe-Harbor)                   │                │
│                                                                       ▼                │
│       [src/utils/sync.ts] ◄─────────────────────────────────── [src/pages/Job.tsx]     │
│       (IndexedDB offline mutation queue)                              │                │
│                                                                       ▼                │
│       [src/utils/ocr.ts] ◄──────────────────────────────────── (On-device Tesseract)   │
└───────────────────────────────────────┬───────────────────────────────▲────────────────┘
                                        │                               │
                       HTTP REST & FormData (Bearer JWT)                │ Socket.IO Duplex Events
                                        │                               │ ('expense_added', etc.)
                                        ▼                               │
┌───────────────────────────────────────────────────────────────────────┴────────────────┐
│                                  SERVER / BACKEND RUNTIME                              │
│                                                                                        │
│                                      [server.ts]                                       │
│                    - Express Application & REST Endpoints                              │
│                    - Socket.IO Real-time Broadcast Rooms                               │
│                    - Multer Multipart Form Parser                                      │
│                    - Tax Calculation & Deduction Discovery Aggregator                  │
│                    - Hourly Cron Schedulers (Reports & Recurring Subscriptions)        │
│                    - Vite Middleware (Development) / Static Hosting (Production)       │
│                                        │                                               │
│         ┌──────────────────────────────┼──────────────────────────────┐                │
│         ▼                              ▼                              ▼                │
│     [db.ts]                       [email.ts]                [google-calendar.ts]       │
│  - better-sqlite3              - Nodemailer SMTP             - Google OAuth 2.0        │
│  - Schema definitions          - HTML Email Templates        - Two-way Calendar Sync   │
│  - Idempotent migrations       - Digest Delivery                                       │
│         │                                                                              │
│         ▼                                                                              │
│    [data.db]                                                                           │
│ (SQLite Database File)                                                                 │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack & Key Dependencies

| Layer / Domain | Technology / Library | Version | Architectural Responsibility |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | `react`, `react-dom` | `^19.0.0` | High-performance declarative component rendering |
| **Routing** | `react-router` | `^7.13.1` | Declarative client-side routing with route guards |
| **CSS & Design System** | `tailwindcss`, `@tailwindcss/vite` | `^4.1.14` | Modern CSS with custom glassmorphism theme tokens |
| **Animations & Motion** | `motion` (Framer Motion) | `^12.23.24` | Page transitions, mobile drawer mechanics, modal physics |
| **Data Visualization** | `recharts` | `^3.8.1` | Responsive financial area charts with SVG gradient splits |
| **Date Manipulation** | `date-fns` | `^4.1.0` | Calendar grid mathematics, quarterly dates, formatting |
| **Iconography** | `lucide-react` | `^0.546.0` | Comprehensive SVG icon library |
| **Client Storage** | `idb` | `^8.0.3` | IndexedDB promise wrapper for offline mutation caching |
| **Client Cryptography** | `bip39`, Web Crypto API | `^3.1.0` | 12-word mnemonic phrase derivation, PBKDF2, AES-GCM-256 |
| **Local Vision / OCR** | `tesseract.js` | `^7.0.0` | On-device, zero-network optical character recognition |
| **PWA & Offline** | `vite-plugin-pwa`, `workbox-window` | `^1.2.0` | Service worker registration, asset precaching, manifest |
| **Backend Runtime** | `express`, `tsx`, `node` | Node 18+ | REST API server, static hosting, Vite dev server integration |
| **Embedded Database** | `better-sqlite3` | `^13.0.3` | Synchronous, zero-latency embedded SQLite database |
| **Realtime WebSockets** | `socket.io`, `socket.io-client` | `^4.8.3` | Low-latency duplex event rooms per project |
| **Multipart Uploads** | `multer` | `^2.1.1` | Streaming multipart form-data handler for receipts & W-2s |
| **Authentication** | `bcryptjs`, `jsonwebtoken` | `^3.0.3`, `^9.0.3` | Password hashing (bcrypt cost 12) and signed, expiring JWT sessions |
| **HTTP hardening** | `helmet`, `express-rate-limit` | latest | Security headers / CSP and request throttling |
| **Email Transport** | `nodemailer` | `^8.0.5` | Automated SMTP email delivery for financial digests |
| **External Calendar** | `googleapis`, `google-auth-library` | `^171.4.0` | Google Calendar OAuth 2.0 API client |
| **Mobile Runtime** | `@capacitor/core`, `@capacitor/android`| `^8.5.2` | Native Android platform bridge with Camera and Push plugins |
| **Mobile Updates (OTA)**| `@capgo/capacitor-updater` | `^8.52.1` | Self-hosted Over-The-Air zip distribution for native mobile |

---

## 4. Database Schema & Data Models

Database storage is managed via SQLite in [db.ts](../server/db.ts) using `better-sqlite3`. Migrations run idempotently on server bootstrap using `CREATE TABLE IF NOT EXISTS` and defensive column checks.

### 4.1 Entity Relationship Diagram (ERD)

```
                            ┌────────────────────────┐
                            │         users          │
                            ├────────────────────────┤
                            │ id (PK)                │◄──────────────┐
                            │ username, email        │               │
                            │ password_hash          │               │
                            │ master_key_encrypted   │               │
                            │ plan, is_admin         │               │
                            │ ai_api_key, etc.       │               │
                            └───────────┬────────────┘               │
                                        │                            │
      ┌──────────────────┬──────────────┼──────────────┬─────────────┼─────────────────┐
      │ 1:N              │ 1:N          │ 1:N          │ 1:N         │ 1:N             │ 1:N
      ▼                  ▼              ▼              ▼             ▼                 ▼
┌──────────────┐  ┌─────────────┐ ┌───────────┐ ┌─────────────┐ ┌──────────────┐ ┌────────────────┐
│   api_keys   │  │report_sett..│ │   tags    │ │tax_settings │ │invoice_templ.│ │  ota_releases  │
└──────────────┘  └─────────────┘ └─────┬─────┘ └──────┬──────┘ └──────────────┘ └────────────────┘
                                        │              │ 1:N
                                        │ M:N          ▼
                                        ▼       ┌──────────────┐
┌──────────────┐ 1:N ┌──────────────┐ ┌───────┐ │   w2_forms   │
│     jobs     ├───► │   expenses   ├─┤exp_tag│ └──────────────┘
├──────────────┤     ├──────────────┤ └───────┘
│ id (PK)      │     │ id (PK)      │     │
│ created_by   │     │ job_id (FK)  │     │ M:1
│ is_archived  │     │ user_id (FK) │     ▼
│ invoice_seq  │     │ amount, date │ ┌───────────────────┐
└──────┬───────┘     │ is_encrypted │ │ tag_tax_mappings  │
       │             │ receipt_url  │ └───────────────────┘
       │             └──────┬───────┘
       │                    │ 1:1
       │                    ▼
       │             ┌───────────────────────┐
       │             │ expense_tax_mappings  │
       │             └───────────────────────┘
       ├────────────────────────┬────────────────────────┐
       │ 1:N                    │ 1:N                    │ 1:N
       ▼                        ▼                        ▼
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  job_users   │         │   job_keys   │         │subscriptions │
├──────────────┤         ├──────────────┤         ├──────────────┤
│ job_id (PK)  │         │ job_id (PK)  │         │ id (PK)      │
│ user_id (PK) │         │ user_id (PK) │         │ next_gen_date│
└──────────────┘         └──────────────┘         └──────────────┘
```

---

### 4.2 Comprehensive Table Specifications

#### 1. `users`
Stores user credentials, licensing tier, and cryptographic vault credentials.
- `id`: `TEXT PRIMARY KEY` (UUIDv4)
- `username`: `TEXT UNIQUE NOT NULL`
- `email`: `TEXT UNIQUE`
- `password_hash`: `TEXT NOT NULL` (bcrypt, salt cost 10)
- `master_key_encrypted`: `TEXT` (Base64 AES-GCM ciphertext of master key wrapped with PBKDF2 password key)
- `plan`: `TEXT DEFAULT 'free'` (`'free'`, `'pro'`, `'personal'`)
- `is_admin`: `INTEGER DEFAULT 0`
- `reset_token`, `reset_expires`: Password reset token verification
- `ai_api_key`, `ai_base_url`, `ai_model`: BYOK OpenAI Vision credentials
- `google_refresh_token`, `google_calendar_id`, `google_sync_jobs`, `google_sync_expenses`: Google Calendar OAuth configuration

#### 2. `jobs`
Main project tracking containers.
- `id`: `TEXT PRIMARY KEY` (UUIDv4)
- `title`: `TEXT NOT NULL`
- `description`: `TEXT`
- `created_by`: `TEXT NOT NULL (FK users.id)`
- `mode`: `TEXT DEFAULT 'expense'` (`'expense'` for expenditure tracking, `'budget'` for spending caps)
- `target_budget`: `REAL DEFAULT 0`
- `start_date`, `end_date`: `TEXT` (`YYYY-MM-DD`)
- `is_archived`: `INTEGER DEFAULT 0`
- `client_name`, `client_address`, `client_email`, `job_rate`, `invoice_notes`: Invoice defaults
- `invoice_tag`: `TEXT DEFAULT 'AUTO'` (Prefix tag for rolling sequence)
- `invoice_seq`: `INTEGER DEFAULT 1` (Rolling numeric counter, e.g., 1 -> `A00001`)
- `invoice_number`: `TEXT` (Cached active invoice number)

#### 3. `job_users`
Access control table for collaborative multi-user jobs.
- `job_id`: `TEXT NOT NULL (FK jobs.id)`
- `user_id`: `TEXT NOT NULL (FK users.id)`
- `role`: `TEXT DEFAULT 'member'` (`'owner'`, `'member'`)
- `PRIMARY KEY (job_id, user_id)`

#### 4. `job_keys`
Per-job symmetric encryption keys wrapped under each member's Master Key.
- `job_id`: `TEXT NOT NULL (FK jobs.id)`
- `user_id`: `TEXT NOT NULL (FK users.id)`
- `encrypted_key`: `TEXT NOT NULL` (Base64 AES-GCM ciphertext of the job's AES-256 key wrapped with member's Master Key)
- `PRIMARY KEY (job_id, user_id)`

#### 5. `expenses`
Financial transactions attached to jobs.
- `id`: `TEXT PRIMARY KEY` (UUIDv4)
- `job_id`: `TEXT NOT NULL (FK jobs.id)`
- `user_id`: `TEXT NOT NULL (FK users.id)`
- `amount`: `REAL NOT NULL`
- `description`: `TEXT`
- `receipt_url`: `TEXT` (Filesystem path `/uploads/<timestamp>-<random>.<ext>`)
- `is_encrypted`: `INTEGER DEFAULT 0` (1 if receipt is stored as AES-GCM ciphertext)
- `entry_type`: `TEXT DEFAULT 'expense'` (`'expense'` or `'income'`)
- `date`: `TEXT NOT NULL` (`YYYY-MM-DD`)
- `created_at`: `DATETIME DEFAULT CURRENT_TIMESTAMP`

#### 6. `tags` & `expense_tags`
- `tags`: Global and user-defined category tags (`id`, `name`, `color`, `user_id`).
- `expense_tags`: Many-to-many relationship mapping `expense_id` to `tag_id`.

#### 7. `tax_settings`
Annual tax profiles, entity selections, vehicle settings, and quarterly payments.
- `user_id`: `TEXT NOT NULL (FK users.id)`
- `tax_year`: `INTEGER NOT NULL`
- `entity_type`: `TEXT DEFAULT 'sole_proprietorship'` (`'sole_proprietorship'`, `'llc_single_member'`, `'llc_scorp'`)
- `filing_status`: `TEXT DEFAULT 'single'` (`'single'`, `'married_joint'`, `'married_separate'`, `'head_of_household'`)
- `business_miles`: `REAL DEFAULT 0`
- `vehicle_deduction_method`: `TEXT DEFAULT 'auto_best'` (`'auto_best'`, `'standard_mileage'`, `'actual_expenses'`)
- `home_office_sqft`: `REAL DEFAULT 0`
- `scorp_officer_salary`: `REAL DEFAULT 0`
- `additional_gross_income`: `REAL DEFAULT 0` (Uninvoiced 1099-NEC or cash receipts)
- `returns_and_allowances`: `REAL DEFAULT 0` (Part I Line 2)
- `cost_of_goods_sold`: `REAL DEFAULT 0` (Part I Line 4)
- `self_employed_health_insurance`: `REAL DEFAULT 0` (Schedule 1 Line 17 deduction)
- `prior_year_tax_liability`: `REAL DEFAULT 0` (IRC §6654 safe-harbor benchmark)
- `q1_payment_made`, `q2_payment_made`, `q3_payment_made`, `q4_payment_made`: `REAL DEFAULT 0`
- `PRIMARY KEY (user_id)` — one tax profile per user; `tax_year` is a field on it

#### 8. `w2_forms`
Ingested third-party and S-Corp officer W-2 wage records.
- `id`: `TEXT PRIMARY KEY` (UUIDv4)
- `user_id`: `TEXT NOT NULL (FK users.id)`
- `tax_year`: `INTEGER NOT NULL`
- `employer_name`: `TEXT NOT NULL`
- `wages_box1`: `REAL NOT NULL` (Box 1 Gross wages)
- `fed_withholding_box2`: `REAL NOT NULL` (Box 2 Federal income tax withheld)
- `ss_wages_box3`: `REAL DEFAULT 0` (Box 3 Social Security wages)
- `ss_tax_box4`: `REAL DEFAULT 0` (Box 4 Social Security tax withheld)
- `medicare_wages_box5`: `REAL DEFAULT 0` (Box 5 Medicare wages)
- `medicare_tax_box6`: `REAL DEFAULT 0` (Box 6 Medicare tax withheld)

#### 9. `tag_tax_mappings` & `expense_tax_mappings`
- `tag_tax_mappings`: Maps global/custom tag IDs to official Schedule C lines (`line_8_advertising`, `line_9_vehicle`, `line_22_supplies`, etc.).
- `expense_tax_mappings`: Stores granular, individual expense overrides ahead of tags and keyword heuristics. Scoped **per user**: `PRIMARY KEY (expense_id, user_id)` so collaborators never change each other's tax categorisation. `schedule_c_line` is validated against the known Schedule C lines.

#### 10. `subscriptions` & `wishlists`
- `subscriptions`: Recurring project expenses (`frequency`, `next_generation_date`, `auto_add`, `notify_before_days`).
- `wishlists`: Pre-purchase planning items with priority flags and one-click expense conversion.

---

### 4.3 End-to-end-encryption schema additions

The server stores **ciphertext envelopes** (`enc`) beside the minimum plaintext it needs. Pre-encryption columns (`title`, `amount`, `description`, …) remain in the schema only so old rows can be migrated; each is overwritten (`''`, `0`, `NULL`) the moment its record is replaced by its encrypted form, and the database is `VACUUM`ed when a user's migration completes.

| Table / column | Purpose |
|---|---|
| `users.kdf_version` / `kdf_salt` / `kdf_iterations` | v2 key derivation parameters (v1 = legacy password protocol) |
| `users.master_key_encrypted`, `private_key_encrypted`, `calendar_key_encrypted`, `public_key`, `key_check` | The user's encrypted key bundle (see §5) |
| `users.e2ee_version` | `2` once the account is upgraded **and** all legacy data is encrypted |
| `users.server_calendar_key` | Opt-in: calendar key sealed under `SERVER_WRAP_KEY` for background Google sync |
| `users.server_report_key`, `report_snapshots` | Opt-in: report key (sealed under `SERVER_WRAP_KEY`) and the encrypted aggregate summary used to write figure-bearing report e-mails |
| `users.token_version` | Bumped on password change/reset to revoke sessions |
| `jobs.enc`, `expenses.enc`, `wishlist_items.enc`, `subscriptions.enc` | Encrypted record bodies |
| `subscriptions.next_generation_date`, `remind_*` | Plaintext scheduling metadata for content-free reminders |
| `job_users.status` | `pending` until the owner wraps the job key for that member, then `active` |
| `job_keys.wrapped_by` | `NULL` = sealed under the holder's own master key; otherwise the owner's ECDH share |
| `user_blobs` (user_id, name, enc, version) | Personal encrypted blobs: tags, tax settings, mappings, W-2s, invoice template, AI settings |
| `job_calendar_labels` (job_id, user_id, title_enc) | Each participant's job title encrypted under their own calendar key |
| `job_invites` | Single-use, expiring invite tokens (only the SHA-256 is stored) |
| `api_keys.wrapped_calendar_key`, `last_used_at` | Calendar key wrapped by the key's private half |
| `license_keys.status` | `unused → active \| remote_used` |
| `invoices` (id, job_id, user_id, enc, rev, timestamps) | One encrypted record per invoice/estimate under the **job key**; members read, only the owner writes (server-enforced); deleted explicitly with the job and the user |
| `api_keys.agent_scope` | now also `invoices` (`none\|read\|draft\|finalize`) and `research`; the research endpoint is sealed in `agent_bundle` |

The legacy tables `tags`, `expense_tags`, `tag_tax_mappings`, `expense_tax_mappings`, `tax_settings`, `w2_forms`, `invoice_templates` are emptied for a user when their migration completes and are no longer written to.

---

## 5. End-to-End Encryption (E2EE) & Security Flow

Implemented in [src/e2ee/crypto.ts](../src/e2ee/crypto.ts) (browser, Node and tests share the same code). Byte-level formats are specified in [API.md §5](API.md#5-encryption-reference).

### 5.1 Key hierarchy

```
password ──PBKDF2-SHA256 (600k, per-user random salt)──► root
   root ──HKDF "auth/v2"──► authKey   → sent to the server as the login credential
   root ──HKDF "wrap/v2"──► wrapKey   → never leaves the device; seals the master key

12-word recovery phrase ──BIP-39──► Master Key (MK)           [server stores only SealedBy(wrapKey, MK)]
   MK seals:  ECDH private key · calendar key · each job key (owner copy)
   MK ─HKDF "user-data/v2"─► user-data key  → encrypts personal blobs (tags, tax, W-2s, template, AI key)

per-job random key ──► encrypts the job, its expenses, wishlist, subscriptions and receipts
   shared with a member by ECDH(owner private, member public) → HKDF → AES-GCM  (owner approves each member)

calendar key (random 32 B) ──► encrypts the job title for the calendar API / opt-in Google sync
   copied to an API key by sealing it under HKDF(private half of that API key)
```

### 5.2 Lifecycles

1. **Register** — the browser generates the recovery phrase, derives `authKey`/`wrapKey`, creates the ECDH key pair and calendar key, and uploads only `authKey` and the sealed bundle. The user must confirm they saved the 12 words.
2. **Login** — `POST /auth/params` → derive → `POST /auth/login { auth_key }` → unseal the bundle locally. The master key is kept in `sessionStorage` (tab-scoped); a new tab shows an **Unlock** screen asking for the password again.
3. **Create / edit data** — the UI calls the same `/api/...` URLs as ever; [src/e2ee/router.ts](../src/e2ee/router.ts) encrypts on the way out and decrypts on the way in, talking to `/api/v2` underneath.
4. **Receipts** — encrypted with the job key before upload (a plaintext file handed to the layer is encrypted first); downloaded through the authenticated `/api/v2/uploads/:file` and decrypted in the browser.
5. **Share a job** — owner creates a single-use invite → invitee redeems (pending, sees nothing) → owner compares the invitee's **security code** and approves → the job key is wrapped for the invitee's public key.
6. **Change password** — only the wrapping of the master key changes (no data re-encryption); other sessions are revoked.
7. **Forgot password** — e-mailed token **and** the recovery phrase are both required; the phrase is proven with `key_check` without being revealed.
8. **Pre-encryption accounts** — on first login the browser upgrades the account keys and encrypts all existing data locally (resumable); the server scrubs each plaintext row as it is replaced and finally vacuums the database.

### 5.3 Transport, session & hardening summary

| Area | Behaviour |
|---|---|
| Sessions | HS256 JWT, 14-day default (`JWT_EXPIRES_IN`), revoked server-side on password change/reset via `users.token_version`. Stored in `localStorage`. |
| API keys | Calendar-only (`GET /api/calendar/schedule`); everywhere else `403`. Carry a private decryption half the server never sees. |
| Authorization | Every `/api/v2/jobs/:id/*` route requires owner or **active** member; others get `404`. Pending invitees get nothing until approved. Sockets are authenticated and room-restricted. |
| Passwords | Never reach the server (policy ≥ 12 characters enforced in the client). Server stores `bcrypt(authKey)`. Per-account lockout + per-IP limits. |
| Uploads | Encrypted blobs only (`application/octet-stream`), ≤ 15 MB, random names, authenticated download, no public `/uploads`. |
| Outbound requests | AI provider URLs: https, public addresses only, no redirects, timeouts. |
| Headers | Helmet + strict CSP (`CSP_MODE=report-only` for staged rollout), HSTS, `no-referrer`, CORS allow-list. |
| Secrets | The server exits at boot in production if `JWT_SECRET` is missing, short or a placeholder. |
| At rest | `data/` mode 700, DB mode 600; legacy plaintext vacuumed after migration. |

### 5.4 Threat model and known limits

**Protected against:** database/backup leaks, a curious or compromised operator reading stored data, other users and non-members, removed members after removal, stolen reset links, stolen API keys (calendar titles only), cross-user cache leaks on shared devices.

**Not protected against (be honest with users):**
- **A malicious operator who changes the web app's JavaScript** can capture a password at login, as with any browser-delivered E2EE. Mitigations: strict CSP, signed/checksummed mobile bundles, and (roadmap) an audited native app or reproducible builds.
- Because login uses a derived `authKey`, a hostile server that records it could attempt an **offline guess of the password** (600k PBKDF2 iterations make each guess expensive). Use a long password; an OPAQUE/PAKE login is on the roadmap.
- **Metadata**: dates of jobs, counts, timestamps and who shares what are visible to the server, including how many invoices a job has and when they changed (never their status, totals or customer).
- **Invoice e-mail** (opt-in, off by default): pressing Send passes the PDF through the server in memory to attach it to a message; it is not stored or logged. **AI draft and research** send only the vehicle, services and symptoms (never the customer's name, phone, e-mail or street address) to the endpoint you configure. **Agent invoice permission** lets that key read invoice contents of the jobs it covers; `finalize` lets it confirm estimates.
- **Opt-in features**: background Google sync (server reads job titles + dates; Google too), **reports with figures** (server can read an aggregate per-day/job/category summary at send time; the figures then travel by e-mail), and cloud OCR (the image passes through the server to your provider).
- **No automatic key rotation on member removal**: access is cut off server-side immediately, but a removed member keeps any data they already downloaded and the old job key. For a hard cut-off, create a new job and move entries (roadmap: one-click re-keying).
- **Lost password *and* recovery phrase = data is unrecoverable**, by design.
- Offline entries queued on a device are held locally in IndexedDB until synced and are wiped on logout.

---

## 6. REST API

The complete, current reference — including the **calendar API and caller-side decryption guide with Node.js, browser and Python examples** — is in [API.md](API.md). Summary:

- **Public / auth**: `/api/info`, `/api/auth/{params,register,login,upgrade,forgot-password,reset-password,me}`, `/api/auth/me/{email,password}`
- **Encrypted data** (`/api/v2`, session only): jobs, keys, members, invites, expenses (+ bulk/rewrite), receipts download, wishlist, subscriptions, personal blobs, calendar labels
- **Integrations** (API key): `GET /api/calendar/schedule` only
- **Settings**: API keys, activity-digest e-mail, device token, Google Calendar (+ opt-in delegation), AI verify, optional OCR
- **Admin** (session + `is_admin`): users, stats, SaaS config, license keys
- Reports, tax calculation, deduction suggestions, invoice numbering, import/export are **computed in the browser** (no server endpoints); see API.md §6.7 and §11 for what changed.

---

## 7. Real-Time Socket.IO Channels

Sockets require the session token (`io(origin, { auth: { token } })`) and only join rooms for jobs the user owns or is an active member of. Payloads are **ciphertext rows**; [src/e2ee/socket.ts](../src/e2ee/socket.ts) decrypts them before page handlers run. Events: `expense_added|updated|deleted`, `wishlist_item_added|deleted`, `job_updated|deleted`, `subscription_reminder` (no names/amounts), and personal `member_pending` / `job_key_ready`. Full table in [API.md §9](API.md#9-real-time-events-socketio).

---

## 8. Client-Side Routing & Page Breakdown

Configured in [src/App.tsx](../src/App.tsx) using `react-router` v7:

| Route | Guard | Component | Description |
| :--- | :--- | :--- | :--- |
| `/` | `GuestRoute` | `Home.tsx` | High-converting landing page showcasing glassmorphism |
| `/login` | `GuestRoute` | `Login.tsx` | User login & Master Key unwrapping |
| `/register` | `GuestRoute` | `Register.tsx` | Account registration & 12-word BIP-39 mnemonic setup |
| `/forgot-password` | `GuestRoute` | `ForgotPassword.tsx` | Password recovery initiation |
| `/reset-password` | `GuestRoute` | `ResetPassword.tsx` | Password reset completion & key re-wrapping |
| `/legal` | Public | `Legal.tsx` | Terms of Service & Privacy Policy |
| `/dashboard` | `ProtectedRoute` | `Dashboard.tsx` | Project grid, calendar toggle, key migration |
| `/reports` | `ProtectedRoute` | Redirects to `/dashboard?view=reports` | Opens `ReportsWorkspace.tsx` |
| `/taxes` | `ProtectedRoute` | `TaxCenter.tsx` | Tax Hub: Schedule C, SE, 1040, 1040-ES, CPA export |
| `/invoices` | `ProtectedRoute` | `Invoices.tsx` | Invoices & estimates workspace; deep links `?job=<id>` and `?open=<invoiceId>` |
| `/jobs/:id` | `ProtectedRoute` | `Job.tsx` | Core transaction workspace, receipt OCR, wishlists |
| `/settings` | `ProtectedRoute` | `Settings.tsx` | Tabbed settings: Profile, Invoices, Tags, AI, Reports |
| `/admin` | `ProtectedRoute` (admin-only data is enforced server-side) | `AdminPortal.tsx` | System stats, user management, license & tier settings |
| `/pricing` | `ProtectedRoute` | `Pricing.tsx` | Tier comparison & offline license key activation |
| `/api-docs` | `ProtectedRoute` | `ApiDocs.tsx` | In-app developer API documentation |

---

## 9. Offline Sync & PWA Architecture

GlassExpense implements an offline-first strategy via [vite.config.ts](../vite.config.ts) and [src/utils/sync.ts](../src/utils/sync.ts):

1. **Service Worker Caching**:
   - Application shell (HTML, CSS, JS), web fonts, and static assets are cached for offline availability.
   - Cached API responses are **ciphertext** (the browser-side layer decrypts after the service worker); `/api/jobs`-style plaintext responses no longer exist on the wire. Responses (`/api/jobs`, `/api/jobs/:id/expenses`, `/api/tags`) are cached via `StaleWhileRevalidate`, serving local cached data immediately while fetching fresh data in the background. These caches (and the IndexedDB mutation queue) are wiped on logout/session expiry by `clearLocalUserData()` in `src/utils/sync.ts`, so a shared browser never shows the previous user's data.
   - The on-device OCR worker, WASM core and language data are self-hosted under `/vendor/tesseract/` and cached on first use, so OCR never contacts a third-party CDN.

2. **IndexedDB Mutation Queue (`idb`)**:
   - If a mutation (creating an expense, attaching a receipt) occurs while offline (`!navigator.onLine`), it is enqueued into the `sync_queue` object store.
   - The UI optimistically renders the mutation with a local temporary ID (`temp-xxxx`).

3. **Automatic Drainage & Reconciliation**:
   - When the browser fires the `online` event or the user triggers a sync, `drainSyncQueue()` processes pending entries sequentially.
   - Pending receipts are posted as multipart `FormData` to the server, and the server replaces temporary IDs with permanent database UUIDs.

---

## 10. Background Schedulers

Hourly, in-process (`server/sweeps.ts`). Run a **single** instance, or add a distributed lock.

1. **Report e-mail** — for users with a schedule. By default it contains *counts only* ("N new entries across M jobs"). If the user opted in to **reports with figures**, the server decrypts that user's aggregate summary (uploaded by their app, encrypted under a report key they delegated) in memory, computes income/expense, change vs. the previous period, winners vs. loss leaders and top categories, sends the e-mail and discards the plaintext. See [API.md §7](API.md#report-e-mails). Opting out deletes the key and the stored summary.
2. **Subscription reminders** — uses the plaintext `next_generation_date` and reminder flags to send generic "a subscription is due in N days" e-mail/push/socket notices.

The server **no longer creates recurring expenses**; the user's own client generates due entries when the app opens (`src/e2ee/subscriptions.ts`, idempotent across devices).

---

## 11. Environment Configuration & Self-Hosting

Copy `.env.example` to `.env`. Configuration is parsed and validated in [server/config.ts](../server/config.ts).

| Environment Variable | Description | Default / Example | Required |
| :--- | :--- | :--- | :--- |
| `JWT_SECRET` | Session signing secret (≥ 32 chars, not a placeholder). Generate: `openssl rand -base64 64` | — | **Yes** (server exits without it in production) |
| `APP_URL` | Canonical public origin (CORS, email links, OAuth redirect) | `http://localhost:3000` | **Yes** |
| `NODE_ENV` | `development` enables the Vite dev server. Anything else is production. `npm start` sets `production`. | `production` | Optional |
| `PORT` / `HOST` | Listen port / interface | `3000` / `0.0.0.0` (`127.0.0.1` in dev) | Optional |
| `MODE` | `personal` or `saas` | `personal` | Optional |
| `DATA_DIR` | Directory for `data.db`, `uploads/`, `updates/` | `./data` | Optional |
| `DB_NAME` | Database filename inside `DATA_DIR` | `data.db` | Optional |
| `TRUST_PROXY` | Reverse-proxy hops in front of the app (needed for correct client IPs / rate limiting) | `1` | Optional |
| `ALLOWED_ORIGINS` | Extra CORS origins, comma separated | — | Optional |
| `JWT_EXPIRES_IN` | Session lifetime | `14d` | Optional |
| `CSP_MODE` | `report-only` to stage a CSP rollout | enforce | Optional |
| `ADMIN_EMAIL` | The existing account with this email is promoted to admin at boot; the address cannot be registered by anyone else once a user exists | — | Recommended |
| `DISABLE_REGISTRATION` | Block public sign-ups | `false` | Optional |
| `AI_ALLOWED_HOSTS` | Hosts (`host` or `host:port`, comma separated) allowed to use plain http and private addresses for AI endpoints, e.g. a LAN model server. Preferred over `ALLOW_PRIVATE_AI_URLS` | — | Optional |
| `AI_RESEARCH_TIMEOUT_MS` | Longest a research/draft call may run | `600000` | Optional |
| `INVOICE_EMAIL_DAILY_LIMIT` | Invoice e-mails per user per day | `30` | Optional |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `EMAIL_FROM` | Outbound email (STARTTLS required on non-465 ports). If unset, emails are skipped and logged | port `587` | Optional |
| `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `GOOGLE_REDIRECT_URI` | Google Calendar OAuth 2.0 | — | Optional |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Firebase Admin credentials for push notifications | `./secrets/firebase-adminsdk.json` | Optional |
| `SERVER_WRAP_KEY` | 32-byte base64 key (`openssl rand -base64 32`) used **only** to hold the calendar key (background Google sync) and report key (reports with figures) of users who opt in. Without it those opt-ins are unavailable. | — | Optional |
| `EMAIL_CAPTURE_DIR` | Dev/test aid: when SMTP is not configured, write outgoing e-mails to this folder instead of dropping them | — | Optional |
| `KDF_MIN_ITERATIONS` / `KDF_DEFAULT_ITERATIONS` | Minimum accepted PBKDF2 iterations / default advertised for unknown users | `300000` / `600000` | Optional |
| `RATE_LIMIT_MULTIPLIER` | Scales all rate limits. **Tests only; keep `1` in production.** | `1` | Optional |
| `ALLOW_PRIVATE_AI_URLS` | Allow AI provider URLs on private networks (local Ollama). Keep `false` when internet-facing | `false` | Optional |

### Running

```bash
npm ci
npm run dev        # development: Vite + HMR, binds to 127.0.0.1
npm run serve      # production: build the frontend, then start the server
npm start          # production server only (requires a prior `npm run build`)
npm run admin:promote -- you@example.com
```

### Running with Docker
The repository ships a multi-stage `Dockerfile` (build stage compiles the frontend; the runtime stage is non-root and contains no compilers, `.env`, secrets or data), a `docker-compose.yml` and a `.dockerignore`. The published image is `futurelabz/glass-expense`.

| Setting | In the container |
|---|---|
| Data directory | `DATA_DIR=/data` (a volume: database, `uploads/`, `updates/`) |
| Listen address | `HOST=0.0.0.0`, `PORT=3000` (compose publishes it on `127.0.0.1:3000` only; put a TLS proxy in front) |
| Configuration | `--env-file .env` (same variables as above; `JWT_SECRET` and `APP_URL` are required) |
| Firebase key | mount `./secrets` at `/app/secrets` (read-only) or set `FIREBASE_SERVICE_ACCOUNT_PATH` |
| Health check | `GET /api/info` |

```bash
docker compose up -d --build
docker exec -it <container> node_modules/.bin/tsx scripts/promote-admin.ts you@example.com
```
See the README "Docker" section for the plain `docker run` form, upgrades and publishing. Keep exactly one container running.

### Upgrading an existing deployment to this layout
1. Stop the app and take a backup of the project directory.
2. Move runtime files: `data.db` → `data/data.db`, `uploads/` → `data/uploads/`, `updates/` → `data/updates/`; the Firebase JSON → `secrets/firebase-adminsdk.json` (or set `FIREBASE_SERVICE_ACCOUNT_PATH`). Alternatively set `DATA_DIR` to the existing location.
3. Set a strong `JWT_SECRET` (this signs everyone out once) and `TRUST_PROXY` if you run behind nginx/Cloudflare.
4. Start with `npm start`. Database migrations run automatically and are idempotent.

---

## 11b. Admin system

Admin rights come **only** from the `users.is_admin` flag (no e-mail matching at request time): the first account is admin; `npm run admin:promote -- <email>` grants it; on boot the existing account matching `ADMIN_EMAIL` is promoted once and that address is reserved against registration by anyone else. Admin routes need an interactive session (never an API key). Admins can manage e-mail/plan, delete users, view stats, edit SaaS limits and manage license keys — but **cannot read user data and cannot set passwords** (the server never has them). Details and endpoint list: [API.md §8](API.md#8-administration-the-admin-system).

## 11c. Testing

`npm test` boots a throwaway server (temp database, no SMTP/Firebase/Google, relaxed rate limits) and runs these suites with the real client code:

| Suite | Covers |
|---|---|
| `crypto` | Key derivation, bundles, envelopes + AAD, ECDH sharing, API-key secrets |
| `server.e2ee` | v2 auth, ciphertext-only storage, access control, invites, receipts, API-key scope, sockets, reset/password flows, **database plaintext scan** |
| `client.e2ee` | The page-facing API layer: jobs, expenses, tags, tax, reports, import/export, sharing, API-key flow, session switching, plaintext scan |
| `migration` | A seeded pre-encryption account (and 120-job account) migrated end to end; legacy plaintext verified gone from DB, WAL and uploads |
| `examples` | The documented Node, browser and (if installed) Python decrypt clients and the published test vector |
| `reports` | Report math (trend, winners, loss leaders), the opt-in/opt-out lifecycle, nothing readable in the database, rendered e-mails with and without figures |
| `agent` | Agent API (`/api/agent/v1`): key scoping, validation, numbering, description append, plus characterization tests that pin current behavior |
| `agent.invoices` | Structured job intake, `external_ref` idempotency, the invoice permission levels (none < read < draft < finalize), estimate-only creation, locked final invoices, ciphertext-only storage |
| `invoice.e2ee` | Encrypted invoice storage: revisions and 409s, members read / owner writes, non-members 404, no plaintext in the database, ciphertext bound to its record, cascades, byte-identical round trip |
| `ai.relay` | AI relays against a stub provider: SSRF guard and `AI_ALLOWED_HOSTS`, task polling/isolation/cancel, **UI-created jobs are never auto-researched**, API-posted jobs on research-enabled keys are researched once, injected output changes nothing |
| `mailer` | The e-mailer: attachment bytes equal the client PDF, header injection and link allow-list, size/recipient limits, daily cap |
| `invoice.core` · `invoice.sheet` · `invoice.parity` · `invoice.layout2` | Pure suites (no server): the original app's math, hostile-JSON normalization, the sheet view-model, **byte-for-byte PDF parity** with the vendored original (`tests/reference/automotive/`, 1,300 random invoices), and the opt-in layout 2 |
| `invoice.ge` · `invoice.ui` | Settings, packages, intake fixtures, prefill and rate adoption, estimate→final, pay links, the sales-tax split, AI draft and research merging · server-rendered smoke tests of the React components |

---

## 12. Project Roadmap & Milestone History

### Phase 1: Native Android Capacitor Shell & OTA Updates
- Wrapped PWA in native Android container using `@capacitor/core` and `@capacitor/android`.
- Added native Camera (`@capacitor/camera`) and Push Notifications (`@capacitor/push-notifications`).
- Implemented self-hosted Over-The-Air updater via `@capgo/capacitor-updater` with animated progress overlays.

### Phase 2: Dynamic PDF Invoice Engine
- Added `invoice_templates` schema and rolling 6-character numbering sequence (`A00001` - `A99999`).
- Enforced strict invoice uniqueness per user.
- Engineered `InvoiceGenerator.tsx` with high-DPI PDF generation and viewport preview controls.

### Phase 3: Advanced Reports & Workspace
- Built multi-criteria report generation wizard (`ReportWizard.tsx`).
- Created interactive charts (Grouped Bars, Area Trends, Box & Whisker variance).
- Built zero-knowledge E2EE receipt gallery and printable report layout (`#printable-report-area`).

### Phase 4: Tax Management & Compliance Engine
- Built pure mathematical federal tax engine (`src/utils/taxCalculator.ts`) supporting Sole Proprietors, Single-Member LLCs, and S-Corps.
- Added Vehicle Optimizer comparing Standard Mileage ($0.70/mi in 2025) vs Actual Expenses.
- Added Form 1040-ES quarterly vouchers with statutory safe-harbor calculations (90% current year vs 100%/110% prior year).
- Built digital interactive IRS forms (Schedule C, Schedule SE, Form 1040, Form 1040-ES) with real-time recalculation.
- Created **Deduction Discovery Review Modal** enabling one-click batch claiming of untagged business write-offs.
- Created **First-Time Self-Employed Tax Filing Blueprint** on the Overview tab explaining exact documents, line mappings, and net loss refund mechanics for beginners.
- For complete in-depth specifications, formulas, and workflows, see [TAX_SYSTEM.md](TAX_SYSTEM.md).

### Phase 5: End-to-End Encryption
- Split authentication from encryption (password never sent), per-user ECDH key pairs, approval-based job sharing, single-use invites.
- Encrypted jobs, expenses, wishlists, subscriptions, tags, tax data, W-2s, templates and receipts; authenticated receipt downloads.
- Calendar-only API keys with caller-side decryption; opt-in server-side Google sync.
- Client-side reports, tax engine, invoice numbering, recurring entries; one-time resumable migration of existing accounts.
- Roadmap: re-keying on member removal, OPAQUE login, reproducible/native builds, encrypted offline queue.

### Phase 6: Invoicing 2.0
- A native **Invoices & Estimates** workspace (a tab on the dashboard) replaces the old one-page screenshot generator: the original standalone app's features, layout and PDF output ported to React + TypeScript (PDF bytes verified identical against the original), user-defined **Service Packages**, a live paper preview, history, JSON import/export, print and PDF.
- **Fees and detail fields are the user's own** (any trade): a document carries labelled fee lines and detail fields instead of the original app's fixed fee rows and vehicle box, and a website can fill them by variable name (`fields.<name>`, `quote.base_fee`, `quote.variables`). The shop profile is set once in Settings → Invoices.
- Documents are saved as small encrypted JSON records under the job key; they are **generated as Estimates** and become Final Invoices only through a recorded confirmation (a person, or an agent key with the `finalize` permission).
- The **website is the source of truth for rates** (a posted `quote` becomes the estimate's rate and fee); the job's intake is parsed and normalized, and estimates are drafted automatically for API-posted jobs. **Payments** (PayPal / Venmo / Cash App / Zelle links, "How to pay" on the PDF) are recorded by hand and become income entries with an optional per-user **sales-tax split**.
- Optional **AI**: draft an estimate's hours (never prices) and an **AI Research** button; the website's research step moved into GlassExpense, running only for jobs posted by research-enabled API keys. An internal **e-mailer** sends the PDF.
- See [INVOICING_PLAN.md](INVOICING_PLAN.md) for the design and decisions, and [API.md §3A](API.md#3a-agent-api-for-automations-and-ai-agents-opt-in-keys) for the agent contracts.
