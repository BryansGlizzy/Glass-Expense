import type { Express } from 'express';
import crypto from 'crypto';
import { ValidationError } from '../security.js';
import { authenticateToken, requireSession, aiLimiter, enforceAiLimits } from '../middleware.js';
import { AiError, chat, listModels, type ChatMessage } from '../ai-client.js';
import { AI_RESEARCH_TIMEOUT_MS } from '../config.js';

/**
 * AI relays for the browser (docs/INVOICING_PLAN.md §5.13). CSP is `connect-src 'self'`, so the browser cannot call an LLM; like OCR,
 * it sends the provider settings from its encrypted vault with each request and the server uses them for that one call.
 *
 *   POST   /api/ai/complete     one short call (draft estimate); returns the text
 *   POST   /api/ai/tasks        start a long call (research); returns an id to poll
 *   GET    /api/ai/tasks/:id    status / result (kept in memory for 30 minutes, then gone)
 *   DELETE /api/ai/tasks/:id    cancel
 *   POST   /api/ai/test         "Test connection": lists the endpoint's models
 *
 * Session only (never an API key). The server stores nothing: results live in memory until read or expired.
 */

const TASK_TTL_MS = 30 * 60_000;
const MAX_CONCURRENT = 2;

interface Task { id: string; userId: string; status: 'pending' | 'done' | 'error'; content?: string; error?: string; controller: AbortController; createdAt: number }
const tasks = new Map<string, Task>();

const sweep = () => { const now = Date.now(); for (const [id, t] of tasks) if (now - t.createdAt > TASK_TTL_MS) { t.controller.abort(); tasks.delete(id); } };
setInterval(sweep, 60_000).unref();

function parseProfile(raw: any, maxTimeoutMs: number) {
  if (!raw || typeof raw !== 'object') throw new ValidationError('profile is required');
  const base_url = typeof raw.base_url === 'string' ? raw.base_url.trim().slice(0, 500) : '';
  const model = typeof raw.model === 'string' ? raw.model.trim().slice(0, 100) : '';
  if (!base_url || !model) throw new ValidationError('profile.base_url and profile.model are required');
  const seconds = Number(raw.timeout_s);
  return { baseUrl: base_url, model, apiKey: typeof raw.api_key === 'string' ? raw.api_key.slice(0, 500) : undefined, timeoutMs: Math.min(maxTimeoutMs, Math.max(5_000, (Number.isFinite(seconds) ? seconds : 120) * 1000)) };
}

function parseMessages(raw: any): ChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) throw new ValidationError('messages must be 1-10 items');
  let total = 0;
  return raw.map(m => {
    if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw new ValidationError('each message needs a role and text content');
    total += m.content.length; if (total > 60_000) throw new ValidationError('messages are too long');
    return { role: m.role, content: m.content };
  });
}

const fail = (res: any, err: unknown) => {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  if (err instanceof AiError) return res.status(err.status === 499 ? 499 : 502).json({ error: err.message });
  console.error('AI relay error:', (err as Error)?.message);
  return res.status(502).json({ error: 'The AI request failed.' });
};

export function registerAiRoutes(app: Express) {
  const guard = [authenticateToken, requireSession, aiLimiter, enforceAiLimits];

  app.post('/api/ai/complete', ...guard, async (req: any, res) => {
    try {
      const p = parseProfile(req.body?.profile, 180_000);
      const out = await chat({ ...p, messages: parseMessages(req.body?.messages), json: req.body?.json === true });
      res.json({ content: out.content });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/ai/test', ...guard, async (req: any, res) => {
    try {
      const raw = req.body?.profile;
      if (!raw || typeof raw.base_url !== 'string') throw new ValidationError('profile.base_url is required');
      res.json({ ok: true, models: await listModels(raw.base_url, typeof raw.api_key === 'string' ? raw.api_key.slice(0, 500) : undefined) });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/ai/tasks', ...guard, (req: any, res) => {
    try {
      sweep();
      const mine = [...tasks.values()].filter(t => t.userId === req.user.id && t.status === 'pending');
      if (mine.length >= MAX_CONCURRENT) return res.status(429).json({ error: `At most ${MAX_CONCURRENT} AI tasks can run at once. Wait for one to finish or cancel it.` });
      const p = parseProfile(req.body?.profile, AI_RESEARCH_TIMEOUT_MS);
      const messages = parseMessages(req.body?.messages);
      const task: Task = { id: crypto.randomUUID(), userId: req.user.id, status: 'pending', controller: new AbortController(), createdAt: Date.now() };
      tasks.set(task.id, task);
      chat({ ...p, messages, signal: task.controller.signal })
        .then(r => { task.status = 'done'; task.content = r.content.slice(0, 100_000); })
        .catch(e => { task.status = 'error'; task.error = e instanceof AiError || e instanceof ValidationError ? e.message : 'The AI request failed.'; });
      res.status(202).json({ id: task.id, status: task.status });
    } catch (err) { fail(res, err); }
  });

  const mineOr404 = (req: any, res: any): Task | null => {
    const t = tasks.get(req.params.id);
    if (!t || t.userId !== req.user.id) { res.status(404).json({ error: 'Task not found or expired' }); return null; }
    return t;
  };

  app.get('/api/ai/tasks/:id', ...guard, (req: any, res) => {
    const t = mineOr404(req, res); if (!t) return;
    res.json({ id: t.id, status: t.status, ...(t.status === 'done' ? { content: t.content } : {}), ...(t.status === 'error' ? { error: t.error } : {}) });
  });

  app.delete('/api/ai/tasks/:id', ...guard, (req: any, res) => {
    const t = mineOr404(req, res); if (!t) return;
    t.controller.abort(); tasks.delete(t.id); res.json({ success: true });
  });
}
