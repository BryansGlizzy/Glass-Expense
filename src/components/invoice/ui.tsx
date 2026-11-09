import React from 'react';
import { statusLabel } from '../../invoice/types';

/** Small form primitives in GE's glass style (same look as Job.tsx / Settings.tsx), shared by the invoice editor and Settings → Invoices. */
export const inputCls = 'w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#7c3bed]/50 disabled:opacity-60';

export function Card({ title, icon, right, children, flush }: { title: React.ReactNode; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="bg-[#1c172d]/60 border border-white/10 rounded-2xl overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 bg-black/10">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">{icon}{title}</h2>{right}
      </header>
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

export function Field({ label, children, className = '', hint }: { label: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (<label className={`block ${className}`}><span className="block text-xs font-medium text-gray-400 mb-1">{label}</span>{children}{hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}</label>);
}

export function TextIn({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input {...rest} value={value} onChange={e => onChange(e.target.value)} className={`${inputCls} ${rest.className || ''}`} />;
}

export function NumIn({ value, onChange, ...rest }: { value: number; onChange: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input {...rest} type="number" inputMode="decimal" value={value} onChange={e => onChange(Number(e.target.value) || 0)} className={`${inputCls} tabular-nums ${rest.className || ''}`} />;
}

export function Btn({ variant = 'secondary', size = 'md', className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'accent' | 'ghost'; size?: 'sm' | 'md' }) {
  const v = { primary: 'bg-[#7c3bed] hover:bg-[#6d2fd6] text-white border-[#7c3bed]/60', accent: 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/50', secondary: 'bg-white/5 hover:bg-white/10 text-gray-200 border-white/10',
    danger: 'bg-red-500/10 hover:bg-red-500/20 text-red-300 border-red-500/20', ghost: 'bg-transparent hover:bg-white/5 text-gray-300 border-transparent' }[variant];
  return <button type="button" {...rest} className={`inline-flex items-center justify-center gap-1.5 rounded-xl border font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'} ${v} ${className}`} />;
}

const STATUS_TONE: Record<string, string> = { Draft: 'bg-slate-500/20 text-slate-300', Estimate: 'bg-blue-500/20 text-blue-300', Sent: 'bg-sky-500/20 text-sky-300', Approved: 'bg-emerald-500/20 text-emerald-300', Paid: 'bg-green-500/25 text-green-300', Overdue: 'bg-red-500/20 text-red-300' };
export const StatusBadge = ({ status, docType }: { status: string; docType?: string }) => <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_TONE[status] || STATUS_TONE.Draft}`}>{statusLabel(status, docType)}</span>;

export function Modal({ title, onClose, children, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm overflow-y-auto no-print" role="dialog" aria-modal="true" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bg-[#1c172d] border border-white/10 rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} my-auto`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10"><h3 className="font-semibold text-white">{title}</h3><button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white text-xl leading-none">&times;</button></div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export const Notice = ({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode }) => {
  const c = { info: 'border-blue-500/20 bg-blue-500/10 text-blue-200', warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200', error: 'border-red-500/30 bg-red-500/10 text-red-200', ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' }[tone];
  return <div className={`rounded-xl border px-3 py-2 text-xs ${c}`}>{children}</div>;
};
