/**
 * Invoicing settings and Service Packages (docs/DOCUMENTATION.md §13.5-§13.5). Both live in the user's encrypted personal blobs:
 * settings inside `invoice_template` (key `invoicing`, next to the legacy company fields) and packages in `invoice_packages`.
 */
import { getBlob, setBlob } from '../store';
import { defaultSettings, normalizeSettings, type InvoicingSettings } from '../../invoice/settings';
import { normalizePackages, type ServicePackage } from '../../invoice/packages';
import { Route, ok, bad } from './types';

/** Reads the settings, seeding shop/rate values from the legacy company profile the first time (never overwriting anything set later). */
export async function loadInvoicingSettings(): Promise<InvoicingSettings> {
  const tpl = await getBlob<any>('invoice_template', null);
  if (tpl?.invoicing) return normalizeSettings(tpl.invoicing);
  const seeded = defaultSettings();
  if (tpl) {
    seeded.shop.name = String(tpl.company_name || '').slice(0, 200);
    seeded.shop.address = String(tpl.company_address || '').slice(0, 500);
    seeded.rates.hourlyRate = Number(tpl.default_hourly_rate) > 0 ? Number(tpl.default_hourly_rate) : 0;
    seeded.terms.customerNotes = String(tpl.footer_notes || '').slice(0, 5000);
    seeded.numbering.prefix = String(tpl.default_prefix || 'INV');
  }
  return normalizeSettings(seeded);
}

export async function saveInvoicingSettings(next: InvoicingSettings): Promise<InvoicingSettings> {
  const clean = normalizeSettings(next);
  const tpl = (await getBlob<any>('invoice_template', null)) || {};
  await setBlob('invoice_template', { ...tpl, invoicing: clean });
  return clean;
}

export async function loadPackages(): Promise<ServicePackage[]> {
  return normalizePackages(await getBlob<any>('invoice_packages', { packages: [] }));
}

export const invoicingRoutes: Route[] = [
  ['GET', /^\/api\/invoicing\/settings$/, async () => ok(await loadInvoicingSettings())],
  ['PUT', /^\/api\/invoicing\/settings$/, async ({ body }) => {
    if (!body || typeof body !== 'object') bad('settings are required');
    return ok(await saveInvoicingSettings(normalizeSettings(body)));
  }],
  ['GET', /^\/api\/invoicing\/packages$/, async () => ok(await loadPackages())],
  ['PUT', /^\/api\/invoicing\/packages$/, async ({ body }) => {
    const packages = normalizePackages(body?.packages ?? body);
    await setBlob('invoice_packages', { packages });
    return ok(packages);
  }],
];
