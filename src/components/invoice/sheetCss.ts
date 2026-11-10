/**
 * Styles for the paper preview sheet. The sheet keeps a paper design (white page, typography, card boxes, tables,
 * totals box, status badges) regardless of GE's dark glass theme, scoped under `.ge-sheet` so nothing leaks. Kept as a string so the
 * component can be rendered without a CSS loader (server-side smoke tests).
 */
export const SHEET_CSS = `
.ge-sheet{background:#fff;color:#111827;font:13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:36px 40px;border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.35);max-width:8.5in;margin:0 auto;box-sizing:border-box}
.ge-sheet *{box-sizing:border-box}
.ge-sheet .sh-top{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #e5e7eb;padding-bottom:14px;margin-bottom:16px}
.ge-sheet .sh-logo{display:block;max-height:56px;max-width:160px;margin-bottom:6px;object-fit:contain}
.ge-sheet .sh-shop-name{font-size:20px;font-weight:800;color:#0f172a;line-height:1.2}
.ge-sheet .sh-muted{color:#64748b;font-size:12px}
.ge-sheet .sh-license{display:inline-block;margin-top:4px;font-size:11px;color:#475569;background:#f1f5f9;border-radius:4px;padding:1px 6px}
.ge-sheet .sh-title{font-size:26px;font-weight:800;color:#0f172a;text-align:right;letter-spacing:.04em}
.ge-sheet .sh-meta{margin-top:6px;margin-left:auto;font-size:12px}
.ge-sheet .sh-meta td{padding:1px 0 1px 10px}.ge-sheet .sh-meta .l{color:#64748b;text-align:right}.ge-sheet .sh-meta .v{font-weight:600;text-align:right}
.ge-sheet .badge{display:inline-block;float:right;clear:both;font-size:10px;font-weight:800;letter-spacing:.06em;border-radius:999px;padding:2px 9px;background:#e2e8f0;color:#334155;margin-bottom:4px}
.ge-sheet .badge-estimate,.ge-sheet .badge-sent{background:#dbeafe;color:#1d4ed8}.ge-sheet .badge-approved{background:#dcfce7;color:#15803d}
.ge-sheet .badge-paid{background:#bbf7d0;color:#166534}.ge-sheet .badge-overdue{background:#fee2e2;color:#b91c1c}.ge-sheet .badge-draft{background:#f1f5f9;color:#475569}
.ge-sheet .sh-parties{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.ge-sheet .sh-parties.one{grid-template-columns:1fr}
.ge-sheet .sh-box{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;background:#f8fafc}
.ge-sheet .sh-box h4{margin:0 0 6px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
.ge-sheet .sh-cust{font-weight:700;font-size:14px}
.ge-sheet .sh-attrs{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}.ge-sheet .sh-attr{display:flex;flex-direction:column;min-width:0}
.ge-sheet .sh-attr .k{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.04em}.ge-sheet .sh-attr .val{font-weight:600;word-break:break-word}
.ge-sheet .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ge-sheet .sh-section{margin-bottom:14px}.ge-sheet .sh-heading{font-size:12px;font-weight:800;color:#0f172a;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
.ge-sheet table.t{width:100%;border-collapse:collapse}.ge-sheet table.t th{background:#f1f5f9;text-align:left;font-size:11px;padding:6px 8px;border:1px solid #e2e8f0;color:#334155}
.ge-sheet table.t td{padding:6px 8px;border:1px solid #e2e8f0;vertical-align:top;word-break:break-word}.ge-sheet table.t tbody tr:nth-child(even) td{background:#fafcff}
.ge-sheet .r{text-align:right}.ge-sheet .num{font-variant-numeric:tabular-nums}.ge-sheet .empty{text-align:center;color:#94a3b8;padding:10px}
.ge-sheet table.t tfoot td{background:#f1f5f9;font-weight:700}
.ge-sheet .sh-bottom{display:grid;grid-template-columns:1.2fr 1fr;gap:16px;margin-top:6px}
.ge-sheet .sh-note{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:8px}.ge-sheet .sh-note h5{margin:0 0 4px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#475569}
.ge-sheet .sh-note p{margin:0;white-space:pre-wrap;font-size:11.5px;color:#334155}
.ge-sheet .sh-totals{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;align-self:start}
.ge-sheet .sh-line{display:flex;justify-content:space-between;padding:5px 10px;font-size:12px;border-bottom:1px solid #f1f5f9}.ge-sheet .sh-line.bold{font-weight:700}
.ge-sheet .sh-line.grand{background:#0f172a;color:#fff;font-weight:800;font-size:14px;border:0;padding:9px 10px}
.ge-sheet .sh-sign{margin-top:18px;border-top:1px solid #e2e8f0;padding-top:10px}.ge-sheet .sh-disc{font-size:10.5px;color:#64748b;margin-bottom:22px;white-space:pre-wrap}
.ge-sheet .sh-sigs{display:flex;gap:24px}.ge-sheet .sh-sig{flex:1}.ge-sheet .sh-sig.d{flex:0 0 120px}.ge-sheet .sh-line-sig{border-bottom:1px solid #0f172a;height:22px}.ge-sheet .sh-cap{font-size:10px;color:#64748b;margin-top:3px}
.sh-pg{border-collapse:collapse;width:100%;border:0}.sh-pg td{padding:0;border:0}.sh-sp-top,.sh-sp-bot{height:0}.sh-printfoot{display:none}.ge-sheet .sh-paid{margin-top:4px}.ge-sheet .sh-pay{margin-top:12px;border:1px dashed #cbd5e1;border-radius:8px;padding:8px 10px;font-size:11.5px}.ge-sheet .sh-pay b{display:block;font-size:10px;letter-spacing:.06em;color:#475569;margin-bottom:3px}
@media (max-width:680px){.ge-sheet{padding:18px 14px}.ge-sheet .sh-top,.ge-sheet .sh-bottom,.ge-sheet .sh-parties{display:block}.ge-sheet .sh-title{text-align:left;margin-top:8px}.ge-sheet .sh-meta{margin-left:0}.ge-sheet .badge{float:none}.ge-sheet .sh-parties>*{margin-bottom:10px}.ge-sheet table.t{font-size:11px}}
`;
