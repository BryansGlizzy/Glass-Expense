import type { Server } from 'socket.io';
import { chat } from './ai-client.js';
import { assertSafeOutboundUrl } from './security.js';
import { AI_RESEARCH_TIMEOUT_MS } from './config.js';
import { appendDescription, jobCreatedHooks, type Agent, type JobBlob } from './agent-core.js';
import { hasAiSection, renderHeading, renderResearchPrompt, DEFAULT_RESEARCH_HEADING, DEFAULT_RESEARCH_PROMPT } from '../src/invoice/aiSettings.ts';
import { parseIntakeText } from '../src/invoice/intake.ts';

/**
 * In-process research worker (docs/DOCUMENTATION.md §13.11, decisions D8/D19). It replaces the website's own Hermes call.
 *
 * It runs ONLY for jobs created through the agent API by a key that was explicitly opted in to research (`scope.research`, with the
 * endpoint sealed in the key's bundle). Jobs created in the GE app, imported, or by any other key are never researched: the trigger
 * is the agent create route's own hook, not a scan. It uses `agent-core` (same job scoping, append-only rule, duplicate check and
 * size limit as the HTTP route) with no network hop to itself. Its output is informational and is never applied to an invoice.
 */

const MAX_CONCURRENT_PER_USER = 2;
const active = new Map<string, number>();

export interface ResearchDeps { chatFn?: typeof chat; fetchFn?: typeof fetch }

export async function runResearch(agent: Agent, userId: string, jobId: string, blob: JobBlob, io: Server | null, deps: ResearchDeps = {}): Promise<'done' | 'skipped' | 'failed'> {
  const cfg = agent.bundle.research;
  if (!cfg || !agent.scope.research || agent.scope.access !== 'write') return 'skipped';
  if (hasAiSection(blob.description)) return 'skipped'; // another producer (e.g. the website's old step) already posted research
  if ((active.get(userId) ?? 0) >= MAX_CONCURRENT_PER_USER) return 'skipped';
  active.set(userId, (active.get(userId) ?? 0) + 1);
  try {
    const intake = blob.intake ?? parseIntakeText(blob.description);
    const v = intake.vehicle;
    const vehicle = v ? ([v.year, v.make, v.model, v.engine].filter(Boolean).join(' ') || v.raw || '') : '';
    const prompt = renderResearchPrompt(cfg.prompt || DEFAULT_RESEARCH_PROMPT, { vehicle, services: intake.services, notes: intake.symptoms });
    const { content } = await (deps.chatFn ?? chat)({
      baseUrl: cfg.base_url, apiKey: cfg.api_key, model: cfg.model, timeoutMs: Math.min(AI_RESEARCH_TIMEOUT_MS, cfg.timeout_s * 1000),
      // The customer-supplied text is DATA inside the prompt; nothing the model returns is ever executed or applied.
      messages: [{ role: 'user', content: prompt }],
    });
    const markdown = content.trim().slice(0, 60_000) || '*No research generated.*';
    const heading = renderHeading(cfg.heading || DEFAULT_RESEARCH_HEADING, cfg.model);
    // Re-checked at write time: another producer may have posted its own AI section while this call was running.
    appendDescription(agent, userId, jobId, `${heading}\n\n${markdown}`, io, { skipIfCurrent: hasAiSection });
    if (cfg.sink?.url) void postToSink(cfg.sink, blob.title, markdown, jobId, deps.fetchFn ?? fetch);
    return 'done';
  } catch (err) {
    console.error(`[research] job ${jobId} failed:`, (err as Error).message); // never logs prompts, keys or customer data
    return 'failed';
  } finally {
    active.set(userId, Math.max(0, (active.get(userId) ?? 1) - 1));
  }
}

/** Optional note sink (e.g. a notes app): the same {title, content} POST the website used to send. Best effort. */
async function postToSink(sink: { url: string; token?: string }, title: string, markdown: string, jobId: string, fetchFn: typeof fetch) {
  try {
    const url = await assertSafeOutboundUrl(sink.url); // same SSRF guard as the AI endpoint (local sinks need AI_ALLOWED_HOSTS)
    await fetchFn(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', ...(sink.token ? { Authorization: `Bearer ${sink.token}` } : {}) },
      body: JSON.stringify({ title: `Auto Research: ${title}`, content: `# Research: ${title}\n\n${markdown}\n\n---\n*Linked to GlassExpense Job ID:* ${jobId}` }),
    });
  } catch { /* the sink is optional */ }
}

/** Registers the worker on the agent create route. Called once at startup. */
export function registerResearchWorker(io: Server): void {
  jobCreatedHooks.push(({ agent, userId, jobId, blob }) => {
    if (!agent.scope.research || !agent.bundle.research) return;
    void runResearch(agent, userId, jobId, blob, io);
  });
}
