import type { Socket } from 'socket.io-client';
import * as C from './crypto';
import { getJobKey, invalidate } from './session';
import { decryptExpenseRow } from './store';
import { scheduleSnapshotRefresh } from './reportSnapshot';

/**
 * The server pushes ciphertext rows over Socket.IO. This wraps `socket.on` so page handlers keep receiving the plaintext
 * objects they always did: rows are decrypted (with the job key) before the handler runs.
 */
export function wrapSocket(socket: Socket): Socket {
  const originalOn = socket.on.bind(socket);

  (socket as any).on = (event: string, handler: (...args: any[]) => void) => {
    if (event === 'expense_added' || event === 'expense_updated') {
      return originalOn(event, async (row: any) => {
        invalidate(`expenses:${row.job_id}`); invalidate('jobs');
        scheduleSnapshotRefresh();
        const key = await getJobKey(row.job_id);
        const view = key ? await decryptExpenseRow(row, key) : null;
        if (view) handler(view);
      });
    }
    if (event === 'wishlist_item_added') {
      return originalOn(event, async (row: any) => {
        const key = await getJobKey(row.job_id);
        if (!key || !row.enc) return;
        try { handler({ id: row.id, job_id: row.job_id, user_id: row.user_id, user_name: row.user_name, created_at: row.created_at, ...(await C.decryptJson(key, row.enc, C.aad.wishlist(row.job_id, row.id))) }); }
        catch { /* not decryptable by this user */ }
      });
    }
    if (event === 'expense_deleted' || event === 'wishlist_item_deleted') {
      return originalOn(event, (id: string) => { invalidate('expenses'); invalidate('jobs'); handler(id); });
    }
    return originalOn(event, handler);
  };
  return socket;
}
