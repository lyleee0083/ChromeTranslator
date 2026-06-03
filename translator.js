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
import { getDeepLTranslateEndpoint, normalizeDeepLConcurrencyLimit } from './deepl-settings.js';

export const TRANSLATION_PROVIDER = 'deepl';
const DEEPL_TRANSLATE_CONCURRENCY = {
  initial: 2,
  min: 1,
  max: 3,
  increaseAfterSuccessCount: 5
};
export const BATCH_TRANSLATION_CONFIG = {
  maxItems: 20,
  maxChars: 4000,
  minTextLength: 2,
  maxSingleTextLength: 1000
};
export const DEEPL_TARGET_LANGUAGE_MAP = {
  'zh-CN': 'ZH',
  en: 'EN-US',
  ja: 'JA',
  ko: 'KO',
  es: 'ES',
  fr: 'FR',
  de: 'DE',
  it: 'IT',
  pt: 'PT-PT',
  ru: 'RU'
};
const CACHE_LOOKUP_CONCURRENCY = {
  min: 4,
  normal: 10,
  max: 20
};

let activeDeepLRequests = 0;
const queuedDeepLRequests = [];
const inFlightTranslations = new Map();
const inFlightBatchRequests = new Map();
let configuredDeepLConcurrencyPolicy = normalizeDeepLConcurrencyLimit();
let adaptiveDeepLConcurrency = DEEPL_TRANSLATE_CONCURRENCY.initial;
let consecutiveDeepLSuccessCount = 0;

function syncDeepLConcurrencyPolicy(options = {}) {
  configuredDeepLConcurrencyPolicy = normalizeDeepLConcurrencyLimit(options.deeplConcurrencyLimit);
  if (options.isQuotaAlmostUsed) {
    adaptiveDeepLConcurrency = DEEPL_TRANSLATE_CONCURRENCY.min;
    return;
  }
  if (configuredDeepLConcurrencyPolicy.mode === 'fixed') {
    adaptiveDeepLConcurrency = configuredDeepLConcurrencyPolicy.max;
    return;
  }
  adaptiveDeepLConcurrency = Math.min(
    Math.max(adaptiveDeepLConcurrency, DEEPL_TRANSLATE_CONCURRENCY.initial),
    configuredDeepLConcurrencyPolicy.max
  );
}

function getActiveDeepLConcurrencyLimit() {
  return Math.min(adaptiveDeepLConcurrency, configuredDeepLConcurrencyPolicy.max);
}

export function getDefaultSourceLanguage(targetLanguage) {
  return 'auto';
}

export function getDeepLTargetLanguageCode(targetLanguage) {
  return DEEPL_TARGET_LANGUAGE_MAP[targetLanguage] || '';
}

export function isDeepLTargetLanguageSupported(targetLanguage) {
  return Boolean(getDeepLTargetLanguageCode(targetLanguage));
}

export function buildDeepLTranslateRequest(sourceTexts, targetLanguage, apiKey, options = {}) {
  const text = Array.isArray(sourceTexts) ? sourceTexts : [sourceTexts];
  const targetLang = getDeepLTargetLanguageCode(targetLanguage);
  if (!targetLang) {
    throw new Error(`DeepL target language is not supported: ${targetLanguage}`);
  }

  const body = {
    text,
    target_lang: targetLang
  };
  if (options.sourceLang) {
    body.source_lang = options.sourceLang;
  }

  return {
    url: getDeepLTranslateEndpoint(apiKey),
    init: {
      method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  };
}

export function buildTranslationCacheKey(sourceText, sourceLanguage, targetLanguage) {
  return [
    'translation',
    TRANSLATION_PROVIDER,
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
  syncDeepLConcurrencyPolicy(options);
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
      writeTranslationCacheEntry(cache, cacheKey, normalizedSource, sourceLanguage, language.code, cachedText);
      return buildTranslationResult(normalizedSource, cachedText, language, 'cache');
    }
  }

  if (localCache?.has?.(cacheKey)) {
    const cachedText = normalizeTranslatedText(readCachedTranslatedText(localCache.get(cacheKey)), language.code);
    if (cachedText && !hasResidualKoreanText(cachedText)) {
      writeTranslationCacheEntry(localCache, cacheKey, normalizedSource, sourceLanguage, language.code, cachedText);
      writeTranslationCacheEntry(cache, cacheKey, normalizedSource, sourceLanguage, language.code, cachedText);
      return buildTranslationResult(normalizedSource, cachedText, language, 'cache');
    }
  }

  try {
    if (!networkEnabled || !apiKey) {
      return buildTranslationResult(
        normalizedSource,
        normalizedSource,
        language,
        'original',
        'cache_miss_network_disabled'
      );
    }

    if (!apiKey) {
      throw new Error('DeepL API key is missing.');
    }

    const protectedResult = protectTermsInText(normalizedSource, userProtectedTerms, protectOptions);
    if (protectedResult.isFullyProtected) {
      return buildTranslationResult(normalizedSource, normalizedSource, language, 'protected');
    }

    let translatedText = await translateWithInFlightDedup(
      cacheKey,
      fetchImpl,
      apiKey,
      protectedResult.text,
      protectedResult.placeholders,
      options.priority,
      language.code
    );
    if (!translatedText) {
      throw new Error('DeepL translate endpoint response did not include translated text.');
    }

    translatedText = normalizeTranslatedText(translatedText, language.code);
    translatedText = await maybeRetryChineseResidueTranslation({
      normalizedSource,
      translatedText,
      languageCode: language.code,
      fetchImpl,
      apiKey,
      priority: options.priority,
      enableRetry: options.enableChineseResidueRetry === true,
      userProtectedTerms: options.userProtectedTermsForRetry || []
    });

    writeTranslationCacheEntry(cache, cacheKey, normalizedSource, sourceLanguage, language.code, translatedText);
    writeTranslationCacheEntry(localCache, cacheKey, normalizedSource, sourceLanguage, language.code, translatedText);
    return buildTranslationResult(normalizedSource, translatedText, language, 'network');
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
  syncDeepLConcurrencyPolicy(options);
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
      writeTranslationCacheEntry(cache, cacheKey, sourceText, sourceLanguage, language.code, activeText);
      results[index] = buildTranslationResult(sourceText, activeText, language, 'cache');
      return;
    }

    const localText = localCache?.has?.(cacheKey)
      ? normalizeTranslatedText(readCachedTranslatedText(localCache.get(cacheKey)), language.code)
      : '';
    if (localText && !hasResidualKoreanText(localText)) {
      writeTranslationCacheEntry(cache, cacheKey, sourceText, sourceLanguage, language.code, localText);
      writeTranslationCacheEntry(localCache, cacheKey, sourceText, sourceLanguage, language.code, localText);
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

  if (!networkEnabled || !apiKey) {
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
    networkEnabled,
    priority: options.priority,
    enableChineseResidueRetry: options.enableChineseResidueRetry === true,
    userProtectedTermsForRetry: options.userProtectedTermsForRetry || [],
    userProtectedTerms,
    language
  };
  const parallelism = options.isQuotaAlmostUsed
    ? DEEPL_TRANSLATE_CONCURRENCY.min
    : getActiveDeepLConcurrencyLimit();

  await runWithConcurrencyLimit(groupedItems, parallelism, (group) =>
    processMissingTranslationGroup(group, results, batchOptions)
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
    networkEnabled,
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
    { fetchImpl, sourceLanguage, cache, localCache, apiKey, networkEnabled, priority }
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
      apiKey,
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

    writeTranslationCacheEntry(cache, item.cacheKey, item.sourceText, sourceLanguage, language.code, translatedText);
    writeTranslationCacheEntry(localCache, item.cacheKey, item.sourceText, sourceLanguage, language.code, translatedText);
    results[item.index] = buildTranslationResult(item.sourceText, translatedText, language, 'network');
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

function translateWithInFlightDedup(cacheKey, fetchImpl, apiKey, sourceText, placeholders, priority, targetLanguage) {
  if (inFlightTranslations.has(cacheKey)) {
    return inFlightTranslations.get(cacheKey);
  }

  const promise = fetchTranslatedTextBatch(fetchImpl, [sourceText], targetLanguage, apiKey, priority)
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
    if (options.networkEnabled === false || !options.apiKey) {
      return sourceTexts;
    }

    if (!options.apiKey) {
      throw new Error('DeepL API key is missing.');
    }

    return await fetchTranslatedTextBatch(
      options.fetchImpl,
      sourceTexts,
      targetLanguage,
      options.apiKey,
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

    const result = await translateText(sourceTexts[0], targetLanguage, options);
    if (result.source === 'original' || result.source === 'protected') {
      return [''];
    }

    return [result.translatedText];
  }
}

function buildBatchRequestKey(targetLanguage, sourceTexts, requestOptions = {}) {
  return [
    targetLanguage,
    requestOptions.sourceLang || '',
    sourceTexts.join('\u0002')
  ].join('\u0001');
}

async function fetchTranslatedTextBatch(
  fetchImpl,
  sourceTexts,
  targetLanguage,
  apiKey,
  priority = 5,
  requestOptions = {}
) {
  const batchKey = buildBatchRequestKey(targetLanguage, sourceTexts, requestOptions);
  if (inFlightBatchRequests.has(batchKey)) {
    return inFlightBatchRequests.get(batchKey);
  }

  const promise = (async () => {
    const request = buildDeepLTranslateRequest(sourceTexts, targetLanguage, apiKey, requestOptions);
    const response = await enqueueDeepLRequest(() => fetchImpl(request.url, request.init), priority);
    if (!response.ok) {
      markDeepLRequestFailure();
      throw new Error(`DeepL translate endpoint responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    markDeepLRequestSuccess();
    return parseDeepLTranslateResponse(data, sourceTexts.length)
      .map((text) => normalizeTranslatedText(text, targetLanguage));
  })().finally(() => {
    inFlightBatchRequests.delete(batchKey);
  });

  inFlightBatchRequests.set(batchKey, promise);
  return promise;
}

function enqueueDeepLRequest(task, priority = 5) {
  return new Promise((resolve, reject) => {
    queuedDeepLRequests.push({ task, resolve, reject, priority: Number.isFinite(priority) ? priority : 5 });
    processDeepLRequestQueue();
  });
}

function processDeepLRequestQueue() {
  while (activeDeepLRequests < getActiveDeepLConcurrencyLimit() && queuedDeepLRequests.length > 0) {
    const nextIndex = getNextDeepLQueuedRequestIndex();
    const [queuedRequest] = queuedDeepLRequests.splice(nextIndex, 1);
    activeDeepLRequests += 1;

    Promise.resolve()
      .then(queuedRequest.task)
      .then(queuedRequest.resolve, queuedRequest.reject)
      .finally(() => {
        activeDeepLRequests -= 1;
        processDeepLRequestQueue();
      });
  }
}

function getNextDeepLQueuedRequestIndex() {
  let selectedIndex = 0;
  for (let index = 1; index < queuedDeepLRequests.length; index += 1) {
    if (queuedDeepLRequests[index].priority < queuedDeepLRequests[selectedIndex].priority) {
      selectedIndex = index;
    }
  }
  return selectedIndex;
}

function markDeepLRequestSuccess() {
  if (configuredDeepLConcurrencyPolicy.mode !== 'adaptive') {
    return;
  }

  consecutiveDeepLSuccessCount += 1;
  if (
    consecutiveDeepLSuccessCount >= DEEPL_TRANSLATE_CONCURRENCY.increaseAfterSuccessCount &&
    adaptiveDeepLConcurrency < configuredDeepLConcurrencyPolicy.max
  ) {
    adaptiveDeepLConcurrency += 1;
    consecutiveDeepLSuccessCount = 0;
  }
}

function markDeepLRequestFailure() {
  consecutiveDeepLSuccessCount = 0;
  if (configuredDeepLConcurrencyPolicy.mode === 'adaptive') {
    adaptiveDeepLConcurrency = DEEPL_TRANSLATE_CONCURRENCY.min;
  }
}

export function parseDeepLTranslateResponse(data, expectedLength) {
  const translations = data?.translations;
  if (!Array.isArray(translations) || translations.length !== expectedLength) {
    throw new Error('DeepL response length did not match the request.');
  }

  return translations.map((translation) => String(translation?.text || '').trim());
}

function buildTranslationResult(sourceText, translatedText, language, source = '', reason = '') {
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

  if (value?.provider && value.provider !== TRANSLATION_PROVIDER) {
    return '';
  }

  return typeof value?.translatedText === 'string' ? value.translatedText : '';
}

async function maybeRetryChineseResidueTranslation({
  normalizedSource,
  translatedText,
  languageCode,
  fetchImpl,
  apiKey,
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
  const requestOptions = isClearlyEnglishSourceText(normalizedSource)
    ? { sourceLang: 'EN' }
    : {};
  const retryTexts = await fetchTranslatedTextBatch(
    fetchImpl,
    [userOnlyProtected.text],
    languageCode,
    apiKey,
    priority,
    requestOptions
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

function writeTranslationCacheEntry(cache, cacheKey, sourceText, sourceLanguage, targetLanguage, translatedText) {
  if (!cache?.set) {
    return;
  }

  const existing = cache.get?.(cacheKey);
  const now = Date.now();
  const hitCount = typeof existing?.hitCount === 'number' ? existing.hitCount + 1 : 1;
  cache.set(cacheKey, {
    provider: TRANSLATION_PROVIDER,
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
