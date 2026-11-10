import { messageEmotes, sendImage, sendText, uploadMessageImage, validateMessageImage, type EmotePack, type MessageImage } from '../api/msg';
import { h, icon, ICONS } from './dom';
import { uiReducedMotion as reducedMotion } from '../motion';
import { createMessageEditor } from './message-editor';

/** 21st Emoji Picker / File Attachment 的轻量原生适配；数据与发送使用 B 站接口。 */
export function createMessageComposer(o: { me: number; to: number; name: string; csrf: () => string; say: (s: string) => void; onSent: () => Promise<void> }) {
  const editor = createMessageEditor(`发消息给 ${o.name}`, o.say);
  const input = editor.el;
  const send = h('button', { class: 'wh-send', type: 'button', disabled: '' }, '发送') as HTMLButtonElement;
  const photo = h('button', { class: 'wh-tool', type: 'button', 'aria-label': '添加图片', title: '添加图片' }, icon(ICONS.image)) as HTMLButtonElement;
  const emoji = h('button', { class: 'wh-tool', type: 'button', 'aria-label': '选择表情', title: '选择表情', 'aria-expanded': 'false' }, icon(ICONS.smile)) as HTMLButtonElement;
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp', multiple: true, hidden: '' }) as HTMLInputElement;
  const count = h('span', { class: 'wh-count', 'aria-live': 'off' }, '0/500');
  const attachment = h('div', { class: 'wh-attachment', hidden: '' });
  const hint = h('small', { class: 'wh-media-hint', hidden: '' }, '图片和文字将分别发送');
  const panel = h('section', { class: 'wh-emoji-panel', role: 'dialog', 'aria-label': 'B站表情', hidden: '' });
  const el = h('div', { class: 'wh-compose' }, panel, attachment,
    h('div', { class: 'wh-compose-row' }, input, send),
    h('div', { class: 'wh-compose-tools' }, photo, emoji, fileInput, hint, count));
  let active = true, busy = false;
  const images: { file: File; url: string; uploaded: MessageImage | null; el: HTMLElement }[] = [];
  let start = 0, end = 0, packs: EmotePack[] | null = null, loading = false;
  let panelAnimation: Animation | null = null, attachmentAnimation: Animation | null = null;
  const selectedEmotes = new Set<string>();
  const controller = new AbortController();
  const resizeInput = () => {
    if (!input.isConnected) return;
    const max = parseFloat(getComputedStyle(input).maxHeight);
    input.style.height = '0px';
    input.style.height = `${Math.min(input.scrollHeight + 2, max)}px`;
  };
  let inputWidth = 0;
  const inputObserver = new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width !== inputWidth) { inputWidth = width; resizeInput(); }
  });
  inputObserver.observe(input);
  const sync = () => {
    count.textContent = `${editor.value().length}/500`;
    send.disabled = busy || editor.value().length > 500 || (!images.length && !editor.value().trim());
    editor.disabled(busy); photo.disabled = emoji.disabled = busy;
    attachment.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = busy; });
    attachment.hidden = !images.length;
    hint.hidden = !(images.length && editor.value().trim());
    send.textContent = busy ? '发送中…' : '发送';
    resizeInput();
  };
  const closePicker = (focus = false) => {
    panelAnimation?.cancel(); panelAnimation = null;
    panel.hidden = true; emoji.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (focus) emoji.focus({ preventScroll: true });
  };
  const outside = (e: Event) => { if (!e.composedPath().includes(panel) && !e.composedPath().includes(emoji)) closePicker(); };
  const clearImages = () => {
    attachmentAnimation?.cancel(); attachmentAnimation = null;
    images.forEach(image => URL.revokeObjectURL(image.url));
    images.length = 0; attachment.replaceChildren(); fileInput.value = ''; sync();
  };
  const removeImage = (image: typeof images[number]) => {
    images.splice(images.indexOf(image), 1);
    URL.revokeObjectURL(image.url); image.el.remove(); sync();
  };
  const selectFiles = (files: File[]) => {
    if (busy || !active) return;
    for (const file of files) {
      try { validateMessageImage(file); } catch (e) { o.say((e as Error).message); continue; }
      const url = URL.createObjectURL(file);
      const remove = h('button', { class: 'wh-attachment-remove', type: 'button', 'aria-label': '移除图片', title: `移除 ${file.name || '粘贴的图片'}` }, icon(ICONS.close));
      const item = h('div', { class: 'wh-attachment-item' }, h('img', { alt: '待发送图片' }), h('span', { class: 'wh-filename' }, file.name || '粘贴的图片'), remove);
      // Blob URL 由本组件创建，图片节点通过属性赋值接入。
      (item.firstElementChild as HTMLImageElement).src = url;
      const image = { file, url, uploaded: null as MessageImage | null, el: item };
      images.push(image); attachment.append(item);
      remove.onclick = () => { if (!busy) { removeImage(image); input.focus(); } };
    }
    fileInput.value = ''; sync(); input.focus();
    attachmentAnimation?.cancel();
    if (!reducedMotion()) attachmentAnimation = attachment.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
  };
  photo.onclick = () => fileInput.click();
  fileInput.onchange = () => selectFiles(Array.from(fileInput.files ?? []));
  input.addEventListener('paste', (e) => { const files = Array.from(e.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/')); if (files.length) { e.preventDefault(); selectFiles(files); } });
  el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  el.addEventListener('drop', (e) => { if (e.dataTransfer?.files.length) { e.preventDefault(); selectFiles(Array.from(e.dataTransfer.files)); } });
  const remember = () => { ({ start, end } = editor.offsets()); };
  for (const event of ['select', 'keyup', 'click', 'blur']) input.addEventListener(event, remember);
  input.addEventListener('input', () => { remember(); sync(); });

  const paintPicker = () => {
    const search = h('input', { class: 'wh-emoji-search', type: 'search', placeholder: '搜索表情', 'aria-label': '搜索表情' }) as HTMLInputElement;
    const tabs = h('div', { class: 'wh-emoji-tabs', role: 'tablist', 'aria-label': '表情包' });
    const grid = h('div', { class: 'wh-emoji-grid', role: 'group', 'aria-label': '表情列表' });
    let pack = 0;
    const paint = () => {
      const query = search.value.trim().toLowerCase();
      const items = query ? packs!.flatMap(p => p.emotes).filter(e => e.text.toLowerCase().includes(query)) : packs![pack]?.emotes ?? [];
      const seen = new Set<string>();
      grid.replaceChildren(...items.filter(e => !seen.has(e.text) && !!seen.add(e.text)).map(e => {
        const b = h('button', { class: `wh-emote${e.size === 2 ? ' big' : ''}`, type: 'button', 'aria-label': e.text, title: e.text },
          e.url ? h('img', { src: e.url, alt: e.text, loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'wh-emote-text' }, e.text));
        b.onclick = () => {
          if (editor.value().length - (end - start) + e.text.length > 500) { o.say('消息不能超过 500 字'); return; }
          editor.insert(e.text, e); selectedEmotes.add(e.text); remember(); sync(); closePicker(); input.focus();
        };
        return b;
      }));
      if (!items.length) grid.append(h('p', { class: 'wh-emoji-empty' }, '没有找到表情'));
      tabs.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(i === pack && !query)));
    };
    packs!.forEach((p, i) => { const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(!i), onclick: () => { pack = i; search.value = ''; paint(); } }, p.name); tabs.append(b); });
    search.oninput = paint;
    grid.addEventListener('keydown', (e) => {
      const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
      const buttons = [...grid.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(e.target as HTMLButtonElement);
      if (index < 0 || !(e.key in keys || e.key === 'Home' || e.key === 'End')) return;
      e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + keys[e.key]));
      buttons[next]?.focus();
    });
    panel.replaceChildren(search, tabs, grid); paint(); search.focus();
  };
  const loadPicker = async () => {
    if (loading) return;
    if (packs) { paintPicker(); return; }
    loading = true; panel.replaceChildren(h('p', { class: 'wh-emoji-empty', role: 'status' }, '正在加载表情…'));
    try {
      packs = await messageEmotes();
      if (!active || panel.hidden) return;
      if (!packs.length) throw new Error('暂时没有可用表情');
      paintPicker();
    } catch (e) {
      packs = null;
      if (active && !panel.hidden) panel.replaceChildren(h('p', { class: 'wh-emoji-empty' }, (e as Error).message), h('button', { class: 'ghost small', type: 'button', onclick: () => loadPicker() }, '重试'));
    } finally { loading = false; }
  };
  emoji.onclick = () => {
    if (!panel.hidden) { closePicker(); return; }
    remember(); panel.hidden = false; emoji.setAttribute('aria-expanded', 'true'); document.addEventListener('pointerdown', outside, true); void loadPicker();
    panelAnimation?.cancel();
    if (!reducedMotion()) panelAnimation = panel.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 150, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  };
  panel.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closePicker(true); } });
  const go = async () => {
    const text = editor.value().trim();
    if (busy || !active || (!text && !images.length)) return;
    if (editor.value().length > 500) { o.say('消息不能超过 500 字'); return; }
    busy = true; closePicker(); sync(); let sent = false;
    try {
      while (images.length && active) {
        const image = images[0];
        image.uploaded ??= await uploadMessageImage(image.file, o.csrf(), controller.signal);
        if (!active) return;
        if (!await sendImage(o.me, o.to, image.uploaded, o.csrf())) throw new Error('图片发送失败，请重试');
        if (!active) return;
        removeImage(image); sent = true;
      }
      if (text && active) {
        if (!await sendText(o.me, o.to, text, o.csrf(), editor.hasEmotes() || [...selectedEmotes].some(e => text.includes(e)))) throw new Error('文字发送失败，请重试');
        editor.clear(); selectedEmotes.clear(); start = end = 0; sent = true;
      }
    } catch (e) { if (active) o.say((e as Error).message || '发送失败，请重试'); }
    finally {
      busy = false;
      if (active) {
        sync(); input.focus();
        if (sent) await o.onSent().catch(() => o.say('已发送，消息列表暂时刷新失败'));
      }
    }
  };
  send.onclick = () => { void go(); };
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void go(); } });
  return { el, focus: () => input.focus(), dispose() { active = false; inputObserver.disconnect(); controller.abort(); closePicker(); clearImages(); } };
}
