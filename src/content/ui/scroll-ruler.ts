import { h } from './dom';
import { uiReducedMotion as reducedMotion } from '../motion';

/**
 * 刻度尺滚动进度：21st「Scroll Bars」（radiumcoders）竖向版的原生移植。
 * 51 根刻度、每 5 根一根长刻度，刻度入场是弹簧（damping 12 / stiffness 120）逐根长出；
 * 指示条跟随滚动进度，弹簧 stiffness 200 / damping 20。
 * 只在滚动时和悬停时出现；点刻度跳到那个位置，按住可以上下拖。
 */
const COUNT = 51, MAJOR = 5, GAP = 5;

export function createScrollRuler(): HTMLElement {
  const ticks = Array.from({ length: COUNT }, (_, i) => h('i', { class: i % MAJOR === 0 ? 'major' : '', style: `--d:${i * 8}ms` }));
  const ind = h('b', { class: 'sr-ind' });
  const pct = h('span', { class: 'sr-pct' }, '0%');
  const track = h('div', { class: 'sr-track' }, ...ticks, ind, pct);
  const el = h('div', { class: 'sr', 'aria-hidden': 'true', 'data-on': 'false' }, track);
  const H = (COUNT - 1) * GAP;

  let y = 0, v = 0, target = 0, raf = 0, last = 0, idle = 0;
  // 可滚动高度缓存起来：滚动事件里读 scrollHeight 会在 B 站页面还在变的时候强制布局（v0.44 性能）
  let max = 0;
  const measure = () => { max = document.documentElement.scrollHeight - innerHeight; };
  const ro = new ResizeObserver(() => measure());
  const watchBody = () => { if (document.body) ro.observe(document.body); else requestAnimationFrame(watchBody); };
  watchBody();
  addEventListener('resize', measure, { passive: true });
  const progress = () => (max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0);
  let litAt = -99;
  const tick = (t: number) => {
    let dt = Math.min(0.05, (t - last) / 1000); last = t;
    while (dt > 0) { const s = Math.min(dt, 1 / 120); dt -= s; const a = -200 * (y - target) - 20 * v; v += a * s; y += v * s; }
    ind.style.transform = `translateY(${y}px)`; pct.style.transform = `translateY(${y}px)`;
    const near = Math.round(y / GAP);
    if (near !== litAt) {
      for (let i = Math.max(0, Math.min(near, litAt) - 1); i <= Math.min(COUNT - 1, Math.max(near, litAt) + 1); i++) ticks[i].classList.toggle('lit', Math.abs(i - near) <= 1);
      litAt = near;
    }
    if (Math.abs(y - target) < 0.05 && Math.abs(v) < 0.05) { raf = 0; return; }
    raf = requestAnimationFrame(tick);
  };
  const update = () => {
    const p = progress();
    target = p * H;
    const label = `${Math.round(p * 100)}%`;
    if (pct.textContent !== label) pct.textContent = label;
    if (reducedMotion()) { y = target; v = 0; }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  };
  const hideIdle = () => { idle = 0; if (!el.matches(':hover')) el.dataset.on = 'false'; };
  const show = () => {
    el.dataset.on = 'true';
    clearTimeout(idle);
    idle = window.setTimeout(hideIdle, 1400);
  };
  // 滚动事件里不读 scrollY（会强制布局），合并到下一帧再读（v0.44）
  let pend = 0;
  const onScroll = () => { pend = 0; if (scrollY < 40) { el.dataset.on = 'false'; update(); return; } update(); if (el.dataset.on !== 'true' || !idle) show(); else { clearTimeout(idle); idle = window.setTimeout(hideIdle, 1400); } };
  addEventListener('scroll', () => { if (!pend) pend = requestAnimationFrame(onScroll); }, { passive: true });
  el.addEventListener('pointerenter', () => { clearTimeout(idle); el.dataset.on = 'true'; });
  el.addEventListener('pointerleave', () => show());
  // 点刻度跳过去；按住上下拖动连续滚动（v0.47，评论区：刻度条只能单点不能拖）
  const at = (clientY: number, r: DOMRect) => Math.min(1, Math.max(0, (clientY - r.top) / H));
  let drag: DOMRect | null = null, moved = false;
  track.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = track.getBoundingClientRect(); moved = false;
    track.setPointerCapture(e.pointerId);
    el.dataset.drag = 'true';
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag) return;
    moved = true;
    scrollTo({ top: at(e.clientY, drag) * max, behavior: 'instant' as ScrollBehavior });
  });
  const end = (e: PointerEvent) => {
    if (!drag) return;
    const r = drag; drag = null;
    delete el.dataset.drag;
    if (!moved) scrollTo({ top: at(e.clientY, r) * max, behavior: reducedMotion() ? 'auto' : 'smooth' });
    show();
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', (e) => { drag = null; delete el.dataset.drag; void e; });
  update();
  return el;
}
