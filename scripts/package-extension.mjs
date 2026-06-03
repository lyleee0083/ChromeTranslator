import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_DIRECTORIES, RUNTIME_FILES } from './extension-runtime-files.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

execFileSync(process.execPath, ['scripts/verify-extension-modules.mjs'], {
  cwd: projectRoot,
  stdio: 'inherit'
});
execFileSync(process.execPath, ['scripts/bundle-content-script.mjs'], {
  cwd: projectRoot,
  stdio: 'inherit'
});
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
const distDir = path.join(projectRoot, 'dist');
const packageDir = path.join(distDir, 'package', 'ChromeTranslator');
const zipPath = path.join(distDir, `ChromeTranslator-${manifest.version}.zip`);

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });

for (const file of RUNTIME_FILES) {
  copyFile(file, file);
}

for (const directory of RUNTIME_DIRECTORIES) {
  copyDirectory(directory, directory);
}

execFileSync('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  `Compress-Archive -Path "${packageDir}\\*" -DestinationPath "${zipPath}" -Force`
], { stdio: 'inherit' });

console.log(`Packaged ${path.relative(projectRoot, zipPath)}`);

function copyFile(sourceRelativePath, destinationRelativePath) {
  const sourcePath = path.join(projectRoot, sourceRelativePath);
  const destinationPath = path.join(packageDir, destinationRelativePath);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function copyDirectory(sourceRelativePath, destinationRelativePath) {
  const sourcePath = path.join(projectRoot, sourceRelativePath);
  const destinationPath = path.join(packageDir, destinationRelativePath);
  fs.cpSync(sourcePath, destinationPath, { recursive: true });
}
