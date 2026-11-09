import React from 'react';
import { Navigate, useSearchParams } from 'react-router';

/** Invoices live in the Invoices tab of the dashboard. This route keeps older links (`/invoices?job=<id>`, `?open=<invoiceId>`) working. */
export default function Invoices() {
  const [params] = useSearchParams();
  const next = new URLSearchParams({ view: 'invoices' });
  for (const k of ['job', 'open']) { const v = params.get(k); if (v) next.set(k, v); }
  return <Navigate to={`/dashboard?${next.toString()}`} replace />;
}
