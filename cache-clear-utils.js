export function filterSessionEntriesByLanguage(entries, targetLanguage) {
  const encodedTargetLanguage = encodeURIComponent(targetLanguage || 'unknown');
  const sourceEntries = entries && typeof entries === 'object' ? entries : {};
  const filteredEntries = Object.fromEntries(
    Object.entries(sourceEntries).filter(([cacheKey]) => String(cacheKey).split(':')[2] !== encodedTargetLanguage)
  );
  const changed = Object.keys(filteredEntries).length !== Object.keys(sourceEntries).length;
  return { filteredEntries, changed };
}

export function getSessionCacheKeysBySite(sessionSnapshot, site) {
  const snapshot = sessionSnapshot && typeof sessionSnapshot === 'object' ? sessionSnapshot : {};
  const keys = [];
  for (const [sessionKey, value] of Object.entries(snapshot)) {
    if (!String(sessionKey).startsWith('sessionTranslationCache:')) {
      continue;
    }
    if (String(value?.url || '') && getTranslationCacheSiteFromUrl(value.url) === site) {
      keys.push(sessionKey);
    }
  }
  return keys;
}

function getTranslationCacheSiteFromUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    return url.hostname.toLowerCase() || 'unknown-site';
  } catch {
    return 'unknown-site';
  }
}
