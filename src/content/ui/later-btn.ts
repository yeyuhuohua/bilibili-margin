import { addWatchLater, removeWatchLater } from '../api/search';
import { h, icon, ICONS } from './dom';

/** 封面右上角「稍后再看」（#2：首页、空间、动态的视频封面都有），悬停出现；已加入后变成对勾 */
export function laterButton(bvid: string, aid?: number): HTMLElement {
  const b = h('button', { class: 'card-later', type: 'button', title: '稍后再看', 'aria-label': '加入稍后再看', 'aria-pressed': 'false' }, icon(ICONS.later)) as HTMLButtonElement;
  b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.state === 'busy') return;
    const removing = b.dataset.state === 'ok';
    b.dataset.state = 'busy';
    b.setAttribute('aria-busy', 'true');
    b.classList.remove('err');
    const r = removing
      ? { ok: await removeWatchLater(aid || bvid).catch(() => false), msg: '取消失败，点击重试' }
      : await addWatchLater(bvid).catch(() => ({ ok: false, msg: '加入失败，点击重试' }));
    const added = r.ok ? !removing : removing;
    b.dataset.state = added ? 'ok' : '';
    b.removeAttribute('aria-busy');
    b.setAttribute('aria-pressed', String(added));
    b.title = r.ok ? (added ? '取消稍后再看' : '加入稍后再看') : r.msg;
    b.setAttribute('aria-label', b.title);
    if (r.ok) b.replaceChildren(icon(added ? ICONS.check : ICONS.later));
    else { b.classList.add('err'); setTimeout(() => b.classList.remove('err'), 1600); }
  });
  return b;
}
