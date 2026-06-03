import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
const distDir = path.join(projectRoot, 'dist');
const packageDir = path.join(distDir, 'package', 'ChromeTranslator');
const zipPath = path.join(distDir, `ChromeTranslator-${manifest.version}.zip`);

const runtimeFiles = [
  'manifest.json',
  'background.js',
  'content.css',
  'content.js',
  'cache-clear-utils.js',
  'deepl-settings.js',
  'domain-settings.js',
  'language-options.js',
  'options.html',
  'options.js',
  'popup.html',
  'popup.js',
  'protected-terms.js',
  'protected-terms-defaults.js',
  'translation-result-utils.js',
  'translation-residue-utils.js',
  'translation-cache.js',
  'translator.js',
  'webpage-translation.js',
  'youtube-subtitles.js'
];

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });

for (const file of runtimeFiles) {
  copyFile(file, file);
}

copyDirectory('icons', 'icons');

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
