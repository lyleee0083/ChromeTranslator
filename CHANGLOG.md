# 变更记录

## 0.1.22

安装目录同步清理旧文件

- `npm run sync-install` 在复制运行时文件前清空 `D:\Chrome Translator`，避免安装目录残留仓库旧文件或构建文件。
- 更新文档中的安装目录同步说明与 0.1.22 打包版本号。

## 0.1.21

项目文件审查与冗余清理

- 收紧仅在模块内部使用的 DeepL、缓存目录与整页筛选辅助符号导出。
- 同步修正项目版本元数据与文档中的打包 zip 版本号。

## 0.1.20

修复打包前模块校验

- `verify-extension-modules.mjs` 跳过会访问 `chrome`/`document` 的入口脚本，改为静态扫描 `import`/`export`，`npm run package` 可正常完成。

## 0.1.19

项目文件审查与模块校验

- 整理 YouTube 字幕辅助函数顺序；打包前增加 `verify-extension-modules.mjs` 防止误删跨文件 export。

## 0.1.18

修复 Service Worker 无法启动

- 恢复 `google-translate.js` 对 `translator.js` 所需的导出，修复扩展后台显示「无效」、翻译全部失效。

## 0.1.17

项目文件审查与冗余清理

- 删除未使用导出；YouTube 字幕显示逻辑合并为共用函数；文档与 0.1.16 行为对齐（无「…」占位）。

## 0.1.16

YouTube 无字幕时不显示占位符

- 去掉等待译文时的「…」占位；无 cue 或请求被取消时清除 overlay，避免两句之间仍显示三个点。

## 0.1.15

项目文件审查与冗余清理

- 删除未使用的 YouTube 窗口预取逻辑、`youtubeActiveTranslationPending` 状态及多余导出。
- 收紧 `deepl-translate.js`、`google-translate.js`、`translator.js` 内部符号可见性。

## 0.1.14

YouTube 字幕即时占位与滚动预取

- 新 cue 立刻隐藏原字幕并显示占位符，译文返回后替换。
- Transcript 加载后从当前时间滚动预译至末尾再从头补全，不再等当前句译完。
- 预取 48 条/批、8 路并行；内存缓存 2000 条；后台 YouTube 并发 24、网络批 10。

## 0.1.13

项目文件审查与冗余清理

- 删除未使用的导出与残留工具函数；合并重复的 YouTube 任务类型常量。
- 整理 `options.js` 格式；文档与打包清单与当前运行时文件一致。

## 0.1.12

本地持久缓存上限可配置

- 默认每语言 5000 条；Options 可自定义条数或选择不限制。
- 自动清理启用时，不限制模式仍按时间与长文本低命中规则裁剪。

## 0.1.11

YouTube 字幕本地缓存与预取加速

- 说明本地批处理分组并发（整页 6/10/20，YouTube 12/16/32）；YouTube 后台任务并发提升至 16。
- 内容脚本增加字幕译文内存缓存，命中即渲染，不再排队等 background。
- 预取改为 4 路并行批请求、允许网络补全未命中；换当前字幕时不再取消低优先级预取。

## 0.1.10

DeepL 润色默认关闭，密钥激活与缓存保护

- 润色默认关闭；保存 DeepL 密钥后启用，未启用不影响 Google 翻译与缓存读写。
- 本地额度用尽或密钥到期、API 鉴权/额度错误时自动关闭润色。
- 润色结果校验通过后才写回持久缓存；失败保留原 Google 译文。

## 0.1.9

翻译链路性能优化

- 本地缓存：统一查找、命中不写回持久层、站点索引内存复用与 `cacheKeySet` O(1) 判断。
- 网络翻译：Google 并发提升至 1–4，批处理先返回译文，润色改为后台。
- DeepL 润色：独立并发队列（2），已润色跳过，不阻塞页面展示。

## 0.1.8

GitHub 推送汇总未上云的 CHANGLOG 版本

- `npm run push`：提交说明合并自 `origin/main` 以来全部 `CHANGLOG.md` 版本，便于 GitHub 一次显示本地累积变更。

## 0.1.7

README 与当前扩展能力对齐

- 在线翻译为 Google；DeepL 仅润色本地缓存；更新安装、模块与 Storage 说明。

## 0.1.6

在线翻译改为 Google，DeepL 仅润色本地缓存

- 在线翻译接口改为 `https://clients5.google.com/translate_a/t`。
- 移除 DeepL 额度/时长/网络并发计时与限制；Options 仅保留润色密钥。
- DeepL 只读取本地持久化缓存条目核对润色后写回，不参与首次网络翻译。

## 0.1.5

修复内容脚本与翻译功能

- 修复内容脚本 `Cannot use import statement outside a module`：将 `content.js` 打包为 `content.bundle.js`（IIFE），manifest 改为注入 bundle。
- 修复 `content.js` 中 `YOUTUBE_SUBTITLE_TRANSLATION_STORAGE_KEY` 未定义导致翻译失效。
- 新增 `CHANGLOG.md`、git hooks、`sync-install` 与内容脚本打包流程。

## 0.1.4

- 开发流程：改动后 `npm run sync-install` 同步本机 Chrome 加载目录；同步部署本身不写入变更日志。运行时文件清单抽到 `extension-runtime-files.mjs`。

## 0.1.3

- 修复 `content.js` 误用未定义 `YOUTUBE_SUBTITLE_STORAGE_KEY` 导致内容脚本崩溃、整页翻译与 YouTube 字幕均失效。

## 0.1.2

- Git 提交说明从 `CHANGLOG.md` 最新版本节读取；新增 `.githooks/prepare-commit-msg` 与 `npm run install-hooks` / `npm run commit`。

## 0.1.1

- 开发流程：「每次改动后」增加仅改本仓库本地文件、变更记入本文件及补丁版本递增规则。

## 0.1.0

- 初始发布版本。
