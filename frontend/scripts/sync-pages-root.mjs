import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDir = path.resolve(__dirname, '..');
const distDir = path.join(frontendDir, 'dist');
const repoRoot = path.resolve(frontendDir, '..');

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error(`Missing built bundle at ${distDir}. Run vite build first.`);
  process.exit(1);
}

for (const dirName of ['assets', 'demo-data']) {
  const targetDir = path.join(repoRoot, dirName);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
}

for (const rootFile of ['index.html', 'manifest.webmanifest']) {
  const targetFile = path.join(repoRoot, rootFile);
  if (fs.existsSync(targetFile)) {
    fs.rmSync(targetFile, { force: true });
  }
}

function copyRecursive(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    let count = 0;
    for (const entry of fs.readdirSync(src)) {
      count += copyRecursive(path.join(src, entry), path.join(dst, entry));
    }
    return count;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return 1;
}

const copiedCount = copyRecursive(distDir, repoRoot);
fs.writeFileSync(path.join(repoRoot, '.nojekyll'), '', 'utf8');

console.log(`SYNC_PAGES_ROOT: copied ${copiedCount} files from ${distDir} -> ${repoRoot} (+ .nojekyll)`);
