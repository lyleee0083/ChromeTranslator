export const DEFAULT_TARGET_LANGUAGE = 'zh-CN';

export const SUPPORTED_LANGUAGES = Object.freeze([
  { code: 'zh-CN', name: 'Chinese', nativeName: '\u4e2d\u6587' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ja', name: 'Japanese', nativeName: '\u65e5\u672c\u8a9e' },
  { code: 'ko', name: 'Korean', nativeName: '\ud55c\uad6d\uc5b4' },
  { code: 'es', name: 'Spanish', nativeName: 'Espa\u00f1ol' },
  { code: 'fr', name: 'French', nativeName: 'Fran\u00e7ais' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' }
]);

export function getLanguageByCode(code) {
  return SUPPORTED_LANGUAGES.find((language) => language.code === code) || SUPPORTED_LANGUAGES[0];
}

export function normalizeLanguageCode(code) {
  return getLanguageByCode(code).code;
}
