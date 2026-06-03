import {
  DEFAULT_EXCLUDED_TRANSLATION_HOSTS,
  EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY,
  isTranslationHostExcluded
} from './domain-settings.js';
import {
  areAdjacentWebpageTextNodes,
  DEFAULT_WEBPAGE_TRANSLATION_ENABLED,
  getTextCacheKey,
  isEligibleTextNode,
  isWorthTranslating,
  mergeWebpageTextFragments,
  WEBPAGE_TRANSLATION_STORAGE_KEY
} from './webpage-translation.js';
import {
  DEFAULT_YOUTUBE_SUBTITLE_TRANSLATION_ENABLED,
  extractCaptionTracks,
  findCueAtTime,
  getYoutubeCueTextsRollingOrder,
  getYoutubeUncachedCueTextsAhead,
  getSubtitleOverlayStyle,
  hasCaptionChanged,
  isYouTubeWatchPage,
  isYoutubePlaybackJump,
  normalizeCaptionText,
  parseYoutubeTranscriptXml,
  prepareYoutubeCaptionTextForTranslation,
  YOUTUBE_ROLLING_PREFETCH_LEAD_SECONDS,
  YOUTUBE_PLAYBACK_JUMP_THRESHOLD_SECONDS,
  YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY
} from './youtube-subtitles.js';

const TRANSLATE_TEXT_MESSAGE = 'TRANSLATE_TEXT';
const TRANSLATE_TEXT_BATCH_MESSAGE = 'TRANSLATE_TEXT_BATCH';
const CANCEL_TRANSLATION_TASKS_MESSAGE = 'CANCEL_TRANSLATION_TASKS';
const RESTORE_WEBPAGE_ORIGINAL_MESSAGE = 'RESTORE_WEBPAGE_ORIGINAL';
const SHOW_WEBPAGE_TRANSLATED_MESSAGE = 'SHOW_WEBPAGE_TRANSLATED';
const SHOW_WEBPAGE_BILINGUAL_MESSAGE = 'SHOW_WEBPAGE_BILINGUAL';
const RETRANSLATE_CURRENT_PAGE_MESSAGE = 'RETRANSLATE_CURRENT_PAGE';
const YOUTUBE_OVERLAY_ID = 'chrome-translator-youtube-subtitle';
const YOUTUBE_HIDDEN_CAPTION_CLASS = 'chrome-translator-hide-youtube-caption';
const WEBPAGE_TRANSLATION_CONCURRENCY = 10;
const WEBPAGE_TRANSLATION_SCAN_DELAYS = [0, 800, 2000, 5000];
const WEBPAGE_TRANSLATION_SCROLL_SCAN_DELAY = 700;
const WEBPAGE_TRANSLATION_MUTATION_SCAN_DELAY = 900;
const WEBPAGE_TRANSLATION_PRIORITY = {
  VIEWPORT: 0,
  NEAR_VIEWPORT: 1,
  BACKGROUND: 2
};
const YOUTUBE_TRANSLATION_PRIORITY = {
  ACTIVE_SUBTITLE: 0,
  NEAR_FUTURE_SUBTITLE: 8
};
const YOUTUBE_PREFETCH_BATCH_SIZE = 48;
const YOUTUBE_PREFETCH_BATCH_PARALLEL = 8;
const YOUTUBE_CUE_TRANSLATION_CACHE_LIMIT = 2000;
const WEBPAGE_TRANSLATION_NEAR_VIEWPORT_MARGIN = 800;
const WEBPAGE_TRANSLATION_BATCH_MAX_ITEMS = 20;
const WEBPAGE_TRANSLATION_BATCH_MAX_CHARS = 4000;
const WEBPAGE_TRANSLATION_BATCH_MAX_SINGLE_TEXT_LENGTH = 1000;
const WEBPAGE_TRANSLATION_PROCESSED_SELECTOR = '[data-chrome-translator-processed="true"]';
const WEBPAGE_IDLE_SCAN_BATCH_SIZE = 250;
const WEBPAGE_IDLE_SCAN_TIMEOUT_MS = 120;
const TRANSLATION_TASK_TYPE_WEBPAGE = 'full-page';
const TRANSLATION_TASK_TYPE_YOUTUBE = 'youtube-subtitle';
let youtubeSubtitleObserver = null;
let youtubeSubtitleEnabled = false;
let translationExcludedForSite = false;
let lastCaptionText = '';
let latestTranslationRequestId = 0;
let youtubePrefetchVideoId = '';
let youtubePrefetchAbortController = null;
let youtubePrefetchActive = false;
let youtubeWindowPrefetchActive = false;
let youtubePrefetchedCues = [];
let youtubeActiveCueText = '';
let youtubeRollingPrefetchController = null;
let youtubePlaybackGeneration = 0;
let youtubeLastSyncedVideoTime = NaN;
let youtubeVideoElement = null;
const youtubeCueTranslationCache = new Map();
let webpageTranslationEnabled = false;
let webpageMutationObserver = null;
let webpageOriginalText = new Map();
let webpageTranslatedText = new Map();
let webpageTranslationCache = new Map();
let webpageQueuedNodes = new Map();
let webpageActiveTranslations = 0;
let webpageRunId = 0;
let webpageDisplayMode = 'translated';
let webpageTranslationStarted = false;
let pageTranslationState = createPageTranslationState();
let webpageScanTimers = new Set();
let webpageScrollScanTimer = null;
let webpageMutationScanTimer = null;
let webpageScrollListenerStarted = false;
let coreListenersStarted = false;
let webpageIdleScanHandle = 0;

chrome.storage.sync.get({
  [YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY]: DEFAULT_YOUTUBE_SUBTITLE_TRANSLATION_ENABLED,
  [WEBPAGE_TRANSLATION_STORAGE_KEY]: DEFAULT_WEBPAGE_TRANSLATION_ENABLED,
  [EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]: DEFAULT_EXCLUDED_TRANSLATION_HOSTS
}).then((stored) => {
  youtubeSubtitleEnabled = Boolean(stored[YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY]);
  webpageTranslationEnabled = Boolean(stored[WEBPAGE_TRANSLATION_STORAGE_KEY]);
  translationExcludedForSite = isTranslationHostExcluded(
    location.href,
    stored[EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]
  );
  syncTranslatorRuntime();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }

  if (changes[YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY]) {
    youtubeSubtitleEnabled = Boolean(changes[YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY].newValue);
    syncTranslatorRuntime();
  }

  if (changes[WEBPAGE_TRANSLATION_STORAGE_KEY]) {
    webpageTranslationEnabled = Boolean(changes[WEBPAGE_TRANSLATION_STORAGE_KEY].newValue);
    syncTranslatorRuntime();
  }

  if (changes[EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY]) {
    translationExcludedForSite = isTranslationHostExcluded(
      location.href,
      changes[EXCLUDED_TRANSLATION_HOSTS_STORAGE_KEY].newValue
    );
    syncTranslatorRuntime();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === RESTORE_WEBPAGE_ORIGINAL_MESSAGE) {
    showOriginalWebpageText();
    return false;
  }

  if (message?.type === SHOW_WEBPAGE_TRANSLATED_MESSAGE) {
    showTranslatedWebpageText();
    return false;
  }

  if (message?.type === SHOW_WEBPAGE_BILINGUAL_MESSAGE) {
    showBilingualWebpageText();
    return false;
  }

  if (message?.type === RETRANSLATE_CURRENT_PAGE_MESSAGE) {
    retranslateCurrentPage();
    return false;
  }

  return false;
});

function syncTranslatorRuntime() {
  if (translationExcludedForSite) {
    stopCoreListeners();
    stopYoutubeSubtitleTranslation();
    stopWebpageTranslation();
    return;
  }

  startCoreListeners();
  syncYoutubeSubtitleObserver();
  syncWebpageTranslation();
}

function startCoreListeners() {
  if (coreListenersStarted) {
    return;
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('yt-navigate-finish', handleYoutubeNavigationFinish);
  coreListenersStarted = true;
}

function stopCoreListeners() {
  if (!coreListenersStarted) {
    return;
  }

  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('yt-navigate-finish', handleYoutubeNavigationFinish);
  coreListenersStarted = false;
}

function syncWebpageTranslation() {
  if (!webpageTranslationEnabled || translationExcludedForSite) {
    stopWebpageTranslation();
    return;
  }

  if (!isPageVisible()) {
    pauseWebpageTranslation();
    return;
  }

  resumePendingWebpageTranslation();
}

function startWebpageTranslation() {
  resetWebpageTranslationStateForNavigation();
  if (
    pageTranslationState.restored ||
    pageTranslationState.translated ||
    pageTranslationState.translating
  ) {
    return;
  }

  webpageRunId += 1;
  webpageDisplayMode = 'translated';
  webpageTranslationStarted = true;
  pageTranslationState.translating = true;
  startWebpageScrollListener();
  startWebpageMutationObserver();
  scheduleWebpageTextScans();
}

function stopWebpageTranslation({ restoreText = true, clearCache = true } = {}) {
  webpageRunId += 1;
  webpageTranslationStarted = false;
  pageTranslationState.translating = false;
  pageTranslationState.translated = false;
  pageTranslationState.restored = restoreText;
  webpageQueuedNodes.clear();
  cancelWebpageIdleScan();
  clearWebpageScanTimers();
  clearWebpageScrollScanTimer();
  clearWebpageMutationScanTimer();
  stopWebpageScrollListener();
  stopWebpageMutationObserver();
  cancelBackgroundTranslationTasks(TRANSLATION_TASK_TYPE_WEBPAGE);

  if (restoreText) {
    restoreOriginalWebpageText();
  } else {
    webpageOriginalText = new Map();
    webpageTranslatedText = new Map();
  }

  if (clearCache) {
    webpageTranslationCache = new Map();
  }
}

function pauseWebpageTranslation() {
  clearWebpageScanTimers();
  clearWebpageScrollScanTimer();
  clearWebpageMutationScanTimer();
  stopWebpageMutationObserver();
}

function resumePendingWebpageTranslation() {
  resetWebpageTranslationStateForNavigation();
  if (!webpageTranslationStarted) {
    startWebpageTranslation();
    return;
  }

  startWebpageScrollListener();
  startWebpageMutationObserver();
  if (pageTranslationState.translating && webpageQueuedNodes.size > 0) {
    processWebpageTranslationQueue();
  }
}

function restartWebpageTranslationScan({ force = false } = {}) {
  resetWebpageTranslationStateForNavigation();
  if (!webpageTranslationEnabled || !webpageTranslationStarted || !isPageVisible() || pageTranslationState.restored) {
    return;
  }

  if (!force && (pageTranslationState.translated || pageTranslationState.translating)) {
    return;
  }

  webpageRunId += 1;
  pageTranslationState.translated = false;
  pageTranslationState.translating = true;
  webpageQueuedNodes.clear();
  scheduleWebpageTextScans();
}

function scheduleWebpageTextScans() {
  clearWebpageScanTimers();

  for (const delay of WEBPAGE_TRANSLATION_SCAN_DELAYS) {
    const timer = setTimeout(() => {
      webpageScanTimers.delete(timer);
      scanWebpageTextNodes();
      processWebpageTranslationQueue();
    }, delay);

    webpageScanTimers.add(timer);
  }
}

function clearWebpageScanTimers() {
  for (const timer of webpageScanTimers) {
    clearTimeout(timer);
  }

  webpageScanTimers.clear();
}

function startWebpageMutationObserver() {
  if (webpageMutationObserver || !document.body || !isPageVisible()) {
    return;
  }

  webpageMutationObserver = new MutationObserver(scheduleWebpageTextScanAfterMutation);
  webpageMutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function stopWebpageMutationObserver() {
  webpageMutationObserver?.disconnect();
  webpageMutationObserver = null;
}

function startWebpageScrollListener() {
  if (webpageScrollListenerStarted) {
    return;
  }

  window.addEventListener('scroll', scheduleWebpageTextScanAfterScroll, { passive: true });
  webpageScrollListenerStarted = true;
}

function stopWebpageScrollListener() {
  if (!webpageScrollListenerStarted) {
    return;
  }

  window.removeEventListener('scroll', scheduleWebpageTextScanAfterScroll);
  webpageScrollListenerStarted = false;
}

function scheduleWebpageTextScanAfterScroll() {
  if (!webpageTranslationEnabled || !webpageTranslationStarted || !isPageVisible()) {
    return;
  }

  clearWebpageScrollScanTimer();
  webpageScrollScanTimer = setTimeout(() => {
    webpageScrollScanTimer = null;
    scanWebpageTextNodes();
    processWebpageTranslationQueue();
  }, WEBPAGE_TRANSLATION_SCROLL_SCAN_DELAY);
}

function clearWebpageScrollScanTimer() {
  if (!webpageScrollScanTimer) {
    return;
  }

  clearTimeout(webpageScrollScanTimer);
  webpageScrollScanTimer = null;
}

function scheduleWebpageTextScanAfterMutation(mutations) {
  if (
    !webpageTranslationEnabled ||
    !webpageTranslationStarted ||
    !isPageVisible() ||
    isOnlyWebpageTranslationMutation(mutations)
  ) {
    return;
  }

  clearWebpageMutationScanTimer();
  webpageMutationScanTimer = setTimeout(() => {
    webpageMutationScanTimer = null;
    scanWebpageTextNodes();
    processWebpageTranslationQueue();
  }, WEBPAGE_TRANSLATION_MUTATION_SCAN_DELAY);
}

function clearWebpageMutationScanTimer() {
  if (!webpageMutationScanTimer) {
    return;
  }

  clearTimeout(webpageMutationScanTimer);
  webpageMutationScanTimer = null;
}

function isOnlyWebpageTranslationMutation(mutations) {
  return mutations.length > 0 && mutations.every((mutation) => {
    const target = mutation.target;
    return target?.nodeType === Node.TEXT_NODE &&
      webpageTranslatedText.get(target) === target.nodeValue;
  });
}

function cancelWebpageIdleScan() {
  if (!webpageIdleScanHandle) {
    return;
  }

  if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(webpageIdleScanHandle);
  } else {
    clearTimeout(webpageIdleScanHandle);
  }
  webpageIdleScanHandle = 0;
}

function scheduleWebpageIdleScan(walker) {
  const runScan = (deadline) => {
    webpageIdleScanHandle = 0;
    if (
      !webpageTranslationEnabled ||
      !webpageTranslationStarted ||
      !isPageVisible() ||
      pageTranslationState.restored
    ) {
      return;
    }

    let processed = 0;
    let done = false;
    while (processed < WEBPAGE_IDLE_SCAN_BATCH_SIZE) {
      const timeRemaining = deadline?.timeRemaining?.();
      if (timeRemaining !== undefined && timeRemaining <= 0) {
        break;
      }
      if (!walker.nextNode()) {
        done = true;
        break;
      }
      collectWebpageTextNode(walker.currentNode);
      processed += 1;
    }

    if (!done) {
      const schedule = typeof requestIdleCallback === 'function'
        ? requestIdleCallback
        : (callback) => setTimeout(() => callback({ timeRemaining: () => 0 }), WEBPAGE_IDLE_SCAN_TIMEOUT_MS);
      webpageIdleScanHandle = schedule(runScan, { timeout: WEBPAGE_IDLE_SCAN_TIMEOUT_MS });
      return;
    }

    updateWebpageTranslationLifecycleState();
    processWebpageTranslationQueue();
  };

  const schedule = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : (callback) => setTimeout(() => callback({ timeRemaining: () => 0 }), 0);
  webpageIdleScanHandle = schedule(runScan, { timeout: WEBPAGE_IDLE_SCAN_TIMEOUT_MS });
}

function collectWebpageTextNode(node) {
  const currentText = node.nodeValue;
  const previousTranslation = webpageTranslatedText.get(node);

  if (previousTranslation && isDisplayedWebpageTranslation(node, currentText)) {
    return;
  }

  if (previousTranslation && currentText !== previousTranslation) {
    webpageTranslatedText.delete(node);
    webpageOriginalText.set(node, currentText);
  } else if (!webpageOriginalText.has(node)) {
    webpageOriginalText.set(node, node.nodeValue);
  }

  enqueueWebpageTextNode(node);
}

function scanWebpageTextNodes() {
  if (
    !webpageTranslationEnabled ||
    !webpageTranslationStarted ||
    !isPageVisible() ||
    !document.body ||
    pageTranslationState.restored
  ) {
    return;
  }

  cancelWebpageIdleScan();
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        return isEligibleWebpageTextNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );

  scheduleWebpageIdleScan(walker);
}

function enqueueWebpageTextNode(node) {
  if (!webpageTranslationEnabled || !webpageTranslationStarted || !isPageVisible() || pageTranslationState.restored) {
    return;
  }

  const originalText = webpageOriginalText.get(node) || node.nodeValue;
  if (!isWorthTranslating(originalText) || node.nodeValue !== originalText) {
    return;
  }

  const priority = getWebpageTextNodePriority(node);
  const existing = webpageQueuedNodes.get(node);
  if (existing && existing.priority <= priority) {
    return;
  }

  webpageQueuedNodes.set(node, {
    node,
    priority,
    createdAt: performance.now()
  });
  pageTranslationState.translated = false;
  pageTranslationState.translating = true;
}

function processWebpageTranslationQueue() {
  if (!webpageTranslationEnabled || !webpageTranslationStarted || !isPageVisible() || pageTranslationState.restored) {
    return;
  }

  while (webpageActiveTranslations < WEBPAGE_TRANSLATION_CONCURRENCY && webpageQueuedNodes.size > 0) {
    const tasks = takeNextWebpageTranslationBatch();
    if (tasks.length === 0) {
      updateWebpageTranslationLifecycleState();
      return;
    }

    translateWebpageTextNodeBatch(tasks, webpageRunId);
  }
}

function takeNextWebpageTranslationBatch() {
  let selectedTask = null;

  for (const task of webpageQueuedNodes.values()) {
    if (
      !selectedTask ||
      task.priority < selectedTask.priority ||
      (task.priority === selectedTask.priority && task.createdAt < selectedTask.createdAt)
    ) {
      selectedTask = task;
    }
  }

  if (selectedTask) {
    webpageQueuedNodes.delete(selectedTask.node);
  }

  if (!selectedTask) {
    return [];
  }

  const batch = [selectedTask];
  let batchChars = getWebpageOriginalText(selectedTask.node).length;
  for (const task of [...webpageQueuedNodes.values()]) {
    if (task.priority !== selectedTask.priority || batch.length >= WEBPAGE_TRANSLATION_BATCH_MAX_ITEMS) {
      continue;
    }

    const originalText = getWebpageOriginalText(task.node);
    const textLength = originalText.length;
    if (
      textLength > WEBPAGE_TRANSLATION_BATCH_MAX_SINGLE_TEXT_LENGTH ||
      batchChars + textLength > WEBPAGE_TRANSLATION_BATCH_MAX_CHARS
    ) {
      continue;
    }

    webpageQueuedNodes.delete(task.node);
    batch.push(task);
    batchChars += textLength;
  }

  return batch;
}

function getWebpageTextNodePriority(node) {
  const rect = node.parentElement?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return WEBPAGE_TRANSLATION_PRIORITY.BACKGROUND;
  }

  if (rect.bottom >= 0 && rect.top <= window.innerHeight) {
    return WEBPAGE_TRANSLATION_PRIORITY.VIEWPORT;
  }

  if (
    rect.bottom >= -WEBPAGE_TRANSLATION_NEAR_VIEWPORT_MARGIN &&
    rect.top <= window.innerHeight + WEBPAGE_TRANSLATION_NEAR_VIEWPORT_MARGIN
  ) {
    return WEBPAGE_TRANSLATION_PRIORITY.NEAR_VIEWPORT;
  }

  return WEBPAGE_TRANSLATION_PRIORITY.BACKGROUND;
}

async function translateWebpageTextNodeBatch(tasks, runId) {
  webpageActiveTranslations += 1;
  const pendingTasks = [];

  try {
    for (const task of tasks) {
      const originalText = getWebpageOriginalText(task.node);
      const cacheKey = getTextCacheKey(originalText);
      const translatedText = webpageTranslationCache.get(cacheKey);
      if (translatedText) {
        applyWebpageTranslationIfCurrent(task.node, originalText, translatedText, runId);
      } else {
        pendingTasks.push({ ...task, originalText, cacheKey });
      }
    }

    if (pendingTasks.length === 0) {
      return;
    }

    const pendingGroups = consolidateWebpagePendingTasks(pendingTasks);
    const translations = await chrome.runtime.sendMessage({
      type: TRANSLATE_TEXT_BATCH_MESSAGE,
      taskType: TRANSLATION_TASK_TYPE_WEBPAGE,
      sourceTexts: pendingGroups.map((group) => group.originalText),
      priority: pendingGroups[0]?.priority ?? WEBPAGE_TRANSLATION_PRIORITY.BACKGROUND
    });

    for (let index = 0; index < pendingGroups.length; index += 1) {
      const group = pendingGroups[index];
      const translation = Array.isArray(translations) ? translations[index] : null;
      const translatedText = normalizeChineseTranslationFallback(translation?.translatedText);
      if (translation?.source === 'original' || translation?.source === 'protected') {
        continue;
      }

      if (translatedText) {
        setWebpageTranslationCacheEntry(group.cacheKey, translatedText);
        applyWebpageTranslationGroup(group, translatedText, runId);
      }
    }
  } catch {
  } finally {
    webpageActiveTranslations -= 1;
    updateWebpageTranslationLifecycleState();
    processWebpageTranslationQueue();
  }
}

function consolidateWebpagePendingTasks(tasks) {
  const groups = [];

  for (const task of tasks) {
    const lastGroup = groups[groups.length - 1];
    const mergedText = mergeWebpageTextFragments([lastGroup?.originalText, task.originalText]);
    if (
      lastGroup &&
      lastGroup.nodes.length < 4 &&
      mergedText.length <= 240 &&
      areAdjacentWebpageTextNodes(lastGroup.nodes[lastGroup.nodes.length - 1], task.node)
    ) {
      lastGroup.nodes.push(task.node);
      lastGroup.originalText = mergedText;
      lastGroup.cacheKey = getTextCacheKey(mergedText);
      continue;
    }

    groups.push({
      nodes: [task.node],
      originalText: task.originalText,
      cacheKey: task.cacheKey,
      priority: task.priority
    });
  }

  return groups;
}

function applyWebpageTranslationGroup(group, translatedText, runId) {
  if (!group?.nodes?.length) {
    return;
  }

  if (group.nodes.length === 1) {
    applyWebpageTranslationIfCurrent(group.nodes[0], group.originalText, translatedText, runId);
    return;
  }

  const fragmentsValid = group.nodes.every((node) => {
    const fragmentText = getWebpageOriginalText(node);
    return node.isConnected && (node.nodeValue === fragmentText || node.nodeValue.trim() === '');
  });
  if (!fragmentsValid) {
    return;
  }

  const firstNode = group.nodes[0];
  const firstFragment = getWebpageOriginalText(firstNode);
  if (
    runId === webpageRunId &&
    webpageTranslationEnabled &&
    webpageTranslationStarted &&
    translatedText &&
    firstNode.isConnected &&
    canReplaceWebpageTextNode(firstNode, firstFragment)
  ) {
    const targetNode = ensureWebpageTranslationProcessedNode(firstNode, group.originalText, translatedText);
    if (targetNode) {
      firstNode.nodeValue = formatWebpageDisplayText(group.originalText, translatedText);
      webpageTranslatedText.set(targetNode, translatedText);
      if (targetNode !== firstNode) {
        webpageOriginalText.delete(firstNode);
        webpageOriginalText.set(targetNode, group.originalText);
      }
      updateWebpageTranslationProcessedData(targetNode, group.originalText, translatedText);
    }
  }

  for (let index = 1; index < group.nodes.length; index += 1) {
    const node = group.nodes[index];
    const fragmentText = getWebpageOriginalText(node);
    if (canReplaceWebpageTextNode(node, fragmentText)) {
      node.nodeValue = '';
    }
  }
}

function applyWebpageTranslationIfCurrent(node, originalText, translatedText, runId) {
  if (
    runId === webpageRunId &&
    webpageTranslationEnabled &&
    webpageTranslationStarted &&
    translatedText &&
    node.isConnected &&
    canReplaceWebpageTextNode(node, originalText)
  ) {
    const targetNode = ensureWebpageTranslationProcessedNode(node, originalText, translatedText);
    if (!targetNode) {
      return;
    }

    node.nodeValue = formatWebpageDisplayText(originalText, translatedText);
    webpageTranslatedText.set(targetNode, translatedText);
    if (targetNode !== node) {
      webpageOriginalText.delete(node);
      webpageOriginalText.set(targetNode, originalText);
    }
    updateWebpageTranslationProcessedData(targetNode, originalText, translatedText);
  }
}

function canReplaceWebpageTextNode(node, originalText) {
  return node.nodeValue === originalText || isDisplayedWebpageTranslation(node, node.nodeValue);
}

function isDisplayedWebpageTranslation(node, text) {
  const originalText = webpageOriginalText.get(node) || '';
  const translatedText = webpageTranslatedText.get(node) || '';
  return text === translatedText || text === formatBilingualWebpageText(originalText, translatedText);
}

function getWebpageOriginalText(node) {
  return webpageOriginalText.get(node) || node.nodeValue;
}

function formatWebpageDisplayText(originalText, translatedText) {
  if (webpageDisplayMode === 'original') {
    return originalText;
  }

  if (webpageDisplayMode === 'bilingual') {
    return formatBilingualWebpageText(originalText, translatedText);
  }

  return translatedText;
}

function formatBilingualWebpageText(originalText, translatedText) {
  return `${originalText}\n${translatedText}`;
}

function restoreOriginalWebpageText({ clearState = true } = {}) {
  for (const [node, originalText] of webpageOriginalText.entries()) {
    if (node.isConnected) {
      node.nodeValue = originalText;
      if (clearState) {
        unwrapWebpageTranslationProcessedNode(node);
      } else {
        updateWebpageTranslationProcessedData(node, originalText, webpageTranslatedText.get(node) || '');
      }
    }
  }
  if (clearState) {
    webpageOriginalText = new Map();
    webpageTranslatedText = new Map();
  }
}

function showOriginalWebpageText() {
  webpageDisplayMode = 'original';
  webpageRunId += 1;
  pageTranslationState.translating = false;
  pageTranslationState.translated = false;
  pageTranslationState.restored = true;
  webpageQueuedNodes.clear();
  clearWebpageScanTimers();
  clearWebpageScrollScanTimer();
  clearWebpageMutationScanTimer();
  stopWebpageMutationObserver();
  stopWebpageScrollListener();
  cancelBackgroundTranslationTasks(TRANSLATION_TASK_TYPE_WEBPAGE);
  restoreOriginalWebpageText({ clearState: false });
}

function showTranslatedWebpageText() {
  webpageDisplayMode = 'translated';
  pageTranslationState.restored = false;
  pageTranslationState.translated = webpageTranslatedText.size > 0;
  startWebpageScrollListener();
  startWebpageMutationObserver();
  redrawStoredWebpageTranslations();
  restartWebpageTranslationScan({ force: webpageTranslatedText.size === 0 });
}

function showBilingualWebpageText() {
  webpageDisplayMode = 'bilingual';
  pageTranslationState.restored = false;
  pageTranslationState.translated = webpageTranslatedText.size > 0;
  startWebpageScrollListener();
  startWebpageMutationObserver();
  redrawStoredWebpageTranslations();
  restartWebpageTranslationScan({ force: webpageTranslatedText.size === 0 });
}

function retranslateCurrentPage() {
  if (!webpageTranslationEnabled || translationExcludedForSite) {
    return;
  }
  webpageTranslationCache = new Map();
  webpageQueuedNodes.clear();
  webpageTranslatedText = new Map();
  pageTranslationState.restored = false;
  pageTranslationState.translated = false;
  pageTranslationState.translating = true;
  clearWebpageScanTimers();
  clearWebpageScrollScanTimer();
  clearWebpageMutationScanTimer();
  restoreOriginalWebpageText({ clearState: false });
  startWebpageScrollListener();
  startWebpageMutationObserver();
  restartWebpageTranslationScan({ force: true });
}

function redrawStoredWebpageTranslations() {
  webpageRunId += 1;
  for (const [node, translatedText] of webpageTranslatedText.entries()) {
    const originalText = webpageOriginalText.get(node);
    if (node.isConnected && originalText) {
      node.nodeValue = formatWebpageDisplayText(originalText, translatedText);
      updateWebpageTranslationProcessedData(node, originalText, translatedText);
    }
  }
}

function ensureWebpageTranslationProcessedNode(node, originalText, translatedText) {
  if (!node?.isConnected) {
    return null;
  }

  const existingWrapper = node.parentElement?.closest?.(WEBPAGE_TRANSLATION_PROCESSED_SELECTOR);
  if (existingWrapper) {
    updateWebpageTranslationProcessedData(node, originalText, translatedText);
    return node;
  }

  const wrapper = document.createElement('span');
  wrapper.setAttribute('data-chrome-translator-processed', 'true');
  wrapper.className = 'chrome-translator-translated-text';
  updateWebpageTranslationProcessedElementData(wrapper, originalText, translatedText);
  node.parentNode?.insertBefore(wrapper, node);
  wrapper.appendChild(node);
  return node;
}

function updateWebpageTranslationProcessedData(node, originalText, translatedText) {
  const wrapper = node?.parentElement?.closest?.(WEBPAGE_TRANSLATION_PROCESSED_SELECTOR);
  if (wrapper) {
    updateWebpageTranslationProcessedElementData(wrapper, originalText, translatedText);
  }
}

function updateWebpageTranslationProcessedElementData(element, originalText, translatedText) {
  element.setAttribute('data-original-text', originalText);
  element.setAttribute('data-translated-text', translatedText);
}

function unwrapWebpageTranslationProcessedNode(node) {
  const wrapper = node?.parentElement?.closest?.(WEBPAGE_TRANSLATION_PROCESSED_SELECTOR);
  if (!wrapper || wrapper.parentNode !== node.parentNode?.parentNode) {
    return;
  }

  wrapper.parentNode.insertBefore(node, wrapper);
  wrapper.remove();
}

function createPageTranslationState() {
  return {
    url: location.href,
    translated: false,
    translating: false,
    restored: false
  };
}

function resetWebpageTranslationStateForNavigation() {
  if (pageTranslationState.url === location.href) {
    return;
  }

  cancelBackgroundTranslationTasks(TRANSLATION_TASK_TYPE_WEBPAGE);
  pageTranslationState = createPageTranslationState();
  webpageOriginalText = new Map();
  webpageTranslatedText = new Map();
  webpageTranslationCache = new Map();
  webpageQueuedNodes.clear();
  webpageRunId += 1;
}

function cancelBackgroundTranslationTasks(taskType, options = {}) {
  chrome.runtime.sendMessage({
    type: CANCEL_TRANSLATION_TASKS_MESSAGE,
    taskType,
    maxPriority: options.maxPriority
  }).catch(() => {
  });
}

function updateWebpageTranslationLifecycleState() {
  if (webpageQueuedNodes.size > 0 || webpageActiveTranslations > 0) {
    pageTranslationState.translating = true;
    pageTranslationState.translated = false;
    return;
  }

  pageTranslationState.translating = false;
  pageTranslationState.translated = webpageTranslatedText.size > 0 && !pageTranslationState.restored;
}

function setWebpageTranslationCacheEntry(cacheKey, translatedText) {
  if (webpageTranslationCache.has(cacheKey)) {
    webpageTranslationCache.delete(cacheKey);
  }

  webpageTranslationCache.set(cacheKey, translatedText);
}

function isEligibleWebpageTextNode(node) {
  if (isAlreadyTranslatedWebpageNode(node)) {
    return false;
  }

  return isEligibleTextNode(node);
}

function isAlreadyTranslatedWebpageNode(node) {
  return Boolean(node?.parentElement?.closest?.(WEBPAGE_TRANSLATION_PROCESSED_SELECTOR));
}

function normalizeChineseTranslationFallback(text) {
  return String(text || '')
    .replace(/ㅋ{2,}/g, (match) => '哈'.repeat(Math.min(match.length, 6)))
    .replace(/ㅎ{2,}/g, (match) => '哈'.repeat(Math.min(match.length, 6)))
    .replace(/[ㅠㅜ]{2,}/g, (match) => '呜'.repeat(Math.min(match.length, 6)))
    .replace(/ㅣ/g, '|');
}

function handleYoutubeNavigationFinish() {
  syncYoutubeSubtitleObserver();
  restartWebpageTranslationScan();
}

function handleVisibilityChange() {
  syncYoutubeSubtitleObserver();
  syncWebpageTranslation();
}

function syncYoutubeSubtitleObserver() {
  if (
    !youtubeSubtitleEnabled ||
    translationExcludedForSite ||
    !isYouTubeWatchPage(location.href) ||
    !isPageVisible()
  ) {
    stopYoutubeSubtitleTranslation();
    return;
  }

  startYoutubeSubtitleTranslation();
}

function startYoutubeSubtitleTranslation() {
  if (!youtubeSubtitleObserver) {
    youtubeSubtitleObserver = new MutationObserver(handleYoutubeCaptionMutation);
    youtubeSubtitleObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  handleYoutubeCaptionMutation();
  prefetchYoutubeSubtitleTranslations();
  bindYoutubeVideoTimeSync();
}

function stopYoutubeSubtitleTranslation() {
  youtubeSubtitleObserver?.disconnect();
  youtubeSubtitleObserver = null;
  youtubePrefetchAbortController?.abort();
  youtubePrefetchAbortController = null;
  youtubePrefetchActive = false;
  youtubeWindowPrefetchActive = false;
  youtubePrefetchVideoId = '';
  youtubePrefetchedCues = [];
  youtubeActiveCueText = '';
  youtubeCueTranslationCache.clear();
  youtubeRollingPrefetchController?.abort();
  youtubeRollingPrefetchController = null;
  youtubePlaybackGeneration += 1;
  youtubeLastSyncedVideoTime = NaN;
  cancelBackgroundTranslationTasks(TRANSLATION_TASK_TYPE_YOUTUBE);
  unbindYoutubeVideoTimeSync();
  lastCaptionText = '';
  latestTranslationRequestId += 1;
  removeYoutubeSubtitleOverlay();
  showOriginalYoutubeCaptions();
}

function handleYoutubeCaptionMutation() {
  if (
    !youtubeSubtitleEnabled ||
    translationExcludedForSite ||
    !isYouTubeWatchPage(location.href) ||
    !isPageVisible()
  ) {
    stopYoutubeSubtitleTranslation();
    return;
  }

  const captionText = getCurrentYoutubeCaptionText();
  const textForTranslation = prepareYoutubeCaptionTextForTranslation(captionText);
  if (youtubePrefetchedCues.length > 0) {
    return;
  }

  if (!hasCaptionChanged(lastCaptionText, textForTranslation)) {
    if (!textForTranslation) {
      clearYoutubeSubtitleDisplay();
    }
    return;
  }

  if (!textForTranslation) {
    clearYoutubeSubtitleDisplay();
    lastCaptionText = '';
    return;
  }

  lastCaptionText = normalizeCaptionText(textForTranslation);
  presentYoutubeSubtitlePending();
  translateYoutubeCaption(lastCaptionText);
}

function getYoutubeCueTranslation(sourceText) {
  return youtubeCueTranslationCache.get(sourceText) || '';
}

function rememberYoutubeCueTranslation(sourceText, translatedText) {
  const source = String(sourceText || '').trim();
  const translated = String(translatedText || '').trim();
  if (!source || !translated) {
    return;
  }

  if (youtubeCueTranslationCache.size >= YOUTUBE_CUE_TRANSLATION_CACHE_LIMIT) {
    const oldestKey = youtubeCueTranslationCache.keys().next().value;
    if (oldestKey) {
      youtubeCueTranslationCache.delete(oldestKey);
    }
  }

  youtubeCueTranslationCache.set(source, translated);
}

function clearYoutubeSubtitleDisplay() {
  youtubeActiveCueText = '';
  removeYoutubeSubtitleOverlay();
  showOriginalYoutubeCaptions();
}

function tryRenderCachedYoutubeSubtitle(sourceText) {
  const cachedTranslation = getYoutubeCueTranslation(sourceText);
  if (!cachedTranslation) {
    return false;
  }

  hideOriginalYoutubeCaptions();
  renderYoutubeSubtitleOverlay(normalizeChineseTranslationFallback(cachedTranslation));
  return true;
}

function presentYoutubeSubtitlePending() {
  hideOriginalYoutubeCaptions();
  removeYoutubeSubtitleOverlay();
}

function reconcileYoutubeSubtitleOverlay(expectedCaptionText) {
  if (!youtubeSubtitleEnabled || !isPageVisible()) {
    clearYoutubeSubtitleDisplay();
    return;
  }

  if (youtubePrefetchedCues.length > 0 && youtubeVideoElement) {
    const cue = findCueAtTime(youtubePrefetchedCues, youtubeVideoElement.currentTime);
    if (!cue) {
      clearYoutubeSubtitleDisplay();
      return;
    }

    const activeText = prepareYoutubeCaptionTextForTranslation(cue.text);
    if (!activeText) {
      clearYoutubeSubtitleDisplay();
      return;
    }

    if (activeText !== expectedCaptionText) {
      removeYoutubeSubtitleOverlay();
      showOriginalYoutubeCaptions();
      return;
    }

    if (tryRenderCachedYoutubeSubtitle(activeText)) {
      return;
    }

    presentYoutubeSubtitlePending();
    return;
  }

  if (!expectedCaptionText || expectedCaptionText !== youtubeActiveCueText) {
    removeYoutubeSubtitleOverlay();
    showOriginalYoutubeCaptions();
  }
}

async function translateYoutubeCaption(captionText, playbackGeneration = youtubePlaybackGeneration) {
  const requestId = latestTranslationRequestId + 1;
  latestTranslationRequestId = requestId;
  cancelBackgroundTranslationTasks(TRANSLATION_TASK_TYPE_YOUTUBE, {
    maxPriority: YOUTUBE_TRANSLATION_PRIORITY.ACTIVE_SUBTITLE
  });

  if (tryRenderCachedYoutubeSubtitle(captionText)) {
    return;
  }

  try {
    const translation = await chrome.runtime.sendMessage({
      type: TRANSLATE_TEXT_MESSAGE,
      taskType: TRANSLATION_TASK_TYPE_YOUTUBE,
      sourceText: captionText,
      priority: YOUTUBE_TRANSLATION_PRIORITY.ACTIVE_SUBTITLE
    });

    if (
      requestId !== latestTranslationRequestId ||
      playbackGeneration !== youtubePlaybackGeneration
    ) {
      reconcileYoutubeSubtitleOverlay(captionText);
      return;
    }

    if (
      !translation?.translatedText ||
      translation.source === 'original' ||
      translation.source === 'protected'
    ) {
      clearYoutubeSubtitleDisplay();
      return;
    }

    rememberYoutubeCueTranslation(captionText, translation.translatedText);
    hideOriginalYoutubeCaptions();
    renderYoutubeSubtitleOverlay(normalizeChineseTranslationFallback(translation.translatedText));
  } catch {
    if (requestId === latestTranslationRequestId && playbackGeneration === youtubePlaybackGeneration) {
      clearYoutubeSubtitleDisplay();
    }
  }
}

async function prefetchYoutubeSubtitleTranslations() {
  const videoId = new URL(location.href).searchParams.get('v') || '';
  if (!videoId || !isPageVisible() || youtubePrefetchVideoId === videoId || youtubePrefetchActive) {
    return;
  }

  youtubePrefetchVideoId = videoId;
  youtubePrefetchActive = true;
  youtubePrefetchAbortController?.abort();
  youtubePrefetchAbortController = new AbortController();

  try {
    const tracks = extractCaptionTracks(document.documentElement.innerHTML);
    const track = chooseCaptionTrack(tracks);
    if (!track?.baseUrl) {
      return;
    }

    const response = await fetch(track.baseUrl, {
      credentials: 'include',
      signal: youtubePrefetchAbortController.signal
    });
    if (!response.ok) {
      return;
    }

    const cues = parseYoutubeTranscriptXml(await response.text())
      .map((cue) => ({
        ...cue,
        text: prepareYoutubeCaptionTextForTranslation(cue.text)
      }))
      .filter((cue) => cue.text);
    youtubePrefetchedCues = cues;
    youtubeActiveCueText = '';
    bindYoutubeVideoTimeSync();
    const currentTime = youtubeVideoElement?.currentTime || 0;
    restartYoutubeRollingPrefetch(currentTime);
    refreshYoutubeSubtitleAtCurrentTime();
  } catch {
  } finally {
    youtubePrefetchActive = false;
  }
}

async function pretranslateYoutubeCaptionTexts(texts, signal) {
  const batches = [];
  for (let index = 0; index < texts.length; index += YOUTUBE_PREFETCH_BATCH_SIZE) {
    batches.push(texts.slice(index, index + YOUTUBE_PREFETCH_BATCH_SIZE));
  }
  if (batches.length === 0) {
    return;
  }

  try {
    youtubeWindowPrefetchActive = true;
    await runYoutubePrefetchBatches(batches, signal);
  } finally {
    youtubeWindowPrefetchActive = false;
  }
}

async function runYoutubePrefetchBatches(batches, signal) {
  let nextBatchIndex = 0;
  const workerCount = Math.min(YOUTUBE_PREFETCH_BATCH_PARALLEL, batches.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextBatchIndex < batches.length) {
      if (signal.aborted || !youtubeSubtitleEnabled || !isPageVisible()) {
        return;
      }

      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      const batch = batches[batchIndex];
      const uncachedTexts = batch.filter((text) => !youtubeCueTranslationCache.has(text));
      if (uncachedTexts.length === 0) {
        continue;
      }

      const translations = await chrome.runtime.sendMessage({
        type: TRANSLATE_TEXT_BATCH_MESSAGE,
        taskType: TRANSLATION_TASK_TYPE_YOUTUBE,
        sourceTexts: uncachedTexts,
        priority: YOUTUBE_TRANSLATION_PRIORITY.NEAR_FUTURE_SUBTITLE,
        cacheOnly: false
      });

      if (!Array.isArray(translations)) {
        continue;
      }

      translations.forEach((translation) => {
        if (
          translation?.sourceText &&
          translation?.translatedText &&
          translation.source !== 'original' &&
          translation.source !== 'protected'
        ) {
          rememberYoutubeCueTranslation(translation.sourceText, translation.translatedText);
        }
      });
    }
  }));
}

function restartYoutubeRollingPrefetch(currentTime) {
  if (!youtubeSubtitleEnabled || !isPageVisible() || !youtubePrefetchedCues.length) {
    return;
  }

  youtubeRollingPrefetchController?.abort();
  youtubeRollingPrefetchController = new AbortController();
  const signal = youtubeRollingPrefetchController.signal;
  const orderedTexts = getYoutubeCueTextsRollingOrder(
    youtubePrefetchedCues,
    currentTime,
    new Set([...youtubeCueTranslationCache.keys()])
  );

  if (orderedTexts.length === 0) {
    return;
  }

  void pretranslateYoutubeCaptionTexts(orderedTexts, signal);
}

function maybeKickYoutubeRollingPrefetch(currentTime) {
  if (
    youtubeWindowPrefetchActive ||
    !youtubeSubtitleEnabled ||
    !isPageVisible() ||
    !youtubePrefetchedCues.length
  ) {
    return;
  }

  const uncachedAhead = getYoutubeUncachedCueTextsAhead(
    youtubePrefetchedCues,
    currentTime,
    YOUTUBE_ROLLING_PREFETCH_LEAD_SECONDS,
    (text) => youtubeCueTranslationCache.has(text)
  );
  if (uncachedAhead.length === 0) {
    return;
  }

  restartYoutubeRollingPrefetch(currentTime);
}

function handleYoutubePlaybackPositionChanged() {
  if (!youtubeSubtitleEnabled || !isPageVisible() || !youtubeVideoElement) {
    return;
  }

  youtubePlaybackGeneration += 1;
  latestTranslationRequestId += 1;
  cancelBackgroundTranslationTasks(TRANSLATION_TASK_TYPE_YOUTUBE);
  youtubeLastSyncedVideoTime = youtubeVideoElement.currentTime;
  restartYoutubeRollingPrefetch(youtubeVideoElement.currentTime);
  refreshYoutubeSubtitleAtCurrentTime();
}

function handleYoutubeVideoTimeUpdate() {
  if (!youtubeSubtitleEnabled || !isPageVisible() || !youtubeVideoElement) {
    return;
  }

  const currentTime = youtubeVideoElement.currentTime;
  if (isYoutubePlaybackJump(youtubeLastSyncedVideoTime, currentTime)) {
    handleYoutubePlaybackPositionChanged();
    return;
  }

  youtubeLastSyncedVideoTime = currentTime;
  refreshYoutubeSubtitleAtCurrentTime();
  maybeKickYoutubeRollingPrefetch(currentTime);
}

function handleYoutubeVideoPlayResume() {
  if (!youtubeSubtitleEnabled || !isPageVisible() || !youtubeVideoElement) {
    return;
  }

  if (!Number.isFinite(youtubeLastSyncedVideoTime)) {
    handleYoutubePlaybackPositionChanged();
    return;
  }

  if (isYoutubePlaybackJump(youtubeLastSyncedVideoTime, youtubeVideoElement.currentTime)) {
    handleYoutubePlaybackPositionChanged();
  }
}

function chooseCaptionTrack(tracks) {
  return tracks.find((track) => track.languageCode === 'en') ||
    tracks.find((track) => track.languageCode && !track.languageCode.startsWith('a.')) ||
    tracks[0];
}

function bindYoutubeVideoTimeSync() {
  const video = document.querySelector('video');
  if (!video || youtubeVideoElement === video) {
    return;
  }

  unbindYoutubeVideoTimeSync();
  youtubeVideoElement = video;
  youtubeVideoElement.addEventListener('loadedmetadata', handleYoutubePlaybackPositionChanged);
  youtubeVideoElement.addEventListener('play', handleYoutubeVideoPlayResume);
  youtubeVideoElement.addEventListener('timeupdate', handleYoutubeVideoTimeUpdate);
  youtubeVideoElement.addEventListener('seeked', handleYoutubePlaybackPositionChanged);
}

function unbindYoutubeVideoTimeSync() {
  if (!youtubeVideoElement) {
    return;
  }

  youtubeVideoElement.removeEventListener('loadedmetadata', handleYoutubePlaybackPositionChanged);
  youtubeVideoElement.removeEventListener('play', handleYoutubeVideoPlayResume);
  youtubeVideoElement.removeEventListener('timeupdate', handleYoutubeVideoTimeUpdate);
  youtubeVideoElement.removeEventListener('seeked', handleYoutubePlaybackPositionChanged);
  youtubeVideoElement = null;
}

function refreshYoutubeSubtitleAtCurrentTime() {
  if (!youtubeSubtitleEnabled || !isPageVisible() || youtubePrefetchedCues.length === 0 || !youtubeVideoElement) {
    return;
  }

  const currentTime = youtubeVideoElement.currentTime;
  const cue = findCueAtTime(youtubePrefetchedCues, currentTime);
  if (!cue) {
    clearYoutubeSubtitleDisplay();
    return;
  }

  const textForTranslation = prepareYoutubeCaptionTextForTranslation(cue.text);
  if (!textForTranslation) {
    clearYoutubeSubtitleDisplay();
    return;
  }

  if (textForTranslation === youtubeActiveCueText) {
    tryRenderCachedYoutubeSubtitle(textForTranslation);
    return;
  }

  youtubeActiveCueText = textForTranslation;
  if (tryRenderCachedYoutubeSubtitle(textForTranslation)) {
    return;
  }

  presentYoutubeSubtitlePending();
  translateYoutubeCaption(textForTranslation, youtubePlaybackGeneration);
}

function getCurrentYoutubeCaptionText() {
  const segments = [...document.querySelectorAll('.ytp-caption-segment')]
    .filter((segment) => isElementVisible(segment))
    .map((segment) => segment.textContent || '');

  return normalizeCaptionText(segments);
}

function renderYoutubeSubtitleOverlay(text) {
  const player = document.querySelector('#movie_player') || document.querySelector('.html5-video-player');
  if (!player) {
    return;
  }

  let overlay = document.getElementById(YOUTUBE_OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = YOUTUBE_OVERLAY_ID;
    overlay.setAttribute('aria-live', 'polite');
    player.appendChild(overlay);
  }

  overlay.textContent = text;
  positionYoutubeSubtitleOverlay(overlay, player);
}

function removeYoutubeSubtitleOverlay() {
  const overlay = document.getElementById(YOUTUBE_OVERLAY_ID);
  if (!overlay) {
    return;
  }
  overlay.remove();
}

function hideOriginalYoutubeCaptions() {
  for (const windowElement of getYoutubeCaptionWindows()) {
    windowElement.classList.add(YOUTUBE_HIDDEN_CAPTION_CLASS);
  }
}

function showOriginalYoutubeCaptions() {
  for (const windowElement of document.querySelectorAll(`.${YOUTUBE_HIDDEN_CAPTION_CLASS}`)) {
    windowElement.classList.remove(YOUTUBE_HIDDEN_CAPTION_CLASS);
  }
}

function positionYoutubeSubtitleOverlay(overlay, player) {
  const captionWindow = getVisibleYoutubeCaptionWindow();
  const captionRect = captionWindow?.getBoundingClientRect();
  const playerRect = player.getBoundingClientRect();
  const style = getSubtitleOverlayStyle(captionRect, playerRect);

  overlay.style.left = `${style.leftPercent}%`;
  overlay.style.top = `${style.topPercent}%`;
  overlay.style.width = `${style.widthPercent}%`;
}

function getVisibleYoutubeCaptionWindow() {
  return getYoutubeCaptionWindows().find((windowElement) => isElementVisible(windowElement));
}

function getYoutubeCaptionWindows() {
  return [...document.querySelectorAll('.caption-window')];
}

function isElementVisible(element) {
  const rect = element.getBoundingClientRect();

  return rect.width > 0 && rect.height > 0;
}

function isPageVisible() {
  return document.visibilityState === 'visible';
}
