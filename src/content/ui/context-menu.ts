import { h, icon } from './dom';

/**
 * 右键菜单：21st「Context Menu」（ddoemonn）的原生移植。
 * 保留原版行为：贴边自动翻转、从指针处缩放展开（0.2s，ease 0.23,1,0.32,1），
 * ↑↓ / Home / End 移动，首字母跳转（typeahead），↵ 执行，Esc / 点外面 / 滚动关闭。
 * Shift + 右键仍是浏览器原生菜单。
 */
export type MenuEntry = 'separator' | { label: string; icon: string; shortcut?: string; danger?: boolean; disabled?: boolean; run: () => void };

export interface ContextMenu { el: HTMLElement; show: (x: number, y: number, items: MenuEntry[], trigger?: HTMLElement) => void; close: () => void }

export function createContextMenu(): ContextMenu {
  const el = h('div', { class: 'cm', role: 'menu', hidden: '', tabindex: '-1' });
  let btns: HTMLButtonElement[] = [];
  let active = -1;
  let ta = '', taTimer = 0;
  let closeT = 0;

  const focusAt = (i: number) => {
    active = i;
    btns.forEach((b, j) => b.toggleAttribute('data-active', j === i));
    btns[i]?.focus({ preventScroll: true });
  };
  const enabled = () => btns.map((b, i) => (b.getAttribute('aria-disabled') ? -1 : i)).filter((i) => i >= 0);

  function close(): void {
    if (el.hidden || el.dataset.state === 'closing') return;
    el.dataset.state = 'closing';
    closeT = window.setTimeout(() => { el.hidden = true; el.dataset.state = ''; }, 140);
  }

  let opener: HTMLElement | undefined;
  function show(x: number, y: number, items: MenuEntry[], trigger?: HTMLElement): void {
    opener = trigger;
    clearTimeout(closeT);
    btns = [];
    el.replaceChildren(...items.map((it) => {
      if (it === 'separator') return h('div', { class: 'cm-sep', role: 'separator' });
      const b = h('button', { type: 'button', role: 'menuitem', class: `cm-item${it.danger ? ' danger' : ''}`, tabindex: '-1',
        onpointermove: () => { const i = btns.indexOf(b); if (i !== active && !it.disabled) focusAt(i); },
        onclick: () => { if (it.disabled) return; close(); it.run(); },
      }, h('span', { class: 'cm-ic' }, icon(it.icon)), h('span', { class: 'cm-l' }, it.label), it.shortcut ? h('span', { class: 'cm-k' }, it.shortcut) : null) as HTMLButtonElement;
      if (it.disabled) b.setAttribute('aria-disabled', 'true');
      btns.push(b);
      return b;
    }));
    el.hidden = false; el.dataset.state = '';
    // 贴边翻转：放不下就往左 / 往上开，原点跟着翻
    const W = el.offsetWidth, H = el.offsetHeight, pad = 8;
    const left = x + W + pad > innerWidth ? Math.max(pad, x - W) : x;
    const top = y + H + pad > innerHeight ? Math.max(pad, y - H) : y;
    el.style.left = `${left}px`; el.style.top = `${top}px`;
    el.style.maxHeight = `${innerHeight - pad * 2}px`;
    el.style.transformOrigin = `${left < x ? 'right' : 'left'} ${top < y ? 'bottom' : 'top'}`;
    el.dataset.state = 'open';
    active = -1;
    el.focus({ preventScroll: true });
  }

  el.addEventListener('keydown', (e) => {
    const en = enabled();
    if (!en.length) return;
    const pos = en.indexOf(active);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(en[(pos + 1) % en.length]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(en[pos <= 0 ? en.length - 1 : pos - 1]); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(en[0]); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(en[en.length - 1]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btns[active]?.click(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); opener?.focus({ preventScroll: true }); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      ta += e.key.toLowerCase(); clearTimeout(taTimer); taTimer = window.setTimeout(() => (ta = ''), 500);
      const hit = en.find((i) => btns[i].textContent!.toLowerCase().startsWith(ta));
      if (hit !== undefined) focusAt(hit);
    }
  });
  addEventListener('pointerdown', (e) => { if (!el.hidden && !e.composedPath().includes(el)) close(); }, true);
  addEventListener('scroll', () => close(), true);
  addEventListener('resize', () => close());
  addEventListener('blur', () => close());
  return { el, show, close };
}
