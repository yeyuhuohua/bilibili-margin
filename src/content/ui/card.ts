import type { Video } from '../api/feed';
import { fmtCount, fmtDateTime, fmtDuration, h, icon, ICONS } from './dom';
import { laterButton } from './later-btn';

const thumb = (url: string) => (url ? `${url}@672w_378h_1c.webp` : '');
export const cardData = new WeakMap<Element, Video>();

export interface CardOpts {
  onBlock?: (v: Video) => void; compact?: boolean;
  /** 「不感兴趣」（v0.46）：只有推荐流的卡片有 */
  onDislike?: (v: Video, card: HTMLElement) => void;
  /** 首页「卡片信息」里关掉的项（v0.43）：author / views / danmaku / ago / dur / reason */
  hide?: ReadonlySet<string>;
}

export function videoCard(v: Video, index: number, opts: CardOpts = {}): HTMLElement {
  const href = `https://www.bilibili.com/video/${v.bvid}`;
  const cover = h('a', { class: 'cover', href, target: '_blank', rel: 'noopener', 'aria-label': v.title },
    h('img', { src: thumb(v.cover), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }),
    v.duration && !opts.hide?.has('dur') ? h('span', { class: 'dur' }, fmtDuration(v.duration)) : null,
    v.coop ? h('span', { class: 'coop', title: '多位 UP 主联合投稿' }, '合作') : null,
    // v0.51：充电专属等角标（右上角，避开左上角的「合作」）
    v.badge ? h('span', { class: 'tag-charge', title: v.badge }, v.badge) : null,
    laterButton(v.bvid),
  );
  const acts: HTMLElement[] = [];
  if (opts.onDislike && v.trackId) {
    acts.push(h('button', {
      class: 'card-nope', type: 'button', title: '不感兴趣：以后少推这类视频', 'aria-label': `不感兴趣：${v.title}`,
      onclick: (e: Event) => { e.preventDefault(); e.stopPropagation(); opts.onDislike!(v, el); },
    }, icon(ICONS.close), h('span', {}, '不感兴趣')));
  }
  if (opts.onBlock) {
    acts.push(h('button', {
      class: 'card-block', type: 'button', title: `不看 ${v.author} 的视频`, 'aria-label': `屏蔽 UP 主 ${v.author}`,
      onclick: (e: Event) => { e.preventDefault(); e.stopPropagation(); opts.onBlock!(v); },
    }, icon(ICONS.block), h('span', {}, '屏蔽 UP')));
  }
  if (acts.length) cover.append(h('div', { class: 'card-acts' }, ...acts));
  const el = h('article', { class: `card${opts.compact ? ' compact' : ''}`, style: `--i:${index % 12}` },
    cover,
    h('div', { class: 'body' },
      h('a', { class: 'title', href, target: '_blank', rel: 'noopener', title: v.title }, v.title),
      metaRow(v, opts),
      pubTime(v, opts),
      v.reason && v.reason !== '已关注' && !opts.hide?.has('reason') ? h('span', { class: 'reason' }, v.reason) : null,
    ),
  );
  cardData.set(el, v);
  return el;
}

/** 发布时间：单独一行，精确到秒；不跟标题 / 信息行混排 */
function pubTime(v: Video, opts: CardOpts): HTMLElement | null {
  if (!v.pubdate || opts.compact || opts.hide?.has('ago')) return null;
  const text = fmtDateTime(v.pubdate);
  return text ? h('time', { class: 'pubtime', datetime: new Date(v.pubdate * 1000).toISOString() }, text) : null;
}

/** 卡片信息行：只放没关掉的项，分隔点跟在前一项后面，不会出现打头的「·」 */
function metaRow(v: Video, opts: CardOpts): HTMLElement {
  const off = (k: string) => !!opts.hide?.has(k);
  const parts: HTMLElement[] = [];
  if (!off('author')) parts.push(h('a', { class: 'author', title: v.author, href: `https://space.bilibili.com/${v.mid}`, target: '_blank', rel: 'noopener' },
    h('span', { class: 'author-name' }, v.author),
    v.reason === '已关注' ? h('span', { class: 'card-followed' }, icon(ICONS.check), '已关注') : null));
  if (!off('views')) parts.push(h('span', {}, `${fmtCount(v.views)} 播放`));
  if (v.danmaku && !off('danmaku')) parts.push(h('span', {}, `${fmtCount(v.danmaku)} 弹幕`));
  const meta = h('div', { class: 'meta' });
  parts.forEach((el, i) => { if (i) meta.append(h('span', { class: 'dot' }, '·')); meta.append(el); });
  if (!parts.length) meta.style.display = 'none';
  return meta;
}

export function skeleton(n: number): DocumentFragment {
  const f = document.createDocumentFragment();
  for (let i = 0; i < n; i++) f.append(h('div', { class: 'card sk' }, h('div', { class: 'cover' }), h('div', { class: 'line' }), h('div', { class: 'line short' })));
  return f;
}
