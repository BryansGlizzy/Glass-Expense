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
let existingVersion = '1.0.0';
if (fs.existsSync(versionFile)) {
  try {
    const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    if (data.version) existingVersion = data.version;
  } catch (e) {}
}

const args = process.argv.slice(2);
let targetVersion = args[0];

if (!targetVersion) {
  // Auto-bump patch version if none specified
  const parts = existingVersion.split('.').map(n => parseInt(n, 10) || 0);
  parts[2] = (parts[2] || 0) + 1;
  targetVersion = parts.join('.');
}

const releaseNotes = args[1] || `Release v${targetVersion}`;

console.log(`\n📦 Building GlassExpense OTA Bundle v${targetVersion}...`);

// 1. Build Vite frontend
console.log('⚡ Running vite build...');
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('❌ dist/index.html not found! Vite build failed.');
  process.exit(1);
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
    publishedAt: new Date().toISOString()
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
