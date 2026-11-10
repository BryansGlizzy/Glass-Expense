import type { Express } from 'express';
import { ValidationError } from '../security.js';
import { authenticateToken, requireSession } from '../middleware.js';
import { INVOICE_EMAIL_DAILY_LIMIT } from '../config.js';
import { renderInvoiceEmailHtml, sendInvoiceEmail } from '../email.js';
import { isAllowedPayUrl } from '../../src/invoice/paylinks.ts';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Internal invoice e-mailer (docs/DOCUMENTATION.md §13.10). The PDF is generated in the browser and passes through the server in
 * memory: an explicit, opt-in trade-off from end-to-end encryption (the browser only calls this when the user enabled e-mail in
 * Settings, with that explanation). Session only: agents cannot send. Nothing is stored and content is never logged.
 *
 * Guards against abuse as a spam relay: at most 3 recipients, header-injection checks, a PDF must really be a PDF (≤ 3 MB), links must
 * be https on the allow-listed payment providers, HTML is built here from the ESCAPED plain text, and a per-user daily cap applies.
 */

const EMAIL_RE = /^[^\s@<>",;\r\n]{1,64}@[^\s@<>",;\r\n]{1,255}\.[^\s@<>",;\r\n]{2,}$/;
const MAX_PDF = 3 * 1024 * 1024;
const sent = new Map<string, { day: string; count: number }>();

const mailLimiter = rateLimit({
  windowMs: 60_000, limit: 10 * Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLIER) || 1), standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: (req: any) => `invmail:${req.user?.id ?? ipKeyGenerator(req.ip ?? '')}`, message: { error: 'Too many e-mails in a short time. Wait a minute.' },
});

const noCrlf = (v: string, field: string) => { if (/[\r\n\u0000]/.test(v)) throw new ValidationError(`${field} must not contain line breaks`); return v; };
const addr = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !EMAIL_RE.test(v.trim())) throw new ValidationError(`${field} is not a valid e-mail address`);
  return noCrlf(v.trim().toLowerCase(), field);
};
const list = (v: unknown, field: string): string[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v.map(x => addr(x, field)) : [addr(v, field)]);

export function registerInvoiceMailRoutes(app: Express) {
  app.post('/api/invoices/send', authenticateToken, requireSession, mailLimiter, async (req: any, res) => {
    try {
      const b = req.body ?? {};
      const to = list(b.to, 'to'), cc = list(b.cc, 'cc'), bcc = list(b.bcc, 'bcc');
      if (to.length === 0) throw new ValidationError('to is required');
      if (to.length + cc.length + bcc.length > 3) throw new ValidationError('At most 3 recipients per message');
      if (typeof b.subject !== 'string' || !b.subject.trim() || b.subject.length > 300) throw new ValidationError('subject is required (up to 300 characters)');
      if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 10_000) throw new ValidationError('text is required (up to 10,000 characters)');
      if (typeof b.filename !== 'string' || !/^[\w. -]{1,100}\.pdf$/i.test(b.filename)) throw new ValidationError('filename must be a simple name ending in .pdf');
      const replyTo = b.reply_to ? addr(b.reply_to, 'reply_to') : undefined;
      const shopName = (typeof b.shop_name === 'string' ? b.shop_name : '').replace(/[\r\n"<>\\]/g, ' ').trim().slice(0, 100) || 'Invoice';

      if (typeof b.pdf_base64 !== 'string' || b.pdf_base64.length > Math.ceil(MAX_PDF * 1.4) || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.pdf_base64)) throw new ValidationError('pdf_base64 is missing, malformed or larger than 3 MB');
      const pdf = Buffer.from(b.pdf_base64, 'base64');
      if (pdf.length > MAX_PDF) throw new ValidationError('The PDF is larger than 3 MB');
      if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ValidationError('The attachment is not a PDF');

      const links: Array<{ label: string; url: string }> = [];
      if (b.pay_links !== undefined) {
        if (!Array.isArray(b.pay_links) || b.pay_links.length > 6) throw new ValidationError('pay_links must be a list of up to 6 links');
        for (const l of b.pay_links) {
          if (!l || typeof l.label !== 'string' || typeof l.url !== 'string' || l.label.length > 40 || !isAllowedPayUrl(l.url)) throw new ValidationError('pay_links may only use https links to PayPal.Me, Venmo or Cash App');
          links.push({ label: l.label.replace(/[\r\n]/g, ' '), url: l.url });
        }
      }

      const day = new Date().toISOString().slice(0, 10);
      const used = sent.get(req.user.id); const count = used && used.day === day ? used.count : 0;
      if (count >= INVOICE_EMAIL_DAILY_LIMIT) return res.status(429).json({ error: `Daily e-mail limit reached (${INVOICE_EMAIL_DAILY_LIMIT}).` });

      const textWithLinks = links.length ? `${b.text}\n\n${links.map(l => `${l.label}: ${l.url}`).join('\n')}` : b.text;
      const result = await sendInvoiceEmail({ shopName, replyTo, to, cc, bcc, subject: noCrlf(b.subject.trim(), 'subject'), text: textWithLinks, html: renderInvoiceEmailHtml(b.text, links), pdf, filename: b.filename });
      if ('code' in result) {
        return res.status(result.code === 'smtp_not_configured' ? 503 : 502).json({ error: result.code === 'smtp_not_configured' ? 'E-mail is not configured on this server.' : 'The e-mail could not be sent.', code: result.code });
      }
      sent.set(req.user.id, { day, count: count + 1 });
      res.json({ success: true, recipients: to.length + cc.length + bcc.length });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
  });
}
