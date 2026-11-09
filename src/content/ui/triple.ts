
import { setMarkup } from './dom';
import { onUiMotionChange, uiReducedMotion as reducedMotion } from '../motion';/**
 * 映间自己的「三连」动画，盖掉 B 站原版的长按动效。
 * 长按点赞：点赞 → 投币 → 收藏三个胶囊的描边依次被强调色填满（松手就倒退回去）；
 * B 站确认三连后（投币、收藏变成 .on），三个胶囊依次弹起，向外散出一圈碎光，
 * 点赞上方浮出一枚「三连 · TRIPLE」小签。
 * 动效参考 21st：「Hold to confirm」(motiondotdev 24668) 按住时按钮收缩、描边随进度变粗变色；
 * 「Like Burst」(ddoemonn 23534) 的确定性碎光分布（黄金比例散列角度/距离 + 弹簧回弹）。
 * 点赞/投币/收藏由 B 站完成；长按满环后的松手会延迟补发，保留原始指针信息。
 */
const NS = 'http://www.w3.org/2000/svg';
const HOLD = 1500;
const SEL = ['.video-like', '.video-coin', '.video-fav'];

function items(): HTMLElement[] | null {
  const els = SEL.map((s) => document.querySelector<HTMLElement>(`.video-toolbar-left-main ${s}`));
  return els.every(Boolean) ? (els as HTMLElement[]) : null;
}

function ring(el: HTMLElement): SVGRectElement {
  let svg = el.querySelector<SVGSVGElement>(':scope > svg.mt-ring');
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'mt-ring');
    svg.setAttribute('aria-hidden', 'true');
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('pathLength', '100');
    svg.append(r);
    el.append(svg);
  }
  const r = svg.firstElementChild as SVGRectElement;
  const w = el.offsetWidth, h = el.offsetHeight;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  r.setAttribute('x', '1'); r.setAttribute('y', '1');
  r.setAttribute('width', String(w - 2)); r.setAttribute('height', String(h - 2));
  r.setAttribute('rx', String((h - 2) / 2));
  return r;
}

function burst(els: HTMLElement[]): void {
  if (reducedMotion()) return;
  els.forEach((el, i) => {
    el.classList.add('mt-done');
    el.animate([{ scale: '1' }, { scale: '1.14', offset: 0.35 }, { scale: '.97', offset: 0.7 }, { scale: '1' }],
      { duration: 560, delay: i * 90, easing: 'cubic-bezier(.3,0,.2,1)' }).id = 'margin-triple';
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let k = 0; k < 12; k++) {
      const hh = (((k + 1 + i * 12) * 2654435761) % 997) / 997;
      const a = (k / 12) * Math.PI * 2 - Math.PI / 2 + (hh - 0.5) * 0.4;
      const d = 30 + hh * 26;
      const p = document.createElement('i');
      p.className = k % 3 ? 'mt-spark' : 'mt-spark mt-line';
      p.style.left = `${cx}px`; p.style.top = `${cy}px`;
      p.style.rotate = `${a}rad`;
      document.body.append(p);
      p.animate([
        { translate: '0 0', opacity: 0, scale: '.4' },
        { opacity: 1, offset: 0.2 },
        { translate: `${Math.cos(a) * d}px ${Math.sin(a) * d}px`, opacity: 0, scale: '1' },
      ], { duration: 700 + hh * 250, delay: i * 90 + Math.round(hh * 50), easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' }).finished.then(() => p.remove(), () => p.remove());
    }
  });
  const r = els[0].getBoundingClientRect();
  const tag = document.createElement('div');
  tag.className = 'mt-tag';
  setMarkup(tag, '<b>三连</b><span>TRIPLE</span>');
  tag.style.left = `${r.left + r.width / 2}px`; tag.style.top = `${r.top}px`;
  document.body.append(tag);
  tag.animate([
    { translate: '-50% 0', opacity: 0, scale: '.9' },
    { translate: '-50% -42px', opacity: 1, scale: '1', offset: 0.25 },
    { translate: '-50% -46px', opacity: 1, offset: 0.8 },
    { translate: '-50% -54px', opacity: 0 },
  ], { duration: 1700, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished.then(() => tag.remove(), () => tag.remove());
  setTimeout(() => els.forEach((el) => el.classList.remove('mt-done')), 1400);
}

export function startTriple(): void {
  document.documentElement.classList.add('margin-triple');
  let raf = 0, t0 = 0, p = 0, holding = false, armedUntil = 0;
  let els: HTMLElement[] | null = null;

  const paint = () => {
    if (!els) return;
    els.forEach((el, i) => {
      const r = el.querySelector<SVGRectElement>(':scope > svg.mt-ring rect') ?? ring(el);
      const local = Math.min(1, Math.max(0, (p - i * 0.3) / 0.4));
      r.style.strokeDashoffset = String(100 - local * 100);
      r.style.strokeWidth = String(1 + local * 1.5);
      // 圆头线帽在进度为 0 时仍会画出一个点（之前按钮左上角的小蓝点），没进度时整条隐藏
      r.style.strokeOpacity = local > 0 ? '1' : '0';
      el.style.scale = local > 0 && local < 1 ? String(1 - 0.05 * Math.sin(local * Math.PI)) : '';
      el.classList.toggle('mt-charge', local > 0);
    });
  };
  const tick = (t: number) => {
    if (holding) p = Math.min(1, (t - t0) / HOLD);
    else if (held) p = 1;
    else p = Math.max(0, p - 0.06);
    paint();
    if ((holding && p < 1) || (!holding && !held && p > 0)) raf = requestAnimationFrame(tick);
    else raf = 0;
    if (holding && p >= 1) armedUntil = performance.now() + 5000;
  };

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || reducedMotion()) return;
    const like = (e.target as Element).closest?.('.video-toolbar-left-main .video-like');
    if (!like) return;
    els = items();
    if (!els) return;
    els.forEach(ring);
    holding = true; t0 = performance.now() - p * HOLD;
    if (!raf) raf = requestAnimationFrame(tick);
  }, true);
  // v0.48：映间的进度环 1.5 秒就画满，但 B 站自己的长按要更久才触发三连；
  // 用户看到环满就松手 → B 站收到松开、取消长按，只剩一圈转完（B 站评论反馈）。
  // 现在环满后先把松开扣住，等 B 站三连生效（投币、收藏变 .on）或最多 2.5 秒，再把松开补发给按钮。
  let held: { el: HTMLElement; event: PointerEvent } | null = null, heldT = 0, swallowClick = false;
  const flush = () => {
    if (!held) return;
    const { el, event } = held; held = null; clearTimeout(heldT);
    el.dispatchEvent(new PointerEvent('pointerup', event));
    el.dispatchEvent(new MouseEvent('mouseup', event));
    setTimeout(() => { swallowClick = false; }, 0);
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const tripled = () => { const e = items(); return !!e && e[1].classList.contains('on') && e[2].classList.contains('on'); };
  const release = (e: PointerEvent) => {
    if (held) { if (e.isTrusted) { e.stopImmediatePropagation(); } return; }
    if (!holding) return;
    holding = false;
    if (p >= 1) {
      armedUntil = performance.now() + 5000; watchOn();
      const like = els?.[0];
      if (e.type !== 'pointercancel' && like && !tripled()) {
        e.stopImmediatePropagation();
        held = { el: like, event: e }; swallowClick = true;
        heldT = window.setTimeout(flush, 2500);
      }
    }
    if (!raf) raf = requestAnimationFrame(tick);
  };
  addEventListener('pointerup', release, true);
  addEventListener('mouseup', (e) => { if (held && e.isTrusted) e.stopImmediatePropagation(); }, true);
  addEventListener('click', (e) => { if (swallowClick && e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  addEventListener('pointercancel', release, true);

  // B 站三连成功后投币、收藏都会变成 .on；只在长按完成后的 5 秒内、只监听这三个按钮，避免整页 class 变动带来的开销
  let mo: MutationObserver | null = null;
  const watchOn = () => {
    const e = items();
    if (!e) return;
    mo?.disconnect();
    mo = new MutationObserver(() => {
      if (performance.now() > armedUntil) { mo?.disconnect(); mo = null; return; }
      if (e[1].classList.contains('on') && e[2].classList.contains('on')) { mo?.disconnect(); mo = null; armedUntil = 0; p = 0; paint(); burst(e); flush(); }
    });
    e.forEach((el) => mo!.observe(el, { attributes: true, attributeFilter: ['class'], subtree: true }));
    setTimeout(() => { mo?.disconnect(); mo = null; }, 5200);
  };

  onUiMotionChange(() => {
    if (!reducedMotion()) return;
    holding = false; armedUntil = 0; p = 0;
    mo?.disconnect(); mo = null;
    flush();
    cancelAnimationFrame(raf); raf = 0;
    paint();
    els?.forEach(el => { el.getAnimations().filter(animation => animation.id === 'margin-triple').forEach(animation => animation.cancel()); el.classList.remove('mt-done'); });
    document.querySelectorAll('.mt-spark,.mt-tag').forEach(el => el.getAnimations().forEach(animation => animation.cancel()));
  });

  // 测试/演示钩子
  document.addEventListener('margin-triple-demo', () => { const e = items(); if (e && !reducedMotion()) { e.forEach(ring); burst(e); } });
}
