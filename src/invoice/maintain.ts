/**
 * Work the owner's browser does when the app opens (docs/INVOICING_PLAN.md §5.13, §5.16, constraint C17): the server cannot read the
 * user's settings, so anything created by an API key or an agent is finished here.
 *
 *   1. completes agent-made invoices (pending steps: defaults, terms swap)
 *   2. tracks the latest rate the website posted (for "Follow website rates")
 *   3. auto-drafts an ESTIMATE for each API-posted job that has none (deterministic id, so two devices cannot make two), assigning
 *      the job's invoice number first when the posting key could not
 *
 * Idempotent and best-effort: every step swallows its own errors so it can never block the app.
 */
import { listJobs, getBlob, deterministicUuid, type JobView } from '../e2ee/store';
import { invalidate } from '../e2ee/session';
import { loadInvoicingSettings, loadPackages, saveInvoicingSettings } from '../e2ee/handlers/invoicing';
import { listInvoices } from '../e2ee/handlers/invoices';
import { api } from '../e2ee/session';
import * as C from '../e2ee/crypto';
import { applyPending, needsPending } from './pending';
import { buildNewInvoice } from './prefill';
import { parseIntakeText } from './intake';
import { addEvent, withGe } from './ge';
import { buildBrief, buildDraftMessages, parseDraft, applyDraft, medianBilledHours } from './aiDraft';
import { profileFor } from './aiSettings';
import { normalizeInvoice } from './normalize';
import { getSession } from '../e2ee/session';

let ranFor: string | null = null;

async function aiHoursFor(inv: ReturnType<typeof normalizeInvoice>, job: JobView, packages: Awaited<ReturnType<typeof loadPackages>>, past: ReturnType<typeof normalizeInvoice>[], hourly: number) {
  const ai = await getBlob<any>('ai_settings', {});
  const profile = profileFor(ai, 'drafting');
  if (!profile) return inv;
  const intake = job.intake ?? parseIntakeText(job.description);
  if (!intake.services.length && !intake.symptoms) return inv;
  const brief = buildBrief(intake, { packages, medianHours: medianBilledHours(past, intake.services[0] || '') });
  const out = await api<{ content: string }>('POST', '/api/ai/complete', { body: { profile, messages: buildDraftMessages(brief), json: true } });
  return applyDraft(inv, parseDraft(out.content, { partsPolicy: intake.partsPolicy }), hourly, profile.model);
}

export async function maintainInvoices(force = false): Promise<{ completed: number; drafted: number }> {
  const result = { completed: 0, drafted: 0 };
  let session; try { session = getSession(); } catch { return result; }
  if (!force && ranFor === session.userId) return result;
  ranFor = session.userId;

  try {
    const settings = await loadInvoicingSettings();
    const records = await listInvoices();

    // 1. finish what agents started
    for (const r of records.filter(x => x.can_edit && needsPending(x.invoice))) {
      try {
        await api('PUT', `/api/v2/invoices/${r.id}`, { body: { enc: await sealFor(r.job_id, r.id, applyPending(r.invoice, settings)), expected_rev: r.rev } });
        result.completed++;
      } catch { /* changed elsewhere: next open */ }
    }

    const jobs = (await listJobs()).filter(j => j.role === 'owner' && !j.locked && !j.is_archived);

    // 2. latest website quote
    const quoted = jobs.filter(j => j.intake?.quote && (j.intake.quote.hourlyRate != null || j.intake.quote.baseFee != null))
      .sort((a, b) => String(b.intake?.receivedAt || b.created_at).localeCompare(String(a.intake?.receivedAt || a.created_at)))[0];
    if (quoted?.intake?.quote) {
      const at = String(quoted.intake.receivedAt || quoted.created_at); const q = quoted.intake.quote; const cur = settings.rates.websiteQuote;
      if (!cur || at > cur.at) {
        settings.rates.websiteQuote = { hourlyRate: q.hourlyRate ?? null, baseFee: q.baseFee ?? null, variables: q.variables ?? {}, at };
        await saveInvoicingSettings(settings);
      }
    }

    // 3. auto-draft estimates for API-posted jobs
    if (settings.automation.autoDraft) {
      const have = new Set(records.map(r => r.job_id));
      const packages = await loadPackages();
      const past = records.map(r => r.invoice);
      let aiBudget = 3;
      for (const job0 of jobs.filter(j => j.intake?.source === 'api' && !have.has(j.id))) {
        try {
          let job = job0;
          if (!job.invoice_number) { // the posting key could not allocate a number: the app does (the existing allocator, owner only)
            await fetch(`/api/jobs/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' }, body: '{}' });
            invalidate('jobs'); job = (await listJobs()).find(j => j.id === job0.id) ?? job0;
          }
          const built = buildNewInvoice({ job, intake: job.intake, settings, docType: 'estimate' });
          let inv = addEvent(withGe(built.invoice, { origin: 'api-auto' }), { by: 'system' }, 'auto-drafted');
          if (aiBudget > 0) { try { inv = await aiHoursFor(inv, job, packages, past, Number((built.invoice.ge?.prefill as any)?.hourlyRate) || settings.rates.hourlyRate); aiBudget--; } catch { /* AI is optional */ } }
          const id = await deterministicUuid(`estimate|${job.id}`);
          await api('POST', `/api/v2/jobs/${job.id}/invoices`, { body: { id, enc: await sealFor(job.id, id, inv) } });
          result.drafted++;
        } catch { /* one bad job never stops the rest */ }
      }
    }
    if (result.completed || result.drafted) invalidate('invoices:');
  } catch { /* best effort */ }
  return result;
}

async function sealFor(jobId: string, id: string, invoice: unknown): Promise<string> {
  const { requireJobKey } = await import('../e2ee/session');
  return C.encryptJson(await requireJobKey(jobId), { v: 1, invoice: normalizeInvoice(invoice, { keepGe: true }) }, C.aad.invoice(jobId, id));
}
