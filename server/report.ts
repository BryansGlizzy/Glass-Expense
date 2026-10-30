/**
 * Builds the figures for an emailed report from a client-built snapshot.
 *
 * The snapshot is the ONLY thing the server ever reads for reports, and only for users who opted in. It contains
 * aggregates (per day / job / category totals), never individual expenses, notes, clients or receipts. Because
 * entries are created in the user's own browser, the snapshot is refreshed there whenever data changes or the app opens.
 */
export interface ReportSnapshot {
  v: 1;
  generated_at: string;
  include_job_names: boolean;
  include_category_names: boolean;
  jobs: string[];
  cats: string[];
  /** [YYYY-MM-DD, jobIndex, categoryIndex (-1 = untagged), income, expense, entryCount] */
  rows: Array<[string, number, number, number, number, number]>;
}

export interface JobFigures { name: string; income: number; expense: number; net: number; entries: number; prevNet: number }
export interface BuiltReport {
  windowStart: string; windowEnd: string; days: number;
  totals: { income: number; expense: number; net: number; entries: number };
  previous: { income: number; expense: number; net: number };
  jobs: JobFigures[];
  winners: JobFigures[];          // best positive net, highest first
  lossLeaders: JobFigures[];      // negative net, worst first
  categories: Array<{ name: string; expense: number }>;
  generatedAt: string;
  staleDays: number;              // how old the snapshot is relative to the end of the window
}

export const FREQUENCY_DAYS: Record<string, number> = { WEEKLY: 7, BIWEEKLY: 14, MONTHLY: 30 };

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const shift = (d: Date, days: number) => new Date(d.getTime() + days * 86400000);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function isSnapshot(x: any): x is ReportSnapshot {
  return x && x.v === 1 && Array.isArray(x.jobs) && Array.isArray(x.cats) && Array.isArray(x.rows) && x.rows.length <= 50_000;
}

export function buildReport(snapshot: ReportSnapshot, days: number, now = new Date()): BuiltReport {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = shift(end, -(days - 1));
  const prevEnd = shift(start, -1);
  const prevStart = shift(prevEnd, -(days - 1));
  const [s, e, ps, pe] = [ymd(start), ymd(end), ymd(prevStart), ymd(prevEnd)];

  const jobs = snapshot.jobs.map(name => ({ name, income: 0, expense: 0, entries: 0, prevIncome: 0, prevExpense: 0 }));
  const cats = new Map<string, number>();
  const totals = { income: 0, expense: 0, entries: 0 };
  const previous = { income: 0, expense: 0 };

  for (const [date, j, c, income, expense, count] of snapshot.rows) {
    const job = jobs[j];
    if (!job) continue;
    if (date >= s && date <= e) {
      job.income += income; job.expense += expense; job.entries += count;
      totals.income += income; totals.expense += expense; totals.entries += count;
      if (expense > 0) {
        const name = c >= 0 && snapshot.cats[c] ? snapshot.cats[c] : (snapshot.include_category_names ? 'Untagged' : 'Uncategorised');
        cats.set(name, (cats.get(name) || 0) + expense);
      }
    } else if (date >= ps && date <= pe) {
      job.prevIncome += income; job.prevExpense += expense; previous.income += income; previous.expense += expense;
    }
  }

  const figures: JobFigures[] = jobs
    .filter(j => j.entries > 0 || j.prevIncome > 0 || j.prevExpense > 0)
    .map(j => ({ name: j.name, income: round2(j.income), expense: round2(j.expense), net: round2(j.income - j.expense), entries: j.entries, prevNet: round2(j.prevIncome - j.prevExpense) }));
  const active = figures.filter(j => j.entries > 0);

  const generated = new Date(snapshot.generated_at);
  return {
    windowStart: s, windowEnd: e, days,
    totals: { income: round2(totals.income), expense: round2(totals.expense), net: round2(totals.income - totals.expense), entries: totals.entries },
    previous: { income: round2(previous.income), expense: round2(previous.expense), net: round2(previous.income - previous.expense) },
    jobs: active.sort((a, b) => b.net - a.net),
    winners: active.filter(j => j.net > 0).sort((a, b) => b.net - a.net).slice(0, 3),
    lossLeaders: active.filter(j => j.net < 0).sort((a, b) => a.net - b.net).slice(0, 3),
    categories: [...cats.entries()].map(([name, expense]) => ({ name, expense: round2(expense) })).sort((a, b) => b.expense - a.expense).slice(0, 6),
    generatedAt: snapshot.generated_at,
    // Whole calendar days between the snapshot's day and the report's last day (not elapsed hours).
    staleDays: Number.isNaN(generated.getTime()) ? 0 : Math.max(0, Math.round((end.getTime() - Date.UTC(generated.getUTCFullYear(), generated.getUTCMonth(), generated.getUTCDate())) / 86400000)),
  };
}
