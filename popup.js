import {
  DEFAULT_TARGET_LANGUAGE,
  SUPPORTED_LANGUAGES,
  normalizeLanguageCode
} from './language-options.js';
import {
  DEFAULT_YOUTUBE_SUBTITLE_TRANSLATION_ENABLED,
  YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY
} from './youtube-subtitles.js';
import {
  DEFAULT_WEBPAGE_TRANSLATION_ENABLED,
  WEBPAGE_TRANSLATION_STORAGE_KEY
} from './webpage-translation.js';
import {
  DEFAULT_EXCLUDED_TRANSLATION_HOSTS,
  EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY,
  getHostnameFromUrl,
  isTranslationHostExcluded,
  normalizeTranslationHostname,
  setTranslationHostExcluded
} from './domain-settings.js';
import {
  formatDeepLKeyStatusText,
  getDefaultDeepLSettings
} from './deepl-settings.js';

const STORAGE_KEY = 'targetLanguage';
const RESTORE_WEBPAGE_ORIGINAL_MESSAGE = 'RESTORE_WEBPAGE_ORIGINAL';
const SHOW_WEBPAGE_TRANSLATED_MESSAGE = 'SHOW_WEBPAGE_TRANSLATED';
const SHOW_WEBPAGE_BILINGUAL_MESSAGE = 'SHOW_WEBPAGE_BILINGUAL';
const CLEAR_CURRENT_SITE_CACHE_MESSAGE = 'CLEAR_CURRENT_SITE_CACHE';
const RETRANSLATE_CURRENT_PAGE_MESSAGE = 'RETRANSLATE_CURRENT_PAGE';
const select = document.getElementById('targetLanguage');
const youtubeSubtitleToggle = document.getElementById('youtubeSubtitleTranslationEnabled');
const webpageTranslationToggle = document.getElementById('webpageTranslationEnabled');
const currentSiteTranslationExcludedToggle = document.getElementById('currentSiteTranslationExcluded');
const currentSiteLabel = document.getElementById('currentSiteLabel');
const openOptionsButton = document.getElementById('openOptions');
const restoreOriginalButton = document.getElementById('restoreOriginal');
const showTranslatedButton = document.getElementById('showTranslated');
const showBilingualButton = document.getElementById('showBilingual');
const clearCurrentSiteCacheButton = document.getElementById('clearCurrentSiteCache');
const retranslateCurrentPageButton = document.getElementById('retranslateCurrentPage');
const deeplKeyStatus = document.getElementById('deeplKeyStatus');
const saveStatus = document.getElementById('saveStatus');
let saveTimer = null;
let currentSiteHostname = '';
let excludedTranslationHosts = [];

init();

async function init() {
  populateLanguageOptions();

  const stored = await chrome.storage.sync.get({
    [STORAGE_KEY]: DEFAULT_TARGET_LANGUAGE,
    [YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY]: DEFAULT_YOUTUBE_SUBTITLE_TRANSLATION_ENABLED,
    [WEBPAGE_TRANSLATION_STORAGE_KEY]: DEFAULT_WEBPAGE_TRANSLATION_ENABLED,
    [EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]: DEFAULT_EXCLUDED_TRANSLATION_HOSTS
  });
  const deeplSettings = await chrome.storage.local.get(getDefaultDeepLSettings());
  deeplKeyStatus.textContent = formatDeepLKeyStatusText(deeplSettings);
  currentSiteHostname = await getCurrentSiteHostname();
  excludedTranslationHosts = Array.isArray(stored[EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY])
    ? stored[EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]
    : [];
  select.value = normalizeLanguageCode(stored[STORAGE_KEY]);
  youtubeSubtitleToggle.checked = Boolean(stored[YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY]);
  webpageTranslationToggle.checked = Boolean(stored[WEBPAGE_TRANSLATION_STORAGE_KEY]);
  renderCurrentSiteExclusion();

  select.addEventListener('change', savePreference);
  youtubeSubtitleToggle.addEventListener('change', saveYoutubeSubtitlePreference);
  webpageTranslationToggle.addEventListener('change', saveWebpageTranslationPreference);
  currentSiteTranslationExcludedToggle.addEventListener('change', saveCurrentSiteTranslationExclusion);
  openOptionsButton.addEventListener('click', openOptionsPage);
  restoreOriginalButton.addEventListener('click', () => sendCurrentTabMessage(RESTORE_WEBPAGE_ORIGINAL_MESSAGE));
  showTranslatedButton.addEventListener('click', () => sendCurrentTabMessage(SHOW_WEBPAGE_TRANSLATED_MESSAGE));
  showBilingualButton.addEventListener('click', () => sendCurrentTabMessage(SHOW_WEBPAGE_BILINGUAL_MESSAGE));
  clearCurrentSiteCacheButton.addEventListener('click', clearCurrentSiteCache);
  retranslateCurrentPageButton.addEventListener('click', () => sendCurrentTabMessage(RETRANSLATE_CURRENT_PAGE_MESSAGE));
}

function populateLanguageOptions() {
  for (const language of SUPPORTED_LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = `${language.name} (${language.nativeName})`;
    select.appendChild(option);
  }
}

async function savePreference() {
  const targetLanguage = normalizeLanguageCode(select.value);
  select.value = targetLanguage;

  await chrome.storage.sync.set({ [STORAGE_KEY]: targetLanguage });
  showSavedState();
}

async function saveYoutubeSubtitlePreference() {
  await chrome.storage.sync.set({
    [YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY]: youtubeSubtitleToggle.checked
  });
  showSavedState();
}

async function saveWebpageTranslationPreference() {
  await chrome.storage.sync.set({
    [WEBPAGE_TRANSLATION_STORAGE_KEY]: webpageTranslationToggle.checked
  });
  showSavedState();
}

async function saveCurrentSiteTranslationExclusion() {
  excludedTranslationHosts = setTranslationHostExcluded(
    excludedTranslationHosts,
    currentSiteHostname,
    currentSiteTranslationExcludedToggle.checked
  );

  await chrome.storage.sync.set({
    [EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]: excludedTranslationHosts
  });
  renderCurrentSiteExclusion();
  showSavedState();
}

async function getCurrentSiteHostname() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return normalizeTranslationHostname(getHostnameFromUrl(tab?.url || ''));
}

function renderCurrentSiteExclusion() {
  if (!currentSiteHostname) {
    currentSiteTranslationExcludedToggle.checked = false;
    currentSiteTranslationExcludedToggle.disabled = true;
    currentSiteLabel.textContent = '当前页面不可用';
    return;
  }

  currentSiteTranslationExcludedToggle.disabled = false;
  currentSiteTranslationExcludedToggle.checked = isTranslationHostExcluded(
    currentSiteHostname,
    excludedTranslationHosts
  );
  currentSiteLabel.textContent = currentSiteHostname;
}

function openOptionsPage() {
  chrome.runtime.openOptionsPage();
}

async function sendCurrentTabMessage(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  try {
    if (type === RETRANSLATE_CURRENT_PAGE_MESSAGE) {
      await chrome.tabs.sendMessage(tab.id, { type });
    } else {
      await chrome.tabs.sendMessage(tab.id, { type });
    }
    showSavedState();
  } catch {
    saveStatus.textContent = '当前页面不可用';
  }
}

async function clearCurrentSiteCache() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    saveStatus.textContent = '当前页面不可用';
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: CLEAR_CURRENT_SITE_CACHE_MESSAGE,
      sourceUrl: tab.url
    });
    showSavedState();
  } catch {
    saveStatus.textContent = '操作失败';
  }
}

function showSavedState() {
  saveStatus.textContent = '已保存';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveStatus.textContent = '';
  }, 1400);
}
