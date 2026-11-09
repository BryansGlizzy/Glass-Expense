import React, { useEffect, useState } from 'react';
import type { SheetModel } from '../../invoice/sheet';
import { SHEET_CSS } from './sheetCss';
import { footerStamp } from '../../invoice/render';

export const PRINT_BRAND = 'GlassExpense - Your Transparent Expense Tracker';

/**
 * The live preview sheet. It only RENDERS the `SheetModel` (src/invoice/sheet.ts), which carries every string and number; all values are
 * placed as React text children, so hostile content (joined jobs, imports, agents) can never become markup. No `dangerouslySetInnerHTML`.
 */
export function InvoiceSheet({ model, payLines = [], paymentBoxes = [] }: { model: SheetModel; payLines?: Array<{ text: string; url?: string }>; paymentBoxes?: string[] }) {
  const m = model;
  // Print footer (date/time + app name). The page margins are 0 so the browser adds no URL/title/date of its own; this one is ours. The time is taken
  // when the print dialog opens, so it is the moment of printing.
  const [stamp, setStamp] = useState(() => footerStamp());
  useEffect(() => {
    const on = () => setStamp(footerStamp());
    window.addEventListener('beforeprint', on);
    return () => window.removeEventListener('beforeprint', on);
  }, []);
  return (
    <>
      <style>{SHEET_CSS}</style>
      <div className="sh-printfoot" aria-hidden="true"><span>{stamp}</span><span>{PRINT_BRAND}</span><span /></div>
      <table className="sh-pg"><thead><tr><td><div className="sh-sp-top" /></td></tr></thead><tfoot><tr><td><div className="sh-sp-bot" /></td></tr></tfoot><tbody><tr><td>
      <article className="ge-sheet" id="invoice-sheet">
        <div className="sh-top">
          <div>
            {m.shop.logo && <img className="sh-logo" src={m.shop.logo} alt="" />}
            <div className="sh-shop-name">{m.shop.name}</div>
            {(m.shop.address || m.shop.contact) && <div className="sh-muted">{m.shop.address}{m.shop.address && m.shop.contact ? <br /> : null}{m.shop.contact}</div>}
            {m.shop.license && <div className="sh-license">{m.shop.license}</div>}
          </div>
          <div>
            <div className="sh-title">{m.title}</div>
            <div className={`badge ${m.status.cssClass}`} data-status={m.status.value}>{m.status.badgeText}</div>
            <table className="sh-meta"><tbody>{m.meta.map(r => (<tr key={r.label}><td className="l">{r.label}</td><td className={`v${r.mono ? ' mono' : ''}`}>{r.value}</td></tr>))}</tbody></table>
          </div>
        </div>

        <div className={`sh-parties${m.vehicle ? '' : ' one'}`}>
          <div className="sh-box"><h4>{m.customer.heading}</h4><div className="sh-cust">{m.customer.name}</div>
            <div className="sh-muted">{m.customer.details.length ? m.customer.details.map((d, i) => <React.Fragment key={i}>{i > 0 && <br />}{d}</React.Fragment>) : m.customer.emptyText}</div></div>
          {m.vehicle && <div className="sh-box"><h4>{m.vehicle.heading}</h4><div className="sh-attrs">{m.vehicle.attrs.map(a => (<div className="sh-attr" key={a.label}><span className="k">{a.label}</span><span className={`val${a.mono ? ' mono' : ''}`}>{a.value}</span></div>))}</div></div>}
        </div>

        <div className="sh-section"><div className="sh-heading">{m.labor.heading}</div>
          <table className="t"><thead><tr>{m.labor.columns.map((c, i) => <th key={c} className={i >= 2 ? 'r' : ''}>{c}</th>)}</tr></thead>
            <tbody>{m.labor.rows.length === 0 ? <tr><td colSpan={5} className="empty">{m.labor.emptyText}</td></tr> : m.labor.rows.map((r, i) => (
              <tr key={i}><td><strong>{r.description}</strong></td><td>{r.technician}</td><td className="r num">{r.hours}</td><td className="r num">{r.rate}</td><td className="r num"><strong>{r.amount}</strong></td></tr>))}</tbody>
            <tfoot><tr><td colSpan={4} className="r">{m.labor.subtotalLabel}</td><td className="r num">{m.labor.subtotal}</td></tr></tfoot></table></div>

        <div className="sh-section"><div className="sh-heading">{m.parts.heading}</div>
          <table className="t"><thead><tr>{m.parts.columns.map((c, i) => <th key={c} className={i >= 2 ? 'r' : ''}>{c}</th>)}</tr></thead>
            <tbody>{m.parts.rows.length === 0 ? <tr><td colSpan={5} className="empty">{m.parts.emptyText}</td></tr> : m.parts.rows.map((r, i) => (
              <tr key={i}><td className="mono">{r.partNumber}</td><td><strong>{r.description}</strong></td><td className="r num">{r.quantity}</td><td className="r num">{r.unitPrice}</td><td className="r num"><strong>{r.amount}</strong></td></tr>))}</tbody>
            <tfoot><tr><td colSpan={4} className="r">{m.parts.subtotalLabel}</td><td className="r num">{m.parts.subtotal}</td></tr></tfoot></table></div>

        <div className="sh-bottom">
          <div>
            <div className="sh-note"><h5>{m.notes.customer.heading}</h5><p>{m.notes.customer.text}</p></div>
            {!m.notes.terms.hidden && <div className="sh-note"><h5>{m.notes.terms.heading}</h5><p>{m.notes.terms.text}</p></div>}
          </div>
          <div className="sh-totals">{m.totals.map(l => (<div key={l.key} className={`sh-line${l.bold ? ' bold' : ''}${l.grand ? ' grand' : ''}`}><span>{l.label}</span><span className="num">{l.value}</span></div>))}</div>
        </div>

        {(payLines.length > 0 || paymentBoxes.length > 0) && <div className="sh-pay">{payLines.length > 0 && <b>HOW TO PAY</b>}{payLines.map((p, i) => <div key={i}>{p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ color: '#1d4ed8', textDecoration: 'underline', wordBreak: 'break-all' }}>{p.text}</a> : p.text}</div>)}{paymentBoxes.length > 0 && <div className="sh-paid">Payment received:{paymentBoxes.map(b => <span key={b}> [&nbsp;&nbsp;] {b}</span>)}</div>}</div>}

        <div className="sh-sign">
          {m.signature.text && <div className="sh-disc">{m.signature.text}</div>}
          <div className="sh-sigs"><div className="sh-sig"><div className="sh-line-sig" /><div className="sh-cap">{m.signature.customerCaption}</div></div><div className="sh-sig d"><div className="sh-line-sig" /><div className="sh-cap">{m.signature.dateCaption}</div></div></div>
        </div>
      </article>
      </td></tr></tbody></table>
    </>
  );
}
export default InvoiceSheet;
