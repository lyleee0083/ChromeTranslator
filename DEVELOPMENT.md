# Chrome Translator 开发说明

## 每次改动后（必读）

项目开发已结束。此后**每一次**代码改动完成时，必须按顺序执行：

1. **改动范围**：只修改本仓库根目录（当前工作区路径）下的本地文件；不修改仓库外路径，不把改动散落到未纳入本仓库的路径。
2. **变更记录与版本**：在 `CHANGLOG.md` 追加一节：`## x.y.z` 下一行写**一行标题**（勿以 `-` 开头），再写 `-` 条目列表。每完成一次改动补丁位 +1，并同步 `manifest.json`、`package.json` 的 `version`。**不必每次版本变更都推送到 GitHub**；本地可连续多版只记在 `CHANGLOG.md`。
3. **Git 提交（本地）**：先写好 `CHANGLOG.md` 再提交。首次在本机克隆后执行一次 `npm run install-hooks`；日常用 `git commit` / `npm run commit`，说明取 `CHANGLOG.md` **最新一节**。
4. **推送到 GitHub**：需要与远端对齐时执行 `npm run push`。提交说明包含自 `origin/main` 最新版本以来、`CHANGLOG.md` 中**所有未推送版本**（标题如 `0.1.6–0.1.7 累计更新`，正文按 `## 版本` 逐节列出），便于 GitHub 变更记录一次看清本地累积改动；若有未推送提交会先 `reset --soft origin/main` 再合并为一次提交后推送。
5. **自我审查**：删除与当前功能无关的代码、注释、文件；不保留测试目录/测试脚本；不保留构建残留（`dist/` 仅由 `npm run package` 生成）；不保留旧版迁移/兼容逻辑。不得删除其他模块仍 `import` 的 `export`（`npm run package` 会先执行 `scripts/verify-extension-modules.mjs` 校验）。
6. **更新本文档**：只写仓库里**已实现**的功能、文件、配置与常量；不写计划、不写未实现能力、不写「不支持 xxx」类说明。
7. **同步 README**：修改 `DEVELOPMENT.md` 时，将其中**已实现**的对外说明同步到 `README.md`（功能、安装、文件、模块、语言、Storage 等）；**不要**把「每次改动后（必读）」及维护流程写入 README。此步骤为文档同步，**不要**写入 `CHANGLOG.md`。
8. **内容脚本打包**：修改 `content.js` 或其依赖后，`npm run package` / `npm run sync-install` 会自动执行 `npm run build:content`，生成 `content.bundle.js`（manifest 注入此文件，不用 ES module）。
9. **核对打包清单**：新增或删除运行时 `.js` / `.html` 时，同步修改 `scripts/extension-runtime-files.mjs` 的 `RUNTIME_FILES`。
10. **打包验证**：执行 `npm run package`，确认 zip 可加载。
11. **同步 Chrome 安装目录**：执行 `npm run sync-install`，清空 `D:\Chrome Translator` 后复制运行时文件（本机已解压扩展目录）；在 `chrome://extensions` 点重新加载。此步骤为部署动作，**不要**写入 `CHANGLOG.md`。

---

版本 0.1.22 · Manifest V3 Chrome 扩展 · Google 翻译 + DeepL 润色（可选）

## 功能

- 整页 DOM 文本翻译（批次、优先级、原文/译文/双语）
- YouTube 字幕翻译（`.ytp-caption-segment` + `captionTracks` 预取）
- 保护词（默认词库 + 用户词库，占位符 masking）
- 多级翻译缓存（页内内存 → session → 本地持久）
- 域名排除、Google 在线翻译、DeepL 本地缓存润色（默认关闭，保存密钥后启用）
- Popup、Options、右键菜单

## 文件

```
manifest.json
background.js
content.js              # 源码；运行时注入 content.bundle.js
content.bundle.js       # build:content 生成
content.css
translator.js
google-translate.js
deepl-translate.js
deepl-settings.js
domain-settings.js
language-options.js
translation-cache.js
cache-settings.js
translation-cache-key.js
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
scripts/git-push-github.mjs
scripts/prepare-commit-msg.mjs
scripts/git-commit-from-changelog.mjs
scripts/verify-extension-modules.mjs
scripts/install-git-hooks.mjs
.githooks/prepare-commit-msg
package.json
.gitignore
CHANGLOG.md
DEVELOPMENT.md
```

打包：`npm run package` → `dist/package/ChromeTranslator/`、`dist/ChromeTranslator-0.1.22.zip`（先校验模块 import）

## 模块

| 文件 | 职责 |
| --- | --- |
| `background.js` | 消息队列、缓存、翻译调度、右键菜单 |
| `content.js` | 整页扫描翻译、YouTube 字幕叠加 |
| `translator.js` | 缓存查找、Google 在线翻译、DeepL 润色写回 |
| `google-translate.js` | `clients5.google.com/translate_a/t` 请求与解析 |
| `deepl-translate.js` | DeepL 润色请求（仅配合本地持久缓存） |
| `deepl-settings.js` | DeepL 润色开关、密钥、额度与有效期 |
| `domain-settings.js` | 排除域名 |
| `language-options.js` | 目标语言 |
| `protected-terms.js` | 保护词匹配、预编译 protector |
| `protected-terms-defaults.js` | 默认词库 |
| `translation-cache.js` | 持久缓存 |
| `cache-settings.js` | 每语言缓存上限（自定义 / 不限制） |
| `translation-result-utils.js` | 持久缓存写入规则 |
| `translation-residue-utils.js` | 中文目标英文残留检测 |
| `cache-clear-utils.js` | session 缓存过滤 |
| `webpage-translation.js` | 整页文本节点筛选 |
| `youtube-subtitles.js` | caption 解析与叠加层 |
| `popup.js` / `options.js` | 弹窗与设置页 |

## 语言

`zh-CN`（默认）、`en`、`ja`、`ko`、`es`、`fr`、`de` — 见 `language-options.js`

Google `tl` 映射见 `google-translate.js`；DeepL `target_lang` 见 `deepl-translate.js`

## Storage

**sync**：`targetLanguage`、`webpageTranslationEnabled`、`youtubeSubtitleTranslationEnabled`、`excludedTranslationHosts`、`cacheLimitMode`、`cacheLimitMaxEntries`（默认 5000 条/语言，可选不限制）、`autoCacheCleanupEnabled`

**local**：`deeplApiKey`、`deeplPolishEnabled`（默认 `false`，保存密钥后为 `true`）、额度/有效期计数（`deepl-settings.js`）、`userProtectedTerms`、`localTranslationCache:<lang>`、`localTranslationCacheDirectory`、`sessionTranslationCache:<tabId>`

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
| 翻译任务并发 | 10（YouTube 字幕 24） |
| 本地批处理分组并发 | 整页 6/10/20；YouTube 12/16/32（`translator.js` 内部） |
| Google HTTP 并发 | 1–4（整页，自适应）；YouTube 批请求 10 |
| DeepL 润色并发 | 2（后台队列，不阻塞返回） |
| 批处理上限 | 20 条 / 4000 字符 |
| 整页空闲扫描 | 250 节点/批 |
| YouTube 预取批 | 48 条/批，8 路并行；滚动预取（当前→末尾→开头）；内存缓存约 2000 条 |
| YouTube 跳转阈值 | 3s |
| YouTube 滚动预取补 kick | 当前时间 +30s 内未缓存时重启预取 |
| 持久缓存上限 | 默认 5000 条/语言；Options 可自定义或选不限制（`cache-settings.js`） |

## 性能要点

- 缓存命中跳过保护词正则；命中不重写持久缓存，仅轻量更新 session 命中计数
- 本地站点缓存索引内存复用（`cacheKeySet` + 站点子 Map），目录键 O(1) 判断
- `translation-cache-key.js` 复用语言对前缀，减少键拼接开销
- 保护词 `buildMergedTermsProtector` 预编译与缓存
- 整页 DOM 扫描使用 `requestIdleCallback`
- YouTube 新 cue 立刻隐藏原字幕（无「…」占位）；Transcript 加载后滚动预译至末尾再从头补全
- Google 批请求并行、in-flight 去重；网络结果先返回，润色后台排队
- DeepL 润色默认关闭；启用后并发 2、已润色跳过；额度用尽/到期或 API 456/401/403/429 自动关闭；校验通过才写回持久缓存
- Free/Pro 密钥决定 `api-free.deepl.com` / `api.deepl.com`

## 命令

```bash
npm run install-hooks   # 首次：启用 .githooks，提交说明读 CHANGLOG.md
npm run commit          # 本地提交，说明 = CHANGLOG 最新一节
npm run push            # 推送 GitHub，说明 = 自 origin/main 以来全部未推送版本
npm run build:content   # 仅改 content 链时也可单独执行
npm run package
npm run sync-install    # 清空并覆盖 D:\Chrome Translator（Chrome 已加载目录）
```

## 加载

`chrome://extensions` → 开发者模式 → 加载已解压的扩展 → `D:\Chrome Translator`（日常）或 `dist/package/ChromeTranslator/`（打包验证）
