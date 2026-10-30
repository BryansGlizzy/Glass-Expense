// Copies the Tesseract.js worker, WASM core and English language data into public/vendor/tesseract
// so on-device OCR is fully self-hosted (no third-party CDN fetches, works offline, CSP stays strict).
// Runs automatically before `dev` and `build`. Output is gitignored.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'vendor', 'tesseract');
const nm = path.join(root, 'node_modules');

const copies = [
  [path.join(nm, 'tesseract.js', 'dist', 'worker.min.js'), path.join(out, 'worker.min.js')],
  ...['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'].map(f => [
    path.join(nm, 'tesseract.js-core', `${f}.wasm.js`),
    path.join(out, 'core', `${f}.wasm.js`),
  ]),
  [path.join(nm, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), path.join(out, 'lang', 'eng.traineddata.gz')],
];

let copied = 0;
for (const [src, dest] of copies) {
  if (!fs.existsSync(src)) {
    console.error(`copy-tesseract-assets: missing ${path.relative(root, src)} (run npm ci)`);
    process.exit(1);
  }
  const stale = !fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size;
  if (stale) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied++;
  }
}
console.log(`copy-tesseract-assets: ${copied ? `copied ${copied} file(s)` : 'up to date'} -> public/vendor/tesseract`);
