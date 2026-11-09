import { setIntroActive, SESSION_KEY } from './gate';
import { BILI, BILI_TIGHT } from './logo';
export { BILI, BILI_TIGHT };
export { shouldPlayIntro } from './gate';
import { createRenderer, endOf, frameAt, loadLogo, LOOKS, type Settings } from './engine';
import { setMarkup } from '../dom';

/** B 站小电视（Simple Icons，CC0）——只取形状，颜色由主题给 */

/** 小电视的可见部分（天线顶到机身底），飞行和顶栏用这个 viewBox 让尺寸按可见像素对齐 */
/** 末帧小电视宽度 ÷ 玻璃方块尺寸 ÷ (logoScale × finalScale)，实测标定（1440×900 亮色：122px / 256px） */
const LOGO_FIT = 0.961;


function softwareGl(canvas: HTMLCanvasElement): boolean {
  try { if (localStorage.getItem('margin:force-gl')) return false; } catch { /* ignore */ }
  const gl = canvas.getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r);
}

/**
 * 首页开场：21st.dev「Glass Reveal」——一滴玻璃落下、铺成圆角方块，B 站小电视在玻璃边缘被折射出彩边，
 * 然后玻璃松开，留下图标，整层淡出露出首页。约 3.8 秒，点击 / 按键 / 滚轮立即跳过。
 */
export function playIntro(parent: HTMLElement, theme: 'light' | 'dark'): Promise<void> {
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
  setIntroActive(true);
  const dark = theme === 'dark';
  // 底色和首页画布一致，淡出时无缝接上
  const bg = dark ? '#111112' : '#f5f4f1';
  const P: Settings = {
    ...LOOKS[dark ? 'dark' : 'light'],
    background: bg,
    plateColor: dark ? '#1a1a1c' : '#ffffff',
    logoColor: dark ? '#ffffff' : '#00aeec',
    logoScale: 0.62,
    finalScale: dark ? 0.9 : 0.8,
    startZoom: 2.3,
  };
  const el = document.createElement('div');
  el.className = 'intro';
  el.style.background = bg;
  el.setAttribute('role', 'presentation');
  const canvas = document.createElement('canvas');
  el.append(canvas);
  parent.append(el);

  return new Promise<void>((resolve) => {
    let raf = 0, done = false;
    let tilePx = 0;
    let renderer: ReturnType<typeof createRenderer> = null;
    let fallback: HTMLElement | null = null;
    let fallbackAnimation: Animation | null = null;
    let timeout = 0;
    let sizeObserver: ResizeObserver | null = null;
    const finish = (fast = false) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      fallbackAnimation?.cancel();
      sizeObserver?.disconnect();
      setIntroActive(false);
      removeEventListener('keydown', skip, true);
      if (!fast && tilePx && flyToBrand()) return;
      el.style.transition = `opacity ${fast ? 0.25 : 0.6}s cubic-bezier(.4, 0, .2, 1)`;
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      setTimeout(() => { renderer?.dispose(); el.remove(); }, fast ? 300 : 650);
      resolve();
    };
    /** 末帧留在屏幕中央的小电视换成 DOM 图标，直接飞到顶栏左上角落位；目标不在视口里就照旧淡出 */
    const flyToBrand = (): boolean => {
      const target = parent.querySelector<HTMLElement>('.top .brand .tv');
      if (!target) return false;
      const to = target.getBoundingClientRect();
      if (!to.width || to.bottom < 0 || to.top > innerHeight) return false;
      const cr = canvas.getBoundingClientRect();
      const w = tilePx * P.logoScale * P.finalScale * LOGO_FIT;
      const hgt = w * 21 / 24;
      const fly = document.createElement('div');
      fly.className = 'intro-fly';
      setMarkup(fly, BILI_TIGHT);
      Object.assign(fly.style, { left: `${cr.left + cr.width / 2 - w / 2}px`, top: `${cr.top + cr.height / 2 - hgt / 2}px`, width: `${w}px`, height: `${hgt}px`, color: P.logoColor });
      parent.append(fly);
      canvas.style.visibility = 'hidden';
      if (fallback) fallback.style.visibility = 'hidden';
      target.style.visibility = 'hidden';
      const from = fly.getBoundingClientRect();
      const dx = to.left - from.left, dy = to.top - from.top, k = to.width / from.width;
      const ease = 'cubic-bezier(.65, 0, .35, 1)';
      el.style.transition = `opacity .5s ${ease}`;
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      const end = getComputedStyle(target).color;
      const anim = fly.animate([
        { transform: 'translate(0, 0) scale(1)', color: P.logoColor },
        { transform: `translate(${dx}px, ${dy}px) scale(${k})`, color: end },
      ], { duration: 750, easing: ease, fill: 'forwards' });
      let landed = false;
      const land = () => { if (landed) return; landed = true; target.style.visibility = ''; fly.remove(); renderer?.dispose(); el.remove(); };
      anim.finished.then(land, land);
      setTimeout(land, 1500); // 保险：动画被节流 / 后台标签页时也一定落位
      resolve();
      return true;
    };
    const skip = () => finish(true);
    el.addEventListener('pointerdown', skip);
    el.addEventListener('wheel', skip, { passive: true });
    addEventListener('keydown', skip, true);

    const software = softwareGl(canvas);
    try { renderer = createRenderer(canvas); } catch (e) { console.info('[MARGIN] 开场动画不可用', e); }
    // 保险：任何意外都不让开场挡住首页超过 6 秒
    timeout = window.setTimeout(() => { try { if (localStorage.getItem('margin:intro-freeze')) return; } catch { /* ignore */ } finish(); }, 6000);
    if (!renderer) {
      // WebGL 不可用时仍播放轻量的小电视入场与落位。
      tilePx = Math.min(P.tileSize, Math.min(innerWidth, innerHeight) / 1.75);
      fallback = document.createElement('div');
      fallback.className = 'intro-fallback';
      Object.assign(fallback.style, { width: `${tilePx}px`, height: `${tilePx}px`, color: P.logoColor, background: P.plateColor });
      setMarkup(fallback, BILI_TIGHT);
      const logo = fallback.querySelector('svg')!;
      logo.style.width = `${P.logoScale * P.finalScale * LOGO_FIT * 100}%`;
      el.append(fallback);
      fallbackAnimation = fallback.animate([
        { opacity: 0, transform: 'scale(.25)', offset: 0 },
        { opacity: 1, transform: 'scale(1.04)', offset: .3 },
        { opacity: 1, transform: 'scale(1)', offset: .5 },
        { opacity: 1, transform: 'scale(1)', offset: 1 },
      ], { duration: 2400, easing: 'cubic-bezier(.23, 1, .32, 1)', fill: 'both' });
      fallbackAnimation.finished.then(() => finish(), () => {});
      return;
    }

    loadLogo(BILI).then((logo) => {
      if (done) return;
      renderer!.setLogo(logo);
      const end = endOf(P);
      const t0 = performance.now();
      // 调试 / 截图用：localStorage margin:intro-freeze = 秒数，停在那一帧
      let freeze = NaN;
      try { freeze = parseFloat(localStorage.getItem('margin:intro-freeze') ?? ''); } catch { /* ignore */ }
      // Read geometry once, then let ResizeObserver supply size changes. Reading
      // clientWidth/clientHeight on every frame can flush the page's pending layout.
      let cw = canvas.clientWidth, ch = canvas.clientHeight;
      let sizeDirty = true, w = 1, hh = 1, tile = 0;
      sizeObserver = new ResizeObserver(([entry]) => {
        if (done || !entry) return;
        const width = Math.round(entry.contentRect.width), height = Math.round(entry.contentRect.height);
        if (width === cw && height === ch) return;
        cw = width; ch = height; sizeDirty = true;
      });
      sizeObserver.observe(canvas);
      // Native 60Hz screens keep their existing budget; high-refresh screens aim for ~10ms.
      // Reduce pixel density only after repeated misses, keeping the same shader and timeline.
      let dprCap = Math.min(devicePixelRatio || 1, software ? 0.75 : 1.5);
      let last = 0, slow = 0, nativeFrameMs = 1000 / 60;
      const tick = (now: number) => {
        const t = Number.isFinite(freeze) ? freeze : (now - t0) / 1000;
        if (last && t > 0.15) {
          const gap = now - last;
          if (gap >= 4) nativeFrameMs = Math.min(nativeFrameMs, gap);
          const budget = Math.max(10, nativeFrameMs) * 1.35;
          slow = gap > budget ? slow + 1 : Math.max(0, slow - 1);
          if (slow >= 4 && dprCap > 0.6) { dprCap = Math.max(0.6, dprCap * 0.75); slow = 0; sizeDirty = true; }
        }
        last = now;
        if (sizeDirty) {
          w = Math.max(1, Math.round(cw * dprCap)); hh = Math.max(1, Math.round(ch * dprCap));
          if (canvas.width !== w) canvas.width = w;
          if (canvas.height !== hh) canvas.height = hh;
          tile = Math.min(P.tileSize, Math.min(cw, ch) / 1.75);
          tilePx = tile;
          sizeDirty = false;
        }
        renderer!.render(frameAt(Math.min(t, end), P), w, hh, tile * dprCap);
        if (Number.isFinite(freeze)) return;
        if (t >= end + 0.25) { finish(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }).catch((e) => { console.info('[MARGIN] 开场图标加载失败', e); finish(true); });
  });
}
