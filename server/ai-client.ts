import http from 'http';
import https from 'https';
import { assertSafeOutboundUrl, ValidationError } from './security.js';

/**
 * One OpenAI-compatible chat client for every server-side AI call (docs/DOCUMENTATION.md §13.11): the draft-estimate relay, the
 * research tasks and the in-process research worker. SSRF-guarded (`assertSafeOutboundUrl`, with AI_ALLOWED_HOSTS for local
 * endpoints), never follows redirects, bounded response size, and uses `http(s).request` so calls can run for minutes: Node's
 * built-in fetch gives up waiting for response headers after 300 s, and a web-searching research agent can take up to ten (C13).
 * Keys are used for the single call and never stored or logged.
 */

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatOptions {
  baseUrl: string; apiKey?: string; model: string; messages: ChatMessage[];
  /** Ask the provider for a JSON object (response_format), where supported. */
  json?: boolean; timeoutMs?: number; signal?: AbortSignal; maxTokens?: number;
}

export class AiError extends Error { constructor(message: string, public status = 502) { super(message); } }

const MAX_RESPONSE_BYTES = 2_000_000;

/** POST/GET JSON to `${base}${path}` and return the parsed body. */
async function call(method: 'GET' | 'POST', baseUrl: string, path: string, apiKey: string | undefined, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<any> {
  const base = await assertSafeOutboundUrl(baseUrl);
  const url = new URL(`${base}${path}`);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method, timeout: timeoutMs,
      headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (c: Buffer) => { size += c.length; if (size > MAX_RESPONSE_BYTES) { req.destroy(); reject(new AiError('The AI provider sent too much data.')); } else chunks.push(c); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400) return reject(new AiError('The AI provider tried to redirect; redirects are not followed.'));
        if (status < 200 || status >= 300) return reject(new AiError(`The AI provider returned an error (${status}).`));
        try { resolve(JSON.parse(text)); } catch { reject(new AiError('The AI provider returned something that is not JSON.')); }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new AiError('The AI provider took too long to answer.', 504)); });
    req.on('error', (e: any) => reject(e instanceof AiError || e instanceof ValidationError ? e : new AiError(`Could not reach the AI provider (${e?.code || 'network error'}).`)));
    if (signal) { if (signal.aborted) { req.destroy(); reject(new AiError('Cancelled.', 499)); } else signal.addEventListener('abort', () => { req.destroy(); reject(new AiError('Cancelled.', 499)); }, { once: true }); }
    if (payload) req.write(payload);
    req.end();
  });
}

export async function chat(o: ChatOptions): Promise<{ content: string }> {
  const data = await call('POST', o.baseUrl, '/chat/completions', o.apiKey, {
    model: o.model, messages: o.messages, ...(o.json ? { response_format: { type: 'json_object' } } : {}), ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
  }, o.timeoutMs ?? 120_000, o.signal);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new AiError('The AI provider answered without any text.');
  return { content };
}

/** `GET /models`: used by the "Test connection" button. Returns up to 50 model ids. */
export async function listModels(baseUrl: string, apiKey?: string, timeoutMs = 15_000): Promise<string[]> {
  const data = await call('GET', baseUrl, '/models', apiKey, undefined, timeoutMs);
  const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return list.map(m => (typeof m === 'string' ? m : String(m?.id ?? m?.name ?? ''))).filter(Boolean).slice(0, 50);
}
