const CHINESE_TARGET_ENGLISH_RESIDUE =
  /\b(?:Meet|Try|Use|series|with|and|the|in|or|of|for|is a|is an|a|an|to|at|by|on|as)\b/i;

export function isStaleProtectedTermsCacheEntry(value, currentVersion) {
  if (typeof value === 'string') {
    return true;
  }

  if (!value || typeof value !== 'object') {
    return true;
  }

  const entryVersion = typeof value.protectedTermsVersion === 'number'
    ? value.protectedTermsVersion
    : 0;

  return entryVersion !== currentVersion;
}

export function hasChineseTargetEnglishResidue(text, targetLanguage) {
  if (targetLanguage !== 'zh-CN') {
    return false;
  }

  const normalized = String(text || '').trim();
  if (!normalized || !/[\u4e00-\u9fff]/.test(normalized) || !/[A-Za-z]/.test(normalized)) {
    return false;
  }

  return CHINESE_TARGET_ENGLISH_RESIDUE.test(normalized);
}

export function isClearlyEnglishSourceText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return false;
  }

  const latinLetters = normalized.match(/[A-Za-z]/g) || [];
  const cjkLetters = normalized.match(/[\u4e00-\u9fff]/g) || [];
  if (latinLetters.length < 2 || cjkLetters.length > 0) {
    return false;
  }

  return true;
}
