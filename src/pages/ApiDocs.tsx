import React from 'react';
import { Terminal, Shield, Database, Server } from 'lucide-react';

export default function ApiDocs() {
  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight mb-4 text-white">API & Self-Hosting Guide</h1>
        <p className="text-xl text-gray-400">Documentation for the GlassExpense Developer API and Personal Edition deployment.</p>
      </div>

      <div className="space-y-12">
        {/* Self Hosting Section */}
        <section className="bg-[#1c172d]/40 border border-emerald-500/20 rounded-3xl p-8 backdrop-blur-sm">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center">
              <Server className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold text-white">Self-Hosting (Personal Edition)</h2>
          </div>
          
          <div className="prose prose-invert max-w-none text-gray-300">
            <p className="mb-4">
              GlassExpense is open-source. The Personal Edition allows you to run the entire stack locally with no restrictions. 
              The first user to register becomes the Administrator and automatically inherits the <code>personal</code> plan, unlocking all limits.
            </p>
            
            <h3 className="text-lg font-bold text-white mt-6 mb-3">1. Prerequisites</h3>
            <ul className="list-disc pl-5 space-y-2 mb-6">
              <li>Node.js 18+ and npm</li>
              <li>Git</li>
            </ul>

            <h3 className="text-lg font-bold text-white mt-6 mb-3">2. Installation</h3>
            <div className="bg-black/40 rounded-xl p-4 font-mono text-sm border border-white/5 mb-6 text-emerald-400">
              git clone https://github.com/futurelabz/glassexpense.git<br/>
              cd glassexpense<br/>
              npm install<br/>
              cp .env.personal.example .env
            </div>

            <h3 className="text-lg font-bold text-white mt-6 mb-3">3. Security & SMTP Configuration</h3>
            <p className="mb-4">Edit the <code>.env</code> file. <strong>SMTP is required</strong> for the application to function correctly (sending welcome emails, password resets, and automated reports).</p>
            <div className="bg-black/40 rounded-xl p-4 font-mono text-sm border border-white/5 mb-6">
              # Core Settings<br/>
              MODE="personal"<br/>
              JWT_SECRET="generate-a-long-random-string"<br/>
              ADMIN_EMAIL="your-email@example.com"<br/>
              <br/>
              # SMTP Settings (Example using SMTP2GO or SendGrid)<br/>
              SMTP_HOST="mail.smtp2go.com"<br/>
              SMTP_PORT="2525"<br/>
              SMTP_USER="your-smtp-username"<br/>
              SMTP_PASS="your-smtp-password"
            </div>

            <h3 className="text-lg font-bold text-white mt-6 mb-3">4. Running the Server</h3>
            <div className="bg-black/40 rounded-xl p-4 font-mono text-sm border border-white/5 mb-6 text-emerald-400">
              npm run dev # For development<br/>
              npm run build && npm run start # For production
            </div>
            
            <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl mt-6">
              <div className="flex items-start gap-3">
                <Shield className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-blue-400 mb-1">End-to-End Encryption</h4>
                  <p className="text-sm text-blue-300/80">
                    Receipts are encrypted locally in your browser using the Web Crypto API before being uploaded to your server.
                    Each job's symmetric key is wrapped with your master key (derived from your 12-word recovery phrase) and only the
                    wrapped form is stored on the server. Expense amounts and descriptions are stored in plaintext so reports and tax
                    calculations can run server-side.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* API Docs Section */}
        <section className="bg-[#1c172d]/40 border border-white/10 rounded-3xl p-8 backdrop-blur-sm">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 bg-[#7c3bed]/10 rounded-xl flex items-center justify-center">
              <Terminal className="w-6 h-6 text-[#7c3bed]" />
            </div>
            <h2 className="text-2xl font-bold text-white">Developer API Reference</h2>
          </div>

          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-bold text-white mb-2">Authentication</h3>
              <p className="text-gray-400 mb-4">
                API keys look like <code className="text-white">ge_AUTH.SECRET</code>. Send <strong>only the part before the dot</strong> in the header; keep the part after the dot private.
              </p>
              <div className="bg-black/40 rounded-xl p-4 font-mono text-sm border border-white/5 text-gray-300">
                x-api-key: ge_AUTH
              </div>
              <p className="text-gray-400 mt-4 text-sm">
                Your data is end-to-end encrypted, so by default an API key can do exactly one thing: read your calendar. It cannot read expenses, clients, notes or amounts. Keys created with the optional <strong>Agent access</strong> setting can also use the agent API below; every other endpoint rejects API keys.
              </p>
            </div>

            <div className="border border-white/5 rounded-2xl overflow-hidden">
              <div className="bg-white/5 px-6 py-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="bg-blue-500/20 text-blue-400 font-bold px-2 py-1 rounded text-xs">GET</span>
                  <span className="font-mono text-white">/api/calendar/schedule</span>
                </div>
              </div>
              <div className="p-6 bg-black/20 space-y-4">
                <p className="text-gray-400">Returns your booked dates in plain text and each job title encrypted. Your app decrypts the titles with the secret half of its key.</p>
                <div className="bg-black/40 rounded-xl p-4 font-mono text-xs border border-white/5 text-gray-400 whitespace-pre-wrap">{`{
  "version": 2,
  "wrapped_calendar_key": "v2.<base64>",
  "jobs": [{ "id": "…", "start_date": "2026-11-03", "end_date": "2026-11-09", "title": "v2.<base64>" }]
}`}</div>
                <p className="text-gray-400 text-sm">
                  To decrypt: derive an AES-256-GCM key from the secret half with HKDF-SHA-256 (info <code className="text-white">glassexpense/apikey-calendar/v2</code>,
                  zero salt), unwrap <code className="text-white">wrapped_calendar_key</code> (AAD <code className="text-white">apikey-calendar</code>), then decrypt each
                  <code className="text-white"> title</code> with that calendar key (AAD <code className="text-white">calendar-title|&lt;job id&gt;</code>). Envelope layout:
                  base64 of a 12-byte IV followed by the ciphertext and tag. The full step-by-step guide with ready-to-run Node.js, browser and Python examples is in
                  <code className="text-white"> docs/API.md</code> (“Calendar API”).
                </p>
              </div>
            </div>

            <div className="border border-white/5 rounded-2xl overflow-hidden">
              <div className="bg-white/5 px-6 py-4 border-b border-white/5 flex items-center gap-3">
                <span className="bg-amber-500/20 text-amber-400 font-bold px-2 py-1 rounded text-xs">OPT-IN</span>
                <span className="font-mono text-white">/api/agent/v1/*</span>
              </div>
              <div className="p-6 bg-black/20 space-y-4 text-sm text-gray-400">
                <p>
                  For automations and AI agents. Available only to keys you created with <strong className="text-white">Agent access</strong> turned on in Settings → API Keys.
                  That setting gives our server the decryption keys of the jobs you choose for as long as the key exists, so a leaked key exposes those jobs. Read the notice shown when you enable it.
                </p>
                <div className="bg-black/40 rounded-xl p-4 font-mono text-xs border border-white/5 text-gray-300 whitespace-pre-wrap">{`GET  /api/agent/v1/me
GET  /api/agent/v1/jobs
GET  /api/agent/v1/jobs/:id
POST /api/agent/v1/jobs                       (read + write keys)  { "title": "…", "start_date": "YYYY-MM-DD" }
GET  /api/agent/v1/jobs/:id/expenses?from=&to=&type=&limit=&offset=
POST /api/agent/v1/jobs/:id/expenses          (read + write keys)  { "amount": 42.5, "description": "…", "entry_type": "expense" }`}</div>
                <p>Agents cannot edit or delete anything, and receipts, tags and tax data are not available. Full reference: <code className="text-white">docs/API.md</code> (“Agent API”).</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
