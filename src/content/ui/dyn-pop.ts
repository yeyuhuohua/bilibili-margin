import { followFeed, followingLive, portal, toDyn, type Dyn } from '../api/dyn';
import { historyList, type Cursor } from '../api/history';
import { folders } from '../api/fav';
import { watchLater, removeWatchLater } from '../api/search';
import { toast } from './controls';
import { unread } from '../api/msg';
import { bvidFromHref } from '../tags';
import { h, icon, ICONS } from './dom';
import { getJSON } from '../api/http';
import { dynCard } from './dyn';
import type { FilterRuntime } from '../filter-runtime';
import type { FilterTarget } from '../filter';
import { targetOfPopRow } from '../filter-targets';
import { laterButton } from './later-btn';
import { loadSettings, onSettingsChange, saveSettings } from '../../shared/settings';

/** 悬停多久才弹出：只是路过顶栏时不打扰 */
// 用户 2026-11-01：悬停立即展开，不要等
const OPEN_DELAY = 0;
const CLOSE_DELAY = 220;

/** 列表里的一行：头像或封面 + 两行文字，或一个计数 */
export interface PopRow { href: string; face?: string; title: string; who?: string; sub?: string; cover?: string; progress?: number; count?: number; live?: boolean; laterBvid?: string; dynamic?: Dyn; remove?: () => Promise<boolean> }
export interface PopSpec {
  title: string;
  all: { href: string; label: string };
  /** null = 未登录 */
  load: (videosOnly?: boolean) => Promise<PopRow[] | null>;
  videoFilter?: boolean;
  empty: string;
  onOpen?: () => void;
  /** 每行只有一行文字的紧凑样式（消息分类） */
  compact?: boolean;
  /** 多列图标网格（分区） */
  grid?: boolean;
  /** 滚到底继续加载（v0.47.2，GitHub #9：动态弹窗固定 8 条，往下拉不会继续读）；返回空数组表示没有更多 */
  more?: (videosOnly?: boolean) => Promise<PopRow[]>;
  /** When supplied, load-more is a button instead of automatic scrolling. */
  canLoadMore?: () => boolean;
  /** 当前功能是否允许打开（例如关闭消息提醒后不再弹消息面板） */
  enabled?: () => boolean;
  /** 该入口的行如何参与屏蔽词过滤；不设置表示不过滤 */
  filterRow?: (r: PopRow) => FilterTarget | null;
}

export interface PopHandle {
  close(): void;
  /** 过滤条件变化后清掉 60 秒缓存并重新加载 */
  invalidate(): void;
}

export function ago(ts: number, fallback = ''): string {
  if (!ts) return fallback;
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} 天前`;
  const d = new Date(ts * 1000);
  return fallback || `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

const thumb = (src: string, w: number, hh: number) => (src ? `${src}@${w}w_${hh}h_1c.webp` : '');
const img = (src: string, cls: string, w: number, hh = w) =>
  h('img', { class: cls, src: thumb(src, w, hh), alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });

function row(r: PopRow, hover: (d: Dyn, trigger: HTMLElement, entering: boolean) => void, removed: () => void): HTMLElement {
  const cover = r.cover !== undefined
    ? h('span', { class: 'dp-cover' }, r.cover ? img(r.cover, '', 128, 72) : '', r.progress !== undefined ? h('i', { class: 'dp-prog', style: `--p:${Math.max(0, Math.min(1, r.progress))}` }) : '')
    : null;
  const link = h('a', { class: 'dp-row', href: r.href, target: '_blank', rel: 'noopener' },
    r.face !== undefined ? h('span', { class: 'dp-face' + (r.live ? ' live' : '') }, r.face ? img(r.face, '', 64) : '') : '',
    h('div', { class: 'dp-body' },
      r.who || r.sub ? h('div', { class: 'dp-meta' }, r.who ? h('b', {}, r.who) : '', r.sub ? h('span', {}, r.sub) : '') : '',
      h('p', { class: 'dp-line' }, r.title)),
    r.count !== undefined ? h('em', { class: r.count ? 'dp-count' : 'dp-count zero' }, r.count > 99 ? '99+' : String(r.count)) : '',
    cover);
  const entry: HTMLElement = r.laterBvid || r.remove ? h('div', { class: 'dp-entry' }, link, r.laterBvid ? laterButton(r.laterBvid) : null) : link;
  if (r.remove) {
    const button = h('button', { type: 'button', class: 'dp-remove', title: '移出稍后再看', 'aria-label': '移出稍后再看' }, icon(ICONS.close)) as HTMLButtonElement;
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        if (!await r.remove!()) throw new Error('remove failed');
        entry.remove(); removed();
      } catch {
        button.disabled = false;
        toast(entry.closest<HTMLElement>('.app') ?? entry.parentElement!, '移出失败，请重试');
      }
    };
    entry.append(button);
  }
  if (r.dynamic) {
    entry.classList.add('dp-dynamic');
    link.setAttribute('aria-expanded', 'false');
    link.setAttribute('aria-haspopup', 'dialog');
    entry.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') hover(r.dynamic!, link, true); });
    entry.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hover(r.dynamic!, link, false); });
  }
  return entry;
}

/**
 * 顶栏入口的悬停列表：指针一放上去就弹出，
 * 移进面板可继续浏览，离开后稍等再收起；Esc 或点按钮本身也会收起。
 */
/** 「全部 →」链接：收藏夹在本页打开面板（没有面板就在当前页跳回首页 #fav），其余新标签页 */
function allLink(spec: PopSpec): HTMLElement {
  const local = spec.all.href.endsWith('/#fav');
  const a = h('a', local ? { href: spec.all.href } : { href: spec.all.href, target: '_blank', rel: 'noopener' }, `${spec.all.label} →`);
  if (local) a.addEventListener('click', (e) => {
    const ev = new Event('margin:open-fav', { cancelable: true });
    dispatchEvent(ev);
    if (ev.defaultPrevented) { e.preventDefault(); a.closest('.dp')?.dispatchEvent(new Event('dp-close')); }
  });
  return a;
}

export function attachHoverList(btn: HTMLElement, spec: PopSpec, filter?: FilterRuntime): PopHandle {
  const pop = h('div', { class: 'dp' + (spec.compact ? ' compact' : '') + (spec.grid ? ' grid' : ''), role: 'dialog', 'aria-label': spec.title, hidden: '' });
  const list = h('div', { class: 'dp-list' });
  const videoFilter = spec.videoFilter ? h('button', { type: 'button', class: 'dp-video-filter', role: 'switch', 'aria-label': '动态菜单仅显示视频', 'aria-checked': 'false' }, '仅视频') : null;
  pop.append(
    h('div', { class: 'dp-head' }, h('span', {}, spec.title), videoFilter, allLink(spec)),
    list,
  );
  let openT = 0, closeT = 0, loadedAt = 0, open = false, done = true, busy = false;
  let videosOnly = false, generation = 0;
  const detail = h('aside', { class: 'dp-detail', role: 'dialog', 'aria-label': '动态详情', hidden: '' });
  pop.append(detail);
  let detailGeneration = 0, previewT = 0, detailCloseT = 0;
  let detailRequest: AbortController | undefined;
  let detailTrigger: HTMLElement | undefined;
  const detailCache = new Map<string, { value: Dyn; at: number }>();
  const closeDetail = (restoreFocus = false) => {
    clearTimeout(previewT);
    clearTimeout(detailCloseT);
    detailRequest?.abort();
    detailRequest = undefined;
    detailGeneration++;
    detail.hidden = true;
    detailTrigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) detailTrigger?.focus({ preventScroll: true });
    detailTrigger = undefined;
  };
  const renderContent = (d: Dyn): HTMLElement => {
    const content = h('div', { class: 'dp-detail-content' },
      h('div', { class: 'dp-meta' }, h('b', {}, d.author), h('span', {}, ago(d.ts, d.time))),
      dynCard(d, true));
    for (const link of content.querySelectorAll<HTMLAnchorElement>('.dy-pics a')) {
      const card = link.closest<HTMLElement>('.dy');
      link.href = card?.dataset.href || d.url;
      link.setAttribute('aria-label', '打开动态详情');
    }
    // 媒体链接直接跳转，拦截原卡片的图片查看器；正文单击保留阅读。
    content.addEventListener('click', (e) => {
      const target = e.target as Element;
      if (target.closest('button')) return;
      if (target.closest('.dy-pics a, .dy-video')) { e.stopPropagation(); return; }
      if (target.closest('a')) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    content.addEventListener('dblclick', (e) => {
      if ((e.target as Element).closest('button, a')) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(d.url, '_blank', 'noopener,noreferrer');
    });
    return content;
  };
  const preview = async (d: Dyn, trigger: HTMLElement) => {
    clearTimeout(previewT);
    clearTimeout(detailCloseT);
    if (detailTrigger === trigger) return;
    clearTimeout(closeT);
    closeDetail();
    detailTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    const current = ++detailGeneration;
    const openLabel = d.video ? '打开视频' : '查看原动态';
    const source = h('a', { class: 'dp-detail-action', href: d.url, target: '_blank', rel: 'noopener', title: openLabel, 'aria-label': openLabel }, icon(ICONS.arrow));
    const close = h('button', { type: 'button', class: 'dp-detail-action', title: '关闭详情', 'aria-label': '关闭详情' }, icon(ICONS.close));
    close.onclick = () => closeDetail(true);
    const body = h('div', { class: 'dp-detail-scroll', 'aria-live': 'polite', 'aria-busy': 'true' }, h('p', {}, '正在获取详情…'));
    detail.replaceChildren(h('div', { class: 'dp-head' }, h('span', {}, d.video || d.orig?.video ? '视频摘要' : '动态详情'),
      h('div', { class: 'dp-detail-actions' }, source, close)), body);
    detail.hidden = false;
    const bounds = pop.getBoundingClientRect();
    detail.classList.toggle('dp-detail-left', bounds.right + 392 > innerWidth && bounds.left >= 392);
    detail.classList.toggle('dp-detail-overlay', bounds.right + 392 > innerWidth && bounds.left < 392);
    const loadDetail = async () => {
      const cached = detailCache.get(d.id);
      if (cached && Date.now() - cached.at < 60_000) {
        body.replaceChildren(renderContent(cached.value));
        body.setAttribute('aria-busy', 'false');
        return;
      }
      body.setAttribute('aria-busy', 'true');
      body.replaceChildren(h('p', {}, '正在获取详情…'));
      const request = new AbortController();
      detailRequest = request;
      const timeout = window.setTimeout(() => request.abort(), 10000);
      try {
        const response = await getJSON<{ item: unknown }>('/x/polymer/web-dynamic/v1/detail', { id: d.id, features: 'itemOpusStyle' }, request.signal);
        const fresh = toDyn(response.item);
        if (!fresh) throw new Error('empty');
        if (current === detailGeneration) {
          detailCache.set(d.id, { value: fresh, at: Date.now() });
          if (detailCache.size > 20) detailCache.delete(detailCache.keys().next().value!);
          body.replaceChildren(renderContent(fresh));
        }
      } catch {
        if (current !== detailGeneration) return;
        const retry = h('button', { type: 'button', class: 'dp-detail-retry' }, '重新获取');
        retry.onclick = () => void loadDetail();
        body.replaceChildren(h('p', {}, '详情获取失败，可重试或打开原链接查看。'), retry);
      } finally { clearTimeout(timeout); if (current === detailGeneration) body.setAttribute('aria-busy', 'false'); }
    };
    await loadDetail();
  };
  const delayCloseDetail = () => {
    clearTimeout(detailCloseT);
    detailCloseT = window.setTimeout(() => closeDetail(), CLOSE_DELAY);
  };
  detail.addEventListener('pointerenter', () => { clearTimeout(detailCloseT); clearTimeout(closeT); });
  detail.addEventListener('pointerleave', delayCloseDetail);
  const hoverPreview = (d: Dyn, trigger: HTMLElement, entering: boolean) => {
    clearTimeout(previewT);
    if (!entering) { delayCloseDetail(); return; }
    clearTimeout(detailCloseT);
    previewT = window.setTimeout(() => { if (open && trigger.isConnected) void preview(d, trigger); }, 500);
  };
  const renderRow = (r: PopRow) => row(r, hoverPreview, () => {
    loadedAt = 0;
    if (!list.querySelector('.dp-row') && done) list.replaceChildren(h('p', { class: 'dp-empty' }, spec.empty));
    else requestAnimationFrame(fill);
  });
  // 屏蔽词过滤：主列表和分页追加都走同一套判断
  const visible = (rows: PopRow[]) => filter && spec.filterRow
    ? rows.filter((r) => { const t = spec.filterRow!(r); return !t || filter.allows(t); })
    : rows;
  // 关键词也要能命中视频标签：列表过滤前先预热标签
  const prepareRows = async (rows: PopRow[]) => {
    if (filter && spec.filterRow) await filter.prepare(rows.map((r) => bvidFromHref(r.href)));
  };
  // 分页：滚到离底部 120px 内追加下一页；列表不够高时一直补到出现滚动条
  // 用 IntersectionObserver 看列表末尾的哨兵，滚动时不读布局
  const tail = spec.canLoadMore ? h('button', { class: 'dp-more', type: 'button' }, '加载更多') : h('i', { class: 'dp-tail', 'aria-hidden': 'true' });
  let tailSeen = false;
  const fill = () => {
    if (done || busy || !spec.more || !open) return;
    if (!tail.isConnected) list.append(tail);
    if (!tailSeen) return;
    const restoreFocus = tail.matches(':focus');
    if (spec.canLoadMore) { tailSeen = false; (tail as HTMLButtonElement).disabled = true; tail.textContent = '加载中…'; }
    busy = true;
    const current = generation;
    const sk = h('div', { class: 'dp-skel' });
    tail.before(sk);
    spec.more(videosOnly).then(async (rows) => {
      if (current !== generation) return;
      sk.remove();
      if (!rows.length) { done = true; tail.before(h('p', { class: 'dp-end' }, '没有更多了')); if (restoreFocus && spec.canLoadMore) btn.focus({ preventScroll: true }); tail.remove(); return; }
      await prepareRows(rows);
      if (current !== generation) return;
      const shown = visible(rows);
      const nodes = shown.map(renderRow); tail.before(...nodes);
      if (spec.canLoadMore && !spec.canLoadMore()) { done = true; if (restoreFocus) (nodes[0] ?? btn).focus({ preventScroll: true }); tail.remove(); }
      else if (spec.canLoadMore) tail.textContent = '加载更多';
      if (!shown.length) requestAnimationFrame(fill);
    }).catch(() => {
      if (current !== generation) return;
      sk.remove(); done = !spec.canLoadMore;
      if (spec.canLoadMore) tail.textContent = '加载失败，重试';
      else {
        const retry = h('button', { type: 'button', class: 'dp-more' }, '加载失败，重试');
        retry.onclick = () => { retry.remove(); done = false; tailSeen = true; fill(); };
        tail.before(retry);
      }
    })
      .finally(() => { if (current === generation) { busy = false; if (spec.canLoadMore) (tail as HTMLButtonElement).disabled = false; requestAnimationFrame(fill); } });
  };
  if (spec.canLoadMore) tail.addEventListener('click', () => { tailSeen = true; fill(); });
  else if (spec.more) new IntersectionObserver((es) => { tailSeen = es[es.length - 1].isIntersecting; if (tailSeen) fill(); }, { root: list, rootMargin: '0px 0px 160px 0px' }).observe(tail);

  const load = () => {
    if (Date.now() - loadedAt < 60_000 && list.querySelector('.dp-row')) return;
    loadedAt = Date.now();
    closeDetail();
    detailCache.clear();
    const current = ++generation;
    busy = true; done = true;
    list.replaceChildren(...Array.from({ length: spec.compact ? 5 : 4 }, () => h('div', { class: 'dp-skel' })));
    spec.load(videosOnly).then(async (rows) => {
      if (current !== generation) return;
      if (rows === null) { loadedAt = 0; list.replaceChildren(h('p', { class: 'dp-empty' }, `登录后可在这里看到${spec.title}`)); return; }
      await prepareRows(rows);
      if (current !== generation) return;
      const shown = visible(rows);
      list.replaceChildren(...(shown.length ? shown.map(renderRow) : [h('p', { class: 'dp-empty' }, spec.empty)]));
      done = !spec.more || !rows.length || spec.canLoadMore?.() === false;
      requestAnimationFrame(fill);
    }).catch(() => {
      if (current !== generation) return;
      loadedAt = 0;
      list.replaceChildren(h('p', { class: 'dp-empty' }, '暂时没取到，稍后再试'));
      done = true;
    }).finally(() => { if (current === generation) { busy = false; requestAnimationFrame(fill); } });
  };

  if (videoFilter) {
    const apply = (value: boolean) => {
      videoFilter.setAttribute('aria-checked', String(value));
      if (videosOnly === value) return;
      videosOnly = value; loadedAt = 0; generation++; busy = false; done = true;
      if (open) load();
    };
    loadSettings().then(s => apply(s.dynamicVideoOnly)).catch(() => {});
    onSettingsChange(s => apply(s.dynamicVideoOnly));
    videoFilter.onclick = async () => {
      (videoFilter as HTMLButtonElement).disabled = true;
      try { await saveSettings({ dynamicVideoOnly: !videosOnly }); }
      catch { videoFilter.title = '设置保存失败，请重试'; }
      finally { (videoFilter as HTMLButtonElement).disabled = false; }
    };
  }

  const place = (target?: DOMRect) => {
    // 挂在顶栏里（顶栏 z-index 高于正文），按顶栏坐标定位
    const host = pop.parentElement ?? btn;
    const r = target ?? btn.getBoundingClientRect(), o = host.getBoundingClientRect();
    const w = pop.offsetWidth || 360;
    const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
    pop.style.left = `${left - o.left}px`;
    pop.style.top = `${r.bottom - o.top + 10}px`;
  };

  const expandedRect = (host: HTMLElement): DOMRect => {
    const buttons = Array.from(host.querySelectorAll<HTMLElement>('.et-btn'));
    const index = buttons.indexOf(btn);
    if (index < 0 || !host.parentElement) return btn.getBoundingClientRect();
    const bounds = host.getBoundingClientRect();
    const copy = host.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.dp').forEach((p) => p.remove());
    copy.setAttribute('aria-hidden', 'true');
    copy.inert = true;
    copy.style.cssText += `;position:fixed;left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;box-sizing:border-box;visibility:hidden;pointer-events:none;`;
    copy.querySelectorAll<HTMLElement>('*').forEach((el) => { el.style.setProperty('transition', 'none', 'important'); el.style.setProperty('animation', 'none', 'important'); });
    host.parentElement.append(copy);
    const rect = copy.querySelectorAll<HTMLElement>('.et-btn')[index]?.getBoundingClientRect();
    copy.remove();
    return rect ?? btn.getBoundingClientRect();
  };

  const show = () => {
    if (open) return;
    if (spec.enabled && !spec.enabled()) return;
    open = true;
    // 同一时间只开一个
    pop.parentElement?.querySelectorAll<HTMLElement>('.dp[data-open]').forEach((p) => p !== pop && p.dispatchEvent(new Event('dp-close')));
    const host = btn.closest('header') ?? btn.parentElement!;
    if (pop.parentNode !== host) host.append(pop);
    host.querySelectorAll<HTMLElement>('.dp[data-open]').forEach((p) => p !== pop && p.dispatchEvent(new Event('dp-close')));
    pop.hidden = false;
    place(expandedRect(host));
    load();
    void pop.offsetWidth;
    pop.setAttribute('data-open', '');
    btn.setAttribute('aria-expanded', 'true');
    spec.onOpen?.();
  };
  const hide = () => {
    if (!open) return;
    open = false;
    closeDetail();
    pop.removeAttribute('data-open');
    btn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!open) pop.hidden = true; }, 200);
  };
  pop.addEventListener('dp-close', hide);

  const enter = (e: Event) => {
    if ((e as PointerEvent).pointerType === 'touch') return;
    if (spec.enabled && !spec.enabled()) return;
    clearTimeout(closeT);
    if (!open) { clearTimeout(openT); if (OPEN_DELAY) openT = window.setTimeout(show, OPEN_DELAY); else show(); }
  };
  const leave = () => { clearTimeout(previewT); clearTimeout(openT); clearTimeout(closeT); closeT = window.setTimeout(hide, CLOSE_DELAY); };
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('pointerenter', enter);
  btn.addEventListener('pointerleave', leave);
  btn.addEventListener('click', () => { clearTimeout(openT); hide(); });
  pop.addEventListener('pointerenter', () => clearTimeout(closeT));
  pop.addEventListener('pointerleave', leave);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!detail.hidden) closeDetail(true); else hide(); } });
  addEventListener('resize', () => { closeDetail(); if (open) place(); });
  btn.ownerDocument.addEventListener('pointerdown', (e) => { if (open && !e.composedPath().includes(pop) && !e.composedPath().includes(btn)) hide(); });
  return {
    close: hide,
    invalidate() { loadedAt = 0; if (open) load(); },
  };
}

/* ---------- 各入口的数据 ---------- */

function dynSummary(d: Dyn): { line: string; cover: string; kind: string } {
  if (d.video) return { line: d.video.title, cover: d.video.cover, kind: '视频' };
  if (d.article) return { line: d.article.title, cover: d.article.cover, kind: '专栏' };
  const o = d.orig;
  if (o && !d.text) {
    const s = dynSummary(o);
    return { line: `转发 @${o.author}：${s.line}`, cover: s.cover, kind: '转发' };
  }
  return { line: d.title || d.text || '分享了动态', cover: d.pics[0] ?? '', kind: d.pics.length ? '图文' : '动态' };
}

const dur = (s: number) => { const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`; };

/** 接口分页大小不一，缓存本页余量，每次只向预览追加 8 条。 */
function previewPages(fetchPage: (first: boolean) => Promise<{ rows: PopRow[]; more: boolean } | null>): Pick<PopSpec, 'load' | 'more'> {
  let pending: PopRow[] = [], more = true;
  const page = async (first: boolean): Promise<PopRow[] | null> => {
    if (first) { pending = []; more = true; }
    if (!pending.length && more) {
      const result = await fetchPage(first);
      if (!result) return null;
      pending = result.rows; more = result.more;
    }
    return pending.splice(0, 8);
  };
  return { load: () => page(true), more: async () => await page(false) ?? [] };
}

/** B 站分区：番剧影视走频道页，其余走 /c/ 分区页 */
const ZONES: [string, string][] = [
  ['番剧', 'anime/'], ['国创', 'guochuang/'], ['电影', 'movie/'], ['电视剧', 'tv/'], ['纪录片', 'documentary/'], ['综艺', 'variety/'],
  ['动画', 'c/douga/'], ['游戏', 'c/game/'], ['鬼畜', 'c/kichiku/'], ['音乐', 'c/music/'], ['舞蹈', 'c/dance/'], ['影视', 'c/cinephile/'],
  ['娱乐', 'c/ent/'], ['知识', 'c/knowledge/'], ['科技', 'c/tech/'], ['资讯', 'c/information/'], ['美食', 'c/food/'], ['生活', 'c/life/'],
  ['汽车', 'c/car/'], ['时尚', 'c/fashion/'], ['运动', 'c/sports/'], ['动物圈', 'c/animal/'], ['课堂', 'cheese/'], ['排行榜', 'v/popular/rank/all'],
];

export const POPS: Record<string, (o: { onDyn?: () => void; msgRemind?: () => boolean }) => PopSpec> = {
  分区: () => ({
    title: '分区', all: { href: 'https://www.bilibili.com/v/popular/all', label: '热门' }, empty: '', grid: true,
    load: async () => ZONES.map(([t, path]) => ({ href: `https://www.bilibili.com/${path}`, title: t })),
  }),
  直播: () => {
    let rows: PopRow[] = [], offset = 0, complete = false;
    const convert = (u: Awaited<ReturnType<typeof followingLive>>[number]): PopRow => ({ href: u.url, face: u.face, live: true, who: u.name, sub: '直播中', title: u.title || '正在直播' });
    return {
      title: '正在直播', all: { href: 'https://link.bilibili.com/p/center/index#/user-center/follow/1', label: '我的关注' }, empty: '关注的主播都还没开播',
      load: async () => { const p = await portal(); rows = p.live.map(convert); offset = Math.min(8, rows.length); complete = p.liveCount <= rows.length; return rows.slice(0, offset); },
      canLoadMore: () => offset < rows.length || !complete,
      more: async () => {
        if (!complete) { const extra = await followingLive(); const seen = new Set(rows.map(r => r.href)); for (const u of extra) if (!seen.has(u.url)) { seen.add(u.url); rows.push(convert(u)); } complete = true; }
        const next = rows.slice(offset, offset + 8); offset += next.length; return next;
      },
    };
  },
  消息: (o) => ({
    title: '消息', all: { href: 'https://message.bilibili.com/?margin-fresh=1', label: '消息中心' }, empty: '', compact: true,
    enabled: o.msgRemind,
    load: async () => {
      const u = await unread();
      // 把自己刚拿到的这份未读数据直接交给顶栏角标（同一次响应、当场对齐，不再各自取数导致数字打架）
      dispatchEvent(new CustomEvent('margin:unread', { detail: { total: u.reply + u.at + u.like + u.system + u.chat } }));
      // margin-fresh=1：消息页加载后自刷新一次，规避第一次加载拿到旧数据（用户实测 F5 必新）
      const M = 'https://message.bilibili.com/?margin-fresh=1#/';
      return [
        { href: `${M}reply`, title: '回复我的', count: u.reply },
        { href: `${M}at`, title: '@ 我的', count: u.at },
        { href: `${M}love`, title: '收到的赞', count: u.like },
        { href: `${M}system`, title: '系统通知', count: u.system },
        { href: `${M}whisper`, title: '我的消息', count: u.chat },
      ];
    },
  }),
  动态: (o) => {
    let offset = '', more = true, generation = 0;
    const toRow = (d: Dyn): PopRow => {
      const s = dynSummary(d);
      const laterBvid = d.video?.bvid || d.orig?.video?.bvid || bvidFromHref(d.attachment?.url || d.orig?.attachment?.url);
      return { href: d.url, face: d.face, who: d.author, sub: `${ago(d.ts, d.time)} · ${s.kind}`, title: s.line, cover: s.cover || undefined, laterBvid, dynamic: d };
    };
    const page = async (first: boolean, videosOnly = false) => {
      if (first) { offset = ''; more = true; generation++; }
      if (!more) return [];
      const current = generation;
      const r = await followFeed(videosOnly ? 'video' : 'all', offset);
      if (current !== generation) return [];
      offset = r.offset; more = r.more && !!r.offset;
      return r.list.map(toRow);
    };
    return {
      title: '最新动态', all: { href: 'https://t.bilibili.com/', label: '全部动态' }, empty: '还没有新动态', onOpen: o.onDyn,
      filterRow: (r) => targetOfPopRow(r),
      videoFilter: true, load: (videosOnly) => page(true, videosOnly), more: (videosOnly) => page(false, videosOnly),
    };
  },
  历史: () => {
    let cursor: Cursor | null = null;
    return {
    title: '最近看过', all: { href: 'https://www.bilibili.com/history', label: '全部历史' }, empty: '还没有观看记录',
    filterRow: (r) => targetOfPopRow(r),
    ...previewPages(async first => {
      const result = await historyList('all', first ? null : cursor);
      cursor = result.cursor;
      return { more: !!cursor, rows: result.list.map((x) => ({
      href: x.url, title: x.title, who: x.author, sub: `${ago(x.viewAt)} · ${x.device}`, cover: x.cover,
      progress: x.duration > 0 ? (x.progress < 0 ? 1 : x.progress / x.duration) : undefined,
      })) };
    }),
  }; },
  收藏: () => {
    let page = 1;
    return {
    title: '收藏夹', all: { href: 'https://www.bilibili.com/#fav', label: '全部收藏' }, empty: '还没有收藏夹',
    ...previewPages(async first => {
      const next = first ? 1 : page;
      const f = await folders(false, next);
      if (!f) return null;
      page = next + 1;
      return { more: f.length === 50, rows: f.map((x) => ({ href: `https://space.bilibili.com/${x.mid}/favlist?fid=${x.id}`, title: x.title, sub: `${x.count} 个内容${x.isPrivate ? ' · 私密' : ''}`, cover: x.cover })) };
    }),
  }; },
  稍后: () => ({
    title: '稍后再看', all: { href: 'https://www.bilibili.com/list/watchlater', label: '全部' }, empty: '稍后再看是空的',
    filterRow: (r) => targetOfPopRow(r),
    ...previewPages(async () => {
      const l = await watchLater();
      return l && { more: false, rows: l.map((x) => ({
        href: `https://www.bilibili.com/list/watchlater?bvid=${x.bvid}`, title: x.title, who: x.author, sub: dur(x.duration), cover: x.cover,
        progress: x.duration > 0 ? (x.progress < 0 ? 1 : x.progress / x.duration) : undefined,
        remove: () => removeWatchLater(x.aid),
      })) };
    }),
  }),
};
