export function shouldPersistTranslationResult(translation) {
  if (!translation?.translatedText) {
    return false;
  }
  if (translation.source === 'original' || translation.source === 'protected') {
    return false;
  }
  return true;
}
