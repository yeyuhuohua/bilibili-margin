import { loadSettings, saveSettings, REDESIGN_PAGES, REDESIGN_LABELS, type Settings, type Theme } from '../shared/settings';
import { checkRelease, newerRelease } from '../shared/releases';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

function paint(s: Settings): void {
  $('#enabled').setAttribute('aria-checked', String(s.enabled));
  $('#watch').setAttribute('aria-checked', String(s.watch));
  document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(b => b.setAttribute('aria-checked', String(!s.pageOff.includes(b.dataset.page as typeof REDESIGN_PAGES[number]))));
  document.querySelectorAll<HTMLButtonElement>('#theme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.theme)));
}

(async () => {
  const manifest = chrome.runtime.getManifest();
  $('#ver').textContent = manifest.version_name || manifest.version;
  let s = await loadSettings();
  for (const page of REDESIGN_PAGES) {
    const row = document.createElement('div'); row.className = 'row';
    const label = document.createElement('span'); label.textContent = REDESIGN_LABELS[page];
    const button = document.createElement('button'); button.className = 'sw'; button.dataset.page = page;
    button.setAttribute('role', 'switch'); button.setAttribute('aria-label', `${REDESIGN_LABELS[page]}重设计`);
    button.onclick = async () => {
      button.disabled = true;
      try {
        s = await loadSettings();
        s = await saveSettings({ pageOff: s.pageOff.includes(page) ? s.pageOff.filter(p => p !== page) : [...s.pageOff, page] });
        paint(s);
      } finally { button.disabled = false; }
    };
    row.append(label, button); $('#pages').append(row);
  }
  paint(s);
  let saving = false;
  const changeSwitch = async (key: 'enabled' | 'watch') => {
    if (saving) return;
    saving = true;
    const button = $<HTMLButtonElement>(`#${key}`); button.disabled = true;
    try {
      s = await loadSettings();
      s = await saveSettings({ [key]: !s[key] }); paint(s);
    } catch (error) { console.error('[MARGIN] 保存开关失败', error); }
    finally { saving = false; button.disabled = false; }
  };
  $('#enabled').addEventListener('click', () => { void changeSwitch('enabled'); });
  $('#watch').addEventListener('click', () => { void changeSwitch('watch'); });
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
  let info;
  try { info = await checkRelease(); } catch { return; }
  if (newerRelease(info.tag, mf.version)) {
    const a = document.getElementById('upd') as HTMLAnchorElement;
    if (!/^https:\/\/github\.com\/jiuyang5354\/bilibili-margin\/releases\//.test(info.url)) return;
    a.href = info.url;
    document.getElementById('updv')!.textContent = info.name || 'v' + info.tag;
    a.classList.add('on');
  }
})();
