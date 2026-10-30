// GlassExpense calendar client for browsers / Cloudflare Workers / Deno (Web Crypto only, no dependencies).
//   const jobs = await fetchSchedule('https://expenses.example.com', 'ge_AAAA….BBBB…');
// The API key's second half (after the dot) is a private decryption secret: keep it server-side or in a secure store,
// and never put it in client-side code that untrusted visitors can read.
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const text = new TextEncoder();

async function openEnvelope(key, envelope, aad) {
  const data = b64(envelope.replace(/^v2\./, ''));                          // IV[12] || ciphertext || tag[16]
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(0, 12), additionalData: text.encode(aad) }, key, data.subarray(12));
  return new Uint8Array(plain);
}
const aesKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);

export async function fetchSchedule(baseUrl, fullApiKey) {
  const [headerKey, decryptPart] = fullApiKey.split('.');
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/calendar/schedule`, { headers: { 'x-api-key': headerKey } });
  if (!res.ok) throw new Error(`GlassExpense answered ${res.status}`);
  const schedule = await res.json();

  const hkdfKey = await crypto.subtle.importKey('raw', b64(decryptPart), 'HKDF', false, ['deriveBits']);
  const wrapKeyRaw = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: text.encode('glassexpense/apikey-calendar/v2') }, hkdfKey, 256));
  const calendarKey = await aesKey(await openEnvelope(await aesKey(wrapKeyRaw), schedule.wrapped_calendar_key, 'apikey-calendar'));

  return Promise.all(schedule.jobs.map(async (job) => ({
    id: job.id, start_date: job.start_date, end_date: job.end_date,
    title: job.title ? JSON.parse(new TextDecoder().decode(await openEnvelope(calendarKey, job.title, `calendar-title|${job.id}`))) : null,
  })));
}
