import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_DIRECTORIES, RUNTIME_FILES } from './extension-runtime-files.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const installDir = path.resolve('D:\\Chrome Translator');

execFileSync(process.execPath, ['scripts/bundle-content-script.mjs'], {
  cwd: projectRoot,
  stdio: 'inherit'
});

if (!fs.existsSync(installDir)) {
  console.error(`安装目录不存在: ${installDir}`);
  process.exit(1);
}

clearInstallDirectory();

for (const file of RUNTIME_FILES) {
  copyFile(file, file);
}

for (const directory of RUNTIME_DIRECTORIES) {
  copyDirectory(directory, directory);
}

console.log(`Synced to ${installDir}`);

function clearInstallDirectory() {
  if (installDir !== path.resolve('D:\\Chrome Translator')) {
    throw new Error(`拒绝清空非预期安装目录: ${installDir}`);
  }

  for (const entry of fs.readdirSync(installDir)) {
    fs.rmSync(path.join(installDir, entry), { recursive: true, force: true });
  }
}

function copyFile(sourceRelativePath, destinationRelativePath) {
  const sourcePath = path.join(projectRoot, sourceRelativePath);
  const destinationPath = path.join(installDir, destinationRelativePath);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function copyDirectory(sourceRelativePath, destinationRelativePath) {
  const sourcePath = path.join(projectRoot, sourceRelativePath);
  const destinationPath = path.join(installDir, destinationRelativePath);
  fs.cpSync(sourcePath, destinationPath, { recursive: true });
}
