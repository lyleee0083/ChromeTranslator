import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getCommitMessageFromChangelog } from './changelog-commit-message.mjs';

const message = getCommitMessageFromChangelog();
const tempDir = mkdtempSync(path.join(tmpdir(), 'chrome-translator-commit-'));
const msgFile = path.join(tempDir, 'COMMIT_EDITMSG');

writeFileSync(msgFile, `${message}\n`, 'utf8');

const extraArgs = process.argv.slice(2);
const result = spawnSync('git', ['commit', '-F', msgFile, ...extraArgs], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

try {
  unlinkSync(msgFile);
} catch {
  // ignore
}

process.exit(result.status ?? 1);
