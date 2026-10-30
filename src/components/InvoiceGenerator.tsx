import React, { useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import { ZoomIn, ZoomOut, Move } from 'lucide-react';

export interface InvoiceViewProps {
  job: any;
  expenses: any[];
  template: any;
  totalLaborHours?: number;
  hourlyRate?: number;
  invoiceNotes?: string;
  className?: string;
}

export const InvoiceView: React.FC<InvoiceViewProps> = ({
  job,
  expenses = [],
  template,
  totalLaborHours = 0,
  hourlyRate,
  invoiceNotes,
  className = '',
}) => {
  const materialsTotal = expenses
    .filter(e => e.entry_type === 'expense')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const laborRate = hourlyRate !== undefined && !isNaN(Number(hourlyRate))
    ? Number(hourlyRate)
    : (Number(job?.job_rate) || Number(template?.default_hourly_rate) || 0);

  const laborTotal = laborRate * (Number(totalLaborHours) || 0);
  const grandTotal = materialsTotal + laborTotal;
  const effectiveNotes = invoiceNotes !== undefined ? invoiceNotes : (job?.invoice_notes || '');

  return (
    <div className={`bg-white text-gray-900 p-8 sm:p-10 font-sans ${className}`}>
      {/* Header */}
      <div className="flex justify-between items-start border-b-2 border-gray-200 pb-6 mb-6">
        <div>
          {template?.company_logo_url ? (
            <img 
              src={template.company_logo_url} 
              alt="Logo" 
              className="h-16 mb-4 object-contain" 
              crossOrigin="anonymous" 
            />
          ) : (
            <h1 className="text-3xl font-bold text-gray-800">{template?.company_name || 'My Company'}</h1>
          )}
          <p className="text-gray-500 whitespace-pre-wrap mt-2 text-sm">{template?.company_address || 'Company Address'}</p>
        </div>
        <div className="text-right">
          <h2 className="text-4xl font-light text-gray-400 mb-2">INVOICE</h2>
          <p className="font-semibold text-gray-700 text-sm">Date: {format(new Date(), 'MMM dd, yyyy')}</p>
          <p className="text-gray-500 text-sm">Invoice #: {job?.invoice_number || (job?.id ? `INV-${job.id.substring(0, 8).toUpperCase()}` : 'INV-A00001')}</p>
        </div>
      </div>

      {/* Bill To */}
      <div className="mb-8">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Bill To</h3>
        <p className="font-bold text-lg text-gray-800">{job?.client_name || 'Client Name'}</p>
        {job?.client_address && (
          <p className="text-gray-600 whitespace-pre-wrap text-sm">{job.client_address}</p>
        )}
        {job?.client_email && (
          <p className="text-gray-600 text-sm">{job.client_email}</p>
        )}
      </div>

      {/* Itemized Expenses */}
      <table className="w-full text-left mb-8 border-collapse text-sm">
        <thead>
          <tr className="bg-gray-100 border-y border-gray-300 text-gray-600">
            <th className="p-3 font-semibold w-24">Date</th>
            <th className="p-3 font-semibold">Description</th>
            <th className="p-3 font-semibold text-right w-32">Amount</th>
          </tr>
        </thead>
        <tbody>
          {expenses.filter(e => e.entry_type === 'expense').length === 0 ? (
            <tr>
              <td colSpan={3} className="p-4 text-center text-gray-400 italic">No expense line-items recorded for this job.</td>
            </tr>
          ) : (
            expenses.filter(e => e.entry_type === 'expense').map((exp) => (
              <tr key={exp.id} className="border-b border-gray-200">
                <td className="p-3 text-gray-600">{exp.date ? format(new Date(exp.date), 'MM/dd/yy') : 'N/A'}</td>
                <td className="p-3 text-gray-800">{exp.description || 'Expense'}</td>
                <td className="p-3 text-right font-medium text-gray-800">${(Number(exp.amount) || 0).toFixed(2)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Totals Section */}
      <div className="flex justify-end mb-8">
        <div className="w-72 text-sm">
          <div className="flex justify-between py-2 text-gray-600">
            <span>Materials Subtotal:</span>
            <span>${materialsTotal.toFixed(2)}</span>
          </div>
          
          {(Number(totalLaborHours) || 0) > 0 && (
            <div className="flex justify-between py-2 text-gray-600 border-t border-gray-200">
              <span>Labor ({totalLaborHours}h @ ${laborRate.toFixed(2)}/h):</span>
              <span>${laborTotal.toFixed(2)}</span>
            </div>
          )}
          
          <div className="flex justify-between py-3 mt-2 border-t-2 border-gray-800 font-bold text-xl text-gray-900">
            <span>Total Due:</span>
            <span>${grandTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Job Notes / Terms */}
      {effectiveNotes && (
        <div className="mb-8 p-4 bg-gray-50 rounded-xl text-gray-700 whitespace-pre-wrap text-sm border border-gray-200">
          <h4 className="font-semibold text-gray-900 mb-1">Notes & Terms:</h4>
          {effectiveNotes}
        </div>
      )}

      {/* Footer Notes */}
      {template?.footer_notes && (
        <div className="mt-auto pt-8 border-t border-gray-200 text-center text-xs text-gray-500 whitespace-pre-wrap">
          {template.footer_notes}
        </div>
      )}
    </div>
  );
};

export interface InvoicePreviewProps extends InvoiceViewProps {
  maxHeight?: string;
}

export const InvoicePreview: React.FC<InvoicePreviewProps> = ({
  maxHeight = '65vh',
  ...props
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoomMode, setZoomMode] = useState<'fit' | 'custom'>('fit');
  const [customScale, setCustomScale] = useState(1.0);
  const [containerWidth, setContainerWidth] = useState(800);
  const [contentHeight, setContentHeight] = useState(1131);

  useEffect(() => {
    const updateSizes = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
      if (contentRef.current) {
        setContentHeight(contentRef.current.offsetHeight);
      }
    };

    updateSizes();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        updateSizes();
      });
      if (containerRef.current) ro.observe(containerRef.current);
      if (contentRef.current) ro.observe(contentRef.current);
      return () => ro.disconnect();
    } else {
      window.addEventListener('resize', updateSizes);
      return () => window.removeEventListener('resize', updateSizes);
    }
  }, []);

  const baseWidth = 800;
  // Available width accounting for container padding (approx 24px)
  const availableWidth = Math.max(240, containerWidth - 28);
  const fitScale = Math.min(1.0, Math.max(0.25, availableWidth / baseWidth));
  const activeScale = zoomMode === 'fit' ? fitScale : customScale;

  const handleZoomIn = () => {
    setZoomMode('custom');
    setCustomScale(prev => Math.min(2.0, Math.round((activeScale + 0.15) * 100) / 100));
  };

  const handleZoomOut = () => {
    setZoomMode('custom');
    setCustomScale(prev => Math.max(0.3, Math.round((activeScale - 0.15) * 100) / 100));
  };

  const handleSetFit = () => {
    setZoomMode('fit');
  };

  const handleSet100 = () => {
    setZoomMode('custom');
    setCustomScale(1.0);
  };

  const isOverflowing = Math.round(baseWidth * activeScale) > containerWidth;

  return (
    <div className="flex flex-col space-y-2.5 w-full">
      {/* Zoom & Viewport Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-300">
            Live Invoice Preview
          </span>
          {isOverflowing && (
            <span className="inline-flex items-center gap-1 text-[11px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full font-medium">
              <Move className="w-3 h-3" /> Scroll / Pan 2D
            </span>
          )}
        </div>

        {/* Zoom Tool Buttons */}
        <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 p-1 rounded-xl">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={activeScale <= 0.3}
            className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-30"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          
          <span className="text-xs font-mono font-medium text-gray-300 px-1 min-w-[42px] text-center">
            {Math.round(activeScale * 100)}%
          </span>

          <button
            type="button"
            onClick={handleZoomIn}
            disabled={activeScale >= 2.0}
            className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors disabled:opacity-30"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <div className="h-3 w-px bg-white/10 mx-0.5" />

          <button
            type="button"
            onClick={handleSetFit}
            className={`px-2 py-0.5 text-xs font-medium rounded-lg transition-colors ${
              zoomMode === 'fit'
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
            title="Fit to Screen"
          >
            Fit
          </button>

          <button
            type="button"
            onClick={handleSet100}
            className={`px-2 py-0.5 text-xs font-medium rounded-lg transition-colors ${
              zoomMode === 'custom' && Math.abs(activeScale - 1.0) < 0.05
                ? 'bg-indigo-500 text-white shadow-sm'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
            title="Actual Size (100%)"
          >
            100%
          </button>
        </div>
      </div>

      {/* Outer Scroll & Pan Viewport */}
      <div
        ref={containerRef}
        className="w-full bg-[#110d1c] border border-white/10 rounded-2xl p-2 sm:p-4 overflow-auto custom-scrollbar shadow-inner"
        style={{
          maxHeight,
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x pan-y',
        }}
      >
        {/* Inline-block centering wrapper that prevents negative scroll clipping */}
        <div className="inline-block min-w-full text-center align-top py-2">
          <div
            style={{
              width: `${Math.round(baseWidth * activeScale)}px`,
              height: `${Math.round(contentHeight * activeScale)}px`,
              margin: '0 auto',
              position: 'relative',
              overflow: 'hidden',
            }}
            className="shadow-2xl rounded-xl border border-gray-200 text-left bg-white transition-[width,height] duration-150 shrink-0"
          >
            <div
              ref={contentRef}
              style={{
                width: `${baseWidth}px`,
                transform: `scale(${activeScale})`,
                transformOrigin: 'top left',
                position: 'absolute',
                top: 0,
                left: 0,
              }}
            >
              <InvoiceView {...props} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export interface InvoiceRef {
  generatePDF: () => Promise<void>;
}

export interface InvoiceGeneratorProps extends InvoiceViewProps {}

const InvoiceGenerator = forwardRef<InvoiceRef, InvoiceGeneratorProps>((props, ref) => {
  const invoiceRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    generatePDF: async () => {
      if (!invoiceRef.current) return;
      const element = invoiceRef.current;
      try {
        const imgData = await toPng(element, { pixelRatio: 2 });

        const img = new Image();
        img.src = imgData;
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (img.height * pdfWidth) / img.width;

        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        const invTag = (props.job?.invoice_number || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'INV';
        pdf.save(`Invoice_${invTag}_${(props.job?.title || 'Job').replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`);
      } catch (err) {
        console.error("Failed to generate PDF", err);
        alert("Failed to generate PDF. See console for details.");
      }
    }
  }));

  return (
    <div style={{ position: 'absolute', top: '-15000px', left: '-15000px', pointerEvents: 'none', zIndex: -1 }}>
      {/* 
        This is the actual template that gets rendered to PDF. 
        It has a fixed width (A4 proportion: 800px) to ensure crisp capture. 
      */}
      <div 
        ref={invoiceRef} 
        style={{ width: '800px', minHeight: '1131px', margin: '0 auto' }}
      >
        <InvoiceView {...props} />
      </div>
    </div>
  );
});

export default InvoiceGenerator;
