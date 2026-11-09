# GlassExpense

Offline-first PWA and Android app for contractors and small businesses: job-based expense tracking, receipt capture with OCR, invoices and estimates (native editor, PDF, e-mail, payment links), and an IRS-oriented tax center.

**End-to-end encrypted.** Jobs, expenses, notes, tax data and receipts are encrypted in your browser before they reach the server, with keys derived from your password and a 12-word recovery phrase. Neither the operator nor a database leak can read them; only you and people you invite can. Your password never leaves your device. See [how it works and its limits](docs/DOCUMENTATION.md#5-end-to-end-encryption-e2ee--security-flow).

| | |
| :--- | :--- |
| Frontend | React 19, Vite, Tailwind v4, Capacitor (Android), Workbox PWA |
| Backend | Express, Socket.IO, SQLite (`better-sqlite3`) |
| Docs | [Architecture](docs/DOCUMENTATION.md) · [API & calendar integration](docs/API.md) · [Tax engine](docs/TAX_SYSTEM.md) · [Invoicing 2.0 plan](docs/INVOICING_PLAN.md) · [Security review](docs/SECURITY_AUDIT.md) · [Pre-production checklist](docs/TODO.md) |

## Quick start

```bash
npm ci
cp .env.example .env          # set JWT_SECRET (openssl rand -base64 64) and APP_URL at minimum
npm run dev                   # http://127.0.0.1:3000 — Vite dev server, development only
```

Production:

```bash
npm run serve                 # builds the frontend, then starts the server (NODE_ENV=production)
# or: npm run build && npm start
```

The server **refuses to start in production** if `JWT_SECRET` is missing, shorter than 32 characters, or a known placeholder. Anything other than `NODE_ENV=development` runs in production mode, so the Vite dev server (which can expose project files) is never started by accident.

## Docker

A prebuilt image is published as **`futurelabz/glass-expense`** (tags: `2.0.0`, `latest`), or build it yourself from this repo. The image contains the built web app and the server; **secrets and data are never baked in**: you pass them at run time.

```bash
cp .env.example .env              # set JWT_SECRET (openssl rand -base64 64) and APP_URL at minimum
mkdir -p secrets                  # optional: secrets/firebase-adminsdk.json for push notifications

# Option A: docker compose (builds locally; to use the published image instead, replace `build: .` with `image: futurelabz/glass-expense:2.0.0`)
docker compose up -d --build

# Option B: plain docker with the published image
docker run -d --name glassexpense --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  --env-file .env \
  -v glassexpense-data:/data \
  -v "$PWD/secrets:/app/secrets:ro" \
  futurelabz/glass-expense:2.0.0
```

- **Data** lives in the `/data` volume (database, receipts, OTA bundles). Back the volume up as a whole; never expose it.
- **Required:** `JWT_SECRET` (≥ 32 chars) and `APP_URL` (your public https origin). The container exits at boot otherwise. Optional features (`SERVER_WRAP_KEY` for agent access / report figures / background Google sync, SMTP, Google OAuth) are set in the same `.env`.
- Put a TLS reverse proxy in front; allow request bodies ≥ 16 MB and WebSockets, and keep `TRUST_PROXY` equal to the number of proxy hops. Run **one** container (the hourly schedulers are in-process).
- Health: `GET /api/info` (the image has a built-in `HEALTHCHECK`). Logs: `docker logs -f glassexpense`.
- Promote an admin: `docker exec -it glassexpense node_modules/.bin/tsx scripts/promote-admin.ts you@example.com`.
- Upgrade: `docker compose pull && docker compose up -d` (or re-run with the new tag). The database migrates itself on start; take a backup of the volume first.
- Build and publish your own: `docker build -t futurelabz/glass-expense:2.0.0 -t futurelabz/glass-expense:latest .` then `docker push futurelabz/glass-expense:2.0.0 && docker push futurelabz/glass-expense:latest`.

## Scripts

| Script | What it does |
| :--- | :--- |
| `npm run dev` / `dev:saas` | Development server (`NODE_ENV=development`, binds to 127.0.0.1) |
| `npm start` | Production server |
| `npm run serve` | Build, then start in production |
| `npm run build` | Frontend production build (also self-hosts the Tesseract OCR assets) |
| `npm run build:ota` | Package `dist/` as a mobile OTA bundle into `data/updates/` |
| `npm run admin:promote -- <email>` | Grant admin rights to an existing account |
| `npm test` | End-to-end encryption test suites against a throwaway server (temp DB, no real credentials) |
| `npm run lint` | Type-check (`tsc --noEmit`) |
| `npm run audit:prod` | `npm audit` for production dependencies (fails on high+) |

## Project layout

```
server/      Express app, config, security helpers, SQLite schema, email, Google Calendar, SaaS limits
src/         React app (pages, components, context, utils) and src/e2ee/ — the browser-side encryption layer
tests/       Test suites run by `npm test`
scripts/     OTA bundler, OCR asset copier, admin promotion
docs/        All documentation, plus tested calendar-API client examples in docs/examples/
android/     Capacitor Android project
data/        RUNTIME DATA (gitignored): data.db, uploads/, updates/   (override with DATA_DIR)
secrets/     gitignored: firebase-adminsdk.json                        (or FIREBASE_SERVICE_ACCOUNT_PATH)
```

## Configuration

All settings are documented in [`.env.example`](.env.example) and [docs/DOCUMENTATION.md §11](docs/DOCUMENTATION.md). Email, Google Calendar and push notifications are optional; when unconfigured the related features are skipped.

## Deployment notes

- Run behind a TLS-terminating reverse proxy and set `TRUST_PROXY` to the number of proxy hops (default `1`) so rate limiting sees real client IPs.
- Back up `data/` (database **and** uploads) together. Never serve it directly; the app does not.
- After changing the CSP-relevant assets, roll out with `CSP_MODE=report-only` first.
- Upgrading from the old flat layout: see "Upgrading an existing deployment" in [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md).

## Invoices, estimates and your website

The **Invoices** tab builds estimates and invoices from a job: customer, vehicle, number and the website's rates arrive pre-filled, you add labor and parts (or one-click **Service Packages**), review, and confirm the estimate into a final invoice. Send it by e-mail with PayPal / Venmo / Cash App / Zelle options, or print / download the PDF. Everything is encrypted in your browser; e-mail and AI are opt-in features that you switch on in Settings. A website can post jobs with structured fields, its rates and an `external_ref` through the agent API ([API.md §3A](docs/API.md#3a-agent-api-for-automations-and-ai-agents-opt-in-keys)); with research enabled on that key, GlassExpense researches the job itself. Local AI models need their address in `AI_ALLOWED_HOSTS`.

## For integrations

An API key can read your **calendar only** (job dates and titles) — everything else is encrypted and rejected. The key has a public half (sent in `x-api-key`) and a private half (stays in your app and decrypts titles). Ready-to-run Node.js, browser and Python clients and a test vector are in [docs/API.md §3](docs/API.md#3-calendar-api-for-integrations-api-keys).

## Admin

Admin rights come only from the `is_admin` flag: the first account is admin; add more with `npm run admin:promote -- <email>`. Admins manage plans, e-mails, users, SaaS limits and license keys, but **cannot read user data or set passwords** ([details](docs/API.md#8-administration-the-admin-system)).

## Upgrading existing accounts

Accounts created before end-to-end encryption are upgraded automatically the next time their owner signs in: the browser encrypts everything locally (progress screen, resumable), and the server then deletes the old plaintext and vacuums the database. Members of shared jobs are re-approved by the job owner. **Back up `data/` before the first sign-in after deploying**; old backups still contain plaintext.

## Security

Report vulnerabilities privately to the maintainer. The latest review, remediation status and remaining work are in [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).
