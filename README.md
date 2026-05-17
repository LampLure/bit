# Bit Resource Finder

一个本地优先的资源搜索应用。当前版本已经从单纯 UI 原型升级为“本地 HTTP 服务 + 前端 GUI”的可运行实现：前端负责界面、adapter 管理、DOM selector 解析和结果展示；本地服务负责跨域抓取页面、保存站点 cookies，并把 HTML 交给前端按 adapter selector 提取结果。

> 请仅将本项目用于你有权访问和分享的合法资源。本应用不会下载文件内容；metadata 阶段只解析 magnet 本身或根据页面信息构建候选文件信息。使用任何资源站时请遵守目标站点服务条款和当地法律。

## 已实现能力

- 左侧边栏：搜索关键字、1~4 并发、资源站 adapter、最近 5 条历史记录、LLaMACpp endpoint 和展示阈值。
- 右侧分屏：最多 4 个浏览器窗格；新增 adapter 时会通过本地抓取服务加载页面预览。
- 半自动 adapter 指引：按“搜索框 → 搜索按钮 → 搜索结果 → 磁力链接”捕获 CSS selector；可以点击预览页元素自动捕获，也可以手动输入 selector。
- 本地抓取服务：`server.mjs` 提供 `/api/fetch`，支持 http/https 页面抓取、超时、HTML 大小限制、Cloudflare/验证页检测和简单 cookie jar 持久化。
- 可选真实有头浏览器：如果本机安装了 `playwright` 和 Chromium，`/api/browser/search` 会使用 Playwright persistent context 打开真实 Chromium、填写搜索框、点击按钮、跟进详情页并提取 magnet；否则自动回退到 HTTP 抓取模式。
- 搜索流水线：根据 adapter 的 `searchUrlTemplate` 访问搜索页，使用 `resultItemSelector` 找结果详情页，再使用 `magnetLinkSelector` 提取 magnet 链接。
- 本地分析：metadata-only 边界，不下载文件；如果本机安装 `webtorrent`，`/api/torrent/metadata` 会优先通过 DHT/tracker 获取真实 metadata 文件列表；不可用时回退到标题估算。规则预筛会过滤无视频文件、广告词、压缩包过多等低质量候选。
- AI 评分：优先调用本地 llama.cpp HTTP endpoint；不可用时回退到确定性的本地启发式评分。
- 历史缓存：最近 5 次搜索结果保存在浏览器 `localStorage`。

## 开发命令

```bash
npm run dev      # build 后启动本地服务，访问 http://127.0.0.1:4173
npm run build    # TypeScript 编译到 dist/
npm run serve    # 仅启动已构建的 dist/ 服务
npm run lint     # TypeScript 编译检查
npm test         # 构建后运行 Node 内置测试
# 可选增强：npm install playwright webtorrent && npx playwright install chromium
```

本项目基础功能刻意不依赖 npm 第三方包，便于在受限环境中构建和运行。真实有头浏览器和真实 DHT/tracker metadata 是可选增强，分别通过 `playwright` 和 `webtorrent` 动态检测启用。

## 使用流程

1. 执行 `npm run dev`，打开 `http://127.0.0.1:4173`。
2. 点击“添加资源站”，填写首页 URL、资源站名称和搜索 URL 模板；搜索模板中用 `{query}` 表示关键词。
3. 预览页加载完成后，按提示点击搜索框、搜索按钮、搜索结果项、磁力链接元素，或手动填写 CSS selector。
4. 输入关键词，选择 1~4 并发，点击“开始搜索”。
5. 查看进度面板；如果检测到 Cloudflare/验证页，当前版本会停止该站点任务并提示用户，避免绕过验证；后续 Tauri/WebView 版本可接入真实人工验证后的持久化上下文。
6. 展开结果卡片查看 magnet、文件列表、规则评分和 AI 评分理由。

## 目录结构

```text
server.mjs                本地 HTTP 服务、跨域抓取、cookie jar
src/main.ts               GUI、adapter 指引、事件绑定
browserRuntime.mjs        可选 Playwright/Chromium 有头浏览器搜索运行时
torrentMetadataService.mjs 可选 WebTorrent metadata-only 服务
src/core/search.ts        真实 HTML 抓取/selector 解析/并发搜索流水线
src/core/torrent.ts       metadata-only magnet 分析边界
src/core/rules.ts         规则预筛
src/core/ai.ts            llama.cpp HTTP 调用与本地回退评分
src/core/storage.ts       localStorage 持久化
src/styles/app.css        全局样式
tests/                    Node 内置测试
```

## 仍需平台级增强

- 如果要做成真正双击安装包，可在此基础上包一层 Tauri，把 `server.mjs` 的抓取逻辑迁移到 Rust command。
- Playwright 模式已经实现真实有头浏览器搜索链，但作为可选运行时存在；仓库默认不强制安装浏览器二进制，避免受限环境无法构建。
- WebTorrent metadata-only 服务已经作为可选运行时接入；未安装时仍回退到估算 metadata。
- Cloudflare 不能也不应该绕过；Playwright 模式会保留 persistent context 供用户在真实浏览器窗口中手动验证，HTTP fetch 模式只检测验证页并停止该站点任务。
