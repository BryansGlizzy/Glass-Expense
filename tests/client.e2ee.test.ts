import './shim.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { BASE, call } from './helpers.ts';
import { installE2eeRouter } from '../src/e2ee/router.ts';
import { register, loginWithPassword } from '../src/e2ee/auth.ts';
import { setSession, getSession, api } from '../src/e2ee/session.ts';
import { approveMember, listMembersNeedingKey } from '../src/e2ee/members.ts';
import { runDueSubscriptions } from '../src/e2ee/subscriptions.ts';
import * as C from '../src/e2ee/crypto.ts';
import * as legacy from '../src/utils/crypto.ts';

const DATA_DIR = process.env.DATA_DIR!;
let passed = 0;
const t = async (name: string, fn: () => Promise<void>) => { try { await fn(); passed++; console.log('PASS ', name); } catch (e: any) { console.log('FAIL ', name, '\n      ', (e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); process.exitCode = 1; } };

// Pages call fetch('/api/...') with their own Authorization header; the router ignores it and uses the vault session.
const page = async (method: string, path: string, body?: any) => {
  const init: any = { method, headers: { Authorization: 'Bearer ignored' } };
  if (body instanceof FormData) init.body = body; else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(path, init);
  let json: any = null; try { json = await res.clone().json(); } catch {}
  return { status: res.status, json, res };
};

installE2eeRouter();
const mkUser = async (name: string) => {
  const mnemonic = C.generateMnemonic();
  const out = await register({ username: name, email: `${name}@example.com`, password: 'correct horse battery staple', mnemonic });
  return { name, out, session: { ...getSession() } };
};
const as = (u: Awaited<ReturnType<typeof mkUser>>) => setSession({ ...u.session });

// The crypto module uses 600k PBKDF2 iterations in production; the server enforces a minimum, so tests lower both.
(C as any).KDF_ITERATIONS; // (server runs with KDF_MIN_ITERATIONS=1000; registration here uses the production constant - fine, just slower)

const owner = await mkUser('owner1');
const member = await mkUser('member1');
const outsider = await mkUser('outsider1');
as(owner);

let jobId = '', tagId = '', expId = '';
await t('page API: tags + job creation return the old plaintext shapes (server only holds ciphertext)', async () => {
  const tag = await page('POST', '/api/tags', { name: 'Materials', color: '#ef4444' });
  assert.equal(tag.status, 200); tagId = tag.json.id; assert.equal(tag.json.name, 'Materials');
  assert.equal((await page('POST', '/api/tags', { name: 'x', color: 'red' })).status, 400);
  const job = await page('POST', '/api/jobs', { title: 'Riverside Deck', description: 'Cedar deck build', mode: 'expense', start_date: '2026-11-03', end_date: '2026-11-09', invoice_tag: 'DECK', client_name: 'Pat Doe' });
  assert.equal(job.status, 200, JSON.stringify(job.json));
  jobId = job.json.id;
  assert.equal(job.json.title, 'Riverside Deck'); assert.equal(job.json.invoice_number, 'DECK-A00001'); assert.equal(job.json.created_by, owner.out.user.id);
  const job2 = await page('POST', '/api/jobs', { title: 'Second', invoice_tag: 'DECK' });
  assert.equal(job2.json.invoice_number, 'DECK-A00002', 'rolling invoice numbers are allocated client-side');
  assert.equal((await page('POST', '/api/jobs', { title: 'dup', invoice_number: 'DECK-A00001' })).status, 400);
  const next = await page('GET', '/api/jobs/next-invoice-number?tag=DECK');
  assert.equal(next.json.invoiceNumber, 'DECK-A00003');
  assert.equal((await page('POST', '/api/jobs', { title: '' })).status, 400);
});

await t('expenses: multipart create (with encrypted receipt), list, tags, income, delete', async () => {
  const jk = (await page('GET', `/api/jobs/${jobId}/keys`)).json.key;
  const raw = await legacy.unwrapKey(jk, await legacy.importEncryptionKey(C.toB64(getSession().keys.masterKey))); // exactly what Job.tsx does
  const f = new FormData();
  f.append('amount', '250.75'); f.append('description', 'Cedar boards'); f.append('entry_type', 'expense'); f.append('date', '2026-11-04'); f.append('tags', JSON.stringify([tagId]));
  const file = new File([new TextEncoder().encode('receipt image bytes')], 'r.jpg', { type: 'image/jpeg' });
  f.append('receipt', await legacy.encryptFile(file, raw), 'r.enc'); f.append('is_encrypted', 'true');
  const e = await page('POST', `/api/jobs/${jobId}/expenses`, f);
  assert.equal(e.status, 200, JSON.stringify(e.json)); expId = e.json.id;
  assert.equal(e.json.amount, 250.75); assert.equal(e.json.tags[0].name, 'Materials'); assert.equal(e.json.is_encrypted, 1); assert.match(e.json.receipt_url, /^\/uploads\//);

  const inc = new FormData(); inc.append('amount', '5000'); inc.append('description', 'Client payment'); inc.append('entry_type', 'income'); inc.append('date', '2026-11-05');
  assert.equal((await page('POST', `/api/jobs/${jobId}/expenses`, inc)).status, 200);

  // A plaintext file handed over by a careless caller is encrypted by the layer before upload.
  const plain = new FormData(); plain.append('amount', '1'); plain.append('description', 'plain receipt'); plain.append('receipt', new File([new TextEncoder().encode('PLAINTEXT-RECEIPT-MARKER')], 'p.png', { type: 'image/png' }));
  assert.equal((await page('POST', `/api/jobs/${jobId}/expenses`, plain)).status, 200);

  const list = await page('GET', `/api/jobs/${jobId}/expenses`);
  assert.equal(list.json.length, 3); assert.equal(list.json.find((x: any) => x.id === expId).description, 'Cedar boards');

  // Receipt download goes through the authenticated endpoint and decrypts with the job key like before.
  const dl = await fetch(e.json.receipt_url);
  assert.equal(dl.status, 200);
  const dec = await legacy.decryptFile(new Blob([await dl.arrayBuffer()]), raw, 'image/jpeg');
  assert.equal(new TextDecoder().decode(await dec.arrayBuffer()), 'receipt image bytes');

  const jobs = (await page('GET', '/api/jobs')).json;
  const j = jobs.find((x: any) => x.id === jobId);
  assert.equal(j.total_income, 5000); assert.equal(Math.round(j.total_expenses * 100) / 100, 251.75);

  const retag = await page('PUT', `/api/jobs/${jobId}/expenses/${expId}/tags`, { tags: [] });
  assert.equal(retag.json.tags.length, 0);
  assert.equal((await page('DELETE', `/api/jobs/${jobId}/expenses/${list.json.find((x: any) => x.description === 'plain receipt').id}`)).status, 200);
});

await t('job edits: PATCH merges, retags invoice number, keeps calendar title in sync', async () => {
  const p = await page('PATCH', `/api/jobs/${jobId}`, { title: 'Riverside Deck (Phase 2)', client_email: 'pat@example.com' });
  assert.equal(p.status, 200); assert.equal(p.json.title, 'Riverside Deck (Phase 2)'); assert.equal(p.json.client_name, 'Pat Doe');
  const re = await page('PATCH', `/api/jobs/${jobId}`, { invoice_tag: 'PATIO' });
  assert.equal(re.json.invoice_number, 'PATIO-A00001');
  const sched = await call('GET', '/api/calendar/schedule', { token: getSession().token });
  const mine = sched.json.jobs.find((x: any) => x.id === jobId);
  assert.equal(await C.decryptCalendarTitle(getSession().keys.calendarKey, jobId, mine.title), 'Riverside Deck (Phase 2)');
  assert.equal((await page('PATCH', `/api/jobs/${jobId}/archive`, { is_archived: true })).status, 200);
  assert.equal((await page('GET', '/api/jobs')).json.find((x: any) => x.id === jobId).is_archived, 1);
  await page('PATCH', `/api/jobs/${jobId}/archive`, { is_archived: false });
});

await t('wishlist, conversion to expense, subscriptions and client-side recurring generation', async () => {
  const w = await page('POST', `/api/jobs/${jobId}/wishlist`, { name: 'Router bits', estimated_cost: 42.5, url: 'https://example.com/x', notes: 'carbide' });
  assert.equal(w.json.name, 'Router bits');
  assert.equal((await page('POST', `/api/jobs/${jobId}/wishlist`, { name: 'bad', url: 'javascript:alert(1)' })).status, 400);
  const conv = await page('POST', `/api/jobs/${jobId}/wishlist/${w.json.id}/convert`);
  assert.equal(conv.json.expense.amount, 42.5); assert.equal((await page('GET', `/api/jobs/${jobId}/wishlist`)).json.length, 0);

  const sub = await page('POST', `/api/jobs/${jobId}/subscriptions`, { amount: 19.99, description: 'CAD software', billing_day: 15, frequency: 'MONTHLY', remind_1_day_before: 1 });
  assert.equal(sub.status, 200);
  const subs = (await page('GET', `/api/jobs/${jobId}/subscriptions`)).json;
  assert.equal(subs[0].description, 'CAD software'); assert.equal(subs[0].amount, 19.99);
  // Make it due in the past, then run the generator the app runs on login (twice: must be idempotent).
  const key = (await page('GET', `/api/jobs/${jobId}/keys`)).json.key;
  const jobKey = await C.unwrapJobKeyForSelf(getSession().keys.mk, key);
  await api('PUT', `/api/v2/jobs/${jobId}/subscriptions/${subs[0].id}`, { body: {
    enc: await C.encryptJson(jobKey, { amount: 19.99, description: 'CAD software', entry_type: 'expense', billing_day: 15, frequency: 'MONTHLY', last_generated_at: null }, C.aad.subscription(jobId, subs[0].id)),
    next_generation_date: '2026-09-15', remind_1_day_before: 1 } });
  const before = (await page('GET', `/api/jobs/${jobId}/expenses`)).json.length;
  const made = await runDueSubscriptions();
  assert.ok(made >= 1, `generated ${made}`);
  await runDueSubscriptions();
  const after = (await page('GET', `/api/jobs/${jobId}/expenses`)).json;
  assert.equal(after.length, before + made);
  assert.ok(after.some((x: any) => /CAD software \(Auto-generated\)/.test(x.description)));
  assert.equal((await page('DELETE', `/api/jobs/${jobId}/subscriptions/${subs[0].id}`)).status, 200);
});

await t('tax: profile, W-2, calculation, Schedule C overrides, prototype-pollution guard, suggestions', async () => {
  assert.equal((await page('POST', '/api/taxes/profile', { tax_year: 2026, filing_status: 'single', entity_type: 'sole_proprietorship', business_miles: 100 })).status, 200);
  assert.equal((await page('POST', '/api/taxes/profile', { filing_status: 'martian' })).status, 400);
  const w2 = await page('POST', '/api/taxes/w2', { tax_year: 2026, employer_name: 'ACME Corp', wages_box1: 30000, fed_withholding_box2: 2500 });
  assert.equal(w2.status, 200);
  const profile = await page('GET', '/api/taxes/profile?year=2026');
  assert.equal(profile.json.w2Forms.length, 1); assert.equal(profile.json.availableTags[0].name, 'Materials'); assert.equal(profile.json.settings.business_miles, 100);

  const calc = await page('GET', '/api/taxes/calculate?year=2026');
  assert.equal(calc.status, 200, JSON.stringify(calc.json).slice(0, 200));
  assert.ok(calc.json.calculation); assert.ok(calc.json.transactions.length >= 3); assert.ok(calc.json.jobKeys[jobId]);
  const boards = calc.json.transactions.find((x: any) => x.id === expId);
  assert.equal(boards.is_manually_assigned, false);
  assert.ok(boards.assigned_schedule_c_line.startsWith('line_'));
  assert.equal((await page('POST', '/api/taxes/reassign-expense', { expense_id: expId, schedule_c_line: 'line_18_office' })).status, 200);
  assert.equal((await page('GET', '/api/taxes/calculate?year=2026')).json.transactions.find((x: any) => x.id === expId).assigned_schedule_c_line, 'line_18_office');
  assert.equal((await page('POST', '/api/taxes/reassign-expense', { expense_id: expId, schedule_c_line: '__proto__' })).status, 400);
  assert.equal((await page('POST', '/api/taxes/reassign-expense', { expense_id: 'not-mine', schedule_c_line: 'line_18_office' })).status, 404);
  assert.equal(({} as any).total, undefined, 'Object.prototype was not polluted');
  assert.equal((await page('POST', '/api/taxes/reassign-expense', { expense_id: expId, schedule_c_line: 'auto' })).json.reverted_to_auto, true);
  assert.equal((await page('POST', '/api/taxes/tag-mappings', { tag_id: tagId, schedule_c_line: 'line_22_supplies' })).status, 200);
  assert.equal((await page('GET', '/api/taxes/tag-mappings')).json[0].tag_name, 'Materials');
  const sugg = await page('GET', '/api/taxes/unclaimed-suggestions?year=2026');
  assert.ok(Array.isArray(sugg.json.suggestions));
  assert.equal((await page('DELETE', `/api/taxes/w2/${w2.json.w2.id}`)).status, 200);
});

await t('custom report: totals, category and job breakdown match the data', async () => {
  const r = await page('POST', '/api/reports/custom', { startDate: '2026-11-01', endDate: '2026-11-30', includeArchived: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.summary.totalIncome, 5000); assert.ok(r.json.summary.totalExpense > 250);
  assert.ok(r.json.categoryBreakdown.length >= 1); assert.equal(r.json.jobBreakdown[0].jobId, jobId);
  assert.ok(r.json.transactions.every((x: any) => x.job_title));
  const onlyIncome = await page('POST', '/api/reports/custom', { entryType: 'income', includeArchived: true });
  assert.equal(onlyIncome.json.transactions.length, 1);
});

await t('export + import round trip; invoice template and AI settings live in the encrypted vault', async () => {
  const ex = await page('GET', `/api/jobs/${jobId}/export`);
  assert.equal(ex.json.job_title, 'Riverside Deck (Phase 2)'); assert.ok(ex.json.expenses.length >= 2);
  const imp = await page('POST', `/api/jobs/${jobId}/import`, { expenses: [{ amount: 12, description: 'Imported thing', entry_type: 'expense', date: '2026-11-06', tags: ['materials'] }] });
  assert.equal(imp.json.count, 1);
  assert.ok((await page('GET', `/api/jobs/${jobId}/expenses`)).json.some((x: any) => x.description === 'Imported thing' && x.tags[0]?.name === 'Materials'));

  assert.equal((await page('POST', '/api/invoice-templates', { company_name: 'Doe Decks LLC', default_prefix: 'doe', company_logo_url: 'javascript:1' })).status, 400);
  const tpl = await page('POST', '/api/invoice-templates', { company_name: 'Doe Decks LLC', default_prefix: 'doe' });
  assert.equal(tpl.json.template.default_prefix, 'DOE');
  assert.equal((await page('GET', '/api/invoice-templates')).json.company_name, 'Doe Decks LLC');
  assert.equal((await page('GET', '/api/jobs/next-invoice-number')).json.invoiceNumber.startsWith('DOE-'), true, 'template prefix is used');

  await page('POST', '/api/settings/ai', { ai_api_key: 'sk-super-secret-provider-key', ai_base_url: 'https://api.openai.com/v1', ai_model: 'gpt-4o-mini' });
  const ai = await page('GET', '/api/settings/ai');
  assert.equal(ai.json.ai_api_key, 'sk-super-secret-provider-key'); assert.equal(ai.json.ai_api_key_set, true);
});

await t('API key flow end-to-end: key created in the browser layer, calendar titles decrypted by the caller', async () => {
  // API keys are a paid-plan feature in SaaS mode; give this test user the pro plan.
  const w = new Database(`${DATA_DIR}/data.db`); w.prepare("UPDATE users SET plan = 'pro' WHERE username = 'owner1'").run(); w.close();
  const k = await page('POST', '/api/keys', { name: 'portfolio site' });
  assert.equal(k.status, 200); const [headerKey, decryptPart] = k.json.rawKey.split('.');
  const sched = await call('GET', '/api/calendar/schedule', { apiKey: headerKey });
  assert.equal(sched.status, 200);
  const cal = await C.unwrapCalendarKeyWithApiKey(sched.json.wrapped_calendar_key, decryptPart);
  const titles = await Promise.all(sched.json.jobs.map((j: any) => C.decryptCalendarTitle(cal, j.id, j.title)));
  assert.ok(titles.includes('Riverside Deck (Phase 2)'));
  assert.equal((await call('GET', '/api/v2/jobs', { apiKey: headerKey })).status, 403);
});

await t('sharing: invite token → pending → owner verifies fingerprint & approves → member reads through the normal page API', async () => {
  const inv = await page('POST', `/api/jobs/${jobId}/invites`);
  assert.equal(inv.status, 200);
  as(member);
  const joined = await page('POST', '/api/jobs/join', { token: inv.json.token });
  assert.equal(joined.status, 200); assert.equal(joined.json.pending, true);
  assert.equal((await page('GET', `/api/jobs/${jobId}/expenses`)).json.length, 0, 'pending member sees nothing');
  as(owner);
  const needing = await listMembersNeedingKey(jobId);
  assert.equal(needing.length, 1); assert.equal(needing[0].user_id, member.out.user.id);
  await assert.rejects(approveMember(jobId, needing[0], 'AAAA-BBBB-CCCC-DDDD-EEEE'), /Fingerprint mismatch/);
  await approveMember(jobId, needing[0], needing[0].fingerprint);
  as(member);
  const jobs = (await page('GET', '/api/jobs')).json;
  assert.equal(jobs.find((j: any) => j.id === jobId).title, 'Riverside Deck (Phase 2)');
  const ex = (await page('GET', `/api/jobs/${jobId}/expenses`)).json;
  assert.ok(ex.some((x: any) => x.description === 'Client payment'));
  // The member's client uploads their own calendar label, so the calendar API shows the title for a job they were invited into.
  const memberSchedule = await call('GET', '/api/calendar/schedule', { token: getSession().token });
  const theirs = memberSchedule.json.jobs.find((x: any) => x.id === jobId);
  assert.equal(await C.decryptCalendarTitle(getSession().keys.calendarKey, jobId, theirs.title), 'Riverside Deck (Phase 2)');
  assert.equal((await page('PATCH', `/api/jobs/${jobId}`, { title: 'hijack' })).status, 403, 'members cannot edit the job');
  assert.equal((await page('GET', `/api/jobs/${jobId}/members`)).status, 200);
  // The member's own tax view includes the shared job; their mappings are theirs alone.
  assert.ok((await page('GET', '/api/taxes/calculate?year=2026')).json.transactions.length >= 2);
  as(outsider);
  assert.equal((await page('GET', `/api/jobs/${jobId}/expenses`)).json.length, 0);
  assert.equal((await page('GET', `/api/jobs/${jobId}`)).status, 404);
  as(owner);
  assert.equal((await page('DELETE', `/api/jobs/${jobId}/members/${member.out.user.id}`)).status, 200);
  as(member);
  assert.equal((await page('GET', `/api/jobs/${jobId}`)).status, 404, 'removed member loses access immediately');
  as(owner);
});

await t('v2 login on a fresh device restores the same vault (password → keys → decrypts existing data)', async () => {
  setSession(null);
  const again = await loginWithPassword('owner1', 'correct horse battery staple');
  assert.equal(again.legacy, false);
  const jobs = (await page('GET', '/api/jobs')).json;
  assert.ok(jobs.some((j: any) => j.title === 'Riverside Deck (Phase 2)'));
  setSession(null);
  await assert.rejects(loginWithPassword('owner1', 'wrong wrong wrong wrong'));
  assert.equal((await page('GET', '/api/jobs')).status, 401, 'no vault session => locked, nothing is served');
  await loginWithPassword('owner1', 'correct horse battery staple');
});

await t('nothing the users stored is readable in the database or upload directory', async () => {
  const db = new Database(`${DATA_DIR}/data.db`); db.pragma('wal_checkpoint(TRUNCATE)'); db.close();
  const bytes = fs.readFileSync(`${DATA_DIR}/data.db`).toString('latin1');
  const needles = ['Riverside Deck', 'Cedar', 'Pat Doe', 'pat@example.com', 'Materials', 'ACME Corp', 'Doe Decks', 'sk-super-secret', 'CAD software', 'Router bits', 'Client payment', 'Imported thing', 'correct horse battery'];
  for (const n of needles) assert.ok(!bytes.includes(n), `plaintext found in database: ${n}`);
  for (const f of fs.readdirSync(`${DATA_DIR}/uploads`)) {
    const b = fs.readFileSync(`${DATA_DIR}/uploads/${f}`).toString('latin1');
    assert.ok(!b.includes('PLAINTEXT-RECEIPT-MARKER') && !b.includes('receipt image bytes'), `plaintext receipt on disk: ${f}`);
  }
});

console.log(`\n${passed} client E2EE tests passed`);
process.exit(process.exitCode || 0);
