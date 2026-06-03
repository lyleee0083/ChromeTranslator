export const DEEPL_API_KEY_STORAGE_KEY = 'deeplApiKey';
export const DEEPL_API_KEY_STATUS_STORAGE_KEY = 'deeplApiKeyStatus';

export const DEEPL_KEY_STATUS = {
  MISSING: 'missing',
  ACTIVE: 'active'
};

export const DEEPL_TRANSLATE_ENDPOINT_FREE = 'https://api-free.deepl.com/v2/translate';
export const DEEPL_TRANSLATE_ENDPOINT_PRO = 'https://api.deepl.com/v2/translate';

export function getDeepLTranslateEndpoint(apiKey) {
  const normalized = String(apiKey || '').trim();
  return normalized.endsWith(':fx')
    ? DEEPL_TRANSLATE_ENDPOINT_FREE
    : DEEPL_TRANSLATE_ENDPOINT_PRO;
}

export function buildDeepLKeyStoragePayload(apiKey) {
  const normalizedKey = String(apiKey || '').trim();
  return {
    [DEEPL_API_KEY_STORAGE_KEY]: normalizedKey,
    [DEEPL_API_KEY_STATUS_STORAGE_KEY]: normalizedKey
      ? DEEPL_KEY_STATUS.ACTIVE
      : DEEPL_KEY_STATUS.MISSING
  };
}

export function getDefaultDeepLSettings() {
  return {
    [DEEPL_API_KEY_STORAGE_KEY]: '',
    [DEEPL_API_KEY_STATUS_STORAGE_KEY]: DEEPL_KEY_STATUS.MISSING
  };
}

export function getDeepLPolishStatus(settings) {
  const apiKey = String(settings?.[DEEPL_API_KEY_STORAGE_KEY] || '').trim();
  if (!apiKey) {
    return { ok: false, reason: 'missing_key' };
  }

  return { ok: true, apiKey };
}

export function formatDeepLKeyStatusText(settings) {
  const polishStatus = getDeepLPolishStatus(settings);
  if (!polishStatus.ok) {
    return 'DeepL：未配置密钥，仅使用 Google 翻译与已有缓存';
  }

  return 'DeepL：已配置，用于本地持久化缓存核对润色';
}
