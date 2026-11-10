import type { Invoice } from './types';

/**
 * Typed access to the `ge` namespace of an invoice (docs/DOCUMENTATION.md §13.6-§13.9, §13.12). The core keeps `ge` opaque and
 * sanitized (`normalizeInvoice`); this module gives the application code a checked view of it. Pure.
 */

export type Actor = { by: 'human' | 'agent' | 'system'; keyId?: string };
export interface GeEvent { at: string; by: Actor['by']; keyId?: string; action: string; note?: string }
export interface GeReview { by: 'human' | 'agent'; keyId?: string; at: string; note: string }
export interface GePayment { id: string; method: string; amount: number; date: string; reference: string; taxPortion: number; incomeEntryId?: string }
export interface GeAi { lineIds: string[]; verified: boolean; model?: string; summary?: string; confidence?: string; questions?: string[] }

export interface GeView {
  review?: GeReview;
  payments: GePayment[];
  events: GeEvent[];
  pending: string[];
  sentAt?: string;
  sentTo?: string;
  ai?: GeAi;
  fromExpense: string[];
  /** Why this document exists: 'manual' | 'api-auto' | 'agent' | 'ai-draft'. */
  origin?: string;
  jobNumber?: string;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const MAX_EVENTS = 200;
export const MAX_PAYMENTS = 100;

/** A validated read of `invoice.ge`: malformed pieces are dropped, never trusted. */
export function geOf(invoice: Pick<Invoice, 'ge'>): GeView {
  const g = isObj(invoice.ge) ? invoice.ge : {};
  const review = isObj(g.review) && (g.review.by === 'human' || g.review.by === 'agent')
    ? { by: g.review.by as 'human' | 'agent', ...(g.review.keyId ? { keyId: s(g.review.keyId, 64) } : {}), at: s(g.review.at, 40), note: s(g.review.note, 2000) } : undefined;
  return {
    review,
    payments: (Array.isArray(g.payments) ? g.payments : []).filter(isObj).slice(0, MAX_PAYMENTS).map(p => ({
      id: s(p.id, 64), method: s(p.method, 20), amount: n(p.amount), date: s(p.date, 10), reference: s(p.reference, 200), taxPortion: n(p.taxPortion), ...(p.incomeEntryId ? { incomeEntryId: s(p.incomeEntryId, 64) } : {}),
    })).filter(p => p.id),
    events: (Array.isArray(g.events) ? g.events : []).filter(isObj).slice(-MAX_EVENTS).map(e => ({
      at: s(e.at, 40), by: (['human', 'agent', 'system'].includes(e.by) ? e.by : 'system') as Actor['by'], ...(e.keyId ? { keyId: s(e.keyId, 64) } : {}), action: s(e.action, 60), ...(e.note ? { note: s(e.note, 500) } : {}),
    })),
    pending: (Array.isArray(g.pending) ? g.pending : []).filter((x: unknown) => typeof x === 'string').slice(0, 10) as string[],
    sentAt: g.sentAt ? s(g.sentAt, 40) : undefined, sentTo: g.sentTo ? s(g.sentTo, 254) : undefined,
    ai: isObj(g.ai) ? { lineIds: (Array.isArray(g.ai.lineIds) ? g.ai.lineIds : []).filter((x: unknown) => typeof x === 'string').slice(0, 200) as string[], verified: g.ai.verified === true,
      model: g.ai.model ? s(g.ai.model, 100) : undefined, summary: g.ai.summary ? s(g.ai.summary, 2000) : undefined, confidence: g.ai.confidence ? s(g.ai.confidence, 20) : undefined,
      questions: Array.isArray(g.ai.questions) ? g.ai.questions.filter((x: unknown) => typeof x === 'string').slice(0, 10).map((x: string) => x.slice(0, 300)) : undefined } : undefined,
    fromExpense: (Array.isArray(g.fromExpense) ? g.fromExpense : []).filter((x: unknown) => typeof x === 'string').slice(0, 500) as string[],
    origin: g.origin ? s(g.origin, 20) : undefined, jobNumber: g.jobNumber ? s(g.jobNumber, 100) : undefined,
  };
}

/** Returns a copy of `invoice` with `patch` merged into `ge` (undefined removes a key). */
export function withGe(invoice: Invoice, patch: Record<string, unknown>): Invoice {
  const next: Record<string, unknown> = { ...(isObj(invoice.ge) ? invoice.ge : {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v; }
  return { ...invoice, ge: next };
}

/** Appends an audit event (bounded). */
export function addEvent(invoice: Invoice, actor: Actor, action: string, note?: string, now: Date = new Date()): Invoice {
  const events = [...geOf(invoice).events, { at: now.toISOString(), by: actor.by, ...(actor.keyId ? { keyId: actor.keyId } : {}), action, ...(note ? { note } : {}) }].slice(-MAX_EVENTS);
  return withGe(invoice, { events });
}
