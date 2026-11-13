import { UPDATE_NOTES, UPDATE_PENDING, UPDATE_SEEN } from '../../shared/updates';
import { h } from './dom';
import { createSheet, type Sheet } from './sheet';
import { introActive, onIntroEnd } from './intro/gate';
import { toast } from './controls';

/** Local release notes only: no remote check, new tab or startup network request. */
export function mountUpdateNotice(app: HTMLElement): void {
  const manifest = chrome.runtime.getManifest();
  let notice: Sheet | null = null, checking = false;
  const stop = () => {
    app.removeEventListener('margin:sheet', check);
    document.removeEventListener('visibilitychange', check);
    chrome.storage.onChanged.removeListener(changed);
  };
  const acknowledge = async () => {
    stop();
    try {
      await chrome.storage.local.set({ [UPDATE_SEEN]: manifest.version });
      await chrome.storage.local.remove(UPDATE_PENDING);
    } catch { toast(app, '更新提示确认未保存，下次打开可能再次显示'); }
  };
  const show = async () => {
    if (checking || notice || !app.isConnected || document.hidden || introActive() || app.querySelector('.sheet-layer[data-open="true"]')) return;
    checking = true;
    try {
      const state = await chrome.storage.local.get([UPDATE_PENDING, UPDATE_SEEN]);
      if (state[UPDATE_PENDING] !== manifest.version || state[UPDATE_SEEN] === manifest.version) return;
      if (document.hidden || introActive() || !app.isConnected || app.querySelector('.sheet-layer[data-open="true"]')) return;
      notice = createSheet({ title: '映间已更新', eyebrow: 'What’s new', width: 520, onClose: () => { void acknowledge(); } });
      notice.el.classList.add('update-layer');
      const done = h('button', { type: 'button', class: 'btn', onclick: () => notice?.close() }, '知道了');
      notice.body.append(h('p', { class: 'update-version' }, manifest.version_name || manifest.version),
        h('ul', { class: 'update-notes' }, ...UPDATE_NOTES.map(text => h('li', {}, text))),
        h('div', { class: 'update-actions' }, done));
      app.append(notice.el); notice.open();
    } catch { /* A storage failure must not prevent the page from starting. */ }
    finally { checking = false; }
  };
  const check = () => { void show(); };
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local') return;
    if (changes[UPDATE_SEEN]?.newValue === manifest.version) { notice?.close(); stop(); }
    else if (changes[UPDATE_PENDING]) check();
  };
  app.addEventListener('margin:sheet', check);
  document.addEventListener('visibilitychange', check);
  chrome.storage.onChanged.addListener(changed);
  // The home host is attached immediately after its constructor returns.
  onIntroEnd(() => queueMicrotask(check));
}
