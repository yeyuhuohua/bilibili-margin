/**
 * 足迹心跳（入口脚本里运行，所有 B 站页面）：
 * 页面活跃时每 15 秒把「上次心跳 → 现在」这段时间报给后台 service worker，由它统一累计。
 * 活跃 = 正在播放视频（标签页在后台也算，比如只听声音），或页面可见且 90 秒内有操作。
 * 后台标签页的计时器会被浏览器节流到约 1 分钟一次，所以每次报的是「上次心跳 → 现在」整段（最长 70 秒）。
 */
import type { FpMessage } from '../../shared/activity';
import { every } from '../sched';

const BEAT = 15_000;

const send = (m: FpMessage) => {
  try { chrome.runtime.sendMessage(m).catch(() => {}); } catch { /* 扩展更新后旧页面的 chrome.* 会失效，忽略 */ }
};

export function startTracking(): void {
  let lastInput = Date.now();
  for (const t of ['pointermove', 'keydown', 'wheel', 'pointerdown', 'scroll'])
    addEventListener(t, () => { lastInput = Date.now(); }, { passive: true, capture: true });
  // B 站播放器在部分浏览器上用 <bwp-video>（自定义元素，接口和 HTMLMediaElement 一致）
  const playing = (audible: boolean) => [...document.querySelectorAll<HTMLMediaElement>('video, bwp-video')]
    .some((v) => !v.paused && !v.ended && v.readyState > 2 && (!audible || (!v.muted && v.volume > 0)));
  const active = () => document.visibilityState === 'visible'
    ? Date.now() - lastInput < 90_000 || playing(false)
    : playing(true); // 后台：有声音地在播才算（静音的预览不算）

  let last = active() ? Date.now() : 0;
  const beat = () => {
    const now = Date.now();
    if (!active()) { last = 0; return; }
    const from = last && now - last <= 70_000 ? last : now - BEAT;
    last = now;
    send({ margin: 'fp', op: 'beat', from, to: now });
  };
  const open = () => { if (document.visibilityState === 'visible') send({ margin: 'fp', op: 'open', at: Date.now() }); };
  // 页面离开前补上不足 15 秒的尾段；继续使用后台时间片去重，多个事件或标签页不会重复累计。
  const flush = () => {
    const now = Date.now();
    if (last && now > last && now - last <= 70_000 && (now - lastInput < 90_000 || playing(false)))
      send({ margin: 'fp', op: 'beat', from: last, to: now });
    last = 0;
  };
  open();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else { last = active() ? Date.now() : 0; open(); }
  });
  addEventListener('pagehide', flush);
  addEventListener('pageshow', (event: PageTransitionEvent) => {
    if (event.persisted) { last = active() ? Date.now() : 0; open(); }
  });
  every(BEAT, beat, { hidden: true }); // 后台播放也要计时，所以隐藏时不暂停
}
