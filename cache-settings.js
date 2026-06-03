import { CACHE_CLEANUP_CONFIG } from './translation-cache.js';

export const CACHE_LIMIT_MODE_STORAGE_KEY = 'cacheLimitMode';
export const CACHE_LIMIT_MAX_ENTRIES_STORAGE_KEY = 'cacheLimitMaxEntries';

export const CACHE_LIMIT_MODE = {
  CUSTOM: 'custom',
  INFINITE: 'infinite'
};

export const DEFAULT_CACHE_MAX_ENTRIES = CACHE_CLEANUP_CONFIG.maxEntriesPerLanguage;

export function getDefaultCacheLimitSettings() {
  return {
    [CACHE_LIMIT_MODE_STORAGE_KEY]: CACHE_LIMIT_MODE.CUSTOM,
    [CACHE_LIMIT_MAX_ENTRIES_STORAGE_KEY]: DEFAULT_CACHE_MAX_ENTRIES
  };
}

export function resolveCacheCleanupConfig(userSettings = {}) {
  const mode = normalizeCacheLimitMode(userSettings[CACHE_LIMIT_MODE_STORAGE_KEY]);
  const maxEntries = mode === CACHE_LIMIT_MODE.INFINITE
    ? 0
    : normalizePositiveInteger(
      userSettings[CACHE_LIMIT_MAX_ENTRIES_STORAGE_KEY],
      DEFAULT_CACHE_MAX_ENTRIES
    );

  return {
    ...CACHE_CLEANUP_CONFIG,
    maxEntriesPerLanguage: maxEntries
  };
}

export function formatCacheLimitDescription(settings = {}) {
  const mode = normalizeCacheLimitMode(settings[CACHE_LIMIT_MODE_STORAGE_KEY]);
  if (mode === CACHE_LIMIT_MODE.INFINITE) {
    return '每语言缓存上限：不限制（自动清理仍可按时间与长文本规则裁剪）';
  }

  const maxEntries = normalizePositiveInteger(
    settings[CACHE_LIMIT_MAX_ENTRIES_STORAGE_KEY],
    DEFAULT_CACHE_MAX_ENTRIES
  );
  return `每语言缓存上限：${maxEntries} 条`;
}

function normalizeCacheLimitMode(value) {
  return value === CACHE_LIMIT_MODE.INFINITE ? CACHE_LIMIT_MODE.INFINITE : CACHE_LIMIT_MODE.CUSTOM;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
