import type { InvoicingSettings, PaymentMethodKey } from './settings';

/**
 * Payment methods and their links (docs/INVOICING_PLAN.md §5.11). Pure builders: adding another method is one entry. Handles are
 * validated strictly because they end up in URLs that are printed and e-mailed. The provider URL formats were checked against the
 * providers' own documentation when this was written; verify them again before relying on a new one (they can change).
 *
 *   PayPal   EITHER a PayPal payment link / button (https://www.paypal.com/ncp/payment/<ID>, made in the PayPal business dashboard; one fixed
 *            link, so the amount due is printed beside it) OR a PayPal.Me name (https://www.paypal.me/{handle}/{amount}USD, personal accounts)
 *   Venmo    https://venmo.com/{user}?txn=pay&amount=..&note=..   (Venmo payment links)
 *   Cash App https://cash.app/${cashtag}   (a pre-filled amount suffix is NOT documented, so the amount is printed beside the link)
 *   Zelle    no link format exists: show the enrolled e-mail/phone and a memo
 */

export const ALLOWED_PAY_HOSTS = ['paypal.me', 'www.paypal.me', 'venmo.com', 'cash.app'] as const;
/** PayPal payment links live on paypal.com itself, so only this exact path shape is allowed there (never the whole site). */
const PAYPAL_PAYMENT_PATH = /^\/ncp\/payment\/[A-Za-z0-9]{6,40}\/?$/;

export interface PayOption { key: PaymentMethodKey; label: string; url?: string; text: string }

const cleanHandle = (v: string, strip: RegExp): string => v.trim().replace(strip, '').replace(/^[@$]/, '').replace(/\/+$/, '');
const formatMoney = (n: number) => '$' + n.toFixed(2);
const amount2 = (n: number) => (Number.isFinite(n) && n > 0 ? n.toFixed(2) : '');

/** A PayPal payment link / hosted button URL, normalized; null for anything else. */
export function paypalPaymentLink(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.port !== '' || u.search || u.hash) return null;
    if (u.hostname !== 'www.paypal.com' && u.hostname !== 'paypal.com') return null;
    return PAYPAL_PAYMENT_PATH.test(u.pathname) ? `https://www.paypal.com${u.pathname.replace(/\/$/, '')}` : null;
  } catch { return null; }
}

export function paypalLink(handle: string, amount: number): string | null {
  const link = paypalPaymentLink(handle);
  if (link) return link;
  const h = cleanHandle(handle, /^(https?:\/\/)?(www\.)?paypal\.me\//i).split('/')[0];
  if (!/^[A-Za-z0-9]{1,20}$/.test(h)) return null;
  const a = amount2(amount);
  return `https://www.paypal.me/${h}${a ? `/${a}USD` : ''}`;
}

export function venmoLink(user: string, amount: number, note: string): string | null {
  const u = cleanHandle(user, /^(https?:\/\/)?(www\.)?venmo\.com\/(u\/)?/i).split('?')[0];
  if (!/^[A-Za-z0-9_-]{1,30}$/.test(u)) return null;
  const a = amount2(amount);
  return `https://venmo.com/${u}?txn=pay${a ? `&amount=${a}` : ''}${note ? `&note=${encodeURIComponent(note.slice(0, 140))}` : ''}`;
}

export function cashAppLink(tag: string): string | null {
  const t = cleanHandle(tag, /^(https?:\/\/)?cash\.app\/\$?/i);
  return /^[A-Za-z][A-Za-z0-9]{0,19}$/.test(t) ? `https://cash.app/$${t}` : null;
}

/** True for https URLs on a provider host we link to (used by the mailer allow-list). */
export function isAllowedPayUrl(url: string): boolean {
  try {
    const u = new URL(url);
    // No credentials ("https://user:pw@paypal.me/…" is a classic phishing shape) and no custom port.
    if (u.protocol !== 'https:' || u.username || u.password || u.port !== '') return false;
    if (u.hostname === 'paypal.com' || u.hostname === 'www.paypal.com') return !u.search && !u.hash && PAYPAL_PAYMENT_PATH.test(u.pathname);
    return (ALLOWED_PAY_HOSTS as readonly string[]).includes(u.hostname);
  } catch { return false; }
}

/** The enabled payment methods as printable/e-mailable options for a given amount due. */
export function payOptions(settings: InvoicingSettings, invoiceNumber: string, amountDue: number): PayOption[] {
  const money = amountDue > 0 ? ` (amount due ${formatMoney(amountDue)})` : '';
  const out: PayOption[] = [];
  for (const [key, m] of Object.entries(settings.payments) as Array<[PaymentMethodKey, InvoicingSettings['payments'][PaymentMethodKey]]>) {
    if (!m.enabled) continue;
    const label = m.label || key;
    const note = m.note ? ` ${m.note}` : '';
    if (key === 'paypal') {
      const url = paypalLink(m.handle, amountDue);
      // A payment link is one fixed URL, so the customer types the amount: print what is due beside it (as for Cash App). PayPal.Me carries the amount itself.
      if (url) out.push({ key, label, url, text: `${label}: ${url}${paypalPaymentLink(m.handle) ? money : ''}${note}` });
    }
    else if (key === 'venmo') { const url = venmoLink(m.handle, amountDue, `Invoice ${invoiceNumber}`.trim()); if (url) out.push({ key, label, url, text: `${label}: ${url}${note}` }); }
    else if (key === 'cashapp') { const url = cashAppLink(m.handle); if (url) out.push({ key, label, url, text: `${label}: ${url}${money}${note}` }); }
    else if (key === 'zelle') { if (m.handle.trim()) out.push({ key, label, text: `${label}: ${m.handle.trim()}${invoiceNumber ? ` (memo: ${invoiceNumber})` : ''}${note}` }); }
    // Cash / check / other: instructions only when you wrote some (a bare "Cash" line adds nothing; it still appears in the payment-received boxes).
    else if (m.handle.trim() || m.note.trim()) out.push({ key, label, text: `${label}: ${[m.handle.trim(), m.note.trim()].filter(Boolean).join(' ')}` });
  }
  return out;
}
