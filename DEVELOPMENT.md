# Chrome Translator 开发说明

## 每次改动后（必读）

项目开发已结束。此后**每一次**代码改动完成时，必须按顺序执行：

1. **改动范围**：只修改本仓库根目录（当前工作区路径）下的本地文件；不修改仓库外路径，不把改动散落到未纳入本仓库的路径。
2. **变更记录与版本**：在 `CHANGLOG.md` 追加一节：`## x.y.z` 下一行写**一行标题**（勿以 `-` 开头），再写 `-` 条目列表。每完成一次改动补丁位 +1，并同步 `manifest.json`、`package.json` 的 `version`。Git **提交标题**为 `x.y.z 标题`（由 `CHANGLOG.md` 生成），正文为条目列表；`git push` 不再单独写说明。
3. **Git 提交**：先写好 `CHANGLOG.md` 再提交。首次在本机克隆后执行一次 `npm run install-hooks`；之后用 `git commit`（自动填入说明）或 `npm run commit`（直接用说明提交，可跟 `-- path` 等参数）。
4. **自我审查**：删除与当前功能无关的代码、注释、文件；不保留测试目录/测试脚本；不保留构建残留（`dist/` 仅由 `npm run package` 生成）；不保留旧版迁移/兼容逻辑。
5. **更新本文档**：只写仓库里**已实现**的功能、文件、配置与常量；不写计划、不写未实现能力、不写「不支持 xxx」类说明。
6. **内容脚本打包**：修改 `content.js` 或其依赖后，`npm run package` / `npm run sync-install` 会自动执行 `npm run build:content`，生成 `content.bundle.js`（manifest 注入此文件，不用 ES module）。
7. **核对打包清单**：新增或删除运行时 `.js` / `.html` 时，同步修改 `scripts/extension-runtime-files.mjs` 的 `RUNTIME_FILES`。
8. **打包验证**：执行 `npm run package`，确认 zip 可加载。
9. **同步 Chrome 安装目录**：执行 `npm run sync-install`，将运行时文件覆盖到 `D:\Chrome Translator`（本机已解压扩展目录）；在 `chrome://extensions` 点重新加载。此步骤为部署动作，**不要**写入 `CHANGLOG.md`。

---

版本 0.1.5 · Manifest V3 Chrome 扩展 · DeepL API

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
content.js              # 源码；运行时注入 content.bundle.js
content.bundle.js       # build:content 生成
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
scripts/bundle-content-script.mjs
scripts/extension-runtime-files.mjs
scripts/package-extension.mjs
scripts/sync-install-directory.mjs
scripts/changelog-commit-message.mjs
scripts/prepare-commit-msg.mjs
scripts/git-commit-from-changelog.mjs
scripts/install-git-hooks.mjs
.githooks/prepare-commit-msg
package.json
.gitignore
CHANGLOG.md
DEVELOPMENT.md
```

打包：`npm run package` → `dist/package/ChromeTranslator/`、`dist/ChromeTranslator-0.1.5.zip`

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
npm run install-hooks   # 首次：启用 .githooks，提交说明读 CHANGLOG.md
npm run commit          # git commit -F <自 CHANGLOG 生成的说明>
npm run build:content   # 仅改 content 链时也可单独执行
npm run package
npm run sync-install    # 覆盖 D:\Chrome Translator（Chrome 已加载目录）
```

## 加载

`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → `D:\Chrome Translator`（日常）或 `dist/package/ChromeTranslator/`（打包验证）
