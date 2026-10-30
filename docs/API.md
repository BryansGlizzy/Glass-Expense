# GlassExpense API

> **Version 2 — end-to-end encrypted.** Since this release the server stores your jobs, expenses, notes, tags, tax data and receipts **only as ciphertext**. That changes what an API can do. Read [§1](#1-how-the-api-works-read-this-first) first.

## Contents

1. [How the API works (read this first)](#1-how-the-api-works-read-this-first)
2. [Endpoint index](#2-endpoint-index)
3. [**Calendar API for integrations (API keys)**](#3-calendar-api-for-integrations-api-keys) ← build your own app against this
   - [3A. **Agent API for automations & AI agents (opt-in)**](#3a-agent-api-for-automations-and-ai-agents-opt-in-keys)
4. [Accounts & authentication (for custom clients)](#4-accounts--authentication)
5. [Encryption reference](#5-encryption-reference)
6. [Encrypted data API (`/api/v2`)](#6-encrypted-data-api-apiv2)
7. [Account settings, API keys, Google Calendar, OCR](#7-account-settings-api-keys-google-calendar-ocr)
8. [Administration (the admin system)](#8-administration-the-admin-system)
9. [Real-time events (Socket.IO)](#9-real-time-events-socketio)
10. [System, rate limits & errors](#10-system-rate-limits--errors)
11. [What changed from the previous API](#11-what-changed-from-the-previous-api)

Base URL: `http://localhost:3000` in development; your `APP_URL` in production. All bodies are JSON unless noted; errors are always `{ "error": "message" }`.

---

## 1. How the API works (read this first)

There are two kinds of API clients.

| | **Integration** (your own app/script) | **Interactive client** (the GlassExpense web/mobile app) |
|---|---|---|
| Credential | **API key** (`x-api-key`) | **Session token** (`Authorization: Bearer <JWT>`) |
| Can read | Your **calendar only**: job dates + job titles | Everything the signed-in user can see, **after decrypting it locally** |
| Where decryption happens | In **your** app, with a secret that never reaches the server | In the user's browser, with keys derived from their password / recovery phrase |
| Documented in | [§3](#3-calendar-api-for-integrations-api-keys) | [§4–§9](#4-accounts--authentication) |

**What the server can and cannot see**

| The server stores… | …and can read it? |
|---|---|
| Job titles, descriptions, clients, notes, invoice numbers | **No** (ciphertext) |
| Expense amounts, descriptions, dates, tags, income/expense type | **No** (ciphertext) |
| Wishlists, recurring entries, tax settings, W-2s, invoice template, AI provider key | **No** (ciphertext) |
| Receipt files | **No** (ciphertext) |
| Username, email, plan, admin flag | Yes |
| Job **start/end dates**, archived flag, creation/update times, record counts | Yes (needed for the calendar API and plan limits) |
| Which accounts own / are members of which job | Yes |

> **Why API keys are limited to the calendar.** An API key is a long-lived credential that lives in scripts and servers. Giving it access to your whole vault would defeat the encryption. So an API key is bound to one small, deliberately shareable secret — the **calendar key** — which opens job *titles* and nothing else. Everything else is rejected with `403`.

**Exceptions you opt in to** (each is clearly labelled in the app):
- *Reports with figures* lets the server read a small **aggregate summary** (daily totals per job/category) so scheduled e-mails can show income, expenses, trend and winners vs. loss leaders (§7).
- *Background Google Calendar sync* lets the server read job titles + dates (Google sees them too).
- *Cloud OCR* sends a receipt image to the AI provider you configure, through the server, for that one request. On-device OCR never leaves the browser.

---

## 2. Endpoint index

Auth legend: **public** · **session** (JWT) · **admin** (JWT of an admin) · **key** (API key allowed).

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/calendar/schedule` | **key** or session | Job dates + encrypted titles (§3) |
| `GET /api/info` | public | Instance mode, version, plan limits |
| `GET /api/app-update/check` | public | Mobile OTA update manifest |
| `POST /api/auth/params` | public | Fetch KDF parameters for a login (§4) |
| `POST /api/auth/register` | public | Create an account (§4) |
| `POST /api/auth/login` | public | Sign in (§4) |
| `POST /api/auth/upgrade` | session | One-time upgrade of a pre-encryption account |
| `POST /api/auth/forgot-password` | public | E-mail a reset link |
| `POST /api/auth/reset-password` | public | Reset with e-mailed token **and** recovery phrase |
| `GET /api/auth/me` | session | Current user + encrypted key bundle |
| `PATCH /api/auth/me/email` | session | Set/change e-mail (restricted) |
| `PATCH /api/auth/me/password` | session | Change password |
| `GET/POST/DELETE /api/keys` | session | List / register / revoke API keys (§7) |
| `GET/POST /api/settings/reports`, `POST …/test`, `POST …/generate`, `POST /api/settings/subscriptions/test` | session | Report e-mail schedule and test sends |
| `POST/DELETE /api/settings/reports/delegation`, `PUT /api/settings/reports/snapshot` | session | Opt in/out of **reports with figures** (§7) |
| `POST /api/settings/device-token` | session | Register a push token |
| `POST /api/settings/ai/verify` | session | Test an AI provider key |
| `POST /api/ocr`, `POST /api/taxes/w2/ocr` | session | Optional cloud OCR |
| `GET /api/auth/google`, `GET /api/auth/google/callback` | session / public | Google OAuth |
| `GET/PATCH /api/settings/google`, `DELETE …/disconnect` | session | Google Calendar settings |
| `POST/DELETE /api/settings/google/delegation` | session | Opt in/out of background sync |
| `GET/POST /api/v2/jobs`, `PUT/DELETE /api/v2/jobs/:id`, … | session | Encrypted data API (§6) |
| `GET /api/admin/*`, `POST/DELETE /api/admin/license*` | **admin** | Administration (§8) |
| `POST /api/license/activate` | session | Activate a license key |
| `POST /api/license/remote-verify` | public | Community-instance license check |
| `GET /api/legacy/export`, `POST /api/v2/migration/complete` | session | One-time migration of old accounts |

---

## 3. Calendar API for integrations (API keys)

Use this to show your booked days (and job names) in another website, dashboard, or script — for example a portfolio site that lists the days you are booked.

### 3.1 What you get, and what you need to do

1. In the app: **Settings → API Access → Generate key**. Copy the key shown. **It is displayed once.**
2. Call `GET /api/calendar/schedule` with the **first half** of the key.
3. Decrypt the returned job titles **in your app** with the **second half** of the key. (~15 lines of code — complete examples below.)

### 3.2 Anatomy of an API key

```
ge_0w9Jk3…(32 chars)  .  Zf8x2Q…(43 chars)
└───── public half ─────┘   └── private decryption half ──┘
```

| Half | Where it goes | Why |
|---|---|---|
| **Before the dot** (`ge_…`) | `x-api-key` header | Identifies and authenticates you. The server stores only its SHA-256. |
| **After the dot** | **Stays in your app. Never send it anywhere.** | It is the secret that unlocks your job titles. The server never receives it, so it cannot read your titles either. |

> **If you accidentally send the whole key** (including the dot) the server rejects it with `400` and tells you to revoke it. Treat that key as exposed: revoke it in Settings and create a new one.

Keep the private half like a password: environment variable or secret store on the **server side of your integration**. Do not embed it in browser JavaScript that strangers can view — anyone who has the private half can decrypt your titles (but still cannot read expenses, clients, amounts or receipts).

### 3.3 Request

```bash
curl -s https://expenses.example.com/api/calendar/schedule \
  -H "x-api-key: ge_0w9Jk3…"        # public half only!
```

### 3.4 Response

```json
{
  "version": 2,
  "wrapped_calendar_key": "v2.AQEBAQEBAQEBAQEBBrzp…",
  "jobs": [
    { "id": "11111111-2222-4333-8444-555555555555", "start_date": "2026-11-03", "end_date": "2026-11-09", "title": "v2.AgICAgICAgICAgIC…" },
    { "id": "6f0c…", "start_date": "2026-11-12", "end_date": null, "title": null }
  ]
}
```

| Field | Meaning |
|---|---|
| `version` | Always `2`. |
| `wrapped_calendar_key` | The account's *calendar key*, encrypted so that only the private half of **this** API key can open it. `null` for keys created before this release — revoke and re-create them. |
| `jobs[].id` | Job UUID. |
| `jobs[].start_date`, `end_date` | `YYYY-MM-DD` or `null`. **Plain text** — the server needs them to answer. |
| `jobs[].title` | Encrypted job title (an *envelope*, §3.5), or `null` if no label exists for you on that job (see notes). |

Jobs returned: those you own plus those you were approved into. Sorted by `start_date`.

### 3.5 Decryption algorithm (language-neutral)

An **envelope** is the string `v2.` followed by the Base64 of `IV(12 bytes) ‖ ciphertext ‖ GCM tag(16 bytes)`. Encryption is **AES-256-GCM**. The plaintext of a title is a **JSON string** (`"Smith Kitchen"`, including the quotes).

```
1.  decrypt_part  = text after the "." in your API key         (Base64URL → 32 bytes)
2.  wrap_key      = HKDF-SHA256( ikm = decrypt_part,
                                 salt = 32 zero bytes,
                                 info = "glassexpense/apikey-calendar/v2",
                                 length = 32 bytes )
3.  calendar_key  = AES-256-GCM-Decrypt( key = wrap_key,
                                         envelope = response.wrapped_calendar_key,
                                         AAD = "apikey-calendar" )                    → 32 bytes
4.  for each job with a title:
      title = JSON.parse( AES-256-GCM-Decrypt( key = calendar_key,
                                               envelope = job.title,
                                               AAD = "calendar-title|" + job.id ) )
```

Rules that trip people up:
- The **AAD** (additional authenticated data) must match exactly (`apikey-calendar`, and `calendar-title|<job id>`). A wrong AAD fails authentication — this binds each title to its job so titles can't be swapped.
- Base64 in envelopes is **standard** Base64; the key halves are **Base64URL** (`-` `_`, no padding). Accept both when decoding.
- `HKDF` salt is **32 zero bytes**, not empty.
- Many libraries want `ciphertext ‖ tag` together after you split off the 12-byte IV (Python `cryptography`, WebCrypto); Node's `crypto` wants the tag separate (`setAuthTag`). The examples show both.

**Test vector** (check your implementation before using real data; the files are in [`docs/examples/`](examples/)):

```json
{
  "decrypt_part":         "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  "wrap_key_hex":         "0e3a64b1b5e093c59d1022dcea8c271bc3f5bd655d844016c3413dd3bdff33fc",
  "calendar_key_hex":     "fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0efeeedecebeae9e8e7e6e5e4e3e2e1e0",
  "job_id":               "11111111-2222-4333-8444-555555555555",
  "wrapped_calendar_key": "v2.AQEBAQEBAQEBAQEBBrzpki/TtjLPhLXI4gw4fOggOGiHBYKqHuT7ss33e5afip5Ua0shT08YkZZSgEoi",
  "title_envelope":       "v2.AgICAgICAgICAgICmOUbyMO9flzVtFMR1PkeclRi2SeaJo5M8tf3t6dIW9QgNsO2W5rPul+Stg==",
  "title":                "Smith Kitchen – Phase 1"
}
```
If step 2 gives `wrap_key_hex`, step 3 gives `calendar_key_hex`, and step 4 gives `title`, you are correct.

### 3.6 Complete examples (all tested against a live server)

#### Node.js ≥ 18 — no dependencies · [`docs/examples/decrypt-calendar.mjs`](examples/decrypt-calendar.mjs)

```js
import { createDecipheriv, hkdfSync } from 'node:crypto';

const BASE = process.env.GLASSEXPENSE_URL.replace(/\/$/, '');
const [headerKey, decryptPart] = process.env.GLASSEXPENSE_API_KEY.split('.');   // public half, private half

const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// envelope = "v2." + base64( IV[12] || ciphertext || tag[16] )
function openEnvelope(key, envelope, aad) {
  const data = b64(envelope.replace(/^v2\./, ''));
  const d = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([d.update(data.subarray(12, data.length - 16)), d.final()]);
}

const res = await fetch(`${BASE}/api/calendar/schedule`, { headers: { 'x-api-key': headerKey } });   // never send decryptPart
if (!res.ok) throw new Error(`Server answered ${res.status}: ${await res.text()}`);
const schedule = await res.json();

const wrapKey = Buffer.from(hkdfSync('sha256', b64(decryptPart), Buffer.alloc(32), 'glassexpense/apikey-calendar/v2', 32));
const calendarKey = openEnvelope(wrapKey, schedule.wrapped_calendar_key, 'apikey-calendar');

const jobs = schedule.jobs.map((j) => ({
  id: j.id, start_date: j.start_date, end_date: j.end_date,
  title: j.title ? JSON.parse(openEnvelope(calendarKey, j.title, `calendar-title|${j.id}`).toString('utf8')) : null,
}));
console.log(jobs);
```
Run: `GLASSEXPENSE_URL=https://expenses.example.com GLASSEXPENSE_API_KEY='ge_….…' node decrypt-calendar.mjs`

#### Browsers, Cloudflare Workers, Deno — Web Crypto only · [`docs/examples/decrypt-calendar.browser.js`](examples/decrypt-calendar.browser.js)

```js
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const enc = new TextEncoder();
const aesKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);

async function openEnvelope(key, envelope, aad) {
  const data = b64(envelope.replace(/^v2\./, ''));                          // IV[12] || ciphertext || tag[16]
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: enc.encode(aad) }, key, data.subarray(12)));  // WebCrypto wants ciphertext||tag
}

export async function fetchSchedule(baseUrl, fullApiKey) {
  const [headerKey, decryptPart] = fullApiKey.split('.');
  const res = await fetch(`${baseUrl}/api/calendar/schedule`, { headers: { 'x-api-key': headerKey } });
  if (!res.ok) throw new Error(`GlassExpense answered ${res.status}`);
  const schedule = await res.json();

  const hkdf = await crypto.subtle.importKey('raw', b64(decryptPart), 'HKDF', false, ['deriveBits']);
  const wrapRaw = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('glassexpense/apikey-calendar/v2') }, hkdf, 256));
  const calendarKey = await aesKey(await openEnvelope(await aesKey(wrapRaw), schedule.wrapped_calendar_key, 'apikey-calendar'));

  return Promise.all(schedule.jobs.map(async (j) => ({
    id: j.id, start_date: j.start_date, end_date: j.end_date,
    title: j.title ? JSON.parse(new TextDecoder().decode(await openEnvelope(calendarKey, j.title, `calendar-title|${j.id}`))) : null,
  })));
}
```
> Don't ship the private half to public web pages. Call this from a server, a Worker, or an internal tool.

#### Python 3.8+ (`pip install cryptography requests`) · [`docs/examples/decrypt_calendar.py`](examples/decrypt_calendar.py)

```python
import base64, json, os, requests
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BASE = os.environ["GLASSEXPENSE_URL"].rstrip("/")
header_key, decrypt_part = os.environ["GLASSEXPENSE_API_KEY"].split(".")

def b64(s):
    s = s.replace("-", "+").replace("_", "/")
    return base64.b64decode(s + "=" * (-len(s) % 4))

def open_envelope(key, envelope, aad):
    data = b64(envelope[3:] if envelope.startswith("v2.") else envelope)
    return AESGCM(key).decrypt(data[:12], data[12:], aad.encode())          # data[12:] is ciphertext||tag

schedule = requests.get(f"{BASE}/api/calendar/schedule", headers={"x-api-key": header_key}, timeout=30).json()
wrap_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=bytes(32), info=b"glassexpense/apikey-calendar/v2").derive(b64(decrypt_part))
calendar_key = open_envelope(wrap_key, schedule["wrapped_calendar_key"], "apikey-calendar")

jobs = [{"id": j["id"], "start_date": j["start_date"], "end_date": j["end_date"],
         "title": json.loads(open_envelope(calendar_key, j["title"], f"calendar-title|{j['id']}")) if j["title"] else None}
        for j in schedule["jobs"]]
print(json.dumps(jobs, indent=2))
```

#### Other languages
Any language with AES-256-GCM, HKDF-SHA256 and Base64 works. Follow §3.5 and validate against the test vector.

### 3.7 Errors

| Status | Meaning | Fix |
|---|---|---|
| `400` | Malformed key — usually the **whole key including the private half** was sent | Send only the part before the dot. If you sent the full key, revoke and re-create it. |
| `401` | Unknown/revoked key | Check the key; create a new one in Settings. |
| `403` | API key used on any endpoint other than `/api/calendar/schedule` | API keys are calendar-only. |
| `429` | Rate limited | Back off; cache results for a few minutes. |
| Decryption fails | Wrong private half, wrong AAD, or a key created before this release (`wrapped_calendar_key: null`) | Re-check §3.5; create a new key. |

### 3.8 Behaviour notes

- **Renamed jobs** update automatically: the app re-encrypts the title whenever you edit a job.
- **Jobs you were invited into** appear with their dates. Their `title` is `null` until you open the job in the app once (your app then stores *your own* encrypted label for it).
- **Revoking** a key (Settings → API Access) removes its access instantly. The private half becomes useless because the server deletes the wrapped copy.
- **Caching:** titles change rarely; poll every few minutes at most.
- **Dates are not secret.** If you do not want even dates visible to the server, do not use the calendar API or Google sync.
- **Google Calendar sync** is separate from API keys. It needs your opt-in (Settings → Google Calendar → *Allow background sync*), after which the server can read titles + dates to push events.

## 3A. Agent API for automations and AI agents (opt-in keys)

By default an API key is **calendar-only**. A key can additionally be created with **agent access**, which lets automations and AI agents work with decrypted data through a plain JSON API under `/api/agent/v1`. This is deliberately opt-in because it is the one place where the server can read your data.

### 3A.1 How it works and what you are trading away

When you create a key in **Settings → API Keys** and tick *Agent access*, you must read the privacy notice, choose **read-only or read + write**, choose **which jobs** (selected jobs, or all jobs) and confirm. Your browser then gives the server:

- the **job keys** of the chosen jobs, your **calendar key** (to label new jobs) and a per-key **inbox key** (to hand you the keys of jobs the agent creates);
- all sealed under the server secret `SERVER_WRAP_KEY` and stored with that API key only. Deleting the key, or choosing *Remove agent access*, erases them.

Consequences you accept:

| Risk | Impact |
|---|---|
| The API key leaks | Anyone holding it can read the covered jobs (and with write access add entries, create jobs or append text to job descriptions) until you revoke it. It is a bearer secret. |
| Database **and** `SERVER_WRAP_KEY` are both compromised | The covered jobs can be decrypted. Other jobs, your password, recovery phrase, tax data, W-2s and AI provider key are never shared. |
| An agent forwards what it reads | Data goes wherever the agent sends it (for example to an AI provider). |

Not available to agents: deleting anything, changing or removing existing values (the one edit allowed is *appending* to a job description, below), receipts, tags, tax data, sharing/invites, account settings. Keys without agent access, and ordinary sessions, get `403`.

Send **only the part before the dot** in `x-api-key`, exactly like the calendar endpoint. Limit: 120 requests/minute per key.

### 3A.2 Endpoints (all JSON, header `x-api-key: ge_...`)

| Method & path | Needs | Description |
|---|---|---|
| `GET /api/agent/v1/me` | any agent key | `{access, all_jobs, job_count, user}` |
| `GET /api/agent/v1/jobs?include_archived=true` | read | Jobs covered by the key, decrypted, with `total_income`, `total_expenses`, `net`, `entry_count` |
| `GET /api/agent/v1/jobs/:id` | read | One job |
| `POST /api/agent/v1/jobs` | write | Create a job. Body: `title` (required), `description`, `mode` (`expense`\|`budget`), `client_name`, `client_address`, `client_email`, `job_rate`, `invoice_notes`, `invoice_tag`, `start_date`, `end_date` (YYYY-MM-DD). Returns `201` with the job |
| `GET /api/agent/v1/jobs/:id/expenses?from=&to=&type=&limit=&offset=` | read | `{total, limit, offset, items:[{id, amount, description, entry_type, date, added_by, created_at, has_receipt}]}` (limit max 1000) |
| `POST /api/agent/v1/jobs/:id/description` | write | Append text to a job's description. Body `{append: "…"}` (required, non-empty, max 100 000 characters in total). The text is added after the existing description, separated by a blank line; nothing already there is changed or removed. Only for jobs owned by the key's account. Retrying the same text is safe: if it is already present the response is `200` with `duplicate: true`. Returns the job (`201`, or `200` for a duplicate) |
| `POST /api/agent/v1/jobs/:id/expenses` | write | Add one entry `{amount, description?, entry_type?: "expense"\|"income", date?, id?}` or `{items:[...]}` (max 100). `amount` must be positive; `date` defaults to today; `id` (UUID) makes retries idempotent (`200` + `duplicate: true`) |

```bash
KEY=ge_xxxxxxxx   # the part BEFORE the dot
curl -s -H "x-api-key: $KEY" https://HOST/api/agent/v1/jobs
curl -s -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
  -d '{"amount": 42.5, "description": "Lumber", "entry_type": "expense"}' \
  https://HOST/api/agent/v1/jobs/JOB_ID/expenses
```

### 3A.3 Behaviour notes

- **Selected-jobs keys** only ever see the jobs chosen at creation, plus jobs *that key itself* creates. **All-jobs keys** are topped up with jobs you create or join later, whenever you next open the app (so a job created in the browser may not be visible to the agent until then).
- **Jobs created by an agent** appear in your account normally. The first time you open the app it takes ownership of the job key (re-seals it under your master key), so it keeps working even if the API key is deleted.
- **Invoice numbers:** all-jobs keys allocate the next number (prefix inferred from your existing untagged jobs, or `INV`). Selected-jobs keys cannot see every job, so they leave it empty; it is assigned the first time you edit the job in the app.
- Entries written by an agent carry no tags or receipt; add them in the app.
- Errors are always `{ "error": "message" }`: `400` validation, `401` bad key, `403` no agent access / read-only, `404` job not covered, `429` rate limit, `503` server not configured (`SERVER_WRAP_KEY`) or the key's bundle can't be opened.

---

## 4. Accounts & authentication

This section is for people building a **custom interactive client**. Integrations should use §3.

### 4.1 Key derivation (the password never leaves the device)

```
root      = PBKDF2-HMAC-SHA256( password.normalize("NFKC"), salt = kdf_salt, iterations = kdf_iterations ) → 32 bytes
auth_key  = Base64URL( HKDF-SHA256(root, salt = 32 zero bytes, info = "glassexpense/auth/v2") )    → sent to the server (43 chars)
wrap_key  = HKDF-SHA256(root, salt = 32 zero bytes, info = "glassexpense/wrap/v2")                  → AES-256 key, stays on the device
```
- `kdf_salt`: 16 random bytes (Base64), chosen at registration. `kdf_iterations`: at least the server minimum (default **300 000**; the app uses **600 000**).
- `auth_key` and `wrap_key` are cryptographically independent: knowing the `auth_key` does **not** reveal the `wrap_key`.
- **Master key (MK)** = first 32 bytes of the BIP-39 seed of the user's **12-word recovery phrase** (no passphrase). `master_key_encrypted = Seal(wrap_key, MK, AAD="master-key")`.
- Each user also has an **ECDH P-256** key pair (public key stored in clear, private key sealed under MK, AAD `private-key`) and a random 32-byte **calendar key** (sealed under MK, AAD `calendar-key`).

### 4.2 Endpoints

#### `POST /api/auth/params` — public
Step 1 of login. Body `{ "identifier": "username-or-email" }`.
```json
{ "kdf_version": 2, "kdf_salt": "4W4guDk3wBLZDITLxDSPRw==", "kdf_iterations": 600000 }
```
Unknown identifiers receive a stable fake salt, so this does not reveal which accounts exist. `{ "kdf_version": 1 }` means a pre-encryption account that must use the legacy login once (§4.3).

#### `POST /api/auth/register` — public
```json
{
  "username": "alice", "email": "alice@example.com",
  "auth_key": "<43 chars>", "kdf_salt": "<b64>", "kdf_iterations": 600000,
  "master_key_encrypted": "<b64>", "public_key": "<b64 SPKI>", "private_key_encrypted": "<b64>",
  "calendar_key_encrypted": "<b64>", "key_check": "<b64 SHA-256>"
}
```
`key_check = Base64( SHA-256( HKDF-SHA256(MK, zero salt, "glassexpense/key-check/v2") ) )` — lets the server later verify that a password reset comes from someone who holds the recovery phrase, without learning it.
Username: 3–32 chars `[A-Za-z0-9._-]`. Usernames/e-mails are unique case-insensitively. The first account becomes admin. `ADMIN_EMAIL` is reserved once any account exists. **Password strength is enforced by the client** (the app requires ≥ 12 characters), because the server never sees the password.
Response `200`: `{ "token": "<JWT>", "user": { … } }` (user object below).

#### `POST /api/auth/login` — public
v2: `{ "identifier": "…", "auth_key": "<43 chars>" }` → `{ token, user, needs_upgrade: false }`.
Per-IP and per-account lockout apply (8 failures → 15 min). The returned `user` contains the encrypted key bundle:
```json
{ "id": "…", "username": "alice", "email": "…", "isAdmin": false, "plan": "free", "e2ee_version": 2, "kdf_version": 2,
  "kdf_salt": "…", "kdf_iterations": 600000, "master_key_encrypted": "…", "public_key": "…",
  "private_key_encrypted": "…", "calendar_key_encrypted": "…", "server_calendar_sync": false }
```
The client derives `wrap_key`, opens `master_key_encrypted`, then the rest. Tokens expire after `JWT_EXPIRES_IN` (default 14 days) and are revoked when the password changes.

#### `POST /api/auth/upgrade` — session
One-time upgrade of a legacy account (`kdf_version 1`): `{ current_password, auth_key, kdf_salt, kdf_iterations, …key bundle… }`. The old password is sent for this last time, then replaced. Returns a fresh token.

#### `POST /api/auth/forgot-password` — public · `POST /api/auth/reset-password` — public
Forgot: `{ "email" }` → always `{ success: true }`. The e-mailed link always points at `APP_URL`; the token is stored hashed, single-use, valid 1 hour.
Reset: `{ token, auth_key, kdf_salt, kdf_iterations, master_key_encrypted, key_check }` — **`key_check` must match the account's stored value**, i.e. the caller must know the recovery phrase. A stolen reset link alone cannot overwrite the vault (`403`). All sessions are revoked.

#### `GET /api/auth/me` — session → `{ user }` (shape above).
#### `PATCH /api/auth/me/email` — session
`{ "email" }`. Allowed only if the account has no e-mail yet, or the caller is an admin. The reserved admin address cannot be claimed by others.
#### `PATCH /api/auth/me/password` — session
`{ current_auth_key, auth_key, kdf_salt, kdf_iterations, master_key_encrypted }` → `{ success, token }`. Your data is **not** re-encrypted — only the wrapping of the master key changes. All other sessions are revoked; use the returned token.

### 4.3 Legacy login (accounts created before end-to-end encryption)
`POST /api/auth/login` with `{ "username", "password" }` is accepted **only** for `kdf_version 1` accounts and returns `needs_upgrade: true`. The app immediately calls `/api/auth/upgrade` and migrates the account's data (§6.9). After the upgrade the legacy protocol is refused for that account.

---

## 5. Encryption reference

| Item | Value |
|---|---|
| Cipher | AES-256-GCM, 96-bit random IV per encryption |
| Envelope | `"v2." + Base64( IV(12) ‖ ciphertext ‖ tag(16) )`. Standard Base64. |
| AAD | binds every ciphertext to its record: see table |
| KDF | PBKDF2-HMAC-SHA256 (≥ 300k, app uses 600k) → HKDF-SHA256 |
| Key sharing | ECDH P-256 → `HKDF-SHA256(shared, zero salt, "glassexpense/job-share/v2\|<jobId>")` → AES-GCM, AAD `job-share\|<jobId>` |
| Recovery | BIP-39 12 words (128-bit) |

| Record | Encrypted with | AAD |
|---|---|---|
| Job (`jobs.enc`) | job key | `job\|<jobId>` |
| Expense | job key | `expense\|<jobId>\|<expenseId>` |
| Wishlist item | job key | `wishlist\|<jobId>\|<itemId>` |
| Subscription | job key | `subscription\|<jobId>\|<subId>` |
| Personal blob | user-data key = HKDF(MK, "glassexpense/user-data/v2") | `blob\|<userId>\|<name>` |
| Calendar title | calendar key | `calendar-title\|<jobId>` |
| Receipt file | job key (raw `IV ‖ ciphertext ‖ tag`, no envelope prefix, no AAD) | — |
| Job key, creator copy | MK (`IV ‖ ct ‖ tag`, no AAD) | — |
| Job key, member copy | ECDH share (above) | `job-share\|<jobId>` |

Plaintext schemas inside the envelopes (JSON):
- **Job**: `title, description, mode ('expense'|'budget'), client_name, client_address, client_email, job_rate, invoice_notes, invoice_tag, invoice_seq, invoice_number, google_sync_expenses`
- **Expense**: `amount, description, entry_type ('expense'|'income'), date ('YYYY-MM-DD'|null), tags: [{id,name,color}]`
- **Wishlist**: `name, estimated_cost, url, notes` · **Subscription**: `amount, description, entry_type, billing_day, frequency ('MONTHLY'|'QUARTERLY'|'SEMIANNUAL'|'YEARLY'), last_generated_at`
- **Blobs** (`name`): `tags` `{tags:[…]}` · `tax_settings` · `tax_mappings` `{tags:{id:line}, expenses:{id:line}}` · `w2_forms` `[…]` · `invoice_template` · `ai_settings` · `preferences`

The reference implementation is [`src/e2ee/crypto.ts`](../src/e2ee/crypto.ts).

---

## 6. Encrypted data API (`/api/v2`)

All routes need a **session** (never an API key). Records carry client-generated UUIDs; the server validates that `enc` is a well-formed envelope but cannot read it. Writes that would put plaintext in `enc` are rejected with `400`.

> **Most developers should not call these directly.** The web app wraps them in a client-side layer that keeps the older, convenient shapes (e.g. `GET /api/jobs` with decrypted titles and totals). If you build an interactive client, reuse that layer (`src/e2ee/`) or implement §5.

Access control: you must be the job's **owner** or an **active member**. Anyone else (including pending invitees) receives `404`, so existence is not revealed.

### 6.1 Jobs
| | |
|---|---|
| `GET /api/v2/jobs` | `[ { id, created_by, owner_name, is_archived, start_date, end_date, enc, google_event_id, created_at, updated_at, role } ]` |
| `GET /api/v2/jobs/pending` | Jobs I redeemed an invite for and am waiting to be approved into |
| `POST /api/v2/jobs` | `{ id, enc, start_date, end_date, key, calendar_title_enc }` — `key` = job key sealed under MK (Base64). Plan limits apply (`403`). |
| `PUT /api/v2/jobs/:id` | Owner. `{ enc, start_date, end_date, calendar_title_enc }`. Also scrubs legacy plaintext columns. |
| `PUT /api/v2/jobs/:id/calendar-label` | Any participant. `{ title_enc }` — the title encrypted under **your** calendar key. |
| `PATCH /api/v2/jobs/:id/archive` | Owner. `{ is_archived }` |
| `DELETE /api/v2/jobs/:id` | Owner. Deletes everything incl. receipt files. |
| `DELETE /api/v2/jobs/:id/leave` | Member leaves. |

### 6.2 Keys, members, invites
| | |
|---|---|
| `GET /api/v2/keys` | All job keys wrapped for me: `[ { job_id, encrypted_key, wrapped_by, wrapper_public_key } ]` (`wrapped_by` null ⇒ sealed under my MK) |
| `PUT /api/v2/jobs/:id/key` | Owner re-stores their own copy `{ encrypted_key }` |
| `GET /api/v2/jobs/:id/members` | `[ { user_id, username, email, public_key, status, has_key } ]` (owner also sees `pending`) |
| `PUT /api/v2/jobs/:id/members/:userId/key` | **Approve a member.** Owner uploads the job key wrapped for that member's public key: `{ encrypted_key }`; the member becomes `active`. |
| `DELETE /api/v2/jobs/:id/members/:userId` | Owner removes a member; access ends immediately. |
| `POST /api/v2/jobs/:id/invites` | Owner. → `{ token: "gi_…", expires_at }`. Single-use, valid 7 days, max 20 open. |
| `DELETE /api/v2/jobs/:id/invites` | Owner revokes all unused invites. |
| `POST /api/v2/invites/redeem` | `{ token }` → membership becomes **pending**. Plan join/member limits apply. |

**Joining flow:** owner creates an invite → invitee redeems it (pending, sees nothing) → owner's app shows the invitee's **security code** (key fingerprint) → owner confirms it with the invitee out-of-band and approves → owner's browser wraps the job key for the invitee's public key → invitee can decrypt. The invite never contains a key.

### 6.3 Expenses and receipts
| | |
|---|---|
| `GET /api/v2/expenses` | Every expense row in every job I can access (one request) |
| `GET /api/v2/jobs/:jobId/expenses` | `[ { id, job_id, user_id, user_name, enc, receipt_url, is_encrypted, created_at, updated_at } ]` |
| `POST /api/v2/jobs/:jobId/expenses` | `multipart/form-data`: `id`, `enc`, optional `receipt` (**must be `application/octet-stream`**, ≤ 15 MB, encrypted by the client) |
| `POST /api/v2/jobs/:jobId/expenses/bulk` | `{ items: [ { id, enc } ] }` (≤ 500). Idempotent: existing ids are skipped. → `{ created, ids }` |
| `POST /api/v2/jobs/:jobId/expenses/rewrite` | Owner. Batch re-encrypt existing rows (migration). |
| `PUT /api/v2/jobs/:jobId/expenses/:id` | Author or owner. `{ enc }` |
| `PATCH /api/v2/jobs/:jobId/expenses/:id/receipt` | Author or owner. multipart `receipt` |
| `DELETE /api/v2/jobs/:jobId/expenses/:id` | Author or owner |
| `GET /api/v2/uploads/:filename` | Authenticated receipt download. `Cache-Control: private, no-store`. Old public `/uploads/*` URLs return `404`. |

### 6.4 Wishlist & subscriptions
`GET/POST /api/v2/jobs/:jobId/wishlist`, `PUT/DELETE …/wishlist/:itemId` — body `{ id, enc }` / `{ enc }`.
`GET/POST /api/v2/jobs/:jobId/subscriptions`, `PUT/DELETE …/subscriptions/:itemId` — body `{ id?, enc, next_generation_date (YYYY-MM-DD), remind_1_day_before, remind_2_days_before, remind_7_days_before }`.

> **Recurring entries are created by the client.** The server cannot read a subscription, so the app generates due expenses when it opens (ids are derived from subscription + date, so two devices never duplicate). The server only sends content-free reminder e-mails/pushes ("a subscription is due in 2 days") based on `next_generation_date` and the reminder flags.

### 6.5 Personal encrypted blobs
`GET /api/v2/blobs` → `[ { name, enc, version, updated_at } ]`
`PUT /api/v2/blobs/:name` — `{ enc, expected_version? }` → `{ name, version }`; `409` with the current `version` on conflict. Allowed names: `tags, tax_settings, tax_mappings, w2_forms, invoice_template, ai_settings, preferences`. Max ≈ 900 KB.

### 6.6 Calendar → see §3. Delegation for background sync → §7.

### 6.7 Where the old features went (now computed in the browser)
Reports, tax calculation, Schedule C mapping, deduction suggestions, invoice numbering, search, CSV/JSON import & export, job totals — all run **client-side** over decrypted data. They were server endpoints before (`/api/reports/custom`, `/api/taxes/*`, `/api/jobs/next-invoice-number`, …); the server can no longer compute them. See [§11](#11-what-changed-from-the-previous-api).

### 6.8 Real-time → §9.

### 6.9 Migrating accounts created before encryption
| | |
|---|---|
| `GET /api/legacy/export` | Session of an **upgraded** account that still has legacy data. Returns only that user's own un-encrypted rows (jobs they own and their contents, tags, tax data, W-2s, invoice template, AI settings). `410` after completion. |
| `POST /api/v2/migration/complete` | Verifies nothing un-encrypted remains for the user's jobs, deletes the user's remaining legacy plaintext, sets `e2ee_version = 2`, then checkpoints the WAL and `VACUUM`s the database so deleted plaintext does not linger on disk. `409` with `remaining` if work is left. |

The browser does the re-encryption on the next login (progress screen); it is resumable. Only a job's **owner** migrates its contents (including entries members authored), because only the owner can hold its key. Members of a migrated job are re-approved by the owner (§6.2).

---

## 7. Account settings, API keys, Google Calendar, OCR

### API keys (`session` only)
- `GET /api/keys` → `[ { id, name, created_at, last_used_at, has_calendar_key } ]`
- `POST /api/keys` → `{ name, key_hash, wrapped_calendar_key }`. **The key is generated by the client**, because it must contain a private half the server never sees: `key_hash = hex(SHA-256(public half))`; `wrapped_calendar_key = "v2." + Base64(Seal(HKDF(private half, "glassexpense/apikey-calendar/v2"), calendar key, AAD "apikey-calendar"))`. Plan limits may disable keys on free SaaS tiers (`403`).
- `DELETE /api/keys/:id`

### Report e-mails

`GET /api/settings/reports` → `{ frequency, last_run_at, next_run_at, report_delegated, report_available, snapshot_updated_at }`
`POST /api/settings/reports` → `{ frequency }` (`NONE|WEEKLY|BIWEEKLY|MONTHLY`) · `POST …/reports/test` · `POST …/reports/generate` · `POST /api/settings/subscriptions/test`

There are two kinds of report e-mail:

| | Default (nothing to enable) | **Reports with figures** (opt-in) |
|---|---|---|
| Contents | "N new entries across M jobs" and generic renewal reminders. **No** amounts, names or descriptions. | Net, income and expenses with change vs. the previous period, **winners vs. loss leaders** by job, top spending categories |
| What the server can read | Counts and timestamps | A small aggregate summary (below), only at send time and only for you |
| Sent by | Server | Server (from your summary) |

`test` and `generate` send the figures version if you opted in and a summary exists, otherwise the default version (`with_figures` in the response says which).

#### How "reports with figures" works

The server cannot read your expenses, so **your app builds the report data** and uploads it encrypted:

1. When you turn the feature on, the app creates a random **report key**, stores it in your encrypted vault (`preferences` blob), and gives a copy to the server (`POST /api/settings/reports/delegation`, sealed with `SERVER_WRAP_KEY`; `503` if the operator has not configured it).
2. The app computes a **summary** of the last 70 days from your decrypted data and uploads it encrypted under that report key (`PUT /api/settings/reports/snapshot`, AAD `report-snapshot|<userId>`). It rebuilds and re-uploads the summary on app start, shortly after any change you make, and when a collaborator's entry arrives while the app is open.
3. On your schedule, the server decrypts **only that summary** in memory, works out the period you asked for (7/14/30 days ending today, compared with the period before), renders the e-mail and discards the plaintext.

Summary format (what the server can see, after decryption, at send time):
```json
{ "v": 1, "generated_at": "2026-11-10T09:12:00Z", "include_job_names": true, "include_category_names": true,
  "jobs": ["Smith Kitchen", "Garage Rewire"], "cats": ["Materials", "Fuel"],
  "rows": [["2026-11-09", 0, 0, 0, 250.75, 2], ["2026-11-09", 1, -1, 900, 0, 1]] }
```
Each row is `[date, jobIndex, categoryIndex (-1 = untagged), income, expense, entryCount]`, aggregated per day, job and first tag. There are **no individual entries, descriptions, notes, clients or receipts**. If you switch off *include job names* / *category names* the arrays contain `Job 1…`, `Category 1…` instead.

| Endpoint | |
|---|---|
| `POST /api/settings/reports/delegation` | `{ report_key: "<Base64, 32 bytes>" }` — opt in |
| `PUT /api/settings/reports/snapshot` | `{ enc: "v2…" }` — upload/replace your summary (`409` unless opted in; ≤ 400 KB) |
| `DELETE /api/settings/reports/delegation` | Opt out: the server **forgets the key and deletes the stored summary** immediately. Re-enabling creates a brand-new key. |

Things to know:
- **Freshness.** Figures are as recent as your app's last upload. Entries are only ever created in an app, so the summary updates itself while you work; if you have not opened the app for several days the e-mail says "figures reflect your last sync". Entries a collaborator adds appear when *your* app next syncs.
- **E-mail is not encrypted.** The figures travel through your SMTP provider in plain text, as any e-mail does.
- API keys can never call these endpoints (`403`).
- Archived jobs are excluded; multi-tag entries count toward their first tag.

### Google Calendar
- `GET /api/auth/google` → `{ url }` (OAuth consent, `state` is a signed 10-minute token). `GET /api/auth/google/callback` completes it.
- `GET /api/settings/google` → `{ isConnected, calendarId, syncJobs, syncExpenses: false, serverSyncEnabled, serverSyncAvailable }`
- `PATCH /api/settings/google` → `{ calendarId, syncJobs }` · `DELETE /api/settings/google/disconnect`
- `POST /api/settings/google/delegation` → `{ calendar_key: "<Base64 32 bytes>" }` **opt-in**: gives the server the *calendar key* (job titles + dates only) so it can sync in the background; sealed under `SERVER_WRAP_KEY`. `503` if the operator has not configured `SERVER_WRAP_KEY`. `DELETE` revokes immediately.
- Per-expense calendar events were **removed** (they would expose amounts/descriptions).

### Device token
`POST /api/settings/device-token` → `{ token }`.

### AI / OCR
- The AI provider key is stored **encrypted in your vault** (`ai_settings` blob), not on the server.
- `POST /api/settings/ai/verify` → `{ ai_api_key, ai_base_url }` tests the provider; nothing is stored.
- `POST /api/ocr` (`multipart`: `receipt`, `ai_api_key`, `ai_base_url`, `ai_model`) and `POST /api/taxes/w2/ocr` (`w2`, …) forward the image to your provider and return the parsed fields. The key is used for that request only. The provider URL must be `https` and publicly routable (SSRF-protected) unless the operator sets `ALLOW_PRIVATE_AI_URLS=true`. Upstream error bodies are not returned.

---

## 8. Administration (the admin system)

**Who is an admin?** Only accounts with the `is_admin` flag. There is no longer any rule that makes someone admin by matching an e-mail address at request time.

| How an account becomes admin | |
|---|---|
| First account registered on an instance | Automatically admin. |
| `npm run admin:promote -- you@example.com` | Grants the flag to an existing account (run on the server). |
| `ADMIN_EMAIL` env var | At boot, the **existing** account with that e-mail is promoted once (so older installs keep access). That address is **reserved**: nobody else can register or switch to it once any user exists. |

**Rules for every admin endpoint:** requires an interactive **session** (an API key is always rejected), and the caller must be admin (`403` otherwise).

**What admins can and cannot do**
- ✅ See the user list (id, username, e-mail, plan, created, `e2ee_version`), change a user's **e-mail** or **plan**, delete a user (removes their data and receipt files), view stats, manage SaaS limits and license keys.
- ❌ **Cannot read anyone's data** — it is encrypted with keys the server never has.
- ❌ **Cannot set or force a user's password** (`PATCH` with `password` → `400`). The server never sees passwords, so a forced password could not re-wrap that user's vault. A user who is locked out uses *Forgot password* with their recovery phrase.

| Endpoint | Body / result |
|---|---|
| `GET /api/admin/users` | `[ { id, username, email, plan, created_at, e2ee_version } ]` |
| `PATCH /api/admin/users/:id` | `{ email?, plan? }` — `plan ∈ free \| pro \| personal`; `404` unknown user; `400` duplicate e-mail |
| `DELETE /api/admin/users/:id` | Cannot delete yourself. Detaches license rows, deletes files after the DB transaction commits. |
| `GET /api/admin/stats` | `{ users, jobs, expenses, dbSizeBytes, uploadsSizeBytes, isSaaSMode, isUnlocked }` |
| `GET /api/admin/config` · `PATCH /api/admin/config` | SaaS limits `[ { key_name, value } ]`; values must be integers 0–999999 |
| `GET /api/admin/licenses` | List license keys (hashes, status, activator) |
| `POST /api/admin/license/generate` | `{ plan }` → `{ key: "sk_…" }` shown **once**; status starts `unused` |
| `DELETE /api/admin/license/:id` | Revoke |
| `POST /api/license/activate` | Session `{ key }`. `unused → active`; second use → `400`. Rate-limited. |
| `POST /api/license/remote-verify` | Public, rate-limited: community instances verify a key (`unused → remote_used`). |

A license key unlocks multi-user mode only after it is **activated** — merely generating one does not.

---

## 9. Real-time events (Socket.IO)

Connect with the session token: `io(origin, { auth: { token } })`. Unauthenticated sockets are rejected (`unauthorized`). After connecting, emit `join_job` with a job id; you are only joined if you are the owner or an active member. Each socket also joins a private room for personal notices.

| Event | Payload |
|---|---|
| `expense_added`, `expense_updated` | The **ciphertext** row (same shape as `GET /api/v2/jobs/:id/expenses`); decrypt with the job key |
| `expense_deleted`, `wishlist_item_deleted` | the id |
| `wishlist_item_added` | ciphertext wishlist row |
| `job_updated` | `{ id, enc, start_date, end_date }` |
| `job_deleted` | job id |
| `subscription_reminder` | `{ id, next_generation_date, daysBefore }` — no names or amounts |
| `member_pending` *(to the owner)* | `{ job_id }` — someone redeemed an invite |
| `job_key_ready` *(to the member)* | `{ job_id }` — the owner approved you |

Removing a member or leaving a job also removes the socket from the room.

---

## 10. System, rate limits & errors

- `GET /api/info` → `{ isSaaS, isUnlocked, version: "2.0.0", e2ee: 2, limits: { active, joined, archived } }`
- `GET /api/app-update/check` → OTA manifest `{ available, version, url, checksum, releaseNotes, publishedAt }`. The mobile app verifies the SHA-256 `checksum`.
- `GET /updates/:file` → OTA bundles.

**Rate limits** (per client IP; `TRUST_PROXY` must reflect your reverse proxy): 600 requests/minute across `/api`; login 30 / 15 min plus an 8-failure account lockout; registration 10/h; password reset 10/h, forgot-password 5/h; license endpoints 20/h; e-mail-sending routes 5/h; AI/OCR 60/h. Exceeded → `429` with `RateLimit-*` headers. The app retries `429` automatically.

**Status codes:** `400` validation (including non-envelope `enc`) · `401` missing/expired/revoked session or unknown API key · `403` forbidden (wrong role, API key on a session-only route, plan limit) · `404` unknown **or inaccessible** resource · `409` conflict (duplicate id, blob version, account must upgrade) · `413` upload too large (15 MB) · `423` *(client-side)* you do not hold this job's key yet · `429` rate limit.

**Uploads:** receipts are opaque encrypted blobs, ≤ 15 MB, `application/octet-stream` only, stored under random names.

---

## 11. What changed from the previous API

Because the server can no longer read your data, plaintext content endpoints were replaced. If you had scripts using an API key against these, they must move to the calendar API or to an interactive client.

| Before | Now |
|---|---|
| API keys could read/write jobs, expenses, tags, wishlists, reports | API keys: **calendar only** (§3). Everything else → `403`. |
| Key was a single string `ge_…` generated by the server | Key = `ge_<public>.<private>` generated in your browser; send only the public half |
| `GET /api/calendar/schedule` → `[ {id,title,start_date,end_date} ]` | → `{ version, wrapped_calendar_key, jobs:[{id,start_date,end_date,title(encrypted)}] }` — decrypt per §3 |
| `/api/jobs`, `/api/jobs/:id/expenses`, `/wishlist`, `/subscriptions`, `/api/tags`, `/api/invoice-templates`, import/export | Replaced by `/api/v2/*` ciphertext endpoints; the plaintext shapes now exist **only inside the app** |
| `/api/reports/custom`, `/api/taxes/*` (profile, W-2, calculate, mappings, suggestions) | Computed in the browser; no server endpoint. Tax OCR remains (`/api/taxes/w2/ocr`). |
| `GET /api/jobs/next-invoice-number` | Computed in the browser |
| `POST /api/jobs/join { jobId }` · invite = `jobId#rawKey` | `POST /api/v2/invites/redeem { token }`; owner **approves** with fingerprint check; keys are never in invites |
| `GET/POST /api/jobs/:id/keys`, `/keys/batch` | `GET /api/v2/keys`, `PUT …/members/:userId/key`, `PUT …/jobs/:id/key` |
| `/uploads/<file>` public static | `GET /api/v2/uploads/:file` (authenticated); `/uploads/*` → `404` |
| Login `{ username, password }` | `POST /api/auth/params` then `{ identifier, auth_key }`; legacy accounts upgrade once |
| `PATCH /api/auth/me/password { currentPassword, newPassword, master_key_encrypted }` | `{ current_auth_key, auth_key, kdf_salt, kdf_iterations, master_key_encrypted }` |
| `POST /api/auth/reset-password { token, newPassword, master_key_encrypted }` | `{ token, auth_key, kdf_salt, kdf_iterations, master_key_encrypted, key_check }` |
| `GET/POST /api/settings/ai` stored the key on the server | Removed; stored in the encrypted `ai_settings` blob. `…/ai/verify` and OCR take the key per request. |
| Admin could `PATCH /api/admin/users/:id { password }` | Removed (`400`); users reset via recovery phrase |
| Admin = `is_admin` **or** e-mail equals `ADMIN_EMAIL` | `is_admin` only; `ADMIN_EMAIL` promotes the existing account once and is reserved |
| Report e-mails with totals & transactions; subscription reminders with names/amounts | Default: counts only and generic reminders. **Opt-in** reports with figures (income/expense, trend, winners vs. loss leaders) built from an aggregate summary your app uploads (§7) |
| Server auto-created recurring expenses | The user's client creates them when the app opens |
| Per-expense Google Calendar events (`google_sync_expenses`) | Removed |
| Google sync worked in the background by default | Opt-in delegation of the calendar key (§7) |
| Socket.IO open to anyone with a job id; payloads were plaintext rows | Requires a session; membership-checked rooms; payloads are ciphertext (§9) |
| `/api/info` `version: 1.2.0` | `2.0.0`, adds `e2ee: 2` |
