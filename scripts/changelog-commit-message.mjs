import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changelogPath = path.join(repoRoot, 'CHANGLOG.md');

/**
 * @param {string} [filePath]
 * @returns {string}
 */
export function getCommitMessageFromChangelog(filePath = changelogPath) {
  const content = readFileSync(filePath, 'utf8');
  const match = content.match(/^##\s+(\S+)\s*\r?\n([\s\S]*?)(?=\r?\n## )/m);
  if (!match) {
    throw new Error('CHANGLOG.md 中未找到版本节（## x.y.z）');
  }

  const version = match[1];
  const lines = match[2].split(/\r?\n/);
  const titleParts = [];
  const bullets = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('-')) {
      bullets.push(line.trimEnd());
      continue;
    }

    if (bullets.length === 0) {
      titleParts.push(trimmed);
    }
  }

  const title = titleParts.join(' ').trim();
  if (!title) {
    throw new Error(`CHANGLOG.md 版本 ${version} 下缺少标题行（版本号下一行，非列表）`);
  }

  if (bullets.length === 0) {
    throw new Error(`CHANGLOG.md 版本 ${version} 下没有变更条目（- 开头）`);
  }

  const subject = `${version} ${title}`;
  return `${subject}\n\n${bullets.join('\n')}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${getCommitMessageFromChangelog()}\n`);
}
