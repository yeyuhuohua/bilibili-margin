# Safari 兼容与打包准备（#12）

2026-11-06：补充临时扩展安装入口与操作步骤。源码兼容检查和 Chromium 回归已通过，**Safari 扩展安装与播放仍待 Mac 验收**。

## 直接加载构建包

Apple 当前提供从目录或 ZIP 加载临时 Web 扩展的入口。先在 Safari 的设置中确认是否有「添加临时扩展 / Add Temporary Extension」按钮，若有，可按以下步骤测试。[Apple 安装文档](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension) · [Apple 操作演示](https://developer.apple.com/videos/play/wwdc2026/216/)

1. 打开本仓库 [build 构建列表](https://github.com/jiuyang5354/bilibili-margin/actions/workflows/build.yml)，选择最新成功的 `main` 构建，下载 Artifacts 中的 `margin`。
2. 解压并确认所选目录直接包含 `manifest.json`、`content.js`、`pages`、`fonts` 和 `icons`。从源码操作时，运行 `npm ci` 和 `npm run build`，使用生成的 `dist` 目录。
3. 在 Safari「设置 → 高级」中开启「显示网页开发者功能 / Show features for web developers」。
4. 打开设置中的「开发者 / Developer」，选择「添加临时扩展 / Add Temporary Extension」，按 Safari 提示允许未签名的测试扩展，选择上面的构建目录或 ZIP。
5. 在「设置 → 扩展」中启用映间，并授予 B 站相关页面访问权限。打开 B 站首页和一个普通视频页进行验证。

临时扩展用于本机测试。退出 Safari 后，按当前浏览器提示重新允许或加载测试扩展。需要反馈时，请提供 macOS 版本、Safari 版本、构建提交，以及安装、授权或页面运行具体卡在哪一步。

若 Safari 仅提供 Xcode 扩展安装方式，可使用下方打包步骤。Issue #12 中的 Mac 验收将分别记录安装成功、权限、首页、播放页及后台恢复结果。

## 当前代码检查

| 使用点 | 检查结果 / 待验收内容 |
| --- | --- |
| Manifest V3、后台 service worker | Apple 支持此结构；后台在顶层注册监听，持久状态使用 storage.local。待验后台休眠后足迹和消息恢复。 |
| chrome.storage.local / onChanged、runtime 消息 / getURL / getManifest | Apple 支持 chrome 命名空间与 Promise。未使用 Safari 缺失的 identity、storage.sync 或 webRequestBlocking。待验设置、背景图、动态模块加载和消息响应。 |
| cdn.js 的 content_scripts.world: MAIN | MDN 兼容数据标为 Safari 18 起；更早版本不能据此承诺 CDN 切换支持。待验 document_start 注入及不重复播放。 |
| 页面模块 ES import 与 web_accessible_resources | 路由页面与字体、flux.js 已列在 manifest。待验 Safari 扩展协议、权限授予和 CSP 下的动态加载。 |
| SVG backdrop-filter | 默认柔和模式不生成折射位移图，液态折射仍依赖 SVG URL 滤镜；不能用 CSS 语法可接受代替效果验证。需要实际检查文字清晰度与玻璃兜底。 |
| WebGPU / WebGL | 流光已有初始化失败退回 WebGL；仍需验收实际 GPU、上下文丢失和前后台恢复。 |
| 新增社区片段查询 | 只在显式开启后查询 bsbsb.top；需在 Safari 授予对应站点权限后验收后台跨域及撤销操作。 |

## 在 Mac 上打包

先用与当前分支相同的源码构建，再使用 Apple 当前工具。此命令不覆盖已有工程；`--copy-resources` 避免 Xcode 工程回写原始 dist。

```sh
npm ci
npm run build
xcrun safari-web-extension-packager ./dist \
  --project-location ./safari-xcode \
  --app-name MARGIN \
  --bundle-identifier io.github.jiuyang5354.margin \
  --macos-only --swift --copy-resources --no-open
```

旧版 Xcode 的工具名是 `safari-web-extension-converter`，可用相同参数调用。打包前运行工具的 `--help`，并审核它报告的 manifest 警告。

在 Xcode 中选择自己的开发团队、构建并运行 macOS 宿主 App，按 Apple 的运行文档启用扩展，并在 Safari 中允许访问对应的 B 站页面。分发、签名和 App Store 审核另行处理；仓库当前没有签名的 Safari 安装包。

## 安装后的验收

1. 首次授权与刷新后：首页、播放、搜索、空间、消息、动态、历史均正常加载，禁用扩展与 `?margin=off` 能恢复原版。
2. 背景与主题切换、透明控件、字体和账号卡片在亮暗主题与窄窗口下可读；后台切回后恢复。
3. 原生视频不中断或重复初始化，普通 / 宽屏 / 网页全屏切换、弹幕、评论草稿与收起正常。
4. 收藏夹直接展开、消息刷新和足迹在多个标签及后台重启后保持正确。
5. 社区跳过默认不请求第三方，开启后只跳当前分 P，撤销和关闭即时生效；拒绝服务权限或接口失败时仍能播放。

## 依据

- [Apple：评估跨浏览器兼容性](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)
- [Apple：打包 Web 扩展](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)
- [Apple：运行 Safari Web 扩展](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)
- [MDN：content_scripts 兼容数据](https://github.com/mdn/browser-compat-data/blob/main/webextensions/manifest/content_scripts.json)
