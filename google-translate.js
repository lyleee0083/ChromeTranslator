export const GOOGLE_TRANSLATE_ENDPOINT = 'https://clients5.google.com/translate_a/t';

export const GOOGLE_TARGET_LANGUAGE_MAP = {
  'zh-CN': 'zh-CN',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  es: 'es',
  fr: 'fr',
  de: 'de'
};

export function getGoogleTargetLanguageCode(targetLanguage) {
  return GOOGLE_TARGET_LANGUAGE_MAP[targetLanguage] || '';
}

export function isGoogleTargetLanguageSupported(targetLanguage) {
  return Boolean(getGoogleTargetLanguageCode(targetLanguage));
}

export function buildGoogleTranslateUrl(sourceTexts, targetLanguage, sourceLanguage = 'auto') {
  const targetLang = getGoogleTargetLanguageCode(targetLanguage);
  if (!targetLang) {
    throw new Error(`Google target language is not supported: ${targetLanguage}`);
  }

  const params = new URLSearchParams({
    client: 'dict-chrome-ex',
    sl: sourceLanguage || 'auto',
    tl: targetLang
  });
  for (const text of sourceTexts) {
    params.append('q', text);
  }

  return `${GOOGLE_TRANSLATE_ENDPOINT}?${params.toString()}`;
}

export function parseGoogleTranslateResponse(data, expectedLength) {
  const results = [];

  if (typeof data === 'string') {
    results.push(data.trim());
  } else if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string') {
        results.push(item.trim());
        continue;
      }

      if (Array.isArray(item)) {
        if (typeof item[0] === 'string') {
          results.push(item[0].trim());
          continue;
        }

        if (Array.isArray(item[0]) && typeof item[0][0] === 'string') {
          results.push(item[0][0].trim());
        }
      }
    }
  }

  if (results.length !== expectedLength) {
    throw new Error('Google translate response length did not match the request.');
  }

  return results;
}
