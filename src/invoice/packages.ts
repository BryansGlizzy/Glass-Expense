import { addLaborItem, addPartItem, createId } from './model';
import { FEE_KINDS, type FeeKind, type FeeLine, type Invoice } from './types';

/**
 * Service Packages (docs/INVOICING_PLAN.md §5.7): the original app's "Quick Service Packages", made user-defined.
 * Stored in the encrypted `invoice_packages` blob. Nothing here invents prices or hours.
 */

export interface PackageLabor { description: string; technician: string; hours: number; /** null = use the hourly-rate variable at apply time */ rate: number | null }
export interface PackagePart { partNumber: string; description: string; quantity: number; unitPrice: number }
export interface ServicePackage {
  id: string;
  name: string;
  icon: string;
  order: number;
  /** Website service names / keywords this package fulfils, used for "Suggested". */
  matches: string[];
  labor: PackageLabor[];
  parts: PackagePart[];
  /** Fees this package SETS on a document (by label: an existing fee with that label is updated, otherwise one is added). Never added twice. */
  fees: PackageFee[];
  customerNote: string;
}

export interface PackageFee { label: string; kind: FeeKind; value: number; cap: number; taxable: boolean }

export const PACKAGE_LIMITS = { packages: 100, lines: 30 } as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, max) : '');
const num = (v: unknown, max: number): number => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0; };

export function normalizePackage(raw: unknown, index = 0): ServicePackage {
  const r = isObj(raw) ? raw : {};
  // Older packages stored three fixed fee fields; they become ordinary fees.
  const fees: PackageFee[] = [];
  if (Array.isArray(r.fees)) {
    for (const f of r.fees.slice(0, 20)) {
      const o = isObj(f) ? f : {};
      const kind = (FEE_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as FeeKind) : 'flat';
      fees.push({ label: str(o.label, 60) || 'Fee', kind, value: num(o.value, kind === 'flat' ? 1_000_000_000 : 100), cap: num(o.cap, 1_000_000_000), taxable: o.taxable === true });
    }
  } else if (isObj(r.fees)) {
    const legacy: Array<[string, string]> = [['travelFee', 'Travel Fee'], ['hazardousWasteFee', 'Hazardous Waste Fee'], ['miscFee', 'Misc. Fee']];
    for (const [k, label] of legacy) if (r.fees[k] !== undefined && r.fees[k] !== null) fees.push({ label, kind: 'flat', value: num(r.fees[k], 1_000_000_000), cap: 0, taxable: false });
  }
  return {
    id: typeof r.id === 'string' && /^[\w.:-]{1,64}$/.test(r.id) ? r.id : createId('pkg'),
    name: str(r.name, 100) || 'Untitled package',
    icon: str(r.icon, 8),
    order: Number.isFinite(Number(r.order)) ? Number(r.order) : index,
    matches: Array.isArray(r.matches) ? r.matches.slice(0, 20).map(x => str(x, 100)).filter(Boolean) : [],
    labor: (Array.isArray(r.labor) ? r.labor : []).slice(0, PACKAGE_LIMITS.lines).map(l => {
      const o = isObj(l) ? l : {};
      return { description: str(o.description, 1000), technician: str(o.technician, 200), hours: num(o.hours, 100_000), rate: o.rate === null || o.rate === undefined || o.rate === '' ? null : num(o.rate, 1_000_000_000) };
    }),
    parts: (Array.isArray(r.parts) ? r.parts : []).slice(0, PACKAGE_LIMITS.lines).map(p => {
      const o = isObj(p) ? p : {};
      return { partNumber: str(o.partNumber, 100), description: str(o.description, 1000), quantity: num(o.quantity, 1_000_000), unitPrice: num(o.unitPrice, 1_000_000_000) };
    }),
    fees,
    customerNote: str(r.customerNote, 2000),
  };
}

export function normalizePackages(raw: unknown): ServicePackage[] {
  const list = isObj(raw) && Array.isArray(raw.packages) ? raw.packages : Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  return list.slice(0, PACKAGE_LIMITS.packages).map(normalizePackage).map(p => {
    if (seen.has(p.id)) p = { ...p, id: createId('pkg') };
    seen.add(p.id); return p;
  }).sort((a, b) => a.order - b.order);
}

/**
 * Appends a package's labor and parts (applying twice doubles, like the original). A blank rate becomes `hourlyRate` NOW, so the
 * saved invoice is self-contained. Package fees SET the invoice fee (never add), so two packages cannot double-charge.
 * The customer note is appended once.
 */
export function applyPackage(invoice: Invoice, pkg: ServicePackage, hourlyRate: number): Invoice {
  let out = invoice;
  for (const l of pkg.labor) out = addLaborItem(out, { description: l.description, technician: l.technician, hours: l.hours, rate: l.rate ?? hourlyRate });
  for (const p of pkg.parts) out = addPartItem(out, { partNumber: p.partNumber, description: p.description, quantity: p.quantity, unitPrice: p.unitPrice });
  let settings = out.settings;
  let feeLines: FeeLine[] | undefined = out.fees;
  for (const f of pkg.fees) {
    if (feeLines) {
      const at = feeLines.findIndex(x => x.label.trim().toLowerCase() === f.label.trim().toLowerCase());
      const line: FeeLine = { id: at >= 0 ? feeLines[at].id : createId('fee'), label: f.label, kind: f.kind, value: f.value, cap: f.cap, taxable: f.taxable };
      feeLines = at >= 0 ? feeLines.map((x, i) => (i === at ? line : x)) : [...feeLines, line];
    } else if (f.kind === 'flat') {
      // Original-format documents have three fixed fee fields; a package fee lands on the one its name suggests.
      const key = /travel|diagnos|trip|call/i.test(f.label) ? 'travelFee' : /haz|waste|disposal/i.test(f.label) ? 'hazardousWasteFee' : 'miscFee';
      settings = { ...settings, [key]: f.value };
    }
  }
  out = feeLines ? { ...out, fees: feeLines } : out;
  let notes = out.notes;
  const note = pkg.customerNote.trim();
  if (note && !notes.customerNotes.includes(note)) notes = { ...notes, customerNotes: notes.customerNotes ? `${notes.customerNotes}\n${note}` : note };
  return { ...out, settings, notes };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Packages whose `matches` (or name) correspond to a website service name. Nothing is applied automatically. */
export function suggestPackages(services: string[], packages: ServicePackage[]): ServicePackage[] {
  const wanted = services.map(norm).filter(Boolean);
  if (!wanted.length) return [];
  return packages.filter(p => [p.name, ...p.matches].map(norm).some(m => m && wanted.some(w => w === m || w.includes(m) || m.includes(w))));
}

/** One empty package per website service name (hours and prices left for the user or the AI; none are invented). */
export function packagesFromServices(services: string[], existing: ServicePackage[]): ServicePackage[] {
  const have = new Set(existing.flatMap(p => [p.name, ...p.matches]).map(norm));
  let order = existing.reduce((m, p) => Math.max(m, p.order), 0);
  return services.filter(s => s.trim() && !have.has(norm(s))).map(s => normalizePackage({ id: createId('pkg'), name: s, matches: [s], order: ++order, labor: [{ description: '', technician: '', hours: 0, rate: null }] }));
}

/** The original app's six presets as an OPTIONAL starter. Their hours and prices are examples to edit or delete (plan §5.7). */
export function automotiveStarter(): ServicePackage[] {
  const L = (description: string, hours: number, technician = ''): PackageLabor => ({ description, technician, hours, rate: null });
  const defs: Array<[string, string, string[], PackageLabor[]]> = [
    ['Synthetic Oil & Filter Change', '🛢️', ['Oil Change'], [L('Synthetic oil and filter change', 0.6)]],
    ['Front Brake Pads & Rotors', '🛑', ['Brakes & Rotors'], [L('Replace front brake pads and rotors; inspect calipers', 2)]],
    ['4-Wheel Alignment', '🎯', ['Alignment'], [L('Four-wheel computerized alignment and steering inspection', 1.5)]],
    ['OBD-II Diagnostic Scan', '💻', ['Diagnostics & OBD-II Scanning'], [L('OBD-II scan, code analysis, and diagnostic report', 1)]],
    ['Battery Replacement', '🔋', ['Battery & Electrical'], [L('Battery test, replacement, and charging-system check', 0.7)]],
    ['A/C System Service', '❄️', ['A/C Service'], [L('A/C evacuation, leak inspection, and refrigerant recharge', 1.5)]],
  ];
  return defs.map(([name, icon, matches, labor], i) => normalizePackage({ id: `starter-${i + 1}`, name, icon, order: i + 1, matches, labor, parts: [] }, i));
}
