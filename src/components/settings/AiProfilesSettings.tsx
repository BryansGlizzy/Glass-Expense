import React, { useEffect, useState } from 'react';
import { aiApi } from '../../invoice/client';
import { DEFAULT_RESEARCH_HEADING, DEFAULT_RESEARCH_PROMPT, type AiProfile, type ProfileName } from '../../invoice/aiSettings';
import { Btn, Card, Field, Notice, NumIn, TextIn } from '../invoice/ui';

type Profiles = Partial<Record<ProfileName, AiProfile>>;
interface ResearchBlock { heading: string; prompt: string; sink_url: string; sink_token: string }
const blank = (t: number): AiProfile => ({ base_url: '', model: '', api_key: '', timeout_s: t });
const TITLES: Record<ProfileName, [string, string]> = {
  default: ['Default endpoint', 'Used for anything without its own profile. Your existing single endpoint above keeps working as the default.'],
  drafting: ['Drafting endpoint (estimates)', 'A fast model that turns a job’s services and symptoms into labor hours.'],
  research: ['Research endpoint', 'A web-searching agent for “AI Research”. Slow calls are fine: it runs in the background for up to 10 minutes.'],
};

/** Named AI endpoint profiles, the research prompt and an optional notes sink (docs/DOCUMENTATION.md §13.11). Stored only in your encrypted vault. */
export default function AiProfilesSettings() {
  const [profiles, setProfiles] = useState<Profiles>({}); const [research, setResearch] = useState<ResearchBlock>({ heading: '', prompt: '', sink_url: '', sink_token: '' });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false);

  useEffect(() => { aiApi.settings().then(s => { setProfiles(s.profiles || {}); setResearch({ heading: s.research?.heading || '', prompt: s.research?.prompt || '', sink_url: s.research?.sink_url || '', sink_token: s.research?.sink_token || '' }); setLoaded(true); }).catch(() => setLoaded(true)); }, []);
  const set = (name: ProfileName, patch: Partial<AiProfile>) => setProfiles(p => ({ ...p, [name]: { ...(p[name] ?? blank(name === 'research' ? 600 : 120)), ...patch } }));
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/settings/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ignored' }, body: JSON.stringify({ profiles, research }) });
      const j = await res.json().catch(() => null); if (!res.ok) throw new Error(j?.error || 'Could not save.'); setMsg({ tone: 'ok', text: 'AI profiles saved.' });
    } catch (e: any) { setMsg({ tone: 'error', text: e.message }); } finally { setBusy(false); }
  };
  const test = async (name: ProfileName) => {
    const p = profiles[name]; if (!p?.base_url) { setMsg({ tone: 'error', text: 'Enter a base URL first.' }); return; }
    setMsg({ tone: 'info', text: 'Testing…' });
    try { const r = await aiApi.test({ base_url: p.base_url, api_key: p.api_key }); setMsg({ tone: 'ok', text: `Connected: ${r.models.length ? r.models.slice(0, 6).join(', ') : 'no models listed'}.` }); }
    catch (e: any) { setMsg({ tone: 'error', text: `${e.message || 'Could not connect.'} Local endpoints must be listed in the server's AI_ALLOWED_HOSTS.` }); }
  };
  if (!loaded) return null;
  return (
    <div className="space-y-4 mb-8">
      <Card title="AI endpoints for estimates and research">
        <p className="text-xs text-gray-400 mb-3">Any OpenAI-compatible endpoint works, including a model on your own network. Private or plain-http addresses are only allowed when the server operator lists them in <code>AI_ALLOWED_HOSTS</code>. Keys are kept in your encrypted vault and sent only for the call being made.</p>
        {(['default', 'drafting', 'research'] as ProfileName[]).map(name => { const p = profiles[name] ?? blank(name === 'research' ? 600 : 120); return (
          <div key={name} className="mb-4 pb-4 border-b border-white/5 last:border-0 last:mb-0 last:pb-0">
            <div className="text-sm font-semibold text-white">{TITLES[name][0]}</div><div className="text-xs text-gray-500 mb-2">{TITLES[name][1]}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Base URL"><TextIn placeholder="http://192.168.1.50:8000/v1" value={p.base_url} onChange={v => set(name, { base_url: v })} /></Field>
              <Field label="Model"><TextIn placeholder="model name" value={p.model} onChange={v => set(name, { model: v })} /></Field>
              <Field label="API key (optional for local models)"><TextIn type="password" autoComplete="off" value={p.api_key} onChange={v => set(name, { api_key: v })} /></Field>
              <Field label="Timeout (seconds)"><NumIn min="10" max="900" value={p.timeout_s} onChange={v => set(name, { timeout_s: v })} /></Field>
            </div><div className="mt-2"><Btn size="sm" onClick={() => test(name)}>Test connection</Btn></div></div>); })}
      </Card>
      <Card title="AI Research prompt">
        <div className="space-y-3">
          <Field label="Heading written above the research" hint={`Use {{model}} for the model name. Default: ${DEFAULT_RESEARCH_HEADING}`}><TextIn placeholder={DEFAULT_RESEARCH_HEADING} value={research.heading} onChange={v => setResearch(r => ({ ...r, heading: v }))} /></Field>
          <Field label="Prompt" hint="Variables: {{vehicle}} {{services}} {{notes}}. Leave empty for the default. Customer name, phone, e-mail and street address are never sent."><textarea rows={8} className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500" placeholder={DEFAULT_RESEARCH_PROMPT} value={research.prompt} onChange={e => setResearch(r => ({ ...r, prompt: e.target.value }))} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Also send results to a notes app (optional URL)"><TextIn placeholder="http://notes.example.com/api/v1/notes" value={research.sink_url} onChange={v => setResearch(r => ({ ...r, sink_url: v }))} /></Field>
            <Field label="Notes app token"><TextIn type="password" autoComplete="off" value={research.sink_token} onChange={v => setResearch(r => ({ ...r, sink_token: v }))} /></Field></div>
          <Notice tone="info">Automatic research only runs for jobs posted through the API by a key with “Run AI research on jobs this key posts” enabled (Settings → API Keys). Jobs you create here are never researched automatically; use the “AI Research” button on a job.</Notice>
        </div>
      </Card>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Btn variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save AI profiles'}</Btn>
    </div>
  );
}
