/**
 * Intake standard (docs/DOCUMENTATION.md §13.7): turns what a website form sends (structured fields, or the older text
 * description) into one consistent `JobIntake`, and writes a canonical description block from it. Pure, DOM-free and shared
 * with the server (agent create route). Hostile text is only ever stored as text: it can never change parsing rules, rates or fees.
 */

export interface IntakeWarning { code: string; message: string }
export interface JobIntake {
  v: 1;
  source: 'api' | 'manual' | 'import';
  externalRef?: string;
  receivedAt?: string;
  contact: { name?: string; email?: string; phone?: string };
  location?: { raw: string; street?: string; city?: string; region?: string; postal?: string; kind: 'customer_site' | 'shop' | 'unknown' };
  services: string[];
  vehicle?: { raw?: string; year?: number; make?: string; model?: string; engine?: string; vin?: string };
  /** Free-form detail values keyed by the variable names the user defined in Settings → Invoices → Detail fields (year, make, venue, ...). */
  fields?: Record<string, string>;
  partsPolicy: 'own-parts' | 'request-inspection' | 'unknown';
  symptoms?: string;
  preferred?: { start?: string; end?: string; window?: string };
  quote?: { hourlyRate?: number; baseFee?: number; variables?: Record<string, number> };
  extra: Record<string, string>;
  warnings: IntakeWarning[];
}

// ── Normalizers ──────────────────────────────────────────────────────────────
const MAKES = ['Acura', 'Alfa Romeo', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Fiat', 'Ford', 'Genesis', 'GMC', 'Honda', 'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes-Benz', 'Mini', 'Mitsubishi', 'Nissan', 'Polestar', 'Pontiac', 'Porsche', 'Ram', 'Rivian', 'Saturn', 'Scion', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo'];
const MAKE_BY_KEY = new Map<string, string>([...MAKES.map(m => [m.toLowerCase(), m] as [string, string]), ['chevy', 'Chevrolet'], ['vw', 'Volkswagen'], ['mercedes', 'Mercedes-Benz'], ['benz', 'Mercedes-Benz']]);
const MODEL_FIRST_WORDS = new Set(['grand', 'land', 'range', 'santa', 'town', 'model', 'crown', 'park', 'monte', 'el', 'pt', 'cr', 'hr', 'mx', 'cx', 'sierra', 'silverado', 'transit', 'express', 'ram']);
const DRIVETRAIN = new Set(['4wd', 'awd', '2wd', 'fwd', 'rwd', '4x4', '4x2', 'v6', 'v8', 'v10', 'i4', 'i6', 'dohc', 'sohc', 'gdi', 'tdi', 'cvt', 'ev']);
const SUFFIX: Record<string, string> = { street: 'St', st: 'St', road: 'Rd', rd: 'Rd', avenue: 'Ave', ave: 'Ave', boulevard: 'Blvd', blvd: 'Blvd', drive: 'Dr', dr: 'Dr', lane: 'Ln', ln: 'Ln', court: 'Ct', ct: 'Ct', circle: 'Cir', cir: 'Cir', highway: 'Hwy', hwy: 'Hwy', parkway: 'Pkwy', pkwy: 'Pkwy', place: 'Pl', pl: 'Pl', trail: 'Trl', trl: 'Trl', terrace: 'Ter', ter: 'Ter', way: 'Way' };
const DIRECTIONAL = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

export const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

/** E.164 for US-style numbers; anything else keeps its digits (with a leading + if it had one). */
export function normalizePhone(v: unknown): string | undefined {
  const raw = clip(v, 40); if (!raw) return undefined;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 7 && digits.length <= 15 ? (raw.trim().startsWith('+') ? `+${digits}` : digits) : undefined;
}
export function displayPhone(e164?: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164 || '';
}
export function normalizeEmail(v: unknown): string | undefined {
  const e = clip(v, 254).toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e) ? e : undefined;
}
const cap = (w: string) => w.replace(/(^|[-'’])([a-z])/g, (_, a, b) => a + b.toUpperCase());
const isAllUpperOrLower = (s: string) => s === s.toUpperCase() || s === s.toLowerCase();
/** Re-cases only when the whole value is upper or lower case; mixed case is the user's own and is left alone. */
export function normalizeName(v: unknown): string | undefined {
  const s = clip(v, 200).replace(/\s+/g, ' '); if (!s) return undefined;
  return isAllUpperOrLower(s) ? s.toLowerCase().split(' ').map(w => cap(w).replace(/^(Mc)([a-z])/, (_, a, b) => a + b.toUpperCase())).join(' ') : s;
}
export function normalizeStreet(v: unknown): string {
  const s = clip(v, 300).replace(/\s+/g, ' ');
  if (!s || !isAllUpperOrLower(s)) return s;
  return s.toLowerCase().split(' ').map((w, i, all) => {
    const bare = w.replace(/[.,]/g, '');
    if (DIRECTIONAL.has(bare) && i > 0) return bare.toUpperCase();
    if (SUFFIX[bare] && i > 0 && i >= all.length - 3) return SUFFIX[bare];
    return /^\d/.test(w) ? w : cap(w);
  }).join(' ');
}

/** Splits "street, city, ST 12345" when present; otherwise everything is the street. */
export function parseAddress(raw: string): NonNullable<JobIntake['location']> {
  const m = /^(.*?),\s*([^,]+?),\s*([A-Za-z]{2})\.?\s*(\d{5}(?:-\d{4})?)?$/.exec(raw.trim());
  if (m) return { raw, street: normalizeStreet(m[1]), city: normalizeName(m[2]), region: m[3].toUpperCase(), postal: m[4], kind: 'customer_site' };
  return { raw, street: normalizeStreet(raw), kind: 'customer_site' };
}

const thisYear = () => new Date().getFullYear();
export function parseVehicleLine(raw: string): NonNullable<JobIntake['vehicle']> {
  const out: NonNullable<JobIntake['vehicle']> = { raw: raw.trim() };
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  if (/^\d{4}$/.test(tokens[0] || '')) { const y = Number(tokens[0]); if (y >= 1981 && y <= thisYear() + 1) { out.year = y; i = 1; } }
  if (i === 0 && out.year === undefined) return out; // "truck": keep the raw text, invent nothing
  const two = `${tokens[i] || ''} ${tokens[i + 1] || ''}`.toLowerCase();
  const makeKey = MAKE_BY_KEY.has(two) ? two : (tokens[i] || '').toLowerCase();
  const make = MAKE_BY_KEY.get(makeKey);
  if (!make) return out;
  out.make = make; i += makeKey.includes(' ') ? 2 : 1;
  if (tokens[i]) {
    const keep2 = MODEL_FIRST_WORDS.has(tokens[i].toLowerCase()) && tokens[i + 1] && !DRIVETRAIN.has(tokens[i + 1].toLowerCase()) ? 2 : 1;
    out.model = tokens.slice(i, i + keep2).join(' '); i += keep2;
  }
  const rest = tokens.slice(i).map(t => (DRIVETRAIN.has(t.toLowerCase()) ? t.toUpperCase() : t)).join(' ');
  if (rest) out.engine = rest;
  return out;
}

// ── Text grammar (docs/DOCUMENTATION.md §13.7) ────────────────────────
const ALIASES: Record<string, string> = {
  customer: 'name', name: 'name', 'customer name': 'name', email: 'email', 'e-mail': 'email', phone: 'phone', tel: 'phone', mobile: 'phone', cell: 'phone',
  address: 'address', location: 'address', vehicle: 'vehicle', services: 'services', service: 'services', inspection: 'inspection',
  'preferred dates': 'dates', 'preferred date': 'dates', dates: 'dates', 'preferred time': 'time', time: 'time',
  'notes/symptoms': 'symptoms', notes: 'symptoms', symptoms: 'symptoms', 'notes / symptoms': 'symptoms',
};
const LABEL_RE = /^([A-Za-z][A-Za-z /_-]{0,31}):\s?(.*)$/;
const ADDRESS_LINE = /^\d+\s+\S|^[^,]+,\s*[A-Za-z]{2}\s*\d{5}(-\d{4})?$/;

export function partsPolicyFrom(text: string): JobIntake['partsPolicy'] {
  if (/own[\s-]*parts|provide.*(parts|hardware)|bring.*parts|supply.*parts/i.test(text)) return 'own-parts';
  if (/inspect|diagnos|verif/i.test(text)) return 'request-inspection'; // e.g. "On-site diagnosis & part verification needed"
  return 'unknown';
}

const SERVICE_ALIASES: Record<string, string> = { other: 'Other Custom Work', 'other custom work': 'Other Custom Work' };
export function normalizeServices(list: string[]): string[] {
  const out: string[] = [];
  for (const s of list.map(x => clip(x, 100)).filter(Boolean)) { const n = SERVICE_ALIASES[s.toLowerCase()] || s; if (!out.some(o => o.toLowerCase() === n.toLowerCase())) out.push(n); }
  return out.slice(0, 20);
}

/** Parses the human-readable description a website (or a person) wrote. Only text before the first `###` is read. */
export function parseIntakeText(description: string | null | undefined, now: Date = new Date()): JobIntake {
  const intake = emptyIntake('manual');
  const text = String(description || '').slice(0, 100_000);
  const head = text.split(/^###/m)[0];
  const fields: Record<string, string> = {};
  let last: string | null = null;
  let addressFromBare = '';
  for (const lineRaw of head.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) { if (last === 'symptoms') fields.symptoms = (fields.symptoms || '') + '\n'; continue; }
    const m = LABEL_RE.exec(line);
    const key = m ? ALIASES[m[1].trim().toLowerCase()] : undefined;
    if (m && key) { fields[key] = (fields[key] ? fields[key] + '\n' : '') + m[2].trim(); last = key; continue; }
    // Inside the free-text symptoms block only a KNOWN label ends it; anything else ("rate: 9999", "Note: x") is part of the customer's text.
    if (last === 'symptoms' && fields.symptoms !== undefined) { fields.symptoms += (fields.symptoms === '' || fields.symptoms.endsWith('\n') ? '' : '\n') + line; continue; }
    if (m && m[1].trim().length <= 32 && !/^\d/.test(m[1])) { intake.extra[clip(m[1], 40)] = clip(m[2], 500); last = null; continue; }
    if (last === 'symptoms') { fields.symptoms += (fields.symptoms.endsWith('\n') || !fields.symptoms ? '' : '\n') + line; continue; }
    if (!fields.address && !addressFromBare && ADDRESS_LINE.test(line)) { addressFromBare = line; last = 'address'; continue; }
    if (last && last !== 'address' && fields[last] !== undefined) fields[last] += ' ' + line; else intake.extra[`line${Object.keys(intake.extra).length + 1}`] = clip(line, 500);
  }
  if (addressFromBare && !fields.address) fields.address = addressFromBare;
  return finishIntake(intake, {
    name: fields.name, email: fields.email, phone: fields.phone, address: fields.address, vehicle: fields.vehicle,
    services: fields.services ? fields.services.split(/[,;]/) : [], inspection: fields.inspection, symptoms: (fields.symptoms || '').trim(),
    dates: fields.dates, time: fields.time,
  }, now);
}

export const emptyIntake = (source: JobIntake['source']): JobIntake => ({ v: 1, source, contact: {}, services: [], partsPolicy: 'unknown', extra: {}, warnings: [] });

interface RawFields { name?: string; email?: string; phone?: string; address?: string; vehicle?: string | NonNullable<JobIntake['vehicle']>; services: string[]; inspection?: string; symptoms?: string; dates?: string; time?: string; partsPolicy?: JobIntake['partsPolicy'] }

function finishIntake(intake: JobIntake, f: RawFields, now: Date): JobIntake {
  const warn = (code: string, message: string) => intake.warnings.push({ code, message });
  const name = normalizeName(f.name), email = normalizeEmail(f.email), phone = normalizePhone(f.phone);
  if (name) intake.contact.name = name;
  if (email) intake.contact.email = email; else if (f.email?.trim()) warn('email_invalid', 'The e-mail address does not look valid.');
  if (phone) intake.contact.phone = phone; else warn('phone_missing', f.phone?.trim() ? 'The phone number does not look valid.' : 'No phone number was provided.');
  if (!email && !f.email?.trim()) warn('email_missing', 'No e-mail address was provided.');
  if (f.address?.trim()) {
    const loc = parseAddress(clip(f.address, 500)); intake.location = loc;
    if (!loc.city || !loc.region || !loc.postal) warn('address_incomplete', 'The address is missing a city, state or ZIP code.');
  }
  if (typeof f.vehicle === 'string' && f.vehicle.trim()) intake.vehicle = parseVehicleLine(clip(f.vehicle, 200));
  else if (f.vehicle && typeof f.vehicle === 'object') intake.vehicle = f.vehicle;
  intake.services = normalizeServices(f.services);
  if (intake.services.includes('Other Custom Work') && !(f.symptoms || '').trim()) warn('service_unscoped', '"Other" was selected without details; ask what work is needed before estimating.');
  intake.partsPolicy = f.partsPolicy ?? partsPolicyFrom(f.inspection || '');
  if (intake.partsPolicy === 'own-parts') warn('customer_parts', 'The customer plans to supply their own parts.');
  const symptoms = clip(f.symptoms, 5000); if (symptoms) intake.symptoms = symptoms;
  if (f.dates || f.time) {
    const iso = (f.dates || '').match(/\d{4}-\d{2}-\d{2}/g) || [];
    intake.preferred = { ...(iso[0] ? { start: iso[0] } : {}), ...(iso[1] || iso[0] ? { end: iso[1] || iso[0] } : {}), ...(f.time ? { window: clip(f.time, 100) } : {}) };
  }
  intake.receivedAt = intake.receivedAt || now.toISOString();
  return intake;
}

// ── Structured payload (agent API `POST /jobs`) ─────────────────────────────
export class IntakeError extends Error {}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const MAX_RATE = 1_000_000;

/**
 * Validates the structured fields a website posts. Returns null when the body carries none of them (an old text-only payload).
 * Throws IntakeError with a clear message for malformed values. `quote` numbers are bounded, never trusted blindly.
 */
export function parseStructuredIntake(b: Record<string, unknown>, now: Date = new Date()): JobIntake | null {
  const has = ['client_phone', 'vehicle', 'fields', 'services', 'parts_policy', 'symptoms', 'preferred', 'quote', 'external_ref', 'intake_text'].some(k => b[k] !== undefined);
  if (!has) return null;
  const bad = (m: string): never => { throw new IntakeError(m); };

  let base = emptyIntake('api');
  if (b.intake_text !== undefined) { if (typeof b.intake_text !== 'string') bad('intake_text must be a string'); base = { ...parseIntakeText(b.intake_text as string, now), source: 'api' }; }

  let fields: Record<string, string> | undefined;
  if (b.fields !== undefined) {
    if (!isObj(b.fields)) bad('fields must be an object of variable name to value');
    fields = {};
    for (const [k, v] of Object.entries(b.fields as Record<string, unknown>).slice(0, 30)) {
      if (!/^[a-z][a-z0-9_]{0,30}$/.test(k)) bad(`fields.${k}: names use lower-case letters, digits and _ (max 31 characters)`);
      if (typeof v !== 'string' && typeof v !== 'number') bad(`fields.${k} must be text or a number`);
      const val = clip(v, 200); if (val) fields[k] = val;
    }
  }

  if (b.services !== undefined && (!Array.isArray(b.services) || b.services.length > 20 || b.services.some(s => typeof s !== 'string'))) bad('services must be an array of up to 20 strings');
  if (b.parts_policy !== undefined && !['own-parts', 'request-inspection', 'unknown'].includes(b.parts_policy as string)) bad('parts_policy must be "own-parts", "request-inspection" or "unknown"');
  if (b.symptoms !== undefined && typeof b.symptoms !== 'string') bad('symptoms must be a string');
  if (b.external_ref !== undefined && (typeof b.external_ref !== 'string' || !/^[\w.:-]{1,100}$/.test(b.external_ref))) bad('external_ref must be 1-100 characters: letters, digits, . _ : -');

  let vehicle: RawFields['vehicle'];
  if (b.vehicle !== undefined) {
    if (typeof b.vehicle === 'string') vehicle = b.vehicle;
    else if (isObj(b.vehicle)) {
      const v = b.vehicle; const year = v.year === undefined || v.year === '' ? undefined : Number(v.year);
      if (year !== undefined && !(Number.isInteger(year) && year >= 1900 && year <= thisYear() + 2)) bad('vehicle.year is not a valid year');
      const make = clip(v.make, 60); const canon = MAKE_BY_KEY.get(make.toLowerCase()) || make;
      vehicle = { ...(year ? { year } : {}), ...(canon ? { make: canon } : {}), ...(clip(v.model, 80) ? { model: clip(v.model, 80) } : {}), ...(clip(v.engine, 100) ? { engine: clip(v.engine, 100).replace(/\b(4wd|awd|2wd|fwd|rwd|4x4|v6|v8)\b/gi, m => m.toUpperCase()) } : {}), ...(clip(v.vin, 17) ? { vin: clip(v.vin, 17).toUpperCase() } : {}) };
    } else bad('vehicle must be an object or a string');
  }

  const intake = finishIntake({ ...base, source: 'api', warnings: [] }, {
    name: clip(b.client_name, 200) || base.contact.name, email: clip(b.client_email, 254) || base.contact.email, phone: clip(b.client_phone, 40) || base.contact.phone,
    address: clip(b.client_address, 500) || base.location?.raw, vehicle: vehicle ?? base.vehicle,
    services: b.services !== undefined ? (b.services as string[]) : base.services, symptoms: typeof b.symptoms === 'string' ? b.symptoms : base.symptoms,
    partsPolicy: (b.parts_policy as JobIntake['partsPolicy'] | undefined) ?? (base.partsPolicy !== 'unknown' ? base.partsPolicy : undefined),
  }, now);

  if (isObj(b.preferred)) {
    const p = b.preferred; const d = (x: unknown) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined);
    intake.preferred = { ...(d(p.start) ? { start: d(p.start) } : {}), ...(d(p.end) ? { end: d(p.end) } : {}), ...(clip(p.window, 100) ? { window: clip(p.window, 100) } : {}) };
  }
  if (b.quote !== undefined) {
    if (!isObj(b.quote)) bad('quote must be an object');
    const q = b.quote as Record<string, unknown>; const rate = (x: unknown, name: string) => {
      if (x === undefined || x === null) return undefined; const n = Number(x);
      if (!Number.isFinite(n) || n < 0 || n > MAX_RATE) bad(`quote.${name} must be a number between 0 and ${MAX_RATE}`); return Math.round(n * 100) / 100;
    };
    const variables: Record<string, number> = {};
    if (q.variables !== undefined) {
      if (!isObj(q.variables)) bad('quote.variables must be an object');
      for (const [k, v] of Object.entries(q.variables as Record<string, unknown>).slice(0, 30)) { if (!/^[a-z][a-z0-9_]{0,40}$/i.test(k)) bad(`quote.variables.${k}: names use letters, digits and _`); variables[k] = rate(v, `variables.${k}`) ?? 0; }
    }
    const hourlyRate = rate(q.hourly_rate, 'hourly_rate'), baseFee = rate(q.base_fee, 'base_fee');
    intake.quote = { ...(hourlyRate !== undefined ? { hourlyRate } : {}), ...(baseFee !== undefined ? { baseFee } : {}), ...(Object.keys(variables).length ? { variables } : {}) };
  }
  if (fields && Object.keys(fields).length) intake.fields = fields;
  if (typeof b.external_ref === 'string') intake.externalRef = b.external_ref;
  return intake;
}

const VEHICLE_KEYS = new Set(['year', 'make', 'model', 'engine', 'vin']);
const keyLabel = (k: string) => k.replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());

const policyText = (p: JobIntake['partsPolicy']) => (p === 'own-parts' ? 'Customer will provide own parts/hardware' : p === 'request-inspection' ? 'Request inspection before sourcing parts' : '');

/** The uniform, human-readable description block written from an intake (so jobs look the same whatever their source). */
export function canonicalDescription(i: JobIntake): string {
  const v = i.vehicle;
  const vehicle = v ? ([v.year, v.make, v.model, v.engine].filter(Boolean).join(' ') || v.raw || '') : '';
  const lines = [
    i.contact.name && `Customer: ${i.contact.name}`, i.contact.email && `Email: ${i.contact.email}`, i.contact.phone && `Phone: ${displayPhone(i.contact.phone)}`,
    i.location && `Address: ${[i.location.street, i.location.city, [i.location.region, i.location.postal].filter(Boolean).join(' ')].filter(Boolean).join(', ') || i.location.raw}`,
    vehicle && `Vehicle: ${vehicle}`,
    ...Object.entries(i.fields ?? {}).filter(([k]) => !(vehicle && VEHICLE_KEYS.has(k))).map(([k, val]) => `${keyLabel(k)}: ${val}`),
    i.services.length && `Services: ${i.services.join(', ')}`, policyText(i.partsPolicy) && `Inspection: ${policyText(i.partsPolicy)}`,
    i.preferred && (i.preferred.start || i.preferred.end) && `Preferred Dates: ${[i.preferred.start, i.preferred.end].filter(Boolean).filter((x, k, a) => a.indexOf(x) === k).join(' to ')}`,
    i.preferred?.window && `Preferred Time: ${i.preferred.window}`,
    ...Object.entries(i.extra).filter(([k]) => !/^line\d+$/.test(k)).map(([k, val]) => `${k}: ${val}`),
    i.symptoms && `Notes/Symptoms:\n${i.symptoms}`,
  ].filter(Boolean) as string[];
  return lines.join('\n');
}
