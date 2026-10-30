# GlassExpense — Security Audit & Remediation Plan

**Date:** 2026-10-30 · **Scope:** `server.ts`, `db.ts`, `email.ts`, `google-calendar.ts`, `server/saas/*`, `src/utils/*`, `src/context/*`, auth pages, `MarkdownRenderer`, `OTAUpdateManager`, `vite.config.ts`, Capacitor/Android config, `package.json` + `npm audit`, repo hygiene. Cross-checked against `DOCUMENTATION.md` and `API.md`.

**Method:** manual code review of the full backend (3.1k lines) and all security-critical frontend modules; grep-sweep of the rest of the frontend for dangerous sinks; `npm audit`/`npm outdated`; two findings reproduced in isolation (marked ✅ **Verified**). Everything else is *code-reviewed* (read the code, did not exploit it).

**Not covered / limits:** `Job.tsx`, `TaxCenter.tsx`, `Settings.tsx`, `ReportsWorkspace.tsx` (~9.6k lines) were only swept for XSS/storage sinks, not read line-by-line. Tax-calculation *correctness* was not audited. Native Android code and the live deployment were not probed. `npm audit fix --dry-run` could not run because `node_modules` was built on Linux (see D-9).

> Secret values are intentionally **not** reproduced in this file. Locations only.

---

## 0. Remediation status (updated 2026-10-30)

Most findings were fixed and verified with automated tests. The repository now ships `npm test` (49 checks across crypto, server, client-layer, migration and documented-example suites, run against a throwaway server). Schema migrations were also dry-run against a copy of the real database (5 users, 238 expenses): admin promotion, per-user tax mappings and the new session column applied with integrity and foreign-key checks clean.

Line numbers in section 2 refer to the original `server.ts` (now `server/index.ts`).

**Legend:** ✅ fixed · 🟡 mitigated / partly done · ⛔ open · 👤 needs you

| ID | Status | What changed / what remains |
|---|---|---|
| C-1 | ✅ code · 👤 rotate | Hard-coded SMTP creds and the JWT fallback removed; server exits at boot on a missing/short/placeholder `JWT_SECRET`; Firebase key moved to gitignored `secrets/`; `.env.example` scrubbed; `.gitignore` extended. **You must still rotate the SMTP2GO password, the Firebase service-account key, `JWT_SECRET` and the Google OAuth secret** — they existed in plaintext files/backups. |
| C-2 | ✅ | Live host verified clean. Production is now the default; Vite loads only with `NODE_ENV=development`, binds to 127.0.0.1 and has `fs.deny` for `data/`, `secrets/`, `server/`, `*.db`. Runtime data moved out of the project root to `data/`. |
| C-3 | ✅ | **Fixed by the end-to-end encryption release.** The password is never sent: the browser derives an independent auth key (sent) and wrap key (kept) with PBKDF2-600k + HKDF; the server stores only `bcrypt(authKey)` and a sealed key bundle. Verified by tests that the stored hash does not verify the password. Residual: a hostile operator who serves modified JavaScript can still capture a password at login (inherent to browser-delivered E2EE); offline guessing of `authKey` is slowed by 600k PBKDF2 iterations (OPAQUE would remove it; on the roadmap). |
| H-1 | ✅ | Socket.IO requires a valid JWT, `join_job` checks membership, CORS allow-list, members are evicted from the room when removed/leaving. |
| H-2 | ✅ | `requireJobAccess` on every `/api/jobs/:jobId/*` route (non-members get 404); tag ownership verified; batch key import filtered to accessible jobs; only a subscription's author or the job owner can cancel it. |
| H-3 | ✅ | Receipts are encrypted client-side and are only accepted as `application/octet-stream` with random names; **`/uploads` is no longer served** — downloads go through the authenticated, membership-checked `GET /api/v2/uploads/:file` (`Cache-Control: private, no-store`). Legacy plaintext receipts are re-encrypted during migration. |
| H-4 | ✅ | Markdown renderer escapes first and only allows `http(s)`/`mailto` links. |
| H-5 | ✅ | Reset link from `APP_URL`, hashed single-use token, rate limited, sessions revoked, **and** the reset now requires proof of the recovery phrase (`key_check`), so a stolen token can no longer overwrite the vault. Tested. |
| H-6 | ✅ | `assertSafeOutboundUrl`: https only, no credentials, DNS-resolved address must be public, `redirect:'error'`, timeouts; upstream bodies no longer echoed. Residual: DNS-rebinding between check and fetch is theoretically possible; pin the resolved IP if this ever serves untrusted tenants. |
| H-7 | 🟡 | Global + per-route rate limits, 8-failure lockout, constant-time login, escaped emails, `ADMIN_EMAIL` reserved. E-mails no longer carry user content. **Open:** e-mail verification on sign-up. |
| H-8 | 🟡 | 14-day expiring HS256 tokens, algorithm pinned, `token_version` revocation on password change/reset. **Open:** short-lived access + refresh tokens and moving the token out of `localStorage` (httpOnly cookie). |
| H-9 | ✅ | Google OAuth `state` is a signed, 10-minute, purpose-bound token. |
| H-10 | 🟡 | Client now passes the server-published SHA-256 checksum. **Open:** bundle signing/encryption; **test on a device** (fails closed — a checksum mismatch aborts the update). |
| M-1 | ✅ | Schedule C lines whitelisted everywhere; tax aggregation uses a null-prototype object. Regression-tested. |
| M-2 | ✅ | Admin = `users.is_admin` only. Existing `ADMIN_EMAIL` account is promoted once at boot (verified on the real DB copy); `npm run admin:promote`. |
| M-3 | 🟡 | KDF raised to PBKDF2-SHA256 600k with per-user random salts, non-extractable keys, `key_check`, AAD-bound ciphertext, per-user ECDH key wrapping, approval with fingerprint checks; invites no longer contain keys; legacy `localStorage` keys migrated and removed. **Open:** automatic re-keying when a member is removed (access is cut server-side immediately, but a removed member keeps the old key and anything already downloaded). |
| M-4 | ✅ | Helmet + CSP (`CSP_MODE=report-only` available), HSTS, no-referrer, `x-powered-by` off, `trust proxy` configurable, CORS allow-list. **Test the UI in a browser** (OCR, PDF export, fonts) after deploying. |
| M-5 | ✅ | See H-3. |
| M-6 | ✅ | The AI provider key, tax data, W-2/EIN, invoice template, tags, notes and all content are encrypted client-side; legacy plaintext is deleted and the DB vacuumed at migration. The server holds only account metadata, job dates and (opt-in) a sealed calendar key. |
| M-7 | ✅ | Central error handler; `details:` leaks removed. |
| M-8 | 🟡 | Validation helpers on jobs, expenses, subscriptions, wishlists, tags, tax profile/W-2/mappings, AI settings, reports, admin, licenses; W-2 upsert scoped to owner; tax overrides per user (table migrated). Lighter validation remains on a few low-risk routes; a schema library (zod) would finish it. |
| M-9 | ✅ | All interpolations escaped, subjects stripped of CR/LF, STARTTLS required, plain-text parts. |
| M-10 | ✅ | Caches wiped on logout/session change; the decrypted-data cache is cleared whenever the session changes (a cross-user cache leak found during testing is fixed and covered by a test); cached API responses are ciphertext. |
| M-11 | ✅ | License lifecycle `unused → active | remote_used`, atomic claim, rate limited; old data migrated. |
| M-12 | 🟡 | `allowBackup=false`, push-token logging removed. **Open:** R8/minify, restrict the Firebase/Google API key by package + SHA-1. |
| M-13 | ✅ code · 👤 test | Tesseract worker/WASM/language data self-hosted (`/vendor/tesseract`), no CDN. **Verify on-device OCR in a browser once** — I could not run a browser here. |
| M-14 | 🟡 | Admin user-delete removes receipt files and detaches license rows. **Open:** self-service delete/export. |
| L-1 | ✅ | API keys are now **calendar-only** (everything else `403`), carry a private decryption half the server never sees, and record `last_used_at`. **Open:** per-key expiry. |
| L-2 | ✅ | Join-by-job-ID replaced by single-use, 7-day invite tokens; members are `pending` (no access) until the owner approves them after comparing a security-code fingerprint. |
| L-3 | ⛔ | Sweeps still run per process; run a single instance or add a lock. |
| L-4 | ⛔ | Verify Stripe webhook signatures before wiring payments. |
| L-5 | ⛔ | Totals double-count with >1 member; tax engine aggregates all members' expenses (correctness). |
| L-6 | ✅ | Dead files removed (`server.ts.bak`, `check*.js`, `database.sqlite`, `metadata.json`, `dev-dist/`), project reorganised, package renamed, scripts fixed. |
| L-7 | ✅ | `GEMINI_API_KEY` client-bundle `define` removed. |
| L-8 | ✅ | Docs corrected and moved to `docs/`. |
| L-9 | ⛔ | Migrations still swallow errors (the new ones fail loudly); no tests/CI yet. |
| Packages | ✅ | **42 → 14 advisories: 0 critical, 0 high**, 3 moderate (`qs`, `uuid`/`gaxios` via `googleapis`), 11 low (build-time: `elliptic` chain via `vite-plugin-node-polyfills`, `workbox-build`, `esbuild` dev server). `nodemailer` upgraded 8→10. Removed unused `@google/genai`, `@ionic/pwa-elements`, `tailwind-merge`, `clsx`, stub `@types`. `tsx`/`cross-env` moved to runtime deps. |

### What is still on your plate
1. **Rotate secrets** (C-1) — highest priority. Delete the pre-cleanup backup afterwards (it holds the old secrets).
2. **Set a real `JWT_SECRET`** everywhere; optionally set `SERVER_WRAP_KEY` (only needed for the opt-in background Google sync).
3. **Before deploying the encryption release:** back up `data/`. Each existing user's data is encrypted the next time that user signs in (their browser does it; progress screen; resumable). Old backups keep the plaintext, so rotate/delete them once everyone has migrated (`SELECT username, e2ee_version FROM users` shows who is done).
4. **Deploy-time checks:** UI smoke test in a real browser with the new CSP (OCR, invoices/PDF, charts, fonts, invite/approve flow, unlock screen); OTA update on a device. These cannot be exercised by the automated tests.
5. **Next engineering phases:** re-keying on member removal (M-3), OPAQUE/PAKE login, e-mail verification (H-7), self-service delete/export (M-14), cookie sessions (H-8), per-key API expiry, zod + CI (M-8, L-9).

---

## 1. Executive summary

| Severity | Count | Headline |
|---|---|---|
| **Critical** | 3 | Live secrets in source; dev server exposes DB + Firebase key; "zero-knowledge" claim is not true as built |
| **High** | 10 | Unauthenticated sockets, missing authorization on job routes, stored XSS ×2, reset-link poisoning, SSRF, no rate limiting, non-expiring JWTs, OAuth CSRF, unsigned OTA |
| **Medium** | 14 | Prototype pollution, admin squatting, weak KDF params, no security headers, upload handling, plaintext secrets at rest, … |
| **Low / Info** | 9 | Cron safety, repo cruft, doc drift |
| **Dependencies** | 42 advisories | 2 critical, 18 high, 11 moderate, 11 low (most auto-fixable) |

**The three things to do before anything else** (Phase 0): confirm the live site is not serving `data.db`, rotate every secret listed in C-1, and make production start in `NODE_ENV=production`.

---

## 2. Findings

### CRITICAL

#### C-1 · Live credentials committed in source / config
| | |
|---|---|
| Where | `email.ts:10-11` (hard-coded SMTP2GO user + password as `||` fallback); `.env.example` (same SMTP password, and the `SMTP_*` block); `glassexpense-firebase-adminsdk-fbsvc-*.json` in project root (**Firebase Admin private key**, loaded at `server.ts:21`); `server.ts:55` and `server.ts.bak:17` (`JWT_SECRET` fallback = `<redacted: former hard-coded JWT fallback>`); `.env` `JWT_SECRET` also contains `super-secret…` (looks like the dev default) |
| Impact | Anyone who has ever seen the repo/zip/backup can send mail as your domain, push notifications to all devices, and — with the JWT secret — **mint a valid token for any user ID, including the admin**. Because the JWT fallback exists, a missing env var on the server silently degrades to a public secret. |
| Gap | (At audit time) `.gitignore` covered `.env*` but **not** `*firebase-adminsdk*.json`, `*.bak`, or `*.db` variants other than `data.db`; now fixed. The project is not currently a git repo, but the first `git init && git add .` would commit the Firebase key. |
| Fix | Rotate everything (Phase 0). Remove all `\|\| '<secret>'` fallbacks and fail-fast at boot if `JWT_SECRET`/`SMTP_*` are missing or equal a known default. Load Firebase creds from `GOOGLE_APPLICATION_CREDENTIALS` (path outside the repo) or an env-injected JSON. Extend `.gitignore`. |

#### C-2 · Vite dev server serves the database, Firebase key and source to anyone ✅ **Verified**
| | |
|---|---|
| Where | `server.ts:3092-3103` runs `createViteServer` unless `NODE_ENV === 'production'`. `package.json` scripts `dev`, `dev:saas`, and `start` never set it; only `serve` does. `vite.config.ts:115` has `allowedHosts: ['expenses.futurelabz.dev']`, i.e. the real domain is expected to hit this code path. |
| Reproduction | Clean Vite 6.4.1 middleware with `root` containing fake `firebase-adminsdk-test.json`, `data.db`, `.env`, `server.ts`: → `200` JSON key file, `200` `data.db`, `200` `server.ts` source, `403` `.env` only. |
| Impact | If production is started with `npm run dev` / `dev:saas` / `npm start`, `GET /data.db` returns **every user's hash, wrapped master key, reset tokens, Google refresh tokens, AI API keys, W-2 data**, and `GET /glassexpense-firebase-adminsdk-….json` returns the Firebase private key. No authentication. Also, `vite ≤6.4.3` has its own dev-server file-read advisories (D-1). |
| Live check (2026-10-30) | `curl` against the production host for `/data.db`, the Firebase JSON, `/server.ts`, `/db.ts`, `/email.ts`, `/package.json`, `/.env`, `/server.ts.bak` returned only the SPA HTML page (`200 text/html`), and the response bodies contained no database/key/source signatures. **Not exploitable in production as deployed**; severity was effectively *High (latent)* rather than Critical. |
| Fix | Verify live now (Phase 0) ✅. Default to production: anything but `NODE_ENV=development` is production. Move `data.db`, `uploads/`, `updates/`, secrets out of the project/web root (`DATA_DIR`). See status below. |

#### C-3 · "Zero-knowledge / E2EE" is not true as implemented
| | |
|---|---|
| Where | `Register.tsx:32-38`, `Login.tsx:20-28`, `ResetPassword.tsx:41-47`, `src/utils/crypto.ts:53-75` |
| What | The **same plaintext password** is (a) POSTed to the server on every register/login and (b) used client-side as the PBKDF2 input that derives the key wrapping `master_key_encrypted`. The server stores `master_key_encrypted` and receives the password → it (or anyone who can read request bodies, logs, a reverse-proxy, or a compromised server process) can derive the wrapping key, unwrap the master key, unwrap every job key, and decrypt every receipt. PBKDF2 salt is the (server-known) email. |
| Also | A DB-only leak is protected only by password strength: bcrypt-10 hash (cheap to attack) → password → wrapping key. DOCUMENTATION.md §1/§5 and the Legal/ApiDocs copy overstate the guarantee. |
| Fix | Phase 4: split the secrets — derive an independent **auth credential** from the password (different salt/info) and send only that; keep the wrapping key client-side. Move to Argon2id or PBKDF2 ≥ 600k with a random per-user salt. Until shipped, correct the claims in docs/UI. |

---

### HIGH

#### H-1 · Socket.IO has no authentication; CORS `*`
`server.ts:59-63`, `3068-3075`; client `Layout.tsx:35`, `Job.tsx:337` (connects without a token). Any origin/any unauthenticated client can `join_job` any ID and receive every `expense_added`, `expense_updated`, `wishlist_*`, `subscription_reminder` payload (full expense rows incl. descriptions, amounts, `receipt_url`). Also `leave_job` isn't enforced on member removal.
**Fix:** `io.use()` verifying the JWT in `handshake.auth`; on `join_job` check creator/`job_users`; restrict `cors.origin` to `APP_URL` + Capacitor origins; kick sockets on member removal.

#### H-2 · Missing authorization (IDOR) on job-scoped routes
No creator/member check on:
| Route | Line | Consequence |
|---|---|---|
| `GET /api/jobs/:jobId/expenses` | 1837 | read any job's full ledger + tags |
| `POST /api/jobs/:jobId/expenses` | 1868 | inject expenses/receipts into any job; broadcasts to its room |
| `GET/POST/DELETE /api/jobs/:jobId/subscriptions[/:subId]` | 1630-1669 | list / create / cancel recurring entries on any job — **created subs auto-write expenses into the victim's job every period** (sweep, line 325) |
| `GET/POST /api/jobs/:jobId/wishlist` | 2146-2173 | read / write any job's wishlist |
| `POST /api/jobs/:jobId/keys` | 1532 | writes junk key rows for arbitrary job IDs |
| `DELETE /api/jobs/:jobId/subscriptions/:subId` | 1666 | `WHERE id AND job_id` only — any user can deactivate |
Mitigating factor: job IDs are random UUIDs — but they *are* the invite secret (`/api/jobs/join` needs nothing else), appear in URLs, Referer headers, socket payloads and Google Calendar event links (`google-calendar.ts:42`).
**Also:** `PUT …/expenses/:id/tags` and `POST …/expenses` accept any `tagId` without checking it belongs to the caller → leaks other users' tag names/colors via the response join (2013-2018).
**Fix:** one `requireJobAccess` / `requireJobOwner` middleware used by every `/api/jobs/:jobId/*` route; table-driven authz tests (Phase 6).

#### H-3 · Stored XSS via user uploads served same-origin
`server.ts:73` (`express.static(uploads)`), `95-99` (multer: no size cap, no `fileFilter`, original filename kept, any MIME). An authenticated user (open registration, plus H-2) uploads `x.html`/`x.svg` → served as `text/html`/`image/svg+xml` from the app origin → script runs with access to `localStorage.token` (JWT, non-expiring) and `sessionStorage.master_key` (raw vault key). Send victim the `/uploads/…` link = full account + vault takeover. Uploads are also readable **unauthenticated** by URL (legacy plaintext receipts), and unlimited upload size is a disk-fill DoS.
**Fix:** random server-side filenames, MIME allow-list + magic-byte check, size limit, store outside web root, serve via authenticated route with `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment` / `Content-Security-Policy: sandbox`.

#### H-4 · Stored XSS in Markdown renderer
`MarkdownRenderer.tsx:77-91` runs regex substitutions on raw text and sets `dangerouslySetInnerHTML` with **no escaping**: `<img src=x onerror=…>` passes through verbatim, and `[a](javascript:…)` becomes a live `href`. Used at `Job.tsx:2443` for the "AI notes" slice of `job.description` (creator-controlled, rendered to every collaborator).
**Fix:** drop the home-grown parser → `react-markdown` (no raw HTML) or `marked` + DOMPurify with a URL-scheme allow-list.

#### H-5 · Password-reset flow: link poisoning, plaintext tokens, vault-bricking
- `server.ts:543` builds the reset link from the **request's `Origin`/`Host`**. Attacker POSTs `forgot-password` for a victim with `Origin: https://evil.tld`; the genuine email links to evil.tld; one click leaks the token. **Fix:** use `APP_URL` only.
- `reset_token` stored in plaintext (`539`, `553`) — store SHA-256; make single-use (already nulled), shorten expiry.
- `reset-password` (`549-564`) **overwrites `master_key_encrypted` with whatever the client sends**. Whoever holds a reset token (phished, or mailbox access) can permanently destroy the victim's vault; a user who mistypes their 12 words does the same to themselves. **Fix:** key-check value verified client-side before submit, and server-side proof of mnemonic knowledge (Phase 4).
- No rate limit on `forgot-password` (email bombing).

#### H-6 · SSRF with reflected response
`server.ts:885-901` (`/api/settings/ai/verify`) `fetch(\`${ai_base_url}/models\`)` with a user-supplied URL and returns `await response.text()` on failure. `/api/ocr` (2041) and `/api/taxes/w2/ocr` (2494) fetch the stored `ai_base_url` and also reflect `err` bodies. Any registered user can reach `169.254.169.254`, `localhost`, internal admin panels, and read the response.
**Fix:** https-only URL parse, DNS-resolve and block private/loopback/link-local/metadata ranges (re-check after redirects, `redirect:'error'`), timeout + size cap, never echo upstream body.

#### H-7 · No rate limiting, brute-force protection or email verification
None of `express-rate-limit`, `helmet`, or a validation library is present. Open to credential stuffing on `/auth/login`, license-key guessing on `/license/remote-verify` (unauthenticated), SMTP abuse (`register`, `forgot-password`, `settings/reports/test`, `…/subscriptions/test`), and sync `bcryptjs` calls (cost 10) that block the event loop under load.
Registration has **no email verification**: anyone can register *someone else's* email and the server sends a "Welcome" mail from your domain to that victim whose body interpolates the attacker-chosen `username` as raw HTML (`email.ts:23`; see also M-9) — phishing from a trusted sender. Also enables ADMIN_EMAIL squatting (M-2).

#### H-8 · JWT design
`server.ts:506,526` `jwt.sign({…}, JWT_SECRET)` — **no `expiresIn`**, no `algorithm` pin on sign/verify, no revocation, not invalidated by password change/reset, stored in `localStorage` (readable by any XSS). Stolen token = permanent access. Reset/ change-password should kill existing sessions.
**Fix:** short-lived access token + rotating refresh (or `token_version` column), `algorithms:['HS256']`, bump version on password change; httpOnly SameSite cookie for web (Phase 3).

#### H-9 · Google OAuth callback is unauthenticated and trusts `state` as a user ID
`server.ts:1200-1231`: `state: req.user.id` (unsigned), callback has no auth and writes the refresh token to `WHERE id = state`. An attacker who knows a victim's user ID (visible to collaborators via `/members`) can complete the flow with *their own* Google account and bind it to the victim; every subsequent job/expense sync (`google-calendar.ts`) then writes the victim's financial data into the **attacker's calendar**.
**Fix:** server-stored random `state` nonce (TTL, bound to user), verified on callback; PKCE.

#### H-10 · OTA update channel has no integrity or authenticity check
`OTAUpdateManager.tsx:72-75` calls `CapacitorUpdater.download({url, version})` — the `checksum` the server returns (`server.ts:464`) is ignored, and bundles are unsigned. Whoever can write `updates/` or MITM a non-TLS `APP_URL` ships arbitrary JS into an app that holds the user's master key.**Fix:** pass `checksum`, enable Capgo end-to-end encryption/code-signing with a public key baked into the app, HTTPS-only, monotonic version (anti-rollback).

---

### MEDIUM

| ID | Finding | Where | Fix |
|---|---|---|---|
| M-1 | ✅ **Verified** — **Server-side prototype pollution** by any user. `schedule_c_line` is unvalidated (`reassign-expense` 2851, batch 2893, `tag-mappings` 2953). Setting it to `__proto__` makes `expensesByLine['__proto__']` resolve to `Object.prototype`, so `+= amount` sets `Object.prototype.total/count = NaN` process-wide until restart. | `server.ts:2771-2775` | Whitelist against `SCHEDULE_C_LINE_METADATA`; use `Map`/`Object.create(null)`; run Node with `--disable-proto=delete` as defense in depth. |
| M-2 | **Admin by email string.** `isAdmin` = `is_admin` **or** `email === ADMIN_EMAIL`, recomputed per request (`114`,`134`,`527`); no email verification → whoever registers/sets that address first is admin (legacy no-email users can self-set via `PATCH /me/email`, 586). | `server.ts` | Drop email-based admin; promote via CLI/DB flag; require verified email. |
| M-3 | **Weak/odd crypto parameters.** PBKDF2-SHA256 **100k** (OWASP ≥ 600k); salt = email (not random; Register uses raw case, docs say lowercase → login mismatch risk); wrapping/job keys `extractable: true`; no key-check value; **no key rotation on member removal** (removed members keep the raw job key — invite is `jobId#rawKey`, `Job.tsx:586`); no AAD binding blob→expense; legacy raw keys in `localStorage job_key_*` (`Job.tsx:249`, `Dashboard.tsx:153`). | `crypto.ts` | Phase 4. |
| M-4 | **No security headers / CSP / HSTS / `trust proxy`;** `x-powered-by` on; `app.use(cors())` open; listens on `0.0.0.0` with no HTTPS redirect. | `server.ts:65,3106` | `helmet` + strict CSP, `Referrer-Policy: no-referrer`, HSTS, `app.set('trust proxy', …)`, CORS allow-list. |
| M-5 | **Upload handling:** OCR upload is written into the *public* `uploads/` dir and only deleted on the success path (`2136`; error returns at 2066/2141 leave plaintext receipts/W-2 images web-readable); orphaned files when expense insert throws; no cleanup on user delete (member-authored receipts). | `server.ts:2030-2143` | `os.tmpdir()` + `finally { unlink }`; cleanup job. |
| M-6 | **Secrets/PII in plaintext at rest:** `ai_api_key` (also **returned in full** by `GET /api/settings/ai`, 858), `google_refresh_token`, `reset_token`, device tokens, W-2 wages/EIN, `scorp_ein`. DB file mode 644. | `db.ts`, `server.ts` | Encrypt secrets with an env-held AES-256-GCM key; mask `ai_api_key` in responses; `chmod 600`; encrypted backups. |
| M-7 | **Verbose errors:** `details: err.message` on ~15 routes (`513`, `896`, `2067`, `2313`, `2399` …) leaks SQL/FS/upstream detail. | `server.ts` | Central error handler, log server-side with request ID. |
| M-8 | **Zero input validation.** `title`, `mode`, `entry_type`, `plan` (admin PATCH 639, license generate 772), `frequency` (`report_settings` — an unknown value like `DAILY` makes `next_run_at = now`, i.e. hourly mails), `amount` (`parseFloat` → `NaN`), dates, tag IDs. W-2 upsert `ON CONFLICT(id) DO UPDATE` (2437) lets a user overwrite **another user's** W-2 row if they know its ID. `expense_tax_mappings` is keyed by `expense_id` only, so any member re-categorising an expense changes the Schedule C result for **all** members. | `server.ts` | `zod` schemas on every route; `ON CONFLICT … WHERE user_id = excluded.user_id`; add `user_id` to `expense_tax_mappings`. |
| M-9 | **HTML injection in every email template** (`username`, `job.title`, `t.description`, `subDescription`, reset link) — `email.ts:23,97,107,257,265`. SMTP2GO on port 2525 without `requireTLS` (STARTTLS downgrade possible). | `email.ts` | `escape-html` all interpolations; `requireTLS: true`; add plain-text part. |
| M-10 | **Service-worker + IndexedDB leak between users.** Workbox caches `/api/jobs`, `/api/jobs/:id/expenses`, `/api/tags` with `StaleWhileRevalidate`, **not keyed by user and not cleared on logout** → on a shared device user B first sees user A's cached ledger. Offline queue (`sync.ts`) also survives logout and would post A's pending items using B's token. | `vite.config.ts:60-97`, `AuthContext.tsx:68` | `NetworkFirst` or per-user cache names; on logout `caches.delete`, clear IDB queue; `Cache-Control: private, no-store` on API. |
| M-11 | **License logic:** `activate` only rejects status `'used'`, but activation sets `'active'` (`801-806`) → one key can be activated by unlimited users/instances; `remote-verify` is unauthenticated with no throttle. | `server.ts:791-827` | Single-use state machine, rate-limit, bind to instance ID. |
| M-12 | **Android:** `allowBackup="true"` (tokens/keys in WebView storage extractable via backup/adb); `minifyEnabled false`; push token written to `console.log` (`App.tsx:47`); Firebase/Google API key in `google-services.json` should be restricted to package + SHA-1. | `AndroidManifest.xml:5`, `build.gradle:21` | `allowBackup=false` + `dataExtractionRules`, enable R8, restrict API key, drop logging. |
| M-13 | **Third-party fetch breaks "zero-network OCR":** `tesseract.js` pulls worker/core/lang data from a public CDN at runtime (no SRI) — `ocr.ts` sets no `workerPath/corePath/langPath`. | `src/utils/ocr.ts` | Self-host the assets; add to precache. |
| M-14 | **Data lifecycle:** admin user-delete (646-699) never unlinks receipt files from disk (own jobs and receipts they authored in others' jobs), and `DELETE FROM users` fails on the non-cascading `license_keys.activated_by` FK, so deleting any user who activated a license returns 500. No self-service account deletion or data export (GDPR/CCPA). | `server.ts` | One `deleteUserCascade()` that also removes files and nulls `activated_by`; add self-service delete/export. |

### LOW / INFO

| ID | Note |
|---|---|
| L-1 | API keys carry **full-account scope** (including key creation, admin routes for admin users) and ignore plan gating at use-time (`authenticateToken` 102-116); `API.md` says key management needs JWT — code accepts API keys. No expiry / last-used / scopes. |
| L-2 | `/api/jobs/join` lets anyone with a job ID become a member (no creator approval/expiring invite token). |
| L-3 | In-process `setInterval` sweeps (`316`,`405`) run once *per process* — multiple instances double-send mail and double-create subscription expenses; sweep isn't atomic per subscription. |
| L-4 | Payment placeholders (`server/saas/index.ts:113-124`): `/api/payments/webhook` has **no signature verification** — must verify (Stripe signature) before it is ever wired to plan upgrades. |
| L-5 | `GET /api/jobs` `SUM()` over `job_users × expenses` joins double-counts totals when a job has >1 member (correctness, not security). Tax engine also aggregates *all members'* expenses into each member's return. |
| L-6 | Repo hygiene: `server.ts.bak`, `check.js`, `check-db.js`, `database.sqlite` (0 bytes), `metadata.json`, `dev-dist/` sit in the web/project root; `package.json` name is `react-example`; `start` script (`node server.ts`) can't run TypeScript; `dev:community` points to a nonexistent `community_edition/`. |
| L-7 | `vite.config.ts:103-105` bakes `process.env.GEMINI_API_KEY` into the **public client bundle** if it is ever set (currently absent from `.env`; `.env.example` lists it). Remove the `define`. |
| L-8 | Docs drift: `tax_settings` PK is `user_id` only (docs say `(user_id, tax_year)`); `AdminRoute` guard doesn't exist client-side (server check is correct); docs paths reference `/home/future/Desktop`; E2EE claims (C-3); `/api/ocr` privacy note says WebGPU models, code uses Tesseract. |
| L-9 | `db.ts` migrations swallow every error with empty `catch {}` and have no `schema_migrations` version table — real failures are invisible. No automated tests, no CI. |

---

## 3. Package check

`npm audit`: **42 advisories — 2 critical, 18 high, 11 moderate, 11 low.** (`npm outdated`: 40 packages behind; most are in-range patch/minor.)

### Runtime-relevant (fix first)
| Package (installed) | Sev | Issue | Exposure here | Fix |
|---|---|---|---|---|
| `dompurify` ≤3.4.16 (via `jspdf@4.2.1`) | **Critical** | SAFE_FOR_TEMPLATES bypass; IN_PLACE hook handlers stay armed | Client PDF generation path | upgrade `jspdf`; add `overrides` for first patched `dompurify` |
| `proxy-addr` 2.0.7 (via `express@4.22.1`) | **Critical** | IP spoofing via IPv4-mapped IPv6 trust subnet | Only if `trust proxy` set — it isn't *yet*; becomes live once you set it behind a proxy (M-4) | `express@4.22.3` |
| `body-parser`, `path-to-regexp`, `qs` (express) | High/Mod | DoS (limit bypass, ReDoS) | Pre-auth DoS on every route | `express@4.22.3` (in range) |
| `engine.io`, `socket.io-parser`, `socket.io-adapter`, `ws` | High | Connection-exhaustion / memory-exhaustion DoS, `ws` uninit-memory disclosure | **Unauthenticated** sockets (H-1) → remotely triggerable | `socket.io@4.8.4` (in range) |
| `multer` 2.1.1 | High | DoS: deeply-nested field names, incomplete cleanup of aborted uploads | Auth'd users (open registration) | `multer@2.5.0` (in range) |
| `nodemailer` 8.0.5 | High | CRLF injection in `List-*` headers; `jsonTransport` bypass | Low (app sets no `List-*`), but advisory range ≤10.1.3 | `nodemailer@10.3.1` (major — re-test SMTP) |
| `vite` 6.4.1 | High | Dev-server arbitrary file read (WS) / `.map` path traversal | **Live** if C-2 is true | `vite@6.4.5` (in range) + fix C-2 |
| `react-router` 7.13.1 | High | turbo-stream deserialization → RCE; `javascript:` redirect XSS | Affects framework/RSC mode; app uses declarative `<Router>` so likely not reachable — patch anyway | `7.18.5` (in range) |
| `uuid` 13.0.0 | Mod | Bounds check in v3/v5/v6 with `buf` | Not exploitable (only `v4()` used) | `13.0.2` |
| `fast-uri`, `browserslist`, `postcss`, `nanoid`, `picomatch`, `brace-expansion`, `source-map-js`, `baseline-browser-mapping`, `@babel/*`, `esbuild` | High–Low | ReDoS / DoS / file-read in tooling | **Build-time only** | `npm audit fix` |

### Build-time / transitive (low runtime risk, clean up)
- `serialize-javascript` (RCE advisory) ← `vite-plugin-pwa → workbox-build → @rollup/plugin-terser`: add an `overrides` entry to the first patched version (npm's suggested "fix: vite-plugin-pwa@0.2.1" is a bogus downgrade — ignore it).
- `elliptic`, `crypto-browserify`, `browserify-sign`, `create-ecdh`, `pbkdf2`, `node-stdlib-browser` ← `vite-plugin-node-polyfills`: **remove the plugin** and polyfill only `Buffer` (what `bip39` needs).
- `xcode → uuid`, `@capacitor/cli`: dev tooling; update Capacitor to 8.6.x.
- `gaxios → uuid` via `googleapis`/`google-auth-library`: bump `googleapis`.

### Hygiene
- **D-9:** `node_modules` was installed on Linux (macOS native `@rollup/rollup-darwin-*` missing → Vite cannot even start here). `rm -rf node_modules && npm ci`.
- Unreferenced in source (candidates to drop; confirm first): `@google/genai`, `@ionic/pwa-elements`, `tailwind-merge`, `clsx`, `workbox-window`, `html2canvas` (jsPDF peer), `cors` (if replaced).
- `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite` sit in `dependencies`; `@types/bip39` is a deprecated stub.
- No Dependabot/Renovate, no CI audit gate, no `engines` field.

---

## 4. Remediation plan

Ordered by risk-reduction per hour. Each item lists an **acceptance check** so we know it's done.

### Phase 0 — Today (stop the bleeding)  ·  ~2–4 h
| # | Action | Done when |
|---|---|---|
| 0.1 | **Check production exposure**: `curl -sI https://<prod>/data.db`, `/glassexpense-firebase-adminsdk-….json`, `/server.ts`. Review access logs for hits on those paths. | All return 404 / SPA HTML; logs reviewed. If any returned 200 → treat DB + all secrets as breached (force password resets, notify users). |
| 0.2 | Start prod with `NODE_ENV=production` everywhere (systemd/PM2/Docker/`start` script). | `/data.db` → 404 on the live host. |
| 0.3 | **Rotate:** SMTP2GO password (and revoke old); Firebase service-account key (delete key in GCP, issue new, store outside repo); `JWT_SECRET` (`openssl rand -base64 64`; invalidates all sessions — intended); Google OAuth client secret; ask users to rotate their BYOK AI keys if the DB may have leaked. | Old creds rejected by providers. |
| 0.4 | Remove secret fallbacks (`email.ts:10-11`, `server.ts:55`); throw at boot if unset/default. Scrub `.env.example` to placeholders. | App refuses to start without real secrets. |
| 0.5 | Delete `server.ts.bak`, `check.js`, `check-db.js`, `database.sqlite`; extend `.gitignore` (`*firebase-adminsdk*.json`, `*.bak`, `*.db`, `*.sqlite`, `uploads/`, `updates/*.zip`). `chmod 600 .env data.db`. | `git status` clean of secrets after `git init`. |
| 0.6 | `rm -rf node_modules && npm ci && npm audit fix` (non-breaking). Re-run `npm audit`. | Critical = 0 (except those needing majors), highs drop sharply. |

### Phase 1 — Access control & authentication  ·  ~2–3 days
1. `requireJobAccess` / `requireJobOwner` middleware; apply to **every** `/api/jobs/:jobId/*` and `/api/jobs/:id/*` route (H-2). Validate tag IDs belong to caller.
2. Socket.IO: JWT in handshake, membership check on `join_job`, origin allow-list, evict on member removal (H-1).
3. Sessions: `expiresIn` 1h + refresh rotation (or `token_version`), `algorithms:['HS256']`, bump on password change/reset, `POST /auth/logout` (H-8).
4. Rate limiting: login (per IP+username), register, forgot-password, license endpoints, OCR, all mail-sending routes; bcrypt → async + cost 12 or argon2id (H-7).
5. Reset flow: link from `APP_URL` only, hash tokens, 30-min single-use (H-5).
6. Email verification on register + email change; remove `ADMIN_EMAIL`-based admin; password policy (min 12, max 128) (H-7, M-2).
7. Google OAuth: server-side nonce `state` + PKCE (H-9).
8. Replace "join by job ID" with creator-issued expiring invite tokens (L-2).
9. Scope API keys (read-only / per-job) with expiry; stop accepting them on key-management & admin routes (L-1).

### Phase 2 — Input, output & file safety  ·  ~2–3 days
1. `zod` validation on every route; whitelist enums; finite-number checks; `ON CONFLICT … WHERE user_id`; add `user_id` to `expense_tax_mappings` (M-1, M-8).
2. Prototype-pollution fix + regression test; run Node with `--disable-proto=delete` (M-1).
3. Uploads: multer limits, MIME + magic-byte allow-list, random filenames, store under `DATA_DIR/uploads` (not web root), authenticated download route with `nosniff` + `Content-Disposition`; migrate existing 32 files; OCR temp files via `os.tmpdir()` + `finally` (H-3, M-5).
4. SSRF guard for `ai_base_url` (H-6).
5. Replace `MarkdownRenderer` with `react-markdown` (no raw HTML) (H-4). Validate `wishlist.url` / `company_logo_url` as `http(s)` server-side.
6. Escape all email interpolations, `requireTLS`, plain-text alternative (M-9).
7. Central error handler; remove `details: err.message` (M-7).

### Phase 3 — Platform hardening  ·  ~3–4 days
1. `helmet` with strict CSP (`default-src 'self'; img-src 'self' blob: data:; frame-ancestors 'none'`), HSTS, `Referrer-Policy: no-referrer`, `trust proxy`, HTTPS redirect, CORS allow-list (M-4).
2. Web auth → httpOnly `Secure; SameSite=Strict` cookie + CSRF token; Capacitor → secure storage. Keep master key **in memory** (non-extractable `CryptoKey`), not `sessionStorage` (H-3/H-8 blast-radius).
3. Encrypt `ai_api_key`, `google_refresh_token` at rest; mask in `GET /settings/ai`; `schema_migrations` table; WAL + encrypted backups (M-6, L-9).
4. Service worker: per-user or no API caching; clear caches + IndexedDB queue on logout (M-10).
5. Android: `allowBackup=false`, R8, restrict Firebase key, remove token logging (M-12).
6. OTA: pass `checksum`, enable bundle signing/encryption, HTTPS-only, anti-rollback (H-10).
7. Self-host Tesseract assets (M-13). Remove `GEMINI_API_KEY` `define` (L-7).
8. Audit log table (logins, key changes, admin actions) + structured redacted logging.

### Phase 4 — Cryptographic redesign (needs a migration)  ·  ~1–2 weeks
1. Split **auth secret** from **encryption secret** (derive separately with distinct salt/info; send only the auth credential — or adopt OPAQUE) so the server never holds a password-equivalent (C-3).
2. Argon2id (WASM) or PBKDF2 ≥ 600k, random per-user salt stored server-side, `kdf_version/params` columns; lazy-migrate at next login.
3. Key-check value + server-verifiable proof of mnemonic knowledge before accepting a new `master_key_encrypted` (H-5).
4. Per-user keypairs (ECDH) to wrap job keys for members instead of `jobId#rawKey` invites; **rotate job key + re-encrypt receipts when a member is removed** (M-3).
5. AES-GCM AAD = `jobId|expenseId`; non-extractable keys; delete legacy `localStorage job_key_*` migration code.
6. Until done: correct the zero-knowledge wording in `DOCUMENTATION.md`, `ApiDocs.tsx`, `Legal.tsx`.

### Phase 5 — Dependencies & supply chain  ·  ~½ day + ongoing
Manual bumps: `nodemailer@10.x`, `jspdf` (→ patched `dompurify`), `googleapis`, `@capacitor/*@8.6`. Add `overrides` for `serialize-javascript`. Remove `vite-plugin-node-polyfills`. Move build tools to `devDependencies`; drop unreferenced packages. Add Dependabot/Renovate and CI step `npm audit --omit=dev --audit-level=high`; `npm ci --ignore-scripts` in CI; pin crypto libs exactly.

### Phase 6 — Verification & process  ·  parallel
- Table-driven **authz test**: every job-scoped route × {creator, member, outsider, anon} (would have caught H-1/H-2).
- Regression tests: socket anon-join rejected, upload `.html` rejected, SSRF to `127.0.0.1`/`169.254.169.254` blocked, `__proto__` line rejected, reset link ignores `Origin`, W-2 cross-user overwrite blocked.
- `tsc --strict` (code is `any`-heavy), `eslint-plugin-security`, Semgrep in CI.
- OWASP ZAP baseline against staging after Phase 3; consider an external pen-test before charging customers (Stripe wiring will raise the stakes).
- Update `API.md`/`DOCUMENTATION.md` to match reality (API-key scope, `tax_settings` PK, E2EE claims, paths); add `SECURITY.md` / `security.txt`.

---

## 5. Suggested execution order
`Phase 0` → `Phase 1 (items 1–5)` → `Phase 2 (items 1–5)` → `Phase 5` → `Phase 3` → `Phase 4` → `Phase 6` throughout. Phases 0–2 close every Critical and High finding except C-3 and H-10 (Phases 3–4).
