import * as C from '../crypto';
import { getSession, getJobKey } from '../session';
import { ExpenseView, JobView, getBlob, setBlob, listJobs, listExpenses, listAllExpenses, uuid } from '../store';
import { calculateTaxLiability, SCHEDULE_C_LINE_METADATA, ScheduleCLine, TaxYear, FilingStatus, EntityType } from '../../utils/taxCalculator';
import { Route, ok, bad, NotFound } from './types';

/**
 * Tax profile, W-2s, Schedule C mappings, the tax calculation and custom reports. All of this used to run on the server
 * over plaintext; it now runs here, in the browser, over data that only this browser can decrypt.
 */
const VALID_LINES = new Set<string>(Object.keys(SCHEDULE_C_LINE_METADATA));

const DEFAULT_SETTINGS = {
  tax_year: 2025, filing_status: 'single', entity_type: 'sole_proprietorship', scorp_officer_salary: 0, scorp_ein: null as string | null,
  state_code: 'TX', estimated_payments_made: 0, retirement_contributions: 0, business_miles: 0, vehicle_deduction_method: 'auto_best',
  home_office_sqft: 0, selected_job_ids: null as string[] | null, additional_gross_income: 0, returns_and_allowances: 0,
  cost_of_goods_sold: 0, self_employed_health_insurance: 0, prior_year_tax_liability: 0,
  q1_payment_made: 0, q2_payment_made: 0, q3_payment_made: 0, q4_payment_made: 0,
};
const NUMERIC_KEYS = ['scorp_officer_salary', 'estimated_payments_made', 'retirement_contributions', 'business_miles', 'home_office_sqft',
  'additional_gross_income', 'returns_and_allowances', 'cost_of_goods_sold', 'self_employed_health_insurance', 'prior_year_tax_liability',
  'q1_payment_made', 'q2_payment_made', 'q3_payment_made', 'q4_payment_made'] as const;

const loadSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await getBlob<any>('tax_settings', {})), user_id: getSession().userId });
interface TagLibrary { tags: Array<{ id: string; name: string; color: string }> }
interface Mappings { tags: Record<string, string>; expenses: Record<string, string> }
const loadMappings = async (): Promise<Mappings> => {
  const m = await getBlob<any>('tax_mappings', {});
  return { tags: { ...(m.tags || {}) }, expenses: { ...(m.expenses || {}) } };
};
const loadW2 = async (): Promise<any[]> => {
  const w = await getBlob<any>('w2_forms', []);
  return Array.isArray(w) ? w : [];
};
const dateOf = (e: ExpenseView) => String(e.date || e.created_at || '').slice(0, 10);

// Keyword heuristics (unchanged from the server implementation).
function keywordLine(text: string): string {
  if (/marketing|ad|promo|sponsor|website|seo/i.test(text)) return 'line_8_advertising';
  if (/gas|fuel|chevron|shell|exxon|oil change|auto repair|tire/i.test(text)) return 'line_9_vehicle';
  if (/stripe|paypal|square|processing fee|merchant fee|commission/i.test(text)) return 'line_10_commissions';
  if (/subcontractor|labor|developer|contractor/i.test(text)) return 'line_11_contract_labor';
  if (/insurance|geico|progressive|policy|liability/i.test(text)) return 'line_15_insurance';
  if (/legal|lawyer|cpa|accounting|tax prep|attorney/i.test(text)) return 'line_17_legal';
  if (/office|paper|ink|postage|software|slack|github|zoom/i.test(text)) return 'line_18_office';
  if (/rent|storage|lease|coworking/i.test(text)) return 'line_20_rent';
  if (/repair|maintenance|servicing/i.test(text)) return 'line_21_repairs';
  if (/supplies|materials|hardware|lumber|home depot|lowes/i.test(text)) return 'line_22_supplies';
  if (/permit|license|registration|city of|franchise tax/i.test(text)) return 'line_23_taxes';
  if (/flight|airline|hotel|airbnb|lodging|travel/i.test(text)) return 'line_24a_travel';
  if (/meal|dinner|lunch|breakfast|restaurant|food/i.test(text)) return 'line_24b_meals';
  if (/utility|phone|verizon|att|t-mobile|internet|electric|power/i.test(text)) return 'line_25_utilities';
  return 'line_27a_other';
}

const wrappedKeysFor = async (jobIds: string[]) => {
  const out: Record<string, string> = {};
  const { keys } = getSession();
  for (const id of jobIds) {
    const k = await getJobKey(id);
    if (k) out[id] = await C.wrapJobKeyForSelf(keys.mk, k);
  }
  return out;
};

const accessibleJobsSummary = (jobs: JobView[]) => jobs.map(j => ({
  id: j.id, title: j.title, is_archived: j.is_archived, mode: j.mode, start_date: j.start_date, end_date: j.end_date, invoice_tag: j.invoice_tag,
}));

export const taxRoutes: Route[] = [
  ['GET', /^\/api\/taxes\/profile$/, async ({ query }) => {
    const year = parseInt(query.get('year') || '', 10) || 2025;
    const settings = await loadSettings();
    const lib = await getBlob<TagLibrary>('tags', { tags: [] });
    const mappings = await loadMappings();
    const tags = lib.tags || [];
    return ok({
      settings,
      w2Forms: (await loadW2()).filter(w => Number(w.tax_year) === year),
      tagMappings: tags.filter(t => mappings.tags[t.id]).map(t => ({ tag_id: t.id, schedule_c_line: mappings.tags[t.id], tag_name: t.name, tag_color: t.color })),
      availableTags: [...tags].sort((a, b) => a.name.localeCompare(b.name)),
      accessibleJobs: accessibleJobsSummary((await listJobs()).filter(j => !j.locked)),
    });
  }],

  ['POST', /^\/api\/taxes\/profile$/, async ({ body }) => {
    const prev = await loadSettings();
    const next: any = { ...prev };
    const oneOf = (v: any, allowed: string[], field: string) => { if (!allowed.includes(v)) bad(`${field} is invalid`); return v; };
    if (body.filing_status !== undefined) next.filing_status = oneOf(body.filing_status, ['single', 'married_joint', 'married_separate', 'head_of_household'], 'filing_status');
    if (body.entity_type !== undefined) next.entity_type = oneOf(body.entity_type, ['sole_proprietorship', 'llc_single_member', 'llc_scorp'], 'entity_type');
    if (body.vehicle_deduction_method !== undefined) next.vehicle_deduction_method = oneOf(body.vehicle_deduction_method, ['auto_best', 'standard_mileage', 'actual_expenses'], 'vehicle_deduction_method');
    if (body.tax_year !== undefined) { const y = Number(body.tax_year); if (!(y >= 2000 && y <= 2100)) bad('tax_year is invalid'); next.tax_year = y; }
    if (body.scorp_ein !== undefined) next.scorp_ein = body.scorp_ein ? String(body.scorp_ein).slice(0, 20) : null;
    if (body.state_code !== undefined) next.state_code = String(body.state_code || '').slice(0, 2);
    for (const k of NUMERIC_KEYS) if (body[k] !== undefined) next[k] = Number(body[k]) || 0;
    if (body.selected_job_ids !== undefined) next.selected_job_ids = Array.isArray(body.selected_job_ids) ? body.selected_job_ids.filter((x: any) => typeof x === 'string').slice(0, 500) : null;
    next.updated_at = new Date().toISOString();
    delete next.user_id;
    await setBlob('tax_settings', next);
    return ok({ success: true, settings: await loadSettings() });
  }],

  // ── W-2 forms ──────────────────────────────────────────────────────────────
  ['POST', /^\/api\/taxes\/w2$/, async ({ body }) => {
    const employer = String(body.employer_name || '').trim();
    if (!employer) bad('Employer name is required');
    const all = await loadW2();
    const id = typeof body.id === 'string' && body.id ? body.id : uuid();
    const prev = all.find(w => w.id === id);
    const n = (v: any) => Number(v) || 0;
    const w2 = {
      id, user_id: getSession().userId, tax_year: n(body.tax_year) || 2025, employer_name: employer.slice(0, 200), employer_ein: body.employer_ein ? String(body.employer_ein).slice(0, 20) : null,
      is_scorp_officer_w2: body.is_scorp_officer_w2 ? 1 : 0, wages_box1: n(body.wages_box1), fed_withholding_box2: n(body.fed_withholding_box2),
      ss_wages_box3: n(body.ss_wages_box3), ss_withholding_box4: n(body.ss_withholding_box4), medicare_wages_box5: n(body.medicare_wages_box5),
      medicare_withholding_box6: n(body.medicare_withholding_box6), state_code: body.state_code ? String(body.state_code).slice(0, 2) : null,
      state_wages_box16: n(body.state_wages_box16), state_withholding_box17: n(body.state_withholding_box17), created_at: prev?.created_at || new Date().toISOString(),
    };
    await setBlob('w2_forms', [...all.filter(w => w.id !== id), w2]);
    return ok({ success: true, w2 });
  }],
  ['DELETE', /^\/api\/taxes\/w2\/([^/]+)$/, async ({ m }) => {
    const all = await loadW2();
    if (!all.some(w => w.id === m[1])) throw new NotFound('W-2 entry not found');
    await setBlob('w2_forms', all.filter(w => w.id !== m[1]));
    return ok();
  }],

  // ── Schedule C mappings ────────────────────────────────────────────────────
  ['GET', /^\/api\/taxes\/tag-mappings$/, async () => {
    const lib = await getBlob<TagLibrary>('tags', { tags: [] });
    const mp = await loadMappings();
    return ok((lib.tags || []).filter(t => mp.tags[t.id]).map(t => ({ tag_id: t.id, schedule_c_line: mp.tags[t.id], tag_name: t.name, tag_color: t.color })));
  }],
  ['POST', /^\/api\/taxes\/tag-mappings$/, async ({ body }) => {
    const lib = await getBlob<TagLibrary>('tags', { tags: [] });
    if (typeof body.tag_id !== 'string' || !VALID_LINES.has(body.schedule_c_line)) bad('A valid tag_id and schedule_c_line are required');
    if (!(lib.tags || []).some(t => t.id === body.tag_id)) throw new NotFound('Tag not found or unauthorized');
    const mp = await loadMappings();
    mp.tags[body.tag_id] = body.schedule_c_line;
    await setBlob('tax_mappings', mp);
    return ok({ success: true, tag_id: body.tag_id, schedule_c_line: body.schedule_c_line });
  }],
  ['POST', /^\/api\/taxes\/reassign-expense$/, async ({ body }) => {
    if (typeof body.expense_id !== 'string') bad('expense_id is required');
    const known = (await listAllExpenses()).some(e => e.id === body.expense_id);
    if (!known) throw new NotFound('Expense not found or unauthorized');
    const mp = await loadMappings();
    if (!body.schedule_c_line || body.schedule_c_line === 'auto') {
      delete mp.expenses[body.expense_id];
      await setBlob('tax_mappings', mp);
      return ok({ success: true, expense_id: body.expense_id, schedule_c_line: null, reverted_to_auto: true });
    }
    if (!VALID_LINES.has(body.schedule_c_line)) bad('Unknown Schedule C line');
    mp.expenses[body.expense_id] = body.schedule_c_line;
    await setBlob('tax_mappings', mp);
    return ok({ success: true, expense_id: body.expense_id, schedule_c_line: body.schedule_c_line });
  }],
  ['POST', /^\/api\/taxes\/reassign-expenses-batch$/, async ({ body }) => {
    const items = body.assignments;
    if (!Array.isArray(items) || items.length === 0 || items.length > 1000) bad('assignments must be a non-empty array');
    const known = new Set((await listAllExpenses()).map(e => e.id));
    const mp = await loadMappings();
    let updatedCount = 0;
    for (const it of items) {
      if (typeof it?.expense_id !== 'string' || !VALID_LINES.has(it.schedule_c_line) || !known.has(it.expense_id)) continue;
      mp.expenses[it.expense_id] = it.schedule_c_line; updatedCount++;
    }
    await setBlob('tax_mappings', mp);
    return ok({ success: true, updatedCount });
  }],

  ['GET', /^\/api\/taxes\/unclaimed-suggestions$/, async ({ query }) => {
    const year = parseInt(query.get('year') || '', 10) || 2025;
    const mp = await loadMappings();
    const jobs = (await listJobs()).filter(j => !j.locked);
    const titleOf = new Map(jobs.map(j => [j.id, j.title]));
    const candidates = (await listAllExpenses())
      .filter(e => e.entry_type === 'expense' && dateOf(e) >= `${year}-01-01` && dateOf(e) <= `${year}-12-31` && e.tags.length === 0 && !mp.expenses[e.id])
      .slice(0, 100);
    const rules: Array<[RegExp, string, string]> = [
      [/home depot|lowes|hardware|lumber|screws|nails|plumbing|paint/i, 'line_22_supplies', 'Keywords indicate direct job supplies & building materials.'],
      [/chevron|shell|exxon|bp|fuel|gas|speedway/i, 'line_9_vehicle', 'Gas station merchant matches vehicle & fuel write-off.'],
      [/stripe|paypal|square|merchant fee/i, 'line_10_commissions', 'Payment processing fees are 100% tax deductible.'],
      [/subcontractor|freelance|labor|helper/i, 'line_11_contract_labor', 'Contract labor write-off for non-employee hired help.'],
      [/zoom|slack|github|digitalocean|aws|software|subscription/i, 'line_18_office', 'Software and modern cloud business subscriptions qualify under office expenses.'],
      [/flight|airline|hotel|airbnb/i, 'line_24a_travel', 'Travel transportation or lodging while away for business.'],
      [/dinner|lunch|bistro|cafe|grill|restaurant/i, 'line_24b_meals', 'Client meals qualify for a 50% IRS tax deduction.'],
    ];
    const suggestions = [];
    for (const e of candidates) {
      const rule = rules.find(([rx]) => rx.test((e.description || '').toLowerCase()));
      if (!rule) continue;
      const meta = SCHEDULE_C_LINE_METADATA[rule[1] as ScheduleCLine];
      suggestions.push({
        expenseId: e.id, description: e.description, amount: e.amount, date: e.date, jobTitle: titleOf.get(e.job_id) ?? '',
        suggestedLine: rule[1], lineTitle: meta?.title || rule[1], reason: rule[2], estimatedTaxSavings: Math.round(e.amount * 0.35 * 100) / 100,
      });
    }
    return ok({ suggestions });
  }],

  // ── Tax calculation ────────────────────────────────────────────────────────
  ['GET', /^\/api\/taxes\/calculate$/, async ({ query }) => {
    const settings = await loadSettings();
    const requested = parseInt(query.get('year') || '', 10);
    const taxYear = (requested || settings.tax_year || 2025) as TaxYear;
    const mappings = await loadMappings();

    const allJobs = (await listJobs()).filter(j => !j.locked);
    const selected = Array.isArray(settings.selected_job_ids) && settings.selected_job_ids.length > 0 ? new Set(settings.selected_job_ids) : null;
    const jobs = selected ? allJobs.filter(j => selected.has(j.id)) : allJobs;

    let grossBusinessIncome = 0;
    const expensesByLine: Record<string, { total: number; count: number }> = Object.create(null); // null prototype: "__proto__" is just a key
    const vehicle = { gas: 0, maintenance: 0, insurance: 0, parkingAndTolls: 0 };
    const transactions: any[] = [];
    const breakdown = new Map<string, { jobTitle: string; income: number; expenses: number; count: number; receiptsCount: number }>();
    let totalReceiptsCount = 0;

    for (const job of jobs) {
      for (const e of await listExpenses(job.id)) {
        const d = dateOf(e);
        if (d < `${taxYear}-01-01` || d > `${taxYear}-12-31`) continue;
        const eTags = e.tags.map(t => ({ ...t, schedule_c_line: mappings.tags[t.id] || null }));
        const hasReceipt = Boolean(e.receipt_url);
        if (hasReceipt) totalReceiptsCount++;
        if (!breakdown.has(job.id)) breakdown.set(job.id, { jobTitle: job.title, income: 0, expenses: 0, count: 0, receiptsCount: 0 });
        const stats = breakdown.get(job.id)!;
        stats.count++; if (hasReceipt) stats.receiptsCount++;
        const base = { ...e, job_title: job.title, job_is_archived: job.is_archived, job_invoice_tag: job.invoice_tag, job_invoice_number: job.invoice_number, tags: eTags };

        if (e.entry_type === 'income') {
          grossBusinessIncome += e.amount; stats.income += e.amount;
          transactions.push({ ...base, assigned_schedule_c_line: null, is_manually_assigned: false });
          continue;
        }
        stats.expenses += e.amount;
        let line: string | null = null; let manual = false;
        const override = mappings.expenses[e.id];
        if (override && VALID_LINES.has(override)) { line = override; manual = true; }
        if (!line) line = eTags.find(t => t.schedule_c_line && VALID_LINES.has(t.schedule_c_line))?.schedule_c_line ?? null;
        if (!line) line = keywordLine(`${e.description || ''} ${eTags.map(t => t.name).join(' ')}`.toLowerCase());

        (expensesByLine[line] ||= { total: 0, count: 0 });
        expensesByLine[line].total += e.amount; expensesByLine[line].count += 1;
        if (line === 'line_9_vehicle') {
          const desc = (e.description || '').toLowerCase();
          if (/toll|parking|meter|garage/i.test(desc)) vehicle.parkingAndTolls += e.amount;
          else if (/insurance/i.test(desc)) vehicle.insurance += e.amount;
          else if (/repair|maint|tire|oil|service/i.test(desc)) vehicle.maintenance += e.amount;
          else vehicle.gas += e.amount;
        }
        transactions.push({ ...base, assigned_schedule_c_line: line, is_manually_assigned: manual });
      }
    }
    transactions.sort((a, b) => dateOf(b).localeCompare(dateOf(a)));

    const w2Forms = (await loadW2()).filter(w => Number(w.tax_year) === taxYear).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const calculation = calculateTaxLiability({
      taxYear, filingStatus: settings.filing_status as FilingStatus, entityType: settings.entity_type as EntityType,
      scorpOfficerSalary: Number(settings.scorp_officer_salary) || 0, w2Forms, grossBusinessIncome,
      additionalGrossIncome: Number(settings.additional_gross_income) || 0, returnsAndAllowances: Number(settings.returns_and_allowances) || 0,
      costOfGoodsSold: Number(settings.cost_of_goods_sold) || 0, expensesByLine, businessMiles: Number(settings.business_miles) || 0,
      vehicleMethod: (settings.vehicle_deduction_method || 'auto_best') as any, homeOfficeSqft: Number(settings.home_office_sqft) || 0,
      actualVehicleReceipts: vehicle, selfEmployedHealthInsurance: Number(settings.self_employed_health_insurance) || 0,
      priorYearTaxLiability: Number(settings.prior_year_tax_liability) || 0, estimatedPaymentsMade: Number(settings.estimated_payments_made) || 0,
      retirementContributions: Number(settings.retirement_contributions) || 0,
      quarterlyPaymentsMade: { q1: Number(settings.q1_payment_made) || 0, q2: Number(settings.q2_payment_made) || 0, q3: Number(settings.q3_payment_made) || 0, q4: Number(settings.q4_payment_made) || 0 },
    } as any);

    return ok({
      success: true, calculation,
      jobsIncluded: jobs.map(j => ({ id: j.id, title: j.title, is_archived: j.is_archived, mode: j.mode, client_name: j.client_name, invoice_number: j.invoice_number, invoice_tag: j.invoice_tag })),
      jobBreakdown: [...breakdown.entries()].map(([jobId, s]) => ({ jobId, ...s, netProfit: s.income - s.expenses })),
      transactions, totalReceiptsCount, jobKeys: await wrappedKeysFor(jobs.map(j => j.id)),
    });
  }],

  // ── Custom reports ─────────────────────────────────────────────────────────
  ['POST', /^\/api\/reports\/custom$/, async ({ body }) => {
    const { jobIds, tagIds, jobTags, startDate, endDate, entryType = 'all', includeArchived = false, minAmount, maxAmount, hasReceiptOnly = false } = body || {};
    let jobs = (await listJobs()).filter(j => !j.locked);
    if (!includeArchived) jobs = jobs.filter(j => !j.is_archived);
    if (Array.isArray(jobIds) && jobIds.length > 0) jobs = jobs.filter(j => jobIds.includes(j.id));
    if (Array.isArray(jobTags) && jobTags.length > 0) jobs = jobs.filter(j => j.invoice_tag && jobTags.includes(j.invoice_tag));

    const empty = (jobCount = 0) => ({
      summary: { totalIncome: 0, totalExpense: 0, net: 0, transactionCount: 0, receiptCount: 0, jobCount, timeWindowStart: startDate || null, timeWindowEnd: endDate || null },
      categoryBreakdown: [], jobBreakdown: [], transactions: [], jobKeys: {},
    });
    if (jobs.length === 0) return ok(empty());

    const jobMap = new Map(jobs.map(j => [j.id, j]));
    const finite = (v: any) => v !== undefined && v !== null && v !== '' && !isNaN(Number(v));
    let expenses = (await Promise.all(jobs.map(j => listExpenses(j.id)))).flat()
      .filter(e => (!startDate || dateOf(e) >= String(startDate)) && (!endDate || dateOf(e) <= String(endDate)))
      .filter(e => (entryType === 'expense' || entryType === 'income' ? e.entry_type === entryType : true))
      .filter(e => (finite(minAmount) ? e.amount >= Number(minAmount) : true) && (finite(maxAmount) ? e.amount <= Number(maxAmount) : true))
      .filter(e => (hasReceiptOnly ? !!e.receipt_url : true))
      .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
    if (Array.isArray(tagIds) && tagIds.length > 0) expenses = expenses.filter(e => e.tags.some(t => tagIds.includes(t.id)));

    const rows = expenses.map(e => {
      const j = jobMap.get(e.job_id);
      return { ...e, job_title: j?.title || 'Unknown Job', invoice_number: j?.invoice_number || null, invoice_tag: j?.invoice_tag || null, client_name: j?.client_name || null };
    });

    let totalIncome = 0, totalExpense = 0, receiptCount = 0;
    const cat = new Map<string, { tagId: string; name: string; color: string; total: number; count: number }>();
    const agg = new Map(jobs.map(j => [j.id, { jobId: j.id, title: j.title, invoice_number: j.invoice_number || '', invoice_tag: j.invoice_tag || '', client_name: j.client_name || '', income: 0, expense: 0, net: 0, transactionCount: 0, receiptCount: 0 }]));
    for (const e of rows) {
      const amt = Number(e.amount) || 0; const income = e.entry_type === 'income';
      income ? (totalIncome += amt) : (totalExpense += amt);
      if (e.receipt_url) receiptCount++;
      const a = agg.get(e.job_id);
      if (a) { income ? (a.income += amt) : (a.expense += amt); a.net = a.income - a.expense; a.transactionCount++; if (e.receipt_url) a.receiptCount++; }
      const labels = e.tags.length ? e.tags : [{ id: 'untagged', name: 'Untagged', color: '#6b7280' }];
      for (const t of labels) {
        const c = cat.get(t.id) || { tagId: t.id, name: t.name, color: t.color, total: 0, count: 0 };
        c.total += amt; c.count++; cat.set(t.id, c);
      }
    }
    return ok({
      summary: {
        totalIncome, totalExpense, net: totalIncome - totalExpense, transactionCount: rows.length, receiptCount, jobCount: jobs.length,
        timeWindowStart: startDate || (rows.length ? dateOf(rows[rows.length - 1]) : null), timeWindowEnd: endDate || (rows.length ? dateOf(rows[0]) : null),
      },
      categoryBreakdown: [...cat.values()].sort((a, b) => b.total - a.total),
      jobBreakdown: [...agg.values()].filter(j => j.transactionCount > 0 || (Array.isArray(jobIds) && jobIds.includes(j.jobId))).sort((a, b) => b.expense - a.expense),
      transactions: rows, jobKeys: await wrappedKeysFor(jobs.map(j => j.id)),
    });
  }],
];
