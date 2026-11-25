/**
 * 定时检查更新并提醒（v0.61）。
 *
 * 只做提醒：查到新版本就记下来、在扩展图标上标「新」，安装仍然走官方发布页手动下载。
 * 这一版不下载发布包、不解包、不写扩展目录，也不重载扩展。
 *
 * 默认关闭（设置里的更新周期为 0），且只面向解压安装：商店安装的版本带 update_url，
 * 由浏览器自己更新，这里直接不查。
 */
import { checkRelease, newerRelease } from '../shared/releases';
import { loadSettings } from '../shared/settings';
import { clearReminder, isReleaseUrl, readReminder, writeReminder } from '../shared/update-reminder';

const ALARM = 'margin:update-check';
/** 定时任务名字，后台与设置面板都要用到 */
export const UPDATE_ALARM = ALARM;

/** Chrome 117 之前的 alarms 是回调风格，这里统一成 Promise */
interface AlarmApi {
  get(name: string, cb: (alarm: chrome.alarms.Alarm | undefined) => void): void;
  create(name: string, info: chrome.alarms.AlarmCreateInfo): void;
  clear(name: string, cb: (done: boolean) => void): void;
}
/** 延到调用时再取 chrome.alarms：模块顶层不碰浏览器 API，方便在测试里替换 */
const alarmApi = () => chrome.alarms as unknown as AlarmApi;
const getAlarm = (name: string) => new Promise<chrome.alarms.Alarm | undefined>(resolve => alarmApi().get(name, resolve));
const clearAlarm = (name: string) => new Promise<boolean>(resolve => alarmApi().clear(name, resolve));

async function enabledInterval(): Promise<number> {
  const settings = await loadSettings();
  if (!settings.enabled || !settings.privacyExternal || !settings.updateInterval || chrome.runtime.getManifest().update_url) return 0;
  try {
    const self = await chrome.management.getSelf();
    return self.installType === 'development' ? settings.updateInterval : 0;
  } catch { return 0; }
}

/** 按当前设置重建定时任务；周期为 0 时把任务撤掉 */
export async function syncSchedule(): Promise<void> {
  const hours = await enabledInterval();
  const existing = await getAlarm(ALARM);
  if (!hours) {
    if (existing) await clearAlarm(ALARM);
    if (await readReminder()) await clearReminder();
    await clearBadge();
    return;
  }
  const period = hours * 60;
  if (existing && Math.abs((existing.periodInMinutes ?? 0) - period) < 0.01) return;
  await clearAlarm(ALARM);
  alarmApi().create(ALARM, { periodInMinutes: period });
}

/** 在扩展图标上标「新」 */
async function markBadge(): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text: '新' });
    await chrome.action.setBadgeBackgroundColor({ color: '#00aeec' });
  } catch { /* 角标只是提示，失败不影响提醒本身。 */ }
}

async function clearBadge(): Promise<void> {
  try { await chrome.action.setBadgeText({ text: '' }); } catch { /* 同上。 */ }
}

/** 一次完整的检查：发现新版本 → 记下来 → 打角标 */
export async function runCheck(): Promise<void> {
  if (!await enabledInterval()) return;
  let info;
  try { info = await checkRelease(true); } catch { return; }
  if (!await enabledInterval()) return;
  const current = chrome.runtime.getManifest().version;
  if (!newerRelease(info.tag, current)) {
    // 已经追上了：清掉提醒与角标
    if (await readReminder()) {
      await clearReminder();
      await clearBadge();
    }
    return;
  }
  if (!isReleaseUrl(info.url)) return;
  const known = await readReminder();
  if (known?.tag === info.tag) return;
  await writeReminder({ tag: info.tag, url: info.url, at: Date.now() });
  await markBadge();
}

/** 后台启动时对一遍账：版本已经追上就清掉提醒 */
export async function initReminder(): Promise<void> {
  await syncSchedule();
  const state = await readReminder();
  if (!state) return;
  if (!newerRelease(state.tag, chrome.runtime.getManifest().version)) {
    await clearReminder();
    await clearBadge();
  }
}

export async function claimReminder() {
  const state = await readReminder();
  if (!state || state.seen || !newerRelease(state.tag, chrome.runtime.getManifest().version) || !await enabledInterval()) return null;
  await writeReminder({ ...state, seen: true });
  return state;
}
