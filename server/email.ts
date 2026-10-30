import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { SMTP } from './config.js';
import { escapeHtml as esc } from './security.js';
import type { BuiltReport, JobFigures } from './report.js';

// SMTP is optional: without credentials, outbound mail is skipped (and logged) instead of failing.
// STARTTLS is mandatory on non-465 ports so credentials/content can't be downgraded to plaintext.
const transporter = SMTP.configured
  ? nodemailer.createTransport({
      host: SMTP.host,
      port: SMTP.port,
      secure: SMTP.port === 465,
      requireTLS: SMTP.port !== 465,
      auth: { user: SMTP.user, pass: SMTP.pass },
    })
  : null;

const FROM = (name: string) => `"${name}" <${SMTP.from}>`;

const deliver = async (opts: { name: string; to: string; subject: string; html: string; text?: string }, label: string) => {
  if (!transporter) {
    // Test/dev aid: when EMAIL_CAPTURE_DIR is set, write the message to disk instead of dropping it.
    if (process.env.EMAIL_CAPTURE_DIR) {
      fs.mkdirSync(process.env.EMAIL_CAPTURE_DIR, { recursive: true });
      fs.writeFileSync(path.join(process.env.EMAIL_CAPTURE_DIR, `${Date.now()}-${label.replace(/\W+/g, '_')}.html`), `<!-- to: ${opts.to} | subject: ${opts.subject} -->\n${opts.html}\n<!-- text -->\n${opts.text ?? ''}`);
      return;
    }
    console.warn(`[email] SMTP not configured; skipped ${label} email`);
    return;
  }
  try {
    await transporter.sendMail({ from: FROM(opts.name), to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
    console.log(`${label} email sent`);
  } catch (err) {
    console.error(`Error sending ${label} email:`, err);
  }
};

export const sendWelcomeEmail = async (toEmail: string, username: string) => {
  await deliver({
    name: 'GlassExpense',
    to: toEmail,
    subject: 'Welcome to GlassExpense!',
    text: `Welcome to GlassExpense, ${username}! Start tracking your expenses and managing your financial goals.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Welcome to GlassExpense, ${esc(username)}!</h2>
        <p>We're excited to have you on board. Start tracking your expenses and managing your financial goals elegantly.</p>
        <p>Best regards,<br/>The GlassExpense Team</p>
      </div>
    `
  }, 'welcome');
};

export const sendPasswordResetEmail = async (toEmail: string, resetLink: string) => {
  await deliver({
    name: 'GlassExpense Support',
    to: toEmail,
    subject: 'Password Reset Request',
    text: `We received a request to reset your password. Open this link to set a new one (valid for 1 hour): ${resetLink}

If you didn't request this, you can ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Password Reset</h2>
        <p>We received a request to reset your password. Click the link below to set a new password:</p>
        <a href="${esc(resetLink)}" style="display:inline-block; padding: 10px 20px; color: white; background-color: #007bff; text-decoration: none; border-radius: 5px;">Reset Password</a>
        <p>If you didn't request this, you can safely ignore this email.</p>
        <br/>
        <p>This link will expire in 1 hour.</p>
      </div>
    `
  }, 'password reset');
};

export interface ActivityDigest {
  timeWindowStart: string;
  timeWindowEnd: string;
  jobCount: number;
  entryCount: number;
}

const shell = (body: string) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#0f0c1b; padding:32px 16px;">
    <div style="max-width:520px; margin:0 auto; background:#1c172d; border:1px solid rgba(255,255,255,0.1); border-radius:20px; padding:28px; color:#e5e7eb;">
      <div style="color:#7c3bed; font-size:22px; font-weight:bold; margin-bottom:16px;">GlassExpense</div>
      ${body}
      <p style="color:#6b7280; font-size:12px; margin-top:28px;">This is an automated message. Your financial details are end-to-end encrypted, so they are never included in emails.</p>
    </div>
  </div>`;

/** Activity digest. Amounts, descriptions and job names are encrypted, so the server can only report counts. */
export const sendActivityDigestEmail = async (toEmail: string, username: string, digest: ActivityDigest) => {
  await deliver({
    name: 'GlassExpense Reports',
    to: toEmail,
    subject: 'Your GlassExpense activity summary',
    text: `Hi ${username}, between ${digest.timeWindowStart} and ${digest.timeWindowEnd} there were ${digest.entryCount} new entries across ${digest.jobCount} job(s). Open GlassExpense to see your decrypted report.`,
    html: shell(`
      <h2 style="color:#ffffff; margin:0 0 12px 0;">Activity summary</h2>
      <p style="margin:0 0 16px 0;">Hi ${esc(username)}, here is what happened between <strong>${esc(digest.timeWindowStart)}</strong> and <strong>${esc(digest.timeWindowEnd)}</strong>:</p>
      <p style="font-size:28px; font-weight:bold; color:#ffffff; margin:0;">${esc(digest.entryCount)} new ${digest.entryCount === 1 ? 'entry' : 'entries'}</p>
      <p style="color:#9ca3af; margin:4px 0 20px 0;">across ${esc(digest.jobCount)} job${digest.jobCount === 1 ? '' : 's'}</p>
      <p style="margin:0;">Open GlassExpense and unlock your vault to see totals and breakdowns.</p>
    `),
  }, 'activity digest');
};

/** Generic renewal reminder: the subscription's name and amount are encrypted, so the server cannot include them. */
export const sendSubscriptionReminderEmail = async (toEmail: string, username: string, nextDate: string, daysBefore: number) => {
  const when = new Date(nextDate).toLocaleDateString();
  await deliver({
    name: 'GlassExpense',
    to: toEmail,
    subject: 'A recurring subscription is coming up',
    text: `Hi ${username}, a recurring subscription in your jobs is due in ${daysBefore} day(s) (${when}). Open GlassExpense to review it.`,
    html: shell(`
      <h2 style="color:#ffffff; margin:0 0 12px 0;">Subscription reminder</h2>
      <p style="margin:0 0 12px 0;">Hi ${esc(username)}, a recurring subscription in one of your jobs is due in <strong>${esc(daysBefore)} day${daysBefore === 1 ? '' : 's'}</strong> (${esc(when)}).</p>
      <p style="margin:0;">Open GlassExpense to see which one.</p>
    `),
  }, 'subscription reminder');
};

// ── Figure-bearing report (only for users who opted in to report delegation) ─────────────────────────
const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const delta = (now: number, before: number) => {
  if (before === 0) return now === 0 ? '—' : 'new';
  const pct = ((now - before) / Math.abs(before)) * 100;
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%`;
};
const GREEN = '#34d399', RED = '#fb7185';

const jobRows = (jobs: JobFigures[]) => jobs.map(j => `
  <tr>
    <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);color:#e5e7eb;font-size:14px;">${esc(j.name)}<div style="color:#9ca3af;font-size:11px;">${esc(j.entries)} ${j.entries === 1 ? 'entry' : 'entries'} · in ${esc(money(j.income))} · out ${esc(money(j.expense))}</div></td>
    <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06);text-align:right;font-weight:bold;font-size:14px;color:${j.net >= 0 ? GREEN : RED};">${esc(money(j.net))}</td>
  </tr>`).join('');

export const sendReportEmail = async (toEmail: string, username: string, r: BuiltReport, frequencyLabel: string) => {
  const netColor = r.totals.net >= 0 ? GREEN : RED;
  const stale = r.staleDays >= 3
    ? `<p style="margin:16px 0 0 0;padding:10px 12px;border-radius:10px;background:rgba(251,191,36,0.1);color:#fbbf24;font-size:12px;">Figures reflect your last sync from the app (${esc(new Date(r.generatedAt).toLocaleDateString())}). Open GlassExpense to refresh them; entries added since then are not included.</p>`
    : '';
  const section = (title: string, color: string, jobs: JobFigures[], empty: string) => `
    <h3 style="color:${color};font-size:13px;letter-spacing:1px;text-transform:uppercase;margin:28px 0 6px 0;">${esc(title)}</h3>
    ${jobs.length ? `<table style="width:100%;border-collapse:collapse;">${jobRows(jobs)}</table>` : `<p style="color:#6b7280;font-size:13px;margin:6px 0;">${esc(empty)}</p>`}`;

  const text = [
    `${frequencyLabel} report for ${r.windowStart} to ${r.windowEnd}`,
    `Income ${money(r.totals.income)} (${delta(r.totals.income, r.previous.income)} vs previous), expenses ${money(r.totals.expense)} (${delta(r.totals.expense, r.previous.expense)}), net ${money(r.totals.net)}.`,
    r.winners.length ? `Winners: ${r.winners.map(j => `${j.name} ${money(j.net)}`).join('; ')}` : 'No profitable jobs this period.',
    r.lossLeaders.length ? `Loss leaders: ${r.lossLeaders.map(j => `${j.name} ${money(j.net)}`).join('; ')}` : 'No loss-making jobs this period.',
  ].join('\n');

  await deliver({
    name: 'GlassExpense Reports',
    to: toEmail,
    subject: `Your ${frequencyLabel.toLowerCase()} GlassExpense report: ${money(r.totals.net)} net`,
    text,
    html: shell(`
      <h2 style="color:#ffffff;margin:0 0 4px 0;">${esc(frequencyLabel)} report</h2>
      <p style="color:#9ca3af;margin:0 0 20px 0;font-size:13px;">Hi ${esc(username)} · ${esc(r.windowStart)} → ${esc(r.windowEnd)}</p>
      <div style="text-align:center;padding:20px;border-radius:16px;background:rgba(124,59,237,0.12);border:1px solid rgba(124,59,237,0.3);">
        <div style="color:#d8b4fe;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;">Net this period</div>
        <div style="color:${netColor};font-size:38px;font-weight:800;margin:6px 0;">${esc(money(r.totals.net))}</div>
        <div style="color:#9ca3af;font-size:12px;">${esc(delta(r.totals.net, r.previous.net))} vs previous period (${esc(money(r.previous.net))})</div>
      </div>
      <table style="width:100%;margin-top:16px;border-collapse:collapse;"><tr>
        <td style="width:50%;padding:12px;background:rgba(255,255,255,0.04);border-radius:12px;"><div style="color:#9ca3af;font-size:11px;">INCOME</div><div style="color:${GREEN};font-size:20px;font-weight:bold;">${esc(money(r.totals.income))}</div><div style="color:#9ca3af;font-size:11px;">${esc(delta(r.totals.income, r.previous.income))} vs ${esc(money(r.previous.income))}</div></td>
        <td style="width:8px;"></td>
        <td style="width:50%;padding:12px;background:rgba(255,255,255,0.04);border-radius:12px;"><div style="color:#9ca3af;font-size:11px;">EXPENSES</div><div style="color:${RED};font-size:20px;font-weight:bold;">${esc(money(r.totals.expense))}</div><div style="color:#9ca3af;font-size:11px;">${esc(delta(r.totals.expense, r.previous.expense))} vs ${esc(money(r.previous.expense))}</div></td>
      </tr></table>
      ${section('Winners', GREEN, r.winners, 'No profitable jobs this period.')}
      ${section('Loss leaders', RED, r.lossLeaders, 'No loss-making jobs this period.')}
      ${r.categories.length ? `<h3 style="color:#d8b4fe;font-size:13px;letter-spacing:1px;text-transform:uppercase;margin:28px 0 6px 0;">Where the money went</h3>
        <table style="width:100%;border-collapse:collapse;">${r.categories.map(c => `<tr><td style="padding:6px 0;color:#e5e7eb;font-size:13px;">${esc(c.name)}</td><td style="padding:6px 0;text-align:right;color:#e5e7eb;font-size:13px;">${esc(money(c.expense))}</td></tr>`).join('')}</table>` : ''}
      ${stale}
    `),
  }, 'report');
};
