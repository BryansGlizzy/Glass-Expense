import { api, hasSession, invalidate } from './session';
import { listJobs, listSubscriptions, encExpense, toExpenseBlob, deterministicUuid, type SubscriptionBlob } from './store';
import * as C from './crypto';
import { requireJobKey } from './session';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function nextSubscriptionDate(frequency: SubscriptionBlob['frequency'], base: Date, billingDay: number): string {
  const next = new Date(base);
  next.setDate(1); // avoid month overflow while adding
  if (frequency === 'MONTHLY') next.setMonth(next.getMonth() + 1);
  else if (frequency === 'QUARTERLY') next.setMonth(next.getMonth() + 3);
  else if (frequency === 'SEMIANNUAL') next.setMonth(next.getMonth() + 6);
  else if (frequency === 'YEARLY') next.setFullYear(next.getFullYear() + 1);
  const maxDays = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(billingDay, maxDays));
  return ymd(next);
}

/**
 * Recurring entries are generated here, in the user's own client, because only the client can read the subscription.
 * Ids are derived from (subscription, due date), so two devices generating the same period collide instead of duplicating.
 */
export async function runDueSubscriptions(): Promise<number> {
  if (!hasSession()) return 0;
  let created = 0;
  const today = ymd(new Date());
  for (const job of (await listJobs()).filter(j => !j.locked && !j.is_archived)) {
    for (const sub of await listSubscriptions(job.id)) {
      if (!sub.next_generation_date) continue;
      let due = String(sub.next_generation_date).slice(0, 10);
      if (due > today) continue;
      const items: Array<{ id: string; enc: string }> = [];
      let guard = 0;
      while (due <= today && guard++ < 24) {
        const id = await deterministicUuid(`${sub.id}|${due}`);
        items.push({ id, enc: await encExpense(job.id, id, toExpenseBlob({
          amount: sub.amount, description: `${sub.description || 'Subscription'} (Auto-generated)`, entry_type: sub.entry_type, date: due, tags: [],
        })) });
        due = nextSubscriptionDate(sub.frequency, new Date(`${due}T12:00:00`), sub.billing_day);
      }
      try {
        const r = await api<{ created: number }>('POST', `/api/v2/jobs/${job.id}/expenses/bulk`, { body: { items } });
        created += r.created;
        const blob: SubscriptionBlob = { amount: sub.amount, description: sub.description, entry_type: sub.entry_type, billing_day: sub.billing_day, frequency: sub.frequency, last_generated_at: new Date().toISOString() };
        await api('PUT', `/api/v2/jobs/${job.id}/subscriptions/${sub.id}`, { body: {
          enc: await C.encryptJson(await requireJobKey(job.id), blob, C.aad.subscription(job.id, sub.id)),
          next_generation_date: due, remind_1_day_before: sub.remind_1_day_before, remind_2_days_before: sub.remind_2_days_before, remind_7_days_before: sub.remind_7_days_before,
        } });
      } catch (e) { console.warn('Could not generate recurring entries for', sub.id, (e as Error).message); }
    }
  }
  if (created) invalidate('expenses');
  return created;
}
