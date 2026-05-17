# Bit Resource Finder

一个本地 Electron 桌面应用，通过真实可交互网页视图搜索资源站、人工完成验证、metadata-only 分析 torrent、规则预筛 + llama.cpp AI 评分。

> 请仅将本项目用于你有权访问和分享的合法资源。本应用不会下载文件内容；metadata 阶段只获取 torrent metadata 文件列表，不下载文件。使用任何资源站时请遵守目标站点服务条款和当地法律。不绕过 Cloudflare/验证页。

## 启动方式

普通用户：

```bash
# Linux / WSL
./start.sh

# Windows
# 双击 start.bat
```

开发调试：

```bash
npm run dev        # WebUI 模式（普通浏览器访问 http://127.0.0.1:4173）
npm run app        # 桌面应用模式（Electron 窗口）
npm run build      # TypeScript 编译
npm test           # 运行测试
```

`npm run app` 会自动启动本地服务并打开 Electron 应用窗口。用户不需要手动打开浏览器访问 URL。

## 已实现能力

- **真实可交互面板**：右侧 1-4 个 Electron BrowserView 面板，每个加载真实资源站网页。用户可直接在面板内点击、输入、滚动、完成 Cloudflare 验证。
- **左侧控制栏**：搜索关键字、1~4 并发、资源站 adapter、最近 5 条历史记录、LLaMACpp endpoint 和展示阈值。
- **adapter 录制**：在真实面板网页中点击搜索框、搜索按钮、结果项、磁力链接元素自动捕获 CSS selector。每步非阻塞 toast 提示。
- **搜索流水线**：在用户可见的 Electron 面板中自动导航、填关键词、点击搜索按钮。遇到验证页时暂停，用户在面板内人工完成验证后点击"继续"。
- **metadata-only torrent 分析**：通过 WebTorrent 获取真实 DHT/tracker metadata 文件列表。`/api/torrent/metadata` 是本地 Node 服务内部接口，不依赖第三方外部服务。不下载文件内容。
- **规则预筛 + AI 评分**：规则评分 × 0.45 + AI 评分 × 0.55 得到最终分。AI 不可用时回退规则评分。
- **安全边界**：不绕过 Cloudflare、不下载文件内容、不提供视频预览、仅分析用户有权访问的公开页面和 magnet metadata。
- **持久化 session**：面板使用 `persist:magnet-ai-client` session partition，Cloudflare 验证/登录状态可持久保存。

## 使用流程

1. 执行 `./start.sh`（或双击 `start.bat`），应用窗口自动打开。
2. 点击"添加资源站"，填写首页 URL 和名称。
3. 在右侧面板中依次点击搜索框、搜索按钮、搜索结果项、磁力链接元素，或手动填写 CSS selector。
4. 输入关键词，选择并发数，点击"开始搜索"。
5. 程序在右侧面板中自动打开资源站并搜索。如遇验证页，用户直接在面板内完成验证，然后点击"我已完成验证，继续"。
6. 查看结果卡片（磁力链接、文件列表、规则评分、AI 评分）。

## 目录结构

```text
desktopLauncher.mjs          启动器（server + Electron）
server.mjs                   本地 HTTP 服务
electron/
  main.mjs                   Electron 主进程
  preload.mjs                IPC 桥接
  panelManager.mjs           BrowserView 面板管理
playwrightRuntime.mjs        Playwright 后台自动化（可选）
torrentMetadataService.mjs   WebTorrent metadata 服务
src/
  main.ts                    前端 UI
  core/
    browserClient.ts          浏览器控制（Electron panel / Playwright API）
    search.ts                 搜索流水线
    torrent.ts                metadata 分析
    torrentClient.ts          metadata API 客户端
    rules.ts                  规则预筛
    ai.ts                     AI 批量评分
    adapterGuide.ts           adapter 录制
    hash.ts                   infoHash 解析/去重
    progress.ts               进度模型
    storage.ts                localStorage 持久化
    types.ts                  类型定义
  styles/app.css              样式
tests/                        测试
start.sh / start.bat          启动脚本
```
