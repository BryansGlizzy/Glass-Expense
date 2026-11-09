import type { DeepPartial, PdfLabels, SheetLabels } from '../../../src/invoice/labels.ts';

/**
 * The exact strings the ORIGINAL automotive-pdf app hard-codes (pdf.js and app.js), expressed as label overrides.
 * Used only by the parity tests, so the port can be compared with the vendored oracle byte for byte.
 * The application's own defaults are neutral (plan D4); never import this file from app code.
 */
export const UPSTREAM_PDF_LABELS: DeepPartial<PdfLabels> = {
  headerShopFallback: "Future's Automotive",
  continuationShopFallback: 'Auto Workshop',
  licenseLabel: 'License / ARD #:',
  numberFallback: 'INV-DRAFT',
  footerBrand: "Future's Automotive",
  signatureText: {
    invoice: "I hereby authorize the repair work and parts specified above. An express mechanic's lien is acknowledged on vehicle to secure amount of repairs.",
    estimate: "I hereby authorize the repair work and parts specified above. An express mechanic's lien is acknowledged on vehicle to secure amount of repairs.",
  },
};

/** Preview-sheet strings of the original (app.js template and `updateTotalsAndPreview`). */
export const UPSTREAM_SHEET_LABELS: DeepPartial<SheetLabels> = {
  numberFallback: 'INV-DRAFT',
  termsHeading: 'Terms & Warranty Policy',
  termsEmpty: 'Standard shop warranty and liability disclaimer.',
  signatureText: {
    invoice: "I hereby authorize the repair work listed above along with necessary materials. You and your employees may operate the vehicle for purposes of testing, inspection or delivery at my risk. An express mechanic's lien is acknowledged on the vehicle to secure the amount of repairs thereto.",
    estimate: "I hereby authorize the repair work listed above along with necessary materials. You and your employees may operate the vehicle for purposes of testing, inspection or delivery at my risk. An express mechanic's lien is acknowledged on the vehicle to secure the amount of repairs thereto.",
  },
};
