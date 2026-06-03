# Chrome Translator

版本 0.1.7 · Manifest V3 Chrome 扩展 · Google 翻译 + DeepL 润色

## 功能

- 整页 DOM 文本翻译（批次、优先级、原文/译文/双语）
- YouTube 字幕翻译（`.ytp-caption-segment` + `captionTracks` 预取）
- 保护词（默认词库 + 用户词库，占位符 masking）
- 多级翻译缓存（页内内存 → session → 本地持久）
- 域名排除、Google 在线翻译、DeepL 本地缓存润色密钥
- Popup、Options、右键菜单

## 安装

1. 克隆本仓库
2. 打包扩展：

```bash
npm run package
```

3. 打开 `chrome://extensions` → 开启「开发者模式」
4. 「加载已解压的扩展程序」→ 选择 `dist/package/ChromeTranslator/`

在线翻译使用 Google 接口，无需 API Key。若需对**已有本地持久缓存**条目核对润色，可在 **Options** 中填写 DeepL API Key（可选）。密钥与缓存保存在浏览器本地，不会写入本仓库。

## 文件结构

```
manifest.json
background.js
content.bundle.js
content.css
translator.js
google-translate.js
deepl-translate.js
deepl-settings.js
domain-settings.js
language-options.js
translation-cache.js
translation-result-utils.js
translation-residue-utils.js
cache-clear-utils.js
protected-terms.js
protected-terms-defaults.js
webpage-translation.js
youtube-subtitles.js
popup.html / popup.js
options.html / options.js
icons/
package.json
```

打包输出：`dist/package/ChromeTranslator/`、`dist/ChromeTranslator-0.1.7.zip`

## 模块

| 文件 | 职责 |
| --- | --- |
| `background.js` | 消息队列、缓存、翻译调度、右键菜单 |
| `content.js` | 整页扫描翻译、YouTube 字幕叠加（源码；运行时注入 `content.bundle.js`） |
| `translator.js` | 缓存查找、Google 在线翻译、DeepL 润色写回 |
| `google-translate.js` | `clients5.google.com/translate_a/t` 请求与解析 |
| `deepl-translate.js` | DeepL 润色请求（仅配合本地持久缓存） |
| `deepl-settings.js` | DeepL 润色 API 密钥 |
| `domain-settings.js` | 排除域名 |
| `language-options.js` | 目标语言 |
| `protected-terms.js` | 保护词匹配、预编译 protector |
| `protected-terms-defaults.js` | 默认词库 |
| `translation-cache.js` | 持久缓存 |
| `translation-result-utils.js` | 持久缓存写入规则 |
| `translation-residue-utils.js` | 中文目标英文残留检测 |
| `cache-clear-utils.js` | session 缓存过滤 |
| `webpage-translation.js` | 整页文本节点筛选 |
| `youtube-subtitles.js` | caption 解析与叠加层 |
| `popup.js` / `options.js` | 弹窗与设置页 |

## 支持语言

`zh-CN`（默认）、`en`、`ja`、`ko`、`es`、`fr`、`de` — 见 `language-options.js`

Google `tl` 映射见 `google-translate.js`；DeepL `target_lang` 见 `deepl-translate.js`

## Storage

**sync**：`targetLanguage`、`webpageTranslationEnabled`、`youtubeSubtitleTranslationEnabled`、`excludedTranslationHosts`

**local**：`deeplApiKey`（仅润色）、`userProtectedTerms`、`localTranslationCache:<lang>`、`localTranslationCacheDirectory`、`sessionTranslationCache:<tabId>`、`autoCacheCleanupEnabled`

## 翻译 `source`

| 值 | 说明 |
| --- | --- |
| `cache` | 缓存命中 |
| `protected` | 全文保护词 |
| `original` | 返回原文 |
| `network` | Google 在线翻译成功（可能已 DeepL 润色写回缓存） |

`protected`、`original` 不写入持久缓存。

## 常量

| 项 | 值 |
| --- | --- |
| `PROTECTED_TERMS_VERSION` | 4 |
| 翻译任务并发 | 10 |
| Google HTTP 并发 | 1–3（自适应，失败降至 1） |
| 批处理上限 | 20 条 / 4000 字符 |
| 整页空闲扫描 | 250 节点/批 |
| YouTube 预取批 | 20 |
| YouTube 跳转阈值 | 3s |
| YouTube 预取窗口 | +15s / +120s |
| 持久缓存上限 | 5000 条/语言 |

## 性能要点

- 缓存命中跳过保护词正则
- 保护词 `buildMergedTermsProtector` 预编译与缓存
- 整页 DOM 扫描使用 `requestIdleCallback`
- Google 批请求并行、in-flight 去重
- DeepL 仅对已有本地持久缓存条目润色

## 开发

```bash
npm run package
```

维护者与协作流程见 `DEVELOPMENT.md`（其中的「每次改动后（必读）」仅出现在该文件，不会写入本 README）。
