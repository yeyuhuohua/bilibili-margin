/**
 * 接管页（首页、空间、消息、历史、动态首页）只显示映间自己的 Shadow DOM，
 * 原版 B 站页面虽然被 display:none 藏起来，但它的整套脚本照样跑：
 * 渲染 7000+ 节点、轮询推荐、上报埋点、加载 iframe，白白吃 CPU、内存和流量。
 * 这里在 document_start 挂一个 MutationObserver，原版脚本一插进来就改掉 type 并移除，
 * 在它执行前拦下（外链脚本要先下载，观察者回调一定比执行早）。
 * 设置里关掉映间时（异步读到），用 localStorage 镜像标记下次不拦，再刷新一次回到原版。
 */
const flag = () => `margin:native-guard:${location.origin}${location.pathname}`;

export function guardEnabled(): boolean {
  try { return localStorage.getItem(flag()) !== '0'; } catch { return true; }
}
export function setGuard(on: boolean): void {
  try { localStorage.setItem(flag(), on ? '1' : '0'); } catch { /* 隐私模式 */ }
}

const kill = (n: Node) => {
  if (n instanceof HTMLScriptElement) {
    if (n.type === 'application/json' || n.type === 'application/ld+json') return;
    n.type = 'javascript/margin-blocked';
    n.remove();
  } else if (n instanceof HTMLLinkElement && /^(modulepreload|preload|prefetch)$/i.test(n.rel) && (n.as === 'script' || n.rel === 'modulepreload')) {
    n.remove();
  } else if (n instanceof HTMLIFrameElement) {
    n.src = 'about:blank';
    n.remove();
  }
};

/** 返回停止函数 */
export function muteNative(): () => void {
  if (!guardEnabled()) return () => {};
  document.querySelectorAll('script, link, iframe').forEach(kill);
  const mo = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      kill(n);
      if (n instanceof Element && n.firstElementChild) n.querySelectorAll('script, link, iframe').forEach(kill);
    }
  });
  mo.observe(document, { childList: true, subtree: true });
  return () => mo.disconnect();
}
