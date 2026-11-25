import { h, icon } from './dom';
import { loadSettings, onSettingsChange } from '../../shared/settings';

// 此开关只管指针预览；键盘焦点仍应可见。
let hoverOn = true;
loadSettings().then((s) => { hoverOn = s.headHover; }).catch(() => {});
onSettingsChange((s) => { hoverOn = s.headHover; });

export interface TabSpec {
  title: string;
  icon: string;
  /** 有 href 时渲染为新标签页打开的链接 */
  href?: string;
  run?: () => void;
  /** 用来挂未读角标 */
  id?: string;
}
export type TabItem = TabSpec | 'separator';

export interface ExpandableTabs {
  el: HTMLElement;
  thumb: HTMLElement;
  buttons: HTMLElement[];
  select(i: number | null): void;
  place(): void;
  /** 角标：0 隐藏；数字超过 99 显示 99+；dot=true 只显示小圆点 */
  badge(id: string, n: number, dot?: boolean): void;
}

/** 21st「Expandable Tabs」的原生移植；按钮保持固定宽度，滑块预览悬停项。 */
export function createExpandableTabs(items: TabItem[], onChange?: (i: number | null) => void): ExpandableTabs {
  const el = h('nav', { class: 'et', 'aria-label': '快捷入口' });
  // 事件只定位指示片；折射留在外壳，CSS 负责可打断的短过渡。
  const thumb = h('span', { class: 'et-thumb', 'aria-hidden': 'true' });
  el.append(thumb);
  const buttons: HTMLElement[] = [];
  const byId = new Map<string, HTMLElement>();
  let selected: number | null = null;
  let hoverT = 0;
  // 预览不等于选中：鼠标离开恢复键盘焦点，焦点离开恢复点选项。
  let hover: number | null = null, focused: number | null = null;

  const place = () => {
    const i = hover ?? focused ?? selected;
    const b = i === null ? null : buttons[i];
    if (!b || !b.getClientRects().length) { thumb.removeAttribute('data-on'); return; }
    thumb.style.translate = `${b.offsetLeft}px 0`;
    thumb.style.width = `${b.offsetWidth}px`;
    thumb.style.top = `${b.offsetTop}px`;
    thumb.style.height = `${b.offsetHeight}px`;
    thumb.setAttribute('data-on', '');
  };

  const select = (i: number | null) => {
    if (i === selected) return;
    selected = i;
    buttons.forEach((b, j) => b.toggleAttribute('data-selected', j === i));
    place();
    onChange?.(i);
  };

  for (const it of items) {
    if (it === 'separator') { el.append(h('div', { class: 'et-sep', 'aria-hidden': 'true' })); continue; }
    const idx = buttons.length;
    const label = h('span', {}, it.title);
    const b = it.href
      ? h('a', { class: 'act et-btn', href: it.href, target: '_blank', rel: 'noopener', 'aria-label': it.title, title: it.title }, icon(it.icon), label)
      : h('button', { class: 'act et-btn', type: 'button', 'aria-label': it.title, title: it.title }, icon(it.icon), label);
    b.addEventListener('click', () => { clearTimeout(hoverT); hover = null; if (selected === idx) place(); else select(idx); it.run?.(); });
    b.addEventListener('focus', () => {
      if (!b.matches(':focus-visible')) return;
      clearTimeout(hoverT); hover = null; focused = idx; place();
    });
    b.addEventListener('blur', () => { if (focused === idx) { focused = null; place(); } });
    b.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType === 'touch' || !hoverOn) return;
      clearTimeout(hoverT);
      hover = idx;
      place();
    });
    if (it.id) byId.set(it.id, b);
    buttons.push(b);
    el.append(b);
  }

  el.addEventListener('pointerleave', () => {
    clearTimeout(hoverT);
    hoverT = window.setTimeout(() => {
      hover = null;
      place();
    }, 120);
  });

  // useOnClickOutside：shadow DOM 里要看 composedPath
  addEventListener('pointerdown', (e) => { if (selected !== null && !e.composedPath().includes(el)) select(null); }, true);
  new ResizeObserver(place).observe(el);

  const badge = (id: string, n: number, dot = false) => {
    const b = byId.get(id);
    if (!b) return;
    let m = b.querySelector<HTMLElement>('.et-badge');
    if (n <= 0) { m?.remove(); b.setAttribute('aria-label', b.querySelector('span')?.textContent ?? ''); return; }
    if (!m) { m = h('i', { class: 'et-badge', 'aria-hidden': 'true' }); b.append(m); }
    m.toggleAttribute('data-dot', dot);
    m.textContent = dot ? '' : n > 99 ? '99+' : String(n);
    b.setAttribute('aria-label', `${b.querySelector('span')?.textContent ?? ''}（${n > 99 ? '99+' : n} 条新）`);
  };

  return { el, thumb, buttons, select, badge, place };
}
