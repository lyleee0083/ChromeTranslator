import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const result = spawnSync(
  'git',
  ['config', 'core.hooksPath', '.githooks'],
  { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('Git hooks: core.hooksPath=.githooks');
console.log('提交说明将自 CHANGLOG.md 最新版本节读取（prepare-commit-msg）。');
