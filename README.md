# Bit Resource Finder

一个本地优先的资源搜索桌面应用原型，实现了需求讨论中的核心数据流：

- 左侧边栏：搜索、并发数、资源站 adapter、最近 5 条历史记录、AI 参数。
- 右侧分屏：最多 4 个浏览器窗格，用于后续接入 Tauri WebView / Playwright 持久化上下文。
- 半自动资源站指引：按“搜索框 → 搜索按钮 → 搜索结果 → 磁力链接”捕获 selector 并保存 adapter。
- 搜索流水线：adapter 抓取模拟、Cloudflare 人工验证状态提示、磁力 metadata 分析、规则预筛、LLaMACpp HTTP 评分回退到本地启发式评分。
- 结果列表：按置信度排序，展开显示磁力链接、文件列表、规则评分和 AI 理由。

> 请仅将本项目用于你有权访问和分享的合法资源。本原型不会下载文件，metadata 阶段也仅用于展示程序结构；生产版本应继续保持“不下载内容”的边界并遵守目标站点服务条款。

## 开发命令

```bash
npm install
npm run dev
npm run build
npm test
```

## 目录结构

```text
src/
  main.ts                 无框架 GUI 与应用状态编排
  core/                   adapter、搜索、metadata、规则、AI、缓存逻辑
  styles/app.css          全局样式
```

## 后续接入建议

1. 将 `BrowserGrid` 中的 iframe/占位窗格替换为 Tauri WebView 或 Playwright 有头浏览器管理层。
2. 将 `executeSearch` 的 demo adapter 搜索替换为真实 selector 操作，保留当前进度回调接口。
3. 将 `analyzeMagnetMetadata` 替换为 WebTorrent / Rust libtorrent metadata-only 实现，继续禁止内容下载。
4. 将 `scoreWithAi` 对接本地 llama.cpp server，要求模型严格输出 JSON。
