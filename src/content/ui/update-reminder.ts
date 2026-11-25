import { readReminder, type UpdateReminder } from '../../shared/update-reminder';
import { toast } from './controls';

/**
 * 发现新版本时在页面里提醒一次（v0.61）。
 *
 * 提醒只带一个入口：官方发布页。安装仍然照旧——下载压缩包、覆盖扩展文件夹、
 * 重新加载扩展，由用户自己完成，扩展不碰那个目录。
 */
export function mountUpdateReminder(app: HTMLElement): void {
  let showing = false;
  let waiting = 0;
  const show = async () => {
    if (showing) return;
    // 映间界面挂到页面上之前先等等：提示要落在已经显示的界面上
    if (!app.isConnected) {
      if (waiting < 40) { waiting++; setTimeout(() => { void show(); }, 250); }
      return;
    }
    showing = true;
    try {
      const saved = await readReminder();
      if (!saved || saved.seen) return;
      const state: UpdateReminder | null = await chrome.runtime.sendMessage({ margin: 'claim-update-reminder' });
      if (!state?.tag) return;
      toast(app, `映间有新版本 v${state.tag}`, { label: '查看发布页', run: () => { void chrome.runtime.sendMessage({ margin: 'open-release-page', url: state.url }); } });
      // 看过一次就不再重复弹；扩展图标上的角标会一直留着，直到装上新版

    } catch { /* 读不到状态就不提醒，不影响页面。 */ }
    finally { showing = false; }
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes['margin:update-reminder']) return;
    void show();
  });
  void show();
}
