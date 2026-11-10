/**
 * The company logo (docs/DOCUMENTATION.md §13.4). It is stored as a small baseline JPEG data URL in the encrypted invoicing settings
 * (the browser converts whatever the user uploads, see `logoUpload.ts`), drawn on the sheet as an image and embedded in the PDF as a
 * /DCTDecode image (the JPEG bytes go into the PDF unchanged, so there is no re-compression and no image library). A remote logo URL
 * cannot be used: the app's CSP forbids fetching other origins, and most hosts do not allow cross-origin reads anyway.
 * Pure and DOM-free.
 */

export interface PdfLogo { bytes: Uint8Array; width: number; height: number; components: 1 | 3 }

export const LOGO_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
/** Upper bound on the stored data URL (about 90 KB of JPEG); the settings blob must stay far below the 900 KB cap. */
export const MAX_LOGO_CHARS = 125_000;

export const isLogoDataUrl = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_LOGO_CHARS && LOGO_DATA_URL.test(v);

/** Reads width, height and component count from a JPEG's start-of-frame marker. Returns null for anything that is not a plain JPEG. */
export function parseJpeg(bytes: Uint8Array): { width: number; height: number; components: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }                       // fill byte
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; } // markers without a length
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6], width = (bytes[i + 7] << 8) | bytes[i + 8], components = bytes[i + 9];
      return width > 0 && height > 0 ? { width, height, components } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** A stored logo data URL as PDF image data, or null if it is missing, malformed, not a JPEG, or not gray/RGB. */
export function decodeLogo(dataUrl: unknown): PdfLogo | null {
  if (!isLogoDataUrl(dataUrl)) return null;
  const bytes = base64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const info = parseJpeg(bytes);
  if (!info || (info.components !== 1 && info.components !== 3) || info.width > 4000 || info.height > 4000) return null;
  return { bytes, width: info.width, height: info.height, components: info.components as 1 | 3 };
}

/** Scales an image to fit a box without enlarging it past the box or distorting it. */
export function fitInside(width: number, height: number, maxW: number, maxH: number): { w: number; h: number } {
  const k = Math.min(maxW / width, maxH / height);
  return { w: width * k, h: height * k };
}
