# YouTube 风格（首页 / 播放页 / 接管页）设计

日期：2026-11-03
状态：已确认（用户口头批准），按「新文件为主、最小化改动旧文件」实施。

## 目标

提供一个可选的 YouTube 式视觉模式：首页完整 YouTube 布局；播放页重排 B 站原生观看页；空间 / 消息 / 历史 / 动态等接管页改用 YouTube 顶栏。配色、主题、背景不变。

## 非目标

- 不做插件体系、不做插件载入页、不写插件开发文档。
- 不改配色、主题、背景、字体 token；只借布局结构。
- 不做 Shorts 货架、Sponsored 卡片、YouTube 品牌/logo。
- 播放页不替换 B 站原生播放器、弹幕、评论。
- 接管页目前只统一顶栏和少量外壳，内容结构仍保留各页原有版式（后续可逐页细化）。

## 开关

- `Settings.ytHome: boolean`，默认 `false`。
- 设置 → 外观 → 「YouTube 风格首页」开关。
- 切换后刷新首页生效；其他设置继续热更新。
- 其他页面的 `Settings` 字段与行为不变。

## 结构

- 顶栏：菜单按钮（窄屏）、小电视 + `bilibili`、居中搜索、投稿、消息铃铛（未读角标，遵循 `msgRemind`）、主题、头像。首页、播放页、空间/消息/历史/动态、搜索/直播/详情共用。
- 首页：左侧栏（浏览 / 订阅 / 更多 / 设置）、chips、三列大卡片。
- 播放页：YouTube 式两栏（左播放器 + 标题/UP/互动/简介/评论，右 402px 推荐栏）；不替换原生播放器/弹幕/评论。
- 接管页（空间/消息/历史/动态）：YouTube 顶栏 + 原有页面结构；只做少量外壳收平。
- 隐藏：首页大搜索、日期眉标、足迹/天气卡、页脚；这些只在映间布局保留。

## 复用

数据、筛选（含标签过滤与预热）、无限滚动、悬停预览、稍后再看、收藏夹、设置面板、命令面板、右键菜单、不感兴趣/屏蔽 UP 全部复用现有模块。
⋮ 按钮通过合成 `contextmenu` 事件复用现有右键菜单，不改 `card-menu.ts`。

## 文件

新增：

- `src/content/ui/yt/home.ts`
- `src/content/ui/yt/header.ts`
- `src/content/ui/yt/sidebar.ts`
- `src/content/ui/yt/card.ts`
- `src/content/yt.css`

修改（仅三处）：

- `src/shared/settings.ts`：`ytHome` 字段、默认值、校验。
- `src/content/ui/settings-panel.ts`：外观分组增加开关。
- `src/content/pages/home.ts`：按 `ytHome` 选择挂载映间首页或 YouTube 首页；切换时刷新。

## 验证

- `pnpm run build` 通过。
- smoke 新增 `yt-home`：顶栏 / 侧栏 / chips / 三列网格 / 卡片头像行存在。
- 原有 smoke 全量通过（默认仍是映间首页）。
