import type { VinCheck } from './types';

/** 17 characters, letters and digits, excluding I, O and Q (upstream `validateVin`, messages unchanged). */
export function validateVin(vin: unknown): VinCheck {
  const normalized = String(vin ?? '').trim().toUpperCase();

  if (!normalized) return { valid: false, reason: 'VIN is required.' };
  if (normalized.length !== 17) return { valid: false, reason: 'VIN must be exactly 17 characters.' };
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) {
    return { valid: false, reason: 'VIN may contain only letters and digits, excluding I, O, and Q.' };
  }
  return { valid: true };
}
