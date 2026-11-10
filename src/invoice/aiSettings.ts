/**
 * AI endpoint profiles and the research prompt (docs/DOCUMENTATION.md §13.11). Stored in the encrypted `ai_settings` blob next to the
 * legacy single endpoint (`ai_api_key`, `ai_base_url`, `ai_model`), which keeps working as the "default" profile.
 * Three profiles match a typical setup: a fast model for drafting, a slow web-searching agent for research, and the default.
 * Pure and DOM-free (shared by the browser and, for prompt rendering, the server's research worker).
 */

export interface AiProfile { base_url: string; model: string; api_key: string; timeout_s: number }
export type ProfileName = 'default' | 'drafting' | 'research';

/** The website's research prompt, moved here verbatim from futures-services (Appendix F). Variables: {{vehicle}} {{services}} {{notes}}. */
export const DEFAULT_RESEARCH_PROMPT = `Please do research on this automotive repair/maintenance inquiry. Keep it concise, professional, and actionable. Provide at least 3 verified YouTube tutorial links (ensure the full valid URL is provided).

Vehicle: {{vehicle}}
Requested Services: {{services}}
Customer Notes: {{notes}}

Perform an internet search to find:
1. Estimated book labor hours required for this specific vehicle and service.
2. At least 3 verified YouTube videos or guides demonstrating this specific procedure on this model.
3. Common failure points, recommended replacement parts, and OEM/aftermarket part price ranges.

Provide a clean, structured summary in Markdown.`;

/** Starts with `###`, so the job page's "AI Notes" panel shows it. `{{model}}` is replaced with the model name. */
export const DEFAULT_RESEARCH_HEADING = '### 🤖 AI Research ({{model}})';

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const timeout = (v: unknown, fb: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(900, Math.max(10, n)) : fb; };

function readProfile(raw: unknown, fallbackTimeout: number): AiProfile | null {
  if (!isObj(raw)) return null;
  const base_url = text(raw.base_url, 500).trim(); const model = text(raw.model, 100).trim();
  return base_url && model ? { base_url, model, api_key: text(raw.api_key, 500), timeout_s: timeout(raw.timeout_s, fallbackTimeout) } : null;
}

/** The profile to use for a job: the named one, else the default, else the legacy single endpoint, else null. */
export function profileFor(settings: any, name: ProfileName): AiProfile | null {
  const s = isObj(settings) ? settings : {};
  const profiles = isObj(s.profiles) ? s.profiles : {};
  const legacy: AiProfile | null = s.ai_base_url && s.ai_model ? { base_url: String(s.ai_base_url), model: String(s.ai_model), api_key: String(s.ai_api_key || ''), timeout_s: 120 } : null;
  const own = name === 'default' ? null : readProfile(profiles[name], name === 'research' ? 600 : 120);
  return own ?? readProfile(profiles.default, 120) ?? legacy;
}

export interface ResearchSettings { base_url: string; model: string; api_key?: string; timeout_s: number; heading: string; prompt: string; sink?: { url: string; token?: string } }

/** What gets sealed into an agent key's bundle (and used by the manual button too). Null when no endpoint is configured. */
export function researchSettings(settings: any): ResearchSettings | null {
  const p = profileFor(settings, 'research');
  if (!p) return null;
  const r = isObj(settings?.research) ? settings.research : {};
  const sinkUrl = text(r.sink_url, 500).trim();
  return {
    base_url: p.base_url, model: p.model, ...(p.api_key ? { api_key: p.api_key } : {}), timeout_s: p.timeout_s,
    heading: text(r.heading, 200).trim() || DEFAULT_RESEARCH_HEADING, prompt: text(r.prompt, 6000).trim() || DEFAULT_RESEARCH_PROMPT,
    ...(sinkUrl ? { sink: { url: sinkUrl, ...(r.sink_token ? { token: text(r.sink_token, 500) } : {}) } } : {}),
  };
}

const MAX_FIELD = 600;
const clip = (v: unknown) => (typeof v === 'string' ? v : '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').slice(0, MAX_FIELD).trim();

/**
 * Fills the research prompt from a job. The text comes from a public web form, so each field is bounded and passed as DATA in a
 * delimited block; the model's output is informational and is never applied to rates, fees or invoices (threat T5).
 */
export function renderResearchPrompt(template: string, ctx: { vehicle?: string; services?: string[]; notes?: string }): string {
  const vars: Record<string, string> = { vehicle: clip(ctx.vehicle) || 'Not specified', services: (ctx.services || []).map(clip).filter(Boolean).join(', ') || 'Not specified', notes: clip(ctx.notes) || 'None' };
  return template.replace(/\{\{(vehicle|services|notes)\}\}/g, (_, k) => vars[k]);
}

export const renderHeading = (heading: string, model: string) => heading.replace(/\{\{model\}\}/g, model.replace(/[\r\n#]/g, ' ').slice(0, 100));

/** True when a description already carries an AI section (used so auto-research cannot double-post). */
export const hasAiSection = (description: string | null | undefined) => /^###\s*🤖\s*AI\b/m.test(description || '');
