const cacheKeyPrefixByLanguage = new Map();

export function normalizeSourceTextForCache(sourceText) {
  return String(sourceText || '').replace(/\s+/g, ' ').trim();
}

function getCacheKeyPrefix(targetLanguage, sourceLanguage) {
  const prefixKey = `${targetLanguage}\u0000${sourceLanguage || 'auto'}`;
  let prefix = cacheKeyPrefixByLanguage.get(prefixKey);
  if (!prefix) {
    prefix = [
      'translation',
      encodeURIComponent(targetLanguage || 'unknown'),
      encodeURIComponent(sourceLanguage || 'auto'),
      ''
    ].join(':');
    cacheKeyPrefixByLanguage.set(prefixKey, prefix);
  }
  return prefix;
}

function hashSourceText(sourceText) {
  let hash = 2166136261;
  const text = String(sourceText || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${text.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

export function buildTranslationCacheKey(sourceText, sourceLanguage, targetLanguage) {
  const normalized = normalizeSourceTextForCache(sourceText);
  if (!normalized) {
    return '';
  }

  return `${getCacheKeyPrefix(targetLanguage, sourceLanguage)}${hashSourceText(normalized)}`;
}
