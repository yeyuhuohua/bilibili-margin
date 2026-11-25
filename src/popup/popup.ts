import { loadSettings, saveSettings, REDESIGN_PAGES, REDESIGN_LABELS, type Settings, type Theme } from '../shared/settings';
import { checkRelease, checkViaReleasePage, RELEASE_PERMISSION, newerRelease } from '../shared/releases';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;

function paint(s: Settings): void {
  $('#enabled').setAttribute('aria-checked', String(s.enabled));
  $('#watch').setAttribute('aria-checked', String(s.watch));
  document.querySelectorAll<HTMLButtonElement>('[data-page]').forEach(b => b.setAttribute('aria-checked', String(!s.pageOff.includes(b.dataset.page as typeof REDESIGN_PAGES[number]))));
  document.querySelectorAll<HTMLButtonElement>('#theme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === s.theme)));
}

(async () => {
  if (location.hash === '#release-check') {
    const title = document.createElement('h1'), status = document.createElement('p'), button = document.createElement('button');
    const manual = document.createElement('a');
    title.textContent = '检查映间更新';
    manual.href = 'https://github.com/jiuyang5354/bilibili-margin/releases/latest';
    manual.textContent = '直接查看官方发布页';
    status.setAttribute('role', 'status');
    status.textContent = 'GitHub 更新接口已限流。可授权映间读取官方发布页的版本号。';
    button.textContent = '授权并检查';
    button.disabled = true;
    document.body.replaceChildren(title, status, button, document.createElement('hr'), manual);
    const settings = await loadSettings();
    if (!settings.enabled || !settings.privacyExternal) {
      status.textContent = '可选外部服务已关闭。';
      button.hidden = true;
      return;
    }
    if (await chrome.permissions.contains(RELEASE_PERMISSION)) button.textContent = '查询官方发布页';
    button.disabled = false;
    button.onclick = async () => {
      button.disabled = true;
      try {
        if (!await chrome.permissions.request(RELEASE_PERMISSION)) {
          status.textContent = '未授权，可直接查看官方发布页。';
          return;
        }
        const release = await checkViaReleasePage();
        manual.href = release.url;
        status.textContent = newerRelease(release.tag, chrome.runtime.getManifest().version)
          ? '有新版本，可前往官方发布页下载。' : '当前已安装此版本或更新版本。';
      } catch (error) { status.textContent = (error as Error).message || '检查失败，请重试。'; }
      finally { button.disabled = false; }
    };
    return;
  }
  const manifest = chrome.runtime.getManifest();
  $('#ver').textContent = manifest.version_name || manifest.version;
  let s = await loadSettings();
  const hours = s.updateInterval;
  (document.getElementById('cycle') as HTMLElement).textContent = hours
    ? `更新提醒：${hours === 24 ? '每天' : hours === 168 ? '每周' : hours < 24 ? `每 ${hours} 小时` : `每 ${hours / 24} 天`}`
    : '更新提醒已关闭，可在设置里开启';
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
  if (location.hash === '#release-check' || mf.update_url || !(await loadSettings()).privacyExternal) return;
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
