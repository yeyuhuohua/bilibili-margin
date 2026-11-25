/**
 * 玻璃文件夹 —— 按 21st「Glass Folder Cards」源码原生移植（无 React）。
 *
 * 三层：后板（封面或生成的纹理）→ 真实视频扇页 → 窄折射袋沿与实底文字板。
 * - 静止：合上，视频只露出一点顶边
 * - 悬停 / 聚焦：前板沿底边铰链前倾，视频从口袋里略微升起
 * - 打开（点击 / Enter / Space）：前板继续前倒，视频升起并扇形展开，每张都能点
 * - ···：毛玻璃菜单，可键盘操作（↑↓ Home End Esc）
 * - 首次进入视口时组装；指针移动带视差；尊重 prefers-reduced-motion
 */
import { fanSlot, hashString, paint, recipeOf, rng, type ArtPreset } from './folder-art';
import { h, icon, ICONS } from './dom';
import { ensureFolderPocket, FOLDER_BACK, folderPocketLayers } from './folder-pocket';
import { uiReducedMotion as reducedMotion } from '../motion';

export interface GFFile { name: string; meta?: string; image?: string; art?: ArtPreset; href?: string }
export interface GFMenuItem { label: string; onSelect?: () => void; danger?: boolean }
export interface GFOptions {
  label: string;
  meta?: string;
  image?: string;
  art?: ArtPreset | 'none';
  seed?: number;
  files?: GFFile[];
  menu?: GFMenuItem[];
  width?: number;
  appearDelay?: number;
  onOpenChange?: (open: boolean) => void;
  /** 返回 true 时点击不弹出扇形文件，改为调用 onDirect（设置「收藏夹直接展开」） */
  direct?: () => boolean;
  onDirect?: () => void;
  onFileSelect?: (file: GFFile, index: number) => void;
}
export interface GlassFolderApi { el: HTMLElement; setFiles(files: GFFile[]): void; setOpen(open: boolean): void; isOpen(): boolean; dispose(): void }

const NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 272;
const HEADROOM = 90; // 打开时 4 张视频叠起最高到 -90px，整张都留在卡片自己的区域里，不压到上一行

const SHEET_W = 272;
const SHEET_H = 184;
const MAX_VISIBLE = 4;
let uidSeq = 0;

function svg(cls: string, w: number, hh: number, d: string): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', `0 0 ${w} ${hh}`);
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

/** 生成纹理画布：先占位模糊，画好后淡入（全页共用一个分帧绘制队列） */
function artCanvas(art: ArtPreset, seed: number, w: number, hh: number, density: number, priority: number, cls: string, pending: Map<HTMLCanvasElement, () => void>): HTMLCanvasElement {
  const c = h('canvas', { class: cls, 'aria-hidden': 'true', style: `width:${w}px;height:${hh}px;max-width:none` }) as HTMLCanvasElement;
  pending.set(c, () => void paint(recipeOf(art), seed, Math.round(w * density), Math.round(hh * density), priority).then((src) => {
    if (!c.isConnected) return;
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')?.drawImage(src, 0, 0);
    c.dataset.ready = '';
  }));
  return c;
}

export function glassFolder(o: GFOptions): GlassFolderApi {
  const uid = `gf${++uidSeq}`;
  const width = o.width ?? W;
  let k = width / W;
  const density = Math.min(1.5, Math.max(1, devicePixelRatio || 1)) * k;
  let open = false;
  let menuOpen = false;
  let disposed = false;
  let inView = false;
  const pendingArt = new Map<HTMLCanvasElement, () => void>();
  let files: GFFile[] = [];

  const root = h('div', { class: 'gf-root', style: `width:${width}px;height:${(H + HEADROOM) * k}px` });
  const stage = h('div', { class: 'gf-stage', style: `transform:translateY(${HEADROOM * k}px) scale(${k})` });
  const tilt = h('div', { class: 'gf-tilt' });

  // 后板与封面
  const back = h('div', { class: 'gf-back', style: `clip-path:path('${FOLDER_BACK}')`, 'aria-hidden': 'true' });
  if (o.image) back.append(h('img', { class: 'gf-art', src: o.image, alt: '', width: W + 24, height: H + 24, draggable: 'false', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }));
  else if (o.art && o.art !== 'none') back.append(artCanvas(o.art, o.seed ?? 3, W + 24, H + 24, density, 0, 'gf-art', pendingArt));
  back.append(h('div', { class: 'gf-back-sheen' }));

  // 袋面和原有操作键分别渲染，折射不会碰到文字或改变点击区域。
  const hit = h('button', { type: 'button', class: 'gf-hit', title: o.label, 'aria-expanded': 'false' }) as HTMLButtonElement;
  const metaEl = h('span', { class: 'gf-meta' });
  const front = h('div', { class: 'gf-front' },
    ...folderPocketLayers(),
    hit,
    h('div', { class: 'gf-label' }, h('span', { class: 'gf-title' }, o.label), metaEl),
  );

  // 内容：Tab 顺序在玻璃之后，画面上在玻璃之下
  const filesEl = h('div', { class: 'gf-files', role: 'list', 'aria-label': `${o.label} 内容` });
  filesEl.toggleAttribute('inert', true);

  // ··· 键与菜单
  const key = h('button', { type: 'button', class: 'gf-key gf-key--more', 'aria-label': `${o.label} 更多操作`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': `${uid}-menu` }) as HTMLButtonElement;
  const glyph = icon(ICONS.more) as SVGElement;
  glyph.setAttribute('class', 'gf-glyph gf-glyph--more');
  glyph.setAttribute('aria-hidden', 'true');
  key.append(glyph);
  const menu = h('div', { class: 'gf-menu', role: 'menu', id: `${uid}-menu`, 'aria-label': `${o.label} 选项` });

  const shadowEl = h('div', { class: 'gf-shadow', 'aria-hidden': 'true' });
  tilt.append(shadowEl, back, svg('gf-rim gf-back-rim', W, H, FOLDER_BACK), front, filesEl, key, menu);
  stage.append(tilt);
  root.append(stage);

  // 仅移动真实封面；袋沿自然采样它背后的当前画面。
  const artEl = back.querySelector<HTMLElement>('.gf-art');
  function paintVisibleArt() {
    for (const [canvas, start] of pendingArt) {
      if (!root.contains(canvas)) pendingArt.delete(canvas);
      else if (inView) { pendingArt.delete(canvas); start(); }
    }
  }

  let metaNode = metaEl;
  const setMeta = (text: string) => {
    const n = metaNode.cloneNode() as HTMLElement; // 换新节点让数字滚入动画重放
    n.textContent = text;
    metaNode.replaceWith(n);
    metaNode = n;
  };

  function renderMenu() {
    const items: GFMenuItem[] = [{ label: open ? '收起文件夹' : '打开文件夹', onSelect: () => setOpen(!open) }, ...(o.menu ?? [])];
    menu.replaceChildren(...items.map((it) => h('button', {
      type: 'button', role: 'menuitem', class: `gf-menu-item${it.danger ? ' gf-menu-item--danger' : ''}`,
      tabindex: menuOpen ? -1 : undefined, disabled: menuOpen ? undefined : '',
      onclick: () => { setMenu(false); key.focus(); it.onSelect?.(); },
    }, it.label)));
  }

  function setMenu(next: boolean) {
    menuOpen = next;
    menu.toggleAttribute('data-open', next);
    key.setAttribute('aria-expanded', String(next));
    renderMenu();
    if (next) menu.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    listen();
  }

  function setOpen(next: boolean) {
    if (open === next) return;
    open = next;
    root.toggleAttribute('data-open', next);
    hit.setAttribute('aria-expanded', String(next));
    filesEl.toggleAttribute('inert', !next);
    label();
    if (menuOpen) renderMenu();
    listen();
    o.onOpenChange?.(next);
  }

  function label() {
    const n = o.meta ?? `${files.length} 项`;
    hit.setAttribute('aria-label', `${open ? '收起' : '打开'}${o.label}，${n}`);
  }

  function setFiles(next: GFFile[]) {
    if (disposed) return;
    const first = !files.length;
    files = next;
    const start = Math.max(0, files.length - MAX_VISIBLE);
    const visible = files.slice(start);
    filesEl.replaceChildren(...visible.map((file, v) => {
      const jitter = rng(hashString(file.name) + start + v);
      const picture = !!(file.art || file.image);
      const inner: (Node | null)[] = [
        file.image
          ? h('img', { class: 'gf-sheet-art', src: file.image, alt: '', width: SHEET_W, height: SHEET_H, draggable: 'false', loading: 'lazy', referrerpolicy: 'no-referrer' })
          : file.art
            ? artCanvas(file.art, hashString(file.name) % 997, SHEET_W, SHEET_H, Math.min(density, 1.25), 1, 'gf-sheet-art', pendingArt)
            : h('span', { class: 'gf-lines', 'aria-hidden': 'true' }, ...[86, 92, 64, 88, 42].map((w) => h('i', { style: `width:${w}%` }))),
        h('span', { class: 'gf-sheet-head' }, h('span', { class: 'gf-sheet-name' }, file.name), file.meta ? h('span', { class: 'gf-sheet-meta' }, file.meta) : null),
      ];
      const style = `--gf-slot:${fanSlot(v, visible.length)};--gf-depth:${visible.length - 1 - v};--gf-jx:${((jitter() - 0.5) * 10).toFixed(2)}px;--gf-jr:${((jitter() - 0.5) * 3.2).toFixed(2)}deg;z-index:${v + 1}${first ? `;animation-delay:${0.1 + v * 0.09}s` : ''}`;
      const cls = `gf-sheet${picture ? ' gf-sheet--art' : ''}${first ? ' gf-sheet--drop' : ''}`;
      const sel = () => o.onFileSelect?.(file, start + v);
      const el = file.href
        ? h('a', { class: cls, style, href: file.href, target: '_blank', rel: 'noopener', title: file.name, onclick: sel }, ...inner)
        : h('button', { class: cls, style, type: 'button', onclick: sel }, ...inner);
      el.addEventListener('animationend', () => el.classList.remove('gf-sheet--drop'), { once: true });
      return h('div', { role: 'listitem', class: 'gf-sheet-slot' }, el);
    }));
    if (!o.meta) setMeta(`${files.length} 项`);
    label();
    paintVisibleArt();
  }

  // 指针视差跟随，不触发重排
  let raf = 0;
  let px = 0;
  let py = 0;
  let pointerX = 0, pointerY = 0, tracking = false;
  let pointerRect: DOMRect | null = null;
  let pointerScope: Document | ShadowRoot | null = null;
  const invalidatePointer = () => {
    pointerRect = null;
    if (tracking && !raf) raf = requestAnimationFrame(write);
  };
  const write = () => {
    raf = 0;
    if (reducedMotion()) {
      tilt.style.transform = '';
      shadowEl.style.transform = '';
      if (artEl) artEl.style.transform = '';
      return;
    }
    if (tracking) {
      const r = pointerRect ??= root.getBoundingClientRect();
      px = ((pointerX - r.left) / r.width) * 2 - 1;
      py = ((pointerY - r.top) / r.height) * 2 - 1;
    } else px = py = 0;
    // 直接写这几层的 transform，避免重算整棵子树。
    tilt.style.transform = px || py ? `translate(${(px * 3).toFixed(2)}px, ${(py * 2).toFixed(2)}px)` : '';
    shadowEl.style.transform = px ? `translateX(${(px * -8).toFixed(2)}px)` : '';
    if (artEl) artEl.style.transform = px || py ? `translate(${(px * -7).toFixed(2)}px, ${(py * -6).toFixed(2)}px) scale(1.02)` : '';
  };
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || reducedMotion()) return;
    if (!tracking) {
      pointerRect = null;
      pointerScope = root.getRootNode() as Document | ShadowRoot;
      pointerScope.addEventListener('scroll', invalidatePointer, { capture: true, passive: true });
      addEventListener('scroll', invalidatePointer, { capture: true, passive: true });
      addEventListener('resize', invalidatePointer, { passive: true });
    }
    pointerX = e.clientX; pointerY = e.clientY; tracking = true;
    if (!raf) raf = requestAnimationFrame(write);
  });
  root.addEventListener('pointerleave', () => {
    tracking = false; pointerRect = null;
    pointerScope?.removeEventListener('scroll', invalidatePointer, true);
    pointerScope = null;
    removeEventListener('scroll', invalidatePointer, true);
    removeEventListener('resize', invalidatePointer);
    if (!raf) raf = requestAnimationFrame(write);
  });

  hit.addEventListener('click', () => { setMenu(false); if (o.direct?.()) { if (open) setOpen(false); o.onDirect?.(); return; } setOpen(!open); });
  key.addEventListener('click', () => setMenu(!menuOpen));
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll<HTMLElement>('[role=menuitem]')];
    const active = (root.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement;
    const at = items.indexOf(active);
    const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') setMenu(false);
  });

  // Esc 与点外面：关掉当前打开的（菜单优先）。影子 DOM 里要用 composedPath 判断
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation(); // 先关文件夹，不要连抽屉一起关
    if (menuOpen) { setMenu(false); key.focus(); } else { setOpen(false); hit.focus(); }
  };
  const onDown = (e: PointerEvent) => {
    const path = e.composedPath();
    if (menuOpen && !path.includes(menu) && !path.includes(key)) setMenu(false);
    if (open && !menuOpen && !path.includes(root)) setOpen(false);
  };
  let listening = false;
  function listen() {
    const want = open || menuOpen;
    if (want === listening) return;
    listening = want;
    const m = want ? 'addEventListener' : 'removeEventListener';
    document[m]('keydown', onKey as EventListener, true);
    document[m]('pointerdown', onDown as EventListener);
  }

  // 进入视口后才生成纹理和挂接共享袋口。
  let enterTimer = 0;
  const io = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    inView = entry.isIntersecting;
    if (!inView) return;
    if (!enterTimer) {
      ensureFolderPocket(root);
      enterTimer = window.setTimeout(() => root.toggleAttribute('data-entered', true), o.appearDelay ?? 0);
    }
    paintVisibleArt();
  }, { threshold: 0.25 });
  io.observe(root);
  let measuredWidth = width;
  const ro = new ResizeObserver(([entry]) => {
    const w = entry.contentRect.width;
    if (!w || Math.abs(w - measuredWidth) < .5) return;
    measuredWidth = w;k = w / W;
    invalidatePointer();
    root.style.height = `${(H + HEADROOM) * k}px`;
    stage.style.transform = `translateY(${HEADROOM * k}px) scale(${k})`;
  });
  ro.observe(root);

  const dispose = () => {
    disposed = true; open = false; menuOpen = false; listen();
    io.disconnect(); ro.disconnect(); clearTimeout(enterTimer);
    cancelAnimationFrame(raf);
    pendingArt.clear();
    pointerScope?.removeEventListener('scroll', invalidatePointer, true);
    pointerScope = null;
    removeEventListener('scroll', invalidatePointer, true);
    removeEventListener('resize', invalidatePointer);
  };
  const api = { el: root, setFiles, setOpen, isOpen: () => open, dispose };
  if (o.meta) setMeta(o.meta);
  renderMenu();
  setFiles(o.files ?? []);
  return api;
}
