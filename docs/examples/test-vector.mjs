// Generates the documented test vector with FIXED keys and IVs (so the output is reproducible). Never use fixed IVs in real code.
import { createCipheriv, hkdfSync } from 'node:crypto';
const b64 = (b) => Buffer.from(b).toString('base64');
const b64url = (b) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const seal = (key, iv, plaintext, aad) => {
  const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return 'v2.' + b64(Buffer.concat([iv, ct, c.getAuthTag()]));
};
const decryptPart = Buffer.from(Array.from({ length: 32 }, (_, i) => i));          // 00 01 02 … 1f
const calendarKey = Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i));     // ff fe fd … e0
const jobId = '11111111-2222-4333-8444-555555555555';
const title = 'Smith Kitchen – Phase 1';

const wrapKey = Buffer.from(hkdfSync('sha256', decryptPart, Buffer.alloc(32), 'glassexpense/apikey-calendar/v2', 32));
const vector = {
  decrypt_part: b64url(decryptPart),
  wrap_key_hex: wrapKey.toString('hex'),
  calendar_key_hex: calendarKey.toString('hex'),
  job_id: jobId,
  title,
  wrapped_calendar_key: seal(wrapKey, Buffer.alloc(12, 1), calendarKey, 'apikey-calendar'),
  title_envelope: seal(calendarKey, Buffer.alloc(12, 2), Buffer.from(JSON.stringify(title)), `calendar-title|${jobId}`),
};
console.log(JSON.stringify(vector, null, 2));
