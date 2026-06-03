export const WEBPAGE_TRANSLATION_STORAGE_KEY = 'webpageTranslationEnabled';
export const DEFAULT_WEBPAGE_TRANSLATION_ENABLED = true;

const BLOCKED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'SVG',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BUTTON',
  'CODE',
  'PRE'
]);

const EXTENSION_UI_SELECTORS = [
  '#chrome-translator-youtube-subtitle'
];

export function isBlockedElement(element) {
  return Boolean(element?.tagName && BLOCKED_TAGS.has(element.tagName));
}

export function isExtensionOwnedElement(element) {
  return Boolean(element?.closest && EXTENSION_UI_SELECTORS.some((selector) => element.closest(selector)));
}

export function getTextCacheKey(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function isWorthTranslating(text) {
  const normalized = getTextCacheKey(text);
  if (normalized.length < 2) {
    return false;
  }

  const meaningfulCharacters = normalized.match(/[\p{L}\p{Script=Han}]/gu) || [];
  if (meaningfulCharacters.length < 2) {
    return false;
  }

  return meaningfulCharacters.length / normalized.length >= 0.35;
}

export function areAdjacentWebpageTextNodes(leftNode, rightNode) {
  if (!leftNode || !rightNode || leftNode.parentElement !== rightNode.parentElement) {
    return false;
  }

  let current = leftNode.nextSibling;
  while (current && current !== rightNode) {
    if (current.nodeType === 3) {
      if (current.nodeValue.trim() !== '') {
        return false;
      }
    } else {
      return false;
    }
    current = current.nextSibling;
  }

  return current === rightNode;
}

export function mergeWebpageTextFragments(texts) {
  return (Array.isArray(texts) ? texts : [])
    .map((text) => String(text || '').trim())
    .filter(Boolean)
    .join(' ');
}

export function isEligibleTextNode(node) {
  const parent = node?.parentElement;
  if (!parent || isBlockedElement(parent) || isExtensionOwnedElement(parent)) {
    return false;
  }

  if (parent.closest?.('script,style,noscript,svg,textarea,input,select,button,code,pre')) {
    return false;
  }

  if (parent.closest?.('.caption-window,[contenteditable="true"]')) {
    return false;
  }

  return isWorthTranslating(node.nodeValue);
}
