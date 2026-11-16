import { h, icon, ICONS } from './dom';
import { uiReducedMotion } from '../motion';
import {
  clampPan, nextZoomStep, panLimits, wheelZoomFactor, zoomAtPoint,
  ZOOM_MAX, ZOOM_MIN, type ZoomBounds, type ZoomState,
} from './lightbox-zoom';

/**
 * 图组查看器（v0.47.2，GitHub #8：动态页点小图直接开新标签，不能连续看图组）。
 * 挂在卡片所在的 Shadow Root 里；← → 切换、Esc / 点空白关闭，滚轮 / 双击 / +/- 缩放，放大后拖拽平移，
 * 底部缩略图条，右上角「原图」新标签打开。背景是实底遮罩，不用 backdrop-filter。
 */
let cur: { close: () => void } | null = null;

const imageSource = (p: string, width: number) => /^https:\/\/[^/]+\.(?:hdslb|biliimg)\.com\/[^?@#]+$/.test(p) && !/\.gif$/i.test(p) ? `${p}@${width}w.webp` : p;

export function openLightbox(pics: string[], start: number, root: Node): void {
  cur?.close();
  if (!pics.length) return;
  const lastFocus = (root instanceof ShadowRoot ? root.activeElement : document.activeElement) as HTMLElement | null;
  let closed = false;
  let i = Math.max(0, Math.min(pics.length - 1, start));
  const big = h('img', { class: 'lb-img', alt: '', referrerpolicy: 'no-referrer', decoding: 'async', draggable: 'false' }) as HTMLImageElement;
  big.draggable = false;
  const count = h('span', { class: 'lb-count' });
  const zoomOut = h('button', { type: 'button', class: 'lb-zoom-btn', 'aria-label': '缩小', title: '缩小 (-)', onclick: (e: Event) => { e.stopPropagation(); stepZoom(-1); } }, icon(ICONS.minus));
  const zoomPct = h('button', { type: 'button', class: 'lb-zoom-val', 'aria-label': '重置缩放，当前 100%', title: '重置为 100% (0)', onclick: (e: Event) => { e.stopPropagation(); resetZoom(true); } }, '100%');
  const zoomIn = h('button', { type: 'button', class: 'lb-zoom-btn', 'aria-label': '放大', title: '放大 (+)', onclick: (e: Event) => { e.stopPropagation(); stepZoom(1); } }, icon(ICONS.plus));
  const zoomBar = h('div', { class: 'lb-zoom', role: 'group', 'aria-label': '缩放控制' }, zoomOut, zoomPct, zoomIn);
  const raw = h('a', { class: 'lb-btn lb-raw', target: '_blank', rel: 'noopener' }, '原图');
  const thumbs = pics.length > 1 ? h('div', { class: 'lb-thumbs' }, ...pics.map((p, k) => h('button', { type: 'button', class: 'lb-th', 'aria-label': `第 ${k + 1} 张`, onclick: (e: Event) => { e.stopPropagation(); go(k); } },
    h('img', { src: imageSource(p, 96), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })))) : null;
  const prev = h('button', { type: 'button', class: 'lb-nav prev', 'aria-label': '上一张', onclick: (e: Event) => { e.stopPropagation(); go(i - 1); } }, icon(ICONS.back));
  const next = h('button', { type: 'button', class: 'lb-nav next', 'aria-label': '下一张', onclick: (e: Event) => { e.stopPropagation(); go(i + 1); } }, icon(ICONS.chevronRight));
  const shut = h('button', { type: 'button', class: 'lb-btn', 'aria-label': '关闭', onclick: () => close() }, '关闭');
  const stage = h('div', { class: 'lb-stage' }, pics.length > 1 ? prev : null, big, pics.length > 1 ? next : null);
  const el = h('div', { class: 'lb', role: 'dialog', 'aria-modal': 'true', 'aria-label': '查看图片' },
    h('div', { class: 'lb-top' }, count, h('span', { class: 'lb-sp' }), zoomBar, raw, shut),
    stage,
    thumbs);

  let zoom: ZoomState = { scale: 1, x: 0, y: 0 };
  let animTimer = 0;
  const bounds = (): ZoomBounds => ({ baseW: big.offsetWidth, baseH: big.offsetHeight, stageW: stage.clientWidth, stageH: stage.clientHeight });
  const stageCenter = () => { const r = stage.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

  function renderZoom(animate = false): void {
    const b = bounds();
    const clampedPos = clampPan(zoom.x, zoom.y, zoom.scale, b);
    zoom = { scale: zoom.scale, x: clampedPos.x, y: clampedPos.y };
    const pct = Math.round(zoom.scale * 100);
    zoomPct.textContent = `${pct}%`;
    zoomPct.setAttribute('aria-label', `重置缩放，当前 ${pct}%`);
    zoomOut.setAttribute('aria-disabled', String(pct <= Math.round(ZOOM_MIN * 100)));
    zoomIn.setAttribute('aria-disabled', String(pct >= Math.round(ZOOM_MAX * 100)));
    const { maxX, maxY } = panLimits(zoom.scale, b);
    const canPan = maxX > 0.5 || maxY > 0.5;
    big.toggleAttribute('data-pan', canPan);
    big.toggleAttribute('data-zoom-max', !canPan && pct >= Math.round(ZOOM_MAX * 100));
    const isIdentity = Math.abs(zoom.scale - 1) < 0.001 && Math.abs(zoom.x) < 0.1 && Math.abs(zoom.y) < 0.1;
    big.toggleAttribute('data-zoomed', !isIdentity);
    clearTimeout(animTimer);
    if (animate && !uiReducedMotion()) {
      big.setAttribute('data-anim', '');
      big.style.transform = isIdentity ? 'translate3d(0px, 0px, 0) scale(1)' : `translate3d(${zoom.x.toFixed(2)}px, ${zoom.y.toFixed(2)}px, 0) scale(${zoom.scale})`;
      if (isIdentity) {
        animTimer = window.setTimeout(() => {
          if (Math.abs(zoom.scale - 1) < 0.001 && Math.abs(zoom.x) < 0.1 && Math.abs(zoom.y) < 0.1) {
            big.removeAttribute('data-anim');
            big.style.transform = '';
          }
        }, 180);
      }
    } else {
      big.removeAttribute('data-anim');
      big.style.transform = isIdentity ? '' : `translate3d(${zoom.x.toFixed(2)}px, ${zoom.y.toFixed(2)}px, 0) scale(${zoom.scale})`;
    }
  }

  function setZoom(nextScale: number, clientX?: number, clientY?: number, animate = false): void {
    const center = stageCenter();
    const px = clientX === undefined ? 0 : clientX - center.x;
    const py = clientY === undefined ? 0 : clientY - center.y;
    zoom = zoomAtPoint(zoom, nextScale, px, py, bounds());
    renderZoom(animate);
  }

  function stepZoom(direction: 1 | -1): void {
    setZoom(nextZoomStep(zoom.scale, direction), undefined, undefined, true);
  }

  function resetZoom(animate = false): void {
    zoom = { scale: 1, x: 0, y: 0 };
    renderZoom(animate);
  }

  // 大图用 B 站图床缩放到 2000 宽以内的 webp，比原图小得多；预取相邻两张
  const src = (p: string) => imageSource(p, 2000);
  const pre = (k: number) => { if (k >= 0 && k < pics.length) { const im = new Image(); im.referrerPolicy = 'no-referrer'; im.src = src(pics[k]); } };
  function go(k: number): void {
    i = (k + pics.length) % pics.length;
    resetZoom(false);
    big.src = src(pics[i]);
    raw.setAttribute('href', pics[i]);
    count.textContent = pics.length > 1 ? `${i + 1} / ${pics.length}` : '';
    thumbs?.querySelectorAll('.lb-th').forEach((t, n) => t.toggleAttribute('data-on', n === i));
    (thumbs?.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest', inline: 'center' });
    pre(i + 1); pre(i - 1);
  }

  big.addEventListener('load', () => { if (!closed) renderZoom(false); });
  big.addEventListener('dragstart', (e) => e.preventDefault());
  big.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = Math.abs(zoom.scale - 1) > 0.05 ? 1 : 2;
    setZoom(target, e.clientX, e.clientY, true);
  });

  el.addEventListener('wheel', (e) => {
    if (closed) return;
    if (thumbs && thumbs.contains(e.target as Node)) {
      if (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        e.preventDefault();
        thumbs.scrollLeft += e.deltaY;
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const factor = wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey);
    setZoom(zoom.scale * factor, e.clientX, e.clientY, false);
  }, { passive: false });

  const pointers = new Map<number, { x: number; y: number }>();
  let downX = 0, downY = 0, panning = false, suppressClick = false, suppressTimer = 0;
  const clearSuppressSoon = () => { clearTimeout(suppressTimer); suppressTimer = window.setTimeout(() => { suppressClick = false; }, 0); };

  stage.addEventListener('pointerdown', (e) => {
    if (closed || (e.target as HTMLElement).closest('.lb-nav')) return;
    if (e.pointerType === 'mouse' && (e.button !== 0 || e.target !== big)) return;
    if (e.pointerType !== 'mouse' && pointers.size === 0 && e.target !== big && e.target !== stage) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downX = e.clientX;
      downY = e.clientY;
      panning = false;
      suppressClick = false;
      clearTimeout(suppressTimer);
    } else {
      panning = false;
      suppressClick = true;
      big.removeAttribute('data-panning');
    }
  });

  const onPointerMove = (e: PointerEvent) => {
    const prevPoint = pointers.get(e.pointerId);
    if (!prevPoint) return;
    if (pointers.size === 1) {
      const dx = e.clientX - prevPoint.x;
      const dy = e.clientY - prevPoint.y;
      prevPoint.x = e.clientX;
      prevPoint.y = e.clientY;
      if (!panning && Math.hypot(e.clientX - downX, e.clientY - downY) > 4) {
        suppressClick = true;
        const { maxX, maxY } = panLimits(zoom.scale, bounds());
        if (maxX > 0.5 || maxY > 0.5) {
          panning = true;
          big.setAttribute('data-panning', '');
          big.removeAttribute('data-anim');
        }
      }
      if (panning) {
        const pos = clampPan(zoom.x + dx, zoom.y + dy, zoom.scale, bounds());
        zoom = { scale: zoom.scale, x: pos.x, y: pos.y };
        renderZoom(false);
      }
    } else if (pointers.size === 2) {
      const pair = [...pointers.entries()];
      const a = pair[0][1], b = pair[1][1];
      const d0 = Math.hypot(b.x - a.x, b.y - a.y);
      const m0x = (a.x + b.x) / 2, m0y = (a.y + b.y) / 2;
      prevPoint.x = e.clientX;
      prevPoint.y = e.clientY;
      const d1 = Math.hypot(b.x - a.x, b.y - a.y);
      const m1x = (a.x + b.x) / 2, m1y = (a.y + b.y) / 2;
      suppressClick = true;
      panning = false;
      big.removeAttribute('data-panning');
      zoom = { scale: zoom.scale, x: zoom.x + (m1x - m0x), y: zoom.y + (m1y - m0y) };
      if (d0 > 0 && d1 > 0) setZoom(zoom.scale * (d1 / d0), m1x, m1y, false);
      else renderZoom(false);
    }
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) {
      panning = false;
      big.removeAttribute('data-panning');
    }
    if (pointers.size === 1) {
      const [rem] = pointers.values();
      downX = rem.x;
      downY = rem.y;
    }
    if (pointers.size === 0 && suppressClick) clearSuppressSoon();
  };

  const onResize = () => { if (!closed) renderZoom(false); };

  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (pics.length > 1) go(i - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); if (pics.length > 1) go(i + 1); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd')) { e.preventDefault(); e.stopPropagation(); stepZoom(1); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract')) { e.preventDefault(); e.stopPropagation(); stepZoom(-1); }
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '0' || e.code === 'Numpad0')) { e.preventDefault(); e.stopPropagation(); resetZoom(true); }
    else if (e.key === 'Tab') {
      const items = el.querySelectorAll<HTMLElement>('a[href],button:not([disabled])');
      const active = (el.getRootNode() as ShadowRoot | Document).activeElement;
      if (e.shiftKey && active === items[0]) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && active === items[items.length - 1]) { e.preventDefault(); items[0].focus(); }
    }
  };

  function close(): void {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(frame);
    clearTimeout(animTimer);
    clearTimeout(suppressTimer);
    removeEventListener('keydown', key, true);
    removeEventListener('pointermove', onPointerMove);
    removeEventListener('pointerup', onPointerEnd);
    removeEventListener('pointercancel', onPointerEnd);
    removeEventListener('resize', onResize);
    el.inert = true;
    el.removeAttribute('data-open');
    setTimeout(() => el.remove(), 200);
    lastFocus?.focus({ preventScroll: true });
    cur = null;
  }

  el.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; clearTimeout(suppressTimer); return; }
    if (e.target === el || e.target === stage) close();
  });
  addEventListener('keydown', key, true);
  addEventListener('pointermove', onPointerMove);
  addEventListener('pointerup', onPointerEnd);
  addEventListener('pointercancel', onPointerEnd);
  addEventListener('resize', onResize);
  const host = root instanceof ShadowRoot ? root : document.body;
  (host.querySelector('.app') ?? host).append(el);
  go(i);
  const frame = requestAnimationFrame(() => { el.setAttribute('data-open', ''); shut.focus({ preventScroll: true }); });
  cur = { close };
}
