export const YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY = 'youtubeSubtitleTranslationEnabled';
export const DEFAULT_YOUTUBE_SUBTITLE_TRANSLATION_ENABLED = true;
export const YOUTUBE_PLAYBACK_JUMP_THRESHOLD_SECONDS = 3;
export const YOUTUBE_URGENT_PREFETCH_SECONDS = 15;
export const YOUTUBE_NEAR_FUTURE_PREFETCH_SECONDS = 120;

export function isYouTubeWatchPage(urlLike) {
  try {
    const url = new URL(urlLike);
    const hostname = url.hostname.replace(/^www\./, '');

    return (
      (hostname === 'youtube.com' || hostname === 'm.youtube.com') &&
      url.pathname === '/watch'
    );
  } catch {
    return false;
  }
}

export function normalizeCaptionText(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value || '');

  return text.replace(/\s+/g, ' ').trim();
}

export function prepareYoutubeCaptionTextForTranslation(value) {
  const text = normalizeCaptionText(value);
  if (!text) {
    return '';
  }

  return stripLeadingCaptionMetadata(text);
}

export function hasCaptionChanged(previousText, nextText) {
  const normalizedNext = normalizeCaptionText(nextText);

  if (!normalizedNext) {
    return false;
  }

  return normalizeCaptionText(previousText) !== normalizedNext;
}

export function getSubtitleOverlayStyle(captionRect, playerRect) {
  if (!captionRect || !playerRect || playerRect.width <= 0 || playerRect.height <= 0) {
    return {
      leftPercent: 50,
      topPercent: 76,
      widthPercent: 78
    };
  }

  const captionCenterX = captionRect.left + captionRect.width / 2;
  const leftPercent = ((captionCenterX - playerRect.left) / playerRect.width) * 100;
  const topPercent = ((captionRect.top - playerRect.top) / playerRect.height) * 100;
  const widthPercent = Math.min(92, Math.max(24, (captionRect.width / playerRect.width) * 100));

  return {
    leftPercent: clampPercentage(leftPercent),
    topPercent: clampPercentage(topPercent),
    widthPercent
  };
}

function clampPercentage(value) {
  return Math.min(96, Math.max(4, value));
}

function stripLeadingCaptionMetadata(text) {
  const match = text.match(/^([\[【(（][^\]】)）]{1,160}[\]】)）])\s+(.+)$/u);
  if (!match) {
    return text;
  }

  const metadata = match[1];
  const remainder = normalizeCaptionText(match[2]);
  if (!remainder || !isLikelyCaptionMetadata(metadata) || !hasMeaningfulCaptionText(remainder)) {
    return text;
  }

  return remainder;
}

function isLikelyCaptionMetadata(text) {
  return (
    /[/|｜]/u.test(text) ||
    /(?:caption|subtitle|topic|title|scene|music|applause|laughter|sound|sfx|narration)/iu.test(text) ||
    /(?:자막|제목|주제|장면|음악|박수|웃음|소리|효과음|내레이션|타임|끝)/u.test(text)
  );
}

function hasMeaningfulCaptionText(text) {
  const letters = String(text || '').match(/[\p{L}\p{Script=Han}]/gu) || [];
  return letters.length >= 2;
}

export function extractCaptionTracks(pageText) {
  const marker = '"captionTracks":';
  const markerIndex = String(pageText || '').indexOf(marker);
  if (markerIndex === -1) {
    return [];
  }

  const arrayStart = String(pageText).indexOf('[', markerIndex);
  if (arrayStart === -1) {
    return [];
  }

  const arrayText = readBalancedJsonArray(String(pageText), arrayStart);
  if (!arrayText) {
    return [];
  }

  try {
    return JSON.parse(arrayText)
      .filter((track) => track?.baseUrl)
      .map((track) => ({
        baseUrl: track.baseUrl,
        languageCode: track.languageCode || '',
        name: getCaptionTrackName(track)
      }));
  } catch {
    return [];
  }
}

export function parseYoutubeTranscriptXml(xmlText) {
  return [...String(xmlText || '').matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)]
    .map((match) => {
      const attributes = match[1];
      return {
        start: Number(readXmlAttribute(attributes, 'start') || 0),
        duration: Number(readXmlAttribute(attributes, 'dur') || 0),
        text: normalizeCaptionText(decodeXmlText(match[2]))
      };
    })
    .filter((cue) => cue.text);
}

export function findCueAtTime(cues, currentTime) {
  return cues.find((cue) => currentTime >= cue.start && currentTime <= cue.start + cue.duration) || null;
}

export function isYoutubePlaybackJump(previousTime, nextTime, threshold = YOUTUBE_PLAYBACK_JUMP_THRESHOLD_SECONDS) {
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime)) {
    return false;
  }

  return Math.abs(nextTime - previousTime) > threshold;
}

export function getYoutubeCueWindowPriority(cue, currentTime) {
  if (cue.start <= currentTime && cue.start + cue.duration >= currentTime) {
    return 0;
  }

  if (cue.start <= currentTime + 30) {
    return 1;
  }

  return 2;
}

export function getYoutubeCueTextsInWindow(
  cues,
  currentTime,
  windowEndOffsetSeconds,
  prefetchedTexts = new Set(),
  maxTexts = 10
) {
  const windowEnd = currentTime + windowEndOffsetSeconds;
  const texts = cues
    .filter((cue) => (
      cue.start + cue.duration >= currentTime &&
      cue.start <= windowEnd &&
      !prefetchedTexts.has(cue.text)
    ))
    .sort((left, right) => getYoutubeCueWindowPriority(left, currentTime) - getYoutubeCueWindowPriority(right, currentTime))
    .map((cue) => cue.text);

  return [...new Set(texts)].slice(0, maxTexts);
}

function readBalancedJsonArray(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '[') {
      depth += 1;
    } else if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return '';
}

function getCaptionTrackName(track) {
  if (track.name?.simpleText) {
    return track.name.simpleText;
  }

  if (Array.isArray(track.name?.runs)) {
    return track.name.runs.map((run) => run.text || '').join('');
  }

  return track.languageCode || '';
}

function readXmlAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] || '';
}

function decodeXmlText(text) {
  return String(text || '')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
