import { h } from './dom';

/**
 * 漂浮快捷菜单：21st「Floating Menu」的原生移植（framer-motion → CSS 过渡）。
 * 小胶囊点开后变形成面板，菜单项错峰浮现；悬停时逐字向上翻滚。
 * 面板和文字跟随页面主题；中文霞鹜文楷，英文副标 Instrument Serif 斜体。
 */
export interface MenuItem { label: string; en?: string; run: () => void }
export interface FloatingMenu { el: HTMLElement; close: () => void }

function rollButton(item: MenuItem, index: number, done: () => void): HTMLElement {
  const chars = [...item.label];
  const btn = h('button', { class: 'fm-item', type: 'button', style: `--i:${index}`, 'aria-label': item.label });
  const row = h('span', { class: 'fm-chars', 'aria-hidden': 'true' });
  chars.forEach((c, i) => {
    row.append(h('span', { class: 'fm-ch' }, h('span', { class: 'fm-col', style: `--d:${30 * i}ms` }, h('span', {}, c), h('span', {}, c))));
  });
  btn.append(row);
  // 中文用霞鹜文楷，下方一行 Instrument Serif 斜体英文作点缀（同全站英文眉标）
  if (item.en) btn.append(h('span', { class: 'fm-en', 'aria-hidden': 'true' }, item.en));
  // 原版的“动画锁”：翻滚进行中移出，等翻完再复位，避免抖动
  const lock = 30 * chars.length + 300;
  let hovered = false, busy = false, pendingLeave = false;
  btn.addEventListener('pointerenter', () => {
    pendingLeave = false;
    if (hovered) return;
    hovered = true; busy = true; btn.classList.add('hover');
    setTimeout(() => { busy = false; if (pendingLeave) { pendingLeave = false; hovered = false; btn.classList.remove('hover'); } }, lock);
  });
  btn.addEventListener('pointerleave', () => {
    if (busy) pendingLeave = true; else { hovered = false; btn.classList.remove('hover'); }
  });
  btn.addEventListener('click', () => { done(); item.run(); });
  return btn;
}

export function createFloatingMenu(items: MenuItem[], label = '快捷'): FloatingMenu {
  const el = h('div', { class: 'fm', 'data-open': 'false' });
  const box = h('div', { class: 'fm-box', role: 'menu' });
  const close = () => { el.dataset.open = 'false'; };
  const open = () => { el.dataset.open = 'true'; };
  const list = h('div', { class: 'fm-list' }, ...items.map((it, i) => rollButton(it, i, close)));
  const burger = h('span', { class: 'fm-burger', 'aria-hidden': 'true' }, h('i', {}), h('i', {}));
  const bar = h('button', { class: 'fm-bar', type: 'button', title: `${label}菜单`, 'aria-label': `${label}菜单`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, h('span', { class: 'fm-label' }, label), burger);
  box.append(h('span', { class: 'fm-fill' }), h('span', { class: 'fm-ink' }), list, bar);
  el.append(box);

  const sync = () => {
    const isOpen = el.dataset.open === 'true';
    bar.setAttribute('aria-expanded', String(isOpen));
    // #2：高度按实际内容算（列表 + 底栏），不再多留顶部空白；字体晚加载会变高，所以 fonts.ready 后再量一次
    box.style.height = isOpen ? `${list.scrollHeight + bar.offsetHeight}px` : '';
  };
  new MutationObserver(sync).observe(el, { attributes: true, attributeFilter: ['data-open'] });
  document.fonts?.ready.then(sync);
  box.addEventListener('click', (e) => { if (el.dataset.open !== 'true' && !(e.target as Element).closest('.fm-bar')) open(); });
  bar.addEventListener('click', () => (el.dataset.open === 'true' ? close() : open()));
  document.addEventListener('pointerdown', (e) => { if (el.dataset.open === 'true' && !e.composedPath().includes(el)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return { el, close };
}
