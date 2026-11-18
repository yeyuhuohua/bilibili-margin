import { removeFolderVideo, transferFolderVideo, type Folder } from '../api/fav';
import type { Video } from '../api/feed';
import { h, icon, ICONS } from './dom';

/** 收藏抽屉与个人空间共用原站收藏操作，只在请求成功后通知列表更新。 */
export function favoriteActions(video: Video, folder: Folder, targets: () => Folder[] | Promise<Folder[]>, changed: (action: 'remove' | 'move' | 'copy', target?: Folder) => void): HTMLElement {
  let busy = false;
  const error = h('span', { class: 'fav-video-error', role: 'alert' });
  const remove = h('button', { type: 'button', class: 'fav-video-remove', 'aria-label': `取消收藏：${video.title}` }, icon(ICONS.close), '取消收藏') as HTMLButtonElement;
  const actions = h('div', { class: 'fav-video-actions' }, remove);
  const lock = (value: boolean) => {
    busy = value;
    actions.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(el => { el.disabled = value; });
  };
  remove.addEventListener('click', async e => {
    e.preventDefault(); e.stopPropagation();
    if (busy || !confirm(`将「${video.title}」从「${folder.title}」中移除？其他收藏夹不受影响。`)) return;
    lock(true); error.textContent = '';
    try {
      await removeFolderVideo(folder.id, video.aid!);
      changed('remove');
    } catch (e) { if (actions.isConnected) error.textContent = `取消失败：${(e as Error).message}`; }
    finally { lock(false); }
  });
  const transfer = async (action: 'move' | 'copy') => {
    if (busy || actions.querySelector('form')) return;
    error.textContent = '';
    const select = h('select', { class: 'fav-video-target', 'aria-label': '目标收藏夹', disabled: true }) as HTMLSelectElement;
    const submit = h('button', { type: 'submit', class: 'btn small', disabled: true }, action === 'move' ? '确认移动' : '确认复制') as HTMLButtonElement;
    let list: Folder[] = [];
    const form = h('form', { class: 'fav-video-transfer', onsubmit: async (e: Event) => {
      e.preventDefault(); e.stopPropagation();
      if (busy || submit.disabled) return;
      const target = list.find(f => f.id === Number(select.value));
      if (!target) return;
      lock(true); error.textContent = '';
      try {
        await transferFolderVideo(action, folder, target, video.aid!);
        changed(action, target);
        form.remove();
        if (action === 'copy') error.textContent = `已复制到「${target.title}」`;
      } catch (e) { if (actions.isConnected) error.textContent = `${action === 'move' ? '移动' : '复制'}失败：${(e as Error).message}`; }
      finally { lock(false); }
    } }, select, submit, h('button', { type: 'button', class: 'btn small', onclick: () => form.remove() }, '取消'));
    form.addEventListener('click', e => e.stopPropagation());
    actions.append(form);
    try {
      list = (await targets()).filter(f => !f.kind && f.mid === folder.mid && f.id !== folder.id);
      if (!form.isConnected) return;
      select.replaceChildren(...list.map(f => h('option', { value: String(f.id) }, f.title)));
      select.disabled = false; submit.disabled = !list.length;
      if (!list.length) error.textContent = '没有其他可用的收藏夹';
      select.focus();
    } catch (e) {
      if (!form.isConnected) return;
      form.remove(); error.textContent = `收藏夹加载失败：${(e as Error).message}`;
    }
  };
  actions.append(...(['move', 'copy'] as const).map(action => h('button', { type: 'button', class: 'fav-video-remove', onclick: (e: Event) => {
    e.preventDefault(); e.stopPropagation(); void transfer(action);
  } }, action === 'move' ? '移动到…' : '复制到…')), error);
  return actions;
}
