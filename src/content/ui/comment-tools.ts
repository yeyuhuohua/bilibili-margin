import { searchFollowing } from '../api/dyn';
import { nav } from '../api/http';
import { messageEmotes, type EmotePack } from '../api/msg';
import { uploadDynamicImage, validateDynamicImage, type DynamicPicture } from '../api/dynamic-publish';
import { h } from './dom';

export function commentTools(input: HTMLTextAreaElement, say: (text: string) => void) {
  const panel = h('div', { class: 'dy-picker', hidden: true });
  const attachments = h('div', { class: 'dy-attachments' });
  const mentions = new Map<string, number>();
  const images: { file: File; uploaded?: DynamicPicture }[] = [];
  let packs: EmotePack[] | undefined;
  let generation = 0;
  const close = () => { generation++; panel.hidden = true; panel.replaceChildren(); };
  const insert = (text: string) => {
    if (input.value.length - (input.selectionEnd - input.selectionStart) + text.length > input.maxLength) {
      say('已达到评论字数限制'); return false;
    }
    input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true })); close(); input.focus({ preventScroll: true });
    return true;
  };
  const button = (label: string, click: () => void) => h('button', { type: 'button', class: 'ghost small', onclick: click }, label);
  const toggle = (kind: string) => {
    const was = !panel.hidden && panel.dataset.kind === kind;
    close();
    if (was) return false;
    panel.dataset.kind = kind; panel.hidden = false; return true;
  };
  const emoji = button('表情', async () => {
    if (!toggle('emoji')) return;
    const gen = generation;
    panel.textContent = '加载中…';
    try {
      packs ??= await messageEmotes();
      if (gen !== generation) return;
      if (!packs.length) { panel.textContent = '暂无可用表情'; return; }
      const select = h('select', { 'aria-label': '表情包' }, ...packs.map((pack, i) => h('option', { value: String(i) }, pack.name))) as HTMLSelectElement;
      const choices = h('div', { class: 'dy-emoji-choices' });
      const paint = () => choices.replaceChildren(...packs![select.selectedIndex].emotes.map(e => h('button', {
        type: 'button', title: e.text, 'aria-label': e.text, onclick: () => insert(e.text),
      }, e.url ? h('img', { src: e.url, alt: e.text, loading: 'lazy', referrerpolicy: 'no-referrer' }) : e.text)));
      panel.replaceChildren(select, choices); select.onchange = paint; paint();
    } catch { if (gen === generation) panel.textContent = '表情加载失败，请重试'; }
  });
  const at = button('@ 提及', () => {
    if (!toggle('mention')) return;
    const search = h('input', { type: 'search', placeholder: '搜索已关注的 UP 主', 'aria-label': '搜索已关注的 UP 主' }) as HTMLInputElement;
    const results = h('div', { role: 'group' }); panel.replaceChildren(search, results);
    let timer = 0;
    search.oninput = () => {
      clearTimeout(timer); const gen = ++generation, query = search.value.trim();
      results.replaceChildren();
      if (!query) return;
      timer = window.setTimeout(async () => {
        if (gen !== generation) return;
        try {
          const user = await nav();
          if (gen !== generation) return;
          if (!user.isLogin || !user.mid) { results.textContent = '请先登录'; return; }
          const people = await searchFollowing(user.mid, query);
          if (gen !== generation) return;
          results.replaceChildren(...people.map(person => button(person.name, () => {
            if (insert('@' + person.name + ' ')) mentions.set(person.name, person.mid);
          })));
          if (!people.length) results.textContent = '没有匹配的关注用户';
        } catch { if (gen === generation) results.textContent = '查询失败，请重试'; }
      }, 250);
    };
    search.focus({ preventScroll: true });
  });
  const paintFiles = () => attachments.replaceChildren(...images.map(item => button('移除 ' + item.file.name, () => {
    images.splice(images.indexOf(item), 1); paintFiles();
  })));
  input.addEventListener('paste', e => {
    const files = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    if (el.disabled) return;
    try {
      if (images.length + files.length > 9) throw new Error('最多 9 张图片');
      for (const file of files) validateDynamicImage(file);
      images.push(...files.map(file => ({ file }))); paintFiles();
    } catch (err) { say((err as Error).message); }
  });
  const el = h('fieldset', { class: 'dy-comment-tools', 'aria-label': '评论工具' }, emoji, at, panel, attachments) as HTMLFieldSetElement;
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); input.focus({ preventScroll: true }); } });
  return { el, hasPictures: () => images.length > 0, async fields(message: string) {
    const mapped = Object.fromEntries([...mentions].filter(([name]) => (message + ' ').includes('@' + name + ' ')));
    for (const image of images) image.uploaded ??= await uploadDynamicImage(image.file, 'new_dyn');
    return { mentions: mapped, pictures: images.map(image => image.uploaded!) };
  }, clear() { mentions.clear(); images.length = 0; paintFiles(); close(); } };
}
