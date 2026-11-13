import { h } from './dom';
import type { MessageEmote } from '../api/msg';

/** 发送协议仍使用 [表情] 文本；编辑区只把本地选中的标记显示为图片。 */
export function messageDraftText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\u00a0/g, ' ');
  if (node instanceof HTMLImageElement) return node.dataset.messageEmote || '';
  if (node instanceof HTMLBRElement) return node.hasAttribute('data-message-break') || node.nextSibling ? '\n' : '';
  let text = '';
  [...node.childNodes].forEach((child, i) => {
    if (i && child instanceof HTMLElement && /^(DIV|P)$/.test(child.tagName)) text += '\n';
    text += messageDraftText(child);
  });
  return text;
}

export function createMessageEditor(placeholder: string, say: (text: string) => void) {
  const el = h('div', { class: 'wh-input', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
    'aria-label': placeholder, 'data-placeholder': placeholder, spellcheck: 'false' });
  const known = new Map<string, MessageEmote>();
  let saved: Range | null = null, composing = false;
  const selection = () => (el.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.() || document.getSelection();
  const remember = () => {
    const current = selection();
    if (current?.rangeCount) {
      const root = el.getRootNode();
      const composed = current as Selection & { getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => StaticRange[] };
      // Newer Firefox may retarget getRangeAt() to the shadow host; request the editable range explicitly.
      const range = root instanceof ShadowRoot ? composed.getComposedRanges?.({ shadowRoots: [root] })[0] ?? current.getRangeAt(0) : current.getRangeAt(0);
      if (el.contains(range.startContainer) && el.contains(range.endContainer)) {
        saved = document.createRange(); saved.setStart(range.startContainer, range.startOffset); saved.setEnd(range.endContainer, range.endOffset);
      }
    }
  };
  const value = () => messageDraftText(el);
  const offsets = () => {
    remember();
    if (!saved || !el.contains(saved.startContainer) || !el.contains(saved.endContainer)) return { start: value().length, end: value().length };
    const prefix = document.createRange(); prefix.selectNodeContents(el); prefix.setEnd(saved.startContainer, saved.startOffset);
    const start = messageDraftText(prefix.cloneContents()).length;
    return { start, end: start + messageDraftText(saved.cloneContents()).length };
  };
  const fragment = (text: string, emote?: MessageEmote, trailing = true) => {
    if (emote) known.set(emote.text, emote);
    const result = document.createElement('div');
    for (const part of text.split(/(\[[^\]\n]{1,100}\]|\n)/)) {
      if (!part) continue;
      const image = known.get(part);
      if (image?.url) result.append(h('img', { class: 'wh-draft-emote', src: image.url, alt: part, 'data-message-emote': part, contenteditable: 'false', draggable: 'false' }));
      else if (part === '\n') result.append(h('br', { 'data-message-break': '' }));
      else result.append(document.createTextNode(part));
    }
    if (trailing && result.lastChild instanceof HTMLBRElement) result.append(h('br', {}));
    return result;
  };
  const placeEnd = () => {
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
    const current = selection(); current?.removeAllRanges(); current?.addRange(range); saved = range.cloneRange();
  };
  const state = () => ({ text: value(), ...offsets() });
  const history = [{ text: '', start: 0, end: 0 }];
  let historyIndex = 0, restoring = false;
  const beforeEdit = () => { history[historyIndex] = state(); };
  const record = () => {
    const next = state();
    if (next.text === history[historyIndex].text) return;
    history.splice(historyIndex + 1); history.push(next);
    if (history.length > 50) history.shift(); else historyIndex++;
  };
  const restore = (index: number) => {
    if (index < 0 || index >= history.length) return;
    historyIndex = index; const next = history[index];
    el.replaceChildren(...fragment(next.text).childNodes); el.focus();
    const point = (offset: number): [Node, number] => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node.nodeType === Node.TEXT_NODE || node instanceof HTMLImageElement || node instanceof HTMLBRElement)) continue;
        const length = messageDraftText(node).length;
        if (offset <= length) return node.nodeType === Node.TEXT_NODE ? [node, offset] : [node.parentNode!, [...node.parentNode!.childNodes].indexOf(node as ChildNode) + Number(offset > 0)];
        offset -= length;
      }
      return [el, el.childNodes.length];
    };
    const range = document.createRange(); range.setStart(...point(next.start)); range.setEnd(...point(next.end));
    const current = selection(); current?.removeAllRanges(); current?.addRange(range); saved = range.cloneRange();
    restoring = true; el.dispatchEvent(new Event('input', { bubbles: true })); restoring = false;
  };
  const insert = (text: string, emote?: MessageEmote) => {
    const range = offsets(), available = 500 - value().length + range.end - range.start;
    if (text.length > available) { say('消息不能超过 500 字'); if (emote) return; text = text.slice(0, Math.max(0, available)); }
    if (!text && range.start === range.end) return;
    beforeEdit(); el.focus();
    if (!saved || !el.contains(saved.startContainer) || !el.contains(saved.endContainer)) placeEnd();
    const content = fragment(text, emote, range.end === value().length);
    const current = saved!.cloneRange(); current.deleteContents();
    const last = content.lastChild instanceof HTMLBRElement && !content.lastChild.hasAttribute('data-message-break') ? content.lastChild.previousSibling : content.lastChild;
    const nodes = document.createDocumentFragment(); nodes.append(...content.childNodes); current.insertNode(nodes);
    if (last) current.setStartAfter(last); current.collapse(true);
    const selected = selection(); selected?.removeAllRanges(); selected?.addRange(current); saved = current.cloneRange();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const clear = () => { el.replaceChildren(); saved = null; history.splice(0, history.length, { text: '', start: 0, end: 0 }); historyIndex = 0; };
  el.addEventListener('beforeinput', event => {
    const e = event as InputEvent;
    if (e.isComposing || composing) return;
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); restore(historyIndex + (e.inputType === 'historyUndo' ? -1 : 1)); return; }
    beforeEdit();
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); insert('\n'); return; }
    if (e.inputType === 'insertText' && e.data) {
      const range = offsets();
      if (value().length - range.end + range.start + e.data.length > 500) { e.preventDefault(); say('消息不能超过 500 字'); }
    }
  });
  el.addEventListener('input', () => {
    if (!composing && value().length > 500) {
      const text = value().slice(0, 500); el.replaceChildren(...fragment(text).childNodes); placeEnd(); say('消息不能超过 500 字');
    }
    if (!value() && !el.querySelector('img')) { el.replaceChildren(); saved = null; }
    remember();
    if (!restoring && !composing) record();
  });
  el.addEventListener('compositionstart', () => { beforeEdit(); composing = true; });
  el.addEventListener('compositionend', () => { composing = false; el.dispatchEvent(new Event('input', { bubbles: true })); });
  el.addEventListener('paste', e => {
    if ([...(e.clipboardData?.files || [])].some(file => file.type.startsWith('image/'))) return;
    e.preventDefault(); const text = e.clipboardData?.getData('text/plain'); if (text) insert(text);
  });
  el.addEventListener('drop', e => {
    if (e.dataTransfer?.files.length) return;
    e.preventDefault(); insert(e.dataTransfer?.getData('text/plain') || '');
  });
  for (const type of ['copy', 'cut'] as const) el.addEventListener(type, e => {
    remember(); if (!saved || saved.collapsed || !e.clipboardData) return;
    e.preventDefault(); e.clipboardData.setData('text/plain', messageDraftText(saved.cloneContents()));
    if (type === 'cut') insert('');
  });
  el.addEventListener('keydown', e => {
    if (e.isComposing || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'z' || key === 'y') { e.preventDefault(); restore(historyIndex + (key === 'y' || e.shiftKey ? 1 : -1)); }
  });
  for (const type of ['keyup', 'click', 'blur', 'select']) el.addEventListener(type, remember);
  return { el, value, offsets, insert, clear, remember,
    hasEmotes: () => !!el.querySelector('[data-message-emote]'),
    disabled(on: boolean) { el.contentEditable = String(!on); el.setAttribute('aria-disabled', String(on)); },
  };
}
