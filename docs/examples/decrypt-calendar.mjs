#!/usr/bin/env node
/**
 * GlassExpense calendar client (Node.js >= 18, no dependencies).
 *
 *   GLASSEXPENSE_URL=https://expenses.example.com \
 *   GLASSEXPENSE_API_KEY='ge_AAAA….BBBB…' \
 *   node decrypt-calendar.mjs
 *
 * The API key has two halves separated by a dot:
 *   - before the dot  → authenticates you (sent in the x-api-key header)
 *   - after the dot   → PRIVATE decryption secret (never sent to the server)
 */
import { createDecipheriv, hkdfSync } from 'node:crypto';

const BASE = (process.env.GLASSEXPENSE_URL || '').replace(/\/$/, '');
const [headerKey, decryptPart] = (process.env.GLASSEXPENSE_API_KEY || '').split('.');
if (!BASE || !headerKey || !decryptPart) {
  console.error('Set GLASSEXPENSE_URL and GLASSEXPENSE_API_KEY (the full key, including the part after the dot).');
  process.exit(1);
}

// base64 / base64url → Buffer
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Envelope layout: base64( IV[12] || ciphertext || GCM tag[16] ), optionally prefixed with "v2."
function openEnvelope(key, envelope, aad) {
  const data = b64(envelope.replace(/^v2\./, ''));
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]);
}

// 1. Ask the server for the schedule. Only the PUBLIC half of the key is sent.
const res = await fetch(`${BASE}/api/calendar/schedule`, { headers: { 'x-api-key': headerKey } });
if (!res.ok) throw new Error(`Server answered ${res.status}: ${await res.text()}`);
const schedule = await res.json();

// 2. Turn the private half into the key that unwraps the calendar key.
const wrapKey = Buffer.from(hkdfSync('sha256', b64(decryptPart), Buffer.alloc(32), 'glassexpense/apikey-calendar/v2', 32));

// 3. Unwrap the calendar key (AAD: "apikey-calendar").
const calendarKey = openEnvelope(wrapKey, schedule.wrapped_calendar_key, 'apikey-calendar');

// 4. Decrypt each job title (AAD: "calendar-title|<job id>"). The plaintext is a JSON string.
const jobs = schedule.jobs.map((job) => ({
  id: job.id,
  start_date: job.start_date,
  end_date: job.end_date,
  title: job.title ? JSON.parse(openEnvelope(calendarKey, job.title, `calendar-title|${job.id}`).toString('utf8')) : null,
}));

console.log(JSON.stringify(jobs, null, 2));
