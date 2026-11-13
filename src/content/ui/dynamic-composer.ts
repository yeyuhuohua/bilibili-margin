import { publishDynamic, requireDynamicLogin, uploadDynamicImage, validateDynamicImage, type DynamicPicture } from '../api/dynamic-publish';
import { h, icon, ICONS } from './dom';
import { createSheet, type Sheet } from './sheet';
import { decorateSendButton } from './send-button';
import { toast } from './controls';

export function createDynamicComposer(app: HTMLElement, onPublished: (id: string) => void): Sheet {
  const sheet = createSheet({ title: '发动态', eyebrow: 'New post', width: 600 });
  sheet.el.classList.add('dynamic-composer');
  const text = h('textarea', { class: 'dc-text', rows: '6', maxlength: '2000', placeholder: '有什么想分享的？', 'aria-label': '动态内容' });
  const pictures = h('div', { class: 'dc-pictures' });
  const status = h('p', { class: 'dc-status', role: 'status' });
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif', multiple: '', hidden: '', 'aria-label': '添加动态图片' });
  const add = h('button', { type: 'button', class: 'ghost', onclick: () => file.click() }, icon(ICONS.image), '图片');
  const count = h('span', { class: 'dc-count' }, '0/2000');
  const send = h('button', { type: 'button', class: 'dc-send', disabled: '' }, '发布');
  sheet.body.append(text, pictures, status, h('div', { class: 'dc-tools' }, add, count, send), file);
  app.append(sheet.el); decorateSendButton(send);
  type Image = { file: File; preview: string; uploaded?: DynamicPicture };
  const images: Image[] = [];
  let busy = false;
  const sync = () => {
    count.textContent = `${text.value.length}/2000${images.length ? ` · ${images.length}/9 张` : ''}`;
    send.disabled = busy || (!text.value.trim() && !images.length);
    add.disabled = busy || images.length >= 9; text.readOnly = busy;
    sheet.el.querySelector<HTMLButtonElement>('.sheet-x')!.disabled = busy;
    sheet.el.querySelector<HTMLElement>('.scrim')!.style.pointerEvents = busy ? 'none' : '';
    sheet.el.querySelectorAll<HTMLButtonElement>('.dc-remove').forEach(button => { button.disabled = busy; });
  };
  const render = () => {
    pictures.replaceChildren(...images.map((item, index) => h('div', { class: 'dc-picture' },
      h('img', { src: item.preview, alt: `待发布图片 ${index + 1}`, decoding: 'async' }),
      h('button', { type: 'button', class: 'dc-remove', 'aria-label': `移除图片 ${index + 1}`, onclick: () => {
        if (busy) return; const at = images.indexOf(item); if (at < 0) return;
        images.splice(at, 1); URL.revokeObjectURL(item.preview); render(); add.focus();
      } }, icon(ICONS.close)))));
    sync();
  };
  const addFiles = (files: File[]) => {
    if (busy) return;
    if (images.length + files.length > 9) { status.textContent = '最多添加 9 张图片'; return; }
    try { files.forEach(validateDynamicImage); } catch (error) { status.textContent = (error as Error).message; return; }
    for (const selected of files) images.push({ file: selected, preview: URL.createObjectURL(selected) });
    status.textContent = ''; render();
  };
  file.addEventListener('change', () => { addFiles([...file.files ?? []]); file.value = ''; });
  text.addEventListener('input', sync);
  text.addEventListener('paste', event => {
    const pasted = [...event.clipboardData?.files ?? []];
    if (pasted.length) { event.preventDefault(); addFiles(pasted); }
  });
  text.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); send.click(); }
  });
  sheet.el.addEventListener('keydown', event => { if (busy && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); } });
  send.addEventListener('click', async () => {
    if (busy || send.disabled) return;
    busy = true; sync(); status.textContent = '正在确认登录状态…';
    try {
      await requireDynamicLogin();
      for (let i = 0; i < images.length; i++) {
        status.textContent = `正在上传图片 ${i + 1}/${images.length}…`;
        images[i].uploaded ??= await uploadDynamicImage(images[i].file);
      }
      status.textContent = '正在发布…';
      const id = await publishDynamic(text.value, images.map(item => item.uploaded!));
      text.value = ''; images.forEach(item => URL.revokeObjectURL(item.preview)); images.length = 0; render();
      status.textContent = ''; busy = false; sync(); sheet.close(); toast(app, '动态已发布'); onPublished(id);
    } catch (error) { status.textContent = (error as Error).message || '发布失败，草稿已保留'; }
    finally { busy = false; sync(); }
  });
  const open = sheet.open;
  sheet.open = () => { open(); requestAnimationFrame(() => { if (sheet.isOpen()) text.focus({ preventScroll: true }); }); };
  addEventListener('pagehide', () => images.forEach(item => URL.revokeObjectURL(item.preview)), { once: true });
  return sheet;
}
