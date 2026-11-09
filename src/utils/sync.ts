/**
 * sync.ts — GlassExpense Offline Sync Utility
 *
 * Manages an IndexedDB-backed queue for offline expense submissions.
 * When the user is offline, new expenses are stored locally.
 * When connectivity is restored, the queue is drained sequentially.
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PendingExpense {
  /** Temporary client-side ID (prefixed with "pending_") */
  tempId: string;
  jobId: string;
  amount: string;
  description: string;
  entryType: 'expense' | 'income';
  date?: string;
  tagIds?: string[];
  /** Receipt file stored as a Blob (null if no receipt) */
  receiptBlob?: Blob | null;
  receiptName?: string | null;
  isEncrypted?: boolean;
  queuedAt: number;
}

// ─── DB Schema ───────────────────────────────────────────────────────────────

interface GlassExpenseDB extends DBSchema {
  sync_queue: {
    key: string;
    value: PendingExpense;
    indexes: { by_job: string };
  };
}

// ─── DB Init ─────────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase<GlassExpenseDB>> | null = null;

function getDB(): Promise<IDBPDatabase<GlassExpenseDB>> {
  if (!dbPromise) {
    dbPromise = openDB<GlassExpenseDB>('GlassExpenseDB', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sync_queue')) {
          const store = db.createObjectStore('sync_queue', { keyPath: 'tempId' });
          store.createIndex('by_job', 'jobId');
        }
      },
    });
  }
  return dbPromise;
}

// ─── Queue Operations ────────────────────────────────────────────────────────

/** Enqueue a pending expense to be synced later. */
export async function enqueuePendingExpense(expense: PendingExpense): Promise<void> {
  const db = await getDB();
  await db.put('sync_queue', expense);
}

/** Get all pending expenses for a specific job. */
export async function getPendingExpensesForJob(jobId: string): Promise<PendingExpense[]> {
  const db = await getDB();
  return db.getAllFromIndex('sync_queue', 'by_job', jobId);
}

/** Get all pending expenses across all jobs. */
export async function getAllPendingExpenses(): Promise<PendingExpense[]> {
  const db = await getDB();
  return db.getAll('sync_queue');
}

/** Remove a pending expense from the queue (after successful sync). */
export async function dequeuePendingExpense(tempId: string): Promise<void> {
  const db = await getDB();
  await db.delete('sync_queue', tempId);
}

/** Count pending items in the queue. */
export async function getPendingCount(): Promise<number> {
  const db = await getDB();
  return db.count('sync_queue');
}

// ─── Sync Runner ─────────────────────────────────────────────────────────────

/**
 * Attempt to drain the sync queue.
 * Called automatically when the `online` event fires.
 *
 * @param token  JWT auth token
 * @param onSyncComplete  Callback after each successful sync — receives the real
 *                        expense object and the tempId it replaced.
 * @param onSyncFailed    Callback if an item fails to sync.
 */
export async function drainSyncQueue(
  token: string,
  onSyncComplete: (tempId: string, realExpense: any) => void,
  onSyncFailed?: (tempId: string, error: string) => void
): Promise<void> {
  const pending = await getAllPendingExpenses();
  if (pending.length === 0) return;

  for (const item of pending) {
    try {
      const formData = new FormData();
      formData.append('amount', item.amount);
      formData.append('description', item.description);
      formData.append('entry_type', item.entryType);
      if (item.date) formData.append('date', item.date);
      if (item.tagIds && item.tagIds.length > 0) {
        formData.append('tags', JSON.stringify(item.tagIds));
      }
      if (item.receiptBlob) {
        formData.append('receipt', item.receiptBlob, item.receiptName ?? 'receipt.jpg');
        formData.append('is_encrypted', item.isEncrypted ? 'true' : 'false');
      }

      const res = await fetch(`/api/jobs/${item.jobId}/expenses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        const realExpense = await res.json();
        await dequeuePendingExpense(item.tempId);
        onSyncComplete(item.tempId, realExpense);
      } else {
        const errData = await res.json().catch(() => ({ error: 'Unknown server error' }));
        onSyncFailed?.(item.tempId, errData.error ?? 'Server rejected the expense');
      }
    } catch (err: any) {
      onSyncFailed?.(item.tempId, err.message ?? 'Network error during sync');
    }
  }
}

// ─── Logout hygiene ──────────────────────────────────────────────────────────

/**
 * Removes everything this device holds for the signed-in user: the offline mutation queue and the
 * service-worker API caches. Called on logout/session expiry so the next user of a shared browser
 * can never see (or submit) the previous user's data.
 */
export async function clearLocalUserData(): Promise<void> {
  // Working copies of invoices (tab-scoped plaintext) must not outlive the session (docs/INVOICING_PLAN.md T10).
  try { for (const k of Object.keys(sessionStorage)) if (k.startsWith('ge.invoice.')) sessionStorage.removeItem(k); } catch { /* storage unavailable */ }
  try {
    const db = await getDB();
    await db.clear('sync_queue');
  } catch { /* IndexedDB unavailable */ }
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.filter(n => n.startsWith('api-')).map(n => caches.delete(n)));
    }
  } catch { /* Cache API unavailable */ }
}
