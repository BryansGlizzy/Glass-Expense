# TODO — Verify everything before migrating production

Written for the operator/owner of this instance. The end-to-end-encryption release changes how almost every screen gets its data, and **the automated tests cannot click through a real browser, a phone, a mail client or your real data**. This is the list of what only a human can confirm.

**Legend:** ☐ to do · 🔴 must pass before going live · 🟡 should pass · 🔵 nice to confirm

Time needed: about 2–3 hours for a full pass on a staging copy.

---

## 0. What you are about to ship (so you know what to look for)

- Server stores **ciphertext only**; the browser encrypts/decrypts. Passwords never reach the server.
- **Every existing user's data is encrypted the next time they sign in** (progress screen, resumable). Until then their jobs show as locked to other people.
- Shared jobs: **join by one-time invite code, then the owner approves** (with a security-code check). The old "paste job ID / `jobId#key`" flow is gone.
- Reports, tax calculation, search, totals and invoice numbers now run **in the browser**.
- API keys are **calendar-only**; they have a private half that must stay in your other web app.
- Server **no longer creates recurring expenses**; the app does it when opened.
- Optional, off by default: background Google sync, reports with figures, cloud OCR.
- Admins can no longer set user passwords.

---

## 1. Before you touch production

### 🔴 Secrets and configuration
- ☐ Rotate everything flagged in `SECURITY_AUDIT.md` (C-1): SMTP2GO password, Firebase service-account key, `JWT_SECRET`, Google OAuth client secret. Confirm the old values are revoked at each provider.
- ☐ Production `.env` has a real `JWT_SECRET` (`openssl rand -base64 64`). The server **refuses to start** with a missing/short/placeholder secret — confirm the process manager shows it running.
- ☐ `APP_URL` is the exact public https origin (used for email links, CORS, OAuth redirect).
- ☐ `TRUST_PROXY` matches your proxy hops (usually `1`). Wrong value ⇒ everyone shares one rate-limit bucket or limits are bypassable.
- ☐ `NODE_ENV` is **not** `development` in production (start with `npm start` / `npm run serve`).
- ☐ Decide on the opt-in features and set `SERVER_WRAP_KEY` (`openssl rand -base64 32`) **only if** you want background Google sync and/or reports with figures. Back this key up with your secrets; losing it just disables those opt-ins (users re-enable).
- ☐ `ADMIN_EMAIL` is set to the account that must stay admin (it is promoted once at boot and the address is reserved afterwards).
- ☐ `DATA_DIR` points at the existing database/uploads (or you moved them to `./data` per `DOCUMENTATION.md §11`).
- ☐ Firebase JSON is in `secrets/firebase-adminsdk.json` (or `FIREBASE_SERVICE_ACCOUNT_PATH`) with mode 600.

### 🔴 Reverse proxy / hosting
- ☐ Proxy allows **request bodies ≥ 16 MB** (receipts are up to 15 MB; nginx default is 1 MB → uploads fail silently). e.g. `client_max_body_size 20m;`
- ☐ Proxy forwards **WebSockets** (Socket.IO): `Upgrade`/`Connection` headers.
- ☐ HTTPS everywhere; HSTS is sent by the app.
- ☐ Nothing serves the project root, `data/`, `secrets/`, `.env` (the app doesn't; check the proxy too). `curl -sI https://YOUR_HOST/data/data.db` and `/secrets/firebase-adminsdk.json` must return the SPA page / 404, never a file.

### 🔴 Backups (the migration is one-way)
- ☐ Stop traffic or accept a short read-only window. Take a **cold copy of `data/`** (database **and** uploads **and** `-wal`/`-shm` files) and of the code currently running.
- ☐ Verify the backup restores: copy it elsewhere and open it with `sqlite3 data.db "select count(*) from users;"` (expect 5 users, 111 jobs, 238 expenses at last check).
- ☐ Store it somewhere safe and **encrypted** — it contains all current plaintext. Decide a date to destroy it (see §7).

### 🔴 Run the automated suite on the exact build you will deploy
- ☐ `npm ci && npm run lint && npm test` → "ALL SUITES PASSED" (6 suites, 58 checks).
- ☐ `npm run build` succeeds; `npm audit --omit=dev --audit-level=high` exits 0.

---

## 2. Staging dry-run with a copy of production data

Do this **before** production. Use a copy of the real database so you see real shapes (111 jobs, mostly without stored keys, 26 plaintext receipts).

- ☐ Copy the backup to a staging `DATA_DIR`; start the new build against it with SMTP **blank** (so no real mail goes out) and a throwaway `JWT_SECRET`.
- ☐ Server boots, no errors in the log; `/api/info` returns `version 2.0.0, e2ee: 2`.
- ☐ `sqlite3 data.db "select username, kdf_version, e2ee_version from users;"` shows every user at `1, 1` (not yet migrated).
- ☐ Sign in as **your own account** (the one with the most data) and complete the migration (§3.2). Watch the log for 4xx/5xx.
- ☐ Afterwards run the checks in §3.2 "after migration" including the plaintext search.
- ☐ Note how long it took (the 120-job test took ~1 s locally; real receipts add network time).

---

## 3. Browser smoke test (staging first, then production)

Use a desktop browser **and** your phone's browser. Use a private window for a "second device".

### 3.1 Accounts & sessions
- 🔴 ☐ **Register** a brand-new test user: password < 12 chars is rejected with a clear message; the 12-word phrase screen appears; you can't continue until you confirm; you land on the dashboard.
- 🔴 ☐ **Sign out → sign in** again with the new password. Wrong password shows an error (and after 8 tries a lock message).
- 🔴 ☐ **New tab / reload**: reloading keeps you signed in; opening the app in a *new tab or after closing the browser* shows the **"Unlock your vault"** screen asking for the password (not a blank/broken dashboard). Wrong password ⇒ "Incorrect password"; right password ⇒ data appears.
- ☐ **Sign out** clears everything: sign in as a *different* user in the same browser and confirm you never see the previous user's jobs (even briefly).
- 🔴 ☐ **Change password** (Settings → Account): old password stops working, new one works, you stay signed in on this device, a second signed-in device is signed out.
- 🔴 ☐ **Forgot password**: email arrives with a link to **your** domain; the reset page asks for the new password **and the 12 words**; a wrong phrase is rejected ("does not match"); the right phrase lets you sign in with the new password and **all your old data is still readable**.
- ☐ Settings → Account shows your **security code** (a group like `ABCD-1234-…`).
- ☐ Registering with the admin email / an existing username in a different case is rejected.

### 3.2 Migrating an existing account  🔴 (the riskiest step)
Test with **your own real account on staging**.
- ☐ Sign in with the old password. You see the **"Securing your data"** progress screen (not a blank page or error). Keep the tab open until it finishes.
- ☐ If the account never had a recovery phrase you are shown 12 new words — **write them down**.
- ☐ You arrive on the dashboard. **Every job is there** with the right title, dates, client, invoice number, archived state and totals. Count them (should match the 111 from before).
- ☐ Open several jobs, including old ones with receipts: expense lists, amounts, dates, tags and descriptions match what you remember.
- ☐ **Receipts:** open a previously **plaintext** receipt and a previously **encrypted** one — both display. (26 plaintext receipts existed.)
- ☐ Tags (Settings → Tags) all present; **Tax Center** settings, W-2s and manual Schedule C assignments are intact; invoice template and AI settings are intact.
- ☐ Sign out and sign in again: **no** progress screen this time (straight in).
- ☐ **Interrupted migration:** start a migration, close the tab halfway, sign in again — it resumes and completes without duplicates.
- ☐ **Plaintext is gone** (run on staging after migrating the owner account; `NEEDLE` = a job title/client/description you know):
  ```
  sqlite3 data/data.db "PRAGMA wal_checkpoint(TRUNCATE);"
  grep -c "NEEDLE" data/data.db data/data.db-wal     # expect 0 for that user's data
  sqlite3 data/data.db "select count(*) from tags where user_id='<id>'; select e2ee_version from users where id='<id>';"   # 0 and 2
  ```
- ☐ Plaintext receipt files from that user are no longer readable: `strings data/uploads/<one of the old plaintext ones> | head` shows gibberish.
- 🟡 ☐ Users who **never** sign in stay at `e2ee_version 1` with their data still plaintext on the server — decide a deadline and how you'll contact them (§7).

### 3.3 Jobs
- 🔴 ☐ Create a job (title, dates, tag prefix, client fields); it appears with the correct invoice number (`PREFIX-A00001`, then `…A00002`).
- ☐ Edit it (title, client, rate, notes, dates); changes persist after reload.
- ☐ Archive / unarchive; delete (asks for confirmation; receipts disappear).
- ☐ Search box on the dashboard finds by title, client, invoice number.
- ☐ Calendar view shows jobs on the right days.
- ☐ Free-plan limits (SaaS mode): active/archived/joined caps show a sensible message.

### 3.4 Expenses, income & receipts
- 🔴 ☐ Add an **expense** with a camera/photo receipt: it appears immediately, the receipt thumbnail/preview opens, amount/date/description are right.
- 🔴 ☐ Add **income**; totals on the job card and dashboard update.
- ☐ Attach/replace a receipt on an existing entry; delete an entry.
- ☐ Tag an entry; remove the tag; filter by tag.
- ☐ Receipt **PDF** upload works and opens.
- ☐ Try a file near 15 MB (works) and over 15 MB (clear error, nothing half-saved).
- 🟡 ☐ **Import** a JSON export into a job; **Export** a job and open the file.
- 🟡 ☐ **OCR on-device:** scan a receipt with local OCR; the amount/description are filled in. *(OCR assets are now self-hosted under `/vendor/tesseract/` — confirm the first scan downloads from your own domain, not a CDN, and also works offline afterwards.)*
- 🔵 ☐ **OCR cloud** (only if you use it): add a provider key in Settings → AI, verify it, scan a receipt. A URL on a private network (e.g. `http://localhost:11434`) is refused unless `ALLOW_PRIVATE_AI_URLS=true`.

### 3.5 Wishlist & subscriptions
- ☐ Add a wishlist item (a `javascript:` URL is rejected); convert it to an expense (it moves, dated today).
- 🔴 ☐ Add a **recurring subscription** with a billing day in the past/near future. Then confirm the *app* creates the entry: set the next date to yesterday via a test job (or wait), reload the app, and check the "(Auto-generated)" expense appears **once** (open the app on two devices — no duplicate).
- ☐ Reminder flags: you get a **generic** reminder email ("a subscription is due in N days") — no amount/name in it.

### 3.6 Reports workspace & invoices
- 🔴 ☐ Reports (dashboard → Reports): pick a date range / jobs / tags — totals, category breakdown, job breakdown and charts match what you expect. Compare 2–3 numbers against a manual sum.
- ☐ Receipt gallery inside a report shows receipts; CSV export contains the right rows.
- 🔴 ☐ **Invoice PDF** for a job: company details, client, line items and totals are correct; it downloads/prints. *(Uses the template from Settings → Invoice; a logo URL must be `https://`.)*
- 🟡 ☐ Print layout of a report looks right.

### 3.7 Tax Center
- 🔴 ☐ Open Tax Center for the current year **and** last year: Overview, Schedule C, Schedule SE, 1040, 1040-ES numbers are sane and match what the old version showed for the same data (compare against a screenshot/PDF from before if you have one).
- ☐ Change an entry's Schedule C line manually; the totals move; "auto" reverts.
- ☐ Map a tag to a line; add/edit/delete a **W-2**; "Unclaimed deductions" suggestions list appears; apply a batch.
- ☐ Switch entity type / filing status; vehicle method; home office — numbers update.
- ☐ W-2 OCR (local, and cloud if used).
- ☐ CPA export / print.

### 3.8 Sharing a job (needs two accounts)  🔴
- ☐ Owner: job → **Copy invite**. Joiner (other account/browser): Dashboard → **Join** → paste the code. Joiner sees "invite accepted, waiting for approval" and **no data**.
- ☐ Owner: job → **Members** shows the joiner as *waiting*, with their security code. The joiner reads their code (Settings → Account); they match. Tick the box → **Approve**.
- ☐ Joiner now sees the job, entries and receipts; can add entries; cannot edit the job or delete others' entries.
- ☐ Live updates: owner adds an entry while the joiner has the job open — it appears without refresh (both directions).
- ☐ An invite code can't be reused; an expired code (7 days) is rejected.
- ☐ A third account that never joined can't see the job (open the job URL directly → not found).
- ☐ Owner **removes** the member: their access ends immediately (refresh shows nothing; direct URL fails).
- ☐ Member **leaves** a job.
- 🟡 ☐ After migration, a *legacy* member of a migrated job is listed as needing approval — approve them and confirm they regain access.
- 🟡 ☐ A job whose owner hasn't signed in yet shows to members as "🔒 Awaiting owner upgrade" (expected, not an error).

### 3.9 Calendar API, Google Calendar and your other web app  🔴
- 🔴 ☐ Settings → API: generate a key. The two-part explanation is shown; copy the whole key somewhere safe.
- 🔴 ☐ Update **your other web app**: send only the part **before the dot** in `x-api-key`, and decrypt titles with the part after it. Use `docs/examples/decrypt-calendar.mjs` (Node) or `…browser.js` / `…py`. Confirm it lists your booked days **and titles**. *(Don't put the private half in public client-side code.)*
- ☐ Old API keys (created before the upgrade) return `wrapped_calendar_key: null` — create new keys and revoke the old ones.
- ☐ Sending the whole key (with the dot) is refused with a clear error; using the key on any other endpoint returns 403.
- ☐ Rename a job in the app → your other web app shows the new title on its next poll.
- 🟡 ☐ Jobs you were invited into appear with dates; titles appear after you open them once.
- 🟡 ☐ **Google Calendar** (if you use it): reconnect via Settings → Integrations; background sync is **off** until you tick *Allow background sync* (needs `SERVER_WRAP_KEY`). After enabling, jobs with dates appear in Google with `[GlassExpense] <title>`; renaming/rescheduling updates the event; turning it off stops updates. Per-expense events no longer exist (expected).

### 3.9a Agent access for API keys (opt-in)  🔴 if you use automations / AI agents
- ☐ Settings → API Keys: the *Agent access* checkbox is **greyed out with a warning** when `SERVER_WRAP_KEY` is not set, and available when it is.
- ☐ Tick it: the **privacy notice** appears and you cannot generate the key until you pick jobs (or *All jobs*) **and** tick the confirmation box. Without ticking it, a normal calendar-only key is created exactly as before.
- ☐ Create a **read-only** key limited to one job. `curl -H "x-api-key: <part before the dot>" https://HOST/api/agent/v1/jobs` lists only that job with correct totals; another job's id returns 404; a POST returns 403.
- ☐ Create a **read + write, all jobs** key. POST an entry (`/jobs/<id>/expenses`) → it appears in the app (live, no refresh) with the right amount/date/description. Retry with the same `id` → no duplicate.
- ☐ POST a **job** (`/jobs`) → open the app: it appears with the title, client and dates, you can open it and add entries, and the calendar endpoint shows its dates. Check Settings → Integrations/Google if you use sync.
- ☐ Create a job in the app, reopen/refresh the app, then list jobs with the all-jobs key: the new job is visible. A *selected-jobs* key never sees it.
- ☐ The key list shows an **"Agent access: …"** badge; *Remove agent access* makes `/api/agent/v1/*` return 403 but the key still works for the calendar. Revoking the key returns 401.
- ☐ `sqlite3 data/data.db "select name, agent_scope, length(agent_bundle) from api_keys;"` shows only sealed blobs; `grep -c "<a job title you created via the agent>" data/data.db data/data.db-wal` is 0.
- ☐ Decide whether the privacy trade-off (server can read selected jobs while the key exists) is acceptable for **your** users before enabling `SERVER_WRAP_KEY` in production, and mention it in release notes (§8).

### 3.10 Report emails  🔴
- ☐ Settings → Reports: pick *Weekly*, **Send Test Email** → an email arrives. Without opting in it should only say "N new entries" (no amounts/names).
- 🔴 ☐ Turn on **figures** (needs `SERVER_WRAP_KEY`): *Send Test Email* now shows net, income, expenses, ▲/▼ vs previous period, **winners / loss leaders**, categories. Spot-check the numbers against the Reports workspace for the same 7 days.
- ☐ Toggle *Include job names* off → email shows "Job 1, Job 2…" after the next refresh.
- ☐ Add an entry, wait ~5 s, send another test → it's included. Don't open the app for a few days (or fake it) → email says "figures reflect your last sync".
- ☐ Turn figures off → next email is count-only; `select count(*) from report_snapshots;` shows the row is gone.
- ☐ Check how the email **looks** in Gmail/Apple Mail/Outlook and on a phone (dark theme styling is inline; the test only verified the content).
- ☐ A real scheduled run: set Weekly/`next_run_at` to the past in staging and let the hourly sweep fire.

### 3.11 Admin
- 🔴 ☐ Sign in as the admin account: Admin Portal opens; stats, users, licenses, SaaS limits load. (If it does not, run `npm run admin:promote -- you@example.com` on the server.)
- ☐ Change a user's email and plan; delete a test user (their receipts disappear from `data/uploads`).
- ☐ The **"force password reset"** key button is gone (expected). A locked-out user should use *Forgot password* with their phrase.
- ☐ Generate a license key; activate it from a normal account (works once; second try is refused); Pricing page unlock flow.
- ☐ A non-admin visiting `/admin` gets nothing sensitive (the API returns 403).

### 3.12 PWA, offline & mobile
- 🔴 ☐ **Service worker update:** with the *old* version installed in a browser, load the new one; confirm it updates and nothing breaks. Hard-reload if needed.
- 🟡 ☐ Old browsers may still hold **cached plaintext API responses** from the previous version (`api-jobs-cache` etc., ≤ 24 h). They are wiped on sign-out; ask existing users to sign out/in once, or clear site data on your own devices.
- 🔴 ☐ **Offline:** open a job, go offline (airplane mode), add an expense → it queues and shows as pending; reconnect → it syncs and appears once. Reading already-visited jobs offline works (cached **ciphertext**, decrypted in memory). *A cold start while offline will sign you out — that was already true before.*
- ☐ Install the PWA (Add to Home Screen) and repeat the basics.
- 🔴 ☐ **Android app (Capacitor):** build and install; sign in; create an entry with the camera; receipt displays; push notification token registers. Check the app talks to `https://expenses.futurelabz.dev` for `/api` (the fetch patch in `main.tsx`).
- 🟡 ☐ **Real-time sockets on the native app** — `io(window.location.origin)` points at the app's own origin on Capacitor. This predates the encryption work, but confirm whether live updates work on the phone; fix by pointing it at your server URL if not.
- 🔴 ☐ **OTA update:** `npm run build:ota`, publish to `data/updates/`, and confirm a device accepts it. The client now passes the SHA-256 checksum, so a mismatch makes the update **fail closed** — test this on a real device before relying on it.

### 3.13 Security spot-checks (5 minutes with curl / DevTools)
- 🔴 ☐ `curl -sI https://HOST/` shows `Content-Security-Policy`, `Strict-Transport-Security`, `Referrer-Policy: no-referrer`, no `X-Powered-By`.
- 🔴 ☐ **CSP:** with DevTools open, click through every screen above — the Console must show **no "Refused to …" CSP errors** (watch OCR/WebAssembly, fonts, PDF/invoice, charts, images from invoice logos). If anything breaks, set `CSP_MODE=report-only` temporarily and fix the policy in `server/index.ts`.
- ☐ DevTools → Network: on any screen, request/response bodies for `/api/v2/*` contain only `v2.…` strings, never readable names or amounts. The login request body has `auth_key`, **not** `password`.
- ☐ `curl https://HOST/uploads/<any old filename>` → 404.
- ☐ `curl -H "x-api-key: <public half>" https://HOST/api/v2/jobs` → 403.
- ☐ Unauthenticated `GET /api/v2/jobs` → 401.

---

## 4. Deploy day runbook

1. ☐ Announce a maintenance window; ask users to **sign in once on their usual device** soon after (that's what encrypts their data).
2. ☐ Back up `data/` + current code (§1). Verify the copy.
3. ☐ Deploy the new build; set env (§1); start with `npm start` behind the proxy.
4. ☐ Check the log: "Server running… (production)", no stack traces; `/api/info` shows `version 2.0.0`.
5. ☐ **You first:** sign in as the admin/owner account and let the migration finish (§3.2). Run the "plaintext is gone" check for your account.
6. ☐ Quick pass through §3.3–3.8 on production with your own data.
7. ☐ Update the **other web app** to the new calendar client (§3.9) and generate a new API key; revoke old keys.
8. ☐ Re-enable Google sync / report figures if you want them (§3.9, §3.10).
9. ☐ Invite other users to sign in; track progress (§5).

---

## 5. After deploy — monitoring

- ☐ Migration progress: `sqlite3 data/data.db "select username, e2ee_version from users;"` (`2` = done).
- ☐ Watch the server log for repeated `Unsupported file type`, 413 (proxy limit), `429` (rate limit / wrong `TRUST_PROXY`), or `Could not decrypt` warnings in browsers' consoles reported by users.
- ☐ Disk: uploads should keep working; DB size will shrink slightly after `VACUUM`.
- ☐ Email provider dashboard: bounces/spam complaints after the new templates.
- ☐ Ask 1–2 real users to try sharing a job end to end.

---

## 6. Rollback plan

Once **any** user has migrated, the old code can no longer read their data. So:

- **Before anyone migrated:** stop the new build, restore the old code and the `data/` backup — nothing is lost.
- **After users migrated:** don't roll back the code. Fix forward, or restore the pre-migration backup **and tell migrated users their changes since then are lost**. This is why the backup in §1 must be verified.
- ☐ Keep the pre-deploy backup for at least the migration window; keep the old release artifact too.

---

## 7. Housekeeping once everyone has migrated

- ☐ `select count(*) from users where e2ee_version < 2;` is `0` (or the stragglers are contacted/removed).
- ☐ **Destroy the pre-migration backups and the cleanup tarball** (`…/backup/glassexpense-pre-cleanup.tgz` in the scratch folder) — they contain the old plaintext and old secrets.
- ☐ Check hosting snapshots/backups of the server disk for old copies of `data.db`.
- ☐ Remove any dev leftovers (`.env` copies, old `server.ts.bak`-style files elsewhere).

---

## 8. Things users will notice (put in release notes / tell them)

- First sign-in after the update shows a one-time "Securing your data" screen.
- **Write down the 12-word recovery phrase.** Forgot password now needs the e-mailed link **and** the phrase; with neither password nor phrase, data can't be recovered by anyone.
- Passwords must be ≥ 12 characters (applies when changing/creating).
- Joining a shared job: one-time invite code → wait for the owner to approve (compare security codes).
- Report emails show only counts unless they turn on "reports with figures" in Settings.
- API keys are calendar-only; existing keys must be recreated. Keys can optionally be given **agent access** (read/write jobs and entries through `/api/agent/v1`) after an explicit privacy confirmation; that lets the server read the chosen jobs while the key exists.
- Per-expense Google Calendar events were removed; Google job sync needs an explicit opt-in.
- Admins can't reset passwords for users.

---

## 9. Known limits & backlog (not blockers)

- **No automatic re-keying when a member is removed** (access is cut immediately, but they keep the old key and anything already downloaded).
- **Login is not PAKE/OPAQUE:** a malicious operator who serves altered JavaScript can capture a password; a server that logs the derived auth key could attempt offline guessing (600k PBKDF2 iterations slow it). Use long passwords.
- E-mail verification at sign-up; self-service account delete/export; session cookies instead of `localStorage`; per-key API expiry.
- Offline queue (IndexedDB) holds pending entries in plaintext on the device until synced (wiped at sign-out).
- Member removal, recurring-entry generation and report snapshots all depend on *some* client being open; nothing happens server-side while nobody uses the app (by design).
- Only run one server instance (the hourly schedulers are in-process).
- Add CI (`npm run lint && npm test && npm run audit:prod`) and consider a real-browser end-to-end test (Playwright) — it would automate most of §3.
- Remaining low/moderate `npm audit` items are build-time tooling (11 low, 3 moderate).

---

### What the automated tests already cover (so you can skip re-testing it by hand)

Key derivation and envelopes; v2 login/params; ciphertext-only storage and a database/WAL/uploads plaintext scan; access control (outsiders, pending invitees, removed members); invites and approval; receipts; API-key scope and the Node/browser/Python decrypt examples; password change/reset (including stolen-token protection); client-layer behaviour of jobs, expenses, tags, wishlist, subscriptions, tax, reports, import/export; migration of seeded legacy accounts (incl. 120 jobs, plaintext and encrypted receipts); report math and both e-mail variants. Run them any time with `npm test`.
