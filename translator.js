import { getLanguageByCode } from './language-options.js';
import {
  PROTECTED_TERMS_VERSION,
  protectTermsInText,
  restoreProtectedTerms
} from './protected-terms.js';
import {
  hasChineseTargetEnglishResidue,
  isClearlyEnglishSourceText,
  isStaleProtectedTermsCacheEntry
} from './translation-residue-utils.js';
import {
  buildGoogleTranslateUrl,
  parseGoogleTranslateResponse
} from './google-translate.js';
import {
  fetchDeepLTranslatedTexts,
  isDeepLTargetLanguageSupported
} from './deepl-translate.js';

export { isDeepLTargetLanguageSupported, getDeepLTargetLanguageCode } from './deepl-translate.js';
export { isGoogleTargetLanguageSupported } from './google-translate.js';

export const NETWORK_TRANSLATION_PROVIDER = 'google';
export const POLISH_TRANSLATION_PROVIDER = 'deepl';
export const BATCH_TRANSLATION_CONFIG = {
  maxItems: 20,
  maxChars: 4000,
  minTextLength: 2,
  maxSingleTextLength: 1000
};
const NETWORK_TRANSLATE_CONCURRENCY = {
  initial: 2,
  min: 1,
  max: 3
};
const CACHE_LOOKUP_CONCURRENCY = {
  min: 4,
  normal: 10,
  max: 20
};

let activeNetworkRequests = 0;
const queuedNetworkRequests = [];
const inFlightTranslations = new Map();
const inFlightBatchRequests = new Map();
let networkConcurrency = NETWORK_TRANSLATE_CONCURRENCY.initial;

export function getDefaultSourceLanguage(targetLanguage) {
  return 'auto';
}

export function buildTranslationCacheKey(sourceText, sourceLanguage, targetLanguage) {
  return [
    'translation',
    encodeURIComponent(targetLanguage || 'unknown'),
    encodeURIComponent(sourceLanguage || 'auto'),
    hashSourceText(normalizeSourceText(sourceText))
  ].join(':');
}

export function normalizeTranslatedText(translatedText, targetLanguage) {
  if (targetLanguage !== 'zh-CN') {
    return translatedText;
  }

  return String(translatedText || '')
    .replace(/\u314b{2,}/g, (match) => '\u54c8'.repeat(Math.min(match.length, 6)))
    .replace(/\u314e{2,}/g, (match) => '\u54c8'.repeat(Math.min(match.length, 6)))
    .replace(/[\u3160\u315c]{2,}/g, (match) => '\u545c'.repeat(Math.min(match.length, 6)))
    .replace(/\u3163/g, '|');
}

export function hasResidualKoreanText(text) {
  return /[\uac00-\ud7af]/.test(String(text || ''));
}

export function isTranslationTargetLanguageSupported(targetLanguage) {
  return isDeepLTargetLanguageSupported(targetLanguage);
}

export async function translateText(sourceText, targetLanguage, options = {}) {
  const language = getLanguageByCode(targetLanguage);
  const normalizedSource = normalizeSourceText(sourceText);

  if (!normalizedSource) {
    return buildTranslationResult('', '', language);
  }

  const fetchImpl = options.fetchImpl || fetch;
  const apiKey = String(options.apiKey || '').trim();
  const networkEnabled = options.networkEnabled !== false;
  const sourceLanguage = options.sourceLanguage || getDefaultSourceLanguage(language.code);
  const localCache = options.localCache;
  const cache = options.cache;
  const userProtectedTerms = options.userProtectedTerms || [];
  const useTermsAsMerged = options.useProtectedTermsAsMerged === true;
  const cacheKey = buildTranslationCacheKey(normalizedSource, sourceLanguage, language.code);
  const protectOptions = {
    useTermsAsMerged,
    protectedTermProtector: options.protectedTermProtector
  };

  if (options.protectedTermProtector?.isFullyProtectedSource(normalizedSource)) {
    return buildTranslationResult(normalizedSource, normalizedSource, language, 'protected');
  }

  if (cache?.has?.(cacheKey)) {
    const cachedText = normalizeTranslatedText(readCachedTranslatedText(cache.get(cacheKey)), language.code);
    if (cachedText && !hasResidualKoreanText(cachedText)) {
      writeTranslationCacheEntry(cache, cacheKey, normalizedSource, sourceLanguage, language.code, cachedText, readCacheProvider(cache.get(cacheKey)));
      scheduleDeepLPolishFromLocalCache(cacheKey, normalizedSource, sourceLanguage, language.code, {
        fetchImpl,
        apiKey,
        cache,
        localCache,
        priority: options.priority
      });
      return buildTranslationResult(normalizedSource, cachedText, language, 'cache');
    }
  }

  if (localCache?.has?.(cacheKey)) {
    const cachedText = normalizeTranslatedText(readCachedTranslatedText(localCache.get(cacheKey)), language.code);
    if (cachedText && !hasResidualKoreanText(cachedText)) {
      writeTranslationCacheEntry(localCache, cacheKey, normalizedSource, sourceLanguage, language.code, cachedText, readCacheProvider(localCache.get(cacheKey)));
      writeTranslationCacheEntry(cache, cacheKey, normalizedSource, sourceLanguage, language.code, cachedText, readCacheProvider(localCache.get(cacheKey)));
      scheduleDeepLPolishFromLocalCache(cacheKey, normalizedSource, sourceLanguage, language.code, {
        fetchImpl,
        apiKey,
        cache,
        localCache,
        priority: options.priority
      });
      return buildTranslationResult(normalizedSource, cachedText, language, 'cache');
    }
  }

  try {
    if (!networkEnabled) {
      return buildTranslationResult(
        normalizedSource,
        normalizedSource,
        language,
        'original',
        'cache_miss_network_disabled'
      );
    }

    const protectedResult = protectTermsInText(normalizedSource, userProtectedTerms, protectOptions);
    if (protectedResult.isFullyProtected) {
      return buildTranslationResult(normalizedSource, normalizedSource, language, 'protected');
    }

    let translatedText = await translateWithInFlightDedup(
      cacheKey,
      fetchImpl,
      protectedResult.text,
      protectedResult.placeholders,
      options.priority,
      language.code
    );
    if (!translatedText) {
      throw new Error('Google translate endpoint response did not include translated text.');
    }

    translatedText = normalizeTranslatedText(translatedText, language.code);
    translatedText = await maybeRetryChineseResidueTranslation({
      normalizedSource,
      translatedText,
      languageCode: language.code,
      fetchImpl,
      priority: options.priority,
      enableRetry: options.enableChineseResidueRetry === true,
      userProtectedTerms: options.userProtectedTermsForRetry || []
    });

    writeTranslationCacheEntry(cache, cacheKey, normalizedSource, sourceLanguage, language.code, translatedText, NETWORK_TRANSLATION_PROVIDER);
    writeTranslationCacheEntry(localCache, cacheKey, normalizedSource, sourceLanguage, language.code, translatedText, NETWORK_TRANSLATION_PROVIDER);

    const polishedText = await polishLocalPersistentCacheEntry(cacheKey, normalizedSource, sourceLanguage, language.code, {
      fetchImpl,
      apiKey,
      cache,
      localCache,
      priority: options.priority
    });
    if (polishedText) {
      translatedText = polishedText;
    }

    return buildTranslationResult(
      normalizedSource,
      translatedText,
      language,
      'network',
      '',
      polishedText ? POLISH_TRANSLATION_PROVIDER : NETWORK_TRANSLATION_PROVIDER
    );
  } catch {
    return buildTranslationResult(
      normalizedSource,
      normalizedSource,
      language,
      'original',
      'network_error'
    );
  }
}

export async function translateTextBatch(sourceTexts, targetLanguage, options = {}) {
  const language = getLanguageByCode(targetLanguage);
  const sourceLanguage = options.sourceLanguage || getDefaultSourceLanguage(language.code);
  const cache = options.cache;
  const localCache = options.localCache;
  const fetchImpl = options.fetchImpl || fetch;
  const apiKey = String(options.apiKey || '').trim();
  const networkEnabled = options.networkEnabled !== false;
  const userProtectedTerms = options.userProtectedTerms || [];
  const useTermsAsMerged = options.useProtectedTermsAsMerged === true;
  const normalizedTexts = normalizeBatchSourceTexts(sourceTexts);
  const results = new Array(normalizedTexts.length).fill(null);
  const missingItems = [];

  normalizedTexts.forEach((sourceText, index) => {
    if (!sourceText) {
      results[index] = buildTranslationResult('', '', language);
      return;
    }

    const cacheKey = buildTranslationCacheKey(sourceText, sourceLanguage, language.code);
    const protectOptions = {
      useTermsAsMerged,
      protectedTermProtector: options.protectedTermProtector
    };

    if (options.protectedTermProtector?.isFullyProtectedSource(sourceText)) {
      results[index] = buildTranslationResult(sourceText, sourceText, language, 'protected');
      return;
    }

    const activeText = cache?.has?.(cacheKey)
      ? normalizeTranslatedText(readCachedTranslatedText(cache.get(cacheKey)), language.code)
      : '';
    if (activeText && !hasResidualKoreanText(activeText)) {
      writeTranslationCacheEntry(cache, cacheKey, sourceText, sourceLanguage, language.code, activeText, readCacheProvider(cache.get(cacheKey)));
      scheduleDeepLPolishFromLocalCache(cacheKey, sourceText, sourceLanguage, language.code, {
        fetchImpl,
        apiKey,
        cache,
        localCache,
        priority: options.priority
      });
      results[index] = buildTranslationResult(sourceText, activeText, language, 'cache');
      return;
    }

    const localText = localCache?.has?.(cacheKey)
      ? normalizeTranslatedText(readCachedTranslatedText(localCache.get(cacheKey)), language.code)
      : '';
    if (localText && !hasResidualKoreanText(localText)) {
      writeTranslationCacheEntry(cache, cacheKey, sourceText, sourceLanguage, language.code, localText, readCacheProvider(localCache.get(cacheKey)));
      writeTranslationCacheEntry(localCache, cacheKey, sourceText, sourceLanguage, language.code, localText, readCacheProvider(localCache.get(cacheKey)));
      scheduleDeepLPolishFromLocalCache(cacheKey, sourceText, sourceLanguage, language.code, {
        fetchImpl,
        apiKey,
        cache,
        localCache,
        priority: options.priority
      });
      results[index] = buildTranslationResult(sourceText, localText, language, 'cache');
      return;
    }

    missingItems.push({
      index,
      sourceText,
      cacheKey,
      protectOptions
    });
  });

  if (!networkEnabled) {
    missingItems.forEach((item) => {
      results[item.index] = buildTranslationResult(
        item.sourceText,
        item.sourceText,
        language,
        'original',
        'cache_miss_network_disabled'
      );
    });
    return results;
  }

  const groupedItems = splitBatchTranslationItems(missingItems, options.isPageHidden);
  const batchOptions = {
    fetchImpl,
    sourceLanguage,
    cache,
    localCache,
    apiKey,
    priority: options.priority,
    enableChineseResidueRetry: options.enableChineseResidueRetry === true,
    userProtectedTermsForRetry: options.userProtectedTermsForRetry || [],
    userProtectedTerms,
    language
  };

  await runWithConcurrencyLimit(
    groupedItems,
    options.isPageHidden ? NETWORK_TRANSLATE_CONCURRENCY.min : networkConcurrency,
    (group) => processMissingTranslationGroup(group, results, batchOptions)
  );

  return results;
}

async function processMissingTranslationGroup(group, results, batchOptions) {
  const {
    fetchImpl,
    sourceLanguage,
    cache,
    localCache,
    apiKey,
    priority,
    enableChineseResidueRetry,
    userProtectedTermsForRetry,
    userProtectedTerms,
    language
  } = batchOptions;

  const maskedGroup = group.map((item) => {
    const protectedResult = protectTermsInText(item.sourceText, userProtectedTerms, item.protectOptions);
    if (protectedResult.isFullyProtected) {
      results[item.index] = buildTranslationResult(item.sourceText, item.sourceText, language, 'protected');
      return null;
    }
    item.maskedText = protectedResult.text;
    item.placeholders = protectedResult.placeholders;
    return item;
  }).filter(Boolean);

  if (maskedGroup.length === 0) {
    return;
  }

  const translatedTexts = await translateBatchGroupWithFallback(
    maskedGroup.map((item) => item.maskedText),
    language.code,
    { fetchImpl, priority }
  );

  for (let groupIndex = 0; groupIndex < maskedGroup.length; groupIndex += 1) {
    const item = maskedGroup[groupIndex];
    let translatedText = normalizeTranslatedText(
      restoreProtectedTerms(translatedTexts[groupIndex] || '', item.placeholders),
      language.code
    );
    translatedText = await maybeRetryChineseResidueTranslation({
      normalizedSource: item.sourceText,
      translatedText,
      languageCode: language.code,
      fetchImpl,
      priority,
      enableRetry: enableChineseResidueRetry,
      userProtectedTerms: userProtectedTermsForRetry
    });
    if (!translatedText) {
      results[item.index] = buildTranslationResult(
        item.sourceText,
        item.sourceText,
        language,
        'original',
        'network_error'
      );
      continue;
    }

    writeTranslationCacheEntry(cache, item.cacheKey, item.sourceText, sourceLanguage, language.code, translatedText, NETWORK_TRANSLATION_PROVIDER);
    writeTranslationCacheEntry(localCache, item.cacheKey, item.sourceText, sourceLanguage, language.code, translatedText, NETWORK_TRANSLATION_PROVIDER);

    const polishedText = await polishLocalPersistentCacheEntry(item.cacheKey, item.sourceText, sourceLanguage, language.code, {
      fetchImpl,
      apiKey,
      cache,
      localCache,
      priority
    });
    if (polishedText) {
      translatedText = polishedText;
    }

    results[item.index] = buildTranslationResult(
      item.sourceText,
      translatedText,
      language,
      'network',
      '',
      polishedText ? POLISH_TRANSLATION_PROVIDER : NETWORK_TRANSLATION_PROVIDER
    );
  }
}

async function runWithConcurrencyLimit(items, limit, worker) {
  if (items.length === 0) {
    return;
  }

  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex], currentIndex);
    }
  }));
}

function translateWithInFlightDedup(cacheKey, fetchImpl, sourceText, placeholders, priority, targetLanguage) {
  if (inFlightTranslations.has(cacheKey)) {
    return inFlightTranslations.get(cacheKey);
  }

  const promise = fetchTranslatedTextBatch(fetchImpl, [sourceText], targetLanguage, priority)
    .then((translatedTexts) => restoreProtectedTerms(translatedTexts[0] || '', placeholders))
    .finally(() => {
      inFlightTranslations.delete(cacheKey);
    });
  inFlightTranslations.set(cacheKey, promise);
  return promise;
}

async function translateBatchGroupWithFallback(sourceTexts, targetLanguage, options) {
  if (sourceTexts.length === 0) {
    return [];
  }

  try {
    return await fetchTranslatedTextBatch(
      options.fetchImpl,
      sourceTexts,
      targetLanguage,
      options.priority
    );
  } catch {
    if (sourceTexts.length > 1) {
      const midpoint = Math.ceil(sourceTexts.length / 2);
      const left = await translateBatchGroupWithFallback(
        sourceTexts.slice(0, midpoint),
        targetLanguage,
        options
      );
      const right = await translateBatchGroupWithFallback(
        sourceTexts.slice(midpoint),
        targetLanguage,
        options
      );
      return [...left, ...right];
    }

    const result = await translateText(sourceTexts[0], targetLanguage, {
      fetchImpl: options.fetchImpl,
      networkEnabled: true,
      priority: options.priority
    });
    if (result.source === 'original' || result.source === 'protected') {
      return [''];
    }

    return [result.translatedText];
  }
}

function buildBatchRequestKey(targetLanguage, sourceTexts) {
  return [targetLanguage, sourceTexts.join('\u0002')].join('\u0001');
}

async function fetchTranslatedTextBatch(fetchImpl, sourceTexts, targetLanguage, priority = 5) {
  const batchKey = buildBatchRequestKey(targetLanguage, sourceTexts);
  if (inFlightBatchRequests.has(batchKey)) {
    return inFlightBatchRequests.get(batchKey);
  }

  const promise = (async () => {
    const url = buildGoogleTranslateUrl(sourceTexts, targetLanguage);
    const response = await enqueueNetworkRequest(() => fetchImpl(url), priority);
    if (!response.ok) {
      markNetworkRequestFailure();
      throw new Error(`Google translate endpoint responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    markNetworkRequestSuccess();
    return parseGoogleTranslateResponse(data, sourceTexts.length)
      .map((text) => normalizeTranslatedText(text, targetLanguage));
  })().finally(() => {
    inFlightBatchRequests.delete(batchKey);
  });

  inFlightBatchRequests.set(batchKey, promise);
  return promise;
}

function enqueueNetworkRequest(task, priority = 5) {
  return new Promise((resolve, reject) => {
    queuedNetworkRequests.push({ task, resolve, reject, priority: Number.isFinite(priority) ? priority : 5 });
    processNetworkRequestQueue();
  });
}

function processNetworkRequestQueue() {
  while (activeNetworkRequests < networkConcurrency && queuedNetworkRequests.length > 0) {
    const nextIndex = getNextQueuedNetworkRequestIndex();
    const [queuedRequest] = queuedNetworkRequests.splice(nextIndex, 1);
    activeNetworkRequests += 1;

    Promise.resolve()
      .then(queuedRequest.task)
      .then(queuedRequest.resolve, queuedRequest.reject)
      .finally(() => {
        activeNetworkRequests -= 1;
        processNetworkRequestQueue();
      });
  }
}

function getNextQueuedNetworkRequestIndex() {
  let selectedIndex = 0;
  for (let index = 1; index < queuedNetworkRequests.length; index += 1) {
    if (queuedNetworkRequests[index].priority < queuedNetworkRequests[selectedIndex].priority) {
      selectedIndex = index;
    }
  }
  return selectedIndex;
}

function markNetworkRequestSuccess() {
  networkConcurrency = Math.min(networkConcurrency + 1, NETWORK_TRANSLATE_CONCURRENCY.max);
}

function markNetworkRequestFailure() {
  networkConcurrency = NETWORK_TRANSLATE_CONCURRENCY.min;
}

const polishInFlight = new Map();

function scheduleDeepLPolishFromLocalCache(cacheKey, sourceText, sourceLanguage, targetLanguage, options) {
  if (!options.apiKey || !options.localCache?.has?.(cacheKey)) {
    return;
  }

  if (polishInFlight.has(cacheKey)) {
    return;
  }

  const promise = polishLocalPersistentCacheEntry(cacheKey, sourceText, sourceLanguage, targetLanguage, options)
    .catch(() => null)
    .finally(() => {
      polishInFlight.delete(cacheKey);
    });
  polishInFlight.set(cacheKey, promise);
}

async function polishLocalPersistentCacheEntry(cacheKey, sourceText, sourceLanguage, targetLanguage, options) {
  const apiKey = String(options.apiKey || '').trim();
  const localCache = options.localCache;
  if (!apiKey || !localCache?.has?.(cacheKey)) {
    return '';
  }

  const cachedEntry = localCache.get(cacheKey);
  const cachedText = normalizeTranslatedText(readCachedTranslatedText(cachedEntry), targetLanguage);
  if (!cachedText) {
    return '';
  }

  if (readCacheProvider(cachedEntry) === POLISH_TRANSLATION_PROVIDER) {
    return cachedText;
  }

  const normalizedSource = normalizeSourceText(sourceText);
  if (!normalizedSource) {
    return '';
  }

  try {
    const requestOptions = isClearlyEnglishSourceText(normalizedSource)
      ? { sourceLang: 'EN' }
      : {};
    const polishedTexts = await fetchDeepLTranslatedTexts(
      options.fetchImpl || fetch,
      [normalizedSource],
      targetLanguage,
      apiKey,
      requestOptions
    );
    const polishedText = normalizeTranslatedText(polishedTexts[0] || '', targetLanguage);
    if (!polishedText || polishedText === cachedText) {
      return cachedText;
    }

    writeTranslationCacheEntry(options.cache, cacheKey, normalizedSource, sourceLanguage, targetLanguage, polishedText, POLISH_TRANSLATION_PROVIDER);
    writeTranslationCacheEntry(localCache, cacheKey, normalizedSource, sourceLanguage, targetLanguage, polishedText, POLISH_TRANSLATION_PROVIDER);
    return polishedText;
  } catch {
    return cachedText;
  }
}

function buildTranslationResult(sourceText, translatedText, language, source = '', reason = '', provider = '') {
  const result = {
    sourceText,
    translatedText,
    targetLanguage: language.code,
    targetLanguageName: language.name
  };
  if (source) {
    result.source = source;
  }
  if (reason) {
    result.reason = reason;
  }
  if (provider) {
    result.provider = provider;
  }

  return result;
}

function normalizeBatchSourceTexts(sourceTexts) {
  return (Array.isArray(sourceTexts) ? sourceTexts : [])
    .map((sourceText) => normalizeSourceText(sourceText));
}

function splitBatchTranslationItems(items, isPageHidden = false) {
  const concurrencyHint = getCacheLookupConcurrency(items.length, isPageHidden);
  const maxItemsPerGroup = Math.min(BATCH_TRANSLATION_CONFIG.maxItems, Math.max(1, concurrencyHint));
  const groups = [];
  let currentGroup = [];
  let currentChars = 0;

  for (const item of items) {
    const textLength = item.sourceText.length;
    const shouldSplit = currentGroup.length > 0 && (
      currentGroup.length >= BATCH_TRANSLATION_CONFIG.maxItems ||
      currentGroup.length >= maxItemsPerGroup ||
      currentChars + textLength > BATCH_TRANSLATION_CONFIG.maxChars ||
      textLength > BATCH_TRANSLATION_CONFIG.maxSingleTextLength
    );

    if (shouldSplit) {
      groups.push(currentGroup);
      currentGroup = [];
      currentChars = 0;
    }

    if (textLength > BATCH_TRANSLATION_CONFIG.maxSingleTextLength) {
      groups.push([item]);
      continue;
    }

    currentGroup.push(item);
    currentChars += textLength;
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

export function getCacheLookupConcurrency(taskCount, isPageHidden = false) {
  if (isPageHidden) {
    return CACHE_LOOKUP_CONCURRENCY.min;
  }
  if (taskCount <= 50) {
    return 6;
  }
  if (taskCount <= 300) {
    return CACHE_LOOKUP_CONCURRENCY.normal;
  }
  return CACHE_LOOKUP_CONCURRENCY.max;
}

function readCachedTranslatedText(value) {
  if (isStaleProtectedTermsCacheEntry(value, PROTECTED_TERMS_VERSION)) {
    return '';
  }

  return typeof value?.translatedText === 'string' ? value.translatedText : '';
}

function readCacheProvider(value) {
  return typeof value?.provider === 'string' ? value.provider : '';
}

async function maybeRetryChineseResidueTranslation({
  normalizedSource,
  translatedText,
  languageCode,
  fetchImpl,
  priority,
  enableRetry,
  userProtectedTerms
}) {
  if (!enableRetry || !hasChineseTargetEnglishResidue(translatedText, languageCode)) {
    return translatedText;
  }

  const userOnlyProtected = protectTermsInText(normalizedSource, userProtectedTerms, {
    useTermsAsMerged: true
  });
  const retryTexts = await fetchTranslatedTextBatch(
    fetchImpl,
    [userOnlyProtected.text],
    languageCode,
    priority
  );
  const retryTranslated = normalizeTranslatedText(
    restoreProtectedTerms(retryTexts[0] || '', userOnlyProtected.placeholders),
    languageCode
  );

  if (
    retryTranslated &&
    !hasChineseTargetEnglishResidue(retryTranslated, languageCode)
  ) {
    return retryTranslated;
  }

  return translatedText;
}

function writeTranslationCacheEntry(cache, cacheKey, sourceText, sourceLanguage, targetLanguage, translatedText, provider) {
  if (!cache?.set) {
    return;
  }

  const existing = cache.get?.(cacheKey);
  const now = Date.now();
  const hitCount = typeof existing?.hitCount === 'number' ? existing.hitCount + 1 : 1;
  cache.set(cacheKey, {
    provider,
    sourceLanguage,
    targetLanguage,
    sourceHash: cacheKey.split(':').pop(),
    sourcePreview: normalizeSourceText(sourceText).slice(0, 80),
    translatedText,
    protectedTermsVersion: PROTECTED_TERMS_VERSION,
    createdAt: existing?.createdAt || now,
    lastUsedAt: now,
    hitCount,
    version: 2
  });
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

function normalizeSourceText(sourceText) {
  return String(sourceText || '').replace(/\s+/g, ' ').trim();
}
