import { removeWatchLater, watchLater, type LaterItem } from '../api/search';
import { toast } from './controls';
import { fmtAgo, fmtDuration, h, icon, ICONS } from './dom';
import { uiReducedMotion as reducedMotion } from '../motion';
import type { FilterRuntime } from '../filter-runtime';
import { targetOfLater } from '../filter-targets';

/**
 * 侧边抽屉：21st「Drawer」（ddoemonn）的原生移植。
 * 保留原版：右侧滑出，弹簧（stiffness 150 / damping 27 / mass 1），遮罩透明度跟随抽屉位置，
 * 拖动头部可甩出关闭（超过 38% 宽度或速度够快），Esc / 点遮罩关闭，打开时锁滚动、聚焦、关闭后还焦点。
 * 内容是 B 站「稍后再看」。
 */
const WIDTH = 400;

export interface Drawer { el: HTMLElement; open: () => void; close: () => void; refresh: () => void }

export function createLaterDrawer(toastRoot: () => HTMLElement, filter?: FilterRuntime): Drawer {
  const count = h('span', { class: 'dw-count' });
  const sub = h('p', { class: 'dw-sub' }, '加进来的视频都在这里');
  const body = h('div', { class: 'dw-body' });
  const closeBtn = h('button', { type: 'button', class: 'dw-close', 'aria-label': '关闭', title: '关闭 (Esc)' }, icon(ICONS.close));
  const head = h('div', { class: 'dw-head' }, h('div', { class: 'dw-grip', 'aria-hidden': 'true' }), h('div', { class: 'dw-ht' }, h('h2', {}, '稍后再看', count), sub), closeBtn);
  const creator = h('select', { 'aria-label': '按 UP 主筛选' }) as HTMLSelectElement;
  const grouped = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const tools = h('div', { class: 'dw-tools', hidden: true }, creator, h('label', {}, grouped, '按 UP 主分组'));
  creator.addEventListener('change', () => { body.scrollTop = 0; if (raw) renderNow(raw); });
  grouped.addEventListener('change', () => { body.scrollTop = 0; if (raw) renderNow(raw); });
  const foot = h('div', { class: 'dw-foot' },
    h('a', { class: 'ghost', href: 'https://www.bilibili.com/watchlater/#/list', target: '_blank', rel: 'noopener' }, icon(ICONS.arrow), h('span', {}, '在 B 站打开完整列表')));
  const panel = h('aside', { class: 'dw-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': '稍后再看', tabindex: '-1', style: `width:${WIDTH}px` }, head, tools, body, foot);
  const scrim = h('div', { class: 'dw-scrim' });
  const el = h('div', { class: 'dw', hidden: '' }, scrim, panel);

  const away = WIDTH + 24;
  let x = away, v = 0, target = away, raf = 0, isOpen = false, returnTo: HTMLElement | null = null, loaded = false;
  const reduced = reducedMotion;
  const paint = () => {
    panel.style.transform = `translateX(${x}px)`;
    scrim.style.opacity = String(1 - Math.min(1, Math.abs(x) / WIDTH));
  };
  // 弹簧积分（半隐式欧拉，固定 1/120s 子步）
  const step = (t0: number) => {
    let last = t0;
    const tick = (t: number) => {
      let dt = Math.min(0.05, (t - last) / 1000); last = t;
      while (dt > 0) {
        const s = Math.min(dt, 1 / 120); dt -= s;
        const a = (-150 * (x - target) - 27 * v) / 1;
        v += a * s; x += v * s;
      }
      paint();
      if (Math.abs(x - target) < (isOpen ? 0.3 : 1) && Math.abs(v) < (isOpen ? 0.3 : 8)) { x = target; v = 0; paint(); raf = 0; if (!isOpen) el.hidden = true; return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  const glide = (to: number) => {
    target = to;
    if (reduced()) { x = to; v = 0; paint(); if (!isOpen) el.hidden = true; return; }
    if (!raf) step(performance.now());
  };

  let raw: LaterItem[] | null = null;
  let generation = 0;
  function render(list: LaterItem[] | null): void {
    if (list === null) {
      tools.hidden = true;
      count.textContent = '';
      sub.textContent = '登录 B 站后可以看到你的稍后再看';
      body.replaceChildren(h('div', { class: 'dw-empty' }, icon(ICONS.later), h('p', {}, '还没登录'), h('a', { class: 'ghost', href: 'https://passport.bilibili.com/login', target: '_blank', rel: 'noopener' }, '去登录')));
      return;
    }
    const f = filter;
    if (f) {
      // 关键词也要能命中视频标签：先预热标签（没有关键词时立即返回）
      void f.prepare(list.map((it) => it.bvid)).then(() => { if (raw === list) renderNow(list); });
      return;
    }
    renderNow(list);
  }
  function renderNow(list: LaterItem[]): void {
    const shown = filter ? list.filter((it) => filter.allows(targetOfLater(it))) : list;
    const groups = new Map<string, { name: string; items: LaterItem[] }>();
    for (const item of shown) {
      const key = item.mid > 0 ? String(item.mid) : `name:${item.author}`;
      let group = groups.get(key);
      if (!group) {
        group = { name: item.author || '未知 UP 主', items: [] };
        groups.set(key, group);
      }
      group.items.push(item);
    }
    const selected = creator.value;
    const names = new Set<string>();
    const repeated = new Set<string>();
    for (const group of groups.values()) {
      if (names.has(group.name)) repeated.add(group.name);
      names.add(group.name);
    }
    creator.replaceChildren(h('option', { value: '' }, '全部 UP 主'), ...[...groups].map(([key, group]) =>
      h('option', { value: key }, `${group.name}${repeated.has(group.name) ? ` · UID ${key}` : ''}（${group.items.length}）`)));
    creator.value = groups.has(selected) ? selected : '';
    const visible = groups.get(creator.value)?.items ?? shown;
    tools.hidden = !shown.length;
    count.textContent = String(visible.length);
    sub.textContent = shown.length ? '右键视频卡片也能加进来' : '右键视频卡片 →「稍后再看」';
    if (!shown.length) { body.replaceChildren(h('div', { class: 'dw-empty' }, icon(ICONS.later), h('p', {}, list.length ? '都被屏蔽词藏起来了' : '列表是空的'))); return; }
    const rowFor = (it: LaterItem, i: number) => {
      const href = `https://www.bilibili.com/list/watchlater?bvid=${it.bvid}`;
      const pct = it.progress === -1 ? 100 : it.duration ? Math.min(100, (it.progress / it.duration) * 100) : 0;
      const row = h('a', { class: 'dw-item', href, target: '_blank', rel: 'noopener', style: `--i:${Math.min(i, 12)}` },
        h('span', { class: 'dw-cover' },
          h('img', { src: it.cover ? `${it.cover}@320w_180h_1c.webp` : '', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
          it.duration ? h('span', { class: 'dur' }, fmtDuration(it.duration)) : null,
          pct ? h('span', { class: 'dw-prog', style: `--p:${pct}%` }) : null),
        h('span', { class: 'dw-meta' },
          h('span', { class: 'dw-t' }, it.title),
          h('span', { class: 'dw-a' }, it.author, it.addAt ? ` · ${fmtAgo(it.addAt)}加入` : '', pct >= 100 ? ' · 已看完' : '')),
        h('button', { type: 'button', class: 'dw-x', title: '移出稍后再看', 'aria-label': '移出稍后再看',
          onclick: async (e: Event) => {
            e.preventDefault(); e.stopPropagation();
            const button = e.currentTarget as HTMLButtonElement;
            if (button.disabled) return;
            button.disabled = true;
            row.classList.add('out');
            const ok = await removeWatchLater(it.aid).catch(() => false);
            if (ok) {
              generation++;
              raw = raw?.filter((x) => x.aid !== it.aid) ?? null;
              render(raw);
            }
            else { button.disabled = false; row.classList.remove('out'); toast(toastRoot(), '没移掉，稍后再试'); }
          } }, icon(ICONS.close)),
      );
      return row;
    };
    if (grouped.checked) {
      const active = creator.value ? [groups.get(creator.value)!] : [...groups.values()];
      body.replaceChildren(...active.map(group => h('section', { class: 'dw-group' },
        h('h3', {}, group.name, h('span', {}, String(group.items.length))), ...group.items.map(rowFor))));
    } else body.replaceChildren(...visible.map(rowFor));
  }
  async function refresh(): Promise<void> {
    const current = ++generation;
    tools.hidden = true;
    count.textContent = '';
    body.replaceChildren(...Array.from({ length: 5 }, () => h('div', { class: 'dw-item sk' }, h('span', { class: 'dw-cover' }), h('span', { class: 'dw-meta' }, h('span', { class: 'line' }), h('span', { class: 'line short' })))));
    try {
      const list = await watchLater();
      if (current !== generation) return;
      raw = list; render(raw); loaded = true;
    } catch {
      if (current !== generation) return;
      body.replaceChildren(h('div', { class: 'dw-empty' }, h('p', {}, '加载失败'), h('button', { type: 'button', class: 'ghost', onclick: () => refresh() }, '重试')));
    }
  }
  filter?.onChange(() => { if (raw !== null) render(raw); });

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    el.style.pointerEvents = '';
    returnTo = ((el.getRootNode() as ShadowRoot).activeElement as HTMLElement | null) ?? null;
    el.hidden = false; paint();
    glide(0);
    panel.focus({ preventScroll: true });
    void loaded; refresh();
  }
  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    el.style.pointerEvents = 'none';
    glide(away);
    returnTo?.focus?.({ preventScroll: true });
  }

  // 拖动头部甩出
  let drag: { x0: number; t0: number; xs: number; last: number; lt: number } | null = null;
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button')) return;
    drag = { x0: e.clientX, t0: performance.now(), xs: x, last: e.clientX, lt: performance.now() };
    head.setPointerCapture(e.pointerId); cancelAnimationFrame(raf); raf = 0; panel.classList.add('dragging');
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x0;
    x = Math.max(dx < 0 ? dx * 0.15 : 0, drag.xs + dx); // 往里拖有阻尼
    v = (e.clientX - drag.last) / Math.max(1, performance.now() - drag.lt) * 1000;
    drag.last = e.clientX; drag.lt = performance.now();
    paint();
  });
  const end = () => {
    if (!drag) return;
    drag = null; panel.classList.remove('dragging');
    if (x > WIDTH * 0.38 || v > 600) close(); else glide(0);
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);

  el.addEventListener('wheel', (e) => { if (!(e.target as Element).closest('.dw-body')) e.preventDefault(); }, { passive: false });
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const f = [...panel.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),select,input')].filter(node => node.getClientRects().length);
      if (!f.length) return;
      const active = (el.getRootNode() as ShadowRoot).activeElement;
      if (e.shiftKey && (active === f[0] || active === panel)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && active === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isOpen) return;
    const cp = (el.getRootNode() as ShadowRoot).querySelector('.cp[data-open="true"]');
    if (!cp) close();
  }, true);
  return { el, open, close, refresh };
}
