import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changelogPath = path.join(repoRoot, 'CHANGLOG.md');

/**
 * @typedef {{ version: string, title: string, bullets: string[] }} ChangelogSection
 */

/**
 * @param {string} content
 * @returns {ChangelogSection[]}
 */
export function parseChangelogSections(content) {
  const sections = [];
  const body = content.replace(/^\uFEFF/, '').trim();
  const chunks = body.split(/\r?\n(?=##\s+\S+)/);

  for (const chunk of chunks) {
    const match = chunk.match(/^##\s+(\S+)\s*\r?\n([\s\S]*)$/);
    if (!match) {
      continue;
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

    const title = titleParts.join(' ').trim() || (bullets[0]?.replace(/^\-\s*/, '') ?? version);
    if (bullets.length === 0 && title === version) {
      throw new Error(`CHANGLOG.md 版本 ${version} 下没有变更条目（- 开头）`);
    }

    sections.push({
      version,
      title: titleParts.length > 0 ? title : titleParts.join(' ') || bullets[0]?.replace(/^\-\s*/, '') || version,
      bullets: bullets.length > 0 ? bullets : [`- ${title}`]
    });
  }

  if (sections.length === 0) {
    throw new Error('CHANGLOG.md 中未找到版本节（## x.y.z）');
  }

  return sections;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  const left = String(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = String(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

/**
 * @param {ChangelogSection} section
 * @returns {string}
 */
export function formatChangelogSectionBlock(section) {
  const lines = [`## ${section.version}`, section.title, ...section.bullets];
  return lines.join('\n');
}

/**
 * @param {ChangelogSection[]} sections
 * @returns {string}
 */
export function formatAggregatedCommitMessage(sections) {
  if (sections.length === 0) {
    throw new Error('没有可写入提交说明的变更记录');
  }

  const newest = sections[0];
  const oldest = sections[sections.length - 1];
  const subject = sections.length === 1
    ? `${newest.version} ${newest.title}`
    : `${oldest.version}–${newest.version} 累计更新`;

  const body = sections.map((section) => formatChangelogSectionBlock(section)).join('\n\n');
  return `${subject}\n\n${body}`;
}

/**
 * @param {string} [filePath]
 * @returns {string}
 */
export function getCommitMessageFromChangelog(filePath = changelogPath) {
  const sections = parseChangelogSections(readFileSync(filePath, 'utf8'));
  return formatAggregatedCommitMessage([sections[0]]);
}

/**
 * @param {string} sinceVersion
 * @param {string} [filePath]
 * @returns {string}
 */
export function getPushCommitMessageFromChangelog(sinceVersion = '0.0.0', filePath = changelogPath) {
  const sections = parseChangelogSections(readFileSync(filePath, 'utf8'))
    .filter((section) => compareVersions(section.version, sinceVersion) > 0);

  return formatAggregatedCommitMessage(sections);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || 'latest';
  const sinceVersion = process.argv[3] || '0.0.0';
  const message = mode === 'push'
    ? getPushCommitMessageFromChangelog(sinceVersion)
    : getCommitMessageFromChangelog();
  process.stdout.write(`${message}\n`);
}
