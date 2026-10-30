/**
 * Client-side encrypted API layer.
 *
 * The pages keep calling the same `/api/...` URLs and receive the same JSON they always have. `installE2eeRouter()` wraps
 * `window.fetch`: calls that touch user content are answered here (decrypting what the server stores, encrypting what the UI
 * sends) and forwarded to the ciphertext-only `/api/v2/...` endpoints. Everything else (auth, admin, license, settings that
 * hold no content) passes straight through to the server.
 */
import { api, hasSession, rawFetch, HttpError } from './session';
import { jobRoutes } from './handlers/jobs';
import { entryRoutes } from './handlers/entries';
import { taxRoutes } from './handlers/tax';
import { Route, Req, Res } from './handlers/types';
import { scheduleSnapshotRefresh } from './reportSnapshot';

const routes: Route[] = [...jobRoutes, ...entryRoutes, ...taxRoutes];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const asUrl = (input: RequestInfo | URL): URL | null => {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    return new URL(raw, window.location.origin);
  } catch { return null; }
};

async function parseBody(init?: RequestInit): Promise<{ body: any; form: FormData | null }> {
  const b = init?.body;
  if (b instanceof FormData) return { body: {}, form: b };
  if (typeof b === 'string' && b) { try { return { body: JSON.parse(b), form: null }; } catch { return { body: {}, form: null }; } }
  return { body: {}, form: null };
}

export function installE2eeRouter() {
  const g = globalThis as any;
  if (g.__ge_original_fetch) return;                       // already installed
  g.__ge_original_fetch = window.fetch.bind(window);       // keeps main.tsx's native-platform URL rewriting in the chain

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = asUrl(input);
    const sameOrigin = url && (url.origin === window.location.origin);
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (url && sameOrigin) {
      // Receipt files: now downloaded through the authenticated endpoint (they are opaque ciphertext).
      if (method === 'GET' && url.pathname.startsWith('/uploads/')) {
        if (!hasSession()) return json(401, { error: 'Vault locked' });
        try { return await api<Response>('GET', `/api/v2/uploads/${encodeURIComponent(url.pathname.split('/').pop() || '')}`, { raw: true }); }
        catch (e) { return json(e instanceof HttpError ? e.status : 500, { error: 'Receipt not available' }); }
      }

      for (const [m, pattern, handler] of routes) {
        if (m !== method) continue;
        const match = url.pathname.match(pattern);
        if (!match) continue;
        if (!hasSession()) return json(401, { error: 'Your vault is locked. Please sign in again.' });
        try {
          const { body, form } = await parseBody(init);
          const req: Req = { method, path: url.pathname, query: url.searchParams, m: match, body, form };
          const res: Res = await handler(req);
          if (method !== 'GET' && /^\/api\/jobs(\/|$)/.test(url.pathname)) scheduleSnapshotRefresh(); // keeps opted-in report e-mails current
          return res.response ?? json(res.status ?? 200, res.json);
        } catch (e: any) {
          if (e instanceof HttpError) return json(e.status, e.body ?? { error: e.message });
          if (typeof e?.status === 'number') return json(e.status, { error: e.message });
          console.error('E2EE handler error', method, url.pathname, e);
          return json(500, { error: 'Something went wrong while processing encrypted data.' });
        }
      }
    }
    return g.__ge_original_fetch(input, init);
  };
}
