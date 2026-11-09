import { MAX_LOGO_CHARS } from './logo';

/**
 * Turns an image the user picked into the small baseline JPEG data URL stored in their encrypted settings (browser only).
 * Anything (PNG with transparency, WebP, a large photo) is drawn onto a white background, scaled down to fit 600 x 240 px and
 * re-encoded until it fits the size limit. The result is always a plain RGB baseline JPEG, which is what the PDF embeds.
 */
export async function prepareLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.type)) throw new Error('Choose a PNG, JPG, WebP or GIF image.');
  if (file.size > 12 * 1024 * 1024) throw new Error('That image is too large (12 MB max).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('That image could not be read.')); i.src = url; });
    let scale = Math.min(1, 600 / img.naturalWidth, 240 / img.naturalHeight);
    for (let attempt = 0; attempt < 6; attempt++) {
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('This browser cannot process images.');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      for (const q of [0.9, 0.8, 0.7, 0.6]) { const data = canvas.toDataURL('image/jpeg', q); if (data.startsWith('data:image/jpeg') && data.length <= MAX_LOGO_CHARS) return data; }
      scale *= 0.75;
    }
    throw new Error('That image is too detailed to store as a logo. Try a simpler or smaller one.');
  } finally { URL.revokeObjectURL(url); }
}
