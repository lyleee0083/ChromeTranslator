import { readFileSync, writeFileSync } from 'node:fs';
import { getCommitMessageFromChangelog } from './changelog-commit-message.mjs';

const [msgFile, source] = process.argv.slice(2);
if (!msgFile) {
  process.exit(0);
}

const skipSources = new Set(['message', 'template', 'merge', 'squash']);
if (source && skipSources.has(source)) {
  process.exit(0);
}

const existing = readFileSync(msgFile, 'utf8');
const nonComment = existing
  .split(/\r?\n/)
  .filter((line) => line.trim() && !line.startsWith('#'))
  .join('\n')
  .trim();

if (nonComment) {
  process.exit(0);
}

let message;
try {
  message = getCommitMessageFromChangelog();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const commentBlock = existing
  .split(/\r?\n/)
  .filter((line) => !line.trim() || line.startsWith('#'))
  .join('\n')
  .trimEnd();

writeFileSync(
  msgFile,
  commentBlock ? `${message}\n\n${commentBlock}\n` : `${message}\n`,
  'utf8'
);
