import {
  DEFAULT_BRANDS_AND_PRODUCTS,
  DEFAULT_CODE_LINKS_AND_FORMULAS,
  DEFAULT_PROPER_NOUNS,
  DEFAULT_TERMS_AND_ACRONYMS
} from './protected-terms-defaults.js';
export {
  DEFAULT_BRANDS_AND_PRODUCTS,
  DEFAULT_CODE_LINKS_AND_FORMULAS,
  DEFAULT_PROPER_NOUNS,
  DEFAULT_TERMS_AND_ACRONYMS
};

export const USER_PROTECTED_TERMS_STORAGE_KEY = 'userProtectedTerms';
export const PROTECTED_TERMS_VERSION = 4;

function normalizeTerm(term) {
  return String(term || '').trim();
}

function normalizeForMatch(term) {
  return normalizeTerm(term).toLowerCase();
}

export function normalizeProtectedTerm(term) {
  return normalizeForMatch(term);
}

export function dedupeTerms(terms) {
  const seen = new Set();
  const result = [];
  for (const term of Array.isArray(terms) ? terms : []) {
    const normalized = normalizeTerm(term);
    const key = normalizeForMatch(normalized);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function getProtectedTermDictionaries(userProtectedTerms = []) {
  return [
    {
      category: 'properNouns',
      categoryLabel: '专有名词',
      source: 'default',
      sourceLabel: '默认词库',
      terms: DEFAULT_PROPER_NOUNS
    },
    {
      category: 'brandsAndProducts',
      categoryLabel: '商标与产品名',
      source: 'default',
      sourceLabel: '默认词库',
      terms: DEFAULT_BRANDS_AND_PRODUCTS
    },
    {
      category: 'termsAndAcronyms',
      categoryLabel: '专业术语与缩写',
      source: 'default',
      sourceLabel: '默认词库',
      terms: DEFAULT_TERMS_AND_ACRONYMS
    },
    {
      category: 'codeVariablesLinksAndFormulas',
      categoryLabel: '专业代码、变量、链接和公式',
      source: 'default',
      sourceLabel: '默认词库',
      terms: DEFAULT_CODE_LINKS_AND_FORMULAS
    },
    {
      category: 'userProtectedTerms',
      categoryLabel: '用户自定义词库',
      source: 'user',
      sourceLabel: '用户自定义',
      terms: dedupeTerms(userProtectedTerms)
    }
  ];
}

export function getDefaultProtectedTerms() {
  return [];
}

export function getMergedProtectedTerms(userProtectedTerms = []) {
  const dictionaries = getProtectedTermDictionaries(userProtectedTerms);
  return dedupeTerms(dictionaries.flatMap((dictionary) => dictionary.terms));
}

const STRONG_MODE_WEAK_ASCII_PROTECTED_TERMS = new Set([
  'a', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or',
  'so', 'to', 'up', 'us', 'we', 'and', 'not', 'for', 'the', 'with', 'void', 'this', 'that', 'else', 'case', 'try',
  'new', 'var', 'let', 'const', 'null', 'true', 'false', 'return', 'break', 'continue', 'delete', 'typeof',
  'instanceof', 'print', 'println', 'printf', 'alert', 'prompt', 'confirm', 'fetch', 'home', 'best', 'buy', 'depot',
  'under', 'armour', 'target', 'cost', 'rust', 'java', 'swift', 'ruby', 'php', 'pip', 'npm', 'yarn', 'pnpm', 'cargo',
  'maven', 'gradle', 'python', 'kotlin', 'medium', 'word',
  'meet', 'use', 'series'
]);

function isStrongCodeProtectedTerm(term) {
  const normalized = normalizeTerm(term);
  if (!normalized) {
    return false;
  }

  if (/https?:\/\//i.test(normalized)) {
    return true;
  }

  if (/[`$<>=[\]|\\/]/.test(normalized)) {
    return true;
  }

  if (/\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(normalized)) {
    return true;
  }

  return normalized.length >= 16;
}

export function isStrongModeProtectedTerm(term) {
  const normalized = normalizeForMatch(term);
  if (!normalized) {
    return false;
  }

  if (STRONG_MODE_WEAK_ASCII_PROTECTED_TERMS.has(normalized)) {
    return false;
  }

  if (/^[a-z]+$/i.test(term) && term.length <= 3) {
    return false;
  }

  return true;
}

export function isYoutubeSubtitleProtectedTerm(term) {
  return isStrongModeProtectedTerm(term);
}

function buildStrongModeProtectedTerms(candidates) {
  return dedupeTerms(candidates).filter((term) => isStrongModeProtectedTerm(term));
}

export function getYoutubeMergedProtectedTerms(userProtectedTerms = []) {
  return buildStrongModeProtectedTerms([
    ...DEFAULT_BRANDS_AND_PRODUCTS,
    ...DEFAULT_CODE_LINKS_AND_FORMULAS.filter(isStrongCodeProtectedTerm),
    ...dedupeTerms(userProtectedTerms)
  ]);
}

export function getWebpageMergedProtectedTerms(userProtectedTerms = []) {
  return buildStrongModeProtectedTerms([
    ...DEFAULT_PROPER_NOUNS,
    ...DEFAULT_BRANDS_AND_PRODUCTS,
    ...DEFAULT_CODE_LINKS_AND_FORMULAS.filter(isStrongCodeProtectedTerm),
    ...dedupeTerms(userProtectedTerms)
  ]);
}

function buildWholeWordRegex(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[A-Za-z0-9_-]+$/.test(term)) {
    return new RegExp(`\\b${escaped}\\b`, 'gi');
  }
  return new RegExp(escaped, 'gi');
}

function hashMergedTermsKey(mergedTerms) {
  let hash = 2166136261;
  for (const term of mergedTerms) {
    const value = String(term || '');
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0;
  }
  return `${mergedTerms.length}:${hash >>> 0}`;
}

const mergedTermsProtectorCache = new Map();
const MERGED_TERMS_PROTECTOR_CACHE_LIMIT = 6;

export function clearMergedTermsProtectorCache() {
  mergedTermsProtectorCache.clear();
}

export function buildMergedTermsProtector(mergedTerms) {
  const terms = dedupeTerms(mergedTerms).sort((a, b) => b.length - a.length);
  const cacheKey = hashMergedTermsKey(terms);
  if (mergedTermsProtectorCache.has(cacheKey)) {
    return mergedTermsProtectorCache.get(cacheKey);
  }

  const normalizedMergedSet = new Set(terms.map((term) => normalizeProtectedTerm(term)));
  const compiledTerms = terms.map((term) => ({
    term,
    length: term.length,
    isAsciiWord: /^[A-Za-z0-9_-]+$/.test(term),
    lowerTerm: /^[A-Za-z0-9_-]+$/.test(term) ? term.toLowerCase() : '',
    regex: buildWholeWordRegex(term)
  }));

  const protector = {
    isFullyProtectedSource(sourceText) {
      const normalizedSourceText = normalizeProtectedTerm(sourceText);
      return Boolean(normalizedSourceText && normalizedMergedSet.has(normalizedSourceText));
    },
    protect(sourceText) {
      const text = String(sourceText || '');
      if (!text || terms.length === 0) {
        return { text, placeholders: [], isFullyProtected: false };
      }
      if (normalizedMergedSet.has(normalizeProtectedTerm(text))) {
        return { text, placeholders: [], isFullyProtected: true };
      }

      let masked = text;
      const placeholders = [];
      let counter = 0;
      const lowerSource = text.toLowerCase();

      for (const entry of compiledTerms) {
        if (entry.length > text.length) {
          continue;
        }
        if (entry.isAsciiWord && !lowerSource.includes(entry.lowerTerm)) {
          continue;
        }

        entry.regex.lastIndex = 0;
        masked = masked.replace(entry.regex, (match) => {
          const placeholder = `__CT_TERM_${counter}__`;
          counter += 1;
          placeholders.push({ placeholder, original: match });
          return placeholder;
        });
      }

      const isFullyProtected = placeholders.length > 0 &&
        masked.replace(/__CT_TERM_\d+__/g, '').trim() === '';
      return { text: masked, placeholders, isFullyProtected };
    }
  };

  if (mergedTermsProtectorCache.size >= MERGED_TERMS_PROTECTOR_CACHE_LIMIT) {
    const oldestKey = mergedTermsProtectorCache.keys().next().value;
    mergedTermsProtectorCache.delete(oldestKey);
  }
  mergedTermsProtectorCache.set(cacheKey, protector);
  return protector;
}

export function protectTermsInText(text, userProtectedTerms = [], options = {}) {
  if (options.protectedTermProtector) {
    return options.protectedTermProtector.protect(text);
  }

  const mergedTerms = options.useTermsAsMerged
    ? dedupeTerms(userProtectedTerms)
    : getMergedProtectedTerms(userProtectedTerms);

  return buildMergedTermsProtector(mergedTerms).protect(text);
}

export function restoreProtectedTerms(text, placeholders = []) {
  let restored = String(text || '');
  for (const item of placeholders) {
    if (!item?.placeholder) {
      continue;
    }
    restored = restored.split(item.placeholder).join(item.original || '');
  }
  return restored;
}

export function searchProtectedTerms(query, dictionaries) {
  const normalizedQuery = normalizeProtectedTerm(query);
  if (!normalizedQuery) {
    return {
      query,
      found: false,
      normalizedQuery,
      matches: []
    };
  }

  const matches = [];
  for (const dictionary of Array.isArray(dictionaries) ? dictionaries : []) {
    for (const term of dictionary.terms || []) {
      if (normalizeProtectedTerm(term) === normalizedQuery) {
        matches.push({
          term,
          category: dictionary.category,
          categoryLabel: dictionary.categoryLabel,
          source: dictionary.source,
          sourceLabel: dictionary.sourceLabel
        });
      }
    }
  }

  return {
    query,
    found: matches.length > 0,
    normalizedQuery,
    matches
  };
}
