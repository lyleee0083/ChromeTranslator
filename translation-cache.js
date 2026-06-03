export const LOCAL_TRANSLATION_CACHE_STORAGE_KEY = 'localTranslationCache';
export const LOCAL_TRANSLATION_CACHE_DIRECTORY_STORAGE_KEY = 'localTranslationCacheDirectory';
export const CACHE_CLEANUP_CONFIG = {
  maxEntriesPerLanguage: 5000,
  maxEntryTextLength: 3000,
  maxAgeDays: 30,
  minHitCountToKeepLongEntries: 2
};

export function getTranslationCacheSite(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    return url.hostname.toLowerCase() || 'unknown-site';
  } catch {
    return 'unknown-site';
  }
}

export function buildLocalTranslationCacheStorageKey(targetLanguage) {
  return [
    LOCAL_TRANSLATION_CACHE_STORAGE_KEY,
    encodeURIComponent(targetLanguage || 'unknown')
  ].join(':');
}

export function getLocalTranslationCacheDirectoryEntry(directory, site, targetLanguage) {
  const keys = directory?.[site]?.[targetLanguage];
  return Array.isArray(keys) ? keys : [];
}

export function addLocalTranslationCacheDirectoryKey(directory, site, targetLanguage, cacheKey) {
  const existingKeys = getLocalTranslationCacheDirectoryEntry(directory, site, targetLanguage);
  if (existingKeys.includes(cacheKey)) {
    return directory || {};
  }

  return setLocalTranslationCacheDirectoryEntry(directory, site, targetLanguage, [
    ...existingKeys,
    cacheKey
  ]);
}

function setLocalTranslationCacheDirectoryEntry(directory, site, targetLanguage, cacheKeys) {
  const nextDirectory = { ...(directory || {}) };
  nextDirectory[site] = {
    ...(nextDirectory[site] || {}),
    [targetLanguage]: [...new Set(cacheKeys)]
  };

  return nextDirectory;
}

export function cleanupLocalTranslationCacheIndex(localIndex, config = CACHE_CLEANUP_CONFIG, now = Date.now()) {
  const maxAgeMs = Number(config.maxAgeDays || 0) * 24 * 60 * 60 * 1000;
  const entries = [...localIndex.globalCache.entries()];
  const staleKeys = new Set();

  for (const [cacheKey, entry] of entries) {
    const lastUsedAt = Number(entry?.lastUsedAt || entry?.createdAt || 0);
    const translatedTextLength = String(entry?.translatedText || '').length;
    const hitCount = Number(entry?.hitCount || 0);
    const isExpired = maxAgeMs > 0 && lastUsedAt > 0 && now - lastUsedAt > maxAgeMs;
    const isLowValueLongEntry = translatedTextLength > config.maxEntryTextLength &&
      hitCount < config.minHitCountToKeepLongEntries;

    if (isExpired || isLowValueLongEntry) {
      staleKeys.add(cacheKey);
    }
  }

  for (const cacheKey of staleKeys) {
    localIndex.globalCache.delete(cacheKey);
  }

  trimCacheToMaxEntries(localIndex.globalCache, config.maxEntriesPerLanguage, staleKeys);
  localIndex.directory = removeLocalTranslationCacheDirectoryKeys(
    localIndex.directory,
    localIndex.targetLanguage,
    staleKeys
  );

  return {
    ...localIndex,
    removedKeys: [...staleKeys]
  };
}

export function getLocalTranslationCacheStats(directory, languageCaches) {
  const byLanguage = {};
  let totalEntries = 0;
  let totalApproxBytes = 0;

  for (const [language, cache] of Object.entries(languageCaches || {})) {
    const entries = cache instanceof Map ? [...cache.values()] : Object.values(cache || {});
    byLanguage[language] = entries.length;
    totalEntries += entries.length;
    totalApproxBytes += entries.reduce((sum, entry) => (
      sum + JSON.stringify(entry || '').length
    ), 0);
  }

  return {
    totalEntries,
    totalApproxBytes,
    byLanguage,
    topSites: getTopCacheSites(directory)
  };
}

function removeLocalTranslationCacheDirectoryKeys(directory, targetLanguage, keysToRemove) {
  const removeSet = keysToRemove instanceof Set ? keysToRemove : new Set(keysToRemove || []);
  const nextDirectory = {};

  for (const [site, languageMap] of Object.entries(directory || {})) {
    const nextLanguageMap = { ...(languageMap || {}) };
    if (Array.isArray(nextLanguageMap[targetLanguage])) {
      nextLanguageMap[targetLanguage] = nextLanguageMap[targetLanguage]
        .filter((cacheKey) => !removeSet.has(cacheKey));
    }

    if (Object.values(nextLanguageMap).some((cacheKeys) => Array.isArray(cacheKeys) && cacheKeys.length > 0)) {
      nextDirectory[site] = nextLanguageMap;
    }
  }

  return nextDirectory;
}

function trimCacheToMaxEntries(globalCache, maxEntries, removedKeys) {
  if (!maxEntries || globalCache.size <= maxEntries) {
    return;
  }

  const orderedKeys = [...globalCache.entries()]
    .sort((left, right) => {
      const leftEntry = left[1] || {};
      const rightEntry = right[1] || {};
      const leftHitCount = Number(leftEntry.hitCount || 0);
      const rightHitCount = Number(rightEntry.hitCount || 0);
      if (leftHitCount !== rightHitCount) {
        return leftHitCount - rightHitCount;
      }

      return Number(leftEntry.lastUsedAt || leftEntry.createdAt || 0) -
        Number(rightEntry.lastUsedAt || rightEntry.createdAt || 0);
    })
    .map(([cacheKey]) => cacheKey);

  while (globalCache.size > maxEntries && orderedKeys.length > 0) {
    const cacheKey = orderedKeys.shift();
    globalCache.delete(cacheKey);
    removedKeys.add(cacheKey);
  }
}

function getTopCacheSites(directory) {
  return Object.entries(directory || {})
    .map(([site, languageMap]) => ({
      site,
      entries: Object.values(languageMap || {})
        .reduce((sum, cacheKeys) => sum + (Array.isArray(cacheKeys) ? cacheKeys.length : 0), 0)
    }))
    .filter((site) => site.entries > 0)
    .sort((left, right) => right.entries - left.entries)
    .slice(0, 10);
}
