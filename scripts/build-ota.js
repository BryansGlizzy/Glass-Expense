import 'dotenv/config';   // honour DATA_DIR from .env, like the server does
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));
const distDir = path.join(rootDir, 'dist');
const updatesDir = path.join(dataDir, 'updates');
const versionFile = path.join(updatesDir, 'version.json');

// Ensure updates directory exists
if (!fs.existsSync(updatesDir)) {
  fs.mkdirSync(updatesDir, { recursive: true });
}

// Determine version
let existing = {};
if (fs.existsSync(versionFile)) {
  try { existing = JSON.parse(fs.readFileSync(versionFile, 'utf8')) || {}; } catch (e) {}
}
const existingVersion = existing.version || '1.0.0';

const args = process.argv.slice(2);
let targetVersion = args[0];

if (!targetVersion) {
  // Auto-bump patch version if none specified
  const parts = existingVersion.split('.').map(n => parseInt(n, 10) || 0);
  parts[2] = (parts[2] || 0) + 1;
  targetVersion = parts.join('.');
}

const releaseNotes = args[1] || `Release v${targetVersion}`;

// OTA_SKIP_BUILD=1      zip the dist/ that already exists (update.sh and the Docker image have just built it)
// OTA_ONLY_IF_CHANGED=1 publish nothing when dist/ is byte-identical to the last published bundle
const skipBuild = process.env.OTA_SKIP_BUILD === '1';
const onlyIfChanged = process.env.OTA_ONLY_IF_CHANGED === '1';

console.log(`\n📦 Building GlassExpense OTA Bundle v${targetVersion}...`);

// 1. Build Vite frontend
if (skipBuild) {
  console.log('⏭  Using existing dist/ (OTA_SKIP_BUILD=1)');
} else {
  console.log('⚡ Running vite build...');
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
}

if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('❌ dist/index.html not found! Vite build failed.');
  process.exit(1);
}

// Content hash of dist/ (paths + bytes, order-independent of the filesystem) to detect "nothing changed".
function hashDir(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (e.isFile()) h.update(r + '\0').update(fs.readFileSync(path.join(d, e.name)));
    }
  };
  walk(dir, '');
  return h.digest('hex');
}
const distHash = hashDir(distDir);
if (onlyIfChanged && existing.distHash === distHash && existing.bundleUrl
    && fs.existsSync(path.join(updatesDir, path.basename(existing.bundleUrl)))) {
  console.log(`✅ dist/ unchanged since v${existingVersion}; nothing to publish\n`);
  process.exit(0);
}

// 2. Zip the contents of dist/ (root of zip contains index.html)
const zipFileName = `bundle-${targetVersion}.zip`;
const zipFilePath = path.join(updatesDir, zipFileName);
const output = fs.createWriteStream(zipFilePath);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on('close', () => {
  const zipBytes = fs.readFileSync(zipFilePath);
  const hash = crypto.createHash('sha256').update(zipBytes).digest('hex');
  const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);

  console.log(`✅ Compressed ${sizeMB} MB to ${zipFileName}`);

  // 3. Write metadata to updates/version.json
  const versionData = {
    version: targetVersion,
    bundleUrl: `/updates/${zipFileName}`,
    checksum: hash,
    releaseNotes,
    sizeBytes: archive.pointer(),
    publishedAt: new Date().toISOString(),
    distHash
  };

  fs.writeFileSync(versionFile, JSON.stringify(versionData, null, 2), 'utf8');
  console.log(`🚀 Saved metadata to updates/version.json`);
  console.log(`✨ OTA Bundle v${targetVersion} is ready for mobile clients!\n`);
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(distDir, false); // false means contents of dist, not dist directory itself
archive.finalize();
