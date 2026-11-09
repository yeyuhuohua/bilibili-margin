import { loadSettings, saveSettings, type Settings, type Theme } from '../shared/settings';
import { optionalFetch } from '../shared/privacy';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

function paint(s: Settings): void {
  $('#enabled').setAttribute('aria-checked', String(s.enabled));
  $('#watch').setAttribute('aria-checked', String(s.watch));
  document.querySelectorAll<HTMLButtonElement>('#theme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.theme)));
}

(async () => {
  const manifest = chrome.runtime.getManifest();
  $('#ver').textContent = manifest.version_name || manifest.version;
  let s = await loadSettings();
  paint(s);
  $('#enabled').addEventListener('click', async () => { s = await saveSettings({ enabled: !s.enabled }); paint(s); });
  $('#watch').addEventListener('click', async () => { s = await saveSettings({ watch: !s.watch }); paint(s); });
  $('#theme').addEventListener('click', async (e) => {
    const v = (e.target as HTMLElement).closest('button')?.dataset.v as Theme | undefined;
    if (!v) return;
    s = await saveSettings({ theme: v });
    paint(s);
  });
})();

// 手动安装（zip 解压）不会自动更新：没有 update_url 时，向 GitHub Releases 查询最新版本并提示。
// 从 Edge 加载项商店安装的版本带 update_url，由浏览器自动更新，不显示提示。
void (async () => {
  const mf = chrome.runtime.getManifest() as chrome.runtime.Manifest & { update_url?: string };
  if (mf.update_url || !(await loadSettings()).privacyExternal) return;
  const KEY = 'margin:update-check';
  const cmp = (a: string, b: string) => {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
  };
  let info = (await chrome.storage.local.get(KEY))[KEY] as { at: number; tag: string; name?: string; url: string } | undefined;
  if (!info || Date.now() - info.at > 6 * 3600e3) {
    try {
      const r = await optionalFetch('update', 'https://api.github.com/repos/jiuyang5354/bilibili-margin/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      if (r.ok) {
        const j = await r.json();
        info = { at: Date.now(), tag: String(j.tag_name || '').replace(/^v/, ''), name: j.name, url: j.html_url };
        await chrome.storage.local.set({ [KEY]: info });
      }
    } catch { /* 离线时静默 */ }
  }
  if (info?.tag && cmp(info.tag, mf.version) > 0) {
    const a = document.getElementById('upd') as HTMLAnchorElement;
    if (!/^https:\/\/github\.com\/jiuyang5354\/bilibili-margin\/releases\//.test(info.url)) return;
    a.href = info.url;
    document.getElementById('updv')!.textContent = info.name || 'v' + info.tag;
    a.classList.add('on');
  }
})();
