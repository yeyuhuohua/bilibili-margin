import { h, icon, ICONS } from './dom';
import type { Sheet } from './sheet';
import { uiReducedMotion } from '../motion';

export interface SettingsSection {
  id: string;
  title: string;
  el: HTMLElement;
  btn: HTMLButtonElement;
}

export interface SettingsPage extends Sheet {
  section(id: string, title: string, lead: string | null, ...kids: (Node | null | false)[]): void;
}

/** 整页设置：顶栏搜索 + 左侧分组标签，一次只显示一个面板。保留 Sheet 的 el/body/open/close 接口，外壳无需改动 */
export function createSettingsPage(opts: { title: string; eyebrow: string; onOpen?: () => void }): SettingsPage {
  const search = h('input', {
    type: 'search', placeholder: '搜索设置…', 'aria-label': '搜索设置', autocomplete: 'off', spellcheck: 'false',
  }) as HTMLInputElement;
  const searchBox = h('label', { class: 'stg-search' }, icon(ICONS.search), search, h('kbd', {}, 'Esc'));
  const closeBtn = h('button', { class: 'sheet-x', title: '关闭', 'aria-label': '关闭' }, icon(ICONS.close));
  const nav = h('nav', { class: 'stg-nav', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': '设置分组' });
  const indicator = h('span', { class: 'stg-indicator', 'aria-hidden': 'true' });
  nav.append(indicator);
  const main = h('div', { class: 'stg-main' });
  const body = h('div', { class: 'sheet-body stg-body' }, nav, main);
  const panel = h('aside', {
    class: 'sheet stg', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title, tabindex: -1,
  },
  h('header', { class: 'sheet-head stg-head' },
    h('div', { class: 'stg-title' },
      h('div', { class: 'eyebrow' }, h('span', { class: 'en' }, opts.eyebrow)),
      h('h2', {}, opts.title)),
    searchBox, closeBtn),
  body);
  const scrim = h('div', { class: 'scrim' });
  const el = h('div', { class: 'sheet-layer stg-layer', 'data-open': 'false' }, scrim, panel);
  // 关着的时候整层 inert：里面的控件不进 Tab 顺序、读屏也跳过
  el.inert = true;

  const sections: SettingsSection[] = [];
  const autoOpened = new Set<HTMLElement>();
  let active = '';
  let preSearch = '';
  let indicatorAnimation: Animation | null = null;
  const alignIndicator = (animate = false) => {
    const button = sections.find(s => s.id === active)?.btn;
    if (!button || !button.isConnected || !button.offsetWidth) return;
    const previous = indicator.getBoundingClientRect();
    const box = button.getBoundingClientRect(), parent = nav.getBoundingClientRect();
    Object.assign(indicator.style, { left: `${box.left - parent.left + nav.scrollLeft}px`, top: `${box.top - parent.top + nav.scrollTop}px`, width: `${box.width}px`, height: `${box.height}px` });
    indicatorAnimation?.cancel();
    if (animate && previous.width && !uiReducedMotion()) indicatorAnimation = indicator.animate([
      { transform: `translate(${previous.left - box.left}px,${previous.top - box.top}px) scale(${previous.width / box.width},${previous.height / box.height})` },
      { transform: 'none' },
    ], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' });
  };
  new ResizeObserver(() => {
    nav.setAttribute('aria-orientation', getComputedStyle(nav).flexDirection === 'row' ? 'horizontal' : 'vertical');
    alignIndicator();
  }).observe(nav);

  const activate = (id: string, focus = false) => {
    const target = sections.find((s) => s.id === id) ?? sections[0];
    if (!target) return;
    active = target.id;
    for (const s of sections) {
      const on = s === target;
      s.el.hidden = !on;
      s.btn.setAttribute('aria-selected', String(on));
      s.btn.tabIndex = on ? 0 : -1;
      s.btn.toggleAttribute('aria-current', on);
    }
    if (focus) target.btn.focus({ preventScroll: true });
    alignIndicator(true);
  };
  const show = (id: string, focus = false) => {
    const changed = id !== active;
    activate(id, focus);
    if (changed) body.scrollTop = 0;
  };

  const section = (id: string, title: string, lead: string | null, ...kids: (Node | null | false)[]) => {
    const empty = h('p', { class: 'stg-empty', hidden: true }, '这个分类里没有匹配的设置');
    const sec = h('section', {
      class: 'stg-sec', id: `stg-${id}`, 'data-sec': id,
      role: 'tabpanel', 'aria-labelledby': `stg-tab-${id}`, hidden: true,
    },
    h('div', { class: 'stg-sec-h' },
      h('h3', {}, title),
      lead ? h('p', {}, lead) : null),
    empty,
    ...(kids.filter(Boolean) as Node[]));
    const btn = h('button', {
      type: 'button', id: `stg-tab-${id}`, role: 'tab', 'aria-controls': `stg-${id}`,
      'aria-selected': 'false', tabindex: -1,
    }, icon(({ overview: ICONS.gear, appearance: ICONS.palette, home: ICONS.zone, bar: ICONS.search, playback: ICONS.live, filter: ICONS.block, privacy: ICONS.user, lab: ICONS.command } as Record<string, string>)[id] || ICONS.gear), h('span', {}, title)) as HTMLButtonElement;
    btn.onclick = () => {
      if (search.value) preSearch = id;
      show(id);
    };
    nav.append(btn);
    main.append(sec);
    sections.push({ id, title, el: sec, btn });
    if (!active) activate(id);
  };

  /* 搜索：在全部面板里标出命中项，导航显示命中数并切到第一个有结果的分类；清空后回到原分类 */
  const entries = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.row, .block, .sd, .stg-note')];
  const applyFilter = (value: string) => {
    const q = value.trim().toLowerCase();
    const wasSearching = el.hasAttribute('data-searching');
    if (q && !wasSearching) preSearch = active;
    el.toggleAttribute('data-searching', !!q);
    // 上一轮搜索自动展开的折叠块先收回，避免换关键词后残留
    autoOpened.forEach((d) => d.removeAttribute('data-open'));
    autoOpened.clear();
    let first = '';
    let firstTitle = '';
    let activeHits = 0;
    for (const s of sections) {
      let own = 0;
      let titleHit = false;
      if (q) {
        for (const item of entries(s.el)) {
          const hit = (item.textContent ?? '').toLowerCase().includes(q);
          item.hidden = !hit;
          if (!hit) continue;
          own++;
          if (!titleHit) {
            const label = item.querySelector('.row-label > span, .sd-t')?.textContent ?? '';
            titleHit = label.toLowerCase().includes(q);
          }
        }
        s.el.querySelectorAll<HTMLElement>('.sd').forEach((d) => {
          const inside = [...d.querySelectorAll<HTMLElement>('.row, .block, .stg-note')].some((x) => !x.hidden);
          if (!inside || d.hasAttribute('data-open')) return;
          d.setAttribute('data-open', '');
          autoOpened.add(d);
        });
        for (const sub of s.el.querySelectorAll<HTMLElement>('.stg-sub')) {
          let any = false;
          for (let n = sub.nextElementSibling; n && !n.classList.contains('stg-sub'); n = n.nextElementSibling) {
            if (n.matches('.row, .block, .sd') && !(n as HTMLElement).hidden) { any = true; break; }
          }
          sub.hidden = !any;
        }
      } else {
        for (const item of entries(s.el)) item.hidden = false;
        for (const sub of s.el.querySelectorAll<HTMLElement>('.stg-sub')) sub.hidden = false;
      }
      const note = s.el.querySelector<HTMLElement>('.stg-empty');
      if (note) note.hidden = !q || own > 0;
      s.btn.toggleAttribute('data-empty', !!q && own === 0);
      if (q && own) s.btn.dataset.count = String(own);
      else delete s.btn.dataset.count;
      if (own && !first) first = s.id;
      if (titleHit && !firstTitle) firstTitle = s.id;
      if (s.id === active) activeHits = own;
    }
    if (q) {
      const target = firstTitle || (activeHits > 0 ? active : first);
      if (target) show(target);
      body.scrollTop = 0;
    } else if (preSearch) {
      show(preSearch);
      preSearch = '';
    }
  };
  const clearSearch = () => {
    if (!search.value) return;
    search.value = '';
    applyFilter('');
  };
  search.addEventListener('input', () => applyFilter(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (search.value) clearSearch();
    else api.close();
  });
  nav.addEventListener('keydown', (e) => {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const i = sections.findIndex((s) => s.id === active);
    if (i < 0) return;
    let n = i;
    if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = sections.length - 1;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % sections.length;
    else n = (i - 1 + sections.length) % sections.length;
    e.preventDefault();
    if (search.value) preSearch = sections[n].id;
    show(sections[n].id, true);
  });

  let lastFocus: Element | null = null;
  const api: SettingsPage = {
    el, body, section,
    open() {
      if (api.isOpen()) return;
      lastFocus = (el.getRootNode() as ShadowRoot).activeElement;
      el.dataset.open = 'true';
      el.inert = false;
      search.value = '';
      applyFilter('');
      activate(active || sections[0]?.id || '');
      body.scrollTop = 0;
      opts.onOpen?.();
      el.dispatchEvent(new CustomEvent('margin:sheet', { bubbles: true }));
      requestAnimationFrame(() => panel.focus({ preventScroll: true }));
    },
    close() {
      if (!api.isOpen()) return;
      el.dataset.open = 'false';
      el.inert = true;
      clearSearch();
      el.dispatchEvent(new CustomEvent('margin:sheet', { bubbles: true }));
      (lastFocus as HTMLElement | null)?.focus?.({ preventScroll: true });
    },
    isOpen: () => el.dataset.open === 'true',
  };
  closeBtn.addEventListener('click', () => api.close());
  scrim.addEventListener('click', () => api.close());
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && api.isOpen()) api.close(); });
  return api;
}
