const DEEPL_API_KEY_STORAGE_KEY = 'deeplApiKey';
const DEEPL_API_KEY_SAVED_AT_STORAGE_KEY = 'deeplApiKeySavedAt';
const DEEPL_API_KEY_EXPIRES_AT_STORAGE_KEY = 'deeplApiKeyExpiresAt';
export const DEEPL_API_KEY_STATUS_STORAGE_KEY = 'deeplApiKeyStatus';
export const DEEPL_POLISH_ENABLED_STORAGE_KEY = 'deeplPolishEnabled';
export const DEEPL_QUOTA_MODE_STORAGE_KEY = 'deeplQuotaMode';
export const DEEPL_QUOTA_LIMIT_K_STORAGE_KEY = 'deeplQuotaLimitK';
const DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY = 'deeplQuotaLimitChars';
const DEEPL_QUOTA_USED_CHARS_STORAGE_KEY = 'deeplQuotaUsedChars';
export const DEEPL_DURATION_MODE_STORAGE_KEY = 'deeplDurationMode';
export const DEEPL_DURATION_LIMIT_DAYS_STORAGE_KEY = 'deeplDurationLimitDays';

export const DEEPL_LIMIT_MODE = {
  CUSTOM: 'custom',
  INFINITE: 'infinite'
};

export const DEEPL_KEY_STATUS = {
  MISSING: 'missing',
  ACTIVE: 'active',
  EXPIRING: 'expiring',
  EXPIRED: 'expired',
  QUOTA_EXHAUSTED: 'quota_exhausted',
  DISABLED: 'disabled'
};

export const DEFAULT_DEEPL_QUOTA_LIMIT_K = 500;
export const DEFAULT_DEEPL_DURATION_LIMIT_DAYS = 30;
const DEEPL_KEY_EXPIRING_SOON_DAYS = 3;
const DEEPL_TRANSLATE_ENDPOINT_FREE = 'https://api-free.deepl.com/v2/translate';
const DEEPL_TRANSLATE_ENDPOINT_PRO = 'https://api.deepl.com/v2/translate';

export function getDeepLTranslateEndpoint(apiKey) {
  const normalized = String(apiKey || '').trim();
  return normalized.endsWith(':fx')
    ? DEEPL_TRANSLATE_ENDPOINT_FREE
    : DEEPL_TRANSLATE_ENDPOINT_PRO;
}

export function getDefaultDeepLSettings() {
  return {
    [DEEPL_API_KEY_STORAGE_KEY]: '',
    [DEEPL_API_KEY_SAVED_AT_STORAGE_KEY]: 0,
    [DEEPL_POLISH_ENABLED_STORAGE_KEY]: false,
    [DEEPL_QUOTA_MODE_STORAGE_KEY]: DEEPL_LIMIT_MODE.CUSTOM,
    [DEEPL_QUOTA_LIMIT_K_STORAGE_KEY]: DEFAULT_DEEPL_QUOTA_LIMIT_K,
    [DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY]: DEFAULT_DEEPL_QUOTA_LIMIT_K * 1000,
    [DEEPL_QUOTA_USED_CHARS_STORAGE_KEY]: 0,
    [DEEPL_DURATION_MODE_STORAGE_KEY]: DEEPL_LIMIT_MODE.CUSTOM,
    [DEEPL_DURATION_LIMIT_DAYS_STORAGE_KEY]: DEFAULT_DEEPL_DURATION_LIMIT_DAYS,
    [DEEPL_API_KEY_EXPIRES_AT_STORAGE_KEY]: 0,
    [DEEPL_API_KEY_STATUS_STORAGE_KEY]: DEEPL_KEY_STATUS.MISSING
  };
}

export function buildDeepLKeyStoragePayload(apiKey, options = {}, now = Date.now()) {
  const normalizedKey = String(apiKey || '').trim();
  if (!normalizedKey) {
    return {
      [DEEPL_API_KEY_STORAGE_KEY]: '',
      [DEEPL_POLISH_ENABLED_STORAGE_KEY]: false,
      [DEEPL_API_KEY_STATUS_STORAGE_KEY]: DEEPL_KEY_STATUS.MISSING
    };
  }

  const quotaMode = normalizeDeepLLimitMode(options.quotaMode);
  const durationMode = normalizeDeepLLimitMode(options.durationMode);
  const quotaLimitK = quotaMode === DEEPL_LIMIT_MODE.CUSTOM
    ? normalizePositiveInteger(options.quotaLimitK, DEFAULT_DEEPL_QUOTA_LIMIT_K)
    : null;
  const durationLimitDays = durationMode === DEEPL_LIMIT_MODE.CUSTOM
    ? normalizePositiveInteger(options.durationLimitDays, DEFAULT_DEEPL_DURATION_LIMIT_DAYS)
    : null;

  return {
    [DEEPL_API_KEY_STORAGE_KEY]: normalizedKey,
    [DEEPL_API_KEY_SAVED_AT_STORAGE_KEY]: now,
    [DEEPL_POLISH_ENABLED_STORAGE_KEY]: true,
    [DEEPL_QUOTA_MODE_STORAGE_KEY]: quotaMode,
    [DEEPL_QUOTA_LIMIT_K_STORAGE_KEY]: quotaLimitK,
    [DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY]: quotaLimitK === null ? null : quotaLimitK * 1000,
    [DEEPL_QUOTA_USED_CHARS_STORAGE_KEY]: 0,
    [DEEPL_DURATION_MODE_STORAGE_KEY]: durationMode,
    [DEEPL_DURATION_LIMIT_DAYS_STORAGE_KEY]: durationLimitDays,
    [DEEPL_API_KEY_EXPIRES_AT_STORAGE_KEY]: durationLimitDays === null
      ? null
      : now + durationLimitDays * 24 * 60 * 60 * 1000,
    [DEEPL_API_KEY_STATUS_STORAGE_KEY]: DEEPL_KEY_STATUS.ACTIVE
  };
}

export function getDeepLPolishStatus(settings, now = Date.now()) {
  const apiKey = String(settings?.[DEEPL_API_KEY_STORAGE_KEY] || '').trim();
  if (!apiKey || settings?.[DEEPL_POLISH_ENABLED_STORAGE_KEY] !== true) {
    return { ok: false, reason: 'disabled' };
  }

  if (
    settings[DEEPL_QUOTA_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.CUSTOM &&
    Number(settings[DEEPL_QUOTA_USED_CHARS_STORAGE_KEY] || 0) >=
      Number(settings[DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY] || 0)
  ) {
    return { ok: false, reason: 'quota_exhausted' };
  }

  if (
    settings[DEEPL_DURATION_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.CUSTOM &&
    now > Number(settings[DEEPL_API_KEY_EXPIRES_AT_STORAGE_KEY] || 0)
  ) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, apiKey, status: getDeepLKeyStatus(settings, now) };
}

export function getDeepLKeyStatus(settings, now = Date.now()) {
  const apiKey = String(settings?.[DEEPL_API_KEY_STORAGE_KEY] || '').trim();
  if (!apiKey) {
    return DEEPL_KEY_STATUS.MISSING;
  }

  if (settings[DEEPL_POLISH_ENABLED_STORAGE_KEY] !== true) {
    return DEEPL_KEY_STATUS.DISABLED;
  }

  if (
    settings[DEEPL_QUOTA_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.CUSTOM &&
    Number(settings[DEEPL_QUOTA_USED_CHARS_STORAGE_KEY] || 0) >=
      Number(settings[DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY] || 0)
  ) {
    return DEEPL_KEY_STATUS.QUOTA_EXHAUSTED;
  }

  if (
    settings[DEEPL_DURATION_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.CUSTOM &&
    now > Number(settings[DEEPL_API_KEY_EXPIRES_AT_STORAGE_KEY] || 0)
  ) {
    return DEEPL_KEY_STATUS.EXPIRED;
  }

  if (
    settings[DEEPL_DURATION_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.CUSTOM &&
    getDeepLKeyRemainingDays(settings, now) <= DEEPL_KEY_EXPIRING_SOON_DAYS
  ) {
    return DEEPL_KEY_STATUS.EXPIRING;
  }

  return DEEPL_KEY_STATUS.ACTIVE;
}

function getDeepLKeyRemainingDays(settings, now = Date.now()) {
  if (settings?.[DEEPL_DURATION_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.INFINITE) {
    return Infinity;
  }

  const expiresAt = Number(settings?.[DEEPL_API_KEY_EXPIRES_AT_STORAGE_KEY] || 0);
  const remainingMs = expiresAt - now;
  return remainingMs > 0 ? Math.ceil(remainingMs / (24 * 60 * 60 * 1000)) : 0;
}

function getDeepLQuotaRemainingK(settings) {
  if (settings?.[DEEPL_QUOTA_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.INFINITE) {
    return Infinity;
  }

  const limitChars = Number(settings?.[DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY] || 0);
  const usedChars = Number(settings?.[DEEPL_QUOTA_USED_CHARS_STORAGE_KEY] || 0);
  return Math.max(0, Math.ceil((limitChars - usedChars) / 1000));
}

export async function disableDeepLPolishAuto(reason, storageArea = chrome.storage?.local) {
  if (!storageArea) {
    return;
  }

  const status = reason === 'quota_exhausted'
    ? DEEPL_KEY_STATUS.QUOTA_EXHAUSTED
    : reason === 'expired'
      ? DEEPL_KEY_STATUS.EXPIRED
      : DEEPL_KEY_STATUS.DISABLED;

  await storageArea.set({
    [DEEPL_POLISH_ENABLED_STORAGE_KEY]: false,
    [DEEPL_API_KEY_STATUS_STORAGE_KEY]: status
  });
}

export async function recordDeepLPolishUsage(sourceChars, storageArea = chrome.storage?.local) {
  const usedChars = Number(sourceChars || 0);
  if (!storageArea || usedChars <= 0) {
    return;
  }

  const settings = await storageArea.get(getDefaultDeepLSettings());
  const nextUsedChars = Number(settings[DEEPL_QUOTA_USED_CHARS_STORAGE_KEY] || 0) + usedChars;
  const payload = {
    [DEEPL_QUOTA_USED_CHARS_STORAGE_KEY]: nextUsedChars
  };

  if (
    settings[DEEPL_POLISH_ENABLED_STORAGE_KEY] === true &&
    settings[DEEPL_QUOTA_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.CUSTOM &&
    nextUsedChars >= Number(settings[DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY] || 0)
  ) {
    payload[DEEPL_POLISH_ENABLED_STORAGE_KEY] = false;
    payload[DEEPL_API_KEY_STATUS_STORAGE_KEY] = DEEPL_KEY_STATUS.QUOTA_EXHAUSTED;
  } else {
    payload[DEEPL_API_KEY_STATUS_STORAGE_KEY] = getDeepLKeyStatus({
      ...settings,
      [DEEPL_QUOTA_USED_CHARS_STORAGE_KEY]: nextUsedChars
    });
  }

  await storageArea.set(payload);
}

export function formatDeepLKeyStatusText(settings, now = Date.now()) {
  const apiKey = String(settings?.[DEEPL_API_KEY_STORAGE_KEY] || '').trim();
  if (!apiKey) {
    return 'DeepL 润色：未启用（保存密钥后激活，不影响 Google 翻译）';
  }

  if (settings[DEEPL_POLISH_ENABLED_STORAGE_KEY] !== true) {
    return 'DeepL 润色：已关闭（Google 翻译与缓存不受影响）';
  }

  const polishStatus = getDeepLPolishStatus(settings, now);
  if (!polishStatus.ok) {
    if (polishStatus.reason === 'quota_exhausted') {
      return 'DeepL 润色：额度已用尽，已自动关闭';
    }
    if (polishStatus.reason === 'expired') {
      return 'DeepL 润色：密钥已到期，已自动关闭';
    }
    return 'DeepL 润色：已关闭';
  }

  const quotaMode = settings[DEEPL_QUOTA_MODE_STORAGE_KEY];
  const durationMode = settings[DEEPL_DURATION_MODE_STORAGE_KEY];
  const quotaInfinite = quotaMode === DEEPL_LIMIT_MODE.INFINITE;
  const durationInfinite = durationMode === DEEPL_LIMIT_MODE.INFINITE;

  if (quotaInfinite && durationInfinite) {
    return 'DeepL 润色：已启用（无限制）';
  }

  if (!quotaInfinite && durationInfinite) {
    return `DeepL 润色：已启用，剩余额度 ${getDeepLQuotaRemainingK(settings)} k`;
  }

  if (quotaInfinite && !durationInfinite) {
    return `DeepL 润色：已启用，剩余 ${getDeepLKeyRemainingDays(settings, now)} 天`;
  }

  return `DeepL 润色：已启用，剩余额度 ${getDeepLQuotaRemainingK(settings)} k，剩余 ${getDeepLKeyRemainingDays(settings, now)} 天`;
}

function normalizeDeepLLimitMode(value) {
  return value === DEEPL_LIMIT_MODE.INFINITE ? DEEPL_LIMIT_MODE.INFINITE : DEEPL_LIMIT_MODE.CUSTOM;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
