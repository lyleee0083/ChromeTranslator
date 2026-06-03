import {
  DEFAULT_TARGET_LANGUAGE,
  SUPPORTED_LANGUAGES,
  getLanguageByCode,
  normalizeLanguageCode
} from './language-options.js';
import {
  DEFAULT_EXCLUDED_TRANSLATION_HOSTS,
  EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY,
  getHostnameFromUrl,
  isTranslationHostExcluded,
  normalizeExcludedTranslationHosts,
  normalizeTranslationHostname,
  setTranslationHostExcluded
} from './domain-settings.js';
import {
  buildTranslationCacheKey,
  getDefaultSourceLanguage,
  isDeepLTargetLanguageSupported,
  translateText,
  translateTextBatch
} from './translator.js';
import {
  DEEPL_API_KEY_STATUS_STORAGE_KEY,
  DEEPL_API_KEY_STORAGE_KEY,
  DEEPL_KEY_STATUS,
  DEEPL_LIMIT_MODE,
  DEEPL_NETWORK_ENABLED_STORAGE_KEY,
  DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY,
  DEEPL_QUOTA_MODE_STORAGE_KEY,
  DEEPL_QUOTA_USED_CHARS_STORAGE_KEY,
  getDeepLNetworkStatus,
  getDefaultDeepLSettings,
  DEEPL_CONCURRENCY_LIMIT_STORAGE_KEY
} from './deepl-settings.js';
import {
  LOCAL_TRANSLATION_CACHE_STORAGE_KEY,
  LOCAL_TRANSLATION_CACHE_DIRECTORY_STORAGE_KEY,
  addLocalTranslationCacheDirectoryKey,
  buildLocalTranslationCacheStorageKey,
  cleanupLocalTranslationCacheIndex,
  getLocalTranslationCacheDirectoryEntry,
  getLocalTranslationCacheStats,
  getTranslationCacheSite
} from './translation-cache.js';
import {
  DEFAULT_WEBPAGE_TRANSLATION_ENABLED,
  WEBPAGE_TRANSLATION_STORAGE_KEY
} from './webpage-translation.js';
import {
  DEFAULT_YOUTUBE_SUBTITLE_TRANSLATION_ENABLED,
  YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY
} from './youtube-subtitles.js';
import {
  PROTECTED_TERMS_VERSION,
  USER_PROTECTED_TERMS_STORAGE_KEY,
  buildMergedTermsProtector,
  clearMergedTermsProtectorCache,
  getWebpageMergedProtectedTerms,
  getYoutubeMergedProtectedTerms
} from './protected-terms.js';
import {
  shouldPersistTranslationResult
} from './translation-result-utils.js';
import {
  filterSessionEntriesByLanguage,
  getSessionCacheKeysBySite
} from './cache-clear-utils.js';

const MENU_ROOT_ID = 'chrome-translator-menu';
const MENU_TARGET_LANGUAGE_ID = 'target-language-menu';
const MENU_TARGET_LANGUAGE_PREFIX = 'target-language:';
const MENU_YOUTUBE_SUBTITLE_ID = 'toggle-youtube-subtitle-translation';
const MENU_WEBPAGE_TRANSLATION_ID = 'toggle-webpage-translation';
const MENU_CURRENT_SITE_EXCLUDED_ID = 'toggle-current-site-excluded';
const MENU_RESTORE_ORIGINAL_ID = 'restore-original-page';
const MENU_SHOW_TRANSLATED_ID = 'show-translated-page';
const MENU_SHOW_BILINGUAL_ID = 'show-bilingual-page';
const MENU_OPEN_OPTIONS_ID = 'open-options';
const STORAGE_KEY = 'targetLanguage';
const TRANSLATE_TEXT_MESSAGE = 'TRANSLATE_TEXT';
const TRANSLATE_TEXT_BATCH_MESSAGE = 'TRANSLATE_TEXT_BATCH';
const CANCEL_TRANSLATION_TASKS_MESSAGE = 'CANCEL_TRANSLATION_TASKS';
const RESTORE_WEBPAGE_ORIGINAL_MESSAGE = 'RESTORE_WEBPAGE_ORIGINAL';
const SHOW_WEBPAGE_TRANSLATED_MESSAGE = 'SHOW_WEBPAGE_TRANSLATED';
const SHOW_WEBPAGE_BILINGUAL_MESSAGE = 'SHOW_WEBPAGE_BILINGUAL';
const CLEAR_CURRENT_SITE_CACHE_MESSAGE = 'CLEAR_CURRENT_SITE_CACHE';
const GET_CACHE_STATS_MESSAGE = 'GET_CACHE_STATS';
const CLEAR_ALL_CACHE_MESSAGE = 'CLEAR_ALL_CACHE';
const CLEAR_LANGUAGE_CACHE_MESSAGE = 'CLEAR_LANGUAGE_CACHE';
const CLEAR_SITE_CACHE_MESSAGE = 'CLEAR_SITE_CACHE';
const AUTO_CACHE_CLEANUP_STORAGE_KEY = 'autoCacheCleanupEnabled';
const SESSION_TRANSLATION_CACHE_STORAGE_PREFIX = 'sessionTranslationCache:';
const TRANSLATION_TASK_CONCURRENCY = 10;
const YOUTUBE_SUBTITLE_TASK_TYPE = 'youtube-subtitle';
const WEBPAGE_TRANSLATION_TASK_TYPE = 'full-page';
const CACHE_SAVE_DEBOUNCE_MS = 150;
const TASK_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed'
};
let activeTranslationCaches = new Map();
let localTranslationCachePromises = new Map();
let localTranslationCacheDirectoryPromise = null;
let localTranslationCacheSaveTimer = null;
let localTranslationCacheSavePromise = null;
let resolveLocalTranslationCacheSave = null;
let rejectLocalTranslationCacheSave = null;
let pendingLocalTranslationCachePayload = {};
let activeTranslationTasks = 0;
let queuedTranslationTasks = [];
let runningTranslationTasks = new Map();
let nextTranslationTaskId = 1;
const protectedTermProtectorState = {
  userKey: '',
  youtube: null,
  webpage: null
};

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});
setupContextMenus();

chrome.tabs.onRemoved.addListener((tabId) => {
  clearActiveTranslationCache(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'loading') {
    clearActiveTranslationCache(tabId);
  }

  if (changeInfo.url || changeInfo.status === 'complete') {
    updateContextMenuState();
  }
});

chrome.tabs.onActivated.addListener(() => {
  updateContextMenuState();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    updateContextMenuState();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[USER_PROTECTED_TERMS_STORAGE_KEY]) {
    protectedTermProtectorState.userKey = '';
    protectedTermProtectorState.youtube = null;
    protectedTermProtectorState.webpage = null;
    clearMergedTermsProtectorCache();
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (String(info.menuItemId).startsWith(MENU_TARGET_LANGUAGE_PREFIX)) {
    await setTargetLanguageFromContextMenu(info.menuItemId);
    return;
  }

  if (info.menuItemId === MENU_YOUTUBE_SUBTITLE_ID) {
    await chrome.storage.sync.set({
      [YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY]: Boolean(info.checked)
    });
    return;
  }

  if (info.menuItemId === MENU_WEBPAGE_TRANSLATION_ID) {
    await chrome.storage.sync.set({
      [WEBPAGE_TRANSLATION_STORAGE_KEY]: Boolean(info.checked)
    });
    return;
  }

  if (info.menuItemId === MENU_CURRENT_SITE_EXCLUDED_ID) {
    await setCurrentSiteExcludedFromContextMenu(tab?.url, Boolean(info.checked));
    return;
  }

  if (
    info.menuItemId === MENU_RESTORE_ORIGINAL_ID ||
    info.menuItemId === MENU_SHOW_TRANSLATED_ID ||
    info.menuItemId === MENU_SHOW_BILINGUAL_ID
  ) {
    await sendWebpageDisplayModeMessage(tab?.id, info.menuItemId);
    return;
  }

  if (info.menuItemId === MENU_OPEN_OPTIONS_ID) {
    chrome.runtime.openOptionsPage();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && hasContextMenuStorageChange(changes)) {
    updateContextMenuState();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === TRANSLATE_TEXT_MESSAGE) {
    translateTextForContentScript(
      message.sourceText,
      sender?.tab?.url,
      sender?.tab?.id,
      message.taskType,
      message.priority,
      message.cacheOnly
    )
      .then(sendResponse)
      .catch((error) => {
        console.warn('Chrome Translator could not translate text.', error);
        sendResponse(null);
      });

    return true;
  }

  if (message?.type === TRANSLATE_TEXT_BATCH_MESSAGE) {
    translateTextBatchForContentScript(
      message.sourceTexts,
      sender?.tab?.url,
      sender?.tab?.id,
      message.taskType,
      message.priority,
      message.cacheOnly
    )
      .then(sendResponse)
      .catch((error) => {
        console.warn('Chrome Translator could not batch translate text.', error);
        sendResponse([]);
      });

    return true;
  }

  if (message?.type === CANCEL_TRANSLATION_TASKS_MESSAGE) {
    cancelTranslationTasks({
      tabId: sender?.tab?.id,
      url: sender?.tab?.url,
      taskType: message.taskType
    });
    sendResponse({ cancelled: true });
    return false;
  }

  if (
    message?.type === RESTORE_WEBPAGE_ORIGINAL_MESSAGE ||
    message?.type === SHOW_WEBPAGE_TRANSLATED_MESSAGE ||
    message?.type === SHOW_WEBPAGE_BILINGUAL_MESSAGE
  ) {
    return false;
  }

  if (message?.type === GET_CACHE_STATS_MESSAGE) {
    getCacheStats()
      .then(sendResponse)
      .catch(() => sendResponse({
        totalEntries: 0,
        totalApproxBytes: 0,
        byLanguage: {},
        topSites: []
      }));
    return true;
  }

  if (message?.type === CLEAR_ALL_CACHE_MESSAGE) {
    clearAllTranslationCaches()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === CLEAR_LANGUAGE_CACHE_MESSAGE) {
    clearLanguageTranslationCache(message.targetLanguage)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === CLEAR_SITE_CACHE_MESSAGE || message?.type === CLEAR_CURRENT_SITE_CACHE_MESSAGE) {
    clearSiteTranslationCache(message.sourceUrl || sender?.tab?.url || '')
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ROOT_ID,
      title: 'Chrome Translator',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      parentId: MENU_ROOT_ID,
      type: 'separator',
      id: 'separator-before-language',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU_TARGET_LANGUAGE_ID,
      parentId: MENU_ROOT_ID,
      title: '目标语言',
      contexts: ['page']
    });

    for (const language of SUPPORTED_LANGUAGES) {
      chrome.contextMenus.create({
        id: `${MENU_TARGET_LANGUAGE_PREFIX}${language.code}`,
        parentId: MENU_TARGET_LANGUAGE_ID,
        title: `${language.name} (${language.nativeName})`,
        type: 'radio',
        contexts: ['page']
      });
    }

    chrome.contextMenus.create({
      parentId: MENU_ROOT_ID,
      type: 'separator',
      id: 'separator-after-language',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU_YOUTUBE_SUBTITLE_ID,
      parentId: MENU_ROOT_ID,
      title: '翻译 YouTube 字幕',
      type: 'checkbox',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU_WEBPAGE_TRANSLATION_ID,
      parentId: MENU_ROOT_ID,
      title: '翻译整个页面',
      type: 'checkbox',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU_CURRENT_SITE_EXCLUDED_ID,
      parentId: MENU_ROOT_ID,
      title: '不翻译此网站',
      type: 'checkbox',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      parentId: MENU_ROOT_ID,
      type: 'separator',
      id: 'separator-before-display-mode',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU_RESTORE_ORIGINAL_ID,
      parentId: MENU_ROOT_ID,
      title: '显示原文',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU_SHOW_TRANSLATED_ID,
      parentId: MENU_ROOT_ID,
      title: '显示译文',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU_SHOW_BILINGUAL_ID,
      parentId: MENU_ROOT_ID,
      title: '双语对照',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      parentId: MENU_ROOT_ID,
      type: 'separator',
      id: 'separator-before-options',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: MENU_OPEN_OPTIONS_ID,
      parentId: MENU_ROOT_ID,
      title: '设置',
      contexts: ['page']
    });
    updateContextMenuState();
  });
}

function hasContextMenuStorageChange(changes) {
  return Boolean(
    changes[STORAGE_KEY]
    || changes[YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY]
    || changes[WEBPAGE_TRANSLATION_STORAGE_KEY]
    || changes[EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]
  );
}

async function updateContextMenuState() {
  const stored = await chrome.storage.sync.get({
    [STORAGE_KEY]: DEFAULT_TARGET_LANGUAGE,
    [YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY]: DEFAULT_YOUTUBE_SUBTITLE_TRANSLATION_ENABLED,
    [WEBPAGE_TRANSLATION_STORAGE_KEY]: DEFAULT_WEBPAGE_TRANSLATION_ENABLED,
    [EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]: DEFAULT_EXCLUDED_TRANSLATION_HOSTS
  });
  const targetLanguage = normalizeLanguageCode(stored[STORAGE_KEY]);
  const currentSiteHostname = await getActiveTabHostname();
  const currentSiteAvailable = Boolean(currentSiteHostname);
  const currentSiteExcluded = currentSiteAvailable && isTranslationHostExcluded(
    currentSiteHostname,
    stored[EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]
  );

  await Promise.all([
    updateContextMenuItem(MENU_TARGET_LANGUAGE_ID, {
      title: `目标语言：${getLanguageByCode(targetLanguage).nativeName}`
    }),
    ...SUPPORTED_LANGUAGES.map((language) => updateContextMenuItem(
      `${MENU_TARGET_LANGUAGE_PREFIX}${language.code}`,
      { checked: language.code === targetLanguage }
    )),
    updateContextMenuItem(MENU_YOUTUBE_SUBTITLE_ID, {
      checked: Boolean(stored[YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY])
    }),
    updateContextMenuItem(MENU_WEBPAGE_TRANSLATION_ID, {
      checked: Boolean(stored[WEBPAGE_TRANSLATION_STORAGE_KEY])
    }),
    updateContextMenuItem(MENU_CURRENT_SITE_EXCLUDED_ID, {
      checked: currentSiteExcluded,
      enabled: currentSiteAvailable,
      title: currentSiteAvailable
        ? `不翻译此网站（${currentSiteHostname}）`
        : '不翻译此网站'
    })
  ]);
}

async function getActiveTabHostname() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return normalizeTranslationHostname(getHostnameFromUrl(tab?.url || ''));
  } catch {
    return '';
  }
}

function updateContextMenuItem(id, properties) {
  return new Promise((resolve) => {
    chrome.contextMenus.update(id, properties, () => {
      resolve();
    });
  });
}

async function setTargetLanguageFromContextMenu(menuItemId) {
  const languageCode = normalizeLanguageCode(String(menuItemId).slice(MENU_TARGET_LANGUAGE_PREFIX.length));
  await chrome.storage.sync.set({ [STORAGE_KEY]: languageCode });
}

async function setCurrentSiteExcludedFromContextMenu(sourceUrl, excluded) {
  const currentSiteHostname = normalizeTranslationHostname(getHostnameFromUrl(sourceUrl || ''));
  if (!currentSiteHostname) {
    return;
  }

  const stored = await chrome.storage.sync.get({
    [EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]: DEFAULT_EXCLUDED_TRANSLATION_HOSTS
  });
  const excludedTranslationHosts = setTranslationHostExcluded(
    stored[EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY],
    currentSiteHostname,
    excluded
  );

  await chrome.storage.sync.set({
    [EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]: excludedTranslationHosts
  });
}

async function sendWebpageDisplayModeMessage(tabId, menuItemId) {
  if (tabId === null || tabId === undefined) {
    return;
  }

  const messageType = {
    [MENU_RESTORE_ORIGINAL_ID]: RESTORE_WEBPAGE_ORIGINAL_MESSAGE,
    [MENU_SHOW_TRANSLATED_ID]: SHOW_WEBPAGE_TRANSLATED_MESSAGE,
    [MENU_SHOW_BILINGUAL_ID]: SHOW_WEBPAGE_BILINGUAL_MESSAGE
  }[menuItemId];
  if (!messageType) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: messageType });
  } catch {
    // Content scripts are unavailable on browser pages and restricted URLs.
  }
}

async function translateTextForContentScript(sourceText, sourceUrl, tabId, taskType = 'single', priority = 5, cacheOnly = false) {
  if (await isSourceUrlExcluded(sourceUrl)) {
    return null;
  }

  const normalizedSource = String(sourceText || '').trim();
  if (!normalizedSource) {
    return null;
  }

  const stored = await chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_TARGET_LANGUAGE });
  const targetLanguage = normalizeLanguageCode(stored[STORAGE_KEY]);
  const availability = await ensureTranslationAvailable(targetLanguage);
  if (!availability.cacheLookupAllowed) {
    return null;
  }

  return enqueueTranslationTask(
    (signal) => translateWithLocalCache(
      normalizedSource,
      targetLanguage,
      sourceUrl,
      tabId,
      signal,
      availability.apiKey,
      cacheOnly ? false : availability.networkEnabled,
      priority,
      taskType,
      availability.deeplConcurrencyLimit
    ),
    { tabId, url: sourceUrl, taskType, priority }
  );
}

async function translateTextBatchForContentScript(sourceTexts, sourceUrl, tabId, taskType = 'batch', priority = 5, cacheOnly = false) {
  if (await isSourceUrlExcluded(sourceUrl)) {
    return [];
  }

  const normalizedTexts = (Array.isArray(sourceTexts) ? sourceTexts : [])
    .map((sourceText) => String(sourceText || '').trim());
  if (normalizedTexts.length === 0) {
    return [];
  }

  const stored = await chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_TARGET_LANGUAGE });
  const targetLanguage = normalizeLanguageCode(stored[STORAGE_KEY]);
  const availability = await ensureTranslationAvailable(targetLanguage);
  if (!availability.cacheLookupAllowed) {
    return [];
  }

  return enqueueTranslationTask(
    (signal) => translateBatchWithLocalCache(
      normalizedTexts,
      targetLanguage,
      sourceUrl,
      tabId,
      signal,
      availability.apiKey,
      cacheOnly ? false : availability.networkEnabled,
      priority,
      taskType,
      availability.deeplConcurrencyLimit
    ),
    { tabId, url: sourceUrl, taskType, priority }
  );
}

async function ensureTranslationAvailable(targetLanguage) {
  if (!isDeepLTargetLanguageSupported(targetLanguage)) {
    return { cacheLookupAllowed: false, networkEnabled: false, reason: 'unsupported_language' };
  }

  const settings = await chrome.storage.local.get({
    ...getDefaultDeepLSettings()
  });
  const networkStatus = getDeepLNetworkStatus(settings);
  await chrome.storage.local.set({
    [DEEPL_API_KEY_STATUS_STORAGE_KEY]: getDeepLStorageStatus(networkStatus)
  });
  return {
    cacheLookupAllowed: true,
    networkEnabled: networkStatus.ok,
    apiKey: settings[DEEPL_API_KEY_STORAGE_KEY],
    deeplConcurrencyLimit: settings[DEEPL_CONCURRENCY_LIMIT_STORAGE_KEY],
    status: networkStatus.status || networkStatus.reason
  };
}

function getDeepLStorageStatus(networkStatus) {
  if (networkStatus.ok) {
    return networkStatus.status || DEEPL_KEY_STATUS.ACTIVE;
  }
  if (networkStatus.reason === 'quota_exhausted') {
    return DEEPL_KEY_STATUS.QUOTA_EXHAUSTED;
  }
  if (networkStatus.reason === 'expired') {
    return DEEPL_KEY_STATUS.EXPIRED;
  }
  if (networkStatus.reason === 'network_disabled') {
    return DEEPL_KEY_STATUS.NETWORK_DISABLED;
  }
  return DEEPL_KEY_STATUS.MISSING;
}

async function isSourceUrlExcluded(sourceUrl) {
  const stored = await chrome.storage.sync.get({
    [EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]: DEFAULT_EXCLUDED_TRANSLATION_HOSTS
  });
  return isTranslationHostExcluded(sourceUrl, stored[EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]);
}

function enqueueTranslationTask(task, metadata = {}) {
  return new Promise((resolve, reject) => {
    queuedTranslationTasks.push({
      task,
      resolve,
      reject,
      record: createTranslationTaskRecord(metadata)
    });
    processTranslationTaskQueue();
  });
}

function processTranslationTaskQueue() {
  while (activeTranslationTasks < TRANSLATION_TASK_CONCURRENCY && queuedTranslationTasks.length > 0) {
    const nextIndex = getNextQueuedTranslationTaskIndex();
    const [queuedTask] = queuedTranslationTasks.splice(nextIndex, 1);
    if (isTranslationTaskCancelled(queuedTask.record)) {
      queuedTask.resolve(null);
      continue;
    }

    activeTranslationTasks += 1;
    queuedTask.record.status = TASK_STATUS.RUNNING;
    runningTranslationTasks.set(queuedTask.record.id, queuedTask.record);

    Promise.resolve()
      .then(() => queuedTask.task(queuedTask.record.abortController.signal))
      .then((result) => {
        if (isTranslationTaskCancelled(queuedTask.record)) {
          queuedTask.resolve(null);
          return;
        }

        queuedTask.record.status = TASK_STATUS.COMPLETED;
        queuedTask.resolve(result);
      }, (error) => {
        if (isTranslationTaskCancelled(queuedTask.record)) {
          queuedTask.resolve(null);
          return;
        }

        queuedTask.record.status = TASK_STATUS.FAILED;
        queuedTask.reject(error);
      })
      .finally(() => {
        activeTranslationTasks -= 1;
        runningTranslationTasks.delete(queuedTask.record.id);
        processTranslationTaskQueue();
      });
  }
}

function getNextQueuedTranslationTaskIndex() {
  let selectedIndex = 0;
  for (let index = 1; index < queuedTranslationTasks.length; index += 1) {
    const candidate = queuedTranslationTasks[index].record;
    const selected = queuedTranslationTasks[selectedIndex].record;
    if (candidate.priority < selected.priority) {
      selectedIndex = index;
      continue;
    }
    if (candidate.priority === selected.priority && candidate.createdAt < selected.createdAt) {
      selectedIndex = index;
    }
  }
  return selectedIndex;
}

function createTranslationTaskRecord(metadata = {}) {
  return {
    id: nextTranslationTaskId++,
    tabId: metadata.tabId ?? null,
    url: String(metadata.url || ''),
    type: metadata.taskType || 'translation',
    priority: Number.isFinite(metadata.priority) ? metadata.priority : 5,
    createdAt: Date.now(),
    abortController: new AbortController(),
    status: TASK_STATUS.PENDING
  };
}

function cancelTranslationTasks({ tabId = null, url = '', taskType = '' } = {}) {
  const shouldCancel = (record) => (
    (tabId === null || tabId === undefined || record.tabId === tabId) &&
    (!url || record.url === String(url || '')) &&
    (!taskType || record.type === taskType)
  );

  queuedTranslationTasks = queuedTranslationTasks.filter((queuedTask) => {
    if (!shouldCancel(queuedTask.record)) {
      return true;
    }

    markTranslationTaskCancelled(queuedTask.record);
    queuedTask.resolve(null);
    return false;
  });

  for (const record of runningTranslationTasks.values()) {
    if (shouldCancel(record)) {
      markTranslationTaskCancelled(record);
    }
  }
}

function markTranslationTaskCancelled(record) {
  record.status = TASK_STATUS.CANCELLED;
  record.abortController.abort();
}

function isTranslationTaskCancelled(record) {
  return record.status === TASK_STATUS.CANCELLED || record.abortController.signal.aborted;
}

async function resolveProtectedTermsForTaskType(taskType = '') {
  const userProtectedTerms = await getUserProtectedTerms();
  if (taskType === YOUTUBE_SUBTITLE_TASK_TYPE) {
    return getYoutubeMergedProtectedTerms(userProtectedTerms);
  }
  if (taskType === WEBPAGE_TRANSLATION_TASK_TYPE) {
    return getWebpageMergedProtectedTerms(userProtectedTerms);
  }

  return getWebpageMergedProtectedTerms(userProtectedTerms);
}

async function getProtectedTermProtector(taskType = '') {
  const userProtectedTerms = await getUserProtectedTerms();
  const userKey = userProtectedTerms.join('\u0001');
  if (protectedTermProtectorState.userKey !== userKey) {
    protectedTermProtectorState.userKey = userKey;
    protectedTermProtectorState.youtube = buildMergedTermsProtector(
      getYoutubeMergedProtectedTerms(userProtectedTerms)
    );
    protectedTermProtectorState.webpage = buildMergedTermsProtector(
      getWebpageMergedProtectedTerms(userProtectedTerms)
    );
  }

  if (taskType === YOUTUBE_SUBTITLE_TASK_TYPE) {
    return protectedTermProtectorState.youtube;
  }

  return protectedTermProtectorState.webpage;
}

function shouldUseMergedProtectedTerms(taskType = '') {
  return taskType === YOUTUBE_SUBTITLE_TASK_TYPE || taskType === WEBPAGE_TRANSLATION_TASK_TYPE;
}

async function getChineseResidueRetryOptions(taskType = '') {
  if (
    taskType !== WEBPAGE_TRANSLATION_TASK_TYPE &&
    taskType !== YOUTUBE_SUBTITLE_TASK_TYPE
  ) {
    return {
      enableChineseResidueRetry: false,
      userProtectedTermsForRetry: []
    };
  }

  return {
    enableChineseResidueRetry: true,
    userProtectedTermsForRetry: await getUserProtectedTerms()
  };
}

async function translateWithLocalCache(
  sourceText,
  targetLanguage,
  sourceUrl = '',
  tabId = null,
  signal = null,
  apiKey = '',
  networkEnabled = true,
  priority = 5,
  taskType = '',
  deeplConcurrencyLimit = undefined
) {
  if (signal?.aborted) {
    return null;
  }

  const [localIndex, cache] = await Promise.all([
    getLocalTranslationCacheIndex(sourceUrl, targetLanguage),
    getActiveTranslationCache(tabId, sourceUrl)
  ]);
  const [
    userProtectedTerms,
    protectedTermProtector,
    residueRetryOptions,
    isQuotaNearLimit
  ] = await Promise.all([
    resolveProtectedTermsForTaskType(taskType),
    getProtectedTermProtector(taskType),
    getChineseResidueRetryOptions(taskType),
    isDeepLQuotaAlmostUsed()
  ]);
  const useProtectedTermsAsMerged = shouldUseMergedProtectedTerms(taskType);
  if (signal?.aborted) {
    return null;
  }

  const localCache = localIndex.cache;
  const translation = await translateText(sourceText, targetLanguage, {
    localCache,
    cache,
    apiKey,
    networkEnabled,
    userProtectedTerms,
    useProtectedTermsAsMerged,
    protectedTermProtector,
    isQuotaAlmostUsed: isQuotaNearLimit,
    deeplConcurrencyLimit,
    priority,
    ...residueRetryOptions
  });
  if (signal?.aborted || !isActiveTranslationCacheCurrent(tabId, sourceUrl)) {
    return null;
  }

  const cacheKey = buildTranslationCacheKey(
    sourceText,
    getDefaultSourceLanguage(targetLanguage),
    targetLanguage
  );
  if (await saveTranslationToLocalIndex(localIndex, cacheKey, translation)) {
    if (await isAutoCacheCleanupEnabled()) {
      cleanupLocalTranslationCacheIndex(localIndex);
    }
    await saveLocalTranslationCacheIndex(localIndex);
  }
  await recordDeepLUsage([translation]);
  await saveActiveTranslationSessionCache(tabId, sourceUrl, cache);

  return translation;
}

async function translateBatchWithLocalCache(
  sourceTexts,
  targetLanguage,
  sourceUrl = '',
  tabId = null,
  signal = null,
  apiKey = '',
  networkEnabled = true,
  priority = 5,
  taskType = '',
  deeplConcurrencyLimit = undefined
) {
  if (signal?.aborted) {
    return [];
  }

  const [localIndex, cache] = await Promise.all([
    getLocalTranslationCacheIndex(sourceUrl, targetLanguage),
    getActiveTranslationCache(tabId, sourceUrl)
  ]);
  const [
    userProtectedTerms,
    protectedTermProtector,
    residueRetryOptions,
    isQuotaNearLimit
  ] = await Promise.all([
    resolveProtectedTermsForTaskType(taskType),
    getProtectedTermProtector(taskType),
    getChineseResidueRetryOptions(taskType),
    isDeepLQuotaAlmostUsed()
  ]);
  const useProtectedTermsAsMerged = shouldUseMergedProtectedTerms(taskType);
  if (signal?.aborted) {
    return [];
  }

  const translations = await translateTextBatch(sourceTexts, targetLanguage, {
    localCache: localIndex.cache,
    cache,
    apiKey,
    networkEnabled,
    userProtectedTerms,
    useProtectedTermsAsMerged,
    protectedTermProtector,
    isQuotaAlmostUsed: isQuotaNearLimit,
    deeplConcurrencyLimit,
    priority,
    ...residueRetryOptions
  });
  if (signal?.aborted || !isActiveTranslationCacheCurrent(tabId, sourceUrl)) {
    return [];
  }
  let localIndexChanged = false;

  for (const translation of translations) {
    const cacheKey = buildTranslationCacheKey(
      translation?.sourceText || '',
      getDefaultSourceLanguage(targetLanguage),
      targetLanguage
    );
    localIndexChanged = (await saveTranslationToLocalIndex(localIndex, cacheKey, translation)) || localIndexChanged;
  }

  if (localIndexChanged) {
    if (await isAutoCacheCleanupEnabled()) {
      cleanupLocalTranslationCacheIndex(localIndex);
    }
    await saveLocalTranslationCacheIndex(localIndex);
  }
  await recordDeepLUsage(translations);
  await saveActiveTranslationSessionCache(tabId, sourceUrl, cache);

  return translations;
}

async function getUserProtectedTerms() {
  const stored = await chrome.storage.sync.get({
    [USER_PROTECTED_TERMS_STORAGE_KEY]: []
  });
  return Array.isArray(stored[USER_PROTECTED_TERMS_STORAGE_KEY])
    ? stored[USER_PROTECTED_TERMS_STORAGE_KEY]
    : [];
}

async function isDeepLQuotaAlmostUsed() {
  const settings = await chrome.storage.local.get(getDefaultDeepLSettings());
  if (settings[DEEPL_QUOTA_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.INFINITE) {
    return false;
  }
  const limit = Number(settings[DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY] || 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return false;
  }
  const used = Number(settings[DEEPL_QUOTA_USED_CHARS_STORAGE_KEY] || 0);
  const remaining = limit - used;
  return remaining <= 10000;
}

async function isAutoCacheCleanupEnabled() {
  const stored = await chrome.storage.sync.get({
    [AUTO_CACHE_CLEANUP_STORAGE_KEY]: false
  });
  return Boolean(stored[AUTO_CACHE_CLEANUP_STORAGE_KEY]);
}

async function recordDeepLUsage(translations) {
  const usedChars = (Array.isArray(translations) ? translations : [])
    .filter((translation) => translation?.source === 'network')
    .reduce((total, translation) => total + String(translation.sourceText || '').length, 0);
  if (usedChars <= 0) {
    return;
  }

  const settings = await chrome.storage.local.get(getDefaultDeepLSettings());
  const nextUsedChars = Number(settings[DEEPL_QUOTA_USED_CHARS_STORAGE_KEY] || 0) + usedChars;
  const payload = {
    [DEEPL_QUOTA_USED_CHARS_STORAGE_KEY]: nextUsedChars
  };

  if (
    settings[DEEPL_QUOTA_MODE_STORAGE_KEY] === DEEPL_LIMIT_MODE.CUSTOM &&
    nextUsedChars >= Number(settings[DEEPL_QUOTA_LIMIT_CHARS_STORAGE_KEY] || 0)
  ) {
    payload[DEEPL_NETWORK_ENABLED_STORAGE_KEY] = false;
    payload[DEEPL_API_KEY_STATUS_STORAGE_KEY] = DEEPL_KEY_STATUS.QUOTA_EXHAUSTED;
  }

  await chrome.storage.local.set(payload);
}

async function getActiveTranslationCache(tabId, sourceUrl) {
  if (tabId === null || tabId === undefined) {
    return new Map();
  }

  const cacheKey = String(tabId);
  const pageUrl = String(sourceUrl || '');
  const existing = activeTranslationCaches.get(cacheKey);
  if (existing?.url === pageUrl) {
    return existing.cache;
  }

  const cache = await loadActiveTranslationSessionCache(tabId, pageUrl);
  activeTranslationCaches.set(cacheKey, { url: pageUrl, cache });
  return cache;
}

function clearActiveTranslationCache(tabId) {
  cancelTranslationTasks({ tabId });
  activeTranslationCaches.delete(String(tabId));
  chrome.storage.session?.remove?.(buildSessionTranslationCacheStorageKey(tabId));
}

function isActiveTranslationCacheCurrent(tabId, sourceUrl) {
  if (tabId === null || tabId === undefined) {
    return true;
  }

  const existing = activeTranslationCaches.get(String(tabId));
  return Boolean(existing && existing.url === String(sourceUrl || ''));
}

async function loadActiveTranslationSessionCache(tabId, sourceUrl) {
  const emptyCache = new Map();
  if (!chrome.storage.session || tabId === null || tabId === undefined) {
    return emptyCache;
  }

  const storageKey = buildSessionTranslationCacheStorageKey(tabId);
  const stored = await chrome.storage.session.get({ [storageKey]: null });
  const snapshot = stored[storageKey];
  if (snapshot?.url !== String(sourceUrl || '') || !snapshot?.entries) {
    return emptyCache;
  }

  return new Map(Object.entries(snapshot.entries));
}

async function saveActiveTranslationSessionCache(tabId, sourceUrl, cache) {
  if (!chrome.storage.session || tabId === null || tabId === undefined || !cache) {
    return;
  }

  await chrome.storage.session.set({
    [buildSessionTranslationCacheStorageKey(tabId)]: {
      url: String(sourceUrl || ''),
      entries: Object.fromEntries(cache)
    }
  });
}

function buildSessionTranslationCacheStorageKey(tabId) {
  return `${SESSION_TRANSLATION_CACHE_STORAGE_PREFIX}${tabId}`;
}

async function getLocalTranslationCache(targetLanguage) {
  const storageKey = buildLocalTranslationCacheStorageKey(targetLanguage);
  if (!localTranslationCachePromises.has(storageKey)) {
    localTranslationCachePromises.set(
      storageKey,
      chrome.storage.local
        .get({ [storageKey]: {} })
        .then((stored) => new Map(Object.entries(stored[storageKey] || {})))
    );
  }

  return localTranslationCachePromises.get(storageKey);
}

async function getLocalTranslationCacheDirectory() {
  if (!localTranslationCacheDirectoryPromise) {
    localTranslationCacheDirectoryPromise = chrome.storage.local
      .get({ [LOCAL_TRANSLATION_CACHE_DIRECTORY_STORAGE_KEY]: {} })
      .then((stored) => stored[LOCAL_TRANSLATION_CACHE_DIRECTORY_STORAGE_KEY] || {});
  }

  return localTranslationCacheDirectoryPromise;
}

async function getLocalTranslationCacheIndex(sourceUrl, targetLanguage) {
  const site = getTranslationCacheSite(sourceUrl);
  const [directory, globalCache] = await Promise.all([
    getLocalTranslationCacheDirectory(),
    getLocalTranslationCache(targetLanguage)
  ]);
  const cacheKeys = getLocalTranslationCacheDirectoryEntry(directory, site, targetLanguage);
  const cache = new Map();

  for (const cacheKey of cacheKeys) {
    if (globalCache.has(cacheKey)) {
      cache.set(cacheKey, globalCache.get(cacheKey));
    }
  }

  return {
    cache,
    directory,
    globalCache,
    site,
    targetLanguage
  };
}

async function saveTranslationToLocalIndex(localIndex, cacheKey, translation) {
  if (!shouldPersistTranslationResult(translation)) {
    return false;
  }

  const existingValue = localIndex.globalCache.get(cacheKey);
  const existingTranslatedText = typeof existingValue === 'string'
    ? existingValue
    : existingValue?.translatedText;
  const hadGlobalValue = existingTranslatedText === translation.translatedText;
  const hadDirectoryKey = getLocalTranslationCacheDirectoryEntry(
    localIndex.directory,
    localIndex.site,
    localIndex.targetLanguage
  ).includes(cacheKey);

  const now = Date.now();
  localIndex.globalCache.set(cacheKey, {
    provider: 'deepl',
    sourceLanguage: getDefaultSourceLanguage(localIndex.targetLanguage),
    targetLanguage: localIndex.targetLanguage,
    sourceHash: cacheKey.split(':').pop(),
    sourcePreview: String(translation.sourceText || '').slice(0, 80),
    translatedText: translation.translatedText,
    protectedTermsVersion: PROTECTED_TERMS_VERSION,
    createdAt: existingValue?.createdAt || now,
    lastUsedAt: now,
    hitCount: typeof existingValue?.hitCount === 'number' ? existingValue.hitCount + 1 : 1,
    site: localIndex.site,
    version: 2
  });
  localIndex.directory = addLocalTranslationCacheDirectoryKey(
    localIndex.directory,
    localIndex.site,
    localIndex.targetLanguage,
    cacheKey
  );

  return !hadGlobalValue || !hadDirectoryKey;
}

async function saveLocalTranslationCacheIndex(localIndex) {
  const storageKey = buildLocalTranslationCacheStorageKey(localIndex.targetLanguage);
  localTranslationCachePromises.set(storageKey, Promise.resolve(localIndex.globalCache));
  localTranslationCacheDirectoryPromise = Promise.resolve(localIndex.directory);
  pendingLocalTranslationCachePayload[storageKey] = Object.fromEntries(localIndex.globalCache);
  pendingLocalTranslationCachePayload[LOCAL_TRANSLATION_CACHE_DIRECTORY_STORAGE_KEY] = localIndex.directory;

  await scheduleLocalTranslationCacheStorageSave();
}

function scheduleLocalTranslationCacheStorageSave() {
  if (!localTranslationCacheSavePromise) {
    localTranslationCacheSavePromise = new Promise((resolve, reject) => {
      resolveLocalTranslationCacheSave = resolve;
      rejectLocalTranslationCacheSave = reject;
    });
  }

  clearTimeout(localTranslationCacheSaveTimer);
  localTranslationCacheSaveTimer = setTimeout(async () => {
    const payload = pendingLocalTranslationCachePayload;
    pendingLocalTranslationCachePayload = {};
    localTranslationCacheSaveTimer = null;

    try {
      if (Object.keys(payload).length > 0) {
        await chrome.storage.local.set(payload);
      }
      resolveLocalTranslationCacheSave?.();
    } catch (error) {
      rejectLocalTranslationCacheSave?.(error);
    } finally {
      localTranslationCacheSavePromise = null;
      resolveLocalTranslationCacheSave = null;
      rejectLocalTranslationCacheSave = null;
    }
  }, CACHE_SAVE_DEBOUNCE_MS);

  return localTranslationCacheSavePromise;
}

async function getCacheStats() {
  const directory = await getLocalTranslationCacheDirectory();
  const languageCaches = {};
  const languageSet = new Set();
  for (const languageMap of Object.values(directory || {})) {
    for (const language of Object.keys(languageMap || {})) {
      languageSet.add(language);
    }
  }

  await Promise.all([...languageSet].map(async (language) => {
    languageCaches[language] = await getLocalTranslationCache(language);
  }));

  return getLocalTranslationCacheStats(directory, languageCaches);
}

async function clearAllTranslationCaches() {
  const snapshot = await chrome.storage.local.get(null);
  const keysToRemove = Object.keys(snapshot).filter((key) => (
    key === LOCAL_TRANSLATION_CACHE_DIRECTORY_STORAGE_KEY ||
    key.startsWith(`${LOCAL_TRANSLATION_CACHE_STORAGE_KEY}:`) ||
    key.startsWith(SESSION_TRANSLATION_CACHE_STORAGE_PREFIX)
  ));

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
  if (chrome.storage.session) {
    const sessionSnapshot = await chrome.storage.session.get(null);
    const sessionKeys = Object.keys(sessionSnapshot).filter((key) => key.startsWith(SESSION_TRANSLATION_CACHE_STORAGE_PREFIX));
    if (sessionKeys.length > 0) {
      await chrome.storage.session.remove(sessionKeys);
    }
  }

  localTranslationCachePromises = new Map();
  localTranslationCacheDirectoryPromise = null;
  activeTranslationCaches = new Map();
  pendingLocalTranslationCachePayload = {};
}

async function clearLanguageTranslationCache(targetLanguage) {
  const normalizedLanguage = normalizeLanguageCode(String(targetLanguage || ''));
  const storageKey = buildLocalTranslationCacheStorageKey(normalizedLanguage);
  const directory = await getLocalTranslationCacheDirectory();
  const nextDirectory = {};
  for (const [site, languageMap] of Object.entries(directory || {})) {
    const nextLanguageMap = { ...(languageMap || {}) };
    delete nextLanguageMap[normalizedLanguage];
    if (Object.keys(nextLanguageMap).length > 0) {
      nextDirectory[site] = nextLanguageMap;
    }
  }

  await chrome.storage.local.remove([storageKey]);
  await chrome.storage.local.set({
    [LOCAL_TRANSLATION_CACHE_DIRECTORY_STORAGE_KEY]: nextDirectory
  });
  localTranslationCachePromises.delete(storageKey);
  localTranslationCacheDirectoryPromise = Promise.resolve(nextDirectory);
  await clearActiveAndSessionCachesByLanguage(normalizedLanguage);
}

async function clearSiteTranslationCache(sourceUrl) {
  const site = getTranslationCacheSite(sourceUrl);
  const directory = await getLocalTranslationCacheDirectory();
  const siteEntry = directory?.[site];
  await clearActiveAndSessionCachesBySite(site);
  if (!siteEntry) {
    return;
  }

  const affectedLanguages = Object.keys(siteEntry);
  for (const language of affectedLanguages) {
    const globalCache = await getLocalTranslationCache(language);
    const cacheKeys = getLocalTranslationCacheDirectoryEntry(directory, site, language);
    cacheKeys.forEach((cacheKey) => globalCache.delete(cacheKey));
    const storageKey = buildLocalTranslationCacheStorageKey(language);
    pendingLocalTranslationCachePayload[storageKey] = Object.fromEntries(globalCache);
    localTranslationCachePromises.set(storageKey, Promise.resolve(globalCache));
  }

  const nextDirectory = { ...(directory || {}) };
  delete nextDirectory[site];
  pendingLocalTranslationCachePayload[LOCAL_TRANSLATION_CACHE_DIRECTORY_STORAGE_KEY] = nextDirectory;
  localTranslationCacheDirectoryPromise = Promise.resolve(nextDirectory);
  await scheduleLocalTranslationCacheStorageSave();
}

async function clearActiveAndSessionCachesByLanguage(targetLanguage) {
  const encodedTargetLanguage = encodeURIComponent(targetLanguage || 'unknown');
  for (const [tabId, active] of activeTranslationCaches.entries()) {
    if (!active?.cache) {
      continue;
    }
    let changed = false;
    for (const cacheKey of [...active.cache.keys()]) {
      const segments = String(cacheKey).split(':');
      if (segments[2] === encodedTargetLanguage) {
        active.cache.delete(cacheKey);
        changed = true;
      }
    }
    if (changed) {
      const numericTabId = Number.parseInt(String(tabId), 10);
      if (Number.isFinite(numericTabId)) {
        await saveActiveTranslationSessionCache(numericTabId, active.url, active.cache);
      }
    }
  }

  if (!chrome.storage.session) {
    return;
  }

  const sessionSnapshot = await chrome.storage.session.get(null);
  const sessionEntries = Object.entries(sessionSnapshot || {})
    .filter(([key]) => key.startsWith(SESSION_TRANSLATION_CACHE_STORAGE_PREFIX));
  const updates = {};
  for (const [sessionKey, value] of sessionEntries) {
    const entries = value?.entries;
    if (!entries || typeof entries !== 'object') {
      continue;
    }

    const { filteredEntries, changed } = filterSessionEntriesByLanguage(entries, targetLanguage);
    if (!changed) {
      continue;
    }

    updates[sessionKey] = {
      ...(value || {}),
      entries: filteredEntries
    };
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.session.set(updates);
  }
}

async function clearActiveAndSessionCachesBySite(site) {
  for (const [tabId, active] of activeTranslationCaches.entries()) {
    const activeSite = getTranslationCacheSite(active?.url || '');
    if (activeSite !== site) {
      continue;
    }
    active.cache = new Map();
    activeTranslationCaches.set(tabId, active);
    const numericTabId = Number.parseInt(String(tabId), 10);
    if (Number.isFinite(numericTabId)) {
      await chrome.storage.session?.remove?.(buildSessionTranslationCacheStorageKey(numericTabId));
    }
  }

  if (!chrome.storage.session) {
    return;
  }

  const sessionSnapshot = await chrome.storage.session.get(null);
  const keysToRemove = getSessionCacheKeysBySite(sessionSnapshot, site);
  if (keysToRemove.length > 0) {
    await chrome.storage.session.remove(keysToRemove);
  }
}
