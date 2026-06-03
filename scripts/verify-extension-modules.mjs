import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_FILES } from './extension-runtime-files.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipTopLevelLoad = new Set(['background.js', 'popup.js', 'options.js', 'content.bundle.js']);
const moduleFiles = RUNTIME_FILES.filter((file) => file.endsWith('.js') && !skipTopLevelLoad.has(file));

for (const file of moduleFiles) {
  const moduleUrl = new URL(file, `file://${projectRoot.replace(/\\/g, '/')}/`);
  await import(moduleUrl);
}

const importPattern = /import\s*\{([^}]+)\}\s*from\s*['"](\.\/[^'"]+)['"]/g;
const checked = new Set();

for (const file of RUNTIME_FILES.filter((entry) => entry.endsWith('.js'))) {
  const sourcePath = path.join(projectRoot, file);
  const source = fs.readFileSync(sourcePath, 'utf8');
  let match = importPattern.exec(source);
  while (match) {
    const names = match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/i).pop().trim())
      .filter(Boolean);
    const specifier = match[2];
    const key = `${specifier}::${names.join(',')}`;
    if (!checked.has(key)) {
      checked.add(key);
      const targetPath = path.join(path.dirname(sourcePath), specifier);
      const exported = await import(new URL(`file://${targetPath.replace(/\\/g, '/')}`));
      for (const name of names) {
        if (!(name in exported)) {
          throw new Error(`${file} imports "${name}" from ${specifier}, but it is not exported`);
        }
      }
    }
    match = importPattern.exec(source);
  }
}

console.log('Extension modules: import graph OK');
