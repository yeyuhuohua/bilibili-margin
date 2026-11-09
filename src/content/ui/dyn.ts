import { dynCommentTarget, dynLike, dynReplies, dynReply, dynRepost, dynReserve, dynSubReplies, type Dyn, type DynText, type Reply } from '../api/dyn';
import { fmtAgo, fmtCount, h, icon, ICONS, safeUrl } from './dom';
import { laterButton } from './later-btn';
import { openLightbox } from './lightbox';
import { appUrl, openBili } from '../navigation';

const img = (src: string, w: number, hgt?: number) => h('img', { src: src ? `${src}@${w}w${hgt ? `_${hgt}h_1c` : ''}.webp` : '', alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
const ext = { target: '_blank', rel: 'noopener' };

function replyText(text: string, emotes: Record<string, string> = {}): (Node | string)[] {
  const out: (Node | string)[] = [];
  let rest = text;
  while (rest) {
    let at = -1, token = '';
    for (const key of Object.keys(emotes)) {
      if (!key) continue;
      const i = rest.indexOf(key);
      if (i >= 0 && (at < 0 || i < at || (i === at && key.length > token.length))) { at = i; token = key; }
    }
    if (at < 0) { out.push(rest); break; }
    if (at) out.push(rest.slice(0, at));
    out.push(h('img', { class: 'dy-rem', src: emotes[token], alt: token, title: token, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }));
    rest = rest.slice(at + token.length);
  }
  return out;
}

function replyUser(r: Reply): HTMLElement {
  const m = r.medal;
  const medalStyle = m ? [
    m.color && `--medal-bg:${m.color}`, m.endColor && `--medal-end:${m.endColor}`,
    m.borderColor && `--medal-border:${m.borderColor}`, m.nameColor && `--medal-name:${m.nameColor}`, m.levelColor && `--medal-level:${m.levelColor}`,
  ].filter(Boolean).join(';') : '';
  return h('div', { class: 'dy-r-user' },
    h('a', { class: 'dy-r-name', href: `https://space.bilibili.com/${r.mid}`, ...ext }, r.name),
    r.level ? h('img', { class: 'dy-r-level', src: `https://i0.hdslb.com/bfs/seed/jinkela/short/webui/user-profile/img/level_${r.senior ? 'h' : r.level}.svg`, alt: r.senior ? '硬核会员' : `Lv${r.level}`, title: r.senior ? '硬核会员' : `用户等级 Lv${r.level}`, width: '30', height: '30', loading: 'lazy' }) : null,
    m ? h('span', { class: `dy-r-medal${m.firstIcon || m.secondIcon ? ' has-icon' : ''}`, title: `${m.name} ${m.level} 级粉丝勋章`, style: medalStyle },
      m.firstIcon ? h('img', { class: 'dy-r-medal-first', src: m.firstIcon, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      m.secondIcon ? h('img', { class: 'dy-r-medal-second', src: m.secondIcon, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
      h('span', { class: 'dy-r-medal-text' }, h('span', { class: 'dy-r-medal-name' }, m.name), h('b', { class: 'dy-r-medal-level' }, String(m.level)))) : null,
    r.nameplate ? h('img', { class: 'dy-r-nameplate', src: r.nameplate.image, alt: r.nameplate.name, title: r.nameplate.name, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : null);
}

/** 动态卡 → 原始数据；屏蔽词变化时重新判断用 */
export const dynData = new WeakMap<Element, Dyn>();

function richText(text: string, parts?: DynText[]): (Node | string)[] {
  return parts?.length ? parts.map((part) => {
    if (!part.emoji) return part.text;
    const emoji = h('img', { class: 'dy-emoji dy-rem', src: part.emoji, alt: part.text, title: part.text,
      loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer',
      onerror: () => emoji.replaceWith(document.createTextNode(part.text)),
    });
    return emoji;
  }) : [text];
}

/** 动态卡：杂志式单栏。日期眉标 + 正文 + 媒体（视频横卡 / 图片网格 / 专栏）+ 等宽统计 */
export function dynCard(d: Dyn, nested = false, withAuthor = false): HTMLElement {
  const media: (Node | null)[] = [];
  if (d.video) {
    media.push(h('a', { class: 'dy-video', href: `https://www.bilibili.com/video/${d.video.bvid}`, ...ext },
      h('span', { class: 'dy-vcover', 'data-bvid': d.video.bvid }, img(d.video.cover, 480, 270), d.video.dur ? h('span', { class: 'dur' }, d.video.dur) : null, laterButton(d.video.bvid)),
      h('span', { class: 'dy-vbody' },
        h('span', { class: 'dy-vtitle' }, d.video.title),
        d.video.desc ? h('span', { class: 'dy-vdesc' }, d.video.desc) : null,
        h('span', { class: 'dy-vmeta' }, d.video.play ? `${d.video.play} 播放` : 'VIDEO'))));
  }
  if (d.pics.length) {
    const n = Math.min(d.pics.length, 9);
    media.push(h('div', { class: `dy-pics n${n === 1 ? 1 : n <= 4 && n !== 3 ? 2 : 3}` },
      ...d.pics.slice(0, 9).map((p, i) => {
        // 点小图在页内打开图组查看器（GitHub #8）；中键 / Ctrl 点仍按链接新标签打开原图
        const a = h('a', { href: p, 'aria-label': `查看第 ${i + 1} 张图`, ...ext }, img(p, n === 1 ? 720 : 360, n === 1 ? undefined : 360),
          i === 8 && d.pics.length > 9 ? h('span', { class: 'dy-pics-more' }, `+${d.pics.length - 9}`) : null);
        a.addEventListener('click', (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); e.stopPropagation(); openLightbox(d.pics, i, a.getRootNode()); });
        return a;
      })));
  }
  if (d.article) {
    media.push(h('a', { class: 'dy-article', href: d.article.url, ...ext },
      d.article.cover ? img(d.article.cover, 320, 200) : null,
      h('span', {}, h('b', {}, d.article.title), h('span', {}, d.article.desc))));
  }
  if (d.live) {
    media.push(h('a', { class: 'dy-video dy-live', href: d.live.url, ...ext },
      h('span', { class: 'dy-vcover' }, img(d.live.cover, 480, 270), h('span', { class: `dy-livebadge${d.live.on ? ' on' : ''}` }, d.live.on ? '直播中' : '直播')),
      h('span', { class: 'dy-vbody' },
        h('span', { class: 'dy-vtitle' }, d.live.title || '开播了'),
        h('span', { class: 'dy-vmeta' }, d.live.meta || 'LIVE'))));
  }
  for (const link of [d.link, d.attachment]) {
    if (!link) continue;
    media.push(h('a', { class: 'dy-article', href: link.url, ...ext },
      link.cover ? img(link.cover, 320, 200) : null,
      h('span', {}, h('b', {}, link.title), h('span', {}, [link.kind, link.desc].filter(Boolean).join(' · ')))));
  }
  if (d.reserve) media.push(reserveCard(d));
  if (d.orig) media.push(h('div', { class: 'dy-orig' }, h('div', { class: 'dy-orig-by' }, `@${d.orig.author}`), dynCard(d.orig, true)));

  // 长文折叠（GitHub #8）：按字数 / 行数判断，不读布局
  const long = !!d.text && (d.text.length > 240 || d.text.split('\n').length > 8);
  const text = d.text ? h('p', { class: long ? 'dy-text fold' : 'dy-text' }, ...(d.richText ? richText(d.text, d.richText) : replyText(d.text, d.emotes))) : null;
  const more = long ? h('button', { type: 'button', class: 'dy-more', 'aria-expanded': 'false', onclick: (e: Event) => {
    e.stopPropagation();
    const on = text!.classList.toggle('fold');
    more!.textContent = on ? '展开全文' : '收起';
    more!.setAttribute('aria-expanded', String(!on));
  } }, '展开全文') : null;
  const body = h('div', { class: 'dy-body' },
    d.title ? h('h3', { class: 'dy-title' }, d.title) : null,
    text, more,
    ...media);
  if (nested) return clickable(h('div', { class: 'dy nested' }, body), d.url);
  const open = () => h('a', { class: 'dy-open', href: d.url, ...ext, title: '查看详情' }, icon(ICONS.arrow));
  // 动态首页：21st SocialPostCard 的作者行（头像 · 名字 · 时间/类型），空间页作者固定所以只留眉标
  const by = withAuthor ? h('div', { class: 'dy-by' },
    h('a', { class: 'dy-by-face', href: `https://space.bilibili.com/${d.mid}`, 'aria-label': `${d.author} 的个人空间`, ...ext }, h('img', { src: d.face ? `${d.face}@80w_80h_1c.webp` : '', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })),
    h('div', { class: 'dy-by-b' },
      h('a', { class: 'dy-by-name', href: `https://space.bilibili.com/${d.mid}`, ...ext }, d.author),
      h('div', { class: 'dy-eyebrow' }, h('span', {}, d.ts ? fmtAgo(d.ts) : d.time), h('span', { class: 'dy-kind' }, kindLabel(d)))),
    open()) : null;
  const el = clickable(h('article', { class: withAuthor ? 'dy with-by' : 'dy' },
    by ?? h('div', { class: 'dy-eyebrow' },
      h('span', {}, d.ts ? fmtAgo(d.ts) : d.time),
      h('span', { class: 'dy-kind' }, kindLabel(d)),
      h('a', { class: 'dy-open', href: d.url, ...ext, title: '查看详情' }, icon(ICONS.arrow))),
    body,
    actions(d)), d.url);
  dynData.set(el, d);
  return el;
}

function reserveCard(d: Dyn): HTMLElement {
  const reserve = d.reserve!;
  const card = h('section', { class: 'dy-reserve', 'aria-label': '预约信息' });
  if (reserve.state === 1 || reserve.state === -1) {
    card.append(h('span', {}, reserve.state === 1 ? '原预约信息已删除' : '请在最新版哔哩哔哩客户端查看预约'));
    return card;
  }
  const description = h('span', { class: 'dy-reserve-desc' });
  const detail = h('a', { class: 'dy-reserve-detail', href: reserve.jump_url || d.url, ...ext },
    h('b', {}, reserve.title || '直播预约'), description);
  if (reserve.premiere?.cover) card.append(h('a', { class: 'dy-reserve-cover', href: reserve.jump_url || d.url, ...ext }, img(reserve.premiere.cover, 240, 150)));
  card.append(detail);
  const state = reserve.button;
  const status = h('span', { class: 'dy-reserve-status', role: 'status' });
  const updateDescription = () => { description.textContent = [reserve.badge_text, reserve.desc1?.text,
    reserve.desc2?.visible ? reserve.desc2.text : '', reserve.premiere?.online].filter(Boolean).join(' · '); };
  updateDescription();
  if (state?.type === 1) {
    card.append(h('a', { class: 'dy-reserve-action', href: reserve.jump_url || d.url, ...ext }, state.jump_style?.text || '查看详情'));
  } else if (state?.type === 2 && reserve.rid && (state.status === 1 || state.status === 2)) {
    const button = h('button', { class: 'dy-reserve-action', type: 'button' }) as HTMLButtonElement;
    const style = () => state.status === 2 ? state.check : state.uncheck;
    const render = () => {
      button.textContent = style()?.text || (state.status === 2 ? '已预约' : '预约');
      button.disabled = style()?.disable === 1;
      button.title = style()?.toast || '';
      button.setAttribute('aria-pressed', String(state.status === 2));
      updateDescription();
    };
    let busy = false;
    button.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (busy || button.disabled) return;
      const interactive = style()?.interactive;
      if (interactive && !confirm([interactive.popups, interactive.desc].filter(Boolean).join('\n') || '确认更改预约？')) return;
      busy = true; button.disabled = true; button.setAttribute('aria-busy', 'true'); status.textContent = '';
      try { status.textContent = await dynReserve(d.id, reserve); }
      catch (error) { status.textContent = (error as Error).message || '预约失败，请重试'; }
      finally { busy = false; button.removeAttribute('aria-busy'); render(); }
    });
    render(); card.append(button);
  }
  if (reserve.desc3?.text) {
    card.append(h('a', { class: 'dy-reserve-extra', href: reserve.desc3.jump_url || d.url, ...ext }, reserve.desc3.text));
  }
  card.append(status);
  return card;
}

/**
 * 整张卡片可点进详情（GitHub #8：「查看详情」按钮太小）。卡片里的链接、按钮照常；
 * 选中文字时不跳转；转发里的原动态点进原动态。应用窗口内中键沿用站内导航。
 */
function clickable(el: HTMLElement, url: string): HTMLElement {
  if (!url || !safeUrl(url)) return el;
  el.dataset.href = url;
  const go = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, input, textarea, video, .dy-box')) return;
    if (String(getSelection() ?? '').trim()) return;
    e.stopPropagation();
    openBili(url, '_blank', 'noopener', e);
  };
  el.addEventListener('click', go);
  // Windows 自动滚屏会吞掉非链接卡片的 auxclick，应用窗口内先取消它。
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 1 || (e.target as HTMLElement).closest('a, button, input, textarea, video, .dy-box')) return;
    if (appUrl(url, e)) e.preventDefault();
  });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) go(e); });
  return el;
}

function kindLabel(d: Dyn): string {
  if (d.orig) return 'REPOST';
  if (d.live) return 'LIVE';
  if (d.video) return 'VIDEO';
  if (d.article) return 'ARTICLE';
  if (d.pics.length) return 'PHOTO';
  return 'NOTE';
}

function replyRow(r: Reply): HTMLElement {
  return h('div', { class: 'dy-r' },
    h('a', { class: `dy-r-face${r.pendant ? ' has-pendant' : ''}`, href: `https://space.bilibili.com/${r.mid}`, ...ext },
      h('img', { class: 'dy-r-avatar', src: r.face ? `${r.face}@64w_64h_1c.webp` : '', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
      r.pendant ? h('img', { class: 'dy-r-pendant', src: r.pendant, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }) : null),
    h('div', { class: 'dy-r-b' },
      replyUser(r),
      h('p', {}, ...(r.richText ? richText(r.text, r.richText) : replyText(r.text, r.emotes))),
      h('span', { class: 'dy-r-meta' }, [fmtAgo(r.ts), r.location, r.like ? `赞 ${fmtCount(r.like)}` : ''].filter(Boolean).join(' · '))));
}

/** 21st 嵌套回复的缩进与收起交互；B 站楼中楼按根评论分页，首次展开才请求。 */
function replyThread(r: Reply, type: number, oid: string, active: () => boolean): HTMLElement {
  const row = replyRow(r);
  if (!r.rcount) return row;
  const toggle = h('button', { type: 'button', class: 'dy-replies-toggle', 'aria-expanded': 'false' }, `展开 ${r.rcount} 条回复`);
  const status = h('div', { class: 'dy-rempty', role: 'status' });
  const more = h('button', { type: 'button', class: 'dy-replies-more' }, '加载更多回复') as HTMLButtonElement;
  const list = h('div', { class: 'dy-sublist', hidden: '' }, status, more);
  const seen = new Set<string>();
  let page = 0, busy = false;
  const load = async () => {
    if (busy || !active()) return;
    busy = true; more.disabled = true; status.textContent = '加载中…';
    try {
      const result = await dynSubReplies(type, oid, r.rpid, page + 1);
      if (!active()) return;
      page++;
      for (const reply of result.list) {
        if (seen.has(reply.rpid)) continue;
        seen.add(reply.rpid); list.insertBefore(replyRow(reply), status);
      }
      status.textContent = seen.size ? '' : '暂无回复';
      more.textContent = '加载更多回复';
      if (!result.more) {
        if (more.matches(':focus')) toggle.focus();
        more.remove();
      }
    } catch (err) {
      if (!active()) return;
      status.textContent = `回复加载失败：${(err as Error).message}`;
      more.textContent = '重试加载回复';
    } finally { busy = false; more.disabled = false; }
  };
  more.addEventListener('click', () => void load());
  toggle.addEventListener('click', () => {
    const open = list.hidden;
    list.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? '收起回复' : `展开 ${r.rcount} 条回复`;
    if (open && !page) void load();
  });
  row.querySelector('.dy-r-b')!.append(toggle, list);
  return row;
}

/**
 * 动态卡底部互动条（v0.50，B 站评论建议：点赞、转发、评论不用跳详情页）。
 * 赞：直接切换；转发：卡片里展开一句话输入框，点「转发」才发出；评论：卡片里展开热门评论 + 输入框，
 * 「全部评论」仍新标签打开详情页。没有评论区信息（直播等）时保留原来的链接。
 */
function actions(d: Dyn): HTMLElement {
  const bar = h('div', { class: 'dy-stat dy-acts' });
  const wrap = h('div', { class: 'dy-foot' }, bar);
  const say = (t: string) => { const tip = h('span', { class: 'dy-tip', role: 'status' }, t); bar.querySelector('.dy-tip')?.remove(); bar.append(tip); setTimeout(() => tip.remove(), 2400); };
  // 转发
  const fwd = h('button', { type: 'button', class: 'dy-act', 'aria-expanded': 'false' }, `转发 ${fmtCount(d.stat.forward)}`);
  let fwdBox: HTMLElement | null = null;
  fwd.addEventListener('click', (e) => {
    e.stopPropagation();
    if (fwdBox) { fwdBox.remove(); fwdBox = null; fwd.setAttribute('aria-expanded', 'false'); return; }
    closeCmt();
    const ta = h('textarea', { class: 'dy-in', rows: '2', maxlength: '233', placeholder: '说点什么（可留空）' }) as HTMLTextAreaElement;
    const send = h('button', { type: 'button', class: 'dy-send' }, '转发');
    send.addEventListener('click', async () => {
      send.setAttribute('disabled', '');
      try {
        await dynRepost(d.id, ta.value.trim());
        d.stat.forward++; fwd.textContent = `转发 ${fmtCount(d.stat.forward)}`;
        fwdBox?.remove(); fwdBox = null; fwd.setAttribute('aria-expanded', 'false'); say('已转发');
      } catch (err) { send.removeAttribute('disabled'); say(`转发失败：${(err as Error).message}`); }
    });
    fwdBox = h('div', { class: 'dy-box' }, ta, h('div', { class: 'dy-box-foot' }, send));
    wrap.append(fwdBox); fwd.setAttribute('aria-expanded', 'true'); ta.focus();
  });
  // 评论
  const canCmt = !!(d.cmtType && d.cmtOid) || (!!d.id && !d.live && !d.link);
  const cmt = canCmt
    ? h('button', { type: 'button', class: 'dy-act', 'aria-expanded': 'false' }, `评论 ${fmtCount(d.stat.comment)}`)
    : d.url ? h('a', { class: 'dy-cmt', href: `${d.url}#comment`, ...ext, title: '查看评论' }, `评论 ${fmtCount(d.stat.comment)}`) : h('span', {}, `评论 ${fmtCount(d.stat.comment)}`);
  let cmtBox: HTMLElement | null = null;
  let commentGen = 0;
  function closeCmt(): void { commentGen++; cmtBox?.remove(); cmtBox = null; if (canCmt) cmt.setAttribute('aria-expanded', 'false'); }
  if (canCmt) cmt.addEventListener('click', (e) => {
    e.stopPropagation();
    if (cmtBox) { closeCmt(); return; }
    const gen = ++commentGen;
    fwdBox?.remove(); fwdBox = null; fwd.setAttribute('aria-expanded', 'false');
    const list = h('div', { class: 'dy-rlist' }, h('div', { class: 'dy-rempty' }, '加载中…'));
    const ta = h('textarea', { class: 'dy-in', rows: '1', maxlength: '1000', placeholder: '发一条友善的评论' }) as HTMLTextAreaElement;
    const send = h('button', { type: 'button', class: 'dy-send', disabled: '' }, '发布') as HTMLButtonElement;
    const post = async () => {
      const msg = ta.value.trim();
      if (!msg || send.disabled || !d.cmtType || !d.cmtOid) return;
      send.setAttribute('disabled', '');
      try {
        await dynReply(d.cmtType!, d.cmtOid!, msg);
        ta.value = ''; d.stat.comment++; cmt.textContent = `评论 ${fmtCount(d.stat.comment)}`;
        list.querySelector('.dy-rempty')?.remove();
        list.prepend(h('div', { class: 'dy-r mine' }, h('div', { class: 'dy-r-b' }, h('b', {}, '我'), h('p', {}, msg))));
      } catch (err) { say(`发布失败：${(err as Error).message}`); }
      send.removeAttribute('disabled');
    };
    send.addEventListener('click', post);
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); post(); } });
    cmtBox = h('div', { class: 'dy-box dy-cbox' }, h('div', { class: 'dy-box-row' }, ta, send), list,
      d.url ? h('a', { class: 'dy-rall', href: `${d.url}#comment`, ...ext }, '全部评论 ↗') : null);
    wrap.append(cmtBox); cmt.setAttribute('aria-expanded', 'true');
    void dynCommentTarget(d).then(async (target) => {
      if (gen !== commentGen) return;
      if (!target) throw new Error('暂不支持此动态的评论，请点「全部评论」');
      send.disabled = false;
      return dynReplies(target.type, target.oid);
    }).then((result) => {
      if (gen !== commentGen || !result) return;
      const rs = result.list;
      list.replaceChildren(...(rs.length ? rs.map((r) => replyThread(r, d.cmtType!, d.cmtOid!, () => gen === commentGen && !!cmtBox?.isConnected)) : [h('div', { class: 'dy-rempty' }, '还没有评论')]));
    }).catch((err) => { if (gen === commentGen) list.replaceChildren(h('div', { class: 'dy-rempty' }, `评论加载失败：${(err as Error).message}`)); });
  });
  // 赞
  const like = h('button', { type: 'button', class: 'dy-act dy-like', 'aria-pressed': String(!!d.liked) }, `赞 ${fmtCount(d.stat.like)}`);
  like.addEventListener('click', async (e) => {
    e.stopPropagation();
    const on = !d.liked;
    like.setAttribute('disabled', '');
    try {
      await dynLike(d.id, on);
      d.liked = on; d.stat.like += on ? 1 : -1;
      like.setAttribute('aria-pressed', String(on)); like.textContent = `赞 ${fmtCount(d.stat.like)}`;
    } catch (err) { say(`操作失败：${(err as Error).message}`); }
    like.removeAttribute('disabled');
  });
  bar.append(fwd, cmt, like);
  return wrap;
}
