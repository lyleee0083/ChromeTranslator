# Chrome Translator 开发说明

## 每次改动后（必读）

项目开发已结束。此后**每一次**代码改动完成时，必须按顺序执行：

1. **自我审查**：删除与当前功能无关的代码、注释、文件；不保留测试目录/测试脚本；不保留构建残留（`dist/` 仅由 `npm run package` 生成）；不保留旧版迁移/兼容逻辑。
2. **更新本文档**：只写仓库里**已实现**的功能、文件、配置与常量；不写计划、不写未实现能力、不写「不支持 xxx」类说明。
3. **核对打包清单**：新增或删除运行时 `.js` / `.html` 时，同步修改 `scripts/package-extension.mjs` 的 `runtimeFiles`。
4. **打包验证**：执行 `npm run package`，确认 zip 可加载。

---

版本 0.1.0 · Manifest V3 Chrome 扩展 · DeepL API

## 功能

- 整页 DOM 文本翻译（批次、优先级、原文/译文/双语）
- YouTube 字幕翻译（`.ytp-caption-segment` + `captionTracks` 预取）
- 保护词（默认词库 + 用户词库，占位符 masking）
- 多级翻译缓存（页内内存 → session → 本地持久）
- 域名排除、DeepL 密钥与额度/时长/网络并发
- Popup、Options、右键菜单

## 文件

```
manifest.json
background.js
content.js
content.css
translator.js
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
icons/icon16.png, icon48.png, icon128.png
scripts/package-extension.mjs
package.json
.gitignore
DEVELOPMENT.md
```

打包：`npm run package` → `dist/package/ChromeTranslator/`、`dist/ChromeTranslator-0.1.0.zip`

## 模块

| 文件 | 职责 |
| --- | --- |
| `background.js` | 消息队列、缓存、DeepL 调度、右键菜单 |
| `content.js` | 整页扫描翻译、YouTube 字幕叠加 |
| `translator.js` | 缓存查找、DeepL 单条/批请求、并发控制 |
| `deepl-settings.js` | API 密钥、额度、时长、并发、Free/Pro 端点 |
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

## 语言

`zh-CN`（默认）、`en`、`ja`、`ko`、`es`、`fr`、`de` — 见 `language-options.js`

DeepL `target_lang` 映射见 `translator.js` → `DEEPL_TARGET_LANGUAGE_MAP`

## Storage

**sync**：`targetLanguage`、`webpageTranslationEnabled`、`youtubeSubtitleTranslationEnabled`、`excludedTranslationHosts`

**local**：`deeplApiKey` 等（`deepl-settings.js`）、`deeplConcurrencyLimit`（`adaptive`/`1`/`2`/`3`）、`userProtectedTerms`、`localTranslationCache:<lang>`、`localTranslationCacheDirectory`、`sessionTranslationCache:<tabId>`、`autoCacheCleanupEnabled`

## 翻译 `source`

| 值 | 说明 |
| --- | --- |
| `cache` | 缓存命中 |
| `protected` | 全文保护词 |
| `original` | 返回原文 |
| `network` | DeepL 成功 |

`protected`、`original` 不写入持久缓存。

## 常量

| 项 | 值 |
| --- | --- |
| `PROTECTED_TERMS_VERSION` | 4 |
| 翻译任务并发 | 10 |
| DeepL HTTP 并发 | 1–3（Options 可选；自适应失败降 1；额度将尽降 1） |
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
- DeepL 批请求并行、in-flight 去重
- Free 密钥 → `api-free.deepl.com`；Pro → `api.deepl.com`

## 命令

```bash
npm run package
```

## 加载

`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → 源码根目录或 `dist/package/ChromeTranslator/`
