/**
 * 弹幕空降（移植自 Bilibili-Evolved 的「启用弹幕空降」组件，作者 kdxcxs，MIT）：
 * 给「03:20」「空降 2:15」这类弹幕加下划线，点一下就跳到对应时间。
 * 只在 www.bilibili.com 的播放页生效；跳转用原生 video 的 currentTime，不碰播放器内部接口。
 */
import { parseAirborneTime } from '../danmaku-time';
import { every } from '../sched';
import { fmtDuration, h } from '../ui/dom';

/** 播放器把弹幕渲染成 DOM 节点的容器：新版 bpx 播放器，以及老版播放器的普通/高级/BAS 弹幕层 */
const containers = ['.bpx-player-row-dm-wrap', '.bilibili-player-video-danmaku', '.bilibili-player-video-adv-danmaku', '.bilibili-player-video-bas-danmaku'];
/** 单条弹幕的 class，新旧播放器不一样 */
const danmakuTokens = ['bili-danmaku-x-dm', 'b-danmaku', 'bili-dm'];
const danmakuSelector = danmakuTokens.map((t) => `.${t}`).join(',');
/** 认得出时间的弹幕挂这个 class，下划线、光标和点击命中都跟着它走 */
const MARK = 'margin-dm-air';
const videoSelector = '.bpx-player-video-wrap video, .bpx-player-container video, #bilibili-player video';

let stop: (() => void) | null = null;

/** 只有这些页面有带弹幕的播放器；别的页面不扫描，省掉每秒的查询 */
const hasPlayerPage = (): boolean =>
  location.hostname === 'www.bilibili.com' && /^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?(?:video\/|bangumi\/play\/|list\/|festival\/|cheese\/play\/|s\/video\/)/.test(location.pathname);

/** 单条弹幕：认得出时间就挂标记，认不出就摘掉（弹幕元素会被复用，文字会变） */
function markOne(el: HTMLElement): void {
  el.classList.toggle(MARK, !Number.isNaN(parseAirborneTime(el.textContent)));
}

/** 从点击目标往上找被标记的弹幕 */
function danmakuFrom(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(`.${MARK}`) : null;
}

/** 开关弹幕空降：开时扫描播放器的弹幕层并挂点击监听，关时全部撤掉 */
export function setDanmakuAirborne(enabled: boolean): void {
  if (!enabled) {
    stop?.();
    stop = null;
    document.documentElement.classList.remove('margin-airborne');
    return;
  }
  if (stop || !hasPlayerPage()) return;
  document.documentElement.classList.add('margin-airborne');
  const observers = new Map<Element, MutationObserver>();
  let notice: HTMLElement | null = null, noticeTimer = 0;
  let detachNotice: (() => void) | null = null;
  const clearNotice = () => {
    clearTimeout(noticeTimer); notice?.remove(); notice = null;
    detachNotice?.(); detachNotice = null;
  };
  const seekTo = (el: HTMLElement, time: number): boolean => {
    const player = el.closest<HTMLElement>('.bpx-player-container, #bilibili-player');
    const video = player?.querySelector<HTMLVideoElement>(videoSelector);
    if (!player || !video || !Number.isFinite(video.duration) || time < 0 || time >= video.duration) return false;
    const resume = video.currentTime, href = location.href, src = video.currentSrc;
    try { video.currentTime = time; } catch { return false; }
    clearNotice();
    document.getElementById('margin-danmaku-jump')?.remove();
    document.getElementById('margin-sponsor-notice')?.remove();
    const host = h('div', { id: 'margin-danmaku-airborne' });
    host.style.cssText = 'position:absolute;left:20px;bottom:64px;max-width:calc(100% - 40px);z-index:100;pointer-events:auto';
    const root = host.attachShadow({ mode: 'open' });
    root.append(h('style', {}, ':host{font:13px/1.5 system-ui;color:#fff}div{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:10px 14px;border-radius:10px;background:#202124}button{font:inherit;border:0;border-radius:6px;padding:4px 8px;background:#fff;color:#202124;cursor:pointer}button:focus-visible{outline:2px solid #00aeec;outline-offset:2px}'));
    const undo = h('button', { type: 'button' }, '撤销跳转');
    undo.addEventListener('click', () => {
      if (video.isConnected && location.href === href && video.currentSrc === src && resume < video.duration) video.currentTime = resume;
      clearNotice();
    });
    root.append(h('div', { role: 'status' }, h('span', {}, `已跳到 ${fmtDuration(time)}`), undo,
      h('button', { type: 'button', onclick: clearNotice, 'aria-label': '关闭跳转提示' }, '关闭')));
    player.append(host); notice = host;
    video.addEventListener('emptied', clearNotice);
    video.addEventListener('loadstart', clearNotice);
    detachNotice = () => { video.removeEventListener('emptied', clearNotice); video.removeEventListener('loadstart', clearNotice); };
    noticeTimer = window.setTimeout(clearNotice, 10_000);
    return true;
  };

  const onMutations = (records: MutationRecord[]): void => {
    const touched = new Set<HTMLElement>();
    for (const r of records) {
      if (r.type === 'characterData') {
        // 弹幕元素被复用时只换里面的文字节点
        const owner = r.target.parentElement?.closest<HTMLElement>(danmakuSelector);
        if (owner) touched.add(owner);
        continue;
      }
      if (!(r.target instanceof Element)) continue;
      const owner = r.target.closest<HTMLElement>(danmakuSelector);
      if (owner) touched.add(owner);
      for (const node of r.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(danmakuSelector)) touched.add(node as HTMLElement);
        else node.querySelectorAll<HTMLElement>(danmakuSelector).forEach((d) => touched.add(d));
      }
    }
    touched.forEach(markOne);
  };

  const attach = (container: Element): void => {
    if (observers.has(container)) return;
    const ob = new MutationObserver(onMutations);
    ob.observe(container, { childList: true, subtree: true, characterData: true });
    observers.set(container, ob);
    // 容器里可能已经有弹幕了（切分P、开关弹幕之后的回来）
    container.querySelectorAll<HTMLElement>(danmakuSelector).forEach(markOne);
  };

  /** 播放器会在切 P / 切清晰度时重建弹幕层，所以每秒对一次账 */
  const sync = (): void => {
    if (!hasPlayerPage()) {
      observers.forEach((ob, container) => {
        ob.disconnect();
        container.querySelectorAll(`.${MARK}`).forEach(el => el.classList.remove(MARK));
        observers.delete(container);
      });
      clearNotice();
      return;
    }
    const found = new Set<Element>();
    for (const sel of containers) document.querySelectorAll(sel).forEach((c) => found.add(c));
    observers.forEach((ob, container) => {
      if (found.has(container)) return;
      ob.disconnect();
      container.querySelectorAll(`.${MARK}`).forEach(el => el.classList.remove(MARK));
      observers.delete(container);
    });
    found.forEach(attach);
  };

  const onClick = (e: MouseEvent): void => {
    if (!hasPlayerPage()) return;
    const el = danmakuFrom(e.target);
    if (!el?.closest(containers.join(','))) return;
    const time = parseAirborneTime(el.textContent);
    if (!Number.isFinite(time) || !seekTo(el, time)) return;
    // 点弹幕只是为了跳，不该顺带把播放器暂停
    e.preventDefault();
    e.stopPropagation();
  };

  // 弹幕层整体不吃指针事件，只有标记过的那几条能接住点击，所以监听挂在 document 上
  document.addEventListener('click', onClick, true);
  sync();
  const cancel = every(1000, sync);
  stop = () => {
    cancel();
    clearNotice();
    document.removeEventListener('click', onClick, true);
    observers.forEach((ob) => ob.disconnect());
    observers.clear();
    document.querySelectorAll(`.${MARK}`).forEach((el) => el.classList.remove(MARK));
  };
}
