export const DEEPL_API_KEY_STORAGE_KEY = 'deeplApiKey';
export const DEEPL_API_KEY_SAVED_AT_STORAGE_KEY = 'deeplApiKeySavedAt';
export const DEEPL_API_KEY_EXPIRES_AT_STORAGE_KEY = 'deeplApiKeyExpiresAt';
export const DEEPL_API_KEY_STATUS_STORAGE_KEY = 'deeplApiKeyStatus';
export const DEEPL_QUOTA_MODE_STORAGE_KEY = 'deeplQuotaMode';
export const DEEPL_QUOTA_LIMIT_K_STORAGE_KEY = 'deeplQuotaLimitK';
export const DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY = 'deeplQuotaLimitChars';
export const DEEPL_QUOTA_USED_CHARS_STORAGE_KEY = 'deeplQuotaUsedChars';
export const DEEPL_DURATION_MODE_STORAGE_KEY = 'deeplDurationMode';
export const DEEPL_DURATION_LIMIT_DAYS_STORAGE_KEY = 'deeplDurationLimitDays';
export const DEEPL_NETWORK_ENABLED_STORAGE_KEY = 'deeplNetworkEnabled';
export const DEEPL_CONCURRENCY_LIMIT_STORAGE_KEY = 'deeplConcurrencyLimit';

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
  NETWORK_DISABLED: 'network_disabled'
};

export const DEFAULT_DEEPL_QUOTA_LIMIT_K = 500;
export const DEFAULT_DEEPL_DURATION_LIMIT_DAYS = 30;
export const DEEPL_KEY_EXPIRING_SOON_DAYS = 3;
export const DEFAULT_DEEPL_CONCURRENCY_LIMIT = 'adaptive';
export const DEEPL_CONCURRENCY_MAX = 3;
export const DEEPL_TRANSLATE_ENDPOINT_FREE = 'https://api-free.deepl.com/v2/translate';
export const DEEPL_TRANSLATE_ENDPOINT_PRO = 'https://api.deepl.com/v2/translate';

export function getDeepLTranslateEndpoint(apiKey) {
  const normalized = String(apiKey || '').trim();
  return normalized.endsWith(':fx')
    ? DEEPL_TRANSLATE_ENDPOINT_FREE
    : DEEPL_TRANSLATE_ENDPOINT_PRO;
}

export function normalizeDeepLConcurrencyLimit(value) {
  const normalized = String(value ?? '').trim();
  if (normalized === '1' || normalized === '2' || normalized === '3') {
    return { mode: 'fixed', max: Number(normalized) };
  }
  return { mode: 'adaptive', max: DEEPL_CONCURRENCY_MAX };
}

export function buildDeepLKeyStoragePayload(apiKey, options = {}, now = Date.now()) {
  const normalizedKey = String(apiKey || '').trim();
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
    [DEEPL_QUOTA_MODE_STORAGE_KEY]: quotaMode,
    [DEEPL_QUOTA_LIMIT_K_STORAGE_KEY]: quotaLimitK,
    [DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY]: quotaLimitK === null ? null : quotaLimitK * 1000,
    [DEEPL_QUOTA_USED_CHARS_STORAGE_KEY]: 0,
    [DEEPL_DURATION_MODE_STORAGE_KEY]: durationMode,
    [DEEPL_DURATION_LIMIT_DAYS_STORAGE_KEY]: durationLimitDays,
    [DEEPL_API_KEY_EXPIRES_AT_STORAGE_KEY]: durationLimitDays === null
      ? null
      : now + durationLimitDays * 24 * 60 * 60 * 1000,
    [DEEPL_NETWORK_ENABLED_STORAGE_KEY]: true,
    [DEEPL_API_KEY_STATUS_STORAGE_KEY]: DEEPL_KEY_STATUS.ACTIVE
  };
}

export function getDefaultDeepLSettings() {
  return {
    [DEEPL_API_KEY_STORAGE_KEY]: '',
    [DEEPL_API_KEY_SAVED_AT_STORAGE_KEY]: 0,
    [DEEPL_QUOTA_MODE_STORAGE_KEY]: DEEPL_LIMIT_MODE.CUSTOM,
    [DEEPL_QUOTA_LIMIT_K_STORAGE_KEY]: DEFAULT_DEEPL_QUOTA_LIMIT_K,
    [DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY]: DEFAULT_DEEPL_QUOTA_LIMIT_K * 1000,
    [DEEPL_QUOTA_USED_CHARS_STORAGE_KEY]: 0,
    [DEEPL_DURATION_MODE_STORAGE_KEY]: DEEPL_LIMIT_MODE.CUSTOM,
    [DEEPL_DURATION_LIMIT_DAYS_STORAGE_KEY]: DEFAULT_DEEPL_DURATION_LIMIT_DAYS,
    [DEEPL_API_KEY_EXPIRES_AT_STORAGE_KEY]: 0,
    [DEEPL_NETWORK_ENABLED_STORAGE_KEY]: true,
    [DEEPL_API_KEY_STATUS_STORAGE_KEY]: DEEPL_KEY_STATUS.MISSING,
    [DEEPL_CONCURRENCY_LIMIT_STORAGE_KEY]: DEFAULT_DEEPL_CONCURRENCY_LIMIT
  };
}

export function getDeepLNetworkStatus(settings, now = Date.now()) {
  if (!settings?.[DEEPL_API_KEY_STORAGE_KEY]) {
    return { ok: false, reason: 'missing_key' };
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

  if (settings[DEEPL_NETWORK_ENABLED_STORAGE_KEY] === false) {
    return { ok: false, reason: 'network_disabled' };
  }

  return {
    ok: true,
    apiKey: settings[DEEPL_API_KEY_STORAGE_KEY],
    status: getDeepLKeyStatus(settings, now)
  };
}

export function getDeepLKeyStatus(settings, now = Date.now()) {
  const networkStatus = getDeepLNetworkStatusWithoutStatus(settings, now);
  if (!networkStatus.ok) {
    if (networkStatus.reason === 'missing_key') {
      return DEEPL_KEY_STATUS.MISSING;
    }
    if (networkStatus.reason === 'quota_exhausted') {
      return DEEPL_KEY_STATUS.QUOTA_EXHAUSTED;
    }
    if (networkStatus.reason === 'network_disabled') {
      return DEEPL_KEY_STATUS.NETWORK_DISABLED;
    }
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

export function getDeepLKeyRemainingDays(settings, now = Date.now()) {
  if (settings?.[DEEPL_DURATION_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.INFINITE) {
    return Infinity;
  }

  const expiresAt = Number(settings?.[DEEPL_API_KEY_EXPIRES_AT_STORAGE_KEY] || 0);
  const remainingMs = expiresAt - now;
  return remainingMs > 0 ? Math.ceil(remainingMs / (24 * 60 * 60 * 1000)) : 0;
}

export function getDeepLQuotaRemainingK(settings) {
  if (settings?.[DEEPL_QUOTA_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.INFINITE) {
    return Infinity;
  }

  const limitChars = Number(settings?.[DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY] || 0);
  const usedChars = Number(settings?.[DEEPL_QUOTA_USED_CHARS_STORAGE_KEY] || 0);
  return Math.max(0, Math.ceil((limitChars - usedChars) / 1000));
}

export function canUseDeepLKeyStatus(status) {
  return status === DEEPL_KEY_STATUS.ACTIVE || status === DEEPL_KEY_STATUS.EXPIRING;
}

export function formatDeepLKeyStatusText(settings, now = Date.now()) {
  const networkStatus = getDeepLNetworkStatus(settings, now);
  if (!networkStatus.ok) {
    if (networkStatus.reason === 'missing_key') {
      return 'DeepL：未填写密钥，仅使用已有缓存';
    }
    if (networkStatus.reason === 'quota_exhausted') {
      return 'DeepL：额度已用完，仅使用已有缓存';
    }
    if (networkStatus.reason === 'expired') {
      return 'DeepL：密钥已过期，仅使用已有缓存';
    }
    return 'DeepL：网络查询已关闭，仅使用已有缓存';
  }

  const quotaMode = settings[DEEPL_QUOTA_MODE_STORAGE_KEY];
  const durationMode = settings[DEEPL_DURATION_MODE_STORAGE_KEY];
  const quotaInfinite = quotaMode === DEEPL_LIMIT_MODE.INFINITE;
  const durationInfinite = durationMode === DEEPL_LIMIT_MODE.INFINITE;

  if (quotaInfinite && durationInfinite) {
    return 'DeepL：无限制';
  }

  if (!quotaInfinite && durationInfinite) {
    return `DeepL：剩余额度 ${getDeepLQuotaRemainingK(settings)} k`;
  }

  if (quotaInfinite && !durationInfinite) {
    return `DeepL：剩余 ${getDeepLKeyRemainingDays(settings, now)} 天`;
  }

  return `DeepL：剩余额度 ${getDeepLQuotaRemainingK(settings)} k，剩余 ${getDeepLKeyRemainingDays(settings, now)} 天`;
}

function getDeepLNetworkStatusWithoutStatus(settings, now) {
  if (!settings?.[DEEPL_API_KEY_STORAGE_KEY]) {
    return { ok: false, reason: 'missing_key' };
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
  if (settings[DEEPL_NETWORK_ENABLED_STORAGE_KEY] === false) {
    return { ok: false, reason: 'network_disabled' };
  }
  return { ok: true };
}

function normalizeDeepLLimitMode(value) {
  return value === DEEPL_LIMIT_MODE.INFINITE ? DEEPL_LIMIT_MODE.INFINITE : DEEPL_LIMIT_MODE.CUSTOM;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
