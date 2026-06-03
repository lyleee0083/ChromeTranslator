import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPushCommitMessageFromChangelog } from './changelog-commit-message.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runGit(args, options = {}) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...options
  });
}

function ensureSuccess(result, action) {
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    console.error(detail || `git ${action} 失败`);
    process.exit(result.status ?? 1);
  }
}

function parseVersionFromCommitSubject(subject) {
  const match = String(subject || '').match(/^(\d+\.\d+\.\d+)/);
  return match ? match[1] : '0.0.0';
}

function getLastPushedVersion() {
  const fetchResult = runGit(['fetch', 'origin']);
  if (fetchResult.status !== 0) {
    console.warn('无法 fetch origin，将按本地 origin/main 或 0.0.0 判断已推送版本。');
  }

  const remoteRef = runGit(['rev-parse', '--verify', 'origin/main']);
  if (remoteRef.status !== 0) {
    return '0.0.0';
  }

  const logResult = runGit(['log', 'origin/main', '-1', '--format=%s']);
  ensureSuccess(logResult, 'log origin/main');
  return parseVersionFromCommitSubject(logResult.stdout.trim());
}

function hasUncommittedChanges() {
  const status = runGit(['status', '--porcelain']);
  ensureSuccess(status, 'status');
  return Boolean(status.stdout.trim());
}

function getAheadCount() {
  const result = runGit(['rev-list', '--count', 'origin/main..HEAD']);
  if (result.status !== 0) {
    return 0;
  }

  return Number.parseInt(String(result.stdout).trim(), 10) || 0;
}

function writeCommitMessageFile(message) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'chrome-translator-push-'));
  const msgFile = path.join(tempDir, 'COMMIT_EDITMSG');
  writeFileSync(msgFile, `${message}\n`, 'utf8');
  return { tempDir, msgFile };
}

function removeTempDir(tempDir, msgFile) {
  try {
    unlinkSync(msgFile);
  } catch {
    // ignore
  }
}

const lastPushedVersion = getLastPushedVersion();
let message;

try {
  message = getPushCommitMessageFromChangelog(lastPushedVersion);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const aheadCount = getAheadCount();
const dirty = hasUncommittedChanges();

if (!dirty && aheadCount === 0) {
  const pushResult = runGit(['push', 'origin', 'main'], { stdio: 'inherit' });
  process.exit(pushResult.status ?? 0);
}

if (aheadCount > 0) {
  const resetResult = runGit(['reset', '--soft', 'origin/main']);
  ensureSuccess(resetResult, 'reset --soft origin/main');
}

if (dirty || aheadCount > 0) {
  runGit(['add', '-A']);
  const { tempDir, msgFile } = writeCommitMessageFile(message);
  const commitResult = runGit(['commit', '-F', msgFile], { stdio: 'inherit' });
  removeTempDir(tempDir, msgFile);
  ensureSuccess(commitResult, 'commit');
}

console.log(`推送说明已包含自 ${lastPushedVersion} 之后未上 GitHub 的 CHANGLOG 版本。`);

const pushResult = runGit(['push', 'origin', 'main'], { stdio: 'inherit' });
process.exit(pushResult.status ?? 1);
