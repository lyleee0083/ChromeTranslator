import {
  DEFAULT_EXCLUDED_TRANSLATION_HOSTS,
  EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY,
  isPrivateTranslationHostname,
  normalizeExcludedTranslationHosts,
  normalizeTranslationHostname
} from './domain-settings.js';

import {
  CACHE_LIMIT_MAX_ENTRIES_STORAGE_KEY,
  CACHE_LIMIT_MODE,
  CACHE_LIMIT_MODE_STORAGE_KEY,
  DEFAULT_CACHE_MAX_ENTRIES,
  formatCacheLimitDescription,
  getDefaultCacheLimitSettings
} from './cache-settings.js';

import {
  DEEPL_DURATION_LIMIT_DAYS_STORAGE_KEY,
  DEEPL_DURATION_MODE_STORAGE_KEY,
  DEEPL_LIMIT_MODE,
  DEEPL_QUOTA_LIMIT_K_STORAGE_KEY,
  DEEPL_QUOTA_MODE_STORAGE_KEY,
  DEFAULT_DEEPL_DURATION_LIMIT_DAYS,
  DEFAULT_DEEPL_QUOTA_LIMIT_K,
  buildDeepLKeyStoragePayload,
  formatDeepLKeyStatusText,
  getDefaultDeepLSettings
} from './deepl-settings.js';

import {
  USER_PROTECTED_TERMS_STORAGE_KEY,
  dedupeTerms,
  getDefaultProtectedTerms,
  getProtectedTermDictionaries,
  searchProtectedTerms
} from './protected-terms.js';

const deeplApiKeyInput = document.getElementById('deeplApiKey');
const deeplQuotaModeInput = document.getElementById('deeplQuotaMode');
const deeplQuotaLimitKInput = document.getElementById('deeplQuotaLimitK');
const deeplDurationModeInput = document.getElementById('deeplDurationMode');
const deeplDurationLimitDaysInput = document.getElementById('deeplDurationLimitDays');
const deeplKeyStatus = document.getElementById('deeplKeyStatus');
const saveDeepLApiKeyButton = document.getElementById('saveDeepLApiKey');
const clearDeepLApiKeyButton = document.getElementById('clearDeepLApiKey');
const excludedTranslationHostsSearchInput = document.getElementById('excludedTranslationHostsSearch');
const excludedTranslationHostsSearchResult = document.getElementById('excludedTranslationHostsSearchResult');
const excludedTranslationHostsInput = document.getElementById('excludedTranslationHosts');
const saveExcludedTranslationHostsButton = document.getElementById('saveExcludedTranslationHosts');
const protectedTermSearchInput = document.getElementById('protectedTermSearch');
const protectedTermSearchResult = document.getElementById('protectedTermSearchResult');
const userProtectedTermsInput = document.getElementById('userProtectedTerms');
const saveUserProtectedTermsButton = document.getElementById('saveUserProtectedTerms');
const resetUserProtectedTermsButton = document.getElementById('resetUserProtectedTerms');
const addProtectedTermFromSearchButton = document.getElementById('addProtectedTermFromSearch');
const cacheStats = document.getElementById('cacheStats');
const cacheLimitModeInput = document.getElementById('cacheLimitMode');
const cacheLimitMaxEntriesInput = document.getElementById('cacheLimitMaxEntries');
const cacheLimitStatus = document.getElementById('cacheLimitStatus');
const saveCacheLimitSettingsButton = document.getElementById('saveCacheLimitSettings');
const autoCacheCleanupEnabledInput = document.getElementById('autoCacheCleanupEnabled');
const refreshCacheStatsButton = document.getElementById('refreshCacheStats');
const clearAllCacheButton = document.getElementById('clearAllCache');
const clearLanguageCacheInput = document.getElementById('clearLanguageCacheInput');
const clearLanguageCacheButton = document.getElementById('clearLanguageCache');
const clearSiteCacheInput = document.getElementById('clearSiteCacheInput');
const clearSiteCacheButton = document.getElementById('clearSiteCache');
const saveStatus = document.getElementById('saveStatus');

let saveTimer = null;

let protectedTermsSearchTimer = null;
const GET_CACHE_STATS_MESSAGE = 'GET_CACHE_STATS';
const CLEAR_ALL_CACHE_MESSAGE = 'CLEAR_ALL_CACHE';
const CLEAR_LANGUAGE_CACHE_MESSAGE = 'CLEAR_LANGUAGE_CACHE';
const CLEAR_SITE_CACHE_MESSAGE = 'CLEAR_SITE_CACHE';
const AUTO_CACHE_CLEANUP_STORAGE_KEY = 'autoCacheCleanupEnabled';
init();
async function init() {

  const [stored, deeplSettings] = await Promise.all([
    chrome.storage.sync.get({
      ...getDefaultCacheLimitSettings(),
      [EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]: DEFAULT_EXCLUDED_TRANSLATION_HOSTS,
      [USER_PROTECTED_TERMS_STORAGE_KEY]: [],
      [AUTO_CACHE_CLEANUP_STORAGE_KEY]: false
    }),
    chrome.storage.local.get(getDefaultDeepLSettings())
  ]);
  excludedTranslationHostsInput.value = normalizeExcludedTranslationHosts(
    stored[EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]
  ).join('\n');
  userProtectedTermsInput.value = dedupeTerms(stored[USER_PROTECTED_TERMS_STORAGE_KEY]).join('\n');
  autoCacheCleanupEnabledInput.checked = Boolean(stored[AUTO_CACHE_CLEANUP_STORAGE_KEY]);
  renderCacheLimitInputs(stored);
  renderCacheLimitStatus(stored);
  renderDeepLLimitInputs(deeplSettings);
  renderDeepLKeyStatus(deeplSettings);
  saveDeepLApiKeyButton.addEventListener('click', saveDeepLApiKey);
  clearDeepLApiKeyButton.addEventListener('click', clearDeepLApiKey);
  deeplQuotaModeInput.addEventListener('change', updateDeepLLimitInputState);
  deeplDurationModeInput.addEventListener('change', updateDeepLLimitInputState);
  excludedTranslationHostsSearchInput.addEventListener('input', renderExcludedTranslationHostsSearch);
  excludedTranslationHostsInput.addEventListener('input', renderExcludedTranslationHostsSearch);
  saveExcludedTranslationHostsButton.addEventListener('click', saveExcludedTranslationHosts);
  protectedTermSearchInput.addEventListener('input', renderProtectedTermSearchWithDebounce);
  userProtectedTermsInput.addEventListener('input', renderProtectedTermSearchWithDebounce);
  saveUserProtectedTermsButton.addEventListener('click', saveUserProtectedTerms);
  resetUserProtectedTermsButton.addEventListener('click', resetUserProtectedTerms);
  addProtectedTermFromSearchButton.addEventListener('click', addProtectedTermFromSearch);
  saveCacheLimitSettingsButton.addEventListener('click', saveCacheLimitSettings);
  cacheLimitModeInput.addEventListener('change', updateCacheLimitInputState);
  autoCacheCleanupEnabledInput.addEventListener('change', saveAutoCacheCleanupSetting);
  refreshCacheStatsButton.addEventListener('click', refreshCacheStats);
  clearAllCacheButton.addEventListener('click', clearAllCache);
  clearLanguageCacheButton.addEventListener('click', clearLanguageCache);
  clearSiteCacheButton.addEventListener('click', clearSiteCache);
  renderExcludedTranslationHostsSearch();
  renderProtectedTermSearch();
  updateDeepLLimitInputState();
  updateCacheLimitInputState();
  await refreshCacheStats();

}
function renderCacheLimitInputs(settings) {

  cacheLimitModeInput.value = settings[CACHE_LIMIT_MODE_STORAGE_KEY] || CACHE_LIMIT_MODE.CUSTOM;
  cacheLimitMaxEntriesInput.value = String(
    settings[CACHE_LIMIT_MAX_ENTRIES_STORAGE_KEY] || DEFAULT_CACHE_MAX_ENTRIES
  );

}
function renderCacheLimitStatus(settings) {

  cacheLimitStatus.textContent = formatCacheLimitDescription(settings);

}
function updateCacheLimitInputState() {

  cacheLimitMaxEntriesInput.disabled = cacheLimitModeInput.value !== CACHE_LIMIT_MODE.CUSTOM;

}
async function saveCacheLimitSettings() {

  const mode = cacheLimitModeInput.value === CACHE_LIMIT_MODE.INFINITE
    ? CACHE_LIMIT_MODE.INFINITE
    : CACHE_LIMIT_MODE.CUSTOM;
  const maxEntries = mode === CACHE_LIMIT_MODE.CUSTOM
    ? Number.parseInt(cacheLimitMaxEntriesInput.value, 10) || DEFAULT_CACHE_MAX_ENTRIES
    : DEFAULT_CACHE_MAX_ENTRIES;
  const payload = {
    [CACHE_LIMIT_MODE_STORAGE_KEY]: mode,
    [CACHE_LIMIT_MAX_ENTRIES_STORAGE_KEY]: Math.max(100, maxEntries)
  };
  await chrome.storage.sync.set(payload);
  if (mode === CACHE_LIMIT_MODE.CUSTOM) {
    cacheLimitMaxEntriesInput.value = String(payload[CACHE_LIMIT_MAX_ENTRIES_STORAGE_KEY]);
  }
  renderCacheLimitStatus(payload);
  showSavedState('缓存上限已保存');

}
function renderDeepLLimitInputs(settings) {

  deeplQuotaModeInput.value = settings[DEEPL_QUOTA_MODE_STORAGE_KEY] || DEEPL_LIMIT_MODE.CUSTOM;
  deeplQuotaLimitKInput.value = String(
    settings[DEEPL_QUOTA_LIMIT_K_STORAGE_KEY] || DEFAULT_DEEPL_QUOTA_LIMIT_K
  );
  deeplDurationModeInput.value = settings[DEEPL_DURATION_MODE_STORAGE_KEY] || DEEPL_LIMIT_MODE.CUSTOM;
  deeplDurationLimitDaysInput.value = String(
    settings[DEEPL_DURATION_LIMIT_DAYS_STORAGE_KEY] || DEFAULT_DEEPL_DURATION_LIMIT_DAYS
  );

}
function updateDeepLLimitInputState() {

  const quotaCustom = deeplQuotaModeInput.value === DEEPL_LIMIT_MODE.CUSTOM;
  const durationCustom = deeplDurationModeInput.value === DEEPL_LIMIT_MODE.CUSTOM;
  deeplQuotaLimitKInput.disabled = !quotaCustom;
  deeplDurationLimitDaysInput.disabled = !durationCustom;

}
function getDeepLLimitOptionsFromInputs() {

  return {
    quotaMode: deeplQuotaModeInput.value,
    quotaLimitK: deeplQuotaLimitKInput.value,
    durationMode: deeplDurationModeInput.value,
    durationLimitDays: deeplDurationLimitDaysInput.value
  };

}
async function saveDeepLApiKey() {

  const apiKey = deeplApiKeyInput.value.trim();
  if (!apiKey) {
    showSavedState('请输入 DeepL API Key', true);
    return;
  }
  const payload = buildDeepLKeyStoragePayload(apiKey, getDeepLLimitOptionsFromInputs());
  await chrome.storage.local.set(payload);
  deeplApiKeyInput.value = '';
  renderDeepLLimitInputs(payload);
  renderDeepLKeyStatus(payload);
  updateDeepLLimitInputState();
  showSavedState('密钥已保存，润色已启用');

}
async function clearDeepLApiKey() {

  const payload = buildDeepLKeyStoragePayload('');
  await chrome.storage.local.set(payload);
  deeplApiKeyInput.value = '';
  renderDeepLKeyStatus(payload);
  showSavedState('已清除密钥并关闭润色');

}
function renderDeepLKeyStatus(settings) {

  deeplKeyStatus.textContent = formatDeepLKeyStatusText(settings);

}
async function saveExcludedTranslationHosts() {

  const excludedTranslationHosts = normalizeExcludedTranslationHosts(
    excludedTranslationHostsInput.value.split(/\r?\n/)
  );
  excludedTranslationHostsInput.value = excludedTranslationHosts.join('\n');
  await chrome.storage.sync.set({
    [EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]: excludedTranslationHosts
  });
  showSavedState();
  renderExcludedTranslationHostsSearch();

}
function getUserProtectedTerms() {

  return dedupeTerms(userProtectedTermsInput.value.split(/\r?\n/));

}
async function saveUserProtectedTerms() {

  const userProtectedTerms = getUserProtectedTerms();
  userProtectedTermsInput.value = userProtectedTerms.join('\n');
  await chrome.storage.sync.set({
    [USER_PROTECTED_TERMS_STORAGE_KEY]: userProtectedTerms
  });
  renderProtectedTermSearch();
  showSavedState('不翻译词库已保存');

}
async function resetUserProtectedTerms() {

  const defaults = getDefaultProtectedTerms();
  userProtectedTermsInput.value = defaults.join('\n');
  await chrome.storage.sync.set({
    [USER_PROTECTED_TERMS_STORAGE_KEY]: defaults
  });
  renderProtectedTermSearch();
  showSavedState('已恢复默认词库');

}
function renderProtectedTermSearchWithDebounce() {

  clearTimeout(protectedTermsSearchTimer);
  protectedTermsSearchTimer = setTimeout(renderProtectedTermSearch, 200);

}
function renderProtectedTermSearch() {

  const query = String(protectedTermSearchInput.value || '').trim();
  protectedTermSearchResult.classList.remove('match', 'miss');
  if (!query) {
    protectedTermSearchResult.textContent = '请输入要查询的词';
    return;
  }
  const dictionaries = getProtectedTermDictionaries(getUserProtectedTerms());
  const result = searchProtectedTerms(query, dictionaries);
  if (!result.found) {
    protectedTermSearchResult.textContent = '未在保护词库中，可添加到用户自定义词库';
    protectedTermSearchResult.classList.add('miss');
    return;
  }
  const labels = result.matches.map((match) => `${match.categoryLabel} / ${match.sourceLabel}`);
  protectedTermSearchResult.textContent = `已在保护词库中：${labels.join('；')}`;
  protectedTermSearchResult.classList.add('match');

}
async function addProtectedTermFromSearch() {

  const query = String(protectedTermSearchInput.value || '').trim();
  if (!query) {
    showSavedState('请输入要添加的词', true);
    return;
  }
  const nextTerms = dedupeTerms([...getUserProtectedTerms(), query]);
  userProtectedTermsInput.value = nextTerms.join('\n');
  await chrome.storage.sync.set({
    [USER_PROTECTED_TERMS_STORAGE_KEY]: nextTerms
  });
  renderProtectedTermSearch();
  showSavedState('已添加到用户自定义词库');

}
async function refreshCacheStats() {

  try {
    const stats = await chrome.runtime.sendMessage({ type: GET_CACHE_STATS_MESSAGE });
    const languageSummary = Object.entries(stats?.byLanguage || {})
      .map(([language, count]) => `${language}: ${count}`)
      .join('，');
    const topSites = (stats?.topSites || [])
      .slice(0, 3)
      .map((site) => `${site.site}(${site.entries})`)
      .join('，');
    cacheStats.textContent = [
      `总缓存条数：${stats?.totalEntries || 0}`,
      `估算大小：${formatBytes(stats?.totalApproxBytes || 0)}`,
      languageSummary ? `按语言：${languageSummary}` : '',
      topSites ? `按站点：${topSites}` : ''
    ].filter(Boolean).join('；');
  } catch {
    cacheStats.textContent = '缓存统计读取失败';
  }

}
async function saveAutoCacheCleanupSetting() {

  await chrome.storage.sync.set({
    [AUTO_CACHE_CLEANUP_STORAGE_KEY]: autoCacheCleanupEnabledInput.checked
  });
  showSavedState(autoCacheCleanupEnabledInput.checked ? '已开启自动清理缓存' : '已关闭自动清理缓存');

}
async function clearAllCache() {

  await chrome.runtime.sendMessage({ type: CLEAR_ALL_CACHE_MESSAGE });
  showSavedState('已清空全部缓存');
  await refreshCacheStats();

}
async function clearLanguageCache() {

  const targetLanguage = String(clearLanguageCacheInput.value || '').trim();
  if (!targetLanguage) {
    showSavedState('请输入语言代码', true);
    return;
  }
  await chrome.runtime.sendMessage({
    type: CLEAR_LANGUAGE_CACHE_MESSAGE,
    targetLanguage
  });
  showSavedState('已清空指定语言缓存');
  await refreshCacheStats();

}
async function clearSiteCache() {

  const sourceUrl = String(clearSiteCacheInput.value || '').trim();
  if (!sourceUrl) {
    showSavedState('请输入站点或 URL', true);
    return;
  }
  await chrome.runtime.sendMessage({
    type: CLEAR_SITE_CACHE_MESSAGE,
    sourceUrl: sourceUrl.includes('://') ? sourceUrl : `https://${sourceUrl}`
  });
  showSavedState('已清空指定站点缓存');
  await refreshCacheStats();

}
function formatBytes(bytes) {

  if (!bytes) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;

}
function renderExcludedTranslationHostsSearch() {

  const searchHostname = normalizeTranslationHostname(excludedTranslationHostsSearchInput.value);
  excludedTranslationHostsSearchResult.classList.remove('match', 'miss');
  if (!searchHostname) {
    excludedTranslationHostsSearchResult.textContent = '';
    return;
  }
  const excludedHosts = getCurrentExcludedTranslationHosts();
  const matchedHost = excludedHosts.find((host) => (
    searchHostname === host || searchHostname.endsWith(`.${host}`)
  ));
  if (matchedHost) {
    excludedTranslationHostsSearchResult.textContent = matchedHost === searchHostname
      ? `已排除：${matchedHost}`
      : `匹配父级域名：${matchedHost}`;
    excludedTranslationHostsSearchResult.classList.add('match');
    selectExcludedTranslationHostLine(matchedHost);
    return;
  }
  if (isLocalTranslationHostname(searchHostname)) {
    excludedTranslationHostsSearchResult.textContent = '匹配本地域名规则';
    excludedTranslationHostsSearchResult.classList.add('match');
    return;
  }
  if (isPrivateTranslationHostname(searchHostname)) {
    excludedTranslationHostsSearchResult.textContent = '匹配私有网络规则';
    excludedTranslationHostsSearchResult.classList.add('match');
    return;
  }
  excludedTranslationHostsSearchResult.textContent = '未排除';
  excludedTranslationHostsSearchResult.classList.add('miss');

}
function getCurrentExcludedTranslationHosts() {

  return normalizeExcludedTranslationHosts(excludedTranslationHostsInput.value.split(/\r?\n/));

}
function isLocalTranslationHostname(hostname) {

  const normalizedHostname = normalizeTranslationHostname(hostname);
  return normalizedHostname === 'localhost' ||
    normalizedHostname === '::1' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname.endsWith('.local') ||
    normalizedHostname.endsWith('.lan') ||
    normalizedHostname.endsWith('.home.arpa');

}
function selectExcludedTranslationHostLine(hostname) {

  const text = excludedTranslationHostsInput.value;
  const lines = text.split('\n');
  let start = 0;
  for (const line of lines) {
    const normalizedLine = normalizeTranslationHostname(line);
    const end = start + line.length;
    if (normalizedLine === hostname) {
      excludedTranslationHostsInput.setSelectionRange(start, end);
      scrollExcludedTranslationHostsToLine(start);
      return;
    }
    start = end + 1;
  }

}
function scrollExcludedTranslationHostsToLine(position) {

  const textBeforePosition = excludedTranslationHostsInput.value.slice(0, position);
  const lineIndex = textBeforePosition.split('\n').length - 1;
  const style = getComputedStyle(excludedTranslationHostsInput);
  const lineHeight = Number.parseFloat(style.lineHeight) || 20;
  excludedTranslationHostsInput.scrollTop = Math.max(0, (lineIndex - 3) * lineHeight);

}
function showSavedState(message = '已保存', isError = false) {

  saveStatus.textContent = message;
  saveStatus.style.color = isError ? '#b91c1c' : '#047857';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveStatus.textContent = '';
  }, 1400);

}

