# 变更记录

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
