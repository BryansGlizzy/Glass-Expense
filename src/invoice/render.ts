import { calculateTotals } from './totals';
import { pdfFilename } from './pdf/generate';
import { generateSheetPdf } from './pdf/sheetPdf';
import { buildSheetModel, type SheetModel } from './sheet';
import { payOptions, type PayOption } from './paylinks';
import { summarizePayments } from './salestax';
import { sheetLabelsFor, type InvoicingSettings } from './settings';
import { formatCurrency } from './format';
import { decodeLogo } from './logo';
import type { Invoice } from './types';

/** Shop details always come from Settings → Invoices (they are not edited per document); a document keeps its own only if it already has them. */
export function withShop(invoice: Invoice, s: InvoicingSettings): Invoice {
  const have = (v: string) => v.trim() !== '';
  const sh = invoice.shop;
  return { ...invoice, shop: { name: have(sh.name) ? sh.name : s.shop.name, address: have(sh.address) ? sh.address : s.shop.address, phone: have(sh.phone) ? sh.phone : s.shop.phone, email: have(sh.email) ? sh.email : s.shop.email, licenseNumber: have(sh.licenseNumber) ? sh.licenseNumber : s.shop.licenseNumber } };
}

/** Everything that turns an invoice + the user's settings into the three things people see: the sheet, the PDF and the e-mail. Pure. */

/** Payment instructions for FINAL invoices only, for the balance still due. */
export function payInfo(invoice: Invoice, s: InvoicingSettings): { options: PayOption[]; boxes: string[] } {
  if (invoice.meta.docType !== 'invoice') return { options: [], boxes: [] };
  const balance = summarizePayments(invoice).balance;
  return { options: payOptions(s, invoice.meta.invoiceNumber, balance), boxes: Object.values(s.payments).filter(m => m.enabled).map(m => m.label) };
}

/** "11/9/26, 6:10 PM" — the footer stamp, same style the browser prints. */
export function footerStamp(now: Date = new Date()): string {
  return now.toLocaleString('en-US', { year: '2-digit', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** The downloaded / e-mailed PDF is drawn from the same sheet model as the preview and the print view, so all three match. */
export function renderPdf(rawInvoice: Invoice, s: InvoicingSettings, opts: { now?: Date } = {}): { bytes: Uint8Array; filename: string } {
  const invoice = withShop(rawInvoice, s);
  const { model, payLines, paymentBoxes } = renderSheet(rawInvoice, s);
  const bytes = generateSheetPdf(model, { logo: decodeLogo(s.shop.logo), payLines, paymentBoxes, generatedAt: footerStamp(opts.now) });
  return { bytes, filename: pdfFilename(invoice).replace(/^invoice-/, invoice.meta.docType === 'estimate' ? 'estimate-' : 'invoice-') };
}

export function renderSheet(rawInvoice: Invoice, s: InvoicingSettings): { model: SheetModel; payLines: Array<{ text: string; url?: string }>; paymentBoxes: string[] } {
  const invoice = withShop(rawInvoice, s);
  const pay = payInfo(invoice, s);
  return { model: buildSheetModel(invoice, calculateTotals(invoice), sheetLabelsFor(s), { logo: s.shop.logo }), payLines: pay.options.map(o => ({ text: o.text, url: o.url })), paymentBoxes: pay.boxes };
}

const docTitle = (i: Invoice) => (i.meta.docType === 'estimate' ? 'Estimate' : 'Invoice');

/** Fills `{{docTitle}} {{invoice.number}} {{shop.name}} {{shop.phone}} {{customer.name}} {{customer.firstName}} {{total}} {{payOptions}}`. Unknown placeholders stay. */
export function fillEmailTemplate(tpl: string, invoice: Invoice, s: InvoicingSettings): string {
  const total = calculateTotals(invoice).grandTotal;
  const due = invoice.meta.docType === 'invoice' ? summarizePayments(invoice).balance : total;
  const vars: Record<string, string> = {
    docTitle: docTitle(invoice), 'invoice.number': invoice.meta.invoiceNumber, 'shop.name': invoice.shop.name || s.shop.name, 'shop.phone': invoice.shop.phone || s.shop.phone,
    'customer.name': invoice.customer.name, 'customer.firstName': invoice.customer.name.trim().split(/\s+/)[0] || 'there', total: formatCurrency(due),
    payOptions: payInfo(invoice, s).options.length ? `You can pay with:\n${payInfo(invoice, s).options.map(o => `- ${o.text}`).join('\n')}` : '',
  };
  return tpl.replace(/\{\{([\w.]+)\}\}/g, (m, k) => (k in vars ? vars[k] : m)).replace(/\n{3,}/g, '\n\n').trim();
}
