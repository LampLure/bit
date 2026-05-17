# Bit Resource Finder

一个本地优先的资源搜索应用。通过真实有头浏览器自动化搜索资源站、人工完成验证、metadata-only 分析 torrent、规则预筛 + llama.cpp AI 评分，最终按评分排序展示结果。

> 请仅将本项目用于你有权访问和分享的合法资源。本应用不会下载文件内容；metadata 阶段只获取 torrent metadata 文件列表，不下载文件。使用任何资源站时请遵守目标站点服务条款和当地法律。不绕过 Cloudflare/验证页。

## 已实现能力

- 左侧边栏：搜索关键字、1~4 并发、资源站 adapter、最近 5 条历史记录、LLaMACpp endpoint 和展示阈值。
- 右侧面板区：1~4 个浏览器任务面板，显示各资源站状态；遇到验证页时提示用户人工完成验证。
- adapter 录制流程：按"搜索框 → 搜索按钮 → 搜索结果 → 磁力链接"捕获 CSS selector；录制每步后显示非阻塞 toast。
- 真实浏览器搜索链：Playwright persistent Chromium context，在真实浏览器中打开资源站首页、输入关键词、点击搜索按钮；检测到 Cloudflare 时暂停并提示用户人工验证，不绕过验证。
- 服务端 API：`server.mjs` 提供 `/api/browser/*` 系列端点（start/open/search/continue/detail/status）和 `/api/torrent/metadata`。
- 搜索流水线：按并发数建立任务队列，每个资源站调用浏览器搜索 API，提取搜索结果链接后逐个进入详情页提取 magnet 链接，按 btih hash 去重。
- metadata-only torrent 分析：通过 WebTorrent 获取真实 DHT/tracker metadata 文件列表，不下载文件内容。单条超时默认 45 秒，全局并发默认 4-8。/api/torrent/metadata 是本地 Node 服务暴露的内部接口，不依赖第三方外部 metadata API。
- 规则预筛：过滤无视频文件、压缩包过多、视频占比低、广告词、标题相似度低等低质量候选。
- AI 评分：批量发送候选到 llama.cpp endpoint，动态切分 token 预算，规则评分 × 0.45 + AI 评分 × 0.55 得到最终分。
- AI 不可用时回退到规则评分，并在 UI 显示提示。
- 历史缓存：最近 5 次搜索结果保存在 browser localStorage。
- 安全边界：不绕过 Cloudflare、不下载文件内容、不提供视频预览、仅分析用户有权访问的公开页面和 magnet metadata。

## 开发命令

```bash
npm install        # 安装依赖，首次运行会自动安装 Chromium
npm run dev        # build 后启动本地服务，访问 http://127.0.0.1:4173
npm run build      # TypeScript 编译到 dist/
npm run serve      # 仅启动已构建的 dist/ 服务
npm run lint       # TypeScript 编译检查
npm test           # 构建后运行 Node 内置测试
```

## 使用流程

1. 执行 `npm install && npm run dev`，打开 `http://127.0.0.1:4173`。
2. 点击"添加资源站"，填写首页 URL 和资源站名称。
3. 按指引依次点击搜索框、搜索按钮、搜索结果项、磁力链接元素（或手动填写 CSS selector）。
4. 保存 adapter 后，输入关键词，选择 1~4 并发，点击"开始搜索"。
5. 程序会在真实浏览器中打开资源站首页并自动搜索。如遇 Cloudflare 验证页，程序暂停并提示用户在浏览器窗口内人工完成验证；完成后点击"我已完成验证，继续"。
6. 查看进度条和各面板状态；搜索完成后按最终评分排序展示结果卡片，包含磁力链接、文件列表、规则评分和 AI 评分理由。

## 目录结构

```text
server.mjs                    本地 HTTP 服务、浏览器 API、metadata API
browserRuntime.mjs            Playwright/Chromium 有头浏览器搜索运行时
torrentMetadataService.mjs    WebTorrent metadata-only 服务
src/main.ts                   GUI、adapter 录制、事件绑定
src/core/search.ts            浏览器搜索流水线、结果排序
src/core/torrent.ts           metadata-only magnet 分析
src/core/rules.ts             规则预筛
src/core/ai.ts                llama.cpp 批量 AI 评分
src/core/adapterGuide.ts      adapter 录制指引
src/core/hash.ts              magnet infoHash 解析/去重
src/core/progress.ts          统一进度模型
src/core/browserClient.ts     前端浏览器 API 封装
src/core/torrentClient.ts     前端 metadata API 封装
src/core/storage.ts           localStorage 持久化
src/core/types.ts             类型定义
src/styles/app.css            全局样式
tests/                        Node 内置测试
```

## 安全边界

- 不绕过 Cloudflare/验证页，只提示用户人工完成
- 不下载文件内容，仅获取 torrent metadata
- 不提供视频预览
- 仅分析用户有权访问的公开页面和 magnet metadata
