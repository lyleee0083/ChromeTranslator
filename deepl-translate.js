import { getDeepLTranslateEndpoint } from './deepl-settings.js';

const DEEPL_TARGET_LANGUAGE_MAP = {
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

function getDeepLTargetLanguageCode(targetLanguage) {
  return DEEPL_TARGET_LANGUAGE_MAP[targetLanguage] || '';
}

export function isDeepLTargetLanguageSupported(targetLanguage) {
  return Boolean(getDeepLTargetLanguageCode(targetLanguage));
}

function buildDeepLTranslateRequest(sourceTexts, targetLanguage, apiKey, options = {}) {
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
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  };
}

function parseDeepLTranslateResponse(data, expectedLength) {
  const translations = data?.translations;
  if (!Array.isArray(translations) || translations.length !== expectedLength) {
    throw new Error('DeepL response length did not match the request.');
  }

  return translations.map((translation) => String(translation?.text || '').trim());
}

export class DeepLTranslateError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'DeepLTranslateError';
    this.status = status;
  }
}

export function isDeepLQuotaOrAuthError(error) {
  const status = Number(error?.status || 0);
  return status === 401 || status === 403 || status === 456 || status === 429;
}

export async function fetchDeepLTranslatedTexts(fetchImpl, sourceTexts, targetLanguage, apiKey, requestOptions = {}) {
  const request = buildDeepLTranslateRequest(sourceTexts, targetLanguage, apiKey, requestOptions);
  const response = await fetchImpl(request.url, request.init);
  if (!response.ok) {
    throw new DeepLTranslateError(
      `DeepL translate endpoint responded with HTTP ${response.status}`,
      response.status
    );
  }

  const data = await response.json();
  return parseDeepLTranslateResponse(data, sourceTexts.length);
}
