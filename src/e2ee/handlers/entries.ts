import * as C from '../crypto';
import { api, getSession, requireJobKey, invalidate, ensureJobKeys, HttpError } from '../session';
import { buildAgentBundle } from '../agent';
import {
  ExpenseBlob, ExpenseView, SubscriptionBlob, WishlistBlob, getBlob, setBlob, listExpenses, listWishlist, listSubscriptions,
  encExpense, toExpenseBlob, uuid, getJob, TagRef,
} from '../store';
import { nextSubscriptionDate } from '../subscriptions';
import { Route, ok, bad, NotFound } from './types';

const clean = (v: any, max: number): string | null => (v === undefined || v === null || v === '' ? null : String(v).slice(0, max));
const today = () => new Date().toISOString().slice(0, 10);

interface TagLibrary { tags: Array<TagRef & { created_at?: string }> }
const loadTags = async (): Promise<TagLibrary> => {
  const lib = await getBlob<TagLibrary>('tags', { tags: [] });
  return { tags: Array.isArray(lib.tags) ? lib.tags : [] };
};
const tagRefs = async (ids: unknown): Promise<TagRef[]> => {
  if (!Array.isArray(ids)) return [];
  const { tags } = await loadTags();
  return ids.map(id => tags.find(t => t.id === id)).filter(Boolean).map(t => ({ id: t!.id, name: t!.name, color: t!.color }));
};

/** Receipts are always encrypted before upload. If a caller hands over a plaintext file, it is encrypted here. */
async function encryptedReceipt(jobId: string, file: Blob | null, alreadyEncrypted: boolean): Promise<Blob | null> {
  if (!file) return null;
  if (alreadyEncrypted) return new Blob([await file.arrayBuffer()], { type: 'application/octet-stream' });
  const key = await C.cachedAesKey(await requireJobKey(jobId));
  return new Blob([await C.seal(key, new Uint8Array(await file.arrayBuffer()))], { type: 'application/octet-stream' });
}

async function findExpense(jobId: string, id: string): Promise<ExpenseView> {
  invalidate(`expenses:${jobId}`);
  const e = (await listExpenses(jobId)).find(x => x.id === id);
  if (!e) throw new NotFound('Expense not found');
  return e;
}

export const entryRoutes: Route[] = [
  // ── Expenses ───────────────────────────────────────────────────────────────
  ['GET', /^\/api\/jobs\/([^/]+)\/expenses$/, async ({ m }) => ok(await listExpenses(m[1]))],

  ['POST', /^\/api\/jobs\/([^/]+)\/expenses$/, async ({ m, form }) => {
    const jobId = m[1];
    if (!form) bad('Multipart form required');
    const amount = Number(form!.get('amount'));
    if (!Number.isFinite(amount)) bad('Amount must be a number');
    let tagIds: unknown = [];
    try { tagIds = form!.get('tags') ? JSON.parse(String(form!.get('tags'))) : []; } catch { bad('tags must be a JSON array'); }
    const blob: ExpenseBlob = toExpenseBlob({
      amount, description: clean(form!.get('description'), 1000), entry_type: form!.get('entry_type') === 'income' ? 'income' : 'expense',
      date: /^\d{4}-\d{2}-\d{2}/.test(String(form!.get('date') || '')) ? String(form!.get('date')).slice(0, 10) : null, tags: await tagRefs(tagIds),
    });
    const id = uuid();
    const out = new FormData();
    out.append('id', id);
    out.append('enc', await encExpense(jobId, id, blob));
    const receipt = await encryptedReceipt(jobId, form!.get('receipt') as Blob | null, form!.get('is_encrypted') === 'true');
    if (receipt) out.append('receipt', receipt, 'receipt.bin');
    await api('POST', `/api/v2/jobs/${jobId}/expenses`, { form: out });
    invalidate(`expenses:${jobId}`); invalidate('jobs');
    return ok({ ...(await findExpense(jobId, id)), sync_status: { success: false, skipped: 'Per-entry calendar sync was removed with end-to-end encryption' } });
  }],

  ['DELETE', /^\/api\/jobs\/([^/]+)\/expenses\/([^/]+)$/, async ({ m }) => {
    await api('DELETE', `/api/v2/jobs/${m[1]}/expenses/${m[2]}`);
    invalidate(`expenses:${m[1]}`); invalidate('jobs');
    return ok();
  }],

  ['PATCH', /^\/api\/jobs\/([^/]+)\/expenses\/([^/]+)\/receipt$/, async ({ m, form }) => {
    const out = new FormData();
    const receipt = await encryptedReceipt(m[1], form?.get('receipt') as Blob | null, form?.get('is_encrypted') === 'true');
    if (receipt) out.append('receipt', receipt, 'receipt.bin');
    await api('PATCH', `/api/v2/jobs/${m[1]}/expenses/${m[2]}/receipt`, { form: out });
    return ok(await findExpense(m[1], m[2]));
  }],

  ['PUT', /^\/api\/jobs\/([^/]+)\/expenses\/([^/]+)\/tags$/, async ({ m, body }) => {
    const e = await findExpense(m[1], m[2]);
    const blob = toExpenseBlob({ amount: e.amount, description: e.description, entry_type: e.entry_type, date: e.date, tags: await tagRefs(body.tags) });
    await api('PUT', `/api/v2/jobs/${m[1]}/expenses/${m[2]}`, { body: { enc: await encExpense(m[1], m[2], blob) } });
    return ok(await findExpense(m[1], m[2]));
  }],

  // ── Wishlist ───────────────────────────────────────────────────────────────
  ['GET', /^\/api\/jobs\/([^/]+)\/wishlist$/, async ({ m }) => ok(await listWishlist(m[1]))],

  ['POST', /^\/api\/jobs\/([^/]+)\/wishlist$/, async ({ m, body }) => {
    const name = clean(body.name, 200); if (!name) bad('Name is required');
    let url = clean(body.url, 2000);
    if (url) { try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; url = u.toString(); } catch { bad('URL must be a valid http(s) URL'); } }
    const blob: WishlistBlob = { name: name!, estimated_cost: body.estimated_cost ? Number(body.estimated_cost) || null : null, url, notes: clean(body.notes, 2000) };
    const id = uuid();
    await api('POST', `/api/v2/jobs/${m[1]}/wishlist`, { body: { id, enc: await C.encryptJson(await requireJobKey(m[1]), blob, C.aad.wishlist(m[1], id)) } });
    return ok((await listWishlist(m[1])).find(w => w.id === id));
  }],

  ['DELETE', /^\/api\/jobs\/([^/]+)\/wishlist\/([^/]+)$/, async ({ m }) => { await api('DELETE', `/api/v2/jobs/${m[1]}/wishlist/${m[2]}`); return ok(); }],

  ['POST', /^\/api\/jobs\/([^/]+)\/wishlist\/([^/]+)\/convert$/, async ({ m }) => {
    const item = (await listWishlist(m[1])).find(w => w.id === m[2]);
    if (!item) throw new NotFound('Item not found');
    const id = uuid();
    const f = new FormData();
    f.append('id', id);
    f.append('enc', await encExpense(m[1], id, toExpenseBlob({ amount: item.estimated_cost || 0, description: item.name, entry_type: 'expense', date: today(), tags: [] })));
    await api('POST', `/api/v2/jobs/${m[1]}/expenses`, { form: f });
    await api('DELETE', `/api/v2/jobs/${m[1]}/wishlist/${m[2]}`);
    invalidate(`expenses:${m[1]}`); invalidate('jobs');
    return ok({ success: true, expense: await findExpense(m[1], id) });
  }],

  // ── Subscriptions ──────────────────────────────────────────────────────────
  ['GET', /^\/api\/jobs\/([^/]+)\/subscriptions$/, async ({ m }) => ok(await listSubscriptions(m[1]))],

  ['POST', /^\/api\/jobs\/([^/]+)\/subscriptions$/, async ({ m, body }) => {
    const amount = Number(body.amount); const billingDay = Math.trunc(Number(body.billing_day));
    if (!Number.isFinite(amount) || amount <= 0 || !(billingDay >= 1 && billingDay <= 31)) bad('Amount and billing day are required');
    const frequency = (['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'].includes(body.frequency) ? body.frequency : 'MONTHLY') as SubscriptionBlob['frequency'];
    const blob: SubscriptionBlob = {
      amount, description: clean(body.description, 200), entry_type: body.entry_type === 'income' ? 'income' : 'expense',
      billing_day: billingDay, frequency, last_generated_at: null,
    };
    const id = uuid();
    await api('POST', `/api/v2/jobs/${m[1]}/subscriptions`, { body: {
      id, enc: await C.encryptJson(await requireJobKey(m[1]), blob, C.aad.subscription(m[1], id)),
      next_generation_date: nextSubscriptionDate(frequency, new Date(), billingDay),
      remind_1_day_before: body.remind_1_day_before, remind_2_days_before: body.remind_2_days_before, remind_7_days_before: body.remind_7_days_before,
    } });
    return ok({ success: true, id });
  }],

  ['DELETE', /^\/api\/jobs\/([^/]+)\/subscriptions\/([^/]+)$/, async ({ m }) => { await api('DELETE', `/api/v2/jobs/${m[1]}/subscriptions/${m[2]}`); return ok(); }],

  // ── Tags (personal library, stored as an encrypted blob) ───────────────────
  ['GET', /^\/api\/tags$/, async () => {
    const s = getSession();
    return ok((await loadTags()).tags.map(t => ({ user_id: s.userId, created_at: new Date().toISOString(), ...t })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
  }],
  ['POST', /^\/api\/tags$/, async ({ body }) => {
    const name = clean(body.name, 50); const color = clean(body.color, 9);
    if (!name || !color || !/^#[0-9a-fA-F]{3,8}$/.test(color)) bad('Name and a hex color are required');
    const lib = await loadTags();
    const tag = { id: uuid(), name: name!, color: color!, created_at: new Date().toISOString() };
    await setBlob('tags', { tags: [...lib.tags, tag] });
    return ok({ ...tag, user_id: getSession().userId });
  }],
  ['DELETE', /^\/api\/tags\/([^/]+)$/, async ({ m }) => {
    const lib = await loadTags();
    await setBlob('tags', { tags: lib.tags.filter(t => t.id !== m[1]) });
    const mappings = await getBlob<any>('tax_mappings', { tags: {}, expenses: {} });
    if (mappings.tags?.[m[1]]) { delete mappings.tags[m[1]]; await setBlob('tax_mappings', mappings); }
    return ok();
  }],

  // ── Invoice template ───────────────────────────────────────────────────────
  ['GET', /^\/api\/(invoice-templates|settings\/invoice-template)$/, async () => ok(await getBlob<any>('invoice_template', null))],
  ['POST', /^\/api\/invoice-templates$/, async ({ body }) => {
    let logo = clean(body.company_logo_url, 2000);
    if (logo) { try { const u = new URL(logo); if (!/^https?:$/.test(u.protocol)) throw 0; logo = u.toString(); } catch { bad('Logo URL must be a valid http(s) URL'); } }
    const prev = await getBlob<any>('invoice_template', null);
    const template = {
      id: prev?.id || uuid(), user_id: getSession().userId, company_name: clean(body.company_name, 200), company_address: clean(body.company_address, 500),
      company_logo_url: logo, default_hourly_rate: Number(body.default_hourly_rate) || 0, footer_notes: clean(body.footer_notes, 2000),
      default_prefix: (body.default_prefix ? String(body.default_prefix).replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() : 'INV') || 'INV',
      created_at: prev?.created_at || new Date().toISOString(),
    };
    await setBlob('invoice_template', template);
    return ok({ success: true, template });
  }],

  // ── AI settings (provider key lives only in the encrypted vault) ───────────
  ['GET', /^\/api\/settings\/ai$/, async () => {
    const s = await getBlob<any>('ai_settings', {});
    return ok({
      ai_api_key: s.ai_api_key || '', ai_api_key_set: !!s.ai_api_key, ai_base_url: s.ai_base_url || 'https://api.openai.com/v1',
      ai_model: s.ai_model || 'gpt-4o-mini', use_on_device_ai: s.use_on_device_ai ? 1 : 0, on_device_ai_model: s.on_device_ai_model || 'tesseract',
    });
  }],
  ['POST', /^\/api\/settings\/ai$/, async ({ body }) => {
    const prev = await getBlob<any>('ai_settings', {});
    const next = { ...prev };
    if (body.ai_api_key !== undefined) next.ai_api_key = clean(body.ai_api_key, 500) || '';
    if (body.ai_base_url !== undefined) {
      const url = clean(body.ai_base_url, 500);
      if (url && !/^https?:\/\//i.test(url)) bad('Base URL must start with https://');
      next.ai_base_url = url || '';
    }
    if (body.ai_model !== undefined) next.ai_model = clean(body.ai_model, 100) || '';
    if (body.use_on_device_ai !== undefined) next.use_on_device_ai = body.use_on_device_ai ? 1 : 0;
    if (body.on_device_ai_model !== undefined) next.on_device_ai_model = clean(body.on_device_ai_model, 200) || 'tesseract';
    await setBlob('ai_settings', next);
    return ok();
  }],

  // Cloud OCR: the provider key is read from the vault and attached to this single request; the server never stores it.
  ['POST', /^\/api\/(ocr|taxes\/w2\/ocr)$/, async ({ m, form }) => {
    if (!form) bad('Multipart form required');
    const s = await getBlob<any>('ai_settings', {});
    if (!s.ai_api_key) bad('AI settings not configured. Please add your API key in Settings.');
    const out = new FormData();
    for (const [k, v] of form!.entries()) out.append(k, v as any);
    out.append('ai_api_key', s.ai_api_key); out.append('ai_base_url', s.ai_base_url || 'https://api.openai.com/v1'); out.append('ai_model', s.ai_model || 'gpt-4o-mini');
    try { return ok(await api('POST', `/api/${m[1]}`, { form: out })); }
    catch (e) { if (e instanceof HttpError) return { status: e.status, json: e.body ?? { error: e.message } }; throw e; }
  }],

  // ── API keys: generated here because each key carries a private decryption half ─
  ['POST', /^\/api\/keys$/, async ({ body }) => {
    const name = clean(body.name, 100); if (!name) bad('Name required');
    const k = await C.createApiKeySecrets(getSession().keys.calendarKey);
    const payload: any = { name, key_hash: k.keyHash, wrapped_calendar_key: k.wrappedCalendarKey };
    // Optional agent access: the user explicitly opted in (Settings → API Keys). The server gets the keys of the chosen jobs.
    const agent = body.agent;
    if (agent) {
      if (agent.access !== 'read' && agent.access !== 'write') bad('Choose read-only or read+write agent access');
      const ids: string[] | null = agent.all_jobs ? null : (Array.isArray(agent.job_ids) ? agent.job_ids.map(String) : []);
      if (ids && ids.length === 0) bad('Select at least one job for this key, or choose all jobs');
      await ensureJobKeys(true);
      const id = uuid();
      payload.id = id;
      payload.agent = { access: agent.access, all_jobs: !!agent.all_jobs, bundle: await buildAgentBundle(id, ids) };
    }
    const r = await api<{ key: any }>('POST', '/api/keys', { body: payload });
    return ok({ key: r.key, rawKey: k.fullKey, headerKey: k.headerKey });
  }],
];
void getJob;
