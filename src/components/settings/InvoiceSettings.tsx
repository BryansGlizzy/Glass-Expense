import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Download, Plus, Trash2, Upload, X } from 'lucide-react';
import { normalizeSettings, effectiveRates, newFeeId, slugKey, FIELD_PRESETS, PAYMENT_METHOD_KEYS, DEFAULT_EMAIL_BODY, DEFAULT_EMAIL_SUBJECT, type FeeTemplate, type FieldDef, type InvoicingSettings } from '../../invoice/settings';
import { FEE_KINDS, FIELD_TYPES, type FeeKind, type FieldType } from '../../invoice/types';
import { automotiveStarter, normalizePackage, normalizePackages, packagesFromServices, PACKAGE_LIMITS, type ServicePackage } from '../../invoice/packages';
import { payOptions } from '../../invoice/paylinks';
import { downloadBytes, jobsApi, packagesApi, settingsApi } from '../../invoice/client';
import { prepareLogo } from '../../invoice/logoUpload';
import { Btn, Card, Field, NumIn, Notice, TextIn, inputCls } from '../invoice/ui';

/** Settings → Invoices (docs/INVOICING_PLAN.md §5.6): shop, rates & fees as variables, tax, defaults, labels, terms, payments, e-mail, automation, and the Service Packages builder. */
export default function InvoiceSettings() {
  const [s, setS] = useState<InvoicingSettings | null>(null);
  const [pkgs, setPkgs] = useState<ServicePackage[]>([]);
  const [siteServices, setSiteServices] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([settingsApi.get(), packagesApi.get(), jobsApi.list()]).then(([a, b, jobs]) => {
      if (!alive) return; setS(a); setPkgs(b); setSiteServices([...new Set(jobs.flatMap(j => (j.intake?.source === 'api' ? j.intake.services : [])))]);
    }).catch(e => alive && setMsg({ tone: 'error', text: e.message }));
    return () => { alive = false; };
  }, []);

  if (!s) return <div className="text-sm text-gray-400 py-6">{msg ? <Notice tone="error">{msg.text}</Notice> : 'Loading invoice settings…'}</div>;
  const up = <K extends keyof InvoicingSettings>(k: K, patch: Partial<InvoicingSettings[K]>) => setS(cur => (cur ? { ...cur, [k]: { ...(cur[k] as object), ...patch } } as InvoicingSettings : cur));
  const rates = effectiveRates(s);
  const save = async () => { setSaving(true); setMsg(null); try { setS(await settingsApi.save(s)); setMsg({ tone: 'ok', text: 'Invoice settings saved.' }); } catch (e: any) { setMsg({ tone: 'error', text: e.message }); } finally { setSaving(false); } };
  const exportSettings = () => downloadBytes(new TextEncoder().encode(JSON.stringify(s, null, 2)), 'invoice-settings.json', 'application/json');
  const importSettings = async (f?: File) => { if (!f) return; try { setS(normalizeSettings(JSON.parse(await f.text()))); setMsg({ tone: 'ok', text: 'Imported. Review the values, then press Save.' }); } catch { setMsg({ tone: 'error', text: 'That file is not valid settings JSON.' }); } };
  const previewLinks = payOptions(s, 'INV-1', 100);

  return (
    <div className="space-y-4 mb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-xl font-semibold text-white">Invoices &amp; Estimates</h2><p className="text-sm text-gray-400">Everything here is encrypted in your browser. Values you set are used for every new document; nothing is applied silently.</p></div>
        <div className="flex gap-2"><label className="inline-flex"><input type="file" accept="application/json" className="hidden" onChange={e => importSettings(e.target.files?.[0])} /><span className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/10 cursor-pointer"><Upload className="w-3.5 h-3.5" />Import</span></label>
          <Btn size="sm" onClick={exportSettings}><Download className="w-3.5 h-3.5" />Export</Btn><Btn variant="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save invoice settings'}</Btn></div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card title="Shop profile">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Business name"><TextIn value={s.shop.name} onChange={v => up('shop', { name: v })} /></Field><Field label="License / ID #"><TextIn value={s.shop.licenseNumber} onChange={v => up('shop', { licenseNumber: v })} /></Field>
          <Field label="Phone"><TextIn value={s.shop.phone} onChange={v => up('shop', { phone: v })} /></Field><Field label="E-mail"><TextIn type="email" value={s.shop.email} onChange={v => up('shop', { email: v })} /></Field>
          <Field label="Address" className="sm:col-span-2"><TextIn value={s.shop.address} onChange={v => up('shop', { address: v })} /></Field>
          <Field label="Invoice number prefix" hint="Job invoice numbers look like PREFIX-A00001"><TextIn value={s.numbering.prefix} maxLength={20} onChange={v => up('numbering', { prefix: v.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() })} /></Field>
          <div className="sm:col-span-2">
            <span className="block text-xs font-medium text-gray-400 mb-1">Company logo</span>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="h-16 w-40 rounded-xl bg-white flex items-center justify-center overflow-hidden border border-white/10">{s.shop.logo ? <img src={s.shop.logo} alt="Logo preview" className="max-h-14 max-w-[9.5rem] object-contain" /> : <span className="text-[11px] text-gray-500">No logo</span>}</div>
              <label className="inline-flex"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { up('shop', { logo: await prepareLogo(f) }); setMsg({ tone: 'ok', text: 'Logo ready. Press Save invoice settings to keep it.' }); } catch (err: any) { setMsg({ tone: 'error', text: err.message }); } }} /><span className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10 cursor-pointer"><Upload className="w-4 h-4" />Upload logo</span></label>
              {s.shop.logo && <Btn size="sm" variant="ghost" onClick={() => up('shop', { logo: '' })}>Remove</Btn>}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">Shown at the top left of estimates and invoices and embedded in the PDF. It is resized and stored encrypted with your settings. (The “Company Logo URL” in the older company profile below is only used on reports; a web address cannot be embedded in a PDF.)</p>
          </div>
        </div>
      </Card>

      <Card title="Hourly rate">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3"><Field label="Hourly rate ($)"><NumIn min="0" step="1" value={s.rates.hourlyRate} onChange={v => up('rates', { hourlyRate: v })} /></Field></div>
        <label className="flex items-start gap-2 mt-4 text-sm text-gray-200"><input type="checkbox" className="mt-1" checked={s.rates.followWebsite} onChange={e => up('rates', { followWebsite: e.target.checked })} />
          <span><b>Follow website rates.</b> New documents use the latest hourly rate and fee variables your website posted instead of your own values (your website is the source of truth). Turn off to pin your own.
            {s.rates.websiteQuote ? <span className="block text-xs text-sky-300 mt-1">Latest from the website ({s.rates.websiteQuote.at.slice(0, 10)}): {s.rates.websiteQuote.hourlyRate != null ? `$${s.rates.websiteQuote.hourlyRate}/hr` : 'no hourly rate'}{s.rates.websiteQuote.baseFee != null ? `, base_fee $${s.rates.websiteQuote.baseFee}` : ''}{Object.entries(s.rates.websiteQuote.variables).map(([k, v]) => `, ${k} ${v}`).join('')}. {rates.fromWebsite ? 'The hourly rate is taken from it.' : 'Your own hourly rate is being used.'}</span> : <span className="block text-xs text-gray-500 mt-1">No website quote received yet.</span>}</span></label>
      </Card>

      <FeeBuilder fees={s.fees} onChange={fees => setS(cur => (cur ? { ...cur, fees } : cur))} />
      <FieldBuilder details={s.details} onChange={details => setS(cur => (cur ? { ...cur, details } : cur))} />

      <Card title="Sales tax">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Sales tax rate (%)" hint="0 = you do not charge sales tax (the default)"><NumIn min="0" max="100" step="0.01" value={s.tax.rate} onChange={v => up('tax', { rate: v })} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-gray-200"><input type="checkbox" checked={s.tax.taxLabor} onChange={e => up('tax', { taxLabor: e.target.checked })} />Tax labor as well as parts</label>
        </div>
        <fieldset className="mt-3 text-sm text-gray-200 space-y-1"><legend className="text-xs text-gray-400 mb-1">When a customer pays an invoice that includes tax, the income entry is…</legend>
          <label className="flex items-center gap-2"><input type="radio" name="inc" checked={s.tax.incomeMode === 'exclude'} onChange={() => up('tax', { incomeMode: 'exclude' })} />the payment <b>minus</b> the tax portion (recommended: tax is not your revenue)</label>
          <label className="flex items-center gap-2"><input type="radio" name="inc" checked={s.tax.incomeMode === 'include'} onChange={() => up('tax', { incomeMode: 'include' })} />the full payment (your accountant wants gross receipts)</label></fieldset>
        <p className="text-[11px] text-gray-500 mt-2">This is bookkeeping logic, not tax advice. If you charge sales tax, confirm the treatment with your accountant.</p>
      </Card>

      <Card title="Defaults for new documents">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Estimate valid for (days)"><NumIn min="0" value={s.defaults.estimateValidDays} onChange={v => up('defaults', { estimateValidDays: v })} /></Field>
          <Field label="Invoice due in (days, 0 = none)"><NumIn min="0" value={s.defaults.dueDays} onChange={v => up('defaults', { dueDays: v })} /></Field>
          <Field label="Discount type"><select className={inputCls} value={s.defaults.discountType} onChange={e => up('defaults', { discountType: e.target.value as 'percent' | 'fixed' })}><option value="percent">Percentage (%)</option><option value="fixed">Fixed ($)</option></select></Field>
          <Field label="Default discount"><NumIn min="0" step="0.01" value={s.defaults.discountValue} onChange={v => up('defaults', { discountValue: v })} /></Field>
        </div>
        <label className="flex items-start gap-2 mt-3 text-sm text-gray-200"><input type="checkbox" className="mt-1" checked={s.defaults.layout2} onChange={e => up('defaults', { layout2: e.target.checked })} /><span><b>Round each line to the cent and show hours to two decimals on new documents.</b> Documents already made keep the settings they were created with. (The PDF design itself is always the same as the preview.)</span></label>
      </Card>

      <Card title="Terms & documents">
        <div className="space-y-3">
          <Field label="Customer notes (default)"><textarea rows={2} className={inputCls} value={s.terms.customerNotes} onChange={e => up('terms', { customerNotes: e.target.value })} /></Field>
          <Field label="Estimate terms"><textarea rows={4} className={inputCls} value={s.terms.estimateTerms} onChange={e => up('terms', { estimateTerms: e.target.value })} /></Field>
          <Field label="Invoice terms"><textarea rows={4} className={inputCls} value={s.terms.invoiceTerms} onChange={e => up('terms', { invoiceTerms: e.target.value })} /></Field>
          <Field label="Added to the terms when the customer supplies their own parts" hint="Leave empty to add nothing."><textarea rows={2} className={inputCls} value={s.terms.ownPartsClause} onChange={e => up('terms', { ownPartsClause: e.target.value })} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Estimate authorization text (printed above the signature line)"><textarea rows={3} className={inputCls} value={s.terms.estimateSignature} onChange={e => up('terms', { estimateSignature: e.target.value })} /></Field>
            <Field label="Invoice completion text (printed above the signature line)"><textarea rows={3} className={inputCls} value={s.terms.invoiceSignature} onChange={e => up('terms', { invoiceSignature: e.target.value })} /></Field></div>
          <p className="text-[11px] text-gray-500">GlassExpense only stores and prints this wording. Have it reviewed by you or counsel; it is never taken from another business.</p>
        </div>
      </Card>

      <Card title="Payments">
        <div className="space-y-2">{PAYMENT_METHOD_KEYS.map(k => { const m = s.payments[k]; const needsHandle = k === 'paypal' || k === 'venmo' || k === 'cashapp' || k === 'zelle';
          return (<div key={k} className="grid grid-cols-12 gap-2 items-center"><label className="col-span-12 sm:col-span-3 flex items-center gap-2 text-sm text-gray-200"><input type="checkbox" checked={m.enabled} onChange={e => up('payments', { [k]: { ...m, enabled: e.target.checked } } as any)} />{m.label}</label>
            <div className="col-span-12 sm:col-span-4"><TextIn placeholder={k === 'paypal' ? 'PayPal payment link (https://www.paypal.com/ncp/payment/…) or PayPal.Me name' : k === 'venmo' ? 'Venmo username' : k === 'cashapp' ? '$cashtag' : k === 'zelle' ? 'Zelle e-mail or phone' : 'Details (optional)'} value={m.handle} onChange={v => up('payments', { [k]: { ...m, handle: v } } as any)} disabled={!needsHandle && !m.enabled} /></div>
            <div className="col-span-12 sm:col-span-5"><TextIn placeholder="Note shown to the customer (optional)" value={m.note} onChange={v => up('payments', { [k]: { ...m, note: v } } as any)} /></div></div>); })}</div>
        {previewLinks.length > 0 && <div className="mt-3 rounded-xl bg-black/20 border border-white/10 p-3 text-xs text-gray-300 space-y-1"><div className="text-gray-500 uppercase tracking-wide text-[10px]">Preview for a $100.00 invoice</div>{previewLinks.map(o => <div key={o.key} className="break-all">{o.text}</div>)}</div>}
        <p className="text-[11px] text-gray-500 mt-2">For PayPal paste either the payment link from your PayPal business dashboard (one fixed link, so the amount due is printed beside it) or a PayPal.Me name (personal accounts; the amount is included in the link). The PayPal “button” code for websites is not needed: the link works everywhere. Zelle has no payment links; your enrolled e-mail or phone is printed instead. Payments are recorded by hand with “Record payment”.</p>
      </Card>

      <Card title="E-mail">
        <label className="flex items-start gap-2 text-sm text-gray-200"><input type="checkbox" className="mt-1" checked={s.email.enabled} onChange={e => up('email', { enabled: e.target.checked })} /><span><b>Send invoices from GlassExpense.</b> When you press Send, the PDF is passed through this server in memory so it can be e-mailed from the server’s mail account. It is not stored or logged, but this is one exception to end-to-end encryption. Leave off to use your own mail app.</span></label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3"><Field label="Reply-To address"><TextIn type="email" value={s.email.replyTo} onChange={v => up('email', { replyTo: v })} placeholder={s.shop.email || 'you@example.com'} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-gray-200"><input type="checkbox" checked={s.email.bccMe} onChange={e => up('email', { bccMe: e.target.checked })} />Send me a copy (Bcc)</label>
          <Field label="Subject template" className="sm:col-span-2"><TextIn value={s.email.subject} onChange={v => up('email', { subject: v })} /></Field>
          <Field label="Message template" className="sm:col-span-2" hint="Variables: {{docTitle}} {{invoice.number}} {{shop.name}} {{shop.phone}} {{customer.name}} {{customer.firstName}} {{total}} {{payOptions}}"><textarea rows={7} className={inputCls} value={s.email.body} onChange={e => up('email', { body: e.target.value })} /></Field></div>
        <Btn size="sm" variant="ghost" className="mt-2" onClick={() => up('email', { subject: DEFAULT_EMAIL_SUBJECT, body: DEFAULT_EMAIL_BODY })}>Reset templates</Btn>
      </Card>

      <Card title="Automation">
        <label className="flex items-start gap-2 text-sm text-gray-200"><input type="checkbox" className="mt-1" checked={s.automation.autoDraft} onChange={e => up('automation', { autoDraft: e.target.checked })} /><span><b>Draft an estimate automatically</b> for jobs your website posts. Drafts are private, deletable and never sent. If an AI endpoint is set up, hours are suggested too.</span></label>
        <label className="flex items-start gap-2 mt-2 text-sm text-gray-200"><input type="checkbox" className="mt-1" checked={s.automation.requireVerification} onChange={e => up('automation', { requireVerification: e.target.checked })} /><span>Block sending until AI-drafted lines are marked as verified.</span></label>
      </Card>

      <PackageBuilder packages={pkgs} setPackages={setPkgs} siteServices={siteServices} hourlyRate={rates.hourlyRate} />
    </div>
  );
}

function PackageBuilder({ packages, setPackages, siteServices, hourlyRate }: { packages: ServicePackage[]; setPackages: (p: ServicePackage[]) => void; siteServices: string[]; hourlyRate: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [note, setNote] = useState('');
  const persist = async (next: ServicePackage[]) => { try { setPackages(await packagesApi.save(next)); setNote('Saved.'); } catch (e: any) { setNote(e.message); } };
  const sel = packages.find(p => p.id === selected) ?? null;
  const shown = useMemo(() => packages.filter(p => !q.trim() || p.name.toLowerCase().includes(q.toLowerCase())), [packages, q]);
  const edit = (patch: Partial<ServicePackage>) => sel && setPackages(packages.map(p => (p.id === sel.id ? { ...p, ...patch } : p)));
  const move = (id: string, d: number) => { const i = packages.findIndex(p => p.id === id), j = i + d; if (j < 0 || j >= packages.length) return; const c = [...packages]; [c[i], c[j]] = [c[j], c[i]]; void persist(c.map((p, k) => ({ ...p, order: k + 1 }))); };
  const add = () => { const p = normalizePackage({ id: crypto.randomUUID(), name: 'New package', order: packages.length + 1, labor: [{ description: '', hours: 1, rate: null }] }); setPackages([...packages, p]); setSelected(p.id); };
  const sub = sel ? sel.labor.reduce((s, l) => s + l.hours * (l.rate ?? hourlyRate), 0) + sel.parts.reduce((s, p) => s + p.quantity * p.unitPrice, 0) : 0;
  const exportPkgs = (list: ServicePackage[]) => downloadBytes(new TextEncoder().encode(JSON.stringify({ packages: list }, null, 2)), 'service-packages.json', 'application/json');
  const importPkgs = async (f?: File) => { if (!f) return; try { const inc = normalizePackages(JSON.parse(await f.text())).map(p => ({ ...p, id: crypto.randomUUID() })); await persist([...packages, ...inc].slice(0, PACKAGE_LIMITS.packages)); } catch { setNote('That file is not a valid packages file.'); } };

  return (
    <Card title={`Service packages (${packages.length})`} right={<span className="flex gap-1.5 flex-wrap">
      <Btn size="sm" onClick={add} disabled={packages.length >= PACKAGE_LIMITS.packages}><Plus className="w-3.5 h-3.5" />New</Btn>
      <label className="inline-flex"><input type="file" accept="application/json" className="hidden" onChange={e => importPkgs(e.target.files?.[0])} /><span className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/10 cursor-pointer"><Upload className="w-3.5 h-3.5" />Import</span></label>
      <Btn size="sm" disabled={!packages.length} onClick={() => exportPkgs(packages)}><Download className="w-3.5 h-3.5" />Export all</Btn></span>}>
      <p className="text-xs text-gray-400 mb-3">A package is a one-click bundle of labor lines, parts and (optionally) a fee. Leave a labor rate blank to use your hourly rate at the moment you apply it. No prices or hours are ever invented for you.</p>
      {packages.length === 0 && <div className="flex flex-wrap gap-2 mb-3"><Btn size="sm" onClick={() => persist(automotiveStarter())}>Add the automotive starter set (examples to edit)</Btn>{siteServices.length > 0 && <Btn size="sm" onClick={() => persist(packagesFromServices(siteServices, packages))}>Create packages from my website’s services ({siteServices.length})</Btn>}</div>}
      {packages.length > 0 && siteServices.some(x => !packages.some(p => p.matches.includes(x) || p.name === x)) && <div className="mb-3"><Btn size="sm" onClick={() => persist([...packages, ...packagesFromServices(siteServices, packages)])}>Add empty packages for my website’s other services</Btn></div>}
      {packages.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          <div><TextIn placeholder="Search packages" value={q} onChange={setQ} />
            <ul className="mt-2 max-h-80 overflow-y-auto space-y-1">{shown.map(p => (
              <li key={p.id} className={`flex items-center gap-1 rounded-xl border px-2 py-1.5 ${p.id === selected ? 'border-[#7c3bed]/60 bg-[#7c3bed]/10' : 'border-white/5 bg-white/5'}`}>
                <button className="flex-1 text-left text-sm text-gray-100 truncate" onClick={() => setSelected(p.id)}>{p.icon} {p.name}</button>
                <button aria-label="Move up" className="text-gray-400 hover:text-white" onClick={() => move(p.id, -1)}><ChevronUp className="w-4 h-4" /></button><button aria-label="Move down" className="text-gray-400 hover:text-white" onClick={() => move(p.id, 1)}><ChevronDown className="w-4 h-4" /></button>
                <button aria-label="Duplicate" className="text-gray-400 hover:text-white" onClick={() => void persist([...packages, { ...p, id: crypto.randomUUID(), name: `${p.name} (copy)`, order: packages.length + 1 }])}><Copy className="w-3.5 h-3.5" /></button>
                <button aria-label="Delete package" className="text-gray-400 hover:text-red-400" onClick={() => { if (window.confirm(`Delete “${p.name}”?`)) { void persist(packages.filter(x => x.id !== p.id)); if (selected === p.id) setSelected(null); } }}><Trash2 className="w-3.5 h-3.5" /></button></li>))}</ul></div>
          <div>{!sel ? <p className="text-sm text-gray-500 py-8 text-center">Choose a package to edit it.</p> : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_80px] gap-3"><Field label="Name"><TextIn value={sel.name} onChange={v => edit({ name: v })} /></Field><Field label="Icon"><TextIn value={sel.icon} maxLength={4} onChange={v => edit({ icon: v })} placeholder="🛠" /></Field></div>
              <Field label="Fulfils these website services (comma separated)" hint="Used to highlight the package as Suggested on matching jobs."><TextIn value={sel.matches.join(', ')} onChange={v => edit({ matches: v.split(',').map(x => x.trim()).filter(Boolean) })} /></Field>
              <div><div className="flex items-center justify-between mb-1"><span className="text-xs text-gray-400">Labor lines</span><Btn size="sm" disabled={sel.labor.length >= PACKAGE_LIMITS.lines} onClick={() => edit({ labor: [...sel.labor, { description: '', technician: '', hours: 1, rate: null }] })}><Plus className="w-3 h-3" />Add</Btn></div>
                {sel.labor.map((l, i) => (<div key={i} className="grid grid-cols-12 gap-2 mb-1.5"><div className="col-span-12 sm:col-span-6"><TextIn placeholder="Description" value={l.description} onChange={v => edit({ labor: sel.labor.map((x, k) => (k === i ? { ...x, description: v } : x)) })} /></div>
                  <div className="col-span-4 sm:col-span-2"><NumIn step="0.1" min="0" value={l.hours} onChange={v => edit({ labor: sel.labor.map((x, k) => (k === i ? { ...x, hours: v } : x)) })} /></div>
                  <div className="col-span-5 sm:col-span-3"><input type="number" min="0" className={inputCls} placeholder={`rate (${hourlyRate || 'hourly'})`} value={l.rate ?? ''} onChange={e => edit({ labor: sel.labor.map((x, k) => (k === i ? { ...x, rate: e.target.value === '' ? null : Number(e.target.value) || 0 } : x)) })} /></div>
                  <button aria-label="Remove labor line" className="col-span-3 sm:col-span-1 text-gray-500 hover:text-red-400" onClick={() => edit({ labor: sel.labor.filter((_, k) => k !== i) })}><X className="w-4 h-4 mx-auto" /></button></div>))}</div>
              <div><div className="flex items-center justify-between mb-1"><span className="text-xs text-gray-400">Parts</span><Btn size="sm" disabled={sel.parts.length >= PACKAGE_LIMITS.lines} onClick={() => edit({ parts: [...sel.parts, { partNumber: '', description: '', quantity: 1, unitPrice: 0 }] })}><Plus className="w-3 h-3" />Add</Btn></div>
                {sel.parts.map((p, i) => (<div key={i} className="grid grid-cols-12 gap-2 mb-1.5"><div className="col-span-4 sm:col-span-2"><TextIn placeholder="Part #" value={p.partNumber} onChange={v => edit({ parts: sel.parts.map((x, k) => (k === i ? { ...x, partNumber: v } : x)) })} /></div>
                  <div className="col-span-8 sm:col-span-5"><TextIn placeholder="Description" value={p.description} onChange={v => edit({ parts: sel.parts.map((x, k) => (k === i ? { ...x, description: v } : x)) })} /></div>
                  <div className="col-span-4 sm:col-span-2"><NumIn min="0" value={p.quantity} onChange={v => edit({ parts: sel.parts.map((x, k) => (k === i ? { ...x, quantity: v } : x)) })} /></div>
                  <div className="col-span-5 sm:col-span-2"><NumIn min="0" step="0.01" value={p.unitPrice} onChange={v => edit({ parts: sel.parts.map((x, k) => (k === i ? { ...x, unitPrice: v } : x)) })} /></div>
                  <button aria-label="Remove part" className="col-span-3 sm:col-span-1 text-gray-500 hover:text-red-400" onClick={() => edit({ parts: sel.parts.filter((_, k) => k !== i) })}><X className="w-4 h-4 mx-auto" /></button></div>))}</div>
              <div><div className="flex items-center justify-between mb-1"><span className="text-xs text-gray-400">Fees this package sets (matched by name; never added twice)</span><Btn size="sm" onClick={() => edit({ fees: [...sel.fees, { label: 'Fee', kind: 'flat', value: 0, cap: 0, taxable: false }] })}><Plus className="w-3 h-3" />Add</Btn></div>
                {sel.fees.map((f, i) => (<div key={i} className="grid grid-cols-12 gap-2 mb-1.5"><div className="col-span-6 sm:col-span-5"><TextIn placeholder="Fee name" value={f.label} onChange={v => edit({ fees: sel.fees.map((x, k) => (k === i ? { ...x, label: v } : x)) })} /></div>
                  <div className="col-span-6 sm:col-span-3"><select className={inputCls} value={f.kind} onChange={e => edit({ fees: sel.fees.map((x, k) => (k === i ? { ...x, kind: e.target.value as FeeKind } : x)) })}>{FEE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
                  <div className="col-span-8 sm:col-span-3"><NumIn step="0.01" min="0" value={f.value} onChange={v => edit({ fees: sel.fees.map((x, k) => (k === i ? { ...x, value: v } : x)) })} /></div>
                  <button aria-label="Remove fee" className="col-span-4 sm:col-span-1 text-gray-500 hover:text-red-400" onClick={() => edit({ fees: sel.fees.filter((_, k) => k !== i) })}><X className="w-4 h-4 mx-auto" /></button></div>))}</div>
              <Field label="Note added to the customer notes (once)"><TextIn value={sel.customerNote} onChange={v => edit({ customerNote: v })} /></Field>
              <div className="flex items-center justify-between"><span className="text-xs text-gray-400">Lines subtotal at your current rate: <b className="text-gray-200">${sub.toFixed(2)}</b></span>
                <span className="flex gap-2"><Btn size="sm" onClick={() => exportPkgs([sel])}>Export this one</Btn><Btn size="sm" variant="primary" onClick={() => void persist(packages)}>Save packages</Btn></span></div>
            </div>)}</div>
        </div>)}
      {note && <p className="text-xs text-gray-400 mt-2">{note}</p>}
    </Card>
  );
}

const KIND_LABEL: Record<FeeKind, string> = { flat: 'Flat amount ($)', percentOfLabor: '% of labor', percentOfSubtotal: '% of subtotal' };
const TYPE_LABEL: Record<FieldType, string> = { text: 'Text', number: 'Number', date: 'Date', vin: 'VIN (checked)' };

/** Fees you charge: any number, each flat or a percentage, optionally capped or taxable, optionally following a variable your website posts. */
function FeeBuilder({ fees, onChange }: { fees: FeeTemplate[]; onChange: (f: FeeTemplate[]) => void }) {
  const upd = (id: string, patch: Partial<FeeTemplate>) => onChange(fees.map(f => (f.id === id ? { ...f, ...patch } : f)));
  return (
    <Card title="Fees" right={<Btn size="sm" disabled={fees.length >= 20} onClick={() => onChange([...fees, { id: newFeeId(), label: 'New fee', kind: 'flat', value: 0, cap: 0, taxable: false, auto: true, quoteKey: '' }])}><Plus className="w-3.5 h-3.5" />Add fee</Btn>}>
      <p className="text-xs text-gray-400 mb-3">Define the fees your business charges (trip charge, materials, disposal, rush, travel…) and name them however you like. Fees marked <b>add to new documents</b> appear on every new estimate; you can add, edit or remove fees on any single document too. A fee can follow a variable your website posts (for example <code>base_fee</code>), so the website stays the source of truth for that amount.</p>
      {fees.length === 0 && <p className="text-sm text-gray-500 py-2">No fees yet. Without any, documents show only labor, parts, discount and tax.</p>}
      <div className="space-y-3">{fees.map(f => (
        <div key={f.id} className="rounded-xl border border-white/5 bg-black/10 p-3">
          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-12 sm:col-span-4"><Field label="Name on the invoice"><TextIn value={f.label} onChange={v => upd(f.id, { label: v })} /></Field></div>
            <div className="col-span-6 sm:col-span-3"><Field label="Type"><select className={inputCls} value={f.kind} onChange={e => upd(f.id, { kind: e.target.value as FeeKind })}>{FEE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field></div>
            <div className="col-span-3 sm:col-span-2"><Field label={f.kind === 'flat' ? 'Amount ($)' : 'Percent (%)'}><NumIn min="0" step="0.01" value={f.value} onChange={v => upd(f.id, { value: v })} /></Field></div>
            <div className="col-span-3 sm:col-span-2">{f.kind !== 'flat' && <Field label="Cap ($, 0 = none)"><NumIn min="0" step="1" value={f.cap} onChange={v => upd(f.id, { cap: v })} /></Field>}</div>
            <button aria-label={`Delete ${f.label}`} className="col-span-12 sm:col-span-1 text-gray-500 hover:text-red-400 flex justify-end pb-2" onClick={() => onChange(fees.filter(x => x.id !== f.id))}><Trash2 className="w-4 h-4" /></button>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-2 text-xs text-gray-300">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.auto} onChange={e => upd(f.id, { auto: e.target.checked })} />add to new documents</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.taxable} onChange={e => upd(f.id, { taxable: e.target.checked })} />charge sales tax on it</label>
            <label className="flex items-center gap-1.5">website variable<input className={`${inputCls} !w-40 !py-1 text-xs`} placeholder="e.g. base_fee" value={f.quoteKey} onChange={e => upd(f.id, { quoteKey: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></label>
          </div>
        </div>))}</div>
    </Card>
  );
}

/** The detail fields on your documents (a vehicle for a mechanic, an address for a plumber, an event for a photographer…). Empty = none. */
function FieldBuilder({ details, onChange }: { details: InvoicingSettings['details']; onChange: (d: InvoicingSettings['details']) => void }) {
  const upd = (i: number, patch: Partial<FieldDef>) => onChange({ ...details, fields: details.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) });
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= details.fields.length) return; const c = [...details.fields]; [c[i], c[j]] = [c[j], c[i]]; onChange({ ...details, fields: c }); };
  return (
    <Card title="Detail fields" right={<span className="flex gap-1.5 flex-wrap"><Btn size="sm" onClick={() => onChange({ title: FIELD_PRESETS.automotive.title, fields: FIELD_PRESETS.automotive.fields.map(f => ({ ...f })) })}>Use automotive set</Btn>
      <Btn size="sm" disabled={details.fields.length >= 30} onClick={() => onChange({ ...details, fields: [...details.fields, { key: `field_${details.fields.length + 1}`, label: 'New field', type: 'text', default: '' }] })}><Plus className="w-3.5 h-3.5" />Add field</Btn></span>}>
      <p className="text-xs text-gray-400 mb-3">Design the information box on your estimates and invoices for <b>your</b> kind of work. Leave it empty for none. Each field has a <b>variable name</b>: when your website or an agent posts <code>fields.&#123;name&#125;</code> (for example <code>fields.venue</code>) the field fills itself in. The automotive set uses the same names a mechanic's website posts as <code>vehicle</code> (year, make, model, vin, engine).</p>
      <Field label="Box title"><TextIn value={details.title} onChange={v => onChange({ ...details, title: v })} placeholder="Vehicle Details, Job Site, Event…" /></Field>
      {details.fields.length === 0 && <p className="text-sm text-gray-500 py-3">No detail fields: documents show customer details only.</p>}
      <div className="space-y-2 mt-3">{details.fields.map((f, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-12 sm:col-span-3"><Field label={i === 0 ? 'Label' : ''}><TextIn value={f.label} onChange={v => upd(i, { label: v, ...(f.key.startsWith('field_') || f.key === slugKey(f.label) ? { key: slugKey(v) || f.key } : {}) })} /></Field></div>
          <div className="col-span-6 sm:col-span-3"><Field label={i === 0 ? 'Variable name' : ''}><TextIn className="font-mono text-xs" value={f.key} onChange={v => upd(i, { key: v.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /></Field></div>
          <div className="col-span-6 sm:col-span-2"><Field label={i === 0 ? 'Type' : ''}><select className={inputCls} value={f.type} onChange={e => upd(i, { type: e.target.value as FieldType })}>{FIELD_TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></Field></div>
          <div className="col-span-8 sm:col-span-3"><Field label={i === 0 ? 'Default value' : ''}><TextIn value={f.default} onChange={v => upd(i, { default: v })} /></Field></div>
          <span className="col-span-4 sm:col-span-1 flex justify-end gap-1 pb-2 text-gray-500"><button aria-label="Move up" className="hover:text-white" onClick={() => move(i, -1)}><ChevronUp className="w-4 h-4" /></button><button aria-label="Move down" className="hover:text-white" onClick={() => move(i, 1)}><ChevronDown className="w-4 h-4" /></button><button aria-label={`Delete ${f.label}`} className="hover:text-red-400" onClick={() => onChange({ ...details, fields: details.fields.filter((_, k) => k !== i) })}><Trash2 className="w-4 h-4" /></button></span>
        </div>))}</div>
    </Card>
  );
}
